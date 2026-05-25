import { hasResearch, researchDefinitions } from "./content/research";
import { getGlobalCStateLevel } from "./cState";
import {
  CPU_TIER_MAX_LEVEL,
  getCStateIdleMultiplier,
  getCpuTierDefinition,
  getCpuTierLevelDefinition,
} from "./content/cpuTiers";
import { getRamStickEfficiency, MEMORY_VOLTAGE_MAX_LEVEL } from "./content/ramTuning";
import { getRamTierLevelDefinition } from "./content/ramTiers";
import {
  componentSkus,
  getMachineSelectionCost,
  machineTemplates,
} from "./content/machines";
import { getTaskDefinition, taskDefinitions } from "./content/tasks";
import {
  getUpgradeCount,
  getUpgradeDefinition,
  getUpgradeDowngradeBlockedReason,
  getUpgradeRefund,
} from "./content/upgrades";
import { canAfford } from "./economy";
import {
  DEADLOCK_FAILURE_SECONDS,
  POWER_OVERLOAD_FAILURE_SECONDS,
  estimateJobSeconds,
  getActiveRamWriteBandwidthBps,
  getActiveRamWriteBlockKeys,
  getAvailableSchedulerSlots,
  getAvailableSystemSchedulerSlots,
  getCacheLoadCycles,
  getDeadlockCooldownRate,
  getHardwareCacheBits,
  getMemoryCapacityBits,
  getCoolingReliabilityBonus,
  getBilledPowerWatts,
  getCpuMatchEfficiency,
  getHardwareDrawWatts,
  getPowerCostPerSecond,
  getPowerEfficiency,
  getPowerOverloadRate,
  getPsuCapacityWatts,
  getPsuStress,
  getRamChannelBlockedReason,
  getRamChannelCount,
  getRamLoadCycles,
  getRamMatchEfficiency,
  getRamWriteBlockKey,
  getReservedMemoryBits,
  getPowerReliability,
  getSchedulerQueuedCount,
  getSchedulerSlotCapacity,
  getSystemSchedulerSlotCapacity,
} from "./math";
import { bitsToBytes } from "./progression";
import {
  getCoreClockHz,
  getCoreClockLevel,
  getEffectiveCpuEfficiency,
  getCpuHardware,
  getCpuIdForCore,
  getCacheBits,
  getClockHz,
  getPsuWatts,
  getRamBits,
  getRamSpeedMt,
  getMilestone,
  getStage,
  getStageLabel,
  syncCoreSchedulers,
  getUnlockedCpuTierDefinitions,
  getUnlockedRamTierDefinitions,
  getMaxUnlockedRamLevel,
} from "./progression";
import { ensureSystems, materializeSystem, syncSelectedSystemRuntime } from "./systems";
import {
  getAvailableTasks,
  getAvailableUpgrades,
  getCronMinIntervalSeconds,
  getSchedulerWatchdogPreview,
  getVisibleRemainingSeconds,
} from "./simulation";
import type {
  ActiveCoreOperation,
  CacheResidencySegment,
  GameState,
  MemoryRuntimeState,
  OperationRuntimeStatus,
  RamResidencySegment,
  TaskDefinition,
  TaskOperationDefinition,
  UpgradeContext,
  VisibleActiveJob,
  VisibleActiveTask,
  VisibleCoreTaskProgress,
  VisibleCpuSocket,
  VisibleJob,
  VisibleOperation,
  VisibleRamInstallOption,
  VisibleRamSlot,
  VisibleResearchComputeTask,
  VisibleState,
  VisibleDeadlockSummary,
  VisibleTask,
  VisibleTaskSubtask,
  VisibleUpgrade,
} from "./types";

const getCacheFit = (
  state: GameState,
  task: TaskDefinition,
): "bonus" | "met" | "low" => {
  if (task.cacheNeedBits <= 0) return "met";
  if (getHardwareCacheBits(state) > task.cacheNeedBits) return "bonus";
  if (getHardwareCacheBits(state) === task.cacheNeedBits) return "met";
  return "low";
};

const getBusyCoreIds = (state: GameState) =>
  new Set(state.activeTasks.flatMap((task) => task.assignedCoreIds));

const taskFitsCpuHardware = (
  state: GameState,
  task: TaskDefinition,
  cpuId: number,
) =>
  task.cacheNeedBits <= getCpuHardware(state, cpuId).cacheBits &&
  task.ramNeedBits <= getMemoryCapacityBits(state);

const getMaxIdleCoresInCpu = (state: GameState) => {
  const busyCoreIds = getBusyCoreIds(state);
  return Math.max(
    0,
    ...state.hardware.cpus.map(
      (cpu) => cpu.coreIds.filter((coreId) => !busyCoreIds.has(coreId)).length,
    ),
  );
};

const getIdleCoreCountInSystem = (state: GameState, task?: TaskDefinition) => {
  const busyCoreIds = getBusyCoreIds(state);
  return state.hardware.cpus.reduce(
    (total, cpu) =>
      total +
      getCpuHardware(state, cpu.id).coreIds.filter(
        (coreId) =>
          !busyCoreIds.has(coreId) &&
          (task === undefined || taskFitsCpuHardware(state, task, cpu.id)),
      ).length,
    0,
  );
};

const getCoreCountInSystem = (state: GameState, task?: TaskDefinition) =>
  state.hardware.cpus.reduce(
    (total, cpu) =>
      total +
      (task === undefined || taskFitsCpuHardware(state, task, cpu.id)
        ? getCpuHardware(state, cpu.id).coreIds.length
        : 0),
    0,
  );

const getCpuSchedulerWidthInSystem = (state: GameState) =>
  state.hardware.cpus.reduce(
    (total, cpu) => total + getCpuHardware(state, cpu.id).schedulerSlots,
    0,
  );

const isSystemScheduledTask = (task: TaskDefinition) =>
  task.category === "system" || task.category === "distributed";

const isChunkedSystemTask = (task: TaskDefinition) =>
  task.coreScaling === "chunked" && isSystemScheduledTask(task);

const getMaxIdleCoresForTask = (state: GameState, task: TaskDefinition) =>
  isChunkedSystemTask(task)
    ? getIdleCoreCountInSystem(state, task)
    : getMaxIdleCoresInCpu(state);

const getMaxSchedulerWidthForTask = (
  state: GameState,
  task: TaskDefinition,
  requireIdleCores: boolean,
) => {
  if (isChunkedSystemTask(task)) {
    const availableCores = requireIdleCores
      ? getIdleCoreCountInSystem(state, task)
      : getCoreCountInSystem(state, task);

    return availableCores >= task.minCores ? getCpuSchedulerWidthInSystem(state) : 0;
  }

  const busyCoreIds = getBusyCoreIds(state);
  return Math.max(
    0,
    ...state.hardware.cpus.map((cpu) => {
      const availableCores = requireIdleCores
        ? cpu.coreIds.filter((coreId) => !busyCoreIds.has(coreId)).length
        : cpu.coreIds.length;
      if (availableCores < task.minCores) return 0;
      return getCpuHardware(state, cpu.id).schedulerSlots;
    }),
  );
};

const isTaskComplete = (state: GameState, task: TaskDefinition) =>
  (state.completedTasks[task.id] ?? state.completedJobs[task.id] ?? 0) > 0 ||
  state.completedBenchmarks.includes(task.id);

const taskMeetsRequirements = (state: GameState, task: TaskDefinition) => {
  const benchmarkDone = task.kind === "benchmark" && isTaskComplete(state, task);

  return task.requirement(state) && !benchmarkDone;
};

const isTaskRevealed = (state: GameState, task: TaskDefinition) =>
  task.reveal(state) || task.requirement(state);

const isPlayerFacingTask = (task: TaskDefinition) => task.kind !== "benchmark";

const isDefaultVisibleTask = (task: TaskDefinition) =>
  task.visibility !== "internal";

const taskFitsHardware = (state: GameState, task: TaskDefinition) =>
  task.cacheNeedBits <= getHardwareCacheBits(state) &&
  task.ramNeedBits <= getMemoryCapacityBits(state);

const canAcceptTask = (state: GameState, task: TaskDefinition) =>
  taskMeetsRequirements(state, task) && taskFitsHardware(state, task);

