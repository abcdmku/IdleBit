export type ResourceId = "credits" | "data";

export type StageId =
  | "primitiveCpu"
  | "singleCpu"
  | "multiCore"
  | "scheduler"
  | "systemReveal";

export type TaskId =
  | "fetchBit"
  | "decodeBit"
  | "bitFlip"
  | "bitShift"
  | "byteCopy"
  | "packetCheck"
  | "tinyChecksum"
  | "microBenchmark"
  | "parallelismBenchmark"
  | "multiCoreBenchmark";

export type JobId = TaskId;

export type ResearchId =
  | "decodeLogic"
  | "bitMutation"
  | "shiftOperations"
  | "byteOperations"
  | "cacheMapping"
  | "benchmarkHarness"
  | "multiCore"
  | "localScheduler"
  | "kernelScheduler"
  | "systemBus"
  | "thermalControl";

export type UpgradeId =
  | "clock"
  | "cache"
  | "cacheSpeed"
  | "autoRepeat"
  | "core"
  | "schedulerSlot"
  | "basicQueue"
  | "scheduler"
  | "secondCpu"
  | "ram"
  | "psu"
  | "cooling";

export type HardwareComponentId =
  | "cpu"
  | "cache"
  | "scheduler"
  | "socket"
  | "ram"
  | "psu";

export type UnlockId =
  | "cache"
  | "autoRepeat"
  | "benchmarks"
  | "multiCore"
  | "basicQueue"
  | "scheduler"
  | "secondCpu"
  | "systemStats"
  | "cooling";

export type TaskKind = "task" | "job" | "benchmark";

export type TaskOperationKind = "memory" | "compute" | "barrier";

export type TaskMemoryOperationKind = "read" | "write" | "overwrite";

export type OperationRuntimeStatus =
  | "loadingCache"
  | "loadingRam"
  | "running"
  | "waitingMemory"
  | "waitingBarrier"
  | "rerunning"
  | "restarting"
  | "complete";

export type MemoryRuntimeState =
  | "idle"
  | "cacheLoad"
  | "ramLoad"
  | "waiting"
  | "ready"
  | "rerun"
  | "restart";

export interface ResourceBag {
  credits: number;
  data: number;
}

export interface Cost {
  resource: ResourceId;
  amount: number;
}

export interface TaskOperationDefinition {
  id: string;
  name: string;
  kind: TaskOperationKind;
  memoryAction: TaskMemoryOperationKind | null;
  count: number;
  cycles: number;
  cacheBits: number;
  ramBits: number;
  cacheBytes: number;
  ramBytes: number;
  parallel: boolean;
}

export type TaskSubtaskKind =
  | "task"
  | "recipe"
  | "operation"
  | "accept"
  | "cacheLoad"
  | "ramLoad"
  | "execute"
  | "complete";

export interface TaskSubtaskDefinition {
  id: string;
  name: string;
  kind: TaskSubtaskKind;
  dependsOn: string[];
  operationIds: string[];
  operations: TaskOperationDefinition[];
  operationCount: number;
  subtasks: TaskSubtaskDefinition[];
  cycles: number;
  cacheBits: number;
  ramBits: number;
  cacheBytes: number;
  ramBytes: number;
}

export interface TaskDefinition {
  id: TaskId;
  name: string;
  kind: TaskKind;
  operations: TaskOperationDefinition[];
  subtasks: TaskSubtaskDefinition[];
  dagNodes: TaskSubtaskDefinition[];
  operationCount: number;
  rewardCredits: number;
  rewardData: number;
  parallelizable: boolean;
  repeatable: boolean;
  minCores: number;
  maxCores?: number;
  reveal: (state: GameState) => boolean;
  requirement: (state: GameState) => boolean;
  requiredCycles: number;
  cacheNeedBits: number;
  ramNeedBits: number;
  cacheNeedBytes: number;
  ramNeedBytes: number;
}

export type JobDefinition = TaskDefinition;

export interface ResearchDefinition {
  id: ResearchId;
  name: string;
  description: string;
  grants: UnlockId[];
  reveal: (state: GameState) => boolean;
  requirement: (state: GameState) => boolean;
  requirements: (state: GameState) => ResearchRequirementDefinition[];
  computeTaskIds?: TaskId[];
  cost: (state: GameState) => Cost[];
}

export type ResearchRequirementKind =
  | "research"
  | "task"
  | "compute"
  | "hardware";

export interface ResearchRequirementDefinition {
  id: string;
  label: string;
  kind: ResearchRequirementKind;
  met: (state: GameState) => boolean;
}

export interface UpgradeDefinition {
  id: UpgradeId;
  name: string;
  component: HardwareComponentId;
  accent: "cyan" | "green" | "violet" | "amber";
  maxPurchases?: number;
  requirement: (state: GameState) => boolean;
  cost: (state: GameState, context?: UpgradeContext) => Cost[];
  buy: (state: GameState, context?: UpgradeContext) => GameState;
}

