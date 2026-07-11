import type { DeepReadonly } from "./types";

export type ObjectiveDirection = "maximize" | "minimize";

export interface DominanceVector {
  group: string;
  values: readonly number[];
}

export interface PublicActionRouteNode<State, Visible, Action> {
  state: State;
  visible: DeepReadonly<Visible>;
  route: readonly Action[];
  depth: number;
  score: number;
}

export interface BeamSearchConfig<State, Visible, Action> {
  initialState: State;
  observe(state: State): DeepReadonly<Visible>;
  enumerateActions(
    visible: DeepReadonly<Visible>,
    route: readonly Action[],
  ): readonly Action[];
  applyPublicAction(state: State, action: Action): State;
  score(visible: DeepReadonly<Visible>, route: readonly Action[]): number;
  dominance(
    visible: DeepReadonly<Visible>,
    route: readonly Action[],
  ): DominanceVector;
  objectiveDirections: readonly ObjectiveDirection[];
  isGoal?(visible: DeepReadonly<Visible>, route: readonly Action[]): boolean;
  stopOnFirstGoal?: boolean;
  stateKey?(visible: DeepReadonly<Visible>): string;
  beamWidth: number;
  maximumDepth: number;
}

export interface BeamSearchResult<State, Visible, Action> {
  best: PublicActionRouteNode<State, Visible, Action>;
  goals: PublicActionRouteNode<State, Visible, Action>[];
  frontier: PublicActionRouteNode<State, Visible, Action>[];
  stats: {
    expanded: number;
    generated: number;
    dominancePruned: number;
    duplicatePruned: number;
  };
}

const compareNodes = <State, Visible, Action>(
  left: PublicActionRouteNode<State, Visible, Action>,
  right: PublicActionRouteNode<State, Visible, Action>,
) => right.score - left.score || left.depth - right.depth;

const dominanceComparison = (
  left: readonly number[],
  right: readonly number[],
  directions: readonly ObjectiveDirection[],
) => {
  if (left.length !== directions.length || right.length !== directions.length) {
    throw new Error("Dominance vector length must match objective directions");
  }
  let leftBetter = false;
  let rightBetter = false;
  for (let index = 0; index < directions.length; index += 1) {
    const direction = directions[index] === "maximize" ? 1 : -1;
    const leftValue = (left[index] ?? 0) * direction;
    const rightValue = (right[index] ?? 0) * direction;
    if (leftValue > rightValue) leftBetter = true;
    if (rightValue > leftValue) rightBetter = true;
  }
  if (leftBetter && !rightBetter) return 1;
  if (rightBetter && !leftBetter) return -1;
  return leftBetter || rightBetter ? 0 : 2;
};

const pruneDominated = <State, Visible, Action>(
  nodes: readonly PublicActionRouteNode<State, Visible, Action>[],
  config: BeamSearchConfig<State, Visible, Action>,
) => {
  const retained: PublicActionRouteNode<State, Visible, Action>[] = [];
  let pruned = 0;
  for (const candidate of nodes) {
    const candidateVector = config.dominance(candidate.visible, candidate.route);
    let dominated = false;
    for (let index = retained.length - 1; index >= 0; index -= 1) {
      const incumbent = retained[index];
      if (!incumbent) continue;
      const incumbentVector = config.dominance(incumbent.visible, incumbent.route);
      if (incumbentVector.group !== candidateVector.group) continue;
      const comparison = dominanceComparison(
        incumbentVector.values,
        candidateVector.values,
        config.objectiveDirections,
      );
      if (
        comparison === 1 ||
        (comparison === 2 && incumbent.score >= candidate.score)
      ) {
        dominated = true;
        break;
      }
      if (comparison === -1) {
        retained.splice(index, 1);
        pruned += 1;
      }
    }
    if (dominated) pruned += 1;
    else retained.push(candidate);
  }
  return { retained, pruned };
};

/** Generic beam search whose branching policy sees visible state and emits public actions. */
export const beamSearchPublicActionRoutes = <State, Visible, Action>(
  config: BeamSearchConfig<State, Visible, Action>,
): BeamSearchResult<State, Visible, Action> => {
  if (config.beamWidth < 1 || config.maximumDepth < 0) {
    throw new Error("Beam width must be positive and maximum depth non-negative");
  }
  const initialVisible = config.observe(config.initialState);
  const initial: PublicActionRouteNode<State, Visible, Action> = {
    state: config.initialState,
    visible: initialVisible,
    route: [],
    depth: 0,
    score: config.score(initialVisible, []),
  };
  let frontier = [initial];
  const goals: PublicActionRouteNode<State, Visible, Action>[] = [];
  const stats = { expanded: 0, generated: 0, dominancePruned: 0, duplicatePruned: 0 };

  if (config.isGoal?.(initial.visible, initial.route)) goals.push(initial);
  for (let depth = 1; depth <= config.maximumDepth; depth += 1) {
    const generated: PublicActionRouteNode<State, Visible, Action>[] = [];
    for (const node of frontier) {
      const actions = config.enumerateActions(node.visible, node.route);
      stats.expanded += 1;
      for (const action of actions) {
        const state = config.applyPublicAction(node.state, action);
        const visible = config.observe(state);
        const route = [...node.route, action];
        const candidate = {
          state,
          visible,
          route,
          depth,
          score: config.score(visible, route),
        };
        generated.push(candidate);
        stats.generated += 1;
        if (config.isGoal?.(visible, route)) goals.push(candidate);
      }
    }
    if (generated.length === 0) break;
    generated.sort(compareNodes);
    if (config.stopOnFirstGoal && goals.length > 0) break;

    let candidates = generated;
    if (config.stateKey) {
      const keys = new Set<string>();
      candidates = generated.filter((node) => {
        const key = config.stateKey?.(node.visible) ?? "";
        if (keys.has(key)) {
          stats.duplicatePruned += 1;
          return false;
        }
        keys.add(key);
        return true;
      });
    }
    const pruned = pruneDominated(candidates, config);
    stats.dominancePruned += pruned.pruned;
    frontier = pruned.retained.sort(compareNodes).slice(0, config.beamWidth);
    if (frontier.length === 0) break;
  }

  const ranked = [...goals, ...frontier, initial].sort(compareNodes);
  return {
    best: ranked[0] ?? initial,
    goals: goals.sort(compareNodes),
    frontier,
    stats,
  };
};
