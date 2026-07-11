import { Server, Store } from "lucide-react";
import {
  getSelectedSystemComponent,
  scopeSelectionToSystem,
  type SelectedComponent,
} from "../workbenchData";
import type { Dispatch } from "../uiActions";
import { getSystemStatusTone } from "./rackMetrics";
import type { RackView, UiRackData } from "./types";

interface RackStripProps {
  rack: UiRackData;
  activeSystemId: string;
  builderUnlocked: boolean;
  view: RackView;
  onHome: () => void;
  onSelectSystem: (systemId: string) => void;
  onOpenBuilder: () => void;
  selection: SelectedComponent;
  onSelectComponent: (component: SelectedComponent) => void;
  dispatch: Dispatch;
}

export function RackStrip({
  rack,
  activeSystemId,
  builderUnlocked,
  view,
  onHome,
  onSelectSystem,
  onOpenBuilder,
  selection,
  onSelectComponent,
  dispatch,
}: RackStripProps) {
  const activeComponent = getSelectedSystemComponent(selection) ?? "core:1";

  return (
    <div
      className={`rack-strip mode-${view}`}
      aria-label="Fleet quick switch"
    >
      <button
        type="button"
        className="rack-strip-home"
        onClick={onHome}
        title="Back to fleet"
        aria-label="Back to fleet"
      >
        <Server size={13} />
        <span>Fleet</span>
      </button>
      <div className="rack-strip-chips" role="tablist" aria-label="Fleet systems">
        {rack.systems.map((system, index) => {
          const isActiveSystem = system.id === activeSystemId;
          const selected = isActiveSystem && view === "detail";
          const statusTone = getSystemStatusTone(system.status);
          return (
            <button
              key={system.id}
              type="button"
              role="tab"
              className={`system-rack-slot system-rack-slot--chip status-${statusTone} ${
                selected ? "selected" : ""
              }`}
              aria-selected={selected}
              aria-label={`Open ${system.name}`}
              onClick={() => {
                dispatch({ type: "selectSystem", systemId: system.id });
                onSelectComponent(
                  scopeSelectionToSystem(system.id, activeComponent),
                );
                onSelectSystem(system.id);
              }}
              title={`Open ${system.name}`}
            >
              <span className="rack-slot-index">{index + 1}</span>
              <span className="rack-strip-system-name">{system.name}</span>
            </button>
          );
        })}
      </div>
      {builderUnlocked && (
        <button
          type="button"
          aria-pressed={view === "builder"}
          className={`rack-strip-build ${view === "builder" ? "selected" : ""}`}
          onClick={onOpenBuilder}
          title="Open the fleet builder"
          aria-label="Open the fleet builder"
        >
          <Store size={13} />
          <span className="rack-strip-build-label">Build</span>
        </button>
      )}
    </div>
  );
}
