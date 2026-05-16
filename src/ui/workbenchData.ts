import type { HardwareComponentId, VisibleState } from "../game";

export type SelectedComponent =
  | HardwareComponentId
  | `core:${number}`
  | `scheduler:${number}`
  | null;

export const componentCopy: Record<
  HardwareComponentId,
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

export function getVisibleSelection(
  visible: VisibleState,
  selectedComponent: SelectedComponent,
): SelectedComponent {
  if (selectedComponent === null) return null;

  if (selectedComponent.startsWith("core:")) {
    const coreId = Number(selectedComponent.slice("core:".length));
    return coreId >= 1 && coreId <= visible.hardware.cores
      ? selectedComponent
      : "core:1";
  }

  if (selectedComponent.startsWith("scheduler:")) {
    const socketId = Number(selectedComponent.slice("scheduler:".length));
    const schedulerVisible = hasSchedulerSurface(visible);
    const socketVisible = visible.metrics.cpuSockets.some(
      (socket) => socket.id === socketId,
    );

    return schedulerVisible && socketVisible ? selectedComponent : null;
  }

  if (selectedComponent === "ram" || selectedComponent === "psu") {
    return hasSystemMemory(visible) ? selectedComponent : "cpu";
  }

  if (selectedComponent === "socket") {
    return visible.flags.secondCpu && !visible.hardware.secondCpu ? "socket" : "cpu";
  }

  if (selectedComponent === "scheduler") {
    return hasSchedulerSurface(visible) ? "scheduler:1" : null;
  }

  return selectedComponent;
}
