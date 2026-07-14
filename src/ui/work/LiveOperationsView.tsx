import { Pause, Play, RadioTower } from "lucide-react";
import { useEffect, useState } from "react";
import type { VisibleState } from "../../game";
import { formatExactCurrencyAmount, formatNumber, formatWatts } from "../format";
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

  // Sync only from the configured Live Ops system. Selecting a different
  // system elsewhere in the UI must never overwrite an unsaved pick in the
  // dropdown (the deps intentionally exclude selectedSystem.id).
  useEffect(() => {
    setTargetSystemId((current) => liveOperations.systemId ?? current);
  }, [liveOperations.systemId]);

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
          title={`Scavenges idle cores only while the game is visible. Auto-repeats two real job batches without displacing queued work. Net and Power count only the extra draw from waking the reserved cores. Progress is retained offline but does not advance. ${liveOperations.offlineBehavior}`}
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
                  value={formatExactCurrencyAmount(
                    liveOperations.projectedNetRewardCredits,
                  )}
                  unit="cr"
                  accent="green"
                  title={`Per batch: reward ${formatExactCurrencyAmount(
                    liveOperations.projectedRewardCredits,
                  )} cr − cost ${formatExactCurrencyAmount(
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
                  value={formatWatts(
                    Number(liveOperations.projectedPowerWatts),
                  )}
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

            {/* Reserved single-line slot: a runtime blocker recolors it in
                place, so waiting/running flips never move the action row. */}
            <small
              className={`live-operations-blocked${
                liveOperations.blockedReason ? " work-blocked-reason" : ""
              }`}
              role="status"
              title={
                liveOperations.blockedReason ??
                "No blockers. Live Ops runs whenever idle cores are free."
              }
            >
              {liveOperations.blockedReason ?? ""}
            </small>
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
