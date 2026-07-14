import { describe, expect, it } from "vitest";

import { advanceGame } from "./advance";
import {
  amount,
  amountAdd,
  amountDivide,
  amountMultiply,
  amountSubtract,
  exactResourceBag,
} from "./amount";
import { getPowerCostPerSecondExact } from "./math";
import { acceptContract } from "./contracts";
import {
  createInitialGameState,
  createRamStickState,
  createSystemState,
  syncHardwarePackages,
} from "./progression";
import { getProjectRemainingMs, startProjectPhase } from "./projects";
import { deriveVisibleState } from "./selectors";
import { applyAction } from "./simulation";
import {
  materializeSystem,
  replaceSystems,
  syncSelectedSystemRuntime,
} from "./systems";
import type {
  AdvanceReport,
  AdvanceMode,
  AutomationBufferLevelId,
  ContractOfferState,
  GameState,
} from "./types";

const getFetchDurationMs = (state: GameState, systemId = state.selectedSystemId) =>
  deriveVisibleState(materializeSystem(state, systemId)).tasks.find(
    (task) => task.id === "fetchBit",
  )!.projection.durationMs;

const getFetchRewardCredits = (
  state: GameState,
  systemId = state.selectedSystemId,
) =>
  deriveVisibleState(materializeSystem(state, systemId)).tasks.find(
    (task) => task.id === "fetchBit",
  )!.projection.rewardCredits!;

/**
 * Metered power billed over `elapsedMs`. The starter fixture's hardware draw
 * is load-independent (no C-State research), so rate x elapsed is exact in
 * both foreground and offline modes.
 */
const getPowerBilledCredits = (state: GameState, elapsedMs: number) =>
  amountMultiply(
    getPowerCostPerSecondExact(state),
    amountDivide(amount(elapsedMs), amount(1000)),
  );

const funded = (state: GameState): GameState => ({
  ...state,
  exactResources: exactResourceBag("1000", "1000"),
  resources: { credits: 1000, data: 1000 },
  power: { ...state.power, bootstrapGraceSeconds: 100 },
});

const withAutomation = (
  state: GameState,
  levelId: AutomationBufferLevelId,
): GameState => ({
  ...state,
  flags: { ...state.flags, cron: true },
  automationBuffer: {
    ownedLevelId: levelId,
    departureLevelId: levelId,
    offlineProcessedMs: 0,
  },
});

/**
 * Makes `systemId` able to run the schedulerIntegration project: adds a RAM
 * stick (the phase has a RAM stage), the System Scheduler research gate, and
 * the Coherent Machine chapter. Existing runtime state (active tasks,
 * standing orders, contracts) is preserved.
 */
const withProjectReadiness = (
  state: GameState,
  systemId: number,
): GameState => {
  const synchronized = syncHardwarePackages({
    ...state,
    hardware: {
      ...state.hardware,
      ramSticks: [createRamStickState(1, 1, 1)],
    },
  });
  return {
    ...replaceSystems(
      state,
      state.systems.map((system) =>
        system.id === systemId
          ? { ...system, hardware: synchronized.hardware }
          : system,
      ),
    ),
    campaign: { ...state.campaign, currentChapterId: "coherentMachine" },
    research: {
      ...state.research,
      completed: [...state.research.completed, "systemScheduler"],
    },
  };
};

const reservationOffer = (
  overrides: Partial<ContractOfferState> = {},
): ContractOfferState => ({
  id: "reservation-contract",
  templateId: "ledgerAudit",
  kind: "sustained",
  name: "Reservation Contract",
  description: "Exercises exclusive system capacity.",
  systemId: 1,
  workRequiredMs: 1_000,
  expiresAtMs: 60_000,
  rewards: exactResourceBag("12.5", "2"),
  novel: true,
  ...overrides,
});

const acceptReservationContract = (
  state: GameState,
  contract = reservationOffer(),
) =>
  acceptContract(
    {
      ...state,
      contracts: { ...state.contracts, offers: [contract] },
    },
    contract.id,
  );

