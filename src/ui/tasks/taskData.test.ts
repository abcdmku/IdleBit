import { describe, expect, it } from "vitest";
import { getTaskRewardCosts } from "./taskData";

describe("task reward display", () => {
  it("shows only the Data that the next completion will settle", () => {
    expect(getTaskRewardCosts({
      id: "bitFlip",
      name: "Bit Flip",
      rewardCredits: 3,
      rewardData: 1,
      firstCompletionData: 1,
      repeatRewardData: 0,
    })).toEqual([
      { resource: "credits", amount: 3 },
      { resource: "data", amount: 1 },
    ]);

    expect(getTaskRewardCosts({
      id: "bitFlip",
      name: "Bit Flip",
      rewardCredits: 3,
      rewardData: 0,
      firstCompletionData: 0,
      repeatRewardData: 0,
    })).toEqual([{ resource: "credits", amount: 3 }]);
  });
});
