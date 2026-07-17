import type { VisibleCore, VisibleCpuSocket, VisibleState } from "../../game";
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
  getVisibleSystemSchedulerSlots,
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

const getTaskFromQueueEntry = (entry: UiQueueEntry): UiTask | undefined => {
  if (typeof entry === "string") return undefined;
  if (!entry.taskId && !entry.id) return undefined;

  return {
    id: entry.taskId ?? entry.id ?? "",
    name: entry.name ?? entry.taskId ?? entry.id ?? "",
    category: entry.category,
    cacheNeedBits: entry.cacheNeedBits,
    ramNeedBits: entry.ramNeedBits,
    requiredCores: entry.requiredCores,
  };
};

const getCoreSchedulerEntries = (core: VisibleCore): UiQueueEntry[] => {
  const entryQueue = core.scheduler?.localQueueEntries;
  return entryQueue && entryQueue.length > 0
    ? (entryQueue as UiQueueEntry[])
    : ((core.scheduler?.localQueue ?? []) as UiQueueEntry[]);
};

const getRamPendingReason = (visible: VisibleState, task: UiTask | undefined) => {
  if (!task) return null;
  return getTaskRamBits(task) > getVisibleAvailableRamBits(visible)
    ? "Waiting for RAM."
    : null;
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

  const availableCacheBits = Math.max(0, socket.cacheBits - socket.cacheUsedBits);
  if (getTaskCacheBits(task) > availableCacheBits) {
    return "Waiting for CPU cache.";
  }

  const ramPendingReason = getRamPendingReason(visible, task);
  if (!isSystemQueueTask(task) && ramPendingReason) return ramPendingReason;

  if (isSystemQueueTask(task) && ramPendingReason) return ramPendingReason;

  return "Waiting for CPU scheduler dispatch.";
};

