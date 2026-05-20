import type { CSSProperties } from "react";
import type { VisibleCpuSocket } from "../../game";
import { formatClock, formatNumber } from "../format";
import { getCoreActiveTask } from "../tasks/taskData";
import { getRackCoreGridMetrics } from "./rackMetrics";

interface RackCpuBayProps {
  sockets: VisibleCpuSocket[];
  coreCount: number;
  activeCount: number;
  clockHz: number;
  issue: boolean;
}

export function RackCpuBay({
  sockets,
  coreCount,
  activeCount,
  clockHz,
  issue,
}: RackCpuBayProps) {
  const cpuPackageCount = sockets.length;
  const cpuCoreShape =
    cpuPackageCount > 1 && sockets.every((socket) => socket.cores.length > 0)
      ? `${formatNumber(cpuPackageCount)}x${formatNumber(sockets[0]?.cores.length ?? 0)}`
      : formatNumber(coreCount);

  return (
    <span
      className={`rack-component-bay rack-component-bay--cpu ${
        issue ? "rack-component-bay--issue" : ""
      }`}
      title={`${activeCount}/${coreCount} cores active at ${formatClock(clockHz)}`}
      aria-label={`${activeCount}/${coreCount} cores active at ${formatClock(clockHz)}`}
    >
      <span
        className="rack-cpu-package-map"
        style={
          {
            "--rack-cpu-packages": Math.min(4, Math.max(1, sockets.length)),
          } as CSSProperties
        }
        aria-hidden="true"
      >
        {sockets.map((socket, socketIndex) => {
          const metrics = getRackCoreGridMetrics(socket.cores.length);
          const socketActiveCount = socket.cores.filter((core) =>
            Boolean(getCoreActiveTask(core)),
          ).length;

          return (
            <span
              key={socket.id}
              className={`rack-cpu-package ${metrics.density} ${
                socket.deadlocked ? "deadlocked" : ""
              }`}
              style={
                {
                  "--rack-cpu-package-size": `${metrics.packageSize}px`,
                } as CSSProperties
              }
              title={`${socket.label || `CPU ${socketIndex + 1}`}: ${socketActiveCount}/${socket.cores.length} cores active`}
            >
              <span
                className="rack-cpu-core-grid"
                style={
                  {
                    "--rack-core-columns": metrics.columns,
                    "--rack-core-size": `${metrics.size}px`,
                    "--rack-core-gap": `${metrics.gap}px`,
                  } as CSSProperties
                }
              >
                {socket.cores.map((core) => {
                  const active = Boolean(getCoreActiveTask(core));
                  return (
                    <span
                      key={core.id}
                      className={`rack-cpu-core-dot ${
                        core.deadlocked ? "deadlocked" : active ? "active" : "idle"
                      }`}
                    />
                  );
                })}
              </span>
            </span>
          );
        })}
      </span>
      <span className="rack-component-stat">
        {cpuPackageCount > 1 ? `${cpuCoreShape}C` : `${formatNumber(coreCount)}C`}
        {clockHz > 0 && (
          <span className="rack-component-stat-sub">
            {" @ "}
            {formatClock(clockHz)}
          </span>
        )}
      </span>
    </span>
  );
}
