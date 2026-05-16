import {
  createCoreSchedulers,
  createInitialGameState,
  getCacheBits,
  getCacheBytes,
  getClockHz,
  getCoolingRating,
  getPsuWatts,
  getRamBytes,
  getRamBits,
  getRamSpeedMt,
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
  if (flags.scheduler) completed.push("kernelScheduler");
  if (flags.secondCpu) completed.push("systemBus");
  if (flags.cooling) completed.push("thermalControl");
  return completed;
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
  const cacheBits = hardware.cacheBits ?? getCacheBits(cacheLevel);
  const ramBits = hardware.ramBits ?? (ramLevel > 0 ? getRamBits(ramLevel) : 0);
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
  const activeTasks = (state.activeTasks ?? state.activeJobs ?? []).filter(isActiveTask);
  const researchCompleted =
    state.research?.completed ?? researchFromLegacyFlags(state.flags);
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
      ramLevel,
      ramBits,
      ramBytes: ramLevel > 0 ? getRamBytes(ramLevel) : 0,
      ramSpeedMt:
        hardware.ramSpeedMt && hardware.ramSpeedMt > 0
          ? hardware.ramSpeedMt
          : getRamSpeedMt(ramLevel),
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
      completed: Array.from(new Set(researchCompleted)),
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

  return updateProgressionFlags(normalized);
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
