import type {
  CampaignChapterDefinition,
  CampaignChapterId,
  CampaignObjectiveDefinition,
  CampaignState,
  FinaleCharterId,
  GameState,
  SideArcId,
  VisibleCampaignChapter,
  VisibleMission,
} from "./types";
import { selectCloudFinaleCharter } from "./cloud";

const completedTask = (state: GameState, taskId: keyof GameState["completedTasks"]) =>
  (state.completedTasks[taskId] ?? 0) > 0 || state.completedBenchmarks.includes(taskId);

const researched = (state: GameState, researchId: GameState["research"]["completed"][number]) =>
  state.research.completed.includes(researchId);

const hasSpecializedComputeProof = (state: GameState) => {
  const evidence = state.systems.reduce(
    (totals, system) => ({
      gpu:
        totals.gpu +
        (system.workshop?.evidence.gpuRenderCompletions ?? 0),
      npu:
        totals.npu +
        (system.workshop?.evidence.npuInferenceCompletions ?? 0),
    }),
    { gpu: 0, npu: 0 },
  );
  return evidence.gpu > 0 && evidence.npu > 0;
};

export const campaignChapterDefinitions: readonly CampaignChapterDefinition[] = [
  {
    id: "bootstrapNode",
    index: 1,
    name: "Bootstrap Node",
    description: "Bring a bit-scale machine from first operation to a measured node.",
    objectiveIds: [
      "bootstrap:first-operation",
      "bootstrap:decode-logic",
      "bootstrap:byte-copy",
      "bootstrap:first-benchmark",
    ],
  },
  {
    id: "coherentMachine",
    index: 2,
    name: "Coherent Machine",
    description: "Unify cores, memory, and schedulers into one dependable system.",
    objectiveIds: [
      "coherent:multicore",
      "coherent:local-scheduler",
      "coherent:ram-control",
      "coherent:system-scheduler",
      "coherent:cron-runtime",
    ],
  },
  {
    id: "workshopFleet",
    index: 3,
    name: "Workshop Fleet",
    description: "Build named systems and specialize repeatable production.",
    objectiveIds: [
      "fleet:catalog",
      "fleet:second-system",
      "fleet:specialized-throughput",
    ],
  },
  {
    id: "localFabric",
    index: 4,
    name: "Local Fabric",
    description: "Connect systems and coordinate distributed work.",
    objectiveIds: ["fabric:cluster-controller"],
  },
  {
    id: "rackAndFacility",
    index: 5,
    name: "Rack and Facility",
    description: "Scale compute into powered, cooled, networked facilities.",
    objectiveIds: ["facility:rack-controller"],
  },
  {
    id: "resilientCloud",
    index: 6,
    name: "Resilient Cloud",
    description: "Meet service guarantees across failure domains.",
    objectiveIds: ["cloud:data-center-noc", "cloud:availability"],
  },
  {
    id: "planetaryCommons",
    index: 7,
    name: "Planetary Commons",
    description: "Route a shared compute commons and choose its enduring charter.",
    objectiveIds: ["planetary:global-scheduler", "planetary:finale", "planetary:charter"],
  },
] as const;

const objective = (
  definition: Omit<CampaignObjectiveDefinition, "blockedReason"> & {
    /** Static copy, or state-aware copy so multi-condition objectives drop
     * sub-conditions the player has already satisfied. */
    blockedReason: string | ((state: GameState) => string);
  },
): CampaignObjectiveDefinition => ({
  ...definition,
  blockedReason: (state) =>
    definition.requirement(state)
      ? null
      : typeof definition.blockedReason === "function"
        ? definition.blockedReason(state)
        : definition.blockedReason,
});

