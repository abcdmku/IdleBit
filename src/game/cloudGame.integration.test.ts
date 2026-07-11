import { describe, expect, it } from "vitest";
import {
  amount,
  amountAdd,
  amountCompare,
  amountDivide,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  exactResourceBag,
} from "./amount";
import { advanceGame } from "./advance";
import { getCloudRoutingSnapshot, getCloudSlaDefinition } from "./cloud";
import {
  advanceCloudForGameState,
  getCloudAdvanceBlockedReason,
  getCloudOperatingCostPerSecond,
  getCloudSlaProjection,
  getCloudSlaGameBlockedReason,
  getPlanetaryFinaleBlockedReason,
} from "./cloudGame";
import { getClusterWorkloadOperatingCostPerSecond } from "./distributedDefinitions";
import { getFacilityCloudZoneSources } from "./facilityInfrastructure";
import { withExactResources } from "./economy";
import { createInitialGameState } from "./progression";
import { deserializeSave, serializeSave } from "./save";
import { deriveVisibleState } from "./selectors";
import {
  applyAction,
  getSystemPowerOperatingCostPerSecond,
} from "./simulation";
import { recordSlaInterval } from "./sla";
import type { AdvanceReport, FinaleCharterId, GameState } from "./types";

const HOUR_MS = 60 * 60_000;

const mergeCompletionCounts = (
  records: Array<Partial<Record<string, number>> | undefined>,
) =>
  records.reduce<Record<string, number>>((merged, record) => {
    for (const [id, count] of Object.entries(record ?? {})) {
      merged[id] = (merged[id] ?? 0) + (count ?? 0);
    }
    return merged;
  }, {});

const combineIntervalReports = (reports: AdvanceReport[]) => {
  const first = reports[0]!;
  return {
    mode: first.mode,
    elapsedMs: reports.reduce((total, report) => total + report.elapsedMs, 0),
    simulatedMs: reports.reduce(
      (total, report) => total + report.simulatedMs,
      0,
    ),
    overflowMs: reports.reduce((total, report) => total + report.overflowMs, 0),
    productiveMs: reports.reduce(
      (total, report) => total + report.productiveMs,
      0,
    ),
    pausedMs: reports.reduce((total, report) => total + report.pausedMs, 0),
    bufferLevelId: first.bufferLevelId,
    bufferCapacityMs: first.bufferCapacityMs,
    standingOrderRenewals: reports.reduce(
      (total, report) => total + report.standingOrderRenewals,
      0,
    ),
    creditsEarned: reports.reduce(
      (total, report) => amountAdd(total, report.creditsEarned),
      amount(0),
    ),
    creditsSpent: reports.reduce(
      (total, report) => amountAdd(total, report.creditsSpent),
      amount(0),
    ),
    dataEarned: reports.reduce(
      (total, report) => amountAdd(total, report.dataEarned),
      amount(0),
    ),
    dataSpent: reports.reduce(
      (total, report) => amountAdd(total, report.dataSpent),
      amount(0),
    ),
    completedWork: mergeCompletionCounts(
      reports.map((report) => report.completedWork),
    ),
    completedClusterWork: mergeCompletionCounts(
      reports.map((report) => report.completedClusterWork),
    ),
    completedCloudSlas: mergeCompletionCounts(
      reports.map((report) => report.completedCloudSlas),
    ),
    completionEvents: reports.flatMap((report) => report.completionEvents ?? []),
    blockers: Array.from(
      new Set(reports.flatMap((report) => report.blockers)),
    ),
  };
};

const cloudChapterState = () => {
  const initial = createInitialGameState();
  return withExactResources(
    {
      ...initial,
      campaign: {
        ...initial.campaign,
        currentChapterId: "resilientCloud",
        currentObjectiveId: "cloud:data-center-noc",
      },
      automationBuffer: {
        ...initial.automationBuffer,
        ownedLevelId: "dataCenterNoc",
        departureLevelId: "dataCenterNoc",
      },
      flags: { ...initial.flags, systemCatalog: true },
      research: {
        ...initial.research,
        completed: Array.from(
          new Set([...initial.research.completed, "systemCatalog" as const]),
        ),
      },
    },
    exactResourceBag("1e30", "1e30"),
  );
};

