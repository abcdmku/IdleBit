import {
  ZERO_AMOUNT,
  amount,
  amountClampMin,
  amountCompare,
  amountDivide,
  amountMax,
  amountMin,
  amountMultiply,
  amountSubtract,
  amountToNumber,
  type Amount,
} from "./amount";
import {
  capacityWorkFits,
  createCapacityWorkRuntime,
  getCapacityWorkBlockers,
  normalizeCapacityWorkFitCapacity,
  normalizeCapacityWorkPlan,
  normalizeCapacityWorkRuntime,
  type CapacityWorkBlocker,
  type CapacityWorkFitCapacity,
  type CapacityWorkPlan,
  type CapacityWorkRuntime,
} from "./capacityWork";
import type { RateVector } from "./infrastructureTypes";
import {
  createRateVector,
  exactRateResourceIds,
  isEmptyRateVector,
} from "./weightedFair";

type AmountValue = Amount | string | number;

export const RECOMMENDED_WORK_MARGIN_BPS = 3_000;
export const MAX_PROJECTED_MARGIN_BPS = 10_000;
export const MIN_PROJECTED_MARGIN_BPS = -1_000_000;

export interface WorkProjectionConditions {
  allocatedRates: RateVector;
  fitCapacity: CapacityWorkFitCapacity;
  operatingCreditsPerSecond: Amount;
  automationBufferMs: Amount;
}

export type WorkProjectionPauseReason =
  | "completed"
  | CapacityWorkBlocker
  | "automation-buffer";

export interface WorkProjection {
  durationMs: Amount | null;
  operatingCost: Amount | null;
  netCreditReward: Amount | null;
  exactMarginBps: Amount | null;
  marginBps: number | null;
  isProfitable: boolean | null;
  meetsRecommendedMargin: boolean | null;
  fits: boolean;
  automationBufferMs: Amount;
  bufferCovered: boolean;
  bufferShortfallMs: Amount | null;
  blockers: CapacityWorkBlocker[];
  pauseReason: WorkProjectionPauseReason | null;
}

export const normalizeWorkProjectionConditions = (
  conditions: WorkProjectionConditions,
): WorkProjectionConditions => ({
  allocatedRates: createRateVector(conditions.allocatedRates),
  fitCapacity: normalizeCapacityWorkFitCapacity(conditions.fitCapacity),
  operatingCreditsPerSecond: amountClampMin(
    conditions.operatingCreditsPerSecond,
  ),
  automationBufferMs: amountClampMin(conditions.automationBufferMs),
});

export const createWorkProjectionConditions = (input: {
  allocatedRates?: Partial<Record<keyof RateVector, AmountValue>>;
  memoryBits?: AmountValue;
  storageBits?: AmountValue;
  operatingCreditsPerSecond?: AmountValue;
  automationBufferMs?: AmountValue;
} = {}): WorkProjectionConditions =>
  normalizeWorkProjectionConditions({
    allocatedRates: createRateVector(input.allocatedRates),
    fitCapacity: {
      memoryBits: amount(input.memoryBits ?? 0),
      storageBits: amount(input.storageBits ?? 0),
    },
    operatingCreditsPerSecond: amount(
      input.operatingCreditsPerSecond ?? 0,
    ),
    automationBufferMs: amount(input.automationBufferMs ?? 0),
  });

/** Exact remaining duration; null means fit- or rate-blocked. */
export const getProjectedCapacityWorkDurationMs = (
  inputRuntime: CapacityWorkRuntime,
  inputRates: RateVector,
  inputFitCapacity: CapacityWorkFitCapacity,
): Amount | null => {
  const runtime = normalizeCapacityWorkRuntime(inputRuntime);
  if (runtime.rewardIssued) return ZERO_AMOUNT;
  const rates = createRateVector(inputRates);
  const fitCapacity = normalizeCapacityWorkFitCapacity(inputFitCapacity);
  if (!capacityWorkFits(runtime.plan, fitCapacity)) return null;
  if (isEmptyRateVector(runtime.remainingWork)) return ZERO_AMOUNT;

  let durationMs = ZERO_AMOUNT;
  for (const resource of exactRateResourceIds) {
    const remaining = runtime.remainingWork[resource];
    if (amountCompare(remaining, 0) <= 0) continue;
    const rate = rates[resource];
    if (amountCompare(rate, 0) <= 0) return null;
    durationMs = amountMax(
      durationMs,
      amountMultiply(amountDivide(remaining, rate), 1000),
    );
  }
  return durationMs;
};

