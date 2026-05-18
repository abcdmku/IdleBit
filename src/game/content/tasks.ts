import { bitsToBytes } from "../progression";
import type {
  GameState,
  TaskDefinition,
  TaskId,
  TaskKind,
  TaskMemoryOperationKind,
  TaskOperationDefinition,
  TaskOperationKind,
  TaskSubtaskDefinition,
} from "../types";
import { hasResearch } from "./research";

type RawOperation = {
  id: string;
  name: string;
  kind: TaskOperationKind;
  memoryAction?: TaskMemoryOperationKind;
  count?: number;
  cycles: number;
  cacheBits?: number;
  ramBits: number;
  parallel?: boolean;
};

type RawRecipeStep = {
  id: string;
  name: string;
  operationIds: string[];
  dependsOn?: string[];
};

type RawTask = {
  id: TaskId;
  name: string;
  kind: TaskKind;
  category: TaskDefinition["category"];
  rewardData: number;
  parallelizable: boolean;
  repeatable: boolean;
  minCores: number;
  maxCores?: number;
  reveal: (state: GameState) => boolean;
  requirement: (state: GameState) => boolean;
  operations: RawOperation[];
  recipe: RawRecipeStep[];
};

const countTask = (state: GameState, id: TaskDefinition["id"]) =>
  state.completedTasks[id] ?? state.completedJobs[id] ?? 0;

const hasCompleted = (state: GameState, id: TaskDefinition["id"]) =>
  countTask(state, id) > 0 || state.completedBenchmarks.includes(id);

const op = (
  originTaskId: TaskId,
  operation: RawOperation,
): TaskOperationDefinition => {
  const count = Math.max(1, operation.count ?? 1);
  const cacheBits =
    operation.cacheBits ??
    (operation.kind === "memory" && operation.memoryAction ? count : 0);

  if (operation.kind === "memory" && !operation.memoryAction) {
    throw new Error(`Memory operation ${originTaskId}:${operation.id} needs an action`);
  }

  if (operation.kind !== "memory" && operation.memoryAction) {
    throw new Error(
      `Only memory operations can use ${operation.memoryAction}: ${originTaskId}:${operation.id}`,
    );
  }

  return {
    id: `${originTaskId}:${operation.id}`,
    name: operation.name,
    kind: operation.kind,
    memoryAction: operation.memoryAction ?? null,
    count,
    cycles: operation.cycles * count,
    cacheBits,
    ramBits: operation.ramBits,
    cacheBytes: bitsToBytes(cacheBits),
    ramBytes: bitsToBytes(operation.ramBits),
    parallel: operation.parallel ?? false,
  };
};

const dagNode = (
  update: Omit<
    TaskSubtaskDefinition,
    "cacheBytes" | "ramBytes" | "operationCount"
  > & { operationCount?: number },
): TaskSubtaskDefinition => ({
  ...update,
  operationCount:
    update.operationCount ??
    update.operations.reduce((total, operation) => total + operation.count, 0),
  cacheBytes: bitsToBytes(update.cacheBits),
  ramBytes: bitsToBytes(update.ramBits),
});

const getProvisionedCacheBits = (
  operations: TaskOperationDefinition[],
  parallelCoreCount = 1,
) =>
  operations.reduce((provisionedBits, operation) => {
    if (operation.cacheBits <= 0) return provisionedBits;

    const operationCacheBits =
      operation.cacheBits * (operation.parallel ? parallelCoreCount : 1);

    if (operation.kind !== "memory") {
      return Math.max(provisionedBits, operationCacheBits);
    }

    if (operation.memoryAction === "overwrite") {
      return Math.max(provisionedBits, operationCacheBits);
    }

    return provisionedBits + operationCacheBits;
  }, 0);

const getOperationCoreMultiplier = (
  operation: TaskOperationDefinition,
  parallelCoreCount: number,
) => (operation.parallel ? parallelCoreCount : 1);

const getOperationCpuWork = (
  operation: TaskOperationDefinition,
  parallelCoreCount: number,
) => operation.cycles * getOperationCoreMultiplier(operation, parallelCoreCount);

const getOperationCacheLoadWork = (
  operation: TaskOperationDefinition,
  parallelCoreCount: number,
) => operation.cacheBits * getOperationCoreMultiplier(operation, parallelCoreCount);

