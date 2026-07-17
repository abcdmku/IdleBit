import { describe, expect, it } from "vitest";
import { amountCompare } from "../amount";
import {
  createAcceleratorWorkloadDemand,
  getAcceleratorCompatibility,
} from "../accelerators";
import {
  acceleratorSkuDefinitions,
  getAcceleratorSkuDefinition,
  getAcceleratorSkuDefinitionsForKind,
  isAcceleratorSkuId,
  isAcceleratorWorkloadClass,
} from "./accelerators";
import { getTaskDefinition } from "./tasks";

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
      { resource: "data", amount: "5000000" },
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

  // C-DES-12: Inference Batch is the only authored inference workload and it
  // runs at batch size 16; a 32 minimum made Batch NPU 16 dead content.
  it("keeps Batch NPU 16 compatible with the authored Inference Batch workload", () => {
    const batchNpu = getAcceleratorSkuDefinition("npuBatch16");
    const inferenceOperation = getTaskDefinition("inferenceBatch")
      .operations.find((operation) => operation.acceleratorClass === "inference");

    expect(inferenceOperation).toBeDefined();
    expect(batchNpu.minimumBatchSize).toBe("16");

    const demand = createAcceleratorWorkloadDemand({
      id: "inference-batch",
      workloadClass: "inference",
      modelMemoryBits: inferenceOperation?.acceleratorModelMemoryBits,
      batchSize: inferenceOperation?.acceleratorBatchSize,
      minimumComputeOperationsPerSecond:
        inferenceOperation?.acceleratorMinimumComputeOperationsPerSecond,
      preferredKind: "npu",
    });

    expect(getAcceleratorCompatibility(batchNpu, demand)).toEqual({
      compatible: true,
      blockers: [],
    });
  });
});
