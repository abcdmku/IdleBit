import type { HardwareComponentId, VisibleState } from "../game";

export type SelectedComponent =
  | HardwareComponentId
  | "cron"
  | "thermal"
  | `core:${number}`
  | `cores:${number}`
  | `scheduler:${number}`
  | `system:${string}`
  | `ramStick:${number}`
  | "ramSticks"
  | null;

const SYSTEM_SELECTION_PREFIX = "system:";
const SYSTEM_SELECTION_SEPARATOR = "::";

type RecordLike = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordLike =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const safeEncode = (value: string | number) =>
  encodeURIComponent(String(value));

export const parseSystemSelection = (selection: SelectedComponent) => {
  if (!selection?.startsWith(SYSTEM_SELECTION_PREFIX)) return null;

  const payload = selection.slice(SYSTEM_SELECTION_PREFIX.length);
  const separatorIndex = payload.indexOf(SYSTEM_SELECTION_SEPARATOR);
  const rawSystemId =
    separatorIndex >= 0 ? payload.slice(0, separatorIndex) : payload;
  const rawComponent =
    separatorIndex >= 0
      ? payload.slice(separatorIndex + SYSTEM_SELECTION_SEPARATOR.length)
      : "";

  return {
    systemId: safeDecode(rawSystemId),
    component: rawComponent.length > 0 ? (rawComponent as SelectedComponent) : null,
  };
};

export const getSelectedSystemId = (selection: SelectedComponent) =>
  parseSystemSelection(selection)?.systemId ?? null;

export const getSelectedSystemComponent = (
  selection: SelectedComponent,
): SelectedComponent => parseSystemSelection(selection)?.component ?? selection;

export const scopeSelectionToSystem = (
  systemId: string | number | null | undefined,
  selection: SelectedComponent,
): SelectedComponent => {
  if (systemId === null || systemId === undefined || systemId === "") {
    return getSelectedSystemComponent(selection);
  }

  const component = getSelectedSystemComponent(selection);
  const componentSuffix =
    component === null ? "" : `${SYSTEM_SELECTION_SEPARATOR}${component}`;

  return `${SYSTEM_SELECTION_PREFIX}${safeEncode(systemId)}${componentSuffix}`;
};

export const componentCopy: Record<
  string,
  { title: string; kicker: string; info: string }
> = {
  cpu: {
    title: "CPU",
    kicker: "cores and per-core clock",
    info: "Clock increases operation throughput. More cores let more tasks advance at the same time.",
  },
  cache: {
    title: "Cache",
    kicker: "working-set fit",
    info: "Cache shows loaded working sets for active tasks. The bar tracks current cache pressure.",
  },
  scheduler: {
    title: "CPU Op Scheduler",
    kicker: "socket-local queue",
    info: "The CPU Op Scheduler holds waiting task operations and routes them onto idle cores in this socket.",
  },
  socket: {
    title: "CPU Socket",
    kicker: "system expansion",
    info: "Installing another CPU opens the system layer where RAM and PSU capacity start to matter.",
  },
  ram: {
    title: "RAM",
    kicker: "modules and reserved memory",
    info: "RAM shows module size, speed, and memory pressure from active or waiting tasks.",
  },
  psu: {
    title: "PSU",
    kicker: "capacity and operating draw",
    info: "The PSU shows active draw, stress, and whether the build has power headroom.",
  },
  cron: {
    title: "CRON",
    kicker: "automation cadence",
    info: "CRON schedules system tasks at fixed intervals once automation is researched.",
  },
  thermal: {
    title: "Thermal",
    kicker: "heat and cooling",
    info: "Thermal control shows heat stress and cooling loop headroom.",
  },
};

const hasSchedulerSurface = (visible: VisibleState) => {
  const queueLength = visible.queue.length;

  return visible.flags.basicQueue || visible.flags.scheduler || queueLength > 0;
};

const hasSystemMemory = (visible: VisibleState) => {
  const hardware = visible.hardware as VisibleState["hardware"] & {
    ramBits?: number;
    memoryBits?: number;
  };

  return (
    visible.flags.systemStats ||
    visible.hardware.secondCpu ||
    visible.hardware.ramBytes > 0 ||
    (hardware.ramBits ?? hardware.memoryBits ?? 0) > 0
  );
};

const hasCpuSchedulerUnlocked = (visible: VisibleState) =>
  visible.flags.basicQueue || visible.flags.scheduler;

const getSystemId = (entry: RecordLike, fallback: string) => {
  const id = entry.id ?? entry.systemId ?? entry.machineId;
  return typeof id === "string" || typeof id === "number" ? String(id) : fallback;
};

const normalizeSystemEntries = (value: unknown): RecordLike[] => {
  if (Array.isArray(value)) return value.filter(isRecord);

  if (!isRecord(value)) return [];

  const entries: RecordLike[] = [];
  Object.entries(value).forEach(([id, entry]) => {
    if (isRecord(entry)) entries.push({ ...entry, id: entry.id ?? id });
  });
  return entries;
};

