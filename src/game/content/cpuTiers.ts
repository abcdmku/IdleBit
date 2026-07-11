import type { Cost, CpuTierId, ResearchId } from "../types";
import { V1_HARDWARE_LIMITS } from "../hardwareLimits";
import {
  amount,
  amountMultiply,
  amountPow,
  amountRound,
  type Amount,
  type AmountInput,
} from "../amount";
import { roundedCost } from "../exactCosts";

export interface CpuTierLevelDefinition {
  level: number;
  upgradeCost: Amount;
  clockHz: number;
  efficiency: number;
  cStateCost?: Amount;
  cStateIdleMultiplier?: number;
}

export interface CpuTierDefinition {
  id: CpuTierId;
  name: string;
  unit: string;
  unlockResearchId: ResearchId | null;
  nextTierResearchCost: Amount | null;
  levels: CpuTierLevelDefinition[];
}

const credits = (value: AmountInput): Cost => roundedCost("credits", value);

export const CPU_TIER_MAX_LEVEL = V1_HARDWARE_LIMITS.cpuLevel;

const cpuTierCosts: Record<CpuTierId, Array<number | string>> = {
  hz: [8, 13, 22, 36, 59, 97, 158, 257, 418, 679, 1106, 1799, 2927, 4761, 7745, 12599, 20496, 33341, 54238, 88230, 143524, 233471, 379789, 617806, 1004993, 1634831, 2659391, 4326052, 7037227, 11447517, 18621769, 30292180, 49276527, 80158511, 130394463, 212113671],
  khz: [32000, 51808, 84277, 137094, 223012, 362778, 590134, 959979, 1561608, 2540280, 4132293, 6722037, 10934789, 17787710, 28935410, 47069459, 76568249, 124554165, 202613222, 329592480, 536150621, 872160331, 1418749888, 2307891306, 3754264473, 6107090778, 9934451345, 16160448068, 26288324629, 42763418958, 69563581050, 113159609928, 184077603935, 299440447766, 487102069135, 792372665537],
  mhz: [126000000, 206252631, 335512735, 545781134, 887826350, 1444233922, 2349346379, 3821699742, 6216788248, 10112897059, 16450727095, 26760523744, 43531548874, 70813103887, 115192218294, 187384063528, 304819090903, 495851549141, 806605511621, 1312111361769, 2134421598759, 3472079957575, 5648059052042, 9187740906045, 14945768480580, 24312396024068, 39549160767485, 64334922640413, 104654111258647, 170241644099758, 276933385962709, 450489659368133, 732814978201810, 1192075736056190, 1939158727323980, 3154444349481770],
  ghz: [500000000000, 821106514702, 1335700254512, 2172793831200, 3534500361853, 5749598801576, 9352916394032, 15214460711549, 24749479733507, 40260168184227, 65491523849199, 106535563300840, 173302216542609, 281912042589762, 458588478224015, 745989388845682, 1213506650724360, 1974020560306850, 3211154360124960, 5223609384770890, 8497285382321270, "13822599193407600", "22485327944745800", "36577055133299700", "59500175648408200", "96789391308005700", "157448043937411000", "256121938620626000", "416635518627747000", "677744188245157000", "1102491660367760000", "1793431625474580000", "2917388957100570000", "4745738954369200000", "7719929894230030000", "12558069068876600000"],
};

const tierMetadata: Array<
  Omit<CpuTierDefinition, "levels"> & {
    baseClockHz: number;
    maxClockHz: number;
    clockDecimals: number;
    baseEfficiency: number;
    efficiencyDecay: number;
    minEfficiency: number;
  }
> = [
  {
    id: "hz",
    name: "Hz CPU",
    unit: "Hz",
    unlockResearchId: null,
    nextTierResearchCost: amount("2000000"),
    baseClockHz: 1,
    maxClockHz: 999,
    clockDecimals: 1,
    baseEfficiency: 10,
    efficiencyDecay: 0.92,
    minEfficiency: 0.6,
  },
  {
    id: "khz",
    name: "kHz CPU",
    unit: "kHz",
    unlockResearchId: "cpuTierKhz",
    nextTierResearchCost: amount("20000000000"),
    baseClockHz: 1_000,
    maxClockHz: 999_999,
    clockDecimals: 0,
    baseEfficiency: 6,
    efficiencyDecay: 0.93,
    minEfficiency: 0.5,
  },
  {
    id: "mhz",
    name: "MHz CPU",
    unit: "MHz",
    unlockResearchId: "cpuTierMhz",
    nextTierResearchCost: amount("200000000000000"),
    baseClockHz: 1_000_000,
    maxClockHz: 999_999_999,
    clockDecimals: 0,
    baseEfficiency: 3,
    efficiencyDecay: 0.94,
    minEfficiency: 0.3,
  },
  {
    id: "ghz",
    name: "GHz CPU",
    unit: "GHz",
    unlockResearchId: "cpuTierGhz",
    nextTierResearchCost: null,
    baseClockHz: 1_000_000_000,
    maxClockHz: 6_000_000_000,
    clockDecimals: 0,
    baseEfficiency: 2,
    efficiencyDecay: 0.96,
    minEfficiency: 0.5,
  },
];