const getCpuQueueReservationMap = (visible: VisibleState) => {
  const occurrences = new Map<string, number>();
  const reservations = new Map<string, VisibleCpuSocket>();
  const tasksById = new Map(getQueueLookupTasks(visible).map((task) => [task.id, task]));

  visible.metrics.cpuSockets.forEach((socket) => {
    const entries = socket.cores.flatMap(getCoreSchedulerEntries);

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const taskId = getQueueTaskId(entry);
      if (typeof entry !== "string" && entry.parentQueueEntryId) {
        reservations.set(entry.parentQueueEntryId, socket);
      }
      const occurrence = occurrences.get(taskId) ?? 0;
      const requiredSlots = Math.max(
        1,
        getRequiredCoreCount(tasksById.get(taskId)),
      );

      occurrences.set(taskId, occurrence + 1);
      reservations.set(`${taskId}:${occurrence}`, socket);
      index += requiredSlots - 1;
    }
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

  const ramPendingReason = getRamPendingReason(visible, task);
  if (ramPendingReason) return ramPendingReason;

  const compatibleSockets = visible.metrics.cpuSockets.filter((socket) => {
    const requiredCores = getRequiredCoreCount(task);
    return (
      socket.cacheBits >= getTaskCacheBits(task) &&
      socket.schedulerSlots >= requiredCores
    );
  });
  if (compatibleSockets.length > 0) {
    const requiredCores = getRequiredCoreCount(task);
    const socketWithSlot = compatibleSockets.find(
      (socket) => getSocketAvailableSchedulerSlots(socket) >= requiredCores,
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

const getActiveTaskByReservationMap = (activeTasks: UiActiveTask[]) =>
  new Map(
    activeTasks
      .map((activeTask) => [activeTask.queueEntryId, activeTask] as const)
      .filter((entry): entry is [string, UiActiveTask] => Boolean(entry[0])),
  );

const getActiveTaskByParentQueueEntryMap = (activeTasks: UiActiveTask[]) =>
  new Map(
    activeTasks
      .map((activeTask) => [activeTask.parentQueueEntryId, activeTask] as const)
      .filter((entry): entry is [string, UiActiveTask] => Boolean(entry[0])),
  );

const expandCpuSchedulerActiveSlots = (activeTasks: UiActiveTask[]) =>
  activeTasks.flatMap((activeTask) =>
    Array.from(
      { length: Math.max(1, activeTask.assignedCoreIds?.length ?? 1) },
      () => activeTask,
    ),
  );

const getQueueDisplayItem = (
  entry: UiQueueEntry,
  tasksById: Map<string, UiTask>,
  activeTask: UiActiveTask | undefined,
  pendingReason?: string,
): UiQueueDisplayItem | null => {
  const taskId = getQueueTaskId(entry);
  const task = tasksById.get(taskId) ?? getTaskFromQueueEntry(entry);
  const entryName = typeof entry !== "string" ? entry.name : undefined;
  const parentName = typeof entry !== "string" ? entry.parentTaskName : undefined;
  const name =
    entryName && parentName ? `${entryName} -> ${parentName}` : entryName ?? task?.name ?? taskId;
  const cancelTaskId =
    typeof entry !== "string" ? entry.parentTaskId ?? entry.taskId ?? entry.id : taskId;

  if (!name) return null;

  return {
    id: taskId || name,
    cancelTaskId,
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
  const activeByReservation = getActiveTaskByReservationMap(activeTasks);
  const activeByParentQueueEntry = getActiveTaskByParentQueueEntryMap(activeTasks);
  const queueOccurrences = new Map<string, number>();
  const keyCounts = new Map<string, number>();

  return entries
    .map((entry) => {
      const taskId = getQueueTaskId(entry);
      const occurrence = queueOccurrences.get(taskId) ?? 0;
      queueOccurrences.set(taskId, occurrence + 1);

      const activeTask =
        typeof entry !== "string" && entry.reservationId
          ? activeByReservation.get(entry.reservationId) ??
            activeByReservation.get(entry.id ?? "")
          : typeof entry !== "string" && entry.id
            ? activeByParentQueueEntry.get(entry.id) ??
              activeByOccurrence.get(`${taskId}:${occurrence}`)
            : activeByOccurrence.get(`${taskId}:${occurrence}`);

      const item = getQueueDisplayItem(
        entry,
        tasksById,
        activeTask,
        getPendingReason?.(
          entry,
          occurrence,
          tasksById.get(taskId) ?? getTaskFromQueueEntry(entry),
          activeTask,
        ),
      );
      if (!item) return null;

      // Render identity: prefer the queue entry / reservation / instance id
      // (stable for the entry's lifetime); legacy string entries fall back to
      // the taskId. Duplicate expansions of the same identity (multi-slot
      // reservations) get a per-identity suffix so keys stay unique.
      const identity =
        (typeof entry !== "string"
          ? String(entry.id ?? entry.reservationId ?? "")
          : "") ||
        activeTask?.instanceId ||
        item.id;
      const duplicateIndex = keyCounts.get(identity) ?? 0;
      keyCounts.set(identity, duplicateIndex + 1);

      return {
        ...item,
        key: duplicateIndex === 0 ? identity : `${identity}#${duplicateIndex}`,
      };
    })
    .filter(hasValue);
};

const getQueueLookupTasks = (visible: VisibleState) => [
  ...getTasks(visible),
  ...getResearch(visible).flatMap((research) => research.computeTasks ?? []),
];

const normalizeBlockedReason = (reason: string) =>
  reason === "Waiting for CPU scheduler dispatch."
    ? "CPU scheduler has not accepted child work."
    : reason;

const isUsefulBlockedReason = (reason: string) =>
  ![
    "Waiting for scheduler dispatch.",
    "Waiting for system scheduler dispatch.",
  ].includes(reason);

const uniqueReasons = (reasons: string[]) =>
  Array.from(
    new Set(
      reasons
        .map((reason) => normalizeBlockedReason(reason.trim()))
        .filter((reason) => reason.length > 0 && isUsefulBlockedReason(reason)),
    ),
  );

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
    const entries = socket.cores.flatMap(getCoreSchedulerEntries);

    return getQueueDisplayItemsFromEntries(
      entries,
      tasksById,
      expandCpuSchedulerActiveSlots(socketActiveTasks),
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
  const systemActiveTasks = getActiveTasks(visible).filter((task) => {
    if (!task.schedulerQueued) return false;
    if (task.parentTaskId) return true;
    return isSystemQueueTask(tasksById.get(task.taskId ?? ""));
  });
  const entries = getQueueEntries(visible).filter((entry) =>
    isSystemQueueTask(tasksById.get(getQueueTaskId(entry))),
  );

  return getQueueDisplayItemsFromEntries(
    entries,
    tasksById,
    systemActiveTasks,
    (entry, occurrence, task, activeTask) => {
      if (activeTask) return undefined;

      const socket =
        typeof entry !== "string" && entry.id
          ? cpuReservations.get(entry.id) ??
            cpuReservations.get(`${getQueueTaskId(entry)}:${occurrence}`)
          : cpuReservations.get(`${getQueueTaskId(entry)}:${occurrence}`);
      return socket
        ? getCpuSchedulerPendingReason(visible, task, socket)
        : getSystemSchedulerPendingReason(visible, task);
    },
  );
};

export const getSystemSchedulerBlockedReasons = (
  visible: VisibleState,
  queueItems = getSystemQueueDisplayItems(visible),
) => {
  const pendingReasons = uniqueReasons(
    queueItems
      .filter((item) => !item.active)
      .map((item) => item.waitingReason),
  );
  if (pendingReasons.length > 0) return pendingReasons;

  const slotCapacity = getVisibleSystemSchedulerSlots(visible);
  if (slotCapacity <= 0 || queueItems.length < slotCapacity) return [];

  return uniqueReasons(
    getQueueLookupTasks(visible)
      .filter(isSystemQueueTask)
      .map((task) => task.queueBlockedReason?.trim() ?? ""),
  );
};

