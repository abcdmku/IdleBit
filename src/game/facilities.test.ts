import { describe, expect, it } from "vitest";
import { amount, amountAdd, amountDivide, amountSubtract } from "./amount";
import type { CapacityProfile } from "./infrastructureTypes";
import {
  facilityTemplateDefinitions,
  getFacilityTemplateDefinition,
  getRackTemplateDefinition,
  rackTemplateDefinitions,
  type RackEquipmentProfile,
  type RackTemplateId,
} from "./facilityDefinitions";
import {
  addFacilityResourceVectors,
  billFacilityOperation,
  commissionRack,
  createFacilityBillingState,
  createFacilityResourceVector,
  createFacilityState,
  createRackEquipmentCapacity,
  getFacilityDemandAdmissionDecision,
  getFacilityOperatingRunwayMs,
  getFacilitySnapshot,
  getNextFacilityBillingEvent,
  getRackPlacementAdmissionBlockers,
  normalizeFacilityBillingState,
  normalizeFacilityState,
  placeEquipmentDeterministically,
  rackEquipmentFromFleetCapacity,
  scaleFacilityResourceVector,
  type FacilityState,
} from "./facilities";

interface EquipmentOptions {
  rackUnits?: number;
  compute?: string | number;
  memoryBits?: string | number;
  storageBits?: string | number;
  uplinkCapacity?: string | number;
  computeDemand?: string | number;
  memoryDemand?: string | number;
  storageDemand?: string | number;
  powerWatts?: string | number;
  coolingWatts?: string | number;
  uplinkIngress?: string | number;
  uplinkEgress?: string | number;
  operatingCostPerSecond?: string | number;
}

const equipment = (
  id: string,
  options: EquipmentOptions = {},
): RackEquipmentProfile => ({
  id,
  name: id,
  rackUnits: options.rackUnits ?? 1,
  capacity: createRackEquipmentCapacity({
    compute: options.compute ?? 100,
    memoryBits: options.memoryBits ?? 100,
    storageBits: options.storageBits ?? 100,
    uplinkIngress: options.uplinkCapacity ?? 100,
    uplinkEgress: options.uplinkCapacity ?? 100,
  }),
  demand: createFacilityResourceVector({
    compute: options.computeDemand ?? 0,
    memoryBits: options.memoryDemand ?? 0,
    storageBits: options.storageDemand ?? 0,
    powerWatts: options.powerWatts ?? 0,
    coolingWatts: options.coolingWatts ?? 0,
    uplinkIngress: options.uplinkIngress ?? 0,
    uplinkEgress: options.uplinkEgress ?? 0,
  }),
  operatingCostPerSecond: amount(options.operatingCostPerSecond ?? 0),
});

const withRacks = (
  count: number,
  templateId: RackTemplateId = "standardRack",
) => {
  let state = createFacilityState();
  for (let index = 0; index < count; index += 1) {
    const result = commissionRack(state, templateId);
    expect(result.accepted).toBe(true);
    state = result.state;
  }
  return state;
};

const place = (state: FacilityState, profile: RackEquipmentProfile) => {
  const result = placeEquipmentDeterministically(state, profile);
  expect(result.accepted).toBe(true);
  return result.state;
};

