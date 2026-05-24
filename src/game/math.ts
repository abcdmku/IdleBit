import { getTaskDefinition } from "./content/tasks";
import { getCStateIdleMultiplier } from "./content/cpuTiers";
import {
  getMemoryVoltageIdleMultiplier,
  getRamStickEfficiency,
} from "./content/ramTuning";
import { getGlobalCStateLevel } from "./cState";
import {
  bitsToBytes,
  getCpuEfficiency,
  getCpuClockHz,
  getCpuForCore,
  getCpuHardware,
  getCoreClockHz,
  getCoreClockLevel,
  STARTER_PSU_WATTS,
} from "./progression";
import type {
  ActiveCoreOperation,
  ActiveTask,
  GameState,
  RamBlockAllocation,
  RamStickState,
  TaskDefinition,
  TaskOperationDefinition,
} from "./types";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const DEADLOCK_FAILURE_SECONDS = 10;
export const POWER_OVERLOAD_FAILURE_SECONDS = 10;

export const getDeadlockCooldownRate = (state: GameState) =>
  1 + Math.max(0, state.hardware.deadlockRecoveryLevel ?? 0) * 0.5;

export const getPowerOverloadRate = (psuStress: number) =>
  psuStress > 1 ? Math.max(1, psuStress) : 0;

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

const getRuntimeTaskOperation = (
  _activeTask: ActiveTask,
  operation: TaskOperationDefinition,
) => {
  return operation;
};

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
    const rawOperation = definition.operations[operationIndex];
    if (!rawOperation) continue;
    if (!isTaskOperationAssignedToCore(activeTask, rawOperation, runtime.coreId)) {
      continue;
    }
    const operation = getRuntimeTaskOperation(activeTask, rawOperation);

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

