import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAction,
  createInitialGameState,
  deriveVisibleState,
  serializeSave,
  tickGame,
  type GameState,
  type VisibleState,
} from "../game";
import { idleBitPersistence } from "../platform";
import { App } from "./App";
import { HardwareBoard, ResearchPanel, ResourceHud, TaskBay } from "./HardwareBoard";
import { formatWatts } from "./format";

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

describe("power formatting", () => {
  it("scales watt readouts through startup and rack units", () => {
    expect(formatWatts(0.00042)).toBe("420 uW");
    expect(formatWatts(0.42)).toBe("420 mW");
    expect(formatWatts(42)).toBe("42 W");
    expect(formatWatts(4_200)).toBe("4.2 kW");
  });
});

describe("HardwareBoard power telemetry", () => {
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

  it("shows PSU readouts and recovery controls on the first screen", () => {
    const initial = deriveVisibleState(createInitialGameState());
    const drawWatts = 0.00042;
    const capacityWatts = initial.hardware.psuWatts || 65;
    const visible = {
      ...initial,
      metrics: {
        ...initial.metrics,
        powerUsedWatts: drawWatts,
        powerHeadroomWatts: capacityWatts - drawWatts,
        psuStress: drawWatts / capacityWatts,
        powerCostPerSecond: 0,
      },
    } as VisibleState;

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent={null}
          onSelectComponent={() => undefined}
        />,
      );
    });

    const psuSection = container.querySelector(".psu-section");

    expect(psuSection?.textContent).toContain("PSU");
    expect(psuSection?.textContent).toContain("Boot");
    expect(psuSection?.textContent).toContain("Kill");
    expect(psuSection?.textContent).toContain("420 uW");
    expect(psuSection?.textContent).toContain(formatWatts(capacityWatts));
    expect(psuSection?.textContent).not.toContain("grace");
    expect(psuSection?.textContent).not.toContain("stress");
    expect(psuSection?.textContent).not.toContain("headroom");
    expect(psuSection?.textContent).not.toContain("efficiency");
    expect(psuSection?.textContent).toContain("cr/s");
    expect(psuSection?.textContent).toContain("PSU Capacity");
    expect(psuSection?.textContent).not.toContain("Research PSU Management");
    expect(psuSection?.querySelector(".resource-token.data")).toBeNull();
    const buttons = Array.from(
      psuSection?.querySelectorAll<HTMLButtonElement>(".power-control-buttons button") ?? [],
    );
    expect(buttons).toHaveLength(2);
    expect(psuSection?.querySelector(".power-state-chip")).toBeNull();
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[1]?.disabled).toBe(false);
  });

  it("shows overload failure pressure only when the PSU is over capacity", () => {
    const initial = deriveVisibleState(createInitialGameState());
    const visible = {
      ...initial,
      metrics: {
        ...initial.metrics,
        powerUsedWatts: 0.014,
        powerHeadroomWatts: -0.002,
        psuStress: 1.18,
        powerOverloadFailure: {
          seconds: 5,
          limitSeconds: 10,
          remainingSeconds: 5,
          progress: 0.5,
          rate: 1.18,
          active: true,
          tripped: false,
        },
      },
    } as VisibleState;

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent={null}
          onSelectComponent={() => undefined}
        />,
      );
    });

    const psuSection = container.querySelector(".psu-section");
    const headerWarning = psuSection?.querySelector(".psu-header-warning");

    expect(psuSection?.textContent).toContain("5s to fail");
    expect(psuSection?.className).toContain("overloaded");
    expect(headerWarning).not.toBeNull();
    expect(headerWarning?.className).toContain("flashing");
    expect(psuSection?.querySelector(".psu-overload-row")).toBeNull();
    expect(psuSection?.textContent).not.toContain("headroom");
    expect(psuSection?.textContent).not.toContain("efficiency");
  });

  it("shows a pause caption for first PSU failure pressure", () => {
    const dismiss = vi.fn();
    const initial = deriveVisibleState(createInitialGameState());
    const visible = {
      ...initial,
      metrics: {
        ...initial.metrics,
        powerUsedWatts: 0.014,
        powerHeadroomWatts: -0.002,
        psuStress: 1.18,
        powerOverloadFailure: {
          seconds: 3,
          limitSeconds: 10,
          remainingSeconds: 7,
          progress: 0.3,
          rate: 1.18,
          active: true,
          tripped: false,
        },
      },
    } as VisibleState;

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent={null}
          onSelectComponent={() => undefined}
          showPsuFailureHelp
          onDismissPsuFailureHelp={dismiss}
        />,
      );
    });

    const caption = container.querySelector(".deadlock-help-caption.psuFailure");

    expect(caption?.textContent).toContain("PSU failure");
    expect(caption?.textContent).toContain("rebooted");

    act(() => {
      caption?.querySelector<HTMLButtonElement>("button")?.click();
    });

    expect(dismiss).toHaveBeenCalled();
  });

  it("shows boot and shutdown transitions on the PSU before the system card unlocks", () => {
    const initial = deriveVisibleState(createInitialGameState());
    const visible = {
      ...initial,
      metrics: {
        ...initial.metrics,
        powerState: "booting",
        powerTransitionSeconds: 7,
      },
    } as VisibleState;

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent={null}
          onSelectComponent={() => undefined}
        />,
      );
    });

    const psuSection = container.querySelector(".psu-section");

    expect(psuSection?.textContent).toContain("System booting");
    expect(psuSection?.textContent).toContain("7s");

    const shuttingDown = {
      ...visible,
      metrics: {
        ...visible.metrics,
        powerState: "shuttingDown",
        powerTransitionSeconds: 3,
      },
    } as VisibleState;

    act(() => {
      root.render(
        <HardwareBoard
          visible={shuttingDown}
          dispatch={() => undefined}
          selectedComponent={null}
          onSelectComponent={() => undefined}
        />,
      );
    });

    expect(container.querySelector(".psu-section")?.textContent).toContain(
      "System shutting down",
    );
    expect(container.querySelector(".psu-section")?.textContent).toContain("3s");
  });
});

