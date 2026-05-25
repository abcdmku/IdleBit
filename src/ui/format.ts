import type { ResourceBag } from "../game/types";

export interface DisplayCost {
  resource: string;
  amount: number;
}

const STACK_K_THRESHOLD = 100_000;
const RESOURCE_STACK_BANDS = [
  { threshold: 1e25, divisor: 1e24, suffix: "Sp" },
  { threshold: 1e22, divisor: 1e21, suffix: "S" },
  { threshold: 1e19, divisor: 1e18, suffix: "Qn" },
  {
    threshold: 1e16,
    divisor: 1e15,
    suffix: "Q",
  },
  {
    threshold: 1e13,
    divisor: 1e12,
    suffix: "T",
  },
  { threshold: 10_000_000_000, divisor: 1_000_000_000, suffix: "B" },
  { threshold: 10_000_000, divisor: 1_000_000, suffix: "M" },
  { threshold: STACK_K_THRESHOLD, divisor: 1_000, suffix: "K" },
] as const;
const GAME_CURRENCY_RESOURCES = new Set(["credits", "data"]);

export const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);

const formatWholeMagnitude = (value: number) => {
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.floor(Math.abs(value))}`;
};

export const formatResourceAmount = (amount: number) => {
  const absAmount = Math.abs(amount);
  if (!Number.isFinite(amount)) {
    return formatNumber(amount);
  }
  const band = RESOURCE_STACK_BANDS.find(
    (candidate) => absAmount >= candidate.threshold,
  );
  if (!band) {
    return Number.isInteger(amount)
      ? formatWholeMagnitude(amount)
      : formatNumber(amount);
  }

  return `${formatWholeMagnitude(amount / band.divisor)} ${band.suffix}`;
};

export const formatResourceRate = (amountPerSecond: number) => {
  const absAmountPerSecond = Math.abs(amountPerSecond);
  if (absAmountPerSecond >= STACK_K_THRESHOLD) {
    return formatResourceAmount(amountPerSecond);
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: absAmountPerSecond >= 1 ? 1 : 3,
  }).format(amountPerSecond);
};

export const formatDisplayCostAmount = (cost: DisplayCost) =>
  GAME_CURRENCY_RESOURCES.has(cost.resource)
    ? formatResourceAmount(cost.amount)
    : formatNumber(cost.amount);

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
    .map((cost) => `${formatDisplayCostAmount(cost)} ${cost.resource}`)
    .join(" + ");

export const formatResources = (resources: ResourceBag) => [
  { label: "Credits", value: formatResourceAmount(resources.credits) },
  { label: "Data", value: formatResourceAmount(resources.data) },
];
