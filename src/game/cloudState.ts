import {
  ZERO_AMOUNT,
  amountClampMin,
  amountDivide,
  amountMin,
  amountMultiply,
  exactResourceBag,
  type Amount,
} from "./amount";
import { getCloudSlaDefinition } from "./cloudDefinitions";
import type {
  ActiveCloudSlaState,
  CloudRegionState,
  CloudReplicaState,
  CloudState,
  CloudZoneState,
  CompletedCloudSlaState,
} from "./cloudTypes";
import {
  normalizePlanetaryFinaleRuntime,
  type PlanetaryFinaleRuntime,
} from "./planetary";
import type { RegionalDemand, RoutingEdge } from "./routing";
import {
  normalizeSlaWindowState,
  type FailoverState,
  type OptInIncidentSchedule,
  type SlaEvaluation,
  type ZoneOperatingStatus,
} from "./sla";
import type { FinaleCharterId } from "./types";
import {
  createWorkValueMultiplier,
  getWorkValueCredits,
  type WorkValueMultiplier,
} from "./workValue";

const MAX_SAFE_TIME_MS = Number.MAX_SAFE_INTEGER;
const BASIS_POINTS = 10_000;

export const clampCloudInteger = (
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(value)))
    : fallback;

export const normalizeCloudId = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, 120)
    : fallback;

export const normalizeCloudName = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, 80)
    : fallback;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizeCloudAmount = (
  value: unknown,
  fallback: Amount = ZERO_AMOUNT,
) => {
  try {
    return amountClampMin(
      typeof value === "string" || typeof value === "number"
        ? value
        : fallback,
    );
  } catch {
    return fallback;
  }
};

const normalizeWorkValueMultiplier = (
  value: unknown,
  fallback: WorkValueMultiplier,
): WorkValueMultiplier => {
  if (!isRecord(value)) return fallback;
  if (
    typeof value.id !== "string" ||
    (typeof value.basisPoints !== "string" &&
      typeof value.basisPoints !== "number")
  ) {
    return fallback;
  }
  try {
    return createWorkValueMultiplier(value.id, value.basisPoints);
  } catch {
    return fallback;
  }
};

export const normalizeCloudZoneStatus = (
  value: unknown,
): ZoneOperatingStatus =>
  value === "paused" || value === "derated" ? value : "online";

export const createCloudState = (): CloudState => ({
  elapsedMs: 0,
  advanceRemainderMs: 0,
  nextEntityId: 1,
  regions: [],
  zones: [],
  replicas: [],
  failover: {
    activeZoneId: null,
    pendingZoneId: null,
    completesAtMs: null,
    lastCompletedAtMs: null,
  },
  automaticFailover: true,
  failoverDelayMs: 30_000,
  incidents: [],
  regionalDemands: [],
  routingLinks: [],
  activeSla: null,
  completedSlas: [],
  finale: null,
  finaleCharterId: null,
  postgameUnlocked: false,
});

const normalizeRegion = (
  value: unknown,
  fallbackIndex: number,
): CloudRegionState | null => {
  if (!isRecord(value)) return null;
  const id = normalizeCloudId(value.id, `region-${fallbackIndex}`);
  return {
    id,
    name: normalizeCloudName(value.name, `Region ${fallbackIndex}`),
  };
};

const normalizeZone = (
  value: unknown,
  fallbackIndex: number,
  regionIds: ReadonlySet<string>,
): CloudZoneState | null => {
  if (!isRecord(value)) return null;
  const regionId = normalizeCloudId(value.regionId, "");
  if (!regionIds.has(regionId)) return null;
  const id = normalizeCloudId(value.id, `zone-${fallbackIndex}`);
  return {
    id,
    name: normalizeCloudName(value.name, `Zone ${fallbackIndex}`),
    regionId,
    facilityId: normalizeCloudId(
      value.facilityId,
      `facility-${fallbackIndex}`,
    ),
    faultDomainId: normalizeCloudId(value.faultDomainId, id),
    configuredStatus: normalizeCloudZoneStatus(value.configuredStatus),
    capacityPerSecond: normalizeCloudAmount(value.capacityPerSecond),
    baseLatencyMs: clampCloudInteger(value.baseLatencyMs, 0, 60_000, 25),
  };
};

