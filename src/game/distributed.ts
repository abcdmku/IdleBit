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
  sumAmounts,
  type Amount,
  type ExactResourceBag,
} from "./amount";
import {
  createPlacementVector,
  type PlacementAssignment,
  type PlacementRequest,
  type PlacementVector,
} from "./placement";
import {
  addRateVectors,
  allocateWeightedMaxMin,
  createRateVector,
  exactRateResourceIds,
  isEmptyRateVector,
  scaleRateVector,
  type WeightedFairWorkload,
} from "./weightedFair";
import type { RateVector } from "./infrastructureTypes";

type AmountValue = Amount | string | number;

export interface DistributedShardPlan {
  id: string;
  nodeId: string;
  inputBits: Amount;
  outputBits: Amount;
  placementDemand: PlacementVector;
  transferWork: RateVector;
  computeWork: RateVector;
  weight: Amount;
}

export interface DistributedReducePlan {
  work: RateVector;
  outputBits: Amount;
  weight: Amount;
}

export interface DistributedCommitPlan {
  work: RateVector;
  weight: Amount;
}

export interface DistributedWorkPlan {
  id: string;
  shards: DistributedShardPlan[];
  reduce: DistributedReducePlan;
  commit: DistributedCommitPlan;
  finalOutputBits: Amount;
  reward: ExactResourceBag;
}

export interface DistributedShardRuntime {
  id: string;
  transferRemaining: Amount;
  computeRemaining: Amount;
  stagedInputBits: Amount;
  stagedOutputBits: Amount;
}

export type DistributedWorkStatus = "running" | "committed";

/** All values are JSON-safe primitives and arrays suitable for save-v7 state. */
export interface DistributedWorkRuntime {
  plan: DistributedWorkPlan;
  status: DistributedWorkStatus;
  elapsedMs: Amount;
  shards: DistributedShardRuntime[];
  barrierReached: boolean;
  reduceRemaining: Amount;
  stagedReduceBits: Amount;
  commitRemaining: Amount;
  committedOutputBits: Amount;
  rewardIssued: boolean;
}

export interface DistributedAdvanceResult {
  runtime: DistributedWorkRuntime;
  reward: ExactResourceBag;
  committed: boolean;
  /** Exact units of work consumed during this call, not a rate projection. */
  workConsumed: RateVector;
}

export interface ShardPipelineSpec {
  id: string;
  nodeId: string;
  inputBits: AmountValue;
  computeOperations: AmountValue;
  outputBits: AmountValue;
  memoryBits?: AmountValue;
  placementDemand?: PlacementVector;
  weight?: AmountValue;
}

export interface DistributedPipelineSpec {
  id: string;
  shards: readonly ShardPipelineSpec[];
  reduceComputeOperations: AmountValue;
  reduceOutputBits: AmountValue;
  reward?: ExactResourceBag;
  reduceWeight?: AmountValue;
  commitWeight?: AmountValue;
}

/** Exact paid work represented by every transfer, compute, reduce, and commit lane. */
export const getDistributedWorkPaidUnits = (
  inputPlan: DistributedWorkPlan,
): Amount => {
  const plan = normalizeDistributedWorkPlan(inputPlan);
  return sumAmounts([
    ...plan.shards.flatMap((shard) => [
      ...exactRateResourceIds.map((resource) => shard.transferWork[resource]),
      ...exactRateResourceIds.map((resource) => shard.computeWork[resource]),
    ]),
    ...exactRateResourceIds.map((resource) => plan.reduce.work[resource]),
    ...exactRateResourceIds.map((resource) => plan.commit.work[resource]),
  ]);
};

const ONE_AMOUNT = amount(1);

const compareIds = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

const fractionRemaining = (value: AmountValue) =>
  amountMin(ONE_AMOUNT, amountClampMin(value));

const assertUniqueShardIds = (shards: readonly { id: string }[]) => {
  const seen = new Set<string>();
  for (const shard of shards) {
    if (seen.has(shard.id)) {
      throw new Error(`Duplicate distributed shard id: ${shard.id}`);
    }
    seen.add(shard.id);
  }
};

