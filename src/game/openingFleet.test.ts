import { describe, expect, it } from "vitest";
import {
  advanceGame,
  amountCompare,
  amountSubtract,
  amountToSafeNumber,
  applyAction,
  createInitialGameState,
  deriveSystemCapacityProfile,
  deriveVisibleState,
  exactResourceBag,
  getMachineSelectionBlockedReason,
  MACHINE_IDLE_PSU_LOAD_LIMIT,
  MACHINE_PEAK_PSU_LOAD_LIMIT,
  projectMachineSelection,
  tickGame,
  type GameState,
  type ResearchId,
} from "./index";
import { machineTemplates } from "./content/machines";
import { getStageLabel } from "./progression";
import { getSystemPowerOperatingCostPerSecond } from "./simulation";

const withResources = (
  state: GameState,
  credits: string | number = "1e30",
  data: string | number = "1e30",
) => ({
  ...state,
  exactResources: exactResourceBag(credits, data),
  resources: {
    credits: amountToSafeNumber(exactResourceBag(credits, data).credits),
    data: amountToSafeNumber(exactResourceBag(credits, data).data),
  },
});

const withCatalogResearch = (
  research: ResearchId[] = [],
  completedTasks: GameState["completedTasks"] = {},
) => {
  const initial = createInitialGameState();
  const completed = Array.from(
    new Set<ResearchId>([
      "systemScheduler",
      "systemCatalog",
      "cpuTierKhz",
      "cpuTierMhz",
      ...research,
    ]),
  );
  return withResources({
    ...initial,
    flags: {
      ...initial.flags,
      basicQueue: true,
      scheduler: true,
      systemCatalog: true,
      customMachineAssembly: completed.includes("customMachineAssembly"),
      systemStats: true,
    },
    research: { ...initial.research, completed },
    completedTasks,
  });
};

const runToCompletion = (
  state: GameState,
  taskId: "compileCode" | "renderFrame" | "regressionTest",
  mode: "foreground" | "offline" = "foreground",
) => {
  const projectedDurationMs =
    deriveVisibleState(state).tasks.find((task) => task.id === taskId)
      ?.projection.durationMs ?? 60_000;
  const started = applyAction(state, { type: "startTask", taskId });
  expect(started.activeTasks.length).toBeGreaterThan(0);
  return advanceGame(
    started,
    Math.max(60_000, Math.ceil(projectedDurationMs * 4 + 1_000)),
    mode,
  ).state;
};

