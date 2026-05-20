import {
  createCpuHardwareState,
  createInitialGameState,
  createRamStickState,
  createSystemState,
  getCacheBits,
  getCacheBytes,
  getClockHz,
  getPsuWatts,
  getRamSpeedMt,
  syncCronSchedules,
} from "./progression";
import { materializeSystem, syncSelectedSystemRuntime } from "./systems";
import type { GameState } from "./types";

export const createRackReadyGameState = (): GameState => {
  const base = createInitialGameState();
  const hardware: GameState["hardware"] = {
    ...base.hardware,
    clockLevel: 4,
    clockHz: getClockHz(4),
    coreClockLevels: {
      1: 4,
      2: 4,
      3: 4,
      4: 4,
    },
    cpus: [
      {
        ...base.hardware.cpus[0]!,
        coreIds: [1, 2, 3, 4],
        cacheLevel: 7,
        cacheBits: 64,
        cacheBytes: getCacheBytes(7),
        cacheSpeedLevel: 3,
        schedulerSlots: 4,
      },
    ],
    cacheLevel: 7,
    cacheBits: 64,
    cacheBytes: getCacheBytes(7),
    cacheSpeedLevel: 3,
    cores: 4,
    schedulerSlots: 4,
    systemSchedulerSlots: 2,
    secondCpu: true,
    ramLevel: 4,
    ramBits: 1024,
    ramBytes: 128,
    ramSpeedLevel: 2,
    ramSpeedMt: 2,
    ramSticks: [1, 2, 3, 4].map((id) => ({
      id,
      level: 1,
      bits: 256,
      bytes: 32,
      speedLevel: 2,
      speedMt: 2,
    })),
    cronScheduleSlots: 1,
    psuLevel: 9,
    psuWatts: 0.86,
  };
  const denseCoreCount = 128;
  const denseClockLevel = 8;
  const denseRamSpeedLevel = 6;
  const denseCoreIds = Array.from(
    { length: denseCoreCount },
    (_, index) => index + 1,
  );
  const denseRamSticks = Array.from({ length: 32 }, (_, index) =>
    createRamStickState(index + 1, 8, denseRamSpeedLevel),
  );
  const denseRamBits = denseRamSticks.reduce((total, stick) => total + stick.bits, 0);
  const denseHardware: GameState["hardware"] = {
    ...hardware,
    clockLevel: denseClockLevel,
    clockHz: getClockHz(denseClockLevel),
    coreClockLevels: Object.fromEntries(
      denseCoreIds.map((coreId) => [coreId, denseClockLevel]),
    ),
    cpus: Array.from({ length: 4 }, (_, index) => {
      const cpuCoreIds = denseCoreIds.slice(index * 32, index * 32 + 32);
      return createCpuHardwareState(index + 1, cpuCoreIds, {
        cacheLevel: 18,
        cacheBits: getCacheBits(18),
        cacheBytes: getCacheBytes(18),
        cacheSpeedLevel: denseClockLevel,
        schedulerSlots: 32,
      });
    }),
    cacheLevel: 18,
    cacheBits: getCacheBits(18),
    cacheBytes: getCacheBytes(18),
    cacheSpeedLevel: denseClockLevel,
    cores: denseCoreCount,
    schedulerSlots: 128,
    systemSchedulerSlots: 24,
    secondCpu: true,
    ramLevel: denseRamSticks.length,
    ramBits: denseRamBits,
    ramBytes: denseRamSticks.reduce((total, stick) => total + stick.bytes, 0),
    ramSpeedLevel: denseRamSpeedLevel,
    ramSpeedMt: getRamSpeedMt(denseRamSpeedLevel),
    ramSticks: denseRamSticks,
    psuLevel: 23,
    psuWatts: getPsuWatts(23),
  };
  const firstSystem = createSystemState(
    1,
    "Rack-Ready Workstation",
    "starterNode",
    hardware,
  );
  const denseSystem = createSystemState(
    2,
    "Dense Compute Node",
    "denseComputeNode",
    denseHardware,
  );
  const state: GameState = {
    ...base,
    resources: {
      credits: 20_000,
      data: 20_000,
    },
    selectedSystemId: 1,
    rack: {
      nextSystemId: 3,
    },
    systems: [firstSystem, denseSystem],
    hardware,
    flags: {
      ...base.flags,
      cache: true,
      benchmarks: true,
      multiCore: true,
      basicQueue: true,
      scheduler: true,
      secondCpu: true,
      systemStats: true,
      cron: true,
      systemCatalog: true,
      customMachineAssembly: false,
    },
    research: {
      completed: [
        "decodeLogic",
        "bitMutation",
        "shiftOperations",
        "byteOperations",
        "cacheMapping",
        "benchmarkHarness",
        "multiCore",
        "localScheduler",
        "ramControl",
        "systemScheduler",
        "systemBus",
        "cronScheduler",
        "systemCatalog",
      ],
    },
    completedTasks: {
      fetchBit: 3,
      decodeBit: 2,
      bitFlip: 4,
      bitShift: 4,
      byteCopy: 2,
      packetCheck: 1,
      tinyChecksum: 1,
      memoryScrub: 1,
      queueCompaction: 1,
      powerTelemetry: 1,
      busMirror: 1,
    },
    completedJobs: {
      fetchBit: 3,
      decodeBit: 2,
      bitFlip: 4,
      bitShift: 4,
      byteCopy: 2,
      packetCheck: 1,
      tinyChecksum: 1,
      memoryScrub: 1,
      queueCompaction: 1,
      powerTelemetry: 1,
      busMirror: 1,
    },
    completedBenchmarks: [
      "microBenchmark",
      "parallelismBenchmark",
      "multiCoreBenchmark",
    ],
    activeTasks: [],
    activeJobs: [],
    cacheResidency: [],
    queue: [],
  };

  return materializeSystem(syncSelectedSystemRuntime(syncCronSchedules(state)), 1);
};
