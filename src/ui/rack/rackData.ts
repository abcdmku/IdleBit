import type { VisibleState } from "../../game";
import {
  asUiVisible,
  firstString,
  isUiRecord,
  normalizeRecordList,
  type UiVisibleState,
} from "../hardware/visibleState";
import { firstBits, firstNumber } from "../panels/uiNumbers";
import {
  getActiveTasks,
  getQueueEntries,
  getVisibleRamBits,
  getVisibleRamUsedBits,
} from "../tasks/taskData";
import { getBuilderGroups } from "./builderHelpers";
import type {
  UiCustomMachineBuilder,
  UiCustomMachineGroup,
  UiCustomMachineTier,
  UiRackData,
  UiRackSystem,
  UiRackSystemSource,
} from "./types";

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

const getSystemClockHz = (visible: VisibleState) => {
  const cores = visible.metrics.cpuSockets.flatMap((socket) => socket.cores);
  if (cores.length === 0) return 0;
  return Math.max(...cores.map((core) => core.clockHz ?? 0));
};

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
    clockHz: getSystemClockHz(systemVisible),
    ramBits: getSystemRamBits(systemVisible, source),
    ramUsedBits: getVisibleRamUsedBits(systemVisible),
    drawWatts: getSystemDrawWatts(systemVisible, source),
    psuCapWatts: systemVisible.hardware.psuWatts ?? 0,
    powerCostPerSecond: systemVisible.metrics.powerCostPerSecond ?? 0,
    activeTaskCount: getActiveTasks(systemVisible).length,
    queueCount: getQueueEntries(systemVisible).length,
    source,
  };
};

export const getFallbackRackSystem = (visible: VisibleState): UiRackSystem => ({
  id: "primary",
  name: "Primary",
  role: "Local",
  tier: null,
  status: visible.metrics.powerState,
  visible,
  cores: visible.hardware.cores,
  clockHz: getSystemClockHz(visible),
  ramBits: getVisibleRamBits(visible),
  ramUsedBits: getVisibleRamUsedBits(visible),
  drawWatts: visible.metrics.powerUsedWatts,
  psuCapWatts: visible.hardware.psuWatts ?? 0,
  powerCostPerSecond: visible.metrics.powerCostPerSecond ?? 0,
  activeTaskCount: getActiveTasks(visible).length,
  queueCount: getQueueEntries(visible).length,
  source: null,
});

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

export const getRackData = (visible: VisibleState): UiRackData => {
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
