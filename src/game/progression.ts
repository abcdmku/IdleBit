import type { GameState, StageId } from "./types";

export const getClockHz = (level: number) => Math.round(10 * 1.45 ** (level - 1));

export const getCacheBytes = (level: number) => 2 ** (level - 1);

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
    cacheLevel: 1,
    cacheBytes: getCacheBytes(1),
    cores: 1,
    secondCpu: false,
    ramGb: 0,
    psuWatts: 0,
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
  },
  completedJobs: {},
  completedBenchmarks: [],
  activeJobs: [],
  queue: [],
  autoRepeatJobId: null,
});

export const getStage = (state: GameState): StageId => {
  if (state.flags.systemStats) return "systemReveal";
  if (state.flags.scheduler) return "scheduler";
  if (state.flags.multiCore || state.hardware.cores > 1) return "multiCore";
  if (state.completedBenchmarks.includes("microBenchmark")) return "singleCpu";
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

export const updateProgressionFlags = (state: GameState): GameState => {
  const totalJobs = Object.values(state.completedJobs).reduce(
    (sum, amount) => sum + (amount ?? 0),
    0,
  );
  const hasMicro = state.completedBenchmarks.includes("microBenchmark");
  const hasParallel = state.completedBenchmarks.includes("parallelismBenchmark");
  const hasMultiCore = state.completedBenchmarks.includes("multiCoreBenchmark");

  return {
    ...state,
    flags: {
      ...state.flags,
      cache: state.flags.cache || totalJobs >= 3,
      autoRepeat: state.flags.autoRepeat || totalJobs >= 6,
      benchmarks:
        state.flags.benchmarks ||
        (totalJobs >= 6 && state.hardware.clockLevel >= 2),
      multiCore: state.flags.multiCore || hasParallel,
      basicQueue: state.flags.basicQueue,
      scheduler: state.flags.scheduler || state.hardware.cores >= 4,
      secondCpu: state.flags.secondCpu || hasMultiCore,
      systemStats: state.flags.systemStats || state.hardware.secondCpu,
    },
  };
};

export const getMilestone = (state: GameState) => {
  if (state.flags.systemStats) return "RAM and power are online.";
  if (state.flags.secondCpu) return "Install the second CPU.";
  if (state.flags.scheduler) return "Complete the multi-core benchmark.";
  if (state.hardware.cores >= 2) return "Reach four cores for the scheduler.";
  if (state.flags.multiCore) return "Add cores for parallel jobs.";
  if (state.completedBenchmarks.includes("microBenchmark")) {
    return "Run the parallelism benchmark.";
  }
  if (state.flags.benchmarks) return "Tune clock/cache for the benchmark.";
  if (state.flags.autoRepeat) return "Buy auto-repeat to reduce restarts.";
  if (state.flags.cache) return "Upgrade cache for structured jobs.";
  return "Finish jobs to unlock cache.";
};
