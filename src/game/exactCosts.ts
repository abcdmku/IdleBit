import {
  amountAdd,
  amountCompare,
  amountFloor,
  amountMultiply,
  amountPow,
  amountRound,
  exactCost,
  ZERO_AMOUNT,
  type Amount,
  type AmountInput,
} from "./amount";
import type { Cost, ResourceId } from "./types";

export const roundedCost = (
  resource: ResourceId,
  value: AmountInput,
): Cost => exactCost(resource, amountRound(value));

export const roundedGrowthCost = (
  resource: ResourceId,
  base: AmountInput,
  growth: AmountInput,
  exponent: number,
): Cost =>
  roundedCost(resource, amountMultiply(base, amountPow(growth, exponent)));

export const scaleCostsExact = (
  costs: readonly Cost[],
  multiplier: AmountInput,
): Cost[] =>
  costs
    .map((cost) => ({
      ...cost,
      amount: amountMultiply(cost.amount, multiplier),
    }))
    .filter((cost) => amountCompare(cost.amount, ZERO_AMOUNT) > 0);

export const combineCostsExact = (costs: readonly Cost[]): Cost[] => {
  const totals: Record<ResourceId, Amount> = {
    credits: ZERO_AMOUNT,
    data: ZERO_AMOUNT,
  };
  for (const cost of costs) {
    totals[cost.resource] = amountAdd(totals[cost.resource], cost.amount);
  }
  return (Object.keys(totals) as ResourceId[])
    .map((resource) => exactCost(resource, totals[resource]))
    .filter((cost) => amountCompare(cost.amount, ZERO_AMOUNT) > 0);
};

export const halfRefundExact = (costs: readonly Cost[]): Cost[] =>
  costs
    .map((cost) => ({
      ...cost,
      amount: amountFloor(amountMultiply(cost.amount, "0.5")),
    }))
    .filter((cost) => amountCompare(cost.amount, ZERO_AMOUNT) > 0);
