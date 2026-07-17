import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  amount,
  applyAction,
  automationBufferDefinitions,
  createInitialGameState,
  exactResourceBag,
  recordDeparture,
  type GameState,
} from "../src/game";
import {
  installGameSave,
  readPersistedGameState,
  SAVE_STORAGE_KEY,
} from "./save-fixture";

const HOUR_MS = 60 * 60 * 1_000;

const createLongRunningMotionState = (): GameState => {
  const started = applyAction(createInitialGameState(), {
    type: "startTask",
    taskId: "fetchBit",
  });
  const longRunningCycles = amount("1000000000");
  const activeTasks = started.activeTasks.map((task) => ({
    ...task,
    remainingCycles: longRunningCycles,
    totalCycles: longRunningCycles,
    projectedWorkCycles: longRunningCycles,
    coreOperations: task.coreOperations.map((operation) => ({
      ...operation,
      status: "running" as const,
      memoryState: "ready" as const,
      remainingCycles: longRunningCycles,
      totalCycles: longRunningCycles,
      remainingLoadCycles: amount(0),
      totalLoadCycles: amount(0),
    })),
  }));
  return { ...started, activeTasks, activeJobs: activeTasks };
};

const cssTimesAreZero = (value: string) =>
  value.split(",").every((part) => Number.parseFloat(part) === 0);

const waitForHydration = async (page: Page) => {
  await expect(page.getByText("IdleBit", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("main", { name: "IdleBit system workbench" }),
  ).not.toHaveAttribute("aria-busy", "true");
};

const wcagA11yViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page })
    .withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22a",
      "wcag22aa",
    ])
    .analyze();
  return results.violations;
};

const expectMinimumTargetSize = async (
  locator: Locator,
  label: string,
  minimumCssPixels = 24,
) => {
  const targets = await locator.evaluateAll((elements) =>
    elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
        ? [{ width: rect.width, height: rect.height }]
        : [];
    }),
  );
  expect(targets.length, `${label} should expose visible controls`).toBeGreaterThan(0);
  for (const target of targets) {
    expect(
      Math.min(target.width, target.height),
      `${label} target ${target.width.toFixed(1)}×${target.height.toFixed(1)}`,
    ).toBeGreaterThanOrEqual(minimumCssPixels);
  }
};

