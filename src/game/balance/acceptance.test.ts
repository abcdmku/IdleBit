import { amount } from "../amount";
import { describe, expect, it } from "vitest";
import {
  defaultBalanceAcceptanceTargets,
  evaluateBalanceAcceptance,
  requiredAutomationBufferEvidenceIds,
  requiredCalendarMilestoneTargets,
  type BalanceAcceptanceEvidence,
} from "./acceptance";
import {
  assertCompleteCompletionDistributions,
  assertCompletionDistributionTargets,
  assertPublicCampaignTelemetry,
  auditPublicCampaignTelemetry,
  summarizeCompletionDistribution,
} from "./monteCarlo";
import type { CampaignRunMetrics, EngagementProfileId } from "./types";
import { expectedPublicRuntimeWorkloadIds } from "./workloadCoverage";

const dayMs = 24 * 60 * 60 * 1_000;

const run = (
  profileId: EngagementProfileId,
  elapsedDays: number,
  seed = 1,
): CampaignRunMetrics => ({
  runId: `${profileId}-${seed}`,
  profileId,
  seed,
  scheduleMode: "deterministic",
  status: "completed",
  startedAtMs: 0,
  completedAtMs: elapsedDays * dayMs,
  elapsedCalendarMs: elapsedDays * dayMs,
  elapsedCalendarDays: elapsedDays,
  sessionCount: 1,
  activeMinutes: 1,
  offlineHours: elapsedDays * 23,
  productiveOfflineHours: elapsedDays * 20,
  pausedOfflineHours: 0,
  overflowHours: 0,
  overflowShare: 0,
  milestones:
    profileId === "regular" || profileId === "full-idle"
      ? Object.entries(requiredCalendarMilestoneTargets[profileId]).map(
          ([id, [minimum, maximum]]) => {
            const elapsedDays = (minimum + maximum) / 2;
            return {
              id,
              label: id,
              reachedAtMs: elapsedDays * dayMs,
              elapsedDays,
            };
          },
        )
      : [],
  workMix: {
    outputUnits: amount(100),
    standingOrderOutputUnits: amount(50),
    contractOutputUnits: amount(30),
    standingOrderShare: 0.5,
    contractShare: 0.3,
  },
  resourceScarcity: [],
  roi: {
    benefit: amount(2),
    cost: amount(1),
    netValue: amount(1),
    returnRatio: 1,
  },
  powerRunway: {
    minimumHours: 24,
    averageHours: 48,
    belowTargetHours: 0,
    targetHours: 24,
  },
  blocking: { blockedHours: 0, blockedShare: 0, byReasonHours: {} },
  unusedCapacity: {
    availableCapacityHours: amount(1),
    unusedCapacityHours: amount("0.2"),
    unusedShare: 0.2,
  },
});

const passingEvidence = (): BalanceAcceptanceEvidence => ({
  deterministicRuns: [
    run("full-idle", 300),
    run("regular", 150),
    run("engaged", 105),
    run("optimizer", 75),
  ],
  velocityWindows: [
    {
      id: "post-cron-week-1",
      postCron: true,
      fullIdleOutputPerDay: 100,
      regularOutputPerDay: 200,
    },
  ],
  regularOfflineOutputUnits: 800,
  regularTotalOutputUnits: 1_000,
  buffers: requiredAutomationBufferEvidenceIds.map((levelId) => ({
      levelId,
      affordableNearIntendedChapter: true,
      viableAlternativePurchase: true,
      expectedCadenceOverflowMs: 0,
    })),
  workloads: [
    {
      workloadId: "safe-baseline",
      recommended: true,
      completed: true,
      profitabilityApplicable: true,
      netMargin: 0.31,
      grossCredits: amount(100),
      netCredits: amount(31),
      progressionShare: 0.4,
    },
  ],
  expectedWorkloadIds: expectedPublicRuntimeWorkloadIds,
  coveredWorkloadIds: expectedPublicRuntimeWorkloadIds,
  contracts: [
    {
      contractId: "sustained-contract",
      templateId: "ledgerAudit",
      kind: "sustained",
      profileId: "regular",
      authoredWorkValueMultiplier: 1.5,
      netMargin: 0.31,
      bufferCovered: true,
      creditRunwayCovered: true,
    },
    {
      contractId: "burst-contract",
      templateId: "queueRecovery",
      kind: "burst",
      profileId: "engaged",
      authoredWorkValueMultiplier: 2.5,
      netMargin: 0.4,
      bufferCovered: true,
      creditRunwayCovered: true,
    },
  ],
  standingOrderBaselines: [
    {
      id: "post-cron-week-1",
      comparisonMode: "same-public-state-contract",
      profileId: "regular",
      contractId: "sustained-contract",
      systemId: 1,
      observedAtMs: 10 * dayMs,
      standingOrderOutputPerDay: 50,
      managedOutputPerDay: 100,
    },
  ],
  absenceDestructiveLosses: 0,
  strandedFullIdleRuns: 0,
  productionDeveloperGrantActions: 0,
  postLocalManualActionShare: 0.05,
  postLocalManualProductionShare: 0.05,
});

