import type {
  Cost,
  GameState,
  UpgradeContext,
  UpgradeDefinition,
} from "../types";
import {
  bitsToBytes,
  createCpuHardwareState,
  createRamStickState,
  createRamSticksForLevel,
  getCacheBytes,
  getCacheBits,
  getClockHz,
  getCpuForCore,
  getCpuHardware,
  getCoolingRating,
  getCoreClockLevel,
  getPsuWatts,
  getRamBytes,
  getRamBits,
  getRamSpeedMt,
  syncHardwarePackages,
} from "../progression";
import {
  getReservedCacheBits,
  getReservedMemoryBits,
  getSchedulerQueuedCount,
  getSystemSchedulerQueuedCount,
} from "../math";

const credits = (amount: number): Cost => ({
  resource: "credits",
  amount: Math.round(amount),
});

const data = (amount: number): Cost => ({
  resource: "data",
  amount: Math.round(amount),
});

const halfRefund = (costs: Cost[]): Cost[] =>
  costs
    .map((cost) => ({
      ...cost,
      amount: Math.floor(cost.amount * 0.5),
    }))
    .filter((cost) => cost.amount > 0);

const clockCosts = (purchaseCount: number): Cost[] => [
  credits(14 * 1.72 ** purchaseCount),
];

const schedulerSlotCosts = (slotCount: number): Cost[] => [
  credits(72 * 1.85 ** slotCount),
  data(5 * 1.42 ** slotCount),
];

const systemSchedulerSlotCosts = (slotCount: number): Cost[] => [
  credits(180 * 1.72 ** slotCount),
  data(12 * 1.5 ** slotCount),
];

const deadlockRecoveryCosts = (purchaseCount: number): Cost[] => [
  credits(95 * 1.7 ** purchaseCount),
  data(24 * 1.48 ** purchaseCount),
];

const cacheCapacityCosts = (purchaseCount: number): Cost[] => [
  credits(3 * 1.45 ** purchaseCount),
  data(6 * 1.78 ** purchaseCount),
];

const cacheSpeedCosts = (purchaseCount: number): Cost[] => [
  credits(2 * 1.38 ** purchaseCount),
  data(5 * 1.64 ** purchaseCount),
];

const ramCapacityCosts = (purchaseCount: number): Cost[] => [
  credits(16 * 1.48 ** purchaseCount),
  data(34 * 1.72 ** purchaseCount),
];

const ramSpeedCosts = (purchaseCount: number): Cost[] => [
  credits(14 * 1.45 ** purchaseCount),
  data(30 * 1.64 ** purchaseCount),
];

const coreCosts = (purchaseCount: number): Cost[] => [
  credits(140 * 2.05 ** purchaseCount),
  data(5 * 1.45 ** purchaseCount),
];

const psuCosts = (purchaseCount: number): Cost[] => [
  credits(130 * 1.9 ** purchaseCount),
  data(5 * 1.3 ** purchaseCount),
];

const coolingCosts = (purchaseCount: number): Cost[] => [
  credits(180 * 1.76 ** purchaseCount),
  data(8 * 1.38 ** purchaseCount),
];

