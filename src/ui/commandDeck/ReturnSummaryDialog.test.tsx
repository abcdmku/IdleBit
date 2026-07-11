import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  amount,
  createInitialGameState,
  deriveVisibleState,
  type AdvanceReport,
} from "../../game";
import { ReturnSummaryDialog } from "./ReturnSummaryDialog";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const report: AdvanceReport = {
  mode: "offline",
  elapsedMs: 3 * 60 * 60 * 1_000,
  simulatedMs: 2 * 60 * 60 * 1_000,
  overflowMs: 60 * 60 * 1_000,
  productiveMs: 75 * 60 * 1_000,
  pausedMs: 45 * 60 * 1_000,
  bufferLevelId: "localScheduler",
  bufferCapacityMs: 2 * 60 * 60 * 1_000,
  standingOrderRenewals: 3,
  creditsEarned: amount(72),
  creditsSpent: amount(9),
  dataEarned: amount(16),
  dataSpent: amount(2),
  destructiveEvents: { psuOverload: 0, unpaidBill: 0, deadlockWipe: 0 },
  safelyAvoidedDestructiveEvents: {
    psuOverload: 0,
    unpaidBill: 0,
    deadlockWipe: 0,
  },
  completedWork: { fetchBit: 4 },
  completedClusterWork: { replicatedShardCommit: 2 },
  completedCloudSlas: { regionalContinuity: 1 },
  completionEvents: [
    {
      source: "contract",
      instanceId: "contract-1",
      workId: "ledgerAudit",
      name: "Ledger Audit",
      creditsEarned: amount(12),
      dataEarned: amount(2),
    },
    {
      source: "project",
      instanceId: "schedulerIntegration:queue-map",
      workId: "schedulerIntegration",
      phaseId: "queue-map",
      name: "Scheduler Integration · Map queue pressure",
      creditsEarned: amount(30),
      dataEarned: amount(3),
    },
  ],
  blockers: ["Queue exhausted."],
};

describe("ReturnSummaryDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it("reports processed time, overflow, resources, work, and blockers", () => {
    const onDismiss = vi.fn();
    act(() => {
      root.render(
        <ReturnSummaryDialog
          report={report}
          visible={deriveVisibleState(createInitialGameState())}
          onDismiss={onDismiss}
        />,
      );
    });

    expect(container.textContent).toContain("2h 0m of 3h 0m away");
    expect(container.textContent).toContain("Outside buffer1h 0m");
    expect(container.textContent).toContain("Renewals3");
    expect(container.textContent).toContain("Buffer used100%");
    expect(container.textContent).toContain("Fetch Bit");
    expect(container.textContent).toContain("Completed infrastructure work");
    expect(container.textContent).toContain("Replicated Shard Commit");
    expect(container.textContent).toContain("Completed Cloud SLA windows");
    expect(container.textContent).toContain("Regional Continuity Window");
    expect(container.textContent).toContain("Completed contracts");
    expect(container.textContent).toContain("Ledger Audit");
    expect(container.textContent).toContain("Completed project phases");
    expect(container.textContent).toContain("Scheduler Integration · Map queue pressure");
    expect(container.textContent).toContain("Next Automation Buffer");
    expect(container.textContent).toContain("Local Scheduler");
    expect(container.textContent).toContain("×2");
    expect(container.textContent).toContain("×4");
    expect(container.textContent).toContain("Queue exhausted.");
    expect(container.textContent).toContain("+72");
    expect(container.textContent).toContain("+16");

    const close = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close return summary"]',
    );
    expect(document.activeElement).toBe(close);

    act(() => close?.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
