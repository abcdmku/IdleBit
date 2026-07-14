import { describe, expect, it } from "vitest";
import { amount } from "../amount";
import type { BalanceAcceptanceEvidence } from "./acceptance";
import { expectedPublicRuntimeWorkloadIds } from "./workloadCoverage";
import {
  createMeasuredNsgaCalibration,
  createOpeningFleetBeamCalibration,
} from "./calibrationArtifacts";
import type { CampaignRunMetrics, EngagementProfileId } from "./types";

const run = (
  profileId: EngagementProfileId,
  elapsedCalendarDays: number,
): CampaignRunMetrics => ({
  runId: `${profileId}-measured`,
  profileId,
  seed: 31_415,
  scheduleMode: "deterministic",
  status: "completed",
  startedAtMs: 0,
  completedAtMs: elapsedCalendarDays * 86_400_000,
  elapsedCalendarMs: elapsedCalendarDays * 86_400_000,
  elapsedCalendarDays,
  sessionCount: 10,
  activeMinutes: 100,
  offlineHours: 100,
  productiveOfflineHours: 80,
  pausedOfflineHours: 20,
  overflowHours: 0,
  overflowShare: 0,
  milestones: [],
  workMix: {
    outputUnits: amount(100),
    standingOrderOutputUnits: amount(50),
    contractOutputUnits: amount(25),
    standingOrderShare: 0.5,
    contractShare: 0.25,
  },
  resourceScarcity: [],
  roi: {
    benefit: amount(100),
    cost: amount(20),
    netValue: amount(80),
    returnRatio: 4,
  },
  powerRunway: {
    minimumHours: 24,
    averageHours: 48,
    belowTargetHours: 0,
    targetHours: 24,
  },
  blocking: { blockedHours: 0, blockedShare: 0, byReasonHours: {} },
  unusedCapacity: {
    availableCapacityHours: amount(100),
    unusedCapacityHours: amount(20),
    unusedShare: 0.2,
  },
});

const evidence = {
  deterministicRuns: [],
  velocityWindows: [],
  regularOfflineOutputUnits: 0,
  regularTotalOutputUnits: 0,
  buffers: [],
  workloads: [
    {
      workloadId: "task:compileCode",
      recommended: false,
      completed: true,
      profitabilityApplicable: true,
      netMargin: 0.35,
      grossCredits: amount(100),
      netCredits: amount(35),
      progressionShare: 0.2,
    },
  ],
  expectedWorkloadIds: expectedPublicRuntimeWorkloadIds,
  coveredWorkloadIds: expectedPublicRuntimeWorkloadIds,
  contracts: [],
  standingOrderBaselines: [],
  absenceDestructiveLosses: 0,
  strandedFullIdleRuns: 0,
  productionDeveloperGrantActions: 0,
  postLocalManualActionShare: 0,
  postLocalManualProductionShare: 0,
} satisfies BalanceAcceptanceEvidence;

describe("measured calibration artifacts", () => {
  it("runs a deterministic NSGA-II sweep traceable to public campaign runs", () => {
    const runs = [run("full-idle", 294), run("regular", 147)];
    const first = createMeasuredNsgaCalibration(runs, evidence, 77);
    const replay = createMeasuredNsgaCalibration(runs, evidence, 77);

    expect(first).toEqual(replay);
    expect(first.populationRows).toHaveLength(24);
    expect(first.historyRows).toHaveLength(9);
    expect(first.paretoRows.length).toBeGreaterThan(0);
    expect(first.selectedRows).toHaveLength(1);
    expect(first.selectedRows[0]).toMatchObject({
      evaluationSource: "real-public-campaign-validation",
      sourceRunCount: 2,
      sourceRunIds: "full-idle-measured|regular-measured",
      selected: true,
      selectionKind: "current-runtime",
      realPublicRunValidationPassed: false,
    });
    expect(first.recommendedRows[0]).toMatchObject({
      evaluationSource: "measured-run-surrogate-projection",
      requiresPublicRuntimeValidation: true,
      validationStatus: "requires-application-and-public-rerun",
    });
  });

  it("searches real visible state with public dispatch/advance steps and pruning stats", () => {
    const result = createOpeningFleetBeamCalibration(91, 6);
    const stats = result.statsRows[0]!;

    expect(stats).toMatchObject({
      evaluationSource: "public-runtime-beam-search",
      seed: 91,
      maximumDepth: 6,
      beamWidth: 4,
    });
    expect(stats.expanded).toBeGreaterThan(0);
    expect(stats.generated).toBeGreaterThan(0);
    expect(stats.dominancePruned + stats.duplicatePruned).toBeGreaterThan(0);
    expect(
      Math.max(0, ...result.routeRows.map((row) => row.routeEdgeIndex)),
    ).toBeLessThanOrEqual(6);
    expect(
      result.routeRows.every(
        (row) =>
          row.kind === "dispatch" ||
          row.kind === "advance",
      ),
    ).toBe(true);
    // The public opening prefix now spans ~7 simulated days under early
    // metered billing (C-DES-6 ruling), so allow headroom under parallel load.
  }, 30_000);
});
