import { formatNumber, formatResourceRate } from "../format";

export const formatPercent = (ratio: number | null) =>
  ratio === null ? "N/A" : `${formatNumber(Math.max(0, ratio) * 100)}%`;

export const formatPowerRate = (creditsPerSecond: number) =>
  formatResourceRate(creditsPerSecond);
