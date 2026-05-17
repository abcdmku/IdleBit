import { hasResearch } from "./content/research";
import type {
  CpuHardwareState,
  CoreSchedulerState,
  GameState,
  OperationRuntimeStatus,
  RamStickState,
  StageId,
} from "./types";

export const getClockHz = (level: number) =>
  Math.round(1 * 1.45 ** (level - 1) * 10) / 10;

export const getCoreClockLevel = (state: GameState, coreId: number) =>
  state.hardware.coreClockLevels[coreId] ?? state.hardware.clockLevel;

export const getCoreClockHz = (state: GameState, coreId: number) =>
  getClockHz(getCoreClockLevel(state, coreId));

export const getCacheBits = (level: number) => 2 ** (level - 1);

export const getCacheSpeedMultiplier = (level: number) =>
  Math.round(1.55 ** (level - 1) * 100) / 100;

export const bitsToBytes = (bits: number) => Math.ceil(bits / 8);

export const getCacheBytes = (level: number) => bitsToBytes(getCacheBits(level));

export const getRamBits = (level: number) =>
  level <= 0 ? 0 : 256 * 2 ** (level - 1);

export const getRamBytes = (level: number) => bitsToBytes(getRamBits(level));

export const getRamSpeedMt = (level: number) =>
  level <= 0 ? 1 : 2 ** (level - 1);

export const createRamStickState = (
  id: number,
  level: number,
  speedLevel = 1,
): RamStickState => ({
  id,
  level,
  bits: getRamBits(level),
  bytes: getRamBytes(level),
  speedLevel,
  speedMt: getRamSpeedMt(speedLevel),
});

export const createRamSticksForLevel = (
  ramLevel: number,
  speedLevel = 1,
): RamStickState[] => {
  if (ramLevel <= 0) return [];

  return Array.from({ length: ramLevel }, (_, index) =>
    createRamStickState(index + 1, Math.max(1, index), speedLevel),
  );
};

const normalizeRamSticks = (state: GameState) => {
  const fallbackSpeedLevel = state.hardware.ramSpeedLevel ?? 1;
  const existing =
    state.hardware.ramSticks && state.hardware.ramSticks.length > 0
      ? state.hardware.ramSticks
      : createRamSticksForLevel(state.hardware.ramLevel, fallbackSpeedLevel);

  return existing.map((stick, index) => {
    const level = Math.max(1, stick.level ?? index + 1);
    const speedLevel = Math.max(1, stick.speedLevel ?? fallbackSpeedLevel);
    return {
      id: stick.id ?? index + 1,
      level,
      bits: stick.bits ?? getRamBits(level),
      bytes: stick.bytes ?? getRamBytes(level),
      speedLevel,
      speedMt: getRamSpeedMt(speedLevel),
    };
  });
};

export const getPsuWatts = (level: number) =>
  level <= 0 ? 0 : Math.round(45 * 1.55 ** (level - 1));

export const getCoolingRating = (level: number) =>
  level <= 0 ? 0 : Math.round((1 + (level - 1) * 0.28) * 100) / 100;

export const createCpuHardwareState = (
  id: number,
  coreIds: number[],
  template?: Partial<Omit<CpuHardwareState, "id" | "coreIds">>,
): CpuHardwareState => {
  const cacheLevel = template?.cacheLevel ?? 1;
  const cacheSpeedLevel = template?.cacheSpeedLevel ?? 1;

  return {
    id,
    coreIds,
    cacheLevel,
    cacheSpeedLevel,
    cacheBits: template?.cacheBits ?? getCacheBits(cacheLevel),
    cacheBytes: template?.cacheBytes ?? getCacheBytes(cacheLevel),
    schedulerSlots: template?.schedulerSlots ?? 0,
  };
};

export const getCpuHardware = (state: GameState, cpuId = 1) =>
  normalizeCpuHardware(
    state,
    state.hardware.cpus.find((cpu) => cpu.id === cpuId) ??
      state.hardware.cpus[0] ??
      createCpuHardwareState(1, [1], {
        cacheLevel: state.hardware.cacheLevel,
        cacheSpeedLevel: state.hardware.cacheSpeedLevel,
        cacheBits: state.hardware.cacheBits,
        cacheBytes: state.hardware.cacheBytes,
        schedulerSlots: state.hardware.schedulerSlots,
      }),
  );

