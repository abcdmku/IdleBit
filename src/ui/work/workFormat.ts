import type { VisibleState } from "../../game";

export const formatWorkDuration = (milliseconds: number | null) => {
  if (milliseconds === null) return "Ongoing";
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

export const formatBufferDuration = (milliseconds: number) => {
  const wholeMinutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  if (wholeMinutes === 0) return milliseconds > 0 ? "<1m" : "0m";
  const days = Math.floor(wholeMinutes / (60 * 24));
  const hours = Math.floor((wholeMinutes % (60 * 24)) / 60);
  const minutes = wholeMinutes % 60;
  if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
  return `${minutes}m`;
};

export const getWorkSystemName = (
  visible: VisibleState,
  systemId: number | null,
) => {
  if (systemId === null) return "Auto";
  return (
    visible.systems.find((system) => system.id === systemId)?.name ??
    `System ${systemId}`
  );
};

const workKindLabels: Record<string, string> = {
  standingOrder: "Standing order",
  clusterWorkload: "Cluster workload",
  facilityWorkload: "Facility workload",
  workshopStorage: "Workshop storage",
  cloud: "Cloud operation",
  sla: "SLA window",
  finale: "Planetary finale",
};

export const formatWorkKind = (kind: string) =>
  workKindLabels[kind] ?? `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`;
