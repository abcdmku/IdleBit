import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountDivide,
  amountMin,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  exactCost,
  exactResourceBag,
  type Amount,
  type ExactCost,
  type ExactResourceBag,
} from "./amount";
import {
  getCampaignChapterDefinition,
  getCampaignChapterIndex,
  updateCampaignProgress,
} from "./campaign";
import { addExactRewards, canAffordExact, spendExact } from "./economy";
import {
  createHardwareWorkRecipe,
  createHardwareWorkStage,
  getHardwareWorkDurationMs,
  getHardwareWorkTotal,
  summarizeHardwareWorkMix,
  type HardwareWorkRecipe,
  type HardwareWorkResourceId,
} from "./hardwareWork";
import {
  getSystemHardwareWorkRates,
  getSystemWorkThroughputBlockedReason,
} from "./systemHardwareWork";
import {
  createWorkValueMultiplier,
  getWorkValueCredits,
  type WorkValueMultiplier,
} from "./workValue";
import { getResearchDefinition, hasResearch } from "./content/research";
import type {
  CampaignChapterId,
  GameState,
  ProjectId,
  ProjectProgressState,
  ProjectsState,
  ResearchId,
  SideArcId,
  VisibleProject,
} from "./types";

export interface ProjectPhaseDefinition {
  id: string;
  name: string;
  /** Sequential hardware path; each stage consumes its own authored volume. */
  recipe: HardwareWorkRecipe;
  /** Exact transferred-bit and compute-cycle work settled by this phase. */
  paidWorkUnits: Amount;
  /** Frozen, named reason for the phase's value relative to base work. */
  workValueMultiplier: WorkValueMultiplier;
  costs: ExactCost[];
  /** Credits are always derived from paidWorkUnits and workValueMultiplier. */
  rewards: ExactResourceBag;
}

export interface ProjectDefinition {
  id: ProjectId;
  name: string;
  description: string;
  requiredChapter: CampaignChapterId;
  /** Projects are background system workloads; they stay locked until the
   * automation research that makes unattended phases plausible is owned. */
  requiredResearchId: ResearchId | null;
  sideArcId: SideArcId | null;
  phases: ProjectPhaseDefinition[];
}

export const PROJECT_DELIVERY_WORK_VALUE_MULTIPLIER =
  createWorkValueMultiplier("campaign-project-delivery", 10_000);

const phase = (
  id: string,
  name: string,
  stages: readonly (readonly [HardwareWorkResourceId, string])[],
  creditCost: string,
  dataCost: string,
  dataReward: string,
  workValueMultiplier = PROJECT_DELIVERY_WORK_VALUE_MULTIPLIER,
): ProjectPhaseDefinition => {
  // Volumes are productive work, never reverse-engineered elapsed time.
  const recipe = createHardwareWorkRecipe(
    stages.map(([resource, work], index) =>
      createHardwareWorkStage(`${id}:${index + 1}:${resource}`, resource, work),
    ),
  );
  const paidWorkUnits = getHardwareWorkTotal(recipe);
  return {
    id,
    name,
    recipe,
    paidWorkUnits,
    workValueMultiplier,
    costs: [exactCost("credits", creditCost), exactCost("data", dataCost)].filter(
      (cost) => cost.amount !== "0",
    ),
    rewards: exactResourceBag(
      getWorkValueCredits(paidWorkUnits, workValueMultiplier),
      dataReward,
    ),
  };
};