const getBlockedReason = (state: GameState, task: TaskDefinition) => {
  const acceptable = canAcceptTask(state, task);
  if (!acceptable) {
    if (isTaskComplete(state, task) && task.kind === "benchmark") {
      return "Benchmark complete.";
    }
    if (task.cacheNeedBits > getHardwareCacheBits(state)) return "Cache capacity too low.";
    if (task.ramNeedBits > getMemoryCapacityBits(state)) return "RAM capacity too low.";
    if (task.id === "microBenchmark") {
      if (!hasResearch(state, "benchmarkHarness")) {
        return "Benchmark Harness research required.";
      }
      if (state.hardware.clockLevel < 3) return "Core clock level 3 required.";
      if (state.hardware.cacheLevel < 3) return "Cache capacity level 3 required.";
    }
    if (task.id === "parallelismBenchmark") {
      if (!hasResearch(state, "benchmarkHarness")) {
        return "Benchmark Harness research required.";
      }
      if (!isTaskComplete(state, getTaskDefinition("microBenchmark"))) {
        return "Micro Benchmark required.";
      }
    }
    if (task.id === "multiCoreBenchmark") {
      if (!hasResearch(state, "systemScheduler")) {
        return "System Scheduler research required.";
      }
      if (state.hardware.cores < 4) return "Needs 4 CPU cores.";
    }
    if (task.kind === "benchmark") return "Research benchmark prerequisite missing.";
    return "Research or prerequisite task missing.";
  }

  if (isSystemScheduledTask(task) && !state.flags.scheduler) {
    return "System scheduler required.";
  }

  if (state.power.state !== "on") {
    if (state.power.state === "off") return "System powered off.";
    return state.power.state === "booting" ? "System booting." : "System shutting down.";
  }

  if (
    state.deadlockProcessLockout ||
    state.activeTasks.some((activeTask) =>
      activeTask.coreOperations.some((operation) => operation.status === "deadlocked"),
    )
  ) {
    return state.deadlockProcessLockout
      ? "Deadlock lockout cooling down."
      : "Deadlock active.";
  }

  const idleCoreCount = getMaxIdleCoresForTask(state, task);
  if (idleCoreCount < task.minCores) {
    return task.minCores > 1
      ? `Needs ${task.minCores} idle cores.`
      : "No idle core available.";
  }

  if (task.minCores > 1 && !state.flags.scheduler) {
    return "System scheduler required.";
  }

  if (
    task.minCores > 1 &&
    getMaxSchedulerWidthForTask(state, task, true) < task.minCores
  ) {
    return `CPU scheduler needs ${task.minCores} slots.`;
  }

  return null;
};

const getTaskCanStart = (state: GameState, task: TaskDefinition) =>
  canAcceptTask(state, task) && getBlockedReason(state, task) === null;

const getTaskCanQueue = (state: GameState, task: TaskDefinition) =>
  getQueueBlockedReason(state, task) === null;

const getQueueBlockedReason = (state: GameState, task: TaskDefinition) => {
  if (!canAcceptTask(state, task)) return getBlockedReason(state, task);
  if (state.power.state !== "on") {
    if (state.power.state === "off") return "System powered off.";
    return state.power.state === "booting" ? "System booting." : "System shutting down.";
  }
  if (isSystemScheduledTask(task) && !state.flags.scheduler) {
    return "System scheduler required.";
  }
  if (!state.flags.basicQueue && !state.flags.scheduler) return "Scheduler locked.";

  if (isSystemScheduledTask(task)) {
    const availableSystemSlots = getAvailableSystemSchedulerSlots(state);
    if (availableSystemSlots <= 0) {
      return getSystemSchedulerSlotCapacity(state) <= 0
        ? "Buy system queue slots."
        : "System scheduler slots full.";
    }
    if (
      task.minCores > 1 &&
      getMaxSchedulerWidthForTask(state, task, false) < task.minCores
    ) {
      return `CPU scheduler needs ${task.minCores} slots.`;
    }

    return null;
  }

  if (
    task.minCores > 1 &&
    getMaxSchedulerWidthForTask(state, task, false) < task.minCores
  ) {
    return `CPU scheduler needs ${task.minCores} slots.`;
  }
  const availableSlots = getAvailableSchedulerSlots(state);
  if (availableSlots <= 0) {
    return getSchedulerSlotCapacity(state) <= 0
      ? "Buy scheduler slots."
      : "Scheduler slots full.";
  }

  return null;
};

const getVisibleOperation = (operation: TaskDefinition["operations"][number]): VisibleOperation => ({
  id: operation.id,
  name: operation.name,
  sourceTaskId: operation.sourceTaskId,
  sourceTaskName: operation.sourceTaskName,
  kind: operation.kind,
  memoryAction: operation.memoryAction,
  count: operation.count,
  cacheBits: operation.cacheBits,
  ramBits: operation.ramBits,
  cacheBytes: operation.cacheBytes,
  ramBytes: operation.ramBytes,
  parallel: operation.parallel,
});

const getVisibleTaskSubtask = (
  node: TaskDefinition["subtasks"][number] | TaskDefinition["dagNodes"][number],
): VisibleTaskSubtask => ({
  id: node.id,
  name: node.name,
  sourceTaskId: node.sourceTaskId,
  sourceTaskName: node.sourceTaskName,
  kind: node.kind,
  dependsOn: node.dependsOn,
  operationIds: node.operationIds,
  operations: node.operations.map(getVisibleOperation),
  operationCount: node.operationCount,
  subtasks: node.subtasks.map(getVisibleTaskSubtask),
  cycles: node.cycles,
  cacheBits: node.cacheBits,
  ramBits: node.ramBits,
  cacheBytes: node.cacheBytes,
  ramBytes: node.ramBytes,
});

const getVisibleQueue = (state: GameState) =>
  state.queueEntries && state.queueEntries.length === state.queue.length
    ? state.queueEntries
    : state.queue;

const getTaskVisible = (state: GameState, task: TaskDefinition): VisibleTask => ({
  id: task.id,
  name: task.name,
  kind: task.kind,
  category: task.category,
  visibility: task.visibility,
  composition: task.composition,
  rewardCredits: task.rewardCredits,
  rewardData: task.rewardData,
  cacheNeedBits: task.cacheNeedBits,
  ramNeedBits: task.ramNeedBits,
  cacheNeedBytes: task.cacheNeedBytes,
  ramNeedBytes: task.ramNeedBytes,
  operationCount: task.operationCount,
  operations: task.operations.map(getVisibleOperation),
  subtaskCount: task.subtasks.length,
  subtasks: task.subtasks.map(getVisibleTaskSubtask),
  dagNodes: task.dagNodes.map(getVisibleTaskSubtask),
  requiredCores: task.minCores,
  coreScaling: task.coreScaling,
  workUnitCount: task.workUnitCount,
  workUnitName: task.workUnitName,
  cacheFit: getCacheFit(state, task),
  canStart: getTaskCanStart(state, task),
  canQueue: getTaskCanQueue(state, task),
  blockedReason: getBlockedReason(state, task),
  queueBlockedReason: getQueueBlockedReason(state, task),
});

const getRamUsedBytes = (state: GameState) =>
  bitsToBytes(getReservedMemoryBits(state));

const getRamUsedBits = (state: GameState) => getReservedMemoryBits(state);

const combineStatus = (operations: ActiveCoreOperation[]): OperationRuntimeStatus => {
  const priority: OperationRuntimeStatus[] = [
    "deadlocked",
    "waitingMemory",
    "loadingRam",
    "loadingCache",
    "running",
    "waitingBarrier",
    "complete",
  ];

  return (
    priority.find((status) =>
      operations.some((operation) => operation.status === status),
    ) ?? "complete"
  );
};

const combineMemoryState = (
  operations: ActiveCoreOperation[],
): MemoryRuntimeState => {
  const priority: MemoryRuntimeState[] = [
    "deadlock",
    "waiting",
    "ramLoad",
    "cacheLoad",
    "ready",
    "idle",
  ];

  return (
    priority.find((state) =>
      operations.some((operation) => operation.memoryState === state),
    ) ?? "idle"
  );
};

const getRamDeadlockOperation = (state: GameState) =>
  state.activeTasks
    .flatMap((task) => task.coreOperations)
    .find(
      (operation) =>
        operation.status === "deadlocked" && operation.lockResource === "ram",
    ) ?? null;

const getCacheDeadlockOperationForCpu = (state: GameState, cpuId: number) =>
  state.activeTasks
    .flatMap((task) => task.coreOperations)
    .find(
      (operation) =>
        operation.status === "deadlocked" &&
        operation.lockResource === "cache" &&
        getCpuIdForCore(state, operation.coreId) === cpuId,
    ) ?? null;

const getTaskDeadlockScopeOperation = (
  state: GameState,
  activeTask: GameState["activeTasks"][number],
) => {
  const ramDeadlock = getRamDeadlockOperation(state);
  if (ramDeadlock) return ramDeadlock;

  return getCacheDeadlockOperationForCpu(
    state,
    getCpuIdForCore(state, activeTask.coreId),
  );
};

const clampProgress = (progress: number) => Math.min(1, Math.max(0, progress));

