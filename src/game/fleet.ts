import {
  ZERO_AMOUNT,
  amountAdd,
  amountClampMin,
  amountMultiply,
  exactCost,
  exactResourceBag,
  type ExactCost,
} from "./amount";
import {
  normalizeCapacityWorkRuntime,
  type CapacityWorkRuntime,
} from "./capacityWork";
import {
  normalizeDistributedWorkRuntime,
  type DistributedWorkRuntime,
} from "./distributed";
import { canAffordExact, spendExact } from "./economy";
import {
  getNetworkSkuDefinition,
  getServerSkuDefinition,
  getStorageSkuDefinition,
  isNetworkSkuId,
  isServerSkuId,
  isStorageSkuId,
} from "./infrastructureDefinitions";
import { getCampaignChapterIndex } from "./campaign";
import { normalizeFacilityState } from "./facilities";
import { createPlacementVector } from "./placement";
import { createWorkValueMultiplier } from "./workValue";
import type {
  ClusterWorkloadCompletionEvent,
  ClusterWorkloadDefinitionId,
  ClusterWorkloadPlacement,
  ClusterWorkloadState,
  ClusterPolicy,
  ClusterState,
  FleetNodeState,
  InfrastructureState,
  NetworkSkuId,
  ReplicaFaultDomain,
  ServerSkuId,
  StorageSkuId,
} from "./infrastructureTypes";
import type { GameAction, GameState, SystemState } from "./types";

export const MAX_AGGREGATE_SERVER_COUNT = 1_000_000;
const MAX_ENTITY_ID = Number.MAX_SAFE_INTEGER;
const ENTITY_ID_PATTERN = /^(fleet-node|cluster|workload|facility)-(\d+)$/;
type InfrastructureEntityPrefix =
  | "fleet-node"
  | "cluster"
  | "workload"
  | "facility";

const clusterWorkloadDefinitionIds: readonly ClusterWorkloadDefinitionId[] = [
  "replicatedShardCommit",
  "fabricIntegritySweep",
] as const;

const isClusterWorkloadDefinitionId = (
  value: unknown,
): value is ClusterWorkloadDefinitionId =>
  clusterWorkloadDefinitionIds.includes(value as ClusterWorkloadDefinitionId);

export const defaultClusterPolicy: ClusterPolicy = {
  defaultWeight: 1,
  reserveHeadroomBps: 0,
  replicaFaultDomain: "node",
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const boundedInteger = (
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
};

const compareEntityIds = (left: string, right: string) => {
  const leftMatch = ENTITY_ID_PATTERN.exec(left);
  const rightMatch = ENTITY_ID_PATTERN.exec(right);
  const leftIndex = Number(leftMatch?.[2] ?? Number.MAX_SAFE_INTEGER);
  const rightIndex = Number(rightMatch?.[2] ?? Number.MAX_SAFE_INTEGER);
  return leftIndex - rightIndex || left.localeCompare(right);
};

const isEntityId = (value: unknown, prefix: InfrastructureEntityPrefix) => {
  if (typeof value !== "string") return false;
  const match = ENTITY_ID_PATTERN.exec(value);
  const index = Number(match?.[2] ?? 0);
  return match?.[1] === prefix && Number.isSafeInteger(index) && index > 0;
};

const entityIndex = (id: string) => {
  const match = ENTITY_ID_PATTERN.exec(id);
  return boundedInteger(Number(match?.[2]), 1, MAX_ENTITY_ID, 0);
};

const uniqueSortedIds = (values: unknown, validIds?: Set<string>) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : []).filter(
        (value): value is string =>
          typeof value === "string" && (!validIds || validIds.has(value)),
      ),
    ),
  ).sort(compareEntityIds);

const normalizeFaultDomain = (value: unknown): ReplicaFaultDomain =>
  value === "rack" || value === "zone" ? value : "node";

export const normalizeClusterPolicy = (
  value: Partial<ClusterPolicy> | null | undefined,
): ClusterPolicy => ({
  defaultWeight: boundedInteger(value?.defaultWeight, 1, 100, 1),
  reserveHeadroomBps: boundedInteger(
    value?.reserveHeadroomBps,
    0,
    9_000,
    0,
  ),
  replicaFaultDomain: normalizeFaultDomain(value?.replicaFaultDomain),
});

