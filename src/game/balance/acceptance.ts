import {
  amountCompare,
  amountDivide,
  amountMultiply,
  amountToSafeNumber,
  type Amount,
} from "../amount";
import type { CampaignRunMetrics, EngagementProfileId } from "./types";
import { expectedPublicRuntimeWorkloadIds } from "./workloadCoverage";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface BalanceAcceptanceTargets {
  completionDays: Readonly<
    Record<Exclude<EngagementProfileId, "optimizer">, readonly [number, number]>
  >;
  optimizerMinimumDays: number;
  regularToFullIdleVelocity: readonly [number, number];
  regularOfflineOutputShare: readonly [number, number];
  contractWorkValueMultiplier: readonly [number, number];
  standingOrderBaselineShare: readonly [number, number];
  minimumRecommendedMargin: number;
  maximumJobShare: number;
}

export const defaultBalanceAcceptanceTargets: BalanceAcceptanceTargets = {
  completionDays: {
    "full-idle": [224, 364],
    regular: [112, 182],
    engaged: [84, 126],
  },
  optimizerMinimumDays: 70,
  regularToFullIdleVelocity: [1.8, 2.2],
  regularOfflineOutputShare: [0.75, 0.9],
  contractWorkValueMultiplier: [1.5, 2.5],
  standingOrderBaselineShare: [0.45, 0.6],
  minimumRecommendedMargin: 0.3,
  maximumJobShare: 0.65,
};

export interface VelocityWindowEvidence {
  id: string;
  /** Windows before CRON are deliberately excluded from the 2x target. */
  postCron: boolean;
  fullIdleOutputPerDay: number;
  regularOutputPerDay: number;
}

export interface BufferAcceptanceEvidence {
  levelId: string;
  affordableNearIntendedChapter: boolean;
  viableAlternativePurchase: boolean;
  expectedCadenceOverflowMs: number;
}

export interface WorkloadAcceptanceEvidence {
  workloadId: string;
  recommended: boolean;
  /** True when measured completion events prove this workload produced output. */
  completed: boolean;
  /** Data-only work has no Credit margin and remains valid completion evidence. */
  profitabilityApplicable: boolean;
  /** Null means a Credit-paying source lacks a public, source-correct projection. */
  netMargin: number | null;
  /** Exact source-correct economics; acceptance never gates on rounded UI margin. */
  grossCredits: Amount | null;
  netCredits: Amount | null;
  progressionShare: number;
}

export interface ContractAcceptanceEvidence {
  contractId: string;
  templateId: string;
  kind: "sustained" | "burst";
  profileId: EngagementProfileId;
  authoredWorkValueMultiplier: number | null;
  netMargin: number;
  bufferCovered: boolean;
  creditRunwayCovered: boolean;
}

export interface StandingOrderBaselineEvidence {
  id: string;
  comparisonMode: "same-public-state-contract" | "cross-profile-window";
  profileId: EngagementProfileId;
  contractId: string;
  systemId: number;
  observedAtMs: number;
  standingOrderOutputPerDay: number;
  managedOutputPerDay: number;
}

export interface BalanceAcceptanceEvidence {
  deterministicRuns: readonly CampaignRunMetrics[];
  velocityWindows: readonly VelocityWindowEvidence[];
  regularOfflineOutputUnits: number;
  regularTotalOutputUnits: number;
  buffers: readonly BufferAcceptanceEvidence[];
  workloads: readonly WorkloadAcceptanceEvidence[];
  /** Authoritative closed-world runtime IDs expected from content definitions. */
  expectedWorkloadIds: readonly string[];
  /** Expected IDs for which a measured run supplied economics/completion evidence. */
  coveredWorkloadIds: readonly string[];
  contracts: readonly ContractAcceptanceEvidence[];
  standingOrderBaselines: readonly StandingOrderBaselineEvidence[];
  absenceDestructiveLosses: number;
  strandedFullIdleRuns: number;
  productionDeveloperGrantActions: number;
  /** Player start-task actions after Local Scheduler / all policy actions. */
  postLocalManualActionShare: number;
  /** Conservative non-standing task output / all post-Local output. */
  postLocalManualProductionShare: number;
}

