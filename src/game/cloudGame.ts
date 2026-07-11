import {
  amount,
  amountCompare,
  amountDivide,
  amountMin,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  exactCost,
  exactResourceBag,
  sumAmounts,
  type Amount,
  type ExactResourceBag,
} from "./amount";
import {
  getAutomationBufferDefinition,
  getAutomationBufferLevelIndex,
} from "./automation";
import { getCampaignChapterIndex } from "./campaign";
import {
  advanceCloud,
  commissionCloudRegion,
  commissionCloudZone,
  getCloudRoutingSnapshot,
  getCloudSlaDefinition,
  getCloudSlaBlockedReason,
  hasPositiveCloudRoutingFlow,
  getNextCloudEventMs,
  getProductiveCloudFacilityIds,
  placeCloudReplica,
  requestCloudFailover,
  scheduleCloudIncident,
  selectCloudFinaleCharter,
  setCloudRegionalDemand,
  setCloudRoutingLinks,
  startCloudSla,
  startPlanetaryFinale,
} from "./cloud";
import { normalizeCloudState } from "./cloudState";
import { getProductiveClusterFacilityIds } from "./distributedDefinitions";
import { addExactRewards, spendExact } from "./economy";
import {
  deriveFacilityCloudEffectiveCompute,
  getFacilityOperatingCostPerSecondForGameState,
  normalizeFacilityInfrastructureForGameState,
} from "./facilityInfrastructure";
import { getFinaleCharterModifiers } from "./planetary";
import type { CloudSlaDefinitionId } from "./cloudTypes";
import type { AdvanceMode, GameAction, GameState } from "./types";
import {
  getExactWorkMarginBps,
  projectWorkMarginBps,
} from "./workProjections";
import {
  createWorkValueMultiplier,
  type WorkValueMultiplier,
} from "./workValue";

const BASIS_POINTS = 10_000;
const MAX_SAFE_TIME_MS = Number.MAX_SAFE_INTEGER;

const nonNegativeElapsed = (elapsedMs: number) =>
  Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);

const isCloudChapterUnlocked = (state: GameState) =>
  getCampaignChapterIndex(state.campaign.currentChapterId) >= 6;

const isPlanetaryChapterUnlocked = (state: GameState) =>
  getCampaignChapterIndex(state.campaign.currentChapterId) >= 7;

const hasAutomationBuffer = (
  state: GameState,
  requiredLevelId: GameState["automationBuffer"]["ownedLevelId"],
) =>
  getAutomationBufferLevelIndex(state.automationBuffer.ownedLevelId) >=
  getAutomationBufferLevelIndex(requiredLevelId);

/**
 * Reconciles saved Cloud hierarchy against authoritative facility state.
 * Missing facilities remove their zones and dangling replicas; capacity is
 * always rederived from current facility compute instead of trusting the save.
 */
export const normalizeCloudForGameState = (input: GameState): GameState => {
  const state = normalizeFacilityInfrastructureForGameState(input);
  const cloud = normalizeCloudState(state.cloud);
  const facilitiesById = new Map(
    state.infrastructure.facilities.map((facility) => [facility.id, facility]),
  );
  const modifiers = getFinaleCharterModifiers(cloud.finaleCharterId);
  const zones = cloud.zones.flatMap((zone) => {
    const facility = facilitiesById.get(zone.facilityId);
    if (!facility) return [];
    const baseCapacity = deriveFacilityCloudEffectiveCompute(facility);
    // Open Compute dedicates its guaranteed share to the commons instead of
    // selling it through player-run SLA windows. Keep the physical facility
    // capacity authoritative, then expose only the charter-usable remainder
    // to routing. This makes the advertised reserve a real throughput tradeoff
    // rather than a UI-only promise.
    const charterUsableCapacityBps = Math.max(
      0,
      BASIS_POINTS - modifiers.minimumOpenCapacityBps,
    );
    return [{
      ...zone,
      capacityPerSecond: amountDivide(
        amountMultiply(
          amountMultiply(baseCapacity, modifiers.coolingCapacityBps),
          charterUsableCapacityBps,
        ),
        BASIS_POINTS * BASIS_POINTS,
      ),
    }];
  });
  return {
    ...state,
    cloud: normalizeCloudState({ ...cloud, zones }),
  };
};

export const getCloudManagementBlockedReason = (state: GameState) =>
  isCloudChapterUnlocked(state) ? null : "Requires Resilient Cloud.";

