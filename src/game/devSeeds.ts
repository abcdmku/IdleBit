import {
  bitsToBytes,
  createCpuHardwareState,
  createInitialGameState,
  createRamStickState,
  createSystemState,
  getCacheBits,
  getCacheBytes,
  getCpuClockHz,
  getPsuWatts,
  getRamSpeedMt,
  syncCronSchedules,
  syncHardwarePackages,
  updateProgressionFlags,
} from "./progression";
import { materializeSystem, syncSelectedSystemRuntime } from "./systems";
import type { CpuHardwareState, GameState, RamStickState, ResearchId } from "./types";

export const RACK_READY_SEED_CREDITS = 100_000_000_000_000_000_000;

const getCoreClockLevels = (cpus: CpuHardwareState[]) =>
  Object.fromEntries(
    cpus.flatMap((cpu) => cpu.coreIds.map((coreId) => [coreId, cpu.level])),
  ) as Record<number, number>;

const getRamStickBits = (ramSticks: RamStickState[]) =>
  ramSticks.reduce((total, stick) => total + stick.bits, 0);

const createSeedHardware = (
  baseHardware: GameState["hardware"],
  cpus: CpuHardwareState[],
  ramSticks: RamStickState[],
  template: Partial<GameState["hardware"]>,
): GameState["hardware"] => {
  const coreIds = cpus.flatMap((cpu) => cpu.coreIds);
  const maxCacheCpu = cpus.reduce((best, cpu) =>
    cpu.cacheBits > best.cacheBits ? cpu : best,
  );
  const maxSpeedCpu = cpus.reduce((best, cpu) =>
    cpu.cacheSpeedLevel > best.cacheSpeedLevel ? cpu : best,
  );
  const ramBits = getRamStickBits(ramSticks);
  const ramSpeedLevel =
    ramSticks.length > 0
      ? Math.max(...ramSticks.map((stick) => stick.speedLevel))
      : (template.ramSpeedLevel ?? baseHardware.ramSpeedLevel);
  const hardware: GameState["hardware"] = {
    ...baseHardware,
    ...template,
    cpus,
    cores: coreIds.length,
    clockLevel: Math.max(1, ...cpus.map((cpu) => cpu.level)),
    clockHz: Math.max(
      1,
      ...cpus.map((cpu) => getCpuClockHz(cpu.tierId, cpu.level)),
    ),
    coreClockLevels: getCoreClockLevels(cpus),
    cacheLevel: maxCacheCpu.cacheLevel,
    cacheBits: maxCacheCpu.cacheBits,
    cacheBytes: maxCacheCpu.cacheBytes,
    cacheSpeedLevel: maxSpeedCpu.cacheSpeedLevel,
    schedulerSlots: cpus.reduce((total, cpu) => total + cpu.schedulerSlots, 0),
    secondCpu: cpus.length > 1,
    ramLevel: ramSticks.length,
    ramBits,
    ramBytes: bitsToBytes(ramBits),
    ramSpeedLevel,
    ramSpeedMt: getRamSpeedMt(ramSpeedLevel),
    ramSticks,
  };

  return syncHardwarePackages({
    ...createInitialGameState(),
    hardware,
  }).hardware;
};

export const createRackReadyGameState = (): GameState => {
  const base = createInitialGameState();
  const workstationCpuLevel = 4;
  const workstationCpus = [
    createCpuHardwareState(1, [1, 2], {
      tierId: "hz",
      level: workstationCpuLevel,
      cacheLevel: 7,
      cacheSpeedLevel: 3,
      schedulerSlots: 2,
    }),
    createCpuHardwareState(2, [3, 4], {
      tierId: "hz",
      level: workstationCpuLevel,
      cacheLevel: 7,
      cacheSpeedLevel: 3,
      schedulerSlots: 2,
    }),
  ];
  const workstationRamSticks = [1, 2, 3, 4].map((id) =>
    createRamStickState(id, 1, 2),
  );
  const hardware = createSeedHardware(
    base.hardware,
    workstationCpus,
    workstationRamSticks,
    {
      systemSchedulerSlots: 2,
      cronScheduleSlots: 1,
      psuLevel: 23,
      psuWatts: getPsuWatts(23),
    },
  );
  const denseCoreCount = 128;
  const denseCpuLevel = 8;
  const denseRamSpeedLevel = 6;
  const denseCoreIds = Array.from(
    { length: denseCoreCount },
    (_, index) => index + 1,
  );
  const denseRamSticks = Array.from({ length: 32 }, (_, index) =>
    createRamStickState(index + 1, 8, denseRamSpeedLevel),
  );
  const denseCpus = Array.from({ length: 4 }, (_, index) => {
    const cpuCoreIds = denseCoreIds.slice(index * 32, index * 32 + 32);
    return createCpuHardwareState(index + 1, cpuCoreIds, {
      tierId: "hz",
      level: denseCpuLevel,
      cacheLevel: 18,
      cacheBits: getCacheBits(18),
      cacheBytes: getCacheBytes(18),
      cacheSpeedLevel: denseCpuLevel,
      schedulerSlots: 32,
    });
  });
  const denseHardware = createSeedHardware(hardware, denseCpus, denseRamSticks, {
    systemSchedulerSlots: 24,
    psuLevel: 23,
    psuWatts: getPsuWatts(23),
  });
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
      credits: RACK_READY_SEED_CREDITS,
      data: 1_000_000,
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
      customMachineAssembly: true,
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
        "cpuTierKhz",
        "cpuTierMhz",
        "cpuTierGhz",
        "cpuTierThz",
        "cpuTierPhz",
      ] satisfies ResearchId[],
      clickRateLevel: 0,
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

  return materializeSystem(
    syncSelectedSystemRuntime(updateProgressionFlags(syncCronSchedules(state))),
    1,
  );
};