export const projectDefinitions: readonly ProjectDefinition[] = [
  {
    id: "schedulerIntegration",
    name: "Scheduler Integration",
    description: "Prove that queued compute and memory policies can share one plan.",
    requiredChapter: "coherentMachine",
    requiredResearchId: "systemScheduler",
    sideArcId: null,
    phases: [
      phase("queue-map", "Map queue pressure", [["cache", "60"], ["ram", "60"], ["compute", "180"]], "200", "0", "18"),
      phase("policy-run", "Run the policy trial", [["cache", "50"], ["ram", "100"], ["compute", "150"]], "200", "1", "45"),
    ],
  },
  {
    id: "archivist",
    name: "The Archivist",
    description:
      "Add integrity checks and snapshots. Completion unlocks rack/zone replica-domain policies.",
    requiredChapter: "localFabric",
    requiredResearchId: null,
    sideArcId: "archivist",
    phases: [
      phase("ecc", "Validate ECC paths", [["ram", "1800"], ["compute", "5400"]], "5000", "20", "400"),
      phase("snapshots", "Stage durable snapshots", [["storageWrite", "7200"], ["ram", "3600"], ["compute", "10800"]], "12000", "100", "900"),
      phase("replication", "Prove replica recovery", [["networkEgress", "10800"], ["storageRead", "10800"], ["compute", "21600"]], "30000", "300", "2400"),
    ],
  },
  {
    id: "openFoundry",
    name: "Open Foundry",
    description:
      "Build open compilation and rendering batches. Completion unlocks advanced GPU/NPU modules.",
    requiredChapter: "workshopFleet",
    requiredResearchId: null,
    sideArcId: "openFoundry",
    phases: [
      phase("toolchain", "Assemble the toolchain", [["cache", "600"], ["ram", "600"], ["compute", "2400"]], "1800", "1", "160"),
      phase("render", "Render the reference corpus", [["storageRead", "3600"], ["ram", "3600"], ["compute", "7200"]], "8000", "100", "600"),
      phase("publish", "Publish the open batch", [["networkEgress", "7200"], ["storageRead", "3600"], ["compute", "18000"]], "16000", "300", "1200"),
    ],
  },
  {
    id: "gridRelief",
    name: "Grid Relief",
    description:
      "Coordinate renewables and safe load shedding. Completion reduces productive facility operating cost by 20%.",
    requiredChapter: "rackAndFacility",
    requiredResearchId: null,
    sideArcId: "gridRelief",
    phases: [
      phase("heat-map", "Map facility heat", [["ram", "3600"], ["compute", "10800"]], "10000", "100", "800"),
      phase("load-shed", "Trial safe load shedding", [["networkIngress", "10800"], ["compute", "32400"]], "30000", "400", "2000"),
      phase("relief-run", "Complete the relief run", [["networkEgress", "21600"], ["storageRead", "21600"], ["compute", "43200"]], "60000", "1000", "5000"),
    ],
  },
] as const;

const definitionById = new Map(projectDefinitions.map((definition) => [definition.id, definition]));

const getPhaseTotalWork = (phaseDefinition: ProjectPhaseDefinition) =>
  getHardwareWorkTotal(phaseDefinition.recipe);

const getPhaseSettlement = (phaseDefinition: ProjectPhaseDefinition) =>
  exactResourceBag(
    getWorkValueCredits(
      getPhaseTotalWork(phaseDefinition),
      phaseDefinition.workValueMultiplier,
    ),
    phaseDefinition.rewards.data,
  );

const getAggregateStageWork = (
  phaseDefinition: ProjectPhaseDefinition,
  stageIndex: number,
  stageWorkCompleted: Amount,
) =>
  phaseDefinition.recipe.stages
    .slice(0, stageIndex)
    .reduce((total, stage) => amountAdd(total, stage.work), stageWorkCompleted);

const stageProgressFromAggregate = (
  phaseDefinition: ProjectPhaseDefinition,
  aggregateWork: Amount,
) => {
  let remaining = amountMin(getPhaseTotalWork(phaseDefinition), aggregateWork);
  let stageIndex = 0;
  for (; stageIndex < phaseDefinition.recipe.stages.length; stageIndex += 1) {
    const stage = phaseDefinition.recipe.stages[stageIndex]!;
    if (amountCompare(remaining, stage.work) < 0) break;
    remaining = amountSubtract(remaining, stage.work);
  }
  return {
    stageIndex,
    stageWorkCompleted:
      stageIndex >= phaseDefinition.recipe.stages.length
        ? ZERO_AMOUNT
        : remaining,
  };
};

const normalizePhaseWorkCompleted = (
  value: unknown,
  legacyProgressMs: number,
  phaseDefinition: ProjectPhaseDefinition,
) => {
  const totalWork = getPhaseTotalWork(phaseDefinition);
  try {
    if (typeof value === "string" || typeof value === "number") {
      return amountMin(totalWork, amountClampMin(value));
    }
  } catch {
    // Fall through to the legacy wall-clock progress migration.
  }
  return amountMin(
    totalWork,
    amountDivide(amount(Math.max(0, legacyProgressMs)), 1_000),
  );
};

