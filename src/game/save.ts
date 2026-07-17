import {
  amount,
  amountClampMin,
  amountCompare,
  amountMax,
  amountMin,
  amountToSafeNumber,
  exactResourceBag,
  sumAmounts,
  ZERO_AMOUNT,
  type Amount,
  type ExactResourceBag,
} from "./amount";
import {
  normalizeAutomationBufferState,
  normalizeStandingOrderState,
} from "./automation";
import { normalizeCampaignState, updateCampaignProgress } from "./campaign";
import {
  normalizeContractMarketState,
  pruneStaleContractOffers,
} from "./contracts";
import {
  BOOTLOADER_MAX_LEVEL,
  getBootloaderLevelFromHardware,
} from "./bootloader";
import {
  bitsToBytes,
  createCoreSchedulers,
  createCpuHardwareState,
  createInitialGameState,
  createRamSticksForLevel,
  createSchedulerConfig,
  getCacheBits,
  getCacheBytes,
  getCpuClockHz,
  getCoolingRating,
  POWER_BOOTSTRAP_GRACE_SECONDS,
  getPsuWatts,
  getRamBytes,
  getRamBits,
  getRamSpeedMt,
  syncCronSchedules,
  syncHardwarePackages,
  updateProgressionFlags,
} from "./progression";
import { getTaskDefinition, taskDefinitions } from "./content/tasks";
import { researchDefinitions } from "./content/research";
import { projectExactResources, syncExactResources } from "./economy";
import { normalizeRngState } from "./rng";
import { normalizeProjectsState } from "./projects";
import { normalizeCloudForGameState } from "./cloudGame";
import { normalizeLiveOperationsState } from "./liveOperations";
import { materializeSystem, syncSelectedSystemRuntime } from "./systems";
import { normalizeWorkshopSystemState } from "./workshop";
import { V1_HARDWARE_LIMITS, clampFiniteInteger } from "./hardwareLimits";
import {
  getStoredTaskRewardCredits,
  getStoredTaskWorkCycles,
  normalizeTaskBatchMultiplier,
} from "./taskBatches";
import { RAM_MAX_LEVEL } from "./content/ramTiers";
import type { AcceleratorKind } from "./content/accelerators";
import type {
  ActiveCoreOperation,
  ActiveTask,
  CronIntervalMode,
  GameFlags,
  GameState,
  MemoryRuntimeState,
  OperationRuntimeStatus,
  RamStickState,
  ResearchId,
  TaskId,
  TaskQueueEntry,
  WorkOrigin,
} from "./types";

export const SAVE_VERSION = 7 as const;

export interface SaveEnvelope {
  version: typeof SAVE_VERSION;
  savedAt: string;
  savedAtMs: number;
  departedAtMs: number | null;
  state: GameState;
}

/**
 * The sole compatibility boundary for pre-exact callers that still replace the
 * numeric projection directly before saving. Finite, non-negative overrides are
 * promoted to exact values here; saturated, invalid, and normal derived
 * projections leave the exact authority untouched.
 */
const applyLegacyResourceOverridesAtSerializationBoundary = (
  state: GameState,
): GameState => {
  const projected = projectExactResources(state.exactResources);
  const exactResources = { ...state.exactResources };
  for (const resource of ["credits", "data"] as const) {
    const candidate = state.resources[resource];
    if (
      Number.isFinite(candidate) &&
      candidate >= 0 &&
      Math.abs(projected[resource]) < Number.MAX_VALUE &&
      candidate !== projected[resource]
    ) {
      exactResources[resource] = amount(candidate);
    }
  }
  return syncExactResources({ ...state, exactResources });
};

export const createSaveEnvelope = (
  state: GameState,
  savedAtMs = Date.now(),
): SaveEnvelope => {
  const normalizedSavedAtMs = Math.max(
    0,
    Math.trunc(Number.isFinite(savedAtMs) ? savedAtMs : 0),
  );
  return {
    version: SAVE_VERSION,
    savedAt: new Date(normalizedSavedAtMs).toISOString(),
    savedAtMs: normalizedSavedAtMs,
    departedAtMs: state.time.departedAtMs,
    state: applyLegacyResourceOverridesAtSerializationBoundary(
      {
        ...syncSelectedSystemRuntime(state),
        liveOperations: {
          ...state.liveOperations,
          allocatedCoreIds: [],
        },
      },
    ),
  };
};

export const serializeSave = (state: GameState, savedAtMs?: number) =>
  JSON.stringify(createSaveEnvelope(state, savedAtMs));

type LegacyHardwareState = Partial<GameState["hardware"]> & {
  ramGb?: number;
};

type LegacyState = Omit<Partial<GameState>, "version"> & {
  version?: number;
  campaignChapter?: number;
  flags?: Partial<GameFlags>;
  hardware?: LegacyHardwareState;
  activeJobs?: unknown[];
};

const researchFromLegacyFlags = (flags: Partial<GameFlags> = {}) => {
  const completed: ResearchId[] = [];
  if (flags.cache) completed.push("cacheMapping");
  if (flags.benchmarks) completed.push("benchmarkHarness");
  if (flags.multiCore) completed.push("multiCore");
  if (flags.basicQueue) completed.push("localScheduler");
  if (flags.schedulerWatchdog) completed.push("schedulerWatchdog");
  if (flags.scheduler) completed.push("systemScheduler");
  if (flags.systemStats) completed.push("ramControl");
  if (flags.secondCpu) completed.push("systemBus");
  if (flags.cron) completed.push("cronScheduler");
  if (flags.bootloader) completed.push("bootloader");
  return completed;
};

const validResearchIds = new Set<ResearchId>(
  researchDefinitions
    .map((definition) => definition.id)
    .filter((id) => id !== "clickRateTuning"),
);

