import { describe, expect, it } from "vitest";
import { advanceGame } from "./advance";
import {
  amount,
  amountAdd,
  amountSubtract,
  exactResourceBag,
} from "./amount";
import { createFacilityState } from "./facilities";
import { createInitialGameState } from "./progression";
import { applyAction } from "./simulation";
import { syncSelectedSystemRuntime } from "./systems";
import type {
  AdvanceReport,
  AdvanceResult,
  ContractOfferState,
  GameState,
} from "./types";

const inactiveOffer = (expiresAtMs: number): ContractOfferState => ({
  id: "inactive-standing-offer",
  templateId: "ledgerAudit",
  kind: "sustained",
  name: "Inactive standing offer",
  description: "Remains optional while standing work advances.",
  systemId: 1,
  workRequiredMs: 60_000,
  expiresAtMs,
  rewards: exactResourceBag("100", "1"),
  novel: true,
});

const standingOfferState = (expiresAtMs: number): GameState => {
  const initial = createInitialGameState();
  const exactResources = exactResourceBag("1000000", "0");
  let state: GameState = {
    ...initial,
    exactResources,
    resources: { credits: 1_000_000, data: 0 },
    flags: { ...initial.flags, cron: true },
    power: { ...initial.power, bootstrapGraceSeconds: 100 },
    automationBuffer: {
      ownedLevelId: "cronRuntime",
      departureLevelId: "cronRuntime",
      offlineProcessedMs: 0,
    },
  };
  state = applyAction(state, {
    type: "setStandingOrder",
    taskId: "fetchBit",
  });
  return {
    ...state,
    contracts: {
      ...state.contracts,
      offers: [inactiveOffer(expiresAtMs)],
    },
  };
};

const thermalStandingState = (): GameState => {
  const initial = createInitialGameState();
  const exactResources = exactResourceBag("1000000000", "0");
  let state = syncSelectedSystemRuntime({
    ...initial,
    exactResources,
    resources: { credits: 1_000_000_000, data: 0 },
    completedTasks: { thermalProbe: 1 },
    completedJobs: { thermalProbe: 1 },
    flags: {
      ...initial.flags,
      cron: true,
      cStateControl: true,
    },
    hardware: { ...initial.hardware, cStateLevel: 1 },
    power: { ...initial.power, bootstrapGraceSeconds: 100_000 },
    automationBuffer: {
      ownedLevelId: "cronRuntime",
      departureLevelId: "cronRuntime",
      offlineProcessedMs: 0,
    },
  });
  state = applyAction(state, {
    type: "setStandingOrder",
    taskId: "fetchBit",
  });
  return state;
};

const advanceInChunks = (initial: GameState, chunks: readonly number[]) => {
  let state = initial;
  const reports: AdvanceReport[] = [];
  for (const elapsedMs of chunks) {
    const result = advanceGame(state, elapsedMs, "foreground");
    state = result.state;
    reports.push(result.intervalReport);
  }
  return { state, reports };
};

const sumReportAmount = (
  reports: readonly AdvanceReport[],
  key: "creditsEarned" | "creditsSpent" | "dataEarned" | "dataSpent",
) => reports.reduce((total, report) => amountAdd(total, report[key]), "0");

const expectReportReconciles = (
  before: GameState,
  result: AdvanceResult,
) => {
  expect(
    amountSubtract(
      amountAdd(before.exactResources.credits, result.intervalReport.creditsEarned),
      result.intervalReport.creditsSpent,
    ),
  ).toBe(result.state.exactResources.credits);
  expect(
    amountSubtract(
      amountAdd(before.exactResources.data, result.intervalReport.dataEarned),
      result.intervalReport.dataSpent,
    ),
  ).toBe(result.state.exactResources.data);

  const taskEvents = (result.intervalReport.completionEvents ?? []).flatMap(
    (event) =>
      (event.source === "task" || event.source === "standing-order") &&
      event.workId === "fetchBit"
        ? [event]
        : [],
  );
  expect({
    completionCount: taskEvents.reduce(
      (total, event) => total + event.completionCount,
      0,
    ),
    creditsEarned: taskEvents.reduce(
      (total, event) => amountAdd(total, event.creditsEarned),
      amount(0),
    ),
    workCycles: taskEvents.reduce(
      (total, event) => amountAdd(total, event.workCycles),
      amount(0),
    ),
  }).toMatchObject({
    completionCount: result.intervalReport.completedWork.fetchBit ?? 0,
    creditsEarned: amountSubtract(
      result.state.taskRewardCreditsEarned.fetchBit ?? "0",
      before.taskRewardCreditsEarned.fetchBit ?? "0",
    ),
    workCycles: amountSubtract(
      result.state.taskWorkCyclesCompleted.fetchBit ?? "0",
      before.taskWorkCyclesCompleted.fetchBit ?? "0",
    ),
  });
};

