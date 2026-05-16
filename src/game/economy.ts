import type { Cost, GameState } from "./types";

export const canAfford = (state: GameState, costs: Cost[]) =>
  costs.every((cost) => state.resources[cost.resource] >= cost.amount);

export const spend = (state: GameState, costs: Cost[]): GameState => ({
  ...state,
  resources: costs.reduce(
    (resources, cost) => ({
      ...resources,
      [cost.resource]: resources[cost.resource] - cost.amount,
    }),
    state.resources,
  ),
});

export const addRewards = (
  state: GameState,
  credits: number,
  data: number,
): GameState => ({
  ...state,
  resources: {
    credits: state.resources.credits + credits,
    data: state.resources.data + data,
  },
});

