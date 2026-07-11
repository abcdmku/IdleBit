import { describe, expect, it } from "vitest";
import { amount, amountAdd, exactResourceBag } from "./amount";
import {
  advanceCloud,
  cloudSlaDefinitions,
  commissionCloudRegion,
  commissionCloudZone,
  createCloudState,
  getNextCloudEventMs,
  getProductiveCloudFacilityIds,
  getCloudRoutingSnapshot,
  getCloudSlaDefinition,
  getCloudSlaBlockedReason,
  normalizeCloudState,
  placeCloudReplica,
  requestCloudFailover,
  scheduleCloudIncident,
  selectCloudFinaleCharter,
  setCloudRegionalDemand,
  setCloudRoutingLinks,
  setCloudZoneStatus,
  startCloudSla,
  startPlanetaryFinale,
  type CloudState,
} from "./cloud";
import { createRngState } from "./rng";
import {
  createWorkValueMultiplier,
  getWorkValueCredits,
} from "./workValue";

const createRegionalService = (
  routedWorkPerSecond = amount("1000000000"),
) => {
  let state = createCloudState();
  state = commissionCloudRegion(state, "Prairie");
  state = commissionCloudRegion(state, "Lakes");
  state = commissionCloudZone(state, {
    regionId: "region-1",
    facilityId: "facility-a",
    name: "Prairie A",
    capacityPerSecond: routedWorkPerSecond,
    faultDomainId: "prairie-grid-a",
  });
  state = commissionCloudZone(state, {
    regionId: "region-1",
    facilityId: "facility-b",
    name: "Prairie B",
    capacityPerSecond: routedWorkPerSecond,
    faultDomainId: "prairie-grid-b",
  });
  state = placeCloudReplica(state, "zone-3");
  state = placeCloudReplica(state, "zone-4");
  state = setCloudRegionalDemand(state, "region-1", routedWorkPerSecond);
  return state;
};

