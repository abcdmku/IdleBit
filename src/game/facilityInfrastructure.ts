import {
  amountClampMin,
  amountMultiply,
  amountSubtract,
  sumAmounts,
  type Amount,
} from "./amount";
import { getCampaignChapterIndex } from "./campaign";
import {
  getFleetNodeCapacityName,
  getFleetNodeCapacityProfile,
} from "./capacity";
import {
  getFacilityTemplateDefinition,
  getRackTemplateDefinition,
  type FacilityResourceVector,
  type FacilityTemplateId,
  type RackTemplateId,
} from "./facilityDefinitions";
import {
  commissionRack,
  createFacilityResourceVector,
  createFacilityState,
  getFacilityOperatingCostPerSecond,
  getFacilityPlacementAdmissionBlockers,
  getFacilitySnapshot,
  normalizeFacilityResourceVector,
  normalizeFacilityState,
  placeEquipmentDeterministically,
  rackEquipmentFromFleetCapacity,
  removeEquipmentPlacement,
  type FacilityRackState,
  type FacilityState,
} from "./facilities";
import { canAffordExact, spendExact } from "./economy";
import { normalizeInfrastructureForGameState } from "./fleet";
import type {
  FleetNodeState,
  InfrastructureState,
} from "./infrastructureTypes";
import type { GameAction, GameState } from "./types";

export interface FacilityInfrastructureState extends InfrastructureState {
  facilities: FacilityState[];
}

export type FacilityInfrastructureGameState = Omit<GameState, "infrastructure"> & {
  infrastructure: FacilityInfrastructureState;
};

export interface FacilityInfrastructureMutationResult {
  accepted: boolean;
  state: FacilityInfrastructureGameState;
  blockers: string[];
  facilityId: string | null;
  rackId: string | null;
  placementId: string | null;
  nodeId: string | null;
}

export interface FacilityCloudZoneSource {
  facilityId: string;
  capacityPerSecond: Amount;
}

const automationLevelOrder = [
  "startingNode",
  "localScheduler",
  "cronRuntime",
  "systemScheduler",
  "fleetOrchestrator",
  "clusterController",
  "rackController",
  "dataCenterNoc",
  "globalScheduler",
] as const;

const facilityIdPattern = /^facility-([1-9]\d*)$/;
const rackIdPattern = /^rack-([1-9]\d*)$/;

const entityNumber = (id: string) => {
  const match = /-(\d+)$/.exec(id);
  const parsed = match ? Number(match[1]) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
};

const compareEntityIds = (left: string, right: string) =>
  entityNumber(left) - entityNumber(right) || left.localeCompare(right);

const rawFacilities = (state: GameState) => {
  const candidate = (state.infrastructure as unknown as { facilities?: unknown })
    .facilities;
  return Array.isArray(candidate) ? candidate : [];
};

export const qualifyFacilityRackRef = (facilityId: string, rackId: string) =>
  `${facilityId}/${rackId}`;

export const parseQualifiedRackRef = (value: unknown) => {
  if (typeof value !== "string") return null;
  const [facilityId, rackId, extra] = value.split("/");
  if (
    extra !== undefined ||
    !facilityId ||
    !rackId ||
    !facilityIdPattern.test(facilityId) ||
    !rackIdPattern.test(rackId)
  ) {
    return null;
  }
  return { facilityId, rackId };
};

export const getFacilityInfrastructureBlockedReason = (state: GameState) => {
  if (getCampaignChapterIndex(state.campaign.currentChapterId) < 5) {
    return "Requires Rack and Facility.";
  }
  if (
    automationLevelOrder.indexOf(state.automationBuffer.ownedLevelId) <
    automationLevelOrder.indexOf("rackController")
  ) {
    return "Requires Rack Controller automation.";
  }
  return null;
};

export const getFleetNodeActiveWorkloadBlocker = (
  state: GameState,
  nodeId: string,
) =>
  (state.infrastructure.workloads ?? []).some(
    (workload) =>
      !workload.runtime.rewardIssued &&
      workload.placements.some((placement) => placement.nodeId === nodeId),
  )
    ? "Fleet node is reserved by active distributed work."
    : null;

const getFacilityById = (
  state: FacilityInfrastructureGameState,
  facilityId: string,
) => state.infrastructure.facilities.find((facility) => facility.id === facilityId);

const deriveEquipment = (
  state: GameState,
  node: FleetNodeState,
) =>
  rackEquipmentFromFleetCapacity(
    node.id,
    getFleetNodeCapacityName(state, node),
    getFleetNodeCapacityProfile(state, node),
    node.source.kind === "aggregate" ? node.source.count : 1,
  );

