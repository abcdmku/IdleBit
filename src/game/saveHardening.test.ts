import { describe, expect, it } from "vitest";
import { ZERO_AMOUNT, amount, amountCompare } from "./amount";
import { createInitialGameState } from "./progression";
import { deserializeSave, serializeSave } from "./save";
import { tickGame } from "./simulation";
import type { ActiveCoreOperation, ActiveTask, GameState } from "./types";

/**
 * Round-trip helper: serialize a real state, corrupt the parsed envelope the
 * way a bad write / manual edit / older build would, and load it back.
 */
const corruptRoundTrip = (
  mutate: (state: Record<string, any>) => void,
  base: GameState = createInitialGameState(),
): GameState => {
  const envelope = JSON.parse(serializeSave(base)) as Record<string, any>;
  mutate(envelope.state);
  return deserializeSave(JSON.stringify(envelope));
};

const coreOperationFixture = (
  overrides: Partial<Record<keyof ActiveCoreOperation, unknown>> = {},
): Record<string, unknown> => ({
  coreId: 1,
  operationIndex: 0,
  operationId: "op-1",
  operationName: "Fetch",
  status: "running",
  memoryState: "ready",
  remainingCycles: "4",
  totalCycles: "4",
  remainingLoadCycles: "0",
  totalLoadCycles: "0",
  memoryReservedBits: 0,
  memoryReservedBytes: 0,
  ramBlocks: [],
  ramChannelCount: 1,
  lockResource: null,
  lockReason: null,
  deadlockSeconds: 0,
  ...overrides,
});

const activeTaskFixture = (
  overrides: Partial<Record<keyof ActiveTask, unknown>> = {},
): Record<string, unknown> => ({
  instanceId: "task-hardening-1",
  taskId: "fetchBit",
  jobId: "fetchBit",
  schedulerQueued: false,
  coreId: 1,
  assignedCoreIds: [1],
  coreOperations: [coreOperationFixture()],
  remainingCycles: "4",
  totalCycles: "4",
  ...overrides,
});

