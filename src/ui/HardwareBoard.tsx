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
  ListTodo,
  MemoryStick,
  Play,
  Power,
  Plus,
  RefreshCw,
  Thermometer,
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
      <Icon size={compact ? 13 : 14} />
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
  psu?: { stress?: number };
  cooling?: { status?: string; stress?: number };
}

type UiCore = VisibleCore & { activeTask?: UiActiveTask | null };

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

  return { segments, reservedBits, loadingBits };
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
  if (segments.some((segment) => segment.state === "loading")) return "Load";
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
    [ui.systemStatus?.cacheBits, ui.systemStatus?.cache?.capacityBits, hardware.cacheBits],
    [
      ui.systemStatus?.cacheBytes,
      ui.systemStatus?.cache?.capacityBytes,
      visible.hardware.cacheBytes,
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

const getVisibleSchedulerSlots = (visible: VisibleState) =>
  Math.max(0, getHardware(visible).schedulerSlots ?? 0);

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

const getTaskQueueBlockedReason = (task: UiTask) =>
  task.queueBlockedReason ?? (task.canQueue === false ? getTaskLockedReason(task) : null);

const getTaskCanRunNow = (task: UiTask) => {
  if (getTaskLockedReason(task)) return false;
  if (typeof task.canStart === "boolean") return task.canStart;
  if (typeof task.canRun === "boolean") return task.canRun;
  return true;
};

const getTaskCanStart = (task: UiTask) =>
  getTaskCanRunNow(task) || task.canQueue === true;

const getTaskCanUseAction = (task: UiTask, mode: QueueMode) => {
  if (mode === "core") return getTaskCanRunNow(task);
  if (mode === "scheduler") return task.canQueue === true;
  return getTaskCanStart(task);
};

const getTaskActionDisabledReason = (task: UiTask, mode: QueueMode) => {
  if (mode === "scheduler") {
    return getTaskQueueBlockedReason(task) ?? "Scheduler unavailable";
  }

  return getTaskLockedReason(task) ?? getTaskQueueBlockedReason(task) ?? "Locked";
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

  if (queue.some((entry) => getQueueTaskId(entry) === task.id)) return "waiting";
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
    firstNumber(
      system?.psuStress,
      system?.powerStress,
      system?.psu?.stress,
      ui.metrics.psuStress,
      ui.metrics.powerStress,
    ),
  );
  const coolingStress = normalizeRatio(
    firstNumber(
      system?.coolingStress,
      system?.thermalStress,
      system?.cooling?.stress,
      ui.metrics.coolingStress,
    ),
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
  }, [animateResourceGains, visible.resources.credits, visible.resources.data]);

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
        <Database size={13} />
        <strong>{formatNumber(Math.floor(visible.resources.data))}</strong>
        <span>data</span>
      </div>
      <div className="resource-readout credits" ref={creditsReadoutRef}>
        <Zap size={13} />
        <strong>{formatNumber(Math.floor(visible.resources.credits))}</strong>
        <span>cr</span>
      </div>
      <div className="resource-readout operations">
        <Activity size={13} />
        <strong>{formatNumber(activeCount)}</strong>
        <span>active</span>
      </div>
      <div className="resource-readout waiting">
        <ListTodo size={13} />
        <strong>{formatNumber(queueCount)}</strong>
        <span>queue</span>
      </div>
      <button
        type="button"
        className="dev-reset-button"
        onClick={onReset}
        title="Reset dev save"
        aria-label="Reset dev save"
      >
        <RefreshCw size={13} />
      </button>
    </div>
  );
}

/* ============ HARDWARE BOARD ============ */

