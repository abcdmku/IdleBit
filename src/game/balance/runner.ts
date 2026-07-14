import { createRngState } from "../rng";
import {
  amount,
  amountAdd,
  amountCompare,
  amountDivide,
  amountMax,
  amountMin,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
} from "../amount";
import type { AdvanceReport, TaskId, VisibleState } from "../types";
import { planReturnDelay, planSessionDuration } from "./cadence";
import {
  createMetricAccumulator,
  finalizeCampaignMetrics,
  recordMetricInterval,
  recordMilestones,
} from "./metrics";
import type {
  CampaignMetricSample,
  CampaignProgressPhase,
  CampaignRunResult,
  CampaignRunnerConfig,
  SessionScheduleEntry,
} from "./types";

const DEFAULT_OFFLINE_STEP_MS = 6 * 60 * 60 * 1000;
const DEFAULT_PROGRESS_INTERVAL_MS = 24 * 60 * 60 * 1000;
const OPENING_DECISION_STEP_MS = 2_000;
const AUTOMATED_VISIT_DECISION_PASSES = 4;

const getActiveDecisionStepMs = (
  visible: VisibleState,
  configuredStepMs: number,
  activeRemainingMs: number,
  openingMaximumStepMs: number,
  actionDispatched: boolean,
) => {
  if (visible.automationBuffer.ownedLevelId === "startingNode") {
    if (actionDispatched) {
      return Math.min(configuredStepMs, OPENING_DECISION_STEP_MS);
    }
    const timedWorkMs = visible.activeWork
      .flatMap((work) =>
        work.remainingMs !== null &&
        Number.isFinite(work.remainingMs) &&
        work.remainingMs > 0
          ? [work.remainingMs]
          : [],
      );
    const hasUntimedWork =
      visible.activeTasks.length > 0 && timedWorkMs.length === 0;
    const queueNeedsPolling = visible.queue.length > 0 && timedWorkMs.length === 0;
    const powerNeedsPolling = visible.selectedSystem.powerState !== "on";
    const nextMeaningfulWorkMs =
      timedWorkMs.length > 0
        ? Math.ceil(Math.min(...timedWorkMs) / OPENING_DECISION_STEP_MS) *
          OPENING_DECISION_STEP_MS
        : hasUntimedWork || queueNeedsPolling || powerNeedsPolling
          ? OPENING_DECISION_STEP_MS
          : openingMaximumStepMs;
    return Math.min(
      configuredStepMs,
      openingMaximumStepMs,
      Math.max(OPENING_DECISION_STEP_MS, nextMeaningfulWorkMs),
    );
  }
  // Once CRON is available, the policy represents a check-in plan, but the
  // session must remain decision-capable: completions, market refreshes, and
  // expiries change public state mid-visit exactly as they do on the live
  // 500 ms UI. Step to the next public event boundary so newly earned
  // resources and unlocks can drive further same-session decisions, and only
  // batch the remainder when no public event is pending (idle polling adds no
  // player decision and would scale evidence with UI refreshes).
  if (visible.automationBuffer.ownedLevelId !== "localScheduler") {
    const publicEventBoundaryMs = [
      ...visible.activeWork.flatMap((work) =>
        work.remainingMs !== null &&
        Number.isFinite(work.remainingMs) &&
        work.remainingMs > 0
          ? [work.remainingMs]
          : [],
      ),
      ...(visible.contractMarket.refreshAvailableInMs > 0
        ? [visible.contractMarket.refreshAvailableInMs]
        : []),
      ...visible.contracts.flatMap((contract) =>
        contract.expiresInMs !== null &&
        Number.isFinite(contract.expiresInMs) &&
        contract.expiresInMs > 0
          ? [contract.expiresInMs]
          : [],
      ),
    ];
    if (publicEventBoundaryMs.length === 0) return activeRemainingMs;
    return Math.min(
      activeRemainingMs,
      Math.max(configuredStepMs, Math.min(...publicEventBoundaryMs)),
    );
  }
  return configuredStepMs;
};

const completedUnits = (report: AdvanceReport) =>
  amount(
    Object.values(report.completedWork).reduce(
      (total, count) => total + (count ?? 0),
      0,
    ),
  );

