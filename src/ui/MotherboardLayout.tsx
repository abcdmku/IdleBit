import type { ReactNode } from "react";
import type { VisibleState } from "../game";

export function SystemBoard({
  visible,
  children,
}: {
  visible: VisibleState;
  children: ReactNode;
}) {
  const powerOff = visible.metrics.powerState === "off";
  const powerTransitioning = visible.metrics.powerState === "booting";
  const className = [
    "system-board",
    `stage-${visible.stage}`,
    powerOff || powerTransitioning ? "power-offline" : "",
    powerTransitioning ? "power-transitioning" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <div className="system-board-flow">{children}</div>
    </div>
  );
}

export function SystemRail({ children }: { children: ReactNode }) {
  return <div className="system-rail">{children}</div>;
}

export function SystemRack({ children }: { children: ReactNode }) {
  return <section className="system-rack">{children}</section>;
}

export function CoreCacheRow({ children }: { children: ReactNode }) {
  return <div className="core-cache-row">{children}</div>;
}
