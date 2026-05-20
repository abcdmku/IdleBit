import type { TouchEvent } from "react";
import { Eye, Power, SlidersHorizontal } from "lucide-react";
import type { VisibleState } from "../../game";
import { formatBits } from "../format";
import { getVisibleSystemSchedulerSlots } from "../tasks/taskData";
import { RackCpuBay } from "./RackCpuBay";
import { RackPowerBay } from "./RackPowerBay";
import { RackQueueBay } from "./RackQueueBay";
import { RackRamBay, type RackRamVisualSlot } from "./RackRamBay";
import { getRackPipIndexes, getSystemStatusTone } from "./rackMetrics";
import { normalizePowerState } from "./rackPower";
import type {
  RackComponentWarnings,
  RackQueueDisplayItem,
  UiRackSystem,
} from "./types";

interface RackSystemCardProps {
  system: UiRackSystem;
  index: number;
  selected: boolean;
  builderUnlocked: boolean;
  onTogglePower: () => void;
  onConfigure: () => void;
  onOpenDetail: () => void;
  onSelectScheduler: () => void;
  onTouchEnd: (event: TouchEvent<HTMLButtonElement>) => void;
  getComponentWarnings: (
    visible: VisibleState,
    status: string,
  ) => RackComponentWarnings;
  getSystemQueueDisplayItems: (visible: VisibleState) => RackQueueDisplayItem[];
}

const getRamVisualSlots = (
  system: UiRackSystem,
  ramRatio: number,
): RackRamVisualSlot[] => {
  const visibleRamSlots = system.visible.metrics.ramSlots.slice(0, 32);
  const fallbackActiveRamSticks =
    system.ramBits > 0 ? Math.min(4, Math.ceil(ramRatio * 4)) : 0;

  return visibleRamSlots.length > 0
    ? visibleRamSlots.map((slot) => ({
        id: String(slot.id),
        ratio: slot.sizeBits > 0 ? slot.usedBits / slot.sizeBits : 0,
        populated: slot.sizeBits > 0,
        active: slot.usedBits > 0,
        title: `RAM ${slot.id}: ${formatBits(slot.usedBits)} / ${formatBits(slot.sizeBits)}`,
      }))
    : getRackPipIndexes(system.ramBits > 0 ? 4 : 0).map((slotIndex) => ({
        id: `fallback-${slotIndex}`,
        ratio: ramRatio,
        populated: system.ramBits > 0,
        active: slotIndex < fallbackActiveRamSticks,
        title: `RAM ${formatBits(system.ramUsedBits ?? 0)} / ${formatBits(system.ramBits)}`,
      }));
};

export function RackSystemCard({
  system,
  index,
  selected,
  builderUnlocked,
  onTogglePower,
  onConfigure,
  onOpenDetail,
  onSelectScheduler,
  onTouchEnd,
  getComponentWarnings,
  getSystemQueueDisplayItems,
}: RackSystemCardProps) {
  const ramRatio =
    system.ramBits > 0 ? (system.ramUsedBits ?? 0) / system.ramBits : 0;
  const componentWarnings = getComponentWarnings(system.visible, system.status);
  const statusTone = componentWarnings.off
    ? "off"
    : componentWarnings.any
      ? "warning"
      : getSystemStatusTone(system.status);
  const systemQueueItems = getSystemQueueDisplayItems(system.visible);
  const systemQueueSlotCount = Math.max(
    getVisibleSystemSchedulerSlots(system.visible),
    systemQueueItems.length,
  );
  const ramVisualSlots = getRamVisualSlots(system, ramRatio);
  const powerState = normalizePowerState(system.status);
  const powerTransitioning =
    powerState === "booting" || powerState === "shuttingDown";
  const powerActionLabel = powerState === "off" ? "Power on" : "Power off";

  return (
    <div
      className={`system-rack-slot system-rack-slot--row ${
        selected ? "selected" : ""
      } status-${statusTone}`}
      role="group"
      aria-label={`System ${index + 1} rack unit`}
      aria-current={selected ? "true" : undefined}
    >
      <span className="rack-slot-rail">
        <button
          type="button"
          className={`rack-slot-power-button ${system.status}`}
          aria-label={`${powerActionLabel} system ${index + 1}`}
          aria-disabled={powerTransitioning}
          disabled={powerTransitioning}
          title={`${powerActionLabel} system ${index + 1}`}
          onClick={onTogglePower}
        >
          <Power size={11} strokeWidth={2.6} />
        </button>
        <span className="rack-slot-index">{index + 1}</span>
        {builderUnlocked && (
          <button
            type="button"
            className="rack-slot-config"
            aria-label={`Configure system ${index + 1}`}
            title={`Configure system ${index + 1}`}
            onClick={onConfigure}
          >
            <SlidersHorizontal size={12} />
          </button>
        )}
        <button
          type="button"
          className="rack-slot-config rack-slot-detail"
          aria-label={`Open system ${index + 1} detail`}
          title={`Open system ${index + 1} detail`}
          onClick={onOpenDetail}
        >
          <Eye size={12} />
        </button>
      </span>
      <button
        type="button"
        className="rack-slot-visuals"
        aria-label={`Select system ${index + 1} scheduler; double click to open detail`}
        aria-pressed={selected}
        onClick={onSelectScheduler}
        onDoubleClick={onOpenDetail}
        onTouchEnd={onTouchEnd}
        title={`Select system ${index + 1} scheduler; double click to open detail`}
      >
        <RackQueueBay items={systemQueueItems} slotCount={systemQueueSlotCount} />
        <RackCpuBay
          sockets={system.visible.metrics.cpuSockets}
          coreCount={system.cores}
          activeCount={system.activeTaskCount ?? 0}
          clockHz={system.clockHz}
          issue={componentWarnings.cpu}
        />
        <RackRamBay
          usedBits={system.ramUsedBits ?? 0}
          totalBits={system.ramBits}
          slots={ramVisualSlots}
          issue={componentWarnings.ram}
        />
        <RackPowerBay
          drawWatts={system.drawWatts}
          capWatts={system.psuCapWatts ?? 0}
          powerCostPerSecond={system.powerCostPerSecond}
          issue={componentWarnings.psu}
        />
      </button>
    </div>
  );
}
