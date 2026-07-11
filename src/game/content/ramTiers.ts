import type { Cost, CpuTierId, ResearchId } from "../types";
import { V1_HARDWARE_LIMITS } from "../hardwareLimits";
import { getCpuTierLevelDefinition } from "./cpuTiers";
import {
  amount,
  amountAdd,
  amountMultiply,
  amountPow,
  amountRound,
  type Amount,
  type AmountInput,
} from "../amount";
import { roundedCost } from "../exactCosts";

export interface RamTierLevelDefinition {
  level: number;
  globalLevel: number;
  upgradeCost: Amount;
  calculatedCost: Amount;
  dataCost: Amount;
  efficiency: number;
  clockHz: number;
  capacityBits: number;
  singleChannelBps: number;
  dualChannelBps: number;
  quadChannelBps: number;
  octChannelBps: number;
  idleMicroWatts: number;
  memoryVoltageIdleMultiplier: number;
  memoryVoltageCost: Amount;
}

export interface RamTierDefinition {
  id: CpuTierId;
  name: string;
  unit: string;
  unlockResearchId: ResearchId | null;
  nextTierResearchCost: Amount | null;
  firstGlobalLevel: number;
  levels: RamTierLevelDefinition[];
}

export const RAM_TIER_MAX_LEVEL = V1_HARDWARE_LIMITS.ramTierLevels;
export const RAM_TIER_COUNT = 4;
export const RAM_MAX_LEVEL = RAM_TIER_MAX_LEVEL * RAM_TIER_COUNT;

const credits = (value: AmountInput): Cost => roundedCost("credits", value);

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
    nextTierResearchCost: amount("2000000"),
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
    nextTierResearchCost: amount("20000000000"),
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
    nextTierResearchCost: amount("200000000000000"),
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
    nextTierResearchCost: null,
    tierIndex: 3,
    baseEfficiency: 2,
    efficiencyDecay: 0.96,
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
  let cost = amount("100000");

  for (let currentLevel = 2; currentLevel <= level; currentLevel += 1) {
    cost = amountRound(amountMultiply(cost, "1.8"));
  }

  return cost;
};

const getMemoryVoltageMultiplier = (level: number) =>
  roundTo(Math.max(0.02, 0.74 - level * 0.02), 2);

const getRamCapacityCost = (cpuStyleCost: Amount, tierLevelIndex: number) =>
  amountRound(amountMultiply(cpuStyleCost, amountPow(2, tierLevelIndex)));

const getRamDataCost = (tierIndex: number, tierLevelIndex: number) => {
  const capacityBits = amountMultiply(
    "256",
    amountMultiply(amountPow(2, tierLevelIndex), amountPow(1024, tierIndex)),
  );
  return amountRound(
    amountMultiply(
      amountMultiply(capacityBits, "0.125"),
      amountAdd("1", amountMultiply("0.35", tierIndex)),
    ),
  );
};

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
      dataCost: getRamDataCost(tier.tierIndex, index),
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
