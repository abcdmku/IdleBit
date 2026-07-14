import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialGameState,
  deriveVisibleState,
  type VisibleState,
} from "../../game";
import { ResearchPanel } from "./ResearchPanel";
import type { UiResearch } from "./taskTypes";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

/** Minimal synthetic research card; ResearchPanel reads visible.research. */
const researchItem = (overrides: Partial<UiResearch> = {}): UiResearch =>
  ({
    id: "geometryProbe",
    name: "Geometry Probe",
    description: "Synthetic research card for geometry checks.",
    accent: "violet",
    costs: [],
    canAfford: true,
    canBuy: true,
    ...overrides,
  }) as UiResearch;

const withResearch = (items: UiResearch[]): VisibleState => {
  const base = deriveVisibleState(createInitialGameState());
  return { ...base, research: items } as unknown as VisibleState;
};

describe("ResearchPanel reserved geometry", () => {
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
      root.render(<ResearchPanel visible={visible} dispatch={vi.fn()} />);
    });
  };

  const mainRowStructure = () => {
    const row = container.querySelector(".research-action-main");
    return {
      row,
      children: [...(row?.children ?? [])].map((child) => child.tagName),
    };
  };

  it("keeps the same action-row structure when affordability flips", () => {
    render(withResearch([researchItem()]));
    const ready = mainRowStructure();
    expect(ready.children).toEqual(["SPAN", "BUTTON"]);
    const readyButton = container.querySelector<HTMLButtonElement>(
      ".research-buy-button",
    );
    expect(readyButton?.disabled).toBe(false);

    render(
      withResearch([
        researchItem({
          canAfford: false,
          canBuy: false,
          blockedReason: "Requires 5,000 credits and a Benchmark Harness.",
        }),
      ]),
    );
    // Blocked keeps copy + button as siblings in the same grid; only the
    // label and colors change (fixed column width lives in CSS).
    const blocked = mainRowStructure();
    expect(blocked.children).toEqual(ready.children);
    const blockedButton = container.querySelector<HTMLButtonElement>(
      ".research-buy-button",
    );
    expect(blockedButton?.disabled).toBe(true);
    // The clipped label keeps the full reason in the button title.
    expect(blockedButton?.title).toBe(
      "Requires 5,000 credits and a Benchmark Harness.",
    );
  });

  it("always reserves the compute-benchmark meter row", () => {
    const computeTask = {
      id: "microBenchmark",
      name: "Micro Benchmark",
      active: false,
      completed: false,
      canStart: true,
      canQueue: false,
      progress: 0,
    };
    render(
      withResearch([
        researchItem({
          canBuy: false,
          canAfford: false,
          computeTasks: [computeTask],
        } as Partial<UiResearch>),
      ]),
    );

    // Idle: the meter is already mounted at value 0.
    const idleRow = container.querySelector(".research-compute");
    expect(idleRow?.querySelector(".module-meter")).not.toBeNull();
    const idleChildren = [...(idleRow?.children ?? [])].map(
      (child) => child.tagName,
    );

    render(
      withResearch([
        researchItem({
          canBuy: false,
          canAfford: false,
          computeTasks: [{ ...computeTask, active: true, progress: 0.4 }],
        } as Partial<UiResearch>),
      ]),
    );

    // Running: identical row structure, meter fills in place.
    const activeRow = container.querySelector(".research-compute");
    expect(activeRow?.querySelector(".module-meter")).not.toBeNull();
    expect(
      [...(activeRow?.children ?? [])].map((child) => child.tagName),
    ).toEqual(idleChildren);
  });
});
