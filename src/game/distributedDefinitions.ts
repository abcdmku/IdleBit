import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountCompare,
  amountDivide,
  amountMin,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  exactCost,
  exactResourceBag,
  sumAmounts,
  type Amount,
  type ExactCost,
  type ExactResourceBag,
} from "./amount";
import {
  getAutomationBufferDefinition,
  getAutomationBufferLevelIndex,
} from "./automation";
import {
  advanceCapacityWork,
  createCapacityWorkRuntime,
  getNextCapacityWorkEventMs,
  type CapacityWorkFitCapacity,
  type CapacityWorkPlan,
} from "./capacityWork";
import {
  createEmptyCapacityProfile,
  getCapacityUtilizationBps,
  getFleetNodeCapacityProfile,
  scaleCapacityProfile,
  subtractCapacityProfiles,
  sumCapacityProfiles,
} from "./capacity";
import { getCampaignChapterIndex } from "./campaign";
import {
  advanceDistributedWork,
  createDistributedWorkRuntime,
  createShardPipelinePlan,
  getDistributedProgress,
  getDistributedWorkPaidUnits,
  getNextDistributedEventMs,
  type DistributedWorkPlan,
} from "./distributed";
import {
  addExactRewards,
  canAffordExact,
  spendExact,
} from "./economy";
import {
  getFacilityOperatingCostPerSecondForNodeIds,
  getProductiveFacilitiesForNodeIds,
  normalizeFacilityInfrastructureForGameState,
  parseQualifiedRackRef,
} from "./facilityInfrastructure";
import {
  addFacilityResourceVectors,
  createFacilityResourceVector,
  getFacilityDemandAdmissionBlockers,
  getRackDemandAdmissionBlockers,
  type FacilityState,
} from "./facilities";
import {
  allocateInfrastructureEntityId,
  getClusterManagementBlockedReason,
} from "./fleet";
import { getVisibleInfrastructureState } from "./infrastructureSelectors";
import { getPsuStress } from "./math";
import {
  addPlacementVectors,
  createPlacementVector,
  placeBestFit,
  placementVectorFits,
  placementVectorFromCapacity,
  subtractPlacementVectors,
  type PlacementRequest,
  type PlacementVector,
} from "./placement";
import { materializeSystem } from "./systems";
import {
  createWorkValueMultiplier,
  getWorkValueCredits,
  sumPaidWorkUnits,
  type WorkValueMultiplier,
} from "./workValue";
import {
  compareWorkMarginToBps,
  createWorkProjectionConditions,
  getExactWorkMarginBps,
  projectCapacityWorkRuntime,
  projectWorkMarginBps,
} from "./workProjections";
import {
  allocateWeightedMaxMin,
  createRateVector,
  exactRateResourceIds,
  isEmptyRateVector,
  scaleRateVector,
} from "./weightedFair";
import type {
  CapacityProfile,
  ClusterState,
  ClusterWorkloadDefinitionId,
  ClusterWorkloadPlacement,
  ClusterWorkloadState,
  FleetNodeState,
  RateVector,
  VisibleClusterWorkload,
  VisibleClusterWorkloadProjection,
  VisibleInfrastructureState,
} from "./infrastructureTypes";
import type { AdvanceMode, GameAction, GameState } from "./types";

interface ClusterWorkloadDefinitionBase {
  id: ClusterWorkloadDefinitionId;
  name: string;
  description: string;
  kind: ClusterWorkloadState["kind"];
  startCosts: ExactCost[];
  paidWorkUnits: Amount;
  workValueMultiplier: WorkValueMultiplier;
  rewards: ExactResourceBag;
  operatingCreditsPerSecond: Amount;
  serviceDemand: RateVector;
  placementRequests: PlacementRequest[];
  requiredReplicaDomains: number;
}

interface DistributedClusterWorkloadDefinition
  extends ClusterWorkloadDefinitionBase {
  kind: "distributed";
  createPlan: (placements: readonly ClusterWorkloadPlacement[]) => DistributedWorkPlan;
}

interface CapacityClusterWorkloadDefinition
  extends ClusterWorkloadDefinitionBase {
  kind: "capacity";
  plan: CapacityWorkPlan;
}

export type ClusterWorkloadDefinition =
  | DistributedClusterWorkloadDefinition
  | CapacityClusterWorkloadDefinition;

const replicatedShardDemand = createPlacementVector({
  compute: "500000",
  storageRead: "1000000",
  storageWrite: "1000000",
  networkIngress: "1000000",
  networkEgress: "1000000",
  memoryBits: "1000000",
  storageBits: "4000000",
});

const replicatedShardRequests: PlacementRequest[] = ["replica-a", "replica-b"].map(
  (id) => ({ id, demand: replicatedShardDemand }),
);

const createReplicatedShardPlanWithoutReward = (
  placements: readonly ClusterWorkloadPlacement[] = [],
) => {
  const placementByRequestId = new Map(
    placements.map((placement) => [placement.requestId, placement]),
  );
  return createShardPipelinePlan({
    id: "replicated-shard-commit",
    shards: replicatedShardRequests.map((request) => ({
      id: request.id,
      nodeId:
        placementByRequestId.get(request.id)?.nodeId ?? "settlement-template",
      inputBits: "1000000",
      computeOperations: "1000000",
      outputBits: "500000",
      memoryBits: "1000000",
      placementDemand:
        placementByRequestId.get(request.id)?.demand ?? request.demand,
    })),
    reduceComputeOperations: "1000000",
    reduceOutputBits: "250000",
  });
};

const replicatedShardWorkValueMultiplier = createWorkValueMultiplier(
  "distributed-cluster-service",
  10_000,
);
const replicatedShardPaidWorkUnits = getDistributedWorkPaidUnits(
  createReplicatedShardPlanWithoutReward(),
);
const replicatedShardRewards = exactResourceBag(
  getWorkValueCredits(
    replicatedShardPaidWorkUnits,
    replicatedShardWorkValueMultiplier,
  ),
  "50",
);
const createReplicatedShardPlan = (
  placements: readonly ClusterWorkloadPlacement[],
): DistributedWorkPlan => ({
  ...createReplicatedShardPlanWithoutReward(placements),
  reward: replicatedShardRewards,
});

const integritySweepWork = createRateVector({
  compute: "2000000",
  storageRead: "4000000",
  storageWrite: "1000000",
});
const integritySweepWorkValueMultiplier = createWorkValueMultiplier(
  "cluster-integrity-service",
  10_000,
);
const integritySweepPaidWorkUnits = sumPaidWorkUnits(
  exactRateResourceIds.map((resource) => integritySweepWork[resource]),
);
const integritySweepRewards = exactResourceBag(
  getWorkValueCredits(
    integritySweepPaidWorkUnits,
    integritySweepWorkValueMultiplier,
  ),
  "15",
);
const integritySweepPlan: CapacityWorkPlan = {
  id: "fabric-integrity-sweep",
  work: integritySweepWork,
  memoryBits: amount("1000000"),
  storageBits: amount("4000000"),
  reward: integritySweepRewards,
};

