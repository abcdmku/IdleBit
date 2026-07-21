import { describe, expect, it } from "vitest";

import { advanceGame } from "./advance";
import {
  amount,
  amountAdd,
  amountCompare,
  amountDivide,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  exactResourceBag,
} from "./amount";
import { acceptContract } from "./contracts";
import { createRackReadyGameState } from "./devSeeds";
import {
  getHardwareDrawWattsExact,
  getPowerCostPerSecondExact,
  getPsuStress,
} from "./math";
import {
  LIVE_OPERATIONS_AUTHORED_COMPUTE_WORK,
  LIVE_OPERATIONS_SERVICE_VALUE_MULTIPLIER,
} from "./liveOperations";
import { createInitialGameState } from "./progression";
import { deriveVisibleState } from "./selectors";
import { applyAction } from "./simulation";
import { deserializeSave, serializeSave } from "./save";
import { materializeSystem } from "./systems";
import { getWorkValueCredits } from "./workValue";
import { decideBalancePolicy } from "./balance/policy";
import type {
  ActionPolicyContext,
  EngagementProfileId,
} from "./balance/types";
import type { ContractOfferState, GameState } from "./types";

const BATCH_MS = 15 * 60 * 1_000;

const unlockedState = (): GameState => {
  const initial = createInitialGameState();
  const exactResources = exactResourceBag("1000000", "0");
  return {
    ...initial,
    exactResources,
    resources: { credits: 1_000_000, data: 0 },
    flags: { ...initial.flags, scheduler: true },
    research: {
      ...initial.research,
      completed: ["systemScheduler"],
    },
  };
};

const enabledState = (input: GameState = unlockedState()) => {
  let state = input;
  state = applyAction(state, {
    type: "configureLiveOperations",
    systemId: 1,
    maxCoreCount: 99,
  });
  return applyAction(state, {
    type: "setLiveOperationsEnabled",
    enabled: true,
  });
};

const rackState = (thermal = false): GameState => {
  const state = createRackReadyGameState();
  const exactResources = exactResourceBag("1000000000000000", "1000000");
  return {
    ...state,
    exactResources,
    resources: { credits: 1_000_000_000_000_000, data: 1_000_000 },
    flags: { ...state.flags, cooling: thermal || state.flags.cooling },
    research: {
      ...state.research,
      completed: thermal
        ? Array.from(
            new Set([...state.research.completed, "thermalControl" as const]),
          )
        : state.research.completed,
    },
  };
};

/**
 * C-State silicon makes idle cores draw less than active ones, so waking a
 * reserved core has a real incremental power cost for the lane to pay.
 */
const withCStateSilicon = (state: GameState, cStateLevel = 4): GameState => ({
  ...state,
  hardware: { ...state.hardware, cStateLevel },
  systems: state.systems.map((system) =>
    system.id === 1
      ? { ...system, hardware: { ...system.hardware, cStateLevel } }
      : system,
  ),
});

const reservationOffer = (): ContractOfferState => ({
  id: "live-ops-reservation",
  templateId: "ledgerAudit",
  kind: "sustained",
  name: "Reserved Lane",
  description: "Reserves the configured system.",
  systemId: 1,
  workRequiredMs: 60_000,
  expiresAtMs: 120_000,
  rewards: exactResourceBag("100", "0"),
  novel: true,
});

const policyContext = (
  state: GameState,
  profileId: EngagementProfileId,
): ActionPolicyContext => ({
  profileId,
  scheduleMode: "deterministic",
  sessionIndex: 0,
  sessionKind: "check-in",
  nowMs: 0,
  elapsedCalendarMs: 0,
  remainingActiveMs: 20 * 60_000,
  visible: deriveVisibleState(state),
});

