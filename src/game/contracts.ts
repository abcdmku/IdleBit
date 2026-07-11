import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountCompare,
  amountDivide,
  amountMax,
  amountMin,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  exactResourceBag,
  type Amount,
  type ExactResourceBag,
} from "./amount";
import { getAutomationBufferDefinition } from "./automation";
import { getCampaignChapterIndex, updateCampaignProgress } from "./campaign";
import { addExactRewards } from "./economy";
import { getPowerCostPerSecondExact, getPsuStress } from "./math";
import {
  createHardwareWorkRecipe,
  getHardwareWorkDurationMs,
  getHardwareWorkTotal,
  summarizeHardwareWorkMix,
  type HardwareWorkRecipe,
  type HardwareWorkRates,
  type HardwareWorkResourceId,
} from "./hardwareWork";
import { getSystemHardwareWorkRates } from "./systemHardwareWork";
import { nextRngInt } from "./rng";
import { materializeSystem } from "./systems";
import {
  createWorkValueMultiplier,
  getWorkValueCredits,
  type WorkValueMultiplier,
} from "./workValue";
import type {
  ActiveContractState,
  CampaignChapterId,
  ContractKind,
  ContractMarketState,
  ContractOfferState,
  ContractTemplateId,
  GameState,
  VisibleContract,
} from "./types";

export interface ContractTemplateDefinition {
  id: ContractTemplateId;
  kind: ContractKind;
  name: string;
  description: string;
  requiredChapter: CampaignChapterId;
  /** Legacy 1-work-unit/second projection, retained only for save migration. */
  baseWorkMs: number;
  /** Exact payload at the 1-bit/second reference path. */
  baseWorkBits: Amount;
  baseWorkRecipe: HardwareWorkRecipe;
  /** Authored discovery reward; repeatable Credits derive only from work. */
  baseDataReward: Amount;
}

const authoredPlan = (
  totalSeconds: number,
  cacheShare: number,
  ramShare: number,
): HardwareWorkRecipe => {
  const cache = totalSeconds * cacheShare;
  const ram = totalSeconds * ramShare;
  const cpu = totalSeconds - cache - ram;
  return { stages: [
    ...(cache > 0 ? [{ id: "cache", resource: "cache" as const, work: amount(cache) }] : []),
    ...(ram > 0 ? [{ id: "ram", resource: "ram" as const, work: amount(ram) }] : []),
    ...(cpu > 0 ? [{ id: "compute", resource: "compute" as const, work: amount(cpu) }] : []),
  ] };
};

export const contractTemplateDefinitions: readonly ContractTemplateDefinition[] = [
  {
    id: "ledgerAudit",
    kind: "sustained",
    name: "Ledger Audit",
    description: "Run a steady integrity audit over queued work.",
    requiredChapter: "bootstrapNode",
    baseWorkMs: 30 * 60_000,
    baseWorkBits: amount(30 * 60),
    baseWorkRecipe: authoredPlan(30 * 60, 0.7, 0),
    baseDataReward: amount(4),
  },
  {
    id: "queueRecovery",
    kind: "burst",
    name: "Queue Recovery",
    description: "Clear a short urgent scheduler backlog.",
    requiredChapter: "bootstrapNode",
    baseWorkMs: 8 * 60_000,
    baseWorkBits: amount(8 * 60),
    baseWorkRecipe: authoredPlan(8 * 60, 0.7, 0),
    baseDataReward: amount(3),
  },
  {
    id: "compileBatch",
    kind: "sustained",
    name: "Compile Batch",
    description: "Process a maintained build queue for an open toolchain.",
    requiredChapter: "coherentMachine",
    baseWorkMs: 2 * 60 * 60_000,
    baseWorkBits: amount(2 * 60 * 60),
    baseWorkRecipe: authoredPlan(2 * 60 * 60, 0.15, 0.25),
    baseDataReward: amount(12),
  },
  {
    id: "renderBurst",
    kind: "burst",
    name: "Render Burst",
    description: "Finish an urgent tile batch before the offer rotates.",
    requiredChapter: "workshopFleet",
    baseWorkMs: 20 * 60_000,
    baseWorkBits: amount(20 * 60),
    baseWorkRecipe: authoredPlan(20 * 60, 0.1, 0.15),
    baseDataReward: amount(18),
  },
  {
    id: "gridForecast",
    kind: "sustained",
    name: "Grid Forecast",
    description: "Maintain a rolling civic demand forecast.",
    requiredChapter: "rackAndFacility",
    baseWorkMs: 8 * 60 * 60_000,
    baseWorkBits: amount(8 * 60 * 60),
    baseWorkRecipe: authoredPlan(8 * 60 * 60, 0.1, 0.5),
    baseDataReward: amount(500),
  },
  {
    id: "replicaSurvey",
    kind: "sustained",
    name: "Replica Survey",
    description: "Sample replica health across a service window.",
    requiredChapter: "resilientCloud",
    baseWorkMs: 30 * 60_000,
    baseWorkBits: amount(30 * 60),
    baseWorkRecipe: authoredPlan(30 * 60, 0.4, 0.4),
    baseDataReward: amount(2000),
  },
] as const;

