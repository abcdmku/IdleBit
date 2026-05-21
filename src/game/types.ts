export type ResourceId = "credits" | "data";

export type StageId =
  | "primitiveCpu"
  | "singleCpu"
  | "multiCore"
  | "scheduler"
  | "systemReveal"
  | "rack";

export type TaskId =
  | "fetchBit"
  | "decodeBit"
  | "bitFlip"
  | "bitShift"
  | "byteCopy"
  | "packetCheck"
  | "tinyChecksum"
  | "memoryScrub"
  | "queueCompaction"
  | "powerTelemetry"
  | "busMirror"
  | "thermalProbe"
  | "shardReconcile"
  | "compileCode"
  | "renderFrame"
  | "regressionTest"
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
  | "schedulerWatchdog"
  | "schedulerPolicies"
  | "systemScheduler"
  | "ramControl"
  | "systemBus"
  | "cronScheduler"
  | "systemCatalog"
  | "customMachineAssembly"
  | "psuManagement"
  | "thermalControl";

export type UpgradeId =
  | "clock"
  | "cache"
  | "cacheSpeed"
  | "autoRepeat"
  | "core"
  | "schedulerSlot"
  | "systemSchedulerSlot"
  | "basicQueue"
  | "scheduler"
  | "secondCpu"
  | "matchedCpu"
  | "deadlockRecovery"
  | "ram"
  | "ramCapacity"
  | "ramSpeed"
  | "cronSchedule"
  | "cronInterval"
  | "psu"
  | "cooling";

export type HardwareComponentId =
  | "cpu"
  | "cache"
  | "scheduler"
  | "socket"
  | "ram"
  | "cron"
  | "thermal"
  | "psu";

export type UnlockId =
  | "cache"
  | "autoRepeat"
  | "benchmarks"
  | "multiCore"
  | "basicQueue"
  | "schedulerWatchdog"
  | "schedulerPolicies"
  | "scheduler"
  | "secondCpu"
  | "systemStats"
  | "cron"
  | "systemCatalog"
  | "customMachineAssembly"
  | "psuManagement"
  | "cooling";

export type TaskKind = "task" | "job" | "benchmark";

export type TaskCategory = "cpu" | "system" | "distributed";

export type TaskCoreScaling = "fixed" | "elastic";

export type TaskOperationKind = "memory" | "compute" | "barrier";

export type TaskMemoryOperationKind = "read" | "write" | "overwrite";

export type OperationRuntimeStatus =
  | "loadingCache"
  | "loadingRam"
  | "running"
  | "waitingMemory"
  | "waitingBarrier"
  | "deadlocked"
  | "complete";

export type MemoryRuntimeState =
  | "idle"
  | "cacheLoad"
  | "ramLoad"
  | "waiting"
  | "ready"
  | "deadlock";

export type DeadlockResource = "cache" | "ram";

export type SchedulerPolicy =
  | "fifo"
  | "deadlockSafe"
  | "shortestTask"
  | "smallestMemory";

export type SchedulerKillPolicy =
  | "deadlockedTask"
  | "newestBlocker"
  | "lowestProgress";

export type PowerStateId = "on" | "shuttingDown" | "off" | "booting";
export type PowerFailureReason = "psuOverload" | "unpaidBill";

export type CronIntervalMode = "seconds" | "minutes";

export type CronRunStatus = "queued" | "skipped" | "blocked";

export interface SchedulerConfig {
  policy: SchedulerPolicy;
  autoKillEnabled: boolean;
  killPolicy: SchedulerKillPolicy;
}

