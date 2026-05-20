import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  createInitialGameState,
  createRackReadyGameState,
  deriveVisibleState,
  type VisibleState,
} from "../game";
import {
  CoreCacheRow,
  SystemBoard,
  SystemRack,
  SystemRail,
} from "./MotherboardLayout";

const initialVisible = deriveVisibleState(createInitialGameState());
const rackReadyVisible = deriveVisibleState(createRackReadyGameState());
const offlineVisible: VisibleState = {
  ...initialVisible,
  metrics: {
    ...initialVisible.metrics,
    powerState: "off",
  },
};

const meta = {
  title: "UI/MotherboardLayout",
  component: SystemBoard,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof SystemBoard>;

export default meta;

type Story = StoryObj<typeof meta>;

function DemoSection({
  title,
  detail,
  tone = "normal",
}: {
  title: string;
  detail: string;
  tone?: "normal" | "selected" | "warning";
}) {
  return (
    <section
      className={`hw-section ${tone === "selected" ? "selected" : ""} ${
        tone === "warning" ? "warning" : ""
      }`}
    >
      <div className="hw-section-header">
        <span>{title}</span>
        <small>{detail}</small>
      </div>
      <div className="upgrade-chips">
        <span className="upgrade-chip">Installed</span>
        <span className="upgrade-chip muted">Ready</span>
      </div>
    </section>
  );
}

export const FirstScreenBoard: Story = {
  args: {
    visible: initialVisible,
    children: null,
  },
  render: () => (
    <SystemBoard visible={initialVisible}>
      <CoreCacheRow>
        <DemoSection title="Core package" detail="1 core" tone="selected" />
        <DemoSection title="Cache" detail="2 bits" />
      </CoreCacheRow>
      <SystemRail>
        <DemoSection title="Power" detail="online" />
        <DemoSection title="Telemetry" detail="locked" />
      </SystemRail>
    </SystemBoard>
  ),
};

export const PoweredOffBoard: Story = {
  args: {
    visible: offlineVisible,
    children: null,
  },
  render: () => (
    <SystemBoard visible={offlineVisible}>
      <CoreCacheRow>
        <DemoSection title="Core package" detail="offline" />
        <DemoSection title="Cache" detail="standby" />
      </CoreCacheRow>
      <SystemRail>
        <DemoSection title="Power" detail="off" tone="warning" />
      </SystemRail>
    </SystemBoard>
  ),
};

export const RackWithSelectedSystem: Story = {
  args: {
    visible: rackReadyVisible,
    children: null,
  },
  render: () => (
    <div style={{ display: "grid", gap: 12 }}>
      <SystemRack>
        <div className="system-rack-header">
          <span className="system-rack-title">
            Systems
            <small>{rackReadyVisible.systems.length} online</small>
          </span>
        </div>
        <div className="system-rack-slots" aria-label="Owned systems">
          {rackReadyVisible.systems.map((system) => (
            <button
              type="button"
              className={`system-rack-slot system-rack-slot--chip ${
                system.id === rackReadyVisible.selectedSystem.id ? "selected" : ""
              } status-${system.powerState === "on" ? "online" : "off"}`}
              key={system.id}
            >
              <span className="rack-slot-index">{system.id}</span>
              <span className="rack-slot-copy">
                <strong>{system.name}</strong>
                <small>{system.coreCount} cores</small>
              </span>
            </button>
          ))}
        </div>
      </SystemRack>
      <SystemBoard visible={rackReadyVisible}>
        <CoreCacheRow>
          <DemoSection title="CPU bank" detail="4 cores" tone="selected" />
          <DemoSection title="Cache plane" detail="64 bits" />
        </CoreCacheRow>
        <SystemRail>
          <DemoSection title="RAM rail" detail="4 sticks" />
          <DemoSection title="Scheduler" detail="2 system slots" />
        </SystemRail>
      </SystemBoard>
    </div>
  ),
};
