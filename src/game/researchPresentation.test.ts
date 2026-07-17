import { describe, expect, it } from "vitest";

import { createInitialGameState } from "./progression";
import { deriveVisibleState } from "./selectors";

describe("research presentation semantics", () => {
  it("describes available and completed research as research", () => {
    const initial = createInitialGameState();
    const revealed = {
      ...initial,
      completedTasks: { ...initial.completedTasks, fetchBit: 1 },
      completedJobs: { ...initial.completedJobs, fetchBit: 1 },
    };
    const available = deriveVisibleState(revealed).research.find(
      (research) => research.id === "decodeLogic",
    );
    const completed = deriveVisibleState({
      ...revealed,
      research: { ...revealed.research, completed: ["decodeLogic"] },
    }).research.find((research) => research.id === "decodeLogic");

    expect(available?.actionLabel).toBe("Research");
    expect(available?.completedLabel).toBe("Researched");
    expect(completed?.completed).toBe(true);
    expect(completed?.completedLabel).toBe("Researched");
  });
});
