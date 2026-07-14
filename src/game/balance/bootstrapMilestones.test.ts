import { describe, expect, it } from "vitest";
import { getTaskDefinition } from "../content/tasks";
import type { GameAction } from "../types";
import {
  bootstrapMilestoneAdapter,
  bootstrapSmokeRuntime,
} from "./bootstrap";
import { sessionCadenceProfiles } from "./cadence";
import { createMeasuredCampaignHarness } from "./measuredAcceptance";
import { profileAwareActionPolicy } from "./policy";
import { runCampaign } from "./runner";
import type { ActionPolicyAdapter, CompletionAdapter } from "./types";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const CALIBRATION_SEED = 31_415;

const runOpeningMilestone = (
  completion: CompletionAdapter,
  maximumCalendarMs: number,
) => {
  const selectedActions: GameAction[] = [];
  let decisionCount = 0;
  const auditedPolicy: ActionPolicyAdapter = {
    selectActions: (context) => {
      decisionCount += 1;
      const actions = profileAwareActionPolicy.selectActions(context);
      selectedActions.push(...actions);
      return actions;
    },
  };
  const result = runCampaign({
    runtime: bootstrapSmokeRuntime,
    profile: sessionCadenceProfiles.regular,
    seed: CALIBRATION_SEED,
    scheduleMode: "deterministic",
    actionPolicy: auditedPolicy,
    completion,
    milestones: bootstrapMilestoneAdapter,
    maximumCalendarMs,
  });

  return { result, selectedActions, decisionCount };
};

const milestoneTime = (
  metrics: ReturnType<typeof runOpeningMilestone>["result"]["metrics"],
  id: string,
) => metrics.milestones.find((milestone) => milestone.id === id)?.reachedAtMs;