export const normalizeDistributedWorkPlan = (
  plan: DistributedWorkPlan,
): DistributedWorkPlan => {
  assertUniqueShardIds(plan.shards);
  return {
    id: plan.id,
    shards: plan.shards
      .map((shard) => ({
        id: shard.id,
        nodeId: shard.nodeId,
        inputBits: amountClampMin(shard.inputBits),
        outputBits: amountClampMin(shard.outputBits),
        placementDemand: createPlacementVector(shard.placementDemand),
        transferWork: createRateVector(shard.transferWork),
        computeWork: createRateVector(shard.computeWork),
        weight: amountClampMin(shard.weight),
      }))
      .sort((left, right) => compareIds(left.id, right.id)),
    reduce: {
      work: createRateVector(plan.reduce.work),
      outputBits: amountClampMin(plan.reduce.outputBits),
      weight: amountClampMin(plan.reduce.weight),
    },
    commit: {
      work: createRateVector(plan.commit.work),
      weight: amountClampMin(plan.commit.weight),
    },
    finalOutputBits: amountClampMin(plan.finalOutputBits),
    reward: exactResourceBag(plan.reward.credits, plan.reward.data),
  };
};

const getCompletedFraction = (remaining: Amount) =>
  amountSubtract(ONE_AMOUNT, fractionRemaining(remaining));

/** Repairs/canonicalizes a loaded runtime without granting its pending reward. */
export const normalizeDistributedWorkRuntime = (
  runtime: DistributedWorkRuntime,
): DistributedWorkRuntime => {
  const plan = normalizeDistributedWorkPlan(runtime.plan);
  const loadedById = new Map(runtime.shards.map((shard) => [shard.id, shard]));
  const shards = plan.shards.map((shardPlan) => {
    const loaded = loadedById.get(shardPlan.id);
    const transferRemaining = fractionRemaining(
      loaded?.transferRemaining ?? ONE_AMOUNT,
    );
    // A shard cannot have compute progress before its transfer is complete.
    const computeRemaining =
      amountCompare(transferRemaining, 0) > 0
        ? ONE_AMOUNT
        : fractionRemaining(loaded?.computeRemaining ?? ONE_AMOUNT);
    return {
      id: shardPlan.id,
      transferRemaining,
      computeRemaining,
      stagedInputBits: amountMultiply(
        shardPlan.inputBits,
        getCompletedFraction(transferRemaining),
      ),
      stagedOutputBits: amountMultiply(
        shardPlan.outputBits,
        getCompletedFraction(computeRemaining),
      ),
    };
  });
  const rewardIssued = runtime.rewardIssued === true;
  if (rewardIssued) {
    return {
      plan,
      status: "committed",
      elapsedMs: amountClampMin(runtime.elapsedMs),
      shards: shards.map((shard, index) => ({
        ...shard,
        transferRemaining: ZERO_AMOUNT,
        computeRemaining: ZERO_AMOUNT,
        stagedInputBits: plan.shards[index].inputBits,
        stagedOutputBits: plan.shards[index].outputBits,
      })),
      barrierReached: true,
      reduceRemaining: ZERO_AMOUNT,
      stagedReduceBits: plan.reduce.outputBits,
      commitRemaining: ZERO_AMOUNT,
      committedOutputBits: plan.finalOutputBits,
      rewardIssued: true,
    };
  }

  const barrierReached =
    runtime.barrierReached === true &&
    shards.every((shard) => amountCompare(shard.computeRemaining, 0) === 0);
  const reduceRemaining = barrierReached
    ? fractionRemaining(runtime.reduceRemaining)
    : ONE_AMOUNT;
  const commitRemaining =
    barrierReached && amountCompare(reduceRemaining, 0) === 0
      ? fractionRemaining(runtime.commitRemaining)
      : ONE_AMOUNT;
  return {
    plan,
    status: "running",
    elapsedMs: amountClampMin(runtime.elapsedMs),
    shards,
    barrierReached,
    reduceRemaining,
    stagedReduceBits: amountMultiply(
      plan.reduce.outputBits,
      getCompletedFraction(reduceRemaining),
    ),
    commitRemaining,
    committedOutputBits: ZERO_AMOUNT,
    rewardIssued: false,
  };
};