export const getInstalledRamSticks = (state: GameState) => {
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

export const getRamChannelCount = (state: GameState) => {
  if (
    state.flags.octChannelRam ||
    state.research.completed.includes("octChannelRam")
  ) {
    return 8;
  }
  if (
    state.flags.quadChannelRam ||
    state.research.completed.includes("quadChannelRam")
  ) {
    return 4;
  }
  if (
    state.flags.dualChannelRam ||
    state.research.completed.includes("dualChannelRam")
  ) {
    return 2;
  }
  return 1;
};

const isSystemScheduledActiveTask = (task: ActiveTask) => {
  const definition = getTaskDefinition(task.taskId);
  return (
    task.schedulerQueued &&
    (definition.category === "system" || definition.category === "distributed")
  );
};

const getTaskRamChannelCount = (state: GameState, task: ActiveTask) =>
  isSystemScheduledActiveTask(task)
    ? Math.max(
        1,
        Math.min(getRamChannelCount(state), getInstalledRamSticks(state).length),
      )
    : 1;

export const getRamChannelBlockedReason = (state: GameState) => {
  const sticks = getInstalledRamSticks(state).length;
  if (!state.flags.scheduler) return "Needs System Scheduler";
  if (getRamChannelCount(state) <= 1) return "Needs Dual Channel RAM";
  if (sticks < 2) return "Install 2 RAM sticks";
  return null;
};

const getBlockTotalBits = (blocks: RamBlockAllocation[]) =>
  blocks.reduce((total, block) => total + Math.max(0, block.lengthBits), 0);

const getOperationRamBlocks = (operation: ActiveCoreOperation) =>
  operation.status === "waitingMemory"
    ? []
    : operation.ramBlocks ?? [];

const isSameRamRuntime = (
  task: ActiveTask,
  operation: ActiveCoreOperation,
  candidateTask: ActiveTask,
  candidate: ActiveCoreOperation,
) =>
  candidateTask.instanceId === task.instanceId &&
  candidate.coreId === operation.coreId &&
  candidate.operationIndex === operation.operationIndex &&
  candidate.operationId === operation.operationId;

const getActiveRamBlocks = (
  state: GameState,
  excludedTask?: ActiveTask,
  excludedOperation?: ActiveCoreOperation,
) =>
  state.activeTasks.flatMap((activeTask) =>
    activeTask.coreOperations.flatMap((operation) => {
      if (
        excludedTask &&
        excludedOperation &&
        isSameRamRuntime(excludedTask, excludedOperation, activeTask, operation)
      ) {
        return [];
      }
      return getOperationRamBlocks(operation);
    }),
  );

interface FreeRamRange {
  startBit: number;
  lengthBits: number;
}

const getFreeRamRanges = (
  stick: RamStickState,
  blocks: RamBlockAllocation[],
): FreeRamRange[] => {
  const occupied = blocks
    .filter((block) => block.stickId === stick.id && block.lengthBits > 0)
    .map((block) => ({
      startBit: Math.max(0, block.startBit),
      endBit: Math.min(stick.bits, block.startBit + block.lengthBits),
    }))
    .filter((range) => range.endBit > range.startBit)
    .sort((a, b) => a.startBit - b.startBit);
  const ranges: FreeRamRange[] = [];
  let cursor = 0;

  for (const range of occupied) {
    if (range.startBit > cursor) {
      ranges.push({ startBit: cursor, lengthBits: range.startBit - cursor });
    }
    cursor = Math.max(cursor, range.endBit);
  }

  if (cursor < stick.bits) {
    ranges.push({ startBit: cursor, lengthBits: stick.bits - cursor });
  }

  return ranges;
};

const takeFromRanges = (
  ranges: FreeRamRange[],
  bits: number,
  stickId: number,
  channelIndex: number,
) => {
  let remaining = Math.max(0, bits);
  const blocks: RamBlockAllocation[] = [];

  for (const range of ranges) {
    if (remaining <= 0) break;
    if (range.lengthBits <= 0) continue;

    const lengthBits = Math.min(remaining, range.lengthBits);
    blocks.push({
      stickId,
      startBit: range.startBit,
      lengthBits,
      loadedBits: 0,
      channelIndex,
    });
    range.startBit += lengthBits;
    range.lengthBits -= lengthBits;
    remaining -= lengthBits;
  }

  return blocks;
};

interface RamStickPlan {
  stick: RamStickState;
  channelIndex: number;
  ranges: FreeRamRange[];
}

const takeFromStickPlans = (plans: RamStickPlan[], bits: number) => {
  let remainingBits = Math.max(0, bits);
  const blocks: RamBlockAllocation[] = [];

  for (const plan of plans) {
    if (remainingBits <= 0) break;

    const plannedBlocks = takeFromRanges(
      plan.ranges,
      remainingBits,
      plan.stick.id,
      plan.channelIndex,
    );
    blocks.push(...plannedBlocks);
    remainingBits -= getBlockTotalBits(plannedBlocks);
  }

  return { blocks, remainingBits };
};

export const allocateRamBlocksForOperation = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
  bits: number,
) => {
  const requiredBits = Math.max(0, bits);
  if (requiredBits <= 0) return { blocks: [], channelCount: 1 };
  if (getBlockTotalBits(operation.ramBlocks ?? []) >= requiredBits) {
    return {
      blocks: operation.ramBlocks,
      channelCount: Math.max(1, operation.ramChannelCount),
    };
  }

  const sticks = getInstalledRamSticks(state);
  if (sticks.length === 0) return null;

  const channelCount = getTaskRamChannelCount(state, task);
  const activeBlocks = getActiveRamBlocks(state, task, operation);
  const plans = sticks.map((stick, index) => ({
    stick,
    channelIndex: index % channelCount,
    ranges: getFreeRamRanges(stick, activeBlocks),
  }));
  const totalFree = plans.reduce(
    (total, plan) =>
      total + plan.ranges.reduce((sum, range) => sum + range.lengthBits, 0),
    0,
  );

  if (totalFree < requiredBits) return null;

  if (channelCount <= 1) {
    const allocation = takeFromStickPlans(plans, requiredBits);
    const usedChannelCount = Math.max(
      1,
      new Set(allocation.blocks.map((block) => block.channelIndex)).size,
    );

    return allocation.remainingBits <= 0
      ? { blocks: allocation.blocks, channelCount: usedChannelCount }
      : null;
  }

  const channelPlans = Array.from({ length: channelCount }, (_, channelIndex) =>
    plans.filter((plan) => plan.channelIndex === channelIndex),
  );
  const baseBits = Math.floor(requiredBits / channelPlans.length);
  let remainingBits = requiredBits;
  const blocks: RamBlockAllocation[] = [];

  channelPlans.forEach((plansForChannel, index) => {
    const desiredBits =
      baseBits + (index < requiredBits % channelPlans.length ? 1 : 0);
    const allocation = takeFromStickPlans(plansForChannel, desiredBits);
    blocks.push(...allocation.blocks);
    remainingBits -= desiredBits - allocation.remainingBits;
  });

  for (const plansForChannel of channelPlans) {
    if (remainingBits <= 0) break;
    const allocation = takeFromStickPlans(plansForChannel, remainingBits);
    blocks.push(...allocation.blocks);
    remainingBits = allocation.remainingBits;
  }

  const usedChannelCount = Math.max(
    1,
    new Set(blocks.map((block) => block.channelIndex)).size,
  );

  return remainingBits <= 0 ? { blocks, channelCount: usedChannelCount } : null;
};

