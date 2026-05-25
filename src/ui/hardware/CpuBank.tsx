import { type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Cpu, HardDrive, LayoutGrid, ListTodo, Rows3 } from "lucide-react";
import type { VisibleCpuSocket, VisibleState, VisibleUpgrade } from "../../game";
import { formatBits, formatClock, formatNumber } from "../format";
import { getSocketCoreLabel } from "../panels/cpuLabels";
import { getCoreActiveTask } from "../tasks/taskData";
import type { Dispatch } from "../uiActions";
import { UpgradeStepper } from "./UpgradeControls";
import { getCacheStateBits, toCacheSegment } from "./cacheData";
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
  const compactSlotCount = Math.min(
    Math.max(queueItems.length, queueCapacity),
    16,
  );
  const hiddenQueueCount = Math.max(0, queueItems.length - compactSlotCount);
  const summaryQueueColumns = getCompactSchedulerColumnCount(compactSlotCount);
  const deadlocked = socket.deadlocked;
  const efficiencyLabel = formatNumber(socket.efficiency);

  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("button, input, select, textarea, a")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  };
  const handleCardDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("button, input, select, textarea, a")) return;
    onOpenFull();
  };

  return (
    <div
      className={`cpu-summary-card ${selected ? "selected" : ""} ${
        deadlocked ? "deadlocked" : ""
      }`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={handleCardDoubleClick}
      onKeyDown={handleCardKeyDown}
      title={`Select ${socket.label} scheduler`}
      aria-label={`Select ${socket.label} scheduler, ${activeCount} of ${totalCores} active, efficiency ${efficiencyLabel}`}
    >
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
          onClick={(event) => {
            event.stopPropagation();
            onOpenFull();
          }}
          title={`Open ${socket.label} full view`}
          aria-label={`Open ${socket.label} full view`}
        >
          <Rows3 size={12} />
        </button>
      </div>

      {schedulerVisible && (
        <div className="cpu-summary-scheduler" aria-label="Scheduler queue">
          <div className="cpu-summary-scheduler-head">
            <span className="cpu-summary-scheduler-label">
              <ListTodo size={9} />
              <span>Sched</span>
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
          {compactSlotCount > 0 ? (
            <ul
              className={`cpu-summary-queue slots-${compactSlotCount}`}
              style={
                summaryQueueColumns
                  ? ({
                      "--cpu-summary-queue-columns": summaryQueueColumns,
                    } as CSSProperties)
                  : undefined
              }
            >
              {Array.from({ length: compactSlotCount }, (_, index) => {
                const item = queueItems[index];
                if (!item) {
                  return (
                    <li
                      key={`open-${socket.id}-${index}`}
                      className="cpu-summary-queue-slot empty"
                      title={`Slot ${index + 1}: open`}
                    >
                      <span className="cpu-summary-queue-index">
                        {index + 1}
                      </span>
                      <span className="cpu-summary-queue-state" title="Open">
                        Open
                      </span>
                    </li>
                  );
                }

                const state = getCompactSchedulerItemState(item);
                return (
                  <li
                    key={`${item.id}-${index}`}
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
            </ul>
          ) : (
            <span className="cpu-summary-queue-empty">No queue</span>
          )}
        </div>
      )}

      <div className="cpu-summary-cores-grid" aria-label="Per-core frequency">
        {socket.cores.map((core) => {
          const running = !!getCoreActiveTask(core);
          const coreLabel = getSocketCoreLabel(socket, core.id);
          return (
            <button
              key={core.id}
              type="button"
              className={`cpu-summary-core-cell ${running ? "running" : "idle"} ${
                core.deadlocked ? "deadlocked" : ""
              }`}
              onClick={(event) => {
                event.stopPropagation();
                onSelectCore(core.id);
              }}
              title={`${coreLabel} - ${formatClock(core.clockHz)}`}
              aria-label={`Select ${coreLabel} on ${socket.label}`}
            >
              <span className="cpu-summary-core-tag">{coreLabel}</span>
              <span className="cpu-summary-core-clock">
                {formatClock(core.clockHz)}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={`cpu-summary-cache ${cacheDeadlocked ? "deadlocked" : ""}`}
        aria-label="Cache"
      >
        <span className="cpu-summary-cache-label">
          <HardDrive size={9} />
          <span>Cache</span>
          <strong>
            {formatBits(cacheUsed)}/{formatBits(cacheCapacity)}
          </strong>
        </span>
        <span className="cpu-summary-cache-bar" aria-hidden="true">
          <span
            className="cpu-summary-cache-seg buffer"
            style={{ width: `${bufferPct}%` }}
          />
          <span
            className="cpu-summary-cache-seg ready"
            style={{ width: `${readyPct}%` }}
          />
        </span>
      </div>
    </div>
  );
}

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
            title="Array view"
          >
            <LayoutGrid size={12} />
            <span>Array</span>
          </button>
          <button
            type="button"
            className={`cpu-bank-toggle-btn ${view === "tabs" ? "active" : ""}`}
            onClick={() => onChangeView("tabs")}
            aria-pressed={view === "tabs"}
            title="Tabbed view"
          >
            <Rows3 size={12} />
            <span>Tabs</span>
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
