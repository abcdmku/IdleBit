import { Check, ChevronRight, Clock3, Play, RefreshCw, Repeat2, X } from "lucide-react";
import { useState } from "react";
import {
  type ProjectId,
  type TaskId,
  type VisibleContract,
  type VisibleProject,
  type VisibleState,
} from "../../game";
import { ExactResourceCost } from "../ResourceTokens";
import { SmoothProgress } from "../SmoothProgress";
import { StatTile, StatTileRow } from "../StatTile";
import { WorkMixBar } from "../WorkMixBar";
import {
  formatExactCurrencyAmount,
  formatExactResourceAmount,
  formatExactResourceRate,
} from "../format";
import type { Dispatch } from "../uiActions";
import { WorkResourceSummary } from "./WorkResourceSummary";
import { formatWorkDuration, getWorkSystemName } from "./workFormat";

export { LiveOperationsView } from "./LiveOperationsView";

const progressValue = (value: number) => Math.max(0, Math.min(1, value));

function EmptyWorkView({ children }: { children: string }) {
  return <p className="work-view-empty">{children}</p>;
}

const workValueTitle = (
  paidWorkUnits: VisibleContract["paidWorkUnits"],
  multiplier: VisibleContract["workValueMultiplier"],
) => paidWorkUnits && multiplier
  ? `${formatExactResourceAmount(paidWorkUnits)} paid work units × ${multiplier.id} (${multiplier.basisPoints} bps)`
  : undefined;

/**
 * The decision number for a contract: how it compares against the standing
 * baseline, colored by whether it beats it. The exact rate, baseline task,
 * and net-of-cost value live in the tooltip.
 */
function ContractRateChip({
  contract,
  market,
}: {
  contract: VisibleContract;
  market: VisibleState["contractMarket"];
}) {
  const bps = contract.valueMultiplierVsStandingOrderBps ?? null;
  const multiplier = bps === null ? null : bps / 10_000;
  const rateText = `${formatExactResourceRate(contract.valuePerHourCredits)} cr/h`;
  const baselineText = `${market.standingOrderTaskName} baseline (${formatExactResourceRate(
    market.standingOrderValuePerHourCredits,
  )} cr/h)`;
  return (
    <b
      className={`work-rate-chip ${
        multiplier === null ? "" : multiplier >= 1 ? "is-gain" : "is-drain"
      }`}
      title={`${rateText}${
        multiplier === null
          ? ` · ${baselineText}`
          : ` — ${multiplier.toFixed(1)}× the ${baselineText}`
      } · nets ${formatExactCurrencyAmount(contract.netRewardCredits)} cr after ${formatExactCurrencyAmount(
        contract.operatingCostCredits,
      )} cr operating cost`}
    >
      {multiplier === null ? rateText : `×${multiplier.toFixed(1)}`}
    </b>
  );
}

/** One home for a contract's warning; nothing else on the card repeats it. */
const contractWarning = (contract: VisibleContract) =>
  contract.projectedPauseReason ??
  (!contract.creditRunwayCovered && !contract.bufferCovered
    ? "Credit runway and Automation Buffer end before completion."
    : !contract.creditRunwayCovered
      ? "Credit runway ends before completion."
      : !contract.bufferCovered
        ? "Automation Buffer ends before completion."
        : null);

/**
 * Chapter quest trail: one line per objective with a state pip. Only the
 * current objective expands with its actionable instruction — finished and
 * upcoming steps never outweigh the thing to do next.
 */
export function MissionsView({ visible }: { visible: VisibleState }) {
  const missions = visible.missions;

  return (
    <div className="work-mission-steps" aria-label="Chapter objectives">
      {missions.length === 0 ? (
        <EmptyWorkView>No campaign missions are visible.</EmptyWorkView>
      ) : (
        missions.map((mission) => (
          <div
            className={`work-mission-step mission ${
              mission.current ? "current" : ""
            } ${mission.completed ? "completed" : ""}`}
            key={mission.id}
          >
            <span className="work-mission-pip" aria-hidden="true">
              {mission.completed ? (
                <Check size={10} strokeWidth={3} />
              ) : mission.current ? (
                <ChevronRight size={10} strokeWidth={3} />
              ) : null}
            </span>
            <span
              className="work-mission-copy"
              title={
                mission.current && mission.transmission
                  ? mission.transmission
                  : mission.description
              }
            >
              <span className="work-mission-name">{mission.name}</span>
              {mission.current && (
                <small>{mission.blockedReason ?? mission.description}</small>
              )}
            </span>
            {mission.current && <b className="work-mission-badge">Current</b>}
          </div>
        ))
      )}
    </div>
  );
}

const getProjectSystemId = (
  visible: VisibleState,
  project: VisibleProject,
) =>
  visible.activeWork.find((work) => work.id === `project:${project.id}`)
    ?.systemId ?? null;

