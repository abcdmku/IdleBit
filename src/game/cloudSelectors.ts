import {
  ZERO_AMOUNT,
  amountCompare,
  amountDivide,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  type Amount,
  type ExactResourceBag,
} from "./amount";
import {
  cloudSlaDefinitions,
  getCloudRoutingSnapshot,
  getCloudSlaBlockedReason,
  hasPositiveCloudRoutingFlow,
  normalizeCloudState,
  type CloudRegionState,
  type CloudSlaDefinitionId,
  type CloudState,
} from "./cloud";
import {
  getCloudSlaProjection,
  getCloudSlaGameBlockedReason,
  getPlanetaryFinaleBlockedReason,
  type CloudSlaProjection,
} from "./cloudGame";
import type { RoutingEdge } from "./routing";
import { evaluateSlaWindow, type SlaEvaluation } from "./sla";
import type { FinaleCharterId, GameState } from "./types";
import {
  createWorkValueMultiplier,
  type WorkValueMultiplier,
} from "./workValue";

export interface VisibleCloudZone {
  id: string;
  name: string;
  regionId: string;
  regionName: string;
  facilityId: string;
  faultDomainId: string;
  status: "online" | "derated" | "paused";
  capacityBps: number;
  baseCapacityPerSecond: Amount;
  effectiveCapacityPerSecond: Amount;
  baseLatencyMs: number;
  replicaCount: number;
  healthyReplicaCount: number;
  active: boolean;
  failoverPending: boolean;
}

export interface VisibleCloudRegion {
  id: string;
  name: string;
  zoneCount: number;
  demandPerSecond: Amount;
  routedSupplyPerSecond: Amount;
  fulfilledPerSecond: Amount;
  covered: boolean;
}

export interface VisibleCloudSlaDefinition {
  id: CloudSlaDefinitionId;
  name: string;
  description: string;
  observationWindowMs: number;
  workRequired: Amount;
  workValueMultiplier: WorkValueMultiplier;
  rewards: ExactResourceBag;
  canStart: boolean;
  blockedReason: string | null;
  projection: CloudSlaProjection | null;
}

export interface VisibleActiveCloudSla {
  id: string;
  definitionId: CloudSlaDefinitionId;
  name: string;
  observationElapsedMs: number;
  observationRemainingMs: number;
  workCompleted: Amount;
  workRequired: Amount;
  workValueMultiplier: WorkValueMultiplier;
  charterRewardMultiplier: WorkValueMultiplier;
  evaluation: SlaEvaluation;
}

export interface VisibleFinaleCharter {
  id: FinaleCharterId;
  name: string;
  description: string;
  selected: boolean;
  canSelect: boolean;
}

export interface VisibleCloudState {
  elapsedMs: number;
  regions: VisibleCloudRegion[];
  zones: VisibleCloudZone[];
  routing: {
    requestedPerSecond: Amount;
    deliveredPerSecond: Amount;
    unmetPerSecond: Amount;
    totalCostPerSecond: Amount;
    p95LatencyMs: number | null;
    connectedRegionIds: string[];
    links: RoutingEdge[];
  };
  failover: CloudState["failover"];
  automaticFailover: boolean;
  failoverDelayMs: number;
  incidents: CloudState["incidents"];
  slaDefinitions: VisibleCloudSlaDefinition[];
  activeSla: VisibleActiveCloudSla | null;
  completedSlas: CloudState["completedSlas"];
  finale: {
    started: boolean;
    complete: boolean;
    canStart: boolean;
    blockedReason: string | null;
    phaseId: string | null;
    phaseName: string | null;
    phaseIndex: number;
    phaseContribution: Amount;
    phaseContributionRequired: Amount;
    totalContribution: Amount;
    connectedRegionIds: string[];
    remainingMs: number | null;
  };
  charters: VisibleFinaleCharter[];
  postgameUnlocked: boolean;
}

const charterDefinitions: ReadonlyArray<
  Omit<VisibleFinaleCharter, "selected" | "canSelect">
> = [
  {
    id: "resilience",
    name: "Resilience",
    description: "Faster failover and safer recovery across fault domains.",
  },
  {
    id: "efficiency",
    name: "Efficiency",
    description: "Lower operating cost and more usable cooling capacity.",
  },
  {
    id: "openCompute",
    name: "Open Compute",
    description: "Higher postgame contract value with shared capacity reserved.",
  },
];

const regionName = (
  regions: readonly CloudRegionState[],
  regionId: string,
) => regions.find((region) => region.id === regionId)?.name ?? regionId;