const validTaskIds = new Set<TaskId>(taskDefinitions.map((task) => task.id));

const isTaskId = (id: unknown): id is TaskId =>
  typeof id === "string" && validTaskIds.has(id as TaskId);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const toFiniteNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const toNonNegativeNumber = (value: unknown, fallback = 0) =>
  Math.max(0, toFiniteNumber(value, fallback));

const toPositiveIntegerOrNull = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const parsed = Math.trunc(value);
  return parsed >= 1 ? parsed : null;
};

const toNonNegativeAmount = (value: unknown) => {
  try {
    return amountClampMin(
      typeof value === "string" || typeof value === "number" ? value : 0,
    );
  } catch {
    return amount(0);
  }
};

const toInteger = (value: unknown, fallback = 0) =>
  Math.trunc(toFiniteNumber(value, fallback));

const toExactAmountOrNull = (value: unknown): Amount | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  try {
    return amountClampMin(value);
  } catch {
    return null;
  }
};

/**
 * Each exact resource falls back to its numeric projection independently, so
 * one corrupt entry never collapses a valid huge exact balance (e.g. 1e400
 * credits) down to the lossy Number.MAX_VALUE projection.
 */
const normalizeExactResources = (
  value: Partial<ExactResourceBag> | null | undefined,
  resources: GameState["resources"],
) =>
  exactResourceBag(
    toExactAmountOrNull(value?.credits) ?? amount(Math.max(0, resources.credits)),
    toExactAmountOrNull(value?.data) ?? amount(Math.max(0, resources.data)),
  );

const normalizeTaskIdList = (values: unknown): TaskId[] =>
  Array.isArray(values) ? values.filter(isTaskId) : [];

const normalizeAcceleratorKinds = (values: unknown): AcceleratorKind[] =>
  Array.isArray(values)
    ? Array.from(
        new Set(
          values.filter(
            (value): value is AcceleratorKind =>
              value === "gpu" || value === "npu",
          ),
        ),
      )
    : [];

const normalizeWorkOrigin = (value: unknown): WorkOrigin | undefined =>
  value === "standing-order" ? "standing-order" : undefined;

const normalizeTaskBatchSnapshot = (
  taskId: TaskId,
  parentTaskId: unknown,
  batchMultiplier: unknown,
  projectedRewardCredits: unknown,
  projectedWorkCycles: unknown,
) => {
  const task = getTaskDefinition(taskId);
  const batchOwner = isTaskId(parentTaskId)
    ? getTaskDefinition(parentTaskId)
    : task;
  const multiplier = normalizeTaskBatchMultiplier(
    batchMultiplier,
    batchOwner.aggregateBatch?.maximumMultiplier ?? 1,
  );
  try {
    return {
      batchMultiplier: multiplier,
      projectedRewardCredits:
        projectedRewardCredits === undefined
          ? getStoredTaskRewardCredits(task, undefined, multiplier)
          : amountClampMin(projectedRewardCredits as string | number),
      projectedWorkCycles:
        projectedWorkCycles === undefined
          ? getStoredTaskWorkCycles(task, undefined, multiplier)
          : amountClampMin(projectedWorkCycles as string | number),
    };
  } catch {
    return {
      batchMultiplier: multiplier,
      projectedRewardCredits: getStoredTaskRewardCredits(
        task,
        undefined,
        multiplier,
      ),
      projectedWorkCycles: getStoredTaskWorkCycles(
        task,
        undefined,
        multiplier,
      ),
    };
  }
};

const normalizeQueueEntries = (
  values: unknown,
  validParentEntryIds: ReadonlySet<string> | null = null,
): TaskQueueEntry[] =>
  Array.isArray(values)
    ? values
        .filter(isRecord)
        .filter(
          (value) =>
            typeof value.id === "string" &&
            isTaskId(value.taskId) &&
            (value.target === "cpu" || value.target === "system"),
        )
        // Children whose parent task was removed/renamed can never start or
        // settle (getTaskDefinition would throw); drop them outright.
        .filter(
          (value) => value.parentTaskId == null || isTaskId(value.parentTaskId),
        )
        // A set parent-entry reference must be a string, and — when the live
        // parent-entry id set is known — must resolve to a surviving entry.
        .filter(
          (value) =>
            value.parentQueueEntryId == null ||
            (typeof value.parentQueueEntryId === "string" &&
              (validParentEntryIds === null ||
                validParentEntryIds.has(value.parentQueueEntryId))),
        )
        .map((value) => {
          const taskId = value.taskId as TaskId;
          const batch = normalizeTaskBatchSnapshot(
            taskId,
            value.parentTaskId,
            value.batchMultiplier,
            value.projectedRewardCredits,
            value.projectedWorkCycles,
          );
          return {
            ...(value as unknown as TaskQueueEntry),
            ...batch,
            workOrigin: normalizeWorkOrigin(value.workOrigin),
            ...(value.childTaskId !== undefined
              ? {
                  childTaskId: isTaskId(value.childTaskId)
                    ? (value.childTaskId as TaskId)
                    : null,
                }
              : {}),
            acceleratorKindsUsed: normalizeAcceleratorKinds(
              value.acceleratorKindsUsed,
            ),
            completedChildKeys: Array.isArray(value.completedChildKeys)
              ? Array.from(
                  new Set(
                    value.completedChildKeys.filter(
                      (item): item is string => typeof item === "string",
                    ),
                  ),
                )
              : undefined,
          };
        })
    : [];

/**
 * Top-level queue entries referencing a parent entry that no longer exists in
 * the same queue can never dispatch or settle; drop them after normalization.
 */