const isTaskOperationAssignedToCore = (
  activeTask: GameState["activeTasks"][number],
  operation: TaskOperationDefinition,
  coreId: number,
) => operation.parallel || operation.kind === "barrier" || coreId === activeTask.coreId;

const getCacheProgress = (
  remaining: number,
  total: number,
) => {
  if (total <= 0) return 1;
  return clampProgress(1 - remaining / total);
};

const isCacheLoadingRuntime = (runtime: ActiveCoreOperation) =>
  runtime.status === "loadingCache" ||
  (runtime.status === "deadlocked" && runtime.lockResource === "cache");

const isCurrentOperationCacheResident = (runtime: ActiveCoreOperation) =>
  [
    "loadingCache",
    "loadingRam",
    "running",
    "waitingBarrier",
    "deadlocked",
  ].includes(runtime.status);

const getRuntimeCacheWriteProgress = (
  state: GameState,
  operation: TaskOperationDefinition,
  runtime: ActiveCoreOperation,
  loaded: boolean,
) => {
  if (loaded || !isCacheLoadingRuntime(runtime)) return 1;
  return getCacheProgress(
    runtime.remainingLoadCycles,
    getCacheLoadCycles(state, operation),
  );
};

const getRuntimeCacheIssueProgress = (
  operation: TaskOperationDefinition,
  runtime: ActiveCoreOperation,
  loaded: boolean,
) => {
  if (loaded || !isCacheLoadingRuntime(runtime)) return 1;
  if (!operation.memoryAction) {
    return getCacheProgress(runtime.remainingLoadCycles, runtime.totalLoadCycles);
  }

  return getCacheProgress(runtime.remainingCycles, runtime.totalCycles);
};

const getRuntimeCacheState = (
  operation: TaskOperationDefinition,
  runtime: ActiveCoreOperation,
  readyBits: number,
  bufferBits: number,
): NonNullable<CacheResidencySegment["state"]> => {
  if (bufferBits > 0) return "buffering";
  if (isCacheLoadingRuntime(runtime) && !operation.memoryAction && readyBits <= 0) {
    return "loading";
  }
  return "loaded";
};

const getSegmentBits = (segments: CacheResidencySegment[]) =>
  segments.reduce((total, segment) => total + segment.bits, 0);

const scaleCacheSegment = (
  segment: CacheResidencySegment,
  sourceBits: number,
  targetBits: number,
): CacheResidencySegment => {
  const scale = sourceBits > 0 ? targetBits / sourceBits : 1;

  return {
    ...segment,
    bits: targetBits,
    readyBits:
      segment.readyBits === undefined ? undefined : segment.readyBits * scale,
    bufferBits:
      segment.bufferBits === undefined ? undefined : segment.bufferBits * scale,
    committedBits:
      segment.committedBits === undefined
        ? undefined
        : segment.committedBits * scale,
  };
};

const getSegmentCommittedBits = (segment: CacheResidencySegment) =>
  segment.committedBits ?? segment.readyBits ?? segment.bits;

const getSegmentReadyBits = (segment: CacheResidencySegment) =>
  segment.readyBits ?? segment.committedBits ?? segment.bits;

const mergeReusedCacheFootprint = (
  existing: CacheResidencySegment,
  update: CacheResidencySegment,
): CacheResidencySegment => {
  const committedBits = Math.max(
    getSegmentCommittedBits(existing),
    getSegmentCommittedBits(update),
  );
  const bufferBits = Math.min(update.bufferBits ?? 0, committedBits);
  const readyBits = Math.min(
    Math.max(0, committedBits - bufferBits),
    Math.max(getSegmentReadyBits(existing), update.readyBits ?? 0),
  );

  return {
    ...existing,
    ...update,
    state: bufferBits > 0 ? "buffering" : "loaded",
    readyBits,
    bufferBits,
    committedBits: readyBits + bufferBits,
  };
};

const overlayCacheSegment = (
  segments: CacheResidencySegment[],
  bits: number,
  update: Omit<CacheResidencySegment, "bits">,
) => {
  let remainingBits = bits;

  for (let index = segments.length - 1; index >= 0 && remainingBits > 0; index -= 1) {
    const segment = segments[index];
    if (!segment) continue;

    const overlaidBits = Math.min(segment.bits, remainingBits);
    const existingSegment = scaleCacheSegment(
      segment,
      segment.bits,
      overlaidBits,
    );
    const updateSegment = scaleCacheSegment(
      {
        ...update,
        bits,
      },
      bits,
      overlaidBits,
    );
    const overlaidSegment = mergeReusedCacheFootprint(
      existingSegment,
      updateSegment,
    );
    const retainedSegment = scaleCacheSegment(
      segment,
      segment.bits,
      segment.bits - overlaidBits,
    );

    if (overlaidBits < segment.bits) {
      segments.splice(
        index,
        1,
        retainedSegment,
        overlaidSegment,
      );
    } else {
      segments[index] = overlaidSegment;
    }

    remainingBits -= overlaidBits;
  }

  if (remainingBits > 0) {
    segments.push(
      scaleCacheSegment(
        {
          ...update,
          bits,
        },
        bits,
        remainingBits,
      ),
    );
  }
};

const applyCacheOperationSegment = (
  state: GameState,
  segments: CacheResidencySegment[],
  operation: TaskOperationDefinition,
  runtime: ActiveCoreOperation,
  loaded: boolean,
) => {
  if (operation.cacheBits <= 0) return;

  const progress = getRuntimeCacheWriteProgress(state, operation, runtime, loaded);
  const bufferProgress = getRuntimeCacheIssueProgress(operation, runtime, loaded);
  const readyProgress = Math.min(progress, bufferProgress);
  const readyBits = operation.cacheBits * readyProgress;
  const bufferBits = operation.cacheBits * Math.max(0, bufferProgress - readyProgress);
  const committedBits = readyBits + bufferBits;
  const segmentState = getRuntimeCacheState(
    operation,
    runtime,
    readyBits,
    bufferBits,
  );
  const segmentBase = {
    coreId: runtime.coreId,
    memoryAction: operation.memoryAction,
    operationId: operation.id,
    state: segmentState,
    progress,
    bufferProgress,
    readyBits,
    bufferBits,
    committedBits,
  };

  if (operation.kind !== "memory") {
    const missingBits = operation.cacheBits - getSegmentBits(segments);

    if (missingBits > 0) {
      segments.push(
        scaleCacheSegment(
          {
            ...segmentBase,
            bits: operation.cacheBits,
          },
          operation.cacheBits,
          missingBits,
        ),
      );
    } else if (!loaded) {
      overlayCacheSegment(segments, operation.cacheBits, segmentBase);
    }
    return;
  }

  if (operation.memoryAction === "overwrite") {
    overlayCacheSegment(segments, operation.cacheBits, segmentBase);
    return;
  }

  segments.push({
    ...segmentBase,
    bits: operation.cacheBits,
  });
};

const getCacheResidencySegments = (state: GameState): CacheResidencySegment[] =>
  state.activeTasks.flatMap((activeTask) => {
    const definition = getTaskDefinition(activeTask.taskId);

    return activeTask.coreOperations.flatMap((runtime) => {
      if (runtime.status === "complete") return [];

      const segments: CacheResidencySegment[] = [];

      for (
        let operationIndex = 0;
        operationIndex <= runtime.operationIndex;
        operationIndex += 1
      ) {
        const operation = definition.operations[operationIndex];
        if (!operation) continue;
        if (!isTaskOperationAssignedToCore(activeTask, operation, runtime.coreId)) {
          continue;
        }

        const loaded = operationIndex < runtime.operationIndex;
        if (!loaded && !isCurrentOperationCacheResident(runtime)) continue;

        applyCacheOperationSegment(state, segments, operation, runtime, loaded);
      }

      return segments;
    });
  });

const getCacheSegmentCommittedBits = (segment: CacheResidencySegment) =>
  segment.committedBits ?? segment.bits;

const getCacheUsedBits = (segments: CacheResidencySegment[]) =>
  segments.reduce((total, segment) => total + getCacheSegmentCommittedBits(segment), 0);

const getCacheUsedBytes = (segments: CacheResidencySegment[]) =>
  bitsToBytes(getCacheUsedBits(segments));

