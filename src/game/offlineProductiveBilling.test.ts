import { describe, expect, it } from "vitest";
import {
  advanceGame,
  amountAdd,
  amountCompare,
  amountDivide,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  applyAction,
  createInitialGameState,
  exactResourceBag,
  type AutomationBufferLevelId,
  type GameState,
} from "./index";
import { getPowerCostPerSecondExact, getPsuStress } from "./math";
import { createSystemState } from "./progression";
import {
  getOfflineProductiveSystemIds,
  getSystemPowerOperatingCostPerSecond,
} from "./simulation";
import { getClusterWorkloadOperatingCostPerSecond } from "./distributedDefinitions";
import { materializeSystem, replaceSystems, syncSelectedSystemRuntime } from "./systems";

const richResources = exactResourceBag("1000000000000", "1000000000");

const withBuffer = (
  state: GameState,
  levelId: AutomationBufferLevelId,
): GameState => ({
  ...state,
  automationBuffer: {
    ownedLevelId: levelId,
    departureLevelId: levelId,
    offlineProcessedMs: 0,
  },
});

const createTwoSystemState = (
  levelId: AutomationBufferLevelId = "systemScheduler",
): GameState => {
  const initial = createInitialGameState();
  let state = syncSelectedSystemRuntime({
    ...initial,
    exactResources: richResources,
    resources: {
      credits: amountToSafeNumber(richResources.credits),
      data: amountToSafeNumber(richResources.data),
    },
    flags: {
      ...initial.flags,
      psuManagement: true,
      systemCatalog: true,
    },
    research: {
      ...initial.research,
      completed: ["psuManagement", "systemCatalog"],
    },
    hardware: { ...initial.hardware, psuWatts: 1_000 },
  });
  const second = createSystemState(2, "Second Node", "offline-billing", {
    ...state.hardware,
    psuWatts: 1_000,
  });
  state = replaceSystems(state, [state.systems[0]!, second], 1);
  return withBuffer(state, levelId);
};

const powerRate = (state: GameState, systemId: number) =>
  getPowerCostPerSecondExact(materializeSystem(state, systemId));

const costForMs = (rate: string, elapsedMs: number) =>
  amountMultiply(rate, amountDivide(elapsedMs, 1_000));

const activeContract = (
  state: GameState,
  systemId: number,
  workRequiredMs = 1_000,
): GameState => ({
  ...state,
  contracts: {
    ...state.contracts,
    active: [
      {
        id: `billing-contract-${systemId}`,
        templateId: "ledgerAudit",
        kind: "sustained",
        name: "Billing contract",
        description: "Deterministic offline billing fixture.",
        systemId,
        workRequiredMs,
        expiresAtMs: 60_000,
        rewards: exactResourceBag("100", "1"),
        novel: false,
        acceptedAtMs: 0,
        workCompletedMs: 0,
      },
    ],
  },
});

const activeProject = (state: GameState, systemId: number): GameState => ({
  ...state,
  projects: {
    ...state.projects,
    progress: {
      ...state.projects.progress,
      schedulerIntegration: {
        projectId: "schedulerIntegration",
        phaseIndex: 0,
        phaseProgressMs: 0,
        active: true,
        completed: false,
        systemId,
      },
    },
  },
});

