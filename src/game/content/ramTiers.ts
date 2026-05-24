import type { Cost, CpuTierId, ResearchId } from "../types";
import { getCpuTierLevelDefinition } from "./cpuTiers";

export interface RamTierLevelDefinition {
  level: number;
  globalLevel: number;
  upgradeCost: number;
  calculatedCost: number;
  dataCost: number;
  efficiency: number;
  clockHz: number;
  capacityBits: number;
  singleChannelBps: number;
  dualChannelBps: number;
  quadChannelBps: number;
  octChannelBps: number;
  idleMicroWatts: number;
  memoryVoltageIdleMultiplier: number;
  memoryVoltageCost: number;
}

export interface RamTierDefinition {
  id: CpuTierId;
  name: string;
  unit: string;
  unlockResearchId: ResearchId | null;
  nextTierResearchCost: number | null;
  firstGlobalLevel: number;
  levels: RamTierLevelDefinition[];
}

export const RAM_TIER_MAX_LEVEL = 36;
export const RAM_TIER_COUNT = 6;
export const RAM_MAX_LEVEL = RAM_TIER_MAX_LEVEL * RAM_TIER_COUNT;

const credits = (amount: number): Cost => ({
  resource: "credits",
  amount: Math.round(amount),
});

const roundTo = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const tierMetadata: Array<
  Omit<RamTierDefinition, "firstGlobalLevel" | "levels"> & {
    tierIndex: number;
    baseEfficiency: number;
    efficiencyDecay: number;
    minEfficiency: number;
  }
> = [
  {
    id: "hz",
    name: "Hz RAM",
    unit: "Hz",
    unlockResearchId: null,
    nextTierResearchCost: 2_000_000,
    tierIndex: 0,
    baseEfficiency: 10,
    efficiencyDecay: 0.92,
    minEfficiency: 0.6,
  },
  {
    id: "khz",
    name: "kHz RAM",
    unit: "kHz",
    unlockResearchId: "cpuTierKhz",
    nextTierResearchCost: 20_000_000_000,
    tierIndex: 1,
    baseEfficiency: 6,
    efficiencyDecay: 0.93,
    minEfficiency: 0.5,
  },
  {
    id: "mhz",
    name: "MHz RAM",
    unit: "MHz",
    unlockResearchId: "cpuTierMhz",
    nextTierResearchCost: 200_000_000_000_000,
    tierIndex: 2,
    baseEfficiency: 3,
    efficiencyDecay: 0.94,
    minEfficiency: 0.3,
  },
  {
    id: "ghz",
    name: "GHz RAM",
    unit: "GHz",
    unlockResearchId: "cpuTierGhz",
    nextTierResearchCost: 200_000_000_000_000_000,
    tierIndex: 3,
    baseEfficiency: 2,
    efficiencyDecay: 0.96,
    minEfficiency: 0.5,
  },
  {
    id: "thz",
    name: "THz RAM",
    unit: "THz",
    unlockResearchId: "cpuTierThz",
    nextTierResearchCost: 2_000_000_000_000_000_000,
    tierIndex: 4,
    baseEfficiency: 1,
    efficiencyDecay: 0.98,
    minEfficiency: 0.5,
  },
  {
    id: "phz",
    name: "PHz RAM",
    unit: "PHz",
    unlockResearchId: "cpuTierPhz",
    nextTierResearchCost: null,
    tierIndex: 5,
    baseEfficiency: 0.5,
    efficiencyDecay: 0.99,
    minEfficiency: 0.5,
  },
];

const getEfficiency = (
  level: number,
  baseEfficiency: number,
  decay: number,
  minimum: number,
) => roundTo(Math.max(minimum, baseEfficiency * decay ** (level - 1)), 1);

const getMemoryVoltageCostValue = (level: number) => {
  let cost = 100_000;

  for (let currentLevel = 2; currentLevel <= level; currentLevel += 1) {
    cost = Math.round(cost * 1.8);
  }

  return cost;
};

const getMemoryVoltageMultiplier = (level: number) =>
  roundTo(Math.max(0.02, 0.74 - level * 0.02), 2);

