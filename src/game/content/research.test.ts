import { describe, expect, it } from "vitest";
import { amountCompare } from "../amount";
import { createInitialGameState } from "../progression";
import type { GameState, ResearchId } from "../types";
import { researchDefinitions } from "./research";

const getDefinition = (id: ResearchId) => {
  const definition = researchDefinitions.find((entry) => entry.id === id);
  if (!definition) throw new Error(`Missing research definition: ${id}`);
  return definition;
};

const withCompleted = (completed: ResearchId[]): GameState => ({
  ...createInitialGameState(),
  research: {
    completed,
  },
});

const dataCost = (id: ResearchId, state: GameState) => {
  const cost = getDefinition(id)
    .cost(state)
    .find((entry) => entry.resource === "data");
  return cost?.amount ?? "0";
};

describe("research content sheet", () => {
  // C-DES-1: buying Scheduler Watchdog (and the Scheduling Policy ladder
  // behind it) out of the tight pre-Scheduler Data budget could soft-lock
  // System Scheduler funding, so it must not exist before System Scheduler.
  it("gates Scheduler Watchdog and Scheduling Policy behind System Scheduler", () => {
    const watchdog = getDefinition("schedulerWatchdog");
    const policies = getDefinition("schedulerPolicies");
    const preScheduler = withCompleted(["multiCore", "localScheduler"]);
    const postScheduler = withCompleted([
      "multiCore",
      "localScheduler",
      "systemScheduler",
    ]);

    expect(watchdog.reveal(preScheduler)).toBe(false);
    expect(watchdog.requirement(preScheduler)).toBe(false);
    expect(watchdog.reveal(postScheduler)).toBe(true);
    expect(watchdog.requirement(postScheduler)).toBe(true);

    expect(policies.reveal(preScheduler)).toBe(false);
    expect(policies.reveal(postScheduler)).toBe(false);
    expect(
      policies.reveal(
        withCompleted([
          "multiCore",
          "localScheduler",
          "systemScheduler",
          "schedulerWatchdog",
        ]),
      ),
    ).toBe(true);
  });

  // C-DES-11 / F-BAL-5: channel research is priced to its hardware era
  // instead of orders of magnitude beyond every campaign Data gate.
  it("prices RAM channel research within its era's Data economy", () => {
    const state = createInitialGameState();

    expect(getDefinition("dualChannelRam").cost(state)).toEqual([
      { resource: "credits", amount: "2000" },
      { resource: "data", amount: "20" },
    ]);
    expect(getDefinition("quadChannelRam").cost(state)).toEqual([
      { resource: "credits", amount: "2000000" },
      { resource: "data", amount: "2000" },
    ]);
    expect(getDefinition("octChannelRam").cost(state)).toEqual([
      { resource: "credits", amount: "2000000000" },
      { resource: "data", amount: "20000" },
    ]);

    // Every channel unlock stays fundable below the campaign's final
    // 100,000-Data Global Scheduling gate.
    const finalGate = dataCost("globalSchedulerResearch", state);
    for (const id of [
      "dualChannelRam",
      "quadChannelRam",
      "octChannelRam",
    ] as const) {
      expect(amountCompare(dataCost(id, state), finalGate)).toBeLessThan(0);
    }
  });

  // C-DES-22: every scheduler module starts with zero slots; the research
  // only unlocks the slot purchases.
  it("describes scheduler research as unlocking slot purchases", () => {
    expect(getDefinition("localScheduler").description).toBe(
      "Unlocks CPU queue slot purchases.",
    );
    expect(getDefinition("systemScheduler").description).toBe(
      "Unlocks system queue slot purchases.",
    );
    expect(getDefinition("cronScheduler").description).toBe(
      "Unlocks CRON job slot purchases.",
    );
  });
});
