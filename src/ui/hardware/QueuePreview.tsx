import type { CSSProperties } from "react";
import { X } from "lucide-react";
import { SmoothFill } from "../SmoothProgress";
import type { Dispatch } from "../uiActions";
import { clampMeter } from "./meters";

export interface QueuePreviewItem {
  id: string;
  /** Stable queue-entry identity for React keys; falls back to id+index. */
  key?: string;
  cancelTaskId?: string;
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

  if (count === 0) {
    return {
      columns: 1,
      rows: 1,
      gridHeight: 34,
      slotHeight: 34,
      density: "spacious",
    };
  }

  const columns =
    count <= 1
      ? 1
      : count <= 4
        ? 2
        : count <= 6
          ? 3
          : count <= 8
            ? 4
            : count <= 9
              ? 3
              : count <= 16
                ? 4
                : count <= 25
                  ? 5
                  : count <= 36
                    ? 6
                    : Math.max(7, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));

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

  const targetSlotHeight =
    rows >= 8 || columns >= 8
      ? 16
      : rows >= 6 || columns >= 6
        ? 20
        : rows >= 4 || columns >= 5
          ? 24
          : 30;
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
    rows >= 8 || columns >= 8
      ? "micro"
      : rows >= 6 || columns >= 6
        ? "dense"
        : rows >= 4 || columns >= 5
          ? "compact"
          : "spacious";

  return { columns, rows, gridHeight, slotHeight, density };
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
  // Reserved geometry: the footprint derives from purchased slot capacity
  // (items can only exceed it transiently), never from current occupancy, so
  // queueing and completion update cells in place without moving neighbors.
  const visibleSlotCount = Math.max(Math.max(0, slotCapacity), items.length);
  const openSlotCount = Math.max(0, visibleSlotCount - items.length);
  const grid = getSchedulerGridMetrics(visibleSlotCount, { startSmall });
  const gridStyle = {
    "--scheduler-grid-columns": grid.columns,
    "--scheduler-grid-height": `${grid.gridHeight}px`,
    "--scheduler-preview-height": `${grid.gridHeight}px`,
    "--scheduler-slot-height": `${grid.slotHeight}px`,
  } as CSSProperties;

  if (visibleSlotCount > 0 && items.length === 0) {
    const label = emptyLabel ?? `${visibleSlotCount} open`;

    return (
      <div className="queue-preview" style={gridStyle} aria-label={ariaLabel}>
        <small
          className="queue-empty queue-open-empty"
          title={`${visibleSlotCount} open slot${
            visibleSlotCount === 1 ? "" : "s"
          }`}
        >
          <span>{label}</span>
        </small>
      </div>
    );
  }

  return (
    <div className="queue-preview" style={gridStyle} aria-label={ariaLabel}>
      <div
        className={`queue-preview-list ${grid.density}`}
        style={gridStyle}
        data-grid={`${grid.columns}x${grid.rows}`}
      >
        {visibleSlotCount > 0 ? (
          <>
            {items.map((item, index) => {
              const progress = clampMeter(item.progress);
              const progressPercent = Math.round(progress * 1000) / 10;

              return (
                <small
                  className={`queue-slot-cell ${item.active ? "active" : "pending"} ${
                    item.deadlocked ? "deadlocked" : ""
                  }`}
                  key={item.key ?? `${item.id}-${index}`}
                  title={`${item.name}: ${item.waitingReason}`}
                >
                  <span className="queue-slot-index">{index + 1}</span>
                  <span className="queue-slot-name">{item.name}</span>
                  <span className="queue-slot-state">{item.waitingReason}</span>
                  <span
                    className="queue-slot-progress"
                    role="progressbar"
                    aria-label={`${item.name} total progress ${progressPercent}%`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progressPercent}
                  >
                    <SmoothFill value={item.active ? progress : 0} />
                  </span>
                  <button
                    type="button"
                    className="queue-cancel-button"
                    onClick={() =>
                      dispatch(
                        item.instanceId
                          ? {
                              type: "cancelTask",
                              taskId: item.cancelTaskId ?? item.id,
                              instanceId: item.instanceId,
                            }
                          : { type: "cancelQueuedTask", taskId: item.cancelTaskId ?? item.id },
                      )
                    }
                    title={`Cancel ${item.name}`}
                    aria-label={`Cancel ${item.name}`}
                  >
                    <X size={11} />
                  </button>
                </small>
              );
            })}
            {openSlotCount > 0 && (
              <small
                className="queue-slot-cell empty queue-open-summary"
                key="open-summary"
                title={`${openSlotCount} open slot${openSlotCount === 1 ? "" : "s"}`}
                aria-label={`${openSlotCount} open slot${
                  openSlotCount === 1 ? "" : "s"
                }`}
              >
                <span className="queue-slot-name">
                  {openSlotCount} open
                </span>
              </small>
            )}
          </>
        ) : (
          <small className="queue-empty">
            <span>{emptyLabel ?? "No slots"}</span>
          </small>
        )}
      </div>
    </div>
  );
}
