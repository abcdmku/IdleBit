import { describe, expect, it } from "vitest";
import { getCampaignChapterIndex } from "./campaign";
import {
  DEV_SEED_IDS,
  createCloudReadyGameState,
  createDevSeedGameState,
  createPlanetaryReadyGameState,
  createRackReadyGameState,
  createWorkshopReadyGameState,
} from "./devSeeds";
import { deserializeSave, serializeSave } from "./save";
import { deriveVisibleState } from "./selectors";
import {
  isWorkshopThermalControlsUnlocked,
  isWorkshopThermalVisible,
} from "./workshop";

describe("dev seed registry", () => {
  it("maps every canonical seed id to a constructor", () => {
    expect(DEV_SEED_IDS).toEqual([
      "rack-ready",
      "workshop-ready",
      "cloud-ready",
      "planetary-ready",
    ]);
    expect(createDevSeedGameState("rack-ready").campaign.currentChapterId).toBe(
      createRackReadyGameState().campaign.currentChapterId,
    );
    expect(
      createDevSeedGameState("planetary-ready").campaign.currentChapterId,
    ).toBe("planetaryCommons");
  });
});

describe("workshop-ready seed", () => {
  it("unlocks thermal controls with cooling purchasable and keeps the specialized-throughput objective open", () => {
    const state = createWorkshopReadyGameState();

    expect(isWorkshopThermalVisible(state)).toBe(true);
    expect(isWorkshopThermalControlsUnlocked(state)).toBe(true);
    expect(state.campaign.currentChapterId).toBe("workshopFleet");
    expect(state.campaign.currentObjectiveId).toBe(
      "fleet:specialized-throughput",
    );

    const visible = deriveVisibleState(state);
    expect(visible.workshop.thermalVisible).toBe(true);
    expect(visible.workshop.thermalControlsUnlocked).toBe(true);
    expect(visible.workshop.specializedComputeUnlocked).toBe(true);
    expect(
      visible.workshop.coolingTiers.some(
        (tier) => !tier.installed && tier.canInstall,
      ),
    ).toBe(true);
  });
});

describe("cloud-ready seed", () => {
  it("reaches Resilient Cloud with owned facilities, a placed rack node, and a commissioned cluster", () => {
    const state = createCloudReadyGameState();

    expect(state.campaign.currentChapterId).toBe("resilientCloud");
    expect(state.campaign.currentObjectiveId).toBe("cloud:availability");
    expect(state.automationBuffer.ownedLevelId).toBe("dataCenterNoc");
    expect(
      state.infrastructure.facilities.some((facility) =>
        facility.racks.some((rack) => rack.placements.length > 0),
      ),
    ).toBe(true);
    expect(
      state.infrastructure.clusters.some(
        (cluster) => cluster.nodeIds.length > 0,
      ),
    ).toBe(true);
    expect((state.infrastructure.successfulShardCommits ?? 0) > 0).toBe(true);

    // The Infrastructure view unlocks at chapter index 4 and the Cloud view
    // at index 6; both must be reachable from this seed.
    const visible = deriveVisibleState(state);
    expect(visible.currentChapter.index).toBe(6);
    expect(getCampaignChapterIndex(state.campaign.currentChapterId)).toBe(6);
  });
});

describe("planetary-ready seed", () => {
  it("reaches Planetary Commons with the Global Scheduler owned and a successful SLA on record", () => {
    const state = createPlanetaryReadyGameState();

    expect(state.campaign.currentChapterId).toBe("planetaryCommons");
    expect(state.campaign.currentObjectiveId).toBe("planetary:finale");
    expect(state.automationBuffer.ownedLevelId).toBe("globalScheduler");
    expect(state.cloud.completedSlas.some((sla) => sla.succeeded)).toBe(true);
    expect(deriveVisibleState(state).currentChapter.index).toBe(7);
  });
});

describe("dev seed persistence", () => {
  it.each([
    ["workshop-ready", createWorkshopReadyGameState],
    ["cloud-ready", createCloudReadyGameState],
    ["planetary-ready", createPlanetaryReadyGameState],
  ] as const)("round-trips the %s seed through save v7", (_seedId, create) => {
    const state = create();
    const restored = deserializeSave(serializeSave(state, 123_456));

    expect(restored.version).toBe(7);
    expect(restored.campaign).toEqual(state.campaign);
    expect(restored.automationBuffer.ownedLevelId).toBe(
      state.automationBuffer.ownedLevelId,
    );
    expect(restored.research.completed).toEqual(
      expect.arrayContaining(state.research.completed),
    );
    expect(restored.standingOrder).toEqual(state.standingOrder);
    expect(restored.infrastructure.facilities).toEqual(
      state.infrastructure.facilities,
    );
    expect(restored.infrastructure.clusters).toEqual(
      state.infrastructure.clusters,
    );
    expect(restored.infrastructure.successfulShardCommits).toBe(
      state.infrastructure.successfulShardCommits,
    );
    expect(restored.cloud.completedSlas).toEqual(state.cloud.completedSlas);
    expect(restored.systems.map((system) => system.workshop.evidence)).toEqual(
      state.systems.map((system) => system.workshop.evidence),
    );
  });
});
