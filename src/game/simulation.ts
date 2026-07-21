import { getBootSeconds, getBootloaderReducedSeconds } from "./bootloader";
import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountDivide,
  amountMax,
  amountMin,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  exactCost,
  exactResourceBag,
  sumAmounts,
  type Amount,
} from "./amount";
import {
  applyAutomationAction,
  getAutomationBufferLevelIndex,
} from "./automation";
import { updateCampaignProgress } from "./campaign";
import {
  advanceNormalizedCloudForGameState,
  applyCloudAction,
  getNormalizedCloudAdvanceBlockedReason,
  getNormalizedCloudOperatingCostPerSecond,
  getNextNormalizedRunnableCloudGameEventMs,
  hasActiveCloudWork,
  isCloudAction,
  normalizeCloudForGameState,
} from "./cloudGame";
import {
  advanceClusterWorkloads,
  applyClusterWorkloadAction,
  getNextClusterWorkloadEventMs,
  getClusterWorkloadOperatingCostPerSecond,
  getProductiveClusterFacilityIds,
  getRunnableClusterNodeIds,
  hasActiveClusterWorkloads,
  isClusterWorkloadAction,
} from "./distributedDefinitions";
import {
  applyFacilityInfrastructureAction,
  isFacilityInfrastructureAction,
} from "./facilityInfrastructure";
import {
  acceptContract,
  completeContract,
  declineContract,
  refreshContractMarket,
} from "./contracts";
import { getResearchDefinition, researchDefinitions } from "./content/research";
import {
  getMachineSelectionCost,
  getMachineTemplate,
} from "./content/machines";
import { getTaskDefinition, taskDefinitions } from "./content/tasks";
import {
  advanceLiveOperations,
  applyLiveOperationsAction,
  clearLiveOperationsForRemovedSystem,
  getNextLiveOperationsEventMs,
  isLiveOperationsTaskId,
  normalizeLiveOperationsForGameState,
  syncLiveOperationsAllocation,
} from "./liveOperations";
import {
  getUpgradeDefinition,
  getUpgradeCount,
  getUpgradeDowngradeBlockedReason,
  getUpgradeRefund,
  upgradeDefinitions,
} from "./content/upgrades";
import {
  addCosts,
  addExactRewards,
  canAfford,
  setExactResource,
  spend,
  spendExact,
  syncExactResources,
} from "./economy";
import { halfRefundExact } from "./exactCosts";
import {
  DEADLOCK_FAILURE_SECONDS,
  POWER_OVERLOAD_FAILURE_SECONDS,
  allocateRamBlocksForOperation,
  estimateActiveRemainingSeconds,
  estimateTaskSeconds,
  getBaseHardwareDrawWatts,
  getAvailableMemoryBits,
  getAvailableSchedulerSlots,
  getAvailableSystemSchedulerSlots,
  getCacheLoadCycles,
  getCacheLoadRateForOperationTick,
  getDeadlockCooldownRate,
  getHardwareCacheBits,
  getEffectiveCoreClockHz,
  getMemoryCapacityBits,
  getOperationEffectiveClock,
  getPowerCostPerSecondExact,
  getPowerOverloadRate,
  getPsuStress,
  getRamLoadCycles,
  getRamBlockLoadDeltasForOperationTick,
  getRamBlockLoadRatesForOperation,
  getRamLoadCyclesForOperationTick,
  getReservedCacheBits,
} from "./math";
import {
  advanceWorkshopThermal,
  getNextWorkshopThermalEventMs,
  getWorkshopAcceleratorRoutes,
  getWorkshopThermalEnvironment,
  installWorkshopAccelerator,
  installWorkshopCoolingTier,
  recordWorkshopCompletionEvidence,
  removeWorkshopAccelerator,
  selectWorkshopOverclockPreset,
} from "./workshop";
import {
  advanceWorkshopStorageWorkload,
  cancelWorkshopStorageWorkload,
  getNextWorkshopStorageEventMs,
  installWorkshopStorage,
  startWorkshopStorageWorkload,
} from "./workshopStorage";
import { installLocalNetwork } from "./localNetwork";
import {
  bitsToBytes,
  createCoreSchedulerState,
  createSchedulerConfig,
  createSystemState,
  getAllCoreIds,
  getCpuHardware,
  getCpuIdForCore,
  getOperationProgress,
  POWER_BOOTSTRAP_GRACE_SECONDS,
  POWER_UNPAID_SHUTDOWN_WARNING_SECONDS,
  syncCoreSchedulers,
  updateProgressionFlags,
} from "./progression";
import {
  createHardwareFromMachineSelection,
  getMachineSelectionBlockedReason,
  isMachineTemplateUnlocked,
} from "./machines";
import { startProjectPhase } from "./projects";
import {
  applyInfrastructureAction,
  isInfrastructureAction,
  isLegacyActionBlockedByManagedSystem,
  isSystemManaged,
} from "./fleet";
import {
  ensureSystems,
  getFleetSystemLimitBlockedReason,
  materializeSystem,
  replaceSystems,
  syncSelectedSystemRuntime,
  updateMaterializedSystem,
} from "./systems";
import {
  getStoredTaskRewardCredits,
  getStoredTaskWorkCycles,
  getTaskBatchProjection,
  normalizeTaskBatchMultiplier,
} from "./taskBatches";
import type {
  ActiveCoreOperation,
  ActiveTask,
  AdvanceMode,
  Cost,
  CpuTierId,
  DeadlockResource,
  GameAction,
  GameState,
  IdlePowerPolicy,
  MachineComponentSelection,
  PowerFailureReason,
  ResearchId,
  SchedulerConfig,
  SchedulerKillPolicy,
  SchedulerWatchdogPreview,
  TaskDefinition,
  TaskId,
  TaskQueueEntry,
  TaskOperationDefinition,
  UpgradeId,
  WorkOrigin,
} from "./types";

const POWER_SHUTDOWN_SECONDS = 8;
const POWER_BILLING_EPSILON = 0.000000001;
const CRON_DEFAULT_INTERVAL_SECONDS = 60;
const CRON_MAX_SECONDS_INTERVAL = 120;
const CRON_MIN_MINUTES_INTERVAL = 1;
const CRON_MAX_MINUTES_INTERVAL = 60;
const CRON_QUEUE_SPIKE_SECONDS = 5;
const finalizeGameMutation = (state: GameState) =>
  normalizeLiveOperationsForGameState(
    normalizeCloudForGameState(
      updateCampaignProgress(syncExactResources(state)),
    ),
  );

const finalizeNormalizedGameMutation = (state: GameState) =>
  updateCampaignProgress(syncExactResources(state));

export const getCronMinIntervalSeconds = (state: GameState) =>
  Math.max(1, CRON_DEFAULT_INTERVAL_SECONDS - Math.max(0, state.hardware.cronIntervalLevel ?? 0));

const isPowerOn = (state: GameState) => state.power.state === "on";

const canAcceptPoweredWork = isPowerOn;

const canRunPoweredWork = (state: GameState) =>
  state.power.state === "on" || state.power.state === "shuttingDown";

const isSystemScheduledTask = (task: TaskDefinition) =>
  task.category === "system" || task.category === "distributed";

const isChunkedTask = (task: TaskDefinition) => task.coreScaling === "chunked";

const isChunkedSystemTask = (task: TaskDefinition) =>
  isChunkedTask(task) && isSystemScheduledTask(task);

const isCronEligibleTask = (state: GameState, task: TaskDefinition) =>
  task.kind === "task" &&
  task.repeatable &&
  task.visibility !== "internal" &&
  isSystemScheduledTask(task) &&
  (task.reveal(state) || task.requirement(state));

const clampCronIntervalValue = (
  state: GameState,
  intervalMode: "seconds" | "minutes",
  intervalValue: number,
) => {
  if (intervalMode === "minutes") {
    return Math.min(
      CRON_MAX_MINUTES_INTERVAL,
      Math.max(CRON_MIN_MINUTES_INTERVAL, Math.round(intervalValue)),
    );
  }

  return Math.min(
    CRON_MAX_SECONDS_INTERVAL,
    Math.max(getCronMinIntervalSeconds(state), Math.round(intervalValue)),
  );
};

const getCronIntervalSeconds = (
  state: GameState,
  schedule: GameState["cron"]["schedules"][number],
) => {
  const value = clampCronIntervalValue(
    state,
    schedule.intervalMode,
    schedule.intervalValue,
  );

  return schedule.intervalMode === "minutes" ? value * 60 : value;
};

const createCronSchedule = (state: GameState): GameState["cron"]["schedules"][number] => ({
  id: state.cron.nextScheduleId,
  taskId: null,
  enabled: false,
  intervalMode: "seconds",
  intervalValue: getCronMinIntervalSeconds(state),
  remainingSeconds: getCronMinIntervalSeconds(state),
  lastResult: null,
});

const normalizeCronSchedule = (
  state: GameState,
  schedule: GameState["cron"]["schedules"][number],
) => {
  const intervalValue = clampCronIntervalValue(
    state,
    schedule.intervalMode,
    schedule.intervalValue,
  );
  const intervalSeconds =
    schedule.intervalMode === "minutes" ? intervalValue * 60 : intervalValue;

  return {
    ...schedule,
    intervalValue,
    remainingSeconds: Math.min(
      Math.max(0, schedule.remainingSeconds),
      intervalSeconds,
    ),
  };
};

const ensureCronState = (state: GameState) => {
  const slotCount = state.flags.cron
    ? Math.max(0, state.hardware.cronScheduleSlots ?? 0)
    : 0;

  if (slotCount <= 0) {
    return {
      ...state,
      cron: {
        ...state.cron,
        schedules: [],
      },
    };
  }

  const normalizedSchedules = state.cron.schedules
    .slice(0, slotCount)
    .map((schedule) => normalizeCronSchedule(state, schedule));
  const nextScheduleId = Math.max(
    1,
    state.cron.nextScheduleId,
    ...normalizedSchedules.map((schedule) => schedule.id + 1),
  );
  const createdSchedules = Array.from(
    { length: Math.max(0, slotCount - normalizedSchedules.length) },
    (_, index) =>
      createCronSchedule({
        ...state,
        cron: {
          ...state.cron,
          nextScheduleId: nextScheduleId + index,
        },
      }),
  );
  const schedules = [...normalizedSchedules, ...createdSchedules];

  return {
    ...state,
    cron: {
      ...state.cron,
      schedules,
      nextScheduleId: Math.max(
        nextScheduleId,
        ...schedules.map((schedule) => schedule.id + 1),
      ),
    },
  };
};

const isBenchmarkComplete = (state: GameState, taskId: TaskId) =>
  state.completedBenchmarks.includes(taskId) ||
  (state.completedTasks[taskId] ?? state.completedJobs[taskId] ?? 0) > 0;

const availableCoreIds = (state: GameState, cpuId?: number) => {
  const busy = new Set(
    state.activeTasks.flatMap((task) => task.assignedCoreIds),
  );
  const candidates =
    cpuId === undefined ? getAllCoreIds(state) : getCpuHardware(state, cpuId).coreIds;

  return candidates.filter((coreId) => !busy.has(coreId));
};

const isOperationAssignedToCore = (
  task: ActiveTask,
  operation: TaskOperationDefinition,
  coreId: number,
) => {
  if (isChunkedTask(getTaskDefinition(task.taskId))) return true;
  return operation.parallel || operation.kind === "barrier" || coreId === task.coreId;
};

const getOperation = (task: ActiveTask, operationIndex: number) => {
  const taskDefinition = getTaskDefinition(task.taskId);
  return taskDefinition.operations[operationIndex] ?? null;
};

const getRuntimeWork = (
  definition: TaskOperationDefinition | null,
  operation: ActiveCoreOperation,
) => {
  if (
    definition?.memoryAction &&
    amountCompare(operation.totalLoadCycles, ZERO_AMOUNT) > 0
  ) {
    return {
      remaining: amountMax(
        operation.remainingCycles,
        operation.remainingLoadCycles,
      ),
      total: amountMax(operation.totalCycles, operation.totalLoadCycles),
    };
  }

  return {
    remaining: amountAdd(operation.remainingCycles, operation.remainingLoadCycles),
    total: amountAdd(operation.totalCycles, operation.totalLoadCycles),
  };
};

const getFutureWorkUnitCycles = (
  taskDefinition: TaskDefinition,
  operationIndex: number,
) =>
  taskDefinition.operations
    .slice(operationIndex + 1)
    .reduce((sum, operation) => sum + operation.cycles, 0);

const refreshTaskTotals = (task: ActiveTask): ActiveTask => {
  const taskDefinition = getTaskDefinition(task.taskId);
  const activeRemainingCycles = sumAmounts(
    task.coreOperations.map(
      (operation) =>
        getRuntimeWork(getOperation(task, operation.operationIndex), operation)
          .remaining,
    ),
  );
  const activeTotalCycles = sumAmounts(
    task.coreOperations.map(
      (operation) =>
        getRuntimeWork(getOperation(task, operation.operationIndex), operation)
          .total,
    ),
  );

  if (isChunkedTask(taskDefinition)) {
    const batchMultiplier = normalizeTaskBatchMultiplier(
      task.batchMultiplier,
      taskDefinition.aggregateBatch?.maximumMultiplier ?? 1,
    );
    const totalWorkUnits = task.workUnitsTotal ?? taskDefinition.workUnitCount;
    const startedWorkUnits = task.workUnitsStarted ?? 0;
    const pendingWorkUnits =
      task.workUnitsPending ?? Array.from(
        { length: Math.max(0, totalWorkUnits - startedWorkUnits) },
        (_, index) => startedWorkUnits + index,
      );
    const unstartedWorkUnits = pendingWorkUnits.length;
    const futureActiveCycles = task.coreOperations.reduce((sum, operation) => {
      if (operation.status === "complete" || operation.workUnitIndex == null) return sum;
      return sum + getFutureWorkUnitCycles(taskDefinition, operation.operationIndex);
    }, 0);

    return {
      ...task,
      remainingCycles: amountAdd(
        activeRemainingCycles,
        amountAdd(
          amountMultiply(futureActiveCycles, batchMultiplier),
          amountMultiply(
            taskDefinition.workUnitCyclesExact,
            unstartedWorkUnits * batchMultiplier,
          ),
        ),
      ),
      totalCycles: amountMax("1", task.projectedWorkCycles ?? taskDefinition.requiredCyclesExact),
    };
  }

  return {
    ...task,
    remainingCycles: activeRemainingCycles,
    totalCycles: activeTotalCycles,
  };
};

const isTaskRevealed = (state: GameState, task: TaskDefinition) =>
  task.reveal(state) || task.requirement(state);

const isPlayerFacingTask = (task: TaskDefinition) => task.kind !== "benchmark";

const isDefaultVisibleTask = (task: TaskDefinition) =>
  task.visibility !== "internal";

const taskFitsHardware = (state: GameState, task: TaskDefinition) =>
  task.cacheNeedBits <= getHardwareCacheBits(state) &&
  task.ramNeedBits <= getMemoryCapacityBits(state);

const taskFitsCpuHardware = (
  state: GameState,
  task: TaskDefinition,
  cpuId?: number,
) => {
  if (cpuId === undefined) return taskFitsHardware(state, task);
  return (
    task.cacheNeedBits <= getCpuHardware(state, cpuId).cacheBits &&
    task.ramNeedBits <= getMemoryCapacityBits(state)
  );
};

const taskFitsFreeCacheStaging = (
  state: GameState,
  task: TaskDefinition,
  cpuId?: number,
) => task.cacheNeedBits <= getDeadlockSafeAvailableCacheBits(state, cpuId);

const taskFitsFreeMemoryStaging = (
  state: GameState,
  task: TaskDefinition,
) => task.ramNeedBits <= getDeadlockSafeAvailableMemoryBits(state);

const taskFitsFreeStaging = (
  state: GameState,
  task: TaskDefinition,
  cpuId?: number,
) =>
  taskFitsFreeCacheStaging(state, task, cpuId) &&
  taskFitsFreeMemoryStaging(state, task);

const activeTaskRunsOnCpu = (state: GameState, task: ActiveTask, cpuId: number) =>
  task.assignedCoreIds.some((coreId) => getCpuIdForCore(state, coreId) === cpuId);

const getActiveCpuCacheFootprintBits = (state: GameState, cpuId: number) =>
  state.activeTasks.reduce((sum, activeTask) => {
    if (!activeTaskRunsOnCpu(state, activeTask, cpuId)) return sum;
    const definition = getTaskDefinition(activeTask.taskId);
    if (isChunkedTask(definition)) {
      return (
        sum +
        activeTask.coreOperations.filter(
          (operation) =>
            operation.workUnitIndex != null &&
            operation.status !== "complete" &&
            getCpuIdForCore(state, operation.coreId) === cpuId,
        ).length *
          definition.cacheNeedBits
      );
    }
    return sum + definition.cacheNeedBits;
  }, 0);

const getActiveMemoryFootprintBits = (state: GameState) =>
  state.activeTasks.reduce((sum, activeTask) => {
    const definition = getTaskDefinition(activeTask.taskId);
    if (isChunkedTask(definition)) {
      return (
        sum +
        activeTask.coreOperations.filter(
          (operation) =>
            operation.workUnitIndex != null && operation.status !== "complete",
        ).length *
          definition.ramNeedBits
      );
    }
    return sum + definition.ramNeedBits;
  }, 0);

const getDeadlockSafeAvailableCacheBits = (state: GameState, cpuId?: number) => {
  if (cpuId !== undefined) {
    const cpu = getCpuHardware(state, cpuId);
    return Math.max(0, cpu.cacheBits - getActiveCpuCacheFootprintBits(state, cpu.id));
  }

  return Math.max(
    0,
    ...state.hardware.cpus.map((cpu) => {
      const normalizedCpu = getCpuHardware(state, cpu.id);
      return Math.max(
        0,
        normalizedCpu.cacheBits -
          getActiveCpuCacheFootprintBits(state, normalizedCpu.id),
      );
    }),
  );
};

const getDeadlockSafeAvailableMemoryBits = (state: GameState) =>
  Math.max(0, getMemoryCapacityBits(state) - getActiveMemoryFootprintBits(state));

const operationRunsChunkedWorkUnit = (operation: ActiveCoreOperation) =>
  operation.workUnitIndex != null && operation.status !== "complete";

const getChunkedOperationFootprintBits = (
  definition: TaskDefinition,
  operations: ActiveCoreOperation[],
) =>
  operations.filter(operationRunsChunkedWorkUnit).length * definition.ramNeedBits;

const getOtherActiveMemoryFootprintBits = (
  state: GameState,
  activeTask: ActiveTask,
) =>
  getActiveMemoryFootprintBits({
    ...state,
    activeTasks: state.activeTasks.filter(
      (task) => task.instanceId !== activeTask.instanceId,
    ),
  });

const canStartChunkedWorkUnit = (
  state: GameState,
  activeTask: ActiveTask,
  operations: ActiveCoreOperation[],
) => {
  const definition = getTaskDefinition(activeTask.taskId);
  if (definition.ramNeedBits <= 0) return true;

  return (
    getOtherActiveMemoryFootprintBits(state, activeTask) +
      getChunkedOperationFootprintBits(definition, operations) +
      definition.ramNeedBits <=
    getMemoryCapacityBits(state)
  );
};

const canAcceptTask = (state: GameState, taskId: TaskId) => {
  const task = getTaskDefinition(taskId);
  const benchmarkDone = task.kind === "benchmark" && isBenchmarkComplete(state, taskId);

  return task.requirement(state) && !benchmarkDone && taskFitsHardware(state, task);
};

const hasActiveDeadlock = (state: GameState) =>
  state.activeTasks.some((task) =>
    task.coreOperations.some((operation) => operation.status === "deadlocked"),
  );

const getActiveDeadlockPressureScope = (state: GameState) => {
  for (const task of state.activeTasks) {
    const operation = task.coreOperations.find(
      (coreOperation) => coreOperation.status === "deadlocked",
    );
    if (!operation?.lockResource) continue;

    return {
      resource: operation.lockResource,
      cpuId:
        operation.lockResource === "cache"
          ? getCpuIdForCore(state, operation.coreId)
          : null,
    };
  }

  return null;
};

const isDeadlockStartBlocked = (state: GameState) =>
  hasActiveDeadlock(state) || state.deadlockProcessLockout === true;

/**
 * A non-repeatable task (benchmarks and other one-shots) admits at most one
 * pending instance: a second copy accepted while the first is active or queued
 * would either double-pay or strand an entry that turns ineligible the moment
 * the unique completion settles (C-SIM-5).
 */
const hasPendingNonRepeatableInstance = (
  state: GameState,
  task: TaskDefinition,
) =>
  !task.repeatable &&
  (state.activeTasks.some((activeTask) => activeTask.taskId === task.id) ||
    state.queue.includes(task.id));

const canStartTask = (state: GameState, taskId: TaskId, cpuId?: number) => {
  const task = getTaskDefinition(taskId);

  return (
    canAcceptPoweredWork(state) &&
    !isDeadlockStartBlocked(state) &&
    canAcceptTask(state, taskId) &&
    !hasPendingNonRepeatableInstance(state, task) &&
    taskFitsCpuHardware(state, task, cpuId)
  );
};

const getCpuSchedulerWidth = (state: GameState, cpuId: number) =>
  Math.max(0, getCpuHardware(state, cpuId).schedulerSlots);

const getSystemCpuSchedulerWidth = (state: GameState) =>
  state.hardware.cpus.reduce(
    (total, cpu) => total + getCpuSchedulerWidth(state, cpu.id),
    0,
  );

const getSchedulerSlotReservationCount = (
  task: TaskDefinition,
  assignedCoreIds?: number[],
) => Math.max(1, assignedCoreIds?.length ?? task.minCores);

const getAllQueueEntries = (state: GameState) => [
  ...(state.queueEntries ?? []),
  ...Object.values(state.coreSchedulers).flatMap(
    (scheduler) => scheduler.localQueueEntries ?? [],
  ),
];

const getNextQueueEntryNumber = (
  state: GameState,
  target: TaskQueueEntry["target"],
) => {
  const prefix = `${target}-queue-`;
  return getAllQueueEntries(state).reduce((largest, entry) => {
    if (!entry.id.startsWith(prefix)) return largest;
    const value = Number(entry.id.slice(prefix.length));
    return Number.isFinite(value) ? Math.max(largest, value + 1) : largest;
  }, 1);
};

const getQueueEntryId = (target: TaskQueueEntry["target"], sequence: number) =>
  `${target}-queue-${sequence}`;

const getTaskEntrySnapshot = (task: TaskDefinition) => ({
  name: task.name,
  category: task.category,
  cacheNeedBits: task.cacheNeedBits,
  ramNeedBits: task.ramNeedBits,
  requiredCores: task.minCores,
});

interface QueueEntryOptions {
  id?: string;
  reservationId?: string | null;
  parentTaskId?: TaskId | null;
  parentTaskName?: string | null;
  parentQueueEntryId?: string | null;
  childTaskId?: TaskId | null;
  childTaskName?: string | null;
  workOrigin?: WorkOrigin;
  compositionIndex?: number | null;
  compositionRepeatIndex?: number | null;
  workUnitIndex?: number | null;
  childWorkKey?: string | null;
  completedChildKeys?: string[];
  totalChildCount?: number;
  batchMultiplier?: number;
  projectedRewardCredits?: TaskQueueEntry["projectedRewardCredits"];
  projectedWorkCycles?: TaskQueueEntry["projectedWorkCycles"];
}

const createQueueEntry = (
  state: GameState,
  task: TaskDefinition,
  target: TaskQueueEntry["target"],
  options: QueueEntryOptions = {},
  sequence = getNextQueueEntryNumber(state, target),
): TaskQueueEntry => {
  const projection = getTaskBatchProjection(state, task);
  const batchOwner = options.parentTaskId
    ? getTaskDefinition(options.parentTaskId)
    : task;
  const batchMultiplier = normalizeTaskBatchMultiplier(
    options.batchMultiplier ?? projection.multiplier,
    batchOwner.aggregateBatch?.maximumMultiplier ?? 1,
  );
  return {
    id: options.id ?? getQueueEntryId(target, sequence),
    reservationId: options.reservationId ?? null,
    taskId: task.id,
    ...getTaskEntrySnapshot(task),
    parentTaskId: options.parentTaskId ?? null,
    parentTaskName: options.parentTaskName ?? null,
    parentQueueEntryId: options.parentQueueEntryId ?? null,
    childTaskId: options.childTaskId ?? null,
    childTaskName: options.childTaskName ?? null,
    workOrigin: options.workOrigin,
    compositionIndex: options.compositionIndex ?? null,
    compositionRepeatIndex: options.compositionRepeatIndex ?? null,
    workUnitIndex: options.workUnitIndex ?? null,
    childWorkKey: options.childWorkKey ?? null,
    completedChildKeys: options.completedChildKeys,
    batchMultiplier,
    projectedRewardCredits:
      options.projectedRewardCredits ??
      amountMultiply(task.rewardCreditsExact, batchMultiplier),
    projectedWorkCycles:
      options.projectedWorkCycles ??
      amountMultiply(task.requiredCyclesExact, batchMultiplier),
    totalChildCount: options.totalChildCount,
    target,
  };
};

interface SystemChildWorkUnit {
  taskId: TaskId;
  compositionIndex: number;
  compositionRepeatIndex: number;
  workUnitIndex: number | null;
  key: string;
}

const getChildWorkKey = (
  compositionIndex: number,
  compositionRepeatIndex: number,
  workUnitIndex: number | null,
) => `${workUnitIndex ?? "single"}:${compositionIndex}:${compositionRepeatIndex}`;

