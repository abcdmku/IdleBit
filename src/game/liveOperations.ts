import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountDivide,
  amountMax,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  exactResourceBag,
  type Amount,
} from "./amount";
import {
  advanceCapacityWork,
  createCapacityWorkRuntime,
  getNextCapacityWorkEventMs,
  normalizeCapacityWorkRuntime,
  type CapacityWorkRuntime,
} from "./capacityWork";
import { getTaskDefinition } from "./content/tasks";
import { addExactRewards } from "./economy";
import {
  getEffectiveCoreClockHz,
  getHardwareDrawWattsExact,
  getPowerCostPerSecondExact,
  getPsuStress,
} from "./math";
import { getAllCoreIds } from "./progression";
import { materializeSystem } from "./systems";
import { createRateVector } from "./weightedFair";
import {
  createWorkValueMultiplier,
  getWorkValueCredits,
} from "./workValue";
import type {
  AdvanceMode,
  GameAction,
  GameState,
  LiveOperationsState,
  LiveOperationsTaskId,
  VisibleLiveOperations,
} from "./types";

export const LIVE_OPERATIONS_TASK_IDS = [
  "liveQueueTriage",
  "liveCanaryValidation",
] as const satisfies readonly LiveOperationsTaskId[];

export const LIVE_OPERATIONS_MAX_CORES = 6;
export const LIVE_OPERATIONS_AUTHORED_COMPUTE_WORK: Readonly<
  Record<LiveOperationsTaskId, Amount>
> = {
  liveQueueTriage: amount(900),
  liveCanaryValidation: amount(900),
};
export const LIVE_OPERATIONS_SERVICE_VALUE_MULTIPLIER =
  createWorkValueMultiplier("attended-live-operations", 24_000);
export const LIVE_OPERATIONS_MAX_PSU_STRESS = 0.85;
export const LIVE_OPERATIONS_OFFLINE_BEHAVIOR =
  "Live Operations only runs while the game is visible.";

const liveTaskIdSet = new Set<LiveOperationsTaskId>(LIVE_OPERATIONS_TASK_IDS);

export const isLiveOperationsTaskId = (
  value: unknown,
): value is LiveOperationsTaskId =>
  typeof value === "string" &&
  liveTaskIdSet.has(value as LiveOperationsTaskId);

export const getNextLiveOperationsTaskId = (
  taskId: LiveOperationsTaskId,
): LiveOperationsTaskId =>
  taskId === "liveQueueTriage"
    ? "liveCanaryValidation"
    : "liveQueueTriage";

export const createLiveOperationsState = (): LiveOperationsState => ({
  systemId: null,
  maxCoreCount: 1,
  enabled: false,
  activeTaskId: "liveQueueTriage",
  runtime: null,
  allocatedCoreIds: [],
  completions: {},
  rewardCreditsEarned: {},
  dataEarned: {},
  workCyclesCompleted: {},
});

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const clampInteger = (value: unknown, minimum: number, maximum: number) => {
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : minimum;
  return Math.max(minimum, Math.min(maximum, numeric));
};

const safeAmount = (value: unknown): Amount => {
  try {
    return amountClampMin(
      typeof value === "string" || typeof value === "number" ? value : 0,
    );
  } catch {
    return ZERO_AMOUNT;
  }
};

const normalizeCountMap = (
  value: unknown,
): LiveOperationsState["completions"] => {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    LIVE_OPERATIONS_TASK_IDS.flatMap((taskId) => {
      const count = record[taskId];
      return typeof count === "number" && Number.isFinite(count) && count > 0
        ? [[taskId, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(count))]]
        : [];
    }),
  );
};

const normalizeAmountMap = (
  value: unknown,
): Partial<Record<LiveOperationsTaskId, Amount>> => {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    LIVE_OPERATIONS_TASK_IDS.flatMap((taskId) => {
      const total = safeAmount(record[taskId]);
      return amountCompare(total, 0) > 0 ? [[taskId, total]] : [];
    }),
  );
};

