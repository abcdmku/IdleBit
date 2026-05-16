export type ResourceId = "credits" | "data";

export type StageId =
  | "primitiveCpu"
  | "singleCpu"
  | "multiCore"
  | "scheduler"
  | "systemReveal";

export type JobId =
  | "bitFlip"
  | "byteCopy"
  | "packetCheck"
  | "tinyChecksum"
  | "microBenchmark"
  | "parallelismBenchmark"
  | "multiCoreBenchmark";

export type UpgradeId =
  | "clock"
  | "cache"
  | "autoRepeat"
  | "core"
  | "basicQueue"
  | "scheduler"
  | "secondCpu";

export type UnlockId =
  | "cache"
  | "autoRepeat"
  | "benchmarks"
  | "multiCore"
  | "basicQueue"
  | "scheduler"
  | "secondCpu"
  | "systemStats";

export interface ResourceBag {
  credits: number;
  data: number;
}

export interface Cost {
  resource: ResourceId;
  amount: number;
}

export interface JobDefinition {
  id: JobId;
  name: string;
  kind: "job" | "benchmark";
  requiredCycles: number;
  cacheNeedBytes: number;
  rewardCredits: number;
  rewardData: number;
  parallelizable: boolean;
  repeatable: boolean;
  requirement: (state: GameState) => boolean;
}

export interface UpgradeDefinition {
  id: UpgradeId;
  name: string;
  accent: "cyan" | "green" | "violet" | "amber";
  maxPurchases?: number;
  requirement: (state: GameState) => boolean;
  cost: (state: GameState) => Cost[];
  buy: (state: GameState) => GameState;
}

export interface ActiveJob {
  instanceId: string;
  jobId: JobId;
  coreId: number;
  remainingCycles: number;
  totalCycles: number;
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
}

export interface HardwareState {
  clockLevel: number;
  clockHz: number;
  cacheLevel: number;
  cacheBytes: number;
  cores: number;
  secondCpu: boolean;
  ramGb: number;
  psuWatts: number;
}

export interface GameState {
  version: 1;
  tick: number;
  nextInstanceId: number;
  resources: ResourceBag;
  hardware: HardwareState;
  flags: GameFlags;
  completedJobs: Partial<Record<JobId, number>>;
  completedBenchmarks: JobId[];
  activeJobs: ActiveJob[];
  queue: JobId[];
  autoRepeatJobId: JobId | null;
}

export type GameAction =
  | { type: "startJob"; jobId: JobId }
  | { type: "queueJob"; jobId: JobId }
  | { type: "buyUpgrade"; upgradeId: UpgradeId }
  | { type: "setAutoRepeat"; jobId: JobId | null };

export interface VisibleJob {
  id: JobId;
  name: string;
  kind: JobDefinition["kind"];
  rewardCredits: number;
  rewardData: number;
  seconds: number;
  cacheFit: "bonus" | "met" | "low";
  canStart: boolean;
}

export interface VisibleUpgrade {
  id: UpgradeId;
  name: string;
  accent: UpgradeDefinition["accent"];
  costs: Cost[];
  canAfford: boolean;
  purchaseCount: number;
}

export interface VisibleActiveJob {
  instanceId: string;
  jobId: JobId;
  name: string;
  coreId: number;
  progress: number;
  remainingSeconds: number;
}

export interface VisibleState {
  stage: StageId;
  stageLabel: string;
  resources: ResourceBag;
  hardware: HardwareState;
  flags: GameFlags;
  activeJobs: VisibleActiveJob[];
  queue: JobId[];
  jobs: VisibleJob[];
  upgrades: VisibleUpgrade[];
  milestone: string;
}

