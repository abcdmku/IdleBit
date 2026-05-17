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
import { HardwareBoard, ResearchPanel, ResourceHud, TaskBay } from "./HardwareBoard";

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

    const readSegment = segments.find((segment) =>
      segment.className.includes("cache-pressure-read"),
    );
    const writeSegment = segments.find((segment) =>
      segment.className.includes("cache-pressure-write"),
    );

    expect(readSegment?.className).toContain("loaded");
    expect(readSegment?.style.width).toBe("50%");
    expect(writeSegment?.className).toContain("buffering");
    expect(writeSegment?.style.width).toBe("50%");
  });

  it("uses core-style controls for cache capacity and speed upgrades", () => {
    const visible = deriveVisibleState(createInitialGameState());

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

    const controls = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".cache-control-strip .upgrade-stepper.green",
      ),
    );

    expect(controls.map((control) => control.textContent)).toEqual([
      expect.stringContaining("Cache cap"),
      expect.stringContaining("Cache Hz"),
    ]);
    expect(container.querySelectorAll(".cache-pipeline-row")).toHaveLength(3);
    expect(controls[0]?.querySelector(".resource-token.dimmed")).not.toBeNull();
    expect(container.querySelector(".cache-stat-row .upgrade-chips")).toBeNull();
  });

  it("uses one +/- spec control for reversible upgrades", () => {
    const funded: GameState = {
      ...createInitialGameState(),
      resources: { credits: 100, data: 100 },
    };
    const state = applyAction(funded, {
      type: "buyUpgrade",
      upgradeId: "cache",
      cpuId: 1,
    });
    const visible = deriveVisibleState(state);
    const dispatch = vi.fn();

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={dispatch}
          selectedComponent="cache"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const steppers = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".cache-control-strip .upgrade-stepper.green",
      ),
    );
    const cacheCap = steppers.find((stepper) =>
      stepper.textContent?.includes("Cache cap"),
    );
    const buttons = Array.from(
      cacheCap?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );

    expect(cacheCap).not.toBeUndefined();
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.className).toContain("minus");
    expect(buttons[1]?.className).toContain("plus");

    act(() => {
      buttons[0]?.click();
    });

    expect(dispatch).toHaveBeenLastCalledWith({
      type: "downgradeUpgrade",
      upgradeId: "cache",
      cpuId: 1,
    });

    act(() => {
      buttons[1]?.click();
    });

    expect(dispatch).toHaveBeenLastCalledWith({
      type: "buyUpgrade",
      upgradeId: "cache",
      cpuId: 1,
    });
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
            level: 1,
            sizeBits: 256,
            sizeBytes: 32,
            usedBits: 256,
            usedBytes: 32,
            speedLevel: 1,
            speedMt: 1,
            capacityUpgrade: null,
            speedUpgrade: null,
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
    expect(container.querySelector(".ram-pipeline-row")).toBeNull();
    expect(container.querySelectorAll(".ram-stick-lane")).toHaveLength(3);
    expect(
      container.querySelector(".ram-stick-lane.loading strong")?.textContent,
    ).toBe("64 b");
  });

  it("uses standalone pre-RAM hardware labels and a compact scheduler grid", () => {
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
    const grid = container.querySelector<HTMLElement>(".queue-preview-list");

    expect(text).toContain("Cores");
    expect(text).toContain("Cache");
    expect(text).toContain("Scheduler");
    expect(text).toContain("1/3 used");
    expect(text).not.toContain("2 open");
    expect(text).not.toContain("Queue");
    expect(text).not.toContain("CPU");
    expect(text).not.toContain("CPU A");
    expect(text).not.toContain("CPU A Cache");
    expect(text).not.toContain("CPU A Scheduler");
    expect(container.querySelector(".scheduler-status-meter")).toBeNull();
    expect(container.querySelector(".queue-preview-header")).toBeNull();
    expect(container.querySelector(".scheduler-capacity-bar")).toBeNull();
    expect(container.querySelector(".scheduler-slot")).toBeNull();
    expect(grid?.dataset.grid).toBe("2x2");
    expect(grid?.style.getPropertyValue("--scheduler-grid-columns")).toBe("2");
    expect(grid?.style.getPropertyValue("--scheduler-grid-height")).toBe("64px");
    expect(grid?.style.getPropertyValue("--scheduler-slot-height")).toBe("30px");
    expect(container.querySelectorAll(".queue-slot-cell")).toHaveLength(3);
  });

  it("keeps cores standalone before RAM and wraps CPU modules after RAM unlock", () => {
    const base = deriveVisibleState(createInitialGameState());

    act(() => {
      root.render(
        <HardwareBoard
          visible={base}
          dispatch={() => undefined}
          selectedComponent="cache"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const standaloneCores = container.querySelector(".core-array-section");

    expect(container.querySelector(".cpu-package")).toBeNull();
    expect(standaloneCores).not.toBeNull();
    expect(standaloneCores?.closest(".cpu-package")).toBeNull();

    const ramVisible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
        systemStats: true,
      },
      hardware: {
        ...base.hardware,
        ramLevel: 1,
        ramBits: 256,
        ramBytes: 32,
      },
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={ramVisible}
          dispatch={() => undefined}
          selectedComponent="cpu"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const cpuPackage = container.querySelector(".cpu-package");
    const ramSection = container.querySelector(".memory-section");

    expect(cpuPackage).not.toBeNull();
    expect(ramSection).not.toBeNull();
    expect(
      ramSection?.compareDocumentPosition(cpuPackage!) ?? 0,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(cpuPackage?.querySelector(".scheduler-section")).not.toBeNull();
    expect(cpuPackage?.querySelector(".cache-section")).not.toBeNull();
    expect(cpuPackage?.querySelector(".core-array-section")).not.toBeNull();
  });

  it("uses a dense core array that can scale to two dozen cores", () => {
    const base = deriveVisibleState(createInitialGameState());
    const baseSocket = base.metrics.cpuSockets[0]!;
    const baseCore = baseSocket.cores[0]!;
    const cores = Array.from({ length: 24 }, (_, index) => ({
      ...baseCore,
      id: index + 1,
      label: `Core ${index + 1}`,
      scheduler: {
        ...baseCore.scheduler,
        localQueue: [],
      },
    }));
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
      },
      hardware: {
        ...base.hardware,
        cores: 24,
      },
      metrics: {
        ...base.metrics,
        cpuSockets: [
          {
            ...baseSocket,
            cores,
          },
        ],
      },
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent="core:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const grid = container.querySelector<HTMLElement>(".core-grid.dense");
    const schedulerCacheRow = container.querySelector(".scheduler-cache-row");

    expect(grid).not.toBeNull();
    expect(grid?.dataset.grid).toBe("2x12");
    expect(grid?.style.getPropertyValue("--core-grid-columns")).toBe("12");
    expect(container.querySelectorAll(".core-die")).toHaveLength(24);
    expect(schedulerCacheRow?.querySelector(".scheduler-section")).not.toBeNull();
    expect(schedulerCacheRow?.querySelector(".cache-section")).not.toBeNull();
    expect(container.querySelector(".core-cache-row")).toBeNull();
    expect(
      container.querySelector(".core-array-section .upgrade-stepper")?.textContent,
    ).toContain(
      "C1 clock",
    );
  });

  it("selects all cores and dispatches grouped clock +/- actions", () => {
    const initial = createInitialGameState();
    let state: GameState = {
      ...initial,
      resources: { credits: 500, data: 500 },
      flags: {
        ...initial.flags,
        multiCore: true,
      },
    };
    state = applyAction(state, { type: "buyUpgrade", upgradeId: "core", cpuId: 1 });
    const onSelectComponent = vi.fn();
    const dispatch = vi.fn();

    act(() => {
      root.render(
        <HardwareBoard
          visible={deriveVisibleState(state)}
          dispatch={dispatch}
          selectedComponent="core:1"
          onSelectComponent={onSelectComponent}
        />,
      );
    });

    expect(container.querySelector(".core-select-all-button")).toBeNull();

    state = {
      ...state,
      flags: {
        ...state.flags,
        basicQueue: true,
      },
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={deriveVisibleState(state)}
          dispatch={dispatch}
          selectedComponent="core:1"
          onSelectComponent={onSelectComponent}
        />,
      );
    });

    const selectAll = container.querySelector<HTMLButtonElement>(
      ".core-select-all-button",
    );

    act(() => {
      selectAll?.click();
    });

    expect(onSelectComponent).toHaveBeenLastCalledWith("cores:1");

    act(() => {
      root.render(
        <HardwareBoard
          visible={deriveVisibleState(state)}
          dispatch={dispatch}
          selectedComponent="cores:1"
          onSelectComponent={onSelectComponent}
        />,
      );
    });

    const groupedStepper = Array.from(
      container.querySelectorAll<HTMLElement>(".core-control-strip .upgrade-stepper"),
    ).find((stepper) => stepper.textContent?.includes("All clocks"));
    const groupButtons = Array.from(
      groupedStepper?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const activeSelectAll = container.querySelector<HTMLButtonElement>(
      ".core-select-all-button",
    );

    expect(activeSelectAll?.className).toContain("active");
    expect(groupedStepper?.textContent).toContain("28");
    expect(
      Array.from(container.querySelectorAll(".core-die")).every(
        (core) => core.getAttribute("aria-pressed") === "true",
      ),
    ).toBe(true);

    act(() => {
      groupButtons[1]?.click();
    });

    expect(dispatch).toHaveBeenLastCalledWith({
      type: "buyUpgrade",
      upgradeId: "clock",
      coreIds: [1, 2],
    });

    state = applyAction(state, {
      type: "buyUpgrade",
      upgradeId: "clock",
      coreIds: [1, 2],
    });

    act(() => {
      root.render(
        <HardwareBoard
          visible={deriveVisibleState(state)}
          dispatch={dispatch}
          selectedComponent="cores:1"
          onSelectComponent={onSelectComponent}
        />,
      );
    });

    const downgradableStepper = Array.from(
      container.querySelectorAll<HTMLElement>(".core-control-strip .upgrade-stepper"),
    ).find((stepper) => stepper.textContent?.includes("All clocks"));
    const downgradeButtons = Array.from(
      downgradableStepper?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );

    act(() => {
      downgradeButtons[0]?.click();
    });

    expect(dispatch).toHaveBeenLastCalledWith({
      type: "downgradeUpgrade",
      upgradeId: "clock",
      coreIds: [1, 2],
    });
  });

  it("steps core grids through fixed row and column layouts", () => {
    const base = deriveVisibleState(createInitialGameState());
    const baseSocket = base.metrics.cpuSockets[0]!;
    const baseCore = baseSocket.cores[0]!;
    const cases = [
      [1, "1x2", "2", "normal"],
      [4, "2x2", "2", "normal"],
      [8, "2x4", "4", "compact"],
      [12, "2x6", "6", "compact"],
      [16, "2x8", "8", "compact"],
      [24, "2x12", "12", "dense"],
      [32, "2x16", "16", "dense"],
      [48, "3x16", "16", "dense"],
    ] as const;

    for (const [coreCount, layout, columns, density] of cases) {
      const cores = Array.from({ length: coreCount }, (_, index) => ({
        ...baseCore,
        id: index + 1,
        label: `Core ${index + 1}`,
      }));
      const visible: VisibleState = {
        ...base,
        hardware: {
          ...base.hardware,
          cores: coreCount,
        },
        metrics: {
          ...base.metrics,
          cpuSockets: [
            {
              ...baseSocket,
              cores,
            },
          ],
        },
      };

      act(() => {
        root.render(
          <HardwareBoard
            visible={visible}
            dispatch={() => undefined}
            selectedComponent="core:1"
            onSelectComponent={() => undefined}
          />,
        );
      });

      const grid = container.querySelector<HTMLElement>(".core-grid");

      expect(grid?.dataset.grid).toBe(layout);
      expect(grid?.style.getPropertyValue("--core-grid-columns")).toBe(columns);
      expect(grid?.className).toContain(density);
    }
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

    const queuedTask = container.querySelector(".queue-slot-cell.pending");
    const cancelButton = container.querySelector<HTMLButtonElement>(
      ".queue-cancel-button",
    );

    expect(queuedTask?.getAttribute("title")).toContain("Fetch Bit");
    expect(queuedTask?.querySelector(".queue-slot-state")?.textContent).toBe(
      "Not enough free cache.",
    );
    expect(cancelButton).not.toBeNull();
  });

  it("sizes scheduler slots through predictable grid steps", () => {
    const base = deriveVisibleState(createInitialGameState());
    const cases = [
      [4, "2x2", "2", "64px", "30px"],
      [8, "4x2", "4", "64px", "30px"],
      [16, "4x4", "4", "108px", "24px"],
      [24, "6x4", "6", "108px", "24px"],
      [36, "6x6", "6", "140px", "20px"],
      [64, "8x8", "8", "144px", "14px"],
    ] as const;

    for (const [slots, gridLabel, columns, gridHeight, slotHeight] of cases) {
      const visible: VisibleState = {
        ...base,
        flags: {
          ...base.flags,
          basicQueue: true,
        },
        hardware: {
          ...base.hardware,
          schedulerSlots: slots,
          cpus: base.hardware.cpus.map((cpu) => ({
            ...cpu,
            schedulerSlots: slots,
          })),
        },
        metrics: {
          ...base.metrics,
          cpuSockets: base.metrics.cpuSockets.map((socket) => ({
            ...socket,
            schedulerSlots: slots,
            queuedCount: 0,
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

      const grid = container.querySelector<HTMLElement>(".queue-preview-list");

      expect(grid?.dataset.grid).toBe(gridLabel);
      expect(grid?.style.getPropertyValue("--scheduler-grid-columns")).toBe(columns);
      expect(grid?.style.getPropertyValue("--scheduler-grid-height")).toBe(gridHeight);
      expect(grid?.style.getPropertyValue("--scheduler-slot-height")).toBe(slotHeight);
      expect(container.querySelectorAll(".queue-slot-cell")).toHaveLength(slots);
      expect(container.querySelectorAll(".queue-slot-cell.empty")).toHaveLength(slots);
    }
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

    const layerSelect = container.querySelector<HTMLSelectElement>(
      ".task-route-layer-select",
    );
    const targetSelect = container.querySelector<HTMLSelectElement>(
      ".task-route-target-select",
    );

    expect(container.textContent).not.toContain("Auto");
    expect(
      Array.from(layerSelect?.options ?? []).map((option) => option.textContent),
    ).toEqual(["C", "CPU", "Sys"]);
    expect(layerSelect?.value).toBe("core");
    expect(targetSelect?.value).toBe("1");

    act(() => {
      targetSelect!.value = "1";
      targetSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(selectComponent).toHaveBeenLastCalledWith("core:1");

    act(() => {
      layerSelect!.value = "scheduler";
      layerSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(selectComponent).toHaveBeenLastCalledWith("scheduler:1");

    act(() => {
      layerSelect!.value = "systemScheduler";
      layerSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(selectComponent).toHaveBeenLastCalledWith("scheduler");
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
    expect(meta?.querySelector(".resource-token.credits")).not.toBeNull();
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
    expect(computeMeta?.textContent).toContain("cache 4 b");
    expect(computeMeta?.querySelector(".resource-token.credits")).not.toBeNull();
    expect(computeMeta?.querySelector(".resource-token.data")).not.toBeNull();
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
          restarts: 0,
          reruns: 0,
          corruptions: 0,
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
    const activeTaskCard = container.querySelector(".task-card.active");

    expect(activeCancel).not.toBeNull();
    expect(activeTaskCard?.querySelector(".task-state-pill")).toBeNull();
    expect(activeTaskCard?.querySelector(".task-status-line")).toBeNull();
    expect(activeTaskCard?.textContent).not.toContain("Active");

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
