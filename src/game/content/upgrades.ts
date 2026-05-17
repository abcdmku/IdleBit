import type {
  Cost,
  GameState,
  UpgradeContext,
  UpgradeDefinition,
} from "../types";
import {
  getCacheBytes,
  getCacheBits,
  getClockHz,
  getCoolingRating,
  getCoreClockLevel,
  getPsuWatts,
  getRamBytes,
  getRamBits,
  getRamSpeedMt,
} from "../progression";

const credits = (amount: number): Cost => ({
  resource: "credits",
  amount: Math.round(amount),
});

const data = (amount: number): Cost => ({
  resource: "data",
  amount: Math.round(amount),
});

const setHardware = (
  state: GameState,
  update: Partial<GameState["hardware"]>,
): GameState => ({
  ...state,
  hardware: { ...state.hardware, ...update },
});

const count = (
  state: GameState,
  id: UpgradeDefinition["id"],
  context?: UpgradeContext,
) => {
  if (id === "clock") return getCoreClockLevel(state, context?.coreId ?? 1) - 1;
  if (id === "cache") return state.hardware.cacheLevel - 1;
  if (id === "cacheSpeed") return state.hardware.cacheSpeedLevel - 1;
  if (id === "core") return state.hardware.cores - 1;
  if (id === "schedulerSlot") return state.hardware.schedulerSlots;
  if (id === "ram") return state.hardware.ramLevel;
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
    cost: (state) => [credits(18 * 1.82 ** (state.hardware.cacheLevel - 1))],
    buy: (state) => {
      const cacheLevel = state.hardware.cacheLevel + 1;
      return setHardware(state, {
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
    cost: (state) => [
      credits(12 * 1.68 ** ((state.hardware.cacheSpeedLevel ?? 1) - 1)),
    ],
    buy: (state) => {
      const cacheSpeedLevel = (state.hardware.cacheSpeedLevel ?? 1) + 1;
      return setHardware(state, {
        cacheSpeedLevel,
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
    cost: (state) => [
      credits(140 * 2.05 ** (state.hardware.cores - 1)),
      data(5 * 1.45 ** (state.hardware.cores - 1)),
    ],
    buy: (state) => {
      const nextCoreId = state.hardware.cores + 1;

      return setHardware(state, {
        cores: nextCoreId,
        coreClockLevels: {
          ...state.hardware.coreClockLevels,
          [nextCoreId]: 1,
        },
      });
    },
  },
  {
    id: "schedulerSlot",
    name: "Queue Slot",
    component: "scheduler",
    accent: "violet",
    requirement: (state) => state.flags.basicQueue || state.flags.scheduler,
    cost: (state) => [
      credits(48 * 1.72 ** state.hardware.schedulerSlots),
      data(3 * 1.34 ** state.hardware.schedulerSlots),
    ],
    buy: (state) =>
      setHardware(state, {
        schedulerSlots: state.hardware.schedulerSlots + 1,
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
    name: "Kernel Scheduler",
    component: "scheduler",
    accent: "violet",
    maxPurchases: 1,
    requirement: () => false,
    cost: () => [credits(320), data(16)],
    buy: (state) => state,
  },
  {
    id: "secondCpu",
    name: "Second CPU",
    component: "socket",
    accent: "amber",
    maxPurchases: 1,
    requirement: (state) => state.flags.secondCpu && !state.hardware.secondCpu,
    cost: () => [credits(900), data(24)],
    buy: (state) =>
      setHardware(
        {
          ...state,
          flags: { ...state.flags, systemStats: true },
        },
        {
          secondCpu: true,
          ramLevel: Math.max(1, state.hardware.ramLevel),
          ramBits: getRamBits(Math.max(1, state.hardware.ramLevel)),
          ramBytes: getRamBytes(Math.max(1, state.hardware.ramLevel)),
          ramSpeedMt: getRamSpeedMt(Math.max(1, state.hardware.ramLevel)),
          psuLevel: Math.max(1, state.hardware.psuLevel),
          psuWatts: getPsuWatts(Math.max(1, state.hardware.psuLevel)),
        },
      ),
  },
  {
    id: "ram",
    name: "RAM Module",
    component: "ram",
    accent: "green",
    requirement: (state) => state.flags.systemStats,
    cost: (state) => [
      credits(110 * 1.88 ** Math.max(0, state.hardware.ramLevel - 1)),
      data(6 * 1.34 ** Math.max(0, state.hardware.ramLevel - 1)),
    ],
    buy: (state) => {
      const ramLevel = state.hardware.ramLevel + 1;
      return setHardware(state, {
        ramLevel,
        ramBits: getRamBits(ramLevel),
        ramBytes: getRamBytes(ramLevel),
        ramSpeedMt: getRamSpeedMt(ramLevel),
      });
    },
  },
  {
    id: "psu",
    name: "PSU Capacity",
    component: "psu",
    accent: "amber",
    requirement: (state) => state.flags.systemStats,
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