export type BalanceAcceptanceCode =
  | "missing-run"
  | "campaign-incomplete"
  | "completion-too-fast"
  | "completion-too-slow"
  | "missing-velocity-window"
  | "velocity-ratio"
  | "offline-output-share"
  | "missing-buffer-evidence"
  | "buffer-unaffordable"
  | "buffer-dominates"
  | "buffer-overflow"
  | "missing-workload-evidence"
  | "missing-workload-coverage"
  | "workload-margin-missing"
  | "workload-unprofitable"
  | "workload-dominates"
  | "missing-contract-evidence"
  | "contract-work-value-multiplier"
  | "contract-unprofitable"
  | "contract-buffer-uncovered"
  | "contract-runway-uncovered"
  | "missing-standing-order-baseline"
  | "standing-order-baseline-uncontrolled"
  | "standing-order-baseline-share"
  | "missing-milestone"
  | "milestone-too-early"
  | "milestone-too-late"
  | "absence-loss"
  | "full-idle-stranded"
  | "developer-grant"
  | "manual-action-ceiling"
  | "manual-throughput-ceiling";

export interface BalanceAcceptanceIssue {
  code: BalanceAcceptanceCode;
  message: string;
  subjectId?: string;
  actual?: number;
  minimum?: number;
  maximum?: number;
}

export interface BalanceAcceptanceResult {
  passed: boolean;
  issues: BalanceAcceptanceIssue[];
}

export const requiredAutomationBufferEvidenceIds = [
  "localScheduler",
  "cronRuntime",
  "systemScheduler",
  "fleetOrchestrator",
  "clusterController",
  "rackController",
  "dataCenterNoc",
  "globalScheduler",
] as const;

export const requiredCalendarMilestoneTargets = {
  regular: {
    "buffer:localScheduler": [0, 1],
    "buffer:cronRuntime": [1, 3],
    "buffer:systemScheduler": [4, 7],
    "buffer:fleetOrchestrator": [14, 21],
    "buffer:clusterController": [49, 70],
    "buffer:rackController": [70, 84],
    "buffer:dataCenterNoc": [77, 98],
    "mission:cloud:availability": [105, 126],
    "buffer:globalScheduler": [133, 154],
    "mission:planetary:finale": [161, 182],
  },
  "full-idle": {
    "buffer:localScheduler": [0, 1],
    "buffer:cronRuntime": [2, 4],
    "buffer:systemScheduler": [7, 14],
    "buffer:fleetOrchestrator": [28, 42],
    "buffer:clusterController": [98, 140],
    "buffer:rackController": [140, 168],
    "buffer:dataCenterNoc": [154, 196],
    "mission:cloud:availability": [210, 252],
    "buffer:globalScheduler": [266, 308],
    "mission:planetary:finale": [322, 364],
  },
} as const satisfies Readonly<
  Record<
    "regular" | "full-idle",
    Readonly<Record<string, readonly [number, number]>>
  >
>;

const finiteNonNegative = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

const completionDays = (run: CampaignRunMetrics) =>
  run.completedAtMs === null
    ? null
    : Math.max(0, run.completedAtMs - run.startedAtMs) / DAY_MS;

const deterministicRunFor = (
  runs: readonly CampaignRunMetrics[],
  profileId: EngagementProfileId,
) =>
  runs.find(
    (run) =>
      run.profileId === profileId && run.scheduleMode === "deterministic",
  );

const evaluateCompletion = (
  issues: BalanceAcceptanceIssue[],
  evidence: BalanceAcceptanceEvidence,
  targets: BalanceAcceptanceTargets,
) => {
  const profiles: readonly EngagementProfileId[] = [
    "full-idle",
    "regular",
    "engaged",
    "optimizer",
  ];
  for (const profileId of profiles) {
    const run = deterministicRunFor(evidence.deterministicRuns, profileId);
    if (!run) {
      issues.push({
        code: "missing-run",
        subjectId: profileId,
        message: `Missing deterministic ${profileId} campaign run.`,
      });
      continue;
    }
    const days = completionDays(run);
    if (run.status !== "completed" || days === null) {
      issues.push({
        code: "campaign-incomplete",
        subjectId: profileId,
        actual: run.elapsedCalendarDays,
        message: `${profileId} did not complete within its simulation horizon.`,
      });
      continue;
    }
    if (profileId === "optimizer") {
      if (days < targets.optimizerMinimumDays) {
        issues.push({
          code: "completion-too-fast",
          subjectId: profileId,
          actual: days,
          minimum: targets.optimizerMinimumDays,
          message: `optimizer completed in ${days.toFixed(2)} days; minimum is ${targets.optimizerMinimumDays}.`,
        });
      }
      continue;
    }
    const [minimum, maximum] = targets.completionDays[profileId];
    if (days < minimum) {
      issues.push({
        code: "completion-too-fast",
        subjectId: profileId,
        actual: days,
        minimum,
        maximum,
        message: `${profileId} completed in ${days.toFixed(2)} days; target is ${minimum}-${maximum}.`,
      });
    } else if (days > maximum) {
      issues.push({
        code: "completion-too-slow",
        subjectId: profileId,
        actual: days,
        minimum,
        maximum,
        message: `${profileId} completed in ${days.toFixed(2)} days; target is ${minimum}-${maximum}.`,
      });
    }
  }
};