/** Game-owned admission for Cloud SLA work; selectors and actions share it. */
export const getCloudSlaGameBlockedReason = (
  input: GameState,
  definitionId: CloudSlaDefinitionId,
) => {
  const state = normalizeCloudForGameState(input);
  if (!isCloudChapterUnlocked(state)) return "Requires Resilient Cloud.";
  if (!hasAutomationBuffer(state, "dataCenterNoc")) {
    return "Data Center NOC automation is required to start Cloud SLA work.";
  }
  if (state.cloud.finale && !state.cloud.finale.complete) {
    return "Finish the active planetary finale before starting another Cloud SLA.";
  }
  return getCloudSlaBlockedReason(state.cloud, definitionId);
};

/** Game-owned admission for the finite campaign finale. */
export const getPlanetaryFinaleBlockedReason = (input: GameState) => {
  const state = normalizeCloudForGameState(input);
  if (!isPlanetaryChapterUnlocked(state)) return "Requires Planetary Commons.";
  if (state.cloud.finale) return "Planetary finale already started.";
  if (!hasAutomationBuffer(state, "globalScheduler")) {
    return "Global Scheduler automation is required to start the planetary finale.";
  }
  if (state.cloud.activeSla) {
    return "Finish the active Cloud SLA before starting the planetary finale.";
  }
  if (
    !state.cloud.completedSlas.some(
      (sla) => sla.definitionId === "planetaryCoverage" && sla.succeeded,
    )
  ) {
    return "Complete a successful Planetary Coverage SLA first.";
  }
  const routing = getCloudRoutingSnapshot(state.cloud);
  if (routing.connectedRegionIds.length < 4) {
    return "Requires routed capacity in four regions.";
  }
  if (!hasPositiveCloudRoutingFlow(routing, 4)) {
    return "Requires positive flow on explicit routes connecting four served regions.";
  }
  return null;
};

export interface CloudSlaProjection {
  observationWindowMs: number;
  paidWorkUnits: Amount;
  workValueMultiplier: WorkValueMultiplier;
  charterRewardMultiplier: WorkValueMultiplier;
  /** Hardware-derived time to process the authored work at current routed throughput. */
  projectedWorkCompletionMs: Amount | null;
  rewards: ExactResourceBag;
  operatingCostPerSecond: Amount | null;
  operatingCostCredits: Amount | null;
  netRewardCredits: Amount | null;
  exactMarginBps: Amount | null;
  marginBps: number | null;
  bufferCovered: boolean;
  blockedReason: string | null;
}

/**
 * Public, game-owned Cloud SLA economics from the current facility/routing
 * configuration. The temporary active SLA makes productive-facility billing
 * use the same source selection as real advancement without mutating the save.
 */
