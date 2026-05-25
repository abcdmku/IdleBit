import { useState } from "react";
import { Activity, CheckCircle2, Play, Plus } from "lucide-react";
import type { VisibleState } from "../../game";
import { ModuleMeter } from "../hardware/meters";
import { ResourceCost } from "../ResourceTokens";
import type { Dispatch } from "../uiActions";
import { TaskMetaLine } from "./TaskMetaLine";
import {
  getResearch,
  getTaskCanStart,
  getTaskCompletedCount,
  getTaskLockedReason,
  getTaskQueueBlockedReason,
  hasSystemMemory,
} from "./taskData";
import type { UiResearch, UiResearchComputeTask } from "./taskTypes";

export function ResearchPanel({
  visible,
  dispatch,
}: {
  visible: VisibleState;
  dispatch: Dispatch;
}) {
  const research = getResearch(visible);
  const [hideCompleted, setHideCompleted] = useState(true);
  const visibleResearch = hideCompleted
    ? research.filter((item) => !isResearchPurchased(item))
    : research;
  const openCount = research.filter((item) => !isResearchPurchased(item)).length;

  return (
    <>
      <div className="panel-header">
        <Activity size={14} />
        <span>Research</span>
        <small>{openCount}</small>
        <label className="research-filter-toggle">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(event) => setHideCompleted(event.target.checked)}
          />
          <span>Hide built</span>
        </label>
      </div>
      <div className="panel-body">
        {visibleResearch.length === 0 ? (
          <div className="research-empty">
            {research.length > 0 && hideCompleted ? "No open research" : "Nothing to research"}
          </div>
        ) : (
          visibleResearch.map((item) => (
            <ResearchAction
              key={item.id}
              research={item}
              memoryUnlocked={hasSystemMemory(visible)}
              resources={visible.resources}
              dispatch={dispatch}
            />
          ))
        )}
      </div>
    </>
  );
}

function isResearchPurchased(research: UiResearch) {
  return Boolean(
    research.purchased ||
      research.completed ||
      research.status?.toLowerCase() === "purchased" ||
      research.status?.toLowerCase() === "complete",
  );
}

const getResearchRequirementTag = (kind: string | undefined) => {
  if (kind === "compute") return "Compute";
  if (kind === "hardware") return "HW";
  if (kind === "task") return "Task";
  return "Req";
};

const isResearchComputeComplete = (task: UiResearchComputeTask) =>
  Boolean(task.completed || getTaskCompletedCount(task) > 0);

function ResearchAction({
  research,
  memoryUnlocked,
  resources,
  dispatch,
}: {
  research: UiResearch;
  memoryUnlocked: boolean;
  resources: VisibleState["resources"];
  dispatch: Dispatch;
}) {
  const costs = research.costs ?? research.cost ?? [];
  const lockedReason =
    research.blockedReason ??
    research.lockedReason ??
    research.lockReason ??
    research.unlockReason ??
    null;
  const requirements = research.requirements ?? [];
  const computeTasks = research.computeTasks ?? [];
  const description =
    typeof research.description === "string" ? research.description.trim() : "";
  const purchased = isResearchPurchased(research);
  const canAffordResearch = research.canAfford ?? costs.length === 0;
  const allowedByResearch = research.canBuy ?? canAffordResearch;
  const canBuy =
    !purchased &&
    !lockedReason &&
    canAffordResearch &&
    allowedByResearch;
  const buyLabel = purchased
    ? "Built"
    : !canBuy && lockedReason
      ? lockedReason
      : !canBuy
        ? "Locked"
        : research.actionLabel ?? "Buy";

  return (
    <article
      className={`research-action ${research.accent ?? "violet"} ${
        purchased ? "purchased" : ""
      }`}
    >
      <div className={`research-action-main ${!canBuy && !purchased ? "blocked" : ""}`}>
        <span className="research-copy">
          <strong>{research.name}</strong>
          {description.length > 0 && (
            <span className="research-description">{description}</span>
          )}
          <em className="research-cost-line">
            {purchased ? (
              "Built"
            ) : (
              <ResourceCost costs={costs} compact resources={resources} />
            )}
          </em>
        </span>
        <button
          type="button"
          className={`research-buy-button ${!canBuy && !purchased ? "blocked" : ""}`}
          disabled={!canBuy}
          onClick={() => dispatch({ type: "buyResearch", researchId: research.id })}
          title={buyLabel}
        >
          {purchased ? (
            <CheckCircle2 size={12} />
          ) : (
            canBuy && <Plus size={12} />
          )}
          <span>{buyLabel}</span>
        </button>
      </div>

      {requirements.length > 0 && !purchased && (
        <div className="research-requirements" aria-label={`${research.name} requirements`}>
          {requirements.map((item) => (
            <span
              className={`research-requirement ${item.met ? "met" : "open"}`}
              key={item.id}
            >
              <b>{item.met ? "✓" : getResearchRequirementTag(item.kind)}</b>
              <small>{item.label}</small>
            </span>
          ))}
        </div>
      )}

      {computeTasks.length > 0 && !purchased && (
        <div className="research-compute-list">
          {computeTasks.map((task) => {
            const completed = isResearchComputeComplete(task);
            const active = Boolean(task.active);
            const canStart = getTaskCanStart(task);
            const disabled = completed || active || !canStart;
            const blockedReason =
              !completed && !active && disabled
                ? getTaskLockedReason(task) ?? getTaskQueueBlockedReason(task) ?? "Locked"
                : null;
            const buttonLabel = completed
              ? "Done"
              : active
                ? "..."
                : blockedReason
                  ? blockedReason
                  : task.canQueue
                    ? "Queue"
                    : "Run";

            return (
              <div
                className={`research-compute ${blockedReason ? "blocked" : ""}`}
                key={task.id}
              >
                <span className="research-compute-copy">
                  <strong>{task.name}</strong>
                  <TaskMetaLine task={task} memoryUnlocked={memoryUnlocked} />
                  {(active || completed) && (
                    <ModuleMeter value={completed ? 1 : task.progress ?? 0} />
                  )}
                </span>
                <button
                  type="button"
                  className={`research-compute-button ${blockedReason ? "blocked" : ""}`}
                  disabled={disabled}
                  onClick={() => dispatch({ type: "startTask", taskId: task.id })}
                  title={buttonLabel}
                >
                  {!blockedReason && <Play size={11} />}
                  {blockedReason ? (
                    <span>{buttonLabel}</span>
                  ) : (
                    <span>
                      {completed ? "Done" : active ? "..." : task.canQueue ? "Queue" : "Run"}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
