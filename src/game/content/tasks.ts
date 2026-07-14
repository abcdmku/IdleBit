import { amount, amountToSafeNumber } from "../amount";
import { bitsToBytes } from "../units";
import type {
  GameState,
  TaskCompositionDefinition,
  TaskCoreScaling,
  TaskDefinition,
  TaskId,
  TaskKind,
  TaskVisibility,
  TaskMemoryOperationKind,
  TaskOperationDefinition,
  TaskOperationKind,
  TaskSubtaskDefinition,
} from "../types";
import {
  hasDecodeLogic,
  hasResearch,
  systemCatalogResearchId,
} from "./research";

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
  acceleratorClass?: TaskOperationDefinition["acceleratorClass"];
  acceleratorModelMemoryBits?: number;
  acceleratorBatchSize?: number;
  acceleratorMinimumComputeOperationsPerSecond?: number;
  acceleratorPreferredKind?: TaskOperationDefinition["acceleratorPreferredKind"];
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
  visibility?: TaskVisibility;
  rewardData: string | number;
  aggregateBatch?: TaskDefinition["aggregateBatch"];
  parallelizable: boolean;
  repeatable: boolean;
  coreScaling?: TaskCoreScaling;
  workUnitCount?: number;
  workUnitName?: string;
  minCores: number;
  maxCores?: number;
  reveal: (state: GameState) => boolean;
  requirement: (state: GameState) => boolean;
  operations?: RawOperation[];
  composition?: Array<{
    taskId: TaskId;
    count?: number;
    mode?: TaskCompositionDefinition["mode"];
  }>;
  recipe: RawRecipeStep[];
};

const compileCodeTaskId: TaskId = "compileCode";
const renderFrameTaskId: TaskId = "renderFrame";
const inferenceBatchTaskId: TaskId = "inferenceBatch";
const regressionTestTaskId: TaskId = "regressionTest";

const countTask = (state: GameState, id: TaskDefinition["id"]) =>
  state.completedTasks[id] ?? state.completedJobs[id] ?? 0;

const hasCompleted = (state: GameState, id: TaskDefinition["id"]) =>
  countTask(state, id) > 0 || state.completedBenchmarks.includes(id);

const hasSpecializationEvidence = (state: GameState) => {
  const totals = state.systems.reduce(
    (evidence, system) => ({
      gpu:
        evidence.gpu +
        (system.workshop?.evidence.gpuRenderCompletions ?? 0),
      npu:
        evidence.npu +
        (system.workshop?.evidence.npuInferenceCompletions ?? 0),
    }),
    { gpu: 0, npu: 0 },
  );
  return totals.gpu > 0 && totals.npu > 0;
};

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
    sourceTaskId: originTaskId,
    kind: operation.kind,
    memoryAction: operation.memoryAction ?? null,
    count,
    cycles: operation.cycles * count,
    cacheBits,
    ramBits: operation.ramBits,
    cacheBytes: bitsToBytes(cacheBits),
    ramBytes: bitsToBytes(operation.ramBits),
    parallel: operation.parallel ?? false,
    acceleratorClass: operation.acceleratorClass ?? null,
    acceleratorModelMemoryBits:
      operation.acceleratorModelMemoryBits ?? 0,
    acceleratorBatchSize: operation.acceleratorBatchSize ?? 1,
    acceleratorMinimumComputeOperationsPerSecond:
      operation.acceleratorMinimumComputeOperationsPerSecond ?? 0,
    acceleratorPreferredKind: operation.acceleratorPreferredKind ?? null,
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

const createCoreRange = (parallelCoreCount: number) =>
  Array.from({ length: Math.max(1, parallelCoreCount) }, (_, index) => index);

const isOperationAssignedToCoreIndex = (
  operation: TaskOperationDefinition,
  coreIndex: number,
) => operation.parallel || operation.kind === "barrier" || coreIndex === 0;

const getOperationCoreIndexes = (
  operation: TaskOperationDefinition,
  parallelCoreCount: number,
) =>
  createCoreRange(parallelCoreCount).filter((coreIndex) =>
    isOperationAssignedToCoreIndex(operation, coreIndex),
  );

const getSegmentBits = (segments: number[]) =>
  segments.reduce((total, bits) => total + bits, 0);

const addOperationCacheBits = (
  segments: number[],
  operation: TaskOperationDefinition,
) => {
  if (operation.cacheBits <= 0) return;

  if (operation.kind === "memory" && operation.memoryAction !== "overwrite") {
    segments.push(operation.cacheBits);
    return;
  }

  const missingBits = operation.cacheBits - getSegmentBits(segments);
  if (missingBits > 0) segments.push(missingBits);
};

const getRuntimeCachePeakBits = (
  operations: TaskOperationDefinition[],
  parallelCoreCount: number,
) => {
  const coreSegments = createCoreRange(parallelCoreCount).map((): number[] => []);
  let peakBits = 0;

  for (const operation of operations) {
    for (const coreIndex of getOperationCoreIndexes(operation, parallelCoreCount)) {
      addOperationCacheBits(coreSegments[coreIndex] ?? [], operation);
    }

    peakBits = Math.max(
      peakBits,
      coreSegments.reduce((total, segments) => total + getSegmentBits(segments), 0),
    );
  }

  return peakBits;
};

type CoreRamState = {
  ready: boolean;
  bits: number;
};

const emptyCoreRamState = (): CoreRamState => ({ ready: false, bits: 0 });

const createCoreRamStates = (parallelCoreCount: number) =>
  createCoreRange(parallelCoreCount).map(emptyCoreRamState);

