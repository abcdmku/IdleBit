import { describe, expect, it } from "vitest";
import { amount, amountAdd } from "../amount";
import type { AdvanceReport } from "../types";
import {
  createMetricAccumulator,
  finalizeCampaignMetrics,
  recordMetricInterval,
} from "./metrics";

const report: AdvanceReport = {
  mode: "offline",
  elapsedMs: 3_600_000,
  simulatedMs: 3_600_000,
  overflowMs: 0,
  productiveMs: 3_600_000,
  pausedMs: 0,
  bufferLevelId: "globalScheduler",
  bufferCapacityMs: 168 * 3_600_000,
  standingOrderRenewals: 0,
  creditsEarned: amount(0),
  creditsSpent: amount(0),
  dataEarned: amount(0),
  dataSpent: amount(0),
  destructiveEvents: { psuOverload: 0, unpaidBill: 0, deadlockWipe: 0 },
  safelyAvoidedDestructiveEvents: {
    psuOverload: 0,
    unpaidBill: 0,
    deadlockWipe: 0,
  },
  completedWork: {},
  blockers: [],
};

describe("exact campaign metrics", () => {
  it("accumulates output, ROI, balances, and capacity beyond Number range", () => {
    const accumulator = createMetricAccumulator();
    const huge = amount("1e309");
    recordMetricInterval(accumulator, "offline", 3_600_000, report, {
      outputUnits: huge,
      standingOrderOutputUnits: amount("5e308"),
      contractOutputUnits: amount("25e307"),
      resourceBalances: { credits: amountAdd(huge, 1) },
      roi: { benefit: huge, cost: amount("2e308") },
      usedCapacity: amount("5e308"),
      totalCapacity: huge,
    });
    recordMetricInterval(accumulator, "offline", 3_600_000, report, {
      outputUnits: amount(1),
      resourceBalances: { credits: huge },
      roi: { benefit: amount(1), cost: amount(0) },
      usedCapacity: huge,
      totalCapacity: huge,
    });
    const metrics = finalizeCampaignMetrics(accumulator, {
      profileId: "regular",
      seed: 1,
      scheduleMode: "deterministic",
      startedAtMs: 0,
      endedAtMs: 7_200_000,
      completed: false,
      sessionCount: 1,
    });

    expect(metrics.workMix.outputUnits).toBe(amountAdd(huge, 1));
    expect(metrics.roi.benefit).toBe(amountAdd(huge, 1));
    expect(metrics.roi.cost).toBe(amount("2e308"));
    expect(metrics.resourceScarcity[0]?.minimumBalance).toBe(huge);
    expect(metrics.unusedCapacity.availableCapacityHours).toBe(amount("2e309"));
    expect(metrics.unusedCapacity.unusedCapacityHours).toBe(amount("5e308"));
    expect(metrics.unusedCapacity.unusedShare).toBe(0.25);
  });
});
