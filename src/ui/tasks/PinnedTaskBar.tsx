import { useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Pin, PinOff, Play, X } from "lucide-react";
import type { VisibleState } from "../../game";
import type { Dispatch } from "../uiActions";
import type { SelectedComponent } from "../workbenchData";
import { PressRepeatButton } from "./PressRepeatButton";
import {
  dispatchRunTask,
  getCoreActiveTask,
  getTaskActionDisabledReason,
  getTaskCanUseAction,
  getTasks,
  hasValue,
  resolveTaskRoute,
} from "./taskData";
import type { TaskState } from "./taskTypes";

export function PinnedTaskBar({
  visible,
  pinnedTaskIds,
  onUnpinTask,
  onClearPinnedTasks,
  dispatch,
  selectedComponent,
  variant = "floating",
}: {
  visible: VisibleState;
  pinnedTaskIds: string[];
  onUnpinTask: (taskId: string) => void;
  onClearPinnedTasks: () => void;
  dispatch: Dispatch;
  selectedComponent: SelectedComponent;
  variant?: "embedded" | "floating";
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);

  if (pinnedTaskIds.length === 0) return null;

  const tasks = getTasks(visible);

  const pinned = pinnedTaskIds
    .map((id) => tasks.find((task) => task.id === id))
    .filter(hasValue);

  if (pinned.length === 0) return null;

  const { mode: routeMode, selectedCore: routeSelectedCore } = resolveTaskRoute(
    visible,
    selectedComponent,
  );
  const routeCoreBusy =
    routeMode === "core" &&
    Boolean(routeSelectedCore && getCoreActiveTask(routeSelectedCore));

  return (
    <aside
      className={`pinned-task-bar ${variant} ${expanded ? "expanded" : "collapsed"} ${
        editing ? "editing" : ""
      }`}
      aria-label="Pinned tasks"
    >
      <header className="pinned-task-bar-header">
        <button
          type="button"
          className="pinned-task-bar-toggle"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse pinned tasks" : "Expand pinned tasks"}
        >
          <Pin size={11} />
          <span className="pinned-task-bar-count">{pinned.length}</span>
          <span className="pinned-task-bar-label">Pinned</span>
          {expanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
        {expanded && (
          <button
            type="button"
            className={`pinned-task-bar-edit ${editing ? "active" : ""}`}
            onClick={() => setEditing((prev) => !prev)}
            aria-pressed={editing}
            title={editing ? "Done editing" : "Edit pins"}
            aria-label={editing ? "Done editing pinned tasks" : "Edit pinned tasks"}
          >
            <Pencil size={11} />
          </button>
        )}
        {editing && (
          <button
            type="button"
            className="pinned-task-bar-clear"
            onClick={onClearPinnedTasks}
            title="Unpin all"
            aria-label="Unpin all tasks"
          >
            <X size={12} />
          </button>
        )}
      </header>
      {expanded && (
        <ul className="pinned-task-bar-body">
          {pinned.map((task) => {
            const canUseRoute = getTaskCanUseAction(task, routeMode) === true;
            const disabled = routeCoreBusy || !canUseRoute;
            const disabledReason = disabled
              ? routeCoreBusy
                ? "Core busy"
                : getTaskActionDisabledReason(task, routeMode)
              : null;
            const commandLabel =
              routeMode === "systemScheduler"
                ? "Schedule"
                : routeMode === "scheduler"
                  ? "Queue"
                  : "Assign";
            const buttonLabel =
              disabled && disabledReason ? disabledReason : commandLabel;
            const rowState: TaskState = disabledReason ? "locked" : "ready";

            return (
              <li className={`pinned-task-row ${rowState}`} key={task.id}>
                {editing && (
                  <button
                    type="button"
                    className="pinned-task-unpin"
                    onClick={() => onUnpinTask(task.id)}
                    title={`Unpin ${task.name}`}
                    aria-label={`Unpin ${task.name}`}
                  >
                    <PinOff size={11} />
                  </button>
                )}
                <strong className="pinned-task-name">{task.name}</strong>
                <PressRepeatButton
                  className={`pinned-task-action ${disabledReason ? "blocked" : ""}`}
                  disabled={disabled}
                  onPress={() =>
                    dispatchRunTask(task, visible, selectedComponent, dispatch)
                  }
                  title={buttonLabel}
                >
                  {!disabledReason && <Play size={10} />}
                  <span>{buttonLabel}</span>
                </PressRepeatButton>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