test.describe("workbench shell", () => {
  test("prevents text selection throughout the application", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);

    const selectableElements = await page.locator("body, body *").evaluateAll(
      (elements) =>
        elements.filter(
          (element) => window.getComputedStyle(element).userSelect !== "none",
        ).length,
    );

    expect(selectableElements).toBe(0);
  });

  for (const viewport of [
    { name: "phone-320", width: 320, height: 720 },
    { name: "phone-430", width: 430, height: 860 },
    { name: "tablet-760", width: 760, height: 900 },
    { name: "desktop-1920", width: 1920, height: 1080 },
  ]) {
    test(`stays playable without page overflow at ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await waitForHydration(page);

      await expect(
        page.getByRole("complementary", { name: "Work" }),
      ).toBeVisible();
      await expect(page.locator(".command-deck-strip")).toHaveCount(0);
      await expect(page.locator(".mobile-current-objective")).toHaveCount(0);
      await expect(page.locator(".topbar-stage")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("Bootstrap Node");

      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(
        dimensions.clientWidth + 1,
      );
    });
  }

  for (const viewport of [
    { name: "phone-320", width: 320, height: 720 },
    { name: "desktop-1920", width: 1920, height: 1080 },
  ]) {
    test(`has no tagged WCAG accessibility violations at ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await waitForHydration(page);
      expect(await wcagA11yViolations(page)).toEqual([]);
    });
  }

  for (const viewport of [
    { name: "phone-320", width: 320, height: 720 },
    { name: "desktop-1920", width: 1920, height: 1080 },
  ]) {
    test(`matches core progress to the PSU meter and suppresses transitions with reduced motion at ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await installGameSave(
        page,
        createLongRunningMotionState(),
        Date.now() + 60_000,
      );
      await page.goto("/");
      await waitForHydration(page);
      if (viewport.width <= 760) {
        await page.getByRole("button", { name: /^HW/ }).click();
      }

      const transitionProbe = page.locator(".resource-readout").first();
      const animationProbe = page
        .locator(".core-die.running .die-progress")
        .first();
      await expect(transitionProbe).toBeVisible();
      await expect(animationProbe).toBeVisible();

      const baseline = await page.evaluate(() => {
        const transitionElement = document.querySelector(".resource-readout");
        const animationElement = document.querySelector(
          ".core-die.running .die-progress",
        );
        const psuElement = document.querySelector(
          ".psu-section .stat-tile-meter",
        );
        if (!transitionElement || !animationElement || !psuElement) {
          throw new Error("Expected representative motion probes");
        }
        const transition = getComputedStyle(transitionElement);
        const animation = getComputedStyle(animationElement);
        const fill = animationElement.querySelector(".progress-fill");
        const psuFill = psuElement.querySelector(".stat-tile-meter-fill");
        if (!fill || !psuFill) throw new Error("Expected meter fills");
        const fillStyle = getComputedStyle(fill);
        const psu = getComputedStyle(psuElement);
        const psuFillStyle = getComputedStyle(psuFill);
        return {
          reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
          transitionDuration: transition.transitionDuration,
          animationName: animation.animationName,
          animationDuration: animation.animationDuration,
          coreMeter: {
            height: animation.height,
            borderRadius: animation.borderRadius,
            backgroundColor: animation.backgroundColor,
            overflow: animation.overflow,
          },
          psuMeter: {
            height: psu.height,
            borderRadius: psu.borderRadius,
            backgroundColor: psu.backgroundColor,
            overflow: psu.overflow,
          },
          coreFill: {
            borderRadius: fillStyle.borderRadius,
            transitionDuration: fillStyle.transitionDuration,
            transitionTimingFunction: fillStyle.transitionTimingFunction,
          },
          psuFill: {
            borderRadius: psuFillStyle.borderRadius,
            transitionDuration: psuFillStyle.transitionDuration,
            transitionTimingFunction: psuFillStyle.transitionTimingFunction,
          },
        };
      });
      expect(baseline.reducedMotion).toBe(false);
      expect(cssTimesAreZero(baseline.transitionDuration)).toBe(false);
      expect(baseline.animationName).toBe("none");
      expect(cssTimesAreZero(baseline.animationDuration)).toBe(true);
      expect(baseline.coreMeter).toEqual(baseline.psuMeter);
      expect(baseline.coreFill).toEqual(baseline.psuFill);
      expect(
        Number.parseFloat(baseline.coreFill.transitionDuration),
      ).toBeGreaterThan(0);
      expect(
        Number.parseFloat(baseline.coreFill.transitionDuration),
      ).toBeLessThanOrEqual(0.01);

      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect
        .poll(() =>
          page.evaluate(() =>
            matchMedia("(prefers-reduced-motion: reduce)").matches,
          ),
        )
        .toBe(true);

      const reduced = await page.evaluate(() => {
        const transitionElement = document.querySelector(".resource-readout");
        const animationElement = document.querySelector(
          ".core-die.running .die-progress",
        );
        if (!transitionElement || !animationElement) {
          throw new Error("Expected representative motion probes");
        }
        const transition = getComputedStyle(transitionElement);
        const animation = getComputedStyle(animationElement);
        return {
          transitionDuration: transition.transitionDuration,
          transitionProperty: transition.transitionProperty,
          animationName: animation.animationName,
          animationDuration: animation.animationDuration,
        };
      });
      expect(reduced.transitionProperty).toBe("none");
      expect(cssTimesAreZero(reduced.transitionDuration)).toBe(true);
      expect(reduced.animationName).toBe("none");
      expect(cssTimesAreZero(reduced.animationDuration)).toBe(true);
    });
  }

  test("reflows at a 200% zoom-equivalent viewport and keeps representative targets at least 24px", async ({
    page,
  }) => {
    // A 640×900 browser window at 200% zoom exposes a 320×450 CSS viewport.
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride", {
      width: 320,
      height: 450,
      deviceScaleFactor: 2,
      mobile: false,
      screenWidth: 640,
      screenHeight: 900,
    });
    await page.goto("/");
    await waitForHydration(page);

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      devicePixelRatio: window.devicePixelRatio,
    }));
    expect(dimensions.innerWidth).toBe(320);
    expect(dimensions.devicePixelRatio).toBe(2);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(
      dimensions.clientWidth + 1,
    );

    await expectMinimumTargetSize(
      page.getByRole("navigation", { name: "Sections" }).getByRole("button"),
      "mobile section navigation",
    );
    await expectMinimumTargetSize(
      page.getByRole("tablist", { name: "Work views" }).getByRole("tab"),
      "Work view tabs",
    );
    const firstTask = page.locator("article.task-card").first();
    await expectMinimumTargetSize(
      firstTask.locator(".task-pin-button"),
      "task pin",
    );
    await expectMinimumTargetSize(
      firstTask.locator(".task-inspect-button"),
      "task inspect",
    );
    await expectMinimumTargetSize(
      firstTask.locator(".task-run-button"),
      "task dispatch",
    );
    await expectMinimumTargetSize(
      page.getByRole("button", { name: "Open settings" }),
      "settings",
    );
  });
});

test.describe("Automation Buffer purchase flows", () => {
  automationBufferDefinitions.slice(1).forEach((definition, index) => {
    test(`purchases ${definition.name} at its campaign gate`, async ({ page }) => {
      const previous = automationBufferDefinitions[index]!;
      const resources = exactResourceBag("1000000000000000", "1000000000000000");
      const initial = createInitialGameState();
      const state: GameState = {
        ...initial,
        exactResources: resources,
        resources: {
          credits: 1_000_000_000_000_000,
          data: 1_000_000_000_000_000,
        },
        campaign: {
          ...initial.campaign,
          currentChapterId: definition.requiredChapter,
          currentObjectiveId: null,
        },
        research: {
          completed: definition.requiredResearchId
            ? [definition.requiredResearchId]
            : [],
        },
        automationBuffer: {
          ownedLevelId: previous.id,
          departureLevelId: previous.id,
          offlineProcessedMs: 0,
        },
      };
      await installGameSave(page, state, Date.now() + 60_000);

      await page.goto("/");
      await waitForHydration(page);
      const bufferCard = page.locator(".automation-buffer-action");
      await expect(bufferCard).toContainText("After you close the game");
      await bufferCard.getByRole("button", { name: /^Add / }).click();

      await page.getByRole("tab", { name: "Automation" }).click();
      await expect(
        page.locator(".automation-buffer-panel .automation-buffer-level"),
      ).toContainText(definition.name);
    });
  });

  test("keeps an unlocked buffer upgrade usable at 320px", async ({ page }) => {
    const previous = automationBufferDefinitions[0]!;
    const resources = exactResourceBag(1_000, 100);
    const initial = createInitialGameState();
    const state: GameState = {
      ...initial,
      exactResources: resources,
      resources: { credits: 1_000, data: 100 },
      research: { completed: ["localScheduler"] },
      automationBuffer: {
        ownedLevelId: previous.id,
        departureLevelId: previous.id,
        offlineProcessedMs: 0,
      },
    };
    await installGameSave(page, state, Date.now() + 60_000);
    await page.setViewportSize({ width: 320, height: 720 });

    await page.goto("/");
    await waitForHydration(page);
    await page.getByRole("button", { name: "Research" }).click();
    const bufferCard = page.locator(".automation-buffer-action");
    await expect(bufferCard).toContainText(
      "queued work can keep running",
    );
    await expect(bufferCard).toContainText("does not add or repeat jobs");
    const upgrade = bufferCard.getByRole("button", { name: "Add 2h" });
    await expect(upgrade).toBeEnabled();
    await expectMinimumTargetSize(upgrade, "Automation Buffer upgrade", 44);
    await upgrade.click();

    await page.getByRole("button", { name: /^Work,/ }).click();
    await page.getByRole("tab", { name: "Automation" }).click();
    await expect(page.locator(".automation-buffer-panel")).toContainText(
      "Queue jobs before leaving",
    );
    await expect(
      page.locator('.automation-buffer-panel .stat-tile[aria-label="Max 2h"]'),
    ).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(
      dimensions.clientWidth + 1,
    );
  });
});

test("caps an absence at the buffer owned on departure and reports overflow", async ({
  page,
}) => {
  const departedAtMs = Date.now() - 3 * HOUR_MS;
  const state = recordDeparture(
    {
      ...createInitialGameState(),
      automationBuffer: {
        ownedLevelId: "localScheduler",
        departureLevelId: "localScheduler",
        offlineProcessedMs: 0,
      },
    },
    departedAtMs,
  );
  await installGameSave(page, state, departedAtMs);

  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Return summary" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("processed 2h 0m of 3h");
  await expect(dialog.getByText("Outside buffer")).toBeVisible();
  await expect(dialog).toContainText(/1h 0m/);
  await expect(dialog).toContainText("Queue exhausted");
  expect(await wcagA11yViolations(page)).toEqual([]);
});

test("renews a valid CRON standing order while away", async ({ page }) => {
  const departedAtMs = Date.now() - 10 * 60_000;
  const resources = exactResourceBag("1000000", "1000");
  const initial = createInitialGameState();
  const state = recordDeparture(
    {
      ...initial,
      exactResources: resources,
      resources: { credits: 1_000_000, data: 1_000 },
      research: { completed: ["cronScheduler"] },
      flags: { ...initial.flags, cron: true },
      automationBuffer: {
        ownedLevelId: "cronRuntime",
        departureLevelId: "cronRuntime",
        offlineProcessedMs: 0,
      },
      standingOrder: {
        taskId: "fetchBit",
        systemId: 1,
        enabled: true,
        renewalCount: 0,
      },
    },
    departedAtMs,
  );
  await installGameSave(page, state, departedAtMs);

  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Return summary" });
  await expect(dialog).toBeVisible();
  const renewals = dialog.getByText("Renewals").locator("..").locator("dd");
  await expect(renewals).not.toHaveText("0");
  await expect(dialog).toContainText("Fetch Bit");
});

test("surfaces a persistence read failure and permits an explicit confirmed reset", async ({
  page,
}) => {
  const initial = createInitialGameState();
  const progressed: GameState = {
    ...initial,
    exactResources: exactResourceBag(321, 45),
    resources: { credits: 321, data: 45 },
    completedTasks: { fetchBit: 1 },
    completedJobs: { fetchBit: 1 },
  };
  const seedPage = await page.context().newPage();
  await installGameSave(seedPage, progressed, Date.now() + 60_000);
  await seedPage.goto("/");
  await waitForHydration(seedPage);
  expect((await readPersistedGameState(seedPage)).resources).toEqual({
    credits: 321,
    data: 45,
  });
  await seedPage.close();

  const resetReadBypassKey = "idlebit:e2e-reset-read-bypass";
  await page.addInitScript(({ saveKey, bypassKey }) => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key: string) {
      if (
        key === saveKey &&
        window.sessionStorage.getItem(bypassKey) !== "true"
      ) {
        throw new Error("read unavailable");
      }
      return original.call(this, key);
    };
  }, { saveKey: SAVE_STORAGE_KEY, bypassKey: resetReadBypassKey });

  await page.goto("/");
  await waitForHydration(page);
  await expect(page.getByText(/Load failed: read unavailable/)).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Reset save" }).click();
  const resetDialog = page.getByRole("alertdialog", { name: "Reset save?" });
  await expect(resetDialog).toBeVisible();
  await resetDialog.getByRole("button", { name: "Reset progress" }).click();
  await expect(resetDialog).toBeHidden();
  await expect(page.locator(".topbar-persistence-slot")).toHaveAttribute(
    "data-persistence-phase",
    "saved",
  );
  await expect(page.getByText("Saved", { exact: true })).toBeHidden();

  await page.evaluate(
    (bypassKey) => window.sessionStorage.setItem(bypassKey, "true"),
    resetReadBypassKey,
  );
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByText(/Load failed:/)).toBeHidden();
  const reset = await readPersistedGameState(page);
  expect(reset.exactResources).toEqual(exactResourceBag(10, 0));
  expect(reset.completedTasks).toEqual({});
  expect(reset.automationBuffer.ownedLevelId).toBe("startingNode");
});

test("surfaces a persistence write failure instead of claiming the game was saved", async ({
  page,
}) => {
  await page.addInitScript((saveKey) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === saveKey) throw new Error("write unavailable");
      return original.call(this, key, value);
    };
  }, SAVE_STORAGE_KEY);

  await page.goto("/");
  await waitForHydration(page);
  await expect(page.getByText(/Save failed: write unavailable/)).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeHidden();
});

test("keeps a persistence write failure readable without mobile layout shift", async ({
  page,
}) => {
  await page.addInitScript((saveKey) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === saveKey) throw new Error("write unavailable");
      return original.call(this, key, value);
    };
  }, SAVE_STORAGE_KEY);
  await page.setViewportSize({ width: 320, height: 720 });

  await page.goto("/");
  await waitForHydration(page);
  await expect(page.getByText(/Save failed: write unavailable/)).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(
    dimensions.clientWidth + 1,
  );
});

test("commits the departure snapshot synchronously on pagehide", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  await expect(page.locator(".topbar-persistence.sr-only")).toHaveText("Saved");

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
  });
  const departure = await page.evaluate((saveKey) => {
    const stored = window.localStorage.getItem(saveKey);
    if (stored === null) return null;
    const serialized = JSON.parse(stored) as string;
    const envelope = JSON.parse(serialized) as {
      departedAtMs: number | null;
      state: {
        automationBuffer: {
          ownedLevelId: string;
          departureLevelId: string;
        };
        time: { departedAtMs: number | null };
      };
    };
    return envelope;
  }, SAVE_STORAGE_KEY);

  expect(departure?.departedAtMs).toEqual(expect.any(Number));
  expect(departure?.state.time.departedAtMs).toBe(departure?.departedAtMs);
  expect(departure?.state.automationBuffer.departureLevelId).toBe(
    departure?.state.automationBuffer.ownedLevelId,
  );
});