const sanitizeQueueEntryParentLinks = (
  entries: TaskQueueEntry[],
): TaskQueueEntry[] => {
  const ids = new Set(entries.map((entry) => entry.id));
  return entries.filter(
    (entry) =>
      entry.parentQueueEntryId == null || ids.has(entry.parentQueueEntryId),
  );
};

const normalizeTaskCounts = (
  counts: unknown,
): Partial<Record<TaskId, number>> => {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return {};

  return Object.fromEntries(
    Object.entries(counts)
      .filter(([taskId, count]) => isTaskId(taskId) && toNonNegativeNumber(count) > 0)
      .map(([taskId, count]) => [taskId, toNonNegativeNumber(count)]),
  ) as Partial<Record<TaskId, number>>;
};

const normalizeTaskId = <T extends TaskId | null>(
  taskId: unknown,
  fallback: T,
): TaskId | T => (isTaskId(taskId) ? taskId : fallback);

const normalizeResearchCompleted = (
  completed: readonly unknown[] = [],
): ResearchId[] => {
  const normalized = completed
    .map((id) => (id === "kernelScheduler" ? "systemScheduler" : id))
    .filter((id): id is ResearchId => validResearchIds.has(id as ResearchId));

  return Array.from(new Set(normalized));
};

const isActiveTask = (value: unknown): value is ActiveTask => {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<ActiveTask>;
  return (
    typeof candidate.instanceId === "string" &&
    isTaskId(candidate.taskId) &&
    Array.isArray(candidate.assignedCoreIds) &&
    Array.isArray(candidate.coreOperations)
  );
};

const normalizeTaskAmountTotals = (
  values: unknown,
): Partial<Record<TaskId, Amount>> => {
  if (!values || typeof values !== "object" || Array.isArray(values)) return {};
  return Object.fromEntries(
    Object.entries(values as Record<string, unknown>).flatMap(([taskId, value]) => {
      if (!isTaskId(taskId)) return [];
      try {
        return [[taskId, amountClampMin(value as string | number)]];
      } catch {
        return [];
      }
    }),
  );
};

const normalizeOperationStatus = (status: unknown): OperationRuntimeStatus => {
  if (
    status === "loadingCache" ||
    status === "loadingRam" ||
    status === "running" ||
    status === "waitingMemory" ||
    status === "waitingBarrier" ||
    status === "deadlocked" ||
    status === "complete"
  ) {
    return status;
  }

  // Unknown statuses must never normalize to "complete": settleActiveTasks
  // would treat the operation as finished and mint the stored reward without
  // the remaining work. "running" keeps the remaining counters authoritative.
  return "running";
};

const normalizeMemoryState = (
  memoryState: unknown,
  status: OperationRuntimeStatus,
): MemoryRuntimeState => {
  if (status === "deadlocked") return "deadlock";
  if (memoryState === "rerun" || memoryState === "restart") return "ready";
  if (
    memoryState === "idle" ||
    memoryState === "cacheLoad" ||
    memoryState === "ramLoad" ||
    memoryState === "waiting" ||
    memoryState === "ready" ||
    memoryState === "deadlock"
  ) {
    return memoryState;
  }

  return status === "complete" ? "idle" : "ready";
};

const normalizeRamBlocks = (blocks: unknown) =>
  Array.isArray(blocks)
    ? blocks
        .filter(isRecord)
        .map((block, index) => {
          const lengthBits = toNonNegativeNumber(block.lengthBits);
          return {
            stickId: Math.max(1, toInteger(block.stickId, 1)),
            startBit: toNonNegativeNumber(block.startBit),
            lengthBits,
            loadedBits: Math.min(lengthBits, toNonNegativeNumber(block.loadedBits)),
            channelIndex: Math.max(0, toInteger(block.channelIndex, index)),
          };
        })
        .filter((block) => block.lengthBits > 0)
    : [];

const normalizeActiveOperation = (
  operation: ActiveCoreOperation,
): ActiveCoreOperation => {
  const parsedStatus = normalizeOperationStatus(operation.status);
  const remainingCycles = toNonNegativeAmount(operation.remainingCycles);
  const totalCycles = amountMax(
    remainingCycles,
    toNonNegativeAmount(operation.totalCycles),
  );
  const remainingLoadCycles = toNonNegativeAmount(operation.remainingLoadCycles);
  const totalLoadCycles = amountMax(
    remainingLoadCycles,
    toNonNegativeAmount(operation.totalLoadCycles),
  );
  // "complete" is only trusted when the required counters are exhausted;
  // otherwise the settle pass would pay the reward without the leftover work.
  const status =
    parsedStatus === "complete" &&
    (amountCompare(remainingCycles, ZERO_AMOUNT) > 0 ||
      amountCompare(remainingLoadCycles, ZERO_AMOUNT) > 0)
      ? "running"
      : parsedStatus;
  const memoryReservedBits = toNonNegativeNumber(operation.memoryReservedBits);

  return {
    ...operation,
    coreId: toInteger(operation.coreId, 1),
    operationIndex: toInteger(operation.operationIndex),
    status,
    memoryState: normalizeMemoryState(operation.memoryState, status),
    remainingCycles,
    totalCycles,
    remainingLoadCycles,
    totalLoadCycles,
    memoryReservedBits,
    memoryReservedBytes: toNonNegativeNumber(operation.memoryReservedBytes),
    ramBlocks: normalizeRamBlocks(operation.ramBlocks),
    ramChannelCount: Math.max(1, toInteger(operation.ramChannelCount, 1)),
    lockResource: operation.lockResource ?? null,
    lockReason: operation.lockReason ?? null,
    deadlockSeconds: toNonNegativeNumber(operation.deadlockSeconds),
  };
};

