import type { CSSProperties } from "react";
import { MemoryStick } from "lucide-react";
import type { VisibleRamSlot, VisibleState, VisibleUpgrade } from "../../game";
import { formatBits, formatClock, formatNumber } from "../format";
import { getVisibleRamBits } from "../tasks/taskData";
import type { Dispatch } from "../uiActions";
import { DeadlockCountdown, DeadlockHelpCaption, shouldShowRamDeadlockPressure } from "./DeadlockHelp";
import { HardwareInstallSection } from "./HardwareInstallSection";
import {
  ModuleMeter,
  RamPressureMeter,
  type RamSegment,
} from "./meters";
import { getStressTone } from "./stressTone";
import { UpgradeChip } from "./UpgradeControls";

export interface SystemLoadStatus {
  memoryPressure: number;
  psuStress: number;
  coolingStress: number | null;
  coolingStatus: string;
}

export interface RamReservation {
  segments: RamSegment[];
  reservedBits: number;
  loadingBits: number;
}

const getRamPrimaryState = (segments: RamSegment[]) => {
  if (segments.some((segment) => segment.state === "loading")) return "Load";
  if (segments.some((segment) => segment.state === "reserved")) return "Stage";
  if (segments.some((segment) => segment.state === "loaded")) return "Ready";
  return "Idle";
};

const getRamModuleFrequencyLabel = (
  slots: VisibleRamSlot[],
  fallbackSpeedMt: number,
) => {
  const speeds = Array.from(
    new Set(
      (slots.length > 0 ? slots.map((slot) => slot.speedMt) : [fallbackSpeedMt])
        .filter((speed) => speed > 0),
    ),
  ).sort((a, b) => a - b);

  if (speeds.length <= 0) return formatClock(1);
  if (speeds.length === 1) return formatClock(speeds[0] ?? 1);

  return `${formatClock(speeds[0] ?? 1)}-${formatClock(speeds.at(-1) ?? 1)}`;
};

const getRamSegmentsBySlot = (
  slots: VisibleRamSlot[],
  segments: RamSegment[],
) => {
  const segmentsBySlot = new Map<number, RamSegment[]>(
    slots.map((slot) => [slot.id, []]),
  );
  let slotIndex = 0;
  let remainingSlotBits = slots[0]?.sizeBits ?? 0;

  for (const segment of segments) {
    let remainingSegmentBits = segment.bits;

    while (remainingSegmentBits > 0 && slotIndex < slots.length) {
      const slot = slots[slotIndex];
      if (!slot) break;

      if (remainingSlotBits <= 0) {
        slotIndex += 1;
        remainingSlotBits = slots[slotIndex]?.sizeBits ?? 0;
        continue;
      }

      const bits = Math.min(remainingSegmentBits, remainingSlotBits);
      segmentsBySlot.get(slot.id)?.push({ ...segment, bits });
      remainingSegmentBits -= bits;
      remainingSlotBits -= bits;
    }
  }

  return segmentsBySlot;
};

