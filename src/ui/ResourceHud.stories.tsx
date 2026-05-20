import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  createInitialGameState,
  deriveVisibleState,
  type VisibleState,
} from "../game";
import { ResourceHud } from "./ResourceHud";

const makeVisible = (resources: VisibleState["resources"]): VisibleState => ({
  ...deriveVisibleState(createInitialGameState()),
  resources,
});

const meta = {
  title: "UI/Resources/ResourceHud",
  component: ResourceHud,
  parameters: {
    layout: "padded",
  },
  args: {
    onReset: () => undefined,
    animateResourceGains: false,
  },
} satisfies Meta<typeof ResourceHud>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    visible: makeVisible({ data: 1, credits: 0 }),
  },
};

export const HighValues: Story = {
  args: {
    visible: makeVisible({ data: 1_048_576, credits: 987_654 }),
  },
};

export const ZeroedAfterReset: Story = {
  args: {
    visible: makeVisible({ data: 0, credits: 0 }),
  },
};

function ResourceGainDemo() {
  const [resources, setResources] = useState({ data: 8, credits: 20 });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setResources({ data: 12, credits: 37 });
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <ResourceHud
      visible={makeVisible(resources)}
      onReset={() => setResources({ data: 0, credits: 0 })}
      animateResourceGains
    />
  );
}

export const GainAnimation: Story = {
  args: {
    visible: makeVisible({ data: 8, credits: 20 }),
    onReset: () => undefined,
    animateResourceGains: true,
  },
  render: () => <ResourceGainDemo />,
};