export const campaignObjectiveDefinitions: readonly CampaignObjectiveDefinition[] = [
  objective({
    id: "bootstrap:first-operation",
    chapterId: "bootstrapNode",
    name: "Execute a first operation",
    description: "Complete Fetch Bit or Decode Bit.",
    transmission: "Signal acquired. The node can observe its own work.",
    requirement: (state) => completedTask(state, "fetchBit") || completedTask(state, "decodeBit"),
    blockedReason: "Complete Fetch Bit or Decode Bit.",
  }),
  objective({
    id: "bootstrap:decode-logic",
    chapterId: "bootstrapNode",
    name: "Decode the instruction stream",
    description: "Complete Decode Logic research.",
    transmission: "The machine now distinguishes data from instruction.",
    requirement: (state) => researched(state, "decodeLogic"),
    blockedReason: "Research Decode Logic.",
  }),
  objective({
    id: "bootstrap:byte-copy",
    chapterId: "bootstrapNode",
    name: "Move a complete byte",
    description: "Complete Byte Copy once.",
    transmission: "Eight bits move as one useful unit.",
    requirement: (state) => completedTask(state, "byteCopy"),
    blockedReason: "Complete Byte Copy.",
  }),
  objective({
    id: "bootstrap:first-benchmark",
    chapterId: "bootstrapNode",
    name: "Establish a baseline",
    description: "Complete the Micro Benchmark.",
    transmission: "A measured node can finally improve with intent.",
    requirement: (state) => completedTask(state, "microBenchmark"),
    blockedReason: "Complete the Micro Benchmark.",
  }),
  objective({
    id: "coherent:multicore",
    chapterId: "coherentMachine",
    name: "Coordinate multiple cores",
    description: "Research Multi-Core Control.",
    transmission: "Parallel work is now a design choice, not an accident.",
    requirement: (state) => researched(state, "multiCore"),
    blockedReason: "Research Multi-Core Control.",
  }),
  objective({
    id: "coherent:local-scheduler",
    chapterId: "coherentMachine",
    name: "Install local scheduling",
    description: "Research Local Scheduler.",
    transmission: "The queue can continue after attention moves elsewhere.",
    requirement: (state) => researched(state, "localScheduler"),
    blockedReason: "Research Local Scheduler.",
  }),
  objective({
    id: "coherent:ram-control",
    chapterId: "coherentMachine",
    name: "Stage working memory",
    description: "Research RAM Control and install RAM.",
    transmission: "Working sets no longer end at the cache boundary.",
    requirement: (state) => researched(state, "ramControl") && state.hardware.ramBits > 0,
    blockedReason: (state) =>
      researched(state, "ramControl")
        ? "Install RAM."
        : "Research RAM Control and install RAM.",
  }),
  objective({
    id: "coherent:system-scheduler",
    chapterId: "coherentMachine",
    name: "Schedule the complete system",
    description: "Research System Scheduler.",
    transmission: "Memory and compute now share one plan.",
    requirement: (state) => researched(state, "systemScheduler"),
    blockedReason: "Research System Scheduler.",
  }),
  objective({
    id: "coherent:cron-runtime",
    chapterId: "coherentMachine",
    name: "Leave a standing order",
    description: "Research CRON Runtime and configure a standing order.",
    transmission: "The machine can keep a promise while unattended.",
    requirement: (state) => researched(state, "cronScheduler") && state.standingOrder.taskId !== null,
    blockedReason: (state) =>
      researched(state, "cronScheduler")
        ? "Configure a standing order."
        : "Research CRON and configure a standing order.",
  }),
  objective({
    id: "fleet:catalog",
    chapterId: "workshopFleet",
    name: "Open the system catalog",
    description: "Research System Catalog.",
    transmission: "A machine is now one member of a workshop fleet.",
    requirement: (state) => researched(state, "systemCatalog"),
    blockedReason: "Research System Catalog.",
  }),
  objective({
    id: "fleet:second-system",
    chapterId: "workshopFleet",
    name: "Commission a second system",
    description: "Own at least two named systems.",
    transmission: "Capacity can be routed instead of merely upgraded.",
    requirement: (state) => state.systems.length >= 2,
    blockedReason: "Commission a second system.",
  }),
  objective({
    id: "fleet:specialized-throughput",
    chapterId: "workshopFleet",
    name: "Prove specialized throughput",
    description:
      "Complete GPU rendering, NPU inference, and the Workstation Benchmark.",
    transmission:
      "The workshop now routes graphics and inference to hardware built for each load.",
    requirement: (state) =>
      researched(state, "specializedCompute") &&
      hasSpecializedComputeProof(state) &&
      completedTask(state, "workstationBenchmark"),
    blockedReason: (state) =>
      !researched(state, "specializedCompute")
        ? "Research Specialized Compute, complete GPU rendering and NPU inference, then run the Workstation Benchmark."
        : !hasSpecializedComputeProof(state)
          ? "Complete GPU rendering and NPU inference, then run the Workstation Benchmark."
          : "Run the Workstation Benchmark.",
  }),
  objective({
    id: "fabric:cluster-controller",
    chapterId: "localFabric",
    name: "Commit a replicated shard",
    description:
      "Purchase Cluster Controller, form a cluster, and complete Replicated Shard Commit.",
    transmission: "Queues cross machine boundaries without losing ownership.",
    requirement: (state) =>
      [
        "clusterController",
        "rackController",
        "dataCenterNoc",
        "globalScheduler",
      ].includes(state.automationBuffer.ownedLevelId) &&
      (state.infrastructure.successfulShardCommits ?? 0) > 0,
    blockedReason: (state) =>
      [
        "clusterController",
        "rackController",
        "dataCenterNoc",
        "globalScheduler",
      ].includes(state.automationBuffer.ownedLevelId)
        ? "Complete Replicated Shard Commit."
        : "Purchase Cluster Controller and complete Replicated Shard Commit.",
  }),
  objective({
    id: "facility:rack-controller",
    chapterId: "rackAndFacility",
    name: "Operate a true rack",
    description: "Purchase Rack Controller and place a managed Fleet node in a true rack.",
    transmission: "Systems become replaceable units of facility capacity.",
    requirement: (state) =>
      ["rackController", "dataCenterNoc", "globalScheduler"].includes(
        state.automationBuffer.ownedLevelId,
      ) &&
      state.infrastructure.facilities.some((facility) =>
        facility.racks.some((rack) => rack.placements.length > 0),
      ),
    blockedReason: (state) =>
      ["rackController", "dataCenterNoc", "globalScheduler"].includes(
        state.automationBuffer.ownedLevelId,
      )
        ? "Operate a managed node in a true rack."
        : "Purchase Rack Controller and operate a managed node in a true rack.",
  }),
  objective({
    id: "cloud:data-center-noc",
    chapterId: "resilientCloud",
    name: "Staff the Data Center NOC",
    description: "Purchase Data Center NOC.",
    transmission: "Facility operations can persist across several days.",
    requirement: (state) => ["dataCenterNoc", "globalScheduler"].includes(
      state.automationBuffer.ownedLevelId,
    ),
    blockedReason: "Purchase Data Center NOC.",
  }),
  objective({
    id: "cloud:availability",
    chapterId: "resilientCloud",
    name: "Demonstrate resilient service",
    description: "Complete a successful Cloud SLA window.",
    transmission: "Resilience, efficiency, and openness can reinforce one another.",
    requirement: (state) => state.cloud.completedSlas.some((sla) => sla.succeeded),
    blockedReason: "Complete a successful Cloud SLA window.",
  }),
  objective({
    id: "planetary:global-scheduler",
    chapterId: "planetaryCommons",
    name: "Install the Global Scheduler",
    description: "Purchase the seven-day Automation Buffer.",
    transmission: "The commons can coordinate a full planetary week.",
    requirement: (state) => state.automationBuffer.ownedLevelId === "globalScheduler",
    blockedReason: "Purchase Global Scheduler.",
  }),
  objective({
    id: "planetary:finale",
    chapterId: "planetaryCommons",
    name: "Complete the planetary finale",
    description: "Route enough Cloud capacity through every planetary phase.",
    transmission: "A shared compute commons is online.",
    requirement: (state) => state.cloud.finale?.complete === true,
    blockedReason: "Complete the Cloud planetary finale.",
  }),
  objective({
    id: "planetary:charter",
    chapterId: "planetaryCommons",
    name: "Choose a postgame charter",
    description: "Select Resilience, Efficiency, or Open Compute.",
    transmission: "The campaign ends; the commons continues.",
    requirement: (state) => state.cloud.finaleCharterId !== null,
    blockedReason: "Choose a finale charter.",
  }),
] as const;