const normalizeCoreIds = (coreIds: unknown[], availableCoreIds: number[]) => {
  const available = new Set(availableCoreIds);
  const normalized = coreIds
    .map((coreId) => toInteger(coreId, NaN))
    .filter((coreId) => Number.isFinite(coreId) && available.has(coreId));

  return Array.from(new Set(normalized));
};

const normalizeActiveTask = (
  task: ActiveTask,
  availableCoreIds: number[],
  validParentEntryIds: ReadonlySet<string>,
): ActiveTask | null => {
  const rawParentTaskId = task.parentTaskId;
  const rawParentQueueEntryId = task.parentQueueEntryId;
  const parentTaskId = isTaskId(rawParentTaskId) ? rawParentTaskId : null;
  // A child of a removed/renamed parent task can never settle its work into a
  // parent (getTaskDefinition would throw); drop the stale child.
  if (rawParentTaskId != null && parentTaskId === null) return null;
  const parentQueueEntryId =
    typeof rawParentQueueEntryId === "string" &&
    validParentEntryIds.has(rawParentQueueEntryId)
      ? rawParentQueueEntryId
      : null;
  // A child whose parent queue entry vanished would run forever without ever
  // settling into a completion; drop it as stale child work.
  if (parentTaskId !== null && rawParentQueueEntryId != null && parentQueueEntryId === null) {
    return null;
  }

  const assignedCoreIds = normalizeCoreIds(task.assignedCoreIds, availableCoreIds);
  if (assignedCoreIds.length === 0) return null;

  const coreOperationIds = new Set(assignedCoreIds);
  const coreOperations = task.coreOperations
    .map(normalizeActiveOperation)
    .filter((operation) => coreOperationIds.has(operation.coreId));
  if (coreOperations.length === 0) return null;

  const activeRemainingCycles = sumAmounts(
    coreOperations.flatMap((operation) => [
      operation.remainingCycles,
      operation.remainingLoadCycles,
    ]),
  );
  const activeTotalCycles = sumAmounts(
    coreOperations.flatMap((operation) => [
      operation.totalCycles,
      operation.totalLoadCycles,
    ]),
  );
  const batch = normalizeTaskBatchSnapshot(
    task.taskId,
    task.parentTaskId,
    task.batchMultiplier,
    task.projectedRewardCredits,
    task.projectedWorkCycles,
  );
  const remainingCycles = amountMax(
    toNonNegativeAmount(task.remainingCycles),
    activeRemainingCycles,
  );
  const totalCycles = amountMax(
    remainingCycles,
    amountMax(toNonNegativeAmount(task.totalCycles), activeTotalCycles),
  );

  return {
    ...task,
    ...batch,
    taskId: task.taskId,
    jobId: normalizeTaskId(task.jobId, task.taskId),
    ...(rawParentTaskId !== undefined ? { parentTaskId } : {}),
    ...(rawParentQueueEntryId !== undefined ? { parentQueueEntryId } : {}),
    ...(task.childTaskId !== undefined
      ? { childTaskId: isTaskId(task.childTaskId) ? task.childTaskId : null }
      : {}),
    schedulerQueued: task.schedulerQueued === true,
    workOrigin: normalizeWorkOrigin(task.workOrigin),
    coreId: assignedCoreIds.includes(task.coreId)
      ? task.coreId
      : (assignedCoreIds[0] ?? 1),
    assignedCoreIds,
    workUnitsPending: Array.isArray(task.workUnitsPending)
      ? Array.from(
          new Set(
            task.workUnitsPending
              .map((workUnitIndex) => toInteger(workUnitIndex, NaN))
              .filter((workUnitIndex) => Number.isFinite(workUnitIndex) && workUnitIndex >= 0),
          ),
        )
      : undefined,
    acceleratorKindsUsed: normalizeAcceleratorKinds(
      task.acceleratorKindsUsed,
    ),
    coreOperations,
    remainingCycles,
    totalCycles,
  };
};

const normalizeCoreSchedulerQueueEntries = (
  value: GameState["coreSchedulers"] | null | undefined,
  fallback: GameState["coreSchedulers"],
  validParentEntryIds: ReadonlySet<string> | null = null,
): GameState["coreSchedulers"] => {
  if (!isRecord(value)) return fallback;
  return Object.fromEntries(
    Object.entries(value).flatMap(([coreId, scheduler]) =>
      isRecord(scheduler)
        ? [[
            coreId,
            {
              ...scheduler,
              localQueueEntries: normalizeQueueEntries(
                scheduler.localQueueEntries,
                validParentEntryIds,
              ),
            },
          ]]
        : [],
    ),
  ) as GameState["coreSchedulers"];
};

const getSavedSystemAvailableCoreIds = (
  hardware: LegacyHardwareState | undefined,
): number[] => {
  const savedCpus = Array.isArray(hardware?.cpus)
    ? hardware.cpus
        .filter((cpu): cpu is GameState["hardware"]["cpus"][number] =>
          isRecord(cpu),
        )
        .slice(0, V1_HARDWARE_LIMITS.cpuPackages)
    : [];
  if (savedCpus.length > 0) {
    return Array.from(
      new Set(
        savedCpus.flatMap(
          (cpu, index) =>
            createCpuHardwareState(toInteger(cpu.id, index + 1), cpu.coreIds)
              .coreIds,
        ),
      ),
    );
  }
  return Array.from(
    {
      length: clampFiniteInteger(
        hardware?.cores,
        1,
        V1_HARDWARE_LIMITS.coresPerCpu,
        1,
      ),
    },
    (_, index) => index + 1,
  );
};

/**
 * Every saved system — not just the root/selected runtime — gets the full
 * active-task + operation + queue normalization. A non-selected system's raw
 * tasks are otherwise loaded verbatim into the root runtime when the player
 * selects it, where invalid Amounts or stale references crash the simulation.
 */
