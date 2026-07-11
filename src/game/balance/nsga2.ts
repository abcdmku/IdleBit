import { createRngState, nextRngFloat } from "../rng";
import type { Xoshiro128State } from "../rng";
import type { ObjectiveDirection } from "./beamSearch";

export interface TunableParameter {
  id: string;
  minimum: number;
  maximum: number;
  integer?: boolean;
}

export interface NsgaIndividual {
  vector: readonly number[];
  objectives: readonly number[];
  rank: number;
  crowdingDistance: number;
}

export interface Nsga2Config {
  parameters: readonly TunableParameter[];
  objectiveDirections: readonly ObjectiveDirection[];
  evaluate(vector: readonly number[]): readonly number[];
  populationSize: number;
  generations: number;
  seed: number;
  initialPopulation?: readonly (readonly number[])[];
  crossoverRate?: number;
  mutationRate?: number;
  mutationScale?: number;
}

export interface Nsga2Result {
  population: NsgaIndividual[];
  paretoFront: NsgaIndividual[];
  history: Array<{ generation: number; paretoSize: number }>;
}

const random = (rng: Xoshiro128State) => nextRngFloat(rng);

const normalizedObjective = (
  value: number,
  direction: ObjectiveDirection,
) => value * (direction === "maximize" ? 1 : -1);

const dominates = (
  left: NsgaIndividual,
  right: NsgaIndividual,
  directions: readonly ObjectiveDirection[],
) => {
  let strictlyBetter = false;
  for (let index = 0; index < directions.length; index += 1) {
    const leftValue = normalizedObjective(left.objectives[index] ?? 0, directions[index] ?? "maximize");
    const rightValue = normalizedObjective(right.objectives[index] ?? 0, directions[index] ?? "maximize");
    if (leftValue < rightValue) return false;
    if (leftValue > rightValue) strictlyBetter = true;
  }
  return strictlyBetter;
};

const rankAndCrowding = (
  population: NsgaIndividual[],
  directions: readonly ObjectiveDirection[],
) => {
  const dominated: number[][] = population.map(() => []);
  const dominationCount = population.map(() => 0);
  const fronts: number[][] = [[]];
  for (let left = 0; left < population.length; left += 1) {
    for (let right = 0; right < population.length; right += 1) {
      if (left === right) continue;
      if (dominates(population[left]!, population[right]!, directions)) {
        dominated[left]!.push(right);
      } else if (dominates(population[right]!, population[left]!, directions)) {
        dominationCount[left] = (dominationCount[left] ?? 0) + 1;
      }
    }
    if (dominationCount[left] === 0) fronts[0]!.push(left);
  }

  let frontIndex = 0;
  while ((fronts[frontIndex]?.length ?? 0) > 0) {
    const next: number[] = [];
    for (const index of fronts[frontIndex] ?? []) {
      population[index]!.rank = frontIndex;
      for (const dominatedIndex of dominated[index] ?? []) {
        dominationCount[dominatedIndex] = (dominationCount[dominatedIndex] ?? 0) - 1;
        if (dominationCount[dominatedIndex] === 0) next.push(dominatedIndex);
      }
    }
    frontIndex += 1;
    if (next.length > 0) fronts.push(next);
  }

  for (const front of fronts) {
    for (const index of front) population[index]!.crowdingDistance = 0;
    if (front.length <= 2) {
      for (const index of front) population[index]!.crowdingDistance = Number.POSITIVE_INFINITY;
      continue;
    }
    for (let objective = 0; objective < directions.length; objective += 1) {
      const sorted = [...front].sort(
        (left, right) =>
          (population[left]!.objectives[objective] ?? 0) -
          (population[right]!.objectives[objective] ?? 0),
      );
      population[sorted[0]!]!.crowdingDistance = Number.POSITIVE_INFINITY;
      population[sorted[sorted.length - 1]!]!.crowdingDistance = Number.POSITIVE_INFINITY;
      const minimum = population[sorted[0]!]!.objectives[objective] ?? 0;
      const maximum = population[sorted[sorted.length - 1]!]!.objectives[objective] ?? 0;
      if (maximum === minimum) continue;
      for (let index = 1; index < sorted.length - 1; index += 1) {
        const current = population[sorted[index]!]!;
        if (!Number.isFinite(current.crowdingDistance)) continue;
        const previous = population[sorted[index - 1]!]!.objectives[objective] ?? 0;
        const next = population[sorted[index + 1]!]!.objectives[objective] ?? 0;
        current.crowdingDistance += (next - previous) / (maximum - minimum);
      }
    }
  }
  return fronts;
};

const compareIndividuals = (left: NsgaIndividual, right: NsgaIndividual) =>
  left.rank - right.rank || right.crowdingDistance - left.crowdingDistance;

