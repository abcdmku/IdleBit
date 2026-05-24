import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialGameState,
  deriveVisibleState,
  type VisibleState
} from "../game";
import {
  HardwareBoard,
  ResearchPanel,
  TaskBay
} from "./HardwareBoard";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const makePointerEvent = (type: string) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    cancelable: true,
  });

  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: "mouse" },
    isPrimary: { value: true },
  });

  return event;
};

describe("TaskBay task and research behavior", () => {
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

  it("lets the task list choose a compact assignment route", () => {
    const base = deriveVisibleState(createInitialGameState());
    const selectComponent = vi.fn();
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
        scheduler: true,
      },
    };

    act(() => {
      root.render(
        <TaskBay
          visible={visible}
          selectedComponent={null}
          onSelectComponent={selectComponent}
          dispatch={() => undefined}
        />,
      );
    });

    const routeSelect = container.querySelector<HTMLSelectElement>(
      ".task-route-combo-select",
    );

    expect(container.textContent).not.toContain("Auto");
    expect(
      Array.from(routeSelect?.options ?? []).map((option) => option.textContent),
    ).toEqual(["C1", "CPU 1"]);
    expect(routeSelect?.value).toBe("core:1");

    act(() => {
      routeSelect!.value = "scheduler:1";
      routeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(selectComponent).toHaveBeenLastCalledWith("scheduler:1");
  });

  it("keeps task requirements and rewards visible while putting blockers in the button", () => {
    const base = deriveVisibleState(createInitialGameState());
    const visible: VisibleState = {
      ...base,
      tasks: base.tasks.map((task) =>
        task.id === "fetchBit"
          ? {
            ...task,
            canStart: false,
            canQueue: false,
            blockedReason: "Cache capacity too low.",
          }
          : task,
      ),
    };

    act(() => {
      root.render(
        <TaskBay
          visible={visible}
          selectedComponent={null}
          dispatch={() => undefined}
        />,
      );
    });

    const taskCard = container.querySelector(".task-card");
    const button = taskCard?.querySelector<HTMLButtonElement>(".task-run-button");
    const meta = taskCard?.querySelector(".task-meta-line");

    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toContain("Cache capacity too low.");
    expect(meta?.textContent).toContain("ops");
    expect(taskCard?.querySelector(".task-card-head .resource-token.credits")).not.toBeNull();
    expect(taskCard?.querySelector(".task-progress")).toBeNull();
  });

  it("repeats task actions immediately while the run button is held", () => {
    vi.useFakeTimers();

    try {
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

      expect(button?.disabled).toBe(false);

      act(() => {
        button?.dispatchEvent(makePointerEvent("pointerdown"));
      });

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenLastCalledWith({
        type: "queueTask",
        taskId: "fetchBit",
        cpuId: 1,
      });

      act(() => {
        vi.advanceTimersByTime(330);
      });

      expect(dispatch).toHaveBeenCalledTimes(4);

      act(() => {
        window.dispatchEvent(makePointerEvent("pointerup"));
        button?.click();
        vi.advanceTimersByTime(220);
      });

      expect(dispatch).toHaveBeenCalledTimes(4);

      act(() => {
        vi.runOnlyPendingTimers();
      });

      act(() => {
        button?.click();
      });

      expect(dispatch).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps held task retriggers after ten seconds", () => {
    vi.useFakeTimers();

    try {
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

      act(() => {
        button?.dispatchEvent(makePointerEvent("pointerdown"));
        vi.advanceTimersByTime(12_000);
      });

      const countAtCap = dispatch.mock.calls.length;

      expect(countAtCap).toBeGreaterThan(80);

      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(dispatch).toHaveBeenCalledTimes(countAtCap);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists multi-core task requirements without labeling single-core tasks", () => {
    const base = deriveVisibleState(createInitialGameState());
    const visible: VisibleState = {
      ...base,
      tasks: [
        {
          ...base.tasks[0]!,
          id: "fetchBit",
          name: "Fetch Bit",
          requiredCores: 1,
        },
        {
          ...base.tasks[0]!,
          id: "busMirror",
          name: "Bus Mirror",
          requiredCores: 2,
          operationCount: 128,
        },
        {
          ...base.tasks[0]!,
          id: "compileCode",
          name: "Compile Code",
          requiredCores: 1,
          coreScaling: "chunked",
          workUnitCount: 16,
          operationCount: 512,
        },
      ],
    };

    act(() => {
      root.render(
        <TaskBay
          visible={visible}
          selectedComponent={null}
          dispatch={() => undefined}
        />,
      );
    });

    const cards = Array.from(container.querySelectorAll(".task-card"));
    const fetchMeta = cards
      .find((card) => card.textContent?.includes("Fetch Bit"))
      ?.querySelector(".task-meta-line");
    const busMeta = cards
      .find((card) => card.textContent?.includes("Bus Mirror"))
      ?.querySelector(".task-meta-line");
    const compileMeta = cards
      .find((card) => card.textContent?.includes("Compile Code"))
      ?.querySelector(".task-meta-line");

    expect(fetchMeta?.textContent).not.toContain("1 cores");
    expect(busMeta?.textContent).toContain("2 cores");
    expect(compileMeta?.textContent).toContain("16");
    expect(compileMeta?.textContent).not.toContain("Inf");
    expect(compileMeta?.querySelector(".meta-chip.chunked svg")).not.toBeNull();
  });

  it("keeps research costs and compute-task payouts visible while button text shows blockers", () => {
    const base = deriveVisibleState(createInitialGameState());
    const visible: VisibleState = {
      ...base,
      research: [
        {
          id: "multiCore",
          name: "Multi-Core Control",
          description: "Coordinate more than one core.",
          grants: [],
          costs: [{ resource: "data", amount: 12 }],
          canAfford: false,
          canBuy: false,
          completed: false,
          blockedReason: "Needs Parallelism Benchmark.",
          requirements: [
            {
              id: "parallelism",
              label: "Parallelism Benchmark",
              kind: "compute",
              met: false,
            },
          ],
          computeTasks: [
            {
              ...base.tasks[0]!,
              id: "microBenchmark",
              name: "Micro Benchmark",
              category: "cpu",
              operationCount: 80,
              requiredCores: 2,
              rewardCredits: 80,
              rewardData: 4,
              cacheNeedBits: 4,
              canStart: false,
              canQueue: false,
              blockedReason: "Core clock level 3 required.",
              queueBlockedReason: null,
              completed: false,
              active: false,
              progress: 0,
            },
          ],
        },
      ],
    };

    act(() => {
      root.render(<ResearchPanel visible={visible} dispatch={() => undefined} />);
    });

    const buyButton = container.querySelector<HTMLButtonElement>(".research-buy-button");
    const compute = container.querySelector(".research-compute");
    const computeButton =
      compute?.querySelector<HTMLButtonElement>(".research-compute-button");
    const computeMeta = compute?.querySelector(".task-meta-line");

    expect(buyButton?.disabled).toBe(true);
    expect(buyButton?.textContent).toContain("Needs Parallelism Benchmark.");
    expect(container.querySelector(".research-cost-line .resource-token.data")).not.toBeNull();
    expect(computeButton?.disabled).toBe(true);
    expect(computeButton?.textContent).toContain("Core clock level 3 required.");
    expect(computeMeta?.textContent).toContain("80");
    expect(computeMeta?.textContent).toContain("2 cores");
    expect(computeMeta?.textContent).toContain("cache 4 b");
    expect(computeMeta?.querySelector(".resource-token.credits")).not.toBeNull();
    expect(computeMeta?.querySelector(".resource-token.data")).not.toBeNull();
  });

  it("uses level-up labels for repeatable research", () => {
    const base = deriveVisibleState(createInitialGameState());
    const visible: VisibleState = {
      ...base,
      research: [
        {
          id: "cStateControl",
          name: "C-State Control",
          description: "Reduce idle CPU draw.",
          grants: ["cStateControl"],
          costs: [{ resource: "credits", amount: 8 }],
          canAfford: true,
          canBuy: true,
          actionLabel: "Level up",
          completed: false,
          blockedReason: null,
          requirements: [],
          computeTasks: [],
        },
      ],
    };

    act(() => {
      root.render(<ResearchPanel visible={visible} dispatch={() => undefined} />);
    });

    const buyButton = container.querySelector<HTMLButtonElement>(".research-buy-button");

    expect(buyButton?.disabled).toBe(false);
    expect(buyButton?.textContent).toContain("Level up");
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
          refunds: [],
          canAfford: true,
          canDowngrade: false,
          downgradeBlockedReason: null,
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
    expect(
      container.querySelector(".system-scheduler-section .queue-preview-list"),
    ).toBeNull();
    expect(
      container.querySelector(".system-scheduler-section .queue-empty")?.textContent,
    ).toBe("4 slots open");
    expect(container.querySelector(".memory-section")).not.toBeNull();
    expect(
      container
        .querySelector(".system-scheduler-section")
        ?.compareDocumentPosition(container.querySelector(".memory-section")!) ?? 0,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

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

  it("shows duplicate scheduled task copies with their own queue status", () => {
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
        systemSchedulerSlots: 2,
        ramLevel: 1,
        ramBits: 256,
        ramBytes: 32,
      },
      queue: ["tinyChecksum", "tinyChecksum"],
      activeTasks: [
        {
          instanceId: "active-checksum-1",
          taskId: "tinyChecksum",
          jobId: "tinyChecksum",
          schedulerQueued: true,
          name: "Tiny Checksum",
          coreId: 1,
          assignedCoreIds: [1],
          progress: 0.2,
          status: "running",
          memoryState: "ready",
          activeOperationName: "Checksum Step",
          coreProgress: [],
          lockResource: null,
          lockReason: null,
        },
      ],
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
          canStart: false,
          canQueue: true,
          blockedReason: "RAM full.",
          queueBlockedReason: null,
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

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".system-scheduler-section .queue-slot-cell:not(.empty)",
      ),
    );
    const firstStatus = rows[0]?.querySelector(".queue-slot-state")?.textContent;
    const secondStatus = rows[1]?.querySelector(".queue-slot-state")?.textContent;

    expect(rows).toHaveLength(2);
    expect(rows[0]?.className).toContain("active");
    expect(rows[1]?.className).toContain("pending");
    expect(firstStatus).toBe("Checksum Step");
    expect(secondStatus).toBe("RAM full.");

    act(() => {
      rows[0]?.querySelector<HTMLButtonElement>(".queue-cancel-button")?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "cancelTask",
      taskId: "tinyChecksum",
      instanceId: "active-checksum-1",
    });

    dispatch.mockClear();

    act(() => {
      rows[1]?.querySelector<HTMLButtonElement>(".queue-cancel-button")?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "cancelQueuedTask",
      taskId: "tinyChecksum",
    });
  });

});

