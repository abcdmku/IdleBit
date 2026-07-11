import type { CSSProperties } from "react";
import type { VisibleCpuSocket } from "../../game";
import { formatClock } from "../format";
import { SmoothFill } from "../SmoothProgress";
import { getCoreActiveTask } from "../tasks/taskData";
import { getRackCoreGridMetrics } from "./rackMetrics";

interface RackCpuBayProps {
  sockets: VisibleCpuSocket[];
  coreCount: number;
  activeCount: number;
  clockHz: number;
  issue: boolean;
  /** Names of managed work (contracts/projects) reserving this system.
   * Managed work runs on the aggregate compute path, not per-core tasks,
   * so the bay shows a reserved state instead of sitting dark. */
  managedNames?: string[];
}

export function RackCpuBay({
  sockets,
  coreCount,
  activeCount,
  clockHz,
  issue,
  managedNames = [],
}: RackCpuBayProps) {
  const managed = managedNames.length > 0 && activeCount === 0;
  const util = coreCount > 0 ? Math.min(1, activeCount / coreCount) : 0;
  const utilPercent = Math.round(util * 100);
  const fullLabel = managed
    ? `Compute reserved by ${managedNames.join(", ")} at ${formatClock(clockHz)}`
    : `${activeCount}/${coreCount} cores active at ${formatClock(clockHz)}`;
  const socketCount = sockets.length;
  // When 5-8 sockets, dies wrap to 2 rows — shrink so the 2-row layout fits viz height.
  // 9+ sockets: shrink further so up to 3 rows still fit.
  const dieScale =
    socketCount <= 4 ? 1 : socketCount <= 8 ? 0.5 : socketCount <= 12 ? 0.4 : 0.34;
  const packageColumns = Math.min(4, Math.max(1, socketCount));

  return (
    <span
      className={`rack-component-bay rack-component-bay--cpu ${
        issue ? "rack-component-bay--issue" : ""
      } ${managed ? "rack-component-bay--managed" : ""}`}
      title={fullLabel}
      aria-label={fullLabel}
    >
      <span className="rack-component-bay-caption" aria-hidden="true">
        CPU
      </span>
      <span className="rack-component-bay-viz">
        <span
          className={`rack-cpu-package-map ${socketCount > 4 ? "multi-row" : ""}`}
          style={
            {
              "--rack-cpu-packages": packageColumns,
            } as CSSProperties
          }
          aria-hidden="true"
        >
          {sockets.map((socket, socketIndex) => {
            const metrics = getRackCoreGridMetrics(socket.cores.length);
            const socketActiveCount = socket.cores.filter((core) =>
              Boolean(getCoreActiveTask(core)),
            ).length;
            const scaledPackageSize = metrics.packageSize * dieScale;
            const scaledCoreSize = Math.max(2, metrics.size * dieScale);
            const scaledCoreGap = Math.max(0, metrics.gap * dieScale);

            return (
              <span
                key={socket.id}
                className={`rack-cpu-package ${metrics.density} ${
                  socket.deadlocked ? "deadlocked" : ""
                }`}
                style={
                  {
                    "--rack-cpu-package-size": `${scaledPackageSize}px`,
                  } as CSSProperties
                }
                title={`${socket.label || `CPU ${socketIndex + 1}`}: ${socketActiveCount}/${socket.cores.length} cores active`}
              >
                <span
                  className="rack-cpu-core-grid"
                  style={
                    {
                      "--rack-core-columns": metrics.columns,
                      "--rack-core-size": `${scaledCoreSize}px`,
                      "--rack-core-gap": `${scaledCoreGap}px`,
                    } as CSSProperties
                  }
                >
                  {socket.cores.map((core) => {
                    const active = Boolean(getCoreActiveTask(core));
                    return (
                      <span
                        key={core.id}
                        className={`rack-cpu-core-dot ${
                          core.deadlocked
                            ? "deadlocked"
                            : active
                              ? "active"
                              : managed
                                ? "managed"
                                : "idle"
                        }`}
                      />
                    );
                  })}
                </span>
              </span>
            );
          })}
        </span>
      </span>
      <span className="rack-gauge-strip rack-gauge-strip--queue">
        <span className="rack-gauge-bar" aria-hidden="true">
          <SmoothFill
            className="rack-gauge-bar-fill"
            value={managed ? 1 : util}
            snapKey={`${issue}:${managed}`}
            snapOnDecrease={false}
          />
        </span>
        <span className="rack-gauge-value">{managed ? "RUN" : `${utilPercent}%`}</span>
      </span>
    </span>
  );
}
