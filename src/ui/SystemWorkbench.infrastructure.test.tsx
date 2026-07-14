import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialGameState, deriveVisibleState } from "../game";
import { exactResourceBag } from "../game/amount";
import { withExactResources } from "../game/economy";
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

  it("dispatches setSystemManaged and purchaseAggregateServerBatch from the rendered Fleet controls", async () => {
    const initial = createInitialGameState();
    const visible = deriveVisibleState(
      withExactResources(
        {
          ...initial,
          campaign: {
            ...initial.campaign,
            currentChapterId: "localFabric",
            currentObjectiveId: "fabric:cluster-controller",
          },
          flags: { ...initial.flags, systemCatalog: true },
          research: {
            ...initial.research,
            completed: [...initial.research.completed, "systemCatalog" as const],
          },
        },
        exactResourceBag("1000000000000", "1000000000000"),
      ),
    );
    const dispatch = vi.fn();

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

    const infrastructureTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Infrastructure",
    );
    await act(async () => {
      infrastructureTab?.click();
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector(".fleet-node-row .fleet-node-action"),
      ).not.toBeNull();
    });

    const manageButton = container.querySelector<HTMLButtonElement>(
      ".fleet-node-row .fleet-node-action",
    );
    expect(manageButton?.textContent).toBe("Manage");
    expect(manageButton?.disabled).toBe(false);
    await act(async () => {
      manageButton?.click();
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setSystemManaged",
      systemId: 1,
      managed: true,
    });

    const workshopServerButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".server-catalog button"),
    ).find((button) => button.textContent?.includes("Workshop Server"));
    expect(workshopServerButton?.disabled).toBe(false);
    await act(async () => {
      workshopServerButton?.click();
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "purchaseAggregateServerBatch",
      skuId: "workshopServer",
      count: 1,
    });
  });
});
