import type { Cost } from "../types";

const credits = (amount: number): Cost => ({
  resource: "credits",
  amount: Math.round(amount),
});

export const getPsuCapacityUpgradeCost = (targetLevel: number): Cost[] => {
  const safeTargetLevel = Math.max(1, Math.trunc(targetLevel));
  if (safeTargetLevel <= 1) return [];

  return [credits(24 * 1.42 ** (safeTargetLevel - 2))];
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