const getRamResidencySegments = (state: GameState): RamResidencySegment[] => {
  const activeWriteBlockKeys = getActiveRamWriteBlockKeys(state);

  return state.activeTasks.flatMap((activeTask) => {
    const definition = getTaskDefinition(activeTask.taskId);

    return activeTask.coreOperations.flatMap((runtime) => {
      if (
        runtime.status === "waitingMemory" ||
        (runtime.memoryReservedBits <= 0 && (runtime.ramBlocks ?? []).length === 0)
      ) {
        return [];
      }

      const operation = definition.operations[runtime.operationIndex];
      const ramLoadCycles = operation ? getRamLoadCycles(state, operation) : 0;
      if ((runtime.ramBlocks ?? []).length > 0) {
        const loading =
          runtime.status === "loadingRam" ||
          runtime.memoryState === "ramLoad" ||
          (runtime.status === "deadlocked" && runtime.lockResource === "ram");

        return runtime.ramBlocks.map((block) => {
          const progress = clampProgress(
            block.loadedBits / Math.max(block.lengthBits, 1),
          );
          const activelyWriting = activeWriteBlockKeys.has(
            getRamWriteBlockKey(runtime, block),
          );

          return {
            coreId: runtime.coreId,
            taskId: activeTask.taskId,
            operationId: runtime.operationId,
            stickId: block.stickId,
            startBit: block.startBit,
            bits: block.lengthBits,
            loadedBits: block.loadedBits,
            channelIndex: block.channelIndex,
            state:
              progress >= 1
                ? "loaded"
                : loading && activelyWriting
                  ? "loading"
                  : "reserved",
            progress,
          };
        });
      }

      const hasPendingRamLoad =
        runtime.status === "loadingCache" &&
        runtime.memoryState !== "ready" &&
        ramLoadCycles > 0;
      const loading =
        runtime.status === "loadingRam" || runtime.memoryState === "ramLoad";
      const progress = loading
        ? clampProgress(
            1 - runtime.remainingLoadCycles / Math.max(ramLoadCycles, 1),
          )
        : hasPendingRamLoad
          ? 0
          : 1;

      return [
        {
          coreId: runtime.coreId,
          taskId: activeTask.taskId,
          operationId: runtime.operationId,
          stickId: 1,
          startBit: 0,
          bits: runtime.memoryReservedBits,
          loadedBits: loading ? runtime.memoryReservedBits * progress : runtime.memoryReservedBits,
          channelIndex: 0,
          state: loading ? "loading" : hasPendingRamLoad ? "reserved" : "loaded",
          progress,
        },
      ];
    });
  });
};

const getTaskOperationLoadCycles = (
  state: GameState,
  operation: TaskOperationDefinition,
) => {
  const cacheLoadCycles = getCacheLoadCycles(state, operation);
  const ramLoadCycles = getRamLoadCycles(state, operation);

  if (operation.memoryAction) {
    return Math.max(0, cacheLoadCycles - operation.cycles) + ramLoadCycles;
  }

  return cacheLoadCycles + ramLoadCycles;
};

const getActiveOperationWork = (
  operation: TaskOperationDefinition,
  runtime: ActiveCoreOperation,
) => {
  if (operation.memoryAction && runtime.totalLoadCycles > 0) {
    return {
      total: Math.max(runtime.totalCycles, runtime.totalLoadCycles),
      remaining: Math.max(runtime.remainingCycles, runtime.remainingLoadCycles),
    };
  }

  return {
    total: runtime.totalCycles + runtime.totalLoadCycles,
    remaining: runtime.remainingCycles + runtime.remainingLoadCycles,
  };
};

const getTaskRuntimeProgress = (
  state: GameState,
  activeTask: GameState["activeTasks"][number],
  definition: TaskDefinition,
) => {
  const totals = activeTask.coreOperations.reduce(
    (taskTotals, coreOperation) => {
      const coreTotals = definition.operations.reduce(
        (operationTotals, operation, operationIndex) => {
          if (
            !isTaskOperationAssignedToCore(activeTask, operation, coreOperation.coreId)
          ) {
            return operationTotals;
          }

          const plannedWork =
            operation.cycles + getTaskOperationLoadCycles(state, operation);
          const activeWork =
            operationIndex === coreOperation.operationIndex
              ? Math.max(
                  plannedWork,
                  getActiveOperationWork(operation, coreOperation).total,
                )
              : plannedWork;
          let completed = 0;

          if (
            coreOperation.status === "complete" ||
            operationIndex < coreOperation.operationIndex
          ) {
            completed = activeWork;
          } else if (operationIndex === coreOperation.operationIndex) {
            const remaining = getActiveOperationWork(
              operation,
              coreOperation,
            ).remaining;
            completed = clampProgress(1 - remaining / Math.max(activeWork, 1)) * activeWork;
          }

          return {
            completed: operationTotals.completed + completed,
            total: operationTotals.total + activeWork,
          };
        },
        { completed: 0, total: 0 },
      );

      return {
        completed: taskTotals.completed + coreTotals.completed,
        total: taskTotals.total + coreTotals.total,
      };
    },
    { completed: 0, total: 0 },
  );

  if (totals.total <= 0) return 0;
  return clampProgress(totals.completed / totals.total);
};

const getCpuExecutionProgress = (operation: ActiveCoreOperation) => {
  if (operation.status === "complete") return 1;
  if (
    operation.status !== "running" &&
    operation.status !== "loadingCache"
  ) {
    return 0;
  }

  return clampProgress(
    1 - operation.remainingCycles / Math.max(operation.totalCycles, 1),
  );
};

const getCoreProgress = (
  operation: ActiveCoreOperation,
  definition: TaskOperationDefinition | null,
  deadlockScopeOperation: ActiveCoreOperation | null,
): VisibleCoreTaskProgress => {
  const halted =
    deadlockScopeOperation !== null && operation.status !== "complete";
  return {
    coreId: operation.coreId,
    operationId: operation.operationId,
    operationName: operation.operationName,
    memoryAction: definition?.memoryAction ?? null,
    status: halted ? "deadlocked" : operation.status,
    memoryState: halted ? "deadlock" : operation.memoryState,
    progress: getCpuExecutionProgress(operation),
    remainingCycles: operation.remainingCycles,
    totalCycles: operation.totalCycles,
    remainingLoadCycles: operation.remainingLoadCycles,
    totalLoadCycles: operation.totalLoadCycles,
    cacheBits: definition?.cacheBits ?? 0,
    memoryReservedBytes: operation.memoryReservedBytes,
    memoryReservedBits: operation.memoryReservedBits,
    lockResource:
      operation.lockResource ?? (halted ? deadlockScopeOperation.lockResource : null),
    lockReason:
      operation.lockReason ?? (halted ? deadlockScopeOperation.lockReason : null),
    deadlockSeconds: operation.deadlockSeconds,
  };
};

const getVisibleActiveTask = (
  state: GameState,
  activeTask: GameState["activeTasks"][number],
): VisibleActiveTask => {
  const definition = getTaskDefinition(activeTask.taskId);
  const activeOperation =
    activeTask.coreOperations.find((operation) => operation.status !== "complete") ??
    activeTask.coreOperations[0];
  const deadlockedOperation = activeTask.coreOperations.find(
    (operation) => operation.status === "deadlocked",
  );
  const deadlockScopeOperation = getTaskDeadlockScopeOperation(state, activeTask);
  const halted = deadlockScopeOperation !== null;

  return {
    instanceId: activeTask.instanceId,
    taskId: activeTask.taskId,
    jobId: activeTask.jobId,
    systemId: activeTask.systemId,
    queueEntryId: activeTask.queueEntryId,
    parentQueueEntryId: activeTask.parentQueueEntryId,
    parentTaskId: activeTask.parentTaskId,
    childTaskId: activeTask.childTaskId,
    schedulerQueued: activeTask.schedulerQueued,
    name: definition.name,
    coreId: activeTask.coreId,
    assignedCoreIds: activeTask.assignedCoreIds,
    progress: getTaskRuntimeProgress(state, activeTask, definition),
    status: halted ? "deadlocked" : combineStatus(activeTask.coreOperations),
    memoryState: halted ? "deadlock" : combineMemoryState(activeTask.coreOperations),
    activeOperationName: activeOperation?.operationName ?? null,
    coreProgress: activeTask.coreOperations.map((operation) =>
      getCoreProgress(
        operation,
        definition.operations[operation.operationIndex] ?? null,
        deadlockScopeOperation,
      ),
    ),
    lockResource:
      deadlockedOperation?.lockResource ??
      deadlockScopeOperation?.lockResource ??
      activeOperation?.lockResource ??
      null,
    lockReason:
      deadlockedOperation?.lockReason ??
      deadlockScopeOperation?.lockReason ??
      activeOperation?.lockReason ??
      null,
  };
};

const asVisibleActiveJob = (
  state: GameState,
  activeTask: GameState["activeTasks"][number],
  visibleTask: VisibleActiveTask,
): VisibleActiveJob => ({
  ...visibleTask,
  remainingSeconds: getVisibleRemainingSeconds(state, activeTask),
});

