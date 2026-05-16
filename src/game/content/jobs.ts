import type { GameState, JobDefinition } from "../types";

const hasBenchmark = (state: GameState, id: JobDefinition["id"]) =>
  state.completedBenchmarks.includes(id);

export const jobDefinitions: JobDefinition[] = [
  {
    id: "bitFlip",
    name: "Bit Flip",
    kind: "job",
    requiredCycles: 40,
    cacheNeedBytes: 0,
    rewardCredits: 6,
    rewardData: 0,
    parallelizable: false,
    repeatable: true,
    requirement: () => true,
  },
  {
    id: "byteCopy",
    name: "Byte Copy",
    kind: "job",
    requiredCycles: 90,
    cacheNeedBytes: 1,
    rewardCredits: 10,
    rewardData: 1,
    parallelizable: false,
    repeatable: true,
    requirement: (state) => (state.completedJobs.bitFlip ?? 0) >= 1,
  },
  {
    id: "packetCheck",
    name: "Packet Check",
    kind: "job",
    requiredCycles: 170,
    cacheNeedBytes: 4,
    rewardCredits: 18,
    rewardData: 1,
    parallelizable: false,
    repeatable: true,
    requirement: (state) => state.flags.cache,
  },
  {
    id: "tinyChecksum",
    name: "Tiny Checksum",
    kind: "job",
    requiredCycles: 260,
    cacheNeedBytes: 8,
    rewardCredits: 28,
    rewardData: 2,
    parallelizable: false,
    repeatable: true,
    requirement: (state) => (state.completedJobs.packetCheck ?? 0) >= 1,
  },
  {
    id: "microBenchmark",
    name: "Micro Benchmark",
    kind: "benchmark",
    requiredCycles: 520,
    cacheNeedBytes: 8,
    rewardCredits: 35,
    rewardData: 4,
    parallelizable: false,
    repeatable: false,
    requirement: (state) =>
      state.flags.benchmarks &&
      !hasBenchmark(state, "microBenchmark") &&
      state.hardware.clockLevel >= 3 &&
      state.hardware.cacheLevel >= 2,
  },
  {
    id: "parallelismBenchmark",
    name: "Parallelism Benchmark",
    kind: "benchmark",
    requiredCycles: 850,
    cacheNeedBytes: 16,
    rewardCredits: 80,
    rewardData: 8,
    parallelizable: false,
    repeatable: false,
    requirement: (state) =>
      hasBenchmark(state, "microBenchmark") &&
      !hasBenchmark(state, "parallelismBenchmark"),
  },
  {
    id: "multiCoreBenchmark",
    name: "Multi-Core Benchmark",
    kind: "benchmark",
    requiredCycles: 1600,
    cacheNeedBytes: 32,
    rewardCredits: 150,
    rewardData: 14,
    parallelizable: true,
    repeatable: false,
    requirement: (state) =>
      state.flags.scheduler &&
      state.hardware.cores >= 4 &&
      !hasBenchmark(state, "multiCoreBenchmark"),
  },
];

export const getJobDefinition = (id: JobDefinition["id"]) => {
  const job = jobDefinitions.find((definition) => definition.id === id);

  if (!job) {
    throw new Error(`Unknown job: ${id}`);
  }

  return job;
};
