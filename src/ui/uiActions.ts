import type {
  CronIntervalMode,
  GameAction,
  SchedulerKillPolicy,
  SchedulerPolicy,
  TaskId,
} from "../game";

export type UiGameAction =
  | GameAction
  | { type: "startTask"; taskId: string }
  | { type: "startTaskOnCore"; taskId: string; coreId: number }
  | { type: "queueTask"; taskId: string; cpuId?: number }
  | { type: "cancelTask"; taskId: string; instanceId?: string }
  | { type: "cancelQueuedTask"; taskId: string }
  | {
      type: "setSchedulerPolicy";
      target: "cpu" | "system";
      policy: SchedulerPolicy;
      cpuId?: number;
    }
  | {
      type: "setSchedulerAutoKill";
      target: "cpu" | "system";
      enabled: boolean;
      cpuId?: number;
    }
  | {
      type: "setSchedulerKillPolicy";
      target: "cpu" | "system";
      killPolicy: SchedulerKillPolicy;
      cpuId?: number;
    }
  | { type: "buyResearch"; researchId: string }
  | {
      type: "buyUpgrade";
      upgradeId: string;
      coreId?: number;
      coreIds?: number[];
      cpuId?: number;
      sourceCpuId?: number;
      ramStickId?: number;
      ramStickIds?: number[];
    }
  | {
      type: "downgradeUpgrade";
      upgradeId: string;
      coreId?: number;
      coreIds?: number[];
      cpuId?: number;
      sourceCpuId?: number;
      ramStickId?: number;
      ramStickIds?: number[];
    }
  | {
      type: "setCronScheduleTask";
      scheduleId: string;
      taskId: string;
    }
  | {
      type: "setCronScheduleInterval";
      scheduleId: string;
      intervalSeconds: number;
      intervalMode?: CronIntervalMode;
      intervalValue?: number;
    }
  | {
      type: "setCronScheduleEnabled";
      scheduleId: string;
      enabled: boolean;
    }
  | {
      type: "setPowerState";
      state: "on" | "off";
    }
  | { type: "killPower" };

export type Dispatch = (action: UiGameAction) => void;

const toScheduleId = (value: number | string) => {
  const scheduleId = Number(value);
  return Number.isFinite(scheduleId) && scheduleId > 0 ? scheduleId : 1;
};

export const toGameAction = (action: UiGameAction): GameAction => {
  if (action.type === "setCronScheduleTask") {
    return {
      type: "setCronTask",
      scheduleId: toScheduleId(action.scheduleId),
      taskId: action.taskId ? (action.taskId as TaskId) : null,
    };
  }

  if (action.type === "setCronScheduleInterval") {
    const inferredMode: CronIntervalMode =
      action.intervalSeconds >= 60 && action.intervalSeconds % 60 === 0
        ? "minutes"
        : "seconds";
    const intervalMode = action.intervalMode ?? inferredMode;

    return {
      type: "setCronInterval",
      scheduleId: toScheduleId(action.scheduleId),
      intervalMode,
      intervalValue:
        action.intervalValue ??
        (intervalMode === "minutes"
          ? Math.max(1, Math.round(action.intervalSeconds / 60))
          : action.intervalSeconds),
    };
  }

  if (action.type === "setCronScheduleEnabled") {
    return {
      type: "setCronEnabled",
      scheduleId: toScheduleId(action.scheduleId),
      enabled: action.enabled,
    };
  }

  if (action.type === "setPowerState") {
    return action.state === "on"
      ? { type: "requestPowerOn" }
      : { type: "requestPowerOff" };
  }

  if (action.type === "killPower") {
    return { type: "requestPowerKill" };
  }

  return action as GameAction;
};
