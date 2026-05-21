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
  TaskBay
} from "./HardwareBoard";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("HardwareBoard multi-system rack", () => {
  let container: HTMLDivElement;
  let root: Root;

  const makeRackVisible = () => {
    const base = deriveVisibleState(createInitialGameState());
    const baseSocket = base.metrics.cpuSockets[0]!;
    const baseCore = baseSocket.cores[0]!;
    const betaSocket = {
      ...baseSocket,
      id: 1,
      label: "CPU 1",
      schedulerSlots: 2,
      queuedCount: 0,
      cores: [
        { ...baseCore, id: 1, socketId: 1 },
        { ...baseCore, id: 2, socketId: 1 },
      ],
    };
    const betaSecondSocket = {
      ...baseSocket,
      id: 2,
      label: "CPU 2",
      schedulerSlots: 2,
      queuedCount: 0,
      cores: [
        { ...baseCore, id: 3, socketId: 2 },
        { ...baseCore, id: 4, socketId: 2 },
      ],
    };
    const betaVisible = {
      ...base,
      hardware: {
        ...base.hardware,
        cores: 4,
        systemSchedulerSlots: 1,
        ramBits: 1024,
        ramBytes: 128,
      },
      metrics: {
        ...base.metrics,
        cpuSockets: [betaSocket, betaSecondSocket],
        powerUsedWatts: 42,
        ramUsedBits: 256,
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
          {
            id: 3,
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
            id: 4,
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
    } as VisibleState;
    const systemTask = {
      ...base.tasks[0]!,
      id: "tinyChecksum",
      name: "Tiny Checksum",
      category: "system",
      operationCount: 64,
      rewardCredits: 48,
      rewardData: 2,
      cacheNeedBits: 8,
      ramNeedBits: 128,
      canStart: true,
      canQueue: true,
      blockedReason: null,
      queueBlockedReason: null,
    };
    const betaRackVisible = {
      ...betaVisible,
      tasks: [systemTask],
      queue: ["tinyChecksum"],
      activeTasks: [
        {
          instanceId: "active-beta-1",
          taskId: "tinyChecksum",
          schedulerQueued: true,
          name: "Tiny Checksum",
          coreId: 1,
          assignedCoreIds: [1],
          progress: 0.42,
          status: "running",
          memoryState: "cpu",
        },
      ],
    } as unknown as VisibleState;

    return {
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
      },
      tasks: [systemTask],
      rack: {
        visible: true,
        totalCapacity: 6,
        systems: [
          {
            id: "alpha",
            name: "Alpha",
            role: "Starter",
            visible: base,
          },
          {
            id: "beta",
            name: "Beta",
            role: "Compute",
            visible: betaRackVisible,
          },
        ],
        preconfiguredSystems: [
          {
            id: "balanced",
            name: "Balanced Node",
            role: "Preset",
            components: {
              cpu: "pro",
              ram: "wide",
              scheduler: "queue",
              psu: "supply",
            },
            cores: 2,
            ramBits: 1024,
            powerDeltaWatts: 18,
            costs: [{ resource: "credits", amount: 500 }],
            canAfford: true,
          },
        ],
        customBuilder: {
          title: "Custom",
          canBuy: true,
          groups: [
            {
              id: "cpu",
              label: "CPU",
              tiers: [
                {
                  id: "base",
                  name: "Base",
                  cores: 1,
                  costs: [{ resource: "credits", amount: 100 }],
                },
                {
                  id: "pro",
                  name: "Pro",
                  cores: 2,
                  powerDeltaWatts: 12,
                  costs: [{ resource: "credits", amount: 240 }],
                },
              ],
            },
            {
              id: "memory",
              label: "RAM",
              tiers: [
                {
                  id: "thin",
                  name: "Thin",
                  ramBits: 256,
                  costs: [{ resource: "data", amount: 10 }],
                },
                {
                  id: "wide",
                  name: "Wide",
                  ramBits: 1024,
                  costs: [{ resource: "data", amount: 24 }],
                },
              ],
            },
            {
              id: "scheduler",
              label: "Scheduler",
              tiers: [
                {
                  id: "queue",
                  name: "Queue",
                  schedulerSlots: 4,
                  costs: [{ resource: "data", amount: 8 }],
                },
              ],
            },
            {
              id: "psu",
              label: "PSU",
              tiers: [
                {
                  id: "supply",
                  name: "Supply",
                  psuLevel: 5,
                  powerDeltaWatts: 24,
                  costs: [{ resource: "credits", amount: 80 }],
                },
              ],
            },
          ],
        },
      },
    } as unknown as VisibleState;
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

  it("renders one rack slot per owned system and selects the system scheduler", () => {
    const visible = makeRackVisible();
    const selectComponent = vi.fn();
    const dispatch = vi.fn();

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={dispatch}
          selectedComponent="system:alpha::core:1"
          onSelectComponent={selectComponent}
        />,
      );
    });

    const slots = Array.from(container.querySelectorAll(".system-rack-slot"));

    expect(slots).toHaveLength(2);
    expect(container.querySelector(".system-rack")?.textContent).not.toContain("Alpha");
    expect(container.querySelector(".system-rack")?.textContent).not.toContain("Beta");
    expect(container.querySelector(".system-rack")?.textContent).not.toContain("Starter");
    expect(container.querySelector(".system-rack")?.textContent).not.toContain("Compute");
    expect(container.querySelector(".system-rack")?.textContent).not.toContain("Empty");
    expect(container.querySelector(".system-rack .system-rack-slot--row .rack-slot-copy")).toBeNull();
    expect(container.querySelector(".system-rack .rack-slot-cost")).toBeNull();
    expect(container.querySelector(".system-rack .rack-slot-vitals")).toBeNull();
    expect(container.querySelectorAll(".system-rack .rack-component-stat").length).toBeGreaterThan(0);
    const betaRackSlot = slots[1]!;
    expect(betaRackSlot.querySelector(".rack-component-bay")?.className).toContain(
      "rack-component-bay--scheduler",
    );
    expect(betaRackSlot.querySelector(".rack-component-bay--power")?.textContent).toContain(
      "cr/s",
    );
    expect(
      betaRackSlot.querySelectorAll(".rack-component-bay--power .rack-component-power-value"),
    ).toHaveLength(2);
    expect(betaRackSlot.querySelectorAll(".rack-cpu-package")).toHaveLength(2);
    expect(betaRackSlot.querySelectorAll(".rack-cpu-core-dot")).toHaveLength(4);
    expect(
      betaRackSlot
        .querySelector<HTMLElement>(".rack-cpu-package")
        ?.style.getPropertyValue("--rack-cpu-package-size"),
    ).toBe("36px");
    expect(betaRackSlot.querySelector(".rack-system-queue-slots")).not.toBeNull();
    expect(betaRackSlot.querySelectorAll(".rack-queue-slot-pip")).toHaveLength(1);
    const queuePip = betaRackSlot.querySelector<HTMLElement>(".rack-queue-slot-pip.active");
    expect(queuePip?.style.getPropertyValue("--rack-queue-progress")).toBe("42%");
    expect(queuePip?.getAttribute("title")).toContain("42%");
    expect(betaRackSlot.querySelectorAll(".rack-memory-stick")).toHaveLength(4);
    expect(betaRackSlot.querySelectorAll(".rack-memory-stick.loading")).toHaveLength(1);
    expect(betaRackSlot.tagName).toBe("DIV");
    expect(betaRackSlot.querySelector("[role='button']")).toBeNull();
    expect(
      betaRackSlot.querySelector<HTMLButtonElement>(".rack-slot-power-button")?.tagName,
    ).toBe("BUTTON");
    expect(
      betaRackSlot.querySelector<HTMLButtonElement>(".rack-slot-config")?.tagName,
    ).toBe("BUTTON");
    expect(
      betaRackSlot.querySelector<HTMLButtonElement>(".rack-slot-detail")?.tagName,
    ).toBe("BUTTON");
    expect(
      betaRackSlot.querySelector<HTMLButtonElement>(".rack-slot-visuals")?.tagName,
    ).toBe("BUTTON");

    dispatch.mockClear();
    selectComponent.mockClear();
    act(() => {
      betaRackSlot
        .querySelector(".rack-slot-power-button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "setPowerState",
      state: "off",
      systemId: "beta",
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "selectSystem",
      systemId: "alpha",
    });
    expect(selectComponent).not.toHaveBeenCalled();

    dispatch.mockClear();
    act(() => {
      betaRackSlot
        .querySelector(".rack-slot-visuals")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "selectSystem",
      systemId: "beta",
    });
    expect(selectComponent).toHaveBeenCalledWith("system:beta::scheduler");

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={dispatch}
          selectedComponent="system:beta::scheduler"
          onSelectComponent={selectComponent}
        />,
      );
    });

    expect(container.querySelector(".system-board")).toBeNull();
    expect(container.querySelector(".system-rack-slot.selected")?.textContent).toContain(
      "2x2C",
    );

    act(() => {
      container
        .querySelector(".system-rack-slot.selected")
        ?.querySelector(".rack-slot-visuals")
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(container.querySelector(".system-board")).not.toBeNull();
  });

  it("marks rack warnings by component and greys out off systems", () => {
    const warningVisible = makeRackVisible() as unknown as any;
    const warningSystem = warningVisible.rack.systems[1];
    const warningMetrics = warningSystem.visible.metrics;
    warningSystem.visible = {
      ...warningSystem.visible,
      metrics: {
        ...warningMetrics,
        psuStress: 1.08,
        powerOverloadFailure: {
          ...warningMetrics.powerOverloadFailure,
          active: true,
          progress: 0.3,
        },
        deadlocks: [
          {
            taskId: "tinyChecksum",
            taskName: "Tiny Checksum",
            coreIds: [1],
            cpuId: 1,
            resource: "ram",
            reason: "RAM blocked",
            schedulerQueued: true,
          },
        ],
        deadlockPressure: {
          ...warningMetrics.deadlockPressure,
          active: true,
          resource: "cache",
        },
        cpuSockets: warningMetrics.cpuSockets.map(
          (socket: VisibleState["metrics"]["cpuSockets"][number], index: number) =>
            index === 0
              ? {
                ...socket,
                deadlocked: true,
                deadlockResource: "cache",
                cores: socket.cores.map((core, coreIndex) =>
                  coreIndex === 0
                    ? { ...core, deadlocked: true, deadlockResource: "cache" }
                    : core,
                ),
              }
              : socket,
        ),
      },
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={warningVisible}
          dispatch={() => undefined}
          selectedComponent="system:alpha::core:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const warningSlot = container.querySelectorAll(".system-rack-slot--row")[1]!;
    expect(warningSlot.className).toContain("status-warning");
    expect(
      warningSlot.querySelector(".rack-component-bay--cpu")?.className,
    ).toContain("rack-component-bay--issue");
    expect(
      warningSlot.querySelector(".rack-component-bay--ram")?.className,
    ).toContain("rack-component-bay--issue");
    expect(
      warningSlot.querySelector(".rack-component-bay--power")?.className,
    ).toContain("rack-component-bay--issue");

    const offVisible = makeRackVisible() as unknown as any;
    const offSystem = offVisible.rack.systems[1];
    offSystem.powerState = "off";
    offSystem.visible = {
      ...offSystem.visible,
      metrics: {
        ...offSystem.visible.metrics,
        powerState: "off",
        psuStress: 1.08,
        deadlocks: warningSystem.visible.metrics.deadlocks,
      },
    };

    act(() => {
      root.render(
        <HardwareBoard
          visible={offVisible}
          dispatch={() => undefined}
          selectedComponent="system:alpha::core:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    const offSlot = container.querySelectorAll(".system-rack-slot--row")[1]!;
    expect(offSlot.className).toContain("status-off");
    expect(offSlot.className).not.toContain("status-warning");
    expect(offSlot.querySelector(".rack-component-bay--issue")).toBeNull();
  });

  it("dispatches task actions with the selected system id", () => {
    const visible = makeRackVisible();
    const dispatch = vi.fn();
    const selectComponent = vi.fn();

    act(() => {
      root.render(
        <TaskBay
          visible={visible}
          selectedComponent="system:alpha::scheduler"
          onSelectComponent={selectComponent}
          dispatch={dispatch}
        />,
      );
    });

    const routeSelect =
      container.querySelector<HTMLSelectElement>(".task-route-combo-select");

    expect(routeSelect).not.toBeNull();
    expect(routeSelect?.value).toBe("system:alpha::scheduler");
    expect(
      Array.from(routeSelect?.options ?? []).map((option) => option.textContent),
    ).toEqual(["Alpha / System", "Beta / System"]);

    act(() => {
      routeSelect!.value = "system:beta::scheduler";
      routeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(selectComponent).toHaveBeenCalledWith("system:beta::scheduler");

    act(() => {
      root.render(
        <TaskBay
          visible={visible}
          selectedComponent="system:beta::scheduler"
          onSelectComponent={selectComponent}
          dispatch={dispatch}
        />,
      );
    });

    const runButton = container.querySelector<HTMLButtonElement>(".task-run-button");

    expect(runButton?.textContent).toContain("Schedule");

    act(() => {
      runButton?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "queueTask",
      taskId: "tinyChecksum",
      systemId: "beta",
    });
  });

  it("offers preset purchases and a tiered custom builder", () => {
    const visible = makeRackVisible();
    const dispatch = vi.fn();

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={dispatch}
          selectedComponent="system:beta::core:1"
          onSelectComponent={() => undefined}
        />,
      );
    });

    act(() => {
      container.querySelector<HTMLButtonElement>(".rack-build-new")?.click();
    });

    const presetButton =
      container.querySelector<HTMLButtonElement>(".system-preset-card");

    expect(presetButton?.textContent).toContain("Balanced Node");
    expect(presetButton?.textContent).toContain("Pro");
    expect(presetButton?.textContent).toContain("Wide");
    expect(presetButton?.textContent).toContain("Queue");
    expect(presetButton?.textContent).toContain("Supply");

    act(() => {
      presetButton?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "buyPreconfiguredSystem",
      presetId: "balanced",
      systemId: "beta",
    });

    dispatch.mockClear();

    act(() => {
      container.querySelector<HTMLButtonElement>(".builder-new-mode-custom")?.click();
    });

    let tierButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".custom-tier-option"),
    );
    const proButton = tierButtons.find((button) =>
      button.textContent?.includes("Pro"),
    );

    act(() => {
      proButton?.click();
    });

    const bayButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".custom-system-bay"),
    );
    expect(bayButtons.map((button) => button.dataset.slot)).toEqual([
      "cpu",
      "memory",
      "scheduler",
      "psu",
    ]);

    const memoryBay = Array.from(
      bayButtons,
    ).find((button) => button.textContent?.includes("RAM"));

    act(() => {
      memoryBay?.click();
    });

    tierButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".custom-tier-option"),
    );
    const wideButton = tierButtons.find((button) =>
      button.textContent?.includes("Wide"),
    );

    act(() => {
      wideButton?.click();
    });

    act(() => {
      container.querySelector<HTMLButtonElement>(".custom-builder-buy")?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "buyCustomSystem",
      tierIds: {
        cpu: "pro",
        memory: "wide",
        scheduler: "queue",
        psu: "supply",
        cpuPackages: "1",
      },
      systemId: "beta",
    });
  });
});

