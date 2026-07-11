import {
  ZERO_AMOUNT,
  amountAdd,
  amountCompare,
  amountDivide,
  amountMin,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  exactResourceBag,
  sumAmounts,
  type Amount,
  type ExactResourceBag,
} from "./amount";
import {
  advancePlanetaryFinale,
  canonicalPlanetaryFinalePlan,
  createPlanetaryFinaleRuntime,
  getFinaleCharterModifiers,
  getNextPlanetaryFinaleEventMs,
} from "./planetary";
import {
  hasConnectedRegionComponent,
  routeRegionalDemand,
  type RegionalRoutingResult,
  type RoutingEdge,
} from "./routing";
import {
  advanceFailover,
  createSlaWindowState,
  drawOptInIncident,
  evaluateSlaWindow,
  getHealthyReplicaFaultDomains,
  getIncidentZoneStatus,
  getNextFailoverEventMs,
  recordSlaInterval,
  requestFailover,
  type AvailabilityZoneState,
  type ZoneOperatingStatus,
} from "./sla";
import type { Xoshiro128State } from "./rng";
import type { FinaleCharterId } from "./types";
import {
  createWorkValueMultiplier,
  getWorkValueCredits,
  type WorkValueMultiplier,
} from "./workValue";
import { getCloudSlaDefinition } from "./cloudDefinitions";
import type {
  CloudAdvanceResult,
  CloudAdvanceOptions,
  CloudReplicaState,
  CloudRewardEvent,
  CloudRoutingSnapshot,
  CloudSlaDefinitionId,
  CloudState,
  CloudZoneState,
  CompletedCloudSlaState,
} from "./cloudTypes";
import {
  clampCloudInteger as clampInteger,
  normalizeCloudAmount as normalizeAmount,
  normalizeCloudId as normalizeId,
  normalizeCloudName as normalizeName,
  normalizeCloudRoutingEdge as normalizeRoutingEdge,
  normalizeCloudState,
  normalizeCloudZoneStatus as normalizeZoneStatus,
} from "./cloudState";

export { cloudSlaDefinitions, getCloudSlaDefinition } from "./cloudDefinitions";
export { createCloudState, normalizeCloudState } from "./cloudState";
export type * from "./cloudTypes";

const MAX_SAFE_TIME_MS = Number.MAX_SAFE_INTEGER;
const BASIS_POINTS = 10_000;

const getCloudCharterRewardMultiplier = (
  state: CloudState,
): WorkValueMultiplier => createWorkValueMultiplier(
  `cloud-charter-${state.finaleCharterId ?? "standard"}`,
  getFinaleCharterModifiers(state.finaleCharterId).openContractRewardBps,
);

const createEmptyRoutingResult = (): RegionalRoutingResult => ({
  requested: ZERO_AMOUNT,
  delivered: ZERO_AMOUNT,
  unmet: ZERO_AMOUNT,
  totalCost: ZERO_AMOUNT,
  edgeFlows: [],
  paths: [],
  p95LatencyMs: null,
  suppliedByRegion: {},
  fulfilledByRegion: {},
});

const pauseCloudRouting = (
  routing: CloudRoutingSnapshot,
): CloudRoutingSnapshot => ({
  ...routing,
  result: {
    ...createEmptyRoutingResult(),
    requested: routing.result.requested,
    unmet: routing.result.requested,
  },
  connectedRegionIds: [],
  contributionPerSecond: ZERO_AMOUNT,
});

export const commissionCloudRegion = (
  input: CloudState,
  name: string,
): CloudState => {
  const state = normalizeCloudState(input);
  const id = `region-${state.nextEntityId}`;
  return {
    ...state,
    nextEntityId: state.nextEntityId + 1,
    regions: [
      ...state.regions,
      { id, name: normalizeName(name, `Region ${state.nextEntityId}`) },
    ],
  };
};

