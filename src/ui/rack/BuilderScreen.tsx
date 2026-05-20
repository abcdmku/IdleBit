import { useEffect, useState } from "react";
import { ShoppingCart, SlidersHorizontal, X } from "lucide-react";
import type { VisibleState, VisibleUpgrade } from "../../game";
import type { Dispatch } from "../uiActions";
import { getBuilderGroups } from "./builderHelpers";
import { BuilderConfigure } from "./BuilderConfigure";
import { CustomSystemBuilder } from "./CustomSystemBuilder";
import { PremadeSystemList } from "./PremadeSystemList";
import type {
  BuilderNewMode,
  BuilderTab,
  RenderBuilderUpgradeStepper,
  UiRackData,
  UiRackSystem,
} from "./types";

interface BuilderScreenProps {
  rack: UiRackData;
  activeSystem: UiRackSystem;
  tab: BuilderTab;
  onChangeTab: (tab: BuilderTab) => void;
  onClose: () => void;
  resources: VisibleState["resources"];
  systemDispatch: Dispatch;
  systemUpgrades: VisibleUpgrade[];
  renderUpgradeStepper: RenderBuilderUpgradeStepper;
}

export function BuilderScreen({
  rack,
  activeSystem,
  tab,
  onChangeTab,
  onClose,
  resources,
  systemDispatch,
  systemUpgrades,
  renderUpgradeStepper,
}: BuilderScreenProps) {
  const hasPresets = rack.presets.length > 0;
  const hasCustomBuilder = getBuilderGroups(rack.customBuilder).length > 0;
  const hasNew = hasPresets || hasCustomBuilder;
  const hasConfigure = systemUpgrades.length > 0;
  const effectiveTab: BuilderTab = (() => {
    if (tab === "configure" && hasConfigure) return "configure";
    if (tab === "new" && hasNew) return "new";
    if (hasNew) return "new";
    if (hasConfigure) return "configure";
    return "new";
  })();

  const [newMode, setNewMode] = useState<BuilderNewMode>(() =>
    hasPresets ? "premade" : "custom",
  );

  useEffect(() => {
    if (newMode === "premade" && !hasPresets && hasCustomBuilder) {
      setNewMode("custom");
    } else if (newMode === "custom" && !hasCustomBuilder && hasPresets) {
      setNewMode("premade");
    }
  }, [hasPresets, hasCustomBuilder, newMode]);

  const showModeTabs = hasPresets && hasCustomBuilder;
  const activeNewMode: BuilderNewMode = showModeTabs
    ? newMode
    : hasPresets
      ? "premade"
      : "custom";

  return (
    <section className="builder-screen" aria-label="System builder">
      <header className="builder-screen-header">
        <div className="builder-tabs" role="tablist">
          {hasNew && (
            <button
              type="button"
              role="tab"
              aria-selected={effectiveTab === "new"}
              className={`builder-tab ${effectiveTab === "new" ? "active" : ""}`}
              onClick={() => onChangeTab("new")}
            >
              <ShoppingCart size={12} />
              <span>New system</span>
            </button>
          )}
          {hasConfigure && (
            <button
              type="button"
              role="tab"
              aria-selected={effectiveTab === "configure"}
              className={`builder-tab ${
                effectiveTab === "configure" ? "active" : ""
              }`}
              onClick={() => onChangeTab("configure")}
            >
              <SlidersHorizontal size={12} />
              <span>Configure: {activeSystem.name}</span>
            </button>
          )}
        </div>
        <button
          type="button"
          className="builder-screen-close"
          onClick={onClose}
          title="Close builder"
          aria-label="Close builder"
        >
          <X size={14} />
        </button>
      </header>

      <div className="builder-screen-body">
        {effectiveTab === "new" ? (
          <div className="builder-new">
            {showModeTabs && (
              <div className="builder-new-modes" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeNewMode === "premade"}
                  className={`builder-new-mode-tab builder-new-mode-premade ${
                    activeNewMode === "premade" ? "active" : ""
                  }`}
                  onClick={() => setNewMode("premade")}
                >
                  <ShoppingCart size={12} />
                  <span>Premade systems</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeNewMode === "custom"}
                  className={`builder-new-mode-tab builder-new-mode-custom ${
                    activeNewMode === "custom" ? "active" : ""
                  }`}
                  onClick={() => setNewMode("custom")}
                >
                  <SlidersHorizontal size={12} />
                  <span>Custom build</span>
                </button>
              </div>
            )}

            {activeNewMode === "premade" && hasPresets && (
              <PremadeSystemList
                presets={rack.presets}
                builder={rack.customBuilder}
                resources={resources}
                dispatch={systemDispatch}
              />
            )}
            {activeNewMode === "custom" && hasCustomBuilder && (
              <CustomSystemBuilder
                builder={rack.customBuilder}
                resources={resources}
                dispatch={systemDispatch}
              />
            )}
          </div>
        ) : (
          <BuilderConfigure
            systemName={activeSystem.name}
            upgrades={systemUpgrades}
            resources={resources}
            dispatch={systemDispatch}
            renderUpgradeStepper={renderUpgradeStepper}
          />
        )}
      </div>
    </section>
  );
}
