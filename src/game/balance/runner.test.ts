import { amount } from "../amount";
import type { AdvanceReport, GameState, VisibleState } from "../types";
import { describe, expect, it } from "vitest";
import {
  bootstrapMilestoneAdapter,
  bootstrapSmokeRuntime,
} from "./bootstrap";
import { refreshContractMarket } from "../contracts";
import { profileAwareActionPolicy } from "./policy";
import type { CampaignProgressCheckpoint } from "./types";
import { sessionCadenceProfiles } from "./cadence";
import { deltaOfflineReport, runCampaign } from "./runner";

const cumulativeReport = (
  elapsedHours: number,
  credits: number,
  completed: number,
): AdvanceReport => ({
  mode: "offline",
  elapsedMs: elapsedHours * 3_600_000,
  simulatedMs: elapsedHours * 3_600_000,
  overflowMs: 0,
  productiveMs: elapsedHours * 3_600_000,
  pausedMs: 0,
  bufferLevelId: "globalScheduler",
  bufferCapacityMs: 168 * 3_600_000,
  standingOrderRenewals: completed,
  creditsEarned: amount(credits),
  creditsSpent: amount(0),
  dataEarned: amount(0),
  dataSpent: amount(0),
  destructiveEvents: { psuOverload: 0, unpaidBill: 0, deadlockWipe: 0 },
  safelyAvoidedDestructiveEvents: {
    psuOverload: 0,
    unpaidBill: 0,
    deadlockWipe: 0,
  },
  completedWork: { fetchBit: completed },
  blockers: [],
});

