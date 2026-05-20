import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { VisibleState } from "../game";
import {
  firstScreenTaskVisible,
  rackReadyTaskVisible,
} from "./stories/visibleFixtures";
import { PinnedTaskBar } from "./tasks/PinnedTaskBar";
import { TaskBay } from "./tasks/TaskBay";
import type { UiGameAction } from "./uiActions";
import type { SelectedComponent } from "./workbenchData";

const noopDispatch = (_action: UiGameAction) => undefined;

const meta = {
  title: "UI/Hardware/TaskBay",
  component: TaskBay,
  parameters: {
    layout: "padded",
  },
  args: {
    dispatch: noopDispatch,
  },
} satisfies Meta<typeof TaskBay>;

export default meta;

type Story = StoryObj<typeof meta>;

function TaskBayFrame({
  visible,
  selectedComponent,
  initialPinnedTaskIds = [],
}: {
  visible: VisibleState;
  selectedComponent: SelectedComponent;
  initialPinnedTaskIds?: string[];
}) {
  const [selected, setSelected] = useState<SelectedComponent>(selectedComponent);
  const [pinnedTaskIds, setPinnedTaskIds] = useState(initialPinnedTaskIds);

  const togglePinnedTask = (taskId: string) => {
    setPinnedTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId],
    );
  };

  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        maxWidth: 560,
      }}
    >
      <section className="side-panel task-panel">
        <TaskBay
          visible={visible}
          selectedComponent={selected}
          onSelectComponent={setSelected}
          dispatch={noopDispatch}
          pinnedTaskIds={pinnedTaskIds}
          onTogglePinnedTask={togglePinnedTask}
        />
      </section>
      <PinnedTaskBar
        visible={visible}
        pinnedTaskIds={pinnedTaskIds}
        onUnpinTask={togglePinnedTask}
        onClearPinnedTasks={() => setPinnedTaskIds([])}
        dispatch={noopDispatch}
        selectedComponent={selected}
        variant="embedded"
      />
    </div>
  );
}

export const FirstScreenCoreRoute: Story = {
  args: {
    visible: firstScreenTaskVisible,
    selectedComponent: "core:1",
  },
  render: () => (
    <TaskBayFrame
      visible={firstScreenTaskVisible}
      selectedComponent="core:1"
      initialPinnedTaskIds={["fetchBit"]}
    />
  ),
};

export const RackReadySchedulerRoute: Story = {
  args: {
    visible: rackReadyTaskVisible,
    selectedComponent: "scheduler:1",
  },
  render: () => (
    <TaskBayFrame
      visible={rackReadyTaskVisible}
      selectedComponent="scheduler:1"
      initialPinnedTaskIds={["fetchBit", "packetCheck", "tinyChecksum"]}
    />
  ),
};

export const SystemSchedulerRoute: Story = {
  args: {
    visible: rackReadyTaskVisible,
    selectedComponent: "scheduler",
  },
  render: () => (
    <TaskBayFrame
      visible={rackReadyTaskVisible}
      selectedComponent="scheduler"
      initialPinnedTaskIds={["tinyChecksum", "memoryScrub"]}
    />
  ),
};
