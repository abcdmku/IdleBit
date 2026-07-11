import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountMin,
  amountMultiply,
  amountSubtract,
  type Amount,
  type ExactCost,
} from "./amount";
import {
  getAcceleratorSkuDefinition,
  type AcceleratorKind,
  type AcceleratorSkuDefinition,
  type AcceleratorSkuId,
  type AcceleratorWorkloadClass,
} from "./content/accelerators";

type AmountValue = Parameters<typeof amount>[0];

export interface InstalledAccelerator {
  id: string;
  /** One-based first expansion slot occupied by the device. */
  slotId: number;
  skuId: AcceleratorSkuId;
}

export interface AcceleratorWorkloadDemand {
  id: string;
  workloadClass: AcceleratorWorkloadClass;
  modelMemoryBits: Amount;
  batchSize: Amount;
  minimumComputeOperationsPerSecond: Amount;
  preferredKind: AcceleratorKind | null;
  cpuFallbackAllowed: boolean;
}

export type AcceleratorCompatibilityBlocker =
  | "workload-class"
  | "model-memory"
  | "batch-size"
  | "throughput";

export interface AcceleratorCompatibility {
  compatible: boolean;
  blockers: AcceleratorCompatibilityBlocker[];
}

export type AcceleratorFallbackReason =
  | "no-compatible-accelerator"
  | "model-memory"
  | "batch-size"
  | "throughput"
  | "accelerator-contention";

export type AcceleratorAssignment =
  | {
      workloadId: string;
      target: "accelerator";
      deviceId: string;
      slotId: number;
      skuId: AcceleratorSkuId;
      fallbackReason: null;
    }
  | {
      workloadId: string;
      target: "cpu" | "blocked";
      deviceId: null;
      slotId: null;
      skuId: null;
      fallbackReason: AcceleratorFallbackReason;
    };

export const createAcceleratorWorkloadDemand = (input: {
  id: string;
  workloadClass: AcceleratorWorkloadClass;
  modelMemoryBits?: AmountValue;
  batchSize?: AmountValue;
  minimumComputeOperationsPerSecond?: AmountValue;
  preferredKind?: AcceleratorKind | null;
  cpuFallbackAllowed?: boolean;
}): AcceleratorWorkloadDemand => ({
  id: input.id,
  workloadClass: input.workloadClass,
  modelMemoryBits: amountClampMin(input.modelMemoryBits ?? 0),
  batchSize: amountClampMin(input.batchSize ?? 1),
  minimumComputeOperationsPerSecond: amountClampMin(
    input.minimumComputeOperationsPerSecond ?? 0,
  ),
  preferredKind: input.preferredKind ?? null,
  cpuFallbackAllowed: input.cpuFallbackAllowed !== false,
});

const compareIds = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

const assertUniqueWorkloadIds = (
  workloads: readonly AcceleratorWorkloadDemand[],
) => {
  const seen = new Set<string>();
  for (const workload of workloads) {
    if (!workload.id || seen.has(workload.id)) {
      throw new Error(`Duplicate or empty accelerator workload id: ${workload.id}`);
    }
    seen.add(workload.id);
  }
};

const getOccupiedSlotIds = (device: InstalledAccelerator) => {
  const definition = getAcceleratorSkuDefinition(device.skuId);
  const firstSlotId = Math.max(1, Math.trunc(device.slotId));
  return Array.from(
    { length: definition.expansionSlots },
    (_, index) => firstSlotId + index,
  );
};

export const normalizeInstalledAccelerators = (
  devices: readonly InstalledAccelerator[],
): InstalledAccelerator[] => {
  const normalized = devices
    .map((device) => ({
      id: device.id,
      slotId: Math.max(1, Math.trunc(device.slotId)),
      skuId: device.skuId,
    }))
    .sort(
      (left, right) =>
        left.slotId - right.slotId || compareIds(left.id, right.id),
    );
  const deviceIds = new Set<string>();
  const occupiedSlots = new Map<number, string>();
  for (const device of normalized) {
    if (!device.id || deviceIds.has(device.id)) {
      throw new Error(`Duplicate or empty accelerator device id: ${device.id}`);
    }
    deviceIds.add(device.id);
    for (const slotId of getOccupiedSlotIds(device)) {
      const occupant = occupiedSlots.get(slotId);
      if (occupant) {
        throw new Error(
          `Accelerator slot ${slotId} is occupied by ${occupant} and ${device.id}`,
        );
      }
      occupiedSlots.set(slotId, device.id);
    }
  }
  return normalized;
};

export const getAcceleratorCompatibility = (
  definition: AcceleratorSkuDefinition,
  workload: AcceleratorWorkloadDemand,
): AcceleratorCompatibility => {
  const blockers: AcceleratorCompatibilityBlocker[] = [];
  if (!definition.supportedWorkloadClasses.includes(workload.workloadClass)) {
    blockers.push("workload-class");
  }
  if (amountCompare(workload.modelMemoryBits, definition.deviceMemoryBits) > 0) {
    blockers.push("model-memory");
  }
  if (amountCompare(workload.batchSize, definition.minimumBatchSize) < 0) {
    blockers.push("batch-size");
  }
  if (
    amountCompare(
      workload.minimumComputeOperationsPerSecond,
      definition.computeOperationsPerSecond,
    ) > 0
  ) {
    blockers.push("throughput");
  }
  return { compatible: blockers.length === 0, blockers };
};

