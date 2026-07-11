import {
  ZERO_AMOUNT,
  amountAdd,
  amountClampMin,
  amountDivide,
  amountMultiply,
  exactCost,
  type Amount,
  type ExactCost,
} from "../amount";
import {
  getCoolingPowerWatts,
  normalizeCoolingUpgradePath,
  type CoolingState,
  type CoolingUpgradeDefinition,
} from "../thermal";

export type WorkshopCoolingTierId =
  | "none"
  | "passiveHeatsink"
  | "fanCooling"
  | "caseAirflow"
  | "liquidCooling";

export type OverclockPresetId =
  | "stock"
  | "boost"
  | "performance"
  | "extreme";

export interface WorkshopCoolingTierDefinition
  extends CoolingUpgradeDefinition {
  id: WorkshopCoolingTierId;
  name: string;
  description: string;
  costs: readonly ExactCost[];
  /** Scales heat generated before the thermal kernel sees it. */
  heatBuildupModifierBps: number;
  maxOverclockBps: number;
}

export interface OverclockPresetDefinition {
  id: OverclockPresetId;
  name: string;
  description: string;
  clockMultiplierBps: number;
  powerMultiplierBps: number;
  heatMultiplierBps: number;
  minimumCoolingTierId: WorkshopCoolingTierId;
}

const rawCoolingTierDefinitions: readonly WorkshopCoolingTierDefinition[] = [
  {
    id: "none",
    name: "No Cooling",
    description: "No installed heat sink or active airflow.",
    level: 0,
    capacityWatts: ZERO_AMOUNT,
    powerDrawWatts: ZERO_AMOUNT,
    costs: [],
    heatBuildupModifierBps: 10_000,
    maxOverclockBps: 10_000,
  },
  {
    id: "passiveHeatsink",
    name: "Passive Heatsink",
    description: "Raises the sustained heat threshold without active power draw.",
    level: 1,
    capacityWatts: amountClampMin("650"),
    powerDrawWatts: ZERO_AMOUNT,
    costs: [
      exactCost("credits", "500000"),
      exactCost("data", "40"),
    ],
    heatBuildupModifierBps: 10_000,
    maxOverclockBps: 10_000,
  },
  {
    id: "fanCooling",
    name: "Fan Cooling",
    description: "Adds powered airflow for faster cooldown and higher sustained load.",
    level: 2,
    capacityWatts: amountClampMin("1200"),
    powerDrawWatts: amountClampMin("12"),
    costs: [
      exactCost("credits", "2000000"),
      exactCost("data", "120"),
    ],
    heatBuildupModifierBps: 10_000,
    maxOverclockBps: 11_000,
  },
  {
    id: "caseAirflow",
    name: "Case Airflow",
    description: "Channels intake and exhaust to reduce system heat buildup.",
    level: 3,
    capacityWatts: amountClampMin("2400"),
    powerDrawWatts: amountClampMin("28"),
    costs: [
      exactCost("credits", "7500000"),
      exactCost("data", "260"),
    ],
    heatBuildupModifierBps: 8_500,
    maxOverclockBps: 12_500,
  },
  {
    id: "liquidCooling",
    name: "Liquid Cooling",
    description: "Moves dense heat efficiently and enables the strongest overclock.",
    level: 4,
    capacityWatts: amountClampMin("6000"),
    powerDrawWatts: amountClampMin("95"),
    costs: [
      exactCost("credits", "25000000"),
      exactCost("data", "600"),
    ],
    heatBuildupModifierBps: 7_000,
    maxOverclockBps: 15_000,
  },
] as const;

const normalizedCoolingPath = normalizeCoolingUpgradePath(
  rawCoolingTierDefinitions,
);

export const workshopCoolingTierDefinitions: readonly WorkshopCoolingTierDefinition[] =
  rawCoolingTierDefinitions.map((definition) => {
    const normalized = normalizedCoolingPath.find(
      (candidate) => candidate.id === definition.id,
    );
    if (!normalized) {
      throw new Error(`Missing normalized cooling tier: ${definition.id}`);
    }
    return { ...definition, ...normalized, id: definition.id };
  });

export const overclockPresetDefinitions: readonly OverclockPresetDefinition[] = [
  {
    id: "stock",
    name: "Stock",
    description: "Runs at the CPU package's rated clock and power envelope.",
    clockMultiplierBps: 10_000,
    powerMultiplierBps: 10_000,
    heatMultiplierBps: 10_000,
    minimumCoolingTierId: "none",
  },
  {
    id: "boost",
    name: "Boost",
    description: "A mild active-cooling overclock for short and sustained work.",
    clockMultiplierBps: 11_000,
    powerMultiplierBps: 12_500,
    heatMultiplierBps: 13_000,
    minimumCoolingTierId: "fanCooling",
  },
  {
    id: "performance",
    name: "Performance",
    description: "A stronger case-airflow overclock with a steep power curve.",
    clockMultiplierBps: 12_500,
    powerMultiplierBps: 17_000,
    heatMultiplierBps: 18_500,
    minimumCoolingTierId: "caseAirflow",
  },
  {
    id: "extreme",
    name: "Extreme",
    description: "The liquid-cooled ceiling for deliberate burst tuning.",
    clockMultiplierBps: 15_000,
    powerMultiplierBps: 25_000,
    heatMultiplierBps: 29_000,
    minimumCoolingTierId: "liquidCooling",
  },
] as const;

