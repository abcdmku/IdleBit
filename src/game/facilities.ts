import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountDivide,
  amountMin,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  type Amount,
} from "./amount";
import type { CapacityProfile } from "./infrastructureTypes";
import {
  equipmentCapacityResourceIds,
  facilityResourceIds,
  getFacilityTemplateDefinition,
  getRackTemplateDefinition,
  isFacilityTemplateId,
  isRackTemplateId,
  type EquipmentCapacityResourceId,
  type FacilityResourceId,
  type FacilityResourceVector,
  type FacilityTemplateId,
  type RackEquipmentCapacity,
  type RackEquipmentProfile,
  type RackTemplateId,
} from "./facilityDefinitions";

export const DEFAULT_FACILITY_HEADROOM_BPS = 3_000;
const BASIS_POINTS = 10_000;
const MAX_NAME_LENGTH = 80;
const MAX_ID_LENGTH = 120;
// Matches the largest supported physical Fleet batch without coupling this
// pure facility domain back to Fleet action handling.
const MAX_RACK_EQUIPMENT_UNITS = 1_000_000;

type AmountValue = Amount | string | number;

export interface RackPlacementState {
  id: string;
  equipment: RackEquipmentProfile;
}

export interface FacilityRackState {
  id: string;
  name: string;
  templateId: RackTemplateId;
  placements: RackPlacementState[];
}

export interface FacilityState {
  id: string;
  name: string;
  templateId: FacilityTemplateId;
  nextEntityId: number;
  racks: FacilityRackState[];
}

export interface FacilityUtilizationSnapshot {
  capacity: FacilityResourceVector;
  demand: FacilityResourceVector;
  available: FacilityResourceVector;
  utilizationBps: Record<FacilityResourceId, number>;
  maxUtilizationBps: number;
  headroomBps: number;
}

export interface RackSnapshot extends FacilityUtilizationSnapshot {
  id: string;
  name: string;
  templateId: RackTemplateId;
  rackUnits: {
    capacity: number;
    demand: number;
    available: number;
    utilizationBps: number;
    headroomBps: number;
  };
  fixedOperatingCostPerSecond: Amount;
  equipmentOperatingCostPerSecond: Amount;
  operatingCostPerSecond: Amount;
}

export interface FacilityOperatingCostBreakdown {
  facilityFixedPerSecond: Amount;
  rackFixedPerSecond: Amount;
  equipmentPerSecond: Amount;
  energyPerSecond: Amount;
  totalPerSecond: Amount;
}

export interface FacilitySnapshot extends FacilityUtilizationSnapshot {
  id: string;
  name: string;
  templateId: FacilityTemplateId;
  rackSlots: {
    capacity: number;
    demand: number;
    available: number;
    utilizationBps: number;
    headroomBps: number;
  };
  racks: RackSnapshot[];
  operatingCost: FacilityOperatingCostBreakdown;
}

export type FacilityConstraintId =
  | FacilityResourceId
  | "rackUnits"
  | "rackSlots"
  | "rackId"
  | "equipmentId";

export interface FacilityAdmissionBlocker {
  scope: "rack" | "facility";
  scopeId: string;
  constraint: FacilityConstraintId;
  capacity?: Amount;
  projectedDemand?: Amount;
  allowedDemand?: Amount;
  message: string;
}

export interface FacilityAdmissionDecision {
  accepted: boolean;
  blockers: FacilityAdmissionBlocker[];
}

export interface RackCommissionResult extends FacilityAdmissionDecision {
  state: FacilityState;
  rackId: string | null;
}

export interface EquipmentPlacementResult extends FacilityAdmissionDecision {
  state: FacilityState;
  rackId: string | null;
  placementId: string | null;
}

export interface EquipmentPlacementOptions {
  rackId?: string;
  minimumHeadroomBps?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeText = (value: unknown, fallback: string, maxLength: number) => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || fallback;
};

const normalizeNonNegativeAmount = (
  value: unknown,
  fallback: Amount = ZERO_AMOUNT,
) => {
  try {
    if (typeof value !== "string" && typeof value !== "number") return fallback;
    return amountClampMin(amount(value));
  } catch {
    return fallback;
  }
};

const normalizePositiveInteger = (
  value: unknown,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.trunc(value)));
};

const normalizeHeadroomBps = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_FACILITY_HEADROOM_BPS;
  }
  return Math.min(BASIS_POINTS, Math.max(0, Math.trunc(value)));
};

export const createFacilityResourceVector = (
  values: Partial<Record<FacilityResourceId, AmountValue>> = {},
): FacilityResourceVector =>
  Object.fromEntries(
    facilityResourceIds.map((resource) => [
      resource,
      amountClampMin(values[resource] ?? ZERO_AMOUNT),
    ]),
  ) as FacilityResourceVector;

export const createRackEquipmentCapacity = (
  values: Partial<Record<EquipmentCapacityResourceId, AmountValue>> = {},
): RackEquipmentCapacity =>
  Object.fromEntries(
    equipmentCapacityResourceIds.map((resource) => [
      resource,
      amountClampMin(values[resource] ?? ZERO_AMOUNT),
    ]),
  ) as RackEquipmentCapacity;

export const normalizeFacilityResourceVector = (
  value: unknown,
): FacilityResourceVector => {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(
    facilityResourceIds.map((resource) => [
      resource,
      normalizeNonNegativeAmount(source[resource]),
    ]),
  ) as FacilityResourceVector;
};

