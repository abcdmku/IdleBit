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

  return (
    <div className={`system-board stage-${visible.stage} ${powerOff ? "power-offline" : ""}`}>
      <div className="system-board-flow">{children}</div>
    </div>
  );
}

export function SystemRail({ children }: { children: ReactNode }) {
  return <div className="system-rail">{children}</div>;
}

export function CoreCacheRow({ children }: { children: ReactNode }) {
  return <div className="core-cache-row">{children}</div>;
}