export const getProjectDefinition = (projectId: ProjectId) => {
  const definition = definitionById.get(projectId);
  if (!definition) throw new Error(`Unknown project: ${projectId}`);
  return definition;
};

export const hasCompletedProject = (
  state: GameState,
  projectId: ProjectId,
) => state.projects.completedProjectIds.includes(projectId);

export const createProjectsState = (): ProjectsState => ({
  progress: {},
  completedProjectIds: [],
});

export const normalizeProjectsState = (
  value: Partial<ProjectsState> | null | undefined,
): ProjectsState => {
  const progress: ProjectsState["progress"] = {};
  for (const definition of projectDefinitions) {
    const saved = value?.progress?.[definition.id];
    if (!saved) continue;
    const phaseIndex = Math.min(
      definition.phases.length,
      Math.max(0, Math.trunc(saved.phaseIndex ?? 0)),
    );
    const completed = saved.completed === true || phaseIndex >= definition.phases.length;
    const currentPhase = definition.phases[phaseIndex];
    const legacyProgressMs = Math.max(
      0,
      Number.isFinite(saved.phaseProgressMs) ? saved.phaseProgressMs : 0,
    );
    const phaseWorkCompleted =
      completed || !currentPhase
        ? ZERO_AMOUNT
        : normalizePhaseWorkCompleted(
            saved.phaseWorkCompleted,
            legacyProgressMs,
            currentPhase,
          );
    const normalizedStage = currentPhase
      ? stageProgressFromAggregate(currentPhase, phaseWorkCompleted)
      : { stageIndex: 0, stageWorkCompleted: ZERO_AMOUNT };
    progress[definition.id] = {
      projectId: definition.id,
      phaseIndex,
      phaseWorkCompleted,
      phaseStageIndex: normalizedStage.stageIndex,
      phaseStageWorkCompleted: normalizedStage.stageWorkCompleted,
      phaseProgressMs: completed
        ? 0
        : amountToSafeNumber(amountMultiply(phaseWorkCompleted, 1_000)),
      active: !completed && saved.active === true,
      completed,
      systemId:
        typeof saved.systemId === "number" && Number.isFinite(saved.systemId)
          ? Math.trunc(saved.systemId)
          : null,
    };
  }
  const completedProjectIds = projectDefinitions
    .filter((definition) =>
      value?.completedProjectIds?.includes(definition.id) || progress[definition.id]?.completed,
    )
    .map((definition) => definition.id);
  return { progress, completedProjectIds };
};

const defaultProgress = (projectId: ProjectId): ProjectProgressState => ({
  projectId,
  phaseIndex: 0,
  phaseWorkCompleted: ZERO_AMOUNT,
  phaseStageIndex: 0,
  phaseStageWorkCompleted: ZERO_AMOUNT,
  phaseProgressMs: 0,
  active: false,
  completed: false,
  systemId: null,
});

const getProgress = (state: GameState, projectId: ProjectId) =>
  state.projects.progress[projectId] ?? defaultProgress(projectId);

export const getProjectBlockedReason = (
  state: GameState,
  projectId: ProjectId,
  systemId = state.selectedSystemId,
) => {
  const definition = getProjectDefinition(projectId);
  const progress = getProgress(state, projectId);
  if (progress.completed) return "Project complete.";
  if (progress.active) return "Project phase already active.";
  if (
    getCampaignChapterIndex(state.campaign.currentChapterId) <
    getCampaignChapterIndex(definition.requiredChapter)
  ) {
    return `Requires ${getCampaignChapterDefinition(definition.requiredChapter).name}.`;
  }
  if (
    definition.requiredResearchId &&
    !hasResearch(state, definition.requiredResearchId)
  ) {
    return `Requires ${getResearchDefinition(definition.requiredResearchId).name} research.`;
  }
  const currentPhase = definition.phases[progress.phaseIndex];
  if (!currentPhase) return "No project phase available.";
  const projectionBlockedReason = getProjectProjectionBlockedReason(
    state,
    systemId,
    currentPhase.recipe,
  );
  if (projectionBlockedReason) return projectionBlockedReason;
  if (!canAffordExact(state, currentPhase.costs)) return "Insufficient resources.";
  return null;
};

