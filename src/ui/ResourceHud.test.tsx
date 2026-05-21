import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type VisibleState
} from "../game";
import { formatWatts } from "./format";
import { ResourceHud } from "./ResourceHud";

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

  it("shows credits before data in the header", () => {
    act(() => {
      root.render(
        <ResourceHud
          visible={makeVisibleState(12, 34)}
          onReset={() => undefined}
          animateResourceGains={false}
        />,
      );
    });

    expect(
      Array.from(container.querySelectorAll(".resource-readout")).map(
        (readout) => readout.classList.contains("credits") ? "credits" : "data",
      ),
    ).toEqual(["credits", "data"]);
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

