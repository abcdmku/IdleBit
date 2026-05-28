import type {
  ComponentSkuDefinition,
  Cost,
  CpuTierId,
  MachineComponentSelection,
  MachineTemplateDefinition,
  ResearchId,
  TaskId,
} from "../types";
import {
  getCpuTierPurchaseCost,
  getCpuTierUpgradeCost,
} from "./cpuTiers";
import {
  getRamTierFirstGlobalLevel,
  getRamTierCapacityUpgradeCost,
  getRamTierInstallCost,
  getRamTierLevelDefinition,
  getRamTierSpeedUpgradeCost,
} from "./ramTiers";
import { getPsuCapacityBuildCost } from "./psu";
import { getCpuSchedulerSlotBuildCost } from "./scheduler";

type ComponentSkuTier = "starter" | "compile" | "render" | "workstation" | "server";
type CatalogResearchId = Extract<
  ResearchId,
  "systemCatalog" | "customMachineAssembly"
>;

type CatalogComponentSkuDefinition = ComponentSkuDefinition & {
  tier: ComponentSkuTier;
  offTheShelf: true;
  unlockResearchId: CatalogResearchId;
};

type CatalogMachineTemplateDefinition = MachineTemplateDefinition & {
  tier: ComponentSkuTier;
  unlockResearchId: CatalogResearchId;
  intendedTasks: TaskId[];
};

const credits = (amount: number): Cost => ({
  resource: "credits",
  amount: Math.round(amount),
});

const data = (amount: number): Cost => ({
  resource: "data",
  amount: Math.round(amount),
});

const RAM_TIER_STICK_COUNT = 4;

const ramTierLevel = (tierId: CpuTierId) => getRamTierFirstGlobalLevel(tierId);

const ramTierCost = (tierId: CpuTierId, stickCount = RAM_TIER_STICK_COUNT) => [
  credits(getRamTierLevelDefinition(ramTierLevel(tierId)).upgradeCost * stickCount),
];

const coreCosts = (purchaseCount: number): Cost[] => [
  credits(140 * 2.05 ** purchaseCount),
  data(5 * 1.45 ** purchaseCount),
];

const cacheCapacityCosts = (purchaseCount: number): Cost[] => [
  credits(3 * 1.45 ** purchaseCount),
  data(6 * 1.78 ** purchaseCount),
];

const getPositiveInteger = (value: number | undefined, fallback: number) =>
  Math.max(0, Math.trunc(value ?? fallback));

const costLevels = (
  fromLevel: number,
  toLevel: number,
  getCosts: (targetLevel: number) => Cost[],
) =>
  Array.from(
    { length: Math.max(0, Math.trunc(toLevel) - Math.trunc(fromLevel)) },
    (_, index) => Math.trunc(fromLevel) + index + 1,
  ).flatMap(getCosts);

const getCpuLevelBackfillCosts = (tierId: CpuTierId, targetLevel: number) =>
  costLevels(1, targetLevel, (level) => getCpuTierUpgradeCost(tierId, level));

const getCoreBuildCost = (
  tierId: CpuTierId,
  cpuLevel: number,
  cacheSpeedLevel: number,
  purchaseCount: number,
) => [
  ...coreCosts(purchaseCount),
  ...getCpuTierPurchaseCost(tierId),
  ...getCpuLevelBackfillCosts(tierId, cpuLevel),
  ...getCpuLevelBackfillCosts(tierId, cacheSpeedLevel),
];

