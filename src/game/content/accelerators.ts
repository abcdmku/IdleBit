import {
  amount,
  type Amount,
  type ExactCost,
} from "../amount";
import { capacityCosts } from "../exactCosts";

export const acceleratorWorkloadClasses = [
  "render",
  "vector",
  "mlBatch",
  "inference",
] as const;

export type AcceleratorWorkloadClass =
  (typeof acceleratorWorkloadClasses)[number];
export type AcceleratorKind = "gpu" | "npu";
export type AcceleratorSkuId =
  | "gpuRaster8"
  | "gpuTensor24"
  | "npuEdge4"
  | "npuBatch16";

export interface AcceleratorSkuDefinition {
  id: AcceleratorSkuId;
  kind: AcceleratorKind;
  name: string;
  description: string;
  supportedWorkloadClasses: readonly AcceleratorWorkloadClass[];
  expansionSlots: number;
  deviceMemoryBits: Amount;
  minimumBatchSize: Amount;
  computeOperationsPerSecond: Amount;
  /** Relative compatible-operation rate; 10,000 is CPU fallback parity. */
  throughputMultiplierBps: number;
  idlePowerWatts: Amount;
  activePowerWatts: Amount;
  idleHeatWatts: Amount;
  activeHeatWatts: Amount;
  costs: readonly ExactCost[];
}

export const acceleratorSkuDefinitions: readonly AcceleratorSkuDefinition[] = [
  {
    id: "gpuRaster8",
    kind: "gpu",
    name: "Raster GPU 8",
    description: "An 8 GiB GPU for rendering, vector math, and compact ML batches.",
    supportedWorkloadClasses: ["render", "vector", "mlBatch"],
    expansionSlots: 2,
    deviceMemoryBits: amount("68719476736"),
    minimumBatchSize: amount(1),
    computeOperationsPerSecond: amount("4000000000"),
    throughputMultiplierBps: 40_000,
    idlePowerWatts: amount("18"),
    activePowerWatts: amount("170"),
    idleHeatWatts: amount("16"),
    activeHeatWatts: amount("155"),
    costs: capacityCosts("500000"),
  },
  {
    id: "gpuTensor24",
    kind: "gpu",
    name: "Tensor GPU 24",
    description: "A 24 GiB GPU for dense rendering, vector, and ML batch work.",
    supportedWorkloadClasses: ["render", "vector", "mlBatch"],
    expansionSlots: 2,
    deviceMemoryBits: amount("206158430208"),
    minimumBatchSize: amount(1),
    computeOperationsPerSecond: amount("12000000000"),
    throughputMultiplierBps: 80_000,
    idlePowerWatts: amount("35"),
    activePowerWatts: amount("320"),
    idleHeatWatts: amount("31"),
    activeHeatWatts: amount("295"),
    costs: capacityCosts("24000000"),
  },
  {
    id: "npuEdge4",
    kind: "npu",
    name: "Edge NPU 4",
    description: "A low-power 4 GiB NPU for fitted inference and ML batches.",
    supportedWorkloadClasses: ["inference", "mlBatch"],
    expansionSlots: 1,
    deviceMemoryBits: amount("34359738368"),
    minimumBatchSize: amount(8),
    computeOperationsPerSecond: amount("8000000000"),
    throughputMultiplierBps: 60_000,
    idlePowerWatts: amount("3"),
    activePowerWatts: amount("32"),
    idleHeatWatts: amount("2.5"),
    activeHeatWatts: amount("28"),
    costs: capacityCosts("650000"),
  },
  {
    id: "npuBatch16",
    kind: "npu",
    name: "Batch NPU 16",
    description: "A 16 GiB NPU for large fitted models and sustained batches.",
    supportedWorkloadClasses: ["inference", "mlBatch"],
    expansionSlots: 1,
    deviceMemoryBits: amount("137438953472"),
    // Inference Batch (the only authored inference workload) runs at batch
    // size 16; a 32 minimum made this SKU dead content (C-DES-12).
    minimumBatchSize: amount(16),
    computeOperationsPerSecond: amount("24000000000"),
    throughputMultiplierBps: 120_000,
    idlePowerWatts: amount("10"),
    activePowerWatts: amount("90"),
    idleHeatWatts: amount("8"),
    activeHeatWatts: amount("78"),
    costs: capacityCosts("36000000"),
  },
] as const;

const acceleratorById = new Map(
  acceleratorSkuDefinitions.map((definition) => [definition.id, definition]),
);

export const isAcceleratorWorkloadClass = (
  value: unknown,
): value is AcceleratorWorkloadClass =>
  typeof value === "string" &&
  acceleratorWorkloadClasses.includes(value as AcceleratorWorkloadClass);

export const isAcceleratorSkuId = (
  value: unknown,
): value is AcceleratorSkuId =>
  typeof value === "string" && acceleratorById.has(value as AcceleratorSkuId);

export const getAcceleratorSkuDefinition = (id: AcceleratorSkuId) =>
  acceleratorById.get(id)!;

export const getAcceleratorSkuDefinitionsForKind = (kind: AcceleratorKind) =>
  acceleratorSkuDefinitions.filter((definition) => definition.kind === kind);
