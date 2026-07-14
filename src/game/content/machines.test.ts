import { describe, expect, it } from "vitest";
import { amountAdd, amountCompare, type Amount } from "../amount";
import type { Cost, MachineComponentSelection } from "../types";
import { cacheCapacityCosts, coreCosts } from "./componentCosts";
import { getCpuTierPurchaseCost } from "./cpuTiers";
import {
  componentSkus,
  getComponentSku,
  getMachineSelectionCost,
} from "./machines";
import { getRamTierInstallCost } from "./ramTiers";

const sumResource = (costs: readonly Cost[], resource: Cost["resource"]): Amount =>
  costs
    .filter((cost) => cost.resource === resource)
    .reduce<Amount>((total, cost) => amountAdd(total, cost.amount), "0" as Amount);

const baseSelection: MachineComponentSelection = {
  cpu: "cpu-barebones-1",
  ram: "ram-none",
  scheduler: "scheduler-none",
  psu: "psu-barebones",
};

describe("machine catalog pricing", () => {
  // C-DES-10 / F-BAL-2: the PSU SKU ladder must be monotonic in both credits
  // and capacity — the old Server PSU (540,000 cr, level 32) was strictly
  // dominated by the 46,000 cr Workstation PSU (level 51).
  it("prices PSU SKUs so cost and psuLevel increase together", () => {
    const psus = componentSkus
      .filter((sku) => sku.type === "psu")
      .slice()
      .sort((left, right) =>
        amountCompare(
          sumResource(left.cost, "credits"),
          sumResource(right.cost, "credits"),
        ),
      );

    expect(psus.length).toBeGreaterThan(1);
    for (let index = 1; index < psus.length; index += 1) {
      const cheaper = psus[index - 1]!;
      const pricier = psus[index]!;
      expect({
        pair: [cheaper.id, pricier.id],
        monotonic: (pricier.psuLevel ?? 0) > (cheaper.psuLevel ?? 0),
      }).toEqual({ pair: [cheaper.id, pricier.id], monotonic: true });
    }

    expect(getComponentSku("psu-server").psuLevel).toBeGreaterThan(
      getComponentSku("psu-workstation").psuLevel ?? 0,
    );
  });

  // C-DES-9 / F-BAL-4: preset RAM tier SKUs must cost exactly what the
  // identical Advanced selection (and the in-place install ladder) charges:
  // each additional stick doubles, so 4 sticks cost 15x one install.
  it("prices preset RAM tiers identically to the equivalent Advanced selection", () => {
    for (const skuId of [
      "ram-hz-tier",
      "ram-khz-tier",
      "ram-mhz-tier",
      "ram-ghz-tier",
    ] as const) {
      const sku = getComponentSku(skuId);
      const preset = getMachineSelectionCost({ ...baseSelection, ram: skuId });
      const advanced = getMachineSelectionCost({
        ...baseSelection,
        ram: skuId,
        ramStickCount: sku.ramStickCount,
        ramLevel: sku.ramLevel,
        ramSpeedLevel: sku.ramSpeedLevel,
      });

      expect({
        skuId,
        credits: sumResource(preset, "credits"),
        data: sumResource(preset, "data"),
      }).toEqual({
        skuId,
        credits: sumResource(advanced, "credits"),
        data: sumResource(advanced, "data"),
      });

      // The 4-stick preset equals 2^4 - 1 = 15 installs at the tier base.
      const install = getRamTierInstallCost(sku.ramLevel ?? 1);
      expect(sumResource(sku.cost, "credits")).toBe(
        sumResource(
          Array.from({ length: 15 }, () => install).flat(),
          "credits",
        ),
      );
    }
  });

  // C-DES-9 / F-BAL-4: the builder must use the same canonical core/cache
  // ladders as the in-place upgrade screen (componentCosts.ts), not its old
  // steeper 5x1.45^n / 6x1.78^n Data curves.
  it("prices builder core and cache increments from the shared component ladders", () => {
    const base = getMachineSelectionCost(baseSelection);

    const withCache = getMachineSelectionCost({ ...baseSelection, cacheLevel: 2 });
    const cacheDelta = cacheCapacityCosts(0);
    expect(sumResource(withCache, "credits")).toBe(
      amountAdd(sumResource(base, "credits"), sumResource(cacheDelta, "credits")),
    );
    expect(sumResource(withCache, "data")).toBe(
      amountAdd(sumResource(base, "data"), sumResource(cacheDelta, "data")),
    );

    const withCore = getMachineSelectionCost({ ...baseSelection, cpuCoreCount: 2 });
    const coreDelta = [...coreCosts(0), ...getCpuTierPurchaseCost("hz")];
    expect(sumResource(withCore, "credits")).toBe(
      amountAdd(sumResource(base, "credits"), sumResource(coreDelta, "credits")),
    );
    expect(sumResource(withCore, "data")).toBe(
      amountAdd(sumResource(base, "data"), sumResource(coreDelta, "data")),
    );
  });
});
