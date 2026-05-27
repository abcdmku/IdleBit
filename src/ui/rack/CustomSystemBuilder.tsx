import { useEffect, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  HardDrive,
  ListTodo,
  MemoryStick,
  Minus,
  Plus,
  Power,
} from "lucide-react";
import { getMachineSelectionCost } from "../../game/content/machines";
import { getCpuTierLevelDefinition } from "../../game/content/cpuTiers";
import {
  getRamTierFirstGlobalLevel,
  getRamTierLevelDefinition,
} from "../../game/content/ramTiers";
import {
  getCacheBits,
  getCpuClockHz,
  getPsuWatts,
  getRamBits,
  getRamSpeedMt,
} from "../../game/progression";
import { getPsuCapacityBuildCost } from "../../game/content/psu";
import type { VisibleState } from "../../game";
import {
  formatBits,
  formatClock,
  formatCost,
  formatNumber,
  formatWatts,
  type DisplayCost,
} from "../format";
import { firstBoolean, firstNumber } from "../panels/uiNumbers";
import { ResourceCost } from "../ResourceTokens";
import type { Dispatch } from "../uiActions";
import {
  getBuilderGroupId,
  getBuilderGroupLabel,
  getBuilderGroups,
  getRecordCosts,
  getTierId,
  sumCosts,
} from "./builderHelpers";
import { formatPowerRate } from "./rackFormatting";
import type {
  UiCustomMachineBuilder,
  UiCustomMachineGroup,
  UiCustomMachineTier,
} from "./types";

interface CustomSystemBuilderProps {
  builder: UiCustomMachineBuilder | null;
  resources: VisibleState["resources"];
  dispatch: Dispatch;
  draft?: CustomSystemBuilderDraft | null;
  onDraftChange?: (draft: CustomSystemBuilderDraft) => void;
}

type BuilderBayRole = "scheduler" | "memory" | "cpu" | "power" | "other";

export interface CustomSystemBuilderDraft {
  groupsKey: string;
  selections: Record<string, string>;
  activeSlotId: string | null;
  activeCpuPackageIndex: number;
}

interface BuilderGroupEntry {
  group: UiCustomMachineGroup;
  groupIndex: number;
  groupId: string;
  groupLabel: string;
  role: BuilderBayRole;
  options: UiCustomMachineTier[];
  selectedTier: UiCustomMachineTier | null;
}

type ClockTierId = "hz" | "khz" | "mhz" | "ghz" | "thz" | "phz";

type BuilderStepMetric =
  | "cpuFreq"
  | "cacheSize"
  | "cacheFreq"
  | "ramSize"
  | "ramFreq"
  | "schedulerSlots"
  | "psuCapacity";

interface IndexedBuilderOption {
  tier: UiCustomMachineTier;
  tierId: string;
  index: number;
}

const CLOCK_TIER_ORDER: ClockTierId[] = [
  "hz",
  "khz",
  "mhz",
  "ghz",
  "thz",
  "phz",
];

const CLOCK_TIER_LABELS: Record<ClockTierId, string> = {
  hz: "Hz",
  khz: "kHz",
  mhz: "MHz",
  ghz: "GHz",
  thz: "THz",
  phz: "PHz",
};

const normalizeClockTierId = (value: unknown): ClockTierId | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const text = String(value).toLowerCase();
  const direct = CLOCK_TIER_ORDER.find((tier) => tier === text);
  if (direct) return direct;

  const match = text.match(/(?:^|[^a-z])(phz|thz|ghz|mhz|khz|hz)(?:[^a-z]|$)/);
  return match ? (match[1] as ClockTierId) : null;
};

const scaleCosts = (costs: DisplayCost[], multiplier: number) =>
  costs.map((cost) => ({
    ...cost,
    amount: cost.amount * multiplier,
  }));

const isPsuGroup = (groupId: string) =>
  groupId === "psu" || groupId === "powerSupply";
const POWER_MATCH_EPSILON = 0.000000000001;
const BUILDER_MAX_CORES = Number.MAX_SAFE_INTEGER;
const BUILDER_MAX_CPUS = Number.MAX_SAFE_INTEGER;
const BUILDER_MAX_RAM_STICKS = 8;
const BUILDER_MAX_LEVEL = 36;

const getBuildCosts = (
  entries: Array<{ groupId: string; tier: UiCustomMachineTier }>,
  cpuCoreCount: number,
  ramStickCount: number,
  psuLevel?: number,
) =>
  sumCosts(
    entries.map(({ groupId, tier }) => {
      if (groupId === "cpu") {
        const baseCoreCount = Math.max(1, firstNumber(tier.cores, tier.coreCount) ?? 1);
        return scaleCosts(getRecordCosts(tier), cpuCoreCount / baseCoreCount);
      }
      if (groupId === "ram" || groupId === "memory") {
        const baseStickCount = Math.max(1, Math.floor(tier.ramStickCount ?? 1));
        return scaleCosts(getRecordCosts(tier), ramStickCount / baseStickCount);
      }
      if (isPsuGroup(groupId)) {
        const basePsuLevel = Math.max(1, Math.floor(tier.psuLevel ?? 1));
        const targetPsuLevel = Math.max(1, psuLevel ?? basePsuLevel);

        return [
          ...getRecordCosts(tier),
          ...getPsuCapacityBuildCost(basePsuLevel, targetPsuLevel),
        ];
      }
      return getRecordCosts(tier);
    }),
  );

const getBoundedInteger = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) => {
  const parsed = Number(value);
  const raw = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, Math.trunc(raw)));
};

const isTierSelectable = (tier: UiCustomMachineTier) =>
  !tier.disabled && firstBoolean(tier.canSelect) !== false;

const getBuilderBayRole = (groupId: string): BuilderBayRole => {
  const id = groupId.toLowerCase();
  if (id.includes("cpu")) return "cpu";
  if (id.includes("ram") || id.includes("memory")) return "memory";
  if (id.includes("sched")) return "scheduler";
  if (id.includes("psu") || id.includes("power")) return "power";
  return "other";
};

const getOptionClockTierId = (
  entry: Pick<BuilderGroupEntry, "groupId" | "role">,
  tier: UiCustomMachineTier,
) => {
  if (entry.role !== "cpu" && entry.role !== "memory") return null;

  return (
    normalizeClockTierId(tier.cpuTierId) ??
    normalizeClockTierId(tier.ramTierId) ??
    normalizeClockTierId(tier.tierName) ??
    normalizeClockTierId(tier.name) ??
    normalizeClockTierId(tier.label) ??
    normalizeClockTierId(tier.id) ??
    normalizeClockTierId(tier.tierId) ??
    normalizeClockTierId(entry.groupId)
  );
};

const getIndexedOptions = (entry: BuilderGroupEntry) =>
  entry.options.map(
    (tier, index): IndexedBuilderOption => ({
      tier,
      tierId: getTierId(tier, index),
      index,
    }),
  );

const getCurrentIndexedOption = (
  entry: BuilderGroupEntry,
  selections: Record<string, string>,
) => {
  const selectedTierId = selections[entry.groupId] ?? "";
  return (
    getIndexedOptions(entry).find((option) => option.tierId === selectedTierId) ??
    null
  );
};

const getMetricValue = (
  metric: BuilderStepMetric,
  tier: UiCustomMachineTier,
) => {
  if (metric === "cpuFreq") {
    return firstNumber(tier.cpuLevel, tier.clockLevel, tier.clockHz) ?? 0;
  }
  if (metric === "cacheSize") {
    return firstNumber(tier.cacheLevel, tier.cacheBits, tier.cacheBytes) ?? 0;
  }
  if (metric === "cacheFreq") {
    return firstNumber(tier.cacheSpeedLevel, tier.cacheSpeedHz) ?? 0;
  }
  if (metric === "ramSize") {
    return firstNumber(tier.ramLevel, tier.ramBits, tier.ramBytes) ?? 0;
  }
  if (metric === "ramFreq") {
    return firstNumber(tier.ramSpeedLevel, tier.ramSpeedMt) ?? 0;
  }
  if (metric === "schedulerSlots") {
    return firstNumber(tier.schedulerSlots) ?? 0;
  }
  return firstNumber(tier.psuLevel, tier.psuWatts, tier.powerDeltaWatts) ?? 0;
};

