import { runNsga2 } from "./nsga2";
import { describe, expect, it } from "vitest";

describe("deterministic NSGA-II", () => {
  it("replays a seeded multi-objective parameter search", () => {
    const config = {
      parameters: [
        { id: "reward", minimum: 0, maximum: 1 },
        { id: "power", minimum: 0, maximum: 1 },
      ],
      objectiveDirections: ["maximize", "minimize"] as const,
      evaluate: (vector: readonly number[]) => [
        (vector[0] ?? 0) * (1 + (vector[1] ?? 0)),
        (vector[0] ?? 0) ** 2 + (vector[1] ?? 0),
      ],
      populationSize: 12,
      generations: 5,
      seed: 991,
    };
    const first = runNsga2(config);
    const replay = runNsga2(config);

    expect(replay).toEqual(first);
    expect(first.paretoFront.length).toBeGreaterThan(0);
    expect(first.population.every((individual) => individual.objectives.length === 2)).toBe(true);
  });

  it("removes dominated supplied vectors from generation zero's Pareto front", () => {
    const result = runNsga2({
      parameters: [{ id: "x", minimum: 0, maximum: 1 }],
      objectiveDirections: ["maximize", "maximize"],
      evaluate: ([x = 0]) => [x, x],
      populationSize: 3,
      generations: 0,
      seed: 1,
      initialPopulation: [[0], [0.5], [1]],
    });
    expect(result.paretoFront.map((individual) => individual.vector)).toEqual([[1]]);
  });
});