export const normalizeRackEquipmentCapacity = (
  value: unknown,
): RackEquipmentCapacity => {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(
    equipmentCapacityResourceIds.map((resource) => [
      resource,
      normalizeNonNegativeAmount(source[resource]),
    ]),
  ) as RackEquipmentCapacity;
};

export const addFacilityResourceVectors = (
  left: FacilityResourceVector,
  right: FacilityResourceVector,
): FacilityResourceVector =>
  Object.fromEntries(
    facilityResourceIds.map((resource) => [
      resource,
      amountAdd(left[resource], right[resource]),
    ]),
  ) as FacilityResourceVector;

export const subtractFacilityResourceVectors = (
  total: FacilityResourceVector,
  used: FacilityResourceVector,
): FacilityResourceVector =>
  Object.fromEntries(
    facilityResourceIds.map((resource) => [
      resource,
      amountClampMin(amountSubtract(total[resource], used[resource])),
    ]),
  ) as FacilityResourceVector;

export const scaleFacilityResourceVector = (
  vector: FacilityResourceVector,
  multiplier: AmountValue,
): FacilityResourceVector => {
  const scale = amount(multiplier);
  if (amountCompare(scale, 0) < 0) {
    throw new Error("Facility resource scale must be non-negative");
  }
  return Object.fromEntries(
    facilityResourceIds.map((resource) => [
      resource,
      amountMultiply(vector[resource], scale),
    ]),
  ) as FacilityResourceVector;
};

export const sumFacilityResourceVectors = (
  vectors: readonly FacilityResourceVector[],
): FacilityResourceVector =>
  vectors.reduce(addFacilityResourceVectors, createFacilityResourceVector());

const sumRackEquipmentCapacities = (
  capacities: readonly RackEquipmentCapacity[],
): RackEquipmentCapacity =>
  capacities.reduce<RackEquipmentCapacity>(
    (total, capacity) =>
      Object.fromEntries(
        equipmentCapacityResourceIds.map((resource) => [
          resource,
          amountAdd(total[resource], capacity[resource]),
        ]),
      ) as RackEquipmentCapacity,
    createRackEquipmentCapacity(),
  );

const getUtilizationBps = (capacity: Amount, demand: Amount) => {
  if (amountCompare(capacity, 0) <= 0) {
    return amountCompare(demand, 0) > 0 ? BASIS_POINTS : 0;
  }
  const projected = amountToSafeNumber(
    amountMultiply(amountDivide(demand, capacity), BASIS_POINTS),
  );
  return Math.min(BASIS_POINTS, Math.max(0, Math.round(projected)));
};

const getCountUtilization = (capacity: number, demand: number) => {
  if (capacity <= 0) return demand > 0 ? BASIS_POINTS : 0;
  return Math.min(
    BASIS_POINTS,
    Math.max(0, Math.round((demand / capacity) * BASIS_POINTS)),
  );
};

const getUtilizationSnapshot = (
  capacity: FacilityResourceVector,
  demand: FacilityResourceVector,
): FacilityUtilizationSnapshot => {
  const utilizationBps = Object.fromEntries(
    facilityResourceIds.map((resource) => [
      resource,
      getUtilizationBps(capacity[resource], demand[resource]),
    ]),
  ) as Record<FacilityResourceId, number>;
  const maxUtilizationBps = Math.max(0, ...Object.values(utilizationBps));
  return {
    capacity,
    demand,
    available: subtractFacilityResourceVectors(capacity, demand),
    utilizationBps,
    maxUtilizationBps,
    headroomBps: BASIS_POINTS - maxUtilizationBps,
  };
};

const getRackUnitsUsed = (rack: FacilityRackState) =>
  rack.placements.reduce(
    (total, placement) => total + placement.equipment.rackUnits,
    0,
  );

const getRackEquipmentCostPerSecond = (rack: FacilityRackState) =>
  rack.placements.reduce(
    (total, placement) =>
      amountAdd(total, placement.equipment.operatingCostPerSecond),
    ZERO_AMOUNT,
  );

const getRackCapacity = (rack: FacilityRackState): FacilityResourceVector => {
  const template = getRackTemplateDefinition(rack.templateId);
  const equipment = sumRackEquipmentCapacities(
    rack.placements.map((placement) => placement.equipment.capacity),
  );
  return createFacilityResourceVector({
    compute: equipment.compute,
    memoryBits: equipment.memoryBits,
    storageBits: equipment.storageBits,
    powerWatts: template.powerWatts,
    coolingWatts: template.coolingWatts,
    uplinkIngress: amountMin(equipment.uplinkIngress, template.uplinkIngress),
    uplinkEgress: amountMin(equipment.uplinkEgress, template.uplinkEgress),
  });
};

const getRackDemand = (
  rack: FacilityRackState,
  additionalDemand: FacilityResourceVector,
) =>
  addFacilityResourceVectors(
    sumFacilityResourceVectors(
      rack.placements.map((placement) => placement.equipment.demand),
    ),
    additionalDemand,
  );

