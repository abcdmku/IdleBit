import { describe, expect, it } from "vitest";
import {
  amount,
  exactResourceBag,
} from "./amount";
import { createCapacityWorkRuntime } from "./capacityWork";
import { getFleetNodeCapacityProfile } from "./capacity";
import { getClusterWorkloadDefinition } from "./distributedDefinitions";
import { withExactResources } from "./economy";
import {
  facilityTemplateDefinitions,
  rackTemplateDefinitions,
} from "./facilityDefinitions";
import {
  commissionFacilityForGameState,
  commissionFacilityRackForGameState,
  deriveFacilityCloudEffectiveCompute,
  getFleetNodeActiveWorkloadBlocker,
  normalizeFacilityInfrastructureForGameState,
  parseQualifiedRackRef,
  placeFleetNodeInFacilityRack,
  qualifyFacilityRackRef,
  removeFleetNodeFromFacilityRack,
  type FacilityInfrastructureGameState,
} from "./facilityInfrastructure";
import {
  commissionRack,
  createFacilityResourceVector,
  createFacilityState,
  createRackEquipmentCapacity,
  getFacilitySnapshot,
  placeEquipmentDeterministically,
} from "./facilities";
import { createPlacementVector } from "./placement";
import { createInitialGameState } from "./progression";
import { deserializeSave, serializeSave } from "./save";
import { applyAction } from "./simulation";
import type { GameState } from "./types";

const facilityReady = (
  credits = "1000000000000",
  data = "1000000000000",
): GameState => {
  const initial = createInitialGameState();
  return withExactResources(
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
      flags: { ...initial.flags, systemCatalog: true },
      research: {
        ...initial.research,
        completed: Array.from(
          new Set([...initial.research.completed, "systemCatalog" as const]),
        ),
      },
      infrastructure: {
        ...initial.infrastructure,
        fleetNodes: initial.infrastructure.fleetNodes.map((node) => ({
          ...node,
          managed: true,
        })),
      },
    },
    exactResourceBag(credits, data),
  );
};

const withPlacedNode = () => {
  const commissioned = commissionFacilityForGameState(
    facilityReady(),
    "workshopFacility",
    "Prairie Room",
  );
  const racked = commissionFacilityRackForGameState(
    commissioned.state,
    commissioned.facilityId!,
    "halfRack",
  );
  return placeFleetNodeInFacilityRack(
    racked.state,
    commissioned.facilityId!,
    racked.rackId!,
    "fleet-node-1",
  );
};

const withRackedAggregate = (count: number) => {
  let state = applyAction(facilityReady(), {
    type: "purchaseAggregateServerBatch",
    skuId: "workshopServer",
    count,
    storageSkuId: "storageNone",
    networkSkuId: "networkNone",
  });
  const node = state.infrastructure.fleetNodes.find(
    (candidate) => candidate.source.kind === "aggregate",
  );
  if (!node) throw new Error("Expected aggregate Fleet node");
  const commissioned = commissionFacilityForGameState(
    state,
    "workshopFacility",
    "Aggregate Room",
  );
  const racked = commissionFacilityRackForGameState(
    commissioned.state,
    commissioned.facilityId!,
    "halfRack",
  );
  const placed = placeFleetNodeInFacilityRack(
    racked.state,
    commissioned.facilityId!,
    racked.rackId!,
    node.id,
  );
  state = placed.state;
  return { state, nodeId: node.id, commissioned, racked, placed };
};

