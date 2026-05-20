import { Eye, Pin, PinOff, Play } from "lucide-react";
import { formatBits, formatNumber } from "../format";
import { ResourceCost } from "../ResourceTokens";
import {
  getRequiredCoreCount,
  getTaskCacheBits,
  getTaskOperationCount,
  getTaskRamBits,
  getTaskRewardCosts,
  isElasticTask,
} from "./taskData";
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
  pinned = false,
  onTogglePin,
}: TaskCardProps) {
  const operationCount = getTaskOperationCount(task);
  const cacheBits = getTaskCacheBits(task);
  const ramBits = getTaskRamBits(task);
  const requiredCores = getRequiredCoreCount(task);
  const rewards = getTaskRewardCosts(task);
  const commandLabel =
    mode === "systemScheduler" ? "Schedule" : mode === "scheduler" ? "Queue" : "Assign";
  const buttonLabel = disabled && disabledReason ? disabledReason : commandLabel;
  const cardState = state === "deadlock" ? "active" : state;

  return (
    <article className={`task-card ${task.kind ?? "task"} ${cardState}`}>
      <div className="task-row-top">
        <strong>{task.name}</strong>
        {onTogglePin && (
          <button
            type="button"
            className={`task-pin-button ${pinned ? "pinned" : ""}`}
            onClick={onTogglePin}
            title={pinned ? `Unpin ${task.name}` : `Pin ${task.name}`}
            aria-label={pinned ? `Unpin ${task.name}` : `Pin ${task.name}`}
            aria-pressed={pinned}
          >
            {pinned ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
        )}
      </div>

      <div className="task-meta-line">
        <span className="ops">
          <strong>
            {operationCount === undefined ? "-" : formatNumber(operationCount)}
          </strong>{" "}
          ops
        </span>
        {isElasticTask(task) ? (
          <span>uses idle cores</span>
        ) : (
          requiredCores > 1 && <span>{formatNumber(requiredCores)} cores</span>
        )}
        {cacheBits > 0 && <span>cache {formatBits(cacheBits)}</span>}
        {(memoryUnlocked || ramBits > 0) && ramBits > 0 && (
          <span>ram {formatBits(ramBits)}</span>
        )}
        {rewards.length > 0 && <ResourceCost costs={rewards} compact />}
      </div>

      <div className="task-action-row">
        <button
          type="button"
          className={`task-run-button ${disabledReason ? "blocked" : ""}`}
          disabled={disabled}
          onClick={onRun}
          title={buttonLabel}
        >
          {!disabledReason && <Play size={11} />}
          <span>{buttonLabel}</span>
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
