import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountMultiply,
  type Amount,
} from "./amount";
import {
  assignAcceleratorWorkloads,
  createAcceleratorWorkloadDemand,
  projectInstalledAccelerators,
  type AcceleratorAssignment,
  type InstalledAccelerator,
} from "./accelerators";
import {
  acceleratorSkuDefinitions,
  getAcceleratorSkuDefinition,
  isAcceleratorSkuId,
  type AcceleratorKind,
  type AcceleratorSkuId,
  type AcceleratorWorkloadClass,
} from "./content/accelerators";
import {
  applyCoolingHeatBuildup,
  applyOverclockHeat,
  applyOverclockPower,
  getOverclockBlockedReason,
  getOverclockPresetDefinition,
  getWorkshopCoolingState,
  getWorkshopCoolingTierDefinition,
  isOverclockPresetId,
  isWorkshopCoolingTierId,
  type OverclockPresetId,
  type WorkshopCoolingTierId,
} from "./content/cooling";
import { getTaskDefinition } from "./content/tasks";
import { canAffordExact, spendExact } from "./economy";
import {
  advanceThermal,
  createThermalState,
  deriveThermalSnapshot,
  getNextThermalEvent,
  normalizeThermalState,
  type ThermalEnvironment,
  type ThermalSnapshot,
  type ThermalStatus,
} from "./thermal";
import type {
  ActiveCoreOperation,
  ActiveTask,
  GameState,
  HardwareState,
  TaskId,
  WorkshopSpecializationEvidence,
  WorkshopSystemState,
} from "./types";
import {
  createWorkshopSystemState,
  DEFAULT_WORKSHOP_EXPANSION_SLOTS,
} from "./workshopState";
import {
  getWorkshopStoragePowerHeat,
  getWorkshopStorageSkuId,
  normalizeWorkshopStorageCompletionCount,
  normalizeWorkshopStorageWorkload,
} from "./workshopStorage";

export { createWorkshopSystemState } from "./workshopState";

export const WORKSHOP_THERMAL_RESPONSE_SECONDS = amount(20);

const thermalStatusRank: Record<ThermalStatus, number> = {
  off: 0,
  nominal: 1,
  warm: 2,
  hot: 3,
  critical: 4,
};

const isThermalStatus = (value: unknown): value is ThermalStatus =>
  value === "off" ||
  value === "nominal" ||
  value === "warm" ||
  value === "hot" ||
  value === "critical";

const finiteInteger = (value: unknown, fallback: number, minimum = 0) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.trunc(value))
    : fallback;

const defaultEvidence = (): WorkshopSpecializationEvidence => ({
  gpuRenderCompletions: 0,
  npuInferenceCompletions: 0,
});

const safeThermalState = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createThermalState();
  }
  const candidate = value as { elapsedMs?: unknown; sustainedHeatWatts?: unknown };
  try {
    return normalizeThermalState({
      elapsedMs: amountClampMin(candidate.elapsedMs as string | number),
      sustainedHeatWatts: amountClampMin(
        candidate.sustainedHeatWatts as string | number,
      ),
    });
  } catch {
    return createThermalState();
  }
};

const normalizeSavedAccelerators = (
  value: unknown,
  expansionSlots: number,
): InstalledAccelerator[] => {
  if (!Array.isArray(value)) return [];
  const candidates = value
    .filter(
      (candidate): candidate is Record<string, unknown> =>
        Boolean(candidate && typeof candidate === "object" && !Array.isArray(candidate)),
    )
    .map((candidate) => ({
      id: typeof candidate.id === "string" ? candidate.id : "",
      slotId: finiteInteger(candidate.slotId, 0),
      skuId: candidate.skuId,
    }))
    .filter(
      (candidate): candidate is InstalledAccelerator =>
        candidate.id.length > 0 &&
        candidate.slotId > 0 &&
        isAcceleratorSkuId(candidate.skuId),
    )
    .sort((left, right) =>
      left.slotId - right.slotId || left.id.localeCompare(right.id),
    );
  const accepted: InstalledAccelerator[] = [];
  const deviceIds = new Set<string>();
  const occupiedSlots = new Set<number>();
  for (const candidate of candidates) {
    const definition = getAcceleratorSkuDefinition(candidate.skuId);
    const slots = Array.from(
      { length: definition.expansionSlots },
      (_, index) => candidate.slotId + index,
    );
    if (
      deviceIds.has(candidate.id) ||
      slots.some(
        (slotId) => slotId > expansionSlots || occupiedSlots.has(slotId),
      )
    ) {
      continue;
    }
    deviceIds.add(candidate.id);
    slots.forEach((slotId) => occupiedSlots.add(slotId));
    accepted.push(candidate);
  }
  return accepted;
};

