import { formatNumber } from "../format";

export const formatPercent = (ratio: number | null) =>
  ratio === null ? "N/A" : `${formatNumber(Math.max(0, ratio) * 100)}%`;

export const formatPowerRate = (creditsPerSecond: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: creditsPerSecond >= 1 ? 1 : 3,
  }).format(creditsPerSecond);
