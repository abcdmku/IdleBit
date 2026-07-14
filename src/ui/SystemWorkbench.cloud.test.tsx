import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialGameState, deriveVisibleState } from "../game";
import { SystemWorkbench } from "./components";
import type { Dispatch } from "./uiActions";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("SystemWorkbench Cloud view", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it("lazy-loads actionable Cloud controls only in Resilient Cloud", async () => {
    const initial = createInitialGameState();
    const visible = deriveVisibleState({
      ...initial,
      campaign: {
        ...initial.campaign,
        currentChapterId: "resilientCloud",
        currentObjectiveId: "cloud:data-center-noc",
      },
    });
    const dispatch = vi.fn<Dispatch>();

    await act(async () => {
      root.render(
        <SystemWorkbench
          visible={visible}
          dispatch={dispatch}
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

    const cloudTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Cloud",
    );
    expect(cloudTab).toBeDefined();
    await act(async () => cloudTab?.click());
    await vi.waitFor(() => {
      expect(
        container.querySelector('section[aria-label="Resilient Cloud"]'),
      ).not.toBeNull();
    });

    expect(container.textContent).toContain("Regional topology");
    const commission = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Commission region"),
    );
    act(() => commission?.click());
    expect(dispatch).toHaveBeenCalledWith({
      type: "commissionCloudRegion",
      name: "Regional Edge",
    });

    // Planetary Commons is a later chapter: its whole section (finale
    // control, charter choices) must stay absent in Resilient Cloud.
    const finale = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Start finale"),
    );
    expect(finale).toBeUndefined();
    expect(container.querySelector(".planetary-command")).toBeNull();
  });
});