export const createInfrastructureState = (
  systemIds: readonly number[] = [1],
): InfrastructureState => {
  const ids = Array.from(
    new Set(
      systemIds
        .filter((id) => Number.isSafeInteger(id) && id > 0)
        .map((id) => Math.trunc(id)),
    ),
  ).sort((left, right) => left - right);
  const fleetNodes: FleetNodeState[] = ids.map((systemId, index) => ({
    id: `fleet-node-${index + 1}`,
    source: { kind: "system", systemId },
    managed: false,
    rackId: null,
    storageSkuId: "storageNone",
    networkSkuId: "networkNone",
  }));
  return {
    elapsedMs: 0,
    nextEntityId: fleetNodes.length + 1,
    nextCompletionSequence: 1,
    fleetNodes,
    clusters: [],
    facilities: [],
    workloads: [],
    completedWorkloadCounts: {},
    successfulShardCommits: 0,
    replicaDomainCommits: 0,
    completionEvents: [],
  };
};

const normalizeWorkloadPlacements = (
  value: unknown,
  nodeIds: Set<string>,
): ClusterWorkloadPlacement[] => {
  const seenRequests = new Set<string>();
  return (Array.isArray(value) ? value : [])
    .map(asRecord)
    .filter((placement): placement is Record<string, unknown> => placement !== null)
    .flatMap((placement) => {
      const requestId =
        typeof placement.requestId === "string" ? placement.requestId : "";
      const nodeId = typeof placement.nodeId === "string" ? placement.nodeId : "";
      if (!requestId || !nodeIds.has(nodeId) || seenRequests.has(requestId)) return [];
      seenRequests.add(requestId);
      return [{
        requestId,
        nodeId,
        faultDomainId:
          typeof placement.faultDomainId === "string"
            ? placement.faultDomainId
            : "",
        demand: createPlacementVector(
          (asRecord(placement.demand) ?? {}) as Partial<ClusterWorkloadPlacement["demand"]>,
        ),
      }];
    })
    .sort((left, right) => left.requestId.localeCompare(right.requestId));
};

const normalizeClusterWorkloads = (
  value: unknown,
  clusterIds: Set<string>,
  nodeIds: Set<string>,
): ClusterWorkloadState[] => {
  const seenIds = new Set<string>();
  return (Array.isArray(value) ? value : [])
    .map(asRecord)
    .filter((workload): workload is Record<string, unknown> => workload !== null)
    .filter((workload) => isEntityId(workload.id, "workload"))
    .sort((left, right) => compareEntityIds(String(left.id), String(right.id)))
    .flatMap<ClusterWorkloadState>((workload): ClusterWorkloadState[] => {
      const id = String(workload.id);
      const clusterId = typeof workload.clusterId === "string" ? workload.clusterId : "";
      if (
        seenIds.has(id) ||
        !clusterIds.has(clusterId) ||
        !isClusterWorkloadDefinitionId(workload.definitionId)
      ) {
        return [];
      }
      const definitionId = workload.definitionId;
      const expectedKind =
        definitionId === "replicatedShardCommit" ? "distributed" : "capacity";
      if (workload.kind !== expectedKind || !asRecord(workload.runtime)) return [];
      try {
        const common = {
          id,
          definitionId,
          clusterId,
          weight: boundedInteger(workload.weight, 1, 100, 1),
          source: workload.source === "campaign" ? "campaign" as const : "manual" as const,
          placements: normalizeWorkloadPlacements(workload.placements, nodeIds),
          operatingCreditsSpent: amountClampMin(
            typeof workload.operatingCreditsSpent === "string"
              ? workload.operatingCreditsSpent
              : 0,
          ),
          paidWorkUnits:
            typeof workload.paidWorkUnits === "string" ||
            typeof workload.paidWorkUnits === "number"
              ? amountClampMin(workload.paidWorkUnits)
              : undefined,
          workValueMultiplier: (() => {
            const multiplier = asRecord(workload.workValueMultiplier);
            if (
              !multiplier ||
              typeof multiplier.id !== "string" ||
              (typeof multiplier.basisPoints !== "string" &&
                typeof multiplier.basisPoints !== "number")
            ) {
              return undefined;
            }
            try {
              return createWorkValueMultiplier(
                multiplier.id,
                multiplier.basisPoints,
              );
            } catch {
              return undefined;
            }
          })(),
          blockers: Array.from(
            new Set(
              (Array.isArray(workload.blockers) ? workload.blockers : []).filter(
                (blocker): blocker is string => typeof blocker === "string",
              ),
            ),
          ).slice(0, 20),
        };
        seenIds.add(id);
        return expectedKind === "distributed"
          ? [{
              ...common,
              kind: "distributed" as const,
              runtime: normalizeDistributedWorkRuntime(
                workload.runtime as unknown as DistributedWorkRuntime,
              ),
            }]
          : [{
              ...common,
              kind: "capacity" as const,
              runtime: normalizeCapacityWorkRuntime(
                workload.runtime as unknown as CapacityWorkRuntime,
              ),
            }];
      } catch {
        return [];
      }
    });
};

