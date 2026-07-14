import type {
  Cost,
  CpuHardwareState,
  CpuTierId,
  GameState,
  UpgradeContext,
  UpgradeDefinition,
} from "../types";
import { getGlobalCStateLevel } from "../cState";
import {
  BOOTLOADER_MAX_LEVEL,
  getBootloaderUpgradeCost,
  getGlobalBootloaderLevel,
} from "../bootloader";
import {
  bitsToBytes,
  createCpuHardwareState,
  createRamStickState,
  createRamSticksForLevel,
  getCacheBytes,
  getCacheBits,
  getCpuForCore,
  getCpuHardware,
  getMaxUnlockedRamLevel,
  getRamInstallLevel,
  getUnlockedRamTierDefinitions,
  getCoolingRating,
  getCoreClockLevel,
  getPsuWatts,
  getRamBytes,
  getRamBits,
  getRamSpeedMt,
  syncHardwarePackages,
} from "../progression";
import {
  CPU_TIER_MAX_LEVEL,
  getCStateUpgradeCost,
  getCpuTierPurchaseCost,
  getCpuTierUpgradeCost,
} from "./cpuTiers";
import {
  getRamTierCapacityUpgradeCost,
  getRamTierDefinitionForLevel,
  getRamTierInstallCost,
  getRamTierSpeedUpgradeCost,
} from "./ramTiers";
import { getPsuCapacityUpgradeCost } from "./psu";
import { getCpuSchedulerSlotUpgradeCost } from "./scheduler";
import { cacheCapacityCosts, coreCosts } from "./componentCosts";
import {
  MEMORY_VOLTAGE_MAX_LEVEL,
  getMemoryVoltageCost,
} from "./ramTuning";
import {
  getReservedCacheBits,
  getReservedMemoryBits,
  getSchedulerQueuedCount,
  getSystemSchedulerQueuedCount,
} from "../math";
import { V1_HARDWARE_LIMITS } from "../hardwareLimits";
import { amountPow, type AmountInput } from "../amount";
import {
  combineCostsExact,
  halfRefundExact,
  roundedCost,
  roundedGrowthCost,
  scaleCostsExact,
} from "../exactCosts";

const credits = (value: AmountInput): Cost => roundedCost("credits", value);

const data = (value: AmountInput): Cost => roundedCost("data", value);

const halfRefund = halfRefundExact;

const systemSchedulerSlotCosts = (slotCount: number): Cost[] => [
  roundedGrowthCost("credits", "180", "1.72", slotCount),
  roundedGrowthCost("data", "4", "1.4", slotCount),
];

const deadlockRecoveryCosts = (purchaseCount: number): Cost[] => [
  roundedGrowthCost("credits", "95", "1.7", purchaseCount),
  roundedGrowthCost("data", "24", "1.48", purchaseCount),
];

const cacheSpeedCosts = (tierId: CpuTierId, targetLevel: number): Cost[] =>
  getCpuTierUpgradeCost(tierId, targetLevel);

const ramStickCosts = (targetLevel: number, targetStickCount = 1): Cost[] =>
  multiplyCosts(
    getRamTierInstallCost(targetLevel),
    amountPow(2, Math.max(0, targetStickCount - 1)),
  );

const ramCapacityCosts = (targetLevel: number): Cost[] =>
  getRamTierCapacityUpgradeCost(targetLevel);

const ramSpeedCosts = (targetLevel: number): Cost[] =>
  getRamTierSpeedUpgradeCost(targetLevel);

/**
 * What the player actually paid for a stick: the install at its tier's base
 * level (scaled by the doubling stick-count curve) plus each per-level
 * capacity/speed upgrade bought on it. Refunding half of this can never mint
 * Credits, unlike pricing the sale off the install curve at the upgraded
 * level (F-ECO-1). Sticks upgraded across tier boundaries under-refund
 * (their pre-boundary upgrades are not re-derived), which stays exploit-safe.
 */
const getRamStickPaidCosts = (
  stick: GameState["hardware"]["ramSticks"][number],
  stickCount: number,
): Cost[] => {
  const capacityBaseLevel = getRamTierDefinitionForLevel(
    stick.level,
  ).firstGlobalLevel;
  const speedBaseLevel = getRamTierDefinitionForLevel(
    stick.speedLevel,
  ).firstGlobalLevel;
  const capacityUpgradeCosts = Array.from(
    { length: Math.max(0, stick.level - capacityBaseLevel) },
    (_, index) => capacityBaseLevel + index + 1,
  ).flatMap(ramCapacityCosts);
  const speedUpgradeCosts = Array.from(
    { length: Math.max(0, stick.speedLevel - speedBaseLevel) },
    (_, index) => speedBaseLevel + index + 1,
  ).flatMap(ramSpeedCosts);

  return combineCosts([
    ...ramStickCosts(capacityBaseLevel, stickCount),
    ...capacityUpgradeCosts,
    ...speedUpgradeCosts,
  ]);
};

const getRamInstallLevelForContext = (
  state: GameState,
  context?: UpgradeContext,
) => {
  const existingRamStick = getRamSticks(state)[0];
  if (existingRamStick) {
    return getRamTierDefinitionForLevel(existingRamStick.level).firstGlobalLevel;
  }

  if (!context?.ramTierId) return getRamInstallLevel(state);

  const tier = getUnlockedRamTierDefinitions(state).find(
    (definition) => definition.id === context.ramTierId,
  );

  return tier?.firstGlobalLevel ?? null;
};

const coolingCosts = (purchaseCount: number): Cost[] => [
  roundedGrowthCost("credits", "180", "1.76", purchaseCount),
  roundedGrowthCost("data", "8", "1.38", purchaseCount),
];

const cronIntervalCosts = (purchaseCount: number): Cost[] => [
  roundedGrowthCost("credits", "42", "1.42", purchaseCount),
  roundedGrowthCost("data", "6", "1.18", purchaseCount),
];

const cronScheduleCosts = (purchaseCount: number): Cost[] => [
  roundedGrowthCost("credits", "160", "1.62", purchaseCount),
  roundedGrowthCost("data", "18", "1.36", purchaseCount),
];