export const getCpuForCore = (state: GameState, coreId: number) =>
  getCpuHardware(
    state,
    state.hardware.cpus.find((cpu) => cpu.coreIds.includes(coreId))?.id ?? 1,
  );

export const getCpuIdForCore = (state: GameState, coreId: number) =>
  getCpuForCore(state, coreId).id;

export const getAllCoreIds = (state: GameState) => {
  const coreIds = state.hardware.cpus.flatMap((cpu) => cpu.coreIds);
  if (coreIds.length > 0) return coreIds;
  return Array.from({ length: state.hardware.cores }, (_, index) => index + 1);
};

const getSingleCpuCoreIds = (state: GameState, cpu: CpuHardwareState) => {
  const desiredCoreCount = Math.max(1, state.hardware.cores, cpu.coreIds.length);
  if (desiredCoreCount <= cpu.coreIds.length) return cpu.coreIds;

  return Array.from({ length: desiredCoreCount }, (_, index) => index + 1);
};

const normalizeCpuHardware = (
  state: GameState,
  cpu: CpuHardwareState,
): CpuHardwareState => {
  if (state.hardware.cpus.length !== 1) return createCpuHardwareState(cpu.id, cpu.coreIds, cpu);

  return createCpuHardwareState(cpu.id, getSingleCpuCoreIds(state, cpu), {
    ...cpu,
    cacheLevel: state.hardware.cacheLevel,
    cacheSpeedLevel: state.hardware.cacheSpeedLevel,
    cacheBits: state.hardware.cacheBits,
    cacheBytes: state.hardware.cacheBytes,
    schedulerSlots: state.hardware.schedulerSlots,
  });
};

export const syncHardwarePackages = (state: GameState): GameState => {
  const existingCpus =
    state.hardware.cpus.length > 0
      ? state.hardware.cpus
      : [
          createCpuHardwareState(
            1,
            Array.from(
              { length: Math.max(1, state.hardware.cores) },
              (_, index) => index + 1,
            ),
            {
              cacheLevel: state.hardware.cacheLevel,
              cacheSpeedLevel: state.hardware.cacheSpeedLevel,
              cacheBits: state.hardware.cacheBits,
              cacheBytes: state.hardware.cacheBytes,
              schedulerSlots: state.hardware.schedulerSlots,
            },
          ),
        ];
  const cpus = existingCpus.map((cpu) => normalizeCpuHardware(state, cpu));
  const allCoreIds = cpus.flatMap((cpu) => cpu.coreIds);
  const cores = allCoreIds.length;
  const maxCacheCpu = cpus.reduce((best, cpu) =>
    cpu.cacheBits > best.cacheBits ? cpu : best,
  );
  const maxSpeedCpu = cpus.reduce((best, cpu) =>
    cpu.cacheSpeedLevel > best.cacheSpeedLevel ? cpu : best,
  );
  const ramSticks = normalizeRamSticks(state);
  const ramBits = ramSticks.reduce((total, stick) => total + stick.bits, 0);
  const ramLevel = ramSticks.length;
  const ramSpeedLevel =
    ramSticks.length > 0
      ? Math.max(...ramSticks.map((stick) => stick.speedLevel))
      : (state.hardware.ramSpeedLevel ?? 1);
  const ramSpeedMt =
    ramSticks.length > 0
      ? ramSticks.reduce((total, stick) => total + stick.speedMt, 0)
      : getRamSpeedMt(ramSpeedLevel);

  return {
    ...state,
    hardware: {
      ...state.hardware,
      cpus,
      cores,
      secondCpu: state.hardware.secondCpu || cpus.length > 1,
      cacheLevel: maxCacheCpu.cacheLevel,
      cacheBits: maxCacheCpu.cacheBits,
      cacheBytes: maxCacheCpu.cacheBytes,
      cacheSpeedLevel: maxSpeedCpu.cacheSpeedLevel,
      schedulerSlots: cpus.reduce((total, cpu) => total + cpu.schedulerSlots, 0),
      ramLevel,
      ramBits,
      ramBytes: bitsToBytes(ramBits),
      ramSpeedLevel,
      ramSpeedMt,
      ramSticks,
    },
  };
};