describe("Bootstrap deterministic balance milestones", () => {
  it("reaches the two-hour Local Scheduler buffer during the first regular session", () => {
    const { result, decisionCount } = runOpeningMilestone(
      {
        isComplete: (visible) =>
          visible.automationBuffer.ownedLevelId === "localScheduler",
      },
      12 * MINUTE_MS,
    );

    expect(result.metrics.status).toBe("completed");
    expect(result.visible.automationBuffer.maxOfflineMs).toBe(2 * 60 * MINUTE_MS);
    expect(result.metrics.sessionCount).toBe(1);
    expect(milestoneTime(result.metrics, "buffer:localScheduler")).toBeGreaterThan(0);
    expect(milestoneTime(result.metrics, "buffer:localScheduler")).toBeLessThanOrEqual(
      12 * MINUTE_MS,
    );
    expect(
      milestoneTime(result.metrics, "mission:bootstrap:first-benchmark"),
    ).toBeDefined();
    expect(decisionCount).toBeLessThan(350);
  });

  // Measured on the true daily cadence (C-DES-15): a regular player banks
  // ~12 min attended plus one 2h Local Scheduler buffer per 24h absence.
  // Pre-billing this landed CRON around day 6 — already outside the authored
  // day-one-to-three window. The C-DES-6 ruling (metered power billing from
  // the first tick) drains the attended sessions further and now measures
  // CRON around day 9. The deviation is designer-facing balance evidence,
  // not a harness defect; the harness must measure it instead of scripting
  // the authored date (C-DES-14 removed the calendar admission gates that
  // used to mask this).
  it("reaches the eight-hour CRON buffer within ten days on a true daily cadence", () => {
    const { result, selectedActions, decisionCount } = runOpeningMilestone(
      {
        isComplete: (visible) =>
          visible.automationBuffer.ownedLevelId === "cronRuntime",
      },
      10 * DAY_MS,
    );

    expect(result.metrics.status).toBe("completed");
    expect(result.visible.automationBuffer.maxOfflineMs).toBe(8 * 60 * MINUTE_MS);
    expect(milestoneTime(result.metrics, "buffer:localScheduler")).toBeGreaterThan(0);
    expect(milestoneTime(result.metrics, "buffer:localScheduler")).toBeLessThanOrEqual(
      12 * MINUTE_MS,
    );
    expect(result.metrics.elapsedCalendarDays).toBeGreaterThanOrEqual(1);
    expect(result.metrics.elapsedCalendarDays).toBeLessThanOrEqual(10);
    expect(decisionCount).toBeLessThan(500);
    const repeatedManualDispatches = selectedActions.reduce<Record<string, number>>(
      (counts, action) => {
        if (action.type !== "startTask") return counts;
        counts[action.taskId] = (counts[action.taskId] ?? 0) + 1;
        return counts;
      },
      {},
    );
    // packetCheck is dispatched manually for research requirements across the
    // longer billed run; the ten-identical-manual-completions promise is
    // still honored for pure income work (queue insertions cover the drain).
    expect(Math.max(...Object.values(repeatedManualDispatches))).toBeLessThanOrEqual(
      12,
    );
  }, 20_000);

  it("measures full-idle clearing the CRON buffer under early billing without churn", () => {
    const harness = createMeasuredCampaignHarness("full-idle");
    const result = runCampaign({
      runtime: bootstrapSmokeRuntime,
      profile: sessionCadenceProfiles.fullIdle,
      seed: CALIBRATION_SEED,
      scheduleMode: "deterministic",
      actionPolicy: harness.actionPolicy,
      metricAdapter: harness.metricAdapter,
      completion: {
        isComplete: (visible) =>
          visible.automationBuffer.ownedLevelId === "cronRuntime",
      },
      milestones: bootstrapMilestoneAdapter,
      maximumCalendarMs: 4 * DAY_MS,
    });
    const measurement = harness.snapshot();

    // DESIGNER-FACING PACING EVIDENCE (C-DES-6 + C-DES-8 rulings): metered
    // power billing runs from the first tick, and CRON Scheduler research
    // requires the second CPU. Under the former flat 0.75/socket efficiency
    // penalty the twin-package idle draw pinned the full-idle cadence at
    // income/drain equilibrium below the 480 cr CRON Runtime buffer
    // (horizon-reached at 4 days). The 2026-07-11 graduated socket schedule
    // softens dual-socket to 0.95, cutting that idle draw enough that the
    // archetype now banks the buffer on day ~1.26 of the same seeded run.
    // The run must still be churn-free: every decision lands a real public
    // transition, nothing wedges.
    expect(result.metrics.status).toBe("completed");
    expect(result.visible.automationBuffer.maxOfflineMs).toBe(8 * 60 * MINUTE_MS);
    expect(milestoneTime(result.metrics, "buffer:cronRuntime")).toBeGreaterThan(
      1 * DAY_MS,
    );
    expect(milestoneTime(result.metrics, "buffer:cronRuntime")).toBeLessThanOrEqual(
      2 * DAY_MS,
    );
    expect(result.visible.flags.cron).toBe(true);
    expect(result.visible.standingOrder.taskId).not.toBeNull();
    expect(result.visible.standingOrder.enabled).toBe(true);
    expect(measurement.noOpActions).toBe(0);
    expect(measurement.strandedDecisions).toBe(0);
  }, 30_000);

  it("uses finite first-completion Data instead of repeat-Data farming", () => {
    expect(getTaskDefinition("byteCopy")).toMatchObject({
      rewardData: 5,
      firstCompletionData: 5,
      repeatRewardData: 0,
      repeatable: true,
    });
    expect(getTaskDefinition("packetCheck")).toMatchObject({
      rewardData: 4,
      firstCompletionData: 4,
      repeatRewardData: 0,
      repeatable: true,
    });
    expect(getTaskDefinition("microBenchmark")).toMatchObject({
      rewardData: 12,
      firstCompletionData: 12,
      repeatRewardData: 0,
      repeatable: false,
    });
    expect(getTaskDefinition("parallelismBenchmark")).toMatchObject({
      rewardData: 16,
      firstCompletionData: 16,
      repeatRewardData: 0,
      repeatable: false,
    });
  });
});
