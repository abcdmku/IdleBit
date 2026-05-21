import { Power, RefreshCw, TriangleAlert } from "lucide-react";
import { formatNumber } from "../format";
import type { Dispatch } from "../uiActions";
import { getProgressStyle } from "./meters";

type PowerLifecycleState = "on" | "off" | "booting" | "shuttingDown";

interface PowerControlState {
  state: PowerLifecycleState;
}

interface PowerTransitionState extends PowerControlState {
  transitionSeconds: number;
}

const POWER_BOOT_SECONDS = 10;
const POWER_SHUTDOWN_SECONDS = 8;

const clampMeter = (value: number | null) =>
  Math.min(1, Math.max(0, value ?? 0));

const formatCountdownSeconds = (seconds: number) =>
  `${formatNumber(Math.max(0, Math.ceil(seconds)))}s`;

export function SystemShutdownControl({
  power,
  dispatch,
}: {
  power: PowerControlState;
  dispatch: Dispatch;
}) {
  const starting = power.state === "off";
  const label =
    power.state === "off"
      ? "Start system"
      : power.state === "booting"
        ? "Starting"
        : power.state === "shuttingDown"
          ? "Shutting down"
          : "Shutdown";

  return (
    <button
      type="button"
      className={`system-shutdown-button ${starting ? "start" : ""}`}
      onClick={() =>
        dispatch({ type: "setPowerState", state: starting ? "on" : "off" })
      }
      disabled={power.state !== "on" && power.state !== "off"}
      title={starting ? "Start system" : "Graceful shutdown"}
      aria-label={starting ? "Start system" : "Graceful shutdown"}
    >
      <Power size={12} />
      <span>{label}</span>
    </button>
  );
}

export function PowerTransitionBanner({
  power,
  surface,
}: {
  power: PowerTransitionState;
  surface: "psu" | "system";
}) {
  if (power.state !== "booting" && power.state !== "shuttingDown") return null;

  const totalSeconds =
    power.state === "booting" ? POWER_BOOT_SECONDS : POWER_SHUTDOWN_SECONDS;
  const progress = clampMeter(
    1 - power.transitionSeconds / Math.max(1, totalSeconds),
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
        <span className="progress-fill" style={getProgressStyle(progress)} />
      </span>
    </div>
  );
}

export function PsuHeaderWarning({
  label,
  progress,
  flashing,
  tripped,
}: {
  label: string;
  progress: number;
  flashing: boolean;
  tripped: boolean;
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
        <span className="progress-fill" style={getProgressStyle(progress)} />
      </span>
    </span>
  );
}
