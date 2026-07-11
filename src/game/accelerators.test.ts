import { describe, expect, it } from "vitest";
import {
  amount,
  amountAdd,
  amountMultiply,
} from "./amount";
import {
  assignAcceleratorWorkloads,
  createAcceleratorWorkloadDemand,
  getAcceleratorCompatibility,
  normalizeInstalledAccelerators,
  projectAcceleratorSkuFleet,
  projectInstalledAccelerators,
  type InstalledAccelerator,
} from "./accelerators";
import { getAcceleratorSkuDefinition } from "./content/accelerators";

const gpu: InstalledAccelerator = {
  id: "gpu-a",
  slotId: 1,
  skuId: "gpuRaster8",
};
const npu: InstalledAccelerator = {
  id: "npu-a",
  slotId: 3,
  skuId: "npuEdge4",
};

describe("accelerator compatibility", () => {
  it("enforces workload class, model memory, batch, and throughput", () => {
    const inference = createAcceleratorWorkloadDemand({
      id: "inference",
      workloadClass: "inference",
      modelMemoryBits: "1000000000",
      batchSize: 8,
      minimumComputeOperationsPerSecond: "3000000000",
    });
    expect(
      getAcceleratorCompatibility(
        getAcceleratorSkuDefinition("npuEdge4"),
        inference,
      ),
    ).toEqual({ compatible: true, blockers: [] });
    expect(
      getAcceleratorCompatibility(
        getAcceleratorSkuDefinition("gpuRaster8"),
        inference,
      ),
    ).toEqual({ compatible: false, blockers: ["workload-class"] });

    const oversized = createAcceleratorWorkloadDemand({
      ...inference,
      id: "oversized",
      modelMemoryBits: "34359738369",
    });
    expect(
      getAcceleratorCompatibility(
        getAcceleratorSkuDefinition("npuEdge4"),
        oversized,
      ).blockers,
    ).toEqual(["model-memory"]);

    const undersizedBatch = createAcceleratorWorkloadDemand({
      ...inference,
      id: "small-batch",
      batchSize: 7,
    });
    expect(
      getAcceleratorCompatibility(
        getAcceleratorSkuDefinition("npuEdge4"),
        undersizedBatch,
      ).blockers,
    ).toEqual(["batch-size"]);

    const tooFast = createAcceleratorWorkloadDemand({
      ...inference,
      id: "too-fast",
      minimumComputeOperationsPerSecond: "8000000001",
    });
    expect(
      getAcceleratorCompatibility(
        getAcceleratorSkuDefinition("npuEdge4"),
        tooFast,
      ).blockers,
    ).toEqual(["throughput"]);
  });
});

