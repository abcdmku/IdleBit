import type { ReactNode } from "react";
import { Cpu } from "lucide-react";
import type { VisibleCpuSocket, VisibleState, VisibleUpgrade } from "../../game";
import { getCoreActiveTask } from "../tasks/taskData";
import type { Dispatch } from "../uiActions";
import { DeadlockCountdown, shouldShowCacheDeadlockPressure } from "./DeadlockHelp";
import { InlineUpgradeRow } from "./UpgradeControls";

export function CpuPackage({
  socket,
  selected,
  showSocketLabel,
  onSelect,
  cpuUpgrades,
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
  resources: VisibleState["resources"];
  dispatch: Dispatch;
  deadlockPressure: VisibleState["metrics"]["deadlockPressure"];
  children: ReactNode;
}) {
  const otherCpuUpgrades = cpuUpgrades.filter(
    (upgrade) => upgrade.id !== "clock" && upgrade.id !== "core",
  );
  const activeCount = socket.cores.filter((core) => getCoreActiveTask(core)).length;
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
          <strong>{activeCount}</strong>/{socket.cores.length} active
        </span>
      </button>

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