export const getRackSnapshot = (
  rack: FacilityRackState,
  additionalDemand: FacilityResourceVector = createFacilityResourceVector(),
): RackSnapshot => {
  const template = getRackTemplateDefinition(rack.templateId);
  const fixedOperatingCostPerSecond = template.fixedOperatingCostPerSecond;
  const equipmentOperatingCostPerSecond =
    getRackEquipmentCostPerSecond(rack);
  const operatingCostPerSecond = amountAdd(
    fixedOperatingCostPerSecond,
    equipmentOperatingCostPerSecond,
  );
  const rackUnitDemand = getRackUnitsUsed(rack);
  const rackUnitUtilization = getCountUtilization(
    template.rackUnits,
    rackUnitDemand,
  );
  return {
    id: rack.id,
    name: rack.name,
    templateId: rack.templateId,
    ...getUtilizationSnapshot(
      getRackCapacity(rack),
      getRackDemand(rack, additionalDemand),
    ),
    rackUnits: {
      capacity: template.rackUnits,
      demand: rackUnitDemand,
      available: Math.max(0, template.rackUnits - rackUnitDemand),
      utilizationBps: rackUnitUtilization,
      headroomBps: BASIS_POINTS - rackUnitUtilization,
    },
    fixedOperatingCostPerSecond,
    equipmentOperatingCostPerSecond,
    operatingCostPerSecond,
  };
};

const getFacilityCapacity = (
  state: FacilityState,
  racks: readonly RackSnapshot[],
): FacilityResourceVector => {
  const template = getFacilityTemplateDefinition(state.templateId);
  const aggregateRackCapacity = sumFacilityResourceVectors(
    racks.map((rack) => rack.capacity),
  );
  return createFacilityResourceVector({
    compute: aggregateRackCapacity.compute,
    memoryBits: aggregateRackCapacity.memoryBits,
    storageBits: aggregateRackCapacity.storageBits,
    powerWatts: template.powerWatts,
    coolingWatts: template.coolingWatts,
    uplinkIngress: amountMin(
      aggregateRackCapacity.uplinkIngress,
      template.uplinkIngress,
    ),
    uplinkEgress: amountMin(
      aggregateRackCapacity.uplinkEgress,
      template.uplinkEgress,
    ),
  });
};

const getFacilityCostBreakdown = (
  state: FacilityState,
  powerDemand: Amount,
): FacilityOperatingCostBreakdown => {
  const template = getFacilityTemplateDefinition(state.templateId);
  const rackFixedPerSecond = state.racks.reduce(
    (total, rack) =>
      amountAdd(
        total,
        getRackTemplateDefinition(rack.templateId).fixedOperatingCostPerSecond,
      ),
    ZERO_AMOUNT,
  );
  const equipmentPerSecond = state.racks.reduce(
    (total, rack) => amountAdd(total, getRackEquipmentCostPerSecond(rack)),
    ZERO_AMOUNT,
  );
  const energyPerSecond = amountMultiply(
    powerDemand,
    template.energyCostPerWattSecond,
  );
  const facilityFixedPerSecond = template.fixedOperatingCostPerSecond;
  return {
    facilityFixedPerSecond,
    rackFixedPerSecond,
    equipmentPerSecond,
    energyPerSecond,
    totalPerSecond: amountAdd(
      amountAdd(facilityFixedPerSecond, rackFixedPerSecond),
      amountAdd(equipmentPerSecond, energyPerSecond),
    ),
  };
};

export const getFacilitySnapshot = (
  state: FacilityState,
  additionalDemand: FacilityResourceVector = createFacilityResourceVector(),
): FacilitySnapshot => {
  const template = getFacilityTemplateDefinition(state.templateId);
  const racks = state.racks.map((rack) => getRackSnapshot(rack));
  const demand = addFacilityResourceVectors(
    sumFacilityResourceVectors(racks.map((rack) => rack.demand)),
    additionalDemand,
  );
  const rackSlotDemand = state.racks.length;
  const rackSlotUtilization = getCountUtilization(
    template.rackSlots,
    rackSlotDemand,
  );
  return {
    id: state.id,
    name: state.name,
    templateId: state.templateId,
    ...getUtilizationSnapshot(getFacilityCapacity(state, racks), demand),
    rackSlots: {
      capacity: template.rackSlots,
      demand: rackSlotDemand,
      available: Math.max(0, template.rackSlots - rackSlotDemand),
      utilizationBps: rackSlotUtilization,
      headroomBps: BASIS_POINTS - rackSlotUtilization,
    },
    racks,
    operatingCost: getFacilityCostBreakdown(state, demand.powerWatts),
  };
};

export const getFacilityOperatingCostPerSecond = (
  state: FacilityState,
  additionalDemand: FacilityResourceVector = createFacilityResourceVector(),
) => getFacilitySnapshot(state, additionalDemand).operatingCost.totalPerSecond;

/**
 * Clean Fleet integration seam. Network rates become installed uplink capacity;
 * peak node draw becomes both the power envelope and heat-rejection demand.
 */