const templateById = new Map(contractTemplateDefinitions.map((template) => [template.id, template]));

/** Maximum simultaneous managed contracts supported by the public scheduler. */
export const MAX_ACTIVE_CONTRACTS = 3;
export const MAX_CONTRACT_MARKET_OFFERS = 3;
/** Managed offers pay 1 Credit/work plus this explicit service premium. */
export const CONTRACT_MIN_OFFER_PREMIUM_BPS = 15_000;
export const CONTRACT_MAX_OFFER_PREMIUM_BPS = 19_000;
export const CONTRACT_OFFER_PREMIUM_ID = "managed-contract-offer-premium";

export const createContractMarketState = (): ContractMarketState => ({
  elapsedMs: 0,
  offers: [],
  active: [],
  completedContractIds: [],
  completedTemplateIds: [],
  completedRewards: {},
  declinedContractIds: [],
  nextContractId: 1,
  refreshCount: 0,
  nextRefreshAtMs: 0,
});

const isTemplateId = (value: unknown): value is ContractTemplateId =>
  typeof value === "string" && templateById.has(value as ContractTemplateId);

const normalizeRewards = (value: Partial<ExactResourceBag> | undefined) => {
  try {
    return exactResourceBag(
      amountMax(value?.credits ?? 0, 0),
      amountMax(value?.data ?? 0, 0),
    );
  } catch {
    return exactResourceBag();
  }
};

const legacyOfferWorkBits = (
  template: ContractTemplateDefinition,
  workRequiredMs: number,
) => amountDivide(
  amountMultiply(template.baseWorkBits, workRequiredMs),
  template.baseWorkMs,
);

const getContractTemplateDefinition = (templateId: ContractTemplateId) =>
  templateById.get(templateId)!;

const scaleWorkRecipe = (
  recipe: HardwareWorkRecipe,
  numerator: Amount | number,
  denominator: Amount | number = 1,
): HardwareWorkRecipe => createHardwareWorkRecipe(
  recipe.stages.map((stage) => ({
    id: stage.id,
    resource: stage.resource,
    work: amountDivide(amountMultiply(stage.work, numerator), denominator),
  })),
);

const contractWorkResources = new Set<HardwareWorkResourceId>([
  "cache",
  "ram",
  "compute",
  "storageRead",
  "storageWrite",
  "networkIngress",
  "networkEgress",
]);

const normalizeSavedWorkRecipe = (
  value: HardwareWorkRecipe | undefined,
  fallback: HardwareWorkRecipe,
) => {
  if (!value || !Array.isArray(value.stages)) return fallback;
  try {
    const stages = value.stages.flatMap((stage, index) => {
      if (!stage || !contractWorkResources.has(stage.resource)) return [];
      return [{
        id: typeof stage.id === "string" && stage.id.trim()
          ? stage.id
          : `stage-${index + 1}`,
        resource: stage.resource,
        work: stage.work,
      }];
    });
    return stages.length > 0 ? createHardwareWorkRecipe(stages) : fallback;
  } catch {
    return fallback;
  }
};

const getContractWorkRecipe = (
  contract: Pick<ContractOfferState, "templateId" | "workRequiredMs" | "workRecipe">,
): HardwareWorkRecipe => contract.workRecipe ?? scaleWorkRecipe(
  getContractTemplateDefinition(contract.templateId).baseWorkRecipe,
  contract.workRequiredMs,
  getContractTemplateDefinition(contract.templateId).baseWorkMs,
);

const getRecipeTotalWork = getHardwareWorkTotal;

const cursorFromFraction = (
  recipe: HardwareWorkRecipe,
  fraction: Amount,
) => {
  let target = amountMultiply(getRecipeTotalWork(recipe), amountMin(1, amountMax(fraction, 0)));
  for (let index = 0; index < recipe.stages.length; index += 1) {
    const stage = recipe.stages[index]!;
    if (amountCompare(target, stage.work) < 0) {
      return { workStageIndex: index, workStageCompleted: target };
    }
    target = amountMax(amountSubtract(target, stage.work), 0);
  }
  return { workStageIndex: recipe.stages.length, workStageCompleted: ZERO_AMOUNT };
};

