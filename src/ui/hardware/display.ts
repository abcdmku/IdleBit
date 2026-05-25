import { formatNumber, formatResourceRate } from "../format";

export const formatHardwarePercent = (ratio: number | null) =>
  ratio === null ? "N/A" : `${formatNumber(Math.max(0, ratio) * 100)}%`;

export const formatPowerRate = (creditsPerSecond: number) =>
  formatResourceRate(creditsPerSecond);

export const formatCountdownSeconds = (seconds: number) =>
  `${formatNumber(Math.max(0, Math.ceil(seconds)))}s`;
