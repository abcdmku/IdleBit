import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Cpu,
  Database,
  Eye,
  HardDrive,
  LayoutGrid,
  ListTodo,
  MemoryStick,
  Minus,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  Power,
  Plus,
  RefreshCw,
  Rows3,
  Server,
  ShoppingCart,
  SlidersHorizontal,
  Thermometer,
  TriangleAlert,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type {
  DeadlockResource,
  HardwareComponentId,
  SchedulerKillPolicy,
  SchedulerPolicy,
  SchedulerWatchdogPreview,
  UpgradeId,
  VisibleCore,
  VisibleCpuSocket,
  VisibleRamSlot,
  VisibleState,
  VisibleUpgrade,
} from "../game";
import {
  formatBits,
  formatClock,
  formatCost,
  formatNumber,
  formatWatts,
  type DisplayCost,
} from "./format";
import type { Dispatch, UiGameAction } from "./uiActions";
import {
  getSelectedSystemComponent,
  getSelectedSystemId,
  scopeSelectionToSystem,
  type SelectedComponent,
} from "./workbenchData";
import {
  CoreCacheRow,
  SystemBoard,
  SystemRack,
  SystemRail,
} from "./MotherboardLayout";

type TaskState =
  | "active"
  | "waiting"
  | "deadlock"
  | "rerun"
  | "restart"
  | "ready"
  | "locked";
type QueueMode = "core" | "scheduler" | "systemScheduler";
type TaskRouteLayer = QueueMode;
type ResourceKind = "data" | "credits";
type ResourceGainKind = ResourceKind;
type CacheSegmentKind = "read" | "write" | "overwrite" | "compute";
type CacheSegmentState = "buffering" | "loading" | "loaded";
type RamSegmentState = "reserved" | "loading" | "loaded";
type TaskCategoryId = "cpu" | "system" | "distributed" | "other";
type CoreGridDensity = "normal" | "compact" | "dense";
type CronIntervalMode = "seconds" | "minutes";
type PowerLifecycleState = "on" | "off" | "booting" | "shuttingDown";

const POWER_BOOT_SECONDS = 10;
const POWER_SHUTDOWN_SECONDS = 8;

interface UiPowerOverloadFailure {
  seconds?: number;
  limitSeconds?: number;
  remainingSeconds?: number;
  progress?: number;
  rate?: number;
  active?: boolean;
  tripped?: boolean;
}

interface CacheSegment {
  kind: CacheSegmentKind;
  state: CacheSegmentState;
  coreId: number;
  bits: number;
  bufferBits: number;
  readyBits: number;
  committedBits: number;
  progress: number;
  bufferProgress: number;
}

interface RamSegment {
  state: RamSegmentState;
  coreId: number;
  bits: number;
  progress: number;
}

interface ResourceGainBurst {
  id: number;
  kind: ResourceGainKind;
  amount: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const resourceVisuals: Record<
  ResourceKind,
  { label: string; Icon: LucideIcon }
> = {
  data: { label: "data", Icon: Database },
  credits: { label: "credits", Icon: Zap },
};

const isResourceKind = (resource: string): resource is ResourceKind =>
  resource === "data" || resource === "credits";

function ResourceAmount({
  resource,
  amount,
  plus = false,
  showLabel = true,
  compact = false,
  dimmed = false,
}: {
  resource: ResourceKind;
  amount: number;
  plus?: boolean;
  showLabel?: boolean;
  compact?: boolean;
  dimmed?: boolean;
}) {
  const { Icon, label } = resourceVisuals[resource];

  return (
    <span
      className={`resource-token ${resource} ${compact ? "compact" : ""} ${
        dimmed ? "dimmed" : ""
      }`}
    >
      <Icon size={compact ? 13 : 14} />
      <strong>
        {plus ? "+" : ""}
        {formatNumber(amount)}
      </strong>
      {showLabel && <span>{label}</span>}
    </span>
  );
}

function ResourceCost({
  costs,
  compact = false,
  resources,
}: {
  costs: DisplayCost[];
  compact?: boolean;
  resources?: VisibleState["resources"];
}) {
  if (costs.length === 0) return <span className="resource-cost empty">Open</span>;

  return (
    <span className={`resource-cost ${compact ? "compact" : ""}`}>
      {costs.map((cost, index) => {
        const key = `${cost.resource}-${index}`;

        if (!isResourceKind(cost.resource)) {
          return (
            <span className="resource-token unknown" key={key}>
              <strong>{formatNumber(cost.amount)}</strong>
              <span>{cost.resource}</span>
            </span>
          );
        }

        return (
          <ResourceAmount
            key={key}
            resource={cost.resource}
            amount={cost.amount}
            compact={compact}
            showLabel={!compact}
            dimmed={resources ? cost.amount > resources[cost.resource] : false}
          />
        );
      })}
    </span>
  );
}

interface UiTaskGraphNode {
  id?: string;
  name?: string;
  kind?: string;
  memoryAction?: string | null;
  count?: number;
  operationCount?: number;
  cycles?: number;
  requiredCycles?: number;
  cacheNeedBits?: number;
  cacheBits?: number;
  cacheNeedBytes?: number;
  cacheBytes?: number;
  ramNeedBits?: number;
  memoryNeedBits?: number;
  ramBits?: number;
  memoryBits?: number;
  ramNeedBytes?: number;
  memoryNeedBytes?: number;
  ramBytes?: number;
  requiredCores?: number;
  minCores?: number;
  parallel?: boolean;
  cacheFit?: "bonus" | "met" | "low";
  progress?: number;
  status?: string;
  state?: string;
  memoryState?: string;
  operationIds?: string[];
  dependencyIds?: string[];
  dependencies?: Array<string | { id?: string; name?: string }>;
  dependsOn?: Array<string | { id?: string; name?: string }>;
  requires?: Array<string | { id?: string; name?: string }>;
  operations?: number | UiTaskOperation[];
  subtasks?: UiTaskGraphNode[];
  subTasks?: UiTaskGraphNode[];
  dagNodes?: UiTaskGraphNode[];
  tasks?: UiTaskGraphNode[];
  children?: UiTaskGraphNode[];
}

interface UiTaskOperation extends UiTaskGraphNode {
  id: string;
  name: string;
  kind?: string;
  memoryAction?: string | null;
  count?: number;
}

interface UiTask {
  id: string;
  name: string;
  kind?: string;
  category?: string;
  operationCount?: number;
  operations?: number | UiTaskOperation[];
  opCount?: number;
  requiredOps?: number;
  requiredOperations?: number;
  requiredCycles?: number;
  requiredCores?: number;
  minCores?: number;
  coreScaling?: "fixed" | "elastic";
  rewardCredits?: number;
  rewardData?: number;
  rewards?: Partial<Record<"credits" | "data", number>>;
  cacheNeedBits?: number;
  cacheBits?: number;
  cacheNeedBytes?: number;
  cacheBytes?: number;
  ramNeedBits?: number;
  memoryNeedBits?: number;
  ramBits?: number;
  memoryBits?: number;
  ramNeedBytes?: number;
  memoryNeedBytes?: number;
  ramBytes?: number;
  cacheFit?: "bonus" | "met" | "low";
  progress?: number;
  canStart?: boolean;
  canRun?: boolean;
  canQueue?: boolean;
  blockedReason?: string | null;
  queueBlockedReason?: string | null;
  lockedReason?: string | null;
  lockReason?: string | null;
  unlockReason?: string | null;
  status?: string;
  state?: string;
  completed?: boolean;
  completedCount?: number;
  completionCount?: number;
  repeatable?: boolean;
  operationIds?: string[];
  dependencyIds?: string[];
  dependencies?: Array<string | { id?: string; name?: string }>;
  dependsOn?: Array<string | { id?: string; name?: string }>;
  requires?: Array<string | { id?: string; name?: string }>;
  subtasks?: UiTaskGraphNode[];
  subTasks?: UiTaskGraphNode[];
  dagNodes?: UiTaskGraphNode[];
  tasks?: UiTaskGraphNode[];
  children?: UiTaskGraphNode[];
}

interface UiActiveTask {
  instanceId?: string;
  taskId?: string;
  schedulerQueued?: boolean;
  name: string;
  coreId: number;
  assignedCoreIds?: number[];
  progress: number;
  status?: string;
  state?: string;
  memoryState?: string;
  activeOperationName?: string | null;
  coreProgress?: Array<{
    coreId: number;
    operationId: string | null;
    operationName: string | null;
    memoryAction?: string | null;
    status?: string;
    memoryState?: string;
    progress: number;
    remainingCycles?: number;
    totalCycles?: number;
    remainingLoadCycles?: number;
    totalLoadCycles?: number;
    cacheBits?: number;
    memoryReservedBits?: number;
    memoryReservedBytes?: number;
    lockResource?: DeadlockResource | null;
    lockReason?: string | null;
    deadlockSeconds?: number;
  }>;
  lockResource?: DeadlockResource | null;
  lockReason?: string | null;
}

interface UiResearchRequirement {
  id: string;
  label: string;
  kind?: string;
  met?: boolean;
}

interface UiResearchComputeTask extends UiTask {
  active?: boolean;
  progress?: number;
}

interface UiResearch {
  id: string;
  name: string;
  description?: string;
  costs?: DisplayCost[];
  cost?: DisplayCost[];
  canAfford?: boolean;
  canBuy?: boolean;
  lockedReason?: string | null;
  lockReason?: string | null;
  unlockReason?: string | null;
  purchased?: boolean;
  completed?: boolean;
  blockedReason?: string | null;
  requirements?: UiResearchRequirement[];
  computeTasks?: UiResearchComputeTask[];
  status?: string;
  accent?: "cyan" | "green" | "violet" | "amber";
}

type UiQueueEntry =
  | string
  | {
      id?: string;
      taskId?: string;
      name?: string;
      socketId?: number;
      coreId?: number;
      state?: string;
      status?: string;
    };

interface UiQueueDisplayItem {
  id: string;
  name: string;
  waitingReason: string;
  instanceId?: string;
  active: boolean;
  deadlocked?: boolean;
}

interface UiSystemStatus {
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
  powerTransitionSeconds?: number;
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
    bootstrapGraceSeconds?: number;
    powerBootstrapGraceSeconds?: number;
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

interface UiCronSchedule {
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

interface UiCronState {
  unlocked?: boolean;
  enabled?: boolean;
  schedules?: UiCronSchedule[];
  rows?: UiCronSchedule[];
  minIntervalSeconds?: number;
  unlockedMinimumSeconds?: number;
  minimumSeconds?: number;
  minIntervalUpgradeId?: string;
}

interface UiPowerState {
  state?: string;
  lifecycle?: string;
  drawWatts?: number;
  capacityWatts?: number;
  headroomWatts?: number;
  costPerSecond?: number;
  efficiency?: number;
  transitionSeconds?: number;
  powerTransitionSeconds?: number;
  bootstrapGraceSeconds?: number;
  powerBootstrapGraceSeconds?: number;
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

type UiRecord = Record<string, unknown>;

interface UiRackSystemSource extends UiRecord {
  id?: string | number;
  systemId?: string | number;
  machineId?: string | number;
  name?: string;
  label?: string;
  role?: string;
  tier?: string;
  status?: string;
  powerState?: string;
  cores?: number;
  coreCount?: number;
  ramBits?: number;
  ramBytes?: number;
  powerUsedWatts?: number;
  visible?: UiRecord;
  visibleState?: UiRecord;
  state?: UiRecord;
  hardware?: UiRecord;
  metrics?: UiRecord;
  flags?: UiRecord;
  resources?: UiRecord;
  cron?: UiRecord;
  tasks?: unknown[];
  activeTasks?: unknown[];
  queue?: unknown[];
  upgrades?: unknown[];
}

interface UiRackSystem {
  id: string;
  name: string;
  role: string;
  tier: string | null;
  status: string;
  visible: VisibleState;
  cores: number;
  ramBits: number;
  drawWatts: number;
  source: UiRackSystemSource | null;
}

interface UiSystemPreset {
  id?: string | number;
  presetId?: string | number;
  templateId?: string | number;
  name?: string;
  label?: string;
  role?: string;
  description?: string;
  tier?: string;
  costs?: DisplayCost[];
  cost?: DisplayCost[];
  price?: DisplayCost[];
  canAfford?: boolean;
  canBuy?: boolean;
  disabled?: boolean;
  blockedReason?: string | null;
  lockedReason?: string | null;
  powerDeltaWatts?: number;
  cores?: number;
  coreCount?: number;
  ramBits?: number;
  ramBytes?: number;
  cacheBits?: number;
  cacheBytes?: number;
  actionType?: string;
}

interface UiCustomMachineTier {
  id?: string | number;
  tierId?: string | number;
  name?: string;
  label?: string;
  description?: string;
  costs?: DisplayCost[];
  cost?: DisplayCost[];
  price?: DisplayCost[];
  canAfford?: boolean;
  canSelect?: boolean;
  disabled?: boolean;
  blockedReason?: string | null;
  cores?: number;
  coreCount?: number;
  ramBits?: number;
  ramBytes?: number;
  cacheBits?: number;
  cacheBytes?: number;
  powerDeltaWatts?: number;
}

interface UiCustomMachineGroup {
  id?: string | number;
  slotId?: string | number;
  component?: string;
  name?: string;
  label?: string;
  tiers?: UiCustomMachineTier[];
  options?: UiCustomMachineTier[];
}

interface UiCustomMachineBuilder {
  title?: string;
  name?: string;
  groups?: UiCustomMachineGroup[];
  slots?: UiCustomMachineGroup[];
  tiers?: UiCustomMachineGroup[];
  components?: UiCustomMachineGroup[];
  costs?: DisplayCost[];
  cost?: DisplayCost[];
  canAfford?: boolean;
  canBuy?: boolean;
  blockedReason?: string | null;
  lockedReason?: string | null;
  actionType?: string;
}

interface UiRackData {
  systems: UiRackSystem[];
  presets: UiSystemPreset[];
  customBuilder: UiCustomMachineBuilder | null;
  showRack: boolean;
  hasSystemModel: boolean;
  selectedSystemId: string | null;
}

type UiCore = VisibleCore & { activeTask?: UiActiveTask | null };

type UiVisibleState = VisibleState & {
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
  };
};

interface HardwareBoardProps {
  visible: VisibleState;
  dispatch: Dispatch;
  selectedComponent: SelectedComponent;
  onSelectComponent: (component: SelectedComponent) => void;
  deadlockHelpResource?: DeadlockResource | null;
  deadlockCooldownHelpResource?: DeadlockResource | null;
  showPsuFailureHelp?: boolean;
  onDismissDeadlockHelp?: () => void;
  onDismissDeadlockCooldownHelp?: () => void;
  onDismissPsuFailureHelp?: () => void;
}

function getSelectedCoreId(selection: SelectedComponent) {
  if (!selection?.startsWith("core:")) return null;

  const coreId = Number(selection.slice("core:".length));
  return Number.isFinite(coreId) ? coreId : null;
}

function getSelectedCoreGroupCpuId(selection: SelectedComponent) {
  if (!selection?.startsWith("cores:")) return null;

  const cpuId = Number(selection.slice("cores:".length));
  return Number.isFinite(cpuId) ? cpuId : null;
}

function getSelectedSchedulerId(selection: SelectedComponent) {
  if (!selection?.startsWith("scheduler:")) return null;

  const socketId = Number(selection.slice("scheduler:".length));
  return Number.isFinite(socketId) ? socketId : null;
}

function getSelectedRamStickId(selection: SelectedComponent) {
  if (!selection?.startsWith("ramStick:")) return null;

  const stickId = Number(selection.slice("ramStick:".length));
  return Number.isFinite(stickId) ? stickId : null;
}

const isRamSelection = (selection: SelectedComponent) =>
  selection === "ram" ||
  selection === "ramSticks" ||
  Boolean(selection?.startsWith("ramStick:"));

const asUiVisible = (visible: VisibleState) =>
  visible as unknown as UiVisibleState;

const clampMeter = (value: number | null) =>
  Math.min(1, Math.max(0, value ?? 0));

const normalizeRatio = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value > 5) return value / 100;
  return value;
};

const formatPercent = (ratio: number | null) =>
  ratio === null ? "N/A" : `${formatNumber(Math.max(0, ratio) * 100)}%`;

const formatPowerRate = (creditsPerSecond: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: creditsPerSecond >= 1 ? 1 : 3,
  }).format(creditsPerSecond);

const firstNumber = (...values: Array<number | null | undefined>) =>
  values.find((value): value is number => typeof value === "number");

const firstPositiveNumber = (...values: Array<number | null | undefined>) =>
  values.find(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value > 0,
  );

const firstBoolean = (...values: Array<boolean | null | undefined>) =>
  values.find((value): value is boolean => typeof value === "boolean");

const bytesToBits = (bytes: number | null | undefined) =>
  typeof bytes === "number" ? bytes * 8 : undefined;

const firstBits = (
  bitValues: Array<number | null | undefined>,
  byteValues: Array<number | null | undefined>,
) => firstNumber(...bitValues) ?? bytesToBits(firstNumber(...byteValues)) ?? 0;

const getHardware = (visible: VisibleState) =>
  visible.hardware as VisibleState["hardware"] & {
    cacheBits?: number;
    ramBits?: number;
    memoryBits?: number;
    systemSchedulerSlots?: number;
  };

const isUiRecord = (value: unknown): value is UiRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const firstString = (...values: Array<unknown>) =>
  values.find((value): value is string => typeof value === "string" && value.length > 0);

const normalizeRecordList = <T,>(value: unknown): T[] => {
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

const getRackRecord = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  return (ui.rack ?? ui.systemRack ?? null) as UiVisibleState["rack"] | null;
};

const getSystemSourceId = (system: UiRackSystemSource, index: number) => {
  const id = system.id ?? system.systemId ?? system.machineId;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : `system-${index + 1}`;
};

const getVisibleSelectedSystemId = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  const rack = getRackRecord(visible);
  const id = ui.selectedSystemId ?? ui.currentSystemId ?? rack?.selectedSystemId;
  if (typeof id === "string" || typeof id === "number") return String(id);
  return null;
};

const mergeVisibleForSystem = (
  visible: VisibleState,
  system: UiRackSystemSource,
): VisibleState => {
  const nested =
    (isUiRecord(system.visible) && system.visible) ||
    (isUiRecord(system.visibleState) && system.visibleState) ||
    (isUiRecord(system.state) && system.state) ||
    {};
  const source = { ...system, ...nested };

  return {
    ...visible,
    ...source,
    resources: isUiRecord(source.resources)
      ? { ...visible.resources, ...source.resources }
      : visible.resources,
    flags: isUiRecord(source.flags)
      ? { ...visible.flags, ...source.flags }
      : visible.flags,
    hardware: isUiRecord(source.hardware)
      ? { ...visible.hardware, ...source.hardware }
      : visible.hardware,
    metrics: isUiRecord(source.metrics)
      ? { ...visible.metrics, ...source.metrics }
      : visible.metrics,
    cron: isUiRecord(source.cron)
      ? { ...visible.cron, ...source.cron }
      : visible.cron,
    tasks: Array.isArray(source.tasks) ? source.tasks : visible.tasks,
    activeTasks: Array.isArray(source.activeTasks)
      ? source.activeTasks
      : visible.activeTasks,
    queue: Array.isArray(source.queue) ? source.queue : visible.queue,
    upgrades: Array.isArray(source.upgrades) ? source.upgrades : visible.upgrades,
  } as VisibleState;
};

const getSystemSources = (visible: VisibleState): UiRackSystemSource[] => {
  const ui = asUiVisible(visible);
  const rack = getRackRecord(visible);
  const sources = [
    normalizeRecordList<UiRackSystemSource>(rack?.systems),
    normalizeRecordList<UiRackSystemSource>(rack?.ownedSystems),
    normalizeRecordList<UiRackSystemSource>(rack?.machines),
    normalizeRecordList<UiRackSystemSource>(rack?.ownedMachines),
    normalizeRecordList<UiRackSystemSource>(ui.systems),
  ];

  return sources.find((source) => source.length > 0) ?? [];
};

const getSystemCores = (systemVisible: VisibleState, source: UiRackSystemSource) =>
  firstNumber(
    typeof source.cores === "number" ? source.cores : undefined,
    typeof source.coreCount === "number" ? source.coreCount : undefined,
    systemVisible.hardware.cores,
    systemVisible.metrics.cpuSockets.reduce(
      (total, socket) => total + socket.cores.length,
      0,
    ),
  ) ?? 0;

const getSystemRamBits = (systemVisible: VisibleState, source: UiRackSystemSource) =>
  firstBits(
    [
      typeof source.ramBits === "number" ? source.ramBits : undefined,
      systemVisible.hardware.ramBits,
    ],
    [
      typeof source.ramBytes === "number" ? source.ramBytes : undefined,
      systemVisible.hardware.ramBytes,
    ],
  );

const getSystemDrawWatts = (
  systemVisible: VisibleState,
  source: UiRackSystemSource,
) =>
  firstNumber(
    typeof source.powerUsedWatts === "number" ? source.powerUsedWatts : undefined,
    systemVisible.metrics.powerUsedWatts,
  ) ?? 0;

const toRackSystem = (
  visible: VisibleState,
  source: UiRackSystemSource,
  index: number,
): UiRackSystem => {
  const systemVisible = mergeVisibleForSystem(visible, source);
  const id = getSystemSourceId(source, index);
  const powerState =
    firstString(source.powerState, source.status, systemVisible.metrics.powerState) ??
    "on";

  return {
    id,
    name:
      firstString(source.name, source.label, systemVisible.stageLabel) ??
      `System ${index + 1}`,
    role: firstString(source.role, source.tier) ?? (index === 0 ? "Primary" : "Node"),
    tier: firstString(source.tier) ?? null,
    status: powerState,
    visible: systemVisible,
    cores: getSystemCores(systemVisible, source),
    ramBits: getSystemRamBits(systemVisible, source),
    drawWatts: getSystemDrawWatts(systemVisible, source),
    source,
  };
};

const getFallbackRackSystem = (visible: VisibleState): UiRackSystem => ({
  id: "primary",
  name: "Primary",
  role: "Local",
  tier: null,
  status: visible.metrics.powerState,
  visible,
  cores: visible.hardware.cores,
  ramBits: getVisibleRamBits(visible),
  drawWatts: visible.metrics.powerUsedWatts,
  source: null,
});

const normalizeCosts = (value: unknown): DisplayCost[] =>
  Array.isArray(value)
    ? value
        .map((cost) => {
          if (!isUiRecord(cost)) return null;
          const resource = cost.resource;
          const amount = cost.amount;
          return typeof resource === "string" && typeof amount === "number"
            ? { resource, amount }
            : null;
        })
        .filter((cost): cost is DisplayCost => cost !== null)
    : [];

const getRecordCosts = (record: {
  costs?: DisplayCost[];
  cost?: DisplayCost[];
  price?: DisplayCost[];
}) =>
  normalizeCosts(record.costs).length > 0
    ? normalizeCosts(record.costs)
    : normalizeCosts(record.cost).length > 0
      ? normalizeCosts(record.cost)
      : normalizeCosts(record.price);

const getPresetId = (preset: UiSystemPreset, index: number) => {
  const id = preset.id ?? preset.presetId ?? preset.templateId;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : `preset-${index + 1}`;
};

const getPresetLabel = (preset: UiSystemPreset, index: number) =>
  firstString(preset.name, preset.label) ?? `System ${index + 1}`;

const getTierId = (tier: UiCustomMachineTier, index: number) => {
  const id = tier.id ?? tier.tierId;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : `tier-${index + 1}`;
};

const getTierLabel = (tier: UiCustomMachineTier, index: number) =>
  firstString(tier.name, tier.label) ?? `Tier ${index + 1}`;

const getBuilderGroupId = (group: UiCustomMachineGroup, index: number) => {
  const id = group.id ?? group.slotId ?? group.component;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : `slot-${index + 1}`;
};

const getBuilderGroupLabel = (group: UiCustomMachineGroup, index: number) =>
  firstString(group.name, group.label, group.component) ?? `Slot ${index + 1}`;

const getBuilderGroups = (builder: UiCustomMachineBuilder | null) =>
  (
    builder?.groups ??
    builder?.slots ??
    builder?.tiers ??
    builder?.components ??
    []
  ).filter((group) => {
    const options = group.tiers ?? group.options ?? [];
    return options.length > 0;
  });

