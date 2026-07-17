import { describe, expect, it } from "vitest";
import { createInitialGameState } from "../progression";
import type { GameState, ResearchId, TaskId } from "../types";
import { researchDefinitions } from "./research";
import { getTaskDefinition, taskDefinitions } from "./tasks";

const requiredResearchByPlayerTask = {
  fetchBit: [],
  decodeBit: [],
  bitFlip: ["decodeLogic"],
  bitShift: ["decodeLogic"],
  byteCopy: ["byteOperations"],
  packetCheck: ["cacheMapping"],
  readRamPage: ["ramControl", "systemScheduler"],
  writeRamPage: ["ramControl", "systemScheduler"],
  overwriteRamPage: ["ramControl", "systemScheduler"],
  tinyChecksum: ["ramControl", "systemScheduler"],
  memoryScrub: ["systemScheduler"],
  queueCompaction: ["systemScheduler"],
  powerTelemetry: ["systemScheduler"],
  busMirror: ["systemScheduler"],
  thermalProbe: ["systemCatalog"],
  shardReconcile: ["systemScheduler"],
  compileCode: ["systemCatalog"],
  renderFrame: ["systemCatalog"],
  inferenceBatch: ["specializedCompute"],
  regressionTest: ["systemCatalog"],
  workstationBenchmark: ["specializedCompute"],
} as const satisfies Record<string, readonly ResearchId[]>;

const benchmarkResearchGates = {
  microBenchmark: ["benchmarkHarness"],
  parallelismBenchmark: ["multiCore"],
  multiCoreBenchmark: ["systemScheduler"],
} as const satisfies Record<string, readonly ResearchId[]>;

const createFullyQualifiedState = (): GameState => {
  const initial = createInitialGameState();
  const completedTasks = Object.fromEntries(
    taskDefinitions
      .filter((task) => task.visibility !== "internal" && task.repeatable)
      .map((task) => [task.id, 1]),
  );
  const evidence = { gpuRenderCompletions: 1, npuInferenceCompletions: 1 };

  return {
    ...initial,
    research: {
      ...initial.research,
      completed: researchDefinitions
        .map((research) => research.id)
        .filter(
          (id) => id !== "bitMutation" && id !== "shiftOperations",
        ),
    },
    hardware: {
      ...initial.hardware,
      clockLevel: 3,
      cacheLevel: 3,
      ramBits: 1024,
      cores: 4,
      secondCpu: true,
    },
    systems: initial.systems.map((system) => ({
      ...system,
      workshop: { ...system.workshop, evidence },
    })),
    workshop: { ...initial.workshop, evidence },
    completedTasks,
    completedJobs: completedTasks,
  };
};

const withoutResearch = (
  state: GameState,
  researchId: ResearchId,
): GameState => ({
  ...state,
  research: {
    ...state.research,
    completed: state.research.completed.filter((id) => id !== researchId),
  },
});