describe("save-v7 hardening", () => {
  describe("exact resources fall back per-resource (C-SIM-12)", () => {
    it("keeps a valid huge exact credit balance when exact data is corrupt", () => {
      const restored = corruptRoundTrip((state) => {
        state.resources = { credits: 1_000, data: 77 };
        state.exactResources = { credits: "1e400", data: { bogus: true } };
      });

      expect(amountCompare(restored.exactResources.credits, amount("1e400"))).toBe(0);
      expect(amountCompare(restored.exactResources.data, amount(77))).toBe(0);
    });

    it("keeps a valid huge exact data balance when exact credits are corrupt", () => {
      const restored = corruptRoundTrip((state) => {
        state.resources = { credits: 42, data: 5 };
        state.exactResources = { credits: Number.NaN, data: "1e400" };
      });

      expect(amountCompare(restored.exactResources.credits, amount(42))).toBe(0);
      expect(amountCompare(restored.exactResources.data, amount("1e400"))).toBe(0);
    });
  });

  describe("unknown operation statuses never mint rewards (C-SIM-13)", () => {
    it("normalizes an unknown status to running, not complete", () => {
      const restored = corruptRoundTrip((state) => {
        state.activeTasks = [
          activeTaskFixture({
            coreOperations: [coreOperationFixture({ status: "definitelyNotAStatus" })],
          }),
        ];
      });

      const operation = restored.activeTasks[0]?.coreOperations[0];
      expect(operation?.status).toBe("running");
      expect(amountCompare(operation!.remainingCycles, amount(4))).toBe(0);
    });

    it("downgrades a claimed complete status while work counters remain", () => {
      const restored = corruptRoundTrip((state) => {
        state.activeTasks = [
          activeTaskFixture({
            coreOperations: [
              coreOperationFixture({ status: "complete", remainingCycles: "4" }),
            ],
          }),
        ];
      });

      expect(restored.activeTasks[0]?.coreOperations[0]?.status).toBe("running");

      // The settle pass must not treat the restored task as finished work.
      const ticked = tickGame(restored, 100);
      expect(ticked.completedTasks.fetchBit ?? 0).toBe(0);
    });

    it("trusts complete only when the counters are exhausted", () => {
      const restored = corruptRoundTrip((state) => {
        state.activeTasks = [
          activeTaskFixture({
            remainingCycles: "0",
            coreOperations: [
              coreOperationFixture({
                status: "complete",
                memoryState: "idle",
                remainingCycles: "0",
                remainingLoadCycles: "0",
              }),
            ],
          }),
        ];
      });

      expect(restored.activeTasks[0]?.coreOperations[0]?.status).toBe("complete");
    });
  });

  describe("every saved system is fully normalized (C-SIM-14)", () => {
    it("normalizes active-task operations on a non-selected system", () => {
      const base = createInitialGameState();
      const restored = corruptRoundTrip((state) => {
        state.systems = [
          ...state.systems,
          {
            ...state.systems[0],
            id: 2,
            name: "Second rig",
            activeTasks: [
              activeTaskFixture({
                coreOperations: [
                  coreOperationFixture({
                    status: "mystery",
                    remainingCycles: "garbage",
                    deadlockSeconds: "soon",
                  }),
                ],
              }),
            ],
          },
        ];
      }, base);

      const secondSystem = restored.systems.find((system) => system.id === 2);
      expect(secondSystem).toBeDefined();
      const operation = secondSystem?.activeTasks[0]?.coreOperations[0];
      expect(operation).toBeDefined();
      expect(operation?.status).toBe("running");
      expect(amountCompare(operation!.remainingCycles, ZERO_AMOUNT)).toBe(0);
      expect(amountCompare(operation!.totalCycles, amount(4))).toBe(0);
      expect(operation?.deadlockSeconds).toBe(0);
    });

    it("drops stale parent references from a non-selected system's tasks", () => {
      const restored = corruptRoundTrip((state) => {
        state.systems = [
          ...state.systems,
          {
            ...state.systems[0],
            id: 2,
            name: "Second rig",
            activeTasks: [
              activeTaskFixture({ parentTaskId: "removedLegacyTask" }),
            ],
            queueEntries: [
              {
                id: "sys2-q1",
                taskId: "fetchBit",
                target: "cpu",
                parentTaskId: "removedLegacyTask",
              },
            ],
          },
        ];
      });

      const secondSystem = restored.systems.find((system) => system.id === 2);
      expect(secondSystem?.activeTasks).toEqual([]);
      expect(secondSystem?.queueEntries).toEqual([]);
    });
  });

  describe("non-object entries are discarded instead of resetting the save (F-PER-1)", () => {
    it("loads a save with null/primitive systems[] entries without a clean reset", () => {
      const restored = corruptRoundTrip((state) => {
        state.resources = { credits: 555, data: 5 };
        state.exactResources = { credits: "555", data: "5" };
        state.systems = [null, 42, ...state.systems];
      });

      expect(restored.resources.credits).toBe(555);
      expect(restored.systems).toHaveLength(1);
      expect(restored.systems[0]?.id).toBe(1);
    });

    it("loads a save with null hardware.cpus[] entries without a clean reset", () => {
      const restored = corruptRoundTrip((state) => {
        state.resources = { credits: 555, data: 5 };
        state.exactResources = { credits: "555", data: "5" };
        state.hardware.cpus = [null, ...state.hardware.cpus];
        state.systems = state.systems.map((system: Record<string, any>) => ({
          ...system,
          hardware: { ...system.hardware, cpus: [null, ...system.hardware.cpus] },
        }));
      });

      expect(restored.resources.credits).toBe(555);
      expect(restored.hardware.cpus.length).toBeGreaterThanOrEqual(1);
      expect(restored.hardware.cpus[0]?.coreIds.length).toBeGreaterThanOrEqual(1);
    });

    it("falls back to a default package when every cpu entry is invalid", () => {
      const restored = corruptRoundTrip((state) => {
        state.resources = { credits: 555, data: 5 };
        state.exactResources = { credits: "555", data: "5" };
        state.hardware.cpus = [null, "socket"];
      });

      expect(restored.resources.credits).toBe(555);
      expect(restored.hardware.cpus).toHaveLength(1);
      expect(restored.hardware.cpus[0]?.coreIds).toContain(1);
    });
  });

  describe("stale parent/child references are sanitized (F-PER-3)", () => {
    it("drops queue entries whose parent task or parent entry is stale", () => {
      const restored = corruptRoundTrip((state) => {
        state.queueEntries = [
          { id: "q1", taskId: "fetchBit", target: "cpu" },
          {
            id: "q2",
            taskId: "fetchBit",
            target: "cpu",
            parentTaskId: "removedLegacyTask",
          },
          {
            id: "q3",
            taskId: "fetchBit",
            target: "cpu",
            parentQueueEntryId: "missing-entry",
          },
          {
            id: "q4",
            taskId: "fetchBit",
            target: "cpu",
            childTaskId: "removedLegacyTask",
          },
        ];
      });

      expect(restored.queueEntries?.map((entry) => entry.id)).toEqual([
        "q1",
        "q4",
      ]);
      expect(
        restored.queueEntries?.find((entry) => entry.id === "q4")?.childTaskId,
      ).toBeNull();
    });

    it("drops active child tasks with stale parent references and nulls stale child ids", () => {
      const restored = corruptRoundTrip((state) => {
        state.queueEntries = [{ id: "q1", taskId: "fetchBit", target: "cpu" }];
        state.activeTasks = [
          activeTaskFixture({
            instanceId: "keeper",
            childTaskId: "removedLegacyTask",
          }),
          activeTaskFixture({
            instanceId: "stale-parent-task",
            parentTaskId: "removedLegacyTask",
          }),
          activeTaskFixture({
            instanceId: "stale-parent-entry",
            parentTaskId: "fetchBit",
            parentQueueEntryId: "missing-entry",
          }),
        ];
      });

      expect(restored.activeTasks.map((task) => task.instanceId)).toEqual([
        "keeper",
      ]);
      expect(restored.activeTasks[0]?.childTaskId).toBeNull();

      // The restored state must tick without an "Unknown task" throw.
      expect(() => tickGame(restored, 100)).not.toThrow();
    });

    it("keeps child tasks whose parent entry survived the same load", () => {
      const restored = corruptRoundTrip((state) => {
        state.queueEntries = [
          { id: "parent-entry", taskId: "fetchBit", target: "system" },
        ];
        state.activeTasks = [
          activeTaskFixture({
            instanceId: "linked-child",
            parentTaskId: "fetchBit",
            parentQueueEntryId: "parent-entry",
          }),
        ];
      });

      expect(restored.activeTasks.map((task) => task.instanceId)).toEqual([
        "linked-child",
      ]);
      expect(restored.activeTasks[0]?.parentQueueEntryId).toBe("parent-entry");
    });
  });

  describe("scalar fields are coerced to valid numbers (F-PER-6)", () => {
    it("repairs corrupt counters instead of carrying NaN/garbage for a session", () => {
      const restored = corruptRoundTrip((state) => {
        state.cron.nextScheduleId = "nan-maker";
        state.power.failureCount = "many";
        state.deadlockPressureSeconds = -99;
        state.nextInstanceId = "x";
        state.systems = state.systems.map((system: Record<string, any>) => ({
          ...system,
          deadlockPressureSeconds: -5,
          cron: { ...system.cron, nextScheduleId: "bogus" },
        }));
      });

      expect(Number.isInteger(restored.cron.nextScheduleId)).toBe(true);
      expect(restored.cron.nextScheduleId).toBeGreaterThanOrEqual(1);
      expect(restored.power.failureCount).toBe(0);
      expect(restored.deadlockPressureSeconds).toBe(0);
      expect(Number.isInteger(restored.nextInstanceId)).toBe(true);
      expect(restored.nextInstanceId).toBeGreaterThanOrEqual(1);
      for (const system of restored.systems) {
        expect(system.deadlockPressureSeconds).toBe(0);
        expect(Number.isInteger(system.cron.nextScheduleId)).toBe(true);
        expect(system.cron.nextScheduleId).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
