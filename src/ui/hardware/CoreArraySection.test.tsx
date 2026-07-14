import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialGameState } from "../../game/progression";
import { deriveVisibleState } from "../../game/selectors";
import type { VisibleCpuSocket, VisibleState } from "../../game";
import { CoreArraySection } from "./CoreArraySection";
import { CpuBank } from "./CpuBank";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const baseVisible = (): VisibleState =>
  deriveVisibleState(createInitialGameState());

/**
 * A socket whose cores 1 and 2 run one shared task with DIFFERENT per-core
 * progress. Per-core rendering must resolve each die's own coreProgress entry
 * (C-UI-16 replaced the per-die find with a shared index).
 */
const sharedTaskSocket = (visible: VisibleState): VisibleCpuSocket => {
  const socket = visible.metrics.cpuSockets[0]!;
  const template = socket.cores[0]!;
  const sharedTask = {
    instanceId: "compile-1",
    taskId: "compileCode",
    name: "Compile Code",
    coreId: 1,
    assignedCoreIds: [1, 2],
    progress: 0.5,
    coreProgress: [
      { coreId: 1, operationId: "op-1", operationName: "Stage", progress: 0.25 },
      { coreId: 2, operationId: "op-2", operationName: "Compile", progress: 0.75 },
    ],
  };

  return {
    ...socket,
    cores: [1, 2].map((coreId) => ({
      ...template,
      id: coreId,
      activeTask: sharedTask as unknown as typeof template.activeTask,
      activeJob: null,
      deadlocked: false,
    })),
  };
};

const dieProgressValues = (container: HTMLElement, selector: string) =>
  Array.from(container.querySelectorAll(selector)).map((die) =>
    die
      .querySelector<HTMLElement>(".die-progress .progress-fill")
      ?.style.getPropertyValue("--meter-progress"),
  );

describe("CoreArraySection per-core progress and handlers", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  const renderSection = (
    socket: VisibleCpuSocket,
    visible: VisibleState,
    onSelectCore: (coreId: number) => void,
    dispatch: (action: unknown) => void,
  ) => {
    act(() => {
      root.render(
        <CoreArraySection
          socket={socket}
          selectedCoreId={1}
          selectedAllCores={false}
          allCoreTuningVisible={false}
          onSelectCore={onSelectCore}
          onSelectAllCores={() => undefined}
          cpuUpgrades={[]}
          resources={visible.resources}
          dispatch={dispatch as never}
        />,
      );
    });
  };

  it("renders each die's own coreProgress entry from a shared multi-core task", () => {
    const visible = baseVisible();
    const socket = sharedTaskSocket(visible);
    renderSection(socket, visible, () => undefined, () => undefined);

    expect(dieProgressValues(container, ".core-die")).toEqual(["0.25", "0.75"]);
    const workLabels = Array.from(
      container.querySelectorAll(".core-work"),
    ).map((label) => label.textContent);
    expect(workLabels).toEqual(["Compile Code", "Compile Code"]);
  });

  it("selects and cancels with the die's own core id", () => {
    const visible = baseVisible();
    const socket = sharedTaskSocket(visible);
    const onSelectCore = vi.fn();
    const dispatch = vi.fn();
    renderSection(socket, visible, onSelectCore, dispatch);

    const dies = Array.from(container.querySelectorAll(".core-die"));
    act(() => {
      dies[1]
        ?.querySelector<HTMLButtonElement>(".core-die-select")
        ?.click();
    });
    expect(onSelectCore).toHaveBeenCalledWith(2);

    act(() => {
      dies[0]
        ?.querySelector<HTMLButtonElement>(".core-cancel-button")
        ?.click();
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "cancelTask",
      taskId: "compileCode",
      instanceId: "compile-1",
      coreId: 1,
    });
  });

  it("invokes the latest select handler after re-render (no stale memoized closure)", () => {
    const visible = baseVisible();
    const socket = sharedTaskSocket(visible);
    const first = vi.fn();
    const second = vi.fn();
    renderSection(socket, visible, first, () => undefined);
    renderSection(socket, visible, second, () => undefined);

    act(() => {
      container
        .querySelector<HTMLButtonElement>(".core-die .core-die-select")
        ?.click();
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(1);
  });
});

describe("CpuBank summary core cells", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it("renders per-core progress in summary cells and selects with socket + core ids", () => {
    const visible = baseVisible();
    const socket = sharedTaskSocket(visible);
    const onSelectCore = vi.fn();

    act(() => {
      root.render(
        <CpuBank
          sockets={[socket]}
          view="array"
          onChangeView={() => undefined}
          activeSocketId={socket.id}
          onSelectTab={() => undefined}
          onOpenSocket={() => undefined}
          onSelectCore={onSelectCore}
          renderSocket={() => null}
          schedulerVisible={false}
          visible={visible}
          resources={visible.resources}
          dispatch={(() => undefined) as never}
          socketUpgrades={[]}
        />,
      );
    });

    expect(dieProgressValues(container, ".cpu-summary-core-cell")).toEqual([
      "0.25",
      "0.75",
    ]);

    const cells = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".cpu-summary-core-cell"),
    );
    act(() => cells[1]?.click());
    expect(onSelectCore).toHaveBeenCalledWith(socket.id, 2);
  });
});
