import type { Cost, CpuTierId, ResearchId } from "../types";

export interface CpuTierLevelDefinition {
  level: number;
  upgradeCost: number;
  clockHz: number;
  efficiency: number;
  cStateCost?: number;
  cStateIdleMultiplier?: number;
}

export interface CpuTierDefinition {
  id: CpuTierId;
  name: string;
  unit: string;
  unlockResearchId: ResearchId | null;
  nextTierResearchCost: number | null;
  levels: CpuTierLevelDefinition[];
}

const credits = (amount: number): Cost => ({
  resource: "credits",
  amount: Math.round(amount),
});

export const CPU_TIER_MAX_LEVEL = 36;

const cpuTierCosts: Record<CpuTierId, number[]> = {
  hz: [8, 13, 22, 36, 59, 97, 158, 257, 418, 679, 1106, 1799, 2927, 4761, 7745, 12599, 20496, 33341, 54238, 88230, 143524, 233471, 379789, 617806, 1004993, 1634831, 2659391, 4326052, 7037227, 11447517, 18621769, 30292180, 49276527, 80158511, 130394463, 212113671],
  khz: [32000, 51808, 84277, 137094, 223012, 362778, 590134, 959979, 1561608, 2540280, 4132293, 6722037, 10934789, 17787710, 28935410, 47069459, 76568249, 124554165, 202613222, 329592480, 536150621, 872160331, 1418749888, 2307891306, 3754264473, 6107090778, 9934451345, 16160448068, 26288324629, 42763418958, 69563581050, 113159609928, 184077603935, 299440447766, 487102069135, 792372665537],
  mhz: [126000000, 206252631, 335512735, 545781134, 887826350, 1444233922, 2349346379, 3821699742, 6216788248, 10112897059, 16450727095, 26760523744, 43531548874, 70813103887, 115192218294, 187384063528, 304819090903, 495851549141, 806605511621, 1312111361769, 2134421598759, 3472079957575, 5648059052042, 9187740906045, 14945768480580, 24312396024068, 39549160767485, 64334922640413, 104654111258647, 170241644099758, 276933385962709, 450489659368133, 732814978201810, 1192075736056190, 1939158727323980, 3154444349481770],
  ghz: [500000000000, 821106514702, 1335700254512, 2172793831200, 3534500361853, 5749598801576, 9352916394032, 15214460711549, 24749479733507, 40260168184227, 65491523849199, 106535563300840, 173302216542609, 281912042589762, 458588478224015, 745989388845682, 1213506650724360, 1974020560306850, 3211154360124960, 5223609384770890, 8497285382321270, 13822599193407600, 22485327944745800, 36577055133299700, 59500175648408200, 96789391308005700, 157448043937411000, 256121938620626000, 416635518627747000, 677744188245157000, 1102491660367760000, 1793431625474580000, 2917388957100570000, 4745738954369200000, 7719929894230030000, 12558069068876600000],
  thz: [2000000000000000, 3268883912911990, 5317518490312990, 8650048043349370, 14071099383774400, 22889565107131000, 37234630820513500, 60569859053722300, 98529453493777800, 160278616418308000, 260726452548419000, 424125716689914000, 689928550783808000, 1122312056202570000, 1825673615139800000, 2969837248559350000, 4831056991671090000, 7858717398771860000, 12783835765182400000, 20795563522451800000, 33828302409371300000, 55028758545753400000, 89515702870385600000, 145615879262780000000, 236874465747927000000, 385325507131745000000, 626811952810222000000, 1.01963980300798e21, 1.65865587472761e21, 2.69814821140999e21, 4.38909835467254e21, 7.13977989997896e21, 1.16143346311379e22, 1.88931270730693e22, 3.07335944705919e22, 4.99945734461918e22],
  phz: [7999999999999990000, 13013661254372400000, 21169422405444100000, 34436461516896300000, 56018055622514900000, 91124999999999900000, 148233735225585000000, 241132952087012000000, 392252819465897000000, 638080664825208000000, 1.037970703125e21, 1.68847489030393e21, 2.74665503236612e21, 4.46800477172874e21, 7.26813757277466e21, 1.18231350402832e22, 1.92327842973683e22, 3.12861174780455e22, 5.0893366852973e22, 8.2788629539887e22, 1.34672897568227e23, 2.19073433637212e23, 3.56368431898363e23, 5.79707256809645e23, 9.4301423335277e23, 1.53400847386308e24, 2.49538333002386e24, 4.05925916959229e24, 6.60322797209737e24, 1.07415215017839e25, 1.74733152725966e25, 2.84239757435529e25, 4.62374989786368e25, 7.52148936196711e25, 1.22352643356257e26, 1.99031981776921e26],
};

const tierMetadata: Array<
  Omit<CpuTierDefinition, "levels"> & {
    baseClockHz: number;
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
    nextTierResearchCost: 2_000_000,
    baseClockHz: 1,
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
    nextTierResearchCost: 20_000_000_000,
    baseClockHz: 1_000,
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
    nextTierResearchCost: 200_000_000_000_000,
    baseClockHz: 1_000_000,
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
    nextTierResearchCost: 200_000_000_000_000_000,
    baseClockHz: 1_000_000_000,
    clockDecimals: 0,
    baseEfficiency: 2,
    efficiencyDecay: 0.96,
    minEfficiency: 0.5,
  },
  {
    id: "thz",
    name: "THz CPU",
    unit: "THz",
    unlockResearchId: "cpuTierThz",
    nextTierResearchCost: 2_000_000_000_000_000_000,
    baseClockHz: 1_000_000_000_000,
    clockDecimals: 0,
    baseEfficiency: 1,
    efficiencyDecay: 0.98,
    minEfficiency: 0.5,
  },
  {
    id: "phz",
    name: "PHz CPU",
    unit: "PHz",
    unlockResearchId: "cpuTierPhz",
    nextTierResearchCost: null,
    baseClockHz: 1_000_000_000_000_000,
    clockDecimals: 0,
    baseEfficiency: 0.5,
    efficiencyDecay: 0.99,
    minEfficiency: 0.5,
  },
];

const roundTo = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const getClockValues = (baseClockHz: number, decimals: number) => {
  const values: number[] = [];
  let clockHz = baseClockHz;

  for (let level = 1; level <= CPU_TIER_MAX_LEVEL; level += 1) {
    values.push(clockHz);
    clockHz = roundTo(clockHz * 1.5, decimals);
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
  Math.round(1_000_000 * 1.4 ** (level - 1));

const getCStateMultiplier = (level: number) =>
  roundTo(Math.max(0.02, 0.74 - level * 0.02), 2);

export const cpuTierDefinitions: CpuTierDefinition[] = tierMetadata.map((tier) => {
  const clockValues = getClockValues(tier.baseClockHz, tier.clockDecimals);
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
        upgradeCost,
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
