import type { MouseEvent } from "react";
import { ListTodo } from "lucide-react";
import type { VisibleState, VisibleUpgrade } from "../../game";
import { getVisibleSystemSchedulerSlots } from "../tasks/taskData";
import type { Dispatch } from "../uiActions";
import { HardwareInstallSection } from "./HardwareInstallSection";
import { PowerTransitionBanner, SystemShutdownControl } from "./PowerControls";
import { QueuePreview } from "./QueuePreview";
import { InlineUpgradeRow } from "./UpgradeControls";
import {
  getSystemQueueDisplayItems,
  getSystemSchedulerBlockedReasons,
} from "./queueData";
import { getPowerStats } from "./systemLoad";
import { SchedulerControls, SchedulerWatchdogStatus } from "./SchedulerControls";

export function SystemSchedulerSection({
  visible,
  selected,
  onSelect,
  upgrades,
  dispatch,
}: {
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
}) {
  const queueItems = getSystemQueueDisplayItems(visible);
  const blockedReasons = getSystemSchedulerBlockedReasons(visible, queueItems);
  const blockedReasonText = blockedReasons.join(" / ");
  const slotCapacity = getVisibleSystemSchedulerSlots(visible);
  const deadlocked = queueItems.some((item) => item.deadlocked);
  const power = getPowerStats(visible);
  const installUpgrade = upgrades.find((upgrade) => upgrade.id === "systemSchedulerSlot");
  const selectFromSection = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }

    onSelect();
  };

  if (slotCapacity <= 0) {
    return (
      <HardwareInstallSection
        className="scheduler-section system-scheduler-section"
        Icon={ListTodo}
        title="System Scheduler"
        note="Install first system queue slot"
        upgrade={installUpgrade}
        selected={selected}
        onSelect={onSelect}
        dispatch={dispatch}
        resources={visible.resources}
      />
    );
  }

  return (
    <section
      className={`hw-section scheduler-section system-scheduler-section ${
        selected ? "selected" : ""
      } ${deadlocked ? "deadlocked" : ""}`}
      onClick={selectFromSection}
    >
      <div className="hw-section-header-row scheduler-header-row">
        <button type="button" className="hw-section-header" onClick={onSelect}>
          <ListTodo size={14} />
          <span>System Scheduler</span>
        </button>
        <SchedulerWatchdogStatus
          watchdog={visible.metrics.systemSchedulerWatchdog}
          sockets={visible.metrics.cpuSockets}
        />
        <SchedulerControls
          visible={visible}
          config={visible.hardware.systemSchedulerConfig}
          target="system"
          dispatch={dispatch}
        />
        <SystemShutdownControl power={power} dispatch={dispatch} />
      </div>

      <PowerTransitionBanner power={power} surface="system" />

      <QueuePreview
        items={queueItems}
        slotCapacity={slotCapacity}
        ariaLabel="System scheduler queue"
        dispatch={dispatch}
        startSmall
      />

      {blockedReasons.length > 0 && (
        <div className="system-scheduler-blocked-reasons" title={blockedReasonText}>
          <strong>Blocked</strong>
          <span>{blockedReasonText}</span>
        </div>
      )}

      <InlineUpgradeRow
        upgrades={upgrades}
        resources={visible.resources}
        dispatch={dispatch}
      />
    </section>
  );
}