const buildCloudService = (facilityCount = 2) => {
  let state = cloudChapterState();
  for (let index = 0; index < facilityCount; index += 1) {
    state = applyAction(state, {
      type: "purchaseAggregateServerBatch",
      skuId: "denseServer",
      count: 48,
      storageSkuId: "nvmeArray",
      networkSkuId: "fabricNic",
    });
  }
  const nodeIds = state.infrastructure.fleetNodes
    .filter((node) => node.managed)
    .map((node) => node.id);

  for (let index = 0; index < facilityCount; index += 1) {
    state = applyAction(state, {
      type: "commissionFacility",
      templateId: "regionalFacility",
      name: `Cloud Facility ${index + 1}`,
    });
    const facility = state.infrastructure.facilities[index]!;
    state = applyAction(state, {
      type: "commissionFacilityRack",
      facilityId: facility.id,
      templateId: "highDensityRack",
      name: `Cloud Rack ${index + 1}`,
    });
    const rackId = state.infrastructure.facilities[index]!.racks[0]!.id;
    state = applyAction(state, {
      type: "placeFleetNodeInRack",
      facilityId: facility.id,
      rackId,
      nodeId: nodeIds[index]!,
    });
    state = applyAction(state, {
      type: "commissionCloudRegion",
      name: `Region ${index + 1}`,
    });
    const regionId = state.cloud.regions[index]!.id;
    state = applyAction(state, {
      type: "commissionCloudZone",
      regionId,
      facilityId: facility.id,
      name: `Zone ${index + 1}`,
      faultDomainId: `grid-${index + 1}`,
      baseLatencyMs: 25,
    });
    const zoneId = state.cloud.zones[index]!.id;
    state = applyAction(state, { type: "placeCloudReplica", zoneId });
    state = applyAction(state, {
      type: "setCloudRegionalDemand",
      regionId,
      demand: amount("1000000000000000"),
    });
  }
  return { state, nodeIds };
};

const successfulPlanetarySla = (
  id = "sla-validated",
): GameState["cloud"]["completedSlas"][number] => ({
  id,
  definitionId: "planetaryCoverage",
  succeeded: true,
  evaluation: {
    availabilityBps: 10_000,
    p95LatencyMs: 25,
    distinctQuorumViolationMs: 0,
    serviceViolationMs: 0,
    deadlineMet: true,
    availabilityMet: true,
    latencyMet: true,
    success: true,
  },
  rewardBps: 10_000,
  rewards: getCloudSlaDefinition("planetaryCoverage").rewards,
});

const withPlanetaryChapter = (state: GameState): GameState => ({
  ...state,
  campaign: {
    ...state.campaign,
    currentChapterId: "planetaryCommons",
    currentObjectiveId: "planetary:global-scheduler",
  },
});

const withGlobalScheduler = (state: GameState): GameState => ({
  ...state,
  automationBuffer: {
    ...state.automationBuffer,
    ownedLevelId: "globalScheduler",
    departureLevelId: "globalScheduler",
  },
});

const withSuccessfulPlanetaryCoverage = (state: GameState): GameState => ({
  ...state,
  cloud: {
    ...state.cloud,
    completedSlas: [
      ...state.cloud.completedSlas.filter(
        (sla) => sla.definitionId !== "planetaryCoverage",
      ),
      successfulPlanetarySla(),
    ],
  },
});

const withExplicitRoutingTopology = (state: GameState): GameState => {
  const hubId = state.cloud.regions[0]!.id;
  const hubCapacity = state.cloud.zones
    .filter((zone) => zone.regionId === hubId)
    .reduce(
      (total, zone) => amountAdd(total, zone.capacityPerSecond),
      amount(0),
    );
  return {
    ...state,
    cloud: {
      ...state.cloud,
      regionalDemands: state.cloud.regions.map((region, index) => ({
        regionId: region.id,
        demand:
          index === 0
            ? amountAdd(hubCapacity, "1300000000000")
            : amount("1"),
      })),
      routingLinks: state.cloud.regions.slice(1).map((region, index) => ({
        id: `finale-route-${index + 1}`,
        from: region.id,
        to: hubId,
        capacity: amount("500000000000"),
        costPerUnit: 0,
        latencyMs: 25,
      })),
    },
  };
};

const finaleReadyState = () =>
  withExplicitRoutingTopology(
    withSuccessfulPlanetaryCoverage(
      withGlobalScheduler(withPlanetaryChapter(buildCloudService(4).state)),
    ),
  );

