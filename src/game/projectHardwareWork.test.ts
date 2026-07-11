import { describe, expect, it } from "vitest";

import { amount, amountCompare, exactResourceBag } from "./amount";
import { createRackReadyGameState } from "./devSeeds";
import { syncExactResources } from "./economy";
import { createInitialGameState, getRamSpeedMt } from "./progression";
import {
  advanceProjects,
  getProjectRemainingMs,
  getVisibleProjects,
  projectDefinitions,
  startProjectPhase,
} from "./projects";
import { getHardwareWorkTotal } from "./hardwareWork";
import { deserializeSave, serializeSave } from "./save";
import { deriveVisibleState } from "./selectors";
import { materializeSystem, updateMaterializedSystem } from "./systems";
import type { GameState } from "./types";
import { getWorkValueCredits } from "./workValue";

const funded = (state: GameState) =>
  syncExactResources({
    ...state,
    exactResources: exactResourceBag("1000000", "1000000"),
  });

const coherent = (state: GameState): GameState => ({
  ...state,
  campaign: {
    ...state.campaign,
    currentChapterId: "coherentMachine",
  },
});

const startScheduler = (state: GameState, systemId = state.selectedSystemId) =>
  startProjectPhase(funded(state), "schedulerIntegration", systemId);

describe("project hardware work", () => {
  it("derives every phase Credit from exact recipe work and its named multiplier", () => {
    for (const project of projectDefinitions) {
      for (const phase of project.phases) {
        expect(phase.paidWorkUnits).toBe(getHardwareWorkTotal(phase.recipe));
        expect(phase.workValueMultiplier.id.length).toBeGreaterThan(0);
        expect(phase.rewards.credits).toBe(
          getWorkValueCredits(
            phase.paidWorkUnits,
            phase.workValueMultiplier,
          ),
        );
        expect(amountCompare(phase.rewards.data, 0)).toBeGreaterThanOrEqual(0);
      }
    }

    const visible = getVisibleProjects(
      funded(coherent(createInitialGameState())),
    )[0]!;
    expect(visible.id).toBe("schedulerIntegration");
    const visiblePhase = visible.currentPhase!;
    expect(visiblePhase.id).toBe("queue-map");
    const authoredPhase = projectDefinitions[0]!.phases[0]!;
    expect(visiblePhase.paidWorkUnits).toBe(authoredPhase.paidWorkUnits);
    expect(visiblePhase.workValueMultiplier).toEqual(
      authoredPhase.workValueMultiplier,
    );
  });

  it("is exact and delta-invariant across split advancement", () => {
    const initial = startScheduler(createRackReadyGameState());
    const oneShot = advanceProjects(initial, 1_000);
    let split = initial;
    for (let index = 0; index < 10; index += 1) {
      split = advanceProjects(split, 100);
    }

    expect(split.projects).toEqual(oneShot.projects);
    expect(split.exactResources).toEqual(oneShot.exactResources);
    // One second of the rack-ready workstation's exact cache lane rate,
    // still inside the 60-unit queue-map cache stage.
    expect(
      oneShot.projects.progress.schedulerIntegration?.phaseWorkCompleted,
    ).toBe("4.6");
  });

  it("projects and completes the same work sooner on faster hardware", () => {
    const base = createRackReadyGameState();
    const slow = startScheduler(base, 1);
    const fast = startScheduler(base, 2);
    const slowProgress = slow.projects.progress.schedulerIntegration!;
    const fastProgress = fast.projects.progress.schedulerIntegration!;

    const fastRemainingMs = getProjectRemainingMs(fast, fastProgress);
    const slowRemainingMs = getProjectRemainingMs(slow, slowProgress);
    expect(fastRemainingMs).toBeLessThan(slowRemainingMs);

    // A window past the fast node's finish but short of the slow node's pins
    // that the same authored work volume settles sooner on faster hardware.
    const probeMs = Math.floor((fastRemainingMs + slowRemainingMs) / 2);
    const slowAdvanced = advanceProjects(slow, probeMs);
    const fastAdvanced = advanceProjects(fast, probeMs);
    expect(slowAdvanced.projects.progress.schedulerIntegration).toMatchObject({
      phaseIndex: 0,
      active: true,
    });
    expect(fastAdvanced.projects.progress.schedulerIntegration).toMatchObject({
      phaseIndex: 1,
      active: false,
    });
    // 1,000,000 funded - 200 phase cost + 300 derived phase reward.
    expect(fastAdvanced.exactResources.credits).toBe("1000100");

    const slowCompleted = advanceProjects(slow, slowRemainingMs + 1_000);
    const fastCompleted = advanceProjects(fast, slowRemainingMs + 1_000);
    expect(slowCompleted.exactResources.credits).toBe(
      fastCompleted.exactResources.credits,
    );
  });

  it("uses assigned cache and RAM speed for staged project duration", () => {
    const base = startProjectPhase(
      funded(createRackReadyGameState()),
      "schedulerIntegration",
      1,
    );
    const progress = base.projects.progress.schedulerIntegration!;
    const baselineMs = getProjectRemainingMs(base, progress);
    const local = materializeSystem(base, 1);
    const fasterCache = updateMaterializedSystem(base, {
      ...local,
      hardware: {
        ...local.hardware,
        cpus: local.hardware.cpus.map((cpu) => ({
          ...cpu,
          cacheSpeedLevel: cpu.cacheSpeedLevel + 3,
        })),
      },
    }, 1);
    const fasterRam = updateMaterializedSystem(base, {
      ...local,
      hardware: {
        ...local.hardware,
        ramSticks: local.hardware.ramSticks.map((stick) => ({
          ...stick,
          speedLevel: stick.speedLevel + 2,
          speedMt: getRamSpeedMt(stick.speedLevel + 2),
        })),
      },
    }, 1);

    expect(getProjectRemainingMs(fasterCache, progress)).toBeLessThan(
      baselineMs,
    );
    expect(getProjectRemainingMs(fasterRam, progress)).toBeLessThan(
      baselineMs,
    );
  });

  it("blocks project phases when the target system is missing a required lane", () => {
    const initial = createInitialGameState();
    const unresearched = funded(coherent(initial));
    expect(
      getVisibleProjects(unresearched).find(
        (project) => project.id === "schedulerIntegration",
      ),
    ).toMatchObject({
      canStartPhase: false,
      blockedReason: "Requires System Scheduler research.",
    });

    const unavailable: GameState = {
      ...unresearched,
      research: {
        ...unresearched.research,
        completed: [...unresearched.research.completed, "systemScheduler"],
      },
    };
    const scheduler = getVisibleProjects(unavailable).find(
      (project) => project.id === "schedulerIntegration",
    );

    expect(scheduler).toMatchObject({
      canStartPhase: false,
      blockedReason: "Barebones PC has no RAM throughput.",
      projectionBlockedReason: "Barebones PC has no RAM throughput.",
      remainingMs: Number.MAX_SAFE_INTEGER,
    });
    expect(startProjectPhase(unavailable, "schedulerIntegration", 1)).toBe(
      unavailable,
    );

    const capable = funded(createRackReadyGameState());
    const capableScheduler = getVisibleProjects(capable).find(
      (project) => project.id === "schedulerIntegration",
    );
    expect(capableScheduler).toMatchObject({
      canStartPhase: true,
      blockedReason: null,
      projectionBlockedReason: null,
    });
    expect(capableScheduler?.remainingMs).toBeLessThan(Number.MAX_SAFE_INTEGER);

    const capableTarget = { ...capable.systems[0]!, id: 2, name: "RAM Node" };
    const mixed: GameState = {
      ...unavailable,
      systems: [unavailable.systems[0]!, capableTarget],
      rack: { nextSystemId: 3 },
    };
    const mixedScheduler = getVisibleProjects(mixed).find(
      (project) => project.id === "schedulerIntegration",
    );
    expect(
      mixedScheduler?.systemProjections?.find(
        (projection) => projection.systemId === 1,
      ),
    ).toMatchObject({
      canStartPhase: false,
      startBlockedReason: "Barebones PC has no RAM throughput.",
      projectionBlockedReason: "Barebones PC has no RAM throughput.",
    });
    expect(
      mixedScheduler?.systemProjections?.find(
        (projection) => projection.systemId === 2,
      ),
    ).toMatchObject({
      canStartPhase: true,
      startBlockedReason: null,
      projectionBlockedReason: null,
    });
  });

  it("names a zero-rate projection for an already-active legacy phase", () => {
    const initial = createInitialGameState();
    const active: GameState = funded({
      ...initial,
      campaign: {
        ...initial.campaign,
        currentChapterId: "coherentMachine",
      },
      projects: {
        ...initial.projects,
        progress: {
          schedulerIntegration: {
            projectId: "schedulerIntegration",
            phaseIndex: 0,
            phaseWorkCompleted: amount(0),
            phaseStageIndex: 0,
            phaseStageWorkCompleted: amount(0),
            phaseProgressMs: 0,
            active: true,
            completed: false,
            systemId: 1,
          },
        },
      },
    });
    const scheduler = getVisibleProjects(active).find(
      (project) => project.id === "schedulerIntegration",
    );

    expect(scheduler).toMatchObject({
      active: true,
      blockedReason: "Project phase already active.",
      projectionBlockedReason: "Barebones PC has no RAM throughput.",
      remainingMs: Number.MAX_SAFE_INTEGER,
    });
    expect(
      deriveVisibleState(active).activeWork.find(
        (work) => work.id === "project:schedulerIntegration",
      ),
    ).toMatchObject({ remainingMs: null, progress: 0 });
    const advancedToRam = advanceProjects(active, 60_000);
    expect(
      advancedToRam.projects.progress.schedulerIntegration,
    ).toMatchObject({
      phaseStageIndex: 1,
      phaseStageWorkCompleted: "0",
      phaseWorkCompleted: "60",
    });
    expect(advanceProjects(advancedToRam, 10_000).projects).toEqual(
      advancedToRam.projects,
    );
  });

  it("migrates legacy phase milliseconds into exact authored work", () => {
    const initial = funded(createInitialGameState());
    const legacy: GameState = {
      ...initial,
      projects: {
        progress: {
          schedulerIntegration: {
            projectId: "schedulerIntegration",
            phaseIndex: 0,
            phaseProgressMs: 5_000,
            active: true,
            completed: false,
            systemId: 1,
          },
          // Retired project records from older saves must load cleanly and
          // simply drop out of the normalized state.
          bootstrapBenchmark: {
            projectId: "bootstrapBenchmark",
            phaseIndex: 1,
            phaseProgressMs: 2_500,
            active: true,
            completed: false,
            systemId: 1,
          },
        },
        completedProjectIds: ["bootstrapBenchmark"],
      } as unknown as GameState["projects"],
    };

    const restored = deserializeSave(serializeSave(legacy, 123));
    expect(
      restored.projects.progress.schedulerIntegration?.phaseWorkCompleted,
    ).toBe("5");
    expect(Object.keys(restored.projects.progress)).toEqual([
      "schedulerIntegration",
    ]);
    expect(restored.projects.completedProjectIds).toEqual([]);
  });
});
