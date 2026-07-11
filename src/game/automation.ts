import { exactCost } from "./amount";
import {
  getCampaignChapterDefinition,
  getCampaignChapterIndex,
} from "./campaign";
import { getTaskDefinition } from "./content/tasks";
import { getResearchDefinition } from "./content/research";
import { canAffordExact, spendExact, syncExactResources } from "./economy";
import { getHardwareCacheBits, getMemoryCapacityBits } from "./math";
import { materializeSystem } from "./systems";
import type {
  AutomationBufferDefinition,
  AutomationBufferLevelId,
  AutomationBufferState,
  GameAction,
  GameState,
  StandingOrderState,
  VisibleAutomationBuffer,
} from "./types";

const HOUR_MS = 60 * 60 * 1000;

export const automationBufferDefinitions: readonly AutomationBufferDefinition[] = [
  {
    id: "startingNode",
    name: "Starting Node",
    maxOfflineMs: 0,
    capability: "Closing freezes simulation.",
    requiredChapter: "bootstrapNode",
    requiredResearchId: null,
    costs: [],
    renewsStandingOrders: false,
  },
  {
    id: "localScheduler",
    name: "Local Scheduler",
    maxOfflineMs: 2 * HOUR_MS,
    capability: "Completes the existing finite queue only.",
    requiredChapter: "bootstrapNode",
    requiredResearchId: "localScheduler",
    // Tuned for the Jobs-only opening (no early project/contract credits).
    costs: [exactCost("credits", 70), exactCost("data", 8)],
    renewsStandingOrders: false,
  },
  {
    id: "cronRuntime",
    name: "CRON Runtime",
    maxOfflineMs: 8 * HOUR_MS,
    capability: "Renews one standing work order.",
    requiredChapter: "coherentMachine",
    requiredResearchId: "cronScheduler",
    costs: [exactCost("credits", 480), exactCost("data", 3)],
    renewsStandingOrders: true,
  },
  {
    id: "systemScheduler",
    name: "System Scheduler",
    maxOfflineMs: 12 * HOUR_MS,
    capability: "Runs system policies and projects.",
    requiredChapter: "coherentMachine",
    requiredResearchId: "systemScheduler",
    costs: [exactCost("credits", "190000"), exactCost("data", 5)],
    renewsStandingOrders: true,
  },
  {
    id: "fleetOrchestrator",
    name: "Fleet Orchestrator",
    maxOfflineMs: 24 * HOUR_MS,
    capability: "Supports daily unattended Fleet work.",
    requiredChapter: "workshopFleet",
    requiredResearchId: "systemCatalog",
    costs: [exactCost("credits", "500000"), exactCost("data", 1)],
    renewsStandingOrders: true,
  },
  {
    id: "clusterController",
    name: "Cluster Controller",
    maxOfflineMs: 48 * HOUR_MS,
    capability: "Maintains distributed workloads.",
    requiredChapter: "localFabric",
    requiredResearchId: "clusterControllerResearch",
    costs: [exactCost("credits", "6000000"), exactCost("data", 1)],
    renewsStandingOrders: true,
  },
  {
    id: "rackController",
    name: "Rack Controller",
    maxOfflineMs: 72 * HOUR_MS,
    capability: "Supports three-day infrastructure runs.",
    requiredChapter: "rackAndFacility",
    requiredResearchId: "rackControllerResearch",
    costs: [exactCost("credits", "1300000"), exactCost("data", 1)],
    renewsStandingOrders: true,
  },
  {
    id: "dataCenterNoc",
    name: "Data Center NOC",
    maxOfflineMs: 120 * HOUR_MS,
    capability: "Supports five-day facility operations.",
    requiredChapter: "rackAndFacility",
    requiredResearchId: "dataCenterNocResearch",
    costs: [exactCost("credits", "1700000"), exactCost("data", 1)],
    renewsStandingOrders: true,
  },
  {
    id: "globalScheduler",
    name: "Global Scheduler",
    maxOfflineMs: 168 * HOUR_MS,
    capability: "Final seven-day offline window.",
    requiredChapter: "planetaryCommons",
    requiredResearchId: "globalSchedulerResearch",
    costs: [exactCost("credits", "50000000"), exactCost("data", "1000000")],
    renewsStandingOrders: true,
  },
] as const;