const getSystemChildWorkUnits = (task: TaskDefinition): SystemChildWorkUnit[] => {
  if (!isSystemScheduledTask(task)) return [];
  if (task.composition.length === 0) {
    return [
      {
        taskId: task.id,
        compositionIndex: 0,
        compositionRepeatIndex: 0,
        workUnitIndex: null,
        key: getChildWorkKey(0, 0, null),
      },
    ];
  }

  return task.composition.flatMap((entry, compositionIndex) => {
    const workUnitIndexes =
      isChunkedTask(task) && entry.mode === "perWorkUnit"
        ? Array.from({ length: task.workUnitCount }, (_, index) => index)
        : [null];

    return workUnitIndexes.flatMap((workUnitIndex) =>
      Array.from({ length: Math.max(1, entry.count) }, (_, compositionRepeatIndex) => ({
        taskId: entry.taskId,
        compositionIndex,
        compositionRepeatIndex,
        workUnitIndex,
        key: getChildWorkKey(compositionIndex, compositionRepeatIndex, workUnitIndex),
      })),
    );
  });
};

const getCompletedChildKeySet = (entry: TaskQueueEntry) =>
  new Set(entry.completedChildKeys ?? []);

const getQueuedChildEntriesForParent = (state: GameState, parentQueueEntryId: string) =>
  Object.values(state.coreSchedulers).flatMap((scheduler) =>
    (scheduler.localQueueEntries ?? []).filter(
      (entry) => entry.parentQueueEntryId === parentQueueEntryId,
    ),
  );

const getActiveChildTasksForParent = (state: GameState, parentQueueEntryId: string) =>
  state.activeTasks.filter((task) => task.parentQueueEntryId === parentQueueEntryId);

const getReservedChildKeySet = (state: GameState, parentQueueEntryId: string) =>
  new Set([
    ...getQueuedChildEntriesForParent(state, parentQueueEntryId)
      .map((entry) => entry.childWorkKey)
      .filter((key): key is string => Boolean(key)),
    ...getActiveChildTasksForParent(state, parentQueueEntryId)
      .map((task) => {
        const entry = Object.values(state.coreSchedulers)
          .flatMap((scheduler) => scheduler.localQueueEntries ?? [])
          .find(
            (candidate) =>
              (candidate.reservationId ?? candidate.id) === task.queueEntryId,
          );
        return entry?.childWorkKey ?? null;
      })
      .filter((key): key is string => Boolean(key)),
  ]);

const getReadyChildWorkUnits = (
  state: GameState,
  parentEntry: TaskQueueEntry,
  parentTask: TaskDefinition,
) => {
  const units = getSystemChildWorkUnits(parentTask);
  if (units.length === 0) return [];

  const completed = getCompletedChildKeySet(parentEntry);
  const reserved = getReservedChildKeySet(state, parentEntry.id);
  const ready: SystemChildWorkUnit[] = [];

  for (const unit of units) {
    if (completed.has(unit.key) || reserved.has(unit.key)) continue;

    const previousUnits = units.filter((candidate) => {
      if (candidate.compositionIndex > unit.compositionIndex) return false;
      if (candidate.compositionIndex === unit.compositionIndex) {
        return (
          candidate.workUnitIndex === unit.workUnitIndex &&
          candidate.compositionRepeatIndex < unit.compositionRepeatIndex
        );
      }

      if (unit.workUnitIndex === null || candidate.workUnitIndex === null) return true;
      return candidate.workUnitIndex === unit.workUnitIndex;
    });

    if (previousUnits.every((candidate) => completed.has(candidate.key))) {
      ready.push(unit);
    }
  }

  return ready;
};

const getChunkedSystemCoreIds = (
  state: GameState,
  task: TaskDefinition,
  idleOnly: boolean,
) => {
  const coreIds = idleOnly ? availableCoreIds(state) : getAllCoreIds(state);
  return coreIds.filter((coreId) =>
    taskFitsCpuHardware(state, task, getCpuIdForCore(state, coreId)),
  );
};

const canProvisionChunkedSystemTask = (
  state: GameState,
  task: TaskDefinition,
  coreCount = getChunkedSystemCoreIds(state, task, false).length,
) => {
  if (coreCount < task.minCores) return false;
  if (task.minCores <= 1) return true;
  return state.flags.scheduler && getSystemCpuSchedulerWidth(state) >= task.minCores;
};

const cpuCanProvisionTask = (
  state: GameState,
  task: TaskDefinition,
  cpuId: number,
  idleCores = availableCoreIds(state, cpuId).length,
) => {
  if (idleCores < task.minCores) return false;
  if (task.minCores <= 1) return true;
  if (!state.flags.basicQueue && !state.flags.scheduler) {
    return !isSystemScheduledTask(task);
  }
  return getCpuSchedulerWidth(state, cpuId) >= task.minCores;
};

/**
 * Whether the CPU could ever start this task once fully idle: permanent core
 * count, scheduler width, and cache capacity — not current occupancy. Queue
 * reservations must never be parked on a CPU that fails this check, because
 * dispatch requires the same conditions on that exact CPU and local queue
 * entries are never migrated afterwards.
 */
const cpuCanEverProvisionTask = (
  state: GameState,
  task: TaskDefinition,
  cpuId: number,
) =>
  taskFitsCpuHardware(state, task, cpuId) &&
  cpuCanProvisionTask(
    state,
    task,
    cpuId,
    getCpuHardware(state, cpuId).coreIds.length,
  );

const hasCpuThatCanProvisionTask = (
  state: GameState,
  task: TaskDefinition,
  cpuId?: number,
) => {
  if (cpuId === undefined && isChunkedSystemTask(task)) {
    return canProvisionChunkedSystemTask(state, task);
  }

  const cpus =
    cpuId === undefined
      ? state.hardware.cpus
      : state.hardware.cpus.filter((cpu) => cpu.id === cpuId);

  return cpus.some((cpu) =>
    cpuCanProvisionTask(
      state,
      task,
      cpu.id,
      getCpuHardware(state, cpu.id).coreIds.length,
    ),
  );
};

const canQueueTask = (state: GameState, taskId: TaskId, cpuId?: number) => {
  const task = getTaskDefinition(taskId);
  const systemScheduled = isSystemScheduledTask(task);
  const schedulerSlotCount = getSchedulerSlotReservationCount(task);

  if (!canAcceptPoweredWork(state)) return false;
  if (!canAcceptTask(state, taskId)) return false;
  if (hasPendingNonRepeatableInstance(state, task)) return false;
  if (systemScheduled && cpuId !== undefined) return false;
  if (systemScheduled && !state.flags.scheduler) return false;
  if (!systemScheduled && !state.flags.basicQueue && !state.flags.scheduler) {
    return false;
  }

  return (
    hasCpuThatCanProvisionTask(state, task, cpuId) &&
    (systemScheduled
      ? getAvailableSystemSchedulerSlots(state) > 0
      : cpuId === undefined
        ? state.hardware.cpus.some(
            (cpu) =>
              cpuCanProvisionTask(
                state,
                task,
                cpu.id,
                getCpuHardware(state, cpu.id).coreIds.length,
              ) &&
              getAvailableSchedulerSlots(state, cpu.id) >= schedulerSlotCount,
          )
        : getAvailableSchedulerSlots(state, cpuId) >= schedulerSlotCount)
  );
};

const selectCpuIdForTask = (
  state: GameState,
  task: TaskDefinition,
  preferredCoreId?: number,
  cpuId?: number,
) => {
  if (preferredCoreId !== undefined) return getCpuIdForCore(state, preferredCoreId);
  if (cpuId !== undefined) return cpuId;

  return state.hardware.cpus.find(
    (cpu) => {
      const normalizedCpu = getCpuHardware(state, cpu.id);
      return (
        availableCoreIds(state, cpu.id).length >= task.minCores &&
        normalizedCpu.coreIds.length >= task.minCores &&
        canStartTask(state, task.id, cpu.id)
      );
    },
  )?.id;
};

const selectCoreIdsForTask = (
  state: GameState,
  task: TaskDefinition,
  preferredCoreId?: number,
  cpuId?: number,
  maxCoreCount = Number.POSITIVE_INFINITY,
) => {
  if (
    preferredCoreId === undefined &&
    cpuId === undefined &&
    isChunkedSystemTask(task)
  ) {
    const ordered = getChunkedSystemCoreIds(state, task, true);
    const requiredCores = task.minCores;
    const schedulerWidth = getSystemCpuSchedulerWidth(state);
    const coreLimit = Math.max(0, Math.trunc(maxCoreCount));

    if (ordered.length < requiredCores) return [];
    if (requiredCores > 1 && !state.flags.scheduler) return [];
    if (requiredCores > 1 && schedulerWidth < requiredCores) return [];
    if (coreLimit < requiredCores) return [];

    const wantedCores =
      task.parallelizable && state.flags.scheduler
        ? Math.min(
            ordered.length,
            task.workUnitCount,
            Math.max(requiredCores, schedulerWidth),
            coreLimit,
          )
        : requiredCores;

    return ordered.slice(0, Math.max(requiredCores, wantedCores));
  }

  const targetCpuId = selectCpuIdForTask(state, task, preferredCoreId, cpuId);
  if (targetCpuId === undefined) return [];

  const available = availableCoreIds(state, targetCpuId);
  const preferred =
    preferredCoreId && available.includes(preferredCoreId) ? [preferredCoreId] : [];
  const remaining = available.filter((coreId) => coreId !== preferredCoreId);
  const ordered = [...preferred, ...remaining];
  const requiredCores = task.minCores;
  const schedulerWidth = getCpuSchedulerWidth(state, targetCpuId);

  if (ordered.length < requiredCores) return [];

  const wantedCores = Math.min(
    task.maxCores ?? requiredCores,
    task.parallelizable ? ordered.length : requiredCores,
    task.parallelizable && (state.flags.basicQueue || state.flags.scheduler)
      ? Math.max(requiredCores, schedulerWidth)
      : ordered.length,
  );

  return ordered.slice(0, Math.max(requiredCores, wantedCores));
};

const getDeadlockReason = (resource: DeadlockResource) =>
  resource === "cache" ? "Deadlock: cache full." : "Deadlock: RAM full.";

const getRamDeadlockOperation = (state: GameState) =>
  state.activeTasks
    .flatMap((task) => task.coreOperations)
    .find(
      (operation) =>
        operation.status === "deadlocked" && operation.lockResource === "ram",
    ) ?? null;

const getCacheDeadlockedCpuIds = (state: GameState) =>
  new Set(
    state.activeTasks
      .flatMap((task) => task.coreOperations)
      .filter(
        (operation) =>
          operation.status === "deadlocked" && operation.lockResource === "cache",
      )
      .map((operation) => getCpuIdForCore(state, operation.coreId)),
  );

const getDeadlockScopeResource = (
  state: GameState,
  activeTask: ActiveTask,
): DeadlockResource | null => {
  if (getRamDeadlockOperation(state)) return "ram";
  return getCacheDeadlockedCpuIds(state).has(getCpuIdForCore(state, activeTask.coreId))
    ? "cache"
    : null;
};

const schedulerCanDispatchOnCpu = (state: GameState, cpuId: number) =>
  canAcceptPoweredWork(state) &&
  !isDeadlockStartBlocked(state) &&
  !getRamDeadlockOperation(state) && !getCacheDeadlockedCpuIds(state).has(cpuId);

const idleCoreOperation = (
  coreId: number,
  operationIndex: number,
  workUnitIndex: number | null = null,
): ActiveCoreOperation => ({
  coreId,
  workUnitIndex,
  operationIndex,
  operationId: null,
  operationName: null,
  status: "complete",
  memoryState: "idle",
  remainingCycles: ZERO_AMOUNT,
  totalCycles: ZERO_AMOUNT,
  remainingLoadCycles: ZERO_AMOUNT,
  totalLoadCycles: ZERO_AMOUNT,
  memoryReservedBits: 0,
  memoryReservedBytes: 0,
  ramBlocks: [],
  ramChannelCount: 1,
  lockResource: null,
  lockReason: null,
  deadlockSeconds: 0,
});

const getTotalRamBlockBits = (operation: ActiveCoreOperation) =>
  (operation.ramBlocks ?? []).reduce(
    (total, block) => total + Math.max(0, block.lengthBits),
    0,
  );

const beginRamLoadOperation = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
  operationDefinition: TaskOperationDefinition,
  remainingCycles: ActiveCoreOperation["remainingCycles"],
  ramLoadCycles: ActiveCoreOperation["remainingLoadCycles"],
  totalLoadCycles: ActiveCoreOperation["totalLoadCycles"],
): ActiveCoreOperation => {
  const allocated = allocateRamBlocksForOperation(
    state,
    task,
    operation,
    operationDefinition.ramBits,
  );

  if (!allocated) {
    return deadlockLoadOperation(operation, "ram", {
      status: "loadingRam",
      memoryState: "ramLoad",
      remainingCycles,
      totalCycles: amountMax(remainingCycles, operation.totalCycles),
      remainingLoadCycles: ramLoadCycles,
      totalLoadCycles,
      memoryReservedBits: getTotalRamBlockBits(operation),
      memoryReservedBytes: bitsToBytes(getTotalRamBlockBits(operation)),
    });
  }

  const loadedBits = allocated.blocks.reduce(
    (total, block) => total + block.loadedBits,
    0,
  );

  return {
    ...operation,
    operationId: operationDefinition.id,
    operationName: operationDefinition.name,
    status: "loadingRam",
    memoryState: "ramLoad",
    remainingCycles,
    totalCycles: amountMax(remainingCycles, operation.totalCycles),
    remainingLoadCycles: amountClampMin(
      amountSubtract(ramLoadCycles, loadedBits),
    ),
    totalLoadCycles,
    memoryReservedBits: operationDefinition.ramBits,
    memoryReservedBytes: operationDefinition.ramBytes,
    ramBlocks: allocated.blocks,
    ramChannelCount: allocated.channelCount,
    lockResource: null,
    lockReason: null,
    deadlockSeconds: 0,
  };
};

const applyRamBlockLoadDeltas = (
  operation: ActiveCoreOperation,
  deltas: number[],
  scale = 1,
) =>
  (operation.ramBlocks ?? []).map((block, index) => ({
    ...block,
    loadedBits: Math.min(
      block.lengthBits,
      block.loadedBits + Math.max(0, deltas[index] ?? 0) * scale,
    ),
  }));

const enterOperation = (
  state: GameState,
  task: ActiveTask,
  coreOperation: ActiveCoreOperation,
  operationIndex: number,
): ActiveCoreOperation => {
  const operation = getOperation(task, operationIndex);

  if (!operation) {
    const retainedRamBlocks = coreOperation.ramBlocks ?? [];
    const retainedRamBits =
      retainedRamBlocks.length > 0
        ? coreOperation.memoryReservedBits
        : 0;

    return {
      ...coreOperation,
      operationIndex,
      operationId: null,
      operationName: null,
      status: "complete",
      memoryState: retainedRamBits > 0 ? "ready" : "idle",
      remainingCycles: ZERO_AMOUNT,
      totalCycles: ZERO_AMOUNT,
      remainingLoadCycles: ZERO_AMOUNT,
      totalLoadCycles: ZERO_AMOUNT,
      memoryReservedBits: retainedRamBits,
      memoryReservedBytes: bitsToBytes(retainedRamBits),
      ramBlocks: retainedRamBlocks,
      ramChannelCount:
        retainedRamBits > 0 ? Math.max(1, coreOperation.ramChannelCount) : 1,
      lockResource: null,
      lockReason: null,
      deadlockSeconds: 0,
    };
  }

  const taskDefinition = getTaskDefinition(task.taskId);
  const batchOwner = task.parentTaskId
    ? getTaskDefinition(task.parentTaskId)
    : taskDefinition;
  const batchMultiplier = normalizeTaskBatchMultiplier(
    task.batchMultiplier,
    batchOwner.aggregateBatch?.maximumMultiplier ?? 1,
  );
  const operationCycles = amountMultiply(operation.cycles, batchMultiplier);

  if (operation.kind === "barrier" && isChunkedTask(taskDefinition)) {
    return enterOperation(state, task, coreOperation, operationIndex + 1);
  }

  if (!isOperationAssignedToCore(task, operation, coreOperation.coreId)) {
    return {
      ...coreOperation,
      operationIndex,
      operationId: operation.id,
      operationName: operation.name,
      status: "waitingBarrier",
      memoryState: "idle",
      remainingCycles: ZERO_AMOUNT,
      totalCycles: operationCycles,
      remainingLoadCycles: ZERO_AMOUNT,
      totalLoadCycles: ZERO_AMOUNT,
      memoryReservedBits: 0,
      memoryReservedBytes: 0,
      ramBlocks: [],
      ramChannelCount: 1,
      lockResource: null,
      lockReason: null,
      deadlockSeconds: 0,
    };
  }

  if (operation.kind === "barrier") {
    return {
      ...coreOperation,
      operationIndex,
      operationId: operation.id,
      operationName: operation.name,
      status: "waitingBarrier",
      memoryState: "idle",
      remainingCycles: ZERO_AMOUNT,
      totalCycles: operationCycles,
      remainingLoadCycles: ZERO_AMOUNT,
      totalLoadCycles: ZERO_AMOUNT,
      memoryReservedBits: 0,
      memoryReservedBytes: 0,
      ramBlocks: [],
      ramChannelCount: 1,
      lockResource: null,
      lockReason: null,
      deadlockSeconds: 0,
    };
  }

  const operationRamBits = operation.ramBits;
  const operationRamBytes = operation.ramBytes;
  const retainedRamBits =
    operationRamBits > 0 &&
    coreOperation.memoryState === "ready" &&
    coreOperation.memoryReservedBits >= operationRamBits
      ? operationRamBits
      : 0;
  const retainedRamBlocks =
    retainedRamBits > 0 ? coreOperation.ramBlocks ?? [] : [];
  const retainedRamChannelCount =
    retainedRamBits > 0 ? Math.max(1, coreOperation.ramChannelCount) : 1;

  const cacheLoadCycles = amountMultiply(
    getCacheLoadCycles(state, operation),
    batchMultiplier,
  );
  const ramLoadCycles = amountMultiply(
    retainedRamBits >= operationRamBits
      ? 0
      : getRamLoadCycles(state, operation),
    batchMultiplier,
  );
  const totalLoadCycles = amountAdd(cacheLoadCycles, ramLoadCycles);

  if (amountCompare(cacheLoadCycles, ZERO_AMOUNT) > 0) {
    return {
      ...coreOperation,
      operationIndex,
      operationId: operation.id,
      operationName: operation.name,
      status: "loadingCache",
      memoryState:
        operationRamBits > 0 && retainedRamBits >= operationRamBits
          ? "ready"
          : "cacheLoad",
      remainingCycles: operationCycles,
      totalCycles: operationCycles,
      remainingLoadCycles: cacheLoadCycles,
      totalLoadCycles,
      memoryReservedBits: retainedRamBits,
      memoryReservedBytes: bitsToBytes(retainedRamBits),
      ramBlocks: retainedRamBlocks,
      ramChannelCount: retainedRamChannelCount,
      lockResource: null,
      lockReason: null,
      deadlockSeconds: 0,
    };
  }

  if (amountCompare(ramLoadCycles, ZERO_AMOUNT) > 0) {
    return beginRamLoadOperation(
      state,
      task,
      {
        ...coreOperation,
        operationIndex,
        operationId: operation.id,
        operationName: operation.name,
        remainingCycles: operationCycles,
        totalCycles: operationCycles,
        memoryReservedBits: 0,
        memoryReservedBytes: 0,
        ramBlocks: [],
        ramChannelCount: 1,
      },
      operation,
      operationCycles,
      ramLoadCycles,
      totalLoadCycles,
    );
  }

  return {
    ...coreOperation,
    operationIndex,
    operationId: operation.id,
    operationName: operation.name,
    status: "running",
    memoryState: "ready",
    remainingCycles: operationCycles,
    totalCycles: operationCycles,
    remainingLoadCycles: ZERO_AMOUNT,
    totalLoadCycles,
    memoryReservedBits: operationRamBits,
    memoryReservedBytes: operationRamBytes,
    ramBlocks: retainedRamBlocks,
    ramChannelCount: retainedRamChannelCount,
    lockResource: null,
    lockReason: null,
    deadlockSeconds: 0,
  };
};

const createActiveTask = (
  state: GameState,
  taskId: TaskId,
  assignedCoreIds: number[],
  schedulerQueued = false,
  entry: Partial<
    Pick<
      ActiveTask,
      | "queueEntryId"
      | "parentQueueEntryId"
      | "parentTaskId"
      | "childTaskId"
      | "workOrigin"
      | "batchMultiplier"
      | "projectedRewardCredits"
      | "projectedWorkCycles"
      | "projectedWorkCycles"
    >
  > = {},
): [GameState, ActiveTask] => {
  const taskDefinition = getTaskDefinition(taskId);
  const projection = getTaskBatchProjection(state, taskDefinition);
  const batchOwner = entry.parentTaskId
    ? getTaskDefinition(entry.parentTaskId)
    : taskDefinition;
  const batchMultiplier = normalizeTaskBatchMultiplier(
    entry.batchMultiplier ?? projection.multiplier,
    batchOwner.aggregateBatch?.maximumMultiplier ?? 1,
  );
  const projectedRewardCredits = getStoredTaskRewardCredits(
    taskDefinition,
    entry.projectedRewardCredits ?? projection.rewardCredits,
    batchMultiplier,
  );
  const projectedWorkCycles = getStoredTaskWorkCycles(
    taskDefinition,
    entry.projectedWorkCycles ?? projection.workCycles,
    batchMultiplier,
  );
  const instanceId = `task-${state.nextInstanceId}`;
  const primaryCoreId = assignedCoreIds[0] ?? 1;
  const shell: ActiveTask = {
    instanceId,
    taskId,
    jobId: taskId,
    systemId: state.selectedSystemId,
    queueEntryId: entry.queueEntryId ?? null,
    parentQueueEntryId: entry.parentQueueEntryId ?? null,
    parentTaskId: entry.parentTaskId ?? null,
    childTaskId: entry.childTaskId ?? null,
    workOrigin: entry.workOrigin,
    schedulerQueued,
    coreId: primaryCoreId,
    assignedCoreIds,
    batchMultiplier,
    projectedRewardCredits,
    projectedWorkCycles,
    workUnitsTotal: isChunkedTask(taskDefinition)
      ? taskDefinition.workUnitCount
      : undefined,
    workUnitsStarted: isChunkedTask(taskDefinition)
      ? Math.min(assignedCoreIds.length, taskDefinition.workUnitCount)
      : undefined,
    workUnitsCompleted: isChunkedTask(taskDefinition) ? 0 : undefined,
    workUnitsPending: isChunkedTask(taskDefinition)
      ? Array.from(
          {
            length: Math.max(
              0,
              taskDefinition.workUnitCount -
                Math.min(assignedCoreIds.length, taskDefinition.workUnitCount),
            ),
          },
          (_, index) =>
            Math.min(assignedCoreIds.length, taskDefinition.workUnitCount) + index,
        )
      : undefined,
    coreOperations: [],
    remainingCycles: projectedWorkCycles,
    totalCycles: projectedWorkCycles,
  };
  const coreOperations: ActiveCoreOperation[] = [];

  assignedCoreIds.forEach((coreId, index) => {
    const workUnitIndex = isChunkedTask(taskDefinition) ? index : null;
    const seeded = idleCoreOperation(coreId, 0, workUnitIndex);
    const stagedTask = { ...shell, coreOperations };
    const stagedState = {
      ...state,
      activeTasks: [...state.activeTasks, stagedTask],
    };
    coreOperations.push(enterOperation(stagedState, stagedTask, seeded, 0));
  });

  return [
    { ...state, nextInstanceId: state.nextInstanceId + 1 },
    refreshTaskTotals({ ...shell, coreOperations }),
  ];
};

const assignTaskToCores = (
  state: GameState,
  taskId: TaskId,
  preferredCoreId?: number,
  cpuId?: number,
  schedulerQueued = false,
  maxCoreCount = Number.POSITIVE_INFINITY,
  entry: Partial<
    Pick<
      ActiveTask,
      | "queueEntryId"
      | "parentQueueEntryId"
      | "parentTaskId"
      | "childTaskId"
      | "workOrigin"
      | "batchMultiplier"
      | "projectedRewardCredits"
    >
  > = {},
): GameState => {
  const task = getTaskDefinition(taskId);
  const systemWideChunked =
    preferredCoreId === undefined &&
    cpuId === undefined &&
    isChunkedSystemTask(task);
  const targetCpuId = systemWideChunked
    ? undefined
    : selectCpuIdForTask(state, task, preferredCoreId, cpuId);
  if (!systemWideChunked && targetCpuId === undefined) return state;
  if (!canStartTask(state, taskId, targetCpuId)) return state;

  const assignedCoreIds = selectCoreIdsForTask(
    state,
    task,
    preferredCoreId,
    targetCpuId,
    maxCoreCount,
  );
  if (assignedCoreIds.length === 0) return state;

  const [nextState, activeTask] = createActiveTask(
    state,
    taskId,
    assignedCoreIds,
    schedulerQueued,
    entry,
  );

  return syncCoreSchedulers({
    ...nextState,
    activeTasks: [...nextState.activeTasks, activeTask],
    activeJobs: [...nextState.activeTasks, activeTask],
  });
};