export const commissionCloudZone = (
  input: CloudState,
  options: {
    regionId: string;
    facilityId: string;
    name?: string;
    capacityPerSecond: Amount;
    baseLatencyMs?: number;
    faultDomainId?: string;
  },
): CloudState => {
  const state = normalizeCloudState(input);
  if (!state.regions.some((region) => region.id === options.regionId)) {
    return state;
  }
  if (state.zones.some((zone) => zone.facilityId === options.facilityId)) {
    return state;
  }
  const id = `zone-${state.nextEntityId}`;
  return {
    ...state,
    nextEntityId: state.nextEntityId + 1,
    zones: [
      ...state.zones,
      {
        id,
        name: normalizeName(options.name, `Zone ${state.nextEntityId}`),
        regionId: options.regionId,
        facilityId: normalizeId(options.facilityId, `facility-${state.nextEntityId}`),
        faultDomainId: normalizeId(options.faultDomainId, id),
        configuredStatus: "online",
        capacityPerSecond: normalizeAmount(options.capacityPerSecond),
        baseLatencyMs: clampInteger(options.baseLatencyMs, 0, 60_000, 25),
      },
    ],
  };
};

export const placeCloudReplica = (
  input: CloudState,
  zoneId: string,
): CloudState => {
  const state = normalizeCloudState(input);
  if (!state.zones.some((zone) => zone.id === zoneId)) return state;
  if (state.replicas.some((replica) => replica.zoneId === zoneId)) return state;
  const id = `replica-${state.nextEntityId}`;
  const replicas: CloudReplicaState[] = [
    ...state.replicas,
    { id, zoneId, healthy: true, serviceId: "commons-service" },
  ];
  return {
    ...state,
    nextEntityId: state.nextEntityId + 1,
    replicas,
    failover: {
      ...state.failover,
      activeZoneId: state.failover.activeZoneId ?? zoneId,
    },
  };
};

export const setCloudZoneStatus = (
  input: CloudState,
  zoneId: string,
  status: ZoneOperatingStatus,
): CloudState => {
  const state = normalizeCloudState(input);
  return {
    ...state,
    zones: state.zones.map((zone) =>
      zone.id === zoneId
        ? { ...zone, configuredStatus: normalizeZoneStatus(status) }
        : zone,
    ),
  };
};

export const setCloudRegionalDemand = (
  input: CloudState,
  regionId: string,
  demand: Amount,
): CloudState => {
  const state = normalizeCloudState(input);
  if (!state.regions.some((region) => region.id === regionId)) return state;
  const normalizedDemand = normalizeAmount(demand);
  return {
    ...state,
    regionalDemands: [
      ...state.regionalDemands.filter((item) => item.regionId !== regionId),
      { regionId, demand: normalizedDemand },
    ].sort((left, right) => left.regionId.localeCompare(right.regionId)),
  };
};

export const setCloudRoutingLinks = (
  input: CloudState,
  links: readonly RoutingEdge[],
): CloudState => {
  const state = normalizeCloudState(input);
  const regionIds = new Set(state.regions.map((region) => region.id));
  const edgeIds = new Set<string>();
  const routingLinks = links.flatMap((link) => {
    const normalized = normalizeRoutingEdge(link, regionIds);
    if (!normalized || edgeIds.has(normalized.id)) return [];
    edgeIds.add(normalized.id);
    return [normalized];
  });
  return { ...state, routingLinks };
};

const getEffectiveZone = (
  state: CloudState,
  zone: CloudZoneState,
): AvailabilityZoneState => {
  let status = zone.configuredStatus;
  let capacityBps = status === "paused" ? 0 : status === "derated" ? 5_000 : BASIS_POINTS;
  for (const incident of state.incidents) {
    if (incident.zoneId !== zone.id) continue;
    const incidentStatus = getIncidentZoneStatus(incident, state.elapsedMs);
    if (incidentStatus.status === "paused") status = "paused";
    else if (incidentStatus.status === "derated" && status === "online") {
      status = "derated";
    }
    capacityBps = Math.min(capacityBps, incidentStatus.capacityBps);
  }
  return {
    id: zone.id,
    faultDomainId: zone.faultDomainId,
    status,
    capacityBps,
  };
};

