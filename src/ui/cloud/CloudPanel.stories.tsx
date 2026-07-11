import type { Meta, StoryObj } from "@storybook/react-vite";
import { amount } from "../../game/amount";
import {
  advanceCloud,
  commissionCloudRegion,
  commissionCloudZone,
  createCloudState,
  placeCloudReplica,
  setCloudRegionalDemand,
  startCloudSla,
} from "../../game/cloud";
import { getVisibleCloudState } from "../../game/cloudSelectors";
import { CloudPanel } from "./CloudPanel";

const cloudFixture = () => {
  let state = createCloudState();
  state = commissionCloudRegion(state, "Prairie");
  state = commissionCloudZone(state, {
    regionId: "region-1",
    facilityId: "facility-2",
    name: "Prairie A",
    capacityPerSecond: amount("2500000000000"),
    faultDomainId: "grid-a",
  });
  state = commissionCloudZone(state, {
    regionId: "region-1",
    facilityId: "facility-3",
    name: "Prairie B",
    capacityPerSecond: amount("1800000000000"),
    faultDomainId: "grid-b",
  });
  state = placeCloudReplica(state, "zone-2");
  state = placeCloudReplica(state, "zone-3");
  state = setCloudRegionalDemand(state, "region-1", amount("3000000000000"));
  return state;
};

const meta = {
  title: "UI/Late Game/CloudPanel",
  component: CloudPanel,
  parameters: { layout: "padded" },
  args: {
    availableFacilities: [],
    planetaryAvailable: false,
    onCommissionRegion: () => undefined,
    onCommissionZone: () => undefined,
    onPlaceReplica: () => undefined,
    onSetRegionalDemand: () => undefined,
    onSetRoutingLinks: () => undefined,
    onSetFailoverPolicy: () => undefined,
    onDrawIncident: () => undefined,
    onRequestFailover: () => undefined,
    onStartSla: () => undefined,
    onStartFinale: () => undefined,
    onSelectCharter: () => undefined,
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 1100 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CloudPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RegionalPlanning: Story = {
  args: { visible: getVisibleCloudState(cloudFixture()) },
};

export const ActiveSla: Story = {
  args: {
    visible: getVisibleCloudState(
      advanceCloud(
        startCloudSla(cloudFixture(), "regionalContinuity"),
        45 * 60_000,
      ).state,
    ),
  },
};
