import type { Meta, StoryObj } from "@storybook/react-vite";
import { ResourceAmount, ResourceCost } from "./ResourceTokens";

const meta = {
  title: "UI/Resources/ResourceTokens",
  component: ResourceCost,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof ResourceCost>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AffordableCost: Story = {
  args: {
    costs: [
      { resource: "data", amount: 48 },
      { resource: "credits", amount: 120 },
    ],
    resources: {
      data: 128,
      credits: 500,
    },
  },
};

export const UnaffordableCost: Story = {
  args: {
    costs: [
      { resource: "data", amount: 256 },
      { resource: "credits", amount: 1_500 },
    ],
    resources: {
      data: 64,
      credits: 300,
    },
  },
};

export const CompactCost: Story = {
  args: {
    costs: [
      { resource: "data", amount: 4 },
      { resource: "credits", amount: 8 },
    ],
    compact: true,
  },
};

export const EmptyCost: Story = {
  args: {
    costs: [],
  },
};

export const UnknownResource: Story = {
  args: {
    costs: [
      { resource: "heatSink", amount: 3 },
      { resource: "credits", amount: 250 },
    ],
    resources: {
      data: 100,
      credits: 500,
    },
  },
};

export const LongCostList: Story = {
  args: {
    costs: [
      { resource: "data", amount: 10_240 },
      { resource: "credits", amount: 90_000 },
      { resource: "licenseKeys", amount: 12 },
    ],
    resources: {
      data: 8_000,
      credits: 250_000,
    },
  },
};

export const GainAmount = {
  render: () => (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <ResourceAmount resource="data" amount={12.5} plus />
      <ResourceAmount resource="credits" amount={1_200} plus compact />
    </div>
  ),
};
