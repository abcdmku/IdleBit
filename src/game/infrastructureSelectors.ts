import {
  createEmptyCapacityProfile,
  getCapacityUtilizationBps,
  getFleetNodeCapacityName,
  getFleetNodeCapacityProfile,
  scaleCapacityProfile,
  subtractCapacityProfiles,
  sumCapacityProfiles,
} from "./capacity";
import {
  getClusterManagementBlockedReason,
  getFleetManagementBlockedReason,
  getSystemManagementBlockedReason,
} from "./fleet";
import {
  deriveFacilityCloudEffectiveCompute,
  getFacilityInfrastructureBlockedReason,
  normalizeFacilityInfrastructureForGameState,
} from "./facilityInfrastructure";
import { getFacilitySnapshot } from "./facilities";
import { getPsuStress } from "./math";
import { materializeSystem } from "./systems";
import type {
  CapacityProfile,
  VisibleCapacityPool,
  VisibleClusterState,
  VisibleInfrastructureState,
} from "./infrastructureTypes";
import type { GameState } from "./types";

const getVisiblePool = (
  total: CapacityProfile,
  reserved = createEmptyCapacityProfile(),
  available = subtractCapacityProfiles(total, reserved),
): VisibleCapacityPool => {
  const utilizationBps = getCapacityUtilizationBps(total, reserved);
  const unavailable = subtractCapacityProfiles(total, available);
  const unavailableBps = getCapacityUtilizationBps(total, unavailable);
  return {
    total,
    reserved,
    available,
    utilizationBps,
    headroomBps: Math.max(0, 10_000 - unavailableBps),
  };
};

const getManagedNodeRuntimeBlocker = (
  state: GameState,
  source: VisibleInfrastructureState["fleet"]["nodes"][number]["source"],
) => {
  if (source.kind === "aggregate") return null;
  const system = state.systems.find((candidate) => candidate.id === source.systemId);
  if (!system) return "Inspected system is missing.";
  if (system.power.state !== "on") {
    return `System power state is ${system.power.state}.`;
  }
  if (getPsuStress(materializeSystem(state, source.systemId)) > 1) {
    return "System exceeds safe PSU capacity.";
  }
  return null;
};

export const getVisibleInfrastructureState = (
  input: GameState,
): VisibleInfrastructureState => {
  const state = normalizeFacilityInfrastructureForGameState(input);
  const fleetGate = getFleetManagementBlockedReason(state);
  const nodes = state.infrastructure.fleetNodes.map((node) => {
    const systemBlocker =
      node.source.kind === "system" && !node.managed
        ? getSystemManagementBlockedReason(state, node.source.systemId)
        : null;
    const blocker = node.managed
      ? getManagedNodeRuntimeBlocker(state, node.source)
      : fleetGate ?? systemBlocker ?? "Node is not managed by Fleet capacity.";
    return {
      id: node.id,
      name: getFleetNodeCapacityName(state, node),
      source: node.source,
      managed: node.managed,
      storageSkuId: node.storageSkuId,
      networkSkuId: node.networkSkuId,
      capacity: getFleetNodeCapacityProfile(state, node),
      blocker,
    };
  });
  const total = sumCapacityProfiles(
    nodes.filter((node) => node.managed).map((node) => node.capacity),
  );
  const fleetAvailable = sumCapacityProfiles(
    nodes
      .filter((node) => node.managed && node.blocker === null)
      .map((node) => node.capacity),
  );
  const fleetPool = getVisiblePool(
    total,
    createEmptyCapacityProfile(),
    fleetAvailable,
  );
  const fleetBlockers = [
    ...(fleetGate ? [fleetGate] : []),
    ...nodes.flatMap((node) => (node.blocker ? [`${node.name}: ${node.blocker}`] : [])),
  ];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const clusterGate = getClusterManagementBlockedReason(state);
  const clusters: VisibleClusterState[] = state.infrastructure.clusters.map(
    (cluster) => {
      const clusterNodes = cluster.nodeIds
        .map((nodeId) => nodesById.get(nodeId))
        .filter((node): node is NonNullable<typeof node> => Boolean(node?.managed));
      const clusterTotal = sumCapacityProfiles(
        clusterNodes.map((node) => node.capacity),
      );
      const safeCapacity = sumCapacityProfiles(
        clusterNodes
          .filter((node) => node.blocker === null)
          .map((node) => node.capacity),
      );
      const policyAvailable = scaleCapacityProfile(
        safeCapacity,
        (10_000 - cluster.policy.reserveHeadroomBps) / 10_000,
      );
      const blockers = [
        ...(clusterGate ? [clusterGate] : []),
        ...(cluster.nodeIds.length === 0 ? ["Cluster has no managed nodes."] : []),
        ...cluster.nodeIds.flatMap((nodeId) => {
          const node = nodesById.get(nodeId);
          if (!node?.managed) return [`${nodeId} is unavailable or unmanaged.`];
          return node.blocker ? [`${node.name}: ${node.blocker}`] : [];
        }),
      ];
      return {
        id: cluster.id,
        name: cluster.name,
        nodeIds: cluster.nodeIds,
        policy: cluster.policy,
        ...getVisiblePool(
          clusterTotal,
          createEmptyCapacityProfile(),
          policyAvailable,
        ),
        blockers,
      };
    },
  );
  const facilityGate = getFacilityInfrastructureBlockedReason(state);
  const facilities = state.infrastructure.facilities.map((facility) => {
    const snapshot = getFacilitySnapshot(facility);
    return {
      ...snapshot,
      racks: snapshot.racks.map((rack) => ({
        ...rack,
        nodeIds:
          facility.racks
            .find((candidate) => candidate.id === rack.id)
            ?.placements.map((placement) => placement.equipment.id) ?? [],
      })),
      cloudCapacityPerSecond: deriveFacilityCloudEffectiveCompute(facility),
      blockers: Array.from(
        new Set([
          ...(facilityGate ? [facilityGate] : []),
          ...(facility.racks.length === 0
            ? ["Facility has no commissioned racks."]
            : []),
        ]),
      ),
    };
  });
  return {
    elapsedMs: state.infrastructure.elapsedMs,
    horizontalTools: {
      archivistReplicaPolicies:
        state.projects.completedProjectIds.includes("archivist"),
      gridReliefOperatingDiscountBps:
        state.projects.completedProjectIds.includes("gridRelief") ? 2_000 : 0,
    },
    fleet: {
      nodes,
      ...fleetPool,
      blockers: Array.from(new Set(fleetBlockers)),
    },
    clusters,
    facilities,
    workloads: [],
    workloadDefinitions: [],
  };
};
