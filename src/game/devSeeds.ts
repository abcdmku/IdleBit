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
import { amountToSafeNumber, exactResourceBag } from "./amount";
import { purchaseAutomationBuffer } from "./automation";
import { updateCampaignProgress } from "./campaign";
import { normalizeCloudState } from "./cloudState";
import {
  commissionFacilityForGameState,
  commissionFacilityRackForGameState,
  placeFleetNodeInFacilityRack,
} from "./facilityInfrastructure";
import {
  commissionCluster,
  normalizeInfrastructureForGameState,
  purchaseAggregateServerBatch,
} from "./fleet";
import { materializeSystem, syncSelectedSystemRuntime } from "./systems";
import type { CpuHardwareState, GameState, RamStickState, ResearchId } from "./types";

export const RACK_READY_SEED_CREDITS = 100_000_000_000_000_000_000;

/**
 * Late-chapter seeds buy the whole Automation Buffer ladder, whose final
 * Global Scheduler level costs exactly 1,000,000 Data — keep plenty of
 * headroom so seed construction never silently fails an exact-cost check.
 */
const LATE_SEED_DATA = 100_000_000;

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

/**
 * Shared final pass for every dev seed: sync cron/flag/system runtime,
 * derive campaign progress from the seeded evidence (never hand-set the
 * chapter), and normalize infrastructure against the seeded systems.
 */
const finalizeSeedState = (state: GameState): GameState =>
  normalizeInfrastructureForGameState(
    updateCampaignProgress(
      materializeSystem(
        syncSelectedSystemRuntime(updateProgressionFlags(syncCronSchedules(state))),
        1,
      ),
    ),
  );