const normalizeCompletionEvents = (
  value: unknown,
  clusterIds: Set<string>,
): ClusterWorkloadCompletionEvent[] => {
  const seenSequences = new Set<number>();
  return (Array.isArray(value) ? value : [])
    .map(asRecord)
    .filter((event): event is Record<string, unknown> => event !== null)
    .flatMap((event) => {
      const sequence = boundedInteger(event.sequence, 1, MAX_ENTITY_ID, 0);
      if (
        sequence <= 0 ||
        seenSequences.has(sequence) ||
        !isClusterWorkloadDefinitionId(event.definitionId) ||
        typeof event.instanceId !== "string" ||
        typeof event.clusterId !== "string" ||
        !clusterIds.has(event.clusterId)
      ) {
        return [];
      }
      const rewards = asRecord(event.rewards);
      seenSequences.add(sequence);
      return [{
        sequence,
        instanceId: event.instanceId,
        definitionId: event.definitionId,
        clusterId: event.clusterId,
        source: event.source === "campaign" ? "campaign" as const : "manual" as const,
        rewards: exactResourceBag(
          typeof rewards?.credits === "string" ? rewards.credits : 0,
          typeof rewards?.data === "string" ? rewards.data : 0,
        ),
        replicaFaultDomainCount: boundedInteger(
          event.replicaFaultDomainCount,
          0,
          MAX_ENTITY_ID,
          0,
        ),
      }];
    })
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-256);
};

const normalizeFleetNodes = (
  value: unknown,
  systemIds: Set<number>,
): FleetNodeState[] => {
  const candidates = (Array.isArray(value) ? value : [])
    .map(asRecord)
    .filter((node): node is Record<string, unknown> => node !== null)
    .filter((node) => isEntityId(node.id, "fleet-node"))
    .sort((left, right) => compareEntityIds(String(left.id), String(right.id)));
  const usedNodeIds = new Set<string>();
  const usedSystemIds = new Set<number>();
  const nodes: FleetNodeState[] = [];
  for (const candidate of candidates) {
    const id = String(candidate.id);
    if (usedNodeIds.has(id)) continue;
    const source = asRecord(candidate.source);
    if (!source) continue;
    let normalizedSource: FleetNodeState["source"];
    let defaultStorageSkuId: StorageSkuId = "storageNone";
    let defaultNetworkSkuId: NetworkSkuId = "networkNone";
    if (source.kind === "system") {
      const systemId = boundedInteger(source.systemId, 1, MAX_ENTITY_ID, 0);
      if (!systemIds.has(systemId) || usedSystemIds.has(systemId)) continue;
      usedSystemIds.add(systemId);
      normalizedSource = { kind: "system", systemId };
    } else if (source.kind === "aggregate" && isServerSkuId(source.skuId)) {
      const definition = getServerSkuDefinition(source.skuId);
      normalizedSource = {
        kind: "aggregate",
        skuId: source.skuId,
        count: boundedInteger(
          source.count,
          1,
          MAX_AGGREGATE_SERVER_COUNT,
          1,
        ),
      };
      defaultStorageSkuId = definition.defaultStorageSkuId;
      defaultNetworkSkuId = definition.defaultNetworkSkuId;
    } else {
      continue;
    }
    usedNodeIds.add(id);
    nodes.push({
      id,
      source: normalizedSource,
      managed: candidate.managed === true,
      rackId: null,
      storageSkuId: isStorageSkuId(candidate.storageSkuId)
        ? candidate.storageSkuId
        : defaultStorageSkuId,
      networkSkuId: isNetworkSkuId(candidate.networkSkuId)
        ? candidate.networkSkuId
        : defaultNetworkSkuId,
    });
  }
  return nodes;
};

