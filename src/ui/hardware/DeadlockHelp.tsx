import { useEffect, useRef } from "react";
import type { VisibleCpuSocket, VisibleState } from "../../game";
import { formatNumber } from "../format";
import { formatCountdownSeconds } from "./display";
import { getProgressStyle } from "./meters";

export function DeadlockCountdown({
  pressure,
  compact = false,
}: {
  pressure: VisibleState["metrics"]["deadlockPressure"];
  compact?: boolean;
}) {
  if (pressure.seconds <= 0) return null;

  const label = pressure.active
    ? `${formatCountdownSeconds(pressure.remainingSeconds)} fail`
    : pressure.lockout
      ? `${formatCountdownSeconds(pressure.seconds)} lock`
      : `${formatCountdownSeconds(pressure.seconds)} cool`;
  const title = pressure.active
    ? "Time left before all active processes are lost"
    : pressure.lockout
      ? "Processes cannot start until deadlock lockout reaches 0"
      : `Deadlock cooldown draining at ${formatNumber(pressure.cooldownRate)}x`;

  return (
    <span
      role="progressbar"
      className={`deadlock-countdown ${compact ? "compact" : ""} ${
        pressure.active ? "danger" : "cooldown"
      }`}
      title={title}
      aria-label={title}
      aria-valuemin={0}
      aria-valuemax={pressure.limitSeconds}
      aria-valuenow={Math.round(pressure.seconds * 10) / 10}
      aria-valuetext={label}
    >
      <span className="deadlock-countdown-meter" aria-hidden="true">
        <span className="progress-fill" style={getProgressStyle(pressure.progress)} />
      </span>
      <span className="deadlock-countdown-label">{label}</span>
    </span>
  );
}

export const shouldShowCacheDeadlockPressure = (
  socket: VisibleCpuSocket,
  pressure: VisibleState["metrics"]["deadlockPressure"],
) =>
  pressure.seconds > 0 &&
  pressure.resource === "cache" &&
  (pressure.cpuId === null || pressure.cpuId === socket.id);

export const shouldShowRamDeadlockPressure = (
  pressure: VisibleState["metrics"]["deadlockPressure"],
) => pressure.seconds > 0 && pressure.resource === "ram";

export function DeadlockHelpCaption({
  kind = "deadlock",
  onDismiss,
}: {
  kind?: "deadlock" | "cooldown" | "psuFailure";
  onDismiss?: () => void;
}) {
  const captionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    captionRef.current?.scrollIntoView?.({
      block: "center",
      inline: "nearest",
      behavior:
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
    });
  }, [kind]);

  return (
    <aside
      className={`deadlock-help-caption ${kind}`}
      aria-live="polite"
      ref={captionRef}
    >
      {kind === "deadlock" ? (
        <p>
          Deadlock: this task is waiting for cache/RAM held by other work.
          Cancel a task or add capacity to let it continue. Later scheduler
          research can avoid or clean this up.
        </p>
      ) : kind === "cooldown" ? (
        <p>
          Deadlock cooldown: if the timer reaches 10s, every active process is
          lost and the lockout must drain to 0 before work can start again.
          Resolve earlier to keep work running while the timer cools down.
          Upgrade Deadlock Cooldown to drain it faster.
        </p>
      ) : (
        <p>
          PSU failure: draw is above capacity. Buy PSU Capacity or reduce load
          before 10s, or the system cuts power and must be rebooted.
        </p>
      )}
      <button type="button" onClick={onDismiss}>
        Got it
      </button>
    </aside>
  );
}
