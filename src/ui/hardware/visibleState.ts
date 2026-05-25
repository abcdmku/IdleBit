import type { VisibleState } from "../../game";
import type {
  UiCustomMachineBuilder,
  UiRackSystemSource,
  UiRecord,
  UiSystemPreset,
} from "../rack";
import type { UiActiveTask, UiQueueEntry, UiResearch, UiTask } from "../tasks/taskTypes";

export type CoreGridDensity = "normal" | "compact" | "dense";
export type CronIntervalMode = "seconds" | "minutes";
export interface UiPowerOverloadFailure {
  seconds?: number;
  limitSeconds?: number;
  remainingSeconds?: number;
  progress?: number;
  rate?: number;
  active?: boolean;
  tripped?: boolean;
}

export interface UiQueueDisplayItem {
  id: string;
  cancelTaskId?: string;
  name: string;
  waitingReason: string;
  instanceId?: string;
  active: boolean;
  progress: number;
  deadlocked?: boolean;
}

export interface UiSystemStatus {
  cacheBits?: number;
  cacheUsedBytes?: number;
  cacheUsedBits?: number;
  cacheBytes?: number;
  ramBits?: number;
  memoryBits?: number;
  ramLoad?: number;
  ramPressure?: number;
  memoryPressure?: number;
  memoryPressureRatio?: number;
  ramUsedBytes?: number;
  ramUsedBits?: number;
  memoryUsedBits?: number;
  ramBytes?: number;
  psuStress?: number;
  powerStress?: number;
  powerEfficiency?: number;
  powerState?: string;
  powerHeadroomWatts?: number;
  powerBootstrapGraceSeconds?: number;
  powerUnpaidShutdownWarningSeconds?: number;
  creditShutdownWarningSeconds?: number;
  powerCreditShutdownWarningSeconds?: number;
  powerTransitionSeconds?: number;
  powerTransitionTotalSeconds?: number;
  powerOverloadFailure?: UiPowerOverloadFailure;
  powerOverloadFailureSeconds?: number;
  powerOverloadFailureProgress?: number;
  powerOverloadFailureRemainingSeconds?: number;
  powerOverloadFailureActive?: boolean;
  powerOverloadFailureTripped?: boolean;
  billingGraceSeconds?: number;
  powerBillingGraceSeconds?: number;
  coolingStress?: number;
  thermalStress?: number;
  coolingStatus?: string;
  thermalStatus?: string;
  ramCpuMatch?: number;
  matchingEfficiency?: number;
  memory?: {
    pressure?: number;
    usedBits?: number;
    usedBytes?: number;
    capacityBits?: number;
    capacityBytes?: number;
  };
  cache?: {
    usedBits?: number;
    usedBytes?: number;
    capacityBits?: number;
    capacityBytes?: number;
  };
  psu?: { stress?: number };
  cooling?: { status?: string; stress?: number };
  power?: {
    state?: string;
    lifecycle?: string;
    drawWatts?: number;
    capacityWatts?: number;
    headroomWatts?: number;
    costPerSecond?: number;
    efficiency?: number;
    transitionSeconds?: number;
    powerTransitionSeconds?: number;
    transitionTotalSeconds?: number;
    powerTransitionTotalSeconds?: number;
    bootstrapGraceSeconds?: number;
    powerBootstrapGraceSeconds?: number;
    unpaidShutdownWarningSeconds?: number;
    powerUnpaidShutdownWarningSeconds?: number;
    creditShutdownWarningSeconds?: number;
    powerCreditShutdownWarningSeconds?: number;
    overloadFailure?: UiPowerOverloadFailure;
    powerOverloadFailure?: UiPowerOverloadFailure;
    overloadFailureSeconds?: number;
    powerOverloadFailureSeconds?: number;
    overloadFailureProgress?: number;
    powerOverloadFailureProgress?: number;
    overloadFailureRemainingSeconds?: number;
    powerOverloadFailureRemainingSeconds?: number;
    overloadFailureActive?: boolean;
    powerOverloadFailureActive?: boolean;
    overloadFailureTripped?: boolean;
    powerOverloadFailureTripped?: boolean;
    billingGraceSeconds?: number;
    powerBillingGraceSeconds?: number;
    controlsAvailable?: boolean;
    canControl?: boolean;
    canPowerOn?: boolean;
    canPowerOff?: boolean;
    canPowerKill?: boolean;
    canKillPower?: boolean;
    canRequestPowerOn?: boolean;
    canRequestPowerOff?: boolean;
    canTurnOn?: boolean;
    canTurnOff?: boolean;
  };
}

export interface UiCronSchedule {
  id?: string | number;
  scheduleId?: string | number;
  taskId?: string;
  enabled?: boolean;
  intervalSeconds?: number;
  intervalMinutes?: number;
  interval?: number;
  mode?: CronIntervalMode;
  minIntervalSeconds?: number;
  minimumSeconds?: number;
  remainingSeconds?: number;
  secondsRemaining?: number;
  countdownSeconds?: number;
  nextRunSeconds?: number;
  lastResult?: string | null;
  lastRunResult?: string | null;
  result?: string | null;
}

export interface UiCronState {
  unlocked?: boolean;
  enabled?: boolean;
  schedules?: UiCronSchedule[];
  rows?: UiCronSchedule[];
  minIntervalSeconds?: number;
  unlockedMinimumSeconds?: number;
  minimumSeconds?: number;
  minIntervalUpgradeId?: string;
}