const getConfiguredSystem = (state: GameState, systemId: number | null) =>
  systemId === null
    ? null
    : state.systems.find((system) => system.id === systemId) ?? null;

const withAllocation = (
  state: GameState,
  allocatedCoreIds: readonly number[],
): GameState => ({
  ...state,
  liveOperations: {
    ...(state.liveOperations ?? createLiveOperationsState()),
    allocatedCoreIds: [...allocatedCoreIds],
  },
});

const getLiveComputeRate = (
  state: GameState,
  coreIds: readonly number[],
): Amount => {
  const loaded = withAllocation(state, coreIds);
  return coreIds.reduce(
    (total, coreId) =>
      amountAdd(total, amount(getEffectiveCoreClockHz(loaded, coreId))),
    ZERO_AMOUNT,
  );
};

const createLiveRuntime = (
  taskId: LiveOperationsTaskId,
): CapacityWorkRuntime => {
  const work = LIVE_OPERATIONS_AUTHORED_COMPUTE_WORK[taskId];
  return createCapacityWorkRuntime({
    id: taskId,
    work: createRateVector({ compute: work }),
    memoryBits: ZERO_AMOUNT,
    storageBits: ZERO_AMOUNT,
    reward: exactResourceBag(
      getWorkValueCredits(
        work,
        LIVE_OPERATIONS_SERVICE_VALUE_MULTIPLIER,
      ),
      ZERO_AMOUNT,
    ),
  });
};

const normalizeSavedRuntime = (
  value: unknown,
  taskId: LiveOperationsTaskId,
  canonicalizePlan: boolean,
): CapacityWorkRuntime => {
  const canonical = createLiveRuntime(taskId);
  const record = asRecord(value);
  if (!record) return canonical;
  try {
    const saved = normalizeCapacityWorkRuntime(
      value as CapacityWorkRuntime,
    );
    if (
      saved.plan.id !== taskId ||
      saved.rewardIssued ||
      saved.completed
    ) {
      return canonical;
    }
    return canonicalizePlan
      ? normalizeCapacityWorkRuntime({ ...saved, plan: canonical.plan })
      : saved;
  } catch {
    return canonical;
  }
};

/**
 * Repairs the lane against the current system topology. Transient allocation
 * is deliberately cleared at public/save boundaries and recalculated by the
 * foreground scheduler.
 */
export const normalizeLiveOperationsState = (
  state: GameState,
  value: unknown = state.liveOperations,
  canonicalizePlan = false,
): LiveOperationsState => {
  const fallback = createLiveOperationsState();
  const record = asRecord(value);
  if (!record) return fallback;
  const requestedSystemId =
    typeof record.systemId === "number" && Number.isFinite(record.systemId)
      ? Math.trunc(record.systemId)
      : null;
  const system = getConfiguredSystem(state, requestedSystemId);
  if (!system) return fallback;
  const local = materializeSystem(state, system.id);
  const maximumCoreCount = Math.max(
    1,
    Math.min(LIVE_OPERATIONS_MAX_CORES, getAllCoreIds(local).length),
  );
  const maxCoreCount = clampInteger(
    record.maxCoreCount,
    1,
    maximumCoreCount,
  );
  const activeTaskId = isLiveOperationsTaskId(record.activeTaskId)
    ? record.activeTaskId
    : fallback.activeTaskId;
  return {
    systemId: system.id,
    maxCoreCount,
    enabled: record.enabled === true,
    activeTaskId,
    runtime: normalizeSavedRuntime(
      record.runtime,
      activeTaskId,
      canonicalizePlan,
    ),
    allocatedCoreIds: [],
    completions: normalizeCountMap(record.completions),
    rewardCreditsEarned: normalizeAmountMap(record.rewardCreditsEarned),
    dataEarned: normalizeAmountMap(record.dataEarned),
    workCyclesCompleted: normalizeAmountMap(record.workCyclesCompleted),
  };
};

export const normalizeLiveOperationsForGameState = (
  state: GameState,
): GameState => ({
  ...state,
  liveOperations: normalizeLiveOperationsState(state),
});

const hasSystemSchedulerResearch = (state: GameState) =>
  state.research.completed.includes("systemScheduler");