export const createDistributedWorkRuntime = (
  inputPlan: DistributedWorkPlan,
): DistributedWorkRuntime => {
  const plan = normalizeDistributedWorkPlan(inputPlan);
  const unplaced = plan.shards.find((shard) => shard.nodeId.length === 0);
  if (unplaced) {
    throw new Error(`Distributed shard is not placed: ${unplaced.id}`);
  }
  return {
    plan,
    status: "running",
    elapsedMs: ZERO_AMOUNT,
    shards: plan.shards.map((shard) => ({
      id: shard.id,
      transferRemaining: ONE_AMOUNT,
      computeRemaining: ONE_AMOUNT,
      stagedInputBits: ZERO_AMOUNT,
      stagedOutputBits: ZERO_AMOUNT,
    })),
    barrierReached: false,
    reduceRemaining: ONE_AMOUNT,
    stagedReduceBits: ZERO_AMOUNT,
    commitRemaining: ONE_AMOUNT,
    committedOutputBits: ZERO_AMOUNT,
    rewardIssued: false,
  };
};

/**
 * Convenience constructor for the canonical transfer -> compute -> barrier ->
 * reduce -> commit pipeline. Input/output staging consumes storage bandwidth;
 * transfer and commit consume network bandwidth.
 */
export const createShardPipelinePlan = (
  spec: DistributedPipelineSpec,
): DistributedWorkPlan => {
  const shards: DistributedShardPlan[] = spec.shards.map((shard) => {
    const inputBits = amountClampMin(shard.inputBits);
    const outputBits = amountClampMin(shard.outputBits);
    return {
      id: shard.id,
      nodeId: shard.nodeId,
      inputBits,
      outputBits,
      placementDemand:
        shard.placementDemand ??
        createPlacementVector({
          memoryBits: shard.memoryBits ?? inputBits,
          storageBits: amountAdd(inputBits, outputBits),
        }),
      transferWork: createRateVector({
        networkIngress: inputBits,
        storageWrite: inputBits,
      }),
      computeWork: createRateVector({
        compute: shard.computeOperations,
        storageRead: inputBits,
        storageWrite: outputBits,
      }),
      weight: amountClampMin(shard.weight ?? ONE_AMOUNT),
    };
  });
  const shardOutputBits = sumAmounts(shards.map((shard) => shard.outputBits));
  const reduceOutputBits = amountClampMin(spec.reduceOutputBits);
  return normalizeDistributedWorkPlan({
    id: spec.id,
    shards,
    reduce: {
      work: createRateVector({
        compute: spec.reduceComputeOperations,
        storageRead: shardOutputBits,
        storageWrite: reduceOutputBits,
      }),
      outputBits: reduceOutputBits,
      weight: amountClampMin(spec.reduceWeight ?? ONE_AMOUNT),
    },
    commit: {
      work: createRateVector({
        storageRead: reduceOutputBits,
        networkEgress: reduceOutputBits,
      }),
      weight: amountClampMin(spec.commitWeight ?? ONE_AMOUNT),
    },
    finalOutputBits: reduceOutputBits,
    reward: spec.reward ?? exactResourceBag(),
  });
};

export const getDistributedPlacementRequests = (
  inputPlan: DistributedWorkPlan,
): PlacementRequest[] =>
  normalizeDistributedWorkPlan(inputPlan).shards.map((shard) => ({
    id: shard.id,
    demand: shard.placementDemand,
  }));

/** Applies a complete deterministic placement result before runtime creation. */
export const withDistributedPlacements = (
  inputPlan: DistributedWorkPlan,
  assignments: readonly PlacementAssignment[],
): DistributedWorkPlan => {
  const plan = normalizeDistributedWorkPlan(inputPlan);
  const assignmentByShard = new Map<string, string>();
  const shardIds = new Set(plan.shards.map((shard) => shard.id));
  for (const assignment of assignments) {
    if (!shardIds.has(assignment.requestId)) {
      throw new Error(`Unknown distributed shard placement: ${assignment.requestId}`);
    }
    if (assignmentByShard.has(assignment.requestId)) {
      throw new Error(`Duplicate distributed shard placement: ${assignment.requestId}`);
    }
    assignmentByShard.set(assignment.requestId, assignment.nodeId);
  }
  const missing = plan.shards.find(
    (shard) => !assignmentByShard.has(shard.id),
  );
  if (missing) {
    throw new Error(`Missing distributed shard placement: ${missing.id}`);
  }
  return normalizeDistributedWorkPlan({
    ...plan,
    shards: plan.shards.map((shard) => ({
      ...shard,
      nodeId: assignmentByShard.get(shard.id)!,
    })),
  });
};

