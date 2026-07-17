import type { VisibleCore, VisibleState } from "../../game";
import { formatBits, type DisplayCost } from "../format";
import { getSelectedCoreId, getSelectedSchedulerId } from "../panels/selectionIds";
import { getSystemScopedAction } from "../panels/systemScopedAction";
import { firstBits, firstNumber } from "../panels/uiNumbers";
import type { Dispatch } from "../uiActions";
import {
  getSelectedSystemComponent,
  getSelectedSystemId,
  type SelectedComponent,
} from "../workbenchData";
import type {
  QueueMode,
  TaskCategoryId,
  TaskState,
  UiActiveTask,
  UiCore,
  UiQueueEntry,
  UiResearch,
  UiTask,
  UiTaskGraphNode,
  UiTaskOperation,
  UiTaskVisibleState,
} from "./taskTypes";

const asTaskVisible = (visible: VisibleState) =>
  visible as unknown as UiTaskVisibleState;

const getTaskVisibleHardware = (visible: VisibleState) =>
  visible.hardware as UiTaskVisibleState["hardware"];

export const taskGroups: Array<{ id: TaskCategoryId; label: string }> = [
  { id: "cpu", label: "CPU Bound" },
  { id: "system", label: "System" },
  { id: "distributed", label: "Distributed" },
  { id: "other", label: "Other" },
];

export const hasValue = <T,>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;

export const getTasks = (visible: VisibleState): UiTask[] => {
  const ui = asTaskVisible(visible);
  return ((ui.tasks ?? []) as unknown) as UiTask[];
};

export const getResearch = (visible: VisibleState): UiResearch[] =>
  ((asTaskVisible(visible).research ?? []) as unknown) as UiResearch[];

export const getActiveTasks = (visible: VisibleState): UiActiveTask[] => {
  const ui = asTaskVisible(visible);
  return ((ui.activeTasks ?? []) as unknown) as UiActiveTask[];
};

export const getQueueEntries = (visible: VisibleState): UiQueueEntry[] =>
  ((asTaskVisible(visible).queue ?? []) as unknown) as UiQueueEntry[];

export const getActiveTaskId = (task: UiActiveTask) => task.taskId ?? "";

export const getQueueTaskId = (entry: UiQueueEntry) => {
  if (typeof entry === "string") return entry;
  return entry.taskId ?? entry.id ?? "";
};

export const getCoreActiveTask = (core: VisibleCore) => {
  const uiCore = core as UiCore;
  return uiCore.activeTask ?? null;
};

export const getAllCores = (visible: VisibleState) =>
  visible.metrics.cpuSockets.flatMap((socket) => socket.cores);

export const getOperationCountFromOperations = (operations: UiTaskOperation[]) =>
  operations.reduce((total, operation) => total + (operation.count ?? 1), 0);

const getCycleCountFromOperations = (operations: UiTaskOperation[]) =>
  operations.reduce(
    (total, operation) =>
      total + (operation.cycles ?? operation.requiredCycles ?? 0),
    0,
  );

export const getTaskOperationCount = (task: UiTask) =>
  firstNumber(
    task.requiredCycles,
    task.cycles,
    Array.isArray(task.operations)
      ? getCycleCountFromOperations(task.operations)
      : undefined,
    task.operationCount,
    typeof task.operations === "number" ? task.operations : undefined,
    task.opCount,
    task.requiredOps,
    task.requiredOperations,
    Array.isArray(task.operations)
      ? getOperationCountFromOperations(task.operations)
      : undefined,
  );

export const getNodeCacheBits = (node: UiTaskGraphNode) =>
  firstBits(
    [node.cacheNeedBits, node.cacheBits],
    [node.cacheNeedBytes, node.cacheBytes],
  );

export const getNodeRamBits = (node: UiTaskGraphNode) =>
  firstBits(
    [node.ramNeedBits, node.memoryNeedBits, node.ramBits, node.memoryBits],
    [node.ramNeedBytes, node.memoryNeedBytes, node.ramBytes],
  );

