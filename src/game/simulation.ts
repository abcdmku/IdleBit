import { getResearchDefinition, researchDefinitions } from "./content/research";
import { getTaskDefinition, taskDefinitions } from "./content/tasks";
import { getUpgradeDefinition, upgradeDefinitions } from "./content/upgrades";
import { addRewards, canAfford, spend } from "./economy";
import {
  estimateActiveRemainingSeconds,
  getAvailableCacheBits,
  getAvailableMemoryBits,
  getAvailableSchedulerSlots,
  getCacheLoadCycles,
  getCacheLoadRate,
  getCorruptionRiskPerSecond,
  getHardwareCacheBits,
  getMemoryCapacityBits,
  getOperationEffectiveClock,
  getRamLoadCycles,
  getRamLoadRate,
  getReservedMemoryBits,
  getRestartRiskPerSecond,
} from "./math";
import {
  getCoreClockHz,
  getOperationProgress,
  syncCoreSchedulers,
  updateProgressionFlags,
} from "./progression";
import type {
  ActiveCoreOperation,
  ActiveTask,
  GameAction,
  GameState,
  OperationRuntimeStatus,
  ResearchId,
  TaskDefinition,
  TaskId,
  TaskOperationDefinition,
  UpgradeId,
} from "./types";

const isBenchmarkComplete = (state: GameState, taskId: TaskId) =>
  state.completedBenchmarks.includes(taskId) ||
  (state.completedTasks[taskId] ?? state.completedJobs[taskId] ?? 0) > 0;

const availableCoreIds = (state: GameState) => {
  const busy = new Set(
    state.activeTasks.flatMap((task) => task.assignedCoreIds),
  );

  return Array.from({ length: state.hardware.cores }, (_, index) => index + 1).filter(
    (coreId) => !busy.has(coreId),
  );
};

const isOperationAssignedToCore = (
  task: ActiveTask,
  operation: TaskOperationDefinition,
  coreId: number,
) => operation.parallel || operation.kind === "barrier" || coreId === task.coreId;

const getOperation = (task: ActiveTask, operationIndex: number) =>
  getTaskDefinition(task.taskId).operations[operationIndex] ?? null;

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

const refreshTaskTotals = (task: ActiveTask): ActiveTask => {
  const remainingCycles = task.coreOperations.reduce(
    (sum, operation) =>
      sum + getRuntimeWork(getOperation(task, operation.operationIndex), operation).remaining,
    0,
  );
  const totalCycles = task.coreOperations.reduce(
    (sum, operation) =>
      sum + getRuntimeWork(getOperation(task, operation.operationIndex), operation).total,
    0,
  );
  const restarts = task.coreOperations.reduce(
    (sum, operation) => sum + operation.restarts,
    0,
  );
  const reruns = task.coreOperations.reduce(
    (sum, operation) => sum + operation.reruns,
    0,
  );
  const corruptions = task.coreOperations.reduce(
    (sum, operation) => sum + operation.corruptions,
    0,
  );

  return {
    ...task,
    remainingCycles,
    totalCycles,
    restarts,
    reruns,
    corruptions,
  };
};

const isTaskRevealed = (state: GameState, task: TaskDefinition) =>
  task.reveal(state) || task.requirement(state);

const isPlayerFacingTask = (task: TaskDefinition) => task.kind !== "benchmark";

const taskFitsHardware = (state: GameState, task: TaskDefinition) =>
  task.cacheNeedBits <= getHardwareCacheBits(state) &&
  task.ramNeedBits <= getMemoryCapacityBits(state);

const taskFitsFreeStaging = (state: GameState, task: TaskDefinition) =>
  task.cacheNeedBits <= getAvailableCacheBits(state) &&
  task.ramNeedBits <= getAvailableMemoryBits(state);

const canAcceptTask = (state: GameState, taskId: TaskId) => {
  const task = getTaskDefinition(taskId);
  const benchmarkDone = task.kind === "benchmark" && isBenchmarkComplete(state, taskId);

  return task.requirement(state) && !benchmarkDone && taskFitsHardware(state, task);
};

const canStartTask = (state: GameState, taskId: TaskId) => {
  const task = getTaskDefinition(taskId);

  return canAcceptTask(state, taskId) && taskFitsFreeStaging(state, task);
};