export const clusterWorkloadDefinitions: readonly ClusterWorkloadDefinition[] = [
  {
    id: "replicatedShardCommit",
    name: "Replicated Shard Commit",
    description:
      "Transfer, compute, barrier, reduce, and atomically commit two replicas.",
    kind: "distributed",
    startCosts: [exactCost("credits", "100"), exactCost("data", "10")],
    paidWorkUnits: replicatedShardPaidWorkUnits,
    workValueMultiplier: replicatedShardWorkValueMultiplier,
    rewards: replicatedShardRewards,
    operatingCreditsPerSecond: amount("0.5"),
    serviceDemand: createRateVector({
      compute: "1000000",
      storageRead: "2000000",
      storageWrite: "2000000",
      networkIngress: "2000000",
      networkEgress: "2000000",
    }),
    placementRequests: replicatedShardRequests,
    requiredReplicaDomains: 2,
    createPlan: createReplicatedShardPlan,
  },
  {
    id: "fabricIntegritySweep",
    name: "Fabric Integrity Sweep",
    description: "Run an exact capacity-backed storage and compute integrity pass.",
    kind: "capacity",
    startCosts: [exactCost("credits", "50"), exactCost("data", "5")],
    paidWorkUnits: integritySweepPaidWorkUnits,
    workValueMultiplier: integritySweepWorkValueMultiplier,
    rewards: integritySweepRewards,
    operatingCreditsPerSecond: amount("0.2"),
    serviceDemand: createRateVector({
      compute: "1000000",
      storageRead: "2000000",
      storageWrite: "500000",
    }),
    placementRequests: [
      {
        id: "integrity-sweep",
        demand: createPlacementVector({
          compute: "100000",
          storageRead: "200000",
          storageWrite: "50000",
          memoryBits: "1000000",
          storageBits: "4000000",
        }),
      },
    ],
    requiredReplicaDomains: 1,
    plan: integritySweepPlan,
  },
] as const;

const definitionById = new Map(
  clusterWorkloadDefinitions.map((definition) => [definition.id, definition]),
);

export const getClusterWorkloadDefinition = (
  id: ClusterWorkloadDefinitionId,
) => definitionById.get(id)!;

const isWorkloadComplete = (workload: ClusterWorkloadState) =>
  workload.runtime.rewardIssued;

const getClusterWorkloadPaidUnits = (workload: ClusterWorkloadState) =>
  workload.paidWorkUnits ?? (
    workload.kind === "distributed"
      ? getDistributedWorkPaidUnits(workload.runtime.plan)
      : sumPaidWorkUnits(
          exactRateResourceIds.map(
            (resource) => workload.runtime.plan.work[resource],
          ),
        )
  );

/** Current saves use frozen terms; legacy saves migrate from their exact plan. */
const getClusterWorkloadSettlement = (
  workload: ClusterWorkloadState,
  definition: ClusterWorkloadDefinition,
) => {
  const paidWorkUnits = getClusterWorkloadPaidUnits(workload);
  const workValueMultiplier =
    workload.workValueMultiplier ?? definition.workValueMultiplier;
  return {
    paidWorkUnits,
    workValueMultiplier,
    rewards: exactResourceBag(
      getWorkValueCredits(paidWorkUnits, workValueMultiplier),
      workload.runtime.plan.reward.data,
    ),
  };
};

export const hasActiveClusterWorkloads = (state: GameState) =>
  (state.infrastructure.workloads ?? []).some(
    (workload) => !isWorkloadComplete(workload),
  );

const getNodeRuntimeBlocker = (state: GameState, node: FleetNodeState) => {
  if (!node.managed) return "Fleet node is not managed.";
  if (node.source.kind === "aggregate") return null;
  const systemId = node.source.systemId;
  const system = state.systems.find((candidate) => candidate.id === systemId);
  if (!system) return "Inspected system is missing.";
  if (system.power.state !== "on") return `System power state is ${system.power.state}.`;
  if (getPsuStress(materializeSystem(state, systemId)) > 1) {
    return "System exceeds safe PSU capacity.";
  }
  return null;
};

const getClusterNodeStates = (state: GameState, cluster: ClusterState) => {
  const nodesById = new Map(
    state.infrastructure.fleetNodes.map((node) => [node.id, node]),
  );
  return cluster.nodeIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is FleetNodeState => Boolean(node));
};

const getFaultDomainId = (
  node: FleetNodeState,
  cluster: ClusterState,
): string | null => {
  if (cluster.policy.replicaFaultDomain === "node") return `node:${node.id}`;
  if (cluster.policy.replicaFaultDomain === "rack") {
    return node.rackId ? `rack:${node.rackId}` : null;
  }
  return null;
};

const getPolicyScale = (cluster: ClusterState) =>
  amountDivide(10_000 - cluster.policy.reserveHeadroomBps, 10_000);

const getSafeNodeCapacity = (
  state: GameState,
  cluster: ClusterState,
  node: FleetNodeState,
) =>
  getNodeRuntimeBlocker(state, node)
    ? createEmptyCapacityProfile()
    : scaleCapacityProfile(getFleetNodeCapacityProfile(state, node), getPolicyScale(cluster));

const getClusterSafeCapacity = (state: GameState, cluster: ClusterState) =>
  sumCapacityProfiles(
    getClusterNodeStates(state, cluster).map((node) =>
      getSafeNodeCapacity(state, cluster, node),
    ),
  );

const getExistingPlacementReservations = (
  state: GameState,
  clusterId: string,
) => {
  const reservations = new Map<string, PlacementVector>();
  for (const workload of state.infrastructure.workloads ?? []) {
    if (workload.clusterId !== clusterId || isWorkloadComplete(workload)) continue;
    for (const placement of workload.placements) {
      reservations.set(
        placement.nodeId,
        addPlacementVectors(
          reservations.get(placement.nodeId) ?? createPlacementVector(),
          placement.demand,
        ),
      );
    }
  }
  return reservations;
};

interface PlacementAttempt {
  placements: ClusterWorkloadPlacement[];
  blocker: string | null;
}

