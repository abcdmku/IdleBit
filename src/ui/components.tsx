import type { VisibleState } from "../game";
import { HardwareBoard, ResourceHud, TaskBay } from "./HardwareBoard";
import type { Dispatch } from "./uiActions";
import { getVisibleSelection, type SelectedComponent } from "./workbenchData";

export type { SelectedComponent } from "./workbenchData";

interface SystemWorkbenchProps {
  visible: VisibleState;
  dispatch: Dispatch;
  selectedComponent: SelectedComponent;
  onSelectComponent: (component: SelectedComponent) => void;
  onReset: () => void;
  animateResourceGains: boolean;
}

export function SystemWorkbench({
  visible,
  dispatch,
  selectedComponent,
  onSelectComponent,
  onReset,
  animateResourceGains,
}: SystemWorkbenchProps) {
  const component = getVisibleSelection(visible, selectedComponent);

  return (
    <main className="workbench" aria-label="IdleBit system workbench">
      <ResourceHud
        visible={visible}
        onReset={onReset}
        animateResourceGains={animateResourceGains}
      />
      <section className="board-stage" aria-label="System board">
        <HardwareBoard
          visible={visible}
          dispatch={dispatch}
          selectedComponent={component}
          onSelectComponent={onSelectComponent}
        />
        <TaskBay
          visible={visible}
          selectedComponent={component}
          dispatch={dispatch}
        />
      </section>
    </main>
  );
}
