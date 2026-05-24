import { Power } from "lucide-react";
import {
  POWER_UNPAID_SHUTDOWN_WARNING_SECONDS,
  type VisibleState,
  type VisibleUpgrade,
} from "../../game";
import { formatWatts } from "../format";
import type { Dispatch } from "../uiActions";
import { DeadlockHelpCaption } from "./DeadlockHelp";
import {
  formatCountdownSeconds,
  formatHardwarePercent,
  formatPowerRate,
} from "./display";
import { PowerTransitionBanner, PsuHeaderWarning } from "./PowerControls";
import { getStressTone } from "./stressTone";
import { InlineUpgradeRow, UpgradeStepper } from "./UpgradeControls";
import { getProgressStyle } from "./meters";

type PowerLifecycleState = "on" | "off" | "booting" | "shuttingDown";

export interface HardwarePowerStats {
  state: PowerLifecycleState;
  drawWatts: number;
  capacityWatts: number;
  costPerSecond: number;
  stress: number;
  transitionSeconds: number;
  billingGraceSeconds: number;
  unpaidShutdownWarningSeconds: number;
  overloadFailure: {
    active: boolean;
    progress: number;
    remainingSeconds: number;
    tripped: boolean;
  };
}

export interface HardwarePowerControls {
  showControls: boolean;
  canPowerOn: boolean;
  canPowerKill: boolean;
}

export function PsuSection({
  visible,
  power,
  powerControls,
  selected,
  onSelect,
  upgrades,
  dispatch,
  advancedControls,
  showTransitionStatus,
  showFailureHelp,
  onDismissFailureHelp,
}: {
  visible: VisibleState;
  power: HardwarePowerStats;
  powerControls: HardwarePowerControls;
  selected: boolean;
  onSelect: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
  advancedControls: boolean;
  showTransitionStatus: boolean;
  showFailureHelp?: boolean;
  onDismissFailureHelp?: () => void;
}) {
  const tone = getStressTone(power.stress);
  const psuUpgrade = upgrades.find((upgrade) => upgrade.id === "psu");
  const otherUpgrades = upgrades.filter(
    (upgrade) => upgrade.id !== "psu" && upgrade.id !== "cooling",
  );
  const stateLabel = {
    on: "On",
    off: "Off",
    booting: "Booting",
    shuttingDown: "Shutting down",
  }[power.state];
  const bootButtonClass =
    power.state === "off" ? "go" : power.state === "booting" ? "active" : "";

  const loadPercent = Math.min(100, Math.max(0, power.stress * 100));
  const showOverloadFailure =
    power.overloadFailure.active || power.overloadFailure.progress > 0;
  const showCreditWarning = power.unpaidShutdownWarningSeconds > 0;
  const creditWarningProgress = Math.min(
    1,
    Math.max(
      0,
      1 -
        power.unpaidShutdownWarningSeconds /
          POWER_UNPAID_SHUTDOWN_WARNING_SECONDS,
    ),
  );
  const overloadLabel = power.overloadFailure.tripped
    ? "PSU failure"
    : power.stress > 1
      ? `${formatCountdownSeconds(power.overloadFailure.remainingSeconds)} to fail`
      : "Resetting";
  const headerWarning = showCreditWarning
    ? {
        label: `${formatCountdownSeconds(power.unpaidShutdownWarningSeconds)} to cutoff`,
        progress: creditWarningProgress,
        flashing: true,
        tripped: false,
      }
    : showOverloadFailure
      ? {
          label: overloadLabel,
          progress: power.overloadFailure.progress,
          flashing: power.overloadFailure.active || power.overloadFailure.tripped,
          tripped: power.overloadFailure.tripped,
        }
      : null;

  return (
    <section
      className={`hw-section psu-section ${tone} power-${power.state} ${
        power.stress > 1 ? "overloaded" : ""
      } ${selected ? "selected" : ""}`}
    >
      <div className="psu-header-row">
        <button type="button" className="hw-section-header" onClick={onSelect}>
          <Power size={14} />
          <span>PSU</span>
        </button>
        {headerWarning && (
          <PsuHeaderWarning
            label={headerWarning.label}
            progress={headerWarning.progress}
            flashing={headerWarning.flashing}
            tripped={headerWarning.tripped}
          />
        )}
        {powerControls.showControls && (
          <div className="power-control-buttons" aria-label={`Power controls: ${stateLabel}`}>
            <button
              type="button"
              className={bootButtonClass}
              onClick={() => dispatch({ type: "setPowerState", state: "on" })}
              disabled={!powerControls.canPowerOn}
              aria-pressed={power.state === "booting"}
            >
              Boot
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => dispatch({ type: "killPower" })}
              disabled={!powerControls.canPowerKill}
              aria-pressed={false}
            >
              Kill
            </button>
          </div>
        )}
      </div>

      {showFailureHelp && (
        <DeadlockHelpCaption kind="psuFailure" onDismiss={onDismissFailureHelp} />
      )}

      {showTransitionStatus && (
        <PowerTransitionBanner power={power} surface="psu" />
      )}

      <div className="psu-hero">
        <span className="psu-hero-stat psu-hero-draw-stat">
          <span className="psu-hero-draw">{formatWatts(power.drawWatts)}</span>
          <span className="psu-hero-capacity">
            <span className="psu-hero-divider">/</span>
            {formatWatts(power.capacityWatts)}
          </span>
        </span>
        <span className="psu-hero-stat psu-hero-cost-stat">
          <span className="psu-hero-cost">
            {formatPowerRate(power.costPerSecond)}
          </span>
          <span className="psu-hero-cost-unit">cr/s</span>
        </span>
      </div>

      <div className="psu-load-row">
        <span className="psu-load-label">
          <strong>{formatHardwarePercent(power.stress)}</strong>
          <small>load</small>
        </span>
        <div
          className="psu-load-meter"
          role="img"
          aria-label={`PSU load ${formatHardwarePercent(power.stress)}`}
        >
          <div
            className="psu-load-meter-fill progress-fill"
            style={getProgressStyle(loadPercent / 100)}
          />
          <span className="psu-load-meter-tick" aria-hidden="true" />
          <span className="psu-load-meter-tick critical" aria-hidden="true" />
        </div>
      </div>

      {power.billingGraceSeconds > 0 && (
        <div className="psu-meta-row">
          <div className="psu-meta-cell psu-meta-grace">
            <small>grace</small>
            <strong>{formatCountdownSeconds(power.billingGraceSeconds)}</strong>
          </div>
        </div>
      )}

      {showCreditWarning && (
        <div className="psu-meta-row">
          <div className="psu-meta-cell psu-meta-credit-warning">
            <small>credits</small>
            <strong>
              {formatCountdownSeconds(power.unpaidShutdownWarningSeconds)} cutoff
            </strong>
          </div>
        </div>
      )}

      {psuUpgrade && (
        <div className="power-upgrade-row">
          <UpgradeStepper
            upgrade={psuUpgrade}
            dispatch={dispatch}
            label="PSU Capacity"
            className="inline-stepper"
            resources={visible.resources}
          />
        </div>
      )}

      {advancedControls && selected && otherUpgrades.length > 0 && (
        <InlineUpgradeRow
          upgrades={otherUpgrades}
          resources={visible.resources}
          dispatch={dispatch}
        />
      )}
    </section>
  );
}
