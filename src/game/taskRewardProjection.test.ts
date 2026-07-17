import { describe, expect, it } from "vitest";
import { advanceGame } from "./advance";
import { amountSubtract } from "./amount";
import { createInitialGameState } from "./progression";
import { deriveVisibleState } from "./selectors";
import { applyAction } from "./simulation";

describe("task reward projection", () => {
  it("shows and pays stable Data on every completion of the starter Fetch Bit task", () => {
    const initial = createInitialGameState();
    expect(initial.exactResources.data).toBe("0");
    const beforeTask = deriveVisibleState(initial).tasks.find(
      (task) => task.id === "fetchBit",
    );
    expect(beforeTask?.rewardData).toBe(1);
    expect(beforeTask?.canStart).toBe(true);

    const started = applyAction(initial, {
      type: "startTask",
      taskId: "fetchBit",
    });
    const first = advanceGame(started, 2_000, "foreground").state;
    expect(amountSubtract(first.exactResources.data, initial.exactResources.data)).toBe(
      "1",
    );
    const completedTask = deriveVisibleState(first).tasks.find(
      (task) => task.id === "fetchBit",
    );
    expect(completedTask?.rewardData).toBe(1);

    const repeated = advanceGame(
      applyAction(first, { type: "startTask", taskId: "fetchBit" }),
      2_000,
      "foreground",
    ).state;
    expect(amountSubtract(repeated.exactResources.data, first.exactResources.data)).toBe(
      "1",
    );
  });
});