type ActiveStageKind = "transfer" | "compute" | "reduce" | "commit";

interface ActiveStage {
  id: string;
  kind: ActiveStageKind;
  shardId?: string;
  work: RateVector;
  weight: Amount;
  remaining: Amount;
}

interface SettlementResult {
  runtime: DistributedWorkRuntime;
  reward: ExactResourceBag;
  committed: boolean;
  changed: boolean;
}

const cloneRuntime = (
  runtime: DistributedWorkRuntime,
): DistributedWorkRuntime => ({
  ...runtime,
  shards: runtime.shards.map((shard) => ({ ...shard })),
});

const settleInstantaneousStages = (
  input: DistributedWorkRuntime,
): SettlementResult => {
  const runtime = cloneRuntime(input);
  let reward = exactResourceBag();
  let committed = false;
  let changed = false;

  for (let index = 0; index < runtime.shards.length; index += 1) {
    const shard = runtime.shards[index];
    const plan = runtime.plan.shards[index];
    if (
      amountCompare(shard.transferRemaining, 0) <= 0 ||
      isEmptyRateVector(plan.transferWork)
    ) {
      if (
        amountCompare(shard.transferRemaining, 0) !== 0 ||
        amountCompare(shard.stagedInputBits, plan.inputBits) !== 0
      ) {
        changed = true;
      }
      shard.transferRemaining = ZERO_AMOUNT;
      shard.stagedInputBits = plan.inputBits;
    }
    if (
      amountCompare(shard.transferRemaining, 0) === 0 &&
      (amountCompare(shard.computeRemaining, 0) <= 0 ||
        isEmptyRateVector(plan.computeWork))
    ) {
      if (
        amountCompare(shard.computeRemaining, 0) !== 0 ||
        amountCompare(shard.stagedOutputBits, plan.outputBits) !== 0
      ) {
        changed = true;
      }
      shard.computeRemaining = ZERO_AMOUNT;
      shard.stagedOutputBits = plan.outputBits;
    }
  }

  if (
    !runtime.barrierReached &&
    runtime.shards.every(
      (shard) => amountCompare(shard.computeRemaining, 0) === 0,
    )
  ) {
    runtime.barrierReached = true;
    changed = true;
  }
  if (
    runtime.barrierReached &&
    (amountCompare(runtime.reduceRemaining, 0) <= 0 ||
      isEmptyRateVector(runtime.plan.reduce.work))
  ) {
    if (
      amountCompare(runtime.reduceRemaining, 0) !== 0 ||
      amountCompare(
        runtime.stagedReduceBits,
        runtime.plan.reduce.outputBits,
      ) !== 0
    ) {
      changed = true;
    }
    runtime.reduceRemaining = ZERO_AMOUNT;
    runtime.stagedReduceBits = runtime.plan.reduce.outputBits;
  }
  if (
    runtime.barrierReached &&
    amountCompare(runtime.reduceRemaining, 0) === 0 &&
    (amountCompare(runtime.commitRemaining, 0) <= 0 ||
      isEmptyRateVector(runtime.plan.commit.work))
  ) {
    runtime.commitRemaining = ZERO_AMOUNT;
    if (!runtime.rewardIssued) {
      runtime.status = "committed";
      runtime.committedOutputBits = runtime.plan.finalOutputBits;
      runtime.rewardIssued = true;
      reward = exactResourceBag(
        runtime.plan.reward.credits,
        runtime.plan.reward.data,
      );
      committed = true;
      changed = true;
    }
  }

  return { runtime, reward, committed, changed };
};