const normalizeSavedSystem = (
  system: GameState["systems"][number],
  index: number,
): GameState["systems"][number] => {
  const availableCoreIds = getSavedSystemAvailableCoreIds(
    isRecord(system.hardware)
      ? (system.hardware as LegacyHardwareState)
      : undefined,
  );
  const queueEntries = sanitizeQueueEntryParentLinks(
    normalizeQueueEntries(system.queueEntries),
  );
  const parentEntryIds = new Set(queueEntries.map((entry) => entry.id));
  const activeTasks = (Array.isArray(system.activeTasks)
    ? system.activeTasks
    : []
  )
    .filter(isActiveTask)
    .map((task) => normalizeActiveTask(task, availableCoreIds, parentEntryIds))
    .filter((task): task is ActiveTask => task !== null);
  const cronSchedules = normalizeCronSchedules(system.cron?.schedules);
  return {
    ...system,
    id: Math.max(1, toInteger(system.id, index + 1)),
    activeTasks,
    activeJobs: activeTasks,
    cacheResidency: [],
    queue: normalizeTaskIdList(system.queue),
    queueEntries,
    coreSchedulers: normalizeCoreSchedulerQueueEntries(
      system.coreSchedulers,
      {},
      parentEntryIds,
    ),
    cron: {
      schedules: cronSchedules,
      nextScheduleId: Math.max(
        1,
        toInteger(system.cron?.nextScheduleId, cronSchedules.length + 1),
      ),
      queuePowerSpikeSeconds: toNonNegativeNumber(
        system.cron?.queuePowerSpikeSeconds,
      ),
    },
    deadlockPressureSeconds: toNonNegativeNumber(system.deadlockPressureSeconds),
    deadlockPressureResource:
      system.deadlockPressureResource === "cache" ||
      system.deadlockPressureResource === "ram"
        ? system.deadlockPressureResource
        : null,
    deadlockPressureCpuId: toPositiveIntegerOrNull(system.deadlockPressureCpuId),
    deadlockProcessLockout: system.deadlockProcessLockout === true,
  };
};

const normalizeCronIntervalMode = (
  mode: unknown,
): CronIntervalMode => (mode === "minutes" ? "minutes" : "seconds");

const normalizeCronSchedules = (
  schedules: unknown,
): GameState["cron"]["schedules"] =>
  Array.isArray(schedules)
    ? schedules
        .slice(0, 1)
        .filter((schedule): schedule is Partial<GameState["cron"]["schedules"][number]> =>
          Boolean(schedule && typeof schedule === "object"),
        )
        .map((schedule, index) => {
          const taskId = normalizeTaskId(schedule.taskId, null);
          return {
            id: Math.max(1, toInteger(schedule.id, index + 1)),
            taskId,
            enabled: schedule.enabled === true && taskId !== null,
            intervalMode: normalizeCronIntervalMode(schedule.intervalMode),
            intervalValue: toNonNegativeNumber(schedule.intervalValue, 60),
            remainingSeconds: toNonNegativeNumber(schedule.remainingSeconds, 60),
            lastResult: null,
          };
        })
    : [];

const isSavedRamStick = (value: unknown): value is Partial<RamStickState> =>
  isRecord(value);

const createUniqueRamStickId = (requestedId: number, usedIds: Set<number>) => {
  let id = Math.max(1, requestedId);
  while (usedIds.has(id)) id += 1;
  usedIds.add(id);
  return id;
};

const normalizeRamSticks = (
  savedSticks: unknown,
  ramLevel: number,
  ramSpeedLevel: number,
): RamStickState[] => {
  const fallbackSticks = createRamSticksForLevel(ramLevel, ramSpeedLevel);
  const sourceSticks =
    Array.isArray(savedSticks) && savedSticks.length > 0
      ? savedSticks.slice(0, V1_HARDWARE_LIMITS.ramSticks)
      : fallbackSticks;
  const usedIds = new Set<number>();
  const normalizedSticks = sourceSticks.filter(isSavedRamStick).map((stick, index) => {
    const level = clampFiniteInteger(
      stick.level,
      1,
      RAM_MAX_LEVEL,
      index + 1,
    );
    const bits = getRamBits(level);
    const speedLevel = clampFiniteInteger(
      stick.speedLevel,
      1,
      RAM_MAX_LEVEL,
      ramSpeedLevel,
    );

    return {
      id: createUniqueRamStickId(toInteger(stick.id, index + 1), usedIds),
      level,
      bits,
      bytes: bitsToBytes(bits),
      speedLevel,
      speedMt: getRamSpeedMt(speedLevel),
    };
  });

  return normalizedSticks.length > 0 ? normalizedSticks : fallbackSticks;
};