const hasManagedReservation = (state: GameState, systemId: number) =>
  state.contracts.active.some((contract) => contract.systemId === systemId) ||
  Object.values(state.projects.progress).some(
    (progress) =>
      progress?.active &&
      !progress.completed &&
      progress.systemId === systemId,
  );

const getNormalBusyCoreIds = (state: GameState) =>
  new Set(state.activeTasks.flatMap((task) => task.assignedCoreIds));

interface LiveProjection {
  runtime: CapacityWorkRuntime | null;
  candidateCoreIds: number[];
  allocatedCoreIds: number[];
  rates: ReturnType<typeof createRateVector>;
  durationMs: Amount | null;
  totalPowerWatts: Amount;
  operatingCostCredits: Amount;
  rewardCredits: Amount;
  netRewardCredits: Amount;
  marginBps: number | null;
  blockedReason: string | null;
}

const emptyProjection = (
  runtime: CapacityWorkRuntime | null,
  blockedReason: string,
): LiveProjection => ({
  runtime,
  candidateCoreIds: [],
  allocatedCoreIds: [],
  rates: createRateVector(),
  durationMs: null,
  totalPowerWatts: ZERO_AMOUNT,
  operatingCostCredits: ZERO_AMOUNT,
  rewardCredits: runtime?.plan.reward.credits ?? ZERO_AMOUNT,
  netRewardCredits: runtime?.plan.reward.credits ?? ZERO_AMOUNT,
  marginBps:
    runtime && amountCompare(runtime.plan.reward.credits, 0) > 0 ? 10_000 : null,
  blockedReason,
});

const projectLiveOperations = (
  inputState: GameState,
  mode: AdvanceMode,
): LiveProjection => {
  const lane = inputState.liveOperations;
  const unlocked = hasSystemSchedulerResearch(inputState);
  if (!unlocked) {
    return emptyProjection(lane.runtime, "System Scheduler research is required.");
  }
  if (lane.systemId === null) {
    return emptyProjection(lane.runtime, "Configure Live Operations on a system.");
  }
  const system = getConfiguredSystem(inputState, lane.systemId);
  if (!system) {
    return emptyProjection(lane.runtime, "The configured system is unavailable.");
  }
  const local = materializeSystem(inputState, system.id);
  const runtime =
    lane.runtime ?? createLiveRuntime(lane.activeTaskId);
  if (!lane.enabled) return emptyProjection(runtime, "Live Operations is paused.");
  if (mode === "offline") {
    return emptyProjection(runtime, LIVE_OPERATIONS_OFFLINE_BEHAVIOR);
  }
  if (hasManagedReservation(inputState, system.id)) {
    return emptyProjection(
      runtime,
      "A managed contract or project reserves this system.",
    );
  }
  if (local.power.state !== "on") {
    return emptyProjection(runtime, "The configured system must be powered on.");
  }
  if (
    local.activeTasks.length === 0 &&
    ((local.queueEntries?.length ?? 0) > 0 || local.queue.length > 0)
  ) {
    return emptyProjection(runtime, "Queued work has priority over Live Operations.");
  }

  const busyCoreIds = getNormalBusyCoreIds(local);
  const idleCoreIds = getAllCoreIds(local)
    .filter((coreId) => !busyCoreIds.has(coreId))
    .sort((left, right) => left - right)
    .slice(0, lane.maxCoreCount);
  if (idleCoreIds.length === 0) {
    return emptyProjection(runtime, "Waiting for an idle core.");
  }

  const candidateCoreIds: number[] = [];
  for (const coreId of idleCoreIds) {
    const candidate = [...candidateCoreIds, coreId];
    if (
      getPsuStress(
        withAllocation(
          {
            ...local,
            liveOperations: { ...lane, runtime },
          },
          candidate,
        ),
      ) <= LIVE_OPERATIONS_MAX_PSU_STRESS
    ) {
      candidateCoreIds.push(coreId);
    }
  }
  if (candidateCoreIds.length === 0) {
    return emptyProjection(
      runtime,
      "No idle core fits the 85% PSU safety limit.",
    );
  }

  const projectedState = withAllocation(
    {
      ...local,
      liveOperations: { ...lane, runtime },
    },
    candidateCoreIds,
  );
  const rates = createRateVector({
    compute: getLiveComputeRate(projectedState, candidateCoreIds),
  });
  const durationMs = getNextCapacityWorkEventMs(
    runtime,
    rates,
    { memoryBits: ZERO_AMOUNT, storageBits: ZERO_AMOUNT },
  );
  if (durationMs === null || amountCompare(rates.compute, 0) <= 0) {
    return emptyProjection(runtime, "The selected idle cores have no compute rate.");
  }
  const totalPowerWatts = getHardwareDrawWattsExact(projectedState);
  const operatingCostCredits = amountMultiply(
    getPowerCostPerSecondExact(projectedState),
    amountDivide(durationMs, 1000),
  );
  const rewardCredits = runtime.plan.reward.credits;
  const netRewardCredits = amountSubtract(rewardCredits, operatingCostCredits);
  const marginBps =
    amountCompare(rewardCredits, 0) > 0
      ? Math.trunc(
          amountToSafeNumber(
            amountMultiply(amountDivide(netRewardCredits, rewardCredits), 10_000),
          ),
        )
      : null;
  const hasRunway =
    amountCompare(inputState.exactResources.credits, operatingCostCredits) >= 0;
  return {
    runtime,
    candidateCoreIds,
    allocatedCoreIds: hasRunway ? candidateCoreIds : [],
    rates,
    durationMs,
    totalPowerWatts,
    operatingCostCredits,
    rewardCredits,
    netRewardCredits,
    marginBps,
    blockedReason: hasRunway
      ? null
      : "Insufficient Credits for the remaining operating cost.",
  };
};