export const getCloudRoutingSnapshot = (
  input: CloudState,
): CloudRoutingSnapshot => {
  const state = normalizeCloudState(input);
  const effectiveZones = state.zones.map((zone) =>
    getEffectiveZone(state, zone),
  );
  const effectiveById = new Map(
    effectiveZones.map((zone) => [zone.id, zone]),
  );
  const supplies = state.regions.map((region) => ({
    regionId: region.id,
    capacity: sumAmounts(
      state.zones
        .filter((zone) => zone.regionId === region.id)
        .map((zone) => {
          const effective = effectiveById.get(zone.id);
          return amountDivide(
            amountMultiply(
              zone.capacityPerSecond,
              effective?.capacityBps ?? 0,
            ),
            BASIS_POINTS,
          );
        }),
    ),
  }));
  const result =
    state.regionalDemands.length === 0
      ? createEmptyRoutingResult()
      : routeRegionalDemand({
          supplies,
          demands: state.regionalDemands,
          links: state.routingLinks,
        });
  const connectedRegionIds = Object.entries(result.fulfilledByRegion)
    .filter(([, delivered]) => amountCompare(delivered, 0) > 0)
    .map(([regionId]) => regionId)
    .sort();
  return {
    result,
    effectiveZones,
    connectedRegionIds,
    contributionPerSecond: result.delivered,
  };
};

/**
 * A configured route is not proof of regional traffic. Only explicit links
 * carrying positive flow may connect the served regions used by SLA/finale
 * gates; local source-to-sink delivery therefore cannot satisfy this check.
 */
export const hasPositiveCloudRoutingFlow = (
  routing: CloudRoutingSnapshot,
  requiredRegionCount: number,
) =>
  hasConnectedRegionComponent(
    routing.connectedRegionIds,
    routing.result.edgeFlows.map((flow) => ({
      from: flow.from,
      to: flow.to,
      capacity: flow.flow,
    })),
    requiredRegionCount,
  );

export const scheduleCloudIncident = (input: {
  state: CloudState;
  rng: Xoshiro128State;
  optIn: boolean;
  windowMs: number;
}): { state: CloudState; rng: Xoshiro128State } => {
  const state = normalizeCloudState(input.state);
  const draw = drawOptInIncident({
    rng: input.rng,
    optIn: input.optIn,
    nowMs: state.elapsedMs,
    windowMs: input.windowMs,
    zoneIds: state.zones.map((zone) => zone.id),
    incidentIndex: state.nextEntityId,
  });
  if (!draw.incident) return { state, rng: draw.rng };
  return {
    rng: draw.rng,
    state: {
      ...state,
      nextEntityId: state.nextEntityId + 1,
      incidents: [...state.incidents, draw.incident].sort(
        (left, right) =>
          left.startsAtMs - right.startsAtMs || left.id.localeCompare(right.id),
      ),
    },
  };
};

export const requestCloudFailover = (input: CloudState): CloudState => {
  const state = normalizeCloudState(input);
  const routing = getCloudRoutingSnapshot(state);
  const modifier = getFinaleCharterModifiers(state.finaleCharterId);
  const delayMs = Math.max(
    0,
    Math.ceil((state.failoverDelayMs * modifier.failoverDelayBps) / BASIS_POINTS),
  );
  return {
    ...state,
    failover: requestFailover({
      state: state.failover,
      nowMs: state.elapsedMs,
      delayMs,
      zones: routing.effectiveZones,
      replicas: state.replicas,
    }),
  };
};

