import { describe, expect, it } from "vitest";
import {
  advanceGame,
  amount,
  amountAbs,
  amountCompare,
  amountSubtract,
  amountToSafeNumber,
  applyAction,
  createInitialGameState,
  deserializeSave,
  deriveVisibleState,
  exactResourceBag,
  getAcceleratorInstallBlockedReason,
  serializeSave,
  type GameState,
  type ResearchId,
} from "./index";
import {
  createHardwareFromMachineSelection,
} from "./machines";
import { machineTemplates, componentSkus } from "./content/machines";
import { getResearchDefinition } from "./content/research";
import { getTaskDefinition } from "./content/tasks";
import { getTaskBatchProjection } from "./taskBatches";
import {
  getHardwareDrawWattsExact,
} from "./math";
import { getThermalStatusThroughputModifierBps } from "./workshop";
import {
  createSystemState,
  updateProgressionFlags,
} from "./progression";
import { syncSelectedSystemRuntime } from "./systems";
import { getSystemPowerOperatingCostPerSecond } from "./simulation";

const richResources = exactResourceBag("1e40", "1e20");

const withRichResources = (state: GameState): GameState => ({
  ...state,
  exactResources: richResources,
  resources: {
    credits: amountToSafeNumber(richResources.credits),
    data: amountToSafeNumber(richResources.data),
  },
});

const workshopResearch: ResearchId[] = [
  "systemScheduler",
  "systemCatalog",
  "customMachineAssembly",
  "psuManagement",
  "thermalControl",
  "specializedCompute",
  "cpuTierKhz",
  "cpuTierMhz",
  "cpuTierGhz",
];

const createWorkshopReadyState = (installDevices = true) => {
  const initial = createInitialGameState();
  let state = updateProgressionFlags(withRichResources({
    ...initial,
    flags: {
      ...initial.flags,
      basicQueue: true,
      scheduler: true,
      systemStats: true,
      systemCatalog: true,
      customMachineAssembly: true,
      psuManagement: true,
      cooling: true,
      specializedCompute: true,
    },
    research: {
      ...initial.research,
      completed: workshopResearch,
    },
    completedTasks: { compileCode: 1 },
    completedJobs: { compileCode: 1 },
  }));
  state = syncSelectedSystemRuntime(state);
  state = applyAction(state, {
    type: "buyMachineTemplate",
    templateId: "workstationTower",
  });
  state = applyAction(state, {
    type: "installCoolingTier",
    tierId: "liquidCooling",
  });
  if (!installDevices) return state;
  state = applyAction(state, {
    type: "installAccelerator",
    skuId: "gpuRaster8",
    slotId: 1,
  });
  state = applyAction(state, {
    type: "installAccelerator",
    skuId: "npuEdge4",
    slotId: 3,
  });
  return state;
};

const getProjectedCompletionBudgetMs = (
  state: GameState,
  taskId: "renderFrame" | "inferenceBatch" | "workstationBenchmark",
) => {
  const projection = getTaskBatchProjection(state, getTaskDefinition(taskId));
  const criticalThermalSlowdown =
    10_000 / getThermalStatusThroughputModifierBps("critical");
  return Math.max(
    60_000,
    Math.ceil(projection.durationMs * criticalThermalSlowdown + 60_000),
  );
};

const runTask = (state: GameState, taskId: "renderFrame" | "inferenceBatch" | "workstationBenchmark") => {
  const started = applyAction(state, { type: "startTask", taskId });
  expect(
    started.activeTasks.length + started.queue.length,
    `Expected ${taskId} to start or queue`,
  ).toBeGreaterThan(0);
  const completionBudgetMs = getProjectedCompletionBudgetMs(started, taskId);
  return advanceGame(started, completionBudgetMs, "foreground").state;
};

const completeSpecializationProof = (input = createWorkshopReadyState()) => {
  let state = runTask(input, "renderFrame");
  expect(state.completedTasks.renderFrame).toBe(1);
  expect(state.workshop.evidence.gpuRenderCompletions).toBe(1);
  state = runTask(state, "inferenceBatch");
  expect(state.completedTasks.inferenceBatch).toBe(1);
  expect(state.workshop.evidence.npuInferenceCompletions).toBe(1);
  return state;
};