export const sideArcDefinitions: ReadonlyArray<{
  id: SideArcId;
  name: string;
  description: string;
  projectId: "archivist" | "openFoundry" | "gridRelief";
}> = [
  { id: "archivist", name: "The Archivist", description: "Integrity, snapshots, and replication.", projectId: "archivist" },
  { id: "openFoundry", name: "Open Foundry", description: "Compilation, rendering, and open batch capacity.", projectId: "openFoundry" },
  { id: "gridRelief", name: "Grid Relief", description: "Cooling, efficiency, and civic load shedding.", projectId: "gridRelief" },
];

export const finaleCharterDefinitions: ReadonlyArray<{
  id: FinaleCharterId;
  name: string;
  description: string;
}> = [
  { id: "resilience", name: "Resilience", description: "Favor redundancy and safe recovery." },
  { id: "efficiency", name: "Efficiency", description: "Favor useful work per unit of energy." },
  { id: "openCompute", name: "Open Compute", description: "Favor shared capacity and open workloads." },
];

const chapterById = new Map(campaignChapterDefinitions.map((chapter) => [chapter.id, chapter]));
const objectiveById = new Map(campaignObjectiveDefinitions.map((item) => [item.id, item]));

export const getCampaignChapterDefinition = (id: CampaignChapterId) => {
  const chapter = chapterById.get(id);
  if (!chapter) throw new Error(`Unknown campaign chapter: ${id}`);
  return chapter;
};

