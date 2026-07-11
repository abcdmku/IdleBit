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

  it("reaches the eight-hour CRON buffer inside the day-one-to-three window", () => {
    const { result, selectedActions, decisionCount } = runOpeningMilestone(
      {
        isComplete: (visible) =>
          visible.automationBuffer.ownedLevelId === "cronRuntime",
      },
      3 * DAY_MS,
    );

    expect(result.metrics.status).toBe("completed");
    expect(result.visible.automationBuffer.maxOfflineMs).toBe(8 * 60 * MINUTE_MS);
    expect(milestoneTime(result.metrics, "buffer:localScheduler")).toBeGreaterThan(0);
    expect(milestoneTime(result.metrics, "buffer:localScheduler")).toBeLessThanOrEqual(
      12 * MINUTE_MS,
    );
    expect(result.metrics.elapsedCalendarDays).toBeGreaterThanOrEqual(1);
    expect(result.metrics.elapsedCalendarDays).toBeLessThanOrEqual(3);
    expect(decisionCount).toBeLessThan(500);
    const repeatedManualDispatches = selectedActions.reduce<Record<string, number>>(
      (counts, action) => {
        if (action.type !== "startTask") return counts;
        counts[action.taskId] = (counts[action.taskId] ?? 0) + 1;
        return counts;
      },
      {},
    );
    expect(Math.max(...Object.values(repeatedManualDispatches))).toBeLessThanOrEqual(
      10,
    );
  }, 15_000);

  it("gives full-idle a standing order and the CRON buffer by day four without churn", () => {
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
    const cronAtMs = milestoneTime(result.metrics, "buffer:cronRuntime");

    expect(result.metrics.status).toBe("completed");
    expect(cronAtMs).toBeGreaterThanOrEqual(2 * DAY_MS);
    expect(cronAtMs).toBeLessThanOrEqual(4 * DAY_MS);
    expect(result.visible.standingOrder.taskId).not.toBeNull();
    expect(result.visible.standingOrder.enabled).toBe(true);
    expect(measurement.noOpActions).toBe(0);
    expect(measurement.strandedDecisions).toBe(0);
  }, 20_000);

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
