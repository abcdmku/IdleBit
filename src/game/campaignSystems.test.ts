import { describe, expect, it } from "vitest";
import { advanceGame } from "./advance";
import {
  campaignChapterDefinitions,
  campaignObjectiveDefinitions,
  finaleCharterDefinitions,
  getVisibleMissions,
  selectFinaleCharter,
  sideArcDefinitions,
  updateCampaignProgress,
} from "./campaign";
import {
  MAX_ACTIVE_CONTRACTS,
  MAX_CONTRACT_MARKET_OFFERS,
  acceptContract,
  advanceContracts,
  declineContract,
  normalizeContractMarketState,
  refreshContractMarket,
} from "./contracts";
import { amountCompare, amountToSafeNumber, exactResourceBag } from "./amount";
import { createRackReadyGameState } from "./devSeeds";
import { createInitialGameState } from "./progression";
import {
  canonicalPlanetaryFinalePlan,
  createPlanetaryFinaleRuntime,
} from "./planetary";
import {
  getProjectBlockedReason,
  getProjectDefinition,
  getVisibleProjects,
  startProjectPhase,
} from "./projects";
import { createRngState } from "./rng";
import { deserializeSave, serializeSave } from "./save";
import { deriveVisibleState } from "./selectors";
import { applyAction } from "./simulation";
import type {
  AutomationBufferLevelId,
  CampaignChapterId,
  ContractOfferState,
  GameState,
} from "./types";

const HOUR_MS = 60 * 60 * 1000;

const fund = (
  state: GameState,
  credits = "1000000",
  data = "1000000",
): GameState => ({
  ...state,
  exactResources: exactResourceBag(credits, data),
  resources: {
    credits: amountToSafeNumber(exactResourceBag(credits, data).credits),
    data: amountToSafeNumber(exactResourceBag(credits, data).data),
  },
});

const withCron = (state: GameState): GameState => ({
  ...state,
  flags: { ...state.flags, cron: true },
});

/**
 * Rack-ready seed without PSU billing so exact Credit/Data literals stay
 * stable while a project phase runs.
 */
const rackReadyWithoutPowerBilling = (): GameState => {
  const seeded = createRackReadyGameState();
  return {
    ...seeded,
    flags: { ...seeded.flags, psuManagement: false },
    research: {
      ...seeded.research,
      completed: seeded.research.completed.filter(
        (researchId) => researchId !== "psuManagement",
      ),
    },
  };
};

const atChapter = (
  state: GameState,
  chapterId: CampaignChapterId,
): GameState => {
  const chapter = campaignChapterDefinitions.find((item) => item.id === chapterId)!;
  return {
    ...state,
    campaign: {
      ...state.campaign,
      currentChapterId: chapterId,
      currentObjectiveId: chapter.objectiveIds[0] ?? null,
    },
  };
};

const withDepartureBuffer = (
  state: GameState,
  levelId: AutomationBufferLevelId,
): GameState => ({
  ...state,
  time: { ...state.time, departedAtMs: 1 },
  automationBuffer: {
    ownedLevelId: levelId,
    departureLevelId: levelId,
    offlineProcessedMs: 0,
  },
});

const offer = (
  overrides: Partial<ContractOfferState> = {},
): ContractOfferState => ({
  id: "contract-test",
  templateId: "ledgerAudit",
  kind: "sustained",
  name: "Ledger Audit",
  description: "Test contract",
  systemId: 1,
  workRequiredMs: 1_000,
  expiresAtMs: 60_000,
  rewards: exactResourceBag("12.5", "2"),
  novel: true,
  ...overrides,
});

const withOffer = (state: GameState, contract = offer()): GameState => ({
  ...state,
  contracts: { ...state.contracts, offers: [contract] },
});

const powerOff = (state: GameState): GameState => ({
  ...state,
  power: { ...state.power, state: "off" },
  systems: state.systems.map((system) => ({
    ...system,
    power: { ...system.power, state: "off" },
  })),
});