export const startProjectPhase = (
  state: GameState,
  projectId: ProjectId,
  systemId = state.selectedSystemId,
) => {
  if (getProjectBlockedReason(state, projectId, systemId)) return state;
  const definition = getProjectDefinition(projectId);
  const progress = getProgress(state, projectId);
  const currentPhase = definition.phases[progress.phaseIndex];
  if (!currentPhase) return state;
  const paid = spendExact(state, currentPhase.costs);
  return {
    ...paid,
    projects: {
      ...paid.projects,
      progress: {
        ...paid.projects.progress,
        [projectId]: { ...progress, active: true, systemId },
      },
    },
  };
};

export const getActiveProjectSystemIds = (state: GameState) =>
  Object.values(state.projects.progress)
    .filter((progress): progress is ProjectProgressState => Boolean(progress?.active))
    .map((progress) => progress.systemId)
    .filter((systemId): systemId is number => systemId !== null);

export const hasActiveProjects = (state: GameState) =>
  getActiveProjectSystemIds(state).length > 0;

export const getProjectComputeRate = (
  state: GameState,
  systemId: number,
  requirePowered = true,
) => getSystemHardwareWorkRates(state, systemId, requirePowered).compute;

const getCompletedPhaseWork = (
  progress: ProjectProgressState,
  phaseDefinition: ProjectPhaseDefinition,
) => {
  const aggregate = normalizePhaseWorkCompleted(
    progress.phaseWorkCompleted,
    progress.phaseProgressMs,
    phaseDefinition,
  );
  return amountMin(getPhaseTotalWork(phaseDefinition), aggregate);
};

const getPhaseStageProgress = (
  progress: ProjectProgressState,
  phaseDefinition: ProjectPhaseDefinition,
) => {
  const stageIndex = Math.max(
    0,
    Math.min(
      phaseDefinition.recipe.stages.length,
      Math.trunc(progress.phaseStageIndex ?? -1),
    ),
  );
  if (progress.phaseStageIndex !== undefined && stageIndex < phaseDefinition.recipe.stages.length) {
    const stage = phaseDefinition.recipe.stages[stageIndex]!;
    try {
      const stageWorkCompleted = amountMin(
        stage.work,
        amountClampMin(progress.phaseStageWorkCompleted ?? 0),
      );
      return { stageIndex, stageWorkCompleted };
    } catch {
      // Fall back to aggregate/legacy progress.
    }
  }
  return stageProgressFromAggregate(
    phaseDefinition,
    getCompletedPhaseWork(progress, phaseDefinition),
  );
};

const getRemainingPhaseRecipe = (
  phaseDefinition: ProjectPhaseDefinition,
  stageIndex: number,
  stageWorkCompleted: Amount,
) =>
  createHardwareWorkRecipe(
    phaseDefinition.recipe.stages.slice(stageIndex).map((stage, index) =>
      createHardwareWorkStage(
        stage.id,
        stage.resource,
        index === 0 ? amountSubtract(stage.work, stageWorkCompleted) : stage.work,
      ),
    ),
  );

const getProjectProjectionBlockedReason = (
  state: GameState,
  systemId: number,
  recipe: HardwareWorkRecipe,
) => getSystemWorkThroughputBlockedReason(state, systemId, recipe);

export const getProjectRemainingMs = (
  state: GameState,
  progress: ProjectProgressState,
) => {
  if (progress.systemId === null) return Number.POSITIVE_INFINITY;
  const phaseDefinition = getProjectDefinition(progress.projectId).phases[
    progress.phaseIndex
  ];
  if (!phaseDefinition) return 0;
  const stageProgress = getPhaseStageProgress(progress, phaseDefinition);
  const durationMs = getHardwareWorkDurationMs(
    getRemainingPhaseRecipe(
      phaseDefinition,
      stageProgress.stageIndex,
      stageProgress.stageWorkCompleted,
    ),
    getSystemHardwareWorkRates(state, progress.systemId),
  );
  if (durationMs === null) return Number.POSITIVE_INFINITY;
  return amountToSafeNumber(durationMs);
};

