import type { Amount, ExactCost, ExactResourceBag } from "./amount";
import type {
  ClusterWorkloadDefinitionId,
  InfrastructureState,
  NetworkSkuId,
  ReplicaFaultDomain,
  ServerSkuId,
  StorageSkuId,
  VisibleInfrastructureState,
} from "./infrastructureTypes";
import type { Xoshiro128State } from "./rng";
import type {
  FacilityTemplateId,
  RackTemplateId,
} from "./facilityDefinitions";
import type {
  CloudSlaDefinitionId,
  CloudState,
} from "./cloudTypes";
import type { VisibleCloudState } from "./cloudSelectors";
import type { RoutingEdge } from "./routing";
import type {
  AcceleratorKind,
  AcceleratorSkuId,
  AcceleratorWorkloadClass,
} from "./content/accelerators";
import type {
  OverclockPresetId,
  WorkshopCoolingTierId,
} from "./content/cooling";
import type { InstalledAccelerator } from "./accelerators";
import type { ThermalState, ThermalStatus } from "./thermal";
import type { CapacityWorkRuntime } from "./capacityWork";
import type { WorkValueMultiplier } from "./workValue";

export type ResourceId = "credits" | "data";

export type CampaignChapterId =
  | "bootstrapNode"
  | "coherentMachine"
  | "workshopFleet"
  | "localFabric"
  | "rackAndFacility"
  | "resilientCloud"
  | "planetaryCommons";

export type SideArcId = "archivist" | "openFoundry" | "gridRelief";
export type FinaleCharterId = "resilience" | "efficiency" | "openCompute";
export type ContractKind = "sustained" | "burst";
export type ContractTemplateId =
  | "ledgerAudit"
  | "compileBatch"
  | "gridForecast"
  | "renderBurst"
  | "queueRecovery"
  | "replicaSurvey";
export type ProjectId =
  | "schedulerIntegration"
  | "archivist"
  | "openFoundry"
  | "gridRelief";

export interface CampaignObjectiveDefinition {
  id: string;
  chapterId: CampaignChapterId;
  name: string;
  description: string;
  transmission: string;
  requirement: (state: GameState) => boolean;
  blockedReason: (state: GameState) => string | null;
}

export interface CampaignChapterDefinition {
  id: CampaignChapterId;
  index: number;
  name: string;
  description: string;
  objectiveIds: string[];
}

export interface CampaignState {
  currentChapterId: CampaignChapterId;
  currentObjectiveId: string | null;
  completedChapterIds: CampaignChapterId[];
  completedObjectiveIds: string[];
  unlockedTransmissionIds: string[];
  sideArcsCompleted: SideArcId[];
  finaleCharterId: FinaleCharterId | null;
  postgameUnlocked: boolean;
}

export interface ContractOfferState {
  id: string;
  templateId: ContractTemplateId;
  kind: ContractKind;
  name: string;
  description: string;
  systemId: number;
  /** Legacy/UI projection only; productive progress never consumes time units. */
  workRequiredMs: number;
  /** Legacy aggregate compatibility projection. */
  workRequiredBits?: Amount;
  workRecipe?: import("./hardwareWork").HardwareWorkRecipe;
  /** Exact frozen work settled by this offer; defaults to the recipe total. */
  paidWorkUnits?: Amount;
  /** Named, frozen managed-offer premium applied to one Credit per work unit. */
  workValueMultiplier?: WorkValueMultiplier;
  /** @deprecated Legacy save field migrated into workValueMultiplier. */
  workValueMultiplierBps?: number;
  expiresAtMs: number;
  rewards: ExactResourceBag;
  novel: boolean;
}

export interface ActiveContractState extends ContractOfferState {
  acceptedAtMs: number;
  /** Legacy/UI completion projection derived from the hardware-work cursor. */
  workCompletedMs: number;
  workCompletedBits?: Amount;
  /** Exact completed recipe units; one means the frozen hardware path ran once. */
  workCompletedUnits?: Amount;
  /** Authoritative ordered-path cursor. */
  workStageIndex?: number;
  /** Exact work consumed within the current recipe stage. */
  workStageCompleted?: Amount;
}

export interface ContractMarketState {
  elapsedMs: number;
  offers: ContractOfferState[];
  active: ActiveContractState[];
  completedContractIds: string[];
  completedTemplateIds: ContractTemplateId[];
  completedRewards: Record<string, ExactResourceBag>;
  declinedContractIds: string[];
  nextContractId: number;
  refreshCount: number;
  nextRefreshAtMs: number;
}

export interface ProjectProgressState {
  projectId: ProjectId;
  phaseIndex: number;
  /** Exact unit-rate work completed across the current ordered recipe. */
  phaseWorkCompleted?: Amount;
  phaseStageIndex?: number;
  phaseStageWorkCompleted?: Amount;
  /** Baseline-equivalent projection retained for save/UI compatibility. */
  phaseProgressMs: number;
  active: boolean;
  completed: boolean;
  systemId: number | null;
}

export interface ProjectsState {
  progress: Partial<Record<ProjectId, ProjectProgressState>>;
  completedProjectIds: ProjectId[];
}

export type AutomationBufferLevelId =
  | "startingNode"
  | "localScheduler"
  | "cronRuntime"
  | "systemScheduler"
  | "fleetOrchestrator"
  | "clusterController"
  | "rackController"
  | "dataCenterNoc"
  | "globalScheduler";

export type AdvanceMode = "foreground" | "offline";

export interface AutomationBufferDefinition {
  id: AutomationBufferLevelId;
  name: string;
  maxOfflineMs: number;
  capability: string;
  requiredChapter: CampaignChapterId;
  requiredResearchId: ResearchId | null;
  costs: ExactCost[];
  renewsStandingOrders: boolean;
}

export interface AutomationBufferState {
  ownedLevelId: AutomationBufferLevelId;
  departureLevelId: AutomationBufferLevelId;
  offlineProcessedMs: number;
}

export interface StandingOrderState {
  taskId: TaskId | null;
  systemId: number | null;
  enabled: boolean;
  renewalCount: number;
}

/** Serializable foreground-only idle-capacity lane. */
export interface LiveOperationsState {
  systemId: number | null;
  maxCoreCount: number;
  enabled: boolean;
  activeTaskId: LiveOperationsTaskId;
  runtime: CapacityWorkRuntime | null;
  /** Transient physical allocation; save loading always clears it. */
  allocatedCoreIds: number[];
  completions: Partial<Record<LiveOperationsTaskId, number>>;
  rewardCreditsEarned: Partial<Record<LiveOperationsTaskId, Amount>>;
  dataEarned: Partial<Record<LiveOperationsTaskId, Amount>>;
  workCyclesCompleted: Partial<Record<LiveOperationsTaskId, Amount>>;
}

