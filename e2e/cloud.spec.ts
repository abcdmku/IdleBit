import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  amount,
  amountAdd,
  applyAction,
  createInitialGameState,
  exactResourceBag,
  type AutomationBufferLevelId,
  type CampaignChapterId,
  type GameState,
} from "../src/game";
import {
  installGameSave,
  resumePersistedGameAfterAbsence,
} from "./save-fixture";

test.setTimeout(120_000);

const HOUR_MS = 60 * 60_000;

const cloudSeed = (
  chapterId: CampaignChapterId,
  bufferLevelId: AutomationBufferLevelId,
  facilityCount: number,
  serversPerFacility = 6,
) => {
  const initial = createInitialGameState();
  let state: GameState = {
    ...initial,
    exactResources: exactResourceBag("1e30", "1e30"),
    resources: { credits: 1e30, data: 1e30 },
    campaign: {
      ...initial.campaign,
      currentChapterId: chapterId,
      currentObjectiveId:
        chapterId === "planetaryCommons"
          ? "planetary:global-scheduler"
          : "cloud:data-center-noc",
    },
    automationBuffer: {
      ownedLevelId: bufferLevelId,
      departureLevelId: bufferLevelId,
      offlineProcessedMs: 0,
    },
    flags: { ...initial.flags, systemCatalog: true },
    research: {
      ...initial.research,
      completed: Array.from(
        new Set([...initial.research.completed, "systemCatalog" as const]),
      ),
    },
    lastAdvanceReport: null,
  };

  for (let index = 0; index < facilityCount; index += 1) {
    state = applyAction(state, {
      type: "purchaseAggregateServerBatch",
      skuId: "denseServer",
      count: serversPerFacility,
      storageSkuId: "nvmeArray",
      networkSkuId: "fabricNic",
    });
  }
  const nodeIds = state.infrastructure.fleetNodes
    .filter((node) => node.managed)
    .map((node) => node.id);

  for (let index = 0; index < facilityCount; index += 1) {
    state = applyAction(state, {
      type: "commissionFacility",
      templateId: "workshopFacility",
      name: `Cloud Facility ${index + 1}`,
    });
    const facility = state.infrastructure.facilities[index]!;
    state = applyAction(state, {
      type: "commissionFacilityRack",
      facilityId: facility.id,
      templateId:
        serversPerFacility > 24 ? "highDensityRack" : "halfRack",
      name: `Cloud Rack ${index + 1}`,
    });
    state = applyAction(state, {
      type: "placeFleetNodeInRack",
      facilityId: facility.id,
      rackId: state.infrastructure.facilities[index]!.racks[0]!.id,
      nodeId: nodeIds[index]!,
    });
  }
  return state;
};