const getActiveRamChannelStickIds = (
  operations: ActiveCoreOperation[],
  activeWriteBlockKeys: Set<string>,
): Map<number, number> => {
  const activeChannelSticks = new Map<number, number>();

  for (const operation of operations) {
    if (operation.status !== "loadingRam") continue;

    for (const block of operation.ramBlocks ?? []) {
      if (block.loadedBits >= block.lengthBits) continue;
      if (!activeWriteBlockKeys.has(getRamWriteBlockKey(operation, block))) continue;

      const channelIndex = block.channelIndex ?? 0;
      if (!activeChannelSticks.has(channelIndex)) {
        activeChannelSticks.set(channelIndex, block.stickId);
      }
    }
  }

  return activeChannelSticks;
};

const getMemoryPipeline = (state: GameState) => {
  const operations = state.activeTasks.flatMap((task) => task.coreOperations);
  const count = (status: OperationRuntimeStatus) =>
    operations.filter((operation) => operation.status === status).length;
  const memoryStates = operations.map((operation) => operation.memoryState);
  const activeChannelSticks = getActiveRamChannelStickIds(
    operations,
    getActiveRamWriteBlockKeys(state),
  );
  const activeChannelCount =
    activeChannelSticks.size > 0 ? activeChannelSticks.size : 1;
  const installedStickCount = Math.max(1, state.hardware.ramSticks.length);
  const maxChannelCount = Math.min(getRamChannelCount(state), installedStickCount);

  return {
    status: combineMemoryState(operations),
    cacheLoads: count("loadingCache"),
    ramLoads: count("loadingRam"),
    waits: count("waitingMemory"),
    deadlocks: memoryStates.filter((state) => state === "deadlock").length,
    activeChannelCount,
    maxChannelCount,
    effectiveBandwidthBps: getActiveRamWriteBandwidthBps(state),
    channelBlockedReason: getRamChannelBlockedReason(state),
  };
};

const getVisibleUpgrade = (
  state: GameState,
  upgrade: ReturnType<typeof getUpgradeDefinition>,
  context?: UpgradeContext,
): VisibleUpgrade => {
  const costs = upgrade.cost(state, context);
  const refunds = getUpgradeRefund(state, upgrade.id, context);
  const downgradeBlockedReason = getUpgradeDowngradeBlockedReason(
    state,
    upgrade.id,
    context,
  );
  const powerDeltaWatts = getUpgradePowerDeltaWatts(state, upgrade, context);
  const purchaseCount = getUpgradeCount(state, upgrade.id, context);
  const maxedByPurchaseLimit =
    upgrade.maxPurchases !== undefined && purchaseCount >= upgrade.maxPurchases;
  const maxed = maxedByPurchaseLimit || costs.length === 0;

  return {
    id: upgrade.id,
    name: upgrade.name,
    component: upgrade.component,
    accent: upgrade.accent,
    costs,
    refunds,
    ...(powerDeltaWatts === null ? {} : { powerDeltaWatts }),
    canAfford: !maxed && canAfford(state, costs),
    canDowngrade: refunds.length > 0 && downgradeBlockedReason === null,
    downgradeBlockedReason,
    purchaseCount,
    maxed,
  };
};

const getVisibleRamInstallOptions = (
  state: GameState,
): VisibleRamInstallOption[] => {
  const ramUpgrade = getUpgradeDefinition("ram");
  if (!ramUpgrade.requirement(state)) return [];
  if (state.hardware.ramSticks.length > 0 || state.hardware.ramBits > 0) return [];

  return getUnlockedRamTierDefinitions(state).map((tier) => {
    const level = tier.firstGlobalLevel;
    const tierLevel = getRamTierLevelDefinition(level);

    return {
      tierId: tier.id,
      tierName: tier.name,
      level,
      sizeBits: tierLevel.capacityBits,
      sizeBytes: bitsToBytes(tierLevel.capacityBits),
      speedMt: tierLevel.clockHz,
      upgrade: getVisibleUpgrade(state, ramUpgrade, { ramTierId: tier.id }),
    };
  });
};

const powerDeltaUpgradeIds = new Set(["secondCpu", "matchedCpu"]);

const getUpgradePowerDeltaWatts = (
  state: GameState,
  upgrade: ReturnType<typeof getUpgradeDefinition>,
  context?: UpgradeContext,
) => {
  if (!powerDeltaUpgradeIds.has(upgrade.id) || !upgrade.requirement(state)) {
    return null;
  }

  const comparisonState: GameState = {
    ...state,
    power: {
      ...state.power,
      state: "on",
      transitionSeconds: 0,
    },
  };
  const beforeWatts = getHardwareDrawWatts(comparisonState);
  const afterWatts = getHardwareDrawWatts(upgrade.buy(comparisonState, context));

  return Math.max(
    0,
    Math.round((afterWatts - beforeWatts) * 1_000_000_000_000) /
      1_000_000_000_000,
  );
};

const getCpuSockets = (
  state: GameState,
  activeTasks: VisibleActiveTask[],
  activeJobs: VisibleActiveJob[],
  cacheResidency: CacheResidencySegment[],
): VisibleCpuSocket[] => {
  const clockUpgrade = getUpgradeDefinition("clock");
  const coreUpgrade = getUpgradeDefinition("core");
  const cacheUpgrade = getUpgradeDefinition("cache");
  const cacheSpeedUpgrade = getUpgradeDefinition("cacheSpeed");
  const schedulerSlotUpgrade = getUpgradeDefinition("schedulerSlot");
  const deadlockRecoveryUpgrade = getUpgradeDefinition("deadlockRecovery");
  const primaryCpuId = state.hardware.cpus[0]?.id ?? 1;
  const cStateLevel = getGlobalCStateLevel(state);
  const idleMultiplier =
    state.flags.cStateControl || cStateLevel > 0
      ? getCStateIdleMultiplier(cStateLevel)
      : 1;

  return state.hardware.cpus.map((cpu) => {
    const socketId = cpu.id;
    const tierLevel = getCpuTierLevelDefinition(cpu.tierId, cpu.level);
    const cacheSpeedTierLevel = getCpuTierLevelDefinition(
      cpu.tierId,
      cpu.cacheSpeedLevel,
    );
    const effectiveEfficiency = getEffectiveCpuEfficiency(
      state,
      cpu.tierId,
      cpu.level,
    );
    const activeDrawWatts = tierLevel.clockHz / effectiveEfficiency / 1_000_000;
    const socketCacheResidency = cacheResidency.filter((segment) =>
      cpu.coreIds.includes(segment.coreId),
    );
    const socketDeadlock =
      getRamDeadlockOperation(state) ?? getCacheDeadlockOperationForCpu(state, cpu.id);

    return {
      id: socketId,
      label: `CPU ${String.fromCharCode(64 + socketId)}`,
      tierId: cpu.tierId,
      tierName: getCpuTierDefinition(cpu.tierId).name,
      level: cpu.level,
      clockHz: tierLevel.clockHz,
      efficiency: effectiveEfficiency,
      activeDrawWatts,
      idleDrawWatts: activeDrawWatts * idleMultiplier,
      cacheLevel: cpu.cacheLevel,
      cacheSpeedLevel: cpu.cacheSpeedLevel,
      cacheSpeedHz: cacheSpeedTierLevel.clockHz,
      cacheBits: cpu.cacheBits,
      cacheBytes: cpu.cacheBytes,
      cacheUsedBits: getCacheUsedBits(socketCacheResidency),
      cacheUsedBytes: getCacheUsedBytes(socketCacheResidency),
      cacheResidency: socketCacheResidency,
      schedulerSlots: cpu.schedulerSlots,
      queuedCount: getSchedulerQueuedCount(state, cpu.id),
      schedulerConfig: cpu.schedulerConfig,
      watchdog: getSchedulerWatchdogPreview(state, "cpu", cpu.id),
      deadlocked: Boolean(socketDeadlock),
      deadlockResource: socketDeadlock?.lockResource ?? null,
      deadlockRecoveryUpgrade:
        state.flags.schedulerWatchdog && cpu.id === primaryCpuId
          ? getVisibleUpgrade(state, deadlockRecoveryUpgrade)
          : null,
      allCoreClockUpgrade: getVisibleUpgrade(state, clockUpgrade, {
        cpuId: cpu.id,
      }),
      cStateUpgrade: null,
      coreUpgrade: state.flags.multiCore
        ? getVisibleUpgrade(state, coreUpgrade, { cpuId: cpu.id })
        : null,
      cacheUpgrade: getVisibleUpgrade(state, cacheUpgrade, { cpuId: cpu.id }),
      cacheSpeedUpgrade: getVisibleUpgrade(state, cacheSpeedUpgrade, { cpuId: cpu.id }),
      schedulerSlotUpgrade:
        state.flags.basicQueue || state.flags.scheduler
          ? getVisibleUpgrade(state, schedulerSlotUpgrade, { cpuId: cpu.id })
          : null,
      cores: cpu.coreIds.map((coreId) => {
          const activeTask =
            activeTasks.find((task) => task.assignedCoreIds.includes(coreId)) ?? null;
          const activeJob =
            activeJobs.find((task) => task.assignedCoreIds.includes(coreId)) ?? null;
          const coreDeadlock =
            activeTask?.coreProgress.find(
              (operation) =>
                operation.coreId === coreId && operation.status === "deadlocked",
            ) ?? null;

          return {
            id: coreId,
            socketId,
            clockLevel: getCoreClockLevel(state, coreId),
            clockHz: getCoreClockHz(state, coreId),
            clockUpgrade: null,
            scheduler: state.coreSchedulers[coreId],
            activeTask,
            activeJob,
            deadlocked: Boolean(coreDeadlock),
            deadlockResource: coreDeadlock?.lockResource ?? null,
          };
        }),
    };
  });
};

