import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAction,
  createInitialGameState,
  deriveVisibleState,
  tickGame,
  type GameState,
  type VisibleState,
} from "../game";
import { HardwareBoard, ResourceHud, TaskBay } from "./HardwareBoard";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const makeVisibleState = (data: number, credits: number) =>
  ({
    resources: { data, credits },
    activeTasks: [],
    queue: [],
  }) as unknown as VisibleState;

describe("ResourceHud", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it("animates earned resources after resource effects are armed", () => {
    act(() => {
      root.render(
        <ResourceHud
          visible={makeVisibleState(0, 0)}
          onReset={() => undefined}
          animateResourceGains={false}
        />,
      );
    });

    act(() => {
      root.render(
        <ResourceHud
          visible={makeVisibleState(4, 7)}
          onReset={() => undefined}
          animateResourceGains={true}
        />,
      );
    });

    expect(container.querySelector(".resource-gain-flyout")).toBeNull();

    act(() => {
      root.render(
        <ResourceHud
          visible={makeVisibleState(5, 10)}
          onReset={() => undefined}
          animateResourceGains={true}
        />,
      );
    });

    const dataFlyout = container.querySelector(".resource-gain-flyout.data");
    const creditsFlyout = container.querySelector(".resource-gain-flyout.credits");

    expect(dataFlyout?.querySelector(".resource-token.data strong")?.textContent).toBe("+1");
    expect(
      dataFlyout?.querySelector(".resource-token.data span")?.textContent,
    ).toBeUndefined();
    expect(
      creditsFlyout?.querySelector(".resource-token.credits strong")?.textContent,
    ).toBe("+3");
    expect(
      creditsFlyout?.querySelector(".resource-token.credits span")?.textContent,
    ).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(1080);
    });

    expect(container.querySelector(".resource-gain-flyout")).toBeNull();
  });
});

