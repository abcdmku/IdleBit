import { memo, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Cpu, HardDrive, LayoutGrid, ListTodo, Rows3 } from "lucide-react";
import type { VisibleCpuSocket, VisibleState, VisibleUpgrade } from "../../game";
import { formatBits, formatClock, formatNumber } from "../format";
import { getSocketCoreLabel } from "../panels/cpuLabels";
import { SmoothFill, useMeterSnap } from "../SmoothProgress";
import { getCoreActiveTask } from "../tasks/taskData";
import { useStableCallback } from "../hooks/useStableCallback";
import type { Dispatch } from "../uiActions";
import { UpgradeStepper } from "./UpgradeControls";
import { getCacheStateBits, toCacheSegment } from "./cacheData";
import { formatClockTick, formatFraction } from "./display";
import { getCoreGridMetrics } from "./coreGrid";
import { getCoreOperationProgress } from "./coreProgress";
import { getCoreSegmentColor } from "./meters";
import { getQueueDisplayItems } from "./queueData";
import type { UiQueueDisplayItem } from "./visibleState";

/* ============ CPU BANK (multi-socket) ============ */

export type CpuBankView = "array" | "tabs";

const getCpuTabLabel = (label: string, id: number) => {
  const shortLabel = label.replace(/^CPU\s+/iu, "").trim();
  return shortLabel || String(id);
};

