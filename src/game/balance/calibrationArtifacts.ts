import { advanceGame } from "../advance";
import { deriveVisibleState } from "../selectors";
import { applyAction } from "../simulation";
import type { GameAction, GameState, VisibleState } from "../types";
import {
  evaluateBalanceAcceptance,
  type BalanceAcceptanceEvidence,
} from "./acceptance";
import { beamSearchPublicActionRoutes } from "./beamSearch";
import {
  bootstrapMilestoneAdapter,
  bootstrapSmokeRuntime,
} from "./bootstrap";
import { sessionCadenceProfiles } from "./cadence";
import { decideBalancePolicy, regularActionPolicy } from "./policy";
import { runCampaign } from "./runner";
import { runNsga2 } from "./nsga2";
import type { CampaignRunMetrics, DeepReadonly } from "./types";

const BASIS_POINTS = 10_000;

export const measuredCalibrationParameters = [
  { id: "repeatableRewardBps", minimum: 9_000, maximum: 11_000, integer: true },
  { id: "contractValueBps", minimum: 15_000, maximum: 25_000, integer: true },
  { id: "bufferCostBps", minimum: 8_500, maximum: 11_500, integer: true },
  { id: "powerCostBps", minimum: 8_500, maximum: 11_500, integer: true },
] as const;

interface CalibrationProjection {
  projectedFullIdleDays: number;
  projectedRegularDays: number;
  projectedVelocityRatio: number;
  projectedMinimumMargin: number;
  calendarBandError: number;
  velocityTargetError: number;
  parameterDeviation: number;
}

const completedDays = (run: CampaignRunMetrics | undefined, fallback: number) =>
  run?.status === "completed" && run.completedAtMs !== null
    ? run.elapsedCalendarDays
    : run?.elapsedCalendarDays ?? fallback;

const calibrationProjection = (
  vector: readonly number[],
  runs: readonly CampaignRunMetrics[],
  evidence: BalanceAcceptanceEvidence,
): CalibrationProjection => {
  const rewardScale = (vector[0] ?? BASIS_POINTS) / BASIS_POINTS;
  const contractScale = (vector[1] ?? 20_000) / 20_000;
  const bufferScale = (vector[2] ?? BASIS_POINTS) / BASIS_POINTS;
  const powerScale = (vector[3] ?? BASIS_POINTS) / BASIS_POINTS;
  const fullDays = completedDays(
    runs.find((run) => run.profileId === "full-idle"),
    294,
  );
  const regularDays = completedDays(
    runs.find((run) => run.profileId === "regular"),
    147,
  );
  const minimumMeasuredMargin = Math.min(
    1,
    ...evidence.workloads
      .filter((workload) => workload.recommended || workload.completed)
      .flatMap((workload) =>
        workload.netMargin === null ? [] : [workload.netMargin],
      ),
  );
  const powerPressure = 1 + (powerScale - 1) * 0.2;
  const projectedFullIdleDays =
    (fullDays * bufferScale * powerPressure) / rewardScale;
  const managedValueScale = rewardScale * (0.5 + 0.5 * contractScale);
  const projectedRegularDays =
    (regularDays * bufferScale * powerPressure) / managedValueScale;
  const projectedVelocityRatio =
    projectedRegularDays > 0
      ? projectedFullIdleDays / projectedRegularDays
      : Number.POSITIVE_INFINITY;
  const projectedMinimumMargin =
    1 - (powerScale * (1 - minimumMeasuredMargin)) / rewardScale;
  const calendarBandError =
    Math.abs(projectedFullIdleDays - 294) / 70 +
    Math.abs(projectedRegularDays - 147) / 35;
  const velocityTargetError = Math.abs(projectedVelocityRatio - 2);
  const parameterDeviation =
    Math.abs(rewardScale - 1) +
    Math.abs(contractScale - 1) +
    Math.abs(bufferScale - 1) +
    Math.abs(powerScale - 1);
  return {
    projectedFullIdleDays,
    projectedRegularDays,
    projectedVelocityRatio,
    projectedMinimumMargin,
    calendarBandError,
    velocityTargetError,
    parameterDeviation,
  };
};