const getSystemEntries = (visible: VisibleState) => {
  const record = visible as unknown as RecordLike;
  const rack = isRecord(record.rack) ? record.rack : null;
  const systemRack = isRecord(record.systemRack) ? record.systemRack : null;
  const systems =
    normalizeSystemEntries(rack?.systems)[0] !== undefined
      ? normalizeSystemEntries(rack?.systems)
      : normalizeSystemEntries(rack?.ownedSystems)[0] !== undefined
        ? normalizeSystemEntries(rack?.ownedSystems)
        : normalizeSystemEntries(systemRack?.systems)[0] !== undefined
          ? normalizeSystemEntries(systemRack?.systems)
          : normalizeSystemEntries(record.systems);

  return systems;
};

const mergeVisibleSystemState = (
  visible: VisibleState,
  system: RecordLike,
): VisibleState => {
  const nested =
    (isRecord(system.visible) && system.visible) ||
    (isRecord(system.visibleState) && system.visibleState) ||
    (isRecord(system.state) && system.state) ||
    {};
  const source = { ...system, ...nested };

  return {
    ...visible,
    ...source,
    flags: isRecord(source.flags)
      ? { ...visible.flags, ...source.flags }
      : visible.flags,
    hardware: isRecord(source.hardware)
      ? { ...visible.hardware, ...source.hardware }
      : visible.hardware,
    metrics: isRecord(source.metrics)
      ? { ...visible.metrics, ...source.metrics }
      : visible.metrics,
    cron: isRecord(source.cron) ? { ...visible.cron, ...source.cron } : visible.cron,
  } as VisibleState;
};

const getVisibleSystemState = (visible: VisibleState, systemId: string) => {
  const entries = getSystemEntries(visible);
  const system = entries.find(
    (entry, index) => getSystemId(entry, `system-${index + 1}`) === systemId,
  );

  return system ? mergeVisibleSystemState(visible, system) : null;
};

export function getVisibleSelection(
  visible: VisibleState,
  selectedComponent: SelectedComponent,
): SelectedComponent {
  if (selectedComponent === null) return null;

  const systemSelection = parseSystemSelection(selectedComponent);
  if (systemSelection) {
    const entries = getSystemEntries(visible);
    if (entries.length === 0) {
      return getVisibleSelection(
        visible,
        systemSelection.component ?? ("core:1" as SelectedComponent),
      );
    }

    const systemIds = entries.map((entry, index) =>
      getSystemId(entry, `system-${index + 1}`),
    );
    const systemId = systemIds.includes(systemSelection.systemId)
      ? systemSelection.systemId
      : (systemIds[0] ?? systemSelection.systemId);
    const systemVisible = getVisibleSystemState(visible, systemId) ?? visible;
    const component = getVisibleSelection(
      systemVisible,
      systemSelection.component ?? ("core:1" as SelectedComponent),
    );

    return scopeSelectionToSystem(systemId, component);
  }

  if (selectedComponent.startsWith("core:")) {
    const coreId = Number(selectedComponent.slice("core:".length));
    return coreId >= 1 && coreId <= visible.hardware.cores
      ? selectedComponent
      : "core:1";
  }

  if (selectedComponent.startsWith("cores:")) {
    const socketId = Number(selectedComponent.slice("cores:".length));
    const fallbackSocketId = visible.metrics.cpuSockets[0]?.id;
    return hasCpuSchedulerUnlocked(visible) &&
      visible.metrics.cpuSockets.some((socket) => socket.id === socketId)
      ? selectedComponent
      : fallbackSocketId
        ? (`core:${visible.metrics.cpuSockets[0]?.cores[0]?.id ?? 1}` as SelectedComponent)
        : null;
  }

  if (selectedComponent.startsWith("scheduler:")) {
    const socketId = Number(selectedComponent.slice("scheduler:".length));
    const schedulerVisible = hasSchedulerSurface(visible);
    const socketVisible = visible.metrics.cpuSockets.some(
      (socket) => socket.id === socketId,
    );

    return schedulerVisible && socketVisible ? selectedComponent : null;
  }

  if (selectedComponent.startsWith("ramStick:")) {
    const stickId = Number(selectedComponent.slice("ramStick:".length));
    return visible.metrics.ramSlots.some((slot) => slot.id === stickId)
      ? selectedComponent
      : visible.metrics.ramSlots[0]
        ? (`ramStick:${visible.metrics.ramSlots[0].id}` as SelectedComponent)
        : "ram";
  }

  if (selectedComponent === "ramSticks") {
    return hasSystemMemory(visible) && visible.metrics.ramSlots.length > 0
      ? selectedComponent
      : "ram";
  }

  if (selectedComponent === "ram" || selectedComponent === "psu") {
    return hasSystemMemory(visible) ? selectedComponent : "cpu";
  }

  if (selectedComponent === "cron") {
    const flags = visible.flags as VisibleState["flags"] & {
      cronScheduler?: boolean;
      cronAutomation?: boolean;
    };
    return visible.flags.cron ||
      flags.cronScheduler === true ||
      flags.cronAutomation === true ||
      visible.cron.unlocked
      ? selectedComponent
      : "cpu";
  }

  if (selectedComponent === "thermal") {
    return "cpu";
  }

  if (selectedComponent === "socket") {
    return visible.flags.secondCpu && !visible.hardware.secondCpu ? "socket" : "cpu";
  }

  if (selectedComponent === "scheduler") {
    if (visible.flags.scheduler) return "scheduler";
    return hasSchedulerSurface(visible) ? "scheduler:1" : null;
  }

  return selectedComponent;
}