export const componentSkus: CatalogComponentSkuDefinition[] = [
  {
    id: "cpu-barebones-1",
    name: "Barebones CPU",
    tier: "starter",
    type: "cpu",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "The single-core CPU package from the starting PC.",
    cost: [credits(8)],
    cpuPackageCount: 1,
    cpuTierId: "hz",
    cpuLevel: 1,
    coreCount: 1,
    clockLevel: 1,
    cacheLevel: 1,
    cacheSpeedLevel: 1,
    schedulerSlots: 0,
  },
  {
    id: "cpu-sip-core",
    name: "SIP Core",
    tier: "starter",
    type: "cpu",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Level 1 kHz CPU package.",
    cost: [credits(32_000)],
    cpuPackageCount: 1,
    cpuTierId: "khz",
    cpuLevel: 1,
    coreCount: 1,
    clockLevel: 1,
    cacheLevel: 8,
    cacheSpeedLevel: 6,
  },
  {
    id: "cpu-compile-die",
    name: "Compile Die",
    tier: "compile",
    type: "cpu",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Level 1 MHz CPU package for chunked build work.",
    cost: [credits(126_000_000)],
    cpuPackageCount: 1,
    cpuTierId: "mhz",
    cpuLevel: 1,
    coreCount: 1,
    clockLevel: 1,
    cacheLevel: 10,
    cacheSpeedLevel: 10,
  },
  {
    id: "cpu-render-array",
    name: "Render Array",
    tier: "render",
    type: "cpu",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Level 1 GHz CPU package tuned for frame work.",
    cost: [credits(500_000_000_000)],
    cpuPackageCount: 1,
    cpuTierId: "ghz",
    cpuLevel: 1,
    coreCount: 1,
    clockLevel: 1,
    cacheLevel: 12,
    cacheSpeedLevel: 14,
  },
  {
    id: "cpu-workstation-8",
    name: "THz Workstation Package",
    tier: "workstation",
    type: "cpu",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Level 1 THz CPU package for wider local work.",
    cost: [credits(2_000_000_000_000_000)],
    cpuPackageCount: 1,
    cpuTierId: "thz",
    cpuLevel: 1,
    coreCount: 1,
    clockLevel: 1,
    cacheLevel: 14,
    cacheSpeedLevel: 17,
  },
  {
    id: "cpu-workstation-12",
    name: "THz Cache Package",
    tier: "workstation",
    type: "cpu",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Level 1 THz CPU package for cache-heavy jobs.",
    cost: [credits(2_000_000_000_000_000)],
    cpuPackageCount: 1,
    cpuTierId: "thz",
    cpuLevel: 1,
    coreCount: 1,
    clockLevel: 1,
    cacheLevel: 16,
    cacheSpeedLevel: 21,
  },
  {
    id: "cpu-ghz-16",
    name: "THz Wide Package",
    tier: "workstation",
    type: "cpu",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Level 1 THz CPU package at the local-die ceiling.",
    cost: [credits(2_000_000_000_000_000)],
    cpuPackageCount: 1,
    cpuTierId: "thz",
    cpuLevel: 1,
    coreCount: 1,
    clockLevel: 1,
    cacheLevel: 18,
    cacheSpeedLevel: 24,
  },
  {
    id: "cpu-server-24",
    name: "PHz Rack Package",
    tier: "server",
    type: "cpu",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Level 1 PHz CPU package for dense rack-node builds.",
    cost: [credits(8_000_000_000_000_000_000)],
    cpuPackageCount: 1,
    cpuTierId: "phz",
    cpuLevel: 1,
    coreCount: 1,
    clockLevel: 1,
    cacheLevel: 20,
    cacheSpeedLevel: 28,
  },
  {
    id: "cpu-server-32",
    name: "PHz Cache Package",
    tier: "server",
    type: "cpu",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Level 1 PHz CPU package for cache-rich batch work.",
    cost: [credits(8_000_000_000_000_000_000)],
    cpuPackageCount: 1,
    cpuTierId: "phz",
    cpuLevel: 1,
    coreCount: 1,
    clockLevel: 1,
    cacheLevel: 22,
    cacheSpeedLevel: 31,
  },
  {
    id: "cpu-server-48",
    name: "PHz Throughput Package",
    tier: "server",
    type: "cpu",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Level 1 PHz CPU package for pre-cluster throughput.",
    cost: [credits(8_000_000_000_000_000_000)],
    cpuPackageCount: 1,
    cpuTierId: "phz",
    cpuLevel: 1,
    coreCount: 1,
    clockLevel: 1,
    cacheLevel: 25,
    cacheSpeedLevel: 34,
  },
  {
    id: "cpu-server-64",
    name: "PHz Apex Package",
    tier: "server",
    type: "cpu",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Highest current level 1 PHz CPU package.",
    cost: [credits(8_000_000_000_000_000_000)],
    cpuPackageCount: 1,
    cpuTierId: "phz",
    cpuLevel: 1,
    coreCount: 1,
    clockLevel: 1,
    cacheLevel: 28,
    cacheSpeedLevel: 36,
  },
  {
    id: "ram-none",
    name: "No RAM",
    tier: "starter",
    type: "ram",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "The empty RAM bay from the starting PC.",
    cost: [],
    ramStickCount: 0,
    ramLevel: 0,
    ramSpeedLevel: 1,
  },
  {
    id: "ram-hz-tier",
    name: "Hz RAM Tier",
    tier: "starter",
    type: "ram",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Four baseline Hz-tier sticks.",
    cost: ramTierCost("hz"),
    ramStickCount: RAM_TIER_STICK_COUNT,
    ramLevel: ramTierLevel("hz"),
    ramSpeedLevel: ramTierLevel("hz"),
  },
  {
    id: "ram-khz-tier",
    name: "kHz RAM Tier",
    tier: "starter",
    type: "ram",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Four kHz-tier sticks unlocked with kHz CPU research.",
    cost: ramTierCost("khz"),
    ramStickCount: RAM_TIER_STICK_COUNT,
    ramLevel: ramTierLevel("khz"),
    ramSpeedLevel: ramTierLevel("khz"),
  },
  {
    id: "ram-mhz-tier",
    name: "MHz RAM Tier",
    tier: "compile",
    type: "ram",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Four MHz-tier sticks unlocked with MHz CPU research.",
    cost: ramTierCost("mhz"),
    ramStickCount: RAM_TIER_STICK_COUNT,
    ramLevel: ramTierLevel("mhz"),
    ramSpeedLevel: ramTierLevel("mhz"),
  },
  {
    id: "ram-ghz-tier",
    name: "GHz RAM Tier",
    tier: "render",
    type: "ram",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Four GHz-tier sticks unlocked with GHz CPU research.",
    cost: ramTierCost("ghz"),
    ramStickCount: RAM_TIER_STICK_COUNT,
    ramLevel: ramTierLevel("ghz"),
    ramSpeedLevel: ramTierLevel("ghz"),
  },
  {
    id: "ram-thz-tier",
    name: "THz RAM Tier",
    tier: "workstation",
    type: "ram",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Four THz-tier sticks unlocked with THz CPU research.",
    cost: ramTierCost("thz"),
    ramStickCount: RAM_TIER_STICK_COUNT,
    ramLevel: ramTierLevel("thz"),
    ramSpeedLevel: ramTierLevel("thz"),
  },
  {
    id: "ram-phz-tier",
    name: "PHz RAM Tier",
    tier: "server",
    type: "ram",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Four PHz-tier sticks unlocked with PHz CPU research.",
    cost: ramTierCost("phz"),
    ramStickCount: RAM_TIER_STICK_COUNT,
    ramLevel: ramTierLevel("phz"),
    ramSpeedLevel: ramTierLevel("phz"),
  },
  {
    id: "scheduler-none",
    name: "No System Scheduler",
    tier: "starter",
    type: "scheduler",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "The empty scheduler bay from the starting PC.",
    cost: [],
    schedulerSlots: 0,
  },
  {
    id: "scheduler-2-slot",
    name: "2 Slot System Scheduler",
    tier: "starter",
    type: "scheduler",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Basic system-level queue intake.",
    cost: [credits(800), data(18)],
    schedulerSlots: 2,
  },
  {
    id: "scheduler-4-slot",
    name: "4 Slot System Scheduler",
    tier: "compile",
    type: "scheduler",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Enough system queue width for chunked local work.",
    cost: [credits(2_400), data(36)],
    schedulerSlots: 4,
  },
  {
    id: "scheduler-6-slot",
    name: "6 Slot System Scheduler",
    tier: "render",
    type: "scheduler",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Wide system queueing for dense machines.",
    cost: [credits(8_000), data(68)],
    schedulerSlots: 6,
  },
  {
    id: "scheduler-12-slot",
    name: "12 Slot System Scheduler",
    tier: "workstation",
    type: "scheduler",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Workstation backplane for heavy local queues.",
    cost: [credits(38_000), data(140)],
    schedulerSlots: 12,
  },
  {
    id: "scheduler-24-slot",
    name: "24 Slot System Scheduler",
    tier: "server",
    type: "scheduler",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Server-preview backplane for rack-node queues.",
    cost: [credits(420_000), data(520)],
    schedulerSlots: 24,
  },
  {
    id: "psu-barebones",
    name: "Barebones PSU",
    tier: "starter",
    type: "psu",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "The baseline power supply from the starting PC.",
    cost: [credits(2)],
    psuLevel: 1,
  },
  {
    id: "psu-compact",
    name: "Compact PSU",
    tier: "starter",
    type: "psu",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Cheap power with little headroom.",
    cost: [credits(900)],
    psuLevel: 14,
  },
  {
    id: "psu-balanced",
    name: "Balanced PSU",
    tier: "compile",
    type: "psu",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Safer rack-node power supply.",
    cost: [credits(2_800)],
    psuLevel: 18,
  },
  {
    id: "psu-headroom",
    name: "Headroom PSU",
    tier: "render",
    type: "psu",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "More capacity for dense chunked work.",
    cost: [credits(9_500)],
    psuLevel: 22,
  },
  {
    id: "psu-workstation",
    name: "Workstation PSU",
    tier: "workstation",
    type: "psu",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Power supply for dense workstation modules.",
    cost: [credits(46_000)],
    psuLevel: 27,
  },
  {
    id: "psu-server",
    name: "Server PSU",
    tier: "server",
    type: "psu",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Power supply for the current server-preview ceiling.",
    cost: [credits(540_000)],
    psuLevel: 32,
  },
];