const setHardware = (
  state: GameState,
  update: Partial<GameState["hardware"]>,
): GameState => ({
  ...state,
  hardware: { ...state.hardware, ...update },
});

const setCpuHardware = (
  state: GameState,
  cpuId: number,
  update: Partial<GameState["hardware"]["cpus"][number]>,
) => {
  const cpus = state.hardware.cpus.map((cpu) =>
    cpu.id === cpuId ? { ...cpu, ...update } : cpu,
  );
  const maxCacheCpu = cpus.reduce((best, cpu) =>
    cpu.cacheBits > best.cacheBits ? cpu : best,
  );
  const maxSpeedCpu = cpus.reduce((best, cpu) =>
    cpu.cacheSpeedLevel > best.cacheSpeedLevel ? cpu : best,
  );

  return syncHardwarePackages({
    ...state,
    hardware: {
      ...state.hardware,
      cpus,
      cacheLevel: maxCacheCpu.cacheLevel,
      cacheBits: maxCacheCpu.cacheBits,
      cacheBytes: maxCacheCpu.cacheBytes,
      cacheSpeedLevel: maxSpeedCpu.cacheSpeedLevel,
      schedulerSlots: cpus.reduce((total, cpu) => total + cpu.schedulerSlots, 0),
    },
  });
};

const getContextCpuId = (state: GameState, context?: UpgradeContext) =>
  context?.cpuId ??
  (context?.coreId ? getCpuForCore(state, context.coreId).id : undefined) ??
  (context?.coreIds?.[0] ? getCpuForCore(state, context.coreIds[0]).id : undefined) ??
  1;

const getRamSticks = (state: GameState) =>
  state.hardware.ramSticks.length > 0
    ? state.hardware.ramSticks
    : createRamSticksForLevel(
        state.hardware.ramLevel,
        state.hardware.ramSpeedLevel ?? 1,
      );

const getNextRamHardware = (
  state: GameState,
  ramSticks: GameState["hardware"]["ramSticks"],
) => {
  const ramBits = ramSticks.reduce((total, stick) => total + stick.bits, 0);
  const ramSpeedLevel =
    ramSticks.length > 0
      ? Math.max(...ramSticks.map((stick) => stick.speedLevel))
      : (state.hardware.ramSpeedLevel ?? 1);
  const ramSpeedMt =
    ramSticks.length > 0
      ? Math.max(...ramSticks.map((stick) => stick.speedMt))
      : getRamSpeedMt(ramSpeedLevel);

  return {
    ramLevel: ramSticks.length,
    ramBits,
    ramBytes: bitsToBytes(ramBits),
    ramSpeedLevel,
    ramSpeedMt,
    ramSticks,
  };
};

const getRamTargetStickIds = (state: GameState, context?: UpgradeContext) => {
  const sticks = getRamSticks(state);
  const requestedIds =
    context?.ramStickIds && context.ramStickIds.length > 0
      ? context.ramStickIds
      : [context?.ramStickId ?? sticks[0]?.id ?? 1];
  const validIds = new Set(sticks.map((stick) => stick.id));
  const targetIds = Array.from(
    new Set(
      requestedIds.filter(
        (stickId) => Number.isFinite(stickId) && validIds.has(stickId),
      ),
    ),
  );

  return targetIds.length > 0 ? targetIds : sticks[0] ? [sticks[0].id] : [];
};

const getRamTargetSticks = (state: GameState, context?: UpgradeContext) => {
  const targetIds = new Set(getRamTargetStickIds(state, context));
  return getRamSticks(state).filter((stick) => targetIds.has(stick.id));
};

const combineCosts = combineCostsExact;

const multiplyCosts = (costs: Cost[], multiplier: AmountInput) =>
  scaleCostsExact(costs, multiplier);

const getClockTargetCpu = (state: GameState, context?: UpgradeContext) =>
  getCpuHardware(state, getContextCpuId(state, context));

const getClockPurchaseCount = (state: GameState, context?: UpgradeContext) =>
  Math.max(0, getClockTargetCpu(state, context).level - 1);

const getClockUpgradeCost = (state: GameState, context?: UpgradeContext) => {
  const cpu = getClockTargetCpu(state, context);
  if (cpu.level >= CPU_TIER_MAX_LEVEL) return [];
  return multiplyCosts(
    getCpuTierUpgradeCost(cpu.tierId, cpu.level + 1),
    cpu.coreIds.length,
  );
};

const getClockRefund = (state: GameState, context?: UpgradeContext) => {
  const cpu = getClockTargetCpu(state, context);
  return cpu.level > 1
    ? halfRefund(
        multiplyCosts(
          getCpuTierUpgradeCost(cpu.tierId, cpu.level),
          cpu.coreIds.length,
        ),
      )
    : [];
};

const getCpuLevelBackfillCosts = (tierId: CpuTierId, level: number) =>
  Array.from({ length: Math.max(0, level - 1) }, (_, index) => index + 2)
    .flatMap((targetLevel) => getCpuTierUpgradeCost(tierId, targetLevel));

const getCacheSpeedBackfillCosts = (cpu: CpuHardwareState) =>
  Array.from(
    { length: Math.max(0, cpu.cacheSpeedLevel - 1) },
    (_, index) => index + 2,
  ).flatMap((targetLevel) => cacheSpeedCosts(cpu.tierId, targetLevel));

const getCorePurchaseCost = (
  cpu: CpuHardwareState,
  corePurchaseCount: number,
) =>
  combineCosts([
    ...coreCosts(corePurchaseCount),
    ...getCpuTierPurchaseCost(cpu.tierId),
    ...getCpuLevelBackfillCosts(cpu.tierId, cpu.level),
    ...getCacheSpeedBackfillCosts(cpu),
  ]);

const getSystemCpuInstallTierId = (state: GameState) =>
  state.hardware.cpus[0]?.tierId ?? "hz";

const baseCpuCost = (state: GameState): Cost[] =>
  getCpuTierPurchaseCost(getSystemCpuInstallTierId(state));

const cpuPackageCost = (state: GameState, targetCpuCount: number): Cost[] =>
  multiplyCosts(
    baseCpuCost(state),
    amountPow(2, Math.max(0, targetCpuCount - 1)),
  );