const normalizeClusters = (
  value: unknown,
  nodeIds: Set<string>,
): ClusterState[] => {
  const candidates = (Array.isArray(value) ? value : [])
    .map(asRecord)
    .filter((cluster): cluster is Record<string, unknown> => cluster !== null)
    .filter((cluster) => isEntityId(cluster.id, "cluster"))
    .sort((left, right) => compareEntityIds(String(left.id), String(right.id)));
  const usedClusterIds = new Set<string>();
  const assignedNodeIds = new Set<string>();
  const clusters: ClusterState[] = [];
  for (const candidate of candidates) {
    const id = String(candidate.id);
    if (usedClusterIds.has(id)) continue;
    usedClusterIds.add(id);
    const requestedNodeIds = uniqueSortedIds(candidate.nodeIds, nodeIds);
    const normalizedNodeIds = requestedNodeIds.filter((nodeId) => {
      if (assignedNodeIds.has(nodeId)) return false;
      assignedNodeIds.add(nodeId);
      return true;
    });
    const policy = asRecord(candidate.policy);
    const rawName = typeof candidate.name === "string" ? candidate.name.trim() : "";
    clusters.push({
      id,
      name: rawName.slice(0, 80) || `Cluster ${entityIndex(id)}`,
      nodeIds: normalizedNodeIds,
      policy: normalizeClusterPolicy(
        policy as Partial<ClusterPolicy> | null,
      ),
    });
  }
  return clusters;
};

export const normalizeInfrastructureState = (
  value: Partial<InfrastructureState> | null | undefined,
  systems: readonly Pick<SystemState, "id">[],
): InfrastructureState => {
  const systemIds = new Set(
    systems
      .map((system) => system.id)
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  );
  if (!value) return createInfrastructureState([...systemIds]);
  const fleetNodes = normalizeFleetNodes(value.fleetNodes, systemIds);
  const facilities = (Array.isArray(value.facilities) ? value.facilities : [])
    .map(normalizeFacilityState)
    .sort((left, right) => compareEntityIds(left.id, right.id))
    .filter(
      (facility, index, values) =>
        index === 0 || facility.id !== values[index - 1]?.id,
    );
  const wrappedSystemIds = new Set(
    fleetNodes
      .filter((node) => node.source.kind === "system")
      .map((node) =>
        node.source.kind === "system" ? node.source.systemId : 0,
      ),
  );
  const reservedEntityIndices = new Set([
    ...fleetNodes.map((node) => entityIndex(node.id)),
    ...(Array.isArray(value.clusters) ? value.clusters : [])
      .map(asRecord)
      .filter((cluster): cluster is Record<string, unknown> => cluster !== null)
      .filter((cluster) => isEntityId(cluster.id, "cluster"))
      .map((cluster) => entityIndex(String(cluster.id))),
    ...(Array.isArray(value.workloads) ? value.workloads : [])
      .map(asRecord)
      .filter((workload): workload is Record<string, unknown> => workload !== null)
      .filter((workload) => isEntityId(workload.id, "workload"))
      .map((workload) => entityIndex(String(workload.id))),
    ...facilities.map((facility) => entityIndex(facility.id)),
  ]);
  let nextWrapperIndex = 1;
  for (const systemId of [...systemIds].sort((left, right) => left - right)) {
    if (wrappedSystemIds.has(systemId)) continue;
    while (reservedEntityIndices.has(nextWrapperIndex)) nextWrapperIndex += 1;
    reservedEntityIndices.add(nextWrapperIndex);
    fleetNodes.push({
      id: `fleet-node-${nextWrapperIndex}`,
      source: { kind: "system", systemId },
      managed: false,
      rackId: null,
      storageSkuId: "storageNone",
      networkSkuId: "networkNone",
    });
    nextWrapperIndex += 1;
  }
  fleetNodes.sort((left, right) => compareEntityIds(left.id, right.id));
  const clusters = normalizeClusters(
    value.clusters,
    new Set(fleetNodes.filter((node) => node.managed).map((node) => node.id)),
  );
  const allNodeIds = new Set(fleetNodes.map((node) => node.id));
  const clusterIds = new Set(clusters.map((cluster) => cluster.id));
  const workloads = normalizeClusterWorkloads(
    value.workloads,
    clusterIds,
    allNodeIds,
  );
  const completionEvents = normalizeCompletionEvents(
    value.completionEvents,
    clusterIds,
  );
  const completedWorkloadCounts = Object.fromEntries(
    clusterWorkloadDefinitionIds.flatMap((definitionId) => {
      const raw = value.completedWorkloadCounts?.[definitionId];
      const count = boundedInteger(raw, 0, MAX_ENTITY_ID, 0);
      return count > 0 ? [[definitionId, count]] : [];
    }),
  ) as InfrastructureState["completedWorkloadCounts"];
  const highestEntityId = Math.max(
    0,
    ...fleetNodes.map((node) => entityIndex(node.id)),
    ...clusters.map((cluster) => entityIndex(cluster.id)),
    ...workloads.map((workload) => entityIndex(workload.id)),
    ...facilities.map((facility) => entityIndex(facility.id)),
  );
  const highestCompletionSequence = Math.max(
    0,
    ...completionEvents.map((event) => event.sequence),
  );
  return {
    elapsedMs: boundedInteger(value.elapsedMs, 0, MAX_ENTITY_ID, 0),
    nextEntityId: Math.max(
      1,
      Math.min(
        MAX_ENTITY_ID,
        Math.max(
          highestEntityId + 1,
          boundedInteger(value.nextEntityId, 1, MAX_ENTITY_ID, 1),
        ),
      ),
    ),
    nextCompletionSequence: Math.max(
      highestCompletionSequence + 1,
      boundedInteger(value.nextCompletionSequence, 1, MAX_ENTITY_ID, 1),
    ),
    fleetNodes,
    clusters,
    facilities,
    workloads,
    completedWorkloadCounts,
    successfulShardCommits: boundedInteger(
      value.successfulShardCommits,
      0,
      MAX_ENTITY_ID,
      0,
    ),
    replicaDomainCommits: boundedInteger(
      value.replicaDomainCommits,
      0,
      MAX_ENTITY_ID,
      0,
    ),
    completionEvents,
  };
};