const getContractWorkCursor = (
  contract: Pick<
    ActiveContractState,
    | "templateId"
    | "workRequiredMs"
    | "workCompletedMs"
    | "workRecipe"
    | "workCompletedUnits"
    | "workStageIndex"
    | "workStageCompleted"
  >,
) => {
  const recipe = getContractWorkRecipe(contract);
  if (contract.workStageIndex !== undefined) {
    const workStageIndex = Math.max(
      0,
      Math.min(recipe.stages.length, Math.trunc(contract.workStageIndex)),
    );
    const stage = recipe.stages[workStageIndex];
    return {
      workStageIndex,
      workStageCompleted: stage
        ? amountMin(stage.work, amountMax(contract.workStageCompleted ?? 0, 0))
        : ZERO_AMOUNT,
    };
  }
  return cursorFromFraction(
    recipe,
    amountMax(
      contract.workCompletedUnits ?? 0,
      amountDivide(contract.workCompletedMs, contract.workRequiredMs),
    ),
  );
};

const getContractCompletedUnits = (
  contract: Pick<
    ActiveContractState,
    | "templateId"
    | "workRequiredMs"
    | "workCompletedMs"
    | "workRecipe"
    | "workCompletedUnits"
    | "workStageIndex"
    | "workStageCompleted"
  >,
) => {
  const recipe = getContractWorkRecipe(contract);
  const cursor = getContractWorkCursor(contract);
  const completed = recipe.stages
    .slice(0, cursor.workStageIndex)
    .reduce((total, stage) => amountAdd(total, stage.work), ZERO_AMOUNT);
  const total = getRecipeTotalWork(recipe);
  return amountCompare(total, 0) <= 0
    ? amount(1)
    : amountMin(
        1,
        amountDivide(amountAdd(completed, cursor.workStageCompleted), total),
      );
};

const getRequiredWorkBits = (
  contract: Pick<ContractOfferState, "templateId" | "workRequiredMs" | "workRequiredBits">,
) => contract.workRequiredBits ?? legacyOfferWorkBits(
  getContractTemplateDefinition(contract.templateId),
  contract.workRequiredMs,
);

const getCompletedWorkBits = (
  contract: Pick<
    ActiveContractState,
    "templateId" | "workRequiredMs" | "workRequiredBits" | "workCompletedMs" | "workCompletedBits"
  >,
) => amountMax(
  contract.workCompletedBits ?? 0,
  amountDivide(
    amountMultiply(getRequiredWorkBits(contract), contract.workCompletedMs),
    contract.workRequiredMs,
  ),
);

const deriveLegacyOfferPremium = (
  paidWorkUnits: Amount,
  legacyRewards: ExactResourceBag,
) => createWorkValueMultiplier(
  CONTRACT_OFFER_PREMIUM_ID,
  amountCompare(paidWorkUnits, 0) > 0
    ? amountDivide(
        amountMultiply(legacyRewards.credits, 10_000),
        paidWorkUnits,
      )
    : 0,
);

const normalizeOfferPremium = (
  value: Partial<ContractOfferState>,
  paidWorkUnits: Amount,
  legacyRewards: ExactResourceBag,
): WorkValueMultiplier => {
  try {
    if (value.workValueMultiplier) {
      return createWorkValueMultiplier(
        CONTRACT_OFFER_PREMIUM_ID,
        value.workValueMultiplier.basisPoints,
      );
    }
  } catch {
    // Continue through the legacy migration paths.
  }
  if (Number.isFinite(value.workValueMultiplierBps)) {
    return createWorkValueMultiplier(
      CONTRACT_OFFER_PREMIUM_ID,
      Math.max(0, Math.trunc(value.workValueMultiplierBps!)),
    );
  }
  return deriveLegacyOfferPremium(paidWorkUnits, legacyRewards);
};

const getContractSettlement = (
  contract: Pick<
    ContractOfferState,
    | "templateId"
    | "workRequiredMs"
    | "workRecipe"
    | "workValueMultiplier"
    | "workValueMultiplierBps"
    | "rewards"
  >,
) => {
  const workRecipe = getContractWorkRecipe(contract);
  const paidWorkUnits = getRecipeTotalWork(workRecipe);
  const workValueMultiplier = normalizeOfferPremium(
    contract,
    paidWorkUnits,
    contract.rewards,
  );
  return {
    workRecipe,
    paidWorkUnits,
    workValueMultiplier,
    rewards: exactResourceBag(
      getWorkValueCredits(paidWorkUnits, workValueMultiplier),
      contract.rewards.data,
    ),
  };
};

