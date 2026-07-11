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
  exactResourceBag,
  type Amount,
  type ExactResourceBag,
} from "./amount";
import type {
  RateResourceId,
  RateVector,
} from "./infrastructureTypes";
import {
  addRateVectors,
  createRateVector,
  exactRateResourceIds,
  isEmptyRateVector,
} from "./weightedFair";

type AmountValue = Amount | string | number;

export interface CapacityWorkPlan {
  id: string;
  /** Total exact work required in each independently met rate dimension. */
  work: RateVector;
  /** Admission requirement; this capacity is reserved, not consumed. */
  memoryBits: Amount;
  /** Admission requirement; this capacity is reserved, not consumed. */
  storageBits: Amount;
  reward: ExactResourceBag;
}

export interface CapacityWorkFitCapacity {
  memoryBits: Amount;
  storageBits: Amount;
}

export type CapacityWorkBlocker =
  | "memory-fit"
  | "storage-fit"
  | `rate:${RateResourceId}`;

export type CapacityWorkStatus = "running" | "paused" | "completed";

/** JSON-safe state intended to be embedded by contracts and projects. */
export interface CapacityWorkRuntime {
  plan: CapacityWorkPlan;
  elapsedMs: Amount;
  remainingWork: RateVector;
  blockers: CapacityWorkBlocker[];
  status: CapacityWorkStatus;
  completed: boolean;
  rewardIssued: boolean;
}

export interface CapacityWorkAdvanceResult {
  runtime: CapacityWorkRuntime;
  reward: ExactResourceBag;
  workConsumed: RateVector;
  /** May be shorter than requested when completion is the next event. */
  advancedMs: Amount;
  completed: boolean;
}

const rateBlocker = (resource: RateResourceId): CapacityWorkBlocker =>
  `rate:${resource}`;

const validBlockers = new Set<CapacityWorkBlocker>([
  "memory-fit",
  "storage-fit",
  ...exactRateResourceIds.map(rateBlocker),
]);

const isRateBlocker = (
  blocker: CapacityWorkBlocker,
): blocker is `rate:${RateResourceId}` => blocker.startsWith("rate:");

const compareBlockers = (
  left: CapacityWorkBlocker,
  right: CapacityWorkBlocker,
) => {
  const leftPriority = left === "memory-fit" ? 0 : left === "storage-fit" ? 1 : 2;
  const rightPriority =
    right === "memory-fit" ? 0 : right === "storage-fit" ? 1 : 2;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  if (isRateBlocker(left) && isRateBlocker(right)) {
    const leftResource = left.slice(5) as RateResourceId;
    const rightResource = right.slice(5) as RateResourceId;
    return (
      exactRateResourceIds.indexOf(leftResource) -
      exactRateResourceIds.indexOf(rightResource)
    );
  }
  return 0;
};

export const normalizeCapacityWorkPlan = (
  plan: CapacityWorkPlan,
): CapacityWorkPlan => ({
  id: plan.id,
  work: createRateVector(plan.work),
  memoryBits: amountClampMin(plan.memoryBits),
  storageBits: amountClampMin(plan.storageBits),
  reward: exactResourceBag(plan.reward.credits, plan.reward.data),
});

export const normalizeCapacityWorkFitCapacity = (
  capacity: CapacityWorkFitCapacity,
): CapacityWorkFitCapacity => ({
  memoryBits: amountClampMin(capacity.memoryBits),
  storageBits: amountClampMin(capacity.storageBits),
});

const normalizeBlockers = (
  blockers: readonly CapacityWorkBlocker[],
): CapacityWorkBlocker[] =>
  [...new Set(blockers.filter((blocker) => validBlockers.has(blocker)))].sort(
    compareBlockers,
  );

export const normalizeCapacityWorkRuntime = (
  runtime: CapacityWorkRuntime,
): CapacityWorkRuntime => {
  const plan = normalizeCapacityWorkPlan(runtime.plan);
  const rewardIssued = runtime.rewardIssued === true;
  const remainingWork = rewardIssued
    ? createRateVector()
    : createRateVector(
        Object.fromEntries(
          exactRateResourceIds.map((resource) => [
            resource,
            amountMin(
              plan.work[resource],
              amountClampMin(runtime.remainingWork[resource]),
            ),
          ]),
        ) as RateVector,
      );
  // Valid completion and payout are atomic. A loaded state cannot claim
  // completion without the corresponding reward-issued marker.
  const completed = rewardIssued;
  return {
    plan,
    elapsedMs: amountClampMin(runtime.elapsedMs),
    remainingWork,
    blockers: completed ? [] : normalizeBlockers(runtime.blockers),
    status:
      completed
        ? "completed"
        : runtime.status === "paused"
          ? "paused"
          : "running",
    completed,
    rewardIssued,
  };
};