const placeClusterWorkload = (
  state: GameState,
  cluster: ClusterState,
  definition: ClusterWorkloadDefinition,
): PlacementAttempt => {
  const existing = getExistingPlacementReservations(state, cluster.id);
  const remainingByNode = new Map<string, PlacementVector>();
  const nodeById = new Map<string, FleetNodeState>();
  for (const node of getClusterNodeStates(state, cluster)) {
    if (getNodeRuntimeBlocker(state, node)) continue;
    nodeById.set(node.id, node);
    remainingByNode.set(
      node.id,
      subtractPlacementVectors(
        placementVectorFromCapacity(getSafeNodeCapacity(state, cluster, node)),
        existing.get(node.id) ?? createPlacementVector(),
      ),
    );
  }
  if (remainingByNode.size === 0) {
    return { placements: [], blocker: "Cluster has no available managed nodes." };
  }

  const placements: ClusterWorkloadPlacement[] = [];
  const usedDomains = new Set<string>();
  for (const request of [...definition.placementRequests].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  )) {
    const candidates = [...remainingByNode.entries()].flatMap(
      ([nodeId, capacity]) => {
        const node = nodeById.get(nodeId)!;
        const faultDomainId = getFaultDomainId(node, cluster);
        if (
          definition.requiredReplicaDomains > 1 &&
          (!faultDomainId || usedDomains.has(faultDomainId))
        ) {
          return [];
        }
        return [{ id: nodeId, capacity }];
      },
    );
    const result = placeBestFit(candidates, [request]);
    const assignment = result.assignments[0];
    if (!assignment) {
      const distinctDomains = new Set(
        [...nodeById.values()]
          .map((node) => getFaultDomainId(node, cluster))
          .filter((domain): domain is string => domain !== null),
      );
      return {
        placements: [],
        blocker:
          distinctDomains.size < definition.requiredReplicaDomains
            ? `Requires ${definition.requiredReplicaDomains} distinct ${cluster.policy.replicaFaultDomain} fault domains.`
            : "Insufficient cluster compute, memory, storage, or network capacity.",
      };
    }
    const node = nodeById.get(assignment.nodeId)!;
    const faultDomainId = getFaultDomainId(node, cluster) ?? `node:${node.id}`;
    placements.push({
      requestId: request.id,
      nodeId: assignment.nodeId,
      faultDomainId,
      demand: request.demand,
    });
    usedDomains.add(faultDomainId);
    remainingByNode.set(
      assignment.nodeId,
      result.remainingByNode[assignment.nodeId],
    );
  }
  return { placements, blocker: null };
};

export const getClusterWorkloadStartBlockedReason = (
  inputState: GameState,
  clusterId: string,
  definitionId: ClusterWorkloadDefinitionId,
) => {
  const state = normalizeFacilityInfrastructureForGameState(inputState);
  const gate = getClusterManagementBlockedReason(state);
  if (gate) return gate;
  if (getCampaignChapterIndex(state.campaign.currentChapterId) < 4) {
    return "Requires Local Fabric.";
  }
  const cluster = state.infrastructure.clusters.find((item) => item.id === clusterId);
  if (!cluster) return "Cluster does not exist.";
  const definition = definitionById.get(definitionId);
  if (!definition) return "Unknown cluster workload.";
  if (!canAffordExact(state, definition.startCosts)) return "Insufficient resources.";
  const placement = placeClusterWorkload(state, cluster, definition);
  if (placement.blocker) return placement.blocker;
  return getNewWorkloadFacilityAdmissionBlockers(
    state,
    placement.placements,
  )[0] ?? null;
};

export const startClusterWorkload = (
  inputState: GameState,
  clusterId: string,
  definitionId: ClusterWorkloadDefinitionId,
  requestedWeight?: number,
): GameState => {
  const state = normalizeFacilityInfrastructureForGameState(inputState);
  if (getClusterWorkloadStartBlockedReason(state, clusterId, definitionId)) {
    return state;
  }
  const cluster = state.infrastructure.clusters.find((item) => item.id === clusterId)!;
  const definition = getClusterWorkloadDefinition(definitionId);
  const placement = placeClusterWorkload(state, cluster, definition);
  if (placement.blocker) return state;
  const allocation = allocateInfrastructureEntityId(state.infrastructure, "workload");
  if (!allocation) return state;
  const paid = spendExact(state, definition.startCosts);
  const common = {
    id: allocation.id,
    definitionId,
    clusterId,
    weight:
      typeof requestedWeight === "number" && Number.isFinite(requestedWeight)
        ? Math.max(1, Math.min(100, Math.trunc(requestedWeight)))
        : cluster.policy.defaultWeight,
    source: "manual" as const,
    placements: placement.placements,
    operatingCreditsSpent: ZERO_AMOUNT,
    paidWorkUnits: definition.paidWorkUnits,
    workValueMultiplier: definition.workValueMultiplier,
    blockers: [],
  };
  const workload: ClusterWorkloadState =
    definition.kind === "distributed"
      ? {
          ...common,
          kind: "distributed",
          runtime: createDistributedWorkRuntime(
            definition.createPlan(placement.placements),
          ),
        }
      : {
          ...common,
          kind: "capacity",
          runtime: createCapacityWorkRuntime(definition.plan),
        };
  return {
    ...paid,
    infrastructure: {
      ...paid.infrastructure,
      nextEntityId: allocation.nextEntityId,
      workloads: [...(paid.infrastructure.workloads ?? []), workload],
    },
  };
};

export const cancelClusterWorkload = (
  state: GameState,
  workloadId: string,
): GameState => {
  const workload = (state.infrastructure.workloads ?? []).find(
    (item) => item.id === workloadId,
  );
  if (!workload || isWorkloadComplete(workload)) return state;
  return {
    ...state,
    infrastructure: {
      ...state.infrastructure,
      workloads: (state.infrastructure.workloads ?? []).filter(
        (item) => item.id !== workloadId,
      ),
    },
  };
};

export const setClusterWorkloadWeight = (
  state: GameState,
  workloadId: string,
  weight: number,
): GameState => {
  if (!Number.isFinite(weight)) return state;
  const normalizedWeight = Math.max(1, Math.min(100, Math.trunc(weight)));
  return {
    ...state,
    infrastructure: {
      ...state.infrastructure,
      workloads: (state.infrastructure.workloads ?? []).map((workload) =>
        workload.id === workloadId && !isWorkloadComplete(workload)
          ? { ...workload, weight: normalizedWeight }
          : workload,
      ),
    },
  };
};

export const isClusterWorkloadAction = (action: GameAction) =>
  action.type === "startClusterWorkload" ||
  action.type === "cancelClusterWorkload" ||
  action.type === "setClusterWorkloadWeight";