describe("campaign definitions and progression", () => {
  it("defines seven ordered chapters, transmissions, side arcs, and finale charters", () => {
    expect(campaignChapterDefinitions.map((chapter) => chapter.index)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(campaignChapterDefinitions.every((chapter) => chapter.objectiveIds.length > 0)).toBe(
      true,
    );
    expect(campaignObjectiveDefinitions.every((objective) => objective.transmission.length > 0)).toBe(
      true,
    );
    expect(sideArcDefinitions.map((arc) => arc.id)).toEqual([
      "archivist",
      "openFoundry",
      "gridRelief",
    ]);
    expect(finaleCharterDefinitions.map((charter) => charter.id)).toEqual([
      "resilience",
      "efficiency",
      "openCompute",
    ]);
  });

  it("advances the Bootstrap Node and Coherent Machine objective gates in order", () => {
    const initial = createInitialGameState();
    const bootstrapComplete = updateCampaignProgress({
      ...initial,
      completedTasks: {
        ...initial.completedTasks,
        fetchBit: 1,
        byteCopy: 1,
        microBenchmark: 1,
      },
      completedBenchmarks: ["microBenchmark"],
      research: { ...initial.research, completed: ["decodeLogic"] },
    });

    expect(bootstrapComplete.campaign.completedChapterIds).toContain("bootstrapNode");
    expect(bootstrapComplete.campaign.currentChapterId).toBe("coherentMachine");
    expect(bootstrapComplete.campaign.currentObjectiveId).toBe("coherent:multicore");
    expect(bootstrapComplete.campaign.unlockedTransmissionIds).toEqual(
      expect.arrayContaining([
        "bootstrap:first-operation",
        "bootstrap:decode-logic",
        "bootstrap:byte-copy",
        "bootstrap:first-benchmark",
      ]),
    );

    const coherentComplete = updateCampaignProgress({
      ...bootstrapComplete,
      research: {
        ...bootstrapComplete.research,
        completed: [
          ...bootstrapComplete.research.completed,
          "multiCore",
          "localScheduler",
          "ramControl",
          "systemScheduler",
          "cronScheduler",
        ],
      },
      hardware: { ...bootstrapComplete.hardware, ramBits: 8 },
      standingOrder: {
        taskId: "fetchBit",
        systemId: 1,
        enabled: true,
        renewalCount: 0,
      },
    });

    expect(coherentComplete.campaign.completedChapterIds).toEqual(
      expect.arrayContaining(["bootstrapNode", "coherentMachine"]),
    );
    expect(coherentComplete.campaign.currentChapterId).toBe("workshopFleet");
    expect(coherentComplete.campaign.currentObjectiveId).toBe("fleet:catalog");
    expect(getVisibleMissions(coherentComplete).find((mission) => mission.current)?.id).toBe(
      "fleet:catalog",
    );
  });

  it("derives completed side arcs and gates a persistent charter on the Cloud finale", () => {
    const initial = createInitialGameState();
    expect(selectFinaleCharter(initial, "resilience")).toBe(initial);

    const finale = createPlanetaryFinaleRuntime(canonicalPlanetaryFinalePlan);
    const finaleReady = updateCampaignProgress({
      ...atChapter(initial, "planetaryCommons"),
      projects: {
        ...initial.projects,
        completedProjectIds: [
          "archivist",
          "openFoundry",
          "gridRelief",
        ],
      },
      cloud: {
        ...initial.cloud,
        finale: {
          ...finale,
          phaseIndex: finale.plan.phases.length,
          completedPhaseIds: finale.plan.phases.map((phase) => phase.id),
          complete: true,
        },
      },
    });
    const chartered = selectFinaleCharter(finaleReady, "openCompute");

    expect(chartered.campaign.sideArcsCompleted).toEqual([
      "archivist",
      "openFoundry",
      "gridRelief",
    ]);
    expect(chartered.campaign.finaleCharterId).toBe("openCompute");
    expect(chartered.campaign.postgameUnlocked).toBe(true);
  });

  it("reveals missions and projects only for reached campaign chapters", () => {
    const initial = createInitialGameState();
    expect(
      getVisibleMissions(initial).every(
        (mission) => mission.chapterId === "bootstrapNode",
      ),
    ).toBe(true);
    expect(getVisibleProjects(initial)).toEqual([]);
    expect(getProjectBlockedReason(initial, "schedulerIntegration")).toBe(
      "Requires Coherent Machine.",
    );

    const coherent = atChapter(initial, "coherentMachine");
    const schedulerProject = getVisibleProjects(coherent).find(
      (project) => project.id === "schedulerIntegration",
    );
    expect(schedulerProject?.canStartPhase).toBe(false);
    expect(schedulerProject?.blockedReason).toBe(
      "Requires System Scheduler research.",
    );

    const workshop = atChapter(initial, "workshopFleet");
    expect(getVisibleProjects(workshop).map((project) => project.id)).toEqual([
      "schedulerIntegration",
      "openFoundry",
    ]);
    expect(
      getVisibleProjects(workshop).some((project) => project.id === "archivist"),
    ).toBe(false);
  });
});

describe("saved deterministic contract market", () => {
  it("cannot farm empty-market refreshes or exceed unique active capacity at zero time", () => {
    const preCron = fund(createInitialGameState());
    expect(refreshContractMarket(preCron)).toBe(preCron);
    expect(deriveVisibleState(preCron).contractMarket).toMatchObject({
      canRefresh: false,
      refreshBlockedReason: "Requires CRON Scheduler research.",
    });

    let state = withCron(preCron);
    for (let round = 0; round < 10; round += 1) {
      state = applyAction(state, { type: "refreshContractMarket" });
      for (const available of [...state.contracts.offers]) {
        state = applyAction(state, {
          type: "acceptContract",
          contractId: available.id,
        });
      }
    }

    expect(state.contracts.refreshCount).toBe(1);
    expect(state.contracts.active.length).toBeLessThanOrEqual(
      MAX_ACTIVE_CONTRACTS,
    );
    expect(new Set(state.contracts.active.map((item) => item.templateId)).size).toBe(
      state.contracts.active.length,
    );
    expect(new Set(state.contracts.active.map((item) => item.systemId)).size).toBe(
      state.contracts.active.length,
    );
    expect(state.contracts.active.every((item) => item.novel)).toBe(true);
    expect(deriveVisibleState(state).contractMarket).toMatchObject({
      canRefresh: false,
      refreshAvailableInMs: 15 * 60_000,
    });
  });

  it("reserves active templates and systems and reports capacity rejections publicly", () => {
    const funded = fund(createInitialGameState());
    const originalSystem = funded.systems[0]!;
    const base = {
      ...funded,
      systems: [
        originalSystem,
        { ...originalSystem, id: 2, name: "Contract System 2" },
        { ...originalSystem, id: 3, name: "Contract System 3" },
      ],
    };
    const activeOffers = [
      offer({ id: "active-1", templateId: "ledgerAudit", systemId: 1 }),
      offer({
        id: "active-2",
        templateId: "queueRecovery",
        kind: "burst",
        name: "Queue Recovery",
        systemId: 2,
      }),
      offer({
        id: "active-3",
        templateId: "compileBatch",
        name: "Compile Batch",
        systemId: 3,
      }),
    ];
    let state = base;
    for (const available of activeOffers) {
      state = acceptContract(withOffer(state, available), available.id);
    }

    const duplicate = offer({
      id: "duplicate",
      templateId: "ledgerAudit",
      systemId: 2,
    });
    const duplicateState = {
      ...state,
      contracts: {
        ...state.contracts,
        active: state.contracts.active.slice(0, 1),
        offers: [duplicate],
      },
    };
    expect(acceptContract(duplicateState, duplicate.id)).toBe(duplicateState);
    expect(deriveVisibleState(duplicateState).contracts.at(-1)).toMatchObject({
      id: "duplicate",
      canAccept: false,
      projectedPauseReason: expect.stringMatching(/already reserved/i),
    });

    const sameSystem = offer({
      id: "same-system",
      templateId: "renderBurst",
      kind: "burst",
      name: "Render Burst",
      systemId: 1,
    });
    const occupiedSystemState = {
      ...state,
      contracts: {
        ...state.contracts,
        active: state.contracts.active.slice(0, 1),
        offers: [sameSystem],
      },
    };
    expect(acceptContract(occupiedSystemState, sameSystem.id)).toBe(
      occupiedSystemState,
    );
    expect(deriveVisibleState(occupiedSystemState).contracts.at(-1)).toMatchObject({
      id: "same-system",
      canAccept: false,
      projectedPauseReason: expect.stringMatching(
        /already has an active managed contract/i,
      ),
    });

    const overflow = offer({
      id: "overflow",
      templateId: "renderBurst",
      kind: "burst",
      name: "Render Burst",
    });
    const capacityState = withOffer(state, overflow);
    expect(acceptContract(capacityState, overflow.id)).toBe(capacityState);
    expect(deriveVisibleState(capacityState).contracts.at(-1)).toMatchObject({
      id: "overflow",
      canAccept: false,
      projectedPauseReason: expect.stringMatching(/capacity is full/i),
    });
  });

  it("normalizes corrupt saves to the same unique active-contract capacity", () => {
    const active = [
      offer({ id: "one", templateId: "ledgerAudit", systemId: 1 }),
      offer({ id: "duplicate-template", templateId: "ledgerAudit", systemId: 2 }),
      offer({ id: "duplicate-system", templateId: "renderBurst", systemId: 1 }),
      offer({ id: "two", templateId: "queueRecovery", systemId: 2 }),
      offer({ id: "three", templateId: "compileBatch", systemId: 3 }),
      offer({ id: "four", templateId: "renderBurst", systemId: 4 }),
    ].map((contract) => ({
      ...contract,
      acceptedAtMs: 0,
      workCompletedMs: 0,
    }));
    const offers = [
      offer({ id: "offer-active-template", templateId: "ledgerAudit" }),
      offer({ id: "offer-one", templateId: "renderBurst" }),
      offer({ id: "offer-duplicate-template", templateId: "renderBurst" }),
      offer({ id: "offer-two", templateId: "gridForecast" }),
      offer({ id: "offer-three", templateId: "replicaSurvey" }),
      offer({ id: "offer-overflow", templateId: "queueRecovery" }),
    ];
    const normalized = normalizeContractMarketState({ active, offers });

    expect(normalized.active).toHaveLength(MAX_ACTIVE_CONTRACTS);
    expect(new Set(normalized.active.map((contract) => contract.id)).size).toBe(
      normalized.active.length,
    );
    expect(
      new Set(normalized.active.map((contract) => contract.templateId)).size,
    ).toBe(normalized.active.length);
    expect(new Set(normalized.active.map((contract) => contract.systemId)).size).toBe(
      normalized.active.length,
    );
    expect(normalized.active.map((contract) => contract.id)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(normalized.offers).toHaveLength(MAX_CONTRACT_MARKET_OFFERS);
    expect(new Set(normalized.offers.map((contract) => contract.id)).size).toBe(3);
    expect(new Set(normalized.offers.map((contract) => contract.templateId)).size).toBe(
      3,
    );
    expect(
      normalized.offers.every(
        (available) =>
          !normalized.active.some(
            (contract) => contract.templateId === available.templateId,
          ),
      ),
    ).toBe(true);
  });

  it("paces an all-reserved market and exposes expired corrupt offers as blocked", () => {
    const base = withCron(createInitialGameState());
    const active = [
      offer({ id: "reserved-ledger", templateId: "ledgerAudit" }),
      offer({ id: "reserved-queue", templateId: "queueRecovery" }),
    ].map((contract) => ({
      ...contract,
      acceptedAtMs: 0,
      workCompletedMs: 0,
    }));
    const due = {
      ...base,
      contracts: {
        ...base.contracts,
        elapsedMs: 15 * 60_000,
        nextRefreshAtMs: 15 * 60_000,
        active,
      },
    };
    const refreshed = refreshContractMarket(due);
    expect(refreshed.contracts.offers).toEqual([]);
    expect(refreshed.contracts.nextRefreshAtMs).toBe(30 * 60_000);
    expect(refreshContractMarket(refreshed)).toBe(refreshed);

    const expired = withOffer(base, offer({ expiresAtMs: 0 }));
    expect(deriveVisibleState(expired).contracts[0]).toMatchObject({
      canAccept: false,
      projectedPauseReason: expect.stringMatching(/expired/i),
    });
    expect(acceptContract(expired, "contract-test")).toBe(expired);
  });

  it("refreshes deterministically from saved RNG state and supports decline and expiry", () => {
    const base = { ...withCron(createInitialGameState()), rng: createRngState(42) };
    const first = refreshContractMarket(base);
    const replay = refreshContractMarket({ ...base, rng: createRngState(42) });
    const otherSeed = refreshContractMarket({ ...base, rng: createRngState(43) });

    expect(first.contracts.offers).toEqual(replay.contracts.offers);
    expect(first.rng).toEqual(replay.rng);
    expect(first.contracts.offers).not.toEqual(otherSeed.contracts.offers);
    expect(first.contracts.offers).toHaveLength(2);
    expect(first.contracts.offers.every((item) => typeof item.rewards.credits === "string")).toBe(
      true,
    );
    expect(
      first.contracts.offers.every(
        (item) => /^\d+(?:\.\d+)?$/.test(item.rewards.credits) &&
          item.rewards.credits.length < 64,
      ),
    ).toBe(true);
    const visibleMarket = deriveVisibleState(first);
    expect(visibleMarket.contractMarket).toMatchObject({
      canRefresh: false,
      refreshAvailableInMs: 15 * 60_000,
      standingOrderTaskName: "Fetch Bit",
    });
    expect(
      visibleMarket.contracts.every(
        (contract) => (contract.valueMultiplierVsStandingOrderBps ?? 0) > 0,
      ),
    ).toBe(true);

    const declinedId = first.contracts.offers[0]!.id;
    const declined = declineContract(first, declinedId);
    expect(declined.contracts.declinedContractIds).toContain(declinedId);
    expect(declined.contracts.offers.some((item) => item.id === declinedId)).toBe(false);

    const expired = advanceContracts(declined, 6 * HOUR_MS + 1, false);
    expect(expired.contracts.offers).toEqual([]);
  });

  it("preserves exact legacy contract Credit value while deriving its multiplier", () => {
    const legacyCredits =
      "24105.536214498378272337423244523481922312277793166752419665139459073267243121316467599";
    const normalized = normalizeContractMarketState({
      offers: [
        offer({
          id: "legacy-offer",
          rewards: exactResourceBag(legacyCredits, "1.25"),
        }),
      ],
      completedRewards: {
        "legacy-complete": exactResourceBag(legacyCredits, "2.5"),
      },
    });

    expect(normalized.offers[0]?.rewards).toEqual(
      exactResourceBag(legacyCredits, "1.25"),
    );
    expect(normalized.completedRewards["legacy-complete"]).toEqual(
      exactResourceBag(legacyCredits, "2.5"),
    );
  });

  it("freezes paid-work contract value across hardware baselines", () => {
    const slow = refreshContractMarket({
      ...withCron(createInitialGameState()),
      rng: createRngState(77),
      standingOrder: {
        taskId: "decodeBit",
        systemId: 1,
        enabled: true,
        renewalCount: 0,
      },
    });
    let fast = fund(createInitialGameState(), "100000000", "1000000");
    for (let level = 0; level < 8; level += 1) {
      fast = applyAction(fast, {
        type: "buyUpgrade",
        upgradeId: "clock",
        systemId: fast.selectedSystemId,
      });
    }
    fast = refreshContractMarket({
      ...withCron(fast),
      rng: createRngState(77),
      standingOrder: {
        taskId: "decodeBit",
        systemId: 1,
        enabled: true,
        renewalCount: 0,
      },
    });

    expect(slow.contracts.offers.length).toBeGreaterThan(0);
    const slowVisible = deriveVisibleState(slow);
    const fastVisible = deriveVisibleState(fast);
    expect(
      [...slowVisible.contracts, ...fastVisible.contracts].every(
        (contract) => (contract.valueMultiplierVsStandingOrderBps ?? 0) > 0,
      ),
    ).toBe(true);
    expect(
      [...slow.contracts.offers, ...fast.contracts.offers].every(
        (offer) => /^\d+(?:\.\d+)?$/.test(offer.rewards.credits),
      ),
    ).toBe(true);
    expect(fast.hardware.clockHz).toBeGreaterThan(slow.hardware.clockHz);
    expect(fast.contracts.offers.map((offer) => offer.rewards.credits)).toEqual(
      slow.contracts.offers.map((offer) => offer.rewards.credits),
    );
  });

  it("automatically rewards completion and grants contract Data only for a novel template", () => {
    const base = fund(withCron(createInitialGameState()));
    const accepted = acceptContract(withOffer(base), "contract-test");
    const completed = advanceContracts(accepted, 1_000);

    expect(completed.contracts.active).toEqual([]);
    expect(completed.contracts.completedContractIds).toContain("contract-test");
    expect(completed.contracts.completedTemplateIds).toContain("ledgerAudit");
    expect(completed.exactResources.credits).toBe("1000012.5");
    expect(completed.exactResources.data).toBe("1000002");

    const refreshed = refreshContractMarket({
      ...completed,
      contracts: {
        ...completed.contracts,
        offers: [],
        nextRefreshAtMs: completed.contracts.elapsedMs,
      },
    });
    const repeatedTemplate = refreshed.contracts.offers.find(
      (item) => item.templateId === "ledgerAudit",
    );
    const novelTemplate = refreshed.contracts.offers.find(
      (item) => item.templateId !== "ledgerAudit",
    );

    expect(repeatedTemplate?.novel).toBe(false);
    expect(repeatedTemplate?.rewards.data).toBe("0");
    expect(novelTemplate?.novel).toBe(true);
    expect(Number(novelTemplate?.rewards.data)).toBeGreaterThan(0);
  });

  it("uses identical contract work timing online and offline with Local Scheduler", () => {
    const accepted = acceptContract(withOffer(fund(createInitialGameState())), "contract-test");
    const online = advanceGame(accepted, 1_000, "foreground");
    const offline = advanceGame(
      withDepartureBuffer(accepted, "localScheduler"),
      1_000,
      "offline",
    );

    expect(online.state.contracts.completedContractIds).toContain("contract-test");
    expect(offline.state.contracts.completedContractIds).toContain("contract-test");
    expect(online.report.productiveMs).toBe(1_000);
    expect(offline.report.productiveMs).toBe(1_000);
    expect(online.report.creditsEarned).toBe("12.5");
    expect(offline.report.creditsEarned).toBe("12.5");
    expect(online.report.dataEarned).toBe("2");
    expect(offline.report.dataEarned).toBe("2");
    expect(online.intervalReport.completionEvents).toEqual([
      {
        source: "contract",
        instanceId: "contract-test",
        workId: "ledgerAudit",
        name: "Ledger Audit",
        creditsEarned: "12.5",
        dataEarned: "2",
      },
    ]);
  });

  it("pauses contracts assigned to a powered-off system in foreground and offline", () => {
    const accepted = powerOff(
      acceptContract(withOffer(fund(createInitialGameState())), "contract-test"),
    );
    const online = advanceGame(accepted, 500, "foreground");
    const offline = advanceGame(
      withDepartureBuffer(accepted, "localScheduler"),
      500,
      "offline",
    );

    expect(online.state.contracts.active[0]?.workCompletedMs).toBe(0);
    expect(offline.state.contracts.active[0]?.workCompletedMs).toBe(0);
    expect(online.report.pausedMs).toBe(500);
    expect(offline.report.pausedMs).toBe(500);
    expect(offline.report.blockers).toContain("Barebones PC is powered off.");
  });

  it("projects contract operating cost, net value, runway, buffer fit, and invalid systems", () => {
    const initial = createInitialGameState();
    const managed = withOffer(
      fund({
        ...initial,
        flags: { ...initial.flags, psuManagement: true },
        research: { ...initial.research, completed: ["psuManagement"] },
      }),
    );
    const visible = deriveVisibleState(managed).contracts[0]!;

    expect(amountCompare(visible.operatingCostCredits, 0)).toBeGreaterThan(0);
    expect(amountCompare(visible.netRewardCredits, visible.rewards.credits)).toBeLessThan(0);
    expect(visible).toMatchObject({
      creditRunwayCovered: true,
      bufferCovered: false,
      canAccept: true,
    });

    const unavailable = powerOff(managed);
    const unavailableVisible = deriveVisibleState(unavailable).contracts[0]!;
    expect(unavailableVisible.canAccept).toBe(false);
    expect(unavailableVisible.projectedPauseReason).toMatch(/powered off|is off/);
    expect(acceptContract(unavailable, "contract-test").contracts.active).toEqual([]);
  });
});

describe("explicit phased projects", () => {
  it("deducts exact phase costs, pays automatically, and requires an explicit next phase start", () => {
    const base = fund(rackReadyWithoutPowerBilling());
    const started = startProjectPhase(base, "schedulerIntegration", 1);

    expect(started.projects.progress.schedulerIntegration?.active).toBe(true);
    expect(started.exactResources.credits).toBe("999800");
    expect(started.exactResources.data).toBe("1000000");

    const completedInterval = advanceGame(started, 90_000, "foreground");
    const completedPhase = completedInterval.state;
    const progress = completedPhase.projects.progress.schedulerIntegration;
    expect(progress).toEqual(
      expect.objectContaining({ phaseIndex: 1, phaseProgressMs: 0, active: false }),
    );
    expect(completedPhase.exactResources.credits).toBe("1000100");
    expect(completedPhase.exactResources.data).toBe("1000018");
    expect(getProjectDefinition("schedulerIntegration").phases[1]?.id).toBe("policy-run");
    expect(getProjectDefinition("schedulerIntegration").phases[1]?.costs).toEqual([
      { resource: "credits", amount: "200" },
      { resource: "data", amount: "1" },
    ]);
    expect(getProjectDefinition("schedulerIntegration").phases[1]?.rewards).toEqual(
      exactResourceBag("300", "45"),
    );
    expect(completedInterval.intervalReport.completionEvents).toEqual([
      {
        source: "project",
        instanceId: "schedulerIntegration:queue-map",
        workId: "schedulerIntegration",
        phaseId: "queue-map",
        name: "Scheduler Integration · Map queue pressure",
        creditsEarned: "300",
        dataEarned: "18",
      },
    ]);
  });

  it("requires System Scheduler for offline project progress and honors system power", () => {
    const started = startProjectPhase(
      fund(createRackReadyGameState()),
      "schedulerIntegration",
      1,
    );
    expect(started.projects.progress.schedulerIntegration?.active).toBe(true);
    const insufficientAutomation = advanceGame(
      withDepartureBuffer(started, "localScheduler"),
      10_000,
      "offline",
    );
    const validAutomation = advanceGame(
      withDepartureBuffer(started, "systemScheduler"),
      10_000,
      "offline",
    );
    const poweredDown = advanceGame(
      withDepartureBuffer(powerOff(started), "systemScheduler"),
      10_000,
      "offline",
    );

    expect(
      insufficientAutomation.state.projects.progress.schedulerIntegration?.phaseWorkCompleted,
    ).toBe("0");
    expect(insufficientAutomation.report.blockers).toContain(
      "System Scheduler automation is required for projects.",
    );
    expect(
      validAutomation.state.projects.progress.schedulerIntegration?.phaseWorkCompleted,
    ).toBe("46");
    expect(
      poweredDown.state.projects.progress.schedulerIntegration?.phaseWorkCompleted,
    ).toBe("0");
    expect(poweredDown.report.blockers).toContain(
      "Fleet-Ready Workstation is powered off.",
    );
  });
});

describe("opening economy, selectors, and save state", () => {
  it("awards Data for Bit Flip discovery once while repeated work keeps Credit output", () => {
    const base = fund({
      ...createInitialGameState(),
      research: { completed: ["decodeLogic"], clickRateLevel: 0 },
    });
    const firstStarted = applyAction(base, { type: "startTask", taskId: "bitFlip" });
    const first = advanceGame(firstStarted, 10_000, "foreground").state;
    const secondStarted = applyAction(first, { type: "startTask", taskId: "bitFlip" });
    const second = advanceGame(secondStarted, 10_000, "foreground").state;

    expect(first.completedTasks.bitFlip).toBe(1);
    expect(first.exactResources.data).toBe("1000005");
    expect(second.completedTasks.bitFlip).toBe(2);
    expect(second.exactResources.data).toBe(first.exactResources.data);
    expect(Number(second.exactResources.credits)).toBeGreaterThan(
      Number(first.exactResources.credits),
    );
  });

  it("exposes the canonical Work taxonomy and uses owned buffer capacity for online planning", () => {
    const state: GameState = {
      ...createInitialGameState(),
      automationBuffer: {
        ownedLevelId: "globalScheduler",
        departureLevelId: "localScheduler",
        offlineProcessedMs: HOUR_MS,
      },
      standingOrder: {
        taskId: "fetchBit",
        systemId: 1,
        enabled: true,
        renewalCount: 0,
      },
    };
    const planning = deriveVisibleState(state);
    const departed = deriveVisibleState({
      ...state,
      time: { ...state.time, departedAtMs: 1 },
    });

    expect(planning.work).toEqual(
      expect.objectContaining({
        missions: expect.any(Array),
        projects: expect.any(Array),
        contracts: expect.any(Array),
        standingOrders: expect.any(Array),
        jobs: expect.any(Array),
        activeWork: expect.any(Array),
      }),
    );
    expect(planning.currentChapter.id).toBe("bootstrapNode");
    expect(planning.currentObjective?.id).toBe("bootstrap:first-operation");
    expect(planning.activeWork.some((item) => item.kind === "standingOrder")).toBe(true);
    expect(planning.automationBuffer.offlineProcessedMs).toBe(0);
    expect(planning.automationBuffer.remainingOfflineMs).toBe(168 * HOUR_MS);
    expect(departed.automationBuffer.offlineProcessedMs).toBe(HOUR_MS);
    expect(departed.automationBuffer.remainingOfflineMs).toBe(HOUR_MS);
  });

  it("round-trips deterministic campaign, contract, project, and RNG state in save v7", () => {
    let state = fund(createRackReadyGameState());
    state = refreshContractMarket({ ...state, rng: createRngState(2026) });
    state = acceptContract(state, state.contracts.offers[0]!.id);
    state = startProjectPhase(state, "schedulerIntegration", 1);
    state = updateCampaignProgress({
      ...state,
      completedTasks: { ...state.completedTasks, fetchBit: 1 },
    });
    expect(state.contracts.active).toHaveLength(1);
    expect(state.projects.progress.schedulerIntegration?.active).toBe(true);

    const restored = deserializeSave(serializeSave(state, 123_456));

    expect(restored.version).toBe(7);
    expect(restored.time.lastSavedAtMs).toBe(123_456);
    expect(restored.campaign).toEqual(state.campaign);
    expect(restored.contracts).toEqual(state.contracts);
    expect(restored.projects).toEqual(state.projects);
    expect(restored.rng).toEqual(state.rng);
  });

  it("drops a retired bootstrapBenchmark project record from a legacy save", () => {
    const raw = JSON.parse(serializeSave(fund(createInitialGameState()), 1)) as {
      state: { projects: unknown };
    };
    raw.state.projects = {
      progress: {
        bootstrapBenchmark: {
          projectId: "bootstrapBenchmark",
          phaseIndex: 1,
          phaseProgressMs: 500,
          active: true,
          completed: false,
          systemId: 1,
        },
      },
      completedProjectIds: ["bootstrapBenchmark"],
    };

    const restored = deserializeSave(JSON.stringify(raw));

    expect(restored.projects).toEqual({ progress: {}, completedProjectIds: [] });
  });
});
