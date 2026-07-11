import type { SchedulerKillPolicy, SchedulerPolicy, SchedulerWatchdogPreview, VisibleCpuSocket, VisibleState } from "../../game";
import { getSocketForCore } from "../panels/cpuLabels";
import { clampMeter } from "../panels/uiNumbers";
import { SmoothFill } from "../SmoothProgress";
import type { Dispatch } from "../uiActions";
import { formatCountdownSeconds } from "./display";
import { getCoreTargetLabel } from "./coreTargets";

const schedulerPolicyLabels: Record<SchedulerPolicy, string> = {
  none: "None",
  fifo: "FIFO",
  shortestTask: "Shortest",
  smallestMemory: "Smallest memory",
};

const systemSchedulerPolicyLabels: Record<SchedulerPolicy, string> = {
  none: "None",
  fifo: "FIFO",
  shortestTask: "Least queued",
  smallestMemory: "Most headroom",
};

const schedulerKillPolicyLabels: Record<SchedulerKillPolicy, string> = {
  deadlockedTask: "Deadlocked",
  newestBlocker: "Newest blocker",
  lowestProgress: "Lowest progress",
};

const formatCoreTarget = (coreIds: number[], sockets: VisibleCpuSocket[]) => {
  if (coreIds.length === 0) return "C?";
  if (coreIds.length <= 2) {
    return coreIds
      .map((coreId) => getCoreTargetLabel(sockets, coreId))
      .join("+");
  }

  const firstSocket = getSocketForCore(sockets, coreIds[0]);
  const sameSocket =
    firstSocket !== null &&
    coreIds.every((coreId) => getSocketForCore(sockets, coreId)?.id === firstSocket.id);

  if (sameSocket) {
    return `${getCoreTargetLabel(sockets, coreIds[0])}+${coreIds.length - 1}`;
  }

  return `${coreIds.length} cores`;
};

export function SchedulerWatchdogStatus({
  watchdog,
  sockets,
}: {
  watchdog: SchedulerWatchdogPreview | null;
  sockets: VisibleCpuSocket[];
}) {
  if (!watchdog) return null;

  const progress = clampMeter(watchdog.progress);
  const progressPercent = Math.round(progress * 1000) / 10;
  const coreTarget = formatCoreTarget(watchdog.victimCoreIds, sockets);
  const title =
    watchdog.victimInstanceId === watchdog.deadlockedInstanceId
      ? `Auto-kill ${watchdog.victimTaskName} on ${coreTarget} to clear ${watchdog.resource} deadlock`
      : `Auto-kill ${watchdog.victimTaskName} on ${coreTarget} blocking ${watchdog.deadlockedTaskName}`;

  return (
    <div className="scheduler-watchdog-status" aria-live="polite" title={title}>
      <div className="scheduler-watchdog-copy">
        <span>Auto-kill</span>
        <em>{coreTarget}</em>
        <strong>{watchdog.victimTaskName}</strong>
        <small>in {formatCountdownSeconds(watchdog.secondsRemaining)}</small>
      </div>
      <div
        className="scheduler-watchdog-meter"
        role="progressbar"
        aria-label={`Auto-kill countdown ${progressPercent}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPercent}
      >
        <SmoothFill value={progress} snapKey={watchdog.victimInstanceId} />
      </div>
    </div>
  );
}

export function SchedulerControls({
  visible,
  config,
  target,
  cpuId,
  dispatch,
}: {
  visible: VisibleState;
  config: VisibleCpuSocket["schedulerConfig"];
  target: "cpu" | "system";
  cpuId?: number;
  dispatch: Dispatch;
}) {
  const showAutoKill = visible.flags.schedulerWatchdog;
  const showPolicy = visible.flags.schedulerPolicies;
  const showKillPolicy = visible.flags.schedulerWatchdog;
  const policyLabels =
    target === "system" ? systemSchedulerPolicyLabels : schedulerPolicyLabels;

  if (!showAutoKill && !showPolicy && !showKillPolicy) {
    return null;
  }

  return (
    <div className="scheduler-controls" aria-label="Scheduler controls">
      {showPolicy && (
        <label className="scheduler-control">
          <span>Policy</span>
          <select
            value={config.policy}
            onChange={(event) =>
              dispatch({
                type: "setSchedulerPolicy",
                target,
                cpuId,
                policy: event.target.value as SchedulerPolicy,
              })
            }
          >
            {(Object.keys(policyLabels) as SchedulerPolicy[]).map((policy) => (
              <option key={policy} value={policy}>
                {policyLabels[policy]}
              </option>
            ))}
          </select>
        </label>
      )}

      {showAutoKill && (
        <label className="scheduler-control checkbox">
          <input
            type="checkbox"
            checked={config.autoKillEnabled}
            onChange={(event) =>
              dispatch({
                type: "setSchedulerAutoKill",
                target,
                cpuId,
                enabled: event.target.checked,
              })
            }
          />
          <span>Auto-kill</span>
        </label>
      )}

      {showKillPolicy && (
        <label className="scheduler-control">
          <span>Kill</span>
          <select
            value={config.killPolicy}
            onChange={(event) =>
              dispatch({
                type: "setSchedulerKillPolicy",
                target,
                cpuId,
                killPolicy: event.target.value as SchedulerKillPolicy,
              })
            }
          >
            {(Object.keys(schedulerKillPolicyLabels) as SchedulerKillPolicy[]).map(
              (policy) => (
                <option key={policy} value={policy}>
                  {schedulerKillPolicyLabels[policy]}
                </option>
              ),
            )}
          </select>
        </label>
      )}
    </div>
  );
}