const matchingCpuCost = (state: GameState, sourceCpuId = 1) => {
  const sourceCpu = getCpuHardware(state, sourceCpuId);
  const costs: Cost[] = getCpuTierPurchaseCost(sourceCpu.tierId);

  for (let coreIndex = 1; coreIndex < sourceCpu.coreIds.length; coreIndex += 1) {
    costs.push(...coreCosts(coreIndex - 1));
    costs.push(...getCpuTierPurchaseCost(sourceCpu.tierId));
  }

  for (let level = 1; level < sourceCpu.cacheLevel; level += 1) {
    costs.push(...cacheCapacityCosts(level - 1));
  }

  for (let level = 1; level < sourceCpu.cacheSpeedLevel; level += 1) {
    costs.push(
      ...multiplyCosts(
        cacheSpeedCosts(sourceCpu.tierId, level + 1),
        sourceCpu.coreIds.length,
      ),
    );
  }

  for (let slot = 0; slot < sourceCpu.schedulerSlots; slot += 1) {
    costs.push(...getCpuSchedulerSlotUpgradeCost(slot));
  }

  for (const sourceCoreId of sourceCpu.coreIds) {
    const clockLevel = getCoreClockLevel(state, sourceCoreId);
    for (let level = 1; level < clockLevel; level += 1) {
      costs.push(...getCpuTierUpgradeCost(sourceCpu.tierId, level + 1));
    }
  }

  return combineCosts(costs);
};

const installCpuPackage = (
  state: GameState,
) => {
  if (state.hardware.cpus.length >= V1_HARDWARE_LIMITS.cpuPackages) return state;
  const tierId = getSystemCpuInstallTierId(state);
  const nextCpuId = Math.max(0, ...state.hardware.cpus.map((cpu) => cpu.id)) + 1;
  const firstCoreId =
    Math.max(0, ...state.hardware.cpus.flatMap((cpu) => cpu.coreIds)) + 1;
  const coreIds = [firstCoreId];
  const nextCpu = createCpuHardwareState(nextCpuId, coreIds, {
    tierId,
    level: 1,
  });
  const coreClockLevels = { ...state.hardware.coreClockLevels };

  coreIds.forEach((targetCoreId) => {
    coreClockLevels[targetCoreId] = 1;
  });

  return syncHardwarePackages(
    setHardware(
      {
        ...state,
        flags: { ...state.flags, systemStats: true },
      },
      {
        cpus: [...state.hardware.cpus, nextCpu],
        coreClockLevels,
        secondCpu: true,
        psuLevel: Math.max(1, state.hardware.psuLevel),
        psuWatts: getPsuWatts(Math.max(1, state.hardware.psuLevel)),
      },
    ),
  );
};

const getLastCpuPackage = (state: GameState) =>
  state.hardware.cpus.at(-1) ?? null;

const getCpuPackageDowngradeBlockedReason = (state: GameState) => {
  const removedCpu = getLastCpuPackage(state);
  if (state.hardware.cpus.length <= 1 || !removedCpu) return "Minimum one CPU.";

  const removedCoreIds = new Set(removedCpu.coreIds);
  if (
    state.activeTasks.some((task) =>
      task.assignedCoreIds.some((coreId) => removedCoreIds.has(coreId)),
    )
  ) {
    return `${removedCpu.id === 1 ? "CPU" : `CPU ${removedCpu.id}`} is active.`;
  }
  if (getSchedulerQueuedCount(state, removedCpu.id) > 0) {
    return `${removedCpu.id === 1 ? "CPU" : `CPU ${removedCpu.id}`} has queued work.`;
  }
  if (getReservedCacheBits(state, removedCpu.id) > 0) return "CPU cache in use.";

  return null;
};

const removeLastCpuPackage = (state: GameState) => {
  const removedCpu = getLastCpuPackage(state);
  if (state.hardware.cpus.length <= 1 || !removedCpu) return state;

  const removedCoreIds = new Set(removedCpu.coreIds);
  const coreClockLevels = { ...state.hardware.coreClockLevels };
  removedCoreIds.forEach((coreId) => {
    delete coreClockLevels[coreId];
  });

  return syncHardwarePackages({
    ...state,
    hardware: {
      ...state.hardware,
      cpus: state.hardware.cpus.filter((cpu) => cpu.id !== removedCpu.id),
      coreClockLevels,
      secondCpu: state.hardware.cpus.length - 1 > 1,
    },
  });
};

const count = (
  state: GameState,
  id: UpgradeDefinition["id"],
  context?: UpgradeContext,
) => {
  if (id === "clock") return getClockPurchaseCount(state, context);
  if (id === "cache") return getCpuHardware(state, getContextCpuId(state, context)).cacheLevel - 1;
  if (id === "cacheSpeed") {
    return getCpuHardware(state, getContextCpuId(state, context)).cacheSpeedLevel - 1;
  }
  if (id === "core") {
    return Math.max(
      0,
      getCpuHardware(state, getContextCpuId(state, context)).coreIds.length - 1,
    );
  }
  if (id === "schedulerSlot") {
    return getCpuHardware(state, getContextCpuId(state, context)).schedulerSlots;
  }
  if (id === "systemSchedulerSlot") {
    return state.hardware.systemSchedulerSlots ?? 0;
  }
  if (id === "deadlockRecovery") {
    return state.hardware.deadlockRecoveryLevel ?? 0;
  }
  if (id === "ram") return state.hardware.ramLevel;
  if (id === "ramCapacity") {
    const levels = getRamTargetSticks(state, context).map((stick) => stick.level);
    return levels.length > 0 ? Math.max(0, Math.min(...levels) - 1) : 0;
  }
  if (id === "ramSpeed") {
    const levels = getRamTargetSticks(state, context).map(
      (stick) => stick.speedLevel,
    );
    return levels.length > 0 ? Math.max(0, Math.min(...levels) - 1) : 0;
  }
  if (id === "cronSchedule") return state.hardware.cronScheduleSlots ?? 0;
  if (id === "cronInterval") return state.hardware.cronIntervalLevel ?? 0;
  if (id === "cState") return getGlobalCStateLevel(state);
  if (id === "memoryVoltage") return state.hardware.memoryVoltageLevel ?? 0;
  if (id === "bootloader") return getGlobalBootloaderLevel(state);
  if (id === "psu") return state.hardware.psuLevel;
  if (id === "cooling") return state.hardware.coolingLevel;
  if (id === "secondCpu" || id === "matchedCpu") {
    return Math.max(0, state.hardware.cpus.length - 1);
  }
  if (id === "basicQueue") return state.flags.basicQueue ? 1 : 0;
  if (id === "scheduler") return state.flags.scheduler ? 1 : 0;
  return 0;
};

