import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialGameState,
  deriveVisibleState,
  exactResourceBag,
  type VisibleLiveOperations,
  type VisibleState,
} from "../../game";
import { LiveOperationsView } from "./LiveOperationsView";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

/** Configured, running lane whose exact economics carry long decimal tails. */
const visibleWithLiveOperations = (
  overrides: Partial<VisibleLiveOperations> = {},
): VisibleState => {
  const base = deriveVisibleState(createInitialGameState());
  return {
    ...base,
    liveOperations: {
      ...base.liveOperations,
      unlocked: true,
      enabled: true,
      canConfigure: true,
      systemId: base.selectedSystem.id,
      maxCoreCount: 2,
      maximumCoreCount: 6,
      allocatedCoreCount: 2,
      progress: 0.25,
      remainingMs: 9_000,
      projectedDurationMs: 12_000,
      projectedPowerWatts: "0.0000042",
      projectedOperatingCostCredits: exactResourceBag(
        "12.30765714285714285714285714",
      ).credits,
      projectedRewardCredits: exactResourceBag("2160").credits,
      projectedNetRewardCredits: exactResourceBag(
        "2147.69234285714285714285714",
      ).credits,
      projectedMarginBps: 9_943,
      blockedReason: null,
      ...overrides,
    },
  };
};

describe("LiveOperationsView", () => {
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

  const render = (visible: VisibleState) => {
    act(() => {
      root.render(<LiveOperationsView visible={visible} dispatch={vi.fn()} />);
    });
  };

  const tileByLabel = (label: string) =>
    [...container.querySelectorAll(".stat-tile")].find(
      (tile) => tile.querySelector(".stat-tile-label")?.textContent === label,
    );

  it("formats Net, Power, and margin through the standard helpers instead of raw floats", () => {
    render(visibleWithLiveOperations());

    // Net is a per-batch credit AMOUNT: currency never shows decimals.
    const net = tileByLabel("Net");
    expect(net?.querySelector(".stat-tile-value")?.textContent).toBe(
      "2147cr",
    );
    expect(net?.textContent).not.toContain("2147.69234285714285714285714");

    // The Net tooltip folds reward/cost/margin/batch in the same formats.
    expect(net?.getAttribute("title")).toContain("reward 2160 cr");
    expect(net?.getAttribute("title")).toContain("cost 12 cr");
    expect(net?.getAttribute("title")).not.toContain("12.30765714285714285714285714");
    expect(net?.getAttribute("title")).toContain("margin 99.4%");

    // Power: the standard watt bands, not a raw fractional-watt string.
    const power = tileByLabel("Power");
    expect(power?.querySelector(".stat-tile-value")?.textContent).toBe(
      "4.2 uW",
    );
    expect(power?.textContent).not.toContain("0.0000042");
  });

  it("reserves the blocked-reason slot whether or not a blocker is live", () => {
    // No blocker: the slot is mounted and blank, so a blocker landing later
    // recolors it in place instead of pushing the action row down.
    render(visibleWithLiveOperations({ blockedReason: null }));
    const idleSlot = container.querySelector<HTMLElement>(
      ".live-operations-blocked",
    );
    expect(idleSlot).not.toBeNull();
    expect(idleSlot?.getAttribute("role")).toBe("status");
    expect(idleSlot?.textContent).toBe("");
    expect(idleSlot?.className).not.toContain("work-blocked-reason");

    render(
      visibleWithLiveOperations({
        blockedReason: "Queued work currently owns every eligible core.",
      }),
    );
    const blockedSlot = container.querySelector<HTMLElement>(
      ".live-operations-blocked",
    );
    expect(blockedSlot?.textContent).toBe(
      "Queued work currently owns every eligible core.",
    );
    expect(blockedSlot?.className).toContain("work-blocked-reason");
    expect(blockedSlot?.title).toBe(
      "Queued work currently owns every eligible core.",
    );
  });

  it("keeps zero lane draw honest as 0 W", () => {
    render(
      visibleWithLiveOperations({
        projectedPowerWatts: "0",
        projectedOperatingCostCredits: exactResourceBag("0").credits,
        projectedNetRewardCredits: exactResourceBag("2160").credits,
        projectedMarginBps: 10_000,
      }),
    );

    const power = tileByLabel("Power");
    expect(power?.querySelector(".stat-tile-value")?.textContent).toBe("0 W");
    const net = tileByLabel("Net");
    expect(net?.getAttribute("title")).toContain("cost 0 cr");
    expect(net?.getAttribute("title")).toContain("margin 100%");
  });
});
