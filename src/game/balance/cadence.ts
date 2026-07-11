import { createRngState, nextRngFloat } from "../rng";
import type { Xoshiro128State } from "../rng";
import type {
  DurationRange,
  ScheduleMode,
  SessionCadenceProfile,
  SessionKind,
  SessionScheduleEntry,
} from "./types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const duration = (minimum: number, target: number, maximum: number): DurationRange => ({
  minimumMs: minimum * MINUTE_MS,
  targetMs: target * MINUTE_MS,
  maximumMs: maximum * MINUTE_MS,
});

export const sessionCadenceProfiles: Readonly<
  Record<"fullIdle" | "regular" | "engaged" | "optimizer", SessionCadenceProfile>
> = {
  fullIdle: {
    id: "full-idle",
    label: "Full idle",
    activeDuration: duration(5, 8, 12),
    baseReturnDelayMs: 2 * HOUR_MS,
    decisionIntervalMs: MINUTE_MS,
    attendanceProbability: 1,
    returnJitterRatio: 0.03,
    offlineCapacityFillRatio: 0.94,
    deterministicSkipEvery: null,
    deepSession: null,
  },
  regular: {
    id: "regular",
    label: "Regular check-ins",
    activeDuration: duration(5, 12, 20),
    baseReturnDelayMs: DAY_MS,
    decisionIntervalMs: MINUTE_MS,
    attendanceProbability: 6 / 7,
    returnJitterRatio: 0.18,
    offlineCapacityFillRatio: null,
    // Deterministic acceptance runs model the promised cadence. Missed visits
    // belong to the seeded Monte Carlo distribution, where they must remain
    // visible as overflow instead of being silently clamped to the buffer.
    deterministicSkipEvery: null,
    deepSession: null,
  },
  engaged: {
    id: "engaged",
    label: "Engaged play",
    activeDuration: duration(8, 15, 20),
    baseReturnDelayMs: DAY_MS,
    decisionIntervalMs: MINUTE_MS,
    attendanceProbability: 0.95,
    returnJitterRatio: 0.15,
    offlineCapacityFillRatio: null,
    deterministicSkipEvery: null,
    deepSession: { intervalMs: WEEK_MS, duration: duration(30, 60, 90) },
  },
  optimizer: {
    id: "optimizer",
    label: "Optimizer",
    activeDuration: duration(20, 30, 45),
    baseReturnDelayMs: 6 * HOUR_MS,
    decisionIntervalMs: 30_000,
    attendanceProbability: 1,
    returnJitterRatio: 0.04,
    offlineCapacityFillRatio: null,
    deterministicSkipEvery: null,
    deepSession: null,
  },
};

interface RandomValue {
  rng: Xoshiro128State;
  value: number;
}

const randomValue = (rng: Xoshiro128State, mode: ScheduleMode): RandomValue => {
  if (mode === "deterministic") return { rng, value: 0.5 };
  const next = nextRngFloat(rng);
  return { rng: next.state, value: next.value };
};

const sampleRange = (
  range: DurationRange,
  mode: ScheduleMode,
  rng: Xoshiro128State,
): RandomValue => {
  if (mode === "deterministic") return { rng, value: range.targetMs };
  const next = randomValue(rng, mode);
  return {
    rng: next.rng,
    value: Math.round(range.minimumMs + next.value * (range.maximumMs - range.minimumMs)),
  };
};

export interface PlanSessionInput {
  profile: SessionCadenceProfile;
  mode: ScheduleMode;
  rng: Xoshiro128State;
  sessionIndex: number;
  nowMs: number;
  startAtMs: number;
  lastDeepSessionAtMs: number | null;
}

export interface PlannedSessionDuration {
  rng: Xoshiro128State;
  kind: SessionKind;
  activeDurationMs: number;
}