const completedWorkDelta = (
  current: AdvanceReport["completedWork"],
  previous: AdvanceReport["completedWork"],
) => {
  const taskIds = new Set<TaskId>([
    ...(Object.keys(current) as TaskId[]),
    ...(Object.keys(previous) as TaskId[]),
  ]);
  return Object.fromEntries(
    [...taskIds]
      .map((taskId) => [
        taskId,
        Math.max(0, (current[taskId] ?? 0) - (previous[taskId] ?? 0)),
      ] as const)
      .filter(([, count]) => count > 0),
  ) as AdvanceReport["completedWork"];
};

const destructiveEventCountsDelta = (
  current: AdvanceReport["destructiveEvents"],
  previous: AdvanceReport["destructiveEvents"],
): AdvanceReport["destructiveEvents"] => ({
  psuOverload: Math.max(0, current.psuOverload - previous.psuOverload),
  unpaidBill: Math.max(0, current.unpaidBill - previous.unpaidBill),
  deadlockWipe: Math.max(0, current.deadlockWipe - previous.deadlockWipe),
});

/** Converts the engine's absence-cumulative offline report to one interval. */
export const deltaOfflineReport = (
  current: AdvanceReport,
  previous: AdvanceReport | null,
  requestedStepMs: number,
): AdvanceReport => {
  if (!previous || current.elapsedMs <= requestedStepMs) return current;
  return {
    ...current,
    elapsedMs: Math.max(0, current.elapsedMs - previous.elapsedMs),
    simulatedMs: Math.max(0, current.simulatedMs - previous.simulatedMs),
    overflowMs: Math.max(0, current.overflowMs - previous.overflowMs),
    productiveMs: Math.max(0, current.productiveMs - previous.productiveMs),
    pausedMs: Math.max(0, current.pausedMs - previous.pausedMs),
    standingOrderRenewals: Math.max(
      0,
      current.standingOrderRenewals - previous.standingOrderRenewals,
    ),
    creditsEarned: amountMax(
      0,
      amountSubtract(current.creditsEarned, previous.creditsEarned),
    ),
    creditsSpent: amountMax(
      0,
      amountSubtract(current.creditsSpent, previous.creditsSpent),
    ),
    dataEarned: amountMax(0, amountSubtract(current.dataEarned, previous.dataEarned)),
    dataSpent: amountMax(0, amountSubtract(current.dataSpent, previous.dataSpent)),
    destructiveEvents: destructiveEventCountsDelta(
      current.destructiveEvents,
      previous.destructiveEvents,
    ),
    safelyAvoidedDestructiveEvents: destructiveEventCountsDelta(
      current.safelyAvoidedDestructiveEvents,
      previous.safelyAvoidedDestructiveEvents,
    ),
    completedWork: completedWorkDelta(current.completedWork, previous.completedWork),
  };
};

const defaultMetricSample = (
  visible: VisibleState,
  report: AdvanceReport,
): CampaignMetricSample => {
  const powerCost = Math.max(0, visible.metrics.powerCostPerSecond);
  const totalCapacity = visible.metrics.activeCoreCount + visible.metrics.idleCoreCount;
  const completed = completedUnits(report);
  const standingCompleted = amount(
    (report.completionEvents ?? [])
      .reduce(
        (total, event) =>
          event.source === "standing-order"
            ? total + event.completionCount
            : total,
        0,
      ),
  );
  return {
    outputUnits: completed,
    standingOrderOutputUnits: amountMin(completed, standingCompleted),
    contractOutputUnits: amount(0),
    resourceBalances: {
      credits: visible.exactResources.credits,
      data: visible.exactResources.data,
    },
    scarceResourceIds: Object.entries(visible.exactResources)
      .filter(([, balance]) => amountCompare(balance, 0) <= 0)
      .map(([resourceId]) => resourceId),
    powerRunwayHours:
      powerCost > 0
        ? amountToSafeNumber(
            amountDivide(
              visible.exactResources.credits,
              amountMultiply(powerCost, 3_600),
            ),
          )
        : null,
    blockingReasons: [],
    usedCapacity: amount(visible.metrics.activeCoreCount),
    totalCapacity: amount(totalCapacity),
    roi: {
      benefit: amountAdd(report.creditsEarned, report.dataEarned),
      cost: amountAdd(report.creditsSpent, report.dataSpent),
    },
  };
};

/**
 * Runs a campaign exclusively through public actions, advancement, and visible state.
 * Policy, completion, and milestone adapters never receive the serializable GameState.
 */