export const normalizeCloudRoutingEdge = (
  value: unknown,
  regionIds: ReadonlySet<string>,
): RoutingEdge | null => {
  if (!isRecord(value)) return null;
  const from = normalizeCloudId(value.from, "");
  const to = normalizeCloudId(value.to, "");
  if (!regionIds.has(from) || !regionIds.has(to) || from === to) return null;
  return {
    id: normalizeCloudId(value.id, `${from}:${to}`),
    from,
    to,
    capacity: normalizeCloudAmount(value.capacity),
    costPerUnit: clampCloudInteger(value.costPerUnit, 0, 1_000_000, 0),
    latencyMs: clampCloudInteger(value.latencyMs, 0, 60_000, 0),
  };
};

const normalizeEvaluation = (value: unknown): SlaEvaluation => {
  const source = isRecord(value) ? value : {};
  return {
    availabilityBps: clampCloudInteger(
      source.availabilityBps,
      0,
      BASIS_POINTS,
      0,
    ),
    p95LatencyMs:
      typeof source.p95LatencyMs === "number" && source.p95LatencyMs >= 0
        ? source.p95LatencyMs
        : null,
    distinctQuorumViolationMs: clampCloudInteger(
      source.distinctQuorumViolationMs,
      0,
      MAX_SAFE_TIME_MS,
      0,
    ),
    serviceViolationMs: clampCloudInteger(
      source.serviceViolationMs,
      0,
      MAX_SAFE_TIME_MS,
      0,
    ),
    deadlineMet: source.deadlineMet === true,
    availabilityMet: source.availabilityMet === true,
    latencyMet: source.latencyMet === true,
    success: source.success === true,
  };
};