describe("task content sheet", () => {
  it("hides every player task until all of its prerequisite research is complete", () => {
    const qualified = createFullyQualifiedState();
    const playerTasks = taskDefinitions.filter(
      (task) => task.visibility !== "internal" && task.kind !== "benchmark",
    );

    expect(playerTasks.map((task) => task.id).sort()).toEqual(
      Object.keys(requiredResearchByPlayerTask).sort(),
    );

    for (const task of playerTasks) {
      const requiredResearch =
        requiredResearchByPlayerTask[
          task.id as keyof typeof requiredResearchByPlayerTask
        ];

      expect(task.reveal(qualified), `${task.id} reveal with research`).toBe(true);
      expect(task.requirement(qualified), `${task.id} requirement with research`).toBe(
        true,
      );

      for (const researchId of requiredResearch) {
        const unresearched = withoutResearch(qualified, researchId);
        expect(task.reveal(unresearched), `${task.id} reveal before ${researchId}`).toBe(
          false,
        );
        expect(
          task.requirement(unresearched),
          `${task.id} requirement before ${researchId}`,
        ).toBe(false);
      }
    }
  });

  it("keeps research-card benchmarks gated by their prerequisite research", () => {
    const qualified = createFullyQualifiedState();
    const benchmarkTasks = taskDefinitions.filter(
      (task) => task.visibility !== "internal" && task.kind === "benchmark",
    );

    expect(benchmarkTasks.map((task) => task.id).sort()).toEqual(
      Object.keys(benchmarkResearchGates).sort(),
    );

    for (const task of benchmarkTasks) {
      const state = {
        ...qualified,
        completedBenchmarks:
          task.id === "parallelismBenchmark" ? (["microBenchmark"] as TaskId[]) : [],
      };
      const requiredResearch =
        benchmarkResearchGates[
          task.id as keyof typeof benchmarkResearchGates
        ];

      expect(task.reveal(state), `${task.id} reveal with research`).toBe(true);
      expect(task.requirement(state), `${task.id} requirement with research`).toBe(true);

      for (const researchId of requiredResearch) {
        const unresearched = withoutResearch(state, researchId);
        expect(task.reveal(unresearched), `${task.id} reveal before ${researchId}`).toBe(
          false,
        );
        expect(
          task.requirement(unresearched),
          `${task.id} requirement before ${researchId}`,
        ).toBe(false);
      }
    }
  });

  // C-SIM-1 / F-ECO-2: runtime executes every composition child as a fresh
  // ActiveTask with empty ramBlocks, so a child's standalone work volume IS
  // the work the hardware physically performs. The composed task's paid work
  // must equal that volume exactly (paid units == executed units).
  it("pays composed tasks exactly the work their runtime children execute", () => {
    for (const task of taskDefinitions) {
      if (!task.composition || task.composition.length === 0) continue;

      const executedUnits = task.composition.reduce((total, entry) => {
        const child = getTaskDefinition(entry.taskId);
        const scale =
          entry.mode === "perWorkUnit" ? (task.workUnitCount ?? 1) : 1;
        return total + child.paidWorkUnits * scale;
      }, 0);

      expect(
        { taskId: task.id, paidWorkUnits: task.paidWorkUnits },
      ).toEqual({ taskId: task.id, paidWorkUnits: executedUnits });
    }
  });

  it("derives Tiny Checksum payout from one RAM staging per child", () => {
    const task = getTaskDefinition("tinyChecksum");
    const stage = getTaskDefinition("stageChecksumPage");
    const step = getTaskDefinition("checksumStep");
    const ramLoadNodes = task.dagNodes.filter((node) => node.kind === "ramLoad");

    // The checksum child re-stages the full 256-bit page because residency
    // does not survive the child boundary at runtime (C-SIM-1 / F-ECO-2).
    expect(ramLoadNodes.map((node) => node.operationCount)).toEqual([256, 256]);
    expect(task.paidWorkUnits).toBe(stage.paidWorkUnits + step.paidWorkUnits);
    expect(task.paidWorkUnits).toBe(580);
    expect(task.rewardCredits).toBe(task.paidWorkUnits);
  });

  it("applies the whole-Data 1:10 rule across RAM-era jobs", () => {
    expect(getTaskDefinition("tinyChecksum").rewardData).toBe(58);
    expect(getTaskDefinition("readRamPage").rewardData).toBe(28);
    expect(getTaskDefinition("writeRamPage").rewardData).toBe(28);
    expect(getTaskDefinition("overwriteRamPage").rewardData).toBe(27);

    const total = (["tinyChecksum", "readRamPage", "writeRamPage", "overwriteRamPage"] as const)
      .reduce((sum, taskId) => sum + getTaskDefinition(taskId).rewardData, 0);
    expect(total).toBe(141);

    // Every player-facing RAM job is owned by the System Scheduler.
    for (const taskId of ["readRamPage", "writeRamPage", "overwriteRamPage"] as const) {
      expect(getTaskDefinition(taskId).category).toBe("system");
    }
    expect(getTaskDefinition("tinyChecksum").category).toBe("system");
  });

  it("routes every player-facing RAM task through the System Scheduler", () => {
    const qualified = createFullyQualifiedState();
    const ramTasks = taskDefinitions.filter(
      (task) =>
        task.visibility !== "internal" &&
        task.kind !== "benchmark" &&
        task.ramNeedBits > 0,
    );

    expect(ramTasks.length).toBeGreaterThan(0);
    for (const task of ramTasks) {
      expect(task.category, task.id).toBe("system");
      expect(task.reveal(withoutResearch(qualified, "systemScheduler")), task.id).toBe(
        false,
      );
      expect(
        task.requirement(withoutResearch(qualified, "systemScheduler")),
        task.id,
      ).toBe(false);
    }
  });
});