const getOperationRamLoadWork = (
  operation: TaskOperationDefinition,
  parallelCoreCount: number,
) => operation.ramBits * getOperationCoreMultiplier(operation, parallelCoreCount);

const getOperationsCpuWork = (
  operations: TaskOperationDefinition[],
  parallelCoreCount: number,
) =>
  operations.reduce(
    (total, operation) => total + getOperationCpuWork(operation, parallelCoreCount),
    0,
  );

const getOperationsCacheLoadWork = (
  operations: TaskOperationDefinition[],
  parallelCoreCount: number,
) =>
  operations.reduce(
    (total, operation) =>
      total + getOperationCacheLoadWork(operation, parallelCoreCount),
    0,
  );

const getOperationsRamLoadWork = (
  operations: TaskOperationDefinition[],
  parallelCoreCount: number,
) =>
  operations.reduce(
    (largest, operation) =>
      Math.max(largest, getOperationRamLoadWork(operation, parallelCoreCount)),
    0,
  );

const getOperationsWorkCount = (
  operations: TaskOperationDefinition[],
  parallelCoreCount: number,
) =>
  getOperationsCpuWork(operations, parallelCoreCount) +
  getOperationsCacheLoadWork(operations, parallelCoreCount) +
  getOperationsRamLoadWork(operations, parallelCoreCount);

const summarizeOperations = (
  operations: TaskOperationDefinition[],
  parallelCoreCount = 1,
) => ({
  operationCount: getOperationsWorkCount(operations, parallelCoreCount),
  cycles: getOperationsCpuWork(operations, parallelCoreCount),
  cacheBits: getProvisionedCacheBits(operations, parallelCoreCount),
  ramBits: operations.reduce(
    (largest, operation) => Math.max(largest, operation.ramBits),
    0,
  ),
});

const summarizeGraphNodes = (
  nodes: TaskSubtaskDefinition[],
  parallelCoreCount = 1,
) => {
  return {
    operationCount: nodes.reduce((total, node) => total + node.operationCount, 0),
    cycles: nodes
      .filter((node) => node.kind === "execute" || node.kind === "recipe")
      .reduce((total, node) => total + node.cycles, 0),
    cacheBits: getProvisionedCacheBits(
      nodes
        .filter((node) => node.kind === "execute" || node.kind === "recipe")
        .flatMap((node) => node.operations),
      parallelCoreCount,
    ),
    ramBits: nodes.reduce((largest, node) => Math.max(largest, node.ramBits), 0),
  };
};

const deriveRecipeNodes = (
  taskId: TaskId,
  recipe: RawRecipeStep[],
  operations: TaskOperationDefinition[],
  parallelCoreCount: number,
) => {
  const operationsById = new Map(operations.map((operation) => [operation.id, operation]));

  return recipe.map((step, index) => {
    const stepOperations = step.operationIds.map((operationId) => {
      const fullId = `${taskId}:${operationId}`;
      const operation = operationsById.get(fullId);

      if (!operation) {
        throw new Error(`Unknown operation ${fullId} in recipe ${taskId}:${step.id}`);
      }

      return operation;
    });
    const summary = summarizeOperations(stepOperations, parallelCoreCount);

    return dagNode({
      id: `${taskId}:recipe:${step.id}`,
      name: step.name,
      kind: "recipe",
      dependsOn:
        step.dependsOn?.map((dependencyId) => `${taskId}:recipe:${dependencyId}`) ??
        (index === 0 ? [] : [`${taskId}:recipe:${recipe[index - 1]?.id}`]),
      operationIds: stepOperations.map((operation) => operation.id),
      operations: stepOperations,
      subtasks: [],
      cycles: summary.cycles,
      cacheBits: summary.cacheBits,
      ramBits: summary.ramBits,
    });
  });
};

const getRecipeStepId = (taskId: TaskId, nodeId: string) =>
  nodeId.replace(`${taskId}:recipe:`, "");

