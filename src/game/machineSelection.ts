import { RAM_MAX_LEVEL } from "./content/ramTiers";
import { V1_HARDWARE_LIMITS, clampFiniteInteger } from "./hardwareLimits";
import type {
  MachineComponentSelection,
  MachineCpuPackageSelection,
} from "./types";

const isBoundedInteger = (
  value: unknown,
  minimum: number,
  maximum: number,
) =>
  value === undefined ||
  (typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum);

const normalizePackageConfig = (
  config: MachineCpuPackageSelection,
): MachineCpuPackageSelection => ({
  coreCount:
    config.coreCount === undefined
      ? undefined
      : clampFiniteInteger(
          config.coreCount,
          1,
          V1_HARDWARE_LIMITS.coresPerCpu,
        ),
  cpuLevel:
    config.cpuLevel === undefined
      ? undefined
      : clampFiniteInteger(config.cpuLevel, 1, V1_HARDWARE_LIMITS.cpuLevel),
  cacheLevel:
    config.cacheLevel === undefined
      ? undefined
      : clampFiniteInteger(
          config.cacheLevel,
          1,
          V1_HARDWARE_LIMITS.cacheLevel,
        ),
  cacheSpeedLevel:
    config.cacheSpeedLevel === undefined
      ? undefined
      : clampFiniteInteger(
          config.cacheSpeedLevel,
          1,
          V1_HARDWARE_LIMITS.cacheSpeedLevel,
        ),
  schedulerSlots:
    config.schedulerSlots === undefined
      ? undefined
      : clampFiniteInteger(
          config.schedulerSlots,
          0,
          V1_HARDWARE_LIMITS.cpuQueueSlotsPerCpu,
        ),
});

/** Bounded defensive copy used by projections and other non-action callers. */
export const normalizeMachineComponentSelection = (
  selection: MachineComponentSelection,
): MachineComponentSelection => {
  const requestedConfigs = Array.isArray(selection.cpuPackageConfigs)
    ? selection.cpuPackageConfigs
        .slice(0, V1_HARDWARE_LIMITS.cpuPackages)
        .map((config) =>
          config && typeof config === "object"
            ? normalizePackageConfig(config)
            : {},
        )
    : [];
  const cpuPackageCount = clampFiniteInteger(
    Math.max(
      requestedConfigs.length,
      typeof selection.cpuPackageCount === "number"
        ? selection.cpuPackageCount
        : 1,
    ),
    1,
    V1_HARDWARE_LIMITS.cpuPackages,
  );

  return {
    ...selection,
    cpuPackageCount,
    cpuCoreCount:
      selection.cpuCoreCount === undefined
        ? undefined
        : clampFiniteInteger(
            selection.cpuCoreCount,
            cpuPackageCount,
            cpuPackageCount * V1_HARDWARE_LIMITS.coresPerCpu,
          ),
    cpuLevel:
      selection.cpuLevel === undefined
        ? undefined
        : clampFiniteInteger(
            selection.cpuLevel,
            1,
            V1_HARDWARE_LIMITS.cpuLevel,
          ),
    cacheLevel:
      selection.cacheLevel === undefined
        ? undefined
        : clampFiniteInteger(
            selection.cacheLevel,
            1,
            V1_HARDWARE_LIMITS.cacheLevel,
          ),
    cacheSpeedLevel:
      selection.cacheSpeedLevel === undefined
        ? undefined
        : clampFiniteInteger(
            selection.cacheSpeedLevel,
            1,
            V1_HARDWARE_LIMITS.cacheSpeedLevel,
          ),
    cpuPackageConfigs:
      requestedConfigs.length > 0 ? requestedConfigs : undefined,
    cpuSchedulerSlots:
      selection.cpuSchedulerSlots === undefined
        ? undefined
        : clampFiniteInteger(
            selection.cpuSchedulerSlots,
            0,
            cpuPackageCount * V1_HARDWARE_LIMITS.cpuQueueSlotsPerCpu,
          ),
    ramStickCount:
      selection.ramStickCount === undefined
        ? undefined
        : clampFiniteInteger(
            selection.ramStickCount,
            0,
            V1_HARDWARE_LIMITS.ramSticks,
          ),
    ramLevel:
      selection.ramLevel === undefined
        ? undefined
        : clampFiniteInteger(selection.ramLevel, 1, RAM_MAX_LEVEL),
    ramSpeedLevel:
      selection.ramSpeedLevel === undefined
        ? undefined
        : clampFiniteInteger(selection.ramSpeedLevel, 1, RAM_MAX_LEVEL),
    psuLevel:
      selection.psuLevel === undefined
        ? undefined
        : clampFiniteInteger(
            selection.psuLevel,
            1,
            V1_HARDWARE_LIMITS.psuLevel,
          ),
  };
};

