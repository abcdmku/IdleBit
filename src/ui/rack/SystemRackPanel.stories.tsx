import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import { getSystemQueueDisplayItems } from "../hardware/queueData";
import { rackStoryData } from "../stories/visibleFixtures";
import type { Dispatch } from "../uiActions";
import {
  getSelectedSystemId,
  scopeSelectionToSystem,
  type SelectedComponent,
} from "../workbenchData";
import {
  SystemRackPanel,
} from "./SystemRackPanel";
import { getRackComponentWarnings } from "./rackWarnings";
import type { UiRackData } from "./types";

const meta = {
  title: "UI/Rack/SystemRackPanel",
  component: SystemRackPanel,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof SystemRackPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

const withFirstSystemOffline = (rack: UiRackData): UiRackData => ({
  ...rack,
  systems: rack.systems.map((system, index) =>
    index === 0
      ? {
        ...system,
        status: "off",
        visible: {
          ...system.visible,
          metrics: {
            ...system.visible.metrics,
            powerState: "off",
          },
        },
      }
      : system,
  ),
});

function RackPanelFrame({
  rack: sourceRack,
  offlineFirstSystem = false,
}: {
  rack: UiRackData;
  offlineFirstSystem?: boolean;
}) {
  const rack = useMemo(() => {
    return offlineFirstSystem ? withFirstSystemOffline(sourceRack) : sourceRack;
  }, [offlineFirstSystem, sourceRack]);
  const [selectedComponent, setSelectedComponent] =
    useState<SelectedComponent>(scopeSelectionToSystem("primary", "scheduler"));
  const [activeSystemId, setActiveSystemId] = useState(
    rack.selectedSystemId ?? rack.systems[0]?.id ?? "primary",
  );
  const dispatch: Dispatch = (action) => {
    if (action.type === "selectSystem") {
      setActiveSystemId(String(action.systemId));
    }
  };
  const selectedSystemId = getSelectedSystemId(selectedComponent);

  return (
    <div style={{ maxWidth: 980 }}>
      <SystemRackPanel
        rack={rack}
        activeSystemId={selectedSystemId ?? activeSystemId}
        onOpenSystem={setActiveSystemId}
        onOpenBuilder={() => undefined}
        selection={selectedComponent}
        onSelectComponent={setSelectedComponent}
        dispatch={dispatch}
        getComponentWarnings={getRackComponentWarnings}
        getSystemQueueDisplayItems={getSystemQueueDisplayItems}
      />
    </div>
  );
}

export const RackReady: Story = {
  args: {
    rack: rackStoryData,
    activeSystemId: "primary",
    onOpenSystem: () => undefined,
    onOpenBuilder: () => undefined,
    selection: scopeSelectionToSystem("primary", "scheduler"),
    onSelectComponent: () => undefined,
    dispatch: () => undefined,
    getComponentWarnings: getRackComponentWarnings,
    getSystemQueueDisplayItems,
  },
  render: () => <RackPanelFrame rack={rackStoryData} />,
};

export const OfflineWarningState: Story = {
  args: RackReady.args,
  render: () => (
    <RackPanelFrame rack={rackStoryData} offlineFirstSystem />
  ),
};