export const applyClusterWorkloadAction = (
  state: GameState,
  action: GameAction,
) => {
  if (action.type === "startClusterWorkload") {
    return startClusterWorkload(
      state,
      action.clusterId,
      action.definitionId,
      action.weight,
    );
  }
  if (action.type === "cancelClusterWorkload") {
    return cancelClusterWorkload(state, action.workloadId);
  }
  if (action.type === "setClusterWorkloadWeight") {
    return setClusterWorkloadWeight(state, action.workloadId, action.weight);
  }
  return state;
};

const getWorkloadStructuralBlockers = (
  state: GameState,
  workload: ClusterWorkloadState,
) => {
  if (isWorkloadComplete(workload)) return [];
  const cluster = state.infrastructure.clusters.find(
    (candidate) => candidate.id === workload.clusterId,
  );
  if (!cluster) return ["Cluster is missing."];
  const clusterNodeIds = new Set(cluster.nodeIds);
  const nodesById = new Map(
    state.infrastructure.fleetNodes.map((node) => [node.id, node]),
  );
  const blockers: string[] = [];
  for (const placement of workload.placements) {
    const node = nodesById.get(placement.nodeId);
    if (!node || !clusterNodeIds.has(placement.nodeId)) {
      blockers.push(`${placement.requestId}: placed node is no longer in the cluster.`);
      continue;
    }
    const runtimeBlocker = getNodeRuntimeBlocker(state, node);
    if (runtimeBlocker) blockers.push(`${placement.requestId}: ${runtimeBlocker}`);
    const available = placementVectorFromCapacity(
      getSafeNodeCapacity(state, cluster, node),
    );
    if (!placementVectorFits(available, placement.demand)) {
      blockers.push(`${placement.requestId}: reserved capacity is unavailable.`);
    }
  }
  const definition = getClusterWorkloadDefinition(workload.definitionId);
  if (definition.requiredReplicaDomains > 1) {
    const currentDomains = new Set(
      workload.placements.flatMap((placement) => {
        const node = nodesById.get(placement.nodeId);
        const domain = node ? getFaultDomainId(node, cluster) : null;
        return domain ? [domain] : [];
      }),
    );
    if (currentDomains.size < definition.requiredReplicaDomains) {
      blockers.push(
        `Requires ${definition.requiredReplicaDomains} distinct ${cluster.policy.replicaFaultDomain} fault domains.`,
      );
    }
  }
  return Array.from(new Set(blockers));
};

const getCapacityFitForWorkload = (
  state: GameState,
  workload: ClusterWorkloadState,
): CapacityWorkFitCapacity => {
  const cluster = state.infrastructure.clusters.find(
    (candidate) => candidate.id === workload.clusterId,
  );
  if (!cluster) return { memoryBits: ZERO_AMOUNT, storageBits: ZERO_AMOUNT };
  const placementNodeIds = new Set(workload.placements.map((placement) => placement.nodeId));
  const profile = sumCapacityProfiles(
    getClusterNodeStates(state, cluster)
      .filter((node) => placementNodeIds.has(node.id) && !getNodeRuntimeBlocker(state, node))
      .map((node) => getSafeNodeCapacity(state, cluster, node)),
  );
  return { memoryBits: profile.memoryBits, storageBits: profile.storageBits };
};

type FacilityDemandVector = ReturnType<typeof createFacilityResourceVector>;

interface FacilityAdmissionLedger {
  facilityDemandById: Map<string, FacilityDemandVector>;
  rackDemandByRef: Map<string, FacilityDemandVector>;
}

const createFacilityAdmissionLedger = (): FacilityAdmissionLedger => ({
  facilityDemandById: new Map(),
  rackDemandByRef: new Map(),
});

const placementFacilityDemand = (
  placement: ClusterWorkloadPlacement,
): FacilityDemandVector =>
  createFacilityResourceVector({
    compute: placement.demand.compute,
    memoryBits: placement.demand.memoryBits,
    storageBits: placement.demand.storageBits,
    uplinkIngress: placement.demand.networkIngress,
    uplinkEgress: placement.demand.networkEgress,
  });

const addDemandToMap = (
  demands: Map<string, FacilityDemandVector>,
  key: string,
  demand: FacilityDemandVector,
) =>
  demands.set(
    key,
    addFacilityResourceVectors(
      demands.get(key) ?? createFacilityResourceVector(),
      demand,
    ),
  );

const attemptFacilityAdmission = (
  state: ReturnType<typeof normalizeFacilityInfrastructureForGameState>,
  placements: readonly ClusterWorkloadPlacement[],
  ledger: FacilityAdmissionLedger,
) => {
  const facilitiesById = new Map<string, FacilityState>(
    state.infrastructure.facilities.map((facility) => [facility.id, facility]),
  );
  const nodesById = new Map(
    state.infrastructure.fleetNodes.map((node) => [node.id, node]),
  );
  const facilityDemand = new Map<string, FacilityDemandVector>();
  const rackDemand = new Map<string, FacilityDemandVector>();
  const rackByRef = new Map<
    string,
    { facility: FacilityState; rackId: string }
  >();
  const blockers: string[] = [];

  for (const placement of placements) {
    const node = nodesById.get(placement.nodeId);
    const rackRef = parseQualifiedRackRef(node?.rackId);
    if (!rackRef) continue;
    const facility = facilitiesById.get(rackRef.facilityId);
    const rack = facility?.racks.find((item) => item.id === rackRef.rackId);
    if (!facility || !rack) {
      blockers.push(`${placement.requestId}: qualified facility rack is unavailable.`);
      continue;
    }
    const qualifiedRef = `${rackRef.facilityId}/${rackRef.rackId}`;
    const demand = placementFacilityDemand(placement);
    addDemandToMap(facilityDemand, rackRef.facilityId, demand);
    addDemandToMap(rackDemand, qualifiedRef, demand);
    rackByRef.set(qualifiedRef, { facility, rackId: rackRef.rackId });
  }

  for (const [qualifiedRef, demand] of [...rackDemand].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const scope = rackByRef.get(qualifiedRef)!;
    const rack = scope.facility.racks.find((item) => item.id === scope.rackId)!;
    const projectedDemand = addFacilityResourceVectors(
      ledger.rackDemandByRef.get(qualifiedRef) ?? createFacilityResourceVector(),
      demand,
    );
    blockers.push(
      ...getRackDemandAdmissionBlockers(rack, projectedDemand).map(
        (blocker) => blocker.message,
      ),
    );
  }
  for (const [facilityId, demand] of [...facilityDemand].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const facility = facilitiesById.get(facilityId)!;
    const projectedDemand = addFacilityResourceVectors(
      ledger.facilityDemandById.get(facilityId) ??
        createFacilityResourceVector(),
      demand,
    );
    blockers.push(
      ...getFacilityDemandAdmissionBlockers(facility, projectedDemand).map(
        (blocker) => blocker.message,
      ),
    );
  }

  const uniqueBlockers = Array.from(new Set(blockers));
  if (uniqueBlockers.length > 0) {
    return { accepted: false, blockers: uniqueBlockers, ledger };
  }
  const nextLedger: FacilityAdmissionLedger = {
    facilityDemandById: new Map(ledger.facilityDemandById),
    rackDemandByRef: new Map(ledger.rackDemandByRef),
  };
  for (const [facilityId, demand] of facilityDemand) {
    addDemandToMap(nextLedger.facilityDemandById, facilityId, demand);
  }
  for (const [qualifiedRef, demand] of rackDemand) {
    addDemandToMap(nextLedger.rackDemandByRef, qualifiedRef, demand);
  }
  return { accepted: true, blockers: [], ledger: nextLedger };
};

