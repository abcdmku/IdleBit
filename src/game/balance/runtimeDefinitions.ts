import { amountMultiply } from "../amount";
import {
  BOOTLOADER_MAX_LEVEL,
  getBootSecondsForBootloaderLevel,
  getBootloaderUpgradeCost,
} from "../bootloader";
import { researchDefinitions } from "../content/research";
import {
  CPU_TIER_MAX_LEVEL,
  cpuTierDefinitions,
  getCStateUpgradeCost,
} from "../content/cpuTiers";
import { getPsuCapacityUpgradeCost } from "../content/psu";
import {
  RAM_MAX_LEVEL,
  getRamTierCapacityUpgradeCost,
  getRamTierSpeedUpgradeCost,
  ramTierDefinitions,
} from "../content/ramTiers";
import {
  MEMORY_VOLTAGE_MAX_LEVEL,
  getMemoryVoltageCost,
  getMemoryVoltageIdleMultiplier,
} from "../content/ramTuning";
import { upgradeDefinitions } from "../content/upgrades";
import { V1_HARDWARE_LIMITS } from "../hardwareLimits";
import {
  campaignObjectiveDefinitions,
  finaleCharterDefinitions,
  sideArcDefinitions,
} from "../campaign";
import {
  canonicalPlanetaryFinalePlan,
  finaleCharterModifiers,
} from "../planetary";
import { createInitialGameState, getPsuWatts } from "../progression";
import { workshopStorageWorkloadDefinition } from "../workshopStorage";
import type {
  Cost,
  CpuTierId,
  GameState,
  UpgradeContext,
  UpgradeId,
} from "../types";
import type { RuntimeDefinitionRecord } from "./csv";

const costs = (values: readonly Cost[]) =>
  values.map((cost) => ({ resource: cost.resource, amount: cost.amount }));

export const createHardwareLimitRuntimeDefinitions =
  (): RuntimeDefinitionRecord[] =>
    Object.entries(V1_HARDWARE_LIMITS).map(([id, maximum]) => ({
      definitionType: "physical-hardware-limit",
      id,
      maximum,
    }));

export const createCampaignSystemRuntimeDefinitions =
  (): RuntimeDefinitionRecord[] => [
    ...campaignObjectiveDefinitions.map((definition) => ({
      definitionType: "campaign-objective",
      ...definition,
    })),
    ...sideArcDefinitions.map((definition) => ({
      definitionType: "campaign-side-arc",
      ...definition,
    })),
    ...finaleCharterDefinitions.map((definition) => ({
      definitionType: "finale-charter",
      ...definition,
    })),
    {
      definitionType: "workshop-storage-workload",
      ...workshopStorageWorkloadDefinition,
    },
    {
      definitionType: "planetary-finale-plan",
      ...canonicalPlanetaryFinalePlan,
    },
    ...Object.entries(finaleCharterModifiers).map(([charterId, modifiers]) => ({
      definitionType: "finale-charter-modifier",
      charterId,
      ...modifiers,
    })),
  ];

const getUpgrade = (upgradeId: UpgradeId) => {
  const definition = upgradeDefinitions.find((candidate) => candidate.id === upgradeId);
  if (!definition) throw new Error(`Missing upgrade definition: ${upgradeId}`);
  return definition;
};

const freshEnumerationState = (tierId: CpuTierId = "hz"): GameState => {
  const fresh = createInitialGameState();
  const cpu = fresh.hardware.cpus[0]!;
  return {
    ...fresh,
    // Global hardware helpers deliberately inspect every system. The enumerator
    // has no Fleet systems so the one authoritative hardware snapshot advances
    // without a stale selected-system copy masking its target level.
    systems: [],
    research: {
      ...fresh.research,
      completed: researchDefinitions.map((definition) => definition.id),
    },
    hardware: {
      ...fresh.hardware,
      cpus: [
        {
          ...cpu,
          tierId,
          level: 1,
          coreIds: [1],
          cacheLevel: 1,
          cacheSpeedLevel: 1,
          schedulerSlots: 0,
        },
      ],
      cores: 1,
      coreClockLevels: { 1: 1 },
      cacheLevel: 1,
      cacheSpeedLevel: 1,
      schedulerSlots: 0,
      systemSchedulerSlots: 0,
      ramLevel: 0,
      ramBits: 0,
      ramBytes: 0,
      ramSticks: [],
      cronScheduleSlots: 0,
      cronIntervalLevel: 0,
      deadlockRecoveryLevel: 0,
      cStateLevel: 0,
      memoryVoltageLevel: 0,
      bootloaderLevel: 0,
      psuLevel: 1,
      psuWatts: getPsuWatts(1),
    },
  };
};

interface StatefulUpgradeSeriesOptions {
  upgradeId: UpgradeId;
  purchaseCount: number;
  state?: GameState;
  context?: UpgradeContext;
  targetFields(state: GameState, purchaseIndex: number): RuntimeDefinitionRecord;
}