describe("balance acceptance", () => {
  it("accepts evidence at all campaign target bands", () => {
    expect(evaluateBalanceAcceptance(passingEvidence())).toEqual({
      passed: true,
      issues: [],
    });
  });

  it("rejects one missing workload from the closed-world runtime set", () => {
    const missingId = "cloud:regionalContinuity";
    const result = evaluateBalanceAcceptance({
      ...passingEvidence(),
      coveredWorkloadIds: expectedPublicRuntimeWorkloadIds.filter(
        (workloadId) => workloadId !== missingId,
      ),
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "missing-workload-coverage",
        subjectId: missingId,
      }),
    );
  });

  it("accepts complete closed-world workload coverage", () => {
    const result = evaluateBalanceAcceptance({
      ...passingEvidence(),
    });

    expect(result.issues).not.toContainEqual(
      expect.objectContaining({ code: "missing-workload-coverage" }),
    );
  });

  it("gates workload margin from exact economics at the 30% boundary", () => {
    const evidence = passingEvidence();
    const below = evaluateBalanceAcceptance({
      ...evidence,
      workloads: [{
        ...evidence.workloads[0]!,
        // A rounded UI readout could display 30.00%, but exact evidence is 29.996%.
        netMargin: 0.3,
        grossCredits: amount(100_000),
        netCredits: amount(29_996),
      }],
    });
    const boundary = evaluateBalanceAcceptance({
      ...evidence,
      workloads: [{
        ...evidence.workloads[0]!,
        netMargin: 0.29996,
        grossCredits: amount(100_000),
        netCredits: amount(30_000),
      }],
    });

    expect(below.issues).toContainEqual(
      expect.objectContaining({ code: "workload-unprofitable" }),
    );
    expect(boundary.issues).not.toContainEqual(
      expect.objectContaining({ code: "workload-unprofitable" }),
    );
  });

  it("rejects a workload supplying 100% of Data even with no Credit output", () => {
    const evidence = passingEvidence();
    const result = evaluateBalanceAcceptance({
      ...evidence,
      workloads: [{
        workloadId: "task:data-monopoly",
        recommended: false,
        completed: true,
        profitabilityApplicable: false,
        netMargin: null,
        grossCredits: null,
        netCredits: null,
        progressionShare: 1,
      }],
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "workload-dominates",
        subjectId: "task:data-monopoly",
      }),
    );
  });

  it("does not dilute output-dominating manual work with purchase actions", () => {
    const result = evaluateBalanceAcceptance({
      ...passingEvidence(),
      postLocalManualActionShare: 0.001,
      postLocalManualProductionShare: 0.9,
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "manual-throughput-ceiling", actual: 0.9 }),
    );
  });

  it("enforces the separate post-Local manual-action ceiling", () => {
    const result = evaluateBalanceAcceptance({
      ...passingEvidence(),
      postLocalManualActionShare: 0.1,
      postLocalManualProductionShare: 0,
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "manual-action-ceiling",
        actual: 0.1,
      }),
    );
    expect(
      result.issues.some((issue) => issue.code === "manual-throughput-ceiling"),
    ).toBe(false);
  });

  it("fails missing evidence and every unsafe balance invariant", () => {
    const evidence = passingEvidence();
    const result = evaluateBalanceAcceptance({
      ...evidence,
      deterministicRuns: [run("full-idle", 100), run("regular", 300)],
      velocityWindows: [],
      regularOfflineOutputUnits: 10,
      buffers: [
        {
          levelId: "cronRuntime",
          affordableNearIntendedChapter: false,
          viableAlternativePurchase: false,
          expectedCadenceOverflowMs: 1,
        },
      ],
      workloads: [
        {
          workloadId: "task:compileCode",
          recommended: true,
          completed: true,
          profitabilityApplicable: true,
          netMargin: 0.29,
          grossCredits: amount(100),
          netCredits: amount(29),
          progressionShare: 0.66,
        },
      ],
      contracts: [],
      standingOrderBaselines: [],
      absenceDestructiveLosses: 1,
      strandedFullIdleRuns: 1,
      productionDeveloperGrantActions: 1,
      postLocalManualActionShare: 0.1,
      postLocalManualProductionShare: 0.1,
    });

    expect(result.passed).toBe(false);
    expect(new Set(result.issues.map((issue) => issue.code))).toEqual(
      new Set([
        "completion-too-fast",
        "completion-too-slow",
        "missing-run",
        "missing-velocity-window",
        "offline-output-share",
        "missing-buffer-evidence",
        "buffer-unaffordable",
        "buffer-dominates",
        "buffer-overflow",
        "workload-unprofitable",
        "workload-dominates",
        "missing-contract-evidence",
        "missing-standing-order-baseline",
        "absence-loss",
        "full-idle-stranded",
        "developer-grant",
        "manual-action-ceiling",
        "manual-throughput-ceiling",
      ]),
    );
  });

  it("fails a dominating ordinary standing task and excessive post-Local manual actions", () => {
    const evidence = passingEvidence();
    const result = evaluateBalanceAcceptance({
      ...evidence,
      workloads: [
        {
          workloadId: "task:compileCode",
          recommended: true,
          completed: true,
          profitabilityApplicable: true,
          netMargin: 0.29,
          grossCredits: amount(100),
          netCredits: amount(29),
          progressionShare: 0.66,
        },
      ],
      postLocalManualActionShare: 0.1,
      postLocalManualProductionShare: 0.1,
    });

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "workload-dominates",
          subjectId: "task:compileCode",
        }),
        expect.objectContaining({
          code: "workload-unprofitable",
          subjectId: "task:compileCode",
        }),
        expect.objectContaining({ code: "manual-throughput-ceiling" }),
      ]),
    );
  });

  it("rejects unprofitable completed output even when it was not recommended", () => {
    const evidence = passingEvidence();
    const result = evaluateBalanceAcceptance({
      ...evidence,
      workloads: [
        {
          workloadId: "completed-but-not-recommended",
          recommended: false,
          completed: true,
          profitabilityApplicable: true,
          netMargin: 0.29,
          grossCredits: amount(100),
          netCredits: amount(29),
          progressionShare: 0.1,
        },
      ],
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "workload-unprofitable",
        subjectId: "completed-but-not-recommended",
      }),
    );
  });

  it("distinguishes missing Credit margin from valid Data-only completion", () => {
    const evidence = passingEvidence();
    const result = evaluateBalanceAcceptance({
      ...evidence,
      workloads: [
        {
          workloadId: "cloud:regionalContinuity",
          recommended: false,
          completed: true,
          profitabilityApplicable: true,
          netMargin: null,
          grossCredits: null,
          netCredits: null,
          progressionShare: 0.1,
        },
        {
          workloadId: "task:data-only-proof",
          recommended: false,
          completed: true,
          profitabilityApplicable: false,
          netMargin: null,
          grossCredits: null,
          netCredits: null,
          progressionShare: 0,
        },
      ],
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "workload-margin-missing",
        subjectId: "cloud:regionalContinuity",
      }),
    );
    expect(result.issues).not.toContainEqual(
      expect.objectContaining({ subjectId: "task:data-only-proof" }),
    );
  });

  it("rejects out-of-band, unprofitable, and uncovered accepted contracts", () => {
    const evidence = passingEvidence();
    const result = evaluateBalanceAcceptance({
      ...evidence,
      contracts: [
        {
          ...evidence.contracts[0]!,
          authoredWorkValueMultiplier: 1.49,
          netMargin: 0.29,
          bufferCovered: false,
          creditRunwayCovered: false,
        },
        {
          ...evidence.contracts[1]!,
          authoredWorkValueMultiplier: 2.51,
        },
      ],
    });

    expect(new Set(result.issues.map((issue) => issue.code))).toEqual(
      new Set([
        "contract-work-value-multiplier",
        "contract-unprofitable",
        "contract-buffer-uncovered",
        "contract-runway-uncovered",
      ]),
    );
  });

  it("fails missing and drifting calendar milestones", () => {
    const evidence = passingEvidence();
    const regular = evidence.deterministicRuns.find(
      (candidate) => candidate.profileId === "regular",
    )!;
    const milestones = regular.milestones
      .filter((milestone) => milestone.id !== "buffer:localScheduler")
      .map((milestone) =>
        milestone.id === "buffer:cronRuntime"
          ? { ...milestone, elapsedDays: 0, reachedAtMs: 0 }
          : milestone.id === "buffer:systemScheduler"
            ? { ...milestone, elapsedDays: 8, reachedAtMs: 8 * dayMs }
            : milestone,
      );
    const result = evaluateBalanceAcceptance({
      ...evidence,
      deterministicRuns: evidence.deterministicRuns.map((candidate) =>
        candidate === regular ? { ...candidate, milestones } : candidate,
      ),
    });

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-milestone" }),
        expect.objectContaining({ code: "milestone-too-early" }),
        expect.objectContaining({ code: "milestone-too-late" }),
      ]),
    );
  });

  it("rejects a standing-order baseline outside 45-60% of managed output", () => {
    const result = evaluateBalanceAcceptance({
      ...passingEvidence(),
      standingOrderBaselines: [
        {
          id: "bad-baseline",
          comparisonMode: "same-public-state-contract",
          profileId: "regular",
          contractId: "sustained-contract",
          systemId: 1,
          observedAtMs: 10 * dayMs,
          standingOrderOutputPerDay: 61,
          managedOutputPerDay: 100,
        },
      ],
    });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "standing-order-baseline-share" }),
    );
  });

  it("rejects a cross-profile standing-order comparison even when its ratio passes", () => {
    const baseline = passingEvidence().standingOrderBaselines[0]!;
    const result = evaluateBalanceAcceptance({
      ...passingEvidence(),
      standingOrderBaselines: [
        { ...baseline, comparisonMode: "cross-profile-window" },
      ],
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "standing-order-baseline-uncontrolled",
        subjectId: baseline.id,
      }),
    );
  });

  it("keeps the declared targets aligned with the long-form campaign", () => {
    expect(defaultBalanceAcceptanceTargets.completionDays).toEqual({
      "full-idle": [224, 364],
      regular: [112, 182],
      engaged: [84, 126],
    });
    expect(defaultBalanceAcceptanceTargets.optimizerMinimumDays).toBe(70);
    expect(defaultBalanceAcceptanceTargets.regularToFullIdleVelocity).toEqual([
      1.8, 2.2,
    ]);
    expect(defaultBalanceAcceptanceTargets.contractWorkValueMultiplier).toEqual([
      1.5, 2.5,
    ]);
    expect(defaultBalanceAcceptanceTargets.standingOrderBaselineShare).toEqual([
      0.45, 0.6,
    ]);
  });
});