const getActiveStages = (runtime: DistributedWorkRuntime): ActiveStage[] => {
  if (runtime.rewardIssued) return [];
  const stages: ActiveStage[] = [];
  for (let index = 0; index < runtime.shards.length; index += 1) {
    const shard = runtime.shards[index];
    const plan = runtime.plan.shards[index];
    if (amountCompare(shard.transferRemaining, 0) > 0) {
      stages.push({
        id: `shard:${shard.id}:transfer`,
        kind: "transfer",
        shardId: shard.id,
        work: plan.transferWork,
        weight: plan.weight,
        remaining: shard.transferRemaining,
      });
    } else if (amountCompare(shard.computeRemaining, 0) > 0) {
      stages.push({
        id: `shard:${shard.id}:compute`,
        kind: "compute",
        shardId: shard.id,
        work: plan.computeWork,
        weight: plan.weight,
        remaining: shard.computeRemaining,
      });
    }
  }
  if (
    runtime.barrierReached &&
    amountCompare(runtime.reduceRemaining, 0) > 0
  ) {
    stages.push({
      id: "reduce",
      kind: "reduce",
      work: runtime.plan.reduce.work,
      weight: runtime.plan.reduce.weight,
      remaining: runtime.reduceRemaining,
    });
  } else if (
    runtime.barrierReached &&
    amountCompare(runtime.reduceRemaining, 0) === 0 &&
    amountCompare(runtime.commitRemaining, 0) > 0
  ) {
    stages.push({
      id: "commit",
      kind: "commit",
      work: runtime.plan.commit.work,
      weight: runtime.plan.commit.weight,
      remaining: runtime.commitRemaining,
    });
  }
  return stages.sort((left, right) => compareIds(left.id, right.id));
};

const allocationsForStages = (
  capacity: RateVector,
  stages: readonly ActiveStage[],
) => {
  const workloads: WeightedFairWorkload[] = stages.map((stage) => ({
    id: stage.id,
    demand: stage.work,
    weight: stage.weight,
  }));
  return allocateWeightedMaxMin(capacity, workloads).allocationByWorkload;
};

const getNextStageCompletionSeconds = (
  stages: readonly ActiveStage[],
  allocationByStage: Readonly<Record<string, Amount>>,
) => {
  let boundary: Amount | null = null;
  for (const stage of stages) {
    const allocation = allocationByStage[stage.id] ?? ZERO_AMOUNT;
    if (amountCompare(allocation, 0) <= 0) continue;
    const completion = amountDivide(stage.remaining, allocation);
    if (boundary === null || amountCompare(completion, boundary) < 0) {
      boundary = completion;
    }
  }
  return boundary;
};

/**
 * Exact time to the next DAG transition. Zero means an instantaneous barrier or
 * zero-work transition is pending; null means complete or capacity-stalled.
 */
export const getNextDistributedEventMs = (
  inputRuntime: DistributedWorkRuntime,
  inputCapacity: RateVector,
): Amount | null => {
  const normalized = normalizeDistributedWorkRuntime(inputRuntime);
  const settled = settleInstantaneousStages(normalized);
  if (settled.changed) return ZERO_AMOUNT;
  const stages = getActiveStages(settled.runtime);
  if (stages.length === 0) return null;
  const allocationByStage = allocationsForStages(
    createRateVector(inputCapacity),
    stages,
  );
  const seconds = getNextStageCompletionSeconds(stages, allocationByStage);
  return seconds === null ? null : amountMultiply(seconds, 1000);
};

const updateStageProgress = (
  runtime: DistributedWorkRuntime,
  stage: ActiveStage,
  progress: Amount,
) => {
  if (stage.kind === "transfer" || stage.kind === "compute") {
    const shardIndex = runtime.shards.findIndex(
      (shard) => shard.id === stage.shardId,
    );
    const shard = runtime.shards[shardIndex];
    const plan = runtime.plan.shards[shardIndex];
    if (stage.kind === "transfer") {
      shard.transferRemaining = amountClampMin(
        amountSubtract(shard.transferRemaining, progress),
      );
      shard.stagedInputBits = amountMultiply(
        plan.inputBits,
        getCompletedFraction(shard.transferRemaining),
      );
    } else {
      shard.computeRemaining = amountClampMin(
        amountSubtract(shard.computeRemaining, progress),
      );
      shard.stagedOutputBits = amountMultiply(
        plan.outputBits,
        getCompletedFraction(shard.computeRemaining),
      );
    }
    return;
  }
  if (stage.kind === "reduce") {
    runtime.reduceRemaining = amountClampMin(
      amountSubtract(runtime.reduceRemaining, progress),
    );
    runtime.stagedReduceBits = amountMultiply(
      runtime.plan.reduce.outputBits,
      getCompletedFraction(runtime.reduceRemaining),
    );
    return;
  }
  runtime.commitRemaining = amountClampMin(
    amountSubtract(runtime.commitRemaining, progress),
  );
};