export const getFleetNodeForSystem = (
  state: GameState,
  systemId: number,
) =>
  state.infrastructure.fleetNodes.find(
    (node) => node.source.kind === "system" && node.source.systemId === systemId,
  ) ?? null;

export const isSystemManaged = (state: GameState, systemId: number) =>
  getFleetNodeForSystem(state, systemId)?.managed === true;

export const getSystemManagementBlockedReason = (
  state: GameState,
  systemId: number,
): string | null => {
  const system = state.systems.find((candidate) => candidate.id === systemId);
  if (!system) return "System does not exist.";
  if (
    system.activeTasks.length > 0 ||
    system.activeJobs.length > 0 ||
    system.queue.length > 0 ||
    (system.queueEntries?.length ?? 0) > 0
  ) {
    return "System must finish active and queued work before Fleet management.";
  }
  if (system.cron.schedules.some((schedule) => schedule.enabled)) {
    return "Disable CRON schedules before Fleet management.";
  }
  if (
    state.contracts.active.some((contract) => contract.systemId === systemId) ||
    Object.values(state.projects.progress).some(
      (progress) => progress?.active && progress.systemId === systemId,
    ) ||
    (state.standingOrder.enabled && state.standingOrder.systemId === systemId) ||
    (state.autoRepeatJobId !== null && state.selectedSystemId === systemId)
  ) {
    return "System must finish assigned automated work before Fleet management.";
  }
  return null;
};

export const getFleetManagementBlockedReason = (state: GameState) => {
  if (getCampaignChapterIndex(state.campaign.currentChapterId) < 3) {
    return "Requires Workshop Fleet.";
  }
  if (!state.flags.systemCatalog && !state.research.completed.includes("systemCatalog")) {
    return "Requires System Catalog research.";
  }
  return null;
};

const automationLevelOrder = [
  "startingNode",
  "localScheduler",
  "cronRuntime",
  "systemScheduler",
  "fleetOrchestrator",
  "clusterController",
  "rackController",
  "dataCenterNoc",
  "globalScheduler",
] as const;

export const getClusterManagementBlockedReason = (state: GameState) =>
  automationLevelOrder.indexOf(state.automationBuffer.ownedLevelId) <
  automationLevelOrder.indexOf("clusterController")
    ? "Requires Cluster Controller automation."
    : null;

export const normalizeInfrastructureForGameState = (
  state: GameState,
): GameState => {
  const normalized = normalizeInfrastructureState(
    state.infrastructure,
    state.systems,
  );
  const systemStorage = new Map(
    state.systems.map((system) => [system.id, system.workshop.storageSkuId]),
  );
  const fleetNodes = normalized.fleetNodes.map((node) => {
    const mirrored =
      node.source.kind === "system"
        ? {
            ...node,
            storageSkuId:
              systemStorage.get(node.source.systemId) ?? "storageNone",
          }
        : node;
    return mirrored.source.kind === "system" &&
      mirrored.managed &&
      getSystemManagementBlockedReason(state, mirrored.source.systemId)
      ? { ...mirrored, managed: false }
      : mirrored;
  });
  const managedNodeIds = new Set(
    fleetNodes.filter((node) => node.managed).map((node) => node.id),
  );
  const archivistToolsUnlocked =
    state.projects.completedProjectIds.includes("archivist");
  return {
    ...state,
    infrastructure: {
      ...normalized,
      fleetNodes,
      clusters: normalized.clusters.map((cluster) => ({
        ...cluster,
        policy: archivistToolsUnlocked
          ? cluster.policy
          : { ...cluster.policy, replicaFaultDomain: "node" as const },
        nodeIds: cluster.nodeIds.filter((nodeId) => managedNodeIds.has(nodeId)),
      })),
    },
  };
};

