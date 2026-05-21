import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { VisibleState } from "../../game";
import { formatBits, formatCost, formatNumber, formatWatts } from "../format";
import { firstBits, firstBoolean, firstNumber } from "../panels/uiNumbers";
import { ResourceCost } from "../ResourceTokens";
import type { Dispatch } from "../uiActions";
import {
  builderGroupIconFor,
  getBuilderGroupId,
  getBuilderGroupLabel,
  getBuilderGroupOption,
  getBuilderGroups,
  getBuilderSelections,
  formatModuleStats,
  getModuleStats,
  getRecordCosts,
  getSelectedBuilderTiers,
  getTierId,
  sumCosts,
  summarizeTier,
} from "./builderHelpers";
import type { UiCustomMachineBuilder } from "./types";

interface CustomSystemBuilderProps {
  builder: UiCustomMachineBuilder | null;
  resources: VisibleState["resources"];
  dispatch: Dispatch;
}

const formatModuleOptionTitle = (summary: string, costs: ReturnType<typeof getRecordCosts>) =>
  costs.length > 0 ? `${summary}: ${formatCost(costs)}` : summary;

export function CustomSystemBuilder({
  builder,
  resources,
  dispatch,
}: CustomSystemBuilderProps) {
  const groups = getBuilderGroups(builder);
  const groupsKey = groups
    .map((group, groupIndex) => {
      const groupId = getBuilderGroupId(group, groupIndex);
      const optionIds = (group.tiers ?? group.options ?? []).map(getTierId).join(",");
      return `${groupId}:${optionIds}`;
    })
    .join("|");
  const [selections, setSelections] = useState<Record<string, string>>(() =>
    getBuilderSelections(groups, {}),
  );
  const initialActiveSlot = groups[0]
    ? getBuilderGroupId(groups[0], 0)
    : null;
  const [activeSlotId, setActiveSlotId] = useState<string | null>(
    initialActiveSlot,
  );
  const [confirmingPurchase, setConfirmingPurchase] = useState(false);

  useEffect(() => {
    setSelections((current) => getBuilderSelections(groups, current));
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

  const selectedTiers = getSelectedBuilderTiers(groups, selections);
  const cpuPackageCount =
    selections.cpuPackages === "8"
      ? 8
      : selections.cpuPackages === "4"
        ? 4
        : selections.cpuPackages === "2"
          ? 2
          : 1;
  const selectedCpuTier = getBuilderGroupOption(groups, selections, "cpu");
  const costs =
    getRecordCosts(builder).length > 0
      ? getRecordCosts(builder)
      : sumCosts(selectedTiers.map(getRecordCosts));
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
  const totalCores =
    (firstNumber(selectedCpuTier?.cores, selectedCpuTier?.coreCount) ?? 0) *
    cpuPackageCount;
  const totalRamBits = selectedTiers.reduce(
    (total, tier) => total + firstBits([tier.ramBits], [tier.ramBytes]),
    0,
  );
  const totalPower = selectedTiers.reduce(
    (total, tier) => total + (tier.powerDeltaWatts ?? 0),
    0,
  );

  const activeGroup = groups.find(
    (group, index) => getBuilderGroupId(group, index) === activeSlotId,
  );
  const activeGroupIndex = activeGroup
    ? groups.findIndex(
        (group, index) => getBuilderGroupId(group, index) === activeSlotId,
      )
    : -1;
  const activeOptions = activeGroup
    ? activeGroup.tiers ?? activeGroup.options ?? []
    : [];

  return (
    <section className="custom-system-builder" aria-label="Custom system builder">
      <div className="custom-system-board" role="tablist">
        {groups.map((group, groupIndex) => {
          const groupId = getBuilderGroupId(group, groupIndex);
          const groupLabel = getBuilderGroupLabel(group, groupIndex);
          const options = group.tiers ?? group.options ?? [];
          const selectedTierId = selections[groupId];
          const selectedTier = options.find(
            (tier, tierIndex) => getTierId(tier, tierIndex) === selectedTierId,
          );
          const Icon = builderGroupIconFor(groupId);
          const isActive = activeSlotId === groupId;
          const summary = selectedTier
            ? formatModuleStats(groupId, getModuleStats(groupId, selectedTier)) ||
              summarizeTier(selectedTier)
            : "Choose";

          return (
            <button
              key={groupId}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`custom-system-bay ${isActive ? "active" : ""}`}
              data-slot={groupId}
              onClick={() => setActiveSlotId(groupId)}
              title={`Configure ${groupLabel}`}
            >
              <span className="custom-system-bay-label">
                <Icon size={11} />
                <span>{groupLabel}</span>
              </span>
              <span className="custom-system-bay-summary">{summary}</span>
            </button>
          );
        })}
      </div>

      {activeGroup && (
        <div className="custom-system-module-picker">
          <header className="custom-system-module-header">
            <span>
              Choose{" "}
              {getBuilderGroupLabel(activeGroup, activeGroupIndex)} module
            </span>
          </header>
          {getBuilderGroupId(activeGroup, activeGroupIndex) === "cpu" && (
            <div className="custom-cpu-package-count" aria-label="CPU package count">
              <span>CPU count</span>
              <div className="custom-cpu-package-options" role="group">
                {[1, 2, 4, 8].map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={cpuPackageCount === count ? "active" : ""}
                    aria-pressed={cpuPackageCount === count}
                    onClick={() => {
                      setConfirmingPurchase(false);
                      setSelections((current) => ({
                        ...current,
                        cpuPackages: String(count),
                      }));
                    }}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="custom-system-modules">
            {activeOptions.map((tier, tierIndex) => {
              const activeGroupId = getBuilderGroupId(activeGroup, activeGroupIndex);
              const tierId = getTierId(tier, tierIndex);
              const selected =
                selections[activeGroupId] === tierId;
              const tierCosts = getRecordCosts(tier);
              const moduleStats = getModuleStats(activeGroupId, tier);
              const moduleSpecSummary =
                formatModuleStats(activeGroupId, moduleStats) ||
                summarizeTier(tier) ||
                "-";
              const optionTitle = formatModuleOptionTitle(
                moduleSpecSummary.replace(/\n/g, " / ") || "Module",
                tierCosts,
              );
              const disabled =
                tier.disabled ||
                firstBoolean(tier.canSelect) === false;

              return (
                <button
                  key={tierId}
                  type="button"
                  className={`custom-tier-option custom-system-module ${
                    selected ? "selected" : ""
                  }`}
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => {
                    setConfirmingPurchase(false);
                    setSelections((current) => ({
                      ...current,
                      [activeGroupId]: tierId,
                    }));
                  }}
                  title={
                    disabled
                      ? tier.blockedReason ?? "Locked"
                      : optionTitle
                  }
                >
                  <span className="custom-system-module-specs">
                    {moduleSpecSummary}
                  </span>
                  {tierCosts.length > 0 && (
                    <span className="custom-system-module-cost">
                      <ResourceCost
                        costs={tierCosts}
                        compact
                        resources={resources}
                      />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <footer className="custom-system-summary">
        <div className="custom-system-totals">
          <span className="custom-system-total">
            <span className="custom-system-total-label">CPU</span>
            <span>{formatNumber(totalCores)}C</span>
          </span>
          {totalRamBits > 0 && (
            <span className="custom-system-total">
              <span className="custom-system-total-label">RAM</span>
              <span>{formatBits(totalRamBits)}</span>
            </span>
          )}
          {totalPower !== 0 && (
            <span className="custom-system-total">
              <span className="custom-system-total-label">PWR</span>
              <span>{totalPower > 0 ? "+" : ""}{formatWatts(totalPower)}</span>
            </span>
          )}
        </div>
        <div className="custom-system-buy">
          <ResourceCost costs={costs} compact resources={resources} />
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
        </div>
      </footer>
    </section>
  );
}