const getLastCoreId = (state: GameState, context?: UpgradeContext) => {
  const cpu = getCpuHardware(state, getContextCpuId(state, context));
  return cpu.coreIds.at(-1) ?? null;
};

const getCoreDowngradeBlockedReason = (
  state: GameState,
  context?: UpgradeContext,
) => {
  const cpu = getCpuHardware(state, getContextCpuId(state, context));
  if (cpu.coreIds.length <= 1) return "Minimum one core.";

  const removedCoreId = getLastCoreId(state, context);
  if (!removedCoreId) return "Minimum one core.";
  if (state.activeTasks.some((task) => task.assignedCoreIds.includes(removedCoreId))) {
    return `C${removedCoreId} is active.`;
  }
  if ((state.coreSchedulers[removedCoreId]?.localQueue.length ?? 0) > 0) {
    return `C${removedCoreId} has queued work.`;
  }

  return null;
};

const getCacheDowngradeBlockedReason = (
  state: GameState,
  context?: UpgradeContext,
) => {
  const cpuId = getContextCpuId(state, context);
  const cpu = getCpuHardware(state, cpuId);
  if (cpu.cacheLevel <= 1) return "Minimum cache capacity.";

  const nextBits = getCacheBits(cpu.cacheLevel - 1);
  if (getReservedCacheBits(state, cpuId) > nextBits) return "Cache in use.";

  return null;
};

const getRamStickDowngradeBlockedReason = (state: GameState) => {
  const ramSticks = getRamSticks(state);
  if (ramSticks.length <= 1) return "Minimum one RAM stick.";

  const nextBits = ramSticks
    .slice(0, -1)
    .reduce((total, stick) => total + stick.bits, 0);
  if (getReservedMemoryBits(state) > nextBits) return "RAM in use.";

  return null;
};

const getRamCapacityDowngradeBlockedReason = (
  state: GameState,
  context?: UpgradeContext,
) => {
  const targetIds = new Set(getRamTargetStickIds(state, context));
  const ramSticks = getRamSticks(state);
  const canDowngrade = ramSticks.some(
    (stick) => targetIds.has(stick.id) && stick.level > 1,
  );
  if (!canDowngrade) return "Minimum stick capacity.";

  const nextBits = ramSticks.reduce((total, stick) => {
    if (!targetIds.has(stick.id) || stick.level <= 1) return total + stick.bits;
    return total + getRamBits(stick.level - 1);
  }, 0);

  if (getReservedMemoryBits(state) > nextBits) return "RAM in use.";

  return null;
};

const getSchedulerSlotDowngradeBlockedReason = (
  state: GameState,
  context?: UpgradeContext,
) => {
  const cpuId = getContextCpuId(state, context);
  const slots = getCpuHardware(state, cpuId).schedulerSlots;
  if (slots <= 0) return "No queue slots to downgrade.";
  if (getSchedulerQueuedCount(state, cpuId) > slots - 1) {
    return "Scheduler slots in use.";
  }

  return null;
};

const getSystemSchedulerSlotDowngradeBlockedReason = (state: GameState) => {
  const slots = state.hardware.systemSchedulerSlots ?? 0;
  if (slots <= 0) return "No system queue slots to downgrade.";
  if (getSystemSchedulerQueuedCount(state) > slots - 1) {
    return "System scheduler slots in use.";
  }

  return null;
};

