import { describe, expect, it } from "vitest";
import { applyAction, createRackReadyGameState, tickGame } from "./index";
import { getQueueEntryDispatchBlockedReason } from "./simulation";
import type { GameState, TaskId, TaskQueueEntry } from "./types";

const getLocalEntries = (state: GameState) =>
  Object.entries(state.coreSchedulers).flatMap(([coreId, scheduler]) =>
    (scheduler.localQueueEntries ?? []).map((entry) => ({
      coreId: Number(coreId),
      entry,
    })),
  );

const getCpuIdForCoreId = (state: GameState, coreId: number) =>
  state.hardware.cpus.find((cpu) => cpu.coreIds.includes(coreId))?.id ?? null;

const getLocalEntriesForTask = (state: GameState, taskId: TaskId) =>
  getLocalEntries(state).filter(({ entry }) => entry.taskId === taskId);

/** Every top-level cpu entry must be backed by a live local reservation. */
const expectNoOrphanTopLevelEntries = (state: GameState) => {
  const localReservationIds = new Set(
    getLocalEntries(state).map(
      ({ entry }) => entry.reservationId ?? entry.id,
    ),
  );
  for (const entry of state.queueEntries ?? []) {
    if (entry.target !== "cpu") continue;
    expect(localReservationIds.has(entry.id)).toBe(true);
  }
};

/** Every local reservation must map back to a top-level entry or parent. */
const expectNoGhostLocalEntries = (state: GameState) => {
  const topLevelIds = new Set((state.queueEntries ?? []).map((e) => e.id));
  for (const { entry } of getLocalEntries(state)) {
    if (entry.parentQueueEntryId) {
      expect(topLevelIds.has(entry.parentQueueEntryId)).toBe(true);
      continue;
    }
    expect(topLevelIds.has(entry.reservationId ?? entry.id)).toBe(true);
  }
};

const withSingleRamStick = (state: GameState, bits: number): GameState =>
  tickGame(
    {
      ...state,
      hardware: {
        ...state.hardware,
        ramSticks: [state.hardware.ramSticks[0]!].map((stick) => ({
          ...stick,
          bits,
          bytes: Math.ceil(bits / 8),
        })),
        ramBits: bits,
        ramBytes: Math.ceil(bits / 8),
      },
    },
    0,
  );

const withSystemSchedulerCapacity = (
  state: GameState,
  systemSchedulerSlots: number,
): GameState => {
  const hardware = {
    ...state.hardware,
    systemSchedulerSlots,
  };

  return {
    ...state,
    hardware,
    systems: state.systems.map((system) =>
      system.id === state.selectedSystemId
        ? { ...system, hardware }
        : system,
    ),
  };
};