const standingContractState = (
  contract: ContractOfferState = reservationOffer(),
) => {
  let state = withAutomation(funded(createInitialGameState()), "cronRuntime");
  state = applyAction(state, {
    type: "setStandingOrder",
    taskId: "fetchBit",
  });
  state = applyAction(state, { type: "startTask", taskId: "fetchBit" });
  return acceptReservationContract(state, contract);
};

const offSystemStandingContractState = (
  contractWorkRequiredMs: number,
  offerExpiresAtMs: number | null = null,
) => {
  let state = withAutomation(funded(createInitialGameState()), "cronRuntime");
  state = replaceSystems(
    state,
    [
      state.systems[0]!,
      createSystemState(2, "Contract Node", "contract-test", state.hardware),
    ],
    1,
  );
  state = applyAction(state, {
    type: "setStandingOrder",
    taskId: "fetchBit",
    systemId: 1,
  });
  state = acceptReservationContract(
    state,
    reservationOffer({
      id: "off-system-contract",
      systemId: 2,
      workRequiredMs: contractWorkRequiredMs,
    }),
  );
  return offerExpiresAtMs === null
    ? state
    : {
        ...state,
        contracts: {
          ...state.contracts,
          offers: [
            reservationOffer({
              id: "boundary-offer",
              templateId: "queueRecovery",
              kind: "burst",
              name: "Boundary Offer",
              systemId: 1,
              expiresAtMs: offerExpiresAtMs,
            }),
          ],
        },
      };
};

const withPlacedIdleFacility = (input: GameState) => {
  const rich = exactResourceBag("1000000000000", "1000000000000");
  let state: GameState = {
    ...input,
    exactResources: rich,
    resources: { credits: 1_000_000_000_000, data: 1_000_000_000_000 },
    campaign: {
      ...input.campaign,
      currentChapterId: "rackAndFacility",
      currentObjectiveId: "facility:rack-controller",
    },
    automationBuffer: {
      ...input.automationBuffer,
      ownedLevelId: "rackController",
      departureLevelId: "rackController",
    },
    flags: { ...input.flags, systemCatalog: true },
    research: {
      ...input.research,
      completed: Array.from(
        new Set([...input.research.completed, "systemCatalog" as const]),
      ),
    },
  };
  state = applyAction(state, {
    type: "purchaseAggregateServerBatch",
    skuId: "workshopServer",
    count: 1,
  });
  const node = state.infrastructure.fleetNodes.find(
    (candidate) => candidate.source.kind === "aggregate",
  )!;
  state = applyAction(state, {
    type: "commissionFacility",
    templateId: "workshopFacility",
    name: "Idle Runtime Facility",
  });
  const facilityId = state.infrastructure.facilities[0]!.id;
  state = applyAction(state, {
    type: "commissionFacilityRack",
    facilityId,
    templateId: "halfRack",
    name: "Idle Runtime Rack",
  });
  const rackId = state.infrastructure.facilities[0]!.racks[0]!.id;
  state = applyAction(state, {
    type: "placeFleetNodeInRack",
    facilityId,
    rackId,
    nodeId: node.id,
  });
  return state;
};

const advanceSlices = (
  state: GameState,
  mode: AdvanceMode,
  slices: readonly number[],
) => slices.reduce((current, elapsedMs) => advanceGame(current, elapsedMs, mode).state, state);

const reportAmount = (
  reports: readonly AdvanceReport[],
  key: "creditsEarned" | "creditsSpent" | "dataEarned" | "dataSpent",
) => reports.reduce((total, report) => amountAdd(total, report[key]), "0");

const completedCount = (
  reports: readonly AdvanceReport[],
  taskId: keyof AdvanceReport["completedWork"],
) => reports.reduce(
  (total, report) => total + (report.completedWork[taskId] ?? 0),
  0,
);