const getMaximumAcceleratorSequence = (devices: readonly InstalledAccelerator[]) =>
  devices.reduce((maximum, device) => {
    const match = /(?:^|-)accelerator-(\d+)$/.exec(device.id);
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0);

export const normalizeWorkshopSystemState = (
  value: unknown,
  hardware?: Partial<HardwareState>,
): WorkshopSystemState => {
  const fallback = createWorkshopSystemState(hardware);
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<WorkshopSystemState>)
      : {};
  const coolingTierId = isWorkshopCoolingTierId(candidate.coolingTierId)
    ? candidate.coolingTierId
    : fallback.coolingTierId;
  const requestedOverclock = isOverclockPresetId(candidate.overclockPresetId)
    ? candidate.overclockPresetId
    : fallback.overclockPresetId;
  const overclockPresetId =
    getOverclockBlockedReason(coolingTierId, requestedOverclock) === null
      ? requestedOverclock
      : "stock";
  const expansionSlots = Math.min(
    64,
    finiteInteger(
      candidate.expansionSlots,
      DEFAULT_WORKSHOP_EXPANSION_SLOTS,
      1,
    ),
  );
  const accelerators = normalizeSavedAccelerators(
    candidate.accelerators,
    expansionSlots,
  );
  const savedEvidence = candidate.evidence as
    | Partial<WorkshopSpecializationEvidence>
    | undefined;
  const evidence = {
    gpuRenderCompletions: finiteInteger(
      savedEvidence?.gpuRenderCompletions,
      0,
    ),
    npuInferenceCompletions: finiteInteger(
      savedEvidence?.npuInferenceCompletions,
      0,
    ),
  };
  const storageSkuId = getWorkshopStorageSkuId(candidate.storageSkuId);
  const completedStorageWorkloads = normalizeWorkshopStorageCompletionCount(
    candidate.completedStorageWorkloads,
  );
  return {
    thermal: safeThermalState(candidate.thermal),
    highestObservedThermalStatus: isThermalStatus(
      candidate.highestObservedThermalStatus,
    )
      ? candidate.highestObservedThermalStatus
      : fallback.highestObservedThermalStatus,
    coolingTierId,
    overclockPresetId,
    expansionSlots,
    accelerators,
    nextAcceleratorId: Math.max(
      finiteInteger(candidate.nextAcceleratorId, 1, 1),
      getMaximumAcceleratorSequence(accelerators) + 1,
    ),
    storageSkuId,
    activeStorageWorkload:
      completedStorageWorkloads > 0
        ? null
        : normalizeWorkshopStorageWorkload(
            candidate.activeStorageWorkload,
            { storageSkuId },
          ),
    completedStorageWorkloads,
    evidence,
  };
};

export const syncWorkshopHardwareProjection = (
  hardware: HardwareState,
  workshop: WorkshopSystemState,
): HardwareState => {
  const cooling = getWorkshopCoolingTierDefinition(workshop.coolingTierId);
  return {
    ...hardware,
    coolingLevel: cooling.level,
    coolingRating: cooling.level <= 0 ? 0 : 1 + (cooling.level - 1) * 0.28,
  };
};

export const isWorkshopThermalVisible = (state: GameState) =>
  (state.completedTasks.thermalProbe ?? state.completedJobs.thermalProbe ?? 0) > 0 ||
  state.activeTasks.some((task) => task.taskId === "thermalProbe") ||
  state.queue.includes("thermalProbe") ||
  state.research.completed.includes("thermalControl") ||
  state.flags.cooling;

export const isWorkshopThermalControlsUnlocked = (state: GameState) =>
  state.flags.cooling || state.research.completed.includes("thermalControl");

export const isWorkshopSpecializedComputeUnlocked = (state: GameState) =>
  state.flags.specializedCompute ||
  state.research.completed.includes("specializedCompute");

export interface WorkshopAcceleratorRoute {
  workloadId: string;
  taskInstanceId: string;
  taskId: TaskId;
  coreId: number;
  operationIndex: number;
  operationId: string;
  workloadClass: AcceleratorWorkloadClass;
  assignment: AcceleratorAssignment;
  acceleratorKind: AcceleratorKind | null;
  throughputMultiplierBps: number;
}