const getRecipeDependencyNodeIds = (
  taskId: TaskId,
  step: RawRecipeStep,
  index: number,
  recipe: RawRecipeStep[],
  terminalNodeByStepId: Map<string, string>,
) => {
  if (step.dependsOn) {
    return step.dependsOn.map((dependencyId) => {
      const nodeId = terminalNodeByStepId.get(dependencyId);

      if (!nodeId) {
        throw new Error(`Unknown recipe dependency ${taskId}:recipe:${dependencyId}`);
      }

      return nodeId;
    });
  }

  const previousStep = recipe[index - 1];
  if (!previousStep) return [`${taskId}:accept`];

  const previousNodeId = terminalNodeByStepId.get(previousStep.id);
  if (!previousNodeId) {
    throw new Error(`Recipe step ${taskId}:recipe:${step.id} is not topological`);
  }

  return [previousNodeId];
};

const rawTasks: RawTask[] = [
  {
    id: "fetchBit",
    name: "Fetch Bit",
    kind: "task",
    category: "cpu",
    rewardData: 0,
    parallelizable: false,
    repeatable: true,
    minCores: 1,
    reveal: () => true,
    requirement: () => true,
    operations: [
      {
        id: "fetch-bit",
        name: "Fetch Bit",
        kind: "memory",
        memoryAction: "read",
        cycles: 1,
        ramBits: 0,
      },
    ],
    recipe: [
      {
        id: "fetch",
        name: "Fetch one bit",
        operationIds: ["fetch-bit"],
      },
    ],
  },
  {
    id: "decodeBit",
    name: "Decode Bit",
    kind: "task",
    category: "cpu",
    rewardData: 0,
    parallelizable: false,
    repeatable: true,
    minCores: 1,
    reveal: () => true,
    requirement: () => true,
    operations: [
      {
        id: "fetch-token",
        name: "Fetch Token",
        kind: "memory",
        memoryAction: "read",
        cycles: 1,
        ramBits: 0,
      },
      {
        id: "decode-bit",
        name: "Decode Bit",
        kind: "compute",
        cycles: 2,
        cacheBits: 2,
        ramBits: 0,
      },
    ],
    recipe: [
      {
        id: "fetch-token",
        name: "Fetch token",
        operationIds: ["fetch-token"],
      },
      {
        id: "decode-token",
        name: "Decode token",
        operationIds: ["decode-bit"],
      },
    ],
  },
  {
    id: "bitFlip",
    name: "Bit Flip",
    kind: "task",
    category: "cpu",
    rewardData: 1,
    parallelizable: false,
    repeatable: true,
    minCores: 1,
    reveal: (state) =>
      hasResearch(state, "decodeLogic") || hasResearch(state, "bitMutation"),
    requirement: (state) =>
      hasResearch(state, "decodeLogic") || hasResearch(state, "bitMutation"),
    operations: [
      {
        id: "read-bit",
        name: "Read Bit",
        kind: "memory",
        memoryAction: "read",
        cycles: 1,
        ramBits: 0,
      },
      {
        id: "overwrite-bit",
        name: "Overwrite Bit",
        kind: "memory",
        memoryAction: "overwrite",
        cycles: 1,
        ramBits: 0,
      },
    ],
    recipe: [
      {
        id: "read",
        name: "Read source bit",
        operationIds: ["read-bit"],
      },
      {
        id: "overwrite",
        name: "Write flipped bit",
        operationIds: ["overwrite-bit"],
      },
    ],
  },
  {
    id: "bitShift",
    name: "Bit Shift",
    kind: "task",
    category: "cpu",
    rewardData: 1,
    parallelizable: false,
    repeatable: true,
    minCores: 1,
    reveal: (state) =>
      hasResearch(state, "decodeLogic") || hasResearch(state, "shiftOperations"),
    requirement: (state) =>
      hasResearch(state, "decodeLogic") || hasResearch(state, "shiftOperations"),
    operations: [
      {
        id: "read-bit",
        name: "Read Bit",
        kind: "memory",
        memoryAction: "read",
        cycles: 1,
        ramBits: 0,
      },
      {
        id: "overwrite-bit",
        name: "Overwrite Shifted Bit",
        kind: "memory",
        memoryAction: "overwrite",
        cycles: 1,
        ramBits: 0,
      },
    ],
    recipe: [
      {
        id: "read",
        name: "Read source bit",
        operationIds: ["read-bit"],
      },
      {
        id: "overwrite",
        name: "Write shifted bit",
        operationIds: ["overwrite-bit"],
      },
    ],
  },
  {
    id: "byteCopy",
    name: "Byte Copy",
    kind: "task",
    category: "cpu",
    rewardData: 2,
    parallelizable: false,
    repeatable: true,
    minCores: 1,
    reveal: (state) => hasResearch(state, "byteOperations"),
    requirement: (state) => hasResearch(state, "byteOperations"),
    operations: [
      {
        id: "read-byte",
        name: "Read 8 Bits",
        kind: "memory",
        memoryAction: "read",
        count: 8,
        cycles: 1,
        ramBits: 0,
      },
      {
        id: "write-byte",
        name: "Write 8 Bits",
        kind: "memory",
        memoryAction: "write",
        count: 8,
        cycles: 1,
        ramBits: 0,
      },
    ],
    recipe: [
      {
        id: "read",
        name: "Read byte bits",
        operationIds: ["read-byte"],
      },
      {
        id: "write",
        name: "Write byte bits",
        operationIds: ["write-byte"],
      },
    ],
  },
  {
    id: "packetCheck",
    name: "Packet Check",
    kind: "task",
    category: "cpu",
    rewardData: 1,
    parallelizable: false,
    repeatable: true,
    minCores: 1,
    reveal: (state) => hasResearch(state, "cacheMapping"),
    requirement: (state) => hasResearch(state, "cacheMapping"),
    operations: [
      {
        id: "fetch-packet",
        name: "Fetch Packet Window",
        kind: "memory",
        memoryAction: "read",
        count: 2,
        cycles: 4,
        ramBits: 0,
      },
      {
        id: "decode-packet",
        name: "Decode Packet",
        kind: "compute",
        cycles: 12,
        cacheBits: 2,
        ramBits: 0,
      },
      {
        id: "compare-packet",
        name: "Compare Packet",
        kind: "compute",
        cycles: 24,
        cacheBits: 2,
        ramBits: 0,
      },
    ],
    recipe: [
      {
        id: "fetch-window",
        name: "Fetch packet window",
        operationIds: ["fetch-packet"],
      },
      {
        id: "decode",
        name: "Decode packet",
        operationIds: ["decode-packet"],
      },
      {
        id: "compare",
        name: "Compare packet",
        operationIds: ["compare-packet"],
      },
    ],
  },
  {
    id: "tinyChecksum",
    name: "Tiny Checksum",
    kind: "task",
    category: "system",
    rewardData: 2,
    parallelizable: false,
    repeatable: true,
    minCores: 1,
    reveal: (state) =>
      hasResearch(state, "ramControl") && hasCompleted(state, "packetCheck"),
    requirement: (state) =>
      hasResearch(state, "ramControl") && countTask(state, "packetCheck") >= 1,
    operations: [
      {
        id: "stage-checksum",
        name: "Stage Checksum Page",
        kind: "memory",
        memoryAction: "read",
        count: 8,
        cycles: 3,
        ramBits: 256,
      },
      {
        id: "checksum-step",
        name: "Checksum Step",
        kind: "compute",
        cycles: 36,
        cacheBits: 8,
        ramBits: 256,
      },
    ],
    recipe: [
      {
        id: "stage",
        name: "Stage checksum page",
        operationIds: ["stage-checksum"],
      },
      {
        id: "fold",
        name: "Fold checksum",
        operationIds: ["checksum-step"],
      },
    ],
  },
  {
    id: "memoryScrub",
    name: "Memory Scrub",
    kind: "task",
    category: "system",
    rewardData: 3,
    parallelizable: false,
    repeatable: true,
    minCores: 1,
    reveal: (state) => hasCompleted(state, "tinyChecksum"),
    requirement: (state) =>
      hasResearch(state, "systemScheduler") && hasCompleted(state, "tinyChecksum"),
    operations: [
      {
        id: "scan-page",
        name: "Scan RAM Page",
        kind: "memory",
        memoryAction: "read",
        count: 16,
        cycles: 2,
        ramBits: 512,
      },
      {
        id: "repair-page",
        name: "Repair Drift",
        kind: "memory",
        memoryAction: "overwrite",
        count: 16,
        cycles: 2,
        ramBits: 512,
      },
    ],
    recipe: [
      {
        id: "scan",
        name: "Scan staged page",
        operationIds: ["scan-page"],
      },
      {
        id: "repair",
        name: "Repair memory drift",
        operationIds: ["repair-page"],
      },
    ],
  },
  {
    id: "queueCompaction",
    name: "Queue Compaction",
    kind: "task",
    category: "system",
    rewardData: 2,
    parallelizable: false,
    repeatable: true,
    minCores: 1,
    reveal: (state) => hasCompleted(state, "tinyChecksum"),
    requirement: (state) =>
      hasResearch(state, "systemScheduler") && hasCompleted(state, "tinyChecksum"),
    operations: [
      {
        id: "read-queue",
        name: "Read Queue Table",
        kind: "memory",
        memoryAction: "read",
        count: 8,
        cycles: 3,
        ramBits: 256,
      },
      {
        id: "compact-queue",
        name: "Compact Queue Entries",
        kind: "compute",
        cycles: 54,
        cacheBits: 8,
        ramBits: 256,
      },
    ],
    recipe: [
      {
        id: "read",
        name: "Read queue table",
        operationIds: ["read-queue"],
      },
      {
        id: "compact",
        name: "Compact waiting entries",
        operationIds: ["compact-queue"],
      },
    ],
  },
  {
    id: "powerTelemetry",
    name: "Power Telemetry",
    kind: "task",
    category: "system",
    rewardData: 2,
    parallelizable: false,
    repeatable: true,
    minCores: 1,
    reveal: (state) => hasCompleted(state, "tinyChecksum"),
    requirement: (state) =>
      hasResearch(state, "systemScheduler") && hasCompleted(state, "tinyChecksum"),
    operations: [
      {
        id: "sample-rails",
        name: "Sample Power Rails",
        kind: "memory",
        memoryAction: "read",
        count: 8,
        cycles: 4,
        ramBits: 256,
      },
      {
        id: "normalize-draw",
        name: "Normalize Draw Trace",
        kind: "compute",
        cycles: 48,
        cacheBits: 8,
        ramBits: 256,
      },
    ],
    recipe: [
      {
        id: "sample",
        name: "Sample power rails",
        operationIds: ["sample-rails"],
      },
      {
        id: "normalize",
        name: "Normalize draw trace",
        operationIds: ["normalize-draw"],
      },
    ],
  },
  {
    id: "busMirror",
    name: "Bus Mirror",
    kind: "task",
    category: "system",
    rewardData: 5,
    parallelizable: true,
    repeatable: true,
    minCores: 2,
    maxCores: 2,
    reveal: (state) => state.hardware.secondCpu,
    requirement: (state) =>
      state.hardware.secondCpu && hasResearch(state, "systemScheduler"),
    operations: [
      {
        id: "read-bus",
        name: "Read Bus Window",
        kind: "memory",
        memoryAction: "read",
        count: 8,
        cycles: 5,
        ramBits: 512,
        parallel: true,
      },
      {
        id: "mirror-bus",
        name: "Mirror Bus State",
        kind: "compute",
        cycles: 72,
        cacheBits: 8,
        ramBits: 512,
        parallel: true,
      },
    ],
    recipe: [
      {
        id: "read",
        name: "Read bus window",
        operationIds: ["read-bus"],
      },
      {
        id: "mirror",
        name: "Mirror bus state",
        operationIds: ["mirror-bus"],
      },
    ],
  },
  {
    id: "thermalProbe",
    name: "Thermal Probe",
    kind: "task",
    category: "system",
    rewardData: 4,
    parallelizable: false,
    repeatable: true,
    minCores: 1,
    reveal: (state) => state.hardware.secondCpu,
    requirement: (state) =>
      state.hardware.secondCpu && hasResearch(state, "systemScheduler"),
    operations: [
      {
        id: "sample-thermals",
        name: "Sample Thermal Sensors",
        kind: "memory",
        memoryAction: "read",
        count: 12,
        cycles: 4,
        ramBits: 384,
      },
      {
        id: "fit-curve",
        name: "Fit Heat Curve",
        kind: "compute",
        cycles: 84,
        cacheBits: 12,
        ramBits: 384,
      },
    ],
    recipe: [
      {
        id: "sample",
        name: "Sample thermal sensors",
        operationIds: ["sample-thermals"],
      },
      {
        id: "fit",
        name: "Fit heat curve",
        operationIds: ["fit-curve"],
      },
    ],
  },
  {
    id: "shardReconcile",
    name: "Shard Reconcile",
    kind: "task",
    category: "system",
    rewardData: 8,
    parallelizable: true,
    repeatable: true,
    minCores: 4,
    maxCores: 4,
    reveal: (state) => state.hardware.secondCpu,
    requirement: (state) =>
      state.hardware.secondCpu && hasResearch(state, "systemScheduler"),
    operations: [
      {
        id: "load-shards",
        name: "Load Shards",
        kind: "memory",
        memoryAction: "read",
        count: 8,
        cycles: 6,
        ramBits: 1024,
        parallel: true,
      },
      {
        id: "reconcile-shards",
        name: "Reconcile Shards",
        kind: "compute",
        cycles: 108,
        cacheBits: 8,
        ramBits: 1024,
        parallel: true,
      },
      {
        id: "merge-barrier",
        name: "Merge Barrier",
        kind: "barrier",
        cycles: 0,
        cacheBits: 0,
        ramBits: 0,
        parallel: true,
      },
      {
        id: "commit-shards",
        name: "Commit Shards",
        kind: "compute",
        cycles: 84,
        cacheBits: 16,
        ramBits: 1024,
      },
    ],
    recipe: [
      {
        id: "load",
        name: "Load shard pages",
        operationIds: ["load-shards"],
      },
      {
        id: "reconcile",
        name: "Reconcile shard state",
        operationIds: ["reconcile-shards"],
      },
      {
        id: "merge",
        name: "Merge shard barrier",
        operationIds: ["merge-barrier"],
      },
      {
        id: "commit",
        name: "Commit shard table",
        operationIds: ["commit-shards"],
      },
    ],
  },
  {
    id: "microBenchmark",
    name: "Micro Benchmark",
    kind: "benchmark",
    category: "cpu",
    rewardData: 4,
    parallelizable: false,
    repeatable: false,
    minCores: 1,
    reveal: (state) => hasResearch(state, "benchmarkHarness"),
    requirement: (state) =>
      hasResearch(state, "benchmarkHarness") &&
      !hasCompleted(state, "microBenchmark") &&
      state.hardware.clockLevel >= 3 &&
      state.hardware.cacheLevel >= 3,
    operations: [
      {
        id: "run-microbench",
        name: "Run Micro Benchmark",
        kind: "compute",
        cycles: 80,
        cacheBits: 4,
        ramBits: 0,
      },
    ],
    recipe: [
      {
        id: "run",
        name: "Run tuned workload",
        operationIds: ["run-microbench"],
      },
    ],
  },
  {
    id: "parallelismBenchmark",
    name: "Parallelism Benchmark",
    kind: "benchmark",
    category: "cpu",
    rewardData: 8,
    parallelizable: false,
    repeatable: false,
    minCores: 1,
    reveal: (state) => hasCompleted(state, "microBenchmark"),
    requirement: (state) =>
      hasCompleted(state, "microBenchmark") &&
      hasResearch(state, "benchmarkHarness") &&
      !hasCompleted(state, "parallelismBenchmark"),
    operations: [
      {
        id: "measure-splits",
        name: "Measure Work Splits",
        kind: "compute",
        cycles: 110,
        cacheBits: 4,
        ramBits: 0,
      },
    ],
    recipe: [
      {
        id: "measure",
        name: "Measure work splits",
        operationIds: ["measure-splits"],
      },
    ],
  },
  {
    id: "multiCoreBenchmark",
    name: "Multi-Core Benchmark",
    kind: "benchmark",
    category: "system",
    rewardData: 14,
    parallelizable: true,
    repeatable: false,
    minCores: 4,
    maxCores: 4,
    reveal: (state) => hasResearch(state, "systemScheduler"),
    requirement: (state) =>
      hasResearch(state, "systemScheduler") &&
      state.hardware.cores >= 4 &&
      !hasCompleted(state, "multiCoreBenchmark"),
    operations: [
      {
        id: "scatter-shards",
        name: "Scatter Shards",
        kind: "memory",
        memoryAction: "read",
        count: 2,
        cycles: 21,
        ramBits: 0,
        parallel: true,
      },
      {
        id: "decode-shards",
        name: "Decode Shards",
        kind: "compute",
        cycles: 48,
        cacheBits: 2,
        ramBits: 0,
        parallel: true,
      },
      {
        id: "hash-shards",
        name: "Hash Shards",
        kind: "compute",
        cycles: 120,
        cacheBits: 2,
        ramBits: 0,
        parallel: true,
      },
      {
        id: "merge-barrier",
        name: "Merge Barrier",
        kind: "barrier",
        cycles: 0,
        cacheBits: 0,
        ramBits: 0,
        parallel: true,
      },
      {
        id: "commit-result",
        name: "Commit Result",
        kind: "compute",
        cycles: 60,
        cacheBits: 4,
        ramBits: 0,
      },
    ],
    recipe: [
      {
        id: "scatter",
        name: "Scatter shards",
        operationIds: ["scatter-shards"],
      },
      {
        id: "decode",
        name: "Decode shards",
        operationIds: ["decode-shards"],
      },
      {
        id: "hash",
        name: "Hash shards",
        operationIds: ["hash-shards"],
      },
      {
        id: "merge",
        name: "Merge shard barrier",
        operationIds: ["merge-barrier"],
      },
      {
        id: "commit",
        name: "Commit result",
        operationIds: ["commit-result"],
      },
    ],
  },
];

