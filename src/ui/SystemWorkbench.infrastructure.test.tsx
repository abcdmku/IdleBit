import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialGameState, deriveVisibleState } from "../game";
import { SystemWorkbench } from "./components";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("SystemWorkbench infrastructure view", () => {
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

  it("lazy-loads Local Fabric at chapter four and withholds facilities until chapter five", async () => {
    const initial = createInitialGameState();
    const visible = deriveVisibleState({
      ...initial,
      campaign: {
        ...initial.campaign,
        currentChapterId: "localFabric",
        currentObjectiveId: "fabric:cluster-controller",
      },
    });

    await act(async () => {
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

    const infrastructureTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Infrastructure",
    );
    expect(infrastructureTab, container.innerHTML).toBeDefined();
    await act(async () => {
      infrastructureTab?.click();
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector('section[aria-label="Infrastructure"]'),
      ).not.toBeNull();
    });
    expect(container.textContent).toContain("Local Fabric");
    expect(container.textContent).not.toContain("Rack and Facility");
  });
});