function getRamStickGridMetrics(stickCount: number) {
  const count = Math.max(0, stickCount);

  if (count <= 1) return { columns: 1, rows: 1, label: "1x1" };
  if (count <= 2) return { columns: 2, rows: 1, label: "2x1" };
  if (count <= 4) return { columns: 2, rows: 2, label: "2x2" };
  if (count <= 6) return { columns: 3, rows: 2, label: "3x2" };
  if (count <= 8) return { columns: 4, rows: 2, label: "4x2" };

  const columns = Math.min(6, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  return { columns, rows, label: `${columns}x${rows}` };
}

export function RamSection({
  visible,
  status,
  ramReservation,
  selected,
  selectedRamStickId,
  selectedAllRamSticks,
  onSelect,
  onSelectStick,
  onSelectAllSticks,
  upgrades,
  dispatch,
  showDeadlockHelp,
  showDeadlockCooldownHelp,
  onDismissDeadlockHelp,
  onDismissDeadlockCooldownHelp,
}: {
  visible: VisibleState;
  status: SystemLoadStatus;
  ramReservation: RamReservation;
  selected: boolean;
  selectedRamStickId: number | null;
  selectedAllRamSticks: boolean;
  onSelect: () => void;
  onSelectStick: (stickId: number) => void;
  onSelectAllSticks: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
  showDeadlockHelp?: boolean;
  showDeadlockCooldownHelp?: boolean;
  onDismissDeadlockHelp?: () => void;
  onDismissDeadlockCooldownHelp?: () => void;
}) {
  const ramUpgrade = upgrades.find((upgrade) => upgrade.id === "ram");
  const ramSlots = visible.metrics.ramSlots;

  if (ramSlots.length === 0) {
    return (
      <HardwareInstallSection
        className="memory-section"
        Icon={MemoryStick}
        title="RAM"
        note="Install first RAM stick"
        upgrade={ramUpgrade}
        selected={selected}
        onSelect={onSelect}
        dispatch={dispatch}
        resources={visible.resources}
      />
    );
  }

  const capacity = Math.max(getVisibleRamBits(visible), 1);
  const tone = getStressTone(status.memoryPressure);
  const ramSegmentsBySlot = getRamSegmentsBySlot(ramSlots, ramReservation.segments);
  const moduleFrequencyLabel = getRamModuleFrequencyLabel(
    ramSlots,
    visible.hardware.ramSpeedMt,
  );
  const stickCount = ramSlots.length;
  const selectedSlot =
    ramSlots.find((slot) => slot.id === selectedRamStickId) ?? ramSlots[0] ?? null;
  const selectedStickIds = selectedAllRamSticks
    ? ramSlots.map((slot) => slot.id)
    : selectedSlot
      ? [selectedSlot.id]
      : [];
  const ramCapacityUpgrade = selectedAllRamSticks
    ? visible.metrics.allRamCapacityUpgrade
    : selectedSlot?.capacityUpgrade ?? null;
  const selectedRamSpeedUpgrade = selectedAllRamSticks
    ? visible.metrics.allRamSpeedUpgrade
    : selectedSlot?.speedUpgrade ?? null;
  const upgradeTargetLabel = selectedAllRamSticks
    ? "All"
    : selectedSlot
      ? `R${selectedSlot.id}`
      : "RAM";
  const ramDeadlocked = visible.metrics.deadlocks.some(
    (deadlock) => deadlock.resource === "ram",
  );
  const cooldownActive =
    shouldShowRamDeadlockPressure(visible.metrics.deadlockPressure) &&
    visible.metrics.deadlockPressure.lockout;
  const ramGrid = getRamStickGridMetrics(stickCount);
  const ramGridStyle = {
    "--ram-stick-grid-columns": ramGrid.columns,
  } as CSSProperties;

  return (
    <section
      className={`hw-section memory-section ${tone} ${selected ? "selected" : ""} ${
        ramDeadlocked ? "deadlocked" : ""
      } ${cooldownActive ? "cooling-down" : ""}`}
    >
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <MemoryStick size={14} />
        <span>RAM</span>
        {shouldShowRamDeadlockPressure(visible.metrics.deadlockPressure) && (
          <DeadlockCountdown pressure={visible.metrics.deadlockPressure} compact />
        )}
        <span className="hw-section-meta">
          <strong>{formatBits(visible.metrics.ramUsedBits)}</strong> used
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

      <div className="cache-stat-row ram-stat-row">
        <span className="stat">
          <small>Capacity</small>
          <strong>{formatBits(capacity)}</strong>
        </span>
        <span className="stat">
          <small>Module Freq</small>
          <strong>{moduleFrequencyLabel}</strong>
        </span>
        <span className="stat">
          <small>Modules</small>
          <strong>{formatNumber(stickCount)}</strong>
        </span>
        <button
          type="button"
          className={`core-select-all-button ram-select-all-button ${
            selectedAllRamSticks ? "active" : ""
          }`}
          onClick={onSelectAllSticks}
          aria-pressed={selectedAllRamSticks}
          title="Select all RAM sticks"
        >
          All
        </button>
      </div>

      <div
        className="ram-stick-grid"
        style={ramGridStyle}
        data-grid={ramGrid.label}
      >
        {ramSlots.map((slot) => {
          const slotSegments = ramSegmentsBySlot.get(slot.id) ?? [];
          const isSelected =
            selectedAllRamSticks ||
            selectedRamStickId === slot.id ||
            (selectedRamStickId === null && selected && selectedSlot?.id === slot.id);

          return (
            <RamStickCard
              key={slot.id}
              slot={slot}
              selected={isSelected}
              onSelect={() => onSelectStick(slot.id)}
              segments={slotSegments}
            />
          );
        })}
      </div>

      {(ramUpgrade || ramCapacityUpgrade || selectedRamSpeedUpgrade) && (
        <div className="core-control-strip cache-control-strip ram-control-strip">
          {ramUpgrade && (
            <UpgradeChip
              upgrade={ramUpgrade}
              label="Module"
              control
              resources={visible.resources}
              dispatch={dispatch}
            />
          )}
          {ramCapacityUpgrade && (
            <UpgradeChip
              upgrade={ramCapacityUpgrade}
              label={`${upgradeTargetLabel} Size`}
              control
              ramStickId={selectedAllRamSticks ? undefined : selectedSlot?.id}
              ramStickIds={selectedAllRamSticks ? selectedStickIds : undefined}
              resources={visible.resources}
              dispatch={dispatch}
            />
          )}
          {selectedRamSpeedUpgrade && (
            <UpgradeChip
              upgrade={selectedRamSpeedUpgrade}
              label={`${upgradeTargetLabel} Freq`}
              control
              ramStickId={selectedAllRamSticks ? undefined : selectedSlot?.id}
              ramStickIds={selectedAllRamSticks ? selectedStickIds : undefined}
              resources={visible.resources}
              dispatch={dispatch}
            />
          )}
        </div>
      )}
    </section>
  );
}

function RamStickCard({
  slot,
  selected,
  onSelect,
  segments,
}: {
  slot: VisibleRamSlot;
  selected: boolean;
  onSelect: () => void;
  segments: RamSegment[];
}) {
  const state = getRamPrimaryState(segments);
  const capacity = Math.max(slot.sizeBits, 1);
  const used = Math.min(slot.usedBits, capacity);
  const pct = Math.round((used / capacity) * 100);
  const active = slot.usedBits > 0;
  const stateClass = state.toLowerCase();

  return (
    <button
      type="button"
      className={`ram-stick-module ${active ? "active" : ""} ${
        selected ? "selected" : ""
      } ram-stick-state-${stateClass}`}
      onClick={onSelect}
      aria-pressed={selected}
      title={`R${slot.id} - ${formatBits(slot.sizeBits)} - ${formatClock(slot.speedMt)} - ${state}`}
    >
      <span className="ram-stick-module-head">
        <span className="ram-stick-label">R{slot.id}</span>
        <span className="ram-stick-module-pct">{pct}%</span>
      </span>
      <span className="ram-stick-module-meter" aria-hidden="true">
        {segments.length > 0 ? (
          <RamPressureMeter segments={segments} capacityBits={capacity} />
        ) : (
          <ModuleMeter value={0} />
        )}
      </span>
      <span className="ram-stick-module-foot">
        <span>{formatBits(slot.sizeBits)}</span>
        <span>{formatClock(slot.speedMt)}</span>
      </span>
    </button>
  );
}
