import { describe, expect, it } from "vitest";
import {
  advanceGame,
  amountSubtract,
  applyAction,
  createInitialGameState,
  deriveVisibleState,
  deserializeSave,
  exactResourceBag,
  serializeSave,
  type GameState,
} from "./index";
import { getTaskDefinition } from "./content/tasks";

const fundedCatalog = (): GameState => {
  const initial = createInitialGameState();
  return {
    ...initial,
    exactResources: exactResourceBag("1e50", "1e50"),
    resources: { credits: 1e50, data: 1e50 },
    flags: {
      ...initial.flags,
      basicQueue: true,
      scheduler: true,
      systemCatalog: true,
      customMachineAssembly: true,
      systemStats: true,
    },
    research: {
      ...initial.research,
      completed: [
        "systemScheduler",
        "systemCatalog",
        "customMachineAssembly",
        "cpuTierKhz",
        "cpuTierMhz",
        "cpuTierGhz",
      ],
    },
    completedTasks: { compileCode: 1, renderFrame: 1 },
    completedJobs: { compileCode: 1, renderFrame: 1 },
  };
};

const withTemplate = (templateId: "starterNode" | "compileBox" | "renderBrick") =>
  applyAction(fundedCatalog(), { type: "buyMachineTemplate", templateId });

const compileProjection = (state: GameState) =>
  deriveVisibleState(state).tasks.find((task) => task.id === "compileCode")!
    .projection;