const coolingById = new Map(
  workshopCoolingTierDefinitions.map((definition) => [
    definition.id,
    definition,
  ]),
);
const overclockById = new Map(
  overclockPresetDefinitions.map((definition) => [definition.id, definition]),
);

export const isWorkshopCoolingTierId = (
  value: unknown,
): value is WorkshopCoolingTierId =>
  typeof value === "string" &&
  coolingById.has(value as WorkshopCoolingTierId);

export const isOverclockPresetId = (
  value: unknown,
): value is OverclockPresetId =>
  typeof value === "string" && overclockById.has(value as OverclockPresetId);

export const getWorkshopCoolingTierDefinition = (
  id: WorkshopCoolingTierId,
) => coolingById.get(id)!;

export const getOverclockPresetDefinition = (id: OverclockPresetId) =>
  overclockById.get(id)!;

export const getWorkshopCoolingState = (
  id: WorkshopCoolingTierId,
): CoolingState => {
  const definition = getWorkshopCoolingTierDefinition(id);
  return {
    level: definition.level,
    capacityWatts: definition.capacityWatts,
    powerDrawWatts: definition.powerDrawWatts,
  };
};

export const getNextWorkshopCoolingTier = (
  currentId: WorkshopCoolingTierId,
) => {
  const current = getWorkshopCoolingTierDefinition(currentId);
  return (
    workshopCoolingTierDefinitions.find(
      (definition) => definition.level === current.level + 1,
    ) ?? null
  );
};

export const getOverclockBlockedReason = (
  coolingTierId: WorkshopCoolingTierId,
  presetId: OverclockPresetId,
) => {
  const cooling = getWorkshopCoolingTierDefinition(coolingTierId);
  const preset = getOverclockPresetDefinition(presetId);
  if (preset.clockMultiplierBps <= cooling.maxOverclockBps) return null;
  return `Requires ${getWorkshopCoolingTierDefinition(
    preset.minimumCoolingTierId,
  ).name}.`;
};

export const getAllowedOverclockPresets = (
  coolingTierId: WorkshopCoolingTierId,
) =>
  overclockPresetDefinitions.filter(
    (preset) => getOverclockBlockedReason(coolingTierId, preset.id) === null,
  );

const scaleExactByBps = (value: Amount | string | number, bps: number) =>
  amountDivide(
    amountMultiply(amountClampMin(value), Math.max(0, Math.trunc(bps))),
    10_000,
  );

export const applyCoolingHeatBuildup = (
  heatWatts: Amount | string | number,
  coolingTierId: WorkshopCoolingTierId,
) =>
  scaleExactByBps(
    heatWatts,
    getWorkshopCoolingTierDefinition(coolingTierId)
      .heatBuildupModifierBps,
  );

export const applyOverclockPower = (
  powerWatts: Amount | string | number,
  presetId: OverclockPresetId,
) =>
  scaleExactByBps(
    powerWatts,
    getOverclockPresetDefinition(presetId).powerMultiplierBps,
  );

export const applyOverclockHeat = (
  heatWatts: Amount | string | number,
  presetId: OverclockPresetId,
) =>
  scaleExactByBps(
    heatWatts,
    getOverclockPresetDefinition(presetId).heatMultiplierBps,
  );

export interface WorkshopCoolingProjection {
  hardwarePowerWatts: Amount;
  coolingPowerWatts: Amount;
  totalPowerWatts: Amount;
  generatedHeatWatts: Amount;
  coolingCapacityWatts: Amount;
}

/** Exact projection only; callers decide how the thermal modifier affects work. */
export const projectWorkshopCooling = (input: {
  basePowerWatts: Amount | string | number;
  baseHeatWatts: Amount | string | number;
  coolingTierId: WorkshopCoolingTierId;
  overclockPresetId: OverclockPresetId;
  powered: boolean;
}): WorkshopCoolingProjection => {
  const cooling = getWorkshopCoolingState(input.coolingTierId);
  const hardwarePowerWatts = input.powered
    ? applyOverclockPower(input.basePowerWatts, input.overclockPresetId)
    : ZERO_AMOUNT;
  const coolingPowerWatts = getCoolingPowerWatts(input.powered, cooling);
  const overclockedHeat = input.powered
    ? applyOverclockHeat(input.baseHeatWatts, input.overclockPresetId)
    : ZERO_AMOUNT;
  return {
    hardwarePowerWatts,
    coolingPowerWatts,
    totalPowerWatts: amountAdd(hardwarePowerWatts, coolingPowerWatts),
    generatedHeatWatts: applyCoolingHeatBuildup(
      overclockedHeat,
      input.coolingTierId,
    ),
    coolingCapacityWatts: cooling.capacityWatts,
  };
};
