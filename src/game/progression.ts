import {
  amount,
  amountToSafeNumber,
  exactResourceBag,
  sumAmounts,
  type Amount,
} from "./amount";
import { createCampaignState } from "./campaign";
import { createContractMarketState } from "./contracts";
import { createCloudState } from "./cloudState";
import { createLiveOperationsState } from "./liveOperations";
import { createInfrastructureState } from "./fleet";
import { hasResearch } from "./content/research";
import {
  cpuTierDefinitions,
  getCpuTierDefinition,
  getCpuTierLevelDefinition,
} from "./content/cpuTiers";
import {
  RAM_MAX_LEVEL,
  ramTierDefinitions,
  getRamTierDefinition,
  getRamTierFirstGlobalLevel,
  getRamTierLevelDefinition,
} from "./content/ramTiers";
import type {
  CronIntervalMode,
  CronScheduleState,
  CpuHardwareState,
  CpuTierId,
  CoreSchedulerState,
  GameState,
  OperationRuntimeStatus,
  RamStickState,
  SchedulerConfig,
  StageId,
  SystemState,
} from "./types";
import { createRngState } from "./rng";
import { createProjectsState } from "./projects";
import { createWorkshopSystemState } from "./workshopState";
import { bitsToBytes } from "./units";
import { V1_HARDWARE_LIMITS, clampFiniteInteger } from "./hardwareLimits";

export { bitsToBytes } from "./units";

export const getClockHz = (level: number) =>
  Math.round(1 * 1.45 ** (level - 1) * 10) / 10;

export const getCpuClockHz = (tierId: CpuTierId, level: number) =>
  getCpuTierLevelDefinition(tierId, level).clockHz;

export const getCpuEfficiency = (tierId: CpuTierId, level: number) =>
  getCpuTierLevelDefinition(tierId, level).efficiency;

/**
 * Multi-socket efficiency penalty (designer ruling 2026-07-11, review finding
 * C-DES-8): the multisocket wall is intentional, but its magnitude mirrors
 * real hardware rarity — dual-socket boards are common (mild penalty),
 * quad-socket rare (noticeably costly), oct-socket exotic (severe). The
 * multiplier still applies to every installed package's efficiency; only the
 * schedule changed (previously a flat 0.75^(sockets-1)). Index is
 * socketCount - 1; counts past the table clamp to the last entry.
 */
export const CPU_SOCKET_EFFICIENCY_SCHEDULE = [
  1, 0.95, 0.88, 0.8, 0.72, 0.68, 0.6, 0.55,
] as const;

export const getCpuSocketEfficiencyMultiplier = (socketCount: number) =>
  CPU_SOCKET_EFFICIENCY_SCHEDULE[
    Math.max(
      0,
      Math.min(CPU_SOCKET_EFFICIENCY_SCHEDULE.length - 1, socketCount - 1),
    )
  ];

export const getCpuPackageEfficiencyMultiplier = (state: GameState) =>
  getCpuSocketEfficiencyMultiplier(state.hardware.cpus.length);

export const getEffectiveCpuEfficiency = (
  state: GameState,
  tierId: CpuTierId,
  level: number,
) => getCpuEfficiency(tierId, level) * getCpuPackageEfficiencyMultiplier(state);

export const getUnlockedCpuTierDefinitions = (state: GameState) =>
  cpuTierDefinitions.filter(
    (tier) => tier.unlockResearchId === null || hasResearch(state, tier.unlockResearchId),
  );

export const getUnlockedRamTierDefinitions = (state: GameState) =>
  ramTierDefinitions.filter(
    (tier) => tier.unlockResearchId === null || hasResearch(state, tier.unlockResearchId),
  );

export const getHighestUnlockedCpuTierDefinition = (state: GameState) => {
  const tiers = getUnlockedCpuTierDefinitions(state);
  return tiers.at(-1) ?? getCpuTierDefinition("hz");
};

export const getHighestUnlockedRamTierDefinition = (state: GameState) => {
  const tiers = getUnlockedRamTierDefinitions(state);
  return tiers.at(-1) ?? getRamTierDefinition("hz");
};

export const getMaxUnlockedRamLevel = (state: GameState) => {
  const tier = getHighestUnlockedRamTierDefinition(state);
  return tier.firstGlobalLevel + tier.levels.length - 1;
};

export const getRamInstallLevel = (state: GameState) =>
  getRamTierFirstGlobalLevel(getHighestUnlockedRamTierDefinition(state).id);

export const getCoreClockLevel = (state: GameState, coreId: number) =>
  getCpuForCore(state, coreId).level;

export const getCoreClockHz = (state: GameState, coreId: number) => {
  const cpu = getCpuForCore(state, coreId);
  return getCpuClockHz(cpu.tierId, cpu.level);
};