const canQueueTask = (state: GameState, taskId: TaskId) =>
  canAcceptTask(state, taskId) &&
  (state.flags.basicQueue || state.flags.scheduler) &&
  getAvailableSchedulerSlots(state) > 0;

const selectCoreIdsForTask = (
  state: GameState,
  task: TaskDefinition,
  preferredCoreId?: number,
) => {
  const available = availableCoreIds(state);
  const preferred =
    preferredCoreId && available.includes(preferredCoreId) ? [preferredCoreId] : [];
  const remaining = available.filter((coreId) => coreId !== preferredCoreId);
  const ordered = [...preferred, ...remaining];
  const requiredCores = task.minCores;

  if (ordered.length < requiredCores) return [];
  if (requiredCores > 1 && !state.flags.scheduler) return [];

  const wantedCores = Math.min(
    task.maxCores ?? requiredCores,
    task.parallelizable && state.flags.scheduler ? ordered.length : requiredCores,
  );

  return ordered.slice(0, Math.max(requiredCores, wantedCores));
};

const canReserveMemory = (
  state: GameState,
  operation: ActiveCoreOperation,
  neededBits: number,
) => {
  const reservedWithoutOperation =
    getReservedMemoryBits(state) - operation.memoryReservedBits;

  return reservedWithoutOperation + neededBits <= getMemoryCapacityBits(state);
};

const idleCoreOperation = (
  coreId: number,
  operationIndex: number,
): ActiveCoreOperation => ({
  coreId,
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
  reruns: 0,
  restarts: 0,
  corruptions: 0,
});

const enterOperation = (
  state: GameState,
  task: ActiveTask,
  coreOperation: ActiveCoreOperation,
  operationIndex: number,
  statusOverride?: "rerunning",
): ActiveCoreOperation => {
  const operation = getOperation(task, operationIndex);

  if (!operation) {
    return {
      ...coreOperation,
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
    };
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
    };
  }

  const operationRamBits = operation.ramBits;
  const operationRamBytes = operation.ramBytes;

  if (!canReserveMemory(state, coreOperation, operationRamBits)) {
    return {
      ...coreOperation,
      operationIndex,
      operationId: operation.id,
      operationName: operation.name,
      status: "waitingMemory",
      memoryState: "waiting",
      remainingCycles: operation.cycles,
      totalCycles: operation.cycles,
      remainingLoadCycles: 0,
      totalLoadCycles: 0,
      memoryReservedBits: 0,
      memoryReservedBytes: 0,
    };
  }

  if (statusOverride === "rerunning") {
    return {
      ...coreOperation,
      operationIndex,
      operationId: operation.id,
      operationName: operation.name,
      status: "rerunning",
      memoryState: "rerun",
      remainingCycles: operation.cycles,
      totalCycles: operation.cycles,
      remainingLoadCycles: 0,
      totalLoadCycles: 0,
      memoryReservedBits: operationRamBits,
      memoryReservedBytes: operationRamBytes,
      reruns: coreOperation.reruns + 1,
    };
  }

  const cacheLoadCycles = getCacheLoadCycles(state, operation);
  const ramLoadCycles = getRamLoadCycles(state, operation);
  const totalLoadCycles = cacheLoadCycles + ramLoadCycles;

  if (cacheLoadCycles > 0) {
    return {
      ...coreOperation,
      operationIndex,
      operationId: operation.id,
      operationName: operation.name,
      status: "loadingCache",
      memoryState: "cacheLoad",
      remainingCycles: operation.cycles,
      totalCycles: operation.cycles,
      remainingLoadCycles: cacheLoadCycles,
      totalLoadCycles,
      memoryReservedBits: operationRamBits,
      memoryReservedBytes: operationRamBytes,
    };
  }

  if (ramLoadCycles > 0) {
    return {
      ...coreOperation,
      operationIndex,
      operationId: operation.id,
      operationName: operation.name,
      status: "loadingRam",
      memoryState: "ramLoad",
      remainingCycles: operation.cycles,
      totalCycles: operation.cycles,
      remainingLoadCycles: ramLoadCycles,
      totalLoadCycles,
      memoryReservedBits: operationRamBits,
      memoryReservedBytes: operationRamBytes,
    };
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
  };
};