export const getTaskCacheBits = (task: UiTask) => getNodeCacheBits(task);
export const getTaskRamBits = (task: UiTask) => getNodeRamBits(task);

export const getVisibleCacheBits = (visible: VisibleState) => {
  const ui = asTaskVisible(visible);
  const hardware = getTaskVisibleHardware(visible);
  return firstBits(
    [ui.systemStatus?.cacheBits, ui.systemStatus?.cache?.capacityBits, hardware.cacheBits],
    [
      ui.systemStatus?.cacheBytes,
      ui.systemStatus?.cache?.capacityBytes,
      visible.hardware.cacheBytes,
    ],
  );
};

export const getVisibleRamBits = (visible: VisibleState) => {
  const ui = asTaskVisible(visible);
  const hardware = getTaskVisibleHardware(visible);
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

export const getVisibleRamUsedBits = (visible: VisibleState) => {
  const ui = asTaskVisible(visible);
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

export const getVisibleSystemSchedulerSlots = (visible: VisibleState) =>
  Math.max(0, getTaskVisibleHardware(visible).systemSchedulerSlots ?? 0);

export const getVisibleAvailableRamBits = (visible: VisibleState) =>
  Math.max(0, getVisibleRamBits(visible) - getVisibleRamUsedBits(visible));

export const hasSystemMemory = (visible: VisibleState) =>
  visible.flags.systemStats || visible.hardware.secondCpu || getVisibleRamBits(visible) > 0;

export const getTaskCompletedCount = (task: UiTask) =>
  firstNumber(task.completedCount, task.completionCount) ?? (task.completed ? 1 : 0);

export const getTaskLockedReason = (task: UiTask) =>
  task.lockedReason ??
  task.lockReason ??
  task.blockedReason ??
  task.unlockReason ??
  null;

export const getTaskQueueBlockedReason = (task: UiTask) =>
  task.queueBlockedReason ?? (task.canQueue === false ? getTaskLockedReason(task) : null);

const getTaskCanRunNow = (task: UiTask) => {
  if (getTaskLockedReason(task)) return false;
  if (typeof task.canStart === "boolean") return task.canStart;
  if (typeof task.canRun === "boolean") return task.canRun;
  return true;
};

export const getTaskCanStart = (task: UiTask) =>
  getTaskCanRunNow(task) || task.canQueue === true;

export const getTaskCategory = (task: UiTask): TaskCategoryId => {
  if (task.category === "cpu") return "cpu";
  if (task.category === "system") return "system";
  if (task.category === "distributed") return "distributed";
  return "other";
};

export function resolveTaskRoute(
  visible: VisibleState,
  selectedComponent: SelectedComponent,
  category: TaskCategoryId = "cpu",
): {
  mode: QueueMode;
  selectedCore: VisibleCore | null;
  selectedSchedulerId: number | null;
} {
  const routeSelection =
    getSelectedSystemComponent(selectedComponent) ?? ("core:1" as SelectedComponent);

  if (category !== "cpu") {
    return { mode: "systemScheduler", selectedCore: null, selectedSchedulerId: null };
  }

  const allCores = getAllCores(visible);
  const selectedCoreId = getSelectedCoreId(routeSelection);
  const selectedSchedulerId = getSelectedSchedulerId(routeSelection);
  const selectedSystemScheduler =
    routeSelection === "scheduler" && visible.flags.scheduler;
  const selectedCore =
    (selectedCoreId
      ? allCores.find((core) => core.id === selectedCoreId)
      : null) ??
    allCores[0] ??
    null;
  const schedulerCanRoute =
    visible.flags.basicQueue || visible.flags.scheduler || selectedSchedulerId !== null;
  const mode: QueueMode = selectedSystemScheduler
    ? "systemScheduler"
    : selectedSchedulerId && schedulerCanRoute
      ? "scheduler"
      : "core";
  return { mode, selectedCore, selectedSchedulerId };
}

export function dispatchRunTask(
  task: UiTask,
  visible: VisibleState,
  selectedComponent: SelectedComponent,
  dispatch: Dispatch,
) {
  const systemId = getSelectedSystemId(selectedComponent);
  const dispatchTaskAction: Dispatch = (action) =>
    dispatch(getSystemScopedAction(action, systemId));
  const { mode, selectedCore, selectedSchedulerId } = resolveTaskRoute(
    visible,
    selectedComponent,
    getTaskCategory(task),
  );

  if (mode === "core" && selectedCore) {
    dispatchTaskAction({
      type: "startTaskOnCore",
      taskId: task.id,
      coreId: selectedCore.id,
    });
    return;
  }

  if (mode === "scheduler") {
    dispatchTaskAction({
      type: "queueTask",
      taskId: task.id,
      cpuId: selectedSchedulerId ?? undefined,
    });
    return;
  }

  if (mode === "systemScheduler") {
    dispatchTaskAction({
      type: "queueTask",
      taskId: task.id,
    });
    return;
  }

  dispatchTaskAction({ type: "startTask", taskId: task.id });
}

export const getTaskCanUseAction = (task: UiTask, mode: QueueMode) => {
  if (mode === "core") return task.category === "cpu" && getTaskCanRunNow(task);
  if (mode === "scheduler") return task.category === "cpu" && task.canQueue === true;
  if (mode === "systemScheduler") {
    return task.category !== "cpu" && task.canQueue === true;
  }
  return false;
};

export const getTaskActionDisabledReason = (task: UiTask, mode: QueueMode) => {
  if ((mode === "core" || mode === "scheduler") && task.category !== "cpu") {
    return "Use system scheduler";
  }

  if (mode === "systemScheduler" && task.category === "cpu") {
    return "Use CPU scheduler";
  }

  if (mode === "scheduler") {
    return getTaskQueueBlockedReason(task) ?? "Scheduler unavailable";
  }

  if (mode === "systemScheduler") {
    return getTaskQueueBlockedReason(task) ?? "System scheduler unavailable";
  }

  return getTaskLockedReason(task) ?? getTaskQueueBlockedReason(task) ?? "Locked";
};

const taskStateFromText = (value: string | undefined): TaskState | null => {
  const normalized = value?.toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("deadlock")) return "deadlock";
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

export const getTaskState = (
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

export const getActiveRuntimeLabel = (active: UiActiveTask) => {
  const raw = (active.memoryState ?? active.status ?? active.state ?? "").toLowerCase();
  const operation = getActiveCoreRuntime(active);
  const actionVerb = getMemoryActionVerb(operation?.memoryAction);
  const totalCycles = operation?.totalCycles ?? 0;
  const remainingCycles = operation?.remainingCycles ?? totalCycles;
  const completedCycles =
    totalCycles > 0 ? Math.max(0, totalCycles - remainingCycles) : 0;
  const cacheBits = operation?.cacheBits ?? 0;
  const cacheLabel = cacheBits > 0 ? ` ${formatBits(cacheBits)}` : "";

  if (
    raw.includes("deadlock") ||
    active.lockResource ||
    operation?.lockResource
  ) {
    const resource = active.lockResource ?? operation?.lockResource;
    return resource === "cache"
      ? "Deadlock: cache"
      : resource === "ram"
        ? "Deadlock: RAM"
        : "Deadlock";
  }

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

export const getActiveTaskFor = (task: UiTask, activeTasks: UiActiveTask[]) =>
  activeTasks.find((candidate) => getActiveTaskId(candidate) === task.id) ?? null;

export const getTaskRewardCosts = (task: UiTask): DisplayCost[] => {
  const credits = firstNumber(task.rewardCredits, task.rewards?.credits);
  const data = firstNumber(
    task.rewardData,
    task.rewards?.data,
  );
  const costs: DisplayCost[] = [];
  if (credits && credits > 0) costs.push({ resource: "credits", amount: credits });
  if (data && data > 0) costs.push({ resource: "data", amount: data });
  return costs;
};

export const getRequiredCoreCount = (task: UiTask | undefined) =>
  Math.max(1, firstNumber(task?.requiredCores, task?.minCores) ?? 1);

export const isChunkedTask = (task: UiTask | undefined) => task?.coreScaling === "chunked";
