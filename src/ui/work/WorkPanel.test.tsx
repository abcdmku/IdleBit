import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  amount,
  createInitialGameState,
  createRackReadyGameState,
  deriveVisibleState,
  exactResourceBag,
  type GameState,
  type VisibleContract,
  type VisibleLiveOperations,
  type VisibleState,
} from "../../game";
import { WorkPanel } from "./WorkPanel";
type LiveOperationsVisibleState = VisibleState;

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const offer = (id: string): VisibleContract => ({
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
  novel: true,
  accepted: false,
  valuePerHourCredits: exactResourceBag(40, 0).credits,
  expiresInMs: 6 * 60 * 60 * 1_000,
  operatingCostCredits: exactResourceBag(4, 0).credits,
  netRewardCredits: exactResourceBag(36, 0).credits,
  creditRunwayCovered: true,
  bufferCovered: true,
  canAccept: true,
  projectedPauseReason: null,
});

/** Fresh state with reveal flags toggled the way research grants would. */
const stateWithFlags = (flags: Partial<GameState["flags"]>): GameState => {
  const state = createInitialGameState();
  return { ...state, flags: { ...state.flags, ...flags } };
};

/** Fresh state advanced to a later chapter without any research/flags. */
const stateAtChapter = (
  chapterId: GameState["campaign"]["currentChapterId"],
): GameState => {
  const state = createInitialGameState();
  return { ...state, campaign: { ...state.campaign, currentChapterId: chapterId } };
};

const withLiveOperations = (
  base: VisibleState,
  overrides: Partial<VisibleLiveOperations> = {},
): LiveOperationsVisibleState => ({
  ...base,
  // Live Ops only exists in the scheduler era, where Automation is revealed.
  workViews: { ...base.workViews, automation: true },
  liveOperations: {
    unlocked: true,
    enabled: false,
    canConfigure: true,
    systemId: null,
    maxCoreCount: 1,
    maximumCoreCount: 6,
    workMix: [
      { id: "liveQueueTriage", name: "Queue Triage" },
      { id: "liveCanaryValidation", name: "Canary Validation" },
    ],
    activeTaskId: null,
    activeTaskName: null,
    nextTaskName: "Queue Triage",
    allocatedCoreCount: 0,
    progress: 0,
    remainingMs: null,
    projectedDurationMs: 15 * 60 * 1_000,
    projectedPowerWatts: "18.5",
    projectedOperatingCostCredits: exactResourceBag("12.5").credits,
    projectedRewardCredits: exactResourceBag(50).credits,
    projectedNetRewardCredits: exactResourceBag("37.5").credits,
    projectedMarginBps: 7_500,
    blockedReason: null,
    offlineBehavior: "Live Ops resumes from the retained batch on return.",
    ...overrides,
  },
});