export const createMeasuredNsgaCalibration = (
  runs: readonly CampaignRunMetrics[],
  evidence: BalanceAcceptanceEvidence,
  seed = 73_019,
) => {
  const evaluate = (vector: readonly number[]) => {
    const projection = calibrationProjection(vector, runs, evidence);
    return [
      projection.calendarBandError,
      projection.velocityTargetError,
      projection.projectedMinimumMargin,
      projection.parameterDeviation,
    ];
  };
  const result = runNsga2({
    parameters: measuredCalibrationParameters,
    objectiveDirections: ["minimize", "minimize", "maximize", "minimize"],
    evaluate,
    populationSize: 24,
    generations: 8,
    seed,
    initialPopulation: [[10_000, 20_000, 10_000, 10_000]],
  });
  const sourceRunIds = runs.map((run) => run.runId).join("|");
  const row = (individual: (typeof result.population)[number]) => ({
    evaluationSource: "measured-run-surrogate-projection",
    requiresPublicRuntimeValidation: true,
    sourceRunIds,
    sourceRunCount: runs.length,
    ...Object.fromEntries(
      measuredCalibrationParameters.map((parameter, index) => [
        parameter.id,
        individual.vector[index],
      ]),
    ),
    ...calibrationProjection(individual.vector, runs, evidence),
    objectiveCalendarBandError: individual.objectives[0],
    objectiveVelocityTargetError: individual.objectives[1],
    objectiveMinimumMargin: individual.objectives[2],
    objectiveParameterDeviation: individual.objectives[3],
    rank: individual.rank,
    crowdingDistance: individual.crowdingDistance,
  });
  const pareto = result.paretoFront.map(row);
  const recommended = [...result.paretoFront]
    .sort((left, right) => {
      const leftScore =
        (left.objectives[0] ?? 0) +
        (left.objectives[1] ?? 0) * 2 +
        Math.max(0, 0.3 - (left.objectives[2] ?? 0)) * 10 +
        (left.objectives[3] ?? 0) * 0.1;
      const rightScore =
        (right.objectives[0] ?? 0) +
        (right.objectives[1] ?? 0) * 2 +
        Math.max(0, 0.3 - (right.objectives[2] ?? 0)) * 10 +
        (right.objectives[3] ?? 0) * 0.1;
      return leftScore - rightScore;
    })[0];
  if (!recommended) throw new Error("Measured NSGA-II produced no Pareto candidate");
  const currentRuntimeVector = [10_000, 20_000, 10_000, 10_000] as const;
  const currentRuntimeAcceptance = evaluateBalanceAcceptance(evidence);
  return {
    populationRows: result.population.map(row),
    paretoRows: pareto,
    recommendedRows: [
      {
        ...row(recommended),
        recommended: true,
        validationStatus: "requires-application-and-public-rerun",
      },
    ],
    selectedRows: [
      {
        evaluationSource: "real-public-campaign-validation",
        sourceRunIds,
        sourceRunCount: runs.length,
        repeatableRewardBps: currentRuntimeVector[0],
        contractValueBps: currentRuntimeVector[1],
        bufferCostBps: currentRuntimeVector[2],
        powerCostBps: currentRuntimeVector[3],
        ...calibrationProjection(currentRuntimeVector, runs, evidence),
        selected: true,
        selectionKind: "current-runtime",
        realPublicRunValidationPassed: currentRuntimeAcceptance.passed,
        acceptanceIssueCount: currentRuntimeAcceptance.issues.length,
        completedPublicRunCount: runs.filter(
          (run) => run.status === "completed" && run.completedAtMs !== null,
        ).length,
      },
    ],
    historyRows: result.history,
  };
};

export type PublicRouteStep =
  | { kind: "dispatch"; action: GameAction }
  | { kind: "dispatch-plan"; actions: readonly GameAction[] }
  | { kind: "advance"; elapsedMs: number };

