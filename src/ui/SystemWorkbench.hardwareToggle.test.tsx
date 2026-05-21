import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInitialGameState,
  deriveVisibleState,
  type VisibleState,
} from "../game";
import { SystemWorkbench } from "./components";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("SystemWorkbench hardware upgrade toggle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it("toggles the hardware panel upgrade controls from the header", () => {
    const base = deriveVisibleState(createInitialGameState());
    const visible: VisibleState = {
      ...base,
      flags: {
        ...base.flags,
        basicQueue: true,
        scheduler: true,
      },
      hardware: {
        ...base.hardware,
        schedulerSlots: 1,
        systemSchedulerSlots: 1,
        cpus: base.hardware.cpus.map((cpu) => ({ ...cpu, schedulerSlots: 1 })),
      },
      upgrades: [
        {
          id: "systemSchedulerSlot",
          name: "System Queue Slot",
          component: "scheduler",
          accent: "violet",
          costs: [],
          refunds: [],
          canAfford: true,
          canDowngrade: false,
          downgradeBlockedReason: null,
          purchaseCount: 1,
        },
      ],
    };

    act(() => {
      root.render(
        <SystemWorkbench
          visible={visible}
          dispatch={() => undefined}
          selectedComponent={null}
          onSelectComponent={() => undefined}
          onReset={() => undefined}
          animateResourceGains={false}
          pinnedTaskIds={[]}
          onTogglePinnedTask={() => undefined}
          onUnpinTask={() => undefined}
          onClearPinnedTasks={() => undefined}
        />,
      );
    });

    const hardwarePanel = container.querySelector<HTMLElement>(".hw-panel");
    const toggle = container.querySelector<HTMLInputElement>(
      ".hardware-upgrade-toggle input",
    );

    expect(toggle?.checked).toBe(false);
    expect(hardwarePanel?.classList.contains("hide-upgrades")).toBe(false);
    expect(
      container.querySelector(".system-scheduler-section .inline-upgrade-row")
        ?.textContent,
    ).toContain("System Queue Slot");

    act(() => {
      toggle?.click();
    });

    expect(toggle?.checked).toBe(true);
    expect(hardwarePanel?.classList.contains("hide-upgrades")).toBe(true);
  });
});
