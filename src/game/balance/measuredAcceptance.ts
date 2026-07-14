import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountDivide,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  type Amount,
} from "../amount";
import type {
  AutomationBufferLevelId,
  ContractKind,
  TaskId,
  VisibleState,
} from "../types";
import {
  requiredAutomationBufferEvidenceIds,
  type BalanceAcceptanceEvidence,
  type VelocityWindowEvidence,
  type WorkloadAcceptanceEvidence,
} from "./acceptance";
import {
  cadenceExpectsBufferOverflow,
  sessionCadenceProfileById,
} from "./cadence";
import {
  auditPolicyActionOutcome,
  decideBalancePolicy,
  type BalancePolicyDecision,
} from "./policy";
import type {
  ActionPolicyAdapter,
  CampaignRunResult,
  DeepReadonly,
  EngagementProfileId,
  MetricAdapter,
} from "./types";
import {
  cloudWorkloadId,
  clusterWorkloadId,
  contractWorkloadId,
  expectedPublicRuntimeWorkloadIds,
  liveOperationsWorkloadId,
  projectPhaseWorkloadId,
  taskWorkloadId,
  workshopStorageWorkloadId,
} from "./workloadCoverage";

const DAY_MS = 24 * 60 * 60 * 1_000;
const ROLLING_WINDOW_MS = 28 * DAY_MS;
const ROLLING_STEP_MS = 14 * DAY_MS;

const BUFFER_ORDER: readonly AutomationBufferLevelId[] = [
  "startingNode",
  "localScheduler",
  "cronRuntime",
  "systemScheduler",
  "fleetOrchestrator",
  "clusterController",
  "rackController",
  "dataCenterNoc",
  "globalScheduler",
];

const BUFFER_CHAPTERS: Readonly<
  Record<(typeof requiredAutomationBufferEvidenceIds)[number], readonly string[]>
> = {
  localScheduler: ["bootstrapNode", "coherentMachine"],
  cronRuntime: ["coherentMachine", "workshopFleet"],
  systemScheduler: ["coherentMachine", "workshopFleet"],
  fleetOrchestrator: ["workshopFleet", "localFabric"],
  clusterController: ["localFabric", "rackAndFacility"],
  rackController: ["rackAndFacility", "resilientCloud"],
  dataCenterNoc: ["rackAndFacility", "resilientCloud"],
  globalScheduler: ["planetaryCommons"],
};

const exact = (value: unknown) => amount(String(value));
const safeNumber = (value: unknown) => amountToSafeNumber(exact(value));
const bufferAtLeastCron = (levelId: AutomationBufferLevelId) =>
  BUFFER_ORDER.indexOf(levelId) >= BUFFER_ORDER.indexOf("cronRuntime");

export interface MeasuredCreditEconomics {
  grossCredits: Amount;
  netCredits: Amount;
}

export interface ExactResourceOutput {
  credits: Amount;
  data: Amount;
}

const emptyOutput = (): ExactResourceOutput => ({
  credits: ZERO_AMOUNT,
  data: ZERO_AMOUNT,
});

const addOutput = (
  output: ExactResourceOutput,
  credits: Amount,
  data: Amount,
) => {
  output.credits = amountAdd(output.credits, credits);
  output.data = amountAdd(output.data, data);
};

const exactResourceShare = (part: Amount, total: Amount) =>
  amountCompare(total, 0) > 0
    ? amountToSafeNumber(amountDivide(amountClampMin(part), total))
    : 0;

/** Conservative resource share: the larger exact Credit or Data share wins. */
export const getExactResourceOutputShare = (
  output: ExactResourceOutput,
  total: ExactResourceOutput,
) =>
  Math.max(
    exactResourceShare(output.credits, total.credits),
    exactResourceShare(output.data, total.data),
  );

/** Do not average away a workload that dominates any individual run. */
export const getMaximumPerRunResourceShare = <T>(
  runs: readonly T[],
  outputFor: (run: T) => ExactResourceOutput,
  totalFor: (run: T) => ExactResourceOutput,
) => Math.max(0, ...runs.map((run) => getExactResourceOutputShare(
  outputFor(run),
  totalFor(run),
)));

const hasPositiveCosts = (
  costs: readonly { readonly amount: unknown }[],
) => costs.some((cost) => amountCompare(exact(cost.amount), 0) > 0);

/** A real competing spend must consume an affordable resource budget. */
export const hasAffordableCompetingResourcePurchase = (
  visible: Pick<
    DeepReadonly<VisibleState>,
    "research" | "upgrades" | "projects"
  >,
) =>
  visible.research.some(
    (research) =>
      research.canBuy &&
      research.canAfford &&
      !research.completed &&
      hasPositiveCosts(research.costs),
  ) ||
  visible.upgrades.some(
    (upgrade) =>
      upgrade.canAfford &&
      upgrade.maxed !== true &&
      hasPositiveCosts(upgrade.costs),
  ) ||
  visible.projects.some(
    (project) =>
      project.canStartPhase &&
      project.currentPhase !== null &&
      hasPositiveCosts(project.currentPhase.costs),
  );

export const getProjectedCloudSlaMargin = (
  definition: DeepReadonly<
    VisibleState["cloud"]["slaDefinitions"][number]
  >,
) => {
  const projection = definition.projection;
  return definition.canStart &&
    projection?.blockedReason === null &&
    projection.marginBps !== null &&
    Number.isFinite(projection.marginBps)
    ? projection.marginBps / 10_000
    : null;
};

export const getProjectedCloudSlaEconomics = (
  definition: DeepReadonly<
    VisibleState["cloud"]["slaDefinitions"][number]
  >,
): MeasuredCreditEconomics | null => {
  const projection = definition.projection;
  return definition.canStart &&
    projection?.blockedReason === null &&
    projection.netRewardCredits !== null &&
    amountCompare(exact(projection.rewards.credits), 0) > 0
    ? {
        grossCredits: exact(projection.rewards.credits),
        netCredits: exact(projection.netRewardCredits),
      }
    : null;
};