const workloadIdForOperation = (
  task: ActiveTask,
  operation: ActiveCoreOperation,
) =>
  [
    task.instanceId,
    operation.coreId,
    operation.workUnitIndex ?? "main",
    operation.operationIndex,
  ].join(":");

const safeDemandNumber = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) ? Math.max(0, value ?? fallback) : fallback;

export const getWorkshopAcceleratorRoutes = (
  state: GameState,
): WorkshopAcceleratorRoute[] => {
  const metadata = new Map<
    string,
    Omit<WorkshopAcceleratorRoute, "assignment" | "acceleratorKind" | "throughputMultiplierBps">
  >();
  const workloads = state.activeTasks.flatMap((task) => {
    const definition = getTaskDefinition(task.taskId);
    return task.coreOperations.flatMap((runtime) => {
      const operation = definition.operations[runtime.operationIndex];
      if (runtime.status !== "running" || !operation?.acceleratorClass) return [];
      const workloadId = workloadIdForOperation(task, runtime);
      metadata.set(workloadId, {
        workloadId,
        taskInstanceId: task.instanceId,
        taskId: task.taskId,
        coreId: runtime.coreId,
        operationIndex: runtime.operationIndex,
        operationId: operation.id,
        workloadClass: operation.acceleratorClass,
      });
      return [
        createAcceleratorWorkloadDemand({
          id: workloadId,
          workloadClass: operation.acceleratorClass,
          modelMemoryBits: safeDemandNumber(
            operation.acceleratorModelMemoryBits,
            0,
          ),
          batchSize: safeDemandNumber(operation.acceleratorBatchSize, 1),
          minimumComputeOperationsPerSecond: safeDemandNumber(
            operation.acceleratorMinimumComputeOperationsPerSecond,
            0,
          ),
          preferredKind: operation.acceleratorPreferredKind ?? null,
          cpuFallbackAllowed: true,
        }),
      ];
    });
  });
  const assignments = assignAcceleratorWorkloads({
    devices: state.workshop.accelerators,
    workloads,
  });
  return assignments.flatMap((assignment) => {
    const item = metadata.get(assignment.workloadId);
    if (!item) return [];
    const definition =
      assignment.target === "accelerator"
        ? getAcceleratorSkuDefinition(assignment.skuId)
        : null;
    return [
      {
        ...item,
        assignment,
        acceleratorKind: definition?.kind ?? null,
        throughputMultiplierBps: definition?.throughputMultiplierBps ?? 10_000,
      },
    ];
  });
};

export const getWorkshopRouteForOperation = (
  state: GameState,
  task: ActiveTask,
  operation: ActiveCoreOperation,
) =>
  getWorkshopAcceleratorRoutes(state).find(
    (route) => route.workloadId === workloadIdForOperation(task, operation),
  ) ?? null;

export const getWorkshopActiveAcceleratorDeviceIds = (state: GameState) =>
  getWorkshopAcceleratorRoutes(state).flatMap((route) =>
    route.assignment.target === "accelerator"
      ? [route.assignment.deviceId]
      : [],
  );

export interface WorkshopPowerProjection {
  baseHardwarePowerWatts: Amount;
  overclockedHardwarePowerWatts: Amount;
  coolingPowerWatts: Amount;
  acceleratorPowerWatts: Amount;
  storagePowerWatts: Amount;
  storageHeatWatts: Amount;
  totalPowerWatts: Amount;
  generatedHeatWatts: Amount;
  coolingCapacityWatts: Amount;
}

