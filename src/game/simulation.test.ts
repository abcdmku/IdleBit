import { describe, expect, it } from "vitest";
import {
  applyAction,
  createInitialGameState,
  createRackReadyGameState,
  deriveVisibleState,
  deserializeSave,
  tickGame,
} from "./index";
import { getTaskDefinition, taskDefinitions } from "./content/tasks";
import { componentSkus, getComponentSku, getMachineTemplate } from "./content/machines";
import {
  getCacheLoadCycles,
  getCacheLoadCyclesForBits,
  getCacheLoadRate,
  getHardwareDrawWatts,
  getPowerCostPerSecond,
  getPsuStress,
  getRamLoadCycles,
  getRamLoadRate,
} from "./math";
import {
  createRamStickState,
  createSchedulerConfig,
  getClockHz,
  getRamBits,
  getRamSpeedMt,
  POWER_BOOTSTRAP_GRACE_SECONDS,
  syncCoreSchedulers,
} from "./progression";
import type {
  GameState,
  OperationRuntimeStatus,
  ResearchId,
  SchedulerPolicy,
  TaskDefinition,
  TaskId,
  TaskOperationDefinition,
  UpgradeId,
} from "./types";

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

const finishActiveTasksWithTicks = (state: GameState) => {
  let nextState = state;
  let ticks = 0;

  while (nextState.activeTasks.length > 0 && ticks < 6000) {
    nextState = tickGame(nextState, 500);
    ticks += 1;
  }

  expect(nextState.activeTasks).toHaveLength(0);
  return { state: nextState, ticks };
};

const runTask = (state: GameState, taskId: TaskId) =>
  finishActiveTasks(applyAction(state, { type: "startTask", taskId }));

const tickUntilTaskOperationStatus = (
  state: GameState,
  taskId: TaskId,
  status: OperationRuntimeStatus,
) => {
  let nextState = state;
  let guard = 0;

  while (
    !nextState.activeTasks.some(
      (task) =>
        task.taskId === taskId &&
        task.coreOperations.some((operation) => operation.status === status),
    ) &&
    guard < 1000
  ) {
    nextState = tickGame(nextState, 500);
    guard += 1;
  }

  expect(
    nextState.activeTasks.some(
      (task) =>
        task.taskId === taskId &&
        task.coreOperations.some((operation) => operation.status === status),
    ),
  ).toBe(true);

  return nextState;
};

const tickUntilDeadlock = (
  state: GameState,
  resource?: "cache" | "ram",
): GameState => {
  let nextState = state;
  let guard = 0;

  while (
    !nextState.activeTasks.some((task) =>
      task.coreOperations.some(
        (operation) =>
          operation.status === "deadlocked" &&
          (resource === undefined || operation.lockResource === resource),
      ),
    ) &&
    guard < 1000
  ) {
    nextState = tickGame(nextState, 1000);
    guard += 1;
  }

  expect(
    nextState.activeTasks.some((task) =>
      task.coreOperations.some(
        (operation) =>
          operation.status === "deadlocked" &&
          (resource === undefined || operation.lockResource === resource),
      ),
    ),
  ).toBe(true);

  return nextState;
};

const repeatTask = (state: GameState, taskId: TaskId, times: number) => {
  let nextState = state;

  for (let index = 0; index < times; index += 1) {
    nextState = runTask(nextState, taskId);
  }

  return nextState;
};

const getTaskCoreCount = (task: TaskDefinition) =>
  task.coreScaling === "chunked" ? 1 : task.maxCores ?? task.minCores;

const getCoreIndexes = (task: TaskDefinition) =>
  Array.from({ length: Math.max(1, getTaskCoreCount(task)) }, (_, index) => index);

const isOperationAssignedToCoreIndex = (
  operation: TaskOperationDefinition,
  coreIndex: number,
) => operation.parallel || operation.kind === "barrier" || coreIndex === 0;

const getOperationAssignedCoreCount = (
  task: TaskDefinition,
  operation: TaskOperationDefinition,
) =>
  getCoreIndexes(task).filter((coreIndex) =>
    isOperationAssignedToCoreIndex(operation, coreIndex),
  ).length;

const getExpectedCpuWork = (task: TaskDefinition) =>
  task.operations.reduce(
    (total, operation) =>
      total + operation.cycles * getOperationAssignedCoreCount(task, operation),
    0,
  );

const getExpectedCacheLoadWork = (task: TaskDefinition) =>
  task.operations.reduce(
    (total, operation) =>
      total + operation.cacheBits * getOperationAssignedCoreCount(task, operation),
    0,
  );

const getExpectedCacheNeedBits = (task: TaskDefinition) => {
  const coreSegments = getCoreIndexes(task).map((): number[] => []);
  let peakBits = 0;

  for (const operation of task.operations) {
    for (const coreIndex of getCoreIndexes(task)) {
      if (!isOperationAssignedToCoreIndex(operation, coreIndex)) continue;
      if (operation.cacheBits <= 0) continue;

      const segments = coreSegments[coreIndex] ?? [];
      const usedBits = segments.reduce((total, bits) => total + bits, 0);

      if (operation.kind === "memory" && operation.memoryAction !== "overwrite") {
        segments.push(operation.cacheBits);
      } else if (operation.cacheBits > usedBits) {
        segments.push(operation.cacheBits - usedBits);
      }
    }

    peakBits = Math.max(
      peakBits,
      coreSegments.reduce(
        (total, segments) =>
          total + segments.reduce((segmentTotal, bits) => segmentTotal + bits, 0),
        0,
      ),
    );
  }

  return peakBits;
};

const getExpectedRamProfile = (task: TaskDefinition) => {
  let coreStates = getCoreIndexes(task).map(() => ({ ready: false, bits: 0 }));
  let loadWork = 0;
  let peakBits = 0;

  for (const operation of task.operations) {
    const activeBits = getCoreIndexes(task).map((coreIndex) => {
      if (!isOperationAssignedToCoreIndex(operation, coreIndex)) return 0;
      if (operation.ramBits <= 0) return 0;

      const state = coreStates[coreIndex] ?? { ready: false, bits: 0 };
      if (!state.ready || state.bits < operation.ramBits) {
        loadWork += operation.ramBits;
      }

      return operation.ramBits;
    });

    peakBits = Math.max(
      peakBits,
      activeBits.reduce((total, bits) => total + bits, 0),
    );

    coreStates = coreStates.map((_state, coreIndex) => {
      if (!isOperationAssignedToCoreIndex(operation, coreIndex)) {
        return { ready: false, bits: 0 };
      }

      if (operation.ramBits <= 0 || !operation.memoryAction) {
        return { ready: false, bits: 0 };
      }

      return { ready: true, bits: operation.ramBits };
    });
  }

  return { loadWork, peakBits };
};

const getExpectedTaskOperationCount = (task: TaskDefinition) =>
  (getExpectedCpuWork(task) +
    getExpectedCacheLoadWork(task) +
    getExpectedRamProfile(task).loadWork) *
  task.workUnitCount;

const tickSeconds = (state: GameState, seconds: number) => {
  let nextState = state;

  for (let elapsed = 0; elapsed < seconds; elapsed += 1) {
    nextState = tickGame(nextState, 1000);
  }

  return nextState;
};

const buy = (
  state: GameState,
  upgradeId: UpgradeId,
  coreId?: number,
  cpuId?: number,
) => applyAction(state, { type: "buyUpgrade", upgradeId, coreId, cpuId });

const buyAllRamStickUpgrade = (state: GameState, upgradeId: UpgradeId) =>
  applyAction(state, {
    type: "buyUpgrade",
    upgradeId,
    ramStickIds: state.hardware.ramSticks.map((stick) => stick.id),
  });

const research = (state: GameState, researchId: ResearchId) =>
  applyAction(state, { type: "buyResearch", researchId });

const fund = (state: GameState): GameState => ({
  ...state,
  resources: { credits: 20_000, data: 20_000 },
});

const withPsuStress = (state: GameState, psuStress: number): GameState => ({
  ...state,
  hardware: {
    ...state.hardware,
    psuWatts: getHardwareDrawWatts(state) / psuStress,
  },
  power: {
    ...state.power,
    bootstrapGraceSeconds: 0,
  },
});

const costAmount = (
  costs: Array<{ resource: "credits" | "data"; amount: number }>,
  resource: "credits" | "data",
) => costs.find((cost) => cost.resource === resource)?.amount ?? 0;

const withSchedulerSlots = (state: GameState, schedulerSlots: number): GameState => ({
  ...state,
  hardware: {
    ...state.hardware,
    schedulerSlots,
    cpus: state.hardware.cpus.map((cpu) =>
      cpu.id === 1 ? { ...cpu, schedulerSlots } : cpu,
    ),
  },
});

const withRamCapacity = (state: GameState, ramBits: number): GameState => ({
  ...state,
  hardware: {
    ...state.hardware,
    ramLevel: ramBits > 0 ? 1 : 0,
    ramBits,
    ramBytes: Math.ceil(ramBits / 8),
    ramSticks:
      ramBits > 0
        ? [
            {
              ...createRamStickState(1, 1, state.hardware.ramSpeedLevel),
              bits: ramBits,
              bytes: Math.ceil(ramBits / 8),
            },
          ]
        : [],
  },
});

const withPrimaryCpuCache = (state: GameState, cacheBits: number): GameState => ({
  ...state,
  hardware: {
    ...state.hardware,
    cacheBits,
    cacheBytes: Math.ceil(cacheBits / 8),
    cpus: state.hardware.cpus.map((cpu) =>
      cpu.id === 1
        ? { ...cpu, cacheBits, cacheBytes: Math.ceil(cacheBits / 8) }
        : cpu,
    ),
  },
});

const withPrimarySchedulerCapacity = (
  state: GameState,
  slotCount: number,
): GameState => {
  const coreIds = Array.from({ length: slotCount }, (_, index) => index + 1);

  return syncCoreSchedulers({
    ...state,
    hardware: {
      ...state.hardware,
      cores: coreIds.length,
      schedulerSlots: slotCount,
      systemSchedulerSlots: slotCount,
      coreClockLevels: {
        ...state.hardware.coreClockLevels,
        ...Object.fromEntries(coreIds.map((coreId) => [coreId, 1])),
      },
      cpus: state.hardware.cpus.map((cpu) =>
        cpu.id === 1
          ? {
              ...cpu,
              coreIds,
              schedulerSlots: slotCount,
            }
          : cpu,
      ),
    },
  });
};

const withPrimaryCpuSchedulerPolicy = (
  state: GameState,
  policy: SchedulerPolicy,
): GameState => ({
  ...state,
  hardware: {
    ...state.hardware,
    cpus: state.hardware.cpus.map((cpu) =>
      cpu.id === 1
        ? {
            ...cpu,
            schedulerConfig: createSchedulerConfig({ policy }),
          }
        : cpu,
    ),
  },
});