describe("opening and Fleet invariants", () => {
  it("uses one-based stage labels and reserves Rack for real infrastructure", () => {
    expect([
      getStageLabel("primitiveCpu"),
      getStageLabel("singleCpu"),
      getStageLabel("multiCore"),
      getStageLabel("scheduler"),
      getStageLabel("systemReveal"),
      getStageLabel("fleet"),
    ]).toEqual([
      "Stage 1 - Primitive CPU",
      "Stage 2 - Single CPU",
      "Stage 3 - Multi-Core CPU",
      "Stage 4 - Scheduler",
      "Stage 5 - System Reveal",
      "Stage 6 - Fleet",
    ]);

    const state = withCatalogResearch();
    const visible = deriveVisibleState(state);
    expect(visible.stage).toBe("fleet");
    expect(visible.stageLabel).toBe("Stage 6 - Fleet");
    expect(visible.milestone).not.toMatch(/rack/i);
  });

  it("keeps every preset below the idle and representative-peak PSU limits", () => {
    const expectedPsuLevels = [1, 14, 23, 37, 51];
    const unlocked = withCatalogResearch(
      ["customMachineAssembly", "cpuTierGhz"],
      { compileCode: 1, renderFrame: 1 },
    );
    const visible = deriveVisibleState(unlocked);

    expect(visible.machineBuilder.templates.map((template) => template.id)).toEqual(
      machineTemplates.map((template) => template.id),
    );

    machineTemplates.forEach((template, index) => {
      const projection = projectMachineSelection(template.components);
      expect(projection.idlePsuLoad).toBeLessThan(MACHINE_IDLE_PSU_LOAD_LIMIT);
      expect(projection.peakPsuLoad).toBeLessThan(MACHINE_PEAK_PSU_LOAD_LIMIT);
      expect(projection.safe).toBe(true);
      expect(getMachineSelectionBlockedReason(unlocked, template.components)).toBeNull();

      let purchased = applyAction(unlocked, {
        type: "buyMachineTemplate",
        templateId: template.id,
      });
      expect(purchased.systems).toHaveLength(2);
      expect(purchased.hardware.psuLevel).toBe(expectedPsuLevels[index]);
      const profile = deriveSystemCapacityProfile(
        purchased,
        purchased.selectedSystemId,
      );
      expect(amountToSafeNumber(profile.idleWatts)).toBeCloseTo(
        projection.idleWatts,
        12,
      );
      expect(amountToSafeNumber(profile.peakWatts)).toBeCloseTo(
        projection.peakWatts,
        12,
      );

      for (const taskId of template.intendedTasks) {
        const task = deriveVisibleState(purchased).tasks.find(
          (candidate) => candidate.id === taskId,
        );
        expect(task?.canStart, `${template.id}:${taskId}`).toBe(true);
        const started = applyAction(purchased, { type: "startTask", taskId });
        expect(started.activeTasks.length, `${template.id}:${taskId}`).toBeGreaterThan(0);
      }
    });
  });

  it("filters and rejects templates and components before their research", () => {
    const initial = createInitialGameState();
    const catalogOnly = withResources({
      ...initial,
      flags: { ...initial.flags, systemCatalog: true },
      research: { ...initial.research, completed: ["systemCatalog"] },
    });
    const visible = deriveVisibleState(catalogOnly);

    expect(visible.machineBuilder.templates.map((template) => template.id)).toEqual([
      "barebonesPc",
    ]);
    expect(visible.machineBuilder.advancedUnlocked).toBe(false);
    expect(visible.machineBuilder.components.cpu).toEqual([]);

    const rejectedTemplate = applyAction(catalogOnly, {
      type: "buyMachineTemplate",
      templateId: "renderBrick",
    });
    expect(rejectedTemplate.systems).toHaveLength(1);

    const rejectedCustom = applyAction(catalogOnly, {
      type: "buyCustomMachine",
      components: machineTemplates[0]!.components,
    });
    expect(rejectedCustom.systems).toHaveLength(1);

    const advanced = withCatalogResearch(["customMachineAssembly"]);
    const acceptedCustom = applyAction(advanced, {
      type: "buyCustomMachine",
      components: machineTemplates[0]!.components,
    });
    expect(acceptedCustom.systems).toHaveLength(2);
  });

  it("surfaces active jobs from non-selected Fleet systems in whole-game Work", () => {
    const unlocked = withCatalogResearch();
    let state = applyAction(unlocked, {
      type: "buyMachineTemplate",
      templateId: "barebonesPc",
    });
    expect(state.selectedSystemId).not.toBe(1);
    state = applyAction(state, {
      type: "startTask",
      taskId: "fetchBit",
      systemId: 1,
    });

    const visible = deriveVisibleState(state);
    expect(
      visible.activeWork.some(
        (work) => work.kind === "job" && work.systemId === 1,
      ),
    ).toBe(true);
    expect(visible.departureForecast.powerPolicies.map((system) => system.systemId)).toEqual(
      expect.arrayContaining([1, state.selectedSystemId]),
    );
  });

  it("forecasts productive-only offline power instead of billing idle Fleet systems", () => {
    let state = applyAction(withCatalogResearch(["psuManagement"]), {
      type: "buyMachineTemplate",
      templateId: "barebonesPc",
    });
    state = withResources(
      {
        ...state,
        automationBuffer: {
          ...state.automationBuffer,
          ownedLevelId: "localScheduler",
          // Deliberately stale: the forecast must snapshot the owned level as
          // the departure policy before evaluating productive offline work.
          departureLevelId: "startingNode",
        },
      },
      20_000,
      state.exactResources.data,
    );
    state = applyAction(state, {
      type: "startTask",
      taskId: "fetchBit",
      systemId: 1,
    });

    const planningState: GameState = {
      ...state,
      automationBuffer: {
        ...state.automationBuffer,
        departureLevelId: state.automationBuffer.ownedLevelId,
      },
    };
    const offlineRate = getSystemPowerOperatingCostPerSecond(
      planningState,
      "offline",
    );
    const foregroundRate = getSystemPowerOperatingCostPerSecond(
      planningState,
      "foreground",
    );
    const forecast = deriveVisibleState(state).departureForecast;

    expect(amountCompare(foregroundRate, offlineRate)).toBeGreaterThan(0);
    expect(forecast.aggregateOperatingCostPerSecond).toBe(offlineRate);
    expect(forecast.creditRunwayMs).toBe(forecast.coverageMs);
    expect(forecast.projectedPauseReason).not.toBe(
      "Credit runway ends before the Automation Buffer.",
    );
  });

  it("exposes duration, exact energy, net reward, fit, buffer, and runway before a job starts", () => {
    const initial = createInitialGameState();
    const state = withResources({
      ...initial,
      flags: { ...initial.flags, psuManagement: true },
      research: { ...initial.research, completed: ["psuManagement"] },
      automationBuffer: {
        ...initial.automationBuffer,
        ownedLevelId: "localScheduler",
        departureLevelId: "localScheduler",
      },
    });
    const task = deriveVisibleState(state).tasks.find(
      (candidate) => candidate.id === "fetchBit",
    )!;

    expect(task.projection.durationMs).toBeGreaterThan(0);
    expect(amountCompare(task.projection.energyCostCredits, 0)).toBeGreaterThan(0);
    expect(task.projection.netRewardCredits).toBe(
      amountSubtract(task.rewardCredits, task.projection.energyCostCredits),
    );
    expect(task.projection).toMatchObject({
      creditRunwayCovered: true,
      bufferCovered: true,
      cacheFits: true,
      ramFits: true,
      pauseReason: null,
    });
  });

  it("reaches Compile, Render, and Regression once each without the legacy builder gate", () => {
    let state = withCatalogResearch();
    state = applyAction(state, {
      type: "buyMachineTemplate",
      templateId: "compileBox",
    });
    expect(state.systems).toHaveLength(2);
    expect(state.research.completed).not.toContain("customMachineAssembly");

    state = runToCompletion(state, "compileCode");
    expect(state.completedTasks.compileCode).toBe(1);
    state = runToCompletion(state, "renderFrame");
    expect(state.completedTasks.renderFrame).toBe(1);
    expect(
      deriveVisibleState(state).tasks.find((task) => task.id === "regressionTest")
        ?.canStart,
    ).toBe(true);

    state = {
      ...state,
      automationBuffer: {
        ...state.automationBuffer,
        ownedLevelId: "systemScheduler",
        departureLevelId: "systemScheduler",
      },
    };
    state = runToCompletion(state, "regressionTest", "offline");
    expect(state.completedTasks.regressionTest).toBe(1);
    expect(state.power.lastFailureReason).toBeNull();
  });

  it("meters power billing and trips an overloaded PSU before management", () => {
    const initial = createInitialGameState();
    const beforeCredits = initial.exactResources.credits;
    // 0.1 uW starter draw = 0.1 cr/s at 1 credit/sec per uW.
    expect(deriveVisibleState(initial).metrics.powerCostPerSecond).toBe(0.1);
    const billedBriefly = tickGame(initial, 10_000);
    expect(
      amountCompare(billedBriefly.exactResources.credits, beforeCredits),
    ).toBeLessThan(0);

    // Empty-wallet shutdown is physical and does not require research.
    const warned = tickGame(withResources(initial, 0, 0), 1);
    expect(warned.power.unpaidShutdownWarningSeconds).toBe(10);
    const broke = tickGame(warned, 10_000);
    expect(amountCompare(broke.exactResources.credits, 0)).toBe(0);
    expect(broke.power.state).toBe("off");
    expect(broke.power.lastFailureReason).toBe("unpaidBill");
    expect(broke.power.unpaidShutdownWarningSeconds).toBe(0);

    const blockedInput = {
      ...initial,
      hardware: { ...initial.hardware, psuWatts: 0.00000001 },
    };
    const startedOverloaded = applyAction(blockedInput, {
      type: "startTask",
      taskId: "fetchBit",
    });
    expect(startedOverloaded.activeTasks).toHaveLength(1);
    expect(
      deriveVisibleState(blockedInput).tasks.find((task) => task.id === "fetchBit")
        ?.blockedReason,
    ).toBeNull();
    expect(
      deriveVisibleState(blockedInput).metrics.powerOverloadFailure,
    ).toMatchObject({ active: true, seconds: 0 });
    expect(
      deriveVisibleState(blockedInput).metrics.powerOverloadFailure.rate,
    ).toBeGreaterThan(0);
    const trippedAtStart = tickGame(startedOverloaded, 2_000);
    expect(trippedAtStart.activeTasks).toHaveLength(0);
    expect(trippedAtStart.power.state).toBe("off");
    expect(trippedAtStart.power.lastFailureReason).toBe("psuOverload");

    let unsafe = applyAction(initial, { type: "startTask", taskId: "fetchBit" });
    expect(unsafe.activeTasks).toHaveLength(1);
    unsafe = {
      ...unsafe,
      hardware: { ...unsafe.hardware, psuWatts: 0.00000001 },
    };
    const tripped = tickGame(unsafe, 20_000);
    expect(tripped.activeTasks).toHaveLength(0);
    expect(tripped.power.state).toBe("off");
    expect(tripped.power.overloadFailureSeconds).toBe(0);
    expect(tripped.power.lastFailureReason).toBe("psuOverload");
  });

  it("keeps unpaid cutoff and overload failure independent of PSU Management", () => {
    const initial = createInitialGameState();
    const managed = withResources({
      ...initial,
      flags: { ...initial.flags, psuManagement: true },
      research: { ...initial.research, completed: ["psuManagement"] },
    });
    expect(deriveVisibleState(managed).metrics.powerCostPerSecond).toBeGreaterThan(0);

    // Both physical failure paths apply without research.
    const unmanagedOverload = tickGame(
      {
        ...initial,
        hardware: { ...initial.hardware, psuWatts: 0.00000001 },
      },
      2_000,
    );
    expect(unmanagedOverload.power.state).toBe("off");
    expect(unmanagedOverload.power.lastFailureReason).toBe("psuOverload");
    const unmanagedWarning = tickGame(withResources(initial, 0, 0), 1_000);
    expect(unmanagedWarning.power.unpaidShutdownWarningSeconds).toBe(10);
    const unmanagedBroke = tickGame(unmanagedWarning, 10_000);
    expect(unmanagedBroke.power.unpaidShutdownWarningSeconds).toBe(0);
    expect(unmanagedBroke.power.state).toBe("off");
    expect(unmanagedBroke.power.lastFailureReason).toBe("unpaidBill");

    const overloaded = tickGame(
      {
        ...managed,
        hardware: { ...managed.hardware, psuWatts: 0.00000001 },
      },
      2_000,
    );
    expect(overloaded.power.state).toBe("off");
    expect(overloaded.power.lastFailureReason).toBe("psuOverload");

    const unfunded = withResources(managed, 0, 0);
    const warning = tickGame(unfunded, 1_000);
    expect(warning.power.unpaidShutdownWarningSeconds).toBe(10);
    const shutDown = tickGame(warning, 10_000);
    expect(shutDown.power.state).toBe("off");
    expect(shutDown.power.lastFailureReason).toBe("unpaidBill");
  });

  it("offers PSU Management only after Power Telemetry", () => {
    const before = withCatalogResearch();
    expect(
      deriveVisibleState(before).research.some((item) => item.id === "psuManagement"),
    ).toBe(false);

    const after = withCatalogResearch([], { powerTelemetry: 1 });
    const psuManagement = deriveVisibleState(after).research.find(
      (item) => item.id === "psuManagement",
    );
    expect(psuManagement?.canBuy).toBe(true);
    expect(psuManagement?.costs).toEqual([
      { resource: "credits", amount: 300 },
      { resource: "data", amount: 2 },
    ]);
  });
});