describe("cloud campaign foundation", () => {
  it("derives every SLA base Credit from exact routed work and a named multiplier", () => {
    for (const definition of cloudSlaDefinitions) {
      expect(definition.workValueMultiplier.id.length).toBeGreaterThan(0);
      expect(definition.rewards.credits).toBe(
        getWorkValueCredits(
          definition.workRequired,
          definition.workValueMultiplier,
        ),
      );
    }
  });

  it("integrates SLA availability and pays a successful window exactly once", () => {
    const started = startCloudSla(
      createRegionalService(),
      "regionalContinuity",
    );
    expect(started.activeSla?.definitionId).toBe("regionalContinuity");

    const oneShot = advanceCloud(started, 4 * 60 * 60_000);
    expect(oneShot.state.activeSla).toBeNull();
    expect(oneShot.state.completedSlas).toHaveLength(1);
    expect(oneShot.state.completedSlas[0]?.succeeded).toBe(true);
    expect(oneShot.rewards).toEqual(
      getCloudSlaDefinition("regionalContinuity").rewards,
    );
    expect(oneShot.rewardEvents).toHaveLength(1);

    const after = advanceCloud(oneShot.state, 60 * 60_000);
    expect(after.rewards).toEqual(exactResourceBag());
    expect(after.rewardEvents).toHaveLength(0);
  });

  it("exposes exact runtime boundaries and bills only routed facilities", () => {
    const started = startCloudSla(
      createRegionalService(),
      "regionalContinuity",
    );

    expect(getNextCloudEventMs(started, 4 * 60 * 60_000)).toBe(1_000_000);
    expect(getProductiveCloudFacilityIds(started)).toEqual(["facility-a"]);
  });

  it("finishes authored work from routed throughput but waits for the observation boundary to evaluate", () => {
    const fast = startCloudSla(
      createRegionalService(amount("1000000000")),
      "regionalContinuity",
    );
    const slow = startCloudSla(
      createRegionalService(amount("100000000")),
      "regionalContinuity",
    );
    const workCompletionMs = 1_000_000;

    expect(getNextCloudEventMs(fast, 12_000_000)).toBe(workCompletionMs);
    expect(getNextCloudEventMs(slow, 12_000_000)).toBe(10_000_000);

    const fastAtWorkCompletion = advanceCloud(fast, workCompletionMs);
    const slowAtSameTime = advanceCloud(slow, workCompletionMs);
    expect(fastAtWorkCompletion.state.activeSla?.workCompleted).toBe(
      "1000000000000",
    );
    expect(slowAtSameTime.state.activeSla?.workCompleted).toBe("100000000000");
    expect(fastAtWorkCompletion.state.activeSla).not.toBeNull();
    expect(fastAtWorkCompletion.state.completedSlas).toEqual([]);
    expect(fastAtWorkCompletion.rewards).toEqual(exactResourceBag());

    const definition = getCloudSlaDefinition("regionalContinuity");
    const evaluated = advanceCloud(
      fastAtWorkCompletion.state,
      definition.observationWindowMs - workCompletionMs,
    );
    expect(evaluated.state.activeSla).toBeNull();
    expect(evaluated.state.completedSlas[0]?.succeeded).toBe(true);
    expect(evaluated.rewards).toEqual(definition.rewards);

    const slowEvaluated = advanceCloud(slow, definition.observationWindowMs);
    expect(slowEvaluated.state.completedSlas[0]?.succeeded).toBe(true);
    expect(slowEvaluated.rewards).toEqual(evaluated.rewards);
  });

  it("freezes named settlement terms when an SLA starts", () => {
    const started = startCloudSla(
      createRegionalService(),
      "regionalContinuity",
    );
    const workValueMultiplier = createWorkValueMultiplier(
      "frozen-cloud-service-test",
      20_000,
    );
    const charterRewardMultiplier = createWorkValueMultiplier(
      "frozen-cloud-charter-test",
      10_000,
    );
    const frozen: CloudState = {
      ...started,
      activeSla: {
        ...started.activeSla!,
        paidWorkUnits: amount(100),
        workValueMultiplier,
        charterRewardMultiplier,
      },
    };

    const completed = advanceCloud(
      frozen,
      getCloudSlaDefinition("regionalContinuity").observationWindowMs,
    );
    expect(completed.rewards.credits).toBe("200");
    expect(completed.state.completedSlas[0]).toMatchObject({
      paidWorkUnits: "100",
      workValueMultiplier,
      charterRewardMultiplier,
    });
  });

  it("is delta invariant across SLA commit and completion boundaries", () => {
    const started = startCloudSla(
      createRegionalService(),
      "regionalContinuity",
    );
    const oneShot = advanceCloud(started, 4 * 60 * 60_000);
    let chunked: CloudState = started;
    let rewards = exactResourceBag();
    for (let index = 0; index < 4; index += 1) {
      const interval = advanceCloud(chunked, 60 * 60_000);
      chunked = interval.state;
      rewards = {
        credits: amountAdd(rewards.credits, interval.rewards.credits),
        data: amountAdd(rewards.data, interval.rewards.data),
      };
    }

    expect(chunked).toEqual(oneShot.state);
    expect(rewards).toEqual(oneShot.rewards);
  });

  it("requires replica placement across distinct fault domains", () => {
    const invalid = {
      ...createRegionalService(),
      zones: createRegionalService().zones.map((zone) => ({
        ...zone,
        faultDomainId: "one-grid",
      })),
    };

    expect(
      getCloudSlaBlockedReason(invalid, "regionalContinuity"),
    ).toBe("Requires 2 distinct fault domains.");
    expect(startCloudSla(invalid, "regionalContinuity").activeSla).toBeNull();
  });

  it("requires Planetary Coverage to carry positive explicit route flow", () => {
    let state = createRegionalService();
    state = commissionCloudZone(state, {
      regionId: "region-2",
      facilityId: "facility-c",
      name: "Lakes A",
      capacityPerSecond: amount("1000000000"),
      faultDomainId: "lakes-grid-a",
    });
    state = placeCloudReplica(state, "zone-7");

    expect(
      getCloudSlaBlockedReason(state, "planetaryCoverage"),
    ).toBe("Requires routed service in 2 regions.");

    let decorative = setCloudRegionalDemand(
      state,
      "region-2",
      amount("1"),
    );
    decorative = setCloudRoutingLinks(decorative, [{
      id: "decorative-only",
      from: "region-2",
      to: "region-1",
      capacity: amount("1000000000"),
      costPerUnit: 0,
      latencyMs: 25,
    }]);
    expect(getCloudRoutingSnapshot(decorative).result.edgeFlows[0]?.flow).toBe(
      "0",
    );
    expect(
      getCloudSlaBlockedReason(decorative, "planetaryCoverage"),
    ).toBe("Requires positive flow on explicit routes connecting 2 served regions.");

    const routed = setCloudRegionalDemand(
      decorative,
      "region-1",
      amount("2999999999"),
    );
    expect(getCloudRoutingSnapshot(routed).result.edgeFlows[0]?.flow).toBe(
      "999999999",
    );
    expect(getCloudSlaBlockedReason(routed, "planetaryCoverage")).toBeNull();
  });

  it("fails a time-integrated SLA whose routed p95 latency exceeds policy", () => {
    let state = createRegionalService();
    state = setCloudRegionalDemand(state, "region-1", amount(0));
    state = setCloudRegionalDemand(state, "region-2", amount("1000000000"));
    state = setCloudRoutingLinks(state, [
      {
        id: "prairie-to-lakes",
        from: "region-1",
        to: "region-2",
        capacity: amount("1000000000"),
        costPerUnit: 1,
        latencyMs: 500,
      },
    ]);
    expect(getCloudRoutingSnapshot(state).result.p95LatencyMs).toBe(500);

    const result = advanceCloud(
      startCloudSla(state, "regionalContinuity"),
      4 * 60 * 60_000,
    );
    expect(result.state.completedSlas[0]?.succeeded).toBe(false);
    expect(result.state.completedSlas[0]?.evaluation.latencyMet).toBe(false);
    expect(result.rewards).toEqual(exactResourceBag());
  });

  it("uses explicit, delayed failover and never schedules incidents without opt-in", () => {
    const base = createRegionalService();
    const rng = createRngState(42);
    const skipped = scheduleCloudIncident({
      state: base,
      rng,
      optIn: false,
      windowMs: 60_000,
    });
    expect(skipped.state.incidents).toEqual([]);
    expect(skipped.rng).toEqual(rng);

    const paused = setCloudZoneStatus(base, "zone-3", "paused");
    const requested = requestCloudFailover(paused);
    expect(requested.failover.activeZoneId).toBe("zone-3");
    expect(requested.failover.pendingZoneId).toBe("zone-4");
    expect(advanceCloud(requested, 29_999).state.failover.activeZoneId).toBe(
      "zone-3",
    );
    const completed = advanceCloud(requested, 30_000).state;
    expect(completed.failover.activeZoneId).toBe("zone-4");
    expect(completed.zones).toHaveLength(2);
    expect(completed.replicas).toHaveLength(2);
  });

  it("routes exact regional capacity through every planetary finale phase", () => {
    let state = createCloudState();
    for (const name of ["North", "South", "East", "West"]) {
      state = commissionCloudRegion(state, name);
    }
    for (let index = 1; index <= 4; index += 1) {
      state = commissionCloudZone(state, {
        regionId: `region-${index}`,
        facilityId: `facility-${index}`,
        capacityPerSecond: amount("1000000000000000000"),
        faultDomainId: `grid-${index}`,
      });
      state = setCloudRegionalDemand(
        state,
        `region-${index}`,
        amount(index === 1 ? "4000000000000000000" : "1"),
      );
    }
    state = setCloudRoutingLinks(
      state,
      [2, 3, 4].map((index) => ({
        id: `region-${index}-to-hub`,
        from: `region-${index}`,
        to: "region-1",
        capacity: amount("1000000000000000000"),
        costPerUnit: 0,
        latencyMs: 25,
      })),
    );
    state = startPlanetaryFinale(state);
    const result = advanceCloud(state, 2_000);

    expect(result.state.finale?.complete).toBe(true);
    expect(result.completedFinalePhaseIds).toEqual([
      "regional-bootstrap",
      "global-routing",
      "commons-commit",
    ]);
    const chartered = selectCloudFinaleCharter(result.state, "efficiency");
    expect(chartered.finaleCharterId).toBe("efficiency");
    expect(chartered.postgameUnlocked).toBe(true);
  });

  it("repairs malformed hierarchy, exact amounts, and dangling references", () => {
    const normalized = normalizeCloudState({
      elapsedMs: -1,
      nextEntityId: 1,
      regions: [
        { id: "region-9", name: "Valid" },
        { id: "region-9", name: "Duplicate" },
      ],
      zones: [
        {
          id: "zone-4",
          name: "Valid zone",
          regionId: "region-9",
          facilityId: "facility-1",
          capacityPerSecond: "1e309",
          baseLatencyMs: -2,
        },
        { id: "zone-5", regionId: "missing" },
      ],
      replicas: [
        { id: "replica-2", zoneId: "zone-4", healthy: true },
        { id: "replica-3", zoneId: "missing", healthy: true },
      ],
      activeSla: {
        id: "sla-12",
        definitionId: "regionalContinuity",
        elapsedMs: 100,
        workCompleted: "5",
        window: {
          elapsedMs: 999_999,
          availableMs: 999_999,
          quorumViolationMs: 0,
          serviceViolationMs: 0,
          commitElapsedMs: 900_000,
          latencyBuckets: [],
        },
      },
      completedSlas: [
        {
          id: "sla-20",
          definitionId: "regionalContinuity",
          succeeded: true,
          evaluation: { success: false },
        },
      ],
      finaleCharterId: "efficiency",
      postgameUnlocked: true,
      routingLinks: [{ id: "dangling", from: "region-9", to: "missing" }],
    });

    expect(normalized.elapsedMs).toBe(0);
    expect(normalized.regions).toHaveLength(1);
    expect(normalized.zones).toHaveLength(1);
    expect(normalized.zones[0]?.capacityPerSecond).toBe(`1${"0".repeat(309)}`);
    expect(normalized.replicas).toHaveLength(1);
    expect(normalized.activeSla?.observationElapsedMs).toBe(100);
    expect(normalized.activeSla?.window.elapsedMs).toBe(100);
    expect(normalized.activeSla?.window.commitElapsedMs).toBeNull();
    expect(normalized.completedSlas[0]?.succeeded).toBe(false);
    expect(normalized.completedSlas[0]?.rewards).toEqual(exactResourceBag());
    expect(normalized.finaleCharterId).toBeNull();
    expect(normalized.postgameUnlocked).toBe(false);
    expect(normalized.routingLinks).toEqual([]);
    expect(normalized.nextEntityId).toBeGreaterThan(20);

    const routed = getCloudRoutingSnapshot(
      setCloudRegionalDemand(normalized, "region-9", amount("1e309")),
    );
    expect(routed.result.delivered).toBe(`1${"0".repeat(309)}`);
    expect(routed.result.unmet).toBe("0");
  });
});