export const rackEquipmentFromFleetCapacity = (
  id: string,
  name: string,
  profile: CapacityProfile,
  rackUnits = 1,
  operatingCostPerSecond: AmountValue = ZERO_AMOUNT,
): RackEquipmentProfile => ({
  id: normalizeText(id, "equipment", MAX_ID_LENGTH),
  name: normalizeText(name, "Unnamed equipment", MAX_NAME_LENGTH),
  rackUnits: normalizePositiveInteger(
    rackUnits,
    1,
    MAX_RACK_EQUIPMENT_UNITS,
  ),
  capacity: createRackEquipmentCapacity({
    compute: profile.rates.compute,
    memoryBits: profile.memoryBits,
    storageBits: profile.storageBits,
    uplinkIngress: profile.rates.networkIngress,
    uplinkEgress: profile.rates.networkEgress,
  }),
  demand: createFacilityResourceVector({
    powerWatts: profile.peakWatts,
    coolingWatts: profile.peakWatts,
  }),
  operatingCostPerSecond: amountClampMin(operatingCostPerSecond),
});

export const normalizeRackEquipmentProfile = (
  value: unknown,
  fallbackId = "equipment",
): RackEquipmentProfile => {
  const source = isRecord(value) ? value : {};
  const normalizedId = normalizeText(source.id, fallbackId, MAX_ID_LENGTH);
  return {
    id: normalizedId,
    name: normalizeText(source.name, normalizedId, MAX_NAME_LENGTH),
    rackUnits: normalizePositiveInteger(
      source.rackUnits,
      1,
      MAX_RACK_EQUIPMENT_UNITS,
    ),
    capacity: normalizeRackEquipmentCapacity(source.capacity),
    demand: normalizeFacilityResourceVector(source.demand),
    operatingCostPerSecond: normalizeNonNegativeAmount(
      source.operatingCostPerSecond,
    ),
  };
};

const resourceLabels: Record<FacilityResourceId, string> = {
  compute: "compute",
  memoryBits: "memory",
  storageBits: "storage",
  powerWatts: "power",
  coolingWatts: "cooling/heat rejection",
  uplinkIngress: "ingress uplink",
  uplinkEgress: "egress uplink",
};

const getResourceAdmissionBlockers = (
  snapshot: FacilityUtilizationSnapshot,
  scope: FacilityAdmissionBlocker["scope"],
  scopeId: string,
  minimumHeadroomBps: number,
): FacilityAdmissionBlocker[] => {
  const activeCapacityBps = BASIS_POINTS - minimumHeadroomBps;
  return facilityResourceIds.flatMap((resource) => {
    const capacity = snapshot.capacity[resource];
    const projectedDemand = snapshot.demand[resource];
    const allowedDemand = amountDivide(
      amountMultiply(capacity, activeCapacityBps),
      BASIS_POINTS,
    );
    if (amountCompare(projectedDemand, allowedDemand) <= 0) return [];
    return [
      {
        scope,
        scopeId,
        constraint: resource,
        capacity,
        projectedDemand,
        allowedDemand,
        message: `${scopeId} needs more ${resourceLabels[resource]} headroom (minimum ${minimumHeadroomBps / 100}% reserved).`,
      },
    ];
  });
};

export const getRackDemandAdmissionBlockers = (
  rack: FacilityRackState,
  additionalDemand: FacilityResourceVector,
  minimumHeadroomBps = DEFAULT_FACILITY_HEADROOM_BPS,
) =>
  getResourceAdmissionBlockers(
    getRackSnapshot(rack, normalizeFacilityResourceVector(additionalDemand)),
    "rack",
    rack.id,
    normalizeHeadroomBps(minimumHeadroomBps),
  );

export const getRackDemandAdmissionDecision = (
  rack: FacilityRackState,
  additionalDemand: FacilityResourceVector,
  minimumHeadroomBps = DEFAULT_FACILITY_HEADROOM_BPS,
): FacilityAdmissionDecision => {
  const blockers = getRackDemandAdmissionBlockers(
    rack,
    additionalDemand,
    minimumHeadroomBps,
  );
  return { accepted: blockers.length === 0, blockers };
};

export const getFacilityDemandAdmissionBlockers = (
  state: FacilityState,
  additionalDemand: FacilityResourceVector,
  minimumHeadroomBps = DEFAULT_FACILITY_HEADROOM_BPS,
) =>
  getResourceAdmissionBlockers(
    getFacilitySnapshot(
      state,
      normalizeFacilityResourceVector(additionalDemand),
    ),
    "facility",
    state.id,
    normalizeHeadroomBps(minimumHeadroomBps),
  );

export const getFacilityDemandAdmissionDecision = (
  state: FacilityState,
  additionalDemand: FacilityResourceVector,
  minimumHeadroomBps = DEFAULT_FACILITY_HEADROOM_BPS,
): FacilityAdmissionDecision => {
  const blockers = getFacilityDemandAdmissionBlockers(
    state,
    additionalDemand,
    minimumHeadroomBps,
  );
  return { accepted: blockers.length === 0, blockers };
};

export const getRackPlacementAdmissionBlockers = (
  rack: FacilityRackState,
  equipmentInput: RackEquipmentProfile,
  minimumHeadroomBps = DEFAULT_FACILITY_HEADROOM_BPS,
): FacilityAdmissionBlocker[] => {
  const equipment = normalizeRackEquipmentProfile(
    equipmentInput,
    equipmentInput.id,
  );
  const template = getRackTemplateDefinition(rack.templateId);
  const projectedRackUnits = getRackUnitsUsed(rack) + equipment.rackUnits;
  const blockers: FacilityAdmissionBlocker[] = [];
  if (projectedRackUnits > template.rackUnits) {
    blockers.push({
      scope: "rack",
      scopeId: rack.id,
      constraint: "rackUnits",
      capacity: amount(template.rackUnits),
      projectedDemand: amount(projectedRackUnits),
      allowedDemand: amount(template.rackUnits),
      message: `${rack.id} does not have ${equipment.rackUnits}U available.`,
    });
  }
  const candidate: FacilityRackState = {
    ...rack,
    placements: [
      ...rack.placements,
      { id: "placement-candidate", equipment },
    ],
  };
  blockers.push(
    ...getResourceAdmissionBlockers(
      getRackSnapshot(candidate),
      "rack",
      rack.id,
      normalizeHeadroomBps(minimumHeadroomBps),
    ),
  );
  return blockers;
};

