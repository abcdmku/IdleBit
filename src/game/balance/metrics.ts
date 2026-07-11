import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountDivide,
  amountMin,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  type Amount,
} from "../amount";
import type { AdvanceReport } from "../types";
import type {
  CampaignMetricSample,
  CampaignMilestoneMetric,
  CampaignRunMetrics,
  EngagementProfileId,
  ReachedMilestone,
  ResourceScarcityMetric,
  ScheduleMode,
} from "./types";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

interface ResourceAccumulator {
  minimumBalance: Amount | null;
  sampledMs: number;
  scarceMs: number;
}

export interface CampaignMetricAccumulator {
  activeMs: number;
  offlineMs: number;
  productiveOfflineMs: number;
  pausedOfflineMs: number;
  overflowMs: number;
  outputUnits: Amount;
  standingOrderOutputUnits: Amount;
  contractOutputUnits: Amount;
  resources: Map<string, ResourceAccumulator>;
  benefit: Amount;
  cost: Amount;
  minimumPowerRunwayHours: number | null;
  weightedPowerRunwayHours: number;
  powerRunwaySampledMs: number;
  belowTargetPowerRunwayMs: number;
  powerRunwayTargetHours: number;
  blockedMs: number;
  blockingByReasonMs: Map<string, number>;
  availableCapacityHours: Amount;
  unusedCapacityHours: Amount;
  milestones: Map<string, CampaignMilestoneMetric>;
}

export const createMetricAccumulator = (
  powerRunwayTargetHours = 24,
): CampaignMetricAccumulator => ({
  activeMs: 0,
  offlineMs: 0,
  productiveOfflineMs: 0,
  pausedOfflineMs: 0,
  overflowMs: 0,
  outputUnits: ZERO_AMOUNT,
  standingOrderOutputUnits: ZERO_AMOUNT,
  contractOutputUnits: ZERO_AMOUNT,
  resources: new Map(),
  benefit: ZERO_AMOUNT,
  cost: ZERO_AMOUNT,
  minimumPowerRunwayHours: null,
  weightedPowerRunwayHours: 0,
  powerRunwaySampledMs: 0,
  belowTargetPowerRunwayMs: 0,
  powerRunwayTargetHours,
  blockedMs: 0,
  blockingByReasonMs: new Map(),
  availableCapacityHours: ZERO_AMOUNT,
  unusedCapacityHours: ZERO_AMOUNT,
  milestones: new Map(),
});

const finiteNonNegative = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;

export const recordMilestones = (
  accumulator: CampaignMetricAccumulator,
  reached: readonly ReachedMilestone[],
  nowMs: number,
  startedAtMs: number,
) => {
  for (const milestone of reached) {
    if (accumulator.milestones.has(milestone.id)) continue;
    accumulator.milestones.set(milestone.id, {
      ...milestone,
      reachedAtMs: nowMs,
      elapsedDays: (nowMs - startedAtMs) / DAY_MS,
    });
  }
};

export const recordMetricInterval = (
  accumulator: CampaignMetricAccumulator,
  intervalKind: "active" | "offline",
  elapsedMs: number,
  report: AdvanceReport,
  sample: CampaignMetricSample,
) => {
  const intervalMs = finiteNonNegative(elapsedMs);
  if (intervalKind === "active") {
    accumulator.activeMs += intervalMs;
  } else {
    accumulator.offlineMs += intervalMs;
    accumulator.productiveOfflineMs += finiteNonNegative(report.productiveMs);
    accumulator.pausedOfflineMs += finiteNonNegative(report.pausedMs);
    accumulator.overflowMs += finiteNonNegative(report.overflowMs);
  }

  accumulator.outputUnits = amountAdd(
    accumulator.outputUnits,
    amountClampMin(sample.outputUnits ?? ZERO_AMOUNT),
  );
  accumulator.standingOrderOutputUnits = amountAdd(
    accumulator.standingOrderOutputUnits,
    amountClampMin(sample.standingOrderOutputUnits ?? ZERO_AMOUNT),
  );
  accumulator.contractOutputUnits = amountAdd(
    accumulator.contractOutputUnits,
    amountClampMin(sample.contractOutputUnits ?? ZERO_AMOUNT),
  );
  accumulator.benefit = amountAdd(
    accumulator.benefit,
    amountClampMin(sample.roi?.benefit ?? ZERO_AMOUNT),
  );
  accumulator.cost = amountAdd(
    accumulator.cost,
    amountClampMin(sample.roi?.cost ?? ZERO_AMOUNT),
  );

  const scarce = new Set(sample.scarceResourceIds ?? []);
  for (const [resourceId, balance] of Object.entries(sample.resourceBalances ?? {})) {
    const current = accumulator.resources.get(resourceId) ?? {
      minimumBalance: null,
      sampledMs: 0,
      scarceMs: 0,
    };
    const exactBalance = amountClampMin(balance);
    current.minimumBalance =
      current.minimumBalance === null
        ? exactBalance
        : amountMin(current.minimumBalance, exactBalance);
    current.sampledMs += intervalMs;
    if (scarce.has(resourceId)) current.scarceMs += intervalMs;
    accumulator.resources.set(resourceId, current);
  }

  const runway = sample.powerRunwayHours;
  if (runway !== null && runway !== undefined && Number.isFinite(runway)) {
    const normalized = Math.max(0, runway);
    accumulator.minimumPowerRunwayHours = Math.min(
      accumulator.minimumPowerRunwayHours ?? normalized,
      normalized,
    );
    accumulator.weightedPowerRunwayHours += normalized * intervalMs;
    accumulator.powerRunwaySampledMs += intervalMs;
    if (normalized < accumulator.powerRunwayTargetHours) {
      accumulator.belowTargetPowerRunwayMs += intervalMs;
    }
  }

  const sampleReasons = sample.blockingReasons ?? [];
  const reasons = [...new Set([...(report.blockers ?? []), ...sampleReasons])];
  const blockedMs = Math.min(
    intervalMs,
    Math.max(
      finiteNonNegative(report.pausedMs),
      sampleReasons.length > 0 ? intervalMs : 0,
    ),
  );
  accumulator.blockedMs += blockedMs;
  for (const reason of reasons) {
    accumulator.blockingByReasonMs.set(
      reason,
      (accumulator.blockingByReasonMs.get(reason) ?? 0) + blockedMs,
    );
  }

  const totalCapacity = amountClampMin(sample.totalCapacity ?? ZERO_AMOUNT);
  const usedCapacity = amountMin(
    totalCapacity,
    amountClampMin(sample.usedCapacity ?? ZERO_AMOUNT),
  );
  const intervalHours = amountDivide(amount(intervalMs), HOUR_MS);
  accumulator.availableCapacityHours = amountAdd(
    accumulator.availableCapacityHours,
    amountMultiply(totalCapacity, intervalHours),
  );
  accumulator.unusedCapacityHours = amountAdd(
    accumulator.unusedCapacityHours,
    amountMultiply(amountSubtract(totalCapacity, usedCapacity), intervalHours),
  );
};

