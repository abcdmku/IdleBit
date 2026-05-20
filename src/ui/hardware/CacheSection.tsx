import { HardDrive } from "lucide-react";
import type { VisibleCpuSocket, VisibleState } from "../../game";
import { formatBits, formatClock } from "../format";
import type { Dispatch } from "../uiActions";
import { DeadlockHelpCaption, shouldShowCacheDeadlockPressure } from "./DeadlockHelp";
import { CachePipeline } from "./meters";
import { UpgradeChip } from "./UpgradeControls";
import { getCachePrimaryState, getCacheStateBits, toCacheSegment } from "./cacheData";

/* ============ CACHE SECTION ============ */

export function CacheSection({
  socket,
  selected,
  onSelect,
  resources,
  dispatch,
  deadlockPressure,
  showDeadlockHelp,
  showDeadlockCooldownHelp,
  onDismissDeadlockHelp,
  onDismissDeadlockCooldownHelp,
}: {
  socket: VisibleCpuSocket;
  selected: boolean;
  onSelect: () => void;
  resources: VisibleState["resources"];
  dispatch: Dispatch;
  deadlockPressure: VisibleState["metrics"]["deadlockPressure"];
  showDeadlockHelp?: boolean;
  showDeadlockCooldownHelp?: boolean;
  onDismissDeadlockHelp?: () => void;
  onDismissDeadlockCooldownHelp?: () => void;
}) {
  const capacity = Math.max(socket.cacheBits, 1);
  const cacheSegments = socket.cacheResidency.map(toCacheSegment);
  const cacheReservation = {
    segments: cacheSegments,
    reservedBits: socket.cacheUsedBits,
    loadingBits: cacheSegments.reduce(
      (total, segment) => total + segment.bufferBits,
      0,
    ),
  };
  const cacheUpgrade = socket.cacheUpgrade;
  const cacheSpeedUpgrade = socket.cacheSpeedUpgrade;
  const stateBits = getCacheStateBits(cacheReservation.segments);
  const cacheDeadlocked = socket.deadlockResource === "cache";
  const cooldownActive =
    shouldShowCacheDeadlockPressure(socket, deadlockPressure) &&
    deadlockPressure.lockout;
  const cacheState = cacheDeadlocked
    ? "Deadlock"
    : cooldownActive
      ? "Cooldown"
    : getCachePrimaryState(cacheReservation.segments);

  return (
    <section
      className={`hw-section cache-section ${selected ? "selected" : ""} ${
        cacheDeadlocked ? "deadlocked" : ""
      } ${cooldownActive ? "cooling-down" : ""}`}
    >
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <HardDrive size={14} />
        <span>Cache</span>
        <span className="hw-section-meta">
          <strong>{cacheState}</strong>
        </span>
      </button>
      {showDeadlockHelp && (
        <DeadlockHelpCaption onDismiss={onDismissDeadlockHelp} />
      )}
      {!showDeadlockHelp && showDeadlockCooldownHelp && (
        <DeadlockHelpCaption
          kind="cooldown"
          onDismiss={onDismissDeadlockCooldownHelp}
        />
      )}

      <div className="cache-stat-row">
        <span className="stat cache-capacity-stat">
          <small>Capacity</small>
          <strong>
            {formatBits(cacheReservation.reservedBits)} / {formatBits(capacity)}
          </strong>
        </span>
        <span className="stat">
          <small>Frequency</small>
          <strong>{formatClock(Math.round(1 * 1.45 ** (socket.cacheSpeedLevel - 1) * 10) / 10)}</strong>
        </span>
      </div>

      <CachePipeline
        segments={cacheReservation.segments}
        stateBits={stateBits}
        capacityBits={capacity}
      />

      {(cacheUpgrade || cacheSpeedUpgrade) && (
        <div className="core-control-strip cache-control-strip">
          {cacheUpgrade && (
            <UpgradeChip
              upgrade={cacheUpgrade}
              dispatch={dispatch}
              cpuId={socket.id}
              label="Size"
              control
              resources={resources}
            />
          )}
          {cacheSpeedUpgrade && (
            <UpgradeChip
              upgrade={cacheSpeedUpgrade}
              dispatch={dispatch}
              cpuId={socket.id}
              label="Freq"
              control
              resources={resources}
            />
          )}
        </div>
      )}

    </section>
  );
}