export const getCloudSlaBlockedReason = (
  input: CloudState,
  definitionId: CloudSlaDefinitionId,
): string | null => {
  const state = normalizeCloudState(input);
  if (state.activeSla) return "Another SLA window is already active.";
  const definition = getCloudSlaDefinition(definitionId);
  const zoneCount = new Set(state.replicas.map((replica) => replica.zoneId)).size;
  if (zoneCount < definition.minimumZoneCount) {
    return `Requires replicas in ${definition.minimumZoneCount} zones.`;
  }
  const regionByZone = new Map(
    state.zones.map((zone) => [zone.id, zone.regionId]),
  );
  const regionCount = new Set(
    state.replicas
      .map((replica) => regionByZone.get(replica.zoneId))
      .filter((regionId): regionId is string => Boolean(regionId)),
  ).size;
  if (regionCount < definition.minimumRegionCount) {
    return `Requires coverage in ${definition.minimumRegionCount} regions.`;
  }
  const distinctDomains = new Set(
    state.replicas.flatMap((replica) => {
      const zone = state.zones.find((candidate) => candidate.id === replica.zoneId);
      return zone ? [zone.faultDomainId] : [];
    }),
  ).size;
  if (distinctDomains < definition.policy.minimumReplicaQuorum) {
    return `Requires ${definition.policy.minimumReplicaQuorum} distinct fault domains.`;
  }
  const routing = getCloudRoutingSnapshot(state);
  const routedRegionCount = routing.connectedRegionIds.length;
  if (routedRegionCount < definition.minimumRegionCount) {
    return `Requires routed service in ${definition.minimumRegionCount} regions.`;
  }
  if (
    definition.id === "planetaryCoverage" &&
    !hasPositiveCloudRoutingFlow(routing, definition.minimumRegionCount)
  ) {
    return `Requires positive flow on explicit routes connecting ${definition.minimumRegionCount} served regions.`;
  }
  return null;
};

export const startCloudSla = (
  input: CloudState,
  definitionId: CloudSlaDefinitionId,
): CloudState => {
  const state = normalizeCloudState(input);
  if (getCloudSlaBlockedReason(state, definitionId)) return state;
  const id = `sla-${state.nextEntityId}`;
  const definition = getCloudSlaDefinition(definitionId);
  return {
    ...state,
    nextEntityId: state.nextEntityId + 1,
    activeSla: {
      id,
      definitionId,
      observationElapsedMs: 0,
      workCompleted: ZERO_AMOUNT,
      paidWorkUnits: definition.workRequired,
      workValueMultiplier: definition.workValueMultiplier,
      charterRewardMultiplier: getCloudCharterRewardMultiplier(state),
      window: createSlaWindowState(),
    },
  };
};

export const startPlanetaryFinale = (input: CloudState): CloudState => {
  const state = normalizeCloudState(input);
  if (state.finale) return state;
  return {
    ...state,
    finale: createPlanetaryFinaleRuntime(canonicalPlanetaryFinalePlan),
  };
};

export const selectCloudFinaleCharter = (
  input: CloudState,
  charterId: FinaleCharterId,
): CloudState => {
  const state = normalizeCloudState(input);
  if (!state.finale?.complete) return state;
  return {
    ...state,
    finaleCharterId: charterId,
    postgameUnlocked: true,
  };
};

const getActiveZone = (
  state: CloudState,
  routing: CloudRoutingSnapshot,
) =>
  routing.effectiveZones.find(
    (zone) => zone.id === state.failover.activeZoneId,
  ) ?? null;

const getServiceSample = (
  state: CloudState,
  routing: CloudRoutingSnapshot,
) => {
  const activeZone = getActiveZone(state, routing);
  const zoneDetails = state.zones.find((zone) => zone.id === activeZone?.id);
  const routeLatency = routing.result.p95LatencyMs ?? 0;
  const routingProofReady =
    state.activeSla?.definitionId !== "planetaryCoverage" ||
    hasPositiveCloudRoutingFlow(
      routing,
      getCloudSlaDefinition("planetaryCoverage").minimumRegionCount,
    );
  return {
    serviceOnline:
      Boolean(activeZone) &&
      activeZone!.status !== "paused" &&
      routingProofReady &&
      amountCompare(routing.result.delivered, 0) > 0,
    healthyReplicaFaultDomains: getHealthyReplicaFaultDomains(
      routing.effectiveZones,
      state.replicas,
    ),
    latencyMs: activeZone ? routeLatency + (zoneDetails?.baseLatencyMs ?? 0) : null,
  };
};

