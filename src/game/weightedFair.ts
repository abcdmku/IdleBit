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
  sumAmounts,
  type Amount,
} from "./amount";
import type {
  RateResourceId,
  RateVector,
} from "./infrastructureTypes";

type AmountValue = Amount | string | number;

/** Kept low-level so placement/scheduling do not pull in GameState capacity code. */
export const exactRateResourceIds: readonly RateResourceId[] = [
  "compute",
  "storageRead",
  "storageWrite",
  "networkIngress",
  "networkEgress",
] as const;

const compareIds = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

export const createRateVector = (
  values: Partial<Record<RateResourceId, AmountValue>> = {},
): RateVector =>
  Object.fromEntries(
    exactRateResourceIds.map((resource) => [
      resource,
      amountClampMin(values[resource] ?? ZERO_AMOUNT),
    ]),
  ) as RateVector;

export const addRateVectors = (
  left: RateVector,
  right: RateVector,
): RateVector =>
  createRateVector(
    Object.fromEntries(
      exactRateResourceIds.map((resource) => [
        resource,
        amountAdd(left[resource], right[resource]),
      ]),
    ) as RateVector,
  );

export const subtractRateVectors = (
  left: RateVector,
  right: RateVector,
): RateVector =>
  createRateVector(
    Object.fromEntries(
      exactRateResourceIds.map((resource) => [
        resource,
        amountSubtract(left[resource], right[resource]),
      ]),
    ) as RateVector,
  );

export const scaleRateVector = (
  vector: RateVector,
  multiplier: AmountValue,
): RateVector => {
  const scale = amount(multiplier);
  if (amountCompare(scale, 0) < 0) {
    throw new Error("Rate vector scale must be non-negative");
  }
  return createRateVector(
    Object.fromEntries(
      exactRateResourceIds.map((resource) => [
        resource,
        amountMultiply(vector[resource], scale),
      ]),
    ) as RateVector,
  );
};

export const isEmptyRateVector = (vector: RateVector) =>
  exactRateResourceIds.every(
    (resource) => amountCompare(vector[resource], 0) === 0,
  );

export interface WeightedFairWorkload {
  id: string;
  /** Resource units consumed by one unit of scalar allocation. */
  demand: RateVector;
  /** Positive weights receive proportional service before a bottleneck. */
  weight: Amount;
  /** Optional finite ceiling for the scalar allocation. */
  maxAllocation?: Amount;
}

export interface WeightedFairAllocation {
  workloadId: string;
  allocation: Amount;
}

export interface WeightedFairResult {
  allocations: WeightedFairAllocation[];
  allocationByWorkload: Record<string, Amount>;
  used: RateVector;
  remaining: RateVector;
}

interface NormalizedWorkload {
  id: string;
  demand: RateVector;
  weight: Amount;
  maxAllocation?: Amount;
}

interface IncrementCandidate {
  increment: Amount;
  resource?: RateResourceId;
  workloadId?: string;
}

const assertUniqueWorkloadIds = (
  workloads: readonly WeightedFairWorkload[],
) => {
  const seen = new Set<string>();
  for (const workload of workloads) {
    if (seen.has(workload.id)) {
      throw new Error(`Duplicate weighted-fair workload id: ${workload.id}`);
    }
    seen.add(workload.id);
  }
};

const normalizeWorkload = (
  workload: WeightedFairWorkload,
): NormalizedWorkload => ({
  id: workload.id,
  demand: createRateVector(workload.demand),
  weight: amountClampMin(workload.weight),
  ...(workload.maxAllocation === undefined
    ? {}
    : { maxAllocation: amountClampMin(workload.maxAllocation) }),
});

const getUsedCapacity = (
  workloads: readonly NormalizedWorkload[],
  allocationByWorkload: Readonly<Record<string, Amount>>,
) =>
  createRateVector(
    Object.fromEntries(
      exactRateResourceIds.map((resource) => [
        resource,
        sumAmounts(
          workloads.map((workload) =>
            amountMultiply(
              workload.demand[resource],
              allocationByWorkload[workload.id] ?? ZERO_AMOUNT,
            ),
          ),
        ),
      ]),
    ) as RateVector,
  );

/**
 * Weighted progressive filling under simultaneous rate constraints.
 *
 * Each active workload grows at `weight * lambda`. A saturated resource fixes
 * every workload that consumes it; unaffected workloads continue filling the
 * remaining dimensions. This is weighted max-min fairness without a floating
 * point projection.
 */
