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
  getRamBits,
  getRamSpeedMt,
} from "../../game/progression";
import type { VisibleState } from "../../game";
import {
  formatBits,
  formatClock,
  formatCost,
  formatNumber,
  formatWatts,
  type DisplayCost,
} from "../format";
import { QueuePreview } from "../hardware/QueuePreview";
import { getCoreGridMetrics } from "../hardware/coreGrid";
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
}

type BuilderBayRole = "scheduler" | "memory" | "cpu" | "power" | "other";

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
const BUILDER_MAX_CORES = 8;
const BUILDER_MAX_RAM_STICKS = 8;
const BUILDER_MAX_LEVEL = 36;

const getBuildCosts = (
  entries: Array<{ groupId: string; tier: UiCustomMachineTier }>,
  cpuCoreCount: number,
  ramStickCount: number,
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

const getProjectedCpuEfficiency = (
  cpuTier: UiCustomMachineTier | null,
  cpuPackageCount: number,
) =>
  cpuTier?.cpuEfficiency === undefined
    ? null
    : cpuTier.cpuEfficiency * 0.75 ** Math.max(0, cpuPackageCount - 1);

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

const getProjectedRamWatts = (
  stickCount: number,
  ramLevel: number,
  ramSpeedLevel: number,
  ramSpeedMt: number,
) => {
  const stickEfficiency = getRamTierLevelDefinition(ramSpeedLevel).efficiency;
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

const formatClockTierLabel = (tierId: ClockTierId) => CLOCK_TIER_LABELS[tierId];

function BuilderStepper({
  label,
  value,
  accent,
  canDecrease,
  canIncrease,
  onDecrease,
  onIncrease,
}: {
  label: string;
  value: string;
  accent: "cyan" | "green" | "violet" | "amber";
  canDecrease: boolean;
  canIncrease: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className={`upgrade-stepper ${accent} custom-builder-stepper`}>
      <button
        type="button"
        className="upgrade-stepper-button minus"
        disabled={!canDecrease}
        title={canDecrease ? `Decrease ${label}` : `${label}: Min`}
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
        title={canIncrease ? `Increase ${label}` : `${label}: Max`}
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
  const [selections, setSelections] = useState<Record<string, string>>(() =>
    getSystemBuilderSelections(groups, {}),
  );
  const initialActiveSlot = groups[0]
    ? getBuilderGroupId(groups[0], 0)
    : null;
  const [activeSlotId, setActiveSlotId] = useState<string | null>(
    initialActiveSlot,
  );
  const [confirmingPurchase, setConfirmingPurchase] = useState(false);

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
  const machineSelection =
    cpuEntry &&
    memoryEntry &&
    schedulerEntry &&
    powerEntry
      ? {
          cpu: selections[cpuEntry.groupId] ?? "",
          cpuPackageCount: 1,
          cpuCoreCount,
          cpuLevel,
          cacheLevel,
          cacheSpeedLevel,
          ram: selections[memoryEntry.groupId] ?? "",
          ramStickCount,
          ramLevel,
          ramSpeedLevel,
          scheduler: selections[schedulerEntry.groupId] ?? "",
          psu: selections[powerEntry.groupId] ?? "",
        }
      : null;
  const moduleCosts =
    machineSelection !== null
      ? (() => {
          try {
            return getMachineSelectionCost(machineSelection);
          } catch {
            return getBuildCosts(selectedEntries, cpuCoreCount, ramStickCount);
          }
        })()
      : getBuildCosts(selectedEntries, cpuCoreCount, ramStickCount);
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
  const totalCores = cpuCoreCount;
  const cpuClockHz =
    cpuClockTierId === null ? (selectedCpuTier?.clockHz ?? 0) : getCpuClockHz(cpuClockTierId, cpuLevel);
  const cacheBits = getCacheBits(cacheLevel);
  const cacheSpeedHz =
    cpuClockTierId === null
      ? (selectedCpuTier?.cacheSpeedHz ?? 0)
      : getCpuClockHz(cpuClockTierId, cacheSpeedLevel);
  const ramBits = getRamBits(ramLevel) * ramStickCount;
  const ramSpeed = getRamSpeedMt(ramSpeedLevel);
  const cpuEfficiency =
    cpuClockTierId === null
      ? (selectedCpuTier?.cpuEfficiency ?? 1)
      : getCpuTierLevelDefinition(cpuClockTierId, cpuLevel).efficiency;
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
    getProjectedCpuWatts(totalCores, cpuClockHz, cpuEfficiency) +
      getProjectedCacheWatts(cacheLevel, cacheSpeedLevel) +
      getProjectedRamWatts(ramStickCount, ramLevel, ramSpeedLevel, ramSpeed) +
      otherRequiredPowerWatts,
  );
  const psuCapacityWatts =
    firstNumber(
      ...selectedEntries
        .filter(({ groupId }) => isPsuGroup(groupId))
        .flatMap(({ tier }) => [tier.psuWatts, tier.powerDeltaWatts]),
    ) ?? 0;
  const powerMet = requiredPowerWatts <= psuCapacityWatts + POWER_MATCH_EPSILON;
  const powerLabel = powerMet ? "Met" : "Short";
  const projectedEfficiency = getProjectedCpuEfficiency(selectedCpuTier, 1);
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
  }: {
    keyName: string;
    label: string;
    value: number;
    display: string;
    accent: "cyan" | "green" | "violet" | "amber";
    min?: number;
    max?: number;
  }) => (
    <BuilderStepper
      label={label}
      value={display}
      accent={accent}
      canDecrease={value > min}
      canIncrease={value < max}
      onDecrease={() => setSelectionNumber(keyName, value - 1, min, max)}
      onIncrease={() => setSelectionNumber(keyName, value + 1, min, max)}
    />
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

        <QueuePreview
          items={[]}
          slotCapacity={slots}
          ariaLabel="Custom system scheduler queue"
          dispatch={dispatch}
          emptyLabel={slots > 0 ? `${formatNumber(slots)} slots open` : "No slots"}
          startSmall
        />

        <div className="inline-upgrade-row custom-builder-upgrade-strip">
          {renderBuilderStepper({
            entry,
            metric: "schedulerSlots",
            label: "Slots",
            value: `${formatNumber(slots)} slot${slots === 1 ? "" : "s"}`,
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
              <strong>{formatBits(ramBits)}</strong> build
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
            <div className="ram-pipeline-summary">
              <span>Ch {Math.min(ramStickCount, 2)}/{Math.max(ramStickCount, 1)}</span>
              <span>Write {formatClock(ramSpeed)}</span>
            </div>

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
                  title={`R${stickIndex + 1} - ${formatBits(stickBits)} - ${formatClock(ramSpeed)}`}
                  onClick={() => setActiveSlotId(entry.groupId)}
                >
                  <span className="ram-stick-module-head">
                    <span className="ram-stick-label">R{stickIndex + 1}</span>
                    <span className="ram-stick-module-foot">
                      <span>{formatBits(stickBits)}</span>
                      <span className="ram-stick-foot-sep" aria-hidden="true">/</span>
                      <span>{formatClock(ramSpeed)}</span>
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
    const coreCount = Math.max(1, totalCores);
    const coreGrid = getCoreGridMetrics(coreCount);
    const coreGridStyle = {
      "--core-grid-columns": coreGrid.columns,
    } as CSSProperties;
    const cpuSchedulerSlots = Math.max(0, totalCores);

    return (
      <section
        className={`cpu-package ${selected ? "selected" : ""}`}
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
              Eff{" "}
              <strong>
                {projectedEfficiency === null
                  ? "-"
                  : formatNumber(projectedEfficiency)}
              </strong>
            </span>
          </button>
        </div>

        {renderClockTierControls(entry)}

        <div className="cpu-package-body">
          <section className="hw-section scheduler-section custom-builder-cpu-scheduler">
            <div className="hw-section-header-row scheduler-header-row">
              <button
                type="button"
                className="hw-section-header"
                onClick={() => setActiveSlotId(entry.groupId)}
              >
                <ListTodo size={14} />
                <span>Scheduler</span>
              </button>
              <span className="custom-builder-section-pill">
                <strong>{formatNumber(cpuSchedulerSlots)}</strong> slots
              </span>
            </div>
            <QueuePreview
              items={[]}
              slotCapacity={cpuSchedulerSlots}
              ariaLabel="Custom CPU scheduler queue"
              dispatch={dispatch}
              emptyLabel={
                cpuSchedulerSlots > 0
                  ? `${formatNumber(cpuSchedulerSlots)} CPU slots open`
                  : "No slots"
              }
              startSmall
            />
          </section>

          <div className="core-cache-row">
            <section className="core-array-section">
              <div className="core-array-header">
                <span>Cores</span>
                <span className="core-array-efficiency">
                  {formatNumber(totalCores)} core{totalCores === 1 ? "" : "s"}
                </span>
                <div className="core-array-header-controls" aria-label="Core count">
                  {renderModifierStepper({
                    keyName: "cpuCores",
                    label: "Core",
                    value: totalCores,
                    display: formatNumber(totalCores),
                    accent: "cyan",
                    max: BUILDER_MAX_CORES,
                  })}
                </div>
              </div>

              <div
                className={`core-grid ${coreGrid.density}`}
                style={coreGridStyle}
                data-grid={coreGrid.label}
              >
                {Array.from({ length: coreCount }, (_, coreIndex) => (
                  <div
                    key={`core-${coreIndex + 1}`}
                    role="button"
                    tabIndex={0}
                    className="core-die"
                    title={`C${coreIndex + 1} - ${formatClock(cpuClockHz)} - Idle`}
                    onClick={() => setActiveSlotId(entry.groupId)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setActiveSlotId(entry.groupId);
                    }}
                    aria-pressed={selected}
                  >
                    <span className="core-die-head">
                      <span className="core-status-dot" aria-hidden="true" />
                      <span className="core-label">C{coreIndex + 1}</span>
                      <span className="core-clock">
                        <strong>{formatClock(cpuClockHz)}</strong>
                      </span>
                    </span>
                    <span className="core-work idle">Idle</span>
                  </div>
                ))}
              </div>

              <div className="core-control-strip custom-builder-upgrade-strip">
                {renderModifierStepper({
                  keyName: "cpuLevel",
                  label: "Core Freq",
                  value: cpuLevel,
                  display: formatClock(cpuClockHz),
                  accent: "cyan",
                })}
              </div>
            </section>

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
                {renderModifierStepper({
                  keyName: "cacheLevel",
                  label: "Size",
                  value: cacheLevel,
                  display: formatBits(cacheBits),
                  accent: "green",
                })}
                {renderModifierStepper({
                  keyName: "cacheSpeedLevel",
                  label: "Freq",
                  value: cacheSpeedLevel,
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
            {renderBuilderStepper({
              entry,
              metric: "psuCapacity",
              label: "Capacity",
              value: formatWatts(psuCapacityWatts),
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
                cpuPackages: "1",
                cpuCores: String(totalCores),
                cpuLevel: String(cpuLevel),
                cacheLevel: String(cacheLevel),
                cacheSpeedLevel: String(cacheSpeedLevel),
                ramSticks: String(ramStickCount),
                ramLevel: String(ramLevel),
                ramSpeedLevel: String(ramSpeedLevel),
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