export const getCacheBits = (level: number) => 2 ** (level - 1);

export const getCacheSpeedMultiplier = (level: number) =>
  Math.round(1.55 ** (level - 1) * 100) / 100;

export const getCacheBytes = (level: number) => bitsToBytes(getCacheBits(level));

export const getRamBits = (level: number) =>
  level <= 0 ? 0 : getRamTierLevelDefinition(level).capacityBits;

export const getRamBytes = (level: number) => bitsToBytes(getRamBits(level));

export const getRamSpeedMt = (level: number) =>
  level <= 0 ? 1 : getRamTierLevelDefinition(level).clockHz;

export const POWER_BOOTSTRAP_GRACE_SECONDS = 60;
export const POWER_UNPAID_SHUTDOWN_WARNING_SECONDS = 10;

export const createRamStickState = (
  id: number,
  level: number,
  speedLevel = 1,
): RamStickState => {
  const boundedLevel = Math.max(1, Math.min(RAM_MAX_LEVEL, Math.trunc(level)));
  const boundedSpeedLevel = Math.max(
    1,
    Math.min(RAM_MAX_LEVEL, Math.trunc(speedLevel)),
  );

  return {
    id,
    level: boundedLevel,
    bits: getRamBits(boundedLevel),
    bytes: getRamBytes(boundedLevel),
    speedLevel: boundedSpeedLevel,
    speedMt: getRamSpeedMt(boundedSpeedLevel),
  };
};

export const createRamSticksForLevel = (
  ramLevel: number,
  speedLevel = 1,
): RamStickState[] => {
  if (ramLevel <= 0) return [];

  const stickCount = clampFiniteInteger(
    ramLevel,
    0,
    V1_HARDWARE_LIMITS.ramSticks,
  );
  return Array.from({ length: stickCount }, (_, index) =>
    createRamStickState(index + 1, Math.max(1, index), speedLevel),
  );
};

const normalizeRamSticks = (state: GameState) => {
  const fallbackSpeedLevel = state.hardware.ramSpeedLevel ?? 1;
  const savedSticks = Array.isArray(state.hardware.ramSticks)
    ? state.hardware.ramSticks.slice(0, V1_HARDWARE_LIMITS.ramSticks)
    : [];
  const existing =
    savedSticks.length > 0
      ? savedSticks
      : createRamSticksForLevel(state.hardware.ramLevel, fallbackSpeedLevel);
  const usedIds = new Set<number>();
  let nextId = 1;
  const maximumStickBits = getRamBits(RAM_MAX_LEVEL);

  return existing.map((stick, index) => {
    const level = clampFiniteInteger(stick.level, 1, RAM_MAX_LEVEL, index + 1);
    const speedLevel = clampFiniteInteger(
      stick.speedLevel,
      1,
      RAM_MAX_LEVEL,
      fallbackSpeedLevel,
    );
    const requestedId = clampFiniteInteger(
      stick.id,
      1,
      Number.MAX_SAFE_INTEGER,
      index + 1,
    );
    let id = requestedId;
    while (usedIds.has(id)) {
      while (usedIds.has(nextId)) nextId += 1;
      id = nextId;
    }
    usedIds.add(id);
    nextId = Math.max(nextId, id + 1);
    const fallbackBits = getRamBits(level);
    const bits =
      typeof stick.bits === "number" && Number.isFinite(stick.bits) && stick.bits > 0
        ? Math.min(maximumStickBits, stick.bits)
        : fallbackBits;
    return {
      id,
      level,
      bits,
      bytes: bitsToBytes(bits),
      speedLevel,
      speedMt: getRamSpeedMt(speedLevel),
    };
  });
};

/**
 * Stick capacities legally reach 2^73 bits, where a Number sum silently drops
 * small sticks (2^73 + 256 === 2^73 in doubles). Aggregate installed capacity
 * as an exact integer Amount; legacy Number surfaces project from it.
 */
export const getExactRamCapacityBits = (
  sticks: readonly Pick<RamStickState, "bits">[],
): Amount => sumAmounts(sticks.map((stick) => amount(stick.bits)));

export const STARTER_PSU_WATTS = 0.00001;

export const getPsuWatts = (level: number) =>
  level <= 0 ? 0 : Math.round(STARTER_PSU_WATTS * 1.7 ** (level - 1) * 1e12) / 1e12;

export const getCoolingRating = (level: number) =>
  level <= 0 ? 0 : Math.round((1 + (level - 1) * 0.28) * 100) / 100;

export const getCronMinIntervalSeconds = (state: GameState) =>
  Math.max(1, 60 - Math.max(0, state.hardware.cronIntervalLevel ?? 0));