const getCompatibleDevices = (
  devices: readonly InstalledAccelerator[],
  workload: AcceleratorWorkloadDemand,
) =>
  devices.filter((device) =>
    getAcceleratorCompatibility(
      getAcceleratorSkuDefinition(device.skuId),
      workload,
    ).compatible,
  );

const getFallbackReason = (
  devices: readonly InstalledAccelerator[],
  workload: AcceleratorWorkloadDemand,
): AcceleratorFallbackReason => {
  const definitions = devices.map((device) =>
    getAcceleratorSkuDefinition(device.skuId),
  );
  const classCompatible = definitions.filter((definition) =>
    definition.supportedWorkloadClasses.includes(workload.workloadClass),
  );
  if (classCompatible.length === 0) return "no-compatible-accelerator";

  const modelCompatible = classCompatible.filter(
    (definition) =>
      amountCompare(workload.modelMemoryBits, definition.deviceMemoryBits) <= 0,
  );
  if (modelCompatible.length === 0) return "model-memory";

  const batchCompatible = modelCompatible.filter(
    (definition) =>
      amountCompare(workload.batchSize, definition.minimumBatchSize) >= 0,
  );
  if (batchCompatible.length === 0) return "batch-size";

  const throughputCompatible = batchCompatible.filter(
    (definition) =>
      amountCompare(
        workload.minimumComputeOperationsPerSecond,
        definition.computeOperationsPerSecond,
      ) <= 0,
  );
  if (throughputCompatible.length === 0) return "throughput";
  return "accelerator-contention";
};

const compareWorkloadDifficulty = (
  devices: readonly InstalledAccelerator[],
  unavailableDeviceIds: ReadonlySet<string>,
  left: AcceleratorWorkloadDemand,
  right: AcceleratorWorkloadDemand,
) => {
  const availableDevices = devices.filter(
    (device) => !unavailableDeviceIds.has(device.id),
  );
  const leftCandidates = getCompatibleDevices(availableDevices, left).length;
  const rightCandidates = getCompatibleDevices(availableDevices, right).length;
  if (leftCandidates !== rightCandidates) return leftCandidates - rightCandidates;

  const throughputComparison = amountCompare(
    right.minimumComputeOperationsPerSecond,
    left.minimumComputeOperationsPerSecond,
  );
  if (throughputComparison !== 0) return throughputComparison;
  const memoryComparison = amountCompare(
    right.modelMemoryBits,
    left.modelMemoryBits,
  );
  if (memoryComparison !== 0) return memoryComparison;
  const batchComparison = amountCompare(right.batchSize, left.batchSize);
  if (batchComparison !== 0) return batchComparison;
  return compareIds(left.id, right.id);
};

const compareCandidateDevices = (
  workload: AcceleratorWorkloadDemand,
  left: InstalledAccelerator,
  right: InstalledAccelerator,
) => {
  const leftDefinition = getAcceleratorSkuDefinition(left.skuId);
  const rightDefinition = getAcceleratorSkuDefinition(right.skuId);
  const leftPreferred =
    workload.preferredKind === null || leftDefinition.kind === workload.preferredKind;
  const rightPreferred =
    workload.preferredKind === null || rightDefinition.kind === workload.preferredKind;
  if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;

  const leftMemoryHeadroom = amountSubtract(
    leftDefinition.deviceMemoryBits,
    workload.modelMemoryBits,
  );
  const rightMemoryHeadroom = amountSubtract(
    rightDefinition.deviceMemoryBits,
    workload.modelMemoryBits,
  );
  const memoryComparison = amountCompare(leftMemoryHeadroom, rightMemoryHeadroom);
  if (memoryComparison !== 0) return memoryComparison;

  const leftThroughputHeadroom = amountSubtract(
    leftDefinition.computeOperationsPerSecond,
    workload.minimumComputeOperationsPerSecond,
  );
  const rightThroughputHeadroom = amountSubtract(
    rightDefinition.computeOperationsPerSecond,
    workload.minimumComputeOperationsPerSecond,
  );
  const throughputComparison = amountCompare(
    leftThroughputHeadroom,
    rightThroughputHeadroom,
  );
  if (throughputComparison !== 0) return throughputComparison;
  return left.slotId - right.slotId || compareIds(left.id, right.id);
};

/**
 * Hardest demands claim best-fit devices first. A device serves at most one
 * operation, and the result is invariant to caller array ordering.
 */
