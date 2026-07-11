import { describe, expect, it } from "vitest";
import { amountCompare } from "../amount";
import {
  acceleratorSkuDefinitions,
  getAcceleratorSkuDefinition,
  getAcceleratorSkuDefinitionsForKind,
  isAcceleratorSkuId,
  isAcceleratorWorkloadClass,
} from "./accelerators";

describe("Workshop accelerator content", () => {
  it("defines explicit GPU and NPU roles with exact operating envelopes", () => {
    expect(acceleratorSkuDefinitions.map((definition) => definition.id)).toEqual([
      "gpuRaster8",
      "gpuTensor24",
      "npuEdge4",
      "npuBatch16",
    ]);
    expect(
      getAcceleratorSkuDefinitionsForKind("gpu").map(
        (definition) => definition.id,
      ),
    ).toEqual(["gpuRaster8", "gpuTensor24"]);
    expect(
      getAcceleratorSkuDefinitionsForKind("npu").map(
        (definition) => definition.id,
      ),
    ).toEqual(["npuEdge4", "npuBatch16"]);

    const gpu = getAcceleratorSkuDefinition("gpuRaster8");
    const npu = getAcceleratorSkuDefinition("npuEdge4");
    expect(gpu.supportedWorkloadClasses).toEqual([
      "render",
      "vector",
      "mlBatch",
    ]);
    expect(npu.supportedWorkloadClasses).toEqual(["inference", "mlBatch"]);
    expect(npu.minimumBatchSize).toBe("8");
    expect(gpu.deviceMemoryBits).toBe("68719476736");
    expect(gpu.costs).toEqual([
      { resource: "credits", amount: "500000" },
      { resource: "data", amount: "240" },
    ]);

    for (const definition of acceleratorSkuDefinitions) {
      expect(
        amountCompare(definition.activePowerWatts, definition.idlePowerWatts),
      ).toBeGreaterThanOrEqual(0);
      expect(
        amountCompare(definition.activeHeatWatts, definition.idleHeatWatts),
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it("provides strict catalog and workload-class guards", () => {
    expect(isAcceleratorSkuId("gpuTensor24")).toBe(true);
    expect(isAcceleratorSkuId("gpu-unbounded")).toBe(false);
    expect(isAcceleratorWorkloadClass("inference")).toBe(true);
    expect(isAcceleratorWorkloadClass("general")).toBe(false);
  });
});
