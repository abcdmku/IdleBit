import type { VisibleState } from "../../game";
import { getSocketCoreLabel, getSocketForCore } from "../panels/cpuLabels";
import { getRackData } from "../rack/rackData";
import {
  getSelectedSystemComponent,
  getSelectedSystemId,
  scopeSelectionToSystem,
  type SelectedComponent,
} from "../workbenchData";
import { getQueueEntries, resolveTaskRoute } from "./taskData";
import type { TaskCategoryId } from "./taskTypes";

export function getRouteTargetLabel(
  visible: VisibleState,
  route: ReturnType<typeof resolveTaskRoute>,
): string {
  const { mode, selectedCore, selectedSchedulerId } = route;
  if (mode === "systemScheduler") return "System scheduler";
  if (mode === "scheduler") return `CPU ${selectedSchedulerId ?? 1}`;
  if (!selectedCore) return "Core";
  const socket = getSocketForCore(visible.metrics.cpuSockets, selectedCore.id);
  return socket
    ? `${socket.label} ${getSocketCoreLabel(socket, selectedCore.id)}`
    : `Core ${selectedCore.id}`;
}

/**
 * Single bay-level route selector (game-spec 4.1): one compact layer-plus-target
 * control for the whole task panel instead of one picker per group. Options are
 * built from the task categories currently on screen so the list stays relevant.
 */
export function TaskBayRoutePicker({
  visible,
  categories,
  selection,
  onSelectComponent,
}: {
  visible: VisibleState;
  categories: ReadonlySet<TaskCategoryId>;
  selection: SelectedComponent;
  onSelectComponent: (component: SelectedComponent) => void;
}) {
  const rack = getRackData(visible);
  const routeSystems = rack.systems.length > 1 ? rack.systems : [];
  const requestedSystemId =
    getSelectedSystemId(selection) ?? rack.selectedSystemId ?? routeSystems[0]?.id ?? null;
  const routeSelection =
    getSelectedSystemComponent(selection) ??
    (categories.has("cpu") ? ("core:1" as SelectedComponent) : "scheduler");
  const options = [
    ...(categories.has("cpu") ? getCpuRouteOptions(visible, routeSystems) : []),
    ...(categories.has("system")
      ? getSystemRouteOptions(visible, routeSystems)
      : []),
  ];

  if (options.length === 0) return null;

  const selectedValue = getSelectedRouteValue(
    routeSystems.length > 1 ? requestedSystemId : null,
    routeSelection,
    options,
  );

  return (
    <div className="task-route-picker task-bay-route" aria-label="Task route">
      <select
        className="task-route-select task-route-combo-select"
        value={selectedValue}
        onChange={(event) =>
          onSelectComponent(event.currentTarget.value as SelectedComponent)
        }
        aria-label="Task route target"
        title="Task route target"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} title={option.title}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

type RouteSelectValue = Exclude<SelectedComponent, null>;

interface RouteOption {
  value: RouteSelectValue;
  label: string;
  title: string;
}

interface RouteSystemTarget {
  id: string | null;
  name: string;
  visible: VisibleState;
}

const getRouteSystemTargets = (
  visible: VisibleState,
  systems: Array<{ id: string; name: string; visible: VisibleState }>,
): RouteSystemTarget[] =>
  systems.length > 1
    ? systems.map((system, index) => ({
        id: system.id,
        name: system.name || `System ${index + 1}`,
        visible: system.visible,
      }))
    : [{ id: null, name: "", visible }];

const formatRouteLabel = (
  target: RouteSystemTarget,
  label: string,
  hasMultipleSystems: boolean,
) => (hasMultipleSystems ? `${target.name} / ${label}` : label);

const getRouteValue = (
  target: RouteSystemTarget,
  component: RouteSelectValue,
): RouteSelectValue =>
  target.id ? (scopeSelectionToSystem(target.id, component) as RouteSelectValue) : component;

const getCpuRouteOptions = (
  visible: VisibleState,
  systems: Array<{ id: string; name: string; visible: VisibleState }>,
): RouteOption[] => {
  const targets = getRouteSystemTargets(visible, systems);
  const hasMultipleSystems = targets.length > 1;

  return targets.flatMap((target) => {
    const sockets = target.visible.metrics.cpuSockets;
    const schedulerVisible =
      target.visible.flags.basicQueue ||
      target.visible.flags.scheduler ||
      getQueueEntries(target.visible).length > 0;
    const coreOptions = sockets.flatMap((socket) =>
      socket.cores.map((core) => {
        const label = getSocketCoreLabel(socket, core.id);
        return {
          value: getRouteValue(target, `core:${core.id}` as RouteSelectValue),
          label: formatRouteLabel(target, label, hasMultipleSystems),
          title: `${target.name ? `${target.name}: ` : ""}${socket.label} ${label}`,
        };
      }),
    );
    const schedulerOptions = schedulerVisible
      ? sockets.map((socket) => ({
          value: getRouteValue(target, `scheduler:${socket.id}` as RouteSelectValue),
          label: formatRouteLabel(target, `CPU ${socket.id}`, hasMultipleSystems),
          title: `${target.name ? `${target.name}: ` : ""}CPU scheduler ${socket.id}`,
        }))
      : [];

    return [...coreOptions, ...schedulerOptions];
  });
};

const getSystemRouteOptions = (
  visible: VisibleState,
  systems: Array<{ id: string; name: string; visible: VisibleState }>,
): RouteOption[] => {
  const targets = getRouteSystemTargets(visible, systems);
  const hasMultipleSystems = targets.length > 1;
  const schedulerVisible =
    targets.length > 1 || visible.flags.scheduler || targets.some((target) => target.visible.flags.scheduler);

  if (!schedulerVisible) return [];

  return targets.map((target) => ({
    value: getRouteValue(target, "scheduler"),
    label: formatRouteLabel(target, "System", hasMultipleSystems),
    title: `${target.name ? `${target.name}: ` : ""}System scheduler`,
  }));
};

const getSelectedRouteValue = (
  systemId: string | null,
  routeSelection: SelectedComponent,
  options: RouteOption[],
) => {
  const component = (routeSelection ?? "core:1") as RouteSelectValue;
  const candidate = systemId
    ? (scopeSelectionToSystem(systemId, component) as RouteSelectValue)
    : component;

  return options.some((option) => option.value === candidate)
    ? candidate
    : (options[0]?.value ?? candidate);
};