describe("HardwareBoard second CPU system management", () => {
  let container: HTMLDivElement;
  let root: Root;
  type VisibleOverrides = Omit<
    Partial<VisibleState>,
    "flags" | "hardware" | "metrics" | "upgrades"
  > & {
    flags?: Record<string, unknown>;
    hardware?: Record<string, unknown>;
    metrics?: Record<string, unknown>;
    upgrades?: unknown[];
  };

  const makeSecondCpuVisible = (overrides: VisibleOverrides = {}) => {
    const base = deriveVisibleState(createInitialGameState());
    const baseSocket = base.metrics.cpuSockets[0]!;
    const baseCore = baseSocket.cores[0]!;
    const secondSocket = {
      ...baseSocket,
      id: 2,
      label: "CPU 2",
      cores: [
        {
          ...baseCore,
          id: 2,
          label: "Core 2",
          scheduler: {
            ...baseCore.scheduler,
            localQueue: [],
          },
        },
      ],
      schedulerSlots: 1,
      queuedCount: 0,
    };
    const systemTask = {
      ...base.tasks[0]!,
      id: "tinyChecksum",
      name: "Tiny Checksum",
      category: "system",
      operationCount: 8,
      rewardCredits: 24,
      rewardData: 1,
      cacheNeedBits: 8,
      ramNeedBits: 64,
      canStart: true,
      canQueue: true,
      blockedReason: null,
      queueBlockedReason: null,
    };

    return {
      ...base,
      ...overrides,
      flags: {
        ...base.flags,
        secondCpu: true,
        systemStats: true,
        scheduler: true,
        ...(overrides.flags ?? {}),
      },
      hardware: {
        ...base.hardware,
        secondCpu: true,
        cores: 2,
        ramLevel: 1,
        ramBits: 1024,
        ramBytes: 128,
        systemSchedulerSlots: 2,
        psuLevel: 1,
        psuWatts: 65,
        ...(overrides.hardware ?? {}),
      },
      metrics: {
        ...base.metrics,
        cpuSockets: [baseSocket, secondSocket],
        activeCoreCount: 1,
        idleCoreCount: 1,
        ramUsedBits: 128,
        ramUsedBytes: 16,
        powerUsedWatts: 32,
        powerHeadroomWatts: 33,
        psuStress: 0.49,
        powerReliability: 0.86,
        powerCostPerSecond: 1,
        ...(overrides.metrics ?? {}),
      },
      tasks: [systemTask],
      upgrades: overrides.upgrades ?? [],
    } as unknown as VisibleState;
  };

  const cronUpgrade = {
    id: "cronMinInterval",
    name: "CRON Minimum",
    component: "scheduler",
    accent: "violet",
    costs: [{ resource: "data", amount: 10 }],
    refunds: [],
    canAfford: true,
    canDowngrade: false,
    downgradeBlockedReason: null,
    purchaseCount: 0,
  };

  const psuUpgrade = {
    id: "psu",
    name: "PSU Capacity",
    component: "psu",
    accent: "amber",
    costs: [{ resource: "credits", amount: 40 }],
    refunds: [],
    canAfford: true,
    canDowngrade: false,
    downgradeBlockedReason: null,
    purchaseCount: 1,
  };

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

  it("keeps locked automation and thermal modules hidden after second CPU", () => {
    const visible = makeSecondCpuVisible();

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent={null}
          onSelectComponent={() => undefined}
        />,
      );
    });

    const flow = container.querySelector(".system-board-flow");
    const cronSection = container.querySelector(".cron-section");
    const schedulerSection = container.querySelector(".system-scheduler-section");
    const ramSection = container.querySelector(".memory-section");
    const psuSection = container.querySelector(".psu-section");

    expect(flow?.firstElementChild?.className).toContain("system-scheduler-section");
    expect(cronSection).toBeNull();
    expect(psuSection?.textContent).toContain("32 W");
    expect(psuSection?.textContent).toContain("65 W");
    expect(psuSection?.textContent).toContain("Boot");
    expect(psuSection?.textContent).toContain("Kill");
    expect(psuSection?.textContent).toContain("cr/s");
    expect(psuSection?.textContent).not.toContain("Research PSU Management");
    expect(psuSection?.querySelector(".power-control-buttons")).not.toBeNull();
    expect(container.querySelector(".thermal-section")).toBeNull();
    expect(schedulerSection?.textContent).toContain("System Scheduler");
    expect(
      schedulerSection?.compareDocumentPosition(ramSection!) ?? 0,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("lists matched and unmatched CPU install choices with power deltas", () => {
    const dispatch = vi.fn();
    const base = deriveVisibleState(createInitialGameState());
    const visible = {
      ...base,
      flags: {
        ...base.flags,
        secondCpu: true,
      },
      hardware: {
        ...base.hardware,
        secondCpu: false,
      },
      upgrades: [
        {
          id: "secondCpu",
          name: "Unmatched CPU",
          component: "socket",
          accent: "cyan",
          costs: [
            { resource: "credits", amount: 900 },
            { resource: "data", amount: 24 },
          ],
          refunds: [],
          powerDeltaWatts: 0.0012,
          canAfford: true,
          canDowngrade: false,
          downgradeBlockedReason: null,
          purchaseCount: 0,
        },
        {
          id: "matchedCpu",
          name: "Matched CPU",
          component: "socket",
          accent: "amber",
          costs: [
            { resource: "credits", amount: 1200 },
            { resource: "data", amount: 36 },
          ],
          refunds: [],
          powerDeltaWatts: 0.0042,
          canAfford: true,
          canDowngrade: false,
          downgradeBlockedReason: null,
          purchaseCount: 0,
        },
      ],
    } as unknown as VisibleState;

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={dispatch}
          selectedComponent={null}
          onSelectComponent={() => undefined}
        />,
      );
    });

    const socket = container.querySelector(".empty-socket")?.parentElement;
    const buttons = socket?.querySelectorAll<HTMLButtonElement>(
      ".cpu-install-option",
    );

    expect(socket?.textContent).toContain("Unmatched CPU");
    expect(socket?.textContent).toContain("Matched CPU");
    expect(socket?.textContent).toContain("+1.2 mW");
    expect(socket?.textContent).toContain("+4.2 mW");
    expect(socket?.textContent).not.toContain("MW");

    act(() => {
      buttons?.[1]?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "buyUpgrade",
      upgradeId: "matchedCpu",
    });
  });

  it("renders active CRON controls and clamps intervals to the unlocked minimum", () => {
    const dispatch = vi.fn();
    const visible = makeSecondCpuVisible({
      flags: { cronScheduler: true },
      upgrades: [cronUpgrade],
    });
    (visible as unknown as Record<string, unknown>).cron = {
      unlocked: true,
      minIntervalSeconds: 30,
      minIntervalUpgradeId: "cronMinInterval",
      schedules: [
        {
          id: "main",
          taskId: "tinyChecksum",
          enabled: true,
          intervalSeconds: 45,
          minIntervalSeconds: 30,
          remainingSeconds: 11.2,
          lastResult: "Queued",
        },
      ],
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={dispatch}
          selectedComponent="cron"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const taskSelect = container.querySelector<HTMLSelectElement>(
      ".cron-task-control select",
    );
    const modeButtons = container.querySelectorAll<HTMLButtonElement>(
      ".cron-mode-control button",
    );
    const activeMode = Array.from(modeButtons).find(
      (button) => button.getAttribute("aria-pressed") === "true",
    );
    const intervalInput = container.querySelector<HTMLInputElement>(
      ".cron-interval-control input",
    );
    const toggle = container.querySelector<HTMLInputElement>(".cron-toggle input");

    expect(taskSelect?.value).toBe("tinyChecksum");
    expect(activeMode?.textContent).toBe("s");
    expect(intervalInput?.min).toBe("30");
    expect(intervalInput?.value).toBe("45");
    expect(toggle?.checked).toBe(true);
    expect(container.querySelector(".cron-section")?.textContent).toContain(
      "System Automation",
    );
    expect(container.querySelector(".cron-section")?.textContent).toContain(
      "Next job",
    );
    expect(container.querySelector(".cron-section")?.textContent).toContain("12s");
    expect(container.querySelector(".cron-section")?.textContent).not.toContain(
      "11.2s",
    );
    expect(container.querySelector(".cron-section")?.textContent).toContain(
      "Min 30s",
    );
    expect(container.querySelector(".cron-section")?.textContent).toContain(
      "Min interval",
    );
    expect(container.querySelector(".cron-section")?.textContent).not.toContain(
      "Queued",
    );
    expect(container.querySelector(".cron-section")?.textContent).not.toContain(
      "RAM/CPU match",
    );
    expect(container.querySelector(".cron-section")?.textContent).not.toContain(
      "Power efficiency",
    );
    expect(container.querySelector(".psu-section")?.textContent).not.toContain(
      "RAM/CPU match",
    );
    expect(container.querySelector(".psu-section")?.textContent).not.toContain(
      "Power efficiency",
    );

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(intervalInput, "20");
      intervalInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setCronScheduleInterval",
        scheduleId: "main",
        intervalSeconds: 30,
        intervalMode: "seconds",
        intervalValue: 30,
      }),
    );

    act(() => {
      toggle?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "setCronScheduleEnabled",
      scheduleId: "main",
      enabled: false,
    });
  });

  it("keeps concise CPU cards focused on scheduler and core selection", () => {
    const onSelectComponent = vi.fn();
    const visible = makeSecondCpuVisible();
    visible.tasks = visible.tasks.map((task) =>
      task.id === "tinyChecksum"
        ? {
            ...task,
            cacheNeedBits: 999_999,
          }
        : task,
    );
    visible.metrics.cpuSockets = visible.metrics.cpuSockets.map((socket, index) =>
      index === 0
        ? {
            ...socket,
            schedulerSlots: 4,
            queuedCount: 1,
            schedulerConfig: {
              ...socket.schedulerConfig,
              policy: "deadlockSafe",
            },
            cores: socket.cores.map((core, coreIndex) =>
              coreIndex === 0
                ? {
                    ...core,
                    scheduler: {
                      ...core.scheduler,
                      localQueue: ["tinyChecksum"],
                    },
                  }
                : core,
            ),
          }
        : socket,
    );

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent={null}
          onSelectComponent={onSelectComponent}
        />,
      );
    });

    const card = container.querySelector<HTMLElement>(".cpu-summary-card");
    const queue = card?.querySelector<HTMLElement>(".cpu-summary-queue");
    const fullViewButton =
      card?.querySelector<HTMLButtonElement>(".cpu-summary-open");
    const coreButton =
      card?.querySelector<HTMLButtonElement>(".cpu-summary-core-cell");

    expect(queue?.classList.contains("slots-1")).toBe(true);
    expect(card?.querySelector(".cpu-summary-scheduler-status")).toBeNull();
    expect(card?.querySelector(".cpu-summary-queue-index")?.textContent).toBe("1");
    expect(card?.querySelector(".cpu-summary-queue-state")?.textContent).toBe(
      "CACHE",
    );
    expect(card?.textContent).not.toContain("Open");
    expect(card?.querySelector(".cpu-summary-upgrades")).toBeNull();

    act(() => {
      card?.click();
    });

    expect(onSelectComponent).toHaveBeenLastCalledWith("scheduler:1");
    expect(container.querySelector(".cpu-bank-grid")).not.toBeNull();

    act(() => {
      coreButton?.click();
    });

    expect(onSelectComponent).toHaveBeenLastCalledWith("core:1");
    expect(container.querySelector(".cpu-bank-grid")).not.toBeNull();

    act(() => {
      fullViewButton?.click();
    });

    expect(onSelectComponent).toHaveBeenLastCalledWith("scheduler:1");
    expect(container.querySelector(".cpu-bank-stack")).not.toBeNull();
    expect(container.querySelector(".cpu-bank-grid")).toBeNull();
  });

  it("labels cores locally within each CPU socket", () => {
    const visible = makeSecondCpuVisible();
    const [firstSocket, secondSocket] = visible.metrics.cpuSockets;
    const coreTemplate = firstSocket!.cores[0]!;
    const makeCore = (id: number) => ({
      ...coreTemplate,
      id,
      scheduler: {
        ...coreTemplate.scheduler,
        coreId: id,
        localQueue: [],
      },
    });

    visible.hardware.cores = 8;
    visible.metrics.cpuSockets = [
      {
        ...firstSocket!,
        label: "CPU A",
        cores: [1, 2, 3, 4].map(makeCore),
        schedulerSlots: 4,
      },
      {
        ...secondSocket!,
        label: "CPU B",
        cores: [5, 6, 7, 8].map(makeCore),
        schedulerSlots: 4,
      },
    ];

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent={null}
          onSelectComponent={() => undefined}
        />,
      );
    });

    const cards = container.querySelectorAll<HTMLElement>(".cpu-summary-card");
    const secondCardLabels = Array.from(
      cards[1]?.querySelectorAll(".cpu-summary-core-tag") ?? [],
    ).map((label) => label.textContent);

    expect(secondCardLabels).toEqual(["C1", "C2", "C3", "C4"]);

    act(() => {
      cards[1]?.querySelector<HTMLButtonElement>(".cpu-summary-open")?.click();
    });

    const fullViewLabels = Array.from(
      container.querySelectorAll(".cpu-bank-stack .core-label"),
    ).map((label) => label.textContent);

    expect(fullViewLabels).toEqual(["C1", "C2", "C3", "C4"]);
  });

  it("shows active PSU power states and readouts without thermal controls", () => {
    const dispatch = vi.fn();
    const visible = makeSecondCpuVisible({
      upgrades: [psuUpgrade],
      metrics: {
        powerUsedWatts: 42,
        powerCostPerSecond: 1.3,
        psuStress: 0.52,
      },
    });
    (visible as unknown as Record<string, unknown>).systemStatus = {
      powerState: "booting",
      powerTransitionSeconds: 6,
      power: {
        drawWatts: 42,
        capacityWatts: 80,
        costPerSecond: 1.3,
        transitionSeconds: 6,
        billingGraceSeconds: 4,
      },
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={dispatch}
          selectedComponent="psu"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".power-control-buttons button"),
    );

    expect(container.querySelector(".psu-section .power-state-chip")).toBeNull();
    expect(buttons[0]?.className).toContain("active");
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[1]?.disabled).toBe(false);
    expect(container.querySelector(".system-scheduler-section")?.textContent).toContain(
      "System booting",
    );
    expect(container.querySelector(".system-scheduler-section")?.textContent).toContain(
      "6s",
    );
    expect(container.querySelector(".psu-section")?.textContent).not.toContain(
      "System booting",
    );
    expect(container.querySelector(".psu-section")?.textContent).toContain("42 W");
    expect(container.querySelector(".psu-section")?.textContent).toContain("80 W");
    expect(container.querySelector(".psu-section")?.textContent).toContain("1.3");
    expect(container.querySelector(".psu-section")?.textContent).toContain("cr/s");
    expect(container.querySelector(".psu-section")?.textContent).toContain("4s");
    expect(container.querySelector(".psu-section")?.textContent).toContain("grace");
    expect(container.querySelector(".psu-section")?.textContent).not.toContain(
      "RAM/CPU match",
    );
    expect(container.querySelector(".psu-section")?.textContent).not.toContain(
      "efficiency",
    );
    expect(container.querySelector(".psu-section")?.textContent).toContain(
      "PSU Capacity",
    );
    expect(container.querySelector(".thermal-section")).toBeNull();

    (visible as unknown as { systemStatus: Record<string, unknown> }).systemStatus = {
      ...(visible as unknown as { systemStatus: Record<string, unknown> })
        .systemStatus,
      powerState: "on",
    };
    visible.metrics = { ...visible.metrics, powerState: "on" };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={dispatch}
          selectedComponent="psu"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const runningButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".power-control-buttons button"),
    );

    expect(container.querySelector(".psu-section .power-state-chip")).toBeNull();
    expect(runningButtons[0]?.className).not.toContain("active");
    expect(runningButtons[0]?.disabled).toBe(true);
    expect(runningButtons[1]?.disabled).toBe(false);
    expect(
      container.querySelector(".system-shutdown-button")?.textContent,
    ).toContain("Shutdown");

    act(() => {
      runningButtons[1]?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({ type: "killPower" });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(".system-shutdown-button")
        ?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "setPowerState",
      state: "off",
    });

    (visible as unknown as { systemStatus: Record<string, unknown> }).systemStatus = {
      ...(visible as unknown as { systemStatus: Record<string, unknown> })
        .systemStatus,
      powerState: "off",
    };
    visible.metrics = { ...visible.metrics, powerState: "off" };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={dispatch}
          selectedComponent="psu"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const updatedButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".power-control-buttons button"),
    );

    expect(container.querySelector(".psu-section .power-state-chip")).toBeNull();
    expect(container.querySelector(".system-board.power-offline")).not.toBeNull();
    expect(updatedButtons[0]?.className).toContain("go");
    expect(updatedButtons[0]?.disabled).toBe(false);
    expect(updatedButtons[1]?.disabled).toBe(true);
    expect(
      container.querySelector(".system-shutdown-button")?.className,
    ).toContain("start");
    expect(
      container.querySelector(".system-shutdown-button")?.textContent,
    ).toContain("Start system");

    act(() => {
      container
        .querySelector<HTMLButtonElement>(".system-shutdown-button")
        ?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "setPowerState",
      state: "on",
    });
  });
});

