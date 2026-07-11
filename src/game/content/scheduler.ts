import type { Cost } from "../types";
import { roundedGrowthCost } from "../exactCosts";

export const getCpuSchedulerSlotUpgradeCost = (slotCount: number): Cost[] => [
  roundedGrowthCost(
    "credits",
    "72",
    "1.85",
    Math.max(0, Math.trunc(slotCount)),
  ),
  roundedGrowthCost(
    "data",
    "2",
    "1.25",
    Math.max(0, Math.trunc(slotCount)),
  ),
];

export const getCpuSchedulerSlotBuildCost = (
  fromSlots: number,
  toSlots: number,
): Cost[] => {
  const safeFromSlots = Math.max(0, Math.trunc(fromSlots));
  const safeToSlots = Math.max(0, Math.trunc(toSlots));

  return Array.from(
    { length: Math.max(0, safeToSlots - safeFromSlots) },
    (_, index) => safeFromSlots + index,
  ).flatMap(getCpuSchedulerSlotUpgradeCost);
};
