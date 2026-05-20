import { Minus, Plus } from "lucide-react";
import type { UpgradeId, VisibleState, VisibleUpgrade } from "../../game";
import { formatCost } from "../format";
import { ResourceCost } from "../ResourceTokens";
import type { Dispatch } from "../uiActions";

const getDowngradeTitle = (upgrade: VisibleUpgrade) =>
  upgrade.canDowngrade
    ? `Downgrade ${upgrade.name}: refund ${formatCost(upgrade.refunds)}`
    : (upgrade.downgradeBlockedReason ?? `${upgrade.name} is at minimum`);

export function UpgradeStepper({
  upgrade,
  dispatch,
  coreId,
  coreIds,
  cpuId,
  ramStickId,
  ramStickIds,
  label,
  className = "",
  resources,
}: {
  upgrade: VisibleUpgrade;
  dispatch: Dispatch;
  coreId?: number;
  coreIds?: number[];
  cpuId?: number;
  ramStickId?: number;
  ramStickIds?: number[];
  label?: string;
  className?: string;
  resources?: VisibleState["resources"];
}) {
  const buyTitle = `${upgrade.name}: ${formatCost(upgrade.costs)}`;
  const upgradeContext = {
    upgradeId: upgrade.id as UpgradeId,
    ...(coreId !== undefined ? { coreId } : {}),
    ...(coreIds !== undefined ? { coreIds } : {}),
    ...(cpuId !== undefined ? { cpuId } : {}),
    ...(ramStickId !== undefined ? { ramStickId } : {}),
    ...(ramStickIds !== undefined ? { ramStickIds } : {}),
  };
  const dispatchUpgrade = (type: "buyUpgrade" | "downgradeUpgrade") => {
    if (type === "buyUpgrade") {
      dispatch({ type: "buyUpgrade", ...upgradeContext });
      return;
    }

    dispatch({ type: "downgradeUpgrade", ...upgradeContext });
  };

  return (
    <div className={`upgrade-stepper ${upgrade.accent} ${className}`}>
      <button
        type="button"
        className="upgrade-stepper-button minus"
        disabled={!upgrade.canDowngrade}
        title={getDowngradeTitle(upgrade)}
        onClick={() => dispatchUpgrade("downgradeUpgrade")}
      >
        <Minus size={11} />
      </button>
      <span className="upgrade-stepper-spec" title={buyTitle}>
        <span>{label ?? upgrade.name}</span>
        <ResourceCost costs={upgrade.costs} compact resources={resources} />
      </span>
      <button
        type="button"
        className="upgrade-stepper-button plus"
        disabled={!upgrade.canAfford}
        title={buyTitle}
        onClick={() => dispatchUpgrade("buyUpgrade")}
      >
        <Plus size={11} />
      </button>
    </div>
  );
}

export function UpgradeChip({
  upgrade,
  dispatch,
  coreId,
  cpuId,
  ramStickId,
  ramStickIds,
  label,
  control = false,
  resources,
}: {
  upgrade: VisibleUpgrade;
  dispatch: Dispatch;
  coreId?: number;
  cpuId?: number;
  ramStickId?: number;
  ramStickIds?: number[];
  label?: string;
  control?: boolean;
  resources?: VisibleState["resources"];
}) {
  return (
    <UpgradeStepper
      upgrade={upgrade}
      dispatch={dispatch}
      coreId={coreId}
      cpuId={cpuId}
      ramStickId={ramStickId}
      ramStickIds={ramStickIds}
      label={label}
      className={control ? "control-stepper" : "chip-stepper"}
      resources={resources}
    />
  );
}

export function InlineUpgradeRow({
  upgrades,
  resources,
  dispatch,
  cpuId,
}: {
  upgrades: VisibleUpgrade[];
  resources: VisibleState["resources"];
  dispatch: Dispatch;
  cpuId?: number;
}) {
  if (upgrades.length === 0) return null;

  return (
    <div className="inline-upgrade-row" aria-label="Upgrades">
      {upgrades.map((upgrade) => (
        <UpgradeStepper
          key={upgrade.id}
          upgrade={upgrade}
          dispatch={dispatch}
          cpuId={cpuId}
          label={upgrade.name}
          className="inline-stepper"
          resources={resources}
        />
      ))}
    </div>
  );
}