export const getRamBlockLoadDeltasForOperationTick = (
  state: GameState,
  operation: ActiveCoreOperation,
  deltaSeconds: number,
) => {
  const operationRates =
    getRamWriteRateAllocations(state).get(getRamWriteOperationKey(operation)) ??
    new Map<string, number>();

  return (operation.ramBlocks ?? []).map((block) => {
    const currentBudget =
      (operationRates.get(getRamWriteBlockKey(operation, block)) ?? 0) *
      deltaSeconds;
    const remainingBits = Math.max(0, block.lengthBits - block.loadedBits);
    const loadedBits = Math.min(remainingBits, currentBudget);
    return loadedBits;
  });
};

const getRamWriteOperationKey = (operation: ActiveCoreOperation) =>
  [
    operation.coreId,
    operation.workUnitIndex ?? "main",
    operation.operationIndex,
    operation.operationId ?? "pending",
  ].join(":");

export const getRamWriteBlockKey = (
  operation: ActiveCoreOperation,
  block: RamBlockAllocation,
) =>
  [
    getRamWriteOperationKey(operation),
    block.channelIndex ?? 0,
    block.stickId,
    block.startBit,
    block.lengthBits,
  ].join(":");

const getActiveRamLoadBlocks = (operation: ActiveCoreOperation) =>
  (operation.ramBlocks ?? []).filter(
    (block) => block.loadedBits < block.lengthBits,
  );

const getCurrentRamWriteBlocks = (operation: ActiveCoreOperation) => {
  const blocksByChannel = new Map<number, RamBlockAllocation>();

  for (const block of operation.ramBlocks ?? []) {
    if (block.loadedBits >= block.lengthBits) continue;

    const channelIndex = block.channelIndex ?? 0;
    if (!blocksByChannel.has(channelIndex)) {
      blocksByChannel.set(channelIndex, block);
    }
  }

  return Array.from(blocksByChannel.values());
};

const getActiveRamLoadOperations = (state: GameState) =>
  state.activeTasks
    .flatMap((task) => task.coreOperations)
    .filter(
      (operation) =>
        operation.status === "loadingRam" &&
        getActiveRamLoadBlocks(operation).length > 0,
    );