const getBuilderSelections = (
  groups: UiCustomMachineGroup[],
  current: Record<string, string>,
) => {
  const next: Record<string, string> = {};

  groups.forEach((group, groupIndex) => {
    const groupId = getBuilderGroupId(group, groupIndex);
    const options = group.tiers ?? group.options ?? [];
    const optionIds = options.map(getTierId);
    next[groupId] = optionIds.includes(current[groupId] ?? "")
      ? current[groupId]!
      : (optionIds[0] ?? "");
  });

  return next;
};

const getSelectedBuilderTiers = (
  groups: UiCustomMachineGroup[],
  selections: Record<string, string>,
) =>
  groups
    .map((group, groupIndex) => {
      const groupId = getBuilderGroupId(group, groupIndex);
      const options = group.tiers ?? group.options ?? [];
      return (
        options.find((tier, tierIndex) => getTierId(tier, tierIndex) === selections[groupId]) ??
        null
      );
    })
    .filter((tier): tier is UiCustomMachineTier => tier !== null);

const sumCosts = (costRows: DisplayCost[][]) => {
  const totals = new Map<string, number>();

  costRows.flat().forEach((cost) => {
    totals.set(cost.resource, (totals.get(cost.resource) ?? 0) + cost.amount);
  });

  return Array.from(totals.entries()).map(
    ([resource, amount]): DisplayCost => ({ resource, amount }),
  );
};

const getRackPresets = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  const rack = getRackRecord(visible);
  const market = ui.systemMarket;
  const machineBuilder = isUiRecord(ui.machineBuilder) ? ui.machineBuilder : null;
  const builderUnlocked = machineBuilder?.unlocked === true;
  const presetSources = [
    rack?.preconfiguredSystems,
    rack?.presets,
    rack?.templates,
    market?.preconfiguredSystems,
    market?.presets,
    market?.templates,
    builderUnlocked ? machineBuilder?.templates : undefined,
  ];

  return presetSources.find((source) => (source?.length ?? 0) > 0) ?? [];
};

const getMachineBuilder = (visible: VisibleState): UiCustomMachineBuilder | null => {
  const ui = asUiVisible(visible);
  const machineBuilder = isUiRecord(ui.machineBuilder) ? ui.machineBuilder : null;
  if (machineBuilder?.unlocked !== true) return null;

  const components = isUiRecord(machineBuilder.components)
    ? machineBuilder.components
    : null;
  if (!components) return null;

  const labels: Record<string, string> = {
    cpu: "CPU",
    ram: "RAM",
    scheduler: "Sched",
    psu: "PSU",
  };
  const componentRecord = components as Record<string, unknown>;
  const groups: UiCustomMachineGroup[] = Object.entries(labels).flatMap(([id, label]) => {
    const options = normalizeRecordList<UiCustomMachineTier>(componentRecord[id]);
    return options.length > 0
      ? [
          {
            id,
            label,
            tiers: options,
          },
        ]
      : [];
  });

  return groups.length > 0
    ? {
        title: "Custom",
        groups,
        canBuy: true,
      }
    : null;
};

const getRackCustomBuilder = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  const rack = getRackRecord(visible);
  return (
    rack?.customBuilder ??
    rack?.customMachineBuilder ??
    ui.systemMarket?.customBuilder ??
    ui.systemMarket?.customMachineBuilder ??
    getMachineBuilder(visible) ??
    null
  );
};

const hasRackUnlockSignal = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  const rack = getRackRecord(visible);
  const flags = ui.flags as VisibleState["flags"] & {
    systems?: boolean;
    multiSystem?: boolean;
    multipleSystems?: boolean;
    rack?: boolean;
    systemRack?: boolean;
  };

  return Boolean(
    rack?.visible ??
      rack?.unlocked ??
      flags.systems ??
      flags.multiSystem ??
      flags.multipleSystems ??
      flags.rack ??
      flags.systemRack,
  );
};

const getRackData = (visible: VisibleState): UiRackData => {
  const sources = getSystemSources(visible);
  const systems =
    sources.length > 0
      ? sources.map((source, index) => toRackSystem(visible, source, index))
      : [getFallbackRackSystem(visible)];
  const presets = getRackPresets(visible);
  const customBuilder = getRackCustomBuilder(visible);
  const hasSystemModel = sources.length > 0;
  const showRack =
    hasRackUnlockSignal(visible) ||
    systems.length > 1 ||
    presets.length > 0 ||
    getBuilderGroups(customBuilder).length > 0;

  return {
    systems,
    presets,
    customBuilder,
    showRack,
    hasSystemModel,
    selectedSystemId: getVisibleSelectedSystemId(visible),
  };
};

const getSystemScopedAction = (
  action: UiGameAction,
  systemId: string | null,
) => {
  if (!systemId || "systemId" in action) return action;
  const numericId = Number(systemId);
  const actionSystemId =
    Number.isInteger(numericId) && String(numericId) === systemId
      ? numericId
      : systemId;
  return { ...action, systemId: actionSystemId } as UiGameAction;
};

const createSystemDispatch =
  (dispatch: Dispatch, systemId: string | null): Dispatch =>
  (action) =>
    dispatch(getSystemScopedAction(action, systemId));

const getCoreGridMetrics = (coreCount: number) => {
  const count = Math.max(1, coreCount);
  let rows = 1;
  let columns = 2;

  if (count <= 2) {
    rows = 1;
    columns = 2;
  } else if (count <= 4) {
    rows = 2;
    columns = 2;
  } else if (count <= 8) {
    rows = 2;
    columns = 4;
  } else if (count <= 12) {
    rows = 2;
    columns = 6;
  } else if (count <= 16) {
    rows = 2;
    columns = 8;
  } else if (count <= 24) {
    rows = 2;
    columns = 12;
  } else if (count <= 32) {
    rows = 2;
    columns = 16;
  } else {
    rows = Math.ceil(count / 16);
    columns = 16;
  }

  const density: CoreGridDensity =
    columns >= 12 ? "dense" : columns >= 4 ? "compact" : "normal";

  return {
    rows,
    columns,
    density,
    label: `${rows}x${columns}`,
    fullWidth: columns >= 12,
  };
};

const getTasks = (visible: VisibleState): UiTask[] => {
  const ui = asUiVisible(visible);
  return ((ui.tasks ?? []) as unknown) as UiTask[];
};

const getResearch = (visible: VisibleState): UiResearch[] =>
  ((asUiVisible(visible).research ?? []) as unknown) as UiResearch[];

const getActiveTasks = (visible: VisibleState): UiActiveTask[] => {
  const ui = asUiVisible(visible);
  return ((ui.activeTasks ?? []) as unknown) as UiActiveTask[];
};

const getQueueEntries = (visible: VisibleState): UiQueueEntry[] =>
  ((asUiVisible(visible).queue ?? []) as unknown) as UiQueueEntry[];

const getActiveTaskId = (task: UiActiveTask) => task.taskId ?? "";

const getQueueTaskId = (entry: UiQueueEntry) => {
  if (typeof entry === "string") return entry;
  return entry.taskId ?? entry.id ?? "";
};

const hasValue = <T,>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;

const getCoreActiveTask = (core: VisibleCore) => {
  const uiCore = core as UiCore;
  return uiCore.activeTask ?? null;
};

const getAllCores = (visible: VisibleState) =>
  visible.metrics.cpuSockets.flatMap((socket) => socket.cores);

const getCacheSpeedHz = (visible: VisibleState) => {
  const cacheSpeedLevel = getHardware(visible).cacheSpeedLevel ?? 1;
  return Math.round(1 * 1.45 ** (cacheSpeedLevel - 1) * 10) / 10;
};

const getCacheSegmentKind = (
  action: string | null | undefined,
): CacheSegmentKind =>
  action === "overwrite"
    ? "overwrite"
    : action === "write"
      ? "write"
      : action === "read"
        ? "read"
        : "compute";

const getLegacyCacheReadyBits = (
  bits: number,
  state: CacheSegmentState,
  progress: number,
  bufferProgress: number,
) => {
  if (state === "loaded") return bits;
  if (state === "buffering") return bits * Math.min(progress, bufferProgress);
  return bits * progress;
};

const toCacheSegment = (segment: VisibleState["metrics"]["cacheResidency"][number]): CacheSegment => {
  const state = segment.state ?? "loaded";
  const progress = clampMeter(segment.progress ?? 1);
  const bufferProgress = clampMeter(segment.bufferProgress ?? 1);
  const readyBits =
    segment.readyBits ?? getLegacyCacheReadyBits(segment.bits, state, progress, bufferProgress);
  const bufferBits =
    segment.bufferBits ??
    (state === "buffering"
      ? Math.max(0, segment.bits * bufferProgress - readyBits)
      : 0);
  const committedBits = segment.committedBits ?? readyBits + bufferBits;

  return {
    kind: getCacheSegmentKind(segment.memoryAction),
    state: bufferBits > 0 ? "buffering" : "loaded",
    coreId: segment.coreId,
    bits: segment.bits,
    readyBits,
    bufferBits,
    committedBits,
    progress,
    bufferProgress,
  };
};

const getCacheReservation = (visible: VisibleState) => {
  const metricSegments = visible.metrics.cacheResidency ?? [];
  if (metricSegments.length > 0) {
    const segments = metricSegments.map(toCacheSegment);

    return {
      segments,
      reservedBits: segments.reduce((total, segment) => total + segment.committedBits, 0),
      loadingBits: segments.reduce((total, segment) => total + segment.bufferBits, 0),
    };
  }

  const tasksById = new Map(getTasks(visible).map((task) => [task.id, task]));
  const segments: CacheSegment[] = [];
  let reservedBits = 0;
  let loadingBits = 0;

  for (const activeTask of getActiveTasks(visible)) {
    const task = tasksById.get(activeTask.taskId ?? "");
    if (!task) continue;

    const taskCacheBits = getTaskCacheBits(task);
    const activeOperations =
      activeTask.coreProgress?.filter(
        (operation) =>
          operation.status !== "complete" &&
          (operation.cacheBits ?? taskCacheBits) > 0,
      ) ?? [];
    const operationCacheBits = new Map<string, number>(
      Array.isArray(task.operations)
        ? task.operations.map(
            (operation): [string, number] => [
              operation.id,
              getNodeCacheBits(operation),
            ],
          )
        : [],
    );
    const operationMemoryActions = new Map<string, string | null>(
      Array.isArray(task.operations)
        ? task.operations.map(
            (operation): [string, string | null] => [
              operation.id,
              operation.memoryAction ?? null,
            ],
          )
        : [],
    );

    for (const operation of activeOperations) {
      const mappedBits = operation.operationId
        ? operationCacheBits.get(operation.operationId)
        : undefined;
      const operationBits = operation.cacheBits ?? mappedBits ?? taskCacheBits;
      if (operationBits <= 0) continue;

      const mappedAction = operation.operationId
        ? operationMemoryActions.get(operation.operationId)
        : null;
      const action = operation.memoryAction ?? mappedAction ?? "compute";
      const kind = getCacheSegmentKind(action);
      const loadProgress =
        (operation.totalLoadCycles ?? 0) > 0
          ? 1 -
            (operation.remainingLoadCycles ?? 0) /
              Math.max(operation.totalLoadCycles ?? 1, 1)
          : 1;
      const cpuProgress =
        (operation.totalCycles ?? 0) > 0
          ? 1 -
            (operation.remainingCycles ?? 0) / Math.max(operation.totalCycles ?? 1, 1)
          : 1;
      const state: CacheSegmentState =
        operation.status === "loadingCache" && action !== "compute" && cpuProgress < 1
          ? "buffering"
          : operation.status === "loadingCache"
            ? "loading"
            : "loaded";
      segments.push({
        kind,
        state: state === "buffering" ? "buffering" : "loaded",
        coreId: operation.coreId,
        bits: operationBits,
        readyBits: operationBits * clampMeter(loadProgress),
        bufferBits:
          state === "buffering"
            ? Math.max(
                0,
                operationBits * clampMeter(cpuProgress) -
                  operationBits * clampMeter(loadProgress),
              )
            : 0,
        committedBits:
          state === "buffering"
            ? operationBits * clampMeter(cpuProgress)
            : operationBits * clampMeter(loadProgress),
        progress: clampMeter(loadProgress),
        bufferProgress: clampMeter(cpuProgress),
      });
      const committedBits = segments[segments.length - 1]?.committedBits ?? 0;
      const bufferBits = segments[segments.length - 1]?.bufferBits ?? 0;
      reservedBits += committedBits;
      if (
        operation.status === "loadingCache" ||
        operation.memoryState === "cacheLoad"
      ) {
        loadingBits += bufferBits;
      }
    }
  }

  return { segments, reservedBits, loadingBits };
};

const emptyCacheStateBits = (): Record<CacheSegmentState, number> => ({
  buffering: 0,
  loading: 0,
  loaded: 0,
});

const getCacheStateBits = (segments: CacheSegment[]) =>
  segments.reduce((totals, segment) => {
    totals.buffering += segment.bufferBits;
    totals.loaded += segment.readyBits;
    return totals;
  }, emptyCacheStateBits());

const getCachePrimaryState = (segments: CacheSegment[]) => {
  if (segments.some((segment) => segment.bufferBits > 0)) return "Buffer";
  if (segments.some((segment) => segment.readyBits > 0)) return "Ready";
  return "Idle";
};

const getCacheSegmentWriteProgress = (segment: CacheSegment) => {
  if (segment.state === "loaded") return 1;
  return clampMeter(segment.progress);
};

const getRamReservation = (visible: VisibleState) => {
  const segments = (visible.metrics.ramResidency ?? []).map(
    (segment): RamSegment => ({
      state: segment.state ?? "loaded",
      coreId: segment.coreId,
      bits: segment.bits,
      progress: clampMeter(segment.progress ?? 1),
    }),
  );

  return {
    segments,
    reservedBits: segments.reduce((total, segment) => total + segment.bits, 0),
    loadingBits: segments
      .filter((segment) => segment.state === "reserved" || segment.state === "loading")
      .reduce((total, segment) => total + segment.bits, 0),
  };
};

const emptyRamStateBits = (): Record<RamSegmentState, number> => ({
  reserved: 0,
  loading: 0,
  loaded: 0,
});

const getRamSegmentFilledBits = (segment: RamSegment) => {
  if (segment.state === "loaded") return segment.bits;
  if (segment.state === "reserved") return 0;
  return segment.bits * clampMeter(segment.progress);
};

const getRamStateBits = (segments: RamSegment[]) =>
  segments.reduce((totals, segment) => {
    totals[segment.state] += getRamSegmentFilledBits(segment);
    return totals;
  }, emptyRamStateBits());

const getRamPrimaryState = (segments: RamSegment[]) => {
  if (segments.some((segment) => segment.state === "loading")) return "Load";
  if (segments.some((segment) => segment.state === "reserved")) return "Stage";
  if (segments.some((segment) => segment.state === "loaded")) return "Ready";
  return "Idle";
};

const getRamModuleFrequencyLabel = (
  slots: VisibleRamSlot[],
  fallbackSpeedMt: number,
) => {
  const speeds = Array.from(
    new Set(
      (slots.length > 0 ? slots.map((slot) => slot.speedMt) : [fallbackSpeedMt])
        .filter((speed) => speed > 0),
    ),
  ).sort((a, b) => a - b);

  if (speeds.length <= 0) return formatClock(1);
  if (speeds.length === 1) return formatClock(speeds[0] ?? 1);

  return `${formatClock(speeds[0] ?? 1)}-${formatClock(speeds.at(-1) ?? 1)}`;
};

const getRamSegmentsBySlot = (
  slots: VisibleRamSlot[],
  segments: RamSegment[],
) => {
  const segmentsBySlot = new Map<number, RamSegment[]>(
    slots.map((slot) => [slot.id, []]),
  );
  let slotIndex = 0;
  let remainingSlotBits = slots[0]?.sizeBits ?? 0;

  for (const segment of segments) {
    let remainingSegmentBits = segment.bits;

    while (remainingSegmentBits > 0 && slotIndex < slots.length) {
      const slot = slots[slotIndex];
      if (!slot) break;

      if (remainingSlotBits <= 0) {
        slotIndex += 1;
        remainingSlotBits = slots[slotIndex]?.sizeBits ?? 0;
        continue;
      }

      const bits = Math.min(remainingSegmentBits, remainingSlotBits);
      segmentsBySlot.get(slot.id)?.push({ ...segment, bits });
      remainingSegmentBits -= bits;
      remainingSlotBits -= bits;
    }
  }

  return segmentsBySlot;
};

const getOperationCountFromOperations = (operations: UiTaskOperation[]) =>
  operations.reduce((total, operation) => total + (operation.count ?? 1), 0);

const getTaskOperationCount = (task: UiTask) =>
  firstNumber(
    task.operationCount,
    typeof task.operations === "number" ? task.operations : undefined,
    task.opCount,
    task.requiredOps,
    task.requiredOperations,
    task.requiredCycles,
    Array.isArray(task.operations)
      ? getOperationCountFromOperations(task.operations)
      : undefined,
  );

const getNodeCacheBits = (node: UiTaskGraphNode) =>
  firstBits(
    [node.cacheNeedBits, node.cacheBits],
    [node.cacheNeedBytes, node.cacheBytes],
  );

const getNodeRamBits = (node: UiTaskGraphNode) =>
  firstBits(
    [node.ramNeedBits, node.memoryNeedBits, node.ramBits, node.memoryBits],
    [node.ramNeedBytes, node.memoryNeedBytes, node.ramBytes],
  );

const getTaskCacheBits = (task: UiTask) => getNodeCacheBits(task);
const getTaskRamBits = (task: UiTask) => getNodeRamBits(task);

const getVisibleCacheBits = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  const hardware = getHardware(visible);
  return firstBits(
    [ui.systemStatus?.cacheBits, ui.systemStatus?.cache?.capacityBits, hardware.cacheBits],
    [
      ui.systemStatus?.cacheBytes,
      ui.systemStatus?.cache?.capacityBytes,
      visible.hardware.cacheBytes,
    ],
  );
};

const getVisibleRamBits = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  const hardware = getHardware(visible);
  return firstBits(
    [
      ui.systemStatus?.ramBits,
      ui.systemStatus?.memoryBits,
      ui.systemStatus?.memory?.capacityBits,
      hardware.ramBits,
      hardware.memoryBits,
    ],
    [
      ui.systemStatus?.ramBytes,
      ui.systemStatus?.memory?.capacityBytes,
      visible.hardware.ramBytes,
    ],
  );
};

const getVisibleRamUsedBits = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  return firstBits(
    [
      ui.systemStatus?.ramUsedBits,
      ui.systemStatus?.memoryUsedBits,
      ui.systemStatus?.memory?.usedBits,
    ],
    [
      ui.systemStatus?.ramUsedBytes,
      ui.systemStatus?.memory?.usedBytes,
      visible.metrics.ramUsedBytes,
    ],
  );
};

const getVisibleSystemSchedulerSlots = (visible: VisibleState) =>
  Math.max(0, getHardware(visible).systemSchedulerSlots ?? 0);

const getSocketAvailableSchedulerSlots = (socket: VisibleCpuSocket) =>
  Math.max(0, socket.schedulerSlots - socket.queuedCount);

const getSocketIdleCoreCount = (socket: VisibleCpuSocket) =>
  socket.cores.filter((core) => !getCoreActiveTask(core)).length;

const getVisibleAvailableRamBits = (visible: VisibleState) =>
  Math.max(0, getVisibleRamBits(visible) - getVisibleRamUsedBits(visible));

const hasSystemMemory = (visible: VisibleState) =>
  visible.flags.systemStats || visible.hardware.secondCpu || getVisibleRamBits(visible) > 0;

const getTaskCompletedCount = (task: UiTask) =>
  firstNumber(task.completedCount, task.completionCount) ?? (task.completed ? 1 : 0);

const getTaskLockedReason = (task: UiTask) =>
  task.lockedReason ??
  task.lockReason ??
  task.blockedReason ??
  task.unlockReason ??
  null;

const getTaskQueueBlockedReason = (task: UiTask) =>
  task.queueBlockedReason ?? (task.canQueue === false ? getTaskLockedReason(task) : null);

const getTaskCanRunNow = (task: UiTask) => {
  if (getTaskLockedReason(task)) return false;
  if (typeof task.canStart === "boolean") return task.canStart;
  if (typeof task.canRun === "boolean") return task.canRun;
  return true;
};

const getTaskCanStart = (task: UiTask) =>
  getTaskCanRunNow(task) || task.canQueue === true;

function resolveTaskRoute(
  visible: VisibleState,
  selectedComponent: SelectedComponent,
  category: TaskCategoryId = "cpu",
): {
  mode: QueueMode;
  selectedCore: VisibleCore | null;
  selectedSchedulerId: number | null;
} {
  const routeSelection =
    getSelectedSystemComponent(selectedComponent) ?? ("core:1" as SelectedComponent);

  if (category !== "cpu") {
    return { mode: "systemScheduler", selectedCore: null, selectedSchedulerId: null };
  }

  const allCores = getAllCores(visible);
  const selectedCoreId = getSelectedCoreId(routeSelection);
  const selectedSchedulerId = getSelectedSchedulerId(routeSelection);
  const selectedSystemScheduler =
    routeSelection === "scheduler" && visible.flags.scheduler;
  const selectedCore =
    (selectedCoreId
      ? allCores.find((core) => core.id === selectedCoreId)
      : null) ??
    allCores[0] ??
    null;
  const schedulerCanRoute =
    visible.flags.basicQueue || visible.flags.scheduler || selectedSchedulerId !== null;
  const mode: QueueMode = selectedSystemScheduler
    ? "systemScheduler"
    : selectedSchedulerId && schedulerCanRoute
      ? "scheduler"
      : "core";
  return { mode, selectedCore, selectedSchedulerId };
}

function dispatchRunTask(
  task: UiTask,
  visible: VisibleState,
  selectedComponent: SelectedComponent,
  dispatch: Dispatch,
) {
  const systemId = getSelectedSystemId(selectedComponent);
  const dispatchTaskAction = (action: UiGameAction) =>
    dispatch(getSystemScopedAction(action, systemId));
  const { mode, selectedCore, selectedSchedulerId } = resolveTaskRoute(
    visible,
    selectedComponent,
    getTaskCategory(task),
  );

  if (mode === "core" && selectedCore) {
    dispatchTaskAction({
      type: "startTaskOnCore",
      taskId: task.id,
      coreId: selectedCore.id,
    });
    return;
  }

  if (mode === "scheduler") {
    dispatchTaskAction({
      type: "queueTask",
      taskId: task.id,
      cpuId: selectedSchedulerId ?? undefined,
    });
    return;
  }

  if (mode === "systemScheduler") {
    dispatchTaskAction({
      type: "queueTask",
      taskId: task.id,
    });
    return;
  }

  dispatchTaskAction({ type: "startTask", taskId: task.id });
}

const getTaskCanUseAction = (task: UiTask, mode: QueueMode) => {
  if (mode === "core") return task.category === "cpu" && getTaskCanRunNow(task);
  if (mode === "scheduler") return task.category === "cpu" && task.canQueue === true;
  if (mode === "systemScheduler") {
    return task.category !== "cpu" && task.canQueue === true;
  }
};

const getTaskActionDisabledReason = (task: UiTask, mode: QueueMode) => {
  if ((mode === "core" || mode === "scheduler") && task.category !== "cpu") {
    return "Use system scheduler";
  }

  if (mode === "systemScheduler" && task.category === "cpu") {
    return "Use CPU scheduler";
  }

  if (mode === "scheduler") {
    return getTaskQueueBlockedReason(task) ?? "Scheduler unavailable";
  }

  if (mode === "systemScheduler") {
    return getTaskQueueBlockedReason(task) ?? "System scheduler unavailable";
  }

  return getTaskLockedReason(task) ?? getTaskQueueBlockedReason(task) ?? "Locked";
};

const taskStateFromText = (value: string | undefined): TaskState | null => {
  const normalized = value?.toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("deadlock")) return "deadlock";
  if (normalized.includes("rerun")) return "rerun";
  if (normalized.includes("restart")) return "restart";
  if (
    normalized.includes("active") ||
    normalized.includes("running") ||
    normalized.includes("load")
  ) {
    return "active";
  }
  if (normalized.includes("waiting") || normalized.includes("queued")) return "waiting";
  if (normalized.includes("locked")) return "locked";
  if (normalized.includes("ready")) return "ready";
  return null;
};