describe("advance interval reporting", () => {
  it("returns one-call telemetry beside the cumulative offline summary", () => {
    const hourMs = 60 * 60 * 1_000;
    const initial = createInitialGameState();
    const departed = {
      ...initial,
      automationBuffer: {
        ...initial.automationBuffer,
        ownedLevelId: "globalScheduler" as const,
        departureLevelId: "globalScheduler" as const,
      },
    };
    const first = advanceGame(departed, hourMs, "offline");
    const second = advanceGame(first.state, hourMs, "offline");

    expect(first.intervalReport.elapsedMs).toBe(hourMs);
    expect(first.report.elapsedMs).toBe(hourMs);
    expect(second.intervalReport.elapsedMs).toBe(hourMs);
    expect(second.report.elapsedMs).toBe(2 * hourMs);
    expect(second.state.lastAdvanceReport).toEqual(second.report);
  });

  it("uses the same report for one foreground interval", () => {
    const result = advanceGame(createInitialGameState(), 1_000, "foreground");
    expect(result.intervalReport).toEqual(result.report);
  });

  it("is exact one-shot/chunked when an inactive offer expires inside the horizon", () => {
    const initial = standingOfferState(2_500);
    const oneShot = advanceGame(initial, 5_000, "foreground");
    const chunked = advanceInChunks(initial, [1_000, 1_000, 1_000, 1_000, 1_000]);

    expect(oneShot.state).toEqual(chunked.state);
    expect(oneShot.state.contracts.elapsedMs).toBe(5_000);
    expect(oneShot.state.contracts.offers).toEqual([]);
    expect(oneShot.state.contracts.declinedContractIds).toEqual([]);
    expect(oneShot.intervalReport.completedWork.fetchBit).toBe(2);
    expect(
      chunked.reports.reduce(
        (total, report) => total + (report.completedWork.fetchBit ?? 0),
        0,
      ),
    ).toBe(oneShot.intervalReport.completedWork.fetchBit);
    for (const key of [
      "creditsEarned",
      "creditsSpent",
      "dataEarned",
      "dataSpent",
    ] as const) {
      expect(sumReportAmount(chunked.reports, key)).toBe(
        oneShot.intervalReport[key],
      );
    }
    expectReportReconciles(initial, oneShot);
  });

  it("retains an inactive offer until its exact standing-cycle expiry boundary", () => {
    const initial = standingOfferState(3_000);
    const beforeBoundary = advanceGame(initial, 2_999, "foreground");
    expect(beforeBoundary.state.contracts.elapsedMs).toBe(2_999);
    expect(beforeBoundary.state.contracts.offers).toHaveLength(1);

    const atBoundary = advanceGame(beforeBoundary.state, 1, "foreground");
    const oneShot = advanceGame(initial, 3_000, "foreground");
    const perCycle = advanceInChunks(initial, [1_000, 1_000, 1_000]);

    expect(atBoundary.state).toEqual(oneShot.state);
    expect(perCycle.state).toEqual(oneShot.state);
    expect(oneShot.state.contracts.elapsedMs).toBe(3_000);
    expect(oneShot.state.contracts.offers).toEqual([]);
    expect(oneShot.state.contracts.refreshCount).toBe(
      initial.contracts.refreshCount,
    );
    expect(sumReportAmount(
      [beforeBoundary.intervalReport, atBoundary.intervalReport],
      "creditsEarned",
    )).toBe(oneShot.intervalReport.creditsEarned);
    expectReportReconciles(initial, oneShot);
    expectReportReconciles(beforeBoundary.state, atBoundary);
  });

  it("bulk advances a thermally steady standing cycle exactly", () => {
    const warmed = advanceGame(
      thermalStandingState(),
      60_000,
      "foreground",
    ).state;
    const horizonMs = 6 * 60 * 60_000;

    const startedAt = performance.now();
    const oneShot = advanceGame(warmed, horizonMs, "foreground");
    const chunked = advanceInChunks(
      warmed,
      Array.from({ length: 6 }, () => 60 * 60_000),
    );

    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect(oneShot.state).toEqual(chunked.state);
    expect(oneShot.state.completedTasks.fetchBit).toBeGreaterThan(1_000);
    expect(oneShot.state.workshop.thermal).toEqual(
      chunked.state.workshop.thermal,
    );
    expectReportReconciles(warmed, oneShot);
  });

  it("does not aggregate past a passive Cloud failover boundary", () => {
    const base = standingOfferState(60_000);
    const initial: GameState = {
      ...base,
      contracts: { ...base.contracts, offers: [] },
      infrastructure: {
        ...base.infrastructure,
        facilities: [
          createFacilityState("workshopFacility", "facility-1", "Facility A"),
          createFacilityState("workshopFacility", "facility-2", "Facility B"),
        ],
      },
      cloud: {
        ...base.cloud,
        regions: [{ id: "region-test", name: "Test region" }],
        zones: [
          {
            id: "zone-a",
            name: "Zone A",
            regionId: "region-test",
            facilityId: "facility-1",
            faultDomainId: "domain-a",
            configuredStatus: "online",
            capacityPerSecond: amount(1),
            baseLatencyMs: 1,
          },
          {
            id: "zone-b",
            name: "Zone B",
            regionId: "region-test",
            facilityId: "facility-2",
            faultDomainId: "domain-b",
            configuredStatus: "online",
            capacityPerSecond: amount(1),
            baseLatencyMs: 1,
          },
        ],
        failover: {
          activeZoneId: "zone-a",
          pendingZoneId: "zone-b",
          completesAtMs: 2_500,
          lastCompletedAtMs: null,
        },
      },
    };

    const oneShot = advanceGame(initial, 5_000, "foreground");
    const perCycle = advanceInChunks(initial, [1_000, 1_000, 1_000, 1_000, 1_000]);

    expect(oneShot.state).toEqual(perCycle.state);
    expect(oneShot.state.cloud.failover).toEqual({
      activeZoneId: "zone-b",
      pendingZoneId: null,
      completesAtMs: null,
      lastCompletedAtMs: 2_500,
    });
    expect(oneShot.state.cloud.elapsedMs).toBe(5_000);
  });
});