/** Recomputes the transient foreground allocation after ordinary scheduling. */
export const syncLiveOperationsAllocation = (
  inputState: GameState,
  mode: AdvanceMode,
): GameState => {
  let state = normalizeLiveOperationsForGameState(inputState);
  const lane = state.liveOperations;
  if (lane.systemId !== null && lane.runtime === null) {
    state = {
      ...state,
      liveOperations: {
        ...lane,
        runtime: createLiveRuntime(lane.activeTaskId),
      },
    };
  }
  const projection = projectLiveOperations(state, mode);
  return {
    ...state,
    liveOperations: {
      ...state.liveOperations,
      runtime: projection.runtime,
      allocatedCoreIds: projection.allocatedCoreIds,
    },
  };
};

export const hasRunnableLiveOperations = (
  state: GameState,
  mode: AdvanceMode,
) =>
  mode === "foreground" &&
  projectLiveOperations(state, mode).allocatedCoreIds.length > 0;

export const getNextLiveOperationsEventMs = (
  state: GameState,
  maximumMs: number,
  mode: AdvanceMode,
) => {
  if (mode !== "foreground") return maximumMs;
  const duration = projectLiveOperations(state, mode).durationMs;
  return duration === null
    ? maximumMs
    : Math.max(0, Math.min(maximumMs, amountToSafeNumber(duration)));
};

const addMapAmount = (
  values: Partial<Record<LiveOperationsTaskId, Amount>>,
  taskId: LiveOperationsTaskId,
  delta: Amount,
) => ({
  ...values,
  [taskId]: amountAdd(values[taskId] ?? ZERO_AMOUNT, delta),
});