const getTaskState = (
  task: UiTask,
  activeTasks: UiActiveTask[],
  queue: UiQueueEntry[],
): TaskState => {
  const explicit = taskStateFromText(task.status ?? task.state);
  if (explicit) return explicit;

  const active = activeTasks.find((candidate) => getActiveTaskId(candidate) === task.id);
  if (active) {
    return taskStateFromText(active.status ?? active.state ?? active.memoryState) ?? "active";
  }

  if (queue.some((entry) => getQueueTaskId(entry) === task.id)) return "waiting";
  if (!getTaskCanStart(task)) return "locked";

  if (getTaskCompletedCount(task) > 0) {
    return task.repeatable === false || task.kind === "benchmark" ? "restart" : "rerun";
  }

  return "ready";
};

const getMemoryActionVerb = (action: string | null | undefined) => {
  if (action === "read") return "Read";
  if (action === "write") return "Write";
  if (action === "overwrite") return "Overwrite";
  return "Processing";
};

const getActiveCoreRuntime = (active: UiActiveTask) =>
  active.coreProgress?.find((operation) => operation.status !== "complete") ??
  active.coreProgress?.[0] ??
  null;

const getActiveRuntimeLabel = (active: UiActiveTask) => {
  const raw = (active.memoryState ?? active.status ?? active.state ?? "").toLowerCase();
  const operation = getActiveCoreRuntime(active);
  const actionVerb = getMemoryActionVerb(operation?.memoryAction);
  const totalCycles = operation?.totalCycles ?? 0;
  const remainingCycles = operation?.remainingCycles ?? totalCycles;
  const completedCycles =
    totalCycles > 0 ? Math.max(0, totalCycles - remainingCycles) : 0;
  const cacheBits = operation?.cacheBits ?? 0;
  const cacheLabel = cacheBits > 0 ? ` ${formatBits(cacheBits)}` : "";

  if (
    raw.includes("deadlock") ||
    active.lockResource ||
    operation?.lockResource
  ) {
    const resource = active.lockResource ?? operation?.lockResource;
    return resource === "cache"
      ? "Deadlock: cache"
      : resource === "ram"
        ? "Deadlock: RAM"
        : "Deadlock";
  }

  if (raw.includes("cache")) {
    if (operation && totalCycles > 0 && completedCycles >= totalCycles) {
      return `Cache wait${cacheLabel}`;
    }
    return operation?.memoryAction
      ? `${actionVerb}${cacheLabel}`
      : `Cache load${cacheLabel}`;
  }
  if (raw.includes("ram")) return "RAM load";
  if (raw.includes("wait")) return "Waiting";
  if (raw.includes("rerun")) return "Rerun";
  if (raw.includes("restart")) return "Restart";
  if (raw.includes("complete")) return "Complete";
  if (operation?.memoryAction) return `${actionVerb}${cacheLabel}`;
  if (operation?.operationName && totalCycles > 0) {
    return operation.operationName === active.name ? "Processing" : operation.operationName;
  }

  return active.activeOperationName ?? "Active";
};

const getActiveTaskFor = (task: UiTask, activeTasks: UiActiveTask[]) =>
  activeTasks.find((candidate) => getActiveTaskId(candidate) === task.id) ?? null;

const getTaskRewardCosts = (task: UiTask): DisplayCost[] => {
  const credits = firstNumber(task.rewardCredits, task.rewards?.credits);
  const data = firstNumber(task.rewardData, task.rewards?.data);
  const costs: DisplayCost[] = [];
  if (credits && credits > 0) costs.push({ resource: "credits", amount: credits });
  if (data && data > 0) costs.push({ resource: "data", amount: data });
  return costs;
};

function TaskMetaLine({
  task,
  memoryUnlocked,
}: {
  task: UiTask;
  memoryUnlocked: boolean;
}) {
  const operationCount = getTaskOperationCount(task);
  const cacheBits = getTaskCacheBits(task);
  const ramBits = getTaskRamBits(task);
  const requiredCores = getRequiredCoreCount(task);
  const rewards = getTaskRewardCosts(task);

  return (
    <div className="task-meta-line">
      <span className="ops">
        <strong>{operationCount === undefined ? "?" : formatNumber(operationCount)}</strong> ops
      </span>
      {isElasticTask(task) ? (
        <span>uses idle cores</span>
      ) : (
        requiredCores > 1 && <span>{formatNumber(requiredCores)} cores</span>
      )}
      {cacheBits > 0 && <span>cache {formatBits(cacheBits)}</span>}
      {(memoryUnlocked || ramBits > 0) && ramBits > 0 && (
        <span>ram {formatBits(ramBits)}</span>
      )}
      {rewards.length > 0 && <ResourceCost costs={rewards} compact />}
    </div>
  );
}

const getQueueWaitingReason = (
  task: UiTask | undefined,
  activeTask?: UiActiveTask,
  pendingReason?: string,
) => {
  if (activeTask) return getActiveRuntimeLabel(activeTask);
  return (
    pendingReason?.trim() ||
    task?.blockedReason?.trim() ||
    task?.queueBlockedReason?.trim() ||
    "Waiting for scheduler dispatch."
  );
};

const getRequiredCoreCount = (task: UiTask | undefined) =>
  Math.max(1, firstNumber(task?.requiredCores, task?.minCores) ?? 1);

const isElasticTask = (task: UiTask | undefined) => task?.coreScaling === "elastic";

const getCpuSchedulerPendingReason = (
  visible: VisibleState,
  task: UiTask | undefined,
  socket: VisibleCpuSocket,
) => {
  if (!task) return "Waiting for CPU scheduler dispatch.";
  const blockedReason = task.blockedReason?.trim();
  if (blockedReason && !/scheduler slots full/i.test(blockedReason)) {
    return blockedReason;
  }

  if (socket.deadlocked) return "CPU deadlock active.";

  const requiredCores = getRequiredCoreCount(task);
  const idleCores = getSocketIdleCoreCount(socket);
  if (idleCores < requiredCores) {
    return requiredCores > 1
      ? `Needs ${requiredCores} idle cores.`
      : "No idle core available.";
  }

  if (requiredCores > 1 && socket.schedulerSlots < requiredCores) {
    return `CPU scheduler needs ${requiredCores} slots.`;
  }

  if (socket.schedulerConfig.policy === "deadlockSafe") {
    const availableCacheBits = Math.max(0, socket.cacheBits - socket.cacheUsedBits);
    if (getTaskCacheBits(task) > availableCacheBits) {
      return "Waiting for CPU cache.";
    }

    if (!isSystemQueueTask(task) && getTaskRamBits(task) > getVisibleAvailableRamBits(visible)) {
      return "Waiting for RAM.";
    }
  }

  return "Waiting for CPU scheduler dispatch.";
};

const getCpuQueueReservationMap = (visible: VisibleState) => {
  const occurrences = new Map<string, number>();
  const reservations = new Map<string, VisibleCpuSocket>();

  visible.metrics.cpuSockets.forEach((socket) => {
    socket.cores
      .flatMap((core) => core.scheduler?.localQueue ?? [])
      .forEach((taskId) => {
        const occurrence = occurrences.get(taskId) ?? 0;
        occurrences.set(taskId, occurrence + 1);
        reservations.set(`${taskId}:${occurrence}`, socket);
      });
  });

  return reservations;
};

const getSystemSchedulerPendingReason = (
  visible: VisibleState,
  task: UiTask | undefined,
) => {
  if (!task) return "Waiting for system scheduler dispatch.";

  const blockedReason = task.blockedReason?.trim();
  if (blockedReason && !/scheduler slots full/i.test(blockedReason)) {
    return blockedReason;
  }

  if (visible.hardware.systemSchedulerConfig.policy === "deadlockSafe") {
    if (getTaskRamBits(task) > getVisibleAvailableRamBits(visible)) {
      return "Waiting for RAM.";
    }
  }

  const compatibleSockets = visible.metrics.cpuSockets.filter((socket) => {
    const requiredCores = getRequiredCoreCount(task);
    return (
      socket.cacheBits >= getTaskCacheBits(task) &&
      socket.schedulerSlots >= requiredCores
    );
  });
  if (compatibleSockets.length > 0) {
    const socketWithSlot = compatibleSockets.find(
      (socket) => getSocketAvailableSchedulerSlots(socket) > 0,
    );
    if (socketWithSlot) {
      return getCpuSchedulerPendingReason(visible, task, socketWithSlot);
    }

    return "CPU scheduler slots full.";
  }

  return task.queueBlockedReason?.trim() || "Waiting for system scheduler dispatch.";
};

const getActiveTaskOccurrenceMap = (activeTasks: UiActiveTask[]) => {
  const occurrences = new Map<string, number>();
  const activeByOccurrence = new Map<string, UiActiveTask>();

  activeTasks.forEach((activeTask) => {
    const taskId = activeTask.taskId;
    if (!taskId) return;

    const occurrence = occurrences.get(taskId) ?? 0;
    occurrences.set(taskId, occurrence + 1);
    activeByOccurrence.set(`${taskId}:${occurrence}`, activeTask);
  });

  return activeByOccurrence;
};

const getQueueDisplayItem = (
  entry: UiQueueEntry,
  tasksById: Map<string, UiTask>,
  activeTask: UiActiveTask | undefined,
  pendingReason?: string,
): UiQueueDisplayItem | null => {
  const taskId = getQueueTaskId(entry);
  const task = tasksById.get(taskId);
  const entryName = typeof entry !== "string" ? entry.name : undefined;
  const name = entryName ?? task?.name ?? taskId;

  if (!name) return null;

  return {
    id: taskId || name,
    name,
    waitingReason: getQueueWaitingReason(task, activeTask, pendingReason),
    instanceId: activeTask?.instanceId,
    active: Boolean(activeTask),
    deadlocked:
      activeTask?.status === "deadlocked" ||
      activeTask?.memoryState === "deadlock" ||
      Boolean(activeTask?.lockResource),
  };
};

const getQueueDisplayItemsFromEntries = (
  entries: UiQueueEntry[],
  tasksById: Map<string, UiTask>,
  activeTasks: UiActiveTask[],
  getPendingReason?: (
    entry: UiQueueEntry,
    occurrence: number,
    task: UiTask | undefined,
    activeTask: UiActiveTask | undefined,
  ) => string | undefined,
) => {
  const activeByOccurrence = getActiveTaskOccurrenceMap(activeTasks);
  const queueOccurrences = new Map<string, number>();

  return entries
    .map((entry) => {
      const taskId = getQueueTaskId(entry);
      const occurrence = queueOccurrences.get(taskId) ?? 0;
      queueOccurrences.set(taskId, occurrence + 1);

      return getQueueDisplayItem(
        entry,
        tasksById,
        activeByOccurrence.get(`${taskId}:${occurrence}`),
        getPendingReason?.(
          entry,
          occurrence,
          tasksById.get(taskId),
          activeByOccurrence.get(`${taskId}:${occurrence}`),
        ),
      );
    })
    .filter(hasValue);
};

const getQueueLookupTasks = (visible: VisibleState) => [
  ...getTasks(visible),
  ...getResearch(visible).flatMap((research) => research.computeTasks ?? []),
];

const getQueueDisplayItems = (visible: VisibleState, socket?: VisibleCpuSocket) => {
  const tasksById = new Map(getQueueLookupTasks(visible).map((task) => [task.id, task]));
  const schedulerActiveTasks = getActiveTasks(visible).filter(
    (task) => task.schedulerQueued && task.taskId,
  );

  if (socket) {
    const socketCoreIds = new Set(socket.cores.map((core) => core.id));
    const socketActiveTasks = schedulerActiveTasks.filter((task) =>
      task.assignedCoreIds?.some((coreId) => socketCoreIds.has(coreId)) ||
      socketCoreIds.has(task.coreId),
    );
    const entries = socket.cores.flatMap((core) => core.scheduler?.localQueue ?? []);

    return getQueueDisplayItemsFromEntries(
      entries,
      tasksById,
      socketActiveTasks,
      (_entry, _occurrence, task, activeTask) =>
        activeTask ? undefined : getCpuSchedulerPendingReason(visible, task, socket),
    );
  }

  return getQueueDisplayItemsFromEntries(
    getQueueEntries(visible),
    tasksById,
    schedulerActiveTasks,
  );
};

const isSystemQueueTask = (task: UiTask | undefined) =>
  task?.category === "system" || task?.category === "distributed";

const getSystemQueueDisplayItems = (visible: VisibleState) => {
  const tasksById = new Map(getQueueLookupTasks(visible).map((task) => [task.id, task]));
  const cpuReservations = getCpuQueueReservationMap(visible);
  const systemActiveTasks = getActiveTasks(visible).filter((task) =>
    task.schedulerQueued && isSystemQueueTask(tasksById.get(task.taskId ?? "")),
  );
  const entries = getQueueEntries(visible).filter((entry) =>
    isSystemQueueTask(tasksById.get(getQueueTaskId(entry))),
  );

  return getQueueDisplayItemsFromEntries(
    entries,
    tasksById,
    systemActiveTasks,
    (entry, occurrence, task, activeTask) => {
      if (activeTask) return undefined;

      const socket = cpuReservations.get(`${getQueueTaskId(entry)}:${occurrence}`);
      return socket
        ? getCpuSchedulerPendingReason(visible, task, socket)
        : getSystemSchedulerPendingReason(visible, task);
    },
  );
};

const getSystemLoad = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  const system = ui.systemStatus;
  const ramCapacity = Math.max(getVisibleRamBits(visible), 1);
  const psuCapacity = Math.max(visible.hardware.psuWatts, 1);
  const ramUsed = getVisibleRamUsedBits(visible);
  const fallbackRamLoad = ramUsed / ramCapacity;
  const fallbackPsuStress = visible.metrics.powerUsedWatts / psuCapacity;
  const ramLoad = normalizeRatio(
    firstNumber(system?.ramLoad, system?.ramPressure, ui.metrics.ramLoad),
  );
  const memoryPressure = normalizeRatio(
    firstNumber(
      system?.memoryPressure,
      system?.memoryPressureRatio,
      system?.memory?.pressure,
      ui.metrics.memoryPressure,
    ),
  );
  const psuStress = normalizeRatio(
    firstNumber(
      system?.psuStress,
      system?.powerStress,
      system?.psu?.stress,
      ui.metrics.psuStress,
      ui.metrics.powerStress,
    ),
  );
  const coolingStress = normalizeRatio(
    firstNumber(
      system?.coolingStress,
      system?.thermalStress,
      system?.cooling?.stress,
      ui.metrics.coolingStress,
    ),
  );
  const coolingStatus =
    system?.coolingStatus ??
    system?.thermalStatus ??
    system?.cooling?.status ??
    ui.metrics.coolingStatus ??
    (coolingStress !== null && coolingStress > 0.9 ? "Hot" : "Nominal");

  return {
    memoryPressure: memoryPressure ?? ramLoad ?? fallbackRamLoad,
    psuStress: psuStress ?? fallbackPsuStress,
    coolingStress,
    coolingStatus,
  };
};

const getStressTone = (ratio: number | null) => {
  if (ratio === null) return "neutral";
  if (ratio >= 1) return "critical";
  if (ratio >= 0.78) return "warn";
  return "good";
};

const hasUiFlag = (visible: VisibleState, ...names: string[]) => {
  const flags = asUiVisible(visible).flags as unknown as Record<string, unknown>;
  return names.some((name) => flags[name] === true);
};

const getCronState = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  return (
    ui.cron ??
    ui.automation?.cron ??
    ui.systemManagement?.cron ??
    ui.hardware.cron ??
    null
  );
};

const hasCronScheduler = (visible: VisibleState) =>
  Boolean(
    getCronState(visible)?.unlocked ||
      hasUiFlag(visible, "cron", "cronScheduler", "cronAutomation"),
  );

const hasPsuManagement = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  return Boolean(
    ui.systemManagement?.psuManagement ||
      ui.systemManagement?.powerManagement ||
      hasUiFlag(visible, "psuManagement", "powerManagement"),
  );
};

const getSystemTaskOptions = (visible: VisibleState) =>
  getTasks(visible).filter(isSystemQueueTask);

const getCronMinimumSeconds = (
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

const getCronScheduleId = (schedule: UiCronSchedule, index: number) =>
  String(schedule.id ?? schedule.scheduleId ?? `schedule-${index + 1}`);

const getCronIntervalSeconds = (
  schedule: UiCronSchedule,
  minimumSeconds: number,
) => {
  const intervalSeconds = firstNumber(
    schedule.intervalSeconds,
    typeof schedule.intervalMinutes === "number"
      ? schedule.intervalMinutes * 60
      : undefined,
    schedule.interval,
  );

  return Math.max(minimumSeconds, intervalSeconds ?? minimumSeconds);
};

const getCronMode = (
  schedule: UiCronSchedule,
  intervalSeconds: number,
): CronIntervalMode =>
  schedule.mode ??
  (intervalSeconds >= 60 && intervalSeconds % 60 === 0 ? "minutes" : "seconds");

const getCronSchedules = (visible: VisibleState) => {
  const cron = getCronState(visible);
  const schedules = ((cron?.schedules ?? cron?.rows ?? []) as unknown) as UiCronSchedule[];

  if (schedules.length > 0) return schedules;

  const firstTask = getSystemTaskOptions(visible)[0];
  const minimumSeconds = getCronMinimumSeconds(cron);
  return [
    {
      id: "primary",
      taskId: firstTask?.id ?? "",
      enabled: false,
      intervalSeconds: minimumSeconds,
      minIntervalSeconds: minimumSeconds,
      lastResult: null,
    },
  ];
};

const getCronCountdownLabel = (schedule: UiCronSchedule) => {
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

const formatCronInterval = (seconds: number) =>
  seconds >= 60 && seconds % 60 === 0
    ? `${formatNumber(seconds / 60)}m`
    : `${formatNumber(seconds)}s`;

const getCronMinimumUpgrade = (
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

const normalizePowerState = (
  state: string | null | undefined,
): PowerLifecycleState => {
  const normalized = state?.trim().toLowerCase().replace(/[\s_-]/g, "") ?? "";

  if (normalized.includes("boot") || normalized.includes("poweringon")) {
    return "booting";
  }

  if (
    normalized.includes("shut") ||
    normalized.includes("poweringoff") ||
    normalized.includes("stopping")
  ) {
    return "shuttingDown";
  }

  if (normalized === "off" || normalized === "offline" || normalized === "down") {
    return "off";
  }

  return "on";
};

const getPowerState = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  return normalizePowerState(
    ui.systemStatus?.powerState ??
      ui.systemStatus?.power?.state ??
      ui.systemManagement?.power?.state ??
      ui.systemManagement?.power?.lifecycle ??
      ui.power?.state ??
      ui.power?.lifecycle ??
      ui.hardware.powerState ??
      ui.hardware.power?.state ??
      ui.metrics.powerState,
  );
};

const getPowerStats = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  const power =
    ui.systemStatus?.power ??
    ui.systemManagement?.power ??
    ui.power ??
    ui.hardware.power;
  const state = getPowerState(visible);
  const rawDrawWatts = Math.max(
    0,
    firstNumber(power?.drawWatts, visible.metrics.powerUsedWatts) ?? 0,
  );
  const headroomWatts = firstNumber(
    power?.headroomWatts,
    ui.systemStatus?.powerHeadroomWatts,
    visible.metrics.powerHeadroomWatts,
  );
  const capacityWatts =
    firstPositiveNumber(
      power?.capacityWatts,
      visible.hardware.psuWatts,
      typeof headroomWatts === "number" ? rawDrawWatts + headroomWatts : undefined,
      rawDrawWatts,
    ) ?? 65;
  const drawWatts = state === "off" ? 0 : rawDrawWatts;
  const stress =
    normalizeRatio(
      firstNumber(
        ui.systemStatus?.psuStress,
        ui.systemStatus?.powerStress,
        ui.systemStatus?.psu?.stress,
        ui.metrics.psuStress,
        ui.metrics.powerStress,
      ),
    ) ?? drawWatts / capacityWatts;
  const costPerSecond =
    firstNumber(
      power?.costPerSecond,
      ui.systemStatus?.power?.costPerSecond,
      visible.metrics.powerCostPerSecond,
    ) ?? Math.round(drawWatts * 0.06 * 1000) / 1000;
  const billingGraceSeconds = Math.max(
    0,
    firstNumber(
      power?.bootstrapGraceSeconds,
      power?.powerBootstrapGraceSeconds,
      power?.billingGraceSeconds,
      power?.powerBillingGraceSeconds,
      ui.systemStatus?.powerBootstrapGraceSeconds,
      ui.systemStatus?.billingGraceSeconds,
      ui.systemStatus?.powerBillingGraceSeconds,
      ui.metrics.powerBootstrapGraceSeconds,
      ui.metrics.billingGraceSeconds,
      ui.metrics.powerBillingGraceSeconds,
    ) ?? 0,
  );
  const transitionSeconds = Math.max(
    0,
    firstNumber(
      power?.transitionSeconds,
      power?.powerTransitionSeconds,
      ui.systemStatus?.powerTransitionSeconds,
      ui.metrics.powerTransitionSeconds,
    ) ?? 0,
  );
  const overload =
    power?.overloadFailure ??
    power?.powerOverloadFailure ??
    ui.systemStatus?.powerOverloadFailure ??
    ui.metrics.powerOverloadFailure;
  const overloadSeconds = Math.max(
    0,
    firstNumber(
      overload?.seconds,
      power?.overloadFailureSeconds,
      power?.powerOverloadFailureSeconds,
      ui.systemStatus?.powerOverloadFailureSeconds,
      ui.metrics.powerOverloadFailure?.seconds,
    ) ?? 0,
  );
  const overloadLimitSeconds =
    firstPositiveNumber(
      overload?.limitSeconds,
      ui.metrics.powerOverloadFailure?.limitSeconds,
    ) ?? 10;
  const overloadRemainingSeconds = Math.max(
    0,
    firstNumber(
      overload?.remainingSeconds,
      power?.overloadFailureRemainingSeconds,
      power?.powerOverloadFailureRemainingSeconds,
      ui.systemStatus?.powerOverloadFailureRemainingSeconds,
      ui.metrics.powerOverloadFailure?.remainingSeconds,
      overloadLimitSeconds - overloadSeconds,
    ) ?? 0,
  );
  const overloadProgress = clampMeter(
    firstNumber(
      overload?.progress,
      power?.overloadFailureProgress,
      power?.powerOverloadFailureProgress,
      ui.systemStatus?.powerOverloadFailureProgress,
      ui.metrics.powerOverloadFailure?.progress,
      overloadSeconds / Math.max(1, overloadLimitSeconds),
    ) ?? null,
  );
  const overloadTripped =
    firstBoolean(
      overload?.tripped,
      power?.overloadFailureTripped,
      power?.powerOverloadFailureTripped,
      ui.systemStatus?.powerOverloadFailureTripped,
      ui.metrics.powerOverloadFailure?.tripped,
    ) ?? overloadSeconds >= overloadLimitSeconds;
  const overloadActive =
    firstBoolean(
      overload?.active,
      power?.overloadFailureActive,
      power?.powerOverloadFailureActive,
      ui.systemStatus?.powerOverloadFailureActive,
      ui.metrics.powerOverloadFailure?.active,
    ) ?? (stress > 1 || overloadSeconds > 0);
  const overloadRate =
    firstNumber(overload?.rate, ui.metrics.powerOverloadFailure?.rate) ??
    (stress > 1 ? Math.max(1, stress) : 0);

  return {
    state,
    drawWatts,
    capacityWatts,
    stress,
    costPerSecond,
    billingGraceSeconds,
    transitionSeconds,
    overloadFailure: {
      seconds: overloadSeconds,
      limitSeconds: overloadLimitSeconds,
      remainingSeconds: overloadRemainingSeconds,
      progress: overloadProgress,
      rate: overloadRate,
      active: overloadActive,
      tripped: overloadTripped,
    },
  };
};

const getPowerControls = (visible: VisibleState, state: PowerLifecycleState) => {
  const ui = asUiVisible(visible);
  const power =
    ui.systemStatus?.power ??
    ui.systemManagement?.power ??
    ui.power ??
    ui.hardware.power;
  const explicitCanPowerOn = firstBoolean(
    power?.canPowerOn,
    power?.canRequestPowerOn,
    power?.canTurnOn,
  );
  const explicitCanPowerOff = firstBoolean(
    power?.canPowerOff,
    power?.canRequestPowerOff,
    power?.canTurnOff,
  );
  const explicitCanPowerKill = firstBoolean(
    power?.canPowerKill,
    power?.canKillPower,
  );
  const controlsAvailable = firstBoolean(power?.controlsAvailable, power?.canControl);
  const controlsAllowed = controlsAvailable ?? true;
  const showControls = controlsAvailable ?? true;

  return {
    showControls,
    canPowerOn: explicitCanPowerOn ?? (controlsAllowed && state === "off"),
    canPowerOff: explicitCanPowerOff ?? (controlsAllowed && state === "on"),
    canPowerKill: explicitCanPowerKill ?? (controlsAllowed && state !== "off"),
  };
};

const getEfficiencyMetrics = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  const load = getSystemLoad(visible);
  const totalCores = Math.max(1, getAllCores(visible).length);
  const activeCores =
    visible.metrics.activeCoreCount ??
    getAllCores(visible).filter((core) => Boolean(getCoreActiveTask(core))).length;
  const cpuLoad = clampMeter(activeCores / totalCores);
  const memoryPressure = clampMeter(load.memoryPressure);
  const derivedMatch =
    cpuLoad === 0 && memoryPressure === 0
      ? 1
      : 1 - Math.min(1, Math.abs(cpuLoad - memoryPressure));
  const ramCpuMatch =
    normalizeRatio(
      firstNumber(
        ui.metrics.ramCpuMatch,
        ui.metrics.matchingEfficiency,
        ui.systemStatus?.ramCpuMatch,
        ui.systemStatus?.matchingEfficiency,
      ),
    ) ?? derivedMatch;
  const powerEfficiency =
    normalizeRatio(
      firstNumber(
        ui.metrics.powerEfficiency,
        ui.systemStatus?.powerEfficiency,
        ui.systemStatus?.power?.efficiency,
        ui.systemManagement?.power?.efficiency,
        ui.power?.efficiency,
        visible.metrics.powerReliability,
      ),
    ) ?? Math.max(0, 1 - Math.max(0, load.psuStress - 0.72));

  return {
    ramCpuMatch: clampMeter(ramCpuMatch),
    powerEfficiency: clampMeter(powerEfficiency),
  };
};

