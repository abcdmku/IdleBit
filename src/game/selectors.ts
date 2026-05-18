import { hasResearch, researchDefinitions } from "./content/research";
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
  estimateJobSeconds,
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
  getPowerCostPerMinute,
  getPowerEfficiency,
  getPsuCapacityWatts,
  getPsuStress,
  getRamLoadCycles,
  getRamMatchEfficiency,
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
  getCpuHardware,
  getCpuIdForCore,
  getMilestone,
  getStage,
  getStageLabel,
  syncCoreSchedulers,
} from "./progression";
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

const getMaxIdleCoresInCpu = (state: GameState) => {
  const busyCoreIds = getBusyCoreIds(state);
  return Math.max(
    0,
    ...state.hardware.cpus.map(
      (cpu) => cpu.coreIds.filter((coreId) => !busyCoreIds.has(coreId)).length,
    ),
  );
};

const getMaxSchedulerWidthForTask = (
  state: GameState,
  task: TaskDefinition,
  requireIdleCores: boolean,
) => {
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

const isSystemScheduledTask = (task: TaskDefinition) =>
  task.category === "system" || task.category === "distributed";

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

  const idleCoreCount = getMaxIdleCoresInCpu(state);
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

const getTaskVisible = (state: GameState, task: TaskDefinition): VisibleTask => ({
  id: task.id,
  name: task.name,
  kind: task.kind,
  category: task.category,
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

const getRamResidencySegments = (state: GameState): RamResidencySegment[] =>
  state.activeTasks.flatMap((activeTask) => {
    const definition = getTaskDefinition(activeTask.taskId);

    return activeTask.coreOperations.flatMap((runtime) => {
      if (
        runtime.status === "complete" ||
        runtime.status === "waitingMemory" ||
        runtime.memoryReservedBits <= 0
      ) {
        return [];
      }

      const operation = definition.operations[runtime.operationIndex];
      const ramLoadCycles = operation ? getRamLoadCycles(state, operation) : 0;
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
          bits: runtime.memoryReservedBits,
          state: loading ? "loading" : hasPendingRamLoad ? "reserved" : "loaded",
          progress,
        },
      ];
    });
  });

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

const getMemoryPipeline = (state: GameState) => {
  const operations = state.activeTasks.flatMap((task) => task.coreOperations);
  const count = (status: OperationRuntimeStatus) =>
    operations.filter((operation) => operation.status === status).length;
  const memoryStates = operations.map((operation) => operation.memoryState);

  return {
    status: combineMemoryState(operations),
    cacheLoads: count("loadingCache"),
    ramLoads: count("loadingRam"),
    waits: count("waitingMemory"),
    deadlocks: memoryStates.filter((state) => state === "deadlock").length,
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

  return {
    id: upgrade.id,
    name: upgrade.name,
    component: upgrade.component,
    accent: upgrade.accent,
    costs,
    refunds,
    canAfford: canAfford(state, costs),
    canDowngrade: refunds.length > 0 && downgradeBlockedReason === null,
    downgradeBlockedReason,
    purchaseCount: getUpgradeCount(state, upgrade.id, context),
  };
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

  return state.hardware.cpus.map((cpu) => {
    const socketId = cpu.id;
    const socketCacheResidency = cacheResidency.filter((segment) =>
      cpu.coreIds.includes(segment.coreId),
    );
    const socketDeadlock =
      getRamDeadlockOperation(state) ?? getCacheDeadlockOperationForCpu(state, cpu.id);

    return {
      id: socketId,
      label: `CPU ${String.fromCharCode(64 + socketId)}`,
      cacheLevel: cpu.cacheLevel,
      cacheSpeedLevel: cpu.cacheSpeedLevel,
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
        coreIds: cpu.coreIds,
      }),
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
            clockUpgrade: getVisibleUpgrade(state, clockUpgrade, { coreId }),
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

const getRamSlots = (state: GameState, ramUsedBits: number): VisibleRamSlot[] => {
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
  let remainingUsedBits = Math.min(ramUsedBits, ramBits);

  return slots.map((slot) => {
    const usedBits = Math.min(slot.bits, remainingUsedBits);
    remainingUsedBits = Math.max(0, remainingUsedBits - usedBits);

    return {
      id: slot.id,
      level: slot.level,
      sizeBits: slot.bits,
      sizeBytes: slot.bytes,
      usedBits,
      usedBytes: bitsToBytes(usedBits),
      speedLevel: slot.speedLevel,
      speedMt: slot.speedMt,
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

const getVisibleResearch = (state: GameState) =>
  researchDefinitions.filter((research) => research.reveal(state) || state.research.completed.includes(research.id)).map((research) => {
    const costs = research.cost(state);
    const completed = state.research.completed.includes(research.id);
    const canAffordResearch = canAfford(state, costs);
    const requirements = research.requirements(state).map((item) => ({
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

export const deriveVisibleState = (state: GameState): VisibleState => {
  const syncedState = syncCoreSchedulers(state);
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
  const powerHeadroomWatts = Math.round((psuCapacityWatts - powerUsedWatts) * 10) / 10;
  const cacheResidency = getCacheResidencySegments(syncedState);
  const ramResidency = getRamResidencySegments(syncedState);
  const ramSlots = getRamSlots(syncedState, ramUsedBits);
  const ramSlotIds = ramSlots.map((slot) => slot.id);

  return {
    stage,
    stageLabel: getStageLabel(stage),
    resources: syncedState.resources,
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
      powerCostPerMinute: getPowerCostPerMinute(syncedState),
      powerState: syncedState.power.state,
      powerTransitionSeconds: syncedState.power.transitionSeconds,
      cacheResidency,
    },
    flags: syncedState.flags,
    research: getVisibleResearch(syncedState),
    activeTasks,
    activeJobs,
    queue: syncedState.queue,
    cron: getVisibleCron(syncedState),
    tasks: taskDefinitions
      .filter((task) => isPlayerFacingTask(task) && isTaskRevealed(syncedState, task))
      .map((task) => getTaskVisible(syncedState, task)),
    jobs: getVisibleJobs(syncedState),
    upgrades: getAvailableUpgrades(syncedState).map((upgrade) =>
      getVisibleUpgrade(syncedState, upgrade),
    ),
    milestone: getMilestone(syncedState),
  };
};