export const getCampaignObjectiveDefinition = (id: string) =>
  objectiveById.get(id) ?? null;

export const getCampaignChapterIndex = (id: CampaignChapterId) =>
  getCampaignChapterDefinition(id).index;

export const createCampaignState = (): CampaignState => ({
  currentChapterId: "bootstrapNode",
  currentObjectiveId: "bootstrap:first-operation",
  completedChapterIds: [],
  completedObjectiveIds: [],
  unlockedTransmissionIds: [],
  sideArcsCompleted: [],
  finaleCharterId: null,
  postgameUnlocked: false,
});

const validChapterIds = new Set(campaignChapterDefinitions.map((chapter) => chapter.id));
const validObjectiveIds = new Set(campaignObjectiveDefinitions.map((item) => item.id));

export const normalizeCampaignState = (
  value: Partial<CampaignState> | null | undefined,
): CampaignState => {
  const fresh = createCampaignState();
  const currentChapterId = validChapterIds.has(value?.currentChapterId as CampaignChapterId)
    ? (value?.currentChapterId as CampaignChapterId)
    : fresh.currentChapterId;
  const chapter = getCampaignChapterDefinition(currentChapterId);
  const completedObjectiveIds = Array.from(
    new Set((value?.completedObjectiveIds ?? []).filter((id) => validObjectiveIds.has(id))),
  );
  const requestedCurrent = value?.currentObjectiveId;
  const currentObjectiveId =
    requestedCurrent === null
      ? null
      : chapter.objectiveIds.includes(requestedCurrent ?? "")
        ? requestedCurrent ?? chapter.objectiveIds[0] ?? null
        : chapter.objectiveIds.find((id) => !completedObjectiveIds.includes(id)) ?? null;
  return {
    currentChapterId,
    currentObjectiveId,
    completedChapterIds: Array.from(
      new Set((value?.completedChapterIds ?? []).filter((id) => validChapterIds.has(id))),
    ),
    completedObjectiveIds,
    unlockedTransmissionIds: Array.from(
      new Set((value?.unlockedTransmissionIds ?? []).filter((id) => validObjectiveIds.has(id))),
    ),
    sideArcsCompleted: Array.from(
      new Set((value?.sideArcsCompleted ?? []).filter((id): id is SideArcId =>
        id === "archivist" || id === "openFoundry" || id === "gridRelief",
      )),
    ),
    finaleCharterId:
      value?.finaleCharterId === "resilience" ||
      value?.finaleCharterId === "efficiency" ||
      value?.finaleCharterId === "openCompute"
        ? value.finaleCharterId
        : null,
    postgameUnlocked: value?.postgameUnlocked === true,
  };
};