const normalizeState = (state: LegacyState): GameState => {
  const fresh = createInitialGameState();
  // Non-object entries (nulls, primitives) in systems[] are discarded instead
  // of throwing: a throw here would silently clean-reset the whole save.
  const savedSystems = Array.isArray(state.systems)
    ? state.systems
        .filter((system): system is GameState["systems"][number] =>
          isRecord(system),
        )
        .slice(0, V1_HARDWARE_LIMITS.inspectedSystems)
        .map(normalizeSavedSystem)
    : fresh.systems;
  const hardware: LegacyHardwareState = isRecord(state.hardware)
    ? (state.hardware as LegacyHardwareState)
    : {};
  const cacheLevel = clampFiniteInteger(
    hardware.cacheLevel,
    1,
    V1_HARDWARE_LIMITS.cacheLevel,
    fresh.hardware.cacheLevel,
  );
  const cacheSpeedLevel = clampFiniteInteger(
    hardware.cacheSpeedLevel,
    1,
    V1_HARDWARE_LIMITS.cacheSpeedLevel,
    fresh.hardware.cacheSpeedLevel,
  );
  const ramLevel = clampFiniteInteger(
    hardware.ramLevel,
    0,
    V1_HARDWARE_LIMITS.ramSticks,
    hardware.ramGb ? 1 : fresh.hardware.ramLevel,
  );
  const ramSpeedLevel = clampFiniteInteger(
    hardware.ramSpeedLevel,
    1,
    RAM_MAX_LEVEL,
    hardware.ramSpeedMt && hardware.ramSpeedMt > 0
      ? Math.max(1, Math.round(Math.log2(hardware.ramSpeedMt) + 1))
      : fresh.hardware.ramSpeedLevel,
  );
  const cacheBits = getCacheBits(cacheLevel);
  const ramBits = ramLevel > 0 ? getRamBits(Math.min(ramLevel, RAM_MAX_LEVEL)) : 0;
  const ramSticks = normalizeRamSticks(
    hardware.ramSticks,
    ramLevel,
    ramSpeedLevel,
  );
  const schedulerSlots = clampFiniteInteger(
    hardware.schedulerSlots,
    0,
    V1_HARDWARE_LIMITS.cpuQueueSlotsPerCpu,
    fresh.hardware.schedulerSlots,
  );
  const systemSchedulerSlots = clampFiniteInteger(
    hardware.systemSchedulerSlots,
    0,
    V1_HARDWARE_LIMITS.systemQueueSlots,
    fresh.hardware.systemSchedulerSlots,
  );
  // Non-object entries in hardware.cpus[] are discarded instead of throwing;
  // an empty result falls back to the single default package below.
  const savedCpus = Array.isArray(hardware.cpus)
    ? hardware.cpus
        .filter((cpu): cpu is GameState["hardware"]["cpus"][number] =>
          isRecord(cpu),
        )
        .slice(0, V1_HARDWARE_LIMITS.cpuPackages)
    : [];
  const cpus =
    savedCpus.length > 0
      ? savedCpus.map((cpu, index) =>
          createCpuHardwareState(toInteger(cpu.id, index + 1), cpu.coreIds, {
            ...cpu,
            schedulerConfig: createSchedulerConfig(cpu.schedulerConfig),
          }),
        )
      : [
          createCpuHardwareState(
            1,
            Array.from(
              {
                length: clampFiniteInteger(
                  hardware.cores,
                  1,
                  V1_HARDWARE_LIMITS.coresPerCpu,
                  fresh.hardware.cores,
                ),
              },
              (_, index) => index + 1,
            ),
            {
              cacheLevel,
              cacheSpeedLevel,
              cacheBits,
              cacheBytes: getCacheBytes(cacheLevel),
              schedulerSlots,
            },
          ),
        ];
  const psuLevel = clampFiniteInteger(
    hardware.psuLevel,
    1,
    V1_HARDWARE_LIMITS.psuLevel,
    hardware.psuWatts ? 1 : fresh.hardware.psuLevel,
  );
  const coolingLevel = hardware.coolingLevel ?? fresh.hardware.coolingLevel;
  const coreClockLevels: Record<number, number> =
    hardware.coreClockLevels ??
    (Object.fromEntries(
      cpus.flatMap((cpu) => cpu.coreIds.map((coreId) => [coreId, cpu.level])),
    ) as Record<number, number>);
  const clockLevel = Math.max(
    1,
    ...cpus.map((cpu) => cpu.level),
  );
  const availableCoreIds = cpus.flatMap((cpu) => cpu.coreIds);
  const completedTasks = normalizeTaskCounts(
    state.completedTasks ?? state.completedJobs,
  );
  const completedJobs = normalizeTaskCounts(state.completedJobs ?? completedTasks);
  const taskRewardCreditsEarned = normalizeTaskAmountTotals(
    state.taskRewardCreditsEarned,
  );
  const taskWorkCyclesCompleted = normalizeTaskAmountTotals(
    state.taskWorkCyclesCompleted,
  );
  const standingTaskCompletions = Object.fromEntries(
    Object.entries(normalizeTaskCounts(state.standingTaskCompletions)).map(
      ([taskId, count]) => [
        taskId,
        Math.min(count, completedTasks[taskId as TaskId] ?? 0),
      ],
    ),
  ) as GameState["standingTaskCompletions"];
  const clampStandingAmounts = (
    standingValues: unknown,
    totals: Partial<Record<TaskId, Amount>> | null = null,
  ) =>
    Object.fromEntries(
      Object.entries(normalizeTaskAmountTotals(standingValues)).map(
        ([taskId, value]) => [
          taskId,
          totals
            ? amountMin(value, totals[taskId as TaskId] ?? ZERO_AMOUNT)
            : value,
        ],
      ),
    ) as Partial<Record<TaskId, Amount>>;
  const queueEntries = sanitizeQueueEntryParentLinks(
    normalizeQueueEntries(state.queueEntries),
  );
  const rootParentEntryIds = new Set(queueEntries.map((entry) => entry.id));
  const savedActiveTasks = Array.isArray(state.activeTasks)
    ? state.activeTasks
    : Array.isArray(state.activeJobs)
      ? state.activeJobs
      : [];
  const activeTasks = savedActiveTasks
    .filter(isActiveTask)
    .map((task) => normalizeActiveTask(task, availableCoreIds, rootParentEntryIds))
    .filter((task): task is ActiveTask => task !== null);
  const researchCompleted = normalizeResearchCompleted(
    Array.isArray(state.research?.completed)
      ? state.research.completed
      : researchFromLegacyFlags(isRecord(state.flags) ? state.flags : {}),
  );
  const clickRateLevel = 0;
  const normalizedCronSchedules = normalizeCronSchedules(state.cron?.schedules);
  const cronScheduleSlots = Math.max(
    0,
    hardware.cronScheduleSlots ?? normalizedCronSchedules.length,
  );
  const resources = {
    credits: toNonNegativeNumber(state.resources?.credits, fresh.resources.credits),
    data: toNonNegativeNumber(state.resources?.data, fresh.resources.data),
  };
  const exactResources = normalizeExactResources(state.exactResources, resources);
  resources.credits = amountToSafeNumber(exactResources.credits);
  resources.data = amountToSafeNumber(exactResources.data);
  const powerState =
    state.power?.state === "shuttingDown" ||
    state.power?.state === "off" ||
    state.power?.state === "booting"
      ? state.power.state
      : "on";
  const bootstrapGraceSeconds =
    state.power?.bootstrapGraceSeconds ??
    (amountCompare(exactResources.credits, 0) <= 0 && powerState !== "off"
      ? POWER_BOOTSTRAP_GRACE_SECONDS
      : 0);
  const savedPower = state.power as
    | (Partial<GameState["power"]> & {
        overloadWarningSeconds?: number;
        creditShutdownWarningSeconds?: number;
      })
    | undefined;
  const overloadFailureSeconds = toNonNegativeNumber(
    savedPower?.overloadFailureSeconds ??
      savedPower?.overloadWarningSeconds,
  );
  const unpaidShutdownWarningSeconds = toNonNegativeNumber(
    savedPower?.unpaidShutdownWarningSeconds ??
      savedPower?.creditShutdownWarningSeconds,
  );
  const normalized: GameState = {
    ...fresh,
    ...state,
    version: SAVE_VERSION,
    tick: Math.max(0, toInteger(state.tick, fresh.tick)),
    advanceRemainderMs: Math.max(0, toFiniteNumber(state.advanceRemainderMs)),
    nextInstanceId: Math.max(
      1,
      toInteger(state.nextInstanceId, fresh.nextInstanceId),
    ),
    rack: {
      nextSystemId: Math.max(
        1,
        toInteger(state.rack?.nextSystemId, 1),
        ...savedSystems.map((system) => system.id + 1),
      ),
    },
    exactResources,
    rng: normalizeRngState(state.rng),
    time: {
      lastSavedAtMs:
        state.time?.lastSavedAtMs == null
          ? null
          : Math.max(0, toInteger(state.time.lastSavedAtMs)),
      departedAtMs:
        state.time?.departedAtMs == null
          ? null
          : Math.max(0, toInteger(state.time.departedAtMs)),
    },
    campaign: normalizeCampaignState(state.campaign),
    contracts: normalizeContractMarketState(state.contracts),
    projects: normalizeProjectsState(state.projects),
    automationBuffer: normalizeAutomationBufferState(state.automationBuffer),
    standingOrder: normalizeStandingOrderState(state.standingOrder),
    liveOperations: normalizeLiveOperationsState(
      {
        ...fresh,
        ...state,
        systems: savedSystems,
        hardware: {
          ...fresh.hardware,
          ...hardware,
          cpus,
          cores: cpus.reduce((total, cpu) => total + cpu.coreIds.length, 0),
        },
      } as GameState,
      state.liveOperations,
      true,
    ),
    lastAdvanceReport: null,
    hardware: {
      ...fresh.hardware,
      ...hardware,
      clockLevel,
      clockHz: Math.max(
        1,
        ...cpus.map((cpu) => getCpuClockHz(cpu.tierId, cpu.level)),
      ),
      coreClockLevels,
      cacheSpeedLevel,
      cacheBits,
      cacheBytes: getCacheBytes(cacheLevel),
      cpus,
      schedulerSlots,
      systemSchedulerSlots,
      systemSchedulerConfig: createSchedulerConfig(hardware.systemSchedulerConfig),
      deadlockRecoveryLevel:
        clampFiniteInteger(
          hardware.deadlockRecoveryLevel,
          0,
          V1_HARDWARE_LIMITS.deadlockRecoveryLevel,
          fresh.hardware.deadlockRecoveryLevel,
        ),
      ramLevel,
      ramBits,
      ramBytes: ramLevel > 0 ? getRamBytes(ramLevel) : 0,
      ramSpeedLevel,
      ramSpeedMt:
        hardware.ramSpeedMt && hardware.ramSpeedMt > 0
          ? hardware.ramSpeedMt
          : getRamSpeedMt(ramSpeedLevel),
      ramSticks,
      memoryVoltageLevel: Math.max(
        0,
        toInteger(
          hardware.memoryVoltageLevel,
          fresh.hardware.memoryVoltageLevel,
        ),
      ),
      bootloaderLevel: Math.min(
        BOOTLOADER_MAX_LEVEL,
        getBootloaderLevelFromHardware({
          bootloaderLevel: toInteger(
            hardware.bootloaderLevel,
            fresh.hardware.bootloaderLevel ?? 0,
          ),
        }),
      ),
      cronScheduleSlots: clampFiniteInteger(cronScheduleSlots, 0, 1, 0),
      cronIntervalLevel: clampFiniteInteger(
        hardware.cronIntervalLevel,
        0,
        V1_HARDWARE_LIMITS.cronIntervalLevel,
        fresh.hardware.cronIntervalLevel,
      ),
      cStateLevel: clampFiniteInteger(
        hardware.cStateLevel,
        0,
        V1_HARDWARE_LIMITS.cpuLevel,
        fresh.hardware.cStateLevel,
      ),
      psuLevel,
      psuWatts: getPsuWatts(psuLevel),
      coolingLevel,
      coolingRating:
        hardware.coolingRating ??
        (coolingLevel > 0 ? getCoolingRating(coolingLevel) : 0),
    },
    workshop: normalizeWorkshopSystemState(
      state.workshop ??
        savedSystems.find(
          (system) => system.id === (state.selectedSystemId ?? fresh.selectedSystemId),
        )?.workshop,
      hardware,
    ),
    flags: {
      ...fresh.flags,
      ...(isRecord(state.flags) ? state.flags : {}),
      specializedCompute: state.flags?.specializedCompute === true,
    },
    systems: savedSystems,
    resources,
    power: {
      state: powerState,
      idlePolicy:
        state.power?.idlePolicy === "shutdown-when-idle"
          ? "shutdown-when-idle"
          : "low-power",
      transitionSeconds: toNonNegativeNumber(state.power?.transitionSeconds),
      transitionTotalSeconds: toNonNegativeNumber(
        state.power?.transitionTotalSeconds ??
          state.power?.transitionSeconds,
      ),
      bootstrapGraceSeconds: toNonNegativeNumber(bootstrapGraceSeconds),
      unpaidShutdownWarningSeconds,
      overloadFailureSeconds,
      lastFailureReason:
        savedPower?.lastFailureReason === "psuOverload" ||
        savedPower?.lastFailureReason === "unpaidBill"
          ? savedPower.lastFailureReason
          : null,
      failureCount: Math.max(0, toInteger(savedPower?.failureCount, 0)),
    },
    cron: {
      schedules: normalizedCronSchedules,
      nextScheduleId: Math.max(
        1,
        toInteger(state.cron?.nextScheduleId, fresh.cron.nextScheduleId),
        ...normalizedCronSchedules.map((schedule) => schedule.id + 1),
      ),
      queuePowerSpikeSeconds: toNonNegativeNumber(
        state.cron?.queuePowerSpikeSeconds,
      ),
    },
    deadlockPressureSeconds: toNonNegativeNumber(state.deadlockPressureSeconds),
    deadlockPressureResource:
      state.deadlockPressureResource === "cache" ||
      state.deadlockPressureResource === "ram"
        ? state.deadlockPressureResource
        : null,
    deadlockPressureCpuId: toPositiveIntegerOrNull(state.deadlockPressureCpuId),
    deadlockProcessLockout: state.deadlockProcessLockout === true,
    research: {
      completed: researchCompleted,
      clickRateLevel,
    },
    reliability: {
      ...fresh.reliability,
      ...(isRecord(state.reliability) ? state.reliability : {}),
    },
    completedTasks,
    completedJobs,
    taskRewardCreditsEarned,
    taskWorkCyclesCompleted,
    standingTaskCompletions,
    standingTaskRewardCreditsEarned: clampStandingAmounts(
      state.standingTaskRewardCreditsEarned,
      taskRewardCreditsEarned,
    ),
    standingTaskDataEarned: clampStandingAmounts(
      state.standingTaskDataEarned,
    ),
    standingTaskWorkCyclesCompleted: clampStandingAmounts(
      state.standingTaskWorkCyclesCompleted,
      taskWorkCyclesCompleted,
    ),
    completedBenchmarks: normalizeTaskIdList(
      state.completedBenchmarks ?? fresh.completedBenchmarks,
    ),
    activeTasks,
    activeJobs: activeTasks,
    cacheResidency: [],
    coreSchedulers: normalizeCoreSchedulerQueueEntries(
      state.coreSchedulers,
      createCoreSchedulers(hardware.cores ?? fresh.hardware.cores),
      rootParentEntryIds,
    ),
    queue: normalizeTaskIdList(state.queue ?? fresh.queue),
    queueEntries,
    autoRepeatJobId: normalizeTaskId(state.autoRepeatJobId, null),
  };

  return updateCampaignProgress(
    normalizeCloudForGameState(materializeSystem(
      syncSelectedSystemRuntime(
        syncCronSchedules(
          pruneStaleContractOffers(
            updateProgressionFlags(syncHardwarePackages(normalized)),
          ),
        ),
      ),
    )),
  );
};

