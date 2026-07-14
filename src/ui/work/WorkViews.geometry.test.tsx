import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRackReadyGameState,
  deriveVisibleState,
  exactResourceBag,
  type VisibleContract,
  type VisibleState,
} from "../../game";
import { ContractsView, ProjectsView } from "./WorkViews";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const offer = (
  id: string,
  overrides: Partial<VisibleContract> = {},
): VisibleContract => ({
  id,
  templateId: "ledgerAudit",
  kind: "sustained",
  name: `Ledger Audit ${id}`,
  description: "Audit a bounded ledger workload.",
  systemId: 1,
  workRequiredMs: 60 * 60 * 1_000,
  workCompletedMs: 0,
  remainingMs: 60 * 60 * 1_000,
  expiresAtMs: 6 * 60 * 60 * 1_000,
  rewards: exactResourceBag(40, 4),
  novel: false,
  accepted: false,
  valuePerHourCredits: exactResourceBag(40, 0).credits,
  expiresInMs: 6 * 60 * 60 * 1_000,
  operatingCostCredits: exactResourceBag(4, 0).credits,
  netRewardCredits: exactResourceBag(36, 0).credits,
  creditRunwayCovered: true,
  bufferCovered: true,
  canAccept: true,
  projectedPauseReason: null,
  systemOptions: [
    { systemId: 1, name: "Suggested Rig", blockedReason: null },
    {
      systemId: 2,
      name: "Busy Rig",
      blockedReason: "System 2 already has an active managed contract.",
    },
  ],
  ...overrides,
});