const getSelectedRamWriteSticksByChannel = (state: GameState) => {
  const selectedSticks = new Map<number, number>();

  for (const operation of getActiveRamLoadOperations(state)) {
    for (const block of getCurrentRamWriteBlocks(operation)) {
      const channelIndex = block.channelIndex ?? 0;
      if (!selectedSticks.has(channelIndex)) {
        selectedSticks.set(channelIndex, block.stickId);
      }
    }
  }

  return selectedSticks;
};

const getRamWriteRateAllocations = (state: GameState) => {
  const sticksById = new Map(
    getInstalledRamSticks(state).map((stick) => [stick.id, stick]),
  );
  const selectedSticksByChannel = getSelectedRamWriteSticksByChannel(state);
  const requestedRates = new Map<string, Map<string, number>>();
  const blockChannels = new Map<string, number>();
  const channelRequestedRates = new Map<number, number>();
  const channelCapacityRates = new Map<number, number>();

  for (const operation of getActiveRamLoadOperations(state)) {
    const blocks = getCurrentRamWriteBlocks(operation).filter(
      (block) =>
        selectedSticksByChannel.get(block.channelIndex ?? 0) === block.stickId,
    );
    const totalRemainingBits = blocks.reduce(
      (total, block) =>
        total + Math.max(0, block.lengthBits - block.loadedBits),
      0,
    );
    if (totalRemainingBits <= 0) continue;

    const operationKey = getRamWriteOperationKey(operation);
    const operationRates = new Map<string, number>();
    const coreWriteRate = Math.max(0, getCoreClockHz(state, operation.coreId));

    for (const block of blocks) {
      const channelIndex = block.channelIndex ?? 0;
      const remainingBits = Math.max(0, block.lengthBits - block.loadedBits);
      const requestedRate =
        coreWriteRate * (remainingBits / totalRemainingBits);
      const blockKey = getRamWriteBlockKey(operation, block);

      operationRates.set(blockKey, requestedRate);
      blockChannels.set(blockKey, channelIndex);
      channelRequestedRates.set(
        channelIndex,
        (channelRequestedRates.get(channelIndex) ?? 0) + requestedRate,
      );
      channelCapacityRates.set(
        channelIndex,
        Math.max(
          channelCapacityRates.get(channelIndex) ?? 0,
          sticksById.get(block.stickId)?.speedMt ?? getMemorySpeedMt(state),
        ),
      );
    }

    requestedRates.set(operationKey, operationRates);
  }

  return new Map(
    Array.from(requestedRates.entries()).map(([operationKey, operationRates]) => [
      operationKey,
      new Map(
        Array.from(operationRates.entries()).map(([blockKey, requestedRate]) => {
          const channelIndex = blockChannels.get(blockKey) ?? 0;
          const totalRequestedRate = channelRequestedRates.get(channelIndex) ?? 0;
          const capacityRate = channelCapacityRates.get(channelIndex) ?? 0;
          const scale =
            totalRequestedRate > 0 && capacityRate > 0
              ? Math.min(1, capacityRate / totalRequestedRate)
              : 0;
          return [blockKey, requestedRate * scale];
        }),
      ),
    ]),
  );
};

export const getActiveRamWriteBandwidthBps = (state: GameState) =>
  Array.from(getRamWriteRateAllocations(state).values()).reduce(
    (total, operationRates) =>
      total +
      Array.from(operationRates.values()).reduce(
        (operationTotal, rate) => operationTotal + rate,
        0,
      ),
    0,
  );

export const getActiveRamWriteBlockKeys = (state: GameState) =>
  new Set(
    Array.from(getRamWriteRateAllocations(state).values()).flatMap(
      (operationRates) =>
        Array.from(operationRates.entries())
          .filter(([, rate]) => rate > 0)
          .map(([blockKey]) => blockKey),
    ),
  );