export function HardwareBoard({
  visible,
  dispatch,
  selectedComponent,
  onSelectComponent,
}: HardwareBoardProps) {
  const selectedCoreId = getSelectedCoreId(selectedComponent);
  const selectedSchedulerId = getSelectedSchedulerId(selectedComponent);
  const schedulerVisible =
    visible.flags.basicQueue || visible.flags.scheduler || getQueueEntries(visible).length > 0;
  const memoryVisible = hasSystemMemory(visible);
  const totalCores = visible.hardware.cores;
  const upgradesFor = (component: HardwareComponentId) =>
    visible.upgrades.filter((upgrade) => upgrade.component === component);

  const cpuUpgrades = upgradesFor("cpu");
  const cacheUpgrades = upgradesFor("cache");
  const schedulerUpgrades = upgradesFor("scheduler");
  const ramUpgrades = upgradesFor("ram");
  const psuUpgrades = upgradesFor("psu");
  const socketUpgrades = upgradesFor("socket");

  const cpuSelected = selectedComponent === "cpu";
  const cacheSelected = selectedComponent === "cache";

  return (
    <>
      {visible.metrics.cpuSockets.map((socket) => (
        <CpuSection
          key={socket.id}
          socket={socket}
          totalCores={totalCores}
          selected={cpuSelected}
          onSelect={() => onSelectComponent("cpu")}
          selectedCoreId={selectedCoreId}
          onSelectCore={(coreId) => onSelectComponent(`core:${coreId}`)}
          cpuUpgrades={cpuUpgrades}
          dispatch={dispatch}
        />
      ))}

      {!visible.hardware.secondCpu && visible.flags.secondCpu && (
        <EmptySocketSection
          selected={selectedComponent === "socket"}
          onSelect={() => onSelectComponent("socket")}
          upgrades={socketUpgrades}
          dispatch={dispatch}
        />
      )}

      <CacheSection
        visible={visible}
        selected={cacheSelected}
        onSelect={() => onSelectComponent("cache")}
        upgrades={cacheUpgrades}
        dispatch={dispatch}
      />

      {schedulerVisible &&
        visible.metrics.cpuSockets.map((socket) => (
          <SchedulerSection
            key={`scheduler-${socket.id}`}
            socket={socket}
            visible={visible}
            selected={selectedSchedulerId === socket.id}
            onSelect={() => onSelectComponent(`scheduler:${socket.id}`)}
            upgrades={schedulerUpgrades}
            dispatch={dispatch}
          />
        ))}

      {memoryVisible && (
        <div className="module-rail">
          <RamSection
            visible={visible}
            selected={selectedComponent === "ram"}
            onSelect={() => onSelectComponent("ram")}
            upgrades={ramUpgrades}
            dispatch={dispatch}
          />
          <PsuSection
            visible={visible}
            selected={selectedComponent === "psu"}
            onSelect={() => onSelectComponent("psu")}
            upgrades={psuUpgrades}
            dispatch={dispatch}
          />
          {visible.flags.cooling && <CoolingSection visible={visible} />}
        </div>
      )}
    </>
  );
}

/* ============ CPU SECTION ============ */

function CpuSection({
  socket,
  totalCores,
  selected,
  onSelect,
  selectedCoreId,
  onSelectCore,
  cpuUpgrades,
  dispatch,
}: {
  socket: VisibleCpuSocket;
  totalCores: number;
  selected: boolean;
  onSelect: () => void;
  selectedCoreId: number | null;
  onSelectCore: (coreId: number) => void;
  cpuUpgrades: VisibleUpgrade[];
  dispatch: Dispatch;
}) {
  const coreUpgrade = cpuUpgrades.find((upgrade) => upgrade.id === "core");
  const otherCpuUpgrades = cpuUpgrades.filter(
    (upgrade) => upgrade.id !== "clock" && upgrade.id !== "core",
  );
  const compact = totalCores >= 4;
  const activeCount = socket.cores.filter((core) => getCoreActiveTask(core)).length;

  return (
    <section className={`hw-section cpu-section ${selected ? "selected" : ""}`}>
      <button
        type="button"
        className="hw-section-header"
        onClick={onSelect}
      >
        <Cpu size={14} />
        <span>{socket.label}</span>
        <span className="hw-section-meta">
          <strong>{activeCount}</strong>/{totalCores} active
        </span>
      </button>

      <div className={`core-grid ${compact ? "compact" : ""}`}>
        {socket.cores.map((core) => (
          <CoreDie
            key={core.id}
            core={core}
            compact={compact}
            selected={selectedCoreId === core.id}
            onSelect={() => onSelectCore(core.id)}
            dispatch={dispatch}
          />
        ))}
        {coreUpgrade && (
          <AddCoreDie upgrade={coreUpgrade} dispatch={dispatch} />
        )}
      </div>

      {selected && otherCpuUpgrades.length > 0 && (
        <InlineUpgradeRow upgrades={otherCpuUpgrades} dispatch={dispatch} />
      )}
    </section>
  );
}

