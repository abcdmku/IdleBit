import { describe, expect, it } from "vitest";

import { advanceGame } from "./advance";
import { exactResourceBag } from "./amount";
import { getTaskDefinition } from "./content/tasks";
import {
  createInitialGameState,
  syncCoreSchedulers,
} from "./progression";
import { applyAction, tickGame } from "./simulation";
import { syncSelectedSystemRuntime } from "./systems";
import type { GameState } from "./types";

const ZERO_EVENTS = {
  psuOverload: 0,
  unpaidBill: 0,
  deadlockWipe: 0,
} as const;

const withGlobalOfflineBuffer = (state: GameState): GameState => ({
  ...state,
  automationBuffer: {
    ownedLevelId: "globalScheduler",
    departureLevelId: "globalScheduler",
    offlineProcessedMs: 0,
  },
});

const richState = (): GameState => {
  const initial = createInitialGameState();
  return {
    ...initial,
    exactResources: exactResourceBag("1000000000", "1000000000"),
    resources: { credits: 1_000_000_000, data: 1_000_000_000 },
    power: { ...initial.power, bootstrapGraceSeconds: 0 },
  };
};

const managedFailureState = () => {
  const initial = richState();
  return syncSelectedSystemRuntime({
    ...initial,
    flags: { ...initial.flags, psuManagement: true },
    research: {
      ...initial.research,
      completed: [...initial.research.completed, "psuManagement"],
    },
  });
};

let cachedDeadlockBoundary:
  | { before: GameState; deadlocked: GameState }
  | undefined;

const deadlockBoundary = () => {
  if (cachedDeadlockBoundary) return cachedDeadlockBoundary;
  const initial = richState();
  const byteCopy = getTaskDefinition("byteCopy");
  let state = syncSelectedSystemRuntime(
    syncCoreSchedulers({
      ...initial,
      flags: { ...initial.flags, basicQueue: true },
      research: { ...initial.research, completed: ["byteOperations"] },
      hardware: {
        ...initial.hardware,
        cores: 2,
        coreClockLevels: {
          ...initial.hardware.coreClockLevels,
          2: initial.hardware.clockLevel,
        },
        cacheBits: byteCopy.cacheNeedBits,
        cacheBytes: byteCopy.cacheNeedBytes,
        cpus: initial.hardware.cpus.map((cpu) =>
          cpu.id === 1
            ? {
                ...cpu,
                coreIds: [1, 2],
                cacheBits: byteCopy.cacheNeedBits,
                cacheBytes: byteCopy.cacheNeedBytes,
              }
            : cpu,
        ),
      },
    }),
  );
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
  for (let guard = 0; guard < 2_000; guard += 1) {
    const advanced = tickGame(state, 100);
    if (
      advanced.activeTasks.some((task) =>
        task.coreOperations.some((operation) => operation.status === "deadlocked"),
      )
    ) {
      cachedDeadlockBoundary = { before: state, deadlocked: advanced };
      return cachedDeadlockBoundary;
    }
    state = advanced;
  }
  throw new Error("Deadlock boundary fixture did not converge.");
};

const nearDeadlockFailure = () =>
  withGlobalOfflineBuffer(
    syncSelectedSystemRuntime({
      ...deadlockBoundary().before,
      deadlockPressureSeconds: 9.999,
      deadlockPressureResource: "cache",
      deadlockPressureCpuId: 1,
      deadlockProcessLockout: false,
    }),
  );

describe("advance destructive-event telemetry", () => {
  it("classifies committed foreground PSU, unpaid-bill, and deadlock wipes", () => {
    let overloaded = applyAction(managedFailureState(), {
      type: "startTask",
      taskId: "fetchBit",
    });
    overloaded = syncSelectedSystemRuntime({
      ...overloaded,
      hardware: { ...overloaded.hardware, psuWatts: 0.000000001 },
      power: { ...overloaded.power, overloadFailureSeconds: 9.999 },
    });
    const overloadReport = advanceGame(overloaded, 1_000, "foreground")
      .intervalReport;
    expect(overloadReport.destructiveEvents).toEqual({
      psuOverload: 1,
      unpaidBill: 0,
      deadlockWipe: 0,
    });
    expect(overloadReport.safelyAvoidedDestructiveEvents).toEqual(ZERO_EVENTS);

    let unpaid = applyAction(managedFailureState(), {
      type: "startTask",
      taskId: "fetchBit",
    });
    unpaid = syncSelectedSystemRuntime({
      ...unpaid,
      exactResources: exactResourceBag(0, unpaid.exactResources.data),
      resources: { ...unpaid.resources, credits: 0 },
      power: {
        ...unpaid.power,
        bootstrapGraceSeconds: 0,
        unpaidShutdownWarningSeconds: 0.001,
      },
    });
    const unpaidReport = advanceGame(unpaid, 1_000, "foreground").intervalReport;
    expect(unpaidReport.destructiveEvents).toEqual({
      psuOverload: 0,
      unpaidBill: 1,
      deadlockWipe: 0,
    });

    const deadlockReport = advanceGame(
      nearDeadlockFailure(),
      1_000,
      "foreground",
    ).intervalReport;
    expect(deadlockReport.destructiveEvents).toEqual({
      psuOverload: 0,
      unpaidBill: 0,
      deadlockWipe: 1,
    });
  });

  it("counts rolled-back offline candidates as avoided and merges them cumulatively", () => {
    const initial = nearDeadlockFailure();
    const first = advanceGame(initial, 1_000, "offline");

    expect(first.state.deadlockProcessLockout).toBe(false);
    expect(first.state.activeTasks).toEqual(initial.activeTasks);
    expect(first.intervalReport.destructiveEvents).toEqual(ZERO_EVENTS);
    expect(first.intervalReport.safelyAvoidedDestructiveEvents).toEqual({
      psuOverload: 0,
      unpaidBill: 0,
      deadlockWipe: 1,
    });
    expect(first.intervalReport.blockers).toContain(
      "Unsafe failure avoided while absent.",
    );

    const second = advanceGame(first.state, 1_000, "offline");
    expect(second.intervalReport.safelyAvoidedDestructiveEvents.deadlockWipe).toBe(
      1,
    );
    expect(second.report.safelyAvoidedDestructiveEvents.deadlockWipe).toBe(2);
    expect(second.report.destructiveEvents).toEqual(ZERO_EVENTS);
  });

  it("does not count an offline preflight blocker as committed or avoided", () => {
    const blocked = withGlobalOfflineBuffer(deadlockBoundary().deadlocked);
    const result = advanceGame(blocked, 1_000, "offline");

    expect(
      result.intervalReport.blockers.some((reason) =>
        reason.includes("deadlock"),
      ),
    ).toBe(true);
    expect(result.intervalReport.destructiveEvents).toEqual(ZERO_EVENTS);
    expect(result.intervalReport.safelyAvoidedDestructiveEvents).toEqual(
      ZERO_EVENTS,
    );
  });
});