const getRamSlots = (
  state: GameState,
  ramResidency: RamResidencySegment[],
): VisibleRamSlot[] => {
  const ramBits = state.hardware.ramBits ?? state.hardware.ramBytes * 8;
  if (!state.flags.systemStats || ramBits <= 0) return [];
  const capacityUpgrade = getUpgradeDefinition("ramCapacity");
  const speedUpgrade = getUpgradeDefinition("ramSpeed");

  const slots =
    state.hardware.ramSticks.length > 0
      ? state.hardware.ramSticks
      : [
          {
            id: 1,
            level: 1,
            bits: ramBits,
            bytes: bitsToBytes(ramBits),
            speedLevel: state.hardware.ramSpeedLevel,
            speedMt: state.hardware.ramSpeedMt,
          },
        ];
  const usedBitsByStick = new Map<number, number>();
  const activeStickIds = new Set<number>();

  ramResidency.forEach((segment) => {
    const stickId = segment.stickId ?? slots[0]?.id ?? 1;
    usedBitsByStick.set(
      stickId,
      (usedBitsByStick.get(stickId) ?? 0) + segment.bits,
    );
    if (segment.state === "loading") {
      activeStickIds.add(stickId);
    }
  });

  return slots.map((slot) => {
    const usedBits = Math.min(slot.bits, usedBitsByStick.get(slot.id) ?? 0);

    return {
      id: slot.id,
      level: slot.level,
      sizeBits: slot.bits,
      sizeBytes: slot.bytes,
      usedBits,
      usedBytes: bitsToBytes(usedBits),
      speedLevel: slot.speedLevel,
      speedMt: slot.speedMt,
      efficiency: getRamStickEfficiency(slot.speedLevel),
      active: activeStickIds.has(slot.id),
      capacityUpgrade: getVisibleUpgrade(state, capacityUpgrade, {
        ramStickId: slot.id,
      }),
      speedUpgrade: getVisibleUpgrade(state, speedUpgrade, {
        ramStickId: slot.id,
      }),
    };
  });
};

const getResearchComputeTask = (
  state: GameState,
  task: TaskDefinition,
): VisibleResearchComputeTask => {
  const activeTask = state.activeTasks.find((active) => active.taskId === task.id);
  const visibleTask = getTaskVisible(state, task);
  const completed = isTaskComplete(state, task);

  return {
    id: task.id,
    name: task.name,
    category: task.category,
    operationCount: task.operationCount,
    rewardCredits: task.rewardCredits,
    rewardData: task.rewardData,
    cacheNeedBits: task.cacheNeedBits,
    ramNeedBits: task.ramNeedBits,
    requiredCores: task.minCores,
    canStart: visibleTask.canStart,
    canQueue: visibleTask.canQueue,
    blockedReason: visibleTask.blockedReason,
    queueBlockedReason: visibleTask.queueBlockedReason,
    completed,
    active: Boolean(activeTask),
    progress: activeTask
      ? getTaskRuntimeProgress(state, activeTask, task)
      : completed
        ? 1
        : 0,
  };
};

const isBuilderResearchHidden = (state: GameState, researchId: string) =>
  (researchId === "systemCatalog" && state.flags.systemCatalog) ||
  (researchId === "customMachineAssembly" && state.flags.customMachineAssembly);

const isCStateLevelUpResearch = (
  state: GameState,
  researchId: string,
  completed: boolean,
) =>
  researchId === "cStateControl" &&
  completed &&
  getGlobalCStateLevel(state) < CPU_TIER_MAX_LEVEL;

const isMemoryVoltageLevelUpResearch = (
  state: GameState,
  researchId: string,
  completed: boolean,
) =>
  researchId === "memoryVoltageModifier" &&
  completed &&
  (state.hardware.memoryVoltageLevel ?? 0) < MEMORY_VOLTAGE_MAX_LEVEL;

const getVisibleResearch = (state: GameState) =>
  researchDefinitions
    .filter(
      (research) =>
        !isBuilderResearchHidden(state, research.id) &&
        (research.reveal(state) ||
          state.research.completed.includes(research.id)),
    )
    .map((research) => {
      const costs = research.cost(state);
      const savedCompleted = state.research.completed.includes(research.id);
      const cStateLevelUp = isCStateLevelUpResearch(
        state,
        research.id,
        savedCompleted,
      );
      const memoryVoltageLevelUp = isMemoryVoltageLevelUpResearch(
        state,
        research.id,
        savedCompleted,
      );
      const repeatableLevelUp = cStateLevelUp || memoryVoltageLevelUp;
      const completed = savedCompleted && !repeatableLevelUp;
      const canAffordResearch = canAfford(state, costs);
      const requirements = repeatableLevelUp
        ? []
        : research.requirements(state).map((item) => ({
            id: item.id,
            label: item.label,
            kind: item.kind,
            met: item.met(state),
          }));
      const firstUnmetRequirement = requirements.find((item) => !item.met);
      const canBuy = !completed && research.requirement(state);
      const computeTasks = (research.computeTaskIds ?? []).map((taskId) =>
        getResearchComputeTask(state, getTaskDefinition(taskId)),
      );

      return {
        id: research.id,
        name: research.name,
        description: research.description,
        grants: research.grants,
        costs,
        canAfford: canAffordResearch,
        canBuy,
        completed,
        ...(repeatableLevelUp ? { actionLabel: "Level up" } : {}),
        blockedReason: completed
          ? null
          : firstUnmetRequirement
            ? `Needs ${firstUnmetRequirement.label}.`
            : canAffordResearch
              ? null
              : "Insufficient resources.",
        requirements,
        computeTasks,
      };
    });

const getVisibleJobs = (state: GameState): VisibleJob[] =>
  getAvailableTasks(state).map((task) => {
    const visibleTask = getTaskVisible(state, task);
    return {
      ...visibleTask,
      kind: visibleTask.kind === "task" ? "job" : visibleTask.kind,
      seconds: estimateJobSeconds(state, task),
    };
  });

const getVisibleDeadlocks = (state: GameState): VisibleDeadlockSummary[] =>
  state.activeTasks.flatMap((task) => {
    const definition = getTaskDefinition(task.taskId);
    const operation = task.coreOperations.find(
      (coreOperation) =>
        coreOperation.status === "deadlocked" &&
        coreOperation.lockResource !== null,
    );
    if (!operation?.lockResource) return [];

    return [
      {
        taskId: task.taskId,
        taskName: definition.name,
        coreIds: task.assignedCoreIds,
        cpuId: getCpuIdForCore(state, task.coreId),
        resource: operation.lockResource,
        reason: operation.lockReason ?? "Deadlock.",
        schedulerQueued: task.schedulerQueued,
      },
    ];
  });

const getVisibleDeadlockPressure = (state: GameState) => {
  const seconds = Math.max(0, state.deadlockPressureSeconds ?? 0);

  return {
    seconds,
    limitSeconds: DEADLOCK_FAILURE_SECONDS,
    remainingSeconds: Math.max(0, DEADLOCK_FAILURE_SECONDS - seconds),
    progress: Math.min(1, seconds / DEADLOCK_FAILURE_SECONDS),
    cooldownRate: getDeadlockCooldownRate(state),
    resource: state.deadlockPressureResource ?? null,
    cpuId: state.deadlockPressureCpuId ?? null,
    active: state.activeTasks.some((task) =>
      task.coreOperations.some((operation) => operation.status === "deadlocked"),
    ),
    lockout: state.deadlockProcessLockout === true,
  };
};