const getSlaCommitEventMs = (
  state: CloudState,
  rate: Amount,
): number | null => {
  const active = state.activeSla;
  if (!active || amountCompare(rate, 0) <= 0) return null;
  const definition = getCloudSlaDefinition(active.definitionId);
  const paidWorkUnits = active.paidWorkUnits ?? definition.workRequired;
  if (amountCompare(active.workCompleted, paidWorkUnits) >= 0) {
    return null;
  }
  const exactMs = amountMultiply(
    amountDivide(
      amountSubtract(paidWorkUnits, active.workCompleted),
      rate,
    ),
    1_000,
  );
  if (amountCompare(exactMs, MAX_SAFE_TIME_MS) > 0) return null;
  return Math.max(1, Math.ceil(amountToSafeNumber(exactMs)));
};

const getNextCloudBoundaryMs = (
  state: CloudState,
  routing: CloudRoutingSnapshot,
  remainingMs: number,
) => {
  const candidates = [remainingMs];
  const failoverEvent = getNextFailoverEventMs(state.failover, state.elapsedMs);
  if (failoverEvent !== null && failoverEvent > 0) candidates.push(failoverEvent);
  for (const incident of state.incidents) {
    if (incident.startsAtMs > state.elapsedMs) {
      candidates.push(incident.startsAtMs - state.elapsedMs);
    }
    if (incident.endsAtMs > state.elapsedMs) {
      candidates.push(incident.endsAtMs - state.elapsedMs);
    }
  }
  if (state.activeSla) {
    candidates.push(
      Math.max(
        1,
        getCloudSlaDefinition(state.activeSla.definitionId).observationWindowMs -
          state.activeSla.observationElapsedMs,
      ),
    );
    const commitEvent = getSlaCommitEventMs(state, routing.result.delivered);
    if (commitEvent !== null) candidates.push(commitEvent);
  }
  if (state.finale && !state.finale.complete) {
    const routingReady = hasPositiveCloudRoutingFlow(routing, 4);
    const event = getNextPlanetaryFinaleEventMs(
      state.finale,
      routingReady ? routing.contributionPerSecond : ZERO_AMOUNT,
      routingReady ? routing.connectedRegionIds : [],
    );
    if (event !== null && amountCompare(event, remainingMs) <= 0) {
      candidates.push(Math.max(1, Math.ceil(amountToSafeNumber(event))));
    }
  }
  return Math.max(1, Math.min(...candidates.filter((value) => value > 0)));
};

/** Next deterministic Cloud/SLA/failover/finale boundary inside a horizon. */
export const getNextCloudEventMs = (
  input: CloudState,
  maximumMs: number,
) => {
  const state = normalizeCloudState(input);
  const horizonMs = clampInteger(maximumMs, 0, MAX_SAFE_TIME_MS, 0);
  if (horizonMs === 0) return 0;
  return getNextCloudBoundaryMs(
    state,
    getCloudRoutingSnapshot(state),
    horizonMs,
  );
};

/**
 * Returns each facility that actually supplies routed Cloud work. Facilities
 * are selected in stable zone order until the routed regional supply is met,
 * so spare facilities are not billed merely for existing.
 */
