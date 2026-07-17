import { describe, expect, it } from "vitest";
import {
  getTaskOperationCount,
  getTaskRewardCosts,
} from "./taskData";

describe("task reward display", () => {
  it("shows stable per-completion Data", () => {
    expect(getTaskRewardCosts({
      id: "bitFlip",
      name: "Bit Flip",
      rewardCredits: 3,
      rewardData: 1,
    })).toEqual([
      { resource: "credits", amount: 3 },
      { resource: "data", amount: 1 },
    ]);

    expect(getTaskRewardCosts({
      id: "bitFlip",
      name: "Bit Flip",
      rewardCredits: 3,
      rewardData: 0,
    })).toEqual([{ resource: "credits", amount: 3 }]);
  });
});

describe("task work units", () => {
  it("uses CPU cycle work as the player-facing ops value", () => {
    const task = {
      id: "decodeBit",
      name: "Decode Bit",
      operationCount: 2,
      requiredCycles: 3,
    };

    expect(getTaskOperationCount(task)).toBe(3);
  });

  it("falls back to the legacy operation count when cycles are absent", () => {
    const task = {
      id: "legacyOps",
      name: "Legacy Ops",
      operationCount: 12,
    };

    expect(getTaskOperationCount(task)).toBe(12);
  });

  it("uses operation cycle totals without multiplying invocation count again", () => {
    const task = {
      id: "operationFallback",
      name: "Operation Fallback",
      operations: [
        { id: "decode", name: "Decode", count: 4, cycles: 12 },
        { id: "write", name: "Write", count: 2, cycles: 6 },
      ],
    };

    expect(getTaskOperationCount(task)).toBe(18);
  });
});
