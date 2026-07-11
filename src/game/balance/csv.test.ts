import { amount } from "../amount";
import type { CampaignRunMetrics } from "./types";
import {
  createBalanceCsvBundle,
  serializeCsv,
  serializeRuntimeDefinitionsCsv,
} from "./csv";
import { describe, expect, it } from "vitest";

describe("balance CSV serialization", () => {
  it("sorts columns and quotes commas, quotes, and newlines", () => {
    const csv = serializeCsv([
      { z: "plain", a: "comma,value" },
      { z: 'quote"line\nnext', a: null },
    ]);
    expect(csv).toBe(
      'a,z\r\n"comma,value",plain\r\n,"quote""line\nnext"\r\n',
    );
  });

  it("flattens supplied runtime definitions without importing content", () => {
    const csv = serializeRuntimeDefinitionsCsv([
      {
        id: "buffer-2h",
        costs: { credits: 120, data: 8 },
        tags: ["opening", "offline"],
      },
    ]);
    expect(csv).toBe(
      'costs.credits,costs.data,id,tags\r\n120,8,buffer-2h,"[""opening"",""offline""]"\r\n',
    );
  });

  it("exports every measured power-runway field in campaign runs", () => {
    const metrics = {
      runId: "power-runway",
      profileId: "regular",
      seed: 1,
      scheduleMode: "deterministic",
      status: "completed",
      startedAtMs: 0,
      completedAtMs: 1,
      elapsedCalendarMs: 1,
      elapsedCalendarDays: 1 / 86_400_000,
      sessionCount: 1,
      activeMinutes: 1,
      offlineHours: 0,
      productiveOfflineHours: 0,
      pausedOfflineHours: 0,
      overflowHours: 0,
      overflowShare: 0,
      milestones: [],
      workMix: {
        outputUnits: amount(1),
        standingOrderOutputUnits: amount(1),
        contractOutputUnits: amount(0),
        standingOrderShare: 1,
        contractShare: 0,
      },
      resourceScarcity: [],
      roi: {
        benefit: amount(1),
        cost: amount(0),
        netValue: amount(1),
        returnRatio: null,
      },
      powerRunway: {
        minimumHours: 12,
        averageHours: 24,
        belowTargetHours: 3,
        targetHours: 18,
      },
      blocking: { blockedHours: 0, blockedShare: 0, byReasonHours: {} },
      unusedCapacity: {
        availableCapacityHours: amount(1),
        unusedCapacityHours: amount(0),
        unusedShare: 0,
      },
    } satisfies CampaignRunMetrics;
    const csv = createBalanceCsvBundle({
      runtimeDefinitions: [],
      results: [metrics],
    })["campaign-runs.csv"];

    expect(csv).toContain("minimumPowerRunwayHours");
    expect(csv).toContain("averagePowerRunwayHours");
    expect(csv).toContain("belowTargetPowerRunwayHours");
    expect(csv).toContain("targetPowerRunwayHours");
    expect(csv).toContain("12");
    expect(csv).toContain("24");
  });
});