const assignTaskToIdleCores = (
  state: GameState,
  taskId: TaskId,
  cpuId?: number,
  schedulerQueued = false,
  maxCoreCount = Number.POSITIVE_INFINITY,
  entry: Partial<
    Pick<
      ActiveTask,
      | "queueEntryId"
      | "parentQueueEntryId"
      | "parentTaskId"
      | "childTaskId"
      | "workOrigin"
      | "batchMultiplier"
      | "projectedRewardCredits"
    >
  > = {},
): GameState =>
  assignTaskToCores(
    state,
    taskId,
    undefined,
    cpuId,
    schedulerQueued,
    maxCoreCount,
    entry,
  );

const selectQueueCoreId = (
  state: GameState,
  cpuId?: number,
  slotCount = 1,
  options: { allowBlockedDispatch?: boolean; task?: TaskDefinition } = {},
): number | undefined => {
  const canUseCpu = (candidateCpuId: number) =>
    getAvailableSchedulerSlots(state, candidateCpuId) >= slotCount &&
    (options.task === undefined ||
      cpuCanEverProvisionTask(state, options.task, candidateCpuId)) &&
    (options.allowBlockedDispatch || schedulerCanDispatchOnCpu(state, candidateCpuId));
  const candidateCoreIds =
    cpuId === undefined
      ? state.hardware.cpus
          .filter((cpu) => canUseCpu(cpu.id))
          .flatMap((cpu) => cpu.coreIds)
      : canUseCpu(cpuId)
        ? getCpuHardware(state, cpuId).coreIds
        : [];
  const schedulers = candidateCoreIds
    .map((coreId) => state.coreSchedulers[coreId])
    .filter((scheduler): scheduler is NonNullable<typeof scheduler> =>
      Boolean(scheduler),
    );
  // No usable scheduler means the reservation has no legal home; callers must
  // fail the reservation instead of silently parking entries on core 1
  // (possibly a different CPU), which produced permanent orphans (F-SCH-1).
  if (schedulers.length === 0) return undefined;

  return schedulers.reduce((best, candidate) =>
    candidate.localQueue.length < best.localQueue.length ? candidate : best,
  ).coreId;
};

/**
 * Picks the CPU a new top-level reservation should be parked on. Prefers a
 * CPU the scheduler could dispatch to right now, but falls back to any CPU
 * that can ever provision the task — reservations are legal while dispatch is
 * deadlock-blocked (reserveReadySystemChildWork already relies on this), and
 * they dispatch once the lockout clears.
 */
const selectReservationCpuId = (
  state: GameState,
  task: TaskDefinition,
  slotCount: number,
) => {
  const coreId =
    selectQueueCoreId(state, undefined, slotCount, { task }) ??
    selectQueueCoreId(state, undefined, slotCount, {
      task,
      allowBlockedDispatch: true,
    });
  return coreId === undefined ? undefined : getCpuIdForCore(state, coreId);
};

const reserveTaskOnCpuScheduler = (
  state: GameState,
  taskId: TaskId,
  cpuId: number,
  slotCount = getSchedulerSlotReservationCount(getTaskDefinition(taskId)),
  options: QueueEntryOptions & { allowBlockedDispatch?: boolean } = {},
) => {
  const reservedSlots = Math.max(1, Math.trunc(slotCount));
  if (getAvailableSchedulerSlots(state, cpuId) < reservedSlots) return state;

  const task = getTaskDefinition(taskId);
  const coreId = selectQueueCoreId(state, cpuId, reservedSlots, {
    allowBlockedDispatch: options.allowBlockedDispatch,
    task,
  });
  if (coreId === undefined) return state;
  const scheduler = state.coreSchedulers[coreId] ?? createCoreSchedulerState(coreId);
  const firstQueueEntrySequence = getNextQueueEntryNumber(state, "cpu");
  const reservationId =
    options.reservationId ?? getQueueEntryId("cpu", firstQueueEntrySequence);
  const queueEntries = Array.from({ length: reservedSlots }, (_, index) =>
    createQueueEntry(
      state,
      task,
      "cpu",
      {
        ...options,
        reservationId,
        id: getQueueEntryId("cpu", firstQueueEntrySequence + index),
        childTaskId: options.childTaskId ?? (options.parentTaskId ? task.id : null),
        childTaskName:
          options.childTaskName ?? (options.parentTaskId ? task.name : null),
      },
      firstQueueEntrySequence + index,
    ),
  );

  return syncCoreSchedulers({
    ...state,
    coreSchedulers: {
      ...state.coreSchedulers,
      [coreId]: {
        ...scheduler,
        localQueue: [
          ...scheduler.localQueue,
          ...Array.from({ length: reservedSlots }, () => taskId),
        ],
        localQueueEntries: [
          ...(scheduler.localQueueEntries ?? []),
          ...queueEntries,
        ],
      },
    },
  });
};

const enqueueTask = (
  state: GameState,
  taskId: TaskId,
  cpuId?: number,
  workOrigin?: WorkOrigin,
) => {
  if (!canQueueTask(state, taskId, cpuId)) return state;
  const task = getTaskDefinition(taskId);

  if (isSystemScheduledTask(task)) {
    const queueEntry = createQueueEntry(state, task, "system", {
      totalChildCount: getSystemChildWorkUnits(task).length,
      completedChildKeys: [],
      workOrigin,
    });
    return syncCoreSchedulers({
      ...state,
      queue: [...state.queue, taskId],
      queueEntries: [...(state.queueEntries ?? []), queueEntry],
    });
  }

  const schedulerSlotCount = getSchedulerSlotReservationCount(task);
  const queueEntry = createQueueEntry(state, task, "cpu", { workOrigin });
  const targetCpuId =
    cpuId ?? selectReservationCpuId(state, task, schedulerSlotCount);
  if (targetCpuId === undefined) return state;

  const staged: GameState = {
    ...state,
    queue: [...state.queue, taskId],
    queueEntries: [...(state.queueEntries ?? []), queueEntry],
  };
  const reserved = reserveTaskOnCpuScheduler(
    staged,
    taskId,
    targetCpuId,
    schedulerSlotCount,
    {
      reservationId: queueEntry.id,
      workOrigin,
      batchMultiplier: queueEntry.batchMultiplier,
      projectedRewardCredits: queueEntry.projectedRewardCredits,
      allowBlockedDispatch: true,
    },
  );

  // A reservation that no-ops must not commit the top-level entry — an entry
  // without a matching local reservation can never dispatch (F-SCH-1).
  return reserved === staged ? state : reserved;
};

const removeQueuedTaskFromLocalScheduler = (
  state: GameState,
  taskId: TaskId,
  occurrenceIndex = 0,
  slotCount = getSchedulerSlotReservationCount(getTaskDefinition(taskId)),
): GameState => {
  let slotsToSkip = Math.max(0, occurrenceIndex) * Math.max(1, slotCount);
  let slotsToRemove = Math.max(1, slotCount);
  const coreSchedulers = Object.fromEntries(
    Object.entries(state.coreSchedulers).map(([rawCoreId, scheduler]) => [
      rawCoreId,
      (() => {
        const keptEntryIndexes = new Set<number>();
        const localQueue = scheduler.localQueue.filter((queuedTaskId, index) => {
          if (queuedTaskId !== taskId || slotsToRemove <= 0) {
            keptEntryIndexes.add(index);
            return true;
          }
          if (slotsToSkip > 0) {
            slotsToSkip -= 1;
            keptEntryIndexes.add(index);
            return true;
          }
          if (slotsToRemove > 0) {
            slotsToRemove -= 1;
            return false;
          }
          keptEntryIndexes.add(index);
          return true;
        });
        const localQueueEntries = (scheduler.localQueueEntries ?? []).filter(
          (_entry, index) => keptEntryIndexes.has(index),
        );

        return {
          ...scheduler,
          localQueue,
          localQueueEntries,
        };
      })(),
    ]),
  );

  if (slotsToRemove >= Math.max(1, slotCount)) return state;

  return {
    ...state,
    coreSchedulers,
  };
};

const removeQueuedTaskReservation = (
  state: GameState,
  taskId: TaskId,
  occurrenceIndex = 0,
  slotCount = getSchedulerSlotReservationCount(getTaskDefinition(taskId)),
): GameState => {
  let seen = 0;
  const keptQueueIndexes = new Set<number>();
  const queue = state.queue.filter((queuedTaskId, index) => {
    if (queuedTaskId !== taskId) return true;
    if (seen === occurrenceIndex) {
      seen += 1;
      return false;
    }
    seen += 1;
    keptQueueIndexes.add(index);
    return true;
  });
  state.queue.forEach((queuedTaskId, index) => {
    if (queuedTaskId !== taskId) keptQueueIndexes.add(index);
  });

  return removeQueuedTaskFromLocalScheduler(
    {
      ...state,
      queue,
      queueEntries: (state.queueEntries ?? []).filter((_entry, index) =>
        keptQueueIndexes.has(index),
      ),
    },
    taskId,
    occurrenceIndex,
    slotCount,
  );
};

const removeLocalQueueReservationById = (
  state: GameState,
  reservationId: string,
): GameState => ({
  ...state,
  coreSchedulers: Object.fromEntries(
    Object.entries(state.coreSchedulers).map(([rawCoreId, scheduler]) => {
      const keptIndexes = new Set<number>();
      const localQueueEntries = (scheduler.localQueueEntries ?? []).filter(
        (entry, index) => {
          const entryReservationId = entry.reservationId ?? entry.id;
          const keep = entryReservationId !== reservationId && entry.id !== reservationId;
          if (keep) keptIndexes.add(index);
          return keep;
        },
      );
      const localQueue = scheduler.localQueue.filter((_taskId, index) =>
        keptIndexes.has(index),
      );

      return [
        rawCoreId,
        {
          ...scheduler,
          localQueue,
          localQueueEntries,
        },
      ];
    }),
  ) as GameState["coreSchedulers"],
});

const removeLocalQueueReservationsForParent = (
  state: GameState,
  parentQueueEntryId: string,
): GameState => ({
  ...state,
  coreSchedulers: Object.fromEntries(
    Object.entries(state.coreSchedulers).map(([rawCoreId, scheduler]) => {
      const keptIndexes = new Set<number>();
      const localQueueEntries = (scheduler.localQueueEntries ?? []).filter(
        (entry, index) => {
          const keep = entry.parentQueueEntryId !== parentQueueEntryId;
          if (keep) keptIndexes.add(index);
          return keep;
        },
      );
      const localQueue = scheduler.localQueue.filter((_taskId, index) =>
        keptIndexes.has(index),
      );

      return [
        rawCoreId,
        {
          ...scheduler,
          localQueue,
          localQueueEntries,
        },
      ];
    }),
  ) as GameState["coreSchedulers"],
});

const removeTopLevelQueueEntryById = (
  state: GameState,
  queueEntryId: string,
): GameState => {
  const queueEntries = state.queueEntries ?? [];
  const index = queueEntries.findIndex((entry) => entry.id === queueEntryId);
  if (index < 0) return state;

  return {
    ...state,
    queue: state.queue.filter((_taskId, queueIndex) => queueIndex !== index),
    queueEntries: queueEntries.filter((_entry, queueIndex) => queueIndex !== index),
  };
};

const getActiveTaskQueueOccurrenceIndex = (
  state: GameState,
  taskIndex: number,
) => {
  const activeTask = state.activeTasks[taskIndex];
  if (!activeTask?.schedulerQueued) return 0;

  return state.activeTasks
    .slice(0, taskIndex + 1)
    .filter(
      (candidate) =>
        candidate.schedulerQueued && candidate.taskId === activeTask.taskId,
    ).length - 1;
};

const cancelSystemParentReservation = (
  state: GameState,
  parentQueueEntryId: string,
): GameState => {
  const withoutChildren = {
    ...state,
    activeTasks: state.activeTasks.filter(
      (task) => task.parentQueueEntryId !== parentQueueEntryId,
    ),
  };
  const withoutJobs = {
    ...withoutChildren,
    activeJobs: withoutChildren.activeTasks,
  };
  const withoutLocal = removeLocalQueueReservationsForParent(
    withoutJobs,
    parentQueueEntryId,
  );
  return removeTopLevelQueueEntryById(withoutLocal, parentQueueEntryId);
};

const cancelSystemChildWorkUnit = (
  state: GameState,
  activeTask: ActiveTask,
): GameState => {
  const activeTasks = state.activeTasks.filter(
    (task) => task.instanceId !== activeTask.instanceId,
  );
  const withoutActive: GameState = {
    ...state,
    activeTasks,
    activeJobs: activeTasks,
    cacheResidency: [],
  };

  return activeTask.queueEntryId
    ? removeLocalQueueReservationById(withoutActive, activeTask.queueEntryId)
    : withoutActive;
};

const cancelActiveTask = (
  state: GameState,
  taskId: TaskId,
  instanceId?: string,
) => {
  const taskIndex = state.activeTasks.findIndex(
    (task) =>
      (instanceId !== undefined || task.taskId === taskId) &&
      (instanceId === undefined || task.instanceId === instanceId),
  );
  if (taskIndex < 0) return state;

  const activeTask = state.activeTasks[taskIndex];
  if (!activeTask) return state;

  if (activeTask.parentQueueEntryId) {
    return pullQueue(
      updateProgressionFlags(
        cancelSystemParentReservation(state, activeTask.parentQueueEntryId),
      ),
    );
  }

  const occurrenceIndex = getActiveTaskQueueOccurrenceIndex(state, taskIndex);
  const activeTasks = state.activeTasks.filter((_, index) => index !== taskIndex);
  const withoutActive: GameState = {
    ...state,
    activeTasks,
    activeJobs: activeTasks,
    cacheResidency: [],
  };
  const released = activeTask.schedulerQueued
    ? activeTask.queueEntryId
      ? removeLocalQueueReservationById(
          removeTopLevelQueueEntryById(withoutActive, activeTask.queueEntryId),
          activeTask.queueEntryId,
        )
      : removeQueuedTaskReservation(
          withoutActive,
          activeTask.taskId,
          occurrenceIndex,
          getSchedulerSlotReservationCount(
            getTaskDefinition(activeTask.taskId),
            activeTask.assignedCoreIds,
          ),
        )
    : withoutActive;

  return pullQueue(updateProgressionFlags(released));
};

const cancelQueuedTask = (state: GameState, taskId: TaskId) => {
  const queueIndex = state.queue.findIndex(
    (queuedTaskId, index) =>
      queuedTaskId === taskId && !isQueueEntryReservedByActiveTask(state, state.queue, index),
  );
  if (queueIndex < 0) return state;

  const queueEntry = state.queueEntries?.[queueIndex];
  if (queueEntry?.target === "system") {
    return pullQueue(
      updateProgressionFlags(cancelSystemParentReservation(state, queueEntry.id)),
    );
  }

  const occurrenceIndex = getQueueOccurrenceIndex(state.queue, taskId, queueIndex);
  if (queueEntry?.id) {
    return pullQueue(
      updateProgressionFlags(
        removeLocalQueueReservationById(
          removeTopLevelQueueEntryById(state, queueEntry.id),
          queueEntry.id,
        ),
      ),
    );
  }

  return pullQueue(
    updateProgressionFlags(
      removeQueuedTaskReservation(state, taskId, occurrenceIndex),
    ),
  );
};

export const cancelTask = (
  state: GameState,
  taskId: TaskId,
  instanceId?: string,
  coreId?: number,
) => {
  if (isSystemManaged(state, state.selectedSystemId)) return state;
  const activeTask = state.activeTasks.find(
    (task) =>
      (instanceId === undefined
        ? task.taskId === taskId || task.parentTaskId === taskId
        : task.instanceId === instanceId),
  );

  if (!activeTask) return cancelQueuedTask(state, taskId);

  if (coreId !== undefined && isChunkedTask(getTaskDefinition(activeTask.taskId))) {
    return requeueChunkedWorkUnit(state, activeTask, "ram", coreId) ?? state;
  }

  if (
    coreId !== undefined &&
    activeTask.parentTaskId &&
    isChunkedTask(getTaskDefinition(activeTask.parentTaskId))
  ) {
    return pullQueue(
      updateProgressionFlags(cancelSystemChildWorkUnit(state, activeTask)),
    );
  }

  return cancelActiveTask(state, taskId, instanceId);
};

const getQueueOccurrenceIndex = (
  queue: TaskId[],
  taskId: TaskId,
  queueIndex: number,
) =>
  queue
    .slice(0, queueIndex + 1)
    .filter((queuedTaskId) => queuedTaskId === taskId).length - 1;

const getSchedulerQueuedActiveCount = (state: GameState, taskId: TaskId) =>
  state.activeTasks.filter(
    (activeTask) => activeTask.schedulerQueued && activeTask.taskId === taskId,
  ).length;

const isQueueEntryReservedByActiveTask = (
  state: GameState,
  queue: TaskId[],
  queueIndex: number,
) => {
  const taskId = queue[queueIndex];
  if (!taskId) return false;

  const queueEntry = state.queueEntries?.[queueIndex];
  if (queueEntry?.target === "system" && queueEntry.id) {
    return state.activeTasks.some(
      (task) => task.parentQueueEntryId === queueEntry.id,
    );
  }
  if (queueEntry?.id) {
    return state.activeTasks.some(
      (task) => task.queueEntryId === queueEntry.id,
    );
  }

  return (
    getQueueOccurrenceIndex(queue, taskId, queueIndex) <
    getSchedulerQueuedActiveCount(state, taskId)
  );
};

const getQueuedSystemChildRamBits = (state: GameState) => {
  const seenReservations = new Set<string>();
  const activeReservations = new Set(
    state.activeTasks
      .map((task) => task.queueEntryId)
      .filter((id): id is string => Boolean(id)),
  );

  return Object.values(state.coreSchedulers).reduce((total, scheduler) => {
    return (
      total +
      (scheduler.localQueueEntries ?? []).reduce((sum, entry) => {
        if (!entry.parentQueueEntryId) return sum;
        const reservationId = entry.reservationId ?? entry.id;
        if (seenReservations.has(reservationId)) return sum;
        if (activeReservations.has(reservationId)) return sum;
        seenReservations.add(reservationId);
        return sum + getTaskDefinition(entry.taskId).ramNeedBits;
      }, 0)
    );
  }, 0);
};

const getSystemAdmissionAvailableRamBits = (state: GameState) =>
  Math.max(
    0,
    getMemoryCapacityBits(state) -
      getActiveMemoryFootprintBits(state) -
      getQueuedSystemChildRamBits(state),
  );

interface SystemChildCpuCandidate {
  cpuId: number;
  speedHz: number;
  coreCapacity: number;
  queuedSlots: number;
  queuedSeconds: number;
  cacheHeadroomBits: number;
  availableCoreCount: number;
  index: number;
}

const getCpuLocalQueueEntries = (state: GameState, cpuId: number) =>
  getCpuHardware(state, cpuId).coreIds.flatMap(
    (coreId) => state.coreSchedulers[coreId]?.localQueueEntries ?? [],
  );

const getQueuedCpuReservationDefinitions = (state: GameState, cpuId: number) => {
  const seenReservations = new Set<string>();

  return getCpuLocalQueueEntries(state, cpuId).flatMap((entry) => {
    const reservationId = entry.reservationId ?? entry.id;
    if (seenReservations.has(reservationId)) return [];
    seenReservations.add(reservationId);
    return [getTaskDefinition(entry.taskId)];
  });
};

const getQueuedCpuSeconds = (state: GameState, cpuId: number) =>
  getQueuedCpuReservationDefinitions(state, cpuId).reduce(
    (total, task) =>
      total +
      estimateTaskSeconds(
        state,
        task,
        getCpuHardware(state, cpuId).coreIds[0] ?? 1,
      ),
    0,
  );

const getQueuedCpuCacheFootprintBits = (state: GameState, cpuId: number) =>
  getQueuedCpuReservationDefinitions(state, cpuId).reduce(
    (total, task) => total + task.cacheNeedBits,
    0,
  );

const getSystemChildCpuCandidates = (
  state: GameState,
  task: TaskDefinition,
) => {
  const slotCount = getSchedulerSlotReservationCount(task);

  return state.hardware.cpus.flatMap((cpu, index): SystemChildCpuCandidate[] => {
    const normalizedCpu = getCpuHardware(state, cpu.id);
    if (getAvailableSchedulerSlots(state, normalizedCpu.id) < slotCount) return [];
    // Never park a child on a CPU that can't ever provision it: dispatch
    // requires minCores idle cores and cache fit on this exact CPU, and local
    // entries are not migrated afterwards (C-SIM-4 / F-SCH-2).
    if (!cpuCanEverProvisionTask(state, task, normalizedCpu.id)) return [];

    const queuedSlots = getCpuLocalQueueEntries(state, normalizedCpu.id).length;
    const queuedCacheBits = getQueuedCpuCacheFootprintBits(
      state,
      normalizedCpu.id,
    );

    return [
      {
        cpuId: normalizedCpu.id,
        speedHz: getEffectiveCoreClockHz(
          state,
          normalizedCpu.coreIds[0] ?? 1,
        ),
        coreCapacity: normalizedCpu.coreIds.length,
        queuedSlots,
        queuedSeconds: getQueuedCpuSeconds(state, normalizedCpu.id),
        cacheHeadroomBits:
          normalizedCpu.cacheBits -
          getActiveCpuCacheFootprintBits(state, normalizedCpu.id) -
          queuedCacheBits,
        availableCoreCount: availableCoreIds(state, normalizedCpu.id).length,
        index,
      },
    ];
  });
};

const selectCpuIdForChildReservation = (
  state: GameState,
  task: TaskDefinition,
) => {
  const candidates = getSystemChildCpuCandidates(state, task);
  if (candidates.length === 0) return undefined;

  const priority = createSchedulerConfig(
    state.hardware.systemSchedulerConfig,
  ).cpuPriority;

  return candidates.reduce((best, candidate) => {
    if (priority === "speed" && candidate.speedHz !== best.speedHz) {
      return candidate.speedHz > best.speedHz ? candidate : best;
    }

    if (priority === "capacity") {
      if (candidate.coreCapacity !== best.coreCapacity) {
        return candidate.coreCapacity > best.coreCapacity ? candidate : best;
      }
      if (
        candidate.cacheHeadroomBits !== best.cacheHeadroomBits
      ) {
        return candidate.cacheHeadroomBits > best.cacheHeadroomBits
          ? candidate
          : best;
      }
    }

    if (priority === "parallelism") {
      if (candidate.queuedSlots !== best.queuedSlots) {
        return candidate.queuedSlots < best.queuedSlots ? candidate : best;
      }
      if (candidate.queuedSeconds !== best.queuedSeconds) {
        return candidate.queuedSeconds < best.queuedSeconds ? candidate : best;
      }
    }

    if (
      candidate.queuedSlots === best.queuedSlots &&
      candidate.availableCoreCount >= task.minCores &&
      best.availableCoreCount < task.minCores
    ) {
      return candidate;
    }

    return candidate.index < best.index &&
      candidate.queuedSlots === best.queuedSlots
      ? candidate
      : best;
  }).cpuId;
};

const canReserveSystemChildWork = (
  state: GameState,
  childTask: TaskDefinition,
) => {
  const ramSafe =
    childTask.ramNeedBits <= getSystemAdmissionAvailableRamBits(state);

  return ramSafe && selectCpuIdForChildReservation(state, childTask) !== undefined;
};

const reserveReadySystemChildWork = (state: GameState): GameState => {
  let nextState = state;
  let changed = true;
  let guard = 0;

  while (changed && guard < 200) {
    changed = false;
    guard += 1;

    const parentEntries = (nextState.queueEntries ?? []).filter((entry) => {
      if (entry.target !== "system") return false;
      return isSystemScheduledTask(getTaskDefinition(entry.taskId));
    });

    for (const parentEntry of parentEntries) {
      const parentTask = getTaskDefinition(parentEntry.taskId);
      const readyUnits = getReadyChildWorkUnits(nextState, parentEntry, parentTask);
      const unit = readyUnits[0];
      if (!unit) continue;

      const childTask = getTaskDefinition(unit.taskId);
      if (!canReserveSystemChildWork(nextState, childTask)) continue;
      const cpuId = selectCpuIdForChildReservation(nextState, childTask);
      if (cpuId === undefined) continue;

      const reserved = reserveTaskOnCpuScheduler(
        nextState,
        childTask.id,
        cpuId,
        getSchedulerSlotReservationCount(childTask),
        {
          parentTaskId: parentTask.id,
          parentTaskName: parentTask.name,
          parentQueueEntryId: parentEntry.id,
          childTaskId: childTask.id,
          childTaskName: childTask.name,
          workOrigin: parentEntry.workOrigin,
          compositionIndex: unit.compositionIndex,
          compositionRepeatIndex: unit.compositionRepeatIndex,
          workUnitIndex: unit.workUnitIndex,
          childWorkKey: unit.key,
          batchMultiplier: parentEntry.batchMultiplier,
          allowBlockedDispatch: true,
        },
      );

      if (reserved !== nextState) {
        nextState = reserved;
        changed = true;
      }
    }
  }

  return nextState;
};

interface CpuQueueDispatchCandidate {
  entry: TaskQueueEntry;
  reservationId: string;
  task: TaskDefinition;
  cpuId: number;
  rank: number;
  index: number;
}

const getCpuQueueEntries = (state: GameState) => {
  let index = 0;
  return Object.entries(state.coreSchedulers).flatMap(([rawCoreId, scheduler]) => {
    const coreId = Number(rawCoreId);
    const cpuId = getCpuIdForCore(state, coreId);
    return (scheduler.localQueueEntries ?? []).map((entry) => ({
      entry,
      cpuId,
      index: index++,
    }));
  });
};

const getActiveQueueReservationIds = (state: GameState) =>
  new Set(
    state.activeTasks
      .map((task) => task.queueEntryId)
      .filter((id): id is string => Boolean(id)),
  );

