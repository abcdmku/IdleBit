import { describe, expect, it } from "vitest";

import { advanceGame } from "./advance";
import { amountCompare, exactResourceBag } from "./amount";
import { acceptContract } from "./contracts";
import {
  createHardwareWorkRecipe,
  createHardwareWorkStage,
} from "./hardwareWork";
import { getHardwareDrawWatts, getPsuStress } from "./math";
import { createInitialGameState } from "./progression";
import { applyAction } from "./simulation";
import { syncSelectedSystemRuntime } from "./systems";
import type { AdvanceReport, ContractOfferState, GameState } from "./types";

const advanceInChunks = (initial: GameState, chunks: readonly number[]) => {
  let state = initial;
  const reports: AdvanceReport[] = [];
  for (const elapsedMs of chunks) {
    const result = advanceGame(state, elapsedMs, "foreground");
    state = result.state;
    reports.push(result.intervalReport);
  }
  return { state, reports };
};

const psuManagedState = (): GameState => {
  const initial = createInitialGameState();
  return syncSelectedSystemRuntime({
    ...initial,
    exactResources: exactResourceBag("1000000000", "1000000000"),
    resources: { credits: 1_000_000_000, data: 1_000_000_000 },
    flags: { ...initial.flags, psuManagement: true },
    research: {
      ...initial.research,
      completed: [...initial.research.completed, "psuManagement"],
    },
    power: { ...initial.power, bootstrapGraceSeconds: 0 },
  });
};

describe("power lifecycle delta-invariance", () => {
  it("bills a boot transition at the pre-transition rate in any partition", () => {
    const initial = syncSelectedSystemRuntime({
      ...psuManagedState(),
      power: {
        ...psuManagedState().power,
        state: "booting" as const,
        transitionSeconds: 10,
        transitionTotalSeconds: 10,
      },
    });

    const oneShot = advanceGame(initial, 10_000, "foreground");
    const chunked = advanceInChunks(
      initial,
      Array.from({ length: 10 }, () => 1_000),
    );

    expect(oneShot.state.power.state).toBe("on");
    expect(chunked.state.power.state).toBe("on");
    expect(oneShot.state.exactResources.credits).toBe(
      chunked.state.exactResources.credits,
    );
    expect(oneShot.state).toEqual(chunked.state);
    // The boot interval must actually bill (0.35x draw), not zero and not
    // the full on-state rate for the completing slice.
    expect(
      amountCompare(
        oneShot.state.exactResources.credits,
        initial.exactResources.credits,
      ),
    ).toBeLessThan(0);
  });

  it("shuts down at zero invariantly without PSU Management", () => {
    // Fresh save: 10 credits, 0.1 uW idle draw = 0.1 cr/s, no PSU Management.
    // The wallet exhausts at t=100s, strictly inside every coarse chunk.
    const initial = createInitialGameState();

    const oneShot = advanceGame(initial, 180_000, "foreground");
    const chunked = advanceInChunks(initial, [70_000, 110_000]);
    const fine = advanceInChunks(
      initial,
      Array.from({ length: 18 }, () => 10_000),
    );

    expect(amountCompare(oneShot.state.exactResources.credits, 0)).toBe(0);
    expect(oneShot.state.power.state).toBe("off");
    expect(oneShot.state.power.unpaidShutdownWarningSeconds).toBe(0);
    expect(oneShot.state.power.lastFailureReason).toBe("unpaidBill");
    expect(oneShot.state).toEqual(chunked.state);
    expect(oneShot.state).toEqual(fine.state);
  });

  it("carries bootstrap-grace overshoot into the unpaid warning instead of granting a fresh one", () => {
    const base = psuManagedState();
    const initial = syncSelectedSystemRuntime({
      ...base,
      exactResources: exactResourceBag("0", "0"),
      resources: { credits: 0, data: 0 },
      power: { ...base.power, bootstrapGraceSeconds: 10 },
    });

    const oneShot = advanceGame(initial, 20_000, "foreground");
    const split = advanceInChunks(initial, [10_000, 10_000]);
    const uneven = advanceInChunks(initial, [4_000, 12_000, 4_000]);

    expect(split.state.power.state).toBe("off");
    expect(split.state.power.lastFailureReason).toBe("unpaidBill");
    expect(oneShot.state).toEqual(split.state);
    expect(uneven.state).toEqual(split.state);
  });

  it("applies the unpaid cutoff at the deadline endpoint after the interval's work", () => {
    const base = psuManagedState();
    let initial = applyAction(base, { type: "startTask", taskId: "fetchBit" });
    initial = syncSelectedSystemRuntime({
      ...initial,
      exactResources: exactResourceBag("0", initial.exactResources.data),
      resources: { ...initial.resources, credits: 0 },
      power: {
        ...initial.power,
        bootstrapGraceSeconds: 0,
        unpaidShutdownWarningSeconds: 10,
      },
    });

    const oneShot = advanceGame(initial, 20_000, "foreground");
    const chunked = advanceInChunks(initial, [5_000, 5_000, 5_000, 5_000]);

    expect(oneShot.state).toEqual(chunked.state);
    // fetchBit finishes well inside the 10 s warning window; its completion
    // (and settlement) must not be destroyed by the cutoff check that begins
    // the same slice.
    expect(oneShot.state.completedTasks.fetchBit ?? 0).toBeGreaterThan(0);
  });

  it("forces PSU-overload power-off at the exact failure boundary in any partition", () => {
    const base = psuManagedState();
    let initial = applyAction(
      syncSelectedSystemRuntime({
        ...base,
        research: {
          ...base.research,
          completed: [...base.research.completed, "byteOperations"],
        },
        hardware: {
          ...base.hardware,
          cacheBits: 64,
          cacheBytes: 8,
          cpus: base.hardware.cpus.map((cpu) =>
            cpu.id === 1 ? { ...cpu, cacheBits: 64, cacheBytes: 8 } : cpu,
          ),
        },
      }),
      { type: "startTask", taskId: "byteCopy" },
    );
    expect(initial.activeTasks).toHaveLength(1);
    // Stress the PSU so overload accrues while the task holds the system
    // under load; the failure boundary lands strictly inside a long slice.
    initial = syncSelectedSystemRuntime({
      ...initial,
      hardware: {
        ...initial.hardware,
        psuWatts: getHardwareDrawWatts(initial) / 4,
      },
    });
    expect(getPsuStress(initial)).toBeGreaterThan(1);

    const oneShot = advanceGame(initial, 30_000, "foreground");
    const chunked = advanceInChunks(initial, [7_000, 23_000]);
    const fine = advanceInChunks(
      initial,
      Array.from({ length: 30 }, () => 1_000),
    );

    expect(oneShot.state.power.state).toBe("off");
    expect(oneShot.state.power.lastFailureReason).toBe("psuOverload");
    expect(oneShot.state.activeTasks).toHaveLength(0);
    expect(oneShot.state).toEqual(chunked.state);
    expect(oneShot.state).toEqual(fine.state);
  });
});