export const getCronIntervalSeconds = (
  state: GameState,
  mode: CronIntervalMode,
  value: number,
) => {
  const minSeconds = getCronMinIntervalSeconds(state);
  const safeValue = Number.isFinite(value) ? value : minSeconds;

  if (mode === "minutes") {
    return Math.max(60, Math.min(3600, Math.round(safeValue) * 60));
  }

  return Math.max(minSeconds, Math.min(120, Math.round(safeValue)));
};

export const createCronScheduleState = (
  id: number,
  state: GameState,
  template?: Partial<CronScheduleState>,
): CronScheduleState => {
  const taskId = template?.taskId ?? null;
  const intervalMode = template?.intervalMode ?? "seconds";
  const intervalValue =
    template?.intervalValue ?? getCronMinIntervalSeconds(state);
  const intervalSeconds = getCronIntervalSeconds(
    state,
    intervalMode,
    intervalValue,
  );

  return {
    id,
    taskId,
    enabled: (template?.enabled ?? taskId !== null) && taskId !== null,
    intervalMode,
    intervalValue:
      intervalMode === "minutes"
        ? Math.max(1, Math.min(60, Math.round(intervalValue)))
        : intervalSeconds,
    remainingSeconds:
      template?.remainingSeconds === undefined
        ? intervalSeconds
        : Math.max(0, Math.min(template.remainingSeconds, intervalSeconds)),
    lastResult: template?.lastResult ?? null,
  };
};

export const getCronScheduleSlotCount = (state: GameState) =>
  hasResearch(state, "cronScheduler") || state.flags.cron
    ? Math.max(0, state.hardware.cronScheduleSlots ?? 0)
    : 0;

export const syncCronSchedules = (state: GameState): GameState => {
  const slotCount = getCronScheduleSlotCount(state);
  const existing = state.cron?.schedules ?? [];
  const schedules = Array.from({ length: slotCount }, (_, index) => {
    const existingSchedule = existing[index];
    return createCronScheduleState(
      existingSchedule?.id ?? index + 1,
      state,
      existingSchedule,
    );
  });
  const nextScheduleId = Math.max(
    slotCount + 1,
    state.cron?.nextScheduleId ?? slotCount + 1,
    ...schedules.map((schedule) => schedule.id + 1),
  );

  return {
    ...state,
    cron: {
      schedules,
      nextScheduleId,
      queuePowerSpikeSeconds: Math.max(
        0,
        state.cron?.queuePowerSpikeSeconds ?? 0,
      ),
    },
  };
};

export const createSchedulerConfig = (
  template?: Partial<SchedulerConfig>,
): SchedulerConfig => {
  const normalizeResourcePriority = (
    value: string | undefined,
  ): SchedulerConfig["ramPriority"] =>
    value === "speed" || value === "capacity" || value === "parallelism"
      ? value
      : "parallelism";

  return {
    ramPriority: normalizeResourcePriority(template?.ramPriority),
    cpuPriority: normalizeResourcePriority(template?.cpuPriority),
    autoKillEnabled: template?.autoKillEnabled ?? false,
    killPolicy: template?.killPolicy ?? "deadlockedTask",
  };
};

export const createCpuHardwareState = (
  id: number,
  coreIds: number[],
  template?: Partial<Omit<CpuHardwareState, "id" | "coreIds">>,
): CpuHardwareState => {
  const tierId: CpuTierId =
    template?.tierId === "khz" ||
    template?.tierId === "mhz" ||
    template?.tierId === "ghz"
      ? template.tierId
      : "hz";
  const level = clampFiniteInteger(
    template?.level,
    1,
    V1_HARDWARE_LIMITS.cpuLevel,
    1,
  );
  const cacheLevel = clampFiniteInteger(
    template?.cacheLevel,
    1,
    V1_HARDWARE_LIMITS.cacheLevel,
    1,
  );
  const cacheSpeedLevel = clampFiniteInteger(
    template?.cacheSpeedLevel,
    1,
    V1_HARDWARE_LIMITS.cacheSpeedLevel,
    1,
  );
  const normalizedCoreIds = Array.from(
    new Set(
      (Array.isArray(coreIds) ? coreIds : [])
        .slice(0, V1_HARDWARE_LIMITS.coresPerCpu)
        .map((coreId) =>
          clampFiniteInteger(coreId, 1, Number.MAX_SAFE_INTEGER, 1),
        ),
    ),
  );
  const boundedCoreIds = normalizedCoreIds.length > 0 ? normalizedCoreIds : [1];
  const maximumCacheBits = getCacheBits(V1_HARDWARE_LIMITS.cacheLevel);
  const derivedCacheBits = getCacheBits(cacheLevel);
  const cacheBits =
    typeof template?.cacheBits === "number" &&
    Number.isFinite(template.cacheBits) &&
    template.cacheBits > 0
      ? Math.min(maximumCacheBits, template.cacheBits)
      : derivedCacheBits;

  return {
    id: clampFiniteInteger(id, 1, Number.MAX_SAFE_INTEGER, 1),
    tierId,
    level,
    coreIds: boundedCoreIds,
    cacheLevel,
    cacheSpeedLevel,
    cacheBits,
    cacheBytes: bitsToBytes(cacheBits),
    schedulerSlots: clampFiniteInteger(
      template?.schedulerSlots,
      0,
      V1_HARDWARE_LIMITS.cpuQueueSlotsPerCpu,
      0,
    ),
    schedulerConfig: createSchedulerConfig(template?.schedulerConfig),
  };
};