export const createCoreSchedulerState = (
  coreId: number,
): CoreSchedulerState => ({
  coreId,
  activeTaskInstanceId: null,
  operationId: null,
  status: "idle",
  memoryState: "idle",
  localQueue: [],
  progress: 0,
});

export const createCoreSchedulers = (cores: number) =>
  Object.fromEntries(
    Array.from({ length: cores }, (_, index) => {
      const coreId = index + 1;
      return [coreId, createCoreSchedulerState(coreId)];
    }),
  ) as Record<number, CoreSchedulerState>;

export const getOperationProgress = (
  remainingCycles: number,
  totalCycles: number,
  remainingLoadCycles: number,
  totalLoadCycles: number,
) => {
  const total = totalCycles + totalLoadCycles;
  if (total <= 0) return 0;

  return Math.min(
    1,
    Math.max(0, 1 - (remainingCycles + remainingLoadCycles) / total),
  );
};

const getCompletedCount = (state: GameState, id: keyof GameState["completedTasks"]) =>
  state.completedTasks[id] ?? state.completedJobs[id] ?? 0;

const hasCompleted = (state: GameState, id: keyof GameState["completedTasks"]) =>
  getCompletedCount(state, id) > 0 || state.completedBenchmarks.includes(id);

export const createInitialGameState = (): GameState => ({
  version: 1,
  tick: 0,
  nextInstanceId: 1,
  resources: {
    credits: 0,
    data: 0,
  },
  hardware: {
    clockLevel: 1,
    clockHz: getClockHz(1),
    coreClockLevels: {
      1: 1,
    },
    cpus: [createCpuHardwareState(1, [1])],
    cacheLevel: 1,
    cacheSpeedLevel: 1,
    cacheBits: getCacheBits(1),
    cacheBytes: getCacheBytes(1),
    cores: 1,
    schedulerSlots: 0,
    systemSchedulerSlots: 0,
    secondCpu: false,
    ramLevel: 0,
    ramBits: 0,
    ramBytes: 0,
    ramSpeedLevel: 1,
    ramSpeedMt: getRamSpeedMt(1),
    ramSticks: [],
    psuLevel: 0,
    psuWatts: 0,
    coolingLevel: 0,
    coolingRating: 0,
  },
  flags: {
    cache: false,
    autoRepeat: false,
    benchmarks: false,
    multiCore: false,
    basicQueue: false,
    scheduler: false,
    secondCpu: false,
    systemStats: false,
    cooling: false,
  },
  research: {
    completed: [],
  },
  reliability: {
    restartDebt: 0,
    corruptionDebt: 0,
    totalRestarts: 0,
    totalCorruptions: 0,
    lastEvent: null,
  },
  completedTasks: {},
  completedJobs: {},
  completedBenchmarks: [],
  activeTasks: [],
  activeJobs: [],
  cacheResidency: [],
  coreSchedulers: createCoreSchedulers(1),
  queue: [],
  autoRepeatJobId: null,
});

export const getStage = (state: GameState): StageId => {
  if (state.flags.systemStats) return "systemReveal";
  if (state.flags.scheduler) return "scheduler";
  if (state.flags.multiCore || state.hardware.cores > 1) return "multiCore";
  if (hasCompleted(state, "microBenchmark") || state.flags.benchmarks) {
    return "singleCpu";
  }
  return "primitiveCpu";
};

export const getStageLabel = (stage: StageId) => {
  const labels: Record<StageId, string> = {
    primitiveCpu: "Stage 0 - Primitive CPU",
    singleCpu: "Stage 1 - Single CPU",
    multiCore: "Stage 2 - Multi-Core CPU",
    scheduler: "Stage 3 - Scheduler",
    systemReveal: "Stage 4 - System Reveal",
  };

  return labels[stage];
};