function CpuSummaryCard({
  socket,
  selected,
  onSelect,
  onOpenFull,
  onSelectCore,
  schedulerVisible,
  visible,
}: {
  socket: VisibleCpuSocket;
  selected: boolean;
  onSelect: () => void;
  onOpenFull: () => void;
  onSelectCore: (coreId: number) => void;
  schedulerVisible: boolean;
  visible: VisibleState;
}) {
  const activeCount = socket.cores.filter((core) => getCoreActiveTask(core)).length;
  // Identity-stable handler so the memoized core cells skip reconciliation
  // even though CpuBank passes a fresh closure on every snapshot.
  const stableSelectCore = useStableCallback(onSelectCore);
  const totalCores = socket.cores.length;
  const cacheUsed = socket.cacheUsedBits ?? 0;
  const cacheCapacity = Math.max(socket.cacheBits ?? 0, 1);
  const cacheSegments = socket.cacheResidency.map(toCacheSegment);
  const cacheStateBits = getCacheStateBits(cacheSegments);
  const bufferPct = Math.min(100, (cacheStateBits.buffering / cacheCapacity) * 100);
  const readyPct = Math.min(
    100 - bufferPct,
    (cacheStateBits.loaded / cacheCapacity) * 100,
  );
  const cacheDeadlocked = socket.deadlockResource === "cache";
  const queueCapacity = Math.max(socket.schedulerSlots ?? 0, 0);
  const queueCount = socket.queuedCount ?? 0;
  const queueItems = schedulerVisible ? getQueueDisplayItems(visible, socket) : [];
  // Reserved geometry: the summary queue footprint derives from purchased
  // slot capacity (capped at 16 rendered cells) so queueing and completion
  // swap cell contents in place instead of resizing the card.
  const summarySlotCount = Math.min(
    16,
    Math.max(queueCapacity, queueItems.length),
  );
  const filledQueueItems = queueItems.slice(0, summarySlotCount);
  const hiddenQueueCount = Math.max(0, queueItems.length - filledQueueItems.length);
  const openQueueCount = Math.max(0, summarySlotCount - filledQueueItems.length);
  const summaryQueueColumns = getCompactSchedulerColumnCount(summarySlotCount);
  const deadlocked = socket.deadlocked;
  const efficiencyLabel = formatNumber(socket.efficiency);
  const coreGrid = getCoreGridMetrics(totalCores);
  const coreGridStyle = {
    "--core-grid-columns": coreGrid.columns,
    "--core-grid-tablet-columns": Math.min(coreGrid.columns, 6),
    "--core-grid-mobile-columns": Math.min(coreGrid.columns, 4),
  } as CSSProperties;

  const handleCardDoubleClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (
      target?.closest(
        ".cpu-summary-open, .cpu-summary-core-cell, input, select, textarea, a",
      )
    ) {
      return;
    }
    onOpenFull();
  };

  return (
    <div
      className={`cpu-summary-card ${selected ? "selected" : ""} ${
        deadlocked ? "deadlocked" : ""
      }`}
      role="group"
      onDoubleClick={handleCardDoubleClick}
      aria-label={`${socket.label} summary`}
    >
      {/* Stretched invisible select button underneath the content: real
          controls and tooltip-bearing readouts sit above it (z-index 1), so
          the card has no interactive descendants inside a button role. */}
      <button
        type="button"
        className="cpu-summary-select"
        onClick={onSelect}
        aria-pressed={selected}
        title={`Select ${socket.label} scheduler`}
        aria-label={`Select ${socket.label} scheduler, ${activeCount} of ${totalCores} active, efficiency ${efficiencyLabel}`}
      />
      <div className="cpu-summary-head-row">
        <span className="cpu-summary-head">
          <Cpu size={11} />
          <span className="cpu-summary-label">{socket.label}</span>
          <span className="cpu-summary-efficiency">
            Eff <strong>{efficiencyLabel}</strong>
          </span>
        </span>
        <button
          type="button"
          className="cpu-summary-open"
          onClick={onOpenFull}
          title={`Open ${socket.label} full view`}
          aria-label={`Open ${socket.label} full view`}
        >
          <Rows3 size={12} />
        </button>
      </div>

      {schedulerVisible && (
        <div className="cpu-summary-scheduler" aria-label="Scheduler queue">
          <div className="cpu-summary-scheduler-head">
            <span className="cpu-summary-scheduler-label" title="Scheduler queue">
              <ListTodo size={9} />
              <strong>
                {queueCount}
                {queueCapacity > 0 ? `/${queueCapacity}` : ""}
              </strong>
            </span>
            {hiddenQueueCount > 0 && (
              <span className="cpu-summary-queue-more">
                +{hiddenQueueCount}
              </span>
            )}
          </div>
          {summarySlotCount > 0 ? (
            <ul
              className={`cpu-summary-queue slots-${summarySlotCount}`}
              style={
                summaryQueueColumns
                  ? ({
                      "--cpu-summary-queue-columns": summaryQueueColumns,
                    } as CSSProperties)
                  : undefined
              }
            >
              {filledQueueItems.map((item, index) => {
                const state = getCompactSchedulerItemState(item);
                return (
                  <li
                    key={item.key ?? `${item.id}-${index}`}
                    className={`cpu-summary-queue-slot ${
                      item.active ? "active" : "pending"
                    } ${item.deadlocked ? "deadlocked" : ""}`}
                    title={`${item.name}: ${item.waitingReason}`}
                  >
                    <span className="cpu-summary-queue-index">
                      {index + 1}
                    </span>
                    <span className="cpu-summary-queue-state" title={state}>
                      {state}
                    </span>
                  </li>
                );
              })}
              {Array.from({ length: openQueueCount }, (_, offset) => {
                const slotIndex = filledQueueItems.length + offset;
                return (
                  <li
                    key={`open-${socket.id}-${slotIndex}`}
                    className="cpu-summary-queue-slot empty cpu-summary-queue-open"
                    title="Open scheduler slot"
                  >
                    <span className="cpu-summary-queue-index">
                      {slotIndex + 1}
                    </span>
                    <span className="cpu-summary-queue-state">open</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <span className="cpu-summary-queue-empty">No queue</span>
          )}
        </div>
      )}

      <div
        className={`core-grid ${coreGrid.density} cpu-summary-cores-grid`}
        style={coreGridStyle}
        data-grid={coreGrid.label}
        aria-label="Per-core frequency"
      >
        {socket.cores.map((core) => (
          <CpuSummaryCoreCell
            key={core.id}
            coreId={core.id}
            coreLabel={getSocketCoreLabel(socket, core.id)}
            socketLabel={socket.label}
            clockHz={core.clockHz}
            running={Boolean(getCoreActiveTask(core))}
            deadlocked={core.deadlocked}
            progress={getCoreOperationProgress(core)}
            onSelectCore={stableSelectCore}
          />
        ))}
      </div>

      <div
        className={`cpu-summary-cache ${cacheDeadlocked ? "deadlocked" : ""}`}
        aria-label="Cache"
      >
        <span className="cpu-summary-cache-label" title="Cache used / capacity">
          <HardDrive size={9} />
          <strong>
            {formatFraction(formatBits(cacheUsed), formatBits(cacheCapacity))}
          </strong>
        </span>
        <span className="cpu-summary-cache-bar" aria-hidden="true">
          <CpuSummaryCacheSeg kind="buffer" percent={bufferPct} />
          <CpuSummaryCacheSeg kind="ready" percent={readyPct} />
        </span>
      </div>
    </div>
  );
}

/**
 * Summary cache lane extent: inline width interpolates across snapshots via
 * the CSS width transition; decreases (batch commit / consumption) snap so
 * the bar never animates backward.
 */
function CpuSummaryCacheSeg({
  kind,
  percent,
}: {
  kind: "buffer" | "ready";
  percent: number;
}) {
  const snapping = useMeterSnap(percent);

  return (
    <span
      className={`cpu-summary-cache-seg ${kind} ${snapping ? "is-snapping" : ""}`}
      style={{ width: `${percent}%` }}
    />
  );
}

/**
 * Memoized with primitive props: the summary grid renders one cell per core
 * for every socket on every ~10ms snapshot, so unchanged cells must skip
 * reconciliation. onSelectCore must be identity-stable.
 */
const CpuSummaryCoreCell = memo(function CpuSummaryCoreCell({
  coreId,
  coreLabel,
  socketLabel,
  clockHz,
  running,
  deadlocked,
  progress,
  onSelectCore,
}: {
  coreId: number;
  coreLabel: string;
  socketLabel: string;
  clockHz: number;
  running: boolean;
  deadlocked: boolean;
  progress: number;
  onSelectCore: (coreId: number) => void;
}) {
  const coreStyle = running
    ? ({
        "--core-status-color": getCoreSegmentColor(coreId, 0.94),
        "--core-status-glow": getCoreSegmentColor(coreId, 0.72),
      } as CSSProperties)
    : undefined;

  return (
    <button
      type="button"
      className={`core-die cpu-summary-core-cell ${
        running ? "running" : "idle"
      } ${
        deadlocked ? "deadlocked" : ""
      }`}
      style={coreStyle}
      onClick={() => onSelectCore(coreId)}
      title={`${coreLabel} - ${formatClock(clockHz)}`}
      aria-label={`Select ${coreLabel} on ${socketLabel}`}
    >
      <span className="core-die-head">
        <span className="core-label cpu-summary-core-tag">{coreLabel}</span>
        <span className="core-clock cpu-summary-core-clock">
          <strong>{formatClockTick(clockHz)}</strong>
        </span>
      </span>
      <span
        className="smooth-progress die-progress stat-tile-meter"
        aria-hidden="true"
      >
        <SmoothFill value={progress} className="stat-tile-meter-fill" />
      </span>
    </button>
  );
});

function getCompactSchedulerColumnCount(slotCount: number) {
  if (slotCount <= 1 || slotCount === 4) return null;
  if (slotCount <= 3) return slotCount;
  if (slotCount <= 6 || slotCount === 9) return 3;
  return 4;
}

function getCompactSchedulerItemState(item: UiQueueDisplayItem) {
  if (item.deadlocked) return "LOCK";
  if (item.active) return "RUN";
  return getCompactSchedulerReason(item);
}

function getCompactSchedulerReason(item: UiQueueDisplayItem) {
  const reason = item.waitingReason.toLowerCase();

  if (reason.includes("cache")) return "CACHE";
  if (reason.includes("ram") || reason.includes("memory")) return "RAM";
  if (reason.includes("no idle core") || reason.includes("idle cores")) {
    return "NO CORE";
  }
  if (reason.includes("slot")) return "SLOT";
  if (reason.includes("power") || reason.includes("psu")) return "POWER";
  if (reason.includes("thermal") || reason.includes("cool")) return "THERM";
  if (reason.includes("deadlock") || reason.includes("lock")) return "LOCK";
  if (reason.includes("scheduler") || reason.includes("dispatch")) return "SCHED";
  if (reason.includes("core") || reason.includes("cpu")) return "CORE";

  return "WAIT";
}

export function CpuBank({
  sockets,
  view,
  onChangeView,
  activeSocketId,
  onSelectTab,
  onOpenSocket,
  onSelectCore,
  renderSocket,
  schedulerVisible,
  visible,
  resources,
  dispatch,
  socketUpgrades,
}: {
  sockets: VisibleCpuSocket[];
  view: CpuBankView;
  onChangeView: (view: CpuBankView) => void;
  activeSocketId: number;
  onSelectTab: (socketId: number) => void;
  onOpenSocket: (socketId: number) => void;
  onSelectCore: (socketId: number, coreId: number) => void;
  renderSocket: (socket: VisibleCpuSocket) => ReactNode;
  schedulerVisible: boolean;
  visible: VisibleState;
  resources: VisibleState["resources"];
  dispatch: Dispatch;
  socketUpgrades: VisibleUpgrade[];
}) {
  const activeSocket =
    sockets.find((socket) => socket.id === activeSocketId) ?? sockets[0];
  const cpuCount = sockets.length;

  return (
    <section className="cpu-bank" aria-label={`CPU bank (${cpuCount})`}>
      <header className="cpu-bank-header">
        <span className="cpu-bank-title">
          <Cpu size={13} />
          <span>CPUs</span>
          <strong>{cpuCount}</strong>
        </span>
        {view === "tabs" && (
          <nav className="cpu-bank-tabs" aria-label="CPU tabs">
            {sockets.map((socket) => {
              const tabLabel = getCpuTabLabel(socket.label, socket.id);

              return (
                <button
                  key={socket.id}
                  type="button"
                  className={`cpu-bank-tab ${socket.id === activeSocketId ? "active" : ""}`}
                  onClick={() => onSelectTab(socket.id)}
                  title={socket.label}
                  aria-label={socket.label}
                >
                  {tabLabel}
                </button>
              );
            })}
          </nav>
        )}
        {socketUpgrades.length > 0 && (
          <div className="cpu-bank-add" aria-label="Add CPU">
            {socketUpgrades.map((upgrade) => (
              <UpgradeStepper
                key={upgrade.id}
                upgrade={upgrade}
                dispatch={dispatch}
                label="CPU"
                className="cpu-bank-add-stepper"
                resources={resources}
              />
            ))}
          </div>
        )}
        <div className="cpu-bank-toggle" role="group" aria-label="CPU view mode">
          <button
            type="button"
            className={`cpu-bank-toggle-btn ${view === "array" ? "active" : ""}`}
            onClick={() => onChangeView("array")}
            aria-pressed={view === "array"}
            aria-label="Array view"
            title="Array view"
          >
            <LayoutGrid size={12} />
          </button>
          <button
            type="button"
            className={`cpu-bank-toggle-btn ${view === "tabs" ? "active" : ""}`}
            onClick={() => onChangeView("tabs")}
            aria-pressed={view === "tabs"}
            aria-label="Tabbed view"
            title="Tabbed view"
          >
            <Rows3 size={12} />
          </button>
        </div>
      </header>

      {view === "array" ? (
        <div
          className="cpu-bank-grid"
          style={{ "--cpu-bank-count": cpuCount } as CSSProperties}
        >
          {sockets.map((socket) => (
            <CpuSummaryCard
              key={socket.id}
              socket={socket}
              selected={socket.id === activeSocketId}
              onSelect={() => onSelectTab(socket.id)}
              onOpenFull={() => onOpenSocket(socket.id)}
              onSelectCore={(coreId) => onSelectCore(socket.id, coreId)}
              schedulerVisible={schedulerVisible}
              visible={visible}
            />
          ))}
        </div>
      ) : (
        <div className="cpu-bank-stack">
          {activeSocket && renderSocket(activeSocket)}
        </div>
      )}
    </section>
  );
}
