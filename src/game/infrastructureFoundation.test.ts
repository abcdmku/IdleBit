import { describe, expect, it } from "vitest";
import {
  amount,
  amountSubtract,
  exactResourceBag,
} from "./amount";
import {
  addCapacityProfiles,
  createEmptyCapacityProfile,
  deriveAggregateServerCapacityProfile,
  deriveSystemCapacityProfile,
  scaleCapacityProfile,
} from "./capacity";
import { withExactResources } from "./economy";
import {
  getAggregateServerBatchCosts,
  normalizeInfrastructureState,
} from "./fleet";
import { createInitialGameState } from "./progression";
import { deserializeSave, serializeSave } from "./save";
import { deriveVisibleState } from "./selectors";
import { applyAction } from "./simulation";
import type {
  CapacityProfile,
  InfrastructureState,
} from "./infrastructureTypes";
import type { GameState } from "./types";

const hugeFund = (state: GameState) =>
  withExactResources(state, exactResourceBag("1e309", "1e309"));

const fleetReady = () => {
  const initial = createInitialGameState();
  return hugeFund({
    ...initial,
    campaign: {
      ...initial.campaign,
      currentChapterId: "workshopFleet",
      currentObjectiveId: "fleet:catalog",
    },
    flags: { ...initial.flags, systemCatalog: true },
    research: {
      ...initial.research,
      completed: ["systemCatalog"],
    },
  });
};

const clusterReady = (): GameState => {
  const state = fleetReady();
  return {
    ...state,
    automationBuffer: {
      ...state.automationBuffer,
      ownedLevelId: "clusterController",
    },
    projects: {
      ...state.projects,
      completedProjectIds: ["archivist"],
    },
  };
};

const aggregateProfile = (compute: string): CapacityProfile => ({
  ...createEmptyCapacityProfile(),
  rates: {
    ...createEmptyCapacityProfile().rates,
    compute: amount(compute),
  },
  memoryBits: amount(compute),
  storageBits: amount(compute),
  idleWatts: amount(compute),
  peakWatts: amount(compute),
});

