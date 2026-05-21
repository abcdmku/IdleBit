import { useEffect, useState } from "react";
import type { DeadlockResource, VisibleState } from "../game";
import { HardwareSystemBoard } from "./hardware/HardwareSystemBoard";
import { getSystemQueueDisplayItems } from "./hardware/SystemBoardSections";
import { UpgradeStepper } from "./hardware/UpgradeControls";
import { getSystemScopedAction } from "./panels/systemScopedAction";
import {
  BuilderScreen,
  RackStrip,
  SystemRackPanel,
  getBuilderGroups,
  getFallbackRackSystem,
  getRackComponentWarnings,
  getRackData,
  type BuilderTab,
  type RackView,
} from "./rack";
import type { Dispatch } from "./uiActions";
import {
  getSelectedSystemComponent,
  getSelectedSystemId,
  scopeSelectionToSystem,
  type SelectedComponent,
} from "./workbenchData";

export { PinnedTaskBar } from "./tasks/PinnedTaskBar";
export { ResearchPanel } from "./tasks/ResearchPanel";
export { TaskBay } from "./tasks/TaskBay";

interface HardwareBoardProps {
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

const createSystemDispatch =
  (dispatch: Dispatch, systemId: string | null): Dispatch =>
  (action) =>
    dispatch(getSystemScopedAction(action, systemId));

export function HardwareBoard({
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
}: HardwareBoardProps) {
  const rack = getRackData(visible);
  const requestedSystemId =
    getSelectedSystemId(selectedComponent) ?? rack.selectedSystemId;
  const scopedSelectionRequested = getSelectedSystemId(selectedComponent) !== null;
  const rackActive = rack.showRack || scopedSelectionRequested;
  const activeSystem = rackActive
    ? (rack.systems.find((system) => system.id === requestedSystemId) ??
      rack.systems[0] ??
      getFallbackRackSystem(visible))
    : getFallbackRackSystem(visible);

  const [rackView, setRackView] = useState<RackView>("list");
  const [builderTab, setBuilderTab] = useState<BuilderTab>("new");

  const builderUnlocked =
    rack.presets.length > 0 || getBuilderGroups(rack.customBuilder).length > 0;
  const effectiveRackView =
    rack.showRack && rack.systems.length === 1 && rackView === "list"
      ? "detail"
      : rackView;

  useEffect(() => {
    if (!rack.showRack && rackView !== "list") {
      setRackView("list");
    }
  }, [rack.showRack, rackView]);

  const openSystemDetail = (_systemId: string) => {
    if (!rack.showRack) return;
    setRackView("detail");
  };

  const openBuilder = (tab: BuilderTab, _systemId?: string) => {
    if (!rack.showRack && !builderUnlocked) return;
    setBuilderTab(tab);
    setRackView("builder");
  };

  const backToRack = () => setRackView("list");
  const useTopLevelSingleSystem =
    rack.showRack &&
    rack.systems.length === 1 &&
    effectiveRackView === "detail" &&
    !scopedSelectionRequested;
  const boardVisible = useTopLevelSingleSystem ? visible : activeSystem.visible;
  const boardSelection =
    getSelectedSystemComponent(selectedComponent) ?? ("core:1" as SelectedComponent);
  const shouldScopeSystemActions = rackActive && !useTopLevelSingleSystem;
  const selectComponent = (component: SelectedComponent) =>
    onSelectComponent(
      shouldScopeSystemActions && rack.hasSystemModel
        ? scopeSelectionToSystem(activeSystem.id, component)
        : component,
    );
  const systemDispatch = createSystemDispatch(
    dispatch,
    shouldScopeSystemActions && rack.hasSystemModel ? activeSystem.id : null,
  );

  const systemBoardNode = (
    <HardwareSystemBoard
      visible={boardVisible}
      dispatch={systemDispatch}
      selectedComponent={boardSelection}
      onSelectComponent={selectComponent}
      deadlockHelpResource={deadlockHelpResource}
      deadlockCooldownHelpResource={deadlockCooldownHelpResource}
      showPsuFailureHelp={showPsuFailureHelp}
      onDismissDeadlockHelp={onDismissDeadlockHelp}
      onDismissDeadlockCooldownHelp={onDismissDeadlockCooldownHelp}
      onDismissPsuFailureHelp={onDismissPsuFailureHelp}
    />
  );

  if (!rack.showRack) {
    return systemBoardNode;
  }

  if (effectiveRackView === "list") {
    return (
      <SystemRackPanel
        rack={rack}
        activeSystemId={activeSystem.id}
        onOpenSystem={openSystemDetail}
        onOpenBuilder={openBuilder}
        selection={selectedComponent}
        onSelectComponent={onSelectComponent}
        dispatch={systemDispatch}
        getComponentWarnings={getRackComponentWarnings}
        getSystemQueueDisplayItems={getSystemQueueDisplayItems}
      />
    );
  }

  const strip = (
    <RackStrip
      rack={rack}
      activeSystemId={activeSystem.id}
      builderUnlocked={builderUnlocked}
      view={effectiveRackView}
      builderTab={builderTab}
      onHome={backToRack}
      onSelectSystem={openSystemDetail}
      onOpenBuilder={openBuilder}
      selection={selectedComponent}
      onSelectComponent={onSelectComponent}
      dispatch={systemDispatch}
    />
  );

  if (effectiveRackView === "builder") {
    return (
      <div className="rack-mode-builder">
        {strip}
        <BuilderScreen
          rack={rack}
          activeSystem={activeSystem}
          tab={builderTab}
          onChangeTab={setBuilderTab}
          onClose={backToRack}
          resources={visible.resources}
          systemDispatch={systemDispatch}
          systemUpgrades={boardVisible.upgrades}
          renderUpgradeStepper={(upgrade, className) => (
            <UpgradeStepper
              key={upgrade.id}
              upgrade={upgrade}
              dispatch={systemDispatch}
              label={upgrade.name}
              className={className}
              resources={visible.resources}
            />
          )}
        />
      </div>
    );
  }

  return (
    <div className="rack-mode-detail">
      {strip}
      {systemBoardNode}
    </div>
  );
}