export interface UpgradeContext {
  coreId?: number;
}

export interface ActiveCoreOperation {
  coreId: number;
  operationIndex: number;
  operationId: string | null;
  operationName: string | null;
  status: OperationRuntimeStatus;
  memoryState: MemoryRuntimeState;
  remainingCycles: number;
  totalCycles: number;
  remainingLoadCycles: number;
  totalLoadCycles: number;
  memoryReservedBits: number;
  memoryReservedBytes: number;
  reruns: number;
  restarts: number;
  corruptions: number;
}

export interface ActiveTask {
  instanceId: string;
  taskId: TaskId;
  jobId: JobId;
  coreId: number;
  assignedCoreIds: number[];
  coreOperations: ActiveCoreOperation[];
  remainingCycles: number;
  totalCycles: number;
  restarts: number;
  reruns: number;
  corruptions: number;
}

export type ActiveJob = ActiveTask;

export interface CoreSchedulerState {
  coreId: number;
  activeTaskInstanceId: string | null;
  operationId: string | null;
  status: OperationRuntimeStatus | "idle";
  memoryState: MemoryRuntimeState;
  localQueue: TaskId[];
  progress: number;
}

export interface GameFlags {
  cache: boolean;
  autoRepeat: boolean;
  benchmarks: boolean;
  multiCore: boolean;
  basicQueue: boolean;
  scheduler: boolean;
  secondCpu: boolean;
  systemStats: boolean;
  cooling: boolean;
}

export interface HardwareState {
  clockLevel: number;
  clockHz: number;
  coreClockLevels: Record<number, number>;
  cacheLevel: number;
  cacheSpeedLevel: number;
  cacheBits: number;
  cacheBytes: number;
  cores: number;
  schedulerSlots: number;
  secondCpu: boolean;
  ramLevel: number;
  ramBits: number;
  ramBytes: number;
  ramSpeedMt: number;
  psuLevel: number;
  psuWatts: number;
  coolingLevel: number;
  coolingRating: number;
}

export interface ResearchState {
  completed: ResearchId[];
}

export interface ReliabilityState {
  restartDebt: number;
  corruptionDebt: number;
  totalRestarts: number;
  totalCorruptions: number;
  lastEvent:
    | {
        tick: number;
        kind: "restart" | "corruption";
        coreId: number;
        taskId: TaskId;
      }
    | null;
}

export interface CacheResidencySegment {
  coreId: number;
  bits: number;
  memoryAction: TaskMemoryOperationKind | null;
  operationId?: string | null;
  state?: "buffering" | "loading" | "loaded";
  progress?: number;
  bufferProgress?: number;
}

export interface GameState {
  version: 1;
  tick: number;
  nextInstanceId: number;
  resources: ResourceBag;
  hardware: HardwareState;
  flags: GameFlags;
  research: ResearchState;
  reliability: ReliabilityState;
  completedTasks: Partial<Record<TaskId, number>>;
  completedJobs: Partial<Record<JobId, number>>;
  completedBenchmarks: TaskId[];
  activeTasks: ActiveTask[];
  activeJobs: ActiveJob[];
  cacheResidency: CacheResidencySegment[];
  coreSchedulers: Record<number, CoreSchedulerState>;
  queue: TaskId[];
  autoRepeatJobId: JobId | null;
}

export type GameAction =
  | { type: "startTask"; taskId: TaskId }
  | { type: "startTaskOnCore"; taskId: TaskId; coreId: number }
  | { type: "queueTask"; taskId: TaskId }
  | { type: "buyResearch"; researchId: ResearchId }
  | { type: "buyUpgrade"; upgradeId: UpgradeId; coreId?: number }
  | { type: "startJob"; jobId: JobId }
  | { type: "startJobOnCore"; jobId: JobId; coreId: number }
  | { type: "queueJob"; jobId: JobId }
  | { type: "setAutoRepeat"; jobId: JobId | null };

export interface VisibleOperation {
  id: string;
  name: string;
  kind: TaskOperationKind;
  memoryAction: TaskMemoryOperationKind | null;
  count: number;
  cacheBits: number;
  ramBits: number;
  cacheBytes: number;
  ramBytes: number;
  parallel: boolean;
}

export interface VisibleTaskSubtask {
  id: string;
  name: string;
  kind: TaskSubtaskKind;
  dependsOn: string[];
  operationIds: string[];
  operations: VisibleOperation[];
  operationCount: number;
  subtasks: VisibleTaskSubtask[];
  cycles: number;
  cacheBits: number;
  ramBits: number;
  cacheBytes: number;
  ramBytes: number;
}

