import {
  createCoreSchedulers,
  createCpuHardwareState,
  createInitialGameState,
  createRamSticksForLevel,
  getCacheBits,
  getCacheBytes,
  getClockHz,
  getCoolingRating,
  getPsuWatts,
  getRamBytes,
  getRamBits,
  getRamSpeedMt,
  syncHardwarePackages,
  updateProgressionFlags,
} from "./progression";
import type { ActiveTask, GameFlags, GameState, ResearchId } from "./types";

export interface SaveEnvelope {
  version: 1;
  savedAt: string;
  state: GameState;
}

export const createSaveEnvelope = (state: GameState): SaveEnvelope => ({
  version: 1,
  savedAt: new Date().toISOString(),
  state,
});

export const serializeSave = (state: GameState) =>
  JSON.stringify(createSaveEnvelope(state));

type LegacyHardwareState = Partial<GameState["hardware"]> & {
  ramGb?: number;
};

type LegacyState = Partial<GameState> & {
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
  if (flags.scheduler) completed.push("systemScheduler");
  if (flags.systemStats) completed.push("ramControl");
  if (flags.secondCpu) completed.push("systemBus");
  if (flags.cooling) completed.push("thermalControl");
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
  "systemScheduler",
  "ramControl",
  "systemBus",
  "thermalControl",
] satisfies ResearchId[];

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
    typeof candidate.taskId === "string" &&
    Array.isArray(candidate.assignedCoreIds) &&
    Array.isArray(candidate.coreOperations)
  );
};

const normalizeState = (state: LegacyState): GameState => {
  const fresh = createInitialGameState();
  const hardware: LegacyHardwareState = state.hardware ?? {};
  const cacheLevel = hardware.cacheLevel ?? fresh.hardware.cacheLevel;
  const cacheSpeedLevel =
    hardware.cacheSpeedLevel ?? fresh.hardware.cacheSpeedLevel;
  const ramLevel = hardware.ramLevel ?? (hardware.ramGb ? 1 : fresh.hardware.ramLevel);
  const ramSpeedLevel =
    hardware.ramSpeedLevel ??
    (hardware.ramSpeedMt && hardware.ramSpeedMt > 0
      ? Math.max(1, Math.round(Math.log2(hardware.ramSpeedMt) + 1))
      : fresh.hardware.ramSpeedLevel);
  const cacheBits = hardware.cacheBits ?? getCacheBits(cacheLevel);
  const ramBits = hardware.ramBits ?? (ramLevel > 0 ? getRamBits(ramLevel) : 0);
  const ramSticks =
    hardware.ramSticks && hardware.ramSticks.length > 0
      ? hardware.ramSticks
      : createRamSticksForLevel(ramLevel, ramSpeedLevel);
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
      ? hardware.cpus
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
  const psuLevel =
    hardware.psuLevel ?? (hardware.psuWatts ? 1 : fresh.hardware.psuLevel);
  const coolingLevel = hardware.coolingLevel ?? fresh.hardware.coolingLevel;
  const coreClockLevels: Record<number, number> =
    hardware.coreClockLevels ??
    (Object.fromEntries(
      Array.from({ length: hardware.cores ?? fresh.hardware.cores }, (_, index) => [
        index + 1,
        hardware.clockLevel ?? fresh.hardware.clockLevel,
      ]),
    ) as Record<number, number>);
  const clockLevel = Math.max(
    hardware.clockLevel ?? fresh.hardware.clockLevel,
    ...Object.values(coreClockLevels),
  );
  const completedTasks = state.completedTasks ?? state.completedJobs ?? {};
  const activeTasks = (state.activeTasks ?? state.activeJobs ?? [])
    .filter(isActiveTask)
    .map((task) => ({
      ...task,
      schedulerQueued: task.schedulerQueued === true,
    }));
  const researchCompleted = normalizeResearchCompleted(
    state.research?.completed ?? researchFromLegacyFlags(state.flags),
  );
  const normalized: GameState = {
    ...fresh,
    ...state,
    hardware: {
      ...fresh.hardware,
      ...hardware,
      clockLevel,
      clockHz: getClockHz(clockLevel),
      coreClockLevels,
      cacheSpeedLevel,
      cacheBits,
      cacheBytes: getCacheBytes(cacheLevel),
      cpus,
      schedulerSlots,
      systemSchedulerSlots,
      ramLevel,
      ramBits,
      ramBytes: ramLevel > 0 ? getRamBytes(ramLevel) : 0,
      ramSpeedLevel,
      ramSpeedMt:
        hardware.ramSpeedMt && hardware.ramSpeedMt > 0
          ? hardware.ramSpeedMt
          : getRamSpeedMt(ramSpeedLevel),
      ramSticks,
      psuLevel,
      psuWatts: hardware.psuLevel
        ? (hardware.psuWatts ?? getPsuWatts(psuLevel))
        : psuLevel > 0
          ? getPsuWatts(psuLevel)
          : 0,
      coolingLevel,
      coolingRating:
        hardware.coolingRating ??
        (coolingLevel > 0 ? getCoolingRating(coolingLevel) : 0),
    },
    flags: {
      ...fresh.flags,
      ...state.flags,
    },
    resources: {
      ...fresh.resources,
      ...state.resources,
    },
    research: {
      completed: researchCompleted,
    },
    reliability: {
      ...fresh.reliability,
      ...state.reliability,
    },
    completedTasks,
    completedJobs: state.completedJobs ?? completedTasks,
    completedBenchmarks: state.completedBenchmarks ?? fresh.completedBenchmarks,
    activeTasks,
    activeJobs: activeTasks,
    cacheResidency: [],
    coreSchedulers:
      state.coreSchedulers ?? createCoreSchedulers(hardware.cores ?? fresh.hardware.cores),
    queue: state.queue ?? fresh.queue,
    autoRepeatJobId: state.autoRepeatJobId ?? null,
  };

  return updateProgressionFlags(syncHardwarePackages(normalized));
};

export const deserializeSave = (raw: string | null): GameState => {
  if (!raw) return createInitialGameState();

  try {
    const parsed = JSON.parse(raw) as Partial<SaveEnvelope>;

    if (parsed.version === 1 && parsed.state?.version === 1) {
      return normalizeState(parsed.state);
    }
  } catch {
    return createInitialGameState();
  }

  return createInitialGameState();
};