const summarizeRamRuntime = (
  operations: TaskOperationDefinition[],
  parallelCoreCount: number,
  initialStates = createCoreRamStates(parallelCoreCount),
) => {
  let coreStates = initialStates.map((state) => ({ ...state }));
  let loadWork = 0;
  let peakBits = 0;

  for (const operation of operations) {
    const activeBits = createCoreRange(parallelCoreCount).map((coreIndex) => {
      if (!isOperationAssignedToCoreIndex(operation, coreIndex)) return 0;
      if (operation.ramBits <= 0) return 0;

      const state = coreStates[coreIndex] ?? emptyCoreRamState();
      const retained = state.ready && state.bits >= operation.ramBits;
      if (!retained) loadWork += operation.ramBits;

      return operation.ramBits;
    });

    peakBits = Math.max(
      peakBits,
      activeBits.reduce((total, bits) => total + bits, 0),
    );

    coreStates = coreStates.map((_state, coreIndex) => {
      if (!isOperationAssignedToCoreIndex(operation, coreIndex)) {
        return emptyCoreRamState();
      }

      if (operation.ramBits <= 0 || !operation.memoryAction) {
        return emptyCoreRamState();
      }

      return { ready: true, bits: operation.ramBits };
    });
  }

  return { loadWork, peakBits, coreStates };
};

const getOperationCoreMultiplier = (
  operation: TaskOperationDefinition,
  parallelCoreCount: number,
) => getOperationCoreIndexes(operation, parallelCoreCount).length;

const getOperationCpuWork = (
  operation: TaskOperationDefinition,
  parallelCoreCount: number,
) => operation.cycles * getOperationCoreMultiplier(operation, parallelCoreCount);

const getOperationCacheLoadWork = (
  operation: TaskOperationDefinition,
  parallelCoreCount: number,
) => operation.cacheBits * getOperationCoreMultiplier(operation, parallelCoreCount);

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
) => summarizeRamRuntime(operations, parallelCoreCount).loadWork;

const getOperationsWorkCount = (
  operations: TaskOperationDefinition[],
  parallelCoreCount: number,
) =>
  getOperationsCpuWork(operations, parallelCoreCount) +
  getOperationsCacheLoadWork(operations, parallelCoreCount) +
  getOperationsRamLoadWork(operations, parallelCoreCount);

/** Player-facing authored operation invocations, separate from lane work. */
const getOperationsInvocationCount = (
  operations: TaskOperationDefinition[],
  parallelCoreCount: number,
) => operations.reduce(
  (total, operation) =>
    total + operation.count * getOperationCoreMultiplier(operation, parallelCoreCount),
  0,
);

const getMemoryIssueOverlapWork = (
  operations: TaskOperationDefinition[],
  parallelCoreCount: number,
) =>
  operations.reduce((total, operation) => {
    if (!operation.memoryAction) return total;
    return total + Math.min(
      getOperationCpuWork(operation, parallelCoreCount),
      getOperationCacheLoadWork(operation, parallelCoreCount),
    );
  }, 0);

