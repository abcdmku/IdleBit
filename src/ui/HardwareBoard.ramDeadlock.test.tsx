import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialGameState,
  deriveVisibleState,
  type VisibleState
} from "../game";
import {
  HardwareBoard
} from "./HardwareBoard";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("HardwareBoard RAM and deadlock surfaces", () => {
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
    expect(container.querySelector(".ram-stick-module-meter")).not.toBeNull();
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
    const stickText = container.querySelector(".ram-stick-module-foot")?.textContent ?? "";
    const ramText = container.querySelector(".memory-section")?.textContent ?? "";

    expect(statLabels).toEqual(["Capacity", "Module Freq", "Modules"]);
    expect(statValues).toEqual(["512 b", "64 Hz", "2"]);
    expect(controlText).toEqual([
      expect.stringContaining("Module"),
      expect.stringContaining("R1 Size"),
      expect.stringContaining("R1 Freq"),
    ]);
    expect(stickText).toContain("256 b");
    expect(stickText).toContain("64 Hz");
    expect(container.querySelector(".ram-stick-grid")?.getAttribute("data-grid")).toBe(
      "2x1",
    );
    expect(ramText).not.toContain("128 Hz");
    expect(ramText).not.toContain("New stick");
    expect(ramText).not.toContain("R1 cap");
    expect(ramText).not.toContain("R1 Hz");
  });

  it("keeps four RAM sticks in a two by two module grid", () => {
    const base = deriveVisibleState(createInitialGameState());
    const ramSlots = [1, 2, 3, 4].map((id) => ({
      id,
      level: 1,
      sizeBits: 256,
      sizeBytes: 32,
      usedBits: 0,
      usedBytes: 0,
      speedLevel: 1,
      speedMt: 64,
      capacityUpgrade: null,
      speedUpgrade: null,
    }));
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        systemStats: true,
      },
      hardware: {
        ...base.hardware,
        ramLevel: 4,
        ramBits: 1024,
        ramBytes: 128,
      },
      metrics: {
        ...base.metrics,
        ramSlots,
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

    const grid = container.querySelector<HTMLElement>(".ram-stick-grid");

    expect(grid?.dataset.grid).toBe("2x2");
    expect(grid?.style.getPropertyValue("--ram-stick-grid-columns")).toBe("2");
    expect(container.querySelectorAll(".ram-stick-module")).toHaveLength(4);
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

});

