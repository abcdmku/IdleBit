import { Cpu, Eye, HardDrive, MemoryStick, Pin, PinOff, Play, Zap } from "lucide-react";
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
  const isBlocked = Boolean(disabledReason);

  const opCountText =
    operationCount === undefined ? "-" : formatNumber(operationCount);
  const cacheText = cacheBits > 0 ? formatBits(cacheBits) : null;
  const showRam = (memoryUnlocked || ramBits > 0) && ramBits > 0;
  const ramText = showRam ? formatBits(ramBits) : null;

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
          <span className="task-rewards" title="Rewards">
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

      <div className="task-meta-line" aria-label="Requirements">
        <span className="meta-need">
          <span
            className="meta-chip ops"
            title={`${opCountText} operations`}
            aria-label={`${opCountText} operations`}
          >
            <Zap size={11} aria-hidden="true" />
            <strong>{opCountText}</strong>
            <em className="sr-only">{" "}ops</em>
          </span>
          {isElasticTask(task) ? (
            <span
              className="meta-chip elastic"
              title="Elastic cores: uses idle cores"
              aria-label="Elastic cores: uses idle cores"
            >
              <Cpu size={11} aria-hidden="true" />
              <span className="elastic-core-symbol" aria-hidden="true">∞</span>
            </span>
          ) : (
            requiredCores > 1 && (
              <span
                className="meta-chip"
                title={`${formatNumber(requiredCores)} cores required`}
                aria-label={`${formatNumber(requiredCores)} cores required`}
              >
                <Cpu size={11} aria-hidden="true" />
                <strong>{formatNumber(requiredCores)}</strong>
                <em className="sr-only">{" "}cores</em>
              </span>
            )
          )}
          {cacheText && (
            <span
              className="meta-chip"
              title={`Cache: ${cacheText}`}
              aria-label={`Cache ${cacheText}`}
            >
              <HardDrive size={11} aria-hidden="true" />
              <em className="sr-only">cache{" "}</em>
              <strong>{cacheText}</strong>
            </span>
          )}
          {ramText && (
            <span
              className="meta-chip"
              title={`RAM: ${ramText}`}
              aria-label={`RAM ${ramText}`}
            >
              <MemoryStick size={11} aria-hidden="true" />
              <em className="sr-only">ram{" "}</em>
              <strong>{ramText}</strong>
            </span>
          )}
        </span>
      </div>

      <button
        type="button"
        className={`task-run-button ${isBlocked ? "blocked" : ""}`}
        disabled={disabled}
        onClick={onRun}
        title={buttonLabel}
      >
        {!isBlocked && <Play size={11} />}
        <span>{buttonLabel}</span>
      </button>
    </article>
  );
}