describe("Workshop saved vertical slice", () => {
  it("keeps the released opening costs and exposes accelerator metadata", () => {
    expect(getResearchDefinition("systemCatalog").cost(createInitialGameState())).toEqual([
      { resource: "credits", amount: "680" },
      { resource: "data", amount: "18" },
    ]);
    expect(componentSkus.find((sku) => sku.id === "scheduler-2-slot")?.cost).toEqual([
      { resource: "credits", amount: "800" },
    ]);

    const render = getTaskDefinition("shadeTiles").operations[0];
    const inference = getTaskDefinition("runInferenceBatch").operations[0];
    expect(render).toMatchObject({
      acceleratorClass: "render",
      acceleratorPreferredKind: "gpu",
    });
    expect(inference).toMatchObject({
      acceleratorClass: "inference",
      acceleratorPreferredKind: "npu",
      acceleratorBatchSize: 16,
    });
  });

  it("keeps entry accelerators available while Open Foundry gates advanced modules", () => {
    const ready = createWorkshopReadyState(false);
    expect(getAcceleratorInstallBlockedReason(ready, "gpuRaster8", 1)).toBeNull();
    expect(getAcceleratorInstallBlockedReason(ready, "gpuTensor24", 1)).toBe(
      "Complete Open Foundry to unlock advanced accelerator modules.",
    );
    expect(
      applyAction(ready, {
        type: "installAccelerator",
        skuId: "gpuTensor24",
        slotId: 1,
      }).workshop.accelerators,
    ).toEqual([]);

    const unlocked: GameState = {
      ...ready,
      projects: {
        ...ready.projects,
        completedProjectIds: ["openFoundry"],
      },
    };
    const installed = applyAction(unlocked, {
      type: "installAccelerator",
      skuId: "gpuTensor24",
      slotId: 1,
    });
    expect(installed.workshop.accelerators[0]?.skuId).toBe("gpuTensor24");
    expect(
      deserializeSave(serializeSave(installed)).workshop.accelerators[0]?.skuId,
    ).toBe("gpuTensor24");
  });

  it("observes real heat before Thermal Control can be researched", () => {
    const initial = createInitialGameState();
    const blocked = withRichResources({
      ...initial,
      flags: {
        ...initial.flags,
        basicQueue: true,
        scheduler: true,
        systemCatalog: true,
      },
      research: {
        ...initial.research,
        completed: ["systemScheduler", "systemCatalog"],
      },
      completedTasks: { compileCode: 1, thermalProbe: 1 },
      completedJobs: { compileCode: 1, thermalProbe: 1 },
    });
    expect(
      applyAction(blocked, {
        type: "buyResearch",
        researchId: "thermalControl",
      }).research.completed,
    ).not.toContain("thermalControl");

    let state = withRichResources({
      ...blocked,
      research: {
        ...blocked.research,
        completed: ["systemScheduler", "systemCatalog", "cpuTierMhz"],
      },
      completedTasks: { compileCode: 1 },
      completedJobs: { compileCode: 1 },
    });
    state = syncSelectedSystemRuntime(state);
    state = applyAction(state, {
      type: "buyMachineTemplate",
      templateId: "compileBox",
    });
    state = applyAction(state, { type: "startTask", taskId: "thermalProbe" });
    state = advanceGame(state, 60_000, "foreground").state;
    expect(state.completedTasks.thermalProbe).toBe(1);
    expect(["warm", "hot", "critical"]).toContain(
      state.workshop.highestObservedThermalStatus,
    );
    state = applyAction(state, {
      type: "buyResearch",
      researchId: "thermalControl",
    });
    expect(state.research.completed).toContain("thermalControl");
    expect(state.flags.cooling).toBe(true);
  });

  it("routes deterministically with CPU fallback and records only device-backed proof", () => {
    let state = completeSpecializationProof();
    expect(deriveVisibleState(state).workshop.specializationComplete).toBe(true);
    expect(
      deriveVisibleState(state).tasks.find(
        (task) => task.id === "workstationBenchmark",
      )?.canStart,
    ).toBe(true);
    state = runTask(state, "workstationBenchmark");
    expect(state.completedTasks.workstationBenchmark).toBe(1);
  });

  it("keeps accelerator slots, thermal state, and evidence isolated by system", () => {
    let state = createWorkshopReadyState();
    const workshopSystemId = state.selectedSystemId;
    expect(state.workshop.accelerators).toHaveLength(2);
    state = applyAction(state, { type: "selectSystem", systemId: 1 });
    expect(state.workshop.accelerators).toEqual([]);
    state = applyAction(state, {
      type: "selectSystem",
      systemId: workshopSystemId,
    });
    expect(state.workshop.accelerators.map((device) => device.slotId)).toEqual([
      1,
      3,
    ]);

    const restored = deserializeSave(serializeSave(state, 1234));
    expect(restored.selectedSystemId).toBe(workshopSystemId);
    expect(restored.workshop).toEqual(state.workshop);
    expect(
      restored.systems.find((system) => system.id === 1)?.workshop.accelerators,
    ).toEqual([]);
  });

  it("normalizes corrupt Workshop fields and preserves exact values beyond 1e309", () => {
    const huge = amount("1e400");
    let state = createWorkshopReadyState();
    state = {
      ...state,
      exactResources: exactResourceBag(huge, huge),
      workshop: {
        ...state.workshop,
        thermal: {
          elapsedMs: huge,
          sustainedHeatWatts: huge,
        },
      },
    };
    const exactRoundTrip = deserializeSave(serializeSave(state, 9000));
    expect(exactRoundTrip.exactResources.credits).toBe(huge);
    expect(exactRoundTrip.workshop.thermal.sustainedHeatWatts).toBe(huge);

    const envelope = JSON.parse(serializeSave(state, 9001)) as {
      state: GameState;
    };
    const corrupt = {
      ...envelope.state.workshop,
      coolingTierId: "warpCooling",
      overclockPresetId: "unsafe",
      expansionSlots: 2,
      nextAcceleratorId: -99,
      thermal: { elapsedMs: "broken", sustainedHeatWatts: "-5" },
      accelerators: [
        { id: "duplicate", slotId: 1, skuId: "gpuRaster8" },
        { id: "duplicate", slotId: 1, skuId: "npuEdge4" },
        { id: "outside", slotId: 9, skuId: "npuEdge4" },
        { id: "unknown", slotId: 2, skuId: "quantum" },
      ],
      evidence: {
        gpuRenderCompletions: -10,
        npuInferenceCompletions: Number.NaN,
      },
    };
    (envelope.state as unknown as { workshop: unknown }).workshop = corrupt;
    const selected = envelope.state.systems.find(
      (system) => system.id === envelope.state.selectedSystemId,
    );
    if (selected) (selected as unknown as { workshop: unknown }).workshop = corrupt;
    const normalized = deserializeSave(JSON.stringify(envelope));
    expect(normalized.workshop.coolingTierId).toBe("liquidCooling");
    expect(normalized.workshop.overclockPresetId).toBe("stock");
    expect(normalized.workshop.expansionSlots).toBe(2);
    expect(normalized.workshop.accelerators).toEqual([
      { id: "duplicate", slotId: 1, skuId: "gpuRaster8" },
    ]);
    expect(normalized.workshop.thermal).toEqual({
      elapsedMs: "0",
      sustainedHeatWatts: "0",
    });
    expect(normalized.workshop.evidence).toEqual({
      gpuRenderCompletions: 0,
      npuInferenceCompletions: 0,
    });
    expect(normalized.workshop.nextAcceleratorId).toBe(1);
  });

  it("is delta-invariant across thermal and accelerator event boundaries", () => {
    const started = applyAction(createWorkshopReadyState(), {
      type: "startTask",
      taskId: "renderFrame",
    });
    const oneShot = advanceGame(started, 10_000, "foreground").state;
    let chunked = started;
    for (let index = 0; index < 100; index += 1) {
      chunked = advanceGame(chunked, 100, "foreground").state;
    }
    expect(chunked.completedTasks).toEqual(oneShot.completedTasks);
    expect(chunked.completedBenchmarks).toEqual(oneShot.completedBenchmarks);
    expect(chunked.exactResources.data).toBe(oneShot.exactResources.data);
    expect(
      amountCompare(
        amountAbs(
          amountSubtract(
            chunked.exactResources.credits,
            oneShot.exactResources.credits,
          ),
        ),
        20,
      ),
    ).toBeLessThanOrEqual(0);
    const { thermal: oneShotThermal, ...oneShotWorkshop } = oneShot.workshop;
    const { thermal: chunkedThermal, ...chunkedWorkshop } = chunked.workshop;
    expect(chunkedWorkshop).toEqual(oneShotWorkshop);
    expect(
      amountCompare(
        amountAbs(
          amountSubtract(chunkedThermal.elapsedMs, oneShotThermal.elapsedMs),
        ),
        "0.000000001",
      ),
    ).toBeLessThanOrEqual(0);
    expect(
      amountCompare(
        amountAbs(
          amountSubtract(
            chunkedThermal.sustainedHeatWatts,
            oneShotThermal.sustainedHeatWatts,
          ),
        ),
        "0.001",
      ),
    ).toBeLessThanOrEqual(0);
    expect(chunked.activeTasks).toEqual(oneShot.activeTasks);
  });

  it("consumes cache, RAM, CPU, and composition stages within one aggregate interval", () => {
    const started = applyAction(createWorkshopReadyState(), {
      type: "startTask",
      taskId: "inferenceBatch",
    });
    const horizonMs = 10_000;
    const oneShot = advanceGame(started, horizonMs, "foreground").state;
    let chunked = started;
    for (let elapsedMs = 0; elapsedMs < horizonMs; elapsedMs += 100) {
      chunked = advanceGame(chunked, 100, "foreground").state;
    }

    expect(oneShot.completedTasks.inferenceBatch).toBe(1);
    expect(chunked.completedTasks.inferenceBatch).toBe(1);
    expect(oneShot.activeTasks).toEqual([]);
    expect(chunked.activeTasks).toEqual([]);
    expect(chunked.completedTasks).toEqual(oneShot.completedTasks);
    expect(chunked.workshop.evidence).toEqual(oneShot.workshop.evidence);
    expect(chunked.exactResources.data).toBe(oneShot.exactResources.data);
  });

  it("matches foreground and offline Workshop progress within the owned buffer", () => {
    const base = createWorkshopReadyState();
    const started = applyAction(
      {
        ...base,
        automationBuffer: {
          ...base.automationBuffer,
          ownedLevelId: "systemScheduler",
          departureLevelId: "systemScheduler",
        },
      },
      { type: "startTask", taskId: "renderFrame" },
    );
    const completionBudgetMs = getProjectedCompletionBudgetMs(
      started,
      "renderFrame",
    );
    const foregroundResult = advanceGame(
      started,
      completionBudgetMs,
      "foreground",
    );
    const offlineResult = advanceGame(started, completionBudgetMs, "offline");
    const foreground = foregroundResult.state;
    const offline = offlineResult.state;
    expect(offline.completedTasks).toEqual(foreground.completedTasks);
    expect(offline.workshop.evidence).toEqual(foreground.workshop.evidence);
    expect(offline.workshop.accelerators).toEqual(
      foreground.workshop.accelerators,
    );
    expect(
      amountCompare(
        offline.exactResources.credits,
        foreground.exactResources.credits,
      ),
    ).toBeGreaterThanOrEqual(0);
    expect(offlineResult.intervalReport.completedWork.renderFrame).toBe(1);
  });

  it("bills exact cooling and idle accelerator power and reverses device draw on removal", () => {
    let state = createWorkshopReadyState(false);
    const cooledDraw = getHardwareDrawWattsExact(state);
    state = applyAction(state, {
      type: "installAccelerator",
      skuId: "gpuRaster8",
      slotId: 1,
    });
    const gpuDraw = getHardwareDrawWattsExact(state);
    expect(amountCompare(gpuDraw, cooledDraw)).toBeGreaterThan(0);
    const deviceId = state.workshop.accelerators[0]!.id;
    const costPerSecond = getSystemPowerOperatingCostPerSecond(state);
    const creditsBefore = state.exactResources.credits;
    const billed = advanceGame(state, 1_000, "foreground").state;
    expect(amountSubtract(creditsBefore, billed.exactResources.credits)).toBe(
      costPerSecond,
    );
    const removed = applyAction(billed, {
      type: "removeAccelerator",
      deviceId,
    });
    expect(amountCompare(getHardwareDrawWattsExact(removed), gpuDraw)).toBeLessThan(0);
  });

  it("initializes every catalog template with strict saved Workshop state", () => {
    for (const [index, template] of machineTemplates.entries()) {
      const hardware = createHardwareFromMachineSelection(template.components);
      const system = createSystemState(index + 1, template.name, template.id, hardware);
      expect(system.workshop).toMatchObject({
        coolingTierId: "none",
        overclockPresetId: "stock",
        expansionSlots: 4,
        accelerators: [],
        nextAcceleratorId: 1,
      });
      expect(system.workshop.thermal).toEqual({
        elapsedMs: "0",
        sustainedHeatWatts: "0",
      });
    }
  });
});