export const getVisibleClusterWorkloadMargin = (
  workload: Pick<
    DeepReadonly<VisibleState>["infrastructure"]["workloads"][number],
    "status" | "rewards" | "operatingCreditsSpent" | "projection"
  >,
) => {
  if (workload.status !== "completed") {
    return workload.projection.marginBps === null
      ? null
      : workload.projection.marginBps / 10_000;
  }
  const gross = safeNumber(workload.rewards.credits);
  return gross > 0
    ? (gross - safeNumber(workload.operatingCreditsSpent)) / gross
    : null;
};

export const getVisibleClusterWorkloadEconomics = (
  workload: Pick<
    DeepReadonly<VisibleState>["infrastructure"]["workloads"][number],
    "status" | "rewards" | "operatingCreditsSpent" | "projection"
  >,
): MeasuredCreditEconomics | null => {
  const grossCredits = exact(workload.rewards.credits);
  if (amountCompare(grossCredits, 0) <= 0) return null;
  if (workload.status === "completed") {
    return {
      grossCredits,
      netCredits: amountSubtract(grossCredits, exact(workload.operatingCreditsSpent)),
    };
  }
  return workload.projection.netCreditReward === null
    ? null
    : {
        grossCredits,
        netCredits: exact(workload.projection.netCreditReward),
      };
};

export const getVisibleTaskProjectionMargin = (
  visible: DeepReadonly<VisibleState>,
  taskId: TaskId,
  systemId: number | undefined,
) => {
  const targetSystemId = systemId ?? visible.selectedSystem.id;
  if (targetSystemId !== visible.selectedSystem.id) return null;
  const task =
    visible.jobs.find((candidate) => candidate.id === taskId) ??
    visible.research
      .flatMap((research) => research.computeTasks)
      .find((candidate) => candidate.id === taskId);
  if (!task) return null;
  const gross = safeNumber(task.projection.rewardCredits ?? task.rewardCredits);
  return gross > 0
    ? safeNumber(task.projection.netRewardCredits) / gross
    : null;
};

export const getVisibleTaskProjectionEconomics = (
  visible: DeepReadonly<VisibleState>,
  taskId: TaskId,
  systemId: number | undefined,
): MeasuredCreditEconomics | null => {
  const targetSystemId = systemId ?? visible.selectedSystem.id;
  if (targetSystemId !== visible.selectedSystem.id) return null;
  const task =
    visible.jobs.find((candidate) => candidate.id === taskId) ??
    visible.research
      .flatMap((research) => research.computeTasks)
      .find((candidate) => candidate.id === taskId);
  if (!task) return null;
  const grossCredits = exact(task.projection.rewardCredits ?? task.rewardCredits);
  return amountCompare(grossCredits, 0) > 0
    ? {
        grossCredits,
        netCredits: exact(task.projection.netRewardCredits),
      }
    : null;
};

export const getVisibleProjectPhaseEconomics = (
  phase: DeepReadonly<VisibleState["projects"][number]["currentPhase"]>,
): MeasuredCreditEconomics | null => {
  if (!phase || amountCompare(exact(phase.rewards.credits), 0) <= 0) return null;
  const creditCost = phase.costs
    .filter((cost) => cost.resource === "credits")
    .reduce(
      (total, cost) => amountAdd(total, exact(cost.amount)),
      ZERO_AMOUNT,
    );
  return {
    grossCredits: exact(phase.rewards.credits),
    netCredits: amountSubtract(exact(phase.rewards.credits), creditCost),
  };
};

export const getVisibleWorkshopStorageEconomics = (
  workload: DeepReadonly<VisibleState["workshop"]["storageWorkload"]>,
): MeasuredCreditEconomics | null =>
  workload.projection.netRewardCredits !== null &&
  amountCompare(exact(workload.rewards.credits), 0) > 0
    ? {
        grossCredits: exact(workload.rewards.credits),
        netCredits: exact(workload.projection.netRewardCredits),
      }
    : null;

export const getVisibleLiveOperationsEconomics = (
  live: DeepReadonly<VisibleState["liveOperations"]>,
): MeasuredCreditEconomics | null =>
  live.systemId !== null &&
  live.activeTaskId !== null &&
  live.blockedReason === null &&
  amountCompare(exact(live.projectedRewardCredits), 0) > 0
    ? {
        grossCredits: exact(live.projectedRewardCredits),
        netCredits: exact(live.projectedNetRewardCredits),
      }
    : null;

export interface MeasuredIntervalEvidence {
  endedAtMs: number;
  elapsedMs: number;
  intervalKind: "active" | "offline";
  postCron: boolean;
  postCronElapsedMs: number | null;
  outputCredits: number;
  completedUnits: number;
  standingOrderRenewals: number;
  standingOrderCompletions: number;
  manualUnits: number;
  lateGame: boolean;
}

export interface MeasuredContractChoice {
  contractId: string;
  templateId: string;
  kind: ContractKind;
  profileId: EngagementProfileId;
  authoredWorkValueMultiplier: number | null;
  netMargin: number;
  bufferCovered: boolean;
  creditRunwayCovered: boolean;
}

export interface MeasuredBufferPurchase {
  levelId: AutomationBufferLevelId;
  chapterId: string;
  affordable: boolean;
  viableAlternativePurchase: boolean;
}

export interface MeasuredStandingOrderBaseline {
  id: string;
  comparisonMode: "same-public-state-contract";
  profileId: EngagementProfileId;
  contractId: string;
  systemId: number;
  observedAtMs: number;
  standingOrderOutputPerDay: number;
  managedOutputPerDay: number;
}

