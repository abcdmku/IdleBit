import type {
  Cost,
  CpuTierId,
  GameState,
  ResearchDefinition,
  ResearchId,
  ResearchRequirementDefinition,
  TaskId,
} from "../types";
import { getGlobalCStateLevel } from "../cState";
import {
  CPU_TIER_MAX_LEVEL,
  cpuTierDefinitions,
  getCStateUpgradeCost,
  getCpuTierDefinition,
  getCpuTierIndex,
} from "./cpuTiers";
import {
  MEMORY_VOLTAGE_MAX_LEVEL,
  getMemoryVoltageCost,
} from "./ramTuning";

const credits = (amount: number): Cost => ({
  resource: "credits",
  amount: Math.round(amount),
});

const data = (amount: number): Cost => ({
  resource: "data",
  amount: Math.round(amount),
});

const hasCompleted = (state: GameState, taskId: TaskId) =>
  (state.completedTasks[taskId] ?? state.completedJobs[taskId] ?? 0) > 0 ||
  state.completedBenchmarks.includes(taskId);

export const hasResearch = (state: GameState, id: ResearchId) =>
  state.research.completed.includes(id);

export const systemCatalogResearchId: ResearchId = "systemCatalog";
export const customMachineAssemblyResearchId: ResearchId = "customMachineAssembly";

const compileCodeTaskId: TaskId = "compileCode";

const hasAnyStarterTask = (state: GameState) =>
  hasCompleted(state, "fetchBit") || hasCompleted(state, "decodeBit");

export const hasDecodeLogic = (state: GameState) =>
  hasResearch(state, "decodeLogic") ||
  hasResearch(state, "bitMutation") ||
  hasResearch(state, "shiftOperations");

const hasCpuTierUnlocked = (state: GameState, tierId: CpuTierId) => {
  const researchId = getCpuTierDefinition(tierId).unlockResearchId;
  return researchId === null || hasResearch(state, researchId);
};

const hasSystemAutomation = (state: GameState) =>
  hasResearch(state, "cronScheduler") || state.flags.cron;

const getPreviousCpuTier = (tierId: CpuTierId) => {
  const index = getCpuTierIndex(tierId);
  return index > 0 ? cpuTierDefinitions[index - 1] : null;
};

const getCpuTierResearchCost = (tierId: CpuTierId) => {
  const previousTier = getPreviousCpuTier(tierId);
  return previousTier?.nextTierResearchCost ?? 0;
};

const hasPreviousCpuTierResearch = (state: GameState, tierId: CpuTierId) => {
  const previousResearchId = getPreviousCpuTier(tierId)?.unlockResearchId;
  return previousResearchId !== undefined &&
    previousResearchId !== null &&
    hasResearch(state, previousResearchId);
};

const cpuTierResearchRequirement = (tierId: CpuTierId) => {
  if (tierId === "khz") {
    return [
      requirement(
        "research:system-automation",
        "Unlock System Automation",
        "research",
        hasSystemAutomation,
      ),
    ];
  }

  const previousTier = getPreviousCpuTier(tierId);
  return previousTier?.unlockResearchId
    ? [
        researchRequirement(
          previousTier.unlockResearchId,
          `Complete ${previousTier.name} research`,
        ),
      ]
    : [];
};

const cpuTierResearchMet = (state: GameState, tierId: CpuTierId) =>
  requirementsMet(state, cpuTierResearchRequirement(tierId));

const getCStateResearchCost = (state: GameState) =>
  hasResearch(state, "cStateControl")
    ? getCStateUpgradeCost(
        Math.min(
          CPU_TIER_MAX_LEVEL + 1,
          getGlobalCStateLevel(state) + 1,
        ),
      )
    : [credits(10_000_000)];

const getMemoryVoltageResearchCost = (state: GameState) =>
  hasResearch(state, "memoryVoltageModifier")
    ? getMemoryVoltageCost(
        Math.min(
          MEMORY_VOLTAGE_MAX_LEVEL + 1,
          (state.hardware.memoryVoltageLevel ?? 0) + 1,
        ),
      )
    : [credits(1_000_000)];

const requirement = (
  id: string,
  label: string,
  kind: ResearchRequirementDefinition["kind"],
  met: (state: GameState) => boolean,
): ResearchRequirementDefinition => ({
  id,
  label,
  kind,
  met,
});

const researchRequirement = (id: ResearchId, label: string) =>
  requirement(`research:${id}`, label, "research", (state) => hasResearch(state, id));