const getNewWorkloadFacilityAdmissionBlockers = (
  state: ReturnType<typeof normalizeFacilityInfrastructureForGameState>,
  placements: readonly ClusterWorkloadPlacement[],
) => {
  let ledger = createFacilityAdmissionLedger();
  for (const workload of state.infrastructure.workloads ?? []) {
    if (isWorkloadComplete(workload)) continue;
    if (getWorkloadStructuralBlockers(state, workload).length > 0) continue;
    const admission = attemptFacilityAdmission(state, workload.placements, ledger);
    if (admission.accepted) ledger = admission.ledger;
  }
  return attemptFacilityAdmission(state, placements, ledger).blockers;
};

interface WorkloadRuntimeContext {
  workload: ClusterWorkloadState;
  definition: ClusterWorkloadDefinition;
  allocatedRates: RateVector;
  fitCapacity: CapacityWorkFitCapacity;
  blockers: string[];
  eventMs: Amount | null;
}

const getWorkloadAutomationBlocker = (
  state: GameState,
  workload: ClusterWorkloadState,
  mode: AdvanceMode,
) => {
  if (mode !== "offline") return null;
  const departureLevelIndex = getAutomationBufferLevelIndex(
    state.automationBuffer.departureLevelId,
  );
  if (
    departureLevelIndex < getAutomationBufferLevelIndex("clusterController")
  ) {
    return "Cluster Controller automation is required for distributed workloads.";
  }
  const facilityBacked =
    getProductiveFacilitiesForNodeIds(
      state,
      workload.placements.map((placement) => placement.nodeId),
    ).length > 0;
  return facilityBacked &&
    departureLevelIndex < getAutomationBufferLevelIndex("rackController")
    ? "Rack Controller automation is required for facility-backed workloads."
    : null;
};

const getWorkloadRuntimeContexts = (
  inputState: GameState,
  mode: AdvanceMode = "foreground",
) => {
  const state = normalizeFacilityInfrastructureForGameState(inputState);
  const contexts = new Map<string, WorkloadRuntimeContext>();
  const candidatesByCluster = new Map<string, ClusterWorkloadState[]>();
  let facilityAdmissionLedger = createFacilityAdmissionLedger();
  for (const workload of state.infrastructure.workloads ?? []) {
    const definition = getClusterWorkloadDefinition(workload.definitionId);
    const fitCapacity = getCapacityFitForWorkload(state, workload);
    const automationBlocker = isWorkloadComplete(workload)
      ? null
      : getWorkloadAutomationBlocker(state, workload, mode);
    const structuralBlockers = [
      ...getWorkloadStructuralBlockers(state, workload),
      ...(automationBlocker ? [automationBlocker] : []),
    ];
    const clusterCostBlocked =
      !isWorkloadComplete(workload) &&
      amountCompare(definition.operatingCreditsPerSecond, 0) > 0 &&
      amountCompare(state.exactResources.credits, 0) <= 0;
    const facilityCostBlocked =
      !isWorkloadComplete(workload) &&
      amountCompare(
        getFacilityOperatingCostPerSecondForNodeIds(
          state,
          workload.placements.map((placement) => placement.nodeId),
        ),
        0,
      ) > 0 &&
      amountCompare(state.exactResources.credits, 0) <= 0;
    let blockers = clusterCostBlocked
      ? [...structuralBlockers, "Insufficient credits for cluster operating cost."]
      : facilityCostBlocked
        ? [...structuralBlockers, "Insufficient credits for facility operating cost."]
        : structuralBlockers;
    if (!isWorkloadComplete(workload) && blockers.length === 0) {
      const admission = attemptFacilityAdmission(
        state,
        workload.placements,
        facilityAdmissionLedger,
      );
      blockers = admission.blockers;
      if (admission.accepted) facilityAdmissionLedger = admission.ledger;
    }
    contexts.set(workload.id, {
      workload,
      definition,
      allocatedRates: createRateVector(),
      fitCapacity,
      blockers,
      eventMs: null,
    });
    if (!isWorkloadComplete(workload) && blockers.length === 0) {
      candidatesByCluster.set(workload.clusterId, [
        ...(candidatesByCluster.get(workload.clusterId) ?? []),
        workload,
      ]);
    }
  }

  for (const [clusterId, workloads] of candidatesByCluster) {
    const cluster = state.infrastructure.clusters.find((item) => item.id === clusterId);
    if (!cluster) continue;
    const capacity = getClusterSafeCapacity(state, cluster).rates;
    const fair = allocateWeightedMaxMin(
      capacity,
      workloads.map((workload) => {
        const definition = getClusterWorkloadDefinition(workload.definitionId);
        return {
          id: workload.id,
          demand: definition.serviceDemand,
          weight: amount(workload.weight),
          maxAllocation: amount(1),
        };
      }),
    );
    for (const workload of workloads) {
      const context = contexts.get(workload.id)!;
      const scalar = fair.allocationByWorkload[workload.id] ?? ZERO_AMOUNT;
      const allocatedRates = scaleRateVector(context.definition.serviceDemand, scalar);
      const rateBlocked = isEmptyRateVector(allocatedRates);
      const runtimeBlockers = rateBlocked
        ? ["No weighted-fair cluster capacity is available."]
        : [];
      let eventMs: Amount | null = null;
      if (!rateBlocked) {
        eventMs =
          workload.kind === "distributed"
            ? getNextDistributedEventMs(workload.runtime, allocatedRates)
            : getNextCapacityWorkEventMs(
                workload.runtime,
                allocatedRates,
                context.fitCapacity,
              );
      }
      contexts.set(workload.id, {
        ...context,
        allocatedRates,
        blockers: runtimeBlockers,
        eventMs,
      });
    }
  }
  return contexts;
};

export const getClusterWorkloadAllocatedRates = (state: GameState) =>
  Object.fromEntries(
    [...getWorkloadRuntimeContexts(state)].map(([id, context]) => [
      id,
      context.allocatedRates,
    ]),
  ) as Record<string, RateVector>;

