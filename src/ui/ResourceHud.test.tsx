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

  it("keeps reset inside the HUD settings menu", () => {
    const onReset = vi.fn();

    act(() => {
      root.render(
        <ResourceHud
          visible={makeVisibleState(12, 34)}
          onReset={onReset}
          animateResourceGains={false}
        />,
      );
    });

    expect(container.querySelector(".dev-reset-button")).toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>(".resource-settings-button")?.click();
    });

    const resetButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reset dev save"]',
    );

    expect(resetButton?.textContent).toContain("Reset save");

    act(() => {
      resetButton?.click();
    });

    expect(onReset).toHaveBeenCalledOnce();
    expect(
      container.querySelector('button[aria-label="Reset dev save"]'),
    ).toBeNull();
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

  it("grants the clicked dev resource on shift-clicking resource readouts", () => {
    const onSelectResource = vi.fn();
    const onGrantDevResource = vi.fn();

    act(() => {
      root.render(
        <ResourceHud
          visible={makeVisibleState(12, 34)}
          onReset={() => undefined}
          animateResourceGains={false}
          onSelectResource={onSelectResource}
          onGrantDevResource={onGrantDevResource}
        />,
      );
    });

    const creditsReadout = container.querySelector(".resource-readout.credits");
    const dataReadout = container.querySelector(".resource-readout.data");

    expect(creditsReadout?.getAttribute("title")).toBe("Toggle credits/data graph");
    expect(creditsReadout?.getAttribute("title")).not.toContain("Shift-click");

    act(() => {
      creditsReadout?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey: true }),
      );
      dataReadout?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey: true }),
      );
    });

    expect(onGrantDevResource).toHaveBeenNthCalledWith(1, "credits");
    expect(onGrantDevResource).toHaveBeenNthCalledWith(2, "data");
    expect(onSelectResource).not.toHaveBeenCalled();

    act(() => {
      dataReadout?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelectResource).toHaveBeenCalledWith("data");
  });

  it("opens HUD settings for hardware purchases and screen wake toggles", () => {
    const onHardwarePurchasesVisibleChange = vi.fn();
    const onKeepScreenAwakeChange = vi.fn();

    act(() => {
      root.render(
        <ResourceHud
          visible={makeVisibleState(12, 34)}
          onReset={() => undefined}
          animateResourceGains={false}
          hardwarePurchasesVisible={true}
          onHardwarePurchasesVisibleChange={onHardwarePurchasesVisibleChange}
          keepScreenAwake={false}
          onKeepScreenAwakeChange={onKeepScreenAwakeChange}
          keepScreenAwakeSupported={true}
        />,
      );
    });

    act(() => {
      container.querySelector<HTMLButtonElement>(".resource-settings-button")?.click();
    });

    const purchasesToggle = container.querySelector<HTMLInputElement>(
      'input[aria-label="Show hardware purchases"]',
    );
    const keepAwakeToggle = container.querySelector<HTMLInputElement>(
      'input[aria-label="Keep screen awake"]',
    );

    expect(purchasesToggle?.checked).toBe(true);
    expect(keepAwakeToggle?.checked).toBe(false);

    act(() => {
      purchasesToggle?.click();
      keepAwakeToggle?.click();
    });

    expect(onHardwarePurchasesVisibleChange).toHaveBeenCalledWith(false);
    expect(onKeepScreenAwakeChange).toHaveBeenCalledWith(true);
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