const roundTo = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const getClockValues = (
  baseClockHz: number,
  maxClockHz: number,
  decimals: number,
) => {
  const values = [baseClockHz];
  const minimumStep = 10 ** -decimals;

  // Retain the familiar 1.5x opening progression, then taper the remaining
  // levels into the tier ceiling instead of spilling into the next unit.
  while (values.length < CPU_TIER_MAX_LEVEL) {
    const next = roundTo(values.at(-1)! * 1.5, decimals);
    const levelsAfterNext = CPU_TIER_MAX_LEVEL - values.length - 1;
    if (next + levelsAfterNext * minimumStep >= maxClockHz) break;
    values.push(next);
  }

  const start = values.at(-1)!;
  const remainingLevels = CPU_TIER_MAX_LEVEL - values.length;
  for (let index = 1; index <= remainingLevels; index += 1) {
    values.push(
      index === remainingLevels
        ? maxClockHz
        : roundTo(
            start + ((maxClockHz - start) * index) / remainingLevels,
            decimals,
          ),
    );
  }

  return values;
};

const getEfficiency = (
  level: number,
  baseEfficiency: number,
  decay: number,
  minimum: number,
) => roundTo(Math.max(minimum, baseEfficiency * decay ** (level - 1)), 1);

const getCStateCost = (level: number) =>
  amountRound(
    amountMultiply("1000000", amountPow("1.4", Math.max(0, level - 1))),
  );

const getCStateMultiplier = (level: number) =>
  roundTo(Math.max(0.02, 0.74 - level * 0.02), 2);

export const cpuTierDefinitions: CpuTierDefinition[] = tierMetadata.map((tier) => {
  const clockValues = getClockValues(
    tier.baseClockHz,
    tier.maxClockHz,
    tier.clockDecimals,
  );
  const costs = cpuTierCosts[tier.id];

  return {
    id: tier.id,
    name: tier.name,
    unit: tier.unit,
    unlockResearchId: tier.unlockResearchId,
    nextTierResearchCost: tier.nextTierResearchCost,
    levels: costs.map((upgradeCost, index) => {
      const level = index + 1;

      return {
        level,
        upgradeCost: amount(upgradeCost),
        clockHz: clockValues[index] ?? tier.baseClockHz,
        efficiency: getEfficiency(
          level,
          tier.baseEfficiency,
          tier.efficiencyDecay,
          tier.minEfficiency,
        ),
        ...(tier.id === "hz"
          ? {
              cStateCost: getCStateCost(level),
              cStateIdleMultiplier: getCStateMultiplier(level),
            }
          : {}),
      };
    }),
  };
});

export const cpuTierResearchOrder = cpuTierDefinitions
  .filter(
    (tier): tier is CpuTierDefinition & { unlockResearchId: ResearchId } =>
      tier.unlockResearchId !== null,
  )
  .map((tier) => tier.unlockResearchId);

export const getCpuTierDefinition = (tierId: CpuTierId) => {
  const tier = cpuTierDefinitions.find((definition) => definition.id === tierId);
  if (!tier) throw new Error(`Unknown CPU tier: ${tierId}`);
  return tier;
};

export const getCpuTierIndex = (tierId: CpuTierId) =>
  cpuTierDefinitions.findIndex((definition) => definition.id === tierId);

export const getCpuTierLevelDefinition = (
  tierId: CpuTierId,
  level: number,
) => {
  const tier = getCpuTierDefinition(tierId);
  const boundedLevel = Math.max(
    1,
    Math.min(CPU_TIER_MAX_LEVEL, Math.trunc(level)),
  );
  const definition = tier.levels[boundedLevel - 1];
  if (!definition) {
    throw new Error(`Unknown CPU tier level: ${tierId} ${level}`);
  }
  return definition;
};

export const getCpuTierPurchaseCost = (tierId: CpuTierId) => [
  credits(getCpuTierLevelDefinition(tierId, 1).upgradeCost),
];

export const getCpuTierUpgradeCost = (
  tierId: CpuTierId,
  targetLevel: number,
) => [credits(getCpuTierLevelDefinition(tierId, targetLevel).upgradeCost)];

export const getCStateLevelDefinition = (level: number) =>
  level <= 0 ? null : getCpuTierLevelDefinition("hz", level);

export const getCStateUpgradeCost = (targetLevel: number) => {
  const level = getCStateLevelDefinition(targetLevel);
  return level?.cStateCost ? [credits(level.cStateCost)] : [];
};

export const getCStateIdleMultiplier = (level: number) =>
  getCStateLevelDefinition(level)?.cStateIdleMultiplier ?? 1;