/**
 * getCpuHardware/getCpuForCore run per core inside per-tick hot loops (power
 * draw, thermal advance, event math). Rebuilding a normalized CPU object on
 * every call made those paths O(cores^2) with heavy allocation, so the
 * normalized lookup is built once per hardware snapshot and cached by the
 * hardware object's identity. Every input read by the lookup lives under
 * `state.hardware`, and game rules replace `hardware` immutably, so identity
 * keying is exact and the cache never changes observable results.
 */
interface CpuHardwareLookup {
  byId: Map<number, CpuHardwareState>;
  byCoreId: Map<number, CpuHardwareState>;
  fallback: CpuHardwareState;
}

const cpuHardwareLookupCache = new WeakMap<
  GameState["hardware"],
  CpuHardwareLookup
>();

const buildCpuHardwareLookup = (state: GameState): CpuHardwareLookup => {
  const byId = new Map<number, CpuHardwareState>();
  const byCoreId = new Map<number, CpuHardwareState>();
  for (const cpu of state.hardware.cpus) {
    if (!byId.has(cpu.id)) byId.set(cpu.id, normalizeCpuHardware(state, cpu));
  }
  for (const cpu of state.hardware.cpus) {
    // Duplicate package ids resolve to the FIRST package with that id,
    // matching the previous find-by-id semantics.
    const normalized = byId.get(cpu.id);
    if (!normalized) continue;
    for (const coreId of cpu.coreIds) {
      if (!byCoreId.has(coreId)) byCoreId.set(coreId, normalized);
    }
  }
  const fallback =
    state.hardware.cpus.length > 0
      ? (byId.get(state.hardware.cpus[0].id) as CpuHardwareState)
      : normalizeCpuHardware(
          state,
          createCpuHardwareState(1, [1], {
            cacheLevel: state.hardware.cacheLevel,
            cacheSpeedLevel: state.hardware.cacheSpeedLevel,
            cacheBits: state.hardware.cacheBits,
            cacheBytes: state.hardware.cacheBytes,
            schedulerSlots: state.hardware.schedulerSlots,
          }),
        );
  return { byId, byCoreId, fallback };
};

const getCpuHardwareLookup = (state: GameState): CpuHardwareLookup => {
  const cached = cpuHardwareLookupCache.get(state.hardware);
  if (cached) return cached;
  const lookup = buildCpuHardwareLookup(state);
  cpuHardwareLookupCache.set(state.hardware, lookup);
  return lookup;
};

export const getCpuHardware = (state: GameState, cpuId = 1) => {
  const lookup = getCpuHardwareLookup(state);
  return lookup.byId.get(cpuId) ?? lookup.fallback;
};

export const getCpuForCore = (state: GameState, coreId: number) => {
  const lookup = getCpuHardwareLookup(state);
  return lookup.byCoreId.get(coreId) ?? lookup.byId.get(1) ?? lookup.fallback;
};

export const getCpuIdForCore = (state: GameState, coreId: number) =>
  getCpuForCore(state, coreId).id;

export const getAllCoreIds = (state: GameState) => {
  const coreIds = state.hardware.cpus.flatMap((cpu) => cpu.coreIds);
  if (coreIds.length > 0) return coreIds;
  return Array.from({ length: state.hardware.cores }, (_, index) => index + 1);
};

const getSingleCpuCoreIds = (_state: GameState, cpu: CpuHardwareState) =>
  cpu.coreIds.length > 0 ? cpu.coreIds : [1];

