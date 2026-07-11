import { RefreshCw, TriangleAlert } from "lucide-react";
import type { IdlePowerPolicy } from "../../game";
import { formatNumber } from "../format";
import { SmoothFill } from "../SmoothProgress";
import type { Dispatch } from "../uiActions";

type PowerLifecycleState = "on" | "off" | "booting" | "shuttingDown";

interface PowerTransitionState {
  state: PowerLifecycleState;
  transitionSeconds: number;
  transitionTotalSeconds?: number;
}

export function IdlePowerPolicyControl({
  policy,
  dispatch,
}: {
  policy: IdlePowerPolicy;
  dispatch: Dispatch;
}) {
  const shutsDown = policy === "shutdown-when-idle";
  const nextPolicy: IdlePowerPolicy = shutsDown
    ? "low-power"
    : "shutdown-when-idle";
  const currentLabel = shutsDown ? "off" : "low";
  const nextLabel = shutsDown ? "low power" : "shutdown";

  return (
    <button
      type="button"
      className="idle-power-policy-control"
      onClick={() => dispatch({ type: "setIdlePowerPolicy", policy: nextPolicy })}
      aria-label={`Idle power policy: ${
        shutsDown ? "shutdown when idle" : "low power"
      }. Switch to ${nextLabel}.`}
      aria-pressed={shutsDown}
      title={`Idle systems currently use ${
        shutsDown ? "automatic shutdown" : "low power"
      }. Switch to ${nextLabel}.`}
    >
      <span>Idle:</span>
      <strong>{currentLabel}</strong>
    </button>
  );
}

const POWER_BOOT_SECONDS = 10;
const POWER_SHUTDOWN_SECONDS = 8;

const clampMeter = (value: number | null) =>
  Math.min(1, Math.max(0, value ?? 0));

const formatCountdownSeconds = (seconds: number) =>
  `${formatNumber(Math.max(0, Math.ceil(seconds)))}s`;

export function PowerTransitionBanner({
  power,
  surface,
}: {
  power: PowerTransitionState;
  surface: "psu" | "system";
}) {
  if (power.state !== "booting" && power.state !== "shuttingDown") return null;

  const totalSeconds =
    power.transitionTotalSeconds ??
    (power.state === "booting" ? POWER_BOOT_SECONDS : POWER_SHUTDOWN_SECONDS);
  const progress = clampMeter(
    1 - power.transitionSeconds / Math.max(0.001, totalSeconds),
  );
  const label =
    power.state === "booting" ? "System booting" : "System shutting down";

  return (
    <div
      className={`power-transition-banner ${surface} ${power.state}`}
      role="status"
      aria-label={`${label}${
        power.transitionSeconds > 0
          ? ` ${formatCountdownSeconds(power.transitionSeconds)} remaining`
          : ""
      }`}
    >
      <span className="power-transition-label">
        <RefreshCw size={12} />
        <strong>{label}</strong>
      </span>
      {power.transitionSeconds > 0 && (
        <span className="power-transition-time">
          {formatCountdownSeconds(power.transitionSeconds)}
        </span>
      )}
      <span className="power-transition-meter" aria-hidden="true">
        <SmoothFill value={progress} snapKey={power.state} />
      </span>
    </div>
  );
}

export function PsuHeaderWarning({
  label,
  progress,
  flashing,
  tripped,
  snapKey,
}: {
  label: string;
  progress: number;
  flashing: boolean;
  tripped: boolean;
  snapKey: string;
}) {
  return (
    <span
      className={`psu-header-warning ${flashing ? "flashing" : ""} ${
        tripped ? "tripped" : ""
      }`}
      aria-label={`PSU warning ${label}`}
    >
      <span className="psu-header-warning-label">
        <TriangleAlert size={12} />
        <strong>{label}</strong>
      </span>
      <span className="psu-header-warning-meter" aria-hidden="true">
        <SmoothFill
          value={progress}
          snapKey={snapKey}
          snapOnDecrease={false}
        />
      </span>
    </span>
  );
}