const taskRequirement = (id: TaskId, label: string) =>
  requirement(`task:${id}`, label, "task", (state) => hasCompleted(state, id));

const computeRequirement = (id: TaskId, label: string) =>
  requirement(`compute:${id}`, label, "compute", (state) => hasCompleted(state, id));

const hardwareRequirement = (
  id: string,
  label: string,
  met: (state: GameState) => boolean,
) => requirement(`hardware:${id}`, label, "hardware", met);

const requirementsMet = (
  state: GameState,
  requirements: ResearchRequirementDefinition[],
) => requirements.every((item) => item.met(state));

export const researchDefinitions: ResearchDefinition[] = [
  {
    id: "decodeLogic",
    name: "Decode Logic",
    description: "Unlock simple bit mutation and shift work.",
    grants: [],
    reveal: (state) => hasCompleted(state, "fetchBit") || hasCompleted(state, "decodeBit"),
    requirement: (state) => requirementsMet(state, getDecodeLogicRequirements()),
    requirements: () => getDecodeLogicRequirements(),
    cost: () => [credits(3)],
  },
  {
    id: "bitMutation",
    name: "Bit Mutation",
    description: "Legacy research kept for older saves.",
    grants: [],
    reveal: () => false,
    requirement: () => false,
    requirements: () => [],
    cost: () => [credits(0)],
  },
  {
    id: "shiftOperations",
    name: "Shift Operations",
    description: "Legacy research kept for older saves.",
    grants: [],
    reveal: () => false,
    requirement: () => false,
    requirements: () => [],
    cost: () => [credits(0)],
  },
  {
    id: "byteOperations",
    name: "Byte Operations",
    description: "Unlock byte-sized copy work.",
    grants: [],
    reveal: hasDecodeLogic,
    requirement: (state) => requirementsMet(state, getByteOperationsRequirements()),
    requirements: () => getByteOperationsRequirements(),
    cost: () => [credits(8), data(2)],
  },
  {
    id: "cacheMapping",
    name: "Cache Mapping",
    description: "Unlock cache-backed packet work.",
    grants: ["cache"],
    reveal: hasDecodeLogic,
    requirement: (state) => requirementsMet(state, getCacheMappingRequirements()),
    requirements: () => getCacheMappingRequirements(),
    cost: () => [credits(6), data(4)],
  },
  {
    id: "benchmarkHarness",
    name: "Benchmark Harness",
    description: "Unlock research benchmarks that expose later hardware research.",
    grants: ["benchmarks"],
    reveal: hasDecodeLogic,
    requirement: (state) => requirementsMet(state, getBenchmarkHarnessRequirements()),
    requirements: () => getBenchmarkHarnessRequirements(),
    cost: () => [credits(42), data(4)],
  },
  {
    id: "multiCore",
    name: "Multi-Core Control",
    description: "Unlock additional cores and parallel task routing.",
    grants: ["multiCore"],
    reveal: (state) => hasResearch(state, "benchmarkHarness"),
    requirement: (state) => requirementsMet(state, getMultiCoreRequirements()),
    requirements: () => getMultiCoreRequirements(),
    computeTaskIds: ["microBenchmark", "parallelismBenchmark"],
    cost: () => [credits(96), data(8)],
  },
  {
    id: "localScheduler",
    name: "Local Scheduler",
    description: "Unlock the per-core task queue and automatic core intake.",
    grants: ["basicQueue"],
    reveal: (state) => hasResearch(state, "multiCore"),
    requirement: (state) => requirementsMet(state, getLocalSchedulerRequirements()),
    requirements: () => getLocalSchedulerRequirements(),
    cost: () => [credits(140), data(10)],
  },
  {
    id: "schedulerWatchdog",
    name: "Scheduler Watchdog",
    description: "Unlock scheduler controls that can kill deadlocked queued work.",
    grants: ["schedulerWatchdog"],
    reveal: (state) => hasResearch(state, "localScheduler"),
    requirement: (state) => requirementsMet(state, getSchedulerWatchdogRequirements()),
    requirements: () => getSchedulerWatchdogRequirements(),
    cost: () => [credits(190), data(12)],
  },
  {
    id: "schedulerPolicies",
    name: "Scheduling Policy",
    description: "Unlock scheduler dispatch policies that can avoid risky starts.",
    grants: ["schedulerPolicies"],
    reveal: (state) => hasResearch(state, "schedulerWatchdog"),
    requirement: (state) => requirementsMet(state, getSchedulerPolicyRequirements()),
    requirements: () => getSchedulerPolicyRequirements(),
    cost: () => [credits(230), data(14)],
  },
  {
    id: "systemScheduler",
    name: "System Scheduler",
    description: "Unlock barrier-aware system task scheduling.",
    grants: ["scheduler"],
    reveal: (state) => hasResearch(state, "localScheduler"),
    requirement: (state) => requirementsMet(state, getSystemSchedulerRequirements()),
    requirements: () => getSystemSchedulerRequirements(),
    cost: () => [credits(320), data(16)],
  },
  {
    id: "ramControl",
    name: "RAM Control",
    description: "Unlock system RAM modules and larger staged workloads.",
    grants: ["systemStats"],
    reveal: (state) => hasResearch(state, "localScheduler"),
    requirement: (state) => requirementsMet(state, getRamControlRequirements()),
    requirements: () => getRamControlRequirements(),
    cost: () => [credits(260), data(18)],
  },
  {
    id: "systemBus",
    name: "System Bus",
    description: "Unlock matched CPU packages and system-level task routing.",
    grants: ["secondCpu"],
    reveal: (state) => hasResearch(state, "systemScheduler"),
    requirement: (state) => requirementsMet(state, getSystemBusRequirements()),
    requirements: () => getSystemBusRequirements(),
    computeTaskIds: ["multiCoreBenchmark"],
    cost: () => [credits(520), data(24)],
  },
  {
    id: "dualChannelRam",
    name: "Dual Channel RAM",
    description: "Allow the System Scheduler to stripe RAM writes across 2 sticks.",
    grants: ["dualChannelRam"],
    reveal: (state) =>
      hasResearch(state, "systemScheduler") || hasResearch(state, "dualChannelRam"),
    requirement: (state) => requirementsMet(state, getDualChannelRamRequirements()),
    requirements: () => getDualChannelRamRequirements(),
    cost: () => [credits(820), data(42)],
  },
  {
    id: "quadChannelRam",
    name: "Quad Channel RAM",
    description: "Allow the System Scheduler to stripe RAM writes across 4 sticks.",
    grants: ["quadChannelRam"],
    reveal: (state) =>
      hasResearch(state, "dualChannelRam") || hasResearch(state, "quadChannelRam"),
    requirement: (state) => requirementsMet(state, getQuadChannelRamRequirements()),
    requirements: () => getQuadChannelRamRequirements(),
    cost: () => [credits(2_400), data(120)],
  },
  {
    id: "octChannelRam",
    name: "Oct Channel RAM",
    description: "Allow the System Scheduler to stripe RAM writes across 8 sticks.",
    grants: ["octChannelRam"],
    reveal: (state) =>
      hasResearch(state, "quadChannelRam") || hasResearch(state, "octChannelRam"),
    requirement: (state) => requirementsMet(state, getOctChannelRamRequirements()),
    requirements: () => getOctChannelRamRequirements(),
    cost: () => [credits(7_200), data(320)],
  },
  {
    id: "cronScheduler",
    name: "CRON Scheduler",
    description: "Unlock timed automation for repeatable system tasks.",
    grants: ["cron", "autoRepeat"],
    reveal: (state) => state.hardware.secondCpu,
    requirement: (state) => requirementsMet(state, getSecondCpuInstalledRequirements()),
    requirements: () => getSecondCpuInstalledRequirements(),
    cost: () => [credits(360), data(28)],
  },
  {
    id: systemCatalogResearchId,
    name: "System Catalog",
    description: "Unlock off-the-shelf system templates and larger local work.",
    grants: ["systemCatalog"],
    reveal: (state) => hasResearch(state, "systemBus") || state.hardware.secondCpu,
    requirement: (state) => requirementsMet(state, getSystemCatalogRequirements()),
    requirements: () => getSystemCatalogRequirements(),
    cost: () => [credits(680), data(36)],
  },
  {
    id: customMachineAssemblyResearchId,
    name: "Custom Machine Assembly",
    description: "Unlock configurable machine templates for heavier local work.",
    grants: ["customMachineAssembly"],
    reveal: (state) => hasResearch(state, systemCatalogResearchId),
    requirement: (state) =>
      requirementsMet(state, getCustomMachineAssemblyRequirements()),
    requirements: () => getCustomMachineAssemblyRequirements(),
    cost: () => [credits(980), data(54)],
  },
  {
    id: "cpuTierKhz",
    name: "kHz CPU Research",
    description: "Unlock level-1 kHz CPU packages.",
    grants: [],
    reveal: (state) =>
      hasCpuTierUnlocked(state, "khz") || hasSystemAutomation(state),
    requirement: (state) => cpuTierResearchMet(state, "khz"),
    requirements: () => cpuTierResearchRequirement("khz"),
    cost: () => [credits(getCpuTierResearchCost("khz"))],
  },
  {
    id: "cpuTierMhz",
    name: "MHz CPU Research",
    description: "Unlock level-1 MHz CPU packages.",
    grants: [],
    reveal: (state) =>
      hasCpuTierUnlocked(state, "mhz") || hasPreviousCpuTierResearch(state, "mhz"),
    requirement: (state) => cpuTierResearchMet(state, "mhz"),
    requirements: () => cpuTierResearchRequirement("mhz"),
    cost: () => [credits(getCpuTierResearchCost("mhz"))],
  },
  {
    id: "cpuTierGhz",
    name: "GHz CPU Research",
    description: "Unlock level-1 GHz CPU packages.",
    grants: [],
    reveal: (state) =>
      hasCpuTierUnlocked(state, "ghz") || hasPreviousCpuTierResearch(state, "ghz"),
    requirement: (state) => cpuTierResearchMet(state, "ghz"),
    requirements: () => cpuTierResearchRequirement("ghz"),
    cost: () => [credits(getCpuTierResearchCost("ghz"))],
  },
  {
    id: "cpuTierThz",
    name: "THz CPU Research",
    description: "Unlock level-1 THz CPU packages.",
    grants: [],
    reveal: (state) =>
      hasCpuTierUnlocked(state, "thz") || hasPreviousCpuTierResearch(state, "thz"),
    requirement: (state) => cpuTierResearchMet(state, "thz"),
    requirements: () => cpuTierResearchRequirement("thz"),
    cost: () => [credits(getCpuTierResearchCost("thz"))],
  },
  {
    id: "cpuTierPhz",
    name: "PHz CPU Research",
    description: "Unlock level-1 PHz CPU packages.",
    grants: [],
    reveal: (state) =>
      hasCpuTierUnlocked(state, "phz") || hasPreviousCpuTierResearch(state, "phz"),
    requirement: (state) => cpuTierResearchMet(state, "phz"),
    requirements: () => cpuTierResearchRequirement("phz"),
    cost: () => [credits(getCpuTierResearchCost("phz"))],
  },
  {
    id: "cStateControl",
    name: "C-State Control",
    description: "Unlock idle-core power reduction upgrades.",
    grants: ["cStateControl"],
    reveal: (state) =>
      hasResearch(state, "cpuTierKhz") || hasResearch(state, "cStateControl"),
    requirement: (state) => requirementsMet(state, getCStateControlRequirements()),
    requirements: () => getCStateControlRequirements(),
    cost: getCStateResearchCost,
  },
  {
    id: "memoryVoltageModifier",
    name: "Memory Voltage Modifier",
    description: "Reduce idle RAM draw without changing active write bandwidth.",
    grants: ["memoryVoltageModifier"],
    reveal: (state) =>
      hasResearch(state, "ramControl") &&
      (hasResearch(state, "cpuTierKhz") ||
        hasResearch(state, "memoryVoltageModifier")),
    requirement: (state) => requirementsMet(state, getMemoryVoltageRequirements()),
    requirements: () => getMemoryVoltageRequirements(),
    cost: getMemoryVoltageResearchCost,
  },
];

