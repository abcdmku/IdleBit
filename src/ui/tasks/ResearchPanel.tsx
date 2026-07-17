import { useState } from "react";
import { Activity, CheckCircle2, CircleDashed, Play, Plus } from "lucide-react";
import { getAutomationBufferDefinition, type VisibleState } from "../../game";
import { ModuleMeter } from "../hardware/meters";
import { ExactResourceCost, ResourceCost } from "../ResourceTokens";
import { StatTile, StatTileRow } from "../StatTile";
import type { Dispatch } from "../uiActions";
import { formatBufferDuration } from "../work/workFormat";
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
  mutationsDisabled = false,
}: {
  visible: VisibleState;
  dispatch: Dispatch;
  mutationsDisabled?: boolean;
}) {
  const research = getResearch(visible);
  const [hideCompleted, setHideCompleted] = useState(true);
  const visibleResearch = hideCompleted
    ? research.filter((item) => !isResearchPurchased(item))
    : research;
  const openCount = research.filter((item) => !isResearchPurchased(item)).length;
  const bufferUpgrade = visible.automationBuffer.nextUpgrade;
  const showBufferUpgrade = bufferUpgrade?.unlocked === true;

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
          <span>Hide researched</span>
        </label>
      </div>
      <div className="panel-body">
        {visibleResearch.length === 0 && !showBufferUpgrade ? (
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
        {showBufferUpgrade && bufferUpgrade && (
          <AutomationBufferAction
            upgrade={bufferUpgrade}
            currentMaxOfflineMs={visible.automationBuffer.maxOfflineMs}
            exactResources={visible.exactResources}
            mutationsDisabled={mutationsDisabled}
            dispatch={dispatch}
          />
        )}
      </div>
    </>
  );
}

function AutomationBufferAction({
  upgrade,
  currentMaxOfflineMs,
  exactResources,
  mutationsDisabled,
  dispatch,
}: {
  upgrade: NonNullable<VisibleState["automationBuffer"]["nextUpgrade"]>;
  currentMaxOfflineMs: number;
  exactResources: VisibleState["exactResources"];
  mutationsDisabled: boolean;
  dispatch: Dispatch;
}) {
  const canBuy = !mutationsDisabled && upgrade.unlocked && upgrade.canAfford;
  const buyLabel = mutationsDisabled
    ? "Wait for offline processing"
    : (upgrade.blockedReason ?? "Buy");
  const coverage = formatBufferDuration(upgrade.maxOfflineMs);
  const currentCoverage = formatBufferDuration(currentMaxOfflineMs);
  const addedCoverage = formatBufferDuration(
    Math.max(0, upgrade.maxOfflineMs - currentMaxOfflineMs),
  );
  const definition = getAutomationBufferDefinition(upgrade.id);
  const effect = definition.renewsStandingOrders
    ? `After you close the game, eligible work can continue for up to ${coverage}. ${definition.capability}`
    : definition.capability;
  return (
    <article
      className="research-action amber automation-buffer-action"
      title={`${coverage} offline coverage`}
    >
      <div className={`research-action-main ${canBuy ? "" : "blocked"}`}>
        <span className="research-copy">
          <strong>Automation Buffer · {upgrade.name}</strong>
          <p className="automation-buffer-effect">{effect}</p>
          <StatTileRow dense>
            <StatTile
              label="offline cap"
              value={`${currentCoverage} → ${coverage}`}
              accent="amber"
              title={`Offline coverage increases from ${currentCoverage} to ${coverage}`}
            />
          </StatTileRow>
          <em className="research-cost-line">
            <ExactResourceCost
              costs={upgrade.costs}
              resources={exactResources}
              compact
            />
          </em>
        </span>
        <button
          type="button"
          className={`research-buy-button ${canBuy ? "" : "blocked"}`}
          disabled={!canBuy}
          onClick={() =>
            dispatch({ type: "purchaseAutomationBuffer", levelId: upgrade.id })
          }
          title={buyLabel}
        >
          {canBuy && <Plus size={12} />}
          <span>{canBuy ? `Add ${addedCoverage}` : buyLabel}</span>
        </button>
      </div>
    </article>
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

const getResearchRequirementLabel = (label: string) =>
  label
    .trim()
    .replace(/^(complete|run|finish|unlock)\s+/i, "")
    .replace(/\s+research$/i, "")
    .trim();

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
    ? research.completedLabel ?? "Researched"
    : !canBuy && lockedReason
      ? lockedReason
      : !canBuy
        ? "Locked"
        : research.actionLabel ?? "Research";

  return (
    <article
      className={`research-action ${research.accent ?? "violet"} ${
        purchased ? "purchased" : ""
      }`}
      title={description.length > 0 ? description : undefined}
    >
      <div className={`research-action-main ${!canBuy && !purchased ? "blocked" : ""}`}>
        <span className="research-copy">
          <strong>{research.name}</strong>
          <em className="research-cost-line">
            {purchased ? (
              research.completedLabel ?? "Researched"
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
        <ul className="research-requirements" aria-label={`${research.name} requirements`}>
          {requirements.map((item) => (
            <li
              className={`research-requirement ${item.met ? "met" : "open"}`}
              key={item.id}
              title={item.label}
              aria-label={`${item.met ? "Met" : "Open"}: ${item.label}`}
            >
              {item.met ? (
                <CheckCircle2 size={12} aria-hidden="true" />
              ) : (
                <CircleDashed size={12} aria-hidden="true" />
              )}
              <span>{getResearchRequirementLabel(item.label)}</span>
            </li>
          ))}
        </ul>
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
                  <TaskMetaLine task={task} memoryUnlocked={memoryUnlocked} showRewards />
                  {/* Always mounted so starting work fills the reserved meter
                      row instead of inserting one (no reflow on Run). */}
                  <ModuleMeter value={completed ? 1 : task.progress ?? 0} />
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