const contractOffer = (): ContractOfferState => ({
  id: "warning-window-probe",
  templateId: "ledgerAudit",
  kind: "sustained",
  name: "Warning window probe",
  description: "Managed work rated over the unpaid warning window.",
  systemId: 1,
  workRequiredMs: 60_000,
  workRecipe: createHardwareWorkRecipe([
    createHardwareWorkStage("compute", "compute", 60),
  ]),
  expiresAtMs: 600_000,
  rewards: exactResourceBag("100", "0"),
  novel: true,
});

describe("managed work delta-invariance", () => {
  it("credits contract work with the rates that held over the slice, through the unpaid cutoff", () => {
    const base = psuManagedState();
    const accepted = acceptContract(
      {
        ...base,
        contracts: { ...base.contracts, offers: [contractOffer()] },
      },
      "warning-window-probe",
    );
    const initial = syncSelectedSystemRuntime({
      ...accepted,
      exactResources: exactResourceBag("0", "0"),
      resources: { credits: 0, data: 0 },
      power: {
        ...accepted.power,
        bootstrapGraceSeconds: 0,
        unpaidShutdownWarningSeconds: 10,
      },
    });
    expect(initial.contracts.active).toHaveLength(1);

    const oneShot = advanceGame(initial, 20_000, "foreground");
    const chunked = advanceInChunks(initial, [5_000, 5_000, 5_000, 5_000]);

    expect(oneShot.state).toEqual(chunked.state);
    // The system ran for the full 10 s warning window before the cutoff, so
    // exactly that much contract work settles regardless of partitioning.
    expect(oneShot.state.contracts.active[0]?.workCompletedMs).toBe(10_000);
    expect(oneShot.state.power.state).toBe("off");
    expect(oneShot.state.power.lastFailureReason).toBe("unpaidBill");
  });
});