const completeStarterLadder = () => {
  let state = createInitialGameState();

  state = repeatTask(state, "fetchBit", 3);
  state = research(state, "decodeLogic");
  state = repeatTask(state, "bitFlip", 3);
  state = repeatTask(state, "bitShift", 3);
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
      cpus: state.hardware.cpus.map((cpu) =>
        cpu.id === 1
          ? {
              ...cpu,
              coreIds: Array.from(
                { length: Math.max(2, state.hardware.cores) },
                (_, index) => index + 1,
              ),
              cacheBits: byteCopy.cacheNeedBits,
              cacheBytes: byteCopy.cacheNeedBytes,
            }
          : cpu,
      ),
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

const unlockRamControl = () => {
  let state = unlockMultiCore();

  state = buy(buy(buy(state, "core"), "core"), "core");
  state = research(state, "localScheduler");
  state = research(state, "ramControl");

  return fund(state);
};

const unlockSystemScheduler = () => {
  let state = unlockRamControl();

  state = buy(state, "ram");
  state = buyAllRamStickUpgrade(state, "ramCapacity");
  state = buyAllRamStickUpgrade(state, "ramCapacity");
  state = buy(state, "schedulerSlot", undefined, 1);
  state = buy(state, "schedulerSlot", undefined, 1);
  state = buy(state, "schedulerSlot", undefined, 1);
  state = buy(state, "schedulerSlot", undefined, 1);
  state = research(state, "systemScheduler");
  state = buy(state, "systemSchedulerSlot");
  state = buy(state, "systemSchedulerSlot");

  return fund(state);
};

const unlockSystemStats = () => {
  let state = unlockSystemScheduler();

  state = runTask(state, "multiCoreBenchmark");
  state = research(state, "systemBus");
  state = buy(state, "matchedCpu");

  return fund(state);
};

describe("IdleBit simulation", () => {
  it("starts at 1 Hz with bit-scale cache before the system catalog", () => {
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
    expect(state.hardware.psuLevel).toBe(1);
    expect(state.hardware.psuWatts).toBeGreaterThan(0);
    expect(state.hardware.schedulerSlots).toBe(0);
    expect(state.hardware.systemSchedulerSlots).toBe(0);
    expect(visible.stage).toBe("primitiveCpu");
    expect(visible.flags.systemStats).toBe(false);
    expect(visible.rack.unlocked).toBe(false);
    expect(visible.rack.systems[0]?.name).toBe("Barebones PC");
    expect(visible.machineBuilder.templates).toEqual([]);
    expect(
      applyAction(state, {
        type: "buyMachineTemplate",
        templateId: "barebonesPc",
      }).systems,
    ).toHaveLength(1);
    expect(visible.metrics.powerUsedWatts).toBeGreaterThan(0);
    expect(visible.metrics.billedPowerWatts).toBe(visible.metrics.powerUsedWatts);
    expect(visible.metrics.powerCostPerSecond).toBeGreaterThan(0);
    expect(visible.metrics.powerBootstrapGraceSeconds).toBe(0);
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
      "psu",
    ]);

    const psuUpgrade = visible.upgrades.find((upgrade) => upgrade.id === "psu");
    expect(psuUpgrade?.costs).toEqual([{ resource: "credits", amount: 24 }]);
    expect(psuUpgrade?.costs.some((cost) => cost.resource === "data")).toBe(false);

    const upgraded = buy(fund(state), "psu");
    expect(upgraded.hardware.psuLevel).toBe(2);
    expect(upgraded.hardware.psuWatts).toBeGreaterThan(state.hardware.psuWatts);
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
    expect(visible.research[0]?.canAfford).toBe(true);

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
    expect(decodeBit?.operationCount).toBe(6);
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

  it("derives task resource needs from per-core operation residency", () => {
    const mismatches = taskDefinitions
      .map((task) => {
        const ramProfile = getExpectedRamProfile(task);

        return {
          taskId: task.id,
          operationCount: task.operationCount,
          expectedOperationCount: getExpectedTaskOperationCount(task),
          cacheNeedBits: task.cacheNeedBits,
          expectedCacheNeedBits: getExpectedCacheNeedBits(task),
          ramNeedBits: task.ramNeedBits,
          expectedRamNeedBits: ramProfile.peakBits,
        };
      })
      .filter(
        (summary) =>
          summary.operationCount !== summary.expectedOperationCount ||
          summary.cacheNeedBits !== summary.expectedCacheNeedBits ||
          summary.ramNeedBits !== summary.expectedRamNeedBits,
      );

    expect(mismatches).toEqual([]);
    expect(getTaskDefinition("busMirror").ramNeedBits).toBe(1024);
    expect(getTaskDefinition("shardReconcile").ramNeedBits).toBe(4096);
    expect(getTaskDefinition("shardReconcile").cacheNeedBits).toBe(40);
    expect(getTaskDefinition("multiCoreBenchmark").cacheNeedBits).toBe(10);
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
    expect(task.operationCount).toBe(32);
    expect(task.requiredCycles).toBe(16);
    expect(task.rewardCredits).toBe(32);
    expect(task.cacheNeedBits).toBe(16);
    expect(task.subtasks.map((node) => node.cacheBits)).toEqual([8, 8]);
  });

  it("counts cache and RAM loading as paid task operations", () => {
    const task = getTaskDefinition("tinyChecksum");
    const ramLoadNodes = task.dagNodes.filter((node) => node.kind === "ramLoad");

    expect(task.requiredCycles).toBe(60);
    expect(task.operationCount).toBe(332);
    expect(task.rewardCredits).toBe(332);
    expect(ramLoadNodes).toHaveLength(1);
    expect(ramLoadNodes[0]?.operationCount).toBe(256);
    expect(task.dagNodes.map((node) => [node.kind, node.operationCount])).toEqual([
      ["accept", 0],
      ["cacheLoad", 8],
      ["ramLoad", 256],
      ["execute", 24],
      ["cacheLoad", 8],
      ["execute", 36],
      ["complete", 0],
    ]);
  });

  it("sums write cache footprints while reusing overwrite footprints", () => {
    expect(getTaskDefinition("fetchBit").cacheNeedBits).toBe(1);
    expect(getTaskDefinition("decodeBit").cacheNeedBits).toBe(2);
    expect(getTaskDefinition("bitFlip").cacheNeedBits).toBe(1);
    expect(getTaskDefinition("bitShift").cacheNeedBits).toBe(1);
    expect(getTaskDefinition("byteCopy").cacheNeedBits).toBe(16);
    expect(getTaskDefinition("packetCheck").cacheNeedBits).toBe(2);
    expect(getTaskDefinition("tinyChecksum").cacheNeedBits).toBe(8);
    expect(getTaskDefinition("microBenchmark").cacheNeedBits).toBe(4);
    expect(getTaskDefinition("parallelismBenchmark").cacheNeedBits).toBe(4);
    expect(getTaskDefinition("multiCoreBenchmark").cacheNeedBits).toBe(10);
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

    state = tickGame(state, 500);

    const visible = deriveVisibleState(state);
    const residency = visible.metrics.cacheResidency;
    const committedBits = residency.reduce(
      (total, segment) =>
        total + (segment.readyBits ?? 0) + (segment.bufferBits ?? 0),
      0,
    );

    expect(visible.activeTasks[0]?.activeOperationName).toBe("Write 8 Bits");
    expect(visible.metrics.cacheUsedBits).toBeGreaterThan(8);
    expect(visible.metrics.cacheUsedBits).toBeLessThan(16);
    expect(visible.metrics.cacheUsedBits).toBeCloseTo(committedBits);
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
        state: "loaded",
      }),
    );
    expect(residency[1]?.readyBits).toBeGreaterThan(0);
    expect(residency[1]?.bufferBits).toBe(0);
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

  it("commits equal-rate memory writes directly to ready cache", () => {
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
    expect(deriveVisibleState(state).metrics.cacheUsedBits).toBe(0);

    state = tickGame(state, 500);

    const visible = deriveVisibleState(state);
    visibleOperation = visible.activeTasks[0]?.coreProgress[0];
    expect(visibleOperation?.status).toBe("loadingCache");
    expect(visibleOperation?.memoryAction).toBe("read");
    expect(visibleOperation?.remainingCycles).toBeCloseTo(0.5);
    expect(visibleOperation?.remainingLoadCycles).toBeCloseTo(0.5);
    expect(visibleOperation?.totalCycles).toBe(1);
    expect(visible.metrics.cacheUsedBits).toBeCloseTo(0.5);
    expect(visible.metrics.cacheResidency[0]).toEqual(
      expect.objectContaining({
        readyBits: 0.5,
        bufferBits: 0,
        committedBits: 0.5,
        state: "loaded",
      }),
    );

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

  it("clean-resets pre-v2 saves instead of migrating legacy research ids", () => {
    const savedState: GameState = {
      ...createInitialGameState(),
      research: {
        completed: ["kernelScheduler"] as unknown as ResearchId[],
      },
    };
    const restored = deserializeSave(
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        state: savedState,
      }),
    );

    expect(restored.version).toBe(2);
    expect(restored.research.completed).toEqual([]);
    expect(restored.flags.scheduler).toBe(false);
    expect(restored.systems).toHaveLength(1);
  });

  it("normalizes malformed RAM sticks from v2 saves", () => {
    const base = createInitialGameState();
    const restored = deserializeSave(
      JSON.stringify({
        version: 2,
        savedAt: new Date().toISOString(),
        state: {
          ...base,
          hardware: {
            ...base.hardware,
            ramLevel: 2,
            ramSpeedLevel: 3,
            ramSticks: [
              {
                id: 1,
                level: 2,
                bits: -1,
                bytes: 999,
                speedLevel: -2,
                speedMt: 999,
              },
              {
                id: 1,
                level: 3,
                bits: null,
                bytes: 999,
                speedLevel: 4,
                speedMt: -10,
              },
            ],
          },
        },
      }),
    );

    const expectedRamBits = getRamBits(2) + getRamBits(3);

    expect(restored.hardware.ramSticks).toEqual([
      {
        id: 1,
        level: 2,
        bits: getRamBits(2),
        bytes: Math.ceil(getRamBits(2) / 8),
        speedLevel: 1,
        speedMt: getRamSpeedMt(1),
      },
      {
        id: 2,
        level: 3,
        bits: getRamBits(3),
        bytes: Math.ceil(getRamBits(3) / 8),
        speedLevel: 4,
        speedMt: getRamSpeedMt(4),
      },
    ]);
    expect(restored.hardware.ramBits).toBe(expectedRamBits);
    expect(restored.hardware.ramBytes).toBe(Math.ceil(expectedRamBits / 8));
    expect(restored.hardware.ramSpeedLevel).toBe(4);
    expect(restored.hardware.ramSpeedMt).toBe(getRamSpeedMt(4));
    expect(restored.systems[0]?.hardware.ramBits).toBe(expectedRamBits);
  });

  it("creates a rack-ready seed with a dense visual stress node", () => {
    const state = createRackReadyGameState();
    const visible = deriveVisibleState(state);

    expect(state.version).toBe(2);
    expect(state.resources).toEqual({ credits: 20_000, data: 20_000 });
    expect(state.flags.systemCatalog).toBe(true);
    expect(state.flags.customMachineAssembly).toBe(true);
    expect(state.systems).toHaveLength(2);
    expect(state.systems[1]?.hardware.cores).toBe(128);
    expect(state.systems[1]?.hardware.ramSticks).toHaveLength(32);
    expect(state.rack.nextSystemId).toBe(3);
    expect(visible.rack.unlocked).toBe(true);
    expect(visible.rack.systems).toHaveLength(2);
    expect(visible.rack.systems[0]?.name).toBe("Rack-Ready Workstation");
    expect(visible.rack.systems[1]?.coreCount).toBe(128);
    expect(visible.rack.systems[1]?.ramBits).toBe(state.systems[1]?.hardware.ramBits);
    expect(visible.machineBuilder.templates.map((template) => template.id)).toEqual([
      "barebonesPc",
      "starterNode",
      "compileBox",
      "renderBrick",
      "workstationTower",
    ]);
    expect(visible.tasks.some((task) => task.id === "compileCode")).toBe(true);

    const expanded = applyAction(state, {
      type: "buyMachineTemplate",
      templateId: "compileBox",
    });

    expect(expanded.systems).toHaveLength(3);
    expect(expanded.selectedSystemId).toBe(3);
    expect(expanded.resources.credits).toBeLessThan(state.resources.credits);
  });

  it("clean-resets stale pre-v2 task references before render and tick", () => {
    const runningState = applyAction(createInitialGameState(), {
      type: "startTask",
      taskId: "fetchBit",
    });
    const activeTask = runningState.activeTasks[0]!;
    const staleTaskId = "removedTask" as TaskId;
    const savedState: GameState = {
      ...runningState,
      flags: {
        ...runningState.flags,
        cron: true,
      },
      completedTasks: {
        fetchBit: 2,
        [staleTaskId]: 9,
      },
      completedJobs: {
        [staleTaskId]: 4,
      },
      completedBenchmarks: [staleTaskId],
      activeTasks: [
        {
          ...activeTask,
          taskId: staleTaskId,
          jobId: staleTaskId,
        },
        activeTask,
      ],
      activeJobs: [],
      queue: [staleTaskId, "decodeBit"],
      cron: {
        schedules: [
          {
            id: 1,
            taskId: staleTaskId,
            enabled: true,
            intervalMode: "seconds",
            intervalValue: 60,
            remainingSeconds: 1,
            lastResult: null,
          },
        ],
        nextScheduleId: 2,
        queuePowerSpikeSeconds: 0,
      },
      autoRepeatJobId: staleTaskId,
    };

    const restored = deserializeSave(
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        state: savedState,
      }),
    );

    expect(restored.version).toBe(2);
    expect(restored.completedTasks).toEqual({});
    expect(restored.completedJobs).toEqual({});
    expect(restored.completedBenchmarks).toEqual([]);
    expect(restored.activeTasks).toEqual([]);
    expect(restored.queue).toEqual([]);
    expect(restored.cron.schedules).toEqual([]);
    expect(restored.autoRepeatJobId).toBeNull();
    expect(restored.systems).toHaveLength(1);
    expect(() => deriveVisibleState(restored)).not.toThrow();
    expect(() => tickGame(restored, 1000)).not.toThrow();
  });

  it("completes the starter ladder and gates cache behind byte operations", () => {
    let state = completeStarterLadder();

    expect(state.completedTasks.fetchBit).toBe(3);
    expect(state.completedTasks.decodeBit).toBe(2);
    expect(state.completedTasks.bitFlip).toBe(4);
    expect(state.completedTasks.bitShift).toBe(4);
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
        cpus: state.hardware.cpus.map((cpu) =>
          cpu.id === 1
            ? { ...cpu, cacheBits: 1, cacheBytes: 1, cacheLevel: 1 }
            : cpu,
        ),
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

    const parallelState = unlockSystemScheduler();
    const lowParallelCacheState = {
      ...parallelState,
      hardware: {
        ...parallelState.hardware,
        cacheBits: 4,
        cacheBytes: 1,
        cpus: parallelState.hardware.cpus.map((cpu) => ({
          ...cpu,
          cacheBits: 4,
          cacheBytes: 1,
          cacheLevel: 3,
        })),
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

    const shardReconcile = getTaskDefinition("shardReconcile");
    const shardState = withRamCapacity(unlockSystemStats(), 1024);
    const lowShardRamState = {
      ...shardState,
      hardware: {
        ...shardState.hardware,
        cacheBits: shardReconcile.cacheNeedBits,
        cacheBytes: Math.ceil(shardReconcile.cacheNeedBits / 8),
        cpus: shardState.hardware.cpus.map((cpu) => ({
          ...cpu,
          cacheBits: shardReconcile.cacheNeedBits,
          cacheBytes: Math.ceil(shardReconcile.cacheNeedBits / 8),
        })),
      },
    };
    expect(
      applyAction(lowShardRamState, {
        type: "startTask",
        taskId: "shardReconcile",
      }).activeTasks,
    ).toHaveLength(0);
    expect(
      deriveVisibleState(lowShardRamState).tasks.find(
        (task) => task.id === "shardReconcile",
      )?.blockedReason,
    ).toBe("RAM capacity too low.");
  });

  it("buys preconfigured and custom systems as one visible rack slot per owned system", () => {
    let state = fund({
      ...createInitialGameState(),
      flags: {
        ...createInitialGameState().flags,
        systemCatalog: true,
        customMachineAssembly: true,
      },
      research: {
        completed: ["systemCatalog", "customMachineAssembly"],
      },
    });

    state = applyAction(state, {
      type: "buyMachineTemplate",
      templateId: "compileBox",
    });

    let visible = deriveVisibleState(state);
    const compileSystem = state.systems.at(-1);

    expect(state.systems.map((system) => system.name)).toEqual([
      "Barebones PC",
      "Compile Box",
    ]);
    expect(state.selectedSystemId).toBe(2);
    expect(compileSystem?.hardware.cores).toBe(4);
    expect(compileSystem?.hardware.schedulerSlots).toBe(4);
    expect(compileSystem?.hardware.systemSchedulerSlots).toBe(4);
    expect(compileSystem?.hardware.cpus[0]?.schedulerSlots).toBe(
      compileSystem?.hardware.cpus[0]?.coreIds.length,
    );
    expect(visible.rack.systems).toHaveLength(2);
    expect(visible.rack as unknown as Record<string, unknown>).not.toHaveProperty(
      "slotCount",
    );

    state = {
      ...state,
      resources: { credits: 100_000, data: 100_000 },
    };
    state = applyAction(state, {
      type: "buyCustomMachine",
      components: {
        cpu: "cpu-render-array",
        ram: "ram-4kb-work",
        scheduler: "scheduler-6-slot",
        psu: "psu-balanced",
      },
    });
    visible = deriveVisibleState(state);

    expect(state.systems).toHaveLength(3);
    expect(state.systems.at(-1)?.name).toBe("Custom 3");
    expect(state.selectedSystemId).toBe(3);
    expect(visible.rack.systems).toHaveLength(3);
  });

  it("keeps catalog CPU cache speed matched and RAM tiers monotonic", () => {
    const cpuModules = componentSkus.filter((module) => module.type === "cpu");
    const ramModules = componentSkus.filter((module) => module.type === "ram");

    expect(cpuModules.every((module) => module.cacheSpeedLevel === module.clockLevel)).toBe(
      true,
    );

    for (let index = 1; index < ramModules.length; index += 1) {
      const previous = ramModules[index - 1]!;
      const current = ramModules[index]!;
      const previousCapacity =
        (previous.ramStickCount ?? 0) * getRamBits(previous.ramLevel ?? 0);
      const currentCapacity =
        (current.ramStickCount ?? 0) * getRamBits(current.ramLevel ?? 0);

      expect(currentCapacity).toBeGreaterThanOrEqual(previousCapacity);
      expect(current.ramSpeedLevel ?? 0).toBeGreaterThanOrEqual(
        previous.ramSpeedLevel ?? 0,
      );
    }
  });

  it("offers broad CPU module choices and materializes multi-CPU custom systems", () => {
    let state = fund({
      ...createInitialGameState(),
      flags: {
        ...createInitialGameState().flags,
        systemCatalog: true,
        customMachineAssembly: true,
      },
      research: {
        completed: ["systemCatalog", "customMachineAssembly"],
      },
    });
    state = {
      ...state,
      resources: { credits: 50_000_000, data: 50_000 },
    };
    const visible = deriveVisibleState(state);
    const cpuModules = visible.machineBuilder.components.cpu;

    expect(cpuModules).toHaveLength(11);
    expect(cpuModules[0]?.id).toBe("cpu-barebones-1");
    expect(cpuModules.every((module) => (module.cpuPackageCount ?? 1) === 1)).toBe(
      true,
    );
    expect(Math.max(...cpuModules.map((module) => module.coreCount ?? 0))).toBe(64);
    expect(Math.max(...cpuModules.map((module) => module.clockHz ?? 0))).toBeGreaterThan(
      100_000,
    );

    state = applyAction(state, {
      type: "buyCustomMachine",
      components: {
        cpu: "cpu-server-64",
        cpuPackageCount: 8,
        ram: "ram-8mb-server",
        scheduler: "scheduler-24-slot",
        psu: "psu-server",
      },
    });

    const custom = state.systems.at(-1);
    const cpu = getComponentSku("cpu-server-64");
    const ram = getComponentSku("ram-8mb-server");
    const scheduler = getComponentSku("scheduler-24-slot");
    const template = getMachineTemplate("workstationTower");

    expect(custom?.hardware.cpus).toHaveLength(8);
    expect(custom?.hardware.cores).toBe(512);
    expect(custom?.hardware.secondCpu).toBe(true);
    expect(custom?.hardware.cacheLevel).toBe(cpu.cacheLevel);
    expect(custom?.hardware.cacheSpeedLevel).toBe(cpu.clockLevel);
    expect(custom?.hardware.ramSticks).toHaveLength(ram.ramStickCount ?? 0);
    expect(custom?.hardware.ramSpeedLevel).toBe(ram.ramSpeedLevel);
    expect(custom?.hardware.systemSchedulerSlots).toBe(scheduler.schedulerSlots);
    expect(custom?.hardware.schedulerSlots).toBe(custom?.hardware.cores);
    expect(
      custom?.hardware.cpus.every(
        (packageCpu) => packageCpu.schedulerSlots === packageCpu.coreIds.length,
      ),
    ).toBe(true);
    expect(custom?.hardware.clockHz).toBeGreaterThan(100_000);
    expect(template.components.cpu).toBe("cpu-ghz-16");
  });

  it("routes selected-system upgrades without mutating other rack systems", () => {
    let state = fund({
      ...createInitialGameState(),
      flags: {
        ...createInitialGameState().flags,
        scheduler: true,
        systemCatalog: true,
      },
      research: {
        completed: ["systemScheduler", "systemCatalog"],
      },
    });

    state = applyAction(state, {
      type: "buyMachineTemplate",
      templateId: "compileBox",
    });

    const secondSystemBefore = state.systems.find((system) => system.id === 2);
    expect(secondSystemBefore).toBeDefined();

    state = fund(state);
    state = applyAction(state, {
      type: "buyUpgrade",
      upgradeId: "cache",
      cpuId: 1,
      systemId: 1,
    });

    const firstSystem = state.systems.find((system) => system.id === 1);
    const secondSystemAfter = state.systems.find((system) => system.id === 2);

    expect(firstSystem?.hardware.cacheBits).toBeGreaterThan(
      createInitialGameState().hardware.cacheBits,
    );
    expect(secondSystemAfter?.hardware.cacheBits).toBe(
      secondSystemBefore?.hardware.cacheBits,
    );
  });

  it("runs chunked tasks faster on more selected-system cores without cross-system work", () => {
    let state = fund({
      ...createInitialGameState(),
      flags: {
        ...createInitialGameState().flags,
        scheduler: true,
        systemCatalog: true,
      },
      research: {
        completed: ["systemScheduler", "systemCatalog"],
      },
    });
    state = applyAction(state, {
      type: "buyMachineTemplate",
      templateId: "compileBox",
    });

    const compileDefinition = getTaskDefinition("compileCode");
    expect(compileDefinition.coreScaling).toBe("chunked");

    const selectedCpu = state.hardware.cpus[0]!;
    const firstCoreId = selectedCpu.coreIds[0]!;
    const singleCoreState: GameState = {
      ...state,
      hardware: {
        ...state.hardware,
        cores: 1,
        cpus: [{ ...selectedCpu, coreIds: [firstCoreId] }],
        coreClockLevels: {
          [firstCoreId]:
            state.hardware.coreClockLevels[firstCoreId] ?? state.hardware.clockLevel,
        },
        schedulerSlots: 1,
      },
    };

    const singleStarted = applyAction(singleCoreState, {
      type: "startTask",
      taskId: "compileCode",
    });
    const multiStarted = applyAction(state, {
      type: "startTask",
      taskId: "compileCode",
    });

    const singleTask = singleStarted.activeTasks[0];
    const multiTask = multiStarted.activeTasks[0];

    expect(singleTask?.assignedCoreIds).toHaveLength(1);
    expect(multiTask?.assignedCoreIds.length).toBeGreaterThan(1);
    expect(multiTask?.systemId).toBe(state.selectedSystemId);
    expect(
      multiStarted.systems.find((system) => system.id === 1)?.activeTasks,
    ).toHaveLength(0);

    const singleFinished = finishActiveTasksWithTicks(singleStarted);
    const multiFinished = finishActiveTasksWithTicks(multiStarted);

    expect(multiFinished.ticks).toBeLessThan(singleFinished.ticks);
    expect(singleFinished.state.completedTasks.compileCode).toBe(1);
    expect(multiFinished.state.completedTasks.compileCode).toBe(1);
    expect(getTaskDefinition("compileCode").operationCount).toBe(
      compileDefinition.operationCount,
    );
  });

  it("spans chunked system tasks across every idle core in all CPU packages", () => {
    let state = fund({
      ...createInitialGameState(),
      flags: {
        ...createInitialGameState().flags,
        scheduler: true,
        systemCatalog: true,
        customMachineAssembly: true,
      },
      research: {
        completed: ["systemScheduler", "systemCatalog", "customMachineAssembly"],
      },
    });
    state = {
      ...state,
      resources: { credits: 50_000_000, data: 50_000 },
    };
    state = applyAction(state, {
      type: "buyCustomMachine",
      components: {
        cpu: "cpu-compile-die",
        cpuPackageCount: 2,
        ram: "ram-2kb-fast",
        scheduler: "scheduler-4-slot",
        psu: "psu-balanced",
      },
    });

    const busyCoreId = state.hardware.cpus[0]?.coreIds[0];
    expect(busyCoreId).toBeDefined();

    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "fetchBit",
      coreId: busyCoreId!,
    });
    const busyCoreIds = new Set(
      state.activeTasks.flatMap((task) => task.assignedCoreIds),
    );
    const expectedIdleCoreIds = state.hardware.cpus
      .flatMap((cpu) => cpu.coreIds)
      .filter((coreId) => !busyCoreIds.has(coreId));

    state = applyAction(state, {
      type: "startTask",
      taskId: "compileCode",
    });

    const compileTask = state.activeTasks.find(
      (task) => task.taskId === "compileCode",
    );
    expect(state.hardware.cpus).toHaveLength(2);
    expect(compileTask?.assignedCoreIds).toEqual(expectedIdleCoreIds);
    for (const cpu of state.hardware.cpus) {
      expect(
        cpu.coreIds.some((coreId) => compileTask?.assignedCoreIds.includes(coreId)),
      ).toBe(true);
    }
  });

  it("starts system-scheduled work into RAM deadlock when free RAM is exhausted", () => {
    let state = withRamCapacity(unlockSystemScheduler(), 256);

    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });

    expect(state.activeTasks).toHaveLength(1);
    expect(state.queue).toEqual(["tinyChecksum"]);
    expect(state.activeTasks[0]?.coreOperations[0]?.memoryReservedBits).toBe(0);

    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });
    state = tickUntilDeadlock(state, "ram");

    const visible = deriveVisibleState(state);
    const operations = state.activeTasks.flatMap((task) => task.coreOperations);

    expect(state.activeTasks).toHaveLength(2);
    expect(state.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(operations).toContainEqual(
      expect.objectContaining({
        status: "deadlocked",
        lockResource: "ram",
        memoryState: "deadlock",
      }),
    );
    expect(
      visible.metrics.deadlocks.find((deadlock) => deadlock.resource === "ram")
        ?.taskId,
    ).toBe("tinyChecksum");
  });

  it("FIFO scheduler can dispatch queued work into a RAM deadlock", () => {
    let state = withRamCapacity(unlockSystemScheduler(), 256);

    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });
    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });

    expect(state.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(state.activeTasks).toHaveLength(1);

    state = tickGame(state, 16);

    expect(state.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(state.activeTasks).toHaveLength(2);

    state = tickUntilDeadlock(state, "ram");

    expect(state.activeTasks.flatMap((task) => task.coreOperations)).toContainEqual(
      expect.objectContaining({ status: "deadlocked", lockResource: "ram" }),
    );
  });

  it("cancels active tasks without paying rewards", () => {
    const initial = createInitialGameState();
    let state = applyAction(initial, {
      type: "startTask",
      taskId: "fetchBit",
    });
    const instanceId = state.activeTasks[0]?.instanceId;

    expect(state.activeTasks).toHaveLength(1);

    state = applyAction(state, {
      type: "cancelTask",
      taskId: "fetchBit",
      instanceId,
    });

    expect(state.activeTasks).toHaveLength(0);
    expect(state.queue).toEqual([]);
    expect(state.completedTasks.fetchBit).toBeUndefined();
    expect(state.resources.credits).toBe(initial.resources.credits);
    expect(deriveVisibleState(state).metrics.cacheUsedBits).toBe(0);
  });

  it("cancels pending queued work without removing active scheduler reservations", () => {
    let state = withRamCapacity(unlockSystemScheduler(), 256);

    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });
    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });

    expect(state.activeTasks).toHaveLength(1);
    expect(state.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(Object.values(state.coreSchedulers).flatMap((core) => core.localQueue)).toEqual(
      ["tinyChecksum"],
    );

    state = applyAction(state, {
      type: "cancelQueuedTask",
      taskId: "tinyChecksum",
    });

    expect(state.activeTasks).toHaveLength(1);
    expect(state.queue).toEqual(["tinyChecksum"]);
    expect(Object.values(state.coreSchedulers).flatMap((core) => core.localQueue)).toEqual(
      ["tinyChecksum"],
    );
  });

  it("schedules system tasks globally before reserving CPU scheduler execution", () => {
    let state = unlockSystemScheduler();

    expect(
      applyAction(state, {
        type: "startTaskOnCore",
        taskId: "tinyChecksum",
        coreId: 1,
      }).activeTasks,
    ).toHaveLength(0);
    expect(
      applyAction(state, {
        type: "queueTask",
        taskId: "tinyChecksum",
        cpuId: 1,
      }).queue,
    ).toHaveLength(0);

    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });

    expect(state.queue).toEqual(["tinyChecksum"]);
    expect(Object.values(state.coreSchedulers).flatMap((core) => core.localQueue)).toEqual(
      [],
    );

    state = tickGame(state, 16);

    expect(state.activeTasks.map((task) => task.taskId)).toContain("tinyChecksum");
    expect(state.activeTasks[0]?.schedulerQueued).toBe(true);
    expect(Object.values(state.coreSchedulers).flatMap((core) => core.localQueue)).toEqual(
      ["tinyChecksum"],
    );
  });

  it("routes system tasks into available CPU scheduler slots while cores are busy", () => {
    let state = unlockSystemScheduler();
    const primaryCoreIds = state.hardware.cpus[0]?.coreIds ?? [];

    for (const coreId of primaryCoreIds) {
      state = applyAction(state, {
        type: "startTaskOnCore",
        taskId: "fetchBit",
        coreId,
      });
    }

    expect(state.activeTasks).toHaveLength(primaryCoreIds.length);
    expect(Object.values(state.coreSchedulers).flatMap((core) => core.localQueue)).toEqual(
      [],
    );

    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });

    expect(state.queue).toEqual(["tinyChecksum"]);
    expect(state.activeTasks).toHaveLength(primaryCoreIds.length);
    expect(Object.values(state.coreSchedulers).flatMap((core) => core.localQueue)).toEqual(
      [],
    );

    state = tickGame(state, 16);

    expect(state.queue).toEqual(["tinyChecksum"]);
    expect(state.activeTasks).toHaveLength(primaryCoreIds.length);
    expect(Object.values(state.coreSchedulers).flatMap((core) => core.localQueue)).toEqual(
      ["tinyChecksum"],
    );
  });

  it("keeps routing full system scheduler queues into cache-blocked CPU scheduler slots", () => {
    let state = withPrimaryCpuSchedulerPolicy(
      withPrimaryCpuCache(
        withRamCapacity(withPrimarySchedulerCapacity(unlockSystemScheduler(), 8), 4096),
        32,
      ),
      "deadlockSafe",
    );

    for (let index = 0; index < 8; index += 1) {
      state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });
    }

    expect(state.queue).toHaveLength(8);
    expect(Object.values(state.coreSchedulers).flatMap((core) => core.localQueue)).toEqual(
      [],
    );

    state = tickGame(state, 16);

    expect(state.activeTasks).toHaveLength(4);
    expect(Object.values(state.coreSchedulers).flatMap((core) => core.localQueue)).toHaveLength(
      8,
    );
  });

  it("keeps starting full system scheduler queues when CPU scheduler can dispatch", () => {
    let state = withRamCapacity(
      withPrimarySchedulerCapacity(unlockSystemScheduler(), 8),
      4096,
    );

    for (let index = 0; index < 8; index += 1) {
      state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });
    }

    expect(state.queue).toHaveLength(8);
    expect(Object.values(state.coreSchedulers).flatMap((core) => core.localQueue)).toEqual(
      [],
    );

    state = tickGame(state, 16);

    expect(state.activeTasks).toHaveLength(8);
    expect(Object.values(state.coreSchedulers).flatMap((core) => core.localQueue)).toHaveLength(
      8,
    );
  });

  it("halts all active system work while RAM is deadlocked", () => {
    let state = withRamCapacity(unlockSystemScheduler(), 256);

    state = buy(state, "cache");
    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });
    state = tickUntilTaskOperationStatus(state, "tinyChecksum", "loadingRam");

    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "byteCopy",
      coreId: 2,
    });

    const cpuTaskInstanceId = state.activeTasks.find(
      (task) => task.taskId === "byteCopy",
    )?.instanceId;
    expect(cpuTaskInstanceId).toBeDefined();
    const longCpuTasks = state.activeTasks.map((task) =>
      task.instanceId === cpuTaskInstanceId
        ? {
            ...task,
            remainingCycles: 10_000,
            totalCycles: 10_000,
            coreOperations: task.coreOperations.map((operation) => ({
              ...operation,
              status: "running" as const,
              memoryState: "ready" as const,
              remainingCycles: 10_000,
              totalCycles: 10_000,
              remainingLoadCycles: 0,
              totalLoadCycles: 0,
            })),
          }
        : task,
    );
    state = {
      ...state,
      activeTasks: longCpuTasks,
      activeJobs: longCpuTasks,
    };

    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });

    expect(state.queue).toEqual(["tinyChecksum", "tinyChecksum"]);

    state = tickUntilDeadlock(state, "ram");

    const cpuTaskBefore = state.activeTasks.find(
      (task) => task.instanceId === cpuTaskInstanceId,
    );
    const cpuOperationBefore = cpuTaskBefore?.coreOperations[0];

    expect(state.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(state.activeTasks.flatMap((task) => task.coreOperations)).toContainEqual(
      expect.objectContaining({ status: "deadlocked", lockResource: "ram" }),
    );

    state = tickGame(state, 1000);

    const cpuOperationAfter = state.activeTasks
      .find((task) => task.instanceId === cpuTaskInstanceId)
      ?.coreOperations[0];

    expect(cpuOperationAfter?.remainingCycles).toBe(
      cpuOperationBefore?.remainingCycles,
    );
    expect(cpuOperationAfter?.remainingLoadCycles).toBe(
      cpuOperationBefore?.remainingLoadCycles,
    );
    expect(
      deriveVisibleState(state).activeTasks.find(
        (task) => task.instanceId === cpuTaskInstanceId,
      )?.status,
    ).toBe("deadlocked");
    expect(state.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
  });

  it("starts manual work into cache deadlock when free cache is exhausted", () => {
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

    expect(state.activeTasks.flatMap((task) => task.coreOperations)).not.toContainEqual(
      expect.objectContaining({ status: "deadlocked" }),
    );

    state = tickUntilDeadlock(state, "cache");
    const visible = deriveVisibleState(state);

    expect(state.activeTasks).toHaveLength(2);
    expect(state.activeTasks.flatMap((task) => task.coreOperations)).toContainEqual(
      expect.objectContaining({
        status: "deadlocked",
        lockResource: "cache",
        memoryState: "deadlock",
      }),
    );
    expect(visible.tasks.find((task) => task.id === "byteCopy")?.blockedReason).not.toMatch(
      /free cache/i,
    );
    expect(visible.metrics.deadlocks[0]?.resource).toBe("cache");
    expect(visible.metrics.cacheUsedBits).toBeCloseTo(visible.hardware.cacheBits);
    expect(visible.metrics.cacheUsedBits).toBeLessThanOrEqual(
      visible.hardware.cacheBits,
    );
    expect(visible.metrics.cpuSockets[0]?.cacheUsedBits).toBeLessThanOrEqual(
      visible.metrics.cpuSockets[0]?.cacheBits ?? 0,
    );
    expect(
      visible.metrics.cacheResidency.reduce(
        (total, segment) =>
          total + (segment.readyBits ?? 0) + (segment.bufferBits ?? 0),
        0,
      ),
    ).toBeLessThanOrEqual(visible.hardware.cacheBits);
  });

  it("does not deadlock before issued cache reaches total capacity", () => {
    let state = withExactByteCopyCache(completeStarterLadder());
    state = {
      ...state,
      hardware: {
        ...state.hardware,
        clockLevel: 8,
        coreClockLevels: {
          ...state.hardware.coreClockLevels,
          1: 8,
          2: 1,
        },
        cacheSpeedLevel: 4,
        cpus: state.hardware.cpus.map((cpu) =>
          cpu.id === 1
            ? {
                ...cpu,
                cacheSpeedLevel: 4,
              }
            : cpu,
        ),
      },
    };

    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "byteCopy",
      coreId: 1,
    });
    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "byteCopy",
      coreId: 2,
    });

    let sawUnderCapacityRunning = false;
    let guard = 0;

    while (
      !state.activeTasks.some((task) =>
        task.coreOperations.some(
          (operation) =>
            operation.status === "deadlocked" &&
            operation.lockResource === "cache",
        ),
      ) &&
      guard < 80
    ) {
      const visible = deriveVisibleState(state);
      if (visible.metrics.cacheUsedBits < visible.hardware.cacheBits) {
        sawUnderCapacityRunning = true;
      }

      state = tickGame(state, 250);
      guard += 1;
    }

    const visible = deriveVisibleState(state);
    expect(sawUnderCapacityRunning).toBe(true);
    expect(state.activeTasks.flatMap((task) => task.coreOperations)).toContainEqual(
      expect.objectContaining({ status: "deadlocked", lockResource: "cache" }),
    );
    expect(visible.metrics.cacheUsedBits).toBeCloseTo(visible.hardware.cacheBits);
  });

  it("canceling a cache blocker lets deadlocked work resume", () => {
    let state = withExactByteCopyCache(completeStarterLadder());

    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "byteCopy",
      coreId: 1,
    });
    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "byteCopy",
      coreId: 2,
    });

    state = tickUntilDeadlock(state, "cache");

    expect(state.activeTasks.flatMap((task) => task.coreOperations)).toContainEqual(
      expect.objectContaining({ status: "deadlocked", lockResource: "cache" }),
    );

    const deadlockedInstanceId = state.activeTasks.find((task) =>
      task.coreOperations.some((operation) => operation.status === "deadlocked"),
    )?.instanceId;
    const blockerInstanceId = state.activeTasks.find(
      (task) => task.instanceId !== deadlockedInstanceId,
    )?.instanceId;
    const blockerBefore = state.activeTasks
      .find((task) => task.instanceId === blockerInstanceId)
      ?.coreOperations[0];
    state = tickGame(state, 1000);
    const blockerAfter = state.activeTasks
      .find((task) => task.instanceId === blockerInstanceId)
      ?.coreOperations[0];

    expect(blockerAfter?.remainingCycles).toBe(blockerBefore?.remainingCycles);
    expect(blockerAfter?.remainingLoadCycles).toBe(
      blockerBefore?.remainingLoadCycles,
    );
    expect(
      deriveVisibleState(state).activeTasks.find(
        (task) => task.instanceId === blockerInstanceId,
      )?.status,
    ).toBe("deadlocked");

    state = applyAction(state, {
      type: "cancelTask",
      taskId: "byteCopy",
      instanceId: blockerInstanceId,
    });
    state = tickGame(state, 16);

    expect(state.activeTasks).toHaveLength(1);
    expect(state.activeTasks.flatMap((task) => task.coreOperations)).not.toContainEqual(
      expect.objectContaining({ status: "deadlocked" }),
    );
  });

  it("keeps deadlock pressure cooling without blocking starts when resolved before failure", () => {
    let state = withExactByteCopyCache(completeStarterLadder());

    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "byteCopy",
      coreId: 1,
    });
    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "byteCopy",
      coreId: 2,
    });
    state = tickUntilDeadlock(state, "cache");

    const deadlockedInstanceId = state.activeTasks.find((task) =>
      task.coreOperations.some((operation) => operation.status === "deadlocked"),
    )?.instanceId;
    const blockerInstanceId = state.activeTasks.find(
      (task) => task.instanceId !== deadlockedInstanceId,
    )?.instanceId;

    state = applyAction(state, {
      type: "cancelTask",
      taskId: "byteCopy",
      instanceId: blockerInstanceId,
    });
    state = tickGame(state, 16);

    expect(state.deadlockPressureSeconds).toBeGreaterThan(0);
    expect(state.deadlockPressureResource).toBe("cache");
    expect(state.deadlockPressureCpuId).toBe(1);
    expect(state.deadlockProcessLockout).toBe(false);
    expect(state.activeTasks).toHaveLength(1);

    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "fetchBit",
      coreId: 2,
    });

    expect(state.activeTasks.map((task) => task.taskId)).toContain("fetchBit");

    while (state.deadlockPressureSeconds > 0) {
      state = tickGame(state, 1000);
    }

    expect(state.deadlockPressureResource).toBeNull();
    expect(state.deadlockPressureCpuId).toBeNull();
  });

  it("loses active processes at full deadlock pressure and locks starts until cooldown reaches zero", () => {
    let state = withExactByteCopyCache(completeStarterLadder());

    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "byteCopy",
      coreId: 1,
    });
    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "byteCopy",
      coreId: 2,
    });
    state = tickUntilDeadlock(state, "cache");

    while (!state.deadlockProcessLockout) {
      state = tickGame(state, 1000);
    }

    expect(state.activeTasks).toHaveLength(0);
    expect(state.deadlockPressureSeconds).toBe(10);
    expect(state.deadlockPressureResource).toBe("cache");
    expect(state.deadlockPressureCpuId).toBe(1);

    const blocked = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "fetchBit",
      coreId: 1,
    });

    expect(blocked.activeTasks).toHaveLength(0);

    while (state.deadlockPressureSeconds > 0) {
      state = tickGame(state, 1000);
    }

    expect(state.deadlockProcessLockout).toBe(false);
    expect(state.deadlockPressureResource).toBeNull();
    expect(state.deadlockPressureCpuId).toBeNull();

    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "fetchBit",
      coreId: 1,
    });

    expect(state.activeTasks).toHaveLength(1);
  });

  it("deadlock cooldown upgrades drain failure lockout faster", () => {
    let base = withExactByteCopyCache(completeStarterLadder());

    base = {
      ...base,
      deadlockPressureSeconds: 10,
      deadlockProcessLockout: true,
    };

    const upgraded = {
      ...base,
      hardware: {
        ...base.hardware,
        deadlockRecoveryLevel: 2,
      },
    };

    expect(tickGame(base, 1000).deadlockPressureSeconds).toBe(9);
    expect(tickGame(upgraded, 1000).deadlockPressureSeconds).toBe(8);
  });

  it("FIFO scheduler can dispatch queued work into a cache deadlock", () => {
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
    expect(state.activeTasks).toHaveLength(2);

    state = tickUntilDeadlock(state, "cache");

    expect(state.activeTasks.flatMap((task) => task.coreOperations)).toContainEqual(
      expect.objectContaining({ status: "deadlocked", lockResource: "cache" }),
    );
  });

  it("deadlock-safe scheduler skips dispatches that would exceed free cache", () => {
    let state = withSchedulerSlots(withExactByteCopyCache(completeStarterLadder()), 1);
    state = {
      ...state,
      flags: { ...state.flags, schedulerPolicies: true },
    };
    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "cpu",
      cpuId: 1,
      policy: "deadlockSafe",
    });

    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "byteCopy",
      coreId: 1,
    });
    state = applyAction(state, { type: "queueTask", taskId: "byteCopy" });
    state = tickGame(state, 16);

    expect(state.queue).toEqual(["byteCopy"]);
    expect(state.activeTasks).toHaveLength(1);
    expect(state.activeTasks.flatMap((task) => task.coreOperations)).not.toContainEqual(
      expect.objectContaining({ status: "deadlocked" }),
    );
  });

  it("deadlock-safe scheduler avoids queued cache footprints before writes exhaust", () => {
    let state = withSchedulerSlots(withExactByteCopyCache(completeStarterLadder()), 2);
    state = {
      ...state,
      flags: { ...state.flags, schedulerPolicies: true },
    };
    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "cpu",
      cpuId: 1,
      policy: "deadlockSafe",
    });

    state = applyAction(state, { type: "queueTask", taskId: "byteCopy" });
    state = applyAction(state, { type: "queueTask", taskId: "byteCopy" });
    state = tickGame(state, 16);

    expect(state.queue).toEqual(["byteCopy", "byteCopy"]);
    expect(state.activeTasks).toHaveLength(1);
    expect(state.activeTasks.flatMap((task) => task.coreOperations)).not.toContainEqual(
      expect.objectContaining({ status: "deadlocked" }),
    );
  });

  it("deadlock-safe system scheduler avoids queued RAM footprints before writes exhaust", () => {
    let state = withRamCapacity(unlockSystemScheduler(), 256);
    state = {
      ...state,
      flags: { ...state.flags, schedulerPolicies: true },
    };
    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "system",
      policy: "deadlockSafe",
    });

    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });
    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });
    state = tickGame(state, 16);

    expect(state.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(state.activeTasks).toHaveLength(1);
    expect(state.activeTasks.flatMap((task) => task.coreOperations)).not.toContainEqual(
      expect.objectContaining({ status: "deadlocked" }),
    );
  });

  it("system scheduler deadlock policy only gates RAM while CPU policy owns cache", () => {
    const tinyChecksum = getTaskDefinition("tinyChecksum");
    const makeState = () =>
      withPrimaryCpuCache(
        withRamCapacity(unlockSystemScheduler(), tinyChecksum.ramNeedBits * 2),
        tinyChecksum.cacheNeedBits,
      );
    const withSchedulerPolicies = (state: GameState): GameState => ({
      ...state,
      flags: { ...state.flags, schedulerPolicies: true },
    });
    const queueTwoChecksums = (state: GameState) => {
      let nextState = applyAction(state, {
        type: "queueTask",
        taskId: "tinyChecksum",
      });
      nextState = applyAction(nextState, {
        type: "queueTask",
        taskId: "tinyChecksum",
      });
      return tickGame(nextState, 16);
    };

    let systemSafeState = withSchedulerPolicies(makeState());
    systemSafeState = applyAction(systemSafeState, {
      type: "setSchedulerPolicy",
      target: "system",
      policy: "deadlockSafe",
    });
    systemSafeState = queueTwoChecksums(systemSafeState);

    expect(systemSafeState.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(systemSafeState.activeTasks).toHaveLength(2);

    let cpuSafeState = withSchedulerPolicies(makeState());
    cpuSafeState = applyAction(cpuSafeState, {
      type: "setSchedulerPolicy",
      target: "system",
      policy: "deadlockSafe",
    });
    cpuSafeState = applyAction(cpuSafeState, {
      type: "setSchedulerPolicy",
      target: "cpu",
      cpuId: 1,
      policy: "deadlockSafe",
    });
    cpuSafeState = queueTwoChecksums(cpuSafeState);

    expect(cpuSafeState.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(cpuSafeState.activeTasks).toHaveLength(1);
  });

  it("system scheduler watchdog ignores CPU-cache deadlocks owned by CPU scheduler", () => {
    const tinyChecksum = getTaskDefinition("tinyChecksum");
    let state = withPrimaryCpuCache(
      withRamCapacity(unlockSystemScheduler(), tinyChecksum.ramNeedBits * 2),
      tinyChecksum.cacheNeedBits,
    );
    state = {
      ...state,
      flags: { ...state.flags, schedulerWatchdog: true },
    };
    state = applyAction(state, {
      type: "setSchedulerAutoKill",
      target: "system",
      enabled: true,
    });
    state = applyAction(state, {
      type: "setSchedulerAutoKill",
      target: "cpu",
      cpuId: 1,
      enabled: true,
    });

    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });
    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });
    state = tickUntilDeadlock(state, "cache");

    const visible = deriveVisibleState(state);

    expect(visible.metrics.systemSchedulerWatchdog).toBeNull();
    expect(visible.metrics.cpuSockets[0]?.watchdog).toMatchObject({
      target: "cpu",
      cpuId: 1,
      resource: "cache",
      victimTaskId: "tinyChecksum",
    });
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

  it("requires purchased CPU scheduler slots before queueing CPU tasks", () => {
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

  it("uses separate system scheduler slots for whole system tasks", () => {
    let state = unlockRamControl();

    state = buy(state, "ram");
    state = buyAllRamStickUpgrade(state, "ramCapacity");
    state = buyAllRamStickUpgrade(state, "ramCapacity");
    state = research(fund(state), "systemScheduler");

    let visible = deriveVisibleState(state);
    let tinyChecksum = visible.tasks.find((task) => task.id === "tinyChecksum");

    expect(state.hardware.schedulerSlots).toBe(0);
    expect(state.hardware.systemSchedulerSlots).toBe(0);
    expect(visible.upgrades.map((upgrade) => upgrade.id)).toContain(
      "systemSchedulerSlot",
    );
    expect(tinyChecksum?.canQueue).toBe(false);
    expect(tinyChecksum?.queueBlockedReason).toBe("Buy system queue slots.");

    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });
    expect(state.queue).toEqual([]);

    state = buy(state, "systemSchedulerSlot");
    visible = deriveVisibleState(state);
    tinyChecksum = visible.tasks.find((task) => task.id === "tinyChecksum");

    expect(state.hardware.schedulerSlots).toBe(0);
    expect(state.hardware.systemSchedulerSlots).toBe(1);
    expect(tinyChecksum?.canQueue).toBe(true);

    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });
    visible = deriveVisibleState(state);

    expect(state.queue).toEqual(["tinyChecksum"]);
    expect(
      visible.tasks.find((task) => task.id === "tinyChecksum")?.queueBlockedReason,
    ).toBe("System scheduler slots full.");
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

  it("unlocks the vertical slice through RAM Control and System Scheduler", () => {
    let state = unlockMultiCore();

    expect(state.flags.multiCore).toBe(true);

    state = buy(buy(buy(state, "core"), "core"), "core");

    expect(state.hardware.cores).toBe(4);
    expect(state.flags.scheduler).toBe(false);

    state = research(state, "localScheduler");

    expect(state.flags.secondCpu).toBe(false);
    let visible = deriveVisibleState(state);
    expect(visible.research.map((item) => item.id)).toContain("ramControl");
    expect(visible.research.map((item) => item.id)).toContain("systemScheduler");
    expect(visible.research.find((item) => item.id === "ramControl")?.canBuy).toBe(
      true,
    );
    expect(
      visible.research.find((item) => item.id === "systemScheduler")?.canBuy,
    ).toBe(false);

    state = research(fund(state), "ramControl");

    expect(state.flags.systemStats).toBe(true);
    expect(state.hardware.ramBits).toBe(0);
    expect(state.hardware.ramBytes).toBe(0);
    expect(state.hardware.ramSpeedMt).toBe(1);
    expect(state.hardware.ramSticks).toEqual([]);
    expect(state.flags.scheduler).toBe(false);

    visible = deriveVisibleState(state);
    expect(
      visible.research.find((item) => item.id === "systemScheduler")?.blockedReason,
    ).toBe("Needs Install at least 1 Kb RAM.");
    expect(visible.upgrades.map((upgrade) => upgrade.id)).toContain("ram");
    expect(visible.upgrades.map((upgrade) => upgrade.id)).not.toContain("ramCapacity");
    expect(visible.upgrades.map((upgrade) => upgrade.id)).not.toContain("ramSpeed");
    expect(visible.upgrades.map((upgrade) => upgrade.id)).toContain("psu");

    state = buy(state, "ram");

    expect(state.hardware.ramBits).toBe(256);
    expect(state.hardware.ramBytes).toBe(32);
    expect(state.hardware.ramSpeedMt).toBe(1);
    expect(getRamLoadRate(state)).toBe(1);
    expect(state.hardware.ramSticks.map((stick) => stick.bits)).toEqual([256]);

    state = buyAllRamStickUpgrade(state, "ramCapacity");

    expect(state.hardware.ramBits).toBe(512);
    expect(state.hardware.ramBytes).toBe(64);
    expect(state.hardware.ramSpeedMt).toBe(1);
    expect(state.hardware.ramSticks.map((stick) => stick.bits)).toEqual([512]);

    state = buyAllRamStickUpgrade(state, "ramCapacity");

    expect(state.hardware.ramBits).toBe(1024);
    expect(state.hardware.ramBytes).toBe(128);
    expect(state.hardware.ramSticks.map((stick) => stick.bits)).toEqual([1024]);

    state = buyAllRamStickUpgrade(state, "ramSpeed");

    expect(state.hardware.ramSpeedLevel).toBe(2);
    expect(state.hardware.ramSpeedMt).toBe(2);
    expect(getRamLoadRate(state)).toBe(2);
    expect(new Set(state.hardware.ramSticks.map((stick) => stick.speedMt))).toEqual(
      new Set([2]),
    );

    state = buy(state, "schedulerSlot", undefined, 1);
    state = buy(state, "schedulerSlot", undefined, 1);

    state = research(fund(state), "systemScheduler");

    expect(state.flags.scheduler).toBe(true);
    visible = deriveVisibleState(state);
    const multiCoreComputeTask = visible.research
      .find((item) => item.id === "systemBus")
      ?.computeTasks.find((task) => task.id === "multiCoreBenchmark");
    expect(visible.upgrades.map((upgrade) => upgrade.id)).toContain(
      "systemSchedulerSlot",
    );
    expect(multiCoreComputeTask?.queueBlockedReason).toBe("Buy system queue slots.");
    expect(
      multiCoreComputeTask?.blockedReason,
    ).toBe("CPU scheduler needs 4 slots.");

    state = buy(state, "systemSchedulerSlot");
    state = buy(state, "schedulerSlot", undefined, 1);
    state = buy(state, "schedulerSlot", undefined, 1);

    state = runTask(state, "multiCoreBenchmark");
    visible = deriveVisibleState(state);
    expect(visible.research.find((item) => item.id === "systemBus")?.canBuy).toBe(
      true,
    );

    state = research(fund(state), "systemBus");
    visible = deriveVisibleState(state);
    const unmatchedCpuUpgrade = visible.upgrades.find(
      (upgrade) => upgrade.id === "secondCpu",
    );
    const matchedCpuUpgrade = visible.upgrades.find(
      (upgrade) => upgrade.id === "matchedCpu",
    );
    expect(visible.upgrades.map((upgrade) => upgrade.id)).toEqual(
      expect.arrayContaining(["secondCpu", "matchedCpu"]),
    );
    expect(unmatchedCpuUpgrade?.name).toBe("Unmatched CPU");
    expect(
      unmatchedCpuUpgrade?.costs.find((cost) => cost.resource === "credits")?.amount,
    ).toBe(900);
    expect(
      unmatchedCpuUpgrade?.costs.find((cost) => cost.resource === "data")?.amount,
    ).toBe(24);
    expect(unmatchedCpuUpgrade?.powerDeltaWatts).toBeGreaterThan(0);
    expect(matchedCpuUpgrade?.name).toBe("Matched CPU");
    expect(matchedCpuUpgrade?.powerDeltaWatts).toBeGreaterThan(0);
    expect(matchedCpuUpgrade?.powerDeltaWatts).not.toBe(
      unmatchedCpuUpgrade?.powerDeltaWatts,
    );
    expect(
      matchedCpuUpgrade?.costs.find((cost) => cost.resource === "credits")?.amount,
    ).toBeGreaterThan(900);
    expect(
      matchedCpuUpgrade?.costs.find((cost) => cost.resource === "data")?.amount,
    ).toBeGreaterThan(24);

    const unmatchedState = buy(state, "secondCpu");
    expect(unmatchedState.hardware.secondCpu).toBe(true);
    expect(unmatchedState.hardware.cpus).toHaveLength(2);
    expect(unmatchedState.hardware.cpus[1]?.coreIds).toEqual([5]);
    expect(unmatchedState.hardware.cpus[1]?.cacheLevel).toBe(1);
    expect(unmatchedState.hardware.cpus[1]?.schedulerSlots).toBe(0);

    state = buy(state, "matchedCpu");

    expect(state.flags.secondCpu).toBe(true);
    expect(state.hardware.secondCpu).toBe(true);
    expect(state.hardware.cpus).toHaveLength(2);
    expect(state.hardware.cpus[0]?.coreIds).toEqual([1, 2, 3, 4]);
    expect(state.hardware.cpus[1]?.coreIds).toEqual([5, 6, 7, 8]);
    expect(state.hardware.cpus[1]?.cacheLevel).toBe(
      state.hardware.cpus[0]?.cacheLevel,
    );
    expect(state.hardware.cpus[1]?.schedulerSlots).toBe(
      state.hardware.cpus[0]?.schedulerSlots,
    );
    visible = deriveVisibleState(state);
    expect(
      visible.research.filter((item) => !item.completed).map((item) => item.id),
    ).toContain("cronScheduler");
    expect(visible.upgrades.map((upgrade) => upgrade.id)).toContain("psu");
  });

  it("loads RAM-backed working sets slower than CPU cache", () => {
    const state = unlockRamControl();
    const task = getTaskDefinition("tinyChecksum");
    const ramOperation = task.operations.find(
      (operation) => operation.ramBits > 0,
    );

    expect(ramOperation).toBeDefined();
    expect(task.ramNeedBits).toBe(256);
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

  it("shows RAM load progress before CPU execution on RAM-backed tasks", () => {
    let state = unlockSystemScheduler();
    state = {
      ...state,
      hardware: {
        ...state.hardware,
        ramSpeedLevel: 7,
        ramSpeedMt: 64,
        ramSticks: state.hardware.ramSticks.map((stick) => ({
          ...stick,
          speedLevel: 7,
          speedMt: 64,
        })),
      },
    };

    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });

    let guard = 0;
    while (
      state.activeTasks[0]?.coreOperations[0]?.status !== "loadingRam" &&
      guard < 80
    ) {
      state = tickGame(state, 500);
      guard += 1;
    }

    expect(state.activeTasks[0]?.coreOperations[0]?.status).toBe("loadingRam");

    state = tickGame(state, 1000);

    let visible = deriveVisibleState(state);
    let segment = visible.metrics.ramResidency[0];
    const coreProgress = visible.activeTasks[0]?.coreProgress[0];

    expect(segment?.state).toBe("loading");
    expect(segment?.progress).toBeGreaterThan(0);
    expect(segment?.progress).toBeLessThan(1);
    expect(coreProgress?.progress).toBe(0);

    guard = 0;
    while (
      !(
        state.activeTasks[0]?.coreOperations[0]?.operationName === "Checksum Step" &&
        state.activeTasks[0]?.coreOperations[0]?.status === "running"
      ) &&
      guard < 80
    ) {
      state = tickGame(state, 500);
      guard += 1;
      expect(
        state.activeTasks[0]?.coreOperations[0]?.operationName === "Checksum Step" &&
          state.activeTasks[0]?.coreOperations[0]?.status === "loadingRam",
      ).toBe(false);
    }

    visible = deriveVisibleState(state);
    segment = visible.metrics.ramResidency[0];

    expect(visible.activeTasks[0]?.coreProgress[0]?.status).toBe("running");
    expect(segment?.state).toBe("loaded");

    state = tickGame(state, 500);
    expect(
      deriveVisibleState(state).activeTasks[0]?.coreProgress[0]?.progress,
    ).toBeGreaterThan(0);
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
    expect(state.queue).toEqual(["fetchBit", "decodeBit"]);
    expect(state.activeTasks.every((task) => task.schedulerQueued)).toBe(true);
    expect(Object.values(state.coreSchedulers).some((core) => core.status !== "idle")).toBe(true);

    state = finishActiveTasks(state);

    expect(state.queue).toHaveLength(0);
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

  it("upgrades and downgrades selected core clocks as a group", () => {
    const initial = createInitialGameState();
    let state = fund({
      ...initial,
      flags: {
        ...initial.flags,
        multiCore: true,
      },
    });

    state = buy(state, "core", undefined, 1);

    const groupedClock =
      deriveVisibleState(state).metrics.cpuSockets[0]?.allCoreClockUpgrade;
    const beforeBuyCredits = state.resources.credits;

    expect(costAmount(groupedClock?.costs ?? [], "credits")).toBe(28);

    state = applyAction(state, {
      type: "buyUpgrade",
      upgradeId: "clock",
      coreIds: [1, 2],
    });

    expect(state.hardware.coreClockLevels[1]).toBe(2);
    expect(state.hardware.coreClockLevels[2]).toBe(2);
    expect(beforeBuyCredits - state.resources.credits).toBe(28);

    const groupedDowngrade =
      deriveVisibleState(state).metrics.cpuSockets[0]?.allCoreClockUpgrade;
    const beforeDowngradeCredits = state.resources.credits;

    expect(costAmount(groupedDowngrade?.refunds ?? [], "credits")).toBe(14);

    state = applyAction(state, {
      type: "downgradeUpgrade",
      upgradeId: "clock",
      coreIds: [1, 2],
    });

    expect(state.hardware.coreClockLevels[1]).toBe(1);
    expect(state.hardware.coreClockLevels[2]).toBe(1);
    expect(state.resources.credits - beforeDowngradeCredits).toBe(14);
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

  it("downgrades reversible upgrades for half of the last purchase cost", () => {
    let state = fund(createInitialGameState());

    state = buy(state, "cache");
    const afterBuy = state.resources;

    state = applyAction(state, {
      type: "downgradeUpgrade",
      upgradeId: "cache",
      cpuId: 1,
    });

    expect(state.hardware.cacheLevel).toBe(1);
    expect(state.hardware.cacheBits).toBe(1);
    expect(state.resources.credits - afterBuy.credits).toBe(1);
    expect(state.resources.data - afterBuy.data).toBe(3);
  });

  it("blocks downgrades that would remove occupied scheduler capacity", () => {
    let state: GameState = {
      ...createInitialGameState(),
      flags: {
        ...createInitialGameState().flags,
        basicQueue: true,
      },
    };

    state = withSchedulerSlots(state, 1);
    state = applyAction(state, { type: "queueTask", taskId: "fetchBit", cpuId: 1 });
    state = applyAction(state, {
      type: "downgradeUpgrade",
      upgradeId: "schedulerSlot",
      cpuId: 1,
    });

    expect(state.hardware.schedulerSlots).toBe(1);
    expect(state.coreSchedulers[1]?.localQueue).toEqual(["fetchBit"]);
  });

  it("shows the core pickup blocker before free-cache pressure", () => {
    const initial = createInitialGameState();
    const byteCopy = getTaskDefinition("byteCopy");
    let state: GameState = {
      ...initial,
      research: {
        completed: ["byteOperations"],
      },
      hardware: {
        ...initial.hardware,
        cacheLevel: 5,
        cacheBits: byteCopy.cacheNeedBits,
        cacheBytes: byteCopy.cacheNeedBytes,
        cpus: initial.hardware.cpus.map((cpu) => ({
          ...cpu,
          cacheLevel: 5,
          cacheBits: byteCopy.cacheNeedBits,
          cacheBytes: byteCopy.cacheNeedBytes,
        })),
      },
    };

    state = applyAction(state, { type: "startTask", taskId: "byteCopy" });

    const visibleTask = deriveVisibleState(state).tasks.find(
      (task) => task.id === "byteCopy",
    );

    expect(state.activeTasks).toHaveLength(1);
    expect(visibleTask?.blockedReason).toBe("No idle core available.");
  });

  it("prices cache and RAM capacity with data-heavy costs and frequency with credits-only costs", () => {
    const starterVisible = deriveVisibleState(createInitialGameState());
    const cacheUpgrade = starterVisible.upgrades.find(
      (upgrade) => upgrade.id === "cache",
    );
    const cacheSpeedUpgrade = starterVisible.upgrades.find(
      (upgrade) => upgrade.id === "cacheSpeed",
    );
    const ramState = unlockRamControl();
    const ramVisible = deriveVisibleState(ramState);
    const installedRamVisible = deriveVisibleState(buy(ramState, "ram"));
    const ramUpgrade = ramVisible.upgrades.find((upgrade) => upgrade.id === "ram");
    const ramCapacityUpgrade = installedRamVisible.upgrades.find(
      (upgrade) => upgrade.id === "ramCapacity",
    );
    const ramSpeedUpgrade = installedRamVisible.upgrades.find(
      (upgrade) => upgrade.id === "ramSpeed",
    );

    for (const upgrade of [cacheUpgrade, ramUpgrade, ramCapacityUpgrade]) {
      expect(upgrade).toBeDefined();
      expect(costAmount(upgrade?.costs ?? [], "data")).toBeGreaterThan(
        costAmount(upgrade?.costs ?? [], "credits"),
      );
    }

    for (const upgrade of [cacheSpeedUpgrade, ramSpeedUpgrade]) {
      expect(upgrade).toBeDefined();
      expect(upgrade?.costs).toEqual([
        expect.objectContaining({ resource: "credits" }),
      ]);
    }
  });

  it("pays a multicore parent task once after all operation shards complete", () => {
    let state = unlockSystemScheduler();
    const task = getTaskDefinition("multiCoreBenchmark");
    const beforeCredits = state.resources.credits;
    const beforeData = state.resources.data;

    state = runTask(state, "multiCoreBenchmark");

    expect(task.rewardCredits).toBe(task.operationCount);
    expect(state.resources.credits - beforeCredits).toBeGreaterThan(0);
    expect(state.resources.credits - beforeCredits).toBeLessThan(task.rewardCredits);
    expect(state.resources.data - beforeData).toBe(task.rewardData);
    expect(state.completedTasks.multiCoreBenchmark).toBe(1);
  });

  it("keeps multicore task cores inside one CPU package", () => {
    let state = unlockSystemStats();
    state = {
      ...state,
      completedTasks: {
        ...state.completedTasks,
        multiCoreBenchmark: 0,
      },
      completedJobs: {
        ...state.completedJobs,
        multiCoreBenchmark: 0,
      },
      completedBenchmarks: state.completedBenchmarks.filter(
        (taskId) => taskId !== "multiCoreBenchmark",
      ),
    };

    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "fetchBit",
      coreId: 1,
    });
    state = applyAction(state, {
      type: "startTask",
      taskId: "multiCoreBenchmark",
    });

    const benchmarkTask = state.activeTasks.find(
      (task) => task.taskId === "multiCoreBenchmark",
    );

    expect(benchmarkTask?.assignedCoreIds).toEqual([5, 6, 7, 8]);
  });

  it("multicore barriers no longer corrupt or rerun shards", () => {
    let state = unlockSystemScheduler();

    state = applyAction(state, { type: "startTask", taskId: "multiCoreBenchmark" });
    state = finishActiveTasks(state);

    expect(state.completedBenchmarks).toContain("multiCoreBenchmark");
    expect(state.reliability.lastEvent).toBeNull();
  });

  it("scheduler watchdog can auto-kill a deadlocked scheduler-owned task", () => {
    let state = withSchedulerSlots(withExactByteCopyCache(completeStarterLadder()), 2);
    state = {
      ...state,
      flags: { ...state.flags, schedulerWatchdog: true },
    };
    state = applyAction(state, {
      type: "setSchedulerAutoKill",
      target: "cpu",
      cpuId: 1,
      enabled: true,
    });

    state = applyAction(state, { type: "queueTask", taskId: "byteCopy" });
    state = tickGame(state, 16);
    state = applyAction(state, { type: "queueTask", taskId: "byteCopy" });
    state = tickGame(state, 16);
    state = tickUntilDeadlock(state, "cache");

    const deadlockedInstanceId = state.activeTasks.find((task) =>
      task.coreOperations.some((operation) => operation.status === "deadlocked"),
    )?.instanceId;

    expect(deadlockedInstanceId).toBeDefined();

    state = tickGame(state, 1000);
    const watchdog = deriveVisibleState(state).metrics.cpuSockets[0]?.watchdog;

    expect(watchdog).toMatchObject({
      victimTaskId: "byteCopy",
      victimInstanceId: deadlockedInstanceId,
      victimCoreIds: [1],
      secondsRemaining: 2,
    });
    expect(watchdog?.progress).toBeCloseTo(1 / 3);

    for (let index = 0; index < 4; index += 1) {
      state = tickGame(state, 1000);
    }

    expect(state.activeTasks.map((task) => task.instanceId)).not.toContain(
      deadlockedInstanceId,
    );
    expect(state.activeTasks.flatMap((task) => task.coreOperations)).not.toContainEqual(
      expect.objectContaining({ status: "deadlocked" }),
    );
  });

  it("scheduler watchdog newest-blocker policy kills the resource holder", () => {
    let state = withSchedulerSlots(withExactByteCopyCache(completeStarterLadder()), 2);
    state = {
      ...state,
      flags: { ...state.flags, schedulerWatchdog: true },
    };
    state = applyAction(state, {
      type: "setSchedulerAutoKill",
      target: "cpu",
      cpuId: 1,
      enabled: true,
    });
    state = applyAction(state, {
      type: "setSchedulerKillPolicy",
      target: "cpu",
      cpuId: 1,
      killPolicy: "newestBlocker",
    });

    state = applyAction(state, { type: "queueTask", taskId: "byteCopy" });
    state = tickGame(state, 16);
    state = applyAction(state, { type: "queueTask", taskId: "byteCopy" });
    state = tickGame(state, 16);
    state = tickUntilDeadlock(state, "cache");

    const deadlockedInstanceId = state.activeTasks.find((task) =>
      task.coreOperations.some((operation) => operation.status === "deadlocked"),
    )?.instanceId;
    const blockerInstanceId = state.activeTasks.find(
      (task) => task.instanceId !== deadlockedInstanceId,
    )?.instanceId;

    for (let index = 0; index < 4; index += 1) {
      state = tickGame(state, 1000);
    }

    expect(state.activeTasks.map((task) => task.instanceId)).not.toContain(
      blockerInstanceId,
    );
    expect(state.activeTasks.map((task) => task.instanceId)).toContain(
      deadlockedInstanceId,
    );
  });

  it("shortest task and smallest memory scheduler policies reorder queued entries", () => {
    let state = withSchedulerSlots(completeStarterLadder(), 2);
    state = {
      ...state,
      flags: { ...state.flags, basicQueue: true, schedulerPolicies: true },
    };

    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "cpu",
      cpuId: 1,
      policy: "shortestTask",
    });
    state = applyAction(state, { type: "queueTask", taskId: "byteCopy" });
    state = applyAction(state, { type: "queueTask", taskId: "fetchBit" });
    state = tickGame(state, 16);

    expect(state.activeTasks[0]?.taskId).toBe("fetchBit");

    state = finishActiveTasks(state);
    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "cpu",
      cpuId: 1,
      policy: "smallestMemory",
    });
    state = applyAction(state, { type: "queueTask", taskId: "byteCopy" });
    state = applyAction(state, { type: "queueTask", taskId: "fetchBit" });
    state = tickGame(state, 16);

    expect(state.activeTasks[0]?.taskId).toBe("fetchBit");
  });

  it("power transitions block starts, queue pulls, and CRON while graceful shutdown drains active work", () => {
    let state = unlockSystemStats();

    state = applyAction(state, { type: "startTask", taskId: "decodeBit" });
    expect(state.activeTasks.map((task) => task.taskId)).toContain("decodeBit");

    const activeInstanceId = state.activeTasks[0]?.instanceId;
    const completedBefore = state.completedTasks.decodeBit ?? 0;

    state = applyAction(state, { type: "requestShutdown" });
    expect(state.power.state).toBe("shuttingDown");

    state = applyAction(state, { type: "startTask", taskId: "fetchBit" });
    state = applyAction(state, { type: "queueTask", taskId: "fetchBit" });

    expect(state.activeTasks.map((task) => task.instanceId)).toContain(
      activeInstanceId,
    );
    expect(state.activeTasks.map((task) => task.taskId)).not.toContain("fetchBit");
    expect(state.queue.filter((taskId) => taskId === "fetchBit")).toHaveLength(0);

    for (let attempt = 0; attempt < 120 && state.activeTasks.length > 0; attempt += 1) {
      expect(state.power.state).toBe("shuttingDown");
      state = tickGame(state, 1000);
    }

    expect(state.completedTasks.decodeBit ?? 0).toBeGreaterThan(completedBefore);
    state = tickSeconds(state, 8);
    state = tickGame(state, 16);

    expect(state.activeTasks).toHaveLength(0);
    expect(state.power.state).toBe("off");
    expect(deriveVisibleState(state).metrics.powerUsedWatts).toBe(0);

    state = applyAction(state, { type: "requestStartup" });
    expect(state.power.state).toBe("booting");

    state = applyAction(state, { type: "startTask", taskId: "fetchBit" });
    expect(state.activeTasks.map((task) => task.taskId)).not.toContain("fetchBit");

    state = tickSeconds(state, 10);
    expect(state.power.state).toBe("on");
  });

  it("idle power billing drains positive credits from the first screen", () => {
    const initial = createInitialGameState();
    let state: GameState = {
      ...initial,
      resources: { credits: 10, data: 0 },
      power: {
        ...initial.power,
        bootstrapGraceSeconds: 0,
      },
    };
    const expectedCostPerSecond = getPowerCostPerSecond(state);

    expect(expectedCostPerSecond).toBeGreaterThan(0);
    expect(deriveVisibleState(state).metrics.powerCostPerSecond).toBe(
      expectedCostPerSecond,
    );

    state = tickSeconds(state, 5);

    expect(state.power.state).toBe("on");
    expect(10 - state.resources.credits).toBeCloseTo(expectedCostPerSecond * 5);
  });

  it("clamps credits at 0 when power billing overruns the balance", () => {
    const initial = createInitialGameState();
    const costPerSecond = getPowerCostPerSecond(initial);
    let state: GameState = {
      ...initial,
      resources: { credits: costPerSecond / 2, data: 0 },
      power: {
        ...initial.power,
        bootstrapGraceSeconds: 0,
      },
    };

    state = tickSeconds(state, 1);

    expect(state.resources.credits).toBe(0);
    expect(state.resources.credits).toBeGreaterThanOrEqual(0);
  });

  it("auto-shuts down immediately on an unpaid bill and pauses active work", () => {
    let state = applyAction(createInitialGameState(), {
      type: "startTask",
      taskId: "fetchBit",
    });
    state = {
      ...state,
      resources: {
        credits: getPowerCostPerSecond(state) / 2,
        data: 0,
      },
      power: {
        ...state.power,
        bootstrapGraceSeconds: 0,
      },
    };
    const operationBefore = state.activeTasks[0]?.coreOperations[0];
    const remainingBefore =
      (operationBefore?.remainingCycles ?? 0) +
      (operationBefore?.remainingLoadCycles ?? 0);

    state = tickSeconds(state, 1);

    const operationAfter = state.activeTasks[0]?.coreOperations[0];
    const remainingAfter =
      (operationAfter?.remainingCycles ?? 0) +
      (operationAfter?.remainingLoadCycles ?? 0);

    expect(state.power.state).toBe("off");
    expect(state.power.transitionSeconds).toBe(0);
    expect(state.power.lastFailureReason).toBe("unpaidBill");
    expect(state.power.failureCount).toBe(1);
    expect(state.resources.credits).toBe(0);
    expect(remainingAfter).toBe(remainingBefore);

    state = applyAction(state, { type: "acknowledgePowerFailure" });
    expect(state.power.lastFailureReason).toBeNull();
  });

  it("grants bootstrap grace when starting up at 0 credits", () => {
    const initial = createInitialGameState();
    let state: GameState = {
      ...initial,
      resources: { credits: 0, data: 0 },
      power: {
        ...initial.power,
        state: "off",
        transitionSeconds: 0,
        bootstrapGraceSeconds: 0,
      },
    };

    state = applyAction(state, { type: "requestPowerOn" });

    expect(state.power.state).toBe("booting");
    expect(state.power.bootstrapGraceSeconds).toBeGreaterThan(0);

    const graceBefore = state.power.bootstrapGraceSeconds;
    state = tickSeconds(state, 1);

    expect(state.power.state).toBe("booting");
    expect(state.resources.credits).toBe(0);
    expect(state.power.bootstrapGraceSeconds).toBeLessThan(graceBefore);
  });

  it("exits bootstrap grace after earning credits", () => {
    const initial = createInitialGameState();
    let state: GameState = {
      ...initial,
      resources: { credits: 0, data: 0 },
      power: {
        ...initial.power,
        bootstrapGraceSeconds: POWER_BOOTSTRAP_GRACE_SECONDS,
      },
    };

    expect(state.power.bootstrapGraceSeconds).toBeGreaterThan(0);

    state = runTask(state, "fetchBit");

    expect(state.resources.credits).toBeGreaterThan(0);
    expect(state.power.bootstrapGraceSeconds).toBe(0);

    const beforeCredits = state.resources.credits;
    state = tickSeconds(state, 1);

    expect(state.resources.credits).toBeLessThan(beforeCredits);
  });

  it("expires bootstrap grace into an immediate shutdown at 0 credits", () => {
    const initial = createInitialGameState();
    let state: GameState = {
      ...initial,
      resources: { credits: 0, data: 0 },
      power: {
        ...initial.power,
        bootstrapGraceSeconds: 1,
      },
    };

    state = tickSeconds(state, 1);

    expect(state.power.state).toBe("off");
    expect(state.power.transitionSeconds).toBe(0);
    expect(state.resources.credits).toBe(0);
  });

  it("increases power draw and billing cost with core clock upgrades", () => {
    let state = fund(createInitialGameState());
    const before = deriveVisibleState(state).metrics;

    state = buy(state, "clock");

    const after = deriveVisibleState(state).metrics;

    expect(after.powerUsedWatts).toBeGreaterThan(before.powerUsedWatts);
    expect(after.powerCostPerSecond).toBeGreaterThan(before.powerCostPerSecond);
  });

  it("builds PSU overload failure pressure then hard-powers off at ten seconds", () => {
    let state = withPsuStress(fund(createInitialGameState()), 1.001);

    expect(getPsuStress(state)).toBeGreaterThan(1);

    state = tickSeconds(state, 9);

    expect(state.power.overloadFailureSeconds).toBeGreaterThan(8.9);
    expect(state.power.overloadFailureSeconds).toBeLessThan(10);
    expect(deriveVisibleState(state).metrics.powerOverloadFailure.tripped).toBe(
      false,
    );

    state = tickSeconds(state, 1);

    expect(state.power.state).toBe("off");
    expect(state.power.overloadFailureSeconds).toBe(0);
    expect(state.power.lastFailureReason).toBe("psuOverload");
    expect(state.power.failureCount).toBe(1);
    expect(deriveVisibleState(state).metrics.powerOverloadFailure.active).toBe(false);

    state = applyAction(state, { type: "acknowledgePowerFailure" });
    expect(state.power.lastFailureReason).toBeNull();
  });

  it("hits PSU overload failure faster when draw is farther over capacity", () => {
    let slowOverload = withPsuStress(fund(createInitialGameState()), 1.1);
    let fastOverload = withPsuStress(fund(createInitialGameState()), 1.3);

    slowOverload = tickSeconds(slowOverload, 8);
    fastOverload = tickSeconds(fastOverload, 8);

    expect(slowOverload.power.overloadFailureSeconds).toBeCloseTo(8.8);
    expect(fastOverload.power.state).toBe("off");
    expect(fastOverload.power.overloadFailureSeconds).toBe(0);
  });

  it("cools PSU overload failure pressure when draw returns under capacity", () => {
    let state = withPsuStress(fund(createInitialGameState()), 1.3);

    state = tickSeconds(state, 4);
    expect(state.power.overloadFailureSeconds).toBeCloseTo(5.2);

    state = {
      ...state,
      hardware: {
        ...state.hardware,
        psuWatts: getHardwareDrawWatts(state) / 0.5,
      },
    };
    state = tickSeconds(state, 2);

    expect(getPsuStress(state)).toBeLessThan(1);
    expect(state.power.overloadFailureSeconds).toBeCloseTo(3.2);
    expect(deriveVisibleState(state).metrics.powerOverloadFailure.active).toBe(true);

    state = tickSeconds(state, 4);

    expect(state.power.overloadFailureSeconds).toBe(0);
    expect(deriveVisibleState(state).metrics.powerOverloadFailure.active).toBe(
      false,
    );
  });

  it("clears active and queued work on PSU failure", () => {
    let state = withSchedulerSlots(fund(createInitialGameState()), 1);
    state = {
      ...state,
      flags: { ...state.flags, basicQueue: true },
    };
    state = applyAction(state, { type: "startTask", taskId: "fetchBit" });
    state = applyAction(state, { type: "queueTask", taskId: "fetchBit" });
    state = {
      ...state,
      hardware: {
        ...state.hardware,
        clockLevel: 20,
        clockHz: getClockHz(20),
        coreClockLevels: { ...state.hardware.coreClockLevels, 1: 20 },
        psuWatts: 0.001,
      },
      power: {
        ...state.power,
        bootstrapGraceSeconds: 0,
      },
    };

    expect(state.activeTasks.length).toBeGreaterThan(0);
    expect(state.queue.length).toBeGreaterThan(0);

    state = tickSeconds(state, 2);

    expect(state.power.state).toBe("off");
    expect(state.activeTasks).toHaveLength(0);
    expect(state.activeJobs).toHaveLength(0);
    expect(state.queue).toHaveLength(0);
    expect(
      Object.values(state.coreSchedulers).every(
        (scheduler) =>
          scheduler.localQueue.length === 0 && scheduler.status === "idle",
      ),
    ).toBe(true);
  });

  it("uses the PSU kill switch as an immediate hard power off", () => {
    let state = withSchedulerSlots(fund(createInitialGameState()), 1);
    state = {
      ...state,
      flags: { ...state.flags, basicQueue: true },
    };
    state = applyAction(state, { type: "startTask", taskId: "fetchBit" });
    state = applyAction(state, { type: "queueTask", taskId: "fetchBit" });

    state = applyAction(state, { type: "requestPowerKill" });

    expect(state.power.state).toBe("off");
    expect(state.power.transitionSeconds).toBe(0);
    expect(state.power.lastFailureReason).toBeNull();
    expect(state.power.failureCount).toBe(0);
    expect(state.activeTasks).toHaveLength(0);
    expect(state.queue).toHaveLength(0);
  });

  it("CRON scheduler clamps intervals, queues visible system work, and skips duplicates", () => {
    let state = unlockSystemStats();
    state = {
      ...state,
      hardware: {
        ...state.hardware,
        psuWatts: Math.max(state.hardware.psuWatts, getHardwareDrawWatts(state) * 2),
      },
    };

    state = runTask(state, "tinyChecksum");
    state = research(fund(state), "cronScheduler");

    expect(state.flags.cron).toBe(true);
    expect(state.flags.autoRepeat).toBe(true);
    expect(state.hardware.cronScheduleSlots).toBe(0);
    expect(state.cron.schedules).toHaveLength(0);
    expect(deriveVisibleState(state).upgrades.map((upgrade) => upgrade.id)).toContain(
      "cronSchedule",
    );

    state = buy(state, "cronSchedule");

    expect(state.hardware.cronScheduleSlots).toBe(1);
    expect(state.cron.schedules).toHaveLength(1);
    expect(deriveVisibleState(state).cron.taskOptions.map((task) => task.id)).toEqual(
      expect.arrayContaining([
        "memoryScrub",
        "queueCompaction",
        "powerTelemetry",
        "busMirror",
        "shardReconcile",
      ]),
    );

    state = applyAction(state, {
      type: "setCronInterval",
      scheduleId: 1,
      intervalMode: "seconds",
      intervalValue: 1,
    });

    expect(state.cron.schedules[0]?.intervalValue).toBe(60);

    state = buy(state, "cronInterval");
    state = applyAction(state, {
      type: "setCronInterval",
      scheduleId: 1,
      intervalMode: "seconds",
      intervalValue: 1,
    });

    expect(state.cron.schedules[0]?.intervalValue).toBe(59);

    state = applyAction(state, {
      type: "setCronTask",
      scheduleId: 1,
      taskId: "memoryScrub",
    });
    state = applyAction(state, {
      type: "setCronEnabled",
      scheduleId: 1,
      enabled: true,
    });

    state = tickSeconds(state, 59);

    expect(state.activeTasks.map((task) => task.taskId)).toContain("memoryScrub");
    expect(state.cron.schedules[0]?.lastResult).toMatchObject({
      status: "queued",
      taskId: "memoryScrub",
    });
    expect(state.cron.queuePowerSpikeSeconds).toBeGreaterThan(0);

    state = {
      ...state,
      cron: {
        ...state.cron,
        schedules: state.cron.schedules.map((schedule) => ({
          ...schedule,
          remainingSeconds: 0,
        })),
      },
    };
    state = tickGame(state, 16);

    expect(state.cron.schedules[0]?.lastResult).toMatchObject({
      status: "skipped",
      taskId: "memoryScrub",
    });
  });

  it("defers thermal research and cooling upgrades after the second CPU", () => {
    const state = unlockSystemStats();
    const visible = deriveVisibleState(state);

    expect(
      visible.research.filter((item) => !item.completed).map((item) => item.id),
    ).toContain("cronScheduler");
    expect(visible.tasks.map((task) => task.id)).not.toContain("thermalProbe");
    expect(visible.upgrades.map((upgrade) => upgrade.id)).not.toContain("cooling");
    expect(visible.flags.cooling).toBe(false);
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
