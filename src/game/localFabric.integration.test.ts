import { describe, expect, it } from "vitest";
import { exactResourceBag } from "./amount";
import { updateCampaignProgress } from "./campaign";
import {
  getClusterWorkloadAllocatedRates,
  getClusterWorkloadStartBlockedReason,
} from "./distributedDefinitions";
import { withExactResources } from "./economy";
import { createInitialGameState } from "./progression";
import { deserializeSave, serializeSave } from "./save";
import { advanceGame } from "./advance";
import { deriveVisibleState } from "./selectors";
import { applyAction } from "./simulation";
import type {
  GameState,
} from "./types";
import type {
  NetworkSkuId,
  StorageSkuId,
} from "./infrastructureTypes";

const localFabricState = () => {
  const initial = createInitialGameState();
  return withExactResources(
    {
      ...initial,
      campaign: {
        ...initial.campaign,
        currentChapterId: "localFabric",
        currentObjectiveId: "fabric:cluster-controller",
      },
      automationBuffer: {
        ...initial.automationBuffer,
        ownedLevelId: "clusterController",
        departureLevelId: "clusterController",
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

const purchaseWorkshopNode = (
  state: GameState,
  storageSkuId: StorageSkuId = "localSsd",
  networkSkuId: NetworkSkuId = "gigabitNic",
) =>
  applyAction(state, {
    type: "purchaseAggregateServerBatch",
    skuId: "workshopServer",
    count: 1,
    storageSkuId,
    networkSkuId,
  });

const addWorkshopNodes = (
  input: GameState,
  count: number,
  storageSkuId: StorageSkuId = "localSsd",
  networkSkuId: NetworkSkuId = "gigabitNic",
) => {
  let state = input;
  for (let index = 0; index < count; index += 1) {
    state = purchaseWorkshopNode(state, storageSkuId, networkSkuId);
  }
  return state;
};

const managedNodeIds = (state: GameState) =>
  (state.infrastructure.fleetNodes ?? [])
    .filter((node) => node.managed)
    .map((node) => node.id);

const commission = (
  state: GameState,
  name: string,
  nodeIds: string[],
  replicaFaultDomain: "node" | "rack" | "zone" = "node",
) =>
  applyAction(state, {
    type: "commissionCluster",
    name,
    nodeIds,
    replicaFaultDomain,
  });

const replicatedWorkReady = () => {
  let state = addWorkshopNodes(localFabricState(), 2);
  state = commission(state, "Fabric", managedNodeIds(state));
  const clusterId = state.infrastructure.clusters[0]!.id;
  state = applyAction(state, {
    type: "startClusterWorkload",
    clusterId,
    definitionId: "replicatedShardCommit",
  });
  return { state, clusterId };
};

describe("Local Fabric vertical slice", () => {
  it("requires the departure Cluster Controller for every distributed workload", () => {
    const ready = replicatedWorkReady().state;
    const belowGate: GameState = {
      ...ready,
      automationBuffer: {
        ...ready.automationBuffer,
        departureLevelId: "fleetOrchestrator",
      },
    };
    const runtimeBefore = belowGate.infrastructure.workloads?.[0]?.runtime;
    const creditsBefore = belowGate.exactResources.credits;

    const blocked = advanceGame(belowGate, 1_000, "offline");

    expect(blocked.state.infrastructure.workloads?.[0]?.runtime).toEqual(
      runtimeBefore,
    );
    expect(blocked.state.exactResources.credits).toBe(creditsBefore);
    expect(blocked.intervalReport.productiveMs).toBe(0);
    expect(blocked.intervalReport.blockers).toContain(
      "Cluster Controller automation is required for distributed workloads.",
    );

    const covered = advanceGame(ready, 1_000, "offline");
    expect(covered.state.infrastructure.workloads?.[0]?.runtime).not.toEqual(
      runtimeBefore,
    );
    expect(covered.intervalReport.productiveMs).toBe(1_000);
  });

  it("starts through public actions with stable distinct-domain placement and real reservations", () => {
    const { state, clusterId } = replicatedWorkReady();
    const workload = state.infrastructure.workloads?.[0];
    const wholeGameVisible = deriveVisibleState(state);
    const visible = wholeGameVisible.infrastructure;
    const visibleCluster = visible.clusters.find((cluster) => cluster.id === clusterId)!;
    const visibleWorkload = visible.workloads[0]!;

    expect(workload?.kind).toBe("distributed");
    expect(workload?.placements.map((placement) => placement.nodeId)).toEqual([
      "fleet-node-2",
      "fleet-node-3",
    ]);
    expect(
      new Set(workload?.placements.map((placement) => placement.faultDomainId)).size,
    ).toBe(2);
    expect(visibleCluster.reserved.rates.compute).toBe("1000000");
    expect(visibleCluster.reserved.memoryBits).toBe("2000000");
    expect(visibleCluster.reserved.storageBits).toBe("8000000");
    expect(visibleCluster.utilizationBps).toBe(5_000);
    expect(visibleCluster.headroomBps).toBe(5_000);
    expect(visibleWorkload.projection.durationMs).toBe("4125");
    expect(visibleWorkload.blockers).toEqual([]);
    expect(
      wholeGameVisible.activeWork.some(
        (work) => work.kind === "clusterWorkload" && work.name === visibleWorkload.name,
      ),
    ).toBe(true);
  });

  it("keeps the barrier atomic, attributes the interval completion, and advances campaign mechanically", () => {
    const { state } = replicatedWorkReady();
    const beforeObjective = updateCampaignProgress(state);
    const almost = advanceGame(beforeObjective, 4_124, "foreground");
    const completed = advanceGame(almost.state, 1, "foreground");
    const almostWorkload = almost.state.infrastructure.workloads?.[0];
    const completedWorkload = completed.state.infrastructure.workloads?.[0];
    if (almostWorkload?.kind !== "distributed") {
      throw new Error("Expected distributed workload before commit");
    }
    if (completedWorkload?.kind !== "distributed") {
      throw new Error("Expected distributed workload after commit");
    }

    expect(beforeObjective.campaign.currentObjectiveId).toBe(
      "fabric:cluster-controller",
    );
    expect(almostWorkload.runtime.rewardIssued).toBe(false);
    expect(almostWorkload.runtime.plan.finalOutputBits).toBe("250000");
    expect(almost.intervalReport.completionEvents).toEqual([]);
    expect(completedWorkload.runtime.rewardIssued).toBe(true);
    expect(completed.state.infrastructure.successfulShardCommits).toBe(1);
    expect(completed.state.infrastructure.replicaDomainCommits).toBe(1);
    expect(completed.state.campaign.currentObjectiveId).toBe(
      "facility:rack-controller",
    );
    expect(completed.intervalReport.completedClusterWork).toEqual({
      replicatedShardCommit: 1,
    });
    expect(completed.intervalReport.completionEvents).toEqual([
      {
        source: "cluster",
        instanceId: "workload-5",
        workId: "replicatedShardCommit",
        clusterId: "cluster-4",
        creditsEarned: "11750000",
        dataEarned: "50",
      },
    ]);
    expect(completed.intervalReport.creditsEarned).toBe("11750000");
    // 0.0005 workload+facility operating cost plus 0.0001 host-system metered
    // power (0.1 cr/s x 1 ms).
    expect(completed.intervalReport.creditsSpent).toBe("0.0006");
  });

  it("is delta invariant and save-v7 round-trips runtime and payout markers", () => {
    const { state } = replicatedWorkReady();
    const single = advanceGame(state, 4_125, "foreground").state;
    let chunked = state;
    for (const delta of [1_000, 2_000, 1_125]) {
      chunked = advanceGame(chunked, delta, "foreground").state;
    }
    const loaded = deserializeSave(serializeSave(chunked, 10_000));

    expect(chunked.exactResources).toEqual(single.exactResources);
    expect(chunked.infrastructure.workloads).toEqual(single.infrastructure.workloads);
    expect(chunked.infrastructure.completedWorkloadCounts).toEqual(
      single.infrastructure.completedWorkloadCounts,
    );
    expect(chunked.infrastructure.completionEvents).toEqual(
      single.infrastructure.completionEvents,
    );
    expect(loaded.infrastructure.workloads).toEqual(chunked.infrastructure.workloads);
    expect(loaded.infrastructure.completedWorkloadCounts).toEqual({
      replicatedShardCommit: 1,
    });
    expect(loaded.infrastructure.nextCompletionSequence).toBe(2);
  });

  it("migrates a legacy flat cluster payout from exact saved plan work", () => {
    const ready = replicatedWorkReady().state;
    const workload = ready.infrastructure.workloads?.[0];
    if (!workload || workload.kind !== "distributed") {
      throw new Error("Expected a distributed replicated workload");
    }
    const legacy: GameState = {
      ...ready,
      infrastructure: {
        ...ready.infrastructure,
        workloads: [{
          ...workload,
          paidWorkUnits: undefined,
          workValueMultiplier: undefined,
          runtime: {
            ...workload.runtime,
            plan: {
              ...workload.runtime.plan,
              reward: exactResourceBag("500", "50"),
            },
          },
        }],
      },
    };

    const completed = advanceGame(legacy, 4_125, "foreground");
    expect(completed.intervalReport.creditsEarned).toBe("11750000");
    expect(completed.intervalReport.completionEvents?.[0]).toMatchObject({
      workId: "replicatedShardCommit",
      creditsEarned: "11750000",
      dataEarned: "50",
    });
  });

  it("blocks missing storage/network and enforces the configured replica fault domain", () => {
    let missingFabric = addWorkshopNodes(
      localFabricState(),
      2,
      "storageNone",
      "networkNone",
    );
    missingFabric = commission(
      missingFabric,
      "No IO",
      managedNodeIds(missingFabric),
    );
    const missingClusterId = missingFabric.infrastructure.clusters[0]!.id;
    const missingReason = getClusterWorkloadStartBlockedReason(
      missingFabric,
      missingClusterId,
      "replicatedShardCommit",
    );
    const missingAttempt = applyAction(missingFabric, {
      type: "startClusterWorkload",
      clusterId: missingClusterId,
      definitionId: "replicatedShardCommit",
    });

    let rackFabric = addWorkshopNodes(
      {
        ...localFabricState(),
        projects: {
          ...localFabricState().projects,
          completedProjectIds: ["archivist"],
        },
      },
      2,
    );
    rackFabric = commission(
      rackFabric,
      "Rack Policy",
      managedNodeIds(rackFabric),
      "rack",
    );
    const rackClusterId = rackFabric.infrastructure.clusters[0]!.id;
    const rackReason = getClusterWorkloadStartBlockedReason(
      rackFabric,
      rackClusterId,
      "replicatedShardCommit",
    );

    expect(missingReason).toBe(
      "Insufficient cluster compute, memory, storage, or network capacity.",
    );
    expect(missingAttempt.infrastructure.workloads).toEqual([]);
    expect(rackReason).toBe("Requires 2 distinct rack fault domains.");
    const nodePolicy = applyAction(rackFabric, {
      type: "setClusterPolicy",
      clusterId: rackClusterId,
      replicaFaultDomain: "node",
    });
    const started = applyAction(nodePolicy, {
      type: "startClusterWorkload",
      clusterId: rackClusterId,
      definitionId: "replicatedShardCommit",
    });
    expect(started.infrastructure.workloads).toHaveLength(1);
  });

  it("honors workload weights and cluster headroom, then cancels through public actions", () => {
    let state = addWorkshopNodes(localFabricState(), 1);
    state = commission(state, "Weighted", managedNodeIds(state));
    const clusterId = state.infrastructure.clusters[0]!.id;
    state = applyAction(state, {
      type: "startClusterWorkload",
      clusterId,
      definitionId: "fabricIntegritySweep",
      weight: 1,
    });
    state = applyAction(state, {
      type: "startClusterWorkload",
      clusterId,
      definitionId: "fabricIntegritySweep",
      weight: 3,
    });
    const workloads = state.infrastructure.workloads!;
    const full = getClusterWorkloadAllocatedRates(state);

    expect(full[workloads[0]!.id]!.compute).toBe("250000");
    expect(full[workloads[1]!.id]!.compute).toBe("750000");

    state = applyAction(state, {
      type: "setClusterPolicy",
      clusterId,
      reserveHeadroomBps: 5_000,
    });
    const reserved = getClusterWorkloadAllocatedRates(state);
    expect(reserved[workloads[0]!.id]!.compute).toBe("125000");
    expect(reserved[workloads[1]!.id]!.compute).toBe("375000");

    state = applyAction(state, {
      type: "setClusterWorkloadWeight",
      workloadId: workloads[1]!.id,
      weight: 4,
    });
    expect(state.infrastructure.workloads?.[1]?.weight).toBe(4);
    state = applyAction(state, {
      type: "cancelClusterWorkload",
      workloadId: workloads[0]!.id,
    });
    expect(state.infrastructure.workloads?.map((workload) => workload.id)).toEqual([
      workloads[1]!.id,
    ]);
  });

  it("offline-pauses only an affected workload while unrelated cluster work completes", () => {
    let state = addWorkshopNodes(localFabricState(), 3);
    const nodes = managedNodeIds(state);
    state = commission(state, "Detached", nodes.slice(0, 2));
    const firstClusterId = state.infrastructure.clusters[0]!.id;
    state = commission(state, "Healthy", nodes.slice(2));
    const secondClusterId = state.infrastructure.clusters[1]!.id;
    state = applyAction(state, {
      type: "startClusterWorkload",
      clusterId: firstClusterId,
      definitionId: "replicatedShardCommit",
    });
    state = applyAction(state, {
      type: "startClusterWorkload",
      clusterId: secondClusterId,
      definitionId: "fabricIntegritySweep",
    });
    state = applyAction(state, {
      type: "setClusterNodes",
      clusterId: firstClusterId,
      nodeIds: [],
    });

    const advanced = advanceGame(state, 3_000, "offline");
    const replicated = advanced.state.infrastructure.workloads?.find(
      (workload) => workload.definitionId === "replicatedShardCommit",
    );
    const sweep = advanced.state.infrastructure.workloads?.find(
      (workload) => workload.definitionId === "fabricIntegritySweep",
    );

    expect(replicated?.runtime.rewardIssued).toBe(false);
    expect(replicated?.blockers[0]).toContain("no longer in the cluster");
    expect(sweep?.runtime.rewardIssued).toBe(true);
    expect(advanced.intervalReport.completedClusterWork).toEqual({
      fabricIntegritySweep: 1,
    });
    expect(advanced.intervalReport.completionEvents?.[0]?.workId).toBe(
      "fabricIntegritySweep",
    );
    expect(advanced.intervalReport.blockers).toContain(
      "Active infrastructure is safely paused.",
    );
    expect(advanced.intervalReport.productiveMs).toBe(2_000);
    expect(advanced.intervalReport.pausedMs).toBe(1_000);
  });
});