const canStartQueuedCpuEntry = (
  state: GameState,
  task: TaskDefinition,
  cpuId: number,
  systemOwned: boolean,
) =>
  canAcceptPoweredWork(state) &&
  !isDeadlockStartBlocked(state) &&
  taskFitsCpuHardware(state, task, cpuId) &&
  (systemOwned ||
    (canAcceptTask(state, task.id) &&
      // Legacy duplicate reservations of a non-repeatable task (from saves
      // predating the admission gate) must not dual-run alongside an active
      // copy; the settle path releases them instead (C-SIM-5).
      (task.repeatable ||
        !state.activeTasks.some(
          (activeTask) => activeTask.taskId === task.id,
        ))));

const canCpuQueueDispatchTask = (
  state: GameState,
  task: TaskDefinition,
  cpuId: number,
  systemOwned: boolean,
) => {
  return systemOwned
    ? taskFitsFreeCacheStaging(state, task, cpuId)
    : taskFitsFreeStaging(state, task, cpuId);
};

const selectCoreIdsForQueuedCpuEntry = (
  state: GameState,
  task: TaskDefinition,
  cpuId: number,
) => {
  const available = availableCoreIds(state, cpuId);
  const requiredCores = task.minCores;
  const schedulerWidth = getCpuSchedulerWidth(state, cpuId);
  const schedulerAvailable = state.flags.basicQueue || state.flags.scheduler;

  if (available.length < requiredCores) return [];
  if (requiredCores > 1 && !schedulerAvailable) return [];
  if (requiredCores > 1 && schedulerWidth < requiredCores) return [];

  const wantedCores = Math.min(
    task.maxCores ?? requiredCores,
    task.parallelizable && schedulerAvailable ? available.length : requiredCores,
    task.parallelizable && schedulerAvailable
      ? Math.max(requiredCores, schedulerWidth)
      : available.length,
  );

  return available.slice(0, Math.max(requiredCores, wantedCores));
};

const getCpuQueueDispatchCandidates = (state: GameState) => {
  const activeReservations = getActiveQueueReservationIds(state);
  const seenReservations = new Set<string>();

  return getCpuQueueEntries(state).flatMap(
    ({ entry, cpuId, index }): CpuQueueDispatchCandidate[] => {
      const reservationId = entry.reservationId ?? entry.id;
      if (seenReservations.has(reservationId)) return [];
      seenReservations.add(reservationId);
      if (activeReservations.has(reservationId)) return [];
      if (!schedulerCanDispatchOnCpu(state, cpuId)) return [];

      const task = getTaskDefinition(entry.taskId);
      const systemOwned = Boolean(entry.parentQueueEntryId);
      if (!canStartQueuedCpuEntry(state, task, cpuId, systemOwned)) return [];
      if (selectCoreIdsForQueuedCpuEntry(state, task, cpuId).length < task.minCores) {
        return [];
      }
      if (!canCpuQueueDispatchTask(state, task, cpuId, systemOwned)) {
        return [];
      }

      return [
        {
          entry,
          reservationId,
          task,
          cpuId,
          rank: index,
          index,
        },
      ];
    },
  );
};

/**
 * Why a waiting queue reservation cannot dispatch right now, in the same
 * order the dispatcher itself checks. Returns null for entries that are
 * already running or merely waiting their rank turn. Exposed so the UI can
 * label queued work that sits behind RAM/cache staging pressure instead of
 * showing an unexplained idle entry (F-PLAY-2).
 */
export const getQueueEntryDispatchBlockedReason = (
  state: GameState,
  queueEntryId: string,
): string | null => {
  const systemEntry = (state.queueEntries ?? []).find(
    (entry) => entry.id === queueEntryId && entry.target === "system",
  );
  if (systemEntry) {
    const parentTask = getTaskDefinition(systemEntry.taskId);
    const unit = getReadyChildWorkUnits(state, systemEntry, parentTask)[0];
    if (!unit) return null;

    const childTask = getTaskDefinition(unit.taskId);
    if (childTask.ramNeedBits > getSystemAdmissionAvailableRamBits(state)) {
      return "Waiting for free RAM staging.";
    }
    if (selectCpuIdForChildReservation(state, childTask) === undefined) {
      return "Waiting for CPU scheduler capacity.";
    }
    return null;
  }

  const located = getCpuQueueEntries(state).find(
    ({ entry }) =>
      entry.id === queueEntryId ||
      (entry.reservationId ?? entry.id) === queueEntryId,
  );
  if (!located) return null;

  const reservationId = located.entry.reservationId ?? located.entry.id;
  if (getActiveQueueReservationIds(state).has(reservationId)) return null;

  const task = getTaskDefinition(located.entry.taskId);
  const systemOwned = Boolean(located.entry.parentQueueEntryId);
  const cpuId = located.cpuId;

  if (!canAcceptPoweredWork(state)) return "System is powered off.";
  if (isDeadlockStartBlocked(state)) return "Deadlock recovery in progress.";
  if (!taskFitsCpuHardware(state, task, cpuId)) {
    return "This CPU cannot fit the task.";
  }
  if (!systemOwned && !canAcceptTask(state, task.id)) {
    return "Task requirements are no longer met.";
  }
  if (selectCoreIdsForQueuedCpuEntry(state, task, cpuId).length < task.minCores) {
    return "Waiting for idle cores.";
  }

  if (!taskFitsFreeCacheStaging(state, task, cpuId)) {
    return "Waiting for free cache staging.";
  }
  if (!systemOwned && !taskFitsFreeMemoryStaging(state, task)) {
    return "Waiting for free RAM staging.";
  }

  return null;
};

const selectCpuQueueDispatchCandidate = (state: GameState) => {
  const candidates = getCpuQueueDispatchCandidates(state);
  if (candidates.length === 0) return null;

  return candidates.reduce((best, candidate) => {
    if (candidate.rank < best.rank) return candidate;
    if (candidate.rank === best.rank && candidate.index < best.index) return candidate;
    return best;
  });
};

const assignCpuQueueCandidateToCores = (
  state: GameState,
  candidate: CpuQueueDispatchCandidate,
) => {
  const assignedCoreIds = selectCoreIdsForQueuedCpuEntry(
    state,
    candidate.task,
    candidate.cpuId,
  );
  if (assignedCoreIds.length === 0) return state;

  const [nextState, activeTask] = createActiveTask(
    state,
    candidate.task.id,
    assignedCoreIds,
    true,
    {
      queueEntryId: candidate.reservationId,
      parentQueueEntryId: candidate.entry.parentQueueEntryId ?? null,
      parentTaskId: candidate.entry.parentTaskId ?? null,
      childTaskId: candidate.entry.childTaskId ?? null,
      workOrigin: candidate.entry.workOrigin,
      batchMultiplier: candidate.entry.batchMultiplier,
      projectedRewardCredits: candidate.entry.projectedRewardCredits,
      projectedWorkCycles: candidate.entry.projectedWorkCycles,
    },
  );

  return syncCoreSchedulers({
    ...nextState,
    activeTasks: [...nextState.activeTasks, activeTask],
    activeJobs: [...nextState.activeTasks, activeTask],
  });
};

/**
 * Releases waiting local reservations parked on a CPU that can never provision
 * their task (hardware downgrades, or entries persisted before placement was
 * provisioning-checked). System-child units simply drop their reservation so
 * the parent re-reserves them on a capable CPU; direct entries migrate to a
 * capable CPU, or are released entirely when none exists (C-SIM-4 / F-SCH-2).
 */
const rehomeUnprovisionableReservations = (state: GameState): GameState => {
  const activeReservations = getActiveQueueReservationIds(state);
  const handledReservations = new Set<string>();
  let nextState = state;

  for (const { entry, cpuId } of getCpuQueueEntries(state)) {
    const reservationId = entry.reservationId ?? entry.id;
    if (handledReservations.has(reservationId)) continue;
    handledReservations.add(reservationId);
    if (activeReservations.has(reservationId)) continue;

    const task = getTaskDefinition(entry.taskId);
    if (cpuCanEverProvisionTask(nextState, task, cpuId)) continue;

    nextState = removeLocalQueueReservationById(nextState, reservationId);
    // System children re-reserve automatically once their work unit is free.
    if (entry.parentQueueEntryId) continue;

    const slotCount = getSchedulerSlotReservationCount(task);
    const targetCpuId = selectReservationCpuId(nextState, task, slotCount);
    const migrated =
      targetCpuId === undefined
        ? nextState
        : reserveTaskOnCpuScheduler(nextState, task.id, targetCpuId, slotCount, {
            reservationId,
            workOrigin: entry.workOrigin,
            batchMultiplier: entry.batchMultiplier,
            projectedRewardCredits: entry.projectedRewardCredits,
            allowBlockedDispatch: true,
          });
    nextState =
      migrated === nextState
        ? removeTopLevelQueueEntryById(nextState, reservationId)
        : migrated;
  }

  return nextState;
};

const pullQueue = (state: GameState): GameState => {
  if (!canAcceptPoweredWork(state)) return syncCoreSchedulers(state);
  if (!state.flags.basicQueue && !state.flags.scheduler) return syncCoreSchedulers(state);

  let nextState = reserveReadySystemChildWork(
    rehomeUnprovisionableReservations(state),
  );
  let startedQueuedTask = true;

  while (startedQueuedTask) {
    startedQueuedTask = false;

    const candidate = selectCpuQueueDispatchCandidate(nextState);
    if (!candidate) break;

    const started = assignCpuQueueCandidateToCores(nextState, candidate);
    if (started === nextState) break;

    nextState = started;
    startedQueuedTask = true;
    nextState = reserveReadySystemChildWork(nextState);
  }

  return syncCoreSchedulers(nextState);
};

const updateQueueEntry = (
  state: GameState,
  queueEntryId: string,
  update: (entry: TaskQueueEntry) => TaskQueueEntry,
): GameState => ({
  ...state,
  queueEntries: (state.queueEntries ?? []).map((entry) =>
    entry.id === queueEntryId ? update(entry) : entry,
  ),
});

const recordTaskCompletionEconomics = (
  state: GameState,
  taskId: TaskId,
  rewardCredits: Amount,
  dataReward: Amount,
  workCycles: Amount,
  workOrigin?: WorkOrigin,
): GameState => {
  const recorded: GameState = {
    ...state,
    taskRewardCreditsEarned: {
      ...state.taskRewardCreditsEarned,
      [taskId]: amountAdd(
        state.taskRewardCreditsEarned[taskId] ?? ZERO_AMOUNT,
        rewardCredits,
      ),
    },
    taskWorkCyclesCompleted: {
      ...state.taskWorkCyclesCompleted,
      [taskId]: amountAdd(
        state.taskWorkCyclesCompleted[taskId] ?? ZERO_AMOUNT,
        workCycles,
      ),
    },
  };
  if (workOrigin !== "standing-order") return recorded;
  return {
    ...recorded,
    standingTaskCompletions: {
      ...recorded.standingTaskCompletions,
      [taskId]: (recorded.standingTaskCompletions[taskId] ?? 0) + 1,
    },
    standingTaskRewardCreditsEarned: {
      ...recorded.standingTaskRewardCreditsEarned,
      [taskId]: amountAdd(
        recorded.standingTaskRewardCreditsEarned[taskId] ?? ZERO_AMOUNT,
        rewardCredits,
      ),
    },
    standingTaskDataEarned: {
      ...recorded.standingTaskDataEarned,
      [taskId]: amountAdd(
        recorded.standingTaskDataEarned[taskId] ?? ZERO_AMOUNT,
        dataReward,
      ),
    },
    standingTaskWorkCyclesCompleted: {
      ...recorded.standingTaskWorkCyclesCompleted,
      [taskId]: amountAdd(
        recorded.standingTaskWorkCyclesCompleted[taskId] ?? ZERO_AMOUNT,
        workCycles,
      ),
    },
  };
};

/**
 * Once a non-repeatable task settles, any still-waiting duplicate entry can
 * never dispatch again (canAcceptTask now rejects it), so its reservation is
 * released instead of leaking scheduler slots forever (C-SIM-5). Entries with
 * running work are left alone.
 */
const releaseNonRepeatableQueueDuplicates = (
  state: GameState,
  task: TaskDefinition,
): GameState => {
  if (task.repeatable) return state;

  const activeReservations = getActiveQueueReservationIds(state);
  let nextState = state;
  for (const entry of state.queueEntries ?? []) {
    if (entry.taskId !== task.id) continue;
    if (activeReservations.has(entry.id)) continue;
    if (
      state.activeTasks.some(
        (activeTask) => activeTask.parentQueueEntryId === entry.id,
      )
    ) {
      continue;
    }
    nextState =
      entry.target === "system"
        ? cancelSystemParentReservation(nextState, entry.id)
        : removeLocalQueueReservationById(
            removeTopLevelQueueEntryById(nextState, entry.id),
            entry.id,
          );
  }

  return nextState;
};

const completeParentTask = (
  state: GameState,
  parentTask: TaskDefinition,
  parentQueueEntryId: string,
  acceleratorKindsUsed: TaskQueueEntry["acceleratorKindsUsed"] = [],
): GameState => {
  const completedAmount =
    state.completedTasks[parentTask.id] ?? state.completedJobs[parentTask.id] ?? 0;
  const benchmarkIds = parentTask.kind === "benchmark" ? [parentTask.id] : [];
  const dataReward = parentTask.rewardDataExact;
  const parentEntry = state.queueEntries?.find(
    (entry) => entry.id === parentQueueEntryId,
  );
  const rewardCredits = getStoredTaskRewardCredits(
    parentTask,
    parentEntry?.projectedRewardCredits,
    parentEntry?.batchMultiplier,
  );
  const workCycles = getStoredTaskWorkCycles(
    parentTask,
    parentEntry?.projectedWorkCycles,
    parentEntry?.batchMultiplier,
  );
  const rewarded = recordTaskCompletionEconomics(
    addExactRewards(state, exactResourceBag(rewardCredits, dataReward)),
    parentTask.id,
    rewardCredits,
    dataReward,
    workCycles,
    parentEntry?.workOrigin,
  );
  const withoutQueue = releaseNonRepeatableQueueDuplicates(
    removeTopLevelQueueEntryById(rewarded, parentQueueEntryId),
    parentTask,
  );

  return recordWorkshopCompletionEvidence(updateProgressionFlags({
    ...withoutQueue,
    completedTasks: {
      ...withoutQueue.completedTasks,
      [parentTask.id]: completedAmount + 1,
    },
    completedJobs: {
      ...withoutQueue.completedJobs,
      [parentTask.id]: completedAmount + 1,
    },
    completedBenchmarks: Array.from(
      new Set([...withoutQueue.completedBenchmarks, ...benchmarkIds]),
    ),
    cacheResidency: [],
  }), parentTask.id, acceleratorKindsUsed);
};

const completeChildTask = (
  state: GameState,
  activeTask: ActiveTask,
): GameState => {
  const parentTaskId = activeTask.parentTaskId;
  const parentQueueEntryId = activeTask.parentQueueEntryId;
  if (!parentTaskId || !parentQueueEntryId) return state;

  const parentTask = getTaskDefinition(parentTaskId);
  const childEntry = Object.values(state.coreSchedulers)
    .flatMap((scheduler) => scheduler.localQueueEntries ?? [])
    .find(
      (entry) =>
        (entry.reservationId ?? entry.id) === activeTask.queueEntryId ||
        entry.id === activeTask.queueEntryId,
    );
  const childWorkKey = childEntry?.childWorkKey;
  const withoutChildReservation = activeTask.queueEntryId
    ? removeLocalQueueReservationById(state, activeTask.queueEntryId)
    : state;
  const updatedParent = childWorkKey
    ? updateQueueEntry(withoutChildReservation, parentQueueEntryId, (entry) => ({
        ...entry,
        completedChildKeys: Array.from(
          new Set([...(entry.completedChildKeys ?? []), childWorkKey]),
        ),
        acceleratorKindsUsed: Array.from(
          new Set([
            ...(entry.acceleratorKindsUsed ?? []),
            ...(activeTask.acceleratorKindsUsed ?? []),
          ]),
        ).sort(),
      }))
    : withoutChildReservation;
  const parentEntry = updatedParent.queueEntries?.find(
    (entry) => entry.id === parentQueueEntryId,
  );
  const completedCount = parentEntry?.completedChildKeys?.length ?? 0;
  const totalChildCount =
    parentEntry?.totalChildCount ?? getSystemChildWorkUnits(parentTask).length;

  return completedCount >= totalChildCount && totalChildCount > 0
    ? completeParentTask(
        updatedParent,
        parentTask,
        parentQueueEntryId,
        parentEntry?.acceleratorKindsUsed,
      )
    : updatedParent;
};

const completeTask = (state: GameState, activeTask: ActiveTask): GameState => {
  if (activeTask.parentTaskId && activeTask.parentQueueEntryId) {
    return completeChildTask(state, activeTask);
  }

  const task = getTaskDefinition(activeTask.taskId);
  const completedAmount =
    state.completedTasks[task.id] ?? state.completedJobs[task.id] ?? 0;
  const benchmarkIds = task.kind === "benchmark" ? [task.id] : [];
  const nextBenchmarks = Array.from(
    new Set([...state.completedBenchmarks, ...benchmarkIds]),
  );
  const dataReward = task.rewardDataExact;
  const rewardCredits = getStoredTaskRewardCredits(
    task,
    activeTask.projectedRewardCredits,
    activeTask.batchMultiplier,
  );
  const workCycles = getStoredTaskWorkCycles(
    task,
    activeTask.projectedWorkCycles,
    activeTask.batchMultiplier,
  );
  const rewarded = recordTaskCompletionEconomics(
    addExactRewards(state, exactResourceBag(rewardCredits, dataReward)),
    task.id,
    rewardCredits,
    dataReward,
    workCycles,
    activeTask.workOrigin,
  );
  const queueReleased = activeTask.schedulerQueued
    ? activeTask.queueEntryId
      ? removeLocalQueueReservationById(
          removeTopLevelQueueEntryById(rewarded, activeTask.queueEntryId),
          activeTask.queueEntryId,
        )
      : removeQueuedTaskReservation(
          rewarded,
          task.id,
          0,
          getSchedulerSlotReservationCount(task, activeTask.assignedCoreIds),
        )
    : rewarded;
  const duplicatesReleased = releaseNonRepeatableQueueDuplicates(
    queueReleased,
    task,
  );

  return recordWorkshopCompletionEvidence(updateProgressionFlags({
    ...duplicatesReleased,
    completedTasks: {
      ...duplicatesReleased.completedTasks,
      [task.id]: completedAmount + 1,
    },
    completedJobs: {
      ...duplicatesReleased.completedJobs,
      [task.id]: completedAmount + 1,
    },
    completedBenchmarks: nextBenchmarks,
    cacheResidency: [],
  }), task.id, activeTask.acceleratorKindsUsed);
};

const advanceCoreOperation = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
  nextOperationIndex: number,
) => enterOperation(state, task, operation, nextOperationIndex);

function deadlockLoadOperation(
  operation: ActiveCoreOperation,
  resource: DeadlockResource,
  update: Partial<ActiveCoreOperation> = {},
): ActiveCoreOperation {
  return {
    ...operation,
    ...update,
    status: "deadlocked",
    memoryState: "deadlock",
    lockResource: resource,
    lockReason: getDeadlockReason(resource),
    deadlockSeconds:
      operation.status === "deadlocked" && operation.lockResource === resource
        ? operation.deadlockSeconds
        : 0,
  };
}

const getCacheUsedWithOperation = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
) => {
  const updatedTask = {
    ...task,
    coreOperations: task.coreOperations.map((coreOperation) =>
      coreOperation.coreId === operation.coreId ? operation : coreOperation,
    ),
  };
  const activeTasks = state.activeTasks.some(
    (activeTask) => activeTask.instanceId === task.instanceId,
  )
    ? state.activeTasks.map((activeTask) =>
        activeTask.instanceId === task.instanceId ? updatedTask : activeTask,
      )
    : [...state.activeTasks, updatedTask];

  return getReservedCacheBits(
    { ...state, activeTasks, activeJobs: activeTasks },
    getCpuIdForCore(state, operation.coreId),
  );
};

const CACHE_CAPACITY_EPSILON = 0.000001;

const normalizeCycleRemainder = (
  remaining: string | number,
  total: string | number,
) => {
  const normalized = amountClampMin(remaining);
  // Rates are numeric hardware projections applied to exact logical counters.
  // Snap only their sub-nanocycle / 1e-15-relative rounding residue so a
  // 4e-9 artifact cannot defer an operation to the next 15-minute chunk.
  const tolerance = amountMax(
    "0.000000001",
    amountMultiply(amountClampMin(total), "0.000000000000001"),
  );
  return amountCompare(normalized, tolerance) <= 0 ? ZERO_AMOUNT : normalized;
};

const getAllowedCacheProgressCycles = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
  requestedLoadCycles: number,
  requestedCpuCycles: ActiveCoreOperation["remainingCycles"],
) => {
  if (
    requestedLoadCycles <= 0 &&
    amountCompare(requestedCpuCycles, ZERO_AMOUNT) <= 0
  ) {
    return { loadCycles: 0, cpuCycles: ZERO_AMOUNT, exhausted: false };
  }

  const capacity = getCpuHardware(
    state,
    getCpuIdForCore(state, operation.coreId),
  ).cacheBits;
  const getUpdatedOperation = (scale: number) => ({
    ...operation,
    remainingLoadCycles: amountClampMin(
      amountSubtract(
        operation.remainingLoadCycles,
        amountMultiply(requestedLoadCycles, scale),
      ),
    ),
    remainingCycles: amountClampMin(
      amountSubtract(
        operation.remainingCycles,
        amountMultiply(requestedCpuCycles, scale),
      ),
    ),
  });
  const usedAfterFullLoad = getCacheUsedWithOperation(
    state,
    task,
    getUpdatedOperation(1),
  );

  if (usedAfterFullLoad <= capacity) {
    return {
      loadCycles: requestedLoadCycles,
      cpuCycles: requestedCpuCycles,
      exhausted: false,
    };
  }

  let low = 0;
  let high = 1;
  for (let index = 0; index < 40; index += 1) {
    const midpoint = (low + high) / 2;
    const used = getCacheUsedWithOperation(
      state,
      task,
      getUpdatedOperation(midpoint),
    );

    if (used <= capacity) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }
  const allowedOperation = getUpdatedOperation(low);
  const usedAfterAllowedProgress = getCacheUsedWithOperation(
    state,
    task,
    allowedOperation,
  );

  return {
    loadCycles: requestedLoadCycles * low,
    cpuCycles: amountMultiply(requestedCpuCycles, low),
    exhausted: usedAfterAllowedProgress >= capacity - CACHE_CAPACITY_EPSILON,
  };
};