describe("WorkPanel", () => {
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

  const renderPanel = (visible: VisibleState, dispatch = vi.fn()) => {
    act(() => {
      root.render(
        <WorkPanel
          visible={visible}
          selectedComponent="core:1"
          dispatch={dispatch}
        />,
      );
    });
    return dispatch;
  };

  const selectTab = (label: string) => {
    const tab = container.querySelector<HTMLButtonElement>(
      `[role="tab"][aria-label="${label}"]`,
    );
    act(() => tab?.click());
    return tab;
  };

  const tabLabels = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).map(
      (tab) => tab.getAttribute("aria-label"),
    );

  it("defaults to playable Jobs and exposes named keyboard tabs", () => {
    renderPanel(deriveVisibleState(createInitialGameState()));

    const tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    const jobsTab = tabs.find((tab) => tab.getAttribute("aria-label") === "Jobs");
    expect(tabs).toHaveLength(1);
    expect(jobsTab?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain(
      "Fetch Bit",
    );
    act(() => {
      jobsTab?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
      );
    });
    expect(jobsTab?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(jobsTab);
  });

  it("keeps campaign stages and objective instructions out of Jobs", () => {
    const visible = deriveVisibleState(createInitialGameState());
    renderPanel(visible);

    expect(tabLabels()).toEqual(["Jobs"]);
    expect(visible.currentObjective?.blockedReason).toBeTruthy();
    expect(container.querySelector(".mobile-current-objective")).toBeNull();
    expect(container.textContent).not.toContain("Bootstrap Node");
    expect(container.textContent).not.toContain(
      visible.currentObjective?.blockedReason,
    );
  });

  it("hides Campaign pre-scheduler even when a project phase is startable", () => {
    const base = deriveVisibleState(stateAtChapter("coherentMachine"));
    expect(base.workViews.campaign).toBe(false);
    const project = base.projects.find(
      (candidate) => candidate.id === "schedulerIntegration",
    );
    expect(project).toBeTruthy();
    const startable = {
      ...project!,
      canStartPhase: true,
      blockedReason: null,
      systemProjections: project!.systemProjections?.map((projection) => ({
        ...projection,
        canStartPhase: true,
        startBlockedReason: null,
      })),
    };
    renderPanel({
      ...base,
      projects: [startable],
      work: { ...base.work, projects: [startable] },
    });

    expect(
      container.querySelector('[role="tab"][aria-label="Campaign"]'),
    ).toBeNull();
    expect(tabLabels()).toEqual(["Jobs"]);
  });

  it("reveals Campaign with the scheduler flag before any project starts", () => {
    const visible = deriveVisibleState(stateWithFlags({ scheduler: true }));
    expect(visible.projects.some((project) => project.active)).toBe(false);
    renderPanel(visible);

    expect(
      container.querySelector('[role="tab"][aria-label="Campaign"]'),
    ).not.toBeNull();
    selectTab("Campaign");
    expect(container.querySelector(".work-card.project")).toBeNull();
  });

  it("keeps Campaign open for a legacy save with an active project and no research", () => {
    const state = stateAtChapter("coherentMachine");
    const legacy: GameState = {
      ...state,
      projects: {
        ...state.projects,
        progress: {
          schedulerIntegration: {
            projectId: "schedulerIntegration",
            phaseIndex: 0,
            phaseProgressMs: 0,
            active: true,
            completed: false,
            systemId: state.selectedSystemId,
          },
        },
      },
    };
    expect(legacy.flags.scheduler).toBe(false);
    const visible = deriveVisibleState(legacy);
    expect(visible.workViews.campaign).toBe(true);
    renderPanel(visible);

    selectTab("Campaign");
    const card = container.querySelector(".work-card.project");
    expect(card?.querySelector("header b")?.textContent).toBe("Active");
  });

  it("hides the Market on chapter progress alone", () => {
    const visible = deriveVisibleState(stateAtChapter("coherentMachine"));
    expect(visible.currentChapter?.index ?? 0).toBeGreaterThanOrEqual(2);
    expect(visible.contracts).toHaveLength(0);
    renderPanel(visible);

    expect(
      container.querySelector('[role="tab"][aria-label="Contract Market"]'),
    ).toBeNull();
  });

  it("reveals Market with CRON and Automation with the scheduler flag", () => {
    renderPanel(deriveVisibleState(stateWithFlags({ cron: true })));
    expect(tabLabels()).toEqual(["Jobs", "Contract Market", "Automation"]);

    renderPanel(deriveVisibleState(stateWithFlags({ scheduler: true })));
    expect(tabLabels()).toEqual(["Jobs", "Campaign", "Automation"]);
  });

  it("keeps the Market open for a legacy save holding an active contract", () => {
    const state = createInitialGameState();
    const legacy: GameState = {
      ...state,
      contracts: {
        ...state.contracts,
        active: [
          {
            id: "legacy-1",
            templateId: "ledgerAudit",
            kind: "sustained",
            name: "Ledger Audit",
            description: "Legacy accepted contract.",
            systemId: state.selectedSystemId,
            workRequiredMs: 60 * 60 * 1_000,
            expiresAtMs: 6 * 60 * 60 * 1_000,
            rewards: exactResourceBag(40, 4),
            novel: false,
            acceptedAtMs: 0,
            workCompletedMs: 0,
          },
        ],
      },
    };
    expect(legacy.flags.cron).toBe(false);
    const visible = deriveVisibleState(legacy);
    expect(visible.workViews.market).toBe(true);
    renderPanel(visible);

    expect(
      container.querySelector('[role="tab"][aria-label="Contract Market"]'),
    ).not.toBeNull();
  });

  it("disables the market refresh pre-CRON and never dispatches it", () => {
    const state = createInitialGameState();
    const legacy: GameState = {
      ...state,
      contracts: {
        ...state.contracts,
        active: [
          {
            id: "legacy-1",
            templateId: "ledgerAudit",
            kind: "sustained",
            name: "Ledger Audit",
            description: "Legacy accepted contract.",
            systemId: state.selectedSystemId,
            workRequiredMs: 60 * 60 * 1_000,
            expiresAtMs: 6 * 60 * 60 * 1_000,
            rewards: exactResourceBag(40, 4),
            novel: false,
            acceptedAtMs: 0,
            workCompletedMs: 0,
          },
        ],
      },
    };
    const visible = deriveVisibleState(legacy);
    expect(visible.contractMarket.canRefresh).toBe(false);
    expect(visible.contractMarket.refreshBlockedReason).toBe(
      "Requires CRON Scheduler research.",
    );
    const dispatch = renderPanel(visible);
    selectTab("Contract Market");

    // The disabled refresh button carries the market blocker as its label.
    const refresh = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) =>
      button.textContent?.includes("Requires CRON Scheduler research."),
    );
    expect(refresh?.disabled).toBe(true);
    expect(refresh?.title).toBe("Requires CRON Scheduler research.");
    expect(refresh?.textContent).not.toContain("Refresh market");
    act(() => refresh?.click());
    expect(dispatch).not.toHaveBeenCalledWith({ type: "refreshContractMarket" });
  });

  it("falls back to Jobs when the selected tab disappears", () => {
    const cronBase = deriveVisibleState(stateWithFlags({ cron: true }));
    renderPanel(cronBase);
    const market = selectTab("Contract Market");
    expect(market?.getAttribute("aria-selected")).toBe("true");

    renderPanel(deriveVisibleState(createInitialGameState()));
    expect(tabLabels()).toEqual(["Jobs"]);
    expect(
      container
        .querySelector('[role="tab"][aria-label="Jobs"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain(
      "Fetch Bit",
    );
  });

  it("keeps Automation hidden before purchase and reveals it with installed coverage", () => {
    const state = createInitialGameState();
    const researched: GameState = {
      ...state,
      research: {
        ...state.research,
        completed: [...state.research.completed, "localScheduler"],
      },
      resources: { credits: 10_000, data: 1_000 },
      exactResources: exactResourceBag(10_000, 1_000),
    };
    const visible = deriveVisibleState(researched);
    expect(visible.automationBuffer.nextUpgrade?.unlocked).toBe(true);
    renderPanel(visible);
    expect(
      container.querySelector('[role="tab"][aria-label="Automation"]'),
    ).toBeNull();

    // The first purchase reveals a status surface so its effect is immediate.
    const owned: GameState = {
      ...researched,
      automationBuffer: {
        ...researched.automationBuffer,
        ownedLevelId: "localScheduler",
      },
    };
    const ownedVisible = deriveVisibleState(owned);
    expect(ownedVisible.automationBuffer.maxOfflineMs).toBeGreaterThan(0);
    renderPanel(ownedVisible);
    expect(
      container.querySelector('[role="tab"][aria-label="Automation"]'),
    ).not.toBeNull();
    expect(tabLabels()).toEqual(["Jobs", "Automation"]);
    selectTab("Automation");
    expect(container.textContent).toContain("Local Scheduler");
    expect(
      container.querySelector('.stat-tile[aria-label="Max 2h"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Queue jobs before leaving");
  });

  it("shows the status-only buffer readout and hides locked Live Ops in Automation", () => {
    const base = deriveVisibleState(createInitialGameState());
    renderPanel(withLiveOperations(base, { unlocked: false }));

    selectTab("Automation");
    const panel = container.querySelector(".automation-buffer-panel");
    expect(panel?.textContent).toContain("Automation Buffer");
    expect(panel?.textContent).toContain("Starting Node");
    expect(panel?.querySelector("button")).toBeNull();
    expect(container.querySelector('[aria-label="Live Ops status"]')).toBeNull();
  });

  it("configures Live Ops with the exact selected system and core cap", () => {
    const base = deriveVisibleState(createInitialGameState());
    const dispatch = renderPanel(withLiveOperations(base));
    selectTab("Automation");

    const cap = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Live Ops core cap"]',
    );
    act(() => {
      if (!cap) return;
      cap.value = "4";
      cap.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const configure = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Configure"));
    act(() => configure?.click());

    expect(dispatch).toHaveBeenCalledWith({
      type: "configureLiveOperations",
      systemId: base.selectedSystem.id,
      maxCoreCount: 4,
    });
  });

  it("enables configured Live Ops", () => {
    const base = deriveVisibleState(createInitialGameState());
    const dispatch = vi.fn();
    const configured = withLiveOperations(base, {
      systemId: base.selectedSystem.id,
      maxCoreCount: 3,
    });
    renderPanel(configured, dispatch);
    selectTab("Automation");

    const actionButton = (label: "Enable" | "Pause") =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.includes(label),
      );
    act(() => actionButton("Enable")?.click());
    expect(dispatch).toHaveBeenCalledWith({
      type: "setLiveOperationsEnabled",
      enabled: true,
    });
  });

  it("pauses running Live Ops", () => {
    const base = deriveVisibleState(createInitialGameState());
    const dispatch = renderPanel(
      withLiveOperations(base, {
        enabled: true,
        systemId: base.selectedSystem.id,
        maxCoreCount: 3,
      }),
    );
    selectTab("Automation");

    const pause = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Pause"));
    act(() => pause?.click());
    expect(dispatch).toHaveBeenCalledWith({
      type: "setLiveOperationsEnabled",
      enabled: false,
    });
  });

  it("labels Live Ops status, projection, progress, and blockers", () => {
    const base = deriveVisibleState(createInitialGameState());
    renderPanel(
      withLiveOperations(base, {
        enabled: true,
        systemId: base.selectedSystem.id,
        maxCoreCount: 4,
        allocatedCoreCount: 2,
        activeTaskId: "liveCanaryValidation",
        activeTaskName: "Canary Validation",
        nextTaskName: "Queue Triage",
        progress: 0.375,
        remainingMs: 90_000,
        blockedReason: "Queued work currently owns every eligible core.",
      }),
    );
    selectTab("Automation");

    // Status and projection now share one compact grid.
    const status = container.querySelector('[aria-label="Live Ops status"]');
    // The remaining time is announced as part of the progress bar's label.
    const progress = container.querySelector<HTMLElement>(
      '[role="progressbar"][aria-label^="Live Ops batch progress"]',
    );
    expect(progress?.getAttribute("aria-label")).toContain("remaining");
    const blocker = container.querySelector('[role="status"]');

    // Three tiles carry the live picture; cost/reward/margin/batch time fold
    // into the Net tile tooltip, and the work mix into the batch line title.
    expect(status?.textContent).toContain("Canary Validation");
    expect(
      status
        ?.querySelector(".live-operations-batch")
        ?.getAttribute("title"),
    ).toContain("Queue Triage + Canary Validation");
    expect(status?.textContent).toContain("2 / 4");
    expect(
      status?.querySelector('.stat-tile[aria-label="Power 18.5 W"]'),
    ).not.toBeNull();
    // The Net tile's aria-label carries its full tooltip; find it by caption.
    const netTile = [...(status?.querySelectorAll(".stat-tile") ?? [])].find(
      (tile) => tile.querySelector(".stat-tile-label")?.textContent === "Net",
    );
    expect(netTile).not.toBeUndefined();
    expect(netTile?.getAttribute("title")).toContain("reward 50 cr");
    // Currency amounts never show decimals: 12.5 cr renders floored as 12 cr.
    expect(netTile?.getAttribute("title")).toContain("cost 12 cr");
    expect(netTile?.getAttribute("title")).toContain("75%");
    expect(netTile?.getAttribute("title")).toContain("15m 0s");
    expect(progress?.getAttribute("aria-valuenow")).toBe("0.375");
    expect(blocker?.textContent).toContain("every eligible core");
    // The full explainer lives on the card header tooltip; the card stays numeric.
    const explainer = container
      .querySelector(".live-operations-card header")
      ?.getAttribute("title");
    expect(explainer).toContain("only while the game is visible");
    expect(explainer).toContain("retained offline but does not advance");
  });

  it("navigates the dynamic unlocked tab list with arrow and boundary keys", () => {
    const base = deriveVisibleState(createInitialGameState());
    renderPanel(withLiveOperations(base));

    const tab = (label: string) =>
      container.querySelector<HTMLButtonElement>(
        `[role="tab"][aria-label="${label}"]`,
      );
    const jobs = tab("Jobs");
    act(() => jobs?.focus());
    act(() => {
      jobs?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
      );
    });
    expect(tab("Automation")?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Automation"));

    act(() => {
      tab("Automation")?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "End" }),
      );
    });
    expect(tab("Automation")?.getAttribute("aria-selected")).toBe("true");

    act(() => {
      tab("Automation")?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Home" }),
      );
    });
    expect(tab("Jobs")?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
  });

  it("dispatches refresh, accept, and decline contract actions", () => {
    const base = deriveVisibleState(stateWithFlags({ cron: true }));
    expect(base.contractMarket.canRefresh).toBe(true);
    const visible: VisibleState = {
      ...base,
      contracts: [offer("one"), offer("two")],
      work: { ...base.work, contracts: [offer("one"), offer("two")] },
    };
    const dispatch = renderPanel(visible);
    selectTab("Contract Market");

    const button = (text: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => candidate.textContent?.includes(text),
      );
    act(() => {
      button("Refresh market")?.click();
      button("Accept")?.click();
      button("Decline")?.click();
    });

    expect(dispatch).toHaveBeenCalledWith({ type: "refreshContractMarket" });
    expect(dispatch).toHaveBeenCalledWith({
      type: "acceptContract",
      contractId: "one",
      systemId: 1,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "declineContract",
      contractId: "one",
    });
    // Expiry sits in the header as a violet countdown; the exact rate,
    // baseline, and net-of-cost detail all live in the rate chip tooltip.
    const expiry = container.querySelector(".work-contract-when.is-novel");
    expect(expiry).not.toBeNull();
    expect(expiry?.getAttribute("title")).toContain("expires in 6h 0m");
    expect(expiry?.getAttribute("title")).toContain("novel Data");
    const rateChip = container.querySelector(".work-rate-chip");
    expect(rateChip).not.toBeNull();
    expect(rateChip?.getAttribute("title")).toContain("cr/h");
    expect(rateChip?.getAttribute("title")).toContain("baseline");
    expect(rateChip?.getAttribute("title")).toContain("4 cr operating cost");
  });

  it("compacts repeating exact hourly rates in the contract market", () => {
    const base = deriveVisibleState(stateWithFlags({ cron: true }));
    const repeatingRate = amount(`19079.${"9".repeat(1_019)}`);
    const repeatingOffer: VisibleContract = {
      ...offer("repeating"),
      valuePerHourCredits: repeatingRate,
    };
    const visible: VisibleState = {
      ...base,
      contracts: [repeatingOffer],
      contractMarket: {
        ...base.contractMarket,
        standingOrderTaskName: "Fetch Bit",
        standingOrderValuePerHourCredits: repeatingRate,
      },
      work: {
        ...base.work,
        contracts: [repeatingOffer],
      },
    };

    renderPanel(visible);
    selectTab("Contract Market");

    // The rate chip's tooltip compacts both the offer rate and the baseline.
    const rateChip = container.querySelector(".work-card .work-rate-chip");
    expect(rateChip).not.toBeNull();
    expect(rateChip?.getAttribute("title")).toContain("19,080 cr/h");
    expect(rateChip?.getAttribute("title")).toContain(
      "Fetch Bit baseline (19,080 cr/h)",
    );
    expect(container.textContent).not.toContain("19079.999999");
    expect(rateChip?.getAttribute("title")).not.toContain("19079.999999");
  });

  it("shows no ETA and the game-owned warning for a legacy active project", () => {
    const base = deriveVisibleState(createRackReadyGameState());
    const project = base.projects[0]!;
    const blockedProject = {
      ...project,
      active: true,
      remainingMs: Number.MAX_SAFE_INTEGER,
      projectionBlockedReason: "Barebones PC has no RAM throughput.",
    };
    const visible: VisibleState = {
      ...base,
      projects: [blockedProject],
      activeWork: [
        {
          id: `project:${project.id}`,
          kind: "project",
          name: project.name,
          progress: 0,
          remainingMs: Number.MAX_SAFE_INTEGER,
          systemId: base.selectedSystem.id,
        },
      ],
      work: {
        ...base.work,
        projects: [blockedProject],
      },
    };

    renderPanel(visible);
    selectTab("Campaign");

    const card = container.querySelector(".work-card.project");
    expect(card?.querySelector("header b")?.textContent).toBe("Active");
    expect(card?.textContent).toContain("No ETA");
    expect(card?.textContent).toContain("Barebones PC has no RAM throughput.");
    expect(card?.textContent).not.toContain("104249991d");
  });

  it("validates project starts against the locally selected target system", () => {
    const base = deriveVisibleState(createRackReadyGameState());
    const project = base.projects[0]!;
    const alternateSystem = {
      ...base.systems[0]!,
      id: 2,
      name: "Ready PC",
    };
    const blockedReason = "Barebones PC has no RAM throughput.";
    const targetAwareProject = {
      ...project,
      projectionBlockedReason: blockedReason,
      canStartPhase: false,
      blockedReason,
      systemProjections: [
        {
          systemId: base.selectedSystem.id,
          durationMs: Number.MAX_SAFE_INTEGER,
          remainingMs: Number.MAX_SAFE_INTEGER,
          projectionBlockedReason: blockedReason,
          canStartPhase: false,
          startBlockedReason: blockedReason,
        },
        {
          systemId: alternateSystem.id,
          durationMs: 60_000,
          remainingMs: 60_000,
          projectionBlockedReason: null,
          canStartPhase: true,
          startBlockedReason: null,
        },
      ],
    };
    const visible: VisibleState = {
      ...base,
      systems: [base.systems[0]!, alternateSystem],
      projects: [targetAwareProject],
      work: {
        ...base.work,
        projects: [targetAwareProject],
      },
    };
    const dispatch = renderPanel(visible);

    expect(
      container.querySelector('[role="tab"][aria-label="Campaign"]'),
    ).not.toBeNull();
    selectTab("Campaign");

    const card = container.querySelector(".work-card.project");
    const target = card?.querySelector<HTMLSelectElement>(
      'select[aria-label^="Target system for"]',
    );
    const start = card?.querySelector<HTMLButtonElement>(
      ".work-primary-action",
    );
    expect(card?.textContent).toContain("No ETA");
    expect(card?.textContent).toContain(blockedReason);
    expect(start?.disabled).toBe(true);
    expect(start?.title).toBe(blockedReason);

    act(() => {
      if (!target) return;
      target.value = String(alternateSystem.id);
      target.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // The target select is the single source for the chosen system.
    expect(target?.value).toBe(String(alternateSystem.id));
    expect(card?.textContent).toContain("1m 0s");
    expect(card?.textContent).not.toContain("No ETA");
    expect(card?.textContent).not.toContain(blockedReason);
    expect(start?.disabled).toBe(false);
    expect(start?.title).toBe(`Start ${project.currentPhase?.name}`);

    act(() => start?.click());
    expect(dispatch).toHaveBeenCalledWith({
      type: "startProjectPhase",
      projectId: project.id,
      systemId: alternateSystem.id,
    });
  });

  it("starts an affordable project phase on the labeled target system", () => {
    const visible = deriveVisibleState(createRackReadyGameState());
    const dispatch = renderPanel(visible);
    selectTab("Campaign");

    const startButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (button) =>
        button.textContent?.includes("Start next phase") && !button.disabled,
    );
    const projectCard = startButton?.closest(".work-card.project");
    const projectName = projectCard?.querySelector("header span")?.textContent;
    expect(projectName).toBeTruthy();
    expect(
      projectCard?.querySelector('select[aria-label^="Target system for"]'),
    ).not.toBeNull();

    act(() => startButton?.click());
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "startProjectPhase",
        systemId: visible.selectedSystem.id,
      }),
    );
  });

  it("configures and enables a standing order", () => {
    const base = deriveVisibleState(stateWithFlags({ cron: true }));
    const dispatch = renderPanel({
      ...base,
      cron: {
        ...base.cron,
        unlocked: true,
        taskOptions: [{ id: "fetchBit", name: "Fetch Bit" }],
      },
    });
    selectTab("Automation");

    const jobSelect = Array.from(container.querySelectorAll("select")).find(
      (select) => select.textContent?.includes("Fetch Bit"),
    );
    act(() => {
      if (jobSelect) {
        jobSelect.value = "fetchBit";
        jobSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const configure = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Configure"));
    act(() => configure?.click());

    expect(dispatch).toHaveBeenCalledWith({
      type: "setStandingOrder",
      taskId: "fetchBit",
      systemId: base.selectedSystem.id,
    });

    const configured: VisibleState = {
      ...base,
      standingOrder: {
        taskId: "fetchBit",
        systemId: base.selectedSystem.id,
        enabled: false,
        renewalCount: 2,
      },
      standingOrders: [
        {
          taskId: "fetchBit",
          name: "Fetch Bit",
          systemId: base.selectedSystem.id,
          enabled: false,
          renewalCount: 2,
        },
      ],
      cron: {
        ...base.cron,
        unlocked: true,
        taskOptions: [{ id: "fetchBit", name: "Fetch Bit" }],
      },
    };
    renderPanel(configured, dispatch);
    const enable = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Enable"));
    act(() => enable?.click());

    expect(dispatch).toHaveBeenCalledWith({
      type: "setStandingOrderEnabled",
      enabled: true,
    });
  });

  it("keeps unsaved standing-order picks when another system is selected", () => {
    const base = deriveVisibleState(stateWithFlags({ cron: true }));
    const withCron = (visible: VisibleState): VisibleState => ({
      ...visible,
      cron: {
        ...visible.cron,
        unlocked: true,
        taskOptions: [{ id: "fetchBit", name: "Fetch Bit" }],
      },
    });
    renderPanel(withCron(base));
    selectTab("Automation");

    const jobSelect = () =>
      Array.from(container.querySelectorAll("select")).find((select) =>
        select.textContent?.includes("Fetch Bit"),
      );
    act(() => {
      const select = jobSelect();
      if (select) {
        select.value = "fetchBit";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(jobSelect()?.value).toBe("fetchBit");

    // Inspecting a different system elsewhere in the UI (selectedSystem.id
    // changes, standing order unchanged) must not wipe the unsaved pick.
    renderPanel(
      withCron({
        ...base,
        selectedSystem: { ...base.selectedSystem, id: 99 },
      } as VisibleState),
    );
    expect(jobSelect()?.value).toBe("fetchBit");
  });

  it("forecasts coverage and labels unknown projections honestly", () => {
    const base = deriveVisibleState(stateWithFlags({ cron: true }));
    renderPanel({
      ...base,
      automationBuffer: {
        ...base.automationBuffer,
        ownedLevelId: "localScheduler",
        maxOfflineMs: 2 * 60 * 60 * 1_000,
        remainingOfflineMs: 2 * 60 * 60 * 1_000,
      },
      activeWork: [
        {
          id: "job:test",
          kind: "job",
          name: "Test job",
          progress: 0.25,
          remainingMs: 60 * 60 * 1_000,
          systemId: base.selectedSystem.id,
        },
      ],
      departureForecast: {
        ...base.departureForecast,
        coverageMs: 2 * 60 * 60 * 1_000,
        timedActiveCount: 1,
        fittingActiveCount: 1,
        unknownDurationCount: 0,
        aggregateOperatingCostPerSecond: amount(
          `19079.${"9".repeat(1_019)}`,
        ),
        projectedPauseReason: null,
      },
    });

    expect(
      container.querySelector('[aria-label="Pre-departure forecast"]'),
    ).toBeNull();
    selectTab("Automation");
    const forecast = container.querySelector('[aria-label="Pre-departure forecast"]');
    // Forecast facts render as stat tiles; full sentences live in aria/title.
    expect(
      forecast?.querySelector('.stat-tile[aria-label="2h 0m of 2h offline window"]'),
    ).not.toBeNull();
    expect(
      forecast?.querySelector(
        '.stat-tile[aria-label="1 of 1 timed active item complete within coverage."]',
      ),
    ).not.toBeNull();
    expect(forecast?.textContent).toContain("Renewal");
    expect(forecast?.textContent).toContain("None");
    // No projected blocker keeps the reserved status slot blank.
    expect(
      forecast?.querySelector('[role="status"]')?.textContent?.trim(),
    ).toBe("");
    expect(
      forecast?.querySelector('.stat-tile[aria-label="Cost 19,080 cr/s"]'),
    ).not.toBeNull();
    expect(forecast?.textContent).not.toContain("19079.999999");
  });
});
