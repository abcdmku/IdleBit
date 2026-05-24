import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialGameState,
  deriveVisibleState,
  type VisibleState
} from "../game";
import { formatWatts } from "./format";
import {
  HardwareBoard
} from "./HardwareBoard";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const mockScrollIntoView = () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const scrollIntoView = vi.fn();

  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });

  return {
    scrollIntoView,
    restore() {
      if (typeof originalScrollIntoView === "function") {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: originalScrollIntoView,
        });
        return;
      }

      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    },
  };
};

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

  it("shows unpaid credit shutdown warning countdown on the PSU", () => {
    const initial = deriveVisibleState(createInitialGameState());
    const visible = {
      ...initial,
      resources: {
        ...initial.resources,
        credits: 0,
      },
      metrics: {
        ...initial.metrics,
        powerUnpaidShutdownWarningSeconds: 7,
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

    expect(psuSection?.textContent).toContain("7s to cutoff");
    expect(psuSection?.textContent).toContain("credits");
    expect(psuSection?.querySelector(".psu-meta-credit-warning")).not.toBeNull();
    expect(headerWarning).not.toBeNull();
    expect(headerWarning?.className).toContain("flashing");
  });

  it("shows a pause caption for first PSU failure pressure", () => {
    const scroll = mockScrollIntoView();
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

    try {
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
      expect(scroll.scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({
          block: "center",
          inline: "nearest",
        }),
      );

      act(() => {
        caption?.querySelector<HTMLButtonElement>("button")?.click();
      });

      expect(dismiss).toHaveBeenCalled();
    } finally {
      scroll.restore();
    }
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

    expect(container.querySelector(".system-board.power-offline")).not.toBeNull();
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

