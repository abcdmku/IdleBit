import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAction,
  createInitialGameState,
  createRackReadyGameState,
  deriveVisibleState,
  tickGame,
  type VisibleState
} from "../game";
import {
  HardwareBoard,
  PinnedTaskBar,
  TaskBay
} from "./HardwareBoard";
import { TaskDagModal } from "./tasks/TaskDagModal";
import { formatBits, formatNumber } from "./format";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("TaskBay queue and deadlock status", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it("keeps active pinned tasks queueable through a scheduler route", () => {
    const base = deriveVisibleState(createInitialGameState());
    const dispatch = vi.fn();
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
      },
      tasks: base.tasks.map((task) =>
        task.id === "fetchBit"
          ? {
            ...task,
            canQueue: true,
            queueBlockedReason: null,
          }
          : task,
      ),
      activeTasks: [
        {
          instanceId: "fetch-active-1",
          taskId: "fetchBit",
          jobId: "fetchBit",
          schedulerQueued: true,
          name: "Fetch Bit",
          coreId: 1,
          assignedCoreIds: [1],
          progress: 0.42,
          status: "running",
          memoryState: "ready",
          activeOperationName: "Fetch Bit",
          coreProgress: [],
          lockResource: null,
          lockReason: null,
        },
      ],
    };

    act(() => {
      root.render(
        <PinnedTaskBar
          visible={visible}
          pinnedTaskIds={["fetchBit"]}
          onUnpinTask={() => undefined}
          onClearPinnedTasks={() => undefined}
          dispatch={dispatch}
          selectedComponent="scheduler:1"
        />,
      );
    });

    const row = container.querySelector(".pinned-task-row");
    const runButton = row?.querySelector<HTMLButtonElement>(".pinned-task-action");

    expect(row?.textContent).toContain("Fetch Bit");
    expect(runButton).not.toBeNull();
    expect(runButton?.disabled).toBe(false);
    expect(runButton?.textContent).toContain("Queue");

    act(() => {
      runButton?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "queueTask",
      taskId: "fetchBit",
      cpuId: 1,
    });
  });

  it("bubbles CPU scheduler wait reasons up to system scheduler slots", () => {
    const base = deriveVisibleState(createInitialGameState());
    const dispatch = vi.fn();
    const socket = base.metrics.cpuSockets[0]!;
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
        scheduler: true,
        systemStats: true,
      },
      hardware: {
        ...base.hardware,
        systemSchedulerSlots: 1,
        systemSchedulerConfig: {
          policy: "fifo",
          autoKillEnabled: false,
          killPolicy: "deadlockedTask",
        },
      },
      metrics: {
        ...base.metrics,
        cpuSockets: [
          {
            ...socket,
            cacheBits: 32,
            cacheUsedBits: 31.5,
            schedulerSlots: 4,
            queuedCount: 1,
            schedulerConfig: {
              policy: "fifo",
              autoKillEnabled: false,
              killPolicy: "deadlockedTask",
            },
            cores: socket.cores.map((core, index) => ({
              ...core,
              scheduler: {
                ...core.scheduler,
                localQueue: index === 0 ? ["tinyChecksum"] : [],
              },
            })),
          },
        ],
      },
      queue: ["tinyChecksum"],
      tasks: [
        {
          ...base.tasks[0]!,
          id: "tinyChecksum",
          name: "Tiny Checksum",
          category: "system",
          operationCount: 332,
          rewardCredits: 332,
          rewardData: 2,
          cacheNeedBits: 8,
          ramNeedBits: 256,
          requiredCores: 1,
          canStart: false,
          canQueue: false,
          blockedReason: null,
          queueBlockedReason: "System scheduler slots full.",
        },
      ],
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={dispatch}
          selectedComponent="scheduler"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const systemStatus = container.querySelector(
      ".system-scheduler-section .queue-slot-cell .queue-slot-state",
    )?.textContent;
    const cpuStatus = container.querySelector(
      ".scheduler-section:not(.system-scheduler-section) .queue-slot-cell .queue-slot-state",
    )?.textContent;

    expect(systemStatus).toBe("Waiting for CPU cache.");
    expect(cpuStatus).toBe("Waiting for CPU cache.");
    // Per-slot reasons are the single source; no aggregate blocked summary.
    expect(
      container.querySelector(".system-scheduler-blocked-reasons"),
    ).toBeNull();
    expect(container.textContent).not.toContain("System scheduler slots full.");
  });

  it("shows CPU child work with parent context while system slots keep parent labels", () => {
    let state = createRackReadyGameState();
    state = applyAction(state, { type: "queueTask", taskId: "tinyChecksum" });
    state = tickGame(state, 16);
    const rackVisible = deriveVisibleState(state);
    const selectedSystem = rackVisible.rack.systems.find((system) => system.selected) as
      | { visible?: VisibleState }
      | undefined;
    const selectedVisible =
      selectedSystem?.visible ?? rackVisible;
    const visible: VisibleState = {
      ...selectedVisible,
      hardware: {
        ...selectedVisible.hardware,
        secondCpu: false,
      },
      metrics: {
        ...selectedVisible.metrics,
        cpuSockets: [selectedVisible.metrics.cpuSockets[0]!],
      },
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent="scheduler:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const cpuSlot = container.querySelector(
      ".scheduler-section:not(.system-scheduler-section) .queue-slot-cell",
    );
    const systemSlot = container.querySelector(
      ".system-scheduler-section .queue-slot-cell",
    );

    expect(cpuSlot?.textContent).toContain("Stage Checksum Page");
    expect(cpuSlot?.textContent).toContain("Tiny Checksum");
    expect(systemSlot?.textContent).toContain("Tiny Checksum");
    expect(systemSlot?.textContent).not.toContain("Stage Checksum Page");
  });

  it("renders composed CPU child stages in task DAG modals", () => {
    const visible = deriveVisibleState(createRackReadyGameState());
    const tinyChecksum = visible.tasks.find((task) => task.id === "tinyChecksum");
    const compileCode = visible.tasks.find((task) => task.id === "compileCode");

    if (!tinyChecksum || !compileCode) {
      throw new Error("Expected Fleet-ready tasks to include DAG-covered system tasks.");
    }

    act(() => {
      root.render(
        <TaskDagModal
          task={tinyChecksum}
          visible={visible}
          activeTask={null}
          onClose={() => undefined}
          memoryUnlocked
        />,
      );
    });

    expect(container.textContent).toContain("Stage Checksum Page");
    expect(container.textContent).toContain("Checksum Step");

    act(() => {
      root.render(
        <TaskDagModal
          task={compileCode}
          visible={visible}
          activeTask={null}
          onClose={() => undefined}
          memoryUnlocked
        />,
      );
    });

    expect(container.textContent).toContain("Stage Source Tree");
    expect(container.textContent).toContain("Compile Units");
    expect(container.textContent).toContain("Link Barrier");
    expect(container.textContent).toContain("Link Binary");
    expect(container.textContent).toContain("Write Artifact");
    const stagedSource = compileCode.subtasks.find(
      (stage) => stage.sourceTaskId === "stageSourceTree",
    );
    const workUnitCount = compileCode.workUnitCount ?? 1;
    if (!stagedSource) throw new Error("Expected the Stage Source Tree DAG node.");
    const stagedSourceOperations = stagedSource.operations.reduce(
      (total, operation) => total + operation.count,
      0,
    );
    expect(container.textContent).toContain(
      `${formatNumber(stagedSourceOperations * workUnitCount)} total ops`,
    );
    expect(container.textContent).toContain(
      `${formatBits(stagedSource.ramBits * workUnitCount)} total`,
    );
    expect(container.textContent).toContain(`${formatBits(stagedSource.ramBits)} each`);
    expect(container.textContent).toContain("1 op");
    expect(container.textContent).toContain("RAM held");
    expect(container.textContent).not.toContain("kept from previous stage");
    expect(container.querySelector(".dag-phase.phase-ram.has-muted-detail")).not.toBeNull();
  });

  it("focuses and closes task DAG dialogs with Escape", () => {
    const visible = deriveVisibleState(createRackReadyGameState());
    const task = visible.tasks.find((candidate) => candidate.id === "tinyChecksum");
    const onClose = vi.fn();

    if (!task) throw new Error("Expected the Tiny Checksum task.");

    act(() => {
      root.render(
        <TaskDagModal
          task={task}
          visible={visible}
          activeTask={null}
          onClose={onClose}
          memoryUnlocked
        />,
      );
    });

    expect(document.activeElement).toBe(
      container.querySelector<HTMLButtonElement>(".task-dag-close"),
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("explains RAM-blocked system tasks already reserved by a CPU scheduler", () => {
    const base = deriveVisibleState(createInitialGameState());
    const dispatch = vi.fn();
    const socket = base.metrics.cpuSockets[0]!;
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
        scheduler: true,
        systemStats: true,
      },
      hardware: {
        ...base.hardware,
        ramBits: 256,
        ramBytes: 32,
        systemSchedulerSlots: 1,
        systemSchedulerConfig: {
          policy: "fifo",
          autoKillEnabled: false,
          killPolicy: "deadlockedTask",
        },
      },
      metrics: {
        ...base.metrics,
        ramUsedBits: 256,
        ramUsedBytes: 32,
        cpuSockets: [
          {
            ...socket,
            cacheBits: 64,
            cacheUsedBits: 0,
            schedulerSlots: 1,
            queuedCount: 1,
            schedulerConfig: {
              policy: "fifo",
              autoKillEnabled: false,
              killPolicy: "deadlockedTask",
            },
            cores: socket.cores.map((core, index) => ({
              ...core,
              scheduler: {
                ...core.scheduler,
                localQueue: index === 0 ? ["tinyChecksum"] : [],
              },
            })),
          },
        ],
      },
      queue: ["tinyChecksum"],
      tasks: [
        {
          ...base.tasks[0]!,
          id: "tinyChecksum",
          name: "Tiny Checksum",
          category: "system",
          operationCount: 332,
          rewardCredits: 332,
          rewardData: 2,
          cacheNeedBits: 8,
          ramNeedBits: 256,
          requiredCores: 1,
          canStart: false,
          canQueue: false,
          blockedReason: null,
          queueBlockedReason: "System scheduler slots full.",
        },
      ],
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={dispatch}
          selectedComponent="scheduler"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const systemStatus = container.querySelector(
      ".system-scheduler-section .queue-slot-cell .queue-slot-state",
    )?.textContent;
    const cpuStatus = container.querySelector(
      ".scheduler-section:not(.system-scheduler-section) .queue-slot-cell .queue-slot-state",
    )?.textContent;

    expect(systemStatus).toBe("Waiting for RAM.");
    expect(cpuStatus).toBe("Waiting for RAM.");
    // Per-slot reasons are the single source; no aggregate blocked summary.
    expect(
      container.querySelector(".system-scheduler-blocked-reasons"),
    ).toBeNull();
    expect(container.textContent).not.toContain("Waiting for CPU scheduler dispatch.");
  });

  it("shows active scheduler slots with whole-task progress", () => {
    const base = deriveVisibleState(createInitialGameState());
    const socket = base.metrics.cpuSockets[0]!;
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
      },
      queue: ["fetchBit"],
      activeTasks: [
        {
          instanceId: "fetch-active-1",
          taskId: "fetchBit",
          jobId: "fetchBit",
          schedulerQueued: true,
          name: "Fetch Bit",
          coreId: 1,
          assignedCoreIds: [1],
          progress: 0.42,
          status: "running",
          memoryState: "ready",
          activeOperationName: "Fetch Bit",
          coreProgress: [],
          lockResource: null,
          lockReason: null,
        },
      ],
      metrics: {
        ...base.metrics,
        cpuSockets: [
          {
            ...socket,
            schedulerSlots: 1,
            queuedCount: 1,
            cores: socket.cores.map((core, index) => ({
              ...core,
              scheduler: {
                ...core.scheduler,
                localQueue: index === 0 ? ["fetchBit"] : [],
              },
            })),
          },
        ],
      },
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent="scheduler:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const progress = container.querySelector<HTMLElement>(
      ".scheduler-section:not(.system-scheduler-section) .queue-slot-progress",
    );

    expect(progress?.getAttribute("aria-valuenow")).toBe("42");
    expect(
      progress
        ?.querySelector<HTMLElement>(".progress-fill")
        ?.style.getPropertyValue("--meter-progress"),
    ).toBe("0.42");
  });

  it("marks every reserved multicore CPU scheduler slot as active", () => {
    const base = deriveVisibleState(createInitialGameState());
    const socket = base.metrics.cpuSockets[0]!;
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
      },
      queue: ["fetchBit"],
      activeTasks: [
        {
          instanceId: "fetch-active-1",
          taskId: "fetchBit",
          jobId: "fetchBit",
          schedulerQueued: true,
          name: "Fetch Bit",
          coreId: 1,
          assignedCoreIds: [1, 2, 3, 4],
          progress: 0.42,
          status: "running",
          memoryState: "ready",
          activeOperationName: "Fetch Bit",
          coreProgress: [],
          lockResource: null,
          lockReason: null,
        },
      ],
      metrics: {
        ...base.metrics,
        cpuSockets: [
          {
            ...socket,
            schedulerSlots: 4,
            queuedCount: 4,
            cores: socket.cores.map((core, index) => ({
              ...core,
              scheduler: {
                ...core.scheduler,
                localQueue:
                  index === 0
                    ? ["fetchBit", "fetchBit", "fetchBit", "fetchBit"]
                    : [],
              },
            })),
          },
        ],
      },
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent="scheduler:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    expect(
      container.querySelectorAll(
        ".scheduler-section:not(.system-scheduler-section) .queue-slot-cell.active",
      ),
    ).toHaveLength(4);
  });

  it("shows active cancel on cores instead of task cards and keeps queue preview cancel", () => {
    let state = applyAction(createInitialGameState(), {
      type: "startTask",
      taskId: "fetchBit",
    });
    const dispatch = vi.fn();
    const activeVisible = deriveVisibleState(state);

    act(() => {
      root.render(
        <TaskBay
          visible={activeVisible}
          selectedComponent={null}
          dispatch={dispatch}
        />,
      );
    });

    const activeTaskCard = container.querySelector(".task-card.active");

    expect(container.querySelector(".task-cancel-button")).toBeNull();
    expect(activeTaskCard?.querySelector(".task-state-pill")).toBeNull();
    expect(activeTaskCard?.querySelector(".task-status-line")).toBeNull();
    expect(activeTaskCard?.textContent).not.toContain("Active");

    act(() => {
      root.render(
        <HardwareBoard
          visible={activeVisible}
          dispatch={dispatch}
          selectedComponent="core:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const coreCancel = container.querySelector<HTMLButtonElement>(
      ".core-cancel-button",
    );

    expect(coreCancel).not.toBeNull();

    act(() => {
      coreCancel?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "cancelTask",
      taskId: "fetchBit",
      instanceId: state.activeTasks[0]?.instanceId,
      coreId: 1,
    });

    dispatch.mockClear();
    const queuedBase = createInitialGameState();
    state = {
      ...queuedBase,
      flags: {
        ...queuedBase.flags,
        basicQueue: true,
      },
      hardware: {
        ...queuedBase.hardware,
        schedulerSlots: 1,
        cpus: queuedBase.hardware.cpus.map((cpu) => ({
          ...cpu,
          schedulerSlots: 1,
        })),
      },
      coreSchedulers: {
        ...queuedBase.coreSchedulers,
        1: {
          ...queuedBase.coreSchedulers[1]!,
          localQueue: ["fetchBit"],
        },
      },
      queue: ["fetchBit"],
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={deriveVisibleState(state)}
          dispatch={dispatch}
          selectedComponent="scheduler:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const queuedCancel = container.querySelector<HTMLButtonElement>(
      ".queue-cancel-button",
    );

    expect(queuedCancel).not.toBeNull();

    act(() => {
      queuedCancel?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "cancelQueuedTask",
      taskId: "fetchBit",
    });
  });

  it("keeps deadlocked tasks neutral in the task list", () => {
    const state = applyAction(createInitialGameState(), {
      type: "startTask",
      taskId: "fetchBit",
    });
    const visible = deriveVisibleState(state);
    const deadlockedVisible: VisibleState = {
      ...visible,
      activeTasks: visible.activeTasks.map((task) => ({
        ...task,
        status: "deadlocked",
        memoryState: "deadlock",
        lockResource: "cache",
        lockReason: "Deadlock: cache full.",
      })),
    };

    act(() => {
      root.render(
        <TaskBay
          visible={deadlockedVisible}
          selectedComponent={null}
          dispatch={() => undefined}
        />,
      );
    });

    expect(container.querySelector(".task-card.deadlock")).toBeNull();
    expect(container.querySelector(".task-card.active")).not.toBeNull();
    expect(container.querySelector(".task-cancel-button")).toBeNull();
  });

});