const getVisiblePowerOverloadFailure = (state: GameState) => {
  const seconds = Math.max(0, state.power.overloadFailureSeconds ?? 0);
  const psuStress = getPsuStress(state);
  const rate =
    state.power.state === "on" || state.power.state === "shuttingDown"
      ? getPowerOverloadRate(psuStress)
      : 0;

  return {
    seconds,
    limitSeconds: POWER_OVERLOAD_FAILURE_SECONDS,
    remainingSeconds: Math.max(0, POWER_OVERLOAD_FAILURE_SECONDS - seconds),
    progress: Math.min(1, seconds / POWER_OVERLOAD_FAILURE_SECONDS),
    rate,
    active: rate > 0 || seconds > 0,
    tripped: seconds >= POWER_OVERLOAD_FAILURE_SECONDS,
  };
};

const isCronTaskOption = (state: GameState, task: TaskDefinition) =>
  task.kind === "task" &&
  task.repeatable &&
  isSystemScheduledTask(task) &&
  isTaskRevealed(state, task);

const getVisibleCron = (state: GameState) => {
  const taskOptions = taskDefinitions
    .filter((task) => isCronTaskOption(state, task))
    .map((task) => ({ id: task.id, name: task.name }));
  const taskNames = new Map(taskDefinitions.map((task) => [task.id, task.name]));

  return {
    unlocked: state.flags.cron,
    minIntervalSeconds: getCronMinIntervalSeconds(state),
    schedules: state.cron.schedules.map((schedule) => ({
      id: schedule.id,
      taskId: schedule.taskId,
      taskName: schedule.taskId ? (taskNames.get(schedule.taskId) ?? null) : null,
      enabled: schedule.enabled,
      intervalMode: schedule.intervalMode,
      intervalValue: schedule.intervalValue,
      remainingSeconds: schedule.remainingSeconds,
      lastResult: schedule.lastResult,
    })),
    taskOptions,
    intervalUpgrade: state.flags.cron
      ? getVisibleUpgrade(state, getUpgradeDefinition("cronInterval"))
      : null,
    queuePowerSpikeSeconds: state.cron.queuePowerSpikeSeconds,
  };
};

const getVisibleComponentSku = (state: GameState, sku: (typeof componentSkus)[number]) => {
  const cpuTierLevel = sku.cpuTierId
    ? getCpuTierLevelDefinition(sku.cpuTierId, sku.cpuLevel ?? 1)
    : null;
  const cacheSpeedTierLevel =
    sku.cpuTierId && sku.cacheSpeedLevel
      ? getCpuTierLevelDefinition(sku.cpuTierId, sku.cacheSpeedLevel)
      : null;

  return {
    ...sku,
    canAfford: canAfford(state, sku.cost),
    tierName: sku.cpuTierId ? getCpuTierDefinition(sku.cpuTierId).name : undefined,
    clockHz: cpuTierLevel?.clockHz ?? (sku.clockLevel ? getClockHz(sku.clockLevel) : undefined),
    cpuEfficiency: cpuTierLevel?.efficiency,
    cacheSpeedHz:
      cacheSpeedTierLevel?.clockHz ??
      (sku.cacheSpeedLevel ? getClockHz(sku.cacheSpeedLevel) : undefined),
    cacheBits: sku.cacheLevel ? getCacheBits(sku.cacheLevel) : undefined,
    cacheBytes: sku.cacheLevel ? bitsToBytes(getCacheBits(sku.cacheLevel)) : undefined,
    ramBits:
      sku.ramLevel && sku.ramStickCount
        ? getRamBits(sku.ramLevel) * sku.ramStickCount
        : undefined,
    ramBytes:
      sku.ramLevel && sku.ramStickCount
        ? bitsToBytes(getRamBits(sku.ramLevel) * sku.ramStickCount)
        : undefined,
    ramSpeedMt: sku.ramSpeedLevel ? getRamSpeedMt(sku.ramSpeedLevel) : undefined,
    psuWatts: sku.psuLevel ? getPsuWatts(sku.psuLevel) : undefined,
    powerDeltaWatts: sku.psuLevel
      ? getPsuWatts(sku.psuLevel)
      : cpuTierLevel
        ? cpuTierLevel.clockHz / cpuTierLevel.efficiency / 1_000_000
        : undefined,
  };
};

const cpuSkuUnlocked = (state: GameState, sku: (typeof componentSkus)[number]) => {
  if (sku.type !== "cpu" || !sku.cpuTierId) return true;
  return getUnlockedCpuTierDefinitions(state).some((tier) => tier.id === sku.cpuTierId);
};

const ramSkuUnlocked = (state: GameState, sku: (typeof componentSkus)[number]) => {
  if (sku.type !== "ram" || !sku.ramLevel) return true;
  return sku.ramLevel <= getMaxUnlockedRamLevel(state);
};

const getVisibleMachineBuilder = (state: GameState) => ({
  unlocked: state.flags.systemCatalog,
  templates: state.flags.systemCatalog
    ? machineTemplates.map((template) => {
        const cost = getMachineSelectionCost(template.components);
        return {
          ...template,
          cost,
          canAfford: canAfford(state, cost),
        };
      })
    : [],
  components: {
    cpu: state.flags.systemCatalog
      ? componentSkus
          .filter((sku) => sku.type === "cpu" && cpuSkuUnlocked(state, sku))
          .map((sku) => getVisibleComponentSku(state, sku))
      : [],
    ram: state.flags.systemCatalog
      ? componentSkus
          .filter((sku) => sku.type === "ram" && ramSkuUnlocked(state, sku))
          .map((sku) => getVisibleComponentSku(state, sku))
      : [],
    scheduler: state.flags.systemCatalog
      ? componentSkus
          .filter((sku) => sku.type === "scheduler")
          .map((sku) => getVisibleComponentSku(state, sku))
      : [],
    psu: state.flags.systemCatalog
      ? componentSkus
          .filter((sku) => sku.type === "psu")
          .map((sku) => getVisibleComponentSku(state, sku))
      : [],
  },
});

const getVisibleSystemSummary = (
  state: GameState,
  systemId: number,
  selectedSystemId: number,
) => {
  const systemState = materializeSystem(state, systemId);
  const busyCoreIds = getBusyCoreIds(systemState);
  const activeTasks = systemState.activeTasks.map((activeTask) =>
    getVisibleActiveTask(systemState, activeTask),
  );
  const activeJobs = systemState.activeTasks.map((activeTask, index) => {
    const visibleTask = activeTasks[index] ?? getVisibleActiveTask(systemState, activeTask);
    return asVisibleActiveJob(systemState, activeTask, visibleTask);
  });
  const ramUsedBits = getRamUsedBits(systemState);
  const cacheResidency = getCacheResidencySegments(systemState);
  const ramResidency = getRamResidencySegments(systemState);
  const ramSlots = getRamSlots(systemState, ramResidency);
  const ramSlotIds = ramSlots.map((slot) => slot.id);
  const powerUsedWatts = getHardwareDrawWatts(systemState);
  const psuCapacityWatts = getPsuCapacityWatts(systemState);
  const system = ensureSystems(state).systems.find((item) => item.id === systemId);

  const purchaseCosts = system?.purchaseCosts ?? [];
  const sellRefund = purchaseCosts
    .map((cost) => ({
      resource: cost.resource,
      amount: Math.floor(cost.amount * 0.5),
    }))
    .filter((cost) => cost.amount > 0);

  return {
    id: systemId,
    name: system?.name ?? `System ${systemId}`,
    templateId: system?.templateId ?? null,
    selected: systemId === selectedSystemId,
    powerState: systemState.power.state,
    coreCount: systemState.hardware.cores,
    activeTaskCount: systemState.activeTasks.length,
    queueCount: systemState.queue.length,
    psuStress: Math.round(getPsuStress(systemState) * 1000) / 1000,
    drawWatts: powerUsedWatts,
    ramBits: systemState.hardware.ramBits,
    ramUsedBits,
    purchaseCosts,
    sellRefund,
    visible: {
      hardware: systemState.hardware,
      metrics: {
        cpuSockets: getCpuSockets(systemState, activeTasks, activeJobs, cacheResidency),
        activeCoreCount: busyCoreIds.size,
        idleCoreCount: systemState.hardware.cores - busyCoreIds.size,
        cacheUsedBits: getCacheUsedBits(cacheResidency),
        cacheUsedBytes: getCacheUsedBytes(cacheResidency),
        ramUsedBits,
        ramUsedBytes: bitsToBytes(ramUsedBits),
        ramSlots,
        ramInstallOptions: getVisibleRamInstallOptions(systemState),
        allRamCapacityUpgrade:
          ramSlotIds.length > 0
            ? getVisibleUpgrade(systemState, getUpgradeDefinition("ramCapacity"), {
                ramStickIds: ramSlotIds,
              })
            : null,
        allRamSpeedUpgrade:
          ramSlotIds.length > 0
            ? getVisibleUpgrade(systemState, getUpgradeDefinition("ramSpeed"), {
                ramStickIds: ramSlotIds,
              })
            : null,
        ramResidency,
        memory: getMemoryPipeline(systemState),
        deadlocks: getVisibleDeadlocks(systemState),
        deadlockPressure: getVisibleDeadlockPressure(systemState),
        systemSchedulerWatchdog: getSchedulerWatchdogPreview(systemState, "system"),
        powerUsedWatts,
        billedPowerWatts: getBilledPowerWatts(systemState),
        powerHeadroomWatts: Math.round((psuCapacityWatts - powerUsedWatts) * 1000) / 1000,
        psuStress: Math.round(getPsuStress(systemState) * 1000) / 1000,
        powerReliability: getPowerReliability(systemState),
        powerEfficiency: getPowerEfficiency(systemState),
        ramEfficiency: getRamMatchEfficiency(systemState),
        cpuEfficiency: getCpuMatchEfficiency(systemState),
        coolingReliabilityBonus:
          Math.round((getCoolingReliabilityBonus(systemState) - 1) * 1000) / 1000,
        powerCostPerSecond: getPowerCostPerSecond(systemState),
        powerState: systemState.power.state,
        powerTransitionSeconds: systemState.power.transitionSeconds,
        powerBootstrapGraceSeconds: systemState.power.bootstrapGraceSeconds,
        powerUnpaidShutdownWarningSeconds:
          systemState.power.unpaidShutdownWarningSeconds,
        powerOverloadFailure: getVisiblePowerOverloadFailure(systemState),
        cacheResidency,
      },
      flags: systemState.flags,
      activeTasks,
      activeJobs,
      queue: getVisibleQueue(systemState),
      cron: getVisibleCron(systemState),
      tasks: taskDefinitions
        .filter(
          (task) =>
            isDefaultVisibleTask(task) &&
            isPlayerFacingTask(task) &&
            isTaskRevealed(systemState, task),
        )
        .map((task) => getTaskVisible(systemState, task)),
      jobs: getVisibleJobs(systemState),
      upgrades: getAvailableUpgrades(systemState).map((upgrade) =>
        getVisibleUpgrade(systemState, upgrade),
      ),
    },
  };
};