describe("HardwareBoard cache meter", () => {
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

  it("renders buffering cache with dashed CPU progress and solid cache progress", () => {
    const state = tickGame(
      applyAction(createInitialGameState(), {
        type: "startTask",
        taskId: "fetchBit",
      }),
      500,
    );

    const visible = deriveVisibleState(state);
    const cpuProgress =
      (visible.activeTasks[0]?.coreProgress[0]?.progress ?? 0) * 100;

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent="cache"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const segment = container.querySelector<HTMLElement>(
      ".cache-pressure-segment.buffering",
    );
    const buffer = segment?.querySelector<HTMLElement>(".cache-pressure-buffer");
    const fill = segment?.querySelector<HTMLElement>(".cache-pressure-fill");

    expect(segment).not.toBeNull();
    expect(buffer).not.toBeNull();
    expect(fill).not.toBeNull();
    expect(segment?.style.width).toBe("100%");
    expect(
      Number.parseFloat(
        segment?.style.getPropertyValue("--cache-buffer-progress") ?? "0",
      ),
    ).toBeCloseTo(cpuProgress);
    expect(
      Number.parseFloat(
        segment?.style.getPropertyValue("--cache-write-progress") ?? "0",
      ),
    ).toBeCloseTo(cpuProgress);

    const bufferBadge = container.querySelector<HTMLElement>(
      ".cache-state-badge.buffering",
    );
    expect(
      Array.from(bufferBadge?.children ?? []).map((child) =>
        child.tagName.toLowerCase(),
      ),
    ).toEqual(["strong", "span", "small"]);
  });

  it("renders Byte Copy read and write cache residency as separate segments", () => {
    const initial = createInitialGameState();
    let state: GameState = {
      ...initial,
      resources: {
        credits: 1_000,
        data: 1_000,
      },
      research: {
        completed: ["byteOperations"],
      },
      hardware: {
        ...initial.hardware,
        clockLevel: 5,
        clockHz: 4.4,
        coreClockLevels: {
          1: 5,
        },
        cacheLevel: 5,
        cacheBits: 16,
        cacheBytes: 2,
        cacheSpeedLevel: 5,
      },
    };

    state = applyAction(state, { type: "startTask", taskId: "byteCopy" });

    let guard = 0;
    while (
      state.activeTasks[0]?.coreOperations[0]?.operationIndex === 0 &&
      guard < 60
    ) {
      state = tickGame(state, 100);
      guard += 1;
    }

    const visible = deriveVisibleState(state);

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent="cache"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const segments = Array.from(
      container.querySelectorAll<HTMLElement>(".cache-pressure-segment"),
    );

    expect(visible.metrics.cacheUsedBits).toBe(16);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.className).toContain("cache-pressure-read");
    expect(segments[0]?.className).toContain("loaded");
    expect(segments[0]?.style.width).toBe("50%");
    expect(segments[1]?.className).toContain("cache-pressure-write");
    expect(segments[1]?.className).toContain("buffering");
    expect(segments[1]?.style.width).toBe("50%");
  });

  it("renders RAM load progress as an active loading segment", () => {
    const base = deriveVisibleState(createInitialGameState());
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        systemStats: true,
      },
      hardware: {
        ...base.hardware,
        ramLevel: 1,
        ramBits: 256,
        ramBytes: 32,
        ramSpeedLevel: 1,
        ramSpeedMt: 1,
      },
      metrics: {
        ...base.metrics,
        ramUsedBits: 256,
        ramUsedBytes: 32,
        ramSlots: [
          {
            id: 1,
            sizeBits: 256,
            sizeBytes: 32,
            usedBits: 256,
            usedBytes: 32,
            speedMt: 1,
          },
        ],
        ramResidency: [
          {
            coreId: 1,
            taskId: "tinyChecksum",
            operationId: "tinyChecksum:stage-checksum",
            bits: 256,
            state: "loading",
            progress: 0.25,
          },
        ],
      },
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent="ram"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const segment = container.querySelector<HTMLElement>(
      ".ram-pressure-segment.loading",
    );
    const fill = segment?.querySelector<HTMLElement>(".ram-pressure-fill");

    expect(segment).not.toBeNull();
    expect(fill).not.toBeNull();
    expect(segment?.style.width).toBe("100%");
    expect(segment?.style.getPropertyValue("--ram-load-progress")).toBe("25%");
    expect(
      container.querySelector(".ram-state-badge.loading strong")?.textContent,
    ).toBe("64 b");
  });

  it("uses generic single-CPU hardware labels and horizontal scheduler slots", () => {
    const base = deriveVisibleState(createInitialGameState());
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
      },
      hardware: {
        ...base.hardware,
        schedulerSlots: 3,
        cpus: base.hardware.cpus.map((cpu) => ({
          ...cpu,
          schedulerSlots: 3,
        })),
      },
      metrics: {
        ...base.metrics,
        cpuSockets: base.metrics.cpuSockets.map((socket) => ({
          ...socket,
          schedulerSlots: 3,
          queuedCount: 1,
          schedulerSlotUpgrade: null,
        })),
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

    const text = container.textContent ?? "";
    const slots = Array.from(container.querySelectorAll(".scheduler-slot"));

    expect(text).toContain("CPU");
    expect(text).toContain("Cache");
    expect(text).toContain("Scheduler");
    expect(text).not.toContain("CPU A");
    expect(text).not.toContain("CPU A Cache");
    expect(text).not.toContain("CPU A Scheduler");
    expect(slots).toHaveLength(3);
    expect(container.querySelectorAll(".scheduler-slot.active")).toHaveLength(1);
    expect(container.querySelectorAll(".scheduler-slot.available")).toHaveLength(2);
  });

  it("lists the current wait reason for queued scheduler tasks", () => {
    const base = deriveVisibleState(createInitialGameState());
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
      },
      queue: ["fetchBit"],
      tasks: base.tasks.map((task) =>
        task.id === "fetchBit"
          ? { ...task, blockedReason: "Not enough free cache." }
          : task,
      ),
      hardware: {
        ...base.hardware,
        schedulerSlots: 1,
        cpus: base.hardware.cpus.map((cpu) => ({
          ...cpu,
          schedulerSlots: 1,
        })),
      },
      metrics: {
        ...base.metrics,
        cpuSockets: base.metrics.cpuSockets.map((socket) => ({
          ...socket,
          schedulerSlots: 1,
          queuedCount: 1,
          schedulerSlotUpgrade: null,
          cores: socket.cores.map((core, index) => ({
            ...core,
            scheduler: {
              ...core.scheduler,
              localQueue: index === 0 ? ["fetchBit"] : [],
            },
          })),
        })),
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

    const queuedTask = container.querySelector(".queue-preview small");
    const cancelButton = container.querySelector<HTMLButtonElement>(
      ".queue-cancel-button",
    );

    expect(queuedTask?.querySelector("strong")?.textContent).toBe("Fetch Bit");
    expect(queuedTask?.querySelector("span")?.textContent).toBe(
      "Not enough free cache.",
    );
    expect(cancelButton).not.toBeNull();
  });

  it("blocks whole system tasks when a CPU scheduler is selected", () => {
    const base = deriveVisibleState(createInitialGameState());
    const dispatch = vi.fn();
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
        scheduler: true,
      },
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
          canStart: true,
          canQueue: true,
          blockedReason: null,
          queueBlockedReason: null,
        },
      ],
    };

    act(() => {
      root.render(
        <TaskBay
          visible={visible}
          selectedComponent="scheduler:1"
          dispatch={dispatch}
        />,
      );
    });

    const button = container.querySelector<HTMLButtonElement>(".task-run-button");

    expect(button?.disabled).toBe(true);
    expect(container.textContent).toContain("Use system scheduler");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("shows the system scheduler surface and routes system tasks through it", () => {
    const base = deriveVisibleState(createInitialGameState());
    const dispatch = vi.fn();
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
        schedulerSlots: 4,
        systemSchedulerSlots: 4,
        ramLevel: 1,
        ramBits: 256,
        ramBytes: 32,
        cpus: base.hardware.cpus.map((cpu) => ({
          ...cpu,
          schedulerSlots: 4,
        })),
      },
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
          canStart: true,
          canQueue: true,
          blockedReason: null,
          queueBlockedReason: null,
        },
      ],
      upgrades: [
        {
          id: "systemSchedulerSlot",
          name: "System Queue Slot",
          component: "scheduler",
          accent: "violet",
          costs: [{ resource: "credits", amount: 180 }],
          canAfford: true,
          purchaseCount: 0,
        },
      ],
      metrics: {
        ...base.metrics,
        cpuSockets: base.metrics.cpuSockets.map((socket) => ({
          ...socket,
          schedulerSlots: 4,
          queuedCount: 0,
          schedulerSlotUpgrade: null,
        })),
      },
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

    expect(container.querySelector(".system-scheduler-section")?.textContent).toContain(
      "System Scheduler",
    );
    expect(container.querySelector(".system-scheduler-section")?.textContent).toContain(
      "System Queue Slot",
    );

    act(() => {
      root.render(
        <TaskBay
          visible={visible}
          selectedComponent="scheduler"
          dispatch={dispatch}
        />,
      );
    });

    const button = container.querySelector<HTMLButtonElement>(".task-run-button");

    expect(button?.disabled).toBe(false);
    expect(button?.textContent).toContain("Schedule");

    act(() => {
      button?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "queueTask",
      taskId: "tinyChecksum",
    });
  });

  it("dispatches cancel actions from active task cards and queue previews", () => {
    let state = applyAction(createInitialGameState(), {
      type: "startTask",
      taskId: "fetchBit",
    });
    const dispatch = vi.fn();

    act(() => {
      root.render(
        <TaskBay
          visible={deriveVisibleState(state)}
          selectedComponent={null}
          dispatch={dispatch}
        />,
      );
    });

    const activeCancel = container.querySelector<HTMLButtonElement>(
      ".task-cancel-button",
    );

    expect(activeCancel).not.toBeNull();

    act(() => {
      activeCancel?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "cancelTask",
      taskId: "fetchBit",
      instanceId: state.activeTasks[0]?.instanceId,
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
});