interface PublicRouteState {
  game: GameState;
  nowMs: number;
}

const bufferIndex = (visible: DeepReadonly<VisibleState>) =>
  [
    "startingNode",
    "localScheduler",
    "cronRuntime",
    "systemScheduler",
    "fleetOrchestrator",
    "clusterController",
    "rackController",
    "dataCenterNoc",
    "globalScheduler",
  ].indexOf(visible.automationBuffer.ownedLevelId);

const completedMissionCount = (visible: DeepReadonly<VisibleState>) =>
  visible.missions.filter((mission) => mission.completed).length;

const objectiveResearchIds: Readonly<Record<string, readonly string[]>> = {
  "bootstrap:decode-logic": ["decodeLogic"],
  "bootstrap:byte-copy": ["byteOperations"],
  "bootstrap:first-benchmark": ["benchmarkHarness"],
  "coherent:multicore": ["multiCore"],
  "coherent:local-scheduler": ["localScheduler"],
  "coherent:ram-control": ["ramControl"],
  "coherent:system-scheduler": ["systemScheduler"],
  "coherent:cron-runtime": ["systemBus", "cronScheduler"],
};

const objectiveRequirementProgress = (visible: DeepReadonly<VisibleState>) =>
  visible.research
    .filter((research) =>
      (objectiveResearchIds[visible.currentObjective?.id ?? ""] ?? []).includes(
        research.id,
      ),
    )
    .reduce(
      (score, research) =>
        score +
        Number(research.completed) * 20 +
        Number(research.canBuy) * 10 +
        research.requirements.filter((requirement) => requirement.met).length,
      0,
    );

const hardwareProgress = (visible: DeepReadonly<VisibleState>) =>
  visible.hardware.cpus.reduce(
    (total, cpu) =>
      total +
      cpu.level +
      cpu.cacheLevel +
      cpu.cacheSpeedLevel +
      cpu.coreIds.length +
      cpu.schedulerSlots,
    0,
  ) +
  visible.hardware.ramLevel +
  visible.hardware.systemSchedulerSlots;

const hardwareSignature = (visible: DeepReadonly<VisibleState>) =>
  visible.hardware.cpus
    .map(
      (cpu) =>
        `${cpu.tierId}-${cpu.level}-${cpu.cacheLevel}-${cpu.cacheSpeedLevel}-${cpu.coreIds.length}-${cpu.schedulerSlots}`,
    )
    .join("|") +
  `:ram-${visible.hardware.ramLevel}-${visible.hardware.ramBits}-${visible.hardware.ramSpeedLevel}:system-slots-${visible.hardware.systemSchedulerSlots}`;

