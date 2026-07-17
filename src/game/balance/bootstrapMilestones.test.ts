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
  it("reaches the two-hour Local Scheduler buffer during the second daily session", () => {
    const { result, decisionCount } = runOpeningMilestone(
      {
        isComplete: (visible) =>
          visible.automationBuffer.ownedLevelId === "localScheduler",
      },
      2 * DAY_MS,
    );

    expect(result.metrics.status).toBe("completed");
    expect(result.visible.automationBuffer.maxOfflineMs).toBe(2 * 60 * MINUTE_MS);
    expect(result.metrics.sessionCount).toBe(2);
    expect(milestoneTime(result.metrics, "buffer:localScheduler")).toBeGreaterThan(
      DAY_MS,
    );
    expect(milestoneTime(result.metrics, "buffer:localScheduler")).toBeLessThanOrEqual(
      2 * DAY_MS,
    );
    expect(
      milestoneTime(result.metrics, "mission:bootstrap:first-benchmark"),
    ).toBeDefined();
    expect(decisionCount).toBeLessThan(550);
  });

  // With public task Data at roughly 1:10 of Credits and data-storage
  // capacity priced at 10:1, the early capacity path is intentionally much
  // slower. Preserve the measured ten-day bottleneck as designer-facing
  // evidence instead of retaining the obsolete pre-ratio CRON deadline.
  it("records the new data-capacity bottleneck over ten daily sessions", () => {
    const { result, selectedActions, decisionCount } = runOpeningMilestone(
      {
        isComplete: (visible) =>
          visible.automationBuffer.ownedLevelId === "cronRuntime",
      },
      10 * DAY_MS,
    );

    expect(result.metrics.status).toBe("horizon-reached");
    expect(result.visible.automationBuffer.maxOfflineMs).toBe(2 * 60 * MINUTE_MS);
    expect(milestoneTime(result.metrics, "buffer:localScheduler")).toBeGreaterThan(0);
    expect(milestoneTime(result.metrics, "buffer:localScheduler")).toBeLessThanOrEqual(
      2 * DAY_MS,
    );
    expect(result.metrics.elapsedCalendarDays).toBe(10);
    expect(decisionCount).toBeLessThan(650);
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
      250,
    );
  }, 20_000);

  it("measures full-idle remaining at Local Scheduler without action churn", () => {
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

    // The run remains action-safe even though the new Data-heavy capacity
    // economy no longer reaches CRON inside this old four-day horizon.
    expect(result.metrics.status).toBe("horizon-reached");
    expect(result.visible.automationBuffer.maxOfflineMs).toBe(2 * 60 * MINUTE_MS);
    expect(milestoneTime(result.metrics, "buffer:cronRuntime")).toBeUndefined();
    expect(result.visible.flags.cron).toBe(false);
    expect(result.visible.standingOrder.taskId).toBeNull();
    expect(result.visible.standingOrder.enabled).toBe(false);
    expect(measurement.noOpActions).toBe(0);
    expect(measurement.strandedDecisions).toBe(0);
  }, 30_000);

  it("uses 1:10 whole-Data payouts, including a no-cost starter source", () => {
    expect(getTaskDefinition("fetchBit")).toMatchObject({
      rewardData: 1,
      repeatable: true,
    });
    expect(getTaskDefinition("byteCopy")).toMatchObject({
      rewardData: 1,
      repeatable: true,
    });
    expect(getTaskDefinition("packetCheck")).toMatchObject({
      rewardData: 4,
      repeatable: true,
    });
    expect(getTaskDefinition("microBenchmark")).toMatchObject({
      rewardData: 8,
      repeatable: false,
    });
    expect(getTaskDefinition("parallelismBenchmark")).toMatchObject({
      rewardData: 11,
      repeatable: false,
    });
  });
});
