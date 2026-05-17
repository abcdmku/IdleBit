import { describe, expect, it } from "vitest";
import {
  applyAction,
  createInitialGameState,
  deriveVisibleState,
  deserializeSave,
  tickGame,
} from "./index";
import { getTaskDefinition } from "./content/tasks";
import {
  getCacheLoadCycles,
  getCacheLoadCyclesForBits,
  getCacheLoadRate,
  getRamLoadCycles,
  getRamLoadRate,
} from "./math";
import { getClockHz } from "./progression";
import type { GameState, ResearchId, TaskId, UpgradeId } from "./types";

const finishActiveTasks = (state: GameState) => {
  let nextState = state;
  let guard = 0;

  while (nextState.activeTasks.length > 0 && guard < 6000) {
    nextState = tickGame(nextState, 500);
    guard += 1;
  }

  expect(nextState.activeTasks).toHaveLength(0);
  return nextState;
};

const runTask = (state: GameState, taskId: TaskId) =>
  finishActiveTasks(applyAction(state, { type: "startTask", taskId }));

const repeatTask = (state: GameState, taskId: TaskId, times: number) => {
  let nextState = state;

  for (let index = 0; index < times; index += 1) {
    nextState = runTask(nextState, taskId);
  }

  return nextState;
};

const buy = (state: GameState, upgradeId: UpgradeId, coreId?: number) =>
  applyAction(state, { type: "buyUpgrade", upgradeId, coreId });

const research = (state: GameState, researchId: ResearchId) =>
  applyAction(state, { type: "buyResearch", researchId });

const fund = (state: GameState): GameState => ({
  ...state,
  resources: { credits: 20_000, data: 20_000 },
});

const withSchedulerSlots = (state: GameState, schedulerSlots: number): GameState => ({
  ...state,
  hardware: {
    ...state.hardware,
    schedulerSlots,
  },
});

const completeStarterLadder = () => {
  let state = createInitialGameState();

  state = repeatTask(state, "fetchBit", 3);
  state = research(state, "decodeLogic");
  state = repeatTask(state, "fetchBit", 18);
  state = buy(state, "cache");
  state = runTask(state, "decodeBit");
  state = runTask(state, "bitFlip");
  state = runTask(state, "bitShift");
  state = runTask(state, "decodeBit");
  state = research(state, "byteOperations");
  state = fund(state);
  state = buy(state, "cache");
  state = buy(state, "cache");
  state = buy(state, "cache");
  state = runTask(state, "byteCopy");
  state = runTask(state, "byteCopy");

  return state;
};

const withExactByteCopyCache = (state: GameState): GameState => {
  const byteCopy = getTaskDefinition("byteCopy");

  return {
    ...state,
    flags: {
      ...state.flags,
      basicQueue: true,
    },
    hardware: {
      ...state.hardware,
      cores: Math.max(2, state.hardware.cores),
      coreClockLevels: {
        ...state.hardware.coreClockLevels,
        2: state.hardware.coreClockLevels[2] ?? state.hardware.clockLevel,
      },
      cacheBits: byteCopy.cacheNeedBits,
      cacheBytes: byteCopy.cacheNeedBytes,
    },
  };
};

const unlockCache = () => research(completeStarterLadder(), "cacheMapping");

const unlockBenchmarks = () => {
  let state = fund(unlockCache());

  state = buy(buy(state, "clock"), "clock");
  state = buy(buy(state, "cache"), "cache");
  state = runTask(state, "packetCheck");
  state = research(state, "benchmarkHarness");

  return state;
};

const unlockMultiCore = () => {
  let state = unlockBenchmarks();

  state = runTask(state, "microBenchmark");
  state = runTask(state, "parallelismBenchmark");
  state = research(state, "multiCore");

  return fund(state);
};

const unlockKernelScheduler = () => {
  let state = unlockMultiCore();

  state = buy(buy(buy(state, "core"), "core"), "core");
  state = research(state, "localScheduler");
  state = research(state, "kernelScheduler");

  return fund(state);
};

const unlockSystemStats = () => {
  let state = unlockKernelScheduler();

  state = runTask(state, "multiCoreBenchmark");
  state = research(state, "systemBus");
  state = buy(state, "secondCpu");

  return fund(state);
};

