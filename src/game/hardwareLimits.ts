/**
 * Explicit physical-hardware ceilings for the v1 campaign.
 *
 * Late-game growth continues through aggregate Fleet, rack, facility, and
 * cloud capacity. These bounds keep both the inspected Fleet and each machine
 * finite, and keep malformed saves from allocating arbitrarily large physical
 * simulation arrays.
 */
export const V1_HARDWARE_LIMITS = Object.freeze({
  inspectedSystems: 16,
  cpuPackages: 8,
  coresPerCpu: 64,
  cpuLevel: 36,
  cacheLevel: 36,
  cacheSpeedLevel: 36,
  cpuQueueSlotsPerCpu: 64,
  systemQueueSlots: 24,
  ramSticks: 32,
  ramTierLevels: 36,
  psuLevel: 64,
  deadlockRecoveryLevel: 10,
  cronIntervalLevel: 59,
});

export const clampFiniteInteger = (
  value: unknown,
  minimum: number,
  maximum: number,
  fallback = minimum,
) => {
  const numeric = typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(numeric)));
};