describe("Facility and Fleet adapter", () => {
  it("defines exact Credit-led capital prices without repeat Data costs", () => {
    expect(
      facilityTemplateDefinitions.map((definition) => [
        definition.id,
        definition.commissionCosts,
      ]),
    ).toEqual([
      ["workshopFacility", [{ resource: "credits", amount: "500000" }]],
      ["edgeFacility", [{ resource: "credits", amount: "50000000" }]],
      ["regionalFacility", [{ resource: "credits", amount: "500000000" }]],
    ]);
    expect(
      rackTemplateDefinitions.map((definition) => [
        definition.id,
        definition.commissionCosts,
      ]),
    ).toEqual([
      ["halfRack", [{ resource: "credits", amount: "100000" }]],
      ["standardRack", [{ resource: "credits", amount: "2500000" }]],
      ["highDensityRack", [{ resource: "credits", amount: "12000000" }]],
    ]);
  });

  it("gates commission until Rack and Facility plus Rack Controller", () => {
    const blocked = commissionFacilityForGameState(
      createInitialGameState(),
      "workshopFacility",
    );
    expect(blocked.accepted).toBe(false);
    expect(blocked.blockers).toEqual(["Requires Rack and Facility."]);

    const accepted = commissionFacilityForGameState(
      facilityReady(),
      "workshopFacility",
    );
    expect(accepted.accepted).toBe(true);
    expect(accepted.facilityId).toMatch(/^facility-\d+$/);
    expect(accepted.state.infrastructure.facilities).toHaveLength(1);
  });

  it("spends exact facility and rack capital costs only on acceptance", () => {
    const starting = facilityReady("10000000", "123");
    const commissioned = commissionFacilityForGameState(
      starting,
      "workshopFacility",
    );
    expect(commissioned.accepted).toBe(true);
    expect(commissioned.state.exactResources).toEqual(
      exactResourceBag("9500000", "123"),
    );

    const racked = commissionFacilityRackForGameState(
      commissioned.state,
      commissioned.facilityId!,
      "halfRack",
    );
    expect(racked.accepted).toBe(true);
    expect(racked.state.exactResources).toEqual(
      exactResourceBag("9400000", "123"),
    );

    const poorFacilityState = facilityReady("499999", "999999999");
    const poorFacility = commissionFacilityForGameState(
      poorFacilityState,
      "workshopFacility",
    );
    expect(poorFacility.accepted).toBe(false);
    expect(poorFacility.blockers).toEqual([
      "Insufficient resources to commission Workshop Server Room.",
    ]);
    expect(poorFacility.state.exactResources).toEqual(
      poorFacilityState.exactResources,
    );
    expect(poorFacility.state.infrastructure.facilities).toEqual([]);

    const facilityOnly = commissionFacilityForGameState(
      facilityReady("599999", "777"),
      "workshopFacility",
    );
    const beforeRack = facilityOnly.state;
    const poorRack = commissionFacilityRackForGameState(
      beforeRack,
      facilityOnly.facilityId!,
      "halfRack",
    );
    expect(poorRack.accepted).toBe(false);
    expect(poorRack.blockers).toEqual([
      "Insufficient resources to commission Workshop Half Rack.",
    ]);
    expect(poorRack.state.exactResources).toEqual(beforeRack.exactResources);
    expect(poorRack.state.infrastructure.facilities[0]?.racks).toEqual([]);
  });

  it("atomically places exact capacity-derived Fleet equipment with a qualified rack ref", () => {
    const placed = withPlacedNode();
    expect(placed.accepted).toBe(true);
    const facility = placed.state.infrastructure.facilities[0]!;
    const placement = facility.racks[0]!.placements[0]!;
    const node = placed.state.infrastructure.fleetNodes[0]!;
    const expected = getFleetNodeCapacityProfile(placed.state, node);

    expect(placement.equipment.id).toBe(node.id);
    expect(placement.equipment.capacity.compute).toBe(expected.rates.compute);
    expect(placement.equipment.demand.powerWatts).toBe(expected.peakWatts);
    expect(node.rackId).toBe(
      qualifyFacilityRackRef(facility.id, facility.racks[0]!.id),
    );
    expect(parseQualifiedRackRef(node.rackId)).toEqual({
      facilityId: facility.id,
      rackId: facility.racks[0]!.id,
    });

    const duplicate = placeFleetNodeInFacilityRack(
      placed.state,
      facility.id,
      facility.racks[0]!.id,
      node.id,
    );
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.state).toEqual(placed.state);
  });

  it("removes both placement and qualified Fleet reference atomically", () => {
    const placed = withPlacedNode();
    const removed = removeFleetNodeFromFacilityRack(
      placed.state,
      "fleet-node-1",
    );
    expect(removed.accepted).toBe(true);
    expect(removed.state.infrastructure.fleetNodes[0]?.rackId).toBeNull();
    expect(
      removed.state.infrastructure.facilities[0]?.racks[0]?.placements,
    ).toEqual([]);
  });

  it("guards placed nodes while an active workload references them", () => {
    const placed = withPlacedNode();
    const definition = getClusterWorkloadDefinition("fabricIntegritySweep");
    if (definition.kind !== "capacity") throw new Error("Expected capacity work");
    const active: FacilityInfrastructureGameState = {
      ...placed.state,
      infrastructure: {
        ...placed.state.infrastructure,
        clusters: [
          {
            id: "cluster-90",
            name: "Active",
            nodeIds: ["fleet-node-1"],
            policy: {
              defaultWeight: 1,
              reserveHeadroomBps: 0,
              replicaFaultDomain: "node",
            },
          },
        ],
        workloads: [
          {
            id: "workload-91",
            definitionId: "fabricIntegritySweep",
            clusterId: "cluster-90",
            kind: "capacity",
            weight: 1,
            source: "manual",
            placements: [
              {
                requestId: "integrity-sweep",
                nodeId: "fleet-node-1",
                faultDomainId: "node:fleet-node-1",
                demand: createPlacementVector(),
              },
            ],
            runtime: createCapacityWorkRuntime(definition.plan),
            operatingCreditsSpent: amount(0),
            blockers: [],
          },
        ],
      },
    };
    expect(getFleetNodeActiveWorkloadBlocker(active, "fleet-node-1")).toContain(
      "active distributed work",
    );
    const removed = removeFleetNodeFromFacilityRack(active, "fleet-node-1");
    expect(removed.accepted).toBe(false);
    expect(removed.state.infrastructure.fleetNodes[0]?.rackId).not.toBeNull();
  });

  it("reconciles corrupt rack references and never trusts saved equipment capacity", () => {
    const placed = withPlacedNode();
    const corrupted: GameState = {
      ...placed.state,
      infrastructure: {
        ...placed.state.infrastructure,
        fleetNodes: placed.state.infrastructure.fleetNodes.map((node) => ({
          ...node,
          rackId: "facility-999/rack-999",
        })),
        facilities: placed.state.infrastructure.facilities.map((facility) => ({
          ...facility,
          racks: facility.racks.map((rack) => ({
            ...rack,
            placements: rack.placements.map((placement) => ({
              ...placement,
              equipment: {
                ...placement.equipment,
                capacity: {
                  ...placement.equipment.capacity,
                  compute: amount("1e309"),
                },
              },
            })),
          })),
        })),
      },
    };
    const first = normalizeFacilityInfrastructureForGameState(corrupted);
    const replay = normalizeFacilityInfrastructureForGameState(corrupted);
    const restored = deserializeSave(serializeSave(corrupted, 123_000));
    const facility = first.infrastructure.facilities[0]!;
    const rack = facility.racks[0]!;

    expect(first).toEqual(replay);
    expect(first.infrastructure.fleetNodes[0]?.rackId).toBe(
      qualifyFacilityRackRef(facility.id, rack.id),
    );
    expect(rack.placements[0]?.equipment.capacity.compute).toBe("1");
    expect(
      restored.infrastructure.facilities[0]?.racks[0]?.placements[0]?.equipment
        .capacity.compute,
    ).toBe("1");
    expect(restored.infrastructure.fleetNodes[0]?.rackId).toBe(
      qualifyFacilityRackRef(facility.id, rack.id),
    );
  });

  it("charges aggregate Fleet batches one rack unit per physical server", () => {
    const fitting = withRackedAggregate(24);
    expect(fitting.placed.accepted).toBe(true);
    const fittedFacility = fitting.state.infrastructure.facilities[0]!;
    expect(
      fittedFacility.racks[0]?.placements[0]?.equipment.rackUnits,
    ).toBe(24);
    expect(getFacilitySnapshot(fittedFacility).racks[0]?.rackUnits).toEqual({
      capacity: 24,
      demand: 24,
      available: 0,
      utilizationBps: 10_000,
      headroomBps: 0,
    });

    const oversized = withRackedAggregate(25);
    expect(oversized.placed.accepted).toBe(false);
    expect(oversized.placed.blockers.join(" ")).toContain(
      "does not have 25U available",
    );
    expect(
      oversized.state.infrastructure.fleetNodes.find(
        (node) => node.id === oversized.nodeId,
      )?.rackId,
    ).toBeNull();
    expect(
      oversized.state.infrastructure.facilities[0]?.racks[0]?.placements,
    ).toEqual([]);

    const largeBatch = withRackedAggregate(10_001);
    expect(largeBatch.placed.accepted).toBe(false);
    expect(largeBatch.placed.blockers.join(" ")).toContain(
      "does not have 10001U available",
    );
  });

  it("re-derives aggregate rack-unit demand during reconciliation and save load", () => {
    const fitting = withRackedAggregate(24);
    const corrupted: GameState = {
      ...fitting.state,
      infrastructure: {
        ...fitting.state.infrastructure,
        facilities: fitting.state.infrastructure.facilities.map((facility) => ({
          ...facility,
          racks: facility.racks.map((rack) => ({
            ...rack,
            placements: rack.placements.map((placement) => ({
              ...placement,
              equipment: { ...placement.equipment, rackUnits: 1 },
            })),
          })),
        })),
      },
    };
    const normalized = normalizeFacilityInfrastructureForGameState(corrupted);
    const restored = deserializeSave(serializeSave(corrupted, 456_000));

    expect(
      normalized.infrastructure.facilities[0]?.racks[0]?.placements[0]
        ?.equipment.rackUnits,
    ).toBe(24);
    expect(
      getFacilitySnapshot(normalized.infrastructure.facilities[0]!).racks[0]
        ?.rackUnits.demand,
    ).toBe(24);
    expect(
      restored.infrastructure.facilities[0]?.racks[0]?.placements[0]?.equipment
        .rackUnits,
    ).toBe(24);
    expect(restored.infrastructure.fleetNodes.find(
      (node) => node.id === fitting.nodeId,
    )?.rackId).toBe(
      qualifyFacilityRackRef(
        restored.infrastructure.facilities[0]!.id,
        restored.infrastructure.facilities[0]!.racks[0]!.id,
      ),
    );

    const oversizedSaved: GameState = {
      ...corrupted,
      infrastructure: {
        ...corrupted.infrastructure,
        fleetNodes: corrupted.infrastructure.fleetNodes.map((node) =>
          node.id === fitting.nodeId && node.source.kind === "aggregate"
            ? {
                ...node,
                source: { ...node.source, count: 25 },
              }
            : node,
        ),
      },
    };
    const rejectedAfterReconciliation =
      normalizeFacilityInfrastructureForGameState(oversizedSaved);
    const rejectedAfterLoad = deserializeSave(
      serializeSave(oversizedSaved, 789_000),
    );

    expect(
      rejectedAfterReconciliation.infrastructure.facilities[0]?.racks[0]
        ?.placements,
    ).toEqual([]);
    expect(
      rejectedAfterReconciliation.infrastructure.fleetNodes.find(
        (node) => node.id === fitting.nodeId,
      )?.rackId,
    ).toBeNull();
    expect(
      rejectedAfterLoad.infrastructure.facilities[0]?.racks[0]?.placements,
    ).toEqual([]);
    expect(
      rejectedAfterLoad.infrastructure.fleetNodes.find(
        (node) => node.id === fitting.nodeId,
      )?.rackId,
    ).toBeNull();
  });

  it("derives Cloud compute at the exact 70% ceiling beyond 1e309", () => {
    const commissioned = commissionRack(
      createFacilityState("regionalFacility"),
      "highDensityRack",
    );
    const huge = placeEquipmentDeterministically(commissioned.state, {
      id: "huge",
      name: "Huge exact node",
      rackUnits: 1,
      capacity: createRackEquipmentCapacity({ compute: "1e309" }),
      demand: createFacilityResourceVector(),
      operatingCostPerSecond: amount(0),
    });
    expect(huge.accepted).toBe(true);
    expect(deriveFacilityCloudEffectiveCompute(huge.state)).toBe(
      amount("7e308"),
    );
    expect(
      deriveFacilityCloudEffectiveCompute(
        huge.state,
        createFacilityResourceVector({ compute: "2e308" }),
      ),
    ).toBe(amount("5e308"));
  });

  it("applies WAN capacity in Cloud routes instead of double-capping service compute", () => {
    const commissioned = commissionRack(
      createFacilityState("regionalFacility"),
      "highDensityRack",
    );
    const placed = placeEquipmentDeterministically(commissioned.state, {
      id: "wan-separated",
      name: "WAN-separated Cloud node",
      rackUnits: 1,
      capacity: createRackEquipmentCapacity({
        compute: "1000000000000",
        uplinkIngress: "1",
        uplinkEgress: "1",
      }),
      demand: createFacilityResourceVector(),
      operatingCostPerSecond: amount(0),
    });

    expect(placed.accepted).toBe(true);
    expect(getFacilitySnapshot(placed.state).capacity.uplinkEgress).toBe("1");
    expect(deriveFacilityCloudEffectiveCompute(placed.state)).toBe(
      amount("700000000000"),
    );
  });
});
