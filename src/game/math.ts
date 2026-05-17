import { getTaskDefinition } from "./content/tasks";
import {
  bitsToBytes,
  getClockHz,
  getCpuForCore,
  getCpuHardware,
  getCoreClockHz,
  getCoreClockLevel,
} from "./progression";
import type {
  ActiveCoreOperation,
  GameState,
  TaskDefinition,
  TaskOperationDefinition,
} from "./types";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const getHardwareCacheBits = (state: GameState) =>
  Math.max(
    state.hardware.cpus.length > 0
      ? 0
      : (state.hardware.cacheBits ?? state.hardware.cacheBytes * 8),
    ...state.hardware.cpus.map((cpu) => getCpuHardware(state, cpu.id).cacheBits),
  );

export const getReservedCacheBits = (state: GameState, cpuId?: number) =>
  state.activeTasks.reduce(
    (sum, task) =>
      cpuId !== undefined && getCpuForCore(state, task.coreId).id !== cpuId
        ? sum
        : sum + getTaskDefinition(task.taskId).cacheNeedBits,
    0,
  );

export const getAvailableCacheBits = (state: GameState, cpuId?: number) => {
  if (cpuId !== undefined) {
    const cpu = getCpuHardware(state, cpuId);
    return Math.max(0, cpu.cacheBits - getReservedCacheBits(state, cpu.id));
  }

  return Math.max(
    0,
    ...state.hardware.cpus.map((cpu) => {
      const normalizedCpu = getCpuHardware(state, cpu.id);
      return Math.max(
        0,
        normalizedCpu.cacheBits - getReservedCacheBits(state, normalizedCpu.id),
      );
    }),
  );
};

export const getHardwareRamBits = (state: GameState) =>
  state.hardware.ramBits ?? state.hardware.ramBytes * 8;

export const getMemoryCapacityBits = (state: GameState) => {
  const ramBits = getHardwareRamBits(state);
  return ramBits > 0 ? ramBits : 8;
};

export const getAvailableMemoryBits = (state: GameState) =>
  Math.max(0, getMemoryCapacityBits(state) - getReservedMemoryBits(state));

export const getSchedulerQueuedCount = (state: GameState, cpuId: number) => {
  const cpu = getCpuHardware(state, cpuId);
  return cpu.coreIds.reduce(
    (total, coreId) => total + (state.coreSchedulers[coreId]?.localQueue.length ?? 0),
    0,
  );
};

export const getSchedulerSlotCapacity = (state: GameState, cpuId?: number) =>
  cpuId === undefined
    ? state.hardware.cpus.reduce(
        (total, cpu) => total + getCpuHardware(state, cpu.id).schedulerSlots,
        0,
      )
    : Math.max(0, getCpuHardware(state, cpuId).schedulerSlots);

export const getAvailableSchedulerSlots = (
  state: GameState,
  cpuId?: number,
): number => {
  if (cpuId !== undefined) {
    return Math.max(
      0,
      getSchedulerSlotCapacity(state, cpuId) - getSchedulerQueuedCount(state, cpuId),
    );
  }

  return state.hardware.cpus.reduce(
    (total, cpu) => total + getAvailableSchedulerSlots(state, cpu.id),
    0,
  );
};

const isSystemScheduledTask = (task: TaskDefinition) =>
  task.category === "system" || task.category === "distributed";

export const getSystemSchedulerQueuedCount = (state: GameState) =>
  state.queue.filter((taskId) =>
    isSystemScheduledTask(getTaskDefinition(taskId)),
  ).length;

export const getSystemSchedulerSlotCapacity = (state: GameState) =>
  Math.max(0, state.hardware.systemSchedulerSlots ?? 0);

export const getAvailableSystemSchedulerSlots = (state: GameState) =>
  Math.max(
    0,
    getSystemSchedulerSlotCapacity(state) - getSystemSchedulerQueuedCount(state),
  );

export const getMemoryCapacityBytes = (state: GameState) =>
  bitsToBytes(getMemoryCapacityBits(state));

export const getMemorySpeedMt = (state: GameState) =>
  state.hardware.ramSpeedMt > 0 ? state.hardware.ramSpeedMt : 1;

