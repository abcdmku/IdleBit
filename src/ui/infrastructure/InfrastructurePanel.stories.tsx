import type { Meta, StoryObj } from "@storybook/react-vite";
import { exactResourceBag } from "../../game/amount";
import { withExactResources } from "../../game/economy";
import { createInitialGameState } from "../../game/progression";
import { deriveVisibleState } from "../../game/selectors";
import { applyAction } from "../../game/simulation";
import { InfrastructurePanel } from "./InfrastructurePanel";

const infrastructureFixture = () => {
  const initial = createInitialGameState();
  let state = withExactResources(
    {
      ...initial,
      campaign: {
        ...initial.campaign,
        currentChapterId: "rackAndFacility" as const,
        currentObjectiveId: "facility:rack-controller",
      },
      automationBuffer: {
        ...initial.automationBuffer,
        ownedLevelId: "rackController" as const,
        departureLevelId: "rackController" as const,
      },
      flags: { ...initial.flags, systemCatalog: true },
      research: {
        ...initial.research,
        completed: [
          ...initial.research.completed,
          "systemCatalog" as const,
        ],
      },
    },
    exactResourceBag("1e12", "1e12"),
  );
  for (let index = 0; index < 2; index += 1) {
    state = applyAction(state, {
      type: "purchaseAggregateServerBatch",
      skuId: "workshopServer",
      count: 1,
      storageSkuId: "localSsd",
      networkSkuId: "gigabitNic",
    });
  }
  const nodeIds = state.infrastructure.fleetNodes
    .filter((node) => node.managed)
    .map((node) => node.id);
  state = applyAction(state, {
    type: "commissionFacility",
    templateId: "workshopFacility",
    name: "Prairie Room",
  });
  const facilityId = state.infrastructure.facilities[0]!.id;
  state = applyAction(state, {
    type: "commissionFacilityRack",
    facilityId,
    templateId: "halfRack",
    name: "Compute A",
  });
  for (const nodeId of nodeIds) {
    state = applyAction(state, {
      type: "placeFleetNodeInRack",
      facilityId,
      rackId: "rack-1",
      nodeId,
    });
  }
  state = applyAction(state, {
    type: "commissionCluster",
    name: "Prairie Fabric",
    nodeIds,
    replicaFaultDomain: "node",
  });
  return deriveVisibleState(state).infrastructure;
};

const meta = {
  title: "UI/Late Game/InfrastructurePanel",
  component: InfrastructurePanel,
  parameters: { layout: "padded" },
  args: {
    visible: infrastructureFixture(),
    resources: exactResourceBag("1e12", "1e12"),
    onSetNodeManaged: () => undefined,
    onPurchaseServerBatch: () => undefined,
    onCommissionCluster: () => undefined,
    onSetClusterFaultDomain: () => undefined,
    onStartWorkload: () => undefined,
    onCancelWorkload: () => undefined,
    onSetWorkloadWeight: () => undefined,
    onCommissionFacility: () => undefined,
    onCommissionRack: () => undefined,
    onPlaceNode: () => undefined,
    onRemoveNode: () => undefined,
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 1200 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InfrastructurePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RackAndFacility: Story = {};