function getDecodeLogicRequirements() {
  return [
    requirement(
      "task:starter-bit-work",
      "Complete Fetch Bit or Decode Bit",
      "task",
      hasAnyStarterTask,
    ),
  ];
}

function getByteOperationsRequirements() {
  return [
    requirement(
      "research:decode-logic-family",
      "Complete Decode Logic research",
      "research",
      hasDecodeLogic,
    ),
  ];
}

function getCacheMappingRequirements() {
  return [
    researchRequirement("byteOperations", "Complete Byte Operations research"),
    taskRequirement("byteCopy", "Complete Byte Copy"),
  ];
}

function getBenchmarkHarnessRequirements() {
  return [
    researchRequirement("cacheMapping", "Complete Cache Mapping research"),
    taskRequirement("packetCheck", "Complete Packet Check"),
    hardwareRequirement(
      "clock-level-2",
      "Upgrade a core clock to level 2",
      (state) => state.hardware.clockLevel >= 2,
    ),
  ];
}

function getMultiCoreRequirements() {
  return [
    researchRequirement("benchmarkHarness", "Complete Benchmark Harness research"),
    hardwareRequirement(
      "clock-level-3",
      "Upgrade a core clock to level 3",
      (state) => state.hardware.clockLevel >= 3,
    ),
    hardwareRequirement(
      "cache-level-3",
      "Upgrade cache capacity to level 3",
      (state) => state.hardware.cacheLevel >= 3,
    ),
    computeRequirement("microBenchmark", "Run Micro Benchmark"),
    computeRequirement("parallelismBenchmark", "Run Parallelism Benchmark"),
  ];
}

