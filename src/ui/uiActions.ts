import type {
  AutomationBufferLevelId,
  CronIntervalMode,
  CpuTierId,
  GameAction,
  SchedulerKillPolicy,
  SchedulerPolicy,
  TaskId,
  ProjectId,
} from "../game";

type WithSystem<T> = T extends unknown
  ? Omit<T, "systemId"> & { systemId?: string | number }
  : never;

export type UiGameAction =
  | WithSystem<GameAction>
  | { type: "configureLiveOperations"; systemId: number; maxCoreCount: number }
  | { type: "setLiveOperationsEnabled"; enabled: boolean }
  | { type: "purchaseAutomationBuffer"; levelId: AutomationBufferLevelId }
  | { type: "refreshContractMarket" }
  | { type: "acceptContract"; contractId: string; systemId?: number }
  | { type: "declineContract"; contractId: string }
  | { type: "startProjectPhase"; projectId: ProjectId; systemId?: number }
  | { type: "setStandingOrder"; taskId: TaskId | null; systemId?: number }
  | { type: "setStandingOrderEnabled"; enabled: boolean }
  | WithSystem<{ type: "startTask"; taskId: string }>
  | WithSystem<{ type: "startTaskOnCore"; taskId: string; coreId: number }>
  | WithSystem<{ type: "queueTask"; taskId: string; cpuId?: number }>
  | WithSystem<{
      type: "cancelTask";
      taskId: string;
      instanceId?: string;
      coreId?: number;
    }>
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
      ramTierId?: CpuTierId;
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
      ramTierId?: CpuTierId;
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
  | { type: "sellSystem"; systemId: string | number }
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

const toPositiveInteger = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
};

const toNonNegativeInteger = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : undefined;
};

const toPositiveIntegerList = (value: string | undefined) =>
  value
    ?.split(",")
    .map((item) => toPositiveInteger(item.trim()))
    .filter((item): item is number => item !== undefined) ?? [];

const toNonNegativeIntegerList = (value: string | undefined) =>
  value
    ?.split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => toNonNegativeInteger(item))
    .filter((item): item is number => item !== undefined) ?? [];

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
    const cpuPackageCount = toPositiveInteger(action.tierIds.cpuPackages) ?? 1;
    const cpuPackageCores = toPositiveIntegerList(action.tierIds.cpuPackageCores);
    const cpuPackageLevels = toPositiveIntegerList(action.tierIds.cpuPackageLevels);
    const cpuPackageCacheLevels = toPositiveIntegerList(
      action.tierIds.cpuPackageCacheLevels,
    );
    const cpuPackageCacheSpeedLevels = toPositiveIntegerList(
      action.tierIds.cpuPackageCacheSpeedLevels,
    );
    const cpuPackageSchedulerSlots = toNonNegativeIntegerList(
      action.tierIds.cpuPackageSchedulerSlots,
    );
    const cpuPackageConfigCount = Math.max(
      cpuPackageCount,
      cpuPackageCores.length,
      cpuPackageLevels.length,
      cpuPackageCacheLevels.length,
      cpuPackageCacheSpeedLevels.length,
      cpuPackageSchedulerSlots.length,
    );
    const hasCpuPackageConfigs =
      cpuPackageCores.length > 0 ||
      cpuPackageLevels.length > 0 ||
      cpuPackageCacheLevels.length > 0 ||
      cpuPackageCacheSpeedLevels.length > 0 ||
      cpuPackageSchedulerSlots.length > 0;

    return {
      type: "buyCustomMachine",
      components: {
        cpu: action.tierIds.cpu ?? action.tierIds.cpuPackage ?? "",
        cpuPackageCount,
        cpuCoreCount: toPositiveInteger(action.tierIds.cpuCores),
        cpuLevel: toPositiveInteger(action.tierIds.cpuLevel),
        cacheLevel: toPositiveInteger(action.tierIds.cacheLevel),
        cacheSpeedLevel: toPositiveInteger(action.tierIds.cacheSpeedLevel),
        cpuPackageConfigs: hasCpuPackageConfigs
          ? Array.from({ length: cpuPackageConfigCount }, (_, index) => ({
              coreCount: cpuPackageCores[index],
              cpuLevel: cpuPackageLevels[index],
              cacheLevel: cpuPackageCacheLevels[index],
              cacheSpeedLevel: cpuPackageCacheSpeedLevels[index],
              schedulerSlots: cpuPackageSchedulerSlots[index],
            }))
          : undefined,
        cpuSchedulerSlots: toNonNegativeInteger(action.tierIds.cpuSchedulerSlots),
        ram: action.tierIds.ram ?? action.tierIds.memory ?? action.tierIds.ramModule ?? "",
        ramStickCount: toPositiveInteger(action.tierIds.ramSticks),
        ramLevel: toPositiveInteger(action.tierIds.ramLevel),
        ramSpeedLevel: toPositiveInteger(action.tierIds.ramSpeedLevel),
        scheduler: action.tierIds.scheduler ?? action.tierIds.schedulerBackplane ?? "",
        psu:
          action.tierIds.psu ??
          action.tierIds.powerSupply ??
          action.tierIds.power ??
          "",
        psuLevel: toPositiveInteger(
          action.tierIds.psuLevel ?? action.tierIds.powerSupplyLevel,
        ),
      },
    };
  }

  if (action.type === "sellSystem") {
    return {
      type: "sellSystem",
      systemId: toSystemId(action.systemId) ?? 1,
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