const clampGene = (value: number, parameter: TunableParameter) => {
  const clamped = Math.max(parameter.minimum, Math.min(parameter.maximum, value));
  return parameter.integer ? Math.round(clamped) : clamped;
};

const evaluateVector = (config: Nsga2Config, vector: readonly number[]): NsgaIndividual => {
  const normalized = config.parameters.map((parameter, index) =>
    clampGene(vector[index] ?? parameter.minimum, parameter),
  );
  const objectives = [...config.evaluate(normalized)];
  if (objectives.length !== config.objectiveDirections.length) {
    throw new Error("Evaluation objective count must match objective directions");
  }
  if (objectives.some((value) => Number.isNaN(value))) {
    throw new Error("NSGA-II objectives cannot be NaN");
  }
  return { vector: normalized, objectives, rank: 0, crowdingDistance: 0 };
};

const tournament = (
  population: readonly NsgaIndividual[],
  rng: Xoshiro128State,
) => {
  const firstDraw = random(rng);
  const secondDraw = random(firstDraw.state);
  const first = population[Math.floor(firstDraw.value * population.length)]!;
  const second = population[Math.floor(secondDraw.value * population.length)]!;
  return {
    rng: secondDraw.state,
    parent: compareIndividuals(first, second) <= 0 ? first : second,
  };
};

/** A compact deterministic NSGA-II suitable for balance parameter sweeps. */
export const runNsga2 = (config: Nsga2Config): Nsga2Result => {
  if (config.parameters.length === 0 || config.objectiveDirections.length === 0) {
    throw new Error("NSGA-II requires parameters and objectives");
  }
  if (config.populationSize < 2 || config.generations < 0) {
    throw new Error("NSGA-II population must be at least two and generations non-negative");
  }
  let rng = createRngState(config.seed);
  const vectors: number[][] = (config.initialPopulation ?? [])
    .slice(0, config.populationSize)
    .map((vector) => [...vector]);
  while (vectors.length < config.populationSize) {
    const vector: number[] = [];
    for (const parameter of config.parameters) {
      const draw = random(rng);
      rng = draw.state;
      vector.push(parameter.minimum + draw.value * (parameter.maximum - parameter.minimum));
    }
    vectors.push(vector);
  }
  let population = vectors.map((vector) => evaluateVector(config, vector));
  rankAndCrowding(population, config.objectiveDirections);
  const history = [{ generation: 0, paretoSize: population.filter((item) => item.rank === 0).length }];
  const crossoverRate = config.crossoverRate ?? 0.9;
  const mutationRate = config.mutationRate ?? 1 / config.parameters.length;
  const mutationScale = config.mutationScale ?? 0.1;

  for (let generation = 1; generation <= config.generations; generation += 1) {
    const offspring: NsgaIndividual[] = [];
    while (offspring.length < config.populationSize) {
      const left = tournament(population, rng);
      rng = left.rng;
      const right = tournament(population, rng);
      rng = right.rng;
      const crossover = random(rng);
      rng = crossover.state;
      const children = [left.parent.vector.slice(), right.parent.vector.slice()];
      if (crossover.value < crossoverRate) {
        for (let gene = 0; gene < config.parameters.length; gene += 1) {
          const blend = random(rng);
          rng = blend.state;
          const leftGene = left.parent.vector[gene] ?? 0;
          const rightGene = right.parent.vector[gene] ?? 0;
          children[0]![gene] = blend.value * leftGene + (1 - blend.value) * rightGene;
          children[1]![gene] = blend.value * rightGene + (1 - blend.value) * leftGene;
        }
      }
      for (const child of children) {
        for (let gene = 0; gene < config.parameters.length; gene += 1) {
          const mutation = random(rng);
          rng = mutation.state;
          if (mutation.value >= mutationRate) continue;
          const offset = random(rng);
          rng = offset.state;
          const parameter = config.parameters[gene]!;
          child[gene] =
            (child[gene] ?? parameter.minimum) +
            (offset.value * 2 - 1) *
              (parameter.maximum - parameter.minimum) *
              mutationScale;
        }
        offspring.push(evaluateVector(config, child));
        if (offspring.length >= config.populationSize) break;
      }
    }
    const combined = [...population, ...offspring];
    rankAndCrowding(combined, config.objectiveDirections);
    population = combined.sort(compareIndividuals).slice(0, config.populationSize);
    rankAndCrowding(population, config.objectiveDirections);
    history.push({
      generation,
      paretoSize: population.filter((item) => item.rank === 0).length,
    });
  }

  population.sort(compareIndividuals);
  return {
    population,
    paretoFront: population.filter((individual) => individual.rank === 0),
    history,
  };
};
