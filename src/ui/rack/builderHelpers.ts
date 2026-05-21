import type { LucideIcon } from "lucide-react";
import {
  Cpu,
  Database,
  HardDrive,
  LayoutGrid,
  MemoryStick,
  SlidersHorizontal,
  Thermometer,
  Zap,
} from "lucide-react";
import type { DisplayCost } from "../format";
import { formatBits, formatClock, formatNumber, formatWatts } from "../format";
import { firstBits, firstNumber } from "../panels/uiNumbers";
import type {
  UiCustomMachineBuilder,
  UiCustomMachineGroup,
  UiCustomMachineTier,
  UiRecord,
  UiSystemPreset,
} from "./types";

const isUiRecord = (value: unknown): value is UiRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const firstString = (...values: Array<unknown>) =>
  values.find((value): value is string => typeof value === "string" && value.length > 0);

const normalizeCosts = (value: unknown): DisplayCost[] =>
  Array.isArray(value)
    ? value
        .map((cost) => {
          if (!isUiRecord(cost)) return null;
          const resource = cost.resource;
          const amount = cost.amount;
          return typeof resource === "string" && typeof amount === "number"
            ? { resource, amount }
            : null;
        })
        .filter((cost): cost is DisplayCost => cost !== null)
    : [];

export const getRecordCosts = (record: {
  costs?: DisplayCost[];
  cost?: DisplayCost[];
  price?: DisplayCost[];
}) =>
  normalizeCosts(record.costs).length > 0
    ? normalizeCosts(record.costs)
    : normalizeCosts(record.cost).length > 0
      ? normalizeCosts(record.cost)
      : normalizeCosts(record.price);

export const getPresetId = (preset: UiSystemPreset, index: number) => {
  const id = preset.id ?? preset.presetId ?? preset.templateId;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : `preset-${index + 1}`;
};

export const getPresetLabel = (preset: UiSystemPreset, index: number) =>
  firstString(preset.name, preset.label) ?? `System ${index + 1}`;

export const getTierId = (tier: UiCustomMachineTier, index: number) => {
  const id = tier.id ?? tier.tierId;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : `tier-${index + 1}`;
};

export const getTierLabel = (tier: UiCustomMachineTier, index: number) =>
  firstString(tier.name, tier.label) ?? `Tier ${index + 1}`;

export const getBuilderGroupId = (
  group: UiCustomMachineGroup,
  index: number,
) => {
  const id = group.id ?? group.slotId ?? group.component;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : `slot-${index + 1}`;
};

export const getBuilderGroupLabel = (
  group: UiCustomMachineGroup,
  index: number,
) =>
  firstString(group.name, group.label, group.component) ?? `Slot ${index + 1}`;

export const getBuilderGroups = (builder: UiCustomMachineBuilder | null) =>
  (
    builder?.groups ??
    builder?.slots ??
    builder?.tiers ??
    builder?.components ??
    []
  ).filter((group) => {
    const options = group.tiers ?? group.options ?? [];
    return options.length > 0;
  });

export const getBuilderSelections = (
  groups: UiCustomMachineGroup[],
  current: Record<string, string>,
) => {
  const next: Record<string, string> = {};

  groups.forEach((group, groupIndex) => {
    const groupId = getBuilderGroupId(group, groupIndex);
    const options = group.tiers ?? group.options ?? [];
    const optionIds = options.map(getTierId);
    next[groupId] = optionIds.includes(current[groupId] ?? "")
      ? current[groupId]!
      : (optionIds[0] ?? "");
  });

  return next;
};

export const getSelectedBuilderTiers = (
  groups: UiCustomMachineGroup[],
  selections: Record<string, string>,
) =>
  groups
    .map((group, groupIndex) => {
      const groupId = getBuilderGroupId(group, groupIndex);
      const options = group.tiers ?? group.options ?? [];
      return (
        options.find((tier, tierIndex) => getTierId(tier, tierIndex) === selections[groupId]) ??
        null
      );
    })
    .filter((tier): tier is UiCustomMachineTier => tier !== null);

export const getBuilderGroupOption = (
  groups: UiCustomMachineGroup[],
  selections: Record<string, string>,
  targetGroupId: string,
) => {
  const groupEntry = groups
    .map((group, groupIndex) => ({
      group,
      groupIndex,
      groupId: getBuilderGroupId(group, groupIndex),
    }))
    .find(({ groupId }) => groupId === targetGroupId);

  if (!groupEntry) return null;

  const options = groupEntry.group.tiers ?? groupEntry.group.options ?? [];
  return (
    options.find(
      (option, optionIndex) =>
        getTierId(option, optionIndex) === selections[groupEntry.groupId],
    ) ?? null
  );
};

export const getBuilderOptionMap = (builder: UiCustomMachineBuilder | null) => {
  const optionsByGroup = new Map<string, UiCustomMachineTier[]>();
  const optionsById = new Map<string, UiCustomMachineTier>();

  getBuilderGroups(builder).forEach((group, groupIndex) => {
    const groupId = getBuilderGroupId(group, groupIndex);
    const options = group.tiers ?? group.options ?? [];
    optionsByGroup.set(groupId, options);
    options.forEach((option, optionIndex) => {
      optionsById.set(getTierId(option, optionIndex), option);
    });
  });

  return { optionsByGroup, optionsById };
};