function CoreDie({
  core,
  compact,
  selected,
  onSelect,
  dispatch,
}: {
  core: VisibleCore;
  compact: boolean;
  selected: boolean;
  onSelect: () => void;
  dispatch: Dispatch;
}) {
  const active = getCoreActiveTask(core);
  const progress =
    active?.coreProgress?.find((operation) => operation.coreId === core.id)?.progress ?? 0;
  const clockUpgrade = core.clockUpgrade;
  const work = active?.name ?? "Idle";

  return (
    <button
      type="button"
      className={`core-die ${active ? "running" : ""} ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="core-die-head">
        <span className="core-label">C{core.id}</span>
        <span className="core-status-dot" aria-hidden="true" />
      </span>
      <span className="core-clock">
        <strong>{formatClock(core.clockHz)}</strong>
      </span>
      {!compact && (
        <span className="core-work" title={work}>
          {work}
        </span>
      )}
      <span className="die-progress" aria-hidden="true">
        <span style={{ width: `${clampMeter(progress) * 100}%` }} />
      </span>
      {clockUpgrade && (
        <span
          className="core-upgrade-chip"
          role="button"
          tabIndex={0}
          aria-disabled={!clockUpgrade.canAfford}
          title={`${clockUpgrade.name}: ${formatCost(clockUpgrade.costs)}`}
          onClick={(event) => {
            event.stopPropagation();
            if (!clockUpgrade.canAfford) return;
            dispatch({
              type: "buyUpgrade",
              upgradeId: clockUpgrade.id as UpgradeId,
              coreId: core.id,
            });
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.stopPropagation();
            event.preventDefault();
            if (!clockUpgrade.canAfford) return;
            dispatch({
              type: "buyUpgrade",
              upgradeId: clockUpgrade.id as UpgradeId,
              coreId: core.id,
            });
          }}
          style={{
            opacity: clockUpgrade.canAfford ? 1 : 0.45,
            cursor: clockUpgrade.canAfford ? "pointer" : "not-allowed",
          }}
        >
          <Plus size={11} />
          <ResourceCost costs={clockUpgrade.costs} compact />
        </span>
      )}
    </button>
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
      title={`${upgrade.name}: ${formatCost(upgrade.costs)}`}
    >
      <Plus size={16} />
      <span>Add Core</span>
      <ResourceCost costs={upgrade.costs} compact />
    </button>
  );
}

function EmptySocketSection({
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
    <section
      className={`hw-section cpu-section ${selected ? "selected" : ""}`}
    >
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <Cpu size={14} />
        <span>Socket B</span>
        <span className="hw-section-meta">Empty</span>
      </button>
      <div className="empty-socket">
        <strong>Install CPU</strong>
        <small>Unlocks RAM + PSU systems</small>
      </div>
      {selected && <InlineUpgradeRow upgrades={upgrades} dispatch={dispatch} />}
    </section>
  );
}

/* ============ CACHE SECTION ============ */

function CacheSection({
  visible,
  selected,
  onSelect,
  upgrades,
  dispatch,
}: {
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
}) {
  const capacity = Math.max(getVisibleCacheBits(visible), 1);
  const cacheReservation = getCacheReservation(visible);
  const cacheUpgrade = upgrades.find((upgrade) => upgrade.id === "cache");
  const cacheSpeedUpgrade = upgrades.find((upgrade) => upgrade.id === "cacheSpeed");
  const otherUpgrades = upgrades.filter(
    (upgrade) => upgrade.id !== "cache" && upgrade.id !== "cacheSpeed",
  );
  const stateBits = getCacheStateBits(cacheReservation.segments);
  const cacheState = getCachePrimaryState(cacheReservation.segments);

  return (
    <section className={`hw-section cache-section ${selected ? "selected" : ""}`}>
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <HardDrive size={14} />
        <span>Cache</span>
        <span className="hw-section-meta">
          <strong>{cacheState}</strong>
        </span>
      </button>

      <div className="cache-stat-row">
        <span className="stat">
          <strong>{formatBits(capacity)}</strong>
        </span>
        <span className="stat">
          <strong>{formatClock(getCacheSpeedHz(visible))}</strong>
        </span>
        <span className="upgrade-chips">
          {cacheUpgrade && (
            <UpgradeChip
              accent="green"
              upgrade={cacheUpgrade}
              dispatch={dispatch}
            />
          )}
          {cacheSpeedUpgrade && (
            <UpgradeChip
              accent="green"
              upgrade={cacheSpeedUpgrade}
              dispatch={dispatch}
            />
          )}
        </span>
      </div>

      <div className="cache-meter-block">
        <CachePressureMeter
          segments={cacheReservation.segments}
          capacityBits={capacity}
        />
        <CacheStateSummary stateBits={stateBits} />
      </div>

      {selected && otherUpgrades.length > 0 && (
        <InlineUpgradeRow upgrades={otherUpgrades} dispatch={dispatch} />
      )}
    </section>
  );
}

function UpgradeChip({
  accent,
  upgrade,
  dispatch,
  coreId,
}: {
  accent: "cyan" | "green" | "violet" | "amber";
  upgrade: VisibleUpgrade;
  dispatch: Dispatch;
  coreId?: number;
}) {
  return (
    <button
      type="button"
      className={`upgrade-chip ${accent}`}
      disabled={!upgrade.canAfford}
      title={`${upgrade.name}: ${formatCost(upgrade.costs)}`}
      onClick={() =>
        dispatch({
          type: "buyUpgrade",
          upgradeId: upgrade.id as UpgradeId,
          coreId,
        })
      }
    >
      <Plus size={11} />
      <ResourceCost costs={upgrade.costs} compact />
    </button>
  );
}

/* ============ SCHEDULER SECTION ============ */

function SchedulerSection({
  socket,
  visible,
  selected,
  onSelect,
  upgrades,
  dispatch,
}: {
  socket: VisibleCpuSocket;
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
}) {
  const activeInSocket = socket.cores.filter((core) => getCoreActiveTask(core)).length;
  const queueLabels = getQueueLabels(visible, socket.id);
  const waitingCount = queueLabels.length;
  const slotCapacity = getVisibleSchedulerSlots(visible);
  const queueFull = slotCapacity > 0 && waitingCount >= slotCapacity;

  return (
    <section className={`hw-section scheduler-section ${selected ? "selected" : ""}`}>
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <ListTodo size={14} />
        <span>Scheduler</span>
        <span className="hw-section-meta scheduler-counts">
          <span className="pill active">
            <strong>{activeInSocket}</strong>active
          </span>
          <span className={`pill waiting ${queueFull ? "full" : ""}`}>
            <strong>
              {formatNumber(waitingCount)}/{formatNumber(slotCapacity)}
            </strong>
            slots
          </span>
        </span>
      </button>

      {queueLabels.length > 0 && (
        <div className="queue-preview" aria-label="Queued tasks">
          {queueLabels.slice(0, 8).map((label, index) => (
            <small key={`${label}-${index}`}>{label}</small>
          ))}
        </div>
      )}

      {selected && upgrades.length > 0 && (
        <InlineUpgradeRow upgrades={upgrades} dispatch={dispatch} />
      )}
    </section>
  );
}

/* ============ RAM / PSU / COOLING ============ */

function RamSection({
  visible,
  selected,
  onSelect,
  upgrades,
  dispatch,
}: {
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
}) {
  const status = getSystemLoad(visible);
  const capacity = Math.max(getVisibleRamBits(visible), 1);
  const used = Math.min(getVisibleRamUsedBits(visible), capacity);
  const tone = getStressTone(status.memoryPressure);
  const ramUpgrade = upgrades.find((upgrade) => upgrade.id === "ram");
  const otherUpgrades = upgrades.filter((upgrade) => upgrade.id !== "ram");

  return (
    <section className={`hw-section memory-section ${tone} ${selected ? "selected" : ""}`}>
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <MemoryStick size={14} />
        <span>RAM</span>
        <span className="hw-section-meta">
          <strong>{formatPercent(status.memoryPressure)}</strong>
        </span>
      </button>

      <div className="module-stat">
        <strong>{formatBits(capacity)}</strong>
        <small>{formatBitRate(visible.hardware.ramSpeedMt)}</small>
      </div>

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

      <ModuleMeter value={used / capacity} />

      {ramUpgrade && (
        <div className="cache-stat-row">
          <span className="upgrade-chips">
            <UpgradeChip accent="green" upgrade={ramUpgrade} dispatch={dispatch} />
          </span>
        </div>
      )}

      {selected && otherUpgrades.length > 0 && (
        <InlineUpgradeRow upgrades={otherUpgrades} dispatch={dispatch} />
      )}
    </section>
  );
}

function PsuSection({
  visible,
  selected,
  onSelect,
  upgrades,
  dispatch,
}: {
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
}) {
  const status = getSystemLoad(visible);
  const capacity = Math.max(visible.hardware.psuWatts, 1);
  const tone = getStressTone(status.psuStress);
  const psuUpgrade = upgrades.find((upgrade) => upgrade.id === "psu");
  const otherUpgrades = upgrades.filter((upgrade) => upgrade.id !== "psu");

  return (
    <section className={`hw-section psu-section ${tone} ${selected ? "selected" : ""}`}>
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <Power size={14} />
        <span>PSU</span>
        <span className="hw-section-meta">
          <strong>{formatPercent(status.psuStress)}</strong>
        </span>
      </button>

      <div className="module-stat">
        <strong>{formatWatts(visible.hardware.psuWatts)}</strong>
        <small>{formatNumber(visible.metrics.powerCostPerMinute)} c/min</small>
      </div>

      <ModuleMeter value={visible.metrics.powerUsedWatts / capacity} />

      {psuUpgrade && (
        <div className="cache-stat-row">
          <span className="upgrade-chips">
            <UpgradeChip accent="amber" upgrade={psuUpgrade} dispatch={dispatch} />
          </span>
        </div>
      )}

      {selected && otherUpgrades.length > 0 && (
        <InlineUpgradeRow upgrades={otherUpgrades} dispatch={dispatch} />
      )}
    </section>
  );
}

function CoolingSection({ visible }: { visible: VisibleState }) {
  const status = getSystemLoad(visible);
  const tone = getStressTone(status.coolingStress);

  return (
    <section className={`hw-section psu-section ${tone}`}>
      <div className="hw-section-header">
        <Thermometer size={14} />
        <span>Thermal</span>
        <span className="hw-section-meta">
          <strong>{status.coolingStatus}</strong>
        </span>
      </div>

      <div className="module-stat">
        <strong>{formatPercent(status.coolingStress)}</strong>
        <small>stress</small>
      </div>

      {status.coolingStress !== null && <ModuleMeter value={status.coolingStress} />}
    </section>
  );
}

/* ============ INLINE UPGRADES ============ */

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
          <Plus size={12} />
          <span>{upgrade.name}</span>
          <ResourceCost costs={upgrade.costs} compact />
        </button>
      ))}
    </div>
  );
}

/* ============ TASK BAY ============ */

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
    ? `Core ${selectedCore.id}`
    : mode === "scheduler"
      ? `Sched ${selectedSchedulerId}`
      : "Auto";
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
    <>
      <div className="panel-header">
        <ListTodo size={14} />
        <span>Tasks</span>
        <small>{targetLabel}</small>
      </div>
      <div className="panel-body">
        {tasks.length === 0 ? (
          <div className="research-empty">No tasks available</div>
        ) : (
          tasks.map((task) => {
            const canStart = getTaskCanUseAction(task, mode);
            const activeTask = getActiveTaskFor(task, activeTasks);
            const disabled = selectedCoreBusy || !canStart;

            return (
              <TaskCard
                key={task.id}
                task={task}
                mode={mode}
                state={getTaskState(task, activeTasks, queue)}
                progress={getTaskProgress(task, activeTasks, queue)}
                runtimeLabel={activeTask ? getActiveRuntimeLabel(activeTask) : null}
                disabled={disabled}
                disabledReason={
                  disabled
                    ? selectedCoreBusy
                      ? `Core ${selectedCore?.id} busy`
                      : getTaskActionDisabledReason(task, mode)
                    : null
                }
                onRun={() => runTask(task)}
                onInspect={() => setInspectedTaskId(task.id)}
                memoryUnlocked={memoryUnlocked}
              />
            );
          })
        )}
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
    </>
  );
}

function TaskCard({
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
  const cacheBits = getTaskCacheBits(task);
  const ramBits = getTaskRamBits(task);
  const rewards = getTaskRewardCosts(task);
  const commandLabel =
    mode === "scheduler"
      ? "Queue"
      : mode === "core"
        ? "Assign"
        : state === "rerun"
          ? "Rerun"
          : state === "restart"
            ? "Restart"
            : "Run";

  return (
    <article className={`task-card ${task.kind ?? "task"} ${state}`}>
      <div className="task-row-top">
        <strong>{task.name}</strong>
        <TaskStatePill state={state} />
      </div>

      {runtimeLabel ? (
        <small className="task-status-line">{runtimeLabel}</small>
      ) : disabledReason ? (
        <small className="task-status-line">{disabledReason}</small>
      ) : (
        <div className="task-meta-line">
          <span className="ops">
            <strong>{operationCount === undefined ? "·" : formatNumber(operationCount)}</strong> ops
          </span>
          {cacheBits > 0 && <span>cache {formatBits(cacheBits)}</span>}
          {memoryUnlocked && ramBits > 0 && <span>ram {formatBits(ramBits)}</span>}
          {rewards.length > 0 && <ResourceCost costs={rewards} compact />}
        </div>
      )}

      <span className="task-progress" aria-hidden="true">
        <span style={{ width: `${progress * 100}%` }} />
      </span>

      <div className="task-action-row">
        <button
          type="button"
          className="task-run-button"
          disabled={disabled}
          onClick={onRun}
        >
          <Play size={11} />
          <span>{commandLabel}</span>
        </button>
        <button
          type="button"
          className="task-inspect-button"
          onClick={onInspect}
          title={`Inspect ${task.name}`}
          aria-label={`Inspect ${task.name}`}
        >
          <Eye size={13} />
        </button>
      </div>
    </article>
  );
}

function TaskStatePill({ state }: { state: TaskState }) {
  const label =
    state === "active"
      ? "Active"
      : state === "waiting"
        ? "Wait"
        : state === "rerun"
          ? "Rerun"
          : state === "restart"
            ? "Restart"
            : state === "locked"
              ? "Locked"
              : "Ready";

  return <small className={`task-state-pill ${state}`}>{label}</small>;
}

/* ============ RESEARCH PANEL ============ */

export function ResearchPanel({
  visible,
  dispatch,
}: {
  visible: VisibleState;
  dispatch: Dispatch;
}) {
  const research = getResearch(visible);
  const [hideCompleted, setHideCompleted] = useState(true);
  const visibleResearch = hideCompleted
    ? research.filter((item) => !isResearchPurchased(item))
    : research;
  const openCount = research.filter((item) => !isResearchPurchased(item)).length;

  return (
    <>
      <div className="panel-header">
        <Activity size={14} />
        <span>Research</span>
        <small>{openCount}</small>
        <label className="research-filter-toggle">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(event) => setHideCompleted(event.target.checked)}
          />
          <span>Hide built</span>
        </label>
      </div>
      <div className="panel-body">
        {visibleResearch.length === 0 ? (
          <div className="research-empty">
            {research.length > 0 && hideCompleted ? "No open research" : "Nothing to research"}
          </div>
        ) : (
          visibleResearch.map((item) => (
            <ResearchAction key={item.id} research={item} dispatch={dispatch} />
          ))
        )}
      </div>
    </>
  );
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
  if (kind === "hardware") return "HW";
  if (kind === "task") return "Task";
  return "Req";
};

const isResearchComputeComplete = (task: UiResearchComputeTask) =>
  Boolean(task.completed || getTaskCompletedCount(task) > 0);

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
          <em className="research-cost-line">
            {purchased ? "Built" : <ResourceCost costs={costs} compact />}
          </em>
        </span>
        <button
          type="button"
          className="research-buy-button"
          disabled={!canBuy}
          onClick={() => dispatch({ type: "buyResearch", researchId: research.id })}
        >
          {purchased ? <CheckCircle2 size={12} /> : <Plus size={12} />}
          <span>{purchased ? "Built" : "Buy"}</span>
        </button>
      </div>

      {requirements.length > 0 && !purchased && (
        <div className="research-requirements" aria-label={`${research.name} requirements`}>
          {requirements.map((item) => (
            <span
              className={`research-requirement ${item.met ? "met" : "open"}`}
              key={item.id}
            >
              <b>{item.met ? "✓" : getResearchRequirementTag(item.kind)}</b>
              <small>{item.label}</small>
            </span>
          ))}
        </div>
      )}

      {computeTasks.length > 0 && !purchased && (
        <div className="research-compute-list">
          {computeTasks.map((task) => {
            const completed = isResearchComputeComplete(task);
            const active = Boolean(task.active);
            const canStart = getTaskCanStart(task);
            const disabled = completed || active || !canStart;

            return (
              <div className="research-compute" key={task.id}>
                <span className="research-compute-copy">
                  <strong>{task.name}</strong>
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
                  <Play size={11} />
                  <span>
                    {completed ? "Done" : active ? "···" : task.canQueue ? "Queue" : "Run"}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

/* ============ DAG MODAL ============ */

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
  const assignedCores =
    activeTask?.assignedCoreIds ??
    [activeTask?.coreId].filter((coreId): coreId is number => typeof coreId === "number");
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
      ? "Load → Compute"
      : "Direct";
  const coreNote =
    assignedCores.length > 0
      ? `Cores ${assignedCores.join(", ")}`
      : `${formatNumber(requiredCores)}×`;
  const payoutRewards = getTaskRewardCosts(task);
  const payoutNote =
    payoutRewards.length > 0 ? (
      <span className="payout-note">
        <ResourceCost costs={payoutRewards} compact />
      </span>
    ) : (
      "None"
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
            <X size={15} />
          </button>
        </div>

        <div className="task-dag-summary" aria-label="Task runtime summary">
          <DagSummaryTile label="Progress" value={formatPercent(progress)} meter={progress} />
          <DagSummaryTile label="Load" value={loadNote} />
          <DagSummaryTile label="Cores" value={coreNote} />
          <DagSummaryTile label="Payout" value={payoutNote} />
          <DagSummaryTile
            label="Cache"
            value={`${formatBits(getTaskCacheBits(task))} · ${getFitLabel(task, visible, "cache")}`}
          />
          {memoryUnlocked && (
            <DagSummaryTile
              label="RAM"
              value={
                reservedBits > 0
                  ? `${formatBits(reservedBits)} reserved`
                  : `${formatBits(getTaskRamBits(task))} · ${getFitLabel(task, visible, "ram")}`
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
          {memoryActions.length > 0 && <span>{memoryActions.join("/")}</span>}
          <span>{formatBits(getNodeCacheBits(node))} cache</span>
          {memoryUnlocked && <span>{formatBits(getNodeRamBits(node))} ram</span>}
        </div>
        <small>
          {dependencies.length > 0 ? dependencies.join(", ") : dependencyHint ?? "Root"}
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
              dependencyHint={index === 0 ? "Start" : `After ${children[index - 1]?.name ?? "previous"}`}
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
  if (need <= 0) return "n/a";

  const capacity =
    kind === "cache" ? getVisibleCacheBits(visible) : getVisibleRamBits(visible);
  if (capacity > need) return "fits+";
  if (capacity === need) return "fits";
  return "over";
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

/* ============ METERS / CACHE BARS ============ */

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

const cacheStateLabels: Array<{ state: CacheSegmentState; label: string }> = [
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
