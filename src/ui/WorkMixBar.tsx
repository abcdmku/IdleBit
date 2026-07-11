import type { VisibleWorkMixStage } from "../game";
import { amountToSafeNumber } from "../game";
import { formatNumber } from "./format";

const LANE_LABELS: Record<VisibleWorkMixStage["resource"], string> = {
  compute: "CPU",
  cache: "cache",
  ram: "RAM",
  storageRead: "storage read",
  storageWrite: "storage write",
  networkIngress: "network in",
  networkEgress: "network out",
};

const LANE_CLASSES: Record<VisibleWorkMixStage["resource"], string> = {
  compute: "cpu",
  cache: "cache",
  ram: "ram",
  storageRead: "storage",
  storageWrite: "storage",
  networkIngress: "network",
  networkEgress: "network",
};

/** Log-compressed share so huge compute volumes don't hide small lanes. */
const mixWeight = (value: number) => (value > 0 ? Math.log2(1 + value) : 0);

/**
 * "What will this consume": a slim bar whose colored segments are
 * proportional to the authored per-lane work (cyan CPU, green cache,
 * violet RAM, amber storage, rose network). Exact volumes live in the
 * tooltip; shares the .task-recipe-bar treatment tasks already use.
 */
export function WorkMixBar({ stages }: { stages?: VisibleWorkMixStage[] }) {
  if (!stages || stages.length === 0) return null;
  const weighted = stages
    .map((stage) => ({
      ...stage,
      amount: amountToSafeNumber(stage.work),
    }))
    .filter((stage) => stage.amount > 0);
  if (weighted.length === 0) return null;

  const title = `Work mix: ${weighted
    .map((stage) => `${LANE_LABELS[stage.resource]} ${formatNumber(stage.amount)}`)
    .join(" · ")}`;

  return (
    <span className="task-recipe-bar work-mix-bar" title={title} aria-label={title}>
      {weighted.map((stage, index) => (
        <span
          className={`recipe-seg ${LANE_CLASSES[stage.resource]}`}
          style={{ flexGrow: mixWeight(stage.amount) }}
          key={`${stage.resource}-${index}`}
        />
      ))}
    </span>
  );
}
