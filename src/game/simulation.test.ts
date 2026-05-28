import { describe, expect, it } from "vitest";
import {
  applyAction,
  CLICK_RATE_MAX_LEVEL,
  createInitialGameState,
  createRackReadyGameState,
  DEV_RESOURCE_GRANT_AMOUNT,
  deriveVisibleState,
  getClickRateHz,
  getClickRateUpgradeCost,
  deserializeSave,
  RACK_READY_SEED_CREDITS,
  serializeSave,
  tickGame,
} from "./index";
import {
  BOOTLOADER_MAX_LEVEL,
  getBootSeconds,
  getBootloaderUpgradeCost,
  getGlobalBootloaderLevel,
} from "./bootloader";
import { getGlobalCStateLevel } from "./cState";
import { getTaskDefinition, taskDefinitions } from "./content/tasks";
import {
  componentSkus,
  getComponentSku,
  getMachineSelectionCost,
  getMachineTemplate,
} from "./content/machines";
import {
  CPU_TIER_MAX_LEVEL,
  cpuTierDefinitions,
  getCStateIdleMultiplier,
  getCStateUpgradeCost,
  getCpuTierLevelDefinition,
} from "./content/cpuTiers";
import {
  getMemoryVoltageCost,
  getMemoryVoltageIdleMultiplier,
} from "./content/ramTuning";
import {
  getRamTierFirstGlobalLevel,
  getRamTierLevelDefinition,
} from "./content/ramTiers";
import { getPsuCapacityBuildCost } from "./content/psu";
import { getCpuSchedulerSlotBuildCost } from "./content/scheduler";
import {
  allocateRamBlocksForOperation,
  getCacheLoadCycles,
  getCacheLoadCyclesForBits,
  getCacheLoadRate,
  getHardwareDrawWatts,
  getPowerCostPerSecond,
  getPsuStress,
  getRamBlockLoadDeltasForOperationTick,
  getRamLoadCycles,
  getRamLoadRate,
} from "./math";
import {
  createRamStickState,
  createSchedulerConfig,
  getCoreClockHz,
  getCpuClockHz,
  getMaxUnlockedRamLevel,
  getClockHz,
  getRamInstallLevel,
  getPsuWatts,
  getRamBits,
  getRamSpeedMt,
  POWER_BOOTSTRAP_GRACE_SECONDS,
  POWER_UNPAID_SHUTDOWN_WARNING_SECONDS,
  syncCoreSchedulers,
} from "./progression";
import type {
  ActiveCoreOperation,
  ActiveTask,
  GameState,
  OperationRuntimeStatus,
  RamBlockAllocation,
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

const taskMatchesRuntime = (task: ActiveTask, taskId: TaskId) =>
  task.taskId === taskId || task.parentTaskId === taskId;

const getActiveRuntimeTasks = (state: GameState, taskId: TaskId) =>
  state.activeTasks.filter((task) => taskMatchesRuntime(task, taskId));

const findActiveRuntimeTask = (state: GameState, taskId: TaskId) =>
  state.activeTasks.find((task) => taskMatchesRuntime(task, taskId));

const getLocalQueueTaskIds = (state: GameState) =>
  Object.values(state.coreSchedulers).flatMap((core) => core.localQueue);

const getLocalQueueEntries = (state: GameState) =>
  Object.values(state.coreSchedulers).flatMap(
    (core) => core.localQueueEntries ?? [],
  );

const getLocalQueueEntriesForCpu = (state: GameState, cpuId: number) => {
  const cpu = state.hardware.cpus.find((candidate) => candidate.id === cpuId);
  return (
    cpu?.coreIds.flatMap(
      (coreId) => state.coreSchedulers[coreId]?.localQueueEntries ?? [],
    ) ?? []
  );
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
        taskMatchesRuntime(task, taskId) &&
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
        taskMatchesRuntime(task, taskId) &&
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
  task.coreScaling === "chunked"
    ? task.subtasks.reduce((total, subtask) => {
        const composition = task.composition.find(
          (entry) => entry.taskId === subtask.sourceTaskId,
        );
        const scale = composition?.mode === "perWorkUnit" ? task.workUnitCount : 1;
        return total + subtask.operationCount * scale;
      }, 0)
    : getExpectedCpuWork(task) +
      getExpectedCacheLoadWork(task) +
      getExpectedRamProfile(task).loadWork;

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
  resources: { credits: 1_000_000_000_000, data: 1_000_000_000_000 },
  hardware: {
    ...state.hardware,
    psuWatts: Math.max(state.hardware.psuWatts, 1),
  },
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

const withRamSticks = (
  state: GameState,
  ramSticks: GameState["hardware"]["ramSticks"],
): GameState => {
  const ramBits = ramSticks.reduce((total, stick) => total + stick.bits, 0);
  const ramSpeedMt =
    ramSticks.length > 0
      ? Math.max(...ramSticks.map((stick) => stick.speedMt))
      : state.hardware.ramSpeedMt;
  const ramSpeedLevel =
    ramSticks.length > 0
      ? Math.max(...ramSticks.map((stick) => stick.speedLevel))
      : state.hardware.ramSpeedLevel;

  return {
    ...state,
    hardware: {
      ...state.hardware,
      ramLevel: ramSticks.length,
      ramBits,
      ramBytes: Math.ceil(ramBits / 8),
      ramSpeedLevel,
      ramSpeedMt,
      ramSticks,
    },
  };
};

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

const createLoadingRamOperation = (
  coreId: number,
  ramBlocks: RamBlockAllocation[],
  ramChannelCount: number,
  operationIndex = 0,
): ActiveCoreOperation => {
  const memoryReservedBits = ramBlocks.reduce(
    (total, block) => total + Math.max(0, block.lengthBits),
    0,
  );

  return {
    coreId,
    operationIndex,
    operationId: "test:ram-load",
    operationName: "Test RAM Load",
    status: "loadingRam",
    memoryState: "ramLoad",
    remainingCycles: 0,
    totalCycles: 0,
    remainingLoadCycles: ramBlocks.reduce(
      (total, block) =>
        total + Math.max(0, block.lengthBits - block.loadedBits),
      0,
    ),
    totalLoadCycles: memoryReservedBits,
    memoryReservedBits,
    memoryReservedBytes: Math.ceil(memoryReservedBits / 8),
    ramBlocks,
    ramChannelCount,
    lockResource: null,
    lockReason: null,
    deadlockSeconds: 0,
  };
};

const createActiveRamTask = (
  instanceId: string,
  coreId: number,
  operation: ActiveCoreOperation,
): ActiveTask => ({
  instanceId,
  taskId: "tinyChecksum",
  jobId: "tinyChecksum",
  schedulerQueued: true,
  coreId,
  assignedCoreIds: [coreId],
  coreOperations: [operation],
  remainingCycles: operation.remainingCycles,
  totalCycles: operation.totalCycles,
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
  state = buy(state, "secondCpu");

  return fund(state);
};

const withSystemCatalog = (state: GameState): GameState => ({
  ...state,
  flags: {
    ...state.flags,
    systemCatalog: true,
    customMachineAssembly: true,
  },
  research: {
    ...state.research,
    completed: Array.from(new Set([...state.research.completed, "systemCatalog"])),
  },
});

describe("IdleBit simulation", () => {
  it("grants 100B of the requested resource through the dev resource action", () => {
    const state = createInitialGameState();
    const credited = applyAction(state, {
      type: "grantDevResource",
      resource: "credits",
    });
    const dataGranted = applyAction(state, {
      type: "grantDevResource",
      resource: "data",
    });

    expect(credited.resources.credits).toBe(
      state.resources.credits + DEV_RESOURCE_GRANT_AMOUNT,
    );
    expect(credited.resources.data).toBe(state.resources.data);
    expect(dataGranted.resources.credits).toBe(state.resources.credits);
    expect(dataGranted.resources.data).toBe(
      state.resources.data + DEV_RESOURCE_GRANT_AMOUNT,
    );
  });

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

  it("loads CPU tier package data and starter micro-watt balance", () => {
    const state = createInitialGameState();
    const visible = deriveVisibleState(state);
    const socket = visible.metrics.cpuSockets[0];

    expect(cpuTierDefinitions.map((tier) => [tier.id, tier.levels.length])).toEqual([
      ["hz", CPU_TIER_MAX_LEVEL],
      ["khz", CPU_TIER_MAX_LEVEL],
      ["mhz", CPU_TIER_MAX_LEVEL],
      ["ghz", CPU_TIER_MAX_LEVEL],
      ["thz", CPU_TIER_MAX_LEVEL],
      ["phz", CPU_TIER_MAX_LEVEL],
    ]);
    expect(getCpuTierLevelDefinition("hz", 1)).toEqual(
      expect.objectContaining({ upgradeCost: 8, clockHz: 1, efficiency: 10 }),
    );
    expect(getCpuTierLevelDefinition("khz", 1)).toEqual(
      expect.objectContaining({ upgradeCost: 32_000, clockHz: 1_000, efficiency: 6 }),
    );
    expect(getCpuTierLevelDefinition("mhz", 1).upgradeCost).toBe(126_000_000);
    expect(state.hardware.psuWatts).toBe(0.00001);
    expect(getPsuWatts(2)).toBe(0.000017);
    expect(getHardwareDrawWatts(state)).toBe(0.0000001);
    expect(getPowerCostPerSecond(state)).toBe(0.1);
    expect(socket).toEqual(
      expect.objectContaining({
        tierId: "hz",
        tierName: "Hz CPU",
        level: 1,
        clockHz: 1,
        efficiency: 10,
      }),
    );
    expect(socket?.activeDrawWatts).toBeCloseTo(0.0000001);
    expect(socket?.idleDrawWatts).toBeCloseTo(0.0000001);
  });

  it("promotes old starter PSU saves to the current capacity curve", () => {
    const state = createInitialGameState();
    const restored = deserializeSave(
      JSON.stringify({
        ...state,
        hardware: {
          ...state.hardware,
          psuLevel: 1,
          psuWatts: 0.0000001,
        },
      }),
    );

    expect(restored.hardware.psuLevel).toBe(1);
    expect(restored.hardware.psuWatts).toBe(getPsuWatts(1));
  });

  it("restores bootloader research and levels from current saves", () => {
    const state = createInitialGameState();
    const savedState: GameState = {
      ...state,
      flags: {
        ...state.flags,
        scheduler: true,
        bootloader: true,
      },
      research: {
        completed: ["systemScheduler", "bootloader"],
      },
      hardware: {
        ...state.hardware,
        bootloaderLevel: 36,
      },
      systems: state.systems.map((system) => ({
        ...system,
        hardware: {
          ...system.hardware,
          bootloaderLevel: 36,
        },
      })),
    };

    const restored = deserializeSave(serializeSave(savedState));

    expect(restored.research.completed).toContain("bootloader");
    expect(restored.flags.bootloader).toBe(true);
    expect(getGlobalBootloaderLevel(restored)).toBe(36);
    expect(getBootSeconds(restored)).toBe(0.1);
  });

  it("unlocks kHz CPU research without changing existing system CPU install tier", () => {
    let state = fund(createInitialGameState());

    expect(
      deriveVisibleState(state).research.map((item) => item.id),
    ).not.toContain("cpuTierKhz");

    const automationState = research(fund(unlockSystemStats()), "cronScheduler");
    expect(
      deriveVisibleState(automationState).research.find(
        (item) => item.id === "cpuTierKhz",
      )?.canBuy,
    ).toBe(true);

    state = {
      ...state,
      flags: {
        ...state.flags,
        cron: true,
        autoRepeat: true,
        secondCpu: true,
      },
      research: {
        completed: ["cronScheduler"],
      },
    };

    let visible = deriveVisibleState(state);
    const khzResearch = visible.research.find((item) => item.id === "cpuTierKhz");

    expect(state.hardware.cpus[0]?.level).toBe(1);
    expect(khzResearch?.costs).toEqual([{ resource: "credits", amount: 2_000_000 }]);
    expect(khzResearch?.canBuy).toBe(true);

    state = research(state, "cpuTierKhz");
    let chainState: GameState = {
      ...state,
      resources: {
        ...state.resources,
        credits: RACK_READY_SEED_CREDITS,
      },
    };
    const chainedTierResearch: ResearchId[] = [
      "cpuTierMhz",
      "cpuTierGhz",
      "cpuTierThz",
      "cpuTierPhz",
    ];
    chainedTierResearch.forEach((researchId) => {
      const nextResearch = deriveVisibleState(chainState).research.find(
        (item) => item.id === researchId,
      );

      expect(nextResearch?.canBuy).toBe(true);
      chainState = research(chainState, researchId);
    });

    state = {
      ...state,
      flags: { ...state.flags, secondCpu: true },
    };
    state = buy(state, "secondCpu");

    expect(state.hardware.cpus[1]).toEqual(
      expect.objectContaining({
        tierId: "hz",
        level: 1,
        coreIds: [2],
      }),
    );
    expect(getCpuClockHz("hz", state.hardware.cpus[1]?.level ?? 1)).toBe(1);

    visible = deriveVisibleState(state);
    expect(visible.research.find((item) => item.id === "cStateControl")?.costs).toEqual([
      { resource: "credits", amount: 10_000_000 },
    ]);
  });

  it("reduces only idle CPU draw with C-State upgrades", () => {
    let state = fund({
      ...createInitialGameState(),
      flags: {
        ...createInitialGameState().flags,
        cStateControl: true,
      },
      research: {
        completed: ["cpuTierKhz", "cStateControl"],
      },
    });
    let visible = deriveVisibleState(state);
    const cStateResearch = visible.research.find(
      (item) => item.id === "cStateControl",
    );

    expect(cStateResearch).toEqual(
      expect.objectContaining({
        completed: false,
        actionLabel: "Level up",
        costs: getCStateUpgradeCost(1),
      }),
    );
    expect(visible.upgrades.map((upgrade) => upgrade.id)).not.toContain("cState");

    const before = visible.metrics.cpuSockets[0]!;

    state = research(state, "cStateControl");

    visible = deriveVisibleState(state);
    const after = visible.metrics.cpuSockets[0]!;
    expect(getCStateIdleMultiplier(1)).toBeLessThan(1);
    expect(state.hardware.cStateLevel).toBe(1);
    expect(after.activeDrawWatts).toBe(before.activeDrawWatts);
    expect(after.idleDrawWatts).toBeLessThan(before.idleDrawWatts);

    const maxedState = {
      ...state,
      hardware: {
        ...state.hardware,
        cStateLevel: CPU_TIER_MAX_LEVEL,
      },
    };
    expect(
      deriveVisibleState(maxedState).research.find(
        (item) => item.id === "cStateControl",
      ),
    ).toEqual(
      expect.objectContaining({
        completed: true,
        canBuy: false,
      }),
    );

    state = applyAction(state, { type: "startTask", taskId: "fetchBit" });
    const activeSocket = deriveVisibleState(state).metrics.cpuSockets[0]!;
    expect(activeSocket.activeDrawWatts).toBe(after.activeDrawWatts);
  });

  it("applies C-State levels globally across rack systems", () => {
    let state = createRackReadyGameState();
    state = fund({
      ...state,
      flags: {
        ...state.flags,
        cStateControl: true,
      },
      research: {
        completed: Array.from(
          new Set([...state.research.completed, "cStateControl"]),
        ),
      },
      hardware: {
        ...state.hardware,
        cStateLevel: 0,
      },
      systems: state.systems.map((system) => ({
        ...system,
        hardware: {
          ...system.hardware,
          cStateLevel: 0,
        },
      })),
    });

    const secondSystemBefore = applyAction(state, {
      type: "selectSystem",
      systemId: 2,
    });
    const beforeSocket = deriveVisibleState(secondSystemBefore).metrics.cpuSockets[0]!;

    state = applyAction(state, {
      type: "buyResearch",
      researchId: "cStateControl",
    });

    expect(getGlobalCStateLevel(state)).toBe(1);
    expect(state.systems.map((system) => system.hardware.cStateLevel)).toEqual([
      1,
      1,
    ]);

    state = applyAction(state, { type: "selectSystem", systemId: 2 });
    const visible = deriveVisibleState(state);
    const afterSocket = visible.metrics.cpuSockets[0]!;

    expect(state.hardware.cStateLevel).toBe(1);
    expect(afterSocket.activeDrawWatts).toBe(beforeSocket.activeDrawWatts);
    expect(afterSocket.idleDrawWatts).toBeLessThan(beforeSocket.idleDrawWatts);
    expect(
      visible.research.find((item) => item.id === "cStateControl")?.costs,
    ).toEqual(getCStateUpgradeCost(2));
  });

  it("unlocks and levels manual click rate tuning after Local Scheduler", () => {
    let state = fund(unlockMultiCore());

    expect(
      deriveVisibleState(state).research.map((item) => item.id),
    ).not.toContain("clickRateTuning");

    state = buy(state, "core");
    state = research(state, "localScheduler");

    let visible = deriveVisibleState(state);
    let clickRateResearch = visible.research.find(
      (item) => item.id === "clickRateTuning",
    );

    expect(clickRateResearch).toEqual(
      expect.objectContaining({
        canBuy: true,
        completed: false,
        costs: [{ resource: "credits", amount: 500_000 }],
      }),
    );
    expect(visible.input?.taskHoldRepeatMs).toBe(110);
    expect(visible.input?.taskHoldRateHz).toBeCloseTo(1000 / 110);

    state = research(state, "clickRateTuning");
    visible = deriveVisibleState(state);
    clickRateResearch = visible.research.find(
      (item) => item.id === "clickRateTuning",
    );

    expect(state.research.completed).toContain("clickRateTuning");
    expect(state.research.clickRateLevel ?? 0).toBe(0);
    expect(clickRateResearch).toEqual(
      expect.objectContaining({
        actionLabel: "Level up",
        completed: false,
        costs: getClickRateUpgradeCost(1),
      }),
    );

    state = research(state, "clickRateTuning");
    visible = deriveVisibleState(state);

    expect(state.research.clickRateLevel).toBe(1);
    expect(visible.input).toEqual(
      expect.objectContaining({
        clickRateLevel: 1,
        taskHoldRateHz: 10,
        taskHoldRepeatMs: 100,
        taskHoldMaxMs: 30_000,
      }),
    );
    expect(
      visible.research.find((item) => item.id === "clickRateTuning")?.costs,
    ).toEqual([{ resource: "credits", amount: 140_000 }]);

    state = research(state, "clickRateTuning");
    visible = deriveVisibleState(state);

    expect(state.research.clickRateLevel).toBe(2);
    expect(visible.input?.taskHoldRateHz).toBe(12);
    expect(
      visible.research.find((item) => item.id === "clickRateTuning")?.costs,
    ).toEqual([{ resource: "credits", amount: 196_000 }]);

    while ((state.research.clickRateLevel ?? 0) < CLICK_RATE_MAX_LEVEL) {
      state = research(state, "clickRateTuning");
    }

    visible = deriveVisibleState(state);
    clickRateResearch = visible.research.find(
      (item) => item.id === "clickRateTuning",
    );

    expect(state.research.clickRateLevel).toBe(CLICK_RATE_MAX_LEVEL);
    expect(getClickRateHz(CLICK_RATE_MAX_LEVEL)).toBe(80);
    expect(visible.input?.taskHoldRateHz).toBe(80);
    expect(clickRateResearch).toEqual(
      expect.objectContaining({
        completed: true,
        canBuy: false,
        costs: [],
      }),
    );
  });

  it("normalizes click rate tuning levels from saves", () => {
    const savedState: GameState = {
      ...createInitialGameState(),
      research: {
        completed: ["clickRateTuning"],
        clickRateLevel: 7,
      },
    };

    const restored = deserializeSave(serializeSave(savedState));

    expect(restored.research.clickRateLevel).toBe(7);
    expect(deriveVisibleState(restored).input?.taskHoldRateHz).toBe(22);

    const restoredMissing = deserializeSave(
      JSON.stringify({
        version: 6,
        state: {
          ...savedState,
          research: {
            completed: ["clickRateTuning"],
          },
        },
      }),
    );
    const restoredClamped = deserializeSave(
      JSON.stringify({
        version: 6,
        state: {
          ...savedState,
          research: {
            completed: ["clickRateTuning"],
            clickRateLevel: 99,
          },
        },
      }),
    );
    const restoredInvalid = deserializeSave(
      JSON.stringify({
        version: 6,
        state: {
          ...savedState,
          research: {
            completed: ["clickRateTuning"],
            clickRateLevel: "fast",
          },
        },
      }),
    );

    expect(restoredMissing.research.clickRateLevel).toBe(0);
    expect(restoredInvalid.research.clickRateLevel).toBe(0);
    expect(restoredClamped.research.clickRateLevel).toBe(CLICK_RATE_MAX_LEVEL);
    expect(deriveVisibleState(restoredClamped).input?.taskHoldRateHz).toBe(80);
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
    expect(visible.tasks.map((task) => task.id)).toEqual(
      expect.arrayContaining(["byteCopy", "packetCheck"]),
    );
    expect(visible.tasks.find((task) => task.id === "byteCopy")?.canStart).toBe(
      false,
    );
    expect(visible.tasks.find((task) => task.id === "packetCheck")?.canStart).toBe(
      false,
    );
    expect(visible.research.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "byteOperations",
        "cacheMapping",
        "benchmarkHarness",
      ]),
    );
    expect(visible.research.find((item) => item.id === "cacheMapping")?.canBuy).toBe(
      false,
    );
    expect(
      visible.research.find((item) => item.id === "benchmarkHarness")?.canBuy,
    ).toBe(false);
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
    expect(visible.tasks.map((task) => task.id)).toContain("packetCheck");
    expect(visible.tasks.find((task) => task.id === "packetCheck")?.canStart).toBe(
      false,
    );
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
    expect(task.subtasks.map((node) => [node.name, node.operationCount])).toEqual([
      ["Stage checksum page", 288],
      ["Fold checksum", 44],
    ]);
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

  it("scales only per-work-unit subtasks for chunked system tasks", () => {
    const task = getTaskDefinition("compileCode");

    expect(task.composition.map((entry) => [entry.taskId, entry.mode])).toEqual([
      ["stageSourceTree", "perWorkUnit"],
      ["compileUnits", "perWorkUnit"],
      ["linkBarrier", "single"],
      ["linkBinary", "single"],
      ["writeArtifact", "single"],
    ]);
    expect(task.subtasks.map((node) => [node.sourceTaskId, node.operationCount])).toEqual([
      ["stageSourceTree", 608],
      ["compileUnits", 168],
      ["linkBarrier", 0],
      ["linkBinary", 648],
      ["writeArtifact", 552],
    ]);
    expect(task.workUnitOperationCount).toBe(776);
    expect(task.operationCount).toBe(13_616);
    expect(task.requiredCycles).toBe(3_992);
    expect(task.rewardCredits).toBe(task.operationCount);
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
        clockHz: getCpuClockHz("hz", 5),
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

    expect(getCacheLoadRate(state, 1)).toBe(getCpuClockHz("hz", 5));
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
        clockHz: getCpuClockHz("hz", 5),
        coreClockLevels: {
          1: 5,
        },
        cacheLevel: 5,
        cacheBits: 16,
        cacheBytes: 2,
        cacheSpeedLevel: 3,
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
        state: "buffering",
      }),
    );
    expect(residency[1]?.readyBits).toBeGreaterThan(0);
    expect(residency[1]?.bufferBits).toBeGreaterThan(0);
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

  it("shares CPU cache write speed across active cores on the same package", () => {
    const initial = createInitialGameState();
    const coreIds = [1, 2, 3, 4];
    let state = syncCoreSchedulers(
      fund({
        ...initial,
        research: {
          completed: ["byteOperations"],
        },
        hardware: {
          ...initial.hardware,
          cores: coreIds.length,
          coreClockLevels: coreIds.reduce<Record<number, number>>(
            (levels, coreId) => ({
              ...levels,
              [coreId]: 1,
            }),
            {},
          ),
          cacheLevel: 8,
          cacheBits: 128,
          cacheBytes: 16,
          cacheSpeedLevel: 1,
          cpus: initial.hardware.cpus.map((cpu) =>
            cpu.id === 1
              ? {
                  ...cpu,
                  coreIds,
                  cacheLevel: 8,
                  cacheBits: 128,
                  cacheBytes: 16,
                  cacheSpeedLevel: 1,
                }
              : cpu,
          ),
        },
      }),
    );

    for (const coreId of coreIds) {
      state = applyAction(state, {
        type: "startTaskOnCore",
        taskId: "byteCopy",
        coreId,
      });
    }

    const beforeOperations = state.activeTasks
      .flatMap((task) => task.coreOperations)
      .sort((left, right) => left.coreId - right.coreId);

    expect(beforeOperations).toHaveLength(coreIds.length);
    expect(
      beforeOperations.every((operation) => operation.status === "loadingCache"),
    ).toBe(true);

    state = tickGame(state, 1000);

    const afterOperations = state.activeTasks
      .flatMap((task) => task.coreOperations)
      .sort((left, right) => left.coreId - right.coreId);
    const loadDeltas = afterOperations.map(
      (operation, index) =>
        (beforeOperations[index]?.remainingLoadCycles ?? 0) -
        operation.remainingLoadCycles,
    );
    const cpuIssueDeltas = afterOperations.map(
      (operation, index) =>
        (beforeOperations[index]?.remainingCycles ?? 0) - operation.remainingCycles,
    );
    const expectedPerCoreCacheRate = getCacheLoadRate(state, 1) / coreIds.length;
    const expectedCoreIssueRate = getCoreClockHz(state, 1);

    for (const delta of loadDeltas) {
      expect(delta).toBeCloseTo(expectedPerCoreCacheRate);
    }
    for (const delta of cpuIssueDeltas) {
      expect(delta).toBeCloseTo(expectedCoreIssueRate);
    }
    expect(loadDeltas.reduce((total, delta) => total + delta, 0)).toBeCloseTo(
      getCacheLoadRate(state, 1),
    );
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

    expect(restored.version).toBe(6);
    expect(restored.research.completed).toEqual([]);
    expect(restored.flags.scheduler).toBe(false);
    expect(restored.systems).toHaveLength(1);
  });

  it("clean-resets malformed v2 saves instead of migrating incompatible hardware", () => {
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

    expect(restored.version).toBe(6);
    expect(restored.hardware.ramSticks).toEqual([]);
    expect(restored.hardware.ramBits).toBe(0);
    expect(restored.hardware.ramBytes).toBe(0);
    expect(restored.hardware.ramSpeedLevel).toBe(1);
    expect(restored.hardware.ramSpeedMt).toBe(getRamSpeedMt(1));
    expect(restored.systems[0]?.hardware.ramBits).toBe(0);
  });

  it("clean-resets v4 saves for the child task queue schema", () => {
    const base = createInitialGameState();
    const restored = deserializeSave(
      JSON.stringify({
        version: 4,
        savedAt: new Date().toISOString(),
        state: {
          ...base,
          version: 4,
          queue: ["tinyChecksum"],
          queueEntries: undefined,
        },
      }),
    );

    expect(restored.version).toBe(6);
    expect(restored.queue).toEqual([]);
    expect(restored.queueEntries).toEqual([]);
    expect(restored.systems[0]?.queue).toEqual([]);
    expect(restored.systems[0]?.queueEntries).toEqual([]);
  });

  it("creates a rack-ready seed with a dense visual stress node", () => {
    const state = createRackReadyGameState();
    const restored = deserializeSave(serializeSave(state));
    const visible = deriveVisibleState(state);

    expect(state.version).toBe(6);
    expect(restored).toEqual(state);
    expect(state.resources.credits).toBe(RACK_READY_SEED_CREDITS);
    expect(state.resources.data).toBeGreaterThan(20_000);
    expect(state.flags.systemCatalog).toBe(true);
    expect(state.flags.customMachineAssembly).toBe(true);
    expect(state.cron.schedules[0]?.enabled).toBe(false);
    expect(state.cron.schedules[0]?.taskId).toBeNull();
    expect(state.systems).toHaveLength(2);
    expect(state.systems[0]?.hardware.cpus).toHaveLength(2);
    expect(state.systems[0]?.hardware.secondCpu).toBe(true);
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

    expect(restored.version).toBe(6);
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
    const shardState = withRamCapacity(
      unlockSystemStats(),
      Math.max(0, shardReconcile.ramNeedBits - 1),
    );
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
        completed: [
          "systemCatalog",
          "customMachineAssembly",
          "cpuTierKhz",
          "cpuTierMhz",
          "cpuTierGhz",
        ],
      },
    });

    let visible = deriveVisibleState(state);
    const compileBox = getMachineTemplate("compileBox");
    const compileBoxCost = getMachineSelectionCost(compileBox.components);
    const beforeCompileResources = state.resources;
    const visibleCompileBox = visible.machineBuilder.templates.find(
      (template) => template.id === "compileBox",
    );

    expect(visibleCompileBox?.cost).toEqual(compileBoxCost);

    state = applyAction(state, {
      type: "buyMachineTemplate",
      templateId: "compileBox",
    });

    visible = deriveVisibleState(state);
    const compileSystem = state.systems.at(-1);

    expect(state.systems.map((system) => system.name)).toEqual([
      "Barebones PC",
      "Compile Box",
    ]);
    expect(state.selectedSystemId).toBe(2);
    expect(beforeCompileResources.credits - state.resources.credits).toBe(
      costAmount(compileBoxCost, "credits"),
    );
    expect(beforeCompileResources.data - state.resources.data).toBe(
      costAmount(compileBoxCost, "data"),
    );
    expect(compileSystem?.hardware.cores).toBe(1);
    expect(compileSystem?.hardware.schedulerSlots).toBe(1);
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
      resources: { credits: 5_000_000_000_000, data: 100_000 },
    };
    state = applyAction(state, {
      type: "buyCustomMachine",
      components: {
        cpu: "cpu-render-array",
        ram: "ram-ghz-tier",
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

  it("prices repeated CPU packages in custom machine selections", () => {
    const selection = {
      cpu: "cpu-sip-core",
      cpuPackageCount: 4,
      ram: "ram-none",
      scheduler: "scheduler-none",
      psu: "psu-barebones",
    } as const;
    const cost = getMachineSelectionCost(selection);
    const before = 200_000;
    const state = applyAction(
      {
        ...createInitialGameState(),
        flags: {
          ...createInitialGameState().flags,
          systemCatalog: true,
        },
        research: {
          completed: ["systemCatalog", "cpuTierKhz"],
        },
        resources: {
          credits: before,
          data: 0,
        },
      },
      {
        type: "buyCustomMachine",
        components: selection,
      },
    );

    expect(cost).toEqual([{ resource: "credits", amount: 128_002 }]);
    expect(state.systems.at(-1)?.hardware.cpus).toHaveLength(4);
    expect(before - state.resources.credits).toBe(costAmount(cost, "credits"));
  });

  it("prices custom PSU capacity with the normal PSU upgrade curve", () => {
    const selection = {
      cpu: "cpu-barebones-1",
      ram: "ram-none",
      scheduler: "scheduler-none",
      psu: "psu-barebones",
      psuLevel: 5,
    } as const;
    const cost = getMachineSelectionCost(selection);
    const psuUpgradeCost = getPsuCapacityBuildCost(1, 5).reduce(
      (total, item) => total + (item.resource === "credits" ? item.amount : 0),
      0,
    );
    const before = 10_000;
    const state = applyAction(
      {
        ...createInitialGameState(),
        flags: {
          ...createInitialGameState().flags,
          systemCatalog: true,
        },
        resources: {
          credits: before,
          data: 0,
        },
      },
      {
        type: "buyCustomMachine",
        components: selection,
      },
    );

    expect(costAmount(cost, "credits")).toBe(10 + psuUpgradeCost);
    expect(state.systems.at(-1)?.hardware.psuLevel).toBe(5);
    expect(state.systems.at(-1)?.hardware.psuWatts).toBe(getPsuWatts(5));
    expect(before - state.resources.credits).toBe(costAmount(cost, "credits"));
  });

  it("keeps the selected store PSU base level when a custom payload has a stale lower level", () => {
    const selection = {
      cpu: "cpu-barebones-1",
      ram: "ram-none",
      scheduler: "scheduler-none",
      psu: "psu-balanced",
      psuLevel: 1,
    } as const;
    const before = 10_000;
    const state = applyAction(
      {
        ...createInitialGameState(),
        flags: {
          ...createInitialGameState().flags,
          systemCatalog: true,
        },
        resources: {
          credits: before,
          data: 0,
        },
      },
      {
        type: "buyCustomMachine",
        components: selection,
      },
    );

    expect(state.systems.at(-1)?.hardware.psuLevel).toBe(18);
    expect(state.systems.at(-1)?.hardware.psuWatts).toBe(getPsuWatts(18));
  });

  it("keeps catalog CPUs at package level 1 and offers only RAM tier modules", () => {
    const cpuModules = componentSkus.filter((module) => module.type === "cpu");
    const ramModules = componentSkus.filter((module) => module.type === "ram");
    const ramTierModules = ramModules.filter((module) => module.id !== "ram-none");

    expect(cpuModules.every((module) => module.cpuLevel === 1)).toBe(true);
    expect(cpuModules.every((module) => module.clockLevel === 1)).toBe(true);
    expect(cpuModules.every((module) => module.coreCount === 1)).toBe(true);
    expect(ramModules.map((module) => module.id)).toEqual([
      "ram-none",
      "ram-hz-tier",
      "ram-khz-tier",
      "ram-mhz-tier",
      "ram-ghz-tier",
      "ram-thz-tier",
      "ram-phz-tier",
    ]);
    expect(ramTierModules.map((module) => module.ramLevel)).toEqual([
      1,
      37,
      73,
      109,
      145,
      181,
    ]);

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
        completed: [
          "systemCatalog",
          "customMachineAssembly",
          "cpuTierKhz",
          "cpuTierMhz",
          "cpuTierGhz",
          "cpuTierThz",
          "cpuTierPhz",
        ],
      },
    });
    state = {
      ...state,
      resources: { credits: 1e30, data: 1e30 },
    };
    const visible = deriveVisibleState(state);
    const cpuModules = visible.machineBuilder.components.cpu;
    const ramModules = visible.machineBuilder.components.ram;

    expect(cpuModules).toHaveLength(11);
    expect(cpuModules[0]?.id).toBe("cpu-barebones-1");
    expect(cpuModules.every((module) => (module.cpuPackageCount ?? 1) === 1)).toBe(
      true,
    );
    expect(Math.max(...cpuModules.map((module) => module.coreCount ?? 0))).toBe(1);
    expect(Math.max(...cpuModules.map((module) => module.clockHz ?? 0))).toBeGreaterThan(
      100_000,
    );
    expect(ramModules.map((module) => module.id)).toEqual([
      "ram-none",
      "ram-hz-tier",
      "ram-khz-tier",
      "ram-mhz-tier",
      "ram-ghz-tier",
      "ram-thz-tier",
      "ram-phz-tier",
    ]);

    state = applyAction(state, {
      type: "buyCustomMachine",
      components: {
        cpu: "cpu-server-64",
        cpuPackageCount: 8,
        ram: "ram-phz-tier",
        scheduler: "scheduler-24-slot",
        psu: "psu-server",
      },
    });

    const custom = state.systems.at(-1);
    const cpu = getComponentSku("cpu-server-64");
    const ram = getComponentSku("ram-phz-tier");
    const scheduler = getComponentSku("scheduler-24-slot");
    const template = getMachineTemplate("workstationTower");

    expect(custom?.hardware.cpus).toHaveLength(8);
    expect(custom?.hardware.cores).toBe(8);
    expect(custom?.hardware.secondCpu).toBe(true);
    expect(custom?.hardware.cacheLevel).toBe(cpu.cacheLevel);
    expect(custom?.hardware.cacheSpeedLevel).toBe(cpu.cacheSpeedLevel);
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

  it("applies custom builder core, RAM, frequency, and size modifiers", () => {
    let state = fund({
      ...createInitialGameState(),
      flags: {
        ...createInitialGameState().flags,
        systemCatalog: true,
        customMachineAssembly: true,
      },
      research: {
        completed: ["systemCatalog", "customMachineAssembly", "cpuTierKhz"],
      },
    });
    state = {
      ...state,
      resources: { credits: 1e18, data: 1e18 },
    };
    const ramBaseLevel = getRamTierFirstGlobalLevel("khz");
    const components = {
      cpu: "cpu-sip-core",
      cpuPackageCount: 1,
      cpuCoreCount: 4,
      cpuLevel: 3,
      cacheLevel: 4,
      cacheSpeedLevel: 5,
      ram: "ram-khz-tier",
      ramStickCount: 3,
      ramLevel: ramBaseLevel + 2,
      ramSpeedLevel: ramBaseLevel + 1,
      scheduler: "scheduler-2-slot",
      psu: "psu-compact",
    };
    const expectedCost = getMachineSelectionCost(components);

    state = applyAction(state, {
      type: "buyCustomMachine",
      components,
    });

    const custom = state.systems.at(-1);
    expect(custom?.purchaseCosts).toEqual(expectedCost);
    expect(custom?.hardware.cpus).toHaveLength(1);
    expect(custom?.hardware.cores).toBe(4);
    expect(custom?.hardware.clockHz).toBe(getCpuClockHz("khz", 3));
    expect(custom?.hardware.cpus[0]?.level).toBe(3);
    expect(Object.values(custom?.hardware.coreClockLevels ?? {})).toEqual([
      3,
      3,
      3,
      3,
    ]);
    expect(custom?.hardware.cacheLevel).toBe(4);
    expect(custom?.hardware.cacheBits).toBeGreaterThan(1);
    expect(custom?.hardware.cacheSpeedLevel).toBe(5);
    expect(custom?.hardware.ramSticks).toHaveLength(3);
    expect(custom?.hardware.ramBits).toBe(getRamBits(ramBaseLevel + 2) * 3);
    expect(custom?.hardware.ramSpeedLevel).toBe(ramBaseLevel + 1);
    expect(custom?.hardware.ramSpeedMt).toBe(getRamSpeedMt(ramBaseLevel + 1));
    expect(
      custom?.hardware.ramSticks.every(
        (stick) =>
          stick.level === ramBaseLevel + 2 &&
          stick.speedLevel === ramBaseLevel + 1,
      ),
    ).toBe(true);
  });

  it("keeps custom builder CPU packages as individual configured CPUs", () => {
    let state = fund({
      ...createInitialGameState(),
      flags: {
        ...createInitialGameState().flags,
        systemCatalog: true,
        customMachineAssembly: true,
      },
      research: {
        completed: ["systemCatalog", "customMachineAssembly", "cpuTierKhz"],
      },
    });
    state = {
      ...state,
      resources: { credits: 1e18, data: 1e18 },
    };
    const components = {
      cpu: "cpu-sip-core",
      cpuPackageCount: 2,
      cpuCoreCount: 5,
      cpuPackageConfigs: [
        {
          coreCount: 2,
          cpuLevel: 2,
          cacheLevel: 3,
          cacheSpeedLevel: 4,
        },
        {
          coreCount: 3,
          cpuLevel: 5,
          cacheLevel: 6,
          cacheSpeedLevel: 7,
        },
      ],
      ram: "ram-khz-tier",
      ramStickCount: 1,
      ramLevel: getRamTierFirstGlobalLevel("khz"),
      ramSpeedLevel: getRamTierFirstGlobalLevel("khz"),
      scheduler: "scheduler-2-slot",
      psu: "psu-compact",
    };
    const expectedCost = getMachineSelectionCost(components);

    state = applyAction(state, {
      type: "buyCustomMachine",
      components,
    });

    const custom = state.systems.at(-1);
    expect(custom?.purchaseCosts).toEqual(expectedCost);
    expect(custom?.hardware.cpus).toHaveLength(2);
    expect(custom?.hardware.cores).toBe(5);
    expect(custom?.hardware.cpus[0]?.coreIds).toEqual([1, 2]);
    expect(custom?.hardware.cpus[1]?.coreIds).toEqual([3, 4, 5]);
    expect(custom?.hardware.cpus[0]?.level).toBe(2);
    expect(custom?.hardware.cpus[1]?.level).toBe(5);
    expect(custom?.hardware.cpus[0]?.cacheLevel).toBe(3);
    expect(custom?.hardware.cpus[1]?.cacheLevel).toBe(6);
    expect(custom?.hardware.cpus[0]?.cacheSpeedLevel).toBe(4);
    expect(custom?.hardware.cpus[1]?.cacheSpeedLevel).toBe(7);
    expect(custom?.hardware.coreClockLevels).toEqual({
      1: 2,
      2: 2,
      3: 5,
      4: 5,
      5: 5,
    });
  });

  it("materializes custom CPU scheduler slots per CPU package", () => {
    let state = fund({
      ...createInitialGameState(),
      flags: {
        ...createInitialGameState().flags,
        systemCatalog: true,
        customMachineAssembly: true,
      },
      research: {
        completed: ["systemCatalog", "customMachineAssembly", "cpuTierKhz"],
      },
    });
    state = {
      ...state,
      resources: { credits: 1e18, data: 1e18 },
    };
    const baseComponents = {
      cpu: "cpu-sip-core",
      cpuPackageCount: 2,
      cpuPackageConfigs: [
        { coreCount: 1, cpuLevel: 1, cacheLevel: 1, cacheSpeedLevel: 1 },
        { coreCount: 2, cpuLevel: 1, cacheLevel: 1, cacheSpeedLevel: 1 },
      ],
      ram: "ram-none",
      scheduler: "scheduler-none",
      psu: "psu-barebones",
    };
    const components = {
      ...baseComponents,
      cpuPackageConfigs: [
        { ...baseComponents.cpuPackageConfigs[0]!, schedulerSlots: 1 },
        { ...baseComponents.cpuPackageConfigs[1]!, schedulerSlots: 4 },
      ],
    };
    const baseCost = getMachineSelectionCost(baseComponents);
    const cost = getMachineSelectionCost(components);
    const extraSlotCost = getCpuSchedulerSlotBuildCost(2, 4);
    const extraSlotCredits = extraSlotCost.reduce(
      (total, item) => total + (item.resource === "credits" ? item.amount : 0),
      0,
    );
    const extraSlotData = extraSlotCost.reduce(
      (total, item) => total + (item.resource === "data" ? item.amount : 0),
      0,
    );

    expect(costAmount(cost, "credits")).toBe(
      costAmount(baseCost, "credits") + extraSlotCredits,
    );
    expect(costAmount(cost, "data")).toBe(
      costAmount(baseCost, "data") + extraSlotData,
    );

    state = applyAction(state, {
      type: "buyCustomMachine",
      components,
    });

    const custom = state.systems.at(-1);
    expect(custom?.purchaseCosts).toEqual(cost);
    expect(custom?.hardware.cpus.map((cpu) => cpu.schedulerSlots)).toEqual([
      1,
      4,
    ]);
    expect(custom?.hardware.schedulerSlots).toBe(5);
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
        completed: ["systemScheduler", "systemCatalog", "cpuTierMhz"],
      },
    });
    state = applyAction(state, {
      type: "buyMachineTemplate",
      templateId: "compileBox",
    });
    const multiCoreIds = [1, 2, 3, 4];
    state = syncCoreSchedulers({
      ...state,
      hardware: {
        ...state.hardware,
        cores: multiCoreIds.length,
        schedulerSlots: multiCoreIds.length,
        cpus: state.hardware.cpus.map((cpu) =>
          cpu.id === 1
            ? { ...cpu, coreIds: multiCoreIds, schedulerSlots: multiCoreIds.length }
            : cpu,
        ),
        coreClockLevels: Object.fromEntries(
          multiCoreIds.map((coreId) => [coreId, state.hardware.clockLevel]),
        ),
      },
    });

    const compileDefinition = getTaskDefinition("compileCode");
    expect(compileDefinition.coreScaling).toBe("chunked");

    const selectedCpu = state.hardware.cpus[0]!;
    const singleCoreIds = selectedCpu.coreIds.slice(0, 2);
    const singleCoreState: GameState = {
      ...state,
      hardware: {
        ...state.hardware,
        cores: singleCoreIds.length,
        cpus: [
          { ...selectedCpu, coreIds: singleCoreIds, schedulerSlots: singleCoreIds.length },
        ],
        coreClockLevels: {
          ...Object.fromEntries(
            singleCoreIds.map((coreId) => [
              coreId,
              state.hardware.coreClockLevels[coreId] ?? state.hardware.clockLevel,
            ]),
          ),
        },
        schedulerSlots: singleCoreIds.length,
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

    const singleTasks = getActiveRuntimeTasks(singleStarted, "compileCode");
    const multiTasks = getActiveRuntimeTasks(multiStarted, "compileCode");

    expect(singleTasks).toHaveLength(singleCoreIds.length);
    expect(multiTasks.length).toBeGreaterThan(singleTasks.length);
    expect(multiTasks.every((task) => task.parentTaskId === "compileCode")).toBe(
      true,
    );
    expect(multiTasks[0]?.systemId).toBe(state.selectedSystemId);
    expect(
      multiStarted.systems.find((system) => system.id === 1)?.activeTasks,
    ).toHaveLength(0);

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
        completed: [
          "systemScheduler",
          "systemCatalog",
          "customMachineAssembly",
          "cpuTierMhz",
        ],
      },
    });
    state = {
      ...state,
      resources: { credits: 1_000_000_000_000, data: 50_000 },
    };
    state = applyAction(state, {
      type: "buyCustomMachine",
      components: {
        cpu: "cpu-compile-die",
        cpuPackageCount: 2,
        ram: "ram-mhz-tier",
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

    const compileTasks = getActiveRuntimeTasks(state, "compileCode");
    const assignedCompileCoreIds = compileTasks.flatMap(
      (task) => task.assignedCoreIds,
    );
    const reservedStageEntries = getLocalQueueEntries(state).filter(
      (entry) =>
        entry.parentTaskId === "compileCode" &&
        entry.childTaskId === "stageSourceTree",
    );
    expect(state.hardware.cpus).toHaveLength(2);
    expect(assignedCompileCoreIds).toEqual(expectedIdleCoreIds);
    expect(reservedStageEntries.length).toBeGreaterThanOrEqual(
      expectedIdleCoreIds.length,
    );
    expect(getLocalQueueTaskIds(state)).toEqual(
      reservedStageEntries.map(() => "stageSourceTree"),
    );
    expect(reservedStageEntries).toEqual(
      reservedStageEntries.map(() =>
        expect.objectContaining({
          taskId: "stageSourceTree",
          parentTaskId: "compileCode",
          childTaskId: "stageSourceTree",
          childTaskName: "Stage Source Tree",
          target: "cpu",
        }),
      ),
    );
    for (const cpu of state.hardware.cpus.filter((cpu) =>
      cpu.coreIds.some((coreId) => expectedIdleCoreIds.includes(coreId)),
    )) {
      const cpuQueueSlots = cpu.coreIds.flatMap(
        (coreId) => state.coreSchedulers[coreId]?.localQueue ?? [],
      );
      const assignedCpuCoreCount = cpu.coreIds.filter((coreId) =>
        expectedIdleCoreIds.includes(coreId),
      ).length;

      expect(cpuQueueSlots.every((taskId) => taskId === "stageSourceTree")).toBe(
        true,
      );
      if (assignedCpuCoreCount > 0) {
        expect(
          cpu.coreIds.some((coreId) => assignedCompileCoreIds.includes(coreId)),
        ).toBe(true);
      }
    }
  });

  it("least-queued system routing sends child entries across CPU schedulers on the selected system", () => {
    let state = createRackReadyGameState();
    const selectedSystemId = state.selectedSystemId;
    const selectedBefore = state.systems.find(
      (system) => system.id === selectedSystemId,
    );

    expect(state.systems.length).toBeGreaterThan(1);
    expect(selectedBefore?.hardware.cpus.length).toBeGreaterThan(1);

    state = {
      ...state,
      flags: { ...state.flags, schedulerPolicies: true },
    };
    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "system",
      policy: "shortestTask",
      systemId: selectedSystemId,
    });
    state = applyAction(state, {
      type: "queueTask",
      taskId: "compileCode",
      systemId: selectedSystemId,
    });
    state = tickGame(state, 16);

    const selectedAfter = state.systems.find(
      (system) => system.id === selectedSystemId,
    );
    const otherSystems = state.systems.filter(
      (system) => system.id !== selectedSystemId,
    );
    const entriesByCpu =
      selectedAfter?.hardware.cpus.map((cpu) =>
        cpu.coreIds
          .flatMap(
            (coreId) =>
              selectedAfter.coreSchedulers[coreId]?.localQueueEntries ?? [],
          )
          .filter((entry) => entry.parentTaskId === "compileCode"),
      ) ?? [];

    expect(entriesByCpu).toHaveLength(selectedAfter?.hardware.cpus.length ?? 0);
    expect(entriesByCpu.every((entries) => entries.length > 0)).toBe(true);
    expect(
      entriesByCpu.flat().every((entry) => entry.taskId === "stageSourceTree"),
    ).toBe(true);
    expect(
      otherSystems.flatMap((system) =>
        Object.values(system.coreSchedulers).flatMap(
          (scheduler) => scheduler.localQueueEntries ?? [],
        ),
      ),
    ).toEqual([]);
  });

  it("FIFO system routing feeds open CPU schedulers instead of pinning work to CPU A", () => {
    let state = createRackReadyGameState();
    const [firstCpu, secondCpu] = state.hardware.cpus;

    expect(firstCpu).toBeDefined();
    expect(secondCpu).toBeDefined();

    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });
    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });
    state = tickGame(state, 16);

    const firstCpuChildren = getLocalQueueEntriesForCpu(state, firstCpu!.id).filter(
      (entry) => entry.parentTaskId === "tinyChecksum",
    );
    const secondCpuChildren = getLocalQueueEntriesForCpu(
      state,
      secondCpu!.id,
    ).filter((entry) => entry.parentTaskId === "tinyChecksum");

    expect(firstCpuChildren).toHaveLength(1);
    expect(secondCpuChildren).toHaveLength(1);
  });

  it("routes system children into CPU schedulers that must wait for hardware fit", () => {
    let state = createRackReadyGameState();
    const [firstCpu, secondCpu] = state.hardware.cpus;
    const parentTask = getTaskDefinition("tinyChecksum");
    const checksumStep = getTaskDefinition("checksumStep");

    expect(firstCpu).toBeDefined();
    expect(secondCpu).toBeDefined();
    expect(checksumStep.cacheNeedBits).toBeGreaterThan(1);

    const hardware = {
      ...state.hardware,
      cpus: state.hardware.cpus.map((cpu) =>
        cpu.id === firstCpu!.id
          ? { ...cpu, schedulerSlots: 0 }
          : cpu.id === secondCpu!.id
            ? {
                ...cpu,
                cacheBits: 1,
                cacheBytes: 1,
                schedulerSlots: 1,
              }
            : cpu,
      ),
      cacheBits: 1,
      cacheBytes: 1,
      schedulerSlots: 1,
      systemSchedulerConfig: createSchedulerConfig({ policy: "fifo" }),
    };
    const parentQueueEntry: NonNullable<GameState["queueEntries"]>[number] = {
      id: "system-queue-test",
      reservationId: null,
      taskId: parentTask.id,
      name: parentTask.name,
      category: parentTask.category,
      cacheNeedBits: parentTask.cacheNeedBits,
      ramNeedBits: parentTask.ramNeedBits,
      requiredCores: parentTask.minCores,
      parentTaskId: null,
      parentTaskName: null,
      parentQueueEntryId: null,
      childTaskId: null,
      childTaskName: null,
      compositionIndex: null,
      compositionRepeatIndex: null,
      workUnitIndex: null,
      childWorkKey: null,
      completedChildKeys: ["single:0:0"],
      totalChildCount: 2,
      target: "system",
    };

    state = {
      ...state,
      hardware,
      queue: ["tinyChecksum"],
      queueEntries: [parentQueueEntry],
      systems: state.systems.map((system) =>
        system.id === state.selectedSystemId
          ? {
              ...system,
              hardware,
              queue: ["tinyChecksum"],
              queueEntries: [parentQueueEntry],
            }
          : system,
      ),
    };

    state = tickGame(state, 16);

    const secondCpuChildren = getLocalQueueEntriesForCpu(
      state,
      secondCpu!.id,
    ).filter((entry) => entry.parentTaskId === "tinyChecksum");

    expect(secondCpuChildren).toHaveLength(1);
    expect(secondCpuChildren[0]?.taskId).toBe("checksumStep");
    expect(state.activeTasks.some((task) => task.taskId === "checksumStep")).toBe(
      false,
    );
  });

  it("least-queued system routing spreads child entries after the first CPU has reserved work", () => {
    let state = createRackReadyGameState();
    state = {
      ...state,
      flags: { ...state.flags, schedulerPolicies: true },
    };
    const [firstCpu, secondCpu] = state.hardware.cpus;

    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "system",
      policy: "shortestTask",
    });
    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });
    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });
    state = tickGame(state, 16);

    expect(
      getLocalQueueEntriesForCpu(state, firstCpu!.id).filter(
        (entry) => entry.parentTaskId === "tinyChecksum",
      ),
    ).toHaveLength(1);
    expect(
      getLocalQueueEntriesForCpu(state, secondCpu!.id).filter(
        (entry) => entry.parentTaskId === "tinyChecksum",
      ),
    ).toHaveLength(1);
  });

  it("most-headroom system routing chooses the CPU scheduler with more cache room", () => {
    const childTask = getTaskDefinition("stageChecksumPage");
    let state = createRackReadyGameState();
    const [firstCpu, secondCpu] = state.hardware.cpus;
    expect(firstCpu).toBeDefined();
    expect(secondCpu).toBeDefined();
    const hardware = {
      ...state.hardware,
      cpus: state.hardware.cpus.map((cpu) =>
        cpu.id === firstCpu!.id
          ? {
              ...cpu,
              cacheBits: childTask.cacheNeedBits,
              cacheBytes: childTask.cacheNeedBytes,
            }
          : cpu.id === secondCpu!.id
            ? {
                ...cpu,
                cacheBits: childTask.cacheNeedBits * 16,
                cacheBytes: childTask.cacheNeedBytes * 16,
              }
            : cpu,
      ),
    };

    state = {
      ...state,
      flags: { ...state.flags, schedulerPolicies: true },
      hardware,
      systems: state.systems.map((system) =>
        system.id === state.selectedSystemId ? { ...system, hardware } : system,
      ),
    };
    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "system",
      policy: "smallestMemory",
    });
    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });
    state = tickGame(state, 16);

    expect(
      getLocalQueueEntriesForCpu(state, firstCpu!.id).filter(
        (entry) => entry.parentTaskId === "tinyChecksum",
      ),
    ).toHaveLength(0);
    expect(
      getLocalQueueEntriesForCpu(state, secondCpu!.id).filter(
        (entry) => entry.parentTaskId === "tinyChecksum",
      ),
    ).toHaveLength(1);
  });

  it("keeps system and distributed tasks composed from CPU-bound child tasks", () => {
    const tasksById = new Map(taskDefinitions.map((task) => [task.id, task]));
    const nonCpuTasks = taskDefinitions.filter(
      (task) => task.category === "system" || task.category === "distributed",
    );

    expect(nonCpuTasks.length).toBeGreaterThan(0);

    for (const task of nonCpuTasks) {
      expect(task.composition.length).toBeGreaterThan(0);
      for (const child of task.composition) {
        expect(tasksById.get(child.taskId)?.category).toBe("cpu");
      }
      expect(task.operations.every((operation) => operation.id.startsWith(`${task.id}:`))).toBe(
        true,
      );
    }
  });

  it("exposes RAM read, write, and overwrite as CPU-bound tasks after RAM unlock", () => {
    let state = unlockRamControl();
    let visible = deriveVisibleState(state);

    for (const taskId of ["readRamPage", "writeRamPage", "overwriteRamPage"] as const) {
      const task = visible.tasks.find((candidate) => candidate.id === taskId);
      expect(task?.category).toBe("cpu");
      expect(task?.canStart).toBe(false);
      expect(task?.blockedReason).toBe("RAM capacity too low.");
    }

    state = buy(state, "ram");
    visible = deriveVisibleState(state);

    for (const taskId of ["readRamPage", "writeRamPage", "overwriteRamPage"] as const) {
      const task = visible.tasks.find((candidate) => candidate.id === taskId);
      expect(task?.category).toBe("cpu");
      expect(task?.canStart).toBe(true);
    }

    expect(visible.tasks.some((task) => task.id === "stageChecksumPage")).toBe(false);
  });

  it("derives RAM tiers from CPU unlocks, 1024x tier size jumps, and CPU-style costs", () => {
    let state = createInitialGameState();

    expect(getRamBits(1)).toBe(256);
    expect(getRamBits(2)).toBe(512);
    expect(getRamBits(3)).toBe(1024);
    expect(getRamBits(37)).toBe(getRamBits(1) * 1024);
    expect(getRamBits(73)).toBe(getRamBits(37) * 1024);
    expect(getMaxUnlockedRamLevel(state)).toBe(36);
    expect(getRamInstallLevel(state)).toBe(1);

    state = {
      ...state,
      research: {
        completed: ["cpuTierKhz"],
      },
    };

    expect(getMaxUnlockedRamLevel(state)).toBe(72);
    expect(getRamInstallLevel(state)).toBe(37);
    expect(getRamTierLevelDefinition(37).upgradeCost).toBe(
      getCpuTierLevelDefinition("khz", 1).upgradeCost,
    );
    expect(getRamTierLevelDefinition(38).upgradeCost).toBe(
      getCpuTierLevelDefinition("khz", 2).upgradeCost,
    );
    expect(getRamTierLevelDefinition(2).calculatedCost).toBe(
      getCpuTierLevelDefinition("hz", 2).upgradeCost * 2,
    );
    expect(getRamTierLevelDefinition(3).calculatedCost).toBe(
      getCpuTierLevelDefinition("hz", 3).upgradeCost * 4,
    );
  });

  it("matches RAM frequency increments to core and cache tier clocks", () => {
    for (const tier of cpuTierDefinitions) {
      const firstRamLevel = getRamTierFirstGlobalLevel(tier.id);

      for (const cpuLevel of tier.levels) {
        const ramLevel = getRamTierLevelDefinition(
          firstRamLevel + cpuLevel.level - 1,
        );

        expect(ramLevel.clockHz).toBe(cpuLevel.clockHz);
        expect(getRamSpeedMt(ramLevel.globalLevel)).toBe(cpuLevel.clockHz);
      }
    }
  });

  it("installs the selected RAM tier instead of always using the highest unlock", () => {
    const state = fund({
      ...createInitialGameState(),
      flags: {
        ...createInitialGameState().flags,
        systemStats: true,
      },
      research: {
        completed: ["ramControl", "cpuTierKhz", "cpuTierMhz"],
      },
    });
    const visible = deriveVisibleState(state);

    expect(visible.metrics.ramInstallOptions.map((option) => option.tierId)).toEqual([
      "hz",
      "khz",
      "mhz",
    ]);

    const khzInstalled = applyAction(state, {
      type: "buyUpgrade",
      upgradeId: "ram",
      ramTierId: "khz",
    });

    expect(khzInstalled.hardware.ramSticks[0]).toEqual(
      expect.objectContaining({
        level: 37,
        speedLevel: 37,
        bits: getRamBits(37),
        speedMt: getRamSpeedMt(37),
      }),
    );
    expect(state.resources.credits - khzInstalled.resources.credits).toBe(
      getRamTierLevelDefinition(37).upgradeCost,
    );
    expect(deriveVisibleState(khzInstalled).metrics.ramInstallOptions).toEqual([]);

    const matchingStickInstalled = applyAction(khzInstalled, {
      type: "buyUpgrade",
      upgradeId: "ram",
      ramTierId: "mhz",
    });

    expect(matchingStickInstalled.hardware.ramSticks[1]).toEqual(
      expect.objectContaining({
        level: 37,
        speedLevel: 37,
        bits: getRamBits(37),
      }),
    );

    const defaultInstalled = applyAction(state, {
      type: "buyUpgrade",
      upgradeId: "ram",
    });
    expect(defaultInstalled.hardware.ramSticks[0]?.level).toBe(73);

    const lockedTierIgnored = applyAction(state, {
      type: "buyUpgrade",
      upgradeId: "ram",
      ramTierId: "phz",
    });
    expect(lockedTierIgnored.hardware.ramSticks).toHaveLength(0);
  });

  it("keeps system-scheduled work queued when free RAM is exhausted", () => {
    let state = withRamCapacity(unlockSystemScheduler(), 256);

    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });

    expect(state.activeTasks).toHaveLength(1);
    expect(state.queue).toEqual(["tinyChecksum"]);
    expect(state.activeTasks[0]?.coreOperations[0]?.memoryReservedBits).toBe(0);

    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });
    state = tickGame(state, 16);

    expect(state.activeTasks).toHaveLength(1);
    expect(state.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(state.activeTasks.flatMap((task) => task.coreOperations)).not.toContainEqual(
      expect.objectContaining({ status: "deadlocked", lockResource: "ram" }),
    );

    state = finishActiveTasks(state);

    expect(state.queue).toEqual([]);
    expect(state.completedTasks.tinyChecksum).toBe(2);
  });

  it("FIFO system scheduler waits for RAM footprint before dispatching queued work", () => {
    let state = withRamCapacity(unlockSystemScheduler(), 256);

    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });
    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });

    expect(state.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(state.activeTasks).toHaveLength(1);

    state = tickGame(state, 16);

    expect(state.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(state.activeTasks).toHaveLength(1);
    expect(state.activeTasks.flatMap((task) => task.coreOperations)).not.toContainEqual(
      expect.objectContaining({ status: "deadlocked", lockResource: "ram" }),
    );
  });

  it("spills single-channel RAM allocations across installed sticks", () => {
    let state = withRamSticks(unlockSystemScheduler(), [
      createRamStickState(1, 1, 7),
      createRamStickState(2, 1, 7),
    ]);

    state = {
      ...state,
      completedTasks: {
        ...state.completedTasks,
        tinyChecksum: 1,
      },
    };
    expect(getTaskDefinition("memoryScrub").ramNeedBits).toBe(512);

    state = applyAction(state, { type: "startTask", taskId: "memoryScrub" });
    let sawRamLoad = false;

    for (let tick = 0; tick < 40 && !sawRamLoad; tick += 1) {
      state = tickGame(state, 1000);
      const operations = state.activeTasks.flatMap((task) => task.coreOperations);

      expect(operations).not.toContainEqual(
        expect.objectContaining({ status: "deadlocked", lockResource: "ram" }),
      );
      sawRamLoad = operations.some((operation) => operation.status === "loadingRam");
    }

    expect(sawRamLoad).toBe(true);

    const operation = findActiveRuntimeTask(state, "memoryScrub")
      ?.coreOperations.find((candidate) => candidate.status === "loadingRam");
    expect(operation?.ramChannelCount).toBe(1);
    expect(operation?.ramBlocks).toEqual([
      expect.objectContaining({
        stickId: 1,
        startBit: 0,
        lengthBits: 256,
        channelIndex: 0,
      }),
      expect.objectContaining({
        stickId: 2,
        startBit: 0,
        lengthBits: 256,
        channelIndex: 0,
      }),
    ]);
    expect(operation?.ramBlocks[1]?.loadedBits).toBe(0);

    const visibleBeforeTick = deriveVisibleState(state);
    expect(
      visibleBeforeTick.metrics.ramResidency.map((segment) => ({
        stickId: segment.stickId,
        state: segment.state,
      })),
    ).toEqual([
      { stickId: 1, state: "loading" },
      { stickId: 2, state: "reserved" },
    ]);

    const blockLoadsBefore = (operation?.ramBlocks ?? []).map(
      (block) => block.loadedBits,
    );
    state = tickGame(state, 1000);
    const blocksAfter = findActiveRuntimeTask(state, "memoryScrub")
      ?.coreOperations.find((candidate) => candidate.status === "loadingRam")
      ?.ramBlocks;
    const expectedSingleChannelBandwidth = Math.min(
      getCoreClockHz(state, operation?.coreId ?? 1),
      state.hardware.ramSticks[0]?.speedMt ?? 1,
    );

    expect((blocksAfter?.[0]?.loadedBits ?? 0) - (blockLoadsBefore[0] ?? 0)).toBeCloseTo(
      expectedSingleChannelBandwidth,
    );
    expect((blocksAfter?.[1]?.loadedBits ?? 0) - (blockLoadsBefore[1] ?? 0)).toBe(0);
    expect(deriveVisibleState(state).metrics.memory.effectiveBandwidthBps).toBeCloseTo(
      expectedSingleChannelBandwidth,
    );
  });

  it("serves one RAM stick per channel while other single-channel sticks wait", () => {
    let state = withRamSticks(unlockSystemScheduler(), [
      { ...createRamStickState(1, 1, 7), speedMt: 60 },
      { ...createRamStickState(2, 1, 7), speedMt: 60 },
    ]);

    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });
    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });

    for (let tick = 0; tick < 20; tick += 1) {
      state = tickGame(state, 1000);
      if (
        state.activeTasks.length === 2 &&
        state.activeTasks.every((task) =>
          task.coreOperations.some((operation) => operation.status === "loadingRam"),
        )
      ) {
        break;
      }
    }

    const operations = state.activeTasks.flatMap((task) => task.coreOperations);
    const blocksBefore = operations.flatMap((operation) => operation.ramBlocks ?? []);

    expect(blocksBefore).toEqual([
      expect.objectContaining({ stickId: 1, channelIndex: 0 }),
      expect.objectContaining({ stickId: 2, channelIndex: 0 }),
    ]);
    expect(deriveVisibleState(state).metrics.ramResidency).toEqual([
      expect.objectContaining({ stickId: 1, state: "loading" }),
      expect.objectContaining({ stickId: 2, state: "reserved" }),
    ]);

    state = tickGame(state, 1000);
    const blocksAfter = state.activeTasks
      .flatMap((task) => task.coreOperations)
      .flatMap((operation) => operation.ramBlocks ?? []);
    const firstStickDelta =
      (blocksAfter.find((block) => block.stickId === 1)?.loadedBits ?? 0) -
      (blocksBefore.find((block) => block.stickId === 1)?.loadedBits ?? 0);
    const secondStickDelta =
      (blocksAfter.find((block) => block.stickId === 2)?.loadedBits ?? 0) -
      (blocksBefore.find((block) => block.stickId === 2)?.loadedBits ?? 0);
    const firstStickOperation = operations.find(
      (operation) => operation.ramBlocks?.[0]?.stickId === 1,
    );
    const expectedSingleStickBandwidth = Math.min(
      60,
      getCoreClockHz(state, firstStickOperation?.coreId ?? 1),
    );

    expect(firstStickDelta).toBeCloseTo(expectedSingleStickBandwidth);
    expect(secondStickDelta).toBe(0);
    expect(deriveVisibleState(state).metrics.memory.effectiveBandwidthBps).toBeCloseTo(
      expectedSingleStickBandwidth,
    );
  });

  it("keeps multi-core RAM work loading after the first spilled stick fills", () => {
    let state = withRamSticks(unlockSystemStats(), [
      { ...createRamStickState(1, 2, 9), speedMt: 512 },
      { ...createRamStickState(2, 1, 9), speedMt: 512 },
      { ...createRamStickState(3, 1, 9), speedMt: 512 },
    ]);
    state = withPrimarySchedulerCapacity(state, 2);
    state = {
      ...state,
      hardware: {
        ...state.hardware,
        cpus: state.hardware.cpus.map((cpu) =>
          cpu.id === 1
            ? {
                ...cpu,
                level: 18,
                coreIds: [1, 2],
                schedulerSlots: 2,
              }
            : cpu,
        ),
      },
    };

    expect(getTaskDefinition("busMirror").ramNeedBits).toBe(1024);

    state = applyAction(state, { type: "startTask", taskId: "busMirror" });
    state = tickUntilTaskOperationStatus(state, "busMirror", "loadingRam");

    let busMirror = findActiveRuntimeTask(state, "busMirror");
    expect(busMirror?.coreOperations).toHaveLength(2);
    expect(
      busMirror?.coreOperations.map((operation) =>
        operation.ramBlocks.map((block) => block.stickId),
      ),
    ).toEqual([[1], [2, 3]]);

    for (let tick = 0; tick < 200; tick += 1) {
      const current = findActiveRuntimeTask(state, "busMirror");
      const firstOperation = current?.coreOperations[0];
      const secondOperation = current?.coreOperations[1];
      if (
        firstOperation?.status === "complete" &&
        secondOperation?.status === "loadingRam"
      ) {
        break;
      }

      state = tickGame(state, 250);
    }

    busMirror = findActiveRuntimeTask(state, "busMirror");
    const firstOperation = busMirror?.coreOperations[0];
    const secondOperation = busMirror?.coreOperations[1];

    expect(busMirror).toBeDefined();
    expect(firstOperation?.status).toBe("complete");
    expect(firstOperation?.memoryReservedBits).toBe(512);
    expect(firstOperation?.ramBlocks).toEqual([
      expect.objectContaining({
        stickId: 1,
        lengthBits: 512,
        loadedBits: 512,
      }),
    ]);
    expect(secondOperation?.status).toBe("loadingRam");
    expect(secondOperation?.ramBlocks).toEqual([
      expect.objectContaining({ stickId: 2, lengthBits: 256 }),
      expect.objectContaining({ stickId: 3, lengthBits: 256 }),
    ]);
    expect(
      (secondOperation?.ramBlocks ?? []).reduce(
        (total, block) => total + block.loadedBits,
        0,
      ),
    ).toBeLessThan(512);
    expect(deriveVisibleState(state).metrics.ramResidency).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stickId: 1,
          state: "loaded",
          bits: 512,
        }),
        expect.objectContaining({
          stickId: 2,
          bits: 256,
        }),
        expect.objectContaining({
          stickId: 3,
          bits: 256,
        }),
      ]),
    );
    expect(deriveVisibleState(state).activeTasks).toContainEqual(
      expect.objectContaining({
        parentTaskId: "busMirror",
        taskId: "readBusWindow",
        status: "loadingRam",
      }),
    );
  });

  it("keeps concurrent single-stick RAM allocations in distinct address ranges", () => {
    let state = withRamSticks(unlockSystemScheduler(), [
      { ...createRamStickState(1, 2, 7), speedMt: 60 },
    ]);

    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });
    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });

    for (let tick = 0; tick < 20; tick += 1) {
      state = tickGame(state, 1000);
      if (
        state.activeTasks.length === 2 &&
        state.activeTasks.every((task) =>
          task.coreOperations.some((operation) => operation.status === "loadingRam"),
        )
      ) {
        break;
      }
    }

    const operations = state.activeTasks.flatMap((task) => task.coreOperations);
    expect(operations).toHaveLength(2);
    expect(operations).not.toContainEqual(
      expect.objectContaining({ status: "deadlocked", lockResource: "ram" }),
    );

    const blocks = operations.flatMap((operation) => operation.ramBlocks ?? []);
    expect(blocks).toEqual([
      expect.objectContaining({
        stickId: 1,
        startBit: 0,
        lengthBits: 256,
        channelIndex: 0,
      }),
      expect.objectContaining({
        stickId: 1,
        startBit: 256,
        lengthBits: 256,
        channelIndex: 0,
      }),
    ]);

    const visibleSegments = deriveVisibleState(state).metrics.ramResidency;
    expect(visibleSegments.map((segment) => segment.startBit)).toEqual([0, 256]);
    expect(visibleSegments.map((segment) => segment.bits)).toEqual([256, 256]);
    expect(visibleSegments.map((segment) => segment.state)).toEqual([
      "loading",
      "loading",
    ]);

    const loadedBefore = blocks.reduce(
      (total, block) => total + block.loadedBits,
      0,
    );
    state = tickGame(state, 1000);
    const blocksAfter = state.activeTasks
      .flatMap((task) => task.coreOperations)
      .flatMap((operation) => operation.ramBlocks ?? []);
    const loadedAfter = blocksAfter.reduce(
      (total, block) => total + block.loadedBits,
      0,
    );
    const blockDeltas = blocksAfter.map(
      (block, index) => block.loadedBits - (blocks[index]?.loadedBits ?? 0),
    );
    const expectedWriterBandwidth = Math.min(
      state.hardware.ramSticks[0]?.speedMt ?? 1,
      state.activeTasks
        .flatMap((task) => task.coreOperations)
        .reduce(
          (total, operation) => total + getCoreClockHz(state, operation.coreId),
          0,
        ),
    );
    const visible = deriveVisibleState(state);

    expect(blockDeltas.every((delta) => delta > 0)).toBe(true);
    expect(loadedAfter - loadedBefore).toBeCloseTo(expectedWriterBandwidth);
    expect(visible.metrics.memory.activeChannelCount).toBe(1);
    expect(visible.metrics.memory.effectiveBandwidthBps).toBeCloseTo(
      expectedWriterBandwidth,
    );

    state = finishActiveTasks(state);
    expect(state.completedTasks.tinyChecksum).toBeGreaterThanOrEqual(2);
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

  it("cancels one chunked work unit from a core and leaves the parent active", () => {
    const compileCode = getTaskDefinition("compileCode");
    let state = withSystemCatalog(
      withPrimaryCpuCache(
        withRamCapacity(
          withPrimarySchedulerCapacity(unlockSystemScheduler(), 4),
          compileCode.ramNeedBits * 4,
        ),
        compileCode.cacheNeedBits * 4,
      ),
    );

    state = applyAction(state, { type: "startTask", taskId: "compileCode" });

    const activeCompileChildren = getActiveRuntimeTasks(state, "compileCode");
    const activeCompile = activeCompileChildren[0];
    const activeChildEntry = getLocalQueueEntries(state).find(
      (entry) => (entry.reservationId ?? entry.id) === activeCompile?.queueEntryId,
    );
    const cancelledCoreId = activeCompile?.coreOperations[0]?.coreId;
    const cancelledWorkUnit = activeChildEntry?.workUnitIndex;

    expect(activeCompileChildren).toHaveLength(4);
    expect(cancelledCoreId).toBeDefined();
    expect(cancelledWorkUnit).toBe(0);

    state = applyAction(state, {
      type: "cancelTask",
      taskId: "compileCode",
      instanceId: activeCompile?.instanceId,
      coreId: cancelledCoreId,
    });

    const requeuedEntry = getLocalQueueEntries(state).find(
      (entry) =>
        entry.parentTaskId === "compileCode" &&
        entry.workUnitIndex === cancelledWorkUnit,
    );
    expect(requeuedEntry).toBeDefined();
    expect(state.activeTasks).not.toContainEqual(
      expect.objectContaining({
        instanceId: activeCompile?.instanceId,
      }),
    );
    expect(state.queue).toEqual(["compileCode"]);

    state = tickGame(state, 16);

    const resumedEntry = getLocalQueueEntries(state).find(
      (entry) =>
        entry.parentTaskId === "compileCode" &&
        entry.workUnitIndex === cancelledWorkUnit,
    );
    expect(resumedEntry).toBeDefined();
  });

  it("cancels pending queued work without removing active scheduler reservations", () => {
    let state = withRamCapacity(unlockSystemScheduler(), 256);

    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });
    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });

    expect(state.activeTasks).toHaveLength(1);
    expect(state.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(getLocalQueueTaskIds(state)).toEqual(["stageChecksumPage"]);

    state = applyAction(state, {
      type: "cancelQueuedTask",
      taskId: "tinyChecksum",
    });

    expect(state.activeTasks).toHaveLength(1);
    expect(state.queue).toEqual(["tinyChecksum"]);
    expect(getLocalQueueTaskIds(state)).toEqual(["stageChecksumPage"]);
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

    expect(state.activeTasks).toContainEqual(
      expect.objectContaining({
        taskId: "stageChecksumPage",
        parentTaskId: "tinyChecksum",
      }),
    );
    expect(state.activeTasks[0]?.schedulerQueued).toBe(true);
    expect(getLocalQueueTaskIds(state)).toEqual(["stageChecksumPage"]);
    expect(state.queueEntries?.[0]).toEqual(
      expect.objectContaining({
        taskId: "tinyChecksum",
        target: "system",
      }),
    );
    expect(
      Object.values(state.coreSchedulers).flatMap(
        (core) => core.localQueueEntries ?? [],
      ),
    ).toEqual([
      expect.objectContaining({
        taskId: "stageChecksumPage",
        parentTaskId: "tinyChecksum",
        childTaskId: "stageChecksumPage",
        childTaskName: "Stage Checksum Page",
        target: "cpu",
      }),
    ]);
  });

  it("pays the system parent once after CPU children finish", () => {
    let state = unlockSystemScheduler();
    const dataBefore = state.resources.data;
    const completedBefore = state.completedTasks.tinyChecksum ?? 0;

    state = runTask(state, "tinyChecksum");

    expect(state.completedTasks.tinyChecksum).toBe(completedBefore + 1);
    expect(state.completedTasks.stageChecksumPage).toBeUndefined();
    expect(state.completedTasks.checksumStep).toBeUndefined();
    expect(state.resources.data).toBe(
      dataBefore + getTaskDefinition("tinyChecksum").rewardData,
    );
  });

  it("keeps system tasks queued when no CPU scheduler slots exist", () => {
    let state = unlockRamControl();

    state = buy(state, "ram");
    state = buyAllRamStickUpgrade(state, "ramCapacity");
    state = buyAllRamStickUpgrade(state, "ramCapacity");
    state = research(state, "systemScheduler");
    state = buy(state, "systemSchedulerSlot");

    expect(state.hardware.schedulerSlots).toBe(0);
    expect(state.hardware.systemSchedulerSlots).toBe(1);

    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });

    expect(state.queue).toEqual(["tinyChecksum"]);
    expect(state.activeTasks).toHaveLength(0);
    expect(Object.values(state.coreSchedulers).flatMap((core) => core.localQueue)).toEqual(
      [],
    );

    state = tickGame(state, 1000);

    expect(state.queue).toEqual(["tinyChecksum"]);
    expect(state.activeTasks).toHaveLength(0);
    expect(Object.values(state.coreSchedulers).flatMap((core) => core.localQueue)).toEqual(
      [],
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
    expect(getLocalQueueTaskIds(state)).toEqual(["stageChecksumPage"]);
  });

  it("keeps routing full system scheduler queues into cache-blocked CPU scheduler slots", () => {
    let state = withPrimaryCpuSchedulerPolicy(
      withPrimaryCpuCache(
      withRamCapacity(withPrimarySchedulerCapacity(unlockSystemScheduler(), 8), 4096),
        32,
      ),
      "fifo",
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

  it("reserves one CPU scheduler slot per core for fixed-width system tasks", () => {
    let state = withPrimaryCpuCache(
      withRamCapacity(unlockSystemStats(), getTaskDefinition("shardReconcile").ramNeedBits),
      getTaskDefinition("shardReconcile").cacheNeedBits,
    );

    state = applyAction(state, { type: "startTask", taskId: "shardReconcile" });

    const shardTask = findActiveRuntimeTask(state, "shardReconcile");
    const localQueue = getLocalQueueTaskIds(state);

    expect(shardTask?.assignedCoreIds).toHaveLength(4);
    expect(shardTask?.coreOperations).toHaveLength(4);
    expect(localQueue).toEqual([
      "loadShards",
      "loadShards",
      "loadShards",
      "loadShards",
    ]);

    state = applyAction(state, {
      type: "cancelTask",
      taskId: "shardReconcile",
      instanceId: shardTask?.instanceId,
    });

    expect(state.queue).toEqual([]);
    expect(getLocalQueueTaskIds(state)).toEqual([]);
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

  it("keeps active CPU work moving while system tasks wait for RAM", () => {
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

    const cpuTaskBefore = state.activeTasks.find(
      (task) => task.instanceId === cpuTaskInstanceId,
    );
    const cpuOperationBefore = cpuTaskBefore?.coreOperations[0];

    expect(state.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(state.activeTasks.flatMap((task) => task.coreOperations)).not.toContainEqual(
      expect.objectContaining({ status: "deadlocked", lockResource: "ram" }),
    );

    state = tickGame(state, 1000);

    const cpuOperationAfter = state.activeTasks
      .find((task) => task.instanceId === cpuTaskInstanceId)
      ?.coreOperations[0];

    expect(cpuOperationAfter?.remainingCycles).toBeLessThan(
      cpuOperationBefore?.remainingCycles ?? Number.POSITIVE_INFINITY,
    );
    expect(cpuOperationAfter?.remainingLoadCycles).toBe(0);
    expect(
      deriveVisibleState(state).activeTasks.find(
        (task) => task.instanceId === cpuTaskInstanceId,
      )?.status,
    ).not.toBe("deadlocked");
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

  it("none scheduler policy can dispatch queued work into a cache deadlock", () => {
    let state = withSchedulerSlots(withExactByteCopyCache(completeStarterLadder()), 1);
    state = {
      ...state,
      flags: { ...state.flags, basicQueue: true, schedulerPolicies: true },
    };
    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "cpu",
      cpuId: 1,
      policy: "none",
    });

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

  it("scheduler policies skip dispatches that would exceed free cache", () => {
    let state = withSchedulerSlots(withExactByteCopyCache(completeStarterLadder()), 1);
    state = {
      ...state,
      flags: { ...state.flags, schedulerPolicies: true },
    };
    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "cpu",
      cpuId: 1,
      policy: "fifo",
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

  it("scheduler policies avoid queued cache footprints before writes exhaust", () => {
    let state = withSchedulerSlots(withExactByteCopyCache(completeStarterLadder()), 2);
    state = {
      ...state,
      flags: { ...state.flags, schedulerPolicies: true },
    };
    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "cpu",
      cpuId: 1,
      policy: "fifo",
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

  it("system scheduler routing policies avoid queued RAM footprints before writes exhaust", () => {
    let state = withRamCapacity(unlockSystemScheduler(), 256);
    state = {
      ...state,
      flags: { ...state.flags, schedulerPolicies: true },
    };
    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "system",
      policy: "fifo",
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

  it("only none system routing ignores RAM-safe admission", () => {
    const makeState = () => {
      const base = withRamCapacity(unlockSystemScheduler(), 256);
      return {
        ...base,
        flags: { ...base.flags, schedulerPolicies: true },
      };
    };
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

    let safeState = applyAction(makeState(), {
      type: "setSchedulerPolicy",
      target: "system",
      policy: "fifo",
    });
    safeState = queueTwoChecksums(safeState);

    expect(safeState.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(getLocalQueueEntries(safeState)).toHaveLength(1);
    expect(safeState.activeTasks).toHaveLength(1);

    let noneState = applyAction(makeState(), {
      type: "setSchedulerPolicy",
      target: "system",
      policy: "none",
    });
    noneState = queueTwoChecksums(noneState);

    expect(noneState.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(getLocalQueueEntries(noneState)).toHaveLength(2);
    expect(noneState.activeTasks).toHaveLength(2);
  });

  it("system scheduler routing policies cap chunked work to RAM-safe width", () => {
    const compileCode = getTaskDefinition("compileCode");
    let state = withSystemCatalog(
      withPrimaryCpuCache(
        withRamCapacity(
          withPrimarySchedulerCapacity(unlockSystemScheduler(), 4),
          compileCode.ramNeedBits * 2,
        ),
        compileCode.cacheNeedBits * 4,
      ),
    );
    state = {
      ...state,
      flags: { ...state.flags, schedulerPolicies: true },
    };
    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "system",
      policy: "fifo",
    });

    state = applyAction(state, { type: "queueTask", taskId: "compileCode" });
    state = tickGame(state, 16);

    const activeCompile = getActiveRuntimeTasks(state, "compileCode");
    expect(activeCompile).toHaveLength(2);
    expect(getLocalQueueTaskIds(state)).toEqual([
      "stageSourceTree",
      "stageSourceTree",
    ]);

    state = tickGame(state, 1000);

    expect(state.activeTasks.flatMap((task) => task.coreOperations)).not.toContainEqual(
      expect.objectContaining({ status: "deadlocked", lockResource: "ram" }),
    );
  });

  it("tracks chunked system work as per-work-unit CPU child entries until parent completion", () => {
    const compileCode = getTaskDefinition("compileCode");
    const coreIds = Array.from({ length: 16 }, (_item, index) => index + 1);
    let state = withPrimaryCpuCache(
      withRamCapacity(
        withPrimarySchedulerCapacity(createRackReadyGameState(), coreIds.length),
        8192,
      ),
      4096,
    );
    state = {
      ...state,
      hardware: {
        ...state.hardware,
        psuWatts: 1_000_000_000,
        ramSpeedLevel: 20,
        ramSpeedMt: 1_000_000,
        ramSticks: [
          {
            id: 1,
            level: 1,
            bits: 8192,
            bytes: 1024,
            speedLevel: 20,
            speedMt: 1_000_000,
          },
        ],
        cpus: state.hardware.cpus.map((cpu) =>
          cpu.id === 1
            ? {
                ...cpu,
                level: 30,
                coreIds,
                schedulerSlots: coreIds.length,
                cacheBits: 4096,
                cacheBytes: 512,
                cacheSpeedLevel: 20,
              }
            : cpu,
        ),
      },
      power: {
        ...state.power,
        bootstrapGraceSeconds: 9999,
      },
    };
    const dataBefore = state.resources.data;

    state = applyAction(state, { type: "queueTask", taskId: "compileCode" });
    state = tickGame(state, 16);

    const firstWaveEntries = getLocalQueueEntries(state);
    expect(firstWaveEntries).toHaveLength(coreIds.length);
    expect(new Set(firstWaveEntries.map((entry) => entry.workUnitIndex)).size).toBe(
      coreIds.length,
    );
    expect(firstWaveEntries).toEqual(
      firstWaveEntries.map(() =>
        expect.objectContaining({
          taskId: "stageSourceTree",
          parentTaskId: "compileCode",
          parentQueueEntryId: state.queueEntries?.[0]?.id,
          target: "cpu",
        }),
      ),
    );
    expect(state.completedTasks.compileCode).toBeUndefined();
    expect(state.completedTasks.stageSourceTree).toBeUndefined();

    let guard = 0;
    while ((state.activeTasks.length > 0 || state.queue.length > 0) && guard < 100) {
      state = tickGame(state, 2000);
      guard += 1;
    }

    expect(guard).toBeLessThan(100);
    expect(state.queue).toEqual([]);
    expect(state.activeTasks).toEqual([]);
    expect(state.completedTasks.compileCode).toBe(1);
    expect(state.completedTasks.stageSourceTree).toBeUndefined();
    expect(state.resources.data).toBe(dataBefore + compileCode.rewardData);
  });

  it("system routing gates RAM while only CPU none ignores cache safety", () => {
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
      policy: "fifo",
    });
    systemSafeState = applyAction(systemSafeState, {
      type: "setSchedulerPolicy",
      target: "cpu",
      cpuId: 1,
      policy: "none",
    });
    systemSafeState = queueTwoChecksums(systemSafeState);

    expect(systemSafeState.queue).toEqual(["tinyChecksum", "tinyChecksum"]);
    expect(systemSafeState.activeTasks).toHaveLength(2);

    let cpuSafeState = withSchedulerPolicies(makeState());
    cpuSafeState = applyAction(cpuSafeState, {
      type: "setSchedulerPolicy",
      target: "system",
      policy: "fifo",
    });
    cpuSafeState = applyAction(cpuSafeState, {
      type: "setSchedulerPolicy",
      target: "cpu",
      cpuId: 1,
      policy: "fifo",
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
      flags: { ...state.flags, schedulerWatchdog: true, schedulerPolicies: true },
    };
    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "cpu",
      cpuId: 1,
      policy: "none",
    });
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
      victimTaskId: "stageChecksumPage",
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

  it("levels Bootloader Research after System Scheduler to shorten startup", () => {
    let state = fund(unlockRamControl());

    expect(
      deriveVisibleState(state).research.map((item) => item.id),
    ).not.toContain("bootloader");

    state = unlockSystemScheduler();
    let visible = deriveVisibleState(state);
    let bootloaderResearch = visible.research.find(
      (item) => item.id === "bootloader",
    );

    expect(bootloaderResearch).toEqual(
      expect.objectContaining({
        completed: false,
        canBuy: true,
        costs: [{ resource: "credits", amount: 100_000 }],
      }),
    );

    state = research(state, "bootloader");
    visible = deriveVisibleState(state);
    bootloaderResearch = visible.research.find((item) => item.id === "bootloader");

    expect(state.flags.bootloader).toBe(true);
    expect(getGlobalBootloaderLevel(state)).toBe(0);
    expect(bootloaderResearch).toEqual(
      expect.objectContaining({
        completed: false,
        actionLabel: "Level up",
        costs: getBootloaderUpgradeCost(1),
      }),
    );
    expect(visible.upgrades.map((upgrade) => upgrade.id)).not.toContain("bootloader");

    state = research(state, "bootloader");
    expect(getGlobalBootloaderLevel(state)).toBe(1);
    expect(getBootSeconds(state)).toBe(9.2);

    state = applyAction(state, { type: "requestShutdown" });

    expect(state.power.state).toBe("shuttingDown");
    expect(state.power.transitionSeconds).toBe(7.2);
    expect(state.power.transitionTotalSeconds).toBe(7.2);

    state = applyAction(state, { type: "requestPowerKill" });
    state = applyAction(state, { type: "requestPowerOn" });

    expect(state.power.state).toBe("booting");
    expect(state.power.transitionSeconds).toBe(9.2);
    expect(state.power.transitionTotalSeconds).toBe(9.2);

    state = tickSeconds(state, 10);
    expect(state.power.state).toBe("on");

    while (getGlobalBootloaderLevel(state) < BOOTLOADER_MAX_LEVEL - 1) {
      state = research(state, "bootloader");
    }

    visible = deriveVisibleState(state);
    bootloaderResearch = visible.research.find((item) => item.id === "bootloader");
    expect(getGlobalBootloaderLevel(state)).toBe(35);
    expect(bootloaderResearch?.costs).toEqual(getBootloaderUpgradeCost(36));
    expect(bootloaderResearch?.costs).toEqual([
      { resource: "credits", amount: 5_906_682 },
    ]);

    state = research(state, "bootloader");

    expect(getGlobalBootloaderLevel(state)).toBe(36);
    expect(getBootSeconds(state)).toBe(0.1);

    state = applyAction(state, { type: "requestShutdown" });

    expect(state.power.state).toBe("shuttingDown");
    expect(state.power.transitionSeconds).toBe(0.1);
    expect(state.power.transitionTotalSeconds).toBe(0.1);

    expect(
      deriveVisibleState(state).research.find((item) => item.id === "bootloader"),
    ).toEqual(
      expect.objectContaining({
        completed: true,
        canBuy: false,
      }),
    );
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
    expect(state.hardware.ramSpeedMt).toBe(1.5);
    expect(getRamLoadRate(state)).toBe(1.5);
    expect(new Set(state.hardware.ramSticks.map((stick) => stick.speedMt))).toEqual(
      new Set([1.5]),
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
    expect(visible.upgrades.map((upgrade) => upgrade.id)).toContain("secondCpu");
    expect(visible.upgrades.map((upgrade) => upgrade.id)).not.toContain("matchedCpu");
    expect(unmatchedCpuUpgrade?.name).toBe("Install CPU");
    expect(
      unmatchedCpuUpgrade?.costs.find((cost) => cost.resource === "credits")?.amount,
    ).toBe(16);
    expect(
      unmatchedCpuUpgrade?.costs.find((cost) => cost.resource === "data")?.amount,
    ).toBeUndefined();
    expect(unmatchedCpuUpgrade?.powerDeltaWatts).toBeGreaterThan(0);

    const unmatchedState = buy(state, "secondCpu");
    expect(unmatchedState.hardware.secondCpu).toBe(true);
    expect(unmatchedState.hardware.cpus).toHaveLength(2);
    expect(unmatchedState.hardware.cpus[1]?.coreIds).toEqual([5]);
    expect(unmatchedState.hardware.cpus[1]?.tierId).toBe("hz");
    expect(unmatchedState.hardware.cpus[1]?.level).toBe(1);
    expect(unmatchedState.hardware.cpus[1]?.cacheLevel).toBe(1);
    expect(unmatchedState.hardware.cpus[1]?.schedulerSlots).toBe(0);

    state = unmatchedState;

    expect(state.flags.secondCpu).toBe(true);
    expect(state.hardware.secondCpu).toBe(true);
    expect(state.hardware.cpus).toHaveLength(2);
    expect(state.hardware.cpus[0]?.coreIds).toEqual([1, 2, 3, 4]);
    expect(state.hardware.cpus[1]?.coreIds).toEqual([5]);
    expect(state.hardware.cpus[1]?.cacheLevel).toBe(1);
    expect(state.hardware.cpus[1]?.schedulerSlots).toBe(0);
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
        findActiveRuntimeTask(state, "tinyChecksum")?.coreOperations[0]
          ?.operationName === "Checksum Step" &&
        findActiveRuntimeTask(state, "tinyChecksum")?.coreOperations[0]?.status ===
          "running"
      ) &&
      guard < 700
    ) {
      state = tickGame(state, 500);
      guard += 1;
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

  it("keeps multiple system tasks moving through RAM loads", () => {
    let state = withPrimarySchedulerCapacity(unlockSystemScheduler(), 4);
    state = {
      ...state,
      hardware: {
        ...state.hardware,
        ramSpeedLevel: 9,
        ramSpeedMt: 256,
        ramSticks: state.hardware.ramSticks.map((stick) => ({
          ...stick,
          speedLevel: 9,
          speedMt: 256,
        })),
      },
    };
    state = runTask(state, "tinyChecksum");

    for (const taskId of [
      "memoryScrub",
      "queueCompaction",
      "powerTelemetry",
      "tinyChecksum",
    ] as const) {
      state = applyAction(state, { type: "queueTask", taskId });
    }

    expect(state.queue).toHaveLength(4);

    let lastLoadedBits = 0;
    let sawRamLoadProgress = false;

    for (
      let tick = 0;
      tick < 5000 && (state.activeTasks.length > 0 || state.queue.length > 0);
      tick += 1
    ) {
      state = tickGame(state, 500);
      const loadedBits = state.activeTasks
        .flatMap((task) => task.coreOperations)
        .flatMap((operation) => operation.ramBlocks ?? [])
        .reduce((total, block) => total + block.loadedBits, 0);

      if (loadedBits > lastLoadedBits) {
        sawRamLoadProgress = true;
      }
      lastLoadedBits = loadedBits;

      expect(
        state.activeTasks.flatMap((task) => task.coreOperations).some(
          (operation) => operation.status === "deadlocked",
        ),
      ).toBe(false);
    }

    expect(sawRamLoadProgress).toBe(true);
    expect(state.activeTasks).toHaveLength(0);
    expect(state.queue).toHaveLength(0);
    expect(state.completedTasks.memoryScrub).toBe(1);
    expect(state.completedTasks.queueCompaction).toBe(1);
    expect(state.completedTasks.powerTelemetry).toBe(1);
  });

  it("keeps RAM writes on stick one until channel research is unlocked", () => {
    let state = unlockSystemScheduler();
    state = buy(state, "ram");

    let visible = deriveVisibleState(state);
    const dualChannelResearch = visible.research.find(
      (item) => item.id === "dualChannelRam",
    );

    expect(state.hardware.ramSticks).toHaveLength(2);
    expect(dualChannelResearch?.canBuy).toBe(true);

    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });
    state = tickUntilTaskOperationStatus(state, "tinyChecksum", "loadingRam");

    const activeTask = findActiveRuntimeTask(state, "tinyChecksum");
    const operation = activeTask?.coreOperations.find(
      (candidate) => candidate.status === "loadingRam",
    );

    expect(activeTask?.schedulerQueued).toBe(true);
    expect(operation?.ramChannelCount).toBe(1);
    expect(operation?.ramBlocks).toEqual([
      expect.objectContaining({
        stickId: 1,
        startBit: 0,
        lengthBits: 256,
        channelIndex: 0,
      }),
    ]);

    visible = deriveVisibleState(state);
    expect(visible.metrics.memory.activeChannelCount).toBe(1);
    expect(visible.metrics.memory.maxChannelCount).toBe(1);
    expect(visible.metrics.memory.channelBlockedReason).toBe(
      "Needs Dual Channel RAM",
    );
  });

  it("allows RAM channel research before the matching stick count is installed", () => {
    let state = unlockSystemScheduler();

    expect(state.hardware.ramSticks).toHaveLength(1);

    let visible = deriveVisibleState(state);
    const dualChannelResearch = visible.research.find(
      (item) => item.id === "dualChannelRam",
    );

    expect(dualChannelResearch?.canBuy).toBe(true);
    expect(costAmount(dualChannelResearch?.costs ?? [], "credits")).toBe(200_000);
    expect(costAmount(dualChannelResearch?.costs ?? [], "data")).toBe(20_000);
    expect(dualChannelResearch?.requirements.map((item) => item.label)).not.toContain(
      "Install 2 RAM sticks",
    );

    state = research(state, "dualChannelRam");
    visible = deriveVisibleState(state);
    const quadChannelResearch = visible.research.find(
      (item) => item.id === "quadChannelRam",
    );

    expect(state.hardware.ramSticks).toHaveLength(1);
    expect(state.research.completed).toContain("dualChannelRam");
    expect(quadChannelResearch?.canBuy).toBe(true);
    expect(costAmount(quadChannelResearch?.costs ?? [], "credits")).toBe(50_000_000);
    expect(costAmount(quadChannelResearch?.costs ?? [], "data")).toBe(5_000_000);
    expect(quadChannelResearch?.requirements.map((item) => item.label)).not.toContain(
      "Install 4 RAM sticks",
    );

    state = research(state, "quadChannelRam");
    visible = deriveVisibleState(state);
    const octChannelResearch = visible.research.find(
      (item) => item.id === "octChannelRam",
    );

    expect(state.hardware.ramSticks).toHaveLength(1);
    expect(state.research.completed).toContain("quadChannelRam");
    expect(octChannelResearch?.canBuy).toBe(true);
    expect(costAmount(octChannelResearch?.costs ?? [], "credits")).toBe(
      1_000_000_000,
    );
    expect(costAmount(octChannelResearch?.costs ?? [], "data")).toBe(100_000_000);
    expect(octChannelResearch?.requirements.map((item) => item.label)).not.toContain(
      "Install 8 RAM sticks",
    );

    state = research(state, "octChannelRam");

    expect(state.hardware.ramSticks).toHaveLength(1);
    expect(state.research.completed).toEqual(
      expect.arrayContaining([
        "dualChannelRam",
        "quadChannelRam",
        "octChannelRam",
      ]),
    );
  });

  it("stripes system-scheduled RAM writes across researched channels", () => {
    let singleChannelState = unlockSystemScheduler();
    singleChannelState = buy(singleChannelState, "ram");
    singleChannelState = applyAction(singleChannelState, {
      type: "startTask",
      taskId: "tinyChecksum",
    });
    singleChannelState = tickUntilTaskOperationStatus(
      singleChannelState,
      "tinyChecksum",
      "loadingRam",
    );

    const singleBefore = singleChannelState.activeTasks[0]?.coreOperations[0];
    singleChannelState = tickGame(singleChannelState, 1000);
    const singleAfter = singleChannelState.activeTasks[0]?.coreOperations[0];
    const singleLoadedBits =
      (singleAfter?.ramBlocks ?? []).reduce(
        (total, block) => total + block.loadedBits,
        0,
      ) -
      (singleBefore?.ramBlocks ?? []).reduce(
        (total, block) => total + block.loadedBits,
        0,
      );

    let dualChannelState = unlockSystemScheduler();
    dualChannelState = buy(dualChannelState, "ram");
    dualChannelState = research(dualChannelState, "dualChannelRam");
    dualChannelState = applyAction(dualChannelState, {
      type: "startTask",
      taskId: "tinyChecksum",
    });
    dualChannelState = tickUntilTaskOperationStatus(
      dualChannelState,
      "tinyChecksum",
      "loadingRam",
    );

    const dualOperation = dualChannelState.activeTasks[0]?.coreOperations[0];
    expect(dualOperation?.ramChannelCount).toBe(2);
    expect(new Set(dualOperation?.ramBlocks.map((block) => block.stickId))).toEqual(
      new Set([1, 2]),
    );
    expect(dualOperation?.ramBlocks.map((block) => block.lengthBits)).toEqual([
      128,
      128,
    ]);

    const dualBefore = dualOperation;
    dualChannelState = tickGame(dualChannelState, 1000);
    const dualAfter = dualChannelState.activeTasks[0]?.coreOperations[0];
    const dualLoadedBits =
      (dualAfter?.ramBlocks ?? []).reduce(
        (total, block) => total + block.loadedBits,
        0,
      ) -
      (dualBefore?.ramBlocks ?? []).reduce(
        (total, block) => total + block.loadedBits,
        0,
      );
    const visible = deriveVisibleState(dualChannelState);

    expect(singleLoadedBits).toBe(1);
    expect(dualLoadedBits).toBe(2);
    expect(visible.metrics.memory.activeChannelCount).toBe(2);
    expect(visible.metrics.memory.maxChannelCount).toBe(2);
    expect(visible.metrics.memory.effectiveBandwidthBps).toBe(2);
    expect(visible.metrics.memory.channelBlockedReason).toBeNull();
  });

  it("allocates RAM across every single, dual, quad, and oct stick permutation", () => {
    const variants: Array<{
      label: string;
      maxChannels: number;
      research: ResearchId[];
    }> = [
      { label: "single", maxChannels: 1, research: [] },
      { label: "dual", maxChannels: 2, research: ["dualChannelRam"] },
      {
        label: "quad",
        maxChannels: 4,
        research: ["dualChannelRam", "quadChannelRam"],
      },
      {
        label: "oct",
        maxChannels: 8,
        research: ["dualChannelRam", "quadChannelRam", "octChannelRam"],
      },
    ];

    for (const variant of variants) {
      const baseState = unlockSystemScheduler();

      for (let stickCount = 1; stickCount <= 8; stickCount += 1) {
        const channelCount = Math.min(variant.maxChannels, stickCount);
        const state = withRamSticks(
          {
            ...baseState,
            research: {
              completed: [...baseState.research.completed, ...variant.research],
            },
          },
          Array.from({ length: stickCount }, (_, index) =>
            createRamStickState(index + 1, 1, 7),
          ),
        );
        const operation = createLoadingRamOperation(1, [], channelCount);
        const task = createActiveRamTask("allocation-test", 1, operation);
        const allocation = allocateRamBlocksForOperation(
          state,
          task,
          operation,
          256 * stickCount,
        );
        const bitsByStick = new Map<number, number>();
        const channelsByStick = new Map<number, Set<number>>();

        for (const block of allocation?.blocks ?? []) {
          bitsByStick.set(
            block.stickId,
            (bitsByStick.get(block.stickId) ?? 0) + block.lengthBits,
          );
          channelsByStick.set(
            block.stickId,
            (channelsByStick.get(block.stickId) ?? new Set()).add(
              block.channelIndex,
            ),
          );
        }

        expect(allocation?.channelCount, variant.label).toBe(channelCount);
        expect(
          (allocation?.blocks ?? []).reduce(
            (total, block) => total + block.lengthBits,
            0,
          ),
          variant.label,
        ).toBe(256 * stickCount);

        for (let stickIndex = 0; stickIndex < stickCount; stickIndex += 1) {
          const stickId = stickIndex + 1;

          expect(bitsByStick.get(stickId), variant.label).toBe(256);
          expect(
            Array.from(channelsByStick.get(stickId) ?? []),
            variant.label,
          ).toEqual([stickIndex % channelCount]);
        }
      }
    }
  });

  it("uses unused dual-channel sticks before extra capacity on a larger first stick", () => {
    const baseState = unlockSystemScheduler();
    const state = withRamSticks(
      {
        ...baseState,
        research: {
          completed: [...baseState.research.completed, "dualChannelRam"],
        },
      },
      [
        createRamStickState(1, 2, 7),
        createRamStickState(2, 1, 7),
        createRamStickState(3, 1, 7),
        createRamStickState(4, 1, 7),
      ],
    );
    const firstOperation = createLoadingRamOperation(1, [], 2);
    const firstTask = createActiveRamTask("mixed-first", 1, firstOperation);
    const firstAllocation = allocateRamBlocksForOperation(
      state,
      firstTask,
      firstOperation,
      512,
    );

    expect(
      firstAllocation?.blocks.map((block) => ({
        stickId: block.stickId,
        lengthBits: block.lengthBits,
        channelIndex: block.channelIndex,
      })),
    ).toEqual([
      { stickId: 1, lengthBits: 256, channelIndex: 0 },
      { stickId: 2, lengthBits: 256, channelIndex: 1 },
    ]);

    const stateWithFirstLoad = {
      ...state,
      activeTasks: [
        createActiveRamTask("mixed-first", 1, {
          ...firstOperation,
          ramBlocks: firstAllocation?.blocks ?? [],
          ramChannelCount: firstAllocation?.channelCount ?? 1,
        }),
      ],
    };
    const secondOperation = createLoadingRamOperation(2, [], 2);
    const secondTask = createActiveRamTask("mixed-second", 2, secondOperation);
    const secondAllocation = allocateRamBlocksForOperation(
      stateWithFirstLoad,
      secondTask,
      secondOperation,
      512,
    );

    expect(
      secondAllocation?.blocks.map((block) => ({
        stickId: block.stickId,
        lengthBits: block.lengthBits,
        channelIndex: block.channelIndex,
      })),
    ).toEqual([
      { stickId: 3, lengthBits: 256, channelIndex: 0 },
      { stickId: 4, lengthBits: 256, channelIndex: 1 },
    ]);
  });

  it("keeps RAM channel service groups from skipping lower-numbered sticks", () => {
    const variants: Array<{
      label: string;
      channelCount: number;
      research: ResearchId[];
    }> = [
      { label: "single", channelCount: 1, research: [] },
      { label: "dual", channelCount: 2, research: ["dualChannelRam"] },
      {
        label: "quad",
        channelCount: 4,
        research: ["dualChannelRam", "quadChannelRam"],
      },
      {
        label: "oct",
        channelCount: 8,
        research: ["dualChannelRam", "quadChannelRam", "octChannelRam"],
      },
    ];

    for (const variant of variants) {
      const baseState = unlockSystemScheduler();
      let state = withPrimarySchedulerCapacity(
        withRamSticks(
          {
            ...baseState,
            research: {
              completed: [...baseState.research.completed, ...variant.research],
            },
          },
          Array.from({ length: variant.channelCount * 2 }, (_, index) => ({
            ...createRamStickState(index + 1, 1, 7),
            speedMt: 64,
          })),
        ),
        2,
      );
      const firstGroupOperation = createLoadingRamOperation(
        1,
        Array.from({ length: variant.channelCount }, (_, index) => ({
          stickId: index + 1,
          startBit: 0,
          lengthBits: 256,
          loadedBits: index === 0 ? 0 : 256,
          channelIndex: index,
        })),
        variant.channelCount,
      );
      const nextGroupOperation = createLoadingRamOperation(
        2,
        Array.from({ length: variant.channelCount }, (_, index) => ({
          stickId: variant.channelCount + index + 1,
          startBit: 0,
          lengthBits: 256,
          loadedBits: 0,
          channelIndex: index,
        })),
        variant.channelCount,
      );

      state = {
        ...state,
        activeTasks: [
          createActiveRamTask(`${variant.label}-first-group`, 1, firstGroupOperation),
          createActiveRamTask(`${variant.label}-next-group`, 2, nextGroupOperation),
        ],
      };

      const firstGroupDeltas = getRamBlockLoadDeltasForOperationTick(
        state,
        firstGroupOperation,
        1,
      );
      const nextGroupDeltas = getRamBlockLoadDeltasForOperationTick(
        state,
        nextGroupOperation,
        1,
      );

      expect(firstGroupDeltas[0], variant.label).toBeGreaterThan(0);
      expect(firstGroupDeltas.slice(1), variant.label).toEqual(
        Array.from({ length: variant.channelCount - 1 }, () => 0),
      );
      expect(nextGroupDeltas, variant.label).toEqual(
        Array.from({ length: variant.channelCount }, () => 0),
      );
    }
  });

  it("reuses released RAM block locations after cancellation", () => {
    let state = withRamCapacity(unlockSystemScheduler(), 256);

    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });
    state = tickUntilTaskOperationStatus(state, "tinyChecksum", "loadingRam");

    const firstTask = findActiveRuntimeTask(state, "tinyChecksum");
    const firstBlock = firstTask?.coreOperations[0]?.ramBlocks[0];

    expect(firstBlock).toEqual(
      expect.objectContaining({ stickId: 1, startBit: 0, lengthBits: 256 }),
    );

    state = applyAction(state, {
      type: "cancelTask",
      taskId: "tinyChecksum",
      instanceId: firstTask?.instanceId,
    });
    state = applyAction(state, { type: "startTask", taskId: "tinyChecksum" });
    state = tickUntilTaskOperationStatus(state, "tinyChecksum", "loadingRam");

    const secondBlock = state.activeTasks[0]?.coreOperations[0]?.ramBlocks[0];
    expect(secondBlock).toEqual(
      expect.objectContaining({ stickId: 1, startBit: 0, lengthBits: 256 }),
    );
  });

  it("levels Memory Voltage Modifier as a RAM idle-draw reducer only", () => {
    const ramControlState = unlockRamControl();
    let state = fund({
      ...ramControlState,
      research: {
        completed: ["cpuTierKhz", "ramControl"],
      },
      flags: {
        ...ramControlState.flags,
        systemStats: true,
      },
    });
    state = buy(state, "ram");

    let visible = deriveVisibleState(state);
    expect(visible.research.find((item) => item.id === "memoryVoltageModifier")).toEqual(
      expect.objectContaining({
        completed: false,
        canBuy: true,
        costs: [{ resource: "credits", amount: 1_000_000 }],
      }),
    );

    state = research(state, "memoryVoltageModifier");
    visible = deriveVisibleState(state);

    expect(state.flags.memoryVoltageModifier).toBe(true);
    expect(state.hardware.memoryVoltageLevel).toBe(0);
    expect(getMemoryVoltageCost(2)).toEqual([
      { resource: "credits", amount: 180_000 },
    ]);
    expect(getMemoryVoltageCost(3)).toEqual([
      { resource: "credits", amount: 324_000 },
    ]);
    expect(getMemoryVoltageCost(9)).toEqual([
      { resource: "credits", amount: 11_019_960 },
    ]);
    expect(getMemoryVoltageIdleMultiplier(1)).toBeLessThan(1);
    expect(visible.research.find((item) => item.id === "memoryVoltageModifier")).toEqual(
      expect.objectContaining({
        completed: false,
        actionLabel: "Level up",
        costs: getMemoryVoltageCost(1),
      }),
    );
    expect(visible.upgrades.map((upgrade) => upgrade.id)).not.toContain(
      "memoryVoltage",
    );

    const idleBefore = getHardwareDrawWatts(state);
    state = research(state, "memoryVoltageModifier");
    const idleAfter = getHardwareDrawWatts(state);

    expect(state.hardware.memoryVoltageLevel).toBe(1);
    expect(idleAfter).toBeLessThan(idleBefore);

    const activeBaseline = unlockSystemScheduler();
    let activeState = {
      ...activeBaseline,
      hardware: {
        ...activeBaseline.hardware,
        memoryVoltageLevel: 1,
      },
    };
    activeState = applyAction(activeState, {
      type: "startTask",
      taskId: "tinyChecksum",
    });
    activeState = tickUntilTaskOperationStatus(
      activeState,
      "tinyChecksum",
      "loadingRam",
    );
    const activeDraw = getHardwareDrawWatts(activeState);
    const activeWithoutVoltage = getHardwareDrawWatts({
      ...activeState,
      hardware: {
        ...activeState.hardware,
        memoryVoltageLevel: 0,
      },
    });

    expect(activeDraw).toBeCloseTo(activeWithoutVoltage, 12);
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

  it("upgrades CPU package level for every core in the package", () => {
    let state = unlockMultiCore();

    state = buy(state, "core");

    const before = deriveVisibleState(state).metrics.cpuSockets[0]?.cores;
    const beforeCore1 = before?.find((core) => core.id === 1)?.clockHz;
    const beforeCore2 = before?.find((core) => core.id === 2)?.clockHz;

    state = buy(state, "clock", 2);

    const after = deriveVisibleState(state).metrics.cpuSockets[0]?.cores;

    expect(after?.find((core) => core.id === 1)?.clockHz).toBeGreaterThan(
      beforeCore1 ?? 0,
    );
    expect(after?.find((core) => core.id === 2)?.clockHz).toBeGreaterThan(
      beforeCore2 ?? 0,
    );
  });

  it("upgrades and downgrades CPU package level from the core group control", () => {
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

    expect(costAmount(groupedClock?.costs ?? [], "credits")).toBe(26);

    state = applyAction(state, {
      type: "buyUpgrade",
      upgradeId: "clock",
      coreIds: [1, 2],
    });

    expect(state.hardware.coreClockLevels[1]).toBe(2);
    expect(state.hardware.coreClockLevels[2]).toBe(2);
    expect(beforeBuyCredits - state.resources.credits).toBe(26);

    const groupedDowngrade =
      deriveVisibleState(state).metrics.cpuSockets[0]?.allCoreClockUpgrade;
    const beforeDowngradeCredits = state.resources.credits;

    expect(costAmount(groupedDowngrade?.refunds ?? [], "credits")).toBe(13);

    state = applyAction(state, {
      type: "downgradeUpgrade",
      upgradeId: "clock",
      coreIds: [1, 2],
    });

    expect(state.hardware.coreClockLevels[1]).toBe(1);
    expect(state.hardware.coreClockLevels[2]).toBe(1);
    expect(state.resources.credits - beforeDowngradeCredits).toBe(13);
  });

  it("keeps CPU level and core costs order-invariant", () => {
    const initial = createInitialGameState();
    const base = fund({
      ...initial,
      flags: {
        ...initial.flags,
        multiCore: true,
      },
    });

    const upgradeThenCoreStartCredits = base.resources.credits;
    let upgradeThenCore = buy(base, "clock", undefined, 1);
    const upgradeThenCoreCost =
      deriveVisibleState(upgradeThenCore).metrics.cpuSockets[0]?.coreUpgrade;

    expect(upgradeThenCoreStartCredits - upgradeThenCore.resources.credits).toBe(
      getCpuTierLevelDefinition("hz", 2).upgradeCost,
    );
    expect(costAmount(upgradeThenCoreCost?.costs ?? [], "credits")).toBe(161);
    expect(costAmount(upgradeThenCoreCost?.costs ?? [], "data")).toBe(5);

    upgradeThenCore = buy(upgradeThenCore, "core", undefined, 1);

    let coreThenUpgrade = buy(base, "core", undefined, 1);
    coreThenUpgrade = buy(coreThenUpgrade, "clock", undefined, 1);

    expect(upgradeThenCoreStartCredits - upgradeThenCore.resources.credits).toBe(
      base.resources.credits - coreThenUpgrade.resources.credits,
    );
    expect(upgradeThenCore.hardware.cpus[0]?.coreIds).toHaveLength(2);
    expect(coreThenUpgrade.hardware.cpus[0]?.coreIds).toHaveLength(2);
    expect(upgradeThenCore.hardware.cpus[0]?.level).toBe(2);
    expect(coreThenUpgrade.hardware.cpus[0]?.level).toBe(2);
  });

  it("removes a sold CPU core from a single-CPU package", () => {
    const initial = createInitialGameState();
    let state = fund({
      ...initial,
      flags: {
        ...initial.flags,
        multiCore: true,
      },
    });

    state = buy(state, "core", undefined, 1);

    const coreDowngrade =
      deriveVisibleState(state).metrics.cpuSockets[0]?.coreUpgrade;
    const beforeDowngradeCredits = state.resources.credits;

    expect(state.hardware.cores).toBe(2);
    expect(state.hardware.cpus[0]?.coreIds).toEqual([1, 2]);
    expect(state.coreSchedulers[2]).toBeDefined();
    expect(coreDowngrade?.canDowngrade).toBe(true);

    state = applyAction(state, {
      type: "downgradeUpgrade",
      upgradeId: "core",
      cpuId: 1,
    });

    expect(state.resources.credits - beforeDowngradeCredits).toBe(
      costAmount(coreDowngrade?.refunds ?? [], "credits"),
    );
    expect(state.hardware.cores).toBe(1);
    expect(state.hardware.cpus[0]?.coreIds).toEqual([1]);
    expect(state.hardware.coreClockLevels[2]).toBeUndefined();
    expect(state.coreSchedulers[2]).toBeUndefined();
    expect(deriveVisibleState(state).metrics.cpuSockets[0]?.cores).toHaveLength(1);
  });

  it("keeps cache frequency and core costs order-invariant", () => {
    const initial = createInitialGameState();
    const base = fund({
      ...initial,
      flags: {
        ...initial.flags,
        multiCore: true,
      },
    });

    const cacheThenCoreStartCredits = base.resources.credits;
    let cacheThenCore = buy(base, "cacheSpeed", undefined, 1);
    const cacheThenCoreCost =
      deriveVisibleState(cacheThenCore).metrics.cpuSockets[0]?.coreUpgrade;

    expect(cacheThenCoreStartCredits - cacheThenCore.resources.credits).toBe(
      getCpuTierLevelDefinition("hz", 2).upgradeCost,
    );
    expect(costAmount(cacheThenCoreCost?.costs ?? [], "credits")).toBe(161);
    expect(costAmount(cacheThenCoreCost?.costs ?? [], "data")).toBe(5);

    cacheThenCore = buy(cacheThenCore, "core", undefined, 1);

    let coreThenCache = buy(base, "core", undefined, 1);
    const twoCoreCacheCost =
      deriveVisibleState(coreThenCache).metrics.cpuSockets[0]?.cacheSpeedUpgrade;

    expect(costAmount(twoCoreCacheCost?.costs ?? [], "credits")).toBe(26);

    coreThenCache = buy(coreThenCache, "cacheSpeed", undefined, 1);

    expect(cacheThenCoreStartCredits - cacheThenCore.resources.credits).toBe(
      base.resources.credits - coreThenCache.resources.credits,
    );
    expect(cacheThenCore.hardware.cpus[0]?.coreIds).toHaveLength(2);
    expect(coreThenCache.hardware.cpus[0]?.coreIds).toHaveLength(2);
    expect(cacheThenCore.hardware.cpus[0]?.cacheSpeedLevel).toBe(2);
    expect(coreThenCache.hardware.cpus[0]?.cacheSpeedLevel).toBe(2);
  });

  it("prices added CPU cores at the selected CPU package tier", () => {
    let state = fund({
      ...createInitialGameState(),
      flags: {
        ...createInitialGameState().flags,
        multiCore: true,
        secondCpu: true,
      },
      research: {
        completed: ["cpuTierKhz"],
      },
    });

    state = buy(state, "secondCpu");

    const secondCpuCoreUpgrade = deriveVisibleState(state).metrics.cpuSockets.find(
      (socket) => socket.id === 2,
    )?.coreUpgrade;

    expect(state.hardware.cpus[1]).toEqual(
      expect.objectContaining({ tierId: "hz", level: 1 }),
    );
    expect(costAmount(secondCpuCoreUpgrade?.costs ?? [], "credits")).toBe(
      140 + getCpuTierLevelDefinition("hz", 1).upgradeCost,
    );
    expect(costAmount(secondCpuCoreUpgrade?.costs ?? [], "data")).toBe(5);
  });

  it("scales CPU package installs exponentially and allows removal", () => {
    let state = fund({
      ...createInitialGameState(),
      flags: {
        ...createInitialGameState().flags,
        secondCpu: true,
      },
    });

    state = buy(state, "secondCpu");

    const visibleCpuUpgrade = deriveVisibleState(state).upgrades.find(
      (upgrade) => upgrade.id === "secondCpu",
    );
    const twoCpuVisible = deriveVisibleState(state);
    const threeCpuState = buy(state, "secondCpu");
    const threeCpuVisible = deriveVisibleState(threeCpuState);
    const afterInstallCredits = state.resources.credits;
    const baseCpuCredits = getCpuTierLevelDefinition("hz", 1).upgradeCost;

    expect(state.hardware.cpus).toHaveLength(2);
    expect(
      twoCpuVisible.metrics.cpuSockets.every((socket) => socket.efficiency === 7.5),
    ).toBe(true);
    expect(getHardwareDrawWatts(state)).toBeGreaterThan(2 / 10 / 1_000_000);
    expect(threeCpuState.hardware.cpus).toHaveLength(3);
    expect(threeCpuState.hardware.cpus.every((cpu) => cpu.tierId === "hz")).toBe(true);
    expect(threeCpuState.hardware.cpus.at(-1)?.level).toBe(1);
    expect(
      threeCpuVisible.metrics.cpuSockets.every(
        (socket) => socket.efficiency === 5.625,
      ),
    ).toBe(true);
    expect(costAmount(visibleCpuUpgrade?.costs ?? [], "credits")).toBe(
      baseCpuCredits * 4,
    );
    expect(visibleCpuUpgrade?.canAfford).toBe(true);
    expect(visibleCpuUpgrade?.canDowngrade).toBe(true);
    expect(visibleCpuUpgrade?.refunds.length).toBeGreaterThan(0);

    state = applyAction(state, {
      type: "downgradeUpgrade",
      upgradeId: "secondCpu",
    });

    expect(state.hardware.cpus).toHaveLength(1);
    expect(state.hardware.secondCpu).toBe(false);
    expect(state.systems[0]?.hardware.cpus).toHaveLength(1);
    expect(state.systems[0]?.hardware.secondCpu).toBe(false);
    expect(deriveVisibleState(state).metrics.cpuSockets[0]?.efficiency).toBe(10);
    expect(deriveVisibleState(state).metrics.cpuSockets).toHaveLength(1);
    expect(state.resources.credits).toBeGreaterThan(afterInstallCredits);
  });

  it("derives installed CPU packages from the actual package list", () => {
    const initial = createInitialGameState();
    const visible = deriveVisibleState({
      ...initial,
      flags: { ...initial.flags, secondCpu: true },
      hardware: { ...initial.hardware, secondCpu: true },
    });

    expect(visible.hardware.cpus).toHaveLength(1);
    expect(visible.hardware.secondCpu).toBe(false);
    expect(visible.metrics.cpuSockets).toHaveLength(1);
  });

  it("allows cache capacity and cache speed upgrades from the start", () => {
    let state = fund(createInitialGameState());
    const beforeRate = getCacheLoadRate(state, 1);

    expect(beforeRate).toBe(1);

    state = buy(state, "cache");
    expect(state.hardware.cacheBits).toBe(2);

    state = buy(state, "cacheSpeed");
    expect(state.hardware.cacheSpeedLevel).toBe(2);
    expect(getCacheLoadRate(state, 1)).toBe(getCpuClockHz("hz", 2));
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

  it("prices cache capacity with data-heavy costs and RAM upgrades with CPU-style credit costs", () => {
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
    const twoStickRamVisible = deriveVisibleState(buy(buy(ramState, "ram"), "ram"));
    const ramUpgrade = ramVisible.upgrades.find((upgrade) => upgrade.id === "ram");
    const secondRamUpgrade = installedRamVisible.upgrades.find(
      (upgrade) => upgrade.id === "ram",
    );
    const thirdRamUpgrade = twoStickRamVisible.upgrades.find(
      (upgrade) => upgrade.id === "ram",
    );
    const ramCapacityUpgrade = installedRamVisible.upgrades.find(
      (upgrade) => upgrade.id === "ramCapacity",
    );
    const ramSpeedUpgrade = installedRamVisible.upgrades.find(
      (upgrade) => upgrade.id === "ramSpeed",
    );

    expect(cacheUpgrade).toBeDefined();
    expect(costAmount(cacheUpgrade?.costs ?? [], "data")).toBeGreaterThan(
      costAmount(cacheUpgrade?.costs ?? [], "credits"),
    );

    for (const upgrade of [ramUpgrade, ramCapacityUpgrade]) {
      expect(upgrade).toBeDefined();
      expect(upgrade?.costs).toEqual([
        expect.objectContaining({ resource: "credits" }),
      ]);
      expect(costAmount(upgrade?.costs ?? [], "data")).toBe(0);
    }

    for (const upgrade of [cacheSpeedUpgrade, ramSpeedUpgrade]) {
      expect(upgrade).toBeDefined();
      expect(upgrade?.costs).toEqual([
        expect.objectContaining({ resource: "credits" }),
      ]);
    }
    expect(costAmount(cacheSpeedUpgrade?.costs ?? [], "credits")).toBe(
      getCpuTierLevelDefinition("hz", 2).upgradeCost,
    );
    expect(costAmount(ramUpgrade?.costs ?? [], "credits")).toBe(
      getCpuTierLevelDefinition("hz", 1).upgradeCost,
    );
    expect(costAmount(secondRamUpgrade?.costs ?? [], "credits")).toBe(
      getCpuTierLevelDefinition("hz", 1).upgradeCost * 2,
    );
    expect(costAmount(thirdRamUpgrade?.costs ?? [], "credits")).toBe(
      getCpuTierLevelDefinition("hz", 1).upgradeCost * 4,
    );
    expect(costAmount(ramCapacityUpgrade?.costs ?? [], "credits")).toBe(
      getCpuTierLevelDefinition("hz", 2).upgradeCost * 2,
    );
    expect(costAmount(ramSpeedUpgrade?.costs ?? [], "credits")).toBe(
      getCpuTierLevelDefinition("hz", 2).upgradeCost,
    );
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
    state = buy(buy(buy(state, "core", undefined, 2), "core", undefined, 2), "core", undefined, 2);
    state = buy(
      buy(
        buy(buy(state, "schedulerSlot", undefined, 2), "schedulerSlot", undefined, 2),
        "schedulerSlot",
        undefined,
        2,
      ),
      "schedulerSlot",
      undefined,
      2,
    );
    state = buy(
      buy(buy(buy(state, "cache", undefined, 2), "cache", undefined, 2), "cache", undefined, 2),
      "cache",
      undefined,
      2,
    );
    state = {
      ...state,
      hardware: {
        ...state.hardware,
        schedulerSlots: state.hardware.schedulerSlots + 4,
        cpus: state.hardware.cpus.map((cpu) =>
          cpu.id === 1
            ? { ...cpu, cacheLevel: 1, cacheBits: 1, cacheBytes: 1 }
            : cpu.id === 2
              ? { ...cpu, schedulerSlots: 4 }
              : cpu,
        ),
      },
    };
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

    const benchmarkTask = findActiveRuntimeTask(state, "multiCoreBenchmark");

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
      flags: { ...state.flags, schedulerWatchdog: true, schedulerPolicies: true },
    };
    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "cpu",
      cpuId: 1,
      policy: "none",
    });
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
      flags: { ...state.flags, schedulerWatchdog: true, schedulerPolicies: true },
    };
    state = applyAction(state, {
      type: "setSchedulerPolicy",
      target: "cpu",
      cpuId: 1,
      policy: "none",
    });
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

  it("scheduler watchdog requeues one chunked work unit instead of killing the parent", () => {
    const compileCode = getTaskDefinition("compileCode");
    let state = withSystemCatalog(
      withPrimaryCpuCache(
        withRamCapacity(
          withPrimarySchedulerCapacity(unlockSystemScheduler(), 4),
          compileCode.ramNeedBits * 2,
        ),
        compileCode.cacheNeedBits * 4,
      ),
    );
    state = {
      ...state,
      flags: { ...state.flags, schedulerWatchdog: true },
      hardware: {
        ...state.hardware,
        systemSchedulerConfig: createSchedulerConfig({
          autoKillEnabled: true,
          killPolicy: "deadlockedTask",
        }),
      },
    };
    state = applyAction(state, { type: "startTask", taskId: "compileCode" });
    const activeCompile = getActiveRuntimeTasks(state, "compileCode")[0];
    const activeCompileEntry = getLocalQueueEntries(state).find(
      (entry) => (entry.reservationId ?? entry.id) === activeCompile?.queueEntryId,
    );
    expect(activeCompile).toBeDefined();

    state = withRamCapacity(state, compileCode.ramNeedBits);
    const blockedOperations = activeCompile!.coreOperations.map((operation, index) =>
      index === 0
        ? {
            ...operation,
            status: "deadlocked" as const,
            memoryState: "deadlock" as const,
            lockResource: "ram" as const,
            lockReason: "Deadlock: RAM full.",
            deadlockSeconds: 3.1,
            remainingLoadCycles: Math.max(1, operation.remainingLoadCycles),
            totalLoadCycles: Math.max(1, operation.totalLoadCycles),
            memoryReservedBits: 0,
            memoryReservedBytes: 0,
            ramBlocks: [],
          }
        : {
            ...operation,
            status: "loadingRam" as const,
            memoryState: "ramLoad" as const,
            memoryReservedBits: compileCode.ramNeedBits,
            memoryReservedBytes: Math.ceil(compileCode.ramNeedBits / 8),
            ramBlocks: [
              {
                stickId: state.hardware.ramSticks[0]?.id ?? 1,
                startBit: 0,
                lengthBits: compileCode.ramNeedBits,
                loadedBits: 0,
                channelIndex: 0,
              },
            ],
          },
    );
    const blockedTask = {
      ...activeCompile!,
      coreOperations: blockedOperations,
    };
    const activeTasks = state.activeTasks.map((task) =>
      task.instanceId === blockedTask.instanceId ? blockedTask : task,
    );
    state = {
      ...state,
      activeTasks,
      activeJobs: activeTasks,
    };

    state = tickGame(state, 0);

    const requeuedCompile = getActiveRuntimeTasks(state, "compileCode").find(
      (task) => task.instanceId !== blockedTask.instanceId,
    );
    const requeuedEntry = getLocalQueueEntries(state).find(
      (entry) =>
        entry.parentTaskId === "compileCode" &&
        entry.workUnitIndex === activeCompileEntry?.workUnitIndex,
    );
    expect(requeuedCompile).toBeDefined();
    expect(requeuedCompile?.parentTaskId).toBe("compileCode");
    expect(requeuedEntry).toBeDefined();
    expect(
      requeuedCompile?.coreOperations.some(
        (operation) => operation.deadlockSeconds >= 3,
      ),
    ).toBe(false);
    expect(state.queue).toEqual(["compileCode"]);
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

  it("uses CPU scheduler policy for reserved chunked system work", () => {
    let state = withSystemCatalog(
      withPrimaryCpuSchedulerPolicy(
        withPrimaryCpuCache(
          withRamCapacity(withPrimarySchedulerCapacity(unlockSystemScheduler(), 5), 4096),
          64,
        ),
        "shortestTask",
      ),
    );
    state = {
      ...state,
      hardware: {
        ...state.hardware,
        systemSchedulerConfig: createSchedulerConfig({ policy: "fifo" }),
      },
    };
    state = applyAction(state, { type: "queueTask", taskId: "compileCode" });
    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });

    state = tickGame(state, 16);

    expect(state.activeTasks[0]?.taskId).toBe("stageChecksumPage");
    expect(state.activeTasks[0]?.parentTaskId).toBe("tinyChecksum");
    expect(state.activeTasks[0]?.assignedCoreIds).toHaveLength(1);
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

  it("warns for ten seconds before auto-shutdown on an unpaid bill", () => {
    let state = createInitialGameState();
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

    state = tickSeconds(state, 1);

    expect(state.power.state).toBe("on");
    expect(state.power.unpaidShutdownWarningSeconds).toBe(
      POWER_UNPAID_SHUTDOWN_WARNING_SECONDS,
    );
    expect(deriveVisibleState(state).metrics.powerUnpaidShutdownWarningSeconds).toBe(
      POWER_UNPAID_SHUTDOWN_WARNING_SECONDS,
    );
    expect(state.power.lastFailureReason).toBeNull();
    expect(state.resources.credits).toBe(0);

    state = tickSeconds(state, POWER_UNPAID_SHUTDOWN_WARNING_SECONDS - 1);

    expect(state.power.state).toBe("on");
    expect(state.power.unpaidShutdownWarningSeconds).toBe(1);

    state = tickSeconds(state, 1);

    expect(state.power.state).toBe("off");
    expect(state.power.transitionSeconds).toBe(0);
    expect(state.power.lastFailureReason).toBe("unpaidBill");
    expect(state.power.failureCount).toBe(1);
    expect(state.resources.credits).toBe(0);
    expect(state.power.unpaidShutdownWarningSeconds).toBe(0);

    state = applyAction(state, { type: "acknowledgePowerFailure" });
    expect(state.power.lastFailureReason).toBeNull();
  });

  it("clears the unpaid shutdown warning when active work earns credits", () => {
    let state: GameState = {
      ...createInitialGameState(),
      resources: { credits: 0, data: 0 },
      power: {
        ...createInitialGameState().power,
        bootstrapGraceSeconds: 0,
        unpaidShutdownWarningSeconds: POWER_UNPAID_SHUTDOWN_WARNING_SECONDS,
      },
    };

    state = applyAction(state, { type: "startTask", taskId: "fetchBit" });
    state = tickSeconds(state, 1);

    expect(state.power.state).toBe("on");
    expect(state.resources.credits).toBeGreaterThan(0);
    expect(state.power.unpaidShutdownWarningSeconds).toBe(0);
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

  it("expires bootstrap grace into an unpaid shutdown warning at 0 credits", () => {
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

    expect(state.power.state).toBe("on");
    expect(state.power.unpaidShutdownWarningSeconds).toBe(
      POWER_UNPAID_SHUTDOWN_WARNING_SECONDS,
    );
    expect(state.resources.credits).toBe(0);

    state = tickSeconds(state, POWER_UNPAID_SHUTDOWN_WARNING_SECONDS);

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
        psuWatts: 0.00000001,
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

    expect(state.activeTasks).toContainEqual(
      expect.objectContaining({
        taskId: "scanRamPage",
        parentTaskId: "memoryScrub",
      }),
    );
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