const replaceRack = (
  state: FacilityState,
  replacement: FacilityRackState,
) => ({
  ...state,
  racks: state.racks.map((rack) =>
    rack.id === replacement.id ? replacement : rack,
  ),
});

export const getFacilityPlacementAdmissionBlockers = (
  state: FacilityState,
  rackId: string,
  equipmentInput: RackEquipmentProfile,
  minimumHeadroomBps = DEFAULT_FACILITY_HEADROOM_BPS,
): FacilityAdmissionBlocker[] => {
  const rack = state.racks.find((candidate) => candidate.id === rackId);
  if (!rack) {
    return [
      {
        scope: "facility",
        scopeId: state.id,
        constraint: "rackId",
        message: `Rack ${rackId} does not exist in ${state.id}.`,
      },
    ];
  }
  const equipment = normalizeRackEquipmentProfile(
    equipmentInput,
    equipmentInput.id,
  );
  if (
    state.racks.some((candidate) =>
      candidate.placements.some(
        (placement) => placement.equipment.id === equipment.id,
      ),
    )
  ) {
    return [
      {
        scope: "facility",
        scopeId: state.id,
        constraint: "equipmentId",
        message: `Equipment ${equipment.id} is already placed in ${state.id}.`,
      },
    ];
  }
  const rackBlockers = getRackPlacementAdmissionBlockers(
    rack,
    equipment,
    minimumHeadroomBps,
  );
  const candidateRack: FacilityRackState = {
    ...rack,
    placements: [
      ...rack.placements,
      { id: "placement-candidate", equipment },
    ],
  };
  const candidateFacility = replaceRack(state, candidateRack);
  const facilityBlockers = getResourceAdmissionBlockers(
    getFacilitySnapshot(candidateFacility),
    "facility",
    state.id,
    normalizeHeadroomBps(minimumHeadroomBps),
  );
  return [...rackBlockers, ...facilityBlockers];
};