export interface VisibleTask {
  id: TaskId;
  name: string;
  kind: TaskKind;
  rewardCredits: number;
  rewardData: number;
  cacheNeedBits: number;
  ramNeedBits: number;
  cacheNeedBytes: number;
  ramNeedBytes: number;
  operationCount: number;
  operations: VisibleOperation[];
  subtaskCount: number;
  subtasks: VisibleTaskSubtask[];
  dagNodes: VisibleTaskSubtask[];
  requiredCores: number;
  cacheFit: "bonus" | "met" | "low";
  canStart: boolean;
  canQueue: boolean;
  blockedReason: string | null;
  queueBlockedReason: string | null;
}

export interface VisibleJob extends VisibleTask {
  seconds: number;
}

export interface VisibleUpgrade {
  id: UpgradeId;
  name: string;
  component: HardwareComponentId;
  accent: UpgradeDefinition["accent"];
  costs: Cost[];
  canAfford: boolean;
  purchaseCount: number;
}

export interface VisibleResearch {
  id: ResearchId;
  name: string;
  description: string;
  grants: UnlockId[];
  costs: Cost[];
  canAfford: boolean;
  canBuy: boolean;
  completed: boolean;
  blockedReason: string | null;
  requirements: VisibleResearchRequirement[];
  computeTasks: VisibleResearchComputeTask[];
}

export interface VisibleResearchRequirement {
  id: string;
  label: string;
  kind: ResearchRequirementKind;
  met: boolean;
}

export interface VisibleResearchComputeTask {
  id: TaskId;
  name: string;
  operationCount: number;
  rewardCredits: number;
  rewardData: number;
  cacheNeedBits: number;
  ramNeedBits: number;
  requiredCores: number;
  canStart: boolean;
  canQueue: boolean;
  blockedReason: string | null;
  queueBlockedReason: string | null;
  completed: boolean;
  active: boolean;
  progress: number;
}

export interface VisibleCoreTaskProgress {
  coreId: number;
  operationId: string | null;
  operationName: string | null;
  memoryAction: TaskMemoryOperationKind | null;
  status: OperationRuntimeStatus;
  memoryState: MemoryRuntimeState;
  progress: number;
  remainingCycles: number;
  totalCycles: number;
  remainingLoadCycles: number;
  totalLoadCycles: number;
  cacheBits: number;
  memoryReservedBits: number;
  memoryReservedBytes: number;
  reruns: number;
  restarts: number;
  corruptions: number;
}

export interface VisibleActiveTask {
  instanceId: string;
  taskId: TaskId;
  jobId: JobId;
  name: string;
  coreId: number;
  assignedCoreIds: number[];
  progress: number;
  status: OperationRuntimeStatus;
  memoryState: MemoryRuntimeState;
  activeOperationName: string | null;
  coreProgress: VisibleCoreTaskProgress[];
  restarts: number;
  reruns: number;
  corruptions: number;
}

export interface VisibleActiveJob extends VisibleActiveTask {
  remainingSeconds: number;
}

export interface VisibleCore {
  id: number;
  socketId: number;
  clockLevel: number;
  clockHz: number;
  clockUpgrade: VisibleUpgrade | null;
  scheduler: CoreSchedulerState;
  activeTask: VisibleActiveTask | null;
  activeJob: VisibleActiveJob | null;
}

export interface VisibleCpuSocket {
  id: number;
  label: string;
  cores: VisibleCore[];
}

export interface VisibleRamSlot {
  id: number;
  sizeBits: number;
  sizeBytes: number;
  usedBits: number;
  usedBytes: number;
  speedMt: number;
}

export interface VisibleMemoryPipeline {
  status: MemoryRuntimeState;
  cacheLoads: number;
  ramLoads: number;
  waits: number;
  reruns: number;
  restarts: number;
}

export interface VisibleHardwareMetrics {
  cpuSockets: VisibleCpuSocket[];
  activeCoreCount: number;
  idleCoreCount: number;
  cacheUsedBits: number;
  cacheUsedBytes: number;
  ramUsedBits: number;
  ramUsedBytes: number;
  ramSlots: VisibleRamSlot[];
  memory: VisibleMemoryPipeline;
  powerUsedWatts: number;
  powerHeadroomWatts: number;
  psuStress: number;
  restartReliability: number;
  corruptionRisk: number;
  coolingReliabilityBonus: number;
  powerCostPerMinute: number;
  cacheResidency: CacheResidencySegment[];
}

export interface VisibleState {
  stage: StageId;
  stageLabel: string;
  resources: ResourceBag;
  hardware: HardwareState;
  metrics: VisibleHardwareMetrics;
  flags: GameFlags;
  research: VisibleResearch[];
  activeTasks: VisibleActiveTask[];
  activeJobs: VisibleActiveJob[];
  queue: TaskId[];
  tasks: VisibleTask[];
  jobs: VisibleJob[];
  upgrades: VisibleUpgrade[];
  milestone: string;
}