describe("Infrastructure and Fleet capacity foundation", () => {
  it("aggregates CapacityProfile Amounts safely beyond Number range", () => {
    const one = aggregateProfile("1e309");
    const three = scaleCapacityProfile(one, 3);
    const four = addCapacityProfiles(one, three);

    expect(three.rates.compute).toBe(amount("3e309"));
    expect(three.memoryBits).toBe(amount("3e309"));
    expect(three.storageBits).toBe(amount("3e309"));
    expect(three.peakWatts).toBe(amount("3e309"));
    expect(four.rates.compute).toBe(amount("4e309"));
  });

  it("derives deterministic inspected capacity and matches the starter aggregate SKU", () => {
    const state = createInitialGameState();
    const first = deriveSystemCapacityProfile(state, 1);
    const replay = deriveSystemCapacityProfile(state, 1);
    const aggregate = deriveAggregateServerCapacityProfile(
      "starterServer",
      1,
      "storageNone",
      "networkNone",
    );

    expect(first).toEqual(replay);
    expect(first).toEqual(aggregate);
    expect(first.rates.compute).toBe("1");
    expect(first.idleWatts).toBe("0.0000001");
    expect(first.peakWatts).toBe("0.0000002");
  });

  it("gates Fleet and cluster actions behind progression and exposes blockers", () => {
    const opening = hugeFund(createInitialGameState());
    const aggregateAttempt = applyAction(opening, {
      type: "purchaseAggregateServerBatch",
      skuId: "starterServer",
      count: 1,
    });
    const clusterAttempt = applyAction(opening, {
      type: "commissionCluster",
      name: "Too Early",
      nodeIds: [],
    });
    const visible = deriveVisibleState(opening);

    expect(aggregateAttempt.infrastructure.fleetNodes).toHaveLength(1);
    expect(clusterAttempt.infrastructure.clusters).toEqual([]);
    expect(visible.infrastructure.fleet.blockers).toContain("Requires Workshop Fleet.");
  });

  it("requires idle inspected systems and rejects legacy work and hardware actions while managed", () => {
    const ready = fleetReady();
    const busy = applyAction(ready, { type: "startTask", taskId: "fetchBit" });
    const busyAttempt = applyAction(busy, {
      type: "setSystemManaged",
      systemId: 1,
      managed: true,
    });
    expect(busyAttempt.infrastructure.fleetNodes[0]?.managed).toBe(false);

    const managed = applyAction(ready, {
      type: "setSystemManaged",
      systemId: 1,
      managed: true,
    });
    const taskAttempt = applyAction(managed, {
      type: "startTask",
      taskId: "fetchBit",
      systemId: 1,
    });
    const cacheAttempt = applyAction(managed, {
      type: "buyUpgrade",
      upgradeId: "cache",
      cpuId: 1,
      systemId: 1,
    });
    const powerAttempt = applyAction(managed, {
      type: "requestPowerOff",
      systemId: 1,
    });

    expect(managed.infrastructure.fleetNodes[0]?.managed).toBe(true);
    expect(taskAttempt.activeTasks).toEqual([]);
    expect(cacheAttempt.hardware.cacheLevel).toBe(managed.hardware.cacheLevel);
    expect(powerAttempt.power.state).toBe("on");

    const unmanaged = applyAction(managed, {
      type: "setSystemManaged",
      systemId: 1,
      managed: false,
    });
    const taskStarted = applyAction(unmanaged, {
      type: "startTask",
      taskId: "fetchBit",
      systemId: 1,
    });
    expect(taskStarted.activeTasks).toHaveLength(1);
  });

  it("purchases aggregate batches with exact costs without consuming rack IDs", () => {
    const before = fleetReady();
    const rackNextSystemId = before.rack.nextSystemId;
    const costs = getAggregateServerBatchCosts(
      "starterServer",
      3,
      "storageNone",
      "networkNone",
    );
    const after = applyAction(before, {
      type: "purchaseAggregateServerBatch",
      skuId: "starterServer",
      count: 3,
      storageSkuId: "storageNone",
      networkSkuId: "networkNone",
    });
    const creditCost = costs.find((cost) => cost.resource === "credits")!.amount;
    const dataCost = costs.find((cost) => cost.resource === "data")!.amount;
    const aggregate = after.infrastructure.fleetNodes.find(
      (node) => node.source.kind === "aggregate",
    );

    expect(aggregate?.source).toEqual({
      kind: "aggregate",
      skuId: "starterServer",
      count: 3,
    });
    expect(aggregate?.managed).toBe(true);
    expect(after.exactResources.credits).toBe(
      amountSubtract(before.exactResources.credits, creditCost),
    );
    expect(after.exactResources.data).toBe(
      amountSubtract(before.exactResources.data, dataCost),
    );
    expect(after.rack.nextSystemId).toBe(rackNextSystemId);
  });

  it("automatically wraps newly purchased inspected systems with stable Fleet IDs", () => {
    const before = fleetReady();
    const after = applyAction(before, {
      type: "buyMachineTemplate",
      templateId: "barebonesPc",
    });
    const wrappedSystemIds = after.infrastructure.fleetNodes
      .filter((node) => node.source.kind === "system")
      .map((node) => (node.source.kind === "system" ? node.source.systemId : 0));

    expect(after.systems).toHaveLength(2);
    expect(wrappedSystemIds).toEqual([1, 2]);
    expect(after.infrastructure.fleetNodes.map((node) => node.id)).toEqual([
      "fleet-node-1",
      "fleet-node-2",
    ]);
  });

  it("commissions clusters from managed nodes, clamps policy, and preserves omitted fields", () => {
    let state = clusterReady();
    state = applyAction(state, {
      type: "setSystemManaged",
      systemId: 1,
      managed: true,
    });
    state = applyAction(state, {
      type: "purchaseAggregateServerBatch",
      skuId: "starterServer",
      count: 2,
    });
    const nodeIds = state.infrastructure.fleetNodes.map((node) => node.id);
    state = applyAction(state, {
      type: "commissionCluster",
      name: "Local Fabric",
      nodeIds: [...nodeIds, nodeIds[0]!, "dangling-node"],
      defaultWeight: 150,
      reserveHeadroomBps: 1_000,
      replicaFaultDomain: "rack",
    });
    const clusterId = state.infrastructure.clusters[0]!.id;
    state = applyAction(state, {
      type: "setClusterPolicy",
      clusterId,
      defaultWeight: 9,
    });

    expect(state.infrastructure.clusters[0]).toEqual(
      expect.objectContaining({
        name: "Local Fabric",
        nodeIds,
        policy: {
          defaultWeight: 9,
          reserveHeadroomBps: 1_000,
          replicaFaultDomain: "rack",
        },
      }),
    );

    const visible = deriveVisibleState(state);
    expect(visible.infrastructure.clusters[0]?.reserved.rates.compute).toBe("0");
    expect(visible.infrastructure.clusters[0]?.utilizationBps).toBe(0);
    expect(visible.infrastructure.clusters[0]?.headroomBps).toBe(9_000);
    expect(visible.infrastructure.clusters[0]?.available.rates.compute).toBe("2.7");
  });

  it("keeps replica-domain policy node-scoped until The Archivist is complete", () => {
    let blocked = clusterReady();
    blocked = {
      ...blocked,
      projects: { ...blocked.projects, completedProjectIds: [] },
    };
    blocked = applyAction(blocked, {
      type: "commissionCluster",
      name: "Pre-Archivist",
      nodeIds: [],
      replicaFaultDomain: "zone",
    });
    const clusterId = blocked.infrastructure.clusters[0]!.id;
    expect(blocked.infrastructure.clusters[0]?.policy.replicaFaultDomain).toBe(
      "node",
    );

    const rejected = applyAction(blocked, {
      type: "setClusterPolicy",
      clusterId,
      replicaFaultDomain: "rack",
    });
    expect(rejected.infrastructure.clusters[0]?.policy.replicaFaultDomain).toBe(
      "node",
    );

    const unlocked = applyAction(
      {
        ...rejected,
        projects: {
          ...rejected.projects,
          completedProjectIds: ["archivist"],
        },
      },
      {
        type: "setClusterPolicy",
        clusterId,
        replicaFaultDomain: "zone",
      },
    );
    expect(unlocked.infrastructure.clusters[0]?.policy.replicaFaultDomain).toBe(
      "zone",
    );

    const loaded = deserializeSave(serializeSave(unlocked));
    expect(loaded.infrastructure.clusters[0]?.policy.replicaFaultDomain).toBe(
      "zone",
    );
  });

  it("detaches cluster membership when a system is unmanaged", () => {
    let state = clusterReady();
    state = applyAction(state, {
      type: "setSystemManaged",
      systemId: 1,
      managed: true,
    });
    state = applyAction(state, {
      type: "commissionCluster",
      name: "Detach Test",
      nodeIds: ["fleet-node-1"],
    });
    state = applyAction(state, {
      type: "setSystemManaged",
      systemId: 1,
      managed: false,
    });

    expect(state.infrastructure.clusters[0]?.nodeIds).toEqual([]);
  });

  it("keeps installed totals but excludes unsafe managed systems from available capacity", () => {
    let state = fleetReady();
    state = applyAction(state, {
      type: "setSystemManaged",
      systemId: 1,
      managed: true,
    });
    state = applyAction(state, {
      type: "purchaseAggregateServerBatch",
      skuId: "starterServer",
      count: 2,
    });
    state = {
      ...state,
      power: { ...state.power, state: "off" },
      systems: state.systems.map((system) =>
        system.id === 1
          ? { ...system, power: { ...system.power, state: "off" } }
          : system,
      ),
    };
    const visible = deriveVisibleState(state).infrastructure.fleet;

    expect(visible.total.rates.compute).toBe("3");
    expect(visible.available.rates.compute).toBe("2");
    expect(visible.nodes.find((node) => node.id === "fleet-node-1")?.blocker).toContain(
      "power state is off",
    );
  });

  it("normalizes invalid IDs, counts, policies, and dangling references deterministically", () => {
    const ready = clusterReady();
    const corrupted: InfrastructureState = {
      elapsedMs: Number.POSITIVE_INFINITY,
      nextEntityId: -5,
      fleetNodes: [
        {
          id: "invalid-node",
          source: { kind: "system", systemId: 1 },
          managed: true,
          rackId: null,
          storageSkuId: "storageNone",
          networkSkuId: "networkNone",
        },
        {
          id: "fleet-node-7",
          source: { kind: "aggregate", skuId: "starterServer", count: 9_999_999 },
          managed: true,
          rackId: null,
          storageSkuId: "storageNone",
          networkSkuId: "networkNone",
        },
      ],
      clusters: [
        {
          id: "cluster-8",
          name: "  Normalized  ",
          nodeIds: ["fleet-node-7", "fleet-node-7", "dangling"],
          policy: {
            defaultWeight: 999,
            reserveHeadroomBps: -1,
            replicaFaultDomain: "zone",
          },
        },
      ],
      facilities: [],
    };
    const normalized = normalizeInfrastructureState(corrupted, ready.systems);
    const restored = deserializeSave(
      serializeSave({ ...ready, infrastructure: corrupted }, 50_000),
    );

    expect(normalized.elapsedMs).toBe(0);
    expect(normalized.fleetNodes.map((node) => node.id)).toEqual([
      "fleet-node-1",
      "fleet-node-7",
    ]);
    expect(normalized.fleetNodes[1]?.source).toEqual({
      kind: "aggregate",
      skuId: "starterServer",
      count: 1_000_000,
    });
    expect(normalized.clusters[0]).toEqual(
      expect.objectContaining({
        name: "Normalized",
        nodeIds: ["fleet-node-7"],
        policy: {
          defaultWeight: 100,
          reserveHeadroomBps: 0,
          replicaFaultDomain: "zone",
        },
      }),
    );
    expect(normalized.nextEntityId).toBe(9);
    expect(restored.infrastructure).toEqual(normalized);
  });

  it("round-trips authoritative actions and normalized references through save v7", () => {
    let state = clusterReady();
    state = applyAction(state, {
      type: "setSystemManaged",
      systemId: 1,
      managed: true,
    });
    state = applyAction(state, {
      type: "purchaseAggregateServerBatch",
      skuId: "starterServer",
      count: 2,
    });
    state = applyAction(state, {
      type: "commissionCluster",
      name: "Save Cluster",
      nodeIds: state.infrastructure.fleetNodes.map((node) => node.id),
      defaultWeight: 4,
      reserveHeadroomBps: 500,
    });
    const restored = deserializeSave(serializeSave(state, 99_000));

    expect(restored.infrastructure).toEqual(state.infrastructure);
    expect(restored.rng).toEqual(state.rng);
    expect(restored.rack).toEqual(state.rack);
    expect(restored.infrastructure.fleetNodes).toHaveLength(
      state.infrastructure.fleetNodes.length,
    );
  });
});
