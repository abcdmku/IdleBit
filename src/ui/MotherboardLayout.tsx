import type { ReactNode } from "react";
import type { VisibleState } from "../game";

export function SystemBoard({
  visible,
  children,
}: {
  visible: VisibleState;
  children: ReactNode;
}) {
  const powerOffline =
    visible.metrics.powerState === "off" || visible.metrics.powerState === "booting";

  return (
    <div className={`system-board stage-${visible.stage} ${powerOffline ? "power-offline" : ""}`}>
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