const evaluateCalendarMilestones = (
  issues: BalanceAcceptanceIssue[],
  evidence: BalanceAcceptanceEvidence,
) => {
  for (const profileId of ["regular", "full-idle"] as const) {
    const run = deterministicRunFor(evidence.deterministicRuns, profileId);
    if (!run) continue;
    const milestones = new Map(
      run.milestones.map((milestone) => [milestone.id, milestone]),
    );
    for (const [milestoneId, [minimum, maximum]] of Object.entries(
      requiredCalendarMilestoneTargets[profileId],
    )) {
      const milestone = milestones.get(milestoneId);
      const subjectId = `${profileId}:${milestoneId}`;
      if (!milestone) {
        issues.push({
          code: "missing-milestone",
          subjectId,
          minimum,
          maximum,
          message: `Missing ${profileId} calendar milestone ${milestoneId}.`,
        });
      } else if (milestone.elapsedDays < minimum) {
        issues.push({
          code: "milestone-too-early",
          subjectId,
          actual: milestone.elapsedDays,
          minimum,
          maximum,
          message: `${subjectId} arrived at day ${milestone.elapsedDays.toFixed(2)}; target is ${minimum}-${maximum}.`,
        });
      } else if (milestone.elapsedDays > maximum) {
        issues.push({
          code: "milestone-too-late",
          subjectId,
          actual: milestone.elapsedDays,
          minimum,
          maximum,
          message: `${subjectId} arrived at day ${milestone.elapsedDays.toFixed(2)}; target is ${minimum}-${maximum}.`,
        });
      }
    }
  }
};

/**
 * Evaluates the non-negotiable campaign balance gates from measured evidence.
 * Missing evidence is a failure: CI must never infer that an unmeasured target
 * passed.
 */