const getCountedRamBits = (operation: ActiveCoreOperation) =>
  operation.status === "complete" || operation.status === "waitingMemory"
    ? 0
    : getBlockTotalBits(operation.ramBlocks ?? []) || operation.memoryReservedBits;

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
  if ((operation.ramBlocks ?? []).length > 0) {
    return getRamBlockLoadDeltasForOperationTick(
      state,
      operation,
      deltaSeconds,
    ).reduce((total, bits) => total + bits, 0);
  }

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
  _state: GameState,
  operation: TaskOperationDefinition,
) => {
  if (operation.ramBits <= 0) return 0;
  return operation.ramBits;
};

export const getCacheLoadRate = (state: GameState, coreId: number) => {
  const cpu = getCpuForCore(state, coreId);
  return getCpuClockHz(cpu.tierId, cpu.cacheSpeedLevel ?? 1);
};

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

const roundThousandth = (value: number) => Math.round(value * 1000) / 1000;

const roundPowerWatts = (value: number) => Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;

const getUniqueCount = <T,>(values: T[]) => new Set(values).size;

export const getRamMatchEfficiency = (state: GameState) => {
  const sticks = getInstalledRamSticks(state);
  if (sticks.length <= 1) return 1;

  const sizeMatch = getUniqueCount(sticks.map((stick) => stick.bits)) === 1 ? 1 : 0.92;
  const speedMatch =
    getUniqueCount(sticks.map((stick) => stick.speedMt)) === 1 ? 1 : 0.9;

  return roundThousandth(sizeMatch * speedMatch);
};

const getCpuCoreClockSignature = (state: GameState, coreIds: number[]) =>
  coreIds.map((coreId) => getCoreClockLevel(state, coreId)).join("/");

export const getCpuMatchEfficiency = (state: GameState) => {
  const cpus = state.hardware.cpus.map((cpu) => getCpuHardware(state, cpu.id));
  if (cpus.length <= 1) return 1;

  const signatures = cpus.map((cpu) =>
    [
      cpu.coreIds.length,
      cpu.cacheLevel,
      cpu.cacheSpeedLevel,
      cpu.schedulerSlots,
      getCpuCoreClockSignature(state, cpu.coreIds),
    ].join(":"),
  );

  return getUniqueCount(signatures) === 1 ? 1 : 0.88;
};

export const getPowerEfficiency = (state: GameState) =>
  roundThousandth(clamp(getRamMatchEfficiency(state) * getCpuMatchEfficiency(state), 0.7, 1));

const getPowerStateDrawMultiplier = (state: GameState) => {
  if (state.power.state === "off") return 0;
  if (state.power.state === "booting" || state.power.state === "shuttingDown") {
    return 0.35;
  }
  return 1;
};

const getCronQueueSpikeWatts = (state: GameState) =>
  state.cron.queuePowerSpikeSeconds > 0 ? 0.00000005 : 0;

