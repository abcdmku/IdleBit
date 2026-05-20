import type { CSSProperties, ReactNode } from "react";
import { X } from "lucide-react";
import type { Dispatch } from "../uiActions";

export interface QueuePreviewItem {
  id: string;
  name: string;
  waitingReason: string;
  instanceId?: string;
  active: boolean;
  progress: number;
  deadlocked?: boolean;
}

interface SchedulerGridMetrics {
  columns: number;
  rows: number;
  gridHeight: number;
  slotHeight: number;
  density: "spacious" | "compact" | "dense" | "micro";
}

const schedulerGridMaxHeightPx = 144;
const schedulerGridGapPx = 4;

function getSchedulerGridMetrics(
  slotCount: number,
  options: { startSmall?: boolean } = {},
): SchedulerGridMetrics {
  const count = Math.max(0, slotCount);
  let columns = 2;
  let rows = 2;

  if (count === 0) {
    return {
      columns: 1,
      rows: 1,
      gridHeight: 34,
      slotHeight: 34,
      density: "spacious",
    };
  }

  if (options.startSmall && count <= 4) {
    const smallColumns = count === 1 ? 1 : 2;
    const smallRows = count <= 2 ? 1 : 2;
    const targetSlotHeight = 30;

    return {
      columns: smallColumns,
      rows: smallRows,
      gridHeight: smallRows * targetSlotHeight + (smallRows - 1) * schedulerGridGapPx,
      slotHeight: targetSlotHeight,
      density: "spacious",
    };
  }

  if (count > 36) {
    const side = Math.max(8, Math.ceil(Math.sqrt(count)));
    const evenSide = side % 2 === 0 ? side : side + 1;
    columns = evenSide;
    rows = evenSide;
  } else if (count > 24) {
    columns = 6;
    rows = 6;
  } else if (count > 16) {
    columns = 6;
    rows = 4;
  } else if (count > 8) {
    columns = 4;
    rows = 4;
  } else if (count > 6) {
    columns = 4;
    rows = 2;
  } else if (count > 4) {
    columns = 3;
    rows = 2;
  }

  const targetSlotHeight = rows >= 8 ? 16 : rows >= 6 ? 20 : rows >= 4 ? 24 : 30;
  const gridHeight = Math.min(
    schedulerGridMaxHeightPx,
    rows * targetSlotHeight + (rows - 1) * schedulerGridGapPx,
  );
  const slotHeight = Math.max(
    8,
    Math.floor(
      (gridHeight - (rows - 1) * schedulerGridGapPx) / rows,
    ),
  );
  const density =
    rows >= 8 ? "micro" : rows >= 6 ? "dense" : rows >= 4 ? "compact" : "spacious";

  return { columns, rows, gridHeight, slotHeight, density };
}

function SchedulerStatusText({ children }: { children: ReactNode }) {
  const statusText =
    typeof children === "string" || typeof children === "number"
      ? String(children)
      : "";

  return (
    <span className="scheduler-status-marquee" data-status={statusText}>
      <span>{children}</span>
    </span>
  );
}

export function QueuePreview({
  items,
  slotCapacity,
  ariaLabel,
  dispatch,
  emptyLabel,
  startSmall = false,
}: {
  items: QueuePreviewItem[];
  slotCapacity: number;
  ariaLabel: string;
  dispatch: Dispatch;
  emptyLabel?: string;
  startSmall?: boolean;
}) {
  const visibleSlotCount = Math.max(Math.max(0, slotCapacity), items.length);
  const grid = getSchedulerGridMetrics(visibleSlotCount, { startSmall });
  const gridStyle = {
    "--scheduler-grid-columns": grid.columns,
    "--scheduler-grid-height": `${grid.gridHeight}px`,
    "--scheduler-slot-height": `${grid.slotHeight}px`,
  } as CSSProperties;

  return (
    <div className="queue-preview" aria-label={ariaLabel}>
      <div
        className={`queue-preview-list ${grid.density}`}
        style={gridStyle}
        data-grid={`${grid.columns}x${grid.rows}`}
      >
        {visibleSlotCount > 0 ? (
          Array.from({ length: visibleSlotCount }, (_, index) => {
            const item = items[index];

            if (!item) {
              return (
                <small
                  className="queue-slot-cell empty"
                  key={`empty-${index}`}
                  title={`Slot ${index + 1}: open`}
                >
                  <span className="queue-slot-index">{index + 1}</span>
                  <span className="queue-slot-state">Open</span>
                </small>
              );
            }

            return (
              <small
                className={`queue-slot-cell ${item.active ? "active" : "pending"} ${
                  item.deadlocked ? "deadlocked" : ""
                }`}
                key={`${item.id}-${index}`}
                title={`${item.name}: ${item.waitingReason}`}
              >
                <span className="queue-slot-index">{index + 1}</span>
                <span className="queue-slot-state">
                  <SchedulerStatusText>{item.waitingReason}</SchedulerStatusText>
                </span>
                <button
                  type="button"
                  className="queue-cancel-button"
                  onClick={() =>
                    dispatch(
                      item.instanceId
                        ? {
                            type: "cancelTask",
                            taskId: item.id,
                            instanceId: item.instanceId,
                          }
                        : { type: "cancelQueuedTask", taskId: item.id },
                    )
                  }
                  title={`Cancel ${item.name}`}
                  aria-label={`Cancel ${item.name}`}
                >
                  <X size={11} />
                </button>
              </small>
            );
          })
        ) : (
          <small className="queue-empty">
            <span>{emptyLabel ?? "No slots"}</span>
          </small>
        )}
      </div>
    </div>
  );
}