export const createCapacityWorkRuntime = (
  inputPlan: CapacityWorkPlan,
): CapacityWorkRuntime => {
  const plan = normalizeCapacityWorkPlan(inputPlan);
  return {
    plan,
    elapsedMs: ZERO_AMOUNT,
    remainingWork: createRateVector(plan.work),
    blockers: [],
    status: "running",
    completed: false,
    rewardIssued: false,
  };
};

export const getCapacityWorkFitBlockers = (
  inputPlan: CapacityWorkPlan,
  inputCapacity: CapacityWorkFitCapacity,
): CapacityWorkBlocker[] => {
  const plan = normalizeCapacityWorkPlan(inputPlan);
  const capacity = normalizeCapacityWorkFitCapacity(inputCapacity);
  const blockers: CapacityWorkBlocker[] = [];
  if (amountCompare(plan.memoryBits, capacity.memoryBits) > 0) {
    blockers.push("memory-fit");
  }
  if (amountCompare(plan.storageBits, capacity.storageBits) > 0) {
    blockers.push("storage-fit");
  }
  return blockers;
};

export const capacityWorkFits = (
  plan: CapacityWorkPlan,
  capacity: CapacityWorkFitCapacity,
) => getCapacityWorkFitBlockers(plan, capacity).length === 0;

export const getCapacityWorkBlockers = (
  inputRuntime: CapacityWorkRuntime,
  inputAllocatedRates: RateVector,
  inputCapacity: CapacityWorkFitCapacity,
): CapacityWorkBlocker[] => {
  const runtime = normalizeCapacityWorkRuntime(inputRuntime);
  if (runtime.rewardIssued) return [];
  const rates = createRateVector(inputAllocatedRates);
  const blockers = getCapacityWorkFitBlockers(runtime.plan, inputCapacity);
  for (const resource of exactRateResourceIds) {
    if (
      amountCompare(runtime.remainingWork[resource], 0) > 0 &&
      amountCompare(rates[resource], 0) === 0
    ) {
      blockers.push(rateBlocker(resource));
    }
  }
  return normalizeBlockers(blockers);
};

const canProgress = (
  runtime: CapacityWorkRuntime,
  rates: RateVector,
  capacity: CapacityWorkFitCapacity,
) =>
  capacityWorkFits(runtime.plan, capacity) &&
  exactRateResourceIds.some(
    (resource) =>
      amountCompare(runtime.remainingWork[resource], 0) > 0 &&
      amountCompare(rates[resource], 0) > 0,
  );

const withCurrentBlockers = (
  inputRuntime: CapacityWorkRuntime,
  rates: RateVector,
  capacity: CapacityWorkFitCapacity,
): CapacityWorkRuntime => {
  const runtime = normalizeCapacityWorkRuntime(inputRuntime);
  if (runtime.completed) return { ...runtime, blockers: [], status: "completed" };
  return {
    ...runtime,
    blockers: getCapacityWorkBlockers(runtime, rates, capacity),
    status: canProgress(runtime, rates, capacity) ? "running" : "paused",
  };
};

interface SettlementResult {
  runtime: CapacityWorkRuntime;
  reward: ExactResourceBag;
  completed: boolean;
}

const settleCapacityWork = (
  inputRuntime: CapacityWorkRuntime,
  capacity: CapacityWorkFitCapacity,
): SettlementResult => {
  const runtime = normalizeCapacityWorkRuntime(inputRuntime);
  if (
    !isEmptyRateVector(runtime.remainingWork) ||
    runtime.rewardIssued ||
    !capacityWorkFits(runtime.plan, capacity)
  ) {
    return { runtime, reward: exactResourceBag(), completed: false };
  }
  return {
    runtime: {
      ...runtime,
      remainingWork: createRateVector(),
      blockers: [],
      status: "completed",
      completed: true,
      rewardIssued: true,
    },
    reward: exactResourceBag(
      runtime.plan.reward.credits,
      runtime.plan.reward.data,
    ),
    completed: true,
  };
};

const getNextDimensionEventMs = (
  runtime: CapacityWorkRuntime,
  rates: RateVector,
) => {
  let nextEventMs: Amount | null = null;
  for (const resource of exactRateResourceIds) {
    const remaining = runtime.remainingWork[resource];
    const rate = rates[resource];
    if (amountCompare(remaining, 0) <= 0 || amountCompare(rate, 0) <= 0) {
      continue;
    }
    const eventMs = amountMultiply(amountDivide(remaining, rate), 1000);
    if (nextEventMs === null || amountCompare(eventMs, nextEventMs) < 0) {
      nextEventMs = eventMs;
    }
  }
  return nextEventMs;
};