const normalizeOffer = (value: Partial<ContractOfferState>): ContractOfferState | null => {
  if (!value.id || !isTemplateId(value.templateId)) return null;
  const template = templateById.get(value.templateId)!;
  const workRequiredMs = Math.max(1, value.workRequiredMs ?? template.baseWorkMs);
  const workRequiredBits = amountMax(
    value.workRequiredBits ?? legacyOfferWorkBits(template, workRequiredMs),
    1,
  );
  const fallbackRecipe = scaleWorkRecipe(
    template.baseWorkRecipe,
    workRequiredMs,
    template.baseWorkMs,
  );
  const workRecipe = normalizeSavedWorkRecipe(value.workRecipe, fallbackRecipe);
  const paidWorkUnits = getRecipeTotalWork(workRecipe);
  const legacyRewards = normalizeRewards(value.rewards);
  const workValueMultiplier = normalizeOfferPremium(
    value,
    paidWorkUnits,
    legacyRewards,
  );
  const rewards = exactResourceBag(
    getWorkValueCredits(paidWorkUnits, workValueMultiplier),
    legacyRewards.data,
  );
  return {
    id: value.id,
    templateId: value.templateId,
    kind: value.kind === "burst" ? "burst" : template.kind,
    name: value.name ?? template.name,
    description: value.description ?? template.description,
    systemId: Math.max(1, Math.trunc(value.systemId ?? 1)),
    workRequiredMs,
    workRequiredBits,
    workRecipe,
    paidWorkUnits,
    workValueMultiplier,
    expiresAtMs: Math.max(0, value.expiresAtMs ?? 0),
    rewards,
    novel: value.novel === true,
  };
};

export const normalizeContractMarketState = (
  value: Partial<ContractMarketState> | null | undefined,
): ContractMarketState => {
  const fresh = createContractMarketState();
  const normalizedOffers = (value?.offers ?? [])
    .map((offer) => normalizeOffer(offer))
    .filter((offer): offer is ContractOfferState => offer !== null);
  const normalizedActive: ActiveContractState[] = (value?.active ?? [])
    .flatMap((contract): ActiveContractState[] => {
      const offer = normalizeOffer(contract);
      if (!offer) return [];
      const workRequiredBits = getRequiredWorkBits(offer);
      const completedFraction = amountDivide(
        Math.max(0, contract.workCompletedMs ?? 0),
        offer.workRequiredMs,
      );
      const migratedCursor = cursorFromFraction(
        getContractWorkRecipe(offer),
        amountMin(1, amountMax(contract.workCompletedUnits ?? completedFraction, 0)),
      );
      return [{
            ...offer,
            workRequiredBits,
            acceptedAtMs: Math.max(0, contract.acceptedAtMs ?? 0),
            workCompletedMs: Math.min(
              offer.workRequiredMs,
              Math.max(0, contract.workCompletedMs ?? 0),
            ),
            workCompletedBits: amountMin(
              workRequiredBits,
              amountMax(
                contract.workCompletedBits ?? amountDivide(
                  amountMultiply(
                    workRequiredBits,
                    Math.max(0, contract.workCompletedMs ?? 0),
                  ),
                  offer.workRequiredMs,
                ),
                0,
              ),
            ),
            workCompletedUnits: amountMin(
              1,
              amountMax(contract.workCompletedUnits ?? completedFraction, 0),
            ),
            workStageIndex:
              contract.workStageIndex ?? migratedCursor.workStageIndex,
            workStageCompleted:
              contract.workStageCompleted ?? migratedCursor.workStageCompleted,
          }];
    });
  const active: ActiveContractState[] = [];
  const activeTemplateIds = new Set<ContractTemplateId>();
  const activeContractIds = new Set<string>();
  const activeSystemIds = new Set<number>();
  for (const contract of normalizedActive) {
    if (
      active.length >= MAX_ACTIVE_CONTRACTS ||
      activeTemplateIds.has(contract.templateId) ||
      activeContractIds.has(contract.id) ||
      activeSystemIds.has(contract.systemId)
    ) {
      continue;
    }
    active.push(contract);
    activeTemplateIds.add(contract.templateId);
    activeContractIds.add(contract.id);
    activeSystemIds.add(contract.systemId);
  }
  const offers: ContractOfferState[] = [];
  const offerTemplateIds = new Set<ContractTemplateId>();
  const offerContractIds = new Set<string>();
  for (const offer of normalizedOffers) {
    if (
      offers.length >= MAX_CONTRACT_MARKET_OFFERS ||
      activeTemplateIds.has(offer.templateId) ||
      activeContractIds.has(offer.id) ||
      offerTemplateIds.has(offer.templateId) ||
      offerContractIds.has(offer.id)
    ) {
      continue;
    }
    offers.push(offer);
    offerTemplateIds.add(offer.templateId);
    offerContractIds.add(offer.id);
  }
  return {
    elapsedMs: Math.max(0, value?.elapsedMs ?? 0),
    offers,
    active,
    completedContractIds: Array.from(new Set(value?.completedContractIds ?? [])),
    completedTemplateIds: Array.from(
      new Set((value?.completedTemplateIds ?? []).filter(isTemplateId)),
    ),
    completedRewards: Object.fromEntries(
      Object.entries(value?.completedRewards ?? {}).map(([id, rewards]) => [
        id,
        normalizeRewards(rewards),
      ]),
    ),
    declinedContractIds: Array.from(new Set(value?.declinedContractIds ?? [])),
    nextContractId: Math.max(1, Math.trunc(value?.nextContractId ?? fresh.nextContractId)),
    refreshCount: Math.max(0, Math.trunc(value?.refreshCount ?? 0)),
    nextRefreshAtMs: Math.max(0, value?.nextRefreshAtMs ?? 0),
  };
};