export const projectWorkshopSystemPower = (
  state: GameState,
  baseHardwarePowerWatts: Amount | string | number,
): WorkshopPowerProjection => {
  const powered = state.power.state !== "off";
  const basePower = powered
    ? amountClampMin(baseHardwarePowerWatts)
    : ZERO_AMOUNT;
  const overclockedHardwarePowerWatts = powered
    ? applyOverclockPower(basePower, state.workshop.overclockPresetId)
    : ZERO_AMOUNT;
  const cooling = getWorkshopCoolingState(state.workshop.coolingTierId);
  const coolingPowerWatts = powered ? cooling.powerDrawWatts : ZERO_AMOUNT;
  const acceleratorProjection = powered
    ? projectInstalledAccelerators({
        devices: state.workshop.accelerators,
        activeDeviceIds: getWorkshopActiveAcceleratorDeviceIds(state),
      })
    : {
        powerWatts: ZERO_AMOUNT,
        heatWatts: ZERO_AMOUNT,
      };
  const storageProjection = powered
    ? getWorkshopStoragePowerHeat(state.workshop)
    : {
        powerWatts: ZERO_AMOUNT,
        heatWatts: ZERO_AMOUNT,
      };
  const hardwareHeatWatts = powered
    ? applyOverclockHeat(
        amountMultiply(basePower, "0.9"),
        state.workshop.overclockPresetId,
      )
    : ZERO_AMOUNT;
  const generatedHeatWatts = applyCoolingHeatBuildup(
    amountAdd(
      amountAdd(hardwareHeatWatts, acceleratorProjection.heatWatts),
      storageProjection.heatWatts,
    ),
    state.workshop.coolingTierId,
  );
  return {
    baseHardwarePowerWatts: basePower,
    overclockedHardwarePowerWatts,
    coolingPowerWatts,
    acceleratorPowerWatts: acceleratorProjection.powerWatts,
    storagePowerWatts: storageProjection.powerWatts,
    storageHeatWatts: storageProjection.heatWatts,
    totalPowerWatts: amountAdd(
      amountAdd(
        amountAdd(overclockedHardwarePowerWatts, coolingPowerWatts),
        acceleratorProjection.powerWatts,
      ),
      storageProjection.powerWatts,
    ),
    generatedHeatWatts,
    coolingCapacityWatts: cooling.capacityWatts,
  };
};

export const getWorkshopThermalEnvironment = (
  state: GameState,
  baseHardwarePowerWatts: Amount | string | number,
): ThermalEnvironment => {
  const projection = projectWorkshopSystemPower(
    state,
    baseHardwarePowerWatts,
  );
  const tracking = isWorkshopThermalVisible(state);
  const generatedHeatWatts = tracking
    ? projection.generatedHeatWatts
    : ZERO_AMOUNT;
  return {
    powered: state.power.state !== "off",
    components: [
      {
        id: "workshop-system",
        idleHeatWatts: generatedHeatWatts,
        activeHeatWatts: generatedHeatWatts,
        utilizationBps: 10_000,
      },
    ],
    cooling: getWorkshopCoolingState(state.workshop.coolingTierId),
    responseSeconds: WORKSHOP_THERMAL_RESPONSE_SECONDS,
  };
};

export const deriveWorkshopThermalSnapshot = (
  state: GameState,
  baseHardwarePowerWatts: Amount | string | number,
): ThermalSnapshot =>
  deriveThermalSnapshot(
    state.workshop.thermal,
    getWorkshopThermalEnvironment(state, baseHardwarePowerWatts),
  );

/** A constant rate is used for the full interval between exact status events. */
export const getThermalStatusThroughputModifierBps = (
  status: ThermalStatus,
) => {
  if (status === "off") return 0;
  if (status === "hot") return 8_500;
  if (status === "critical") return 2_500;
  return 10_000;
};

export const getWorkshopThermalThroughputModifierBps = (
  state: GameState,
  baseHardwarePowerWatts: Amount | string | number,
) =>
  isWorkshopThermalVisible(state)
    ? getThermalStatusThroughputModifierBps(
        deriveWorkshopThermalSnapshot(state, baseHardwarePowerWatts).status,
      )
    : 10_000;

export const getNextWorkshopThermalEventMs = (
  state: GameState,
  baseHardwarePowerWatts: Amount | string | number,
) => {
  if (!isWorkshopThermalVisible(state)) return null;
  const environment = getWorkshopThermalEnvironment(
    state,
    baseHardwarePowerWatts,
  );
  const projection = projectWorkshopSystemPower(
    state,
    baseHardwarePowerWatts,
  );
  if (
    amountCompare(environment.cooling.capacityWatts, 0) === 0 &&
    amountCompare(state.workshop.thermal.sustainedHeatWatts, 0) === 0 &&
    amountCompare(projection.generatedHeatWatts, 0) > 0
  ) {
    return ZERO_AMOUNT;
  }
  return getNextThermalEvent(state.workshop.thermal, environment)?.afterMs ?? null;
};

const higherThermalStatus = (
  left: ThermalStatus,
  right: ThermalStatus,
) => (thermalStatusRank[right] > thermalStatusRank[left] ? right : left);