const statefulUpgradeSeries = (
  options: StatefulUpgradeSeriesOptions,
): RuntimeDefinitionRecord[] => {
  const definition = getUpgrade(options.upgradeId);
  let state = options.state ?? freshEnumerationState();
  return Array.from({ length: options.purchaseCount }, (_, index) => {
    const purchaseIndex = index + 1;
    const upgradeCosts = definition.cost(state, options.context);
    const next = definition.buy(state, options.context);
    if (next === state) {
      throw new Error(
        `Upgrade enumerator stalled: ${options.upgradeId} purchase ${purchaseIndex}`,
      );
    }
    state = next;
    return {
      definitionType: "legacy-upgrade-level",
      upgradeId: definition.id,
      upgradeName: definition.name,
      component: definition.component,
      purchaseIndex,
      maximumPurchases: options.purchaseCount,
      costs: costs(upgradeCosts),
      ...options.targetFields(state, purchaseIndex),
    };
  });
};

const fixedUpgradeRows = (
  upgradeIds: readonly UpgradeId[],
): RuntimeDefinitionRecord[] => {
  const state = freshEnumerationState();
  return upgradeIds.map((upgradeId) => {
    const definition = getUpgrade(upgradeId);
    return {
      definitionType: "legacy-upgrade-level",
      upgradeId,
      upgradeName: definition.name,
      component: definition.component,
      purchaseIndex: 1,
      maximumPurchases: 1,
      costs: costs(definition.cost(state)),
    };
  });
};

export const createResearchRuntimeDefinitions = (): RuntimeDefinitionRecord[] => {
  const state = createInitialGameState();
  return researchDefinitions.map((definition) => ({
    definitionType: "research",
    id: definition.id,
    name: definition.name,
    description: definition.description,
    grants: definition.grants,
    computeTaskIds: definition.computeTaskIds ?? [],
    costs: costs(definition.cost(state)),
    requirements: definition.requirements(state).map((requirement) => ({
      id: requirement.id,
      label: requirement.label,
      kind: requirement.kind,
    })),
  }));
};

export const createPsuRuntimeDefinitions = (): RuntimeDefinitionRecord[] =>
  Array.from(
    { length: V1_HARDWARE_LIMITS.psuLevel },
    (_, index): RuntimeDefinitionRecord => {
      const level = index + 1;
      const watts = getPsuWatts(level);
      return {
        definitionType: "psu-level",
        id: `psu-level-${level}`,
        upgradeId: "psu",
        level,
        maximumLevel: V1_HARDWARE_LIMITS.psuLevel,
        watts,
        idleLoadLimitWatts: watts * 0.7,
        representativePeakLimitWatts: watts * 0.85,
        upgradeCosts: costs(getPsuCapacityUpgradeCost(level)),
      };
    },
  );

