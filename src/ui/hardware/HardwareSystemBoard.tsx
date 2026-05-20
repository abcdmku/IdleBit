import { Fragment, useState, type ReactNode } from "react";
import type {
  DeadlockResource,
  HardwareComponentId,
  VisibleCpuSocket,
  VisibleState,
} from "../../game";
import { SystemBoard, SystemRail } from "../MotherboardLayout";
import {
  getSelectedCoreGroupCpuId,
  getSelectedCoreId,
  getSelectedRamStickId,
  getSelectedSchedulerId,
  isRamSelection,
} from "../panels/selectionIds";
import {
  getQueueEntries,
  getVisibleSystemSchedulerSlots,
  hasSystemMemory,
} from "../tasks/taskData";
import type { Dispatch } from "../uiActions";
import type { SelectedComponent } from "../workbenchData";
import { PsuSection } from "./PsuSection";
import { RamSection } from "./RamSection";
import {
  CpuBank,
  CpuModuleLayout,
  CpuPackage,
  CronAutomationSection,
  EmptySocketSection,
  SystemSchedulerSection,
  getPowerControls,
  getPowerStats,
  getRamReservation,
  getSystemLoad,
  hasCronScheduler,
  hasPsuManagement,
  type CpuBankView,
} from "./SystemBoardSections";
import { ThermalSection } from "./ThermalSection";
import { useActiveCpuSocket } from "./useActiveCpuSocket";

interface HardwareSystemBoardProps {
  visible: VisibleState;
  dispatch: Dispatch;
  selectedComponent: SelectedComponent;
  onSelectComponent: (component: SelectedComponent) => void;
  deadlockHelpResource?: DeadlockResource | null;
  deadlockCooldownHelpResource?: DeadlockResource | null;
  showPsuFailureHelp?: boolean;
  onDismissDeadlockHelp?: () => void;
  onDismissDeadlockCooldownHelp?: () => void;
  onDismissPsuFailureHelp?: () => void;
}

