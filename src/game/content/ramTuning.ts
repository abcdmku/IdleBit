import type { Cost } from "../types";
import { amount, amountMultiply, amountRound, type Amount } from "../amount";
import { roundedCost } from "../exactCosts";
import { getRamTierLevelDefinition } from "./ramTiers";

export const MEMORY_VOLTAGE_MAX_LEVEL = 36;

const credits = (value: Amount): Cost => roundedCost("credits", value);

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
  let cost = amount("100000");

  for (let currentLevel = 2; currentLevel <= level; currentLevel += 1) {
    cost = amountRound(amountMultiply(cost, "1.8"));
  }

  return cost;
};

export const getMemoryVoltageIdleMultiplier = (level: number) =>
  level <= 0 ? 1 : roundTo(Math.max(0.02, 0.74 - level * 0.02), 2);
