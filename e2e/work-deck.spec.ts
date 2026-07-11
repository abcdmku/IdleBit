import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  createContractMarketState,
  createProjectsState,
  createRackReadyGameState,
  amount,
  exactResourceBag,
  type GameState,
} from "../src/game";
import {
  installGameSave,
  readPersistedGameState,
  resumePersistedGameAfterAbsence,
} from "./save-fixture";

const createWorkDeckState = (): GameState => {
  const state = createRackReadyGameState();
  return {
    ...state,
    contracts: createContractMarketState(),
    projects: createProjectsState(),
    standingOrder: {
      taskId: null,
      systemId: null,
      enabled: false,
      renewalCount: 0,
    },
    lastAdvanceReport: null,
    time: {
      lastSavedAtMs: null,
      departedAtMs: null,
    },
  };
};

const installWorkDeckSave = async (page: Page) => {
  await installGameSave(page, createWorkDeckState(), Date.now() + 60_000);
};

const waitForHydration = async (page: Page) => {
  await expect(page.getByText("IdleBit", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("main", { name: "IdleBit system workbench" }),
  ).not.toHaveAttribute("aria-busy", "true");
};

const openWorkDeck = async (page: Page) => {
  await installWorkDeckSave(page);
  await page.goto("/");
  await waitForHydration(page);
  await expect(page.getByRole("complementary", { name: "Work" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Return summary" })).toBeHidden();
};

const wcagViolations = async (page: Page) => {
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

test.describe("playable WorkDeck", () => {
  test.beforeEach(async ({ page }) => {
    await openWorkDeck(page);
  });

  test("reaches the current campaign with keyboard arrow navigation", async ({
    page,
  }) => {
    const jobsTab = page.getByRole("tab", { name: "Jobs" });
    const campaignTab = page.getByRole("tab", { name: "Campaign" });

    await jobsTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(campaignTab).toBeFocused();
    await expect(campaignTab).toHaveAttribute("aria-selected", "true");

    const currentMission = page.locator("article.work-card.mission.current");
    await expect(currentMission).toHaveCount(1);
    await expect(currentMission.getByText("Current", { exact: true })).toBeVisible();

    await page.keyboard.press("ArrowLeft");
    await expect(jobsTab).toBeFocused();
    await expect(jobsTab).toHaveAttribute("aria-selected", "true");
  });

  test("starting work updates reserved status without shifting the interface", async ({
    page,
  }) => {
    const jobsTab = page.getByRole("tab", { name: "Jobs" });
    await jobsTab.click();
    const card = page.locator("article.task-card").filter({ hasText: "Fetch Bit" }).first();
    const runnable = card.locator(".task-run-button:not([disabled])");
    const hardware = page.locator(".hw-panel");
    const systemStatus = page.locator(".system-work-summary").first();
    await expect(runnable).toBeVisible();
    await expect(systemStatus).toBeVisible();

    const before = await Promise.all([
      jobsTab.boundingBox(),
      card.boundingBox(),
      hardware.boundingBox(),
      systemStatus.boundingBox(),
    ]);
    await runnable.click();
    await page.waitForTimeout(100);
    const after = await Promise.all([
      jobsTab.boundingBox(),
      card.boundingBox(),
      hardware.boundingBox(),
      systemStatus.boundingBox(),
    ]);

    for (let index = 0; index < before.length; index += 1) {
      expect(before[index]).not.toBeNull();
      expect(after[index]).not.toBeNull();
      for (const key of ["x", "y", "width", "height"] as const) {
        expect(after[index]![key]).toBeCloseTo(before[index]![key], 0);
      }
    }
  });

  test("refreshes, accepts, and declines contracts through visible controls", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Contract Market" }).click();
    const offers = page.locator("article.work-card.contract:not(.active)");
    const activeContracts = page.locator("article.work-card.contract.active");

    await expect(offers).toHaveCount(0);
    await page.getByRole("button", { name: "Refresh market" }).click();
    await expect(offers).toHaveCount(3);

    const acceptedName = (await offers.first().locator("header span").innerText()).trim();
    await offers.first().getByRole("button", { name: "Accept" }).click();
    await expect(activeContracts).toHaveCount(1);
    await expect(activeContracts.first()).toContainText(acceptedName);
    await expect(offers).toHaveCount(2);

    const declinedName = (await offers.first().locator("header span").innerText()).trim();
    await offers.first().getByRole("button", { name: "Decline" }).click();
    await expect(offers).toHaveCount(1);
    await expect(
      page.locator("article.work-card.contract").filter({ hasText: declinedName }),
    ).toHaveCount(0);
  });

  test("has no tagged WCAG axe violations in populated Contracts", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Contract Market" }).click();
    await page.getByRole("button", { name: "Refresh market" }).click();
    const offers = page.locator("article.work-card.contract:not(.active)");
    await expect(offers).toHaveCount(3);
    await offers.first().getByRole("button", { name: "Accept" }).click();
    await expect(page.locator("article.work-card.contract.active")).toHaveCount(1);

    expect(await wcagViolations(page)).toEqual([]);
  });

  test("starts Scheduler Integration and shows it on the owning system", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Campaign" }).click();
    const project = page
      .locator("article.work-card.project")
      .filter({ hasText: "Scheduler Integration" });

    await expect(project).toContainText("Map queue pressure");
    await project.getByRole("button", { name: "Start next phase" }).click();
    await expect(project).toContainText("Active");
    await expect(project.getByRole("button", { name: "Phase running" })).toBeDisabled();

    const systemWork = page.locator(".system-work-summary").filter({
      hasText: "Scheduler Integration",
    });
    await expect(systemWork).toBeVisible();
    await expect(systemWork).toContainText("Project");
  });

  test("configures, pauses, enables, and clears a CRON standing order", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Automation" }).click();
    const standingOrder = page.locator("article.work-card.standing-order");
    const repeatableJob = standingOrder.getByLabel("Repeatable job");

    await repeatableJob.selectOption({ label: "Tiny Checksum" });
    await standingOrder.getByRole("button", { name: "Configure" }).click();
    // The header badge plus the selects are the single configured readout.
    await expect(standingOrder.getByText("Armed", { exact: true })).toBeVisible();
    await expect(repeatableJob).toHaveValue("tinyChecksum");

    await standingOrder.getByRole("button", { name: "Pause" }).click();
    await expect(standingOrder.getByText("Paused", { exact: true })).toBeVisible();

    await standingOrder.getByRole("button", { name: "Enable" }).click();
    await expect(standingOrder.getByText("Armed", { exact: true })).toBeVisible();

    await standingOrder.getByRole("button", { name: "Clear" }).click();
    await expect(standingOrder.getByText("Not set", { exact: true })).toBeVisible();
    await expect(repeatableJob).toHaveValue("");
    await expect(standingOrder.getByRole("button", { name: "Clear" })).toBeHidden();
  });
});

test("accepts a contract and persists its automatic completion after returning", async ({
  page,
}) => {
  const base = createWorkDeckState();
  const state: GameState = {
    ...base,
    automationBuffer: {
      ownedLevelId: "localScheduler",
      departureLevelId: "localScheduler",
      offlineProcessedMs: 0,
    },
    contracts: {
      ...createContractMarketState(),
      offers: [
        {
          id: "contract-browser-proof",
          templateId: "queueRecovery",
          kind: "burst",
          name: "Browser Recovery Window",
          description: "A short persisted contract used for browser acceptance.",
          systemId: 1,
          workRequiredMs: 20_000,
          workRecipe: {
            stages: [
              { id: "cache", resource: "cache", work: amount("35") },
              { id: "compute", resource: "compute", work: amount("140") },
            ],
          },
          expiresAtMs: 60_000,
          rewards: exactResourceBag("321", "7"),
          novel: true,
        },
      ],
      nextContractId: 2,
      nextRefreshAtMs: 15 * 60_000,
    },
  };
  await installGameSave(page, state, Date.now() + 60_000);
  await page.goto("/");
  await waitForHydration(page);

  await page.getByRole("tab", { name: "Contract Market" }).click();
  const offer = page
    .locator("article.work-card.contract")
    .filter({ hasText: "Browser Recovery Window" });
  await offer.getByRole("button", { name: "Accept" }).click();
  await expect(offer).toHaveClass(/active/);

  const resumed = await resumePersistedGameAfterAbsence(page, 25_000);
  await waitForHydration(resumed);
  const summary = resumed.getByRole("dialog", { name: "Return summary" });
  await expect(summary).toBeVisible();
  await expect(summary.getByLabel(/credits earned/)).toContainText("321");
  await summary.getByRole("button", { name: "Continue" }).click();

  const persisted = await readPersistedGameState(resumed);
  expect(persisted.contracts.active).toHaveLength(0);
  expect(persisted.contracts.completedContractIds).toContain(
    "contract-browser-proof",
  );
  expect(
    persisted.contracts.completedRewards["contract-browser-proof"],
  ).toEqual(exactResourceBag("321", "7"));
});

test("routes a job explicitly to a named Fleet system", async ({ page }) => {
  const state = createRackReadyGameState();
  await installGameSave(page, state, Date.now() + 60_000);
  await page.goto("/");
  await waitForHydration(page);

  const workstation = page.getByRole("group", {
    name: "Fleet-Ready Workstation system",
  });
  const dense = page.getByRole("group", { name: "Dense Compute Node system" });
  await expect(workstation).toBeVisible();
  await expect(dense).toBeVisible();
  await dense
    .getByRole("button", { name: "Select Dense Compute Node scheduler" })
    .click();
  await expect(dense).toHaveAttribute("aria-current", "true");

  // One bay-level route selector covers core, CPU, and System layers.
  const route = page.getByLabel("Task route target");
  await expect(
    route.locator("option", { hasText: "Fleet-Ready Workstation / System" }),
  ).toHaveCount(1);
  await expect(
    route.locator("option", { hasText: "Dense Compute Node / System" }),
  ).toHaveCount(1);
  await route.selectOption({ label: "Dense Compute Node / System" });
  const compile = page.locator("article.task-card").filter({
    has: page.getByText("Compile Code", { exact: true }),
  });
  await compile.locator(".task-run-button").click();

  const persisted = await readPersistedGameState(page);
  const workstationState = persisted.systems.find((system) => system.id === 1)!;
  const denseState = persisted.systems.find((system) => system.id === 2)!;
  const hasCompileWork = (system: (typeof persisted.systems)[number]) =>
    system.activeTasks.some((task) => task.taskId === "compileCode") ||
    system.queue.includes("compileCode") ||
    (system.queueEntries ?? []).some((entry) => entry.taskId === "compileCode");
  expect(persisted.selectedSystemId).toBe(2);
  expect(hasCompileWork(denseState)).toBe(true);
  expect(hasCompileWork(workstationState)).toBe(false);
});
