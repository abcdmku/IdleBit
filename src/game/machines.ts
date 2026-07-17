import { amountToSafeNumber } from "./amount";
import { deriveSystemCapacityProfile } from "./capacity";
import {
  componentSkus,
  getComponentSku,
  getMachineComponentSkus,
  machineTemplates,
} from "./content/machines";
import {
  bitsToBytes,
  createCpuHardwareState,
  createInitialGameState,
  createRamStickState,
  createSchedulerConfig,
  createSystemState,
  getCacheBits,
  getCacheBytes,
  getCpuClockHz,
  getMaxUnlockedRamLevel,
  getPsuWatts,
  getRamSpeedMt,
  getUnlockedCpuTierDefinitions,
} from "./progression";
import type {
  ComponentSkuDefinition,
  GameState,
  MachineComponentSelection,
  MachinePowerProjection,
  ResearchId,
} from "./types";
import {
  getMachineSelectionBoundsBlockedReason,
  normalizeMachineComponentSelection,
} from "./machineSelection";
import { V1_HARDWARE_LIMITS } from "./hardwareLimits";

export const MACHINE_IDLE_PSU_LOAD_LIMIT = 0.7;
export const MACHINE_PEAK_PSU_LOAD_LIMIT = 0.85;

const distributeCount = (totalCount: number, packageCount: number) => {
  const count = Math.max(1, packageCount);
  const total = Math.max(count, totalCount);
  const perPackage = Math.floor(total / count);
  const remainder = total % count;
  return Array.from(
    { length: count },
    (_, index) => perPackage + (index < remainder ? 1 : 0),
  );
};

const distributeSlots = (slotCount: number, packageCount: number) => {
  const count = Math.max(1, packageCount);
  const total = Math.max(0, Math.trunc(slotCount));
  const perPackage = Math.floor(total / count);
  const remainder = total % count;
  return Array.from(
    { length: count },
    (_, index) => perPackage + (index < remainder ? 1 : 0),
  );
};

