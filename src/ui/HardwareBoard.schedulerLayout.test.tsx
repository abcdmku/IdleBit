import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAction,
  createInitialGameState,
  deriveVisibleState,
  exactResourceBag,
  type GameState,
  type VisibleState
} from "../game";
import {
  HardwareBoard,
  TaskBay
} from "./HardwareBoard";
import { QueuePreview } from "./hardware/QueuePreview";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("HardwareBoard scheduler and CPU layouts", () => {
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

  it("shows watchdog controls after research and dispatches scheduler actions", () => {
    const base = deriveVisibleState(createInitialGameState());
    const dispatch = vi.fn();
    const socket = base.metrics.cpuSockets[0]!;
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
        schedulerWatchdog: true,
      },
      hardware: {
        ...base.hardware,
        schedulerSlots: 1,
        cpus: base.hardware.cpus.map((cpu) => ({ ...cpu, schedulerSlots: 1 })),
      },
      metrics: {
        ...base.metrics,
        cpuSockets: [
          {
            ...socket,
            schedulerSlots: 1,
            schedulerConfig: {
              ramPriority: "parallelism",
              cpuPriority: "parallelism",
              autoKillEnabled: false,
              killPolicy: "deadlockedTask",
            },
          },
        ],
      },
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={dispatch}
          selectedComponent="scheduler:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const selects = container.querySelectorAll<HTMLSelectElement>(
      ".scheduler-control select",
    );
    const autoKill = container.querySelector<HTMLInputElement>(
      ".scheduler-control.checkbox input",
    );
    const headerControls = container.querySelector(
      ".scheduler-section .hw-section-header-row .scheduler-controls",
    );
    const bodyControls = container.querySelector(
      ".scheduler-section > .scheduler-controls",
    );
    const titleButton = container.querySelector(
      ".scheduler-section .hw-section-header",
    );
    const controlLabels = Array.from(
      container.querySelectorAll<HTMLElement>(".scheduler-controls .scheduler-control > span"),
    ).map((label) => label.textContent);

    expect(container.textContent).not.toContain("Policy");
    expect(container.textContent).toContain("Auto-kill");
    expect(headerControls).not.toBeNull();
    expect(bodyControls).toBeNull();
    expect(titleButton?.textContent).toBe("Scheduler");
    expect(selects).toHaveLength(1);
    expect(controlLabels).toEqual(["Auto-kill", "Kill"]);

    act(() => {
      autoKill?.click();
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setSchedulerAutoKill",
      target: "cpu",
      cpuId: 1,
      enabled: true,
    });
  });

  it("shows system CPU and RAM priorities only when multiple resources exist", () => {
    const base = deriveVisibleState(createInitialGameState());
    const dispatch = vi.fn();
    const firstSocket = base.metrics.cpuSockets[0]!;
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        scheduler: true,
      },
      hardware: {
        ...base.hardware,
        systemSchedulerSlots: 1,
        systemSchedulerConfig: {
          ...base.hardware.systemSchedulerConfig,
          ramPriority: "parallelism",
          cpuPriority: "parallelism",
        },
      },
      metrics: {
        ...base.metrics,
        cpuSockets: [
          firstSocket,
          {
            ...firstSocket,
            id: 2,
            cores: firstSocket.cores.map((core) => ({ ...core, id: core.id + 1 })),
          },
        ],
        ramSlots: [
          {
            id: 1,
            level: 1,
            sizeBits: 256,
            sizeBytes: 32,
            usedBits: 0,
            usedBytes: 0,
            speedLevel: 1,
            speedMt: 1,
            capacityUpgrade: null,
            speedUpgrade: null,
          },
          {
            id: 2,
            level: 1,
            sizeBits: 256,
            sizeBytes: 32,
            usedBits: 0,
            usedBytes: 0,
            speedLevel: 1,
            speedMt: 1,
            capacityUpgrade: null,
            speedUpgrade: null,
          },
        ],
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

    const ramPriority = container.querySelector<HTMLSelectElement>(
      '.system-scheduler-section select[aria-label="RAM priority"]',
    );
    const cpuPriority = container.querySelector<HTMLSelectElement>(
      '.system-scheduler-section select[aria-label="CPU priority"]',
    );

    expect(ramPriority?.value).toBe("parallelism");
    expect(cpuPriority?.value).toBe("parallelism");

    act(() => {
      ramPriority!.value = "speed";
      ramPriority!.dispatchEvent(new Event("change", { bubbles: true }));
      cpuPriority!.value = "capacity";
      cpuPriority!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "setSchedulerResourcePriority",
      resource: "ram",
      priority: "speed",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setSchedulerResourcePriority",
      resource: "cpu",
      priority: "capacity",
    });
  });

  it("shows deadlock cooldown before the CPU queue slot upgrade", () => {
    const base = deriveVisibleState(createInitialGameState());
    const socket = base.metrics.cpuSockets[0]!;
    const makeUpgrade = (
      id: "schedulerSlot" | "deadlockRecovery",
      name: string,
    ): VisibleState["upgrades"][number] => ({
      id,
      name,
      component: "scheduler",
      accent: "violet",
      costs: [],
      refunds: [],
      canAfford: true,
      canDowngrade: false,
      downgradeBlockedReason: null,
      purchaseCount: 0,
    });
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
        schedulerWatchdog: true,
      },
      hardware: {
        ...base.hardware,
        schedulerSlots: 1,
        cpus: base.hardware.cpus.map((cpu) => ({ ...cpu, schedulerSlots: 1 })),
      },
      metrics: {
        ...base.metrics,
        cpuSockets: [
          {
            ...socket,
            schedulerSlots: 1,
            schedulerSlotUpgrade: makeUpgrade("schedulerSlot", "CPU Queue Slot"),
            deadlockRecoveryUpgrade: makeUpgrade(
              "deadlockRecovery",
              "Deadlock Cooldown",
            ),
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
      Array.from(
        container.querySelectorAll(
          ".scheduler-section .inline-upgrade-row .upgrade-stepper-spec > span:first-child",
        ),
      ).map((label) => label.textContent),
    ).toEqual(["Deadlock Cooldown", "CPU Queue Slot"]);
  });

  it("selects scheduler sections from non-button surfaces", () => {
    const base = deriveVisibleState(createInitialGameState());
    const dispatch = vi.fn();
    const onSelectComponent = vi.fn();
    const socket = base.metrics.cpuSockets[0]!;
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
        scheduler: true,
      },
      hardware: {
        ...base.hardware,
        schedulerSlots: 2,
        systemSchedulerSlots: 2,
        cpus: base.hardware.cpus.map((cpu) => ({ ...cpu, schedulerSlots: 2 })),
      },
      upgrades: [
        {
          id: "systemSchedulerSlot",
          name: "System Queue Slot",
          component: "scheduler",
          accent: "violet",
          costs: [],
          refunds: [],
          canAfford: true,
          canDowngrade: false,
          downgradeBlockedReason: null,
          purchaseCount: 2,
        },
      ],
      metrics: {
        ...base.metrics,
        cpuSockets: [
          {
            ...socket,
            schedulerSlots: 2,
            queuedCount: 0,
          },
        ],
      },
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={dispatch}
          selectedComponent={null}
          onSelectComponent={onSelectComponent}
        />,
      );
    });

    const cpuSchedulerSlot = container.querySelector<HTMLElement>(
      ".scheduler-section:not(.system-scheduler-section) .queue-empty",
    );
    const systemSchedulerSlot = container.querySelector<HTMLElement>(
      ".system-scheduler-section .queue-empty",
    );
    const killButton = container.querySelector<HTMLButtonElement>(
      ".psu-section .power-control-buttons button.danger",
    );
    const systemSchedulerUpgrade = container.querySelector<HTMLElement>(
      ".system-scheduler-section .inline-upgrade-row",
    );

    expect(systemSchedulerUpgrade?.textContent).toContain("System Queue Slot");
    // Power state lives only on the PSU; the scheduler card has no shutdown.
    expect(container.querySelector(".system-shutdown-button")).toBeNull();

    act(() => {
      cpuSchedulerSlot?.click();
    });
    expect(onSelectComponent).toHaveBeenLastCalledWith("scheduler:1");

    act(() => {
      systemSchedulerSlot?.click();
    });
    expect(onSelectComponent).toHaveBeenLastCalledWith("scheduler");

    onSelectComponent.mockClear();
    act(() => {
      killButton?.click();
    });

    expect(onSelectComponent).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({ type: "killPower" });
  });

  it("shows scheduler watchdog victim and countdown", () => {
    const base = deriveVisibleState(createInitialGameState());
    const socket = base.metrics.cpuSockets[0]!;
    const makeVisible = (
      secondsRemaining: number,
      progress: number,
    ): VisibleState => ({
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
        schedulerWatchdog: true,
      },
      hardware: {
        ...base.hardware,
        schedulerSlots: 1,
        cpus: base.hardware.cpus.map((cpu) => ({ ...cpu, schedulerSlots: 1 })),
      },
      metrics: {
        ...base.metrics,
        cpuSockets: [
          {
            ...socket,
            schedulerSlots: 1,
            schedulerConfig: {
              ramPriority: "parallelism",
              cpuPriority: "parallelism",
              autoKillEnabled: true,
              killPolicy: "deadlockedTask",
            },
            watchdog: {
              target: "cpu",
              cpuId: 1,
              resource: "cache",
              killPolicy: "deadlockedTask",
              deadlockedTaskId: "byteCopy",
              deadlockedTaskName: "Byte Copy",
              deadlockedInstanceId: "task-2",
              victimTaskId: "byteCopy",
              victimTaskName: "Byte Copy",
              victimInstanceId: "task-2",
              victimCoreIds: [1],
              secondsRemaining,
              progress,
            },
          },
        ],
      },
    });

    act(() => {
      root.render(
        <HardwareBoard
          visible={makeVisible(1.5, 0.5)}
          dispatch={() => undefined}
          selectedComponent="scheduler:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const status = container.querySelector<HTMLElement>(
      ".scheduler-watchdog-status",
    );
    const headerStatus = container.querySelector(
      ".scheduler-section .hw-section-header-row .scheduler-watchdog-status",
    );
    const bodyStatus = container.querySelector(
      ".scheduler-section > .scheduler-watchdog-status",
    );
    const headerChildren = Array.from(
      container.querySelectorAll(".scheduler-section .scheduler-header-row > *"),
    );

    expect(status?.textContent).toContain("Byte Copy");
    expect(status?.textContent).toContain("C1");
    expect(status?.textContent).toContain("in 2s");
    expect(headerStatus).not.toBeNull();
    expect(bodyStatus).toBeNull();
    expect(headerChildren[0]?.className).toContain("hw-section-header");
    expect(headerChildren[1]?.className).toContain("scheduler-watchdog-status");
    expect(headerChildren[2]?.className).toContain("scheduler-controls");
    expect(
      status?.querySelector<HTMLElement>(".scheduler-watchdog-meter span")?.style
        .getPropertyValue("--meter-progress"),
    ).toBe("0.5");
    expect(
      status
        ?.querySelector<HTMLElement>(".scheduler-watchdog-meter")
        ?.getAttribute("aria-valuenow"),
    ).toBe("50");

    act(() => {
      root.render(
        <HardwareBoard
          visible={makeVisible(0.75, 0.75)}
          dispatch={() => undefined}
          selectedComponent="scheduler:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const updatedMeter = container.querySelector<HTMLElement>(
      ".scheduler-watchdog-meter",
    );

    expect(
      updatedMeter
        ?.querySelector<HTMLElement>("span")
        ?.style.getPropertyValue("--meter-progress"),
    ).toBe("0.75");
    expect(updatedMeter?.getAttribute("aria-valuenow")).toBe("75");
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
    const coreDie = standaloneCores?.querySelector<HTMLElement>(".core-die");

    expect(container.querySelector(".cpu-package")).toBeNull();
    expect(standaloneCores).not.toBeNull();
    expect(standaloneCores?.closest(".cpu-package")).toBeNull();
    expect(
      standaloneCores?.querySelector(".core-array-efficiency")?.textContent,
    ).toContain("Eff");
    expect(
      standaloneCores?.querySelector(".core-array-efficiency")?.textContent,
    ).toContain("10");
    expect(standaloneCores?.querySelector(".core-array-header small")).toBeNull();
    expect(
      coreDie?.querySelector(".core-work")?.textContent,
    ).toBe("Idle");
    expect(coreDie?.style.getPropertyValue("--core-status-color")).toBe("");

    const runningState = applyAction(createInitialGameState(), {
      type: "startTask",
      taskId: "fetchBit",
    });

    act(() => {
      root.render(
        <HardwareBoard
          visible={deriveVisibleState(runningState)}
          dispatch={() => undefined}
          selectedComponent="core:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const runningCoreDie = container.querySelector<HTMLElement>(".core-die.running");

    expect(runningCoreDie?.style.getPropertyValue("--core-status-color")).toBe(
      "hsla(168, 82%, 62%, 0.94)",
    );

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
    expect(cpuPackage?.querySelector(".cpu-package-meta")?.textContent).toContain(
      "Eff",
    );
    expect(cpuPackage?.querySelector(".core-array-efficiency")).toBeNull();
  });

  it("uses a dense stacked core array that can scale to two dozen cores", () => {
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
    expect(grid?.dataset.grid).toBe("3x8");
    expect(grid?.style.getPropertyValue("--core-grid-columns")).toBe("8");
    expect(grid?.style.getPropertyValue("--core-grid-tablet-columns")).toBe("6");
    expect(grid?.style.getPropertyValue("--core-grid-mobile-columns")).toBe("4");
    expect(container.querySelectorAll(".core-die")).toHaveLength(24);
    expect(schedulerCacheRow?.querySelector(".scheduler-section")).not.toBeNull();
    expect(schedulerCacheRow?.querySelector(".cache-section")).not.toBeNull();
    expect(container.querySelector(".core-cache-row")).toBeNull();
    expect(
      container.querySelector(".core-array-section .upgrade-stepper")?.textContent,
    ).toContain("Core Freq");
  });

  it("stacks ten-core arrays instead of widening inside the narrow cache row", () => {
    const base = deriveVisibleState(createInitialGameState());
    const baseSocket = base.metrics.cpuSockets[0]!;
    const baseCore = baseSocket.cores[0]!;
    const cores = Array.from({ length: 10 }, (_, index) => ({
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
        cores: 10,
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

    const coreCacheRow = container.querySelector(".core-cache-row");
    const grid = coreCacheRow?.querySelector<HTMLElement>(".core-grid.compact");

    expect(grid?.dataset.grid).toBe("3x4");
    expect(grid?.style.getPropertyValue("--core-grid-columns")).toBe("4");
    expect(coreCacheRow?.querySelector(".core-array-section")).not.toBeNull();
    expect(coreCacheRow?.querySelector(".cache-section")).not.toBeNull();
    expect(container.querySelector(".scheduler-cache-row")).toBeNull();
    expect(container.querySelector(".core-status-dot")).toBeNull();
    expect(container.querySelectorAll(".core-die .die-progress")).toHaveLength(10);
  });

  it("shows one package frequency control without an all-core selector", () => {
    const initial = createInitialGameState();
    let state: GameState = {
      ...initial,
      resources: { credits: 500, data: 500 },
      exactResources: exactResourceBag(500, 500),
      flags: {
        ...initial.flags,
        multiCore: true,
        basicQueue: true,
      },
    };
    state = applyAction(state, { type: "buyUpgrade", upgradeId: "core", cpuId: 1 });
    const dispatch = vi.fn();

    act(() => {
      root.render(
        <HardwareBoard
          visible={deriveVisibleState(state)}
          dispatch={dispatch}
          selectedComponent="core:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    expect(container.querySelector(".core-select-all-button")).toBeNull();
    const packageStepper = Array.from(
      container.querySelectorAll<HTMLElement>(".core-control-strip .upgrade-stepper"),
    ).find((stepper) => stepper.textContent?.includes("Core Freq"));

    expect(packageStepper?.textContent).toContain("26");
    // Selection state lives on each die's stretched select button (the die
    // itself is a plain container, so no nested-interactive markup).
    const dieSelects = Array.from(
      container.querySelectorAll(".core-die > .core-die-select"),
    );
    expect(dieSelects.map((core) => core.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
    ]);

    const packageButtons = Array.from(
      packageStepper?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );

    act(() => {
      packageButtons[1]?.click();
    });

    expect(dispatch).toHaveBeenLastCalledWith({
      type: "buyUpgrade",
      upgradeId: "clock",
      cpuId: 1,
    });

    state = applyAction(state, {
      type: "buyUpgrade",
      upgradeId: "clock",
      cpuId: 1,
    });

    act(() => {
      root.render(
        <HardwareBoard
          visible={deriveVisibleState(state)}
          dispatch={dispatch}
          selectedComponent="core:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const downgradableStepper = Array.from(
      container.querySelectorAll<HTMLElement>(".core-control-strip .upgrade-stepper"),
    ).find((stepper) => stepper.textContent?.includes("Core Freq"));
    const downgradeButtons = Array.from(
      downgradableStepper?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );

    act(() => {
      downgradeButtons[0]?.click();
    });

    expect(dispatch).toHaveBeenLastCalledWith({
      type: "downgradeUpgrade",
      upgradeId: "clock",
      cpuId: 1,
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
      [12, "3x4", "4", "compact"],
      [16, "4x4", "4", "compact"],
      [24, "3x8", "8", "dense"],
      [32, "4x8", "8", "dense"],
      [48, "6x8", "8", "dense"],
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
          ? { ...task, blockedReason: "No idle core available." }
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
      "No idle core available.",
    );
    expect(cancelButton).not.toBeNull();
  });

  it("sizes scheduler slots through predictable grid steps", () => {
    const base = deriveVisibleState(createInitialGameState());
    const cases = [
      [4, "2x2", "2", "64px", "30px"],
      [6, "3x2", "3", "64px", "30px"],
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

      expect(gridLabel).toBeTruthy();
      expect(columns).toBeTruthy();
      expect(gridHeight).toBeTruthy();
      expect(slotHeight).toBeTruthy();
      expect(container.querySelector(".queue-preview-list")).toBeNull();
      expect(container.querySelectorAll(".queue-slot-cell")).toHaveLength(0);
      expect(container.querySelector(".queue-empty")?.textContent).toBe(
        `${slots} open`,
      );
    }
  });

  it("reserves the queue preview footprint from purchased capacity across occupancy", () => {
    const renderItems = (count: number) => {
      const queueItems = Array.from({ length: count }, (_, index) => ({
        id: `task-${count}-${index}`,
        name: "Power Telemetry",
        waitingReason: "Ready",
        active: true,
        progress: 0.25,
      }));

      act(() => {
        root.render(
          <QueuePreview
            items={queueItems}
            slotCapacity={9}
            ariaLabel="System scheduler queue"
            dispatch={() => undefined}
            startSmall
          />,
        );
      });
    };

    // Capacity 9 pins a 3x3 grid at 98px no matter how full the queue is.
    for (const count of [0, 7, 9]) {
      renderItems(count);
      const preview = container.querySelector<HTMLElement>(".queue-preview");
      expect(
        preview?.style.getPropertyValue("--scheduler-preview-height"),
      ).toBe("98px");
      expect(preview?.style.getPropertyValue("--scheduler-grid-height")).toBe(
        "98px",
      );
    }

    // Partially filled: items render individually, remaining capacity keeps
    // one open-summary cell inside the reserved grid.
    renderItems(7);
    const list = container.querySelector<HTMLElement>(".queue-preview-list");
    expect(list?.dataset.grid).toBe("3x3");
    expect(container.querySelectorAll(".queue-slot-cell")).toHaveLength(8);
    expect(container.querySelector(".queue-open-summary")?.textContent).toBe(
      "2 open",
    );

    renderItems(9);
    const fullList = container.querySelector<HTMLElement>(".queue-preview-list");
    expect(fullList?.dataset.grid).toBe("3x3");
    expect(container.querySelectorAll(".queue-slot-cell")).toHaveLength(9);
  });

  it("keys queue cells by queue-entry identity, not list position", () => {
    const makeItem = (key: string) => ({
      id: "byteCopy",
      key,
      name: "Byte Copy",
      waitingReason: "Ready",
      active: false,
      progress: 0,
    });

    act(() => {
      root.render(
        <QueuePreview
          items={[makeItem("entry-1"), makeItem("entry-2")]}
          slotCapacity={2}
          ariaLabel="System scheduler queue"
          dispatch={() => undefined}
        />,
      );
    });

    const cells = container.querySelectorAll(".queue-slot-cell");
    expect(cells).toHaveLength(2);
    const secondCell = cells[1]!;

    // Completing the first duplicate entry must not remount (or reuse the
    // first entry's DOM for) the surviving one: its key is the entry id.
    act(() => {
      root.render(
        <QueuePreview
          items={[makeItem("entry-2")]}
          slotCapacity={2}
          ariaLabel="System scheduler queue"
          dispatch={() => undefined}
        />,
      );
    });

    const remaining = container.querySelectorAll(
      ".queue-slot-cell:not(.queue-open-summary)",
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(secondCell);
  });

  it("reports the available system scheduler slot count", () => {
    const base = deriveVisibleState(createInitialGameState());
    const cases = [1, 2, 4] as const;

    for (const slots of cases) {
      const visible: VisibleState = {
        ...base,
        flags: {
          ...base.flags,
          scheduler: true,
          systemStats: true,
        },
        hardware: {
          ...base.hardware,
          systemSchedulerSlots: slots,
        },
      };

      act(() => {
        root.render(
          <HardwareBoard
            visible={visible}
            dispatch={() => undefined}
            selectedComponent="scheduler"
            onSelectComponent={() => undefined}
          />,
        );
      });

      expect(
        container.querySelector(".system-scheduler-section .queue-preview-list"),
      ).toBeNull();
      expect(
        container.querySelectorAll(".system-scheduler-section .queue-slot-cell"),
      ).toHaveLength(0);
      expect(
        container.querySelector(".system-scheduler-section .queue-empty")?.textContent,
      ).toBe(`${slots} open`);
    }
  });

  it("routes system tasks through the system scheduler regardless of CPU selection", () => {
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

});