/**
 * Exact boundary for the next completed dimension. Zero settles zero-work
 * plans; null means completed or safely paused under current capacity.
 */
export const getNextCapacityWorkEventMs = (
  inputRuntime: CapacityWorkRuntime,
  inputAllocatedRates: RateVector,
  inputCapacity: CapacityWorkFitCapacity,
): Amount | null => {
  const runtime = normalizeCapacityWorkRuntime(inputRuntime);
  if (runtime.rewardIssued) return null;
  const rates = createRateVector(inputAllocatedRates);
  const capacity = normalizeCapacityWorkFitCapacity(inputCapacity);
  if (!capacityWorkFits(runtime.plan, capacity)) return null;
  if (isEmptyRateVector(runtime.remainingWork)) return ZERO_AMOUNT;
  return getNextDimensionEventMs(runtime, rates);
};

const addReward = (
  left: ExactResourceBag,
  right: ExactResourceBag,
): ExactResourceBag =>
  exactResourceBag(
    amountAdd(left.credits, right.credits),
    amountAdd(left.data, right.data),
  );

const getConsumedStep = (
  runtime: CapacityWorkRuntime,
  rates: RateVector,
  stepMs: Amount,
) =>
  createRateVector(
    Object.fromEntries(
      exactRateResourceIds.map((resource) => [
        resource,
        amountCompare(rates[resource], 0) > 0 &&
        amountCompare(
          stepMs,
          amountMultiply(
            amountDivide(runtime.remainingWork[resource], rates[resource]),
            1000,
          ),
        ) >= 0
          ? runtime.remainingWork[resource]
          : amountMin(
              runtime.remainingWork[resource],
              amountMultiply(rates[resource], amountDivide(stepMs, 1000)),
            ),
      ]),
    ) as RateVector,
  );

/**
 * Advances exact work under a fixed allocation. Fit failures and zero-rate
 * dimensions pause safely; completion and reward issuance are one transition.
 */
export const advanceCapacityWork = (
  inputRuntime: CapacityWorkRuntime,
  inputAllocatedRates: RateVector,
  inputCapacity: CapacityWorkFitCapacity,
  deltaMs: AmountValue,
): CapacityWorkAdvanceResult => {
  const requestedMs = amount(deltaMs);
  if (amountCompare(requestedMs, 0) < 0) {
    throw new Error("Capacity work advance delta must be non-negative");
  }
  const rates = createRateVector(inputAllocatedRates);
  const capacity = normalizeCapacityWorkFitCapacity(inputCapacity);
  let runtime = normalizeCapacityWorkRuntime(inputRuntime);
  let remainingMs = requestedMs;
  let advancedMs = ZERO_AMOUNT;
  let reward = exactResourceBag();
  let workConsumed = createRateVector();
  let completed = false;

  const initialSettlement = settleCapacityWork(runtime, capacity);
  runtime = initialSettlement.runtime;
  reward = addReward(reward, initialSettlement.reward);
  completed ||= initialSettlement.completed;

  while (!runtime.rewardIssued && amountCompare(remainingMs, 0) > 0) {
    if (!capacityWorkFits(runtime.plan, capacity)) {
      runtime = {
        ...runtime,
        elapsedMs: amountAdd(runtime.elapsedMs, remainingMs),
      };
      advancedMs = amountAdd(advancedMs, remainingMs);
      remainingMs = ZERO_AMOUNT;
      break;
    }
    const eventMs = getNextDimensionEventMs(runtime, rates);
    if (eventMs === null) {
      runtime = {
        ...runtime,
        elapsedMs: amountAdd(runtime.elapsedMs, remainingMs),
      };
      advancedMs = amountAdd(advancedMs, remainingMs);
      remainingMs = ZERO_AMOUNT;
      break;
    }

    const stepMs = amountMin(remainingMs, eventMs);
    const stepConsumed = getConsumedStep(runtime, rates, stepMs);
    runtime = {
      ...runtime,
      elapsedMs: amountAdd(runtime.elapsedMs, stepMs),
      remainingWork: createRateVector(
        Object.fromEntries(
          exactRateResourceIds.map((resource) => [
            resource,
            amountSubtract(
              runtime.remainingWork[resource],
              stepConsumed[resource],
            ),
          ]),
        ) as RateVector,
      ),
    };
    workConsumed = addRateVectors(workConsumed, stepConsumed);
    advancedMs = amountAdd(advancedMs, stepMs);
    remainingMs = amountSubtract(remainingMs, stepMs);

    const settlement = settleCapacityWork(runtime, capacity);
    runtime = settlement.runtime;
    reward = addReward(reward, settlement.reward);
    completed ||= settlement.completed;
  }

  runtime = withCurrentBlockers(runtime, rates, capacity);
  return { runtime, reward, workConsumed, advancedMs, completed };
};