export const advanceWorkshopThermal = (
  state: GameState,
  baseHardwarePowerWatts: Amount | string | number,
  deltaMs: number,
  environmentOverride?: ThermalEnvironment,
): GameState => {
  if (!isWorkshopThermalVisible(state)) return state;
  const result = advanceThermal(
    state.workshop.thermal,
    environmentOverride ??
      getWorkshopThermalEnvironment(state, baseHardwarePowerWatts),
    Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0),
  );
  return {
    ...state,
    workshop: {
      ...state.workshop,
      thermal: result.state,
      highestObservedThermalStatus: higherThermalStatus(
        state.workshop.highestObservedThermalStatus,
        result.snapshot.status,
      ),
    },
  };
};

export const hasChangingWorkshopThermal = (
  state: GameState,
  baseHardwarePowerWatts: Amount | string | number,
) => getNextWorkshopThermalEventMs(state, baseHardwarePowerWatts) !== null;

export const hasObservedWorkshopHeat = (state: GameState) =>
  state.systems.some(
    (system) =>
      thermalStatusRank[system.workshop.highestObservedThermalStatus] >=
      thermalStatusRank.warm,
  );

export const getCoolingInstallBlockedReason = (
  state: GameState,
  tierId: WorkshopCoolingTierId,
) => {
  if (!isWorkshopThermalControlsUnlocked(state)) {
    return "Requires Thermal Control research.";
  }
  const current = getWorkshopCoolingTierDefinition(
    state.workshop.coolingTierId,
  );
  const requested = getWorkshopCoolingTierDefinition(tierId);
  if (requested.level <= current.level) {
    return requested.level === current.level
      ? "Cooling tier is already installed."
      : "Installed cooling cannot be downgraded.";
  }
  const installedAcceleratorPower = projectInstalledAccelerators({
    devices: state.workshop.accelerators,
    activeDeviceIds: [],
  }).powerWatts;
  if (
    amountCompare(
      amountAdd(installedAcceleratorPower, requested.powerDrawWatts),
      state.hardware.psuWatts,
    ) > 0
  ) {
    return "PSU capacity is too low for this cooling tier.";
  }
  return canAffordExact(state, requested.costs)
    ? null
    : "Insufficient Credits or Data.";
};

export const installWorkshopCoolingTier = (
  state: GameState,
  tierId: WorkshopCoolingTierId,
) => {
  if (getCoolingInstallBlockedReason(state, tierId) !== null) return state;
  const definition = getWorkshopCoolingTierDefinition(tierId);
  const purchased = spendExact(state, definition.costs);
  const workshop = { ...purchased.workshop, coolingTierId: tierId };
  return {
    ...purchased,
    workshop,
    hardware: syncWorkshopHardwareProjection(purchased.hardware, workshop),
  };
};

export const getOverclockSelectionBlockedReason = (
  state: GameState,
  presetId: OverclockPresetId,
) => {
  if (!isWorkshopThermalControlsUnlocked(state)) {
    return "Requires Thermal Control research.";
  }
  if (state.workshop.overclockPresetId === presetId) {
    return "Overclock preset is already selected.";
  }
  return getOverclockBlockedReason(state.workshop.coolingTierId, presetId);
};

export const selectWorkshopOverclockPreset = (
  state: GameState,
  presetId: OverclockPresetId,
) =>
  getOverclockSelectionBlockedReason(state, presetId) === null
    ? {
        ...state,
        workshop: { ...state.workshop, overclockPresetId: presetId },
      }
    : state;

const occupiedExpansionSlots = (state: WorkshopSystemState) => {
  const occupied = new Set<number>();
  for (const device of state.accelerators) {
    const definition = getAcceleratorSkuDefinition(device.skuId);
    for (let offset = 0; offset < definition.expansionSlots; offset += 1) {
      occupied.add(device.slotId + offset);
    }
  }
  return occupied;
};

export const findAcceleratorInstallSlot = (
  workshop: WorkshopSystemState,
  skuId: AcceleratorSkuId,
  requestedSlotId?: number,
) => {
  const definition = getAcceleratorSkuDefinition(skuId);
  const occupied = occupiedExpansionSlots(workshop);
  const slotFits = (slotId: number) =>
    slotId >= 1 &&
    slotId + definition.expansionSlots - 1 <= workshop.expansionSlots &&
    Array.from(
      { length: definition.expansionSlots },
      (_, index) => slotId + index,
    ).every((candidate) => !occupied.has(candidate));
  if (requestedSlotId !== undefined) {
    const normalized = finiteInteger(requestedSlotId, 0);
    return slotFits(normalized) ? normalized : null;
  }
  for (let slotId = 1; slotId <= workshop.expansionSlots; slotId += 1) {
    if (slotFits(slotId)) return slotId;
  }
  return null;
};