export interface GameTimeState {
  lastSavedAtMs: number | null;
  departedAtMs: number | null;
}

export interface DestructiveEventCounts {
  psuOverload: number;
  unpaidBill: number;
  deadlockWipe: number;
}

export interface AdvanceReport {
  mode: AdvanceMode;
  elapsedMs: number;
  simulatedMs: number;
  overflowMs: number;
  productiveMs: number;
  pausedMs: number;
  bufferLevelId: AutomationBufferLevelId;
  bufferCapacityMs: number;
  standingOrderRenewals: number;
  creditsEarned: Amount;
  creditsSpent: Amount;
  dataEarned: Amount;
  dataSpent: Amount;
  destructiveEvents: DestructiveEventCounts;
  safelyAvoidedDestructiveEvents: DestructiveEventCounts;
  completedWork: Partial<Record<TaskId, number>>;
  completedClusterWork?: Partial<Record<ClusterWorkloadDefinitionId, number>>;
  completedCloudSlas?: Partial<Record<CloudSlaDefinitionId, number>>;
  completionEvents?: Array<{
    source: "task" | "standing-order" | "live-operations";
    instanceId: string;
    workId: TaskId;
    name: string;
    completionCount: number;
    workCycles: Amount;
    creditsEarned: Amount;
    dataEarned: Amount;
  } | {
    source: "cluster";
    instanceId: string;
    workId: ClusterWorkloadDefinitionId;
    clusterId: string;
    creditsEarned: Amount;
    dataEarned: Amount;
  } | {
    source: "cloud";
    instanceId: string;
    workId: CloudSlaDefinitionId;
    creditsEarned: Amount;
    dataEarned: Amount;
  } | {
    source: "contract";
    instanceId: string;
    workId: ContractTemplateId;
    name: string;
    creditsEarned: Amount;
    dataEarned: Amount;
  } | {
    source: "project";
    instanceId: string;
    workId: ProjectId;
    phaseId: string;
    name: string;
    creditsEarned: Amount;
    dataEarned: Amount;
  } | {
    source: "workshop-storage";
    instanceId: string;
    workId: WorkshopStorageWorkloadId;
    name: string;
    completionCount: number;
    creditsEarned: Amount;
    dataEarned: Amount;
  }>;
  blockers: string[];
}

export interface AdvanceResult {
  state: GameState;
  /** Report for this call only; balance/telemetry consumers must use this. */
  intervalReport: AdvanceReport;
  /** Departure-cumulative offline report used by the return-summary UI. */
  report: AdvanceReport;
}

export type CpuTierId = "hz" | "khz" | "mhz" | "ghz";

export type StageId =
  | "primitiveCpu"
  | "singleCpu"
  | "multiCore"
  | "scheduler"
  | "systemReveal"
  | "fleet";

export type TaskId =
  | "fetchBit"
  | "decodeBit"
  | "bitFlip"
  | "bitShift"
  | "byteCopy"
  | "packetCheck"
  | "parallelBitCount"
  | "dualStreamDecode"
  | "readRamPage"
  | "writeRamPage"
  | "overwriteRamPage"
  | "stageChecksumPage"
  | "checksumStep"
  | "scanRamPage"
  | "repairRamDrift"
  | "readQueueTable"
  | "compactQueueEntries"
  | "samplePowerRails"
  | "normalizeDrawTrace"
  | "readBusWindow"
  | "mirrorBusState"
  | "sampleThermalSensors"
  | "fitHeatCurve"
  | "loadShards"
  | "reconcileShards"
  | "mergeShardBarrier"
  | "commitShards"
  | "stageSourceTree"
  | "compileUnits"
  | "linkBarrier"
  | "linkBinary"
  | "writeArtifact"
  | "loadSceneTiles"
  | "shadeTiles"
  | "compositeBarrier"
  | "compositeFrame"
  | "writeFrameBuffer"
  | "stageTestFixtures"
  | "runRegressionCases"
  | "compareResults"
  | "reportBarrier"
  | "summarizeReport"
  | "writeReport"
  | "loadInferenceModel"
  | "runInferenceBatch"
  | "writeInferenceResults"
  | "scatterShards"
  | "decodeShards"
  | "hashShards"
  | "commitBenchmarkResult"
  | "tinyChecksum"
  | "memoryScrub"
  | "queueCompaction"
  | "powerTelemetry"
  | "busMirror"
  | "thermalProbe"
  | "shardReconcile"
  | "compileCode"
  | "renderFrame"
  | "inferenceBatch"
  | "regressionTest"
  | "microBenchmark"
  | "parallelismBenchmark"
  | "multiCoreBenchmark"
  | "workstationBenchmark"
  | "liveQueueTriage"
  | "liveCanaryValidation";

export type LiveOperationsTaskId =
  | "liveQueueTriage"
  | "liveCanaryValidation";

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
  | "systemScheduler"
  | "bootloader"
  | "ramControl"
  | "systemBus"
  | "clickRateTuning"
  | "cronScheduler"
  | "systemCatalog"
  | "customMachineAssembly"
  | "psuManagement"
  | "thermalControl"
  | "specializedCompute"
  | "clusterControllerResearch"
  | "rackControllerResearch"
  | "dataCenterNocResearch"
  | "globalSchedulerResearch"
  | "cpuTierKhz"
  | "cpuTierMhz"
  | "cpuTierGhz"
  | "cStateControl"
  | "dualChannelRam"
  | "quadChannelRam"
  | "octChannelRam"
  | "memoryVoltageModifier";

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
  | "memoryVoltage"
  | "bootloader"
  | "cronSchedule"
  | "cronInterval"
  | "psu"
  | "cooling"
  | "cState";

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
  | "scheduler"
  | "secondCpu"
  | "systemStats"
  | "cron"
  | "systemCatalog"
  | "customMachineAssembly"
  | "psuManagement"
  | "cooling"
  | "specializedCompute"
  | "cStateControl"
  | "dualChannelRam"
  | "quadChannelRam"
  | "octChannelRam"
  | "memoryVoltageModifier"
  | "bootloader";

export type TaskKind = "task" | "job" | "benchmark";

export type TaskCategory = "cpu" | "system" | "distributed";

export type TaskCoreScaling = "fixed" | "chunked";

export type TaskVisibility = "default" | "internal";

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

export type SchedulerKillPolicy =
  | "deadlockedTask"
  | "newestBlocker"
  | "lowestProgress";

export type SchedulerResourcePriority =
  | "speed"
  | "capacity"
  | "parallelism";

export type PowerStateId = "on" | "shuttingDown" | "off" | "booting";
export type PowerFailureReason = "psuOverload" | "unpaidBill";
export type IdlePowerPolicy = "low-power" | "shutdown-when-idle";

