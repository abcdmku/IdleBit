import { describe, expect, it } from "vitest";
import { amount, amountSubtract, exactResourceBag } from "./amount";
import { withExactResources } from "./economy";
import { normalizeFacilityInfrastructureForGameState } from "./facilityInfrastructure";
import { createInitialGameState } from "./progression";
import { deriveVisibleState } from "./selectors";
import { applyAction } from "./simulation";
import type { GameState } from "./types";

const rackChapterReady = (): GameState => {
  const initial = createInitialGameState();
  return normalizeFacilityInfrastructureForGameState(
    withExactResources(
      {
        ...initial,
        campaign: {
          ...initial.campaign,
          currentChapterId: "rackAndFacility",
          currentObjectiveId: "facility:rack-controller",
        },
        automationBuffer: {
          ...initial.automationBuffer,
          ownedLevelId: "rackController",
          departureLevelId: "rackController",
        },
        infrastructure: {
          ...initial.infrastructure,
          fleetNodes: initial.infrastructure.fleetNodes.map((node) => ({
            ...node,
            managed: true,
          })),
        },
      },
      exactResourceBag("1000000000000", "1000000000000"),
    ),
  );
};

describe("Facility vertical integration", () => {
  it("routes public actions atomically and completes the true-rack objective", () => {
    let state = rackChapterReady();
    const startingResources = state.exactResources;
    state = applyAction(state, {
      type: "commissionFacility",
      templateId: "workshopFacility",
      name: "Prairie Room",
    });
    const facilityId = state.infrastructure.facilities[0]!.id;
    state = applyAction(state, {
      type: "commissionFacilityRack",
      facilityId,
      templateId: "halfRack",
      name: "Compute A",
    });
    const rackId = state.infrastructure.facilities[0]!.racks[0]!.id;
    state = applyAction(state, {
      type: "placeFleetNodeInRack",
      facilityId,
      rackId,
      nodeId: "fleet-node-1",
    });

    expect(state.infrastructure.fleetNodes[0]?.rackId).toBe(
      `${facilityId}/${rackId}`,
    );
    expect(
      state.infrastructure.facilities[0]?.racks[0]?.placements[0]?.equipment
        .capacity.compute,
    ).toBe("1");
    expect(state.campaign.completedObjectiveIds).toContain(
      "facility:rack-controller",
    );
    expect(state.exactResources).toEqual({
      credits: amountSubtract(startingResources.credits, "600000"),
      data: startingResources.data,
    });

    const visible = deriveVisibleState(state).infrastructure.facilities[0]!;
    expect(visible.name).toBe("Prairie Room");
    expect(visible.racks[0]?.nodeIds).toEqual(["fleet-node-1"]);
    expect(visible.capacity.compute).toBe("1");
    expect(visible.operatingCost.totalPerSecond).toBe(
      amount("0.260000000000004"),
    );
  });

  it("keeps pre-chapter facility actions unreachable", () => {
    const before = createInitialGameState();
    const after = applyAction(before, {
      type: "commissionFacility",
      templateId: "workshopFacility",
    });
    expect(after.infrastructure.facilities).toEqual([]);
  });

  it("removes both sides of the public node placement", () => {
    let state = rackChapterReady();
    state = applyAction(state, {
      type: "commissionFacility",
      templateId: "workshopFacility",
    });
    const facilityId = state.infrastructure.facilities[0]!.id;
    state = applyAction(state, {
      type: "commissionFacilityRack",
      facilityId,
      templateId: "halfRack",
    });
    const rackId = state.infrastructure.facilities[0]!.racks[0]!.id;
    state = applyAction(state, {
      type: "placeFleetNodeInRack",
      facilityId,
      rackId,
      nodeId: "fleet-node-1",
    });
    state = applyAction(state, {
      type: "removeFleetNodeFromRack",
      nodeId: "fleet-node-1",
    });

    expect(state.infrastructure.fleetNodes[0]?.rackId).toBeNull();
    expect(
      state.infrastructure.facilities[0]?.racks[0]?.placements,
    ).toEqual([]);
  });
});