function getLocalSchedulerRequirements() {
  return [
    researchRequirement("multiCore", "Complete Multi-Core Control research"),
    hardwareRequirement(
      "two-cores",
      "Install 2 CPU cores",
      (state) => state.hardware.cores >= 2,
    ),
  ];
}

function getSchedulerWatchdogRequirements() {
  return [
    researchRequirement("localScheduler", "Complete Local Scheduler research"),
  ];
}

function getSchedulerPolicyRequirements() {
  return [
    researchRequirement("schedulerWatchdog", "Complete Scheduler Watchdog research"),
  ];
}

function getSystemSchedulerRequirements() {
  return [
    researchRequirement("localScheduler", "Complete Local Scheduler research"),
    researchRequirement("ramControl", "Complete RAM Control research"),
    hardwareRequirement(
      "four-cores",
      "Install 4 CPU cores",
      (state) => state.hardware.cores >= 4,
    ),
    hardwareRequirement(
      "one-kilobit-ram",
      "Install at least 1 Kb RAM",
      (state) => state.hardware.ramBits >= 1024,
    ),
  ];
}

function getRamControlRequirements() {
  return [
    researchRequirement("localScheduler", "Complete Local Scheduler research"),
  ];
}

function getSystemBusRequirements() {
  return [
    researchRequirement("systemScheduler", "Complete System Scheduler research"),
    computeRequirement("multiCoreBenchmark", "Run Multi-Core Benchmark"),
  ];
}