export const planSessionDuration = (input: PlanSessionInput): PlannedSessionDuration => {
  const deep = input.profile.deepSession;
  const deepDue = Boolean(
    deep &&
      input.nowMs - (input.lastDeepSessionAtMs ?? input.startAtMs) >= deep.intervalMs,
  );
  const kind: SessionKind = deepDue ? "deep" : "check-in";
  const sampled = sampleRange(
    deepDue && deep ? deep.duration : input.profile.activeDuration,
    input.mode,
    input.rng,
  );
  return { rng: sampled.rng, kind, activeDurationMs: sampled.value };
};

export interface PlanReturnInput {
  profile: SessionCadenceProfile;
  mode: ScheduleMode;
  rng: Xoshiro128State;
  nextSessionIndex: number;
  offlineCapacityMs: number;
}

export interface PlannedReturn {
  rng: Xoshiro128State;
  delayMs: number;
}

export const planReturnDelay = (input: PlanReturnInput): PlannedReturn => {
  const capacityTarget =
    input.offlineCapacityMs > 0
      ? input.offlineCapacityMs * (input.profile.offlineCapacityFillRatio ?? 0.94)
      : null;
  const capacityDelay =
    capacityTarget === null
      ? input.profile.baseReturnDelayMs
      : input.profile.offlineCapacityFillRatio !== null
        ? capacityTarget
        : Math.min(input.profile.baseReturnDelayMs, capacityTarget);
  let rng = input.rng;
  let delayMs = capacityDelay;

  if (input.mode === "deterministic") {
    if (
      input.profile.deterministicSkipEvery &&
      input.nextSessionIndex > 0 &&
      input.nextSessionIndex % input.profile.deterministicSkipEvery === 0
    ) {
      delayMs += input.profile.baseReturnDelayMs;
    }
  } else {
    const jitter = randomValue(rng, input.mode);
    rng = jitter.rng;
    delayMs *= 1 + (jitter.value * 2 - 1) * input.profile.returnJitterRatio;
    let attendance = randomValue(rng, input.mode);
    rng = attendance.rng;
    let missed = 0;
    while (attendance.value > input.profile.attendanceProbability && missed < 13) {
      delayMs += input.profile.baseReturnDelayMs;
      missed += 1;
      attendance = randomValue(rng, input.mode);
      rng = attendance.rng;
    }
  }

  return { rng, delayMs: Math.max(1, Math.round(delayMs)) };
};

export interface GenerateSessionScheduleOptions {
  profile: SessionCadenceProfile;
  mode: ScheduleMode;
  seed: number;
  startAtMs: number;
  endAtMs: number;
  offlineCapacityAt?: (atMs: number, sessionIndex: number) => number;
}

/** Generates deterministic fixtures or seeded Monte Carlo visit schedules. */
export const generateSessionSchedule = (
  options: GenerateSessionScheduleOptions,
): SessionScheduleEntry[] => {
  const sessions: SessionScheduleEntry[] = [];
  let rng = createRngState(options.seed);
  let nowMs = options.startAtMs;
  let lastDeepSessionAtMs: number | null = null;
  let sessionIndex = 0;

  while (nowMs <= options.endAtMs) {
    const session = planSessionDuration({
      profile: options.profile,
      mode: options.mode,
      rng,
      sessionIndex,
      nowMs,
      startAtMs: options.startAtMs,
      lastDeepSessionAtMs,
    });
    rng = session.rng;
    sessions.push({
      index: sessionIndex,
      startsAtMs: nowMs,
      activeDurationMs: session.activeDurationMs,
      kind: session.kind,
    });
    if (session.kind === "deep") lastDeepSessionAtMs = nowMs;

    const returned = planReturnDelay({
      profile: options.profile,
      mode: options.mode,
      rng,
      nextSessionIndex: sessionIndex + 1,
      offlineCapacityMs: options.offlineCapacityAt?.(nowMs, sessionIndex) ?? 0,
    });
    rng = returned.rng;
    nowMs += session.activeDurationMs + returned.delayMs;
    sessionIndex += 1;
  }

  return sessions;
};
