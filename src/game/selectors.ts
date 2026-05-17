import { hasResearch, researchDefinitions } from "./content/research";
import { getTaskDefinition, taskDefinitions } from "./content/tasks";
import { getUpgradeCount, getUpgradeDefinition } from "./content/upgrades";
import { canAfford } from "./economy";
import {
  estimateJobSeconds,
  getAvailableCacheBits,
  getAvailableMemoryBits,
  getAvailableSchedulerSlots,
  getAvailableSystemSchedulerSlots,
  getCacheLoadCycles,
  getHardwareCacheBits,
  getMemoryCapacityBits,
  getCoolingReliabilityBonus,
  getCorruptionRiskPerSecond,
  getHardwareDrawWatts,
  getPsuCapacityWatts,
  getPsuStress,
  getRamLoadCycles,
  getReservedMemoryBits,
  getRestartReliability,
  getSchedulerQueuedCount,
  getSchedulerSlotCapacity,
  getSystemSchedulerSlotCapacity,
} from "./math";
import { bitsToBytes } from "./progression";
import {
  getCoreClockHz,
  getCoreClockLevel,
  getCpuHardware,
  getMilestone,
  getStage,
  getStageLabel,
  syncCoreSchedulers,
} from "./progression";
import {
  getAvailableTasks,
  getAvailableUpgrades,
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
  VisibleActiveJob,
  VisibleActiveTask,
  VisibleCoreTaskProgress,
  VisibleCpuSocket,
  VisibleJob,
  VisibleOperation,
  VisibleRamSlot,
  VisibleResearchComputeTask,
  VisibleState,
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

const taskFitsFreeStaging = (state: GameState, task: TaskDefinition) =>
  task.cacheNeedBits <= getAvailableCacheBits(state) &&
  task.ramNeedBits <= getAvailableMemoryBits(state);

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

  if (task.cacheNeedBits > getAvailableCacheBits(state)) return "Not enough free cache.";
  if (task.ramNeedBits > getAvailableMemoryBits(state)) return "Not enough free RAM.";

  if (isSystemScheduledTask(task) && !state.flags.scheduler) {
    return "System scheduler required.";
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
  canAcceptTask(state, task) &&
  taskFitsFreeStaging(state, task) &&
  getBlockedReason(state, task) === null;

const getTaskCanQueue = (state: GameState, task: TaskDefinition) =>
  getQueueBlockedReason(state, task) === null;

const getQueueBlockedReason = (state: GameState, task: TaskDefinition) => {
  if (!canAcceptTask(state, task)) return getBlockedReason(state, task);
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
  const active = operations.find((operation) => operation.status !== "complete");
  return active?.status ?? "complete";
};

const combineMemoryState = (
  operations: ActiveCoreOperation[],
): MemoryRuntimeState => {
  const priority: MemoryRuntimeState[] = [
    "restart",
    "rerun",
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

const getRuntimeCacheState = (
  operation: TaskOperationDefinition,
  runtime: ActiveCoreOperation,
): NonNullable<CacheResidencySegment["state"]> => {
  const bufferProgress = getCacheProgress(
    runtime.remainingCycles,
    runtime.totalCycles,
  );

  if (runtime.status === "loadingCache") {
    return operation.memoryAction && bufferProgress < 1 ? "buffering" : "loading";
  }

  return "loaded";
};

const isCurrentOperationCacheResident = (runtime: ActiveCoreOperation) =>
  [
    "loadingCache",
    "loadingRam",
    "running",
    "rerunning",
    "waitingBarrier",
  ].includes(runtime.status);

const getSegmentBits = (segments: CacheResidencySegment[]) =>
  segments.reduce((total, segment) => total + segment.bits, 0);

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
    const overlaidSegment: CacheResidencySegment = {
      ...segment,
      ...update,
      bits: overlaidBits,
    };

    if (overlaidBits < segment.bits) {
      segments.splice(
        index,
        1,
        { ...segment, bits: segment.bits - overlaidBits },
        overlaidSegment,
      );
    } else {
      segments[index] = overlaidSegment;
    }

    remainingBits -= overlaidBits;
  }

  if (remainingBits > 0) {
    segments.push({
      ...update,
      bits: remainingBits,
    });
  }
};

const applyCacheOperationSegment = (
  segments: CacheResidencySegment[],
  operation: TaskOperationDefinition,
  runtime: ActiveCoreOperation,
  loaded: boolean,
) => {
  if (operation.cacheBits <= 0) return;

  const state = loaded ? "loaded" : getRuntimeCacheState(operation, runtime);
  const progress = loaded
    ? 1
    : getCacheProgress(runtime.remainingLoadCycles, runtime.totalLoadCycles);
  const bufferProgress = loaded
    ? 1
    : getCacheProgress(runtime.remainingCycles, runtime.totalCycles);
  const segmentBase = {
    coreId: runtime.coreId,
    memoryAction: operation.memoryAction,
    operationId: operation.id,
    state,
    progress,
    bufferProgress,
  };

  if (operation.kind !== "memory") {
    const missingBits = operation.cacheBits - getSegmentBits(segments);

    if (missingBits > 0) {
      segments.push({
        ...segmentBase,
        bits: missingBits,
      });
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

        applyCacheOperationSegment(segments, operation, runtime, loaded);
      }

      return segments;
    });
  });

