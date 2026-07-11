import { describe, expect, it } from "vitest";
import {
  amount,
  amountAdd,
  amountCompare,
  amountSubtract,
  exactResourceBag,
  sumAmounts,
} from "./amount";
import { getMachineSelectionCost } from "./content/machines";
import { getTaskDefinition } from "./content/tasks";
import { projectExactCosts, withExactResources } from "./economy";
import { halfRefundExact } from "./exactCosts";
import { V1_HARDWARE_LIMITS } from "./hardwareLimits";
import { createInitialGameState } from "./progression";
import { deserializeSave, serializeSave } from "./save";
import { applyAction, tickGame } from "./simulation";
import { getTaskBatchProjection } from "./taskBatches";
import type { Cost, GameState, MachineComponentSelection } from "./types";

const HUGE = amount("1e400");

const exactState = (state = createInitialGameState()) =>
  withExactResources(state, exactResourceBag(HUGE, HUGE));

const totalCost = (costs: readonly Cost[], resource: Cost["resource"]) =>
  sumAmounts(
    costs
      .filter((cost) => cost.resource === resource)
      .map((cost) => cost.amount),
  );

describe("legacy exact Amount authority", () => {
  it("clamps renderer cost projections without mutating exact authority", () => {
    const exactCosts: Cost[] = [
      { resource: "credits", amount: amount("1e400") },
      { resource: "data", amount: amount("123.5") },
    ];
    expect(projectExactCosts(exactCosts)).toEqual([
      { resource: "credits", amount: Number.MAX_VALUE },
      { resource: "data", amount: 123.5 },
    ]);
    expect(exactCosts[0]?.amount).toBe(amount("1e400"));
  });

  it("prices, buys, saves, and refunds a maximum 8x64-core build exactly", () => {
    const packageCount = V1_HARDWARE_LIMITS.cpuPackages;
    const coresPerPackage = V1_HARDWARE_LIMITS.coresPerCpu;
    const selection: MachineComponentSelection = {
      cpu: "cpu-workstation-16",
      cpuPackageCount: packageCount,
      cpuPackageConfigs: Array.from({ length: packageCount }, () => ({
        coreCount: coresPerPackage,
        cpuLevel: 28,
        cacheLevel: 18,
        cacheSpeedLevel: 28,
        schedulerSlots: coresPerPackage,
      })),
      ram: "ram-none",
      scheduler: "scheduler-none",
      psu: "psu-server",
      psuLevel: V1_HARDWARE_LIMITS.psuLevel,
    };
    const costs = getMachineSelectionCost(selection);
    const creditCost = totalCost(costs, "credits");
    const dataCost = totalCost(costs, "data");
    expect(amountCompare(creditCost, Number.MAX_SAFE_INTEGER)).toBeGreaterThan(0);

    const initial = createInitialGameState();
    const before = exactState({
      ...initial,
      flags: { ...initial.flags, systemCatalog: true, customMachineAssembly: true },
      research: {
        ...initial.research,
        completed: [
          "systemCatalog",
          "customMachineAssembly",
          "cpuTierKhz",
          "cpuTierMhz",
          "cpuTierGhz",
        ],
      },
    });
    const purchased = applyAction(before, {
      type: "buyCustomMachine",
      components: selection,
    });
    const boughtSystem = purchased.systems.find((system) => system.id === 2);

    expect(boughtSystem?.hardware.cores).toBe(packageCount * coresPerPackage);
    expect(boughtSystem?.purchaseCosts).toEqual(costs);
    expect(purchased.exactResources.credits).toBe(
      amountSubtract(before.exactResources.credits, creditCost),
    );
    expect(purchased.exactResources.data).toBe(
      amountSubtract(before.exactResources.data, dataCost),
    );

    const restored = deserializeSave(serializeSave(purchased, 42));
    expect(restored.systems.find((system) => system.id === 2)?.purchaseCosts).toEqual(
      costs,
    );

    const refunds = halfRefundExact(costs);
    const sold = applyAction(restored, { type: "sellSystem", systemId: 2 });
    expect(sold.exactResources.credits).toBe(
      amountAdd(
        restored.exactResources.credits,
        totalCost(refunds, "credits"),
      ),
    );
    expect(sold.exactResources.data).toBe(
      amountAdd(restored.exactResources.data, totalCost(refunds, "data")),
    );
  }, 30_000);

  it("round-trips huge task batch reward/work and active progress strings", () => {
    const baseTask = getTaskDefinition("compileCode");
    const hugeTask = {
      ...baseTask,
      rewardCreditsExact: amount("1e309"),
      requiredCyclesExact: amount("9e309"),
      operationCountExact: amount("7e309"),
      aggregateBatch: {
        workUnitMultiplier: Number.MAX_SAFE_INTEGER,
        maximumMultiplier: 64,
      },
    };
    const projection = getTaskBatchProjection(createInitialGameState(), hugeTask);
    expect(projection.rewardCredits).toBe(amount("64e309"));
    expect(projection.workCycles).toBe(amount("576e309"));

    let state = applyAction(exactState(), { type: "startTask", taskId: "fetchBit" });
    const active = state.activeTasks[0]!;
    const hugeRemaining = amount("1234567890123456789012345678901234567890");
    const hugeTotal = amount("9876543210987654321098765432109876543210");
    const activeTasks = [
      {
        ...active,
        projectedRewardCredits: projection.rewardCredits,
        projectedWorkCycles: projection.workCycles,
        remainingCycles: hugeRemaining,
        totalCycles: hugeTotal,
        coreOperations: active.coreOperations.map((operation) => ({
          ...operation,
          status: "running" as const,
          remainingCycles: hugeRemaining,
          totalCycles: hugeTotal,
          remainingLoadCycles: amount(0),
          totalLoadCycles: amount(0),
        })),
      },
    ];
    state = { ...state, activeTasks, activeJobs: activeTasks };

    const restored = deserializeSave(serializeSave(state, 84));
    expect(restored.activeTasks[0]).toEqual(
      expect.objectContaining({
        projectedRewardCredits: projection.rewardCredits,
        projectedWorkCycles: projection.workCycles,
        remainingCycles: hugeRemaining,
        totalCycles: hugeTotal,
      }),
    );
    expect(restored.activeTasks[0]?.coreOperations[0]).toEqual(
      expect.objectContaining({
        remainingCycles: hugeRemaining,
        totalCycles: hugeTotal,
      }),
    );
  });

  it("conserves a first-completion Data reward beside a huge balance", () => {
    const initial = createInitialGameState();
    let state = exactState({
      ...initial,
      research: { ...initial.research, completed: ["decodeLogic"] },
    });
    const beforeData = state.exactResources.data;
    state = applyAction(state, { type: "startTask", taskId: "bitFlip" });
    for (let guard = 0; state.activeTasks.length > 0 && guard < 100; guard += 1) {
      state = tickGame(state, 1_000);
    }

    expect(state.activeTasks).toHaveLength(0);
    expect(state.exactResources.data).toBe(amountAdd(beforeData, "5"));

    const afterFirst = state.exactResources.data;
    state = applyAction(state, { type: "startTask", taskId: "bitFlip" });
    for (let guard = 0; state.activeTasks.length > 0 && guard < 100; guard += 1) {
      state = tickGame(state, 1_000);
    }
    expect(state.exactResources.data).toBe(afterFirst);
  });

  it("keeps exact active work identical for split and one-shot ticks", () => {
    const seed = applyAction(exactState(), { type: "startTask", taskId: "fetchBit" });
    const hugeRemaining = amount("1e309");
    const activeTasks = seed.activeTasks.map((task) => ({
      ...task,
      remainingCycles: hugeRemaining,
      totalCycles: hugeRemaining,
      projectedWorkCycles: hugeRemaining,
      coreOperations: task.coreOperations.map((operation) => ({
        ...operation,
        status: "running" as const,
        remainingCycles: hugeRemaining,
        totalCycles: hugeRemaining,
        remainingLoadCycles: amount(0),
        totalLoadCycles: amount(0),
      })),
    }));
    const prepared: GameState = { ...seed, activeTasks, activeJobs: activeTasks };
    const oneShot = tickGame(prepared, 1_000);
    const split = tickGame(tickGame(prepared, 400), 600);

    expect(split.activeTasks[0]?.remainingCycles).toBe(
      oneShot.activeTasks[0]?.remainingCycles,
    );
    expect(split.activeTasks[0]?.coreOperations[0]?.remainingCycles).toBe(
      oneShot.activeTasks[0]?.coreOperations[0]?.remainingCycles,
    );
  });
});
