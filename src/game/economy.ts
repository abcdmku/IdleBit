import {
  amount,
  amountAdd,
  amountCompare,
  amountSubtract,
  amountToSafeNumber,
  exactResourceBag,
  ZERO_AMOUNT,
  type ExactCost,
  type ExactResourceBag,
} from "./amount";
import type { Cost, GameState, VisibleCost } from "./types";

const normalizeExactResourceAuthority = (
  resources: Readonly<ExactResourceBag>,
): ExactResourceBag => {
  const normalized = exactResourceBag(resources.credits, resources.data);
  if (
    amountCompare(normalized.credits, ZERO_AMOUNT) < 0 ||
    amountCompare(normalized.data, ZERO_AMOUNT) < 0
  ) {
    throw new Error("Resource balances must be non-negative");
  }
  return normalized;
};

export const projectExactResources = (resources: ExactResourceBag) => {
  const normalized = normalizeExactResourceAuthority(resources);
  return {
    credits: amountToSafeNumber(normalized.credits),
    data: amountToSafeNumber(normalized.data),
  };
};

const projectedResources = (state: GameState) =>
  projectExactResources(state.exactResources);

const numericResourcesMatchExact = (state: GameState) => {
  const projected = projectedResources(state);
  return (
    projected.credits === state.resources.credits &&
    projected.data === state.resources.data
  );
};

export const syncExactResources = (state: GameState): GameState => {
  if (numericResourcesMatchExact(state)) return state;
  return {
    ...state,
    resources: projectedResources(state),
  };
};

/** Renderer boundary: authoritative costs stay exact in simulation and saves. */
export const projectExactCosts = (costs: readonly Cost[]): VisibleCost[] =>
  costs.map((cost) => ({
    resource: cost.resource,
    amount: amountToSafeNumber(cost.amount),
  }));

const aggregateExactCosts = (costs: readonly ExactCost[]): ExactResourceBag => {
  let credits = ZERO_AMOUNT;
  let data = ZERO_AMOUNT;
  for (const cost of costs) {
    if (amountCompare(cost.amount, ZERO_AMOUNT) < 0) {
      throw new Error("Economy costs and refunds must be non-negative");
    }
    if (cost.resource === "credits") credits = amountAdd(credits, cost.amount);
    else data = amountAdd(data, cost.amount);
  }
  return { credits, data };
};

export const withExactResources = (
  state: GameState,
  exactResources: ExactResourceBag,
): GameState => {
  const normalized = normalizeExactResourceAuthority(exactResources);
  return {
    ...state,
    exactResources: normalized,
    resources: projectExactResources(normalized),
  };
};

export const setExactResource = (
  state: GameState,
  resource: keyof ExactResourceBag,
  value: ExactResourceBag[keyof ExactResourceBag] | string | number,
): GameState => {
  const normalized = amount(value);
  if (amountCompare(normalized, ZERO_AMOUNT) < 0) {
    throw new Error("Resource balances must be non-negative");
  }
  return withExactResources(state, {
    ...state.exactResources,
    [resource]: normalized,
  });
};

export const canAffordExact = (state: GameState, costs: readonly ExactCost[]) => {
  const synced = syncExactResources(state);
  const total = aggregateExactCosts(costs);
  return (
    amountCompare(synced.exactResources.credits, total.credits) >= 0 &&
    amountCompare(synced.exactResources.data, total.data) >= 0
  );
};

export const spendExact = (
  state: GameState,
  costs: readonly ExactCost[],
): GameState => {
  const synced = syncExactResources(state);
  const total = aggregateExactCosts(costs);
  if (
    amountCompare(synced.exactResources.credits, total.credits) < 0 ||
    amountCompare(synced.exactResources.data, total.data) < 0
  ) {
    return synced;
  }
  return withExactResources(synced, {
    credits: amountSubtract(synced.exactResources.credits, total.credits),
    data: amountSubtract(synced.exactResources.data, total.data),
  });
};

export const canAfford = (state: GameState, costs: readonly Cost[]) =>
  canAffordExact(state, costs);

export const spend = (state: GameState, costs: readonly Cost[]): GameState =>
  spendExact(state, costs);

export const addExactResources = (
  state: GameState,
  resources: Readonly<ExactResourceBag>,
): GameState => {
  const synced = syncExactResources(state);
  const credits = amount(resources.credits);
  const data = amount(resources.data);
  if (
    amountCompare(credits, ZERO_AMOUNT) < 0 ||
    amountCompare(data, ZERO_AMOUNT) < 0
  ) {
    throw new Error("Economy rewards and refunds must be non-negative");
  }
  return withExactResources(synced, {
    credits: amountAdd(synced.exactResources.credits, credits),
    data: amountAdd(synced.exactResources.data, data),
  });
};

export const addCosts = (state: GameState, costs: readonly Cost[]): GameState => {
  const total = aggregateExactCosts(costs);
  return addExactResources(state, total);
};

export const addRewards = (
  state: GameState,
  credits: number,
  data: number,
): GameState => {
  return addExactResources(state, exactResourceBag(credits, data));
};

export const addExactRewards = (
  state: GameState,
  rewards: Readonly<{ credits: string; data: string }>,
): GameState => {
  return addExactResources(state, exactResourceBag(rewards.credits, rewards.data));
};
