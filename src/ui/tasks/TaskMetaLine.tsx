import { Cpu, Gauge, HardDrive, MemoryStick, Zap } from "lucide-react";
import { formatBits, formatNumber } from "../format";
import { ResourceCost } from "../ResourceTokens";
import {
  getRequiredCoreCount,
  getTaskCacheBits,
  getTaskOperationCount,
  getTaskRamBits,
  getTaskRewardCosts,
  isChunkedTask,
} from "./taskData";
import type { UiTask } from "./taskTypes";

/** Log-compressed share so ops counts don't drown out small bit needs. */
const mixWeight = (value: number) => (value > 0 ? Math.log2(1 + value) : 0);

/**
 * Single source for a task's requirement readout: a tiny right-aligned
 * icon+number caption cluster over a slim recipe bar whose segments are
 * proportional to the task's cpu (cyan) / cache (green) / ram (violet)
 * work mix. Full wording lives in the chip aria-labels and the Inspect
 * modal; `showRewards` adds payout tokens (ResearchPanel compute rows).
 */
export function TaskMetaLine({
  task,
  memoryUnlocked,
  showRewards = false,
}: {
  task: UiTask;
  memoryUnlocked: boolean;
  showRewards?: boolean;
}) {
  const operationCount = getTaskOperationCount(task);
  const cacheBits = getTaskCacheBits(task);
  const ramBits = getTaskRamBits(task);
  const requiredCores = getRequiredCoreCount(task);
  const rewards = getTaskRewardCosts(task);
  const chunked = isChunkedTask(task);
  const showRam = (memoryUnlocked || ramBits > 0) && ramBits > 0;

  const opCountText =
    operationCount === undefined ? "-" : formatNumber(operationCount);
  const cacheText = cacheBits > 0 ? formatBits(cacheBits) : null;
  const ramText = showRam ? formatBits(ramBits) : null;
  // The ops chip counts operation INVOCATIONS; the actual paid work volume
  // (executed cycles + transferred bits — what the payout and duration derive
  // from) can be ~12x larger, so it gets its own chip when it differs.
  const paidWorkUnits =
    typeof task.paidWorkUnits === "number" && task.paidWorkUnits > 0
      ? task.paidWorkUnits
      : null;
  const showPaidWork =
    paidWorkUnits !== null && paidWorkUnits !== (operationCount ?? 0);

  const cpuWeight = mixWeight(operationCount ?? 0);
  const cacheWeight = mixWeight(cacheBits);
  const ramWeight = showRam ? mixWeight(ramBits) : 0;
  const mixTotal = cpuWeight + cacheWeight + ramWeight;
  const mixTitle = [
    `CPU ${opCountText} ops`,
    cacheText ? `cache ${cacheText}` : null,
    ramText ? `RAM ${ramText}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="task-meta-line" aria-label="Requirements">
      {showRewards && rewards.length > 0 && (
        <span className="meta-rewards" title="Rewards">
          <ResourceCost costs={rewards} compact />
        </span>
      )}
      <span className="meta-need">
        <span
          className="meta-chip ops"
          title={`${opCountText} operation invocations`}
          aria-label={`${opCountText} operation invocations`}
        >
          <Zap size={11} aria-hidden="true" />
          <strong>{opCountText}</strong>
        </span>
        {showPaidWork && (
          <span
            className="meta-chip work"
            title={`${formatNumber(paidWorkUnits)} paid work units (executed cycles + transferred bits)`}
            aria-label={`${formatNumber(paidWorkUnits)} paid work units`}
          >
            <Gauge size={11} aria-hidden="true" />
            <strong>{formatNumber(paidWorkUnits)}</strong>
          </span>
        )}
        {chunked ? (
          <span
            className="meta-chip chunked"
            title={`Chunked work: ${formatNumber(task.workUnitCount ?? 1)} chunks fill idle cores`}
            aria-label={`Chunked work ${formatNumber(task.workUnitCount ?? 1)} chunks`}
          >
            <Cpu size={11} aria-hidden="true" />
            <strong>{formatNumber(task.workUnitCount ?? 1)}</strong>
          </span>
        ) : (
          requiredCores > 1 && (
            <span
              className="meta-chip cores"
              aria-label={`${formatNumber(requiredCores)} cores required`}
            >
              <Cpu size={11} aria-hidden="true" />
              <strong>{formatNumber(requiredCores)}</strong>
            </span>
          )
        )}
        {cacheText && (
          <span className="meta-chip cache" aria-label={`Cache ${cacheText}`}>
            <HardDrive size={11} aria-hidden="true" />
            <strong>{cacheText}</strong>
          </span>
        )}
        {ramText && (
          <span className="meta-chip ram" aria-label={`RAM ${ramText}`}>
            <MemoryStick size={11} aria-hidden="true" />
            <strong>{ramText}</strong>
          </span>
        )}
      </span>
      <span
        className={`task-recipe-bar${mixTotal > 0 ? "" : " empty"}`}
        title={`Work mix: ${mixTitle}`}
        aria-hidden="true"
      >
        {cpuWeight > 0 && (
          <span className="recipe-seg cpu" style={{ flexGrow: cpuWeight }} />
        )}
        {cacheWeight > 0 && (
          <span className="recipe-seg cache" style={{ flexGrow: cacheWeight }} />
        )}
        {ramWeight > 0 && (
          <span className="recipe-seg ram" style={{ flexGrow: ramWeight }} />
        )}
      </span>
    </div>
  );
}
