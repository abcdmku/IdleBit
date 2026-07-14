import { Power } from "lucide-react";
import {
  POWER_BOOTSTRAP_GRACE_SECONDS,
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
  PsuGraceChip,
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
  const isTransitioning =
    power.state === "booting" || power.state === "shuttingDown";

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
  // The status slot shows exactly one state at a time, priority-ordered:
  // credit cutoff / overload warning, then boot/shutdown countdown, then the
  // billing grace countdown. Coexisting states stay in the slot title.
  const transitionActive = showTransitionStatus && isTransitioning;
  const graceActive = power.billingGraceSeconds > 0;
  const activeStatuses: string[] = [];
  if (headerWarning) activeStatuses.push(`PSU warning: ${headerWarning.label}`);
  if (transitionActive) {
    activeStatuses.push(
      power.state === "booting" ? "System booting" : "System shutting down",
    );
  }
  if (graceActive) {
    activeStatuses.push(
      `Billing grace ${formatCountdownSeconds(power.billingGraceSeconds)}`,
    );
  }

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
        {/* One reserved status line: warning > transition > grace swap in
            place inside this fixed-height slot, so state flips never reflow
            the header row and the card never gains or loses rows. When two
            states coexist the slot title carries the full list. */}
        <span
          className={`psu-status-slot ${activeStatuses.length > 0 ? "" : "is-idle"}`}
          aria-hidden={activeStatuses.length > 0 ? undefined : true}
          title={
            activeStatuses.length > 1 ? activeStatuses.join(" · ") : undefined
          }
        >
          {headerWarning ? (
            <PsuHeaderWarning
              label={headerWarning.label}
              progress={headerWarning.progress}
              flashing={headerWarning.flashing}
              tripped={headerWarning.tripped}
              snapKey={headerWarning.snapKey}
            />
          ) : transitionActive ? (
            <PowerTransitionBanner power={power} surface="psu" />
          ) : graceActive ? (
            <PsuGraceChip
              seconds={power.billingGraceSeconds}
              totalSeconds={POWER_BOOTSTRAP_GRACE_SECONDS}
            />
          ) : (
            <PsuHeaderWarning
              label="Nominal"
              progress={0}
              flashing={false}
              tripped={false}
              snapKey="idle"
            />
          )}
        </span>
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

      {/* The failure help overlays the card (see deadlock-help.css) so its
          appearance never moves the hardware below. */}
      {showFailureHelp && (
        <DeadlockHelpCaption kind="psuFailure" onDismiss={onDismissFailureHelp} />
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