export const getExactWorkMarginBps = (
  netCreditReward: AmountValue,
  grossCreditReward: AmountValue,
): Amount | null => {
  const gross = amount(grossCreditReward);
  if (amountCompare(gross, 0) <= 0) return null;
  return amountDivide(amountMultiply(netCreditReward, 10_000), gross);
};

/** Exact cross-multiplied margin comparison; no Amount is projected. */
export const compareWorkMarginToBps = (
  netCreditReward: AmountValue,
  grossCreditReward: AmountValue,
  thresholdBps: number,
) => {
  const gross = amount(grossCreditReward);
  if (amountCompare(gross, 0) <= 0) return -1;
  return amountCompare(
    amountMultiply(netCreditReward, 10_000),
    amountMultiply(gross, Math.trunc(thresholdBps)),
  );
};

/** Only this bounded UI projection converts an Amount to Number. */
export const projectWorkMarginBps = (
  exactMarginBps: Amount | null,
): number | null => {
  if (exactMarginBps === null) return null;
  const bounded = amountMax(
    MIN_PROJECTED_MARGIN_BPS,
    amountMin(MAX_PROJECTED_MARGIN_BPS, exactMarginBps),
  );
  return Math.round(amountToNumber(bounded));
};

const projectRuntime = (
  inputRuntime: CapacityWorkRuntime,
  inputConditions: WorkProjectionConditions,
): WorkProjection => {
  const runtime = normalizeCapacityWorkRuntime(inputRuntime);
  const conditions = normalizeWorkProjectionConditions(inputConditions);
  const fits = capacityWorkFits(runtime.plan, conditions.fitCapacity);
  const blockers = getCapacityWorkBlockers(
    runtime,
    conditions.allocatedRates,
    conditions.fitCapacity,
  );
  const durationMs = getProjectedCapacityWorkDurationMs(
    runtime,
    conditions.allocatedRates,
    conditions.fitCapacity,
  );
  const completed = runtime.rewardIssued;
  const automationBufferMs = conditions.automationBufferMs;
  const bufferCovered =
    durationMs !== null && amountCompare(durationMs, automationBufferMs) <= 0;
  const bufferShortfallMs =
    durationMs === null
      ? null
      : amountMax(amountSubtract(durationMs, automationBufferMs), 0);

  if (completed) {
    return {
      durationMs: ZERO_AMOUNT,
      operatingCost: ZERO_AMOUNT,
      netCreditReward: ZERO_AMOUNT,
      exactMarginBps: null,
      marginBps: null,
      isProfitable: null,
      meetsRecommendedMargin: null,
      fits,
      automationBufferMs,
      bufferCovered: true,
      bufferShortfallMs: ZERO_AMOUNT,
      blockers: [],
      pauseReason: "completed",
    };
  }

  if (durationMs === null) {
    return {
      durationMs: null,
      operatingCost: null,
      netCreditReward: null,
      exactMarginBps: null,
      marginBps: null,
      isProfitable: null,
      meetsRecommendedMargin: null,
      fits,
      automationBufferMs,
      bufferCovered: false,
      bufferShortfallMs: null,
      blockers,
      pauseReason: blockers[0] ?? null,
    };
  }

  const operatingCost = amountDivide(
    amountMultiply(conditions.operatingCreditsPerSecond, durationMs),
    1000,
  );
  const grossCreditReward = runtime.plan.reward.credits;
  const netCreditReward = amountSubtract(grossCreditReward, operatingCost);
  const exactMarginBps = getExactWorkMarginBps(
    netCreditReward,
    grossCreditReward,
  );
  return {
    durationMs,
    operatingCost,
    netCreditReward,
    exactMarginBps,
    marginBps: projectWorkMarginBps(exactMarginBps),
    isProfitable: amountCompare(netCreditReward, 0) > 0,
    meetsRecommendedMargin:
      compareWorkMarginToBps(
        netCreditReward,
        grossCreditReward,
        RECOMMENDED_WORK_MARGIN_BPS,
      ) >= 0,
    fits,
    automationBufferMs,
    bufferCovered,
    bufferShortfallMs,
    blockers,
    pauseReason: bufferCovered ? null : "automation-buffer",
  };
};

export const projectCapacityWorkRuntime = (
  runtime: CapacityWorkRuntime,
  conditions: WorkProjectionConditions,
) => projectRuntime(runtime, conditions);

export const projectCapacityWorkPlan = (
  plan: CapacityWorkPlan,
  conditions: WorkProjectionConditions,
) =>
  projectRuntime(
    createCapacityWorkRuntime(normalizeCapacityWorkPlan(plan)),
    conditions,
  );