export interface SchedulerWatchdogPreview {
  target: "cpu" | "system";
  cpuId: number | null;
  resource: DeadlockResource;
  killPolicy: SchedulerKillPolicy;
  deadlockedTaskId: TaskId;
  deadlockedTaskName: string;
  deadlockedInstanceId: string;
  victimTaskId: TaskId;
  victimTaskName: string;
  victimInstanceId: string;
  victimCoreIds: number[];
  secondsRemaining: number;
  progress: number;
}

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
  category: TaskCategory;
  operations: TaskOperationDefinition[];
  subtasks: TaskSubtaskDefinition[];
  dagNodes: TaskSubtaskDefinition[];
  operationCount: number;
  rewardCredits: number;
  rewardData: number;
  parallelizable: boolean;
  repeatable: boolean;
  coreScaling: TaskCoreScaling;
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
  refund?: (state: GameState, context?: UpgradeContext) => Cost[];
  downgrade?: (state: GameState, context?: UpgradeContext) => GameState;
  downgradeBlockedReason?: (
    state: GameState,
    context?: UpgradeContext,
  ) => string | null;
}

export interface UpgradeContext {
  coreId?: number;
  coreIds?: number[];
  cpuId?: number;
  systemId?: number;
  sourceCpuId?: number;
  ramStickId?: number;
  ramStickIds?: number[];
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
  lockResource: DeadlockResource | null;
  lockReason: string | null;
  deadlockSeconds: number;
}

