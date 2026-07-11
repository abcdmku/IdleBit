import { Eye, Power } from "lucide-react";
import type { VisibleState } from "../../game";
import {
  formatBits,
  formatClock,
  formatResourceRate,
  formatWatts,
} from "../format";
import { getVisibleSystemSchedulerSlots } from "../tasks/taskData";
import { SystemWorkSummary } from "../work/SystemWorkSummary";
import { RackCpuBay } from "./RackCpuBay";
import { RackPowerBay } from "./RackPowerBay";
import { RackQueueBay } from "./RackQueueBay";
import { RackRamBay, type RackRamVisualSlot } from "./RackRamBay";
import {
  formatComputeRate,
  getSystemEffectiveComputePerSecond,
} from "./BuilderProjectionReadout";
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
  onTogglePower: () => void;
  onOpenDetail: () => void;
  onSelectScheduler: () => void;
  getComponentWarnings: (
    visible: VisibleState,
    status: string,
  ) => RackComponentWarnings;
  getSystemQueueDisplayItems: (visible: VisibleState) => RackQueueDisplayItem[];
}

/**
 * Rough live earn rate: per-core effective ops/s of the running tasks times
 * each task's credit reward per operation. An estimate only — it drives the
 * header profit LED, never economy math.
 */
const getEstimatedRewardRatePerSecond = (system: UiRackSystem) => {
  const perCoreOps =
    getSystemEffectiveComputePerSecond(system) / Math.max(1, system.cores);
  const taskById = new Map(system.visible.tasks.map((task) => [task.id, task]));

  return (system.visible.activeTasks ?? []).reduce((total, active) => {
    if (active.lockResource) return total;
    const task = taskById.get(active.taskId);
    if (!task || task.operationCount <= 0) return total;
    const coreCount = Math.max(1, active.assignedCoreIds?.length ?? 1);
    return (
      total + (perCoreOps * coreCount * task.rewardCredits) / task.operationCount
    );
  }, 0);
};

const getRamVisualSlots = (
  system: UiRackSystem,
  ramRatio: number,
): RackRamVisualSlot[] => {
  const visibleRamSlots = system.visible.metrics.ramSlots.slice(0, 64);
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
  onTogglePower,
  onOpenDetail,
  onSelectScheduler,
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
  const statusLabel =
    powerState === "shuttingDown"
      ? "Shutting down"
      : powerState.charAt(0).toUpperCase() + powerState.slice(1);
  const outputRate = formatComputeRate(getSystemEffectiveComputePerSecond(system));
  const runCostValue = formatResourceRate(system.powerCostPerSecond);
  // One signed number is the card's whole economics story: estimated reward
  // rate minus the run cost, green when earning, rose when draining.
  const netRate =
    getEstimatedRewardRatePerSecond(system) - system.powerCostPerSecond;
  const netTone =
    powerState === "off" ? "is-off" : netRate >= 0 ? "is-gain" : "is-drain";
  const netValue =
    powerState === "off"
      ? "off"
      : `${netRate < 0 ? "−" : "+"}${formatResourceRate(Math.abs(netRate))} cr/s`;
  const netTitle =
    powerState === "off"
      ? `${system.name} powered off — no reward, no run cost`
      : `Net ${netValue}: ${system.cores} core${
          system.cores === 1 ? "" : "s"
        } at ${formatClock(system.clockHz)} producing ${outputRate}, drawing ${formatWatts(
          system.drawWatts,
        )} of ${formatWatts(system.psuCapWatts ?? 0)} for ${runCostValue} cr/s run cost`;

  return (
    <div
      className={`system-rack-slot system-rack-slot--row ${
        selected ? "selected" : ""
      } status-${statusTone}`}
      role="group"
      aria-label={`${system.name} system`}
      aria-current={selected ? "true" : undefined}
    >
      {/* Stretched invisible control: clicking anywhere on the card body
          selects this system as the route target. Keyboard and assistive
          tech reach it as a normal button. */}
      <button
        type="button"
        className="rack-slot-select"
        aria-label={`Select ${system.name} scheduler`}
        aria-pressed={selected}
        title={`Select ${system.name} scheduler`}
        onClick={onSelectScheduler}
      />
      <span className="rack-slot-rail">
        <button
          type="button"
          className={`rack-slot-power-button ${system.status}`}
          aria-label={`${powerActionLabel} ${system.name}`}
          aria-disabled={powerTransitioning}
          disabled={powerTransitioning}
          title={`${powerActionLabel} ${system.name}`}
          onClick={onTogglePower}
        >
          <Power size={11} strokeWidth={2.6} />
        </button>
        <span className="rack-slot-index">{index + 1}</span>
        <button
          type="button"
          className="rack-slot-detail"
          aria-label={`Open ${system.name} details`}
          title={`Open ${system.name} details`}
          onClick={onOpenDetail}
        >
          <Eye size={12} aria-hidden="true" />
        </button>
      </span>

      <div className="rack-slot-copy">
        <header className="rack-slot-head">
          <strong>{system.name}</strong>
          <small>
            {system.role} · {statusLabel}
          </small>
          <span
            className={`rack-slot-net ${netTone}`}
            title={netTitle}
            aria-label={netTitle}
          >
            {netValue}
          </span>
        </header>
        <div className="rack-slot-visuals">
          <RackQueueBay
            items={systemQueueItems}
            slotCount={systemQueueSlotCount}
          />
          <RackCpuBay
            sockets={system.visible.metrics.cpuSockets}
            coreCount={system.cores}
            activeCount={system.activeTaskCount ?? 0}
            clockHz={system.clockHz}
            issue={componentWarnings.cpu}
            managedNames={(system.visible.activeWork ?? [])
              .filter(
                (item) =>
                  item.systemId !== null &&
                  String(item.systemId) === String(system.id),
              )
              .map((item) => item.name)}
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
        </div>
        <SystemWorkSummary visible={system.visible} systemId={system.id} compact />
      </div>
    </div>
  );
}
