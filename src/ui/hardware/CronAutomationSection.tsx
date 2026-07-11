import { ListTodo, Pause, Play } from "lucide-react";
import type { VisibleState, VisibleUpgrade } from "../../game";
import { StatTile, StatTileRow } from "../StatTile";
import type { UiTask } from "../tasks/taskTypes";
import type { Dispatch } from "../uiActions";
import { HardwareInstallSection, LockedSystemSection } from "./HardwareInstallSection";
import { UpgradeStepper } from "./UpgradeControls";
import {
  formatCronInterval,
  getCronCountdownLabel,
  getCronIntervalSeconds,
  getCronMinimumSeconds,
  getCronMinimumUpgrade,
  getCronMode,
  getCronScheduleId,
  getCronSchedules,
  getCronState,
  getSystemTaskOptions,
  hasCronScheduler,
} from "./cronData";
import type { CronIntervalMode, UiCronSchedule, UiCronState } from "./visibleState";

export function CronAutomationSection({
  visible,
  selected,
  onSelect,
  upgrades,
  dispatch,
}: {
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
}) {
  const cron = getCronState(visible);
  const unlocked = hasCronScheduler(visible);

  if (!unlocked) {
    return (
      <LockedSystemSection
        className="scheduler-section cron-section"
        Icon={ListTodo}
        title="CRON"
        note="Research CRON Scheduler"
        selected={selected}
        onSelect={onSelect}
      />
    );
  }

  const schedules = getCronSchedules(visible);
  const scheduleUpgrade = upgrades.find((upgrade) => upgrade.id === "cronSchedule");

  if (schedules.length === 0) {
    return (
      <HardwareInstallSection
        className="scheduler-section cron-section"
        Icon={ListTodo}
        title="CRON"
        note="Install first CRON job slot"
        upgrade={scheduleUpgrade}
        selected={selected}
        onSelect={onSelect}
        dispatch={dispatch}
        resources={visible.resources}
      />
    );
  }

  const systemTasks = getSystemTaskOptions(visible);
  const activeCount = schedules.filter((schedule) => schedule.enabled !== false).length;
  const minUpgrade = getCronMinimumUpgrade(visible, cron);
  const baseMinimumSeconds = getCronMinimumSeconds(cron);

  return (
    <section
      className={`hw-section scheduler-section cron-section ${
        selected ? "selected" : ""
      }`}
    >
      <div className="hw-section-header-row cron-header-row">
        <button type="button" className="hw-section-header" onClick={onSelect}>
          <ListTodo size={14} />
          <span>CRON</span>
        </button>
        <StatTileRow dense>
          <StatTile
            label="Active"
            value={`${activeCount}/${schedules.length}`}
            accent="violet"
            meter={schedules.length > 0 ? activeCount / schedules.length : 0}
            title={`${activeCount} of ${schedules.length} CRON schedules active`}
          />
          <StatTile
            label="Min"
            value={formatCronInterval(baseMinimumSeconds)}
            accent="violet"
            title={`Smallest interval CRON can schedule: ${formatCronInterval(baseMinimumSeconds)}`}
          />
        </StatTileRow>
        {minUpgrade && (
          <UpgradeStepper
            upgrade={minUpgrade}
            dispatch={dispatch}
            label="Min interval"
            className="cron-min-stepper"
            resources={visible.resources}
          />
        )}
      </div>

      <div className="cron-schedule-list" aria-label="CRON schedules">
        {schedules.map((schedule, index) => (
          <CronScheduleRow
            key={getCronScheduleId(schedule, index)}
            schedule={schedule}
            index={index}
            cron={cron}
            tasks={systemTasks}
            dispatch={dispatch}
          />
        ))}
      </div>
    </section>
  );
}