/** Returns an action-facing explanation without allocating from invalid counts. */
export const getMachineSelectionBoundsBlockedReason = (
  selection: MachineComponentSelection,
): string | null => {
  const configs = Array.isArray(selection.cpuPackageConfigs)
    ? selection.cpuPackageConfigs
    : [];
  if (configs.length > V1_HARDWARE_LIMITS.cpuPackages) {
    return `A v1 system supports at most ${V1_HARDWARE_LIMITS.cpuPackages} CPU packages.`;
  }
  if (
    !isBoundedInteger(
      selection.cpuPackageCount,
      1,
      V1_HARDWARE_LIMITS.cpuPackages,
    )
  ) {
    return `CPU package count must be between 1 and ${V1_HARDWARE_LIMITS.cpuPackages}.`;
  }
  const packageCount = Math.max(
    1,
    configs.length,
    selection.cpuPackageCount ?? 1,
  );
  if (
    !isBoundedInteger(
      selection.cpuCoreCount,
      packageCount,
      packageCount * V1_HARDWARE_LIMITS.coresPerCpu,
    )
  ) {
    return `Each CPU package supports at most ${V1_HARDWARE_LIMITS.coresPerCpu} cores.`;
  }
  if (!isBoundedInteger(selection.cpuLevel, 1, V1_HARDWARE_LIMITS.cpuLevel)) {
    return `CPU level must be between 1 and ${V1_HARDWARE_LIMITS.cpuLevel}.`;
  }
  if (!isBoundedInteger(selection.cacheLevel, 1, V1_HARDWARE_LIMITS.cacheLevel)) {
    return `Cache level must be between 1 and ${V1_HARDWARE_LIMITS.cacheLevel}.`;
  }
  if (
    !isBoundedInteger(
      selection.cacheSpeedLevel,
      1,
      V1_HARDWARE_LIMITS.cacheSpeedLevel,
    )
  ) {
    return `Cache speed level must be between 1 and ${V1_HARDWARE_LIMITS.cacheSpeedLevel}.`;
  }
  if (
    !isBoundedInteger(
      selection.cpuSchedulerSlots,
      0,
      packageCount * V1_HARDWARE_LIMITS.cpuQueueSlotsPerCpu,
    )
  ) {
    return `Each CPU package supports at most ${V1_HARDWARE_LIMITS.cpuQueueSlotsPerCpu} queue slots.`;
  }
  for (const config of configs) {
    if (!config || typeof config !== "object") {
      return "CPU package configuration is invalid.";
    }
    if (!isBoundedInteger(config.coreCount, 1, V1_HARDWARE_LIMITS.coresPerCpu)) {
      return `Each CPU package supports at most ${V1_HARDWARE_LIMITS.coresPerCpu} cores.`;
    }
    if (!isBoundedInteger(config.cpuLevel, 1, V1_HARDWARE_LIMITS.cpuLevel)) {
      return `CPU level must be between 1 and ${V1_HARDWARE_LIMITS.cpuLevel}.`;
    }
    if (!isBoundedInteger(config.cacheLevel, 1, V1_HARDWARE_LIMITS.cacheLevel)) {
      return `Cache level must be between 1 and ${V1_HARDWARE_LIMITS.cacheLevel}.`;
    }
    if (
      !isBoundedInteger(
        config.cacheSpeedLevel,
        1,
        V1_HARDWARE_LIMITS.cacheSpeedLevel,
      )
    ) {
      return `Cache speed level must be between 1 and ${V1_HARDWARE_LIMITS.cacheSpeedLevel}.`;
    }
    if (
      !isBoundedInteger(
        config.schedulerSlots,
        0,
        V1_HARDWARE_LIMITS.cpuQueueSlotsPerCpu,
      )
    ) {
      return `Each CPU package supports at most ${V1_HARDWARE_LIMITS.cpuQueueSlotsPerCpu} queue slots.`;
    }
  }
  if (!isBoundedInteger(selection.ramStickCount, 0, V1_HARDWARE_LIMITS.ramSticks)) {
    return `A v1 system supports at most ${V1_HARDWARE_LIMITS.ramSticks} RAM sticks.`;
  }
  if (!isBoundedInteger(selection.ramLevel, 1, RAM_MAX_LEVEL)) {
    return `RAM level must be between 1 and ${RAM_MAX_LEVEL}.`;
  }
  if (!isBoundedInteger(selection.ramSpeedLevel, 1, RAM_MAX_LEVEL)) {
    return `RAM speed level must be between 1 and ${RAM_MAX_LEVEL}.`;
  }
  if (!isBoundedInteger(selection.psuLevel, 1, V1_HARDWARE_LIMITS.psuLevel)) {
    return `PSU level must be between 1 and ${V1_HARDWARE_LIMITS.psuLevel}.`;
  }
  return null;
};