export const getNextProjectEventMs = (state: GameState) => {
  const remaining = Object.values(state.projects.progress)
    .filter((progress): progress is ProjectProgressState => Boolean(progress?.active))
    .map((progress) => {
      return getProjectRemainingMs(state, progress);
    });
  return remaining.length > 0 ? Math.min(...remaining) : Number.POSITIVE_INFINITY;
};

export const advanceProjects = (
  state: GameState,
  elapsedMs: number,
  canProgress: (progress: ProjectProgressState) => boolean = () => true,
  /**
   * State whose hardware rates held over the advanced interval. Advancement
   * loops pass the pre-slice state so project work is integrated with the
   * rates that actually applied over [t, t+dt], not the slice-end snapshot.
   */
  rateState: GameState = state,
) => {
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  let working = state;
  const progress = { ...working.projects.progress };
  let completedProjectIds = [...working.projects.completedProjectIds];
  for (const rawProgress of Object.values(progress)) {
    if (!rawProgress?.active || rawProgress.completed || !canProgress(rawProgress)) continue;
    const definition = getProjectDefinition(rawProgress.projectId);
    const currentPhase = definition.phases[rawProgress.phaseIndex];
    if (!currentPhase) continue;
    if (rawProgress.systemId === null) continue;
    const rates = getSystemHardwareWorkRates(rateState, rawProgress.systemId);
    let { stageIndex, stageWorkCompleted } = getPhaseStageProgress(
      rawProgress,
      currentPhase,
    );
    let remainingMs = amount(elapsed);
    while (
      stageIndex < currentPhase.recipe.stages.length &&
      amountCompare(remainingMs, 0) > 0
    ) {
      const stage = currentPhase.recipe.stages[stageIndex]!;
      const rate = rates[stage.resource];
      if (amountCompare(rate, 0) <= 0) break;
      const remainingWork = amountSubtract(stage.work, stageWorkCompleted);
      const stageDurationMs = amountMultiply(
        amountDivide(remainingWork, rate),
        1_000,
      );
      const stepMs = amountMin(remainingMs, stageDurationMs);
      stageWorkCompleted = amountMin(
        stage.work,
        amountAdd(
          stageWorkCompleted,
          amountMultiply(rate, amountDivide(stepMs, 1_000)),
        ),
      );
      remainingMs = amountSubtract(remainingMs, stepMs);
      if (amountCompare(stageWorkCompleted, stage.work) < 0) break;
      stageIndex += 1;
      stageWorkCompleted = ZERO_AMOUNT;
    }
    const phaseWorkCompleted = getAggregateStageWork(
      currentPhase,
      stageIndex,
      stageWorkCompleted,
    );
    if (stageIndex < currentPhase.recipe.stages.length) {
      progress[rawProgress.projectId] = {
        ...rawProgress,
        phaseWorkCompleted,
        phaseStageIndex: stageIndex,
        phaseStageWorkCompleted: stageWorkCompleted,
        phaseProgressMs: amountToSafeNumber(
          amountMultiply(phaseWorkCompleted, 1_000),
        ),
      };
      continue;
    }
    working = addExactRewards(working, getPhaseSettlement(currentPhase));
    const phaseIndex = rawProgress.phaseIndex + 1;
    const completed = phaseIndex >= definition.phases.length;
    progress[rawProgress.projectId] = {
      ...rawProgress,
      phaseIndex,
      phaseWorkCompleted: ZERO_AMOUNT,
      phaseStageIndex: 0,
      phaseStageWorkCompleted: ZERO_AMOUNT,
      phaseProgressMs: 0,
      active: false,
      completed,
    };
    if (completed) {
      completedProjectIds = Array.from(new Set([...completedProjectIds, rawProgress.projectId]));
    }
  }
  return updateCampaignProgress({
    ...working,
    projects: { progress, completedProjectIds },
  });
};