const tickLoad = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
  deltaSeconds: number,
  exactDeltaSeconds: Amount,
  rateState: GameState = state,
): ActiveCoreOperation => {
  const operationDefinition = getOperation(task, operation.operationIndex);
  if (!operationDefinition) return operation;

  if (
    operation.status === "loadingRam" &&
    operationDefinition.ramBits > 0 &&
    (operation.ramBlocks ?? []).length === 0
  ) {
    const allocatedOperation = beginRamLoadOperation(
      state,
      task,
      operation,
      operationDefinition,
      operation.remainingCycles,
      operation.remainingLoadCycles,
      operation.totalLoadCycles,
    );

    if (allocatedOperation.status === "deadlocked") {
      return {
        ...allocatedOperation,
        deadlockSeconds: operation.deadlockSeconds,
      };
    }

    return tickLoad(
      state,
      task,
      allocatedOperation,
      deltaSeconds,
      exactDeltaSeconds,
      rateState,
    );
  }

  // Load and contention rates are sampled from the common pre-slice state so
  // every operation in the slice shares one piecewise-constant rate set; the
  // staged state remains authoritative for allocation and capacity decisions.
  const ramLoadDeltas =
    operation.status === "loadingRam"
      ? getRamBlockLoadDeltasForOperationTick(rateState, operation, deltaSeconds)
      : [];
  const requestedRamLoadCycles =
    operation.status === "loadingRam"
      ? getRamBlockLoadRatesForOperation(rateState, operation).reduce(
          (total, rate) => total + rate * deltaSeconds,
          0,
        )
      : 0;
  const requestedLoadCycles = Math.min(
    amountToSafeNumber(operation.remainingLoadCycles),
    operation.status === "loadingCache"
      ? getCacheLoadRateForOperationTick(
          rateState,
          operation,
          operationDefinition,
        ) * deltaSeconds
      : (operation.ramBlocks ?? []).length > 0
        ? requestedRamLoadCycles
        : getRamLoadCyclesForOperationTick(
            rateState,
            task,
            operation,
            deltaSeconds,
          ),
  );
  const requestedCpuCycles =
    operation.status === "loadingCache" && operationDefinition.memoryAction
      ? amountMin(
          operation.remainingCycles,
          amountMultiply(
            getEffectiveCoreClockHz(rateState, operation.coreId),
            exactDeltaSeconds,
          ),
        )
      : ZERO_AMOUNT;
  const cacheProgress =
    operation.status === "loadingCache"
      ? getAllowedCacheProgressCycles(
          state,
          task,
          operation,
          requestedLoadCycles,
          requestedCpuCycles,
        )
      : null;
  const availableLoadCycles =
    operation.status === "loadingCache" ||
    (operation.status === "loadingRam" && (operation.ramBlocks ?? []).length > 0)
      ? requestedLoadCycles
      : getAvailableMemoryBits(state);
  const appliedLoadCycles =
    cacheProgress?.loadCycles ??
    Math.max(0, Math.min(requestedLoadCycles, availableLoadCycles));
  const appliedRamBlockScale =
    requestedRamLoadCycles > 0
      ? Math.min(1, appliedLoadCycles / requestedRamLoadCycles)
      : 0;
  let nextRamBlocks =
    operation.status === "loadingRam" && (operation.ramBlocks ?? []).length > 0
      ? applyRamBlockLoadDeltas(operation, ramLoadDeltas, appliedRamBlockScale)
      : operation.ramBlocks ?? [];
  const remainingLoadCycles = normalizeCycleRemainder(
    amountClampMin(
      amountSubtract(operation.remainingLoadCycles, appliedLoadCycles),
    ),
    operation.totalLoadCycles,
  );
  if (
    operation.status === "loadingRam" &&
    amountCompare(remainingLoadCycles, ZERO_AMOUNT) <= 0
  ) {
    // Aggregate I/O reuses one bounded resident allocation. Whatever fractional
    // service slice closed the logical stream, the physical working set is fully
    // resident before CPU execution begins.
    nextRamBlocks = nextRamBlocks.map((block) => ({
      ...block,
      loadedBits: block.lengthBits,
    }));
  }
  const cpuCyclesDone = cacheProgress?.cpuCycles ?? ZERO_AMOUNT;
  const remainingCycles = normalizeCycleRemainder(
    amountClampMin(amountSubtract(operation.remainingCycles, cpuCyclesDone)),
    operation.totalCycles,
  );
  const memoryReservedBits =
    operation.status === "loadingRam"
      ? (operation.ramBlocks ?? []).length > 0
        ? operationDefinition.ramBits
        : Math.min(
            operationDefinition.ramBits,
            operation.memoryReservedBits + appliedLoadCycles,
          )
      : operation.memoryReservedBits;
  const memoryReservedBytes = bitsToBytes(memoryReservedBits);

  const waitsForCpuIssue =
    operation.status === "loadingCache" && Boolean(operationDefinition.memoryAction);
  const cacheProgressBlocked =
    operation.status === "loadingCache" && Boolean(cacheProgress?.exhausted);

  if (
    (cacheProgressBlocked ||
      (operation.status === "loadingRam" && appliedLoadCycles < requestedLoadCycles)) &&
    amountCompare(remainingLoadCycles, ZERO_AMOUNT) > 0
  ) {
    return deadlockLoadOperation(
      operation,
      operation.status === "loadingCache" ? "cache" : "ram",
      {
        remainingLoadCycles,
        remainingCycles,
        memoryReservedBits,
        memoryReservedBytes,
        ramBlocks: nextRamBlocks,
      },
    );
  }

  if (
    amountCompare(remainingLoadCycles, ZERO_AMOUNT) > 0 ||
    (waitsForCpuIssue && amountCompare(remainingCycles, ZERO_AMOUNT) > 0)
  ) {
    return {
      ...operation,
      remainingLoadCycles,
      remainingCycles,
      memoryReservedBits,
      memoryReservedBytes,
      ramBlocks: nextRamBlocks,
    };
  }

  if (operation.status === "loadingCache") {
    const ramAlreadyReady =
      operationDefinition.ramBits > 0 &&
      operation.memoryState === "ready" &&
      operation.memoryReservedBits >= operationDefinition.ramBits;
    const ramLoadCycles = amountMultiply(
      ramAlreadyReady ? 0 : getRamLoadCycles(state, operationDefinition),
      normalizeTaskBatchMultiplier(
        task.batchMultiplier,
        getTaskDefinition(task.parentTaskId ?? task.taskId).aggregateBatch
          ?.maximumMultiplier ?? 1,
      ),
    );
    if (amountCompare(ramLoadCycles, ZERO_AMOUNT) > 0) {
      return beginRamLoadOperation(
        state,
        task,
        {
          ...operation,
          remainingCycles,
          remainingLoadCycles: ramLoadCycles,
          memoryReservedBits: 0,
          memoryReservedBytes: 0,
          ramBlocks: [],
          ramChannelCount: 1,
        },
        operationDefinition,
        remainingCycles,
        ramLoadCycles,
        operation.totalLoadCycles,
      );
    }

    if (operationDefinition.memoryAction) {
      return advanceCoreOperation(
        state,
        task,
        {
          ...operation,
          remainingCycles: ZERO_AMOUNT,
          remainingLoadCycles: ZERO_AMOUNT,
          memoryReservedBits: 0,
          memoryReservedBytes: 0,
          ramBlocks: [],
          ramChannelCount: 1,
        },
        operation.operationIndex + 1,
      );
    }
  }

  if (operation.status === "loadingRam" && operationDefinition.memoryAction) {
    return advanceCoreOperation(
      state,
      task,
      {
        ...operation,
        memoryState: "ready",
        remainingCycles: ZERO_AMOUNT,
        remainingLoadCycles: ZERO_AMOUNT,
        memoryReservedBits: operationDefinition.ramBits,
        memoryReservedBytes: operationDefinition.ramBytes,
        ramBlocks: nextRamBlocks,
        ramChannelCount: Math.max(1, operation.ramChannelCount),
      },
      operation.operationIndex + 1,
    );
  }

  return {
    ...operation,
    status: "running",
    memoryState: "ready",
    remainingCycles,
    remainingLoadCycles: ZERO_AMOUNT,
    memoryReservedBits:
      operation.status === "loadingRam"
        ? operationDefinition.ramBits
        : memoryReservedBits,
    memoryReservedBytes:
      operation.status === "loadingRam"
        ? operationDefinition.ramBytes
        : memoryReservedBytes,
    ramBlocks:
      operation.status === "loadingRam" ? nextRamBlocks : operation.ramBlocks ?? [],
  };
};

const tickRunning = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
  exactDeltaSeconds: Amount,
): ActiveCoreOperation => {
  const operationDefinition = getOperation(task, operation.operationIndex);
  if (!operationDefinition) return operation;

  const cyclesDone = amountMultiply(
    getOperationEffectiveClock(state, operationDefinition, operation.coreId),
    exactDeltaSeconds,
  );
  const remainingCycles = amountSubtract(operation.remainingCycles, cyclesDone);

  if (amountCompare(remainingCycles, ZERO_AMOUNT) > 0) {
    return {
      ...operation,
      remainingCycles,
    };
  }

  return advanceCoreOperation(
    state,
    task,
    {
      ...operation,
      remainingCycles: ZERO_AMOUNT,
    },
    operation.operationIndex + 1,
  );
};

const tickWaitingMemory = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
): ActiveCoreOperation =>
  enterOperation(state, task, operation, operation.operationIndex);

const tickDeadlocked = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
  deltaSeconds: number,
  exactDeltaSeconds: Amount,
): ActiveCoreOperation => {
  const agedOperation = {
    ...operation,
    deadlockSeconds: operation.deadlockSeconds + deltaSeconds,
  };
  const operationDefinition = getOperation(task, operation.operationIndex);

  if (!operationDefinition || !operation.lockResource) return agedOperation;

  const retryOperation: ActiveCoreOperation = {
    ...agedOperation,
    status: operation.lockResource === "cache" ? "loadingCache" : "loadingRam",
    memoryState:
      operation.lockResource === "cache" &&
      operationDefinition.ramBits > 0 &&
      agedOperation.memoryReservedBits >= operationDefinition.ramBits
        ? "ready"
        : operation.lockResource === "cache"
          ? "cacheLoad"
          : "ramLoad",
    lockResource: null,
    lockReason: null,
  };

  const retriedOperation = tickLoad(
    state,
    task,
    retryOperation,
    deltaSeconds,
    exactDeltaSeconds,
  );

  if (retriedOperation.status === "deadlocked") {
    return {
      ...retriedOperation,
      deadlockSeconds: agedOperation.deadlockSeconds,
    };
  }

  return {
    ...retriedOperation,
    lockResource: null,
    lockReason: null,
    deadlockSeconds: 0,
  };
};

const assignNextChunkedWorkUnits = (
  state: GameState,
  activeTask: ActiveTask,
  coreOperations: ActiveCoreOperation[],
): ActiveTask => {
  const definition = getTaskDefinition(activeTask.taskId);
  if (!isChunkedTask(definition)) {
    return refreshTaskTotals({ ...activeTask, coreOperations });
  }

  const totalWorkUnits = activeTask.workUnitsTotal ?? definition.workUnitCount;
  let startedWorkUnits = activeTask.workUnitsStarted ?? 0;
  let completedWorkUnits = activeTask.workUnitsCompleted ?? 0;
  const activeWorkUnitIndexes = new Set(
    coreOperations
      .filter(operationRunsChunkedWorkUnit)
      .map((operation) => operation.workUnitIndex)
      .filter((index): index is number => index != null),
  );
  const pendingWorkUnits = (
    activeTask.workUnitsPending ??
    Array.from(
      { length: Math.max(0, totalWorkUnits - startedWorkUnits) },
      (_, index) => startedWorkUnits + index,
    )
  ).filter((workUnitIndex, index, source) => {
    if (workUnitIndex < 0 || workUnitIndex >= totalWorkUnits) return false;
    if (activeWorkUnitIndexes.has(workUnitIndex)) return false;
    return source.indexOf(workUnitIndex) === index;
  });
  const reassignedOperations: ActiveCoreOperation[] = [];

  for (const [index, operation] of coreOperations.entries()) {
    let nextOperation = operation;
    const previousOperation = activeTask.coreOperations.find(
      (candidate) => candidate.coreId === operation.coreId,
    );
    const completedNow =
      operation.status === "complete" &&
      operation.workUnitIndex != null &&
      !(
        previousOperation?.status === "complete" &&
        previousOperation.workUnitIndex === operation.workUnitIndex
      );

    if (completedNow) completedWorkUnits += 1;

    if (operation.status === "complete") {
      const stagedOperations = [
        ...reassignedOperations,
        ...coreOperations.slice(index + 1),
      ];

      if (
        pendingWorkUnits.length > 0 &&
        canStartChunkedWorkUnit(state, activeTask, stagedOperations)
      ) {
        const workUnitIndex = pendingWorkUnits.shift()!;
        startedWorkUnits = Math.max(startedWorkUnits, workUnitIndex + 1);
        const stagedTask = {
          ...activeTask,
          workUnitsTotal: totalWorkUnits,
          workUnitsStarted: startedWorkUnits,
          workUnitsCompleted: completedWorkUnits,
          workUnitsPending: pendingWorkUnits,
          coreOperations: stagedOperations,
        };
        nextOperation = enterOperation(
          {
            ...state,
            activeTasks: state.activeTasks.map((candidate) =>
              candidate.instanceId === activeTask.instanceId
                ? stagedTask
                : candidate,
            ),
          },
          stagedTask,
          idleCoreOperation(operation.coreId, 0, workUnitIndex),
          0,
        );
      } else if (operation.workUnitIndex != null) {
        nextOperation = {
          ...operation,
          workUnitIndex: null,
        };
      }
    }

    reassignedOperations.push(nextOperation);
  }

  return refreshTaskTotals({
    ...activeTask,
    workUnitsTotal: totalWorkUnits,
    workUnitsStarted: startedWorkUnits,
    workUnitsCompleted: completedWorkUnits,
    workUnitsPending: pendingWorkUnits,
    coreOperations: reassignedOperations,
  });
};

const tickActiveTask = (
  state: GameState,
  activeTask: ActiveTask,
  deltaSeconds: number,
  exactDeltaSeconds: Amount,
  rateState: GameState = state,
): ActiveTask => {
  const ramDeadlocked = Boolean(getRamDeadlockOperation(state));
  const cacheDeadlockedCpuIds = getCacheDeadlockedCpuIds(state);
  const recoveryActive = state.deadlockProcessLockout === true;
  const coreOperations: ActiveCoreOperation[] = [];
  const acceleratorKindsUsed = new Set(activeTask.acceleratorKindsUsed ?? []);
  const acceleratorRoutes = getWorkshopAcceleratorRoutes(rateState).filter(
    (route) => route.taskInstanceId === activeTask.instanceId,
  );

  activeTask.coreOperations.forEach((operation, index) => {
    const stagedTask = {
      ...activeTask,
      coreOperations: [
        ...coreOperations,
        ...activeTask.coreOperations.slice(index),
      ],
    };
    const stagedActiveTasks = state.activeTasks.map((candidate) =>
      candidate.instanceId === activeTask.instanceId ? stagedTask : candidate,
    );
    const stagedState = {
      ...state,
      activeTasks: stagedActiveTasks,
      activeJobs: stagedActiveTasks,
    };

    if (operation.status === "deadlocked") {
      coreOperations.push(
        tickDeadlocked(
          stagedState,
          stagedTask,
          operation,
          deltaSeconds,
          exactDeltaSeconds,
        ),
      );
      return;
    }

    if (
      recoveryActive ||
      ramDeadlocked ||
      cacheDeadlockedCpuIds.has(getCpuIdForCore(stagedState, operation.coreId))
    ) {
      coreOperations.push(operation);
      return;
    }

    if (operation.status === "loadingCache" || operation.status === "loadingRam") {
      coreOperations.push(
        tickLoad(
          stagedState,
          stagedTask,
          operation,
          deltaSeconds,
          exactDeltaSeconds,
          rateState,
        ),
      );
      return;
    }

    if (operation.status === "running") {
      const route = acceleratorRoutes.find(
        (candidate) =>
          candidate.coreId === operation.coreId &&
          candidate.operationIndex === operation.operationIndex,
      );
      if (
        deltaSeconds > 0 &&
        route?.assignment.target === "accelerator" &&
        route.acceleratorKind
      ) {
        acceleratorKindsUsed.add(route.acceleratorKind);
      }
      coreOperations.push(
        tickRunning(rateState, stagedTask, operation, exactDeltaSeconds),
      );
      return;
    }

    if (operation.status === "waitingMemory") {
      coreOperations.push(tickWaitingMemory(stagedState, stagedTask, operation));
      return;
    }

    coreOperations.push(operation);
  });

  return {
    ...assignNextChunkedWorkUnits(state, activeTask, coreOperations),
    acceleratorKindsUsed: [...acceleratorKindsUsed].sort(),
  };
};

const shouldReleaseWaitingOperation = (
  task: ActiveTask,
  operation: ActiveCoreOperation,
) => {
  const definition = getTaskDefinition(task.taskId);
  const currentOperation = definition.operations[operation.operationIndex];
  if (!currentOperation || operation.status !== "waitingBarrier") return false;

  const assignedCoreIds = task.assignedCoreIds.filter((coreId) =>
    isOperationAssignedToCore(task, currentOperation, coreId),
  );

  if (currentOperation.kind === "barrier") {
    return assignedCoreIds.every((coreId) => {
      const peer = task.coreOperations.find((core) => core.coreId === coreId);
      return (
        peer?.operationIndex === operation.operationIndex &&
        peer.status === "waitingBarrier"
      );
    });
  }

  if (isOperationAssignedToCore(task, currentOperation, operation.coreId)) {
    return false;
  }

  return assignedCoreIds.every((coreId) => {
    const peer = task.coreOperations.find((core) => core.coreId === coreId);
    return (
      !peer ||
      peer.operationIndex > operation.operationIndex ||
      peer.status === "complete"
    );
  });
};

const settleTaskBarriers = (
  state: GameState,
  activeTask: ActiveTask,
): [GameState, ActiveTask] => {
  if (getDeadlockScopeResource(state, activeTask) !== null) return [state, activeTask];

  let nextState = state;
  let nextTask = activeTask;
  let changed = true;
  let guard = 0;

  while (changed && guard < 20) {
    changed = false;
    guard += 1;

    const coreOperations = nextTask.coreOperations.map((operation) => {
      if (!shouldReleaseWaitingOperation(nextTask, operation)) return operation;

      changed = true;
      return advanceCoreOperation(
        nextState,
        nextTask,
        operation,
        operation.operationIndex + 1,
      );
    });

    if (changed) {
      nextTask = refreshTaskTotals({
        ...nextTask,
        coreOperations,
      });
    }
  }

  return [nextState, nextTask];
};

const settleActiveTasks = (state: GameState): GameState => {
  let nextState = state;
  const continuingTasks: ActiveTask[] = [];

  for (const activeTask of state.activeTasks) {
    const [settledState, settledTask] = settleTaskBarriers(nextState, activeTask);
    nextState = settledState;

    const settledDefinition = getTaskDefinition(settledTask.taskId);
    const operationsComplete = settledTask.coreOperations.every(
      (operation) => operation.status === "complete",
    );
    const complete = isChunkedTask(settledDefinition)
      ? operationsComplete &&
        (settledTask.workUnitsCompleted ?? 0) >= settledDefinition.workUnitCount
      : operationsComplete;

    if (complete) {
      nextState = completeTask(nextState, settledTask);
    } else {
      continuingTasks.push(settledTask);
    }
  }

  return syncCoreSchedulers({
    ...nextState,
    activeTasks: continuingTasks,
    activeJobs: continuingTasks,
  });
};

export const DEADLOCK_WATCHDOG_SECONDS = 3;

const getPendingDeadlockedOperation = (task: ActiveTask) =>
  task.coreOperations.find(
    (operation) =>
      operation.status === "deadlocked" &&
      operation.lockResource !== null,
  ) ?? null;

const getDeadlockedOperation = (task: ActiveTask) => {
  const operation = getPendingDeadlockedOperation(task);
  return operation && operation.deadlockSeconds >= DEADLOCK_WATCHDOG_SECONDS
    ? operation
    : null;
};

const getSchedulerKeyForTask = (
  state: GameState,
  task: ActiveTask,
  resource?: DeadlockResource | null,
) =>
  (Boolean(task.parentTaskId) || isSystemScheduledTask(getTaskDefinition(task.taskId))) &&
  resource !== "cache"
    ? "system"
    : `cpu:${getCpuIdForCore(state, task.coreId)}`;

const getSchedulerConfigForActiveTask = (
  state: GameState,
  task: ActiveTask,
  resource?: DeadlockResource | null,
): SchedulerConfig =>
  (Boolean(task.parentTaskId) || isSystemScheduledTask(getTaskDefinition(task.taskId))) &&
  resource !== "cache"
    ? createSchedulerConfig(state.hardware.systemSchedulerConfig)
    : createSchedulerConfig(
        getCpuHardware(state, getCpuIdForCore(state, task.coreId)).schedulerConfig,
      );

const getSchedulerKeyForTarget = (
  target: "cpu" | "system",
  cpuId?: number,
) => (target === "system" ? "system" : cpuId === undefined ? null : `cpu:${cpuId}`);

const getSchedulerConfigForTarget = (
  state: GameState,
  target: "cpu" | "system",
  cpuId?: number,
) => {
  if (target === "system") {
    return createSchedulerConfig(state.hardware.systemSchedulerConfig);
  }

  if (cpuId === undefined) return null;
  return createSchedulerConfig(getCpuHardware(state, cpuId).schedulerConfig);
};

const taskHoldsResource = (
  task: ActiveTask,
  resource: DeadlockResource,
  cpuId?: number,
  state?: GameState,
) => {
  if (resource === "ram") {
    return task.coreOperations.some(
      (operation) =>
        operation.status !== "deadlocked" && operation.memoryReservedBits > 0,
    );
  }

  return (
    state !== undefined &&
    cpuId !== undefined &&
    getCpuIdForCore(state, task.coreId) === cpuId &&
    !task.coreOperations.some(
      (operation) =>
        operation.status === "deadlocked" && operation.lockResource === "cache",
    ) &&
    getTaskDefinition(task.taskId).cacheNeedBits > 0
  );
};

const taskIsInDeadlockScope = (
  state: GameState,
  task: ActiveTask,
  resource: DeadlockResource,
  cpuId?: number,
) =>
  resource === "ram" ||
  (cpuId !== undefined && getCpuIdForCore(state, task.coreId) === cpuId);

const getInstanceSequence = (task: ActiveTask) =>
  Number(task.instanceId.match(/\d+$/)?.[0] ?? 0);

const getTaskProgress = (task: ActiveTask) => {
  if (amountCompare(task.totalCycles, ZERO_AMOUNT) <= 0) return 1;
  return Math.min(
    1,
    Math.max(
      0,
      1 - amountToSafeNumber(amountDivide(task.remainingCycles, task.totalCycles)),
    ),
  );
};

const getWatchdogVictimPool = (
  state: GameState,
  deadlockedTask: ActiveTask,
  resource: DeadlockResource,
  includeDeadlockedTask: boolean,
) => {
  const cpuId =
    resource === "cache" ? getCpuIdForCore(state, deadlockedTask.coreId) : undefined;
  const schedulerKey = getSchedulerKeyForTask(state, deadlockedTask, resource);
  const pool = state.activeTasks.filter((task) => {
    if (!task.schedulerQueued) return false;
    if (getSchedulerKeyForTask(state, task, resource) !== schedulerKey) return false;
    if (!taskIsInDeadlockScope(state, task, resource, cpuId)) return false;
    if (task.instanceId === deadlockedTask.instanceId) return includeDeadlockedTask;
    return taskHoldsResource(task, resource, cpuId, state);
  });

  return pool.length > 0 ? pool : [deadlockedTask];
};

const selectWatchdogVictim = (
  state: GameState,
  deadlockedTask: ActiveTask,
  resource: DeadlockResource,
  killPolicy: SchedulerKillPolicy,
) => {
  if (killPolicy === "newestBlocker") {
    const pool = getWatchdogVictimPool(state, deadlockedTask, resource, false);
    return pool.reduce((newest, task) =>
      getInstanceSequence(task) > getInstanceSequence(newest) ? task : newest,
    );
  }

  const pool = getWatchdogVictimPool(state, deadlockedTask, resource, true);

  if (killPolicy === "lowestProgress") {
    return pool.reduce((lowest, task) =>
      getTaskProgress(task) < getTaskProgress(lowest) ? task : lowest,
    );
  }

  return deadlockedTask;
};

const getChunkedKillOperation = (
  state: GameState,
  task: ActiveTask,
  resource: DeadlockResource,
  coreId?: number,
) => {
  if (coreId !== undefined) {
    return (
      task.coreOperations.find(
        (operation) =>
          operation.coreId === coreId &&
          operation.workUnitIndex != null &&
          operation.status !== "complete",
      ) ?? null
    );
  }

  const deadlockedOperation = getPendingDeadlockedOperation(task);
  if (deadlockedOperation?.workUnitIndex != null) return deadlockedOperation;

  const definition = getTaskDefinition(task.taskId);
  const activeOperations = task.coreOperations.filter(operationRunsChunkedWorkUnit);
  const memorySafeWidth =
    definition.ramNeedBits <= 0
      ? definition.workUnitCount
      : Math.floor(
          Math.max(
            0,
            getMemoryCapacityBits(state) -
              getOtherActiveMemoryFootprintBits(state, task),
          ) / definition.ramNeedBits,
        );

  if (resource === "ram" && activeOperations.length > memorySafeWidth) {
    return (
      activeOperations
        .filter((operation) => operation.memoryReservedBits > 0)
        .sort((left, right) => (right.workUnitIndex ?? 0) - (left.workUnitIndex ?? 0))[0] ??
      activeOperations.sort(
        (left, right) => (right.workUnitIndex ?? 0) - (left.workUnitIndex ?? 0),
      )[0] ??
      null
    );
  }

  return (
    task.coreOperations.find((operation) => {
      if (operation.workUnitIndex == null || operation.status === "complete") return false;
      if (resource === "ram") return operation.memoryReservedBits > 0;
      return true;
    }) ?? null
  );
};

const requeueChunkedWorkUnit = (
  state: GameState,
  activeTask: ActiveTask,
  resource: DeadlockResource,
  coreId?: number,
): GameState | null => {
  const definition = getTaskDefinition(activeTask.taskId);
  if (!isChunkedTask(definition)) return null;

  const operation = getChunkedKillOperation(state, activeTask, resource, coreId);
  if (!operation || operation.workUnitIndex == null) return null;

  const pendingWorkUnits = [
    operation.workUnitIndex,
    ...(activeTask.workUnitsPending ?? []),
  ].filter(
    (workUnitIndex, index, source) =>
      workUnitIndex >= 0 &&
      workUnitIndex < definition.workUnitCount &&
      source.indexOf(workUnitIndex) === index,
  );
  const resetOperations = activeTask.coreOperations.map((candidate) =>
    candidate.coreId === operation.coreId
      ? idleCoreOperation(operation.coreId, 0, null)
      : candidate,
  );
  const resetTask = refreshTaskTotals({
    ...activeTask,
    workUnitsPending: pendingWorkUnits,
    coreOperations: resetOperations,
  });
  const resetActiveTasks = state.activeTasks.map((candidate) =>
    candidate.instanceId === activeTask.instanceId ? resetTask : candidate,
  );

  return syncCoreSchedulers({
    ...state,
    activeTasks: resetActiveTasks,
    activeJobs: resetActiveTasks,
    cacheResidency: [],
  });
};