const getActiveRamWriteStickIds = (state: GameState) =>
  new Set(
    state.activeTasks.flatMap((task) =>
      task.coreOperations.flatMap((operation) =>
        operation.status === "loadingRam"
          ? (operation.ramBlocks ?? [])
              .filter((block) => block.loadedBits < block.lengthBits)
              .map((block) => block.stickId)
          : [],
      ),
    ),
  );

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
  const boardWatts = state.flags.systemStats ? 0.00000000000008 : 0;
  const socketWatts = Math.max(0, socketCount - 1) * 0.00000000000008;
  const activeCoreIds = new Set(
    state.activeTasks
      .flatMap((task) => task.coreOperations)
      .filter((operation) => activeOperationPowerMultiplier(operation) > 0)
      .map((operation) => operation.coreId),
  );
  const cStateLevel = getGlobalCStateLevel(state);
  const idleMultiplier =
    state.flags.cStateControl || cStateLevel > 0
      ? getCStateIdleMultiplier(cStateLevel)
      : 1;
  const cpuWatts = Array.from({ length: state.hardware.cores }, (_, index) => {
    const coreId = index + 1;
    const cpu = getCpuForCore(state, coreId);
    const activeDrawWatts =
      (getCoreClockHz(state, coreId) / getCpuEfficiency(cpu.tierId, cpu.level)) /
      1_000_000;
    return activeCoreIds.has(coreId)
      ? activeDrawWatts
      : activeDrawWatts * idleMultiplier;
  }).reduce((sum, watts) => sum + watts, 0);
  const cacheWatts = state.hardware.cpus.reduce(
    (sum, cpu) =>
      sum +
      (cpu.cacheLevel <= 0
        ? 0
        : 0.00000000000002 * Math.max(0, cpu.cacheLevel - 1) ** 1.18 +
          0.00000000000001 * Math.max(0, cpu.cacheSpeedLevel - 1) ** 1.16),
    0,
  );
  const activeRamStickIds = getActiveRamWriteStickIds(state);
  const memoryVoltageMultiplier = getMemoryVoltageIdleMultiplier(
    state.hardware.memoryVoltageLevel ?? 0,
  );
  const ramWatts = getInstalledRamSticks(state).reduce((sum, stick) => {
    const activeDrawWatts =
      ((Math.max(1, stick.speedMt) / getRamStickEfficiency(stick.speedLevel)) *
        0.1) /
      1_000_000;
    const capacityDrawWatts =
      0.000000000000004 * Math.max(1, stick.level) ** 1.12;
    const drawWatts = activeRamStickIds.has(stick.id)
      ? activeDrawWatts
      : activeDrawWatts * memoryVoltageMultiplier;

    return sum + drawWatts + capacityDrawWatts;
  }, 0);
  const coolingWatts =
    state.hardware.coolingLevel <= 0
      ? 0
      : 0.00000000000008 * state.hardware.coolingLevel ** 1.12;
  const rawDraw =
    boardWatts +
    socketWatts +
    cpuWatts +
    cacheWatts +
    ramWatts +
    coolingWatts +
    getCronQueueSpikeWatts(state);
  const draw = (rawDraw / getPowerEfficiency(state)) * getPowerStateDrawMultiplier(state);

  return roundPowerWatts(draw);
};

export const getPsuCapacityWatts = (state: GameState) =>
  state.hardware.psuWatts > 0 ? state.hardware.psuWatts : STARTER_PSU_WATTS;

export const getPsuStress = (state: GameState) =>
  getHardwareDrawWatts(state) / Math.max(0.000000000001, getPsuCapacityWatts(state));

export const getCoolingReliabilityBonus = (state: GameState) =>
  1 + state.hardware.coolingRating * 0.36;

export const getPowerReliability = (state: GameState) => {
  const overload = Math.max(0, getPsuStress(state) - 0.85);
  const efficiencyPenalty = 1 / Math.max(0.7, getPowerEfficiency(state));
  const penalty =
    (overload ** 1.35 * efficiencyPenalty) / getCoolingReliabilityBonus(state);

  return Math.round(clamp(1 - penalty, 0.05, 1) * 1000) / 1000;
};

export const getBilledPowerWatts = (state: GameState) =>
  getHardwareDrawWatts(state);

export const getPowerCostPerSecond = (state: GameState) =>
  roundThousandth(getBilledPowerWatts(state) * 1_000_000);

export const getReservedMemoryBytes = (state: GameState) =>
  bitsToBytes(getReservedMemoryBits(state));

export const getReservedMemoryBits = (state: GameState) =>
  state.activeTasks
    .flatMap((task) => task.coreOperations)
    .reduce(
      (sum, operation) => {
        if (
          operation.status === "complete" ||
          operation.status === "waitingMemory"
        ) {
          return sum;
        }

        const blockBits = getBlockTotalBits(operation.ramBlocks ?? []);
        return sum + (blockBits > 0 ? blockBits : operation.memoryReservedBits);
      },
      0,
    );