const waitForHydration = async (page: Page) => {
  await expect(page.getByText("IdleBit", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("main", { name: "IdleBit system workbench" }),
  ).not.toHaveAttribute("aria-busy", "true", { timeout: 60_000 });
};

const configureCloudService = (
  input: GameState,
  regionCount: number,
  explicitFlow = false,
  demandPerRegion = "1000000000000",
) => {
  let state = input;
  for (let index = 0; index < regionCount; index += 1) {
    const facility = state.infrastructure.facilities[index]!;
    state = applyAction(state, {
      type: "commissionCloudRegion",
      name: `Region ${index + 1}`,
    });
    const region = state.cloud.regions[index]!;
    state = applyAction(state, {
      type: "commissionCloudZone",
      regionId: region.id,
      facilityId: facility.id,
      name: `Zone ${index + 1}`,
      faultDomainId: `grid-${index + 1}`,
      baseLatencyMs: 25,
    });
    state = applyAction(state, {
      type: "placeCloudReplica",
      zoneId: state.cloud.zones[index]!.id,
    });
    state = applyAction(state, {
      type: "setCloudRegionalDemand",
      regionId: region.id,
      demand: amount(explicitFlow && index > 0 ? "1" : demandPerRegion),
    });
  }
  if (explicitFlow && state.cloud.regions.length > 1) {
    const hubId = state.cloud.regions[0]!.id;
    const remoteRegions = state.cloud.regions.slice(1);
    const hubCapacity = state.cloud.zones
      .filter((zone) => zone.regionId === hubId)
      .reduce(
        (total, zone) => amountAdd(total, zone.capacityPerSecond),
        amount(0),
      );
    const boundedOverload = remoteRegions.reduce(
      (total) => amountAdd(total, "400000000000"),
      amount(0),
    );
    state = applyAction(state, {
      type: "setCloudRegionalDemand",
      regionId: hubId,
      demand: amountAdd(hubCapacity, boundedOverload),
    });
    state = applyAction(state, {
      type: "setCloudRoutingLinks",
      links: remoteRegions.map((region, index) => ({
        id: `e2e-route-${index + 1}`,
        from: region.id,
        to: hubId,
        capacity: amount("500000000000"),
        costPerUnit: 0,
        latencyMs: 25,
      })),
    });
  }
  return state;
};

const openCloud = async (page: Page, state: GameState) => {
  await installGameSave(page, state, Date.now() + 60_000);
  await page.goto("/");
  await waitForHydration(page);
  if ((page.viewportSize()?.width ?? 1_920) <= 760) {
    await page.getByRole("button", { name: /^HW/ }).click();
  }
  await page.getByRole("button", { name: "Cloud", exact: true }).click();
  await expect(page.getByRole("region", { name: "Resilient Cloud" })).toBeVisible();
};

test("builds zones, replicas, demand, failover, and starts an SLA through public controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openCloud(page, cloudSeed("resilientCloud", "dataCenterNoc", 2));

  const regionName = page.getByLabel("Region name");
  await regionName.fill("Prairie");
  await page.getByRole("button", { name: "Commission region" }).click();
  await regionName.fill("Coast");
  await page.getByRole("button", { name: "Commission region" }).click();
  await expect(page.locator(".cloud-region-grid article")).toHaveCount(2);

  const zoneBuilder = page.locator(".cloud-zone-builder");
  await zoneBuilder.getByLabel("Zone name").fill("Prairie A");
  await zoneBuilder.getByRole("button", { name: "Commission zone" }).click();
  await zoneBuilder.getByLabel("Region").selectOption({ label: "Coast" });
  await zoneBuilder.getByLabel("Zone name").fill("Coast A");
  await zoneBuilder.getByLabel("Fault domain").fill("grid-b");
  await zoneBuilder.getByRole("button", { name: "Commission zone" }).click();

  const zoneCards = page.locator(".cloud-zone-card");
  await expect(zoneCards).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    await zoneCards.nth(index).getByRole("button", { name: "Place replica" }).click();
  }

  for (const region of ["Prairie", "Coast"]) {
    const card = page.locator(".cloud-region-grid article").filter({ hasText: region });
    await card.getByLabel(`${region} demand`).fill("1000000000");
    await card.getByRole("button", { name: "Apply demand" }).click();
  }

  const routingEditor = page.locator(".cloud-routing-editor");
  await routingEditor.getByLabel("Capacity").fill("2500000000");
  await routingEditor.getByLabel("Latency (ms)").fill("42");
  await routingEditor.getByRole("button", { name: "Add/update route" }).click();
  await expect(routingEditor.locator(".cloud-route-row")).toHaveCount(1);
  await expect(routingEditor.locator(".cloud-route-row")).toContainText("42 ms");

  const startSla = page.getByTitle("Start Regional Continuity Window");
  await expect(startSla).toBeEnabled();
  await startSla.click();
  await expect(page.locator(".cloud-active-sla")).toContainText(
    "Regional Continuity Window",
  );

  await page.getByLabel("Delay (ms)").fill("1000");
  const activeZoneBefore = page.locator(".cloud-zone-card.active");
  await expect(activeZoneBefore).toHaveCount(1);
  const activeZoneName = (await activeZoneBefore.locator("header strong").innerText()).trim();
  await page.getByRole("button", { name: "Request failover" }).click();
  await expect(page.getByRole("button", { name: "Failover pending" })).toBeDisabled();
  const pendingZone = page.locator(".cloud-zone-card").filter({
    has: page.getByText("Pending", { exact: true }),
  });
  await expect(pendingZone).toHaveCount(1);
  const pendingZoneName = (await pendingZone.locator("header strong").innerText()).trim();
  expect(pendingZoneName).not.toBe(activeZoneName);

  const resumed = await resumePersistedGameAfterAbsence(page, 1_001);
  await resumed.setViewportSize({ width: 320, height: 800 });
  await waitForHydration(resumed);
  const summary = resumed.getByRole("dialog", { name: "Return summary" });
  await expect(summary).toBeVisible();
  await summary.getByRole("button", { name: "Continue" }).click();
  await resumed.getByRole("button", { name: /^HW/ }).click();
  await resumed.getByRole("button", { name: "Cloud", exact: true }).click();

  const completedZone = resumed.locator(".cloud-zone-card").filter({
    has: resumed.getByText(pendingZoneName, { exact: true }),
  });
  await expect(completedZone).toHaveClass(/active/);
  await expect(completedZone.getByText("Active", { exact: true })).toBeVisible();
  const previousZone = resumed.locator(".cloud-zone-card").filter({
    has: resumed.getByText(activeZoneName, { exact: true }),
  });
  await expect(previousZone).not.toHaveClass(/active/);
  await expect(
    resumed.getByRole("button", { name: "Request failover" }),
  ).toBeEnabled();
  await resumed.getByRole("button", { name: "Draw opt-in incident" }).click();

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

test("completes an SLA and the planetary finale before swapping postgame charters", async ({
  page,
}) => {
  const ready = configureCloudService(
    cloudSeed("planetaryCommons", "globalScheduler", 4, 48),
    4,
    true,
  );
  await openCloud(page, ready);

  const startSla = page.getByTitle("Start Regional Continuity Window");
  await expect(startSla).toBeEnabled();
  await startSla.click();
  await expect(page.locator(".cloud-active-sla")).toContainText(
    "Regional Continuity Window",
  );

  let resumed = await resumePersistedGameAfterAbsence(page, 4 * HOUR_MS + 1_000);
  await waitForHydration(resumed);
  let summary = resumed.getByRole("dialog", { name: "Return summary" });
  await expect(summary).toContainText("Completed Cloud SLA windows");
  await expect(summary).toContainText("Regional Continuity Window");
  await summary.getByRole("button", { name: "Continue" }).click();
  await resumed.getByRole("button", { name: "Cloud", exact: true }).click();

  const startPlanetarySla = resumed.getByTitle(
    "Start Planetary Coverage Window",
  );
  await expect(startPlanetarySla).toBeEnabled();
  await startPlanetarySla.click();
  await expect(resumed.locator(".cloud-active-sla")).toContainText(
    "Planetary Coverage Window",
  );

  resumed = await resumePersistedGameAfterAbsence(
    resumed,
    24 * HOUR_MS + 1_000,
  );
  await waitForHydration(resumed);
  summary = resumed.getByRole("dialog", { name: "Return summary" });
  await expect(summary).toContainText("Planetary Coverage Window");
  await summary.getByRole("button", { name: "Continue" }).click();
  await resumed.getByRole("button", { name: "Cloud", exact: true }).click();

  const startFinale = resumed.getByRole("button", { name: "Start finale" });
  await expect(startFinale).toBeEnabled();
  await startFinale.click();
  await expect(resumed.locator(".planetary-progress")).toContainText(
    "Regional bootstrap",
  );

  resumed = await resumePersistedGameAfterAbsence(resumed, 9 * HOUR_MS);
  await waitForHydration(resumed);
  summary = resumed.getByRole("dialog", { name: "Return summary" });
  await expect(summary).toBeVisible();
  await summary.getByRole("button", { name: "Continue" }).click();
  await resumed.getByRole("button", { name: "Cloud", exact: true }).click();
  await expect(resumed.getByRole("region", { name: "Resilient Cloud" })).toBeVisible();
  await expect(resumed.locator(".planetary-progress")).toContainText(
    "Commons online",
  );

  const efficiency = resumed.getByRole("button", {
    name: /Efficiency Lower operating cost/,
  });
  await expect(efficiency).toBeEnabled();
  await efficiency.click();
  await expect(efficiency).toHaveAttribute("aria-pressed", "true");
  const resilience = resumed.getByRole("button", {
    name: /Resilience Faster failover/,
  });
  await expect(resilience).toBeEnabled();
  await resilience.click();
  await expect(resilience).toHaveAttribute("aria-pressed", "true");
  await expect(efficiency).toHaveAttribute("aria-pressed", "false");
});
