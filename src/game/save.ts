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
import { taskDefinitions } from "./content/tasks";
import { materializeSystem, syncSelectedSystemRuntime } from "./systems";
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
} from "./types";

export const SAVE_VERSION = 6 as const;

export interface SaveEnvelope {
  version: typeof SAVE_VERSION;
  savedAt: string;
  state: GameState;
}

export const createSaveEnvelope = (state: GameState): SaveEnvelope => ({
  version: SAVE_VERSION,
  savedAt: new Date().toISOString(),
  state,
});

export const serializeSave = (state: GameState) =>
  JSON.stringify(createSaveEnvelope(state));

type LegacyHardwareState = Partial<GameState["hardware"]> & {
  ramGb?: number;
};

type LegacyState = Omit<Partial<GameState>, "version"> & {
  version?: number;
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
  if (flags.schedulerPolicies) completed.push("schedulerPolicies");
  if (flags.scheduler) completed.push("systemScheduler");
  if (flags.systemStats) completed.push("ramControl");
  if (flags.secondCpu) completed.push("systemBus");
  if (flags.cron) completed.push("cronScheduler");
  return completed;
};

const validResearchIds = [
  "decodeLogic",
  "bitMutation",
  "shiftOperations",
  "byteOperations",
  "cacheMapping",
  "benchmarkHarness",
  "multiCore",
  "localScheduler",
  "schedulerWatchdog",
  "schedulerPolicies",
  "systemScheduler",
  "ramControl",
  "systemBus",
  "cronScheduler",
  "systemCatalog",
  "customMachineAssembly",
  "psuManagement",
  "thermalControl",
  "cpuTierKhz",
  "cpuTierMhz",
  "cpuTierGhz",
  "cpuTierThz",
  "cpuTierPhz",
  "cStateControl",
  "dualChannelRam",
  "quadChannelRam",
  "octChannelRam",
  "memoryVoltageModifier",
] satisfies ResearchId[];

const validTaskIds = new Set<TaskId>(taskDefinitions.map((task) => task.id));

const isTaskId = (id: unknown): id is TaskId =>
  typeof id === "string" && validTaskIds.has(id as TaskId);

const toFiniteNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const toNonNegativeNumber = (value: unknown, fallback = 0) =>
  Math.max(0, toFiniteNumber(value, fallback));

const toInteger = (value: unknown, fallback = 0) =>
  Math.trunc(toFiniteNumber(value, fallback));

