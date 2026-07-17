import { Eye, Pin, PinOff, Play } from "lucide-react";
import { formatNumber } from "../format";
import { ResourceCost } from "../ResourceTokens";
import { PressRepeatButton } from "./PressRepeatButton";
import { getTaskRewardCosts } from "./taskData";
import { TaskMetaLine } from "./TaskMetaLine";
import type { QueueMode, TaskState, UiTask } from "./taskTypes";

interface TaskCardProps {
  task: UiTask;
  mode: QueueMode;
  state: TaskState;
  disabled: boolean;
  disabledReason: string | null;
  onRun: () => void;
  onInspect: () => void;
  memoryUnlocked: boolean;
  holdRepeatMs: number;
  holdMaxMs: number;
  pinned?: boolean;
  onTogglePin?: () => void;
}

export function TaskCard({
  task,
  mode,
  state,
  disabled,
  disabledReason,
  onRun,
  onInspect,
  memoryUnlocked,
  holdRepeatMs,
  holdMaxMs,
  pinned = false,
  onTogglePin,
}: TaskCardProps) {
  const rewards = getTaskRewardCosts(task);
  const commandLabel =
    mode === "systemScheduler" ? "Schedule" : mode === "scheduler" ? "Queue" : "Assign";
  const buttonLabel = disabled && disabledReason ? disabledReason : commandLabel;
  const cardState = state === "deadlock" ? "active" : state;
  const isBlocked = Boolean(disabledReason);

  const paidWorkTitle =
    typeof task.paidWorkUnits === "number"
      ? `Payout from ${formatNumber(task.paidWorkUnits)} paid work units`
      : "Rewards";

  return (
    <article
      className={`task-card ${task.kind ?? "task"} ${cardState} ${
        isBlocked ? "is-blocked" : ""
      }`}
    >
      <div className="task-card-head">
        {onTogglePin && (
          <button
            type="button"
            className={`task-pin-button ${pinned ? "pinned" : ""}`}
            onClick={onTogglePin}
            title={pinned ? `Unpin ${task.name}` : `Pin ${task.name}`}
            aria-label={pinned ? `Unpin ${task.name}` : `Pin ${task.name}`}
            aria-pressed={pinned}
          >
            {pinned ? <PinOff size={11} /> : <Pin size={11} />}
          </button>
        )}
        <strong className="task-name" title={task.name}>
          {task.name}
        </strong>
        {rewards.length > 0 && (
          <span className="task-rewards" title={paidWorkTitle}>
            <ResourceCost costs={rewards} compact />
          </span>
        )}
        <button
          type="button"
          className="task-inspect-button"
          onClick={onInspect}
          title={`Inspect ${task.name}`}
          aria-label={`Inspect ${task.name}`}
        >
          <Eye size={12} />
        </button>
      </div>

      <TaskMetaLine task={task} memoryUnlocked={memoryUnlocked} />

      <PressRepeatButton
        className={`task-run-button ${isBlocked ? "blocked" : ""}`}
        disabled={disabled}
        onPress={onRun}
        repeatMs={holdRepeatMs}
        maxHoldMs={holdMaxMs}
        // The visible label clips to the fixed action row; the full blocker
        // reason stays readable here.
        title={isBlocked ? disabledReason ?? undefined : `${commandLabel} ${task.name}`}
        aria-label={
          isBlocked && disabledReason
            ? `${task.name}: ${disabledReason}`
            : `${commandLabel} ${task.name}`
        }
      >
        {!isBlocked && <Play size={11} />}
        <span>{buttonLabel}</span>
      </PressRepeatButton>
    </article>
  );
}
