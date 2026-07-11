import { Boxes, SlidersHorizontal } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import type { VisibleState } from "../../game";
import type { Dispatch } from "../uiActions";
import { getFleetComputeBaseline } from "./BuilderProjectionReadout";
import { getBuilderGroups } from "./builderHelpers";
import {
  CustomSystemBuilder,
  type CustomSystemBuilderDraft,
} from "./CustomSystemBuilder";
import { PremadeSystemList } from "./PremadeSystemList";
import type { UiRackData } from "./types";

type BuilderMode = "presets" | "advanced";

interface BuilderScreenProps {
  rack: UiRackData;
  resources: VisibleState["resources"];
  systemDispatch: Dispatch;
  customBuilderDraft?: CustomSystemBuilderDraft | null;
  onCustomBuilderDraftChange?: (draft: CustomSystemBuilderDraft) => void;
}

export function BuilderScreen({
  rack,
  resources,
  systemDispatch,
  customBuilderDraft = null,
  onCustomBuilderDraftChange,
}: BuilderScreenProps) {
  const tabsId = useId();
  const hasCustomBuilder = getBuilderGroups(rack.customBuilder).length > 0;
  const hasPresets = rack.presets.length > 0;
  const fleetBaseline = getFleetComputeBaseline(rack.systems);
  const [mode, setMode] = useState<BuilderMode>(
    hasPresets ? "presets" : "advanced",
  );
  const availableModes: BuilderMode[] = [
    ...(hasPresets ? (["presets"] as const) : []),
    ...(hasCustomBuilder ? (["advanced"] as const) : []),
  ];

  const selectAdjacentMode = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentMode: BuilderMode,
  ) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const currentIndex = Math.max(0, availableModes.indexOf(currentMode));
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? availableModes.length - 1
          : (currentIndex +
              (event.key === "ArrowRight" ? 1 : -1) +
              availableModes.length) %
            availableModes.length;
    const nextMode = availableModes[nextIndex];
    if (!nextMode) return;

    setMode(nextMode);
    document.getElementById(`${tabsId}-${nextMode}-tab`)?.focus();
  };

  return (
    <section className="builder-screen" aria-label="Fleet builder">
      <header className="fleet-builder-header">
        <div>
          <span className="fleet-builder-eyebrow">Workshop</span>
          <h2>Fleet Builder</h2>
          <p>Choose a ready-to-run preset or open Advanced for a custom system.</p>
        </div>
      </header>
      <div className="builder-screen-body">
        <div className="builder-new">
          <div
            className="builder-new-modes"
            role="tablist"
            aria-label="Fleet builder mode"
          >
            <button
              id={`${tabsId}-presets-tab`}
              type="button"
              role="tab"
              className={`builder-new-mode-tab builder-new-mode-presets ${
                mode === "presets" ? "active" : ""
              }`}
              aria-selected={mode === "presets"}
              aria-controls={`${tabsId}-presets-panel`}
              tabIndex={mode === "presets" ? 0 : -1}
              disabled={!hasPresets}
              onClick={() => setMode("presets")}
              onKeyDown={(event) => selectAdjacentMode(event, "presets")}
            >
              <Boxes size={14} aria-hidden="true" />
              <span>Presets</span>
            </button>
            <button
              id={`${tabsId}-advanced-tab`}
              type="button"
              role="tab"
              className={`builder-new-mode-tab builder-new-mode-advanced ${
                mode === "advanced" ? "active" : ""
              }`}
              aria-selected={mode === "advanced"}
              aria-controls={`${tabsId}-advanced-panel`}
              tabIndex={mode === "advanced" ? 0 : -1}
              disabled={!hasCustomBuilder}
              onClick={() => setMode("advanced")}
              onKeyDown={(event) => selectAdjacentMode(event, "advanced")}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              <span>Advanced</span>
            </button>
          </div>

          {mode === "presets" ? (
            <div
              id={`${tabsId}-presets-panel`}
              role="tabpanel"
              aria-labelledby={`${tabsId}-presets-tab`}
              className="builder-mode-panel"
            >
              {hasPresets ? (
                <PremadeSystemList
                  presets={rack.presets}
                  builder={rack.customBuilder}
                  resources={resources}
                  dispatch={systemDispatch}
                  fleetBaseline={fleetBaseline}
                />
              ) : (
                <p className="builder-mode-empty">No fleet presets are available.</p>
              )}
            </div>
          ) : (
            <div
              id={`${tabsId}-advanced-panel`}
              role="tabpanel"
              aria-labelledby={`${tabsId}-advanced-tab`}
              className="builder-mode-panel"
            >
              {hasCustomBuilder ? (
                <>
                  <p className="builder-projection-assumptions">
                    Peak-load projections use the selected hardware. Profitability is
                    the reward rate needed to cover power; workload fit still matters.
                  </p>
                  <CustomSystemBuilder
                    builder={rack.customBuilder}
                    resources={resources}
                    dispatch={systemDispatch}
                    draft={customBuilderDraft}
                    onDraftChange={onCustomBuilderDraftChange}
                    fleetBaseline={fleetBaseline}
                  />
                </>
              ) : (
                <p className="builder-mode-empty">
                  Advanced system assembly is not available.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
