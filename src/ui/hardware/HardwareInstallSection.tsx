import type { ReactNode } from "react";
import { Plus, type LucideIcon } from "lucide-react";
import type { UpgradeId, VisibleState, VisibleUpgrade } from "../../game";
import { formatCost } from "../format";
import { ResourceCost } from "../ResourceTokens";
import type { Dispatch } from "../uiActions";

export function LockedSystemSection({
  className,
  Icon,
  title,
  note,
  selected = false,
  onSelect,
  children,
}: {
  className: string;
  Icon: LucideIcon;
  title: string;
  note: string;
  selected?: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <section
      className={`hw-section locked-system-section ${className} ${
        selected ? "selected" : ""
      }`}
    >
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <Icon size={14} />
        <span>{title}</span>
        <span className="hw-section-meta">
          <strong>Locked</strong>
        </span>
      </button>
      <small className="locked-system-note">{note}</small>
      {children}
    </section>
  );
}

export function HardwareInstallSection({
  className,
  Icon,
  title,
  note,
  upgrade,
  selected = false,
  onSelect,
  dispatch,
  resources,
  cpuId,
}: {
  className: string;
  Icon: LucideIcon;
  title: string;
  note: string;
  upgrade?: VisibleUpgrade | null;
  selected?: boolean;
  onSelect: () => void;
  dispatch: Dispatch;
  resources: VisibleState["resources"];
  cpuId?: number;
}) {
  const buyTitle = upgrade
    ? `Install ${upgrade.name}: ${formatCost(upgrade.costs)}`
    : note;

  return (
    <section
      className={`hw-section install-hardware-section ${className} ${
        selected ? "selected" : ""
      }`}
    >
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <Icon size={14} />
        <span>{title}</span>
        <span className="hw-section-meta">
          <strong>Open bay</strong>
        </span>
      </button>
      <div className="install-hardware-body">
        <span className="install-hardware-copy">
          <strong>{note}</strong>
          {upgrade && (
            <ResourceCost costs={upgrade.costs} compact resources={resources} />
          )}
        </span>
        {upgrade && (
          <button
            type="button"
            className="install-hardware-button"
            disabled={!upgrade.canAfford}
            title={buyTitle}
            onClick={() =>
              dispatch({
                type: "buyUpgrade",
                upgradeId: upgrade.id as UpgradeId,
                ...(cpuId !== undefined ? { cpuId } : {}),
              })
            }
          >
            <Plus size={12} />
            <span>Install</span>
          </button>
        )}
      </div>
    </section>
  );
}