/** Absent means player/CRON initiated work; only the engine can renew this origin. */
export type WorkOrigin = "standing-order";

export type CronIntervalMode = "seconds" | "minutes";

export type CronRunStatus = "queued" | "skipped" | "blocked";

export interface SchedulerConfig {
  ramPriority: SchedulerResourcePriority;
  cpuPriority: SchedulerResourcePriority;
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

/** Legacy name retained as an alias; all authoritative costs are ExactCost. */
export type Cost = ExactCost;

/** Bounded projection of an exact economy cost for renderer-only math. */
export interface VisibleCost {
  resource: ResourceId;
  amount: number;
}

export interface TaskOperationDefinition {
  id: string;
  name: string;
  sourceTaskId?: TaskId;
  sourceTaskName?: string;
  kind: TaskOperationKind;
  memoryAction: TaskMemoryOperationKind | null;
  count: number;
  cycles: number;
  cacheBits: number;
  ramBits: number;
  cacheBytes: number;
  ramBytes: number;
  parallel: boolean;
  acceleratorClass?: AcceleratorWorkloadClass | null;
  acceleratorModelMemoryBits?: number;
  acceleratorBatchSize?: number;
  acceleratorMinimumComputeOperationsPerSecond?: number;
  acceleratorPreferredKind?: AcceleratorKind | null;
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
  sourceTaskId?: TaskId;
  sourceTaskName?: string;
  kind: TaskSubtaskKind;
  dependsOn: string[];
  operationIds: string[];
  operations: TaskOperationDefinition[];
  /** Safe/clamped compatibility projection for selectors and bounded kernels. */
  operationCount: number;
  subtasks: TaskSubtaskDefinition[];
  cycles: number;
  cacheBits: number;
  ramBits: number;
  cacheBytes: number;
  ramBytes: number;
}

export interface TaskCompositionDefinition {
  taskId: TaskId;
  count: number;
  mode: "single" | "perWorkUnit";
}

export interface AggregateTaskBatchDefinition {
  /** Authored data/work volume: repeats the complete per-unit hardware recipe. */
  workUnitMultiplier: number;
  /** Hard v1 bound; aggregate work never creates one runtime event per unit. */
  maximumMultiplier: number;
}

export interface TaskDefinition {
  id: TaskId;
  name: string;
  kind: TaskKind;
  category: TaskCategory;
  visibility: TaskVisibility;
  composition: TaskCompositionDefinition[];
  operations: TaskOperationDefinition[];
  subtasks: TaskSubtaskDefinition[];
  dagNodes: TaskSubtaskDefinition[];
  /** Authored operation invocations; never includes cycles or transfer bits. */
  operationCount: number;
  /** Exact authored invocation total; numeric operationCount is its safe projection. */
  operationCountExact: Amount;
  /** Runtime-aligned paid work; concurrent memory issue/cache transfer counts once. */
  paidWorkUnits: number;
  paidWorkUnitsExact: Amount;
  /** Safe/clamped compatibility projection; rewardCreditsExact is authoritative. */
  rewardCredits: number;
  rewardCreditsExact: Amount;
  aggregateBatch: AggregateTaskBatchDefinition | null;
  /** Stable per-completion Data payout; rewardDataExact is authoritative. */
  rewardData: number;
  rewardDataExact: Amount;
  parallelizable: boolean;
  /** Public direct-core dispatch is blocked; work must enter a CPU scheduler queue. */
  requiresCpuScheduler: boolean;
  repeatable: boolean;
  coreScaling: TaskCoreScaling;
  workUnitCount: number;
  workUnitName: string;
  /** Bounded physical-kernel projection. */
  workUnitOperationCount: number;
  workUnitOperationCountExact: Amount;
  /** Safe/clamped physical-kernel projection. */
  workUnitCycles: number;
  workUnitCyclesExact: Amount;
  workUnitCacheNeedBits: number;
  workUnitRamNeedBits: number;
  minCores: number;
  maxCores?: number;
  reveal: (state: GameState) => boolean;
  requirement: (state: GameState) => boolean;
  /** Safe/clamped compatibility projection; requiredCyclesExact is authoritative. */
  requiredCycles: number;
  /** Authoritative logical work total for economy/save/runtime state. */
  requiredCyclesExact: Amount;
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
  ramTierId?: CpuTierId;
}

export interface ActiveCoreOperation {
  coreId: number;
  workUnitIndex?: number | null;
  operationIndex: number;
  operationId: string | null;
  operationName: string | null;
  status: OperationRuntimeStatus;
  memoryState: MemoryRuntimeState;
  remainingCycles: Amount;
  totalCycles: Amount;
  remainingLoadCycles: Amount;
  totalLoadCycles: Amount;
  memoryReservedBits: number;
  memoryReservedBytes: number;
  ramBlocks: RamBlockAllocation[];
  ramChannelCount: number;
  lockResource: DeadlockResource | null;
  lockReason: string | null;
  deadlockSeconds: number;
}

export interface ActiveTask {
  instanceId: string;
  taskId: TaskId;
  jobId: JobId;
  systemId?: number;
  queueEntryId?: string | null;
  parentQueueEntryId?: string | null;
  parentTaskId?: TaskId | null;
  childTaskId?: TaskId | null;
  workOrigin?: WorkOrigin;
  schedulerQueued: boolean;
  coreId: number;
  assignedCoreIds: number[];
  workUnitsTotal?: number;
  workUnitsStarted?: number;
  workUnitsCompleted?: number;
  workUnitsPending?: number[];
  coreOperations: ActiveCoreOperation[];
  acceleratorKindsUsed?: AcceleratorKind[];
  batchMultiplier?: number;
  projectedRewardCredits?: Amount;
  projectedWorkCycles?: Amount;
  remainingCycles: Amount;
  totalCycles: Amount;
}

export type ActiveJob = ActiveTask;

export interface CoreSchedulerState {
  coreId: number;
  activeTaskInstanceId: string | null;
  operationId: string | null;
  status: OperationRuntimeStatus | "idle";
  memoryState: MemoryRuntimeState;
  localQueue: TaskId[];
  localQueueEntries?: TaskQueueEntry[];
  progress: number;
}

export interface TaskQueueEntry {
  id: string;
  reservationId?: string | null;
  taskId: TaskId;
  name?: string;
  category?: TaskCategory;
  cacheNeedBits?: number;
  ramNeedBits?: number;
  requiredCores?: number;
  parentTaskId?: TaskId | null;
  parentTaskName?: string | null;
  parentQueueEntryId?: string | null;
  childTaskId?: TaskId | null;
  childTaskName?: string | null;
  workOrigin?: WorkOrigin;
  compositionIndex?: number | null;
  compositionRepeatIndex?: number | null;
  workUnitIndex?: number | null;
  childWorkKey?: string | null;
  completedChildKeys?: string[];
  acceleratorKindsUsed?: AcceleratorKind[];
  batchMultiplier?: number;
  projectedRewardCredits?: Amount;
  projectedWorkCycles?: Amount;
  totalChildCount?: number;
  target: "cpu" | "system";
}

export interface PowerRuntimeState {
  state: PowerStateId;
  idlePolicy: IdlePowerPolicy;
  transitionSeconds: number;
  transitionTotalSeconds?: number;
  bootstrapGraceSeconds: number;
  unpaidShutdownWarningSeconds: number;
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
  cpuTierId?: CpuTierId;
  cpuLevel?: number;
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

export interface MachineCpuPackageSelection {
  coreCount?: number;
  cpuLevel?: number;
  cacheLevel?: number;
  cacheSpeedLevel?: number;
  schedulerSlots?: number;
}

export interface MachineComponentSelection {
  cpu: string;
  cpuPackageCount?: number;
  cpuCoreCount?: number;
  cpuLevel?: number;
  cacheLevel?: number;
  cacheSpeedLevel?: number;
  cpuPackageConfigs?: MachineCpuPackageSelection[];
  cpuSchedulerSlots?: number;
  ram: string;
  ramStickCount?: number;
  ramLevel?: number;
  ramSpeedLevel?: number;
  scheduler: string;
  psu: string;
  psuLevel?: number;
}

export interface MachineTemplateDefinition {
  id: string;
  name: string;
  description: string;
  components: MachineComponentSelection;
}

export interface MachinePowerProjection {
  idleWatts: number;
  peakWatts: number;
  psuCapacityWatts: number;
  idlePsuLoad: number;
  peakPsuLoad: number;
  powerCostPerSecond: number;
  safe: boolean;
}

export interface WorkshopSpecializationEvidence {
  gpuRenderCompletions: number;
  npuInferenceCompletions: number;
}

export type WorkshopStorageWorkloadId = "artifactStaging";

export interface WorkshopStorageWorkloadState {
  definitionId: WorkshopStorageWorkloadId;
  runtime: CapacityWorkRuntime;
  operatingCreditsSpent: Amount;
}

export interface WorkshopSystemState {
  thermal: ThermalState;
  highestObservedThermalStatus: ThermalStatus;
  coolingTierId: WorkshopCoolingTierId;
  overclockPresetId: OverclockPresetId;
  expansionSlots: number;
  accelerators: InstalledAccelerator[];
  nextAcceleratorId: number;
  storageSkuId: StorageSkuId;
  activeStorageWorkload: WorkshopStorageWorkloadState | null;
  completedStorageWorkloads: number;
  evidence: WorkshopSpecializationEvidence;
}

export interface SystemState {
  id: number;
  name: string;
  templateId: string | null;
  hardware: HardwareState;
  workshop: WorkshopSystemState;
  power: PowerRuntimeState;
  cron: CronRuntimeState;
  activeTasks: ActiveTask[];
  activeJobs: ActiveJob[];
  cacheResidency: CacheResidencySegment[];
  coreSchedulers: Record<number, CoreSchedulerState>;
  queue: TaskId[];
  queueEntries?: TaskQueueEntry[];
  deadlockPressureSeconds: number;
  deadlockPressureResource: DeadlockResource | null;
  deadlockPressureCpuId: number | null;
  deadlockProcessLockout: boolean;
  purchaseCosts: Cost[];
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
  specializedCompute: boolean;
  cStateControl: boolean;
  dualChannelRam: boolean;
  quadChannelRam: boolean;
  octChannelRam: boolean;
  memoryVoltageModifier: boolean;
  bootloader?: boolean;
  schedulerWatchdog: boolean;
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
  memoryVoltageLevel: number;
  bootloaderLevel?: number;
  cronScheduleSlots: number;
  cronIntervalLevel: number;
  cStateLevel: number;
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

export interface RamBlockAllocation {
  stickId: number;
  startBit: number;
  lengthBits: number;
  loadedBits: number;
  channelIndex: number;
}

export interface CpuHardwareState {
  id: number;
  tierId: CpuTierId;
  level: number;
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
  clickRateLevel?: number;
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
  stickId?: number;
  startBit?: number;
  bits: number;
  loadedBits?: number;
  channelIndex?: number;
  state: "reserved" | "loading" | "loaded";
  progress: number;
}

export interface GameState {
  version: 7;
  tick: number;
  advanceRemainderMs: number;
  nextInstanceId: number;
  exactResources: ExactResourceBag;
  rng: Xoshiro128State;
  time: GameTimeState;
  campaign: CampaignState;
  contracts: ContractMarketState;
  projects: ProjectsState;
  infrastructure: InfrastructureState;
  cloud: CloudState;
  automationBuffer: AutomationBufferState;
  standingOrder: StandingOrderState;
  liveOperations: LiveOperationsState;
  lastAdvanceReport: AdvanceReport | null;
  selectedSystemId: number;
  rack: RackState;
  systems: SystemState[];
  deadlockPressureSeconds: number;
  deadlockPressureResource: DeadlockResource | null;
  deadlockPressureCpuId: number | null;
  deadlockProcessLockout: boolean;
  resources: ResourceBag;
  hardware: HardwareState;
  workshop: WorkshopSystemState;
  flags: GameFlags;
  power: PowerRuntimeState;
  cron: CronRuntimeState;
  research: ResearchState;
  reliability: ReliabilityState;
  completedTasks: Partial<Record<TaskId, number>>;
  completedJobs: Partial<Record<JobId, number>>;
  /** Cumulative exact task economics; report deltas preserve aggregate batches. */
  taskRewardCreditsEarned: Partial<Record<TaskId, Amount>>;
  taskWorkCyclesCompleted: Partial<Record<TaskId, Amount>>;
  /** Cumulative provenance totals used to split standing work from other tasks. */
  standingTaskCompletions: Partial<Record<TaskId, number>>;
  standingTaskRewardCreditsEarned: Partial<Record<TaskId, Amount>>;
  standingTaskDataEarned: Partial<Record<TaskId, Amount>>;
  standingTaskWorkCyclesCompleted: Partial<Record<TaskId, Amount>>;
  completedBenchmarks: TaskId[];
  activeTasks: ActiveTask[];
  activeJobs: ActiveJob[];
  cacheResidency: CacheResidencySegment[];
  coreSchedulers: Record<number, CoreSchedulerState>;
  queue: TaskId[];
  queueEntries?: TaskQueueEntry[];
  autoRepeatJobId: JobId | null;
}

export type GameAction =
  | { type: "startTask"; taskId: TaskId; systemId?: number }
  | { type: "startTaskOnCore"; taskId: TaskId; coreId: number; systemId?: number }
  | { type: "queueTask"; taskId: TaskId; cpuId?: number; systemId?: number }
  | {
      type: "cancelTask";
      taskId: TaskId;
      instanceId?: string;
      coreId?: number;
      systemId?: number;
    }
  | { type: "cancelQueuedTask"; taskId: TaskId; systemId?: number }
  | { type: "requestShutdown"; systemId?: number }
  | { type: "requestStartup"; systemId?: number }
  | { type: "requestPowerOff"; systemId?: number }
  | { type: "requestPowerOn"; systemId?: number }
  | { type: "requestPowerKill"; systemId?: number }
  | {
      type: "setIdlePowerPolicy";
      policy: IdlePowerPolicy;
      systemId?: number;
    }
  | { type: "acknowledgePowerFailure" }
  | { type: "selectSystem"; systemId: number }
  | { type: "buyMachineTemplate"; templateId: string }
  | { type: "buyCustomMachine"; components: MachineComponentSelection }
  | { type: "sellSystem"; systemId: number }
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
      type: "setSchedulerResourcePriority";
      resource: "ram" | "cpu";
      priority: SchedulerResourcePriority;
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
      type: "installCoolingTier";
      tierId: WorkshopCoolingTierId;
      systemId?: number;
    }
  | {
      type: "setOverclockPreset";
      presetId: OverclockPresetId;
      systemId?: number;
    }
  | {
      type: "installAccelerator";
      skuId: AcceleratorSkuId;
      slotId?: number;
      systemId?: number;
    }
  | {
      type: "removeAccelerator";
      deviceId: string;
      systemId?: number;
    }
  | {
      type: "installWorkshopStorage";
      skuId: StorageSkuId;
      systemId?: number;
    }
  | {
      type: "installLocalNetwork";
      skuId: NetworkSkuId;
      systemId?: number;
    }
  | {
      type: "startWorkshopStorageWorkload";
      workloadId: WorkshopStorageWorkloadId;
      systemId?: number;
    }
  | { type: "cancelWorkshopStorageWorkload"; systemId?: number }
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
      ramTierId?: CpuTierId;
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
      ramTierId?: CpuTierId;
    }
  | { type: "startJob"; jobId: JobId; systemId?: number }
  | { type: "startJobOnCore"; jobId: JobId; coreId: number; systemId?: number }
  | { type: "queueJob"; jobId: JobId; cpuId?: number; systemId?: number }
  | { type: "setAutoRepeat"; jobId: JobId | null }
  | { type: "purchaseAutomationBuffer"; levelId: AutomationBufferLevelId }
  | { type: "recordDeparture"; timestampMs: number }
  | { type: "recordSave"; timestampMs: number }
  | {
      type: "setStandingOrder";
      taskId: TaskId | null;
      systemId?: number;
    }
  | { type: "setStandingOrderEnabled"; enabled: boolean }
  | {
      type: "configureLiveOperations";
      systemId: number;
      maxCoreCount: number;
    }
  | { type: "setLiveOperationsEnabled"; enabled: boolean }
  | { type: "refreshContractMarket" }
  | { type: "acceptContract"; contractId: string; systemId?: number }
  | { type: "declineContract"; contractId: string }
  | { type: "completeContract"; contractId: string }
  | { type: "startProjectPhase"; projectId: ProjectId; systemId?: number }
  | { type: "selectFinaleCharter"; charterId: FinaleCharterId }
  | { type: "setSystemManaged"; systemId: number; managed: boolean }
  | {
      type: "purchaseAggregateServerBatch";
      skuId: ServerSkuId;
      count: number;
      storageSkuId?: StorageSkuId;
      networkSkuId?: NetworkSkuId;
    }
  | {
      type: "commissionCluster";
      name: string;
      nodeIds: string[];
      defaultWeight?: number;
      reserveHeadroomBps?: number;
      replicaFaultDomain?: ReplicaFaultDomain;
    }
  | { type: "setClusterNodes"; clusterId: string; nodeIds: string[] }
  | {
      type: "setClusterPolicy";
      clusterId: string;
      defaultWeight?: number;
      reserveHeadroomBps?: number;
      replicaFaultDomain?: ReplicaFaultDomain;
    }
  | {
      type: "startClusterWorkload";
      clusterId: string;
      definitionId: ClusterWorkloadDefinitionId;
      weight?: number;
    }
  | { type: "cancelClusterWorkload"; workloadId: string }
  | { type: "setClusterWorkloadWeight"; workloadId: string; weight: number }
  | {
      type: "commissionFacility";
      templateId: FacilityTemplateId;
      name?: string;
    }
  | {
      type: "commissionFacilityRack";
      facilityId: string;
      templateId: RackTemplateId;
      name?: string;
    }
  | {
      type: "placeFleetNodeInRack";
      facilityId: string;
      rackId: string;
      nodeId: string;
    }
  | { type: "removeFleetNodeFromRack"; nodeId: string }
  | { type: "commissionCloudRegion"; name: string }
  | {
      type: "commissionCloudZone";
      regionId: string;
      facilityId: string;
      name?: string;
      baseLatencyMs?: number;
      faultDomainId?: string;
    }
  | { type: "placeCloudReplica"; zoneId: string }
  | { type: "setCloudRegionalDemand"; regionId: string; demand: Amount }
  | { type: "setCloudRoutingLinks"; links: RoutingEdge[] }
  | {
      type: "setCloudFailoverPolicy";
      automaticFailover: boolean;
      delayMs?: number;
    }
  | { type: "requestCloudFailover" }
  | { type: "drawCloudIncident"; optIn: boolean; windowMs: number }
  | { type: "startCloudSla"; definitionId: CloudSlaDefinitionId }
  | { type: "startPlanetaryFinale" };

export interface VisibleOperation {
  id: string;
  name: string;
  sourceTaskId?: TaskId;
  sourceTaskName?: string;
  kind: TaskOperationKind;
  memoryAction: TaskMemoryOperationKind | null;
  count: number;
  cacheBits: number;
  ramBits: number;
  cacheBytes: number;
  ramBytes: number;
  parallel: boolean;
  acceleratorClass: AcceleratorWorkloadClass | null;
  acceleratorModelMemoryBits: number;
  acceleratorBatchSize: number;
  acceleratorMinimumComputeOperationsPerSecond: number;
  acceleratorPreferredKind: AcceleratorKind | null;
}

export interface VisibleTaskSubtask {
  id: string;
  name: string;
  sourceTaskId?: TaskId;
  sourceTaskName?: string;
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

export interface VisibleTaskProjection {
  durationMs: number;
  baseDurationMs?: number;
  batchMultiplier?: number;
  logicalWorkUnitCount?: number;
  paidWorkUnits?: Amount;
  rewardCredits?: Amount;
  energyCostCredits: Amount;
  netRewardCredits: Amount;
  creditRunwayMs: number | null;
  creditRunwayCovered: boolean;
  bufferCovered: boolean;
  cacheFits: boolean;
  ramFits: boolean;
  pauseReason: string | null;
}

export interface VisibleTask {
  id: TaskId;
  name: string;
  kind: TaskKind;
  category: TaskCategory;
  visibility: TaskVisibility;
  composition: TaskCompositionDefinition[];
  rewardCredits: number;
  /** Data settled by every completion. */
  rewardData: number;
  completionCount: number;
  cacheNeedBits: number;
  ramNeedBits: number;
  cacheNeedBytes: number;
  ramNeedBytes: number;
  operationCount: number;
  /** Player-facing compute ops (CPU cycles), kept separate from transfer work. */
  requiredCycles: number;
  paidWorkUnits: number;
  operations: VisibleOperation[];
  subtaskCount: number;
  subtasks: VisibleTaskSubtask[];
  dagNodes: VisibleTaskSubtask[];
  requiredCores: number;
  coreScaling: TaskCoreScaling;
  workUnitCount: number;
  workUnitName: string;
  cacheFit: "bonus" | "met" | "low";
  canStart: boolean;
  canQueue: boolean;
  blockedReason: string | null;
  queueBlockedReason: string | null;
  projection: VisibleTaskProjection;
}

export interface VisibleJob extends VisibleTask {
  seconds: number;
}

export interface VisibleUpgrade {
  id: UpgradeId;
  name: string;
  component: HardwareComponentId;
  accent: UpgradeDefinition["accent"];
  costs: VisibleCost[];
  refunds: VisibleCost[];
  powerDeltaWatts?: number | null;
  canAfford: boolean;
  canDowngrade: boolean;
  downgradeBlockedReason: string | null;
  purchaseCount: number;
  maxed?: boolean;
}

export interface VisibleRamInstallOption {
  tierId: CpuTierId;
  tierName: string;
  level: number;
  sizeBits: number;
  sizeBytes: number;
  speedMt: number;
  upgrade: VisibleUpgrade;
}

export interface VisibleResearch {
  id: ResearchId;
  name: string;
  description: string;
  grants: UnlockId[];
  costs: VisibleCost[];
  canAfford: boolean;
  canBuy: boolean;
  completed: boolean;
  actionLabel?: string;
  completedLabel: "Researched";
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
  /** Player-facing compute ops (CPU cycles), kept separate from transfer work. */
  requiredCycles: number;
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
  /** Exact hardware/economy projection used by balance and research UI adapters. */
  projection: VisibleTaskProjection;
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
  queueEntryId?: string | null;
  parentQueueEntryId?: string | null;
  parentTaskId?: TaskId | null;
  childTaskId?: TaskId | null;
  schedulerQueued: boolean;
  name: string;
  coreId: number;
  assignedCoreIds: number[];
  batchMultiplier?: number;
  projectedRewardCredits?: Amount;
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
  tierId: CpuTierId;
  tierName: string;
  level: number;
  clockHz: number;
  efficiency: number;
  activeDrawWatts: number;
  idleDrawWatts: number;
  cores: VisibleCore[];
  cacheLevel: number;
  cacheSpeedLevel: number;
  cacheSpeedHz: number;
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
  packageClockUpgrade: VisibleUpgrade | null;
  cStateUpgrade: VisibleUpgrade | null;
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
  efficiency?: number;
  active?: boolean;
  capacityUpgrade: VisibleUpgrade | null;
  speedUpgrade: VisibleUpgrade | null;
}

export interface VisibleMemoryPipeline {
  status: MemoryRuntimeState;
  cacheLoads: number;
  ramLoads: number;
  waits: number;
  deadlocks: number;
  activeChannelCount: number;
  maxChannelCount: number;
  effectiveBandwidthBps: number;
  channelBlockedReason: string | null;
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
  idlePowerPolicy: IdlePowerPolicy;
  coreCount: number;
  activeTaskCount: number;
  queueCount: number;
  psuStress: number;
  drawWatts: number;
  ramBits: number;
  ramUsedBits: number;
  thermalStatus: ThermalStatus;
  acceleratorCount: number;
  purchaseCosts: VisibleCost[];
  sellRefund: VisibleCost[];
}

export interface VisibleRackState {
  selectedSystemId: number;
  systems: VisibleSystemSummary[];
  templates?: VisibleMachineTemplate[];
  preconfiguredSystems?: VisibleMachineTemplate[];
  customBuilder?: unknown;
  unlocked?: boolean;
}

export interface VisibleComponentSku
  extends Omit<ComponentSkuDefinition, "cost"> {
  cost: VisibleCost[];
  canAfford: boolean;
  tierName?: string;
  clockHz?: number;
  cpuEfficiency?: number;
  cacheSpeedHz?: number;
  cacheBits?: number;
  cacheBytes?: number;
  ramBits?: number;
  ramBytes?: number;
  ramSpeedMt?: number;
  psuWatts?: number;
  powerDeltaWatts?: number;
}

export interface VisibleMachineTemplate
  extends Omit<MachineTemplateDefinition, "cost"> {
  cost: VisibleCost[];
  canAfford: boolean;
  canBuy: boolean;
  blockedReason: string | null;
  projection: MachinePowerProjection;
}

export interface VisibleMachineBuilder {
  unlocked: boolean;
  advancedUnlocked: boolean;
  canBuy: boolean;
  blockedReason: string | null;
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
  ramInstallOptions: VisibleRamInstallOption[];
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
  thermalStress: number | null;
  thermalStatus: ThermalStatus;
  thermalThroughputModifierBps: number;
  thermalGeneratedHeatWatts: Amount;
  thermalSustainedHeatWatts: Amount;
  coolingCapacityWatts: Amount;
  coolingPowerWatts: Amount;
  powerCostPerSecond: number;
  powerState: PowerStateId;
  idlePowerPolicy: IdlePowerPolicy;
  powerTransitionSeconds: number;
  powerTransitionTotalSeconds?: number;
  powerBootstrapGraceSeconds: number;
  powerUnpaidShutdownWarningSeconds: number;
  powerOverloadFailure: VisiblePowerOverloadFailure;
  cacheResidency: CacheResidencySegment[];
}

export interface VisibleWorkshopCoolingTier {
  id: WorkshopCoolingTierId;
  name: string;
  description: string;
  level: number;
  capacityWatts: Amount;
  powerDrawWatts: Amount;
  costs: ExactCost[];
  /** Non-empty when selecting this tier is a downgrade: half the installed tier's cost. */
  refunds: ExactCost[];
  installed: boolean;
  canInstall: boolean;
  blockedReason: string | null;
}

export interface VisibleWorkshopOverclockPreset {
  id: OverclockPresetId;
  name: string;
  description: string;
  clockMultiplierBps: number;
  powerMultiplierBps: number;
  heatMultiplierBps: number;
  selected: boolean;
  canSelect: boolean;
  blockedReason: string | null;
}

export interface VisibleWorkshopAcceleratorSku {
  id: AcceleratorSkuId;
  kind: AcceleratorKind;
  name: string;
  description: string;
  supportedWorkloadClasses: readonly AcceleratorWorkloadClass[];
  expansionSlots: number;
  deviceMemoryBits: Amount;
  minimumBatchSize: Amount;
  computeOperationsPerSecond: Amount;
  throughputMultiplierBps: number;
  idlePowerWatts: Amount;
  activePowerWatts: Amount;
  idleHeatWatts: Amount;
  activeHeatWatts: Amount;
  costs: ExactCost[];
  canInstall: boolean;
  blockedReason: string | null;
}

export interface VisibleWorkshopAccelerator extends InstalledAccelerator {
  kind: AcceleratorKind;
  name: string;
  expansionSlots: number;
  active: boolean;
}

export interface VisibleWorkshopRoute {
  workloadId: string;
  taskInstanceId: string;
  taskId: TaskId;
  coreId: number;
  operationId: string;
  workloadClass: AcceleratorWorkloadClass;
  target: "accelerator" | "cpu" | "blocked";
  deviceId: string | null;
  skuId: AcceleratorSkuId | null;
  acceleratorKind: AcceleratorKind | null;
  fallbackReason: string | null;
}

export interface VisibleWorkshopStorageSku {
  id: StorageSkuId;
  name: string;
  description: string;
  capacityBits: Amount;
  readBitsPerSecond: Amount;
  writeBitsPerSecond: Amount;
  idlePowerWatts: Amount;
  peakPowerWatts: Amount;
  idleHeatWatts: Amount;
  peakHeatWatts: Amount;
  costs: ExactCost[];
  installed: boolean;
  canInstall: boolean;
  blockedReason: string | null;
}

export interface VisibleWorkshopNetworkSku {
  id: NetworkSkuId;
  name: string;
  description: string;
  ingressBitsPerSecond: Amount;
  egressBitsPerSecond: Amount;
  idlePowerWatts: Amount;
  peakPowerWatts: Amount;
  costs: ExactCost[];
  installed: boolean;
  canInstall: boolean;
  blockedReason: string | null;
}

export interface VisibleWorkshopStorageWorkload {
  id: WorkshopStorageWorkloadId;
  name: string;
  description: string;
  storageRequiredBits: Amount;
  readBits: Amount;
  writeBits: Amount;
  paidWorkUnits: Amount;
  workValueMultiplier: WorkValueMultiplier;
  rewards: ExactResourceBag;
  active: boolean;
  completedCount: number;
  progressBps: number;
  canStart: boolean;
  blockedReason: string | null;
  projection: {
    durationMs: Amount | null;
    operatingCostCredits: Amount | null;
    netRewardCredits: Amount | null;
    bufferCovered: boolean;
    pauseReason: string | null;
  };
}

export interface VisibleWorkshopState {
  thermalVisible: boolean;
  thermalControlsUnlocked: boolean;
  specializedComputeUnlocked: boolean;
  thermalStatus: ThermalStatus;
  thermalStressBps: number;
  thermalThroughputModifierBps: number;
  generatedHeatWatts: Amount;
  sustainedHeatWatts: Amount;
  coolingCapacityWatts: Amount;
  coolingPowerWatts: Amount;
  highestObservedThermalStatus: ThermalStatus;
  coolingTierId: WorkshopCoolingTierId;
  overclockPresetId: OverclockPresetId;
  coolingTiers: VisibleWorkshopCoolingTier[];
  overclockPresets: VisibleWorkshopOverclockPreset[];
  expansionSlots: number;
  accelerators: VisibleWorkshopAccelerator[];
  acceleratorSkus: VisibleWorkshopAcceleratorSku[];
  routes: VisibleWorkshopRoute[];
  storageUnlocked: boolean;
  storageSkuId: StorageSkuId;
  storageSkus: VisibleWorkshopStorageSku[];
  networkUnlocked: boolean;
  networkSkuId: NetworkSkuId;
  networkSkus: VisibleWorkshopNetworkSku[];
  storageWorkload: VisibleWorkshopStorageWorkload;
  evidence: WorkshopSpecializationEvidence;
  specializationComplete: boolean;
}

export interface VisibleInputConfig {
  clickRateLevel: number;
  taskHoldRateHz: number;
  taskHoldRepeatMs: number;
  taskHoldMaxMs: number;
}

export interface VisibleAutomationBufferUpgrade {
  id: AutomationBufferLevelId;
  name: string;
  maxOfflineMs: number;
  costs: ExactCost[];
  unlocked: boolean;
  canAfford: boolean;
  blockedReason: string | null;
}

export interface VisibleAutomationBuffer {
  ownedLevelId: AutomationBufferLevelId;
  maxOfflineMs: number;
  departureLevelId: AutomationBufferLevelId;
  departureMaxOfflineMs: number;
  offlineProcessedMs: number;
  remainingOfflineMs: number;
  nextUpgrade: VisibleAutomationBufferUpgrade | null;
}

export interface VisibleCampaignChapter {
  id: CampaignChapterId;
  index: number;
  name: string;
  description: string;
  completed: boolean;
}

export interface VisibleMission {
  id: string;
  chapterId: CampaignChapterId;
  name: string;
  description: string;
  transmission: string;
  completed: boolean;
  current: boolean;
  blockedReason: string | null;
}

/** Per-lane authored work totals so cards can show what a job consumes. */
export interface VisibleWorkMixStage {
  resource:
    | "cache"
    | "ram"
    | "compute"
    | "storageRead"
    | "storageWrite"
    | "networkIngress"
    | "networkEgress";
  work: Amount;
}

export interface VisibleContractSystemOption {
  systemId: number;
  name: string;
  /** Why accepting this offer on this system is blocked; null when eligible. */
  blockedReason: string | null;
}

export interface VisibleContract {
  id: string;
  templateId: ContractTemplateId;
  kind: ContractKind;
  name: string;
  description: string;
  /** Generator-suggested default target; acceptance honors the player's choice. */
  systemId: number;
  workRequiredMs: number;
  workCompletedMs: number;
  workRequiredBits?: Amount;
  workCompletedBits?: Amount;
  paidWorkUnits?: Amount;
  workValueMultiplier?: WorkValueMultiplier;
  remainingMs: number;
  expiresAtMs: number | null;
  rewards: ExactResourceBag;
  novel: boolean;
  accepted: boolean;
  valuePerHourCredits: Amount;
  expiresInMs: number | null;
  operatingCostCredits: Amount;
  netRewardCredits: Amount;
  creditRunwayCovered: boolean;
  bufferCovered: boolean;
  canAccept: boolean;
  projectedPauseReason: string | null;
  /**
   * Per-owned-system acceptance availability for offers (empty once
   * accepted); busy or incompatible systems keep their explicit blocker.
   */
  systemOptions?: VisibleContractSystemOption[];
  workMix?: VisibleWorkMixStage[];
  valueMultiplierVsStandingOrderBps?: number | null;
  offerPremiumBps?: Amount;
  /** @deprecated Compatibility projection for balance tooling. */
  authoredWorkValueMultiplierBps?: number | null;
}

export interface VisibleContractMarket {
  elapsedMs: number;
  canRefresh: boolean;
  refreshAvailableInMs: number;
  refreshBlockedReason: string | null;
  standingOrderTaskName: string;
  standingOrderValuePerHourCredits: Amount;
}

/** Work-surface reveal gates; all progression logic stays in src/game. */
export interface VisibleWorkViews {
  campaign: boolean;
  market: boolean;
  automation: boolean;
}

export interface VisibleProjectPhase {
  id: string;
  name: string;
  durationMs: number;
  costs: ExactCost[];
  rewards: ExactResourceBag;
  paidWorkUnits?: Amount;
  workValueMultiplier?: WorkValueMultiplier;
  workMix?: VisibleWorkMixStage[];
}

export interface VisibleProjectSystemProjection {
  systemId: number;
  durationMs: number;
  remainingMs: number;
  projectionBlockedReason: string | null;
  canStartPhase: boolean;
  startBlockedReason: string | null;
}

export interface VisibleProject {
  id: ProjectId;
  name: string;
  description: string;
  sideArcId: SideArcId | null;
  currentPhase: VisibleProjectPhase | null;
  phaseIndex: number;
  phaseProgressMs: number;
  remainingMs: number;
  /** Why the assigned system cannot currently project the remaining recipe. */
  projectionBlockedReason?: string | null;
  /** Target-specific projection and start validation for each available system. */
  systemProjections?: VisibleProjectSystemProjection[];
  active: boolean;
  completed: boolean;
  canStartPhase: boolean;
  blockedReason: string | null;
}

export interface VisibleStandingOrderWork {
  taskId: TaskId | null;
  name: string;
  enabled: boolean;
  systemId: number | null;
  renewalCount: number;
}

export type ActiveWorkKind =
  | "project"
  | "contract"
  | "standingOrder"
  | "job"
  | "clusterWorkload"
  | "facilityWorkload"
  | "workshopStorage"
  | "cloud"
  | "sla"
  | "finale";

export interface VisibleActiveWork {
  id: string;
  kind: ActiveWorkKind;
  name: string;
  progress: number;
  remainingMs: number | null;
  systemId: number | null;
}

export interface VisibleDeparturePowerPolicy {
  systemId: number;
  name: string;
  powerState: PowerStateId;
  drawWatts: number;
  psuStress: number;
}

export interface VisibleDepartureForecast {
  coverageMs: number;
  timedActiveCount: number;
  fittingActiveCount: number;
  unknownDurationCount: number;
  renewalSupported: boolean;
  renewalEnabled: boolean;
  renewalTaskName: string | null;
  aggregateOperatingCostPerSecond: Amount;
  creditRunwayMs: number | null;
  projectedPauseReason: string | null;
  safePowerPolicy: "pause-before-unsafe";
  powerPolicies: VisibleDeparturePowerPolicy[];
}

export interface VisibleWorkState {
  missions: VisibleMission[];
  projects: VisibleProject[];
  contracts: VisibleContract[];
  contractMarket: VisibleContractMarket;
  standingOrders: VisibleStandingOrderWork[];
  jobs: VisibleJob[];
  activeWork: VisibleActiveWork[];
  departureForecast: VisibleDepartureForecast;
}

export interface VisibleLiveOperations {
  unlocked: boolean;
  enabled: boolean;
  canConfigure: boolean;
  systemId: number | null;
  maxCoreCount: number;
  maximumCoreCount: number;
  workMix: [
    { id: TaskId; name: string },
    { id: TaskId; name: string },
  ];
  activeTaskId: TaskId | null;
  activeTaskName: string | null;
  nextTaskName: string;
  allocatedCoreCount: number;
  progress: number;
  remainingMs: number | null;
  projectedDurationMs: number | null;
  projectedPowerWatts: string;
  projectedOperatingCostCredits: Amount;
  projectedRewardCredits: Amount;
  projectedNetRewardCredits: Amount;
  projectedMarginBps: number | null;
  blockedReason: string | null;
  offlineBehavior: string;
}

export interface VisibleState {
  stage: StageId;
  stageLabel: string;
  resources: ResourceBag;
  exactResources: ExactResourceBag;
  infrastructure: VisibleInfrastructureState;
  cloud: VisibleCloudState;
  automationBuffer: VisibleAutomationBuffer;
  standingOrder: StandingOrderState;
  liveOperations: VisibleLiveOperations;
  offlineReport: AdvanceReport | null;
  campaign: CampaignState;
  currentChapter: VisibleCampaignChapter;
  currentObjective: VisibleMission | null;
  bottleneck: string;
  missions: VisibleMission[];
  projects: VisibleProject[];
  contracts: VisibleContract[];
  contractMarket: VisibleContractMarket;
  workViews: VisibleWorkViews;
  standingOrders: VisibleStandingOrderWork[];
  activeWork: VisibleActiveWork[];
  departureForecast: VisibleDepartureForecast;
  work: VisibleWorkState;
  rack: VisibleRackState;
  systems: VisibleSystemSummary[];
  selectedSystem: VisibleSystemSummary;
  machineBuilder: VisibleMachineBuilder;
  hardware: HardwareState;
  workshop: VisibleWorkshopState;
  input?: VisibleInputConfig;
  metrics: VisibleHardwareMetrics;
  flags: GameFlags;
  research: VisibleResearch[];
  activeTasks: VisibleActiveTask[];
  activeJobs: VisibleActiveJob[];
  queue: Array<TaskId | TaskQueueEntry>;
  cron: VisibleCronState;
  tasks: VisibleTask[];
  jobs: VisibleJob[];
  upgrades: VisibleUpgrade[];
  milestone: string;
}