const rebuildFacilityPlacements = (
  base: GameState,
  facilities: readonly FacilityState[],
) => {
  const nodesById = new Map(
    base.infrastructure.fleetNodes.map((node) => [node.id, node]),
  );
  const placedNodeIds = new Set<string>();
  const rackRefByNodeId = new Map<string, string>();
  const rebuilt: FacilityState[] = [];

  for (const savedFacility of facilities) {
    let facility: FacilityState = {
      ...savedFacility,
      racks: savedFacility.racks.map((rack) => ({ ...rack, placements: [] })),
    };
    for (const savedRack of savedFacility.racks) {
      for (const savedPlacement of savedRack.placements) {
        const node = nodesById.get(savedPlacement.equipment.id);
        if (!node?.managed || placedNodeIds.has(node.id)) continue;
        const equipment = deriveEquipment(
          { ...base, infrastructure: { ...base.infrastructure, facilities } } as GameState,
          node,
        );
        if (
          getFacilityPlacementAdmissionBlockers(
            facility,
            savedRack.id,
            equipment,
          ).length > 0
        ) {
          continue;
        }
        facility = {
          ...facility,
          racks: facility.racks.map((rack): FacilityRackState =>
            rack.id === savedRack.id
              ? {
                  ...rack,
                  placements: [
                    ...rack.placements,
                    { id: savedPlacement.id, equipment },
                  ],
                }
              : rack,
          ),
        };
        placedNodeIds.add(node.id);
        rackRefByNodeId.set(
          node.id,
          qualifyFacilityRackRef(facility.id, savedRack.id),
        );
      }
    }
    rebuilt.push(facility);
  }
  return { facilities: rebuilt, rackRefByNodeId };
};

/**
 * Deterministically reconciles saved facility placement with normalized Fleet
 * nodes. Saved equipment capacity and node rack references are never trusted.
 */
export const normalizeFacilityInfrastructureForGameState = (
  input: GameState,
): FacilityInfrastructureGameState => {
  const savedFacilities = rawFacilities(input)
    .map(normalizeFacilityState)
    .sort((left, right) => compareEntityIds(left.id, right.id));
  const uniqueFacilities: FacilityState[] = [];
  const seenFacilityIds = new Set<string>();
  for (const facility of savedFacilities) {
    if (seenFacilityIds.has(facility.id)) continue;
    seenFacilityIds.add(facility.id);
    uniqueFacilities.push(facility);
  }

  const base = normalizeInfrastructureForGameState(input);
  const rebuilt = rebuildFacilityPlacements(base, uniqueFacilities);
  const maximumFacilityId = Math.max(
    0,
    ...rebuilt.facilities.map((facility) => entityNumber(facility.id)),
  );
  return {
    ...base,
    infrastructure: {
      ...base.infrastructure,
      nextEntityId: Math.max(
        base.infrastructure.nextEntityId,
        maximumFacilityId + 1,
      ),
      facilities: rebuilt.facilities,
      fleetNodes: base.infrastructure.fleetNodes.map((node) => ({
        ...node,
        rackId: rebuilt.rackRefByNodeId.get(node.id) ?? null,
      })),
    },
  };
};

const rejected = (
  state: FacilityInfrastructureGameState,
  blocker: string,
  values: Partial<FacilityInfrastructureMutationResult> = {},
): FacilityInfrastructureMutationResult => ({
  accepted: false,
  state,
  blockers: [blocker],
  facilityId: null,
  rackId: null,
  placementId: null,
  nodeId: null,
  ...values,
});

const nextFacilityEntityNumber = (state: FacilityInfrastructureGameState) => {
  const ids = [
    ...state.infrastructure.fleetNodes.map((node) => node.id),
    ...state.infrastructure.clusters.map((cluster) => cluster.id),
    ...(state.infrastructure.workloads ?? []).map((workload) => workload.id),
    ...state.infrastructure.facilities.map((facility) => facility.id),
  ];
  return Math.max(
    state.infrastructure.nextEntityId,
    1,
    ...ids.map((id) => entityNumber(id) + 1),
  );
};

export const commissionFacilityForGameState = (
  input: GameState,
  templateId: FacilityTemplateId,
  name?: string,
): FacilityInfrastructureMutationResult => {
  const state = normalizeFacilityInfrastructureForGameState(input);
  const gate = getFacilityInfrastructureBlockedReason(state);
  if (gate) return rejected(state, gate);
  const number = nextFacilityEntityNumber(state);
  if (!Number.isSafeInteger(number) || number >= Number.MAX_SAFE_INTEGER) {
    return rejected(state, "Cannot allocate another facility ID.");
  }
  const definition = getFacilityTemplateDefinition(templateId);
  if (!canAffordExact(state, definition.commissionCosts)) {
    return rejected(
      state,
      `Insufficient resources to commission ${definition.name}.`,
    );
  }
  const facilityId = `facility-${number}`;
  const facility = createFacilityState(
    templateId,
    facilityId,
    name ?? definition.name,
  );
  const paid = spendExact(
    state,
    definition.commissionCosts,
  ) as FacilityInfrastructureGameState;
  return {
    accepted: true,
    state: {
      ...paid,
      infrastructure: {
        ...paid.infrastructure,
        nextEntityId: number + 1,
        facilities: [...paid.infrastructure.facilities, facility],
      },
    },
    blockers: [],
    facilityId,
    rackId: null,
    placementId: null,
    nodeId: null,
  };
};