export const assignAcceleratorWorkloads = (input: {
  devices: readonly InstalledAccelerator[];
  workloads: readonly AcceleratorWorkloadDemand[];
  busyDeviceIds?: Iterable<string>;
}): AcceleratorAssignment[] => {
  const devices = normalizeInstalledAccelerators(input.devices);
  assertUniqueWorkloadIds(input.workloads);
  const unavailableDeviceIds = new Set(input.busyDeviceIds ?? []);
  const workloadOrder = [...input.workloads].sort((left, right) =>
    compareWorkloadDifficulty(devices, unavailableDeviceIds, left, right),
  );
  const assignments: AcceleratorAssignment[] = [];

  for (const workload of workloadOrder) {
    const candidates = getCompatibleDevices(
      devices.filter((device) => !unavailableDeviceIds.has(device.id)),
      workload,
    ).sort((left, right) => compareCandidateDevices(workload, left, right));
    const selected = candidates[0];
    if (selected) {
      unavailableDeviceIds.add(selected.id);
      assignments.push({
        workloadId: workload.id,
        target: "accelerator",
        deviceId: selected.id,
        slotId: selected.slotId,
        skuId: selected.skuId,
        fallbackReason: null,
      });
      continue;
    }

    assignments.push({
      workloadId: workload.id,
      target: workload.cpuFallbackAllowed ? "cpu" : "blocked",
      deviceId: null,
      slotId: null,
      skuId: null,
      fallbackReason: getFallbackReason(devices, workload),
    });
  }

  return assignments.sort((left, right) =>
    compareIds(left.workloadId, right.workloadId),
  );
};

export const scaleExactCosts = (
  costs: readonly ExactCost[],
  quantity: AmountValue,
): ExactCost[] => {
  const scale = amountClampMin(quantity);
  return costs.map((cost) => ({
    resource: cost.resource,
    amount: amountMultiply(cost.amount, scale),
  }));
};

const combineExactCosts = (costs: readonly ExactCost[]): ExactCost[] =>
  (["credits", "data"] as const)
    .map((resource) => ({
      resource,
      amount: costs
        .filter((cost) => cost.resource === resource)
        .reduce(
          (total, cost) => amountAdd(total, cost.amount),
          ZERO_AMOUNT,
        ),
    }))
    .filter((cost) => amountCompare(cost.amount, 0) > 0);

export interface AcceleratorFleetProjection {
  quantity: Amount;
  activeQuantity: Amount;
  powerWatts: Amount;
  heatWatts: Amount;
  computeOperationsPerSecond: Amount;
  purchaseCosts: ExactCost[];
}

/** Exact aggregate projection that remains finite beyond Number range. */
export const projectAcceleratorSkuFleet = (input: {
  skuId: AcceleratorSkuId;
  quantity: AmountValue;
  activeQuantity?: AmountValue;
}): AcceleratorFleetProjection => {
  const definition = getAcceleratorSkuDefinition(input.skuId);
  const quantity = amountClampMin(input.quantity);
  const activeQuantity = amountMin(
    quantity,
    amountClampMin(input.activeQuantity ?? quantity),
  );
  const idleQuantity = amountSubtract(quantity, activeQuantity);
  return {
    quantity,
    activeQuantity,
    powerWatts: amountAdd(
      amountMultiply(definition.activePowerWatts, activeQuantity),
      amountMultiply(definition.idlePowerWatts, idleQuantity),
    ),
    heatWatts: amountAdd(
      amountMultiply(definition.activeHeatWatts, activeQuantity),
      amountMultiply(definition.idleHeatWatts, idleQuantity),
    ),
    computeOperationsPerSecond: amountMultiply(
      definition.computeOperationsPerSecond,
      activeQuantity,
    ),
    purchaseCosts: scaleExactCosts(definition.costs, quantity),
  };
};

export const projectInstalledAccelerators = (input: {
  devices: readonly InstalledAccelerator[];
  activeDeviceIds?: Iterable<string>;
}): AcceleratorFleetProjection => {
  const devices = normalizeInstalledAccelerators(input.devices);
  const activeDeviceIds = new Set(input.activeDeviceIds ?? []);
  let powerWatts = ZERO_AMOUNT;
  let heatWatts = ZERO_AMOUNT;
  let computeOperationsPerSecond = ZERO_AMOUNT;
  const costs: ExactCost[] = [];
  for (const device of devices) {
    const definition = getAcceleratorSkuDefinition(device.skuId);
    const active = activeDeviceIds.has(device.id);
    powerWatts = amountAdd(
      powerWatts,
      active ? definition.activePowerWatts : definition.idlePowerWatts,
    );
    heatWatts = amountAdd(
      heatWatts,
      active ? definition.activeHeatWatts : definition.idleHeatWatts,
    );
    if (active) {
      computeOperationsPerSecond = amountAdd(
        computeOperationsPerSecond,
        definition.computeOperationsPerSecond,
      );
    }
    costs.push(...definition.costs);
  }
  return {
    quantity: amount(devices.length),
    activeQuantity: amount(
      devices.filter((device) => activeDeviceIds.has(device.id)).length,
    ),
    powerWatts,
    heatWatts,
    computeOperationsPerSecond,
    purchaseCosts: combineExactCosts(costs),
  };
};
