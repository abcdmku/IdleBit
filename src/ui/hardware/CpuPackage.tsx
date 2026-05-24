import type { ReactNode } from "react";
import { Cpu } from "lucide-react";
import type { VisibleCpuSocket, VisibleState, VisibleUpgrade } from "../../game";
import { formatNumber } from "../format";
import type { Dispatch } from "../uiActions";
import { DeadlockCountdown, shouldShowCacheDeadlockPressure } from "./DeadlockHelp";
import { InlineUpgradeRow } from "./UpgradeControls";
import { CpuInstallOptions } from "./CpuInstallOptions";

export function CpuPackage({
  socket,
  selected,
  showSocketLabel,
  onSelect,
  cpuUpgrades,
  socketUpgrades = [],
  resources,
  dispatch,
  deadlockPressure,
  children,
}: {
  socket: VisibleCpuSocket;
  selected: boolean;
  showSocketLabel: boolean;
  onSelect: () => void;
  cpuUpgrades: VisibleUpgrade[];
  socketUpgrades?: VisibleUpgrade[];
  resources: VisibleState["resources"];
  dispatch: Dispatch;
  deadlockPressure: VisibleState["metrics"]["deadlockPressure"];
  children: ReactNode;
}) {
  const otherCpuUpgrades = cpuUpgrades.filter(
    (upgrade) => upgrade.id !== "clock" && upgrade.id !== "core",
  );
  const label = showSocketLabel ? socket.label : "CPU";
  const cooldownActive =
    shouldShowCacheDeadlockPressure(socket, deadlockPressure) &&
    deadlockPressure.lockout;

  return (
    <section
      className={`cpu-package ${selected ? "selected" : ""} ${
        socket.deadlocked ? "deadlocked" : ""
      } ${cooldownActive ? "cooling-down" : ""}`}
    >
      <div className="cpu-package-header-row">
        <button
          type="button"
          className="cpu-package-header"
          onClick={onSelect}
        >
          <Cpu size={14} />
          <span>{label}</span>
          {shouldShowCacheDeadlockPressure(socket, deadlockPressure) && (
            <DeadlockCountdown pressure={deadlockPressure} compact />
          )}
          <span className="cpu-package-meta">
            <strong>{socket.tierName}</strong> L{socket.level} - Eff{" "}
            {formatNumber(socket.efficiency)}
          </span>
        </button>
        {socketUpgrades.length > 0 && (
          <div className="cpu-package-header-install" aria-label="Buy CPU">
            <span className="cpu-package-header-install-label">Buy CPU</span>
            <CpuInstallOptions
              upgrades={socketUpgrades}
              resources={resources}
              dispatch={dispatch}
              variant="header"
            />
          </div>
        )}
      </div>

      <div className="cpu-package-body">{children}</div>
      {selected && otherCpuUpgrades.length > 0 && (
        <InlineUpgradeRow
          upgrades={otherCpuUpgrades}
          resources={resources}
          dispatch={dispatch}
        />
      )}
    </section>
  );
}
