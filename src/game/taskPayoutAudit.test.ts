import { describe, expect, it } from "vitest";

import { advanceGame } from "./advance";
import {
  amountDivide,
  amountFloor,
  amountMax,
  amountMultiply,
  exactResourceBag,
} from "./amount";
import { researchDefinitions } from "./content/research";
import {
  TASK_CREDITS_PER_DATA,
  taskDefinitions,
} from "./content/tasks";
import { createDevSeedGameState } from "./devSeeds";
import { withExactResources } from "./economy";
import { V1_HARDWARE_LIMITS } from "./hardwareLimits";
import {
  createRamStickState,
  getPsuWatts,
  syncHardwarePackages,
} from "./progression";
import { deriveVisibleState } from "./selectors";
import { applyAction } from "./simulation";
import { syncSelectedSystemRuntime } from "./systems";
import { getTaskBatchProjection } from "./taskBatches";
import type {
  GameFlags,
  GameState,
  TaskDefinition,
  VisibleResearchComputeTask,
  VisibleTask,
} from "./types";

const publicDefinitions = taskDefinitions.filter(
  (task) => task.visibility !== "internal",
);
const repeatableDefinitions = publicDefinitions.filter((task) => task.repeatable);

const getOperationCoreMultiplier = (
  task: TaskDefinition,
  operation: TaskDefinition["operations"][number],
) => {
  if (task.coreScaling === "chunked") return 1;
  return operation.parallel || operation.kind === "barrier"
    ? (task.maxCores ?? task.minCores)
    : 1;
};

/** Independently reconstructs the authored overlap-aware hardware-work ledger. */
const getExpectedPaidWork = (task: TaskDefinition) =>
  task.subtasks.reduce((total, subtask) => {
    const overlap = subtask.operations.reduce((operationTotal, operation) => {
      if (!operation.memoryAction) return operationTotal;
      return (
        operationTotal +
        Math.min(operation.cycles, operation.cacheBits) *
          getOperationCoreMultiplier(task, operation)
      );
    }, 0);
    const composition = task.composition.find(
      (entry) => entry.taskId === subtask.sourceTaskId,
    );
    const scale =
      task.coreScaling === "chunked" && composition?.mode === "perWorkUnit"
        ? task.workUnitCount
        : 1;
    return total + (subtask.operationCount - overlap) * scale;
  }, 0);

const createAuditState = (): GameState => {
  const base = createDevSeedGameState("rack-ready");
  const evidence = { gpuRenderCompletions: 1, npuInferenceCompletions: 1 };
  const completedBenchmarks = publicDefinitions
    .filter((task) => task.kind === "benchmark")
    .map((task) => task.id);
  const completedJobs = Object.fromEntries(
    [...repeatableDefinitions, ...publicDefinitions.filter((task) => task.kind === "benchmark")]
      .map((task) => [task.id, 1]),
  );
  const hardwareState = syncHardwarePackages({
    ...base,
    hardware: {
      ...base.hardware,
      cpus: base.hardware.cpus.map((cpu, index) => ({
        ...cpu,
        coreIds: index === 0 ? [1, 2, 3, 4] : [5, 6],
        schedulerSlots: 4,
      })),
      ramSticks: Array.from({ length: 4 }, (_, index) =>
        createRamStickState(index + 1, 5, 5),
      ),
      systemSchedulerSlots: V1_HARDWARE_LIMITS.systemQueueSlots,
      psuLevel: V1_HARDWARE_LIMITS.psuLevel,
      psuWatts: getPsuWatts(V1_HARDWARE_LIMITS.psuLevel),
    },
  });
  const flags = (Object.keys(hardwareState.flags) as Array<keyof GameFlags>)
    .reduce<GameFlags>(
      (allFlags, flag) => ({ ...allFlags, [flag]: true }),
      { ...hardwareState.flags },
    );
  const systems = hardwareState.systems.map((system) => ({
    ...system,
    activeTasks: [],
    activeJobs: [],
    queue: [],
    queueEntries: [],
    workshop: {
      ...system.workshop,
      evidence,
    },
  }));
  const staged = syncSelectedSystemRuntime({
    ...hardwareState,
    systems,
    flags,
    research: {
      ...hardwareState.research,
      completed: researchDefinitions.map((research) => research.id),
    },
    completedTasks: completedJobs,
    completedJobs,
    completedBenchmarks,
    workshop: {
      ...hardwareState.workshop,
      evidence,
    },
    activeTasks: [],
    activeJobs: [],
    queue: [],
    queueEntries: [],
    power: {
      ...hardwareState.power,
      bootstrapGraceSeconds: 1_000_000_000,
    },
    standingOrder: {
      ...hardwareState.standingOrder,
      taskId: null,
      enabled: false,
    },
    liveOperations: {
      ...hardwareState.liveOperations,
      enabled: false,
    },
  });

  return withExactResources(staged, exactResourceBag("1e100", "1e100"));
};