export const machineTemplates: CatalogMachineTemplateDefinition[] = [
  {
    id: "barebonesPc",
    name: "Barebones PC",
    tier: "starter",
    unlockResearchId: "systemCatalog",
    description: "The same minimal machine the game starts with.",
    intendedTasks: ["fetchBit", "decodeBit"],
    components: {
      cpu: "cpu-barebones-1",
      ram: "ram-none",
      scheduler: "scheduler-none",
      psu: "psu-barebones",
    },
  },
  {
    id: "starterNode",
    name: "Starter Node",
    tier: "starter",
    unlockResearchId: "systemCatalog",
    description: "A compact rack node for familiar system work.",
    intendedTasks: ["compileCode"],
    components: {
      cpu: "cpu-sip-core",
      ram: "ram-khz-tier",
      scheduler: "scheduler-2-slot",
      psu: "psu-compact",
    },
  },
  {
    id: "compileBox",
    name: "Compile Box",
    tier: "compile",
    unlockResearchId: "systemCatalog",
    description: "A balanced box for Compile Code and Regression Test.",
    intendedTasks: ["compileCode", "regressionTest"],
    components: {
      cpu: "cpu-compile-die",
      ram: "ram-mhz-tier",
      scheduler: "scheduler-4-slot",
      psu: "psu-balanced",
    },
  },
  {
    id: "renderBrick",
    name: "Render Brick",
    tier: "render",
    unlockResearchId: "customMachineAssembly",
    description: "A dense node for Render Frame work.",
    intendedTasks: ["renderFrame", "regressionTest"],
    components: {
      cpu: "cpu-render-array",
      ram: "ram-ghz-tier",
      scheduler: "scheduler-6-slot",
      psu: "psu-headroom",
    },
  },
  {
    id: "workstationTower",
    name: "Workstation Tower",
    tier: "workstation",
    unlockResearchId: "customMachineAssembly",
    description: "A high-throughput local workstation for dense batch work.",
    intendedTasks: ["compileCode", "renderFrame", "regressionTest"],
    components: {
      cpu: "cpu-ghz-16",
      ram: "ram-thz-tier",
      scheduler: "scheduler-12-slot",
      psu: "psu-workstation",
    },
  },
];

