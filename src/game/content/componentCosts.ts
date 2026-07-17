import type { Cost } from "../types";
import { capacityGrowthCosts, roundedGrowthCost } from "../exactCosts";

/**
 * Canonical per-component cost ladders shared by the in-place upgrade screen
 * and the machine builder so identical hardware always prices identically
 * (C-DES-9 / F-BAL-4). The in-place upgrade curves are authoritative.
 */

/** Add Core ladder: Nth extra core on a package (purchaseCount = N - 1). */
export const coreCosts = (purchaseCount: number): Cost[] => [
  roundedGrowthCost("credits", "140", "2.05", purchaseCount),
  roundedGrowthCost("data", "2", "1.3", purchaseCount),
];

/** Cache capacity ladder: level L -> L + 1 (purchaseCount = L - 1). */
export const cacheCapacityCosts = (purchaseCount: number): Cost[] =>
  capacityGrowthCosts("3", "1.45", purchaseCount);
