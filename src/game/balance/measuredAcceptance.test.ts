import {
  amount,
  amountAdd,
  amountCompare,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  exactResourceBag,
} from "../amount";
import { describe, expect, it } from "vitest";
import { advanceGame } from "../advance";
import { refreshContractMarket } from "../contracts";
import { createRackReadyGameState } from "../devSeeds";
import { createInitialGameState } from "../progression";
import { projectDefinitions } from "../projects";
import { deriveVisibleState } from "../selectors";
import { applyAction } from "../simulation";
import {
  bootstrapMilestoneAdapter,
  bootstrapSmokeRuntime,
} from "./bootstrap";
import { sessionCadenceProfiles } from "./cadence";
import {
  buildMeasuredBalanceAcceptanceEvidence,
  createMeasuredCampaignHarness,
  getExactResourceOutputShare,
  getMaximumPerRunResourceShare,
  getProjectedCloudSlaMargin,
  getProjectedCloudSlaEconomics,
  getVisibleClusterWorkloadMargin,
  getVisibleClusterWorkloadEconomics,
  getVisibleTaskProjectionEconomics,
  getVisibleTaskProjectionMargin,
  hasAffordableCompetingResourcePurchase,
  rollingVelocityWindows,
  type MeasuredIntervalEvidence,
  type MeasuredProfileEvidence,
} from "./measuredAcceptance";
import { runCampaign } from "./runner";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

it("keeps every recommended campaign project phase at or above 30% exact Credit margin", () => {
  for (const project of projectDefinitions) {
    for (const phase of project.phases) {
      const creditCost = phase.costs
        .filter((cost) => cost.resource === "credits")
        .reduce((total, cost) => amountAdd(total, cost.amount), amount(0));
      const netCredits = amountSubtract(phase.rewards.credits, creditCost);

      expect(
        amountCompare(
          amountMultiply(netCredits, 10),
          amountMultiply(phase.rewards.credits, 3),
        ),
        `${project.id}:${phase.id}`,
      ).toBeGreaterThanOrEqual(0);
    }
  }
});

const measuredProfile = (
  profileId: MeasuredProfileEvidence["profileId"],
  intervals: MeasuredIntervalEvidence[],
): MeasuredProfileEvidence => ({
  profileId,
  intervals,
  contractChoices: [],
  bufferPurchases: [],
  standingOrderBaselines: [],
  overflowByBufferMs: {},
  workloadMargins: {},
  workloadEconomics: {},
  workloadCompletions: {},
  workloadOutputCredits: {},
  workloadOutputData: {},
  taskMargins: {},
  taskEconomics: {},
  taskCompletions: {},
  taskOutputCredits: {},
  taskOutputData: {},
  totalOutputCredits: amount(0),
  totalOutputData: amount(0),
  postLocalTotalOutputCredits: amount(0),
  postLocalTotalOutputData: amount(0),
  postLocalTaskOutputCredits: amount(0),
  postLocalTaskOutputData: amount(0),
  postLocalStandingOutputCredits: amount(0),
  postLocalStandingOutputData: amount(0),
  postLocalLiveOutputCredits: amount(0),
  postLocalLiveOutputData: amount(0),
  recommendedTaskIds: [],
  destructiveAbsenceEvents: 0,
  safelyAvoidedDestructiveEvents: 0,
  strandedDecisions: 0,
  developerGrantActions: 0,
  manualDispatchActions: 0,
  totalActions: 0,
  proposedActions: 0,
  noOpActions: 0,
  postLocalManualDispatchActions: 0,
  postLocalActions: 0,
});

