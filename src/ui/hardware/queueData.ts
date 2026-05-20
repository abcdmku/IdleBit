import type { VisibleCpuSocket, VisibleState } from "../../game";
import { clampMeter } from "../panels/uiNumbers";
import {
  getActiveRuntimeLabel,
  getActiveTasks,
  getCoreActiveTask,
  getQueueEntries,
  getQueueTaskId,
  getResearch,
  getRequiredCoreCount,
  getTaskCacheBits,
  getTaskRamBits,
  getTasks,
  getVisibleAvailableRamBits,
  hasValue,
} from "../tasks/taskData";
import type { UiActiveTask, UiQueueEntry, UiTask } from "../tasks/taskTypes";
import type { UiQueueDisplayItem } from "./visibleState";

const getSocketAvailableSchedulerSlots = (socket: VisibleCpuSocket) =>
  Math.max(0, socket.schedulerSlots - socket.queuedCount);

const getSocketIdleCoreCount = (socket: VisibleCpuSocket) =>
  socket.cores.filter((core) => !getCoreActiveTask(core)).length;

const getQueueWaitingReason = (
  task: UiTask | undefined,
  activeTask?: UiActiveTask,
  pendingReason?: string,
) => {
  if (activeTask) return getActiveRuntimeLabel(activeTask);
  return (
    pendingReason?.trim() ||
    task?.blockedReason?.trim() ||
    task?.queueBlockedReason?.trim() ||
    "Waiting for scheduler dispatch."
  );
};

const getCpuSchedulerPendingReason = (
  visible: VisibleState,
  task: UiTask | undefined,
  socket: VisibleCpuSocket,
) => {
  if (!task) return "Waiting for CPU scheduler dispatch.";
  const blockedReason = task.blockedReason?.trim();
  if (blockedReason && !/scheduler slots full/i.test(blockedReason)) {
    return blockedReason;
  }

  if (socket.deadlocked) return "CPU deadlock active.";

  const requiredCores = getRequiredCoreCount(task);
  const idleCores = getSocketIdleCoreCount(socket);
  if (idleCores < requiredCores) {
    return requiredCores > 1
      ? `Needs ${requiredCores} idle cores.`
      : "No idle core available.";
  }

  if (requiredCores > 1 && socket.schedulerSlots < requiredCores) {
    return `CPU scheduler needs ${requiredCores} slots.`;
  }

  if (socket.schedulerConfig.policy === "deadlockSafe") {
    const availableCacheBits = Math.max(0, socket.cacheBits - socket.cacheUsedBits);
    if (getTaskCacheBits(task) > availableCacheBits) {
      return "Waiting for CPU cache.";
    }

    if (!isSystemQueueTask(task) && getTaskRamBits(task) > getVisibleAvailableRamBits(visible)) {
      return "Waiting for RAM.";
    }
  }

  return "Waiting for CPU scheduler dispatch.";
};

const getCpuQueueReservationMap = (visible: VisibleState) => {
  const occurrences = new Map<string, number>();
  const reservations = new Map<string, VisibleCpuSocket>();

  visible.metrics.cpuSockets.forEach((socket) => {
    socket.cores
      .flatMap((core) => core.scheduler?.localQueue ?? [])
      .forEach((taskId) => {
        const occurrence = occurrences.get(taskId) ?? 0;
        occurrences.set(taskId, occurrence + 1);
        reservations.set(`${taskId}:${occurrence}`, socket);
      });
  });

  return reservations;
};

const getSystemSchedulerPendingReason = (
  visible: VisibleState,
  task: UiTask | undefined,
) => {
  if (!task) return "Waiting for system scheduler dispatch.";

  const blockedReason = task.blockedReason?.trim();
  if (blockedReason && !/scheduler slots full/i.test(blockedReason)) {
    return blockedReason;
  }

  if (visible.hardware.systemSchedulerConfig.policy === "deadlockSafe") {
    if (getTaskRamBits(task) > getVisibleAvailableRamBits(visible)) {
      return "Waiting for RAM.";
    }
  }

  const compatibleSockets = visible.metrics.cpuSockets.filter((socket) => {
    const requiredCores = getRequiredCoreCount(task);
    return (
      socket.cacheBits >= getTaskCacheBits(task) &&
      socket.schedulerSlots >= requiredCores
    );
  });
  if (compatibleSockets.length > 0) {
    const socketWithSlot = compatibleSockets.find(
      (socket) => getSocketAvailableSchedulerSlots(socket) > 0,
    );
    if (socketWithSlot) {
      return getCpuSchedulerPendingReason(visible, task, socketWithSlot);
    }

    return "CPU scheduler slots full.";
  }

  return task.queueBlockedReason?.trim() || "Waiting for system scheduler dispatch.";
};

