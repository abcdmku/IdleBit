import { describe, expect, it } from "vitest";
import { refreshContractMarket } from "./contracts";
import { createInitialGameState } from "./progression";
import { deriveVisibleState } from "./selectors";
import { deserializeSave, serializeSave } from "./save";
import type { GameState } from "./types";

const withFlags = (state: GameState, flags: Partial<GameState["flags"]>) => ({
  ...state,
  flags: { ...state.flags, ...flags },
});

const sampleOffer = (expiresAtMs: number) => ({
  id: "offer-test-1",
  templateId: "queueRecovery" as const,
  kind: "burst" as const,
  name: "Test Recovery",
  description: "Test offer.",
  systemId: 1,
  workRequiredMs: 20_000,
  workRecipe: {
    stages: [{ id: "compute", resource: "compute" as const, work: "140" }],
  },
  expiresAtMs,
  rewards: { credits: "100", data: "0" },
  novel: false,
});

describe("work-surface reveal gates", () => {
  it("opens a fresh save with Jobs only", () => {
    const visible = deriveVisibleState(createInitialGameState());
    expect(visible.workViews).toEqual({
      campaign: false,
      market: false,
      automation: false,
    });
    // The objective chip carries the actionable tutorial line from minute 0.
    expect(visible.currentObjective?.blockedReason).toBe(
      "Complete Fetch Bit or Decode Bit.",
    );
  });

  it("reveals Campaign and Automation with System Scheduler, Market with CRON", () => {
    const scheduler = deriveVisibleState(
      withFlags(createInitialGameState(), { scheduler: true }),
    );
    expect(scheduler.workViews.campaign).toBe(true);
    expect(scheduler.workViews.automation).toBe(true);
    expect(scheduler.workViews.market).toBe(false);

    const cron = deriveVisibleState(
      withFlags(createInitialGameState(), { scheduler: true, cron: true }),
    );
    expect(cron.workViews.market).toBe(true);
  });

  it("keeps the Market visible for legacy saves that already hold contracts", () => {
    const state = createInitialGameState();
    const legacy: GameState = {
      ...state,
      contracts: {
        ...state.contracts,
        offers: [sampleOffer(60_000) as never],
      },
    };
    expect(deriveVisibleState(legacy).workViews.market).toBe(true);
  });

  it("blocks the contract market publicly before CRON", () => {
    const state = createInitialGameState();
    const visible = deriveVisibleState(state);
    expect(visible.contractMarket.canRefresh).toBe(false);
    expect(visible.contractMarket.refreshBlockedReason).toBe(
      "Requires CRON Scheduler research.",
    );
    // The action is identity pre-CRON.
    expect(refreshContractMarket(state)).toBe(state);
  });

  it("clears the pre-CRON blocker once CRON is owned", () => {
    const visible = deriveVisibleState(
      withFlags(createInitialGameState(), { cron: true }),
    );
    expect(visible.contractMarket.canRefresh).toBe(true);
    expect(visible.contractMarket.refreshBlockedReason).toBeNull();
  });

  it("prunes expired and pre-CRON offers at load, keeping active contracts", () => {
    const state = createInitialGameState();
    const holding: GameState = {
      ...state,
      contracts: {
        ...state.contracts,
        elapsedMs: 120_000,
        offers: [
          sampleOffer(60_000) as never, // expired
          { ...sampleOffer(600_000), id: "offer-test-2" } as never, // pre-cron
        ],
      },
    };
    const restored = deserializeSave(serializeSave(holding));
    expect(restored.contracts.offers).toHaveLength(0);
  });
});
