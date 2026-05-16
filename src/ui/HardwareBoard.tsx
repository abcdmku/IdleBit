import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Activity,
  CheckCircle2,
  Cpu,
  Database,
  Eye,
  HardDrive,
  Info,
  ListTodo,
  MemoryStick,
  Play,
  Power,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type {
  HardwareComponentId,
  UpgradeId,
  VisibleCore,
  VisibleCpuSocket,
  VisibleState,
  VisibleUpgrade,
} from "../game";
import {
  formatBitRate,
  formatBits,
  formatClock,
  formatCost,
  formatNumber,
  formatWatts,
  type DisplayCost,
} from "./format";
import type { Dispatch } from "./uiActions";
import type { SelectedComponent } from "./workbenchData";
import { componentCopy } from "./workbenchData";

type TaskState = "active" | "waiting" | "rerun" | "restart" | "ready" | "locked";
type QueueMode = "core" | "scheduler" | "auto";
type ResourceKind = "data" | "credits";
type ResourceGainKind = ResourceKind;
type CacheSegmentKind = "read" | "write" | "overwrite" | "compute";
type CacheSegmentState = "buffering" | "loading" | "loaded";

interface CacheSegment {
  kind: CacheSegmentKind;
  state: CacheSegmentState;
  coreId: number;
  bits: number;
  progress: number;
  bufferProgress: number;
}

interface ResourceGainBurst {
  id: number;
  kind: ResourceGainKind;
  amount: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const resourceVisuals: Record<
  ResourceKind,
  { label: string; Icon: LucideIcon }
> = {
  data: { label: "data", Icon: Database },
  credits: { label: "credits", Icon: Zap },
};

const isResourceKind = (resource: string): resource is ResourceKind =>
  resource === "data" || resource === "credits";

function ResourceAmount({
  resource,
  amount,
  plus = false,
  showLabel = true,
  compact = false,
}: {
  resource: ResourceKind;
  amount: number;
  plus?: boolean;
  showLabel?: boolean;
  compact?: boolean;
}) {
  const { Icon, label } = resourceVisuals[resource];

  return (
    <span className={`resource-token ${resource} ${compact ? "compact" : ""}`}>
      <Icon size={compact ? 13 : 17} />
      <strong>
        {plus ? "+" : ""}
        {formatNumber(amount)}
      </strong>
      {showLabel && <span>{label}</span>}
    </span>
  );
}

function ResourceCost({
  costs,
  compact = false,
}: {
  costs: DisplayCost[];
  compact?: boolean;
}) {
  if (costs.length === 0) return <span className="resource-cost empty">Open</span>;

  return (
    <span className={`resource-cost ${compact ? "compact" : ""}`}>
      {costs.map((cost, index) => {
        const key = `${cost.resource}-${index}`;

        if (!isResourceKind(cost.resource)) {
          return (
            <span className="resource-token unknown" key={key}>
              <strong>{formatNumber(cost.amount)}</strong>
              <span>{cost.resource}</span>
            </span>
          );
        }

        return (
          <ResourceAmount
            key={key}
            resource={cost.resource}
            amount={cost.amount}
            compact={compact}
            showLabel={!compact}
          />
        );
      })}
    </span>
  );
}

interface UiTaskGraphNode {
  id?: string;
  name?: string;
  kind?: string;
  memoryAction?: string | null;
  count?: number;
  operationCount?: number;
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

interface UiTaskOperation extends UiTaskGraphNode {
  id: string;
  name: string;
  kind?: string;
  memoryAction?: string | null;
  count?: number;
}

interface UiTask {
  id: string;
  name: string;
  kind?: string;
  operationCount?: number;
  operations?: number | UiTaskOperation[];
  opCount?: number;
  requiredOps?: number;
  requiredOperations?: number;
  requiredCycles?: number;
  requiredCores?: number;
  minCores?: number;
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
}

interface UiActiveTask {
  instanceId?: string;
  taskId?: string;
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
    reruns?: number;
    restarts?: number;
    corruptions?: number;
  }>;
}

interface UiResearchRequirement {
  id: string;
  label: string;
  kind?: string;
  met?: boolean;
}

interface UiResearchComputeTask extends UiTask {
  active?: boolean;
  progress?: number;
}

interface UiResearch {
  id: string;
  name: string;
  description?: string;
  costs?: DisplayCost[];
  cost?: DisplayCost[];
  canAfford?: boolean;
  canBuy?: boolean;
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

type UiQueueEntry =
  | string
  | {
      id?: string;
      taskId?: string;
      name?: string;
      socketId?: number;
      coreId?: number;
      state?: string;
      status?: string;
    };

interface UiSystemStatus {
  cacheBits?: number;
  cacheUsedBytes?: number;
  cacheUsedBits?: number;
  cacheBytes?: number;
  ramBits?: number;
  memoryBits?: number;
  ramLoad?: number;
  ramPressure?: number;
  memoryPressure?: number;
  memoryPressureRatio?: number;
  ramUsedBytes?: number;
  ramUsedBits?: number;
  memoryUsedBits?: number;
  ramBytes?: number;
  psuStress?: number;
  powerStress?: number;
  coolingStress?: number;
  thermalStress?: number;
  coolingStatus?: string;
  thermalStatus?: string;
  memory?: {
    pressure?: number;
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
  psu?: {
    stress?: number;
  };
  cooling?: {
    status?: string;
    stress?: number;
  };
}

type UiCore = VisibleCore & {
  activeTask?: UiActiveTask | null;
};

type UiVisibleState = VisibleState & {
  tasks?: UiTask[];
  research?: UiResearch[];
  activeTasks?: UiActiveTask[];
  queue: UiQueueEntry[];
  systemStatus?: UiSystemStatus;
  metrics: VisibleState["metrics"] & {
    ramLoad?: number;
    memoryPressure?: number;
    psuStress?: number;
    powerStress?: number;
    coolingStress?: number;
    coolingStatus?: string;
  };
};

interface HardwareBoardProps {
  visible: VisibleState;
  dispatch: Dispatch;
  selectedComponent: SelectedComponent;
  onSelectComponent: (component: SelectedComponent) => void;
}

function getSelectedCoreId(selection: SelectedComponent) {
  if (!selection?.startsWith("core:")) return null;

  const coreId = Number(selection.slice("core:".length));
  return Number.isFinite(coreId) ? coreId : null;
}

function getSelectedSchedulerId(selection: SelectedComponent) {
  if (!selection?.startsWith("scheduler:")) return null;

  const socketId = Number(selection.slice("scheduler:".length));
  return Number.isFinite(socketId) ? socketId : null;
}

const asUiVisible = (visible: VisibleState) =>
  visible as unknown as UiVisibleState;

const clampMeter = (value: number | null) =>
  Math.min(1, Math.max(0, value ?? 0));

const normalizeRatio = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value > 5) return value / 100;
  return value;
};

const formatPercent = (ratio: number | null) =>
  ratio === null ? "N/A" : `${formatNumber(Math.max(0, ratio) * 100)}%`;

const firstNumber = (...values: Array<number | null | undefined>) =>
  values.find((value): value is number => typeof value === "number");

const bytesToBits = (bytes: number | null | undefined) =>
  typeof bytes === "number" ? bytes * 8 : undefined;

const firstBits = (
  bitValues: Array<number | null | undefined>,
  byteValues: Array<number | null | undefined>,
) => firstNumber(...bitValues) ?? bytesToBits(firstNumber(...byteValues)) ?? 0;

const getHardware = (visible: VisibleState) =>
  visible.hardware as VisibleState["hardware"] & {
    cacheBits?: number;
    ramBits?: number;
    memoryBits?: number;
  };

const getTasks = (visible: VisibleState): UiTask[] => {
  const ui = asUiVisible(visible);
  return ((ui.tasks ?? []) as unknown) as UiTask[];
};

const getResearch = (visible: VisibleState): UiResearch[] =>
  ((asUiVisible(visible).research ?? []) as unknown) as UiResearch[];

const getActiveTasks = (visible: VisibleState): UiActiveTask[] => {
  const ui = asUiVisible(visible);
  return ((ui.activeTasks ?? []) as unknown) as UiActiveTask[];
};

const getQueueEntries = (visible: VisibleState): UiQueueEntry[] =>
  ((asUiVisible(visible).queue ?? []) as unknown) as UiQueueEntry[];

const getActiveTaskId = (task: UiActiveTask) => task.taskId ?? "";

const getQueueTaskId = (entry: UiQueueEntry) => {
  if (typeof entry === "string") return entry;
  return entry.taskId ?? entry.id ?? "";
};

const getCoreActiveTask = (core: VisibleCore) => {
  const uiCore = core as UiCore;
  return uiCore.activeTask ?? null;
};

const getAllCores = (visible: VisibleState) =>
  visible.metrics.cpuSockets.flatMap((socket) => socket.cores);

const getCacheSpeedHz = (visible: VisibleState) => {
  const cacheSpeedLevel = getHardware(visible).cacheSpeedLevel ?? 1;

  return Math.round(1 * 1.45 ** (cacheSpeedLevel - 1) * 10) / 10;
};

const getCacheSegmentKind = (
  action: string | null | undefined,
): CacheSegmentKind =>
  action === "overwrite"
    ? "overwrite"
    : action === "write"
      ? "write"
      : action === "read"
        ? "read"
        : "compute";

const getCacheReservation = (visible: VisibleState) => {
  const metricSegments = visible.metrics.cacheResidency ?? [];
  if (metricSegments.length > 0) {
    const segments = metricSegments.map(
      (segment): CacheSegment => ({
        kind: getCacheSegmentKind(segment.memoryAction),
        state: segment.state ?? "loaded",
        coreId: segment.coreId,
        bits: segment.bits,
        progress: clampMeter(segment.progress ?? 1),
        bufferProgress: clampMeter(segment.bufferProgress ?? 1),
      }),
    );

    return {
      segments,
      reservedBits: segments.reduce((total, segment) => total + segment.bits, 0),
      loadingBits: segments
        .filter((segment) => segment.state === "buffering" || segment.state === "loading")
        .reduce((total, segment) => total + segment.bits, 0),
    };
  }

  const tasksById = new Map(getTasks(visible).map((task) => [task.id, task]));
  const segments: CacheSegment[] = [];
  let reservedBits = 0;
  let loadingBits = 0;

  for (const activeTask of getActiveTasks(visible)) {
    const task = tasksById.get(activeTask.taskId ?? "");
    if (!task) continue;

    const taskCacheBits = getTaskCacheBits(task);
    const activeOperations =
      activeTask.coreProgress?.filter(
        (operation) =>
          operation.status !== "complete" &&
          (operation.cacheBits ?? taskCacheBits) > 0,
      ) ?? [];
    const operationCacheBits = new Map<string, number>(
      Array.isArray(task.operations)
        ? task.operations.map(
            (operation): [string, number] => [
              operation.id,
              getNodeCacheBits(operation),
            ],
          )
        : [],
    );
    const operationMemoryActions = new Map<string, string | null>(
      Array.isArray(task.operations)
        ? task.operations.map(
            (operation): [string, string | null] => [
              operation.id,
              operation.memoryAction ?? null,
            ],
          )
        : [],
    );

    for (const operation of activeOperations) {
      const mappedBits = operation.operationId
        ? operationCacheBits.get(operation.operationId)
        : undefined;
      const operationBits = operation.cacheBits ?? mappedBits ?? taskCacheBits;
      if (operationBits <= 0) continue;

      const mappedAction = operation.operationId
        ? operationMemoryActions.get(operation.operationId)
        : null;
      const action = operation.memoryAction ?? mappedAction ?? "compute";
      const kind = getCacheSegmentKind(action);
      const loadProgress =
        (operation.totalLoadCycles ?? 0) > 0
          ? 1 -
            (operation.remainingLoadCycles ?? 0) /
              Math.max(operation.totalLoadCycles ?? 1, 1)
          : 1;
      const cpuProgress =
        (operation.totalCycles ?? 0) > 0
          ? 1 -
            (operation.remainingCycles ?? 0) / Math.max(operation.totalCycles ?? 1, 1)
          : 1;
      const state: CacheSegmentState =
        operation.status === "loadingCache" && action !== "compute" && cpuProgress < 1
          ? "buffering"
          : operation.status === "loadingCache"
            ? "loading"
            : "loaded";
      segments.push({
        kind,
        state,
        coreId: operation.coreId,
        bits: operationBits,
        progress: clampMeter(loadProgress),
        bufferProgress: clampMeter(cpuProgress),
      });
      reservedBits += operationBits;
      if (
        operation.status === "loadingCache" ||
        operation.memoryState === "cacheLoad"
      ) {
        loadingBits += operationBits;
      }
    }
  }

  return {
    segments,
    reservedBits,
    loadingBits,
  };
};

const emptyCacheStateBits = (): Record<CacheSegmentState, number> => ({
  buffering: 0,
  loading: 0,
  loaded: 0,
});

const getCacheStateBits = (segments: CacheSegment[]) =>
  segments.reduce((totals, segment) => {
    totals[segment.state] += getCacheSegmentFilledBits(segment);
    return totals;
  }, emptyCacheStateBits());

const getCachePrimaryState = (segments: CacheSegment[]) => {
  if (segments.some((segment) => segment.state === "buffering")) return "Buffer";
  if (segments.some((segment) => segment.state === "loading")) return "Loading";
  if (segments.some((segment) => segment.state === "loaded")) return "Ready";
  return "Idle";
};

const getCacheSegmentWriteProgress = (segment: CacheSegment) => {
  if (segment.state === "loaded") return 1;

  return clampMeter(segment.progress);
};

const getCacheSegmentFilledBits = (segment: CacheSegment) => {
  if (segment.state === "loaded") return segment.bits;
  if (segment.state === "buffering") {
    return segment.bits * clampMeter(segment.bufferProgress);
  }

  return segment.bits * clampMeter(segment.progress);
};

const getOperationCountFromOperations = (operations: UiTaskOperation[]) =>
  operations.reduce((total, operation) => total + (operation.count ?? 1), 0);

const getTaskOperationCount = (task: UiTask) =>
  firstNumber(
    task.operationCount,
    typeof task.operations === "number" ? task.operations : undefined,
    task.opCount,
    task.requiredOps,
    task.requiredOperations,
    task.requiredCycles,
    Array.isArray(task.operations)
      ? getOperationCountFromOperations(task.operations)
      : undefined,
  );

const getNodeCacheBits = (node: UiTaskGraphNode) =>
  firstBits(
    [node.cacheNeedBits, node.cacheBits],
    [node.cacheNeedBytes, node.cacheBytes],
  );

const getNodeRamBits = (node: UiTaskGraphNode) =>
  firstBits(
    [node.ramNeedBits, node.memoryNeedBits, node.ramBits, node.memoryBits],
    [node.ramNeedBytes, node.memoryNeedBytes, node.ramBytes],
  );

const getTaskCacheBits = (task: UiTask) => getNodeCacheBits(task);

const getTaskRamBits = (task: UiTask) => getNodeRamBits(task);

const getVisibleCacheBits = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  const hardware = getHardware(visible);
  return firstBits(
    [
      ui.systemStatus?.cacheBits,
      ui.systemStatus?.cache?.capacityBits,
      hardware.cacheBits,
    ],
    [
      ui.systemStatus?.cacheBytes,
      ui.systemStatus?.cache?.capacityBytes,
      visible.hardware.cacheBytes,
    ],
  );
};