export const normalizeCloudState = (value: unknown): CloudState => {
  const fresh = createCloudState();
  if (!isRecord(value)) return fresh;
  const regionCandidates = Array.isArray(value.regions) ? value.regions : [];
  const regionIds = new Set<string>();
  const regions: CloudRegionState[] = [];
  regionCandidates.forEach((candidate, index) => {
    const region = normalizeRegion(candidate, index + 1);
    if (!region || regionIds.has(region.id)) return;
    regionIds.add(region.id);
    regions.push(region);
  });

  const zoneIds = new Set<string>();
  const zones: CloudZoneState[] = [];
  const zoneCandidates = Array.isArray(value.zones) ? value.zones : [];
  zoneCandidates.forEach((candidate, index) => {
    const zone = normalizeZone(candidate, index + 1, regionIds);
    if (!zone || zoneIds.has(zone.id)) return;
    zoneIds.add(zone.id);
    zones.push(zone);
  });

  const replicaIds = new Set<string>();
  const replicas: CloudReplicaState[] = [];
  const replicaCandidates = Array.isArray(value.replicas) ? value.replicas : [];
  replicaCandidates.forEach((candidate, index) => {
    if (!isRecord(candidate)) return;
    const zoneId = normalizeCloudId(candidate.zoneId, "");
    if (!zoneIds.has(zoneId)) return;
    const id = normalizeCloudId(candidate.id, `replica-${index + 1}`);
    if (replicaIds.has(id)) return;
    replicaIds.add(id);
    replicas.push({
      id,
      zoneId,
      healthy: candidate.healthy !== false,
      serviceId: "commons-service",
    });
  });

  const demandIds = new Set<string>();
  const regionalDemands: RegionalDemand[] = [];
  const demandCandidates = Array.isArray(value.regionalDemands)
    ? value.regionalDemands
    : [];
  for (const candidate of demandCandidates) {
    if (!isRecord(candidate)) continue;
    const regionId = normalizeCloudId(candidate.regionId, "");
    if (!regionIds.has(regionId) || demandIds.has(regionId)) continue;
    demandIds.add(regionId);
    regionalDemands.push({
      regionId,
      demand: normalizeCloudAmount(candidate.demand),
    });
  }

  const edgeIds = new Set<string>();
  const routingLinks: RoutingEdge[] = [];
  const linkCandidates = Array.isArray(value.routingLinks)
    ? value.routingLinks
    : [];
  for (const candidate of linkCandidates) {
    const edge = normalizeCloudRoutingEdge(candidate, regionIds);
    if (!edge || edgeIds.has(edge.id)) continue;
    edgeIds.add(edge.id);
    routingLinks.push(edge);
  }

  const failoverSource = isRecord(value.failover) ? value.failover : {};
  const normalizeOptionalZoneId = (candidate: unknown) =>
    typeof candidate === "string" && zoneIds.has(candidate) ? candidate : null;
  const activeZoneId = normalizeOptionalZoneId(failoverSource.activeZoneId);
  const pendingZoneId = normalizeOptionalZoneId(failoverSource.pendingZoneId);
  const completesAtMs =
    pendingZoneId && typeof failoverSource.completesAtMs === "number"
      ? clampCloudInteger(
          failoverSource.completesAtMs,
          0,
          MAX_SAFE_TIME_MS,
          0,
        )
      : null;
  const failover: FailoverState = {
    activeZoneId,
    pendingZoneId: completesAtMs === null ? null : pendingZoneId,
    completesAtMs,
    lastCompletedAtMs:
      typeof failoverSource.lastCompletedAtMs === "number"
        ? clampCloudInteger(
            failoverSource.lastCompletedAtMs,
            0,
            MAX_SAFE_TIME_MS,
            0,
          )
        : null,
  };

  const incidents = (Array.isArray(value.incidents) ? value.incidents : [])
    .flatMap((candidate, index): OptInIncidentSchedule[] => {
      if (!isRecord(candidate)) return [];
      const zoneId = normalizeCloudId(candidate.zoneId, "");
      if (!zoneIds.has(zoneId)) return [];
      const startsAtMs = clampCloudInteger(
        candidate.startsAtMs,
        0,
        MAX_SAFE_TIME_MS,
        0,
      );
      const endsAtMs = clampCloudInteger(
        candidate.endsAtMs,
        startsAtMs,
        MAX_SAFE_TIME_MS,
        startsAtMs,
      );
      return [{
        id: normalizeCloudId(candidate.id, `incident-${index + 1}`),
        zoneId,
        startsAtMs,
        endsAtMs,
        derateBps: clampCloudInteger(
          candidate.derateBps,
          0,
          BASIS_POINTS,
          0,
        ),
      }];
    })
    .sort(
      (left, right) =>
        left.startsAtMs - right.startsAtMs || left.id.localeCompare(right.id),
    )
    .filter(
      (incident, index, values) =>
        values.findIndex((candidate) => candidate.id === incident.id) === index,
    )
    .slice(-256);

  let activeSla: ActiveCloudSlaState | null = null;
  if (isRecord(value.activeSla)) {
    const definitionId = value.activeSla.definitionId;
    if (
      definitionId === "regionalContinuity" ||
      definitionId === "planetaryCoverage"
    ) {
      const definition = getCloudSlaDefinition(definitionId);
      const paidWorkUnits = normalizeCloudAmount(
        value.activeSla.paidWorkUnits,
        definition.workRequired,
      );
      const workValueMultiplier = normalizeWorkValueMultiplier(
        value.activeSla.workValueMultiplier,
        definition.workValueMultiplier,
      );
      const legacyCharterRewardBps =
        value.finaleCharterId === "openCompute" &&
        value.postgameUnlocked === true
          ? 12_500
          : 10_000;
      const charterRewardMultiplier = normalizeWorkValueMultiplier(
        value.activeSla.charterRewardMultiplier,
        createWorkValueMultiplier(
          `cloud-charter-${
            legacyCharterRewardBps === 12_500 ? "openCompute" : "standard"
          }`,
          legacyCharterRewardBps,
        ),
      );
      const observationElapsedMs = clampCloudInteger(
        value.activeSla.observationElapsedMs ?? value.activeSla.elapsedMs,
        0,
        definition.observationWindowMs,
        0,
      );
      const windowSource = isRecord(value.activeSla.window)
        ? value.activeSla.window
        : {};
      activeSla = {
        id: normalizeCloudId(value.activeSla.id, "sla-1"),
        definitionId,
        observationElapsedMs,
        workCompleted: amountMin(
          normalizeCloudAmount(value.activeSla.workCompleted),
          paidWorkUnits,
        ),
        paidWorkUnits,
        workValueMultiplier,
        charterRewardMultiplier,
        window: normalizeSlaWindowState(
          { ...windowSource, elapsedMs: observationElapsedMs },
        ),
      };
    }
  }

  const completedSlas = (Array.isArray(value.completedSlas)
    ? value.completedSlas
    : []
  ).flatMap((candidate): CompletedCloudSlaState[] => {
    if (!isRecord(candidate)) return [];
    const definitionId = candidate.definitionId;
    if (
      definitionId !== "regionalContinuity" &&
      definitionId !== "planetaryCoverage"
    ) {
      return [];
    }
    const evaluation = normalizeEvaluation(candidate.evaluation);
    const succeeded = candidate.succeeded === true && evaluation.success;
    const definition = getCloudSlaDefinition(definitionId);
    const paidWorkUnits = normalizeCloudAmount(
      candidate.paidWorkUnits,
      definition.workRequired,
    );
    const workValueMultiplier = normalizeWorkValueMultiplier(
      candidate.workValueMultiplier,
      definition.workValueMultiplier,
    );
    const legacyRewardBps = candidate.rewardBps === 12_500 ? 12_500 : 10_000;
    const charterRewardMultiplier = normalizeWorkValueMultiplier(
      candidate.charterRewardMultiplier,
      createWorkValueMultiplier(
        `cloud-charter-${legacyRewardBps === 12_500 ? "openCompute" : "standard"}`,
        legacyRewardBps,
      ),
    );
    const rewardBps = Number(charterRewardMultiplier.basisPoints);
    return [{
      id: normalizeCloudId(candidate.id, `completed-${definitionId}`),
      definitionId,
      succeeded,
      evaluation: { ...evaluation, success: succeeded },
      rewardBps,
      paidWorkUnits,
      workValueMultiplier,
      charterRewardMultiplier,
      rewards:
        succeeded
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
          : exactResourceBag(),
    }];
  })
    .filter(
      (completed, index, values) =>
        values.findIndex((candidate) => candidate.id === completed.id) === index,
    )
    .slice(-256);

  let finale: PlanetaryFinaleRuntime | null = null;
  if (isRecord(value.finale)) {
    try {
      finale = normalizePlanetaryFinaleRuntime(
        value.finale as unknown as PlanetaryFinaleRuntime,
      );
    } catch {
      finale = null;
    }
  }
  const savedFinaleCharterId: FinaleCharterId | null =
    value.finaleCharterId === "resilience" ||
    value.finaleCharterId === "efficiency" ||
    value.finaleCharterId === "openCompute"
      ? value.finaleCharterId
      : null;
  const finaleCharterId = finale?.complete === true
    ? savedFinaleCharterId
    : null;

  const maximumNumericId = [
    ...regions.map((region) => region.id),
    ...zones.map((zone) => zone.id),
    ...replicas.map((replica) => replica.id),
    ...incidents.map((incident) => incident.id),
    ...completedSlas.map((completed) => completed.id),
    activeSla?.id ?? "",
  ].reduce((maximum, id) => {
    const match = /-(\d+)$/.exec(id);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);

  return {
    elapsedMs: clampCloudInteger(value.elapsedMs, 0, MAX_SAFE_TIME_MS, 0),
    advanceRemainderMs:
      typeof value.advanceRemainderMs === "number" &&
      Number.isFinite(value.advanceRemainderMs)
        ? Math.max(0, Math.min(0.999999999999, value.advanceRemainderMs))
        : 0,
    nextEntityId: Math.max(
      maximumNumericId + 1,
      clampCloudInteger(value.nextEntityId, 1, Number.MAX_SAFE_INTEGER, 1),
    ),
    regions,
    zones,
    replicas,
    failover,
    automaticFailover: value.automaticFailover !== false,
    failoverDelayMs: clampCloudInteger(
      value.failoverDelayMs,
      0,
      24 * 60 * 60_000,
      fresh.failoverDelayMs,
    ),
    incidents,
    regionalDemands,
    routingLinks,
    activeSla,
    completedSlas,
    finale,
    finaleCharterId,
    postgameUnlocked:
      finale?.complete === true && finaleCharterId !== null,
  };
};