const getCacheUsedBits = (segments: CacheResidencySegment[]) =>
  getSegmentBits(segments);

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
    operation.status !== "rerunning" &&
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
): VisibleCoreTaskProgress => ({
  coreId: operation.coreId,
  operationId: operation.operationId,
  operationName: operation.operationName,
  memoryAction: definition?.memoryAction ?? null,
  status: operation.status,
  memoryState: operation.memoryState,
  progress: getCpuExecutionProgress(operation),
  remainingCycles: operation.remainingCycles,
  totalCycles: operation.totalCycles,
  remainingLoadCycles: operation.remainingLoadCycles,
  totalLoadCycles: operation.totalLoadCycles,
  cacheBits: definition?.cacheBits ?? 0,
  memoryReservedBytes: operation.memoryReservedBytes,
  memoryReservedBits: operation.memoryReservedBits,
  reruns: operation.reruns,
  restarts: operation.restarts,
  corruptions: operation.corruptions,
});

const getVisibleActiveTask = (
  state: GameState,
  activeTask: GameState["activeTasks"][number],
): VisibleActiveTask => {
  const definition = getTaskDefinition(activeTask.taskId);
  const activeOperation =
    activeTask.coreOperations.find((operation) => operation.status !== "complete") ??
    activeTask.coreOperations[0];

  return {
    instanceId: activeTask.instanceId,
    taskId: activeTask.taskId,
    jobId: activeTask.jobId,
    schedulerQueued: activeTask.schedulerQueued,
    name: definition.name,
    coreId: activeTask.coreId,
    assignedCoreIds: activeTask.assignedCoreIds,
    progress: getTaskRuntimeProgress(state, activeTask, definition),
    status: combineStatus(activeTask.coreOperations),
    memoryState: combineMemoryState(activeTask.coreOperations),
    activeOperationName: activeOperation?.operationName ?? null,
    coreProgress: activeTask.coreOperations.map((operation) =>
      getCoreProgress(
        operation,
        definition.operations[operation.operationIndex] ?? null,
      ),
    ),
    restarts: activeTask.restarts,
    reruns: activeTask.reruns,
    corruptions: activeTask.corruptions,
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
    reruns: memoryStates.filter((state) => state === "rerun").length,
    restarts: memoryStates.filter((state) => state === "restart").length,
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
  const visibleUpgrade = (
    upgrade: ReturnType<typeof getUpgradeDefinition>,
    cpuId: number,
  ): VisibleUpgrade => {
    const context = { cpuId };
    const costs = upgrade.cost(state, context);

    return {
      id: upgrade.id,
      name: upgrade.name,
      component: upgrade.component,
      accent: upgrade.accent,
      costs,
      canAfford: canAfford(state, costs),
      purchaseCount: getUpgradeCount(state, upgrade.id, context),
    };
  };

  return state.hardware.cpus.map((cpu) => {
    const socketId = cpu.id;
    const socketCacheResidency = cacheResidency.filter((segment) =>
      cpu.coreIds.includes(segment.coreId),
    );

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
      coreUpgrade: state.flags.multiCore ? visibleUpgrade(coreUpgrade, cpu.id) : null,
      cacheUpgrade: visibleUpgrade(cacheUpgrade, cpu.id),
      cacheSpeedUpgrade: visibleUpgrade(cacheSpeedUpgrade, cpu.id),
      schedulerSlotUpgrade:
        state.flags.basicQueue || state.flags.scheduler
          ? visibleUpgrade(schedulerSlotUpgrade, cpu.id)
          : null,
      cores: cpu.coreIds.map((coreId) => {
          const context = { coreId };
          const costs = clockUpgrade.cost(state, context);

          return {
            id: coreId,
            socketId,
            clockLevel: getCoreClockLevel(state, coreId),
            clockHz: getCoreClockHz(state, coreId),
            clockUpgrade: {
              id: clockUpgrade.id,
              name: clockUpgrade.name,
              component: clockUpgrade.component,
              accent: clockUpgrade.accent,
              costs,
              canAfford: canAfford(state, costs),
              purchaseCount: getUpgradeCount(state, clockUpgrade.id, context),
            },
            scheduler: state.coreSchedulers[coreId],
            activeTask:
              activeTasks.find((task) => task.assignedCoreIds.includes(coreId)) ??
              null,
            activeJob:
              activeJobs.find((task) => task.assignedCoreIds.includes(coreId)) ??
              null,
          };
        }),
    };
  });
};

