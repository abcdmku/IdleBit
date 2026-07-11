import { describe, expect, it } from "vitest";
import {
  amount,
  amountAdd,
  amountCompare,
  amountSubtract,
  amountToSafeNumber,
  advanceGame,
  applyAction,
  automationBufferDefinitions,
  createInitialGameState,
  createRngState,
  deriveVisibleState,
  deserializeSave,
  exactResourceBag,
  getVisibleMissions,
  nextRngUint32,
  projectDefinitions,
  recordDeparture,
  serializeSave,
} from "./index";
import type {
  AutomationBufferLevelId,
  GameState,
  ResearchId,
} from "./types";
import { createRackReadyGameState } from "./devSeeds";
import { getHardwareDrawWatts, getPsuStress } from "./math";
import { createSystemState } from "./progression";
import { replaceSystems } from "./systems";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const fundExact = (
  state: GameState,
  credits = "1000000000000000000000000000000",
  data = "1000000000000000000000000000000",
): GameState => {
  const exactResources = exactResourceBag(credits, data);
  return {
    ...state,
    exactResources,
    resources: {
      credits: amountToSafeNumber(exactResources.credits),
      data: amountToSafeNumber(exactResources.data),
    },
  };
};

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

const campaignReadyState = () => {
  const requiredResearch: ResearchId[] = [
    "localScheduler",
    "cronScheduler",
    "systemScheduler",
    "systemCatalog",
    "clusterControllerResearch",
    "rackControllerResearch",
    "dataCenterNocResearch",
    "globalSchedulerResearch",
  ];
  return fundExact({
    ...createInitialGameState(),
    campaign: {
      ...createInitialGameState().campaign,
      currentChapterId: "planetaryCommons",
      currentObjectiveId: "planetary:global-scheduler",
    },
    research: { completed: requiredResearch, clickRateLevel: 0 },
  });
};

