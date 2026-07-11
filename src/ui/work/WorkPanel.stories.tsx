import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  createInitialGameState,
  deriveVisibleState,
  exactResourceBag,
  type VisibleContract,
  type VisibleState,
} from "../../game";
import { WorkPanel } from "./WorkPanel";
type LiveOperationsVisibleState = VisibleState;

const initialVisible = deriveVisibleState(createInitialGameState());
const contract: VisibleContract = {
  id: "story-contract",
  templateId: "ledgerAudit",
  kind: "sustained",
  name: "Ledger Audit",
  description: "Verify a bounded ledger workload before the offer expires.",
  systemId: initialVisible.selectedSystem.id,
  workRequiredMs: 90 * 60 * 1_000,
  workCompletedMs: 0,
  remainingMs: 90 * 60 * 1_000,
  expiresAtMs: 6 * 60 * 60 * 1_000,
  rewards: exactResourceBag(80, 12),
  novel: true,
  accepted: false,
  valuePerHourCredits: exactResourceBag(53.3, 0).credits,
  expiresInMs: 6 * 60 * 60 * 1_000,
  operatingCostCredits: exactResourceBag(8, 0).credits,
  netRewardCredits: exactResourceBag(72, 0).credits,
  creditRunwayCovered: true,
  bufferCovered: true,
  canAccept: true,
  projectedPauseReason: null,
};
const planningVisible: VisibleState = {
  ...initialVisible,
  contracts: [contract],
  work: { ...initialVisible.work, contracts: [contract] },
  automationBuffer: {
    ...initialVisible.automationBuffer,
    ownedLevelId: "localScheduler",
    maxOfflineMs: 2 * 60 * 60 * 1_000,
    remainingOfflineMs: 2 * 60 * 60 * 1_000,
  },
  activeWork: [
    {
      id: "job:story",
      kind: "job",
      name: "Ledger preparation",
      progress: 0.35,
      remainingMs: 45 * 60 * 1_000,
      systemId: initialVisible.selectedSystem.id,
    },
  ],
};

const liveOperationsVisible: LiveOperationsVisibleState = {
  ...initialVisible,
  liveOperations: {
    unlocked: true,
    enabled: true,
    canConfigure: true,
    systemId: initialVisible.selectedSystem.id,
    maxCoreCount: 4,
    maximumCoreCount: 6,
    workMix: [
      { id: "liveQueueTriage", name: "Queue Triage" },
      { id: "liveCanaryValidation", name: "Canary Validation" },
    ],
    activeTaskId: "liveCanaryValidation",
    activeTaskName: "Canary Validation",
    nextTaskName: "Queue Triage",
    allocatedCoreCount: 2,
    progress: 0.42,
    remainingMs: 8 * 60 * 1_000,
    projectedDurationMs: 19 * 60 * 1_000,
    projectedPowerWatts: "18.5",
    projectedOperatingCostCredits: exactResourceBag("12.5").credits,
    projectedRewardCredits: exactResourceBag(50).credits,
    projectedNetRewardCredits: exactResourceBag("37.5").credits,
    projectedMarginBps: 7_500,
    blockedReason: null,
    offlineBehavior: "Live Ops resumes from the retained batch on return.",
  },
};

const meta = {
  title: "UI/Work/WorkPanel",
  component: WorkPanel,
  parameters: { layout: "padded" },
  args: {
    selectedComponent: "core:1",
    dispatch: () => undefined,
  },
  decorators: [
    (Story) => (
      <aside className="panel tasks-panel" style={{ width: 340, height: 760 }}>
        <Story />
      </aside>
    ),
  ],
} satisfies Meta<typeof WorkPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstScreenJobs: Story = {
  args: { visible: initialVisible },
};

export const DeparturePlanning: Story = {
  args: { visible: planningVisible },
  play: ({ canvasElement }) => {
    canvasElement
      .querySelector<HTMLButtonElement>('[role="tab"][aria-label="Automation"]')
      ?.click();
  },
};

export const LiveOperationsUnlocked: Story = {
  args: { visible: liveOperationsVisible },
  play: ({ canvasElement }) => {
    canvasElement
      .querySelector<HTMLButtonElement>('[role="tab"][aria-label="Automation"]')
      ?.click();
  },
};