describe("offline productive-only physical-system billing", () => {
  it("keeps foreground billing continuous across every powered system", () => {
    const state = createTwoSystemState("localScheduler");
    const totalRate = amountAdd(powerRate(state, 1), powerRate(state, 2));

    const advanced = advanceGame(state, 500, "foreground");

    expect(advanced.intervalReport.productiveMs).toBe(0);
    expect(advanced.intervalReport.creditsSpent).toBe(
      costForMs(totalRate, 500),
    );
  });

  it("bills productive A only while idle B preserves unpaid/overload state", () => {
    let state = createTwoSystemState("localScheduler");
    state = applyAction(state, {
      type: "startTask",
      taskId: "fetchBit",
      systemId: 1,
    });
    state = replaceSystems(
      state,
      state.systems.map((system) =>
        system.id === 2
          ? {
              ...system,
              power: {
                ...system.power,
                unpaidShutdownWarningSeconds: 0.25,
                overloadFailureSeconds: 3,
              },
            }
          : system,
      ),
      1,
    );
    const rateA = powerRate(state, 1);
    const rateB = powerRate(state, 2);
    const idlePowerBefore = state.systems.find((system) => system.id === 2)!.power;

    const advanced = advanceGame(state, 500, "offline");

    expect(getOfflineProductiveSystemIds(state)).toEqual([1]);
    expect(advanced.intervalReport.creditsSpent).toBe(costForMs(rateA, 500));
    expect(advanced.intervalReport.creditsSpent).not.toBe(
      costForMs(amountAdd(rateA, rateB), 500),
    );
    expect(advanced.state.systems.find((system) => system.id === 2)?.power).toEqual(
      idlePowerBefore,
    );
  });

  it("bills the assigned system for contract and project work at their lower gates", () => {
    const contractState = activeContract(
      createTwoSystemState("localScheduler"),
      2,
    );
    const contractRate = powerRate(contractState, 2);
    const contractAdvanced = advanceGame(contractState, 500, "offline");
    expect(contractAdvanced.state.contracts.active[0]?.workCompletedMs).toBe(500);
    expect(contractAdvanced.intervalReport.creditsSpent).toBe(
      costForMs(contractRate, 500),
    );

    const projectState = activeProject(
      createTwoSystemState("systemScheduler"),
      2,
    );
    const projectRate = powerRate(projectState, 2);
    const projectAdvanced = advanceGame(projectState, 500, "offline");
    expect(
      projectAdvanced.state.projects.progress.schedulerIntegration?.phaseProgressMs,
    ).toBe(500);
    expect(projectAdvanced.intervalReport.creditsSpent).toBe(
      costForMs(projectRate, 500),
    );
  });

  it("runs and bills assigned Workshop storage with System Scheduler coverage", () => {
    let state = createTwoSystemState("systemScheduler");
    state = applyAction(state, {
      type: "installWorkshopStorage",
      skuId: "localSsd",
      systemId: 2,
    });
    state = applyAction(state, {
      type: "startWorkshopStorageWorkload",
      workloadId: "artifactStaging",
      systemId: 2,
    });
    const runtimeBefore = state.systems.find((system) => system.id === 2)!.workshop
      .activeStorageWorkload!.runtime;
    const rate = powerRate(state, 2);

    const advanced = advanceGame(state, 500, "offline");

    expect(
      advanced.state.systems.find((system) => system.id === 2)?.workshop
        .activeStorageWorkload?.runtime,
    ).not.toEqual(runtimeBefore);
    expect(advanced.intervalReport.creditsSpent).toBe(costForMs(rate, 500));
  });

  it("freezes below-System storage beside safe work and never bills its system", () => {
    let state = createTwoSystemState("localScheduler");
    state = applyAction(state, {
      type: "installWorkshopStorage",
      skuId: "localSsd",
      systemId: 2,
    });
    state = applyAction(state, {
      type: "startWorkshopStorageWorkload",
      workloadId: "artifactStaging",
      systemId: 2,
    });
    state = activeContract(state, 1);
    const storageBefore = state.systems.find((system) => system.id === 2)!.workshop
      .activeStorageWorkload;
    const safeRate = powerRate(state, 1);

    const advanced = advanceGame(state, 500, "offline");

    expect(advanced.state.contracts.active[0]?.workCompletedMs).toBe(500);
    expect(
      advanced.state.systems.find((system) => system.id === 2)?.workshop
        .activeStorageWorkload,
    ).toEqual(storageBefore);
    expect(advanced.intervalReport.creditsSpent).toBe(costForMs(safeRate, 500));
    expect(advanced.intervalReport.blockers).toContain(
      "System Scheduler automation is required for Workshop storage work.",
    );
  });

  it("excludes frozen storage peak draw when other work runs on the same system", () => {
    let state = createTwoSystemState("localScheduler");
    state = applyAction(state, {
      type: "installWorkshopStorage",
      skuId: "localSsd",
      systemId: 1,
    });
    state = applyAction(state, {
      type: "startWorkshopStorageWorkload",
      workloadId: "artifactStaging",
      systemId: 1,
    });
    state = applyAction(state, {
      type: "startTask",
      taskId: "fetchBit",
      systemId: 1,
    });
    state = replaceSystems(
      state,
      state.systems.map((system) =>
        system.id === 1
          ? {
              ...system,
              hardware: { ...system.hardware, psuWatts: 5 },
            }
          : system,
      ),
      1,
    );
    const storageBefore = state.workshop.activeStorageWorkload;
    const fullPeakRate = powerRate(state, 1);
    const local = materializeSystem(state, 1);
    const productiveOnlyRate = getPowerCostPerSecondExact({
      ...local,
      workshop: { ...local.workshop, activeStorageWorkload: null },
    });
    expect(getPsuStress(local)).toBeGreaterThan(1);
    expect(
      getPsuStress({
        ...local,
        workshop: { ...local.workshop, activeStorageWorkload: null },
      }),
    ).toBeLessThanOrEqual(1);

    const advanced = advanceGame(state, 500, "offline");

    expect(advanced.state.workshop.activeStorageWorkload).toEqual(storageBefore);
    expect(advanced.intervalReport.creditsSpent).toBe(
      costForMs(productiveOnlyRate, 500),
    );
    expect(amountCompare(productiveOnlyRate, fullPeakRate)).toBeLessThan(0);
  });

  it("bills a physical system node used by runnable cluster work but not idle peers", () => {
    let state = createTwoSystemState("clusterController");
    const strongHardware = {
      ...state.hardware,
      ramBits: 8_000_000,
      psuWatts: 1_000,
      cpus: state.hardware.cpus.map((cpu) => ({
        ...cpu,
        tierId: "mhz" as const,
        level: 1,
      })),
    };
    state = syncSelectedSystemRuntime({
      ...state,
      campaign: {
        ...state.campaign,
        currentChapterId: "localFabric",
        currentObjectiveId: "fabric:cluster-controller",
      },
      hardware: strongHardware,
    });
    state = applyAction(state, {
      type: "installWorkshopStorage",
      skuId: "localSsd",
      systemId: 1,
    });
    state = applyAction(state, {
      type: "setSystemManaged",
      systemId: 1,
      managed: true,
    });
    const physicalNode = state.infrastructure.fleetNodes.find(
      (node) => node.source.kind === "system" && node.source.systemId === 1,
    );
    expect(physicalNode?.managed).toBe(true);
    state = applyAction(state, {
      type: "commissionCluster",
      name: "Physical cluster",
      nodeIds: [physicalNode!.id],
    });
    const clusterId = state.infrastructure.clusters[0]?.id;
    state = applyAction(state, {
      type: "startClusterWorkload",
      clusterId: clusterId!,
      definitionId: "fabricIntegritySweep",
    });
    expect(state.infrastructure.workloads).toHaveLength(1);
    const systemRate = powerRate(state, 1);
    const clusterRate = getClusterWorkloadOperatingCostPerSecond(
      state,
      "offline",
    );

    expect(getOfflineProductiveSystemIds(state)).toEqual([1]);
    expect(getSystemPowerOperatingCostPerSecond(state, "offline")).toBe(
      systemRate,
    );
    const advanced = advanceGame(state, 500, "offline");
    expect(advanced.intervalReport.creditsSpent).toBe(
      costForMs(amountAdd(systemRate, clusterRate), 500),
    );
  });

  it("uses Fleet Orchestrator as a horizon upgrade, not a throughput gate", () => {
    let systemCovered = activeContract(createTwoSystemState("systemScheduler"), 1);
    systemCovered = applyAction(systemCovered, {
      type: "startTask",
      taskId: "fetchBit",
      systemId: 2,
    });
    const secondaryBefore = systemCovered.systems.find((system) => system.id === 2)!
      .activeTasks;
    const systemAdvanced = advanceGame(systemCovered, 500, "offline");
    expect(systemAdvanced.state.contracts.active[0]?.workCompletedMs).toBe(500);
    expect(
      systemAdvanced.state.systems.find((system) => system.id === 2)?.activeTasks,
    ).not.toEqual(secondaryBefore);

    const fleetCovered = withBuffer(systemCovered, "fleetOrchestrator");
    const fleetAdvanced = advanceGame(fleetCovered, 500, "offline");
    expect(
      fleetAdvanced.state.systems.find((system) => system.id === 2)?.activeTasks,
    ).toEqual(
      systemAdvanced.state.systems.find((system) => system.id === 2)?.activeTasks,
    );
    expect(fleetAdvanced.state.exactResources).toEqual(
      systemAdvanced.state.exactResources,
    );
  });

  it("stops billing at completion and leaves the idle remainder safely paused", () => {
    const state = activeContract(
      createTwoSystemState("localScheduler"),
      1,
      250,
    );
    const rate = powerRate(state, 1);
    const creditsBefore = state.exactResources.credits;
    const advanced = advanceGame(state, 1_000, "offline");

    expect(advanced.state.contracts.active).toHaveLength(0);
    expect(advanced.intervalReport.productiveMs).toBe(250);
    expect(advanced.intervalReport.pausedMs).toBe(750);
    expect(advanced.intervalReport.creditsSpent).toBe(costForMs(rate, 250));
    expect(advanced.state.exactResources.credits).toBe(
      amountAdd(
        amountSubtract(creditsBefore, costForMs(rate, 250)),
        "100",
      ),
    );
  });

  it("is exact one-shot/split invariant across a completion boundary", () => {
    const state = activeContract(
      createTwoSystemState("localScheduler"),
      1,
      750,
    );
    const oneShot = advanceGame(state, 1_000, "offline").state;
    const split = [200, 300, 500].reduce(
      (working, elapsedMs) => advanceGame(working, elapsedMs, "offline").state,
      state,
    );

    expect(split.exactResources).toEqual(oneShot.exactResources);
    expect(split.contracts).toEqual(oneShot.contracts);
    expect(split.systems).toEqual(oneShot.systems);
    expect(amountCompare(split.exactResources.credits, oneShot.exactResources.credits)).toBe(
      0,
    );
  });
});