describe("campaign runner", () => {
  it("batches only no-action opening spans with equivalent public progression", () => {
    const runOpening = (openingMaximumDecisionStepMs?: number) => {
      const actions: string[] = [];
      let intervalCount = 0;
      const result = runCampaign({
        runtime: bootstrapSmokeRuntime,
        profile: sessionCadenceProfiles.regular,
        seed: 31_415,
        scheduleMode: "deterministic",
        actionPolicy: {
          selectActions: (context) => {
            const selected = profileAwareActionPolicy.selectActions(context);
            actions.push(...selected.map((action) => JSON.stringify(action)));
            return selected;
          },
        },
        completion: {
          isComplete: (visible) =>
            visible.automationBuffer.ownedLevelId === "localScheduler",
        },
        milestones: bootstrapMilestoneAdapter,
        metricAdapter: {
          sample: () => {
            intervalCount += 1;
            return {};
          },
        },
        maximumCalendarMs: 12 * 60_000,
        openingMaximumDecisionStepMs,
      });
      return { actions, intervalCount, result };
    };

    const batched = runOpening();
    const legacy = runOpening(2_000);
    expect(batched.actions).toEqual(legacy.actions);
    expect(batched.result.metrics.elapsedCalendarMs).toBe(
      legacy.result.metrics.elapsedCalendarMs,
    );
    expect(batched.result.metrics.milestones).toEqual(legacy.result.metrics.milestones);
    expect(batched.result.metrics.workMix).toEqual(legacy.result.metrics.workMix);
    expect(batched.result.metrics.roi).toEqual(legacy.result.metrics.roi);
    expect(batched.result.visible.exactResources).toEqual(
      legacy.result.visible.exactResources,
    );
    expect(batched.result.visible.currentChapter).toEqual(
      legacy.result.visible.currentChapter,
    );
    expect(batched.result.visible.currentObjective).toEqual(
      legacy.result.visible.currentObjective,
    );
    expect(batched.result.visible.automationBuffer).toEqual(
      legacy.result.visible.automationBuffer,
    );
    // Advance partitioning can leave a sub-quantum infrastructure clock residue,
    // but never enough to move a public decision or completion boundary.
    expect(
      Math.abs(
        batched.result.visible.infrastructure.elapsedMs -
          legacy.result.visible.infrastructure.elapsedMs,
      ),
    ).toBeLessThanOrEqual(10);
    // Batching merges only no-action spans. The Data-heavy capacity opening
    // dispatches work at every decision boundary, so there may be no idle span
    // to merge; it must still never add intervals versus the fixed 2s path.
    expect(batched.intervalCount).toBeLessThanOrEqual(legacy.intervalCount);
  }, 300_000);

  it("keeps post-CRON sessions decision-capable at public event boundaries", () => {
    const boundaryMs = 2 * 60_000;
    const sessionMs = 12 * 60_000;
    const runWith = (activeWork: VisibleState["activeWork"]) => {
      const checkpoints: CampaignProgressCheckpoint[] = [];
      runCampaign({
        runtime: {
          ...bootstrapSmokeRuntime,
          observe: (state) => {
            const visible = bootstrapSmokeRuntime.observe(state);
            return {
              ...visible,
              automationBuffer: {
                ...visible.automationBuffer,
                ownedLevelId: "cronRuntime" as const,
              },
              activeWork,
              contracts: [],
              contractMarket: {
                ...visible.contractMarket,
                refreshAvailableInMs: 0,
              },
            };
          },
        },
        profile: sessionCadenceProfiles.regular,
        seed: 11,
        scheduleMode: "deterministic",
        actionPolicy: { selectActions: () => [] },
        completion: { isComplete: () => false },
        milestones: { getReachedMilestones: () => [] },
        maximumCalendarMs: sessionMs,
        progress: {
          minimumIntervalMs: Number.MAX_SAFE_INTEGER,
          includeBeforeAdvance: true,
          onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
        },
      });
      return checkpoints
        .filter((checkpoint) => checkpoint.phase === "before-active-advance")
        .map((checkpoint) => checkpoint.requestedAdvanceMs);
    };

    // A pending completion boundary keeps the visit decision-capable: the
    // session is stepped so later policy passes can react to the completion.
    const steps = runWith([
      {
        id: "contract:1",
        kind: "contract",
        name: "Ledger Audit",
        progress: 0,
        remainingMs: boundaryMs,
        systemId: 1,
      },
    ]);
    expect(steps.length).toBeGreaterThan(1);
    expect(Math.max(...steps.map((step) => step ?? 0))).toBeLessThanOrEqual(
      boundaryMs,
    );

    // With no public event pending, the remaining visit still batches wholly
    // so long-campaign evidence does not scale with idle UI refreshes.
    expect(runWith([])).toEqual([sessionMs]);
  });

  it("emits periodic public-only progress and terminal diagnostic counters", () => {
    const checkpoints: CampaignProgressCheckpoint[] = [];
    runCampaign({
      runtime: bootstrapSmokeRuntime,
      profile: sessionCadenceProfiles.fullIdle,
      seed: 7,
      scheduleMode: "deterministic",
      actionPolicy: { selectActions: () => [] },
      completion: { isComplete: () => false },
      milestones: { getReachedMilestones: () => [] },
      maximumCalendarMs: 2 * 60_000,
      progress: {
        minimumIntervalMs: 60_000,
        includeBeforeAdvance: true,
        onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
      },
    });

    expect(checkpoints[0]).toMatchObject({
      phase: "initial",
      elapsedCalendarMs: 0,
      chapterId: "bootstrapNode",
    });
    expect(checkpoints.some((checkpoint) => checkpoint.phase.startsWith("before-"))).toBe(
      true,
    );
    expect(checkpoints.at(-1)).toMatchObject({
      phase: "terminal",
      elapsedCalendarMs: 2 * 60_000,
      completionRatio: 1,
      completed: false,
    });
    expect(checkpoints.at(-1)!.counters).toMatchObject({
      observations: expect.any(Number),
      decisions: expect.any(Number),
      advances: expect.any(Number),
      metricSamples: expect.any(Number),
    });
    expect("state" in checkpoints.at(-1)!).toBe(false);
    expect("visible" in checkpoints.at(-1)!).toBe(false);
  });

  it("propagates the campaign seed into saved game RNG and contract rolls", () => {
    // Offers only roll once CRON automation exists.
    const withCron = (state: GameState): GameState => ({
      ...state,
      flags: { ...state.flags, cron: true },
    });
    const first = withCron(bootstrapSmokeRuntime.createInitialState(101));
    const replay = withCron(bootstrapSmokeRuntime.createInitialState(101));
    const other = withCron(bootstrapSmokeRuntime.createInitialState(102));

    expect(first.rng).toEqual(replay.rng);
    expect(first.rng).not.toEqual(other.rng);
    expect(refreshContractMarket(first).contracts.offers).not.toHaveLength(0);
    expect(refreshContractMarket(first).contracts.offers).toEqual(
      refreshContractMarket(replay).contracts.offers,
    );
    expect(refreshContractMarket(first).contracts.offers).not.toEqual(
      refreshContractMarket(other).contracts.offers,
    );
  });

  it("deltas cumulative multi-chunk offline reports without double counting", () => {
    const first = {
      ...cumulativeReport(6, 10, 2),
      destructiveEvents: { psuOverload: 1, unpaidBill: 0, deadlockWipe: 0 },
      safelyAvoidedDestructiveEvents: {
        psuOverload: 0,
        unpaidBill: 0,
        deadlockWipe: 2,
      },
    };
    const cumulativeSecond = {
      ...cumulativeReport(12, 25, 5),
      destructiveEvents: { psuOverload: 3, unpaidBill: 1, deadlockWipe: 0 },
      safelyAvoidedDestructiveEvents: {
        psuOverload: 0,
        unpaidBill: 1,
        deadlockWipe: 5,
      },
    };
    const second = deltaOfflineReport(cumulativeSecond, first, 6 * 3_600_000);

    expect(second.elapsedMs).toBe(6 * 3_600_000);
    expect(second.creditsEarned).toBe(amount(15));
    expect(second.completedWork.fetchBit).toBe(3);
    expect(second.destructiveEvents).toEqual({
      psuOverload: 2,
      unpaidBill: 1,
      deadlockWipe: 0,
    });
    expect(second.safelyAvoidedDestructiveEvents).toEqual({
      psuOverload: 0,
      unpaidBill: 1,
      deadlockWipe: 3,
    });
    expect(Number(first.creditsEarned) + Number(second.creditsEarned)).toBe(25);
  });

  it("runs the Bootstrap adapter against current public state", () => {
    const result = runCampaign({
      runtime: bootstrapSmokeRuntime,
      profile: sessionCadenceProfiles.fullIdle,
      seed: 4,
      scheduleMode: "deterministic",
      actionPolicy: { selectActions: () => [] },
      completion: { isComplete: () => false },
      milestones: { getReachedMilestones: () => [] },
      maximumCalendarMs: 2 * 60_000,
    });

    expect(result.metrics.sessionCount).toBe(1);
    expect(result.metrics.activeMinutes).toBe(2);
    expect(result.visible.stage).toBe("primitiveCpu");
  });

  it("audits each dispatch against sequential public observations", () => {
    const outcomes: Array<{ before: string; after: string }> = [];
    let selected = false;
    runCampaign({
      runtime: {
        ...bootstrapSmokeRuntime,
        // CRON-gate the market open so the first refresh dispatch lands.
        createInitialState: (seed) => {
          const state = bootstrapSmokeRuntime.createInitialState(seed);
          return { ...state, flags: { ...state.flags, cron: true } };
        },
      },
      profile: sessionCadenceProfiles.fullIdle,
      seed: 9,
      scheduleMode: "deterministic",
      actionPolicy: {
        selectActions: () => {
          if (selected) return [];
          selected = true;
          return [
            { type: "refreshContractMarket" },
            { type: "refreshContractMarket" },
          ];
        },
        recordActionOutcome: ({ before, after }) => {
          outcomes.push({
            before: JSON.stringify(before),
            after: JSON.stringify(after),
          });
        },
      },
      completion: { isComplete: () => false },
      milestones: { getReachedMilestones: () => [] },
      maximumCalendarMs: 2_000,
    });

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]!.after).not.toBe(outcomes[0]!.before);
    expect(outcomes[1]!.after).toBe(outcomes[1]!.before);
    expect(outcomes[1]!.before).toBe(outcomes[0]!.after);
  });
});
