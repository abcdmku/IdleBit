import type { Cost } from "../types";
import { roundedGrowthCost } from "../exactCosts";

export const PSU_CAPACITY_COST_GROWTH = "1.32";

export const getPsuCapacityUpgradeCost = (targetLevel: number): Cost[] => {
  const safeTargetLevel = Math.max(1, Math.trunc(targetLevel));
  if (safeTargetLevel <= 1) return [];

  return [
    roundedGrowthCost(
      "credits",
      "24",
      PSU_CAPACITY_COST_GROWTH,
      safeTargetLevel - 2,
    ),
  ];
};

export const getPsuCapacityBuildCost = (
  fromLevel: number,
  toLevel: number,
): Cost[] => {
  const safeFromLevel = Math.max(1, Math.trunc(fromLevel));
  const safeToLevel = Math.max(1, Math.trunc(toLevel));

  return Array.from(
    { length: Math.max(0, safeToLevel - safeFromLevel) },
    (_, index) => safeFromLevel + index + 1,
  ).flatMap(getPsuCapacityUpgradeCost);
};