export const commissionFacilityRackForGameState = (
  input: GameState,
  facilityId: string,
  templateId: RackTemplateId,
  name?: string,
): FacilityInfrastructureMutationResult => {
  const state = normalizeFacilityInfrastructureForGameState(input);
  const gate = getFacilityInfrastructureBlockedReason(state);
  if (gate) return rejected(state, gate, { facilityId });
  const facility = getFacilityById(state, facilityId);
  if (!facility) return rejected(state, "Facility does not exist.", { facilityId });
  const result = commissionRack(facility, templateId, name);
  if (!result.accepted) {
    return rejected(state, result.blockers.map((item) => item.message).join(" "), {
      facilityId,
    });
  }
  const definition = getRackTemplateDefinition(templateId);
  if (!canAffordExact(state, definition.commissionCosts)) {
    return rejected(
      state,
      `Insufficient resources to commission ${definition.name}.`,
      { facilityId },
    );
  }
  const paid = spendExact(
    state,
    definition.commissionCosts,
  ) as FacilityInfrastructureGameState;
  return {
    accepted: true,
    state: {
      ...paid,
      infrastructure: {
        ...paid.infrastructure,
        facilities: paid.infrastructure.facilities.map((candidate) =>
          candidate.id === facilityId ? result.state : candidate,
        ),
      },
    },
    blockers: [],
    facilityId,
    rackId: result.rackId,
    placementId: null,
    nodeId: null,
  };
};

export const placeFleetNodeInFacilityRack = (
  input: GameState,
  facilityId: string,
  rackId: string,
  nodeId: string,
): FacilityInfrastructureMutationResult => {
  const state = normalizeFacilityInfrastructureForGameState(input);
  const gate = getFacilityInfrastructureBlockedReason(state);
  if (gate) return rejected(state, gate, { facilityId, rackId, nodeId });
  const workloadBlocker = getFleetNodeActiveWorkloadBlocker(state, nodeId);
  if (workloadBlocker) {
    return rejected(state, workloadBlocker, { facilityId, rackId, nodeId });
  }
  const facility = getFacilityById(state, facilityId);
  if (!facility) {
    return rejected(state, "Facility does not exist.", {
      facilityId,
      rackId,
      nodeId,
    });
  }
  const node = state.infrastructure.fleetNodes.find(
    (candidate) => candidate.id === nodeId,
  );
  if (!node?.managed) {
    return rejected(state, "Fleet node is missing or unmanaged.", {
      facilityId,
      rackId,
      nodeId,
    });
  }
  if (node.rackId !== null) {
    return rejected(state, "Fleet node is already placed in a true rack.", {
      facilityId,
      rackId,
      nodeId,
    });
  }
  const equipment = deriveEquipment(state, node);
  const result = placeEquipmentDeterministically(facility, equipment, { rackId });
  if (!result.accepted) {
    return rejected(
      state,
      result.blockers.map((blocker) => blocker.message).join(" ") ||
        "Fleet node does not fit the requested rack.",
      { facilityId, rackId, nodeId },
    );
  }
  return {
    accepted: true,
    state: {
      ...state,
      infrastructure: {
        ...state.infrastructure,
        facilities: state.infrastructure.facilities.map((candidate) =>
          candidate.id === facilityId ? result.state : candidate,
        ),
        fleetNodes: state.infrastructure.fleetNodes.map((candidate) =>
          candidate.id === nodeId
            ? {
                ...candidate,
                rackId: qualifyFacilityRackRef(facilityId, rackId),
              }
            : candidate,
        ),
      },
    },
    blockers: [],
    facilityId,
    rackId,
    placementId: result.placementId,
    nodeId,
  };
};