const expectSplitReportMatches = (
  expected: AdvanceReport,
  reports: readonly AdvanceReport[],
) => {
  expect(reports.reduce((total, report) => total + report.elapsedMs, 0)).toBe(
    expected.elapsedMs,
  );
  expect(reports.reduce((total, report) => total + report.simulatedMs, 0)).toBe(
    expected.simulatedMs,
  );
  expect(reports.reduce((total, report) => total + report.productiveMs, 0)).toBe(
    expected.productiveMs,
  );
  expect(reports.reduce((total, report) => total + report.pausedMs, 0)).toBe(
    expected.pausedMs,
  );
  expect(
    reports.reduce((total, report) => total + report.standingOrderRenewals, 0),
  ).toBe(expected.standingOrderRenewals);
  expect(completedCount(reports, "fetchBit")).toBe(
    expected.completedWork.fetchBit,
  );
  for (const key of [
    "creditsEarned",
    "creditsSpent",
    "dataEarned",
    "dataSpent",
  ] as const) {
    expect(reportAmount(reports, key)).toBe(expected[key]);
  }
  expect(
    reports
      .flatMap((report) => report.completionEvents ?? [])
      .filter((event) => event.source === "contract")
      .map((event) => event.instanceId),
  ).toEqual(
    (expected.completionEvents ?? [])
      .filter((event) => event.source === "contract")
      .map((event) => event.instanceId),
  );
  const summarizeTaskEvents = (events: AdvanceReport["completionEvents"]) =>
    (events ?? []).reduce(
      (summary, event) =>
        (event.source !== "task" && event.source !== "standing-order") ||
        event.workId !== "fetchBit"
          ? summary
          : {
              completionCount:
                summary.completionCount + event.completionCount,
              creditsEarned: amountAdd(
                summary.creditsEarned,
                event.creditsEarned,
              ),
              dataEarned: amountAdd(summary.dataEarned, event.dataEarned),
              workCycles: amountAdd(summary.workCycles, event.workCycles),
            },
      {
        completionCount: 0,
        creditsEarned: "0",
        dataEarned: "0",
        workCycles: "0",
      },
    );
  expect(
    summarizeTaskEvents(
      reports.flatMap((report) => report.completionEvents ?? []),
    ),
  ).toEqual(summarizeTaskEvents(expected.completionEvents));
};

const withoutLastAdvanceReport = (state: GameState) => {
  const { lastAdvanceReport: _lastAdvanceReport, ...serializableState } = state;
  return serializableState;
};