describe("IdleBit simulation", () => {
  it("starts at 1 Hz with bit-scale cache and a filtered catalog", () => {
    const state = createInitialGameState();
    const visible = deriveVisibleState(state);

    expect(state.hardware.clockHz).toBe(1);
    expect(state.hardware.cacheBits).toBe(1);
    expect(state.hardware.cacheBytes).toBe(1);
    expect(getCacheLoadRate(state, 1)).toBe(1);
    expect(state.hardware.ramBits).toBe(0);
    expect(state.hardware.ramSpeedMt).toBe(1);
    expect(getRamLoadRate(state)).toBe(1);
    expect(state.hardware.cores).toBe(1);
    expect(state.hardware.schedulerSlots).toBe(0);
    expect(visible.stage).toBe("primitiveCpu");
    expect(visible.flags.systemStats).toBe(false);
    expect(visible.tasks.map((task) => task.id)).toEqual([
      "fetchBit",
      "decodeBit",
    ]);
    expect(visible.tasks.find((task) => task.id === "fetchBit")?.cacheNeedBits).toBe(1);
    expect(visible.tasks.find((task) => task.id === "fetchBit")?.canStart).toBe(true);
    expect(visible.tasks.find((task) => task.id === "decodeBit")?.cacheNeedBits).toBe(2);
    expect(visible.tasks.find((task) => task.id === "decodeBit")?.canStart).toBe(false);
    expect(visible.tasks.find((task) => task.id === "decodeBit")?.blockedReason).toBe(
      "Cache capacity too low.",
    );
    expect(visible.research).toEqual([]);
    expect(visible.upgrades.map((upgrade) => upgrade.id)).toEqual([
      "clock",
      "cache",
      "cacheSpeed",
    ]);
  });

  it("reveals grouped starter tasks and research", () => {
    let state = createInitialGameState();
    let visible = deriveVisibleState(state);

    expect(visible.tasks.map((task) => task.id)).toEqual([
      "fetchBit",
      "decodeBit",
    ]);
    expect(visible.research.map((item) => item.id)).toEqual([]);

    state = runTask(state, "fetchBit");
    visible = deriveVisibleState(state);
    expect(visible.research.map((item) => item.id)).toEqual(["decodeLogic"]);
    expect(visible.research[0]?.canAfford).toBe(false);

    state = repeatTask(state, "fetchBit", 2);
    visible = deriveVisibleState(state);
    expect(visible.research[0]?.canAfford).toBe(true);
    state = research(state, "decodeLogic");
    visible = deriveVisibleState(state);
    expect(visible.tasks.map((task) => task.id)).toContain("bitFlip");
    expect(visible.tasks.map((task) => task.id)).toContain("bitShift");
    expect(visible.tasks.find((task) => task.id === "bitFlip")?.cacheNeedBits).toBe(1);
    expect(visible.tasks.find((task) => task.id === "bitFlip")?.canStart).toBe(true);
    expect(visible.tasks.find((task) => task.id === "bitShift")?.cacheNeedBits).toBe(1);
    expect(visible.tasks.find((task) => task.id === "bitShift")?.canStart).toBe(true);
    expect(visible.research.map((item) => item.id)).toContain("byteOperations");
    expect(visible.research.map((item) => item.id)).not.toContain("bitMutation");
    expect(visible.research.map((item) => item.id)).not.toContain("shiftOperations");

    state = repeatTask(state, "fetchBit", 18);
    state = buy(state, "cache");
    state = runTask(state, "decodeBit");
    state = runTask(state, "bitFlip");
    state = runTask(state, "bitShift");
    state = runTask(state, "decodeBit");
    state = research(state, "byteOperations");

    visible = deriveVisibleState(state);
    expect(visible.tasks.map((task) => task.id)).toContain("byteCopy");
    expect(visible.tasks.map((task) => task.id)).not.toContain("packetCheck");
  });

  it("derives task subtask DAG data from operation requirements", () => {
    const state = createInitialGameState();
    const visible = deriveVisibleState(state);
    const decodeBit = visible.tasks.find((task) => task.id === "decodeBit");

    expect(decodeBit?.subtasks.map((node) => node.id)).toEqual([
      "decodeBit:recipe:fetch-token",
      "decodeBit:recipe:decode-token",
    ]);
    expect(decodeBit?.subtasks.map((node) => node.kind)).toEqual([
      "recipe",
      "recipe",
    ]);
    expect(decodeBit?.subtasks[0]?.operations.map((operation) => operation.name)).toEqual([
      "Fetch Token",
    ]);
    expect(decodeBit?.subtasks[0]?.cacheBits).toBe(1);
    expect(decodeBit?.subtasks[1]?.operations.map((operation) => operation.name)).toEqual([
      "Decode Bit",
    ]);
    expect(decodeBit?.subtasks[1]?.cacheBits).toBe(2);
    expect(decodeBit?.dagNodes.map((node) => node.kind)).toEqual([
      "accept",
      "cacheLoad",
      "execute",
      "cacheLoad",
      "execute",
      "complete",
    ]);
    expect(decodeBit?.dagNodes[1]?.cacheBits).toBe(1);
    expect(decodeBit?.dagNodes[1]?.dependsOn).toEqual(["decodeBit:accept"]);
    expect(decodeBit?.dagNodes[2]?.dependsOn).toEqual([
      "decodeBit:cache:fetch-token",
    ]);
    expect(decodeBit?.dagNodes[3]?.cacheBits).toBe(2);
    expect(decodeBit?.dagNodes[3]?.dependsOn).toEqual([
      "decodeBit:execute:fetch-token",
    ]);
    expect(decodeBit?.dagNodes[4]?.dependsOn).toEqual([
      "decodeBit:cache:decode-token",
    ]);
    expect(decodeBit?.operationCount).toBe(2);
    expect(decodeBit?.subtaskCount).toBe(decodeBit?.subtasks.length);
  });

  it("keeps task recipes from flattening previous task operations", () => {
    const taskIds: TaskId[] = [
      "bitShift",
      "byteCopy",
      "packetCheck",
      "microBenchmark",
      "parallelismBenchmark",
      "multiCoreBenchmark",
    ];

    for (const taskId of taskIds) {
      const task = getTaskDefinition(taskId);

      expect(task.operations.every((operation) => operation.id.startsWith(`${taskId}:`))).toBe(
        true,
      );
    }
  });

  it("models Byte Copy as counted bit-scale work", () => {
    const task = getTaskDefinition("byteCopy");

    expect(task.operations.map((operation) => operation.count)).toEqual([8, 8]);
    expect(task.operations.map((operation) => operation.memoryAction)).toEqual([
      "read",
      "write",
    ]);
    expect(task.operations.map((operation) => operation.name)).toEqual([
      "Read 8 Bits",
      "Write 8 Bits",
    ]);
    expect(task.operationCount).toBe(16);
    expect(task.requiredCycles).toBe(16);
    expect(task.rewardCredits).toBe(16);
    expect(task.cacheNeedBits).toBe(16);
    expect(task.subtasks.map((node) => node.cacheBits)).toEqual([8, 8]);
  });

  it("sums write cache footprints while reusing overwrite footprints", () => {
    expect(getTaskDefinition("fetchBit").cacheNeedBits).toBe(1);
    expect(getTaskDefinition("decodeBit").cacheNeedBits).toBe(2);
    expect(getTaskDefinition("bitFlip").cacheNeedBits).toBe(1);
    expect(getTaskDefinition("bitShift").cacheNeedBits).toBe(1);
    expect(getTaskDefinition("byteCopy").cacheNeedBits).toBe(16);
    expect(getTaskDefinition("packetCheck").cacheNeedBits).toBe(2);
    expect(getTaskDefinition("tinyChecksum").cacheNeedBits).toBe(4);
    expect(getTaskDefinition("microBenchmark").cacheNeedBits).toBe(4);
    expect(getTaskDefinition("parallelismBenchmark").cacheNeedBits).toBe(4);
    expect(getTaskDefinition("multiCoreBenchmark").cacheNeedBits).toBe(8);
  });

  it("loads counted Byte Copy cache by touched bits rather than count squared", () => {
    const initial = createInitialGameState();
    let state = fund({
      ...initial,
      research: {
        completed: ["byteOperations"],
      },
      hardware: {
        ...initial.hardware,
        clockLevel: 5,
        clockHz: getClockHz(5),
        coreClockLevels: {
          1: 5,
        },
        cacheLevel: 5,
        cacheBits: 16,
        cacheBytes: 2,
        cacheSpeedLevel: 5,
      },
    });
    const task = getTaskDefinition("byteCopy");
    const readOperation = task.operations[0]!;
    const loadSeconds =
      getCacheLoadCycles(state, readOperation) / getCacheLoadRate(state, 1);

    expect(getCacheLoadRate(state, 1)).toBe(4.4);
    expect(readOperation.cacheBits).toBe(8);
    expect(getCacheLoadCycles(state, readOperation)).toBe(
      getCacheLoadCyclesForBits(state, 8),
    );
    expect(loadSeconds).toBeLessThan(2.5);

    state = applyAction(state, { type: "startTask", taskId: "byteCopy" });
    expect(state.activeTasks[0]?.coreOperations[0]?.operationIndex).toBe(0);

    let elapsedMs = 0;
    while (
      state.activeTasks[0]?.coreOperations[0]?.operationIndex === 0 &&
      elapsedMs <= 3000
    ) {
      state = tickGame(state, 100);
      elapsedMs += 100;
    }

    expect(state.activeTasks[0]?.coreOperations[0]?.operationIndex).toBe(1);
    expect(elapsedMs).toBeLessThanOrEqual(2500);
  });

  it("keeps Byte Copy read and write cache footprints resident together", () => {
    const initial = createInitialGameState();
    let state = fund({
      ...initial,
      research: {
        completed: ["byteOperations"],
      },
      hardware: {
        ...initial.hardware,
        clockLevel: 5,
        clockHz: getClockHz(5),
        coreClockLevels: {
          1: 5,
        },
        cacheLevel: 5,
        cacheBits: 16,
        cacheBytes: 2,
        cacheSpeedLevel: 5,
      },
    });

    state = applyAction(state, { type: "startTask", taskId: "byteCopy" });

    let guard = 0;
    while (
      state.activeTasks[0]?.coreOperations[0]?.operationIndex === 0 &&
      guard < 60
    ) {
      state = tickGame(state, 100);
      guard += 1;
    }

    const visible = deriveVisibleState(state);
    const residency = visible.metrics.cacheResidency;

    expect(visible.activeTasks[0]?.activeOperationName).toBe("Write 8 Bits");
    expect(visible.metrics.cacheUsedBits).toBe(16);
    expect(residency).toHaveLength(2);
    expect(residency[0]).toEqual(
      expect.objectContaining({
        bits: 8,
        memoryAction: "read",
        state: "loaded",
      }),
    );
    expect(residency[1]).toEqual(
      expect.objectContaining({
        bits: 8,
        memoryAction: "write",
        state: "buffering",
      }),
    );
  });

  it("reuses cache residency for overwrite operations", () => {
    let state: GameState = {
      ...createInitialGameState(),
      research: {
        completed: ["decodeLogic"],
      },
    };

    state = applyAction(state, { type: "startTask", taskId: "bitFlip" });
    state = tickGame(state, 1000);

    const visible = deriveVisibleState(state);
    const residency = visible.metrics.cacheResidency;

    expect(visible.activeTasks[0]?.activeOperationName).toBe("Overwrite Bit");
    expect(visible.metrics.cacheUsedBits).toBe(1);
    expect(residency).toHaveLength(1);
    expect(residency[0]).toEqual(
      expect.objectContaining({
        bits: 1,
        memoryAction: "overwrite",
      }),
    );
  });

  it("keeps memory operations explicit and cache-backed", () => {
    const taskIds: TaskId[] = [
      "fetchBit",
      "decodeBit",
      "bitFlip",
      "bitShift",
      "byteCopy",
      "packetCheck",
      "tinyChecksum",
      "multiCoreBenchmark",
    ];

    for (const taskId of taskIds) {
      const task = getTaskDefinition(taskId);

      for (const operation of task.operations) {
        if (operation.kind !== "memory") continue;

        expect(operation.memoryAction).toMatch(/^(read|write|overwrite)$/);
        expect(operation.cacheBits).toBeGreaterThanOrEqual(operation.count);
        expect(operation.cycles).toBeGreaterThanOrEqual(operation.count);
      }
    }
  });

  it("keeps memory buffer and cache load aligned at equal rates", () => {
    let state = applyAction(createInitialGameState(), {
      type: "startTask",
      taskId: "fetchBit",
    });

    let visibleOperation = deriveVisibleState(state).activeTasks[0]?.coreProgress[0];

    expect(visibleOperation?.memoryAction).toBe("read");
    expect(visibleOperation?.status).toBe("loadingCache");
    expect(visibleOperation?.cacheBits).toBe(1);
    expect(visibleOperation?.remainingCycles).toBe(1);
    expect(visibleOperation?.totalCycles).toBe(1);
    expect(deriveVisibleState(state).metrics.cacheUsedBits).toBe(1);

    state = tickGame(state, 500);

    visibleOperation = deriveVisibleState(state).activeTasks[0]?.coreProgress[0];
    expect(visibleOperation?.status).toBe("loadingCache");
    expect(visibleOperation?.memoryAction).toBe("read");
    expect(visibleOperation?.remainingCycles).toBeCloseTo(0.5);
    expect(visibleOperation?.remainingLoadCycles).toBeCloseTo(0.5);
    expect(visibleOperation?.totalCycles).toBe(1);

    state = tickGame(state, 500);
    expect(state.activeTasks).toHaveLength(0);
  });

  it("does not reserve cache for queued tasks before they start", () => {
    const state: GameState = {
      ...createInitialGameState(),
      queue: ["fetchBit"],
    };

    expect(deriveVisibleState(state).metrics.cacheUsedBits).toBe(0);
  });

  it("releases cache residency after task completion", () => {
    const state = runTask(createInitialGameState(), "fetchBit");
    const visible = deriveVisibleState(state);

    expect(visible.metrics.cacheUsedBits).toBe(0);
    expect(visible.metrics.cacheResidency).toEqual([]);
  });

  it("clears legacy completed-task cache residency from saves", () => {
    const savedState: GameState = {
      ...createInitialGameState(),
      cacheResidency: [
        {
          coreId: 1,
          bits: 1,
          memoryAction: "read",
        },
      ],
    };
    const restored = deserializeSave(
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        state: savedState,
      }),
    );

    expect(restored.cacheResidency).toEqual([]);
    expect(deriveVisibleState(restored).metrics.cacheResidency).toEqual([]);
  });

  it("completes the starter ladder and gates cache behind byte operations", () => {
    let state = completeStarterLadder();

    expect(state.completedTasks.fetchBit).toBe(21);
    expect(state.completedTasks.decodeBit).toBe(2);
    expect(state.completedTasks.bitFlip).toBe(1);
    expect(state.completedTasks.bitShift).toBe(1);
    expect(state.completedTasks.byteCopy).toBe(2);
    expect(state.flags.cache).toBe(false);

    state = research(state, "cacheMapping");

    expect(state.flags.cache).toBe(true);
    expect(deriveVisibleState(state).tasks.map((task) => task.id)).toContain(
      "packetCheck",
    );
  });

  it("uses cache and RAM fit gates for starting and queueing tasks", () => {
    let state = fund(unlockCache());

    const lowCacheState = {
      ...state,
      hardware: {
        ...state.hardware,
        cacheBits: 1,
        cacheBytes: 1,
      },
    };
    expect(applyAction(lowCacheState, { type: "startTask", taskId: "packetCheck" }).activeTasks).toHaveLength(0);
    expect(
      deriveVisibleState(lowCacheState).tasks.find((task) => task.id === "packetCheck")
        ?.blockedReason,
    ).toBe("Cache capacity too low.");

    state = applyAction(state, { type: "startTask", taskId: "packetCheck" });
    expect(state.activeTasks).toHaveLength(1);

    const lowRamSystem = unlockSystemStats();
    state = {
      ...lowRamSystem,
      flags: { ...lowRamSystem.flags, basicQueue: true },
      hardware: {
        ...lowRamSystem.hardware,
        schedulerSlots: 1,
        ramBits: 4,
        ramBytes: 1,
      },
    };
    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });
    expect(state.queue).toHaveLength(0);

    const parallelState = unlockKernelScheduler();
    const lowParallelCacheState = {
      ...parallelState,
      hardware: {
        ...parallelState.hardware,
        cacheBits: 4,
        cacheBytes: 1,
      },
    };
    expect(
      applyAction(lowParallelCacheState, {
        type: "startTask",
        taskId: "multiCoreBenchmark",
      }).activeTasks,
    ).toHaveLength(0);
    expect(
      deriveVisibleState(lowParallelCacheState)
        .research.find((item) => item.id === "systemBus")
        ?.computeTasks.find((task) => task.id === "multiCoreBenchmark")
        ?.blockedReason,
    ).toBe("Cache capacity too low.");
  });

  it("uses free RAM instead of total RAM when starting tasks manually", () => {
    let state = unlockSystemStats();

    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "tinyChecksum",
      coreId: 1,
    });

    expect(state.activeTasks).toHaveLength(1);
    expect(state.activeTasks[0]?.coreOperations[0]?.memoryReservedBits).toBe(8);

    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "tinyChecksum",
      coreId: 2,
    });

    const visible = deriveVisibleState(state);

    expect(state.activeTasks).toHaveLength(1);
    expect(state.activeTasks.flatMap((task) => task.coreOperations)).not.toContainEqual(
      expect.objectContaining({ status: "waitingMemory" }),
    );
    expect(visible.tasks.find((task) => task.id === "tinyChecksum")?.canStart).toBe(
      false,
    );
    expect(
      visible.tasks.find((task) => task.id === "tinyChecksum")?.blockedReason,
    ).toBe("Not enough free RAM.");
  });

  it("keeps queued scheduler tasks pending until RAM is free", () => {
    let state = unlockSystemStats();

    state = buy(state, "schedulerSlot");
    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "tinyChecksum",
      coreId: 1,
    });
    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });

    expect(state.queue).toEqual(["tinyChecksum"]);
    expect(state.activeTasks).toHaveLength(1);

    state = tickGame(state, 16);

    expect(state.queue).toEqual(["tinyChecksum"]);
    expect(state.activeTasks).toHaveLength(1);
    expect(state.activeTasks.flatMap((task) => task.coreOperations)).not.toContainEqual(
      expect.objectContaining({ status: "waitingMemory" }),
    );
  });

  it("uses free cache instead of total cache when starting tasks manually", () => {
    let state = withExactByteCopyCache(completeStarterLadder());

    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "byteCopy",
      coreId: 1,
    });

    expect(state.activeTasks).toHaveLength(1);

    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "byteCopy",
      coreId: 2,
    });

    const visible = deriveVisibleState(state);

    expect(state.activeTasks).toHaveLength(1);
    expect(visible.tasks.find((task) => task.id === "byteCopy")?.canStart).toBe(
      false,
    );
    expect(visible.tasks.find((task) => task.id === "byteCopy")?.blockedReason).toBe(
      "Not enough free cache.",
    );
  });

  it("keeps queued scheduler tasks pending until cache is free", () => {
    let state = withSchedulerSlots(withExactByteCopyCache(completeStarterLadder()), 1);

    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "byteCopy",
      coreId: 1,
    });
    state = applyAction(state, { type: "queueTask", taskId: "byteCopy" });

    expect(state.queue).toEqual(["byteCopy"]);
    expect(state.activeTasks).toHaveLength(1);

    state = tickGame(state, 16);

    expect(state.queue).toEqual(["byteCopy"]);
    expect(state.activeTasks).toHaveLength(1);
  });

  it("runs benchmark compute from research cards instead of the task catalog", () => {
    let state = unlockBenchmarks();
    let visible = deriveVisibleState(state);
    let multiCoreResearch = visible.research.find((item) => item.id === "multiCore");

    expect(visible.tasks.map((task) => task.id)).not.toContain("microBenchmark");
    expect(visible.tasks.map((task) => task.id)).not.toContain(
      "parallelismBenchmark",
    );
    expect(multiCoreResearch?.requirements.map((item) => item.label)).toEqual([
      "Complete Benchmark Harness research",
      "Upgrade a core clock to level 3",
      "Upgrade cache capacity to level 3",
      "Run Micro Benchmark",
      "Run Parallelism Benchmark",
    ]);
    expect(multiCoreResearch?.computeTasks.map((task) => task.id)).toEqual([
      "microBenchmark",
      "parallelismBenchmark",
    ]);
    expect(multiCoreResearch?.computeTasks[0]?.canStart).toBe(true);
    expect(multiCoreResearch?.computeTasks[1]?.canStart).toBe(false);

    state = runTask(state, "microBenchmark");
    visible = deriveVisibleState(state);
    multiCoreResearch = visible.research.find((item) => item.id === "multiCore");

    expect(multiCoreResearch?.computeTasks[0]?.completed).toBe(true);
    expect(multiCoreResearch?.computeTasks[0]?.progress).toBe(1);
    expect(multiCoreResearch?.computeTasks[1]?.canStart).toBe(true);

    state = runTask(state, "parallelismBenchmark");
    visible = deriveVisibleState(state);
    multiCoreResearch = visible.research.find((item) => item.id === "multiCore");

    expect(multiCoreResearch?.canBuy).toBe(true);
    expect(multiCoreResearch?.blockedReason).toBeNull();
  });

  it("keeps scheduler unlocks in research instead of upgrade shortcuts", () => {
    let state = unlockMultiCore();

    state = buy(state, "core");

    const visible = deriveVisibleState(state);
    const upgrades = visible.upgrades.map((upgrade) => upgrade.id);
    const localScheduler = visible.research.find(
      (item) => item.id === "localScheduler",
    );

    expect(upgrades).not.toContain("basicQueue");
    expect(upgrades).not.toContain("scheduler");
    expect(localScheduler?.canBuy).toBe(true);
    expect(localScheduler?.requirements.every((item) => item.met)).toBe(true);
  });

  it("requires purchased scheduler slots before queueing tasks", () => {
    let state = unlockMultiCore();

    state = buy(state, "core");
    state = research(state, "localScheduler");

    let visible = deriveVisibleState(state);
    let fetchBit = visible.tasks.find((task) => task.id === "fetchBit");

    expect(state.hardware.schedulerSlots).toBe(0);
    expect(visible.upgrades.map((upgrade) => upgrade.id)).toContain("schedulerSlot");
    expect(fetchBit?.canQueue).toBe(false);
    expect(fetchBit?.queueBlockedReason).toBe("Buy scheduler slots.");

    state = applyAction(state, { type: "queueTask", taskId: "fetchBit" });

    expect(state.queue).toEqual([]);

    state = buy(state, "schedulerSlot");
    visible = deriveVisibleState(state);
    fetchBit = visible.tasks.find((task) => task.id === "fetchBit");

    expect(state.hardware.schedulerSlots).toBe(1);
    expect(fetchBit?.canQueue).toBe(true);

    state = applyAction(state, { type: "queueTask", taskId: "fetchBit" });
    visible = deriveVisibleState(state);

    expect(state.queue).toEqual(["fetchBit"]);
    expect(
      visible.tasks.find((task) => task.id === "decodeBit")?.queueBlockedReason,
    ).toBe("Scheduler slots full.");
  });

  it("loads cache before executing operation cycles", () => {
    let state = fund(unlockCache());
    state = buy(state, "cache");
    state = applyAction(state, { type: "startTask", taskId: "packetCheck" });

    const loading = state.activeTasks[0]?.coreOperations[0];
    expect(loading?.status).toBe("loadingCache");
    expect(loading?.memoryReservedBits).toBe(0);
    expect(loading?.remainingCycles).toBe(8);

    state = tickGame(state, 10);

    const stillLoading = state.activeTasks[0]?.coreOperations[0];
    expect(stillLoading?.status).toBe("loadingCache");
    expect(stillLoading?.memoryReservedBits).toBe(0);
    expect(stillLoading?.remainingCycles).toBeLessThan(8);
    expect(stillLoading?.remainingLoadCycles).toBeLessThan(
      loading?.remainingLoadCycles ?? 0,
    );
  });

  it("stages cache loads at the operation that needs them", () => {
    let state = fund(createInitialGameState());
    state = buy(state, "cache");
    state = applyAction(state, { type: "startTask", taskId: "decodeBit" });

    const task = getTaskDefinition("decodeBit");
    const firstLoad = state.activeTasks[0]?.coreOperations[0];

    expect(firstLoad?.operationName).toBe("Fetch Token");
    expect(firstLoad?.status).toBe("loadingCache");
    expect(firstLoad?.totalLoadCycles).toBe(
      getCacheLoadCycles(state, task.operations[0]!),
    );

    state = tickGame(state, 1000);

    const secondLoad = state.activeTasks[0]?.coreOperations[0];
    expect(secondLoad?.operationName).toBe("Decode Bit");
    expect(secondLoad?.status).toBe("loadingCache");
    expect(secondLoad?.totalLoadCycles).toBe(
      getCacheLoadCycles(state, task.operations[1]!),
    );
  });

  it("separates whole-task progress from CPU execution progress", () => {
    let state = applyAction(createInitialGameState(), {
      type: "startTask",
      taskId: "fetchBit",
    });

    state = {
      ...state,
      hardware: {
        ...state.hardware,
        clockLevel: 2,
        clockHz: getClockHz(2),
        coreClockLevels: {
          1: 2,
        },
      },
    };
    state = tickGame(state, 700);

    let activeTask = deriveVisibleState(state).activeTasks[0];
    expect(activeTask?.memoryState).toBe("cacheLoad");
    expect(activeTask?.progress).toBeGreaterThan(0);
    expect(activeTask?.coreProgress[0]?.progress).toBe(1);

    state = fund(createInitialGameState());
    state = buy(state, "cache");
    state = applyAction(state, { type: "startTask", taskId: "decodeBit" });

    for (let tick = 0; tick < 4; tick += 1) {
      state = tickGame(state, 1000);
    }

    activeTask = deriveVisibleState(state).activeTasks[0];
    expect(activeTask?.activeOperationName).toBe("Decode Bit");
    expect(activeTask?.progress).toBeGreaterThan(0.7);
    expect(activeTask?.progress).toBeLessThan(1);
  });

  it("unlocks the vertical slice through scheduler and 8 b RAM reveal", () => {
    let state = unlockMultiCore();

    expect(state.flags.multiCore).toBe(true);

    state = buy(buy(buy(state, "core"), "core"), "core");

    expect(state.hardware.cores).toBe(4);
    expect(state.flags.scheduler).toBe(false);

    state = research(state, "localScheduler");
    state = research(state, "kernelScheduler");

    expect(state.flags.scheduler).toBe(true);

    state = runTask(state, "multiCoreBenchmark");

    expect(state.flags.secondCpu).toBe(false);

    state = research(fund(state), "systemBus");
    state = buy(state, "secondCpu");

    expect(state.flags.systemStats).toBe(true);
    expect(state.hardware.ramBits).toBe(8);
    expect(state.hardware.ramBytes).toBe(1);
    expect(state.hardware.ramSpeedMt).toBe(1);

    state = buy(state, "ram");

    expect(state.hardware.ramBits).toBe(16);
    expect(state.hardware.ramBytes).toBe(2);
    expect(state.hardware.ramSpeedMt).toBe(2);
  });

  it("loads RAM-backed working sets slower than CPU cache", () => {
    const state = unlockSystemStats();
    const task = getTaskDefinition("tinyChecksum");
    const ramOperation = task.operations.find(
      (operation) => operation.ramBits > 0,
    );

    expect(ramOperation).toBeDefined();
    expect(task.ramNeedBits).toBe(8);
    expect(getRamLoadRate(state)).toBe(1);

    const cacheSeconds =
      getCacheLoadCyclesForBits(state, task.cacheNeedBits) /
      getCacheLoadRate(state, 1);
    const ramSeconds =
      getRamLoadCycles(state, {
        ...ramOperation!,
        cacheBits: task.cacheNeedBits,
        ramBits: task.ramNeedBits,
      }) / getRamLoadRate(state);

    expect(ramSeconds).toBe(task.ramNeedBits);
    expect(ramSeconds).toBeGreaterThan(cacheSeconds);
  });

  it("pulls queued tasks onto multiple cores after local scheduler research", () => {
    let state = unlockMultiCore();

    state = buy(state, "core");
    state = research(state, "localScheduler");
    state = buy(buy(state, "schedulerSlot"), "schedulerSlot");
    state = applyAction(state, { type: "queueTask", taskId: "fetchBit" });
    state = applyAction(state, { type: "queueTask", taskId: "decodeBit" });
    state = tickGame(state, 16);

    expect(state.activeTasks).toHaveLength(2);
    expect(state.queue).toHaveLength(0);
    expect(Object.values(state.coreSchedulers).some((core) => core.status !== "idle")).toBe(true);
  });

  it("starts manual tasks on the selected core", () => {
    let state = unlockMultiCore();

    state = buy(state, "core");
    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "fetchBit",
      coreId: 2,
    });

    expect(state.activeTasks).toHaveLength(1);
    expect(state.activeTasks[0]?.coreId).toBe(2);
  });

  it("upgrades core clock independently per core", () => {
    let state = unlockMultiCore();

    state = buy(state, "core");

    const before = deriveVisibleState(state).metrics.cpuSockets[0]?.cores;
    const beforeCore1 = before?.find((core) => core.id === 1)?.clockHz;
    const beforeCore2 = before?.find((core) => core.id === 2)?.clockHz;

    state = buy(state, "clock", 2);

    const after = deriveVisibleState(state).metrics.cpuSockets[0]?.cores;

    expect(after?.find((core) => core.id === 1)?.clockHz).toBe(beforeCore1);
    expect(after?.find((core) => core.id === 2)?.clockHz).toBeGreaterThan(
      beforeCore2 ?? 0,
    );
  });

  it("allows cache capacity and cache speed upgrades from the start", () => {
    let state = fund(createInitialGameState());
    const beforeRate = getCacheLoadRate(state, 1);

    expect(beforeRate).toBe(1);

    state = buy(state, "cache");
    expect(state.hardware.cacheBits).toBe(2);

    state = buy(state, "cacheSpeed");
    expect(state.hardware.cacheSpeedLevel).toBe(2);
    expect(getCacheLoadRate(state, 1)).toBeGreaterThan(beforeRate);
  });

  it("pays a multicore parent task once after all operation shards complete", () => {
    let state = unlockKernelScheduler();
    const task = getTaskDefinition("multiCoreBenchmark");
    const beforeCredits = state.resources.credits;
    const beforeData = state.resources.data;

    state = runTask(state, "multiCoreBenchmark");

    expect(task.rewardCredits).toBe(task.operationCount);
    expect(state.resources.credits - beforeCredits).toBe(task.rewardCredits);
    expect(state.resources.data - beforeData).toBe(task.rewardData);
    expect(state.completedTasks.multiCoreBenchmark).toBe(1);
  });

  it("reruns a corrupted shard at the multicore barrier deterministically", () => {
    let state = unlockKernelScheduler();

    state = applyAction(state, { type: "startTask", taskId: "multiCoreBenchmark" });
    state = {
      ...state,
      reliability: {
        ...state.reliability,
        corruptionDebt: 1,
      },
    };

    let guard = 0;
    while (state.reliability.totalCorruptions === 0 && guard < 2000) {
      state = tickGame(state, 500);
      guard += 1;
    }

    expect(state.reliability.totalCorruptions).toBe(1);
    expect(state.activeTasks[0]?.reruns).toBeGreaterThan(0);
    expect(deriveVisibleState(state).metrics.memory.reruns).toBeGreaterThan(0);
  });

  it("uses PSU stress for restarts and cooling to improve reliability", () => {
    let state = unlockSystemStats();

    state = runTask(state, "packetCheck");
    state = research(state, "thermalControl");
    state = {
      ...state,
      hardware: {
        ...state.hardware,
        psuWatts: 25,
      },
    };
    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });

    const beforeCooling = deriveVisibleState(state).metrics.restartReliability;

    state = buy(state, "cooling");

    expect(deriveVisibleState(state).metrics.restartReliability).toBeGreaterThan(
      beforeCooling,
    );

    state = {
      ...state,
      hardware: {
        ...state.hardware,
        psuWatts: 8,
      },
    };

    let guard = 0;
    while (state.reliability.totalRestarts === 0 && guard < 20) {
      state = tickGame(state, 1000);
      guard += 1;
    }

    expect(state.reliability.totalRestarts).toBeGreaterThan(0);
    expect(deriveVisibleState(state).metrics.memory.restarts).toBeGreaterThan(0);
  });

  it("keeps cheap job action aliases for compatibility", () => {
    let state = createInitialGameState();

    state = finishActiveTasks(
      applyAction(state, { type: "startJob", jobId: "fetchBit" }),
    );

    expect(state.completedTasks.fetchBit).toBe(1);
    expect(state.completedJobs.fetchBit).toBe(1);
  });
});
