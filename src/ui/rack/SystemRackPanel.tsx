import { useRef, type TouchEvent } from "react";
import { Plus, Server } from "lucide-react";
import type { VisibleState } from "../../game";
import { SystemRack } from "../MotherboardLayout";
import {
  getSelectedSystemComponent,
  scopeSelectionToSystem,
  type SelectedComponent,
} from "../workbenchData";
import type { Dispatch } from "../uiActions";
import { getBuilderGroups } from "./builderHelpers";
import { normalizePowerState } from "./rackPower";
import { RackSystemCard } from "./RackSystemCard";
import type {
  BuilderTab,
  RackComponentWarnings,
  RackQueueDisplayItem,
  UiRackData,
} from "./types";

const RACK_DOUBLE_TAP_MS = 360;

interface SystemRackPanelProps {
  rack: UiRackData;
  activeSystemId: string;
  onOpenSystem: (systemId: string) => void;
  onOpenBuilder: (tab: BuilderTab, systemId?: string) => void;
  selection: SelectedComponent;
  onSelectComponent: (component: SelectedComponent) => void;
  dispatch: Dispatch;
  getComponentWarnings: (
    visible: VisibleState,
    status: string,
  ) => RackComponentWarnings;
  getSystemQueueDisplayItems: (visible: VisibleState) => RackQueueDisplayItem[];
}

export function SystemRackPanel({
  rack,
  activeSystemId,
  onOpenSystem,
  onOpenBuilder,
  selection,
  onSelectComponent,
  dispatch,
  getComponentWarnings,
  getSystemQueueDisplayItems,
}: SystemRackPanelProps) {
  const activeComponent = getSelectedSystemComponent(selection) ?? "core:1";
  const lastTapRef = useRef<{ systemId: string; time: number } | null>(null);
  const builderUnlocked =
    rack.presets.length > 0 || getBuilderGroups(rack.customBuilder).length > 0;

  const selectSystemScheduler = (systemId: string) => {
    dispatch({ type: "selectSystem", systemId });
    onSelectComponent(scopeSelectionToSystem(systemId, "scheduler"));
  };

  const configureSystem = (systemId: string) => {
    dispatch({ type: "selectSystem", systemId });
    onSelectComponent(scopeSelectionToSystem(systemId, activeComponent));
    onOpenBuilder("configure", systemId);
  };

  const toggleRackPower = (systemId: string, status: string) => {
    const powerState = normalizePowerState(status);
    if (powerState === "booting" || powerState === "shuttingDown") return;

    dispatch({
      type: "setPowerState",
      state: powerState === "off" ? "on" : "off",
      systemId,
    });

    if (systemId !== activeSystemId) {
      dispatch({ type: "selectSystem", systemId: activeSystemId });
    }
  };

  const handleRackTouchEnd = (
    event: TouchEvent<HTMLButtonElement>,
    systemId: string,
  ) => {
    const now = event.timeStamp;
    const lastTap = lastTapRef.current;
    lastTapRef.current = { systemId, time: now };

    if (
      lastTap?.systemId === systemId &&
      now - lastTap.time <= RACK_DOUBLE_TAP_MS
    ) {
      onOpenSystem(systemId);
      lastTapRef.current = null;
    }
  };

  return (
    <SystemRack>
      <div className="system-rack-header">
        <span className="system-rack-title">
          <Server size={14} />
          <span>Rack</span>
          <small>
            {rack.systems.length} unit{rack.systems.length === 1 ? "" : "s"}
          </small>
        </span>
        {builderUnlocked && (
          <button
            type="button"
            className="rack-build-new"
            onClick={() => onOpenBuilder("new")}
            title="Open builder to buy a new system"
          >
            <Plus size={12} />
            <span>Build New</span>
          </button>
        )}
      </div>

      <div className="system-rack-slots" aria-label="Owned systems">
        {rack.systems.map((system, index) => (
          <RackSystemCard
            key={system.id}
            system={system}
            index={index}
            selected={system.id === activeSystemId}
            builderUnlocked={builderUnlocked}
            onTogglePower={() => toggleRackPower(system.id, system.status)}
            onConfigure={() => configureSystem(system.id)}
            onOpenDetail={() => onOpenSystem(system.id)}
            onSelectScheduler={() => selectSystemScheduler(system.id)}
            onTouchEnd={(event) => handleRackTouchEnd(event, system.id)}
            getComponentWarnings={getComponentWarnings}
            getSystemQueueDisplayItems={getSystemQueueDisplayItems}
          />
        ))}
      </div>
    </SystemRack>
  );
}