export const getCacheMultiplier = (state: GameState, task: TaskDefinition) => {
  if (task.cacheNeedBits <= 0) return 1;

  const cache = getHardwareCacheBits(state);

  if (cache > task.cacheNeedBits) return 1.18;
  if (cache === task.cacheNeedBits) return 1.1;

  const shortage = (task.cacheNeedBits - cache) / task.cacheNeedBits;
  return 1 / (1 + shortage * 0.5);
};

export const getOperationCacheMultiplier = (
  state: GameState,
  operation: TaskOperationDefinition,
  coreId = 1,
) => {
  if (operation.cacheBits <= 0) return 1;
  const cacheBits = getCpuForCore(state, coreId).cacheBits;
  if (cacheBits >= operation.cacheBits) return 1.12;

  const shortage = (operation.cacheBits - cacheBits) / operation.cacheBits;
  return 1 / (1 + shortage * 0.65);
};

export const getEffectiveClock = (
  state: GameState,
  task: TaskDefinition,
  coreId = 1,
) => getCoreClockHz(state, coreId) * getCacheMultiplier(state, task);

export const getOperationEffectiveClock = (
  state: GameState,
  operation: TaskOperationDefinition,
  coreId = 1,
) =>
  getCoreClockHz(state, coreId) *
  getOperationCacheMultiplier(state, operation, coreId);

export const getCacheLoadCyclesForBits = (_state: GameState, cacheBits: number) => {
  if (cacheBits <= 0) return 0;

  return cacheBits;
};

export const getCacheLoadCyclesForOperation = (
  state: GameState,
  operation: TaskOperationDefinition,
) => {
  if (operation.cacheBits <= 0) return 0;

  // cacheBits is already normalized to the total touched data for counted work.
  return getCacheLoadCyclesForBits(state, operation.cacheBits);
};

export const getCacheLoadCycles = (
  state: GameState,
  operation: TaskOperationDefinition,
) => getCacheLoadCyclesForOperation(state, operation);

export const getRamLoadCycles = (
  state: GameState,
  operation: TaskOperationDefinition,
) => {
  if (operation.ramBits <= 0) return 0;
  return operation.ramBits;
};

export const getCacheLoadRate = (state: GameState, coreId: number) =>
  getClockHz(getCpuForCore(state, coreId).cacheSpeedLevel ?? 1);

export const getRamLoadRate = (state: GameState) =>
  Math.max(1, getMemorySpeedMt(state));

export const estimateTaskSeconds = (
  state: GameState,
  task: TaskDefinition,
  coreId = 1,
) =>
  task.operations.reduce((seconds, operation) => {
    const cpuSeconds =
      operation.cycles /
      (operation.memoryAction
        ? getCoreClockHz(state, coreId)
        : getOperationEffectiveClock(state, operation, coreId));
    const cacheSeconds =
      getCacheLoadCycles(state, operation) / getCacheLoadRate(state, coreId);
    const ramSeconds = getRamLoadCycles(state, operation) / getRamLoadRate(state);
    if (operation.memoryAction) {
      return seconds + Math.max(cpuSeconds, cacheSeconds) + ramSeconds;
    }

    return seconds + cpuSeconds + cacheSeconds + ramSeconds;
  }, 0);

export const estimateActiveRemainingSeconds = (
  state: GameState,
  taskId: TaskDefinition["id"],
  remainingCycles: number,
  coreId = 1,
) => remainingCycles / getEffectiveClock(state, getTaskDefinition(taskId), coreId);

export const estimateJobSeconds = estimateTaskSeconds;

const activeOperationPowerMultiplier = (operation: ActiveCoreOperation) => {
  if (operation.status === "complete" || operation.status === "waitingMemory") {
    return 0;
  }
  if (operation.status === "waitingBarrier") return 0.12;
  if (operation.status === "loadingCache") return 0.38;
  if (operation.status === "loadingRam") return 0.55;
  if (operation.status === "restarting") return 0.9;
  if (operation.status === "rerunning") return 1.08;
  return 1;
};

const getOperationActivityDrawWatts = (
  operation: TaskOperationDefinition,
  runtime: ActiveCoreOperation,
) => {
  const baseDraw =
    operation.kind === "memory" ? 1.35 : operation.kind === "barrier" ? 0.45 : 1.85;
  const parallelOverhead = operation.parallel ? 0.35 : 0;
  const memoryLoadDraw =
    runtime.status === "loadingCache"
      ? 0.45
      : runtime.status === "loadingRam"
        ? 0.75
        : 0;

  return baseDraw + parallelOverhead + memoryLoadDraw;
};

