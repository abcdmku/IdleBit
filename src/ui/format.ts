import type { ResourceBag } from "../game/types";

export interface DisplayCost {
  resource: string;
  amount: number;
}

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

export const formatBits = (bits: number) => {
  if (bits >= 1_000_000_000) return `${formatNumber(bits / 1_000_000_000)} Gb`;
  if (bits >= 1_000_000) return `${formatNumber(bits / 1_000_000)} Mb`;
  if (bits >= 1_000) return `${formatNumber(bits / 1_000)} Kb`;
  return `${formatNumber(bits)} b`;
};

export const formatBitRate = (bitsPerSecond: number) =>
  `${formatBits(bitsPerSecond)}/s`;

export const formatWatts = (watts: number) => {
  if (watts >= 1_000) return `${formatNumber(watts / 1_000)} kW`;
  return `${formatNumber(watts)} W`;
};

export const formatCost = (costs: DisplayCost[]) =>
  costs
    .map((cost) => `${formatNumber(cost.amount)} ${cost.resource}`)
    .join(" + ");

export const formatResources = (resources: ResourceBag) => [
  { label: "Credits", value: formatNumber(resources.credits) },
  { label: "Data", value: formatNumber(resources.data) },
];