/**
 * Load-time cleanup. Expired offers — and any offer saved before CRON
 * automation existed — must not hold the Market surface open; active
 * contracts are untouched and settle regardless of visibility.
 */
export const pruneStaleContractOffers = (state: GameState): GameState => {
  const offers = state.contracts.offers.filter(
    (offer) => state.flags.cron && offer.expiresAtMs > state.contracts.elapsedMs,
  );
  if (offers.length === state.contracts.offers.length) return state;
  return { ...state, contracts: { ...state.contracts, offers } };
};

const getEligibleTemplates = (state: GameState) => {
  // Managed contracts model unattended client workloads; the market opens
  // only once CRON automation exists to run them.
  if (!state.flags.cron) return [];
  const chapterIndex = getCampaignChapterIndex(state.campaign.currentChapterId);
  return contractTemplateDefinitions.filter(
    (template) => getCampaignChapterIndex(template.requiredChapter) <= chapterIndex,
  );
};

/** Exact aggregate compute path reserved by a managed contract. */
export const getContractSystemWorkRate = (
  state: GameState,
  systemId: number,
): Amount => getSystemHardwareWorkRates(state, systemId).compute;

export const getContractRemainingMs = (
  state: GameState,
  contract: Pick<
    ActiveContractState,
    | "templateId"
    | "systemId"
    | "workRequiredMs"
    | "workCompletedMs"
    | "workRequiredBits"
    | "workCompletedBits"
    | "workRecipe"
    | "workCompletedUnits"
  >,
) => {
  const recipe = getContractWorkRecipe(contract);
  const cursor = getContractWorkCursor(contract);
  const rates = getSystemHardwareWorkRates(state, contract.systemId);
  let milliseconds = ZERO_AMOUNT;
  for (let index = cursor.workStageIndex; index < recipe.stages.length; index += 1) {
    const stage = recipe.stages[index]!;
    const remaining = index === cursor.workStageIndex
      ? amountMax(amountSubtract(stage.work, cursor.workStageCompleted), 0)
      : stage.work;
    if (amountCompare(remaining, 0) <= 0) continue;
    const rate = rates[stage.resource];
    if (amountCompare(rate, 0) <= 0) return Number.POSITIVE_INFINITY;
    milliseconds = amountAdd(
      milliseconds,
      amountDivide(amountMultiply(remaining, 1_000), rate),
    );
  }
  return Math.ceil(amountToSafeNumber(milliseconds));
};

const advanceContractCursor = (
  recipe: HardwareWorkRecipe,
  rates: HardwareWorkRates,
  initial: { workStageIndex: number; workStageCompleted: Amount },
  elapsedMs: number,
) => {
  let workStageIndex = initial.workStageIndex;
  let workStageCompleted = initial.workStageCompleted;
  let seconds = amountDivide(elapsedMs, 1_000);
  while (
    workStageIndex < recipe.stages.length &&
    amountCompare(seconds, 0) > 0
  ) {
    const stage = recipe.stages[workStageIndex]!;
    const rate = rates[stage.resource];
    if (amountCompare(rate, 0) <= 0) break;
    const remaining = amountMax(
      amountSubtract(stage.work, workStageCompleted),
      0,
    );
    const requiredSeconds = amountDivide(remaining, rate);
    const stepSeconds = amountMin(seconds, requiredSeconds);
    workStageCompleted = amountMin(
      stage.work,
      amountAdd(workStageCompleted, amountMultiply(rate, stepSeconds)),
    );
    seconds = amountMax(amountSubtract(seconds, stepSeconds), 0);
    if (amountCompare(workStageCompleted, stage.work) >= 0) {
      workStageIndex += 1;
      workStageCompleted = ZERO_AMOUNT;
    }
  }
  return { workStageIndex, workStageCompleted };
};