export const getComponentSku = (id: string) => {
  const sku = componentSkus.find((component) => component.id === id);
  if (!sku) throw new Error(`Unknown component SKU: ${id}`);
  return sku;
};

export const getMachineTemplate = (id: string) => {
  const template = machineTemplates.find((machine) => machine.id === id);
  if (!template) throw new Error(`Unknown machine template: ${id}`);
  return template;
};

export const getMachineComponentSkus = (selection: MachineComponentSelection) => [
  getComponentSku(selection.cpu),
  getComponentSku(selection.ram),
  getComponentSku(selection.scheduler),
  getComponentSku(selection.psu),
];

const combineCosts = (costs: Cost[]) =>
  costs.reduce<Cost[]>((combined, cost) => {
    const existing = combined.find((item) => item.resource === cost.resource);
    if (existing) {
      existing.amount += cost.amount;
      return combined;
    }
    combined.push({ ...cost });
    return combined;
  }, []);

const scaleCosts = (costs: Cost[], multiplier: number) =>
  costs.map((cost) => ({
    ...cost,
    amount: cost.amount * multiplier,
  }));

const distributeCoreCount = (coreCount: number, cpuPackageCount: number) => {
  const packageCount = Math.max(1, cpuPackageCount);
  const total = Math.max(packageCount, coreCount);
  const coresPerPackage = Math.max(1, Math.floor(total / packageCount));
  const extraCores = total % packageCount;

  return Array.from(
    { length: packageCount },
    (_, index) => coresPerPackage + (index < extraCores ? 1 : 0),
  );
};