const getVisibleCacheUsedBits = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  return firstBits(
    [ui.systemStatus?.cacheUsedBits, ui.systemStatus?.cache?.usedBits],
    [
      ui.systemStatus?.cacheUsedBytes,
      ui.systemStatus?.cache?.usedBytes,
      visible.metrics.cacheUsedBytes,
    ],
  );
};

const getVisibleRamBits = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  const hardware = getHardware(visible);
  return firstBits(
    [
      ui.systemStatus?.ramBits,
      ui.systemStatus?.memoryBits,
      ui.systemStatus?.memory?.capacityBits,
      hardware.ramBits,
      hardware.memoryBits,
    ],
    [
      ui.systemStatus?.ramBytes,
      ui.systemStatus?.memory?.capacityBytes,
      visible.hardware.ramBytes,
    ],
  );
};

const getVisibleRamUsedBits = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  return firstBits(
    [
      ui.systemStatus?.ramUsedBits,
      ui.systemStatus?.memoryUsedBits,
      ui.systemStatus?.memory?.usedBits,
    ],
    [
      ui.systemStatus?.ramUsedBytes,
      ui.systemStatus?.memory?.usedBytes,
      visible.metrics.ramUsedBytes,
    ],
  );
};

const hasSystemMemory = (visible: VisibleState) =>
  visible.flags.systemStats || visible.hardware.secondCpu || getVisibleRamBits(visible) > 0;

const getTaskCompletedCount = (task: UiTask) =>
  firstNumber(task.completedCount, task.completionCount) ?? (task.completed ? 1 : 0);

const getTaskLockedReason = (task: UiTask) =>
  task.lockedReason ??
  task.lockReason ??
  task.blockedReason ??
  task.unlockReason ??
  null;

const getTaskCanStart = (task: UiTask) => {
  if (getTaskLockedReason(task)) return false;
  if (typeof task.canStart === "boolean") return task.canStart;
  if (typeof task.canRun === "boolean") return task.canRun;
  if (typeof task.canQueue === "boolean") return task.canQueue;
  return true;
};

const taskStateFromText = (value: string | undefined): TaskState | null => {
  const normalized = value?.toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("rerun")) return "rerun";
  if (normalized.includes("restart")) return "restart";
  if (
    normalized.includes("active") ||
    normalized.includes("running") ||
    normalized.includes("load")
  ) {
    return "active";
  }
  if (normalized.includes("waiting") || normalized.includes("queued")) return "waiting";
  if (normalized.includes("locked")) return "locked";
  if (normalized.includes("ready")) return "ready";
  return null;
};