describe("deterministic accelerator assignment", () => {
  it("protects constrained inference before routing flexible ML work", () => {
    const inference = createAcceleratorWorkloadDemand({
      id: "inference",
      workloadClass: "inference",
      modelMemoryBits: "1000000000",
      batchSize: 8,
    });
    const flexibleMl = createAcceleratorWorkloadDemand({
      id: "flex-ml",
      workloadClass: "mlBatch",
      modelMemoryBits: "1000000000",
      batchSize: 8,
    });
    const expected = [
      {
        workloadId: "flex-ml",
        target: "accelerator",
        deviceId: "gpu-a",
        slotId: 1,
        skuId: "gpuRaster8",
        fallbackReason: null,
      },
      {
        workloadId: "inference",
        target: "accelerator",
        deviceId: "npu-a",
        slotId: 3,
        skuId: "npuEdge4",
        fallbackReason: null,
      },
    ];

    expect(
      assignAcceleratorWorkloads({
        devices: [gpu, npu],
        workloads: [flexibleMl, inference],
      }),
    ).toEqual(expected);
    expect(
      assignAcceleratorWorkloads({
        devices: [npu, gpu],
        workloads: [inference, flexibleMl],
      }),
    ).toEqual(expected);
  });

  it("uses deterministic contention fallback and supports hard blocking", () => {
    const first = createAcceleratorWorkloadDemand({
      id: "render-a",
      workloadClass: "render",
    });
    const second = createAcceleratorWorkloadDemand({
      id: "render-b",
      workloadClass: "render",
    });
    expect(
      assignAcceleratorWorkloads({ devices: [gpu], workloads: [second, first] }),
    ).toEqual([
      expect.objectContaining({
        workloadId: "render-a",
        target: "accelerator",
        deviceId: "gpu-a",
      }),
      {
        workloadId: "render-b",
        target: "cpu",
        deviceId: null,
        slotId: null,
        skuId: null,
        fallbackReason: "accelerator-contention",
      },
    ]);

    const hardRequirement = createAcceleratorWorkloadDemand({
      id: "hard-render",
      workloadClass: "render",
      cpuFallbackAllowed: false,
    });
    expect(
      assignAcceleratorWorkloads({
        devices: [gpu],
        workloads: [hardRequirement],
        busyDeviceIds: ["gpu-a"],
      }),
    ).toEqual([
      {
        workloadId: "hard-render",
        target: "blocked",
        deviceId: null,
        slotId: null,
        skuId: null,
        fallbackReason: "accelerator-contention",
      },
    ]);
  });

  it("reports why an accelerator is unavailable before falling back to CPU", () => {
    const tooLarge = createAcceleratorWorkloadDemand({
      id: "too-large",
      workloadClass: "inference",
      modelMemoryBits: "34359738369",
      batchSize: 8,
    });
    const smallBatch = createAcceleratorWorkloadDemand({
      id: "small-batch",
      workloadClass: "inference",
      modelMemoryBits: 1,
      batchSize: 1,
    });
    const generalRender = createAcceleratorWorkloadDemand({
      id: "render",
      workloadClass: "render",
    });
    expect(
      assignAcceleratorWorkloads({ devices: [npu], workloads: [tooLarge] })[0],
    ).toMatchObject({ target: "cpu", fallbackReason: "model-memory" });
    expect(
      assignAcceleratorWorkloads({ devices: [npu], workloads: [smallBatch] })[0],
    ).toMatchObject({ target: "cpu", fallbackReason: "batch-size" });
    expect(
      assignAcceleratorWorkloads({ devices: [], workloads: [generalRender] })[0],
    ).toMatchObject({
      target: "cpu",
      fallbackReason: "no-compatible-accelerator",
    });
  });

  it("rejects duplicate devices and overlapping expansion slots", () => {
    expect(() =>
      normalizeInstalledAccelerators([
        gpu,
        { id: "gpu-b", slotId: 2, skuId: "gpuTensor24" },
      ]),
    ).toThrow(/slot 2/i);
    expect(() =>
      normalizeInstalledAccelerators([gpu, { ...npu, id: "gpu-a" }]),
    ).toThrow(/device id/i);
  });
});

describe("exact accelerator projections", () => {
  it("aggregates installed idle and active device power, heat, throughput, and costs", () => {
    const projection = projectInstalledAccelerators({
      devices: [npu, gpu],
      activeDeviceIds: ["gpu-a"],
    });
    expect(projection).toMatchObject({
      quantity: amount(2),
      activeQuantity: amount(1),
      powerWatts: amountAdd(170, 3),
      heatWatts: amountAdd(155, "2.5"),
      computeOperationsPerSecond: amount("4000000000"),
    });
    expect(projection.purchaseCosts).toEqual([
      { resource: "credits", amount: amount("1150000") },
      { resource: "data", amount: amount("560") },
    ]);
  });

  it("projects quantities beyond Number range without Infinity", () => {
    const quantity = amount("1e309");
    const activeQuantity = amountMultiply(quantity, "0.25");
    const idleQuantity = amountMultiply(quantity, "0.75");
    const projection = projectAcceleratorSkuFleet({
      skuId: "gpuRaster8",
      quantity,
      activeQuantity,
    });

    expect(projection.powerWatts).toBe(
      amountAdd(
        amountMultiply(170, activeQuantity),
        amountMultiply(18, idleQuantity),
      ),
    );
    expect(projection.heatWatts).toBe(
      amountAdd(
        amountMultiply(155, activeQuantity),
        amountMultiply(16, idleQuantity),
      ),
    );
    expect(projection.computeOperationsPerSecond).toBe(
      amountMultiply("4000000000", activeQuantity),
    );
    expect(projection.purchaseCosts).toEqual([
      {
        resource: "credits",
        amount: amountMultiply("500000", quantity),
      },
      {
        resource: "data",
        amount: amountMultiply("240", quantity),
      },
    ]);
  });
});