describe("measured public campaign evidence", () => {
  it("captures source-correct projection economics for paid research benchmarks", () => {
    const initial = createInitialGameState();
    const cpu = initial.hardware.cpus[0]!;
    const state = {
      ...initial,
      systems: [],
      flags: { ...initial.flags, benchmarks: true },
      research: {
        ...initial.research,
        completed: ["benchmarkHarness" as const],
      },
      hardware: {
        ...initial.hardware,
        clockLevel: 3,
        cacheLevel: 3,
        cpus: [{ ...cpu, level: 3, cacheLevel: 3 }],
        coreClockLevels: { ...initial.hardware.coreClockLevels, 1: 3 },
      },
    };
    const visible = deriveVisibleState(state);
    const benchmark = visible.research
      .flatMap((research) => research.computeTasks)
      .find((task) => task.id === "microBenchmark")!;

    expect(benchmark).toBeDefined();
    expect(
      getVisibleTaskProjectionEconomics(
        visible,
        "microBenchmark",
        visible.selectedSystem.id,
      ),
    ).toEqual({
      grossCredits:
        benchmark.projection.rewardCredits ?? amount(benchmark.rewardCredits),
      netCredits: benchmark.projection.netRewardCredits,
    });
  });

  it("values aggregate task output and margin from its stored exact payout", () => {
    const harness = createMeasuredCampaignHarness("regular");
    const initial = createInitialGameState();
    const funded = {
      ...initial,
      exactResources: exactResourceBag("1e50", "1e50"),
      resources: { credits: 1e50, data: 1e50 },
      flags: {
        ...initial.flags,
        basicQueue: true,
        scheduler: true,
        systemCatalog: true,
        customMachineAssembly: true,
        systemStats: true,
      },
      research: {
        ...initial.research,
        completed: [
          "systemScheduler" as const,
          "systemCatalog" as const,
          "customMachineAssembly" as const,
          "cpuTierKhz" as const,
          "cpuTierMhz" as const,
          "cpuTierGhz" as const,
        ],
      },
      completedTasks: { compileCode: 1, renderFrame: 1 },
      completedJobs: { compileCode: 1, renderFrame: 1 },
    };
    const state = applyAction(funded, {
      type: "buyMachineTemplate",
      templateId: "renderBrick",
    });
    const sourceState = {
      ...state,
      standingOrder: {
        taskId: "compileCode" as const,
        systemId: state.selectedSystemId,
        enabled: true,
        renewalCount: 0,
      },
    };
    const before = deriveVisibleState(sourceState);
    const compile = before.jobs.find((job) => job.id === "compileCode")!;
    expect(compile.projection.batchMultiplier).toBeGreaterThan(1);

    const started = applyAction(sourceState, {
      type: "startTask",
      taskId: "compileCode",
    });
    const completed = advanceGame(
      started,
      Math.max(10, compile.projection.durationMs * 1.05),
      "foreground",
    );
    harness.metricAdapter.sample(deriveVisibleState(completed.state), {
      profileId: "regular",
      sessionIndex: 0,
      nowMs: Math.max(10, compile.projection.durationMs * 1.05),
      intervalKind: "active",
      elapsedMs: Math.max(10, compile.projection.durationMs * 1.05),
      report: completed.intervalReport,
    });
    const measured = harness.snapshot();
    const expectedReward = amountToSafeNumber(compile.projection.rewardCredits!);

    expect(amountToSafeNumber(measured.taskOutputCredits.compileCode!)).toBe(
      expectedReward,
    );
    expect(measured.taskCompletions.compileCode).toBeGreaterThan(0);
    expect(expectedReward).toBeGreaterThan(0);
    expect(measured.taskMargins.compileCode).toBeCloseTo(
      amountToSafeNumber(compile.projection.netRewardCredits) / expectedReward,
      10,
    );
  });

  it("uses the exact maximum Credit-or-Data share with zero-safe denominators", () => {
    expect(
      getExactResourceOutputShare(
        { credits: amount(0), data: amount(5) },
        { credits: amount(0), data: amount(5) },
      ),
    ).toBe(1);
    expect(
      getExactResourceOutputShare(
        { credits: amount(5), data: amount(9) },
        { credits: amount(10), data: amount(10) },
      ),
    ).toBe(0.9);
    expect(
      getExactResourceOutputShare(
        { credits: amount(7), data: amount(8) },
        { credits: amount(0), data: amount(0) },
      ),
    ).toBe(0);
  });

  it("takes the maximum resource share per run instead of aggregating runs", () => {
    const runs = [
      {
        output: { credits: amount(9), data: amount(0) },
        total: { credits: amount(10), data: amount(100) },
      },
      {
        output: { credits: amount(0), data: amount(8) },
        total: { credits: amount(100), data: amount(10) },
      },
    ];
    expect(
      getMaximumPerRunResourceShare(
        runs,
        (run) => run.output,
        (run) => run.total,
      ),
    ).toBe(0.9);
  });

  it("attributes post-Local manual production from output, not purchase-action count", () => {
    const harness = createMeasuredCampaignHarness("regular");
    const result = runCampaign({
      runtime: bootstrapSmokeRuntime,
      profile: sessionCadenceProfiles.regular,
      seed: 19,
      scheduleMode: "deterministic",
      actionPolicy: harness.actionPolicy,
      metricAdapter: harness.metricAdapter,
      completion: { isComplete: () => true },
      milestones: bootstrapMilestoneAdapter,
      maximumCalendarMs: 1,
    });
    const measurement: MeasuredProfileEvidence = {
      ...measuredProfile("regular", []),
      postLocalManualDispatchActions: 1,
      postLocalActions: 1_000,
      postLocalTotalOutputCredits: amount(100),
      postLocalTaskOutputCredits: amount(90),
    };

    const evidence = buildMeasuredBalanceAcceptanceEvidence([
      { result, measurement },
    ]);
    expect(evidence.postLocalManualActionShare).toBe(0.001);
    expect(evidence.postLocalManualProductionShare).toBe(0.9);

    const liveOnly = buildMeasuredBalanceAcceptanceEvidence([
      {
        result,
        measurement: {
          ...measurement,
          postLocalLiveOutputCredits: amount(90),
        },
      },
    ]);
    expect(liveOnly.postLocalManualProductionShare).toBe(0);
  });

  it("apportions rolling velocity output at both interval boundaries", () => {
    const interval = (
      outputCredits: number,
    ): MeasuredIntervalEvidence => ({
      endedAtMs: 35 * DAY_MS,
      elapsedMs: 14 * DAY_MS,
      intervalKind: "offline",
      postCron: true,
      postCronElapsedMs: 35 * DAY_MS,
      outputCredits,
      completedUnits: 1,
      standingOrderRenewals: 1,
      standingOrderCompletions: 1,
      manualUnits: 0,
      lateGame: false,
    });
    const windows = rollingVelocityWindows(
      measuredProfile("full-idle", [interval(140)]),
      measuredProfile("regular", [interval(280)]),
    );

    // Only days 21-28 overlap the first 28-day window: half of each interval.
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      fullIdleOutputPerDay: 2.5,
      regularOutputPerDay: 5,
    });
  });

  it("records every public contract-market baseline before policy filtering", () => {
    const initial = createInitialGameState();
    const market = refreshContractMarket({
      ...initial,
      // The market only rolls offers once CRON automation exists.
      flags: { ...initial.flags, cron: true },
      standingOrder: {
        taskId: "decodeBit",
        systemId: initial.selectedSystemId,
        enabled: true,
        renewalCount: 0,
      },
    });
    const visible = deriveVisibleState(market);
    const harness = createMeasuredCampaignHarness("full-idle");

    harness.actionPolicy.selectActions({
      profileId: "full-idle",
      scheduleMode: "deterministic",
      sessionIndex: 0,
      sessionKind: "check-in",
      nowMs: 0,
      elapsedCalendarMs: 0,
      remainingActiveMs: 8 * MINUTE_MS,
      visible,
    });
    const measured = harness.snapshot();

    expect(measured.contractChoices).toEqual([]);
    expect(measured.standingOrderBaselines).toHaveLength(
      visible.contracts.length,
    );
    for (const baseline of measured.standingOrderBaselines) {
      const share =
        baseline.standingOrderOutputPerDay / baseline.managedOutputPerDay;
      expect(share).toBeGreaterThanOrEqual(0.45);
      expect(share).toBeLessThanOrEqual(0.6);
    }
  });

  it("requires a positive-cost affordable purchase for buffer alternatives", () => {
    const visible = deriveVisibleState(createInitialGameState());
    expect(
      hasAffordableCompetingResourcePurchase({
        research: [],
        upgrades: [],
        projects: [],
      }),
    ).toBe(false);

    const upgrade = visible.upgrades.find(
      (candidate) => candidate.costs.length > 0,
    )!;
    expect(
      hasAffordableCompetingResourcePurchase({
        research: [],
        upgrades: [{ ...upgrade, canAfford: true }],
        projects: [],
      }),
    ).toBe(true);
  });

  it("accepts only an admitted public Cloud SLA projection as margin evidence", () => {
    const definition = deriveVisibleState(
      createInitialGameState(),
    ).cloud.slaDefinitions[0]!;
    expect(getProjectedCloudSlaMargin(definition)).toBeNull();
    expect(
      getProjectedCloudSlaMargin({
        ...definition,
        canStart: true,
        blockedReason: null,
        projection: {
          ...definition.projection!,
          marginBps: 3_500,
          blockedReason: null,
        },
      }),
    ).toBe(0.35);
    expect(
      getProjectedCloudSlaEconomics({
        ...definition,
        canStart: true,
        blockedReason: null,
        projection: {
          ...definition.projection!,
          rewards: exactResourceBag("100000", "0"),
          netRewardCredits: amount("29996"),
          marginBps: 3_000,
          blockedReason: null,
        },
      }),
    ).toEqual({
      grossCredits: amount("100000"),
      netCredits: amount("29996"),
    });
  });

  it("uses realized cluster spend when work completes before a projection sample", () => {
    const workload = {
        status: "completed",
        rewards: exactResourceBag("100", "5"),
        operatingCreditsSpent: exactResourceBag("20", "0").credits,
        projection: {
          durationMs: exactResourceBag().credits,
          operatingCost: exactResourceBag().credits,
          netCreditReward: exactResourceBag().credits,
          marginBps: null,
          bufferCovered: true,
          pauseReason: "completed",
        },
      } as const;
    expect(getVisibleClusterWorkloadMargin(workload)).toBe(0.8);
    expect(getVisibleClusterWorkloadEconomics(workload)).toEqual({
      grossCredits: amount(100),
      netCredits: amount(80),
    });
  });

  it("does not attribute a selected-system task projection to another system", () => {
    const visible = deriveVisibleState(createInitialGameState());
    expect(
      getVisibleTaskProjectionMargin(
        visible,
        "fetchBit",
        visible.selectedSystem.id,
      ),
    ).not.toBeNull();
    expect(
      getVisibleTaskProjectionMargin(
        visible,
        "fetchBit",
        visible.selectedSystem.id + 1,
      ),
    ).toBeNull();
  });

  it("preserves Data-only task completion evidence without inventing a margin", () => {
    const harness = createMeasuredCampaignHarness("regular");
    const state = createInitialGameState();
    const advanced = advanceGame(state, 1, "foreground");
    harness.metricAdapter.sample(deriveVisibleState(advanced.state), {
      profileId: "regular",
      sessionIndex: 0,
      nowMs: 1,
      intervalKind: "active",
      elapsedMs: 1,
      report: {
        ...advanced.intervalReport,
        dataEarned: amount(5),
        completionEvents: [
          {
            source: "task",
            instanceId: "data-only-proof",
            workId: "workstationBenchmark",
            name: "Data-only proof",
            completionCount: 1,
            workCycles: exactResourceBag("1", "0").credits,
            creditsEarned: exactResourceBag().credits,
            dataEarned: exactResourceBag("0", "5").data,
          },
        ],
      },
    });

    expect(harness.snapshot()).toMatchObject({
      taskCompletions: { workstationBenchmark: 1 },
      taskOutputCredits: { workstationBenchmark: amount(0) },
      taskOutputData: { workstationBenchmark: amount(5) },
    });
    const completedRun = runCampaign({
      runtime: bootstrapSmokeRuntime,
      profile: sessionCadenceProfiles.regular,
      seed: 7,
      scheduleMode: "deterministic",
      actionPolicy: harness.actionPolicy,
      metricAdapter: harness.metricAdapter,
      completion: { isComplete: () => true },
      milestones: bootstrapMilestoneAdapter,
      maximumCalendarMs: 1,
    });
    expect(
      buildMeasuredBalanceAcceptanceEvidence([
        { result: completedRun, measurement: harness.snapshot() },
      ]).workloads,
    ).toContainEqual(
      expect.objectContaining({
        workloadId: "task:workstationBenchmark",
        completed: true,
        profitabilityApplicable: false,
        netMargin: null,
        progressionShare: 1,
      }),
    );
  });

  it("counts only committed offline destructive telemetry in acceptance evidence", () => {
    const harness = createMeasuredCampaignHarness("regular");
    const advanced = advanceGame(createInitialGameState(), 1, "foreground");
    const visible = deriveVisibleState(advanced.state);
    const sample = (
      destructiveEvents: typeof advanced.intervalReport.destructiveEvents,
      safelyAvoidedDestructiveEvents: typeof advanced.intervalReport.safelyAvoidedDestructiveEvents,
    ) =>
      harness.metricAdapter.sample(visible, {
        profileId: "regular",
        sessionIndex: 0,
        nowMs: 1,
        intervalKind: "offline",
        elapsedMs: 1,
        report: {
          ...advanced.intervalReport,
          destructiveEvents,
          safelyAvoidedDestructiveEvents,
        },
      });

    sample(
      { psuOverload: 0, unpaidBill: 0, deadlockWipe: 0 },
      { psuOverload: 0, unpaidBill: 0, deadlockWipe: 2 },
    );
    expect(harness.snapshot()).toMatchObject({
      destructiveAbsenceEvents: 0,
      safelyAvoidedDestructiveEvents: 2,
    });

    sample(
      { psuOverload: 1, unpaidBill: 2, deadlockWipe: 0 },
      { psuOverload: 0, unpaidBill: 0, deadlockWipe: 0 },
    );
    expect(harness.snapshot()).toMatchObject({
      destructiveAbsenceEvents: 3,
      safelyAvoidedDestructiveEvents: 2,
    });
  });

  it("uses completion provenance instead of renewal starts for standing attribution", () => {
    const harness = createMeasuredCampaignHarness("regular");
    const advanced = advanceGame(createInitialGameState(), 1, "foreground");
    const metric = harness.metricAdapter.sample(deriveVisibleState(advanced.state), {
      profileId: "regular",
      sessionIndex: 0,
      nowMs: 1,
      intervalKind: "active",
      elapsedMs: 1,
      report: {
        ...advanced.intervalReport,
        standingOrderRenewals: 99,
        completedWork: { fetchBit: 2 },
        creditsEarned: amount(5),
        completionEvents: [
          {
            source: "task",
            instanceId: "manual-before-renewal",
            workId: "fetchBit",
            name: "Manual Fetch",
            completionCount: 1,
            workCycles: amount(1),
            creditsEarned: amount(2),
            dataEarned: amount(0),
          },
          {
            source: "standing-order",
            instanceId: "standing-after-manual",
            workId: "fetchBit",
            name: "Standing Fetch",
            completionCount: 1,
            workCycles: amount(1),
            creditsEarned: amount(3),
            dataEarned: amount(0),
          },
        ],
      },
    });

    expect(harness.snapshot().intervals[0]).toEqual(
      expect.objectContaining({
        completedUnits: 2,
        standingOrderRenewals: 99,
        standingOrderCompletions: 1,
        manualUnits: 1,
      }),
    );
    expect(harness.snapshot().taskCompletions.fetchBit).toBe(2);
    expect(metric.standingOrderOutputUnits).toBe(amount(3));
  });

  it("attributes projects, attended services, and Workshop storage separately", () => {
    const harness = createMeasuredCampaignHarness("regular");
    // Projects need a chapter, research, and RAM-capable base to be visible;
    // the rack-ready seed is the canonical one.
    const advanced = advanceGame(createRackReadyGameState(), 1, "foreground");
    const baseVisible = deriveVisibleState(advanced.state);
    const project = baseVisible.projects.find(
      (candidate) => candidate.id === "schedulerIntegration",
    )!;
    const phase = project.currentPhase!;
    const storageReward = baseVisible.workshop.storageWorkload.rewards.credits;
    const visible = {
      ...baseVisible,
      projects: baseVisible.projects.map((candidate) =>
        candidate.id === project.id ? { ...candidate, active: true } : candidate,
      ),
      workshop: {
        ...baseVisible.workshop,
        storageWorkload: {
          ...baseVisible.workshop.storageWorkload,
          active: true,
          projection: {
            ...baseVisible.workshop.storageWorkload.projection,
            durationMs: amount(1_000),
            operatingCostCredits: amount(123),
            netRewardCredits: amountSubtract(storageReward, 123),
          },
        },
      },
      liveOperations: {
        ...baseVisible.liveOperations,
        enabled: true,
        systemId: 1,
        activeTaskId: "liveQueueTriage" as const,
        projectedRewardCredits: amount(2_160),
        projectedNetRewardCredits: amount(2_000),
        blockedReason: null,
      },
    };
    harness.metricAdapter.sample(visible, {
      profileId: "regular",
      sessionIndex: 0,
      nowMs: 1,
      intervalKind: "active",
      elapsedMs: 1,
      report: {
        ...advanced.intervalReport,
        creditsEarned: amountAdd(
          amountAdd(phase.rewards.credits, storageReward),
          2_160,
        ),
        dataEarned: amountAdd(
          phase.rewards.data,
          baseVisible.workshop.storageWorkload.rewards.data,
        ),
        completedWork: { liveQueueTriage: 1 },
        completionEvents: [
          {
            source: "live-operations",
            instanceId: "live-operations:liveQueueTriage:1",
            workId: "liveQueueTriage",
            name: "Queue Triage",
            completionCount: 1,
            workCycles: amount(900),
            creditsEarned: amount(2_160),
            dataEarned: amount(0),
          },
          {
            source: "project",
            instanceId: `${project.id}:${phase.id}`,
            workId: project.id,
            phaseId: phase.id,
            name: `${project.name} · ${phase.name}`,
            creditsEarned: phase.rewards.credits,
            dataEarned: phase.rewards.data,
          },
          {
            source: "workshop-storage",
            instanceId: "workshop-storage:1:1",
            workId: baseVisible.workshop.storageWorkload.id,
            name: baseVisible.workshop.storageWorkload.name,
            completionCount: 1,
            creditsEarned: storageReward,
            dataEarned: baseVisible.workshop.storageWorkload.rewards.data,
          },
        ],
      },
    });

    const measured = harness.snapshot();
    expect(measured.taskCompletions.liveQueueTriage).toBeUndefined();
    expect(measured.workloadCompletions).toMatchObject({
      "live-operations:liveQueueTriage": 1,
      "project:schedulerIntegration:queue-map": 1,
      "workshop-storage:artifactStaging": 1,
    });
    expect(measured.workloadEconomics).toMatchObject({
      "live-operations:liveQueueTriage": {
        grossCredits: amount(2_160),
        netCredits: amount(2_000),
      },
      "project:schedulerIntegration:queue-map": {
        grossCredits: phase.rewards.credits,
        netCredits: amountSubtract(phase.rewards.credits, 200),
      },
      "workshop-storage:artifactStaging": {
        grossCredits: storageReward,
        netCredits: amountSubtract(storageReward, 123),
      },
    });
  });

  it("records exact task output, buffer alternatives, actions, and safety without private state", () => {
    const harness = createMeasuredCampaignHarness("regular");
    const result = runCampaign({
      runtime: bootstrapSmokeRuntime,
      profile: sessionCadenceProfiles.regular,
      seed: 31_415,
      scheduleMode: "deterministic",
      actionPolicy: harness.actionPolicy,
      metricAdapter: harness.metricAdapter,
      completion: {
        isComplete: (visible) =>
          visible.automationBuffer.ownedLevelId === "localScheduler",
      },
      milestones: bootstrapMilestoneAdapter,
      maximumCalendarMs: 2 * 24 * 60 * MINUTE_MS,
      offlineStepMs: 24 * 60 * MINUTE_MS,
    });
    const measured = harness.snapshot();

    expect(result.metrics.status).toBe("completed");
    expect(amountCompare(result.metrics.workMix.outputUnits, 0)).toBeGreaterThan(0);
    expect(measured.bufferPurchases).toContainEqual(
      expect.objectContaining({
        levelId: "localScheduler",
        affordable: true,
        viableAlternativePurchase: true,
      }),
    );
    expect(
      Object.values(measured.taskOutputCredits).some(
        (value) => amountCompare(value, 0) > 0,
      ),
    ).toBe(true);
    expect(measured.totalActions).toBeGreaterThan(0);
    expect(measured.proposedActions).toBeGreaterThanOrEqual(
      measured.totalActions + measured.noOpActions,
    );
    expect(measured.developerGrantActions).toBe(0);
    expect(measured.destructiveAbsenceEvents).toBe(0);
  });

  it("treats an all-no-op uncovered public decision as stranding", () => {
    const harness = createMeasuredCampaignHarness("full-idle");
    const visible = deriveVisibleState(createInitialGameState());
    const decision = {
      profileId: "full-idle" as const,
      scheduleMode: "deterministic" as const,
      sessionIndex: 0,
      sessionKind: "check-in" as const,
      nowMs: 0,
      elapsedCalendarMs: 0,
      remainingActiveMs: 8 * MINUTE_MS,
      visible,
    };
    const actions = harness.actionPolicy.selectActions(decision);
    expect(actions.length).toBeGreaterThan(0);

    actions.forEach((action, actionIndex) => {
      harness.actionPolicy.recordActionOutcome?.({
        decision,
        action,
        actionIndex,
        before: visible,
        after: visible,
      });
    });

    expect(harness.snapshot()).toMatchObject({
      noOpActions: actions.length,
      strandedDecisions: 1,
    });
  });
});