export const getSchedulerWatchdogPreview = (
  state: GameState,
  target: "cpu" | "system",
  cpuId?: number,
): SchedulerWatchdogPreview | null => {
  if (!state.flags.schedulerWatchdog) return null;

  const schedulerKey = getSchedulerKeyForTarget(target, cpuId);
  if (!schedulerKey) return null;

  const config = getSchedulerConfigForTarget(state, target, cpuId);
  if (!config?.autoKillEnabled) return null;

  const deadlockedTask = state.activeTasks.find(
    (task) => {
      if (!task.schedulerQueued) return false;

      const operation = getPendingDeadlockedOperation(task);
      return (
        operation !== null &&
        getSchedulerKeyForTask(state, task, operation.lockResource) === schedulerKey
      );
    },
  );
  if (!deadlockedTask) return null;

  const deadlockedOperation = getPendingDeadlockedOperation(deadlockedTask);
  if (!deadlockedOperation?.lockResource) return null;

  const victim = selectWatchdogVictim(
    state,
    deadlockedTask,
    deadlockedOperation.lockResource,
    config.killPolicy,
  );
  const elapsedSeconds = Math.max(0, deadlockedOperation.deadlockSeconds);
  const progress = Math.min(1, elapsedSeconds / DEADLOCK_WATCHDOG_SECONDS);

  return {
    target,
    cpuId: target === "cpu" ? (cpuId ?? null) : null,
    resource: deadlockedOperation.lockResource,
    killPolicy: config.killPolicy,
    deadlockedTaskId: deadlockedTask.taskId,
    deadlockedTaskName: getTaskDefinition(deadlockedTask.taskId).name,
    deadlockedInstanceId: deadlockedTask.instanceId,
    victimTaskId: victim.taskId,
    victimTaskName: getTaskDefinition(victim.taskId).name,
    victimInstanceId: victim.instanceId,
    victimCoreIds: victim.assignedCoreIds,
    secondsRemaining: Math.max(0, DEADLOCK_WATCHDOG_SECONDS - elapsedSeconds),
    progress,
  };
};

const applySchedulerWatchdogs = (state: GameState): GameState => {
  if (!state.flags.schedulerWatchdog) return state;

  let nextState = state;
  const handledSchedulers = new Set<string>();
  const deadlockedTasks = state.activeTasks.filter(
    (task) => task.schedulerQueued && getDeadlockedOperation(task),
  );

  for (const deadlockedTask of deadlockedTasks) {
    const liveDeadlockedTask = nextState.activeTasks.find(
      (task) => task.instanceId === deadlockedTask.instanceId,
    );
    if (!liveDeadlockedTask) continue;

    const deadlockedOperation = getDeadlockedOperation(liveDeadlockedTask);
    const schedulerKey = getSchedulerKeyForTask(
      nextState,
      liveDeadlockedTask,
      deadlockedOperation?.lockResource,
    );
    if (handledSchedulers.has(schedulerKey)) continue;

    const config = getSchedulerConfigForActiveTask(
      nextState,
      liveDeadlockedTask,
      deadlockedOperation?.lockResource,
    );
    if (
      !config.autoKillEnabled ||
      !deadlockedOperation?.lockResource ||
      deadlockedOperation.deadlockSeconds < DEADLOCK_WATCHDOG_SECONDS
    ) {
      continue;
    }

    const victim = selectWatchdogVictim(
      nextState,
      liveDeadlockedTask,
      deadlockedOperation.lockResource,
      config.killPolicy,
    );
    const liveVictim = nextState.activeTasks.find(
      (task) => task.instanceId === victim.instanceId,
    );
    const chunkRequeued = liveVictim
      ? requeueChunkedWorkUnit(
          nextState,
          liveVictim,
          deadlockedOperation.lockResource,
        )
      : null;
    // Any system child (chunked or composed parent) loses only its own work
    // unit: the unreserved childWorkKey is re-reserved automatically, so the
    // parent keeps its completed-child progress. Cancelling the whole parent
    // here destroyed non-chunked composition jobs outright (F-SCH-3).
    const systemChildRequeued =
      !chunkRequeued && liveVictim?.parentQueueEntryId
        ? cancelSystemChildWorkUnit(nextState, liveVictim)
        : null;
    nextState =
      chunkRequeued ??
      systemChildRequeued ??
      cancelActiveTask(nextState, victim.taskId, victim.instanceId);
    handledSchedulers.add(schedulerKey);
  }

  return syncCoreSchedulers(nextState);
};

const cancelAllActiveTasksForDeadlockFailure = (state: GameState): GameState => {
  let nextState: GameState = {
    ...state,
    activeTasks: [],
    activeJobs: [],
    cacheResidency: [],
  };

  for (let index = state.activeTasks.length - 1; index >= 0; index -= 1) {
    const activeTask = state.activeTasks[index];
    if (!activeTask?.schedulerQueued) continue;

    if (activeTask.queueEntryId) {
      // Release exactly this instance's reservation by id. Occurrence counting
      // over taskIds can remove another queued copy's local entries, leaving a
      // stale ghost reservation plus an undispatchable orphan (F-SCH-4).
      nextState = removeLocalQueueReservationById(
        removeTopLevelQueueEntryById(nextState, activeTask.queueEntryId),
        activeTask.queueEntryId,
      );
      continue;
    }

    const occurrenceIndex =
      state.activeTasks
        .slice(0, index + 1)
        .filter(
          (task) => task.schedulerQueued && task.taskId === activeTask.taskId,
        ).length - 1;

    nextState = removeQueuedTaskReservation(
      nextState,
      activeTask.taskId,
      occurrenceIndex,
    );
  }

  return syncCoreSchedulers({
    ...nextState,
    deadlockPressureSeconds: DEADLOCK_FAILURE_SECONDS,
    deadlockProcessLockout: true,
  });
};

const updateDeadlockPressure = (
  state: GameState,
  deltaSeconds: number,
): GameState => {
  const currentPressure = Math.max(0, state.deadlockPressureSeconds ?? 0);
  const activeScope = getActiveDeadlockPressureScope(state);

  if (activeScope) {
    const pressureSeconds = Math.min(
      DEADLOCK_FAILURE_SECONDS,
      currentPressure + deltaSeconds,
    );

    if (pressureSeconds >= DEADLOCK_FAILURE_SECONDS) {
      return cancelAllActiveTasksForDeadlockFailure({
        ...state,
        deadlockPressureResource: activeScope.resource,
        deadlockPressureCpuId: activeScope.cpuId,
      });
    }

    return {
      ...state,
      deadlockPressureSeconds: pressureSeconds,
      deadlockPressureResource: activeScope.resource,
      deadlockPressureCpuId: activeScope.cpuId,
    };
  }

  if (currentPressure <= 0) {
    return state.deadlockProcessLockout ||
      state.deadlockPressureResource !== null ||
      state.deadlockPressureCpuId !== null
      ? {
          ...state,
          deadlockProcessLockout: false,
          deadlockPressureResource: null,
          deadlockPressureCpuId: null,
        }
      : state;
  }

  const deadlockPressureSeconds = Math.max(
    0,
    currentPressure - getDeadlockCooldownRate(state) * deltaSeconds,
  );

  return {
    ...state,
    deadlockPressureSeconds,
    deadlockPressureResource:
      deadlockPressureSeconds > 0 ? state.deadlockPressureResource : null,
    deadlockPressureCpuId:
      deadlockPressureSeconds > 0 ? state.deadlockPressureCpuId : null,
    deadlockProcessLockout:
      deadlockPressureSeconds > 0 ? state.deadlockProcessLockout : false,
  };
};

const updatePowerOverloadFailure = (
  state: GameState,
  deltaSeconds: number,
  stressState: GameState = state,
): GameState => {
  const currentSeconds = Math.max(0, state.power.overloadFailureSeconds ?? 0);
  // Stress is integrated from the state that held over the slice (pre-slice),
  // not the settled endpoint, so a task completing exactly at the boundary
  // still contributes its overload pressure for the interval it ran.
  const psuStress = getPsuStress(stressState);
  const overloadRate =
    canRunPoweredWork(stressState) ? getPowerOverloadRate(psuStress) : 0;

  if (overloadRate > 0) {
    const overloadFailureSeconds = Math.min(
      POWER_OVERLOAD_FAILURE_SECONDS,
      currentSeconds + overloadRate * deltaSeconds,
    );

    if (overloadFailureSeconds >= POWER_OVERLOAD_FAILURE_SECONDS) {
      return forcePowerOffForPsuFailure({
        ...state,
        power: {
          ...state.power,
          overloadFailureSeconds,
        },
      });
    }

    return overloadFailureSeconds === currentSeconds
      ? state
      : {
          ...state,
          power: {
            ...state.power,
            overloadFailureSeconds,
          },
        };
  }

  if (currentSeconds <= 0) return state;

  return {
    ...state,
    power: {
      ...state.power,
      overloadFailureSeconds: Math.max(0, currentSeconds - deltaSeconds),
    },
  };
};

const clearAllWorkForHardPowerOff = (state: GameState): GameState =>
  syncCoreSchedulers({
    ...state,
    activeTasks: [],
    activeJobs: [],
    cacheResidency: [],
    queue: [],
    queueEntries: [],
    coreSchedulers: Object.fromEntries(
      getAllCoreIds(state).map((coreId) => [
        coreId,
        createCoreSchedulerState(coreId),
      ]),
    ) as GameState["coreSchedulers"],
  });

const forceHardPowerOff = (
  state: GameState,
  failureReason: PowerFailureReason | null,
): GameState => {
  const cleared = clearAllWorkForHardPowerOff(state);
  const currentFailureCount = Math.max(0, cleared.power.failureCount ?? 0);
  const failureCount =
    failureReason === null
      ? currentFailureCount
      : currentFailureCount + 1;

  return {
    ...cleared,
    power: {
      ...cleared.power,
      state: "off",
      transitionSeconds: 0,
      transitionTotalSeconds: 0,
      bootstrapGraceSeconds: 0,
      unpaidShutdownWarningSeconds: 0,
      overloadFailureSeconds: 0,
      lastFailureReason: failureReason,
      failureCount,
    },
  };
};

const forcePowerOffForPsuFailure = (state: GameState): GameState =>
  forceHardPowerOff(state, "psuOverload");

const tickActiveTasks = (
  state: GameState,
  deltaSeconds: number,
  exactDeltaSeconds: Amount,
): GameState => {
  const activeTasks: ActiveTask[] = [];

  state.activeTasks.forEach((activeTask, index) => {
    // One staged array shared by both aliases; building it twice per task made
    // staging O(tasks^2) allocations per system per tick (F-PERF-7).
    const stagedActiveTasks = [...activeTasks, ...state.activeTasks.slice(index)];
    const stagedState = {
      ...state,
      activeTasks: stagedActiveTasks,
      activeJobs: stagedActiveTasks,
    };
    activeTasks.push(
      tickActiveTask(
        stagedState,
        activeTask,
        deltaSeconds,
        exactDeltaSeconds,
        state,
      ),
    );
  });

  return syncCoreSchedulers({
    ...state,
    activeTasks,
    activeJobs: activeTasks,
  });
};

const advancePowerTransition = (state: GameState, deltaSeconds: number): GameState => {
  if (state.power.state !== "shuttingDown" && state.power.state !== "booting") {
    return state;
  }

  const transitionSeconds = Math.max(0, state.power.transitionSeconds - deltaSeconds);
  const waitingForActiveWork =
    state.power.state === "shuttingDown" && state.activeTasks.length > 0;
  if (transitionSeconds > 0) {
    return {
      ...state,
      power: {
        ...state.power,
        transitionSeconds,
      },
    };
  }

  if (waitingForActiveWork) {
    return {
      ...state,
      power: {
        ...state.power,
        transitionSeconds: 0,
      },
    };
  }

  return {
    ...state,
    power: {
      ...state.power,
      state: state.power.state === "shuttingDown" ? "off" : "on",
      transitionSeconds: 0,
      transitionTotalSeconds: 0,
    },
  };
};

const forcePowerOffForUnpaidBill = (state: GameState): GameState => {
  const withoutCredits = setExactResource(state, "credits", 0);
  return {
    ...withoutCredits,
    power: {
      ...withoutCredits.power,
      state: "off",
      transitionSeconds: 0,
      transitionTotalSeconds: 0,
      bootstrapGraceSeconds: 0,
      unpaidShutdownWarningSeconds: 0,
      overloadFailureSeconds: 0,
      lastFailureReason: "unpaidBill",
      failureCount: Math.max(0, withoutCredits.power.failureCount ?? 0) + 1,
    },
  };
};

const beginUnpaidShutdownWarning = (state: GameState): GameState => {
  const withoutCredits = setExactResource(state, "credits", 0);
  return {
    ...withoutCredits,
    power: {
      ...withoutCredits.power,
      bootstrapGraceSeconds: 0,
      unpaidShutdownWarningSeconds:
        withoutCredits.power.unpaidShutdownWarningSeconds > 0
          ? withoutCredits.power.unpaidShutdownWarningSeconds
          : POWER_UNPAID_SHUTDOWN_WARNING_SECONDS,
    },
  };
};

const clearBillingGraceIfFunded = (state: GameState): GameState => {
  if (
    amountCompare(state.exactResources.credits, 0) <= 0 ||
    (state.power.bootstrapGraceSeconds <= 0 &&
      state.power.unpaidShutdownWarningSeconds <= 0)
  ) {
    return state;
  }

  return {
    ...state,
    power: {
      ...state.power,
      bootstrapGraceSeconds: 0,
      unpaidShutdownWarningSeconds: 0,
    },
  };
};

const applyPowerBilling = (
  state: GameState,
  deltaSeconds: number,
  deltaMs: number,
  costPerSecondOverride?: Amount,
  deferUnpaidCutoff = false,
): GameState => {
  const fundedState = clearBillingGraceIfFunded(state);
  const warningSeconds = Math.max(
    0,
    fundedState.power.unpaidShutdownWarningSeconds ?? 0,
  );
  const costPerSecond =
    costPerSecondOverride ?? getPowerCostPerSecondExact(fundedState);

  if (warningSeconds > 0) {
    if (amountCompare(costPerSecond, 0) <= 0) {
      return {
        ...fundedState,
        power: {
          ...fundedState.power,
          unpaidShutdownWarningSeconds: 0,
        },
      };
    }

    const unpaidShutdownWarningSeconds = Math.max(
      0,
      warningSeconds - deltaSeconds,
    );

    if (unpaidShutdownWarningSeconds <= 0) {
      // The caller advances work through the pre-cutoff interval and applies
      // the hard shutdown at the slice endpoint, so a slice that reaches the
      // deadline performs the same work as any partition of the same span.
      return deferUnpaidCutoff
        ? {
            ...setExactResource(fundedState, "credits", 0),
            power: {
              ...fundedState.power,
              bootstrapGraceSeconds: 0,
              unpaidShutdownWarningSeconds: 0,
            },
          }
        : forcePowerOffForUnpaidBill(fundedState);
    }

      return {
        ...setExactResource(fundedState, "credits", 0),
        power: {
          ...fundedState.power,
        bootstrapGraceSeconds: 0,
        unpaidShutdownWarningSeconds,
      },
    };
  }

  const graceSeconds = Math.max(0, fundedState.power.bootstrapGraceSeconds ?? 0);
  if (amountCompare(fundedState.exactResources.credits, 0) <= 0 && graceSeconds > 0) {
    const bootstrapGraceSeconds = Math.max(0, graceSeconds - deltaSeconds);

    if (
      bootstrapGraceSeconds <= 0 &&
      amountCompare(costPerSecond, 0) > 0
    ) {
      // Any slice time past grace expiry keeps counting against the unpaid
      // warning, so crossing the boundary mid-slice matches slicing exactly
      // at it instead of granting a fresh full warning at the slice end.
      const overshootSeconds = Math.max(0, deltaSeconds - graceSeconds);
      const warned = beginUnpaidShutdownWarning({
        ...fundedState,
        power: {
          ...fundedState.power,
          bootstrapGraceSeconds: 0,
        },
      });
      if (overshootSeconds <= 0) return warned;
      const remainingWarningSeconds = Math.max(
        0,
        warned.power.unpaidShutdownWarningSeconds - overshootSeconds,
      );
      if (remainingWarningSeconds <= 0) {
        return deferUnpaidCutoff
          ? {
              ...warned,
              power: {
                ...warned.power,
                unpaidShutdownWarningSeconds: 0,
              },
            }
          : forcePowerOffForUnpaidBill(warned);
      }
      return {
        ...warned,
        power: {
          ...warned.power,
          unpaidShutdownWarningSeconds: remainingWarningSeconds,
        },
      };
    }

    return {
      ...fundedState,
      power: {
        ...fundedState.power,
        bootstrapGraceSeconds,
      },
    };
  }

  const exactPowerCost = amountMultiply(
    costPerSecond,
    amountDivide(amount(deltaMs), amount(1000)),
  );
  const billableState = fundedState;
  if (amountCompare(exactPowerCost, 0) <= 0) return billableState;

  if (amountCompare(billableState.exactResources.credits, exactPowerCost) < 0) {
    return beginUnpaidShutdownWarning(billableState);
  }

  const paidState = spendExact(
    billableState,
    [exactCost("credits", exactPowerCost)],
  );
  return amountCompare(paidState.exactResources.credits, POWER_BILLING_EPSILON) <= 0
    ? beginUnpaidShutdownWarning(paidState)
    : paidState;
};

const decayCronPowerSpike = (state: GameState, deltaSeconds: number): GameState => ({
  ...state,
  cron: {
    ...state.cron,
    queuePowerSpikeSeconds: Math.max(
      0,
      state.cron.queuePowerSpikeSeconds - deltaSeconds,
    ),
  },
});

const taskIsAlreadyCronOwned = (state: GameState, taskId: TaskId) =>
  state.queue.includes(taskId) ||
  state.activeTasks.some((task) => task.taskId === taskId);

const cronResult = (
  status: "queued" | "skipped" | "blocked",
  message: string,
  taskId: TaskId | null,
  tick: number,
) => ({
  status,
  message,
  taskId,
  tick,
});

const attemptCronRun = (
  state: GameState,
  schedule: GameState["cron"]["schedules"][number],
): { state: GameState; result: NonNullable<GameState["cron"]["schedules"][number]["lastResult"]> } => {
  const taskId = schedule.taskId;
  if (!isPowerOn(state)) {
    return { state, result: cronResult("skipped", "System offline.", taskId, state.tick) };
  }
  if (!taskId) {
    return { state, result: cronResult("skipped", "No system task selected.", null, state.tick) };
  }

  const task = getTaskDefinition(taskId);
  if (!isCronEligibleTask(state, task)) {
    return {
      state,
      result: cronResult("skipped", "Task hidden from CRON.", taskId, state.tick),
    };
  }
  if (!canAcceptTask(state, taskId)) {
    return {
      state,
      result: cronResult("blocked", "Task requirements blocked.", taskId, state.tick),
    };
  }
  if (taskIsAlreadyCronOwned(state, taskId)) {
    return {
      state,
      result: cronResult("skipped", "Task already active or queued.", taskId, state.tick),
    };
  }
  if (!canQueueTask(state, taskId)) {
    const queueFull =
      isSystemScheduledTask(task) && getAvailableSystemSchedulerSlots(state) <= 0;
    return {
      state,
      result: cronResult(
        queueFull ? "skipped" : "blocked",
        queueFull ? "System queue full." : "System scheduler blocked.",
        taskId,
        state.tick,
      ),
    };
  }

  const queued = enqueueTask(state, taskId);
  if (queued === state) {
    return {
      state,
      result: cronResult("blocked", "Queue attempt failed.", taskId, state.tick),
    };
  }

  return {
    state: {
      ...queued,
      cron: {
        ...queued.cron,
        queuePowerSpikeSeconds: Math.max(
          queued.cron.queuePowerSpikeSeconds,
          CRON_QUEUE_SPIKE_SECONDS,
        ),
      },
    },
    result: cronResult("queued", "Queued by CRON.", taskId, state.tick),
  };
};

const tickCron = (state: GameState, deltaSeconds: number): GameState => {
  const normalizedState = ensureCronState(state);
  if (!normalizedState.flags.cron || !isPowerOn(normalizedState)) {
    return normalizedState;
  }

  let workingState = normalizedState;
  const schedules: GameState["cron"]["schedules"] = [];

  for (const schedule of normalizedState.cron.schedules) {
    const normalizedSchedule = normalizeCronSchedule(workingState, schedule);
    if (!normalizedSchedule.enabled) {
      schedules.push(normalizedSchedule);
      continue;
    }

    const nextRemainingSeconds = normalizedSchedule.remainingSeconds - deltaSeconds;
    if (nextRemainingSeconds > 0) {
      schedules.push({
        ...normalizedSchedule,
        remainingSeconds: nextRemainingSeconds,
      });
      continue;
    }

    const attempt = attemptCronRun(workingState, normalizedSchedule);
    workingState = attempt.state;
    schedules.push({
      ...normalizedSchedule,
      remainingSeconds: getCronIntervalSeconds(workingState, normalizedSchedule),
      lastResult: attempt.result,
    });
  }

  return {
    ...workingState,
    cron: {
      ...workingState.cron,
      schedules,
    },
  };
};

const getOperationEventSeconds = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
) => {
  const definition = getOperation(task, operation.operationIndex);
  if (!definition) return 0;
  if (operation.status === "running") {
    if (amountCompare(operation.remainingCycles, ZERO_AMOUNT) <= 0) return 0;
    const rate = getOperationEffectiveClock(state, definition, operation.coreId);
    return rate > 0
      ? amountToSafeNumber(amountDivide(operation.remainingCycles, rate))
      : Number.POSITIVE_INFINITY;
  }
  if (operation.status === "loadingCache") {
    const loadRate = getCacheLoadRateForOperationTick(
      state,
      operation,
      definition,
    );
    const loadSeconds =
      amountCompare(operation.remainingLoadCycles, ZERO_AMOUNT) <= 0
        ? 0
        : loadRate > 0
        ? amountToSafeNumber(amountDivide(operation.remainingLoadCycles, loadRate))
        : Number.POSITIVE_INFINITY;
    if (!definition.memoryAction) return loadSeconds;
    const cpuRate = getEffectiveCoreClockHz(state, operation.coreId);
    const cpuSeconds =
      amountCompare(operation.remainingCycles, ZERO_AMOUNT) <= 0
        ? 0
        : cpuRate > 0
        ? amountToSafeNumber(amountDivide(operation.remainingCycles, cpuRate))
        : Number.POSITIVE_INFINITY;
    return Math.max(loadSeconds, cpuSeconds);
  }
  if (operation.status === "loadingRam") {
    if (amountCompare(operation.remainingLoadCycles, ZERO_AMOUNT) <= 0) return 0;
    if (operation.ramBlocks.length > 0) {
      const rates = getRamBlockLoadRatesForOperation(state, operation);
      const physicalRemainingBits = operation.ramBlocks.reduce(
        (total, block) =>
          total + Math.max(0, block.lengthBits - block.loadedBits),
        0,
      );
      if (physicalRemainingBits <= CACHE_CAPACITY_EPSILON) {
        const aggregateRate = rates.reduce((total, rate) => total + rate, 0);
        return aggregateRate > 0
          ? amountToSafeNumber(
              amountDivide(operation.remainingLoadCycles, aggregateRate),
            )
          : Number.POSITIVE_INFINITY;
      }
      return operation.ramBlocks.reduce((soonest, block, index) => {
        const rate = rates[index] ?? 0;
        const remainingBits = Math.max(0, block.lengthBits - block.loadedBits);
        return rate > 0 && remainingBits > 0
          ? Math.min(soonest, remainingBits / rate)
          : soonest;
      }, Number.POSITIVE_INFINITY);
    }
    const oneSecondLoad = getRamLoadCyclesForOperationTick(
      state,
      task,
      operation,
      1,
    );
    return oneSecondLoad > 0
      ? amountToSafeNumber(
          amountDivide(operation.remainingLoadCycles, oneSecondLoad),
        )
      : Number.POSITIVE_INFINITY;
  }
  if (
    operation.status === "waitingMemory" ||
    operation.status === "waitingBarrier"
  ) {
    return 0;
  }
  if (operation.status === "deadlocked") return 0.1;
  return Number.POSITIVE_INFINITY;
};

interface OfflineSystemActivity {
  productiveSystemIds: Set<number>;
  localWorkSystemIds: Set<number>;
  storageWorkSystemIds: Set<number>;
}

/**
 * Hoists one system's slices from an ensureSystems-normalized fleet onto the
 * top level without re-normalizing every other system. materializeSystem runs
 * ensureSystems (O(fleet) hardware re-normalization) on every call, so calling
 * it per system inside per-tick loops and event queries made each tick
 * O(fleet^2) (F-PERF-4). Callers must pass a state whose `systems` array came
 * from ensureSystems (or normalizeGameForSimulation).
 */
const hoistEnsuredSystem = (
  ensured: GameState,
  system: GameState["systems"][number],
): GameState =>
  syncCoreSchedulers({
    ...ensured,
    selectedSystemId: system.id,
    hardware: system.hardware,
    workshop: system.workshop,
    power: system.power,
    cron: system.cron,
    activeTasks: system.activeTasks,
    activeJobs: system.activeTasks,
    cacheResidency: system.cacheResidency,
    coreSchedulers: system.coreSchedulers,
    queue: system.queue,
    queueEntries: system.queueEntries ?? [],
    deadlockPressureSeconds: system.deadlockPressureSeconds,
    deadlockPressureResource: system.deadlockPressureResource,
    deadlockPressureCpuId: system.deadlockPressureCpuId,
    deadlockProcessLockout: system.deadlockProcessLockout,
  });

