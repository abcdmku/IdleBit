import type {
  Cost,
  GameState,
  ResearchDefinition,
  ResearchId,
  ResearchRequirementDefinition,
  TaskId,
} from "../types";

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

const hasAnyStarterTask = (state: GameState) =>
  hasCompleted(state, "fetchBit") || hasCompleted(state, "decodeBit");

const hasDecodeLogic = (state: GameState) =>
  hasResearch(state, "decodeLogic") ||
  hasResearch(state, "bitMutation") ||
  hasResearch(state, "shiftOperations");

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
    reveal: (state) =>
      hasResearch(state, "byteOperations") && hasCompleted(state, "byteCopy"),
    requirement: (state) => requirementsMet(state, getCacheMappingRequirements()),
    requirements: () => getCacheMappingRequirements(),
    cost: () => [credits(6), data(4)],
  },
  {
    id: "benchmarkHarness",
    name: "Benchmark Harness",
    description: "Unlock research benchmarks that expose later hardware research.",
    grants: ["benchmarks"],
    reveal: (state) => hasResearch(state, "cacheMapping"),
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
    id: "psuManagement",
    name: "PSU Management",
    description: "Unlock PSU capacity tuning for higher sustained draw.",
    grants: ["psuManagement"],
    reveal: (state) => state.hardware.secondCpu,
    requirement: (state) => requirementsMet(state, getSecondCpuInstalledRequirements()),
    requirements: () => getSecondCpuInstalledRequirements(),
    cost: () => [credits(280), data(20)],
  },
  {
    id: "thermalControl",
    name: "Thermal Control",
    description: "Unlock cooling upgrades that improve system reliability.",
    grants: ["cooling"],
    reveal: (state) => state.hardware.secondCpu,
    requirement: (state) => requirementsMet(state, getThermalControlRequirements()),
    requirements: () => getThermalControlRequirements(),
    cost: () => [credits(240), data(18)],
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

function getSecondCpuInstalledRequirements() {
  return [
    hardwareRequirement(
      "second-cpu-installed",
      "Install the second CPU",
      (state) => state.hardware.secondCpu,
    ),
  ];
}

function getThermalControlRequirements() {
  return getSecondCpuInstalledRequirements();
}

export const getResearchDefinition = (id: ResearchId) => {
  const research = researchDefinitions.find((definition) => definition.id === id);

  if (!research) {
    throw new Error(`Unknown research: ${id}`);
  }

  return research;
};