export const allocateWeightedMaxMin = (
  capacity: RateVector,
  workloads: readonly WeightedFairWorkload[],
): WeightedFairResult => {
  assertUniqueWorkloadIds(workloads);
  const normalizedCapacity = createRateVector(capacity);
  const ordered = workloads
    .map(normalizeWorkload)
    .sort((left, right) => compareIds(left.id, right.id));
  const allocationByWorkload: Record<string, Amount> = Object.fromEntries(
    ordered.map((workload) => [workload.id, ZERO_AMOUNT]),
  );

  // Finite, resource-free work can take its cap immediately. An uncapped
  // resource-free workload is intentionally reported as zero (it is unbounded).
  for (const workload of ordered) {
    if (isEmptyRateVector(workload.demand) && workload.maxAllocation) {
      allocationByWorkload[workload.id] = workload.maxAllocation;
    }
  }

  const remaining = createRateVector(normalizedCapacity);
  const active = new Set(
    ordered
      .filter(
        (workload) =>
          amountCompare(workload.weight, 0) > 0 &&
          !isEmptyRateVector(workload.demand) &&
          (workload.maxAllocation === undefined ||
            amountCompare(workload.maxAllocation, 0) > 0),
      )
      .map((workload) => workload.id),
  );
  const byId = new Map(ordered.map((workload) => [workload.id, workload]));

  while (active.size > 0) {
    const activeWorkloads = [...active]
      .map((id) => byId.get(id)!)
      .sort((left, right) => compareIds(left.id, right.id));
    const candidates: IncrementCandidate[] = [];

    for (const resource of exactRateResourceIds) {
      const weightedDemand = sumAmounts(
        activeWorkloads.map((workload) =>
          amountMultiply(workload.demand[resource], workload.weight),
        ),
      );
      if (amountCompare(weightedDemand, 0) > 0) {
        candidates.push({
          increment: amountDivide(remaining[resource], weightedDemand),
          resource,
        });
      }
    }
    for (const workload of activeWorkloads) {
      if (workload.maxAllocation !== undefined) {
        candidates.push({
          increment: amountDivide(
            amountClampMin(
              amountSubtract(
                workload.maxAllocation,
                allocationByWorkload[workload.id],
              ),
            ),
            workload.weight,
          ),
          workloadId: workload.id,
        });
      }
    }

    if (candidates.length === 0) break;
    const increment = candidates.reduce(
      (minimum, candidate) =>
        amountCompare(candidate.increment, minimum) < 0
          ? candidate.increment
          : minimum,
      candidates[0].increment,
    );

    for (const workload of activeWorkloads) {
      const added = amountMultiply(workload.weight, increment);
      const next = amountAdd(allocationByWorkload[workload.id], added);
      allocationByWorkload[workload.id] =
        workload.maxAllocation === undefined
          ? next
          : amountMin(next, workload.maxAllocation);
    }

    const stepUsed = createRateVector(
      Object.fromEntries(
        exactRateResourceIds.map((resource) => [
          resource,
          sumAmounts(
            activeWorkloads.map((workload) =>
              amountMultiply(
                workload.demand[resource],
                amountMultiply(workload.weight, increment),
              ),
            ),
          ),
        ]),
      ) as RateVector,
    );
    for (const resource of exactRateResourceIds) {
      remaining[resource] = amountClampMin(
        amountSubtract(remaining[resource], stepUsed[resource]),
      );
    }

    const limiting = candidates.filter(
      (candidate) => amountCompare(candidate.increment, increment) === 0,
    );
    const saturatedResources = new Set(
      limiting.flatMap((candidate) =>
        candidate.resource === undefined ? [] : [candidate.resource],
      ),
    );
    const cappedWorkloads = new Set(
      limiting.flatMap((candidate) =>
        candidate.workloadId === undefined ? [] : [candidate.workloadId],
      ),
    );

    for (const workload of activeWorkloads) {
      const consumesSaturatedResource = [...saturatedResources].some(
        (resource) => amountCompare(workload.demand[resource], 0) > 0,
      );
      if (
        consumesSaturatedResource ||
        cappedWorkloads.has(workload.id) ||
        (workload.maxAllocation !== undefined &&
          amountCompare(
            allocationByWorkload[workload.id],
            workload.maxAllocation,
          ) >= 0)
      ) {
        active.delete(workload.id);
      }
    }

    // Every minimum candidate must retire at least one workload. Keep malformed
    // inputs or precision-edge data from creating an infinite loop.
    if (saturatedResources.size === 0 && cappedWorkloads.size === 0) {
      break;
    }
  }

  const used = getUsedCapacity(ordered, allocationByWorkload);
  return {
    allocations: ordered.map((workload) => ({
      workloadId: workload.id,
      allocation: allocationByWorkload[workload.id],
    })),
    allocationByWorkload,
    used,
    remaining: subtractRateVectors(normalizedCapacity, used),
  };
};