const completedFinaleState = () => {
  const started = applyAction(finaleReadyState(), {
    type: "startPlanetaryFinale",
  });
  const lastPhaseIndex = started.cloud.finale!.plan.phases.length - 1;
  const lastPhase = started.cloud.finale!.plan.phases[lastPhaseIndex]!;
  const nearCompletion: GameState = {
    ...started,
    cloud: {
      ...started.cloud,
      finale: {
        ...started.cloud.finale!,
        phaseIndex: lastPhaseIndex,
        phaseContribution: amountSubtract(lastPhase.contributionRequired, 1),
        completedPhaseIds: started.cloud.finale!.plan.phases
          .slice(0, lastPhaseIndex)
          .map((phase) => phase.id),
      },
    },
  };
  const completed = advanceGame(nearCompletion, 1, "foreground").state;
  expect(completed.cloud.finale?.complete).toBe(true);
  return completed;
};

const postgameState = (charterId: FinaleCharterId) =>
  applyAction(completedFinaleState(), {
    type: "selectFinaleCharter",
    charterId,
  });

const startRegionalSla = (state: GameState) =>
  applyAction(state, {
    type: "startCloudSla",
    definitionId: "regionalContinuity",
  });

const nearRegionalSlaCompletion = (
  state: GameState,
  remainingMs = 1_000,
): GameState => {
  const active = state.cloud.activeSla;
  if (!active) throw new Error("Expected an active Cloud SLA");
  const definition = getCloudSlaDefinition(active.definitionId);
  const observationElapsedMs = definition.observationWindowMs - remainingMs;
  return {
    ...state,
    cloud: {
      ...state.cloud,
      activeSla: {
        ...active,
        observationElapsedMs,
        workCompleted: definition.workRequired,
        window: recordSlaInterval(active.window, definition.policy, {
          elapsedMs: observationElapsedMs,
          serviceOnline: true,
          healthyReplicaFaultDomains: state.cloud.zones.map(
            (zone) => zone.faultDomainId,
          ),
          latencyMs: 25,
          committed: true,
        }),
      },
    },
  };
};

