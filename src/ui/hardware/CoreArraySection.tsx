import { memo, type CSSProperties, type MouseEvent } from "react";
import { X } from "lucide-react";
import type { VisibleCpuSocket, VisibleState, VisibleUpgrade } from "../../game";
import { formatClock, formatNumber } from "../format";
import { getSocketCoreLabel } from "../panels/cpuLabels";
import { SmoothFill } from "../SmoothProgress";
import { StatTile } from "../StatTile";
import { getCoreActiveTask } from "../tasks/taskData";
import { useStableCallback } from "../hooks/useStableCallback";
import type { Dispatch } from "../uiActions";
import { DeadlockCountdown, shouldShowCacheDeadlockPressure } from "./DeadlockHelp";
import { formatClockTick } from "./display";
import { UpgradeStepper } from "./UpgradeControls";
import { getCoreGridMetrics } from "./coreGrid";
import { getCoreOperationProgress } from "./coreProgress";
import { getCoreSegmentColor } from "./meters";
import type { CoreGridDensity } from "./visibleState";

export function CoreArraySection({
  socket,
  selectedCoreId,
  selectedAllCores,
  allCoreTuningVisible,
  onSelectCore,
  onSelectAllCores,
  cpuUpgrades,
  resources,
  dispatch,
  deadlockPressure,
  showEfficiency = false,
}: {
  socket: VisibleCpuSocket;
  selectedCoreId: number | null;
  selectedAllCores: boolean;
  allCoreTuningVisible: boolean;
  onSelectCore: (coreId: number) => void;
  onSelectAllCores: () => void;
  cpuUpgrades: VisibleUpgrade[];
  resources: VisibleState["resources"];
  dispatch: Dispatch;
  deadlockPressure?: VisibleState["metrics"]["deadlockPressure"] | null;
  showEfficiency?: boolean;
}) {
  const coreUpgrade = socket.coreUpgrade ?? cpuUpgrades.find((upgrade) => upgrade.id === "core");
  // Identity-stable handler so the memoized dies skip reconciliation even
  // though parents pass fresh inline closures on every snapshot.
  const stableSelectCore = useStableCallback(onSelectCore);
  const grid = getCoreGridMetrics(socket.cores.length);
  const tabletColumns = Math.min(grid.columns, 6);
  const mobileColumns = Math.min(grid.columns, 4);
  const gridStyle = {
    "--core-grid-columns": grid.columns,
    "--core-grid-tablet-columns": tabletColumns,
    "--core-grid-mobile-columns": mobileColumns,
  } as CSSProperties;
  const selectedClockUpgrade = socket.allCoreClockUpgrade;
  const cooldownActive = deadlockPressure
    ? shouldShowCacheDeadlockPressure(socket, deadlockPressure) &&
      deadlockPressure.lockout
    : false;

  return (
    <section
      className={`core-array-section ${grid.fullWidth ? "full-width" : ""} ${
        cooldownActive ? "cooling-down" : ""
      }`}
    >
      <div className="core-array-header">
        <span>Cores</span>
        {/* Reserved chip slot: pre-reserves the countdown's footprint while
            deadlock pressure is possible, so onset/drain toggles visibility
            without rewrapping the header. */}
        {deadlockPressure && (
          <span
            className={`core-array-deadlock-slot ${
              shouldShowCacheDeadlockPressure(socket, deadlockPressure)
                ? ""
                : "is-idle"
            }`}
            aria-hidden={
              shouldShowCacheDeadlockPressure(socket, deadlockPressure)
                ? undefined
                : true
            }
          >
            {shouldShowCacheDeadlockPressure(socket, deadlockPressure) && (
              <DeadlockCountdown pressure={deadlockPressure} compact />
            )}
          </span>
        )}
        {allCoreTuningVisible && (
          <button
            type="button"
            className={`core-select-all-button ${selectedAllCores ? "active" : ""}`}
            onClick={onSelectAllCores}
            aria-pressed={selectedAllCores}
            aria-label="Select all cores"
            title="Select all cores"
          >
            All
          </button>
        )}
        {showEfficiency && (
          <div className="core-array-efficiency">
            <StatTile
              label="Eff"
              value={formatNumber(socket.efficiency)}
              title={`Efficiency ${formatNumber(socket.efficiency)}`}
            />
          </div>
        )}
        {coreUpgrade && (
          <div className="core-array-header-controls" aria-label="Core count">
            <AddCoreButton
              upgrade={coreUpgrade}
              cpuId={socket.id}
              resources={resources}
              dispatch={dispatch}
            />
          </div>
        )}
      </div>

      <div
        className={`core-grid ${grid.density}`}
        style={gridStyle}
        data-grid={grid.label}
      >
        {socket.cores.map((core) => {
          const active = getCoreActiveTask(core);
          return (
            <CoreDie
              key={core.id}
              coreId={core.id}
              clockHz={core.clockHz}
              deadlocked={core.deadlocked}
              activeName={active?.name ?? null}
              activeTaskId={active?.taskId ?? null}
              activeInstanceId={active?.instanceId ?? null}
              progress={getCoreOperationProgress(core)}
              density={grid.density}
              selected={selectedAllCores || selectedCoreId === core.id}
              onSelectCore={stableSelectCore}
              coreLabel={getSocketCoreLabel(socket, core.id)}
              dispatch={dispatch}
            />
          );
        })}
      </div>

      {selectedClockUpgrade && (
        <div className="core-control-strip">
          <UpgradeStepper
            upgrade={selectedClockUpgrade}
            dispatch={dispatch}
            cpuId={socket.id}
            label="Core Freq"
            resources={resources}
          />
        </div>
      )}
    </section>
  );
}

