import { describe, expect, it } from "vitest";
import { advanceGame } from "./advance";
import { amountSubtract } from "./amount";
import { createInitialGameState } from "./progression";
import { deriveVisibleState } from "./selectors";
import { applyAction } from "./simulation";

const bitMutationState = () => {
  const initial = createInitialGameState();
  return {
    ...initial,
    research: {
      ...initial.research,
      completed: ["decodeLogic" as const],
    },
  };
};

describe("task reward projection", () => {
  it("shows pending discovery Data, pays it once, then removes it from the card", () => {
    const initial = bitMutationState();
    const beforeTask = deriveVisibleState(initial).tasks.find(
      (task) => task.id === "bitFlip",
    );
    expect(beforeTask?.rewardData).toBe(5);
    expect(beforeTask?.firstCompletionData).toBe(5);

    const started = applyAction(initial, {
      type: "startTask",
      taskId: "bitFlip",
    });
    const first = advanceGame(started, 4_000, "foreground").state;
    expect(amountSubtract(first.exactResources.data, initial.exactResources.data)).toBe(
      "5",
    );
    const completedTask = deriveVisibleState(first).tasks.find(
      (task) => task.id === "bitFlip",
    );
    expect(completedTask?.rewardData).toBe(0);
    expect(completedTask?.firstCompletionData).toBe(0);

    const repeated = advanceGame(
      applyAction(first, { type: "startTask", taskId: "bitFlip" }),
      4_000,
      "foreground",
    ).state;
    expect(repeated.exactResources.data).toBe(first.exactResources.data);
  });
});