const rawTaskById = new Map(rawTasks.map((task) => [task.id, task]));
const definitionCache = new Map<TaskId, TaskDefinition>();

const makeTaskNode = (task: TaskDefinition): TaskSubtaskDefinition =>
  dagNode({
    id: task.id,
    name: task.name,
    kind: "task",
    dependsOn: [],
    operationIds: task.operations.map((operation) => operation.id),
    operations: task.operations,
    subtasks: task.subtasks,
    cycles: task.requiredCycles,
    cacheBits: task.cacheNeedBits,
    ramBits: task.ramNeedBits,
  });

const deriveDagNodes = (
  taskId: TaskId,
  recipe: RawRecipeStep[],
  recipeNodes: TaskSubtaskDefinition[],
) => {
  const nodes: TaskSubtaskDefinition[] = [
    dagNode({
      id: `${taskId}:accept`,
      name: "Accept Task",
      kind: "accept",
      dependsOn: [],
      operationIds: [],
      operations: [],
      subtasks: [],
      cycles: 0,
      cacheBits: 0,
      ramBits: 0,
    }),
  ];

  const recipeNodeByStepId = new Map(
    recipeNodes.map((node) => [getRecipeStepId(taskId, node.id), node]),
  );
  const terminalNodeByStepId = new Map<string, string>();
  const dependedStepIds = new Set<string>();
  let loadedRamBits = 0;

  for (const [index, step] of recipe.entries()) {
    const recipeNode = recipeNodeByStepId.get(step.id);
    if (!recipeNode) {
      throw new Error(`Missing recipe node ${taskId}:recipe:${step.id}`);
    }

    const dependencyStepIds =
      step.dependsOn ?? (index === 0 ? [] : [recipe[index - 1]?.id]);
    for (const dependencyStepId of dependencyStepIds) {
      if (dependencyStepId) dependedStepIds.add(dependencyStepId);
    }

    let dependencyIds = getRecipeDependencyNodeIds(
      taskId,
      step,
      index,
      recipe,
      terminalNodeByStepId,
    );

    if (recipeNode.cacheBits > 0) {
      const id = `${taskId}:cache:${step.id}`;
      const cacheOperations = recipeNode.operations.filter(
        (operation) => operation.cacheBits > 0,
      );

      nodes.push(
        dagNode({
          id,
          name: `Fill cache: ${recipeNode.name}`,
          kind: "cacheLoad",
          dependsOn: dependencyIds,
          operationIds: cacheOperations.map((operation) => operation.id),
          operations: cacheOperations,
          subtasks: [],
          operationCount: recipeNode.cacheBits,
          cycles: 0,
          cacheBits: recipeNode.cacheBits,
          ramBits: 0,
        }),
      );
      dependencyIds = [id];
    }

    if (recipeNode.ramBits > loadedRamBits) {
      const id = `${taskId}:ram:${step.id}`;
      const ramOperations = recipeNode.operations.filter(
        (operation) => operation.ramBits > 0,
      );

      nodes.push(
        dagNode({
          id,
          name: `Stage RAM: ${recipeNode.name}`,
          kind: "ramLoad",
          dependsOn: dependencyIds,
          operationIds: ramOperations.map((operation) => operation.id),
          operations: ramOperations,
          subtasks: [],
          operationCount: recipeNode.ramBits,
          cycles: 0,
          cacheBits: 0,
          ramBits: recipeNode.ramBits,
        }),
      );
      dependencyIds = [id];
      loadedRamBits = recipeNode.ramBits;
    }

    const executeId = `${taskId}:execute:${step.id}`;
    nodes.push(
      dagNode({
        id: executeId,
        name: recipeNode.name,
        kind: "execute",
        dependsOn: dependencyIds,
        operationIds: recipeNode.operationIds,
        operations: recipeNode.operations,
        subtasks: [],
        operationCount: recipeNode.cycles,
        cycles: recipeNode.cycles,
        cacheBits: recipeNode.cacheBits,
        ramBits: recipeNode.ramBits,
      }),
    );
    terminalNodeByStepId.set(step.id, executeId);
  }

  const terminalSteps = recipe.filter((step) => !dependedStepIds.has(step.id));
  const completionDependencies = terminalSteps
    .map((step) => terminalNodeByStepId.get(step.id))
    .filter((nodeId): nodeId is string => Boolean(nodeId));

  nodes.push(
    dagNode({
      id: `${taskId}:complete`,
      name: "Complete Task",
      kind: "complete",
      dependsOn:
        completionDependencies.length > 0
          ? completionDependencies
          : [`${taskId}:accept`],
      operationIds: [],
      operations: [],
      subtasks: [],
      cycles: 0,
      cacheBits: 0,
      ramBits: 0,
    }),
  );

  return nodes;
};