export const createHardwareFromMachineSelection = (
  selection: MachineComponentSelection,
): GameState["hardware"] => {
  selection = normalizeMachineComponentSelection(selection);
  const cpu = getComponentSku(selection.cpu);
  const ram = getComponentSku(selection.ram);
  const scheduler = getComponentSku(selection.scheduler);
  const psu = getComponentSku(selection.psu);
  const cpuPackageCount = Math.max(
    1,
    selection.cpuPackageConfigs?.length ?? 0,
    selection.cpuPackageCount ?? cpu.cpuPackageCount ?? 1,
  );
  const schedulerSlots = Math.max(0, scheduler.schedulerSlots ?? 0);
  const cpuTierId = cpu.cpuTierId ?? "hz";
  const fallbackCoreCounts = distributeCount(
    selection.cpuCoreCount ?? (cpu.coreCount ?? 1) * cpuPackageCount,
    cpuPackageCount,
  );
  const fallbackCpuLevel = Math.max(
    1,
    selection.cpuLevel ?? cpu.cpuLevel ?? cpu.clockLevel ?? 1,
  );
  const fallbackCacheLevel = Math.max(
    1,
    selection.cacheLevel ?? cpu.cacheLevel ?? 1,
  );
  const fallbackCacheSpeedLevel = Math.max(
    1,
    selection.cacheSpeedLevel ?? cpu.cacheSpeedLevel ?? 1,
  );
  const cpuPackageConfigs = Array.from({ length: cpuPackageCount }, (_, index) => {
    const config = selection.cpuPackageConfigs?.[index];
    return {
      coreCount: Math.max(1, config?.coreCount ?? fallbackCoreCounts[index] ?? 1),
      cpuLevel: Math.max(1, config?.cpuLevel ?? fallbackCpuLevel),
      cacheLevel: Math.max(1, config?.cacheLevel ?? fallbackCacheLevel),
      cacheSpeedLevel: Math.max(
        1,
        config?.cacheSpeedLevel ?? fallbackCacheSpeedLevel,
      ),
      schedulerSlots:
        config?.schedulerSlots === undefined
          ? undefined
          : Math.max(0, Math.trunc(config.schedulerSlots)),
    };
  });
  const coreCount = cpuPackageConfigs.reduce(
    (total, config) => total + config.coreCount,
    0,
  );
  const packageSchedulerSlots = cpuPackageConfigs.some(
    (config) => config.schedulerSlots !== undefined,
  )
    ? cpuPackageConfigs.map((config) => config.schedulerSlots ?? config.coreCount)
    : null;
  const totalSchedulerSlots =
    selection.cpuSchedulerSlots === undefined
      ? null
      : Math.max(0, Math.trunc(selection.cpuSchedulerSlots));
  const cpuSchedulerSlots =
    packageSchedulerSlots ??
    (totalSchedulerSlots === null
      ? null
      : totalSchedulerSlots === coreCount
        ? cpuPackageConfigs.map((config) => config.coreCount)
        : distributeSlots(totalSchedulerSlots, cpuPackageCount));
  const ramStickCount = Math.max(
    0,
    selection.ramStickCount ?? ram.ramStickCount ?? 0,
  );
  const ramLevel = Math.max(1, selection.ramLevel ?? ram.ramLevel ?? 1);
  const ramSpeedLevel = Math.max(
    1,
    selection.ramSpeedLevel ?? ram.ramSpeedLevel ?? 1,
  );
  const ramSticks = Array.from({ length: ramStickCount }, (_, index) =>
    createRamStickState(index + 1, ramLevel, ramSpeedLevel),
  );
  const ramBits = ramSticks.reduce((total, stick) => total + stick.bits, 0);
  const psuLevel = Math.max(1, psu.psuLevel ?? 1, selection.psuLevel ?? 1);
  let nextCoreId = 1;
  const coreClockLevels: Record<number, number> = {};
  const cpus = cpuPackageConfigs.map((config, index) => {
    const start = nextCoreId;
    nextCoreId += config.coreCount;
    const coreIds = Array.from(
      { length: config.coreCount },
      (_, coreIndex) => start + coreIndex,
    );
    coreIds.forEach((coreId) => {
      coreClockLevels[coreId] = config.cpuLevel;
    });
    return createCpuHardwareState(index + 1, coreIds, {
      cacheLevel: config.cacheLevel,
      cacheSpeedLevel: config.cacheSpeedLevel,
      cacheBits: getCacheBits(config.cacheLevel),
      cacheBytes: getCacheBytes(config.cacheLevel),
      schedulerSlots: Math.max(
        0,
        cpuSchedulerSlots?.[index] ?? cpu.schedulerSlots ?? config.coreCount,
      ),
      tierId: cpuTierId,
      level: config.cpuLevel,
    });
  });
  const cpuLevel = Math.max(1, ...cpuPackageConfigs.map((config) => config.cpuLevel));
  const cacheLevel = Math.max(
    1,
    ...cpuPackageConfigs.map((config) => config.cacheLevel),
  );
  const cacheSpeedLevel = Math.max(
    1,
    ...cpuPackageConfigs.map((config) => config.cacheSpeedLevel),
  );

  return {
    clockLevel: cpuLevel,
    clockHz: getCpuClockHz(cpuTierId, cpuLevel),
    coreClockLevels,
    cpus,
    cacheLevel,
    cacheSpeedLevel,
    cacheBits: getCacheBits(cacheLevel),
    cacheBytes: getCacheBytes(cacheLevel),
    cores: coreCount,
    schedulerSlots: cpus.reduce((total, item) => total + item.schedulerSlots, 0),
    systemSchedulerSlots: schedulerSlots,
    systemSchedulerConfig: createSchedulerConfig(),
    deadlockRecoveryLevel: 0,
    secondCpu: cpuPackageCount > 1,
    ramLevel: ramSticks.length,
    ramBits,
    ramBytes: bitsToBytes(ramBits),
    ramSpeedLevel,
    ramSpeedMt: getRamSpeedMt(ramSpeedLevel),
    ramSticks,
    memoryVoltageLevel: 0,
    bootloaderLevel: 0,
    cronScheduleSlots: 0,
    cronIntervalLevel: 0,
    cStateLevel: 0,
    psuLevel,
    psuWatts: getPsuWatts(psuLevel),
    coolingLevel: 0,
    coolingRating: 0,
  };
};

