import { describe, expect, it } from "vitest";
import { amount } from "./amount";
import {
  advancePlanetaryFinale,
  createPlanetaryFinaleRuntime,
  getFinaleCharterModifiers,
  getNextPlanetaryFinaleEventMs,
  normalizePlanetaryFinaleRuntime,
  type PlanetaryFinalePlan,
} from "./planetary";

const plan: PlanetaryFinalePlan = {
  id: "test-finale",
  phases: [
    {
      id: "two-regions",
      name: "Two regions",
      requiredRegionCount: 2,
      contributionRequired: amount(10),
    },
    {
      id: "three-regions",
      name: "Three regions",
      requiredRegionCount: 3,
      contributionRequired: amount(20),
    },
  ],
};

describe("planetary finale", () => {
  it("requires distinct routed regions and exposes an intermediate blocker", () => {
    const initial = createPlanetaryFinaleRuntime(plan);
    const blocked = advancePlanetaryFinale({
      runtime: initial,
      elapsedMs: 10_000,
      routedContributionPerSecond: amount(100),
      connectedRegionIds: ["a", "a"],
    });
    expect(blocked.contributed).toBe("0");
    expect(blocked.runtime.elapsedMs).toBe(10_000);
    expect(blocked.blockedReason).toBe("Requires 2 connected regions.");
  });

  it("crosses milestones but safely pauses when the next region gate is unmet", () => {
    const result = advancePlanetaryFinale({
      runtime: createPlanetaryFinaleRuntime(plan),
      elapsedMs: 10_000,
      routedContributionPerSecond: amount(10),
      connectedRegionIds: ["a", "b"],
    });
    expect(result.completedPhaseIds).toEqual(["two-regions"]);
    expect(result.runtime.phaseIndex).toBe(1);
    expect(result.runtime.totalContribution).toBe("10");
    expect(result.blockedReason).toBe("Requires 3 connected regions.");
  });

  it("is delta invariant and exact beyond Number range", () => {
    const hugePlan: PlanetaryFinalePlan = {
      id: "huge",
      phases: [
        {
          id: "commit",
          name: "Commit",
          requiredRegionCount: 2,
          contributionRequired: amount("2e309"),
        },
      ],
    };
    const initial = createPlanetaryFinaleRuntime(hugePlan);
    expect(
      getNextPlanetaryFinaleEventMs(initial, amount("1e309"), ["a", "b"]),
    ).toBe("2000");
    const single = advancePlanetaryFinale({
      runtime: initial,
      elapsedMs: 2_000,
      routedContributionPerSecond: amount("1e309"),
      connectedRegionIds: ["a", "b"],
    });
    const first = advancePlanetaryFinale({
      runtime: initial,
      elapsedMs: 1_000,
      routedContributionPerSecond: amount("1e309"),
      connectedRegionIds: ["a", "b"],
    });
    const second = advancePlanetaryFinale({
      runtime: first.runtime,
      elapsedMs: 1_000,
      routedContributionPerSecond: amount("1e309"),
      connectedRegionIds: ["a", "b"],
    });
    expect(second.runtime).toEqual(single.runtime);
    expect(second.runtime.totalContribution).toBe(amount("2e309"));
    expect(second.runtime.complete).toBe(true);
  });

  it("normalizes completed state so milestones cannot regress", () => {
    const corrupted = {
      ...createPlanetaryFinaleRuntime(plan),
      phaseIndex: 999,
      phaseContribution: amount("1e309"),
      completedPhaseIds: [],
      complete: true,
    };
    expect(normalizePlanetaryFinaleRuntime(corrupted)).toEqual(
      expect.objectContaining({
        phaseIndex: 2,
        phaseContribution: "0",
        completedPhaseIds: ["two-regions", "three-regions"],
        complete: true,
      }),
    );
  });

  it("makes all three postgame charters mechanically distinct and swappable", () => {
    const resilience = getFinaleCharterModifiers("resilience");
    const efficiency = getFinaleCharterModifiers("efficiency");
    const open = getFinaleCharterModifiers("openCompute");
    expect(resilience.failoverDelayBps).toBeLessThan(
      efficiency.failoverDelayBps,
    );
    expect(efficiency.operatingCostBps).toBeLessThan(
      resilience.operatingCostBps,
    );
    expect(open.openContractRewardBps).toBeGreaterThan(
      resilience.openContractRewardBps,
    );
  });
});