export const deriveVisibleState = (state: GameState): VisibleState => {
  const syncedState = syncCoreSchedulers(
    materializeSystem(syncSelectedSystemRuntime(state), state.selectedSystemId),
  );
  const rackSystems = ensureSystems(syncedState).systems;
  const systemSummaries = rackSystems.map((system) =>
    getVisibleSystemSummary(syncedState, system.id, syncedState.selectedSystemId),
  );
  const selectedSystem =
    systemSummaries.find((system) => system.id === syncedState.selectedSystemId) ??
    systemSummaries[0] ??
    {
      id: 1,
      name: "Barebones PC",
      templateId: "barebonesPc",
      selected: true,
      powerState: syncedState.power.state,
      coreCount: syncedState.hardware.cores,
      activeTaskCount: syncedState.activeTasks.length,
      queueCount: syncedState.queue.length,
      psuStress: Math.round(getPsuStress(syncedState) * 1000) / 1000,
      drawWatts: getHardwareDrawWatts(syncedState),
      ramBits: syncedState.hardware.ramBits,
      ramUsedBits: getRamUsedBits(syncedState),
    };
  const stage = getStage(syncedState);
  const busyCoreIds = getBusyCoreIds(syncedState);
  const idleCoreCount = syncedState.hardware.cores - busyCoreIds.size;
  const activeTasks = syncedState.activeTasks.map((activeTask) =>
    getVisibleActiveTask(syncedState, activeTask),
  );
  const activeJobs = syncedState.activeTasks.map((activeTask, index) => {
    const visibleTask = activeTasks[index] ?? getVisibleActiveTask(syncedState, activeTask);
    return asVisibleActiveJob(syncedState, activeTask, visibleTask);
  });
  const ramUsedBits = getRamUsedBits(syncedState);
  const ramUsedBytes = getRamUsedBytes(syncedState);
  const powerUsedWatts = getHardwareDrawWatts(syncedState);
  const billedPowerWatts = getBilledPowerWatts(syncedState);
  const psuCapacityWatts = getPsuCapacityWatts(syncedState);
  const powerHeadroomWatts =
    Math.round((psuCapacityWatts - powerUsedWatts) * 1000) / 1000;
  const cacheResidency = getCacheResidencySegments(syncedState);
  const ramResidency = getRamResidencySegments(syncedState);
  const ramSlots = getRamSlots(syncedState, ramResidency);
  const ramSlotIds = ramSlots.map((slot) => slot.id);
  const machineBuilder = getVisibleMachineBuilder(syncedState);
  const customBuilder = {
    title: "Custom",
    groups: [
      { id: "cpu", label: "CPU", options: machineBuilder.components.cpu },
      { id: "ram", label: "RAM", options: machineBuilder.components.ram },
      {
        id: "scheduler",
        label: "Scheduler",
        options: machineBuilder.components.scheduler,
      },
      { id: "psu", label: "PSU", options: machineBuilder.components.psu },
    ],
  };

  return {
    stage,
    stageLabel: getStageLabel(stage),
    resources: syncedState.resources,
    rack: {
      selectedSystemId: syncedState.selectedSystemId,
      systems: systemSummaries,
      templates: machineBuilder.templates,
      preconfiguredSystems: machineBuilder.templates,
      customBuilder: machineBuilder.unlocked ? customBuilder : null,
      unlocked: machineBuilder.unlocked,
    },
    systems: systemSummaries,
    selectedSystem,
    machineBuilder,
    hardware: syncedState.hardware,
    metrics: {
      cpuSockets: getCpuSockets(syncedState, activeTasks, activeJobs, cacheResidency),
      activeCoreCount: busyCoreIds.size,
      idleCoreCount,
      cacheUsedBits: getCacheUsedBits(cacheResidency),
      cacheUsedBytes: getCacheUsedBytes(cacheResidency),
      ramUsedBits,
      ramUsedBytes,
      ramSlots,
      ramInstallOptions: getVisibleRamInstallOptions(syncedState),
      allRamCapacityUpgrade:
        ramSlotIds.length > 0
          ? getVisibleUpgrade(syncedState, getUpgradeDefinition("ramCapacity"), {
              ramStickIds: ramSlotIds,
            })
          : null,
      allRamSpeedUpgrade:
        ramSlotIds.length > 0
          ? getVisibleUpgrade(syncedState, getUpgradeDefinition("ramSpeed"), {
              ramStickIds: ramSlotIds,
            })
          : null,
      ramResidency,
      memory: getMemoryPipeline(syncedState),
      deadlocks: getVisibleDeadlocks(syncedState),
      deadlockPressure: getVisibleDeadlockPressure(syncedState),
      systemSchedulerWatchdog: getSchedulerWatchdogPreview(syncedState, "system"),
      powerUsedWatts,
      billedPowerWatts,
      powerHeadroomWatts,
      psuStress: Math.round(getPsuStress(syncedState) * 1000) / 1000,
      powerReliability: getPowerReliability(syncedState),
      powerEfficiency: getPowerEfficiency(syncedState),
      ramEfficiency: getRamMatchEfficiency(syncedState),
      cpuEfficiency: getCpuMatchEfficiency(syncedState),
      coolingReliabilityBonus:
        Math.round((getCoolingReliabilityBonus(syncedState) - 1) * 1000) / 1000,
      powerCostPerSecond: getPowerCostPerSecond(syncedState),
      powerState: syncedState.power.state,
      powerTransitionSeconds: syncedState.power.transitionSeconds,
      powerBootstrapGraceSeconds: syncedState.power.bootstrapGraceSeconds,
      powerUnpaidShutdownWarningSeconds:
        syncedState.power.unpaidShutdownWarningSeconds,
      powerOverloadFailure: getVisiblePowerOverloadFailure(syncedState),
      cacheResidency,
    },
    flags: syncedState.flags,
    research: getVisibleResearch(syncedState),
    activeTasks,
    activeJobs,
    queue: getVisibleQueue(syncedState),
    cron: getVisibleCron(syncedState),
    tasks: taskDefinitions
      .filter(
        (task) =>
          isDefaultVisibleTask(task) &&
          isPlayerFacingTask(task) &&
          isTaskRevealed(syncedState, task),
      )
      .map((task) => getTaskVisible(syncedState, task)),
    jobs: getVisibleJobs(syncedState),
    upgrades: getAvailableUpgrades(syncedState).map((upgrade) =>
      getVisibleUpgrade(syncedState, upgrade),
    ),
    milestone: getMilestone(syncedState),
  };
};
