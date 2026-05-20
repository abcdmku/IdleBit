import { Database, Zap, type LucideIcon } from "lucide-react";
import type { VisibleState } from "../game";
import {
  formatNumber,
  type DisplayCost,
} from "./format";

export type ResourceKind = "data" | "credits";

const resourceVisuals: Record<
  ResourceKind,
  { label: string; Icon: LucideIcon }
> = {
  data: { label: "data", Icon: Database },
  credits: { label: "credits", Icon: Zap },
};

const isResourceKind = (resource: string): resource is ResourceKind =>
  resource === "data" || resource === "credits";

export function ResourceAmount({
  resource,
  amount,
  plus = false,
  showLabel = true,
  compact = false,
  dimmed = false,
}: {
  resource: ResourceKind;
  amount: number;
  plus?: boolean;
  showLabel?: boolean;
  compact?: boolean;
  dimmed?: boolean;
}) {
  const { Icon, label } = resourceVisuals[resource];

  return (
    <span
      className={`resource-token ${resource} ${compact ? "compact" : ""} ${
        dimmed ? "dimmed" : ""
      }`}
    >
      <Icon size={compact ? 13 : 14} />
      <strong>
        {plus ? "+" : ""}
        {formatNumber(amount)}
      </strong>
      {showLabel && <span>{label}</span>}
    </span>
  );
}

export function ResourceCost({
  costs,
  compact = false,
  resources,
}: {
  costs: DisplayCost[];
  compact?: boolean;
  resources?: VisibleState["resources"];
}) {
  if (costs.length === 0) return <span className="resource-cost empty">Open</span>;

  return (
    <span className={`resource-cost ${compact ? "compact" : ""}`}>
      {costs.map((cost, index) => {
        const key = `${cost.resource}-${index}`;

        if (!isResourceKind(cost.resource)) {
          return (
            <span className="resource-token unknown" key={key}>
              <strong>{formatNumber(cost.amount)}</strong>
              <span>{cost.resource}</span>
            </span>
          );
        }

        return (
          <ResourceAmount
            key={key}
            resource={cost.resource}
            amount={cost.amount}
            compact={compact}
            showLabel={!compact}
            dimmed={resources ? cost.amount > resources[cost.resource] : false}
          />
        );
      })}
    </span>
  );
}