/** Stable node identities servicing work that can actually advance this slice. */
export const getRunnableClusterNodeIds = (
  state: GameState,
  mode: AdvanceMode = "foreground",
) =>
  !hasActiveClusterWorkloads(state)
    ? []
    : Array.from(
    new Set(
      [...getWorkloadRuntimeContexts(state, mode).values()]
        .filter(
          (context) => context.eventMs !== null && context.blockers.length === 0,
        )
        .flatMap((context) =>
          context.workload.placements.map((placement) => placement.nodeId),
        ),
    ),
  ).sort();

const getContextNodeIds = (
  contexts: readonly WorkloadRuntimeContext[],
) =>
  new Set(
    contexts.flatMap((context) =>
      context.workload.placements.map((placement) => placement.nodeId),
    ),
  );

const getOperatingCostPerSecondForContexts = (
  state: GameState,
  contexts: readonly WorkloadRuntimeContext[],
) =>
  amountAdd(
    sumAmounts(
      contexts.map((context) => context.definition.operatingCreditsPerSecond),
    ),
    getFacilityOperatingCostPerSecondForNodeIds(
      state,
      getContextNodeIds(contexts),
    ),
  );

/** Stable facility identities already billed by productive cluster work. */
export const getProductiveClusterFacilityIds = (
  state: GameState,
  mode: AdvanceMode = "foreground",
) => {
  if (!hasActiveClusterWorkloads(state)) return [];
  const contexts = [...getWorkloadRuntimeContexts(state, mode).values()].filter(
    (context) => context.eventMs !== null && context.blockers.length === 0,
  );
  return getProductiveFacilitiesForNodeIds(
    state,
    getContextNodeIds(contexts),
  ).map((facility) => facility.id);
};

/** Exact shared cluster plus deduplicated productive-facility operating rate. */
export const getClusterWorkloadOperatingCostPerSecond = (
  state: GameState,
  mode: AdvanceMode = "foreground",
) => {
  if (!hasActiveClusterWorkloads(state)) return ZERO_AMOUNT;
  const contexts = [...getWorkloadRuntimeContexts(state, mode).values()].filter(
    (context) => context.eventMs !== null && context.blockers.length === 0,
  );
  return getOperatingCostPerSecondForContexts(state, contexts);
};

const getNextRuntimeOrCreditEventMs = (
  state: GameState,
  mode: AdvanceMode,
) => {
  const contexts = [...getWorkloadRuntimeContexts(state, mode).values()].filter(
    (context) => context.eventMs !== null && context.blockers.length === 0,
  );
  if (contexts.length === 0) return null;
  let eventMs = contexts.reduce<Amount | null>(
    (minimum, context) =>
      minimum === null || amountCompare(context.eventMs!, minimum) < 0
        ? context.eventMs
        : minimum,
    null,
  );
  const totalCostPerSecond = getOperatingCostPerSecondForContexts(state, contexts);
  if (amountCompare(totalCostPerSecond, 0) > 0) {
    const creditRunwayMs = amountMultiply(
      amountDivide(state.exactResources.credits, totalCostPerSecond),
      1000,
    );
    eventMs = eventMs === null ? creditRunwayMs : amountMin(eventMs, creditRunwayMs);
  }
  return eventMs;
};

export const getNextClusterWorkloadEventMs = (
  state: GameState,
  mode: AdvanceMode = "foreground",
) =>
  hasActiveClusterWorkloads(state)
    ? getNextRuntimeOrCreditEventMs(state, mode)
    : null;

const recordClusterCompletion = (
  state: GameState,
  workload: ClusterWorkloadState,
  rewards: ExactResourceBag,
) => {
  const replicaFaultDomainCount = new Set(
    workload.placements.map((placement) => placement.faultDomainId),
  ).size;
  const sequence = state.infrastructure.nextCompletionSequence ?? 1;
  const completedCount =
    state.infrastructure.completedWorkloadCounts?.[workload.definitionId] ?? 0;
  const shardCommit = workload.definitionId === "replicatedShardCommit";
  return addExactRewards(
    {
      ...state,
      infrastructure: {
        ...state.infrastructure,
        nextCompletionSequence: sequence + 1,
        completedWorkloadCounts: {
          ...state.infrastructure.completedWorkloadCounts,
          [workload.definitionId]: completedCount + 1,
        },
        successfulShardCommits:
          (state.infrastructure.successfulShardCommits ?? 0) +
          (shardCommit ? 1 : 0),
        replicaDomainCommits:
          (state.infrastructure.replicaDomainCommits ?? 0) +
          (shardCommit && replicaFaultDomainCount >= 2 ? 1 : 0),
        completionEvents: [
          ...(state.infrastructure.completionEvents ?? []),
          {
            sequence,
            instanceId: workload.id,
            definitionId: workload.definitionId,
            clusterId: workload.clusterId,
            source: workload.source,
            rewards,
            replicaFaultDomainCount,
          },
        ].slice(-256),
      },
    },
    rewards,
  );
};

