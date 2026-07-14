import { describe, expect, it } from "vitest";
import { amountCompare } from "../amount";
import {
  RAM_MAX_LEVEL,
  getRamTierCapacityUpgradeCost,
  getRamTierLevelDefinition,
} from "./ramTiers";

describe("RAM tier ladder continuity (F-BAL-3)", () => {
  it("doubles capacity at every global level with no tier-boundary collapse", () => {
    for (let level = 1; level <= RAM_MAX_LEVEL; level += 1) {
      expect(getRamTierLevelDefinition(level).capacityBits).toBe(
        256 * 2 ** (level - 1),
      );
    }

    // The old per-tier reset shrank a maxed hz stick 33,554,432x when it was
    // "upgraded" to khz level 1; capacity must strictly grow across every
    // tier boundary instead.
    for (const boundary of [36, 72, 108]) {
      expect(getRamTierLevelDefinition(boundary + 1).capacityBits).toBe(
        getRamTierLevelDefinition(boundary).capacityBits * 2,
      );
    }
  });

  it("keeps capacity-upgrade credits strictly increasing across all 144 levels", () => {
    for (let level = 2; level <= RAM_MAX_LEVEL; level += 1) {
      const previous = getRamTierCapacityUpgradeCost(level - 1)[0]!;
      const next = getRamTierCapacityUpgradeCost(level)[0]!;

      expect(previous.resource).toBe("credits");
      expect(next.resource).toBe("credits");
      // Level 37 must never be a cheaper-per-bit collapse vs level 36: cost
      // grows strictly while capacity doubles, so cost-per-bit never inverts
      // at a tier boundary.
      expect(
        { level, increased: amountCompare(next.amount, previous.amount) > 0 },
      ).toEqual({ level, increased: true });
    }
  });
});
