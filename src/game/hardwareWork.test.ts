import { describe, expect, it } from "vitest";

import {
  createHardwareWorkRates,
  createHardwareWorkRecipe,
  createHardwareWorkStage,
  getHardwareWorkCompletedUnits,
  getHardwareWorkDurationMs,
  getHardwareWorkTotal,
} from "./hardwareWork";

describe("sequential hardware work", () => {
  it("loads one bit in one second on a one-hertz cache lane", () => {
    const recipe = createHardwareWorkRecipe([
      createHardwareWorkStage("fetch", "cache", 1),
    ]);

    expect(getHardwareWorkDurationMs(
      recipe,
      createHardwareWorkRates({ cache: 1 }),
    )).toBe("1000");
  });

  it("adds the actual time spent traversing each hardware stage", () => {
    const recipe = createHardwareWorkRecipe([
      createHardwareWorkStage("read", "storageRead", 100),
      createHardwareWorkStage("stage", "ram", 40),
      createHardwareWorkStage("load", "cache", 20),
      createHardwareWorkStage("execute", "compute", 200),
      createHardwareWorkStage("send", "networkEgress", 50),
    ]);
    const rates = createHardwareWorkRates({
      storageRead: 50,
      ram: 20,
      cache: 10,
      compute: 100,
      networkEgress: 25,
    });

    expect(getHardwareWorkDurationMs(recipe, rates)).toBe("10000");
    expect(getHardwareWorkCompletedUnits(recipe, rates, 5_000)).toBe("0.5");
    expect(getHardwareWorkTotal(recipe)).toBe("410");
  });

  it("blocks when a required stage has no installed throughput", () => {
    const recipe = createHardwareWorkRecipe([
      createHardwareWorkStage("receive", "networkIngress", 1),
    ]);

    expect(getHardwareWorkDurationMs(recipe, createHardwareWorkRates())).toBeNull();
  });
});
