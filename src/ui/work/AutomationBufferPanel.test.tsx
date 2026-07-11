import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInitialGameState,
  deriveVisibleState,
  type VisibleState,
} from "../../game";
import { AutomationBufferPanel } from "./AutomationBufferPanel";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("AutomationBufferPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  const renderPanel = (visible: VisibleState) => {
    act(() => {
      root.render(<AutomationBufferPanel visible={visible} />);
    });
  };

  it("states the zero-coverage opening plainly instead of 0m tiles", () => {
    renderPanel(deriveVisibleState(createInitialGameState()));

    const header = container.querySelector(".automation-buffer-panel header");
    expect(header?.textContent).toContain("Automation Buffer");
    expect(header?.textContent).toContain("Starting Node");
    // No stat tiles at 0 coverage — one line says the situation.
    expect(
      container.querySelector(".automation-buffer-panel .stat-tile-row"),
    ).toBeNull();
    expect(container.textContent).toContain("No offline coverage yet");
    // The capability sentence lives in the status line tooltip.
    expect(
      container
        .querySelector(".automation-buffer-note")
        ?.getAttribute("title"),
    ).toContain("Closing freezes simulation.");
  });

  it("offers no purchase control even when the next upgrade is unlocked", () => {
    const visible = deriveVisibleState(createInitialGameState());
    const nextUpgrade = visible.automationBuffer.nextUpgrade;
    expect(nextUpgrade).not.toBeNull();
    renderPanel({
      ...visible,
      automationBuffer: {
        ...visible.automationBuffer,
        nextUpgrade: nextUpgrade
          ? {
              ...nextUpgrade,
              unlocked: true,
              canAfford: true,
              blockedReason: null,
            }
          : null,
      },
    });

    // Status-only surface: buffer purchases live in the R&D column.
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).not.toContain("Upgrade");
    expect(container.textContent).not.toContain("Next buffer");
  });

  it("shows the installed maximum level as plain status", () => {
    const visible = deriveVisibleState(createInitialGameState());
    renderPanel({
      ...visible,
      automationBuffer: {
        ...visible.automationBuffer,
        ownedLevelId: "globalScheduler",
        maxOfflineMs: 7 * 24 * 60 * 60 * 1_000,
        remainingOfflineMs: 7 * 24 * 60 * 60 * 1_000,
        nextUpgrade: null,
      },
    });

    const header = container.querySelector(".automation-buffer-panel header");
    expect(header?.textContent).toContain("Global Scheduler");
    // Stat tiles carry the label+value pair in their aria-labels.
    expect(
      container.querySelector('.stat-tile[aria-label="Remaining 7d"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('.stat-tile[aria-label="Max 7d"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector(".automation-buffer-note")
        ?.getAttribute("title"),
    ).toContain("Final seven-day offline window.");
    expect(container.querySelector("button")).toBeNull();
  });

  it("summarizes the configured standing order", () => {
    const visible = deriveVisibleState(createInitialGameState());
    renderPanel({
      ...visible,
      standingOrder: {
        taskId: "fetchBit",
        systemId: visible.selectedSystem.id,
        enabled: true,
        renewalCount: 3,
      },
      standingOrders: [
        {
          taskId: "fetchBit",
          name: "Fetch Bit",
          systemId: visible.selectedSystem.id,
          enabled: true,
          renewalCount: 3,
        },
      ],
    });

    expect(container.textContent).toContain("Standing order: Fetch Bit");
    expect(container.textContent).toContain("armed");
  });
});