export function HardwareSystemBoard({
  visible,
  dispatch,
  selectedComponent,
  onSelectComponent,
  deadlockHelpResource = null,
  deadlockCooldownHelpResource = null,
  showPsuFailureHelp = false,
  onDismissDeadlockHelp,
  onDismissDeadlockCooldownHelp,
  onDismissPsuFailureHelp,
}: HardwareSystemBoardProps) {
  const selectedCoreId = getSelectedCoreId(selectedComponent);
  const selectedCoreGroupCpuId = getSelectedCoreGroupCpuId(selectedComponent);
  const selectedSchedulerId = getSelectedSchedulerId(selectedComponent);
  const selectedRamStickId = getSelectedRamStickId(selectedComponent);
  const selectedAllRamSticks = selectedComponent === "ramSticks";
  const schedulerVisible =
    visible.flags.basicQueue ||
    visible.flags.scheduler ||
    getQueueEntries(visible).length > 0;
  const allCoreTuningVisible = visible.flags.basicQueue || visible.flags.scheduler;
  const cronVisible = hasCronScheduler(visible);
  const systemSchedulerVisible = visible.flags.scheduler;
  const systemSchedulerInstalled = getVisibleSystemSchedulerSlots(visible) > 0;
  const memoryVisible = hasSystemMemory(visible);
  const psuAdvancedControlsVisible = hasPsuManagement(visible);
  const psuVisible = true;
  const thermalVisible = false;
  const upgradesFor = (component: HardwareComponentId) =>
    visible.upgrades.filter((upgrade) => upgrade.component === component);

  const cpuUpgrades = upgradesFor("cpu");
  const ramUpgrades = upgradesFor("ram");
  const psuUpgrades = upgradesFor("psu");
  const socketUpgrades = upgradesFor("socket");
  const cronUpgrades = upgradesFor("cron");
  const systemSchedulerUpgrades = upgradesFor("scheduler").filter(
    (upgrade) => upgrade.id === "systemSchedulerSlot",
  );

  const cpuSelected = selectedComponent === "cpu";
  const cacheSelected = selectedComponent === "cache";

  const sockets = visible.metrics.cpuSockets;
  const cacheHelpCpuId =
    (deadlockHelpResource === "cache" || deadlockCooldownHelpResource === "cache")
      ? (visible.metrics.deadlocks.find((deadlock) => deadlock.resource === "cache")
          ?.cpuId ?? null)
      : null;
  const showDeadlockHelp = (resource: DeadlockResource) =>
    deadlockHelpResource === resource;
  const showDeadlockCooldownHelp = (resource: DeadlockResource) =>
    deadlockCooldownHelpResource === resource;
  const showSocketLabel = sockets.length > 1;
  const showEmptySocket = !visible.hardware.secondCpu && visible.flags.secondCpu;
  const railVisible = psuVisible || thermalVisible;
  const multiCpu = sockets.length >= 2;
  const boardSystemLoad = getSystemLoad(visible);
  const boardPower = getPowerStats(visible);
  const boardPowerControls = getPowerControls(visible, boardPower.state);
  const boardRamReservation = getRamReservation(visible);

  const [bankView, setBankView] = useState<CpuBankView>("array");
  const { activeSocketId, setActiveSocketId } = useActiveCpuSocket(
    sockets,
    selectedSchedulerId,
    selectedCoreId,
  );

  const selectCpuOrScheduler = (socketId: number) => {
    if (schedulerVisible) onSelectComponent(`scheduler:${socketId}`);
    else onSelectComponent("cpu");
  };

  const renderSocket = (socket: VisibleCpuSocket): ReactNode => {
    const moduleLayout = (
      <CpuModuleLayout
        socket={socket}
        visible={visible}
        schedulerVisible={schedulerVisible}
        selectedSchedulerId={selectedSchedulerId}
        selectedCoreId={selectedCoreId}
        selectedCoreGroupCpuId={selectedCoreGroupCpuId}
        allCoreTuningVisible={allCoreTuningVisible}
        cacheSelected={cacheSelected}
        onSelectComponent={onSelectComponent}
        cpuUpgrades={cpuUpgrades}
        dispatch={dispatch}
        showCacheDeadlockHelp={
          deadlockHelpResource === "cache" && cacheHelpCpuId === socket.id
        }
        showCacheDeadlockCooldownHelp={
          showDeadlockCooldownHelp("cache") && cacheHelpCpuId === socket.id
        }
        onDismissDeadlockHelp={onDismissDeadlockHelp}
        onDismissDeadlockCooldownHelp={onDismissDeadlockCooldownHelp}
        showCoreDeadlockPressure={!memoryVisible}
      />
    );

    if (!memoryVisible) {
      return <Fragment key={socket.id}>{moduleLayout}</Fragment>;
    }

    return (
      <CpuPackage
        key={socket.id}
        socket={socket}
        selected={cpuSelected}
        showSocketLabel={showSocketLabel}
        onSelect={() => onSelectComponent("cpu")}
        cpuUpgrades={cpuUpgrades}
        resources={visible.resources}
        dispatch={dispatch}
        deadlockPressure={visible.metrics.deadlockPressure}
      >
        {moduleLayout}
      </CpuPackage>
    );
  };

  return (
    <SystemBoard visible={visible}>
      {cronVisible && (
        <CronAutomationSection
          visible={visible}
          selected={selectedComponent === "cron"}
          onSelect={() => onSelectComponent("cron")}
          upgrades={cronUpgrades}
          dispatch={dispatch}
        />
      )}

      {systemSchedulerVisible && (
        <SystemSchedulerSection
          visible={visible}
          selected={selectedComponent === "scheduler"}
          onSelect={() => onSelectComponent("scheduler")}
          upgrades={systemSchedulerUpgrades}
          dispatch={dispatch}
        />
      )}

      {memoryVisible && (
        <RamSection
          visible={visible}
          status={boardSystemLoad}
          ramReservation={boardRamReservation}
          selected={isRamSelection(selectedComponent)}
          selectedRamStickId={selectedRamStickId}
          selectedAllRamSticks={selectedAllRamSticks}
          onSelect={() => onSelectComponent("ram")}
          onSelectStick={(stickId) => onSelectComponent(`ramStick:${stickId}`)}
          onSelectAllSticks={() => onSelectComponent("ramSticks")}
          upgrades={ramUpgrades}
          dispatch={dispatch}
          showDeadlockHelp={showDeadlockHelp("ram")}
          showDeadlockCooldownHelp={showDeadlockCooldownHelp("ram")}
          onDismissDeadlockHelp={onDismissDeadlockHelp}
          onDismissDeadlockCooldownHelp={onDismissDeadlockCooldownHelp}
        />
      )}

      {multiCpu ? (
        <CpuBank
          sockets={sockets}
          view={bankView}
          onChangeView={setBankView}
          activeSocketId={activeSocketId}
          onSelectTab={(socketId) => {
            setActiveSocketId(socketId);
            selectCpuOrScheduler(socketId);
          }}
          onOpenSocket={(socketId) => {
            setActiveSocketId(socketId);
            setBankView("tabs");
            selectCpuOrScheduler(socketId);
          }}
          onSelectCore={(socketId, coreId) => {
            setActiveSocketId(socketId);
            onSelectComponent(`core:${coreId}`);
          }}
          renderSocket={renderSocket}
          schedulerVisible={schedulerVisible}
          visible={visible}
          resources={visible.resources}
          dispatch={dispatch}
          socketUpgrades={socketUpgrades}
        />
      ) : (
        sockets.map(renderSocket)
      )}

      {showEmptySocket && (
        <EmptySocketSection
          selected={selectedComponent === "socket"}
          onSelect={() => onSelectComponent("socket")}
          upgrades={socketUpgrades}
          resources={visible.resources}
          dispatch={dispatch}
        />
      )}

      {railVisible && (
        <SystemRail>
          {psuVisible && (
            <PsuSection
              visible={visible}
              power={boardPower}
              powerControls={boardPowerControls}
              selected={selectedComponent === "psu"}
              onSelect={() => onSelectComponent("psu")}
              upgrades={psuUpgrades}
              dispatch={dispatch}
              advancedControls={psuAdvancedControlsVisible}
              showTransitionStatus={!systemSchedulerInstalled}
              showFailureHelp={showPsuFailureHelp}
              onDismissFailureHelp={onDismissPsuFailureHelp}
            />
          )}
          {thermalVisible && (
            <ThermalSection
              visible={visible}
              status={boardSystemLoad}
              selected={selectedComponent === "thermal"}
              onSelect={() => onSelectComponent("thermal")}
              upgrades={psuUpgrades}
              dispatch={dispatch}
              unlocked={false}
            />
          )}
        </SystemRail>
      )}
    </SystemBoard>
  );
}