export interface MeasuredProfileEvidence {
  profileId: EngagementProfileId;
  intervals: MeasuredIntervalEvidence[];
  contractChoices: MeasuredContractChoice[];
  bufferPurchases: MeasuredBufferPurchase[];
  standingOrderBaselines: MeasuredStandingOrderBaseline[];
  overflowByBufferMs: Partial<Record<AutomationBufferLevelId, number>>;
  workloadMargins: Record<string, number>;
  workloadEconomics: Record<string, MeasuredCreditEconomics>;
  workloadCompletions: Record<string, number>;
  workloadOutputCredits: Record<string, Amount>;
  workloadOutputData: Record<string, Amount>;
  taskMargins: Record<string, number>;
  taskEconomics: Record<string, MeasuredCreditEconomics>;
  taskCompletions: Record<string, number>;
  taskOutputCredits: Record<string, Amount>;
  taskOutputData: Record<string, Amount>;
  totalOutputCredits: Amount;
  totalOutputData: Amount;
  postLocalTotalOutputCredits: Amount;
  postLocalTotalOutputData: Amount;
  postLocalTaskOutputCredits: Amount;
  postLocalTaskOutputData: Amount;
  postLocalStandingOutputCredits: Amount;
  postLocalStandingOutputData: Amount;
  postLocalLiveOutputCredits: Amount;
  postLocalLiveOutputData: Amount;
  recommendedTaskIds: string[];
  destructiveAbsenceEvents: number;
  safelyAvoidedDestructiveEvents: number;
  strandedDecisions: number;
  developerGrantActions: number;
  manualDispatchActions: number;
  totalActions: number;
  proposedActions: number;
  noOpActions: number;
  postLocalManualDispatchActions: number;
  postLocalActions: number;
}

export interface MeasuredCampaignHarness {
  actionPolicy: ActionPolicyAdapter;
  metricAdapter: MetricAdapter;
  snapshot(): MeasuredProfileEvidence;
}

const cloneMeasurement = (
  measurement: MeasuredProfileEvidence,
): MeasuredProfileEvidence => ({
  ...measurement,
  intervals: measurement.intervals.map((interval) => ({ ...interval })),
  contractChoices: measurement.contractChoices.map((choice) => ({ ...choice })),
  bufferPurchases: measurement.bufferPurchases.map((purchase) => ({ ...purchase })),
  standingOrderBaselines: measurement.standingOrderBaselines.map((baseline) => ({
    ...baseline,
  })),
  overflowByBufferMs: { ...measurement.overflowByBufferMs },
  workloadMargins: { ...measurement.workloadMargins },
  workloadEconomics: { ...measurement.workloadEconomics },
  workloadCompletions: { ...measurement.workloadCompletions },
  workloadOutputCredits: { ...measurement.workloadOutputCredits },
  workloadOutputData: { ...measurement.workloadOutputData },
  taskMargins: { ...measurement.taskMargins },
  taskEconomics: { ...measurement.taskEconomics },
  taskCompletions: { ...measurement.taskCompletions },
  taskOutputCredits: { ...measurement.taskOutputCredits },
  taskOutputData: { ...measurement.taskOutputData },
  recommendedTaskIds: [...measurement.recommendedTaskIds],
});

/**
 * Adds acceptance telemetry without exposing serializable GameState to either
 * decisions or evidence. Every observation comes from public actions, visible
 * projections, and interval reports.
 */
