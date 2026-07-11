import { Thermometer } from "lucide-react";
import type { VisibleState, VisibleUpgrade } from "../../game";
import { StatTile } from "../StatTile";
import type { Dispatch } from "../uiActions";
import { formatHardwarePercent } from "./display";
import { LockedSystemSection } from "./HardwareInstallSection";
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
      </button>

      <StatTile
        label="Stress"
        value={formatHardwarePercent(status.coolingStress)}
        meter={status.coolingStress === null ? undefined : status.coolingStress}
        title={`Cooling stress ${formatHardwarePercent(status.coolingStress)}`}
      />


      {coolingUpgrade && (
        <div className="power-upgrade-row">
          <UpgradeStepper
            upgrade={coolingUpgrade}
            dispatch={dispatch}
            label="Cooling"
            className="inline-stepper"
            resources={visible.resources}
          />
        </div>
      )}
    </section>
  );
}
