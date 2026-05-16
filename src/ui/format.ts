import type { Cost, ResourceBag } from "../game/types";

export const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);

export const formatClock = (hz: number) => {
  if (hz >= 1_000_000_000) return `${formatNumber(hz / 1_000_000_000)} GHz`;
  if (hz >= 1_000_000) return `${formatNumber(hz / 1_000_000)} MHz`;
  if (hz >= 1_000) return `${formatNumber(hz / 1_000)} kHz`;
  return `${formatNumber(hz)} Hz`;
};

export const formatBytes = (bytes: number) => {
  if (bytes >= 1024 * 1024) return `${formatNumber(bytes / 1024 / 1024)} MB`;
  if (bytes >= 1024) return `${formatNumber(bytes / 1024)} KB`;
  return `${formatNumber(bytes)} B`;
};

export const formatSeconds = (seconds: number) => {
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${formatNumber(seconds)}s`;
  return `${formatNumber(seconds / 60)}m`;
};

export const formatCost = (costs: Cost[]) =>
  costs
    .map((cost) => `${formatNumber(cost.amount)} ${cost.resource}`)
    .join(" + ");

export const formatResources = (resources: ResourceBag) => [
  { label: "Credits", value: formatNumber(resources.credits) },
  { label: "Data", value: formatNumber(resources.data) },
];