describe("per-system managed-work reservations", () => {
  it("makes progress when a managed contract event is positive but sub-quantum", () => {
    const accepted = acceptReservationContract(
      withAutomation(funded(createInitialGameState()), "cronRuntime"),
      reservationOffer({ workRequiredMs: 1_000 }),
    );
    const initial: GameState = {
      ...accepted,
      contracts: {
        ...accepted.contracts,
        active: accepted.contracts.active.map((contract) => ({
          ...contract,
          workCompletedMs: contract.workRequiredMs - 0.0000000005,
          workCompletedBits: amount("0.9999999995"),
          workCompletedUnits: amount("0.9999999995"),
          workStageIndex: 1,
          workStageCompleted: amount("0.2999999995"),
        })),
      },
    };

    const startedAt = performance.now();
    const oneShot = advanceGame(initial, 10, "foreground");
    const split = advanceSlices(initial, "foreground", [1, 9]);

    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(oneShot.state.contracts.active).toEqual([]);
    expect(oneShot.state.contracts.completedContractIds).toContain(
      "reservation-contract",
    );
    expect(split).toEqual(oneShot.state);
    expect(oneShot.intervalReport.completionEvents).toContainEqual(
      expect.objectContaining({
        source: "contract",
        instanceId: "reservation-contract",
      }),
    );
  });

  it.each(["foreground", "offline"] as const)(
    "serializes the current standing batch, contract, and renewed standing work in %s",
    (mode) => {
      const initial = standingContractState();
      const fetchDurationMs = getFetchDurationMs(initial);
      const fetchRewardCredits = getFetchRewardCredits(initial);

      const currentHalf = advanceGame(initial, fetchDurationMs / 2, mode);
      expect(currentHalf.state.contracts.active[0]?.workCompletedMs).toBe(0);
      expect(currentHalf.state.completedTasks.fetchBit).toBeUndefined();
      expect(currentHalf.intervalReport.creditsEarned).toBe("0");

      const currentComplete = advanceGame(
        currentHalf.state,
        fetchDurationMs / 2,
        mode,
      );
      expect(currentComplete.state.completedTasks.fetchBit).toBe(1);
      expect(currentComplete.state.contracts.active[0]?.workCompletedMs).toBe(0);
      expect(currentComplete.intervalReport.standingOrderRenewals).toBe(0);
      expect(currentComplete.intervalReport.creditsEarned).toBe(
        fetchRewardCredits,
      );

      const contractHalf = advanceGame(currentComplete.state, 500, mode);
      expect(contractHalf.state.contracts.active[0]?.workCompletedMs).toBe(500);
      expect(contractHalf.state.activeTasks).toEqual([]);
      expect(contractHalf.intervalReport.creditsEarned).toBe("0");

      const contractComplete = advanceGame(contractHalf.state, 500, mode);
      expect(contractComplete.state.contracts.active).toEqual([]);
      expect(contractComplete.state.completedTasks.fetchBit).toBe(1);
      expect(contractComplete.intervalReport.standingOrderRenewals).toBe(0);
      expect(contractComplete.intervalReport.creditsEarned).toBe("12.5");

      const standingResumed = advanceGame(
        contractComplete.state,
        fetchDurationMs,
        mode,
      );
      expect(standingResumed.state.completedTasks.fetchBit).toBe(2);
      expect(standingResumed.intervalReport.standingOrderRenewals).toBe(1);
      expect(standingResumed.intervalReport.creditsEarned).toBe(
        fetchRewardCredits,
      );
      expect(standingResumed.state.exactResources).toEqual(
        exactResourceBag(
          amountSubtract(
            amountAdd("1012.5", amountMultiply(fetchRewardCredits, 2)),
            getPowerBilledCredits(initial, fetchDurationMs * 2 + 1_000),
          ),
          "1002",
        ),
      );
    },
  );

  it.each(["foreground", "offline"] as const)(
    "bulk advances an off-system contract and standing lane exactly in %s",
    (mode) => {
      const initial = offSystemStandingContractState(3_000, 2_500);
      const horizonMs = 5_000;
      const expectedStandingCompletions = Math.floor(
        horizonMs / getFetchDurationMs(initial, 1),
      );
      const oneShot = advanceGame(initial, horizonMs, mode);
      let splitState = initial;
      const splitReports: AdvanceReport[] = [];
      for (const elapsedMs of [750, 750, 1_000, 500, 2_000]) {
        const interval = advanceGame(splitState, elapsedMs, mode);
        splitState = interval.state;
        splitReports.push(interval.intervalReport);
      }

      expect(withoutLastAdvanceReport(splitState)).toEqual(
        withoutLastAdvanceReport(oneShot.state),
      );
      if (mode === "foreground") {
        expect(splitState).toEqual(oneShot.state);
      } else {
        expect(splitState.lastAdvanceReport).not.toBeNull();
        const {
          completionEvents: _splitCompletionEvents,
          ...splitCumulativeReport
        } = splitState.lastAdvanceReport!;
        const {
          completionEvents: _oneShotCompletionEvents,
          ...oneShotCumulativeReport
        } = oneShot.report;
        expect(splitCumulativeReport).toEqual(oneShotCumulativeReport);
        expectSplitReportMatches(oneShot.report, [splitState.lastAdvanceReport!]);
      }
      expect(oneShot.state.contracts.active).toEqual([]);
      expect(oneShot.state.contracts.completedContractIds).toContain(
        "off-system-contract",
      );
      expect(oneShot.state.contracts.offers).toEqual([]);
      expect(oneShot.intervalReport.completedWork.fetchBit).toBe(
        expectedStandingCompletions,
      );
      expect(oneShot.state.standingTaskCompletions.fetchBit).toBe(
        expectedStandingCompletions,
      );
      expect(
        (oneShot.intervalReport.completionEvents ?? [])
          .filter(
            (event) =>
              (event.source === "task" ||
                event.source === "standing-order") &&
              event.workId === "fetchBit",
          )
          .map((event) => event.source),
      ).toEqual(["standing-order"]);
      expect(
        splitReports
          .flatMap((report) => report.completionEvents ?? [])
          .reduce(
            (total, event) =>
              event.source === "standing-order" &&
              event.workId === "fetchBit"
                ? total + event.completionCount
                : total,
            0,
          ),
      ).toBe(expectedStandingCompletions);
      expectSplitReportMatches(oneShot.intervalReport, splitReports);
    },
  );

  it.each(["foreground", "offline"] as const)(
    "keeps placed idle facilities exact across standing/contract splits in %s",
    (mode) => {
      const initial = withPlacedIdleFacility(standingContractState());
      const oneShot = advanceGame(initial, 5_000, mode);
      let splitState = initial;
      const splitReports: AdvanceReport[] = [];
      for (const elapsedMs of [500, 500, 750, 1_250, 2_000]) {
        const interval = advanceGame(splitState, elapsedMs, mode);
        splitState = interval.state;
        splitReports.push(interval.intervalReport);
      }

      expect(initial.infrastructure.facilities[0]?.racks[0]?.placements).toHaveLength(1);
      expect(withoutLastAdvanceReport(splitState)).toEqual(
        withoutLastAdvanceReport(oneShot.state),
      );
      if (mode === "foreground") expect(splitState).toEqual(oneShot.state);
      expectSplitReportMatches(oneShot.intervalReport, splitReports);
    },
  );

  it("falls back at exact offer-expiry and contract-completion boundaries", () => {
    const initial = offSystemStandingContractState(3_000, 2_500);
    const beforeOfferExpiry = advanceGame(initial, 2_499, "foreground");
    expect(beforeOfferExpiry.state.contracts.offers).toHaveLength(1);
    expect(beforeOfferExpiry.state.contracts.active[0]?.workCompletedMs).toBe(
      2_499,
    );

    const atOfferExpiry = advanceGame(
      beforeOfferExpiry.state,
      1,
      "foreground",
    );
    expect(atOfferExpiry.state.contracts.offers).toEqual([]);
    expect(atOfferExpiry.state.contracts.active[0]?.workCompletedMs).toBe(2_500);

    const beforeContractCompletion = advanceGame(
      atOfferExpiry.state,
      499,
      "foreground",
    );
    expect(
      beforeContractCompletion.state.contracts.active[0]?.workCompletedMs,
    ).toBe(2_999);

    const atContractCompletion = advanceGame(
      beforeContractCompletion.state,
      1,
      "foreground",
    );
    const oneShot = advanceGame(initial, 3_000, "foreground");
    expect(atContractCompletion.state).toEqual(oneShot.state);
    expect(atContractCompletion.state.contracts.active).toEqual([]);
    expect(atContractCompletion.intervalReport.completionEvents).toContainEqual(
      expect.objectContaining({
        source: "contract",
        instanceId: "off-system-contract",
      }),
    );
  });

  it("bulk processes thousands of off-system standing renewals", () => {
    const horizonMs = 4 * 60 * 60_000;
    const initial = offSystemStandingContractState(horizonMs + 1_000);

    const startedAt = performance.now();
    const advanced = advanceGame(initial, horizonMs, "foreground");
    const wallMs = performance.now() - startedAt;

    expect(advanced.intervalReport.standingOrderRenewals).toBe(
      Math.floor(horizonMs / getFetchDurationMs(initial)),
    );
    expect(advanced.state.contracts.active[0]?.workCompletedMs).toBe(horizonMs);
    expect(advanced.state.contracts.completedContractIds).toEqual([]);
    expect(wallMs).toBeLessThan(1_000);
  });

  it("keeps foreign finite jobs and projects on the event simulator", () => {
    const contracted = offSystemStandingContractState(10_000);
    let initial: GameState = {
      ...contracted,
      contracts: { ...contracted.contracts, active: [] },
    };
    initial = withProjectReadiness(initial, 2);
    initial = startProjectPhase(initial, "schedulerIntegration", 2);
    initial = applyAction(initial, {
      type: "startTask",
      taskId: "fetchBit",
      systemId: 2,
    });

    const horizonMs = 5_000;
    const fetchDurationMs = getFetchDurationMs(initial, 2);
    const oneShot = advanceGame(initial, horizonMs, "foreground");
    const split = advanceSlices(
      initial,
      "foreground",
      [500, 500, 1_000, 1_000, 2_000],
    );

    expect(split).toEqual(oneShot.state);
    expect(oneShot.state.completedTasks.fetchBit).toBe(
      Math.floor(horizonMs / getFetchDurationMs(initial, 1)) + 1,
    );
    // The first schedulerIntegration stage is cache work at an exact 1 Hz
    // cache rate on this fixture, so phase progress mirrors elapsed time.
    expect(
      oneShot.state.projects.progress.schedulerIntegration?.phaseProgressMs,
    ).toBe(horizonMs - fetchDurationMs);
  });

  it("does not poll a blocked short managed-work event while local work owns the lane", () => {
    const state = standingContractState(
      reservationOffer({ workRequiredMs: 1 }),
    );
    const startedAt = performance.now();
    const localComplete = advanceGame(
      state,
      getFetchDurationMs(state),
      "foreground",
    );

    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(localComplete.state.completedTasks.fetchBit).toBe(1);
    expect(localComplete.state.contracts.active[0]?.workCompletedMs).toBe(0);

    const contractComplete = advanceGame(
      localComplete.state,
      1,
      "foreground",
    );
    expect(contractComplete.state.contracts.active).toEqual([]);
  });

  it.each(["foreground", "offline"] as const)(
    "is exact one-shot/split invariant without additive managed-work payout in %s",
    (mode) => {
      const initial = standingContractState();
      expect(initial.activeTasks[0]?.workOrigin).toBeUndefined();
      const fetchDurationMs = getFetchDurationMs(initial);
      const fetchRewardCredits = getFetchRewardCredits(initial);
      const horizonMs = fetchDurationMs * 2 + 1_000;
      const oneShot = advanceGame(initial, horizonMs, mode);
      const split = advanceSlices(initial, mode, [
        fetchDurationMs / 2,
        fetchDurationMs / 2,
        250,
        750,
        fetchDurationMs,
      ]);

      expect(oneShot.intervalReport.creditsEarned).toBe(
        amountAdd("12.5", amountMultiply(fetchRewardCredits, 2)),
      );
      expect(oneShot.intervalReport.dataEarned).toBe("2");
      expect(oneShot.intervalReport.standingOrderRenewals).toBe(1);
      expect(oneShot.intervalReport.completionEvents).toHaveLength(3);
      expect(oneShot.intervalReport.completionEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: "task", completionCount: 1 }),
          expect.objectContaining({
            source: "standing-order",
            completionCount: 1,
          }),
          expect.objectContaining({ source: "contract" }),
        ]),
      );
      expect(oneShot.state.completedTasks.fetchBit).toBe(2);
      expect(oneShot.state.standingTaskCompletions.fetchBit).toBe(1);
      expect(oneShot.state.contracts.active).toEqual([]);
      expect(oneShot.state.exactResources).toEqual(
        exactResourceBag(
          amountSubtract(
            amountAdd("1012.5", amountMultiply(fetchRewardCredits, 2)),
            getPowerBilledCredits(initial, horizonMs),
          ),
          "1002",
        ),
      );

      expect(split.exactResources).toEqual(oneShot.state.exactResources);
      expect(split.completedTasks).toEqual(oneShot.state.completedTasks);
      expect(split.completedJobs).toEqual(oneShot.state.completedJobs);
      expect(split.contracts).toEqual(oneShot.state.contracts);
      expect(split.projects).toEqual(oneShot.state.projects);
      expect(split.standingOrder).toEqual(oneShot.state.standingOrder);
      expect(split.activeTasks).toEqual(oneShot.state.activeTasks);
      expect(split.systems).toEqual(oneShot.state.systems);
    },
  );

  it("gives an in-flight local task priority, then the contract, then the project", () => {
    let state = withProjectReadiness(standingContractState(), 1);
    state = startProjectPhase(state, "schedulerIntegration", 1);
    const fetchDurationMs = getFetchDurationMs(state);
    // Derive the phase duration from the fixture's own hardware rates rather
    // than hardcoding schedulerIntegration's 300-unit stage volumes.
    const projectRemainingMs = getProjectRemainingMs(
      state,
      state.projects.progress.schedulerIntegration!,
    );
    expect(Number.isFinite(projectRemainingMs)).toBe(true);

    const localComplete = advanceGame(state, fetchDurationMs, "foreground");
    expect(localComplete.state.completedTasks.fetchBit).toBe(1);
    expect(localComplete.state.contracts.active[0]?.workCompletedMs).toBe(0);
    expect(
      localComplete.state.projects.progress.schedulerIntegration?.phaseProgressMs,
    ).toBe(0);

    const contractComplete = advanceGame(
      localComplete.state,
      1_000,
      "foreground",
    );
    expect(contractComplete.state.contracts.active).toEqual([]);
    expect(
      contractComplete.state.projects.progress.schedulerIntegration?.phaseProgressMs,
    ).toBe(0);
    expect(contractComplete.intervalReport.standingOrderRenewals).toBe(0);

    const projectComplete = advanceGame(
      contractComplete.state,
      projectRemainingMs,
      "foreground",
    );
    expect(projectComplete.state.projects.progress.schedulerIntegration).toEqual(
      expect.objectContaining({
        phaseIndex: 1,
        phaseProgressMs: 0,
        active: false,
      }),
    );
    expect(projectComplete.state.completedTasks.fetchBit).toBe(1);
    expect(projectComplete.intervalReport.standingOrderRenewals).toBe(0);

    const standingResumed = advanceGame(
      projectComplete.state,
      fetchDurationMs,
      "foreground",
    );
    expect(standingResumed.state.completedTasks.fetchBit).toBe(2);
    expect(standingResumed.intervalReport.standingOrderRenewals).toBe(1);
  });

  it("keeps contract progress behind same-system Workshop storage work", () => {
    const initial = createInitialGameState();
    let state = funded({
      ...initial,
      flags: {
        ...initial.flags,
        systemCatalog: true,
        psuManagement: true,
      },
      research: {
        ...initial.research,
        completed: ["systemCatalog", "psuManagement"],
      },
      hardware: { ...initial.hardware, psuWatts: 1_000 },
    });
    state = {
      ...state,
      exactResources: exactResourceBag("1000000000", "1000"),
      resources: { credits: 1_000_000_000, data: 1000 },
    };
    state = syncSelectedSystemRuntime(state);
    state = applyAction(state, {
      type: "installWorkshopStorage",
      skuId: "localSsd",
    });
    state = applyAction(state, {
      type: "startWorkshopStorageWorkload",
      workloadId: "artifactStaging",
    });
    state = acceptReservationContract(state);

    const storageHalf = advanceGame(state, 3_000, "foreground");
    expect(storageHalf.state.workshop.activeStorageWorkload).not.toBeNull();
    expect(storageHalf.state.contracts.active[0]?.workCompletedMs).toBe(0);

    const storageComplete = advanceGame(
      storageHalf.state,
      3_000,
      "foreground",
    );
    expect(storageComplete.state.workshop.activeStorageWorkload).toBeNull();
    expect(storageComplete.state.contracts.active[0]?.workCompletedMs).toBe(0);

    const contractComplete = advanceGame(
      storageComplete.state,
      1_000,
      "foreground",
    );
    expect(contractComplete.state.contracts.active).toEqual([]);
    expect(contractComplete.intervalReport.creditsEarned).toBe("12.5");
  });
});
