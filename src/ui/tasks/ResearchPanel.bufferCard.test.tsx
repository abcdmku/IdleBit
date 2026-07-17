import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialGameState,
  deriveVisibleState,
  exactResourceBag,
  type GameState,
  type VisibleState,
} from "../../game";
import { WorkPanel } from "../work/WorkPanel";
import { ResearchPanel } from "./ResearchPanel";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

/** Fresh save that completed Local Scheduler research. */
const researchedState = (funded: boolean): GameState => {
  const state = createInitialGameState();
  return {
    ...state,
    research: {
      ...state.research,
      completed: [...state.research.completed, "localScheduler"],
    },
    ...(funded
      ? {
          resources: { credits: 10_000, data: 1_000 },
          exactResources: exactResourceBag(10_000, 1_000),
        }
      : {}),
  };
};

describe("ResearchPanel automation buffer card", () => {
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

  const renderPanel = (
    visible: VisibleState,
    dispatch = vi.fn(),
    mutationsDisabled = false,
  ) => {
    act(() => {
      root.render(
        <ResearchPanel
          visible={visible}
          dispatch={dispatch}
          mutationsDisabled={mutationsDisabled}
        />,
      );
    });
    return dispatch;
  };

  const bufferCard = () =>
    container.querySelector<HTMLElement>(".automation-buffer-action");
  const buyButton = () =>
    bufferCard()?.querySelector<HTMLButtonElement>("button") ?? null;

  it("renders the unlocked next buffer and dispatches its purchase", () => {
    const visible = deriveVisibleState(researchedState(true));
    expect(visible.automationBuffer.nextUpgrade?.unlocked).toBe(true);
    const dispatch = renderPanel(visible);

    const card = bufferCard();
    expect(card?.textContent).toContain("Automation Buffer · Local Scheduler");
    expect(card?.textContent).toContain(
      "After you close the game, queued work can keep running",
    );
    expect(card?.textContent).toContain("does not add or repeat jobs");
    expect(card?.querySelector(".stat-tile")?.getAttribute("aria-label")).toBe(
      "Offline coverage increases from 0m to 2h",
    );
    expect(card?.querySelector(".stat-tile-value")?.textContent).toContain(
      "0m → 2h",
    );
    expect(card?.textContent).toContain("70");
    expect(card?.textContent).toContain("8");

    const buy = buyButton();
    expect(buy?.disabled).toBe(false);
    expect(buy?.textContent).toContain("Add 2h");
    act(() => buy?.click());
    expect(dispatch).toHaveBeenCalledWith({
      type: "purchaseAutomationBuffer",
      levelId: "localScheduler",
    });
  });

  it("blocks the purchase during offline processing", () => {
    const visible = deriveVisibleState(researchedState(true));
    const dispatch = renderPanel(visible, vi.fn(), true);

    const buy = buyButton();
    expect(buy?.disabled).toBe(true);
    expect(buy?.title).toBe("Wait for offline processing");
    act(() => buy?.click());
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("labels an unlocked but unaffordable buffer with its blocker", () => {
    const visible = deriveVisibleState(researchedState(false));
    const upgrade = visible.automationBuffer.nextUpgrade;
    expect(upgrade?.unlocked).toBe(true);
    expect(upgrade?.canAfford).toBe(false);
    renderPanel(visible);

    const buy = buyButton();
    expect(buy?.disabled).toBe(true);
    expect(buy?.title).toBe(upgrade?.blockedReason);
    expect(buy?.textContent).toContain("Insufficient resources.");
  });

  it("hides the card while the next buffer is research-locked", () => {
    const visible = deriveVisibleState(createInitialGameState());
    expect(visible.automationBuffer.nextUpgrade?.unlocked).toBe(false);
    renderPanel(visible);

    expect(bufferCard()).toBeNull();
    expect(container.textContent).not.toContain("Automation Buffer ·");
  });

  it("guarantees a first-session purchase path before the Automation tab appears", () => {
    const visible = deriveVisibleState(researchedState(true));

    renderPanel(visible);
    expect(buyButton()?.disabled).toBe(false);

    act(() => root.unmount());
    root = createRoot(container);
    act(() => {
      root.render(
        <WorkPanel
          visible={visible}
          selectedComponent="core:1"
          dispatch={vi.fn()}
        />,
      );
    });
    expect(
      container.querySelector('[role="tab"][aria-label="Automation"]'),
    ).toBeNull();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
  });
});
