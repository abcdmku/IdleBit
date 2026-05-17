import type {
  Cost,
  GameState,
  UpgradeContext,
  UpgradeDefinition,
} from "../types";
import {
  createCpuHardwareState,
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

const credits = (amount: number): Cost => ({
  resource: "credits",
  amount: Math.round(amount),
});

const data = (amount: number): Cost => ({
  resource: "data",
  amount: Math.round(amount),
});

const schedulerSlotCosts = (slotCount: number): Cost[] => [
  credits(72 * 1.85 ** slotCount),
  data(5 * 1.42 ** slotCount),
];

const systemSchedulerSlotCosts = (slotCount: number): Cost[] => [
  credits(180 * 1.72 ** slotCount),
  data(12 * 1.5 ** slotCount),
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
  1;

const combineCosts = (costs: Cost[]) =>
  (["credits", "data"] as const)
    .map((resource) => ({
      resource,
      amount: costs
        .filter((cost) => cost.resource === resource)
        .reduce((total, cost) => total + cost.amount, 0),
    }))
    .filter((cost) => cost.amount > 0);

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
  if (id === "clock") return getCoreClockLevel(state, context?.coreId ?? 1) - 1;
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
  if (id === "ram") return state.hardware.ramLevel;
  if (id === "ramSpeed") return Math.max(0, (state.hardware.ramSpeedLevel ?? 1) - 1);
  if (id === "psu") return state.hardware.psuLevel;
  if (id === "cooling") return state.hardware.coolingLevel;
  if (id === "basicQueue") return state.flags.basicQueue ? 1 : 0;
  if (id === "scheduler") return state.flags.scheduler ? 1 : 0;
  return 0;
};

export const upgradeDefinitions: UpgradeDefinition[] = [
  {
    id: "clock",
    name: "Core Clock",
    component: "cpu",
    accent: "cyan",
    requirement: () => true,
    cost: (state, context) => [
      credits(14 * 1.72 ** (getCoreClockLevel(state, context?.coreId ?? 1) - 1)),
    ],
    buy: (state, context) => {
      const coreId = context?.coreId ?? 1;
      const clockLevel = getCoreClockLevel(state, coreId) + 1;
      const coreClockLevels = {
        ...state.hardware.coreClockLevels,
        [coreId]: clockLevel,
      };
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
      return [
        credits(140 * 2.05 ** (cpu.coreIds.length - 1)),
        data(5 * 1.45 ** (cpu.coreIds.length - 1)),
      ];
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
    name: "RAM Module",
    component: "ram",
    accent: "green",
    requirement: (state) =>
      state.flags.systemStats || state.research.completed.includes("ramControl"),
    cost: (state) => ramCapacityCosts(Math.max(0, state.hardware.ramLevel - 1)),
    buy: (state) => {
      const ramLevel = state.hardware.ramLevel + 1;
      return setHardware(state, {
        ramLevel,
        ramBits: getRamBits(ramLevel),
        ramBytes: getRamBytes(ramLevel),
        ramSpeedMt: getRamSpeedMt(state.hardware.ramSpeedLevel ?? 1),
      });
    },
  },
  {
    id: "ramSpeed",
    name: "RAM Speed",
    component: "ram",
    accent: "green",
    requirement: (state) =>
      state.flags.systemStats || state.research.completed.includes("ramControl"),
    cost: (state) =>
      ramSpeedCosts(Math.max(0, (state.hardware.ramSpeedLevel ?? 1) - 1)),
    buy: (state) => {
      const ramSpeedLevel = (state.hardware.ramSpeedLevel ?? 1) + 1;
      return setHardware(state, {
        ramSpeedLevel,
        ramSpeedMt: getRamSpeedMt(ramSpeedLevel),
      });
    },
  },
  {
    id: "psu",
    name: "PSU Capacity",
    component: "psu",
    accent: "amber",
    requirement: (state) => state.hardware.secondCpu,
    cost: (state) => [
      credits(130 * 1.9 ** Math.max(0, state.hardware.psuLevel - 1)),
      data(5 * 1.3 ** Math.max(0, state.hardware.psuLevel - 1)),
    ],
    buy: (state) => {
      const psuLevel = state.hardware.psuLevel + 1;
      return setHardware(state, {
        psuLevel,
        psuWatts: getPsuWatts(psuLevel),
      });
    },
  },
  {
    id: "cooling",
    name: "Cooling Loop",
    component: "psu",
    accent: "cyan",
    requirement: (state) => state.flags.cooling,
    cost: (state) => [
      credits(180 * 1.76 ** Math.max(0, state.hardware.coolingLevel)),
      data(8 * 1.38 ** Math.max(0, state.hardware.coolingLevel)),
    ],
    buy: (state) => {
      const coolingLevel = state.hardware.coolingLevel + 1;
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

export const getUpgradeCount = count;