const normalizeTaskIdList = (values: unknown): TaskId[] =>
  Array.isArray(values) ? values.filter(isTaskId) : [];

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
    .filter((id): id is ResearchId =>
      validResearchIds.includes(id as ResearchId),
    );

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

  if (status === "rerunning" || status === "restarting") return "running";
  return "complete";
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
        .filter((block): block is Record<string, unknown> =>
          Boolean(block && typeof block === "object" && !Array.isArray(block)),
        )
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
  const status = normalizeOperationStatus(operation.status);
  const remainingCycles = toNonNegativeNumber(operation.remainingCycles);
  const totalCycles = Math.max(
    remainingCycles,
    toNonNegativeNumber(operation.totalCycles),
  );
  const remainingLoadCycles = toNonNegativeNumber(operation.remainingLoadCycles);
  const totalLoadCycles = Math.max(
    remainingLoadCycles,
    toNonNegativeNumber(operation.totalLoadCycles),
  );
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
): ActiveTask | null => {
  const assignedCoreIds = normalizeCoreIds(task.assignedCoreIds, availableCoreIds);
  if (assignedCoreIds.length === 0) return null;

  const coreOperationIds = new Set(assignedCoreIds);
  const coreOperations = task.coreOperations
    .map(normalizeActiveOperation)
    .filter((operation) => coreOperationIds.has(operation.coreId));
  if (coreOperations.length === 0) return null;

  const remainingCycles = coreOperations.reduce(
    (total, operation) => total + operation.remainingCycles + operation.remainingLoadCycles,
    0,
  );
  const totalCycles = coreOperations.reduce(
    (total, operation) => total + operation.totalCycles + operation.totalLoadCycles,
    0,
  );

  return {
    ...task,
    taskId: task.taskId,
    jobId: normalizeTaskId(task.jobId, task.taskId),
    schedulerQueued: task.schedulerQueued === true,
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
    coreOperations,
    remainingCycles,
    totalCycles: Math.max(remainingCycles, totalCycles),
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
  Boolean(value && typeof value === "object" && !Array.isArray(value));

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
      ? savedSticks
      : fallbackSticks;
  const usedIds = new Set<number>();
  const normalizedSticks = sourceSticks.filter(isSavedRamStick).map((stick, index) => {
    const level = Math.max(1, toInteger(stick.level, index + 1));
    const savedBits = toFiniteNumber(stick.bits, NaN);
    const bits = savedBits > 0 ? savedBits : getRamBits(level);
    const speedLevel = Math.max(1, toInteger(stick.speedLevel, ramSpeedLevel));

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
  const hardware: LegacyHardwareState = state.hardware ?? {};
  const cacheLevel = hardware.cacheLevel ?? fresh.hardware.cacheLevel;
  const cacheSpeedLevel =
    hardware.cacheSpeedLevel ?? fresh.hardware.cacheSpeedLevel;
  const ramLevel = Math.max(
    0,
    toInteger(hardware.ramLevel, hardware.ramGb ? 1 : fresh.hardware.ramLevel),
  );
  const ramSpeedLevel =
    Math.max(
      1,
      toInteger(
        hardware.ramSpeedLevel,
        hardware.ramSpeedMt && hardware.ramSpeedMt > 0
          ? Math.max(1, Math.round(Math.log2(hardware.ramSpeedMt) + 1))
          : fresh.hardware.ramSpeedLevel,
      ),
    );
  const cacheBits = hardware.cacheBits ?? getCacheBits(cacheLevel);
  const ramBits = hardware.ramBits ?? (ramLevel > 0 ? getRamBits(ramLevel) : 0);
  const ramSticks = normalizeRamSticks(
    hardware.ramSticks,
    ramLevel,
    ramSpeedLevel,
  );
  const schedulerSlots = Math.max(
    0,
    hardware.schedulerSlots ?? fresh.hardware.schedulerSlots,
  );
  const systemSchedulerSlots = Math.max(
    0,
    hardware.systemSchedulerSlots ?? fresh.hardware.systemSchedulerSlots,
  );
  const cpus =
    hardware.cpus && hardware.cpus.length > 0
      ? hardware.cpus.map((cpu) =>
          createCpuHardwareState(cpu.id, cpu.coreIds, {
            ...cpu,
            schedulerConfig: createSchedulerConfig(cpu.schedulerConfig),
          }),
        )
      : [
          createCpuHardwareState(
            1,
            Array.from(
              { length: Math.max(1, hardware.cores ?? fresh.hardware.cores) },
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
  const psuLevel = Math.max(
    1,
    hardware.psuLevel ?? (hardware.psuWatts ? 1 : fresh.hardware.psuLevel),
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
  const activeTasks = (state.activeTasks ?? state.activeJobs ?? [])
    .filter(isActiveTask)
    .map((task) => normalizeActiveTask(task, availableCoreIds))
    .filter((task): task is ActiveTask => task !== null);
  const researchCompleted = normalizeResearchCompleted(
    state.research?.completed ?? researchFromLegacyFlags(state.flags),
  );
  const normalizedCronSchedules = normalizeCronSchedules(state.cron?.schedules);
  const cronScheduleSlots = Math.max(
    0,
    hardware.cronScheduleSlots ?? normalizedCronSchedules.length,
  );
  const resources = {
    ...fresh.resources,
    ...state.resources,
  };
  const powerState =
    state.power?.state === "shuttingDown" ||
    state.power?.state === "off" ||
    state.power?.state === "booting"
      ? state.power.state
      : "on";
  const bootstrapGraceSeconds =
    state.power?.bootstrapGraceSeconds ??
    (resources.credits <= 0 && powerState !== "off"
      ? POWER_BOOTSTRAP_GRACE_SECONDS
      : 0);
  const savedPower = state.power as
    | (Partial<GameState["power"]> & {
        overloadWarningSeconds?: number;
        creditShutdownWarningSeconds?: number;
      })
    | undefined;
  const overloadFailureSeconds = Math.max(
    0,
    savedPower?.overloadFailureSeconds ??
      savedPower?.overloadWarningSeconds ??
      0,
  );
  const unpaidShutdownWarningSeconds = Math.max(
    0,
    savedPower?.unpaidShutdownWarningSeconds ??
      savedPower?.creditShutdownWarningSeconds ??
      0,
  );
  const normalized: GameState = {
    ...fresh,
    ...state,
    version: SAVE_VERSION,
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
        hardware.deadlockRecoveryLevel ?? fresh.hardware.deadlockRecoveryLevel,
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
      cronScheduleSlots,
      cronIntervalLevel:
        hardware.cronIntervalLevel ?? fresh.hardware.cronIntervalLevel,
      cStateLevel: Math.max(
        0,
        toInteger(hardware.cStateLevel, fresh.hardware.cStateLevel),
      ),
      psuLevel,
      psuWatts: Math.max(
        hardware.psuWatts && hardware.psuWatts > 0 ? hardware.psuWatts : 0,
        getPsuWatts(psuLevel),
      ),
      coolingLevel,
      coolingRating:
        hardware.coolingRating ??
        (coolingLevel > 0 ? getCoolingRating(coolingLevel) : 0),
    },
    flags: {
      ...fresh.flags,
      ...state.flags,
    },
    resources,
    power: {
      state: powerState,
      transitionSeconds: Math.max(0, state.power?.transitionSeconds ?? 0),
      bootstrapGraceSeconds: Math.max(0, bootstrapGraceSeconds),
      unpaidShutdownWarningSeconds,
      overloadFailureSeconds,
      lastFailureReason:
        savedPower?.lastFailureReason === "psuOverload" ||
        savedPower?.lastFailureReason === "unpaidBill"
          ? savedPower.lastFailureReason
          : null,
      failureCount: Math.max(0, savedPower?.failureCount ?? 0),
    },
    cron: {
      schedules: normalizedCronSchedules,
      nextScheduleId: Math.max(
        1,
        state.cron?.nextScheduleId ?? fresh.cron.nextScheduleId,
      ),
      queuePowerSpikeSeconds: Math.max(
        0,
        state.cron?.queuePowerSpikeSeconds ?? 0,
      ),
    },
    deadlockPressureSeconds: state.deadlockPressureSeconds ?? 0,
    deadlockPressureResource: state.deadlockPressureResource ?? null,
    deadlockPressureCpuId: state.deadlockPressureCpuId ?? null,
    deadlockProcessLockout: state.deadlockProcessLockout ?? false,
    research: {
      completed: researchCompleted,
    },
    reliability: {
      ...fresh.reliability,
      ...state.reliability,
    },
    completedTasks,
    completedJobs,
    completedBenchmarks: normalizeTaskIdList(
      state.completedBenchmarks ?? fresh.completedBenchmarks,
    ),
    activeTasks,
    activeJobs: activeTasks,
    cacheResidency: [],
    coreSchedulers:
      state.coreSchedulers ?? createCoreSchedulers(hardware.cores ?? fresh.hardware.cores),
    queue: normalizeTaskIdList(state.queue ?? fresh.queue),
    queueEntries: Array.isArray(state.queueEntries)
      ? (state.queueEntries as TaskQueueEntry[])
      : fresh.queueEntries,
    autoRepeatJobId: normalizeTaskId(state.autoRepeatJobId, null),
  };

  return materializeSystem(
    syncSelectedSystemRuntime(
      syncCronSchedules(updateProgressionFlags(syncHardwarePackages(normalized))),
    ),
  );
};

export const deserializeSave = (raw: string | null): GameState => {
  if (!raw) return createInitialGameState();

  try {
    const parsed = JSON.parse(raw) as {
      version?: number;
      state?: LegacyState;
    };

    if (
      (parsed.version === 3 && parsed.state?.version === 3) ||
      (parsed.version === 4 && parsed.state?.version === 4) ||
      (parsed.version === 5 && parsed.state?.version === 5)
    ) {
      return createInitialGameState();
    }

    if (parsed.version === SAVE_VERSION && parsed.state?.version === SAVE_VERSION) {
      return normalizeState(parsed.state);
    }
  } catch {
    return createInitialGameState();
  }

  return createInitialGameState();
};
