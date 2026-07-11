import { formatClock, formatNumber, formatResourceRate } from "../format";

export const formatHardwarePercent = (ratio: number | null) =>
  ratio === null ? "N/A" : `${formatNumber(Math.max(0, ratio) * 100)}%`;

/**
 * Drops the trailing unit from `label` when `reference` ends with the same
 * unit, so fractions print their unit once ("12 / 16 Kb", not "12 Kb / 16 Kb").
 */
export const stripSharedUnit = (label: string, reference: string) => {
  const index = label.lastIndexOf(" ");
  if (index === -1) return label;
  return reference.endsWith(label.slice(index)) ? label.slice(0, index) : label;
};

export const formatFraction = (used: string, capacity: string) =>
  `${stripSharedUnit(used, capacity)} / ${capacity}`;

/** Compact per-die clock: "1.2 kHz" -> "1.2k". Tooltips keep the full value. */
export const formatClockTick = (hz: number) =>
  formatClock(hz).replace(/ ?([kMG]?)Hz$/u, "$1");

export const formatPowerRate = (creditsPerSecond: number) =>
  formatResourceRate(creditsPerSecond);

export const formatCountdownSeconds = (seconds: number) =>
  `${formatNumber(Math.max(0, Math.ceil(seconds)))}s`;
