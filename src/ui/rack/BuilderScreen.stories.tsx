import type { Meta, StoryObj } from "@storybook/react-vite";
import { rackStoryData } from "../stories/visibleFixtures";
import { BuilderScreen } from "./BuilderScreen";
import type { UiRackData } from "./types";

const builderRack: UiRackData = {
  ...rackStoryData,
  presets: rackStoryData.presets.map((preset) => ({
    ...preset,
    description: "Balanced starter hardware for general fleet work.",
    cores: 4,
    ramBits: 1024,
    cacheBits: 128,
    powerDeltaWatts: 18,
  })),
  customBuilder: {
    title: "Advanced system",
    canBuy: true,
    groups: [
      {
        id: "cpu",
        label: "CPU",
        tiers: [
          {
            id: "hz-cpu",
            name: "Hz CPU",
            tierName: "Hz",
            cpuTierId: "hz",
            cores: 1,
            clockHz: 1,
            cpuEfficiency: 4,
            cacheBits: 1,
            cacheSpeedHz: 1,
            costs: [{ resource: "credits", amount: 100 }],
          },
        ],
      },
      {
        id: "memory",
        label: "RAM",
        tiers: [
          {
            id: "hz-ram",
            name: "Hz RAM",
            tierName: "Hz",
            ramTierId: "hz",
            ramBits: 256,
            ramStickCount: 2,
            ramLevel: 1,
            ramSpeedLevel: 1,
            ramSpeedMt: 1,
            costs: [{ resource: "data", amount: 10 }],
          },
        ],
      },
      {
        id: "scheduler",
        label: "Scheduler",
        tiers: [
          {
            id: "queue",
            name: "Queue",
            schedulerSlots: 2,
            costs: [{ resource: "data", amount: 8 }],
          },
        ],
      },
      {
        id: "psu",
        label: "PSU",
        tiers: [
          {
            id: "supply",
            name: "Supply",
            psuLevel: 5,
            psuWatts: 24,
            costs: [{ resource: "credits", amount: 80 }],
          },
        ],
      },
    ],
  },
};

const meta = {
  title: "UI/Fleet/FleetBuilder",
  component: BuilderScreen,
  parameters: {
    layout: "padded",
  },
  args: {
    rack: builderRack,
    resources: { credits: 2_000, data: 1_000 },
    systemDispatch: () => undefined,
  },
} satisfies Meta<typeof BuilderScreen>;

export default meta;

type Story = StoryObj<typeof meta>;

export const PresetLanding: Story = {};
