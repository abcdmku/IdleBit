import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialGameState,
  deserializeSave,
  exactResourceBag,
  recordDeparture,
  RACK_READY_SEED_CREDITS,
  serializeSave,
  type GameState,
} from "../game";
import { idleBitPersistence } from "../platform";
import { App } from "./App";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("App failure modals", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rafSpy: { mockRestore(): void };
  let cancelRafSpy: { mockRestore(): void };
  let originalMatchMedia: typeof window.matchMedia | undefined;

  const makePsuFailureSaveState = (): GameState => {
    const base = createInitialGameState();

    return {
      ...base,
      power: {
        ...base.power,
        state: "off",
        transitionSeconds: 0,
        bootstrapGraceSeconds: 0,
        overloadFailureSeconds: 0,
        lastFailureReason: "psuOverload",
        failureCount: 1,
      },
    };
  };

  const makeCreditFailureSaveState = (): GameState => {
    const base = createInitialGameState();

    return {
      ...base,
      resources: {
        ...base.resources,
        credits: 0,
      },
      power: {
        ...base.power,
        state: "off",
        transitionSeconds: 0,
        bootstrapGraceSeconds: 0,
        overloadFailureSeconds: 0,
        lastFailureReason: "unpaidBill",
        failureCount: 1,
      },
    };
  };

  const makeUnlockNoticeSaveState = (): GameState => {
    const base = createInitialGameState();

    return {
      ...base,
      resources: {
        credits: 50,
        data: 2,
      },
      completedTasks: {
        fetchBit: 1,
      },
      completedJobs: {
        fetchBit: 1,
      },
      research: {
        completed: ["decodeLogic"],
      },
    };
  };

  const flushEffects = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  beforeEach(async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    await idleBitPersistence.clear();
    originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 1);
    cancelRafSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => {
      root.unmount();
    });
    container.remove();
    rafSpy.mockRestore();
    cancelRafSpy.mockRestore();
    if (originalMatchMedia) {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
    await idleBitPersistence.clear();
    window.history.replaceState(null, "", "/");
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it.each(["rack-ready", "trillion"])(
    "creates a rack-ready session from the %s seed URL",
    async (seed) => {
      window.history.pushState(null, "", `/?seed=${seed}`);

      await act(async () => {
        root.render(<App />);
      });
      await flushEffects();

      const rawSave = await idleBitPersistence.get<string>("save-v7");
      const restored = deserializeSave(rawSave);

      expect(window.location.search).toBe("");
      expect(restored.resources.credits).toBe(RACK_READY_SEED_CREDITS);
      expect(restored.resources.data).toBeGreaterThan(20_000);
      expect(restored.flags.systemCatalog).toBe(true);
      expect(restored.flags.customMachineAssembly).toBe(true);
      expect(restored.systems).toHaveLength(2);
      expect(restored.systems[0]?.name).toBe("Fleet-Ready Workstation");
      expect(restored.systems[1]?.hardware.cores).toBe(128);
      expect(restored.systems[1]?.hardware.ramSticks).toHaveLength(32);
      const rackPanel = container.querySelector(".system-rack");
      expect(rackPanel?.textContent).toContain("Fleet");
      expect(rackPanel?.textContent).toContain("Fleet-Ready Workstation");
      expect(rackPanel?.textContent).toContain("Dense Compute Node");
    },
  );

  it("restores a valid save when optional UI preferences are corrupt", async () => {
    const savedState = {
      ...createInitialGameState(),
      resources: {
        credits: 123,
        data: 45,
      },
      exactResources: exactResourceBag(123, 45),
    };

    await idleBitPersistence.set("save-v7", serializeSave(savedState));
    window.localStorage.setItem("idlebit:ui.pinned-tasks-v1", "{bad-json");

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    expect(
      container.querySelector(".resource-readout.credits strong")?.textContent,
    ).toBe("123");
    expect(
      container.querySelector(".resource-readout.data strong")?.textContent,
    ).toBe("45");
  });

  it("shows and dismisses a compact PSU failure popup after overload cutoff", async () => {
    await idleBitPersistence.set(
      "save-v7",
      serializeSave(makePsuFailureSaveState()),
    );

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    const modal = container.querySelector(".psu-failure-modal");

    expect(modal?.textContent).toContain("PSU failure");
    expect(modal?.textContent).toContain("overload protection tripped");
    expect(modal?.textContent).toContain("cleared active and queued work");
    expect(modal?.textContent).not.toContain("Active processes cleared");
    expect(container.querySelector(".topbar-alert-badge.psu-failure")).toBeNull();

    act(() => {
      modal?.querySelector<HTMLButtonElement>(".psu-failure-primary")?.click();
    });
    await flushEffects();

    expect(container.querySelector(".psu-failure-modal")).toBeNull();
    await expect(
      idleBitPersistence.get<boolean>("ui.psu-failure-modal-seen-v1", false),
    ).resolves.toBe(true);
  });

  it("uses a topbar badge instead of the popup after the first PSU failure", async () => {
    await idleBitPersistence.set(
      "save-v7",
      serializeSave(makePsuFailureSaveState()),
    );
    await idleBitPersistence.set("ui.psu-failure-modal-seen-v1", true);

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    const badge = container.querySelector<HTMLButtonElement>(
      ".topbar-alert-badge.psu-failure",
    );

    expect(container.querySelector(".psu-failure-modal")).toBeNull();
    expect(badge?.textContent).toContain("PSU tripped");

    act(() => {
      badge?.click();
    });

    expect(container.querySelector(".topbar-alert-badge.psu-failure")).toBeNull();
  });

  it("explains the first out-of-credits power cutoff", async () => {
    await idleBitPersistence.set(
      "save-v7",
      serializeSave(makeCreditFailureSaveState()),
    );

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    const modal = container.querySelector(".credit-failure-modal");

    expect(modal?.textContent).toContain("Out of credits");
    expect(modal?.textContent).toContain("The power bill drained your credits");
    expect(modal?.textContent).toContain("idle hardware draws cr/s");
    expect(modal?.textContent).toContain("brief grace period before billing resumes");
    expect(modal?.textContent).toContain("avoid another cutoff");
    expect(container.querySelector(".credit-failure-repeat-modal")).toBeNull();

    act(() => {
      modal?.querySelector<HTMLButtonElement>(".credit-failure-primary")?.click();
    });
    await flushEffects();

    expect(container.querySelector(".credit-failure-modal")).toBeNull();
    await expect(
      idleBitPersistence.get<boolean>("ui.credit-failure-modal-seen-v1", false),
    ).resolves.toBe(true);
  });

  it("uses a blocking modal for later out-of-credits cutoffs", async () => {
    await idleBitPersistence.set(
      "save-v7",
      serializeSave(makeCreditFailureSaveState()),
    );
    await idleBitPersistence.set("ui.credit-failure-modal-seen-v1", true);

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    const repeatModal = container.querySelector(".credit-failure-repeat-modal");
    const overlay = container.querySelector(".credit-failure-repeat-overlay");

    expect(container.querySelector(".credit-failure-modal")).toBeNull();
    expect(overlay?.contains(repeatModal)).toBe(true);
    expect(repeatModal?.getAttribute("aria-modal")).toBe("true");
    expect(repeatModal?.textContent).toContain("Out of credits");
    expect(repeatModal?.textContent).toContain("The power bill drained your balance");
    expect(repeatModal?.textContent).toContain("brief grace period before billing resumes");

    act(() => {
      overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector(".credit-failure-repeat-modal")).not.toBeNull();

    act(() => {
      repeatModal?.querySelector<HTMLButtonElement>("button")?.click();
    });

    expect(container.querySelector(".credit-failure-repeat-modal")).toBeNull();
  });

  it("keeps the return summary behind a credit failure dialog", async () => {
    // Sub-minute absences no longer surface a return report; use a real one.
    const departedAtMs = Date.now() - 120_000;
    const departed = recordDeparture(
      makeCreditFailureSaveState(),
      departedAtMs,
    );
    await idleBitPersistence.set(
      "save-v7",
      serializeSave(departed, departedAtMs),
    );

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    const creditModal = container.querySelector(".credit-failure-modal");
    expect(creditModal).not.toBeNull();
    expect(container.querySelector(".return-summary-dialog")).toBeNull();

    act(() => {
      creditModal
        ?.querySelector<HTMLButtonElement>(".credit-failure-primary")
        ?.click();
    });
    await flushEffects();

    expect(container.querySelector(".credit-failure-modal")).toBeNull();
    expect(container.querySelector(".return-summary-dialog")).not.toBeNull();
  });

  it("confirmed reset clears game, pinned, and notice state in storage", async () => {
    const base = createInitialGameState();
    const progressed: GameState = {
      ...base,
      resources: { credits: 321, data: 45 },
      exactResources: exactResourceBag(321, 45),
    };
    await idleBitPersistence.set("save-v7", serializeSave(progressed));
    await idleBitPersistence.set("ui.pinned-tasks-v1", ["fetchBit"]);
    for (const key of [
      "ui.deadlock-help-seen-v1",
      "ui.deadlock-cooldown-help-seen-v1",
      "ui.psu-failure-help-seen-v1",
      "ui.psu-failure-modal-seen-v1",
      "ui.credit-failure-modal-seen-v1",
    ]) {
      await idleBitPersistence.set(key, true);
    }

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(".resource-settings-button")
        ?.click();
    });
    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Reset save"]')
        ?.click();
    });
    const resetDialog = container.querySelector(".reset-confirmation-dialog");
    act(() => {
      Array.from(resetDialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.textContent?.includes("Reset progress"))
        ?.click();
    });
    await flushEffects();
    await flushEffects();

    const saved = deserializeSave(
      await idleBitPersistence.get<string>("save-v7"),
    );
    expect(saved.resources).toEqual(base.resources);
    await expect(
      idleBitPersistence.get<string[]>("ui.pinned-tasks-v1", []),
    ).resolves.toEqual([]);
    for (const key of [
      "ui.deadlock-help-seen-v1",
      "ui.deadlock-cooldown-help-seen-v1",
      "ui.psu-failure-help-seen-v1",
      "ui.psu-failure-modal-seen-v1",
      "ui.credit-failure-modal-seen-v1",
    ]) {
      await expect(idleBitPersistence.get<boolean>(key, true)).resolves.toBe(
        false,
      );
    }
  });

  it("marks default mobile Work viewed and research viewed when opened", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    await idleBitPersistence.set(
      "save-v7",
      serializeSave(makeUnlockNoticeSaveState()),
    );
    await idleBitPersistence.set("ui.seen-tasks-v1", ["fetchBit", "decodeBit"]);
    await idleBitPersistence.set("ui.seen-research-v1", ["decodeLogic"]);

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    const tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".section-tab"),
    );
    const tasksTab = tabs[0];
    let researchTab = tabs[2];

    expect(tasksTab?.className).not.toContain("has-notification");
    expect(tasksTab?.getAttribute("aria-label")).toBe(
      "Work, 0 active work items",
    );
    expect(tasksTab?.title).toBe("0 active work items");
    expect(researchTab?.className).toContain("has-notification");
    expect(researchTab?.getAttribute("aria-label")).toBe("Research, 3 new");
    expect(researchTab?.title).toBe("3 new research");
    const seenTasks = await idleBitPersistence.get<string[]>(
      "ui.seen-tasks-v1",
      [],
    );
    expect(seenTasks).toEqual(
      expect.arrayContaining(["fetchBit", "decodeBit", "bitFlip", "bitShift"]),
    );
    expect(seenTasks).not.toEqual(
      expect.arrayContaining(["byteCopy", "packetCheck"]),
    );

    await act(async () => {
      researchTab?.click();
    });
    await flushEffects();

    researchTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".section-tab"),
    )[2];

    expect(researchTab?.className).not.toContain("has-notification");
    expect(researchTab?.getAttribute("aria-label")).toBe("Research");
    await expect(
      idleBitPersistence.get<string[]>("ui.seen-research-v1", []),
    ).resolves.toEqual(
      expect.arrayContaining([
        "byteOperations",
        "cacheMapping",
        "benchmarkHarness",
      ]),
    );
  });
});
