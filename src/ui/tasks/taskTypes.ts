import type { Amount, DeadlockResource, VisibleCore, VisibleState } from "../../game";
import type { DisplayCost } from "../format";

export type TaskState =
  | "active"
  | "waiting"
  | "deadlock"
  | "rerun"
  | "restart"
  | "ready"
  | "locked";

export type QueueMode = "core" | "scheduler" | "systemScheduler";
export type TaskRouteLayer = QueueMode;
export type TaskCategoryId = "cpu" | "system" | "distributed" | "other";

export interface UiTaskGraphNode {
  id?: string;
  name?: string;
  sourceTaskId?: string;
  sourceTaskName?: string;
  kind?: string;
  memoryAction?: string | null;
  count?: number;
  operationCount?: number;
  paidWorkUnits?: number;
  cycles?: number;
  requiredCycles?: number;
  cacheNeedBits?: number;
  cacheBits?: number;
  cacheNeedBytes?: number;
  cacheBytes?: number;
  ramNeedBits?: number;
  memoryNeedBits?: number;
  ramBits?: number;
  memoryBits?: number;
  ramNeedBytes?: number;
  memoryNeedBytes?: number;
  ramBytes?: number;
  requiredCores?: number;
  minCores?: number;
  parallel?: boolean;
  cacheFit?: "bonus" | "met" | "low";
  progress?: number;
  status?: string;
  state?: string;
  memoryState?: string;
  operationIds?: string[];
  dependencyIds?: string[];
  dependencies?: Array<string | { id?: string; name?: string }>;
  dependsOn?: Array<string | { id?: string; name?: string }>;
  requires?: Array<string | { id?: string; name?: string }>;
  operations?: number | UiTaskOperation[];
  subtasks?: UiTaskGraphNode[];
  subTasks?: UiTaskGraphNode[];
  dagNodes?: UiTaskGraphNode[];
  tasks?: UiTaskGraphNode[];
  children?: UiTaskGraphNode[];
}

export interface UiTaskOperation extends UiTaskGraphNode {
  id: string;
  name: string;
  kind?: string;
  memoryAction?: string | null;
  count?: number;
}

export interface UiTask {
  id: string;
  name: string;
  kind?: string;
  category?: string;
  composition?: Array<{
    taskId?: string;
    count?: number;
    mode?: "single" | "perWorkUnit" | string;
  }>;
  operationCount?: number;
  paidWorkUnits?: number;
  cycles?: number;
  operations?: number | UiTaskOperation[];
  opCount?: number;
  requiredOps?: number;
  requiredOperations?: number;
  requiredCycles?: number;
  requiredCores?: number;
  minCores?: number;
  coreScaling?: "fixed" | "chunked";
  workUnitCount?: number;
  workUnitName?: string;
  rewardCredits?: number;
  rewardData?: number;
  rewards?: Partial<Record<"credits" | "data", number>>;
  cacheNeedBits?: number;
  cacheBits?: number;
  cacheNeedBytes?: number;
  cacheBytes?: number;
  ramNeedBits?: number;
  memoryNeedBits?: number;
  ramBits?: number;
  memoryBits?: number;
  ramNeedBytes?: number;
  memoryNeedBytes?: number;
  ramBytes?: number;
  cacheFit?: "bonus" | "met" | "low";
  progress?: number;
  canStart?: boolean;
  canRun?: boolean;
  canQueue?: boolean;
  blockedReason?: string | null;
  queueBlockedReason?: string | null;
  lockedReason?: string | null;
  lockReason?: string | null;
  unlockReason?: string | null;
  status?: string;
  state?: string;
  completed?: boolean;
  completedCount?: number;
  completionCount?: number;
  repeatable?: boolean;
  operationIds?: string[];
  dependencyIds?: string[];
  dependencies?: Array<string | { id?: string; name?: string }>;
  dependsOn?: Array<string | { id?: string; name?: string }>;
  requires?: Array<string | { id?: string; name?: string }>;
  subtasks?: UiTaskGraphNode[];
  subTasks?: UiTaskGraphNode[];
  dagNodes?: UiTaskGraphNode[];
  tasks?: UiTaskGraphNode[];
  children?: UiTaskGraphNode[];
  projection?: {
    durationMs: number;
    energyCostCredits: Amount;
    netRewardCredits: Amount;
    creditRunwayMs: number | null;
    creditRunwayCovered: boolean;
    bufferCovered: boolean;
    cacheFits: boolean;
    ramFits: boolean;
    pauseReason: string | null;
  };
}

