import { nextRngInt, type Xoshiro128State } from "./rng";

export const SLA_LATENCY_BUCKETS_MS = [
  25,
  50,
  100,
  200,
  400,
  800,
  1_600,
  3_200,
  null,
] as const;

export interface SlaPolicy {
  availabilityTargetBps: number;
  minimumReplicaQuorum: number;
  maximumP95LatencyMs: number;
  deadlineMs: number | null;
}

export interface SlaLatencyBucket {
  upperBoundMs: number | null;
  durationMs: number;
}

export interface SlaWindowState {
  elapsedMs: number;
  availableMs: number;
  quorumViolationMs: number;
  serviceViolationMs: number;
  commitElapsedMs: number | null;
  latencyBuckets: SlaLatencyBucket[];
}

export interface SlaIntervalSample {
  elapsedMs: number;
  serviceOnline: boolean;
  healthyReplicaFaultDomains: readonly string[];
  latencyMs: number | null;
  committed?: boolean;
}

export interface SlaEvaluation {
  availabilityBps: number;
  p95LatencyMs: number | null;
  distinctQuorumViolationMs: number;
  serviceViolationMs: number;
  deadlineMet: boolean;
  availabilityMet: boolean;
  latencyMet: boolean;
  success: boolean;
}

const boundedInteger = (
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(value)))
    : fallback;

export const normalizeSlaPolicy = (
  value: Partial<SlaPolicy> | null | undefined,
): SlaPolicy => ({
  availabilityTargetBps: boundedInteger(
    value?.availabilityTargetBps,
    0,
    10_000,
    9_900,
  ),
  minimumReplicaQuorum: boundedInteger(
    value?.minimumReplicaQuorum,
    1,
    1_000,
    1,
  ),
  maximumP95LatencyMs: boundedInteger(
    value?.maximumP95LatencyMs,
    1,
    Number.MAX_SAFE_INTEGER,
    400,
  ),
  deadlineMs:
    value?.deadlineMs === null
      ? null
      : boundedInteger(
          value?.deadlineMs,
          1,
          Number.MAX_SAFE_INTEGER,
          24 * 60 * 60 * 1_000,
        ),
});

const emptyLatencyBuckets = (): SlaLatencyBucket[] =>
  SLA_LATENCY_BUCKETS_MS.map((upperBoundMs) => ({
    upperBoundMs,
    durationMs: 0,
  }));

export const createSlaWindowState = (): SlaWindowState => ({
  elapsedMs: 0,
  availableMs: 0,
  quorumViolationMs: 0,
  serviceViolationMs: 0,
  commitElapsedMs: null,
  latencyBuckets: emptyLatencyBuckets(),
});

export const normalizeSlaWindowState = (
  value: Partial<SlaWindowState> | null | undefined,
): SlaWindowState => {
  const elapsedMs = boundedInteger(
    value?.elapsedMs,
    0,
    Number.MAX_SAFE_INTEGER,
    0,
  );
  const sourceBuckets = Array.isArray(value?.latencyBuckets)
    ? value.latencyBuckets
    : [];
  let remainingLatencyMs = boundedInteger(
    value?.availableMs,
    0,
    elapsedMs,
    0,
  );
  const latencyBuckets = SLA_LATENCY_BUCKETS_MS.map((upperBoundMs) => {
    const source = sourceBuckets.find(
      (bucket) => bucket?.upperBoundMs === upperBoundMs,
    );
    const durationMs = Math.min(
      remainingLatencyMs,
      boundedInteger(source?.durationMs, 0, elapsedMs, 0),
    );
    remainingLatencyMs -= durationMs;
    return { upperBoundMs, durationMs };
  });
  const commitElapsedMs =
    typeof value?.commitElapsedMs === "number" &&
    Number.isFinite(value.commitElapsedMs) &&
    value.commitElapsedMs >= 0 &&
    value.commitElapsedMs <= elapsedMs
      ? Math.trunc(value.commitElapsedMs)
      : null;
  return {
    elapsedMs,
    availableMs: boundedInteger(
      value?.availableMs,
      0,
      elapsedMs,
      0,
    ),
    quorumViolationMs: boundedInteger(
      value?.quorumViolationMs,
      0,
      elapsedMs,
      0,
    ),
    serviceViolationMs: boundedInteger(
      value?.serviceViolationMs,
      0,
      elapsedMs,
      0,
    ),
    commitElapsedMs,
    latencyBuckets,
  };
};

