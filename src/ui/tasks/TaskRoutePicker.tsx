import type { VisibleState } from "../../game";
import { getSocketCoreLabel, getSocketForCore } from "../panels/cpuLabels";
import { getSelectedCoreId, getSelectedSchedulerId } from "../panels/selectionIds";
import {
  getSelectedSystemComponent,
  getSelectedSystemId,
  scopeSelectionToSystem,
  type SelectedComponent,
} from "../workbenchData";
import { getQueueEntries, resolveTaskRoute } from "./taskData";
import type { TaskCategoryId, TaskRouteLayer } from "./taskTypes";

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

export function TaskGroupRoutePicker({
  visible,
  category,
  selection,
  onSelectComponent,
}: {
  visible: VisibleState;
  category: TaskCategoryId;
  selection: SelectedComponent;
  onSelectComponent: (component: SelectedComponent) => void;
}) {
  const systemId = getSelectedSystemId(selection);
  const routeSelection = getSelectedSystemComponent(selection);
  const selectComponent = (component: SelectedComponent) =>
    onSelectComponent(scopeSelectionToSystem(systemId, component));

  if (category === "cpu") {
    return (
      <TaskRoutePicker
        visible={visible}
        selection={routeSelection}
        onSelectComponent={selectComponent}
      />
    );
  }

  if (category === "system") {
    if (!visible.flags.scheduler) return null;
    return (
      <div className="task-route-picker" aria-label="System route">
        <select
          className="task-route-select task-route-target-select"
          value="system"
          onChange={() => selectComponent("scheduler")}
          aria-label="System target"
          title="System scheduler"
        >
          <option value="system">System</option>
        </select>
      </div>
    );
  }

  return null;
}

function TaskRoutePicker({
  visible,
  selection,
  onSelectComponent,
}: {
  visible: VisibleState;
  selection: SelectedComponent;
  onSelectComponent: (component: SelectedComponent) => void;
}) {
  const systemId = getSelectedSystemId(selection);
  const routeSelection =
    getSelectedSystemComponent(selection) ?? ("core:1" as SelectedComponent);
  const selectComponent = (component: SelectedComponent) =>
    onSelectComponent(scopeSelectionToSystem(systemId, component));
  const sockets = visible.metrics.cpuSockets;
  const cores = sockets.flatMap((socket) => socket.cores);
  const firstCoreId = cores[0]?.id ?? 1;
  const firstSocketId = sockets[0]?.id ?? 1;
  const schedulerVisible =
    visible.flags.basicQueue ||
    visible.flags.scheduler ||
    getQueueEntries(visible).length > 0;
  const selectedCoreId = getSelectedCoreId(routeSelection) ?? firstCoreId;
  const selectedSchedulerId = getSelectedSchedulerId(routeSelection) ?? firstSocketId;
  const layer: TaskRouteLayer =
    routeSelection?.startsWith("scheduler:") && schedulerVisible
      ? "scheduler"
      : "core";
  const layerOptions: Array<{ value: TaskRouteLayer; label: string; title: string }> = [
    { value: "core", label: "C", title: "Direct core" },
    ...(schedulerVisible
      ? [{ value: "scheduler" as const, label: "CPU", title: "CPU scheduler" }]
      : []),
  ];

  const selectLayer = (nextLayer: TaskRouteLayer) => {
    if (nextLayer === "core") {
      selectComponent(`core:${selectedCoreId || firstCoreId}`);
      return;
    }

    if (nextLayer === "scheduler") {
      selectComponent(`scheduler:${selectedSchedulerId || firstSocketId}`);
    }
  };

  const selectTarget = (value: string) => {
    if (layer === "core") {
      selectComponent(`core:${Number(value) || firstCoreId}`);
      return;
    }

    if (layer === "scheduler") {
      selectComponent(`scheduler:${Number(value) || firstSocketId}`);
    }
  };

  return (
    <div className="task-route-picker" aria-label="Task route">
      <select
        className="task-route-select task-route-layer-select"
        value={layer}
        onChange={(event) => selectLayer(event.currentTarget.value as TaskRouteLayer)}
        aria-label="Route layer"
        title="Route layer"
      >
        {layerOptions.map((option) => (
          <option key={option.value} value={option.value} title={option.title}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        className="task-route-select task-route-target-select"
        value={layer === "core" ? String(selectedCoreId) : String(selectedSchedulerId)}
        onChange={(event) => selectTarget(event.currentTarget.value)}
        aria-label={layer === "core" ? "Core target" : "CPU target"}
        title={layer === "core" ? "Core target" : "CPU target"}
      >
        {layer === "core" &&
          sockets.map((socket) => (
            <optgroup key={socket.id} label={socket.label}>
              {socket.cores.map((core) => (
                <option key={core.id} value={core.id}>
                  {getSocketCoreLabel(socket, core.id)}
                </option>
              ))}
            </optgroup>
          ))}
        {layer === "scheduler" &&
          sockets.map((socket) => (
            <option key={socket.id} value={socket.id}>
              CPU {socket.id}
            </option>
          ))}
      </select>
    </div>
  );
}