const normalizeCpuHardware = (
  state: GameState,
  cpu: CpuHardwareState,
): CpuHardwareState => {
  const legacyCoreLevels = cpu.coreIds
    .map((coreId) => state.hardware.coreClockLevels?.[coreId])
    .filter((level): level is number => typeof level === "number" && Number.isFinite(level));
  const legacyGlobalLevel =
    legacyCoreLevels.length === 0 && state.hardware.cpus.length === 1
      ? (state.hardware.clockLevel ?? 1)
      : 1;
  const legacyLevel = Math.max(
    cpu.level ?? 1,
    ...legacyCoreLevels,
    legacyGlobalLevel,
  );
  const normalizedCpu = { ...cpu, level: legacyLevel };

  if (state.hardware.cpus.length !== 1) {
    return createCpuHardwareState(cpu.id, cpu.coreIds, normalizedCpu);
  }

  return createCpuHardwareState(cpu.id, getSingleCpuCoreIds(state, normalizedCpu), {
    ...normalizedCpu,
    cacheLevel: state.hardware.cacheLevel,
    cacheSpeedLevel: state.hardware.cacheSpeedLevel,
    cacheBits: state.hardware.cacheBits,
    cacheBytes: state.hardware.cacheBytes,
    schedulerSlots: state.hardware.schedulerSlots,
  });
};

/**
 * The synced hardware block is a pure function of `state.hardware` alone, and
 * hardware is updated immutably, so the result is cached by hardware identity.
 * materializeSystem/ensureSystems re-sync the same hardware object many times
 * per tick and per visible-state snapshot; the cache collapses those repeats
 * (and lets the CPU lookup cache above hit on the shared result).
 */
const syncedHardwareCache = new WeakMap<
  GameState["hardware"],
  GameState["hardware"]
>();

export const syncHardwarePackages = (state: GameState): GameState => {
  const cached = syncedHardwareCache.get(state.hardware);
  if (cached) return { ...state, hardware: cached };
  const hardware = computeSyncedHardware(state);
  syncedHardwareCache.set(state.hardware, hardware);
  return { ...state, hardware };
};