/** Advances and atomically rewards one or more foreground event-bounded batches. */
export const advanceLiveOperations = (
  inputState: GameState,
  deltaMs: number,
  mode: AdvanceMode,
): GameState => {
  let state = inputState;
  if (mode !== "foreground" || deltaMs <= 0) {
    return mode === "offline"
      ? {
          ...state,
          liveOperations: { ...state.liveOperations, allocatedCoreIds: [] },
        }
      : state;
  }
  let remainingMs = amount(deltaMs);
  let events = 0;
  while (amountCompare(remainingMs, 0) > 0 && events < 1024) {
    const projection = projectLiveOperations(state, mode);
    const lane = state.liveOperations;
    if (
      !projection.runtime ||
      projection.allocatedCoreIds.length === 0 ||
      projection.blockedReason
    ) {
      break;
    }
    const advanced = advanceCapacityWork(
      projection.runtime,
      projection.rates,
      { memoryBits: ZERO_AMOUNT, storageBits: ZERO_AMOUNT },
      remainingMs,
    );
    state = {
      ...state,
      liveOperations: { ...lane, runtime: advanced.runtime },
    };
    remainingMs = amountSubtract(remainingMs, advanced.advancedMs);
    if (!advanced.completed) break;

    const taskId = lane.activeTaskId;
    const reward = advanced.reward;
    const rewarded = addExactRewards(state, reward);
    const nextTaskId = getNextLiveOperationsTaskId(taskId);
    const completedLane: LiveOperationsState = {
      ...rewarded.liveOperations,
      activeTaskId: nextTaskId,
      completions: {
        ...rewarded.liveOperations.completions,
        [taskId]: (rewarded.liveOperations.completions[taskId] ?? 0) + 1,
      },
      rewardCreditsEarned: addMapAmount(
        rewarded.liveOperations.rewardCreditsEarned,
        taskId,
        reward.credits,
      ),
      dataEarned: addMapAmount(
        rewarded.liveOperations.dataEarned,
        taskId,
        reward.data,
      ),
      workCyclesCompleted: addMapAmount(
        rewarded.liveOperations.workCyclesCompleted,
        taskId,
        projection.runtime.plan.work.compute,
      ),
      runtime: null,
    };
    const withNextTask = { ...rewarded, liveOperations: completedLane };
    state = {
      ...withNextTask,
      liveOperations: {
        ...completedLane,
        runtime: createLiveRuntime(nextTaskId),
      },
    };
    events += 1;
    if (amountCompare(advanced.advancedMs, 0) <= 0) break;
  }
  return state;
};

export const applyLiveOperationsAction = (
  inputState: GameState,
  action: Extract<
    GameAction,
    { type: "configureLiveOperations" | "setLiveOperationsEnabled" }
  >,
): GameState => {
  const state = normalizeLiveOperationsForGameState(inputState);
  if (!hasSystemSchedulerResearch(state)) return state;
  if (action.type === "setLiveOperationsEnabled") {
    if (state.liveOperations.systemId === null) return state;
    if (typeof action.enabled !== "boolean") return state;
    return syncLiveOperationsAllocation(
      {
        ...state,
        liveOperations: { ...state.liveOperations, enabled: action.enabled },
      },
      "foreground",
    );
  }
  if (
    typeof action.systemId !== "number" ||
    !Number.isFinite(action.systemId) ||
    typeof action.maxCoreCount !== "number" ||
    !Number.isFinite(action.maxCoreCount)
  ) {
    return state;
  }
  const systemId = Math.trunc(action.systemId);
  const system = getConfiguredSystem(state, systemId);
  if (!system) return state;
  const local = materializeSystem(state, systemId);
  const maximumCoreCount = Math.max(
    1,
    Math.min(LIVE_OPERATIONS_MAX_CORES, getAllCoreIds(local).length),
  );
  const maxCoreCount = clampInteger(
    action.maxCoreCount,
    1,
    maximumCoreCount,
  );
  const preserveRuntime =
    state.liveOperations.systemId === systemId &&
    state.liveOperations.maxCoreCount === maxCoreCount;
  const configured: GameState = {
    ...state,
    liveOperations: {
      ...state.liveOperations,
      systemId,
      maxCoreCount,
      runtime: preserveRuntime ? state.liveOperations.runtime : null,
      allocatedCoreIds: [],
    },
  };
  return syncLiveOperationsAllocation(configured, "foreground");
};

export const clearLiveOperationsForRemovedSystem = (
  state: GameState,
  systemId: number,
): GameState =>
  state.liveOperations.systemId === systemId &&
  !state.systems.some((system) => system.id === systemId)
    ? { ...state, liveOperations: createLiveOperationsState() }
    : state;