export const getMachineSelectionCost = (selection: MachineComponentSelection) => {
  const [cpu, ram, scheduler, psu] = getMachineComponentSkus(selection);
  const cpuPackageCount = Math.max(
    1,
    selection.cpuPackageConfigs?.length ?? 0,
    getPositiveInteger(selection.cpuPackageCount, cpu.cpuPackageCount ?? 1),
  );
  const cpuTierId = cpu.cpuTierId ?? "hz";
  const baseCpuLevel = Math.max(1, cpu.cpuLevel ?? cpu.clockLevel ?? 1);
  const targetCpuLevel = Math.max(1, getPositiveInteger(selection.cpuLevel, baseCpuLevel));
  const baseCacheLevel = Math.max(1, cpu.cacheLevel ?? 1);
  const targetCacheLevel = Math.max(
    1,
    getPositiveInteger(selection.cacheLevel, baseCacheLevel),
  );
  const baseCacheSpeedLevel = Math.max(1, cpu.cacheSpeedLevel ?? 1);
  const targetCacheSpeedLevel = Math.max(
    1,
    getPositiveInteger(selection.cacheSpeedLevel, baseCacheSpeedLevel),
  );
  const baseCoreCountPerPackage = Math.max(1, cpu.coreCount ?? 1);
  const hasCpuPackageConfigs =
    Array.isArray(selection.cpuPackageConfigs) &&
    selection.cpuPackageConfigs.length > 0;
  const fallbackCoreCounts = distributeCoreCount(
    selection.cpuCoreCount ?? baseCoreCountPerPackage * cpuPackageCount,
    cpuPackageCount,
  );
  const cpuPackageConfigs = Array.from({ length: cpuPackageCount }, (_, index) => {
    const config = selection.cpuPackageConfigs?.[index];

    return {
      coreCount: Math.max(
        1,
        config?.coreCount ??
          (hasCpuPackageConfigs ? baseCoreCountPerPackage : fallbackCoreCounts[index]) ??
          baseCoreCountPerPackage,
      ),
      cpuLevel: Math.max(1, config?.cpuLevel ?? targetCpuLevel),
      cacheLevel: Math.max(1, config?.cacheLevel ?? targetCacheLevel),
      cacheSpeedLevel: Math.max(
        1,
        config?.cacheSpeedLevel ?? targetCacheSpeedLevel,
      ),
      schedulerSlots:
        config?.schedulerSlots === undefined
          ? undefined
          : Math.max(0, Math.trunc(config.schedulerSlots)),
    };
  });
  const baseCoreCount = Math.max(
    cpuPackageCount,
    baseCoreCountPerPackage * cpuPackageCount,
  );
  const targetCoreCount = hasCpuPackageConfigs
    ? cpuPackageConfigs.reduce((total, config) => total + config.coreCount, 0)
    : Math.max(
        cpuPackageCount,
        getPositiveInteger(selection.cpuCoreCount, baseCoreCount),
      );
  const hasCustomCpuSchedulerSlots = selection.cpuSchedulerSlots !== undefined;
  const targetCpuSchedulerSlots = Math.max(
    0,
    getPositiveInteger(selection.cpuSchedulerSlots, targetCoreCount),
  );
  const hasPackageCpuSchedulerSlots = cpuPackageConfigs.some(
    (config) => config.schedulerSlots !== undefined,
  );
  const extraCoreCosts = hasCpuPackageConfigs
    ? cpuPackageConfigs.flatMap((config) =>
        Array.from(
          { length: Math.max(0, config.coreCount - baseCoreCountPerPackage) },
          (_, index) => baseCoreCountPerPackage + index,
        ).flatMap((currentCoreCount) =>
          getCoreBuildCost(
            cpuTierId,
            config.cpuLevel,
            config.cacheSpeedLevel,
            Math.max(0, currentCoreCount - 1),
          ),
        ),
      )
    : Array.from(
        { length: Math.max(0, targetCoreCount - baseCoreCount) },
        (_, index) => baseCoreCount + index,
      ).flatMap((currentCoreCount) =>
        getCoreBuildCost(
          cpuTierId,
          targetCpuLevel,
          targetCacheSpeedLevel,
          Math.max(0, currentCoreCount - 1),
        ),
      );
  const cpuLevelCosts = hasCpuPackageConfigs
    ? cpuPackageConfigs.flatMap((config) =>
        costLevels(baseCpuLevel, config.cpuLevel, (level) =>
          scaleCosts(getCpuTierUpgradeCost(cpuTierId, level), config.coreCount),
        ),
      )
    : costLevels(baseCpuLevel, targetCpuLevel, (level) =>
        scaleCosts(getCpuTierUpgradeCost(cpuTierId, level), baseCoreCount),
      );
  const cacheLevelCosts = hasCpuPackageConfigs
    ? cpuPackageConfigs.flatMap((config) =>
        costLevels(baseCacheLevel, config.cacheLevel, (level) =>
          scaleCosts(cacheCapacityCosts(level - 1), 1),
        ),
      )
    : costLevels(baseCacheLevel, targetCacheLevel, (level) =>
        scaleCosts(cacheCapacityCosts(level - 1), cpuPackageCount),
      );
  const cacheSpeedCosts = hasCpuPackageConfigs
    ? cpuPackageConfigs.flatMap((config) =>
        costLevels(baseCacheSpeedLevel, config.cacheSpeedLevel, (level) =>
          scaleCosts(getCpuTierUpgradeCost(cpuTierId, level), config.coreCount),
        ),
      )
    : costLevels(
        baseCacheSpeedLevel,
        targetCacheSpeedLevel,
        (level) =>
          scaleCosts(getCpuTierUpgradeCost(cpuTierId, level), baseCoreCount),
      );
  const cpuSchedulerSlotCosts = hasPackageCpuSchedulerSlots
    ? cpuPackageConfigs.flatMap((config) =>
        config.schedulerSlots !== undefined &&
        config.schedulerSlots > config.coreCount
          ? getCpuSchedulerSlotBuildCost(config.coreCount, config.schedulerSlots)
          : [],
      )
    : hasCustomCpuSchedulerSlots && targetCpuSchedulerSlots > targetCoreCount
      ? getCpuSchedulerSlotBuildCost(targetCoreCount, targetCpuSchedulerSlots)
      : [];
  const hasCustomRam =
    selection.ramStickCount !== undefined ||
    selection.ramLevel !== undefined ||
    selection.ramSpeedLevel !== undefined;
  const baseRamStickCount = Math.max(0, ram.ramStickCount ?? 0);
  const targetRamStickCount = Math.max(
    0,
    getPositiveInteger(selection.ramStickCount, baseRamStickCount),
  );
  const baseRamLevel = Math.max(1, ram.ramLevel ?? 1);
  const targetRamLevel = Math.max(1, getPositiveInteger(selection.ramLevel, baseRamLevel));
  const baseRamSpeedLevel = Math.max(1, ram.ramSpeedLevel ?? baseRamLevel);
  const targetRamSpeedLevel = Math.max(
    1,
    getPositiveInteger(selection.ramSpeedLevel, baseRamSpeedLevel),
  );
  const ramInstallCosts = hasCustomRam
    ? Array.from({ length: targetRamStickCount }, (_, index) =>
        scaleCosts(getRamTierInstallCost(baseRamLevel), 2 ** index),
      ).flat()
    : ram.cost;
  const ramCapacityCosts = hasCustomRam
    ? costLevels(baseRamLevel, targetRamLevel, (level) =>
        scaleCosts(getRamTierCapacityUpgradeCost(level), targetRamStickCount),
      )
    : [];
  const ramSpeedCosts = hasCustomRam
    ? costLevels(baseRamSpeedLevel, targetRamSpeedLevel, (level) =>
        scaleCosts(getRamTierSpeedUpgradeCost(level), targetRamStickCount),
      )
    : [];
  const hasCustomPsu = selection.psuLevel !== undefined;
  const basePsuLevel = Math.max(1, psu.psuLevel ?? 1);
  const targetPsuLevel = Math.max(
    basePsuLevel,
    getPositiveInteger(selection.psuLevel, basePsuLevel),
  );
  const psuCosts = hasCustomPsu
    ? [...psu.cost, ...getPsuCapacityBuildCost(basePsuLevel, targetPsuLevel)]
    : psu.cost;

  return combineCosts([
    ...scaleCosts(cpu.cost, cpuPackageCount),
    ...extraCoreCosts,
    ...cpuLevelCosts,
    ...cacheLevelCosts,
    ...cacheSpeedCosts,
    ...cpuSchedulerSlotCosts,
    ...ramInstallCosts,
    ...ramCapacityCosts,
    ...ramSpeedCosts,
    ...scheduler.cost,
    ...psuCosts,
  ]);
};