describe("campaign foundation", () => {
  it("normalizes and calculates exact string-backed amounts without overflow", () => {
    expect(amount("000001.23000")).toBe("1.23");
    expect(
      amountAdd(
        amount("999999999999999999999999999999999999999999"),
        amount(1),
      ),
    ).toBe("1000000000000000000000000000000000000000000");
    expect(
      amountSubtract(amount("1000000000000000000000000000000"), amount(1)),
    ).toBe("999999999999999999999999999999");
    expect(amountToSafeNumber(amount("1e400"))).toBe(Number.MAX_VALUE);
  });

  it("uses a saved deterministic xoshiro128** stream", () => {
    let rng = createRngState(12345);
    const values: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const next = nextRngUint32(rng);
      rng = next.state;
      values.push(next.value);
    }
    expect(values).toEqual([
      3775394313,
      46987735,
      511041069,
      3519782070,
      2286913419,
    ]);

    const saved = { ...createInitialGameState(), rng };
    expect(deserializeSave(serializeSave(saved, 50)).rng).toEqual(rng);
  });

  it("round-trips save-v7 exact balances and envelope time while resetting v6", () => {
    const departedAtMs = 1_700_000_000_000;
    const savedAtMs = departedAtMs + 1_000;
    const exactResources = exactResourceBag("1e400", "9007199254740993");
    const state = recordDeparture(
      {
        ...createInitialGameState(),
        exactResources,
        resources: {
          credits: amountToSafeNumber(exactResources.credits),
          data: amountToSafeNumber(exactResources.data),
        },
      },
      departedAtMs,
    );
    const restored = deserializeSave(serializeSave(state, savedAtMs));

    expect(restored.version).toBe(7);
    expect(restored.exactResources).toEqual(exactResources);
    expect(restored.resources.credits).toBe(Number.MAX_VALUE);
    expect(restored.time).toEqual({ lastSavedAtMs: savedAtMs, departedAtMs });
    expect(restored.rng).toEqual(state.rng);

    const reset = deserializeSave(
      JSON.stringify({
        version: 6,
        savedAtMs,
        state: { ...state, version: 6 },
      }),
    );
    expect(reset.version).toBe(7);
    expect(reset.exactResources).toEqual(exactResourceBag(10, 0));
    expect(reset.automationBuffer.ownedLevelId).toBe("startingNode");
  });

  it("round-trips every late Automation Buffer research unlock in save-v7", () => {
    const lateBufferResearch: ResearchId[] = [
      "clusterControllerResearch",
      "rackControllerResearch",
      "dataCenterNocResearch",
      "globalSchedulerResearch",
    ];
    const state = {
      ...createInitialGameState(),
      research: {
        ...createInitialGameState().research,
        completed: lateBufferResearch,
      },
    };

    const restored = deserializeSave(serializeSave(state, 123_456));

    expect(restored.research.completed).toEqual(lateBufferResearch);
  });

  it("defines every buffer cap and enforces each offline boundary", () => {
    expect(automationBufferDefinitions.map((definition) => definition.maxOfflineMs)).toEqual([
      0,
      2 * HOUR_MS,
      8 * HOUR_MS,
      12 * HOUR_MS,
      24 * HOUR_MS,
      48 * HOUR_MS,
      72 * HOUR_MS,
      120 * HOUR_MS,
      168 * HOUR_MS,
    ]);
    expect(
      automationBufferDefinitions.map((definition) => [
        definition.id,
        definition.costs.find((cost) => cost.resource === "credits")?.amount ??
          "0",
        definition.costs.find((cost) => cost.resource === "data")?.amount ??
          "0",
      ]),
    ).toEqual([
      ["startingNode", "0", "0"],
      ["localScheduler", "70", "8"],
      ["cronRuntime", "480", "3"],
      ["systemScheduler", "190000", "5"],
      ["fleetOrchestrator", "500000", "1"],
      ["clusterController", "6000000", "1"],
      ["rackController", "1300000", "1"],
      ["dataCenterNoc", "1700000", "1"],
      ["globalScheduler", "50000000", "1000000"],
    ]);

    for (const definition of automationBufferDefinitions) {
      const levelState = withBuffer(createInitialGameState(), definition.id);
      const restored = deserializeSave(serializeSave(levelState));
      expect(restored.automationBuffer.ownedLevelId).toBe(definition.id);
      expect(restored.automationBuffer.departureLevelId).toBe(definition.id);

      const atBoundary = advanceGame(
        levelState,
        definition.maxOfflineMs,
        "offline",
      );
      expect(atBoundary.report.simulatedMs).toBe(definition.maxOfflineMs);
      expect(atBoundary.report.overflowMs).toBe(0);

      const beyondBoundary = advanceGame(
        withBuffer(createInitialGameState(), definition.id),
        definition.maxOfflineMs + 1,
        "offline",
      );
      expect(beyondBoundary.report.simulatedMs).toBe(definition.maxOfflineMs);
      expect(beyondBoundary.report.overflowMs).toBe(1);
    }
  });

  it("purchases all buffer levels sequentially through exact gates and costs", () => {
    let state = campaignReadyState();
    for (const definition of automationBufferDefinitions.slice(1)) {
      const resourcesBefore = state.exactResources;
      state = applyAction(state, {
        type: "purchaseAutomationBuffer",
        levelId: definition.id,
      });
      expect(state.automationBuffer.ownedLevelId).toBe(definition.id);
      expect(state.exactResources.credits).toBe(
        amountSubtract(
          resourcesBefore.credits,
          definition.costs.find((cost) => cost.resource === "credits")?.amount ??
            "0",
        ),
      );
      expect(state.exactResources.data).toBe(
        amountSubtract(
          resourcesBefore.data,
          definition.costs.find((cost) => cost.resource === "data")?.amount ??
            "0",
        ),
      );
    }

    const locked = applyAction(createInitialGameState(), {
      type: "purchaseAutomationBuffer",
      levelId: "localScheduler",
    });
    expect(locked.automationBuffer.ownedLevelId).toBe("startingNode");
  });

  it("requires chapter research before purchasing every late Automation Buffer", () => {
    const initial = createInitialGameState();
    let state = fundExact({
      ...initial,
      campaign: {
        ...initial.campaign,
        currentChapterId: "localFabric",
        currentObjectiveId: "fabric:cluster-controller",
      },
      automationBuffer: {
        ...initial.automationBuffer,
        ownedLevelId: "fleetOrchestrator",
        departureLevelId: "fleetOrchestrator",
      },
      research: {
        ...initial.research,
        completed: ["systemCatalog"],
      },
    });

    const gated = applyAction(state, {
      type: "purchaseAutomationBuffer",
      levelId: "clusterController",
    });
    expect(gated.automationBuffer.ownedLevelId).toBe("fleetOrchestrator");

    state = applyAction(state, {
      type: "buyResearch",
      researchId: "clusterControllerResearch",
    });
    expect(state.research.completed).toContain("clusterControllerResearch");
    state = applyAction(state, {
      type: "purchaseAutomationBuffer",
      levelId: "clusterController",
    });
    expect(state.automationBuffer.ownedLevelId).toBe("clusterController");
    expect(
      automationBufferDefinitions.slice(5).every(
        (definition) => definition.requiredResearchId !== null,
      ),
    ).toBe(true);
  });

  it("reveals Data Center NOC research only after reaching Resilient Cloud", () => {
    const initial = createInitialGameState();
    const rackAndFacility = fundExact({
      ...initial,
      campaign: {
        ...initial.campaign,
        currentChapterId: "rackAndFacility",
        currentObjectiveId: "facility:rack-controller",
      },
      research: {
        ...initial.research,
        completed: ["rackControllerResearch"],
      },
    });

    expect(
      deriveVisibleState(rackAndFacility).research.some(
        (research) => research.id === "dataCenterNocResearch",
      ),
    ).toBe(false);
    expect(
      applyAction(rackAndFacility, {
        type: "buyResearch",
        researchId: "dataCenterNocResearch",
      }).research.completed,
    ).not.toContain("dataCenterNocResearch");

    const resilientCloud = {
      ...rackAndFacility,
      campaign: {
        ...rackAndFacility.campaign,
        currentChapterId: "resilientCloud" as const,
        currentObjectiveId: "cloud:data-center-noc" as const,
      },
    };
    const visibleResearch = deriveVisibleState(resilientCloud).research.find(
      (research) => research.id === "dataCenterNocResearch",
    );

    expect(visibleResearch).toMatchObject({ canAfford: true, canBuy: true });
    expect(
      applyAction(resilientCloud, {
        type: "buyResearch",
        researchId: "dataCenterNocResearch",
      }).research.completed,
    ).toContain("dataCenterNocResearch");
  });

  it("rejects every purchasable buffer when its revealing research is absent", () => {
    const initial = createInitialGameState();
    for (const [index, definition] of automationBufferDefinitions
      .slice(1)
      .entries()) {
      const previous = automationBufferDefinitions[index]!;
      const state = fundExact({
        ...initial,
        campaign: {
          ...initial.campaign,
          currentChapterId: definition.requiredChapter,
          currentObjectiveId: null,
        },
        automationBuffer: {
          ...initial.automationBuffer,
          ownedLevelId: previous.id,
          departureLevelId: previous.id,
        },
        research: { ...initial.research, completed: [] },
      });
      const attempted = applyAction(state, {
        type: "purchaseAutomationBuffer",
        levelId: definition.id,
      });
      expect(definition.requiredResearchId).not.toBeNull();
      expect(attempted.automationBuffer.ownedLevelId).toBe(previous.id);
    }
  });

  it("uses the Cloud finale as the single planetary finale", () => {
    expect(projectDefinitions.map((definition) => definition.id)).not.toContain(
      "planetaryFinale",
    );
  });

  it("keeps optional side arcs in Projects instead of duplicating mainline missions", () => {
    const missionIds = getVisibleMissions(campaignReadyState()).map(
      (mission) => mission.id,
    );
    expect(missionIds).not.toContain("fleet:open-foundry");
    expect(missionIds).not.toContain("fabric:archivist");
    expect(missionIds).not.toContain("facility:grid-relief");
    expect(
      projectDefinitions
        .filter((definition) => definition.sideArcId !== null)
        .map((definition) => definition.id),
    ).toEqual(["archivist", "openFoundry", "gridRelief"]);
  });

  it("uses the departure-owned buffer and never recovers overflow retroactively", () => {
    const departed = recordDeparture(
      withBuffer(createInitialGameState(), "localScheduler"),
      100,
    );
    const upgradedAfterDeparture: GameState = {
      ...departed,
      automationBuffer: {
        ...departed.automationBuffer,
        ownedLevelId: "globalScheduler",
      },
    };
    const result = advanceGame(upgradedAfterDeparture, 3 * HOUR_MS, "offline");
    expect(result.report.bufferLevelId).toBe("localScheduler");
    expect(result.report.simulatedMs).toBe(2 * HOUR_MS);
    expect(result.report.overflowMs).toBe(HOUR_MS);
  });

  it("hydrates departure time and applies the cap on load", () => {
    const departedAtMs = 10_000;
    const nowMs = departedAtMs + 3 * HOUR_MS;
    const state = recordDeparture(
      withBuffer(createInitialGameState(), "localScheduler"),
      departedAtMs,
    );
    const restored = deserializeSave(serializeSave(state, departedAtMs));
    const elapsedMs = nowMs - (restored.time.departedAtMs ?? nowMs);
    const result = advanceGame(restored, elapsedMs, "offline");
    expect(result.report.simulatedMs).toBe(2 * HOUR_MS);
    expect(result.report.overflowMs).toBe(HOUR_MS);
  });

  it("is delta-invariant across varied operation-transition chunks", () => {
    let initial = fundExact(createInitialGameState(), "1000", "0");
    initial = {
      ...initial,
      power: { ...initial.power, bootstrapGraceSeconds: 100 },
    };
    initial = applyAction(initial, { type: "startTask", taskId: "fetchBit" });

    const oneShot = advanceGame(initial, 5_000, "foreground").state;
    const chunked = [137, 863, 1_111, 289, 2_600].reduce(
      (state, chunkMs) => advanceGame(state, chunkMs, "foreground").state,
      initial,
    );

    expect(chunked.tick).toBeCloseTo(oneShot.tick, 10);
    expect(chunked.completedTasks).toEqual(oneShot.completedTasks);
    expect(chunked.activeTasks).toEqual(oneShot.activeTasks);
    expect(chunked.queueEntries).toEqual(oneShot.queueEntries);
    expect(chunked.exactResources).toEqual(oneShot.exactResources);
    expect(chunked.power).toEqual(oneShot.power);
  });

  it("finishes only Local Scheduler finite work and renews after CRON", () => {
    let local = fundExact(withBuffer(createInitialGameState(), "localScheduler"), "1000", "0");
    local = applyAction(local, {
      type: "setStandingOrder",
      taskId: "fetchBit",
    });
    local = applyAction(local, { type: "startTask", taskId: "fetchBit" });
    const localResult = advanceGame(local, 30_000, "offline");
    expect(localResult.state.completedTasks.fetchBit).toBe(1);
    expect(localResult.report.standingOrderRenewals).toBe(0);
    expect(localResult.report.blockers).toContain("Queue exhausted.");

    let cron = fundExact(withBuffer(createInitialGameState(), "cronRuntime"), "1000000", "0");
    cron = {
      ...cron,
      flags: { ...cron.flags, cron: true },
    };
    cron = applyAction(cron, { type: "setStandingOrder", taskId: "fetchBit" });
    const cronResult = advanceGame(cron, 30_000, "offline");
    expect(cronResult.report.standingOrderRenewals).toBeGreaterThan(1);
    expect(cronResult.state.completedTasks.fetchBit).toBeGreaterThan(1);
  });

  it("rejects invalid standing orders and safely falls back from a legacy invalid order", () => {
    let state = fundExact(
      withBuffer(createInitialGameState(), "cronRuntime"),
      "1000000",
      "0",
    );
    state = { ...state, flags: { ...state.flags, cron: true } };

    const rejected = applyAction(state, {
      type: "setStandingOrder",
      taskId: "bitFlip",
    });
    expect(rejected.standingOrder.taskId).toBeNull();

    const legacyInvalid = {
      ...state,
      standingOrder: {
        taskId: "bitFlip" as const,
        systemId: state.selectedSystemId,
        enabled: true,
        renewalCount: 0,
      },
    };
    const result = advanceGame(legacyInvalid, 30_000, "offline");

    expect(result.state.standingOrder.taskId).toBe("fetchBit");
    expect(result.state.completedTasks.fetchBit).toBeGreaterThan(0);
    expect(result.report.standingOrderRenewals).toBeGreaterThan(0);
    expect(result.report.blockers).not.toContain("Queue exhausted.");
  });

  it("reports gross earnings and expenses separately", () => {
    let state = fundExact(createInitialGameState(), "100", "0");
    state = {
      ...state,
      flags: { ...state.flags, psuManagement: true },
      research: { ...state.research, completed: ["psuManagement"] },
    };
    state = applyAction(state, { type: "startTask", taskId: "fetchBit" });
    const beforeCredits = state.exactResources.credits;
    const result = advanceGame(state, 5_000, "foreground");
    const conserved = amountSubtract(
      amountAdd(beforeCredits, result.report.creditsEarned),
      result.report.creditsSpent,
    );
    expect(amountCompare(result.report.creditsEarned, 0)).toBeGreaterThan(0);
    expect(amountCompare(result.report.creditsSpent, 0)).toBeGreaterThan(0);
    expect(result.state.exactResources.credits).toBe(conserved);
  });

  it("safely pauses overload risk without destroying absent work", () => {
    let state = fundExact(withBuffer(createInitialGameState(), "localScheduler"), "1000", "0");
    state = applyAction(state, { type: "startTask", taskId: "fetchBit" });
    const overloadedWatts = getHardwareDrawWatts(state) / 1.3;
    state = {
      ...state,
      hardware: { ...state.hardware, psuWatts: overloadedWatts },
      systems: state.systems.map((system) => ({
        ...system,
        hardware: { ...system.hardware, psuWatts: overloadedWatts },
      })),
    };
    expect(getPsuStress(state)).toBeGreaterThan(1);
    const activeBefore = state.activeTasks;
    const result = advanceGame(state, HOUR_MS, "offline");
    expect(result.report.productiveMs).toBe(0);
    expect(result.report.pausedMs).toBe(HOUR_MS);
    expect(result.report.blockers.some((blocker) => blocker.includes("overload"))).toBe(true);
    expect(result.state.activeTasks).toEqual(activeBefore);
    expect(result.state.power.failureCount).toBe(state.power.failureCount);
  });

  it("keeps a safe standing order productive beside a powered-off contract system", () => {
    let state = fundExact(withBuffer(createInitialGameState(), "globalScheduler"));
    state = replaceSystems(
      state,
      [state.systems[0]!, createSystemState(2, "Offline contract box")],
      2,
    );
    state = {
      ...state,
      flags: { ...state.flags, cron: true },
      campaign: { ...state.campaign, currentChapterId: "planetaryCommons" },
    };
    state = applyAction(state, { type: "refreshContractMarket" });
    const offer = state.contracts.offers[0];
    expect(offer?.systemId).toBe(2);
    state = applyAction(state, {
      type: "acceptContract",
      contractId: offer!.id,
    });
    state = replaceSystems(
      state,
      state.systems.map((system) =>
        system.id === 2
          ? { ...system, power: { ...system.power, state: "off" as const } }
          : system,
      ),
      1,
    );
    state = applyAction(state, {
      type: "setStandingOrder",
      taskId: "fetchBit",
      systemId: 1,
    });

    const result = advanceGame(state, 60_000, "offline");

    expect(result.report.standingOrderRenewals).toBeGreaterThan(0);
    expect(result.report.productiveMs).toBe(60_000);
    expect(result.state.contracts.active[0]?.workCompletedMs).toBe(0);
    expect(result.state.systems.find((system) => system.id === 2)?.power.state).toBe(
      "off",
    );
    expect(result.report.blockers).not.toContain("Queue exhausted.");
  });

  it("keeps a safe standing order productive beside a powered-off project system", () => {
    let state = fundExact(withBuffer(createInitialGameState(), "globalScheduler"));
    // Scheduler Integration needs a RAM-capable host, so borrow the rack seed's
    // dense node as the project system while the standing order stays local.
    const projectHost = {
      ...createRackReadyGameState().systems.find((system) => system.id === 2)!,
      name: "Paused project box",
    };
    state = replaceSystems(state, [state.systems[0]!, projectHost], 2);
    state = {
      ...state,
      flags: { ...state.flags, cron: true },
      campaign: { ...state.campaign, currentChapterId: "planetaryCommons" },
      research: {
        ...state.research,
        completed: [...state.research.completed, "systemScheduler" as const],
      },
    };
    state = applyAction(state, {
      type: "startProjectPhase",
      projectId: "schedulerIntegration",
      systemId: 2,
    });
    expect(state.projects.progress.schedulerIntegration?.active).toBe(true);
    state = replaceSystems(
      state,
      state.systems.map((system) =>
        system.id === 2
          ? { ...system, power: { ...system.power, state: "off" as const } }
          : system,
      ),
      1,
    );
    state = applyAction(state, {
      type: "setStandingOrder",
      taskId: "fetchBit",
      systemId: 1,
    });

    const result = advanceGame(state, 60_000, "offline");

    expect(result.report.standingOrderRenewals).toBeGreaterThan(0);
    expect(result.report.productiveMs).toBe(60_000);
    expect(
      result.state.projects.progress.schedulerIntegration?.phaseProgressMs,
    ).toBe(0);
    expect(result.report.blockers).not.toContain("Queue exhausted.");
  });

  it("processes a full-week standing order within a bounded wall-clock budget", () => {
    let state = fundExact(withBuffer(createInitialGameState(), "globalScheduler"), "1000000000", "0");
    state = { ...state, flags: { ...state.flags, cron: true } };
    state = applyAction(state, { type: "setStandingOrder", taskId: "fetchBit" });

    const startedAt = performance.now();
    const result = advanceGame(state, 7 * DAY_MS, "offline");
    const durationMs = performance.now() - startedAt;

    expect(result.report.simulatedMs).toBe(7 * DAY_MS);
    expect(result.report.standingOrderRenewals).toBeGreaterThan(10_000);
    expect(durationMs).toBeLessThan(1_000);
  });
});
