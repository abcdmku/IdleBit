import { describe, expect, it } from "vitest";
import { toGameAction } from "./uiActions";

describe("ui action mapping", () => {
  it("passes automation buffer purchases through unchanged", () => {
    expect(
      toGameAction({
        type: "purchaseAutomationBuffer",
        levelId: "localScheduler",
      }),
    ).toEqual({
      type: "purchaseAutomationBuffer",
      levelId: "localScheduler",
    });
  });

  it("maps custom store power selections onto the game PSU selection", () => {
    expect(
      toGameAction({
        type: "buyCustomSystem",
        tierIds: {
          cpu: "cpu-barebones-1",
          ram: "ram-none",
          scheduler: "scheduler-none",
          power: "psu-balanced",
          powerSupplyLevel: "18",
        },
      }),
    ).toEqual({
      type: "buyCustomMachine",
      components: {
        cpu: "cpu-barebones-1",
        cpuPackageCount: 1,
        cpuCoreCount: undefined,
        cpuLevel: undefined,
        cacheLevel: undefined,
        cacheSpeedLevel: undefined,
        cpuPackageConfigs: undefined,
        cpuSchedulerSlots: undefined,
        ram: "ram-none",
        ramStickCount: undefined,
        ramLevel: undefined,
        ramSpeedLevel: undefined,
        scheduler: "scheduler-none",
        psu: "psu-balanced",
        psuLevel: 18,
      },
    });
  });
});
