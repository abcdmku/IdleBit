import { describe, expect, it } from "vitest";
import {
  amountAdd,
  amountDivide,
  amountMultiply,
  amountSubtract,
  exactResourceBag,
} from "./amount";
import { advanceGame } from "./advance";
import {
  getClusterWorkloadOperatingCostPerSecond,
  getClusterWorkloadStartBlockedReason,
  getClusterWorkloadDefinition,
} from "./distributedDefinitions";
import { withExactResources } from "./economy";
import {
  getFacilityOperatingCostPerSecondForNodeIds,
  getProductiveFacilitiesForNodeIds,
} from "./facilityInfrastructure";
import { createInitialGameState } from "./progression";
import {
  applyAction,
  getNextSimulationEventMs,
  getSystemPowerOperatingCostPerSecond,
} from "./simulation";
import type { GameState } from "./types";

const facilityChapterState = () => {
  const initial = createInitialGameState();
  return withExactResources(
    {
      ...initial,
      campaign: {
        ...initial.campaign,
        currentChapterId: "rackAndFacility",
        currentObjectiveId: "facility:rack-controller",
      },
      automationBuffer: {
        ...initial.automationBuffer,
        ownedLevelId: "rackController",
        departureLevelId: "rackController",
      },
      flags: { ...initial.flags, systemCatalog: true },
      research: {
        ...initial.research,
        completed: Array.from(
          new Set([...initial.research.completed, "systemCatalog" as const]),
        ),
      },
    },
    exactResourceBag("1e12", "1e12"),
  );
};

const addWorkshopNodes = (input: GameState, count: number) => {
  let state = input;
  for (let index = 0; index < count; index += 1) {
    state = applyAction(state, {
      type: "purchaseAggregateServerBatch",
      skuId: "workshopServer",
      count: 1,
      storageSkuId: "localSsd",
      networkSkuId: "gigabitNic",
    });
  }
  return state;
};

const buildRackedCluster = (nodeCount: number) => {
  let state = addWorkshopNodes(facilityChapterState(), nodeCount);
  const nodeIds = state.infrastructure.fleetNodes
    .filter((node) => node.managed)
    .map((node) => node.id);
  state = applyAction(state, {
    type: "commissionFacility",
    templateId: "workshopFacility",
    name: "Runtime Lab",
  });
  const facilityId = state.infrastructure.facilities[0]!.id;
  state = applyAction(state, {
    type: "commissionFacilityRack",
    facilityId,
    templateId: "halfRack",
    name: "Runtime Rack",
  });
  const rackId = state.infrastructure.facilities[0]!.racks[0]!.id;
  for (const nodeId of nodeIds) {
    state = applyAction(state, {
      type: "placeFleetNodeInRack",
      facilityId,
      rackId,
      nodeId,
    });
  }
  state = applyAction(state, {
    type: "commissionCluster",
    name: "Racked Fabric",
    nodeIds,
    replicaFaultDomain: "node",
  });
  return {
    state,
    nodeIds,
    facilityId,
    clusterId: state.infrastructure.clusters[0]!.id,
  };
};