const buildTaskDefinition = (id: TaskId): TaskDefinition => {
  const cached = definitionCache.get(id);
  if (cached) return cached;

  const raw = rawTaskById.get(id);
  if (!raw) {
    throw new Error(`Unknown task: ${id}`);
  }

  const operations = raw.operations.map((operation) => op(raw.id, operation));
  const parallelCoreCount = raw.maxCores ?? raw.minCores;
  const subtasks = deriveRecipeNodes(
    raw.id,
    raw.recipe,
    operations,
    parallelCoreCount,
  );
  const dagNodes = deriveDagNodes(raw.id, raw.recipe, subtasks);
  const summary = summarizeGraphNodes(dagNodes, parallelCoreCount);
  const definition: TaskDefinition = {
    id: raw.id,
    name: raw.name,
    kind: raw.kind,
    category: raw.category,
    rewardData: raw.rewardData,
    parallelizable: raw.parallelizable,
    repeatable: raw.repeatable,
    minCores: raw.minCores,
    maxCores: raw.maxCores,
    reveal: raw.reveal,
    requirement: raw.requirement,
    subtasks,
    operations,
    operationCount: summary.operationCount,
    rewardCredits: summary.operationCount,
    requiredCycles: summary.cycles,
    cacheNeedBits: summary.cacheBits,
    ramNeedBits: summary.ramBits,
    cacheNeedBytes: bitsToBytes(summary.cacheBits),
    ramNeedBytes: bitsToBytes(summary.ramBits),
    dagNodes,
  };

  definitionCache.set(id, definition);
  return definition;
};

export const taskDefinitions: TaskDefinition[] = rawTasks.map((task) =>
  buildTaskDefinition(task.id),
);

export const getTaskDefinition = (id: TaskDefinition["id"]) => {
  const task = definitionCache.get(id);

  if (!task) {
    throw new Error(`Unknown task: ${id}`);
  }

  return task;
};

export const getTaskDagNode = (id: TaskDefinition["id"]) =>
  makeTaskNode(getTaskDefinition(id));