export const getCloudSlaProjection = (
  input: GameState,
  definitionId: CloudSlaDefinitionId,
): CloudSlaProjection => {
  const state = normalizeCloudForGameState(input);
  const definition = getCloudSlaDefinition(definitionId);
  const charter = getFinaleCharterModifiers(state.cloud.finaleCharterId);
  const charterRewardMultiplier = createWorkValueMultiplier(
    `cloud-charter-${state.cloud.finaleCharterId ?? "standard"}`,
    charter.openContractRewardBps,
  );
  const rewards = exactResourceBag(
    amountDivide(
      amountMultiply(
        definition.rewards.credits,
        charterRewardMultiplier.basisPoints,
      ),
      BASIS_POINTS,
    ),
    amountDivide(
      amountMultiply(
        definition.rewards.data,
        charterRewardMultiplier.basisPoints,
      ),
      BASIS_POINTS,
    ),
  );
  const blockedReason = getCloudSlaGameBlockedReason(state, definitionId);
  const bufferCovered =
    definition.observationWindowMs <=
    getAutomationBufferDefinition(state.automationBuffer.ownedLevelId).maxOfflineMs;
  if (blockedReason) {
    return {
      observationWindowMs: definition.observationWindowMs,
      paidWorkUnits: definition.workRequired,
      workValueMultiplier: definition.workValueMultiplier,
      charterRewardMultiplier,
      projectedWorkCompletionMs: null,
      rewards,
      operatingCostPerSecond: null,
      operatingCostCredits: null,
      netRewardCredits: null,
      exactMarginBps: null,
      marginBps: null,
      bufferCovered,
      blockedReason,
    };
  }

  const planningCloud = startCloudSla(state.cloud, definitionId);
  if (!planningCloud.activeSla) {
    return {
      observationWindowMs: definition.observationWindowMs,
      paidWorkUnits: definition.workRequired,
      workValueMultiplier: definition.workValueMultiplier,
      charterRewardMultiplier,
      projectedWorkCompletionMs: null,
      rewards,
      operatingCostPerSecond: null,
      operatingCostCredits: null,
      netRewardCredits: null,
      exactMarginBps: null,
      marginBps: null,
      bufferCovered,
      blockedReason: "Cloud SLA projection could not start the admitted workload.",
    };
  }
  const planningState = normalizeCloudForGameState({
    ...state,
    cloud: planningCloud,
  });
  const operatingCostPerSecond = getCloudOperatingCostPerSecond(
    planningState,
    "foreground",
  );
  const routedWorkPerSecond = getCloudRoutingSnapshot(
    planningState.cloud,
  ).result.delivered;
  const projectedWorkCompletionMs = amountCompare(routedWorkPerSecond, 0) > 0
    ? amountMultiply(
        amountDivide(definition.workRequired, routedWorkPerSecond),
        1_000,
      )
    : null;
  const operatingCostCredits = amountDivide(
    amountMultiply(
      operatingCostPerSecond,
      definition.observationWindowMs,
    ),
    1_000,
  );
  const netRewardCredits = amountSubtract(
    rewards.credits,
    operatingCostCredits,
  );
  const exactMarginBps = getExactWorkMarginBps(
    netRewardCredits,
    rewards.credits,
  );
  return {
    observationWindowMs: definition.observationWindowMs,
    paidWorkUnits: definition.workRequired,
    workValueMultiplier: definition.workValueMultiplier,
    charterRewardMultiplier,
    projectedWorkCompletionMs,
    rewards,
    operatingCostPerSecond,
    operatingCostCredits,
    netRewardCredits,
    exactMarginBps,
    marginBps: projectWorkMarginBps(exactMarginBps),
    bufferCovered,
    blockedReason: null,
  };
};

const withCloud = (state: GameState, cloud: GameState["cloud"]): GameState =>
  normalizeCloudForGameState({ ...state, cloud });

export const isCloudAction = (action: GameAction) =>
  action.type === "commissionCloudRegion" ||
  action.type === "commissionCloudZone" ||
  action.type === "placeCloudReplica" ||
  action.type === "setCloudRegionalDemand" ||
  action.type === "setCloudRoutingLinks" ||
  action.type === "setCloudFailoverPolicy" ||
  action.type === "requestCloudFailover" ||
  action.type === "drawCloudIncident" ||
  action.type === "startCloudSla" ||
  action.type === "startPlanetaryFinale" ||
  action.type === "selectFinaleCharter";