export interface ActiveTask {
  instanceId: string;
  taskId: TaskId;
  jobId: JobId;
  systemId?: number;
  schedulerQueued: boolean;
  coreId: number;
  assignedCoreIds: number[];
  coreOperations: ActiveCoreOperation[];
  remainingCycles: number;
  totalCycles: number;
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

export interface PowerRuntimeState {
  state: PowerStateId;
  transitionSeconds: number;
  bootstrapGraceSeconds: number;
  overloadFailureSeconds: number;
  lastFailureReason: PowerFailureReason | null;
  failureCount: number;
}

export interface CronRunResult {
  status: CronRunStatus;
  message: string;
  taskId: TaskId | null;
  tick: number;
}

export interface CronScheduleState {
  id: number;
  taskId: TaskId | null;
  enabled: boolean;
  intervalMode: CronIntervalMode;
  intervalValue: number;
  remainingSeconds: number;
  lastResult: CronRunResult | null;
}

export interface CronRuntimeState {
  schedules: CronScheduleState[];
  nextScheduleId: number;
  queuePowerSpikeSeconds: number;
}

export type ComponentSkuType = "cpu" | "ram" | "scheduler" | "psu";

export interface ComponentSkuDefinition {
  id: string;
  name: string;
  type: ComponentSkuType;
  description: string;
  cost: Cost[];
  cpuPackageCount?: number;
  coreCount?: number;
  clockLevel?: number;
  cacheLevel?: number;
  cacheSpeedLevel?: number;
  schedulerSlots?: number;
  ramStickCount?: number;
  ramLevel?: number;
  ramSpeedLevel?: number;
  psuLevel?: number;
}

export interface MachineComponentSelection {
  cpu: string;
  cpuPackageCount?: 1 | 2 | 4 | 8;
  ram: string;
  scheduler: string;
  psu: string;
}

export interface MachineTemplateDefinition {
  id: string;
  name: string;
  description: string;
  components: MachineComponentSelection;
}

export interface SystemState {
  id: number;
  name: string;
  templateId: string | null;
  hardware: HardwareState;
  power: PowerRuntimeState;
  cron: CronRuntimeState;
  activeTasks: ActiveTask[];
  activeJobs: ActiveJob[];
  cacheResidency: CacheResidencySegment[];
  coreSchedulers: Record<number, CoreSchedulerState>;
  queue: TaskId[];
  deadlockPressureSeconds: number;
  deadlockPressureResource: DeadlockResource | null;
  deadlockPressureCpuId: number | null;
  deadlockProcessLockout: boolean;
}

export interface RackState {
  nextSystemId: number;
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
  cron: boolean;
  systemCatalog: boolean;
  customMachineAssembly: boolean;
  psuManagement: boolean;
  cooling: boolean;
  schedulerWatchdog: boolean;
  schedulerPolicies: boolean;
}

export interface HardwareState {
  clockLevel: number;
  clockHz: number;
  coreClockLevels: Record<number, number>;
  cpus: CpuHardwareState[];
  cacheLevel: number;
  cacheSpeedLevel: number;
  cacheBits: number;
  cacheBytes: number;
  cores: number;
  schedulerSlots: number;
  systemSchedulerSlots: number;
  systemSchedulerConfig: SchedulerConfig;
  deadlockRecoveryLevel: number;
  secondCpu: boolean;
  ramLevel: number;
  ramBits: number;
  ramBytes: number;
  ramSpeedLevel: number;
  ramSpeedMt: number;
  ramSticks: RamStickState[];
  cronScheduleSlots: number;
  cronIntervalLevel: number;
  psuLevel: number;
  psuWatts: number;
  coolingLevel: number;
  coolingRating: number;
}

export interface RamStickState {
  id: number;
  level: number;
  bits: number;
  bytes: number;
  speedLevel: number;
  speedMt: number;
}

export interface CpuHardwareState {
  id: number;
  coreIds: number[];
  cacheLevel: number;
  cacheSpeedLevel: number;
  cacheBits: number;
  cacheBytes: number;
  schedulerSlots: number;
  schedulerConfig: SchedulerConfig;
}

export interface ResearchState {
  completed: ResearchId[];
}

export interface ReliabilityState {
  lastEvent: null;
}

export interface CacheResidencySegment {
  coreId: number;
  bits: number;
  bufferBits?: number;
  readyBits?: number;
  committedBits?: number;
  memoryAction: TaskMemoryOperationKind | null;
  operationId?: string | null;
  state?: "buffering" | "loading" | "loaded";
  progress?: number;
  bufferProgress?: number;
}

export interface RamResidencySegment {
  coreId: number;
  taskId: TaskId;
  operationId?: string | null;
  bits: number;
  state: "reserved" | "loading" | "loaded";
  progress: number;
}

export interface GameState {
  version: 2;
  tick: number;
  nextInstanceId: number;
  selectedSystemId: number;
  rack: RackState;
  systems: SystemState[];
  deadlockPressureSeconds: number;
  deadlockPressureResource: DeadlockResource | null;
  deadlockPressureCpuId: number | null;
  deadlockProcessLockout: boolean;
  resources: ResourceBag;
  hardware: HardwareState;
  flags: GameFlags;
  power: PowerRuntimeState;
  cron: CronRuntimeState;
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
  | { type: "startTask"; taskId: TaskId; systemId?: number }
  | { type: "startTaskOnCore"; taskId: TaskId; coreId: number; systemId?: number }
  | { type: "queueTask"; taskId: TaskId; cpuId?: number; systemId?: number }
  | { type: "cancelTask"; taskId: TaskId; instanceId?: string; systemId?: number }
  | { type: "cancelQueuedTask"; taskId: TaskId; systemId?: number }
  | { type: "requestShutdown"; systemId?: number }
  | { type: "requestStartup"; systemId?: number }
  | { type: "requestPowerOff"; systemId?: number }
  | { type: "requestPowerOn"; systemId?: number }
  | { type: "requestPowerKill"; systemId?: number }
  | { type: "acknowledgePowerFailure" }
  | { type: "selectSystem"; systemId: number }
  | { type: "buyMachineTemplate"; templateId: string }
  | { type: "buyCustomMachine"; components: MachineComponentSelection }
  | { type: "setCronTask"; scheduleId: number; taskId: TaskId | null; systemId?: number }
  | {
      type: "setCronInterval";
      scheduleId: number;
      intervalMode: CronIntervalMode;
      intervalValue: number;
      systemId?: number;
    }
  | { type: "setCronEnabled"; scheduleId: number; enabled: boolean; systemId?: number }
  | {
      type: "setSchedulerPolicy";
      target: "cpu" | "system";
      policy: SchedulerPolicy;
      cpuId?: number;
      systemId?: number;
    }
  | {
      type: "setSchedulerAutoKill";
      target: "cpu" | "system";
      enabled: boolean;
      cpuId?: number;
      systemId?: number;
    }
  | {
      type: "setSchedulerKillPolicy";
      target: "cpu" | "system";
      killPolicy: SchedulerKillPolicy;
      cpuId?: number;
      systemId?: number;
    }
  | { type: "buyResearch"; researchId: ResearchId }
  | {
      type: "buyUpgrade";
      upgradeId: UpgradeId;
      coreId?: number;
      coreIds?: number[];
      cpuId?: number;
      systemId?: number;
      sourceCpuId?: number;
      ramStickId?: number;
      ramStickIds?: number[];
    }
  | {
      type: "downgradeUpgrade";
      upgradeId: UpgradeId;
      coreId?: number;
      coreIds?: number[];
      cpuId?: number;
      systemId?: number;
      sourceCpuId?: number;
      ramStickId?: number;
      ramStickIds?: number[];
    }
  | { type: "startJob"; jobId: JobId; systemId?: number }
  | { type: "startJobOnCore"; jobId: JobId; coreId: number; systemId?: number }
  | { type: "queueJob"; jobId: JobId; cpuId?: number; systemId?: number }
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
  category: TaskCategory;
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
  coreScaling: TaskCoreScaling;
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
  refunds: Cost[];
  powerDeltaWatts?: number | null;
  canAfford: boolean;
  canDowngrade: boolean;
  downgradeBlockedReason: string | null;
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
  category: TaskCategory;
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
  lockResource: DeadlockResource | null;
  lockReason: string | null;
  deadlockSeconds: number;
}

export interface VisibleActiveTask {
  instanceId: string;
  taskId: TaskId;
  jobId: JobId;
  systemId?: number;
  schedulerQueued: boolean;
  name: string;
  coreId: number;
  assignedCoreIds: number[];
  progress: number;
  status: OperationRuntimeStatus;
  memoryState: MemoryRuntimeState;
  activeOperationName: string | null;
  coreProgress: VisibleCoreTaskProgress[];
  lockResource: DeadlockResource | null;
  lockReason: string | null;
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
  deadlocked: boolean;
  deadlockResource: DeadlockResource | null;
}

export interface VisibleCpuSocket {
  id: number;
  label: string;
  cores: VisibleCore[];
  cacheLevel: number;
  cacheSpeedLevel: number;
  cacheBits: number;
  cacheBytes: number;
  cacheUsedBits: number;
  cacheUsedBytes: number;
  cacheResidency: CacheResidencySegment[];
  schedulerSlots: number;
  queuedCount: number;
  schedulerConfig: SchedulerConfig;
  watchdog: SchedulerWatchdogPreview | null;
  deadlocked: boolean;
  deadlockResource: DeadlockResource | null;
  deadlockRecoveryUpgrade: VisibleUpgrade | null;
  allCoreClockUpgrade: VisibleUpgrade | null;
  coreUpgrade: VisibleUpgrade | null;
  cacheUpgrade: VisibleUpgrade | null;
  cacheSpeedUpgrade: VisibleUpgrade | null;
  schedulerSlotUpgrade: VisibleUpgrade | null;
}

export interface VisibleRamSlot {
  id: number;
  level: number;
  sizeBits: number;
  sizeBytes: number;
  usedBits: number;
  usedBytes: number;
  speedLevel: number;
  speedMt: number;
  capacityUpgrade: VisibleUpgrade | null;
  speedUpgrade: VisibleUpgrade | null;
}

export interface VisibleMemoryPipeline {
  status: MemoryRuntimeState;
  cacheLoads: number;
  ramLoads: number;
  waits: number;
  deadlocks: number;
}

export interface VisibleDeadlockSummary {
  taskId: TaskId;
  taskName: string;
  coreIds: number[];
  cpuId: number;
  resource: DeadlockResource;
  reason: string;
  schedulerQueued: boolean;
}

export interface VisibleDeadlockPressure {
  seconds: number;
  limitSeconds: number;
  remainingSeconds: number;
  progress: number;
  cooldownRate: number;
  resource: DeadlockResource | null;
  cpuId: number | null;
  active: boolean;
  lockout: boolean;
}

export interface VisiblePowerOverloadFailure {
  seconds: number;
  limitSeconds: number;
  remainingSeconds: number;
  progress: number;
  rate: number;
  active: boolean;
  tripped: boolean;
}

export interface VisibleCronTaskOption {
  id: TaskId;
  name: string;
}

export interface VisibleCronSchedule {
  id: number;
  taskId: TaskId | null;
  taskName: string | null;
  enabled: boolean;
  intervalMode: CronIntervalMode;
  intervalValue: number;
  remainingSeconds: number;
  lastResult: CronRunResult | null;
}

export interface VisibleCronState {
  unlocked: boolean;
  minIntervalSeconds: number;
  schedules: VisibleCronSchedule[];
  taskOptions: VisibleCronTaskOption[];
  intervalUpgrade: VisibleUpgrade | null;
  queuePowerSpikeSeconds: number;
}

export interface VisibleSystemSummary {
  id: number;
  name: string;
  templateId: string | null;
  selected: boolean;
  powerState: PowerStateId;
  coreCount: number;
  activeTaskCount: number;
  queueCount: number;
  psuStress: number;
  drawWatts: number;
  ramBits: number;
  ramUsedBits: number;
}

export interface VisibleRackState {
  selectedSystemId: number;
  systems: VisibleSystemSummary[];
  templates?: VisibleMachineTemplate[];
  preconfiguredSystems?: VisibleMachineTemplate[];
  customBuilder?: unknown;
  unlocked?: boolean;
}

export interface VisibleComponentSku extends ComponentSkuDefinition {
  canAfford: boolean;
  clockHz?: number;
  cacheSpeedHz?: number;
  cacheBits?: number;
  cacheBytes?: number;
  ramBits?: number;
  ramBytes?: number;
  ramSpeedMt?: number;
  psuWatts?: number;
  powerDeltaWatts?: number;
}

export interface VisibleMachineTemplate extends MachineTemplateDefinition {
  cost: Cost[];
  canAfford: boolean;
}

export interface VisibleMachineBuilder {
  unlocked: boolean;
  templates: VisibleMachineTemplate[];
  components: {
    cpu: VisibleComponentSku[];
    ram: VisibleComponentSku[];
    scheduler: VisibleComponentSku[];
    psu: VisibleComponentSku[];
  };
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
  allRamCapacityUpgrade: VisibleUpgrade | null;
  allRamSpeedUpgrade: VisibleUpgrade | null;
  ramResidency: RamResidencySegment[];
  memory: VisibleMemoryPipeline;
  deadlocks: VisibleDeadlockSummary[];
  deadlockPressure: VisibleDeadlockPressure;
  systemSchedulerWatchdog: SchedulerWatchdogPreview | null;
  powerUsedWatts: number;
  billedPowerWatts: number;
  powerHeadroomWatts: number;
  psuStress: number;
  powerReliability: number;
  powerEfficiency: number;
  ramEfficiency: number;
  cpuEfficiency: number;
  coolingReliabilityBonus: number;
  powerCostPerSecond: number;
  powerState: PowerStateId;
  powerTransitionSeconds: number;
  powerBootstrapGraceSeconds: number;
  powerOverloadFailure: VisiblePowerOverloadFailure;
  cacheResidency: CacheResidencySegment[];
}

export interface VisibleState {
  stage: StageId;
  stageLabel: string;
  resources: ResourceBag;
  rack: VisibleRackState;
  systems: VisibleSystemSummary[];
  selectedSystem: VisibleSystemSummary;
  machineBuilder: VisibleMachineBuilder;
  hardware: HardwareState;
  metrics: VisibleHardwareMetrics;
  flags: GameFlags;
  research: VisibleResearch[];
  activeTasks: VisibleActiveTask[];
  activeJobs: VisibleActiveJob[];
  queue: TaskId[];
  cron: VisibleCronState;
  tasks: VisibleTask[];
  jobs: VisibleJob[];
  upgrades: VisibleUpgrade[];
  milestone: string;
}