const getPublicViews = (state: GameState) => {
  const visible = deriveVisibleState(state);
  return new Map<string, VisibleTask | VisibleResearchComputeTask>([
    ...visible.tasks.map((task): [string, VisibleTask] => [task.id, task]),
    ...visible.research.flatMap((research) =>
      research.computeTasks.map(
        (task): [string, VisibleResearchComputeTask] => [task.id, task],
      ),
    ),
  ]);
};

describe("player-facing task payout audit", () => {
  it("covers 22 repeatable jobs and four one-shot research benchmarks", () => {
    expect(publicDefinitions).toHaveLength(26);
    expect(repeatableDefinitions).toHaveLength(22);
    expect(publicDefinitions.filter((task) => !task.repeatable)).toHaveLength(4);
  });

  it("derives every gross reward from exact overlap-aware hardware work", () => {
    for (const task of publicDefinitions) {
      expect(getExpectedPaidWork(task), task.id).toBe(task.paidWorkUnits);
      expect(task.rewardCreditsExact, task.id).toBe(task.paidWorkUnitsExact);
    }
  });

  it("keeps public Data near one whole unit per ten gross Credits", () => {
    for (const task of publicDefinitions) {
      const grossCredits = amountMultiply(
        task.rewardCreditsExact,
        task.aggregateBatch?.workUnitMultiplier ?? 1,
      );
      const expectedData = amountMax(
        1,
        amountFloor(amountDivide(grossCredits, TASK_CREDITS_PER_DATA)),
      );

      expect(task.rewardDataExact, task.id).toBe(expectedData);
    }
    for (const task of taskDefinitions.filter(
      (candidate) => candidate.visibility === "internal",
    )) {
      expect(task.rewardDataExact, task.id).toBe("0");
    }
  });

  it("keeps selector compute ops, paid work, and reward projections aligned", () => {
    const state = createAuditState();
    const views = getPublicViews(state);

    expect([...views.keys()].sort()).toEqual(
      publicDefinitions.map((task) => task.id).sort(),
    );
    for (const task of publicDefinitions) {
      const view = views.get(task.id);
      const projection = getTaskBatchProjection(state, task);

      expect(view?.requiredCycles, task.id).toBe(task.requiredCycles);
      expect(view?.projection.paidWorkUnits, task.id).toBe(projection.paidWorkUnits);
      expect(view?.projection.rewardCredits, task.id).toBe(projection.rewardCredits);
      expect(view?.rewardData, task.id).toBe(task.rewardData);
      if ("paidWorkUnits" in (view ?? {})) {
        expect((view as VisibleTask).paidWorkUnits, task.id).toBe(
          Number(projection.paidWorkUnits),
        );
      }
    }
  });

  it("keeps opening compute ops explicit while payout also values transfer work", () => {
    expect(
      ["fetchBit", "decodeBit", "bitFlip", "bitShift", "byteCopy", "packetCheck"]
        .map((taskId) => taskDefinitions.find((task) => task.id === taskId)!)
        .map((task) => ({
          id: task.id,
          authoredInvocations: task.operationCount,
          computeOps: task.requiredCycles,
          cacheTransferBits: task.dagNodes
            .filter((node) => node.kind === "cacheLoad")
            .reduce((total, node) => total + node.operationCount, 0),
          paidWork: task.paidWorkUnits,
        })),
    ).toEqual([
      { id: "fetchBit", authoredInvocations: 2, computeOps: 2, cacheTransferBits: 1, paidWork: 2 },
      { id: "decodeBit", authoredInvocations: 2, computeOps: 2, cacheTransferBits: 3, paidWork: 4 },
      { id: "bitFlip", authoredInvocations: 3, computeOps: 3, cacheTransferBits: 2, paidWork: 3 },
      { id: "bitShift", authoredInvocations: 3, computeOps: 4, cacheTransferBits: 2, paidWork: 4 },
      { id: "byteCopy", authoredInvocations: 16, computeOps: 16, cacheTransferBits: 16, paidWork: 16 },
      { id: "packetCheck", authoredInvocations: 4, computeOps: 44, cacheTransferBits: 6, paidWork: 48 },
    ]);
  });

  it("settles every repeatable job at its frozen gross reward", { timeout: 90_000 }, () => {
    const state = createAuditState();
    const views = getPublicViews(state);

    for (const task of repeatableDefinitions) {
      const view = views.get(task.id)!;
      const beforeEarned = state.taskRewardCreditsEarned[task.id] ?? "0";
      const started = applyAction(state, { type: "startTask", taskId: task.id });
      const horizonMs = Math.ceil(view.projection.durationMs * 20) + 100_000;
      const completed = advanceGame(started, horizonMs, "foreground");
      const projectedReward = view.projection.rewardCredits!;

      expect(completed.intervalReport.completedWork[task.id], task.id).toBe(1);
      expect(completed.intervalReport.creditsEarned, task.id).toBe(projectedReward);
      expect(completed.intervalReport.dataEarned, task.id).toBe(
        task.rewardDataExact,
      );
      expect(completed.state.taskRewardCreditsEarned[task.id], task.id).toBe(
        amountMultiply(task.rewardCreditsExact, task.aggregateBatch?.workUnitMultiplier ?? 1),
      );
      expect(beforeEarned, task.id).toBe("0");
    }
  });
});