function getDualChannelRamRequirements() {
  return [
    researchRequirement("systemScheduler", "Complete System Scheduler research"),
    hardwareRequirement(
      "two-ram-sticks",
      "Install 2 RAM sticks",
      (state) => state.hardware.ramSticks.length >= 2,
    ),
  ];
}

function getQuadChannelRamRequirements() {
  return [
    researchRequirement("systemScheduler", "Complete System Scheduler research"),
    researchRequirement("dualChannelRam", "Complete Dual Channel RAM research"),
    hardwareRequirement(
      "four-ram-sticks",
      "Install 4 RAM sticks",
      (state) => state.hardware.ramSticks.length >= 4,
    ),
  ];
}

function getOctChannelRamRequirements() {
  return [
    researchRequirement("systemScheduler", "Complete System Scheduler research"),
    researchRequirement("quadChannelRam", "Complete Quad Channel RAM research"),
    hardwareRequirement(
      "eight-ram-sticks",
      "Install 8 RAM sticks",
      (state) => state.hardware.ramSticks.length >= 8,
    ),
  ];
}

function getSecondCpuInstalledRequirements() {
  return [
    hardwareRequirement(
      "second-cpu-installed",
      "Install the second CPU",
      (state) => state.hardware.secondCpu,
    ),
  ];
}

function getSystemCatalogRequirements() {
  return [
    researchRequirement("systemBus", "Complete System Bus research"),
    hardwareRequirement(
      "second-cpu-installed",
      "Install the second CPU",
      (state) => state.hardware.secondCpu,
    ),
  ];
}

function getCustomMachineAssemblyRequirements() {
  return [
    researchRequirement(systemCatalogResearchId, "Complete System Catalog research"),
    requirement(
      "hardware:two-systems-or-compile",
      "Own 2 systems or complete Compile Code",
      "hardware",
      (state) => (state.systems?.length ?? 1) >= 2 || hasCompleted(state, compileCodeTaskId),
    ),
  ];
}

function getCStateControlRequirements() {
  return [
    researchRequirement("cpuTierKhz", "Complete kHz CPU Research"),
  ];
}

function getMemoryVoltageRequirements() {
  return [
    researchRequirement("ramControl", "Complete RAM Control research"),
    researchRequirement("cpuTierKhz", "Complete kHz CPU Research"),
  ];
}

export const getResearchDefinition = (id: ResearchId) => {
  const research = researchDefinitions.find((definition) => definition.id === id);

  if (!research) {
    throw new Error(`Unknown research: ${id}`);
  }

  return research;
};
