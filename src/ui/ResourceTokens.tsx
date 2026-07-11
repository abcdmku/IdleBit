import { Database, Zap, type LucideIcon } from "lucide-react";
import {
  amountCompare,
  type Amount,
  type ExactCost,
  type ExactResourceBag,
  type VisibleState,
} from "../game";
import {
  formatDisplayCostAmount,
  formatExactResourceAmount,
  formatResourceAmount,
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
        {formatResourceAmount(amount)}
      </strong>
      {showLabel && <span>{label}</span>}
    </span>
  );
}

export function ResourceCost({
  costs,
  compact = false,
  resources,
  emptyLabel = "Open",
}: {
  costs: DisplayCost[];
  compact?: boolean;
  resources?: VisibleState["resources"];
  emptyLabel?: string;
}) {
  if (costs.length === 0) {
    return <span className="resource-cost empty">{emptyLabel}</span>;
  }

  return (
    <span className={`resource-cost ${compact ? "compact" : ""}`}>
      {costs.map((cost, index) => {
        const key = `${cost.resource}-${index}`;

        if (!isResourceKind(cost.resource)) {
          return (
            <span className="resource-token unknown" key={key}>
              <strong>{formatDisplayCostAmount(cost)}</strong>
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

export function ExactResourceAmount({
  resource,
  amount,
  plus = false,
  showLabel = true,
  compact = false,
  dimmed = false,
}: {
  resource: ResourceKind;
  amount: Amount;
  plus?: boolean;
  showLabel?: boolean;
  compact?: boolean;
  dimmed?: boolean;
}) {
  const { Icon, label } = resourceVisuals[resource];
  const prefix = plus ? "+" : "";
  // Keep the machine-readable resource key in the accessible label. This
  // makes exact cost controls stable across visual title-casing changes.
  const canonicalLabel = `${prefix}${amount} ${resource}`;

  return (
    <span
      className={`resource-token ${resource} ${compact ? "compact" : ""} ${
        dimmed ? "dimmed" : ""
      }`}
      title={`${amount} ${resource}`}
      role="group"
      aria-label={canonicalLabel}
    >
      <Icon size={compact ? 13 : 14} aria-hidden="true" />
      <strong aria-hidden="true">
        {prefix}
        {formatExactResourceAmount(amount)}
      </strong>
      {showLabel && <span aria-hidden="true">{label}</span>}
    </span>
  );
}

export function ExactResourceCost({
  costs,
  compact = false,
  resources,
  emptyLabel = "Open",
}: {
  costs: ExactCost[];
  compact?: boolean;
  resources?: ExactResourceBag;
  emptyLabel?: string;
}) {
  if (costs.length === 0) {
    return <span className="resource-cost empty">{emptyLabel}</span>;
  }

  return (
    <span className={`resource-cost ${compact ? "compact" : ""}`}>
      {costs.map((cost, index) => (
        <ExactResourceAmount
          key={`${cost.resource}-${index}`}
          resource={cost.resource}
          amount={cost.amount}
          compact={compact}
          showLabel={!compact}
          dimmed={
            resources
              ? amountCompare(cost.amount, resources[cost.resource]) > 0
              : false
          }
        />
      ))}
    </span>
  );
}