export const applyCloudAction = (
  input: GameState,
  action: GameAction,
): GameState => {
  const state = normalizeCloudForGameState(input);
  if (!isCloudAction(action) || getCloudManagementBlockedReason(state)) {
    return state;
  }
  if (action.type === "commissionCloudRegion") {
    return withCloud(state, commissionCloudRegion(state.cloud, action.name));
  }
  if (action.type === "commissionCloudZone") {
    const facility = state.infrastructure.facilities.find(
      (candidate) => candidate.id === action.facilityId,
    );
    if (!facility) return state;
    return withCloud(
      state,
      commissionCloudZone(state.cloud, {
        regionId: action.regionId,
        facilityId: facility.id,
        name: action.name,
        baseLatencyMs: action.baseLatencyMs,
        faultDomainId: action.faultDomainId,
        capacityPerSecond: deriveFacilityCloudEffectiveCompute(facility),
      }),
    );
  }
  if (action.type === "placeCloudReplica") {
    return withCloud(state, placeCloudReplica(state.cloud, action.zoneId));
  }
  if (action.type === "setCloudRegionalDemand") {
    return withCloud(
      state,
      setCloudRegionalDemand(state.cloud, action.regionId, action.demand),
    );
  }
  if (action.type === "setCloudRoutingLinks") {
    return withCloud(state, setCloudRoutingLinks(state.cloud, action.links));
  }
  if (action.type === "setCloudFailoverPolicy") {
    return withCloud(
      state,
      normalizeCloudState({
        ...state.cloud,
        automaticFailover: action.automaticFailover,
        failoverDelayMs:
          action.delayMs === undefined
            ? state.cloud.failoverDelayMs
            : Math.max(
                0,
                Math.min(
                  24 * 60 * 60_000,
                  Number.isFinite(action.delayMs)
                    ? Math.trunc(action.delayMs)
                    : state.cloud.failoverDelayMs,
                ),
              ),
      }),
    );
  }
  if (action.type === "requestCloudFailover") {
    return withCloud(state, requestCloudFailover(state.cloud));
  }
  if (action.type === "drawCloudIncident") {
    const scheduled = scheduleCloudIncident({
      state: state.cloud,
      rng: state.rng,
      optIn: action.optIn,
      windowMs: Math.max(
        0,
        Number.isFinite(action.windowMs) ? Math.trunc(action.windowMs) : 0,
      ),
    });
    return normalizeCloudForGameState({
      ...state,
      cloud: scheduled.state,
      rng: scheduled.rng,
    });
  }
  if (action.type === "startCloudSla") {
    if (getCloudSlaGameBlockedReason(state, action.definitionId)) return state;
    return withCloud(state, startCloudSla(state.cloud, action.definitionId));
  }
  if (action.type === "startPlanetaryFinale") {
    if (getPlanetaryFinaleBlockedReason(state)) return state;
    return withCloud(state, startPlanetaryFinale(state.cloud));
  }
  if (action.type === "selectFinaleCharter") {
    const cloud = selectCloudFinaleCharter(state.cloud, action.charterId);
    if (cloud.finaleCharterId !== action.charterId) return state;
    return normalizeCloudForGameState({
      ...state,
      cloud,
      campaign: {
        ...state.campaign,
        finaleCharterId: action.charterId,
        postgameUnlocked: true,
      },
    });
  }
  return state;
};

export const hasActiveCloudWork = (state: GameState) =>
  state.cloud.activeSla !== null ||
  Boolean(state.cloud.finale && !state.cloud.finale.complete);

export const getCloudOfflineBlockedReason = (
  state: GameState,
  mode: AdvanceMode,
) => {
  if (mode !== "offline") return null;
  const departureIndex = getAutomationBufferLevelIndex(
    state.automationBuffer.departureLevelId,
  );
  if (
    state.cloud.finale &&
    !state.cloud.finale.complete &&
    departureIndex < getAutomationBufferLevelIndex("globalScheduler")
  ) {
    return "Global Scheduler automation is required for the planetary finale.";
  }
  if (
    state.cloud.activeSla &&
    departureIndex < getAutomationBufferLevelIndex("dataCenterNoc")
  ) {
    return "Data Center NOC automation is required for Cloud SLA work.";
  }
  return null;
};

const getCloudStructuralBlockedReasonFromNormalizedState = (
  state: GameState,
  mode: AdvanceMode,
) => {
  if (!hasActiveCloudWork(state)) return null;
  const offline = getCloudOfflineBlockedReason(state, mode);
  if (offline) return offline;
  const routing = getCloudRoutingSnapshot(state.cloud);
  if (amountCompare(routing.result.delivered, 0) <= 0) {
    return "No routed regional capacity.";
  }
  if (
    state.cloud.activeSla?.definitionId === "planetaryCoverage" &&
    !hasPositiveCloudRoutingFlow(
      routing,
      getCloudSlaDefinition("planetaryCoverage").minimumRegionCount,
    )
  ) {
    return "Requires positive flow on explicit routes connecting 2 served regions.";
  }
  if (state.cloud.finale && !state.cloud.finale.complete) {
    if (!hasPositiveCloudRoutingFlow(routing, 4)) {
      return "Requires positive flow on explicit routes connecting four served regions.";
    }
    const phase = state.cloud.finale.plan.phases[state.cloud.finale.phaseIndex];
    if (
      phase &&
      routing.connectedRegionIds.length < phase.requiredRegionCount
    ) {
      return `Requires ${phase.requiredRegionCount} connected regions.`;
    }
  }
  return null;
};

export const getProductiveCloudFacilityIdsForGameState = (
  input: GameState,
  mode: AdvanceMode = "foreground",
) => {
  const state = normalizeCloudForGameState(input);
  return getProductiveCloudFacilityIdsFromNormalizedGameState(state, mode);
};