describe("WorkViews reserved geometry", () => {
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

  it("keeps phase, target, and action slots on a completed project card", () => {
    const base = deriveVisibleState(createRackReadyGameState());
    const project = base.projects[0]!;
    const completed = {
      ...project,
      active: false,
      completed: true,
      currentPhase: null,
      canStartPhase: false,
      projectionBlockedReason: null,
      blockedReason: null,
    };
    const visible: VisibleState = {
      ...base,
      projects: [completed],
      work: { ...base.work, projects: [completed] },
    };

    act(() => {
      root.render(
        <ProjectsView
          visible={visible}
          dispatch={vi.fn()}
          targetSystemId={base.selectedSystem.id}
          onTargetSystemChange={() => undefined}
        />,
      );
    });

    const card = container.querySelector(".work-card.project");
    expect(card?.className).toContain("completed");
    // Phase slot survives completion with a completed readout.
    const phaseTile = [...(card?.querySelectorAll(".stat-tile") ?? [])].find(
      (tile) => tile.querySelector(".stat-tile-label")?.textContent === "Phase",
    );
    expect(phaseTile?.querySelector(".stat-tile-value")?.textContent).toBe(
      "Complete",
    );
    // Work mix and progress rows keep their fixed-height tracks.
    expect(card?.querySelector(".work-mix-bar")).not.toBeNull();
    expect(card?.querySelector('[role="progressbar"]')).not.toBeNull();
    // Target-system slot stays, disabled in place.
    const select = card?.querySelector<HTMLSelectElement>(
      'select[aria-label^="Target system for"]',
    );
    expect(select).not.toBeNull();
    expect(select?.disabled).toBe(true);
    // Action slot stays, disabled in place.
    const action = card?.querySelector<HTMLButtonElement>(
      ".work-primary-action",
    );
    expect(action).not.toBeNull();
    expect(action?.disabled).toBe(true);
    expect(action?.textContent).toContain("Complete");
  });

  it("keeps contracts in one stable list and accepts them in place", () => {
    const base = deriveVisibleState(createRackReadyGameState());
    const render = (contracts: VisibleContract[], dispatch = vi.fn()) => {
      act(() => {
        root.render(
          <ContractsView
            visible={{ ...base, contracts }}
            dispatch={dispatch}
          />,
        );
      });
      return dispatch;
    };

    // The selector lists active contracts before offers; the view re-sorts by
    // creation id so the accepted card never jumps.
    render([
      offer("contract-2", { accepted: true, workCompletedMs: 30 * 60 * 1_000 }),
      offer("contract-1"),
    ]);

    // One flat list, no Active/Offers section headings.
    expect(container.querySelectorAll(".work-card-list")).toHaveLength(1);
    expect(container.querySelector("h3")).toBeNull();
    expect(container.textContent).toContain("1 offers · 1 active");

    const cards = [...container.querySelectorAll(".work-card.contract")];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain("Ledger Audit contract-1");
    expect(cards[1]?.textContent).toContain("Ledger Audit contract-2");

    // Both states expose the same slots: header time chip, progress bar,
    // payoff row, and a fixed action row.
    for (const card of cards) {
      expect(card.querySelector(".work-contract-when")).not.toBeNull();
      expect(card.querySelector('[role="progressbar"]')).not.toBeNull();
      expect(card.querySelector(".work-contract-payoff")).not.toBeNull();
      expect(card.querySelector(".work-contract-actions")).not.toBeNull();
    }

    // The offer card carries live Accept/Decline; the accepted card swaps the
    // buttons for an equal-height status chip in the same action row.
    const offerCard = cards[0]!;
    const activeCard = cards[1]!;
    expect(offerCard.textContent).toContain("Accept");
    expect(offerCard.querySelector(".work-contract-status")).toBeNull();
    expect(activeCard.querySelector(".work-contract-status")?.textContent)
      .toContain("Active");
    expect(activeCard.textContent).not.toContain("Accept");
    expect(activeCard.textContent).not.toContain("Decline");

    // Accepting a contract keeps its card position; only its status flips.
    render([
      offer("contract-1", { accepted: true }),
      offer("contract-2", { accepted: true, workCompletedMs: 30 * 60 * 1_000 }),
    ]);
    const flipped = [...container.querySelectorAll(".work-card.contract")];
    expect(flipped[0]?.textContent).toContain("Ledger Audit contract-1");
    expect(flipped[0]?.querySelector(".work-contract-status")).not.toBeNull();
    expect(container.textContent).toContain("0 offers · 2 active");
  });

  it("puts the target select in the offer's fixed system slot and routes accept", () => {
    const base = deriveVisibleState(createRackReadyGameState());
    const dispatch = vi.fn();
    const contracts = [
      offer("contract-1"),
      offer("contract-2", { accepted: true }),
    ];
    act(() => {
      root.render(
        <ContractsView visible={{ ...base, contracts }} dispatch={dispatch} />,
      );
    });

    const cards = [...container.querySelectorAll(".work-card.contract")];
    const offerCard = cards[0]!;
    const activeCard = cards[1]!;

    // The select occupies the same fixed payoff slot the label used; the
    // accepted card keeps the plain label, so accepting never reflows the row.
    const select = offerCard.querySelector<HTMLSelectElement>(
      '.work-contract-payoff .work-contract-system select[aria-label="Target system for Ledger Audit contract-1"]',
    );
    expect(select).not.toBeNull();
    expect(
      activeCard.querySelector(".work-contract-payoff .work-contract-system"),
    ).not.toBeNull();
    expect(activeCard.querySelector(".work-contract-system select")).toBeNull();

    // Busy/incompatible systems stay listed, carrying their blocker reason.
    const options = [...(select?.querySelectorAll("option") ?? [])];
    expect(options.map((option) => option.textContent)).toEqual([
      "Suggested Rig",
      "Busy Rig",
    ]);
    expect(options[0]?.getAttribute("title")).toBeNull();
    expect(options[1]?.getAttribute("title")).toBe(
      "System 2 already has an active managed contract.",
    );

    // Accepting untouched carries the generator-suggested default.
    const acceptButton = () =>
      [...offerCard.querySelectorAll<HTMLButtonElement>("button")].find(
        (candidate) => candidate.textContent?.includes("Accept"),
      )!;
    act(() => acceptButton().click());
    expect(dispatch).toHaveBeenCalledWith({
      type: "acceptContract",
      contractId: "contract-1",
      systemId: 1,
    });

    // Choosing a blocked system disables accept in place with the reason.
    act(() => {
      select!.value = "2";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(acceptButton().disabled).toBe(true);
    expect(acceptButton().getAttribute("title")).toBe(
      "System 2 already has an active managed contract.",
    );

    // Back on an eligible system, accept dispatches the player's choice.
    act(() => {
      select!.value = "1";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    dispatch.mockClear();
    act(() => acceptButton().click());
    expect(dispatch).toHaveBeenCalledWith({
      type: "acceptContract",
      contractId: "contract-1",
      systemId: 1,
    });
  });
});