const getTaskState = (
  task: UiTask,
  activeTasks: UiActiveTask[],
  queue: UiQueueEntry[],
): TaskState => {
  const explicit = taskStateFromText(task.status ?? task.state);
  if (explicit) return explicit;

  const active = activeTasks.find((candidate) => getActiveTaskId(candidate) === task.id);
  if (active) {
    return taskStateFromText(active.status ?? active.state ?? active.memoryState) ?? "active";
  }

  if (queue.some((entry) => getQueueTaskId(entry) === task.id)) {
    return "waiting";
  }

  if (!getTaskCanStart(task)) return "locked";

  if (getTaskCompletedCount(task) > 0) {
    return task.repeatable === false || task.kind === "benchmark" ? "restart" : "rerun";
  }

  return "ready";
};

const getMemoryActionVerb = (action: string | null | undefined) => {
  if (action === "read") return "Read";
  if (action === "write") return "Write";
  if (action === "overwrite") return "Overwrite";
  return "Processing";
};

const getActiveCoreRuntime = (active: UiActiveTask) =>
  active.coreProgress?.find((operation) => operation.status !== "complete") ??
  active.coreProgress?.[0] ??
  null;

const getActiveRuntimeLabel = (active: UiActiveTask) => {
  const raw = (active.memoryState ?? active.status ?? active.state ?? "").toLowerCase();
  const operation = getActiveCoreRuntime(active);
  const actionVerb = getMemoryActionVerb(operation?.memoryAction);
  const totalCycles = operation?.totalCycles ?? 0;
  const remainingCycles = operation?.remainingCycles ?? totalCycles;
  const completedCycles =
    totalCycles > 0 ? Math.max(0, totalCycles - remainingCycles) : 0;
  const cacheBits = operation?.cacheBits ?? 0;
  const cacheLabel = cacheBits > 0 ? ` ${formatBits(cacheBits)}` : "";

  if (raw.includes("cache")) {
    if (operation && totalCycles > 0 && completedCycles >= totalCycles) {
      return `Cache wait${cacheLabel}`;
    }

    return operation?.memoryAction
      ? `${actionVerb}${cacheLabel}`
      : `Cache load${cacheLabel}`;
  }
  if (raw.includes("ram")) return "RAM load";
  if (raw.includes("wait")) return "Waiting";
  if (raw.includes("rerun")) return "Rerun";
  if (raw.includes("restart")) return "Restart";
  if (raw.includes("complete")) return "Complete";
  if (operation?.memoryAction) return `${actionVerb}${cacheLabel}`;
  if (operation?.operationName && totalCycles > 0) {
    return operation.operationName === active.name ? "Processing" : operation.operationName;
  }

  return active.activeOperationName ?? "Active";
};

const getActiveTaskFor = (task: UiTask, activeTasks: UiActiveTask[]) =>
  activeTasks.find((candidate) => getActiveTaskId(candidate) === task.id) ?? null;

const getTaskProgress = (
  task: UiTask,
  activeTasks: UiActiveTask[],
  queue: UiQueueEntry[],
) => {
  const active = activeTasks.find((candidate) => getActiveTaskId(candidate) === task.id);
  if (active) return clampMeter(active.progress);
  if (typeof task.progress === "number") return clampMeter(task.progress);
  if (queue.some((entry) => getQueueTaskId(entry) === task.id)) return 0;
  return getTaskCompletedCount(task) > 0 ? 1 : 0;
};

const getTaskRewardCosts = (task: UiTask): DisplayCost[] => {
  const credits = firstNumber(task.rewardCredits, task.rewards?.credits);
  const data = firstNumber(task.rewardData, task.rewards?.data);
  const costs: DisplayCost[] = [];

  if (credits && credits > 0) costs.push({ resource: "credits", amount: credits });
  if (data && data > 0) costs.push({ resource: "data", amount: data });

  return costs;
};

const getQueueLabels = (visible: VisibleState, socketId?: number) => {
  const tasksById = new Map(getTasks(visible).map((task) => [task.id, task.name]));

  return getQueueEntries(visible)
    .filter((entry) => {
      if (typeof entry === "string" || socketId === undefined) return true;
      return entry.socketId === undefined || entry.socketId === socketId;
    })
    .map((entry) => {
      if (typeof entry !== "string" && entry.name) return entry.name;
      const taskId = getQueueTaskId(entry);
      return tasksById.get(taskId) ?? taskId;
    });
};

const getSystemLoad = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  const system = ui.systemStatus;
  const ramCapacity = Math.max(getVisibleRamBits(visible), 1);
  const psuCapacity = Math.max(visible.hardware.psuWatts, 1);
  const ramUsed = getVisibleRamUsedBits(visible);
  const fallbackRamLoad = ramUsed / ramCapacity;
  const fallbackPsuStress = visible.metrics.powerUsedWatts / psuCapacity;
  const ramLoad = normalizeRatio(
    firstNumber(system?.ramLoad, system?.ramPressure, ui.metrics.ramLoad),
  );
  const memoryPressure = normalizeRatio(
    firstNumber(
      system?.memoryPressure,
      system?.memoryPressureRatio,
      system?.memory?.pressure,
      ui.metrics.memoryPressure,
    ),
  );
  const psuStress = normalizeRatio(
    firstNumber(system?.psuStress, system?.powerStress, system?.psu?.stress, ui.metrics.psuStress, ui.metrics.powerStress),
  );
  const coolingStress = normalizeRatio(
    firstNumber(system?.coolingStress, system?.thermalStress, system?.cooling?.stress, ui.metrics.coolingStress),
  );
  const coolingStatus =
    system?.coolingStatus ??
    system?.thermalStatus ??
    system?.cooling?.status ??
    ui.metrics.coolingStatus ??
    (coolingStress !== null && coolingStress > 0.9 ? "Hot" : "Nominal");

  return {
    memoryPressure: memoryPressure ?? ramLoad ?? fallbackRamLoad,
    psuStress: psuStress ?? fallbackPsuStress,
    coolingStress,
    coolingStatus,
  };
};

const getStressTone = (ratio: number | null) => {
  if (ratio === null) return "neutral";
  if (ratio >= 1) return "critical";
  if (ratio >= 0.78) return "warn";
  return "good";
};

const RESOURCE_GAIN_ANIMATION_MS = 1080;
const MAX_RESOURCE_GAIN_BURSTS = 10;
const RESOURCE_GAIN_EPSILON = 0.0001;

const createResourceGainBurst = (
  id: number,
  kind: ResourceGainKind,
  amount: number,
  targetElement: HTMLElement | null,
): ResourceGainBurst => {
  const targetRect = targetElement?.getBoundingClientRect();
  const fallbackX = window.innerWidth - (kind === "credits" ? 104 : 190);
  const target = {
    x: targetRect ? targetRect.left + targetRect.width * 0.5 : fallbackX,
    y: targetRect ? targetRect.bottom + 14 : 42,
  };
  const startY = target.y + 36;

  return {
    id,
    kind,
    amount,
    startX: target.x,
    startY: startY,
    endX: target.x,
    endY: target.y,
  };
};

export function ResourceHud({
  visible,
  onReset,
  animateResourceGains,
}: {
  visible: VisibleState;
  onReset: () => void;
  animateResourceGains: boolean;
}) {
  const activeCount = getActiveTasks(visible).length;
  const queueCount = getQueueEntries(visible).length;
  const dataReadoutRef = useRef<HTMLDivElement>(null);
  const creditsReadoutRef = useRef<HTMLDivElement>(null);
  const previousResourcesRef = useRef(visible.resources);
  const resourceEffectsArmedRef = useRef(false);
  const nextBurstIdRef = useRef(0);
  const gainTimeoutsRef = useRef<number[]>([]);
  const [gainBursts, setGainBursts] = useState<ResourceGainBurst[]>([]);

  useEffect(
    () => () => {
      gainTimeoutsRef.current.forEach((timeoutId) =>
        window.clearTimeout(timeoutId),
      );
      gainTimeoutsRef.current = [];
    },
    [],
  );

  useEffect(() => {
    const previousResources = previousResourcesRef.current;
    const currentResources = visible.resources;
    previousResourcesRef.current = currentResources;

    if (!animateResourceGains) {
      resourceEffectsArmedRef.current = false;
      return;
    }

    if (!resourceEffectsArmedRef.current) {
      resourceEffectsArmedRef.current = true;
      return;
    }

    const resourceGains = [
      {
        kind: "data" as const,
        amount: currentResources.data - previousResources.data,
        target: dataReadoutRef.current,
      },
      {
        kind: "credits" as const,
        amount: currentResources.credits - previousResources.credits,
        target: creditsReadoutRef.current,
      },
    ].filter((gain) => gain.amount > RESOURCE_GAIN_EPSILON);

    if (resourceGains.length === 0) return;

    const newBursts = resourceGains.map((gain) =>
      createResourceGainBurst(
        nextBurstIdRef.current++,
        gain.kind,
        gain.amount,
        gain.target,
      ),
    );

    setGainBursts((current) =>
      [...current, ...newBursts].slice(-MAX_RESOURCE_GAIN_BURSTS),
    );

    newBursts.forEach((burst) => {
      const timeoutId = window.setTimeout(() => {
        setGainBursts((current) =>
          current.filter((candidate) => candidate.id !== burst.id),
        );
        gainTimeoutsRef.current = gainTimeoutsRef.current.filter(
          (candidate) => candidate !== timeoutId,
        );
      }, RESOURCE_GAIN_ANIMATION_MS);

      gainTimeoutsRef.current.push(timeoutId);
    });
  }, [
    animateResourceGains,
    visible.resources.credits,
    visible.resources.data,
  ]);

  return (
    <div className="resource-hud" aria-label="Resources">
      {gainBursts.length > 0 && (
        <div className="resource-gain-layer" aria-hidden="true">
          {gainBursts.map((burst) => (
            <span
              className={`resource-gain-flyout ${burst.kind}`}
              key={burst.id}
              style={
                {
                  "--start-x": `${burst.startX}px`,
                  "--start-y": `${burst.startY}px`,
                  "--end-x": `${burst.endX}px`,
                  "--end-y": `${burst.endY}px`,
                } as CSSProperties
              }
            >
              <ResourceAmount
                resource={burst.kind}
                amount={burst.amount}
                plus
                showLabel={false}
              />
            </span>
          ))}
        </div>
      )}
      <div className="resource-readout data" ref={dataReadoutRef}>
        <ResourceAmount
          resource="data"
          amount={Math.floor(visible.resources.data)}
        />
      </div>
      <div className="resource-readout credits" ref={creditsReadoutRef}>
        <ResourceAmount
          resource="credits"
          amount={Math.floor(visible.resources.credits)}
        />
      </div>
      <div className="resource-readout operations">
        <Activity size={17} />
        <strong>{formatNumber(activeCount)}</strong>
        <span>active</span>
      </div>
      <div className="resource-readout waiting">
        <ListTodo size={17} />
        <strong>{formatNumber(queueCount)}</strong>
        <span>waiting</span>
      </div>
      <button
        type="button"
        className="dev-reset-button"
        onClick={onReset}
        title="Reset dev save"
        aria-label="Reset dev save"
      >
        <RefreshCw size={15} />
      </button>
    </div>
  );
}