export const evaluateBalanceAcceptance = (
  evidence: BalanceAcceptanceEvidence,
  targets: BalanceAcceptanceTargets = defaultBalanceAcceptanceTargets,
): BalanceAcceptanceResult => {
  const issues: BalanceAcceptanceIssue[] = [];
  evaluateCompletion(issues, evidence, targets);
  evaluateCalendarMilestones(issues, evidence);

  const postCronWindows = evidence.velocityWindows.filter(
    (window) => window.postCron,
  );
  if (postCronWindows.length === 0) {
    issues.push({
      code: "missing-velocity-window",
      message: "No post-CRON rolling velocity evidence was supplied.",
    });
  }
  for (const window of postCronWindows) {
    const fullIdle = finiteNonNegative(window.fullIdleOutputPerDay);
    const regular = finiteNonNegative(window.regularOutputPerDay);
    const ratio = fullIdle > 0 ? regular / fullIdle : Number.POSITIVE_INFINITY;
    const [minimum, maximum] = targets.regularToFullIdleVelocity;
    if (!Number.isFinite(ratio) || ratio < minimum || ratio > maximum) {
      issues.push({
        code: "velocity-ratio",
        subjectId: window.id,
        actual: ratio,
        minimum,
        maximum,
        message: `${window.id} regular/full-idle velocity is ${ratio}; target is ${minimum}-${maximum}.`,
      });
    }
  }

  const totalOutput = finiteNonNegative(evidence.regularTotalOutputUnits);
  const offlineOutput = Math.min(
    totalOutput,
    finiteNonNegative(evidence.regularOfflineOutputUnits),
  );
  const offlineShare = totalOutput > 0 ? offlineOutput / totalOutput : 0;
  const [offlineMinimum, offlineMaximum] =
    targets.regularOfflineOutputShare;
  if (offlineShare < offlineMinimum || offlineShare > offlineMaximum) {
    issues.push({
      code: "offline-output-share",
      actual: offlineShare,
      minimum: offlineMinimum,
      maximum: offlineMaximum,
      message: `Regular offline output share is ${offlineShare}; target is ${offlineMinimum}-${offlineMaximum}.`,
    });
  }

  const buffersById = new Map(
    evidence.buffers.map((buffer) => [buffer.levelId, buffer]),
  );
  for (const levelId of requiredAutomationBufferEvidenceIds) {
    if (buffersById.has(levelId)) continue;
    issues.push({
      code: "missing-buffer-evidence",
      subjectId: levelId,
      message: `Missing affordability/cadence evidence for ${levelId}.`,
    });
  }
  for (const buffer of evidence.buffers) {
    if (!buffer.affordableNearIntendedChapter) {
      issues.push({
        code: "buffer-unaffordable",
        subjectId: buffer.levelId,
        message: `${buffer.levelId} is not affordable near its intended chapter.`,
      });
    }
    if (!buffer.viableAlternativePurchase) {
      issues.push({
        code: "buffer-dominates",
        subjectId: buffer.levelId,
        message: `${buffer.levelId} has no viable competing purchase.`,
      });
    }
    if (finiteNonNegative(buffer.expectedCadenceOverflowMs) > 0) {
      issues.push({
        code: "buffer-overflow",
        subjectId: buffer.levelId,
        actual: finiteNonNegative(buffer.expectedCadenceOverflowMs),
        maximum: 0,
        message: `${buffer.levelId} loses time at the expected return cadence.`,
      });
    }
  }

  if (evidence.workloads.length === 0) {
    issues.push({
      code: "missing-workload-evidence",
      message: "No workload profitability or progression-share evidence was supplied.",
    });
  }
  const coveredWorkloadIds = new Set(evidence.coveredWorkloadIds);
  const expectedWorkloadIds = new Set([
    ...expectedPublicRuntimeWorkloadIds,
    ...evidence.expectedWorkloadIds,
  ]);
  for (const workloadId of expectedWorkloadIds) {
    if (coveredWorkloadIds.has(workloadId)) continue;
    issues.push({
      code: "missing-workload-coverage",
      subjectId: workloadId,
      message: `${workloadId} has no measured public runtime evidence.`,
    });
  }
  for (const workload of evidence.workloads) {
    const shouldValidateMargin =
      workload.profitabilityApplicable &&
      (workload.recommended || workload.completed);
    const hasExactEconomics =
      workload.grossCredits !== null &&
      workload.netCredits !== null &&
      amountCompare(workload.grossCredits, 0) > 0;
    if (shouldValidateMargin && !hasExactEconomics) {
      issues.push({
        code: "workload-margin-missing",
        subjectId: workload.workloadId,
        message: `${workload.workloadId} completed or was recommended without a source-correct Credit margin.`,
      });
    }
    const minimumMarginBps = Math.round(
      targets.minimumRecommendedMargin * 10_000,
    );
    if (
      shouldValidateMargin &&
      hasExactEconomics &&
      amountCompare(
        amountMultiply(workload.netCredits!, 10_000),
        amountMultiply(workload.grossCredits!, minimumMarginBps),
      ) < 0
    ) {
      const exactMargin = amountToSafeNumber(
        amountDivide(workload.netCredits!, workload.grossCredits!),
      );
      issues.push({
        code: "workload-unprofitable",
        subjectId: workload.workloadId,
        actual: exactMargin,
        minimum: targets.minimumRecommendedMargin,
        message: `${workload.workloadId} margin is ${exactMargin}; minimum is ${targets.minimumRecommendedMargin}.`,
      });
    }
    if (
      !Number.isFinite(workload.progressionShare) ||
      workload.progressionShare > targets.maximumJobShare
    ) {
      issues.push({
        code: "workload-dominates",
        subjectId: workload.workloadId,
        actual: workload.progressionShare,
        maximum: targets.maximumJobShare,
        message: `${workload.workloadId} supplies ${workload.progressionShare} of progression; maximum is ${targets.maximumJobShare}.`,
      });
    }
  }

  for (const requiredKind of ["sustained", "burst"] as const) {
    if (evidence.contracts.some((contract) => contract.kind === requiredKind)) {
      continue;
    }
    issues.push({
      code: "missing-contract-evidence",
      subjectId: requiredKind,
      message: `No accepted ${requiredKind} contract evidence was supplied.`,
    });
  }
  const [contractMinimum, contractMaximum] =
    targets.contractWorkValueMultiplier;
  for (const contract of evidence.contracts) {
    const multiplier = contract.authoredWorkValueMultiplier;
    if (
      multiplier === null ||
      !Number.isFinite(multiplier) ||
      multiplier < contractMinimum ||
      multiplier > contractMaximum
    ) {
      issues.push({
        code: "contract-work-value-multiplier",
        subjectId: contract.contractId,
        actual: multiplier ?? Number.NaN,
        minimum: contractMinimum,
        maximum: contractMaximum,
        message: `${contract.contractId} authored work-value multiplier is ${multiplier}; target is ${contractMinimum}-${contractMaximum}.`,
      });
    }
    if (
      !Number.isFinite(contract.netMargin) ||
      contract.netMargin < targets.minimumRecommendedMargin
    ) {
      issues.push({
        code: "contract-unprofitable",
        subjectId: contract.contractId,
        actual: contract.netMargin,
        minimum: targets.minimumRecommendedMargin,
        message: `${contract.contractId} margin is ${contract.netMargin}; minimum is ${targets.minimumRecommendedMargin}.`,
      });
    }
    if (!contract.bufferCovered) {
      issues.push({
        code: "contract-buffer-uncovered",
        subjectId: contract.contractId,
        message: `${contract.contractId} was accepted without Automation Buffer coverage.`,
      });
    }
    if (!contract.creditRunwayCovered) {
      issues.push({
        code: "contract-runway-uncovered",
        subjectId: contract.contractId,
        message: `${contract.contractId} was accepted without credit runway coverage.`,
      });
    }
  }

  if (evidence.standingOrderBaselines.length === 0) {
    issues.push({
      code: "missing-standing-order-baseline",
      message:
        "No measured standing-order baseline versus managed-output evidence was supplied.",
    });
  }
  const [baselineMinimum, baselineMaximum] =
    targets.standingOrderBaselineShare;
  for (const baseline of evidence.standingOrderBaselines) {
    if (baseline.comparisonMode !== "same-public-state-contract") {
      issues.push({
        code: "standing-order-baseline-uncontrolled",
        subjectId: baseline.id,
        message: `${baseline.id} does not compare standing and managed output from the same public state.`,
      });
    }
    const standing = finiteNonNegative(baseline.standingOrderOutputPerDay);
    const managed = finiteNonNegative(baseline.managedOutputPerDay);
    const share = managed > 0 ? standing / managed : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(share) || share < baselineMinimum || share > baselineMaximum) {
      issues.push({
        code: "standing-order-baseline-share",
        subjectId: baseline.id,
        actual: share,
        minimum: baselineMinimum,
        maximum: baselineMaximum,
        message: `${baseline.id} standing-order/managed output is ${share}; target is ${baselineMinimum}-${baselineMaximum}.`,
      });
    }
  }

  const scalarFailures: Array<{
    value: number;
    code: BalanceAcceptanceCode;
    message: string;
  }> = [
    {
      value: evidence.absenceDestructiveLosses,
      code: "absence-loss",
      message: "Absence caused destructive losses.",
    },
    {
      value: evidence.strandedFullIdleRuns,
      code: "full-idle-stranded",
      message: "A full-idle campaign became stranded.",
    },
    {
      value: evidence.productionDeveloperGrantActions,
      code: "developer-grant",
      message: "A production balance run used developer grants.",
    },
  ];
  for (const failure of scalarFailures) {
    if (finiteNonNegative(failure.value) <= 0) continue;
    issues.push({
      code: failure.code,
      actual: finiteNonNegative(failure.value),
      maximum: 0,
      message: failure.message,
    });
  }

  if (
    !Number.isFinite(evidence.postLocalManualActionShare) ||
    evidence.postLocalManualActionShare >= 0.1
  ) {
    issues.push({
      code: "manual-action-ceiling",
      actual: evidence.postLocalManualActionShare,
      maximum: 0.1,
      message: "Manual dispatch actions supply 10% or more of post-Local policy actions.",
    });
  }

  if (
    !Number.isFinite(evidence.postLocalManualProductionShare) ||
    evidence.postLocalManualProductionShare >= 0.1
  ) {
    issues.push({
      code: "manual-throughput-ceiling",
      actual: evidence.postLocalManualProductionShare,
      maximum: 0.1,
      message: "Non-standing task output supplies 10% or more of post-Local production.",
    });
  }

  return { passed: issues.length === 0, issues };
};
