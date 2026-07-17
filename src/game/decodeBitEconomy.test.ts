import { describe, expect, it } from "vitest";

import { advanceGame } from "./advance";
import { exactResourceBag } from "./amount";
import { getTaskDefinition } from "./content/tasks";
import { createInitialGameState } from "./progression";
import { deriveVisibleState } from "./selectors";
import { applyAction } from "./simulation";

describe("Decode Bit economy", () => {
  it("derives a four-Credit gross payout from its hardware work", () => {
    const task = getTaskDefinition("decodeBit");

    expect(task.operationCount).toBe(2);
    expect(task.requiredCycles).toBe(2);
    expect(task.paidWorkUnits).toBe(4);
    expect(task.rewardCredits).toBe(4);
    expect(task.rewardCreditsExact).toBe(task.paidWorkUnitsExact);
    expect(task.rewardData).toBe(1);
  });

  it("projects the same four-Credit payout through the public selector", () => {
    const task = deriveVisibleState(createInitialGameState()).tasks.find(
      (candidate) => candidate.id === "decodeBit",
    );

    expect(task?.paidWorkUnits).toBe(4);
    expect(task?.rewardCredits).toBe(4);
    expect(task?.projection.rewardCredits).toBe("4");
  });

  it("records four gross Credits on completion independently of power spend", () => {
    const initial = createInitialGameState();
    const funded = {
      ...initial,
      exactResources: exactResourceBag(1_000, 1_000),
      resources: { credits: 1_000, data: 1_000 },
      power: { ...initial.power, bootstrapGraceSeconds: 100 },
    };
    const withCache = applyAction(funded, {
      type: "buyUpgrade",
      upgradeId: "cache",
    });
    expect(
      deriveVisibleState(withCache).tasks.find(
        (candidate) => candidate.id === "decodeBit",
      )?.blockedReason,
    ).toBeNull();
    const started = applyAction(withCache, {
      type: "startTask",
      taskId: "decodeBit",
    });
    const completed = advanceGame(started, 10_000, "foreground");

    expect(completed.intervalReport.completedWork.decodeBit).toBe(1);
    expect(completed.intervalReport.creditsEarned).toBe("4");
    expect(completed.state.taskRewardCreditsEarned.decodeBit).toBe("4");
  });
});
