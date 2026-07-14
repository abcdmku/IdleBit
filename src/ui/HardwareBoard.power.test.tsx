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
    // Draw / capacity fraction prints the shared watt unit once; the DRAW
    // stat tile keeps the full wording in its tooltip/aria-label.
    expect(psuSection?.textContent).toContain("420");
    expect(psuSection?.textContent).not.toContain("420 uW");
    const drawTile = psuSection?.querySelector('.stat-tile[title^="Power draw"]');
    expect(drawTile).not.toBeNull();
    expect(drawTile?.getAttribute("title")).toContain(formatWatts(capacityWatts));
    expect(drawTile?.querySelector(".stat-tile-meter")).not.toBeNull();
    // Reserved geometry: the single status slot stays mounted but hidden
    // until a warning, transition, or grace countdown swaps in.
    const statusSlot = psuSection?.querySelector(".psu-status-slot");
    expect(statusSlot?.className).toContain("is-idle");
    expect(statusSlot?.getAttribute("aria-hidden")).toBe("true");
    expect(psuSection?.textContent).not.toContain("stress");
    expect(psuSection?.textContent).not.toContain("headroom");
    expect(psuSection?.textContent).not.toContain("efficiency");
    expect(psuSection?.textContent).toContain("cr/s");
    expect(psuSection?.textContent).toContain("Capacity");
    expect(psuSection?.textContent).not.toContain("PSU Capacity");
    expect(psuSection?.textContent).not.toContain("Research PSU Management");
    expect(psuSection?.querySelector(".resource-token.data")).toBeNull();
    const buttons = Array.from(
      psuSection?.querySelectorAll<HTMLButtonElement>(".power-control-buttons button") ?? [],
    );
    expect(buttons).toHaveLength(3);
    expect(psuSection?.querySelector(".power-state-chip")).toBeNull();
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[1]?.disabled).toBe(false);
  });

  it("toggles the compact idle power policy without changing its control shape", () => {
    const dispatch = vi.fn();
    const initial = deriveVisibleState(createInitialGameState());

    act(() => {
      root.render(
        <HardwareBoard
          visible={initial}
          dispatch={dispatch}
          selectedComponent={null}
          onSelectComponent={() => undefined}
        />,
      );
    });

    const control = container.querySelector<HTMLButtonElement>(
      ".idle-power-policy-control",
    )!;
    expect(control.textContent).toBe("Idle:low");
    expect(control.getAttribute("aria-pressed")).toBe("false");
    expect(control.getAttribute("aria-label")).toContain("low power");

    act(() => control.click());
    expect(dispatch).toHaveBeenCalledWith({
      type: "setIdlePowerPolicy",
      policy: "shutdown-when-idle",
    });

    const idleOff = {
      ...initial,
      metrics: {
        ...initial.metrics,
        idlePowerPolicy: "shutdown-when-idle",
      },
    } as VisibleState;

    act(() => {
      root.render(
        <HardwareBoard
          visible={idleOff}
          dispatch={dispatch}
          selectedComponent={null}
          onSelectComponent={() => undefined}
        />,
      );
    });

    const updatedControl = container.querySelector<HTMLButtonElement>(
      ".idle-power-policy-control",
    )!;
    expect(updatedControl).toBe(control);
    expect(updatedControl.textContent).toBe("Idle:off");
    expect(updatedControl.getAttribute("aria-pressed")).toBe("true");
    expect(updatedControl.getAttribute("aria-label")).toContain(
      "shutdown when idle",
    );

    act(() => updatedControl.click());
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "setIdlePowerPolicy",
      policy: "low-power",
    });
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
          visible={initial}
          dispatch={() => undefined}
          selectedComponent={null}
          onSelectComponent={() => undefined}
        />,
      );
    });
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
    // The DRAW stat tile shifts to the rose accent while overloaded.
    const drawTile = psuSection?.querySelector('.stat-tile[title^="Power draw"]');
    expect(drawTile?.className).toContain("is-rose");
    expect(drawTile?.querySelector(".stat-tile-meter")).not.toBeNull();
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
    // The header warning is the single home for the credit countdown.
    expect(psuSection?.querySelector(".psu-meta-credit-warning")).toBeNull();
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

  it("swaps warning, transition, and grace through one reserved status slot with fixed card structure", () => {
    const initial = deriveVisibleState(createInitialGameState());

    const renderVisible = (visible: VisibleState) => {
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
    };

    // Geometry fingerprint: the card's row list and the header row's cell
    // list. Every PSU state must render the exact same skeleton — content
    // only ever swaps inside the pinned-height status slot (jsdom cannot
    // measure pixels; the slot height itself is pinned in psu-section.css).
    const cardStructure = () => {
      const psuSection = container.querySelector(".psu-section")!;
      const rows = Array.from(psuSection.children).map(
        (child) => `${child.tagName}.${child.className.split(" ")[0]}`,
      );
      const headerCells = Array.from(
        psuSection.querySelector(".psu-header-row")!.children,
      ).map((child) => `${child.tagName}.${child.className.split(" ")[0]}`);
      return { rows, headerCells };
    };

    renderVisible(initial);

    const psuSection = container.querySelector(".psu-section")!;
    const slot = psuSection.querySelector(".psu-status-slot")!;

    // Idle: the slot stays mounted with a hidden placeholder chip so its
    // arrival never rewraps the header row.
    expect(slot.className).toContain("is-idle");
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    expect(slot.querySelector(".psu-header-warning")).not.toBeNull();

    // The old stacked reserved rows are gone: no per-state card rows.
    expect(psuSection.querySelector(".psu-transition-slot")).toBeNull();
    expect(psuSection.querySelector(".psu-grace-row")).toBeNull();

    const idleStructure = cardStructure();

    // A live overload fills the same slot in place.
    const overloaded = {
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

    renderVisible(overloaded);
    expect(container.querySelector(".psu-status-slot")).toBe(slot);
    expect(slot.className).not.toContain("is-idle");
    expect(slot.textContent).toContain("5s to fail");
    expect(cardStructure()).toEqual(idleStructure);

    // A boot countdown swaps into the same slot.
    const booting = {
      ...initial,
      metrics: {
        ...initial.metrics,
        powerState: "booting",
        powerTransitionSeconds: 7,
      },
    } as VisibleState;

    renderVisible(booting);
    expect(container.querySelector(".psu-status-slot")).toBe(slot);
    expect(slot.className).not.toContain("is-idle");
    expect(slot.textContent).toContain("System booting");
    expect(cardStructure()).toEqual(idleStructure);

    // The billing grace countdown swaps into the same slot.
    const grace = {
      ...initial,
      metrics: {
        ...initial.metrics,
        powerBootstrapGraceSeconds: 12,
      },
    } as VisibleState;

    renderVisible(grace);
    expect(container.querySelector(".psu-status-slot")).toBe(slot);
    expect(slot.className).not.toContain("is-idle");
    expect(slot.textContent).toContain("Grace");
    expect(slot.textContent).toContain("12s");
    expect(cardStructure()).toEqual(idleStructure);

    // Back to idle: same skeleton, slot hides in place.
    renderVisible(initial);
    expect(container.querySelector(".psu-status-slot")).toBe(slot);
    expect(slot.className).toContain("is-idle");
    expect(cardStructure()).toEqual(idleStructure);
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
    expect(container.querySelector(".system-board.power-transitioning")).not.toBeNull();
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