export const createLegacyUpgradeRuntimeDefinitions =
  (): RuntimeDefinitionRecord[] => [
    ...statefulUpgradeSeries({
      upgradeId: "cache",
      purchaseCount: V1_HARDWARE_LIMITS.cacheLevel - 1,
      targetFields: (state) => ({
        targetLevel: state.hardware.cpus[0]!.cacheLevel,
        capacityBits: state.hardware.cpus[0]!.cacheBits,
      }),
    }),
    ...cpuTierDefinitions.flatMap((tier) =>
      statefulUpgradeSeries({
        upgradeId: "cacheSpeed",
        purchaseCount: CPU_TIER_MAX_LEVEL - 1,
        state: freshEnumerationState(tier.id),
        targetFields: (state) => ({
          tierId: tier.id,
          targetLevel: state.hardware.cpus[0]!.cacheSpeedLevel,
        }),
      }),
    ),
    ...statefulUpgradeSeries({
      upgradeId: "core",
      purchaseCount: V1_HARDWARE_LIMITS.coresPerCpu - 1,
      targetFields: (state) => ({
        targetCoreCount: state.hardware.cpus[0]!.coreIds.length,
      }),
    }),
    ...statefulUpgradeSeries({
      upgradeId: "secondCpu",
      purchaseCount: V1_HARDWARE_LIMITS.cpuPackages - 1,
      targetFields: (state) => ({ targetCpuPackageCount: state.hardware.cpus.length }),
    }),
    ...statefulUpgradeSeries({
      upgradeId: "schedulerSlot",
      purchaseCount: V1_HARDWARE_LIMITS.cpuQueueSlotsPerCpu,
      targetFields: (state) => ({
        targetQueueSlots: state.hardware.cpus[0]!.schedulerSlots,
      }),
    }),
    ...statefulUpgradeSeries({
      upgradeId: "systemSchedulerSlot",
      purchaseCount: V1_HARDWARE_LIMITS.systemQueueSlots,
      targetFields: (state) => ({
        targetQueueSlots: state.hardware.systemSchedulerSlots,
      }),
    }),
    ...statefulUpgradeSeries({
      upgradeId: "deadlockRecovery",
      purchaseCount: V1_HARDWARE_LIMITS.deadlockRecoveryLevel,
      targetFields: (state) => ({
        targetLevel: state.hardware.deadlockRecoveryLevel,
      }),
    }),
    ...ramTierDefinitions.flatMap((tier) =>
      statefulUpgradeSeries({
        upgradeId: "ram",
        purchaseCount: V1_HARDWARE_LIMITS.ramSticks,
        state: freshEnumerationState(tier.id),
        context: { ramTierId: tier.id },
        targetFields: (state) => ({
          tierId: tier.id,
          targetStickCount: state.hardware.ramSticks.length,
          installedGlobalLevel: state.hardware.ramSticks[0]?.level ?? 0,
        }),
      }),
    ),
    ...Array.from({ length: RAM_MAX_LEVEL - 1 }, (_, index) => index + 2).flatMap(
      (targetLevel): RuntimeDefinitionRecord[] => [
        {
          definitionType: "legacy-upgrade-level",
          upgradeId: "ramCapacity",
          upgradeName: "RAM Capacity",
          component: "ram",
          purchaseIndex: targetLevel - 1,
          maximumPurchases: RAM_MAX_LEVEL - 1,
          targetLevel,
          costs: costs(getRamTierCapacityUpgradeCost(targetLevel)),
        },
        {
          definitionType: "legacy-upgrade-level",
          upgradeId: "ramSpeed",
          upgradeName: "RAM Frequency",
          component: "ram",
          purchaseIndex: targetLevel - 1,
          maximumPurchases: RAM_MAX_LEVEL - 1,
          targetLevel,
          costs: costs(getRamTierSpeedUpgradeCost(targetLevel)),
        },
      ],
    ),
    ...statefulUpgradeSeries({
      upgradeId: "cronSchedule",
      purchaseCount: 1,
      targetFields: (state) => ({ targetScheduleSlots: state.hardware.cronScheduleSlots }),
    }),
    ...statefulUpgradeSeries({
      upgradeId: "cronInterval",
      purchaseCount: V1_HARDWARE_LIMITS.cronIntervalLevel,
      targetFields: (state) => ({ targetLevel: state.hardware.cronIntervalLevel }),
    }),
    ...Array.from({ length: BOOTLOADER_MAX_LEVEL }, (_, index) => {
      const targetLevel = index + 1;
      return {
        definitionType: "legacy-upgrade-level",
        upgradeId: "bootloader",
        upgradeName: "Bootloader",
        component: "psu",
        purchaseIndex: targetLevel,
        maximumPurchases: BOOTLOADER_MAX_LEVEL,
        targetLevel,
        bootSeconds: getBootSecondsForBootloaderLevel(targetLevel),
        costs: costs(getBootloaderUpgradeCost(targetLevel)),
      } satisfies RuntimeDefinitionRecord;
    }),
    ...Array.from({ length: CPU_TIER_MAX_LEVEL }, (_, index) => {
      const targetLevel = index + 1;
      const definition = cpuTierDefinitions[0]!.levels[index]!;
      return {
        definitionType: "legacy-upgrade-level",
        upgradeId: "cState",
        upgradeName: "C-State",
        component: "cpu",
        purchaseIndex: targetLevel,
        maximumPurchases: CPU_TIER_MAX_LEVEL,
        targetLevel,
        idleMultiplier: definition.cStateIdleMultiplier ?? 1,
        costs: costs(getCStateUpgradeCost(targetLevel)),
      } satisfies RuntimeDefinitionRecord;
    }),
    ...Array.from({ length: MEMORY_VOLTAGE_MAX_LEVEL }, (_, index) => {
      const targetLevel = index + 1;
      return {
        definitionType: "legacy-upgrade-level",
        upgradeId: "memoryVoltage",
        upgradeName: "Memory Voltage",
        component: "ram",
        purchaseIndex: targetLevel,
        maximumPurchases: MEMORY_VOLTAGE_MAX_LEVEL,
        targetLevel,
        idleMultiplier: getMemoryVoltageIdleMultiplier(targetLevel),
        costs: costs(getMemoryVoltageCost(targetLevel)),
      } satisfies RuntimeDefinitionRecord;
    }),
    ...fixedUpgradeRows([
      "autoRepeat",
      "basicQueue",
      "scheduler",
      "matchedCpu",
    ]),
  ];

export const createCpuTierRuntimeDefinitions = (): RuntimeDefinitionRecord[] =>
  cpuTierDefinitions.flatMap((tier) =>
    tier.levels.map((level) => ({
      definitionType: "cpu-tier-level",
      upgradeId: "clock",
      tierId: tier.id,
      tierName: tier.name,
      unlockResearchId: tier.unlockResearchId,
      maximumLevel: CPU_TIER_MAX_LEVEL,
      ...level,
    })),
  );

export const createRamTierRuntimeDefinitions = (): RuntimeDefinitionRecord[] =>
  ramTierDefinitions.flatMap((tier) =>
    tier.levels.map((level) => ({
      definitionType: "ram-tier-level",
      tierId: tier.id,
      tierName: tier.name,
      unlockResearchId: tier.unlockResearchId,
      maximumGlobalLevel: RAM_MAX_LEVEL,
      ...level,
      installCost: amountMultiply(level.upgradeCost, 1),
    })),
  );
