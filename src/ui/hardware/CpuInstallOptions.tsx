import { Cpu, Plus } from "lucide-react";
import type { VisibleState, VisibleUpgrade } from "../../game";
import { formatCost, formatWatts } from "../format";
import { ResourceCost } from "../ResourceTokens";
import type { Dispatch } from "../uiActions";

export function EmptySocketSection({
  selected,
  onSelect,
  upgrades,
  resources,
  dispatch,
}: {
  selected: boolean;
  onSelect: () => void;
  upgrades: VisibleUpgrade[];
  resources: VisibleState["resources"];
  dispatch: Dispatch;
}) {
  return (
    <section
      className={`hw-section cpu-section ${selected ? "selected" : ""}`}
    >
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <Cpu size={14} />
        <span>CPU Socket</span>
        <span className="hw-section-meta">Empty</span>
      </button>
      <div className="empty-socket">
        <strong>Install CPU</strong>
        <small>Install this system's CPU tier at level 1.</small>
      </div>
      <CpuInstallOptions
        upgrades={upgrades}
        resources={resources}
        dispatch={dispatch}
      />
    </section>
  );
}

const getCpuInstallDescription = (upgrade: VisibleUpgrade) =>
  upgrade.id === "matchedCpu" ? "Hidden legacy package" : "Matching tier L1 package";

export function CpuInstallOptions({
  upgrades,
  resources,
  dispatch,
  variant = "body",
}: {
  upgrades: VisibleUpgrade[];
  resources: VisibleState["resources"];
  dispatch: Dispatch;
  variant?: "body" | "header";
}) {
  const socketUpgrades = upgrades
    .filter((upgrade) => upgrade.id === "secondCpu" || upgrade.id === "matchedCpu")
    .sort((left, right) =>
      left.id === "secondCpu" && right.id === "matchedCpu" ? -1 : 0,
    );

  if (socketUpgrades.length === 0) return null;

  return (
    <div
      className={`cpu-install-options ${variant}`}
      aria-label="CPU install options"
    >
      {socketUpgrades.map((upgrade) => {
        const buyTitle = `${upgrade.name}: ${formatCost(upgrade.costs)}`;
        const powerDelta =
          upgrade.powerDeltaWatts === null || upgrade.powerDeltaWatts === undefined
            ? null
            : upgrade.powerDeltaWatts;

        return (
          <button
            key={upgrade.id}
            type="button"
            className={`cpu-install-option ${upgrade.accent}`}
            disabled={!upgrade.canAfford}
            title={buyTitle}
            onClick={() =>
              dispatch({
                type: "buyUpgrade",
                upgradeId: upgrade.id,
              })
            }
          >
            <span className="cpu-install-copy">
              <strong>{upgrade.name}</strong>
              <small>{getCpuInstallDescription(upgrade)}</small>
            </span>
            {powerDelta !== null && (
              <span className="cpu-install-power">
                <small>power</small>
                <strong>+{formatWatts(powerDelta)}</strong>
              </span>
            )}
            <ResourceCost costs={upgrade.costs} compact resources={resources} />
            <Plus size={12} />
          </button>
        );
      })}
    </div>
  );
}