export const getProductiveCloudFacilityIds = (input: CloudState) => {
  const state = normalizeCloudState(input);
  if (!state.activeSla && (!state.finale || state.finale.complete)) return [];
  const routing = getCloudRoutingSnapshot(state);
  const effectiveById = new Map(
    routing.effectiveZones.map((zone) => [zone.id, zone]),
  );
  const facilityIds = new Set<string>();
  for (const region of [...state.regions].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    let remainingSupply =
      routing.result.suppliedByRegion[region.id] ?? ZERO_AMOUNT;
    if (amountCompare(remainingSupply, 0) <= 0) continue;
    const zones = state.zones
      .filter((zone) => zone.regionId === region.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const zone of zones) {
      if (amountCompare(remainingSupply, 0) <= 0) break;
      const effective = effectiveById.get(zone.id);
      if (!effective || effective.capacityBps <= 0) continue;
      const available = amountDivide(
        amountMultiply(zone.capacityPerSecond, effective.capacityBps),
        BASIS_POINTS,
      );
      if (amountCompare(available, 0) <= 0) continue;
      facilityIds.add(zone.facilityId);
      remainingSupply = amountSubtract(
        remainingSupply,
        amountMin(remainingSupply, available),
      );
    }
  }
  return [...facilityIds].sort();
};

const maybeRequestAutomaticFailover = (input: CloudState): CloudState => {
  const state = normalizeCloudState(input);
  if (!state.automaticFailover || state.failover.pendingZoneId !== null) {
    return state;
  }
  const routing = getCloudRoutingSnapshot(state);
  const active = getActiveZone(state, routing);
  return !active || active.status === "paused"
    ? requestCloudFailover(state)
    : state;
};

const completeSlaIfReady = (
  input: CloudState,
): {
  state: CloudState;
  rewards: ExactResourceBag;
  event: CloudRewardEvent | null;
} => {
  const state = normalizeCloudState(input);
  const active = state.activeSla;
  if (!active) return { state, rewards: exactResourceBag(), event: null };
  const definition = getCloudSlaDefinition(active.definitionId);
  if (active.observationElapsedMs < definition.observationWindowMs) {
    return { state, rewards: exactResourceBag(), event: null };
  }
  const evaluation = evaluateSlaWindow(active.window, definition.policy);
  const paidWorkUnits = active.paidWorkUnits ?? definition.workRequired;
  const workValueMultiplier =
    active.workValueMultiplier ?? definition.workValueMultiplier;
  const charterRewardMultiplier =
    active.charterRewardMultiplier ?? getCloudCharterRewardMultiplier(state);
  const succeeded =
    evaluation.success &&
    amountCompare(active.workCompleted, paidWorkUnits) >= 0;
  const rewards = succeeded
    ? exactResourceBag(
        amountDivide(
          amountMultiply(
            getWorkValueCredits(paidWorkUnits, workValueMultiplier),
            charterRewardMultiplier.basisPoints,
          ),
          BASIS_POINTS,
        ),
        amountDivide(
          amountMultiply(
            definition.rewards.data,
            charterRewardMultiplier.basisPoints,
          ),
          BASIS_POINTS,
        ),
      )
    : exactResourceBag();
  const completed: CompletedCloudSlaState = {
    id: active.id,
    definitionId: active.definitionId,
    succeeded,
    evaluation: { ...evaluation, success: succeeded },
    rewardBps: Number(charterRewardMultiplier.basisPoints),
    paidWorkUnits,
    workValueMultiplier,
    charterRewardMultiplier,
    rewards,
  };
  return {
    state: {
      ...state,
      activeSla: null,
      completedSlas: [...state.completedSlas, completed].slice(-256),
    },
    rewards,
    event: succeeded
      ? {
          source: "sla",
          instanceId: active.id,
          definitionId: active.definitionId,
          rewards,
        }
      : null,
  };
};

/**
 * Advances failover, incidents, SLA integration, routing, and the finale only at
 * deterministic event boundaries. Incidents can derate or pause service, but
 * they never delete facilities, replicas, resources, or completed work.
 */