const getSystemBuilderOptions = (
  group: UiCustomMachineGroup,
  groupIndex: number,
) => {
  const groupId = getBuilderGroupId(group, groupIndex);
  const role = getBuilderBayRole(groupId);
  const options = group.tiers ?? group.options ?? [];

  if (role !== "cpu" && role !== "memory") return options;

  const clockTierOptions = options.filter((option) =>
    Boolean(getOptionClockTierId({ groupId, role }, option)),
  );
  return clockTierOptions.length > 0 ? clockTierOptions : options;
};

const getSystemBuilderSelections = (
  groups: UiCustomMachineGroup[],
  current: Record<string, string>,
) => {
  const next: Record<string, string> = {};

  groups.forEach((group, groupIndex) => {
    const groupId = getBuilderGroupId(group, groupIndex);
    const optionIds = getSystemBuilderOptions(group, groupIndex).map(getTierId);
    next[groupId] = optionIds.includes(current[groupId] ?? "")
      ? current[groupId]!
      : (optionIds[0] ?? "");
  });

  next.cpuCores = String(
    getBoundedInteger(current.cpuCores, 1, 1, BUILDER_MAX_CORES),
  );
  next.cpuPackages = String(
    getBoundedInteger(current.cpuPackages, 1, 1, BUILDER_MAX_CPUS),
  );
  next.cpuLinked = current.cpuLinked === "0" ? "0" : "1";
  next.cpuSchedulerMatch = current.cpuSchedulerMatch === "0" ? "0" : "1";
  next.cpuSchedulerSlots = String(
    getBoundedInteger(current.cpuSchedulerSlots, 1, 0, BUILDER_MAX_CORES),
  );
  next.cpuPackageSchedulerSlots = current.cpuPackageSchedulerSlots ?? "";
  next.cpuPackageSchedulerMatches = current.cpuPackageSchedulerMatches ?? "";
  next.cpuLevel = String(
    getBoundedInteger(current.cpuLevel, 1, 1, BUILDER_MAX_LEVEL),
  );
  next.cacheLevel = String(
    getBoundedInteger(current.cacheLevel, 1, 1, BUILDER_MAX_LEVEL),
  );
  next.cacheSpeedLevel = String(
    getBoundedInteger(current.cacheSpeedLevel, 1, 1, BUILDER_MAX_LEVEL),
  );
  next.ramSticks = String(
    getBoundedInteger(current.ramSticks, 1, 1, BUILDER_MAX_RAM_STICKS),
  );
  next.ramTierLevel = String(
    getBoundedInteger(current.ramTierLevel, 1, 1, BUILDER_MAX_LEVEL),
  );
  next.ramSpeedTierLevel = String(
    getBoundedInteger(current.ramSpeedTierLevel, 1, 1, BUILDER_MAX_LEVEL),
  );

  return next;
};

const getAdjacentBuilderOption = (
  entry: BuilderGroupEntry,
  selections: Record<string, string>,
  metric: BuilderStepMetric,
  direction: -1 | 1,
  sameClockTier = false,
) => {
  const selected = getCurrentIndexedOption(entry, selections);
  const selectedClockTier =
    selected && sameClockTier ? getOptionClockTierId(entry, selected.tier) : null;
  const candidates = getIndexedOptions(entry)
    .filter((option) => isTierSelectable(option.tier))
    .filter((option) =>
      sameClockTier && selectedClockTier
        ? getOptionClockTierId(entry, option.tier) === selectedClockTier
        : true,
    )
    .sort((left, right) => {
      const valueDelta =
        getMetricValue(metric, left.tier) - getMetricValue(metric, right.tier);
      return valueDelta === 0 ? left.index - right.index : valueDelta;
    });
  const selectedIndex = candidates.findIndex(
    (candidate) => candidate.tierId === selected?.tierId,
  );

  if (selectedIndex < 0) return direction > 0 ? (candidates[0] ?? null) : null;
  return candidates[selectedIndex + direction] ?? null;
};

const getProjectedRunCostPerSecond = (watts: number) =>
  Math.round(watts * 1_000_000 * 1000) / 1000;

const roundPowerWatts = (value: number) =>
  Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;

const getProjectedCpuWatts = (
  coreCount: number,
  clockHz: number,
  efficiency: number,
) => (coreCount * clockHz) / Math.max(0.000000000001, efficiency) / 1_000_000;

const getProjectedCacheWatts = (cacheLevel: number, cacheSpeedLevel: number) =>
  (cacheLevel <= 0
    ? 0
    : 0.00000000000002 * Math.max(0, cacheLevel - 1) ** 1.18 +
      0.00000000000001 * Math.max(0, cacheSpeedLevel - 1) ** 1.16);

const getProjectedCpuEfficiency = (
  baseEfficiency: number,
  cpuPackageCount: number,
) => baseEfficiency * 0.75 ** Math.max(0, cpuPackageCount - 1);

const getProjectedRamEfficiency = (ramSpeedLevel: number) =>
  getRamTierLevelDefinition(ramSpeedLevel).efficiency;

const getProjectedRamWatts = (
  stickCount: number,
  ramLevel: number,
  ramSpeedLevel: number,
  ramSpeedMt: number,
) => {
  const stickEfficiency = getProjectedRamEfficiency(ramSpeedLevel);
  const activeDrawWatts =
    ((Math.max(1, ramSpeedMt) / stickEfficiency) * 0.1) / 1_000_000;
  const capacityDrawWatts =
    0.000000000000004 * Math.max(1, ramLevel) ** 1.12;

  return stickCount * (activeDrawWatts + capacityDrawWatts);
};