export const allocateInfrastructureEntityId = (
  infrastructure: InfrastructureState,
  prefix: InfrastructureEntityPrefix,
) => {
  const usedIds = new Set([
    ...infrastructure.fleetNodes.map((node) => node.id),
    ...infrastructure.clusters.map((cluster) => cluster.id),
    ...(infrastructure.workloads ?? []).map((workload) => workload.id),
    ...infrastructure.facilities.map((facility) => facility.id),
  ]);
  let nextEntityId = Math.max(1, infrastructure.nextEntityId);
  while (
    nextEntityId < MAX_ENTITY_ID &&
    usedIds.has(`${prefix}-${nextEntityId}`)
  ) {
    nextEntityId += 1;
  }
  if (usedIds.has(`${prefix}-${nextEntityId}`)) return null;
  return {
    id: `${prefix}-${nextEntityId}`,
    nextEntityId: Math.min(MAX_ENTITY_ID, nextEntityId + 1),
  };
};

export const setSystemManaged = (
  state: GameState,
  systemId: number,
  managed: boolean,
): GameState => {
  const normalized = normalizeInfrastructureForGameState(state);
  if (!normalized.systems.some((system) => system.id === systemId)) return normalized;
  if (
    managed &&
    (getFleetManagementBlockedReason(normalized) ||
      getSystemManagementBlockedReason(normalized, systemId))
  ) {
    return normalized;
  }
  const existing = getFleetNodeForSystem(normalized, systemId);
  if (existing) {
    return {
      ...normalized,
      infrastructure: {
        ...normalized.infrastructure,
        fleetNodes: normalized.infrastructure.fleetNodes.map((node) =>
          node.id === existing.id ? { ...node, managed } : node,
        ),
        clusters: managed
          ? normalized.infrastructure.clusters
          : normalized.infrastructure.clusters.map((cluster) => ({
              ...cluster,
              nodeIds: cluster.nodeIds.filter((nodeId) => nodeId !== existing.id),
            })),
      },
    };
  }
  const allocation = allocateInfrastructureEntityId(
    normalized.infrastructure,
    "fleet-node",
  );
  if (!allocation) return normalized;
  const node: FleetNodeState = {
    id: allocation.id,
    source: { kind: "system", systemId },
    managed,
    rackId: null,
    storageSkuId:
      normalized.systems.find((system) => system.id === systemId)?.workshop
        .storageSkuId ?? "storageNone",
    networkSkuId: "networkNone",
  };
  return {
    ...normalized,
    infrastructure: {
      ...normalized.infrastructure,
      nextEntityId: allocation.nextEntityId,
      fleetNodes: [
        ...normalized.infrastructure.fleetNodes,
        node,
      ].sort((left, right) => compareEntityIds(left.id, right.id)),
    },
  };
};

const aggregateBatchProfileCosts = (
  skuId: ServerSkuId,
  count: number,
  storageSkuId: StorageSkuId,
  networkSkuId: NetworkSkuId,
): ExactCost[] => {
  const perNodeCosts = [
    ...getServerSkuDefinition(skuId).costs,
    ...getStorageSkuDefinition(storageSkuId).costs,
    ...getNetworkSkuDefinition(networkSkuId).costs,
  ];
  let credits = ZERO_AMOUNT;
  let data = ZERO_AMOUNT;
  for (const cost of perNodeCosts) {
    if (cost.resource === "credits") credits = amountAdd(credits, cost.amount);
    else data = amountAdd(data, cost.amount);
  }
  return [
    exactCost("credits", amountMultiply(credits, count)),
    exactCost("data", amountMultiply(data, count)),
  ].filter((cost) => cost.amount !== ZERO_AMOUNT);
};

export const getAggregateServerBatchCosts = aggregateBatchProfileCosts;