export const getVisibleCloudState = (
  input: CloudState,
  gameState?: GameState,
): VisibleCloudState => {
  const state = normalizeCloudState(input);
  const routing = getCloudRoutingSnapshot(state);
  const effectiveZoneById = new Map(
    routing.effectiveZones.map((zone) => [zone.id, zone]),
  );
  const demandByRegion = new Map(
    state.regionalDemands.map((demand) => [demand.regionId, demand.demand]),
  );

  const zones: VisibleCloudZone[] = state.zones.map((zone) => {
    const effective = effectiveZoneById.get(zone.id)!;
    const replicas = state.replicas.filter(
      (replica) => replica.zoneId === zone.id,
    );
    return {
      id: zone.id,
      name: zone.name,
      regionId: zone.regionId,
      regionName: regionName(state.regions, zone.regionId),
      facilityId: zone.facilityId,
      faultDomainId: zone.faultDomainId,
      status: effective.status,
      capacityBps: effective.capacityBps,
      baseCapacityPerSecond: zone.capacityPerSecond,
      effectiveCapacityPerSecond: amountDivide(
        amountMultiply(zone.capacityPerSecond, effective.capacityBps),
        10_000,
      ),
      baseLatencyMs: zone.baseLatencyMs,
      replicaCount: replicas.length,
      healthyReplicaCount: replicas.filter((replica) => replica.healthy).length,
      active: state.failover.activeZoneId === zone.id,
      failoverPending: state.failover.pendingZoneId === zone.id,
    };
  });

  const regions: VisibleCloudRegion[] = state.regions.map((region) => {
    const fulfilled =
      routing.result.fulfilledByRegion[region.id] ?? ZERO_AMOUNT;
    return {
      id: region.id,
      name: region.name,
      zoneCount: state.zones.filter((zone) => zone.regionId === region.id).length,
      demandPerSecond:
        demandByRegion.get(region.id) ?? ZERO_AMOUNT,
      routedSupplyPerSecond:
        routing.result.suppliedByRegion[region.id] ?? ZERO_AMOUNT,
      fulfilledPerSecond: fulfilled,
      covered: amountCompare(fulfilled, 0) > 0,
    };
  });

  const activeDefinition = state.activeSla
    ? cloudSlaDefinitions.find(
        (definition) => definition.id === state.activeSla?.definitionId,
      ) ?? null
    : null;
  const activeSla =
    state.activeSla && activeDefinition
      ? {
          id: state.activeSla.id,
          definitionId: state.activeSla.definitionId,
          name: activeDefinition.name,
          observationElapsedMs: state.activeSla.observationElapsedMs,
          observationRemainingMs: Math.max(
            0,
            activeDefinition.observationWindowMs -
              state.activeSla.observationElapsedMs,
          ),
          workCompleted: state.activeSla.workCompleted,
          workRequired:
            state.activeSla.paidWorkUnits ?? activeDefinition.workRequired,
          workValueMultiplier:
            state.activeSla.workValueMultiplier ??
            activeDefinition.workValueMultiplier,
          charterRewardMultiplier:
            state.activeSla.charterRewardMultiplier ??
            createWorkValueMultiplier("cloud-charter-standard", 10_000),
          evaluation: evaluateSlaWindow(
            state.activeSla.window,
            activeDefinition.policy,
          ),
        }
      : null;

  const currentPhase =
    state.finale && !state.finale.complete
      ? state.finale.plan.phases[state.finale.phaseIndex] ?? null
      : null;
  const finaleComplete = state.finale?.complete === true;
  const finaleRoutingReady = hasPositiveCloudRoutingFlow(routing, 4);
  const finaleRemainingMs =
    state.finale &&
    currentPhase &&
    finaleRoutingReady &&
    routing.connectedRegionIds.length >= currentPhase.requiredRegionCount &&
    amountCompare(routing.contributionPerSecond, 0) > 0
      ? amountToSafeNumber(
          amountMultiply(
            amountDivide(
              amountSubtract(
                currentPhase.contributionRequired,
                state.finale.phaseContribution,
              ),
              routing.contributionPerSecond,
            ),
            1_000,
          ),
        )
      : null;

  const finaleBlockedReason = gameState
    ? getPlanetaryFinaleBlockedReason(gameState)
    : "Game state is required to evaluate the planetary finale gate.";

  return {
    elapsedMs: state.elapsedMs,
    regions,
    zones,
    routing: {
      requestedPerSecond: routing.result.requested,
      deliveredPerSecond: routing.result.delivered,
      unmetPerSecond: routing.result.unmet,
      totalCostPerSecond: routing.result.totalCost,
      p95LatencyMs: routing.result.p95LatencyMs,
      connectedRegionIds: routing.connectedRegionIds,
      links: state.routingLinks,
    },
    failover: state.failover,
    automaticFailover: state.automaticFailover,
    failoverDelayMs: state.failoverDelayMs,
    incidents: state.incidents,
    slaDefinitions: cloudSlaDefinitions.map((definition) => {
      const blockedReason = gameState
        ? getCloudSlaGameBlockedReason(gameState, definition.id)
        : getCloudSlaBlockedReason(state, definition.id);
      return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        observationWindowMs: definition.observationWindowMs,
        workRequired: definition.workRequired,
        workValueMultiplier: definition.workValueMultiplier,
        rewards: definition.rewards,
        canStart: blockedReason === null,
        blockedReason,
        projection: gameState
          ? getCloudSlaProjection(gameState, definition.id)
          : null,
      };
    }),
    activeSla,
    completedSlas: state.completedSlas,
    finale: {
      started: state.finale !== null,
      complete: finaleComplete,
      canStart: gameState !== undefined && finaleBlockedReason === null,
      blockedReason: finaleBlockedReason,
      phaseId: currentPhase?.id ?? null,
      phaseName: currentPhase?.name ?? null,
      phaseIndex: state.finale?.phaseIndex ?? 0,
      phaseContribution: state.finale?.phaseContribution ?? ZERO_AMOUNT,
      phaseContributionRequired:
        currentPhase?.contributionRequired ?? ZERO_AMOUNT,
      totalContribution: state.finale?.totalContribution ?? ZERO_AMOUNT,
      connectedRegionIds: routing.connectedRegionIds,
      remainingMs: finaleRemainingMs,
    },
    charters: charterDefinitions.map((charter) => ({
      ...charter,
      selected: state.finaleCharterId === charter.id,
      canSelect: finaleComplete,
    })),
    postgameUnlocked: state.postgameUnlocked,
  };
};