const getRamCapacityCost = (cpuStyleCost: number, tierLevelIndex: number) =>
  Math.round(cpuStyleCost * 2 ** tierLevelIndex);

export const ramTierDefinitions: RamTierDefinition[] = tierMetadata.map((tier) => {
  const firstGlobalLevel = tier.tierIndex * RAM_TIER_MAX_LEVEL + 1;
  const levels = Array.from({ length: RAM_TIER_MAX_LEVEL }, (_, index) => {
    const level = index + 1;
    const globalLevel = firstGlobalLevel + index;
    const capacityBits = 256 * 2 ** index * 1024 ** tier.tierIndex;
    const cpuTierLevel = getCpuTierLevelDefinition(tier.id, level);
    const cpuStyleCost = cpuTierLevel.upgradeCost;
    const clockHz = cpuTierLevel.clockHz;
    const efficiency = getEfficiency(
      level,
      tier.baseEfficiency,
      tier.efficiencyDecay,
      tier.minEfficiency,
    );

    return {
      level,
      globalLevel,
      upgradeCost: cpuStyleCost,
      calculatedCost: getRamCapacityCost(cpuStyleCost, index),
      dataCost: Math.round((capacityBits / 8) * (1 + tier.tierIndex * 0.35)),
      efficiency,
      clockHz,
      capacityBits,
      singleChannelBps: clockHz,
      dualChannelBps: clockHz * 2,
      quadChannelBps: clockHz * 4,
      octChannelBps: clockHz * 8,
      idleMicroWatts: (clockHz / efficiency) * 0.1,
      memoryVoltageIdleMultiplier: getMemoryVoltageMultiplier(level),
      memoryVoltageCost: getMemoryVoltageCostValue(level),
    };
  });

  return {
    id: tier.id,
    name: tier.name,
    unit: tier.unit,
    unlockResearchId: tier.unlockResearchId,
    nextTierResearchCost: tier.nextTierResearchCost,
    firstGlobalLevel,
    levels,
  };
});

export const getRamTierDefinition = (tierId: CpuTierId) => {
  const tier = ramTierDefinitions.find((definition) => definition.id === tierId);
  if (!tier) throw new Error(`Unknown RAM tier: ${tierId}`);
  return tier;
};

export const getRamTierIndex = (tierId: CpuTierId) =>
  ramTierDefinitions.findIndex((definition) => definition.id === tierId);

export const getRamTierDefinitionForLevel = (level: number) => {
  const boundedLevel = Math.max(1, Math.min(RAM_MAX_LEVEL, Math.trunc(level)));
  const tierIndex = Math.floor((boundedLevel - 1) / RAM_TIER_MAX_LEVEL);
  const tier = ramTierDefinitions[tierIndex];
  if (!tier) throw new Error(`Unknown RAM level: ${level}`);
  return tier;
};

export const getRamTierLevelDefinition = (level: number) => {
  const boundedLevel = Math.max(1, Math.min(RAM_MAX_LEVEL, Math.trunc(level)));
  const tier = getRamTierDefinitionForLevel(boundedLevel);
  const tierLevel = ((boundedLevel - 1) % RAM_TIER_MAX_LEVEL) + 1;
  const definition = tier.levels[tierLevel - 1];
  if (!definition) throw new Error(`Unknown RAM tier level: ${level}`);
  return definition;
};

export const getRamTierFirstGlobalLevel = (tierId: CpuTierId) =>
  getRamTierDefinition(tierId).firstGlobalLevel;

export const getRamTierInstallCost = (targetLevel: number): Cost[] => {
  const level = getRamTierLevelDefinition(targetLevel);
  return [credits(level.upgradeCost)];
};

export const getRamTierCapacityUpgradeCost = (targetLevel: number): Cost[] => {
  const level = getRamTierLevelDefinition(targetLevel);
  return [credits(level.calculatedCost)];
};

export const getRamTierSpeedUpgradeCost = (targetLevel: number): Cost[] => [
  credits(getRamTierLevelDefinition(targetLevel).upgradeCost),
];
