import { amount, exactCost, type Amount, type ExactCost } from "./amount";

/**
 * Resources constrained while work is admitted to a rack or facility.
 * `coolingWatts` in a demand vector is the heat load that cooling must reject.
 */
export const facilityResourceIds = [
  "compute",
  "memoryBits",
  "storageBits",
  "powerWatts",
  "coolingWatts",
  "uplinkIngress",
  "uplinkEgress",
] as const;

export type FacilityResourceId = (typeof facilityResourceIds)[number];
export type FacilityResourceVector = Record<FacilityResourceId, Amount>;

/** Installed equipment supplies these workload-facing capacities. */
export const equipmentCapacityResourceIds = [
  "compute",
  "memoryBits",
  "storageBits",
  "uplinkIngress",
  "uplinkEgress",
] as const;

export type EquipmentCapacityResourceId =
  (typeof equipmentCapacityResourceIds)[number];
export type RackEquipmentCapacity = Record<EquipmentCapacityResourceId, Amount>;

export interface RackEquipmentProfile {
  /** Stable Fleet/server identity. A profile can be serialized without UI state. */
  id: string;
  name: string;
  rackUnits: number;
  capacity: RackEquipmentCapacity;
  /** Baseline envelope, including peak power and its corresponding heat load. */
  demand: FacilityResourceVector;
  operatingCostPerSecond: Amount;
}

export type RackTemplateId =
  | "halfRack"
  | "standardRack"
  | "highDensityRack";

export interface RackTemplateDefinition {
  id: RackTemplateId;
  name: string;
  description: string;
  rackUnits: number;
  powerWatts: Amount;
  coolingWatts: Amount;
  uplinkIngress: Amount;
  uplinkEgress: Amount;
  commissionCosts: ExactCost[];
  fixedOperatingCostPerSecond: Amount;
}

export type FacilityTemplateId =
  | "workshopFacility"
  | "edgeFacility"
  | "regionalFacility";

export interface FacilityTemplateDefinition {
  id: FacilityTemplateId;
  name: string;
  description: string;
  rackSlots: number;
  powerWatts: Amount;
  coolingWatts: Amount;
  uplinkIngress: Amount;
  uplinkEgress: Amount;
  commissionCosts: ExactCost[];
  fixedOperatingCostPerSecond: Amount;
  /** Credits per watt-second while productive work is running. */
  energyCostPerWattSecond: Amount;
}

export const rackTemplateDefinitions: readonly RackTemplateDefinition[] = [
  {
    id: "halfRack",
    name: "Workshop Half Rack",
    description: "A compact 24U rack for the first managed server room.",
    rackUnits: 24,
    powerWatts: amount("12000"),
    coolingWatts: amount("10000"),
    uplinkIngress: amount("100000000000"),
    uplinkEgress: amount("100000000000"),
    commissionCosts: [exactCost("credits", "100000")],
    fixedOperatingCostPerSecond: amount("0.01"),
  },
  {
    id: "standardRack",
    name: "Standard 42U Rack",
    description: "A general-purpose rack with balanced power, cooling, and fabric.",
    rackUnits: 42,
    powerWatts: amount("30000"),
    coolingWatts: amount("28000"),
    uplinkIngress: amount("400000000000"),
    uplinkEgress: amount("400000000000"),
    commissionCosts: [exactCost("credits", "2500000")],
    fixedOperatingCostPerSecond: amount("0.04"),
  },
  {
    id: "highDensityRack",
    name: "High-Density 48U Rack",
    description: "A liquid-cooled rack for dense compute and fabric workloads.",
    rackUnits: 48,
    powerWatts: amount("80000"),
    coolingWatts: amount("75000"),
    uplinkIngress: amount("1000000000000"),
    uplinkEgress: amount("1000000000000"),
    commissionCosts: [exactCost("credits", "12000000")],
    fixedOperatingCostPerSecond: amount("0.12"),
  },
] as const;

export const facilityTemplateDefinitions: readonly FacilityTemplateDefinition[] = [
  {
    id: "workshopFacility",
    name: "Workshop Server Room",
    description: "A four-rack room with metered utility power and a shared uplink.",
    rackSlots: 4,
    powerWatts: amount("100000"),
    coolingWatts: amount("90000"),
    uplinkIngress: amount("800000000000"),
    uplinkEgress: amount("800000000000"),
    commissionCosts: [exactCost("credits", "500000")],
    fixedOperatingCostPerSecond: amount("0.25"),
    energyCostPerWattSecond: amount("0.00000002"),
  },
  {
    id: "edgeFacility",
    name: "Edge Data Center",
    description: "A sixteen-rack facility with redundant plant and metro fabric.",
    rackSlots: 16,
    powerWatts: amount("600000"),
    coolingWatts: amount("550000"),
    uplinkIngress: amount("10000000000000"),
    uplinkEgress: amount("10000000000000"),
    commissionCosts: [exactCost("credits", "50000000")],
    fixedOperatingCostPerSecond: amount("2"),
    energyCostPerWattSecond: amount("0.000000018"),
  },
  {
    id: "regionalFacility",
    name: "Regional Data Center",
    description: "A sixty-four-rack campus block with carrier-scale uplinks.",
    rackSlots: 64,
    powerWatts: amount("4000000"),
    coolingWatts: amount("3800000"),
    uplinkIngress: amount("200000000000000"),
    uplinkEgress: amount("200000000000000"),
    commissionCosts: [exactCost("credits", "500000000")],
    fixedOperatingCostPerSecond: amount("15"),
    energyCostPerWattSecond: amount("0.000000015"),
  },
] as const;

const rackTemplateById = new Map(
  rackTemplateDefinitions.map((definition) => [definition.id, definition]),
);
const facilityTemplateById = new Map(
  facilityTemplateDefinitions.map((definition) => [definition.id, definition]),
);

export const isRackTemplateId = (value: unknown): value is RackTemplateId =>
  typeof value === "string" && rackTemplateById.has(value as RackTemplateId);

export const isFacilityTemplateId = (
  value: unknown,
): value is FacilityTemplateId =>
  typeof value === "string" &&
  facilityTemplateById.has(value as FacilityTemplateId);

export const getRackTemplateDefinition = (id: RackTemplateId) =>
  rackTemplateById.get(id)!;

export const getFacilityTemplateDefinition = (id: FacilityTemplateId) =>
  facilityTemplateById.get(id)!;