export const refreshContractMarket = (state: GameState): GameState => {
  if (!state.flags.cron) return state;
  if (state.contracts.elapsedMs < state.contracts.nextRefreshAtMs) {
    return state;
  }
  const reservedTemplateIds = new Set(
    state.contracts.active.map((contract) => contract.templateId),
  );
  const eligible = getEligibleTemplates(state).filter(
    (template) => !reservedTemplateIds.has(template.id),
  );
  if (eligible.length === 0) {
    return {
      ...state,
      contracts: {
        ...state.contracts,
        offers: [],
        refreshCount: state.contracts.refreshCount + 1,
        nextRefreshAtMs: state.contracts.elapsedMs + 15 * 60_000,
      },
    };
  }
  let rng = state.rng;
  let nextContractId = state.contracts.nextContractId;
  const pool = [...eligible];
  const offers: ContractOfferState[] = [];
  const offerCount = Math.min(MAX_CONTRACT_MARKET_OFFERS, pool.length);
  for (let index = 0; index < offerCount; index += 1) {
    const templateRoll = nextRngInt(rng, 0, pool.length);
    rng = templateRoll.state;
    const template = pool.splice(templateRoll.value, 1)[0]!;
    const valueRoll = nextRngInt(rng, 85, 126);
    rng = valueRoll.state;
    const durationRoll = nextRngInt(rng, 85, 116);
    rng = durationRoll.state;
    const novel =
      !state.contracts.completedTemplateIds.includes(template.id) &&
      !reservedTemplateIds.has(template.id);
    const workRequiredBits = amountDivide(
      amountMultiply(template.baseWorkBits, durationRoll.value),
      100,
    );
    const workRecipe = scaleWorkRecipe(
      template.baseWorkRecipe,
      durationRoll.value,
      100,
    );
    const durationMs = getHardwareWorkDurationMs(
      workRecipe,
      getSystemHardwareWorkRates(state, state.selectedSystemId),
    );
    const workRequiredMs = durationMs !== null
      ? Math.max(
          1,
          Math.ceil(amountToSafeNumber(durationMs)),
        )
      : template.baseWorkMs;
    // Gross payout follows the frozen authored payload. Hardware changes only
    // alter delivery time and operating cost, never the paid work volume.
    const offerPremiumBps =
      CONTRACT_MIN_OFFER_PREMIUM_BPS +
      Math.round(
        ((valueRoll.value - 85) *
          (CONTRACT_MAX_OFFER_PREMIUM_BPS -
            CONTRACT_MIN_OFFER_PREMIUM_BPS)) /
          40,
      );
    const paidWorkUnits = getRecipeTotalWork(workRecipe);
    const workValueMultiplier = createWorkValueMultiplier(
      CONTRACT_OFFER_PREMIUM_ID,
      offerPremiumBps,
    );
    const targetCredits = getWorkValueCredits(
      paidWorkUnits,
      workValueMultiplier,
    );
    offers.push({
      id: `contract-${nextContractId}`,
      templateId: template.id,
      kind: template.kind,
      name: template.name,
      description: template.description,
      systemId: state.selectedSystemId,
      workRequiredMs,
      workRequiredBits,
      workRecipe,
      paidWorkUnits,
      workValueMultiplier,
      expiresAtMs:
        state.contracts.elapsedMs +
        (template.kind === "burst" ? 30 * 60_000 : 6 * 60 * 60_000),
      rewards: exactResourceBag(
        targetCredits,
        novel
          ? amountMultiply(template.baseDataReward, amountDivide(valueRoll.value, 100))
          : ZERO_AMOUNT,
      ),
      novel,
    });
    nextContractId += 1;
  }
  return {
    ...state,
    rng,
    contracts: {
      ...state.contracts,
      offers,
      nextContractId,
      refreshCount: state.contracts.refreshCount + 1,
      nextRefreshAtMs: state.contracts.elapsedMs + 15 * 60_000,
    },
  };
};

const getContractSystemBlockedReason = (
  state: GameState,
  systemId: number,
) => {
  if (!state.systems.some((system) => system.id === systemId)) {
    return "Assigned system is missing.";
  }
  const local = materializeSystem(state, systemId);
  if (local.power.state !== "on") {
    return `${local.systems.find((system) => system.id === systemId)?.name ?? `System ${systemId}`} is ${local.power.state}.`;
  }
  if (getPsuStress(local) > 1) {
    return `${local.systems.find((system) => system.id === systemId)?.name ?? `System ${systemId}`} exceeds its safe PSU rating.`;
  }
  return null;
};

export const acceptContract = (state: GameState, contractId: string): GameState => {
  const rawOffer = state.contracts.offers.find((contract) => contract.id === contractId);
  const offer = rawOffer ? normalizeOffer(rawOffer) : null;
  if (
    !offer ||
    offer.expiresAtMs <= state.contracts.elapsedMs ||
    state.contracts.active.length >= MAX_ACTIVE_CONTRACTS ||
    state.contracts.active.some(
      (contract) => contract.systemId === offer.systemId,
    ) ||
    state.contracts.active.some(
      (contract) => contract.templateId === offer.templateId,
    ) ||
    getContractSystemBlockedReason(state, offer.systemId) !== null
  ) {
    return state;
  }
  return {
    ...state,
    contracts: {
      ...state.contracts,
      offers: state.contracts.offers.filter((contract) => contract.id !== contractId),
      active: [
        ...state.contracts.active,
        {
          ...offer,
          acceptedAtMs: state.contracts.elapsedMs,
          workCompletedMs: 0,
          workCompletedBits: ZERO_AMOUNT,
          workCompletedUnits: ZERO_AMOUNT,
          workStageIndex: 0,
          workStageCompleted: ZERO_AMOUNT,
        },
      ],
    },
  };
};

