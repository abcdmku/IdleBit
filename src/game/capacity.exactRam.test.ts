import { describe, expect, it } from "vitest";
import { amount, amountAdd } from "./amount";
import { RAM_MAX_LEVEL } from "./content/ramTiers";
import { deriveSystemCapacityProfile } from "./capacity";
import {
  createInitialGameState,
  createRamStickState,
  getExactRamCapacityBits,
  syncHardwarePackages,
} from "./progression";
import type { GameState } from "./types";

const withRamSticks = (
  sticks: GameState["hardware"]["ramSticks"],
): GameState => {
  const initial = createInitialGameState();
  const state = syncHardwarePackages({
    ...initial,
    hardware: { ...initial.hardware, ramSticks: sticks },
  });
  return {
    ...state,
    systems: state.systems.map((system) =>
      system.id === state.selectedSystemId
        ? { ...system, hardware: state.hardware }
        : system,
    ),
  };
};

describe("exact RAM capacity aggregation (C-SIM-2)", () => {
  const maxStick = createRamStickState(1, RAM_MAX_LEVEL);
  const smallStick = createRamStickState(2, 1);

  it("loses the small stick when aggregated as a Number (the defect being fixed)", () => {
    // A legal maximum stick is far beyond 2^53 bits; adding a 256-bit stick
    // to it does not change the double at all.
    expect(maxStick.bits).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(maxStick.bits + smallStick.bits).toBe(maxStick.bits);
  });

  it("aggregates stick capacities exactly with Amount", () => {
    const exact = getExactRamCapacityBits([maxStick, smallStick]);

    expect(exact).toBe(amountAdd(amount(maxStick.bits), amount(smallStick.bits)));
    // The exact sum retains the small stick the Number sum drops.
    expect(exact).not.toBe(amount(maxStick.bits));
    expect(getExactRamCapacityBits([])).toBe(amount(0));
  });

  it("projects the exact aggregate into the capacity profile memoryBits", () => {
    const state = withRamSticks([maxStick, smallStick]);
    const profile = deriveSystemCapacityProfile(state, state.selectedSystemId);

    expect(profile.memoryBits).toBe(
      amountAdd(amount(maxStick.bits), amount(smallStick.bits)),
    );
  });

  it("memoizes profiles per state identity and recomputes for changed states", () => {
    const state = withRamSticks([createRamStickState(1, 3)]);
    const first = deriveSystemCapacityProfile(state, state.selectedSystemId);
    const replay = deriveSystemCapacityProfile(state, state.selectedSystemId);
    expect(replay).toBe(first);

    // Different SKU key on the same state computes separately.
    const withStorage = deriveSystemCapacityProfile(
      state,
      state.selectedSystemId,
      "storageNone",
      "networkNone",
    );
    expect(withStorage).toBe(first);

    // A new state object (e.g. after an upgrade) misses the cache.
    const grown = withRamSticks([
      createRamStickState(1, 3),
      createRamStickState(2, 2),
    ]);
    const grownProfile = deriveSystemCapacityProfile(grown, grown.selectedSystemId);
    expect(grownProfile).not.toBe(first);
    expect(grownProfile.memoryBits).toBe(
      getExactRamCapacityBits(grown.hardware.ramSticks),
    );
  });

  it("keeps the Number ramBits projection finite and consistent for normal scales", () => {
    const state = withRamSticks([
      createRamStickState(1, 3),
      createRamStickState(2, 1),
    ]);

    expect(state.hardware.ramBits).toBe(
      createRamStickState(1, 3).bits + createRamStickState(2, 1).bits,
    );
    const profile = deriveSystemCapacityProfile(state, state.selectedSystemId);
    expect(profile.memoryBits).toBe(amount(state.hardware.ramBits));
  });
});