const withCoreSchedulers = (state: GameState): GameState => {
  const syncedState = syncHardwarePackages(state);
  const schedulers = { ...state.coreSchedulers };
  let changed = false;

  for (const coreId of getAllCoreIds(syncedState)) {
    if (!schedulers[coreId]) {
      schedulers[coreId] = createCoreSchedulerState(coreId);
      changed = true;
    }
  }

  for (const rawCoreId of Object.keys(schedulers)) {
    const coreId = Number(rawCoreId);
    if (!getAllCoreIds(syncedState).includes(coreId)) {
      delete schedulers[coreId];
      changed = true;
    }
  }

  return changed ? { ...syncedState, coreSchedulers: schedulers } : syncedState;
};

export const syncCoreSchedulers = (state: GameState): GameState => {
  const seeded = withCoreSchedulers(state);
  const schedulers = Object.fromEntries(
    getAllCoreIds(seeded).map((coreId) => {
      const activeTask = seeded.activeTasks.find((task) =>
        task.assignedCoreIds.includes(coreId),
      );
      const coreOperation = activeTask?.coreOperations.find(
        (operation) => operation.coreId === coreId,
      );
      const previous = seeded.coreSchedulers[coreId] ?? createCoreSchedulerState(coreId);
      const status: OperationRuntimeStatus | "idle" =
        coreOperation?.status ?? "idle";

      return [
        coreId,
        {
          ...previous,
          coreId,
          activeTaskInstanceId: activeTask?.instanceId ?? null,
          operationId: coreOperation?.operationId ?? null,
          status,
          memoryState: coreOperation?.memoryState ?? "idle",
          progress: coreOperation
            ? getOperationProgress(
                coreOperation.remainingCycles,
                coreOperation.totalCycles,
                coreOperation.remainingLoadCycles,
                coreOperation.totalLoadCycles,
              )
            : 0,
        },
      ];
    }),
  ) as Record<number, CoreSchedulerState>;

  return {
    ...seeded,
    activeJobs: seeded.activeTasks,
    coreSchedulers: schedulers,
  };
};

export const updateProgressionFlags = (state: GameState): GameState => {
  const researched = state.research.completed;
  const nextState = {
    ...state,
    flags: {
      ...state.flags,
      cache: state.flags.cache || researched.includes("cacheMapping"),
      autoRepeat: false,
      benchmarks:
        state.flags.benchmarks || researched.includes("benchmarkHarness"),
      multiCore: state.flags.multiCore || researched.includes("multiCore"),
      basicQueue:
        state.flags.basicQueue || researched.includes("localScheduler"),
      scheduler:
        state.flags.scheduler || researched.includes("systemScheduler"),
      secondCpu: state.flags.secondCpu || researched.includes("systemBus"),
      systemStats:
        state.flags.systemStats ||
        state.hardware.secondCpu ||
        researched.includes("ramControl"),
      cooling: state.flags.cooling || researched.includes("thermalControl"),
    },
  };

  return syncCoreSchedulers(nextState);
};

export const getMilestone = (state: GameState) => {
  if (!hasCompleted(state, "byteCopy")) return "Build up from single-bit work.";
  if (!state.flags.cache) return "Research cache mapping.";
  if (!state.flags.benchmarks) return "Research the benchmark harness.";
  if (!hasCompleted(state, "microBenchmark")) return "Tune clock/cache for micro benchmark.";
  if (!hasCompleted(state, "parallelismBenchmark")) {
    return "Run the parallelism benchmark.";
  }
  if (!state.flags.multiCore) return "Research multi-core control.";
  if (state.hardware.cores < 2) return "Add a second core for local scheduling.";
  if (!state.flags.basicQueue) return "Research the local scheduler.";
  if (state.hardware.cores < 4) return "Reach four cores for the system scheduler.";
  if (!state.research.completed.includes("ramControl")) return "Research RAM control.";
  if (state.hardware.ramBits < 1024) return "Upgrade RAM to 1 Kb.";
  if (!state.flags.scheduler) return "Research the system scheduler.";
  if (!hasCompleted(state, "multiCoreBenchmark")) {
    return "Complete the multi-core benchmark.";
  }
  if (!state.flags.secondCpu) return "Research the system bus.";
  if (!state.hardware.secondCpu) return "Install the second CPU.";
  if (!state.flags.cooling) return "Research thermal control for safer restarts.";
  return "Balance RAM, PSU, and cooling under load.";
};
