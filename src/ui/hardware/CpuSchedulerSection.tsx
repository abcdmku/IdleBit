import type { MouseEvent } from "react";
import { ListTodo } from "lucide-react";
import type { VisibleCpuSocket, VisibleState, VisibleUpgrade } from "../../game";
import type { Dispatch } from "../uiActions";
import { QueuePreview } from "./QueuePreview";
import { InlineUpgradeRow } from "./UpgradeControls";
import { getQueueDisplayItems } from "./queueData";
import { SchedulerControls, SchedulerWatchdogStatus } from "./SchedulerControls";

export function SchedulerSection({
  socket,
  visible,
  selected,
  onSelect,
  dispatch,
}: {
  socket: VisibleCpuSocket;
  visible: VisibleState;
  selected: boolean;
  onSelect: () => void;
  dispatch: Dispatch;
}) {
  const queueItems = getQueueDisplayItems(visible, socket);
  const slotCapacity = socket.schedulerSlots;
  const schedulerUpgrades = [
    socket.schedulerSlotUpgrade,
    socket.deadlockRecoveryUpgrade,
  ].filter((upgrade): upgrade is VisibleUpgrade => Boolean(upgrade));
  const selectFromSection = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }

    onSelect();
  };

  return (
    <section
      className={`hw-section scheduler-section ${selected ? "selected" : ""} ${
        socket.deadlocked ? "deadlocked" : ""
      }`}
      onClick={selectFromSection}
    >
      <div className="hw-section-header-row scheduler-header-row">
        <button type="button" className="hw-section-header" onClick={onSelect}>
          <ListTodo size={14} />
          <span>Scheduler</span>
        </button>
        <SchedulerWatchdogStatus watchdog={socket.watchdog} sockets={[socket]} />
        <SchedulerControls
          visible={visible}
          config={socket.schedulerConfig}
          target="cpu"
          cpuId={socket.id}
          dispatch={dispatch}
        />
      </div>

      <QueuePreview
        items={queueItems}
        slotCapacity={slotCapacity}
        ariaLabel="Queued tasks"
        dispatch={dispatch}
      />

      {schedulerUpgrades.length > 0 && (
        <InlineUpgradeRow
          upgrades={schedulerUpgrades}
          resources={visible.resources}
          dispatch={dispatch}
          cpuId={socket.id}
        />
      )}
    </section>
  );
}

