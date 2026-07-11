import { amount, amountMultiply, type Amount } from "./amount";
import { getTaskDefinition } from "./content/tasks";
import { estimateJobSeconds } from "./math";
import type { GameState, TaskDefinition } from "./types";

export interface TaskBatchProjection {
  baseDurationMs: number;
  durationMs: number;
  multiplier: number;
  logicalWorkUnitCount: number;
  rewardCredits: Amount;
  workCycles: Amount;
  operationCount: Amount;
  paidWorkUnits: Amount;
}

export const normalizeTaskBatchMultiplier = (
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER,
) =>
  Math.max(
    1,
    Math.min(
      Math.max(1, Math.trunc(maximum)),
      typeof value === "number" && Number.isFinite(value)
        ? Math.trunc(value)
        : 1,
    ),
  );

const getBoundedChildConcurrency = (state: GameState) =>
  Math.max(
    1,
    state.hardware.cpus.reduce(
      (total, cpu) =>
        total + Math.min(cpu.coreIds.length, Math.max(1, cpu.schedulerSlots)),
      0,
    ),
  );

/** Estimates the complete bounded physical composition, including repeats. */
export const estimateTaskKernelSeconds = (
  state: GameState,
  task: TaskDefinition,
) => {
  if (task.composition.length === 0) return estimateJobSeconds(state, task);
  const concurrency = getBoundedChildConcurrency(state);
  return task.composition.reduce((seconds, entry) => {
    const child = getTaskDefinition(entry.taskId);
    const repeatCount =
      entry.count * (entry.mode === "perWorkUnit" ? task.workUnitCount : 1);
    const waves =
      entry.mode === "perWorkUnit"
        ? Math.ceil(repeatCount / concurrency)
        : repeatCount;
    return seconds + estimateJobSeconds(state, child) * waves;
  }, 0);
};

/**
 * Projects one bounded physical kernel plus an authored logical batch. The
 * multiplier is fixed content data, so hardware changes only the time needed to
 * move the same bits and execute the same cycles; it never rewrites the job size
 * to manufacture a target wall-clock duration.
 */
export const getTaskBatchProjection = (
  state: GameState,
  task: TaskDefinition,
): TaskBatchProjection => {
  const baseDurationMs = Math.max(
    0,
    estimateTaskKernelSeconds(state, task) * 1_000,
  );
  const aggregate = task.aggregateBatch;
  const multiplier = aggregate
    ? normalizeTaskBatchMultiplier(
        aggregate.workUnitMultiplier,
        aggregate.maximumMultiplier,
      )
    : 1;
  return {
    baseDurationMs,
    durationMs: baseDurationMs * multiplier,
    multiplier,
    logicalWorkUnitCount: task.workUnitCount * multiplier,
    rewardCredits: amountMultiply(task.rewardCreditsExact, multiplier),
    workCycles: amountMultiply(task.requiredCyclesExact, multiplier),
    operationCount: amountMultiply(task.operationCountExact, multiplier),
    paidWorkUnits: amountMultiply(task.paidWorkUnitsExact, multiplier),
  };
};

export const getStoredTaskWorkCycles = (
  task: TaskDefinition,
  projectedWorkCycles: Amount | string | undefined,
  batchMultiplier: number | undefined,
) => {
  if (projectedWorkCycles !== undefined) return amount(projectedWorkCycles);
  const multiplier = normalizeTaskBatchMultiplier(
    batchMultiplier,
    task.aggregateBatch?.maximumMultiplier ?? 1,
  );
  return amountMultiply(task.requiredCyclesExact, multiplier);
};

export const getStoredTaskRewardCredits = (
  task: TaskDefinition,
  projectedRewardCredits: Amount | string | undefined,
  batchMultiplier: number | undefined,
) => {
  if (projectedRewardCredits !== undefined) {
    return amount(projectedRewardCredits);
  }
  const multiplier = normalizeTaskBatchMultiplier(
    batchMultiplier,
    task.aggregateBatch?.maximumMultiplier ?? 1,
  );
  return amountMultiply(task.rewardCreditsExact, multiplier);
};
