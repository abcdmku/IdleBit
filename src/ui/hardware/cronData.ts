import type { VisibleState } from "../../game";
import { formatNumber } from "../format";
import { firstNumber } from "../panels/uiNumbers";
import { getTaskCanUseAction, getTasks } from "../tasks/taskData";
import type { UiTask } from "../tasks/taskTypes";
import { formatCountdownSeconds } from "./display";
import { asUiVisible, type CronIntervalMode, type UiCronSchedule, type UiCronState } from "./visibleState";
import { hasUiFlag } from "./systemLoad";

export const getCronState = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  return (
    ui.cron ??
    ui.automation?.cron ??
    ui.systemManagement?.cron ??
    ui.hardware.cron ??
    null
  );
};

export const hasCronScheduler = (visible: VisibleState) =>
  Boolean(
    getCronState(visible)?.unlocked ||
      hasUiFlag(visible, "cron", "cronScheduler", "cronAutomation"),
  );

export const hasPsuManagement = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  return Boolean(
    ui.systemManagement?.psuManagement ||
      ui.systemManagement?.powerManagement ||
      hasUiFlag(visible, "psuManagement", "powerManagement"),
  );
};

const isSystemQueueTask = (task: UiTask | undefined): task is UiTask =>
  task?.category === "system" || task?.category === "distributed";

export const getSystemTaskOptions = (visible: VisibleState) =>
  getTasks(visible).filter(
    (task) => isSystemQueueTask(task) && getTaskCanUseAction(task, "systemScheduler"),
  );

export const getCronMinimumSeconds = (
  cron: UiCronState | null,
  schedule?: UiCronSchedule,
) =>
  Math.max(
    1,
    firstNumber(
      schedule?.minIntervalSeconds,
      schedule?.minimumSeconds,
      cron?.minIntervalSeconds,
      cron?.unlockedMinimumSeconds,
      cron?.minimumSeconds,
    ) ?? 60,
  );

export const getCronScheduleId = (schedule: UiCronSchedule, index: number) =>
  String(schedule.id ?? schedule.scheduleId ?? `schedule-${index + 1}`);

export const getCronIntervalSeconds = (
  schedule: UiCronSchedule,
  minimumSeconds: number,
) => {
  const intervalSeconds = firstNumber(
    schedule.intervalSeconds,
    typeof schedule.intervalValue === "number"
      ? schedule.intervalMode === "minutes"
        ? schedule.intervalValue * 60
        : schedule.intervalValue
      : undefined,
    typeof schedule.intervalMinutes === "number"
      ? schedule.intervalMinutes * 60
      : undefined,
    schedule.interval,
  );

  return Math.max(minimumSeconds, intervalSeconds ?? minimumSeconds);
};

/**
 * The schedule's persisted unit choice wins. The seconds/minutes fallback
 * inference only applies to legacy shapes that never stored a mode —
 * otherwise a 60s-multiple interval would silently override the user's
 * dispatched toggle back to minutes.
 */
export const getCronMode = (
  schedule: UiCronSchedule,
  intervalSeconds: number,
): CronIntervalMode =>
  schedule.intervalMode ??
  schedule.mode ??
  (intervalSeconds >= 60 && intervalSeconds % 60 === 0 ? "minutes" : "seconds");

export const getCronSchedules = (visible: VisibleState) => {
  const cron = getCronState(visible);
  const schedules = ((cron?.schedules ?? cron?.rows ?? []) as unknown) as UiCronSchedule[];

  return schedules;
};

export const getCronCountdownLabel = (schedule: UiCronSchedule) => {
  if (schedule.enabled === false) return "Paused";

  const seconds = firstNumber(
    schedule.remainingSeconds,
    schedule.secondsRemaining,
    schedule.countdownSeconds,
    schedule.nextRunSeconds,
  );

  return typeof seconds === "number"
    ? formatCountdownSeconds(seconds)
    : "Waiting";
};

export const formatCronInterval = (seconds: number) =>
  seconds >= 60 && seconds % 60 === 0
    ? `${formatNumber(seconds / 60)}m`
    : `${formatNumber(seconds)}s`;

export const getCronMinimumUpgrade = (
  visible: VisibleState,
  cron: UiCronState | null,
) => {
  const candidateIds = [
    cron?.minIntervalUpgradeId,
    "cronMinInterval",
    "cronInterval",
    "cronSchedulerInterval",
    "cronSchedulerCadence",
  ].filter((id): id is string => Boolean(id));

  return visible.upgrades.find((upgrade) =>
    candidateIds.includes(upgrade.id as string),
  );
};

