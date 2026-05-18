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

const formatUnitNumber = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2,
  }).format(value);

export const formatWatts = (watts: number) => {
  const absWatts = Math.abs(watts);
  const sign = watts < 0 ? "-" : "";

  if (absWatts === 0) return "0 W";
  if (absWatts < 0.001) return `${sign}${formatUnitNumber(absWatts * 1_000_000)} uW`;
  if (absWatts < 1) return `${sign}${formatUnitNumber(absWatts * 1_000)} mW`;
  if (absWatts >= 1_000) return `${sign}${formatNumber(absWatts / 1_000)} kW`;
  return `${sign}${formatNumber(absWatts)} W`;
};

export const formatCost = (costs: DisplayCost[]) =>
  costs
    .map((cost) => `${formatNumber(cost.amount)} ${cost.resource}`)
    .join(" + ");

export const formatResources = (resources: ResourceBag) => [
  { label: "Credits", value: formatNumber(resources.credits) },
  { label: "Data", value: formatNumber(resources.data) },
];
