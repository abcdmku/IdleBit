import { getResearchDefinition, researchDefinitions } from "./content/research";
import {
  getComponentSku,
  getMachineComponentSkus,
  getMachineSelectionCost,
  getMachineTemplate,
} from "./content/machines";
import { getTaskDefinition, taskDefinitions } from "./content/tasks";
import {
  getUpgradeDefinition,
  getUpgradeDowngradeBlockedReason,
  getUpgradeRefund,
  upgradeDefinitions,
} from "./content/upgrades";
import { addRewards, canAfford, spend } from "./economy";
import {
  DEADLOCK_FAILURE_SECONDS,
  POWER_OVERLOAD_FAILURE_SECONDS,
  allocateRamBlocksForOperation,
  estimateActiveRemainingSeconds,
  estimateTaskSeconds,
  getAvailableMemoryBits,
  getAvailableSchedulerSlots,
  getAvailableSystemSchedulerSlots,
  getCacheLoadCycles,
  getCacheLoadRateForOperationTick,
  getDeadlockCooldownRate,
  getHardwareCacheBits,
  getMemoryCapacityBits,
  getOperationEffectiveClock,
  getPowerCostPerSecond,
  getPowerOverloadRate,
  getPsuStress,
  getRamLoadCycles,
  getRamBlockLoadDeltasForOperationTick,
  getRamLoadCyclesForOperationTick,
  getReservedCacheBits,
} from "./math";
import {
  bitsToBytes,
  createCoreSchedulerState,
  createCpuHardwareState,
  createRamStickState,
  createSchedulerConfig,
  createSystemState,
  getCacheBits,
  getCacheBytes,
  getAllCoreIds,
  getCpuClockHz,
  getCpuHardware,
  getCpuIdForCore,
  getCoreClockHz,
  getPsuWatts,
  getRamSpeedMt,
  getOperationProgress,
  POWER_BOOTSTRAP_GRACE_SECONDS,
  POWER_UNPAID_SHUTDOWN_WARNING_SECONDS,
  syncCoreSchedulers,
  updateProgressionFlags,
} from "./progression";
import {
  ensureSystems,
  materializeSystem,
  replaceSystems,
  syncSelectedSystemRuntime,
  updateMaterializedSystem,
} from "./systems";
import type {
  ActiveCoreOperation,
  ActiveTask,
  Cost,
  CpuTierId,
  DeadlockResource,
  GameAction,
  GameState,
  MachineComponentSelection,
  PowerFailureReason,
  ResearchId,
  SchedulerConfig,
  SchedulerKillPolicy,
  SchedulerPolicy,
  SchedulerWatchdogPreview,
  TaskDefinition,
  TaskId,
  TaskOperationDefinition,
  UpgradeId,
} from "./types";

const POWER_SHUTDOWN_SECONDS = 8;
const POWER_BOOT_SECONDS = 10;
const POWER_BILLING_EPSILON = 0.000000001;
const CRON_DEFAULT_INTERVAL_SECONDS = 60;
const CRON_MAX_SECONDS_INTERVAL = 120;
const CRON_MIN_MINUTES_INTERVAL = 1;
const CRON_MAX_MINUTES_INTERVAL = 60;
const CRON_QUEUE_SPIKE_SECONDS = 5;

const getSku = (
  selection: MachineComponentSelection,
  key: Exclude<keyof MachineComponentSelection, "cpuPackageCount">,
) =>
  getComponentSku(selection[key]);