const createActiveTask = (
  state: GameState,
  taskId: TaskId,
  assignedCoreIds: number[],
): [GameState, ActiveTask] => {
  const taskDefinition = getTaskDefinition(taskId);
  const instanceId = `task-${state.nextInstanceId}`;
  const primaryCoreId = assignedCoreIds[0] ?? 1;
  const shell: ActiveTask = {
    instanceId,
    taskId,
    jobId: taskId,
    coreId: primaryCoreId,
    assignedCoreIds,
    coreOperations: [],
    remainingCycles: taskDefinition.requiredCycles,
    totalCycles: taskDefinition.requiredCycles,
    restarts: 0,
    reruns: 0,
    corruptions: 0,
  };
  let reservedBits = getReservedMemoryBits(state);
  const capacityBits = getMemoryCapacityBits(state);
  const coreOperations = assignedCoreIds.map((coreId) => {
    const seeded = idleCoreOperation(coreId, 0);
    const operation = taskDefinition.operations[0];
    if (operation && operation.ramBits + reservedBits > capacityBits) {
      const waitingOperation: ActiveCoreOperation = {
        ...seeded,
        operationId: operation.id,
        operationName: operation.name,
        status: "waitingMemory",
        memoryState: "waiting",
        remainingCycles: operation.cycles,
        totalCycles: operation.cycles,
      };
      return waitingOperation;
    }

    const entered = enterOperation(state, shell, seeded, 0);
    reservedBits += entered.memoryReservedBits;
    return entered;
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
): GameState => {
  if (!canStartTask(state, taskId)) return state;

  const task = getTaskDefinition(taskId);
  const assignedCoreIds = selectCoreIdsForTask(state, task, preferredCoreId);
  if (assignedCoreIds.length === 0) return state;

  const [nextState, activeTask] = createActiveTask(state, taskId, assignedCoreIds);

  return syncCoreSchedulers({
    ...nextState,
    activeTasks: [...nextState.activeTasks, activeTask],
    activeJobs: [...nextState.activeTasks, activeTask],
  });
};

const assignTaskToIdleCores = (state: GameState, taskId: TaskId): GameState =>
  assignTaskToCores(state, taskId);

const selectQueueCoreId = (state: GameState) => {
  const schedulers = Object.values(state.coreSchedulers);
  if (schedulers.length === 0) return 1;

  return schedulers.reduce((best, candidate) =>
    candidate.localQueue.length < best.localQueue.length ? candidate : best,
  ).coreId;
};

const enqueueTask = (state: GameState, taskId: TaskId) => {
  if (!canQueueTask(state, taskId)) return state;

  const coreId = selectQueueCoreId(state);
  const scheduler = state.coreSchedulers[coreId];

  return syncCoreSchedulers({
    ...state,
    queue: [...state.queue, taskId],
    coreSchedulers: {
      ...state.coreSchedulers,
      [coreId]: {
        ...scheduler,
        localQueue: [...(scheduler?.localQueue ?? []), taskId],
      },
    },
  });
};

const removeQueuedTaskFromLocalScheduler = (
  state: GameState,
  taskId: TaskId,
): GameState => {
  const entry = Object.entries(state.coreSchedulers).find(([, scheduler]) =>
    scheduler.localQueue.includes(taskId),
  );

  if (!entry) return state;

  const [rawCoreId, scheduler] = entry;
  let removed = false;
  const nextLocalQueue = scheduler.localQueue.filter((queuedTaskId) => {
    if (!removed && queuedTaskId === taskId) {
      removed = true;
      return false;
    }
    return true;
  });

  return {
    ...state,
    coreSchedulers: {
      ...state.coreSchedulers,
      [Number(rawCoreId)]: {
        ...scheduler,
        localQueue: nextLocalQueue,
      },
    },
  };
};

const pullQueue = (state: GameState): GameState => {
  if (!state.flags.basicQueue && !state.flags.scheduler) return syncCoreSchedulers(state);

  let nextState = state;
  const nextQueue = [...state.queue];
  let shifted = true;

  while (nextQueue.length > 0 && shifted) {
    shifted = false;
    const taskId = nextQueue[0];
    if (!taskId) break;

    const task = getTaskDefinition(taskId);
    if (availableCoreIds(nextState).length < task.minCores) break;

    const attemptState = { ...nextState, queue: nextQueue };
    const started = assignTaskToIdleCores(attemptState, taskId);
    if (started === attemptState) break;

    nextQueue.shift();
    nextState = removeQueuedTaskFromLocalScheduler(
      {
        ...started,
        queue: nextQueue,
      },
      taskId,
    );
    shifted = true;
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

  return updateProgressionFlags({
    ...rewarded,
    completedTasks: {
      ...rewarded.completedTasks,
      [task.id]: completedAmount + 1,
    },
    completedJobs: {
      ...rewarded.completedJobs,
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

const tickLoad = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
  deltaSeconds: number,
): ActiveCoreOperation => {
  const operationDefinition = getOperation(task, operation.operationIndex);
  if (!operationDefinition) return operation;

  const loadRate =
    operation.status === "loadingCache"
      ? getCacheLoadRate(state, operation.coreId)
      : getRamLoadRate(state);
  const remainingLoadCycles = Math.max(
    0,
    operation.remainingLoadCycles - loadRate * deltaSeconds,
  );
  const cpuCyclesDone =
    operation.status === "loadingCache" && operationDefinition.memoryAction
      ? getCoreClockHz(state, operation.coreId) * deltaSeconds
      : 0;
  const remainingCycles = Math.max(0, operation.remainingCycles - cpuCyclesDone);

  const waitsForCpuIssue =
    operation.status === "loadingCache" && Boolean(operationDefinition.memoryAction);

  if (remainingLoadCycles > 0 || (waitsForCpuIssue && remainingCycles > 0)) {
    return {
      ...operation,
      remainingLoadCycles,
      remainingCycles,
    };
  }

  if (operation.status === "loadingCache") {
    const ramLoadCycles = getRamLoadCycles(state, operationDefinition);
    if (ramLoadCycles > 0) {
      return {
        ...operation,
        status: "loadingRam",
        memoryState: "ramLoad",
        remainingCycles,
        remainingLoadCycles: ramLoadCycles,
      };
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
        remainingCycles: 0,
        remainingLoadCycles: 0,
        memoryReservedBits: 0,
        memoryReservedBytes: 0,
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
      memoryReservedBits: 0,
      memoryReservedBytes: 0,
    },
    operation.operationIndex + 1,
  );
};

const tickRestart = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
  deltaSeconds: number,
): ActiveCoreOperation => {
  const remainingLoadCycles = operation.remainingLoadCycles - 36 * deltaSeconds;

  if (remainingLoadCycles > 0) {
    return {
      ...operation,
      remainingLoadCycles,
    };
  }

  return enterOperation(state, task, operation, operation.operationIndex);
};

const tickWaitingMemory = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
): ActiveCoreOperation =>
  enterOperation(state, task, operation, operation.operationIndex);

const tickActiveTask = (
  state: GameState,
  activeTask: ActiveTask,
  deltaSeconds: number,
): ActiveTask => {
  const coreOperations: ActiveCoreOperation[] = activeTask.coreOperations.map((operation) => {
    if (operation.status === "loadingCache" || operation.status === "loadingRam") {
      return tickLoad(state, activeTask, operation, deltaSeconds);
    }

    if (operation.status === "running" || operation.status === "rerunning") {
      return tickRunning(state, activeTask, operation, deltaSeconds);
    }

    if (operation.status === "restarting") {
      return tickRestart(state, activeTask, operation, deltaSeconds);
    }

    if (operation.status === "waitingMemory") {
      return tickWaitingMemory(state, activeTask, operation);
    }

    return operation;
  });

  return refreshTaskTotals({
    ...activeTask,
    coreOperations,
  });
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

const corruptBarrierShard = (
  state: GameState,
  task: ActiveTask,
  barrierIndex: number,
): [GameState, ActiveTask] => {
  const previousIndex = barrierIndex - 1;
  const previousOperation = getOperation(task, previousIndex);
  if (
    !previousOperation?.parallel ||
    !state.flags.multiCore ||
    state.reliability.corruptionDebt < 1
  ) {
    return [state, task];
  }

  const targetCoreId = Math.max(...task.assignedCoreIds);
  const target = task.coreOperations.find(
    (operation) => operation.coreId === targetCoreId,
  );
  if (!target) return [state, task];

  const nextTarget = enterOperation(
    state,
    task,
    {
      ...target,
      corruptions: target.corruptions + 1,
    },
    previousIndex,
    "rerunning",
  );
  const nextTask = refreshTaskTotals({
    ...task,
    coreOperations: task.coreOperations.map((operation) =>
      operation.coreId === targetCoreId ? nextTarget : operation,
    ),
  });

  return [
    {
      ...state,
      reliability: {
        ...state.reliability,
        corruptionDebt: Math.max(0, state.reliability.corruptionDebt - 1),
        totalCorruptions: state.reliability.totalCorruptions + 1,
        lastEvent: {
          tick: state.tick,
          kind: "corruption",
          coreId: targetCoreId,
          taskId: task.taskId,
        },
      },
    },
    nextTask,
  ];
};

const settleTaskBarriers = (
  state: GameState,
  activeTask: ActiveTask,
): [GameState, ActiveTask] => {
  let nextState = state;
  let nextTask = activeTask;
  let changed = true;
  let guard = 0;

  while (changed && guard < 20) {
    changed = false;
    guard += 1;

    const barrierIndex = nextTask.coreOperations.find((operation) => {
      const definition = getTaskDefinition(nextTask.taskId).operations[
        operation.operationIndex
      ];
      return (
        definition?.kind === "barrier" &&
        operation.status === "waitingBarrier" &&
        shouldReleaseWaitingOperation(nextTask, operation)
      );
    })?.operationIndex;

    if (barrierIndex !== undefined) {
      const [corruptionState, corruptionTask] = corruptBarrierShard(
        nextState,
        nextTask,
        barrierIndex,
      );
      if (corruptionTask !== nextTask) {
        nextState = corruptionState;
        nextTask = corruptionTask;
        changed = true;
        continue;
      }
    }

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

    const complete = settledTask.coreOperations.every(
      (operation) => operation.status === "complete",
    );

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

const findRestartTarget = (state: GameState) => {
  const candidates = state.activeTasks.flatMap((task) =>
    task.coreOperations
      .filter((operation) =>
        [
          "loadingCache",
          "loadingRam",
          "running",
          "rerunning",
        ].includes(operation.status),
      )
      .map((operation) => ({ task, operation })),
  );

  return candidates.sort((a, b) => a.operation.coreId - b.operation.coreId)[0];
};

const restartOperation = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
) => {
  const restartedOperation: ActiveCoreOperation = {
    ...operation,
    status: "restarting",
    memoryState: "restart",
    remainingCycles: operation.totalCycles,
    remainingLoadCycles: 24,
    totalLoadCycles: Math.max(operation.totalLoadCycles, 24),
    memoryReservedBits: 0,
    memoryReservedBytes: 0,
    restarts: operation.restarts + 1,
  };
  const nextTask = refreshTaskTotals({
    ...task,
    coreOperations: task.coreOperations.map((coreOperation) =>
      coreOperation.coreId === operation.coreId
        ? restartedOperation
        : coreOperation,
    ),
  });

  return {
    ...state,
    activeTasks: state.activeTasks.map((activeTask) =>
      activeTask.instanceId === task.instanceId ? nextTask : activeTask,
    ),
    activeJobs: state.activeTasks.map((activeTask) =>
      activeTask.instanceId === task.instanceId ? nextTask : activeTask,
    ),
    reliability: {
      ...state.reliability,
      totalRestarts: state.reliability.totalRestarts + 1,
      lastEvent: {
        tick: state.tick,
        kind: "restart" as const,
        coreId: operation.coreId,
        taskId: task.taskId,
      },
    },
  };
};

const applyReliability = (state: GameState, deltaSeconds: number) => {
  if (state.activeTasks.length === 0) return state;

  let nextState: GameState = {
    ...state,
    reliability: {
      ...state.reliability,
      restartDebt: Math.min(
        3,
        state.reliability.restartDebt +
          getRestartRiskPerSecond(state) * deltaSeconds,
      ),
      corruptionDebt: Math.min(
        3,
        state.reliability.corruptionDebt +
          getCorruptionRiskPerSecond(state) * deltaSeconds,
      ),
    },
  };

  while (nextState.reliability.restartDebt >= 1) {
    const target = findRestartTarget(nextState);
    if (!target) break;

    nextState = restartOperation(nextState, target.task, target.operation);
    nextState = {
      ...nextState,
      reliability: {
        ...nextState.reliability,
        restartDebt: Math.max(0, nextState.reliability.restartDebt - 1),
      },
    };
  }

  return syncCoreSchedulers(nextState);
};

const tickActiveTasks = (state: GameState, deltaSeconds: number): GameState => {
  const activeTasks = state.activeTasks.map((activeTask) =>
    tickActiveTask(state, activeTask, deltaSeconds),
  );

  return syncCoreSchedulers({
    ...state,
    activeTasks,
    activeJobs: activeTasks,
  });
};

export const tickGame = (state: GameState, deltaMs: number): GameState => {
  const deltaSeconds = Math.max(0, Math.min(deltaMs / 1000, 2));
  const ticked = {
    ...syncCoreSchedulers(updateProgressionFlags(state)),
    tick: state.tick + deltaSeconds,
    cacheResidency: [],
  };
  const advanced = tickActiveTasks(ticked, deltaSeconds);
  const reliable = applyReliability(advanced, deltaSeconds);
  const settled = settleActiveTasks(reliable);

  return pullQueue(updateProgressionFlags(settled));
};

export const startTask = (state: GameState, taskId: TaskId) => {
  const started = assignTaskToIdleCores(state, taskId);

  if (started !== state) return started;

  return enqueueTask(state, taskId);
};

export const startTaskOnCore = (
  state: GameState,
  taskId: TaskId,
  coreId: number,
) => {
  if (coreId < 1 || coreId > state.hardware.cores) return state;

  return assignTaskToCores(state, taskId, coreId);
};

export const queueTask = (state: GameState, taskId: TaskId) =>
  enqueueTask(state, taskId);

export const buyResearch = (state: GameState, researchId: ResearchId) => {
  const research = getResearchDefinition(researchId);
  const costs = research.cost(state);

  if (
    state.research.completed.includes(researchId) ||
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

  return pullQueue(updateProgressionFlags(bought));
};

export const buyUpgrade = (
  state: GameState,
  upgradeId: UpgradeId,
  coreId?: number,
) => {
  const upgrade = getUpgradeDefinition(upgradeId);
  const context = { coreId };
  const costs = upgrade.cost(state, context);

  if (!upgrade.requirement(state) || !canAfford(state, costs)) {
    return state;
  }

  const bought = upgrade.buy(spend(state, costs), context);
  return pullQueue(updateProgressionFlags(bought));
};

export const startJob = startTask;

export const startJobOnCore = startTaskOnCore;

export const queueJob = queueTask;

export const applyAction = (state: GameState, action: GameAction): GameState => {
  if (action.type === "startTask") return startTask(state, action.taskId);
  if (action.type === "startTaskOnCore") {
    return startTaskOnCore(state, action.taskId, action.coreId);
  }
  if (action.type === "queueTask") return queueTask(state, action.taskId);
  if (action.type === "buyResearch") return buyResearch(state, action.researchId);
  if (action.type === "buyUpgrade") {
    return buyUpgrade(state, action.upgradeId, action.coreId);
  }
  if (action.type === "startJob") return startTask(state, action.jobId);
  if (action.type === "startJobOnCore") {
    return startTaskOnCore(state, action.jobId, action.coreId);
  }
  if (action.type === "queueJob") return queueTask(state, action.jobId);
  if (action.type === "setAutoRepeat") {
    return {
      ...state,
      autoRepeatJobId: action.jobId,
    };
  }

  return state;
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
      !state.research.completed.includes(research.id) &&
      research.reveal(state) &&
      research.requirement(state),
  );

export const getAvailableUpgrades = (state: GameState) =>
  upgradeDefinitions.filter((upgrade) => upgrade.requirement(state));

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
