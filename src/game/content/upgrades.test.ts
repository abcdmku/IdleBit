import { describe, expect, it } from "vitest";
import {
  amount,
  amountCompare,
  amountMultiply,
  amountSubtract,
  exactResourceBag,
} from "../amount";
import { withExactResources } from "../economy";
import { createInitialGameState } from "../progression";
import { applyAction } from "../simulation";
import type { GameState } from "../types";

const HUGE = amount("1e60");

const fundedRamState = (): GameState =>
  withExactResources(
    {
      ...createInitialGameState(),
      research: {
        completed: ["ramControl"],
      },
    },
    exactResourceBag(HUGE, HUGE),
  );

const buyStick = (state: GameState) =>
  applyAction(state, { type: "buyUpgrade", upgradeId: "ram" });

const buyOnLastStick = (
  state: GameState,
  upgradeId: "ramCapacity" | "ramSpeed",
) =>
  applyAction(state, {
    type: "buyUpgrade",
    upgradeId,
    ramStickIds: [state.hardware.ramSticks.at(-1)!.id],
  });

const sellLastStick = (state: GameState) =>
  applyAction(state, { type: "downgradeUpgrade", upgradeId: "ram" });

describe("RAM stick sell refunds (F-ECO-1)", () => {
  it("never profits from the buy -> upgrade -> sell cycle at high stick counts", () => {
    // Reproduces the exploit shape from the finding: grow to 7 sticks, then
    // buy the 8th, upgrade its capacity to level 4, and sell it. The old
    // refund priced the sale off the install curve at the UPGRADED level
    // scaled by 2^(stickCount - 1), minting +878 credits per cycle.
    let state = fundedRamState();
    for (let stick = 0; stick < 7; stick += 1) {
      state = buyStick(state);
    }
    expect(state.hardware.ramSticks).toHaveLength(7);

    const beforeCycle = state.exactResources.credits;
    state = buyStick(state);
    state = buyOnLastStick(state, "ramCapacity");
    state = buyOnLastStick(state, "ramCapacity");
    state = buyOnLastStick(state, "ramCapacity");
    expect(state.hardware.ramSticks.at(-1)?.level).toBe(4);

    state = sellLastStick(state);
    expect(state.hardware.ramSticks).toHaveLength(7);

    const cycleNet = amountSubtract(state.exactResources.credits, beforeCycle);
    expect(amountCompare(cycleNet, 0)).toBeLessThan(0);
  });

  it("refunds at most half of what was actually paid for the sold stick", () => {
    let state = fundedRamState();
    state = buyStick(state);

    const beforeStick = state.exactResources.credits;
    state = buyStick(state);
    state = buyOnLastStick(state, "ramCapacity");
    state = buyOnLastStick(state, "ramCapacity");
    state = buyOnLastStick(state, "ramSpeed");
    const paid = amountSubtract(beforeStick, state.exactResources.credits);

    const beforeSell = state.exactResources.credits;
    state = sellLastStick(state);
    const refund = amountSubtract(state.exactResources.credits, beforeSell);

    expect(amountCompare(refund, 0)).toBeGreaterThan(0);
    expect(amountCompare(amountMultiply(refund, 2), paid)).toBeLessThanOrEqual(0);
  });

  it("keeps repeating the exploit cycle strictly credit-negative", () => {
    // The old formula's profit compounded with stick count; assert several
    // consecutive cycles all lose credits.
    let state = fundedRamState();
    for (let stick = 0; stick < 6; stick += 1) {
      state = buyStick(state);
    }

    for (let cycle = 0; cycle < 3; cycle += 1) {
      const before = state.exactResources.credits;
      state = buyStick(state);
      state = buyOnLastStick(state, "ramCapacity");
      state = sellLastStick(state);
      const net = amountSubtract(state.exactResources.credits, before);
      expect({ cycle, lost: amountCompare(net, 0) < 0 }).toEqual({
        cycle,
        lost: true,
      });
    }
  });
});
