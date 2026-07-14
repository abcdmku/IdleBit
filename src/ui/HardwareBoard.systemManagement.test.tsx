import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialGameState,
  deriveVisibleState,
  exactResourceBag,
  type VisibleState
} from "../game";
import {
  HardwareBoard
} from "./HardwareBoard";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

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

    expect(flow?.firstElementChild?.className).toContain("system-work-summary");
    expect(schedulerSection).not.toBeNull();
    expect(container.querySelector(".system-board-frame")).toBeNull();
    expect(cronSection).toBeNull();
    // Draw / capacity fraction prints the shared watt unit once; the DRAW
    // stat tile keeps the full wording in its tooltip/aria-label.
    expect(psuSection?.textContent).toContain("32");
    expect(psuSection?.textContent).not.toContain("32 W");
    expect(
      psuSection
        ?.querySelector('.stat-tile[title^="Power draw"]')
        ?.getAttribute("title"),
    ).toContain("65 W");
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

  it("renders newly unlocked hardware as paid install outlines", () => {
    const dispatch = vi.fn();
    const base = createInitialGameState();
    const visible = deriveVisibleState({
      ...base,
      resources: { credits: 20_000, data: 20_000 },
      exactResources: exactResourceBag(20_000, 20_000),
      flags: {
        ...base.flags,
        basicQueue: true,
        systemStats: true,
        scheduler: true,
        cron: true,
      },
      research: {
        completed: [
          "localScheduler",
          "ramControl",
          "systemScheduler",
          "cronScheduler",
        ],
      },
    });

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

    const installSections = Array.from(
      container.querySelectorAll<HTMLElement>(".install-hardware-section"),
    );
    const findInstall = (label: string) =>
      installSections.find((section) => section.textContent?.includes(label));

    expect(findInstall("Install first queue slot")?.querySelector(".resource-token")).not.toBeNull();
    expect(
      findInstall("Install first system queue slot")?.querySelector(".resource-token"),
    ).not.toBeNull();
    expect(findInstall("Install first RAM stick")?.querySelector(".resource-token")).not.toBeNull();
    expect(findInstall("Install first CRON job slot")?.querySelector(".resource-token")).not.toBeNull();

    act(() => {
      findInstall("Install first queue slot")
        ?.querySelector<HTMLButtonElement>(".install-hardware-button")
        ?.click();
      findInstall("Install first system queue slot")
        ?.querySelector<HTMLButtonElement>(".install-hardware-button")
        ?.click();
      findInstall("Install first RAM stick")
        ?.querySelector<HTMLButtonElement>(".ram-install-tier-button")
        ?.click();
      findInstall("Install first CRON job slot")
        ?.querySelector<HTMLButtonElement>(".install-hardware-button")
        ?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "buyUpgrade",
      upgradeId: "schedulerSlot",
      cpuId: 1,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "buyUpgrade",
      upgradeId: "systemSchedulerSlot",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "buyUpgrade",
      upgradeId: "ram",
      ramTierId: "hz",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "buyUpgrade",
      upgradeId: "cronSchedule",
    });
  });

  it("lists matched and unmatched CPU install choices with power deltas", () => {
    const dispatch = vi.fn();
    const base = deriveVisibleState(createInitialGameState());
    const visible = {
      ...base,
      flags: {
        ...base.flags,
        secondCpu: true,
        systemStats: true,
      },
      hardware: {
        ...base.hardware,
        secondCpu: false,
        ramBits: 1024,
        ramBytes: 128,
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

    const cpuPackage = container.querySelector(".cpu-package");
    const headerInstall = cpuPackage?.querySelector(
      ".cpu-package-header-install",
    );
    const buttons = cpuPackage?.querySelectorAll<HTMLButtonElement>(
      ".cpu-install-option",
    );

    expect(container.querySelector(".empty-socket")).toBeNull();
    expect(cpuPackage?.querySelector(".cpu-package-install")).toBeNull();
    expect(cpuPackage?.textContent).toContain("Unmatched CPU");
    expect(cpuPackage?.textContent).toContain("Matched CPU");
    expect(headerInstall?.textContent).not.toContain("Buy CPU");
    expect(cpuPackage?.textContent).toContain("+1.2 mW");
    expect(cpuPackage?.textContent).toContain("+4.2 mW");
    expect(cpuPackage?.textContent).not.toContain("MW");

    act(() => {
      buttons?.[1]?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "buyUpgrade",
      upgradeId: "matchedCpu",
    });
  });

  it("puts pre-RAM CPU socket install controls in the socket header", () => {
    const dispatch = vi.fn();
    const base = deriveVisibleState(createInitialGameState());
    const visible = {
      ...base,
      flags: {
        ...base.flags,
        secondCpu: true,
      },
      upgrades: [
        {
          id: "secondCpu",
          name: "Install CPU",
          component: "socket",
          accent: "cyan",
          costs: [{ resource: "credits", amount: 900 }],
          refunds: [],
          powerDeltaWatts: 0.0012,
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
          selectedComponent="socket"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const socketSection = container.querySelector<HTMLElement>(".cpu-section");
    const headerInstall = socketSection?.querySelector<HTMLElement>(
      ".cpu-socket-header-install",
    );
    const bodyInstall = Array.from(socketSection?.children ?? []).find((child) =>
      child.classList.contains("cpu-install-options"),
    );
    const button = headerInstall?.querySelector<HTMLButtonElement>(
      ".cpu-install-option",
    );

    expect(headerInstall?.textContent).toContain("Install CPU");
    expect(headerInstall?.textContent).not.toContain("Buy CPU");
    expect(bodyInstall).toBeUndefined();

    act(() => {
      button?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "buyUpgrade",
      upgradeId: "secondCpu",
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
      "CRON",
    );
    expect(container.querySelector(".cron-section")?.textContent).not.toContain(
      "System Automation",
    );
    expect(
      container.querySelector(".cron-next small")?.textContent,
    ).toBe("Next");
    expect(container.querySelector(".cron-section")?.textContent).toContain("12s");
    expect(container.querySelector(".cron-section")?.textContent).not.toContain(
      "11.2s",
    );
    // The cadence floor is a MIN stat tile; its tooltip keeps the wording.
    const minTile = container.querySelector(
      '.cron-section .stat-tile[title^="Smallest interval"]',
    );
    expect(minTile?.textContent).toContain("30s");
    expect(minTile?.textContent).toContain("Min");
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

  it("keeps the user's seconds/minutes choice at 60s-multiple intervals", () => {
    const dispatch = vi.fn();
    const renderWithSchedule = (schedule: Record<string, unknown>) => {
      const visible = makeSecondCpuVisible({
        flags: { cronScheduler: true },
      });
      (visible as unknown as Record<string, unknown>).cron = {
        unlocked: true,
        minIntervalSeconds: 60,
        schedules: [schedule],
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
    };
    const activeModeLabel = () =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".cron-mode-control button",
        ),
      ).find((button) => button.getAttribute("aria-pressed") === "true")
        ?.textContent;
    const intervalInput = () =>
      container.querySelector<HTMLInputElement>(".cron-interval-control input");

    // Canonical sim shape: intervalMode/intervalValue. The user's persisted
    // "seconds" choice must win over the 60s-multiple minutes inference.
    renderWithSchedule({
      id: "main",
      taskId: "tinyChecksum",
      enabled: true,
      intervalMode: "seconds",
      intervalValue: 60,
      remainingSeconds: 5,
    });
    expect(activeModeLabel()).toBe("s");
    expect(intervalInput()?.value).toBe("60");

    // Toggling to minutes dispatches the mode; toggling back to seconds at
    // the same 60s interval dispatches too (the button is not inert).
    act(() => {
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".cron-mode-control button",
        ),
      )
        .find((button) => button.textContent === "m")
        ?.click();
    });
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "setCronScheduleInterval",
        scheduleId: "main",
        intervalSeconds: 60,
        intervalMode: "minutes",
        intervalValue: 1,
      }),
    );

    renderWithSchedule({
      id: "main",
      taskId: "tinyChecksum",
      enabled: true,
      intervalMode: "minutes",
      intervalValue: 1,
      remainingSeconds: 5,
    });
    expect(activeModeLabel()).toBe("m");
    expect(intervalInput()?.value).toBe("1");
    act(() => {
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".cron-mode-control button",
        ),
      )
        .find((button) => button.textContent === "s")
        ?.click();
    });
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "setCronScheduleInterval",
        scheduleId: "main",
        intervalSeconds: 60,
        intervalMode: "seconds",
        intervalValue: 60,
      }),
    );
  });

  it("shows blank CRON schedules as Select Task and filters unavailable system tasks", () => {
    const visible = makeSecondCpuVisible({
      flags: { cronScheduler: true },
    });
    const runnableTask = visible.tasks[0]!;
    visible.tasks = [
      runnableTask,
      {
        ...runnableTask,
        id: "memoryScrub",
        name: "Memory Scrub",
        canQueue: false,
        queueBlockedReason: "RAM capacity too low.",
      },
      {
        ...runnableTask,
        id: "fetchBit",
        name: "Fetch Bit",
        category: "cpu",
        canQueue: true,
      },
    ];
    (visible as unknown as Record<string, unknown>).cron = {
      unlocked: true,
      minIntervalSeconds: 60,
      schedules: [
        {
          id: "main",
          taskId: null,
          enabled: false,
          intervalSeconds: 60,
          remainingSeconds: 60,
        },
      ],
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={() => undefined}
          selectedComponent="cron"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const taskSelect = container.querySelector<HTMLSelectElement>(
      ".cron-task-control select",
    );
    const optionLabels = Array.from(taskSelect?.options ?? []).map((option) =>
      option.textContent,
    );

    expect(taskSelect?.value).toBe("");
    expect(optionLabels).toEqual(["Select Task", "Tiny Checksum"]);
  });

  it("keeps CPU add/remove in the CPU bank header before the view toggle", () => {
    const dispatch = vi.fn();
    const visible = makeSecondCpuVisible({
      upgrades: [
        {
          id: "secondCpu",
          name: "Install CPU",
          component: "socket",
          accent: "cyan",
          costs: [{ resource: "credits", amount: 900 }],
          refunds: [{ resource: "credits", amount: 450 }],
          canAfford: false,
          canDowngrade: true,
          downgradeBlockedReason: null,
          purchaseCount: 1,
        },
      ],
    });

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

    const headerChildren = Array.from(
      container.querySelectorAll<HTMLElement>(".cpu-bank-header > *"),
    ).map((element) => element.className);
    const cpuControl = container.querySelector<HTMLElement>(
      ".cpu-bank-add .upgrade-stepper",
    );
    const buttons = Array.from(
      cpuControl?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );

    expect(headerChildren[0]).toContain("cpu-bank-title");
    expect(headerChildren.at(-2)).toContain("cpu-bank-add");
    expect(headerChildren.at(-1)).toContain("cpu-bank-toggle");
    expect(cpuControl?.textContent).toContain("CPU");
    expect(cpuControl?.textContent).not.toContain("Install CPU");
    expect(buttons[0]?.disabled).toBe(false);
    expect(buttons[1]?.disabled).toBe(true);

    act(() => {
      buttons[0]?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "downgradeUpgrade",
      upgradeId: "secondCpu",
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
            policy: "fifo",
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
    const coreButton =
      card?.querySelector<HTMLButtonElement>(".cpu-summary-core-cell");

    const queueStates = Array.from(
      card?.querySelectorAll(".cpu-summary-queue-state") ?? [],
    ).map((state) => state.textContent);

    // Reserved geometry: the queue footprint derives from purchased capacity,
    // so every open slot renders as its own fixed cell.
    expect(queue?.classList.contains("slots-4")).toBe(true);
    expect(card?.querySelector(".cpu-summary-scheduler-status")).toBeNull();
    expect(card?.querySelector(".cpu-summary-active")).toBeNull();
    expect(card?.querySelector(".cpu-summary-queue-index")?.textContent).toBe("1");
    expect(queueStates).toEqual(["CACHE", "open", "open", "open"]);
    expect(card?.querySelectorAll(".cpu-summary-queue-slot.empty")).toHaveLength(3);
    expect(card?.querySelector(".cpu-summary-upgrades")).toBeNull();

    // The whole-card select is a stretched real button (no role="button"
    // wrapper with nested controls).
    const cardSelect = card?.querySelector<HTMLButtonElement>(
      ".cpu-summary-select",
    );
    expect(card?.getAttribute("role")).toBe("group");
    act(() => {
      cardSelect?.click();
    });

    expect(onSelectComponent).toHaveBeenLastCalledWith("scheduler:1");
    expect(container.querySelector(".cpu-bank-grid")).not.toBeNull();

    act(() => {
      coreButton?.click();
    });

    expect(onSelectComponent).toHaveBeenLastCalledWith("core:1");
    expect(container.querySelector(".cpu-bank-grid")).not.toBeNull();

    act(() => {
      card?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(onSelectComponent).toHaveBeenLastCalledWith("scheduler:1");
    expect(container.querySelector(".cpu-bank-stack")).not.toBeNull();
    expect(container.querySelector(".cpu-bank-stack .cpu-package")).toBeNull();
    expect(container.querySelector(".cpu-bank-grid")).toBeNull();

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

    act(() => {
      container
        .querySelector<HTMLButtonElement>(".cpu-summary-open")
        ?.click();
    });

    expect(onSelectComponent).toHaveBeenLastCalledWith("scheduler:1");
    expect(container.querySelector(".cpu-bank-stack")).not.toBeNull();
    expect(container.querySelector(".cpu-bank-stack .cpu-package")).toBeNull();
    expect(container.querySelector(".cpu-bank-grid")).toBeNull();
  });

  it("shows CPU efficiency in array cards and tab detail", () => {
    const visible = makeSecondCpuVisible();
    visible.metrics.cpuSockets = visible.metrics.cpuSockets.map((socket) => ({
      ...socket,
      efficiency: 7.5,
    }));

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

    const cardEfficiency = container.querySelector<HTMLElement>(
      ".cpu-summary-card .cpu-summary-efficiency",
    );

    expect(cardEfficiency?.textContent).toContain("Eff");
    expect(cardEfficiency?.textContent).toContain("7.5");

    act(() => {
      container.querySelector<HTMLButtonElement>(".cpu-summary-open")?.click();
    });

    const detailEfficiency = container.querySelector<HTMLElement>(
      ".cpu-bank-stack .core-array-efficiency",
    );

    expect(detailEfficiency?.textContent).toContain("Eff");
    expect(detailEfficiency?.textContent).toContain("7.5");
    expect(container.querySelector(".cpu-bank-stack .core-array-header small")).toBeNull();
    expect(container.querySelector(".cpu-bank-stack .cpu-bank-socket-efficiency")).toBeNull();
    expect(container.querySelector(".cpu-bank-stack .cpu-package")).toBeNull();
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

    const tabLabels = Array.from(
      container.querySelectorAll(".cpu-bank-tab"),
    ).map((label) => label.textContent);
    const fullViewLabels = Array.from(
      container.querySelectorAll(".cpu-bank-stack .core-label"),
    ).map((label) => label.textContent);

    expect(tabLabels).toEqual(["A", "B"]);
    expect(container.querySelector(".cpu-bank-stack .cpu-package")).toBeNull();
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
    expect(container.querySelector(".psu-section")?.textContent).toContain("42");
    expect(container.querySelector(".psu-section")?.textContent).not.toContain(
      "42 W",
    );
    expect(
      container
        .querySelector('.psu-section .stat-tile[title^="Power draw"]')
        ?.getAttribute("title"),
    ).toContain("80 W");
    expect(container.querySelector(".psu-section")?.textContent).toContain("1.3");
    expect(container.querySelector(".psu-section")?.textContent).toContain("cr/s");
    expect(container.querySelector(".psu-section")?.textContent).toContain("4s");
    expect(container.querySelector(".psu-section")?.textContent).toContain("Grace");
    expect(container.querySelector(".psu-section")?.textContent).not.toContain(
      "RAM/CPU match",
    );
    expect(container.querySelector(".psu-section")?.textContent).not.toContain(
      "efficiency",
    );
    expect(container.querySelector(".psu-section")?.textContent).toContain(
      "Capacity",
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
    // The PSU is the single power-state home; no duplicate scheduler control.
    expect(container.querySelector(".system-shutdown-button")).toBeNull();

    act(() => {
      runningButtons[1]?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({ type: "killPower" });

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
    expect(container.querySelector(".system-board.power-transitioning")).toBeNull();
    expect(updatedButtons[0]?.className).toContain("go");
    expect(updatedButtons[0]?.disabled).toBe(false);
    expect(updatedButtons[1]?.disabled).toBe(true);
    expect(container.querySelector(".system-shutdown-button")).toBeNull();

    act(() => {
      updatedButtons[0]?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "setPowerState",
      state: "on",
    });
  });
});