export const getActiveOperationDefinition = (
  state: GameState,
  activeOperation: ActiveCoreOperation,
) => {
  const activeTask = state.activeTasks.find((task) =>
    task.coreOperations.some(
      (operation) =>
        operation.coreId === activeOperation.coreId &&
        operation.operationId === activeOperation.operationId,
    ),
  );

  if (!activeTask || activeOperation.operationIndex < 0) return null;
  return getTaskDefinition(activeTask.taskId).operations[
    activeOperation.operationIndex
  ];
};

export const getHardwareDrawWatts = (state: GameState) => {
  const socketCount = Math.max(1, state.hardware.cpus.length);
  const boardWatts = state.flags.systemStats ? 12 : 6;
  const socketWatts = socketCount * 7.5;
  const coreIdleWatts = Array.from(
    { length: state.hardware.cores },
    (_, index) => {
      const coreId = index + 1;
      const level = getCoreClockLevel(state, coreId);
      return 0.8 + 0.46 * level ** 1.28;
    },
  ).reduce((sum, watts) => sum + watts, 0);
  const activeCoreWatts = state.activeTasks
    .flatMap((task) => task.coreOperations)
    .reduce((sum, operation) => {
      const definition = getActiveOperationDefinition(state, operation);
      if (!definition) return sum;

      const level = getCoreClockLevel(state, operation.coreId);
      const clockDraw = 0.32 * level ** 1.42;
      return (
        sum +
        (getOperationActivityDrawWatts(definition, operation) + clockDraw) *
          activeOperationPowerMultiplier(operation)
      );
    }, 0);
  const cacheWatts = state.hardware.cpus.reduce(
    (sum, cpu) => sum + (cpu.cacheLevel <= 0 ? 0 : 0.18 * cpu.cacheLevel ** 1.45),
    0,
  );
  const ramWatts =
    state.hardware.ramLevel <= 0 ? 0 : 1.8 * state.hardware.ramLevel ** 1.22;
  const coolingWatts =
    state.hardware.coolingLevel <= 0
      ? 0
      : 1.4 * state.hardware.coolingLevel ** 1.18;

  return Math.round(
    (boardWatts +
      socketWatts +
      coreIdleWatts +
      activeCoreWatts +
      cacheWatts +
      ramWatts +
      coolingWatts) *
      10,
  ) / 10;
};

export const getPsuCapacityWatts = (state: GameState) =>
  state.hardware.psuWatts > 0 ? state.hardware.psuWatts : 65;

export const getPsuStress = (state: GameState) =>
  getHardwareDrawWatts(state) / Math.max(1, getPsuCapacityWatts(state));

export const getCoolingReliabilityBonus = (state: GameState) =>
  1 + state.hardware.coolingRating * 0.18;

export const getRestartReliability = (state: GameState) => {
  const overload = Math.max(0, getPsuStress(state) - 0.85);
  const penalty = overload ** 1.35 / getCoolingReliabilityBonus(state);

  return Math.round(clamp(1 - penalty, 0.05, 1) * 1000) / 1000;
};

export const getRestartRiskPerSecond = (state: GameState) =>
  Math.max(0, 1 - getRestartReliability(state)) * 0.8;

export const getCorruptionRiskPerSecond = (state: GameState) => {
  if (!state.flags.multiCore) return 0;

  const hasParallelWork = state.activeTasks.some(
    (task) =>
      task.assignedCoreIds.length > 1 &&
      task.coreOperations.some((operation) => operation.status !== "complete"),
  );

  if (!hasParallelWork) return 0;

  const pressure = Math.max(0, getPsuStress(state) - 0.75);
  return Math.round(
    (pressure ** 1.25 / getCoolingReliabilityBonus(state)) * 1000,
  ) / 1000;
};

export const getReservedMemoryBytes = (state: GameState) =>
  bitsToBytes(getReservedMemoryBits(state));

export const getReservedMemoryBits = (state: GameState) =>
  state.activeTasks
    .flatMap((task) => task.coreOperations)
    .reduce(
      (sum, operation) =>
        operation.status === "complete" || operation.status === "waitingMemory"
          ? sum
          : sum + operation.memoryReservedBits,
      0,
    );