const getRamStickGridMetrics = (stickCount: number) => {
  const count = Math.max(1, stickCount);

  if (count <= 1) return { columns: 1, label: "1x1" };
  if (count <= 2) return { columns: 2, label: "2x1" };
  if (count <= 4) return { columns: 2, label: "2x2" };
  if (count <= 6) return { columns: 3, label: "3x2" };
  if (count <= 8) return { columns: 4, label: "4x2" };

  const columns = Math.min(6, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  return { columns, label: `${columns}x${rows}` };
};

const getRamChannelLabel = (stickCount: number) => {
  const count = Math.max(1, stickCount);
  if (count >= 8) return "oct channel";
  if (count >= 4) return "quad channel";
  if (count >= 2) return "dual channel";
  return "single channel";
};

const parseIntegerList = (
  value: string | undefined,
  length: number,
  fallback: (index: number) => number,
  min: number,
  max: number,
) => {
  const parts = value?.split(",") ?? [];

  return Array.from({ length }, (_, index) => {
    const parsed = Number(parts[index]);
    const raw = Number.isFinite(parsed) ? parsed : fallback(index);
    return Math.max(min, Math.min(max, Math.trunc(raw)));
  });
};

const serializeIntegerList = (values: number[]) => values.map(String).join(",");

const parseBooleanList = (
  value: string | undefined,
  length: number,
  fallback: (index: number) => boolean,
) => {
  const parts = value?.split(",") ?? [];

  return Array.from({ length }, (_, index) => {
    if (parts[index] === "0") return false;
    if (parts[index] === "1") return true;
    return fallback(index);
  });
};

const serializeBooleanList = (values: boolean[]) =>
  values.map((value) => (value ? "1" : "0")).join(",");

const getBuilderCoreGridMetrics = (coreCount: number) => {
  const count = Math.max(1, coreCount);
  let columns = 2;

  if (count <= 4) {
    columns = 2;
  } else if (count <= 12) {
    columns = 4;
  } else if (count <= 24) {
    columns = 6;
  } else {
    columns = 8;
  }

  const rows = Math.ceil(count / columns);
  const density = columns >= 6 ? "dense" : columns >= 4 ? "compact" : "normal";

  return {
    rows,
    columns,
    density,
    label: `${rows}x${columns}`,
  };
};

const formatClockTierLabel = (tierId: ClockTierId) => CLOCK_TIER_LABELS[tierId];

function BuilderStepper({
  label,
  value,
  accent,
  canDecrease,
  canIncrease,
  onDecrease,
  onIncrease,
  disabledReason,
}: {
  label: string;
  value: string;
  accent: "cyan" | "green" | "violet" | "amber";
  canDecrease: boolean;
  canIncrease: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  disabledReason?: string;
}) {
  return (
    <div className={`upgrade-stepper ${accent} custom-builder-stepper`}>
      <button
        type="button"
        className="upgrade-stepper-button minus"
        disabled={!canDecrease}
        title={canDecrease ? `Decrease ${label}` : (disabledReason ?? `${label}: Min`)}
        onClick={onDecrease}
      >
        <Minus size={11} />
      </button>
      <span className="upgrade-stepper-spec" title={`${label}: ${value}`}>
        <span>{label}</span>
        <strong className="custom-builder-stepper-value">{value}</strong>
      </span>
      <button
        type="button"
        className="upgrade-stepper-button plus"
        disabled={!canIncrease}
        title={canIncrease ? `Increase ${label}` : (disabledReason ?? `${label}: Max`)}
        onClick={onIncrease}
      >
        <Plus size={11} />
      </button>
    </div>
  );
}

export function CustomSystemBuilder({
  builder,
  resources,
  dispatch,
  draft = null,
  onDraftChange,
}: CustomSystemBuilderProps) {
  const groups = getBuilderGroups(builder);
  const groupsKey = groups
    .map((group, groupIndex) => {
      const groupId = getBuilderGroupId(group, groupIndex);
      const optionIds = getSystemBuilderOptions(group, groupIndex)
        .map(getTierId)
        .join(",");
      return `${groupId}:${optionIds}`;
    })
    .join("|");
  const draftForGroups = draft?.groupsKey === groupsKey ? draft : null;
  const [selections, setSelections] = useState<Record<string, string>>(() =>
    getSystemBuilderSelections(groups, draftForGroups?.selections ?? {}),
  );
  const initialActiveSlot = groups[0]
    ? getBuilderGroupId(groups[0], 0)
    : null;
  const [activeSlotId, setActiveSlotId] = useState<string | null>(
    draftForGroups?.activeSlotId ?? initialActiveSlot,
  );
  const [confirmingPurchase, setConfirmingPurchase] = useState(false);
  const [activeCpuPackageIndex, setActiveCpuPackageIndex] = useState(
    draftForGroups?.activeCpuPackageIndex ?? 0,
  );

  useEffect(() => {
    setSelections((current) => getSystemBuilderSelections(groups, current));
    setConfirmingPurchase(false);
  }, [groupsKey]);

  useEffect(() => {
    if (groups.length === 0) {
      setActiveSlotId(null);
      return;
    }
    const valid = groups.some(
      (group, index) => getBuilderGroupId(group, index) === activeSlotId,
    );
    if (!valid) {
      setActiveSlotId(getBuilderGroupId(groups[0]!, 0));
    }
  }, [groupsKey, activeSlotId]);

  useEffect(() => {
    if (!onDraftChange || groups.length === 0) return;

    onDraftChange({
      groupsKey,
      selections,
      activeSlotId,
      activeCpuPackageIndex,
    });
  }, [
    activeCpuPackageIndex,
    activeSlotId,
    groups.length,
    groupsKey,
    onDraftChange,
    selections,
  ]);

  if (!builder || groups.length === 0) return null;

  const groupEntries: BuilderGroupEntry[] = groups.map((group, groupIndex) => {
    const groupId = getBuilderGroupId(group, groupIndex);
    const options = getSystemBuilderOptions(group, groupIndex);
    const selectedTier =
      options.find(
        (option, optionIndex) =>
          getTierId(option, optionIndex) === selections[groupId],
      ) ?? null;

    return {
      group,
      groupIndex,
      groupId,
      groupLabel: getBuilderGroupLabel(group, groupIndex),
      role: getBuilderBayRole(groupId),
      options,
      selectedTier,
    };
  });
  const entryForRole = (role: BuilderBayRole) =>
    groupEntries.find((entry) => entry.role === role) ?? null;
  const schedulerEntry = entryForRole("scheduler");
  const memoryEntry = entryForRole("memory");
  const cpuEntry = entryForRole("cpu");
  const powerEntry = entryForRole("power");

  const selectedEntries = groupEntries
    .map((entry) =>
      entry.selectedTier ? { groupId: entry.groupId, tier: entry.selectedTier } : null,
    )
    .filter(
      (entry): entry is { groupId: string; tier: UiCustomMachineTier } =>
        entry !== null,
    );
  const selectedTiers = selectedEntries.map((entry) => entry.tier);
  const selectedCpuTier = cpuEntry?.selectedTier ?? null;
  const selectedPsuTier = powerEntry?.selectedTier ?? null;
  const cpuClockTierId =
    selectedCpuTier && cpuEntry
      ? getOptionClockTierId(cpuEntry, selectedCpuTier)
      : null;
  const memoryClockTierId =
    memoryEntry?.selectedTier
      ? getOptionClockTierId(memoryEntry, memoryEntry.selectedTier)
      : null;
  const cpuCoreCount = getBoundedInteger(
    selections.cpuCores,
    firstNumber(selectedCpuTier?.cores, selectedCpuTier?.coreCount) ?? 1,
    1,
    BUILDER_MAX_CORES,
  );
  const cpuPackageCount = getBoundedInteger(
    selections.cpuPackages,
    Math.max(1, Math.floor(selectedCpuTier?.cpuPackageCount ?? 1)),
    1,
    BUILDER_MAX_CPUS,
  );
  const activeCpuIndex = Math.min(
    Math.max(0, activeCpuPackageIndex),
    Math.max(0, cpuPackageCount - 1),
  );
  const cpuLinked = selections.cpuLinked !== "0";
  const cpuLevel = getBoundedInteger(
    selections.cpuLevel,
    1,
    1,
    BUILDER_MAX_LEVEL,
  );
  const cacheLevel = getBoundedInteger(
    selections.cacheLevel,
    1,
    1,
    BUILDER_MAX_LEVEL,
  );
  const cacheSpeedLevel = getBoundedInteger(
    selections.cacheSpeedLevel,
    1,
    1,
    BUILDER_MAX_LEVEL,
  );
  const linkedCpuConfig = {
    coreCount: cpuCoreCount,
    cpuLevel,
    cacheLevel,
    cacheSpeedLevel,
  };
  const unlinkedCoreCounts = parseIntegerList(
    selections.cpuPackageCores,
    cpuPackageCount,
    () => linkedCpuConfig.coreCount,
    1,
    BUILDER_MAX_CORES,
  );
  const unlinkedCpuLevels = parseIntegerList(
    selections.cpuPackageLevels,
    cpuPackageCount,
    () => linkedCpuConfig.cpuLevel,
    1,
    BUILDER_MAX_LEVEL,
  );
  const unlinkedCacheLevels = parseIntegerList(
    selections.cpuPackageCacheLevels,
    cpuPackageCount,
    () => linkedCpuConfig.cacheLevel,
    1,
    BUILDER_MAX_LEVEL,
  );
  const unlinkedCacheSpeedLevels = parseIntegerList(
    selections.cpuPackageCacheSpeedLevels,
    cpuPackageCount,
    () => linkedCpuConfig.cacheSpeedLevel,
    1,
    BUILDER_MAX_LEVEL,
  );
  const cpuPackageBaseConfigs = Array.from({ length: cpuPackageCount }, (_, index) =>
    cpuLinked
      ? linkedCpuConfig
      : {
          coreCount: unlinkedCoreCounts[index] ?? linkedCpuConfig.coreCount,
          cpuLevel: unlinkedCpuLevels[index] ?? linkedCpuConfig.cpuLevel,
          cacheLevel: unlinkedCacheLevels[index] ?? linkedCpuConfig.cacheLevel,
          cacheSpeedLevel:
            unlinkedCacheSpeedLevels[index] ?? linkedCpuConfig.cacheSpeedLevel,
        },
  );
  const totalCores = cpuPackageBaseConfigs.reduce(
    (total, config) => total + config.coreCount,
    0,
  );
  const linkedCpuSchedulerMatchesCores = selections.cpuSchedulerMatch !== "0";
  const linkedCpuSchedulerSlots = getBoundedInteger(
    selections.cpuSchedulerSlots,
    linkedCpuConfig.coreCount,
    0,
    BUILDER_MAX_CORES,
  );
  const unlinkedSchedulerMatches = parseBooleanList(
    selections.cpuPackageSchedulerMatches,
    cpuPackageCount,
    () => linkedCpuSchedulerMatchesCores,
  );
  const unlinkedSchedulerSlots = parseIntegerList(
    selections.cpuPackageSchedulerSlots,
    cpuPackageCount,
    (index) =>
      cpuPackageBaseConfigs[index]?.coreCount ?? linkedCpuConfig.coreCount,
    0,
    BUILDER_MAX_CORES,
  );
  const cpuPackageSchedulerMatches = cpuPackageBaseConfigs.map((_, index) =>
    cpuLinked
      ? linkedCpuSchedulerMatchesCores
      : (unlinkedSchedulerMatches[index] ?? linkedCpuSchedulerMatchesCores),
  );
  const cpuPackageConfigs = cpuPackageBaseConfigs.map((config, index) => {
    const matchesCores = cpuPackageSchedulerMatches[index] ?? true;
    const manualSlots = cpuLinked
      ? linkedCpuSchedulerSlots
      : (unlinkedSchedulerSlots[index] ?? config.coreCount);

    return {
      ...config,
      schedulerSlots: matchesCores ? config.coreCount : manualSlots,
    };
  });
  const activeCpuConfig = cpuPackageConfigs[activeCpuIndex] ?? {
    ...linkedCpuConfig,
    schedulerSlots: linkedCpuSchedulerMatchesCores
      ? linkedCpuConfig.coreCount
      : linkedCpuSchedulerSlots,
  };
  const activeCpuSchedulerMatchesCores =
    cpuPackageSchedulerMatches[activeCpuIndex] ?? linkedCpuSchedulerMatchesCores;
  const activeCpuSchedulerSlots = Math.max(
    0,
    activeCpuConfig.schedulerSlots ?? activeCpuConfig.coreCount,
  );
  const totalCpuSchedulerSlots = cpuPackageConfigs.reduce(
    (total, config) => total + Math.max(0, config.schedulerSlots),
    0,
  );
  const ramStickCount = getBoundedInteger(
    selections.ramSticks,
    Math.max(1, Math.floor(memoryEntry?.selectedTier?.ramStickCount ?? 1)),
    1,
    BUILDER_MAX_RAM_STICKS,
  );
  const ramTierLevel = getBoundedInteger(
    selections.ramTierLevel,
    1,
    1,
    BUILDER_MAX_LEVEL,
  );
  const ramSpeedTierLevel = getBoundedInteger(
    selections.ramSpeedTierLevel,
    1,
    1,
    BUILDER_MAX_LEVEL,
  );
  const ramBaseGlobalLevel = memoryClockTierId
    ? getRamTierFirstGlobalLevel(memoryClockTierId)
    : 1;
  const ramLevel = ramBaseGlobalLevel + ramTierLevel - 1;
  const ramSpeedLevel = ramBaseGlobalLevel + ramSpeedTierLevel - 1;
  const basePsuLevel = Math.max(1, Math.floor(selectedPsuTier?.psuLevel ?? 1));
  const psuLevel = getBoundedInteger(
    selections.psuLevel,
    basePsuLevel,
    1,
    BUILDER_MAX_LEVEL,
  );
  const machineSelection =
    cpuEntry &&
    memoryEntry &&
    schedulerEntry &&
    powerEntry
      ? {
          cpu: selections[cpuEntry.groupId] ?? "",
          cpuPackageCount,
          cpuCoreCount: totalCores,
          cpuLevel: activeCpuConfig.cpuLevel,
          cacheLevel: activeCpuConfig.cacheLevel,
          cacheSpeedLevel: activeCpuConfig.cacheSpeedLevel,
          cpuPackageConfigs,
          cpuSchedulerSlots: totalCpuSchedulerSlots,
          ram: selections[memoryEntry.groupId] ?? "",
          ramStickCount,
          ramLevel,
          ramSpeedLevel,
          scheduler: selections[schedulerEntry.groupId] ?? "",
          psu: selections[powerEntry.groupId] ?? "",
          psuLevel,
        }
      : null;
  const moduleCosts =
    machineSelection !== null
      ? (() => {
          try {
            return getMachineSelectionCost(machineSelection);
          } catch {
            return getBuildCosts(selectedEntries, totalCores, ramStickCount, psuLevel);
          }
        })()
      : getBuildCosts(selectedEntries, totalCores, ramStickCount, psuLevel);
  const costs =
    getRecordCosts(builder).length > 0
      ? getRecordCosts(builder)
      : moduleCosts;
  const canAffordBuild = costs.every((cost) =>
    cost.resource === "credits" || cost.resource === "data"
      ? resources[cost.resource] >= cost.amount
      : true,
  );
  const tierBlocked = selectedTiers.find(
    (tier) =>
      tier.disabled ||
      firstBoolean(tier.canSelect) === false ||
      Boolean(tier.blockedReason),
  );
  const canBuy =
    !tierBlocked &&
    canAffordBuild &&
    (firstBoolean(builder.canBuy) ?? true);
  const blockedReason =
    tierBlocked?.blockedReason ??
    builder.blockedReason ??
    builder.lockedReason ??
    (!canAffordBuild ? "Insufficient resources." : null) ??
    "Locked";
  const getPackageClockHz = (level: number) =>
    cpuClockTierId === null
      ? (selectedCpuTier?.clockHz ?? 0)
      : getCpuClockHz(cpuClockTierId, level);
  const getPackageCacheSpeedHz = (level: number) =>
    cpuClockTierId === null
      ? (selectedCpuTier?.cacheSpeedHz ?? 0)
      : getCpuClockHz(cpuClockTierId, level);
  const getPackageBaseEfficiency = (level: number) =>
    cpuClockTierId === null
      ? (selectedCpuTier?.cpuEfficiency ?? 1)
      : getCpuTierLevelDefinition(cpuClockTierId, level).efficiency;
  const cpuClockHz = getPackageClockHz(activeCpuConfig.cpuLevel);
  const cacheBits = getCacheBits(activeCpuConfig.cacheLevel);
  const cacheSpeedHz = getPackageCacheSpeedHz(activeCpuConfig.cacheSpeedLevel);
  const ramBits = getRamBits(ramLevel) * ramStickCount;
  const ramSpeed = getRamSpeedMt(ramSpeedLevel);
  const baseCpuEfficiency = getPackageBaseEfficiency(activeCpuConfig.cpuLevel);
  const cpuEfficiency = getProjectedCpuEfficiency(
    baseCpuEfficiency,
    cpuPackageCount,
  );
  const ramEfficiency = getProjectedRamEfficiency(ramSpeedLevel);
  const ramEfficiencyLabel = formatNumber(ramEfficiency);
  const otherRequiredPowerWatts = selectedEntries.reduce(
    (total, { groupId, tier }) =>
      groupId === "cpu" ||
      groupId === "ram" ||
      groupId === "memory" ||
      isPsuGroup(groupId)
        ? total
        : total + (tier.powerDeltaWatts ?? 0),
    0,
  );
  const requiredPowerWatts = roundPowerWatts(
    cpuPackageConfigs.reduce((total, config) => {
      const packageEfficiency = getProjectedCpuEfficiency(
        getPackageBaseEfficiency(config.cpuLevel),
        cpuPackageCount,
      );
      return (
        total +
        getProjectedCpuWatts(
          config.coreCount,
          getPackageClockHz(config.cpuLevel),
          packageEfficiency,
        ) +
        getProjectedCacheWatts(config.cacheLevel, config.cacheSpeedLevel)
      );
    }, 0) +
      getProjectedRamWatts(ramStickCount, ramLevel, ramSpeedLevel, ramSpeed) +
      Math.max(0, cpuPackageCount - 1) * 0.00000000000008 +
      otherRequiredPowerWatts,
  );
  const psuCapacityWatts = selectedPsuTier
    ? selectedPsuTier.psuLevel !== undefined
      ? getPsuWatts(psuLevel)
      : (firstNumber(selectedPsuTier.psuWatts, selectedPsuTier.powerDeltaWatts) ?? 0)
    : 0;
  const powerMet = requiredPowerWatts <= psuCapacityWatts + POWER_MATCH_EPSILON;
  const powerLabel = powerMet ? "Met" : "Short";
  const projectedEfficiency = cpuEfficiency;
  const projectedRunCostPerSecond =
    getProjectedRunCostPerSecond(requiredPowerWatts);

  const chooseTier = (groupId: string, tierId: string) => {
    const role = groupEntries.find((entry) => entry.groupId === groupId)?.role;
    setConfirmingPurchase(false);
    setActiveSlotId(groupId);
    setSelections((current) => ({
      ...current,
      [groupId]: tierId,
      ...(role === "cpu"
        ? {
            cpuLevel: "1",
            cacheLevel: "1",
            cacheSpeedLevel: "1",
            cpuPackageCores: "",
            cpuPackageLevels: "",
            cpuPackageCacheLevels: "",
            cpuPackageCacheSpeedLevels: "",
            cpuSchedulerMatch: "1",
            cpuSchedulerSlots: "1",
            cpuPackageSchedulerSlots: "",
            cpuPackageSchedulerMatches: "",
          }
        : {}),
      ...(role === "memory"
        ? {
            ramTierLevel: "1",
            ramSpeedTierLevel: "1",
          }
        : {}),
    }));
  };

  const setSelectionNumber = (
    key: string,
    nextValue: number,
    min: number,
    max: number,
  ) => {
    setConfirmingPurchase(false);
    setSelections((current) => ({
      ...current,
      [key]: String(Math.max(min, Math.min(max, Math.trunc(nextValue)))),
    }));
  };

  const setCpuLinked = (linked: boolean) => {
    setConfirmingPurchase(false);
    setSelections((current) => {
      const activeConfig = cpuPackageConfigs[activeCpuIndex] ?? linkedCpuConfig;

      return {
        ...current,
        cpuLinked: linked ? "1" : "0",
        cpuCores: String(activeConfig.coreCount),
        cpuLevel: String(activeConfig.cpuLevel),
        cacheLevel: String(activeConfig.cacheLevel),
        cacheSpeedLevel: String(activeConfig.cacheSpeedLevel),
        cpuPackageCores: serializeIntegerList(
          cpuPackageConfigs.map((config) => config.coreCount),
        ),
        cpuPackageLevels: serializeIntegerList(
          cpuPackageConfigs.map((config) => config.cpuLevel),
        ),
        cpuPackageCacheLevels: serializeIntegerList(
          cpuPackageConfigs.map((config) => config.cacheLevel),
        ),
        cpuPackageCacheSpeedLevels: serializeIntegerList(
          cpuPackageConfigs.map((config) => config.cacheSpeedLevel),
        ),
        cpuSchedulerMatch: activeCpuSchedulerMatchesCores ? "1" : "0",
        cpuSchedulerSlots: String(activeCpuSchedulerSlots),
        cpuPackageSchedulerSlots: serializeIntegerList(
          cpuPackageConfigs.map((config) => config.schedulerSlots),
        ),
        cpuPackageSchedulerMatches: serializeBooleanList(
          cpuPackageSchedulerMatches,
        ),
      };
    });
  };

  const setCpuSchedulerMatch = (packageIndex: number, matchesCores: boolean) => {
    setConfirmingPurchase(false);
    setSelections((current) => {
      if (cpuLinked) {
        return {
          ...current,
          cpuSchedulerMatch: matchesCores ? "1" : "0",
          cpuSchedulerSlots: String(activeCpuSchedulerSlots),
        };
      }

      const nextMatches = cpuPackageSchedulerMatches.map((value, index) =>
        index === packageIndex ? matchesCores : value,
      );
      const nextSlots = cpuPackageConfigs.map((config) => config.schedulerSlots);

      return {
        ...current,
        cpuPackageSchedulerMatches: serializeBooleanList(nextMatches),
        cpuPackageSchedulerSlots: serializeIntegerList(nextSlots),
      };
    });
  };

  const updateCpuSchedulerSlots = (packageIndex: number, nextValue: number) => {
    const value = Math.max(
      0,
      Math.min(BUILDER_MAX_CORES, Math.trunc(nextValue)),
    );

    setConfirmingPurchase(false);
    setSelections((current) => {
      if (cpuLinked) {
        return {
          ...current,
          cpuSchedulerMatch: "0",
          cpuSchedulerSlots: String(value),
        };
      }

      const nextMatches = cpuPackageSchedulerMatches.map((matches, index) =>
        index === packageIndex ? false : matches,
      );
      const nextSlots = cpuPackageConfigs.map((config, index) =>
        index === packageIndex ? value : config.schedulerSlots,
      );

      return {
        ...current,
        cpuPackageSchedulerMatches: serializeBooleanList(nextMatches),
        cpuPackageSchedulerSlots: serializeIntegerList(nextSlots),
      };
    });
  };

  const updateCpuPackageConfig = (
    packageIndex: number,
    key:
      | "coreCount"
      | "cpuLevel"
      | "cacheLevel"
      | "cacheSpeedLevel",
    nextValue: number,
    min: number,
    max: number,
  ) => {
    const value = Math.max(min, Math.min(max, Math.trunc(nextValue)));

    if (cpuLinked) {
      const keyName =
        key === "coreCount"
          ? "cpuCores"
          : key === "cpuLevel"
            ? "cpuLevel"
            : key === "cacheLevel"
              ? "cacheLevel"
              : "cacheSpeedLevel";
      setSelectionNumber(keyName, value, min, max);
      return;
    }

    setConfirmingPurchase(false);
    setSelections((current) => {
      const nextConfigs = cpuPackageConfigs.map((config, index) =>
        index === packageIndex ? { ...config, [key]: value } : config,
      );

      return {
        ...current,
        cpuPackageCores: serializeIntegerList(
          nextConfigs.map((config) => config.coreCount),
        ),
        cpuPackageLevels: serializeIntegerList(
          nextConfigs.map((config) => config.cpuLevel),
        ),
        cpuPackageCacheLevels: serializeIntegerList(
          nextConfigs.map((config) => config.cacheLevel),
        ),
        cpuPackageCacheSpeedLevels: serializeIntegerList(
          nextConfigs.map((config) => config.cacheSpeedLevel),
        ),
      };
    });
  };

  const renderClockTierControls = (entry: BuilderGroupEntry) => {
    const indexedOptions = getIndexedOptions(entry);
    const selectedClockTier =
      entry.selectedTier ? getOptionClockTierId(entry, entry.selectedTier) : null;
    const choices = CLOCK_TIER_ORDER.map((tierId) => {
      const tierOptions = indexedOptions.filter(
        (option) => getOptionClockTierId(entry, option.tier) === tierId,
      );
      const selectableOption = tierOptions.find((option) =>
        isTierSelectable(option.tier),
      );
      return tierOptions[0]
        ? { tierId, option: tierOptions[0], selectableOption }
        : null;
    }).filter(
      (
        choice,
      ): choice is {
        tierId: ClockTierId;
        option: IndexedBuilderOption;
        selectableOption: IndexedBuilderOption | undefined;
      } => choice !== null,
    );

    if (choices.length === 0) return null;

    return (
      <div
        className={`custom-builder-tier-controls custom-builder-${entry.role}-tier-controls custom-builder-clock-tier-controls`}
        aria-label={`${entry.groupLabel} tier`}
      >
        <span className="custom-builder-tier-title">Tier</span>
        <div
          className={`custom-builder-tier-options custom-builder-${entry.role}-tier-options`}
          role="group"
        >
          {choices.map(({ tierId, option, selectableOption }) => {
            const active = selectedClockTier === tierId;
            const target = selectableOption ?? option;
            const disabled = !selectableOption;
            const blockedReason =
              option.tier.blockedReason ?? option.tier.description ?? "Locked";

            return (
              <button
                key={tierId}
                type="button"
                className={active ? "active" : ""}
                aria-pressed={active}
                disabled={disabled}
                title={
                  disabled
                    ? blockedReason
                    : `Select ${formatClockTierLabel(tierId)} tier`
                }
                onClick={() => chooseTier(entry.groupId, target.tierId)}
              >
                {formatClockTierLabel(tierId)}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderBuilderStepper = ({
    entry,
    metric,
    label,
    value,
    accent,
    sameClockTier = false,
  }: {
    entry: BuilderGroupEntry;
    metric: BuilderStepMetric;
    label: string;
    value: string;
    accent: "cyan" | "green" | "violet" | "amber";
    sameClockTier?: boolean;
  }) => {
    const previous = getAdjacentBuilderOption(
      entry,
      selections,
      metric,
      -1,
      sameClockTier,
    );
    const next = getAdjacentBuilderOption(
      entry,
      selections,
      metric,
      1,
      sameClockTier,
    );

    return (
      <BuilderStepper
        label={label}
        value={value}
        accent={accent}
        canDecrease={Boolean(previous)}
        canIncrease={Boolean(next)}
        onDecrease={() => {
          if (previous) chooseTier(entry.groupId, previous.tierId);
        }}
        onIncrease={() => {
          if (next) chooseTier(entry.groupId, next.tierId);
        }}
      />
    );
  };

  const renderModifierStepper = ({
    keyName,
    label,
    value,
    display,
    accent,
    min = 1,
    max = BUILDER_MAX_LEVEL,
    locked = false,
    lockedReason,
  }: {
    keyName: string;
    label: string;
    value: number;
    display: string;
    accent: "cyan" | "green" | "violet" | "amber";
    min?: number;
    max?: number;
    locked?: boolean;
    lockedReason?: string;
  }) => (
    <BuilderStepper
      label={label}
      value={display}
      accent={accent}
      canDecrease={!locked && value > min}
      canIncrease={!locked && value < max}
      onDecrease={() => setSelectionNumber(keyName, value - 1, min, max)}
      onIncrease={() => setSelectionNumber(keyName, value + 1, min, max)}
      disabledReason={lockedReason}
    />
  );

  const renderCpuConfigStepper = ({
    packageIndex = activeCpuIndex,
    configKey,
    label,
    value,
    display,
    accent,
    min = 1,
    max = BUILDER_MAX_LEVEL,
  }: {
    packageIndex?: number;
    configKey:
      | "coreCount"
      | "cpuLevel"
      | "cacheLevel"
      | "cacheSpeedLevel";
    label: string;
    value: number;
    display: string;
    accent: "cyan" | "green";
    min?: number;
    max?: number;
  }) => (
    <BuilderStepper
      label={label}
      value={display}
      accent={accent}
      canDecrease={value > min}
      canIncrease={value < max}
      onDecrease={() =>
        updateCpuPackageConfig(packageIndex, configKey, value - 1, min, max)
      }
      onIncrease={() =>
        updateCpuPackageConfig(packageIndex, configKey, value + 1, min, max)
      }
    />
  );

  const renderCpuSchedulerControls = ({
    packageIndex,
    slots,
    matchesCores,
    embedded = false,
  }: {
    packageIndex: number;
    slots: number;
    matchesCores: boolean;
    embedded?: boolean;
  }) => {
    const slotStepper = (
      <BuilderStepper
        label={embedded ? "Sched Slots" : "Slots"}
        value={formatNumber(slots)}
        accent="violet"
        canDecrease={!matchesCores && slots > 0}
        canIncrease={!matchesCores && slots < BUILDER_MAX_CORES}
        onDecrease={() => updateCpuSchedulerSlots(packageIndex, slots - 1)}
        onIncrease={() => updateCpuSchedulerSlots(packageIndex, slots + 1)}
        disabledReason="Match cores is on"
      />
    );
    const matchToggle = (
      <label className="custom-builder-link-toggle custom-builder-scheduler-match-toggle">
        <input
          type="checkbox"
          checked={matchesCores}
          onChange={(event) => {
            setCpuSchedulerMatch(packageIndex, event.currentTarget.checked);
          }}
        />
        <span>Match cores</span>
      </label>
    );

    const controls = (
      <div className="hw-section-header-row scheduler-header-row">
        {embedded ? null : (
          <button
            type="button"
            className="hw-section-header"
            onClick={() => {
              setActiveSlotId(cpuEntry?.groupId ?? null);
              setActiveCpuPackageIndex(packageIndex);
            }}
          >
            <ListTodo size={14} />
            <span>Scheduler</span>
          </button>
        )}
        {slotStepper}
        {matchToggle}
      </div>
    );

    return embedded ? (
      <div className="custom-builder-cpu-scheduler custom-builder-cpu-card-scheduler">
        {controls}
      </div>
    ) : (
      <section className="hw-section scheduler-section custom-builder-cpu-scheduler">
        {controls}
      </section>
    );
  };

  const renderCpuSpecControls = ({
    packageIndex,
    config,
    clockHz,
  }: {
    packageIndex: number;
    config: (typeof cpuPackageConfigs)[number];
    clockHz: number;
  }) => (
    <div className="custom-builder-cpu-config-strip">
      {renderCpuConfigStepper({
        packageIndex,
        configKey: "coreCount",
        label: "Core",
        value: config.coreCount,
        display: formatNumber(config.coreCount),
        accent: "cyan",
        max: BUILDER_MAX_CORES,
      })}
      {renderCpuConfigStepper({
        packageIndex,
        configKey: "cpuLevel",
        label: "Freq",
        value: config.cpuLevel,
        display: formatClock(clockHz),
        accent: "cyan",
      })}
    </div>
  );

  const renderSchedulerSection = (entry: BuilderGroupEntry | null) => {
    if (!entry) return null;
    const slots = Math.max(0, entry.selectedTier?.schedulerSlots ?? 0);
    const selected = activeSlotId === entry.groupId;

    return (
      <section
        className={`hw-section scheduler-section system-scheduler-section ${
          selected ? "selected" : ""
        }`}
        data-slot={entry.groupId}
      >
        <div className="hw-section-header-row scheduler-header-row">
          <button
            type="button"
            className="hw-section-header custom-build-bay"
            data-slot={entry.groupId}
            onClick={() => setActiveSlotId(entry.groupId)}
            title={`Configure ${entry.groupLabel}`}
          >
            <ListTodo size={14} />
            <span>System Scheduler</span>
          </button>
          <span className="custom-builder-section-pill">
            <strong>{formatNumber(slots)}</strong> slots
          </span>
        </div>

        <div className="inline-upgrade-row custom-builder-upgrade-strip">
          {renderBuilderStepper({
            entry,
            metric: "schedulerSlots",
            label: "Slots",
            value: formatNumber(slots),
            accent: "violet",
          })}
        </div>
      </section>
    );
  };

  const renderMemorySection = (entry: BuilderGroupEntry | null) => {
    if (!entry) return null;
    const selected = activeSlotId === entry.groupId;
    const stickBits = ramStickCount > 0 ? ramBits / ramStickCount : 0;
    const ramChannelLabel = getRamChannelLabel(ramStickCount);
    const ramGrid = getRamStickGridMetrics(ramStickCount);
    const ramGridStyle = {
      "--ram-stick-grid-columns": ramGrid.columns,
    } as CSSProperties;

    return (
      <section
        className={`hw-section memory-section ${
          ramStickCount === 0 ? "install-hardware-section" : "good"
        } ${selected ? "selected" : ""}`}
        data-slot={entry.groupId}
      >
        <div className="ram-header-row">
          <button
            type="button"
            className="hw-section-header custom-build-bay"
            data-slot={entry.groupId}
            onClick={() => setActiveSlotId(entry.groupId)}
            title={`Configure ${entry.groupLabel}`}
          >
            <MemoryStick size={14} />
            <span>RAM</span>
            <span className="hw-section-meta">
              <strong>{formatBits(ramBits)}</strong> {ramChannelLabel} / Eff{" "}
              <strong>{ramEfficiencyLabel}</strong>
            </span>
          </button>
          <div className="ram-header-controls" aria-label="RAM stick count">
            {renderModifierStepper({
              keyName: "ramSticks",
              label: "Stick",
              value: ramStickCount,
              display: formatNumber(ramStickCount),
              accent: "green",
              max: BUILDER_MAX_RAM_STICKS,
            })}
          </div>
        </div>

        {renderClockTierControls(entry)}

        {ramStickCount > 0 ? (
          <>
            <div
              className="ram-stick-grid"
              style={ramGridStyle}
              data-grid={ramGrid.label}
            >
              {Array.from({ length: ramStickCount }, (_, stickIndex) => (
                <button
                  key={`ram-stick-${stickIndex + 1}`}
                  type="button"
                  className="ram-stick-module"
                  title={`R${stickIndex + 1} - ${formatBits(stickBits)} - ${formatClock(ramSpeed)} - Eff ${ramEfficiencyLabel}`}
                  onClick={() => setActiveSlotId(entry.groupId)}
                >
                  <span className="ram-stick-module-head">
                    <span className="ram-stick-label">R{stickIndex + 1}</span>
                    <span className="ram-stick-module-foot">
                      <span>{formatBits(stickBits)}</span>
                      <span className="ram-stick-foot-sep" aria-hidden="true">/</span>
                      <span>{formatClock(ramSpeed)}</span>
                    </span>
                    <span className="ram-stick-efficiency">
                      Eff <strong>{ramEfficiencyLabel}</strong>
                    </span>
                    <span className="ram-stick-module-pct">0%</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="core-control-strip cache-control-strip ram-control-strip custom-builder-upgrade-strip">
              {renderModifierStepper({
                keyName: "ramTierLevel",
                label: "Size",
                value: ramTierLevel,
                display: formatBits(ramBits),
                accent: "green",
              })}
              {renderModifierStepper({
                keyName: "ramSpeedTierLevel",
                label: "Freq",
                value: ramSpeedTierLevel,
                display: formatClock(ramSpeed),
                accent: "green",
              })}
            </div>
          </>
        ) : (
          <div className="install-hardware-body ram-install-hardware-body">
            <span className="install-hardware-copy">
              <strong>Open RAM bay</strong>
              <span>Choose tier</span>
            </span>
          </div>
        )}
      </section>
    );
  };

  const renderCpuSection = (entry: BuilderGroupEntry | null) => {
    if (!entry) return null;
    const selected = activeSlotId === entry.groupId;
    const manyCores =
      totalCores > 8 || cpuPackageConfigs.some((config) => config.coreCount > 8);

    return (
      <section
        className={`cpu-package custom-builder-cpu-package ${
          manyCores ? "many-cores" : ""
        } ${selected ? "selected" : ""}`}
        data-slot={entry.groupId}
      >
        <div className="cpu-package-header-row">
          <button
            type="button"
            className="cpu-package-header custom-build-bay"
            data-slot={entry.groupId}
            onClick={() => setActiveSlotId(entry.groupId)}
            title={`Configure ${entry.groupLabel}`}
          >
            <Cpu size={14} />
            <span>CPU</span>
            <span className="cpu-package-meta">
              <strong>{formatNumber(cpuPackageCount)}</strong> CPU
              {cpuPackageCount === 1 ? "" : "s"} /{" "}
              Eff{" "}
              <strong>
                {projectedEfficiency === null
                  ? "-"
                  : formatNumber(projectedEfficiency)}
              </strong>
            </span>
          </button>
          <div
            className="cpu-package-header-install custom-builder-cpu-header-controls"
            aria-label="CPU count"
          >
            <label className="custom-builder-link-toggle">
              <input
                type="checkbox"
                checked={cpuLinked}
                onChange={(event) => setCpuLinked(event.currentTarget.checked)}
              />
              <span>Link all CPUs</span>
            </label>
            {renderModifierStepper({
              keyName: "cpuPackages",
              label: "CPU",
              value: cpuPackageCount,
              display: formatNumber(cpuPackageCount),
              accent: "cyan",
              max: BUILDER_MAX_CPUS,
            })}
          </div>
        </div>

        {renderClockTierControls(entry)}

        <div className="cpu-package-body">
          {cpuLinked
            ? renderCpuSchedulerControls({
                packageIndex: activeCpuIndex,
                slots: activeCpuSchedulerSlots,
                matchesCores: activeCpuSchedulerMatchesCores,
              })
            : null}

          <div className={`core-cache-row ${manyCores ? "many-cores" : ""}`}>
            {cpuLinked ? (
              <section
                className="core-array-section custom-builder-cpu-config"
                aria-label="Linked CPU specs"
              >
                {renderCpuSpecControls({
                  packageIndex: activeCpuIndex,
                  config: activeCpuConfig,
                  clockHz: cpuClockHz,
                })}
              </section>
            ) : null}

            <div
              className="custom-builder-cpu-socket-grid"
              aria-label="CPU core arrays"
            >
              {cpuPackageConfigs.map((config, packageIndex) => {
                const packageSelected = packageIndex === activeCpuIndex;
                const packageClockHz = getPackageClockHz(config.cpuLevel);
                const packageEfficiency = getProjectedCpuEfficiency(
                  getPackageBaseEfficiency(config.cpuLevel),
                  cpuPackageCount,
                );
                const packageManyCores = config.coreCount > 8;
                const packageCoreGrid = getBuilderCoreGridMetrics(
                  config.coreCount,
                );
                const packageCoreGridStyle = {
                  "--core-grid-columns": packageCoreGrid.columns,
                } as CSSProperties;

                return (
                  <section
                    key={`cpu-socket-${packageIndex + 1}`}
                    className={`core-array-section custom-builder-core-array custom-builder-cpu-socket ${
                      packageManyCores ? "many-cores" : ""
                    } ${packageSelected ? "selected" : ""}`}
                    onClick={() => {
                      setActiveSlotId(entry.groupId);
                      setActiveCpuPackageIndex(packageIndex);
                    }}
                  >
                    <div className="core-array-header">
                      <button
                        type="button"
                        className="custom-builder-cpu-socket-title"
                        onClick={() => {
                          setActiveSlotId(entry.groupId);
                          setActiveCpuPackageIndex(packageIndex);
                        }}
                        aria-pressed={packageSelected}
                      >
                        CPU {packageIndex + 1}
                      </button>
                      <span className="core-array-efficiency">
                        {formatNumber(config.coreCount)} core
                        {config.coreCount === 1 ? "" : "s"} / Eff{" "}
                        <strong>{formatNumber(packageEfficiency)}</strong>
                      </span>
                    </div>

                    {!cpuLinked ? (
                      <div
                        className="custom-builder-cpu-card-controls"
                        aria-label={`CPU ${packageIndex + 1} controls`}
                      >
                        {renderCpuSchedulerControls({
                          packageIndex,
                          slots: Math.max(0, config.schedulerSlots),
                          matchesCores:
                            cpuPackageSchedulerMatches[packageIndex] ?? true,
                          embedded: true,
                        })}
                        <div className="custom-builder-cpu-config custom-builder-cpu-card-config">
                          {renderCpuSpecControls({
                            packageIndex,
                            config,
                            clockHz: packageClockHz,
                          })}
                        </div>
                      </div>
                    ) : null}

                    <div
                      className={`core-grid ${packageCoreGrid.density}`}
                      style={packageCoreGridStyle}
                      data-grid={packageCoreGrid.label}
                    >
                      {Array.from({ length: config.coreCount }, (_, coreIndex) => (
                        <div
                          key={`cpu-${packageIndex + 1}-core-${coreIndex + 1}`}
                          role="button"
                          tabIndex={0}
                          className="core-die"
                          title={`CPU ${packageIndex + 1} C${coreIndex + 1} - ${formatClock(packageClockHz)} - Idle`}
                          onClick={() => {
                            setActiveSlotId(entry.groupId);
                            setActiveCpuPackageIndex(packageIndex);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            setActiveSlotId(entry.groupId);
                            setActiveCpuPackageIndex(packageIndex);
                          }}
                          aria-pressed={packageSelected}
                        >
                          <span className="core-die-head">
                            <span className="core-status-dot" aria-hidden="true" />
                            <span className="core-label">C{coreIndex + 1}</span>
                            <span className="core-clock">
                              <strong>{formatClock(packageClockHz)}</strong>
                            </span>
                          </span>
                          <span className="core-work idle">Idle</span>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>

            <section className="hw-section cache-section">
              <button
                type="button"
                className="hw-section-header"
                onClick={() => setActiveSlotId(entry.groupId)}
              >
                <HardDrive size={14} />
                <span>Cache</span>
                <span className="hw-section-meta">
                  <strong>Idle</strong>
                </span>
              </button>
              <div className="cache-stat-row">
                <span className="stat cache-capacity-stat">
                  <small>Capacity</small>
                  <strong>0 b / {formatBits(cacheBits)}</strong>
                </span>
                <span className="stat cache-frequency-stat">
                  <small>Frequency</small>
                  <strong>{formatClock(cacheSpeedHz)}</strong>
                </span>
              </div>
              <div className="core-control-strip cache-control-strip custom-builder-upgrade-strip">
                {renderCpuConfigStepper({
                  configKey: "cacheLevel",
                  label: "Size",
                  value: activeCpuConfig.cacheLevel,
                  display: formatBits(cacheBits),
                  accent: "green",
                })}
                {renderCpuConfigStepper({
                  configKey: "cacheSpeedLevel",
                  label: "Freq",
                  value: activeCpuConfig.cacheSpeedLevel,
                  display: formatClock(cacheSpeedHz),
                  accent: "green",
                })}
              </div>
            </section>
          </div>
        </div>
      </section>
    );
  };

  const renderPsuSection = (entry: BuilderGroupEntry | null) => {
    if (!entry) return null;
    const selected = activeSlotId === entry.groupId;
    const stress =
      psuCapacityWatts > 0
        ? requiredPowerWatts / psuCapacityWatts
        : requiredPowerWatts > 0
          ? 1
          : 0;
    const stressPercent = `${formatNumber(Math.max(0, stress) * 100)}%`;

    return (
      <div className="system-rail">
        <section
          className={`hw-section psu-section ${powerMet ? "good" : "critical"} power-on ${
            selected ? "selected" : ""
          }`}
          data-slot={entry.groupId}
        >
          <div className="psu-header-row">
            <button
              type="button"
              className="hw-section-header custom-build-bay"
              data-slot={entry.groupId}
              onClick={() => setActiveSlotId(entry.groupId)}
              title={`Configure ${entry.groupLabel}`}
            >
              <Power size={14} />
              <span>PSU</span>
            </button>
          </div>

          <div className="psu-hero">
            <span className="psu-hero-stat psu-hero-draw-stat">
              <span className="psu-hero-draw">{formatWatts(requiredPowerWatts)}</span>
              <span className="psu-hero-capacity">
                <span className="psu-hero-divider">/</span>
                {formatWatts(psuCapacityWatts)}
              </span>
            </span>
            <span className="psu-hero-stat psu-hero-cost-stat">
              <span className="psu-hero-cost">
                {formatPowerRate(projectedRunCostPerSecond)}
              </span>
              <span className="psu-hero-cost-unit">cr/s</span>
            </span>
          </div>

          <div className="psu-load-row custom-builder-psu-load-row">
            <span className="psu-load-label">
              <strong>{stressPercent}</strong>
              <small>load</small>
            </span>
            <span className="custom-builder-psu-state">
              {powerMet ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
              {powerLabel}
            </span>
          </div>

          <div className="inline-upgrade-row custom-builder-upgrade-strip">
            {renderModifierStepper({
              keyName: "psuLevel",
              label: "Capacity",
              value: psuLevel,
              display: formatWatts(psuCapacityWatts),
              accent: "amber",
            })}
          </div>
        </section>
      </div>
    );
  };

  return (
    <section className="custom-system-builder" aria-label="Custom system builder">
      <header className="custom-system-builder-header">
        <h2>System Builder</h2>
        <span className="custom-system-builder-price">
          <span>Price</span>
          <ResourceCost costs={costs} compact resources={resources} />
        </span>
        <button
          type="button"
          className="custom-builder-buy"
          disabled={!canBuy}
          title={
            canBuy
              ? confirmingPurchase
                ? `Confirm custom system purchase: ${formatCost(costs)}`
                : `Review custom system purchase: ${formatCost(costs)}`
              : blockedReason
          }
          onClick={() => {
            if (!confirmingPurchase) {
              setConfirmingPurchase(true);
              return;
            }

            dispatch({
              type: "buyCustomSystem",
              tierIds: {
                ...selections,
                cpuPackages: String(cpuPackageCount),
                cpuCores: String(totalCores),
                cpuLevel: String(activeCpuConfig.cpuLevel),
                cacheLevel: String(activeCpuConfig.cacheLevel),
                cacheSpeedLevel: String(activeCpuConfig.cacheSpeedLevel),
                cpuLinked: cpuLinked ? "1" : "0",
                cpuSchedulerMatch: activeCpuSchedulerMatchesCores ? "1" : "0",
                cpuSchedulerSlots: String(totalCpuSchedulerSlots),
                cpuPackageCores: serializeIntegerList(
                  cpuPackageConfigs.map((config) => config.coreCount),
                ),
                cpuPackageLevels: serializeIntegerList(
                  cpuPackageConfigs.map((config) => config.cpuLevel),
                ),
                cpuPackageCacheLevels: serializeIntegerList(
                  cpuPackageConfigs.map((config) => config.cacheLevel),
                ),
                cpuPackageCacheSpeedLevels: serializeIntegerList(
                  cpuPackageConfigs.map((config) => config.cacheSpeedLevel),
                ),
                cpuPackageSchedulerSlots: serializeIntegerList(
                  cpuPackageConfigs.map((config) => config.schedulerSlots),
                ),
                cpuPackageSchedulerMatches: serializeBooleanList(
                  cpuPackageSchedulerMatches,
                ),
                ramSticks: String(ramStickCount),
                ramLevel: String(ramLevel),
                ramSpeedLevel: String(ramSpeedLevel),
                psuLevel: String(psuLevel),
              },
            });
            setConfirmingPurchase(false);
          }}
        >
          {canBuy ? <Plus size={12} /> : null}
          <span>
            {canBuy
              ? confirmingPurchase
                ? "Confirm purchase"
                : "Review build"
              : blockedReason}
          </span>
        </button>
      </header>

      <div className="custom-builder-system-preview system-board">
        <div className="system-board-flow custom-builder-system-flow">
          {renderSchedulerSection(schedulerEntry)}
          {renderMemorySection(memoryEntry)}
          {renderCpuSection(cpuEntry)}
          {renderPsuSection(powerEntry)}
        </div>
      </div>
    </section>
  );
}