/** A bounded real-runtime route search from the first public screen to Fleet. */
export const createOpeningFleetBeamCalibration = (
  seed = 91_337,
  maximumDepth = 192,
) => {
  const prefixRun = runCampaign({
    runtime: bootstrapSmokeRuntime,
    profile: sessionCadenceProfiles.regular,
    seed,
    scheduleMode: "deterministic",
    actionPolicy: regularActionPolicy,
    completion: {
      isComplete: (visible) =>
        visible.currentObjective?.id === "coherent:system-scheduler" ||
        visible.currentChapter.index >= 3,
    },
    milestones: bootstrapMilestoneAdapter,
    // Metered billing from the first tick (C-DES-6 ruling) slows the measured
    // regular cadence: the System Scheduler decision window now lands around
    // day 6-7 instead of inside the old 3-day prefix.
    maximumCalendarMs: 8 * 24 * 60 * 60_000,
    offlineStepMs: 24 * 60 * 60_000,
  });
  if (prefixRun.metrics.status !== "completed") {
    throw new Error(
      "Public opening prefix did not reach the System Scheduler decision window.",
    );
  }
  const initialState: PublicRouteState = {
    game: prefixRun.state,
    nowMs: prefixRun.metrics.elapsedCalendarMs,
  };
  const result = beamSearchPublicActionRoutes<
    PublicRouteState,
    VisibleState,
    PublicRouteStep
  >({
    initialState,
    observe: (state) => deriveVisibleState(state.game),
    enumerateActions: (visible, route) => {
      if (visible.currentChapter.index >= 3) return [];
      const nowMs = initialState.nowMs + route.reduce(
        (total, step) =>
          total + (step.kind === "advance" ? step.elapsedMs : 0),
        0,
      );
      const decision = decideBalancePolicy({
        profileId: "regular",
        scheduleMode: "deterministic",
        sessionIndex: 0,
        sessionKind: "deep",
        nowMs,
        elapsedCalendarMs: nowMs,
        remainingActiveMs: 90 * 60_000,
        visible,
      });
      const dispatchPlan: PublicRouteStep[] =
        decision.actions.length === 0
          ? []
          : decision.actions.length === 1
            ? [{ kind: "dispatch", action: decision.actions[0]! }]
            : [{ kind: "dispatch-plan", actions: decision.actions }];
      const advances = [
        60_000,
        15 * 60_000,
        2 * 60 * 60_000,
        8 * 60 * 60_000,
      ].map(
        (elapsedMs): PublicRouteStep => ({ kind: "advance", elapsedMs }),
      );
      return [...dispatchPlan, ...advances];
    },
    applyPublicAction: (state, step) =>
      step.kind === "advance"
        ? {
            game: advanceGame(state.game, step.elapsedMs, "foreground").state,
            nowMs: state.nowMs + step.elapsedMs,
          }
        : step.kind === "dispatch"
          ? { ...state, game: applyAction(state.game, step.action) }
          : {
              ...state,
              game: step.actions.reduce(
                (game, action) => applyAction(game, action),
                state.game,
              ),
            },
    score: (visible, route) =>
      visible.currentChapter.index * 1_000_000 +
      completedMissionCount(visible) * 25_000 +
      objectiveRequirementProgress(visible) * 500 +
      visible.research.filter((research) => research.completed).length * 1_000 +
      hardwareProgress(visible) * 100 +
      visible.projects.reduce(
        (score, project) =>
          score + project.phaseIndex * 5_000 + Number(project.active) * 1_000,
        0,
      ) +
      bufferIndex(visible) * 500 -
      route.length,
    dominance: (visible, route) => ({
      group: `${visible.currentChapter.id}:${visible.currentObjective?.id ?? "none"}:${visible.automationBuffer.ownedLevelId}:calendar-${Math.floor(visible.contractMarket.elapsedMs / (2 * 60 * 60_000))}:${hardwareSignature(visible)}:${visible.projects.map((project) => `${project.id}-${project.phaseIndex}-${Number(project.active)}`).join("|")}`,
      values: [
        completedMissionCount(visible),
        objectiveRequirementProgress(visible),
        visible.research.filter((research) => research.completed).length,
        Math.log10(1 + Math.max(0, Number(String(visible.exactResources.credits)))),
        route.length,
      ],
    }),
    objectiveDirections: [
      "maximize",
      "maximize",
      "maximize",
      "maximize",
      "minimize",
    ],
    isGoal: (visible) => visible.currentChapter.index >= 3,
    stopOnFirstGoal: true,
    stateKey: (visible) =>
      JSON.stringify({
        chapter: visible.currentChapter.id,
        objective: visible.currentObjective?.id ?? null,
        calendarBucket: Math.floor(
          visible.contractMarket.elapsedMs / (15 * 60_000),
        ),
        contractMarket: [
          visible.contractMarket.canRefresh,
          Math.ceil(visible.contractMarket.refreshAvailableInMs / 60_000),
        ],
        buffer: visible.automationBuffer.ownedLevelId,
        research: visible.research
          .filter((research) => research.completed)
          .map((research) => research.id),
        jobs: visible.jobs.map((job) => [job.id, job.canStart, job.canQueue]),
        projects: visible.projects.map((project) => [
          project.id,
          project.phaseIndex,
          project.active,
          project.phaseProgressMs,
        ]),
        active: visible.activeTasks.map((task) => [
          task.instanceId,
          task.taskId,
          task.status,
          Math.round(task.progress * 1_000),
        ]),
        queue: visible.queue,
        contracts: visible.contracts.map((contract) => [
          contract.id,
          contract.accepted,
          Math.round(contract.workCompletedMs / 60_000),
          Math.round(contract.remainingMs / 60_000),
        ]),
        credits: visible.exactResources.credits,
        data: visible.exactResources.data,
        hardware: hardwareSignature(visible),
      }),
    beamWidth: 4,
    maximumDepth,
  });
  const goal = result.goals[0] ?? null;
  const selected = goal ?? result.best;
  const routeRows: Array<{
    seed: number;
    routeEdgeIndex: number;
    planActionIndex: number | null;
    kind: "dispatch" | "advance";
    elapsedMs: number | null;
    actionType: string | null;
    action: string | null;
    publicActionCount: number;
    stepIndex?: number;
  }> = [];
  let replayGame = initialState.game;
  let attemptedPublicActions = 0;
  let noOpPublicActions = 0;
  for (const [edgeIndex, step] of selected.route.entries()) {
    if (step.kind === "advance") {
      replayGame = advanceGame(replayGame, step.elapsedMs, "foreground").state;
      routeRows.push({
        seed,
        routeEdgeIndex: edgeIndex + 1,
        planActionIndex: null,
        kind: "advance",
        elapsedMs: step.elapsedMs,
        actionType: null,
        action: null,
        publicActionCount: 0,
      });
      continue;
    }
    const actions = step.kind === "dispatch" ? [step.action] : step.actions;
    for (const [planActionIndex, action] of actions.entries()) {
      attemptedPublicActions += 1;
      const before = deriveVisibleState(replayGame);
      const afterGame = applyAction(replayGame, action);
      const after = deriveVisibleState(afterGame);
      replayGame = afterGame;
      if (JSON.stringify(before) === JSON.stringify(after)) {
        noOpPublicActions += 1;
        continue;
      }
      routeRows.push({
        seed,
        routeEdgeIndex: edgeIndex + 1,
        planActionIndex:
          step.kind === "dispatch-plan" ? planActionIndex + 1 : null,
        kind: "dispatch",
        elapsedMs: null,
        actionType: action.type,
        action: JSON.stringify(action),
        publicActionCount: 1,
      });
    }
  }
  const replayVisible = deriveVisibleState(replayGame);
  const routeReplayMatchesSelected =
    JSON.stringify(replayVisible) === JSON.stringify(selected.visible);
  return {
    reachedFleet: goal !== null,
    statsRows: [
      {
        seed,
        evaluationSource: "public-runtime-beam-search",
        prefixSource: "deterministic-public-runner",
        prefixRunId: prefixRun.metrics.runId,
        prefixStatus: prefixRun.metrics.status,
        prefixElapsedCalendarMs: prefixRun.metrics.elapsedCalendarMs,
        prefixElapsedCalendarDays: prefixRun.metrics.elapsedCalendarDays,
        prefixFinalChapterId: prefixRun.visible.currentChapter.id,
        prefixFinalObjectiveId: prefixRun.visible.currentObjective?.id ?? null,
        maximumDepth,
        beamWidth: 4,
        reachedFleet: goal !== null,
        bestDepth: selected.depth,
        bestScore: selected.score,
        finalChapterId: selected.visible.currentChapter.id,
        finalObjectiveId: selected.visible.currentObjective?.id ?? null,
        finalBufferLevelId: selected.visible.automationBuffer.ownedLevelId,
        finalCredits: String(selected.visible.exactResources.credits),
        finalData: String(selected.visible.exactResources.data),
        goalCount: result.goals.length,
        attemptedPublicActions,
        successfulPublicActions: attemptedPublicActions - noOpPublicActions,
        noOpPublicActions,
        routeReplayMatchesSelected,
        ...result.stats,
      },
    ],
    routeRows: routeRows.map((row, index) => ({
      ...row,
      stepIndex: index + 1,
    })),
  };
};