const RESOURCE_GAIN_ANIMATION_MS = 1080;
const MAX_RESOURCE_GAIN_BURSTS = 10;
const RESOURCE_GAIN_EPSILON = 0.0001;

const createResourceGainBurst = (
  id: number,
  kind: ResourceGainKind,
  amount: number,
  targetElement: HTMLElement | null,
): ResourceGainBurst => {
  const targetRect = targetElement?.getBoundingClientRect();
  const fallbackX = window.innerWidth - (kind === "credits" ? 104 : 190);
  const target = {
    x: targetRect ? targetRect.left + targetRect.width * 0.5 : fallbackX,
    y: targetRect ? targetRect.bottom + 14 : 42,
  };
  const startY = target.y + 36;

  return {
    id,
    kind,
    amount,
    startX: target.x,
    startY: startY,
    endX: target.x,
    endY: target.y,
  };
};

export function ResourceHud({
  visible,
  onReset,
  animateResourceGains,
}: {
  visible: VisibleState;
  onReset: () => void;
  animateResourceGains: boolean;
}) {
  const dataReadoutRef = useRef<HTMLDivElement>(null);
  const creditsReadoutRef = useRef<HTMLDivElement>(null);
  const previousResourcesRef = useRef(visible.resources);
  const resourceEffectsArmedRef = useRef(false);
  const nextBurstIdRef = useRef(0);
  const gainTimeoutsRef = useRef<number[]>([]);
  const [gainBursts, setGainBursts] = useState<ResourceGainBurst[]>([]);

  useEffect(
    () => () => {
      gainTimeoutsRef.current.forEach((timeoutId) =>
        window.clearTimeout(timeoutId),
      );
      gainTimeoutsRef.current = [];
    },
    [],
  );

  useEffect(() => {
    const previousResources = previousResourcesRef.current;
    const currentResources = visible.resources;
    previousResourcesRef.current = currentResources;

    if (!animateResourceGains) {
      resourceEffectsArmedRef.current = false;
      return;
    }

    if (!resourceEffectsArmedRef.current) {
      resourceEffectsArmedRef.current = true;
      return;
    }

    const resourceGains = [
      {
        kind: "data" as const,
        amount: currentResources.data - previousResources.data,
        target: dataReadoutRef.current,
      },
      {
        kind: "credits" as const,
        amount: currentResources.credits - previousResources.credits,
        target: creditsReadoutRef.current,
      },
    ].filter((gain) => gain.amount > RESOURCE_GAIN_EPSILON);

    if (resourceGains.length === 0) return;

    const newBursts = resourceGains.map((gain) =>
      createResourceGainBurst(
        nextBurstIdRef.current++,
        gain.kind,
        gain.amount,
        gain.target,
      ),
    );

    setGainBursts((current) =>
      [...current, ...newBursts].slice(-MAX_RESOURCE_GAIN_BURSTS),
    );

    newBursts.forEach((burst) => {
      const timeoutId = window.setTimeout(() => {
        setGainBursts((current) =>
          current.filter((candidate) => candidate.id !== burst.id),
        );
        gainTimeoutsRef.current = gainTimeoutsRef.current.filter(
          (candidate) => candidate !== timeoutId,
        );
      }, RESOURCE_GAIN_ANIMATION_MS);

      gainTimeoutsRef.current.push(timeoutId);
    });
  }, [animateResourceGains, visible.resources.credits, visible.resources.data]);

  return (
    <div className="resource-hud" aria-label="Resources">
      {gainBursts.length > 0 && (
        <div className="resource-gain-layer" aria-hidden="true">
          {gainBursts.map((burst) => (
            <span
              className={`resource-gain-flyout ${burst.kind}`}
              key={burst.id}
              style={
                {
                  "--start-x": `${burst.startX}px`,
                  "--start-y": `${burst.startY}px`,
                  "--end-x": `${burst.endX}px`,
                  "--end-y": `${burst.endY}px`,
                } as CSSProperties
              }
            >
              <ResourceAmount
                resource={burst.kind}
                amount={burst.amount}
                plus
                showLabel={false}
              />
            </span>
          ))}
        </div>
      )}
      <div className="resource-readout data" ref={dataReadoutRef}>
        <Database size={13} />
        <strong>{formatNumber(Math.floor(visible.resources.data))}</strong>
        <span>data</span>
      </div>
      <div className="resource-readout credits" ref={creditsReadoutRef}>
        <Zap size={13} />
        <strong>{formatNumber(Math.floor(visible.resources.credits))}</strong>
        <span>cr</span>
      </div>
      <button
        type="button"
        className="dev-reset-button"
        onClick={onReset}
        title="Reset dev save"
        aria-label="Reset dev save"
      >
        <RefreshCw size={13} />
      </button>
    </div>
  );
}

/* ============ HARDWARE BOARD ============ */

function SystemRackPanel({
  rack,
  activeSystemId,
  selection,
  onSelectComponent,
  dispatch,
  resources,
}: {
  rack: UiRackData;
  activeSystemId: string;
  selection: SelectedComponent;
  onSelectComponent: (component: SelectedComponent) => void;
  dispatch: Dispatch;
  resources: VisibleState["resources"];
}) {
  const activeComponent = getSelectedSystemComponent(selection) ?? "core:1";

  return (
    <SystemRack>
      <div className="system-rack-header">
        <span className="system-rack-title">
          <Server size={14} />
          <span>Rack</span>
        </span>
      </div>

      <div className="system-rack-slots" aria-label="Owned systems">
        {rack.systems.map((system, index) => (
          <button
            key={system.id}
            type="button"
            className={`system-rack-slot ${
              system.id === activeSystemId ? "selected" : ""
            }`}
            aria-pressed={system.id === activeSystemId}
            onClick={() => {
              dispatch({ type: "selectSystem", systemId: system.id });
              onSelectComponent(scopeSelectionToSystem(system.id, activeComponent));
            }}
            title={`Select ${system.name}`}
          >
            <span className="rack-slot-index">{index + 1}</span>
            <span className="rack-slot-copy">
              <strong>{system.name}</strong>
              <small>{system.role}</small>
            </span>
            <span className="rack-slot-stats">
              <span>{formatNumber(system.cores)}C</span>
              {system.ramBits > 0 && <span>{formatBits(system.ramBits)}</span>}
              {system.drawWatts > 0 && <span>{formatWatts(system.drawWatts)}</span>}
            </span>
            <span className={`rack-slot-state ${system.status}`}>
              {system.status}
            </span>
          </button>
        ))}
      </div>

      {(rack.presets.length > 0 || getBuilderGroups(rack.customBuilder).length > 0) && (
        <div className="system-rack-purchase-grid">
          {rack.presets.length > 0 && (
            <PreconfiguredSystemControls
              presets={rack.presets}
              resources={resources}
              dispatch={dispatch}
            />
          )}
          {getBuilderGroups(rack.customBuilder).length > 0 && (
            <CustomMachineBuilder
              builder={rack.customBuilder}
              resources={resources}
              dispatch={dispatch}
            />
          )}
        </div>
      )}
    </SystemRack>
  );
}