describe("facility-backed cluster advancement", () => {
  it("repairs malformed facility placement once at the public advance boundary", () => {
    const built = buildRackedCluster(1);
    const malformed: GameState = {
      ...built.state,
      infrastructure: {
        ...built.state.infrastructure,
        facilities: built.state.infrastructure.facilities.map((facility) => ({
          ...facility,
          racks: facility.racks.map((rack) => ({
            ...rack,
            placements: rack.placements.map((placement) => ({
              ...placement,
              equipment: { ...placement.equipment, id: "missing-node" },
            })),
          })),
        })),
      },
    };

    const repaired = advanceGame(malformed, 0, "foreground").state;

    expect(repaired.infrastructure.facilities[0]?.racks[0]?.placements).toEqual(
      [],
    );
    expect(
      repaired.infrastructure.fleetNodes.find(
        (node) => node.id === built.nodeIds[0],
      )?.rackId,
    ).toBeNull();
  });

  it("does not bill a commissioned facility while no admitted workload is productive", () => {
    const built = buildRackedCluster(2);
    const beforeCredits = built.state.exactResources.credits;
    // Only the host system's metered power drains; the facility itself must
    // not charge while no admitted workload is productive.
    const hostBilled = amountDivide(
      amountMultiply(getSystemPowerOperatingCostPerSecond(built.state), 1_000),
      1_000,
    );
    const advanced = advanceGame(built.state, 1_000, "foreground");

    expect(advanced.state.exactResources.credits).toBe(
      amountSubtract(beforeCredits, hostBilled),
    );
    expect(advanced.intervalReport.productiveMs).toBe(0);
    expect(advanced.intervalReport.pausedMs).toBe(1_000);
  });

  it("deduplicates a productive facility and charges it once before progress", () => {
    const built = buildRackedCluster(2);
    let state = applyAction(built.state, {
      type: "startClusterWorkload",
      clusterId: built.clusterId,
      definitionId: "replicatedShardCommit",
    });
    const facilityRate = getFacilityOperatingCostPerSecondForNodeIds(
      state,
      built.nodeIds,
    );
    const oneNodeFacilityRate = getFacilityOperatingCostPerSecondForNodeIds(
      state,
      [built.nodeIds[0]!],
    );
    const combinedRate = amountAdd("0.5", facilityRate);
    const beforeCredits = state.exactResources.credits;

    expect(getProductiveFacilitiesForNodeIds(state, built.nodeIds)).toHaveLength(1);
    expect(facilityRate).toBe(oneNodeFacilityRate);
    expect(getClusterWorkloadOperatingCostPerSecond(state)).toBe(combinedRate);

    const advanced = advanceGame(state, 1_000, "foreground");
    // The host system's metered power drains alongside the single facility
    // charge; the facility itself must only be charged once.
    expect(amountSubtract(beforeCredits, advanced.state.exactResources.credits)).toBe(
      amountAdd(combinedRate, getSystemPowerOperatingCostPerSecond(state)),
    );
    expect(advanced.state.infrastructure.facilities[0]?.id).toBe(
      built.facilityId,
    );
    expect(advanced.state.infrastructure.workloads?.[0]?.operatingCreditsSpent).toBe(
      "0.5",
    );
  });

  it("applies Grid Relief's exact 20% productive-facility discount without making it mandatory", () => {
    const built = buildRackedCluster(2);
    const baselineRate = getFacilityOperatingCostPerSecondForNodeIds(
      built.state,
      built.nodeIds,
    );
    const relieved: GameState = {
      ...built.state,
      projects: {
        ...built.state.projects,
        completedProjectIds: ["gridRelief"],
      },
    };
    const discountedRate = getFacilityOperatingCostPerSecondForNodeIds(
      relieved,
      built.nodeIds,
    );

    expect(baselineRate).not.toBe("0");
    expect(discountedRate).toBe(amountMultiply(baselineRate, "0.8"));
    expect(built.state.projects.completedProjectIds).not.toContain("gridRelief");
  });

  it("uses the exact shared runway without rounding a positive sub-ms event to 1ms", () => {
    const built = buildRackedCluster(2);
    let state = applyAction(built.state, {
      type: "startClusterWorkload",
      clusterId: built.clusterId,
      definitionId: "replicatedShardCommit",
    });
    // The shared runway covers cluster, facility, and host-system metered
    // power, so fund exactly half a millisecond of the combined rate.
    const combinedRate = amountAdd(
      getClusterWorkloadOperatingCostPerSecond(state),
      getSystemPowerOperatingCostPerSecond(state),
    );
    const halfMillisecondCost = amountDivide(
      amountMultiply(combinedRate, "0.5"),
      1_000,
    );
    state = withExactResources(
      state,
      exactResourceBag(halfMillisecondCost, state.exactResources.data),
    );

    expect(getNextSimulationEventMs(state, 1)).toBe(0.5);
    const advanced = advanceGame(state, 1, "foreground");

    expect(advanced.state.exactResources.credits).toBe("0");
    expect(advanced.intervalReport.productiveMs).toBe(0.5);
    expect(advanced.intervalReport.pausedMs).toBe(0.5);
    expect(advanced.state.infrastructure.workloads?.[0]?.operatingCreditsSpent).toBe(
      "0.00025",
    );
    expect(advanced.state.infrastructure.workloads?.[0]?.runtime.rewardIssued).toBe(
      false,
    );
    expect(advanced.state.infrastructure.facilities[0]?.id).toBe(
      built.facilityId,
    );
  });

  it("shares the exact runway with system power and remains delta invariant", () => {
    const built = buildRackedCluster(2);
    const started = applyAction(built.state, {
      type: "startClusterWorkload",
      clusterId: built.clusterId,
      definitionId: "replicatedShardCommit",
    });
    const state: GameState = {
      ...started,
      flags: { ...started.flags, psuManagement: true },
    };
    const systemPowerRate = getSystemPowerOperatingCostPerSecond(state);
    const infrastructureRate = getClusterWorkloadOperatingCostPerSecond(state);
    const combinedRate = amountAdd(systemPowerRate, infrastructureRate);

    expect(systemPowerRate).not.toBe("0");
    const oneShot = advanceGame(state, 1_000, "foreground").state;
    const firstChunk = advanceGame(state, 250, "foreground").state;
    const chunked = advanceGame(firstChunk, 750, "foreground").state;

    expect(amountSubtract(state.exactResources.credits, oneShot.exactResources.credits)).toBe(
      combinedRate,
    );
    expect(chunked.exactResources).toEqual(oneShot.exactResources);
    expect(chunked.infrastructure.workloads).toEqual(
      oneShot.infrastructure.workloads,
    );
    expect(chunked.infrastructure.facilities).toEqual(
      oneShot.infrastructure.facilities,
    );
  });

  it("bills the productive facility before issuing an atomic completion reward", () => {
    const built = buildRackedCluster(2);
    let state = applyAction(built.state, {
      type: "startClusterWorkload",
      clusterId: built.clusterId,
      definitionId: "replicatedShardCommit",
    });
    const operatingCost = amountDivide(
      amountMultiply(getClusterWorkloadOperatingCostPerSecond(state), 4_125),
      1_000,
    );
    // Fund the host system's metered power for the same window so the
    // workload's own operating runway spans the full 4.125s.
    const hostPowerCost = amountDivide(
      amountMultiply(getSystemPowerOperatingCostPerSecond(state), 4_125),
      1_000,
    );
    state = withExactResources(
      state,
      exactResourceBag(
        amountAdd(operatingCost, hostPowerCost),
        state.exactResources.data,
      ),
    );

    const advanced = advanceGame(state, 4_125, "foreground");

    expect(advanced.state.infrastructure.workloads?.[0]?.runtime.rewardIssued).toBe(
      true,
    );
    const reward = getClusterWorkloadDefinition("replicatedShardCommit").rewards
      .credits;
    expect(advanced.state.exactResources.credits).toBe(reward);
    expect(advanced.intervalReport.creditsSpent).toBe(
      amountAdd(operatingCost, hostPowerCost),
    );
    expect(advanced.intervalReport.creditsEarned).toBe(reward);
    expect(advanced.intervalReport.completionEvents).toHaveLength(1);
  });

  it("honors the departure snapshot and safely pauses facility work without Rack Controller", () => {
    const built = buildRackedCluster(2);
    const started = applyAction(built.state, {
      type: "startClusterWorkload",
      clusterId: built.clusterId,
      definitionId: "replicatedShardCommit",
    });
    const state: GameState = {
      ...started,
      automationBuffer: {
        ...started.automationBuffer,
        ownedLevelId: "rackController",
        departureLevelId: "clusterController",
      },
    };
    const runtimeBefore = state.infrastructure.workloads?.[0]?.runtime;
    const creditsBefore = state.exactResources.credits;
    const advanced = advanceGame(state, 1_000, "offline");

    expect(advanced.state.infrastructure.workloads?.[0]?.runtime).toEqual(
      runtimeBefore,
    );
    expect(advanced.state.exactResources.credits).toBe(creditsBefore);
    expect(advanced.intervalReport.productiveMs).toBe(0);
    expect(advanced.intervalReport.pausedMs).toBe(1_000);
    expect(advanced.intervalReport.blockers).toContain(
      "Rack Controller automation is required for facility-backed workloads.",
    );
  });

  it("pauses only under-capability facility work while a safe standing order continues", () => {
    const built = buildRackedCluster(2);
    let state = applyAction(built.state, {
      type: "startClusterWorkload",
      clusterId: built.clusterId,
      definitionId: "replicatedShardCommit",
    });
    state = {
      ...state,
      flags: { ...state.flags, cron: true },
      automationBuffer: {
        ...state.automationBuffer,
        departureLevelId: "clusterController",
      },
    };
    state = applyAction(state, {
      type: "setStandingOrder",
      taskId: "fetchBit",
      systemId: 1,
    });
    const clusterRuntimeBefore = state.infrastructure.workloads?.[0]?.runtime;
    const advanced = advanceGame(state, 5_000, "offline");

    expect(advanced.state.completedTasks.fetchBit).toBeGreaterThan(0);
    expect(advanced.report.standingOrderRenewals).toBeGreaterThan(0);
    expect(advanced.state.infrastructure.workloads?.[0]?.runtime).toEqual(
      clusterRuntimeBefore,
    );
    expect(
      advanced.state.infrastructure.workloads?.[0]?.blockers,
    ).toContain(
      "Rack Controller automation is required for facility-backed workloads.",
    );
    expect(advanced.report.blockers).toContain(
      "Rack Controller automation is required for facility-backed workloads.",
    );
  });

  it("admits workloads deterministically at facility headroom and blocks overflow", () => {
    const built = buildRackedCluster(1);
    let state = built.state;
    for (let index = 0; index < 7; index += 1) {
      state = applyAction(state, {
        type: "startClusterWorkload",
        clusterId: built.clusterId,
        definitionId: "fabricIntegritySweep",
      });
    }

    expect(state.infrastructure.workloads).toHaveLength(7);
    const blocker = getClusterWorkloadStartBlockedReason(
      state,
      built.clusterId,
      "fabricIntegritySweep",
    );
    expect(blocker).toContain("compute headroom");

    const attempted = applyAction(state, {
      type: "startClusterWorkload",
      clusterId: built.clusterId,
      definitionId: "fabricIntegritySweep",
    });
    expect(attempted.infrastructure.workloads).toHaveLength(7);
  });
});