export const createMeasuredCampaignHarness = (
  profileId: EngagementProfileId,
): MeasuredCampaignHarness => {
  const measurement: MeasuredProfileEvidence = {
    profileId,
    intervals: [],
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
    totalOutputCredits: ZERO_AMOUNT,
    totalOutputData: ZERO_AMOUNT,
    postLocalTotalOutputCredits: ZERO_AMOUNT,
    postLocalTotalOutputData: ZERO_AMOUNT,
    postLocalTaskOutputCredits: ZERO_AMOUNT,
    postLocalTaskOutputData: ZERO_AMOUNT,
    postLocalStandingOutputCredits: ZERO_AMOUNT,
    postLocalStandingOutputData: ZERO_AMOUNT,
    postLocalLiveOutputCredits: ZERO_AMOUNT,
    postLocalLiveOutputData: ZERO_AMOUNT,
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
  };
  const recordedContracts = new Set<string>();
  const recordedMarketBaselines = new Set<string>();
  const recordedBuffers = new Set<AutomationBufferLevelId>();
  let cronReachedAtMs: number | null = null;
  let pendingDecision: BalancePolicyDecision | null = null;
  let pendingDecisionChangedPublicState = false;

  const marginFromEconomics = (economics: MeasuredCreditEconomics) =>
    amountToSafeNumber(
      amountDivide(economics.netCredits, economics.grossCredits),
    );

  const recordMinimumEconomics = (
    economicsByWork: Record<string, MeasuredCreditEconomics>,
    margins: Record<string, number>,
    workId: string,
    economics: MeasuredCreditEconomics | null,
  ) => {
    if (!economics || amountCompare(economics.grossCredits, 0) <= 0) return;
    const previous = economicsByWork[workId];
    if (
      !previous ||
      amountCompare(
        amountMultiply(economics.netCredits, previous.grossCredits),
        amountMultiply(previous.netCredits, economics.grossCredits),
      ) < 0
    ) {
      economicsByWork[workId] = economics;
      margins[workId] = marginFromEconomics(economics);
    }
  };

  const recordTaskProjection = (
    visible: DeepReadonly<VisibleState>,
    taskId: TaskId,
    systemId: number | undefined,
  ) => {
    recordMinimumEconomics(
      measurement.taskEconomics,
      measurement.taskMargins,
      taskId,
      getVisibleTaskProjectionEconomics(visible, taskId, systemId),
    );
  };

  const recordProjectProjection = (
    visible: DeepReadonly<VisibleState>,
    projectId: string,
  ) => {
    const project = visible.projects.find((candidate) => candidate.id === projectId);
    if (!project?.currentPhase) return;
    recordMinimumEconomics(
      measurement.workloadEconomics,
      measurement.workloadMargins,
      projectPhaseWorkloadId(project.id, project.currentPhase.id),
      getVisibleProjectPhaseEconomics(project.currentPhase),
    );
  };

  const recordWorkshopStorageProjection = (
    visible: DeepReadonly<VisibleState>,
  ) => {
    const workload = visible.workshop.storageWorkload;
    recordMinimumEconomics(
      measurement.workloadEconomics,
      measurement.workloadMargins,
      workshopStorageWorkloadId(workload.id),
      getVisibleWorkshopStorageEconomics(workload),
    );
  };

  const recordLiveOperationsProjection = (
    visible: DeepReadonly<VisibleState>,
  ) => {
    const live = visible.liveOperations;
    if (live.activeTaskId === null) return;
    recordMinimumEconomics(
      measurement.workloadEconomics,
      measurement.workloadMargins,
      liveOperationsWorkloadId(live.activeTaskId),
      getVisibleLiveOperationsEconomics(live),
    );
  };

  const recordVisibleMarketBaselines = (
    visible: DeepReadonly<VisibleState>,
    observedAtMs: number,
  ) => {
    const standingPerDay =
      safeNumber(visible.contractMarket.standingOrderValuePerHourCredits) * 24;
    if (standingPerDay <= 0) return;
    for (const contract of visible.contracts) {
      if (contract.accepted || recordedMarketBaselines.has(contract.id)) continue;
      const managedPerDay = safeNumber(contract.valuePerHourCredits) * 24;
      if (managedPerDay <= 0) continue;
      measurement.standingOrderBaselines.push({
        id: `${profileId}:market:${contract.id}`,
        comparisonMode: "same-public-state-contract",
        profileId,
        contractId: contract.id,
        systemId: contract.systemId,
        observedAtMs,
        standingOrderOutputPerDay: standingPerDay,
        managedOutputPerDay: managedPerDay,
      });
      recordedMarketBaselines.add(contract.id);
    }
  };

  const actionPolicy: ActionPolicyAdapter = {
    selectActions: (context) => {
      // Observe the entire public market before policy filtering or acceptance.
      recordVisibleMarketBaselines(context.visible, context.elapsedCalendarMs);
      const decision = decideBalancePolicy(context);
      pendingDecision = decision;
      pendingDecisionChangedPublicState = false;
      if (decision.audit.stranded) measurement.strandedDecisions += 1;
      measurement.proposedActions += decision.actions.length;
      return decision.actions;
    },
    recordActionOutcome: (context) => {
      if (!pendingDecision) {
        throw new Error("Measured action outcome has no pending policy decision.");
      }
      const outcome = auditPolicyActionOutcome(
        pendingDecision,
        context.actionIndex,
        context.before,
        context.after,
      );
      if (outcome.noOp) {
        measurement.noOpActions += 1;
        const finalOutcome =
          context.actionIndex === pendingDecision.actions.length - 1;
        const coveredAfterDecision =
          context.after.activeWork.length > 0 ||
          (context.after.standingOrder.enabled &&
            context.after.standingOrder.taskId !== null);
        if (
          finalOutcome &&
          !pendingDecisionChangedPublicState &&
          !coveredAfterDecision
        ) {
          // A decision that only proposes invalid public transitions is just as
          // stranded as returning no action at all. This catches policy loops
          // such as repeatedly dispatching a system task without a queue slot.
          measurement.strandedDecisions += 1;
        }
        return;
      }

      const action = context.action;
      pendingDecisionChangedPublicState = true;
      measurement.totalActions += 1;
      measurement.manualDispatchActions += Number(outcome.manualDispatch);
      if (
        BUFFER_ORDER.indexOf(context.before.automationBuffer.ownedLevelId) >=
        BUFFER_ORDER.indexOf("localScheduler")
      ) {
        measurement.postLocalManualDispatchActions += Number(
          outcome.manualDispatch,
        );
        measurement.postLocalActions += 1;
      }

      if (action.type === "acceptContract" && !recordedContracts.has(action.contractId)) {
        const contract = context.before.contracts.find(
          (candidate) => candidate.id === action.contractId,
        );
        if (contract) {
          const gross = safeNumber(contract.rewards.credits);
          const net = safeNumber(contract.netRewardCredits);
          recordMinimumEconomics(
            measurement.workloadEconomics,
            measurement.workloadMargins,
            contractWorkloadId(contract.templateId),
            gross > 0
              ? {
                  grossCredits: exact(contract.rewards.credits),
                  netCredits: exact(contract.netRewardCredits),
                }
              : null,
          );
          measurement.contractChoices.push({
            contractId: contract.id,
            templateId: contract.templateId,
            kind: contract.kind,
            profileId,
            authoredWorkValueMultiplier:
              contract.authoredWorkValueMultiplierBps === null ||
              contract.authoredWorkValueMultiplierBps === undefined
                ? null
                : contract.authoredWorkValueMultiplierBps / 10_000,
            netMargin: gross > 0 ? net / gross : 0,
            bufferCovered: contract.bufferCovered,
            creditRunwayCovered: contract.creditRunwayCovered,
          });
          recordedContracts.add(action.contractId);
        }
      }
      if (
        action.type === "purchaseAutomationBuffer" &&
        !recordedBuffers.has(action.levelId)
      ) {
        const alternative = hasAffordableCompetingResourcePurchase(
          context.before,
        );
        measurement.bufferPurchases.push({
          levelId: action.levelId,
          chapterId: context.before.currentChapter.id,
          affordable:
            context.before.automationBuffer.nextUpgrade?.id === action.levelId &&
            context.before.automationBuffer.nextUpgrade.canAfford,
          viableAlternativePurchase: alternative,
        });
        recordedBuffers.add(action.levelId);
      }

      const taskAction =
        action.type === "startTask" ||
        action.type === "startTaskOnCore" ||
        action.type === "queueTask"
          ? action
          : action.type === "startJob" ||
              action.type === "startJobOnCore" ||
              action.type === "queueJob"
            ? { taskId: action.jobId as TaskId, systemId: action.systemId }
            : null;
      if (taskAction) {
        recordTaskProjection(
          context.before,
          taskAction.taskId,
          taskAction.systemId,
        );
      }
      if (action.type === "setStandingOrder" && action.taskId !== null) {
        recordTaskProjection(
          context.before,
          action.taskId,
          action.systemId,
        );
      }
      if (action.type === "startProjectPhase") {
        recordProjectProjection(context.before, action.projectId);
      }
      if (action.type === "startWorkshopStorageWorkload") {
        recordWorkshopStorageProjection(context.before);
      }
      if (
        action.type === "configureLiveOperations" ||
        action.type === "setLiveOperationsEnabled"
      ) {
        recordLiveOperationsProjection(context.after);
      }
      if (action.type === "startCloudSla") {
        const definition = context.before.cloud.slaDefinitions.find(
          (candidate) => candidate.id === action.definitionId,
        );
        recordMinimumEconomics(
          measurement.workloadEconomics,
          measurement.workloadMargins,
          cloudWorkloadId(action.definitionId),
          definition ? getProjectedCloudSlaEconomics(definition) : null,
        );
      }
    },
  };

  const metricAdapter: MetricAdapter = {
    sample: (visible, context) => {
      recordVisibleMarketBaselines(visible, context.nowMs);
      for (const project of visible.projects) {
        if (project.active) recordProjectProjection(visible, project.id);
      }
      if (visible.workshop.storageWorkload.active) {
        recordWorkshopStorageProjection(visible);
      }
      if (visible.liveOperations.enabled) {
        recordLiveOperationsProjection(visible);
      }
      if (
        cronReachedAtMs === null &&
        bufferAtLeastCron(visible.automationBuffer.ownedLevelId)
      ) {
        cronReachedAtMs = Math.max(0, context.nowMs - context.elapsedMs);
      }
      const completedUnits = Object.values(context.report.completedWork).reduce(
        (total, count) => total + (count ?? 0),
        0,
      );
      const outputCredits = safeNumber(context.report.creditsEarned);
      measurement.totalOutputCredits = amountAdd(
        measurement.totalOutputCredits,
        exact(context.report.creditsEarned),
      );
      measurement.totalOutputData = amountAdd(
        measurement.totalOutputData,
        exact(context.report.dataEarned),
      );
      const postCron = cronReachedAtMs !== null;
      const standingOrderRenewals = context.report.standingOrderRenewals;
      const standingOrderCompletions = (context.report.completionEvents ?? [])
        .reduce(
          (total, event) =>
            event.source === "standing-order"
              ? total + event.completionCount
              : total,
          0,
        );
      const liveOperationsCompletions = (context.report.completionEvents ?? [])
        .reduce(
          (total, event) =>
            event.source === "live-operations"
              ? total + event.completionCount
              : total,
          0,
        );
      const manualUnits = Math.max(
        0,
        completedUnits - standingOrderCompletions - liveOperationsCompletions,
      );
      const lateGame = visible.currentChapter.index >= 5;
      measurement.intervals.push({
        endedAtMs: context.nowMs,
        elapsedMs: context.elapsedMs,
        intervalKind: context.intervalKind,
        postCron,
        postCronElapsedMs:
          cronReachedAtMs === null ? null : Math.max(0, context.nowMs - cronReachedAtMs),
        outputCredits,
        completedUnits,
        standingOrderRenewals,
        standingOrderCompletions,
        manualUnits,
        lateGame,
      });

      if (context.intervalKind === "offline") {
        const levelId = context.report.bufferLevelId;
        // Only unexpected overflow is a balance defect: when the profile's
        // modeled cadence itself returns after the buffer fills (a daily
        // player on a 2h buffer), lost time is profile-appropriate and must
        // not fail the buffer-overflow acceptance gate.
        const overflowUnexpected = !cadenceExpectsBufferOverflow(
          sessionCadenceProfileById[profileId],
          context.report.bufferCapacityMs,
        );
        measurement.overflowByBufferMs[levelId] =
          (measurement.overflowByBufferMs[levelId] ?? 0) +
          (overflowUnexpected ? Math.max(0, context.report.overflowMs) : 0);
        measurement.destructiveAbsenceEvents +=
          context.report.destructiveEvents.psuOverload +
          context.report.destructiveEvents.unpaidBill +
          context.report.destructiveEvents.deadlockWipe;
        measurement.safelyAvoidedDestructiveEvents +=
          context.report.safelyAvoidedDestructiveEvents.psuOverload +
          context.report.safelyAvoidedDestructiveEvents.unpaidBill +
          context.report.safelyAvoidedDestructiveEvents.deadlockWipe;
      }

      for (const workload of visible.infrastructure.workloads) {
        const workId = clusterWorkloadId(workload.definitionId);
        recordMinimumEconomics(
          measurement.workloadEconomics,
          measurement.workloadMargins,
          workId,
          getVisibleClusterWorkloadEconomics(workload),
        );
      }
      const recommendedTaskId = visible.standingOrder.enabled
        ? visible.standingOrder.taskId
        : null;
      if (
        recommendedTaskId &&
        !measurement.recommendedTaskIds.includes(recommendedTaskId)
      ) {
        measurement.recommendedTaskIds.push(recommendedTaskId);
      }
      if (
        recommendedTaskId &&
        visible.standingOrder.systemId === visible.selectedSystem.id
      ) {
        recordTaskProjection(
          visible,
          recommendedTaskId,
          visible.standingOrder.systemId ?? undefined,
        );
      }
      const intervalTaskOutput = emptyOutput();
      const intervalLiveOutput = emptyOutput();
      for (const event of context.report.completionEvents ?? []) {
        if (event.source === "task" || event.source === "standing-order") {
          measurement.taskCompletions[event.workId] =
            (measurement.taskCompletions[event.workId] ?? 0) +
            Math.max(1, event.completionCount);
          measurement.taskOutputCredits[event.workId] = amountAdd(
            measurement.taskOutputCredits[event.workId] ?? ZERO_AMOUNT,
            exact(event.creditsEarned),
          );
          measurement.taskOutputData[event.workId] = amountAdd(
            measurement.taskOutputData[event.workId] ?? ZERO_AMOUNT,
            exact(event.dataEarned),
          );
          addOutput(
            intervalTaskOutput,
            exact(event.creditsEarned),
            exact(event.dataEarned),
          );
          continue;
        }
        const workId =
          event.source === "live-operations"
            ? liveOperationsWorkloadId(event.workId)
            : event.source === "contract"
              ? contractWorkloadId(event.workId)
              : event.source === "project"
                ? projectPhaseWorkloadId(event.workId, event.phaseId)
                : event.source === "workshop-storage"
                  ? workshopStorageWorkloadId(event.workId)
                  : event.source === "cluster"
                    ? clusterWorkloadId(event.workId)
                    : cloudWorkloadId(event.workId);
        if (event.source === "cloud") {
          const definition = visible.cloud.slaDefinitions.find(
            (candidate) => candidate.id === event.workId,
          );
          recordMinimumEconomics(
            measurement.workloadEconomics,
            measurement.workloadMargins,
            workId,
            definition ? getProjectedCloudSlaEconomics(definition) : null,
          );
        }
        if (event.source === "live-operations") {
          addOutput(
            intervalTaskOutput,
            exact(event.creditsEarned),
            exact(event.dataEarned),
          );
          addOutput(
            intervalLiveOutput,
            exact(event.creditsEarned),
            exact(event.dataEarned),
          );
        }
        measurement.workloadCompletions[workId] =
          (measurement.workloadCompletions[workId] ?? 0) +
          (event.source === "live-operations" ||
          event.source === "workshop-storage"
            ? Math.max(1, event.completionCount)
            : 1);
        measurement.workloadOutputCredits[workId] = amountAdd(
          measurement.workloadOutputCredits[workId] ?? ZERO_AMOUNT,
          exact(event.creditsEarned),
        );
        measurement.workloadOutputData[workId] = amountAdd(
          measurement.workloadOutputData[workId] ?? ZERO_AMOUNT,
          exact(event.dataEarned),
        );
      }

      const powerCost = Math.max(0, visible.metrics.powerCostPerSecond);
      const totalCapacity = visible.metrics.activeCoreCount + visible.metrics.idleCoreCount;
      const contractOutputCredits = (context.report.completionEvents ?? [])
        .filter((event) => event.source === "contract")
        .reduce(
          (total, event) => amountAdd(total, exact(event.creditsEarned)),
          ZERO_AMOUNT,
        );
      let standingOrderOutputCredits = ZERO_AMOUNT;
      let standingOrderOutputData = ZERO_AMOUNT;
      for (const event of context.report.completionEvents ?? []) {
        if (event.source !== "standing-order") continue;
        standingOrderOutputCredits = amountAdd(
          standingOrderOutputCredits,
          exact(event.creditsEarned),
        );
        standingOrderOutputData = amountAdd(
          standingOrderOutputData,
          exact(event.dataEarned),
        );
      }
      if (
        BUFFER_ORDER.indexOf(visible.automationBuffer.ownedLevelId) >=
        BUFFER_ORDER.indexOf("localScheduler")
      ) {
        measurement.postLocalTotalOutputCredits = amountAdd(
          measurement.postLocalTotalOutputCredits,
          exact(context.report.creditsEarned),
        );
        measurement.postLocalTotalOutputData = amountAdd(
          measurement.postLocalTotalOutputData,
          exact(context.report.dataEarned),
        );
        measurement.postLocalTaskOutputCredits = amountAdd(
          measurement.postLocalTaskOutputCredits,
          intervalTaskOutput.credits,
        );
        measurement.postLocalTaskOutputData = amountAdd(
          measurement.postLocalTaskOutputData,
          intervalTaskOutput.data,
        );
        measurement.postLocalStandingOutputCredits = amountAdd(
          measurement.postLocalStandingOutputCredits,
          standingOrderOutputCredits,
        );
        measurement.postLocalStandingOutputData = amountAdd(
          measurement.postLocalStandingOutputData,
          standingOrderOutputData,
        );
        measurement.postLocalLiveOutputCredits = amountAdd(
          measurement.postLocalLiveOutputCredits,
          intervalLiveOutput.credits,
        );
        measurement.postLocalLiveOutputData = amountAdd(
          measurement.postLocalLiveOutputData,
          intervalLiveOutput.data,
        );
      }
      return {
        outputUnits: exact(context.report.creditsEarned),
        standingOrderOutputUnits: standingOrderOutputCredits,
        contractOutputUnits: contractOutputCredits,
        resourceBalances: {
          credits: exact(visible.exactResources.credits),
          data: exact(visible.exactResources.data),
        },
        scarceResourceIds: Object.entries(visible.exactResources)
          .filter(([, balance]) => amountCompare(exact(balance), 0) <= 0)
          .map(([resourceId]) => resourceId),
        powerRunwayHours:
          powerCost > 0
            ? safeNumber(
                amountDivide(
                  exact(visible.exactResources.credits),
                  amountMultiply(powerCost, 3_600),
                ),
              )
            : null,
        blockingReasons: context.report.blockers,
        usedCapacity: amount(visible.metrics.activeCoreCount),
        totalCapacity: amount(totalCapacity),
        roi: {
          benefit: amountAdd(
            exact(context.report.creditsEarned),
            exact(context.report.dataEarned),
          ),
          cost: amountAdd(
            exact(context.report.creditsSpent),
            exact(context.report.dataSpent),
          ),
        },
      };
    },
  };

  return {
    actionPolicy,
    metricAdapter,
    snapshot: () => cloneMeasurement(measurement),
  };
};