describe("Rack and Facility foundation", () => {
  it("defines stable named rack and facility templates", () => {
    expect(rackTemplateDefinitions.map(({ id }) => id)).toEqual([
      "halfRack",
      "standardRack",
      "highDensityRack",
    ]);
    expect(facilityTemplateDefinitions.map(({ id }) => id)).toEqual([
      "workshopFacility",
      "edgeFacility",
      "regionalFacility",
    ]);
    expect(getRackTemplateDefinition("standardRack").name).toBe(
      "Standard 42U Rack",
    );
    expect(getFacilityTemplateDefinition("workshopFacility").rackSlots).toBe(4);
  });

  it("keeps resource math exact beyond 1e309 and clamps constructor bypasses", () => {
    const one = createFacilityResourceVector({
      compute: "1e309",
      powerWatts: "-1e400",
    });
    const three = scaleFacilityResourceVector(one, 3);
    const four = addFacilityResourceVectors(one, three);
    const capacity = createRackEquipmentCapacity({
      compute: "-7",
      storageBits: "1e309",
    });

    expect(three.compute).toBe(amount("3e309"));
    expect(four.compute).toBe(amount("4e309"));
    expect(one.powerWatts).toBe("0");
    expect(capacity.compute).toBe("0");
    expect(capacity.storageBits).toBe(amount("1e309"));

    let state = withRacks(1, "highDensityRack");
    state = place(state, equipment("huge-a", { compute: "1e309" }));
    state = place(state, equipment("huge-b", { compute: "3e309" }));
    expect(getFacilitySnapshot(state).capacity.compute).toBe(amount("4e309"));
  });

  it("enforces RU, power, heat, and uplink constraints with an exact 30% gate", () => {
    const state = withRacks(1, "halfRack");
    const rack = state.racks[0]!;
    const exactlySeventy = equipment("boundary", {
      powerWatts: 8_400,
      coolingWatts: 7_000,
      uplinkCapacity: 100,
      uplinkIngress: 70,
      uplinkEgress: 70,
    });
    expect(getRackPlacementAdmissionBlockers(rack, exactlySeventy)).toEqual([]);

    const cases: Array<[RackEquipmentProfile, string]> = [
      [equipment("power", { powerWatts: "8400.0000001" }), "powerWatts"],
      [equipment("heat", { coolingWatts: "7000.0000001" }), "coolingWatts"],
      [
        equipment("uplink", {
          uplinkCapacity: 100,
          uplinkIngress: "70.0000001",
        }),
        "uplinkIngress",
      ],
      [equipment("ru", { rackUnits: 25 }), "rackUnits"],
    ];
    for (const [profile, constraint] of cases) {
      expect(
        getRackPlacementAdmissionBlockers(rack, profile).some(
          (blocker) => blocker.constraint === constraint,
        ),
      ).toBe(true);
    }

    const fullRu = placeEquipmentDeterministically(
      state,
      equipment("full-rack", { rackUnits: 24 }),
    );
    expect(fullRu.accepted).toBe(true);
    expect(getFacilitySnapshot(fullRu.state).racks[0]?.rackUnits.headroomBps).toBe(
      0,
    );
  });

  it("enforces facility rack-slot and shared plant constraints", () => {
    let full = withRacks(4, "highDensityRack");
    const fifth = commissionRack(full, "highDensityRack");
    expect(fifth.accepted).toBe(false);
    expect(fifth.blockers[0]?.constraint).toBe("rackSlots");

    full = place(
      full,
      equipment("plant-a", { powerWatts: 50_000, coolingWatts: 0 }),
    );
    const second = placeEquipmentDeterministically(
      full,
      equipment("plant-b", { powerWatts: 21_000, coolingWatts: 0 }),
      { rackId: "rack-2" },
    );
    expect(second.accepted).toBe(false);
    expect(
      second.blockers.some(
        (blocker) =>
          blocker.scope === "facility" && blocker.constraint === "powerWatts",
      ),
    ).toBe(true);
    expect(second.state).toBe(full);
  });

  it("uses stable numeric first-fit placement independent of rack array order", () => {
    const commissioned = withRacks(2, "halfRack");
    let state: FacilityState = {
      ...commissioned,
      racks: [...commissioned.racks].reverse(),
    };
    const first = placeEquipmentDeterministically(
      state,
      equipment("fills-first", { rackUnits: 24 }),
    );
    expect(first.rackId).toBe("rack-1");
    expect(first.placementId).toBe("placement-3");
    state = first.state;

    const second = placeEquipmentDeterministically(
      state,
      equipment("uses-second", { rackUnits: 1 }),
    );
    expect(second.rackId).toBe("rack-2");
    expect(second.placementId).toBe("placement-4");
  });

  it("converts Fleet capacity without losing exact throughput or peak envelopes", () => {
    const profile: CapacityProfile = {
      rates: {
        compute: amount("1e309"),
        storageRead: amount(12),
        storageWrite: amount(8),
        networkIngress: amount("1000000000"),
        networkEgress: amount("2000000000"),
      },
      memoryBits: amount("68719476736"),
      storageBits: amount("8000000000000"),
      idleWatts: amount(45),
      peakWatts: amount(120),
    };
    const converted = rackEquipmentFromFleetCapacity(
      "fleet-9",
      "Exact node",
      profile,
      2,
      "0.125",
    );

    expect(converted.capacity.compute).toBe(amount("1e309"));
    expect(converted.capacity.uplinkIngress).toBe("1000000000");
    expect(converted.capacity.uplinkEgress).toBe("2000000000");
    expect(converted.demand.powerWatts).toBe("120");
    expect(converted.demand.coolingWatts).toBe("120");
    expect(converted.demand.uplinkIngress).toBe("0");
    expect(converted.operatingCostPerSecond).toBe("0.125");
  });

  it("reports exact utilization, headroom, and fixed plus energy cost", () => {
    let state = withRacks(1, "standardRack");
    state = place(
      state,
      equipment("metered", {
        compute: 100,
        memoryBits: 1_000,
        storageBits: 2_000,
        uplinkCapacity: 100,
        computeDemand: 50,
        memoryDemand: 100,
        storageDemand: 500,
        powerWatts: 1_000,
        coolingWatts: 900,
        uplinkIngress: 25,
        uplinkEgress: 50,
        operatingCostPerSecond: "0.5",
      }),
    );
    const snapshot = getFacilitySnapshot(state);

    expect(snapshot.utilizationBps.compute).toBe(5_000);
    expect(snapshot.utilizationBps.uplinkEgress).toBe(5_000);
    expect(snapshot.maxUtilizationBps).toBe(5_000);
    expect(snapshot.headroomBps).toBe(5_000);
    expect(snapshot.available.compute).toBe("50");
    expect(snapshot.operatingCost).toEqual({
      facilityFixedPerSecond: "0.25",
      rackFixedPerSecond: "0.04",
      equipmentPerSecond: "0.5",
      energyPerSecond: "0.00002",
      totalPerSecond: "0.79002",
    });
  });

  it("admits external workload demand at the exact 70% boundary", () => {
    let state = withRacks(1);
    state = place(state, equipment("capacity", { compute: "1e309" }));
    const atBoundary = createFacilityResourceVector({ compute: "7e308" });
    const overBoundary = createFacilityResourceVector({
      compute: amountAdd("7e308", "0.1"),
    });

    expect(getFacilityDemandAdmissionDecision(state, atBoundary).accepted).toBe(
      true,
    );
    expect(getFacilityDemandAdmissionDecision(state, overBoundary).accepted).toBe(
      false,
    );
  });

  it("exposes an exact billing-runway event and is delta invariant", () => {
    const facility = createFacilityState();
    const starting = createFacilityBillingState(100);
    const oneShot = billFacilityOperation(facility, starting, 10_000);
    let chunked = starting;
    for (let index = 0; index < 10; index += 1) {
      chunked = billFacilityOperation(facility, chunked, 1_000).billing;
    }

    expect(oneShot.billing).toEqual(chunked);
    expect(oneShot.billing.totalBilledCredits).toBe("2.5");
    expect(oneShot.billing.productiveMs).toBe("10000");

    const runwayBilling = createFacilityBillingState(1);
    expect(getFacilityOperatingRunwayMs(facility, runwayBilling)).toBe("4000");
    expect(
      getNextFacilityBillingEvent(facility, runwayBilling, { horizonMs: 3_999 }),
    ).toBeNull();
    expect(
      getNextFacilityBillingEvent(facility, runwayBilling, { horizonMs: 4_000 }),
    ).toMatchObject({
      type: "billingRunwayExhausted",
      afterMs: "4000",
      atElapsedMs: "4000",
      operatingCostPerSecond: "0.25",
    });
  });

  it("safely pauses at insufficient runway without destructive facility changes", () => {
    const facility = withRacks(1);
    const before = structuredClone(facility);
    const result = billFacilityOperation(
      facility,
      createFacilityBillingState(1),
      10_000,
    );
    // One empty standard rack costs 0.29/s: 1 credit buys exactly 100000/29 ms.
    expect(result.billing.availableCredits).toBe("0");
    expect(result.billing.totalBilledCredits).toBe("1");
    expect(result.billing.status).toBe("safelyPaused");
    expect(result.billing.pauseReason).toBe("insufficientRunway");
    expect(result.interval.productiveMs).toBe(amountDivide("100000", 29));
    expect(result.interval.pausedMs).toBe(
      amountSubtract(10_000, amountDivide("100000", 29)),
    );
    expect(result.facility).toBe(facility);
    expect(facility).toEqual(before);
  });

  it("normalizes corrupt save input deterministically and drops unsafe references", () => {
    const valid = equipment("node-a");
    const corruptEquipment = {
      ...valid,
      capacity: {
        ...valid.capacity,
        compute: "1e309",
        memoryBits: "-5",
      },
      demand: {
        ...valid.demand,
        coolingWatts: "Infinity",
      },
      operatingCostPerSecond: "-2",
    };
    const unsafe = {
      ...equipment("unsafe"),
      demand: {
        ...equipment("unsafe").demand,
        powerWatts: "1000000",
      },
    };
    const corrupt = {
      id: "not-a-facility",
      name: "   ",
      templateId: "unknown",
      nextEntityId: -99,
      racks: [
        {
          id: "rack-2",
          name: "Second",
          templateId: "halfRack",
          placements: [
            { id: "placement-7", equipment: corruptEquipment },
          ],
        },
        {
          id: "rack-1",
          templateId: "invalid",
          placements: [
            { id: "placement-3", equipment: corruptEquipment },
            { id: "placement-4", equipment: corruptEquipment },
            { id: "placement-5", equipment: unsafe },
            { id: "bad-placement", equipment: valid },
          ],
        },
        { id: "rack-1", templateId: "halfRack", placements: [] },
        { id: "bad-rack", templateId: "halfRack", placements: [] },
      ],
    };

    const normalized = normalizeFacilityState(corrupt);
    const replay = normalizeFacilityState(corrupt);
    expect(normalized).toEqual(replay);
    expect(normalizeFacilityState(normalized)).toEqual(normalized);
    expect(normalized.id).toBe("facility-1");
    expect(normalized.templateId).toBe("workshopFacility");
    expect(normalized.racks.map(({ id }) => id)).toEqual(["rack-1", "rack-2"]);
    expect(normalized.racks[0]?.placements.map(({ id }) => id)).toEqual([
      "placement-3",
    ]);
    expect(normalized.racks[1]?.placements).toEqual([]);
    expect(normalized.racks[0]?.placements[0]?.equipment.capacity.compute).toBe(
      amount("1e309"),
    );
    expect(normalized.racks[0]?.placements[0]?.equipment.capacity.memoryBits).toBe(
      "0",
    );
    expect(normalized.racks[0]?.placements[0]?.equipment.demand.coolingWatts).toBe(
      "0",
    );
    expect(
      normalized.racks[0]?.placements[0]?.equipment.operatingCostPerSecond,
    ).toBe("0");
    expect(normalized.nextEntityId).toBe(4);

    expect(
      normalizeFacilityBillingState({
        availableCredits: "Infinity",
        totalBilledCredits: -4,
        elapsedMs: "1e309",
        productiveMs: "bad",
        pausedMs: -1,
        status: "safelyPaused",
        pauseReason: "destructiveFailure",
      }),
    ).toEqual({
      availableCredits: "0",
      totalBilledCredits: "0",
      elapsedMs: amount("1e309"),
      productiveMs: "0",
      pausedMs: "0",
      status: "safelyPaused",
      pauseReason: null,
    });
  });
});
