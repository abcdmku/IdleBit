import { type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { X } from "lucide-react";
import type { VisibleCore, VisibleCpuSocket, VisibleState, VisibleUpgrade } from "../../game";
import { formatClock } from "../format";
import { getSocketCoreLabel } from "../panels/cpuLabels";
import { getCoreActiveTask } from "../tasks/taskData";
import type { Dispatch } from "../uiActions";
import { DeadlockCountdown, shouldShowCacheDeadlockPressure } from "./DeadlockHelp";
import { UpgradeStepper } from "./UpgradeControls";
import { getCoreGridMetrics } from "./coreGrid";
import { getProgressStyle } from "./meters";
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
}) {
  const coreUpgrade = socket.coreUpgrade ?? cpuUpgrades.find((upgrade) => upgrade.id === "core");
  const activeCount = socket.cores.filter((core) => getCoreActiveTask(core)).length;
  const grid = getCoreGridMetrics(socket.cores.length);
  const gridStyle = {
    "--core-grid-columns": grid.columns,
  } as CSSProperties;
  const selectedCore =
    socket.cores.find((core) => core.id === selectedCoreId) ?? socket.cores[0] ?? null;
  const selectedClockUpgrade = selectedAllCores
    ? socket.allCoreClockUpgrade
    : selectedCore?.clockUpgrade ?? null;
  const selectedClockCoreIds = selectedAllCores
    ? socket.cores.map((core) => core.id)
    : undefined;
  const selectedClockCoreId = selectedAllCores ? undefined : selectedCore?.id;
  const selectedClockCoreLabel = selectedCore
    ? getSocketCoreLabel(socket, selectedCore.id)
    : "C1";
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
        {deadlockPressure &&
          shouldShowCacheDeadlockPressure(socket, deadlockPressure) && (
            <DeadlockCountdown pressure={deadlockPressure} compact />
          )}
        {allCoreTuningVisible && (
          <button
            type="button"
            className={`core-select-all-button ${selectedAllCores ? "active" : ""}`}
            onClick={onSelectAllCores}
            aria-pressed={selectedAllCores}
            aria-label="Tune all core frequencies"
            title="Tune all core frequencies"
          >
            All
          </button>
        )}
        <small>
          <strong>{activeCount}</strong>/{socket.cores.length}
        </small>
      </div>

      <div
        className={`core-grid ${grid.density}`}
        style={gridStyle}
        data-grid={grid.label}
      >
        {socket.cores.map((core) => (
          <CoreDie
            key={core.id}
            core={core}
            density={grid.density}
            selected={selectedAllCores || selectedCoreId === core.id}
            onSelect={() => onSelectCore(core.id)}
            coreLabel={getSocketCoreLabel(socket, core.id)}
            dispatch={dispatch}
          />
        ))}
      </div>

      {(selectedClockUpgrade || coreUpgrade) && (
        <div className="core-control-strip">
          {selectedClockUpgrade && (
            <UpgradeStepper
              upgrade={selectedClockUpgrade}
              dispatch={dispatch}
              coreId={selectedClockCoreId}
              coreIds={selectedClockCoreIds}
              label={selectedAllCores ? "All Freq" : `${selectedClockCoreLabel} Freq`}
              resources={resources}
            />
          )}
          {coreUpgrade && (
            <AddCoreButton
              upgrade={coreUpgrade}
              cpuId={socket.id}
              resources={resources}
              dispatch={dispatch}
            />
          )}
        </div>
      )}
    </section>
  );
}

function CoreDie({
  core,
  coreLabel,
  density,
  selected,
  onSelect,
  dispatch,
}: {
  core: VisibleCore;
  coreLabel: string;
  density: CoreGridDensity;
  selected: boolean;
  onSelect: () => void;
  dispatch: Dispatch;
}) {
  const active = getCoreActiveTask(core);
  const progress =
    active?.coreProgress?.find((operation) => operation.coreId === core.id)?.progress ?? 0;
  const work = active?.name ?? "Idle";
  const cancelActiveTask = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!active) return;

    dispatch({
      type: "cancelTask",
      taskId: active.taskId,
      instanceId: active.instanceId,
    });
  };
  const selectOnKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`core-die ${active ? "running" : ""} ${
        core.deadlocked ? "deadlocked" : ""
      } ${selected ? "selected" : ""}`}
      onClick={onSelect}
      onKeyDown={selectOnKeyDown}
      aria-pressed={selected}
      title={`${coreLabel} - ${formatClock(core.clockHz)} - ${
        core.deadlocked ? "Deadlocked" : work
      }`}
    >
      <span className="core-die-head">
        <span className="core-status-dot" aria-hidden="true" />
        <span className="core-label">{coreLabel}</span>
        <span className="core-clock">
          <strong>{formatClock(core.clockHz)}</strong>
        </span>
        {active && (
          <button
            type="button"
            className="core-cancel-button"
            onClick={cancelActiveTask}
            title={`Cancel ${active.name}`}
            aria-label={`Cancel ${active.name} on ${coreLabel}`}
          >
            <X size={11} />
          </button>
        )}
      </span>
      {density === "normal" && (
        <span className={`core-work ${active ? "" : "idle"}`} title={work}>
          {work}
        </span>
      )}
      <span className="die-progress" aria-hidden="true">
        <span className="progress-fill" style={getProgressStyle(progress)} />
      </span>
    </div>
  );
}

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
      className="add-core-stepper"
      resources={resources}
    />
  );
}