describe("App failure modals", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rafSpy: { mockRestore(): void };
  let cancelRafSpy: { mockRestore(): void };
  let originalMatchMedia: typeof window.matchMedia | undefined;

  const makePsuFailureSaveState = (): GameState => {
    const base = createInitialGameState();

    return {
      ...base,
      power: {
        ...base.power,
        state: "off",
        transitionSeconds: 0,
        bootstrapGraceSeconds: 0,
        overloadFailureSeconds: 0,
        lastFailureReason: "psuOverload",
        failureCount: 1,
      },
    };
  };

  const makeCreditFailureSaveState = (): GameState => {
    const base = createInitialGameState();

    return {
      ...base,
      resources: {
        ...base.resources,
        credits: 0,
      },
      power: {
        ...base.power,
        state: "off",
        transitionSeconds: 0,
        bootstrapGraceSeconds: 0,
        overloadFailureSeconds: 0,
        lastFailureReason: "unpaidBill",
        failureCount: 1,
      },
    };
  };

  const flushEffects = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  beforeEach(async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    await idleBitPersistence.clear();
    originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 1);
    cancelRafSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => {
      root.unmount();
    });
    container.remove();
    rafSpy.mockRestore();
    cancelRafSpy.mockRestore();
    if (originalMatchMedia) {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
    await idleBitPersistence.clear();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it("shows and dismisses a compact PSU failure popup after overload cutoff", async () => {
    await idleBitPersistence.set(
      "save-v2",
      serializeSave(makePsuFailureSaveState()),
    );

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    const modal = container.querySelector(".psu-failure-modal");

    expect(modal?.textContent).toContain("PSU failure");
    expect(modal?.textContent).toContain("overload protection tripped");
    expect(modal?.textContent).toContain("cleared active and queued work");
    expect(modal?.textContent).not.toContain("Active processes cleared");
    expect(container.querySelector(".topbar-alert-badge.psu-failure")).toBeNull();

    act(() => {
      modal?.querySelector<HTMLButtonElement>(".psu-failure-primary")?.click();
    });
    await flushEffects();

    expect(container.querySelector(".psu-failure-modal")).toBeNull();
    await expect(
      idleBitPersistence.get<boolean>("ui.psu-failure-modal-seen-v1", false),
    ).resolves.toBe(true);
  });

  it("uses a topbar badge instead of the popup after the first PSU failure", async () => {
    await idleBitPersistence.set(
      "save-v2",
      serializeSave(makePsuFailureSaveState()),
    );
    await idleBitPersistence.set("ui.psu-failure-modal-seen-v1", true);

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    const badge = container.querySelector<HTMLButtonElement>(
      ".topbar-alert-badge.psu-failure",
    );

    expect(container.querySelector(".psu-failure-modal")).toBeNull();
    expect(badge?.textContent).toContain("PSU tripped");

    act(() => {
      badge?.click();
    });

    expect(container.querySelector(".topbar-alert-badge.psu-failure")).toBeNull();
  });

  it("explains the first out-of-credits power cutoff", async () => {
    await idleBitPersistence.set(
      "save-v2",
      serializeSave(makeCreditFailureSaveState()),
    );

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    const modal = container.querySelector(".credit-failure-modal");

    expect(modal?.textContent).toContain("Out of credits");
    expect(modal?.textContent).toContain("Power billing spent the last credits");
    expect(modal?.textContent).toContain("Idle hardware still costs cr/s");
    expect(container.querySelector(".credit-failure-toast")).toBeNull();

    act(() => {
      modal?.querySelector<HTMLButtonElement>(".credit-failure-primary")?.click();
    });
    await flushEffects();

    expect(container.querySelector(".credit-failure-modal")).toBeNull();
    await expect(
      idleBitPersistence.get<boolean>("ui.credit-failure-modal-seen-v1", false),
    ).resolves.toBe(true);
  });

  it("uses a quick popup for later out-of-credits cutoffs", async () => {
    await idleBitPersistence.set(
      "save-v2",
      serializeSave(makeCreditFailureSaveState()),
    );
    await idleBitPersistence.set("ui.credit-failure-modal-seen-v1", true);

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    const toast = container.querySelector(".credit-failure-toast");

    expect(container.querySelector(".credit-failure-modal")).toBeNull();
    expect(toast?.textContent).toContain("Out of credits");
    expect(toast?.textContent).toContain("Power billing shut the system off.");

    act(() => {
      toast?.querySelector<HTMLButtonElement>("button")?.click();
    });

    expect(container.querySelector(".credit-failure-toast")).toBeNull();
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

  it("renders cache buffer only when CPU issue outruns cache writes", () => {
    const initial = createInitialGameState();
    const state = tickGame(
      applyAction(
        {
          ...initial,
          hardware: {
            ...initial.hardware,
            clockLevel: 5,
            coreClockLevels: {
              1: 5,
            },
            cacheSpeedLevel: 1,
          },
        },
        {
          type: "startTask",
          taskId: "fetchBit",
        },
      ),
      500,
    );

    const visible = deriveVisibleState(state);
    const residency = visible.metrics.cacheResidency[0];

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
    expect(residency?.readyBits).toBeCloseTo(0.5);
    expect(residency?.bufferBits).toBeCloseTo(0.5);
    expect(residency?.committedBits).toBeCloseTo(1);
    expect(segment?.style.width).toBe("50%");
    expect(
      Number.parseFloat(
        segment?.style.getPropertyValue("--cache-buffer-progress") ?? "0",
      ),
    ).toBeCloseTo(100);
    expect(
      Number.parseFloat(
        segment?.style.getPropertyValue("--cache-write-progress") ?? "0",
      ),
    ).toBeCloseTo(0);

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

    state = tickGame(state, 500);

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

    expect(visible.metrics.cacheUsedBits).toBeGreaterThan(8);
    expect(visible.metrics.cacheUsedBits).toBeLessThan(16);
    expect(segments).toHaveLength(2);

    const readSegment = segments.find((segment) =>
      segment.className.includes("cache-pressure-read"),
    );
    const writeSegment = segments.find((segment) =>
      segment.className.includes("cache-pressure-write"),
    );

    expect(readSegment?.className).toContain("loaded");
    expect(readSegment?.style.width).toBe("50%");
    expect(writeSegment?.className).toContain("loaded");
    expect(Number.parseFloat(writeSegment?.style.width ?? "0")).toBeGreaterThan(0);
    expect(Number.parseFloat(writeSegment?.style.width ?? "0")).toBeLessThan(50);
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
      expect.stringContaining("Size"),
      expect.stringContaining("Freq"),
    ]);
    expect(container.querySelector(".cache-stat-row")?.textContent).toContain(
      "0 b / 1 b",
    );
    expect(container.querySelector(".cache-capacity-stat strong")).not.toBeNull();
    expect(container.querySelectorAll(".cache-pipeline-row")).toHaveLength(2);
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
    const cacheSize = steppers.find((stepper) =>
      stepper.textContent?.includes("Size"),
    );
    const buttons = Array.from(
      cacheSize?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );

    expect(cacheSize).not.toBeUndefined();
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

  it("uses module, size, and frequency labels for RAM controls", () => {
    const base = deriveVisibleState(createInitialGameState());
    const makeRamUpgrade = (
      id: "ram" | "ramCapacity" | "ramSpeed",
    ): VisibleState["upgrades"][number] => ({
      id,
      name: id,
      component: "ram",
      accent: "green",
      costs: [],
      refunds: [],
      canAfford: true,
      canDowngrade: false,
      downgradeBlockedReason: null,
      purchaseCount: 0,
    });
    const ramCapacityUpgrade = makeRamUpgrade("ramCapacity");
    const ramSpeedUpgrade = makeRamUpgrade("ramSpeed");
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        systemStats: true,
      },
      hardware: {
        ...base.hardware,
        ramLevel: 2,
        ramBits: 512,
        ramBytes: 64,
        ramSpeedLevel: 1,
        ramSpeedMt: 128,
      },
      metrics: {
        ...base.metrics,
        ramUsedBits: 0,
        ramUsedBytes: 0,
        ramSlots: [
          {
            id: 1,
            level: 1,
            sizeBits: 256,
            sizeBytes: 32,
            usedBits: 0,
            usedBytes: 0,
            speedLevel: 1,
            speedMt: 64,
            capacityUpgrade: ramCapacityUpgrade,
            speedUpgrade: ramSpeedUpgrade,
          },
          {
            id: 2,
            level: 1,
            sizeBits: 256,
            sizeBytes: 32,
            usedBits: 0,
            usedBytes: 0,
            speedLevel: 1,
            speedMt: 64,
            capacityUpgrade: ramCapacityUpgrade,
            speedUpgrade: ramSpeedUpgrade,
          },
        ],
      },
      upgrades: [makeRamUpgrade("ram")],
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent="ramStick:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const statLabels = Array.from(
      container.querySelectorAll<HTMLElement>(".ram-stat-row .stat small"),
    ).map((label) => label.textContent);
    const statValues = Array.from(
      container.querySelectorAll<HTMLElement>(".ram-stat-row .stat strong"),
    ).map((label) => label.textContent);
    const controlText = Array.from(
      container.querySelectorAll<HTMLElement>(".ram-control-strip .upgrade-stepper"),
    ).map((control) => control.textContent ?? "");
    const stickText = container.querySelector(".ram-stick-card-stats")?.textContent ?? "";
    const ramText = container.querySelector(".memory-section")?.textContent ?? "";

    expect(statLabels).toEqual(["Capacity", "Module Freq", "Modules"]);
    expect(statValues).toEqual(["512 b", "64 Hz", "2"]);
    expect(controlText).toEqual([
      expect.stringContaining("Module"),
      expect.stringContaining("R1 Size"),
      expect.stringContaining("R1 Freq"),
    ]);
    expect(stickText).toContain("Size");
    expect(stickText).toContain("Freq");
    expect(ramText).not.toContain("128 Hz");
    expect(ramText).not.toContain("New stick");
    expect(ramText).not.toContain("R1 cap");
    expect(ramText).not.toContain("R1 Hz");
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
    const boardTextWithoutRail = Array.from(
      container.querySelectorAll(".system-board-flow > :not(.system-rail)"),
    )
      .map((node) => node.textContent ?? "")
      .join("");
    const grid = container.querySelector<HTMLElement>(".queue-preview-list");

    expect(text).toContain("Cores");
    expect(text).toContain("Cache");
    expect(text).toContain("Scheduler");
    expect(text).not.toContain("used");
    expect(text).not.toContain("2 open");
    expect(text).not.toContain("Queue");
    expect(boardTextWithoutRail).not.toContain("CPU");
    expect(boardTextWithoutRail).not.toContain("CPU A");
    expect(boardTextWithoutRail).not.toContain("CPU A Cache");
    expect(boardTextWithoutRail).not.toContain("CPU A Scheduler");
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

  it("renders deadlocked hardware red with the first-time help caption", () => {
    const base = deriveVisibleState(createInitialGameState());
    const dismiss = vi.fn();
    const socket = base.metrics.cpuSockets[0]!;
    const visible: VisibleState = {
      ...base,
      metrics: {
        ...base.metrics,
        deadlocks: [
          {
            taskId: "fetchBit",
            taskName: "Fetch Bit",
            coreIds: [1],
            cpuId: 1,
            resource: "cache",
            reason: "Deadlock: cache full.",
            schedulerQueued: false,
          },
        ],
        cpuSockets: [
          {
            ...socket,
            deadlocked: true,
            deadlockResource: "cache",
            cores: socket.cores.map((core) =>
              core.id === 1
                ? { ...core, deadlocked: true, deadlockResource: "cache" }
                : core,
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
          selectedComponent="cache"
          onSelectComponent={() => undefined}
          deadlockHelpResource="cache"
          onDismissDeadlockHelp={dismiss}
        />,
      );
    });

    expect(container.querySelector(".cache-section.deadlocked")).not.toBeNull();
    expect(container.querySelector(".core-die.deadlocked")).not.toBeNull();
    expect(container.querySelector(".deadlock-help-caption")?.textContent).toContain(
      "Deadlock: this task is waiting for cache/RAM held by other work.",
    );

    act(() => {
      container.querySelector<HTMLButtonElement>(".deadlock-help-caption button")?.click();
    });

    expect(dismiss).toHaveBeenCalled();
  });

  it("shows the CPU deadlock countdown in the cores header before CPU packages", () => {
    const base = deriveVisibleState(createInitialGameState());
    const socket = base.metrics.cpuSockets[0]!;
    const visible: VisibleState = {
      ...base,
      metrics: {
        ...base.metrics,
        deadlockPressure: {
          seconds: 4,
          limitSeconds: 10,
          remainingSeconds: 6,
          progress: 0.4,
          cooldownRate: 1,
          resource: "cache",
          cpuId: 1,
          active: true,
          lockout: false,
        },
        deadlocks: [
          {
            taskId: "fetchBit",
            taskName: "Fetch Bit",
            coreIds: [1],
            cpuId: 1,
            resource: "cache",
            reason: "Deadlock: cache full.",
            schedulerQueued: false,
          },
        ],
        cpuSockets: [
          {
            ...socket,
            deadlocked: true,
            deadlockResource: "cache",
            cores: socket.cores.map((core) =>
              core.id === 1
                ? { ...core, deadlocked: true, deadlockResource: "cache" }
                : core,
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
          selectedComponent="core:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    expect(
      container.querySelector(".core-array-header .deadlock-countdown")?.textContent,
    ).toBe("6s fail");
    expect(
      container.querySelector<HTMLElement>(
        ".core-array-header .deadlock-countdown-meter span",
      )?.style.width,
    ).toBe("40%");
    expect(container.querySelector(".core-die .deadlock-countdown")).toBeNull();
    expect(container.querySelector(".cpu-package-header .deadlock-countdown")).toBeNull();
  });

  it("moves the CPU deadlock countdown to the CPU header after RAM unlocks", () => {
    const base = deriveVisibleState(createInitialGameState());
    const socket = base.metrics.cpuSockets[0]!;
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
      },
      metrics: {
        ...base.metrics,
        deadlockPressure: {
          seconds: 4,
          limitSeconds: 10,
          remainingSeconds: 6,
          progress: 0.4,
          cooldownRate: 1,
          resource: "cache",
          cpuId: 1,
          active: true,
          lockout: false,
        },
        deadlocks: [
          {
            taskId: "fetchBit",
            taskName: "Fetch Bit",
            coreIds: [1],
            cpuId: 1,
            resource: "cache",
            reason: "Deadlock: cache full.",
            schedulerQueued: false,
          },
        ],
        cpuSockets: [
          {
            ...socket,
            deadlocked: true,
            deadlockResource: "cache",
            cores: socket.cores.map((core) =>
              core.id === 1
                ? { ...core, deadlocked: true, deadlockResource: "cache" }
                : core,
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
          selectedComponent="cpu"
          onSelectComponent={() => undefined}
        />,
      );
    });

    expect(
      container.querySelector(".cpu-package-header .deadlock-countdown")?.textContent,
    ).toBe("6s fail");
    expect(
      container.querySelector<HTMLElement>(
        ".cpu-package-header .deadlock-countdown-meter span",
      )?.style.width,
    ).toBe("40%");
    expect(container.querySelector(".core-array-header .deadlock-countdown")).toBeNull();
    expect(container.querySelector(".core-die .deadlock-countdown")).toBeNull();
  });

  it("keeps a resolved CPU deadlock cooldown visible until it reaches zero", () => {
    const base = deriveVisibleState(createInitialGameState());
    const socket = base.metrics.cpuSockets[0]!;
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
      },
      metrics: {
        ...base.metrics,
        deadlockPressure: {
          seconds: 3,
          limitSeconds: 10,
          remainingSeconds: 7,
          progress: 0.3,
          cooldownRate: 1,
          resource: "cache",
          cpuId: 1,
          active: false,
          lockout: false,
        },
        deadlocks: [],
        cpuSockets: [
          {
            ...socket,
            deadlocked: false,
            deadlockResource: null,
          },
        ],
      },
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent="cpu"
          onSelectComponent={() => undefined}
        />,
      );
    });

    expect(
      container.querySelector(".cpu-package-header .deadlock-countdown")?.textContent,
    ).toBe("3s cool");
    expect(
      container.querySelector<HTMLElement>(
        ".cpu-package-header .deadlock-countdown-meter span",
      )?.style.width,
    ).toBe("30%");
    expect(container.querySelector(".cpu-package.cooling-down")).toBeNull();
    expect(container.querySelector(".cache-section.cooling-down")).toBeNull();
    expect(container.querySelector(".cpu-package.deadlocked")).toBeNull();
    expect(container.querySelector(".cache-section.deadlocked")).toBeNull();
  });

  it("shows deadlock lockout reset as a draining progress bar", () => {
    const base = deriveVisibleState(createInitialGameState());
    const socket = base.metrics.cpuSockets[0]!;
    const makeVisible = (seconds: number): VisibleState => ({
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
      },
      metrics: {
        ...base.metrics,
        deadlockPressure: {
          seconds,
          limitSeconds: 10,
          remainingSeconds: 10 - seconds,
          progress: seconds / 10,
          cooldownRate: 1,
          resource: "cache",
          cpuId: 1,
          active: false,
          lockout: true,
        },
        cpuSockets: [
          {
            ...socket,
            deadlocked: false,
            deadlockResource: null,
          },
        ],
      },
    });

    act(() => {
      root.render(
        <HardwareBoard
          visible={makeVisible(7)}
          dispatch={() => undefined}
          selectedComponent="cpu"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const meter = () =>
      container.querySelector<HTMLElement>(
        ".cpu-package-header .deadlock-countdown-meter span",
      );

    expect(
      container.querySelector(".cpu-package-header .deadlock-countdown")?.textContent,
    ).toBe("7s lock");
    expect(meter()?.style.width).toBe("70%");
    expect(container.querySelector(".cpu-package.cooling-down")).not.toBeNull();
    expect(container.querySelector(".cache-section.cooling-down")).not.toBeNull();
    expect(container.querySelector(".cpu-package.deadlocked")).toBeNull();
    expect(container.querySelector(".cache-section.deadlocked")).toBeNull();

    act(() => {
      root.render(
        <HardwareBoard
          visible={makeVisible(3)}
          dispatch={() => undefined}
          selectedComponent="cpu"
          onSelectComponent={() => undefined}
        />,
      );
    });

    expect(
      container.querySelector(".cpu-package-header .deadlock-countdown")?.textContent,
    ).toBe("3s lock");
    expect(meter()?.style.width).toBe("30%");
  });

  it("shows the one-time cooldown help after the deadlock caption", () => {
    const base = deriveVisibleState(createInitialGameState());
    const dismiss = vi.fn();
    const socket = base.metrics.cpuSockets[0]!;
    const visible: VisibleState = {
      ...base,
      metrics: {
        ...base.metrics,
        deadlockPressure: {
          seconds: 4,
          limitSeconds: 10,
          remainingSeconds: 6,
          progress: 0.4,
          cooldownRate: 1,
          resource: "cache",
          cpuId: 1,
          active: true,
          lockout: false,
        },
        deadlocks: [
          {
            taskId: "fetchBit",
            taskName: "Fetch Bit",
            coreIds: [1],
            cpuId: 1,
            resource: "cache",
            reason: "Deadlock: cache full.",
            schedulerQueued: false,
          },
        ],
        cpuSockets: [
          {
            ...socket,
            deadlocked: true,
            deadlockResource: "cache",
            cores: socket.cores.map((core) =>
              core.id === 1
                ? { ...core, deadlocked: true, deadlockResource: "cache" }
                : core,
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
          selectedComponent="cache"
          onSelectComponent={() => undefined}
          deadlockCooldownHelpResource="cache"
          onDismissDeadlockCooldownHelp={dismiss}
        />,
      );
    });

    const caption = container.querySelector(".deadlock-help-caption");

    expect(caption?.textContent).toContain("if the timer reaches 10s");
    expect(caption?.textContent).toContain(
      "the lockout must drain to 0 before work can start again",
    );

    act(() => {
      caption?.querySelector<HTMLButtonElement>("button")?.click();
    });

    expect(dismiss).toHaveBeenCalled();
  });

  it("shows scheduler controls after research and dispatches scheduler actions", () => {
    const base = deriveVisibleState(createInitialGameState());
    const dispatch = vi.fn();
    const socket = base.metrics.cpuSockets[0]!;
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
        schedulerWatchdog: true,
        schedulerPolicies: true,
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
              policy: "fifo",
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

    expect(container.textContent).toContain("Policy");
    expect(container.textContent).toContain("Auto-kill");
    expect(headerControls).not.toBeNull();
    expect(bodyControls).toBeNull();
    expect(titleButton?.textContent).toBe("Scheduler");
    expect(controlLabels).toEqual(["Policy", "Auto-kill", "Kill"]);

    act(() => {
      selects[0]!.value = "deadlockSafe";
      selects[0]!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setSchedulerPolicy",
      target: "cpu",
      cpuId: 1,
      policy: "deadlockSafe",
    });

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
              policy: "fifo",
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
        .width,
    ).toBe("50%");
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

    expect(updatedMeter?.querySelector<HTMLElement>("span")?.style.width).toBe("75%");
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
      "C1 Freq",
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
    ).find((stepper) => stepper.textContent?.includes("All Freq"));
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
    ).find((stepper) => stepper.textContent?.includes("All Freq"));
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
    expect(taskCard?.querySelector(".task-progress")).toBeNull();
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

    expect(fetchMeta?.textContent).not.toContain("1 cores");
    expect(busMeta?.textContent).toContain("2 cores");
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
              policy: "deadlockSafe",
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
    expect(container.textContent).not.toContain("System scheduler slots full.");
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