export const runCampaign = (config: CampaignRunnerConfig): CampaignRunResult => {
  const startAtMs = Math.max(0, Math.trunc(config.startAtMs ?? 0));
  const horizonAtMs = startAtMs + Math.max(0, config.maximumCalendarMs);
  const offlineStepMs = Math.max(1, config.offlineStepMs ?? DEFAULT_OFFLINE_STEP_MS);
  const maximumActions = Math.max(1, config.maximumActionsPerDecision ?? 8);
  const accumulator = createMetricAccumulator();
  const sessions: SessionScheduleEntry[] = [];
  let state = config.runtime.createInitialState(config.seed);
  let visible = config.runtime.observe(state);
  let visibleIsCurrent = true;
  let rng = createRngState(config.seed);
  let nowMs = startAtMs;
  let sessionIndex = 0;
  let lastDeepSessionAtMs: number | null = null;
  let completed = config.completion.isComplete(visible);
  const progressCounters = {
    observations: 1,
    decisions: 0,
    proposedActions: 0,
    dispatches: 0,
    advances: 0,
    metricSamples: 0,
  };
  const progressIntervalMs = Math.max(
    0,
    config.progress?.minimumIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS,
  );
  let lastProgressAtMs = Number.NEGATIVE_INFINITY;
  let lastProgressIdentity = "";

  const observeProgress = () => {
    if (!visibleIsCurrent) {
      visible = config.runtime.observe(state);
      visibleIsCurrent = true;
      progressCounters.observations += 1;
    }
    recordMilestones(
      accumulator,
      config.milestones.getReachedMilestones(visible),
      nowMs,
      startAtMs,
    );
    completed = config.completion.isComplete(visible);
  };

  const reportProgress = (
    phase: CampaignProgressPhase,
    requestedAdvanceMs: number | null = null,
    force = false,
  ) => {
    const progress = config.progress;
    if (!progress) return;
    const identity = [
      visible.currentChapter.id,
      visible.currentObjective?.id ?? "none",
      visible.automationBuffer.ownedLevelId,
    ].join(":");
    const milestoneChanged = identity !== lastProgressIdentity;
    const beforeAdvance = phase.startsWith("before-");
    if (
      !force &&
      !milestoneChanged &&
      nowMs - lastProgressAtMs < progressIntervalMs &&
      !(beforeAdvance && progress.includeBeforeAdvance)
    ) {
      return;
    }
    const elapsedCalendarMs = Math.max(0, nowMs - startAtMs);
    const horizonMs = Math.max(0, horizonAtMs - startAtMs);
    progress.onCheckpoint({
      phase,
      profileId: config.profile.id,
      seed: config.seed,
      scheduleMode: config.scheduleMode,
      nowMs,
      elapsedCalendarMs,
      elapsedCalendarDays: elapsedCalendarMs / (24 * 60 * 60 * 1000),
      horizonMs,
      completionRatio:
        horizonMs > 0 ? Math.min(1, elapsedCalendarMs / horizonMs) : 1,
      sessionIndex,
      sessionCount: sessions.length,
      chapterId: visible.currentChapter.id,
      objectiveId: visible.currentObjective?.id ?? null,
      bufferLevelId: visible.automationBuffer.ownedLevelId,
      requestedAdvanceMs,
      completed,
      counters: { ...progressCounters },
    });
    lastProgressAtMs = nowMs;
    lastProgressIdentity = identity;
  };

  const recordAdvance = (
    intervalKind: "active" | "offline",
    elapsedMs: number,
    report: AdvanceReport,
  ) => {
    observeProgress();
    const sample =
      config.metricAdapter?.sample(visible, {
        profileId: config.profile.id,
        sessionIndex,
        nowMs,
        intervalKind,
        elapsedMs,
        report,
      }) ?? defaultMetricSample(visible, report);
    progressCounters.metricSamples += 1;
    recordMetricInterval(accumulator, intervalKind, elapsedMs, report, sample);
  };

  observeProgress();
  reportProgress("initial", null, true);
  while (!completed && nowMs < horizonAtMs) {
    const planned = planSessionDuration({
      profile: config.profile,
      mode: config.scheduleMode,
      rng,
      sessionIndex,
      nowMs,
      startAtMs,
      lastDeepSessionAtMs,
    });
    rng = planned.rng;
    sessions.push({
      index: sessionIndex,
      startsAtMs: nowMs,
      activeDurationMs: planned.activeDurationMs,
      kind: planned.kind,
    });
    if (planned.kind === "deep") lastDeepSessionAtMs = nowMs;

    let activeRemainingMs = Math.min(planned.activeDurationMs, horizonAtMs - nowMs);
    while (!completed && activeRemainingMs > 0) {
      let actionDispatched = false;
      const decisionPasses =
        visible.automationBuffer.ownedLevelId === "startingNode" ||
        visible.automationBuffer.ownedLevelId === "localScheduler"
          ? 1
          : AUTOMATED_VISIT_DECISION_PASSES;
      for (let pass = 0; pass < decisionPasses && !completed; pass += 1) {
        const decisionContext = {
          profileId: config.profile.id,
          scheduleMode: config.scheduleMode,
          sessionIndex,
          sessionKind: planned.kind,
          nowMs,
          elapsedCalendarMs: nowMs - startAtMs,
          remainingActiveMs: activeRemainingMs,
          visible,
        } as const;
        const actions = config.actionPolicy
          .selectActions(decisionContext)
          .slice(0, maximumActions);
        progressCounters.decisions += 1;
        progressCounters.proposedActions += actions.length;
        if (actions.length === 0) break;
        actionDispatched = true;
        for (const [actionIndex, action] of actions.entries()) {
          const before = visible;
          state = config.runtime.dispatch(state, action);
          visibleIsCurrent = false;
          progressCounters.dispatches += 1;
          observeProgress();
          config.actionPolicy.recordActionOutcome?.({
            decision: decisionContext,
            action,
            actionIndex,
            before,
            after: visible,
          });
          reportProgress("action");
          if (completed) break;
        }
      }
      if (completed) break;

      const stepMs = Math.min(
        activeRemainingMs,
        getActiveDecisionStepMs(
          visible,
          config.profile.decisionIntervalMs,
          activeRemainingMs,
          Math.max(
            OPENING_DECISION_STEP_MS,
            config.openingMaximumDecisionStepMs ??
              config.profile.decisionIntervalMs,
          ),
          actionDispatched,
        ),
        horizonAtMs - nowMs,
      );
      if (stepMs <= 0) break;
      reportProgress("before-active-advance", stepMs);
      const advanced = config.runtime.advance(state, stepMs, "foreground");
      state = advanced.state;
      visibleIsCurrent = false;
      progressCounters.advances += 1;
      activeRemainingMs -= stepMs;
      nowMs += stepMs;
      recordAdvance("active", stepMs, advanced.report);
      reportProgress("after-active-advance", stepMs);
    }

    if (completed || nowMs >= horizonAtMs) break;
    const returned = planReturnDelay({
      profile: config.profile,
      mode: config.scheduleMode,
      rng,
      nextSessionIndex: sessionIndex + 1,
      offlineCapacityMs: visible.automationBuffer.maxOfflineMs,
    });
    rng = returned.rng;
    const offlineDurationMs = Math.min(returned.delayMs, horizonAtMs - nowMs);
    state = config.runtime.dispatch(state, {
      type: "recordDeparture",
      timestampMs: nowMs,
    });
    visibleIsCurrent = false;

    let offlineRemainingMs = offlineDurationMs;
    while (!completed && offlineRemainingMs > 0) {
      const stepMs = Math.min(offlineRemainingMs, offlineStepMs);
      reportProgress("before-offline-advance", stepMs);
      const advanced = config.runtime.advance(state, stepMs, "offline");
      state = advanced.state;
      visibleIsCurrent = false;
      progressCounters.advances += 1;
      offlineRemainingMs -= stepMs;
      nowMs += stepMs;
      recordAdvance("offline", stepMs, advanced.intervalReport);
      reportProgress("after-offline-advance", stepMs);
    }
    sessionIndex += 1;
  }

  observeProgress();
  reportProgress("terminal", null, true);
  return {
    state,
    visible,
    sessions,
    metrics: finalizeCampaignMetrics(accumulator, {
      profileId: config.profile.id,
      seed: config.seed,
      scheduleMode: config.scheduleMode,
      startedAtMs: startAtMs,
      endedAtMs: nowMs,
      completed,
      sessionCount: sessions.length,
    }),
  };
};