export const updateCampaignProgress = (state: GameState): GameState => {
  let campaign = normalizeCampaignState(state.campaign);
  const sideArcsCompleted = sideArcDefinitions
    .filter((arc) => state.projects.completedProjectIds.includes(arc.projectId))
    .map((arc) => arc.id);
  campaign = {
    ...campaign,
    sideArcsCompleted: Array.from(new Set([...campaign.sideArcsCompleted, ...sideArcsCompleted])),
    finaleCharterId: state.cloud.finaleCharterId ?? campaign.finaleCharterId,
    postgameUnlocked:
      campaign.postgameUnlocked || state.cloud.postgameUnlocked,
  };
  let guard = 0;
  while (campaign.currentObjectiveId && guard < 50) {
    guard += 1;
    const current = getCampaignObjectiveDefinition(campaign.currentObjectiveId);
    if (!current || !current.requirement({ ...state, campaign })) break;
    const completedObjectiveIds = Array.from(
      new Set([...campaign.completedObjectiveIds, current.id]),
    );
    const unlockedTransmissionIds = Array.from(
      new Set([...campaign.unlockedTransmissionIds, current.id]),
    );
    const chapter = getCampaignChapterDefinition(campaign.currentChapterId);
    const nextObjectiveId = chapter.objectiveIds.find(
      (id) => !completedObjectiveIds.includes(id),
    );
    if (nextObjectiveId) {
      campaign = { ...campaign, completedObjectiveIds, unlockedTransmissionIds, currentObjectiveId: nextObjectiveId };
      continue;
    }
    const completedChapterIds = Array.from(
      new Set([...campaign.completedChapterIds, chapter.id]),
    );
    const nextChapter = campaignChapterDefinitions.find((item) => item.index === chapter.index + 1);
    campaign = {
      ...campaign,
      completedObjectiveIds,
      unlockedTransmissionIds,
      completedChapterIds,
      currentChapterId: nextChapter?.id ?? chapter.id,
      currentObjectiveId: nextChapter?.objectiveIds[0] ?? null,
      postgameUnlocked:
        campaign.postgameUnlocked ||
        (chapter.id === "planetaryCommons" && campaign.finaleCharterId !== null),
    };
  }
  return campaign === state.campaign ? state : { ...state, campaign };
};

export const selectFinaleCharter = (
  state: GameState,
  charterId: FinaleCharterId,
) => {
  const cloud = selectCloudFinaleCharter(state.cloud, charterId);
  if (cloud.finaleCharterId !== charterId) return state;
  return updateCampaignProgress({
    ...state,
    cloud,
    campaign: { ...state.campaign, finaleCharterId: charterId, postgameUnlocked: true },
  });
};

export const getVisibleCampaignChapter = (state: GameState): VisibleCampaignChapter => {
  const definition = getCampaignChapterDefinition(state.campaign.currentChapterId);
  return {
    id: definition.id,
    index: definition.index,
    name: definition.name,
    description: definition.description,
    completed: state.campaign.completedChapterIds.includes(definition.id),
  };
};

export const getVisibleMissions = (state: GameState): VisibleMission[] =>
  campaignObjectiveDefinitions
    .filter(
      (definition) => definition.chapterId === state.campaign.currentChapterId,
    )
    .map((definition) => ({
    id: definition.id,
    chapterId: definition.chapterId,
    name: definition.name,
    description: definition.description,
    transmission: definition.transmission,
    completed: state.campaign.completedObjectiveIds.includes(definition.id),
    current: state.campaign.currentObjectiveId === definition.id,
    blockedReason:
      state.campaign.completedObjectiveIds.includes(definition.id)
        ? null
        : definition.blockedReason(state),
    }));

export const getCampaignBottleneck = (state: GameState) => {
  const current = state.campaign.currentObjectiveId
    ? getCampaignObjectiveDefinition(state.campaign.currentObjectiveId)
    : null;
  return current?.blockedReason(state) ?? (state.campaign.postgameUnlocked ? "Postgame contracts" : "No campaign blocker");
};
