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
import type { UiTask } from "./taskTypes";

export function TaskMetaLine({
  task,
  memoryUnlocked,
}: {
  task: UiTask;
  memoryUnlocked: boolean;
}) {
  const operationCount = getTaskOperationCount(task);
  const cacheBits = getTaskCacheBits(task);
  const ramBits = getTaskRamBits(task);
  const requiredCores = getRequiredCoreCount(task);
  const rewards = getTaskRewardCosts(task);

  return (
    <div className="task-meta-line">
      <span className="ops">
        <strong>{operationCount === undefined ? "?" : formatNumber(operationCount)}</strong> ops
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
  );
}