const ratio = (numerator: number, denominator: number) =>
  denominator > 0 ? numerator / denominator : 0;

const exactRatio = (numerator: Amount, denominator: Amount) =>
  amountCompare(denominator, 0) > 0
    ? amountToSafeNumber(amountDivide(numerator, denominator))
    : 0;

const finalizeScarcity = (
  accumulator: CampaignMetricAccumulator,
): ResourceScarcityMetric[] =>
  [...accumulator.resources.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resourceId, value]) => ({
      resourceId,
      minimumBalance: value.minimumBalance ?? ZERO_AMOUNT,
      sampledHours: value.sampledMs / HOUR_MS,
      scarceHours: value.scarceMs / HOUR_MS,
      scarcityShare: ratio(value.scarceMs, value.sampledMs),
    }));

export interface FinalizeMetricsInput {
  profileId: EngagementProfileId;
  seed: number;
  scheduleMode: ScheduleMode;
  startedAtMs: number;
  endedAtMs: number;
  completed: boolean;
  sessionCount: number;
}

export const finalizeCampaignMetrics = (
  accumulator: CampaignMetricAccumulator,
  input: FinalizeMetricsInput,
): CampaignRunMetrics => {
  const elapsedMs = Math.max(0, input.endedAtMs - input.startedAtMs);
  const netValue = amountSubtract(accumulator.benefit, accumulator.cost);
  return {
    runId: `${input.profileId}-${input.seed}`,
    profileId: input.profileId,
    seed: input.seed,
    scheduleMode: input.scheduleMode,
    status: input.completed ? "completed" : "horizon-reached",
    startedAtMs: input.startedAtMs,
    completedAtMs: input.completed ? input.endedAtMs : null,
    elapsedCalendarMs: elapsedMs,
    elapsedCalendarDays: elapsedMs / DAY_MS,
    sessionCount: input.sessionCount,
    activeMinutes: accumulator.activeMs / 60_000,
    offlineHours: accumulator.offlineMs / HOUR_MS,
    productiveOfflineHours: accumulator.productiveOfflineMs / HOUR_MS,
    pausedOfflineHours: accumulator.pausedOfflineMs / HOUR_MS,
    overflowHours: accumulator.overflowMs / HOUR_MS,
    overflowShare: ratio(accumulator.overflowMs, accumulator.offlineMs),
    milestones: [...accumulator.milestones.values()],
    workMix: {
      outputUnits: accumulator.outputUnits,
      standingOrderOutputUnits: accumulator.standingOrderOutputUnits,
      contractOutputUnits: accumulator.contractOutputUnits,
      standingOrderShare: exactRatio(
        accumulator.standingOrderOutputUnits,
        accumulator.outputUnits,
      ),
      contractShare: exactRatio(
        accumulator.contractOutputUnits,
        accumulator.outputUnits,
      ),
    },
    resourceScarcity: finalizeScarcity(accumulator),
    roi: {
      benefit: accumulator.benefit,
      cost: accumulator.cost,
      netValue,
      returnRatio:
        amountCompare(accumulator.cost, 0) > 0
          ? amountToSafeNumber(amountDivide(netValue, accumulator.cost))
          : null,
    },
    powerRunway: {
      minimumHours: accumulator.minimumPowerRunwayHours,
      averageHours:
        accumulator.powerRunwaySampledMs > 0
          ? accumulator.weightedPowerRunwayHours / accumulator.powerRunwaySampledMs
          : null,
      belowTargetHours: accumulator.belowTargetPowerRunwayMs / HOUR_MS,
      targetHours: accumulator.powerRunwayTargetHours,
    },
    blocking: {
      blockedHours: accumulator.blockedMs / HOUR_MS,
      blockedShare: ratio(accumulator.blockedMs, elapsedMs),
      byReasonHours: Object.fromEntries(
        [...accumulator.blockingByReasonMs.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([reason, milliseconds]) => [reason, milliseconds / HOUR_MS]),
      ),
    },
    unusedCapacity: {
      availableCapacityHours: accumulator.availableCapacityHours,
      unusedCapacityHours: accumulator.unusedCapacityHours,
      unusedShare: exactRatio(
        accumulator.unusedCapacityHours,
        accumulator.availableCapacityHours,
      ),
    },
  };
};