export const getAcceleratorInstallBlockedReason = (
  state: GameState,
  skuId: AcceleratorSkuId,
  slotId?: number,
) => {
  if (!isWorkshopSpecializedComputeUnlocked(state)) {
    return "Requires Specialized Compute research.";
  }
  if (
    (skuId === "gpuTensor24" || skuId === "npuBatch16") &&
    !state.projects.completedProjectIds.includes("openFoundry")
  ) {
    return "Complete Open Foundry to unlock advanced accelerator modules.";
  }
  if (findAcceleratorInstallSlot(state.workshop, skuId, slotId) === null) {
    return "No compatible expansion slots are available.";
  }
  const proposedDevices = [
    ...state.workshop.accelerators,
    {
      id: "workshop-install-projection",
      slotId:
        findAcceleratorInstallSlot(state.workshop, skuId, slotId) ?? 1,
      skuId,
    },
  ];
  const auxiliaryPower = amountAdd(
    projectInstalledAccelerators({
      devices: proposedDevices,
      activeDeviceIds: [],
    }).powerWatts,
    getWorkshopCoolingState(state.workshop.coolingTierId).powerDrawWatts,
  );
  if (amountCompare(auxiliaryPower, state.hardware.psuWatts) > 0) {
    return "PSU capacity is too low for this accelerator.";
  }
  return canAffordExact(state, getAcceleratorSkuDefinition(skuId).costs)
    ? null
    : "Insufficient Credits or Data.";
};

export const installWorkshopAccelerator = (
  state: GameState,
  skuId: AcceleratorSkuId,
  requestedSlotId?: number,
) => {
  if (
    getAcceleratorInstallBlockedReason(state, skuId, requestedSlotId) !== null
  ) {
    return state;
  }
  const slotId = findAcceleratorInstallSlot(
    state.workshop,
    skuId,
    requestedSlotId,
  );
  if (slotId === null) return state;
  const purchased = spendExact(
    state,
    getAcceleratorSkuDefinition(skuId).costs,
  );
  const id = `system-${state.selectedSystemId}-accelerator-${state.workshop.nextAcceleratorId}`;
  return {
    ...purchased,
    workshop: {
      ...purchased.workshop,
      accelerators: [
        ...purchased.workshop.accelerators,
        { id, slotId, skuId },
      ],
      nextAcceleratorId: purchased.workshop.nextAcceleratorId + 1,
    },
  };
};

export const removeWorkshopAccelerator = (
  state: GameState,
  deviceId: string,
) => {
  if (!state.workshop.accelerators.some((device) => device.id === deviceId)) {
    return state;
  }
  return {
    ...state,
    workshop: {
      ...state.workshop,
      accelerators: state.workshop.accelerators.filter(
        (device) => device.id !== deviceId,
      ),
    },
  };
};

export const recordWorkshopCompletionEvidence = (
  state: GameState,
  taskId: TaskId,
  acceleratorKindsUsed: readonly AcceleratorKind[] = [],
) => {
  const used = new Set(acceleratorKindsUsed);
  const gpuRender = taskId === "renderFrame" && used.has("gpu");
  const npuInference = taskId === "inferenceBatch" && used.has("npu");
  if (!gpuRender && !npuInference) return state;
  return {
    ...state,
    workshop: {
      ...state.workshop,
      evidence: {
        gpuRenderCompletions:
          state.workshop.evidence.gpuRenderCompletions + (gpuRender ? 1 : 0),
        npuInferenceCompletions:
          state.workshop.evidence.npuInferenceCompletions +
          (npuInference ? 1 : 0),
      },
    },
  };
};

export const hasWorkshopSpecializationProof = (state: GameState) => {
  const evidence = state.systems.reduce(
    (total, system) => ({
      gpuRenderCompletions:
        total.gpuRenderCompletions + system.workshop.evidence.gpuRenderCompletions,
      npuInferenceCompletions:
        total.npuInferenceCompletions +
        system.workshop.evidence.npuInferenceCompletions,
    }),
    defaultEvidence(),
  );
  return evidence.gpuRenderCompletions > 0 && evidence.npuInferenceCompletions > 0;
};

export const getWorkshopAcceleratorSkuDefinitions = () =>
  acceleratorSkuDefinitions;

export const getWorkshopOverclockPreset = (state: GameState) =>
  getOverclockPresetDefinition(state.workshop.overclockPresetId);
