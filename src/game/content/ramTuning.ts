import type { Cost } from "../types";
import { getRamTierLevelDefinition } from "./ramTiers";

export const MEMORY_VOLTAGE_MAX_LEVEL = 36;

const credits = (amount: number): Cost => ({
  resource: "credits",
  amount: Math.round(amount),
});

const roundTo = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const getRamStickEfficiency = (speedLevel: number) =>
  getRamTierLevelDefinition(speedLevel).efficiency;

export const getMemoryVoltageCost = (targetLevel: number) =>
  targetLevel <= 0 || targetLevel > MEMORY_VOLTAGE_MAX_LEVEL
    ? []
    : [credits(getMemoryVoltageCostValue(targetLevel))];

const getMemoryVoltageCostValue = (level: number) => {
  let cost = 100_000;

  for (let currentLevel = 2; currentLevel <= level; currentLevel += 1) {
    cost = Math.round(cost * 1.8);
  }

  return cost;
};

export const getMemoryVoltageIdleMultiplier = (level: number) =>
  level <= 0 ? 1 : roundTo(Math.max(0.02, 0.74 - level * 0.02), 2);