const getProductiveCloudFacilityIdsFromNormalizedGameState = (
  state: GameState,
  mode: AdvanceMode,
) => {
  if (getCloudStructuralBlockedReasonFromNormalizedState(state, mode)) {
    return [];
  }
  const existing = new Set(
    state.infrastructure.facilities.map((facility) => facility.id),
  );
  return getProductiveCloudFacilityIds(state.cloud).filter((id) =>
    existing.has(id),
  );
};

const getBillableCloudFacilityIds = (
  state: GameState,
  mode: AdvanceMode,
  alreadyBilledFacilityIds: Iterable<string>,
) => {
  const alreadyBilled = new Set(alreadyBilledFacilityIds);
  return getProductiveCloudFacilityIdsFromNormalizedGameState(
    state,
    mode,
  ).filter((facilityId) => !alreadyBilled.has(facilityId));
};

/** Internal Cloud cost selector for a canonicalized game state. */
export const getNormalizedCloudOperatingCostPerSecond = (
  state: GameState,
  mode: AdvanceMode = "foreground",
  alreadyBilledFacilityIds: Iterable<string> = getProductiveClusterFacilityIds(
    state,
    mode,
  ),
): Amount => {
  const billableIds = new Set(
    getBillableCloudFacilityIds(state, mode, alreadyBilledFacilityIds),
  );
  const baseCost = sumAmounts(
    state.infrastructure.facilities
      .filter((facility) => billableIds.has(facility.id))
      .map((facility) =>
        getFacilityOperatingCostPerSecondForGameState(state, facility),
      ),
  );
  return amountDivide(
    amountMultiply(
      baseCost,
      getFinaleCharterModifiers(state.cloud.finaleCharterId).operatingCostBps,
    ),
    BASIS_POINTS,
  );
};

export const getCloudOperatingCostPerSecond = (
  input: GameState,
  mode: AdvanceMode = "foreground",
  alreadyBilledFacilityIds?: Iterable<string>,
): Amount => {
  const state = normalizeCloudForGameState(input);
  return getNormalizedCloudOperatingCostPerSecond(
    state,
    mode,
    alreadyBilledFacilityIds ?? getProductiveClusterFacilityIds(state, mode),
  );
};

/** Internal blocker selector for a canonicalized game state. */
export const getNormalizedCloudAdvanceBlockedReason = (
  state: GameState,
  mode: AdvanceMode,
) => {
  if (!hasActiveCloudWork(state)) return null;
  const structural = getCloudStructuralBlockedReasonFromNormalizedState(
    state,
    mode,
  );
  if (structural) return structural;
  const rate = getNormalizedCloudOperatingCostPerSecond(state, mode);
  return amountCompare(rate, 0) > 0 &&
    amountCompare(state.exactResources.credits, 0) <= 0
    ? "Insufficient credits for Cloud facility operating cost."
    : null;
};

export const getCloudAdvanceBlockedReason = (
  input: GameState,
  mode: AdvanceMode,
) => {
  if (!hasActiveCloudWork(input)) return null;
  const state = normalizeCloudForGameState(input);
  return getNormalizedCloudAdvanceBlockedReason(state, mode);
};

export const hasRunnableCloudWork = (
  state: GameState,
  mode: AdvanceMode = "foreground",
) =>
  hasActiveCloudWork(state) &&
  getCloudAdvanceBlockedReason(state, mode) === null;

export const getNextCloudGameEventMs = (
  state: GameState,
  maximumMs: number,
) => {
  const normalized = normalizeCloudForGameState(state);
  return getNextNormalizedCloudGameEventMs(normalized, maximumMs);
};

/** Internal event selector for a canonicalized game state. */
export const getNextNormalizedCloudGameEventMs = (
  state: GameState,
  maximumMs: number,
) => {
  const horizon = Math.max(
      0,
      Math.min(
        MAX_SAFE_TIME_MS,
        Number.isFinite(maximumMs) ? maximumMs : 0,
      ),
    );
  return getNextCloudEventMs(state.cloud, horizon);
};

export const getNextNormalizedRunnableCloudGameEventMs = (
  state: GameState,
  maximumMs: number,
  mode: AdvanceMode = "foreground",
) =>
  !hasActiveCloudWork(state)
    ? Math.max(0, Number.isFinite(maximumMs) ? maximumMs : 0)
    : getNormalizedCloudAdvanceBlockedReason(state, mode) === null
      ? getNextNormalizedCloudGameEventMs(state, maximumMs)
      : Math.max(0, Number.isFinite(maximumMs) ? maximumMs : 0);