export const upgradeDefinitions: UpgradeDefinition[] = [
  {
    id: "clock",
    name: "CPU Level",
    component: "cpu",
    accent: "cyan",
    requirement: (state) =>
      state.hardware.cpus.some((cpu) => cpu.level < CPU_TIER_MAX_LEVEL),
    cost: getClockUpgradeCost,
    buy: (state, context) => {
      const cpu = getClockTargetCpu(state, context);
      if (cpu.level >= CPU_TIER_MAX_LEVEL) return state;
      const level = cpu.level + 1;
      const coreClockLevels = {
        ...state.hardware.coreClockLevels,
        ...Object.fromEntries(cpu.coreIds.map((coreId) => [coreId, level])),
      };

      return syncHardwarePackages({
        ...state,
        hardware: {
          ...state.hardware,
          cpus: state.hardware.cpus.map((item) =>
            item.id === cpu.id ? { ...item, level } : item,
          ),
          coreClockLevels,
        },
      });
    },
    refund: getClockRefund,
    downgrade: (state, context) => {
      const cpu = getClockTargetCpu(state, context);
      if (cpu.level <= 1) return state;
      const level = cpu.level - 1;
      const coreClockLevels = {
        ...state.hardware.coreClockLevels,
        ...Object.fromEntries(cpu.coreIds.map((coreId) => [coreId, level])),
      };

      return syncHardwarePackages({
        ...state,
        hardware: {
          ...state.hardware,
          cpus: state.hardware.cpus.map((item) =>
            item.id === cpu.id ? { ...item, level } : item,
          ),
          coreClockLevels,
        },
      });
    },
  },
  {
    id: "cache",
    name: "Cache",
    component: "cache",
    accent: "green",
    maxPurchases: V1_HARDWARE_LIMITS.cacheLevel - 1,
    requirement: () => true,
    cost: (state, context) => {
      const cpu = getCpuHardware(state, getContextCpuId(state, context));
      return cacheCapacityCosts(cpu.cacheLevel - 1);
    },
    buy: (state, context) => {
      const cpuId = getContextCpuId(state, context);
      const cpu = getCpuHardware(state, cpuId);
      if (cpu.cacheLevel >= V1_HARDWARE_LIMITS.cacheLevel) return state;
      const cacheLevel = cpu.cacheLevel + 1;
      return setCpuHardware(state, cpuId, {
        cacheLevel,
        cacheBits: getCacheBits(cacheLevel),
        cacheBytes: getCacheBytes(cacheLevel),
      });
    },
    refund: (state, context) => {
      const cpu = getCpuHardware(state, getContextCpuId(state, context));
      return cpu.cacheLevel > 1
        ? halfRefund(cacheCapacityCosts(cpu.cacheLevel - 2))
        : [];
    },
    downgradeBlockedReason: getCacheDowngradeBlockedReason,
    downgrade: (state, context) => {
      const cpuId = getContextCpuId(state, context);
      const cpu = getCpuHardware(state, cpuId);
      if (cpu.cacheLevel <= 1) return state;

      const cacheLevel = cpu.cacheLevel - 1;
      return setCpuHardware(state, cpuId, {
        cacheLevel,
        cacheBits: getCacheBits(cacheLevel),
        cacheBytes: getCacheBytes(cacheLevel),
      });
    },
  },
  {
    id: "cacheSpeed",
    name: "Cache Speed",
    component: "cache",
    accent: "green",
    requirement: (state) =>
      state.hardware.cpus.some(
        (cpu) => getCpuHardware(state, cpu.id).cacheSpeedLevel < CPU_TIER_MAX_LEVEL,
      ),
    cost: (state, context) => {
      const cpu = getCpuHardware(state, getContextCpuId(state, context));
      if (cpu.cacheSpeedLevel >= CPU_TIER_MAX_LEVEL) return [];
      return multiplyCosts(
        cacheSpeedCosts(cpu.tierId, cpu.cacheSpeedLevel + 1),
        cpu.coreIds.length,
      );
    },
    buy: (state, context) => {
      const cpuId = getContextCpuId(state, context);
      const cpu = getCpuHardware(state, cpuId);
      if (cpu.cacheSpeedLevel >= CPU_TIER_MAX_LEVEL) return state;

      const cacheSpeedLevel = cpu.cacheSpeedLevel + 1;
      return setCpuHardware(state, cpuId, { cacheSpeedLevel });
    },
    refund: (state, context) => {
      const cpu = getCpuHardware(state, getContextCpuId(state, context));
      return cpu.cacheSpeedLevel > 1
        ? halfRefund(
            multiplyCosts(
              cacheSpeedCosts(cpu.tierId, cpu.cacheSpeedLevel),
              cpu.coreIds.length,
            ),
          )
        : [];
    },
    downgrade: (state, context) => {
      const cpuId = getContextCpuId(state, context);
      const cpu = getCpuHardware(state, cpuId);
      if (cpu.cacheSpeedLevel <= 1) return state;

      return setCpuHardware(state, cpuId, {
        cacheSpeedLevel: cpu.cacheSpeedLevel - 1,
      });
    },
  },
  {
    id: "autoRepeat",
    name: "Auto-Repeat",
    component: "scheduler",
    accent: "violet",
    maxPurchases: 1,
    requirement: () => false,
    cost: () => [credits(64), data(4)],
    buy: (state) => state,
  },
  {
    id: "core",
    name: "Add Core",
    component: "cpu",
    accent: "cyan",
    maxPurchases: V1_HARDWARE_LIMITS.coresPerCpu - 1,
    requirement: (state) => state.flags.multiCore,
    cost: (state, context) => {
      const cpu = getCpuHardware(state, getContextCpuId(state, context));
      return getCorePurchaseCost(cpu, cpu.coreIds.length - 1);
    },
    buy: (state, context) => {
      const cpuId = getContextCpuId(state, context);
      const cpu = getCpuHardware(state, cpuId);
      if (cpu.coreIds.length >= V1_HARDWARE_LIMITS.coresPerCpu) return state;
      const nextCoreId =
        Math.max(0, ...state.hardware.cpus.flatMap((item) => item.coreIds)) + 1;
      return syncHardwarePackages({
        ...state,
        hardware: {
          ...state.hardware,
          cpus: state.hardware.cpus.map((item) =>
            item.id === cpu.id
              ? { ...item, coreIds: [...item.coreIds, nextCoreId] }
              : item,
          ),
          coreClockLevels: {
            ...state.hardware.coreClockLevels,
            [nextCoreId]: cpu.level,
          },
        },
      });
    },
    refund: (state, context) => {
      const cpu = getCpuHardware(state, getContextCpuId(state, context));
      return cpu.coreIds.length > 1
        ? halfRefund(getCorePurchaseCost(cpu, cpu.coreIds.length - 2))
        : [];
    },
    downgradeBlockedReason: getCoreDowngradeBlockedReason,
    downgrade: (state, context) => {
      const cpuId = getContextCpuId(state, context);
      const cpu = getCpuHardware(state, cpuId);
      const removedCoreId = getLastCoreId(state, context);
      if (cpu.coreIds.length <= 1 || !removedCoreId) return state;

      const coreClockLevels = { ...state.hardware.coreClockLevels };
      delete coreClockLevels[removedCoreId];

      return syncHardwarePackages({
        ...state,
        hardware: {
          ...state.hardware,
          cpus: state.hardware.cpus.map((item) =>
            item.id === cpuId
              ? { ...item, coreIds: item.coreIds.filter((id) => id !== removedCoreId) }
              : item,
          ),
          coreClockLevels,
        },
      });
    },
  },
  {
    id: "schedulerSlot",
    name: "CPU Queue Slot",
    component: "scheduler",
    accent: "violet",
    maxPurchases: V1_HARDWARE_LIMITS.cpuQueueSlotsPerCpu,
    requirement: (state) => state.flags.basicQueue || state.flags.scheduler,
    cost: (state, context) => {
      const cpu = getCpuHardware(state, getContextCpuId(state, context));
      return getCpuSchedulerSlotUpgradeCost(cpu.schedulerSlots);
    },
    buy: (state, context) => {
      const cpuId = getContextCpuId(state, context);
      const cpu = getCpuHardware(state, cpuId);
      if (cpu.schedulerSlots >= V1_HARDWARE_LIMITS.cpuQueueSlotsPerCpu) {
        return state;
      }
      return setCpuHardware(state, cpuId, {
        schedulerSlots: cpu.schedulerSlots + 1,
      });
    },
    refund: (state, context) => {
      const cpu = getCpuHardware(state, getContextCpuId(state, context));
      return cpu.schedulerSlots > 0
        ? halfRefund(getCpuSchedulerSlotUpgradeCost(cpu.schedulerSlots - 1))
        : [];
    },
    downgradeBlockedReason: getSchedulerSlotDowngradeBlockedReason,
    downgrade: (state, context) => {
      const cpuId = getContextCpuId(state, context);
      const cpu = getCpuHardware(state, cpuId);
      if (cpu.schedulerSlots <= 0) return state;

      return setCpuHardware(state, cpuId, {
        schedulerSlots: cpu.schedulerSlots - 1,
      });
    },
  },
  {
    id: "systemSchedulerSlot",
    name: "System Queue Slot",
    component: "scheduler",
    accent: "violet",
    maxPurchases: V1_HARDWARE_LIMITS.systemQueueSlots,
    requirement: (state) => state.flags.scheduler,
    cost: (state) =>
      systemSchedulerSlotCosts(state.hardware.systemSchedulerSlots ?? 0),
    buy: (state) => {
      const slots = state.hardware.systemSchedulerSlots ?? 0;
      if (slots >= V1_HARDWARE_LIMITS.systemQueueSlots) return state;
      return setHardware(state, { systemSchedulerSlots: slots + 1 });
    },
    refund: (state) => {
      const slots = state.hardware.systemSchedulerSlots ?? 0;
      return slots > 0 ? halfRefund(systemSchedulerSlotCosts(slots - 1)) : [];
    },
    downgradeBlockedReason: getSystemSchedulerSlotDowngradeBlockedReason,
    downgrade: (state) => {
      const slots = state.hardware.systemSchedulerSlots ?? 0;
      if (slots <= 0) return state;

      return setHardware(state, {
        systemSchedulerSlots: slots - 1,
      });
    },
  },
  {
    id: "deadlockRecovery",
    name: "Deadlock Cooldown",
    component: "scheduler",
    accent: "violet",
    maxPurchases: V1_HARDWARE_LIMITS.deadlockRecoveryLevel,
    requirement: (state) => state.flags.schedulerWatchdog,
    cost: (state) =>
      deadlockRecoveryCosts(Math.max(0, state.hardware.deadlockRecoveryLevel ?? 0)),
    buy: (state) => {
      const level = state.hardware.deadlockRecoveryLevel ?? 0;
      if (level >= V1_HARDWARE_LIMITS.deadlockRecoveryLevel) return state;
      return setHardware(state, { deadlockRecoveryLevel: level + 1 });
    },
    refund: (state) =>
      (state.hardware.deadlockRecoveryLevel ?? 0) > 0
        ? halfRefund(
            deadlockRecoveryCosts((state.hardware.deadlockRecoveryLevel ?? 1) - 1),
          )
        : [],
    downgrade: (state) => {
      const deadlockRecoveryLevel = state.hardware.deadlockRecoveryLevel ?? 0;
      if (deadlockRecoveryLevel <= 0) return state;

      return setHardware(state, {
        deadlockRecoveryLevel: deadlockRecoveryLevel - 1,
      });
    },
  },
  {
    id: "cronSchedule",
    name: "CRON Job Slot",
    component: "cron",
    accent: "violet",
    maxPurchases: 1,
    requirement: (state) =>
      state.flags.cron && (state.hardware.cronScheduleSlots ?? 0) < 1,
    cost: (state) =>
      cronScheduleCosts(Math.max(0, state.hardware.cronScheduleSlots ?? 0)),
    buy: (state) =>
      setHardware(state, {
        cronScheduleSlots: Math.min(
          1,
          (state.hardware.cronScheduleSlots ?? 0) + 1,
        ),
      }),
  },
  {
    id: "cronInterval",
    name: "CRON Interval",
    component: "cron",
    accent: "violet",
    maxPurchases: V1_HARDWARE_LIMITS.cronIntervalLevel,
    requirement: (state) =>
      state.flags.cron &&
      (state.hardware.cronScheduleSlots ?? 0) > 0 &&
      (state.hardware.cronIntervalLevel ?? 0) <
        V1_HARDWARE_LIMITS.cronIntervalLevel,
    cost: (state) => cronIntervalCosts(Math.max(0, state.hardware.cronIntervalLevel ?? 0)),
    buy: (state) =>
      setHardware(state, {
        cronIntervalLevel: Math.min(
          V1_HARDWARE_LIMITS.cronIntervalLevel,
          (state.hardware.cronIntervalLevel ?? 0) + 1,
        ),
      }),
    refund: (state) =>
      (state.hardware.cronIntervalLevel ?? 0) > 0
        ? halfRefund(cronIntervalCosts((state.hardware.cronIntervalLevel ?? 1) - 1))
        : [],
    downgrade: (state) => {
      const cronIntervalLevel = state.hardware.cronIntervalLevel ?? 0;
      if (cronIntervalLevel <= 0) return state;

      return setHardware(state, {
        cronIntervalLevel: cronIntervalLevel - 1,
      });
    },
  },
  {
    id: "basicQueue",
    name: "Local Scheduler",
    component: "scheduler",
    accent: "green",
    maxPurchases: 1,
    requirement: () => false,
    cost: () => [credits(140), data(10)],
    buy: (state) => state,
  },
  {
    id: "scheduler",
    name: "System Scheduler",
    component: "scheduler",
    accent: "violet",
    maxPurchases: 1,
    requirement: () => false,
    cost: () => [credits(320), data(16)],
    buy: (state) => state,
  },
  {
    id: "secondCpu",
    name: "Install CPU",
    component: "socket",
    accent: "cyan",
    maxPurchases: V1_HARDWARE_LIMITS.cpuPackages - 1,
    requirement: (state) => state.flags.secondCpu,
    cost: (state) => cpuPackageCost(state, state.hardware.cpus.length + 1),
    buy: (state) => installCpuPackage(state),
    refund: (state) =>
      state.hardware.cpus.length > 1
        ? halfRefund(cpuPackageCost(state, state.hardware.cpus.length))
        : [],
    downgradeBlockedReason: getCpuPackageDowngradeBlockedReason,
    downgrade: removeLastCpuPackage,
  },
  {
    id: "matchedCpu",
    name: "Matched CPU",
    component: "socket",
    accent: "amber",
    maxPurchases: 1,
    requirement: () => false,
    cost: (state, context) => matchingCpuCost(state, context?.sourceCpuId ?? 1),
    buy: (state) => state,
  },
  {
    id: "ram",
    name: "RAM Stick",
    component: "ram",
    accent: "green",
    maxPurchases: V1_HARDWARE_LIMITS.ramSticks,
    requirement: (state) =>
      state.flags.systemStats || state.research.completed.includes("ramControl"),
    cost: (state, context) => {
      const installLevel = getRamInstallLevelForContext(state, context);
      const targetStickCount = getRamSticks(state).length + 1;
      return installLevel === null
        ? []
        : ramStickCosts(installLevel, targetStickCount);
    },
    buy: (state, context) => {
      const ramSticks = getRamSticks(state);
      if (ramSticks.length >= V1_HARDWARE_LIMITS.ramSticks) return state;
      const installLevel = getRamInstallLevelForContext(state, context);
      if (installLevel === null) return state;

      const nextStick = createRamStickState(
        Math.max(0, ...ramSticks.map((stick) => stick.id)) + 1,
        installLevel,
        installLevel,
      );
      const nextRamSticks = [...ramSticks, nextStick];

      return setHardware(state, {
        ...getNextRamHardware(state, nextRamSticks),
      });
    },
    refund: (state) => {
      const ramSticks = getRamSticks(state);
      const soldStick = ramSticks.at(-1);
      return ramSticks.length > 1 && soldStick
        ? halfRefund(getRamStickPaidCosts(soldStick, ramSticks.length))
        : [];
    },
    downgradeBlockedReason: getRamStickDowngradeBlockedReason,
    downgrade: (state) => {
      const ramSticks = getRamSticks(state);
      if (ramSticks.length <= 1) return state;
      const nextRamSticks = ramSticks.slice(0, -1);

      return setHardware(state, {
        ...getNextRamHardware(state, nextRamSticks),
      });
    },
  },
  {
    id: "ramCapacity",
    name: "RAM Capacity",
    component: "ram",
    accent: "green",
    requirement: (state) =>
      (state.flags.systemStats || state.research.completed.includes("ramControl")) &&
      getRamSticks(state).some((stick) => stick.level < getMaxUnlockedRamLevel(state)),
    cost: (state, context) =>
      combineCosts(
        getRamTargetSticks(state, context).flatMap((stick) =>
          stick.level < getMaxUnlockedRamLevel(state)
            ? ramCapacityCosts(stick.level + 1)
            : [],
        ),
      ),
    buy: (state, context) => {
      const targetIds = new Set(getRamTargetStickIds(state, context));
      const maxLevel = getMaxUnlockedRamLevel(state);
      const nextRamSticks = getRamSticks(state).map((stick) => {
        if (!targetIds.has(stick.id) || stick.level >= maxLevel) return stick;

        const level = stick.level + 1;
        return {
          ...stick,
          level,
          bits: getRamBits(level),
          bytes: getRamBytes(level),
        };
      });

      return setHardware(state, {
        ...getNextRamHardware(state, nextRamSticks),
      });
    },
    refund: (state, context) =>
      combineCosts(
        getRamTargetSticks(state, context).flatMap((stick) =>
          stick.level > 1 ? halfRefund(ramCapacityCosts(stick.level)) : [],
        ),
      ),
    downgradeBlockedReason: getRamCapacityDowngradeBlockedReason,
    downgrade: (state, context) => {
      const targetIds = new Set(getRamTargetStickIds(state, context));
      const nextRamSticks = getRamSticks(state).map((stick) => {
        if (!targetIds.has(stick.id) || stick.level <= 1) return stick;

        const level = stick.level - 1;
        return {
          ...stick,
          level,
          bits: getRamBits(level),
          bytes: getRamBytes(level),
        };
      });

      return setHardware(state, {
        ...getNextRamHardware(state, nextRamSticks),
      });
    },
  },
  {
    id: "ramSpeed",
    name: "RAM Frequency",
    component: "ram",
    accent: "green",
    requirement: (state) =>
      (state.flags.systemStats || state.research.completed.includes("ramControl")) &&
      getRamSticks(state).some(
        (stick) => stick.speedLevel < getMaxUnlockedRamLevel(state),
      ),
    cost: (state, context) =>
      combineCosts(
        getRamTargetSticks(state, context).flatMap((stick) =>
          stick.speedLevel < getMaxUnlockedRamLevel(state)
            ? ramSpeedCosts(stick.speedLevel + 1)
            : [],
        ),
      ),
    buy: (state, context) => {
      const targetIds = new Set(getRamTargetStickIds(state, context));
      const maxLevel = getMaxUnlockedRamLevel(state);
      const nextRamSticks = getRamSticks(state).map((stick) => {
        if (!targetIds.has(stick.id) || stick.speedLevel >= maxLevel) return stick;

        const speedLevel = stick.speedLevel + 1;
        return {
          ...stick,
          speedLevel,
          speedMt: getRamSpeedMt(speedLevel),
        };
      });

      return setHardware(state, {
        ...getNextRamHardware(state, nextRamSticks),
      });
    },
    refund: (state, context) =>
      combineCosts(
        getRamTargetSticks(state, context).flatMap((stick) =>
          stick.speedLevel > 1 ? halfRefund(ramSpeedCosts(stick.speedLevel)) : [],
        ),
      ),
    downgrade: (state, context) => {
      const targetIds = new Set(getRamTargetStickIds(state, context));
      const nextRamSticks = getRamSticks(state).map((stick) => {
        if (!targetIds.has(stick.id) || stick.speedLevel <= 1) return stick;

        const speedLevel = stick.speedLevel - 1;
        return {
          ...stick,
          speedLevel,
          speedMt: getRamSpeedMt(speedLevel),
        };
      });

      return setHardware(state, {
        ...getNextRamHardware(state, nextRamSticks),
      });
    },
  },
  {
    id: "cState",
    name: "C-State",
    component: "cpu",
    accent: "green",
    requirement: (state) =>
      state.flags.cStateControl && getGlobalCStateLevel(state) < CPU_TIER_MAX_LEVEL,
    cost: (state) => getCStateUpgradeCost(getGlobalCStateLevel(state) + 1),
    buy: (state) => {
      const cStateLevel = getGlobalCStateLevel(state);
      return setHardware(state, {
        cStateLevel: Math.min(
          CPU_TIER_MAX_LEVEL,
          cStateLevel + 1,
        ),
      });
    },
    refund: (state) =>
      getGlobalCStateLevel(state) > 0
        ? halfRefund(getCStateUpgradeCost(getGlobalCStateLevel(state)))
        : [],
    downgrade: (state) => {
      const cStateLevel = getGlobalCStateLevel(state);
      if (cStateLevel <= 0) return state;
      return setHardware(state, { cStateLevel: cStateLevel - 1 });
    },
  },
  {
    id: "memoryVoltage",
    name: "Memory Voltage",
    component: "ram",
    accent: "green",
    requirement: (state) =>
      state.flags.memoryVoltageModifier &&
      (state.hardware.memoryVoltageLevel ?? 0) < MEMORY_VOLTAGE_MAX_LEVEL,
    cost: (state) =>
      getMemoryVoltageCost((state.hardware.memoryVoltageLevel ?? 0) + 1),
    buy: (state) =>
      setHardware(state, {
        memoryVoltageLevel: Math.min(
          MEMORY_VOLTAGE_MAX_LEVEL,
          (state.hardware.memoryVoltageLevel ?? 0) + 1,
        ),
      }),
    refund: (state) =>
      (state.hardware.memoryVoltageLevel ?? 0) > 0
        ? halfRefund(getMemoryVoltageCost(state.hardware.memoryVoltageLevel))
        : [],
    downgrade: (state) =>
      setHardware(state, {
        memoryVoltageLevel: Math.max(
          0,
          (state.hardware.memoryVoltageLevel ?? 0) - 1,
        ),
      }),
  },
  {
    id: "bootloader",
    name: "Bootloader",
    component: "psu",
    accent: "amber",
    requirement: (state) =>
      Boolean(state.flags.bootloader) &&
      getGlobalBootloaderLevel(state) < BOOTLOADER_MAX_LEVEL,
    cost: (state) =>
      getBootloaderUpgradeCost(getGlobalBootloaderLevel(state) + 1),
    buy: (state) => {
      const bootloaderLevel = Math.min(
        BOOTLOADER_MAX_LEVEL,
        getGlobalBootloaderLevel(state) + 1,
      );

      return setHardware(state, { bootloaderLevel });
    },
    refund: (state) =>
      getGlobalBootloaderLevel(state) > 0
        ? halfRefund(getBootloaderUpgradeCost(getGlobalBootloaderLevel(state)))
        : [],
    downgrade: (state) =>
      setHardware(state, {
        bootloaderLevel: Math.max(0, getGlobalBootloaderLevel(state) - 1),
      }),
  },
  {
    id: "psu",
    name: "PSU Capacity",
    component: "psu",
    accent: "amber",
    maxPurchases: V1_HARDWARE_LIMITS.psuLevel,
    requirement: () => true,
    cost: (state) => getPsuCapacityUpgradeCost(state.hardware.psuLevel + 1),
    buy: (state) => {
      if (state.hardware.psuLevel >= V1_HARDWARE_LIMITS.psuLevel) return state;
      const psuLevel = state.hardware.psuLevel + 1;
      return setHardware(state, {
        psuLevel,
        psuWatts: getPsuWatts(psuLevel),
      });
    },
    refund: (state) =>
      state.hardware.psuLevel > 1
        ? halfRefund(getPsuCapacityUpgradeCost(state.hardware.psuLevel))
        : [],
    downgrade: (state) => {
      if (state.hardware.psuLevel <= 1) return state;
      const psuLevel = state.hardware.psuLevel - 1;

      return setHardware(state, {
        psuLevel,
        psuWatts: getPsuWatts(psuLevel),
      });
    },
  },
  {
    id: "cooling",
    name: "Cooling Loop",
    component: "thermal",
    accent: "cyan",
    requirement: (state) => state.flags.cooling,
    cost: (state) => coolingCosts(Math.max(0, state.hardware.coolingLevel)),
    buy: (state) => {
      const coolingLevel = state.hardware.coolingLevel + 1;
      return setHardware(state, {
        coolingLevel,
        coolingRating: getCoolingRating(coolingLevel),
      });
    },
    refund: (state) =>
      state.hardware.coolingLevel > 0
        ? halfRefund(coolingCosts(state.hardware.coolingLevel - 1))
        : [],
    downgrade: (state) => {
      if (state.hardware.coolingLevel <= 0) return state;
      const coolingLevel = state.hardware.coolingLevel - 1;

      return setHardware(state, {
        coolingLevel,
        coolingRating: getCoolingRating(coolingLevel),
      });
    },
  },
];

export const getUpgradeDefinition = (id: UpgradeDefinition["id"]) => {
  const upgrade = upgradeDefinitions.find((definition) => definition.id === id);

  if (!upgrade) {
    throw new Error(`Unknown upgrade: ${id}`);
  }

  return upgrade;
};

export const getUpgradeRefund = (
  state: GameState,
  id: UpgradeDefinition["id"],
  context?: UpgradeContext,
) => getUpgradeDefinition(id).refund?.(state, context) ?? [];

export const getUpgradeDowngradeBlockedReason = (
  state: GameState,
  id: UpgradeDefinition["id"],
  context?: UpgradeContext,
) => {
  const upgrade = getUpgradeDefinition(id);
  const refunds = getUpgradeRefund(state, id, context);

  if (!upgrade.downgrade || refunds.length === 0) return null;
  return upgrade.downgradeBlockedReason?.(state, context) ?? null;
};

export const canDowngradeUpgrade = (
  state: GameState,
  id: UpgradeDefinition["id"],
  context?: UpgradeContext,
) =>
  getUpgradeRefund(state, id, context).length > 0 &&
  getUpgradeDowngradeBlockedReason(state, id, context) === null;

export const getUpgradeCount = count;
