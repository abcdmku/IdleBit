import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  amountCompare,
  applyAction,
  createInitialGameState,
  exactResourceBag,
  type AutomationBufferLevelId,
  type CampaignChapterId,
  type GameState,
} from "../src/game";
import {
  installGameSave,
  readPersistedGameState,
  resumePersistedGameAfterAbsence,
} from "./save-fixture";

test.setTimeout(90_000);

const readyState = (
  chapterId: CampaignChapterId,
  bufferLevelId: AutomationBufferLevelId,
): GameState => {
  const initial = createInitialGameState();
  return {
    ...initial,
    exactResources: exactResourceBag("1e15", "1e15"),
    resources: { credits: 1e15, data: 1e15 },
    campaign: {
      ...initial.campaign,
      currentChapterId: chapterId,
      currentObjectiveId:
        chapterId === "localFabric"
          ? "fabric:cluster-controller"
          : "facility:rack-controller",
    },
    automationBuffer: {
      ownedLevelId: bufferLevelId,
      departureLevelId: bufferLevelId,
      offlineProcessedMs: 0,
    },
    flags: { ...initial.flags, systemCatalog: true },
    research: {
      ...initial.research,
      completed: [...initial.research.completed, "systemCatalog" as const],
    },
    lastAdvanceReport: null,
  } satisfies GameState;
};

const waitForHydration = async (page: Page) => {
  await expect(page.getByText("IdleBit", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("main", { name: "IdleBit system workbench" }),
  ).not.toHaveAttribute("aria-busy", "true");
};

const openInfrastructure = async (page: Page, state: GameState) => {
  await installGameSave(page, state, Date.now() + 60_000);
  await page.goto("/");
  await waitForHydration(page);
  if ((page.viewportSize()?.width ?? 1_920) <= 760) {
    await page.getByRole("button", { name: /^HW/ }).click();
  }
  await page.getByRole("button", { name: "Infrastructure", exact: true }).click();
  await expect(page.getByRole("region", { name: "Infrastructure" })).toBeVisible();
};

test("commissions a cluster and completes distributed work through visible controls", async ({
  page,
}) => {
  let state = readyState("localFabric", "clusterController");
  for (let index = 0; index < 2; index += 1) {
    state = applyAction(state, {
      type: "purchaseAggregateServerBatch",
      skuId: "workshopServer",
      count: 1,
      storageSkuId: "localSsd",
      networkSkuId: "gigabitNic",
    });
  }
  await openInfrastructure(page, state);

  const builder = page.locator(".cluster-builder");
  const nodes = builder.locator('input[type="checkbox"]');
  await expect(nodes).toHaveCount(2);
  await nodes.nth(0).check();
  await nodes.nth(1).check();
  await builder.getByRole("button", { name: "Commission cluster" }).click();

  const cluster = page.locator("article.cluster-card").filter({
    hasText: "Local Fabric",
  });
  await expect(cluster).toBeVisible();
  await cluster
    .getByRole("button", { name: /Replicated Shard Commit/ })
    .click();
  await expect(cluster.locator(".cluster-workload")).toContainText(
    "Replicated Shard Commit",
  );

  const resumed = await resumePersistedGameAfterAbsence(page, 60_000);
  await waitForHydration(resumed);
  const summary = resumed.getByRole("dialog", { name: "Return summary" });
  await expect(summary).toContainText("Completed infrastructure work");
  await expect(summary).toContainText("Replicated Shard Commit");
  await summary.getByRole("button", { name: "Continue" }).click();
  await resumed
    .getByRole("button", { name: "Infrastructure", exact: true })
    .click();
  const completed = resumed
    .locator(".cluster-workload")
    .filter({ hasText: "Replicated Shard Commit" });
  await expect(completed).toContainText("completed");
  await expect(completed.getByRole("button", { name: "Cancel" })).toBeDisabled();
});

test("runs and bills completed distributed work inside a commissioned data center", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  let state = readyState("rackAndFacility", "dataCenterNoc");
  for (let index = 0; index < 2; index += 1) {
    state = applyAction(state, {
      type: "purchaseAggregateServerBatch",
      skuId: "workshopServer",
      count: 1,
      storageSkuId: "localSsd",
      networkSkuId: "gigabitNic",
    });
  }
  await openInfrastructure(page, state);

  await page.getByRole("button", { name: /Edge Data Center/ }).click();
  const facility = page.locator("article.facility-card").filter({
    hasText: "Edge Data Center",
  });
  await expect(facility).toBeVisible();
  await facility.getByRole("button", { name: /Standard 42U Rack/ }).click();
  const rack = facility.locator(".true-rack-card");
  await expect(rack).toBeVisible();
  await rack.getByLabel("Place managed node").selectOption({ index: 1 });
  await rack.getByLabel("Place managed node").selectOption({ index: 1 });
  await expect(rack.locator(".rack-node-list > div")).toHaveCount(2);

  const builder = page.locator(".cluster-builder");
  const nodes = builder.locator('input[type="checkbox"]');
  await expect(nodes).toHaveCount(2);
  await nodes.nth(0).check();
  await nodes.nth(1).check();
  await builder.getByLabel("Cluster name").fill("Edge Completion Fabric");
  await builder.getByRole("button", { name: "Commission cluster" }).click();
  const cluster = page.locator("article.cluster-card").filter({
    hasText: "Edge Completion Fabric",
  });
  await cluster
    .getByRole("button", { name: /Replicated Shard Commit/ })
    .click();
  await expect(cluster.locator(".cluster-workload")).toContainText(
    "Replicated Shard Commit",
  );

  const resumed = await resumePersistedGameAfterAbsence(page, 60_000);
  await waitForHydration(resumed);
  const summary = resumed.getByRole("dialog", { name: "Return summary" });
  await expect(summary).toContainText("Replicated Shard Commit");
  await summary.getByRole("button", { name: "Continue" }).click();
  const persisted = await readPersistedGameState(resumed);
  const workload = (persisted.infrastructure.workloads ?? []).find(
    (candidate) => candidate.definitionId === "replicatedShardCommit",
  );
  expect(workload).toBeDefined();
  expect(amountCompare(workload!.operatingCreditsSpent, 0)).toBeGreaterThan(0);
  expect(workload!.runtime.rewardIssued).toBe(true);

  const dimensions = await resumed.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);

  const results = await new AxeBuilder({ page: resumed })
    .withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22a",
      "wcag22aa",
    ])
    .analyze();
  expect(results.violations).toEqual([]);
});
