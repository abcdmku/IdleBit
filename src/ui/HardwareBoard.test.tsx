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
import { HardwareBoard, ResourceHud } from "./HardwareBoard";

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
});