const TARGET_PROJECTION_UNAVAILABLE = "Target system projection unavailable.";

export function ProjectsView({
  visible,
  dispatch,
  targetSystemId,
  onTargetSystemChange,
}: {
  visible: VisibleState;
  dispatch: Dispatch;
  targetSystemId: number;
  onTargetSystemChange: (systemId: number) => void;
}) {
  return (
    <div className="work-card-list">
      {visible.projects.length === 0 && (
        <EmptyWorkView>No campaign projects are visible.</EmptyWorkView>
      )}
      {visible.projects.map((project) => {
        const phase = project.currentPhase;
        const activeSystemId = getProjectSystemId(visible, project);
        const systemProjections = project.systemProjections ?? [];
        const targetSystemProjection = project.active
          ? undefined
          : systemProjections.find(
              (projection) => projection.systemId === targetSystemId,
            );
        const targetProjectionUnavailable =
          !project.active &&
          systemProjections.length > 0 &&
          !targetSystemProjection;
        const projectionBlockedReason = project.active
          ? project.projectionBlockedReason ?? null
          : targetSystemProjection
            ? targetSystemProjection.projectionBlockedReason
            : targetProjectionUnavailable
              ? TARGET_PROJECTION_UNAVAILABLE
              : project.projectionBlockedReason ?? null;
        const targetCanStartPhase = project.active
          ? false
          : targetSystemProjection
            ? targetSystemProjection.canStartPhase
            : targetProjectionUnavailable
              ? false
              : project.canStartPhase;
        const targetStartBlockedReason = project.active
          ? project.blockedReason
          : targetSystemProjection
            ? targetSystemProjection.startBlockedReason
            : targetProjectionUnavailable
              ? TARGET_PROJECTION_UNAVAILABLE
              : project.blockedReason;
        const projectedDurationMs =
          targetSystemProjection?.durationMs ?? phase?.durationMs;
        const phaseProgress = phase
          ? progressValue(project.phaseProgressMs / Math.max(1, phase.durationMs))
          : project.completed
            ? 1
            : 0;
        return (
          <article
            className={`work-card project ${project.completed ? "completed" : ""}`}
            key={project.id}
          >
            <header>
              <span title={project.description}>{project.name}</span>
              <b>
                {project.completed
                  ? "Complete"
                  : project.active
                    ? "Active"
                    : `Phase ${project.phaseIndex + 1}`}
              </b>
            </header>
            {/* Reserved geometry: completed projects keep the phase, target,
                and action slots so finishing work never collapses the card. */}
            {(phase || project.completed) && (
              <>
                <StatTileRow dense>
                  <StatTile
                    label="Phase"
                    value={phase ? phase.name : "Complete"}
                    title={phase ? phase.name : "All phases complete"}
                  />
                  <StatTile
                    label="ETA"
                    value={
                      !phase
                        ? "Done"
                        : projectionBlockedReason
                          ? "No ETA"
                          : project.active
                            ? formatWorkDuration(project.remainingMs)
                            : formatWorkDuration(projectedDurationMs ?? 0)
                    }
                    title={
                      !phase
                        ? "Project complete"
                        : project.active
                          ? "Time remaining on the running phase"
                          : "Projected duration on the target system"
                    }
                  />
                </StatTileRow>
                {phase ? (
                  <WorkMixBar stages={phase.workMix} />
                ) : (
                  <span
                    className="task-recipe-bar work-mix-bar"
                    aria-hidden="true"
                  />
                )}
                <SmoothProgress
                  value={phaseProgress}
                  max={1}
                  label={`${project.name} phase progress`}
                />
                <div className="work-card-ledger">
                  <ExactResourceCost
                    costs={phase?.costs ?? []}
                    resources={visible.exactResources}
                    compact
                    emptyLabel={phase ? "No phase cost" : "Project complete"}
                  />
                  {phase && (
                    <span
                      title={workValueTitle(
                        phase.paidWorkUnits,
                        phase.workValueMultiplier,
                      )}
                    >
                      <WorkResourceSummary resources={phase.rewards} />
                    </span>
                  )}
                </div>
                {projectionBlockedReason && (
                  <small className="work-blocked-reason">
                    {projectionBlockedReason}
                  </small>
                )}
              </>
            )}
            <div className="work-card-system">
              <select
                aria-label={`Target system for ${project.name}`}
                value={
                  project.active
                    ? activeSystemId ?? targetSystemId
                    : targetSystemId
                }
                disabled={project.active || project.completed}
                onChange={(event) =>
                  onTargetSystemChange(Number(event.currentTarget.value))
                }
              >
                {visible.systems.map((system) => (
                  <option value={system.id} key={system.id}>
                    {system.name}
                  </option>
                ))}
              </select>
            </div>
            {targetStartBlockedReason &&
              targetStartBlockedReason !== projectionBlockedReason &&
              !project.completed &&
              !project.active && (
                <small className="work-blocked-reason">
                  {targetStartBlockedReason}
                </small>
              )}
            <button
              type="button"
              className="work-primary-action"
              disabled={
                project.completed ||
                !targetCanStartPhase ||
                project.active ||
                !phase
              }
              title={
                project.completed
                  ? "Project complete"
                  : targetStartBlockedReason ??
                    `Start ${phase?.name ?? "next phase"}`
              }
              onClick={() =>
                dispatch({
                  type: "startProjectPhase",
                  projectId: project.id as ProjectId,
                  systemId: targetSystemId,
                })
              }
            >
              <Play size={12} aria-hidden="true" />
              {project.completed
                ? "Complete"
                : project.active
                  ? "Phase running"
                  : "Start next phase"}
            </button>
          </article>
        );
      })}
    </div>
  );
}