export function HardwareBoard({
  visible,
  dispatch,
  selectedComponent,
  onSelectComponent,
}: HardwareBoardProps) {
  const multiCpuKnown = visible.flags.secondCpu || visible.hardware.secondCpu;
  const selectedCoreId = getSelectedCoreId(selectedComponent);
  const selectedSchedulerId = getSelectedSchedulerId(selectedComponent);
  const schedulerVisible =
    visible.flags.basicQueue || visible.flags.scheduler || getQueueEntries(visible).length > 0;
  const [openInfo, setOpenInfo] = useState<HardwareComponentId | null>(null);
  const selectComponent = (component: SelectedComponent) => {
    setOpenInfo(null);
    onSelectComponent(component);
  };
  const toggleInfo = (component: HardwareComponentId) => {
    setOpenInfo((current) => (current === component ? null : component));
    onSelectComponent(component);
  };
  const upgradesFor = (component: HardwareComponentId) =>
    visible.upgrades.filter((upgrade) => upgrade.component === component);

  return (
    <div className="motherboard">
      <div className="trace-field" aria-hidden="true" />
      <div className="hardware-area">
        <div className="socket-bank">
          {visible.metrics.cpuSockets.map((socket) => (
            <CpuSocket
              key={socket.id}
              socket={socket}
              visible={visible}
              selected={selectedComponent === "cpu"}
              onSelect={() => selectComponent("cpu")}
              cacheSelected={selectedComponent === "cache"}
              onSelectCache={() => selectComponent("cache")}
              cacheInfoOpen={openInfo === "cache"}
              onCacheInfo={() => toggleInfo("cache")}
              selectedCoreId={selectedCoreId}
              onSelectCore={(coreId) => selectComponent(`core:${coreId}`)}
              schedulerVisible={schedulerVisible}
              schedulerSelected={selectedSchedulerId === socket.id}
              onSelectScheduler={() => selectComponent(`scheduler:${socket.id}`)}
              schedulerInfoOpen={openInfo === "scheduler"}
              onSchedulerInfo={() => toggleInfo("scheduler")}
              multiCpuKnown={multiCpuKnown}
              cpuUpgrades={upgradesFor("cpu")}
              cacheUpgrades={upgradesFor("cache")}
              schedulerUpgrades={upgradesFor("scheduler")}
              dispatch={dispatch}
            />
          ))}
          {!visible.hardware.secondCpu && visible.flags.secondCpu && (
            <EmptySocket
              selected={selectedComponent === "socket"}
              onSelect={() => selectComponent("socket")}
              upgrades={upgradesFor("socket")}
              dispatch={dispatch}
            />
          )}
        </div>

        <div className="module-bank">
          {hasSystemMemory(visible) && (
            <>
              <RamModule
                visible={visible}
                selected={selectedComponent === "ram"}
                onSelect={() => selectComponent("ram")}
                infoOpen={openInfo === "ram"}
                onInfo={() => toggleInfo("ram")}
                upgrades={upgradesFor("ram")}
                dispatch={dispatch}
              />
              <PsuModule
                visible={visible}
                selected={selectedComponent === "psu"}
                onSelect={() => selectComponent("psu")}
                infoOpen={openInfo === "psu"}
                onInfo={() => toggleInfo("psu")}
                upgrades={upgradesFor("psu")}
                dispatch={dispatch}
              />
            </>
          )}
        </div>
        <SystemStatusRail visible={visible} />
      </div>
    </div>
  );
}

function CpuSocket({
  socket,
  visible,
  selected,
  onSelect,
  cacheSelected,
  onSelectCache,
  cacheInfoOpen,
  onCacheInfo,
  selectedCoreId,
  onSelectCore,
  schedulerVisible,
  schedulerSelected,
  onSelectScheduler,
  schedulerInfoOpen,
  onSchedulerInfo,
  multiCpuKnown,
  cpuUpgrades,
  cacheUpgrades,
  schedulerUpgrades,
  dispatch,
}: {
  socket: VisibleCpuSocket;
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  cacheSelected: boolean;
  onSelectCache: () => void;
  cacheInfoOpen: boolean;
  onCacheInfo: () => void;
  selectedCoreId: number | null;
  onSelectCore: (coreId: number) => void;
  schedulerVisible: boolean;
  schedulerSelected: boolean;
  onSelectScheduler: () => void;
  schedulerInfoOpen: boolean;
  onSchedulerInfo: () => void;
  multiCpuKnown: boolean;
  cpuUpgrades: VisibleUpgrade[];
  cacheUpgrades: VisibleUpgrade[];
  schedulerUpgrades: VisibleUpgrade[];
  dispatch: Dispatch;
}) {
  const socketLabel = multiCpuKnown ? socket.label : "CPU";
  const coreUpgrade = cpuUpgrades.find((upgrade) => upgrade.id === "core");
  const otherCpuUpgrades = cpuUpgrades.filter(
    (upgrade) => upgrade.id !== "clock" && upgrade.id !== "core",
  );

  return (
    <section
      className={`cpu-socket ${selected ? "selected" : ""} ${
        multiCpuKnown ? "" : "single-cpu"
      }`}
    >
      <button type="button" className="socket-header" onClick={onSelect}>
        <Cpu size={18} />
        <span>{socketLabel}</span>
      </button>
      <div className="core-array">
        {socket.cores.map((core) => (
          <CoreDie
            key={core.id}
            core={core}
            selected={selectedCoreId === core.id}
            onSelect={() => onSelectCore(core.id)}
            dispatch={dispatch}
          />
        ))}
        {selected && coreUpgrade && (
          <AddCoreDie upgrade={coreUpgrade} dispatch={dispatch} />
        )}
      </div>
      {selected && (
        <InlineUpgradeRow upgrades={otherCpuUpgrades} dispatch={dispatch} />
      )}
      {schedulerVisible && (
        <SchedulerModule
          socket={socket}
          visible={visible}
          selected={schedulerSelected}
          onSelect={onSelectScheduler}
          infoOpen={schedulerInfoOpen}
          onInfo={onSchedulerInfo}
          upgrades={schedulerUpgrades}
          dispatch={dispatch}
        />
      )}
      <CpuCacheLane
        visible={visible}
        selected={cacheSelected}
        onSelect={onSelectCache}
        infoOpen={cacheInfoOpen}
        onInfo={onCacheInfo}
        upgrades={cacheUpgrades}
        dispatch={dispatch}
      />
    </section>
  );
}

