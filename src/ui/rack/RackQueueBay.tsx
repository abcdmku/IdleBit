import type { CSSProperties } from "react";
import { formatNumber } from "../format";
import { formatPercent } from "./rackFormatting";
import { getRackPipIndexes, getRackQueueGridMetrics } from "./rackMetrics";
import type { RackQueueDisplayItem } from "./types";

interface RackQueueBayProps {
  items: RackQueueDisplayItem[];
  slotCount: number;
}

export function RackQueueBay({ items, slotCount }: RackQueueBayProps) {
  const queueMetrics = getRackQueueGridMetrics(slotCount);

  return (
    <span
      className="rack-component-bay rack-component-bay--scheduler"
      title={`${items.length} queued or active scheduler entries across ${slotCount} queue slots`}
      aria-label={`${items.length} queued or active scheduler entries across ${slotCount} queue slots`}
    >
      <span
        className={`rack-queue-slots rack-system-queue-slots ${queueMetrics.density}`}
        style={
          {
            "--rack-queue-columns": queueMetrics.columns,
            "--rack-queue-size": `${queueMetrics.size}px`,
            "--rack-queue-gap": `${queueMetrics.gap}px`,
          } as CSSProperties
        }
        aria-hidden="true"
      >
        {getRackPipIndexes(slotCount).map((slotIndex) => {
          const item = items[slotIndex];
          const state = item
            ? item.deadlocked
              ? "deadlocked"
              : item.active
                ? "active"
                : "queued"
            : "empty";

          return (
            <span
              key={slotIndex}
              className={`rack-queue-slot-pip ${state}`}
              title={
                item
                  ? `${item.name}: ${formatPercent(item.progress)} - ${item.waitingReason}`
                  : `Slot ${slotIndex + 1}: open`
              }
              style={
                {
                  "--rack-queue-progress": `${(item?.progress ?? 0) * 100}%`,
                } as CSSProperties
              }
            />
          );
        })}
      </span>
      <span className="rack-component-stat">
        Q {formatNumber(items.length)}/{formatNumber(slotCount)}
      </span>
    </span>
  );
}