describe("deadlock recovery delta-invariance", () => {
  const lockedOutQueueState = (): GameState => {
    const initial = createInitialGameState();
    let state: GameState = syncSelectedSystemRuntime({
      ...initial,
      flags: { ...initial.flags, basicQueue: true },
      hardware: { ...initial.hardware, schedulerSlots: 1 },
    });
    state = applyAction(state, { type: "queueTask", taskId: "fetchBit" });
    expect(state.queue).toHaveLength(1);
    return syncSelectedSystemRuntime({
      ...state,
      deadlockPressureSeconds: 10,
      deadlockPressureResource: "ram" as const,
      deadlockPressureCpuId: null,
      deadlockProcessLockout: true,
    });
  };

  it("restarts queued work after the ~10s cooldown regardless of foreground chunking", () => {
    const initial = lockedOutQueueState();

    const oneShot = advanceGame(initial, 60_000, "foreground");
    const chunked = advanceInChunks(initial, [30_000, 30_000]);

    expect(oneShot.state.deadlockProcessLockout).toBe(false);
    expect(oneShot.state.completedTasks.fetchBit ?? 0).toBeGreaterThan(0);
    expect(oneShot.state).toEqual(chunked.state);
  });

  it("resumes the queue after the cooldown during an offline absence instead of stalling", () => {
    const initial: GameState = {
      ...lockedOutQueueState(),
      automationBuffer: {
        ownedLevelId: "globalScheduler",
        departureLevelId: "globalScheduler",
        offlineProcessedMs: 0,
      },
    };

    const result = advanceGame(initial, 60 * 60 * 1_000, "offline");

    expect(result.state.deadlockProcessLockout).toBe(false);
    expect(result.state.completedTasks.fetchBit ?? 0).toBeGreaterThan(0);
    expect(result.intervalReport.productiveMs).toBeGreaterThan(0);
    expect(result.intervalReport.pausedMs).toBeLessThan(60 * 60 * 1_000);
  });
});

describe("cache contention delta-invariance", () => {
  it("rates concurrent cache loads from the common pre-slice state in any partition", () => {
    const initial = createInitialGameState();
    let state: GameState = syncSelectedSystemRuntime({
      ...initial,
      exactResources: exactResourceBag("1000000", "0"),
      resources: { credits: 1_000_000, data: 0 },
      research: {
        ...initial.research,
        completed: [...initial.research.completed, "byteOperations"],
      },
      hardware: {
        ...initial.hardware,
        cores: 2,
        coreClockLevels: {
          ...initial.hardware.coreClockLevels,
          2: initial.hardware.clockLevel,
        },
        cacheBits: 64,
        cacheBytes: 8,
        cpus: initial.hardware.cpus.map((cpu) =>
          cpu.id === 1
            ? { ...cpu, coreIds: [1, 2], cacheBits: 64, cacheBytes: 8 }
            : cpu,
        ),
      },
    });
    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "byteCopy",
      coreId: 1,
    });
    // Stagger the second loader so the first completes strictly earlier.
    state = advanceGame(state, 500, "foreground").state;
    state = applyAction(state, {
      type: "startTaskOnCore",
      taskId: "byteCopy",
      coreId: 2,
    });
    expect(state.activeTasks).toHaveLength(2);

    // The first task completes at t=31,000 while the second still loads; the
    // horizon lands between the completion times that staged (slice-end)
    // contention rating and pre-slice contention rating would produce.
    const oneShot = advanceGame(state, 31_250, "foreground");
    const chunked = advanceInChunks(state, [16_000, 15_250]);
    const fine = advanceInChunks(state, [
      ...Array.from({ length: 62 }, () => 500),
      250,
    ]);

    expect(oneShot.state).toEqual(chunked.state);
    expect(oneShot.state).toEqual(fine.state);
    // Exactly one loader has finished; the survivor still pays the shared
    // cache-bandwidth price for the interval its neighbour was loading.
    expect(oneShot.state.completedTasks.byteCopy ?? 0).toBe(1);
    expect(oneShot.state.activeTasks).toHaveLength(1);
  });
});
