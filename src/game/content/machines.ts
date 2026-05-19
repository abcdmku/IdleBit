import type {
  ComponentSkuDefinition,
  Cost,
  MachineComponentSelection,
  MachineTemplateDefinition,
  ResearchId,
  TaskId,
} from "../types";

type ComponentSkuTier = "starter" | "compile" | "render";
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

export const componentSkus: CatalogComponentSkuDefinition[] = [
  {
    id: "cpu-sip-core",
    name: "SIP Core",
    tier: "starter",
    type: "cpu",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Small off-the-shelf CPU package.",
    cost: [credits(420), data(10)],
    coreCount: 2,
    clockLevel: 3,
    cacheLevel: 6,
    cacheSpeedLevel: 2,
  },
  {
    id: "cpu-compile-die",
    name: "Compile Die",
    tier: "compile",
    type: "cpu",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "More cores for elastic build work.",
    cost: [credits(760), data(20)],
    coreCount: 4,
    clockLevel: 4,
    cacheLevel: 7,
    cacheSpeedLevel: 3,
  },
  {
    id: "cpu-render-array",
    name: "Render Array",
    tier: "render",
    type: "cpu",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Dense CPU package tuned for frame work.",
    cost: [credits(1180), data(34)],
    coreCount: 6,
    clockLevel: 4,
    cacheLevel: 7,
    cacheSpeedLevel: 3,
  },
  {
    id: "ram-1kb-basic",
    name: "1 Kb RAM Kit",
    tier: "starter",
    type: "ram",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Four small RAM sticks for system tasks.",
    cost: [credits(320), data(18)],
    ramStickCount: 4,
    ramLevel: 1,
    ramSpeedLevel: 1,
  },
  {
    id: "ram-2kb-fast",
    name: "2 Kb RAM Kit",
    tier: "compile",
    type: "ram",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Faster RAM for larger compile and render work.",
    cost: [credits(580), data(30)],
    ramStickCount: 4,
    ramLevel: 2,
    ramSpeedLevel: 2,
  },
  {
    id: "ram-4kb-work",
    name: "4 Kb RAM Kit",
    tier: "render",
    type: "ram",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Roomy staged memory for heavier test runs.",
    cost: [credits(920), data(46)],
    ramStickCount: 4,
    ramLevel: 3,
    ramSpeedLevel: 2,
  },
  {
    id: "scheduler-2-slot",
    name: "2 Slot Scheduler",
    tier: "starter",
    type: "scheduler",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Basic CPU and system queue capacity.",
    cost: [credits(260), data(12)],
    schedulerSlots: 2,
  },
  {
    id: "scheduler-4-slot",
    name: "4 Slot Scheduler",
    tier: "compile",
    type: "scheduler",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Enough width for elastic system work.",
    cost: [credits(520), data(22)],
    schedulerSlots: 4,
  },
  {
    id: "scheduler-6-slot",
    name: "6 Slot Scheduler",
    tier: "render",
    type: "scheduler",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "Wide local queueing for dense machines.",
    cost: [credits(880), data(36)],
    schedulerSlots: 6,
  },
  {
    id: "psu-compact",
    name: "Compact PSU",
    tier: "starter",
    type: "psu",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Cheap power with little headroom.",
    cost: [credits(220)],
    psuLevel: 5,
  },
  {
    id: "psu-balanced",
    name: "Balanced PSU",
    tier: "compile",
    type: "psu",
    unlockResearchId: "systemCatalog",
    offTheShelf: true,
    description: "Safer rack-node power supply.",
    cost: [credits(460)],
    psuLevel: 7,
  },
  {
    id: "psu-headroom",
    name: "Headroom PSU",
    tier: "render",
    type: "psu",
    unlockResearchId: "customMachineAssembly",
    offTheShelf: true,
    description: "More capacity for dense elastic work.",
    cost: [credits(740)],
    psuLevel: 9,
  },
];

export const machineTemplates: CatalogMachineTemplateDefinition[] = [
  {
    id: "starterNode",
    name: "Starter Node",
    tier: "starter",
    unlockResearchId: "systemCatalog",
    description: "A compact rack node for familiar system work.",
    intendedTasks: ["compileCode"],
    components: {
      cpu: "cpu-sip-core",
      ram: "ram-1kb-basic",
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
      ram: "ram-2kb-fast",
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
      ram: "ram-4kb-work",
      scheduler: "scheduler-6-slot",
      psu: "psu-headroom",
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