function CoreDie({
  core,
  selected,
  onSelect,
  dispatch,
}: {
  core: VisibleCore;
  selected: boolean;
  onSelect: () => void;
  dispatch: Dispatch;
}) {
  const active = getCoreActiveTask(core);
  const activeCoreProgress =
    active?.coreProgress?.find((operation) => operation.coreId === core.id)?.progress ??
    0;
  const clockUpgrade = core.clockUpgrade;
  const coreStatus = active ? getActiveRuntimeLabel(active) : "Idle";
  const coreWork = active?.name ?? "Waiting";

  return (
    <div
      className={`core-die ${active ? "running" : ""} ${
        selected ? "selected" : ""
      }`}
    >
      <button
        type="button"
        className="core-select-surface"
        onClick={onSelect}
        aria-expanded={selected}
      >
        <span className="core-module-header">
          <span className="core-module-title">
            <Cpu size={17} />
            <span>Core {core.id}</span>
          </span>
          <span className={`core-state-chip ${active ? "running" : ""}`}>
            {active ? "Running" : "Ready"}
          </span>
        </span>
        <span className="core-stat-grid">
          <span className="core-stat-row">
            <span>
              <small>Clock</small>
              <strong>{formatClock(core.clockHz)}</strong>
            </span>
          </span>
          <span className="core-stat-row core-work-row">
            <span>
              <small>{coreWork}</small>
              <strong>{coreStatus}</strong>
            </span>
          </span>
        </span>
        <span className="core-meter-block">
          <span className="die-progress" aria-hidden="true">
            <span style={{ width: `${clampMeter(activeCoreProgress) * 100}%` }} />
          </span>
        </span>
      </button>
      {clockUpgrade && (
        <button
          type="button"
          className="core-clock-upgrade core-stat-upgrade"
          disabled={!clockUpgrade.canAfford}
          title={`${clockUpgrade.name}: ${formatCost(clockUpgrade.costs)}`}
          aria-label={`Upgrade Core ${core.id} clock for ${formatCost(clockUpgrade.costs)}`}
          onClick={() =>
            dispatch({
              type: "buyUpgrade",
              upgradeId: clockUpgrade.id as UpgradeId,
              coreId: core.id,
            })
          }
        >
          <Plus size={13} />
          <ResourceCost costs={clockUpgrade.costs} compact />
        </button>
      )}
    </div>
  );
}

function AddCoreDie({
  upgrade,
  dispatch,
}: {
  upgrade: VisibleUpgrade;
  dispatch: Dispatch;
}) {
  return (
    <button
      type="button"
      className="add-core-die"
      disabled={!upgrade.canAfford}
      onClick={() =>
        dispatch({ type: "buyUpgrade", upgradeId: upgrade.id as UpgradeId })
      }
    >
      <Plus size={18} />
      <span>{upgrade.name}</span>
      <ResourceCost costs={upgrade.costs} compact />
    </button>
  );
}

function EmptySocket({
  selected,
  onSelect,
  upgrades,
  dispatch,
}: {
  selected: boolean;
  onSelect: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
}) {
  return (
    <div className={`empty-socket ${selected ? "selected" : ""}`}>
      <button type="button" className="module-select-surface" onClick={onSelect}>
        <Server size={20} />
        <span>CPU socket B</span>
        <strong>Ready</strong>
        <small>Install to reveal RAM and PSU</small>
      </button>
      {selected && <InlineUpgradeRow upgrades={upgrades} dispatch={dispatch} />}
    </div>
  );
}

function CpuCacheLane({
  visible,
  selected,
  onSelect,
  infoOpen,
  onInfo,
  upgrades,
  dispatch,
}: {
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  infoOpen: boolean;
  onInfo: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
}) {
  const capacity = Math.max(getVisibleCacheBits(visible), 1);
  const cacheReservation = getCacheReservation(visible);
  const cacheUpgrade = upgrades.find((upgrade) => upgrade.id === "cache");
  const cacheSpeedUpgrade = upgrades.find((upgrade) => upgrade.id === "cacheSpeed");
  const otherCacheUpgrades = upgrades.filter(
    (upgrade) => upgrade.id !== "cache" && upgrade.id !== "cacheSpeed",
  );
  const stateBits = getCacheStateBits(cacheReservation.segments);
  const loading = cacheReservation.segments.some(
    (segment) => segment.state === "buffering" || segment.state === "loading",
  );
  const cacheState = getCachePrimaryState(cacheReservation.segments);

  return (
    <div className={`cpu-cache-lane ${selected ? "selected" : ""}`}>
      <button
        type="button"
        className="module-select-surface cache-select-surface"
        onClick={onSelect}
      >
        <span className="cache-module-header">
          <span className="cache-module-title">
            <HardDrive size={17} />
            <span>Cache</span>
          </span>
          <span className={`cache-state-chip ${loading ? "loading" : ""}`}>
            {cacheState}
          </span>
        </span>
        <span className="cache-stat-grid">
          <span className="cache-stat-row">
            <span>
              <small>Capacity</small>
              <strong>{formatBits(capacity)}</strong>
            </span>
          </span>
          <span className="cache-stat-row">
            <span>
              <small>Load rate</small>
              <strong>{formatClock(getCacheSpeedHz(visible))}</strong>
            </span>
          </span>
        </span>
        <span className="cache-meter-block">
          <CachePressureMeter
            segments={cacheReservation.segments}
            capacityBits={capacity}
          />
          <CacheStateSummary stateBits={stateBits} />
        </span>
      </button>
      {cacheUpgrade && (
        <button
          type="button"
          className="cache-inline-upgrade cache-stat-upgrade"
          disabled={!cacheUpgrade.canAfford}
          title={`${cacheUpgrade.name}: ${formatCost(cacheUpgrade.costs)}`}
          aria-label={`Upgrade cache for ${formatCost(cacheUpgrade.costs)}`}
          onClick={() =>
            dispatch({ type: "buyUpgrade", upgradeId: cacheUpgrade.id as UpgradeId })
          }
        >
          <Plus size={13} />
          <ResourceCost costs={cacheUpgrade.costs} compact />
        </button>
      )}
      {cacheSpeedUpgrade && (
        <button
          type="button"
          className="cache-speed-upgrade cache-stat-upgrade"
          disabled={!cacheSpeedUpgrade.canAfford}
          title={`${cacheSpeedUpgrade.name}: ${formatCost(cacheSpeedUpgrade.costs)}`}
          aria-label={`Upgrade cache speed for ${formatCost(cacheSpeedUpgrade.costs)}`}
          onClick={() =>
            dispatch({
              type: "buyUpgrade",
              upgradeId: cacheSpeedUpgrade.id as UpgradeId,
            })
          }
        >
          <Plus size={13} />
          <ResourceCost costs={cacheSpeedUpgrade.costs} compact />
        </button>
      )}
      <HardwareInfoButton component="cache" open={infoOpen} onClick={onInfo} />
      {selected && otherCacheUpgrades.length > 0 && (
        <InlineUpgradeRow upgrades={otherCacheUpgrades} dispatch={dispatch} />
      )}
    </div>
  );
}

function SchedulerModule({
  socket,
  visible,
  selected,
  onSelect,
  infoOpen,
  onInfo,
  upgrades,
  dispatch,
}: {
  socket: VisibleCpuSocket;
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  infoOpen: boolean;
  onInfo: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
}) {
  const activeInSocket = socket.cores.filter((core) => getCoreActiveTask(core)).length;
  const queueLabels = getQueueLabels(visible, socket.id);
  const waitingCount = queueLabels.length;

  return (
    <div className={`hardware-module scheduler-module ${selected ? "selected" : ""}`}>
      <button type="button" className="module-select-surface" onClick={onSelect}>
        <ListTodo size={19} />
        <span>CPU Op Scheduler</span>
        <strong>
          {activeInSocket} active / {waitingCount} waiting
        </strong>
        <div className="queue-preview" aria-label="Waiting tasks">
          {queueLabels.length === 0 ? (
            <small>Waiting queue empty</small>
          ) : (
            queueLabels.slice(0, 5).map((label, index) => (
              <small key={`${label}-${index}`}>{label}</small>
            ))
          )}
        </div>
      </button>
      <HardwareInfoButton
        component="scheduler"
        open={infoOpen}
        onClick={onInfo}
      />
      {selected && <InlineUpgradeRow upgrades={upgrades} dispatch={dispatch} />}
    </div>
  );
}

