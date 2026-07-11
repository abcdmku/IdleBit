import { describe, expect, it } from "vitest";
import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountDivide,
  amountMultiply,
} from "../amount";
import {
  applyCoolingUpgrade,
  createThermalState,
  deriveThermalSnapshot,
} from "../thermal";
import {
  getAllowedOverclockPresets,
  getNextWorkshopCoolingTier,
  getOverclockBlockedReason,
  getWorkshopCoolingState,
  getWorkshopCoolingTierDefinition,
  overclockPresetDefinitions,
  projectWorkshopCooling,
  workshopCoolingTierDefinitions,
} from "./cooling";

describe("Workshop cooling content", () => {
  it("defines a monotonic thermal-kernel upgrade path with exact costs", () => {
    expect(workshopCoolingTierDefinitions.map((tier) => tier.id)).toEqual([
      "none",
      "passiveHeatsink",
      "fanCooling",
      "caseAirflow",
      "liquidCooling",
    ]);
    expect(workshopCoolingTierDefinitions.map((tier) => tier.level)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(
      workshopCoolingTierDefinitions.map((tier) => tier.capacityWatts),
    ).toEqual(["0", "650", "1200", "2400", "6000"]);
    expect(
      getWorkshopCoolingTierDefinition("liquidCooling").costs,
    ).toEqual([
      { resource: "credits", amount: amount("25000000") },
      { resource: "data", amount: amount("600") },
    ]);

    const passive = getWorkshopCoolingState("passiveHeatsink");
    const liquid = applyCoolingUpgrade(
      passive,
      getWorkshopCoolingTierDefinition("liquidCooling"),
    );
    expect(liquid).toEqual(getWorkshopCoolingState("liquidCooling"));
    expect(
      applyCoolingUpgrade(
        liquid,
        getWorkshopCoolingTierDefinition("fanCooling"),
      ),
    ).toEqual(liquid);
    expect(getNextWorkshopCoolingTier("liquidCooling")).toBeNull();
  });

  it("gates explicit overclock presets by installed cooling tier", () => {
    expect(overclockPresetDefinitions.map((preset) => preset.id)).toEqual([
      "stock",
      "boost",
      "performance",
      "extreme",
    ]);
    expect(getAllowedOverclockPresets("none").map((preset) => preset.id)).toEqual([
      "stock",
    ]);
    expect(
      getAllowedOverclockPresets("caseAirflow").map((preset) => preset.id),
    ).toEqual(["stock", "boost", "performance"]);
    expect(getOverclockBlockedReason("fanCooling", "performance")).toBe(
      "Requires Case Airflow.",
    );
    expect(getOverclockBlockedReason("liquidCooling", "extreme")).toBeNull();
  });

  it("feeds exact cooling states into the existing thermal kernel", () => {
    const thermalState = createThermalState(1_000);
    const component = {
      id: "cpu",
      idleHeatWatts: amount(1_000),
      activeHeatWatts: amount(1_000),
      utilizationBps: 10_000,
    };
    const withoutCooling = deriveThermalSnapshot(thermalState, {
      powered: true,
      components: [component],
      cooling: getWorkshopCoolingState("none"),
      responseSeconds: amount(10),
    });
    const liquidCooled = deriveThermalSnapshot(thermalState, {
      powered: true,
      components: [component],
      cooling: getWorkshopCoolingState("liquidCooling"),
      responseSeconds: amount(10),
    });

    expect(withoutCooling.status).toBe("critical");
    expect(liquidCooled.status).toBe("nominal");
    expect(liquidCooled.coolingPowerWatts).toBe("95");
  });

  it("projects power and heat exactly beyond Number range", () => {
    const projection = projectWorkshopCooling({
      basePowerWatts: "1e309",
      baseHeatWatts: "1e309",
      coolingTierId: "liquidCooling",
      overclockPresetId: "extreme",
      powered: true,
    });
    const expectedHardwarePower = amountMultiply("1e309", "2.5");
    const expectedOverclockedHeat = amountMultiply("1e309", "2.9");
    const expectedGeneratedHeat = amountDivide(
      amountMultiply(expectedOverclockedHeat, 7_000),
      10_000,
    );

    expect(projection.hardwarePowerWatts).toBe(expectedHardwarePower);
    expect(projection.totalPowerWatts).toBe(
      amountAdd(expectedHardwarePower, 95),
    );
    expect(projection.generatedHeatWatts).toBe(expectedGeneratedHeat);
    expect(projection.coolingCapacityWatts).toBe("6000");

    expect(
      projectWorkshopCooling({
        basePowerWatts: "1e309",
        baseHeatWatts: "1e309",
        coolingTierId: "liquidCooling",
        overclockPresetId: "extreme",
        powered: false,
      }),
    ).toMatchObject({
      hardwarePowerWatts: ZERO_AMOUNT,
      coolingPowerWatts: ZERO_AMOUNT,
      totalPowerWatts: ZERO_AMOUNT,
      generatedHeatWatts: ZERO_AMOUNT,
    });
  });
});