export const getNextRunnableCloudGameEventMs = (
  state: GameState,
  maximumMs: number,
  mode: AdvanceMode = "foreground",
) => {
  if (!hasActiveCloudWork(state)) {
    return Math.max(0, Number.isFinite(maximumMs) ? maximumMs : 0);
  }
  const normalized = normalizeCloudForGameState(state);
  return getNextNormalizedRunnableCloudGameEventMs(
    normalized,
    maximumMs,
    mode,
  );
};

const exactOperatingCost = (rate: Amount, elapsedMs: number) =>
  amountDivide(amountMultiply(rate, amount(elapsedMs)), 1_000);

const applyCloudInterval = (
  state: GameState,
  elapsedMs: number,
  productiveAllowed: boolean,
) => {
  const result = advanceCloud(state.cloud, elapsedMs, { productiveAllowed });
  return addExactRewards({ ...state, cloud: result.state }, result.rewards);
};

/**
 * Advances the saved Cloud runtime. Shared cluster facilities passed in
 * `alreadyBilledFacilityIds` are never charged twice for the same slice.
 */
export const advanceNormalizedCloudForGameState = (
  input: GameState,
  elapsedMsInput: number,
  mode: AdvanceMode = "foreground",
  alreadyBilledFacilityIds: Iterable<string> = [],
): GameState => {
  let state = input;
  const elapsedMs = nonNegativeElapsed(elapsedMsInput);
  if (elapsedMs <= 0) return state;
  const productiveAllowed =
    getCloudStructuralBlockedReasonFromNormalizedState(state, mode) === null;
  if (!productiveAllowed || !hasActiveCloudWork(state)) {
    return applyCloudInterval(state, elapsedMs, productiveAllowed);
  }

  const rate = getNormalizedCloudOperatingCostPerSecond(
    state,
    mode,
    alreadyBilledFacilityIds,
  );
  const wholeElapsedMs = Math.floor(
    state.cloud.advanceRemainderMs + elapsedMs,
  );
  const requestedCost = exactOperatingCost(rate, wholeElapsedMs);
  if (
    amountCompare(rate, 0) <= 0 ||
    amountCompare(state.exactResources.credits, requestedCost) >= 0
  ) {
    if (amountCompare(requestedCost, 0) > 0) {
      state = spendExact(state, [exactCost("credits", requestedCost)]);
    }
    return applyCloudInterval(state, elapsedMs, true);
  }

  const runwayMs = amountMultiply(
    amountDivide(state.exactResources.credits, rate),
    1_000,
  );
  let affordableWholeMs = Math.min(
    wholeElapsedMs,
    Math.max(0, Math.floor(amountToSafeNumber(runwayMs))),
  );
  while (
    affordableWholeMs > 0 &&
    amountCompare(
      exactOperatingCost(rate, affordableWholeMs),
      state.exactResources.credits,
    ) > 0
  ) {
    affordableWholeMs -= 1;
  }
  if (affordableWholeMs <= 0) {
    return applyCloudInterval(state, elapsedMs, false);
  }

  const billedCost = amountMin(
    state.exactResources.credits,
    exactOperatingCost(rate, affordableWholeMs),
  );
  state = spendExact(state, [exactCost("credits", billedCost)]);
  const priorRemainderMs = state.cloud.advanceRemainderMs;
  const productiveInputMs = Math.min(
    elapsedMs,
    Math.max(0, affordableWholeMs - priorRemainderMs),
  );
  state = {
    ...state,
    cloud: { ...state.cloud, advanceRemainderMs: 0 },
  };
  state = applyCloudInterval(state, affordableWholeMs, true);
  const pausedInputMs = Math.max(0, elapsedMs - productiveInputMs);
  return pausedInputMs > 0
    ? applyCloudInterval(state, pausedInputMs, false)
    : state;
};

export const advanceCloudForGameState = (
  input: GameState,
  elapsedMsInput: number,
  mode: AdvanceMode = "foreground",
  alreadyBilledFacilityIds: Iterable<string> = [],
): GameState =>
  advanceNormalizedCloudForGameState(
    normalizeCloudForGameState(input),
    elapsedMsInput,
    mode,
    alreadyBilledFacilityIds,
  );