function RamModule({
  visible,
  selected,
  onSelect,
  infoOpen,
  onInfo,
  upgrades,
  dispatch,
}: {
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  infoOpen: boolean;
  onInfo: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
}) {
  const status = getSystemLoad(visible);
  const capacity = Math.max(getVisibleRamBits(visible), 1);
  const used = Math.min(getVisibleRamUsedBits(visible), capacity);

  return (
    <div className={`hardware-module ram-module ${selected ? "selected" : ""}`}>
      <button type="button" className="module-select-surface" onClick={onSelect}>
        <MemoryStick size={19} />
        <span>RAM Load</span>
        <strong>{formatBits(capacity)}</strong>
        <ModuleMeter value={used / capacity} />
        <small>
          {formatPercent(status.memoryPressure)} pressure /{" "}
          {formatBitRate(visible.hardware.ramSpeedMt)}
        </small>
        <div className="ram-stick-row" aria-hidden="true">
          {visible.metrics.ramSlots.map((slot) => (
            <span
              key={slot.id}
              style={
                {
                  "--slot-fill": `${Math.min(1, slot.usedBytes / slot.sizeBytes) * 100}%`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      </button>
      <HardwareInfoButton component="ram" open={infoOpen} onClick={onInfo} />
      {selected && <InlineUpgradeRow upgrades={upgrades} dispatch={dispatch} />}
    </div>
  );
}

function PsuModule({
  visible,
  selected,
  onSelect,
  infoOpen,
  onInfo,
  upgrades,
  dispatch,
}: {
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  infoOpen: boolean;
  onInfo: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
}) {
  const status = getSystemLoad(visible);
  const capacity = Math.max(visible.hardware.psuWatts, 1);

  return (
    <div className={`hardware-module psu-module ${selected ? "selected" : ""}`}>
      <button type="button" className="module-select-surface" onClick={onSelect}>
        <Power size={19} />
        <span>PSU Stress</span>
        <strong>{formatWatts(visible.hardware.psuWatts)}</strong>
        <ModuleMeter value={visible.metrics.powerUsedWatts / capacity} />
        <small>
          {formatPercent(status.psuStress)} stress /{" "}
          {formatNumber(visible.metrics.powerCostPerMinute)} c/min
        </small>
      </button>
      <HardwareInfoButton component="psu" open={infoOpen} onClick={onInfo} />
      {selected && <InlineUpgradeRow upgrades={upgrades} dispatch={dispatch} />}
    </div>
  );
}

function SystemStatusRail({ visible }: { visible: VisibleState }) {
  const status = getSystemLoad(visible);
  const memoryUnlocked = hasSystemMemory(visible);
  const coolingUnlocked = visible.flags.cooling;

  if (!memoryUnlocked && !coolingUnlocked) return null;

  return (
    <div className="system-status-rail" aria-label="System status">
      {memoryUnlocked && (
        <>
          <StatusTile
            icon={<MemoryStick size={16} />}
            label="Memory"
            value={formatPercent(status.memoryPressure)}
            meter={status.memoryPressure}
            tone={getStressTone(status.memoryPressure)}
          />
          <StatusTile
            icon={<Power size={16} />}
            label="PSU"
            value={formatPercent(status.psuStress)}
            meter={status.psuStress}
            tone={getStressTone(status.psuStress)}
          />
        </>
      )}
      {coolingUnlocked && (
        <StatusTile
          icon={<Activity size={16} />}
          label="Cooling"
          value={status.coolingStatus}
          meter={status.coolingStress}
          tone={getStressTone(status.coolingStress)}
        />
      )}
    </div>
  );
}

function StatusTile({
  icon,
  label,
  value,
  meter,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  meter: number | null;
  tone: string;
}) {
  return (
    <div className={`status-tile ${tone}`}>
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
      {meter !== null && <ModuleMeter value={meter} />}
    </div>
  );
}

function InlineUpgradeRow({
  upgrades,
  dispatch,
}: {
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
}) {
  if (upgrades.length === 0) return null;

  return (
    <div className="inline-upgrade-row" aria-label="Upgrades">
      {upgrades.map((upgrade) => (
        <button
          type="button"
          className={`inline-upgrade ${upgrade.accent}`}
          disabled={!upgrade.canAfford}
          key={upgrade.id}
          onClick={() =>
            dispatch({ type: "buyUpgrade", upgradeId: upgrade.id as UpgradeId })
          }
        >
          <Plus size={14} />
          <span>{upgrade.name}</span>
          <ResourceCost costs={upgrade.costs} compact />
        </button>
      ))}
    </div>
  );
}

export function TaskBay({
  visible,
  selectedComponent,
  dispatch,
}: {
  visible: VisibleState;
  selectedComponent: SelectedComponent;
  dispatch: Dispatch;
}) {
  const tasks = getTasks(visible);
  const activeTasks = getActiveTasks(visible);
  const queue = getQueueEntries(visible);
  const [inspectedTaskId, setInspectedTaskId] = useState<string | null>(null);
  const inspectedTask = tasks.find((task) => task.id === inspectedTaskId) ?? null;
  const selectedCoreId = getSelectedCoreId(selectedComponent);
  const selectedCore = selectedCoreId
    ? getAllCores(visible).find((core) => core.id === selectedCoreId)
    : null;
  const selectedSchedulerId = getSelectedSchedulerId(selectedComponent);
  const schedulerCanRoute =
    visible.flags.basicQueue || visible.flags.scheduler || selectedSchedulerId !== null;
  const mode: QueueMode =
    selectedCore || !selectedSchedulerId || !schedulerCanRoute
      ? selectedCore
        ? "core"
        : "auto"
      : "scheduler";
  const targetLabel = selectedCore
    ? `Core ${selectedCore.id} target`
    : mode === "scheduler"
      ? `CPU ${selectedSchedulerId} scheduler`
      : "Idle core target";
  const selectedCoreBusy = Boolean(selectedCore && getCoreActiveTask(selectedCore));
  const memoryUnlocked = hasSystemMemory(visible);

  const runTask = (task: UiTask) => {
    if (mode === "core" && selectedCore) {
      dispatch({
        type: "startTaskOnCore",
        taskId: task.id,
        coreId: selectedCore.id,
      });
      return;
    }

    if (mode === "scheduler") {
      dispatch({ type: "queueTask", taskId: task.id });
      return;
    }

    dispatch({ type: "startTask", taskId: task.id });
  };

  return (
    <section className="task-bay" aria-label="Tasks and research">
      <div className="task-bay-header">
        <ListTodo size={17} />
        <span>Tasks</span>
        <small>{targetLabel}</small>
      </div>
      <div className="task-surface">
        <div className="task-command-flow">
          {tasks.map((task) => {
            const canStart = getTaskCanStart(task);
            const activeTask = getActiveTaskFor(task, activeTasks);

            return (
              <TaskCommand
                key={task.id}
                task={task}
                mode={mode}
                state={getTaskState(task, activeTasks, queue)}
                progress={getTaskProgress(task, activeTasks, queue)}
                runtimeLabel={activeTask ? getActiveRuntimeLabel(activeTask) : null}
                disabled={selectedCoreBusy || !canStart}
                disabledReason={
                  selectedCoreBusy
                    ? `Core ${selectedCore?.id} is active`
                    : getTaskLockedReason(task) ??
                      (!canStart ? "Waiting on research or hardware" : null)
                }
                onRun={() => runTask(task)}
                onInspect={() => setInspectedTaskId(task.id)}
                memoryUnlocked={memoryUnlocked}
              />
            );
          })}
        </div>
        <ResearchSurface research={getResearch(visible)} dispatch={dispatch} />
      </div>
      {inspectedTask && (
        <TaskDagModal
          task={inspectedTask}
          visible={visible}
          activeTask={getActiveTaskFor(inspectedTask, activeTasks)}
          onClose={() => setInspectedTaskId(null)}
          memoryUnlocked={memoryUnlocked}
        />
      )}
    </section>
  );
}

function TaskCommand({
  task,
  mode,
  state,
  progress,
  runtimeLabel,
  disabled,
  disabledReason,
  onRun,
  onInspect,
  memoryUnlocked,
}: {
  task: UiTask;
  mode: QueueMode;
  state: TaskState;
  progress: number;
  runtimeLabel: string | null;
  disabled: boolean;
  disabledReason: string | null;
  onRun: () => void;
  onInspect: () => void;
  memoryUnlocked: boolean;
}) {
  const operationCount = getTaskOperationCount(task);
  const taskStatusLine = runtimeLabel ?? disabledReason;
  const commandLabel =
    mode === "scheduler"
      ? "Queue"
      : mode === "core"
        ? "Assign"
        : state === "rerun"
          ? "Rerun"
          : state === "restart"
            ? "Restart"
            : "Start";

  return (
    <article className={`task-card ${task.kind ?? "task"} ${state}`}>
      <div className="task-command">
        <span className="task-copy">
          <strong>{task.name}</strong>
          {taskStatusLine ? (
            <small className="task-status-line">{taskStatusLine}</small>
          ) : (
            <TaskRewardLine
              operationCount={operationCount}
              rewards={getTaskRewardCosts(task)}
            />
          )}
        </span>
        <TaskStatePill state={state} />
        <span className="task-progress" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
        </span>
        <span className="task-load-grid">
          <span>
            Cache <strong>{formatBits(getTaskCacheBits(task))}</strong>
          </span>
          {memoryUnlocked && (
            <span>
              RAM <strong>{formatBits(getTaskRamBits(task))}</strong>
            </span>
          )}
        </span>
      </div>
      <div className="task-action-row">
        <button
          type="button"
          className="task-run-button"
          disabled={disabled}
          onClick={onRun}
        >
          <Play size={15} />
          <span>{commandLabel}</span>
        </button>
        <button
          type="button"
          className="task-inspect-button"
          onClick={onInspect}
          title={`Inspect ${task.name}`}
          aria-label={`Inspect ${task.name}`}
        >
          <Eye size={15} />
        </button>
      </div>
    </article>
  );
}

function TaskRewardLine({
  operationCount,
  rewards,
}: {
  operationCount: number | undefined;
  rewards: DisplayCost[];
}) {
  return (
    <small className="task-status-line task-reward-line">
      <span className="operation-token">
        <Activity size={13} />
        <strong>
          {operationCount === undefined ? "Pending" : formatNumber(operationCount)}
        </strong>
        <span>ops</span>
      </span>
      {rewards.length > 0 ? (
        <ResourceCost costs={rewards} compact />
      ) : (
        <span className="empty-payout">No payout</span>
      )}
    </small>
  );
}

function TaskStatePill({ state }: { state: TaskState }) {
  const label =
    state === "active"
      ? "Active"
      : state === "waiting"
        ? "Waiting"
        : state === "rerun"
          ? "Rerun"
          : state === "restart"
            ? "Restart"
            : state === "locked"
              ? "Locked"
              : "Ready";

  return <small className={`task-state-pill ${state}`}>{label}</small>;
}

function TaskDagModal({
  task,
  visible,
  activeTask,
  onClose,
  memoryUnlocked,
}: {
  task: UiTask;
  visible: VisibleState;
  activeTask: UiActiveTask | null;
  onClose: () => void;
  memoryUnlocked: boolean;
}) {
  const progress = activeTask ? clampMeter(activeTask.progress) : clampMeter(task.progress ?? 0);
  const assignedCores = activeTask?.assignedCoreIds ?? [activeTask?.coreId].filter(
    (coreId): coreId is number => typeof coreId === "number",
  );
  const requiredCores = firstNumber(task.requiredCores, task.minCores) ?? 1;
  const reservedBits =
    activeTask?.coreProgress?.reduce(
      (total, operation) =>
        total +
        firstBits(
          [operation.memoryReservedBits],
          [operation.memoryReservedBytes],
        ),
      0,
    ) ?? 0;
  const loadNote = activeTask
    ? getActiveRuntimeLabel(activeTask)
    : getTaskCacheBits(task) > 0 || (memoryUnlocked && getTaskRamBits(task) > 0)
      ? "Load phase before compute"
      : "Direct compute";
  const coreNote =
    assignedCores.length > 0
      ? `Cores ${assignedCores.join(", ")} reserved`
      : `${formatNumber(requiredCores)} core${requiredCores === 1 ? "" : "s"} reserved at start`;
  const payoutRewards = getTaskRewardCosts(task);
  const payoutNote =
    payoutRewards.length > 0 ? (
      <span className="payout-note">
        <ResourceCost costs={payoutRewards} />
        <span>on completion</span>
      </span>
    ) : (
      "No payout"
    );

  return (
    <div className="task-dag-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="task-dag-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dag-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="task-dag-header">
          <div>
            <span>{task.kind ?? "task"}</span>
            <strong id="task-dag-title">{task.name}</strong>
          </div>
          <button
            type="button"
            className="task-dag-close"
            onClick={onClose}
            aria-label="Close task inspect"
            title="Close"
          >
            <X size={17} />
          </button>
        </div>

        <div className="task-dag-summary" aria-label="Task runtime summary">
          <DagSummaryTile label="Progress" value={formatPercent(progress)} meter={progress} />
          <DagSummaryTile label="Load" value={loadNote} />
          <DagSummaryTile label="Cores" value={coreNote} />
          <DagSummaryTile label="Payout" value={payoutNote} />
          <DagSummaryTile
            label="Cache"
            value={`${formatBits(getTaskCacheBits(task))} ${getFitLabel(task, visible, "cache")}`}
          />
          {memoryUnlocked && (
            <DagSummaryTile
              label="RAM"
              value={
                reservedBits > 0
                  ? `${formatBits(reservedBits)} reserved`
                  : `${formatBits(getTaskRamBits(task))} ${getFitLabel(task, visible, "ram")}`
              }
            />
          )}
        </div>

        <div className="task-dag-scroll">
          <TaskDagNode
            node={task}
            visible={visible}
            activeTask={activeTask}
            memoryUnlocked={memoryUnlocked}
          />
        </div>
      </section>
    </div>
  );
}

function DagSummaryTile({
  label,
  value,
  meter,
}: {
  label: string;
  value: ReactNode;
  meter?: number;
}) {
  return (
    <div className="dag-summary-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {typeof meter === "number" && <ModuleMeter value={meter} />}
    </div>
  );
}

function TaskDagNode({
  node,
  visible,
  activeTask,
  memoryUnlocked,
  dependencyHint,
}: {
  node: UiTaskGraphNode;
  visible: VisibleState;
  activeTask: UiActiveTask | null;
  memoryUnlocked: boolean;
  dependencyHint?: string;
}) {
  const children = getDagChildren(node);
  const dependencies = getDependencyLabels(node);
  const runtime = getNodeRuntime(node, activeTask);
  const progress = getNodeProgress(node, activeTask);
  const operationCount = firstNumber(
    node.operationCount,
    Array.isArray(node.operations)
      ? getOperationCountFromOperations(node.operations)
      : undefined,
  );
  const memoryActions = Array.from(
    new Set(
      [
        node.memoryAction,
        ...(Array.isArray(node.operations)
          ? node.operations.map((operation) => operation.memoryAction)
          : []),
      ].filter((action): action is string => Boolean(action)),
    ),
  );
  const label = node.kind ?? (children.length > 0 ? "task" : "operation");

  return (
    <div className={`dag-node-wrap ${children.length > 0 ? "has-children" : ""}`}>
      <article className={`dag-node ${label}`}>
        <div className="dag-node-title">
          <span>{label}</span>
          <strong>{node.name ?? node.id ?? "Operation"}</strong>
        </div>
        <div className="dag-node-meta">
          {operationCount !== undefined && <span>{formatNumber(operationCount)} ops</span>}
          {memoryActions.length > 0 && <span>{memoryActions.join(" / ")}</span>}
          <span>Cache {formatBits(getNodeCacheBits(node))}</span>
          {memoryUnlocked && <span>RAM {formatBits(getNodeRamBits(node))}</span>}
          <span>{getFitLabel(node, visible, "cache")}</span>
          {memoryUnlocked && <span>{getFitLabel(node, visible, "ram")}</span>}
        </div>
        <small>
          Deps: {dependencies.length > 0 ? dependencies.join(", ") : dependencyHint ?? "Root"}
        </small>
        {runtime && <em>{runtime}</em>}
        {progress !== null && (
          <span className="dag-node-progress" aria-hidden="true">
            <span style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      </article>
      {children.length > 0 && (
        <div className="dag-children">
          {children.map((child, index) => (
            <TaskDagNode
              key={`${child.id ?? child.name ?? "node"}-${index}`}
              node={child}
              visible={visible}
              activeTask={activeTask}
              memoryUnlocked={memoryUnlocked}
              dependencyHint={index === 0 ? "Task start" : `After ${children[index - 1]?.name ?? "previous"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function getDagChildren(node: UiTaskGraphNode) {
  const recipeNodes = [
    ...(node.subtasks ?? []),
    ...(node.subTasks ?? []),
    ...(node.tasks ?? []),
    ...(node.children ?? []),
  ];
  const dagNodes = node.dagNodes ?? [];
  const operations = Array.isArray(node.operations) ? node.operations : [];
  const isRootTask = node.kind === undefined || node.kind === "task";

  if (dagNodes.length > 0) return dagNodes;
  if (recipeNodes.length > 0) return recipeNodes;
  return isRootTask ? operations : [];
}

function getDependencyLabels(node: UiTaskGraphNode) {
  const dependencies = [
    ...(node.dependencyIds ?? []),
    ...(node.dependencies ?? []),
    ...(node.dependsOn ?? []),
    ...(node.requires ?? []),
  ];

  return dependencies
    .map((dependency) =>
      typeof dependency === "string"
        ? dependency
        : dependency.name ?? dependency.id ?? null,
    )
    .filter((dependency): dependency is string => Boolean(dependency));
}

function getFitLabel(
  node: UiTaskGraphNode,
  visible: VisibleState,
  kind: "cache" | "ram",
) {
  if (kind === "cache" && node.cacheFit) return node.cacheFit;

  const need = kind === "cache" ? getNodeCacheBits(node) : getNodeRamBits(node);
  if (need <= 0) return "no load";

  const capacity =
    kind === "cache" ? getVisibleCacheBits(visible) : getVisibleRamBits(visible);
  if (capacity > need) return "fits + headroom";
  if (capacity === need) return "fits";
  return "over capacity";
}

function getNodeRuntime(node: UiTaskGraphNode, activeTask: UiActiveTask | null) {
  if (!activeTask) return null;
  if (node.id === activeTask.taskId) return getActiveRuntimeLabel(activeTask);

  const operationIds = new Set([
    ...(node.operationIds ?? []),
    ...(Array.isArray(node.operations)
      ? node.operations.map((operation) => operation.id)
      : []),
  ]);
  const operationNames = new Set(
    Array.isArray(node.operations)
      ? node.operations.map((operation) => operation.name)
      : [],
  );
  const matchesNodeKind = (operation: NonNullable<UiActiveTask["coreProgress"]>[number]) => {
    if (node.kind === "cacheLoad") {
      return operation.status === "loadingCache" || operation.memoryState === "cacheLoad";
    }
    if (node.kind === "ramLoad") {
      return operation.status === "loadingRam" || operation.memoryState === "ramLoad";
    }
    if (node.kind === "execute") {
      return operation.status === "running" || operation.status === "rerunning";
    }
    return true;
  };
  const matches =
    activeTask.coreProgress?.filter(
      (operation) =>
        matchesNodeKind(operation) &&
        ((operation.operationId !== null && operationIds.has(operation.operationId)) ||
          (operation.operationName !== null &&
            operationNames.has(operation.operationName)) ||
          (node.id && operation.operationId === node.id) ||
          (node.name && operation.operationName === node.name)),
    ) ?? [];
  if (matches.length === 0) return null;

  const states = matches.map(
    (operation) => operation.memoryState ?? operation.status ?? "running",
  );
  return Array.from(new Set(states)).join(" / ");
}

function getNodeProgress(node: UiTaskGraphNode, activeTask: UiActiveTask | null) {
  if (activeTask) return null;
  return typeof node.progress === "number" ? clampMeter(node.progress) : null;
}

function isResearchPurchased(research: UiResearch) {
  return Boolean(
    research.purchased ||
      research.completed ||
      research.status?.toLowerCase() === "purchased" ||
      research.status?.toLowerCase() === "complete",
  );
}

const getResearchRequirementTag = (kind: string | undefined) => {
  if (kind === "compute") return "Compute";
  if (kind === "hardware") return "Hardware";
  if (kind === "task") return "Task";
  return "Research";
};

const isResearchComputeComplete = (task: UiResearchComputeTask) =>
  Boolean(task.completed || getTaskCompletedCount(task) > 0);

function ResearchSurface({
  research,
  dispatch,
}: {
  research: UiResearch[];
  dispatch: Dispatch;
}) {
  const [hideCompleted, setHideCompleted] = useState(true);
  const visibleResearch = hideCompleted
    ? research.filter((item) => !isResearchPurchased(item))
    : research;
  const emptyLabel =
    research.length > 0 && hideCompleted ? "No open research" : "No research queued";

  return (
    <aside className="research-surface" aria-label="Research">
      <div className="research-heading">
        <Activity size={16} />
        <span>Research</span>
        <label className="research-filter-toggle">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(event) => setHideCompleted(event.target.checked)}
          />
          <span>Hide built</span>
        </label>
      </div>
      {visibleResearch.length === 0 ? (
        <div className="research-empty">{emptyLabel}</div>
      ) : (
        <div className="research-list">
          {visibleResearch.map((item) => (
            <ResearchAction key={item.id} research={item} dispatch={dispatch} />
          ))}
        </div>
      )}
    </aside>
  );
}

function ResearchAction({
  research,
  dispatch,
}: {
  research: UiResearch;
  dispatch: Dispatch;
}) {
  const costs = research.costs ?? research.cost ?? [];
  const lockedReason =
    research.blockedReason ??
    research.lockedReason ??
    research.lockReason ??
    research.unlockReason ??
    null;
  const requirements = research.requirements ?? [];
  const computeTasks = research.computeTasks ?? [];
  const purchased = isResearchPurchased(research);
  const canBuy =
    !purchased &&
    !lockedReason &&
    (research.canAfford ?? research.canBuy ?? costs.length === 0);

  return (
    <article
      className={`research-action ${research.accent ?? "violet"} ${
        purchased ? "purchased" : ""
      }`}
    >
      <div className="research-action-main">
        <span className="research-copy">
          <strong>{research.name}</strong>
          {research.description && <small>{research.description}</small>}
          {lockedReason && <small>{lockedReason}</small>}
        </span>
        <button
          type="button"
          className="research-buy-button"
          disabled={!canBuy}
          onClick={() => dispatch({ type: "buyResearch", researchId: research.id })}
        >
          {purchased ? <CheckCircle2 size={14} /> : <Plus size={14} />}
          <span>{purchased ? "Built" : "Research"}</span>
        </button>
      </div>

      {requirements.length > 0 && (
        <div className="research-requirements" aria-label={`${research.name} requirements`}>
          {requirements.map((item) => (
            <span
              className={`research-requirement ${item.met ? "met" : "open"}`}
              key={item.id}
            >
              <b>{item.met ? "Met" : getResearchRequirementTag(item.kind)}</b>
              <small>{item.label}</small>
            </span>
          ))}
        </div>
      )}

      {computeTasks.length > 0 && (
        <div className="research-compute-list">
          {computeTasks.map((task) => {
            const completed = isResearchComputeComplete(task);
            const active = Boolean(task.active);
            const canStart = getTaskCanStart(task);
            const disabled = completed || active || !canStart;
            const operationCount = getTaskOperationCount(task);
            const ramBits = getTaskRamBits(task);
            const cores = firstNumber(task.requiredCores, task.minCores) ?? 1;
            const blockedReason = completed
              ? null
              : active
                ? getActiveRuntimeLabel({
                    name: task.name,
                    coreId: 1,
                    progress: task.progress ?? 0,
                    status: "active",
                  })
                : getTaskLockedReason(task);

            return (
              <div className="research-compute" key={task.id}>
                <span className="research-compute-copy">
                  <strong>{task.name}</strong>
                  <small>
                    {operationCount === undefined
                      ? "Compute"
                      : `${formatNumber(operationCount)} ops`}
                    {" · "}
                    Cache {formatBits(getTaskCacheBits(task))}
                    {ramBits > 0 ? ` · RAM ${formatBits(ramBits)}` : ""}
                    {" · "}
                    {formatNumber(cores)} core{cores === 1 ? "" : "s"}
                  </small>
                  {blockedReason && <small>{blockedReason}</small>}
                  {(active || completed) && (
                    <ModuleMeter value={completed ? 1 : task.progress ?? 0} />
                  )}
                </span>
                <button
                  type="button"
                  className="research-compute-button"
                  disabled={disabled}
                  onClick={() => dispatch({ type: "startTask", taskId: task.id })}
                >
                  <Play size={13} />
                  <span>
                    {completed ? "Done" : active ? "Active" : task.canQueue ? "Queue" : "Run"}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      <em className="research-cost-line">
        {purchased ? "Built" : <ResourceCost costs={costs} compact />}
      </em>
    </article>
  );
}

function ModuleMeter({ value }: { value: number }) {
  return (
    <span className="module-meter" aria-hidden="true">
      <span style={{ width: `${clampMeter(value) * 100}%` }} />
    </span>
  );
}

const getCoreHue = (coreId: number) => (168 + (coreId - 1) * 47) % 360;

const getCoreSegmentColor = (coreId: number, alpha: number) =>
  `hsla(${getCoreHue(coreId)}, 82%, 62%, ${alpha})`;

const cacheStateLabels: Array<{
  state: CacheSegmentState;
  label: string;
}> = [
  { state: "buffering", label: "Buffer" },
  { state: "loading", label: "Load" },
  { state: "loaded", label: "Ready" },
];

const getCacheSegmentAlpha = (state: CacheSegmentState) => {
  if (state === "loaded") return 0.94;
  if (state === "loading") return 0.66;
  return 0.52;
};

function CacheStateSummary({
  stateBits,
}: {
  stateBits: Record<CacheSegmentState, number>;
}) {
  return (
    <span className="cache-state-summary" aria-label="Cache states">
      {cacheStateLabels.map(({ state, label }) => {
        const bits = stateBits[state];

        return (
          <span
            className={`cache-state-badge ${state} ${bits > 0 ? "active" : ""}`}
            key={state}
            title={`${label}: ${formatBits(bits)}`}
          >
            <strong>{formatBits(bits)}</strong>
            <span aria-hidden="true" />
            <small>{label}</small>
          </span>
        );
      })}
    </span>
  );
}

function CachePressureMeter({
  segments,
  capacityBits,
}: {
  segments: CacheSegment[];
  capacityBits: number;
}) {
  const capacity = Math.max(1, capacityBits);
  let remaining = capacity;
  const visibleSegments = segments.flatMap((segment) => {
    if (remaining <= 0 || segment.bits <= 0) return [];

    const bits = Math.min(remaining, segment.bits);
    remaining -= bits;
    return [{ ...segment, bits }];
  });

  return (
    <span className="module-meter cache-pressure-meter" aria-hidden="true">
      {visibleSegments.map((segment, index) => (
        <span
          key={`${segment.kind}-${segment.state}-${index}`}
          className={`cache-pressure-segment cache-pressure-${segment.kind} ${segment.state}`}
          style={
            {
              width: `${(segment.bits / capacity) * 100}%`,
              "--cache-core-color": getCoreSegmentColor(
                segment.coreId,
                getCacheSegmentAlpha(segment.state),
              ),
              "--cache-core-solid-color": getCoreSegmentColor(
                segment.coreId,
                segment.state === "loaded" ? 0.94 : 0.86,
              ),
              "--cache-buffer-progress": `${
                (segment.state === "loading" || segment.state === "loaded"
                  ? 1
                  : clampMeter(segment.bufferProgress)) * 100
              }%`,
              "--cache-write-progress": `${getCacheSegmentWriteProgress(segment) * 100}%`,
            } as CSSProperties
          }
        >
          <span className="cache-pressure-buffer" />
          <span className="cache-pressure-fill" />
        </span>
      ))}
    </span>
  );
}

function HardwareInfoButton({
  component,
  open,
  onClick,
}: {
  component: HardwareComponentId;
  open: boolean;
  onClick: () => void;
}) {
  const copy = componentCopy[component];

  return (
    <>
      <button
        type="button"
        className="info-icon-button"
        onClick={onClick}
        aria-label={`About ${copy.title}`}
        aria-expanded={open}
        title={`About ${copy.title}`}
      >
        <Info size={16} />
      </button>
      {open && (
        <div className="hardware-info-popover" role="note">
          <strong>{copy.title}</strong>
          <span>{copy.info}</span>
        </div>
      )}
    </>
  );
}
