import { describe, expect, it } from "vitest";
import { getCampaignObjectiveDefinition } from "./campaign";
import { createInitialGameState } from "./progression";
import type { GameState } from "./types";

/**
 * F-PLAY-8: multi-condition objective copy must drop sub-conditions the
 * player has already satisfied instead of listing both halves forever.
 */
describe("campaign objective blocked-reason copy", () => {
  const withResearch = (state: GameState, researchId: string): GameState => ({
    ...state,
    research: {
      ...state.research,
      completed: [
        ...state.research.completed,
        researchId,
      ] as GameState["research"]["completed"],
    },
  });

  it("keeps both halves of the CRON objective before any progress", () => {
    const definition = getCampaignObjectiveDefinition("coherent:cron-runtime");
    const state = createInitialGameState();

    expect(definition?.blockedReason(state)).toBe(
      "Research CRON and configure a standing order.",
    );
  });

  it("drops the completed research half once CRON is researched", () => {
    const definition = getCampaignObjectiveDefinition("coherent:cron-runtime");
    const state = withResearch(createInitialGameState(), "cronScheduler");

    expect(definition?.blockedReason(state)).toBe(
      "Configure a standing order.",
    );
  });

  it("clears the reason entirely once both halves are satisfied", () => {
    const definition = getCampaignObjectiveDefinition("coherent:cron-runtime");
    const base = withResearch(createInitialGameState(), "cronScheduler");
    const state: GameState = {
      ...base,
      standingOrder: { ...base.standingOrder, taskId: "tinyChecksum" },
    } as GameState;

    expect(definition?.blockedReason(state)).toBeNull();
  });

  it("drops the completed research half of the RAM objective", () => {
    const definition = getCampaignObjectiveDefinition("coherent:ram-control");
    const state = withResearch(createInitialGameState(), "ramControl");

    expect(definition?.blockedReason(state)).toBe("Install RAM.");
  });
});
