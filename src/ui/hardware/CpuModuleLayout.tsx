import { Fragment } from "react";
import { ListTodo } from "lucide-react";
import type { VisibleCpuSocket, VisibleState, VisibleUpgrade } from "../../game";
import { CoreCacheRow } from "../MotherboardLayout";
import type { Dispatch } from "../uiActions";
import type { SelectedComponent } from "../workbenchData";
import { HardwareInstallSection } from "./HardwareInstallSection";
import { CacheSection } from "./CacheSection";
import { CoreArraySection } from "./CoreArraySection";
import { SchedulerSection } from "./SchedulerSections";
import { getCoreGridMetrics } from "./coreGrid";

export function CpuModuleLayout({
  socket,
  visible,
  schedulerVisible,
  selectedSchedulerId,
  selectedCoreId,
  cacheSelected,
  onSelectComponent,
  cpuUpgrades,
  dispatch,
  showCacheDeadlockHelp,
  showCacheDeadlockCooldownHelp,
  onDismissDeadlockHelp,
  onDismissDeadlockCooldownHelp,
  showCoreDeadlockPressure,
  standalone = false,
}: {
  socket: VisibleCpuSocket;
  visible: VisibleState;
  schedulerVisible: boolean;
  selectedSchedulerId: number | null;
  selectedCoreId: number | null;
  cacheSelected: boolean;
  onSelectComponent: (component: SelectedComponent) => void;
  cpuUpgrades: VisibleUpgrade[];
  dispatch: Dispatch;
  showCacheDeadlockHelp?: boolean;
  showCacheDeadlockCooldownHelp?: boolean;
  onDismissDeadlockHelp?: () => void;
  onDismissDeadlockCooldownHelp?: () => void;
  showCoreDeadlockPressure?: boolean;
  /** True when the layout renders without a CpuPackage frame; the core array
   *  then carries the socket's single Eff readout. */
  standalone?: boolean;
}) {
  const grid = getCoreGridMetrics(socket.cores.length);
  const schedulerInstalled = socket.schedulerSlots > 0;
  const scheduler = schedulerVisible ? (
    schedulerInstalled ? (
      <SchedulerSection
        socket={socket}
        visible={visible}
        selected={selectedSchedulerId === socket.id}
        onSelect={() => onSelectComponent(`scheduler:${socket.id}`)}
        dispatch={dispatch}
      />
    ) : (
      <HardwareInstallSection
        className="scheduler-section"
        Icon={ListTodo}
        title="Scheduler"
        note="Install first queue slot"
        upgrade={socket.schedulerSlotUpgrade}
        selected={selectedSchedulerId === socket.id}
        onSelect={() => onSelectComponent(`scheduler:${socket.id}`)}
        dispatch={dispatch}
        resources={visible.resources}
        cpuId={socket.id}
      />
    )
  ) : null;
  const cache = (
    <CacheSection
      socket={socket}
      selected={cacheSelected}
      onSelect={() => onSelectComponent("cache")}
      resources={visible.resources}
      dispatch={dispatch}
      deadlockPressure={visible.metrics.deadlockPressure}
      showDeadlockHelp={showCacheDeadlockHelp}
      showDeadlockCooldownHelp={showCacheDeadlockCooldownHelp}
      onDismissDeadlockHelp={onDismissDeadlockHelp}
      onDismissDeadlockCooldownHelp={onDismissDeadlockCooldownHelp}
    />
  );
  const cores = (
    <CoreArraySection
      socket={socket}
      selectedCoreId={selectedCoreId}
      onSelectCore={(coreId) => onSelectComponent(`core:${coreId}`)}
      cpuUpgrades={cpuUpgrades}
      resources={visible.resources}
      dispatch={dispatch}
      deadlockPressure={
        showCoreDeadlockPressure ? visible.metrics.deadlockPressure : null
      }
      showEfficiency={standalone}
    />
  );

  if (grid.fullWidth) {
    return (
      <Fragment>
        <div className={`scheduler-cache-row ${scheduler ? "" : "cache-only"}`}>
          {scheduler}
          {cache}
        </div>
        {cores}
      </Fragment>
    );
  }

  return (
    <Fragment>
      {scheduler}
      <CoreCacheRow>
        {cores}
        {cache}
      </CoreCacheRow>
    </Fragment>
  );
}