export const createRackReadyGameState = (): GameState => {
  const base = createInitialGameState();
  const exactResources = exactResourceBag(RACK_READY_SEED_CREDITS, 1_000_000);
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
    "Fleet-Ready Workstation",
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
    exactResources,
    resources: {
      credits: amountToSafeNumber(exactResources.credits),
      data: amountToSafeNumber(exactResources.data),
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
        "customMachineAssembly",
        "psuManagement",
        "cpuTierKhz",
        "cpuTierMhz",
        "cpuTierGhz",
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

  return finalizeSeedState(state);
};

const WORKSHOP_SEED_RESEARCH = [
  "thermalControl",
  "specializedCompute",
] satisfies ResearchId[];

const CLOUD_SEED_RESEARCH = [
  ...WORKSHOP_SEED_RESEARCH,
  "clusterControllerResearch",
  "rackControllerResearch",
  "dataCenterNocResearch",
] satisfies ResearchId[];

const PLANETARY_SEED_RESEARCH = [
  ...CLOUD_SEED_RESEARCH,
  "globalSchedulerResearch",
] satisfies ResearchId[];

const withExtraResearch = (
  state: GameState,
  research: readonly ResearchId[],
): GameState => ({
  ...state,
  research: {
    ...state.research,
    completed: Array.from(new Set([...state.research.completed, ...research])),
  },
});

/**
 * The Coherent Machine chapter requires a configured standing order, so late
 * seeds pre-configure the same Fetch Bit order a player would leave running.
 */
const withStandingOrder = (state: GameState): GameState => ({
  ...state,
  standingOrder: {
    taskId: "fetchBit",
    systemId: 1,
    enabled: true,
    renewalCount: 0,
  },
});

/**
 * Workshop-ready: the rack-ready fleet with Thermal Control and Specialized
 * Compute researched, so the Workshop panel (cooling tiers, overclock
 * presets, heat/throttle status, GPU/NPU accelerator slots) is reachable.
 * The campaign sits on the Workshop Fleet specialized-throughput objective
 * so the GPU/NPU proof loop itself stays exercisable.
 */
export const createWorkshopReadyGameState = (): GameState =>
  finalizeSeedState(
    withStandingOrder(
      withExtraResearch(createRackReadyGameState(), WORKSHOP_SEED_RESEARCH),
    ),
  );

/**
 * Marks the Workshop Fleet specialized-throughput proof as already earned:
 * GPU render + NPU inference evidence on the dense node plus the completed
 * Workstation Benchmark.
 */
const withSpecializedThroughputProof = (state: GameState): GameState => ({
  ...state,
  completedBenchmarks: Array.from(
    new Set([...state.completedBenchmarks, "workstationBenchmark"]),
  ),
  systems: state.systems.map((system) =>
    system.id === 2
      ? {
          ...system,
          workshop: {
            ...system.workshop,
            evidence: {
              gpuRenderCompletions: 1,
              npuInferenceCompletions: 1,
            },
          },
        }
      : system,
  ),
});

const AUTOMATION_LADDER_TO_CLUSTER = [
  "localScheduler",
  "cronRuntime",
  "systemScheduler",
  "fleetOrchestrator",
  "clusterController",
] as const;

/**
 * Advances a workshop-proof seed through Local Fabric and Rack and Facility
 * legitimately: buys the Automation Buffer ladder in order, records the
 * replicated-shard-commit proof, then commissions an aggregate fleet node,
 * cluster, facility, and rack with a real managed placement. Ends at the
 * Resilient Cloud chapter awaiting a successful Cloud SLA.
 */
const createLateSeedFoundation = (
  research: readonly ResearchId[],
): GameState => {
  const base = createRackReadyGameState();
  const exactResources = exactResourceBag(RACK_READY_SEED_CREDITS, LATE_SEED_DATA);
  let state = finalizeSeedState(
    withSpecializedThroughputProof(
      withStandingOrder(
        withExtraResearch(
          {
            ...base,
            exactResources,
            resources: {
              credits: amountToSafeNumber(exactResources.credits),
              data: amountToSafeNumber(exactResources.data),
            },
          },
          research,
        ),
      ),
    ),
  );
  // Local Fabric reached; buy the buffer ladder up to Cluster Controller.
  for (const levelId of AUTOMATION_LADDER_TO_CLUSTER) {
    state = purchaseAutomationBuffer(state, levelId);
  }
  // Replicated shard commit proof completes the Local Fabric chapter.
  state = updateCampaignProgress({
    ...state,
    infrastructure: {
      ...state.infrastructure,
      successfulShardCommits: Math.max(
        1,
        state.infrastructure.successfulShardCommits ?? 0,
      ),
      completedWorkloadCounts: {
        ...state.infrastructure.completedWorkloadCounts,
        replicatedShardCommit: Math.max(
          1,
          state.infrastructure.completedWorkloadCounts?.replicatedShardCommit ??
            0,
        ),
      },
    },
  });
  state = purchaseAutomationBuffer(state, "rackController");
  state = purchaseAggregateServerBatch(state, "starterServer", 1);
  state = purchaseAggregateServerBatch(state, "starterServer", 1);
  const aggregateNodeIds = state.infrastructure.fleetNodes
    .filter((node) => node.source.kind === "aggregate")
    .map((node) => node.id);
  state = commissionCluster(state, "Fabric Cluster", aggregateNodeIds);
  const facility = commissionFacilityForGameState(
    state,
    "workshopFacility",
    "Workshop Server Room",
  );
  state = facility.state;
  const rack = commissionFacilityRackForGameState(
    state,
    facility.facilityId ?? "",
    "halfRack",
  );
  state = rack.state;
  state = placeFleetNodeInFacilityRack(
    state,
    facility.facilityId ?? "",
    rack.rackId ?? "",
    aggregateNodeIds[0] ?? "",
  ).state;
  state = purchaseAutomationBuffer(state, "dataCenterNoc");
  return finalizeSeedState(state);
};

/**
 * Cloud-ready: chapter 6 (Resilient Cloud) with racks/facilities owned, a
 * commissioned cluster, and Data Center NOC automation, so the
 * Infrastructure and Cloud panels are reachable and exercisable.
 */
export const createCloudReadyGameState = (): GameState =>
  createLateSeedFoundation(CLOUD_SEED_RESEARCH);

/**
 * A canonical successful Cloud SLA record; normalizeCloudState derives the
 * frozen settlement fields exactly as a live completion would.
 */
const seedCompletedCloudSla = () => ({
  id: "completed-sla-1",
  definitionId: "regionalContinuity",
  succeeded: true,
  rewardBps: 10_000,
  evaluation: {
    availabilityBps: 10_000,
    p95LatencyMs: 50,
    distinctQuorumViolationMs: 0,
    serviceViolationMs: 0,
    deadlineMet: true,
    availabilityMet: true,
    latencyMet: true,
    success: true,
  },
});

/**
 * Planetary-ready: chapter 7 (Planetary Commons) with the Global Scheduler
 * purchased and a successful Cloud SLA on record; the current objective is
 * the planetary finale.
 */
export const createPlanetaryReadyGameState = (): GameState => {
  let state = createLateSeedFoundation(PLANETARY_SEED_RESEARCH);
  state = updateCampaignProgress({
    ...state,
    cloud: normalizeCloudState({
      ...state.cloud,
      completedSlas: [...state.cloud.completedSlas, seedCompletedCloudSla()],
    }),
  });
  state = purchaseAutomationBuffer(state, "globalScheduler");
  return finalizeSeedState(state);
};

export const DEV_SEED_IDS = [
  "rack-ready",
  "workshop-ready",
  "cloud-ready",
  "planetary-ready",
] as const;

export type DevSeedId = (typeof DEV_SEED_IDS)[number];

const devSeedConstructors: Record<DevSeedId, () => GameState> = {
  "rack-ready": createRackReadyGameState,
  "workshop-ready": createWorkshopReadyGameState,
  "cloud-ready": createCloudReadyGameState,
  "planetary-ready": createPlanetaryReadyGameState,
};

/** Dev-only: build the seeded state for a recognized `?seed=` URL value. */
export const createDevSeedGameState = (seedId: DevSeedId): GameState =>
  devSeedConstructors[seedId]();