export const advanceClusterWorkloads = (
  inputState: GameState,
  deltaMs: number,
  mode: AdvanceMode = "foreground",
): GameState => {
  const elapsedMs = Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0);
  let state = normalizeFacilityInfrastructureForGameState(inputState);
  let remainingMs = amount(elapsedMs);
  let guard = 0;

  while (amountCompare(remainingMs, 0) > 0 && guard < 10_000) {
    guard += 1;
    const contexts = [...getWorkloadRuntimeContexts(state, mode).values()].filter(
      (context) => context.eventMs !== null && context.blockers.length === 0,
    );
    if (contexts.length === 0) break;
    const boundary = getNextRuntimeOrCreditEventMs(state, mode);
    if (boundary === null) break;
    const stepMs = amountMin(remainingMs, boundary);
    const individualCosts = new Map(
      contexts.map((context) => [
        context.workload.id,
        amountDivide(
          amountMultiply(context.definition.operatingCreditsPerSecond, stepMs),
          1000,
        ),
      ]),
    );
    const facilityCost = amountDivide(
      amountMultiply(
        getFacilityOperatingCostPerSecondForNodeIds(
          state,
          getContextNodeIds(contexts),
        ),
        stepMs,
      ),
      1000,
    );
    const totalCost = amountAdd(
      sumAmounts([...individualCosts.values()]),
      facilityCost,
    );
    if (amountCompare(totalCost, state.exactResources.credits) > 0) break;
    if (amountCompare(totalCost, 0) > 0) {
      state = spendExact(state, [exactCost("credits", totalCost)]);
    }

    const updates = new Map<string, ClusterWorkloadState>();
    const completions: Array<{
      workload: ClusterWorkloadState;
      rewards: ExactResourceBag;
    }> = [];
    let changedAtZeroBoundary = false;
    for (const context of contexts) {
      const operatingCost = individualCosts.get(context.workload.id) ?? ZERO_AMOUNT;
      if (context.workload.kind === "distributed") {
        const result = advanceDistributedWork(
          context.workload.runtime,
          context.allocatedRates,
          stepMs,
        );
        const updated: ClusterWorkloadState = {
          ...context.workload,
          runtime: result.runtime,
          operatingCreditsSpent: amountAdd(
            context.workload.operatingCreditsSpent,
            operatingCost,
          ),
        };
        updates.set(updated.id, updated);
        if (result.committed) {
          completions.push({
            workload: updated,
            rewards: getClusterWorkloadSettlement(
              updated,
              context.definition,
            ).rewards,
          });
        }
        changedAtZeroBoundary ||= result.committed;
      } else {
        const result = advanceCapacityWork(
          context.workload.runtime,
          context.allocatedRates,
          context.fitCapacity,
          stepMs,
        );
        const updated: ClusterWorkloadState = {
          ...context.workload,
          runtime: result.runtime,
          operatingCreditsSpent: amountAdd(
            context.workload.operatingCreditsSpent,
            operatingCost,
          ),
        };
        updates.set(updated.id, updated);
        if (result.completed) {
          completions.push({
            workload: updated,
            rewards: getClusterWorkloadSettlement(
              updated,
              context.definition,
            ).rewards,
          });
        }
        changedAtZeroBoundary ||= result.completed;
      }
    }
    state = {
      ...state,
      infrastructure: {
        ...state.infrastructure,
        workloads: (state.infrastructure.workloads ?? []).map(
          (workload) => updates.get(workload.id) ?? workload,
        ),
      },
    };
    for (const completion of completions) {
      state = recordClusterCompletion(state, completion.workload, completion.rewards);
    }
    remainingMs = amountSubtract(remainingMs, stepMs);
    if (amountCompare(stepMs, 0) === 0 && !changedAtZeroBoundary) break;
  }

  const finalContexts = getWorkloadRuntimeContexts(state, mode);
  return {
    ...state,
    infrastructure: {
      ...state.infrastructure,
      elapsedMs: state.infrastructure.elapsedMs + elapsedMs,
      workloads: (state.infrastructure.workloads ?? []).map((workload) => ({
        ...workload,
        blockers: isWorkloadComplete(workload)
          ? []
          : (finalContexts.get(workload.id)?.blockers ?? workload.blockers),
      })),
    },
  };
};

const projectDistributedDurationMs = (
  runtime: Extract<ClusterWorkloadState, { kind: "distributed" }>["runtime"],
  rates: RateVector,
) => {
  let projected = runtime;
  let durationMs = ZERO_AMOUNT;
  for (let guard = 0; guard < 100; guard += 1) {
    if (projected.rewardIssued) return durationMs;
    const eventMs = getNextDistributedEventMs(projected, rates);
    if (eventMs === null) return null;
    const result = advanceDistributedWork(projected, rates, eventMs);
    projected = result.runtime;
    durationMs = amountAdd(durationMs, eventMs);
    if (amountCompare(eventMs, 0) === 0 && !result.committed) {
      const next = getNextDistributedEventMs(projected, rates);
      if (next !== null && amountCompare(next, 0) === 0) return null;
    }
  }
  return null;
};

const projectionFromDuration = (
  workload: ClusterWorkloadState,
  rewardCredits: Amount,
  operatingCreditsPerSecond: Amount,
  durationMs: Amount | null,
  bufferMs: Amount,
  pauseReason: string | null,
): VisibleClusterWorkloadProjection => {
  if (isWorkloadComplete(workload)) {
    return {
      durationMs: ZERO_AMOUNT,
      operatingCost: ZERO_AMOUNT,
      netCreditReward: ZERO_AMOUNT,
      marginBps: null,
      bufferCovered: true,
      pauseReason: "completed",
    };
  }
  if (durationMs === null) {
    return {
      durationMs: null,
      operatingCost: null,
      netCreditReward: null,
      marginBps: null,
      bufferCovered: false,
      pauseReason,
    };
  }
  const operatingCost = amountDivide(
    amountMultiply(operatingCreditsPerSecond, durationMs),
    1000,
  );
  const netCreditReward = amountSubtract(rewardCredits, operatingCost);
  const exactMarginBps = getExactWorkMarginBps(
    netCreditReward,
    rewardCredits,
  );
  const bufferCovered = amountCompare(durationMs, bufferMs) <= 0;
  return {
    durationMs,
    operatingCost,
    netCreditReward,
    marginBps: projectWorkMarginBps(exactMarginBps),
    bufferCovered,
    pauseReason: bufferCovered ? pauseReason : "automation-buffer",
  };
};

const getProgressBps = (workload: ClusterWorkloadState) => {
  if (isWorkloadComplete(workload)) return 10_000;
  let total = ZERO_AMOUNT;
  let completed = ZERO_AMOUNT;
  if (workload.kind === "capacity") {
    total = sumAmounts(exactRateResourceIds.map((resource) => workload.runtime.plan.work[resource]));
    completed = sumAmounts(
      exactRateResourceIds.map((resource) =>
        amountSubtract(
          workload.runtime.plan.work[resource],
          workload.runtime.remainingWork[resource],
        ),
      ),
    );
  } else {
    const progress = getDistributedProgress(workload.runtime);
    completed = sumAmounts(exactRateResourceIds.map((resource) => progress[resource]));
    const plan = workload.runtime.plan;
    total = sumAmounts([
      ...plan.shards.flatMap((shard) => [
        ...exactRateResourceIds.map((resource) => shard.transferWork[resource]),
        ...exactRateResourceIds.map((resource) => shard.computeWork[resource]),
      ]),
      ...exactRateResourceIds.map((resource) => plan.reduce.work[resource]),
      ...exactRateResourceIds.map((resource) => plan.commit.work[resource]),
    ]);
  }
  if (amountCompare(total, 0) <= 0) return 0;
  return Math.max(
    0,
    Math.min(
      10_000,
      Math.round(
        amountToSafeNumber(amountMultiply(amountDivide(completed, total), 10_000)),
      ),
    ),
  );
};

const placementStaticProfile = (workload: ClusterWorkloadState) => ({
  ...createEmptyCapacityProfile(),
  memoryBits: sumAmounts(
    workload.placements.map((placement) => placement.demand.memoryBits),
  ),
  storageBits: sumAmounts(
    workload.placements.map((placement) => placement.demand.storageBits),
  ),
});