export const purchaseAggregateServerBatch = (
  state: GameState,
  skuId: ServerSkuId,
  count: number,
  requestedStorageSkuId?: StorageSkuId,
  requestedNetworkSkuId?: NetworkSkuId,
): GameState => {
  if (!isServerSkuId(skuId) || !Number.isFinite(count) || count < 1) return state;
  const normalizedCount = boundedInteger(
    count,
    1,
    MAX_AGGREGATE_SERVER_COUNT,
    1,
  );
  const definition = getServerSkuDefinition(skuId);
  const storageSkuId = isStorageSkuId(requestedStorageSkuId)
    ? requestedStorageSkuId
    : definition.defaultStorageSkuId;
  const networkSkuId = isNetworkSkuId(requestedNetworkSkuId)
    ? requestedNetworkSkuId
    : definition.defaultNetworkSkuId;
  const costs = aggregateBatchProfileCosts(
    skuId,
    normalizedCount,
    storageSkuId,
    networkSkuId,
  );
  const normalized = normalizeInfrastructureForGameState(state);
  if (getFleetManagementBlockedReason(normalized)) return normalized;
  if (!canAffordExact(normalized, costs)) return normalized;
  const paid = spendExact(normalized, costs);
  const allocation = allocateInfrastructureEntityId(
    paid.infrastructure,
    "fleet-node",
  );
  if (!allocation) return normalized;
  const node: FleetNodeState = {
    id: allocation.id,
    source: { kind: "aggregate", skuId, count: normalizedCount },
    managed: true,
    rackId: null,
    storageSkuId,
    networkSkuId,
  };
  return {
    ...paid,
    infrastructure: {
      ...paid.infrastructure,
      nextEntityId: allocation.nextEntityId,
      fleetNodes: [
        ...paid.infrastructure.fleetNodes,
        node,
      ].sort((left, right) => compareEntityIds(left.id, right.id)),
    },
  };
};

const sanitizedClusterNodeIds = (state: GameState, nodeIds: string[]) =>
  uniqueSortedIds(
    nodeIds,
    new Set(
      state.infrastructure.fleetNodes
        .filter((node) => node.managed)
        .map((node) => node.id),
    ),
  );

const assignClusterNodes = (
  infrastructure: InfrastructureState,
  clusterId: string,
  nodeIds: string[],
) => ({
  ...infrastructure,
  clusters: infrastructure.clusters.map((cluster) =>
    cluster.id === clusterId
      ? { ...cluster, nodeIds }
      : {
          ...cluster,
          nodeIds: cluster.nodeIds.filter((nodeId) => !nodeIds.includes(nodeId)),
        },
  ),
});

export const commissionCluster = (
  state: GameState,
  name: string,
  nodeIds: string[],
  policy?: Partial<ClusterPolicy>,
): GameState => {
  const normalized = normalizeInfrastructureForGameState(state);
  if (getClusterManagementBlockedReason(normalized)) return normalized;
  const allocation = allocateInfrastructureEntityId(
    normalized.infrastructure,
    "cluster",
  );
  if (!allocation) return normalized;
  const cleanName = name.trim().slice(0, 80) || `Cluster ${entityIndex(allocation.id)}`;
  const requestedPolicy = normalizeClusterPolicy(policy);
  const cluster: ClusterState = {
    id: allocation.id,
    name: cleanName,
    nodeIds: [],
    policy: normalized.projects.completedProjectIds.includes("archivist")
      ? requestedPolicy
      : { ...requestedPolicy, replicaFaultDomain: "node" },
  };
  const infrastructure = assignClusterNodes(
    {
      ...normalized.infrastructure,
      nextEntityId: allocation.nextEntityId,
      clusters: [...normalized.infrastructure.clusters, cluster].sort((left, right) =>
        compareEntityIds(left.id, right.id),
      ),
    },
    cluster.id,
    sanitizedClusterNodeIds(normalized, nodeIds),
  );
  return { ...normalized, infrastructure };
};

export const setClusterNodes = (
  state: GameState,
  clusterId: string,
  nodeIds: string[],
): GameState => {
  const normalized = normalizeInfrastructureForGameState(state);
  if (getClusterManagementBlockedReason(normalized)) return normalized;
  if (!normalized.infrastructure.clusters.some((cluster) => cluster.id === clusterId)) {
    return normalized;
  }
  return {
    ...normalized,
    infrastructure: assignClusterNodes(
      normalized.infrastructure,
      clusterId,
      sanitizedClusterNodeIds(normalized, nodeIds),
    ),
  };
};