describe("Monte Carlo completion distribution", () => {
  it("uses deterministic interpolated quantiles and counts censored runs", () => {
    const incomplete = {
      ...run("regular", 200, 9),
      status: "horizon-reached" as const,
      completedAtMs: null,
    };
    const result = summarizeCompletionDistribution([
      run("regular", 100, 1),
      run("regular", 120, 2),
      run("regular", 140, 3),
      incomplete,
    ]);

    expect(result).toEqual({
      profileId: "regular",
      sampleCount: 4,
      completedCount: 3,
      completionRate: 0.75,
      minimumDays: 100,
      p10Days: 104,
      medianDays: 120,
      p90Days: 136,
      maximumDays: 140,
    });
  });

  it("requires every distribution run to contain real public-action telemetry", () => {
    const metrics = {
      ...run("regular", 120, 7),
      scheduleMode: "monte-carlo" as const,
    };
    expect(
      auditPublicCampaignTelemetry({
        metrics,
        sessionCount: 10,
        actionCount: 20,
        noOpActionCount: 0,
        intervalCount: 30,
        developerGrantActions: 0,
        strandedDecisions: 0,
        destructiveAbsenceEvents: 0,
        safelyAvoidedDestructiveEvents: 3,
      }),
    ).toMatchObject({ verified: true, failures: [] });
    expect(() =>
      assertPublicCampaignTelemetry([
        {
            metrics: { ...metrics, scheduleMode: "deterministic" },
            sessionCount: 0,
            actionCount: 0,
            noOpActionCount: 20,
            intervalCount: 0,
            developerGrantActions: 1,
            strandedDecisions: 1,
            destructiveAbsenceEvents: 1,
            safelyAvoidedDestructiveEvents: 0,
        },
      ]),
    ).toThrow(/Invalid Monte Carlo public telemetry/);
    expect(
      auditPublicCampaignTelemetry({
        metrics: {
          ...metrics,
          status: "horizon-reached",
          completedAtMs: null,
        },
          sessionCount: 10,
          actionCount: 20,
          noOpActionCount: 0,
          intervalCount: 30,
          developerGrantActions: 0,
          strandedDecisions: 0,
          destructiveAbsenceEvents: 0,
          safelyAvoidedDestructiveEvents: 0,
      }).failures,
    ).toContain("campaign did not complete within the measured horizon");

    const unsafe = auditPublicCampaignTelemetry({
      metrics: { ...metrics, overflowHours: 1, overflowShare: 0.01 },
      sessionCount: 10,
      actionCount: 10,
      noOpActionCount: 10,
      intervalCount: 30,
      developerGrantActions: 0,
      strandedDecisions: 1,
      destructiveAbsenceEvents: 1,
      safelyAvoidedDestructiveEvents: 0,
    });
    expect(unsafe.failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/no-op action share/),
        "public policy became stranded",
        "absence caused a destructive event",
        "expected-cadence attendance overflowed the Automation Buffer",
      ]),
    );
  });

  it("requires complete five-seed distributions with finite p10/p50/p90", () => {
    const completed = Array.from({ length: 5 }, (_, index) =>
      run("regular", 120 + index, index + 1),
    );
    expect(() =>
      assertCompleteCompletionDistributions(
        [summarizeCompletionDistribution(completed)],
        ["regular"],
      ),
    ).not.toThrow();

    const censored = {
      ...completed[0]!,
      status: "horizon-reached" as const,
      completedAtMs: null,
    };
    expect(() =>
      assertCompleteCompletionDistributions(
        [summarizeCompletionDistribution([censored, ...completed.slice(1)])],
        ["regular"],
      ),
    ).toThrow(/completion rate/);
  });

  it("requires Monte Carlo p10/p90 pacing to stay inside the campaign promise", () => {
    const distributions = [
      summarizeCompletionDistribution(
        [114, 120, 130, 150, 180].map((days, index) =>
          run("regular", days, index + 1),
        ),
      ),
      summarizeCompletionDistribution(
        [72, 76, 80, 90, 100].map((days, index) =>
          run("optimizer", days, index + 11),
        ),
      ),
    ];
    const targets = [
      { profileId: "regular" as const, minimumDays: 112, maximumDays: 182 },
      { profileId: "optimizer" as const, minimumDays: 70, maximumDays: null },
    ];

    expect(() =>
      assertCompletionDistributionTargets(distributions, targets),
    ).not.toThrow();
    expect(() =>
      assertCompletionDistributionTargets(
        [
          {
            ...distributions[0]!,
            p10Days: 111.99,
            p90Days: 182.01,
          },
          { ...distributions[1]!, p10Days: 69.99 },
        ],
        targets,
      ),
    ).toThrow(/Out-of-band Monte Carlo distributions/);
  });
});