describe("aggregate task batches", () => {
  it("keeps authored logical work fixed while faster hardware finishes sooner", () => {
    const slow = withTemplate("starterNode");
    const fast = withTemplate("renderBrick");
    const slowProjection = compileProjection(slow);
    const fastProjection = compileProjection(fast);

    expect(slowProjection.batchMultiplier).toBe(64);
    expect(fastProjection.batchMultiplier).toBe(
      slowProjection.batchMultiplier,
    );
    expect(fastProjection.logicalWorkUnitCount).toBe(
      slowProjection.logicalWorkUnitCount,
    );
    expect(fastProjection.rewardCredits).toBe(slowProjection.rewardCredits);
    expect(fastProjection.durationMs).toBeLessThan(slowProjection.durationMs);
    expect(fastProjection.baseDurationMs).toBeLessThan(
      slowProjection.baseDurationMs!,
    );

    const slowStarted = applyAction(slow, {
      type: "startTask",
      taskId: "compileCode",
    });
    const fastStarted = applyAction(fast, {
      type: "startTask",
      taskId: "compileCode",
    });
    expect(slowStarted.queueEntries?.[0]?.totalChildCount).toBe(7);
    expect(fastStarted.queueEntries?.[0]?.totalChildCount).toBe(7);
    expect(slowStarted.activeTasks.length).toBeLessThanOrEqual(2);
    expect(fastStarted.activeTasks.length).toBeLessThanOrEqual(2);
  });

  it("conserves the frozen authored workload and payout through runtime completion", () => {
    const state = withTemplate("compileBox");
    const projection = compileProjection(state);
    const started = applyAction(state, {
      type: "startTask",
      taskId: "compileCode",
    });
    const parent = started.queueEntries?.[0]!;
    const child = started.activeTasks[0]!;
    const childDefinition = getTaskDefinition(child.taskId);

    expect(child.batchMultiplier).toBe(parent.batchMultiplier);
    expect(child.projectedWorkCycles).toBe(
      String(Number(childDefinition.requiredCyclesExact) * parent.batchMultiplier!),
    );
    expect(
      advanceGame(started, projection.durationMs * 0.95, "foreground").state
        .completedTasks.compileCode,
    ).toBe(1);

    const completed = advanceGame(
      started,
      projection.durationMs * 1.05,
      "foreground",
    );
    const taskEvent = completed.intervalReport.completionEvents?.find(
      (event) => event.source === "task" && event.workId === "compileCode",
    );
    expect(completed.state.completedTasks.compileCode).toBe(2);
    expect(completed.intervalReport.creditsEarned).toBe(
      parent.projectedRewardCredits,
    );
    expect(taskEvent).toMatchObject({
      source: "task",
      workId: "compileCode",
      workCycles: parent.projectedWorkCycles,
      creditsEarned: parent.projectedRewardCredits,
    });
    expect(
      amountSubtract(
        completed.state.exactResources.credits,
        started.exactResources.credits,
      ),
    ).toBe(parent.projectedRewardCredits);
  });

  it("propagates engine-owned standing provenance through system parent work and saves", () => {
    const base = withTemplate("compileBox");
    let state: GameState = {
      ...base,
      flags: { ...base.flags, cron: true },
      automationBuffer: {
        ownedLevelId: "cronRuntime",
        departureLevelId: "cronRuntime",
        offlineProcessedMs: 0,
      },
    };
    state = applyAction(state, {
      type: "setStandingOrder",
      taskId: "compileCode",
      systemId: state.selectedSystemId,
    });
    const projection = compileProjection(state);
    const started = advanceGame(state, 1, "foreground").state;

    expect(started.queueEntries?.[0]).toEqual(
      expect.objectContaining({
        taskId: "compileCode",
        workOrigin: "standing-order",
      }),
    );
    expect(started.activeTasks.length).toBeGreaterThan(0);
    expect(
      started.activeTasks.every(
        (task) =>
          task.parentTaskId === "compileCode" &&
          task.workOrigin === "standing-order",
      ),
    ).toBe(true);

    const restored = deserializeSave(serializeSave(started, 123));
    expect(restored.queueEntries?.[0]?.workOrigin).toBe("standing-order");
    expect(
      restored.activeTasks.every(
        (task) => task.workOrigin === "standing-order",
      ),
    ).toBe(true);

    const completed = advanceGame(
      restored,
      projection.durationMs * 1.05,
      "foreground",
    );
    const standingEvent = completed.intervalReport.completionEvents?.find(
      (event) =>
        event.source === "standing-order" &&
        event.workId === "compileCode",
    );
    expect(standingEvent).toEqual(
      expect.objectContaining({
        source: "standing-order",
        workId: "compileCode",
        completionCount: 1,
      }),
    );
    expect(completed.state.standingTaskCompletions.compileCode).toBe(1);
    expect(completed.state.standingTaskRewardCreditsEarned.compileCode).toBe(
      standingEvent?.creditsEarned,
    );
    const completedRestored = deserializeSave(serializeSave(completed.state, 321));
    expect(completedRestored.standingTaskCompletions).toEqual(
      completed.state.standingTaskCompletions,
    );
    expect(completedRestored.standingTaskRewardCreditsEarned).toEqual(
      completed.state.standingTaskRewardCreditsEarned,
    );
    expect(completedRestored.standingTaskDataEarned).toEqual(
      completed.state.standingTaskDataEarned,
    );
    expect(completedRestored.standingTaskWorkCyclesCompleted).toEqual(
      completed.state.standingTaskWorkCyclesCompleted,
    );

    const envelope = JSON.parse(serializeSave(started, 456)) as {
      state: GameState;
    };
    const corruptOrigin = (work: { workOrigin?: unknown }) => {
      work.workOrigin = "spoofed-public-origin";
    };
    envelope.state.activeTasks.forEach(corruptOrigin);
    envelope.state.queueEntries?.forEach(corruptOrigin);
    Object.values(envelope.state.coreSchedulers).forEach((scheduler) =>
      scheduler.localQueueEntries?.forEach(corruptOrigin),
    );
    envelope.state.systems.forEach((system) => {
      system.activeTasks.forEach(corruptOrigin);
      system.queueEntries?.forEach(corruptOrigin);
      Object.values(system.coreSchedulers).forEach((scheduler) =>
        scheduler.localQueueEntries?.forEach(corruptOrigin),
      );
    });
    envelope.state.standingTaskCompletions = {
      compileCode: -5,
      invalidTask: 10,
    } as GameState["standingTaskCompletions"];
    envelope.state.standingTaskRewardCreditsEarned = {
      compileCode: "not-an-amount",
    } as GameState["standingTaskRewardCreditsEarned"];
    envelope.state.standingTaskDataEarned = {
      compileCode: "-50",
    } as GameState["standingTaskDataEarned"];
    envelope.state.standingTaskWorkCyclesCompleted = {
      compileCode: "not-an-amount",
    } as GameState["standingTaskWorkCyclesCompleted"];
    const repaired = deserializeSave(JSON.stringify(envelope));
    expect(repaired.activeTasks.every((task) => !task.workOrigin)).toBe(true);
    expect(repaired.queueEntries?.every((entry) => !entry.workOrigin)).toBe(true);
    expect(
      Object.values(repaired.coreSchedulers)
        .flatMap((scheduler) => scheduler.localQueueEntries ?? [])
        .every((entry) => !entry.workOrigin),
    ).toBe(true);
    expect(repaired.standingTaskCompletions).toEqual({});
    expect(repaired.standingTaskRewardCreditsEarned).toEqual({});
    expect(repaired.standingTaskDataEarned).toEqual({ compileCode: "0" });
    expect(repaired.standingTaskWorkCyclesCompleted).toEqual({});
  });
});