export const setClusterPolicy = (
  state: GameState,
  clusterId: string,
  policy: Partial<ClusterPolicy>,
): GameState => {
  const normalized = normalizeInfrastructureForGameState(state);
  if (getClusterManagementBlockedReason(normalized)) return normalized;
  if (!normalized.infrastructure.clusters.some((cluster) => cluster.id === clusterId)) {
    return normalized;
  }
  if (
    policy.replicaFaultDomain !== undefined &&
    policy.replicaFaultDomain !== "node" &&
    !normalized.projects.completedProjectIds.includes("archivist")
  ) {
    return normalized;
  }
  return {
    ...normalized,
    infrastructure: {
      ...normalized.infrastructure,
      clusters: normalized.infrastructure.clusters.map((cluster) =>
        cluster.id === clusterId
          ? {
              ...cluster,
              policy: normalizeClusterPolicy({ ...cluster.policy, ...policy }),
            }
          : cluster,
      ),
    },
  };
};

export const isInfrastructureAction = (action: GameAction) =>
  action.type === "setSystemManaged" ||
  action.type === "purchaseAggregateServerBatch" ||
  action.type === "commissionCluster" ||
  action.type === "setClusterNodes" ||
  action.type === "setClusterPolicy";

export const applyInfrastructureAction = (
  state: GameState,
  action: GameAction,
): GameState => {
  if (action.type === "setSystemManaged") {
    return setSystemManaged(state, action.systemId, action.managed);
  }
  if (action.type === "purchaseAggregateServerBatch") {
    return purchaseAggregateServerBatch(
      state,
      action.skuId,
      action.count,
      action.storageSkuId,
      action.networkSkuId,
    );
  }
  if (action.type === "commissionCluster") {
    return commissionCluster(state, action.name, action.nodeIds, {
      defaultWeight: action.defaultWeight,
      reserveHeadroomBps: action.reserveHeadroomBps,
      replicaFaultDomain: action.replicaFaultDomain,
    });
  }
  if (action.type === "setClusterNodes") {
    return setClusterNodes(state, action.clusterId, action.nodeIds);
  }
  if (action.type === "setClusterPolicy") {
    const policy: Partial<ClusterPolicy> = {};
    if (action.defaultWeight !== undefined) {
      policy.defaultWeight = action.defaultWeight;
    }
    if (action.reserveHeadroomBps !== undefined) {
      policy.reserveHeadroomBps = action.reserveHeadroomBps;
    }
    if (action.replicaFaultDomain !== undefined) {
      policy.replicaFaultDomain = action.replicaFaultDomain;
    }
    return setClusterPolicy(state, action.clusterId, policy);
  }
  return state;
};

const guardedManagedSystemActionTypes = new Set<GameAction["type"]>([
  "startTask",
  "startTaskOnCore",
  "queueTask",
  "cancelTask",
  "cancelQueuedTask",
  "startJob",
  "startJobOnCore",
  "queueJob",
  "setAutoRepeat",
  "requestShutdown",
  "requestStartup",
  "requestPowerOff",
  "requestPowerOn",
  "requestPowerKill",
  "setCronTask",
  "setCronInterval",
  "setCronEnabled",
  "setSchedulerPolicy",
  "setSchedulerAutoKill",
  "setSchedulerKillPolicy",
  "buyUpgrade",
  "downgradeUpgrade",
  "installCoolingTier",
  "setOverclockPreset",
  "installAccelerator",
  "removeAccelerator",
  "installWorkshopStorage",
  "installLocalNetwork",
  "startWorkshopStorageWorkload",
  "cancelWorkshopStorageWorkload",
  "sellSystem",
  "setStandingOrder",
  "setStandingOrderEnabled",
  "startProjectPhase",
  "acceptContract",
]);

const getActionTargetSystemId = (state: GameState, action: GameAction) => {
  if (action.type === "acceptContract") {
    return action.systemId ??
      state.contracts.offers.find((offer) => offer.id === action.contractId)?.systemId ??
      null;
  }
  if (action.type === "sellSystem" || action.type === "setSystemManaged") {
    return action.systemId;
  }
  if (action.type === "setStandingOrderEnabled") {
    return state.standingOrder.systemId ?? state.selectedSystemId;
  }
  if ("systemId" in action && typeof action.systemId === "number") {
    return action.systemId;
  }
  return state.selectedSystemId;
};

export const isLegacyActionBlockedByManagedSystem = (
  state: GameState,
  action: GameAction,
) => {
  if (!guardedManagedSystemActionTypes.has(action.type)) {
    if (
      action.type !== "buyResearch" ||
      !state.research.completed.includes(action.researchId) ||
      !["cStateControl", "memoryVoltageModifier", "bootloader"].includes(
        action.researchId,
      )
    ) {
      return false;
    }
  }
  const systemId = getActionTargetSystemId(state, action);
  return systemId !== null && isSystemManaged(state, systemId);
};
