import { Power } from "lucide-react";
import {
  POWER_UNPAID_SHUTDOWN_WARNING_SECONDS,
  type VisibleState,
  type VisibleUpgrade,
} from "../../game";
import { formatWatts } from "../format";
import { StatTile, StatTileRow } from "../StatTile";
import type { Dispatch } from "../uiActions";
import { DeadlockHelpCaption } from "./DeadlockHelp";
import {
  formatCountdownSeconds,
  formatPowerRate,
  stripSharedUnit,
} from "./display";
import {
  IdlePowerPolicyControl,
  PowerTransitionBanner,
  PsuHeaderWarning,
} from "./PowerControls";
import { getStressTone } from "./stressTone";
import { InlineUpgradeRow, UpgradeStepper } from "./UpgradeControls";

type PowerLifecycleState = "on" | "off" | "booting" | "shuttingDown";

export interface HardwarePowerStats {
  state: PowerLifecycleState;
  drawWatts: number;
  capacityWatts: number;
  costPerSecond: number;
  stress: number;
  transitionSeconds: number;
  transitionTotalSeconds?: number;
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

  const drawLabel = formatWatts(power.drawWatts);
  const capacityLabel = formatWatts(power.capacityWatts);
  const capacitySplit = capacityLabel.lastIndexOf(" ");
  const capacityValue = capacityLabel.slice(0, capacitySplit);
  const capacityUnit = capacityLabel.slice(capacitySplit + 1);
  const drawValue = stripSharedUnit(drawLabel, capacityLabel);
  const drawMeter = Number.isFinite(power.stress) ? power.stress : 0;
  const drawAccent =
    tone === "critical" ? "rose" : tone === "warn" ? "amber" : "cyan";
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
        snapKey: "credit-warning",
      }
    : showOverloadFailure
      ? {
          label: overloadLabel,
          progress: power.overloadFailure.progress,
          flashing: power.overloadFailure.active || power.overloadFailure.tripped,
          tripped: power.overloadFailure.tripped,
          snapKey: power.overloadFailure.tripped
            ? "overload-tripped"
            : power.overloadFailure.active
              ? "overload-active"
              : "overload-resetting",
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
            snapKey={headerWarning.snapKey}
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
            <IdlePowerPolicyControl
              policy={visible.metrics.idlePowerPolicy}
              dispatch={dispatch}
            />
          </div>
        )}
      </div>

      {showFailureHelp && (
        <DeadlockHelpCaption kind="psuFailure" onDismiss={onDismissFailureHelp} />
      )}

      {showTransitionStatus && (
        <PowerTransitionBanner power={power} surface="psu" />
      )}

      <StatTileRow>
        <StatTile
          label="Draw"
          value={`${drawValue} / ${capacityValue}`}
          unit={capacityUnit}
          accent={drawAccent}
          meter={drawMeter}
          title={`Power draw ${drawLabel} / ${capacityLabel} capacity`}
        />
        <StatTile
          label="Cost"
          value={formatPowerRate(power.costPerSecond)}
          unit="cr/s"
          accent="amber"
        />
      </StatTileRow>

      {power.billingGraceSeconds > 0 && (
        <div className="psu-meta-row">
          <div className="psu-meta-cell psu-meta-grace">
            <small>grace</small>
            <strong>{formatCountdownSeconds(power.billingGraceSeconds)}</strong>
          </div>
        </div>
      )}

      {psuUpgrade && (
        <div className="power-upgrade-row">
          <UpgradeStepper
            upgrade={psuUpgrade}
            dispatch={dispatch}
            label="Capacity"
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