export const rollingVelocityWindows = (
  fullIdle: MeasuredProfileEvidence,
  regular: MeasuredProfileEvidence,
): VelocityWindowEvidence[] => {
  const maxElapsed = (measurement: MeasuredProfileEvidence) =>
    Math.max(
      0,
      ...measurement.intervals.flatMap((interval) =>
        interval.postCronElapsedMs === null ? [] : [interval.postCronElapsedMs],
      ),
    );
  const commonElapsedMs = Math.min(maxElapsed(fullIdle), maxElapsed(regular));
  const windows: VelocityWindowEvidence[] = [];
  for (
    let startsAtMs = 0;
    startsAtMs + ROLLING_WINDOW_MS <= commonElapsedMs;
    startsAtMs += ROLLING_STEP_MS
  ) {
    const endsAtMs = startsAtMs + ROLLING_WINDOW_MS;
    const output = (measurement: MeasuredProfileEvidence) =>
      measurement.intervals.reduce((total, interval) => {
        const intervalEndMs = interval.postCronElapsedMs;
        if (intervalEndMs === null || interval.elapsedMs <= 0) return total;
        const intervalStartMs = Math.max(0, intervalEndMs - interval.elapsedMs);
        const overlapMs = Math.max(
          0,
          Math.min(endsAtMs, intervalEndMs) -
            Math.max(startsAtMs, intervalStartMs),
        );
        return total + interval.outputCredits * (overlapMs / interval.elapsedMs);
      }, 0);
    windows.push({
      id: `post-cron-days-${startsAtMs / DAY_MS}-${endsAtMs / DAY_MS}`,
      postCron: true,
      fullIdleOutputPerDay: output(fullIdle) / (ROLLING_WINDOW_MS / DAY_MS),
      regularOutputPerDay: output(regular) / (ROLLING_WINDOW_MS / DAY_MS),
    });
  }
  return windows;
};