const latencyBucketIndex = (latencyMs: number) => {
  const index = SLA_LATENCY_BUCKETS_MS.findIndex(
    (upperBoundMs) => upperBoundMs === null || latencyMs <= upperBoundMs,
  );
  return index < 0 ? SLA_LATENCY_BUCKETS_MS.length - 1 : index;
};

/** Records one time interval; availability is integrated, never sampled by tick count. */
export const recordSlaInterval = (
  input: SlaWindowState,
  policyInput: SlaPolicy,
  sample: SlaIntervalSample,
): SlaWindowState => {
  const state = normalizeSlaWindowState(input);
  const policy = normalizeSlaPolicy(policyInput);
  const elapsedMs = boundedInteger(
    sample.elapsedMs,
    0,
    Number.MAX_SAFE_INTEGER - state.elapsedMs,
    0,
  );
  if (elapsedMs === 0) return state;
  const distinctDomains = new Set(
    sample.healthyReplicaFaultDomains.filter(Boolean),
  ).size;
  const quorumMet = distinctDomains >= policy.minimumReplicaQuorum;
  const available = sample.serviceOnline && quorumMet;
  const latencyBuckets = state.latencyBuckets.map((bucket) => ({ ...bucket }));
  if (
    available &&
    sample.latencyMs !== null &&
    Number.isFinite(sample.latencyMs) &&
    sample.latencyMs >= 0
  ) {
    latencyBuckets[latencyBucketIndex(sample.latencyMs)]!.durationMs += elapsedMs;
  }
  const nextElapsedMs = state.elapsedMs + elapsedMs;
  return {
    elapsedMs: nextElapsedMs,
    availableMs: state.availableMs + (available ? elapsedMs : 0),
    quorumViolationMs:
      state.quorumViolationMs + (!quorumMet ? elapsedMs : 0),
    serviceViolationMs:
      state.serviceViolationMs + (!sample.serviceOnline ? elapsedMs : 0),
    commitElapsedMs:
      state.commitElapsedMs ??
      (sample.committed && available ? nextElapsedMs : null),
    latencyBuckets,
  };
};

export const getSlaP95LatencyMs = (stateInput: SlaWindowState) => {
  const state = normalizeSlaWindowState(stateInput);
  const sampledMs = state.latencyBuckets.reduce(
    (total, bucket) => total + bucket.durationMs,
    0,
  );
  if (sampledMs <= 0) return null;
  const threshold = sampledMs * 0.95;
  let cumulative = 0;
  for (const bucket of state.latencyBuckets) {
    cumulative += bucket.durationMs;
    if (cumulative >= threshold) {
      return bucket.upperBoundMs ?? Number.POSITIVE_INFINITY;
    }
  }
  return Number.POSITIVE_INFINITY;
};

export const evaluateSlaWindow = (
  stateInput: SlaWindowState,
  policyInput: SlaPolicy,
): SlaEvaluation => {
  const state = normalizeSlaWindowState(stateInput);
  const policy = normalizeSlaPolicy(policyInput);
  const availabilityBps =
    state.elapsedMs > 0
      ? Math.max(
          0,
          Math.min(10_000, Math.floor((state.availableMs / state.elapsedMs) * 10_000)),
        )
      : 0;
  const p95LatencyMs = getSlaP95LatencyMs(state);
  const deadlineMet =
    policy.deadlineMs === null ||
    (state.commitElapsedMs !== null && state.commitElapsedMs <= policy.deadlineMs);
  const availabilityMet = availabilityBps >= policy.availabilityTargetBps;
  const latencyMet =
    p95LatencyMs !== null && p95LatencyMs <= policy.maximumP95LatencyMs;
  return {
    availabilityBps,
    p95LatencyMs,
    distinctQuorumViolationMs: state.quorumViolationMs,
    serviceViolationMs: state.serviceViolationMs,
    deadlineMet,
    availabilityMet,
    latencyMet,
    success: deadlineMet && availabilityMet && latencyMet,
  };
};

export type ZoneOperatingStatus = "online" | "derated" | "paused";

export interface AvailabilityZoneState {
  id: string;
  faultDomainId: string;
  status: ZoneOperatingStatus;
  capacityBps: number;
}

export interface ServiceReplicaState {
  id: string;
  zoneId: string;
  healthy: boolean;
}