const addReward = (
  left: ExactResourceBag,
  right: ExactResourceBag,
): ExactResourceBag =>
  exactResourceBag(
    amountAdd(left.credits, right.credits),
    amountAdd(left.data, right.data),
  );

/** Advances through exact event boundaries; no partial commit or reward leaks. */
export const advanceDistributedWork = (
  inputRuntime: DistributedWorkRuntime,
  inputCapacity: RateVector,
  deltaMs: AmountValue,
): DistributedAdvanceResult => {
  const requestedMs = amount(deltaMs);
  if (amountCompare(requestedMs, 0) < 0) {
    throw new Error("Distributed advance delta must be non-negative");
  }
  const capacity = createRateVector(inputCapacity);
  let runtime = normalizeDistributedWorkRuntime(inputRuntime);
  let remainingSeconds = amountDivide(requestedMs, 1000);
  let reward = exactResourceBag();
  let committed = false;
  let workConsumed = createRateVector();

  while (true) {
    const settled = settleInstantaneousStages(runtime);
    runtime = settled.runtime;
    reward = addReward(reward, settled.reward);
    committed ||= settled.committed;

    if (runtime.rewardIssued || amountCompare(remainingSeconds, 0) <= 0) {
      break;
    }

    const stages = getActiveStages(runtime);
    const allocationByStage = allocationsForStages(capacity, stages);
    const boundarySeconds = getNextStageCompletionSeconds(
      stages,
      allocationByStage,
    );
    if (boundarySeconds === null) {
      runtime.elapsedMs = amountAdd(
        runtime.elapsedMs,
        amountMultiply(remainingSeconds, 1000),
      );
      remainingSeconds = ZERO_AMOUNT;
      break;
    }

    const stepSeconds = amountMin(remainingSeconds, boundarySeconds);
    for (const stage of stages) {
      const allocation = allocationByStage[stage.id] ?? ZERO_AMOUNT;
      if (amountCompare(allocation, 0) <= 0) continue;
      const progress = amountMin(
        stage.remaining,
        amountMultiply(allocation, stepSeconds),
      );
      updateStageProgress(runtime, stage, progress);
      workConsumed = addRateVectors(
        workConsumed,
        scaleRateVector(stage.work, progress),
      );
    }
    runtime.elapsedMs = amountAdd(
      runtime.elapsedMs,
      amountMultiply(stepSeconds, 1000),
    );
    remainingSeconds = amountClampMin(
      amountSubtract(remainingSeconds, stepSeconds),
    );
  }

  return { runtime, reward, committed, workConsumed };
};

export const getDistributedProgress = (
  runtime: DistributedWorkRuntime,
): RateVector => {
  const normalized = normalizeDistributedWorkRuntime(runtime);
  let completed = createRateVector();
  for (let index = 0; index < normalized.shards.length; index += 1) {
    const shard = normalized.shards[index];
    const plan = normalized.plan.shards[index];
    completed = addRateVectors(
      completed,
      scaleRateVector(
        plan.transferWork,
        getCompletedFraction(shard.transferRemaining),
      ),
    );
    completed = addRateVectors(
      completed,
      scaleRateVector(
        plan.computeWork,
        getCompletedFraction(shard.computeRemaining),
      ),
    );
  }
  completed = addRateVectors(
    completed,
    scaleRateVector(
      normalized.plan.reduce.work,
      getCompletedFraction(normalized.reduceRemaining),
    ),
  );
  completed = addRateVectors(
    completed,
    scaleRateVector(
      normalized.plan.commit.work,
      getCompletedFraction(normalized.commitRemaining),
    ),
  );
  return createRateVector(
    Object.fromEntries(
      exactRateResourceIds.map((resource) => [resource, completed[resource]]),
    ) as RateVector,
  );
};