const parseEntityNumber = (id: string) => {
  const match = /^(?:rack|placement)-([1-9]\d*)$/.exec(id);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const allocateEntityNumber = (state: FacilityState) => {
  const usedNumbers = state.racks.flatMap((rack) => [
    parseEntityNumber(rack.id) ?? 0,
    ...rack.placements.map((placement) =>
      parseEntityNumber(placement.id) ?? 0,
    ),
  ]);
  const candidate = Math.max(
    normalizePositiveInteger(state.nextEntityId, 1),
    ...usedNumbers.map((value) => value + 1),
  );
  return Number.isSafeInteger(candidate) ? candidate : null;
};

const compareEntityIds = (left: string, right: string) => {
  const leftNumber = parseEntityNumber(left);
  const rightNumber = parseEntityNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
};

export const createFacilityState = (
  templateId: FacilityTemplateId = "workshopFacility",
  id = "facility-1",
  name = getFacilityTemplateDefinition(templateId).name,
): FacilityState => ({
  id: normalizeText(id, "facility-1", MAX_ID_LENGTH),
  name: normalizeText(
    name,
    getFacilityTemplateDefinition(templateId).name,
    MAX_NAME_LENGTH,
  ),
  templateId,
  nextEntityId: 1,
  racks: [],
});

export const commissionRack = (
  state: FacilityState,
  templateId: RackTemplateId,
  name?: string,
): RackCommissionResult => {
  const facilityTemplate = getFacilityTemplateDefinition(state.templateId);
  if (state.racks.length >= facilityTemplate.rackSlots) {
    return {
      accepted: false,
      state,
      rackId: null,
      blockers: [
        {
          scope: "facility",
          scopeId: state.id,
          constraint: "rackSlots",
          capacity: amount(facilityTemplate.rackSlots),
          projectedDemand: amount(state.racks.length + 1),
          allowedDemand: amount(facilityTemplate.rackSlots),
          message: `${state.id} has no open rack slots.`,
        },
      ],
    };
  }
  const entityNumber = allocateEntityNumber(state);
  if (entityNumber === null) {
    return {
      accepted: false,
      state,
      rackId: null,
      blockers: [
        {
          scope: "facility",
          scopeId: state.id,
          constraint: "rackId",
          message: `${state.id} cannot allocate another stable rack ID.`,
        },
      ],
    };
  }
  const rackId = `rack-${entityNumber}`;
  const template = getRackTemplateDefinition(templateId);
  const rack: FacilityRackState = {
    id: rackId,
    name: normalizeText(name, `${template.name} ${entityNumber}`, MAX_NAME_LENGTH),
    templateId,
    placements: [],
  };
  return {
    accepted: true,
    state: {
      ...state,
      nextEntityId: entityNumber + 1,
      racks: [...state.racks, rack],
    },
    rackId,
    blockers: [],
  };
};

const dedupeBlockers = (
  blockers: readonly FacilityAdmissionBlocker[],
): FacilityAdmissionBlocker[] => {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key = `${blocker.scope}:${blocker.scopeId}:${blocker.constraint}:${blocker.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const placeEquipmentDeterministically = (
  state: FacilityState,
  equipmentInput: RackEquipmentProfile,
  options: EquipmentPlacementOptions = {},
): EquipmentPlacementResult => {
  const equipment = normalizeRackEquipmentProfile(
    equipmentInput,
    equipmentInput.id,
  );
  const minimumHeadroomBps = normalizeHeadroomBps(
    options.minimumHeadroomBps,
  );
  const candidates = options.rackId
    ? state.racks.filter((rack) => rack.id === options.rackId)
    : [...state.racks].sort((left, right) =>
        compareEntityIds(left.id, right.id),
      );
  if (candidates.length === 0) {
    return {
      accepted: false,
      state,
      rackId: null,
      placementId: null,
      blockers: [
        {
          scope: "facility",
          scopeId: state.id,
          constraint: "rackId",
          message: options.rackId
            ? `Rack ${options.rackId} does not exist in ${state.id}.`
            : `${state.id} has no commissioned racks.`,
        },
      ],
    };
  }
  const attemptedBlockers: FacilityAdmissionBlocker[] = [];
  for (const rack of candidates) {
    const blockers = getFacilityPlacementAdmissionBlockers(
      state,
      rack.id,
      equipment,
      minimumHeadroomBps,
    );
    if (blockers.length > 0) {
      attemptedBlockers.push(...blockers);
      continue;
    }
    const entityNumber = allocateEntityNumber(state);
    if (entityNumber === null) {
      attemptedBlockers.push({
        scope: "facility",
        scopeId: state.id,
        constraint: "equipmentId",
        message: `${state.id} cannot allocate another stable placement ID.`,
      });
      break;
    }
    const placementId = `placement-${entityNumber}`;
    const updatedRack: FacilityRackState = {
      ...rack,
      placements: [...rack.placements, { id: placementId, equipment }],
    };
    return {
      accepted: true,
      state: {
        ...replaceRack(state, updatedRack),
        nextEntityId: entityNumber + 1,
      },
      rackId: rack.id,
      placementId,
      blockers: [],
    };
  }
  return {
    accepted: false,
    state,
    rackId: null,
    placementId: null,
    blockers: dedupeBlockers(attemptedBlockers),
  };
};

export const removeEquipmentPlacement = (
  state: FacilityState,
  placementId: string,
): FacilityState => ({
  ...state,
  racks: state.racks.map((rack) => ({
    ...rack,
    placements: rack.placements.filter(
      (placement) => placement.id !== placementId,
    ),
  })),
});

export type FacilityBillingStatus = "running" | "safelyPaused";
export type FacilityPauseReason = "insufficientRunway";
export type ExactDurationInput = Amount | string | number;

export interface FacilityBillingState {
  availableCredits: Amount;
  totalBilledCredits: Amount;
  elapsedMs: Amount;
  productiveMs: Amount;
  pausedMs: Amount;
  status: FacilityBillingStatus;
  pauseReason: FacilityPauseReason | null;
}

export interface FacilityBillingInterval {
  elapsedMs: Amount;
  productiveMs: Amount;
  pausedMs: Amount;
  operatingCostPerSecond: Amount;
  requestedCost: Amount;
  billedCredits: Amount;
  status: FacilityBillingStatus;
  pauseReason: FacilityPauseReason | null;
}

export interface FacilityBillingResult {
  /** Billing never mutates, removes, or damages the facility. */
  facility: FacilityState;
  billing: FacilityBillingState;
  interval: FacilityBillingInterval;
}

export interface FacilityBillingEventOptions {
  horizonMs?: ExactDurationInput;
  additionalDemand?: FacilityResourceVector;
}

export interface FacilityBillingRunwayEvent {
  type: "billingRunwayExhausted";
  afterMs: Amount;
  atElapsedMs: Amount;
  operatingCostPerSecond: Amount;
  availableCredits: Amount;
}

export const normalizeExactDuration = (value: unknown): Amount =>
  normalizeNonNegativeAmount(value);

export const createFacilityBillingState = (
  availableCredits: AmountValue = ZERO_AMOUNT,
): FacilityBillingState => ({
  availableCredits: amountClampMin(availableCredits),
  totalBilledCredits: ZERO_AMOUNT,
  elapsedMs: ZERO_AMOUNT,
  productiveMs: ZERO_AMOUNT,
  pausedMs: ZERO_AMOUNT,
  status: "running",
  pauseReason: null,
});

export const normalizeFacilityBillingState = (
  value: unknown,
): FacilityBillingState => {
  const source = isRecord(value) ? value : {};
  const status: FacilityBillingStatus =
    source.status === "safelyPaused" ? "safelyPaused" : "running";
  return {
    availableCredits: normalizeNonNegativeAmount(source.availableCredits),
    totalBilledCredits: normalizeNonNegativeAmount(source.totalBilledCredits),
    elapsedMs: normalizeNonNegativeAmount(source.elapsedMs),
    productiveMs: normalizeNonNegativeAmount(source.productiveMs),
    pausedMs: normalizeNonNegativeAmount(source.pausedMs),
    status,
    pauseReason:
      status === "safelyPaused" && source.pauseReason === "insufficientRunway"
        ? "insufficientRunway"
        : null,
  };
};

/** Exact productive time remaining before the credit ledger is exhausted. */
export const getFacilityOperatingRunwayMs = (
  state: FacilityState,
  billingInput: FacilityBillingState,
  additionalDemand: FacilityResourceVector = createFacilityResourceVector(),
): Amount | null => {
  const billing = normalizeFacilityBillingState(billingInput);
  const rate = getFacilityOperatingCostPerSecond(
    state,
    normalizeFacilityResourceVector(additionalDemand),
  );
  if (amountCompare(rate, 0) <= 0) return null;
  return amountMultiply(
    amountDivide(billing.availableCredits, rate),
    1_000,
  );
};

/**
 * Discrete-event seam for advanceGame: returns the exact credit-exhaustion
 * boundary when it occurs within the optional horizon.
 */
export const getNextFacilityBillingEvent = (
  state: FacilityState,
  billingInput: FacilityBillingState,
  options: FacilityBillingEventOptions = {},
): FacilityBillingRunwayEvent | null => {
  const billing = normalizeFacilityBillingState(billingInput);
  const additionalDemand = normalizeFacilityResourceVector(
    options.additionalDemand,
  );
  const operatingCostPerSecond = getFacilityOperatingCostPerSecond(
    state,
    additionalDemand,
  );
  if (amountCompare(operatingCostPerSecond, 0) <= 0) return null;
  const afterMs = amountMultiply(
    amountDivide(billing.availableCredits, operatingCostPerSecond),
    1_000,
  );
  if (
    options.horizonMs !== undefined &&
    amountCompare(afterMs, normalizeExactDuration(options.horizonMs)) > 0
  ) {
    return null;
  }
  return {
    type: "billingRunwayExhausted",
    afterMs,
    atElapsedMs: amountAdd(billing.elapsedMs, afterMs),
    operatingCostPerSecond,
    availableCredits: billing.availableCredits,
  };
};

export const billFacilityOperation = (
  state: FacilityState,
  billingInput: FacilityBillingState,
  elapsedMsInput: ExactDurationInput,
  additionalDemand: FacilityResourceVector = createFacilityResourceVector(),
): FacilityBillingResult => {
  const billing = normalizeFacilityBillingState(billingInput);
  const elapsedMs = normalizeExactDuration(elapsedMsInput);
  const operatingCostPerSecond = getFacilityOperatingCostPerSecond(
    state,
    normalizeFacilityResourceVector(additionalDemand),
  );
  const requestedCost = amountDivide(
    amountMultiply(operatingCostPerSecond, elapsedMs),
    1_000,
  );

  if (amountCompare(elapsedMs, 0) === 0) {
    return {
      facility: state,
      billing,
      interval: {
        elapsedMs,
        productiveMs: ZERO_AMOUNT,
        pausedMs: ZERO_AMOUNT,
        operatingCostPerSecond,
        requestedCost,
        billedCredits: ZERO_AMOUNT,
        status: billing.status,
        pauseReason: billing.pauseReason,
      },
    };
  }

  if (
    amountCompare(operatingCostPerSecond, 0) <= 0 ||
    amountCompare(billing.availableCredits, requestedCost) >= 0
  ) {
    const billedCredits =
      amountCompare(operatingCostPerSecond, 0) <= 0
        ? ZERO_AMOUNT
        : requestedCost;
    const nextBilling: FacilityBillingState = {
      availableCredits: amountSubtract(
        billing.availableCredits,
        billedCredits,
      ),
      totalBilledCredits: amountAdd(
        billing.totalBilledCredits,
        billedCredits,
      ),
      elapsedMs: amountAdd(billing.elapsedMs, elapsedMs),
      productiveMs: amountAdd(billing.productiveMs, elapsedMs),
      pausedMs: billing.pausedMs,
      status: "running",
      pauseReason: null,
    };
    return {
      facility: state,
      billing: nextBilling,
      interval: {
        elapsedMs,
        productiveMs: elapsedMs,
        pausedMs: ZERO_AMOUNT,
        operatingCostPerSecond,
        requestedCost,
        billedCredits,
        status: "running",
        pauseReason: null,
      },
    };
  }

  const productiveMs = amountMin(
    elapsedMs,
    amountMultiply(
      amountDivide(billing.availableCredits, operatingCostPerSecond),
      1_000,
    ),
  );
  const pausedMs = amountSubtract(elapsedMs, productiveMs);
  const billedCredits = billing.availableCredits;
  const nextBilling: FacilityBillingState = {
    availableCredits: ZERO_AMOUNT,
    totalBilledCredits: amountAdd(
      billing.totalBilledCredits,
      billedCredits,
    ),
    elapsedMs: amountAdd(billing.elapsedMs, elapsedMs),
    productiveMs: amountAdd(billing.productiveMs, productiveMs),
    pausedMs: amountAdd(billing.pausedMs, pausedMs),
    status: "safelyPaused",
    pauseReason: "insufficientRunway",
  };
  return {
    facility: state,
    billing: nextBilling,
    interval: {
      elapsedMs,
      productiveMs,
      pausedMs,
      operatingCostPerSecond,
      requestedCost,
      billedCredits,
      status: "safelyPaused",
      pauseReason: "insufficientRunway",
    },
  };
};

const isEntityId = (
  value: unknown,
  prefix: "rack" | "placement",
): value is string =>
  typeof value === "string" &&
  new RegExp(`^${prefix}-[1-9]\\d*$`).test(value) &&
  parseEntityNumber(value) !== null;

export const normalizeRackPlacementState = (
  value: unknown,
): RackPlacementState | null => {
  if (!isRecord(value) || !isEntityId(value.id, "placement")) return null;
  const placementId = value.id;
  return {
    id: placementId,
    equipment: normalizeRackEquipmentProfile(
      value.equipment,
      `equipment-${parseEntityNumber(placementId) ?? 1}`,
    ),
  };
};

export const normalizeFacilityRackState = (
  value: unknown,
): FacilityRackState | null => {
  if (!isRecord(value) || !isEntityId(value.id, "rack")) return null;
  const templateId = isRackTemplateId(value.templateId)
    ? value.templateId
    : "standardRack";
  const rack: FacilityRackState = {
    id: value.id,
    name: normalizeText(
      value.name,
      getRackTemplateDefinition(templateId).name,
      MAX_NAME_LENGTH,
    ),
    templateId,
    placements: [],
  };
  const rawPlacements = Array.isArray(value.placements)
    ? value.placements
        .map(normalizeRackPlacementState)
        .filter((placement): placement is RackPlacementState => placement !== null)
        .sort((left, right) => compareEntityIds(left.id, right.id))
    : [];
  const placementIds = new Set<string>();
  const equipmentIds = new Set<string>();
  for (const placement of rawPlacements) {
    if (
      placementIds.has(placement.id) ||
      equipmentIds.has(placement.equipment.id)
    ) {
      continue;
    }
    if (
      getRackPlacementAdmissionBlockers(
        rack,
        placement.equipment,
        DEFAULT_FACILITY_HEADROOM_BPS,
      ).length > 0
    ) {
      continue;
    }
    rack.placements.push(placement);
    placementIds.add(placement.id);
    equipmentIds.add(placement.equipment.id);
  }
  return rack;
};

const isFacilityId = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const match = /^facility-([1-9]\d*)$/.exec(value);
  if (!match) return false;
  return Number.isSafeInteger(Number(match[1]));
};

/**
 * Repairs untrusted save input in stable numeric-ID order. Invalid IDs,
 * duplicates, excess racks, and placements that violate the 30% reserve are
 * dropped; all exact values are canonicalized and clamped non-negative.
 */
export const normalizeFacilityState = (value: unknown): FacilityState => {
  const source = isRecord(value) ? value : {};
  const templateId = isFacilityTemplateId(source.templateId)
    ? source.templateId
    : "workshopFacility";
  const facility: FacilityState = {
    id: isFacilityId(source.id) ? source.id : "facility-1",
    name: normalizeText(
      source.name,
      getFacilityTemplateDefinition(templateId).name,
      MAX_NAME_LENGTH,
    ),
    templateId,
    nextEntityId: 1,
    racks: [],
  };
  const rackSlots = getFacilityTemplateDefinition(templateId).rackSlots;
  const rawRacks = Array.isArray(source.racks)
    ? source.racks
        .map(normalizeFacilityRackState)
        .filter((rack): rack is FacilityRackState => rack !== null)
        .sort((left, right) => compareEntityIds(left.id, right.id))
    : [];
  const rackIds = new Set<string>();
  const placementIds = new Set<string>();
  const equipmentIds = new Set<string>();

  for (const normalizedRack of rawRacks) {
    if (facility.racks.length >= rackSlots) break;
    if (rackIds.has(normalizedRack.id)) continue;
    rackIds.add(normalizedRack.id);
    const emptyRack: FacilityRackState = {
      ...normalizedRack,
      placements: [],
    };
    facility.racks.push(emptyRack);
    for (const placement of normalizedRack.placements) {
      if (
        placementIds.has(placement.id) ||
        equipmentIds.has(placement.equipment.id)
      ) {
        continue;
      }
      if (
        getFacilityPlacementAdmissionBlockers(
          facility,
          emptyRack.id,
          placement.equipment,
          DEFAULT_FACILITY_HEADROOM_BPS,
        ).length > 0
      ) {
        continue;
      }
      const currentRack = facility.racks.find(
        (rack) => rack.id === emptyRack.id,
      )!;
      const updatedRack: FacilityRackState = {
        ...currentRack,
        placements: [...currentRack.placements, placement],
      };
      facility.racks = facility.racks.map((rack) =>
        rack.id === updatedRack.id ? updatedRack : rack,
      );
      placementIds.add(placement.id);
      equipmentIds.add(placement.equipment.id);
    }
  }

  const acceptedIds = facility.racks.flatMap((rack) => [
    rack.id,
    ...rack.placements.map((placement) => placement.id),
  ]);
  const maximumAcceptedEntity = Math.max(
    0,
    ...acceptedIds.map((id) => parseEntityNumber(id) ?? 0),
  );
  const savedNextEntityId = normalizePositiveInteger(source.nextEntityId, 1);
  facility.nextEntityId = Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(savedNextEntityId, maximumAcceptedEntity + 1),
  );
  return facility;
};