describe("scheduler queue lifecycle", () => {
  describe("F-SCH-1: enqueue reservations are atomic", () => {
    it("reserves on a CPU with free slots while deadlock recovery blocks dispatch", () => {
      let state = createRackReadyGameState();

      // Fill CPU 1's two scheduler slots.
      state = applyAction(state, { type: "queueTask", taskId: "byteCopy", cpuId: 1 });
      state = applyAction(state, { type: "queueTask", taskId: "byteCopy", cpuId: 1 });
      expect(getLocalEntriesForTask(state, "byteCopy")).toHaveLength(2);

      // Recovery lockout blocks dispatch on every CPU, but reservations stay legal.
      state = {
        ...state,
        deadlockPressureSeconds: 5,
        deadlockProcessLockout: true,
      };

      state = applyAction(state, { type: "queueTask", taskId: "fetchBit" });

      expect(state.queue).toContain("fetchBit");
      const fetchBitEntries = getLocalEntriesForTask(state, "fetchBit");
      expect(fetchBitEntries).toHaveLength(1);
      expect(getCpuIdForCoreId(state, fetchBitEntries[0]!.coreId)).toBe(2);
      expectNoOrphanTopLevelEntries(state);

      // Once the lockout drains, the parked entry dispatches and completes.
      let guard = 0;
      while ((state.completedTasks.fetchBit ?? 0) < 1 && guard < 600) {
        state = tickGame(state, 1000);
        guard += 1;
      }
      expect(state.completedTasks.fetchBit ?? 0).toBeGreaterThanOrEqual(1);
    });

    it("never leaves a top-level entry without a local reservation after queueing", () => {
      let state = createRackReadyGameState();
      state = {
        ...state,
        deadlockPressureSeconds: 5,
        deadlockProcessLockout: true,
      };

      for (let index = 0; index < 8; index += 1) {
        state = applyAction(state, { type: "queueTask", taskId: "byteCopy" });
      }

      expectNoOrphanTopLevelEntries(state);
      expectNoGhostLocalEntries(state);
    });
  });

  describe("C-SIM-4 / F-SCH-2: no reservations on unprovisionable CPUs", () => {
    it("keeps multi-core system children off a CPU with too few permanent cores", () => {
      let state = createRackReadyGameState();

      // CPU 2 keeps its scheduler slots but drops to a single permanent core.
      state = tickGame(
        {
          ...state,
          hardware: {
            ...state.hardware,
            cpus: state.hardware.cpus.map((cpu) =>
              cpu.id === 2 ? { ...cpu, coreIds: [3] } : cpu,
            ),
            cores: 3,
          },
        },
        0,
      );
      expect(
        state.hardware.cpus.find((cpu) => cpu.id === 2)?.coreIds,
      ).toEqual([3]);

      // Fill CPU 1's slots so the old placement logic would fall through to
      // CPU 2 — the only remaining slot-holder, which can never run a
      // two-core child.
      state = applyAction(state, { type: "queueTask", taskId: "byteCopy", cpuId: 1 });
      state = applyAction(state, { type: "queueTask", taskId: "byteCopy", cpuId: 1 });
      state = applyAction(state, { type: "queueTask", taskId: "busMirror" });
      state = tickGame(state, 16);

      // The two-core readBusWindow child must not be parked on CPU 2.
      const childCores = getLocalEntriesForTask(state, "readBusWindow").map(
        ({ coreId }) => getCpuIdForCoreId(state, coreId),
      );
      expect(childCores).not.toContain(2);

      // Once CPU 1 frees up, the child reserves and dispatches there.
      let guard = 0;
      while (
        !state.activeTasks.some((task) => task.taskId === "readBusWindow") &&
        guard < 600
      ) {
        state = tickGame(state, 1000);
        guard += 1;
      }
      const child = state.activeTasks.find(
        (task) => task.taskId === "readBusWindow",
      );
      expect(child).toBeDefined();
      for (const coreId of child!.assignedCoreIds) {
        expect(getCpuIdForCoreId(state, coreId)).toBe(1);
      }
    });

    it("rehomes a waiting reservation stranded on an unprovisionable CPU", () => {
      let state = createRackReadyGameState();

      // Occupy CPU 1's cores so the queued task stays waiting there.
      state = applyAction(state, {
        type: "startTaskOnCore",
        taskId: "readRamPage",
        coreId: 1,
      });
      state = applyAction(state, {
        type: "startTaskOnCore",
        taskId: "readRamPage",
        coreId: 2,
      });
      state = applyAction(state, { type: "queueTask", taskId: "busMirror" });
      state = tickGame(state, 16);

      // Simulate a legacy save: CPU 2 shrinks to one core while a two-core
      // child reservation sits on core 3.
      const strandedBefore = getLocalEntriesForTask(state, "readBusWindow");
      if (strandedBefore.length === 0) {
        // Child not reserved yet in this configuration; force one tick more.
        state = tickGame(state, 16);
      }
      state = tickGame(
        {
          ...state,
          hardware: {
            ...state.hardware,
            cpus: state.hardware.cpus.map((cpu) =>
              cpu.id === 2 ? { ...cpu, coreIds: [3] } : cpu,
            ),
            cores: 3,
          },
        },
        16,
      );

      // After the rehome pass, no child reservation may remain on CPU 2.
      const stranded = getLocalEntriesForTask(state, "readBusWindow").map(
        ({ coreId }) => getCpuIdForCoreId(state, coreId),
      );
      expect(stranded).not.toContain(2);
      // The parent job survives the migration.
      expect(
        (state.queueEntries ?? []).some((entry) => entry.taskId === "busMirror"),
      ).toBe(true);
      expectNoGhostLocalEntries(state);
    });
  });

  describe("C-SIM-5: non-repeatable tasks admit one pending instance", () => {
    it("rejects queueing a duplicate while a copy is queued or active", () => {
      let state = createRackReadyGameState();
      state = { ...state, completedBenchmarks: [] };

      state = applyAction(state, { type: "queueTask", taskId: "microBenchmark" });
      expect(
        state.queue.filter((taskId) => taskId === "microBenchmark"),
      ).toHaveLength(1);

      const queuedAgain = applyAction(state, {
        type: "queueTask",
        taskId: "microBenchmark",
      });
      expect(
        queuedAgain.queue.filter((taskId) => taskId === "microBenchmark"),
      ).toHaveLength(1);

      const startedWhileQueued = applyAction(state, {
        type: "startTask",
        taskId: "microBenchmark",
      });
      expect(
        startedWhileQueued.queue.filter((taskId) => taskId === "microBenchmark")
          .length +
          startedWhileQueued.activeTasks.filter(
            (task) => task.taskId === "microBenchmark",
          ).length,
      ).toBe(1);
    });

    it("rejects starting a duplicate while a copy is active", () => {
      let state = createRackReadyGameState();
      state = { ...state, completedBenchmarks: [] };

      state = applyAction(state, { type: "startTask", taskId: "microBenchmark" });
      expect(
        state.activeTasks.filter((task) => task.taskId === "microBenchmark"),
      ).toHaveLength(1);

      const duplicated = applyAction(state, {
        type: "startTask",
        taskId: "microBenchmark",
      });
      expect(
        duplicated.activeTasks.filter(
          (task) => task.taskId === "microBenchmark",
        ),
      ).toHaveLength(1);
      expect(
        duplicated.queue.filter((taskId) => taskId === "microBenchmark"),
      ).toHaveLength(0);
    });

    it("releases a legacy stranded duplicate when the unique completion settles", () => {
      let state = createRackReadyGameState();
      state = { ...state, completedBenchmarks: [] };
      state = applyAction(state, { type: "startTask", taskId: "microBenchmark" });
      expect(
        state.activeTasks.filter((task) => task.taskId === "microBenchmark"),
      ).toHaveLength(1);

      // Inject a pre-fix duplicate reservation (as an old save could contain).
      const duplicateTop: TaskQueueEntry = {
        id: "cpu-queue-9801",
        taskId: "microBenchmark",
        target: "cpu",
      };
      const duplicateLocal: TaskQueueEntry = {
        id: "cpu-queue-9802",
        reservationId: "cpu-queue-9801",
        taskId: "microBenchmark",
        target: "cpu",
      };
      const scheduler = state.coreSchedulers[3]!;
      state = tickGame(
        {
          ...state,
          queue: [...state.queue, "microBenchmark"],
          queueEntries: [...(state.queueEntries ?? []), duplicateTop],
          coreSchedulers: {
            ...state.coreSchedulers,
            3: {
              ...scheduler,
              localQueue: [...scheduler.localQueue, "microBenchmark"],
              localQueueEntries: [
                ...(scheduler.localQueueEntries ?? []),
                duplicateLocal,
              ],
            },
          },
        },
        0,
      );

      // While the unique copy runs, the duplicate must not dual-dispatch.
      state = tickGame(state, 500);
      expect(
        state.activeTasks.filter((task) => task.taskId === "microBenchmark"),
      ).toHaveLength(1);

      // Completion settles the benchmark and releases the stranded duplicate.
      let guard = 0;
      while ((state.completedTasks.microBenchmark ?? 0) < 1 && guard < 600) {
        state = tickGame(state, 1000);
        guard += 1;
      }
      expect(state.completedTasks.microBenchmark ?? 0).toBe(1);
      expect(
        (state.queueEntries ?? []).filter(
          (entry) => entry.taskId === "microBenchmark",
        ),
      ).toHaveLength(0);
      expect(getLocalEntriesForTask(state, "microBenchmark")).toHaveLength(0);
      expect(
        state.queue.filter((taskId) => taskId === "microBenchmark"),
      ).toHaveLength(0);
    });
  });

  describe("F-PLAY-2: RAM-starved queued work exposes a blocked reason", () => {
    it("labels an entry blocked behind RAM staging pressure", () => {
      let state = withSystemSchedulerCapacity(createRackReadyGameState(), 3);
      state = withSingleRamStick(state, 512);

      for (let index = 0; index < 3; index += 1) {
        state = applyAction(state, { type: "queueTask", taskId: "readRamPage" });
      }
      state = tickGame(state, 16);

      // Two copies stage 256 bits each; the third waits on staging headroom.
      const activeParentIds = new Set(
        state.activeTasks
          .map((task) => task.parentQueueEntryId)
          .filter((id): id is string => Boolean(id)),
      );
      expect(activeParentIds.size).toBe(2);
      const waiting = (state.queueEntries ?? []).find(
        (entry) =>
          entry.taskId === "readRamPage" && !activeParentIds.has(entry.id),
      );
      expect(waiting).toBeDefined();

      expect(getQueueEntryDispatchBlockedReason(state, waiting!.id)).toBe(
        "Waiting for free RAM staging.",
      );

      // Running entries report no blocked reason.
      const runningId = [...activeParentIds][0]!;
      expect(getQueueEntryDispatchBlockedReason(state, runningId)).toBeNull();
    });
  });
});
