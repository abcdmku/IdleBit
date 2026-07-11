import { beamSearchPublicActionRoutes } from "./beamSearch";
import { describe, expect, it } from "vitest";

describe("public action beam search", () => {
  it("dominance-prunes a strictly worse route in the same milestone group", () => {
    type State = { progress: number; credits: number };
    type Action = { type: "efficient" | "wasteful" };
    const result = beamSearchPublicActionRoutes<State, State, Action>({
      initialState: { progress: 0, credits: 0 },
      observe: (state) => state,
      enumerateActions: () => [{ type: "efficient" }, { type: "wasteful" }],
      applyPublicAction: (state, action) => ({
        progress: state.progress + 1,
        credits: state.credits + (action.type === "efficient" ? 5 : 2),
      }),
      score: (visible) => visible.progress * 10 + visible.credits,
      dominance: (visible) => ({
        group: `progress:${visible.progress}`,
        values: [visible.progress, visible.credits],
      }),
      objectiveDirections: ["maximize", "maximize"],
      beamWidth: 4,
      maximumDepth: 1,
    });

    expect(result.frontier).toHaveLength(1);
    expect(result.frontier[0]?.route).toEqual([{ type: "efficient" }]);
    expect(result.stats.dominancePruned).toBe(1);
  });
});
