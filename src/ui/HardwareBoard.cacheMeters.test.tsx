import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAction,
  createInitialGameState,
  deriveVisibleState,
  tickGame,
  type GameState
} from "../game";
import { getCpuClockHz } from "../game/progression";
import {
  HardwareBoard
} from "./HardwareBoard";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("HardwareBoard cache and upgrade meters", () => {
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
    const loadedBadge = container.querySelector<HTMLElement>(
      ".cache-state-badge.loaded",
    );
    expect(
      Array.from(bufferBadge?.children ?? []).map((child) =>
        child.tagName.toLowerCase(),
      ),
    ).toEqual(["strong", "span", "small"]);
    expect(loadedBadge?.querySelector("small")?.textContent).toBe("Loaded");
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
        clockHz: getCpuClockHz("hz", 5),
        coreClockLevels: {
          1: 5,
        },
        cacheLevel: 5,
        cacheBits: 16,
        cacheBytes: 2,
        cacheSpeedLevel: 3,
        psuWatts: 1,
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

    state = tickGame(state, 100);

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
    expect(segments.length).toBeGreaterThanOrEqual(2);

    const readSegment = segments.find((segment) =>
      segment.className.includes("cache-pressure-read"),
    );
    const writeSegment = segments.find((segment) =>
      segment.className.includes("cache-pressure-write"),
    );

    expect(readSegment?.className).toContain("loaded");
    expect(readSegment?.style.width).toBe("50%");
    expect(writeSegment?.className).toContain("buffering");
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

});