function CronScheduleRow({
  schedule,
  index,
  cron,
  tasks,
  dispatch,
}: {
  schedule: UiCronSchedule;
  index: number;
  cron: UiCronState | null;
  tasks: UiTask[];
  dispatch: Dispatch;
}) {
  const scheduleId = getCronScheduleId(schedule, index);
  const minimumSeconds = getCronMinimumSeconds(cron, schedule);
  const intervalSeconds = getCronIntervalSeconds(schedule, minimumSeconds);
  const mode = getCronMode(schedule, intervalSeconds);
  const minValue =
    mode === "minutes" ? Math.max(1, Math.ceil(minimumSeconds / 60)) : minimumSeconds;
  const maxSeconds = Math.max(minimumSeconds * 20, intervalSeconds * 2, 600);
  const maxValue =
    mode === "minutes" ? Math.max(minValue, Math.ceil(maxSeconds / 60)) : maxSeconds;
  const intervalValue =
    mode === "minutes"
      ? Math.max(minValue, Math.ceil(intervalSeconds / 60))
      : Math.max(minValue, Math.round(intervalSeconds));
  const selectedTaskId =
    schedule.taskId && tasks.some((task) => task.id === schedule.taskId)
      ? schedule.taskId
      : "";
  const enabled = schedule.enabled !== false;

  const dispatchInterval = (rawValue: string, nextMode = mode) => {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;

    const nextValue = Math.max(minValue, Math.round(value));
    const nextSeconds =
      nextMode === "minutes" ? nextValue * 60 : nextValue;

    dispatch({
      type: "setCronScheduleInterval",
      scheduleId,
      intervalSeconds: Math.max(minimumSeconds, nextSeconds),
      intervalMode: nextMode,
      intervalValue: nextValue,
    });
  };

  const switchMode = (nextMode: CronIntervalMode) => {
    const nextValue =
      nextMode === "minutes"
        ? Math.max(1, Math.ceil(intervalSeconds / 60))
        : intervalSeconds;
    dispatchInterval(String(nextValue), nextMode);
  };

  const toggleEnabled = () =>
    dispatch({
      type: "setCronScheduleEnabled",
      scheduleId,
      enabled: !enabled,
    });

  return (
    <div className={`cron-schedule-row ${enabled ? "enabled" : "paused"}`}>
      <label className="cron-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) =>
            dispatch({
              type: "setCronScheduleEnabled",
              scheduleId,
              enabled: event.currentTarget.checked,
            })
          }
          aria-label={`Enable CRON schedule ${index + 1}`}
        />
        <button
          type="button"
          className="cron-toggle-button"
          onClick={toggleEnabled}
          aria-pressed={enabled}
          title={enabled ? "Pause schedule" : "Run schedule"}
        >
          {enabled ? <Pause size={12} /> : <Play size={12} />}
        </button>
      </label>

      <label className="cron-control cron-task-control">
        <select
          value={selectedTaskId}
          onChange={(event) =>
            dispatch({
              type: "setCronScheduleTask",
              scheduleId,
              taskId: event.currentTarget.value,
            })
          }
          disabled={tasks.length === 0}
          aria-label={`CRON schedule ${index + 1} system task`}
        >
          {tasks.length === 0 ? (
            <option value="">No available tasks</option>
          ) : (
            <>
              <option value="" disabled>
                Select Task
              </option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </>
          )}
        </select>
      </label>

      <label className="cron-control cron-interval-control" title="Interval between runs">
        <input
          type="number"
          min={minValue}
          max={maxValue}
          step={1}
          value={intervalValue}
          onChange={(event) => dispatchInterval(event.currentTarget.value)}
          aria-label={`CRON schedule ${index + 1} interval`}
        />
      </label>

      <div
        className="cron-mode-control"
        role="group"
        aria-label={`CRON schedule ${index + 1} interval unit`}
      >
        <button
          type="button"
          className={mode === "seconds" ? "active" : ""}
          onClick={() => switchMode("seconds")}
          aria-pressed={mode === "seconds"}
        >
          s
        </button>
        <button
          type="button"
          className={mode === "minutes" ? "active" : ""}
          onClick={() => switchMode("minutes")}
          aria-pressed={mode === "minutes"}
        >
          m
        </button>
      </div>

      <div className="cron-next" aria-label="Next CRON job">
        <small>Next</small>
        <strong>{getCronCountdownLabel(schedule)}</strong>
      </div>
    </div>
  );
}