const definitionById = new Map(
  automationBufferDefinitions.map((definition) => [definition.id, definition]),
);

export const isAutomationBufferLevelId = (
  value: unknown,
): value is AutomationBufferLevelId =>
  typeof value === "string" && definitionById.has(value as AutomationBufferLevelId);

export const getAutomationBufferDefinition = (id: AutomationBufferLevelId) => {
  const definition = definitionById.get(id);
  if (!definition) throw new Error(`Unknown Automation Buffer level: ${id}`);
  return definition;
};

export const getAutomationBufferLevelIndex = (id: AutomationBufferLevelId) =>
  automationBufferDefinitions.findIndex((definition) => definition.id === id);

export const getNextAutomationBufferDefinition = (state: GameState) =>
  automationBufferDefinitions[getAutomationBufferLevelIndex(state.automationBuffer.ownedLevelId) + 1] ??
  null;

const getEffectiveCampaignChapterIndex = (state: GameState) => {
  const savedIndex = getCampaignChapterIndex(state.campaign.currentChapterId);
  if (state.research.completed.includes("systemCatalog")) {
    return Math.max(savedIndex, 3);
  }
  if (
    state.research.completed.includes("localScheduler") ||
    state.research.completed.includes("systemScheduler") ||
    state.research.completed.includes("cronScheduler")
  ) {
    return Math.max(savedIndex, 2);
  }
  return savedIndex;
};

export const createAutomationBufferState = (): AutomationBufferState => ({
  ownedLevelId: "startingNode",
  departureLevelId: "startingNode",
  offlineProcessedMs: 0,
});

export const createStandingOrderState = (): StandingOrderState => ({
  taskId: null,
  systemId: null,
  enabled: false,
  renewalCount: 0,
});

export const normalizeAutomationBufferState = (
  value: Partial<AutomationBufferState> | null | undefined,
): AutomationBufferState => {
  const ownedLevelId = isAutomationBufferLevelId(value?.ownedLevelId)
    ? value.ownedLevelId
    : "startingNode";
  const departureLevelId = isAutomationBufferLevelId(value?.departureLevelId)
    ? value.departureLevelId
    : ownedLevelId;
  return {
    ownedLevelId,
    departureLevelId,
    offlineProcessedMs: Math.max(0, Number.isFinite(value?.offlineProcessedMs)
      ? Math.trunc(value?.offlineProcessedMs ?? 0)
      : 0),
  };
};

export const normalizeStandingOrderState = (
  value: Partial<StandingOrderState> | null | undefined,
): StandingOrderState => {
  let taskId = value?.taskId ?? null;
  try {
    if (taskId !== null && !getTaskDefinition(taskId).repeatable) taskId = null;
  } catch {
    taskId = null;
  }
  return {
    taskId,
    systemId:
      typeof value?.systemId === "number" && Number.isFinite(value.systemId)
        ? Math.trunc(value.systemId)
        : null,
    enabled: value?.enabled === true && taskId !== null,
    renewalCount: Math.max(0, Math.trunc(value?.renewalCount ?? 0)),
  };
};

export const getAutomationBufferBlockedReason = (
  state: GameState,
  definition: AutomationBufferDefinition,
): string | null => {
  const next = getNextAutomationBufferDefinition(state);
  if (next?.id !== definition.id) return "Automation Buffer levels must be purchased in order.";
  if (
    getEffectiveCampaignChapterIndex(state) <
    getCampaignChapterIndex(definition.requiredChapter)
  ) {
    return `Requires the ${getCampaignChapterDefinition(definition.requiredChapter).name} chapter.`;
  }
  if (
    definition.requiredResearchId &&
    !state.research.completed.includes(definition.requiredResearchId)
  ) {
    return `Requires ${getResearchDefinition(definition.requiredResearchId).name} research.`;
  }
  if (!canAffordExact(state, definition.costs)) return "Insufficient resources.";
  return null;
};

export const purchaseAutomationBuffer = (
  state: GameState,
  levelId: AutomationBufferLevelId,
): GameState => {
  const definition = getAutomationBufferDefinition(levelId);
  if (getAutomationBufferBlockedReason(state, definition)) return state;
  const purchased = spendExact(state, definition.costs);
  return {
    ...purchased,
    automationBuffer: {
      ...purchased.automationBuffer,
      ownedLevelId: levelId,
    },
  };
};