export const declineContract = (state: GameState, contractId: string): GameState => {
  if (!state.contracts.offers.some((contract) => contract.id === contractId)) return state;
  return {
    ...state,
    contracts: {
      ...state.contracts,
      offers: state.contracts.offers.filter((contract) => contract.id !== contractId),
      declinedContractIds: Array.from(
        new Set([...state.contracts.declinedContractIds, contractId]),
      ),
    },
  };
};

export const completeContract = (state: GameState, contractId: string): GameState => {
  const contract = state.contracts.active.find((item) => item.id === contractId);
  if (
    !contract ||
    amountCompare(getContractCompletedUnits(contract), 1) < 0
  ) return state;
  const settlement = getContractSettlement(contract);
  const rewarded = addExactRewards(state, settlement.rewards);
  return updateCampaignProgress({
    ...rewarded,
    contracts: {
      ...rewarded.contracts,
      active: rewarded.contracts.active.filter((item) => item.id !== contractId),
      completedContractIds: Array.from(
        new Set([...rewarded.contracts.completedContractIds, contractId]),
      ),
      completedTemplateIds: Array.from(
        new Set([...rewarded.contracts.completedTemplateIds, contract.templateId]),
      ),
      completedRewards: {
        ...rewarded.contracts.completedRewards,
        [contractId]: settlement.rewards,
      },
    },
  });
};

export const advanceContracts = (
  state: GameState,
  elapsedMs: number,
  progressActive:
    | boolean
    | ((contract: ActiveContractState) => boolean) = true,
): GameState => {
  const elapsed = Math.max(0, elapsedMs);
  let working: GameState = {
    ...state,
    contracts: {
      ...state.contracts,
      elapsedMs: state.contracts.elapsedMs + elapsed,
      offers: state.contracts.offers.filter(
        (offer) => offer.expiresAtMs > state.contracts.elapsedMs + elapsed,
      ),
      active: state.contracts.active.map((contract) => ({
        ...contract,
        ...(() => {
          const workRequiredBits = getRequiredWorkBits(contract);
          const productive = typeof progressActive === "function"
            ? progressActive(contract)
            : progressActive;
          const workRecipe = getContractWorkRecipe(contract);
          const cursor = productive
            ? advanceContractCursor(
                workRecipe,
                getSystemHardwareWorkRates(state, contract.systemId),
                getContractWorkCursor(contract),
                elapsed,
              )
            : getContractWorkCursor(contract);
          const withCursor = {
            ...contract,
            workRecipe,
            ...cursor,
          };
          const workCompletedUnits = getContractCompletedUnits(withCursor);
          const workCompletedBits = amountMultiply(
            workRequiredBits,
            workCompletedUnits,
          );
          const workCompletedMs = Math.min(
            contract.workRequiredMs,
            Math.floor(amountToSafeNumber(amountMultiply(
              workCompletedUnits,
              contract.workRequiredMs,
            ))),
          );
          return {
            workRequiredBits,
            workRecipe,
            workCompletedBits,
            workCompletedUnits,
            ...cursor,
            workCompletedMs,
          };
        })(),
      })),
    },
  };
  for (const contract of [...working.contracts.active]) {
    if (amountCompare(getContractCompletedUnits(contract), 1) >= 0) {
      working = completeContract(working, contract.id);
    }
  }
  return working;
};

export const hasActiveContracts = (state: GameState) => state.contracts.active.length > 0;

export const getActiveContractSystemIds = (state: GameState) =>
  state.contracts.active.map((contract) => contract.systemId);

export const getNextContractEventMs = (state: GameState) => {
  const candidates = [
    ...state.contracts.active.map(
      (contract) => getContractRemainingMs(state, contract),
    ),
    ...state.contracts.offers.map(
      (offer) => offer.expiresAtMs - state.contracts.elapsedMs,
    ),
  ].filter((value) => value > 0);
  return candidates.length > 0 ? Math.min(...candidates) : Number.POSITIVE_INFINITY;
};