export const advanceCloud = (
  input: CloudState,
  elapsedMsInput: number,
  options: CloudAdvanceOptions = {},
): CloudAdvanceResult => {
  let state = normalizeCloudState(input);
  const requestedMs = Math.max(
    0,
    Number.isFinite(elapsedMsInput) ? elapsedMsInput : 0,
  );
  const combinedElapsedMs = state.advanceRemainderMs + requestedMs;
  const wholeElapsedMs = Math.floor(combinedElapsedMs);
  state = {
    ...state,
    advanceRemainderMs: combinedElapsedMs - wholeElapsedMs,
  };
  let remainingMs = clampInteger(
    wholeElapsedMs,
    0,
    MAX_SAFE_TIME_MS - state.elapsedMs,
    0,
  );
  let rewards = exactResourceBag();
  const rewardEvents: CloudRewardEvent[] = [];
  const completedFinalePhaseIds: string[] = [];
  const blockers = new Set<string>();
  let productiveMs = 0;
  let pausedMs = 0;
  let guard = 0;

  while (remainingMs > 0) {
    guard += 1;
    if (guard > 100_000) throw new Error("Cloud event boundary limit exceeded");
    state = maybeRequestAutomaticFailover(state);
    const availableRouting = getCloudRoutingSnapshot(state);
    const routing = options.productiveAllowed === false
      ? pauseCloudRouting(availableRouting)
      : availableRouting;
    const stepMs = Math.min(
      remainingMs,
      getNextCloudBoundaryMs(state, routing, remainingMs),
    );
    const sample = getServiceSample(state, routing);
    let activeSla = state.activeSla;
    if (activeSla && options.productiveAllowed !== false) {
      const definition = getCloudSlaDefinition(activeSla.definitionId);
      const paidWorkUnits = activeSla.paidWorkUnits ?? definition.workRequired;
      const workCompleted = amountMin(
        paidWorkUnits,
        amountAdd(
          activeSla.workCompleted,
          amountDivide(
            amountMultiply(routing.result.delivered, stepMs),
            1_000,
          ),
        ),
      );
      const committed =
        amountCompare(activeSla.workCompleted, paidWorkUnits) < 0 &&
        amountCompare(workCompleted, paidWorkUnits) >= 0;
      activeSla = {
        ...activeSla,
        observationElapsedMs: Math.min(
          definition.observationWindowMs,
          activeSla.observationElapsedMs + stepMs,
        ),
        workCompleted,
        window: recordSlaInterval(activeSla.window, definition.policy, {
          elapsedMs: stepMs,
          ...sample,
          committed,
        }),
      };
    }

    let finale = state.finale;
    if (
      finale &&
      !finale.complete &&
      options.productiveAllowed !== false
    ) {
      const routingReady = hasPositiveCloudRoutingFlow(routing, 4);
      const advanced = advancePlanetaryFinale({
        runtime: finale,
        elapsedMs: stepMs,
        routedContributionPerSecond:
          routingReady ? routing.contributionPerSecond : ZERO_AMOUNT,
        connectedRegionIds: routingReady ? routing.connectedRegionIds : [],
      });
      finale = advanced.runtime;
      completedFinalePhaseIds.push(...advanced.completedPhaseIds);
      if (advanced.blockedReason) blockers.add(advanced.blockedReason);
    }

    if (sample.serviceOnline && amountCompare(routing.result.delivered, 0) > 0) {
      productiveMs += stepMs;
    } else {
      pausedMs += stepMs;
      if (!sample.serviceOnline) blockers.add("Cloud service safely paused.");
      if (amountCompare(routing.result.delivered, 0) <= 0) {
        blockers.add("No routed regional capacity.");
      }
    }

    state = {
      ...state,
      elapsedMs: state.elapsedMs + stepMs,
      failover: advanceFailover(state.failover, state.elapsedMs + stepMs),
      activeSla,
      finale,
    };
    remainingMs -= stepMs;

    const completed = completeSlaIfReady(state);
    state = completed.state;
    rewards = exactResourceBag(
      amountAdd(rewards.credits, completed.rewards.credits),
      amountAdd(rewards.data, completed.rewards.data),
    );
    if (completed.event) rewardEvents.push(completed.event);
  }

  return {
    state,
    rewards,
    rewardEvents,
    completedFinalePhaseIds,
    productiveMs,
    pausedMs,
    blockers: [...blockers].sort(),
  };
};
