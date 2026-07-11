import { Server, Store } from "lucide-react";
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
  RackComponentWarnings,
  RackQueueDisplayItem,
  UiRackData,
} from "./types";

interface SystemRackPanelProps {
  rack: UiRackData;
  activeSystemId: string;
  onOpenSystem: (systemId: string) => void;
  onOpenBuilder: () => void;
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
  const builderUnlocked =
    rack.presets.length > 0 || getBuilderGroups(rack.customBuilder).length > 0;

  const selectSystemScheduler = (systemId: string) => {
    dispatch({ type: "selectSystem", systemId });
    onSelectComponent(scopeSelectionToSystem(systemId, "scheduler"));
  };

  const openSystemDetail = (systemId: string) => {
    dispatch({ type: "selectSystem", systemId });
    onSelectComponent(
      scopeSelectionToSystem(
        systemId,
        getSelectedSystemComponent(selection) ?? "core:1",
      ),
    );
    onOpenSystem(systemId);
  };

  const toggleRackPower = (systemId: string, status: string) => {
    const powerState = normalizePowerState(status);
    if (powerState === "booting" || powerState === "shuttingDown") return;

    dispatch({
      type: "setPowerState",
      state: powerState === "off" ? "on" : "off",
      systemId,
    });

  };

  return (
    <SystemRack>
      <div className="system-rack-header">
        <span className="system-rack-title">
          <Server size={15} />
          <span>Fleet</span>
          <small>
            {rack.systems.length} system{rack.systems.length === 1 ? "" : "s"}
          </small>
        </span>
        {builderUnlocked && (
          <button
            type="button"
            className="rack-build-new"
            onClick={onOpenBuilder}
            title="Build or buy a fleet system"
            aria-label="Build or buy a fleet system"
          >
            <Store size={13} />
            <span>Build</span>
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
            onTogglePower={() => toggleRackPower(system.id, system.status)}
            onOpenDetail={() => openSystemDetail(system.id)}
            onSelectScheduler={() => selectSystemScheduler(system.id)}
            getComponentWarnings={getComponentWarnings}
            getSystemQueueDisplayItems={getSystemQueueDisplayItems}
          />
        ))}
      </div>
    </SystemRack>
  );
}
