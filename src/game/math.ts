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
  ActiveTask,
  GameState,
  TaskDefinition,
  TaskOperationDefinition,
} from "./types";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const DEADLOCK_FAILURE_SECONDS = 10;

export const getDeadlockCooldownRate = (state: GameState) =>
  1 + Math.max(0, state.hardware.deadlockRecoveryLevel ?? 0) * 0.5;

export const getHardwareCacheBits = (state: GameState) =>
  Math.max(
    state.hardware.cpus.length > 0
      ? 0
      : (state.hardware.cacheBits ?? state.hardware.cacheBytes * 8),
    ...state.hardware.cpus.map((cpu) => getCpuHardware(state, cpu.id).cacheBits),
  );

const getSegmentBits = (segments: number[]) =>
  segments.reduce((total, bits) => total + bits, 0);

const overlayCacheBits = (segments: number[], bits: number) => {
  let remainingBits = bits;

  for (let index = segments.length - 1; index >= 0 && remainingBits > 0; index -= 1) {
    const segmentBits = segments[index] ?? 0;
    const overlaidBits = Math.min(segmentBits, remainingBits);

    remainingBits -= overlaidBits;
  }

  if (remainingBits > 0) segments.push(remainingBits);
};

const isTaskOperationAssignedToCore = (
  activeTask: ActiveTask,
  operation: TaskOperationDefinition,
  coreId: number,
) => operation.parallel || operation.kind === "barrier" || coreId === activeTask.coreId;

const isCurrentOperationCacheResident = (runtime: ActiveCoreOperation) =>
  [
    "loadingCache",
    "loadingRam",
    "running",
    "waitingBarrier",
    "deadlocked",
  ].includes(runtime.status);

const getCacheProgress = (remaining: number, total: number) => {
  if (total <= 0) return 1;
  return clamp(1 - remaining / total, 0, 1);
};

const isCacheLoadingRuntime = (runtime: ActiveCoreOperation) =>
  runtime.status === "loadingCache" ||
  (runtime.status === "deadlocked" && runtime.lockResource === "cache");

const getRuntimeOperationCacheBits = (
  state: GameState,
  operation: TaskOperationDefinition,
  runtime: ActiveCoreOperation,
  loaded: boolean,
) => {
  if (operation.cacheBits <= 0) return 0;
  if (loaded || !isCacheLoadingRuntime(runtime)) return operation.cacheBits;

  const writeProgress = getCacheProgress(
    runtime.remainingLoadCycles,
    getCacheLoadCycles(state, operation),
  );
  if (!operation.memoryAction) return operation.cacheBits * writeProgress;

  const issueProgress = getCacheProgress(
    runtime.remainingCycles,
    runtime.totalCycles,
  );
  return operation.cacheBits * issueProgress;
};

export const getActiveOperationCacheBits = (
  state: GameState,
  activeTask: ActiveTask,
  runtime: ActiveCoreOperation,
) => {
  if (runtime.status === "complete") return 0;

  const definition = getTaskDefinition(activeTask.taskId);
  const segments: number[] = [];

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

    const bits = getRuntimeOperationCacheBits(state, operation, runtime, loaded);
    if (bits <= 0) continue;

    if (operation.kind !== "memory") {
      const missingBits = bits - getSegmentBits(segments);
      if (missingBits > 0) segments.push(missingBits);
      continue;
    }

    if (operation.memoryAction === "overwrite") {
      overlayCacheBits(segments, bits);
      continue;
    }

    segments.push(bits);
  }

  return getSegmentBits(segments);
};