/**
 * Memoized with primitive props: up to 512 dies reconcile per socket view and
 * a snapshot lands every 500ms, so idle/unchanged dies must skip re-render.
 * Handlers passed in must be identity-stable (see useStableCallback above).
 */
const CoreDie = memo(function CoreDie({
  coreId,
  coreLabel,
  density,
  selected,
  clockHz,
  deadlocked,
  activeName,
  activeTaskId,
  activeInstanceId,
  progress,
  onSelectCore,
  dispatch,
}: {
  coreId: number;
  coreLabel: string;
  density: CoreGridDensity;
  selected: boolean;
  clockHz: number;
  deadlocked: boolean;
  activeName: string | null;
  activeTaskId: string | null;
  activeInstanceId: string | null;
  progress: number;
  onSelectCore: (coreId: number) => void;
  dispatch: Dispatch;
}) {
  const running = activeName !== null;
  const work = activeName ?? "Idle";
  const coreStyle = running
    ? ({
        "--core-status-color": getCoreSegmentColor(coreId, 0.94),
        "--core-status-glow": getCoreSegmentColor(coreId, 0.72),
      } as CSSProperties)
    : undefined;
  const cancelActiveTask = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (activeTaskId === null) return;

    dispatch({
      type: "cancelTask",
      taskId: activeTaskId,
      instanceId: activeInstanceId ?? undefined,
      coreId,
    });
  };
  const dieTitle = `${coreLabel} - ${formatClock(clockHz)} - ${
    deadlocked ? "Deadlocked" : work
  }`;

  return (
    <div
      className={`core-die ${running ? "running" : ""} ${
        deadlocked ? "deadlocked" : ""
      } ${selected ? "selected" : ""}`}
      style={coreStyle}
      title={dieTitle}
    >
      {/* Stretched invisible select button: no nested interactive controls
          inside a button role — the absolutely positioned cancel button sits
          above it as a sibling (RackSystemCard pattern). */}
      <button
        type="button"
        className="core-die-select"
        onClick={() => onSelectCore(coreId)}
        aria-pressed={selected}
        aria-label={`Select ${coreLabel}, ${deadlocked ? "deadlocked" : work}`}
        title={dieTitle}
      />
      <span className="core-die-head">
        <span className="core-label">{coreLabel}</span>
        <span className="core-clock">
          <strong>{formatClockTick(clockHz)}</strong>
        </span>
        {running && (
          <button
            type="button"
            className="core-cancel-button"
            onClick={cancelActiveTask}
            title={`Cancel ${work}`}
            aria-label={`Cancel ${work} on ${coreLabel}`}
          >
            <X size={11} />
          </button>
        )}
      </span>
      {density === "normal" && (
        <span className={`core-work ${running ? "" : "idle"}`} title={work}>
          {work}
        </span>
      )}
      <span className="smooth-progress die-progress" aria-hidden="true">
        <SmoothFill value={progress} />
      </span>
    </div>
  );
});

function AddCoreButton({
  upgrade,
  cpuId,
  resources,
  dispatch,
}: {
  upgrade: VisibleUpgrade;
  cpuId: number;
  resources: VisibleState["resources"];
  dispatch: Dispatch;
}) {
  return (
    <UpgradeStepper
      upgrade={upgrade}
      dispatch={dispatch}
      cpuId={cpuId}
      label="Core"
      resources={resources}
    />
  );
}

