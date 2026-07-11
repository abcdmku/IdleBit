import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { VisibleState } from "../../game";
import type { Dispatch } from "../uiActions";
import type { SelectedComponent } from "../workbenchData";
import { TaskCard } from "./TaskCard";
import { TaskDagModal } from "./TaskDagModal";
import {
  dispatchRunTask,
  getActiveTaskFor,
  getActiveTasks,
  getCoreActiveTask,
  getQueueEntries,
  getTaskActionDisabledReason,
  getTaskCanUseAction,
  getTaskCategory,
  getTasks,
  getTaskState,
  hasSystemMemory,
  resolveTaskRoute,
  taskGroups,
} from "./taskData";
import {
  TaskBayRoutePicker,
  getRouteTargetLabel,
} from "./TaskRoutePicker";
import type { TaskCategoryId, UiTask } from "./taskTypes";

export function TaskBay({
  visible,
  selectedComponent,
  onSelectComponent,
  dispatch,
  pinnedTaskIds = [],
  onTogglePinnedTask,
  embedded = false,
}: {
  visible: VisibleState;
  selectedComponent: SelectedComponent;
  onSelectComponent?: (component: SelectedComponent) => void;
  dispatch: Dispatch;
  pinnedTaskIds?: string[];
  onTogglePinnedTask?: (taskId: string) => void;
  embedded?: boolean;
}) {
  const tasks = getTasks(visible);
  const activeTasks = getActiveTasks(visible);
  const queue = getQueueEntries(visible);
  const [inspectedTaskId, setInspectedTaskId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<TaskCategoryId>>(
    () => new Set(),
  );
  const inspectedTask = tasks.find((task) => task.id === inspectedTaskId) ?? null;
  const memoryUnlocked = hasSystemMemory(visible);
  const holdRepeatMs = visible.input?.taskHoldRepeatMs ?? 110;
  const holdMaxMs = visible.input?.taskHoldMaxMs ?? 30_000;
  const groupedTasks = taskGroups
    .map((group) => ({
      ...group,
      tasks: tasks.filter((task) => getTaskCategory(task) === group.id),
    }))
    .filter((group) => group.tasks.length > 0);
  const presentCategories = new Set<TaskCategoryId>(
    groupedTasks.map((group) => group.id),
  );

  const toggleGroup = (id: TaskCategoryId) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runTask = (task: UiTask) =>
    dispatchRunTask(task, visible, selectedComponent, dispatch);

  return (
    <>
      <div className={embedded ? "work-jobs-content" : "panel-body"}>
        {tasks.length === 0 && (
          <div className="research-empty">No tasks available</div>
        )}
        {tasks.length > 0 && onSelectComponent && (
          <TaskBayRoutePicker
            visible={visible}
            categories={presentCategories}
            selection={selectedComponent}
            onSelectComponent={onSelectComponent}
          />
        )}
        {tasks.length > 0 &&
          groupedTasks.map((group) => {
            const collapsed = collapsedGroups.has(group.id);
            const groupRoute = resolveTaskRoute(
              visible,
              selectedComponent,
              group.id,
            );
            const groupMode = groupRoute.mode;
            const groupCoreBusy =
              groupMode === "core" &&
              Boolean(
                groupRoute.selectedCore && getCoreActiveTask(groupRoute.selectedCore),
              );
            const groupTargetLabel = getRouteTargetLabel(visible, groupRoute);

            return (
              <section
                className={`task-group ${collapsed ? "collapsed" : ""}`}
                key={group.id}
              >
                <div className="task-group-title">
                  <button
                    type="button"
                    className="task-group-toggle"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={!collapsed}
                    aria-label={
                      collapsed ? `Expand ${group.label}` : `Collapse ${group.label}`
                    }
                  >
                    {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <span>{group.label}</span>
                    <small>{group.tasks.length}</small>
                  </button>
                </div>
                {!collapsed &&
                  group.tasks.map((task, taskIndex) => {
                    const canStart = getTaskCanUseAction(task, groupMode);
                    const disabled = groupCoreBusy || !canStart;

                    return (
                      <TaskCard
                        key={`${group.id}-${task.id}-${taskIndex}`}
                        task={task}
                        mode={groupMode}
                        state={getTaskState(task, activeTasks, queue)}
                        disabled={disabled}
                        disabledReason={
                          disabled
                            ? groupCoreBusy
                              ? `${groupTargetLabel} busy`
                              : getTaskActionDisabledReason(task, groupMode)
                            : null
                        }
                        onRun={() => runTask(task)}
                        onInspect={() => setInspectedTaskId(task.id)}
                        memoryUnlocked={memoryUnlocked}
                        holdRepeatMs={holdRepeatMs}
                        holdMaxMs={holdMaxMs}
                        pinned={pinnedTaskIds.includes(task.id)}
                        onTogglePin={
                          onTogglePinnedTask
                            ? () => onTogglePinnedTask(task.id)
                            : undefined
                        }
                      />
                    );
                  })}
              </section>
            );
          })}
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