const summarizeOperations = (
  operations: TaskOperationDefinition[],
  parallelCoreCount = 1,
) => ({
  operationCount: getOperationsWorkCount(operations, parallelCoreCount),
  cycles: getOperationsCpuWork(operations, parallelCoreCount),
  cacheBits: getRuntimeCachePeakBits(operations, parallelCoreCount),
  ramBits: summarizeRamRuntime(operations, parallelCoreCount).peakBits,
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
    cacheBits: getRuntimeCachePeakBits(
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
    const sourceTaskIds = Array.from(
      new Set(
        stepOperations
          .map((operation) => operation.sourceTaskId)
          .filter((id): id is TaskId => Boolean(id)),
      ),
    );
    const sourceTaskNames = Array.from(
      new Set(
        stepOperations
          .map((operation) => operation.sourceTaskName)
          .filter((name): name is string => Boolean(name)),
      ),
    );

    return dagNode({
      id: `${taskId}:recipe:${step.id}`,
      name: step.name,
      sourceTaskId: sourceTaskIds.length === 1 ? sourceTaskIds[0] : undefined,
      sourceTaskName: sourceTaskNames.length === 1 ? sourceTaskNames[0] : undefined,
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

const getOperationSuffix = (taskId: TaskId, operationId: string) =>
  operationId.startsWith(`${taskId}:`)
    ? operationId.slice(`${taskId}:`.length)
    : operationId;

const cloneComposedOperation = (
  parentTaskId: TaskId,
  childTask: TaskDefinition,
  operation: TaskOperationDefinition,
  count: number,
): TaskOperationDefinition => {
  const suffix = getOperationSuffix(childTask.id, operation.id);
  const scaledCount = Math.max(1, operation.count * count);
  const scaledCycles = operation.cycles * count;
  const scaledCacheBits = operation.cacheBits * count;
  const scaledRamBits = operation.ramBits * count;

  return {
    ...operation,
    id: `${parentTaskId}:${suffix}`,
    sourceTaskId: childTask.id,
    sourceTaskName: childTask.name,
    count: scaledCount,
    cycles: scaledCycles,
    cacheBits: scaledCacheBits,
    ramBits: scaledRamBits,
    cacheBytes: bitsToBytes(scaledCacheBits),
    ramBytes: bitsToBytes(scaledRamBits),
  };
};

const hasRamControl = (state: GameState) => hasResearch(state, "ramControl");

const hasInstalledRam = (state: GameState) =>
  hasRamControl(state) && state.hardware.ramBits > 0;

const rawCpuLeafTask = (
  id: TaskId,
  name: string,
  operation: RawOperation,
  options: {
    visibility?: TaskVisibility;
    reveal?: (state: GameState) => boolean;
    requirement?: (state: GameState) => boolean;
    parallelizable?: boolean;
    repeatable?: boolean;
    minCores?: number;
    maxCores?: number;
    rewardData?: number;
  } = {},
): RawTask => ({
  id,
  name,
  kind: "task",
  category: "cpu",
  visibility: options.visibility ?? "internal",
  rewardData: options.rewardData ?? 0,
  parallelizable: options.parallelizable ?? operation.parallel ?? false,
  repeatable: options.repeatable ?? true,
  minCores: options.minCores ?? 1,
  maxCores: options.maxCores,
  reveal: options.reveal ?? (() => false),
  requirement: options.requirement ?? (() => false),
  operations: [operation],
  recipe: [
    {
      id: operation.id,
      name,
      operationIds: [operation.id],
    },
  ],
});

const compose = (
  taskId: TaskId,
  count = 1,
  mode: TaskCompositionDefinition["mode"] = "single",
) => ({ taskId, count, mode });

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
      {
        id: "latch-bit",
        name: "Latch Bit",
        kind: "compute",
        cycles: 1,
        cacheBits: 0,
        ramBits: 0,
      },
    ],
    recipe: [
      {
        id: "fetch",
        name: "Fetch one bit",
        operationIds: ["fetch-bit"],
      },
      {
        id: "latch",
        name: "Latch the fetched bit",
        operationIds: ["latch-bit"],
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
    // First-completion Data re-homed from the retired Bootstrap Benchmark
    // project so the Jobs-only opening funds the same research path. Front-
    // loaded here because the cache ladder to Byte Copy is the first sink.
    rewardData: 5,
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
        id: "flip-bit",
        name: "Flip Bit",
        kind: "compute",
        cycles: 1,
        cacheBits: 0,
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
        id: "flip",
        name: "Flip source bit",
        operationIds: ["flip-bit"],
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
    rewardData: 5,
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
        id: "shift-bit",
        name: "Shift Bit",
        kind: "compute",
        cycles: 2,
        cacheBits: 0,
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
        id: "shift",
        name: "Shift source bit",
        operationIds: ["shift-bit"],
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
    rewardData: 5,
    parallelizable: false,
    repeatable: true,
    minCores: 1,
    reveal: hasDecodeLogic,
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
    rewardData: 4,
    parallelizable: false,
    repeatable: true,
    minCores: 1,
    reveal: hasDecodeLogic,
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
  rawCpuLeafTask(
    "readRamPage",
    "Read RAM Page",
    {
      id: "read-ram-page",
      name: "Read 256 b RAM Page",
      kind: "memory",
      memoryAction: "read",
      count: 8,
      cycles: 3,
      ramBits: 256,
    },
    {
      visibility: "default",
      reveal: hasRamControl,
      requirement: hasInstalledRam,
      // RAM-era first completions fund System Scheduler research now that
      // projects unlock after (not before) the scheduler exists. Tiny
      // Checksum's former 8 Data is re-homed across the three RAM page jobs
      // (+3/+3/+2) because system tasks stay locked until the scheduler
      // exists (C-DES-3).
      rewardData: 6,
    },
  ),
  rawCpuLeafTask(
    "writeRamPage",
    "Write RAM Page",
    {
      id: "write-ram-page",
      name: "Write 256 b RAM Page",
      kind: "memory",
      memoryAction: "write",
      count: 8,
      cycles: 4,
      ramBits: 256,
    },
    {
      visibility: "default",
      reveal: hasRamControl,
      requirement: hasInstalledRam,
      // +3 re-homed from Tiny Checksum (C-DES-3).
      rewardData: 6,
    },
  ),
  rawCpuLeafTask(
    "overwriteRamPage",
    "Overwrite RAM Page",
    {
      id: "overwrite-ram-page",
      name: "Overwrite 256 b RAM Page",
      kind: "memory",
      memoryAction: "overwrite",
      count: 8,
      cycles: 2,
      ramBits: 256,
    },
    {
      visibility: "default",
      reveal: hasRamControl,
      requirement: hasInstalledRam,
      // +2 re-homed from Tiny Checksum (C-DES-3).
      rewardData: 5,
    },
  ),
  rawCpuLeafTask("stageChecksumPage", "Stage Checksum Page", {
    id: "stage-checksum",
    name: "Stage Checksum Page",
    kind: "memory",
    memoryAction: "read",
    count: 8,
    cycles: 3,
    ramBits: 256,
  }),
  rawCpuLeafTask("checksumStep", "Checksum Step", {
    id: "checksum-step",
    name: "Checksum Step",
    kind: "compute",
    cycles: 36,
    cacheBits: 8,
    ramBits: 256,
  }),
  rawCpuLeafTask("scanRamPage", "Scan RAM Page", {
    id: "scan-page",
    name: "Scan RAM Page",
    kind: "memory",
    memoryAction: "read",
    count: 16,
    cycles: 2,
    ramBits: 512,
  }),
  rawCpuLeafTask("repairRamDrift", "Repair Drift", {
    id: "repair-page",
    name: "Repair Drift",
    kind: "memory",
    memoryAction: "overwrite",
    count: 16,
    cycles: 2,
    ramBits: 512,
  }),
  rawCpuLeafTask("readQueueTable", "Read Queue Table", {
    id: "read-queue",
    name: "Read Queue Table",
    kind: "memory",
    memoryAction: "read",
    count: 8,
    cycles: 3,
    ramBits: 256,
  }),
  rawCpuLeafTask("compactQueueEntries", "Compact Queue Entries", {
    id: "compact-queue",
    name: "Compact Queue Entries",
    kind: "compute",
    cycles: 54,
    cacheBits: 8,
    ramBits: 256,
  }),
  rawCpuLeafTask("samplePowerRails", "Sample Power Rails", {
    id: "sample-rails",
    name: "Sample Power Rails",
    kind: "memory",
    memoryAction: "read",
    count: 8,
    cycles: 4,
    ramBits: 256,
  }),
  rawCpuLeafTask("normalizeDrawTrace", "Normalize Draw Trace", {
    id: "normalize-draw",
    name: "Normalize Draw Trace",
    kind: "compute",
    cycles: 48,
    cacheBits: 8,
    ramBits: 256,
  }),
  rawCpuLeafTask(
    "readBusWindow",
    "Read Bus Window",
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
    { parallelizable: true, minCores: 2, maxCores: 2 },
  ),
  rawCpuLeafTask(
    "mirrorBusState",
    "Mirror Bus State",
    {
      id: "mirror-bus",
      name: "Mirror Bus State",
      kind: "compute",
      cycles: 72,
      cacheBits: 8,
      ramBits: 512,
      parallel: true,
    },
    { parallelizable: true, minCores: 2, maxCores: 2 },
  ),
  rawCpuLeafTask("sampleThermalSensors", "Sample Thermal Sensors", {
    id: "sample-thermals",
    name: "Sample Thermal Sensors",
    kind: "memory",
    memoryAction: "read",
    count: 12,
    cycles: 4,
    ramBits: 384,
  }),
  rawCpuLeafTask("fitHeatCurve", "Fit Heat Curve", {
    id: "fit-curve",
    name: "Fit Heat Curve",
    kind: "compute",
    cycles: 84,
    cacheBits: 12,
    ramBits: 384,
  }),
  rawCpuLeafTask(
    "loadShards",
    "Load Shards",
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
    { parallelizable: true, minCores: 4, maxCores: 4 },
  ),
  rawCpuLeafTask(
    "reconcileShards",
    "Reconcile Shards",
    {
      id: "reconcile-shards",
      name: "Reconcile Shards",
      kind: "compute",
      cycles: 108,
      cacheBits: 8,
      ramBits: 1024,
      parallel: true,
    },
    { parallelizable: true, minCores: 4, maxCores: 4 },
  ),
  rawCpuLeafTask(
    "mergeShardBarrier",
    "Merge Barrier",
    {
      id: "merge-barrier",
      name: "Merge Barrier",
      kind: "barrier",
      cycles: 0,
      cacheBits: 0,
      ramBits: 0,
      parallel: true,
    },
    { parallelizable: true, minCores: 4, maxCores: 4 },
  ),
  rawCpuLeafTask("commitShards", "Commit Shards", {
    id: "commit-shards",
    name: "Commit Shards",
    kind: "compute",
    cycles: 84,
    cacheBits: 16,
    ramBits: 1024,
  }),
  rawCpuLeafTask(
    "stageSourceTree",
    "Stage Source Tree",
    {
      id: "stage-source",
      name: "Stage Source Tree",
      kind: "memory",
      memoryAction: "read",
      count: 16,
      cycles: 5,
      ramBits: 512,
      parallel: true,
    },
    { parallelizable: true },
  ),
  rawCpuLeafTask(
    "compileUnits",
    "Compile Units",
    {
      id: "compile-units",
      name: "Compile Units",
      kind: "compute",
      cycles: 160,
      cacheBits: 8,
      ramBits: 512,
      parallel: true,
    },
    { parallelizable: true },
  ),
  rawCpuLeafTask(
    "linkBarrier",
    "Link Barrier",
    {
      id: "link-barrier",
      name: "Link Barrier",
      kind: "barrier",
      cycles: 0,
      cacheBits: 0,
      ramBits: 0,
      parallel: true,
    },
    { parallelizable: true },
  ),
  rawCpuLeafTask("linkBinary", "Link Binary", {
    id: "link-binary",
    name: "Link Binary",
    kind: "compute",
    cycles: 120,
    cacheBits: 16,
    ramBits: 512,
  }),
  rawCpuLeafTask("writeArtifact", "Write Artifact", {
    id: "write-artifact",
    name: "Write Artifact",
    kind: "memory",
    memoryAction: "write",
    count: 8,
    cycles: 4,
    ramBits: 512,
  }),
  rawCpuLeafTask(
    "loadSceneTiles",
    "Load Scene Tiles",
    {
      id: "load-scene",
      name: "Load Scene Tiles",
      kind: "memory",
      memoryAction: "read",
      count: 24,
      cycles: 6,
      ramBits: 512,
      parallel: true,
    },
    { parallelizable: true },
  ),
  rawCpuLeafTask(
    "shadeTiles",
    "Shade Tiles",
    {
      id: "shade-tiles",
      name: "Shade Tiles",
      kind: "compute",
      cycles: 220,
      cacheBits: 8,
      ramBits: 512,
      parallel: true,
      acceleratorClass: "render",
      acceleratorModelMemoryBits: 34_359_738_368,
      acceleratorBatchSize: 1,
      acceleratorMinimumComputeOperationsPerSecond: 3_000_000_000,
      acceleratorPreferredKind: "gpu",
    },
    { parallelizable: true },
  ),
  rawCpuLeafTask(
    "compositeBarrier",
    "Composite Barrier",
    {
      id: "composite-barrier",
      name: "Composite Barrier",
      kind: "barrier",
      cycles: 0,
      cacheBits: 0,
      ramBits: 0,
      parallel: true,
    },
    { parallelizable: true },
  ),
  rawCpuLeafTask("compositeFrame", "Composite Frame", {
    id: "composite-frame",
    name: "Composite Frame",
    kind: "compute",
    cycles: 180,
    cacheBits: 16,
    ramBits: 1024,
  }),
  rawCpuLeafTask("writeFrameBuffer", "Write Frame Buffer", {
    id: "write-frame",
    name: "Write Frame Buffer",
    kind: "memory",
    memoryAction: "write",
    count: 16,
    cycles: 5,
    ramBits: 1024,
  }),
  rawCpuLeafTask(
    "stageTestFixtures",
    "Stage Test Fixtures",
    {
      id: "stage-fixtures",
      name: "Stage Test Fixtures",
      kind: "memory",
      memoryAction: "read",
      count: 32,
      cycles: 4,
      ramBits: 512,
      parallel: true,
    },
    { parallelizable: true },
  ),
  rawCpuLeafTask(
    "runRegressionCases",
    "Run Cases",
    {
      id: "run-cases",
      name: "Run Cases",
      kind: "compute",
      cycles: 200,
      cacheBits: 8,
      ramBits: 512,
      parallel: true,
    },
    { parallelizable: true },
  ),
  rawCpuLeafTask(
    "compareResults",
    "Compare Results",
    {
      id: "compare-results",
      name: "Compare Results",
      kind: "compute",
      cycles: 140,
      cacheBits: 8,
      ramBits: 512,
      parallel: true,
    },
    { parallelizable: true },
  ),
  rawCpuLeafTask(
    "reportBarrier",
    "Report Barrier",
    {
      id: "report-barrier",
      name: "Report Barrier",
      kind: "barrier",
      cycles: 0,
      cacheBits: 0,
      ramBits: 0,
      parallel: true,
    },
    { parallelizable: true },
  ),
  rawCpuLeafTask("summarizeReport", "Summarize Report", {
    id: "summarize-report",
    name: "Summarize Report",
    kind: "compute",
    cycles: 160,
    cacheBits: 16,
    ramBits: 1024,
  }),
  rawCpuLeafTask("writeReport", "Write Report", {
    id: "write-report",
    name: "Write Report",
    kind: "memory",
    memoryAction: "write",
    count: 16,
    cycles: 5,
    ramBits: 1024,
  }),
  rawCpuLeafTask("loadInferenceModel", "Load Inference Model", {
    id: "load-inference-model",
    name: "Load Inference Model",
    kind: "memory",
    memoryAction: "read",
    count: 16,
    cycles: 8,
    ramBits: 2048,
  }),
  rawCpuLeafTask(
    "runInferenceBatch",
    "Run Inference Batch",
    {
      id: "run-inference-batch",
      name: "Run Inference Batch",
      kind: "compute",
      cycles: 480,
      cacheBits: 16,
      ramBits: 2048,
      parallel: true,
      acceleratorClass: "inference",
      acceleratorModelMemoryBits: 17_179_869_184,
      acceleratorBatchSize: 16,
      acceleratorMinimumComputeOperationsPerSecond: 6_000_000_000,
      acceleratorPreferredKind: "npu",
    },
    { parallelizable: true },
  ),
  rawCpuLeafTask("writeInferenceResults", "Write Inference Results", {
    id: "write-inference-results",
    name: "Write Inference Results",
    kind: "memory",
    memoryAction: "write",
    count: 16,
    cycles: 6,
    ramBits: 2048,
  }),
  rawCpuLeafTask(
    "scatterShards",
    "Scatter Shards",
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
    { parallelizable: true, minCores: 4, maxCores: 4 },
  ),
  rawCpuLeafTask(
    "decodeShards",
    "Decode Shards",
    {
      id: "decode-shards",
      name: "Decode Shards",
      kind: "compute",
      cycles: 48,
      cacheBits: 2,
      ramBits: 0,
      parallel: true,
    },
    { parallelizable: true, minCores: 4, maxCores: 4 },
  ),
  rawCpuLeafTask(
    "hashShards",
    "Hash Shards",
    {
      id: "hash-shards",
      name: "Hash Shards",
      kind: "compute",
      cycles: 120,
      cacheBits: 2,
      ramBits: 0,
      parallel: true,
    },
    { parallelizable: true, minCores: 4, maxCores: 4 },
  ),
  rawCpuLeafTask("commitBenchmarkResult", "Commit Result", {
    id: "commit-result",
    name: "Commit Result",
    kind: "compute",
    cycles: 60,
    cacheBits: 4,
    ramBits: 0,
  }),
  {
    id: "tinyChecksum",
    name: "Tiny Checksum",
    kind: "task",
    category: "system",
    // First-completion Data moved to the pre-Scheduler RAM page jobs: this
    // system task is unreachable until System Scheduler research, so its Data
    // cannot fund that research (C-DES-3).
    rewardData: 0,
    parallelizable: false,
    repeatable: true,
    minCores: 1,
    reveal: (state) =>
      hasResearch(state, "ramControl") && hasCompleted(state, "packetCheck"),
    requirement: (state) =>
      hasResearch(state, "ramControl") && countTask(state, "packetCheck") >= 1,
    composition: [compose("stageChecksumPage"), compose("checksumStep")],
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
    composition: [compose("scanRamPage"), compose("repairRamDrift")],
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
    composition: [compose("readQueueTable"), compose("compactQueueEntries")],
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
    composition: [compose("samplePowerRails"), compose("normalizeDrawTrace")],
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
    composition: [compose("readBusWindow"), compose("mirrorBusState")],
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
    reveal: (state) =>
      hasResearch(state, systemCatalogResearchId) &&
      hasCompleted(state, compileCodeTaskId),
    requirement: (state) =>
      hasResearch(state, systemCatalogResearchId) &&
      hasCompleted(state, compileCodeTaskId),
    composition: [compose("sampleThermalSensors"), compose("fitHeatCurve")],
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
    composition: [
      compose("loadShards"),
      compose("reconcileShards"),
      compose("mergeShardBarrier"),
      compose("commitShards"),
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
    id: compileCodeTaskId,
    name: "Compile Code",
    kind: "task",
    category: "system",
    rewardData: 12,
    aggregateBatch: {
      workUnitMultiplier: 64,
      maximumMultiplier: 1_000_000_000,
    },
    parallelizable: true,
    repeatable: true,
    coreScaling: "chunked",
    workUnitCount: 2,
    workUnitName: "compile unit",
    minCores: 1,
    reveal: (state) => hasResearch(state, systemCatalogResearchId),
    requirement: (state) => hasResearch(state, systemCatalogResearchId),
    composition: [
      compose("stageSourceTree", 1, "perWorkUnit"),
      compose("compileUnits", 1, "perWorkUnit"),
      compose("linkBarrier"),
      compose("linkBinary"),
      compose("writeArtifact"),
    ],
    recipe: [
      {
        id: "stage",
        name: "Stage source tree",
        operationIds: ["stage-source"],
      },
      {
        id: "compile",
        name: "Compile code units",
        operationIds: ["compile-units"],
      },
      {
        id: "sync",
        name: "Synchronize compiled units",
        operationIds: ["link-barrier"],
      },
      {
        id: "link",
        name: "Link binary",
        operationIds: ["link-binary"],
      },
      {
        id: "write",
        name: "Write build artifact",
        operationIds: ["write-artifact"],
      },
    ],
  },
  {
    id: renderFrameTaskId,
    name: "Render Frame",
    kind: "task",
    category: "system",
    rewardData: 18,
    aggregateBatch: {
      workUnitMultiplier: 96,
      maximumMultiplier: 1_000_000_000,
    },
    parallelizable: true,
    repeatable: true,
    coreScaling: "chunked",
    workUnitCount: 3,
    workUnitName: "render tile",
    minCores: 1,
    reveal: (state) =>
      hasResearch(state, systemCatalogResearchId) && hasCompleted(state, compileCodeTaskId),
    requirement: (state) =>
      hasResearch(state, systemCatalogResearchId) && hasCompleted(state, compileCodeTaskId),
    composition: [
      compose("loadSceneTiles", 1, "perWorkUnit"),
      compose("shadeTiles", 1, "perWorkUnit"),
      compose("compositeBarrier"),
      compose("compositeFrame"),
      compose("writeFrameBuffer"),
    ],
    recipe: [
      {
        id: "load",
        name: "Load scene tiles",
        operationIds: ["load-scene"],
      },
      {
        id: "shade",
        name: "Shade tiles",
        operationIds: ["shade-tiles"],
      },
      {
        id: "sync",
        name: "Synchronize rendered tiles",
        operationIds: ["composite-barrier"],
      },
      {
        id: "composite",
        name: "Composite frame",
        operationIds: ["composite-frame"],
      },
      {
        id: "write",
        name: "Write frame buffer",
        operationIds: ["write-frame"],
      },
    ],
  },
  {
    id: inferenceBatchTaskId,
    name: "Inference Batch",
    kind: "task",
    category: "system",
    rewardData: 30,
    aggregateBatch: {
      workUnitMultiplier: 64,
      maximumMultiplier: 1_000_000_000,
    },
    parallelizable: true,
    repeatable: true,
    coreScaling: "chunked",
    workUnitCount: 2,
    workUnitName: "inference shard",
    minCores: 1,
    reveal: (state) => hasResearch(state, "specializedCompute"),
    requirement: (state) => hasResearch(state, "specializedCompute"),
    composition: [
      compose("loadInferenceModel"),
      compose("runInferenceBatch", 1, "perWorkUnit"),
      compose("writeInferenceResults"),
    ],
    recipe: [
      {
        id: "load",
        name: "Load inference model",
        operationIds: ["load-inference-model"],
      },
      {
        id: "infer",
        name: "Run inference shards",
        operationIds: ["run-inference-batch"],
      },
      {
        id: "write",
        name: "Write inference results",
        operationIds: ["write-inference-results"],
      },
    ],
  },
  {
    id: regressionTestTaskId,
    name: "Regression Test",
    kind: "task",
    category: "system",
    rewardData: 24,
    aggregateBatch: {
      workUnitMultiplier: 96,
      maximumMultiplier: 1_000_000_000,
    },
    parallelizable: true,
    repeatable: true,
    coreScaling: "chunked",
    workUnitCount: 4,
    workUnitName: "test case",
    minCores: 1,
    reveal: (state) =>
      hasResearch(state, systemCatalogResearchId) &&
      hasCompleted(state, renderFrameTaskId),
    requirement: (state) =>
      hasResearch(state, systemCatalogResearchId) &&
      hasCompleted(state, renderFrameTaskId),
    composition: [
      compose("stageTestFixtures", 1, "perWorkUnit"),
      compose("runRegressionCases", 1, "perWorkUnit"),
      compose("compareResults", 1, "perWorkUnit"),
      compose("reportBarrier"),
      compose("summarizeReport"),
      compose("writeReport"),
    ],
    recipe: [
      {
        id: "stage",
        name: "Stage test fixtures",
        operationIds: ["stage-fixtures"],
      },
      {
        id: "run",
        name: "Run regression cases",
        operationIds: ["run-cases"],
      },
      {
        id: "compare",
        name: "Compare test results",
        operationIds: ["compare-results"],
      },
      {
        id: "sync",
        name: "Synchronize reports",
        operationIds: ["report-barrier"],
      },
      {
        id: "summarize",
        name: "Summarize report",
        operationIds: ["summarize-report"],
      },
      {
        id: "write",
        name: "Write report",
        operationIds: ["write-report"],
      },
    ],
  },
  {
    id: "microBenchmark",
    name: "Micro Benchmark",
    kind: "benchmark",
    category: "cpu",
    rewardData: 12,
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
    rewardData: 16,
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
    composition: [
      compose("scatterShards"),
      compose("decodeShards"),
      compose("hashShards"),
      compose("mergeShardBarrier"),
      compose("commitBenchmarkResult"),
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
  {
    id: "workstationBenchmark",
    name: "Workstation Benchmark",
    kind: "task",
    category: "cpu",
    rewardData: 80,
    parallelizable: false,
    repeatable: false,
    minCores: 1,
    reveal: (state) => hasResearch(state, "specializedCompute"),
    requirement: (state) =>
      hasResearch(state, "specializedCompute") &&
      hasSpecializationEvidence(state) &&
      !hasCompleted(state, "workstationBenchmark"),
    operations: [
      {
        id: "verify-specialized-throughput",
        name: "Verify Specialized Throughput",
        kind: "compute",
        cycles: 600,
        cacheBits: 32,
        ramBits: 0,
      },
    ],
    recipe: [
      {
        id: "verify",
        name: "Verify specialized throughput",
        operationIds: ["verify-specialized-throughput"],
      },
    ],
  },
  rawCpuLeafTask(
    "liveQueueTriage",
    "Queue Triage",
    {
      id: "triage-live-queue",
      name: "Triage Live Queue",
      kind: "compute",
      cycles: 1,
      ramBits: 0,
    },
  ),
  rawCpuLeafTask(
    "liveCanaryValidation",
    "Canary Validation",
    {
      id: "validate-live-canary",
      name: "Validate Live Canary",
      kind: "compute",
      cycles: 1,
      ramBits: 0,
    },
  ),
];

const rawTaskById = new Map(rawTasks.map((task) => [task.id, task]));
const definitionCache = new Map<TaskId, TaskDefinition>();

const getTaskComposition = (task: RawTask): TaskCompositionDefinition[] =>
  (task.composition ?? []).map((entry) => ({
    taskId: entry.taskId,
    count: Math.max(1, entry.count ?? 1),
    mode: entry.mode ?? "single",
  }));

const getTaskOperations = (
  task: RawTask,
  composition: TaskCompositionDefinition[],
): TaskOperationDefinition[] => {
  if (composition.length === 0) {
    return (task.operations ?? []).map((operation) => op(task.id, operation));
  }

  if (task.category === "cpu") {
    throw new Error(`CPU task ${task.id} cannot be composed from other tasks`);
  }

  return composition.flatMap((entry) => {
    const child = buildTaskDefinition(entry.taskId);
    if (child.category !== "cpu") {
      throw new Error(`Composed task ${task.id} can only use CPU child ${entry.taskId}`);
    }

    return child.operations.map((operation) =>
      cloneComposedOperation(task.id, child, operation, entry.count),
    );
  });
};

/**
 * The single source task whose operations make up a step, or null when the
 * step mixes sources (or has none). Leaf operations carry their own task id,
 * composed operations carry the composition child's id.
 */
const getStepResidencySource = (
  operations: TaskOperationDefinition[],
): TaskId | null => {
  const sourceIds = new Set(
    operations.map((operation) => operation.sourceTaskId ?? null),
  );
  const [only] = sourceIds;
  return sourceIds.size === 1 ? (only ?? null) : null;
};

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
  parallelCoreCount: number,
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
  let ramStates = createCoreRamStates(parallelCoreCount);
  let previousResidencySource: TaskId | null = null;

  for (const [index, step] of recipe.entries()) {
    const recipeNode = recipeNodeByStepId.get(step.id);
    if (!recipeNode) {
      throw new Error(`Missing recipe node ${taskId}:recipe:${step.id}`);
    }

    // Runtime executes each composition child as a fresh ActiveTask with
    // empty ramBlocks, so RAM residency never survives a child boundary.
    // Reset the derivation's residency whenever a step's operations come
    // from a different source task so paid work units equal the work the
    // hardware physically executes (C-SIM-1 / F-ECO-2).
    const residencySource = getStepResidencySource(recipeNode.operations);
    if (
      index > 0 &&
      (residencySource === null || residencySource !== previousResidencySource)
    ) {
      ramStates = createCoreRamStates(parallelCoreCount);
    }
    previousResidencySource = residencySource;

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

    const cacheLoadWork = getOperationsCacheLoadWork(
      recipeNode.operations,
      parallelCoreCount,
    );

    if (cacheLoadWork > 0) {
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
          operationCount: cacheLoadWork,
          cycles: 0,
          cacheBits: recipeNode.cacheBits,
          ramBits: 0,
        }),
      );
      dependencyIds = [id];
    }

    const ramRuntime = summarizeRamRuntime(
      recipeNode.operations,
      parallelCoreCount,
      ramStates,
    );
    ramStates = ramRuntime.coreStates;

    if (ramRuntime.loadWork > 0) {
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
          operationCount: ramRuntime.loadWork,
          cycles: 0,
          cacheBits: 0,
          ramBits: recipeNode.ramBits,
        }),
      );
      dependencyIds = [id];
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

const getDagNodeStepId = (taskId: TaskId, node: TaskSubtaskDefinition) => {
  for (const kind of ["cache", "ram", "execute"] as const) {
    const prefix = `${taskId}:${kind}:`;
    if (node.id.startsWith(prefix)) return node.id.slice(prefix.length);
  }

  return null;
};

const applyDagOperationCountsToRecipeNodes = (
  taskId: TaskId,
  recipeNodes: TaskSubtaskDefinition[],
  dagNodes: TaskSubtaskDefinition[],
) =>
  recipeNodes.map((node) => {
    const recipeStepId = getRecipeStepId(taskId, node.id);
    const relatedDagNodes = dagNodes.filter(
      (candidate) => getDagNodeStepId(taskId, candidate) === recipeStepId,
    );
    const operationCount = relatedDagNodes
      .reduce((total, candidate) => total + candidate.operationCount, 0);

    return relatedDagNodes.length > 0 ? { ...node, operationCount } : node;
  });

const getRecipeNodeCompositionEntry = (
  composition: TaskCompositionDefinition[],
  node: TaskSubtaskDefinition,
) =>
  node.sourceTaskId
    ? composition.find((entry) => entry.taskId === node.sourceTaskId)
    : undefined;

const getRecipeNodeWorkScale = (
  coreScaling: TaskCoreScaling,
  workUnitCount: number,
  composition: TaskCompositionDefinition[],
  node: TaskSubtaskDefinition,
) => {
  if (coreScaling !== "chunked") return 1;
  return getRecipeNodeCompositionEntry(composition, node)?.mode === "perWorkUnit"
    ? workUnitCount
    : 1;
};

const getScaledOperationCount = (
  coreScaling: TaskCoreScaling,
  workUnitCount: number,
  composition: TaskCompositionDefinition[],
  nodes: TaskSubtaskDefinition[],
  parallelCoreCount: number,
) =>
  nodes.reduce(
    (total, node) =>
      total +
      getOperationsInvocationCount(node.operations, parallelCoreCount) *
        getRecipeNodeWorkScale(coreScaling, workUnitCount, composition, node),
    0,
  );

/**
 * Paid work mirrors runtime composition. CPU issue and cache transfer overlap
 * for memory operations, so their shared slice counts once; sequential
 * cache/CPU/RAM stages add normally.
 */
const getScaledPaidWorkUnits = (
  coreScaling: TaskCoreScaling,
  workUnitCount: number,
  composition: TaskCompositionDefinition[],
  nodes: TaskSubtaskDefinition[],
  parallelCoreCount: number,
) =>
  nodes.reduce(
    (total, node) =>
      total +
      (node.operationCount -
        getMemoryIssueOverlapWork(node.operations, parallelCoreCount)) *
        getRecipeNodeWorkScale(coreScaling, workUnitCount, composition, node),
    0,
  );

const getScaledRequiredCycles = (
  coreScaling: TaskCoreScaling,
  workUnitCount: number,
  composition: TaskCompositionDefinition[],
  nodes: TaskSubtaskDefinition[],
) =>
  nodes.reduce(
    (total, node) =>
      total +
      node.cycles *
        getRecipeNodeWorkScale(coreScaling, workUnitCount, composition, node),
    0,
  );

const getPerWorkUnitOperationCount = (
  coreScaling: TaskCoreScaling,
  composition: TaskCompositionDefinition[],
  nodes: TaskSubtaskDefinition[],
  parallelCoreCount: number,
) => {
  if (coreScaling !== "chunked") {
    return nodes.reduce(
      (total, node) =>
        total + getOperationsInvocationCount(node.operations, parallelCoreCount),
      0,
    );
  }

  return nodes
    .filter(
      (node) => getRecipeNodeCompositionEntry(composition, node)?.mode === "perWorkUnit",
    )
    .reduce(
      (total, node) =>
        total + getOperationsInvocationCount(node.operations, parallelCoreCount),
      0,
    );
};

const getPerWorkUnitCycles = (
  coreScaling: TaskCoreScaling,
  composition: TaskCompositionDefinition[],
  nodes: TaskSubtaskDefinition[],
) => {
  if (coreScaling !== "chunked") {
    return nodes.reduce((total, node) => total + node.cycles, 0);
  }

  return nodes
    .filter(
      (node) => getRecipeNodeCompositionEntry(composition, node)?.mode === "perWorkUnit",
    )
    .reduce((total, node) => total + node.cycles, 0);
};

const buildTaskDefinition = (id: TaskId): TaskDefinition => {
  const cached = definitionCache.get(id);
  if (cached) return cached;

  const raw = rawTaskById.get(id);
  if (!raw) {
    throw new Error(`Unknown task: ${id}`);
  }

  const composition = getTaskComposition(raw);
  const operations = getTaskOperations(raw, composition);
  const parallelCoreCount = raw.maxCores ?? raw.minCores;
  const coreScaling = raw.coreScaling ?? "fixed";
  const workUnitCount =
    coreScaling === "chunked" ? Math.max(1, raw.workUnitCount ?? 1) : 1;
  const workUnitName = raw.workUnitName ?? "chunk";
  const summaryCoreCount = coreScaling === "chunked" ? 1 : parallelCoreCount;
  const recipeNodes = deriveRecipeNodes(
    raw.id,
    raw.recipe,
    operations,
    summaryCoreCount,
  );
  const dagNodes = deriveDagNodes(raw.id, raw.recipe, recipeNodes, summaryCoreCount);
  const subtasks = applyDagOperationCountsToRecipeNodes(
    raw.id,
    recipeNodes,
    dagNodes,
  );
  const summary = summarizeGraphNodes(dagNodes, summaryCoreCount);
  const operationCount = getScaledOperationCount(
    coreScaling,
    workUnitCount,
    composition,
    subtasks,
    summaryCoreCount,
  );
  const requiredCycles = getScaledRequiredCycles(
    coreScaling,
    workUnitCount,
    composition,
    subtasks,
  );
  const paidWorkUnits = getScaledPaidWorkUnits(
    coreScaling,
    workUnitCount,
    composition,
    subtasks,
    summaryCoreCount,
  );
  const operationCountExact = amount(operationCount);
  const paidWorkUnitsExact = amount(paidWorkUnits);
  const requiredCyclesExact = amount(requiredCycles);
  const workUnitOperationCount = getPerWorkUnitOperationCount(
    coreScaling,
    composition,
    subtasks,
    summaryCoreCount,
  );
  const workUnitCycles = getPerWorkUnitCycles(coreScaling, composition, subtasks);
  // Public job payout is one Credit per runtime-aligned paid work unit.
  const rewardCreditsExact = paidWorkUnitsExact;
  const rewardDataExact = amount(raw.rewardData);
  const definition: TaskDefinition = {
    id: raw.id,
    name: raw.name,
    kind: raw.kind,
    category: raw.category,
    visibility: raw.visibility ?? "default",
    composition,
    rewardData: amountToSafeNumber(rewardDataExact),
    rewardDataExact,
    firstCompletionData: amountToSafeNumber(rewardDataExact),
    firstCompletionDataExact: rewardDataExact,
    repeatRewardData: 0,
    repeatRewardDataExact: amount(0),
    parallelizable: raw.parallelizable,
    repeatable: raw.repeatable,
    coreScaling,
    workUnitCount,
    workUnitName,
    workUnitOperationCount,
    workUnitOperationCountExact: amount(workUnitOperationCount),
    workUnitCycles,
    workUnitCyclesExact: amount(workUnitCycles),
    workUnitCacheNeedBits: summary.cacheBits,
    workUnitRamNeedBits: summary.ramBits,
    minCores: raw.minCores,
    maxCores: raw.maxCores,
    reveal: raw.reveal,
    requirement: raw.requirement,
    subtasks,
    operations,
    operationCount,
    operationCountExact,
    paidWorkUnits,
    paidWorkUnitsExact,
    rewardCredits: amountToSafeNumber(rewardCreditsExact),
    rewardCreditsExact,
    aggregateBatch: raw.aggregateBatch ?? null,
    requiredCycles,
    requiredCyclesExact,
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
