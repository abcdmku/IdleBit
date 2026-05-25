import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialGameState,
  deriveVisibleState,
  type VisibleState,
} from "../game";
import { SystemWorkbench } from "./components";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const makeWorkbenchVisible = (): VisibleState => {
  const base = deriveVisibleState(createInitialGameState());
  return {
    ...base,
    flags: {
      ...base.flags,
      basicQueue: true,
      scheduler: true,
    },
    hardware: {
      ...base.hardware,
      schedulerSlots: 1,
      systemSchedulerSlots: 1,
      cpus: base.hardware.cpus.map((cpu) => ({ ...cpu, schedulerSlots: 1 })),
    },
    upgrades: [
      {
        id: "systemSchedulerSlot",
        name: "System Queue Slot",
        component: "scheduler",
        accent: "violet",
        costs: [],
        refunds: [],
        canAfford: true,
        canDowngrade: false,
        downgradeBlockedReason: null,
        purchaseCount: 1,
      },
    ],
  };
};

describe("SystemWorkbench hardware upgrade toggle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    originalMatchMedia = window.matchMedia;
    mockMatchMedia(false);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it("toggles the hardware panel upgrade controls from the header", () => {
    const visible = makeWorkbenchVisible();

    act(() => {
      root.render(
        <SystemWorkbench
          visible={visible}
          dispatch={() => undefined}
          selectedComponent={null}
          onSelectComponent={() => undefined}
          onReset={() => undefined}
          animateResourceGains={false}
          pinnedTaskIds={[]}
          onTogglePinnedTask={() => undefined}
          onUnpinTask={() => undefined}
          onClearPinnedTasks={() => undefined}
        />,
      );
    });

    const hardwarePanel = container.querySelector<HTMLElement>(".hw-panel");
    const toggle = container.querySelector<HTMLInputElement>(
      ".hardware-upgrade-toggle input",
    );

    expect(toggle?.checked).toBe(false);
    expect(hardwarePanel?.classList.contains("hide-upgrades")).toBe(false);
    expect(
      container.querySelector(".system-scheduler-section .inline-upgrade-row")
        ?.textContent,
    ).toContain("System Queue Slot");

    act(() => {
      toggle?.click();
    });

    expect(toggle?.checked).toBe(true);
    expect(hardwarePanel?.classList.contains("hide-upgrades")).toBe(true);
  });

  it("toggles hardware purchases from the HUD settings menu", () => {
    const visible = makeWorkbenchVisible();

    act(() => {
      root.render(
        <SystemWorkbench
          visible={visible}
          dispatch={() => undefined}
          selectedComponent={null}
          onSelectComponent={() => undefined}
          onReset={() => undefined}
          animateResourceGains={false}
          pinnedTaskIds={[]}
          onTogglePinnedTask={() => undefined}
          onUnpinTask={() => undefined}
          onClearPinnedTasks={() => undefined}
        />,
      );
    });

    const hardwarePanel = container.querySelector<HTMLElement>(".hw-panel");

    act(() => {
      container.querySelector<HTMLButtonElement>(".resource-settings-button")?.click();
    });

    const purchasesToggle = container.querySelector<HTMLInputElement>(
      'input[aria-label="Show hardware purchases"]',
    );

    expect(purchasesToggle?.checked).toBe(true);
    expect(hardwarePanel?.classList.contains("hide-upgrades")).toBe(false);

    act(() => {
      purchasesToggle?.click();
    });

    expect(purchasesToggle?.checked).toBe(false);
    expect(hardwarePanel?.classList.contains("hide-upgrades")).toBe(true);
  });

  it("toggles the resource graph on desktop resource taps", () => {
    act(() => {
      root.render(
        <SystemWorkbench
          visible={makeWorkbenchVisible()}
          dispatch={() => undefined}
          selectedComponent={null}
          onSelectComponent={() => undefined}
          onReset={() => undefined}
          animateResourceGains={false}
          pinnedTaskIds={[]}
          onTogglePinnedTask={() => undefined}
          onUnpinTask={() => undefined}
          onClearPinnedTasks={() => undefined}
        />,
      );
    });

    const dataReadout = container.querySelector<HTMLElement>(
      ".resource-readout.data",
    );

    act(() => {
      dataReadout?.click();
    });

    expect(container.querySelector(".resource-graph-panel")).not.toBeNull();

    act(() => {
      dataReadout?.click();
    });

    expect(container.querySelector(".resource-graph-panel")).toBeNull();
  });

  it("keeps the resource graph open on repeated mobile resource taps", () => {
    mockMatchMedia(true);

    act(() => {
      root.render(
        <SystemWorkbench
          visible={makeWorkbenchVisible()}
          dispatch={() => undefined}
          selectedComponent={null}
          onSelectComponent={() => undefined}
          onReset={() => undefined}
          animateResourceGains={false}
          pinnedTaskIds={[]}
          onTogglePinnedTask={() => undefined}
          onUnpinTask={() => undefined}
          onClearPinnedTasks={() => undefined}
        />,
      );
    });

    const creditsReadout = container.querySelector<HTMLElement>(
      ".resource-readout.credits",
    );

    act(() => {
      creditsReadout?.click();
    });

    expect(container.querySelector(".resource-graph-panel")).not.toBeNull();
    expect(container.querySelector(".right-column")?.classList.contains("active"))
      .toBe(true);

    act(() => {
      creditsReadout?.click();
    });

    expect(container.querySelector(".resource-graph-panel")).not.toBeNull();
    expect(container.querySelector(".right-column")?.classList.contains("active"))
      .toBe(true);
  });
});
