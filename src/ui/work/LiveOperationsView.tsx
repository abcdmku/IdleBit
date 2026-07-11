import { Pause, Play, RadioTower } from "lucide-react";
import { useEffect, useState } from "react";
import type { Amount, VisibleState } from "../../game";
import { formatExactResourceAmount, formatNumber } from "../format";
import { SmoothProgress } from "../SmoothProgress";
import { StatTile, StatTileRow } from "../StatTile";
import type { Dispatch } from "../uiActions";
import { formatWorkDuration } from "./workFormat";

const clampProgress = (progress: number) =>
  Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));

const clampCoreCount = (coreCount: number, maximumCoreCount: number) =>
  Math.max(1, Math.min(6, maximumCoreCount, coreCount));

const formatMargin = (marginBps: number | null) =>
  marginBps === null ? "Unknown" : `${formatNumber(marginBps / 100)}%`;

export function LiveOperationsView({
  visible,
  dispatch,
}: {
  visible: VisibleState;
  dispatch: Dispatch;
}) {
  const liveOperations = visible.liveOperations;
  const [targetSystemId, setTargetSystemId] = useState(
    liveOperations.systemId ?? visible.selectedSystem.id,
  );
  const [maxCoreCount, setMaxCoreCount] = useState(() =>
    clampCoreCount(
      liveOperations.maxCoreCount,
      liveOperations.maximumCoreCount,
    ),
  );
  const selectableMaximum = Math.max(
    1,
    Math.min(6, liveOperations.maximumCoreCount),
  );
  const isConfigured = liveOperations.systemId !== null;
  const status = !isConfigured
    ? "Not configured"
    : !liveOperations.enabled
      ? "Paused"
      : liveOperations.blockedReason
        ? "Waiting"
        : liveOperations.allocatedCoreCount > 0
          ? "Running"
          : "Watching for idle cores";
  const progress = clampProgress(liveOperations.progress);
  const workMix = liveOperations.workMix.map(({ name }) => name).join(" + ");

  useEffect(() => {
    setTargetSystemId(liveOperations.systemId ?? visible.selectedSystem.id);
  }, [liveOperations.systemId, visible.selectedSystem.id]);

  useEffect(() => {
    setMaxCoreCount(
      clampCoreCount(
        liveOperations.maxCoreCount,
        liveOperations.maximumCoreCount,
      ),
    );
  }, [liveOperations.maxCoreCount, liveOperations.maximumCoreCount]);

  return (
    <div className="work-card-list live-operations-view">
      <article className="work-card live-operations-card">
        {/* The full explainer lives on the header tooltip; the card itself
            stays numeric. */}
        <header
          title={`Scavenges idle cores only while the game is visible. Auto-repeats two real job batches without displacing queued work. Progress is retained offline but does not advance. ${liveOperations.offlineBehavior}`}
        >
          <span>Live Operations</span>
          <b aria-live="polite">{status}</b>
        </header>

        <div className="live-operations-fields">
          <label className="work-field">
            <span>System</span>
            <select
              aria-label="Live Ops system"
              value={targetSystemId}
              disabled={
                !liveOperations.canConfigure || visible.systems.length === 0
              }
              onChange={(event) =>
                setTargetSystemId(Number(event.currentTarget.value))
              }
            >
              {visible.systems.map((system) => (
                <option value={system.id} key={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
          </label>
          <label className="work-field">
            <span>Idle core cap</span>
            <select
              aria-label="Live Ops core cap"
              value={maxCoreCount}
              disabled={!liveOperations.canConfigure}
              onChange={(event) =>
                setMaxCoreCount(Number(event.currentTarget.value))
              }
            >
              {Array.from({ length: 6 }, (_, index) => index + 1).map(
                (coreCount) => (
                  <option
                    value={coreCount}
                    disabled={coreCount > selectableMaximum}
                    key={coreCount}
                  >
                    {coreCount} {coreCount === 1 ? "core" : "cores"}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>

        {/* Before configuration there is nothing to report — the selects and
            the Configure button ARE the card. Status renders only once a
            system is assigned. */}
        {isConfigured && (
          <>
            <div
              className="live-operations-status"
              role="group"
              aria-label="Live Ops status"
            >
              <StatTileRow dense>
                <StatTile
                  label="Cores"
                  value={`${liveOperations.allocatedCoreCount} / ${liveOperations.maxCoreCount}`}
                  meter={
                    liveOperations.maxCoreCount > 0
                      ? liveOperations.allocatedCoreCount /
                        liveOperations.maxCoreCount
                      : 0
                  }
                />
                <StatTile
                  label="Net"
                  value={formatExactResourceAmount(
                    liveOperations.projectedNetRewardCredits,
                  )}
                  unit="cr"
                  accent="green"
                  title={`Per batch: reward ${formatExactResourceAmount(
                    liveOperations.projectedRewardCredits,
                  )} cr − cost ${formatExactResourceAmount(
                    liveOperations.projectedOperatingCostCredits,
                  )} cr · margin ${formatMargin(
                    liveOperations.projectedMarginBps,
                  )} · batch ${
                    liveOperations.projectedDurationMs === null
                      ? "duration unknown"
                      : formatWorkDuration(liveOperations.projectedDurationMs)
                  }`}
                />
                <StatTile
                  label="Power"
                  value={formatExactResourceAmount(
                    liveOperations.projectedPowerWatts as Amount,
                  )}
                  unit="W"
                  accent="amber"
                />
              </StatTileRow>
              <small className="live-operations-batch" title={workMix}>
                {liveOperations.activeTaskName ??
                  `Next: ${liveOperations.nextTaskName}`}
              </small>
              <SmoothProgress
                value={progress}
                max={1}
                label={
                  liveOperations.remainingMs === null
                    ? "Live Ops batch progress"
                    : `Live Ops batch progress, ${formatWorkDuration(
                        liveOperations.remainingMs,
                      )} remaining`
                }
              />
            </div>

            {liveOperations.blockedReason && (
              <small className="work-blocked-reason" role="status">
                {liveOperations.blockedReason}
              </small>
            )}
          </>
        )}

        <div className="work-contract-actions live-operations-actions">
          <button
            type="button"
            className="work-primary-action"
            disabled={!liveOperations.canConfigure}
            onClick={() =>
              dispatch({
                type: "configureLiveOperations",
                systemId: targetSystemId,
                maxCoreCount,
              })
            }
          >
            <RadioTower size={12} aria-hidden="true" />
            {isConfigured ? "Update" : "Configure"}
          </button>
          <button
            type="button"
            disabled={!isConfigured}
            aria-pressed={liveOperations.enabled}
            onClick={() =>
              dispatch({
                type: "setLiveOperationsEnabled",
                enabled: !liveOperations.enabled,
              })
            }
          >
            {liveOperations.enabled ? (
              <Pause size={12} aria-hidden="true" />
            ) : (
              <Play size={12} aria-hidden="true" />
            )}
            {liveOperations.enabled ? "Pause" : "Enable"}
          </button>
        </div>
      </article>
    </div>
  );
}
