import type { CSSProperties } from "react";
import { MemoryStick, Plus } from "lucide-react";
import type {
  VisibleRamInstallOption,
  VisibleRamSlot,
  VisibleState,
  VisibleUpgrade,
} from "../../game";
import { formatBits, formatClock, formatCost, formatNumber } from "../format";
import { ResourceCost } from "../ResourceTokens";
import type { Dispatch } from "../uiActions";
import { DeadlockCountdown, DeadlockHelpCaption, shouldShowRamDeadlockPressure } from "./DeadlockHelp";
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
  if (segments.some((segment) => segment.state === "loaded")) return "Loaded";
  return "Idle";
};

const getRamSegmentsBySlot = (
  slots: VisibleRamSlot[],
  segments: RamSegment[],
) => {
  const segmentsBySlot = new Map<number, RamSegment[]>(
    slots.map((slot) => [slot.id, []]),
  );
  const fallbackSlotId = slots[0]?.id ?? 1;

  segments.forEach((segment) => {
    const slotId =
      segment.stickId !== undefined && segmentsBySlot.has(segment.stickId)
        ? segment.stickId
        : fallbackSlotId;
    segmentsBySlot.get(slotId)?.push(segment);
  });

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
  const ramSlots = visible.metrics.ramSlots;
  const ramInstallOptions = visible.metrics.ramInstallOptions ?? [];
  const ramUpgrade = upgrades.find((upgrade) => upgrade.id === "ram");

  if (ramSlots.length === 0) {
    return (
      <RamInstallSection
        selected={selected}
        onSelect={onSelect}
        options={ramInstallOptions}
        dispatch={dispatch}
        resources={visible.resources}
      />
    );
  }

  const tone = getStressTone(status.memoryPressure);
  const ramSegmentsBySlot = getRamSegmentsBySlot(ramSlots, ramReservation.segments);
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
      <div className="ram-header-row">
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
        {stickCount > 1 && (
          <button
            type="button"
            className={`core-select-all-button ram-select-all-button ram-header-all-button ${
              selectedAllRamSticks ? "active" : ""
            }`}
            onClick={onSelectAllSticks}
            aria-pressed={selectedAllRamSticks}
            title="Select all RAM sticks"
          >
            All
          </button>
        )}
        {ramUpgrade && (
          <div className="ram-header-controls" aria-label="RAM stick count">
            <UpgradeChip
              upgrade={ramUpgrade}
              label="New stick"
              control
              resources={visible.resources}
              dispatch={dispatch}
            />
          </div>
        )}
      </div>
      {showDeadlockHelp && (
        <DeadlockHelpCaption onDismiss={onDismissDeadlockHelp} />
      )}
      {!showDeadlockHelp && showDeadlockCooldownHelp && (
        <DeadlockHelpCaption
          kind="cooldown"
          onDismiss={onDismissDeadlockCooldownHelp}
        />
      )}

      <div className="ram-pipeline-summary">
        <span title={visible.metrics.memory.channelBlockedReason ?? undefined}>
          Ch {visible.metrics.memory.activeChannelCount}/
          {visible.metrics.memory.maxChannelCount}
        </span>
        <span>
          Write {formatClock(visible.metrics.memory.effectiveBandwidthBps)}
        </span>
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

      {(ramCapacityUpgrade || selectedRamSpeedUpgrade) && (
        <div className="core-control-strip cache-control-strip ram-control-strip">
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

function RamInstallSection({
  selected,
  onSelect,
  options,
  dispatch,
  resources,
}: {
  selected: boolean;
  onSelect: () => void;
  options: VisibleRamInstallOption[];
  dispatch: Dispatch;
  resources: VisibleState["resources"];
}) {
  return (
    <section
      className={`hw-section install-hardware-section memory-section ${
        selected ? "selected" : ""
      }`}
    >
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <MemoryStick size={14} />
        <span>RAM</span>
        <span className="hw-section-meta">
          <strong>Open bay</strong>
        </span>
      </button>
      <div className="install-hardware-body ram-install-hardware-body">
        <span className="install-hardware-copy">
          <strong>Install first RAM stick</strong>
          <span>Choose tier</span>
        </span>
        <RamInstallTierControls
          options={options}
          dispatch={dispatch}
          resources={resources}
        />
      </div>
    </section>
  );
}

const getRamTierLabel = (tierName: string) => tierName.replace(/\s+RAM$/u, "");

function RamInstallTierControls({
  options,
  dispatch,
  resources,
  compact = false,
}: {
  options: VisibleRamInstallOption[];
  dispatch: Dispatch;
  resources: VisibleState["resources"];
  compact?: boolean;
}) {
  if (options.length === 0) return null;

  return (
    <div className={`ram-install-tier-controls ${compact ? "compact" : ""}`}>
      <span className="ram-install-tier-title">
        {compact ? "New stick" : "Choose tier"}
      </span>
      <div className="ram-install-tier-list">
        {options.map((option) => {
          const upgrade = option.upgrade;
          const tierLabel = getRamTierLabel(option.tierName);
          const title = `Install ${option.tierName}: ${formatCost(upgrade.costs)}`;

          return (
            <button
              key={option.tierId}
              type="button"
              className="ram-install-tier-button"
              disabled={!upgrade.canAfford}
              title={title}
              onClick={() =>
                dispatch({
                  type: "buyUpgrade",
                  upgradeId: "ram",
                  ramTierId: option.tierId,
                })
              }
            >
              <Plus size={11} />
              <span className="ram-install-tier-spec">
                <strong>{tierLabel}</strong>
                <small>
                  {formatBits(option.sizeBits)} @ {formatClock(option.speedMt)}
                </small>
              </span>
              <ResourceCost
                costs={upgrade.costs}
                compact
                resources={resources}
              />
            </button>
          );
        })}
      </div>
    </div>
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
  const efficiencyLabel =
    slot.efficiency === undefined ? null : formatNumber(slot.efficiency);

  return (
    <button
      type="button"
      className={`ram-stick-module ${active ? "active" : ""} ${
        selected ? "selected" : ""
      } ram-stick-state-${stateClass}`}
      onClick={onSelect}
      aria-pressed={selected}
      title={`R${slot.id} - ${formatBits(slot.sizeBits)} - ${formatClock(slot.speedMt)}${
        efficiencyLabel ? ` - Eff ${efficiencyLabel}` : ""
      } - ${state}`}
    >
      <span className="ram-stick-module-head">
        <span className="ram-stick-label">R{slot.id}</span>
        <span className="ram-stick-module-foot">
          <span>{formatBits(slot.sizeBits)}</span>
          <span className="ram-stick-foot-sep" aria-hidden="true">·</span>
          <span>{formatClock(slot.speedMt)}</span>
        </span>
        {efficiencyLabel && (
          <span className="ram-stick-efficiency">
            Eff <strong>{efficiencyLabel}</strong>
          </span>
        )}
        <span className="ram-stick-module-pct">{pct}%</span>
      </span>
      <span className="ram-stick-module-meter" aria-hidden="true">
        {segments.length > 0 ? (
          <RamPressureMeter segments={segments} capacityBits={capacity} />
        ) : (
          <ModuleMeter value={0} />
        )}
      </span>
    </button>
  );
}
