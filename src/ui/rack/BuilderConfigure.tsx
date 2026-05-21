import {
  Activity,
  Cpu,
  Database,
  HardDrive,
  LayoutGrid,
  MemoryStick,
  Thermometer,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { HardwareComponentId, VisibleState, VisibleUpgrade } from "../../game";
import type { Dispatch } from "../uiActions";
import type { RenderBuilderUpgradeStepper } from "./types";

const componentLabels: Record<HardwareComponentId, string> = {
  cpu: "CPU",
  cache: "Cache",
  scheduler: "Scheduler",
  socket: "Socket",
  ram: "RAM",
  cron: "Cron",
  thermal: "Cooling",
  psu: "PSU",
};

const componentOrder: HardwareComponentId[] = [
  "cpu",
  "cache",
  "scheduler",
  "ram",
  "socket",
  "psu",
  "thermal",
  "cron",
];

const componentIconFor = (component: HardwareComponentId): LucideIcon => {
  switch (component) {
    case "cpu":
      return Cpu;
    case "cache":
      return Database;
    case "scheduler":
      return LayoutGrid;
    case "socket":
      return HardDrive;
    case "ram":
      return MemoryStick;
    case "cron":
      return Activity;
    case "thermal":
      return Thermometer;
    case "psu":
      return Zap;
  }
};

interface BuilderConfigureProps {
  systemName: string;
  upgrades: VisibleUpgrade[];
  resources: VisibleState["resources"];
  dispatch: Dispatch;
  renderUpgradeStepper: RenderBuilderUpgradeStepper;
}

export function BuilderConfigure({
  systemName,
  upgrades,
  resources: _resources,
  dispatch: _dispatch,
  renderUpgradeStepper,
}: BuilderConfigureProps) {
  if (upgrades.length === 0) {
    return (
      <div className="builder-configure-empty">
        No parts available to upgrade on {systemName} right now.
      </div>
    );
  }

  const groups = new Map<HardwareComponentId, VisibleUpgrade[]>();
  for (const upgrade of upgrades) {
    const list = groups.get(upgrade.component);
    if (list) list.push(upgrade);
    else groups.set(upgrade.component, [upgrade]);
  }

  const ordered = componentOrder
    .map((component) => ({ component, items: groups.get(component) ?? [] }))
    .filter((entry) => entry.items.length > 0);

  return (
    <div className="builder-configure" aria-label={`Configure ${systemName}`}>
      {ordered.map(({ component, items }) => {
        const Icon = componentIconFor(component);
        return (
          <section className="builder-configure-group" key={component}>
            <header className="builder-configure-group-header">
              <Icon size={14} />
              <span>{componentLabels[component]}</span>
              <span className="builder-configure-group-count">{items.length}</span>
            </header>
            <div className="builder-configure-rows">
              {items.map((upgrade) =>
                renderUpgradeStepper(
                  upgrade,
                  "inline-stepper builder-configure-stepper",
                ),
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