export interface UiPowerState {
  state?: string;
  lifecycle?: string;
  drawWatts?: number;
  capacityWatts?: number;
  headroomWatts?: number;
  costPerSecond?: number;
  efficiency?: number;
  transitionSeconds?: number;
  powerTransitionSeconds?: number;
  transitionTotalSeconds?: number;
  powerTransitionTotalSeconds?: number;
  bootstrapGraceSeconds?: number;
  powerBootstrapGraceSeconds?: number;
  unpaidShutdownWarningSeconds?: number;
  powerUnpaidShutdownWarningSeconds?: number;
  creditShutdownWarningSeconds?: number;
  powerCreditShutdownWarningSeconds?: number;
  overloadFailure?: UiPowerOverloadFailure;
  powerOverloadFailure?: UiPowerOverloadFailure;
  overloadFailureSeconds?: number;
  powerOverloadFailureSeconds?: number;
  overloadFailureProgress?: number;
  powerOverloadFailureProgress?: number;
  overloadFailureRemainingSeconds?: number;
  powerOverloadFailureRemainingSeconds?: number;
  overloadFailureActive?: boolean;
  powerOverloadFailureActive?: boolean;
  overloadFailureTripped?: boolean;
  powerOverloadFailureTripped?: boolean;
  billingGraceSeconds?: number;
  powerBillingGraceSeconds?: number;
  controlsAvailable?: boolean;
  canControl?: boolean;
  canPowerOn?: boolean;
  canPowerOff?: boolean;
  canPowerKill?: boolean;
  canKillPower?: boolean;
  canRequestPowerOn?: boolean;
  canRequestPowerOff?: boolean;
  canTurnOn?: boolean;
  canTurnOff?: boolean;
}


export type UiVisibleState = VisibleState & {
  systems?: UiRackSystemSource[] | Record<string, UiRackSystemSource>;
  currentSystemId?: string;
  selectedSystemId?: string;
  rack?: {
    systems?: UiRackSystemSource[] | Record<string, UiRackSystemSource>;
    ownedSystems?: UiRackSystemSource[] | Record<string, UiRackSystemSource>;
    machines?: UiRackSystemSource[] | Record<string, UiRackSystemSource>;
    ownedMachines?: UiRackSystemSource[] | Record<string, UiRackSystemSource>;
    presets?: UiSystemPreset[];
    preconfiguredSystems?: UiSystemPreset[];
    templates?: UiSystemPreset[];
    customBuilder?: UiCustomMachineBuilder;
    customMachineBuilder?: UiCustomMachineBuilder;
    visible?: boolean;
    unlocked?: boolean;
    selectedSystemId?: string;
  };
  systemRack?: UiVisibleState["rack"];
  systemMarket?: {
    presets?: UiSystemPreset[];
    preconfiguredSystems?: UiSystemPreset[];
    templates?: UiSystemPreset[];
    customBuilder?: UiCustomMachineBuilder;
    customMachineBuilder?: UiCustomMachineBuilder;
  };
  tasks?: UiTask[];
  research?: UiResearch[];
  activeTasks?: UiActiveTask[];
  queue: UiQueueEntry[];
  systemStatus?: UiSystemStatus;
  cron?: UiCronState;
  automation?: { cron?: UiCronState };
  systemManagement?: {
    cron?: UiCronState;
    psuManagement?: boolean;
    powerManagement?: boolean;
    thermalControl?: boolean;
    power?: UiPowerState;
  };
  power?: UiPowerState;
  flags: VisibleState["flags"] & {
    cron?: boolean;
    cronScheduler?: boolean;
    cronAutomation?: boolean;
    psuManagement?: boolean;
    powerManagement?: boolean;
    thermalControl?: boolean;
  };
  hardware: VisibleState["hardware"] & {
    cron?: UiCronState;
    power?: UiPowerState;
    powerState?: string;
  };
  metrics: VisibleState["metrics"] & {
    ramLoad?: number;
    memoryPressure?: number;
    psuStress?: number;
    powerStress?: number;
    powerEfficiency?: number;
    powerBootstrapGraceSeconds?: number;
    billingGraceSeconds?: number;
    powerBillingGraceSeconds?: number;
    ramCpuMatch?: number;
    matchingEfficiency?: number;
    thermalStress?: number;
    coolingStress?: number;
    coolingStatus?: string;
    thermalStatus?: string;
    powerState?: string;
    powerTransitionTotalSeconds?: number;
  };
};

export const asUiVisible = (visible: VisibleState) =>
  visible as unknown as UiVisibleState;

export const normalizeRatio = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value > 5) return value / 100;
  return value;
};

export const isUiRecord = (value: unknown): value is UiRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const firstString = (...values: Array<unknown>) =>
  values.find((value): value is string => typeof value === "string" && value.length > 0);

export const normalizeRecordList = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) {
    return value.filter(isUiRecord) as T[];
  }

  if (!isUiRecord(value)) return [];

  const entries: T[] = [];
  Object.entries(value).forEach(([id, entry]) => {
    if (isUiRecord(entry)) entries.push({ ...entry, id: entry.id ?? id } as T);
  });
  return entries;
};