export const removeFleetNodeFromFacilityRack = (
  input: GameState,
  nodeId: string,
): FacilityInfrastructureMutationResult => {
  const state = normalizeFacilityInfrastructureForGameState(input);
  const workloadBlocker = getFleetNodeActiveWorkloadBlocker(state, nodeId);
  if (workloadBlocker) return rejected(state, workloadBlocker, { nodeId });
  const node = state.infrastructure.fleetNodes.find(
    (candidate) => candidate.id === nodeId,
  );
  const rackRef = parseQualifiedRackRef(node?.rackId);
  if (!node || !rackRef) {
    return rejected(state, "Fleet node is not placed in a true rack.", { nodeId });
  }
  const facility = getFacilityById(state, rackRef.facilityId);
  const rack = facility?.racks.find((candidate) => candidate.id === rackRef.rackId);
  const placement = rack?.placements.find(
    (candidate) => candidate.equipment.id === nodeId,
  );
  if (!facility || !placement) {
    return rejected(state, "Qualified rack placement is missing.", { nodeId });
  }
  const updatedFacility = removeEquipmentPlacement(facility, placement.id);
  return {
    accepted: true,
    state: {
      ...state,
      infrastructure: {
        ...state.infrastructure,
        facilities: state.infrastructure.facilities.map((candidate) =>
          candidate.id === facility.id ? updatedFacility : candidate,
        ),
        fleetNodes: state.infrastructure.fleetNodes.map((candidate) =>
          candidate.id === nodeId ? { ...candidate, rackId: null } : candidate,
        ),
      },
    },
    blockers: [],
    facilityId: facility.id,
    rackId: rackRef.rackId,
    placementId: placement.id,
    nodeId,
  };
};

export const getProductiveFacilitiesForNodeIds = (
  input: GameState,
  nodeIds: Iterable<string>,
): FacilityState[] => {
  const state = normalizeFacilityInfrastructureForGameState(input);
  const facilityIds = new Set<string>();
  const requestedNodeIds = new Set(nodeIds);
  for (const node of state.infrastructure.fleetNodes) {
    if (!requestedNodeIds.has(node.id)) continue;
    const rackRef = parseQualifiedRackRef(node.rackId);
    if (rackRef) facilityIds.add(rackRef.facilityId);
  }
  return state.infrastructure.facilities.filter((facility) =>
    facilityIds.has(facility.id),
  );
};

export const getFacilityOperatingCostPerSecondForNodeIds = (
  state: GameState,
  nodeIds: Iterable<string>,
) =>
  sumAmounts(
    getProductiveFacilitiesForNodeIds(state, nodeIds).map((facility) =>
      getFacilityOperatingCostPerSecondForGameState(state, facility),
    ),
  );

/** Exact effective facility rate after saved horizontal project tools. */
export const getFacilityOperatingCostPerSecondForGameState = (
  state: GameState,
  facility: FacilityState,
) =>
  amountMultiply(
    getFacilityOperatingCostPerSecond(facility),
    state.projects.completedProjectIds.includes("gridRelief") ? "0.8" : "1",
  );

/**
 * Exact Cloud service-compute capacity with the recommended 30% reserve.
 * Uplink is deliberately not applied here: facility uplink remains admission
 * headroom for facility workloads, while Cloud `RoutingEdge.capacity` is the
 * single inter-region WAN constraint. Capping both would charge bandwidth
 * twice and make the routed Cloud model depend on two unrelated link graphs.
 */
export const deriveFacilityCloudEffectiveCompute = (
  facilityInput: FacilityState,
  additionalDemand: FacilityResourceVector = createFacilityResourceVector(),
) => {
  const facility = normalizeFacilityState(facilityInput);
  const snapshot = getFacilitySnapshot(
    facility,
    normalizeFacilityResourceVector(additionalDemand),
  );
  const ceiling = amountMultiply(snapshot.capacity.compute, "0.7");
  return amountClampMin(amountSubtract(ceiling, snapshot.demand.compute));
};

export const getFacilityCloudZoneSources = (
  input: GameState,
): FacilityCloudZoneSource[] => {
  const state = normalizeFacilityInfrastructureForGameState(input);
  return state.infrastructure.facilities.map((facility) => ({
    facilityId: facility.id,
    capacityPerSecond: deriveFacilityCloudEffectiveCompute(facility),
  }));
};

export const isFacilityInfrastructureAction = (action: GameAction) =>
  action.type === "commissionFacility" ||
  action.type === "commissionFacilityRack" ||
  action.type === "placeFleetNodeInRack" ||
  action.type === "removeFleetNodeFromRack";

export const applyFacilityInfrastructureAction = (
  state: GameState,
  action: GameAction,
): FacilityInfrastructureGameState => {
  if (action.type === "commissionFacility") {
    return commissionFacilityForGameState(
      state,
      action.templateId,
      action.name,
    ).state;
  }
  if (action.type === "commissionFacilityRack") {
    return commissionFacilityRackForGameState(
      state,
      action.facilityId,
      action.templateId,
      action.name,
    ).state;
  }
  if (action.type === "placeFleetNodeInRack") {
    return placeFleetNodeInFacilityRack(
      state,
      action.facilityId,
      action.rackId,
      action.nodeId,
    ).state;
  }
  if (action.type === "removeFleetNodeFromRack") {
    return removeFleetNodeFromFacilityRack(state, action.nodeId).state;
  }
  return normalizeFacilityInfrastructureForGameState(state);
};
