import type { Cost, GameState, UpgradeDefinition } from "../types";
import { getClockHz, getCacheBytes } from "../progression";

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

const count = (state: GameState, id: UpgradeDefinition["id"]) => {
  if (id === "clock") return state.hardware.clockLevel - 1;
  if (id === "cache") return state.hardware.cacheLevel - 1;
  if (id === "core") return state.hardware.cores - 1;
  return state.flags[id as keyof GameState["flags"]] ? 1 : 0;
};

export const upgradeDefinitions: UpgradeDefinition[] = [
  {
    id: "clock",
    name: "Clock Speed",
    accent: "cyan",
    requirement: () => true,
    cost: (state) => [credits(12 * 1.52 ** (state.hardware.clockLevel - 1))],
    buy: (state) => {
      const clockLevel = state.hardware.clockLevel + 1;
      return setHardware(state, {
        clockLevel,
        clockHz: getClockHz(clockLevel),
      });
    },
  },
  {
    id: "cache",
    name: "CPU Cache",
    accent: "green",
    requirement: (state) => state.flags.cache,
    cost: (state) => [credits(14 * 1.58 ** (state.hardware.cacheLevel - 1))],
    buy: (state) => {
      const cacheLevel = state.hardware.cacheLevel + 1;
      return setHardware(state, {
        cacheLevel,
        cacheBytes: getCacheBytes(cacheLevel),
      });
    },
  },
  {
    id: "autoRepeat",
    name: "Auto-Repeat",
    accent: "violet",
    maxPurchases: 1,
    requirement: (state) => state.flags.autoRepeat && !state.autoRepeatJobId,
    cost: () => [credits(40), data(3)],
    buy: (state) => ({ ...state, autoRepeatJobId: "bitFlip" }),
  },
  {
    id: "core",
    name: "Add Core",
    accent: "cyan",
    maxPurchases: 3,
    requirement: (state) => state.flags.multiCore && state.hardware.cores < 4,
    cost: (state) => [credits(90 * 1.9 ** (state.hardware.cores - 1)), data(4)],
    buy: (state) => setHardware(state, { cores: state.hardware.cores + 1 }),
  },
  {
    id: "basicQueue",
    name: "Basic Queue",
    accent: "green",
    maxPurchases: 1,
    requirement: (state) =>
      state.flags.multiCore &&
      !state.flags.basicQueue &&
      state.hardware.cores >= 2,
    cost: () => [credits(95), data(6)],
    buy: (state) => ({
      ...state,
      flags: { ...state.flags, basicQueue: true },
    }),
  },
  {
    id: "scheduler",
    name: "Scheduler",
    accent: "violet",
    maxPurchases: 1,
    requirement: (state) => state.hardware.cores >= 4 && !state.flags.scheduler,
    cost: () => [credits(140), data(10)],
    buy: (state) => ({ ...state, flags: { ...state.flags, scheduler: true } }),
  },
  {
    id: "secondCpu",
    name: "Second CPU",
    accent: "amber",
    maxPurchases: 1,
    requirement: (state) => state.flags.secondCpu && !state.hardware.secondCpu,
    cost: () => [credits(260), data(18)],
    buy: (state) =>
      setHardware(
        {
          ...state,
          flags: { ...state.flags, systemStats: true },
        },
        { secondCpu: true, ramGb: 16, psuWatts: 450 },
      ),
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