export interface UiActiveTask {
  instanceId?: string;
  taskId?: string;
  queueEntryId?: string | null;
  parentQueueEntryId?: string | null;
  parentTaskId?: string | null;
  childTaskId?: string | null;
  schedulerQueued?: boolean;
  name: string;
  coreId: number;
  assignedCoreIds?: number[];
  progress: number;
  status?: string;
  state?: string;
  memoryState?: string;
  activeOperationName?: string | null;
  coreProgress?: Array<{
    coreId: number;
    operationId: string | null;
    operationName: string | null;
    memoryAction?: string | null;
    status?: string;
    memoryState?: string;
    progress: number;
    remainingCycles?: number;
    totalCycles?: number;
    remainingLoadCycles?: number;
    totalLoadCycles?: number;
    cacheBits?: number;
    memoryReservedBits?: number;
    memoryReservedBytes?: number;
    lockResource?: DeadlockResource | null;
    lockReason?: string | null;
    deadlockSeconds?: number;
  }>;
  lockResource?: DeadlockResource | null;
  lockReason?: string | null;
}

export interface UiResearchRequirement {
  id: string;
  label: string;
  kind?: string;
  met?: boolean;
}

export interface UiResearchComputeTask extends UiTask {
  active?: boolean;
  progress?: number;
}

export interface UiResearch {
  id: string;
  name: string;
  description?: string;
  costs?: DisplayCost[];
  cost?: DisplayCost[];
  canAfford?: boolean;
  canBuy?: boolean;
  actionLabel?: string;
  completedLabel?: string;
  lockedReason?: string | null;
  lockReason?: string | null;
  unlockReason?: string | null;
  purchased?: boolean;
  completed?: boolean;
  blockedReason?: string | null;
  requirements?: UiResearchRequirement[];
  computeTasks?: UiResearchComputeTask[];
  status?: string;
  accent?: "cyan" | "green" | "violet" | "amber";
}

export type UiQueueEntry =
  | string
  | {
      id?: string;
      reservationId?: string | null;
      taskId?: string;
      name?: string;
      category?: string;
      cacheNeedBits?: number;
      ramNeedBits?: number;
      requiredCores?: number;
      parentTaskId?: string | null;
      parentTaskName?: string | null;
      parentQueueEntryId?: string | null;
      childTaskId?: string | null;
      childTaskName?: string | null;
      childWorkKey?: string | null;
      completedChildKeys?: string[];
      totalChildCount?: number;
      socketId?: number;
      coreId?: number;
      state?: string;
      status?: string;
    };

export type UiCore = VisibleCore & { activeTask?: UiActiveTask | null };

export type UiTaskVisibleState = VisibleState & {
  tasks?: UiTask[];
  research?: UiResearch[];
  activeTasks?: UiActiveTask[];
  queue: UiQueueEntry[];
  systemStatus?: {
    cacheBits?: number;
    cacheUsedBytes?: number;
    cacheUsedBits?: number;
    cacheBytes?: number;
    ramBits?: number;
    memoryBits?: number;
    ramUsedBytes?: number;
    ramUsedBits?: number;
    memoryUsedBits?: number;
    ramBytes?: number;
    memory?: {
      usedBits?: number;
      usedBytes?: number;
      capacityBits?: number;
      capacityBytes?: number;
    };
    cache?: {
      usedBits?: number;
      usedBytes?: number;
      capacityBits?: number;
      capacityBytes?: number;
    };
  };
  hardware: VisibleState["hardware"] & {
    cacheBits?: number;
    ramBits?: number;
    memoryBits?: number;
    systemSchedulerSlots?: number;
  };
};