export const getVisibleLiveOperations = (
  inputState: GameState,
): VisibleLiveOperations => {
  const state = syncLiveOperationsAllocation(inputState, "foreground");
  const lane = state.liveOperations;
  const projection = projectLiveOperations(state, "foreground");
  const selectedSystem =
    getConfiguredSystem(state, lane.systemId) ??
    getConfiguredSystem(state, state.selectedSystemId);
  const maximumCoreCount = selectedSystem
    ? Math.max(
        1,
        Math.min(
          LIVE_OPERATIONS_MAX_CORES,
          selectedSystem.hardware.cores,
        ),
      )
    : 1;
  const runtime = projection.runtime;
  const totalWork = runtime?.plan.work.compute ?? ZERO_AMOUNT;
  const remainingWork = runtime?.remainingWork.compute ?? ZERO_AMOUNT;
  const progress =
    amountCompare(totalWork, 0) > 0
      ? Math.max(
          0,
          Math.min(
            1,
            1 - amountToSafeNumber(amountDivide(remainingWork, totalWork)),
          ),
        )
      : 0;
  const nextTaskId = getNextLiveOperationsTaskId(lane.activeTaskId);
  return {
    unlocked: hasSystemSchedulerResearch(state),
    enabled: lane.enabled,
    canConfigure:
      hasSystemSchedulerResearch(state) && state.systems.length > 0,
    systemId: lane.systemId,
    maxCoreCount: lane.maxCoreCount,
    maximumCoreCount,
    workMix: LIVE_OPERATIONS_TASK_IDS.map((taskId) => ({
      id: taskId,
      name: getTaskDefinition(taskId).name,
    })) as VisibleLiveOperations["workMix"],
    activeTaskId: lane.systemId === null ? null : lane.activeTaskId,
    activeTaskName:
      lane.systemId === null ? null : getTaskDefinition(lane.activeTaskId).name,
    nextTaskName: getTaskDefinition(nextTaskId).name,
    allocatedCoreCount: projection.allocatedCoreIds.length,
    progress,
    remainingMs:
      projection.durationMs === null
        ? null
        : amountToSafeNumber(projection.durationMs),
    projectedDurationMs:
      projection.durationMs === null
        ? null
        : amountToSafeNumber(projection.durationMs),
    projectedPowerWatts: projection.totalPowerWatts,
    projectedOperatingCostCredits: projection.operatingCostCredits,
    projectedRewardCredits: projection.rewardCredits,
    projectedNetRewardCredits: projection.netRewardCredits,
    projectedMarginBps: projection.marginBps,
    blockedReason: projection.blockedReason,
    offlineBehavior: LIVE_OPERATIONS_OFFLINE_BEHAVIOR,
  };
};

export const getLiveOperationsCompletionDelta = (
  before: GameState,
  after: GameState,
) =>
  LIVE_OPERATIONS_TASK_IDS.flatMap((taskId) => {
    const completionCount = Math.max(
      0,
      (after.liveOperations.completions[taskId] ?? 0) -
        (before.liveOperations.completions[taskId] ?? 0),
    );
    if (completionCount === 0) return [];
    return [
      {
        taskId,
        name: getTaskDefinition(taskId).name,
        completionCount,
        creditsEarned: amountMax(
          0,
          amountSubtract(
            after.liveOperations.rewardCreditsEarned[taskId] ?? ZERO_AMOUNT,
            before.liveOperations.rewardCreditsEarned[taskId] ?? ZERO_AMOUNT,
          ),
        ),
        dataEarned: amountMax(
          0,
          amountSubtract(
            after.liveOperations.dataEarned[taskId] ?? ZERO_AMOUNT,
            before.liveOperations.dataEarned[taskId] ?? ZERO_AMOUNT,
          ),
        ),
        workCycles: amountMax(
          0,
          amountSubtract(
            after.liveOperations.workCyclesCompleted[taskId] ?? ZERO_AMOUNT,
            before.liveOperations.workCyclesCompleted[taskId] ?? ZERO_AMOUNT,
          ),
        ),
      },
    ];
  });