export const sumCosts = (costRows: DisplayCost[][]) => {
  const totals = new Map<string, number>();

  costRows.flat().forEach((cost) => {
    totals.set(cost.resource, (totals.get(cost.resource) ?? 0) + cost.amount);
  });

  return Array.from(totals.entries()).map(
    ([resource, amount]): DisplayCost => ({ resource, amount }),
  );
};

export const builderGroupIconFor = (groupId: string): LucideIcon => {
  const id = groupId.toLowerCase();
  if (id.includes("cpu")) return Cpu;
  if (id.includes("ram") || id.includes("memory")) return MemoryStick;
  if (id.includes("psu") || id.includes("power")) return Zap;
  if (id.includes("sched")) return LayoutGrid;
  if (id.includes("cache")) return Database;
  if (id.includes("cool") || id.includes("therm")) return Thermometer;
  if (id.includes("socket")) return HardDrive;
  return SlidersHorizontal;
};

export const summarizeTier = (tier: UiCustomMachineTier) => {
  const parts: string[] = [];
  const cores = firstNumber(tier.cores, tier.coreCount);
  if (cores !== undefined) parts.push(`${formatNumber(cores)}C`);
  const ramBits = firstBits([tier.ramBits], [tier.ramBytes]);
  if (ramBits > 0) parts.push(formatBits(ramBits));
  if (tier.powerDeltaWatts && tier.powerDeltaWatts !== 0) {
    parts.push(
      tier.powerDeltaWatts > 0
        ? `+${formatWatts(tier.powerDeltaWatts)}`
        : formatWatts(tier.powerDeltaWatts),
    );
  }
  return parts.join(" / ");
};

const formatCoreCount = (cores: number) =>
  `${formatNumber(cores)} ${cores === 1 ? "core" : "cores"}`;

const formatOptionalClock = (hz: number | undefined) =>
  hz ? formatClock(hz) : null;

export const formatModuleStats = (_groupId: string, stats: string[]) =>
  stats.join("\n");

export const getModuleStats = (
  groupId: string,
  module: UiCustomMachineTier | null | undefined,
) => {
  if (!module) return [];

  if (groupId === "cpu") {
    const coreCount = firstNumber(module.cores, module.coreCount);
    const clock = formatOptionalClock(module.clockHz);
    const cacheBits = firstBits([module.cacheBits], [module.cacheBytes]);
    const cacheSpeed = formatOptionalClock(module.cacheSpeedHz);
    const cacheCapacity = cacheBits > 0 ? `cache ${formatBits(cacheBits)}` : null;

    return [
      coreCount !== undefined
        ? [formatCoreCount(coreCount), clock].filter(Boolean).join(" @ ")
        : null,
      cacheCapacity || cacheSpeed
        ? [cacheCapacity ?? "cache", cacheSpeed].filter(Boolean).join(" @ ")
        : null,
    ].filter((item): item is string => item !== null);
  }

  if (groupId === "ram" || groupId === "memory") {
    const ramBits = firstBits([module.ramBits], [module.ramBytes]);
    const ramStickCount = module.ramStickCount ?? 0;
    const hasRam =
      ramBits > 0 ||
      ramStickCount > 0 ||
      (module.ramLevel ?? 0) > 0;
    const capacity = ramBits > 0 ? formatBits(ramBits) : ramStickCount === 0 ? "0 b" : null;
    const speed =
      hasRam && module.ramSpeedMt ? formatClock(module.ramSpeedMt) : null;
    const stickBits =
      ramStickCount > 0 && ramBits > 0 ? ramBits / ramStickCount : 0;
    const sticks =
      module.ramStickCount && stickBits > 0
        ? `${module.ramStickCount} x ${formatBits(stickBits)} sticks`
        : module.ramStickCount
          ? `${module.ramStickCount} sticks`
          : null;

    return [
      [capacity, speed].filter(Boolean).join(" @ "),
      sticks,
    ].filter((item): item is string => Boolean(item));
  }

  if (groupId === "scheduler") {
    return [
      module.schedulerSlots !== undefined
        ? `${formatNumber(module.schedulerSlots)} queue slots`
        : null,
    ].filter((item): item is string => item !== null);
  }

  if (groupId === "psu" || groupId === "powerSupply") {
    const watts = module.psuWatts ?? module.powerDeltaWatts;

    return [
      watts ? `${formatWatts(watts)} capacity` : null,
    ].filter((item): item is string => item !== null);
  }

  return summarizeTier(module) ? [summarizeTier(module)] : [];
};

export const getModuleSpecRows = (
  groupId: string,
  module: UiCustomMachineTier | null | undefined,
) => {
  const label =
    groupId === "cpu"
      ? "CPU"
      : groupId === "ram" || groupId === "memory"
        ? "RAM"
        : groupId === "scheduler"
          ? "Scheduler"
          : groupId === "psu" || groupId === "powerSupply"
            ? "PSU"
            : groupId;

  return {
    groupId,
    label,
    name: module ? getTierLabel(module, 0) : "Unselected",
    stats: getModuleStats(groupId, module),
    description: module?.description ?? null,
  };
};