const getOfflineSystemActivity = (state: GameState): OfflineSystemActivity => {
  const departureLevelIndex = getAutomationBufferLevelIndex(
    state.automationBuffer.departureLevelId,
  );
  const contractsCanRun =
    departureLevelIndex >= getAutomationBufferLevelIndex("localScheduler");
  const projectsAndStorageCanRun =
    departureLevelIndex >= getAutomationBufferLevelIndex("systemScheduler");
  const contractSystemIds = contractsCanRun
    ? new Set(state.contracts.active.map((contract) => contract.systemId))
    : new Set<number>();
  const projectSystemIds = projectsAndStorageCanRun
    ? new Set(
        Object.values(state.projects.progress)
          .filter((progress) => progress?.active && !progress.completed)
          .flatMap((progress) =>
            progress?.systemId === null || progress?.systemId === undefined
              ? []
              : [progress.systemId],
          ),
      )
    : new Set<number>();
  const runnableClusterNodeIds = new Set(
    getRunnableClusterNodeIds(state, "offline"),
  );
  const clusterSystemIds = new Set(
    state.infrastructure.fleetNodes.flatMap((node) =>
      runnableClusterNodeIds.has(node.id) && node.source.kind === "system"
        ? [node.source.systemId]
        : [],
    ),
  );

  const activity: OfflineSystemActivity = {
    productiveSystemIds: new Set<number>(),
    localWorkSystemIds: new Set<number>(),
    storageWorkSystemIds: new Set<number>(),
  };
  const ensured = ensureSystems(state);
  for (const system of ensured.systems) {
    const local = hoistEnsuredSystem(ensured, system);
    const queueWouldStart =
      local.queue.length > 0 &&
      pullQueue(local).activeTasks.length > local.activeTasks.length;
    const localWork = local.activeTasks.length > 0 || queueWouldStart;
    const storageWork =
      projectsAndStorageCanRun &&
      local.workshop.activeStorageWorkload !== null;
    const projectedLoad = projectSystemAutomatedLoad(
      local,
      localWork,
      storageWork,
    );
    const safe =
      local.power.state === "on" &&
      getPsuStress(projectedLoad) <= 1 &&
      !local.activeTasks.some((task) =>
        task.coreOperations.some(
          (operation) => operation.status === "deadlocked",
        ),
      );
    if (!safe) continue;
    if (localWork) {
      activity.localWorkSystemIds.add(system.id);
    }
    if (storageWork) {
      activity.storageWorkSystemIds.add(system.id);
    }
    if (
      activity.localWorkSystemIds.has(system.id) ||
      activity.storageWorkSystemIds.has(system.id) ||
      contractSystemIds.has(system.id) ||
      projectSystemIds.has(system.id) ||
      clusterSystemIds.has(system.id)
    ) {
      activity.productiveSystemIds.add(system.id);
    }
  }
  return activity;
};

const getOfflineProductiveSystemIdSet = (state: GameState) =>
  getOfflineSystemActivity(state).productiveSystemIds;

/** Physical systems whose automated work can advance during this absence slice. */
export const getOfflineProductiveSystemIds = (state: GameState) =>
  [...getOfflineProductiveSystemIdSet(state)].sort((left, right) => left - right);

/**
 * Soonest deadlock-recovery boundary (lockout pressure decaying to zero)
 * across all systems, in milliseconds. Offline advancement pauses only up to
 * this boundary so queued work resumes after the same ~10 s cooldown that
 * foreground play observes, instead of stalling for the whole absence.
 */
export const getOfflineDeadlockRecoveryEventMs = (
  state: GameState,
): number | null => {
  let soonestMs: number | null = null;
  const ensured = ensureSystems(state);
  for (const system of ensured.systems) {
    const local = hoistEnsuredSystem(ensured, system);
    const pressureSeconds = Math.max(0, local.deadlockPressureSeconds ?? 0);
    if (pressureSeconds <= 0) continue;
    if (getActiveDeadlockPressureScope(local) !== null) continue;
    const cooldownRate = getDeadlockCooldownRate(local);
    if (cooldownRate <= 0) continue;
    const eventMs = (pressureSeconds / cooldownRate) * 1000;
    soonestMs = soonestMs === null ? eventMs : Math.min(soonestMs, eventMs);
  }
  return soonestMs;
};

const projectSystemAutomatedLoad = (
  state: GameState,
  advanceAutomatedWork: boolean,
  advanceStorage: boolean,
): GameState => {
  const localLoadState = advanceAutomatedWork
    ? state
    : {
        ...state,
        activeTasks: [],
        activeJobs: [],
        cron: { ...state.cron, queuePowerSpikeSeconds: 0 },
      };
  return advanceStorage
    ? localLoadState
    : {
        ...localLoadState,
        workshop: {
          ...localLoadState.workshop,
          activeStorageWorkload: null,
        },
      };
};

interface SingleSystemEventPolicy {
  productive: boolean;
  advanceAutomatedWork: boolean;
  advanceStorage: boolean;
}

const getSingleSystemEventSeconds = (
  state: GameState,
  policy: SingleSystemEventPolicy = {
    productive: true,
    advanceAutomatedWork: true,
    advanceStorage: true,
  },
) => {
  const candidates: number[] = [];
  const thermalEventState = projectSystemAutomatedLoad(
    state,
    policy.advanceAutomatedWork,
    policy.advanceStorage,
  );
  const thermalEventMs = getNextWorkshopThermalEventMs(
    thermalEventState,
    getBaseHardwareDrawWatts(thermalEventState),
  );
  if (thermalEventMs !== null) {
    candidates.push(amountToSafeNumber(thermalEventMs) / 1000);
  }
  if (policy.advanceStorage) {
    const storageEventMs = getNextWorkshopStorageEventMs(state);
    if (storageEventMs !== null) {
      candidates.push(amountToSafeNumber(storageEventMs) / 1000);
    }
  }
  if (state.power.transitionSeconds > 0) {
    candidates.push(state.power.transitionSeconds);
  }
  if (policy.productive && state.power.unpaidShutdownWarningSeconds > 0) {
    candidates.push(state.power.unpaidShutdownWarningSeconds);
  }
  if (
    policy.productive &&
    (state.power.bootstrapGraceSeconds ?? 0) > 0 &&
    amountCompare(state.exactResources.credits, 0) <= 0
  ) {
    candidates.push(state.power.bootstrapGraceSeconds);
  }
  if (
    policy.productive &&
    canRunPoweredWork(state)
  ) {
    const overloadRate = getPowerOverloadRate(getPsuStress(thermalEventState));
    if (overloadRate > 0) {
      candidates.push(
        Math.max(
          0,
          POWER_OVERLOAD_FAILURE_SECONDS -
            Math.max(0, state.power.overloadFailureSeconds ?? 0),
        ) / overloadRate,
      );
    }
  }
  {
    const deadlockPressureSeconds = Math.max(
      0,
      state.deadlockPressureSeconds ?? 0,
    );
    if (getActiveDeadlockPressureScope(state) !== null) {
      if (policy.advanceAutomatedWork) {
        candidates.push(
          Math.max(0, DEADLOCK_FAILURE_SECONDS - deadlockPressureSeconds),
        );
      }
    } else if (deadlockPressureSeconds > 0) {
      const cooldownRate = getDeadlockCooldownRate(state);
      if (cooldownRate > 0) {
        candidates.push(deadlockPressureSeconds / cooldownRate);
      }
    }
  }
  if (policy.advanceAutomatedWork && state.cron.queuePowerSpikeSeconds > 0) {
    candidates.push(state.cron.queuePowerSpikeSeconds);
  }
  if (policy.advanceAutomatedWork) {
    for (const schedule of state.cron.schedules) {
      if (schedule.enabled && schedule.remainingSeconds > 0) {
        candidates.push(schedule.remainingSeconds);
      }
    }
  }
  if (policy.advanceAutomatedWork) {
    for (const task of state.activeTasks) {
      for (const operation of task.coreOperations) {
        candidates.push(getOperationEventSeconds(state, task, operation));
      }
    }
  }
  return Math.min(
    ...candidates.filter((seconds) => Number.isFinite(seconds) && seconds >= 0),
    Number.POSITIVE_INFINITY,
  );
};

/** Exact aggregate physical-system power rate that will be billed this slice. */
export const getSystemPowerOperatingCostPerSecond = (
  state: GameState,
  mode: AdvanceMode = "foreground",
) => {
  const offlineActivity =
    mode === "offline" ? getOfflineSystemActivity(state) : null;
  const ensured = ensureSystems(state);
  return ensured.systems.reduce((total, system) => {
    if (
      offlineActivity &&
      !offlineActivity.productiveSystemIds.has(system.id)
    ) {
      return total;
    }
    const local = hoistEnsuredSystem(ensured, system);
    // Offline safety checks need the full productive rate even if a warning
    // was saved at departure, so absence advancement pauses before failure.
    if (mode === "offline") {
      const billableLoad = projectSystemAutomatedLoad(
        local,
        offlineActivity!.localWorkSystemIds.has(system.id),
        offlineActivity!.storageWorkSystemIds.has(system.id),
      );
      return amountAdd(total, getPowerCostPerSecondExact(billableLoad));
    }
    if ((local.power.unpaidShutdownWarningSeconds ?? 0) > 0) return total;
    if (
      amountCompare(local.exactResources.credits, 0) <= 0 &&
      (local.power.bootstrapGraceSeconds ?? 0) > 0
    ) {
      return total;
    }
    return amountAdd(total, getPowerCostPerSecondExact(local));
  }, ZERO_AMOUNT);
};

const getNextSimulationEventMsFromNormalizedState = (
  ensured: GameState,
  maximumMs: number,
  mode: AdvanceMode,
) => {
  const offlineActivity =
    mode === "offline" ? getOfflineSystemActivity(ensured) : null;
  const clusterEvent = getNextClusterWorkloadEventMs(ensured, mode);
  const clusterEventMs =
    clusterEvent === null
      ? maximumMs
      : amountToSafeNumber(amountMin(clusterEvent, amount(maximumMs)));
  const cloudEventMs = Math.min(
    maximumMs,
    getNextNormalizedRunnableCloudGameEventMs(ensured, maximumMs, mode),
  );
  const liveOperationsEventMs = getNextLiveOperationsEventMs(
    ensured,
    maximumMs,
    mode,
  );
  const sharedOperatingCostPerSecond = amountAdd(
    amountAdd(
      getSystemPowerOperatingCostPerSecond(ensured, mode),
      getClusterWorkloadOperatingCostPerSecond(ensured, mode),
    ),
    hasActiveCloudWork(ensured) &&
      getNormalizedCloudAdvanceBlockedReason(ensured, mode) === null
      ? getNormalizedCloudOperatingCostPerSecond(ensured, mode)
      : ZERO_AMOUNT,
  );
  const sharedCreditEventMs =
    amountCompare(sharedOperatingCostPerSecond, 0) > 0
      ? amountToSafeNumber(
          amountMin(
            amountMultiply(
              amountDivide(
                ensured.exactResources.credits,
                sharedOperatingCostPerSecond,
              ),
              1000,
            ),
            amount(maximumMs),
          ),
        )
      : maximumMs;
  const ensuredFleet = ensureSystems(ensured);
  const eventMs = Math.min(
    ...ensuredFleet.systems.map(
      (system) => {
        const productive =
          mode !== "offline" ||
          offlineActivity?.productiveSystemIds.has(system.id) === true;
        const advanceAutomatedWork =
          mode !== "offline" ||
          offlineActivity?.localWorkSystemIds.has(system.id) === true;
        return (
          getSingleSystemEventSeconds(hoistEnsuredSystem(ensuredFleet, system), {
            productive,
            advanceAutomatedWork,
            advanceStorage:
              mode !== "offline" ||
              offlineActivity?.storageWorkSystemIds.has(system.id) === true,
          }) * 1000
        );
      },
    ),
    clusterEventMs,
    cloudEventMs,
    liveOperationsEventMs,
    sharedCreditEventMs,
    maximumMs,
  );
  if (!Number.isFinite(eventMs)) return maximumMs;
  const nearestMillisecond = Math.round(eventMs);
  const normalizedEventMs =
    Math.abs(eventMs - nearestMillisecond) < 0.000001
      ? nearestMillisecond
      : Math.round(eventMs * 1_000_000_000) / 1_000_000_000;
  return Math.max(
    0,
    Math.min(
      maximumMs,
      normalizedEventMs,
      clusterEventMs,
      cloudEventMs,
      liveOperationsEventMs,
      sharedCreditEventMs,
    ),
  );
};

/** Next known operation, CRON, or power boundary across all simulated systems. */
export const getNextSimulationEventMs = (
  state: GameState,
  maximumMs: number,
  mode: AdvanceMode = "foreground",
) =>
  getNextSimulationEventMsFromNormalizedState(
    syncLiveOperationsAllocation(
      normalizeCloudForGameState(syncSelectedSystemRuntime(state)),
      mode,
    ),
    maximumMs,
    mode,
  );

/** Internal event projection for an advance that normalized its public input once. */
export const getNextNormalizedSimulationEventMs = (
  state: GameState,
  maximumMs: number,
  mode: AdvanceMode = "foreground",
) =>
  getNextSimulationEventMsFromNormalizedState(
    syncLiveOperationsAllocation(state, mode),
    maximumMs,
    mode,
  );

interface SingleSystemTickPolicy {
  billPower: boolean;
  advanceAutomatedWork: boolean;
  advanceWorkshopStorage: boolean;
  accrueDestructivePressure: boolean;
}

const foregroundSystemTickPolicy: SingleSystemTickPolicy = {
  billPower: true,
  advanceAutomatedWork: true,
  advanceWorkshopStorage: true,
  accrueDestructivePressure: true,
};

const tickSingleSystem = (
  state: GameState,
  deltaMs: number,
  policy: SingleSystemTickPolicy = foregroundSystemTickPolicy,
): GameState => {
  if (!Number.isFinite(deltaMs)) {
    throw new RangeError("Simulation elapsed time must be finite");
  }
  const elapsedMs = Math.max(0, deltaMs);
  const deltaSeconds = elapsedMs / 1000;
  const exactDeltaSeconds = amountDivide(amount(elapsedMs), "1000");
  const ticked = {
    ...ensureCronState(syncCoreSchedulers(updateProgressionFlags(state))),
    tick: state.tick + deltaSeconds,
    cacheResidency: policy.advanceAutomatedWork ? [] : state.cacheResidency,
  };
  // Idle and blocked systems still cool, but saved work that cannot run must
  // not contribute active CPU or storage heat during the absence.
  const thermalLoadState = projectSystemAutomatedLoad(
    ticked,
    policy.advanceAutomatedWork,
    policy.advanceWorkshopStorage,
  );
  const thermalBasePowerWatts = getBaseHardwareDrawWatts(thermalLoadState);
  const thermalEnvironment = getWorkshopThermalEnvironment(
    thermalLoadState,
    thermalBasePowerWatts,
  );
  const advanceThermalForSlice = (nextState: GameState) =>
    advanceWorkshopThermal(
      nextState,
      thermalBasePowerWatts,
      elapsedMs,
      thermalEnvironment,
    );
  // Destructive pressure integrates the load that actually held over the
  // slice: thermalLoadState is the projected pre-slice state, shared with
  // thermal heating and power billing.
  const applyDestructivePressure = (nextState: GameState) =>
    policy.accrueDestructivePressure
      ? updatePowerOverloadFailure(nextState, deltaSeconds, thermalLoadState)
      : nextState;
  const wasPoweredOn = canRunPoweredWork(ticked);
  const transitioned = advancePowerTransition(ticked, deltaSeconds);
  // Billing uses the pre-transition rate so a slice ending exactly at a
  // boot/shutdown boundary bills the state that held over the interval.
  const preSliceCostPerSecond = getPowerCostPerSecondExact(thermalLoadState);
  const warningSecondsAtStart = Math.max(
    0,
    ticked.power.unpaidShutdownWarningSeconds ?? 0,
  );
  const graceSecondsAtStart = Math.max(
    0,
    ticked.power.bootstrapGraceSeconds ?? 0,
  );
  const unpaidRunwaySeconds =
    warningSecondsAtStart > 0
      ? warningSecondsAtStart
      : graceSecondsAtStart > 0
        ? graceSecondsAtStart + POWER_UNPAID_SHUTDOWN_WARNING_SECONDS
        : Number.POSITIVE_INFINITY;
  // The unpaid cutoff belongs to the slice endpoint: work advances through
  // the interval that reaches the deadline, then the hard shutdown applies.
  const unpaidCutoffAtSliceEnd =
    policy.billPower &&
    wasPoweredOn &&
    amountCompare(ticked.exactResources.credits, 0) <= 0 &&
    amountCompare(preSliceCostPerSecond, 0) > 0 &&
    deltaSeconds >= unpaidRunwaySeconds;
  const billed = policy.billPower
    ? applyPowerBilling(
        transitioned,
        deltaSeconds,
        elapsedMs,
        preSliceCostPerSecond,
        unpaidCutoffAtSliceEnd,
      )
    : transitioned;
  const powered = policy.advanceAutomatedWork
    ? decayCronPowerSpike(billed, deltaSeconds)
    : billed;

  if (!wasPoweredOn || !canRunPoweredWork(powered)) {
    return updateProgressionFlags(
      syncCoreSchedulers(
        applyDestructivePressure(advanceThermalForSlice(powered)),
      ),
    );
  }

  const cronTicked =
    policy.advanceAutomatedWork && canAcceptPoweredWork(powered)
      ? tickCron(powered, deltaSeconds)
      : powered;
  const taskAdvanced = policy.advanceAutomatedWork
    ? tickActiveTasks(cronTicked, deltaSeconds, exactDeltaSeconds)
    : cronTicked;
  const storageAdvanced = policy.advanceWorkshopStorage
    ? advanceWorkshopStorageWorkload(taskAdvanced, elapsedMs)
    : taskAdvanced;
  const advanced = advanceThermalForSlice(storageAdvanced);
  const settled = policy.advanceAutomatedWork
    ? settleActiveTasks(advanced)
    : advanced;
  const funded = policy.billPower
    ? clearBillingGraceIfFunded(settled)
    : settled;
  // A settlement that lands funding exactly at the deadline saves the system;
  // otherwise the deferred unpaid cutoff applies at the slice endpoint.
  const cutoffApplied =
    unpaidCutoffAtSliceEnd &&
    amountCompare(funded.exactResources.credits, 0) <= 0
      ? forcePowerOffForUnpaidBill(funded)
      : funded;
  const watched = policy.advanceAutomatedWork
    ? applySchedulerWatchdogs(cutoffApplied)
    : cutoffApplied;
  const overloadChecked = applyDestructivePressure(watched);
  // Deadlock recovery pressure cools whenever no live deadlock holds it, even
  // during paused/offline slices, so a lockout never outlasts an absence.
  const pressured =
    policy.advanceAutomatedWork ||
    getActiveDeadlockPressureScope(overloadChecked) === null
      ? updateDeadlockPressure(overloadChecked, deltaSeconds)
      : overloadChecked;

  const progressed = updateProgressionFlags(pressured);
  return policy.advanceAutomatedWork && canAcceptPoweredWork(progressed)
    ? pullQueue(progressed)
    : syncCoreSchedulers(progressed);
};

const hardPowerOffAllSystemsForUnpaidBill = (state: GameState): GameState => {
  const ensured = ensureSystems(state);
  return replaceSystems(
    setExactResource(state, "credits", 0),
    ensured.systems.map((system) => {
      if (system.power.state === "off") return system;
      const localState = hoistEnsuredSystem(ensured, system);
      const poweredOff = forcePowerOffForUnpaidBill(localState);
      return {
        ...system,
        power: poweredOff.power,
        activeTasks: [],
        activeJobs: [],
        cacheResidency: [],
        queue: [],
        queueEntries: [],
        coreSchedulers: poweredOff.coreSchedulers,
      };
    }),
  );
};

/** Canonicalizes a public simulation input before an event-sliced advance. */
export const normalizeGameForSimulation = (state: GameState) =>
  normalizeLiveOperationsForGameState(
    normalizeCloudForGameState(
      syncSelectedSystemRuntime(syncExactResources(state)),
    ),
  );

const hasCloudRuntimeBoundary = (state: GameState) => {
  const activeZone = state.cloud.zones.find(
    (zone) => zone.id === state.cloud.failover.activeZoneId,
  );
  const automaticFailoverNeeded =
    state.cloud.automaticFailover &&
    state.cloud.zones.length > 0 &&
    (!activeZone || activeZone.configuredStatus === "paused");
  return (
    hasActiveCloudWork(state) ||
    automaticFailoverNeeded ||
    state.cloud.failover.pendingZoneId !== null ||
    state.cloud.failover.completesAtMs !== null ||
    state.cloud.incidents.length > 0
  );
};

const advanceQuiescentCloudClock = (
  state: GameState,
  deltaMs: number,
): GameState => {
  const combinedElapsedMs =
    state.cloud.advanceRemainderMs + Math.max(0, deltaMs);
  const wholeElapsedMs = Math.floor(combinedElapsedMs);
  return {
    ...state,
    cloud: {
      ...state.cloud,
      elapsedMs:
        state.cloud.elapsedMs +
        Math.max(
          0,
          Math.min(
            wholeElapsedMs,
            Number.MAX_SAFE_INTEGER - state.cloud.elapsedMs,
          ),
        ),
      advanceRemainderMs: combinedElapsedMs - wholeElapsedMs,
    },
  };
};

/** Internal tick for state canonicalized by normalizeGameForSimulation. */
export const tickNormalizedGame = (
  ensured: GameState,
  deltaMs: number,
  mode: AdvanceMode = "foreground",
): GameState => {
  const scheduled = syncLiveOperationsAllocation(ensured, mode);
  const baseTick = scheduled.tick;
  let workingState = materializeSystem(scheduled, scheduled.selectedSystemId);
  let unpaidBill = false;
  const offlineActivity =
    mode === "offline" ? getOfflineSystemActivity(scheduled) : null;

  const systems = scheduled.systems.map((system) => {
    // scheduled.systems came from normalizeGameForSimulation, so each system
    // is hoisted directly; re-running materializeSystem here re-normalized the
    // whole fleet once per system, making ticks O(fleet^2) (F-PERF-4).
    const localInput = hoistEnsuredSystem(
      {
        ...workingState,
        systems: scheduled.systems,
        tick: baseTick,
      },
      system,
    );
    const productive =
      mode !== "offline" ||
      offlineActivity?.productiveSystemIds.has(system.id) === true;
    const localOutput = tickSingleSystem(localInput, deltaMs, {
      billPower: productive,
      advanceAutomatedWork:
        mode !== "offline" ||
        offlineActivity?.localWorkSystemIds.has(system.id) === true,
      advanceWorkshopStorage:
        mode !== "offline" ||
        offlineActivity?.storageWorkSystemIds.has(system.id) === true,
      accrueDestructivePressure: productive,
    });
    if (
      system.power.state !== "off" &&
      localOutput.power.state === "off" &&
      localOutput.power.lastFailureReason === "unpaidBill"
    ) {
      unpaidBill = true;
    }
    workingState = {
      ...workingState,
      resources: localOutput.resources,
      exactResources: localOutput.exactResources,
      research: localOutput.research,
      flags: localOutput.flags,
      completedTasks: localOutput.completedTasks,
      completedJobs: localOutput.completedJobs,
      taskRewardCreditsEarned: localOutput.taskRewardCreditsEarned,
      taskWorkCyclesCompleted: localOutput.taskWorkCyclesCompleted,
      standingTaskCompletions: localOutput.standingTaskCompletions,
      standingTaskRewardCreditsEarned:
        localOutput.standingTaskRewardCreditsEarned,
      standingTaskDataEarned: localOutput.standingTaskDataEarned,
      standingTaskWorkCyclesCompleted:
        localOutput.standingTaskWorkCyclesCompleted,
      completedBenchmarks: localOutput.completedBenchmarks,
      nextInstanceId: localOutput.nextInstanceId,
      tick: localOutput.tick,
    };
    return {
      ...system,
      hardware: localOutput.hardware,
      workshop: localOutput.workshop,
      power: localOutput.power,
      cron: localOutput.cron,
      activeTasks: localOutput.activeTasks,
      activeJobs: localOutput.activeTasks,
      cacheResidency: localOutput.cacheResidency,
      coreSchedulers: localOutput.coreSchedulers,
      queue: localOutput.queue,
      queueEntries: localOutput.queueEntries ?? [],
      deadlockPressureSeconds: localOutput.deadlockPressureSeconds,
      deadlockPressureResource: localOutput.deadlockPressureResource,
      deadlockPressureCpuId: localOutput.deadlockPressureCpuId,
      deadlockProcessLockout: localOutput.deadlockProcessLockout,
    };
  });
  workingState = {
    ...workingState,
    tick: baseTick + Math.max(0, deltaMs) / 1000,
  };

  const ticked = replaceSystems(
    {
      ...workingState,
      systems,
      selectedSystemId: scheduled.selectedSystemId,
      rack: scheduled.rack,
    },
    systems,
    scheduled.selectedSystemId,
  );

  const systemAdvanced = syncExactResources(
    unpaidBill ? hardPowerOffAllSystemsForUnpaidBill(ticked) : ticked,
  );
  const liveOperationsAdvanced = advanceLiveOperations(
    systemAdvanced,
    deltaMs,
    mode,
  );
  const activeClusterWork = hasActiveClusterWorkloads(liveOperationsAdvanced);
  const clusterFacilityIds = activeClusterWork
    ? getProductiveClusterFacilityIds(liveOperationsAdvanced, mode)
    : [];
  const clusterAdvanced = activeClusterWork
    ? advanceClusterWorkloads(liveOperationsAdvanced, deltaMs, mode)
    : {
        ...liveOperationsAdvanced,
        infrastructure: {
          ...liveOperationsAdvanced.infrastructure,
          elapsedMs:
            liveOperationsAdvanced.infrastructure.elapsedMs +
            Math.max(0, deltaMs),
        },
      };
  const cloudAdvanced = hasCloudRuntimeBoundary(clusterAdvanced)
    ? advanceNormalizedCloudForGameState(
        clusterAdvanced,
        deltaMs,
        mode,
        clusterFacilityIds,
      )
    : advanceQuiescentCloudClock(clusterAdvanced, deltaMs);
  return syncLiveOperationsAllocation(
    finalizeNormalizedGameMutation(syncExactResources(cloudAdvanced)),
    mode,
  );
};

