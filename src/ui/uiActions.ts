import type {
  CronIntervalMode,
  GameAction,
  SchedulerKillPolicy,
  SchedulerPolicy,
  TaskId,
} from "../game";

type WithSystem<T> = Omit<T, "systemId"> & { systemId?: string | number };

export type UiGameAction =
  | WithSystem<GameAction>
  | WithSystem<{ type: "startTask"; taskId: string }>
  | WithSystem<{ type: "startTaskOnCore"; taskId: string; coreId: number }>
  | WithSystem<{ type: "queueTask"; taskId: string; cpuId?: number }>
  | WithSystem<{ type: "cancelTask"; taskId: string; instanceId?: string }>
  | WithSystem<{ type: "cancelQueuedTask"; taskId: string }>
  | WithSystem<{
      type: "setSchedulerPolicy";
      target: "cpu" | "system";
      policy: SchedulerPolicy;
      cpuId?: number;
    }>
  | WithSystem<{
      type: "setSchedulerAutoKill";
      target: "cpu" | "system";
      enabled: boolean;
      cpuId?: number;
    }>
  | WithSystem<{
      type: "setSchedulerKillPolicy";
      target: "cpu" | "system";
      killPolicy: SchedulerKillPolicy;
      cpuId?: number;
    }>
  | WithSystem<{ type: "buyResearch"; researchId: string }>
  | WithSystem<{
      type: "buyUpgrade";
      upgradeId: string;
      coreId?: number;
      coreIds?: number[];
      cpuId?: number;
      sourceCpuId?: number;
      ramStickId?: number;
      ramStickIds?: number[];
    }>
  | WithSystem<{
      type: "downgradeUpgrade";
      upgradeId: string;
      coreId?: number;
      coreIds?: number[];
      cpuId?: number;
      sourceCpuId?: number;
      ramStickId?: number;
      ramStickIds?: number[];
    }>
  | WithSystem<{
      type: "setCronScheduleTask";
      scheduleId: string;
      taskId: string;
    }>
  | WithSystem<{
      type: "setCronScheduleInterval";
      scheduleId: string;
      intervalSeconds: number;
      intervalMode?: CronIntervalMode;
      intervalValue?: number;
    }>
  | WithSystem<{
      type: "setCronScheduleEnabled";
      scheduleId: string;
      enabled: boolean;
    }>
  | WithSystem<{
      type: "setPowerState";
      state: "on" | "off";
    }>
  | WithSystem<{ type: "killPower" }>
  | WithSystem<{
      type: "buyPreconfiguredSystem";
      presetId: string;
    }>
  | WithSystem<{
      type: "buyCustomSystem";
      tierIds: Record<string, string>;
    }>
  | { type: "selectSystem"; systemId: string | number };

export type Dispatch = (action: UiGameAction) => void;

const toScheduleId = (value: number | string) => {
  const scheduleId = Number(value);
  return Number.isFinite(scheduleId) && scheduleId > 0 ? scheduleId : 1;
};

const toSystemId = (systemId: string | number | undefined) => {
  if (typeof systemId === "number") return systemId;
  const parsed = Number(systemId);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const withSystem = <T extends { type: string }>(
  gameAction: T,
  action: { systemId?: string | number },
) => {
  const systemId = toSystemId(action.systemId);
  return (systemId === undefined
    ? gameAction
    : { ...gameAction, systemId }) as GameAction;
};

export const toGameAction = (action: UiGameAction): GameAction => {
  if (action.type === "setCronScheduleTask") {
    return withSystem(
      {
        type: "setCronTask",
        scheduleId: toScheduleId(action.scheduleId),
        taskId: action.taskId ? (action.taskId as TaskId) : null,
      },
      action,
    );
  }

  if (action.type === "setCronScheduleInterval") {
    const inferredMode: CronIntervalMode =
      action.intervalSeconds >= 60 && action.intervalSeconds % 60 === 0
        ? "minutes"
        : "seconds";
    const intervalMode = action.intervalMode ?? inferredMode;

    return withSystem(
      {
        type: "setCronInterval",
        scheduleId: toScheduleId(action.scheduleId),
        intervalMode,
        intervalValue:
          action.intervalValue ??
          (intervalMode === "minutes"
            ? Math.max(1, Math.round(action.intervalSeconds / 60))
            : action.intervalSeconds),
      },
      action,
    );
  }

  if (action.type === "setCronScheduleEnabled") {
    return withSystem(
      {
        type: "setCronEnabled",
        scheduleId: toScheduleId(action.scheduleId),
        enabled: action.enabled,
      },
      action,
    );
  }

  if (action.type === "setPowerState") {
    return withSystem(
      action.state === "on"
        ? { type: "requestPowerOn" }
        : { type: "requestPowerOff" },
      action,
    );
  }

  if (action.type === "killPower") {
    return withSystem({ type: "requestPowerKill" }, action);
  }

  if (action.type === "buyPreconfiguredSystem") {
    return { type: "buyMachineTemplate", templateId: action.presetId };
  }

  if (action.type === "buyCustomSystem") {
    return {
      type: "buyCustomMachine",
      components: {
        cpu: action.tierIds.cpu ?? action.tierIds.cpuPackage ?? "",
        ram: action.tierIds.ram ?? action.tierIds.memory ?? action.tierIds.ramModule ?? "",
        scheduler: action.tierIds.scheduler ?? action.tierIds.schedulerBackplane ?? "",
        psu: action.tierIds.psu ?? action.tierIds.powerSupply ?? "",
      },
    };
  }

  if (action.type === "selectSystem") {
    return {
      type: "selectSystem",
      systemId: toSystemId(action.systemId) ?? 1,
    };
  }

  return action as GameAction;
};
