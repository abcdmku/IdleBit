import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialGameState,
  deserializeSave,
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

      const rawSave = await idleBitPersistence.get<string>("save-v4");
      const restored = deserializeSave(rawSave);

      expect(window.location.search).toBe("");
      expect(restored.resources.credits).toBe(RACK_READY_SEED_CREDITS);
      expect(restored.resources.data).toBeGreaterThan(20_000);
      expect(restored.flags.systemCatalog).toBe(true);
      expect(restored.flags.customMachineAssembly).toBe(true);
      expect(restored.systems).toHaveLength(2);
      expect(restored.systems[0]?.name).toBe("Rack-Ready Workstation");
      expect(restored.systems[1]?.hardware.cores).toBe(128);
      expect(restored.systems[1]?.hardware.ramSticks).toHaveLength(32);
      const rackPanel = container.querySelector(".system-rack");
      expect(rackPanel?.textContent).toContain("Rack");
      expect(rackPanel?.textContent).not.toContain("Rack-Ready Workstation");
      expect(rackPanel?.textContent).not.toContain("Dense Compute Node");
    },
  );

  it("restores a valid save when optional UI preferences are corrupt", async () => {
    const savedState = {
      ...createInitialGameState(),
      resources: {
        credits: 123,
        data: 45,
      },
    };

    await idleBitPersistence.set("save-v4", serializeSave(savedState));
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
      "save-v4",
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
      "save-v4",
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
      "save-v4",
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
    expect(container.querySelector(".credit-failure-toast")).toBeNull();

    act(() => {
      modal?.querySelector<HTMLButtonElement>(".credit-failure-primary")?.click();
    });
    await flushEffects();

    expect(container.querySelector(".credit-failure-modal")).toBeNull();
    await expect(
      idleBitPersistence.get<boolean>("ui.credit-failure-modal-seen-v1", false),
    ).resolves.toBe(true);
  });

  it("uses a quick popup for later out-of-credits cutoffs", async () => {
    await idleBitPersistence.set(
      "save-v4",
      serializeSave(makeCreditFailureSaveState()),
    );
    await idleBitPersistence.set("ui.credit-failure-modal-seen-v1", true);

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    const toast = container.querySelector(".credit-failure-toast");

    expect(container.querySelector(".credit-failure-modal")).toBeNull();
    expect(toast?.textContent).toContain("Out of credits");
    expect(toast?.textContent).toContain("The power bill drained your balance");
    expect(toast?.textContent).toContain("brief grace period before billing resumes");

    act(() => {
      toast?.querySelector<HTMLButtonElement>("button")?.click();
    });

    expect(container.querySelector(".credit-failure-toast")).toBeNull();
  });

  it("marks mobile task and research tab notifications viewed when opened", async () => {
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
      "save-v4",
      serializeSave(makeUnlockNoticeSaveState()),
    );
    await idleBitPersistence.set("ui.seen-tasks-v1", ["fetchBit", "decodeBit"]);
    await idleBitPersistence.set("ui.seen-research-v1", ["decodeLogic"]);

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    let tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".section-tab"),
    );
    let tasksTab = tabs[0];
    let researchTab = tabs[2];

    expect(tasksTab?.className).toContain("has-notification");
    expect(tasksTab?.getAttribute("aria-label")).toBe("Tasks, 4 new");
    expect(tasksTab?.title).toBe("4 new tasks");
    expect(researchTab?.className).toContain("has-notification");
    expect(researchTab?.getAttribute("aria-label")).toBe("Research, 3 new");
    expect(researchTab?.title).toBe("3 new research");

    await act(async () => {
      tasksTab?.click();
    });
    await flushEffects();

    tabs = Array.from(container.querySelectorAll<HTMLButtonElement>(".section-tab"));
    tasksTab = tabs[0];
    researchTab = tabs[2];

    expect(tasksTab?.className).not.toContain("has-notification");
    expect(tasksTab?.getAttribute("aria-label")).toBe("Tasks");
    expect(researchTab?.className).toContain("has-notification");
    await expect(
      idleBitPersistence.get<string[]>("ui.seen-tasks-v1", []),
    ).resolves.toEqual(
      expect.arrayContaining(["bitFlip", "bitShift", "byteCopy", "packetCheck"]),
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

