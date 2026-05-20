import { Thermometer } from "lucide-react";
import type { VisibleState, VisibleUpgrade } from "../../game";
import type { Dispatch } from "../uiActions";
import { formatHardwarePercent } from "./display";
import { LockedSystemSection } from "./HardwareInstallSection";
import { ModuleMeter } from "./meters";
import { getStressTone } from "./stressTone";
import { UpgradeStepper } from "./UpgradeControls";
import type { SystemLoadStatus } from "./RamSection";

export function ThermalSection({
  visible,
  status,
  selected,
  onSelect,
  upgrades,
  dispatch,
  unlocked,
}: {
  visible: VisibleState;
  status: SystemLoadStatus;
  selected: boolean;
  onSelect: () => void;
  upgrades: VisibleUpgrade[];
  dispatch: Dispatch;
  unlocked: boolean;
}) {
  const tone = getStressTone(status.coolingStress);
  const coolingUpgrade = upgrades.find((upgrade) => upgrade.id === "cooling");

  if (!unlocked) {
    return (
      <LockedSystemSection
        className="thermal-section"
        Icon={Thermometer}
        title="Thermal"
        note="Research Thermal Control"
        selected={selected}
        onSelect={onSelect}
      />
    );
  }

  return (
    <section
      className={`hw-section thermal-section ${tone} ${selected ? "selected" : ""}`}
    >
      <button type="button" className="hw-section-header" onClick={onSelect}>
        <Thermometer size={14} />
        <span>Thermal</span>
        <span className="hw-section-meta">
          <strong>{status.coolingStatus}</strong>
        </span>
      </button>

      <div className="module-stat">
        <strong>{formatHardwarePercent(status.coolingStress)}</strong>
        <small>stress</small>
      </div>

      {status.coolingStress !== null && <ModuleMeter value={status.coolingStress} />}

      {coolingUpgrade && (
        <div className="power-upgrade-row">
          <UpgradeStepper
            upgrade={coolingUpgrade}
            dispatch={dispatch}
            label="Cooling Loop"
            className="inline-stepper"
            resources={visible.resources}
          />
        </div>
      )}
    </section>
  );
}