export interface FailoverState {
  activeZoneId: string | null;
  pendingZoneId: string | null;
  completesAtMs: number | null;
  lastCompletedAtMs: number | null;
}

export const getHealthyReplicaFaultDomains = (
  zones: readonly AvailabilityZoneState[],
  replicas: readonly ServiceReplicaState[],
) => {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  return [
    ...new Set(
      replicas.flatMap((replica) => {
        const zone = zoneById.get(replica.zoneId);
        return replica.healthy && zone && zone.status !== "paused"
          ? [zone.faultDomainId]
          : [];
      }),
    ),
  ].sort();
};

export const requestFailover = (input: {
  state: FailoverState;
  nowMs: number;
  delayMs: number;
  zones: readonly AvailabilityZoneState[];
  replicas: readonly ServiceReplicaState[];
}) => {
  const candidates = input.zones
    .filter(
      (zone) =>
        zone.status !== "paused" &&
        zone.id !== input.state.activeZoneId &&
        input.replicas.some(
          (replica) => replica.zoneId === zone.id && replica.healthy,
        ),
    )
    .sort((left, right) =>
      right.capacityBps - left.capacityBps || left.id.localeCompare(right.id),
    );
  const target = candidates[0];
  if (!target) return input.state;
  return {
    ...input.state,
    pendingZoneId: target.id,
    completesAtMs:
      Math.max(0, Math.trunc(input.nowMs)) +
      Math.max(0, Math.trunc(input.delayMs)),
  };
};

export const advanceFailover = (state: FailoverState, nowMs: number): FailoverState => {
  if (
    state.pendingZoneId === null ||
    state.completesAtMs === null ||
    nowMs < state.completesAtMs
  ) {
    return state;
  }
  return {
    activeZoneId: state.pendingZoneId,
    pendingZoneId: null,
    completesAtMs: null,
    lastCompletedAtMs: state.completesAtMs,
  };
};

export const getNextFailoverEventMs = (state: FailoverState, nowMs: number) =>
  state.completesAtMs === null
    ? null
    : Math.max(0, state.completesAtMs - Math.max(0, Math.trunc(nowMs)));

export interface OptInIncidentSchedule {
  id: string;
  zoneId: string;
  startsAtMs: number;
  endsAtMs: number;
  derateBps: number;
}

export interface IncidentDrawResult {
  rng: Xoshiro128State;
  incident: OptInIncidentSchedule | null;
}

/** No opt-in means no draw and therefore no hidden future incident. */
export const drawOptInIncident = (input: {
  rng: Xoshiro128State;
  optIn: boolean;
  nowMs: number;
  windowMs: number;
  zoneIds: readonly string[];
  incidentIndex: number;
}): IncidentDrawResult => {
  const zoneIds = [...new Set(input.zoneIds.filter(Boolean))].sort();
  if (!input.optIn || zoneIds.length === 0 || input.windowMs <= 0) {
    return { rng: input.rng, incident: null };
  }
  const zoneDraw = nextRngInt(input.rng, 0, zoneIds.length);
  const delayDraw = nextRngInt(
    zoneDraw.state,
    0,
    Math.max(1, Math.trunc(input.windowMs)),
  );
  const maximumDuration = Math.max(1, Math.trunc(input.windowMs / 4));
  const durationDraw = nextRngInt(delayDraw.state, 1, maximumDuration + 1);
  const derateDraw = nextRngInt(durationDraw.state, 2_500, 7_501);
  const startsAtMs = Math.max(0, Math.trunc(input.nowMs)) + delayDraw.value;
  return {
    rng: derateDraw.state,
    incident: {
      id: `incident-${Math.max(1, Math.trunc(input.incidentIndex))}`,
      zoneId: zoneIds[zoneDraw.value]!,
      startsAtMs,
      endsAtMs: startsAtMs + durationDraw.value,
      derateBps: derateDraw.value,
    },
  };
};

export const getIncidentZoneStatus = (
  incident: OptInIncidentSchedule,
  nowMs: number,
): Pick<AvailabilityZoneState, "status" | "capacityBps"> => {
  if (nowMs < incident.startsAtMs || nowMs >= incident.endsAtMs) {
    return { status: "online", capacityBps: 10_000 };
  }
  const capacityBps = Math.max(0, 10_000 - incident.derateBps);
  return {
    status: capacityBps > 0 ? "derated" : "paused",
    capacityBps,
  };
};