const cronIntervalCosts = (purchaseCount: number): Cost[] => [
  credits(42 * 1.18 ** purchaseCount),
  data(6 * 1.12 ** purchaseCount),
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

const combineCosts = (costs: Cost[]) =>
  (["credits", "data"] as const)
    .map((resource) => ({
      resource,
      amount: costs
        .filter((cost) => cost.resource === resource)
        .reduce((total, cost) => total + cost.amount, 0),
    }))
    .filter((cost) => cost.amount > 0);

const getClockTargetCoreIds = (context?: UpgradeContext) => {
  const coreIds =
    context?.coreIds && context.coreIds.length > 0
      ? context.coreIds
      : [context?.coreId ?? 1];

  const validCoreIds = Array.from(
    new Set(coreIds.filter((coreId) => Number.isFinite(coreId) && coreId > 0)),
  );

  return validCoreIds.length > 0 ? validCoreIds : [1];
};

const getClockPurchaseCount = (state: GameState, context?: UpgradeContext) => {
  const levels = getClockTargetCoreIds(context).map((coreId) =>
    getCoreClockLevel(state, coreId),
  );

  return Math.max(0, Math.min(...levels) - 1);
};

const getClockUpgradeCost = (state: GameState, context?: UpgradeContext) =>
  combineCosts(
    getClockTargetCoreIds(context).flatMap((coreId) =>
      clockCosts(getCoreClockLevel(state, coreId) - 1),
    ),
  );

const getClockRefund = (state: GameState, context?: UpgradeContext) =>
  combineCosts(
    getClockTargetCoreIds(context).flatMap((coreId) => {
      const clockLevel = getCoreClockLevel(state, coreId);
      return clockLevel > 1 ? halfRefund(clockCosts(clockLevel - 2)) : [];
    }),
  );

const matchingCpuCost = (state: GameState, sourceCpuId = 1) => {
  const sourceCpu = getCpuHardware(state, sourceCpuId);
  const costs: Cost[] = [credits(900), data(24)];

  for (let coreIndex = 1; coreIndex < sourceCpu.coreIds.length; coreIndex += 1) {
    costs.push(credits(140 * 2.05 ** (coreIndex - 1)));
    costs.push(data(5 * 1.45 ** (coreIndex - 1)));
  }

  for (let level = 1; level < sourceCpu.cacheLevel; level += 1) {
    costs.push(...cacheCapacityCosts(level - 1));
  }

  for (let level = 1; level < sourceCpu.cacheSpeedLevel; level += 1) {
    costs.push(...cacheSpeedCosts(level - 1));
  }

  for (let slot = 0; slot < sourceCpu.schedulerSlots; slot += 1) {
    costs.push(...schedulerSlotCosts(slot));
  }

  for (const sourceCoreId of sourceCpu.coreIds) {
    const clockLevel = getCoreClockLevel(state, sourceCoreId);
    for (let level = 1; level < clockLevel; level += 1) {
      costs.push(credits(14 * 1.72 ** (level - 1)));
    }
  }

  return combineCosts(costs);
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
  if (id === "cronInterval") return state.hardware.cronIntervalLevel ?? 0;
  if (id === "psu") return state.hardware.psuLevel;
  if (id === "cooling") return state.hardware.coolingLevel;
  if (id === "basicQueue") return state.flags.basicQueue ? 1 : 0;
  if (id === "scheduler") return state.flags.scheduler ? 1 : 0;
  return 0;
};

const recalculateGlobalClock = (
  state: GameState,
  coreClockLevels: Record<number, number>,
) =>
  setHardware(state, {
    clockLevel: Math.max(1, ...Object.values(coreClockLevels)),
    clockHz: getClockHz(Math.max(1, ...Object.values(coreClockLevels))),
    coreClockLevels,
  });

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
  if (getCoreClockLevel(state, removedCoreId) > 1) {
    return `Downgrade C${removedCoreId} clock first.`;
  }
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
    name: "Core Clock",
    component: "cpu",
    accent: "cyan",
    requirement: () => true,
    cost: getClockUpgradeCost,
    buy: (state, context) => {
      const coreClockLevels = { ...state.hardware.coreClockLevels };
      getClockTargetCoreIds(context).forEach((coreId) => {
        coreClockLevels[coreId] = getCoreClockLevel(state, coreId) + 1;
      });
      const maxClockLevel = Math.max(
        state.hardware.clockLevel,
        ...Object.values(coreClockLevels),
      );

      return setHardware(state, {
        clockLevel: maxClockLevel,
        clockHz: getClockHz(maxClockLevel),
        coreClockLevels,
      });
    },
    refund: getClockRefund,
    downgrade: (state, context) => {
      const coreClockLevels = { ...state.hardware.coreClockLevels };
      let downgraded = false;

      getClockTargetCoreIds(context).forEach((coreId) => {
        const clockLevel = getCoreClockLevel(state, coreId);
        if (clockLevel <= 1) return;

        coreClockLevels[coreId] = clockLevel - 1;
        downgraded = true;
      });

      return downgraded ? recalculateGlobalClock(state, coreClockLevels) : state;
    },
  },
  {
    id: "cache",
    name: "Cache",
    component: "cache",
    accent: "green",
    requirement: () => true,
    cost: (state, context) => {
      const cpu = getCpuHardware(state, getContextCpuId(state, context));
      return cacheCapacityCosts(cpu.cacheLevel - 1);
    },
    buy: (state, context) => {
      const cpuId = getContextCpuId(state, context);
      const cacheLevel = getCpuHardware(state, cpuId).cacheLevel + 1;
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
    requirement: () => true,
    cost: (state, context) => {
      const cpu = getCpuHardware(state, getContextCpuId(state, context));
      return cacheSpeedCosts((cpu.cacheSpeedLevel ?? 1) - 1);
    },
    buy: (state, context) => {
      const cpuId = getContextCpuId(state, context);
      const cacheSpeedLevel = (getCpuHardware(state, cpuId).cacheSpeedLevel ?? 1) + 1;
      return setCpuHardware(state, cpuId, { cacheSpeedLevel });
    },
    refund: (state, context) => {
      const cpu = getCpuHardware(state, getContextCpuId(state, context));
      return cpu.cacheSpeedLevel > 1
        ? halfRefund(cacheSpeedCosts(cpu.cacheSpeedLevel - 2))
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
    requirement: (state) => state.flags.multiCore,
    cost: (state, context) => {
      const cpu = getCpuHardware(state, getContextCpuId(state, context));
      return coreCosts(cpu.coreIds.length - 1);
    },
    buy: (state, context) => {
      const cpuId = getContextCpuId(state, context);
      const cpu = getCpuHardware(state, cpuId);
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
            [nextCoreId]: 1,
          },
        },
      });
    },
    refund: (state, context) => {
      const cpu = getCpuHardware(state, getContextCpuId(state, context));
      return cpu.coreIds.length > 1 ? halfRefund(coreCosts(cpu.coreIds.length - 2)) : [];
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
    requirement: (state) => state.flags.basicQueue || state.flags.scheduler,
    cost: (state, context) => {
      const cpu = getCpuHardware(state, getContextCpuId(state, context));
      return schedulerSlotCosts(cpu.schedulerSlots);
    },
    buy: (state, context) => {
      const cpuId = getContextCpuId(state, context);
      const cpu = getCpuHardware(state, cpuId);
      return setCpuHardware(state, cpuId, {
        schedulerSlots: cpu.schedulerSlots + 1,
      });
    },
    refund: (state, context) => {
      const cpu = getCpuHardware(state, getContextCpuId(state, context));
      return cpu.schedulerSlots > 0
        ? halfRefund(schedulerSlotCosts(cpu.schedulerSlots - 1))
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
    requirement: (state) => state.flags.scheduler,
    cost: (state) =>
      systemSchedulerSlotCosts(state.hardware.systemSchedulerSlots ?? 0),
    buy: (state) =>
      setHardware(state, {
        systemSchedulerSlots: (state.hardware.systemSchedulerSlots ?? 0) + 1,
      }),
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
    requirement: (state) => state.flags.schedulerWatchdog,
    cost: (state) =>
      deadlockRecoveryCosts(Math.max(0, state.hardware.deadlockRecoveryLevel ?? 0)),
    buy: (state) =>
      setHardware(state, {
        deadlockRecoveryLevel: (state.hardware.deadlockRecoveryLevel ?? 0) + 1,
      }),
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
    id: "cronInterval",
    name: "CRON Interval",
    component: "cron",
    accent: "violet",
    maxPurchases: 59,
    requirement: (state) =>
      state.flags.cron && (state.hardware.cronIntervalLevel ?? 0) < 59,
    cost: (state) => cronIntervalCosts(Math.max(0, state.hardware.cronIntervalLevel ?? 0)),
    buy: (state) =>
      setHardware(state, {
        cronIntervalLevel: Math.min(59, (state.hardware.cronIntervalLevel ?? 0) + 1),
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
    name: "Matched CPU",
    component: "socket",
    accent: "amber",
    maxPurchases: 1,
    requirement: (state) => state.flags.secondCpu && state.hardware.cpus.length < 2,
    cost: (state, context) => matchingCpuCost(state, context?.sourceCpuId ?? 1),
    buy: (state, context) => {
      const sourceCpu = getCpuHardware(state, context?.sourceCpuId ?? 1);
      const nextCpuId = Math.max(0, ...state.hardware.cpus.map((cpu) => cpu.id)) + 1;
      const firstCoreId =
        Math.max(0, ...state.hardware.cpus.flatMap((cpu) => cpu.coreIds)) + 1;
      const coreIds = sourceCpu.coreIds.map((_, index) => firstCoreId + index);
      const nextCpu = createCpuHardwareState(nextCpuId, coreIds, sourceCpu);
      const coreClockLevels = { ...state.hardware.coreClockLevels };

      sourceCpu.coreIds.forEach((sourceCoreId, index) => {
        const targetCoreId = coreIds[index];
        if (targetCoreId) {
          coreClockLevels[targetCoreId] = getCoreClockLevel(state, sourceCoreId);
        }
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
    },
  },
  {
    id: "ram",
    name: "RAM Stick",
    component: "ram",
    accent: "green",
    requirement: (state) =>
      state.flags.systemStats || state.research.completed.includes("ramControl"),
    cost: (state) => ramCapacityCosts(Math.max(0, getRamSticks(state).length - 1)),
    buy: (state) => {
      const ramSticks = getRamSticks(state);
      const nextStick = createRamStickState(
        Math.max(0, ...ramSticks.map((stick) => stick.id)) + 1,
        1,
        1,
      );
      const nextRamSticks = [...ramSticks, nextStick];

      return setHardware(state, {
        ...getNextRamHardware(state, nextRamSticks),
      });
    },
    refund: (state) =>
      getRamSticks(state).length > 1
        ? halfRefund(ramCapacityCosts(getRamSticks(state).length - 2))
        : [],
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
      state.flags.systemStats || state.research.completed.includes("ramControl"),
    cost: (state, context) =>
      combineCosts(
        getRamTargetSticks(state, context).flatMap((stick) =>
          ramCapacityCosts(stick.level - 1),
        ),
      ),
    buy: (state, context) => {
      const targetIds = new Set(getRamTargetStickIds(state, context));
      const nextRamSticks = getRamSticks(state).map((stick) => {
        if (!targetIds.has(stick.id)) return stick;

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
          stick.level > 1 ? halfRefund(ramCapacityCosts(stick.level - 2)) : [],
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
      state.flags.systemStats || state.research.completed.includes("ramControl"),
    cost: (state, context) =>
      combineCosts(
        getRamTargetSticks(state, context).flatMap((stick) =>
          ramSpeedCosts(stick.speedLevel - 1),
        ),
      ),
    buy: (state, context) => {
      const targetIds = new Set(getRamTargetStickIds(state, context));
      const nextRamSticks = getRamSticks(state).map((stick) => {
        if (!targetIds.has(stick.id)) return stick;

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
          stick.speedLevel > 1 ? halfRefund(ramSpeedCosts(stick.speedLevel - 2)) : [],
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
    id: "psu",
    name: "PSU Capacity",
    component: "psu",
    accent: "amber",
    requirement: (state) => state.flags.psuManagement,
    cost: (state) => psuCosts(Math.max(0, state.hardware.psuLevel - 1)),
    buy: (state) => {
      const psuLevel = state.hardware.psuLevel + 1;
      return setHardware(state, {
        psuLevel,
        psuWatts: getPsuWatts(psuLevel),
      });
    },
    refund: (state) =>
      state.hardware.psuLevel > 1
        ? halfRefund(psuCosts(state.hardware.psuLevel - 2))
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