const getReservedProfiles = (
  state: GameState,
  contexts: Map<string, WorkloadRuntimeContext>,
) => {
  const profiles = new Map<string, CapacityProfile>();
  for (const workload of state.infrastructure.workloads ?? []) {
    if (isWorkloadComplete(workload)) continue;
    const context = contexts.get(workload.id);
    const staticProfile = placementStaticProfile(workload);
    const profile: CapacityProfile = {
      ...staticProfile,
      rates: context?.allocatedRates ?? createRateVector(),
    };
    profiles.set(
      workload.clusterId,
      sumCapacityProfiles([
        profiles.get(workload.clusterId) ?? createEmptyCapacityProfile(),
        profile,
      ]),
    );
  }
  return profiles;
};

export const getVisibleInfrastructureWithWorkloads = (
  state: GameState,
): VisibleInfrastructureState => {
  const base = getVisibleInfrastructureState(state);
  const contexts = getWorkloadRuntimeContexts(state);
  const reservedByCluster = getReservedProfiles(state, contexts);
  const allReserved = sumCapacityProfiles([...reservedByCluster.values()]);
  const bufferMs = amount(
    getAutomationBufferDefinition(state.automationBuffer.ownedLevelId).maxOfflineMs,
  );
  const workloads: VisibleClusterWorkload[] = (state.infrastructure.workloads ?? []).map(
    (workload) => {
      const definition = getClusterWorkloadDefinition(workload.definitionId);
      const settlement = getClusterWorkloadSettlement(workload, definition);
      const { paidWorkUnits, workValueMultiplier, rewards: frozenRewards } =
        settlement;
      const context = contexts.get(workload.id);
      const blockers = isWorkloadComplete(workload)
        ? []
        : (context?.blockers ?? workload.blockers);
      const projectedOperatingCreditsPerSecond = amountAdd(
        definition.operatingCreditsPerSecond,
        getFacilityOperatingCostPerSecondForNodeIds(
          state,
          workload.placements.map((placement) => placement.nodeId),
        ),
      );
      let projection: VisibleClusterWorkloadProjection;
      if (workload.kind === "capacity" && context) {
        const projected = projectCapacityWorkRuntime(
          workload.runtime,
          createWorkProjectionConditions({
            allocatedRates: context.allocatedRates,
            memoryBits: context.fitCapacity.memoryBits,
            storageBits: context.fitCapacity.storageBits,
            operatingCreditsPerSecond: projectedOperatingCreditsPerSecond,
            automationBufferMs: bufferMs,
          }),
        );
        projection = {
          durationMs: projected.durationMs,
          operatingCost: projected.operatingCost,
          netCreditReward: projected.netCreditReward,
          marginBps: projected.marginBps,
          bufferCovered: projected.bufferCovered,
          pauseReason: blockers[0] ?? projected.pauseReason,
        };
      } else {
        const durationMs =
          workload.kind === "distributed" && context && blockers.length === 0
            ? projectDistributedDurationMs(workload.runtime, context.allocatedRates)
            : null;
        projection = projectionFromDuration(
          workload,
          frozenRewards.credits,
          projectedOperatingCreditsPerSecond,
          durationMs,
          bufferMs,
          blockers[0] ?? null,
        );
      }
      return {
        id: workload.id,
        definitionId: workload.definitionId,
        clusterId: workload.clusterId,
        kind: workload.kind,
        name: definition.name,
        weight: workload.weight,
        source: workload.source,
        status: isWorkloadComplete(workload)
          ? "completed"
          : blockers.length > 0
            ? "paused"
            : "running",
        progressBps: getProgressBps(workload),
        placements: workload.placements,
        blockers,
        rewards: frozenRewards,
        paidWorkUnits,
        workValueMultiplier,
        operatingCreditsSpent: workload.operatingCreditsSpent,
        projection,
      };
    },
  );
  const clusters = base.clusters.map((cluster) => {
    const reserved = reservedByCluster.get(cluster.id) ?? createEmptyCapacityProfile();
    const available = subtractCapacityProfiles(cluster.available, reserved);
    const unavailable = subtractCapacityProfiles(cluster.total, available);
    const relatedBlockers = workloads
      .filter((workload) => workload.clusterId === cluster.id)
      .flatMap((workload) =>
        workload.blockers.map((blocker) => `${workload.name}: ${blocker}`),
      );
    return {
      ...cluster,
      reserved,
      available,
      utilizationBps: getCapacityUtilizationBps(cluster.total, reserved),
      headroomBps: Math.max(
        0,
        10_000 - getCapacityUtilizationBps(cluster.total, unavailable),
      ),
      blockers: Array.from(new Set([...cluster.blockers, ...relatedBlockers])),
    };
  });
  const fleetAvailable = subtractCapacityProfiles(base.fleet.available, allReserved);
  const fleetUnavailable = subtractCapacityProfiles(base.fleet.total, fleetAvailable);
  return {
    ...base,
    fleet: {
      ...base.fleet,
      reserved: allReserved,
      available: fleetAvailable,
      utilizationBps: getCapacityUtilizationBps(base.fleet.total, allReserved),
      headroomBps: Math.max(
        0,
        10_000 - getCapacityUtilizationBps(base.fleet.total, fleetUnavailable),
      ),
    },
    clusters,
    workloads,
    workloadDefinitions: clusterWorkloadDefinitions.map((definition) => ({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      kind: definition.kind,
      startCosts: definition.startCosts,
      rewards: definition.rewards,
      paidWorkUnits: definition.paidWorkUnits,
      workValueMultiplier: definition.workValueMultiplier,
      operatingCreditsPerSecond: definition.operatingCreditsPerSecond,
      clusterOptions: state.infrastructure.clusters.map((cluster) => {
        const blockedReason = getClusterWorkloadStartBlockedReason(
          state,
          cluster.id,
          definition.id,
        );
        return {
          clusterId: cluster.id,
          canStart: blockedReason === null,
          blockedReason,
        };
      }),
    })),
  };
};

export const hasRunnableClusterWorkloads = (
  state: GameState,
  mode: AdvanceMode = "foreground",
) =>
  [...getWorkloadRuntimeContexts(state, mode).values()].some(
    (context) => context.eventMs !== null && context.blockers.length === 0,
  );

export const isRecommendedClusterWorkload = (
  state: GameState,
  workloadId: string,
) => {
  const visible = getVisibleInfrastructureWithWorkloads(state).workloads.find(
    (workload) => workload.id === workloadId,
  );
  if (!visible?.projection.netCreditReward) return false;
  return (
    compareWorkMarginToBps(
      visible.projection.netCreditReward,
      visible.rewards.credits,
      3_000,
    ) >= 0
  );
};