/**
 * One contract card used for offers and active contracts alike. Every slot
 * (header time chip, progress, payoff, work mix, action row) exists in both
 * states, so accepting a contract updates the card in place instead of
 * re-parenting it into a different list.
 */
function ContractCard({
  visible,
  contract,
  market,
  dispatch,
}: {
  visible: VisibleState;
  contract: VisibleContract;
  market: VisibleState["contractMarket"];
  dispatch: Dispatch;
}) {
  const warning = contractWarning(contract);
  // Player-chosen target system; null keeps the generator's suggestion so a
  // regenerated market keeps steering untouched cards.
  const [chosenSystemId, setChosenSystemId] = useState<number | null>(null);
  const systemOptions = contract.systemOptions ?? [];
  const targetSystemId =
    !contract.accepted &&
    chosenSystemId !== null &&
    systemOptions.some((option) => option.systemId === chosenSystemId)
      ? chosenSystemId
      : contract.systemId;
  const targetOption =
    systemOptions.find((option) => option.systemId === targetSystemId) ?? null;
  const targetBlockedReason = targetOption
    ? targetOption.blockedReason
    : contract.canAccept
      ? null
      : contract.projectedPauseReason;
  const systemName = getWorkSystemName(visible, contract.systemId);

  return (
    <article
      className={`work-card contract ${contract.accepted ? "active" : ""}`}
    >
      <header>
        <span title={contract.description}>{contract.name}</span>
        <b>{contract.kind}</b>
        <small
          className={`work-contract-when ${
            !contract.accepted && contract.novel ? "is-novel" : ""
          }`}
          title={
            contract.accepted
              ? `Time remaining on ${systemName}`
              : `Offer expires in ${formatWorkDuration(contract.expiresInMs)}${
                  contract.novel ? " · pays novel Data" : ""
                }`
          }
        >
          <Clock3 size={10} aria-hidden="true" />
          {formatWorkDuration(
            contract.accepted ? contract.remainingMs : contract.expiresInMs,
          )}
        </small>
      </header>
      <SmoothProgress
        value={
          contract.accepted
            ? progressValue(
                contract.workCompletedMs / Math.max(1, contract.workRequiredMs),
              )
            : 0
        }
        max={1}
        label={`${contract.name} progress`}
      />
      <div className="work-contract-payoff">
        <span
          title={workValueTitle(
            contract.paidWorkUnits,
            contract.workValueMultiplier,
          )}
        >
          <WorkResourceSummary resources={contract.rewards} />
        </span>
        <ContractRateChip contract={contract} market={market} />
        {contract.accepted || systemOptions.length === 0 ? (
          <small
            className="work-contract-system"
            title={`Runs ${formatWorkDuration(contract.workRequiredMs)} of work on ${systemName}`}
          >
            {contract.accepted
              ? systemName
              : `${formatWorkDuration(contract.workRequiredMs)} · ${systemName}`}
          </small>
        ) : (
          <small
            className="work-contract-system has-target-select"
            title={`Runs ${formatWorkDuration(contract.workRequiredMs)} of work on the chosen system`}
          >
            {formatWorkDuration(contract.workRequiredMs)} ·
            <select
              aria-label={`Target system for ${contract.name}`}
              value={targetSystemId}
              onChange={(event) =>
                setChosenSystemId(Number(event.currentTarget.value))
              }
            >
              {systemOptions.map((option) => (
                <option
                  value={option.systemId}
                  key={option.systemId}
                  title={option.blockedReason ?? undefined}
                >
                  {option.name}
                </option>
              ))}
            </select>
          </small>
        )}
      </div>
      <WorkMixBar stages={contract.workMix} />
      {warning && <small className="work-blocked-reason">{warning}</small>}
      <div className="work-contract-actions">
        {contract.accepted ? (
          <b className="work-contract-status" role="status">
            <Check size={12} aria-hidden="true" /> Active
          </b>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                dispatch({ type: "declineContract", contractId: contract.id })
              }
            >
              <X size={12} aria-hidden="true" /> Decline
            </button>
            <button
              type="button"
              className="work-primary-action"
              disabled={targetBlockedReason !== null}
              title={
                targetBlockedReason ??
                contract.projectedPauseReason ??
                `Accept ${contract.name}`
              }
              onClick={() =>
                dispatch({
                  type: "acceptContract",
                  contractId: contract.id,
                  systemId: targetSystemId,
                })
              }
            >
              <Check size={12} aria-hidden="true" /> Accept
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export function ContractsView({
  visible,
  dispatch,
}: {
  visible: VisibleState;
  dispatch: Dispatch;
}) {
  const market = visible.contractMarket;
  // Reserved geometry: contracts render as one list in stable id (creation)
  // order, so accepting never moves a card between sections.
  const contracts = [...visible.contracts].sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
  const activeCount = contracts.filter((contract) => contract.accepted).length;
  const offerCount = contracts.length - activeCount;

  const refreshLabel = market.canRefresh
    ? "Refresh market"
    : market.refreshBlockedReason ??
      `Refresh in ${formatWorkDuration(market.refreshAvailableInMs)}`;

  return (
    <div className="work-contracts-view">
      <div className="work-view-toolbar">
        <span>
          {offerCount} offers · {activeCount} active
        </span>
        <button
          type="button"
          disabled={!market.canRefresh}
          title={refreshLabel}
          onClick={() => dispatch({ type: "refreshContractMarket" })}
        >
          <RefreshCw size={12} aria-hidden="true" />
          {refreshLabel}
        </button>
      </div>

      {contracts.length === 0 && (
        <EmptyWorkView>No contract offers or active contracts.</EmptyWorkView>
      )}

      {contracts.length > 0 && (
        <div className="work-card-list">
          {contracts.map((contract) => (
            <ContractCard
              key={contract.id}
              visible={visible}
              contract={contract}
              market={market}
              dispatch={dispatch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function StandingOrdersView({
  visible,
  dispatch,
  selectedTaskId,
  selectedSystemId,
  onTaskChange,
  onSystemChange,
}: {
  visible: VisibleState;
  dispatch: Dispatch;
  selectedTaskId: TaskId | null;
  selectedSystemId: number;
  onTaskChange: (taskId: TaskId | null) => void;
  onSystemChange: (systemId: number) => void;
}) {
  const configured = visible.standingOrders[0] ?? null;
  const options = visible.cron.taskOptions;

  return (
    <div className="work-card-list">
      <article className="work-card standing-order">
        <header title="Re-runs one eligible system job when automated work drains the queue.">
          <span>Standing order</span>
          <b>{configured?.enabled ? "Armed" : configured ? "Paused" : "Not set"}</b>
        </header>
        <label className="work-field">
          <span>Repeatable job</span>
          <select
            value={selectedTaskId ?? ""}
            disabled={!visible.cron.unlocked || options.length === 0}
            onChange={(event) =>
              onTaskChange((event.currentTarget.value || null) as TaskId | null)
            }
          >
            <option value="">Select a job</option>
            {options.map((task) => (
              <option value={task.id} key={task.id}>
                {task.name}
              </option>
            ))}
          </select>
        </label>
        <label className="work-field">
          <span>Target system</span>
          <select
            value={selectedSystemId}
            onChange={(event) => onSystemChange(Number(event.currentTarget.value))}
          >
            {visible.systems.map((system) => (
              <option value={system.id} key={system.id}>
                {system.name}
              </option>
            ))}
          </select>
        </label>
        {!visible.cron.unlocked && (
          <small className="work-blocked-reason">Requires CRON research.</small>
        )}
        {visible.cron.unlocked && options.length === 0 && (
          <small className="work-blocked-reason">No repeatable jobs yet.</small>
        )}
        <div className="work-contract-actions">
          {configured && (
            <button
              type="button"
              onClick={() => dispatch({ type: "setStandingOrder", taskId: null })}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className="work-primary-action"
            disabled={!selectedTaskId || !visible.cron.unlocked}
            onClick={() =>
              dispatch({
                type: "setStandingOrder",
                taskId: selectedTaskId,
                systemId: selectedSystemId,
              })
            }
          >
            Configure
          </button>
          <button
            type="button"
            disabled={!configured}
            aria-pressed={configured?.enabled ?? false}
            onClick={() =>
              dispatch({
                type: "setStandingOrderEnabled",
                enabled: !configured?.enabled,
              })
            }
          >
            <Repeat2 size={12} aria-hidden="true" />
            {configured?.enabled ? "Pause" : "Enable"}
          </button>
        </div>
      </article>
    </div>
  );
}

