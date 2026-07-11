import { describe, expect, it } from "vitest";
import { amount } from "./amount";
import {
  MAX_PROJECTED_THERMAL_STRESS_BPS,
  advanceThermal,
  aggregateThermalComponents,
  applyCoolingUpgrade,
  createThermalState,
  deriveThermalSnapshot,
  getCoolingPowerWatts,
  getExactThermalStressBps,
  getNextThermalEvent,
  getThermalStatus,
  normalizeCoolingUpgradePath,
  normalizeThermalComponent,
  projectThermalStressBps,
  projectThermalThroughputModifierBps,
  type CoolingState,
  type ThermalComponent,
  type ThermalEnvironment,
} from "./thermal";

const component = (
  id: string,
  idleHeatWatts: string | number,
  activeHeatWatts: string | number,
  utilizationBps: number,
): ThermalComponent => ({
  id,
  idleHeatWatts: amount(idleHeatWatts),
  activeHeatWatts: amount(activeHeatWatts),
  utilizationBps,
});

const cooling = (
  capacityWatts: string | number,
  powerDrawWatts: string | number = 0,
  level = 0,
): CoolingState => ({
  level,
  capacityWatts: amount(capacityWatts),
  powerDrawWatts: amount(powerDrawWatts),
});

const environment = (
  components: ThermalComponent[],
  capacityWatts: string | number,
  responseSeconds: string | number = 10,
  powered = true,
): ThermalEnvironment => ({
  powered,
  components,
  cooling: cooling(capacityWatts, 5),
  responseSeconds: amount(responseSeconds),
});

describe("exact Thermal load and stress", () => {
  it("uses exact status boundaries and reports powered-off state separately", () => {
    expect(getThermalStatus(false, 100, 100)).toBe("off");
    expect(getThermalStatus(true, 0, 0)).toBe("nominal");
    expect(getThermalStatus(true, "69.999", 100)).toBe("nominal");
    expect(getThermalStatus(true, 70, 100)).toBe("warm");
    expect(getThermalStatus(true, "84.999", 100)).toBe("warm");
    expect(getThermalStatus(true, 85, 100)).toBe("hot");
    expect(getThermalStatus(true, "99.999", 100)).toBe("hot");
    expect(getThermalStatus(true, 100, 100)).toBe("critical");
  });

  it("normalizes active heat above idle and aggregates partial activity exactly", () => {
    const repaired = normalizeThermalComponent(
      component("repaired", 12, 5, 15_000),
    );
    const aggregate = aggregateThermalComponents([
      component("cpu", 10, 30, 5_000),
      component("memory", 5, 5, 10_000),
    ]);

    expect(repaired.activeHeatWatts).toBe("12");
    expect(repaired.utilizationBps).toBe(10_000);
    expect(aggregate.idleHeatWatts).toBe("15");
    expect(aggregate.activeHeatWatts).toBe("35");
    expect(aggregate.generatedHeatWatts).toBe("25");
  });

  it("treats zero cooling as unbounded stress without destructive shutdown", () => {
    expect(getExactThermalStressBps(10, 0)).toBeNull();
    expect(projectThermalStressBps(10, 0)).toBe(
      MAX_PROJECTED_THERMAL_STRESS_BPS,
    );
    expect(getThermalStatus(true, 10, 0)).toBe("critical");
    expect(projectThermalThroughputModifierBps(true, 10, 0)).toBe(2_500);
  });

  it("uses stronger cooling to lower stress while exposing its exact power cost", () => {
    const state = createThermalState(100);
    const components = [component("cpu", 100, 100, 10_000)];
    const low = deriveThermalSnapshot(
      state,
      {
        ...environment(components, 100),
        cooling: cooling(100, "12.5"),
      },
    );
    const high = deriveThermalSnapshot(
      state,
      {
        ...environment(components, 200),
        cooling: cooling(200, 30, 1),
      },
    );

    expect(low.status).toBe("critical");
    expect(low.stressBps).toBe(10_000);
    expect(low.throughputModifierBps).toBe(8_500);
    expect(low.coolingPowerWatts).toBe("12.5");
    expect(high.status).toBe("nominal");
    expect(high.stressBps).toBe(5_000);
    expect(high.throughputModifierBps).toBe(10_000);
    expect(getCoolingPowerWatts(true, cooling(200, 30))).toBe("30");
    expect(getCoolingPowerWatts(false, cooling(200, 30))).toBe("0");
  });

  it("normalizes upgrade capacity monotonically and cannot downgrade", () => {
    const path = normalizeCoolingUpgradePath([
      { id: "level-2", ...cooling(80, 12, 2) },
      { id: "level-0", ...cooling(50, 3, 0) },
      { id: "level-1", ...cooling(40, 5, 1) },
    ]);
    const upgraded = applyCoolingUpgrade(path[0], path[2]);
    const downgradeAttempt = applyCoolingUpgrade(upgraded, path[1]);

    expect(path.map((entry) => entry.level)).toEqual([0, 1, 2]);
    expect(path.map((entry) => entry.capacityWatts)).toEqual(["50", "50", "80"]);
    expect(upgraded).toEqual({
      level: 2,
      capacityWatts: amount(80),
      powerDrawWatts: amount(12),
    });
    expect(downgradeAttempt).toEqual(upgraded);
  });
});

