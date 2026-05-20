import { Plus, Server } from "lucide-react";
import { getSelectedSystemComponent, scopeSelectionToSystem, type SelectedComponent } from "../workbenchData";
import type { Dispatch } from "../uiActions";
import { getSystemStatusTone } from "./rackMetrics";
import type { BuilderTab, RackView, UiRackData } from "./types";

interface RackStripProps {
  rack: UiRackData;
  activeSystemId: string;
  builderUnlocked: boolean;
  view: RackView;
  builderTab: BuilderTab;
  onHome: () => void;
  onSelectSystem: (systemId: string) => void;
  onOpenBuilder: (tab: BuilderTab, systemId?: string) => void;
  selection: SelectedComponent;
  onSelectComponent: (component: SelectedComponent) => void;
  dispatch: Dispatch;
}

export function RackStrip({
  rack,
  activeSystemId,
  builderUnlocked,
  view,
  builderTab,
  onHome,
  onSelectSystem,
  onOpenBuilder,
  selection,
  onSelectComponent,
  dispatch,
}: RackStripProps) {
  const activeComponent = getSelectedSystemComponent(selection) ?? "core:1";
  const stayInBuilderConfigure =
    view === "builder" && builderTab === "configure";

  return (
    <div
      className={`rack-strip mode-${view}${
        view === "builder" ? ` builder-tab-${builderTab}` : ""
      }`}
      aria-label="Rack quick switch"
    >
      <button
        type="button"
        className="rack-strip-home"
        onClick={onHome}
        title="Back to rack"
        aria-label="Back to rack"
      >
        <Server size={13} />
        <span>Rack</span>
      </button>
      <div className="rack-strip-chips" role="tablist">
        {rack.systems.map((system, index) => {
          const isActiveSystem = system.id === activeSystemId;
          const selected =
            isActiveSystem && (view === "detail" || stayInBuilderConfigure);
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
              aria-pressed={selected}
              onClick={() => {
                dispatch({ type: "selectSystem", systemId: system.id });
                onSelectComponent(
                  scopeSelectionToSystem(system.id, activeComponent),
                );
                if (view === "builder") {
                  onOpenBuilder("configure", system.id);
                } else {
                  onSelectSystem(system.id);
                }
              }}
              title={
                view === "builder"
                  ? `Configure system ${index + 1}`
                  : `Open system ${index + 1}`
              }
            >
              <span className="rack-slot-index">{index + 1}</span>
            </button>
          );
        })}
      </div>
      {builderUnlocked && (
        <button
          type="button"
          role="tab"
          aria-selected={view === "builder" && builderTab === "new"}
          className={`rack-strip-build ${
            view === "builder" && builderTab === "new" ? "selected" : ""
          }`}
          onClick={() => onOpenBuilder("new")}
          title="Build a new system"
          aria-label="Build a new system"
        >
          <Plus size={13} />
          <span className="rack-strip-build-label">Build</span>
        </button>
      )}
    </div>
  );
}