const asVisibleContract = (
  state: GameState,
  contract: ContractOfferState | ActiveContractState,
  accepted: boolean,
): VisibleContract => {
  const settlement = getContractSettlement(contract);
  const {
    workRecipe,
    paidWorkUnits,
    workValueMultiplier,
    rewards,
  } = settlement;
  const workCompletedMs = accepted
    ? (contract as ActiveContractState).workCompletedMs
    : 0;
  const activeContract = accepted ? contract as ActiveContractState : null;
  const remainingMs = activeContract
    ? getContractRemainingMs(state, activeContract)
    : (() => {
        const duration = getHardwareWorkDurationMs(
          workRecipe,
          getSystemHardwareWorkRates(state, contract.systemId),
        );
        return duration === null
          ? Number.POSITIVE_INFINITY
          : Math.ceil(amountToSafeNumber(duration));
      })();
  const costDurationMs = Number.isFinite(remainingMs)
    ? remainingMs
    : contract.workRequiredMs;
  const totalProjectedMs = activeContract
    ? costDurationMs + workCompletedMs
    : costDurationMs;
  const hours = totalProjectedMs / (60 * 60_000);
  const local = state.systems.some((system) => system.id === contract.systemId)
    ? materializeSystem(state, contract.systemId)
    : null;
  const operatingCostCredits = local
    ? amountDivide(
        amountMultiply(getPowerCostPerSecondExact(local), costDurationMs),
        1_000,
      )
    : ZERO_AMOUNT;
  const creditRunwayCovered =
    amountCompare(state.exactResources.credits, operatingCostCredits) >= 0;
  const bufferCovered =
    Number.isFinite(remainingMs) && remainingMs <=
    getAutomationBufferDefinition(state.automationBuffer.ownedLevelId).maxOfflineMs;
  const systemBlockedReason = getContractSystemBlockedReason(
    state,
    contract.systemId,
  );
  const acceptanceBlockedReason = accepted
    ? null
    : contract.expiresAtMs <= state.contracts.elapsedMs
      ? `${contract.name} has expired.`
      : state.contracts.active.length >= MAX_ACTIVE_CONTRACTS
        ? `Managed contract capacity is full (${MAX_ACTIVE_CONTRACTS}).`
        : state.contracts.active.some(
              (active) => active.systemId === contract.systemId,
            )
          ? `System ${contract.systemId} already has an active managed contract.`
        : state.contracts.active.some(
            (active) => active.templateId === contract.templateId,
          )
        ? `${contract.name} is already reserved by an active contract.`
        : systemBlockedReason;
  return {
    id: contract.id,
    templateId: contract.templateId,
    kind: contract.kind,
    name: contract.name,
    description: contract.description,
    systemId: contract.systemId,
    workRequiredMs: contract.workRequiredMs,
    workCompletedMs,
    workRequiredBits: getRequiredWorkBits(contract),
    workCompletedBits: activeContract
      ? getCompletedWorkBits(activeContract)
      : ZERO_AMOUNT,
    paidWorkUnits,
    workValueMultiplier,
    remainingMs,
    expiresAtMs: accepted ? null : contract.expiresAtMs,
    rewards,
    novel: contract.novel,
    accepted,
    valuePerHourCredits:
      hours > 0
        ? amountDivide(rewards.credits, amount(hours))
        : rewards.credits,
    expiresInMs: accepted
      ? null
      : Math.max(0, contract.expiresAtMs - state.contracts.elapsedMs),
    operatingCostCredits,
    netRewardCredits: amountSubtract(
      rewards.credits,
      operatingCostCredits,
    ),
    creditRunwayCovered,
    bufferCovered,
    offerPremiumBps: workValueMultiplier.basisPoints,
    authoredWorkValueMultiplierBps: amountToSafeNumber(
      workValueMultiplier.basisPoints,
    ),
    workMix: summarizeHardwareWorkMix(getContractWorkRecipe(contract)),
    canAccept: !accepted && acceptanceBlockedReason === null,
    projectedPauseReason:
      acceptanceBlockedReason ??
      (!creditRunwayCovered
        ? "Credit runway ends before projected completion."
        : bufferCovered
          ? null
          : "Automation Buffer ends before projected completion."),
  };
};

export const getVisibleContracts = (state: GameState): VisibleContract[] => [
  ...state.contracts.active.map((contract) =>
    asVisibleContract(state, contract, true),
  ),
  ...state.contracts.offers.map((contract) =>
    asVisibleContract(state, contract, false),
  ),
];

export const getContractRewardDelta = (before: GameState, after: GameState) => {
  let credits = ZERO_AMOUNT;
  let data = ZERO_AMOUNT;
  for (const contractId of after.contracts.completedContractIds) {
    if (before.contracts.completedContractIds.includes(contractId)) continue;
    const rewards = after.contracts.completedRewards[contractId];
    if (!rewards) continue;
    credits = amountAdd(credits, rewards.credits);
    data = amountAdd(data, rewards.data);
  }
  return { credits, data };
};