export const deserializeSave = (raw: string | null): GameState => {
  if (!raw) return createInitialGameState();

  try {
    const parsed = JSON.parse(raw) as {
      version?: number;
      savedAt?: string;
      savedAtMs?: number;
      departedAtMs?: number | null;
      state?: LegacyState;
    };

    if (
      (parsed.version === 3 && parsed.state?.version === 3) ||
      (parsed.version === 4 && parsed.state?.version === 4) ||
      (parsed.version === 5 && parsed.state?.version === 5) ||
      (parsed.version === 6 && parsed.state?.version === 6)
    ) {
      return createInitialGameState();
    }

    if (parsed.version === SAVE_VERSION && parsed.state?.version === SAVE_VERSION) {
      const normalized = normalizeState(parsed.state);
      const parsedSavedAtMs =
        typeof parsed.savedAtMs === "number" && Number.isFinite(parsed.savedAtMs)
          ? parsed.savedAtMs
          : typeof parsed.savedAt === "string"
            ? Date.parse(parsed.savedAt)
            : Number.NaN;
      const savedAtMs = Number.isFinite(parsedSavedAtMs)
        ? Math.max(0, Math.trunc(parsedSavedAtMs))
        : normalized.time.lastSavedAtMs;
      const departedAtMs =
        typeof parsed.departedAtMs === "number" && Number.isFinite(parsed.departedAtMs)
          ? Math.max(0, Math.trunc(parsed.departedAtMs))
          : parsed.departedAtMs === null
            ? null
            : normalized.time.departedAtMs;
      return {
        ...normalized,
        time: { lastSavedAtMs: savedAtMs, departedAtMs },
      };
    }
  } catch {
    return createInitialGameState();
  }

  return createInitialGameState();
};
