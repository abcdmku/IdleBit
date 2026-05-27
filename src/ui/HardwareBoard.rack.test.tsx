import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialGameState,
  deriveVisibleState,
  type VisibleState
} from "../game";
import { getPsuCapacityBuildCost } from "../game/content/psu";
import { getPsuWatts } from "../game/progression";
import {
  HardwareBoard,
  TaskBay
} from "./HardwareBoard";
import { formatWatts } from "./format";

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
      resources: {
        credits: 2_000,
        data: 1_000,
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
                  tierName: "Hz",
                  cpuTierId: "hz",
                  cores: 1,
                  clockHz: 1,
                  cpuEfficiency: 4,
                  cacheBits: 1,
                  cacheSpeedHz: 1,
                  costs: [{ resource: "credits", amount: 100 }],
                },
                {
                  id: "pro",
                  name: "Pro",
                  tierName: "kHz",
                  cpuTierId: "khz",
                  cores: 1,
                  clockHz: 2500,
                  cpuEfficiency: 6,
                  cacheBits: 2,
                  cacheSpeedHz: 1500,
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
                  name: "Hz RAM Tier",
                  ramBits: 256,
                  ramStickCount: 2,
                  ramLevel: 1,
                  ramSpeedLevel: 1,
                  ramSpeedMt: 1,
                  costs: [{ resource: "data", amount: 10 }],
                },
                {
                  id: "wide",
                  name: "kHz RAM Tier",
                  ramBits: 1024,
                  ramStickCount: 4,
                  ramLevel: 3,
                  ramSpeedLevel: 2,
                  ramSpeedMt: 2,
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
                  psuWatts: 24,
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
    expect(container.querySelectorAll(".system-rack .rack-gauge-strip").length).toBeGreaterThan(0);
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
    expect(betaRackSlot.querySelector(".rack-component-bay--power .rack-gauge-bar")).toBeNull();
    expect(
      betaRackSlot.querySelectorAll(".rack-component-bay .rack-gauge-bar"),
    ).toHaveLength(3);
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
    const selectedSlot = container.querySelector(".system-rack-slot.selected")!;
    // Multi-socket layout is now spatial (two CPU dies side-by-side), not text.
    expect(selectedSlot.querySelectorAll(".rack-cpu-package")).toHaveLength(2);
    expect(selectedSlot.querySelectorAll(".rack-cpu-core-dot")).toHaveLength(4);

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

  it("opens a system-view custom builder without premade configs", () => {
    const visible = {
      ...makeRackVisible(),
      resources: { credits: 20_000, data: 1_000 },
    };
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

    expect(container.querySelector(".builder-new-modes")).toBeNull();
    expect(container.querySelector(".system-preset-card")).toBeNull();
    expect(container.querySelector(".custom-system-module-picker")).toBeNull();
    expect(container.querySelector(".custom-builder-system-preview .custom-build-module")).toBeNull();
    expect(container.querySelector(".custom-builder-system-preview .custom-build-module-option")).toBeNull();
    expect(container.querySelector(".custom-builder-system-preview .system-scheduler-section")).not.toBeNull();
    expect(container.querySelector(".custom-builder-system-preview .memory-section")).not.toBeNull();
    expect(container.querySelector(".custom-builder-system-preview .cpu-package")).not.toBeNull();
    expect(container.querySelector(".custom-builder-system-preview .core-array-section")).not.toBeNull();
    expect(container.querySelector(".custom-builder-system-preview .cache-section")).not.toBeNull();
    expect(container.querySelector(".custom-builder-system-preview .psu-section")).not.toBeNull();
    expect(container.querySelector(".custom-system-builder-header h2")?.textContent).toBe(
      "System Builder",
    );
    expect(container.querySelector(".custom-system-builder-header")?.textContent).toContain(
      "Price",
    );
    expect(container.querySelector(".custom-system-builder-header")?.textContent).toContain(
      "Review build",
    );
    expect(
      container.querySelector(".custom-builder-cpu-tier-controls .custom-builder-tier-title")
        ?.textContent,
    ).toBe("Tier");
    expect(
      container.querySelector(".custom-builder-memory-tier-controls .custom-builder-tier-title")
        ?.textContent,
    ).toBe("Tier");
    expect(container.querySelector(".custom-builder-tier-select")).toBeNull();
    expect(container.querySelector(".custom-cpu-package-options")).toBeNull();
    expect(
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".custom-builder-cpu-tier-options button",
        ),
      ).map((button) => button.textContent),
    ).toEqual(["Hz", "kHz"]);
    expect(
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".custom-builder-memory-tier-options button",
        ),
      ).map((button) => button.textContent),
    ).toEqual(["Hz", "kHz"]);
    expect(
      container.querySelector(".custom-builder-cpu-tier-options button.active")
        ?.textContent,
    ).toBe("Hz");
    expect(
      container.querySelector(".custom-builder-memory-tier-options button.active")
        ?.textContent,
    ).toBe("Hz");
    expect(container.querySelector(".memory-section .ram-pipeline-summary")).toBeNull();
    expect(container.querySelector(".memory-section .hw-section-meta")?.textContent).toContain(
      "single channel",
    );
    expect(container.querySelector(".memory-section .hw-section-meta")?.textContent).not.toContain(
      "build",
    );
    expect(container.querySelectorAll(".custom-builder-cpu-card-controls")).toHaveLength(0);
    expect(container.querySelector(".core-cache-row > .custom-builder-cpu-config")).not.toBeNull();

    const cpuTierButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".custom-builder-cpu-tier-options button",
      ),
    );
    act(() => {
      cpuTierButtons.find((button) => button.textContent === "kHz")?.click();
    });

    const corePlus = container.querySelector<HTMLButtonElement>(
      ".custom-builder-cpu-config .upgrade-stepper-button.plus",
    );
    act(() => corePlus?.click());
    act(() => corePlus?.click());
    act(() => corePlus?.click());

    const bayButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".custom-build-bay"),
    );
    expect(bayButtons.map((button) => button.dataset.slot)).toEqual([
      "scheduler",
      "memory",
      "cpu",
      "psu",
    ]);

    const memoryBay = Array.from(
      bayButtons,
    ).find((button) => button.textContent?.includes("RAM"));

    act(() => {
      memoryBay?.click();
    });

    const memoryTierButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".custom-builder-memory-tier-options button",
      ),
    );
    act(() => {
      memoryTierButtons.find((button) => button.textContent === "kHz")?.click();
    });

    const ramStickPlus = container.querySelector<HTMLButtonElement>(
      ".ram-header-controls .upgrade-stepper-button.plus",
    );
    act(() => ramStickPlus?.click());
    act(() => ramStickPlus?.click());
    act(() => ramStickPlus?.click());
    expect(container.querySelector(".memory-section .hw-section-meta")?.textContent).toContain(
      "quad channel",
    );

    const psuState = container.querySelector<HTMLElement>(".custom-builder-psu-state");
    expect(psuState?.textContent).toContain("Short");
    expect(container.querySelector(".custom-builder-system-preview .psu-section")?.textContent).toContain(
      formatWatts(getPsuWatts(5)),
    );
    const psuPlus = container.querySelector<HTMLButtonElement>(
      ".psu-section .upgrade-stepper-button.plus",
    );
    for (let index = 0; index < 8; index += 1) {
      act(() => psuPlus?.click());
    }

    const psuUpgradeCost = getPsuCapacityBuildCost(5, 13).reduce(
      (total, cost) => total + (cost.resource === "credits" ? cost.amount : 0),
      0,
    );
    expect(psuState?.textContent).toContain("Met");
    expect(container.querySelector(".custom-builder-system-preview .psu-section")?.textContent).toContain(
      formatWatts(getPsuWatts(13)),
    );
    expect(container.querySelector(".custom-builder-system-preview .core-control-strip .upgrade-stepper")).not.toBeNull();
    expect(container.querySelector(".custom-builder-system-preview .cache-control-strip .upgrade-stepper")).not.toBeNull();
    expect(container.querySelector(".custom-builder-system-preview .rack-gauge-bar")).toBeNull();
    expect(container.querySelector(".custom-builder-system-preview .progress-fill")).toBeNull();
    expect(container.querySelector(".custom-system-module-picker")).toBeNull();
    expect(container.querySelector(".custom-system-summary")).toBeNull();
    expect(container.querySelector(".custom-system-builder-header")?.textContent).not.toContain(
      "Efficiency",
    );
    expect(container.querySelector(".custom-system-builder-header")?.textContent).not.toContain(
      "Cost to run",
    );
    expect(container.querySelector(".custom-system-builder-header")?.textContent).not.toContain(
      "Upgrade cost",
    );
    expect(
      container.querySelector(".custom-system-builder-price .resource-token.credits strong")
        ?.textContent,
    ).toBe(String(1040 + psuUpgradeCost));
    expect(
      container.querySelector(".custom-system-builder-price .resource-token.data strong")
        ?.textContent,
    ).toBe("32");

    act(() => {
      container.querySelector<HTMLButtonElement>(
        ".custom-system-builder-header .custom-builder-buy",
      )?.click();
    });

    expect(dispatch).not.toHaveBeenCalled();

    act(() => {
      container.querySelector<HTMLButtonElement>(
        ".custom-system-builder-header .custom-builder-buy",
      )?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "buyCustomSystem",
      tierIds: {
        cpu: "pro",
        memory: "wide",
        scheduler: "queue",
        psu: "supply",
        cpuCores: "4",
        cpuLevel: "1",
        cacheLevel: "1",
        cacheSpeedLevel: "1",
        ramSticks: "4",
        ramTierLevel: "1",
        ramSpeedTierLevel: "1",
        cpuPackages: "1",
        cpuLinked: "1",
        cpuPackageCores: "4",
        cpuPackageLevels: "1",
        cpuPackageCacheLevels: "1",
        cpuPackageCacheSpeedLevels: "1",
        cpuSchedulerMatch: "1",
        cpuSchedulerSlots: "4",
        cpuPackageSchedulerSlots: "4",
        cpuPackageSchedulerMatches: "1",
        ramLevel: "37",
        ramSpeedLevel: "37",
        psuLevel: "13",
      },
      systemId: "beta",
    });
  });

  it("lets the builder CPU scheduler match cores or use manual slots", () => {
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

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          ".custom-builder-cpu-header-controls .upgrade-stepper-button.plus",
        )
        ?.click();
    });
    act(() => {
      container
        .querySelector<HTMLInputElement>(
          ".custom-builder-cpu-header-controls .custom-builder-link-toggle input",
        )
        ?.click();
    });
    act(() => {
      container
        .querySelectorAll<HTMLElement>(".custom-builder-cpu-socket")[1]
        ?.click();
    });

    const getSelectedSocket = () =>
      container.querySelector<HTMLElement>(".custom-builder-cpu-socket.selected");
    expect(
      container.querySelector(".cpu-package-body > .custom-builder-cpu-scheduler"),
    ).toBeNull();
    expect(
      container.querySelector(".core-cache-row > .custom-builder-cpu-config"),
    ).toBeNull();
    expect(container.querySelectorAll(".custom-builder-cpu-card-controls")).toHaveLength(2);
    expect(
      getSelectedSocket()?.querySelector(".custom-builder-cpu-card-scheduler")
        ?.textContent,
    ).toContain("1 slot");
    expect(
      getSelectedSocket()?.querySelector(
        ".custom-builder-cpu-card-scheduler .hw-section-header",
      ),
    ).toBeNull();

    const matchToggle = getSelectedSocket()?.querySelector<HTMLInputElement>(
      ".custom-builder-scheduler-match-toggle input",
    );
    const getSchedulerPlus = () =>
      getSelectedSocket()?.querySelector<HTMLButtonElement>(
        ".custom-builder-cpu-scheduler .upgrade-stepper-button.plus",
      );

    expect(matchToggle?.checked).toBe(true);
    expect(getSchedulerPlus()).toBeNull();

    act(() => {
      matchToggle?.click();
    });
    expect(matchToggle?.checked).toBe(false);
    expect(
      getSelectedSocket()?.querySelector(".custom-builder-cpu-card-scheduler")
        ?.textContent,
    ).toContain("Sched Slots");
    const schedulerPlus = getSchedulerPlus();
    expect(schedulerPlus?.disabled).toBe(false);

    act(() => schedulerPlus?.click());
    act(() => schedulerPlus?.click());

    expect(
      getSelectedSocket()?.querySelector(".custom-builder-cpu-scheduler")
        ?.textContent,
    ).toContain("3");

    act(() => {
      container.querySelector<HTMLButtonElement>(
        ".custom-system-builder-header .custom-builder-buy",
      )?.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>(
        ".custom-system-builder-header .custom-builder-buy",
      )?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "buyCustomSystem",
      tierIds: expect.objectContaining({
        cpuSchedulerMatch: "0",
        cpuSchedulerSlots: "4",
        cpuPackageSchedulerSlots: "1,3",
        cpuPackageSchedulerMatches: "1,0",
      }),
      systemId: "beta",
    });
  });

  it("keeps custom builder config after leaving and reopening the store", () => {
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

    const corePlus = container.querySelector<HTMLButtonElement>(
      ".custom-builder-cpu-config .upgrade-stepper-button.plus",
    );
    act(() => corePlus?.click());
    act(() => corePlus?.click());

    expect(
      container.querySelector<HTMLElement>(
        ".custom-builder-cpu-config .custom-builder-stepper-value",
      )?.textContent,
    ).toBe("3");

    act(() => {
      container.querySelector<HTMLButtonElement>(".rack-strip-home")?.click();
    });
    expect(container.querySelector(".custom-system-builder")).toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>(".rack-build-new")?.click();
    });

    expect(
      container.querySelector<HTMLElement>(
        ".custom-builder-cpu-config .custom-builder-stepper-value",
      )?.textContent,
    ).toBe("3");
  });

  it("allows custom builder cores past eight and shows RAM efficiency", () => {
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

    for (let index = 0; index < 10; index += 1) {
      act(() => {
        container
          .querySelector<HTMLButtonElement>(
            ".custom-builder-cpu-config .upgrade-stepper-button.plus",
          )
          ?.click();
      });
    }
    const corePlus = container.querySelector<HTMLButtonElement>(
      ".custom-builder-cpu-config .upgrade-stepper-button.plus",
    );

    expect(corePlus?.disabled).toBe(false);
    expect(
      container.querySelector(".custom-builder-cpu-socket .core-array-efficiency")
        ?.textContent,
    ).toContain("11 cores");
    expect(container.querySelector(".custom-builder-system-preview .core-cache-row")?.className).toContain(
      "many-cores",
    );
    expect(
      container
        .querySelector<HTMLElement>(
          ".custom-builder-system-preview .custom-builder-cpu-socket.many-cores .core-grid",
        )
        ?.style.getPropertyValue("--core-grid-columns"),
    ).toBe("4");
    expect(
      container.querySelectorAll(".custom-builder-system-preview .core-die"),
    ).toHaveLength(11);
    expect(container.querySelector(".memory-section .hw-section-meta")?.textContent).toContain(
      "Eff",
    );
    expect(container.querySelector(".memory-section .ram-stick-efficiency")?.textContent).toContain(
      "Eff",
    );
  });

  it("adds CPU packages from the builder CPU header", () => {
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

    const cpuPlus = container.querySelector<HTMLButtonElement>(
      ".custom-builder-cpu-header-controls .upgrade-stepper-button.plus",
    );

    act(() => cpuPlus?.click());
    act(() => cpuPlus?.click());

    expect(
      container.querySelector(".custom-builder-cpu-package .cpu-package-meta")
        ?.textContent,
    ).toContain("3 CPUs");
    expect(
      container.querySelectorAll(".custom-builder-system-preview .core-die"),
    ).toHaveLength(3);
    expect(
      container.querySelectorAll(".custom-builder-cpu-tabs .cpu-bank-tab"),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll(".custom-builder-cpu-socket"),
    ).toHaveLength(3);

    act(() => {
      container.querySelector<HTMLButtonElement>(
        ".custom-system-builder-header .custom-builder-buy",
      )?.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>(
        ".custom-system-builder-header .custom-builder-buy",
      )?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "buyCustomSystem",
      tierIds: expect.objectContaining({
        cpuPackages: "3",
        cpuCores: "3",
        cpuPackageCores: "1,1,1",
      }),
      systemId: "beta",
    });
  });

  it("can unlink CPU packages and edit the selected CPU independently", () => {
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

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          ".custom-builder-cpu-header-controls .upgrade-stepper-button.plus",
        )
        ?.click();
    });
    act(() => {
      container
        .querySelector<HTMLInputElement>(
          ".custom-builder-cpu-header-controls .custom-builder-link-toggle input",
        )
        ?.click();
    });

    const initialSockets = container.querySelectorAll<HTMLElement>(
      ".custom-builder-cpu-socket",
    );
    act(() => initialSockets[1]?.click());
    expect(initialSockets[1]?.className).toContain("selected");
    expect(container.querySelectorAll(".custom-builder-cpu-card-controls")).toHaveLength(2);
    act(() => {
      initialSockets[1]
        ?.querySelector<HTMLButtonElement>(
          ".custom-builder-cpu-card-config .upgrade-stepper-button.plus",
        )
        ?.click();
    });

    const sockets = container.querySelectorAll<HTMLElement>(
      ".custom-builder-cpu-socket",
    );
    expect(sockets).toHaveLength(2);
    expect(sockets[0]?.querySelectorAll(".core-die")).toHaveLength(1);
    expect(sockets[1]?.querySelectorAll(".core-die")).toHaveLength(2);

    act(() => {
      container.querySelector<HTMLButtonElement>(
        ".custom-system-builder-header .custom-builder-buy",
      )?.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>(
        ".custom-system-builder-header .custom-builder-buy",
      )?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "buyCustomSystem",
      tierIds: expect.objectContaining({
        cpuLinked: "0",
        cpuPackages: "2",
        cpuCores: "3",
        cpuPackageCores: "1,2",
      }),
      systemId: "beta",
    });
  });
});

