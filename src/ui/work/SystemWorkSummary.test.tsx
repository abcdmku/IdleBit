import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createInitialGameState, deriveVisibleState } from "../../game";
import { SystemWorkSummary } from "./SystemWorkSummary";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("SystemWorkSummary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("shows only work owned by the rendered system", () => {
    const base = deriveVisibleState(createInitialGameState());
    const visible = {
      ...base,
      activeWork: [
        {
          id: "project:one",
          kind: "project" as const,
          name: "Scheduler Integration",
          progress: 0.4,
          remainingMs: 60_000,
          systemId: 1,
        },
        {
          id: "contract:two",
          kind: "contract" as const,
          name: "Remote Canary",
          progress: 0.2,
          remainingMs: 120_000,
          systemId: 2,
        },
      ],
    };

    act(() => root.render(<SystemWorkSummary visible={visible} systemId={1} />));

    expect(container.textContent).toContain("System work");
    expect(container.textContent).toContain("Scheduler Integration");
    expect(container.textContent).not.toContain("Remote Canary");
    expect(
      container.querySelector('[role="progressbar"][aria-label="Scheduler Integration progress"]'),
    ).not.toBeNull();
  });

  it("reserves a stable idle status region when the system owns no work", () => {
    const visible = deriveVisibleState(createInitialGameState());
    act(() => root.render(<SystemWorkSummary visible={visible} systemId={1} />));
    expect(container.textContent).toContain("System work");
    expect(container.textContent).toContain("Idle");
    // Idle renders as an unlit lane with an accessible name, not a sentence.
    const idleItem = container.querySelector(
      '.system-work-summary-item.idle[aria-label="No active work"]',
    );
    expect(idleItem).not.toBeNull();
    expect(idleItem?.querySelector(".system-work-idle-track")).not.toBeNull();
    expect(container.textContent).not.toContain("No active work");
    expect(container.textContent).not.toContain("Ready");
  });
});