export const projectMachineSelection = (
  selection: MachineComponentSelection,
): MachinePowerProjection => {
  const hardware = createHardwareFromMachineSelection(selection);
  const base = createInitialGameState();
  const system = createSystemState(1, "Projection", null, hardware);
  const projectionState: GameState = {
    ...base,
    hardware,
    power: system.power,
    systems: [system],
    selectedSystemId: 1,
    flags: {
      ...base.flags,
      systemStats: true,
      psuManagement: true,
    },
    research: {
      ...base.research,
      completed: ["psuManagement"],
    },
  };
  const profile = deriveSystemCapacityProfile(projectionState, 1);
  const idleWatts = amountToSafeNumber(profile.idleWatts);
  const peakWatts = amountToSafeNumber(profile.peakWatts);
  const psuCapacityWatts = hardware.psuWatts;
  const idlePsuLoad = idleWatts / Math.max(Number.EPSILON, psuCapacityWatts);
  const peakPsuLoad = peakWatts / Math.max(Number.EPSILON, psuCapacityWatts);
  return {
    idleWatts,
    peakWatts,
    psuCapacityWatts,
    idlePsuLoad,
    peakPsuLoad,
    powerCostPerSecond: Math.round(peakWatts * 1_000_000 * 1000) / 1000,
    safe:
      idlePsuLoad < MACHINE_IDLE_PSU_LOAD_LIMIT &&
      peakPsuLoad < MACHINE_PEAK_PSU_LOAD_LIMIT,
  };
};

const researchGateMet = (state: GameState, researchId: ResearchId) =>
  researchId === "systemCatalog"
    ? state.flags.systemCatalog || state.research.completed.includes(researchId)
    : state.research.completed.includes(researchId);

export const isAdvancedMachineBuilderUnlocked = (state: GameState) =>
  state.flags.systemCatalog &&
  state.research.completed.includes("customMachineAssembly");

export const isComponentSkuUnlocked = (
  state: GameState,
  sku: (typeof componentSkus)[number] | ComponentSkuDefinition,
) => {
  const catalogSku = componentSkus.find((candidate) => candidate.id === sku.id);
  if (!catalogSku || !researchGateMet(state, catalogSku.unlockResearchId)) {
    return false;
  }
  if (
    catalogSku.type === "cpu" &&
    catalogSku.cpuTierId &&
    !getUnlockedCpuTierDefinitions(state).some(
      (tier) => tier.id === catalogSku.cpuTierId,
    )
  ) {
    return false;
  }
  if (
    catalogSku.type === "ram" &&
    catalogSku.ramLevel &&
    catalogSku.ramLevel > getMaxUnlockedRamLevel(state)
  ) {
    return false;
  }
  return true;
};

export const isMachineSelectionUnlocked = (
  state: GameState,
  selection: MachineComponentSelection,
) => {
  try {
    return getMachineComponentSkus(selection).every((sku) =>
      isComponentSkuUnlocked(state, sku),
    );
  } catch {
    return false;
  }
};

export const isMachineTemplateUnlocked = (
  state: GameState,
  template: (typeof machineTemplates)[number],
) =>
  researchGateMet(state, template.unlockResearchId) &&
  isMachineSelectionUnlocked(state, template.components);

export const getMachineSelectionBlockedReason = (
  state: GameState,
  selection: MachineComponentSelection,
  requireAdvancedBuilder = false,
) => {
  const boundsBlockedReason = getMachineSelectionBoundsBlockedReason(selection);
  if (boundsBlockedReason) return boundsBlockedReason;
  if (requireAdvancedBuilder && !isAdvancedMachineBuilderUnlocked(state)) {
    return "Requires Custom Machine Assembly research.";
  }
  if (!isMachineSelectionUnlocked(state, selection)) {
    return "One or more machine components are not researched.";
  }
  const [cpu, ram, scheduler, psu] = getMachineComponentSkus(selection);
  if (
    (cpu.cpuPackageCount ?? 1) > V1_HARDWARE_LIMITS.cpuPackages ||
    (cpu.coreCount ?? 1) > V1_HARDWARE_LIMITS.coresPerCpu ||
    (ram.ramStickCount ?? 0) > V1_HARDWARE_LIMITS.ramSticks ||
    (scheduler.schedulerSlots ?? 0) > V1_HARDWARE_LIMITS.systemQueueSlots ||
    (psu.psuLevel ?? 1) > V1_HARDWARE_LIMITS.psuLevel
  ) {
    return "One or more machine components exceed the v1 physical hardware limits.";
  }
  const projection = projectMachineSelection(selection);
  if (
    !Number.isFinite(projection.idleWatts) ||
    !Number.isFinite(projection.peakWatts) ||
    projection.psuCapacityWatts <= 0
  ) {
    return "Machine power projection is invalid.";
  }
  return null;
};
