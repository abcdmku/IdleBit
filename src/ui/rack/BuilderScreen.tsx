import { useEffect, useState } from "react";
import { ShoppingCart, SlidersHorizontal } from "lucide-react";
import type { VisibleState } from "../../game";
import type { Dispatch } from "../uiActions";
import { getBuilderGroups } from "./builderHelpers";
import { CustomSystemBuilder } from "./CustomSystemBuilder";
import { PremadeSystemList } from "./PremadeSystemList";
import type { BuilderNewMode, UiRackData } from "./types";

interface BuilderScreenProps {
  rack: UiRackData;
  resources: VisibleState["resources"];
  systemDispatch: Dispatch;
}

export function BuilderScreen({
  rack,
  resources,
  systemDispatch,
}: BuilderScreenProps) {
  const hasPresets = rack.presets.length > 0;
  const hasCustomBuilder = getBuilderGroups(rack.customBuilder).length > 0;

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
      <div className="builder-screen-body">
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
                <span>Premade</span>
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
                <span>Custom</span>
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
      </div>
    </section>
  );
}