describe("foreground Live Operations", () => {
  it("freezes authored work and payout independently of installed throughput", () => {
    const slow = enabledState();
    const fast = enabledState(rackState());
    const expectedWork = LIVE_OPERATIONS_AUTHORED_COMPUTE_WORK.liveQueueTriage;
    const expectedReward = getWorkValueCredits(
      expectedWork,
      LIVE_OPERATIONS_SERVICE_VALUE_MULTIPLIER,
    );

    expect(slow.liveOperations.runtime?.plan.work.compute).toBe(expectedWork);
    expect(fast.liveOperations.runtime?.plan.work.compute).toBe(expectedWork);
    expect(slow.liveOperations.runtime?.plan.reward.credits).toBe(expectedReward);
    expect(fast.liveOperations.runtime?.plan.reward.credits).toBe(expectedReward);
    expect(
      deriveVisibleState(fast).liveOperations.projectedDurationMs!,
    ).toBeLessThan(
      deriveVisibleState(slow).liveOperations.projectedDurationMs!,
    );
  });

  it("is locked until System Scheduler, clamps configuration, and alternates exact batches", () => {
    const locked = createInitialGameState();
    expect(deriveVisibleState(locked).liveOperations.unlocked).toBe(false);
    expect(
      applyAction(locked, {
        type: "configureLiveOperations",
        systemId: 1,
        maxCoreCount: 6,
      }),
    ).toEqual(locked);

    const state = enabledState();
    expect(state.liveOperations.maxCoreCount).toBe(1);
    const completed = advanceGame(state, BATCH_MS, "foreground");
    expect(completed.state.liveOperations.completions).toEqual({
      liveQueueTriage: 1,
    });
    expect(completed.state.liveOperations.activeTaskId).toBe(
      "liveCanaryValidation",
    );
    expect(completed.intervalReport.completionEvents).toEqual([
      expect.objectContaining({
        source: "live-operations",
        workId: "liveQueueTriage",
        creditsEarned: "2160",
        dataEarned: "0",
      }),
    ]);
  });

  it("retains partial progress and pays nothing while offline", () => {
    const state = enabledState();
    const partial = advanceGame(state, 1_000, "foreground").state;
    const before = partial.liveOperations;
    const offline = advanceGame(partial, 24 * 60 * 60 * 1_000, "offline");
    expect(offline.intervalReport.creditsEarned).toBe("0");
    expect(offline.state.liveOperations.runtime).toEqual(before.runtime);
    expect(offline.state.liveOperations.completions).toEqual(
      before.completions,
    );
    expect(offline.state.liveOperations.allocatedCoreIds).toEqual([]);
  });

  it("round-trips partial runtime and rejects invalid public configuration", () => {
    const partial = advanceGame(enabledState(), 1_000, "foreground").state;
    const restored = deserializeSave(serializeSave(partial, 123));
    expect(restored.liveOperations.runtime).toEqual(
      partial.liveOperations.runtime,
    );
    expect(
      applyAction(restored, {
        type: "configureLiveOperations",
        systemId: 999,
        maxCoreCount: 1,
      }),
    ).toEqual(restored);
    const malformed = deserializeSave(
      JSON.stringify({
        version: 7,
        state: {
          ...partial,
          liveOperations: {
            systemId: 1,
            maxCoreCount: -10,
            enabled: true,
            activeTaskId: "spoofed",
            runtime: null,
            completions: { liveQueueTriage: -2 },
          },
        },
      }),
    );
    expect(malformed.liveOperations.maxCoreCount).toBe(1);
    expect(malformed.liveOperations.activeTaskId).toBe("liveQueueTriage");
    expect(malformed.liveOperations.completions).toEqual({});
  });

  it("does not claim live output as standing-order or manual task output", () => {
    const result = advanceGame(enabledState(), BATCH_MS, "foreground");
    const events = result.intervalReport.completionEvents ?? [];
    expect(events.every((event) => event.source === "live-operations")).toBe(
      true,
    );
    expect(result.state.standingTaskCompletions).toEqual({});
    expect(result.intervalReport.completedWork).toEqual({
      liveQueueTriage: 1,
    });
  });

  it("loads the physical power/thermal/billing model and admits only <=85% PSU load", () => {
    const state = enabledState(withCStateSilicon(rackState(true)));
    const visible = deriveVisibleState(state).liveOperations;
    expect(visible.allocatedCoreCount).toBe(4);
    expect(amountCompare(visible.projectedPowerWatts, 0)).toBeGreaterThan(0);
    expect(amountCompare(visible.projectedOperatingCostCredits, 0)).toBeGreaterThan(
      0,
    );
    expect(getPsuStress(materializeSystem(state, 1))).toBeLessThanOrEqual(0.85);

    const advanced = advanceGame(state, 1_000, "foreground");
    expect(amountCompare(advanced.intervalReport.creditsSpent, 0)).toBeGreaterThan(
      0,
    );
    expect(
      amountCompare(
        advanced.state.workshop.thermal.sustainedHeatWatts,
        state.workshop.thermal.sustainedHeatWatts,
      ),
    ).toBeGreaterThan(0);

    const constrained: GameState = {
      ...state,
      hardware: { ...state.hardware, psuWatts: 0.000001 },
      systems: state.systems.map((system) =>
        system.id === 1
          ? {
              ...system,
              hardware: { ...system.hardware, psuWatts: 0.000001 },
            }
          : system,
      ),
    };
    expect(deriveVisibleState(constrained).liveOperations).toMatchObject({
      allocatedCoreCount: 0,
      blockedReason: "No idle core fits the 85% PSU safety limit.",
    });
  });

  it("gives ordinary tasks priority and suppresses allocation for contracts and projects", () => {
    const state = enabledState(rackState());
    expect(deriveVisibleState(state).liveOperations.allocatedCoreCount).toBe(4);
    const ordinary = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "fetchBit",
      coreId: 1,
      systemId: 1,
    });
    expect(deriveVisibleState(ordinary).liveOperations.allocatedCoreCount).toBe(3);

    const offer = reservationOffer();
    const contracted = acceptContract(
      { ...state, contracts: { ...state.contracts, offers: [offer] } },
      offer.id,
    );
    expect(deriveVisibleState(contracted).liveOperations).toMatchObject({
      allocatedCoreCount: 0,
      blockedReason: "A managed contract or project reserves this system.",
    });

    const projected: GameState = {
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
            systemId: 1,
          },
        },
      },
    };
    expect(deriveVisibleState(projected).liveOperations.allocatedCoreCount).toBe(0);
  });

  it("charges the lane only for the reserved cores' incremental draw, not the busy system's whole operating cost", () => {
    // Busy, expensive system: core 1 runs ordinary paid work while the lane
    // scavenges the remaining idle cores.
    const busy = applyAction(enabledState(withCStateSilicon(rackState())), {
      type: "startTaskOnCore",
      taskId: "fetchBit",
      coreId: 1,
      systemId: 1,
    });
    const visible = deriveVisibleState(busy).liveOperations;
    expect(visible.allocatedCoreCount).toBe(3);

    const local = materializeSystem(busy, 1);
    const withLane: GameState = {
      ...local,
      liveOperations: { ...local.liveOperations, allocatedCoreIds: [2, 3, 4] },
    };
    const atRest: GameState = {
      ...local,
      liveOperations: { ...local.liveOperations, allocatedCoreIds: [] },
    };
    const laneCostPerSecond = amountSubtract(
      getPowerCostPerSecondExact(withLane),
      getPowerCostPerSecondExact(atRest),
    );
    const lanePowerWatts = amountSubtract(
      getHardwareDrawWattsExact(withLane),
      getHardwareDrawWattsExact(atRest),
    );
    // The lane pays exactly for the draw it adds over the system at rest —
    // the same incremental basis the Power tile reports…
    expect(amountCompare(lanePowerWatts, 0)).toBeGreaterThan(0);
    expect(visible.projectedPowerWatts).toBe(lanePowerWatts);
    expect(
      amountToSafeNumber(visible.projectedOperatingCostCredits),
    ).toBeCloseTo(
      amountToSafeNumber(laneCostPerSecond) *
        (visible.projectedDurationMs! / 1000),
      9,
    );
    // …and never imports the whole system's operating cost into its net.
    const wholeSystemCost = amountMultiply(
      getPowerCostPerSecondExact(withLane),
      amountDivide(amount(visible.projectedDurationMs!), 1000),
    );
    expect(
      amountCompare(visible.projectedOperatingCostCredits, wholeSystemCost),
    ).toBeLessThan(0);
    expect(visible.projectedNetRewardCredits).toBe(
      amountSubtract(
        visible.projectedRewardCredits,
        visible.projectedOperatingCostCredits,
      ),
    );
  });

  it("prices the lane at zero when idle cores already draw full power", () => {
    // Without C-State silicon an idle core burns exactly what an active one
    // does, so scavenging it adds nothing to the bill the system pays anyway.
    const visible = deriveVisibleState(enabledState(rackState())).liveOperations;
    expect(visible.allocatedCoreCount).toBe(4);
    expect(visible.projectedOperatingCostCredits).toBe("0");
    expect(visible.projectedPowerWatts).toBe("0");
    expect(visible.projectedNetRewardCredits).toBe(visible.projectedRewardCredits);
    expect(visible.projectedMarginBps).toBe(10_000);
  });

  it("is exact across split advances and coexists with standing work without the bulk skip", () => {
    const state = enabledState();
    const oneShot = advanceGame(state, BATCH_MS, "foreground");
    const first = advanceGame(state, 300_000, "foreground");
    const second = advanceGame(first.state, 600_000, "foreground");
    expect(second.state).toEqual(oneShot.state);
    expect(
      amountAdd(first.intervalReport.creditsEarned, second.intervalReport.creditsEarned),
    ).toBe(oneShot.intervalReport.creditsEarned);
    expect(
      amountAdd(first.intervalReport.creditsSpent, second.intervalReport.creditsSpent),
    ).toBe(oneShot.intervalReport.creditsSpent);
    expect([
      ...(first.intervalReport.completionEvents ?? []),
      ...(second.intervalReport.completionEvents ?? []),
    ]).toEqual(oneShot.intervalReport.completionEvents);

    let standing = enabledState(rackState());
    standing = {
      ...standing,
      automationBuffer: {
        ownedLevelId: "cronRuntime",
        departureLevelId: "cronRuntime",
        offlineProcessedMs: 0,
      },
    };
    standing = applyAction(standing, {
      type: "setStandingOrder",
      taskId: "tinyChecksum",
      systemId: 1,
    });
    const remainingBefore = standing.liveOperations.runtime!.remainingWork.compute;
    const coexistence = advanceGame(standing, 10_000, "foreground");
    expect(coexistence.intervalReport.standingOrderRenewals).toBeGreaterThan(0);
    expect(
      amountCompare(
        coexistence.state.liveOperations.runtime!.remainingWork.compute,
        remainingBefore,
      ),
    ).toBeLessThan(0);
    expect(
      coexistence.state.activeTasks.some(
        (task) => task.workOrigin === "standing-order",
      ),
    ).toBe(true);
  });

  it("shows exact projection economics and honest paused, runway, and power blockers", () => {
    const unlocked = withCStateSilicon(rackState());
    expect(deriveVisibleState(unlocked).liveOperations.blockedReason).toBe(
      "Configure Live Operations on a system.",
    );
    const configured = applyAction(unlocked, {
      type: "configureLiveOperations",
      systemId: 1,
      maxCoreCount: 4,
    });
    expect(deriveVisibleState(configured).liveOperations.blockedReason).toBe(
      "Live Operations is paused.",
    );

    const state = applyAction(configured, {
      type: "setLiveOperationsEnabled",
      enabled: true,
    });
    const visible = deriveVisibleState(state).liveOperations;
    expect(visible.projectedNetRewardCredits).toBe(
      amountSubtract(
        visible.projectedRewardCredits,
        visible.projectedOperatingCostCredits,
      ),
    );
    expect(visible.projectedMarginBps).toBe(
      Math.trunc(
        amountToSafeNumber(
          amountMultiply(
            amountDivide(
              visible.projectedNetRewardCredits,
              visible.projectedRewardCredits,
            ),
            10_000,
          ),
        ),
      ),
    );

    const lowCredits = amountSubtract(
      visible.projectedOperatingCostCredits,
      "0.001",
    );
    const runwayBlocked: GameState = {
      ...state,
      exactResources: { ...state.exactResources, credits: lowCredits },
      resources: { ...state.resources, credits: Number(lowCredits) },
    };
    expect(deriveVisibleState(runwayBlocked).liveOperations).toMatchObject({
      allocatedCoreCount: 0,
      blockedReason: "Insufficient Credits for the remaining operating cost.",
    });
  });

  it("configures regular, engaged, and optimizer profiles but never full-idle", () => {
    const state = unlockedState();
    for (const profileId of ["regular", "engaged", "optimizer"] as const) {
      const decision = decideBalancePolicy(policyContext(state, profileId));
      expect(decision.actions).toContainEqual({
        type: "configureLiveOperations",
        systemId: 1,
        maxCoreCount: 1,
      });
      expect(decision.actions).toContainEqual({
        type: "setLiveOperationsEnabled",
        enabled: true,
      });
      expect(
        decision.audit.actionReasons.find(
          (reason) => reason.category === "live-operations",
        )?.manualDispatch,
      ).toBe(false);
    }
    expect(
      decideBalancePolicy(policyContext(state, "full-idle")).actions.some(
        (action) =>
          action.type === "configureLiveOperations" ||
          action.type === "setLiveOperationsEnabled",
      ),
    ).toBe(false);
  });

  it("rejects public attempts to dispatch internal Live Operations task ids", () => {
    const state = unlockedState();
    expect(
      applyAction(state, { type: "startTask", taskId: "liveQueueTriage" }),
    ).toEqual(state);
    expect(
      applyAction(state, { type: "queueTask", taskId: "liveCanaryValidation" }),
    ).toEqual(state);
  });
});