const getActiveTaskOccurrenceMap = (activeTasks: UiActiveTask[]) => {
  const occurrences = new Map<string, number>();
  const activeByOccurrence = new Map<string, UiActiveTask>();

  activeTasks.forEach((activeTask) => {
    const taskId = activeTask.taskId;
    if (!taskId) return;

    const occurrence = occurrences.get(taskId) ?? 0;
    occurrences.set(taskId, occurrence + 1);
    activeByOccurrence.set(`${taskId}:${occurrence}`, activeTask);
  });

  return activeByOccurrence;
};

const getQueueDisplayItem = (
  entry: UiQueueEntry,
  tasksById: Map<string, UiTask>,
  activeTask: UiActiveTask | undefined,
  pendingReason?: string,
): UiQueueDisplayItem | null => {
  const taskId = getQueueTaskId(entry);
  const task = tasksById.get(taskId);
  const entryName = typeof entry !== "string" ? entry.name : undefined;
  const name = entryName ?? task?.name ?? taskId;

  if (!name) return null;

  return {
    id: taskId || name,
    name,
    waitingReason: getQueueWaitingReason(task, activeTask, pendingReason),
    instanceId: activeTask?.instanceId,
    active: Boolean(activeTask),
    progress: clampMeter(activeTask?.progress ?? task?.progress ?? 0),
    deadlocked:
      activeTask?.status === "deadlocked" ||
      activeTask?.memoryState === "deadlock" ||
      Boolean(activeTask?.lockResource),
  };
};

const getQueueDisplayItemsFromEntries = (
  entries: UiQueueEntry[],
  tasksById: Map<string, UiTask>,
  activeTasks: UiActiveTask[],
  getPendingReason?: (
    entry: UiQueueEntry,
    occurrence: number,
    task: UiTask | undefined,
    activeTask: UiActiveTask | undefined,
  ) => string | undefined,
) => {
  const activeByOccurrence = getActiveTaskOccurrenceMap(activeTasks);
  const queueOccurrences = new Map<string, number>();

  return entries
    .map((entry) => {
      const taskId = getQueueTaskId(entry);
      const occurrence = queueOccurrences.get(taskId) ?? 0;
      queueOccurrences.set(taskId, occurrence + 1);

      return getQueueDisplayItem(
        entry,
        tasksById,
        activeByOccurrence.get(`${taskId}:${occurrence}`),
        getPendingReason?.(
          entry,
          occurrence,
          tasksById.get(taskId),
          activeByOccurrence.get(`${taskId}:${occurrence}`),
        ),
      );
    })
    .filter(hasValue);
};

const getQueueLookupTasks = (visible: VisibleState) => [
  ...getTasks(visible),
  ...getResearch(visible).flatMap((research) => research.computeTasks ?? []),
];

export const getQueueDisplayItems = (visible: VisibleState, socket?: VisibleCpuSocket) => {
  const tasksById = new Map(getQueueLookupTasks(visible).map((task) => [task.id, task]));
  const schedulerActiveTasks = getActiveTasks(visible).filter(
    (task) => task.schedulerQueued && task.taskId,
  );

  if (socket) {
    const socketCoreIds = new Set(socket.cores.map((core) => core.id));
    const socketActiveTasks = schedulerActiveTasks.filter((task) =>
      task.assignedCoreIds?.some((coreId) => socketCoreIds.has(coreId)) ||
      socketCoreIds.has(task.coreId),
    );
    const entries = socket.cores.flatMap((core) => core.scheduler?.localQueue ?? []);

    return getQueueDisplayItemsFromEntries(
      entries,
      tasksById,
      socketActiveTasks,
      (_entry, _occurrence, task, activeTask) =>
        activeTask ? undefined : getCpuSchedulerPendingReason(visible, task, socket),
    );
  }

  return getQueueDisplayItemsFromEntries(
    getQueueEntries(visible),
    tasksById,
    schedulerActiveTasks,
  );
};

const isSystemQueueTask = (task: UiTask | undefined) =>
  task?.category === "system" || task?.category === "distributed";

export const getSystemQueueDisplayItems = (visible: VisibleState) => {
  const tasksById = new Map(getQueueLookupTasks(visible).map((task) => [task.id, task]));
  const cpuReservations = getCpuQueueReservationMap(visible);
  const systemActiveTasks = getActiveTasks(visible).filter((task) =>
    task.schedulerQueued && isSystemQueueTask(tasksById.get(task.taskId ?? "")),
  );
  const entries = getQueueEntries(visible).filter((entry) =>
    isSystemQueueTask(tasksById.get(getQueueTaskId(entry))),
  );

  return getQueueDisplayItemsFromEntries(
    entries,
    tasksById,
    systemActiveTasks,
    (entry, occurrence, task, activeTask) => {
      if (activeTask) return undefined;

      const socket = cpuReservations.get(`${getQueueTaskId(entry)}:${occurrence}`);
      return socket
        ? getCpuSchedulerPendingReason(visible, task, socket)
        : getSystemSchedulerPendingReason(visible, task);
    },
  );
};