describe("saved Cloud vertical slice", () => {
  it("uses public actions, facility-derived capacity, and rejects missing facilities", () => {
    const { state } = buildCloudService(2);
    const sources = getFacilityCloudZoneSources(state);
    const sourceByFacility = new Map(
      sources.map((source) => [source.facilityId, source.capacityPerSecond]),
    );

    expect(state.cloud.regions).toHaveLength(2);
    expect(state.cloud.zones).toHaveLength(2);
    expect(state.cloud.replicas).toHaveLength(2);
    for (const zone of state.cloud.zones) {
      expect(zone.capacityPerSecond).toBe(sourceByFacility.get(zone.facilityId));
    }
    const rejected = applyAction(state, {
      type: "commissionCloudZone",
      regionId: state.cloud.regions[0]!.id,
      facilityId: "facility-999999",
    });
    expect(rejected.cloud.zones).toEqual(state.cloud.zones);
    expect(deriveVisibleState(state).cloud.zones).toHaveLength(2);
  });

  it("keeps static routed Cloud topology exact across split inactive advances", () => {
    let state = buildCloudService(2).state;
    const [firstRegion, secondRegion] = state.cloud.regions;
    state = applyAction(state, {
      type: "setCloudRoutingLinks",
      links: [
        {
          id: "static-route",
          from: firstRegion!.id,
          to: secondRegion!.id,
          capacity: amount("10000000000000"),
          costPerUnit: 1,
          latencyMs: 25,
        },
      ],
    });
    const oneShot = advanceGame(state, HOUR_MS, "foreground").state;
    let split = state;
    for (let index = 0; index < 4; index += 1) {
      split = advanceGame(split, HOUR_MS / 4, "foreground").state;
    }

    expect(split.cloud).toEqual(oneShot.cloud);
    expect(split.infrastructure.facilities).toEqual(
      oneShot.infrastructure.facilities,
    );
    expect(split.exactResources).toEqual(oneShot.exactResources);
    expect(oneShot.cloud.activeSla).toBeNull();
    expect(oneShot.cloud.finale).toBeNull();
  });

  it("round-trips save-v7 Cloud runtime and drops zones whose facilities disappeared", () => {
    const started = startRegionalSla(buildCloudService(2).state);
    const partial = advanceGame(started, 1_000, "foreground").state;
    const loaded = deserializeSave(serializeSave(partial, 123_456));
    const visible = deriveVisibleState(partial);
    const activeSla = visible.cloud.activeSla!;
    const visibleSlaWork = visible.activeWork.find(
      (work) => work.kind === "sla",
    );

    expect(loaded.cloud).toEqual(partial.cloud);
    expect(visible.activeWork.map((work) => work.kind)).toEqual(
      expect.arrayContaining(["cloud", "sla"]),
    );
    expect(visibleSlaWork?.progress).toBe(
      Math.min(
        1,
        amountToSafeNumber(
          amountDivide(activeSla.workCompleted, activeSla.workRequired),
        ),
      ),
    );
    expect(
      amountCompare(
        visible.departureForecast.aggregateOperatingCostPerSecond,
        0,
      ),
    ).toBeGreaterThan(0);
    const envelope = JSON.parse(serializeSave(partial, 123_456)) as {
      state: GameState;
    };
    envelope.state.infrastructure.facilities =
      envelope.state.infrastructure.facilities.slice(1);
    const repaired = deserializeSave(JSON.stringify(envelope));

    expect(repaired.cloud.zones).toHaveLength(1);
    expect(repaired.cloud.replicas).toHaveLength(1);
    expect(
      repaired.cloud.zones.every((zone) =>
        repaired.infrastructure.facilities.some(
          (facility) => facility.id === zone.facilityId,
        ),
      ),
    ).toBe(true);
  });

  it("is delta invariant, rewards a successful SLA once, and attributes the interval", () => {
    const started = nearRegionalSlaCompletion(
      startRegionalSla(buildCloudService(2).state),
    );
    const oneShot = advanceGame(started, 1_000, "foreground");
    let chunked = started;
    const chunkedReports: AdvanceReport[] = [];
    for (let index = 0; index < 4; index += 1) {
      const chunk = advanceGame(chunked, 250, "foreground");
      chunked = chunk.state;
      chunkedReports.push(chunk.intervalReport);
    }

    expect(oneShot.state.cloud.activeSla).toBeNull();
    expect(oneShot.state.cloud.completedSlas[0]?.succeeded).toBe(true);
    expect(chunked.cloud).toEqual(oneShot.state.cloud);
    expect(chunked.exactResources).toEqual(oneShot.state.exactResources);
    expect(chunked).toEqual(oneShot.state);
    expect(combineIntervalReports(chunkedReports)).toEqual(
      combineIntervalReports([oneShot.intervalReport]),
    );
    expect(oneShot.intervalReport.completedCloudSlas).toEqual({
      regionalContinuity: 1,
    });
    expect(oneShot.intervalReport.completionEvents).toEqual([
      {
        source: "cloud",
        instanceId: oneShot.state.cloud.completedSlas[0]!.id,
        workId: "regionalContinuity",
        creditsEarned: "1000000000000",
        dataEarned: "100000",
      },
    ]);
    expect(oneShot.intervalReport.creditsEarned).toBe("1000000000000");
    expect(amountCompare(oneShot.intervalReport.creditsSpent, 0)).toBeGreaterThan(0);
    const after = advanceGame(oneShot.state, HOUR_MS, "foreground");
    expect(after.intervalReport.creditsEarned).toBe("0");
    expect(after.intervalReport.completionEvents).toEqual([]);
  });

  it("safely freezes offline SLA work without the departure Data Center NOC", () => {
    const started = startRegionalSla(buildCloudService(2).state);
    const state: GameState = {
      ...started,
      automationBuffer: {
        ...started.automationBuffer,
        ownedLevelId: "dataCenterNoc",
        departureLevelId: "rackController",
      },
    };
    const creditsBefore = state.exactResources.credits;
    const advanced = advanceGame(state, HOUR_MS, "offline");

    expect(advanced.state.cloud.activeSla?.observationElapsedMs).toBe(0);
    expect(advanced.state.cloud.activeSla?.workCompleted).toBe("0");
    expect(advanced.state.exactResources.credits).toBe(creditsBefore);
    expect(advanced.intervalReport.productiveMs).toBe(0);
    expect(advanced.intervalReport.pausedMs).toBe(HOUR_MS);
    expect(advanced.intervalReport.blockers).toContain(
      "Data Center NOC automation is required for Cloud SLA work.",
    );
  });

  it("deduplicates a facility shared by productive cluster and Cloud work", () => {
    const built = buildCloudService(2);
    let state = applyAction(built.state, {
      type: "commissionCluster",
      name: "Shared Facility Cluster",
      nodeIds: [built.nodeIds[0]!],
    });
    state = applyAction(state, {
      type: "startClusterWorkload",
      clusterId: state.infrastructure.clusters[0]!.id,
      definitionId: "fabricIntegritySweep",
    });
    state = startRegionalSla(state);
    state = { ...state, flags: { ...state.flags, psuManagement: true } };
    const combinedRate = amountAdd(
      getSystemPowerOperatingCostPerSecond(state),
      amountAdd(
        getClusterWorkloadOperatingCostPerSecond(state),
        getCloudOperatingCostPerSecond(state),
      ),
    );
    const creditsBefore = state.exactResources.credits;
    const advanced = advanceGame(state, 1_000, "foreground").state;

    expect(
      amountSubtract(creditsBefore, advanced.exactResources.credits),
    ).toBe(combinedRate);
    expect(advanced.infrastructure.workloads?.[0]?.runtime.rewardIssued).toBe(
      false,
    );
    expect(advanced.cloud.activeSla).not.toBeNull();
  });

  it("applies Grid Relief's exact facility discount to productive Cloud work", () => {
    const baseline = startRegionalSla(buildCloudService(2).state);
    const baselineRate = getCloudOperatingCostPerSecond(baseline);
    const relieved: GameState = {
      ...baseline,
      projects: {
        ...baseline.projects,
        completedProjectIds: ["gridRelief"],
      },
    };

    expect(baselineRate).not.toBe("0");
    expect(getCloudOperatingCostPerSecond(relieved)).toBe(
      amountMultiply(baselineRate, "0.8"),
    );
  });

  it("routes demand, requests deterministic failover, and draws incidents only by opt-in", () => {
    let state = buildCloudService(2).state;
    const [firstRegion, secondRegion] = state.cloud.regions;
    state = applyAction(state, {
      type: "setCloudRegionalDemand",
      regionId: firstRegion!.id,
      demand: amount(0),
    });
    state = applyAction(state, {
      type: "setCloudRoutingLinks",
      links: [{
        id: "inter-region",
        from: firstRegion!.id,
        to: secondRegion!.id,
        capacity: amount("10000000000000"),
        costPerUnit: 1,
        latencyMs: 50,
      }],
    });
    expect(deriveVisibleState(state).cloud.routing.deliveredPerSecond).not.toBe("0");

    state = applyAction(state, {
      type: "setCloudFailoverPolicy",
      automaticFailover: false,
      delayMs: 10,
    });
    const activeBefore = state.cloud.failover.activeZoneId;
    state = applyAction(state, { type: "requestCloudFailover" });
    const pending = state.cloud.failover.pendingZoneId;
    expect(pending).not.toBeNull();
    const failedOver = advanceGame(state, 10, "foreground").state;
    expect(failedOver.cloud.failover.activeZoneId).toBe(pending);
    expect(failedOver.cloud.failover.activeZoneId).not.toBe(activeBefore);

    const rngBefore = failedOver.rng;
    const skipped = applyAction(failedOver, {
      type: "drawCloudIncident",
      optIn: false,
      windowMs: 60_000,
    });
    expect(skipped.cloud.incidents).toEqual(failedOver.cloud.incidents);
    expect(skipped.rng).toEqual(rngBefore);
    const optedIn = applyAction(skipped, {
      type: "drawCloudIncident",
      optIn: true,
      windowMs: 60_000,
    });
    expect(optedIn.cloud.incidents).toHaveLength(1);
    const afterIncident = advanceGame(optedIn, 60_000, "foreground").state;
    expect(afterIncident.infrastructure.facilities).toEqual(
      optedIn.infrastructure.facilities,
    );
    expect(afterIncident.cloud.replicas).toEqual(optedIn.cloud.replicas);
  });

  it("preserves active SLA, incident, and failover events across split advances", () => {
    let state = startRegionalSla(buildCloudService(2).state);
    state = applyAction(state, {
      type: "setCloudFailoverPolicy",
      automaticFailover: false,
      delayMs: 10_000,
    });
    state = applyAction(state, { type: "requestCloudFailover" });
    state = applyAction(state, {
      type: "drawCloudIncident",
      optIn: true,
      windowMs: 40_000,
    });
    const pendingZoneId = state.cloud.failover.pendingZoneId;

    expect(state.cloud.activeSla).not.toBeNull();
    expect(pendingZoneId).not.toBeNull();
    expect(state.cloud.incidents).toHaveLength(1);

    const oneShot = advanceGame(state, 60_000, "foreground");
    let splitState = state;
    const splitReports: AdvanceReport[] = [];
    for (let index = 0; index < 4; index += 1) {
      const split = advanceGame(splitState, 15_000, "foreground");
      splitState = split.state;
      splitReports.push(split.intervalReport);
    }

    expect(splitState).toEqual(oneShot.state);
    expect(combineIntervalReports(splitReports)).toEqual(
      combineIntervalReports([oneShot.intervalReport]),
    );
    expect(oneShot.state.cloud.activeSla?.observationElapsedMs).toBe(60_000);
    expect(oneShot.state.cloud.failover).toMatchObject({
      activeZoneId: pendingZoneId,
      pendingZoneId: null,
      completesAtMs: null,
    });
    expect(oneShot.state.cloud.incidents).toEqual(state.cloud.incidents);
    expect(oneShot.state.infrastructure.facilities).toEqual(
      state.infrastructure.facilities,
    );
  });

  it("shares Data Center NOC and finale-exclusion SLA blockers across selectors and actions", () => {
    const service = buildCloudService(2).state;
    const missingNoc: GameState = {
      ...service,
      automationBuffer: {
        ...service.automationBuffer,
        ownedLevelId: "rackController",
        departureLevelId: "rackController",
      },
    };
    const nocReason =
      "Data Center NOC automation is required to start Cloud SLA work.";

    expect(
      getCloudSlaGameBlockedReason(missingNoc, "regionalContinuity"),
    ).toBe(nocReason);
    expect(
      deriveVisibleState(missingNoc).cloud.slaDefinitions.find(
        (definition) => definition.id === "regionalContinuity",
      ),
    ).toMatchObject({ canStart: false, blockedReason: nocReason });
    expect(
      applyAction(missingNoc, {
        type: "startCloudSla",
        definitionId: "regionalContinuity",
      }).cloud.activeSla,
    ).toBeNull();

    const activeFinale = applyAction(finaleReadyState(), {
      type: "startPlanetaryFinale",
    });
    const finaleReason =
      "Finish the active planetary finale before starting another Cloud SLA.";
    expect(activeFinale.cloud.finale).not.toBeNull();
    expect(
      getCloudSlaGameBlockedReason(activeFinale, "regionalContinuity"),
    ).toBe(finaleReason);
    expect(
      deriveVisibleState(activeFinale).cloud.slaDefinitions.find(
        (definition) => definition.id === "regionalContinuity",
      ),
    ).toMatchObject({ canStart: false, blockedReason: finaleReason });
    expect(
      applyAction(activeFinale, {
        type: "startCloudSla",
        definitionId: "regionalContinuity",
      }).cloud.activeSla,
    ).toBeNull();
  });

  it("exposes source-correct full-observation-window Cloud SLA economics", () => {
    const ready = buildCloudService(2).state;
    const definition = getCloudSlaDefinition("regionalContinuity");
    const projection = getCloudSlaProjection(ready, "regionalContinuity");
    const started = startRegionalSla(ready);
    const operatingRate = getCloudOperatingCostPerSecond(started);
    const routedWorkPerSecond = getCloudRoutingSnapshot(
      started.cloud,
    ).result.delivered;
    const projectedWorkCompletionMs = amountMultiply(
      amountDivide(definition.workRequired, routedWorkPerSecond),
      1_000,
    );
    const operatingCost = amountDivide(
      amountMultiply(operatingRate, definition.observationWindowMs),
      1_000,
    );

    expect(started.cloud.activeSla?.definitionId).toBe("regionalContinuity");
    expect(amountCompare(operatingRate, 0)).toBeGreaterThan(0);
    expect(projection).toMatchObject({
      observationWindowMs: definition.observationWindowMs,
      projectedWorkCompletionMs,
      operatingCostPerSecond: operatingRate,
      operatingCostCredits: operatingCost,
      netRewardCredits: amountSubtract(
        definition.rewards.credits,
        operatingCost,
      ),
      bufferCovered: true,
      blockedReason: null,
    });
    expect(projection.marginBps).not.toBeNull();
    expect(
      deriveVisibleState(ready).cloud.slaDefinitions.find(
        (candidate) => candidate.id === "regionalContinuity",
      )?.projection,
    ).toEqual(projection);
  });

  it("pauses Planetary Coverage billing and progress when explicit route flow stops", () => {
    const ready = withExplicitRoutingTopology(buildCloudService(3).state);
    const started = applyAction(ready, {
      type: "startCloudSla",
      definitionId: "planetaryCoverage",
    });
    expect(started.cloud.activeSla?.definitionId).toBe("planetaryCoverage");

    const pausedInput: GameState = {
      ...started,
      cloud: {
        ...started.cloud,
        routingLinks: started.cloud.routingLinks.map((link) => ({
          ...link,
          capacity: amount(0),
        })),
      },
    };
    const flowReason =
      "Requires positive flow on explicit routes connecting 2 served regions.";
    expect(getCloudAdvanceBlockedReason(pausedInput, "foreground")).toBe(
      flowReason,
    );
    expect(getCloudOperatingCostPerSecond(pausedInput)).toBe("0");
    const paused = advanceCloudForGameState(pausedInput, 1_000);
    expect(paused.cloud.activeSla?.workCompleted).toBe("0");
    expect(paused.exactResources.credits).toBe(
      pausedInput.exactResources.credits,
    );

    const restored: GameState = {
      ...paused,
      cloud: {
        ...paused.cloud,
        routingLinks: started.cloud.routingLinks,
      },
    };
    expect(getCloudAdvanceBlockedReason(restored, "foreground")).toBeNull();
    const resumed = advanceCloudForGameState(restored, 1_000);
    expect(
      amountCompare(resumed.cloud.activeSla?.workCompleted ?? 0, 0),
    ).toBeGreaterThan(0);
    expect(
      amountCompare(resumed.exactResources.credits, restored.exactResources.credits),
    ).toBeLessThan(0);
  });

  it("shares every planetary finale prerequisite across selectors and actions", () => {
    const fourRegionService = buildCloudService(4).state;
    const assertBlocked = (state: GameState, blockedReason: string) => {
      expect(getPlanetaryFinaleBlockedReason(state)).toBe(blockedReason);
      expect(deriveVisibleState(state).cloud.finale).toMatchObject({
        canStart: false,
        blockedReason,
      });
      expect(
        applyAction(state, { type: "startPlanetaryFinale" }).cloud.finale,
      ).toEqual(state.cloud.finale);
    };

    assertBlocked(fourRegionService, "Requires Planetary Commons.");

    const planetary = withPlanetaryChapter(fourRegionService);
    assertBlocked(
      planetary,
      "Global Scheduler automation is required to start the planetary finale.",
    );

    const global = withGlobalScheduler(planetary);
    assertBlocked(global, "Complete a successful Planetary Coverage SLA first.");

    const threeRegionProof = withSuccessfulPlanetaryCoverage(
      withGlobalScheduler(
        withPlanetaryChapter(buildCloudService(3).state),
      ),
    );
    assertBlocked(threeRegionProof, "Requires routed capacity in four regions.");

    const proof = withSuccessfulPlanetaryCoverage(global);
    assertBlocked(
      proof,
      "Requires positive flow on explicit routes connecting four served regions.",
    );

    const decorativeLinks: GameState = {
      ...proof,
      cloud: {
        ...proof.cloud,
        routingLinks: proof.cloud.regions.slice(1).map((region, index) => ({
          id: `decorative-route-${index + 1}`,
          from: region.id,
          to: proof.cloud.regions[0]!.id,
          capacity: amount("500000000000"),
          costPerUnit: 0,
          latencyMs: 25,
        })),
      },
    };
    assertBlocked(
      decorativeLinks,
      "Requires positive flow on explicit routes connecting four served regions.",
    );

    const activeSla = withExplicitRoutingTopology(
      withSuccessfulPlanetaryCoverage(
        withGlobalScheduler(
          withPlanetaryChapter(startRegionalSla(fourRegionService)),
        ),
      ),
    );
    assertBlocked(
      activeSla,
      "Finish the active Cloud SLA before starting the planetary finale.",
    );

    const ready = withExplicitRoutingTopology(proof);
    expect(getPlanetaryFinaleBlockedReason(ready)).toBeNull();
    expect(deriveVisibleState(ready).cloud.finale).toMatchObject({
      canStart: true,
      blockedReason: null,
    });
    const started = applyAction(ready, { type: "startPlanetaryFinale" });
    expect(started.cloud.finale).not.toBeNull();
    expect(getPlanetaryFinaleBlockedReason(started)).toBe(
      "Planetary finale already started.",
    );
    expect(deriveVisibleState(started).cloud.finale).toMatchObject({
      canStart: false,
      blockedReason: "Planetary finale already started.",
    });

    const pausedInput: GameState = {
      ...started,
      cloud: {
        ...started.cloud,
        routingLinks: started.cloud.routingLinks.map((link) => ({
          ...link,
          capacity: amount(0),
        })),
      },
    };
    const flowReason =
      "Requires positive flow on explicit routes connecting four served regions.";
    expect(getCloudAdvanceBlockedReason(pausedInput, "foreground")).toBe(
      flowReason,
    );
    expect(getCloudOperatingCostPerSecond(pausedInput)).toBe("0");
    const paused = advanceCloudForGameState(pausedInput, 1_000);
    expect(paused.cloud.finale?.totalContribution).toBe("0");
    expect(paused.exactResources.credits).toBe(
      pausedInput.exactResources.credits,
    );

    const restored: GameState = {
      ...paused,
      cloud: {
        ...paused.cloud,
        routingLinks: started.cloud.routingLinks,
      },
    };
    expect(getCloudAdvanceBlockedReason(restored, "foreground")).toBeNull();
    const resumed = advanceCloudForGameState(restored, 1_000);
    expect(
      amountCompare(resumed.cloud.finale?.totalContribution ?? 0, 0),
    ).toBeGreaterThan(0);
    expect(
      amountCompare(resumed.exactResources.credits, restored.exactResources.credits),
    ).toBeLessThan(0);
  });

  it("requires Global Scheduler offline for the real finale and persists its charter", () => {
    const service = buildCloudService(4).state;
    const successful = withExplicitRoutingTopology(
      withSuccessfulPlanetaryCoverage(withPlanetaryChapter(service)),
    );
    const global = withGlobalScheduler(successful);
    const globalReady: GameState = {
      ...global,
      automationBuffer: {
        ...global.automationBuffer,
        departureLevelId: "dataCenterNoc",
      },
    };
    const started = applyAction(globalReady, { type: "startPlanetaryFinale" });
    expect(started.cloud.finale).not.toBeNull();
    expect(
      deriveVisibleState(started).activeWork.some(
        (work) => work.kind === "finale",
      ),
    ).toBe(true);
    const gated = advanceGame(started, 1_000, "offline");
    expect(gated.state.cloud.finale?.totalContribution).toBe("0");
    expect(gated.intervalReport.blockers).toContain(
      "Global Scheduler automation is required for the planetary finale.",
    );

    const lastPhaseIndex = gated.state.cloud.finale!.plan.phases.length - 1;
    const lastPhase = gated.state.cloud.finale!.plan.phases[lastPhaseIndex]!;
    const runnable: GameState = {
      ...gated.state,
      automationBuffer: {
        ...gated.state.automationBuffer,
        departureLevelId: "globalScheduler",
      },
      cloud: {
        ...gated.state.cloud,
        finale: {
          ...gated.state.cloud.finale!,
          phaseIndex: lastPhaseIndex,
          phaseContribution: amountSubtract(lastPhase.contributionRequired, 1),
          completedPhaseIds: gated.state.cloud.finale!.plan.phases
            .slice(0, lastPhaseIndex)
            .map((phase) => phase.id),
        },
      },
    };
    const completed = advanceGame(runnable, 1, "foreground").state;
    expect(completed.cloud.finale?.complete).toBe(true);
    expect(completed.campaign.currentObjectiveId).toBe("planetary:charter");
    const chartered = applyAction(completed, {
      type: "selectFinaleCharter",
      charterId: "efficiency",
    });
    expect(chartered.cloud.finaleCharterId).toBe("efficiency");
    expect(chartered.cloud.postgameUnlocked).toBe(true);
    expect(chartered.campaign.finaleCharterId).toBe("efficiency");
    expect(chartered.campaign.postgameUnlocked).toBe(true);
    const loaded = deserializeSave(serializeSave(chartered));
    expect(loaded.cloud.finaleCharterId).toBe("efficiency");
    expect(loaded.cloud.postgameUnlocked).toBe(true);
  });

  it("applies Open Compute shared-capacity reserve and supports endless SLA restarts", () => {
    const base = buildCloudService(4).state;
    const chartered = postgameState("openCompute");
    const baseZone = base.cloud.zones[0]!;
    const openZone = chartered.cloud.zones[0]!;
    expect(openZone.capacityPerSecond).toBe(
      amountDivide(amountMultiply(baseZone.capacityPerSecond, 8_000), 10_000),
    );

    const definition = getCloudSlaDefinition("regionalContinuity");
    const projection = getCloudSlaProjection(chartered, definition.id);
    expect(projection.blockedReason).toBeNull();
    expect(projection.rewards.credits).toBe(
      amountDivide(amountMultiply(definition.rewards.credits, 12_500), 10_000),
    );

    const first = startRegionalSla(chartered);
    const firstCompleted = advanceCloudForGameState(
      first,
      definition.observationWindowMs,
      "foreground",
    );
    const firstReward = firstCompleted.cloud.completedSlas.at(-1)!;
    expect(firstReward.succeeded).toBe(true);
    expect(firstReward.rewards).toEqual(projection.rewards);
    expect(firstCompleted.exactResources.credits).toBe(
      amountAdd(
        amountSubtract(first.exactResources.credits, projection.operatingCostCredits!),
        projection.rewards.credits,
      ),
    );

    const second = startRegionalSla(firstCompleted);
    expect(second.cloud.activeSla?.definitionId).toBe(definition.id);
  });
});