const getRamSlots = (state: GameState, ramUsedBits: number): VisibleRamSlot[] => {
  const ramBits = state.hardware.ramBits ?? state.hardware.ramBytes * 8;
  if (!state.flags.systemStats || ramBits <= 0) return [];

  const slotCount = Math.min(4, Math.max(1, state.hardware.ramLevel));
  const slotSizeBits = ramBits / slotCount;
  let remainingUsedBits = Math.min(ramUsedBits, ramBits);

  return Array.from({ length: slotCount }, (_, index) => {
    const usedBits = Math.min(slotSizeBits, remainingUsedBits);
    remainingUsedBits = Math.max(0, remainingUsedBits - usedBits);

    return {
      id: index + 1,
      sizeBits: slotSizeBits,
      sizeBytes: bitsToBytes(slotSizeBits),
      usedBits,
      usedBytes: bitsToBytes(usedBits),
      speedMt: state.hardware.ramSpeedMt,
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
  const psuCapacityWatts = getPsuCapacityWatts(syncedState);
  const powerHeadroomWatts = Math.round((psuCapacityWatts - powerUsedWatts) * 10) / 10;
  const cacheResidency = getCacheResidencySegments(syncedState);
  const ramResidency = getRamResidencySegments(syncedState);

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
      ramSlots: getRamSlots(syncedState, ramUsedBits),
      ramResidency,
      memory: getMemoryPipeline(syncedState),
      powerUsedWatts,
      powerHeadroomWatts,
      psuStress: Math.round(getPsuStress(syncedState) * 1000) / 1000,
      restartReliability: getRestartReliability(syncedState),
      corruptionRisk: getCorruptionRiskPerSecond(syncedState),
      coolingReliabilityBonus:
        Math.round((getCoolingReliabilityBonus(syncedState) - 1) * 1000) / 1000,
      powerCostPerMinute: Math.round(powerUsedWatts * 0.03 * 10) / 10,
      cacheResidency,
    },
    flags: syncedState.flags,
    research: getVisibleResearch(syncedState),
    activeTasks,
    activeJobs,
    queue: syncedState.queue,
    tasks: taskDefinitions
      .filter((task) => isPlayerFacingTask(task) && isTaskRevealed(syncedState, task))
      .map((task) => getTaskVisible(syncedState, task)),
    jobs: getVisibleJobs(syncedState),
    upgrades: getAvailableUpgrades(syncedState).map((upgrade) => {
      const costs = upgrade.cost(syncedState);
      return {
        id: upgrade.id,
        name: upgrade.name,
        component: upgrade.component,
        accent: upgrade.accent,
        costs,
        canAfford: canAfford(syncedState, costs),
        purchaseCount: getUpgradeCount(syncedState, upgrade.id),
      };
    }),
    milestone: getMilestone(syncedState),
  };
};