const computeSyncedHardware = (state: GameState): GameState["hardware"] => {
  const savedCpus = Array.isArray(state.hardware.cpus)
    ? state.hardware.cpus.slice(0, V1_HARDWARE_LIMITS.cpuPackages)
    : [];
  const existingCpus =
    savedCpus.length > 0
      ? savedCpus
      : [
          createCpuHardwareState(
            1,
            Array.from(
              {
                length: clampFiniteInteger(
                  state.hardware.cores,
                  1,
                  V1_HARDWARE_LIMITS.coresPerCpu,
                  1,
                ),
              },
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
  const boundedCpuState = {
    ...state,
    hardware: { ...state.hardware, cpus: existingCpus },
  };
  const cpus = existingCpus.map((cpu) =>
    normalizeCpuHardware(boundedCpuState, cpu),
  );
  const allCoreIds = cpus.flatMap((cpu) => cpu.coreIds);
  const cores = allCoreIds.length;
  const maxCacheCpu = cpus.reduce((best, cpu) =>
    cpu.cacheBits > best.cacheBits ? cpu : best,
  );
  const maxSpeedCpu = cpus.reduce((best, cpu) =>
    cpu.cacheSpeedLevel > best.cacheSpeedLevel ? cpu : best,
  );
  const ramSticks = normalizeRamSticks(state);
  // Exact aggregation first; the Number field is a projection for legacy
  // surfaces and rounds once (instead of accumulating float error per stick).
  const ramBits = amountToSafeNumber(getExactRamCapacityBits(ramSticks));
  const ramLevel = ramSticks.length;
  const ramSpeedLevel =
    ramSticks.length > 0
      ? Math.max(...ramSticks.map((stick) => stick.speedLevel))
      : (state.hardware.ramSpeedLevel ?? 1);
  const ramSpeedMt =
    ramSticks.length > 0
      ? Math.max(...ramSticks.map((stick) => stick.speedMt))
      : getRamSpeedMt(ramSpeedLevel);
  const clockHz = Math.max(
    1,
    ...cpus.map((cpu) => getCpuClockHz(cpu.tierId, cpu.level)),
  );
  const clockLevel = Math.max(1, ...cpus.map((cpu) => cpu.level));
  const coreClockLevels = Object.fromEntries(
    cpus.flatMap((cpu) => cpu.coreIds.map((coreId) => [coreId, cpu.level])),
  ) as Record<number, number>;

  return {
      ...state.hardware,
      cpus,
      cores,
      clockLevel,
      clockHz,
      coreClockLevels,
      secondCpu: cpus.length > 1,
      cacheLevel: maxCacheCpu.cacheLevel,
      cacheBits: maxCacheCpu.cacheBits,
      cacheBytes: maxCacheCpu.cacheBytes,
      cacheSpeedLevel: maxSpeedCpu.cacheSpeedLevel,
      schedulerSlots: cpus.reduce((total, cpu) => total + cpu.schedulerSlots, 0),
      systemSchedulerSlots: clampFiniteInteger(
        state.hardware.systemSchedulerSlots,
        0,
        V1_HARDWARE_LIMITS.systemQueueSlots,
        0,
      ),
      deadlockRecoveryLevel: clampFiniteInteger(
        state.hardware.deadlockRecoveryLevel,
        0,
        V1_HARDWARE_LIMITS.deadlockRecoveryLevel,
        0,
      ),
      ramLevel,
      ramBits,
      ramBytes: bitsToBytes(ramBits),
      ramSpeedLevel,
      ramSpeedMt,
      ramSticks,
      memoryVoltageLevel: clampFiniteInteger(
        state.hardware.memoryVoltageLevel,
        0,
        V1_HARDWARE_LIMITS.ramTierLevels,
        0,
      ),
      cronScheduleSlots: clampFiniteInteger(
        state.hardware.cronScheduleSlots,
        0,
        1,
        0,
      ),
      cronIntervalLevel: clampFiniteInteger(
        state.hardware.cronIntervalLevel,
        0,
        V1_HARDWARE_LIMITS.cronIntervalLevel,
        0,
      ),
      cStateLevel: clampFiniteInteger(
        state.hardware.cStateLevel,
        0,
        V1_HARDWARE_LIMITS.cpuLevel,
        0,
      ),
      psuLevel: clampFiniteInteger(
        state.hardware.psuLevel,
        1,
        V1_HARDWARE_LIMITS.psuLevel,
        1,
      ),
      psuWatts:
        typeof state.hardware.psuWatts === "number" &&
        Number.isFinite(state.hardware.psuWatts) &&
        state.hardware.psuWatts > 0
          ? Math.min(
              getPsuWatts(V1_HARDWARE_LIMITS.psuLevel),
              state.hardware.psuWatts,
            )
          : getPsuWatts(
              clampFiniteInteger(
                state.hardware.psuLevel,
                1,
                V1_HARDWARE_LIMITS.psuLevel,
                1,
              ),
            ),
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
  localQueueEntries: [],
  progress: 0,
});

export const createCoreSchedulers = (cores: number) =>
  Object.fromEntries(
    Array.from({ length: cores }, (_, index) => {
      const coreId = index + 1;
      return [coreId, createCoreSchedulerState(coreId)];
    }),
  ) as Record<number, CoreSchedulerState>;

const createInitialHardwareState = (): GameState["hardware"] => ({
  clockLevel: 1,
  clockHz: getCpuClockHz("hz", 1),
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
  systemSchedulerConfig: createSchedulerConfig(),
  deadlockRecoveryLevel: 0,
  secondCpu: false,
  ramLevel: 0,
  ramBits: 0,
  ramBytes: 0,
  ramSpeedLevel: 1,
  ramSpeedMt: getRamSpeedMt(1),
  ramSticks: [],
  memoryVoltageLevel: 0,
  bootloaderLevel: 0,
  cronScheduleSlots: 0,
  cronIntervalLevel: 0,
  cStateLevel: 0,
  psuLevel: 1,
  psuWatts: getPsuWatts(1),
  coolingLevel: 0,
  coolingRating: 0,
});

const createInitialPowerState = (): GameState["power"] => ({
  state: "on",
  idlePolicy: "low-power",
  transitionSeconds: 0,
  transitionTotalSeconds: 0,
  bootstrapGraceSeconds: 0,
  unpaidShutdownWarningSeconds: 0,
  overloadFailureSeconds: 0,
  lastFailureReason: null,
  failureCount: 0,
});

const createInitialCronState = (): GameState["cron"] => ({
  schedules: [],
  nextScheduleId: 1,
  queuePowerSpikeSeconds: 0,
});

export const createSystemState = (
  id: number,
  name = `System ${id}`,
  templateId: string | null = null,
  hardware = createInitialHardwareState(),
  purchaseCosts: SystemState["purchaseCosts"] = [],
): SystemState => {
  const workshop = createWorkshopSystemState(hardware);
  return {
    id,
    name,
    templateId,
    hardware,
    workshop,
    power: createInitialPowerState(),
    cron: createInitialCronState(),
    activeTasks: [],
    activeJobs: [],
    cacheResidency: [],
    coreSchedulers: createCoreSchedulers(hardware.cores),
    queue: [],
    queueEntries: [],
    deadlockPressureSeconds: 0,
    deadlockPressureResource: null,
    deadlockPressureCpuId: null,
    deadlockProcessLockout: false,
    purchaseCosts,
  };
};

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

export const isPsuManagementUnlocked = (state: GameState) =>
  state.flags.psuManagement || state.research.completed.includes("psuManagement");

export const createInitialGameState = (): GameState => {
  const firstSystem = createSystemState(1, "Barebones PC", "barebonesPc");
  const exactResources = exactResourceBag(10, 0);

  return {
    version: 7,
    tick: 0,
    advanceRemainderMs: 0,
    nextInstanceId: 1,
    exactResources,
    rng: createRngState(),
    time: {
      lastSavedAtMs: null,
      departedAtMs: null,
    },
    campaign: createCampaignState(),
    contracts: createContractMarketState(),
    projects: createProjectsState(),
    infrastructure: createInfrastructureState([firstSystem.id]),
    cloud: createCloudState(),
    automationBuffer: {
      ownedLevelId: "startingNode",
      departureLevelId: "startingNode",
      offlineProcessedMs: 0,
    },
    standingOrder: {
      taskId: null,
      systemId: null,
      enabled: false,
      renewalCount: 0,
    },
    liveOperations: createLiveOperationsState(),
    lastAdvanceReport: null,
    selectedSystemId: firstSystem.id,
    rack: {
      nextSystemId: 2,
    },
    systems: [firstSystem],
    deadlockPressureSeconds: firstSystem.deadlockPressureSeconds,
    deadlockPressureResource: firstSystem.deadlockPressureResource,
    deadlockPressureCpuId: firstSystem.deadlockPressureCpuId,
    deadlockProcessLockout: firstSystem.deadlockProcessLockout,
    resources: {
      credits: amountToSafeNumber(exactResources.credits),
      data: amountToSafeNumber(exactResources.data),
    },
    hardware: firstSystem.hardware,
    workshop: firstSystem.workshop,
    flags: {
      cache: false,
      autoRepeat: false,
      benchmarks: false,
      multiCore: false,
      basicQueue: false,
      scheduler: false,
      secondCpu: false,
      systemStats: false,
      cron: false,
      systemCatalog: false,
      customMachineAssembly: false,
      psuManagement: false,
      cooling: false,
      specializedCompute: false,
      cStateControl: false,
      dualChannelRam: false,
      quadChannelRam: false,
      octChannelRam: false,
      memoryVoltageModifier: false,
      bootloader: false,
      schedulerWatchdog: false,
    },
    power: firstSystem.power,
    cron: firstSystem.cron,
    research: {
      completed: [],
      clickRateLevel: 0,
    },
    reliability: {
      lastEvent: null,
    },
    completedTasks: {},
    completedJobs: {},
    taskRewardCreditsEarned: {},
    taskWorkCyclesCompleted: {},
    standingTaskCompletions: {},
    standingTaskRewardCreditsEarned: {},
    standingTaskDataEarned: {},
    standingTaskWorkCyclesCompleted: {},
    completedBenchmarks: [],
    activeTasks: firstSystem.activeTasks,
    activeJobs: firstSystem.activeJobs,
    cacheResidency: firstSystem.cacheResidency,
    coreSchedulers: firstSystem.coreSchedulers,
    queue: firstSystem.queue,
    queueEntries: firstSystem.queueEntries,
    autoRepeatJobId: null,
  };
};

export const getStage = (state: GameState): StageId => {
  if (state.flags.systemCatalog || state.systems.length > 1) return "fleet";
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
    primitiveCpu: "Stage 1 - Primitive CPU",
    singleCpu: "Stage 2 - Single CPU",
    multiCore: "Stage 3 - Multi-Core CPU",
    scheduler: "Stage 4 - Scheduler",
    systemReveal: "Stage 5 - System Reveal",
    fleet: "Stage 6 - Fleet",
  };

  return labels[stage];
};

const withCoreSchedulers = (state: GameState): GameState => {
  const syncedState = syncHardwarePackages(state);
  const schedulers = { ...state.coreSchedulers };
  let changed = false;
  const allCoreIds = getAllCoreIds(syncedState);
  const coreIdSet = new Set(allCoreIds);

  for (const coreId of allCoreIds) {
    if (!schedulers[coreId]) {
      schedulers[coreId] = createCoreSchedulerState(coreId);
      changed = true;
    }
  }

  for (const rawCoreId of Object.keys(schedulers)) {
    const coreId = Number(rawCoreId);
    if (!coreIdSet.has(coreId)) {
      delete schedulers[coreId];
      changed = true;
    }
  }

  return changed ? { ...syncedState, coreSchedulers: schedulers } : syncedState;
};

export const syncCoreSchedulers = (state: GameState): GameState => {
  const seeded = withCoreSchedulers(state);
  // Index assignments once instead of scanning every task per core (the
  // per-core find made this O(cores * tasks) on every materialization).
  // First-wins insertion preserves the previous find-by-array-order result.
  type ActiveTaskState = GameState["activeTasks"][number];
  const activeTaskByCoreId = new Map<number, ActiveTaskState>();
  for (const task of seeded.activeTasks) {
    for (const assignedCoreId of task.assignedCoreIds) {
      if (!activeTaskByCoreId.has(assignedCoreId)) {
        activeTaskByCoreId.set(assignedCoreId, task);
      }
    }
  }
  const coreOperationByCoreId = new Map<
    number,
    ActiveTaskState["coreOperations"][number]
  >();
  for (const task of seeded.activeTasks) {
    for (const operation of task.coreOperations) {
      if (
        activeTaskByCoreId.get(operation.coreId) === task &&
        !coreOperationByCoreId.has(operation.coreId)
      ) {
        coreOperationByCoreId.set(operation.coreId, operation);
      }
    }
  }
  const schedulers = Object.fromEntries(
    getAllCoreIds(seeded).map((coreId) => {
      const activeTask = activeTaskByCoreId.get(coreId);
      const coreOperation = coreOperationByCoreId.get(coreId);
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
                amountToSafeNumber(coreOperation.remainingCycles),
                amountToSafeNumber(coreOperation.totalCycles),
                amountToSafeNumber(coreOperation.remainingLoadCycles),
                amountToSafeNumber(coreOperation.totalLoadCycles),
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
      autoRepeat: state.flags.autoRepeat || researched.includes("cronScheduler"),
      benchmarks:
        state.flags.benchmarks || researched.includes("benchmarkHarness"),
      multiCore: state.flags.multiCore || researched.includes("multiCore"),
      basicQueue:
        state.flags.basicQueue || researched.includes("localScheduler"),
      schedulerWatchdog:
        state.flags.schedulerWatchdog || researched.includes("schedulerWatchdog"),
      scheduler:
        state.flags.scheduler || researched.includes("systemScheduler"),
      secondCpu: state.flags.secondCpu || researched.includes("systemBus"),
      systemStats:
        state.flags.systemStats ||
        state.hardware.secondCpu ||
        researched.includes("ramControl"),
      cron: state.flags.cron || researched.includes("cronScheduler"),
      systemCatalog:
        state.flags.systemCatalog || researched.includes("systemCatalog"),
      customMachineAssembly:
        state.flags.customMachineAssembly ||
        researched.includes("customMachineAssembly"),
      psuManagement:
        state.flags.psuManagement || researched.includes("psuManagement"),
      cooling:
        state.flags.cooling || researched.includes("thermalControl"),
      specializedCompute:
        state.flags.specializedCompute ||
        researched.includes("specializedCompute"),
      cStateControl:
        state.flags.cStateControl || researched.includes("cStateControl"),
      dualChannelRam:
        state.flags.dualChannelRam || researched.includes("dualChannelRam"),
      quadChannelRam:
        state.flags.quadChannelRam || researched.includes("quadChannelRam"),
      octChannelRam:
        state.flags.octChannelRam || researched.includes("octChannelRam"),
      memoryVoltageModifier:
        state.flags.memoryVoltageModifier ||
        researched.includes("memoryVoltageModifier"),
      bootloader: state.flags.bootloader || researched.includes("bootloader"),
    },
  };

  return syncCronSchedules(syncCoreSchedulers(nextState));
};

export const getMilestone = (state: GameState) => {
  if (!hasCompleted(state, "byteCopy")) return "Build up from single-bit work.";
  if (!state.flags.cache) return "Research cache mapping.";
  if (!state.flags.benchmarks) return "Research the benchmark harness.";
  if (!hasCompleted(state, "microBenchmark")) return "Tune clock/cache for micro benchmark.";
  if (!state.flags.multiCore) return "Research multi-core control.";
  if (state.hardware.cores < 2) return "Add a second core for local scheduling.";
  if (!hasCompleted(state, "parallelismBenchmark")) {
    return "Run the two-core parallelism benchmark.";
  }
  if (!state.flags.basicQueue) return "Research the local scheduler.";
  if (!state.research.completed.includes("ramControl")) return "Research RAM control.";
  if (state.hardware.ramBits < 1024) return "Upgrade RAM to 1 Kb.";
  if (!state.flags.scheduler) return "Research the system scheduler.";
  if (state.hardware.cores < 4) return "Reach four cores for the system bus benchmark.";
  if (!hasCompleted(state, "multiCoreBenchmark")) {
    return "Complete the multi-core benchmark.";
  }
  if (!state.flags.secondCpu) return "Research the system bus.";
  if (!state.hardware.secondCpu) return "Install the second CPU.";
  if (!state.flags.cron) return "Research CRON scheduler.";
  if (!state.flags.systemCatalog) return "Research the system catalog.";
  if (state.systems.length < 2) return "Add another system to the Fleet.";
  return "Balance Fleet systems under load.";
};