export const getReservedCacheBits = (state: GameState, cpuId?: number) =>
  state.activeTasks.reduce(
    (sum, task) =>
      sum +
      task.coreOperations.reduce((operationSum, operation) => {
        if (cpuId !== undefined && getCpuForCore(state, operation.coreId).id !== cpuId) {
          return operationSum;
        }

        return operationSum + getActiveOperationCacheBits(state, task, operation);
      }, 0),
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

const getInstalledRamSticks = (state: GameState) => {
  if (state.hardware.ramSticks.length > 0) return state.hardware.ramSticks;

  const ramBits = getHardwareRamBits(state);
  if (ramBits <= 0) return [];

  return [
    {
      id: 1,
      level: Math.max(1, state.hardware.ramLevel),
      bits: ramBits,
      bytes: bitsToBytes(ramBits),
      speedLevel: Math.max(1, state.hardware.ramSpeedLevel),
      speedMt: state.hardware.ramSpeedMt > 0 ? state.hardware.ramSpeedMt : 1,
    },
  ];
};

export const getMemorySpeedMt = (state: GameState) => {
  const speeds = getInstalledRamSticks(state).map((stick) => stick.speedMt);
  if (speeds.length > 0) return Math.max(1, ...speeds);

  return state.hardware.ramSpeedMt > 0 ? state.hardware.ramSpeedMt : 1;
};

const getCountedRamBits = (operation: ActiveCoreOperation) =>
  operation.status === "complete" || operation.status === "waitingMemory"
    ? 0
    : operation.memoryReservedBits;

const isSameActiveOperation = (
  task: ActiveTask,
  candidateTask: ActiveTask,
  operation: ActiveCoreOperation,
  candidate: ActiveCoreOperation,
) =>
  candidate === operation ||
  (candidateTask.instanceId === task.instanceId &&
    candidate.coreId === operation.coreId &&
    candidate.operationIndex === operation.operationIndex &&
    candidate.operationId === operation.operationId);

const getRamBitOffsetForOperation = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
) => {
  let offset = 0;

  for (const activeTask of state.activeTasks) {
    for (const candidate of activeTask.coreOperations) {
      if (isSameActiveOperation(task, activeTask, operation, candidate)) {
        return offset + operation.memoryReservedBits;
      }

      offset += getCountedRamBits(candidate);
    }
  }

  return Math.max(0, getReservedMemoryBits(state) - operation.memoryReservedBits);
};

const getRamStickSpanAtOffset = (state: GameState, bitOffset: number) => {
  const sticks = getInstalledRamSticks(state);
  let startBits = 0;

  for (const stick of sticks) {
    const endBits = startBits + stick.bits;
    if (bitOffset < endBits) {
      return {
        endBits,
        speedMt: Math.max(1, stick.speedMt),
      };
    }

    startBits = endBits;
  }

  return null;
};

export const getRamLoadCyclesForOperationTick = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
  deltaSeconds: number,
) => {
  let remainingSeconds = Math.max(0, deltaSeconds);
  let remainingLoadCycles = Math.max(0, operation.remainingLoadCycles);
  let bitOffset = getRamBitOffsetForOperation(state, task, operation);
  let loadCycles = 0;

  while (remainingSeconds > 0 && remainingLoadCycles > 0) {
    const span = getRamStickSpanAtOffset(state, bitOffset);
    const speedMt = span?.speedMt ?? getMemorySpeedMt(state);
    const bitsUntilNextStick = span
      ? Math.max(0, span.endBits - bitOffset)
      : Number.POSITIVE_INFINITY;
    const requestedCycles = speedMt * remainingSeconds;
    const appliedCycles = Math.min(
      remainingLoadCycles,
      bitsUntilNextStick,
      requestedCycles,
    );

    if (appliedCycles <= 0) break;

    loadCycles += appliedCycles;
    remainingLoadCycles -= appliedCycles;
    bitOffset += appliedCycles;
    remainingSeconds -= appliedCycles / speedMt;
  }

  return loadCycles;
};

const estimateRamLoadSeconds = (state: GameState, ramBits: number) => {
  let remainingBits = Math.max(0, ramBits);
  let bitOffset = 0;
  let seconds = 0;

  while (remainingBits > 0) {
    const span = getRamStickSpanAtOffset(state, bitOffset);
    const speedMt = span?.speedMt ?? getMemorySpeedMt(state);
    const bitsUntilNextStick = span
      ? Math.max(0, span.endBits - bitOffset)
      : remainingBits;
    const appliedBits = Math.min(remainingBits, bitsUntilNextStick);

    if (appliedBits <= 0) break;

    seconds += appliedBits / speedMt;
    remainingBits -= appliedBits;
    bitOffset += appliedBits;
  }

  return seconds;
};

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
    const ramSeconds = estimateRamLoadSeconds(
      state,
      getRamLoadCycles(state, operation),
    );
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
  if (
    operation.status === "complete" ||
    operation.status === "waitingMemory" ||
    operation.status === "deadlocked"
  ) {
    return 0;
  }
  if (operation.status === "waitingBarrier") return 0.12;
  if (operation.status === "loadingCache") return 0.38;
  if (operation.status === "loadingRam") return 0.55;
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

export const getPowerReliability = (state: GameState) => {
  const overload = Math.max(0, getPsuStress(state) - 0.85);
  const penalty = overload ** 1.35 / getCoolingReliabilityBonus(state);

  return Math.round(clamp(1 - penalty, 0.05, 1) * 1000) / 1000;
};

export const getReservedMemoryBytes = (state: GameState) =>
  bitsToBytes(getReservedMemoryBits(state));

export const getReservedMemoryBits = (state: GameState) =>
  state.activeTasks
    .flatMap((task) => task.coreOperations)
    .reduce(
      (sum, operation) =>
        operation.status === "complete" ||
        operation.status === "waitingMemory"
          ? sum
          : sum + operation.memoryReservedBits,
      0,
    );