export interface MeasuredCompletedRun {
  result: CampaignRunResult;
  measurement: MeasuredProfileEvidence;
}

const minimumEconomics = (
  values: readonly MeasuredCreditEconomics[],
): MeasuredCreditEconomics | null =>
  values.reduce<MeasuredCreditEconomics | null>((minimum, candidate) => {
    if (!minimum) return candidate;
    return amountCompare(
      amountMultiply(candidate.netCredits, minimum.grossCredits),
      amountMultiply(minimum.netCredits, candidate.grossCredits),
    ) < 0
      ? candidate
      : minimum;
  }, null);

const diagnosticMargin = (economics: MeasuredCreditEconomics | null) =>
  economics
    ? amountToSafeNumber(
        amountDivide(economics.netCredits, economics.grossCredits),
      )
    : null;

export const buildMeasuredBalanceAcceptanceEvidence = (
  completedRuns: readonly MeasuredCompletedRun[],
): BalanceAcceptanceEvidence => {
  const byProfile = new Map(
    completedRuns.map((entry) => [entry.result.metrics.profileId, entry]),
  );
  const fullIdle = byProfile.get("full-idle")?.measurement;
  const regular = byProfile.get("regular")?.measurement;
  const allMeasurements = completedRuns.map((entry) => entry.measurement);
  const regularPostCron = regular?.intervals.filter((interval) => interval.postCron) ?? [];
  const regularTotalOutputUnits = regularPostCron.reduce(
    (total, interval) => total + interval.outputCredits,
    0,
  );
  const regularOfflineOutputUnits = regularPostCron
    .filter((interval) => interval.intervalKind === "offline")
    .reduce((total, interval) => total + interval.outputCredits, 0);
  const totalOutput = (measurement: MeasuredProfileEvidence) => ({
    credits: measurement.totalOutputCredits,
    data: measurement.totalOutputData,
  });

  const workloadIds = new Set(
    allMeasurements.flatMap((measurement) => [
      ...Object.keys(measurement.workloadMargins),
      ...Object.keys(measurement.workloadEconomics),
      ...Object.keys(measurement.workloadCompletions),
      ...Object.keys(measurement.workloadOutputCredits),
      ...Object.keys(measurement.workloadOutputData),
    ]),
  );
  const workloads: WorkloadAcceptanceEvidence[] = [...workloadIds]
    .sort()
    .map((workloadId) => {
      const economics = minimumEconomics(allMeasurements.flatMap((measurement) => {
        const value = measurement.workloadEconomics[workloadId];
        return value === undefined ? [] : [value];
      }));
      const recommended = allMeasurements.some((measurement) => {
        return measurement.workloadEconomics[workloadId] !== undefined;
      });
      const completed = allMeasurements.some(
        (measurement) => (measurement.workloadCompletions[workloadId] ?? 0) > 0,
      );
      const producedCredits = allMeasurements.some(
        (measurement) =>
          amountCompare(
            measurement.workloadOutputCredits[workloadId] ?? ZERO_AMOUNT,
            0,
          ) > 0,
      );
      return {
        workloadId,
        recommended,
        completed,
        profitabilityApplicable: producedCredits || economics !== null,
        grossCredits: economics?.grossCredits ?? null,
        netCredits: economics?.netCredits ?? null,
        netMargin: diagnosticMargin(economics),
        progressionShare: getMaximumPerRunResourceShare(
          allMeasurements,
          (measurement) => ({
            credits:
              measurement.workloadOutputCredits[workloadId] ?? ZERO_AMOUNT,
            data: measurement.workloadOutputData[workloadId] ?? ZERO_AMOUNT,
          }),
          totalOutput,
        ),
      };
    });
  const taskIds = new Set(
    allMeasurements.flatMap((measurement) => [
      ...Object.keys(measurement.taskMargins),
      ...Object.keys(measurement.taskEconomics),
      ...Object.keys(measurement.taskCompletions),
      ...Object.keys(measurement.taskOutputCredits),
      ...Object.keys(measurement.taskOutputData),
      ...measurement.recommendedTaskIds,
    ]),
  );
  for (const taskId of [...taskIds].sort()) {
    const economics = minimumEconomics(allMeasurements.flatMap((measurement) => {
      const value = measurement.taskEconomics[taskId];
      return value === undefined ? [] : [value];
    }));
    const completed = allMeasurements.some(
      (measurement) => (measurement.taskCompletions[taskId] ?? 0) > 0,
    );
    const producedCredits = allMeasurements.some(
      (measurement) =>
        amountCompare(
          measurement.taskOutputCredits[taskId] ?? ZERO_AMOUNT,
          0,
        ) > 0,
    );
    workloads.push({
      workloadId: taskWorkloadId(taskId),
      recommended: allMeasurements.some((measurement) =>
        measurement.recommendedTaskIds.includes(taskId),
      ),
      completed,
      profitabilityApplicable: producedCredits || economics !== null,
      grossCredits: economics?.grossCredits ?? null,
      netCredits: economics?.netCredits ?? null,
      netMargin: diagnosticMargin(economics),
      progressionShare: getMaximumPerRunResourceShare(
        allMeasurements,
        (measurement) => ({
          credits: measurement.taskOutputCredits[taskId] ?? ZERO_AMOUNT,
          data: measurement.taskOutputData[taskId] ?? ZERO_AMOUNT,
        }),
        totalOutput,
      ),
    });
  }

  const buffers = requiredAutomationBufferEvidenceIds.map((levelId) => {
    const purchases = allMeasurements.flatMap((measurement) =>
      measurement.bufferPurchases.filter(
        (purchase) => purchase.levelId === levelId,
      ),
    );
    return {
      levelId,
      affordableNearIntendedChapter:
        purchases.length > 0 &&
        purchases.every(
          (purchase) =>
            purchase.affordable &&
            BUFFER_CHAPTERS[levelId].includes(purchase.chapterId),
        ),
      viableAlternativePurchase:
        purchases.length > 0 &&
        purchases.every((purchase) => purchase.viableAlternativePurchase),
      expectedCadenceOverflowMs: allMeasurements.reduce(
        (total, measurement) =>
          total + (measurement.overflowByBufferMs[levelId] ?? 0),
        0,
      ),
    };
  });
  const velocityWindows =
    fullIdle && regular ? rollingVelocityWindows(fullIdle, regular) : [];
  const contracts = allMeasurements.flatMap((measurement) =>
    measurement.contractChoices.map((choice) => ({
      contractId: choice.contractId,
      templateId: choice.templateId,
      kind: choice.kind,
      profileId: choice.profileId,
      authoredWorkValueMultiplier: choice.authoredWorkValueMultiplier,
      netMargin: choice.netMargin,
      bufferCovered: choice.bufferCovered,
      creditRunwayCovered: choice.creditRunwayCovered,
    })),
  );
  const standingOrderBaselines = allMeasurements.flatMap(
    (measurement) => measurement.standingOrderBaselines,
  );

  return {
    deterministicRuns: completedRuns.map((entry) => entry.result.metrics),
    velocityWindows,
    regularOfflineOutputUnits,
    regularTotalOutputUnits,
    buffers,
    workloads,
    expectedWorkloadIds: expectedPublicRuntimeWorkloadIds,
    coveredWorkloadIds: Array.from(new Set([
      ...workloads.map((workload) => workload.workloadId),
      ...contracts.map((contract) => contractWorkloadId(contract.templateId)),
    ])).sort(),
    contracts,
    standingOrderBaselines,
    absenceDestructiveLosses: allMeasurements.reduce(
      (total, measurement) => total + measurement.destructiveAbsenceEvents,
      0,
    ),
    strandedFullIdleRuns:
      fullIdle && fullIdle.strandedDecisions > 0 ? 1 : 0,
    productionDeveloperGrantActions: allMeasurements.reduce(
      (total, measurement) => total + measurement.developerGrantActions,
      0,
    ),
    postLocalManualActionShare:
      regular && regular.postLocalActions > 0
        ? regular.postLocalManualDispatchActions / regular.postLocalActions
        : 0,
    postLocalManualProductionShare: regular
      ? getExactResourceOutputShare(
          {
            credits: amountClampMin(
              amountSubtract(
                amountSubtract(
                  regular.postLocalTaskOutputCredits,
                  regular.postLocalStandingOutputCredits,
                ),
                regular.postLocalLiveOutputCredits,
              ),
            ),
            data: amountClampMin(
              amountSubtract(
                amountSubtract(
                  regular.postLocalTaskOutputData,
                  regular.postLocalStandingOutputData,
                ),
                regular.postLocalLiveOutputData,
              ),
            ),
          },
          {
            credits: regular.postLocalTotalOutputCredits,
            data: regular.postLocalTotalOutputData,
          },
        )
      : 0,
  };
};

export const serializeMeasuredAcceptance = (
  evidence: BalanceAcceptanceEvidence,
) => ({
  velocityWindows: evidence.velocityWindows,
  buffers: evidence.buffers,
  workloads: evidence.workloads,
  expectedWorkloadIds: evidence.expectedWorkloadIds,
  coveredWorkloadIds: evidence.coveredWorkloadIds,
  contracts: evidence.contracts,
  standingOrderBaselines: evidence.standingOrderBaselines,
  regularOfflineOutputUnits: evidence.regularOfflineOutputUnits,
  regularTotalOutputUnits: evidence.regularTotalOutputUnits,
  absenceDestructiveLosses: evidence.absenceDestructiveLosses,
  strandedFullIdleRuns: evidence.strandedFullIdleRuns,
  productionDeveloperGrantActions: evidence.productionDeveloperGrantActions,
  postLocalManualActionShare: evidence.postLocalManualActionShare,
  postLocalManualProductionShare: evidence.postLocalManualProductionShare,
});