function PreconfiguredSystemControls({
  presets,
  resources,
  dispatch,
}: {
  presets: UiSystemPreset[];
  resources: VisibleState["resources"];
  dispatch: Dispatch;
}) {
  return (
    <section className="system-preset-controls" aria-label="Preconfigured systems">
      <div className="system-rack-subheader">
        <ShoppingCart size={13} />
        <span>Systems</span>
      </div>
      <div className="system-preset-list">
        {presets.map((preset, index) => {
          const presetId = getPresetId(preset, index);
          const label = getPresetLabel(preset, index);
          const costs = getRecordCosts(preset);
          const canBuy =
            !preset.disabled &&
            (firstBoolean(preset.canBuy, preset.canAfford) ?? true);
          const blockedReason =
            preset.blockedReason ?? preset.lockedReason ?? "Locked";
          const stats = [
            firstNumber(preset.cores, preset.coreCount) !== undefined
              ? `${formatNumber(firstNumber(preset.cores, preset.coreCount) ?? 0)}C`
              : null,
            firstBits([preset.ramBits], [preset.ramBytes]) > 0
              ? formatBits(firstBits([preset.ramBits], [preset.ramBytes]))
              : null,
            firstBits([preset.cacheBits], [preset.cacheBytes]) > 0
              ? `${formatBits(firstBits([preset.cacheBits], [preset.cacheBytes]))} cache`
              : null,
          ].filter((item): item is string => item !== null);

          return (
            <button
              key={presetId}
              type="button"
              className="system-preset-card"
              disabled={!canBuy}
              title={canBuy ? `Buy ${label}: ${formatCost(costs)}` : blockedReason}
              onClick={() =>
                dispatch({
                  type: "buyPreconfiguredSystem",
                  presetId,
                })
              }
            >
              <span className="system-preset-copy">
                <strong>{label}</strong>
                <small>{preset.role ?? preset.tier ?? "Preset"}</small>
              </span>
              {stats.length > 0 && (
                <span className="system-preset-stats">{stats.join(" / ")}</span>
              )}
              {preset.powerDeltaWatts !== undefined && (
                <span className="system-preset-power">
                  +{formatWatts(preset.powerDeltaWatts)}
                </span>
              )}
              <ResourceCost costs={costs} compact resources={resources} />
              <span className="system-preset-action">
                {canBuy ? <Plus size={12} /> : blockedReason}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CustomMachineBuilder({
  builder,
  resources,
  dispatch,
}: {
  builder: UiCustomMachineBuilder | null;
  resources: VisibleState["resources"];
  dispatch: Dispatch;
}) {
  const groups = getBuilderGroups(builder);
  const groupsKey = groups
    .map((group, groupIndex) => {
      const groupId = getBuilderGroupId(group, groupIndex);
      const optionIds = (group.tiers ?? group.options ?? []).map(getTierId).join(",");
      return `${groupId}:${optionIds}`;
    })
    .join("|");
  const [selections, setSelections] = useState<Record<string, string>>(() =>
    getBuilderSelections(groups, {}),
  );

  useEffect(() => {
    setSelections((current) => getBuilderSelections(groups, current));
  }, [groupsKey]);

  if (!builder || groups.length === 0) return null;

  const selectedTiers = getSelectedBuilderTiers(groups, selections);
  const costs =
    getRecordCosts(builder).length > 0
      ? getRecordCosts(builder)
      : sumCosts(selectedTiers.map(getRecordCosts));
  const tierBlocked = selectedTiers.find(
    (tier) =>
      tier.disabled ||
      firstBoolean(tier.canSelect, tier.canAfford) === false ||
      Boolean(tier.blockedReason),
  );
  const canBuy =
    !tierBlocked &&
    (firstBoolean(builder.canBuy, builder.canAfford) ?? true);
  const blockedReason =
    tierBlocked?.blockedReason ??
    builder.blockedReason ??
    builder.lockedReason ??
    "Locked";
  const totalCores = selectedTiers.reduce(
    (total, tier) => total + (firstNumber(tier.cores, tier.coreCount) ?? 0),
    0,
  );
  const totalRamBits = selectedTiers.reduce(
    (total, tier) => total + firstBits([tier.ramBits], [tier.ramBytes]),
    0,
  );
  const totalPower = selectedTiers.reduce(
    (total, tier) => total + (tier.powerDeltaWatts ?? 0),
    0,
  );

  return (
    <section className="custom-machine-builder" aria-label="Custom machine builder">
      <div className="system-rack-subheader">
        <SlidersHorizontal size={13} />
        <span>{builder.title ?? builder.name ?? "Custom"}</span>
      </div>

      <div className="custom-builder-groups">
        {groups.map((group, groupIndex) => {
          const groupId = getBuilderGroupId(group, groupIndex);
          const options = group.tiers ?? group.options ?? [];

          return (
            <div className="custom-builder-group" key={groupId}>
              <span className="custom-builder-label">
                {getBuilderGroupLabel(group, groupIndex)}
              </span>
              <div className="custom-tier-options">
                {options.map((tier, tierIndex) => {
                  const tierId = getTierId(tier, tierIndex);
                  const selected = selections[groupId] === tierId;
                  const tierCosts = getRecordCosts(tier);
                  const disabled =
                    tier.disabled ||
                    firstBoolean(tier.canSelect, tier.canAfford) === false;

                  return (
                    <button
                      key={tierId}
                      type="button"
                      className={`custom-tier-option ${selected ? "selected" : ""}`}
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() =>
                        setSelections((current) => ({
                          ...current,
                          [groupId]: tierId,
                        }))
                      }
                      title={
                        disabled
                          ? tier.blockedReason ?? "Locked"
                          : getTierLabel(tier, tierIndex)
                      }
                    >
                      <span>{getTierLabel(tier, tierIndex)}</span>
                      {tierCosts.length > 0 && (
                        <ResourceCost
                          costs={tierCosts}
                          compact
                          resources={resources}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="custom-builder-summary">
        <span>{formatNumber(totalCores)}C</span>
        {totalRamBits > 0 && <span>{formatBits(totalRamBits)} RAM</span>}
        {totalPower > 0 && <span>+{formatWatts(totalPower)}</span>}
        <ResourceCost costs={costs} compact resources={resources} />
        <button
          type="button"
          className="custom-builder-buy"
          disabled={!canBuy}
          title={canBuy ? `Buy custom system: ${formatCost(costs)}` : blockedReason}
          onClick={() =>
            dispatch({
              type: "buyCustomSystem",
              tierIds: selections,
            })
          }
        >
          {canBuy ? <Plus size={12} /> : null}
          <span>{canBuy ? "Build" : blockedReason}</span>
        </button>
      </div>
    </section>
  );
}

export function HardwareBoard({
  visible,
  dispatch,
  selectedComponent,
  onSelectComponent,
  deadlockHelpResource = null,
  deadlockCooldownHelpResource = null,
  showPsuFailureHelp = false,
  onDismissDeadlockHelp,
  onDismissDeadlockCooldownHelp,
  onDismissPsuFailureHelp,
}: HardwareBoardProps) {
  const rack = getRackData(visible);
  const requestedSystemId =
    getSelectedSystemId(selectedComponent) ?? rack.selectedSystemId;
  const scopedSelectionRequested = getSelectedSystemId(selectedComponent) !== null;
  const rackActive = rack.showRack || scopedSelectionRequested;
  const activeSystem = rackActive
    ? (rack.systems.find((system) => system.id === requestedSystemId) ??
      rack.systems[0] ??
      getFallbackRackSystem(visible))
    : getFallbackRackSystem(visible);
  const boardVisible = activeSystem.visible;
  const boardSelection =
    getSelectedSystemComponent(selectedComponent) ?? ("core:1" as SelectedComponent);
  const shouldScopeSystemActions = rackActive;
  const selectComponent = (component: SelectedComponent) =>
    onSelectComponent(
      shouldScopeSystemActions && rack.hasSystemModel
        ? scopeSelectionToSystem(activeSystem.id, component)
        : component,
    );
  const systemDispatch = createSystemDispatch(
    dispatch,
    shouldScopeSystemActions && rack.hasSystemModel ? activeSystem.id : null,
  );
  const selectedCoreId = getSelectedCoreId(boardSelection);
  const selectedCoreGroupCpuId = getSelectedCoreGroupCpuId(boardSelection);
  const selectedSchedulerId = getSelectedSchedulerId(boardSelection);
  const selectedRamStickId = getSelectedRamStickId(boardSelection);
  const selectedAllRamSticks = boardSelection === "ramSticks";
  const schedulerVisible =
    boardVisible.flags.basicQueue ||
    boardVisible.flags.scheduler ||
    getQueueEntries(boardVisible).length > 0;
  const allCoreTuningVisible =
    boardVisible.flags.basicQueue || boardVisible.flags.scheduler;
  const cronVisible = hasCronScheduler(boardVisible);
  const systemSchedulerVisible = boardVisible.flags.scheduler;
  const memoryVisible = hasSystemMemory(boardVisible);
  const psuAdvancedControlsVisible = hasPsuManagement(boardVisible);
  const psuVisible = true;
  const thermalVisible = false;
  const upgradesFor = (component: HardwareComponentId) =>
    boardVisible.upgrades.filter((upgrade) => upgrade.component === component);

  const cpuUpgrades = upgradesFor("cpu");
  const ramUpgrades = upgradesFor("ram");
  const psuUpgrades = upgradesFor("psu");
  const socketUpgrades = upgradesFor("socket");
  const systemSchedulerUpgrades = upgradesFor("scheduler").filter(
    (upgrade) => upgrade.id === "systemSchedulerSlot",
  );

  const cpuSelected = boardSelection === "cpu";
  const cacheSelected = boardSelection === "cache";

  const sockets = boardVisible.metrics.cpuSockets;
  const cacheHelpCpuId =
    (deadlockHelpResource === "cache" || deadlockCooldownHelpResource === "cache")
      ? (boardVisible.metrics.deadlocks.find((deadlock) => deadlock.resource === "cache")
          ?.cpuId ?? null)
      : null;
  const showDeadlockHelp = (resource: DeadlockResource) =>
    deadlockHelpResource === resource;
  const showDeadlockCooldownHelp = (resource: DeadlockResource) =>
    deadlockCooldownHelpResource === resource;
  const showSocketLabel = sockets.length > 1;
  const showEmptySocket = !boardVisible.hardware.secondCpu && boardVisible.flags.secondCpu;
  const railVisible = psuVisible || thermalVisible;
  const multiCpu = sockets.length >= 2;

  const [bankView, setBankView] = useState<CpuBankView>("array");
  const [activeSocketId, setActiveSocketId] = useState<number>(
    sockets[0]?.id ?? 1,
  );

  const socketIdsKey = sockets.map((socket) => socket.id).join(",");
  const coreToSocketKey = sockets
    .map((socket) => `${socket.id}:${socket.cores.map((core) => core.id).join("-")}`)
    .join("|");

  useEffect(() => {
    const idList = socketIdsKey ? socketIdsKey.split(",").map(Number) : [];
    if (idList.length === 0) return;
    if (!idList.includes(activeSocketId)) {
      setActiveSocketId(idList[0] ?? 1);
    }
  }, [socketIdsKey, activeSocketId]);

  useEffect(() => {
    if (selectedSchedulerId !== null) {
      setActiveSocketId(selectedSchedulerId);
      return;
    }
    if (selectedCoreId === null) return;
    const owner = coreToSocketKey
      .split("|")
      .map((chunk) => {
        const [socketIdStr, coresStr] = chunk.split(":");
        return {
          id: Number(socketIdStr),
          coreIds: coresStr ? coresStr.split("-").map(Number) : [],
        };
      })
      .find((entry) => entry.coreIds.includes(selectedCoreId));
    if (owner) setActiveSocketId(owner.id);
  }, [selectedSchedulerId, selectedCoreId, coreToSocketKey]);

  const renderSocket = (socket: VisibleCpuSocket): ReactNode => {
    const moduleLayout = (
      <CpuModuleLayout
        socket={socket}
        visible={boardVisible}
        schedulerVisible={schedulerVisible}
        selectedSchedulerId={selectedSchedulerId}
        selectedCoreId={selectedCoreId}
        selectedCoreGroupCpuId={selectedCoreGroupCpuId}
        allCoreTuningVisible={allCoreTuningVisible}
        cacheSelected={cacheSelected}
        onSelectComponent={selectComponent}
        cpuUpgrades={cpuUpgrades}
        dispatch={systemDispatch}
        showCacheDeadlockHelp={
          deadlockHelpResource === "cache" && cacheHelpCpuId === socket.id
        }
        showCacheDeadlockCooldownHelp={
          showDeadlockCooldownHelp("cache") && cacheHelpCpuId === socket.id
        }
        onDismissDeadlockHelp={onDismissDeadlockHelp}
        onDismissDeadlockCooldownHelp={onDismissDeadlockCooldownHelp}
        showCoreDeadlockPressure={!memoryVisible}
      />
    );

    if (!memoryVisible) {
      return <Fragment key={socket.id}>{moduleLayout}</Fragment>;
    }

    return (
      <CpuPackage
        key={socket.id}
        socket={socket}
        selected={cpuSelected}
        showSocketLabel={showSocketLabel}
        onSelect={() => selectComponent("cpu")}
        cpuUpgrades={cpuUpgrades}
        resources={boardVisible.resources}
        dispatch={systemDispatch}
        deadlockPressure={boardVisible.metrics.deadlockPressure}
      >
        {moduleLayout}
      </CpuPackage>
    );
  };

  return (
    <>
      {rack.showRack && (
        <SystemRackPanel
          rack={rack}
          activeSystemId={activeSystem.id}
          selection={selectedComponent}
          onSelectComponent={onSelectComponent}
          dispatch={systemDispatch}
          resources={visible.resources}
        />
      )}

    <SystemBoard visible={boardVisible}>
      {cronVisible && (
        <CronAutomationSection
          visible={boardVisible}
          selected={boardSelection === "cron"}
          onSelect={() => selectComponent("cron")}
          dispatch={systemDispatch}
        />
      )}

      {systemSchedulerVisible && (
        <SystemSchedulerSection
          visible={boardVisible}
          selected={boardSelection === "scheduler"}
          onSelect={() => selectComponent("scheduler")}
          upgrades={systemSchedulerUpgrades}
          dispatch={systemDispatch}
        />
      )}

      {memoryVisible && (
        <RamSection
          visible={boardVisible}
          selected={isRamSelection(boardSelection)}
          selectedRamStickId={selectedRamStickId}
          selectedAllRamSticks={selectedAllRamSticks}
          onSelect={() => selectComponent("ram")}
          onSelectStick={(stickId) => selectComponent(`ramStick:${stickId}`)}
          onSelectAllSticks={() => selectComponent("ramSticks")}
          upgrades={ramUpgrades}
          dispatch={systemDispatch}
          showDeadlockHelp={showDeadlockHelp("ram")}
          showDeadlockCooldownHelp={showDeadlockCooldownHelp("ram")}
          onDismissDeadlockHelp={onDismissDeadlockHelp}
          onDismissDeadlockCooldownHelp={onDismissDeadlockCooldownHelp}
        />
      )}

      {multiCpu ? (
        <CpuBank
          sockets={sockets}
          view={bankView}
          onChangeView={setBankView}
          activeSocketId={activeSocketId}
          onSelectTab={(socketId) => {
            setActiveSocketId(socketId);
            if (schedulerVisible) selectComponent(`scheduler:${socketId}`);
            else selectComponent("cpu");
          }}
          onOpenSocket={(socketId) => {
            setActiveSocketId(socketId);
            setBankView("tabs");
            if (schedulerVisible) selectComponent(`scheduler:${socketId}`);
            else selectComponent("cpu");
          }}
          onSelectCore={(socketId, coreId) => {
            setActiveSocketId(socketId);
            selectComponent(`core:${coreId}`);
          }}
          renderSocket={renderSocket}
          schedulerVisible={schedulerVisible}
          visible={boardVisible}
          resources={boardVisible.resources}
          dispatch={systemDispatch}
          socketUpgrades={socketUpgrades}
        />
      ) : (
        sockets.map(renderSocket)
      )}

      {showEmptySocket && (
        <EmptySocketSection
          selected={boardSelection === "socket"}
          onSelect={() => selectComponent("socket")}
          upgrades={socketUpgrades}
          resources={boardVisible.resources}
          dispatch={systemDispatch}
        />
      )}

      {railVisible && (
        <SystemRail>
          {psuVisible && (
            <PsuSection
              visible={boardVisible}
              selected={boardSelection === "psu"}
              onSelect={() => selectComponent("psu")}
              upgrades={psuUpgrades}
              dispatch={systemDispatch}
              advancedControls={psuAdvancedControlsVisible}
              showTransitionStatus={!systemSchedulerVisible}
              showFailureHelp={showPsuFailureHelp}
              onDismissFailureHelp={onDismissPsuFailureHelp}
            />
          )}
          {thermalVisible && (
            <ThermalSection
              visible={boardVisible}
              selected={boardSelection === "thermal"}
              onSelect={() => selectComponent("thermal")}
              upgrades={psuUpgrades}
              dispatch={systemDispatch}
              unlocked={false}
            />
          )}
        </SystemRail>
      )}
    </SystemBoard>
    </>
  );
}

/* ============ CPU BANK (multi-socket) ============ */

type CpuBankView = "array" | "tabs";

const getSocketCoreNumber = (socket: VisibleCpuSocket, coreId: number) => {
  const index = socket.cores.findIndex((core) => core.id === coreId);
  return index >= 0 ? index + 1 : coreId;
};

const getSocketCoreLabel = (socket: VisibleCpuSocket, coreId: number) =>
  `C${getSocketCoreNumber(socket, coreId)}`;

const getSocketForCore = (sockets: VisibleCpuSocket[], coreId: number) =>
  sockets.find((socket) => socket.cores.some((core) => core.id === coreId)) ?? null;

const getCoreTargetLabel = (
  sockets: VisibleCpuSocket[],
  coreId: number,
  includeSocket = sockets.length > 1,
) => {
  const socket = getSocketForCore(sockets, coreId);
  if (!socket) return `C${coreId}`;

  return includeSocket
    ? `${socket.label} ${getSocketCoreLabel(socket, coreId)}`
    : getSocketCoreLabel(socket, coreId);
};

function CpuSummaryCard({
  socket,
  selected,
  onSelect,
  onOpenFull,
  onSelectCore,
  schedulerVisible,
  visible,
}: {
  socket: VisibleCpuSocket;
  selected: boolean;
  onSelect: () => void;
  onOpenFull: () => void;
  onSelectCore: (coreId: number) => void;
  schedulerVisible: boolean;
  visible: VisibleState;
}) {
  const activeCount = socket.cores.filter((core) => getCoreActiveTask(core)).length;
  const totalCores = socket.cores.length;
  const cacheUsed = socket.cacheUsedBits ?? 0;
  const cacheCapacity = Math.max(socket.cacheBits ?? 0, 1);
  const cacheSegments = socket.cacheResidency.map(toCacheSegment);
  const cacheStateBits = getCacheStateBits(cacheSegments);
  const bufferPct = Math.min(100, (cacheStateBits.buffering / cacheCapacity) * 100);
  const readyPct = Math.min(
    100 - bufferPct,
    (cacheStateBits.loaded / cacheCapacity) * 100,
  );
  const cacheDeadlocked = socket.deadlockResource === "cache";
  const queueCapacity = Math.max(socket.schedulerSlots ?? 0, 0);
  const queueCount = socket.queuedCount ?? 0;
  const queueItems = schedulerVisible ? getQueueDisplayItems(visible, socket) : [];
  const compactSlotCount = Math.min(queueItems.length, 16);
  const hiddenQueueCount = Math.max(0, queueItems.length - compactSlotCount);
  const summaryQueueColumns = getCompactSchedulerColumnCount(compactSlotCount);
  const deadlocked = socket.deadlocked;

  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("button, input, select, textarea, a")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  };

  return (
    <div
      className={`cpu-summary-card ${selected ? "selected" : ""} ${
        deadlocked ? "deadlocked" : ""
      }`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleCardKeyDown}
      title={`Select ${socket.label} scheduler`}
      aria-label={`Select ${socket.label} scheduler, ${activeCount} of ${totalCores} active`}
    >
      <div className="cpu-summary-head-row">
        <span className="cpu-summary-head">
          <Cpu size={11} />
          <span className="cpu-summary-label">{socket.label}</span>
          <span className="cpu-summary-active">
            <strong>{activeCount}</strong>/{totalCores}
          </span>
        </span>
        <button
          type="button"
          className="cpu-summary-open"
          onClick={(event) => {
            event.stopPropagation();
            onOpenFull();
          }}
          title={`Open ${socket.label} full view`}
          aria-label={`Open ${socket.label} full view`}
        >
          <Rows3 size={12} />
        </button>
      </div>

      {schedulerVisible && (
        <div className="cpu-summary-scheduler" aria-label="Scheduler queue">
          <div className="cpu-summary-scheduler-head">
            <span className="cpu-summary-scheduler-label">
              <ListTodo size={9} />
              <span>Sched</span>
              <strong>
                {queueCount}
                {queueCapacity > 0 ? `/${queueCapacity}` : ""}
              </strong>
            </span>
            {hiddenQueueCount > 0 && (
              <span className="cpu-summary-queue-more">
                +{hiddenQueueCount}
              </span>
            )}
          </div>
          {compactSlotCount > 0 ? (
            <ul
              className={`cpu-summary-queue slots-${compactSlotCount}`}
              style={
                summaryQueueColumns
                  ? ({
                      "--cpu-summary-queue-columns": summaryQueueColumns,
                    } as CSSProperties)
                  : undefined
              }
            >
              {Array.from({ length: compactSlotCount }, (_, index) => {
                const item = queueItems[index];
                const state = getCompactSchedulerItemState(item);
                return (
                  <li
                    key={`${item.id}-${index}`}
                    className={`cpu-summary-queue-slot ${
                      item.active ? "active" : "pending"
                    } ${item.deadlocked ? "deadlocked" : ""}`}
                    title={`${item.name}: ${item.waitingReason}`}
                  >
                    <span className="cpu-summary-queue-index">
                      {index + 1}
                    </span>
                    <span className="cpu-summary-queue-state" title={state}>
                      {state}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <span className="cpu-summary-queue-empty">No queue</span>
          )}
        </div>
      )}

      <div className="cpu-summary-cores-grid" aria-label="Per-core frequency">
        {socket.cores.map((core) => {
          const running = !!getCoreActiveTask(core);
          const coreLabel = getSocketCoreLabel(socket, core.id);
          return (
            <button
              key={core.id}
              type="button"
              className={`cpu-summary-core-cell ${running ? "running" : "idle"} ${
                core.deadlocked ? "deadlocked" : ""
              }`}
              onClick={(event) => {
                event.stopPropagation();
                onSelectCore(core.id);
              }}
              title={`${coreLabel} - ${formatClock(core.clockHz)}`}
              aria-label={`Select ${coreLabel} on ${socket.label}`}
            >
              <span className="cpu-summary-core-tag">{coreLabel}</span>
              <span className="cpu-summary-core-clock">
                {formatClock(core.clockHz)}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={`cpu-summary-cache ${cacheDeadlocked ? "deadlocked" : ""}`}
        aria-label="Cache"
      >
        <span className="cpu-summary-cache-label">
          <HardDrive size={9} />
          <span>Cache</span>
          <strong>
            {formatBits(cacheUsed)}/{formatBits(cacheCapacity)}
          </strong>
        </span>
        <span className="cpu-summary-cache-bar" aria-hidden="true">
          <span
            className="cpu-summary-cache-seg buffer"
            style={{ width: `${bufferPct}%` }}
          />
          <span
            className="cpu-summary-cache-seg ready"
            style={{ width: `${readyPct}%` }}
          />
        </span>
      </div>
    </div>
  );
}

function getCompactSchedulerColumnCount(slotCount: number) {
  if (slotCount <= 1 || slotCount === 4) return null;
  if (slotCount <= 3) return slotCount;
  if (slotCount <= 6 || slotCount === 9) return 3;
  return 4;
}

function getCompactSchedulerItemState(item: UiQueueDisplayItem) {
  if (item.deadlocked) return "LOCK";
  if (item.active) return "RUN";
  return getCompactSchedulerReason(item);
}

function getCompactSchedulerReason(item: UiQueueDisplayItem) {
  const reason = item.waitingReason.toLowerCase();

  if (reason.includes("cache")) return "CACHE";
  if (reason.includes("ram") || reason.includes("memory")) return "RAM";
  if (reason.includes("no idle core") || reason.includes("idle cores")) {
    return "NO CORE";
  }
  if (reason.includes("slot")) return "SLOT";
  if (reason.includes("power") || reason.includes("psu")) return "POWER";
  if (reason.includes("thermal") || reason.includes("cool")) return "THERM";
  if (reason.includes("deadlock") || reason.includes("lock")) return "LOCK";
  if (reason.includes("scheduler") || reason.includes("dispatch")) return "SCHED";
  if (reason.includes("core") || reason.includes("cpu")) return "CORE";

  return "WAIT";
}

function SchedulerStatusText({ children }: { children: ReactNode }) {
  const statusText =
    typeof children === "string" || typeof children === "number"
      ? String(children)
      : "";

  return (
    <span className="scheduler-status-marquee" data-status={statusText}>
      <span>{children}</span>
    </span>
  );
}

function CpuBank({
  sockets,
  view,
  onChangeView,
  activeSocketId,
  onSelectTab,
  onOpenSocket,
  onSelectCore,
  renderSocket,
  schedulerVisible,
  visible,
  resources,
  dispatch,
  socketUpgrades,
}: {
  sockets: VisibleCpuSocket[];
  view: CpuBankView;
  onChangeView: (view: CpuBankView) => void;
  activeSocketId: number;
  onSelectTab: (socketId: number) => void;
  onOpenSocket: (socketId: number) => void;
  onSelectCore: (socketId: number, coreId: number) => void;
  renderSocket: (socket: VisibleCpuSocket) => ReactNode;
  schedulerVisible: boolean;
  visible: VisibleState;
  resources: VisibleState["resources"];
  dispatch: Dispatch;
  socketUpgrades: VisibleUpgrade[];
}) {
  const activeSocket =
    sockets.find((socket) => socket.id === activeSocketId) ?? sockets[0];
  const cpuCount = sockets.length;

  return (
    <section className="cpu-bank" aria-label={`CPU bank (${cpuCount})`}>
      <header className="cpu-bank-header">
        <span className="cpu-bank-title">
          <Cpu size={13} />
          <span>CPUs</span>
          <strong>{cpuCount}</strong>
        </span>
        {view === "tabs" && (
          <nav className="cpu-bank-tabs" aria-label="CPU tabs">
            {sockets.map((socket) => (
              <button
                key={socket.id}
                type="button"
                className={`cpu-bank-tab ${socket.id === activeSocketId ? "active" : ""}`}
                onClick={() => onSelectTab(socket.id)}
              >
                {socket.label}
              </button>
            ))}
          </nav>
        )}
        {socketUpgrades.length > 0 && (
          <div className="cpu-bank-add" aria-label="Add CPU">
            {socketUpgrades.map((upgrade) => (
              <UpgradeStepper
                key={upgrade.id}
                upgrade={upgrade}
                dispatch={dispatch}
                label={upgrade.name}
                className="cpu-bank-add-stepper"
                resources={resources}
              />
            ))}
          </div>
        )}
        <div className="cpu-bank-toggle" role="group" aria-label="CPU view mode">
          <button
            type="button"
            className={`cpu-bank-toggle-btn ${view === "array" ? "active" : ""}`}
            onClick={() => onChangeView("array")}
            aria-pressed={view === "array"}
            title="Array view"
          >
            <LayoutGrid size={12} />
            <span>Array</span>
          </button>
          <button
            type="button"
            className={`cpu-bank-toggle-btn ${view === "tabs" ? "active" : ""}`}
            onClick={() => onChangeView("tabs")}
            aria-pressed={view === "tabs"}
            title="Tabbed view"
          >
            <Rows3 size={12} />
            <span>Tabs</span>
          </button>
        </div>
      </header>

      {view === "array" ? (
        <div
          className="cpu-bank-grid"
          style={{ "--cpu-bank-count": cpuCount } as CSSProperties}
        >
          {sockets.map((socket) => (
            <CpuSummaryCard
              key={socket.id}
              socket={socket}
              selected={socket.id === activeSocketId}
              onSelect={() => onSelectTab(socket.id)}
              onOpenFull={() => onOpenSocket(socket.id)}
              onSelectCore={(coreId) => onSelectCore(socket.id, coreId)}
              schedulerVisible={schedulerVisible}
              visible={visible}
            />
          ))}
        </div>
      ) : (
        <div className="cpu-bank-stack">
          {activeSocket && renderSocket(activeSocket)}
        </div>
      )}
    </section>
  );
}

/* ============ CPU / CORE SECTIONS ============ */

function CpuModuleLayout({
  socket,
  visible,
  schedulerVisible,
  selectedSchedulerId,
  selectedCoreId,
  selectedCoreGroupCpuId,
  allCoreTuningVisible,
  cacheSelected,
  onSelectComponent,
  cpuUpgrades,
  dispatch,
  showCacheDeadlockHelp,
  showCacheDeadlockCooldownHelp,
  onDismissDeadlockHelp,
  onDismissDeadlockCooldownHelp,
  showCoreDeadlockPressure,
}: {
  socket: VisibleCpuSocket;
  visible: VisibleState;
  schedulerVisible: boolean;
  selectedSchedulerId: number | null;
  selectedCoreId: number | null;
  selectedCoreGroupCpuId: number | null;
  allCoreTuningVisible: boolean;
  cacheSelected: boolean;
  onSelectComponent: (component: SelectedComponent) => void;
  cpuUpgrades: VisibleUpgrade[];
  dispatch: Dispatch;
  showCacheDeadlockHelp?: boolean;
  showCacheDeadlockCooldownHelp?: boolean;
  onDismissDeadlockHelp?: () => void;
  onDismissDeadlockCooldownHelp?: () => void;
  showCoreDeadlockPressure?: boolean;
}) {
  const grid = getCoreGridMetrics(socket.cores.length);
  const scheduler = schedulerVisible ? (
    <SchedulerSection
      socket={socket}
      visible={visible}
      selected={selectedSchedulerId === socket.id}
      onSelect={() => onSelectComponent(`scheduler:${socket.id}`)}
      dispatch={dispatch}
    />
  ) : null;
  const cache = (
    <CacheSection
      socket={socket}
      selected={cacheSelected}
      onSelect={() => onSelectComponent("cache")}
      resources={visible.resources}
      dispatch={dispatch}
      deadlockPressure={visible.metrics.deadlockPressure}
      showDeadlockHelp={showCacheDeadlockHelp}
      showDeadlockCooldownHelp={showCacheDeadlockCooldownHelp}
      onDismissDeadlockHelp={onDismissDeadlockHelp}
      onDismissDeadlockCooldownHelp={onDismissDeadlockCooldownHelp}
    />
  );
  const cores = (
    <CoreArraySection
      socket={socket}
      selectedCoreId={selectedCoreId}
      selectedAllCores={allCoreTuningVisible && selectedCoreGroupCpuId === socket.id}
      allCoreTuningVisible={allCoreTuningVisible}
      onSelectCore={(coreId) => onSelectComponent(`core:${coreId}`)}
      onSelectAllCores={() => onSelectComponent(`cores:${socket.id}`)}
      cpuUpgrades={cpuUpgrades}
      resources={visible.resources}
      dispatch={dispatch}
      deadlockPressure={
        showCoreDeadlockPressure ? visible.metrics.deadlockPressure : null
      }
    />
  );

  if (grid.fullWidth) {
    return (
      <Fragment>
        <div className={`scheduler-cache-row ${scheduler ? "" : "cache-only"}`}>
          {scheduler}
          {cache}
        </div>
        {cores}
      </Fragment>
    );
  }

  return (
    <Fragment>
      {scheduler}
      <CoreCacheRow>
        {cores}
        {cache}
      </CoreCacheRow>
    </Fragment>
  );
}

function DeadlockCountdown({
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
  const meterPercent = `${Math.round(clampMeter(pressure.progress) * 1000) / 10}%`;
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
        <span style={{ width: meterPercent }} />
      </span>
      <span className="deadlock-countdown-label">{label}</span>
    </span>
  );
}

const shouldShowCacheDeadlockPressure = (
  socket: VisibleCpuSocket,
  pressure: VisibleState["metrics"]["deadlockPressure"],
) =>
  pressure.seconds > 0 &&
  pressure.resource === "cache" &&
  (pressure.cpuId === null || pressure.cpuId === socket.id);

const shouldShowRamDeadlockPressure = (
  pressure: VisibleState["metrics"]["deadlockPressure"],
) => pressure.seconds > 0 && pressure.resource === "ram";

function CpuPackage({
  socket,
  selected,
  showSocketLabel,
  onSelect,
  cpuUpgrades,
  resources,
  dispatch,
  deadlockPressure,
  children,
}: {
  socket: VisibleCpuSocket;
  selected: boolean;
  showSocketLabel: boolean;
  onSelect: () => void;
  cpuUpgrades: VisibleUpgrade[];
  resources: VisibleState["resources"];
  dispatch: Dispatch;
  deadlockPressure: VisibleState["metrics"]["deadlockPressure"];
  children: ReactNode;
}) {
  const otherCpuUpgrades = cpuUpgrades.filter(
    (upgrade) => upgrade.id !== "clock" && upgrade.id !== "core",
  );
  const activeCount = socket.cores.filter((core) => getCoreActiveTask(core)).length;
  const label = showSocketLabel ? socket.label : "CPU";
  const cooldownActive =
    shouldShowCacheDeadlockPressure(socket, deadlockPressure) &&
    deadlockPressure.lockout;

  return (
    <section
      className={`cpu-package ${selected ? "selected" : ""} ${
        socket.deadlocked ? "deadlocked" : ""
      } ${cooldownActive ? "cooling-down" : ""}`}
    >
      <button
        type="button"
        className="cpu-package-header"
        onClick={onSelect}
      >
        <Cpu size={14} />
        <span>{label}</span>
        {shouldShowCacheDeadlockPressure(socket, deadlockPressure) && (
          <DeadlockCountdown pressure={deadlockPressure} compact />
        )}
        <span className="cpu-package-meta">
          <strong>{activeCount}</strong>/{socket.cores.length} active
        </span>
      </button>

      <div className="cpu-package-body">{children}</div>
      {selected && otherCpuUpgrades.length > 0 && (
        <InlineUpgradeRow
          upgrades={otherCpuUpgrades}
          resources={resources}
          dispatch={dispatch}
        />
      )}
    </section>
  );
}

const getDowngradeTitle = (upgrade: VisibleUpgrade) =>
  upgrade.canDowngrade
    ? `Downgrade ${upgrade.name}: refund ${formatCost(upgrade.refunds)}`
    : (upgrade.downgradeBlockedReason ?? `${upgrade.name} is at minimum`);

function UpgradeStepper({
  upgrade,
  dispatch,
  coreId,
  coreIds,
  cpuId,
  ramStickId,
  ramStickIds,
  label,
  className = "",
  resources,
}: {
  upgrade: VisibleUpgrade;
  dispatch: Dispatch;
  coreId?: number;
  coreIds?: number[];
  cpuId?: number;
  ramStickId?: number;
  ramStickIds?: number[];
  label?: string;
  className?: string;
  resources?: VisibleState["resources"];
}) {
  const buyTitle = `${upgrade.name}: ${formatCost(upgrade.costs)}`;
  const upgradeContext = {
      upgradeId: upgrade.id as UpgradeId,
      ...(coreId !== undefined ? { coreId } : {}),
      ...(coreIds !== undefined ? { coreIds } : {}),
      ...(cpuId !== undefined ? { cpuId } : {}),
      ...(ramStickId !== undefined ? { ramStickId } : {}),
      ...(ramStickIds !== undefined ? { ramStickIds } : {}),
    };
  const dispatchUpgrade = (type: "buyUpgrade" | "downgradeUpgrade") => {
    if (type === "buyUpgrade") {
      dispatch({ type: "buyUpgrade", ...upgradeContext });
      return;
    }

    dispatch({ type: "downgradeUpgrade", ...upgradeContext });
  };

  return (
    <div className={`upgrade-stepper ${upgrade.accent} ${className}`}>
      <button
        type="button"
        className="upgrade-stepper-button minus"
        disabled={!upgrade.canDowngrade}
        title={getDowngradeTitle(upgrade)}
        onClick={() => dispatchUpgrade("downgradeUpgrade")}
      >
        <Minus size={11} />
      </button>
      <span className="upgrade-stepper-spec" title={buyTitle}>
        <span>{label ?? upgrade.name}</span>
        <ResourceCost costs={upgrade.costs} compact resources={resources} />
      </span>
      <button
        type="button"
        className="upgrade-stepper-button plus"
        disabled={!upgrade.canAfford}
        title={buyTitle}
        onClick={() => dispatchUpgrade("buyUpgrade")}
      >
        <Plus size={11} />
      </button>
    </div>
  );
}

function CoreArraySection({
  socket,
  selectedCoreId,
  selectedAllCores,
  allCoreTuningVisible,
  onSelectCore,
  onSelectAllCores,
  cpuUpgrades,
  resources,
  dispatch,
  deadlockPressure,
}: {
  socket: VisibleCpuSocket;
  selectedCoreId: number | null;
  selectedAllCores: boolean;
  allCoreTuningVisible: boolean;
  onSelectCore: (coreId: number) => void;
  onSelectAllCores: () => void;
  cpuUpgrades: VisibleUpgrade[];
  resources: VisibleState["resources"];
  dispatch: Dispatch;
  deadlockPressure?: VisibleState["metrics"]["deadlockPressure"] | null;
}) {
  const coreUpgrade = socket.coreUpgrade ?? cpuUpgrades.find((upgrade) => upgrade.id === "core");
  const activeCount = socket.cores.filter((core) => getCoreActiveTask(core)).length;
  const grid = getCoreGridMetrics(socket.cores.length);
  const gridStyle = {
    "--core-grid-columns": grid.columns,
  } as CSSProperties;
  const selectedCore =
    socket.cores.find((core) => core.id === selectedCoreId) ?? socket.cores[0] ?? null;
  const selectedClockUpgrade = selectedAllCores
    ? socket.allCoreClockUpgrade
    : selectedCore?.clockUpgrade ?? null;
  const selectedClockCoreIds = selectedAllCores
    ? socket.cores.map((core) => core.id)
    : undefined;
  const selectedClockCoreId = selectedAllCores ? undefined : selectedCore?.id;
  const selectedClockCoreLabel = selectedCore
    ? getSocketCoreLabel(socket, selectedCore.id)
    : "C1";
  const cooldownActive = deadlockPressure
    ? shouldShowCacheDeadlockPressure(socket, deadlockPressure) &&
      deadlockPressure.lockout
    : false;

  return (
    <section
      className={`core-array-section ${grid.fullWidth ? "full-width" : ""} ${
        cooldownActive ? "cooling-down" : ""
      }`}
    >
      <div className="core-array-header">
        <span>Cores</span>
        {deadlockPressure &&
          shouldShowCacheDeadlockPressure(socket, deadlockPressure) && (
            <DeadlockCountdown pressure={deadlockPressure} compact />
          )}
        {allCoreTuningVisible && (
          <button
            type="button"
            className={`core-select-all-button ${selectedAllCores ? "active" : ""}`}
            onClick={onSelectAllCores}
            aria-pressed={selectedAllCores}
            aria-label="Tune all core frequencies"
            title="Tune all core frequencies"
          >
            All
          </button>
        )}
        <small>
          <strong>{activeCount}</strong>/{socket.cores.length}
        </small>
      </div>

      <div
        className={`core-grid ${grid.density}`}
        style={gridStyle}
        data-grid={grid.label}
      >
        {socket.cores.map((core) => (
          <CoreDie
            key={core.id}
            core={core}
            density={grid.density}
            selected={selectedAllCores || selectedCoreId === core.id}
            onSelect={() => onSelectCore(core.id)}
            coreLabel={getSocketCoreLabel(socket, core.id)}
            dispatch={dispatch}
          />
        ))}
      </div>

      {(selectedClockUpgrade || coreUpgrade) && (
        <div className="core-control-strip">
          {selectedClockUpgrade && (
            <UpgradeStepper
              upgrade={selectedClockUpgrade}
              dispatch={dispatch}
              coreId={selectedClockCoreId}
              coreIds={selectedClockCoreIds}
              label={selectedAllCores ? "All Freq" : `${selectedClockCoreLabel} Freq`}
              resources={resources}
            />
          )}
          {coreUpgrade && (
            <AddCoreButton
              upgrade={coreUpgrade}
              cpuId={socket.id}
              resources={resources}
              dispatch={dispatch}
            />
          )}
        </div>
      )}
    </section>
  );
}

function CoreDie({
  core,
  coreLabel,
  density,
  selected,
  onSelect,
  dispatch,
}: {
  core: VisibleCore;
  coreLabel: string;
  density: CoreGridDensity;
  selected: boolean;
  onSelect: () => void;
  dispatch: Dispatch;
}) {
  const active = getCoreActiveTask(core);
  const progress =
    active?.coreProgress?.find((operation) => operation.coreId === core.id)?.progress ?? 0;
  const work = active?.name ?? "Idle";
  const cancelActiveTask = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!active) return;

    dispatch({
      type: "cancelTask",
      taskId: active.taskId,
      instanceId: active.instanceId,
    });
  };
  const selectOnKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`core-die ${active ? "running" : ""} ${
        core.deadlocked ? "deadlocked" : ""
      } ${selected ? "selected" : ""}`}
      onClick={onSelect}
      onKeyDown={selectOnKeyDown}
      aria-pressed={selected}
      title={`${coreLabel} - ${formatClock(core.clockHz)} - ${
        core.deadlocked ? "Deadlocked" : work
      }`}
    >
      <span className="core-die-head">
        <span className="core-label">{coreLabel}</span>
        {active && (
          <button
            type="button"
            className="core-cancel-button"
            onClick={cancelActiveTask}
            title={`Cancel ${active.name}`}
            aria-label={`Cancel ${active.name} on ${coreLabel}`}
          >
            <X size={11} />
          </button>
        )}
        <span className="core-status-dot" aria-hidden="true" />
      </span>
      <span className="core-clock">
        <strong>{formatClock(core.clockHz)}</strong>
      </span>
      {density === "normal" && (
        <span className="core-work" title={work}>
          {work}
        </span>
      )}
      <span className="die-progress" aria-hidden="true">
        <span style={{ width: `${clampMeter(progress) * 100}%` }} />
      </span>
    </div>
  );
}

function AddCoreButton({
  upgrade,
  cpuId,
  resources,
  dispatch,
}: {
  upgrade: VisibleUpgrade;
  cpuId: number;
  resources: VisibleState["resources"];
  dispatch: Dispatch;
}) {
  return (
    <UpgradeStepper
      upgrade={upgrade}
      dispatch={dispatch}
      cpuId={cpuId}
      label="Core"
      className="add-core-stepper"
      resources={resources}
    />
  );
}

function EmptySocketSection({
  selected,
  onSelect,
  upgrades,
  resources,
  dispatch,
}: {
  selected: boolean;
  onSelect: () => void;
  upgrades: VisibleUpgrade[];
  resources: VisibleState["resources"];
  dispatch: Dispatch;
}) {
  return (
    <section
      className={`hw-section cpu-section ${selected ? "selected" : ""}`}
    >
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <Cpu size={14} />
        <span>CPU Socket</span>
        <span className="hw-section-meta">Empty</span>
      </button>
      <div className="empty-socket">
        <strong>Install CPU</strong>
        <small>Pick base silicon or copy CPU A specs.</small>
      </div>
      <CpuInstallOptions
        upgrades={upgrades}
        resources={resources}
        dispatch={dispatch}
      />
    </section>
  );
}

const getCpuInstallDescription = (upgrade: VisibleUpgrade) =>
  upgrade.id === "matchedCpu" ? "Matched package" : "Base package";

function CpuInstallOptions({
  upgrades,
  resources,
  dispatch,
}: {
  upgrades: VisibleUpgrade[];
  resources: VisibleState["resources"];
  dispatch: Dispatch;
}) {
  const socketUpgrades = upgrades
    .filter((upgrade) => upgrade.id === "secondCpu" || upgrade.id === "matchedCpu")
    .sort((left, right) =>
      left.id === "secondCpu" && right.id === "matchedCpu" ? -1 : 0,
    );

  if (socketUpgrades.length === 0) return null;

  return (
    <div className="cpu-install-options" aria-label="CPU install options">
      {socketUpgrades.map((upgrade) => {
        const buyTitle = `${upgrade.name}: ${formatCost(upgrade.costs)}`;
        const powerDelta =
          upgrade.powerDeltaWatts === null || upgrade.powerDeltaWatts === undefined
            ? null
            : upgrade.powerDeltaWatts;

        return (
          <button
            key={upgrade.id}
            type="button"
            className={`cpu-install-option ${upgrade.accent}`}
            disabled={!upgrade.canAfford}
            title={buyTitle}
            onClick={() =>
              dispatch({
                type: "buyUpgrade",
                upgradeId: upgrade.id,
              })
            }
          >
            <span className="cpu-install-copy">
              <strong>{upgrade.name}</strong>
              <small>{getCpuInstallDescription(upgrade)}</small>
            </span>
            {powerDelta !== null && (
              <span className="cpu-install-power">
                <small>power</small>
                <strong>+{formatWatts(powerDelta)}</strong>
              </span>
            )}
            <ResourceCost costs={upgrade.costs} compact resources={resources} />
            <Plus size={12} />
          </button>
        );
      })}
    </div>
  );
}

/* ============ CACHE SECTION ============ */

function DeadlockHelpCaption({
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

function CacheSection({
  socket,
  selected,
  onSelect,
  resources,
  dispatch,
  deadlockPressure,
  showDeadlockHelp,
  showDeadlockCooldownHelp,
  onDismissDeadlockHelp,
  onDismissDeadlockCooldownHelp,
}: {
  socket: VisibleCpuSocket;
  selected: boolean;
  onSelect: () => void;
  resources: VisibleState["resources"];
  dispatch: Dispatch;
  deadlockPressure: VisibleState["metrics"]["deadlockPressure"];
  showDeadlockHelp?: boolean;
  showDeadlockCooldownHelp?: boolean;
  onDismissDeadlockHelp?: () => void;
  onDismissDeadlockCooldownHelp?: () => void;
}) {
  const capacity = Math.max(socket.cacheBits, 1);
  const cacheSegments = socket.cacheResidency.map(toCacheSegment);
  const cacheReservation = {
    segments: cacheSegments,
    reservedBits: socket.cacheUsedBits,
    loadingBits: cacheSegments.reduce(
      (total, segment) => total + segment.bufferBits,
      0,
    ),
  };
  const cacheUpgrade = socket.cacheUpgrade;
  const cacheSpeedUpgrade = socket.cacheSpeedUpgrade;
  const stateBits = getCacheStateBits(cacheReservation.segments);
  const cacheDeadlocked = socket.deadlockResource === "cache";
  const cooldownActive =
    shouldShowCacheDeadlockPressure(socket, deadlockPressure) &&
    deadlockPressure.lockout;
  const cacheState = cacheDeadlocked
    ? "Deadlock"
    : cooldownActive
      ? "Cooldown"
    : getCachePrimaryState(cacheReservation.segments);

  return (
    <section
      className={`hw-section cache-section ${selected ? "selected" : ""} ${
        cacheDeadlocked ? "deadlocked" : ""
      } ${cooldownActive ? "cooling-down" : ""}`}
    >
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <HardDrive size={14} />
        <span>Cache</span>
        <span className="hw-section-meta">
          <strong>{cacheState}</strong>
        </span>
      </button>
      {showDeadlockHelp && (
        <DeadlockHelpCaption onDismiss={onDismissDeadlockHelp} />
      )}
      {!showDeadlockHelp && showDeadlockCooldownHelp && (
        <DeadlockHelpCaption
          kind="cooldown"
          onDismiss={onDismissDeadlockCooldownHelp}
        />
      )}

      <div className="cache-stat-row">
        <span className="stat cache-capacity-stat">
          <small>Capacity</small>
          <strong>
            {formatBits(cacheReservation.reservedBits)} / {formatBits(capacity)}
          </strong>
        </span>
        <span className="stat">
          <small>Frequency</small>
          <strong>{formatClock(Math.round(1 * 1.45 ** (socket.cacheSpeedLevel - 1) * 10) / 10)}</strong>
        </span>
      </div>

      <CachePipeline
        segments={cacheReservation.segments}
        stateBits={stateBits}
        capacityBits={capacity}
      />

      {(cacheUpgrade || cacheSpeedUpgrade) && (
        <div className="core-control-strip cache-control-strip">
          {cacheUpgrade && (
            <UpgradeChip
              upgrade={cacheUpgrade}
              dispatch={dispatch}
              cpuId={socket.id}
              label="Size"
              control
              resources={resources}
            />
          )}
          {cacheSpeedUpgrade && (
            <UpgradeChip
              upgrade={cacheSpeedUpgrade}
              dispatch={dispatch}
              cpuId={socket.id}
              label="Freq"
              control
              resources={resources}
            />
          )}
        </div>
      )}

    </section>
  );
}

function UpgradeChip({
  upgrade,
  dispatch,
  coreId,
  cpuId,
  ramStickId,
  ramStickIds,
  label,
  control = false,
  resources,
}: {
  upgrade: VisibleUpgrade;
  dispatch: Dispatch;
  coreId?: number;
  cpuId?: number;
  ramStickId?: number;
  ramStickIds?: number[];
  label?: string;
  control?: boolean;
  resources?: VisibleState["resources"];
}) {
  return (
    <UpgradeStepper
      upgrade={upgrade}
      dispatch={dispatch}
      coreId={coreId}
      cpuId={cpuId}
      ramStickId={ramStickId}
      ramStickIds={ramStickIds}
      label={label}
      className={control ? "control-stepper" : "chip-stepper"}
      resources={resources}
    />
  );
}

/* ============ SCHEDULER SECTION ============ */

const schedulerPolicyLabels: Record<SchedulerPolicy, string> = {
  fifo: "FIFO",
  deadlockSafe: "Deadlock-safe",
  shortestTask: "Shortest",
  smallestMemory: "Smallest memory",
};

const schedulerKillPolicyLabels: Record<SchedulerKillPolicy, string> = {
  deadlockedTask: "Deadlocked",
  newestBlocker: "Newest blocker",
  lowestProgress: "Lowest progress",
};

const formatCountdownSeconds = (seconds: number) =>
  `${formatNumber(Math.max(0, Math.ceil(seconds)))}s`;

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

function SchedulerWatchdogStatus({
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
        <span style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
  );
}

function SchedulerControls({
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
            {(Object.keys(schedulerPolicyLabels) as SchedulerPolicy[]).map((policy) => (
              <option key={policy} value={policy}>
                {schedulerPolicyLabels[policy]}
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

function SchedulerSection({
  socket,
  visible,
  selected,
  onSelect,
  dispatch,
}: {
  socket: VisibleCpuSocket;
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  dispatch: Dispatch;
}) {
  const queueItems = getQueueDisplayItems(visible, socket);
  const slotCapacity = socket.schedulerSlots;
  const schedulerUpgrades = [
    socket.schedulerSlotUpgrade,
    socket.deadlockRecoveryUpgrade,
  ].filter((upgrade): upgrade is VisibleUpgrade => Boolean(upgrade));

  return (
    <section
      className={`hw-section scheduler-section ${selected ? "selected" : ""} ${
        socket.deadlocked ? "deadlocked" : ""
      }`}
    >
      <div className="hw-section-header-row scheduler-header-row">
        <button type="button" className="hw-section-header" onClick={onSelect}>
          <ListTodo size={14} />
          <span>Scheduler</span>
        </button>
        <SchedulerWatchdogStatus watchdog={socket.watchdog} sockets={[socket]} />
        <SchedulerControls
          visible={visible}
          config={socket.schedulerConfig}
          target="cpu"
          cpuId={socket.id}
          dispatch={dispatch}
        />
      </div>

      <QueuePreview
        items={queueItems}
        slotCapacity={slotCapacity}
        ariaLabel="Queued tasks"
        dispatch={dispatch}
      />

      {schedulerUpgrades.length > 0 && (
        <InlineUpgradeRow
          upgrades={schedulerUpgrades}
          resources={visible.resources}
          dispatch={dispatch}
          cpuId={socket.id}
        />
      )}
    </section>
  );
}

/* ============ RAM / PSU / COOLING ============ */

const schedulerGridMaxHeightPx = 144;
const schedulerGridGapPx = 4;

function getSchedulerGridMetrics(
  slotCount: number,
  options: { startSmall?: boolean } = {},
) {
  const count = Math.max(0, slotCount);
  let columns = 2;
  let rows = 2;

  if (count === 0) {
    return {
      columns: 1,
      rows: 1,
      gridHeight: 34,
      slotHeight: 34,
      density: "spacious",
    };
  }

  if (options.startSmall && count <= 4) {
    const smallColumns = count === 1 ? 1 : 2;
    const smallRows = count <= 2 ? 1 : 2;
    const targetSlotHeight = 30;

    return {
      columns: smallColumns,
      rows: smallRows,
      gridHeight: smallRows * targetSlotHeight + (smallRows - 1) * schedulerGridGapPx,
      slotHeight: targetSlotHeight,
      density: "spacious",
    };
  }

  if (count > 36) {
    const side = Math.max(8, Math.ceil(Math.sqrt(count)));
    const evenSide = side % 2 === 0 ? side : side + 1;
    columns = evenSide;
    rows = evenSide;
  } else if (count > 24) {
    columns = 6;
    rows = 6;
  } else if (count > 16) {
    columns = 6;
    rows = 4;
  } else if (count > 8) {
    columns = 4;
    rows = 4;
  } else if (count > 6) {
    columns = 4;
    rows = 2;
  } else if (count > 4) {
    columns = 3;
    rows = 2;
  }

  const targetSlotHeight = rows >= 8 ? 16 : rows >= 6 ? 20 : rows >= 4 ? 24 : 30;
  const gridHeight = Math.min(
    schedulerGridMaxHeightPx,
    rows * targetSlotHeight + (rows - 1) * schedulerGridGapPx,
  );
  const slotHeight = Math.max(
    8,
    Math.floor(
      (gridHeight - (rows - 1) * schedulerGridGapPx) / rows,
    ),
  );
  const density =
    rows >= 8 ? "micro" : rows >= 6 ? "dense" : rows >= 4 ? "compact" : "spacious";

  return { columns, rows, gridHeight, slotHeight, density };
}

function QueuePreview({
  items,
  slotCapacity,
  ariaLabel,
  dispatch,
  emptyLabel,
  startSmall = false,
}: {
  items: UiQueueDisplayItem[];
  slotCapacity: number;
  ariaLabel: string;
  dispatch: Dispatch;
  emptyLabel?: string;
  startSmall?: boolean;
}) {
  const visibleSlotCount = Math.max(Math.max(0, slotCapacity), items.length);
  const grid = getSchedulerGridMetrics(visibleSlotCount, { startSmall });
  const gridStyle = {
    "--scheduler-grid-columns": grid.columns,
    "--scheduler-grid-height": `${grid.gridHeight}px`,
    "--scheduler-slot-height": `${grid.slotHeight}px`,
  } as CSSProperties;

  return (
    <div className="queue-preview" aria-label={ariaLabel}>
      <div
        className={`queue-preview-list ${grid.density}`}
        style={gridStyle}
        data-grid={`${grid.columns}x${grid.rows}`}
      >
        {visibleSlotCount > 0 ? (
          Array.from({ length: visibleSlotCount }, (_, index) => {
            const item = items[index];

            if (!item) {
              return (
                <small
                  className="queue-slot-cell empty"
                  key={`empty-${index}`}
                  title={`Slot ${index + 1}: open`}
                >
                  <span className="queue-slot-index">{index + 1}</span>
                  <span className="queue-slot-state">Open</span>
                </small>
              );
            }

            return (
              <small
                className={`queue-slot-cell ${item.active ? "active" : "pending"} ${
                  item.deadlocked ? "deadlocked" : ""
                }`}
                key={`${item.id}-${index}`}
                title={`${item.name}: ${item.waitingReason}`}
              >
                <span className="queue-slot-index">{index + 1}</span>
                <span className="queue-slot-state">
                  <SchedulerStatusText>{item.waitingReason}</SchedulerStatusText>
                </span>
                <button
                  type="button"
                  className="queue-cancel-button"
                  onClick={() =>
                    dispatch(
                      item.instanceId
                        ? {
                            type: "cancelTask",
                            taskId: item.id,
                            instanceId: item.instanceId,
                          }
                        : { type: "cancelQueuedTask", taskId: item.id },
                    )
                  }
                  title={`Cancel ${item.name}`}
                  aria-label={`Cancel ${item.name}`}
                >
                  <X size={11} />
                </button>
              </small>
            );
          })
        ) : (
          <small className="queue-empty">
            <span>{emptyLabel ?? "No slots"}</span>
          </small>
        )}
      </div>
    </div>
  );
}

function LockedSystemSection({
  className,
  Icon,
  title,
  note,
  selected = false,
  onSelect,
  children,
}: {
  className: string;
  Icon: LucideIcon;
  title: string;
  note: string;
  selected?: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <section
      className={`hw-section locked-system-section ${className} ${
        selected ? "selected" : ""
      }`}
    >
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <Icon size={14} />
        <span>{title}</span>
        <span className="hw-section-meta">
          <strong>Locked</strong>
        </span>
      </button>
      <small className="locked-system-note">{note}</small>
      {children}
    </section>
  );
}

function EfficiencyReadouts({ visible }: { visible: VisibleState }) {
  const efficiency = getEfficiencyMetrics(visible);

  return (
    <div className="efficiency-readouts" aria-label="System efficiency">
      <span>
        <small>RAM/CPU match</small>
        <strong>{formatPercent(efficiency.ramCpuMatch)}</strong>
      </span>
      <span>
        <small>Power efficiency</small>
        <strong>{formatPercent(efficiency.powerEfficiency)}</strong>
      </span>
    </div>
  );
}

function CronAutomationSection({
  visible,
  selected,
  onSelect,
  dispatch,
}: {
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  dispatch: Dispatch;
}) {
  const cron = getCronState(visible);
  const unlocked = hasCronScheduler(visible);

  if (!unlocked) {
    return (
      <LockedSystemSection
        className="scheduler-section cron-section"
        Icon={ListTodo}
        title="System Automation"
        note="Research CRON Scheduler"
        selected={selected}
        onSelect={onSelect}
      />
    );
  }

  const schedules = getCronSchedules(visible);
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
          <span>System Automation</span>
          <span className="hw-section-meta">
            <strong>{activeCount}</strong>/{schedules.length} active
          </span>
        </button>
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

      <div className="cron-footer">
        <span className="cron-min-chip" title="Smallest interval CRON can schedule">
          Min {formatCronInterval(baseMinimumSeconds)}
        </span>
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
      : (tasks[0]?.id ?? "");
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
        <span>Task</span>
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
            <option value="">No system tasks</option>
          ) : (
            tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))
          )}
        </select>
      </label>

      <label className="cron-control cron-interval-control">
        <span>Every</span>
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
        <small>Next job</small>
        <strong>{getCronCountdownLabel(schedule)}</strong>
      </div>
    </div>
  );
}

function SystemSchedulerSection({
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
  const queueItems = getSystemQueueDisplayItems(visible);
  const slotCapacity = getVisibleSystemSchedulerSlots(visible);
  const deadlocked = queueItems.some((item) => item.deadlocked);
  const power = getPowerStats(visible);

  return (
    <section
      className={`hw-section scheduler-section system-scheduler-section ${
        selected ? "selected" : ""
      } ${deadlocked ? "deadlocked" : ""}`}
    >
      <div className="hw-section-header-row scheduler-header-row">
        <button type="button" className="hw-section-header" onClick={onSelect}>
          <ListTodo size={14} />
          <span>System Scheduler</span>
        </button>
        <SchedulerWatchdogStatus
          watchdog={visible.metrics.systemSchedulerWatchdog}
          sockets={visible.metrics.cpuSockets}
        />
        <SchedulerControls
          visible={visible}
          config={visible.hardware.systemSchedulerConfig}
          target="system"
          dispatch={dispatch}
        />
        <SystemShutdownControl power={power} dispatch={dispatch} />
      </div>

      <PowerTransitionBanner power={power} surface="system" />

      <QueuePreview
        items={queueItems}
        slotCapacity={slotCapacity}
        ariaLabel="System scheduler queue"
        dispatch={dispatch}
        emptyLabel="Ready"
        startSmall
      />

      {selected && (
        <InlineUpgradeRow
          upgrades={upgrades}
          resources={visible.resources}
          dispatch={dispatch}
        />
      )}
    </section>
  );
}

function getRamStickGridMetrics(stickCount: number) {
  const count = Math.max(0, stickCount);

  if (count <= 1) return { columns: 1, rows: 1, label: "1x1" };
  if (count <= 2) return { columns: 2, rows: 1, label: "2x1" };
  if (count <= 4) return { columns: 2, rows: 2, label: "2x2" };
  if (count <= 6) return { columns: 3, rows: 2, label: "3x2" };
  if (count <= 8) return { columns: 4, rows: 2, label: "4x2" };

  const columns = Math.min(6, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  return { columns, rows, label: `${columns}x${rows}` };
}


function RamSection({
  visible,
  selected,
  selectedRamStickId,
  selectedAllRamSticks,
  onSelect,
  onSelectStick,
  onSelectAllSticks,
  upgrades,
  dispatch,
  showDeadlockHelp,
  showDeadlockCooldownHelp,
  onDismissDeadlockHelp,
  onDismissDeadlockCooldownHelp,
}: {
  visible: VisibleState;
  selected: boolean;
  selectedRamStickId: number | null;
  selectedAllRamSticks: boolean;
  onSelect: () => void;
  onSelectStick: (stickId: number) => void;
  onSelectAllSticks: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
  showDeadlockHelp?: boolean;
  showDeadlockCooldownHelp?: boolean;
  onDismissDeadlockHelp?: () => void;
  onDismissDeadlockCooldownHelp?: () => void;
}) {
  const status = getSystemLoad(visible);
  const capacity = Math.max(getVisibleRamBits(visible), 1);
  const tone = getStressTone(status.memoryPressure);
  const ramUpgrade = upgrades.find((upgrade) => upgrade.id === "ram");
  const ramReservation = getRamReservation(visible);
  const ramSlots = visible.metrics.ramSlots;
  const ramSegmentsBySlot = getRamSegmentsBySlot(ramSlots, ramReservation.segments);
  const moduleFrequencyLabel = getRamModuleFrequencyLabel(
    ramSlots,
    visible.hardware.ramSpeedMt,
  );
  const stickCount = ramSlots.length;
  const selectedSlot =
    ramSlots.find((slot) => slot.id === selectedRamStickId) ?? ramSlots[0] ?? null;
  const selectedStickIds = selectedAllRamSticks
    ? ramSlots.map((slot) => slot.id)
    : selectedSlot
      ? [selectedSlot.id]
      : [];
  const ramCapacityUpgrade = selectedAllRamSticks
    ? visible.metrics.allRamCapacityUpgrade
    : selectedSlot?.capacityUpgrade ?? null;
  const selectedRamSpeedUpgrade = selectedAllRamSticks
    ? visible.metrics.allRamSpeedUpgrade
    : selectedSlot?.speedUpgrade ?? null;
  const upgradeTargetLabel = selectedAllRamSticks
    ? "All"
    : selectedSlot
      ? `R${selectedSlot.id}`
      : "RAM";
  const ramDeadlocked = visible.metrics.deadlocks.some(
    (deadlock) => deadlock.resource === "ram",
  );
  const cooldownActive =
    shouldShowRamDeadlockPressure(visible.metrics.deadlockPressure) &&
    visible.metrics.deadlockPressure.lockout;
  const ramGrid = getRamStickGridMetrics(stickCount);
  const ramGridStyle = {
    "--ram-stick-grid-columns": ramGrid.columns,
  } as CSSProperties;

  return (
    <section
      className={`hw-section memory-section ${tone} ${selected ? "selected" : ""} ${
        ramDeadlocked ? "deadlocked" : ""
      } ${cooldownActive ? "cooling-down" : ""}`}
    >
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <MemoryStick size={14} />
        <span>RAM</span>
        {shouldShowRamDeadlockPressure(visible.metrics.deadlockPressure) && (
          <DeadlockCountdown pressure={visible.metrics.deadlockPressure} compact />
        )}
        <span className="hw-section-meta">
          <strong>{formatBits(visible.metrics.ramUsedBits)}</strong> used
        </span>
      </button>
      {showDeadlockHelp && (
        <DeadlockHelpCaption onDismiss={onDismissDeadlockHelp} />
      )}
      {!showDeadlockHelp && showDeadlockCooldownHelp && (
        <DeadlockHelpCaption
          kind="cooldown"
          onDismiss={onDismissDeadlockCooldownHelp}
        />
      )}

      <div className="cache-stat-row ram-stat-row">
        <span className="stat">
          <small>Capacity</small>
          <strong>{formatBits(capacity)}</strong>
        </span>
        <span className="stat">
          <small>Module Freq</small>
          <strong>{moduleFrequencyLabel}</strong>
        </span>
        <span className="stat">
          <small>Modules</small>
          <strong>{formatNumber(stickCount)}</strong>
        </span>
        <button
          type="button"
          className={`core-select-all-button ram-select-all-button ${
            selectedAllRamSticks ? "active" : ""
          }`}
          onClick={onSelectAllSticks}
          aria-pressed={selectedAllRamSticks}
          title="Select all RAM sticks"
        >
          All
        </button>
      </div>

      <div
        className="ram-stick-grid"
        style={ramGridStyle}
        data-grid={ramGrid.label}
      >
        {ramSlots.map((slot) => {
          const slotSegments = ramSegmentsBySlot.get(slot.id) ?? [];
          const isSelected =
            selectedAllRamSticks ||
            selectedRamStickId === slot.id ||
            (selectedRamStickId === null && selected && selectedSlot?.id === slot.id);

          return (
            <RamStickCard
              key={slot.id}
              slot={slot}
              selected={isSelected}
              onSelect={() => onSelectStick(slot.id)}
              segments={slotSegments}
            />
          );
        })}
      </div>

      {(ramUpgrade || ramCapacityUpgrade || selectedRamSpeedUpgrade) && (
        <div className="core-control-strip cache-control-strip ram-control-strip">
          {ramUpgrade && (
            <UpgradeChip
              upgrade={ramUpgrade}
              label="Module"
              control
              resources={visible.resources}
              dispatch={dispatch}
            />
          )}
          {ramCapacityUpgrade && (
            <UpgradeChip
              upgrade={ramCapacityUpgrade}
              label={`${upgradeTargetLabel} Size`}
              control
              ramStickId={selectedAllRamSticks ? undefined : selectedSlot?.id}
              ramStickIds={selectedAllRamSticks ? selectedStickIds : undefined}
              resources={visible.resources}
              dispatch={dispatch}
            />
          )}
          {selectedRamSpeedUpgrade && (
            <UpgradeChip
              upgrade={selectedRamSpeedUpgrade}
              label={`${upgradeTargetLabel} Freq`}
              control
              ramStickId={selectedAllRamSticks ? undefined : selectedSlot?.id}
              ramStickIds={selectedAllRamSticks ? selectedStickIds : undefined}
              resources={visible.resources}
              dispatch={dispatch}
            />
          )}
        </div>
      )}
    </section>
  );
}

function RamStickCard({
  slot,
  selected,
  onSelect,
  segments,
}: {
  slot: VisibleRamSlot;
  selected: boolean;
  onSelect: () => void;
  segments: RamSegment[];
}) {
  const state = getRamPrimaryState(segments);
  const capacity = Math.max(slot.sizeBits, 1);
  const used = Math.min(slot.usedBits, capacity);
  const pct = Math.round((used / capacity) * 100);
  const active = slot.usedBits > 0;
  const stateClass = state.toLowerCase();

  return (
    <button
      type="button"
      className={`ram-stick-module ${active ? "active" : ""} ${
        selected ? "selected" : ""
      } ram-stick-state-${stateClass}`}
      onClick={onSelect}
      aria-pressed={selected}
      title={`R${slot.id} - ${formatBits(slot.sizeBits)} - ${formatClock(slot.speedMt)} - ${state}`}
    >
      <span className="ram-stick-module-head">
        <span className="ram-stick-label">R{slot.id}</span>
        <span className="ram-stick-module-pct">{pct}%</span>
      </span>
      <span className="ram-stick-module-meter" aria-hidden="true">
        {segments.length > 0 ? (
          <RamPressureMeter segments={segments} capacityBits={capacity} />
        ) : (
          <ModuleMeter value={0} />
        )}
      </span>
      <span className="ram-stick-module-foot">
        <span>{formatBits(slot.sizeBits)}</span>
        <span>{formatClock(slot.speedMt)}</span>
      </span>
    </button>
  );
}

function SystemShutdownControl({
  power,
  dispatch,
}: {
  power: ReturnType<typeof getPowerStats>;
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

function PowerTransitionBanner({
  power,
  surface,
}: {
  power: ReturnType<typeof getPowerStats>;
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
        <span style={{ width: `${progress * 100}%` }} />
      </span>
    </div>
  );
}

function PsuSection({
  visible,
  selected,
  onSelect,
  upgrades,
  dispatch,
  advancedControls,
  showTransitionStatus,
  showFailureHelp,
  onDismissFailureHelp,
}: {
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
  advancedControls: boolean;
  showTransitionStatus: boolean;
  showFailureHelp?: boolean;
  onDismissFailureHelp?: () => void;
}) {
  const power = getPowerStats(visible);
  const powerControls = getPowerControls(visible, power.state);
  const tone = getStressTone(power.stress);
  const psuUpgrade = upgrades.find((upgrade) => upgrade.id === "psu");
  const otherUpgrades = upgrades.filter(
    (upgrade) => upgrade.id !== "psu" && upgrade.id !== "cooling",
  );
  const stateLabel = {
    on: "On",
    off: "Off",
    booting: "Booting",
    shuttingDown: "Shutting down",
  }[power.state];
  const bootButtonClass =
    power.state === "off" ? "go" : power.state === "booting" ? "active" : "";

  const loadPercent = Math.min(100, Math.max(0, power.stress * 100));
  const showOverloadFailure =
    power.overloadFailure.active || power.overloadFailure.progress > 0;
  const overloadLabel = power.overloadFailure.tripped
    ? "PSU failure"
    : power.stress > 1
      ? `${formatCountdownSeconds(power.overloadFailure.remainingSeconds)} to fail`
      : "Resetting";

  return (
    <section
      className={`hw-section psu-section ${tone} power-${power.state} ${
        power.stress > 1 ? "overloaded" : ""
      } ${selected ? "selected" : ""}`}
    >
      <div className="psu-header-row">
        <button type="button" className="hw-section-header" onClick={onSelect}>
          <Power size={14} />
          <span>PSU</span>
        </button>
        {showOverloadFailure && (
          <PsuHeaderWarning
            label={overloadLabel}
            progress={power.overloadFailure.progress}
            flashing={power.overloadFailure.active || power.overloadFailure.tripped}
            tripped={power.overloadFailure.tripped}
          />
        )}
        {powerControls.showControls && (
          <div className="power-control-buttons" aria-label={`Power controls: ${stateLabel}`}>
            <button
              type="button"
              className={bootButtonClass}
              onClick={() => dispatch({ type: "setPowerState", state: "on" })}
              disabled={!powerControls.canPowerOn}
              aria-pressed={power.state === "booting"}
            >
              Boot
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => dispatch({ type: "killPower" })}
              disabled={!powerControls.canPowerKill}
              aria-pressed={false}
            >
              Kill
            </button>
          </div>
        )}
      </div>

      {showFailureHelp && (
        <DeadlockHelpCaption kind="psuFailure" onDismiss={onDismissFailureHelp} />
      )}

      {showTransitionStatus && (
        <PowerTransitionBanner power={power} surface="psu" />
      )}

      <div className="psu-hero">
        <span className="psu-hero-stat psu-hero-draw-stat">
          <span className="psu-hero-draw">{formatWatts(power.drawWatts)}</span>
          <span className="psu-hero-capacity">
            <span className="psu-hero-divider">/</span>
            {formatWatts(power.capacityWatts)}
          </span>
        </span>
        <span className="psu-hero-stat psu-hero-cost-stat">
          <span className="psu-hero-cost">
            {formatPowerRate(power.costPerSecond)}
          </span>
          <span className="psu-hero-cost-unit">cr/s</span>
        </span>
      </div>

      <div className="psu-load-row">
        <span className="psu-load-label">
          <strong>{formatPercent(power.stress)}</strong>
          <small>load</small>
        </span>
        <div
          className="psu-load-meter"
          role="img"
          aria-label={`PSU load ${formatPercent(power.stress)}`}
        >
          <div
            className="psu-load-meter-fill"
            style={{ width: `${loadPercent}%` }}
          />
          <span className="psu-load-meter-tick" aria-hidden="true" />
          <span className="psu-load-meter-tick critical" aria-hidden="true" />
        </div>
      </div>

      {power.billingGraceSeconds > 0 && (
        <div className="psu-meta-row">
          <div className="psu-meta-cell psu-meta-grace">
            <small>grace</small>
            <strong>{formatCountdownSeconds(power.billingGraceSeconds)}</strong>
          </div>
        </div>
      )}

      {psuUpgrade && (
        <div className="power-upgrade-row">
          <UpgradeStepper
            upgrade={psuUpgrade}
            dispatch={dispatch}
            label="PSU Capacity"
            className="inline-stepper"
            resources={visible.resources}
          />
        </div>
      )}

      {advancedControls && selected && otherUpgrades.length > 0 && (
        <InlineUpgradeRow
          upgrades={otherUpgrades}
          resources={visible.resources}
          dispatch={dispatch}
        />
      )}
    </section>
  );
}

function PsuHeaderWarning({
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
        <span style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%` }} />
      </span>
    </span>
  );
}

function ThermalSection({
  visible,
  selected,
  onSelect,
  upgrades,
  dispatch,
  unlocked,
}: {
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
  unlocked: boolean;
}) {
  const status = getSystemLoad(visible);
  const tone = getStressTone(status.coolingStress);
  const coolingUpgrade = upgrades.find((upgrade) => upgrade.id === "cooling");

  if (!unlocked) {
    return (
      <LockedSystemSection
        className="thermal-section"
        Icon={Thermometer}
        title="Thermal"
        note="Research Thermal Control"
        selected={selected}
        onSelect={onSelect}
      />
    );
  }

  return (
    <section
      className={`hw-section thermal-section ${tone} ${selected ? "selected" : ""}`}
    >
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <Thermometer size={14} />
        <span>Thermal</span>
        <span className="hw-section-meta">
          <strong>{status.coolingStatus}</strong>
        </span>
      </button>

      <div className="module-stat">
        <strong>{formatPercent(status.coolingStress)}</strong>
        <small>stress</small>
      </div>

      {status.coolingStress !== null && <ModuleMeter value={status.coolingStress} />}

      {coolingUpgrade && (
        <div className="power-upgrade-row">
          <UpgradeStepper
            upgrade={coolingUpgrade}
            dispatch={dispatch}
            label="Cooling Loop"
            className="inline-stepper"
            resources={visible.resources}
          />
        </div>
      )}
    </section>
  );
}

/* ============ INLINE UPGRADES ============ */

function InlineUpgradeRow({
  upgrades,
  resources,
  dispatch,
  cpuId,
}: {
  upgrades: VisibleUpgrade[];
  resources: VisibleState["resources"];
  dispatch: Dispatch;
  cpuId?: number;
}) {
  if (upgrades.length === 0) return null;

  return (
    <div className="inline-upgrade-row" aria-label="Upgrades">
      {upgrades.map((upgrade) => (
        <UpgradeStepper
          key={upgrade.id}
          upgrade={upgrade}
          dispatch={dispatch}
          cpuId={cpuId}
          label={upgrade.name}
          className="inline-stepper"
          resources={resources}
        />
      ))}
    </div>
  );
}

/* ============ TASK BAY ============ */

const taskGroups: Array<{ id: TaskCategoryId; label: string }> = [
  { id: "cpu", label: "CPU Bound" },
  { id: "system", label: "System" },
  { id: "distributed", label: "Distributed" },
  { id: "other", label: "Other" },
];

const getTaskCategory = (task: UiTask): TaskCategoryId => {
  if (task.category === "cpu") return "cpu";
  if (task.category === "system") return "system";
  if (task.category === "distributed") return "distributed";
  return "other";
};

function TaskRoutePicker({
  visible,
  selection,
  onSelectComponent,
}: {
  visible: VisibleState;
  selection: SelectedComponent;
  onSelectComponent: (component: SelectedComponent) => void;
}) {
  const systemId = getSelectedSystemId(selection);
  const routeSelection =
    getSelectedSystemComponent(selection) ?? ("core:1" as SelectedComponent);
  const selectComponent = (component: SelectedComponent) =>
    onSelectComponent(scopeSelectionToSystem(systemId, component));
  const sockets = visible.metrics.cpuSockets;
  const cores = sockets.flatMap((socket) => socket.cores);
  const firstCoreId = cores[0]?.id ?? 1;
  const firstSocketId = sockets[0]?.id ?? 1;
  const schedulerVisible =
    visible.flags.basicQueue || visible.flags.scheduler || getQueueEntries(visible).length > 0;
  const selectedCoreId = getSelectedCoreId(routeSelection) ?? firstCoreId;
  const selectedSchedulerId = getSelectedSchedulerId(routeSelection) ?? firstSocketId;
  const layer: TaskRouteLayer =
    routeSelection?.startsWith("scheduler:") && schedulerVisible
      ? "scheduler"
      : "core";
  const layerOptions: Array<{ value: TaskRouteLayer; label: string; title: string }> = [
    { value: "core", label: "C", title: "Direct core" },
    ...(schedulerVisible
      ? [{ value: "scheduler" as const, label: "CPU", title: "CPU scheduler" }]
      : []),
  ];

  const selectLayer = (nextLayer: TaskRouteLayer) => {
    if (nextLayer === "core") {
      selectComponent(`core:${selectedCoreId || firstCoreId}`);
      return;
    }

    if (nextLayer === "scheduler") {
      selectComponent(`scheduler:${selectedSchedulerId || firstSocketId}`);
    }
  };

  const selectTarget = (value: string) => {
    if (layer === "core") {
      selectComponent(`core:${Number(value) || firstCoreId}`);
      return;
    }

    if (layer === "scheduler") {
      selectComponent(`scheduler:${Number(value) || firstSocketId}`);
    }
  };

  return (
    <div className="task-route-picker" aria-label="Task route">
      <select
        className="task-route-select task-route-layer-select"
        value={layer}
        onChange={(event) => selectLayer(event.currentTarget.value as TaskRouteLayer)}
        aria-label="Route layer"
        title="Route layer"
      >
        {layerOptions.map((option) => (
          <option key={option.value} value={option.value} title={option.title}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        className="task-route-select task-route-target-select"
        value={
          layer === "core"
            ? String(selectedCoreId)
            : String(selectedSchedulerId)
        }
        onChange={(event) => selectTarget(event.currentTarget.value)}
        aria-label={layer === "core" ? "Core target" : "CPU target"}
        title={layer === "core" ? "Core target" : "CPU target"}
      >
        {layer === "core" &&
          sockets.map((socket) => (
            <optgroup key={socket.id} label={socket.label}>
              {socket.cores.map((core) => (
                <option key={core.id} value={core.id}>
                  {getSocketCoreLabel(socket, core.id)}
                </option>
              ))}
            </optgroup>
          ))}
        {layer === "scheduler" &&
          sockets.map((socket) => (
            <option key={socket.id} value={socket.id}>
              CPU {socket.id}
            </option>
          ))}
      </select>
    </div>
  );
}

export function TaskBay({
  visible,
  selectedComponent,
  onSelectComponent,
  dispatch,
  pinnedTaskIds = [],
  onTogglePinnedTask,
}: {
  visible: VisibleState;
  selectedComponent: SelectedComponent;
  onSelectComponent?: (component: SelectedComponent) => void;
  dispatch: Dispatch;
  pinnedTaskIds?: string[];
  onTogglePinnedTask?: (taskId: string) => void;
}) {
  const tasks = getTasks(visible);
  const activeTasks = getActiveTasks(visible);
  const queue = getQueueEntries(visible);
  const [inspectedTaskId, setInspectedTaskId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<TaskCategoryId>>(
    () => new Set(),
  );
  const inspectedTask = tasks.find((task) => task.id === inspectedTaskId) ?? null;
  const memoryUnlocked = hasSystemMemory(visible);
  const groupedTasks = taskGroups
    .map((group) => ({
      ...group,
      tasks: tasks.filter((task) => getTaskCategory(task) === group.id),
    }))
    .filter((group) => group.tasks.length > 0);

  const toggleGroup = (id: TaskCategoryId) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runTask = (task: UiTask) =>
    dispatchRunTask(task, visible, selectedComponent, dispatch);

  return (
    <>
      <div className="panel-header task-panel-header">
        <ListTodo size={14} />
        <span>Tasks</span>
      </div>
      <div className="panel-body">
        {tasks.length === 0 ? (
          <div className="research-empty">No tasks available</div>
        ) : (
          groupedTasks.map((group) => {
            const collapsed = collapsedGroups.has(group.id);
            const groupRoute = resolveTaskRoute(
              visible,
              selectedComponent,
              group.id,
            );
            const groupMode = groupRoute.mode;
            const groupCoreBusy =
              groupMode === "core" &&
              Boolean(
                groupRoute.selectedCore && getCoreActiveTask(groupRoute.selectedCore),
              );
            const groupTargetLabel = getRouteTargetLabel(visible, groupRoute);

            return (
              <section
                className={`task-group ${collapsed ? "collapsed" : ""}`}
                key={group.id}
              >
                <div className="task-group-title">
                  <button
                    type="button"
                    className="task-group-toggle"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={!collapsed}
                    aria-label={
                      collapsed ? `Expand ${group.label}` : `Collapse ${group.label}`
                    }
                  >
                    {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <span>{group.label}</span>
                    <small>{group.tasks.length}</small>
                  </button>
                  {onSelectComponent && (
                    <TaskGroupRoutePicker
                      visible={visible}
                      category={group.id}
                      selection={selectedComponent}
                      onSelectComponent={onSelectComponent}
                    />
                  )}
                </div>
                {!collapsed &&
                  group.tasks.map((task, taskIndex) => {
                    const canStart = getTaskCanUseAction(task, groupMode);
                    const disabled = groupCoreBusy || !canStart;

                    return (
                      <TaskCard
                        key={`${group.id}-${task.id}-${taskIndex}`}
                        task={task}
                        mode={groupMode}
                        state={getTaskState(task, activeTasks, queue)}
                        disabled={disabled}
                        disabledReason={
                          disabled
                            ? groupCoreBusy
                              ? `${groupTargetLabel} busy`
                              : getTaskActionDisabledReason(task, groupMode)
                            : null
                        }
                        onRun={() => runTask(task)}
                        onInspect={() => setInspectedTaskId(task.id)}
                        memoryUnlocked={memoryUnlocked}
                        pinned={pinnedTaskIds.includes(task.id)}
                        onTogglePin={
                          onTogglePinnedTask
                            ? () => onTogglePinnedTask(task.id)
                            : undefined
                        }
                      />
                    );
                  })}
              </section>
            );
          })
        )}
      </div>
      {inspectedTask && (
        <TaskDagModal
          task={inspectedTask}
          visible={visible}
          activeTask={getActiveTaskFor(inspectedTask, activeTasks)}
          onClose={() => setInspectedTaskId(null)}
          memoryUnlocked={memoryUnlocked}
        />
      )}
    </>
  );
}

function getRouteTargetLabel(
  visible: VisibleState,
  route: ReturnType<typeof resolveTaskRoute>,
): string {
  const { mode, selectedCore, selectedSchedulerId } = route;
  if (mode === "systemScheduler") return "System scheduler";
  if (mode === "scheduler") return `CPU ${selectedSchedulerId ?? 1}`;
  if (!selectedCore) return "Core";
  const socket = getSocketForCore(visible.metrics.cpuSockets, selectedCore.id);
  return socket
    ? `${socket.label} ${getSocketCoreLabel(socket, selectedCore.id)}`
    : `Core ${selectedCore.id}`;
}

function TaskGroupRoutePicker({
  visible,
  category,
  selection,
  onSelectComponent,
}: {
  visible: VisibleState;
  category: TaskCategoryId;
  selection: SelectedComponent;
  onSelectComponent: (component: SelectedComponent) => void;
}) {
  const systemId = getSelectedSystemId(selection);
  const routeSelection = getSelectedSystemComponent(selection);
  const selectComponent = (component: SelectedComponent) =>
    onSelectComponent(scopeSelectionToSystem(systemId, component));

  if (category === "cpu") {
    return (
      <TaskRoutePicker
        visible={visible}
        selection={routeSelection}
        onSelectComponent={selectComponent}
      />
    );
  }

  if (category === "system") {
    if (!visible.flags.scheduler) return null;
    return (
      <div className="task-route-picker" aria-label="System route">
        <select
          className="task-route-select task-route-target-select"
          value="system"
          onChange={() => selectComponent("scheduler")}
          aria-label="System target"
          title="System scheduler"
        >
          <option value="system">System</option>
        </select>
      </div>
    );
  }

  return null;
}

function TaskCard({
  task,
  mode,
  state,
  disabled,
  disabledReason,
  onRun,
  onInspect,
  memoryUnlocked,
  pinned = false,
  onTogglePin,
}: {
  task: UiTask;
  mode: QueueMode;
  state: TaskState;
  disabled: boolean;
  disabledReason: string | null;
  onRun: () => void;
  onInspect: () => void;
  memoryUnlocked: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const operationCount = getTaskOperationCount(task);
  const cacheBits = getTaskCacheBits(task);
  const ramBits = getTaskRamBits(task);
  const requiredCores = getRequiredCoreCount(task);
  const rewards = getTaskRewardCosts(task);
  const commandLabel =
    mode === "systemScheduler"
      ? "Schedule"
      : mode === "scheduler"
      ? "Queue"
      : "Assign";
  const buttonLabel = disabled && disabledReason ? disabledReason : commandLabel;
  const cardState = state === "deadlock" ? "active" : state;

  return (
    <article className={`task-card ${task.kind ?? "task"} ${cardState}`}>
      <div className="task-row-top">
        <strong>{task.name}</strong>
        {onTogglePin && (
          <button
            type="button"
            className={`task-pin-button ${pinned ? "pinned" : ""}`}
            onClick={onTogglePin}
            title={pinned ? `Unpin ${task.name}` : `Pin ${task.name}`}
            aria-label={pinned ? `Unpin ${task.name}` : `Pin ${task.name}`}
            aria-pressed={pinned}
          >
            {pinned ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
        )}
      </div>

      <div className="task-meta-line">
          <span className="ops">
            <strong>{operationCount === undefined ? "·" : formatNumber(operationCount)}</strong> ops
          </span>
          {isElasticTask(task) ? (
            <span>uses idle cores</span>
          ) : (
            requiredCores > 1 && <span>{formatNumber(requiredCores)} cores</span>
          )}
          {cacheBits > 0 && <span>cache {formatBits(cacheBits)}</span>}
          {(memoryUnlocked || ramBits > 0) && ramBits > 0 && (
            <span>ram {formatBits(ramBits)}</span>
          )}
          {rewards.length > 0 && <ResourceCost costs={rewards} compact />}
      </div>

      <div className="task-action-row">
        <button
          type="button"
          className={`task-run-button ${disabledReason ? "blocked" : ""}`}
          disabled={disabled}
          onClick={onRun}
          title={buttonLabel}
        >
          {!disabledReason && <Play size={11} />}
          <span>{buttonLabel}</span>
        </button>
        <button
          type="button"
          className="task-inspect-button"
          onClick={onInspect}
          title={`Inspect ${task.name}`}
          aria-label={`Inspect ${task.name}`}
        >
          <Eye size={13} />
        </button>
      </div>
    </article>
  );
}

/* ============ PINNED TASK BAR ============ */

export function PinnedTaskBar({
  visible,
  pinnedTaskIds,
  onUnpinTask,
  onClearPinnedTasks,
  dispatch,
  selectedComponent,
  variant = "floating",
}: {
  visible: VisibleState;
  pinnedTaskIds: string[];
  onUnpinTask: (taskId: string) => void;
  onClearPinnedTasks: () => void;
  dispatch: Dispatch;
  selectedComponent: SelectedComponent;
  variant?: "embedded" | "floating";
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);

  if (pinnedTaskIds.length === 0) return null;

  const tasks = getTasks(visible);

  const pinned = pinnedTaskIds
    .map((id) => tasks.find((task) => task.id === id))
    .filter(hasValue);

  if (pinned.length === 0) return null;

  const { mode: routeMode, selectedCore: routeSelectedCore } = resolveTaskRoute(
    visible,
    selectedComponent,
  );
  const routeCoreBusy =
    routeMode === "core" &&
    Boolean(routeSelectedCore && getCoreActiveTask(routeSelectedCore));

  return (
    <aside
      className={`pinned-task-bar ${variant} ${expanded ? "expanded" : "collapsed"} ${
        editing ? "editing" : ""
      }`}
      aria-label="Pinned tasks"
    >
      <header className="pinned-task-bar-header">
        <button
          type="button"
          className="pinned-task-bar-toggle"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse pinned tasks" : "Expand pinned tasks"}
        >
          <Pin size={12} />
          <span>Pinned</span>
          <span className="pinned-task-bar-count">{pinned.length}</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        {expanded && (
          <button
            type="button"
            className={`pinned-task-bar-edit ${editing ? "active" : ""}`}
            onClick={() => setEditing((prev) => !prev)}
            aria-pressed={editing}
            title={editing ? "Done editing" : "Edit pins"}
            aria-label={editing ? "Done editing pinned tasks" : "Edit pinned tasks"}
          >
            <Pencil size={12} />
          </button>
        )}
        {editing && (
          <button
            type="button"
            className="pinned-task-bar-clear"
            onClick={onClearPinnedTasks}
            title="Unpin all"
            aria-label="Unpin all tasks"
          >
            <X size={13} />
          </button>
        )}
      </header>
      {expanded && (
        <ul className="pinned-task-bar-body">
          {pinned.map((task) => {
            const canUseRoute = getTaskCanUseAction(task, routeMode) === true;
            const disabled = routeCoreBusy || !canUseRoute;
            const disabledReason = disabled
              ? routeCoreBusy
                ? "Core busy"
                : getTaskActionDisabledReason(task, routeMode)
              : null;
            const commandLabel =
              routeMode === "systemScheduler"
                ? "Schedule"
                : routeMode === "scheduler"
                  ? "Queue"
                  : "Assign";
            const buttonLabel =
              disabled && disabledReason ? disabledReason : commandLabel;
            const rowState: TaskState = disabledReason ? "locked" : "ready";

            return (
              <li className={`pinned-task-row ${rowState}`} key={task.id}>
                {editing && (
                  <button
                    type="button"
                    className="pinned-task-unpin"
                    onClick={() => onUnpinTask(task.id)}
                    title={`Unpin ${task.name}`}
                    aria-label={`Unpin ${task.name}`}
                  >
                    <PinOff size={11} />
                  </button>
                )}
                <strong className="pinned-task-name">{task.name}</strong>
                <button
                  type="button"
                  className={`pinned-task-action ${disabledReason ? "blocked" : ""}`}
                  disabled={disabled}
                  onClick={() =>
                    dispatchRunTask(task, visible, selectedComponent, dispatch)
                  }
                  title={buttonLabel}
                >
                  {!disabledReason && <Play size={11} />}
                  <span>{buttonLabel}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

/* ============ RESEARCH PANEL ============ */

export function ResearchPanel({
  visible,
  dispatch,
}: {
  visible: VisibleState;
  dispatch: Dispatch;
}) {
  const research = getResearch(visible);
  const [hideCompleted, setHideCompleted] = useState(true);
  const visibleResearch = hideCompleted
    ? research.filter((item) => !isResearchPurchased(item))
    : research;
  const openCount = research.filter((item) => !isResearchPurchased(item)).length;

  return (
    <>
      <div className="panel-header">
        <Activity size={14} />
        <span>Research</span>
        <small>{openCount}</small>
        <label className="research-filter-toggle">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(event) => setHideCompleted(event.target.checked)}
          />
          <span>Hide built</span>
        </label>
      </div>
      <div className="panel-body">
        {visibleResearch.length === 0 ? (
          <div className="research-empty">
            {research.length > 0 && hideCompleted ? "No open research" : "Nothing to research"}
          </div>
        ) : (
          visibleResearch.map((item) => (
            <ResearchAction
              key={item.id}
              research={item}
              memoryUnlocked={hasSystemMemory(visible)}
              resources={visible.resources}
              dispatch={dispatch}
            />
          ))
        )}
      </div>
    </>
  );
}

function isResearchPurchased(research: UiResearch) {
  return Boolean(
    research.purchased ||
      research.completed ||
      research.status?.toLowerCase() === "purchased" ||
      research.status?.toLowerCase() === "complete",
  );
}

const getResearchRequirementTag = (kind: string | undefined) => {
  if (kind === "compute") return "Compute";
  if (kind === "hardware") return "HW";
  if (kind === "task") return "Task";
  return "Req";
};

const isResearchComputeComplete = (task: UiResearchComputeTask) =>
  Boolean(task.completed || getTaskCompletedCount(task) > 0);

function ResearchAction({
  research,
  memoryUnlocked,
  resources,
  dispatch,
}: {
  research: UiResearch;
  memoryUnlocked: boolean;
  resources: VisibleState["resources"];
  dispatch: Dispatch;
}) {
  const costs = research.costs ?? research.cost ?? [];
  const lockedReason =
    research.blockedReason ??
    research.lockedReason ??
    research.lockReason ??
    research.unlockReason ??
    null;
  const requirements = research.requirements ?? [];
  const computeTasks = research.computeTasks ?? [];
  const purchased = isResearchPurchased(research);
  const canBuy =
    !purchased &&
    !lockedReason &&
    (research.canAfford ?? research.canBuy ?? costs.length === 0);
  const buyLabel = purchased
    ? "Built"
    : !canBuy && lockedReason
      ? lockedReason
      : !canBuy
        ? "Locked"
        : "Buy";

  return (
    <article
      className={`research-action ${research.accent ?? "violet"} ${
        purchased ? "purchased" : ""
      }`}
    >
      <div className={`research-action-main ${!canBuy && !purchased ? "blocked" : ""}`}>
        <span className="research-copy">
          <strong>{research.name}</strong>
          <em className="research-cost-line">
            {purchased ? (
              "Built"
            ) : (
              <ResourceCost costs={costs} compact resources={resources} />
            )}
          </em>
        </span>
        <button
          type="button"
          className={`research-buy-button ${!canBuy && !purchased ? "blocked" : ""}`}
          disabled={!canBuy}
          onClick={() => dispatch({ type: "buyResearch", researchId: research.id })}
          title={buyLabel}
        >
          {purchased ? (
            <CheckCircle2 size={12} />
          ) : (
            canBuy && <Plus size={12} />
          )}
          <span>{buyLabel}</span>
        </button>
      </div>

      {requirements.length > 0 && !purchased && (
        <div className="research-requirements" aria-label={`${research.name} requirements`}>
          {requirements.map((item) => (
            <span
              className={`research-requirement ${item.met ? "met" : "open"}`}
              key={item.id}
            >
              <b>{item.met ? "✓" : getResearchRequirementTag(item.kind)}</b>
              <small>{item.label}</small>
            </span>
          ))}
        </div>
      )}

      {computeTasks.length > 0 && !purchased && (
        <div className="research-compute-list">
          {computeTasks.map((task) => {
            const completed = isResearchComputeComplete(task);
            const active = Boolean(task.active);
            const canStart = getTaskCanStart(task);
            const disabled = completed || active || !canStart;
            const blockedReason =
              !completed && !active && disabled
                ? getTaskLockedReason(task) ?? getTaskQueueBlockedReason(task) ?? "Locked"
                : null;
            const buttonLabel = completed
              ? "Done"
              : active
                ? "..."
                : blockedReason
                  ? blockedReason
                  : task.canQueue
                    ? "Queue"
                    : "Run";

            return (
              <div
                className={`research-compute ${blockedReason ? "blocked" : ""}`}
                key={task.id}
              >
                <span className="research-compute-copy">
                  <strong>{task.name}</strong>
                  <TaskMetaLine task={task} memoryUnlocked={memoryUnlocked} />
                  {(active || completed) && (
                    <ModuleMeter value={completed ? 1 : task.progress ?? 0} />
                  )}
                </span>
                <button
                  type="button"
                  className={`research-compute-button ${blockedReason ? "blocked" : ""}`}
                  disabled={disabled}
                  onClick={() => dispatch({ type: "startTask", taskId: task.id })}
                  title={buttonLabel}
                >
                  {!blockedReason && <Play size={11} />}
                  {blockedReason ? (
                    <span>{buttonLabel}</span>
                  ) : (
                  <span>
                    {completed ? "Done" : active ? "···" : task.canQueue ? "Queue" : "Run"}
                  </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

/* ============ DAG MODAL ============ */

function TaskDagModal({
  task,
  visible,
  activeTask,
  onClose,
  memoryUnlocked,
}: {
  task: UiTask;
  visible: VisibleState;
  activeTask: UiActiveTask | null;
  onClose: () => void;
  memoryUnlocked: boolean;
}) {
  const progress = activeTask ? clampMeter(activeTask.progress) : clampMeter(task.progress ?? 0);
  const assignedCores =
    activeTask?.assignedCoreIds ??
    [activeTask?.coreId].filter((coreId): coreId is number => typeof coreId === "number");
  const requiredCores = firstNumber(task.requiredCores, task.minCores) ?? 1;
  const reservedBits =
    activeTask?.coreProgress?.reduce(
      (total, operation) =>
        total +
        firstBits(
          [operation.memoryReservedBits],
          [operation.memoryReservedBytes],
        ),
      0,
    ) ?? 0;
  const loadNote = activeTask
    ? getActiveRuntimeLabel(activeTask)
    : getTaskCacheBits(task) > 0 || (memoryUnlocked && getTaskRamBits(task) > 0)
      ? "Load → Compute"
      : "Direct";
  const coreNote =
    assignedCores.length > 0
      ? `Cores ${assignedCores.join(", ")}`
      : isElasticTask(task)
        ? "Uses idle cores"
        : `${formatNumber(requiredCores)}x`;
  const payoutRewards = getTaskRewardCosts(task);
  const payoutNote =
    payoutRewards.length > 0 ? (
      <span className="payout-note">
        <ResourceCost costs={payoutRewards} compact />
      </span>
    ) : (
      "None"
    );

  return (
    <div className="task-dag-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="task-dag-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dag-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="task-dag-header">
          <div>
            <span>{task.kind ?? "task"}</span>
            <strong id="task-dag-title">{task.name}</strong>
          </div>
          <button
            type="button"
            className="task-dag-close"
            onClick={onClose}
            aria-label="Close task inspect"
            title="Close"
          >
            <X size={15} />
          </button>
        </div>

        <div className="task-dag-summary" aria-label="Task runtime summary">
          <DagSummaryTile label="Progress" value={formatPercent(progress)} meter={progress} />
          <DagSummaryTile label="Load" value={loadNote} />
          <DagSummaryTile label="Cores" value={coreNote} />
          <DagSummaryTile label="Payout" value={payoutNote} />
          <DagSummaryTile
            label="Cache"
            value={`${formatBits(getTaskCacheBits(task))} · ${getFitLabel(task, visible, "cache")}`}
          />
          {memoryUnlocked && (
            <DagSummaryTile
              label="RAM"
              value={
                reservedBits > 0
                  ? `${formatBits(reservedBits)} reserved`
                  : `${formatBits(getTaskRamBits(task))} · ${getFitLabel(task, visible, "ram")}`
              }
            />
          )}
        </div>

        <div className="task-dag-scroll">
          <TaskDagNode
            node={task}
            visible={visible}
            activeTask={activeTask}
            memoryUnlocked={memoryUnlocked}
          />
        </div>
      </section>
    </div>
  );
}

function DagSummaryTile({
  label,
  value,
  meter,
}: {
  label: string;
  value: ReactNode;
  meter?: number;
}) {
  return (
    <div className="dag-summary-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {typeof meter === "number" && <ModuleMeter value={meter} />}
    </div>
  );
}

function TaskDagNode({
  node,
  visible,
  activeTask,
  memoryUnlocked,
  dependencyHint,
}: {
  node: UiTaskGraphNode;
  visible: VisibleState;
  activeTask: UiActiveTask | null;
  memoryUnlocked: boolean;
  dependencyHint?: string;
}) {
  const children = getDagChildren(node);
  const dependencies = getDependencyLabels(node);
  const runtime = getNodeRuntime(node, activeTask);
  const progress = getNodeProgress(node, activeTask);
  const operationCount = firstNumber(
    node.operationCount,
    Array.isArray(node.operations)
      ? getOperationCountFromOperations(node.operations)
      : undefined,
  );
  const memoryActions = Array.from(
    new Set(
      [
        node.memoryAction,
        ...(Array.isArray(node.operations)
          ? node.operations.map((operation) => operation.memoryAction)
          : []),
      ].filter((action): action is string => Boolean(action)),
    ),
  );
  const label = node.kind ?? (children.length > 0 ? "task" : "operation");

  return (
    <div className={`dag-node-wrap ${children.length > 0 ? "has-children" : ""}`}>
      <article className={`dag-node ${label}`}>
        <div className="dag-node-title">
          <span>{label}</span>
          <strong>{node.name ?? node.id ?? "Operation"}</strong>
        </div>
        <div className="dag-node-meta">
          {operationCount !== undefined && <span>{formatNumber(operationCount)} ops</span>}
          {memoryActions.length > 0 && <span>{memoryActions.join("/")}</span>}
          <span>{formatBits(getNodeCacheBits(node))} cache</span>
          {memoryUnlocked && <span>{formatBits(getNodeRamBits(node))} ram</span>}
        </div>
        <small>
          {dependencies.length > 0 ? dependencies.join(", ") : dependencyHint ?? "Root"}
        </small>
        {runtime && <em>{runtime}</em>}
        {progress !== null && (
          <span className="dag-node-progress" aria-hidden="true">
            <span style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      </article>
      {children.length > 0 && (
        <div className="dag-children">
          {children.map((child, index) => (
            <TaskDagNode
              key={`${child.id ?? child.name ?? "node"}-${index}`}
              node={child}
              visible={visible}
              activeTask={activeTask}
              memoryUnlocked={memoryUnlocked}
              dependencyHint={index === 0 ? "Start" : `After ${children[index - 1]?.name ?? "previous"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function getDagChildren(node: UiTaskGraphNode) {
  const recipeNodes = [
    ...(node.subtasks ?? []),
    ...(node.subTasks ?? []),
    ...(node.tasks ?? []),
    ...(node.children ?? []),
  ];
  const dagNodes = node.dagNodes ?? [];
  const operations = Array.isArray(node.operations) ? node.operations : [];
  const isRootTask = node.kind === undefined || node.kind === "task";

  if (dagNodes.length > 0) return dagNodes;
  if (recipeNodes.length > 0) return recipeNodes;
  return isRootTask ? operations : [];
}

function getDependencyLabels(node: UiTaskGraphNode) {
  const dependencies = [
    ...(node.dependencyIds ?? []),
    ...(node.dependencies ?? []),
    ...(node.dependsOn ?? []),
    ...(node.requires ?? []),
  ];

  return dependencies
    .map((dependency) =>
      typeof dependency === "string"
        ? dependency
        : dependency.name ?? dependency.id ?? null,
    )
    .filter((dependency): dependency is string => Boolean(dependency));
}

function getFitLabel(
  node: UiTaskGraphNode,
  visible: VisibleState,
  kind: "cache" | "ram",
) {
  if (kind === "cache" && node.cacheFit) return node.cacheFit;

  const need = kind === "cache" ? getNodeCacheBits(node) : getNodeRamBits(node);
  if (need <= 0) return "n/a";

  const capacity =
    kind === "cache" ? getVisibleCacheBits(visible) : getVisibleRamBits(visible);
  if (capacity > need) return "fits+";
  if (capacity === need) return "fits";
  return "over";
}

function getNodeRuntime(node: UiTaskGraphNode, activeTask: UiActiveTask | null) {
  if (!activeTask) return null;
  if (node.id === activeTask.taskId) return getActiveRuntimeLabel(activeTask);

  const operationIds = new Set([
    ...(node.operationIds ?? []),
    ...(Array.isArray(node.operations)
      ? node.operations.map((operation) => operation.id)
      : []),
  ]);
  const operationNames = new Set(
    Array.isArray(node.operations)
      ? node.operations.map((operation) => operation.name)
      : [],
  );
  const matchesNodeKind = (operation: NonNullable<UiActiveTask["coreProgress"]>[number]) => {
    if (node.kind === "cacheLoad") {
      return operation.status === "loadingCache" || operation.memoryState === "cacheLoad";
    }
    if (node.kind === "ramLoad") {
      return operation.status === "loadingRam" || operation.memoryState === "ramLoad";
    }
    if (node.kind === "execute") {
      return operation.status === "running";
    }
    return true;
  };
  const matches =
    activeTask.coreProgress?.filter(
      (operation) =>
        matchesNodeKind(operation) &&
        ((operation.operationId !== null && operationIds.has(operation.operationId)) ||
          (operation.operationName !== null &&
            operationNames.has(operation.operationName)) ||
          (node.id && operation.operationId === node.id) ||
          (node.name && operation.operationName === node.name)),
    ) ?? [];
  if (matches.length === 0) return null;

  const states = matches.map(
    (operation) => operation.memoryState ?? operation.status ?? "running",
  );
  return Array.from(new Set(states)).join(" / ");
}

function getNodeProgress(node: UiTaskGraphNode, activeTask: UiActiveTask | null) {
  if (activeTask) return null;
  return typeof node.progress === "number" ? clampMeter(node.progress) : null;
}

/* ============ METERS / CACHE BARS ============ */

function ModuleMeter({ value }: { value: number }) {
  return (
    <span className="module-meter" aria-hidden="true">
      <span style={{ width: `${clampMeter(value) * 100}%` }} />
    </span>
  );
}

const getCoreHue = (coreId: number) => (168 + (coreId - 1) * 47) % 360;

const getCoreSegmentColor = (coreId: number, alpha: number) =>
  `hsla(${getCoreHue(coreId)}, 82%, 62%, ${alpha})`;

const cacheStateLabels: Array<{ state: CacheSegmentState; label: string }> = [
  { state: "buffering", label: "Buffer" },
  { state: "loaded", label: "Ready" },
];

const getCacheSegmentAlpha = (state: CacheSegmentState) => {
  if (state === "loaded") return 0.94;
  if (state === "loading") return 0.66;
  return 0.52;
};

function CacheStateBadge({
  state,
  label,
  bits,
}: {
  state: CacheSegmentState;
  label: string;
  bits: number;
}) {
  return (
    <span
      className={`cache-state-badge ${state} ${bits > 0 ? "active" : ""}`}
      title={`${label}: ${formatBits(bits)}`}
    >
      <strong>{formatBits(bits)}</strong>
      <span aria-hidden="true" />
      <small>{label}</small>
    </span>
  );
}

function CachePipeline({
  segments,
  stateBits,
  capacityBits,
}: {
  segments: CacheSegment[];
  stateBits: Record<CacheSegmentState, number>;
  capacityBits: number;
}) {
  const getLaneSegments = (state: CacheSegmentState) =>
    segments.flatMap((segment) => {
      const bits = state === "buffering" ? segment.bufferBits : segment.readyBits;
      if (bits <= 0) return [];

      return [
        {
          ...segment,
          state,
          bits,
          progress: state === "buffering" ? 0 : 1,
          bufferProgress: state === "buffering" ? 1 : 0,
        },
      ];
    });

  return (
    <div className="cache-meter-block cache-pipeline" aria-label="Cache states">
      {cacheStateLabels.map(({ state, label }) => {
        const bits = stateBits[state];
        const laneSegments = getLaneSegments(state);

        return (
          <div
            className={`cache-pipeline-row ${state} ${bits > 0 ? "active" : ""}`}
            key={state}
          >
            <CacheStateBadge state={state} label={label} bits={bits} />
            <span className="cache-pipeline-track">
              <CachePressureMeter segments={laneSegments} capacityBits={capacityBits} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

const ramStateLabels: Array<{ state: RamSegmentState; label: string }> = [
  { state: "reserved", label: "Stage" },
  { state: "loading", label: "Load" },
  { state: "loaded", label: "Ready" },
];

function RamStateBadge({
  state,
  label,
  bits,
}: {
  state: RamSegmentState;
  label: string;
  bits: number;
}) {
  return (
    <span
      className={`ram-state-badge ${state} ${bits > 0 ? "active" : ""}`}
      title={`${label}: ${formatBits(bits)}`}
    >
      <strong>{formatBits(bits)}</strong>
      <span aria-hidden="true" />
      <small>{label}</small>
    </span>
  );
}

function RamPipeline({
  segments,
  stateBits,
  capacityBits,
}: {
  segments: RamSegment[];
  stateBits: Record<RamSegmentState, number>;
  capacityBits: number;
}) {
  return (
    <div className="cache-meter-block ram-pipeline" aria-label="RAM states">
      {ramStateLabels.map(({ state, label }) => {
        const bits = stateBits[state];
        const laneSegments = segments.filter((segment) => segment.state === state);

        return (
          <div
            className={`cache-pipeline-row ram-pipeline-row ${state} ${
              bits > 0 ? "active" : ""
            }`}
            key={state}
          >
            <RamStateBadge state={state} label={label} bits={bits} />
            <span className="cache-pipeline-track ram-pipeline-track">
              <RamPressureMeter segments={laneSegments} capacityBits={capacityBits} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RamPressureMeter({
  segments,
  capacityBits,
}: {
  segments: RamSegment[];
  capacityBits: number;
}) {
  const capacity = Math.max(1, capacityBits);
  let remaining = capacity;
  const visibleSegments = segments.flatMap((segment) => {
    if (remaining <= 0 || segment.bits <= 0) return [];

    const bits = Math.min(remaining, segment.bits);
    remaining -= bits;
    return [{ ...segment, bits }];
  });

  if (visibleSegments.length === 0) {
    return <ModuleMeter value={0} />;
  }

  return (
    <span className="module-meter ram-pressure-meter" aria-hidden="true">
      {visibleSegments.map((segment, index) => (
        <span
          key={`${segment.coreId}-${segment.state}-${index}`}
          className={`ram-pressure-segment ${segment.state}`}
          style={
            {
              width: `${(segment.bits / capacity) * 100}%`,
              "--ram-core-color": getCoreSegmentColor(
                segment.coreId,
                segment.state === "loaded" ? 0.9 : 0.58,
              ),
              "--ram-core-solid-color": getCoreSegmentColor(
                segment.coreId,
                segment.state === "loaded" ? 0.94 : 0.82,
              ),
              "--ram-load-progress": `${
                (segment.state === "loaded" ? 1 : clampMeter(segment.progress)) * 100
              }%`,
            } as CSSProperties
          }
        >
          <span className="ram-pressure-fill" />
        </span>
      ))}
    </span>
  );
}

function CachePressureMeter({
  segments,
  capacityBits,
}: {
  segments: CacheSegment[];
  capacityBits: number;
}) {
  const capacity = Math.max(1, capacityBits);
  let remaining = capacity;
  const visibleSegments = segments.flatMap((segment) => {
    if (remaining <= 0 || segment.bits <= 0) return [];

    const bits = Math.min(remaining, segment.bits);
    remaining -= bits;
    return [{ ...segment, bits }];
  });

  return (
    <span className="module-meter cache-pressure-meter" aria-hidden="true">
      {visibleSegments.map((segment, index) => (
        <span
          key={`${segment.kind}-${segment.state}-${index}`}
          className={`cache-pressure-segment cache-pressure-${segment.kind} ${segment.state}`}
          style={
            {
              width: `${(segment.bits / capacity) * 100}%`,
              "--cache-core-color": getCoreSegmentColor(
                segment.coreId,
                getCacheSegmentAlpha(segment.state),
              ),
              "--cache-core-solid-color": getCoreSegmentColor(
                segment.coreId,
                segment.state === "loaded" ? 0.94 : 0.86,
              ),
              "--cache-buffer-progress": `${
                (segment.state === "loading" || segment.state === "loaded"
                  ? 1
                  : clampMeter(segment.bufferProgress)) * 100
              }%`,
              "--cache-write-progress": `${getCacheSegmentWriteProgress(segment) * 100}%`,
            } as CSSProperties
          }
        >
          <span className="cache-pressure-buffer" />
          <span className="cache-pressure-fill" />
        </span>
      ))}
    </span>
  );
}