export const tickGame = (
  state: GameState,
  deltaMs: number,
  mode: AdvanceMode = "foreground",
): GameState =>
  tickNormalizedGame(normalizeGameForSimulation(state), deltaMs, mode);

const startTaskWithOrigin = (
  state: GameState,
  taskId: TaskId,
  workOrigin?: WorkOrigin,
) => {
  // These IDs are engine-owned attended work, never public task dispatches.
  if (isLiveOperationsTaskId(taskId)) return state;
  if (isSystemManaged(state, state.selectedSystemId)) return state;
  const task = getTaskDefinition(taskId);

  if (isSystemScheduledTask(task)) {
    const queued = enqueueTask(state, taskId, undefined, workOrigin);
    return queued === state ? state : pullQueue(queued);
  }

  if (task.requiresCpuScheduler) {
    const queued = enqueueTask(state, taskId, undefined, workOrigin);
    return queued === state ? state : pullQueue(queued);
  }

  const started = assignTaskToIdleCores(
    state,
    taskId,
    undefined,
    false,
    Number.POSITIVE_INFINITY,
    { workOrigin },
  );

  if (started !== state) return started;

  return enqueueTask(state, taskId, undefined, workOrigin);
};

export const startTask = (state: GameState, taskId: TaskId) =>
  startTaskWithOrigin(state, taskId);

/** Engine-only standing renewal path; public GameAction cannot provide provenance. */
export const startStandingOrderTask = (
  state: GameState,
  taskId: TaskId,
  systemId: number,
) => {
  const ensured = normalizeCloudForGameState(
    syncSelectedSystemRuntime(syncExactResources(state)),
  );
  const materialized = materializeSystem(ensured, systemId);
  const updated = startTaskWithOrigin(
    materialized,
    taskId,
    "standing-order",
  );
  return finalizeGameMutation(
    syncExactResources(
      updateMaterializedSystem(ensured, updated, systemId),
    ),
  );
};

export const startTaskOnCore = (
  state: GameState,
  taskId: TaskId,
  coreId: number,
) => {
  if (isLiveOperationsTaskId(taskId)) return state;
  if (isSystemManaged(state, state.selectedSystemId)) return state;
  if (!getAllCoreIds(state).includes(coreId)) return state;
  const task = getTaskDefinition(taskId);
  if (isSystemScheduledTask(task) || task.requiresCpuScheduler) return state;

  return assignTaskToCores(state, taskId, coreId);
};

export const queueTask = (state: GameState, taskId: TaskId, cpuId?: number) =>
  isLiveOperationsTaskId(taskId) || isSystemManaged(state, state.selectedSystemId)
    ? state
    : enqueueTask(state, taskId, cpuId);

export const cancelQueuedTaskById = (state: GameState, taskId: TaskId) =>
  isSystemManaged(state, state.selectedSystemId)
    ? state
    : cancelQueuedTask(state, taskId);

export const buyResearch = (state: GameState, researchId: ResearchId) => {
  if (
    isLegacyActionBlockedByManagedSystem(state, {
      type: "buyResearch",
      researchId,
    })
  ) {
    return state;
  }
  const research = getResearchDefinition(researchId);
  const costs = research.cost(state);
  const completed = state.research.completed.includes(researchId);

  if (researchId === "cStateControl" && completed) {
    const cStateUpgrade = getUpgradeDefinition("cState");
    const upgradeCosts = cStateUpgrade.cost(state);

    if (!cStateUpgrade.requirement(state) || !canAfford(state, upgradeCosts)) {
      return state;
    }

    const bought = cStateUpgrade.buy(spend(state, upgradeCosts));
    return pullQueue(updateProgressionFlags(bought));
  }

  if (researchId === "memoryVoltageModifier" && completed) {
    const memoryVoltageUpgrade = getUpgradeDefinition("memoryVoltage");
    const upgradeCosts = memoryVoltageUpgrade.cost(state);

    if (
      !memoryVoltageUpgrade.requirement(state) ||
      !canAfford(state, upgradeCosts)
    ) {
      return state;
    }

    const bought = memoryVoltageUpgrade.buy(spend(state, upgradeCosts));
    return pullQueue(updateProgressionFlags(bought));
  }

  if (researchId === "bootloader" && completed) {
    const bootloaderUpgrade = getUpgradeDefinition("bootloader");
    const upgradeCosts = bootloaderUpgrade.cost(state);

    if (!bootloaderUpgrade.requirement(state) || !canAfford(state, upgradeCosts)) {
      return state;
    }

    const bought = bootloaderUpgrade.buy(spend(state, upgradeCosts));
    return pullQueue(updateProgressionFlags(bought));
  }

  if (researchId === "clickRateTuning" && completed) {
    return state;
  }

  if (researchId === "clickRateTuning") return state;

  if (
    completed ||
    !research.requirement(state) ||
    !canAfford(state, costs)
  ) {
    return state;
  }

  const bought = {
    ...spend(state, costs),
    research: {
      ...state.research,
      completed: [...state.research.completed, researchId],
    },
  };
  return pullQueue(ensureCronState(updateProgressionFlags(bought)));
};

export const buyUpgrade = (
  state: GameState,
  upgradeId: UpgradeId,
  coreId?: number,
  cpuId?: number,
  sourceCpuId?: number,
  coreIds?: number[],
  ramStickId?: number,
  ramStickIds?: number[],
  ramTierId?: CpuTierId,
) => {
  if (isSystemManaged(state, state.selectedSystemId)) return state;
  const upgrade = getUpgradeDefinition(upgradeId);
  const context = {
    coreId,
    coreIds,
    cpuId,
    sourceCpuId,
    ramStickId,
    ramStickIds,
    ramTierId,
  };
  const costs = upgrade.cost(state, context);
  const maxed =
    upgrade.maxPurchases !== undefined &&
    getUpgradeCount(state, upgradeId, context) >= upgrade.maxPurchases;

  if (!upgrade.requirement(state) || maxed || !canAfford(state, costs)) {
    return state;
  }

  const bought = upgrade.buy(spend(state, costs), context);
  return pullQueue(updateProgressionFlags(bought));
};

const addRefunds = (state: GameState, refunds: Cost[]): GameState =>
  addCosts(state, refunds);

export const downgradeUpgrade = (
  state: GameState,
  upgradeId: UpgradeId,
  coreId?: number,
  cpuId?: number,
  sourceCpuId?: number,
  coreIds?: number[],
  ramStickId?: number,
  ramStickIds?: number[],
  ramTierId?: CpuTierId,
) => {
  if (isSystemManaged(state, state.selectedSystemId)) return state;
  const upgrade = getUpgradeDefinition(upgradeId);
  const context = {
    coreId,
    coreIds,
    cpuId,
    sourceCpuId,
    ramStickId,
    ramStickIds,
    ramTierId,
  };
  const refunds = getUpgradeRefund(state, upgradeId, context);

  if (
    !upgrade.downgrade ||
    refunds.length === 0 ||
    getUpgradeDowngradeBlockedReason(state, upgradeId, context)
  ) {
    return state;
  }

  const downgraded = upgrade.downgrade(state, context);
  return pullQueue(updateProgressionFlags(addRefunds(downgraded, refunds)));
};

export const startJob = startTask;

export const startJobOnCore = startTaskOnCore;

export const queueJob = queueTask;

const updateCpuSchedulerConfig = (
  state: GameState,
  cpuId: number | undefined,
  update: Partial<SchedulerConfig>,
) => {
  if (cpuId === undefined || !state.hardware.cpus.some((cpu) => cpu.id === cpuId)) {
    return state;
  }

  return {
    ...state,
    hardware: {
      ...state.hardware,
      cpus: state.hardware.cpus.map((cpu) =>
        cpu.id === cpuId
          ? {
              ...cpu,
              schedulerConfig: createSchedulerConfig({
                ...cpu.schedulerConfig,
                ...update,
              }),
            }
          : cpu,
      ),
    },
  };
};

const updateSystemSchedulerConfig = (
  state: GameState,
  update: Partial<SchedulerConfig>,
) => ({
  ...state,
  hardware: {
    ...state.hardware,
    systemSchedulerConfig: createSchedulerConfig({
      ...state.hardware.systemSchedulerConfig,
      ...update,
    }),
  },
});

const updateSchedulerConfig = (
  state: GameState,
  target: "cpu" | "system",
  update: Partial<SchedulerConfig>,
  cpuId?: number,
) =>
  target === "system"
    ? updateSystemSchedulerConfig(state, update)
    : updateCpuSchedulerConfig(state, cpuId, update);

export const requestPowerOff = (state: GameState): GameState => {
  if (isSystemManaged(state, state.selectedSystemId)) return state;
  if (state.power.state !== "on") return state;
  const shutdownSeconds = getBootloaderReducedSeconds(state, POWER_SHUTDOWN_SECONDS);

  return {
    ...state,
    power: {
      ...state.power,
      state: "shuttingDown",
      transitionSeconds: shutdownSeconds,
      transitionTotalSeconds: shutdownSeconds,
      bootstrapGraceSeconds: 0,
      unpaidShutdownWarningSeconds: 0,
    },
  };
};

export const requestPowerOn = (state: GameState): GameState => {
  if (isSystemManaged(state, state.selectedSystemId)) return state;
  if (state.power.state !== "off") return state;
  const bootSeconds = getBootSeconds(state);

  return {
    ...state,
    power: {
      ...state.power,
      state: "booting",
      transitionSeconds: bootSeconds,
      transitionTotalSeconds: bootSeconds,
      bootstrapGraceSeconds:
        amountCompare(state.exactResources.credits, 0) <= 0
          ? POWER_BOOTSTRAP_GRACE_SECONDS
          : 0,
      unpaidShutdownWarningSeconds: 0,
    },
  };
};

export const requestPowerKill = (state: GameState): GameState => {
  if (isSystemManaged(state, state.selectedSystemId)) return state;
  if (state.power.state === "off") return state;
  return forceHardPowerOff(state, null);
};

export const acknowledgePowerFailure = (state: GameState): GameState => ({
  ...state,
  power: {
    ...state.power,
    lastFailureReason: null,
  },
});

export const setIdlePowerPolicy = (
  state: GameState,
  policy: IdlePowerPolicy,
): GameState => ({
  ...state,
  power: {
    ...state.power,
    idlePolicy:
      policy === "shutdown-when-idle" ? "shutdown-when-idle" : "low-power",
  },
});

const hasIdlePowerReservation = (
  state: GameState,
  systemId: number,
  local: GameState = materializeSystem(state, systemId),
) => {
  return (
    local.activeTasks.length > 0 ||
    local.activeJobs.length > 0 ||
    local.queue.length > 0 ||
    (local.queueEntries?.length ?? 0) > 0 ||
    local.workshop.activeStorageWorkload !== null ||
    local.cron.schedules.some((schedule) => schedule.enabled) ||
    state.contracts.active.some((contract) => contract.systemId === systemId) ||
    Object.values(state.projects.progress).some(
      (progress) =>
        progress?.active &&
        !progress.completed &&
        progress.systemId === systemId,
    ) ||
    (state.standingOrder.enabled &&
      state.standingOrder.taskId !== null &&
      state.standingOrder.systemId === systemId) ||
    (state.autoRepeatJobId !== null && state.selectedSystemId === systemId)
  );
};

/** Applies the saved departure policy without discarding or stranding work. */
export const applyOfflineIdlePowerPolicies = (state: GameState): GameState => {
  const ensured = ensureSystems(state);
  const systems = ensured.systems.map((system) => {
    if (
      system.power.idlePolicy !== "shutdown-when-idle" ||
      system.power.state !== "on" ||
      isSystemManaged(ensured, system.id) ||
      hasIdlePowerReservation(
        ensured,
        system.id,
        hoistEnsuredSystem(ensured, system),
      )
    ) {
      return system;
    }
    const local = requestPowerOff(hoistEnsuredSystem(ensured, system));
    return { ...system, power: local.power };
  });
  return replaceSystems(ensured, systems, ensured.selectedSystemId);
};

export const requestShutdown = requestPowerOff;

export const requestStartup = requestPowerOn;

const updateCronSchedule = (
  state: GameState,
  scheduleId: number,
  update: (
    schedule: GameState["cron"]["schedules"][number],
  ) => GameState["cron"]["schedules"][number],
) => {
  if (!state.flags.cron) return state;
  const normalizedState = ensureCronState(state);

  return {
    ...normalizedState,
    cron: {
      ...normalizedState.cron,
      schedules: normalizedState.cron.schedules.map((schedule) =>
        schedule.id === scheduleId
          ? normalizeCronSchedule(normalizedState, update(schedule))
          : schedule,
      ),
    },
  };
};

const setCronTask = (
  state: GameState,
  scheduleId: number,
  taskId: TaskId | null,
) =>
  updateCronSchedule(state, scheduleId, (schedule) => {
    if (taskId === null) {
      return { ...schedule, taskId: null, enabled: false, lastResult: null };
    }

    const task = getTaskDefinition(taskId);
    if (!isCronEligibleTask(state, task)) return schedule;

    return { ...schedule, taskId, lastResult: null };
  });

const setCronInterval = (
  state: GameState,
  scheduleId: number,
  intervalMode: "seconds" | "minutes",
  intervalValue: number,
) =>
  updateCronSchedule(state, scheduleId, (schedule) => {
    const nextSchedule = {
      ...schedule,
      intervalMode,
      intervalValue: clampCronIntervalValue(state, intervalMode, intervalValue),
    };
    return {
      ...nextSchedule,
      remainingSeconds: getCronIntervalSeconds(state, nextSchedule),
    };
  });

const setCronEnabled = (
  state: GameState,
  scheduleId: number,
  enabled: boolean,
) =>
  updateCronSchedule(state, scheduleId, (schedule) => {
    const canEnable =
      enabled &&
      schedule.taskId !== null &&
      isCronEligibleTask(state, getTaskDefinition(schedule.taskId));

    return {
      ...schedule,
      enabled: canEnable,
      remainingSeconds: canEnable
        ? getCronIntervalSeconds(state, schedule)
        : schedule.remainingSeconds,
    };
  });

const applySingleSystemAction = (state: GameState, action: GameAction): GameState => {
  if (action.type === "startTask") return startTask(state, action.taskId);
  if (action.type === "startTaskOnCore") {
    return startTaskOnCore(state, action.taskId, action.coreId);
  }
  if (action.type === "queueTask") return queueTask(state, action.taskId, action.cpuId);
  if (action.type === "cancelTask") {
    return cancelTask(state, action.taskId, action.instanceId, action.coreId);
  }
  if (action.type === "cancelQueuedTask") {
    return cancelQueuedTaskById(state, action.taskId);
  }
  if (action.type === "requestShutdown") return requestShutdown(state);
  if (action.type === "requestStartup") return requestStartup(state);
  if (action.type === "requestPowerOff") return requestPowerOff(state);
  if (action.type === "requestPowerOn") return requestPowerOn(state);
  if (action.type === "requestPowerKill") return requestPowerKill(state);
  if (action.type === "setIdlePowerPolicy") {
    return setIdlePowerPolicy(state, action.policy);
  }
  if (action.type === "acknowledgePowerFailure") return acknowledgePowerFailure(state);
  if (action.type === "setCronTask") {
    return setCronTask(state, action.scheduleId, action.taskId);
  }
  if (action.type === "setCronInterval") {
    return setCronInterval(
      state,
      action.scheduleId,
      action.intervalMode,
      action.intervalValue,
    );
  }
  if (action.type === "setCronEnabled") {
    return setCronEnabled(state, action.scheduleId, action.enabled);
  }
  if (action.type === "buyResearch") return buyResearch(state, action.researchId);
  if (action.type === "installCoolingTier") {
    return installWorkshopCoolingTier(state, action.tierId);
  }
  if (action.type === "setOverclockPreset") {
    return selectWorkshopOverclockPreset(state, action.presetId);
  }
  if (action.type === "installAccelerator") {
    return installWorkshopAccelerator(state, action.skuId, action.slotId);
  }
  if (action.type === "removeAccelerator") {
    return removeWorkshopAccelerator(state, action.deviceId);
  }
  if (action.type === "installWorkshopStorage") {
    return installWorkshopStorage(state, action.skuId);
  }
  if (action.type === "installLocalNetwork") {
    return installLocalNetwork(state, action.skuId);
  }
  if (action.type === "startWorkshopStorageWorkload") {
    return startWorkshopStorageWorkload(state, action.workloadId);
  }
  if (action.type === "cancelWorkshopStorageWorkload") {
    return cancelWorkshopStorageWorkload(state);
  }
  if (action.type === "buyUpgrade") {
    if (action.upgradeId === "cooling") return state;
    return buyUpgrade(
      state,
      action.upgradeId,
      action.coreId,
      action.cpuId,
      action.sourceCpuId,
      action.coreIds,
      action.ramStickId,
      action.ramStickIds,
      action.ramTierId,
    );
  }
  if (action.type === "downgradeUpgrade") {
    if (action.upgradeId === "cooling") return state;
    return downgradeUpgrade(
      state,
      action.upgradeId,
      action.coreId,
      action.cpuId,
      action.sourceCpuId,
      action.coreIds,
      action.ramStickId,
      action.ramStickIds,
      action.ramTierId,
    );
  }
  if (action.type === "startJob") return startTask(state, action.jobId);
  if (action.type === "startJobOnCore") {
    return startTaskOnCore(state, action.jobId, action.coreId);
  }
  if (action.type === "queueJob") return queueTask(state, action.jobId, action.cpuId);
  if (action.type === "setSchedulerResourcePriority") {
    if (!state.flags.scheduler) return state;
    return pullQueue(
      updateSystemSchedulerConfig(state, {
        [action.resource === "ram" ? "ramPriority" : "cpuPriority"]:
          action.priority,
      }),
    );
  }
  if (action.type === "setSchedulerAutoKill") {
    if (!state.flags.schedulerWatchdog) return state;
    return updateSchedulerConfig(
      state,
      action.target,
      { autoKillEnabled: action.enabled },
      action.cpuId,
    );
  }
  if (action.type === "setSchedulerKillPolicy") {
    if (!state.flags.schedulerWatchdog) return state;
    return updateSchedulerConfig(
      state,
      action.target,
      { killPolicy: action.killPolicy },
      action.cpuId,
    );
  }
  if (action.type === "setAutoRepeat") {
    return {
      ...state,
      autoRepeatJobId: action.jobId,
    };
  }

  return state;
};

const getActionSystemId = (state: GameState, action: GameAction) =>
  "systemId" in action && typeof action.systemId === "number"
    ? action.systemId
    : state.selectedSystemId;

const buyMachineFromSelection = (
  state: GameState,
  selection: MachineComponentSelection,
  name: string,
  templateId: string | null,
  requireAdvancedBuilder = false,
) => {
  const ensured = ensureSystems(state);
  if (getFleetSystemLimitBlockedReason(ensured) !== null) return ensured;
  if (
    getMachineSelectionBlockedReason(
      ensured,
      selection,
      requireAdvancedBuilder,
    ) !== null
  ) {
    return ensured;
  }
  const costs = getMachineSelectionCost(selection);
  if (!canAfford(ensured, costs)) return ensured;

  const systemId = ensured.rack.nextSystemId;
  const hardware = createHardwareFromMachineSelection(selection);
  const system = createSystemState(systemId, name, templateId, hardware, costs);

  return replaceSystems(
    spend(ensured, costs),
    [...ensured.systems, system],
    systemId,
  );
};

const getSellRefund = (costs: Cost[]): Cost[] => halfRefundExact(costs);

const sellSystem = (state: GameState, systemId: number): GameState => {
  const ensured = ensureSystems(state);
  if (ensured.systems.length <= 1) return ensured;

  const target = ensured.systems.find((system) => system.id === systemId);
  if (!target) return ensured;

  const remaining = ensured.systems.filter((system) => system.id !== systemId);
  const refund = getSellRefund(target.purchaseCosts ?? []);
  const refunded = addCosts(ensured, refund);
  const nextSelectedId =
    ensured.selectedSystemId === systemId
      ? (remaining[0]?.id ?? 1)
      : ensured.selectedSystemId;

  return replaceSystems(refunded, remaining, nextSelectedId);
};

const buyMachineTemplate = (state: GameState, templateId: string) => {
  const ensured = ensureSystems(state);
  if (!ensured.flags.systemCatalog) return ensured;

  try {
    const template = getMachineTemplate(templateId);
    if (!isMachineTemplateUnlocked(ensured, template)) return ensured;
    return buyMachineFromSelection(
      ensured,
      template.components,
      template.name,
      template.id,
    );
  } catch {
    return ensured;
  }
};

const buyCustomMachine = (
  state: GameState,
  components: MachineComponentSelection,
) => {
  const ensured = ensureSystems(state);
  if (!ensured.flags.systemCatalog) return ensured;

  try {
    return buyMachineFromSelection(
      ensured,
      components,
      `Custom ${ensured.rack.nextSystemId}`,
      "custom",
      true,
    );
  } catch {
    return ensured;
  }
};

export const applyAction = (state: GameState, action: GameAction): GameState => {
  const isAutomationAction =
    action.type === "purchaseAutomationBuffer" ||
    action.type === "recordDeparture" ||
    action.type === "recordSave" ||
    action.type === "setStandingOrder" ||
    action.type === "setStandingOrderEnabled";
  const ensured = normalizeCloudForGameState(
    normalizeLiveOperationsForGameState(
      syncSelectedSystemRuntime(syncExactResources(state)),
    ),
  );

  if (
    action.type === "configureLiveOperations" ||
    action.type === "setLiveOperationsEnabled"
  ) {
    return finalizeGameMutation(applyLiveOperationsAction(ensured, action));
  }

  if (isCloudAction(action)) {
    return finalizeGameMutation(applyCloudAction(ensured, action));
  }

  if (isFacilityInfrastructureAction(action)) {
    return finalizeGameMutation(
      applyFacilityInfrastructureAction(ensured, action),
    );
  }

  if (isClusterWorkloadAction(action)) {
    return finalizeGameMutation(applyClusterWorkloadAction(ensured, action));
  }

  if (isInfrastructureAction(action)) {
    return finalizeGameMutation(applyInfrastructureAction(ensured, action));
  }

  if (isLegacyActionBlockedByManagedSystem(ensured, action)) return ensured;

  if (isAutomationAction) {
    return finalizeGameMutation(applyAutomationAction(ensured, action));
  }

  if (action.type === "refreshContractMarket") {
    return finalizeGameMutation(refreshContractMarket(ensured));
  }
  if (action.type === "acceptContract") {
    return finalizeGameMutation(
      acceptContract(ensured, action.contractId, action.systemId),
    );
  }
  if (action.type === "declineContract") {
    return finalizeGameMutation(declineContract(ensured, action.contractId));
  }
  if (action.type === "completeContract") {
    return finalizeGameMutation(completeContract(ensured, action.contractId));
  }
  if (action.type === "startProjectPhase") {
    return finalizeGameMutation(startProjectPhase(
      ensured,
      action.projectId,
      action.systemId ?? ensured.selectedSystemId,
    ));
  }
  if (action.type === "selectSystem") {
    return finalizeGameMutation(materializeSystem(ensured, action.systemId));
  }

  if (action.type === "buyMachineTemplate") {
    return finalizeGameMutation(buyMachineTemplate(ensured, action.templateId));
  }

  if (action.type === "buyCustomMachine") {
    return finalizeGameMutation(buyCustomMachine(ensured, action.components));
  }

  if (action.type === "sellSystem") {
    return finalizeGameMutation(
      clearLiveOperationsForRemovedSystem(
        sellSystem(ensured, action.systemId),
        action.systemId,
      ),
    );
  }

  const targetSystemId = getActionSystemId(ensured, action);
  const materialized = materializeSystem(ensured, targetSystemId);
  const updated = applySingleSystemAction(materialized, action);

  return finalizeGameMutation(
    syncExactResources(
      updateMaterializedSystem(ensured, updated, targetSystemId),
    ),
  );
};

export const getAvailableTasks = (state: GameState) =>
  taskDefinitions.filter(
    (task) =>
      isDefaultVisibleTask(task) &&
      isPlayerFacingTask(task) &&
      isTaskRevealed(state, task) &&
      canAcceptTask(state, task.id),
  );

export const getAvailableJobs = getAvailableTasks;

export const getAvailableResearch = (state: GameState) =>
  researchDefinitions.filter(
    (research) =>
      !(
        (research.id === "systemCatalog" && state.flags.systemCatalog) ||
        (research.id === "customMachineAssembly" &&
          state.flags.customMachineAssembly)
      ) &&
      !state.research.completed.includes(research.id) &&
      research.reveal(state) &&
      research.requirement(state),
  );

export const getAvailableUpgrades = (state: GameState) =>
  upgradeDefinitions.filter(
    (upgrade) =>
      upgrade.id !== "cState" &&
      upgrade.id !== "memoryVoltage" &&
      upgrade.id !== "bootloader" &&
      upgrade.id !== "cooling" &&
      upgrade.requirement(state),
  );

export const getVisibleRemainingSeconds = (
  state: GameState,
  activeTask: ActiveTask,
) =>
  estimateActiveRemainingSeconds(
    state,
    activeTask.taskId,
    amountToSafeNumber(activeTask.remainingCycles),
    activeTask.coreId,
    activeTask.assignedCoreIds,
  );

export const getVisibleOperationProgress = (operation: ActiveCoreOperation) =>
  getOperationProgress(
    amountToSafeNumber(operation.remainingCycles),
    amountToSafeNumber(operation.totalCycles),
    amountToSafeNumber(operation.remainingLoadCycles),
    amountToSafeNumber(operation.totalLoadCycles),
  );