const normalizeTimestamp = (timestampMs: number) =>
  Math.max(0, Math.trunc(Number.isFinite(timestampMs) ? timestampMs : 0));

export const recordSave = (state: GameState, timestampMs: number): GameState => ({
  ...state,
  time: { ...state.time, lastSavedAtMs: normalizeTimestamp(timestampMs) },
});

export const recordDeparture = (state: GameState, timestampMs: number): GameState => ({
  ...state,
  time: {
    lastSavedAtMs: normalizeTimestamp(timestampMs),
    departedAtMs: normalizeTimestamp(timestampMs),
  },
  automationBuffer: {
    ...state.automationBuffer,
    departureLevelId: state.automationBuffer.ownedLevelId,
    offlineProcessedMs: 0,
  },
  lastAdvanceReport: null,
});

export const setStandingOrder = (
  state: GameState,
  taskId: GameState["standingOrder"]["taskId"],
  systemId = state.selectedSystemId,
): GameState => {
  if (taskId === null) {
    return {
      ...state,
      standingOrder: { ...state.standingOrder, taskId: null, enabled: false },
    };
  }
  if (!isStandingOrderTaskEligible(state, taskId, systemId)) return state;
  return {
    ...state,
    standingOrder: { ...state.standingOrder, taskId, systemId, enabled: true },
  };
};

export const isStandingOrderTaskEligible = (
  state: GameState,
  taskId: NonNullable<GameState["standingOrder"]["taskId"]>,
  systemId: number,
) => {
  if (!state.systems.some((system) => system.id === systemId)) return false;
  const task = getTaskDefinition(taskId);
  if (
    task.kind !== "task" ||
    !task.repeatable ||
    task.visibility === "internal"
  ) {
    return false;
  }
  const local = materializeSystem(state, systemId);
  return (
    task.requirement(local) &&
    task.cacheNeedBits <= getHardwareCacheBits(local) &&
    task.ramNeedBits <= getMemoryCapacityBits(local)
  );
};

export const applyAutomationAction = (state: GameState, action: GameAction): GameState => {
  if (action.type === "purchaseAutomationBuffer") {
    return purchaseAutomationBuffer(syncExactResources(state), action.levelId);
  }
  if (action.type === "recordDeparture") return recordDeparture(state, action.timestampMs);
  if (action.type === "recordSave") return recordSave(state, action.timestampMs);
  if (action.type === "setStandingOrder") {
    return setStandingOrder(state, action.taskId, action.systemId);
  }
  if (action.type === "setStandingOrderEnabled") {
    return {
      ...state,
      standingOrder: {
        ...state.standingOrder,
        enabled: action.enabled && state.standingOrder.taskId !== null,
      },
    };
  }
  return state;
};

export const getVisibleAutomationBuffer = (state: GameState): VisibleAutomationBuffer => {
  const owned = getAutomationBufferDefinition(state.automationBuffer.ownedLevelId);
  const departure = getAutomationBufferDefinition(state.automationBuffer.departureLevelId);
  const departed = state.time.departedAtMs !== null;
  const planningLevel = departed ? departure : owned;
  const processedMs = departed ? state.automationBuffer.offlineProcessedMs : 0;
  const next = getNextAutomationBufferDefinition(state);
  const blockedReason = next ? getAutomationBufferBlockedReason(state, next) : null;
  return {
    ownedLevelId: owned.id,
    maxOfflineMs: owned.maxOfflineMs,
    departureLevelId: departure.id,
    departureMaxOfflineMs: departure.maxOfflineMs,
    offlineProcessedMs: processedMs,
    remainingOfflineMs: Math.max(
      0,
      planningLevel.maxOfflineMs - processedMs,
    ),
    nextUpgrade: next
      ? {
          id: next.id,
          name: next.name,
          maxOfflineMs: next.maxOfflineMs,
          costs: next.costs,
          unlocked:
            getEffectiveCampaignChapterIndex(state) >=
              getCampaignChapterIndex(next.requiredChapter) &&
            (!next.requiredResearchId ||
              state.research.completed.includes(next.requiredResearchId)),
          canAfford: canAffordExact(state, next.costs),
          blockedReason,
        }
      : null,
  };
};