export const getVisibleProjects = (state: GameState): VisibleProject[] =>
  projectDefinitions
    .filter(
      (definition) =>
        getCampaignChapterIndex(definition.requiredChapter) <=
        getCampaignChapterIndex(state.campaign.currentChapterId),
    )
    .map((definition) => {
    const progress = getProgress(state, definition.id);
    const phaseDefinition = definition.phases[progress.phaseIndex] ?? null;
    const systemId = progress.systemId ?? state.selectedSystemId;
    const stageProgress = phaseDefinition
      ? getPhaseStageProgress(progress, phaseDefinition)
      : { stageIndex: 0, stageWorkCompleted: ZERO_AMOUNT };
    const remainingRecipe = phaseDefinition
      ? getRemainingPhaseRecipe(
          phaseDefinition,
          stageProgress.stageIndex,
          stageProgress.stageWorkCompleted,
        )
      : null;
    const getSystemProjection = (targetSystemId: number) => {
      const planningRates = getSystemHardwareWorkRates(
        state,
        targetSystemId,
        false,
      );
      const projectedDuration = phaseDefinition
        ? getHardwareWorkDurationMs(phaseDefinition.recipe, planningRates)
        : ZERO_AMOUNT;
      const projectedRemaining = remainingRecipe
        ? getHardwareWorkDurationMs(remainingRecipe, planningRates)
        : ZERO_AMOUNT;
      const projectionBlockedReason = remainingRecipe
        ? getProjectProjectionBlockedReason(state, targetSystemId, remainingRecipe)
        : null;
      const startBlockedReason = getProjectBlockedReason(
        state,
        definition.id,
        targetSystemId,
      );
      return {
        projectedDuration,
        projectedRemaining,
        visible: {
          systemId: targetSystemId,
          durationMs:
            projectedDuration === null
              ? Number.MAX_SAFE_INTEGER
              : amountToSafeNumber(projectedDuration),
          remainingMs:
            projectedRemaining === null
              ? Number.MAX_SAFE_INTEGER
              : amountToSafeNumber(projectedRemaining),
          projectionBlockedReason,
          canStartPhase: startBlockedReason === null,
          startBlockedReason,
        },
      };
    };
    const systemProjectionDetails = state.systems.map((system) =>
      getSystemProjection(system.id),
    );
    const selectedProjection =
      systemProjectionDetails.find(
        (projection) => projection.visible.systemId === systemId,
      ) ?? getSystemProjection(systemId);
    const { projectedDuration, projectedRemaining } = selectedProjection;
    const {
      durationMs,
      remainingMs,
      projectionBlockedReason,
      startBlockedReason: blockedReason,
      canStartPhase,
    } = selectedProjection.visible;
    const phaseProgressMs =
      phaseDefinition && projectedDuration !== null && projectedRemaining !== null
        ? amountToSafeNumber(
            amountSubtract(projectedDuration, projectedRemaining),
          )
        : 0;
    const currentPhase = phaseDefinition
      ? {
          id: phaseDefinition.id,
          name: phaseDefinition.name,
          durationMs,
          costs: phaseDefinition.costs,
          rewards: getPhaseSettlement(phaseDefinition),
          paidWorkUnits: phaseDefinition.paidWorkUnits,
          workValueMultiplier: phaseDefinition.workValueMultiplier,
          workMix: summarizeHardwareWorkMix(phaseDefinition.recipe),
        }
      : null;
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      sideArcId: definition.sideArcId,
      currentPhase,
      phaseIndex: progress.phaseIndex,
      phaseProgressMs,
      remainingMs: currentPhase ? remainingMs : 0,
      projectionBlockedReason,
      systemProjections: systemProjectionDetails.map(
        (projection) => projection.visible,
      ),
      active: progress.active,
      completed: progress.completed,
      canStartPhase,
      blockedReason,
    };
    });

export const getProjectRewardDelta = (before: GameState, after: GameState) => {
  let credits = ZERO_AMOUNT;
  let data = ZERO_AMOUNT;
  for (const definition of projectDefinitions) {
    const beforeProgress = getProgress(before, definition.id);
    const afterProgress = getProgress(after, definition.id);
    for (
      let phaseIndex = beforeProgress.phaseIndex;
      phaseIndex < afterProgress.phaseIndex;
      phaseIndex += 1
    ) {
      const phaseDefinition = definition.phases[phaseIndex];
      if (!phaseDefinition) continue;
      const rewards = getPhaseSettlement(phaseDefinition);
      credits = amountAdd(credits, rewards.credits);
      data = amountAdd(data, rewards.data);
    }
  }
  return { credits, data };
};