const createHardwareFromMachineSelection = (
  selection: MachineComponentSelection,
): GameState["hardware"] => {
  const cpu = getSku(selection, "cpu");
  const ram = getSku(selection, "ram");
  const scheduler = getSku(selection, "scheduler");
  const psu = getSku(selection, "psu");
  const cpuPackageCount = Math.max(
    1,
    selection.cpuPackageCount ?? cpu.cpuPackageCount ?? 1,
  );
  const coreCount = Math.max(
    cpuPackageCount,
    (cpu.coreCount ?? 1) * cpuPackageCount,
  );
  const coresPerPackage = Math.max(1, Math.floor(coreCount / cpuPackageCount));
  const extraCores = coreCount % cpuPackageCount;
  const cacheLevel = Math.max(1, cpu.cacheLevel ?? 1);
  const cacheSpeedLevel = Math.max(1, cpu.cacheSpeedLevel ?? 1);
  const schedulerSlots = Math.max(0, scheduler.schedulerSlots ?? 0);
  const cpuTierId = cpu.cpuTierId ?? "hz";
  const coreIds = Array.from({ length: coreCount }, (_, index) => index + 1);
  const cpuLevel = Math.max(1, cpu.cpuLevel ?? cpu.clockLevel ?? 1);
  const coreClockLevels = Object.fromEntries(
    coreIds.map((coreId) => [coreId, cpuLevel]),
  ) as Record<number, number>;
  const ramStickCount = Math.max(0, ram.ramStickCount ?? 0);
  const ramLevel = Math.max(1, ram.ramLevel ?? 1);
  const ramSpeedLevel = Math.max(1, ram.ramSpeedLevel ?? 1);
  const ramSticks = Array.from({ length: ramStickCount }, (_, index) =>
    createRamStickState(index + 1, ramLevel, ramSpeedLevel),
  );
  const ramBits = ramSticks.reduce((total, stick) => total + stick.bits, 0);
  const psuLevel = Math.max(1, psu.psuLevel ?? 1);
  const cpus = Array.from({ length: cpuPackageCount }, (_, index) => {
    const start = index * coresPerPackage + Math.min(index, extraCores) + 1;
    const count = coresPerPackage + (index < extraCores ? 1 : 0);
    const packageCoreIds = Array.from(
      { length: count },
      (_, coreIndex) => start + coreIndex,
    );

    return createCpuHardwareState(index + 1, packageCoreIds, {
      cacheLevel,
      cacheSpeedLevel,
      cacheBits: getCacheBits(cacheLevel),
      cacheBytes: getCacheBytes(cacheLevel),
      schedulerSlots: Math.max(0, cpu.schedulerSlots ?? count),
      tierId: cpuTierId,
      level: cpuLevel,
    });
  });
  const cpuSchedulerSlots = cpus.reduce(
    (total, cpuPackage) => total + cpuPackage.schedulerSlots,
    0,
  );

  return {
    clockLevel: cpuLevel,
    clockHz: getCpuClockHz(cpuTierId, cpuLevel),
    coreClockLevels,
    cpus,
    cacheLevel,
    cacheSpeedLevel,
    cacheBits: getCacheBits(cacheLevel),
    cacheBytes: getCacheBytes(cacheLevel),
    cores: coreCount,
    schedulerSlots: cpuSchedulerSlots,
    systemSchedulerSlots: schedulerSlots,
    systemSchedulerConfig: createSchedulerConfig({ policy: "deadlockSafe" }),
    deadlockRecoveryLevel: 0,
    secondCpu: cpuPackageCount > 1,
    ramLevel: ramSticks.length,
    ramBits,
    ramBytes: bitsToBytes(ramBits),
    ramSpeedLevel,
    ramSpeedMt: getRamSpeedMt(ramSpeedLevel),
    ramSticks,
    memoryVoltageLevel: 0,
    cronScheduleSlots: 0,
    cronIntervalLevel: 0,
    cStateLevel: 0,
    psuLevel,
    psuWatts: getPsuWatts(psuLevel),
    coolingLevel: 0,
    coolingRating: 0,
  };
};

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
  if (definition?.memoryAction && operation.totalLoadCycles > 0) {
    return {
      remaining: Math.max(operation.remainingCycles, operation.remainingLoadCycles),
      total: Math.max(operation.totalCycles, operation.totalLoadCycles),
    };
  }

  return {
    remaining: operation.remainingCycles + operation.remainingLoadCycles,
    total: operation.totalCycles + operation.totalLoadCycles,
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
  const activeRemainingCycles = task.coreOperations.reduce(
    (sum, operation) =>
      sum + getRuntimeWork(getOperation(task, operation.operationIndex), operation).remaining,
    0,
  );
  const activeTotalCycles = task.coreOperations.reduce(
    (sum, operation) =>
      sum + getRuntimeWork(getOperation(task, operation.operationIndex), operation).total,
    0,
  );

  if (isChunkedTask(taskDefinition)) {
    const totalWorkUnits = task.workUnitsTotal ?? taskDefinition.workUnitCount;
    const startedWorkUnits = task.workUnitsStarted ?? 0;
    const unstartedWorkUnits = Math.max(0, totalWorkUnits - startedWorkUnits);
    const futureActiveCycles = task.coreOperations.reduce((sum, operation) => {
      if (operation.status === "complete" || operation.workUnitIndex == null) return sum;
      return sum + getFutureWorkUnitCycles(taskDefinition, operation.operationIndex);
    }, 0);

    return {
      ...task,
      remainingCycles:
        activeRemainingCycles +
        futureActiveCycles +
        unstartedWorkUnits * taskDefinition.workUnitCycles,
      totalCycles: Math.max(1, taskDefinition.requiredCycles),
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

const canStartTask = (state: GameState, taskId: TaskId, cpuId?: number) => {
  const task = getTaskDefinition(taskId);

  return (
    canAcceptPoweredWork(state) &&
    !isDeadlockStartBlocked(state) &&
    canAcceptTask(state, taskId) &&
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
  return state.flags.scheduler && getCpuSchedulerWidth(state, cpuId) >= task.minCores;
};

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
    (cpu) =>
      cpuCanProvisionTask(state, task, cpu.id) &&
      canStartTask(state, task.id, cpu.id),
  )?.id;
};

const selectCoreIdsForTask = (
  state: GameState,
  task: TaskDefinition,
  preferredCoreId?: number,
  cpuId?: number,
) => {
  if (
    preferredCoreId === undefined &&
    cpuId === undefined &&
    isChunkedSystemTask(task)
  ) {
    const ordered = getChunkedSystemCoreIds(state, task, true);
    const requiredCores = task.minCores;
    const schedulerWidth = getSystemCpuSchedulerWidth(state);

    if (ordered.length < requiredCores) return [];
    if (requiredCores > 1 && !state.flags.scheduler) return [];
    if (requiredCores > 1 && schedulerWidth < requiredCores) return [];

    const wantedCores =
      task.parallelizable && state.flags.scheduler
        ? Math.min(
            ordered.length,
            task.workUnitCount,
            Math.max(requiredCores, schedulerWidth),
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
  if (requiredCores > 1 && !state.flags.scheduler) return [];
  if (requiredCores > 1 && schedulerWidth < requiredCores) return [];

  const wantedCores = Math.min(
    task.maxCores ?? requiredCores,
    task.parallelizable && state.flags.scheduler ? ordered.length : requiredCores,
    task.parallelizable && state.flags.scheduler
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
  remainingCycles: 0,
  totalCycles: 0,
  remainingLoadCycles: 0,
  totalLoadCycles: 0,
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
  remainingCycles: number,
  ramLoadCycles: number,
  totalLoadCycles: number,
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
      totalCycles: operationDefinition.cycles,
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
    totalCycles: operationDefinition.cycles,
    remainingLoadCycles: Math.max(0, operationDefinition.ramBits - loadedBits),
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
      remainingCycles: 0,
      totalCycles: 0,
      remainingLoadCycles: 0,
      totalLoadCycles: 0,
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

  if (operation.kind === "barrier" && isChunkedTask(getTaskDefinition(task.taskId))) {
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
      remainingCycles: 0,
      totalCycles: operation.cycles,
      remainingLoadCycles: 0,
      totalLoadCycles: 0,
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
      remainingCycles: 0,
      totalCycles: operation.cycles,
      remainingLoadCycles: 0,
      totalLoadCycles: 0,
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

  const cacheLoadCycles = getCacheLoadCycles(state, operation);
  const ramLoadCycles =
    retainedRamBits >= operationRamBits ? 0 : getRamLoadCycles(state, operation);
  const totalLoadCycles = cacheLoadCycles + ramLoadCycles;

  if (cacheLoadCycles > 0) {
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
      remainingCycles: operation.cycles,
      totalCycles: operation.cycles,
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

  if (ramLoadCycles > 0) {
    return beginRamLoadOperation(
      state,
      task,
      {
        ...coreOperation,
        operationIndex,
        operationId: operation.id,
        operationName: operation.name,
        memoryReservedBits: 0,
        memoryReservedBytes: 0,
        ramBlocks: [],
        ramChannelCount: 1,
      },
      operation,
      operation.cycles,
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
    remainingCycles: operation.cycles,
    totalCycles: operation.cycles,
    remainingLoadCycles: 0,
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
): [GameState, ActiveTask] => {
  const taskDefinition = getTaskDefinition(taskId);
  const instanceId = `task-${state.nextInstanceId}`;
  const primaryCoreId = assignedCoreIds[0] ?? 1;
  const shell: ActiveTask = {
    instanceId,
    taskId,
    jobId: taskId,
    systemId: state.selectedSystemId,
    schedulerQueued,
    coreId: primaryCoreId,
    assignedCoreIds,
    workUnitsTotal: isChunkedTask(taskDefinition)
      ? taskDefinition.workUnitCount
      : undefined,
    workUnitsStarted: isChunkedTask(taskDefinition)
      ? Math.min(assignedCoreIds.length, taskDefinition.workUnitCount)
      : undefined,
    workUnitsCompleted: isChunkedTask(taskDefinition) ? 0 : undefined,
    coreOperations: [],
    remainingCycles: taskDefinition.requiredCycles,
    totalCycles: taskDefinition.requiredCycles,
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
  );
  if (assignedCoreIds.length === 0) return state;

  const [nextState, activeTask] = createActiveTask(
    state,
    taskId,
    assignedCoreIds,
    schedulerQueued,
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
): GameState => assignTaskToCores(state, taskId, undefined, cpuId, schedulerQueued);

const selectQueueCoreId = (
  state: GameState,
  cpuId?: number,
  slotCount = 1,
) => {
  const candidateCoreIds =
    cpuId === undefined
      ? state.hardware.cpus
          .filter(
            (cpu) =>
              getAvailableSchedulerSlots(state, cpu.id) >= slotCount &&
              schedulerCanDispatchOnCpu(state, cpu.id),
          )
          .flatMap((cpu) => cpu.coreIds)
      : getAvailableSchedulerSlots(state, cpuId) >= slotCount &&
          schedulerCanDispatchOnCpu(state, cpuId)
        ? getCpuHardware(state, cpuId).coreIds
        : [];
  const schedulers = candidateCoreIds
    .map((coreId) => state.coreSchedulers[coreId])
    .filter((scheduler): scheduler is NonNullable<typeof scheduler> =>
      Boolean(scheduler),
    );
  if (schedulers.length === 0) return 1;

  return schedulers.reduce((best, candidate) =>
    candidate.localQueue.length < best.localQueue.length ? candidate : best,
  ).coreId;
};

const reserveTaskOnCpuScheduler = (
  state: GameState,
  taskId: TaskId,
  cpuId: number,
  slotCount = getSchedulerSlotReservationCount(getTaskDefinition(taskId)),
) => {
  const reservedSlots = Math.max(1, Math.trunc(slotCount));
  if (getAvailableSchedulerSlots(state, cpuId) < reservedSlots) return state;

  const coreId = selectQueueCoreId(state, cpuId, reservedSlots);
  const scheduler = state.coreSchedulers[coreId] ?? createCoreSchedulerState(coreId);

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
      },
    },
  });
};

const reserveTaskOnAssignedCpuSchedulers = (
  state: GameState,
  taskId: TaskId,
  assignedCoreIds: number[],
) => {
  const slotsByCpu = assignedCoreIds.reduce((counts, coreId) => {
    const cpuId = getCpuIdForCore(state, coreId);
    counts.set(cpuId, (counts.get(cpuId) ?? 0) + 1);
    return counts;
  }, new Map<number, number>());

  if (
    Array.from(slotsByCpu).some(
      ([cpuId, slotCount]) => getAvailableSchedulerSlots(state, cpuId) < slotCount,
    )
  ) {
    return state;
  }

  return Array.from(slotsByCpu).reduce(
    (nextState, [cpuId, slotCount]) =>
      reserveTaskOnCpuScheduler(nextState, taskId, cpuId, slotCount),
    state,
  );
};

const enqueueTask = (state: GameState, taskId: TaskId, cpuId?: number) => {
  if (!canQueueTask(state, taskId, cpuId)) return state;
  const task = getTaskDefinition(taskId);

  if (isSystemScheduledTask(task)) {
    return syncCoreSchedulers({
      ...state,
      queue: [...state.queue, taskId],
    });
  }

  const schedulerSlotCount = getSchedulerSlotReservationCount(task);

  return reserveTaskOnCpuScheduler(
    { ...state, queue: [...state.queue, taskId] },
    taskId,
    cpuId ?? getCpuIdForCore(state, selectQueueCoreId(state, cpuId, schedulerSlotCount)),
    schedulerSlotCount,
  );
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
      {
        ...scheduler,
        localQueue: scheduler.localQueue.filter((queuedTaskId) => {
          if (queuedTaskId !== taskId || slotsToRemove <= 0) return true;
          if (slotsToSkip > 0) {
            slotsToSkip -= 1;
            return true;
          }
          if (slotsToRemove > 0) {
            slotsToRemove -= 1;
            return false;
          }
          return true;
        }),
      },
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
  const queue = state.queue.filter((queuedTaskId) => {
    if (queuedTaskId !== taskId) return true;
    if (seen === occurrenceIndex) {
      seen += 1;
      return false;
    }
    seen += 1;
    return true;
  });

  return removeQueuedTaskFromLocalScheduler(
    {
      ...state,
      queue,
    },
    taskId,
    occurrenceIndex,
    slotCount,
  );
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

const cancelActiveTask = (
  state: GameState,
  taskId: TaskId,
  instanceId?: string,
) => {
  const taskIndex = state.activeTasks.findIndex(
    (task) =>
      task.taskId === taskId &&
      (instanceId === undefined || task.instanceId === instanceId),
  );
  if (taskIndex < 0) return state;

  const activeTask = state.activeTasks[taskIndex];
  if (!activeTask) return state;

  const occurrenceIndex = getActiveTaskQueueOccurrenceIndex(state, taskIndex);
  const activeTasks = state.activeTasks.filter((_, index) => index !== taskIndex);
  const withoutActive: GameState = {
    ...state,
    activeTasks,
    activeJobs: activeTasks,
    cacheResidency: [],
  };
  const released = activeTask.schedulerQueued
    ? removeQueuedTaskReservation(
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

  const occurrenceIndex = getQueueOccurrenceIndex(state.queue, taskId, queueIndex);
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
) => {
  const activeTask = state.activeTasks.find(
    (task) =>
      task.taskId === taskId &&
      (instanceId === undefined || task.instanceId === instanceId),
  );

  return activeTask
    ? cancelActiveTask(state, taskId, instanceId)
    : cancelQueuedTask(state, taskId);
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

  return (
    getQueueOccurrenceIndex(queue, taskId, queueIndex) <
    getSchedulerQueuedActiveCount(state, taskId)
  );
};

const getQueuedTaskCpuId = (
  state: GameState,
  taskId: TaskId,
  occurrenceIndex = 0,
) => {
  let seen = 0;
  const queuedCoreId = Number(
    Object.entries(state.coreSchedulers).find(([, scheduler]) => {
      const slotCount = getSchedulerSlotReservationCount(getTaskDefinition(taskId));

      for (let index = 0; index < scheduler.localQueue.length; index += 1) {
        const queuedTaskId = scheduler.localQueue[index];
        if (queuedTaskId !== taskId) continue;
        if (seen === occurrenceIndex) return true;
        seen += 1;
        index += slotCount - 1;
      }

      return false;
    })?.[0] ?? 0,
  );

  return queuedCoreId > 0 ? getCpuIdForCore(state, queuedCoreId) : undefined;
};

const selectQueuedTaskCpuId = (
  state: GameState,
  task: TaskDefinition,
  queuedCpuId?: number,
) => {
  if (queuedCpuId !== undefined) return queuedCpuId;
  if (!isSystemScheduledTask(task)) return undefined;
  if (isChunkedSystemTask(task)) return undefined;

  const candidates = state.hardware.cpus.filter((cpu) => {
    const normalizedCpu = getCpuHardware(state, cpu.id);
    return (
      schedulerCanDispatchOnCpu(state, normalizedCpu.id) &&
      getAvailableSchedulerSlots(state, normalizedCpu.id) >=
        getSchedulerSlotReservationCount(task) &&
      cpuCanProvisionTask(
        state,
        task,
        normalizedCpu.id,
        normalizedCpu.coreIds.length,
      ) &&
      canStartTask(state, task.id, normalizedCpu.id)
    );
  });

  return (
    candidates.find(
      (cpu) => availableCoreIds(state, cpu.id).length >= task.minCores,
    ) ?? candidates[0]
  )?.id;
};

const reserveSystemScheduledCpuWork = (
  state: GameState,
  taskId: TaskId,
  startedState: GameState,
) => {
  const startedTask = startedState.activeTasks.find(
    (activeTask) =>
      activeTask.schedulerQueued &&
      activeTask.taskId === taskId &&
      !state.activeTasks.some(
        (existingTask) => existingTask.instanceId === activeTask.instanceId,
      ),
  );
  if (!startedTask) return startedState;

  return reserveTaskOnAssignedCpuSchedulers(
    startedState,
    taskId,
    startedTask.assignedCoreIds,
  );
};

interface QueuedDispatchCandidate {
  index: number;
  taskId: TaskId;
  task: TaskDefinition;
  cpuId?: number;
  queuedCpuId?: number;
  policy: SchedulerPolicy;
  rank: number;
}

const getSchedulerConfigForQueuedTask = (
  state: GameState,
  task: TaskDefinition,
  cpuId?: number,
): SchedulerConfig => {
  if (isSystemScheduledTask(task)) {
    return createSchedulerConfig(state.hardware.systemSchedulerConfig);
  }

  if (cpuId === undefined) return createSchedulerConfig();
  return createSchedulerConfig(getCpuHardware(state, cpuId).schedulerConfig);
};

const canPolicyDispatchTask = (
  state: GameState,
  task: TaskDefinition,
  cpuId: number | undefined,
  policy: SchedulerPolicy,
) => {
  if (isSystemScheduledTask(task)) return taskFitsFreeMemoryStaging(state, task);
  if (policy !== "deadlockSafe") return true;
  return taskFitsFreeStaging(state, task, cpuId);
};

const canCpuSchedulerDispatchSystemTask = (
  state: GameState,
  task: TaskDefinition,
  cpuId: number | undefined,
) => {
  if (!isSystemScheduledTask(task) || cpuId === undefined) return true;

  const cpuPolicy = getCpuHardware(state, cpuId).schedulerConfig.policy;
  return (
    cpuPolicy !== "deadlockSafe" || taskFitsFreeCacheStaging(state, task, cpuId)
  );
};

const shouldReserveSystemTaskOnCpuScheduler = (
  state: GameState,
  candidate: QueuedDispatchCandidate,
) =>
  isSystemScheduledTask(candidate.task) &&
  candidate.queuedCpuId === undefined &&
  candidate.cpuId !== undefined &&
  (availableCoreIds(state, candidate.cpuId).length < candidate.task.minCores ||
    !canCpuSchedulerDispatchSystemTask(state, candidate.task, candidate.cpuId));

const getDispatchRank = (
  state: GameState,
  task: TaskDefinition,
  cpuId: number | undefined,
  policy: SchedulerPolicy,
  index: number,
) => {
  if (policy === "shortestTask") {
    return estimateTaskSeconds(
      state,
      task,
      cpuId === undefined ? 1 : getCpuHardware(state, cpuId).coreIds[0] ?? 1,
    );
  }

  if (policy === "smallestMemory") {
    return task.cacheNeedBits + task.ramNeedBits;
  }

  return index;
};

const getQueuedDispatchCandidates = (
  state: GameState,
  queue: TaskId[],
): QueuedDispatchCandidate[] =>
  queue.flatMap((taskId, index) => {
    if (isQueueEntryReservedByActiveTask(state, queue, index)) return [];

    const task = getTaskDefinition(taskId);
    const occurrenceIndex = getQueueOccurrenceIndex(queue, taskId, index);
    const queuedCpuId = getQueuedTaskCpuId(state, taskId, occurrenceIndex);
    const systemWideChunked = isChunkedSystemTask(task) && queuedCpuId === undefined;
    const candidateCpuId =
      queuedCpuId ?? (isSystemScheduledTask(task) ? undefined : selectCpuIdForTask(state, task));
    const cpuId = selectQueuedTaskCpuId(state, task, candidateCpuId);
    if (isSystemScheduledTask(task) && cpuId === undefined && !systemWideChunked) {
      return [];
    }
    if (
      systemWideChunked &&
      (!canStartTask(state, task.id) ||
        !canProvisionChunkedSystemTask(
          state,
          task,
          getChunkedSystemCoreIds(state, task, true).length,
        ))
    ) {
      return [];
    }
    if (cpuId !== undefined && !schedulerCanDispatchOnCpu(state, cpuId)) return [];
    if (
      (!isSystemScheduledTask(task) || queuedCpuId !== undefined) &&
      availableCoreIds(state, cpuId).length < task.minCores
    ) {
      return [];
    }

    const policy = getSchedulerConfigForQueuedTask(state, task, cpuId).policy;
    if (!canPolicyDispatchTask(state, task, cpuId, policy)) return [];
    if (
      queuedCpuId !== undefined &&
      !canCpuSchedulerDispatchSystemTask(state, task, cpuId)
    ) {
      return [];
    }

    return [
      {
        index,
        taskId,
        task,
        cpuId,
        queuedCpuId,
        policy,
        rank: getDispatchRank(state, task, cpuId, policy, index),
      },
    ];
  });

const selectQueuedDispatchCandidate = (
  state: GameState,
  queue: TaskId[],
): QueuedDispatchCandidate | null => {
  const candidates = getQueuedDispatchCandidates(state, queue);
  if (candidates.length === 0) return null;

  return candidates.reduce((best, candidate) => {
    if (candidate.rank < best.rank) return candidate;
    if (candidate.rank === best.rank && candidate.index < best.index) return candidate;
    return best;
  });
};

const pullQueue = (state: GameState): GameState => {
  if (!canAcceptPoweredWork(state)) return syncCoreSchedulers(state);
  if (!state.flags.basicQueue && !state.flags.scheduler) return syncCoreSchedulers(state);

  let nextState = state;
  const nextQueue = [...state.queue];
  let startedQueuedTask = true;

  while (nextQueue.length > 0 && startedQueuedTask) {
    startedQueuedTask = false;

    const candidate = selectQueuedDispatchCandidate(nextState, nextQueue);
    if (!candidate) break;

    const attemptState = { ...nextState, queue: nextQueue };
    if (shouldReserveSystemTaskOnCpuScheduler(attemptState, candidate)) {
      if (candidate.cpuId === undefined) break;

      const reserved = reserveTaskOnCpuScheduler(
        attemptState,
        candidate.taskId,
        candidate.cpuId,
        getSchedulerSlotReservationCount(candidate.task),
      );
      if (reserved === attemptState) break;

      nextState = reserved;
      startedQueuedTask = true;
      continue;
    }

    const started = assignTaskToIdleCores(
      attemptState,
      candidate.taskId,
      candidate.cpuId,
      true,
    );
    if (started === attemptState) break;

    nextState =
      isSystemScheduledTask(candidate.task) && candidate.queuedCpuId === undefined
        ? reserveSystemScheduledCpuWork(attemptState, candidate.taskId, started)
        : started;
    startedQueuedTask = true;
  }

  return syncCoreSchedulers({ ...nextState, queue: nextQueue });
};

const completeTask = (state: GameState, activeTask: ActiveTask): GameState => {
  const task = getTaskDefinition(activeTask.taskId);
  const completedAmount =
    state.completedTasks[task.id] ?? state.completedJobs[task.id] ?? 0;
  const benchmarkIds = task.kind === "benchmark" ? [task.id] : [];
  const nextBenchmarks = Array.from(
    new Set([...state.completedBenchmarks, ...benchmarkIds]),
  );
  const rewarded = addRewards(state, task.rewardCredits, task.rewardData);
  const queueReleased = activeTask.schedulerQueued
    ? removeQueuedTaskReservation(
        rewarded,
        task.id,
        0,
        getSchedulerSlotReservationCount(task, activeTask.assignedCoreIds),
      )
    : rewarded;

  return updateProgressionFlags({
    ...queueReleased,
    completedTasks: {
      ...queueReleased.completedTasks,
      [task.id]: completedAmount + 1,
    },
    completedJobs: {
      ...queueReleased.completedJobs,
      [task.id]: completedAmount + 1,
    },
    completedBenchmarks: nextBenchmarks,
    cacheResidency: [],
  });
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

const getAllowedCacheProgressCycles = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
  requestedLoadCycles: number,
  requestedCpuCycles: number,
) => {
  if (requestedLoadCycles <= 0 && requestedCpuCycles <= 0) {
    return { loadCycles: 0, cpuCycles: 0, exhausted: false };
  }

  const capacity = getCpuHardware(
    state,
    getCpuIdForCore(state, operation.coreId),
  ).cacheBits;
  const getUpdatedOperation = (scale: number) => ({
    ...operation,
    remainingLoadCycles: Math.max(
      0,
      operation.remainingLoadCycles - requestedLoadCycles * scale,
    ),
    remainingCycles: Math.max(
      0,
      operation.remainingCycles - requestedCpuCycles * scale,
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
    cpuCycles: requestedCpuCycles * low,
    exhausted: usedAfterAllowedProgress >= capacity - CACHE_CAPACITY_EPSILON,
  };
};

const tickLoad = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
  deltaSeconds: number,
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

    return tickLoad(state, task, allocatedOperation, deltaSeconds);
  }

  const ramLoadDeltas =
    operation.status === "loadingRam"
      ? getRamBlockLoadDeltasForOperationTick(state, operation, deltaSeconds)
      : [];
  const requestedRamLoadCycles = ramLoadDeltas.reduce(
    (total, bits) => total + bits,
    0,
  );
  const requestedLoadCycles = Math.min(
    operation.remainingLoadCycles,
    operation.status === "loadingCache"
      ? getCacheLoadRateForOperationTick(
          state,
          operation,
          operationDefinition,
        ) * deltaSeconds
      : (operation.ramBlocks ?? []).length > 0
        ? requestedRamLoadCycles
        : getRamLoadCyclesForOperationTick(state, task, operation, deltaSeconds),
  );
  const requestedCpuCycles =
    operation.status === "loadingCache" && operationDefinition.memoryAction
      ? Math.min(
          operation.remainingCycles,
          getCoreClockHz(state, operation.coreId) * deltaSeconds,
        )
      : 0;
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
  const nextRamBlocks =
    operation.status === "loadingRam" && (operation.ramBlocks ?? []).length > 0
      ? applyRamBlockLoadDeltas(operation, ramLoadDeltas, appliedRamBlockScale)
      : operation.ramBlocks ?? [];
  const loadedRamBlockBits = nextRamBlocks.reduce(
    (total, block) => total + Math.max(0, block.loadedBits),
    0,
  );
  const remainingLoadCycles = Math.max(
    0,
    operation.status === "loadingRam" && nextRamBlocks.length > 0
      ? operationDefinition.ramBits -
          Math.min(operationDefinition.ramBits, loadedRamBlockBits)
      : operation.remainingLoadCycles - appliedLoadCycles,
  );
  const cpuCyclesDone = cacheProgress?.cpuCycles ?? 0;
  const remainingCycles = Math.max(0, operation.remainingCycles - cpuCyclesDone);
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
    remainingLoadCycles > 0
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

  if (remainingLoadCycles > 0 || (waitsForCpuIssue && remainingCycles > 0)) {
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
    const ramLoadCycles = ramAlreadyReady
      ? 0
      : getRamLoadCycles(state, operationDefinition);
    if (ramLoadCycles > 0) {
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
          remainingCycles: 0,
          remainingLoadCycles: 0,
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
        remainingCycles: 0,
        remainingLoadCycles: 0,
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
    remainingLoadCycles: 0,
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
  deltaSeconds: number,
): ActiveCoreOperation => {
  const operationDefinition = getOperation(task, operation.operationIndex);
  if (!operationDefinition) return operation;

  const cyclesDone =
    getOperationEffectiveClock(state, operationDefinition, operation.coreId) *
    deltaSeconds;
  const remainingCycles = operation.remainingCycles - cyclesDone;

  if (remainingCycles > 0) {
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
      remainingCycles: 0,
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

  const retriedOperation = tickLoad(state, task, retryOperation, deltaSeconds);

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
  const reassignedOperations: ActiveCoreOperation[] = [];

  for (const operation of coreOperations) {
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

    if (operation.status === "complete" && operation.workUnitIndex != null) {
      if (startedWorkUnits < totalWorkUnits) {
        const workUnitIndex = startedWorkUnits;
        startedWorkUnits += 1;
        const stagedTask = {
          ...activeTask,
          workUnitsTotal: totalWorkUnits,
          workUnitsStarted: startedWorkUnits,
          workUnitsCompleted: completedWorkUnits,
          coreOperations: reassignedOperations,
        };
        nextOperation = enterOperation(
          state,
          stagedTask,
          idleCoreOperation(operation.coreId, 0, workUnitIndex),
          0,
        );
      } else {
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
    coreOperations: reassignedOperations,
  });
};

const tickActiveTask = (
  state: GameState,
  activeTask: ActiveTask,
  deltaSeconds: number,
): ActiveTask => {
  const ramDeadlocked = Boolean(getRamDeadlockOperation(state));
  const cacheDeadlockedCpuIds = getCacheDeadlockedCpuIds(state);
  const recoveryActive = state.deadlockProcessLockout === true;
  const coreOperations: ActiveCoreOperation[] = [];

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
        tickDeadlocked(stagedState, stagedTask, operation, deltaSeconds),
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
      coreOperations.push(tickLoad(stagedState, stagedTask, operation, deltaSeconds));
      return;
    }

    if (operation.status === "running") {
      coreOperations.push(tickRunning(stagedState, stagedTask, operation, deltaSeconds));
      return;
    }

    if (operation.status === "waitingMemory") {
      coreOperations.push(tickWaitingMemory(stagedState, stagedTask, operation));
      return;
    }

    coreOperations.push(operation);
  });

  return assignNextChunkedWorkUnits(state, activeTask, coreOperations);
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
  isSystemScheduledTask(getTaskDefinition(task.taskId)) && resource !== "cache"
    ? "system"
    : `cpu:${getCpuIdForCore(state, task.coreId)}`;

const getSchedulerConfigForActiveTask = (
  state: GameState,
  task: ActiveTask,
  resource?: DeadlockResource | null,
): SchedulerConfig =>
  isSystemScheduledTask(getTaskDefinition(task.taskId)) && resource !== "cache"
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
  if (task.totalCycles <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - task.remainingCycles / task.totalCycles));
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
    nextState = cancelActiveTask(nextState, victim.taskId, victim.instanceId);
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
): GameState => {
  const currentSeconds = Math.max(0, state.power.overloadFailureSeconds ?? 0);
  const psuStress = getPsuStress(state);
  const overloadRate =
    canRunPoweredWork(state) ? getPowerOverloadRate(psuStress) : 0;

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

const tickActiveTasks = (state: GameState, deltaSeconds: number): GameState => {
  const activeTasks: ActiveTask[] = [];

  state.activeTasks.forEach((activeTask, index) => {
    const stagedState = {
      ...state,
      activeTasks: [...activeTasks, ...state.activeTasks.slice(index)],
      activeJobs: [...activeTasks, ...state.activeTasks.slice(index)],
    };
    activeTasks.push(tickActiveTask(stagedState, activeTask, deltaSeconds));
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
    },
  };
};

const forcePowerOffForUnpaidBill = (state: GameState): GameState => ({
  ...state,
  resources: {
    ...state.resources,
    credits: 0,
  },
  power: {
    ...state.power,
    state: "off",
    transitionSeconds: 0,
    bootstrapGraceSeconds: 0,
    unpaidShutdownWarningSeconds: 0,
    overloadFailureSeconds: 0,
    lastFailureReason: "unpaidBill",
    failureCount: Math.max(0, state.power.failureCount ?? 0) + 1,
  },
});

const beginUnpaidShutdownWarning = (state: GameState): GameState => ({
  ...state,
  resources: {
    ...state.resources,
    credits: 0,
  },
  power: {
    ...state.power,
    bootstrapGraceSeconds: 0,
    unpaidShutdownWarningSeconds:
      state.power.unpaidShutdownWarningSeconds > 0
        ? state.power.unpaidShutdownWarningSeconds
        : POWER_UNPAID_SHUTDOWN_WARNING_SECONDS,
  },
});

const clearBillingGraceIfFunded = (state: GameState): GameState => {
  if (
    state.resources.credits <= 0 ||
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

const applyPowerBilling = (state: GameState, deltaSeconds: number): GameState => {
  const fundedState = clearBillingGraceIfFunded(state);
  const warningSeconds = Math.max(
    0,
    fundedState.power.unpaidShutdownWarningSeconds ?? 0,
  );
  const costPerSecond = getPowerCostPerSecond(fundedState);

  if (warningSeconds > 0) {
    if (costPerSecond <= 0) {
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
      return forcePowerOffForUnpaidBill(fundedState);
    }

    return {
      ...fundedState,
      resources: {
        ...fundedState.resources,
        credits: 0,
      },
      power: {
        ...fundedState.power,
        bootstrapGraceSeconds: 0,
        unpaidShutdownWarningSeconds,
      },
    };
  }

  const graceSeconds = Math.max(0, fundedState.power.bootstrapGraceSeconds ?? 0);
  if (fundedState.resources.credits <= 0 && graceSeconds > 0) {
    const bootstrapGraceSeconds = Math.max(0, graceSeconds - deltaSeconds);

    if (bootstrapGraceSeconds <= 0 && costPerSecond > 0) {
      return beginUnpaidShutdownWarning({
        ...fundedState,
        power: {
          ...fundedState.power,
          bootstrapGraceSeconds: 0,
        },
      });
    }

    return {
      ...fundedState,
      power: {
        ...fundedState.power,
        bootstrapGraceSeconds,
      },
    };
  }

  const cost = costPerSecond * deltaSeconds;
  const billableState = fundedState;
  if (cost <= 0) return billableState;

  if (billableState.resources.credits + POWER_BILLING_EPSILON < cost) {
    return beginUnpaidShutdownWarning(billableState);
  }

  const credits = Math.max(0, billableState.resources.credits - cost);
  const paidState = {
    ...billableState,
    resources: {
      ...billableState.resources,
      credits,
    },
  };

  return credits <= POWER_BILLING_EPSILON
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

const tickSingleSystem = (state: GameState, deltaMs: number): GameState => {
  const deltaSeconds = Math.max(0, Math.min(deltaMs / 1000, 2));
  const ticked = {
    ...ensureCronState(syncCoreSchedulers(updateProgressionFlags(state))),
    tick: state.tick + deltaSeconds,
    cacheResidency: [],
  };
  const wasPoweredOn = canRunPoweredWork(ticked);
  const powered = decayCronPowerSpike(
    applyPowerBilling(advancePowerTransition(ticked, deltaSeconds), deltaSeconds),
    deltaSeconds,
  );

  if (!wasPoweredOn || !canRunPoweredWork(powered)) {
    return updateProgressionFlags(
      syncCoreSchedulers(updatePowerOverloadFailure(powered, deltaSeconds)),
    );
  }

  const cronTicked = canAcceptPoweredWork(powered)
    ? tickCron(powered, deltaSeconds)
    : powered;
  const advanced = tickActiveTasks(cronTicked, deltaSeconds);
  const settled = clearBillingGraceIfFunded(settleActiveTasks(advanced));
  const watched = applySchedulerWatchdogs(settled);
  const overloadChecked = updatePowerOverloadFailure(watched, deltaSeconds);
  const pressured = updateDeadlockPressure(overloadChecked, deltaSeconds);

  const progressed = updateProgressionFlags(pressured);
  return canAcceptPoweredWork(progressed)
    ? pullQueue(progressed)
    : syncCoreSchedulers(progressed);
};

const hardPowerOffAllSystemsForUnpaidBill = (state: GameState): GameState =>
  replaceSystems(
    {
      ...state,
      resources: {
        ...state.resources,
        credits: 0,
      },
    },
    ensureSystems(state).systems.map((system) => {
      if (system.power.state === "off") return system;
      const localState = materializeSystem(state, system.id);
      const poweredOff = forcePowerOffForUnpaidBill(localState);
      return {
        ...system,
        power: poweredOff.power,
        activeTasks: [],
        activeJobs: [],
        cacheResidency: [],
        queue: [],
        coreSchedulers: poweredOff.coreSchedulers,
      };
    }),
  );

export const tickGame = (state: GameState, deltaMs: number): GameState => {
  const ensured = syncSelectedSystemRuntime(state);
  const baseTick = ensured.tick;
  let workingState = materializeSystem(ensured, ensured.selectedSystemId);
  let unpaidBill = false;

  const systems = ensured.systems.map((system) => {
    const localInput = materializeSystem(
      {
        ...workingState,
        systems: ensured.systems,
        selectedSystemId: system.id,
        tick: baseTick,
      },
      system.id,
    );
    const localOutput = tickSingleSystem(localInput, deltaMs);
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
      research: localOutput.research,
      flags: localOutput.flags,
      completedTasks: localOutput.completedTasks,
      completedJobs: localOutput.completedJobs,
      completedBenchmarks: localOutput.completedBenchmarks,
      nextInstanceId: localOutput.nextInstanceId,
      tick: localOutput.tick,
    };
    return {
      ...system,
      hardware: localOutput.hardware,
      power: localOutput.power,
      cron: localOutput.cron,
      activeTasks: localOutput.activeTasks,
      activeJobs: localOutput.activeTasks,
      cacheResidency: localOutput.cacheResidency,
      coreSchedulers: localOutput.coreSchedulers,
      queue: localOutput.queue,
      deadlockPressureSeconds: localOutput.deadlockPressureSeconds,
      deadlockPressureResource: localOutput.deadlockPressureResource,
      deadlockPressureCpuId: localOutput.deadlockPressureCpuId,
      deadlockProcessLockout: localOutput.deadlockProcessLockout,
    };
  });

  const ticked = replaceSystems(
    {
      ...workingState,
      systems,
      selectedSystemId: ensured.selectedSystemId,
      rack: ensured.rack,
    },
    systems,
    ensured.selectedSystemId,
  );

  return unpaidBill ? hardPowerOffAllSystemsForUnpaidBill(ticked) : ticked;
};

export const startTask = (state: GameState, taskId: TaskId) => {
  const task = getTaskDefinition(taskId);

  if (isSystemScheduledTask(task)) {
    const queued = enqueueTask(state, taskId);
    return queued === state ? state : pullQueue(queued);
  }

  const started = assignTaskToIdleCores(state, taskId);

  if (started !== state) return started;

  return enqueueTask(state, taskId);
};

export const startTaskOnCore = (
  state: GameState,
  taskId: TaskId,
  coreId: number,
) => {
  if (!getAllCoreIds(state).includes(coreId)) return state;
  if (isSystemScheduledTask(getTaskDefinition(taskId))) return state;

  return assignTaskToCores(state, taskId, coreId);
};

export const queueTask = (state: GameState, taskId: TaskId, cpuId?: number) =>
  enqueueTask(state, taskId, cpuId);

export const cancelQueuedTaskById = (state: GameState, taskId: TaskId) =>
  cancelQueuedTask(state, taskId);

export const buyResearch = (state: GameState, researchId: ResearchId) => {
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

  if (!upgrade.requirement(state) || !canAfford(state, costs)) {
    return state;
  }

  const bought = upgrade.buy(spend(state, costs), context);
  return pullQueue(updateProgressionFlags(bought));
};

const addRefunds = (state: GameState, refunds: Cost[]): GameState => ({
  ...state,
  resources: refunds.reduce(
    (resources, refund) => ({
      ...resources,
      [refund.resource]: resources[refund.resource] + refund.amount,
    }),
    state.resources,
  ),
});

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
  if (state.power.state !== "on") return state;
  return {
    ...state,
    power: {
      ...state.power,
      state: "shuttingDown",
      transitionSeconds: POWER_SHUTDOWN_SECONDS,
      bootstrapGraceSeconds: 0,
      unpaidShutdownWarningSeconds: 0,
    },
  };
};

export const requestPowerOn = (state: GameState): GameState => {
  if (state.power.state !== "off") return state;
  return {
    ...state,
    power: {
      ...state.power,
      state: "booting",
      transitionSeconds: POWER_BOOT_SECONDS,
      bootstrapGraceSeconds:
        state.resources.credits <= 0 ? POWER_BOOTSTRAP_GRACE_SECONDS : 0,
      unpaidShutdownWarningSeconds: 0,
    },
  };
};

export const requestPowerKill = (state: GameState): GameState => {
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
    return cancelTask(state, action.taskId, action.instanceId);
  }
  if (action.type === "cancelQueuedTask") {
    return cancelQueuedTaskById(state, action.taskId);
  }
  if (action.type === "requestShutdown") return requestShutdown(state);
  if (action.type === "requestStartup") return requestStartup(state);
  if (action.type === "requestPowerOff") return requestPowerOff(state);
  if (action.type === "requestPowerOn") return requestPowerOn(state);
  if (action.type === "requestPowerKill") return requestPowerKill(state);
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
  if (action.type === "buyUpgrade") {
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
  if (action.type === "setSchedulerPolicy") {
    if (!state.flags.schedulerPolicies) return state;
    return pullQueue(
      updateSchedulerConfig(
        state,
        action.target,
        { policy: action.policy },
        action.cpuId,
      ),
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
) => {
  const ensured = ensureSystems(state);
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

const getSellRefund = (costs: Cost[]): Cost[] =>
  costs
    .map((cost) => ({
      resource: cost.resource,
      amount: Math.floor(cost.amount * 0.5),
    }))
    .filter((cost) => cost.amount > 0);

const sellSystem = (state: GameState, systemId: number): GameState => {
  const ensured = ensureSystems(state);
  if (ensured.systems.length <= 1) return ensured;

  const target = ensured.systems.find((system) => system.id === systemId);
  if (!target) return ensured;

  const remaining = ensured.systems.filter((system) => system.id !== systemId);
  const refund = getSellRefund(target.purchaseCosts ?? []);
  const refunded: GameState = {
    ...ensured,
    resources: refund.reduce(
      (resources, cost) => ({
        ...resources,
        [cost.resource]: resources[cost.resource] + cost.amount,
      }),
      ensured.resources,
    ),
  };
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
    getMachineComponentSkus(components);
    return buyMachineFromSelection(
      ensured,
      components,
      `Custom ${ensured.rack.nextSystemId}`,
      "custom",
    );
  } catch {
    return ensured;
  }
};

export const applyAction = (state: GameState, action: GameAction): GameState => {
  const ensured = syncSelectedSystemRuntime(state);

  if (action.type === "selectSystem") {
    return materializeSystem(ensured, action.systemId);
  }

  if (action.type === "buyMachineTemplate") {
    return buyMachineTemplate(ensured, action.templateId);
  }

  if (action.type === "buyCustomMachine") {
    return buyCustomMachine(ensured, action.components);
  }

  if (action.type === "sellSystem") {
    return sellSystem(ensured, action.systemId);
  }

  const targetSystemId = getActionSystemId(ensured, action);
  const materialized = materializeSystem(ensured, targetSystemId);
  const updated = applySingleSystemAction(materialized, action);

  return updateMaterializedSystem(ensured, updated, targetSystemId);
};

export const getAvailableTasks = (state: GameState) =>
  taskDefinitions.filter(
    (task) =>
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
      upgrade.requirement(state),
  );

export const getVisibleRemainingSeconds = (
  state: GameState,
  activeTask: ActiveTask,
) =>
  estimateActiveRemainingSeconds(
    state,
    activeTask.taskId,
    activeTask.remainingCycles,
    activeTask.coreId,
  );

export const getVisibleOperationProgress = (operation: ActiveCoreOperation) =>
  getOperationProgress(
    operation.remainingCycles,
    operation.totalCycles,
    operation.remainingLoadCycles,
    operation.totalLoadCycles,
  );