describe("sustained Thermal advance", () => {
  it("ramps into a non-destructive sustained throughput derate", () => {
    const conditions = environment(
      [component("cpu", 20, 200, 10_000)],
      100,
      10,
    );
    const halfway = advanceThermal(createThermalState(), conditions, 5_000);
    const sustained = advanceThermal(halfway.state, conditions, 5_000);

    expect(halfway.state.sustainedHeatWatts).toBe("100");
    expect(halfway.snapshot.status).toBe("critical");
    expect(halfway.snapshot.throughputModifierBps).toBe(8_500);
    expect(sustained.state.sustainedHeatWatts).toBe("200");
    expect(sustained.snapshot.throughputModifierBps).toBe(4_250);
    expect(sustained.snapshot.throughputModifierBps).toBeGreaterThan(0);
  });

  it("exposes exact status/equilibrium event boundaries", () => {
    const conditions = environment(
      [component("cpu", 0, 100, 10_000)],
      100,
      10,
    );
    const initial = createThermalState();
    const firstEvent = getNextThermalEvent(initial, conditions);
    const warm = advanceThermal(initial, conditions, 7_000);
    const secondEvent = getNextThermalEvent(warm.state, conditions);

    expect(firstEvent).toEqual({
      kind: "status",
      afterMs: amount(7_000),
      nextStatus: "warm",
    });
    expect(warm.state.sustainedHeatWatts).toBe("70");
    expect(warm.snapshot.status).toBe("warm");
    expect(secondEvent).toEqual({
      kind: "status",
      afterMs: amount(1_500),
      nextStatus: "hot",
    });
  });

  it("is invariant to delta partitioning while heating and cooling", () => {
    const heating = environment(
      [component("cpu", 20, 200, 10_000)],
      100,
      10,
    );
    const singleHeat = advanceThermal(createThermalState(), heating, 10_000);
    let chunkedHeat = createThermalState();
    for (const delta of [1_234, 2_000, 6_766]) {
      chunkedHeat = advanceThermal(chunkedHeat, heating, delta).state;
    }

    const coolingConditions = environment(
      [component("cpu", 20, 200, 0)],
      100,
      10,
    );
    const hot = createThermalState(200);
    const singleCool = advanceThermal(hot, coolingConditions, 20_000);
    let chunkedCool = hot;
    for (const delta of [5_000, 7_500, 7_500]) {
      chunkedCool = advanceThermal(
        chunkedCool,
        coolingConditions,
        delta,
      ).state;
    }

    expect(chunkedHeat).toEqual(singleHeat.state);
    expect(chunkedCool).toEqual(singleCool.state);
    expect(singleCool.state.sustainedHeatWatts).toBe("20");
  });

  it("supports instantaneous response as an explicit zero-time event", () => {
    const conditions = environment(
      [component("cpu", 10, 30, 10_000)],
      100,
      0,
    );
    const initial = createThermalState();

    expect(getNextThermalEvent(initial, conditions)).toEqual({
      kind: "equilibrium",
      afterMs: amount(0),
    });
    expect(advanceThermal(initial, conditions, 0).state.sustainedHeatWatts).toBe(
      "30",
    );
  });

  it("keeps watts and stress exact beyond Number range", () => {
    const conditions = {
      ...environment(
        [component("huge", "1e309", "2e309", 5_000)],
        "2e309",
        10,
      ),
      cooling: cooling("2e309", "1e309", 1),
    };
    const result = advanceThermal(createThermalState(), conditions, 10_000);

    expect(result.snapshot.idleHeatWatts).toBe(amount("1e309"));
    expect(result.snapshot.activeHeatWatts).toBe(amount("2e309"));
    expect(result.snapshot.generatedHeatWatts).toBe(amount("1.5e309"));
    expect(result.state.sustainedHeatWatts).toBe(amount("1.5e309"));
    expect(result.snapshot.exactStressBps).toBe("7500");
    expect(result.snapshot.status).toBe("warm");
    expect(result.snapshot.coolingPowerWatts).toBe(amount("1e309"));
  });
});
