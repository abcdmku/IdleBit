import { describe, expect, it } from "vitest";
import { amountCompare, amountMultiply } from "./amount";
import { acceleratorSkuDefinitions } from "./content/accelerators";
import { cacheCapacityCosts } from "./content/componentCosts";
import { getPsuCapacityUpgradeCost } from "./content/psu";
import {
  getRamTierCapacityUpgradeCost,
  getRamTierInstallCost,
  getRamTierSpeedUpgradeCost,
} from "./content/ramTiers";
import {
  serverSkuDefinitions,
  storageSkuDefinitions,
} from "./infrastructureDefinitions";
import type { Cost } from "./types";

const expectTenDataPerCredit = (costs: readonly Cost[]) => {
  const credits = costs.find((cost) => cost.resource === "credits")?.amount;
  const data = costs.find((cost) => cost.resource === "data")?.amount;
  expect(credits).toBeDefined();
  expect(data).toBe(amountMultiply(credits!, "10"));
};

describe("data-storage capacity pricing", () => {
  it("keeps cache and RAM capacity at ten Data per Credit", () => {
    for (const purchaseCount of [0, 1, 8, 24]) {
      expectTenDataPerCredit(cacheCapacityCosts(purchaseCount));
    }
    for (const level of [1, 2, 36, 37, 72, 108, 144]) {
      expectTenDataPerCredit(getRamTierInstallCost(level));
      expectTenDataPerCredit(getRamTierCapacityUpgradeCost(level));
    }
  });

  it("applies the rule to storage, server memory, and accelerator memory", () => {
    for (const definition of storageSkuDefinitions) {
      if (amountCompare(definition.profile.storageBits, 0) > 0) {
        expectTenDataPerCredit(definition.costs);
      }
    }
    for (const definition of serverSkuDefinitions) {
      if (amountCompare(definition.profile.memoryBits, 0) > 0) {
        expectTenDataPerCredit(definition.costs);
      }
    }
    for (const definition of acceleratorSkuDefinitions) {
      expect(amountCompare(definition.deviceMemoryBits, 0)).toBeGreaterThan(0);
      expectTenDataPerCredit(definition.costs);
    }
  });

  it("does not treat speed or electrical headroom as data capacity", () => {
    expect(getRamTierSpeedUpgradeCost(2).some((cost) => cost.resource === "data")).toBe(false);
    expect(getPsuCapacityUpgradeCost(2).some((cost) => cost.resource === "data")).toBe(false);
  });
});
