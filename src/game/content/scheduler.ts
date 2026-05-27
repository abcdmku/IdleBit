import type { Cost } from "../types";

const credits = (amount: number): Cost => ({
  resource: "credits",
  amount: Math.round(amount),
});

const data = (amount: number): Cost => ({
  resource: "data",
  amount: Math.round(amount),
});

export const getCpuSchedulerSlotUpgradeCost = (slotCount: number): Cost[] => [
  credits(72 * 1.85 ** Math.max(0, Math.trunc(slotCount))),
  data(5 * 1.42 ** Math.max(0, Math.trunc(slotCount))),
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
