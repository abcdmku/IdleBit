import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountDivide,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  exactResourceBag,
  type Amount,
} from "./amount";
import {
  advanceCapacityWork,
  createCapacityWorkRuntime,
  getCapacityWorkBlockers,
  getNextCapacityWorkEventMs,
  normalizeCapacityWorkRuntime,
  type CapacityWorkPlan,
} from "./capacityWork";
import { projectInstalledAccelerators } from "./accelerators";
import { getWorkshopCoolingState } from "./content/cooling";
import { addExactRewards, canAffordExact, spendExact } from "./economy";
import {
  getStorageSkuDefinition,
  isStorageSkuId,
  storageSkuDefinitions,
} from "./infrastructureDefinitions";
import { createRateVector, exactRateResourceIds } from "./weightedFair";
import {
  createWorkValueMultiplier,
  getWorkValueCredits,
  sumPaidWorkUnits,
} from "./workValue";
import type {
  GameState,
  WorkshopStorageWorkloadId,
  WorkshopStorageWorkloadState,
  WorkshopSystemState,
} from "./types";
import type { StorageSkuId } from "./infrastructureTypes";

const STORAGE_HEAT_FACTOR = amount("0.85");

const ARTIFACT_STAGING_READ_WORK = amount("24000000000");
const ARTIFACT_STAGING_WRITE_WORK = amount("12000000000");
export const WORKSHOP_STORAGE_PAID_WORK_UNITS = sumPaidWorkUnits([
  ARTIFACT_STAGING_READ_WORK,
  ARTIFACT_STAGING_WRITE_WORK,
]);
export const WORKSHOP_STORAGE_SERVICE_VALUE_MULTIPLIER =
  createWorkValueMultiplier("workshop-storage-proof", 21);

const artifactStagingPlan: CapacityWorkPlan = {
  id: "workshop-artifact-staging",
  work: createRateVector({
    storageRead: ARTIFACT_STAGING_READ_WORK,
    storageWrite: ARTIFACT_STAGING_WRITE_WORK,
  }),
  memoryBits: ZERO_AMOUNT,
  storageBits: amount("64000000000"),
  reward: exactResourceBag(
    getWorkValueCredits(
      WORKSHOP_STORAGE_PAID_WORK_UNITS,
      WORKSHOP_STORAGE_SERVICE_VALUE_MULTIPLIER,
    ),
    "64",
  ),
};

export interface WorkshopStorageWorkloadDefinition {
  id: WorkshopStorageWorkloadId;
  name: string;
  description: string;
  plan: CapacityWorkPlan;
}

export const workshopStorageWorkloadDefinition: WorkshopStorageWorkloadDefinition = {
  id: "artifactStaging",
  name: "Artifact Staging Pass",
  description:
    "Read source artifacts and write a verified local staging set through the installed storage path.",
  plan: artifactStagingPlan,
};

const safeAmount = (value: unknown) => {
  try {
    return amountClampMin(value as string | number);
  } catch {
    return ZERO_AMOUNT;
  }
};

const safeInteger = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : fallback;

const storageFitCapacity = (
  workshop: Pick<WorkshopSystemState, "storageSkuId">,
) => ({
  memoryBits: ZERO_AMOUNT,
  storageBits: getStorageSkuDefinition(workshop.storageSkuId).profile.storageBits,
});

const storageRates = (workshop: Pick<WorkshopSystemState, "storageSkuId">) => {
  const profile = getStorageSkuDefinition(workshop.storageSkuId).profile;
  return createRateVector({
    storageRead: profile.rates.storageRead,
    storageWrite: profile.rates.storageWrite,
  });
};

export const normalizeWorkshopStorageWorkload = (
  value: unknown,
  workshop: Pick<WorkshopSystemState, "storageSkuId">,
): WorkshopStorageWorkloadState | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<WorkshopStorageWorkloadState>;
  if (candidate.definitionId !== workshopStorageWorkloadDefinition.id) return null;
  const savedRuntime =
    candidate.runtime && typeof candidate.runtime === "object"
      ? candidate.runtime
      : createCapacityWorkRuntime(artifactStagingPlan);
  try {
    const runtime = normalizeCapacityWorkRuntime({
      ...createCapacityWorkRuntime(artifactStagingPlan),
      ...savedRuntime,
      plan: artifactStagingPlan,
      elapsedMs: safeAmount(savedRuntime.elapsedMs),
      remainingWork: createRateVector(savedRuntime.remainingWork),
      blockers: Array.isArray(savedRuntime.blockers) ? savedRuntime.blockers : [],
      completed: savedRuntime.completed === true,
      rewardIssued: savedRuntime.rewardIssued === true,
    });
    if (runtime.rewardIssued) return null;
    return {
      definitionId: workshopStorageWorkloadDefinition.id,
      runtime: {
        ...runtime,
        blockers: getCapacityWorkBlockers(
          runtime,
          storageRates(workshop),
          storageFitCapacity(workshop),
        ),
      },
      operatingCreditsSpent: safeAmount(candidate.operatingCreditsSpent),
    };
  } catch {
    return null;
  }
};

export const getWorkshopStorageSkuId = (value: unknown): StorageSkuId =>
  isStorageSkuId(value) ? value : "storageNone";

export const normalizeWorkshopStorageCompletionCount = (value: unknown) =>
  safeInteger(value);

export const isWorkshopStorageUnlocked = (state: GameState) =>
  state.flags.systemCatalog || state.research.completed.includes("systemCatalog");

export const getWorkshopStoragePowerHeat = (
  workshop: Pick<WorkshopSystemState, "storageSkuId" | "activeStorageWorkload">,
  skuId: StorageSkuId = workshop.storageSkuId,
) => {
  const profile = getStorageSkuDefinition(skuId).profile;
  const active = workshop.activeStorageWorkload !== null;
  const powerWatts = active ? profile.peakWatts : profile.idleWatts;
  return {
    powerWatts,
    heatWatts: amountMultiply(powerWatts, STORAGE_HEAT_FACTOR),
    idleHeatWatts: amountMultiply(profile.idleWatts, STORAGE_HEAT_FACTOR),
    peakHeatWatts: amountMultiply(profile.peakWatts, STORAGE_HEAT_FACTOR),
  };
};

const getStorageInstallAuxiliaryPeakWatts = (
  state: GameState,
  skuId: StorageSkuId,
) =>
  amountAdd(
    amountAdd(
      getStorageSkuDefinition(skuId).profile.peakWatts,
      getWorkshopCoolingState(state.workshop.coolingTierId).powerDrawWatts,
    ),
    projectInstalledAccelerators({
      devices: state.workshop.accelerators,
      activeDeviceIds: state.workshop.accelerators.map((device) => device.id),
    }).powerWatts,
  );

export const getWorkshopStorageInstallBlockedReason = (
  state: GameState,
  skuId: StorageSkuId,
) => {
  if (!isWorkshopStorageUnlocked(state)) return "Requires System Catalog research.";
  if (state.workshop.storageSkuId === skuId) return "Already installed.";
  if (state.workshop.activeStorageWorkload) {
    return "Finish or cancel active storage work before changing the device.";
  }
  const candidatePeak = getStorageSkuDefinition(skuId).profile.peakWatts;
  const currentPeak = getStorageSkuDefinition(
    state.workshop.storageSkuId,
  ).profile.peakWatts;
  if (
    amountCompare(candidatePeak, currentPeak) > 0 &&
    amountCompare(getStorageInstallAuxiliaryPeakWatts(state, skuId), state.hardware.psuWatts) > 0
  ) {
    return "PSU capacity is too low for this storage path at peak draw.";
  }
  return canAffordExact(state, getStorageSkuDefinition(skuId).costs)
    ? null
    : "Insufficient Credits or Data.";
};

export const installWorkshopStorage = (
  state: GameState,
  skuId: StorageSkuId,
): GameState => {
  if (!isStorageSkuId(skuId) || getWorkshopStorageInstallBlockedReason(state, skuId)) {
    return state;
  }
  const purchased = spendExact(state, getStorageSkuDefinition(skuId).costs);
  const systemId = purchased.selectedSystemId;
  return {
    ...purchased,
    workshop: {
      ...purchased.workshop,
      storageSkuId: skuId,
    },
    infrastructure: {
      ...purchased.infrastructure,
      fleetNodes: purchased.infrastructure.fleetNodes.map((node) =>
        node.source.kind === "system" && node.source.systemId === systemId
          ? { ...node, storageSkuId: skuId }
          : node,
      ),
    },
  };
};

export const getWorkshopStorageWorkloadBlockedReason = (state: GameState) => {
  if (!isWorkshopStorageUnlocked(state)) return "Requires System Catalog research.";
  if (state.workshop.completedStorageWorkloads > 0) {
    return "Artifact staging proof complete.";
  }
  if (state.workshop.activeStorageWorkload) return "Storage work is already active.";
  if (state.power.state !== "on") return "System must be powered on.";
  const runtime = createCapacityWorkRuntime(artifactStagingPlan);
  const blockers = getCapacityWorkBlockers(
    runtime,
    storageRates(state.workshop),
    storageFitCapacity(state.workshop),
  );
  if (blockers.includes("storage-fit")) return "Installed storage capacity is too low.";
  if (blockers.includes("rate:storageRead")) return "Installed storage has no read path.";
  if (blockers.includes("rate:storageWrite")) return "Installed storage has no write path.";
  return null;
};

export const startWorkshopStorageWorkload = (
  state: GameState,
  workloadId: WorkshopStorageWorkloadId,
): GameState => {
  if (
    workloadId !== workshopStorageWorkloadDefinition.id ||
    getWorkshopStorageWorkloadBlockedReason(state)
  ) {
    return state;
  }
  return {
    ...state,
    workshop: {
      ...state.workshop,
      activeStorageWorkload: {
        definitionId: workshopStorageWorkloadDefinition.id,
        runtime: createCapacityWorkRuntime(artifactStagingPlan),
        operatingCreditsSpent: ZERO_AMOUNT,
      },
    },
  };
};

export const cancelWorkshopStorageWorkload = (state: GameState): GameState =>
  state.workshop.activeStorageWorkload
    ? {
        ...state,
        workshop: { ...state.workshop, activeStorageWorkload: null },
      }
    : state;

export const getWorkshopStorageWorkloadDurationMs = (
  workshop: WorkshopSystemState,
): Amount | null => {
  let runtime =
    workshop.activeStorageWorkload?.runtime ??
    createCapacityWorkRuntime(artifactStagingPlan);
  const rates = storageRates(workshop);
  const fitCapacity = storageFitCapacity(workshop);
  let durationMs = ZERO_AMOUNT;
  for (let guard = 0; guard < 16; guard += 1) {
    if (runtime.rewardIssued) return durationMs;
    const eventMs = getNextCapacityWorkEventMs(runtime, rates, fitCapacity);
    if (eventMs === null) return null;
    const result = advanceCapacityWork(runtime, rates, fitCapacity, eventMs);
    runtime = result.runtime;
    durationMs = amountAdd(durationMs, eventMs);
    if (amountCompare(eventMs, 0) === 0 && !result.completed) return null;
  }
  return null;
};

export const getWorkshopStorageWorkloadProgressBps = (
  workshop: WorkshopSystemState,
) => {
  if (workshop.completedStorageWorkloads > 0) return 10_000;
  const runtime = workshop.activeStorageWorkload?.runtime;
  if (!runtime) return 0;
  const total = exactRateResourceIds.reduce(
    (sum, resource) => amountAdd(sum, runtime.plan.work[resource]),
    ZERO_AMOUNT,
  );
  const remaining = exactRateResourceIds.reduce(
    (sum, resource) => amountAdd(sum, runtime.remainingWork[resource]),
    ZERO_AMOUNT,
  );
  if (amountCompare(total, 0) <= 0) return 10_000;
  return Math.max(
    0,
    Math.min(
      10_000,
      Math.round(
        amountToSafeNumber(
          amountMultiply(amountDivide(amountSubtract(total, remaining), total), 10_000),
        ),
      ),
    ),
  );
};

export const getNextWorkshopStorageEventMs = (state: GameState): Amount | null => {
  const active = state.workshop.activeStorageWorkload;
  if (!active || (state.power.state !== "on" && state.power.state !== "shuttingDown")) {
    return null;
  }
  return getNextCapacityWorkEventMs(
    active.runtime,
    storageRates(state.workshop),
    storageFitCapacity(state.workshop),
  );
};

export const advanceWorkshopStorageWorkload = (
  state: GameState,
  elapsedMs: Amount | string | number,
): GameState => {
  const active = state.workshop.activeStorageWorkload;
  if (!active || (state.power.state !== "on" && state.power.state !== "shuttingDown")) {
    return state;
  }
  const result = advanceCapacityWork(
    active.runtime,
    storageRates(state.workshop),
    storageFitCapacity(state.workshop),
    elapsedMs,
  );
  const storagePower = getWorkshopStoragePowerHeat(state.workshop).powerWatts;
  const operatingCredits = amountMultiply(
    amountMultiply(storagePower, "1000000"),
    amountDivide(result.advancedMs, 1000),
  );
  const next: GameState = {
    ...state,
    workshop: {
      ...state.workshop,
      activeStorageWorkload: result.completed
        ? null
        : {
            ...active,
            runtime: result.runtime,
            operatingCreditsSpent: amountAdd(
              active.operatingCreditsSpent,
              operatingCredits,
            ),
          },
      completedStorageWorkloads:
        state.workshop.completedStorageWorkloads + (result.completed ? 1 : 0),
    },
  };
  return result.completed ? addExactRewards(next, result.reward) : next;
};

export const getWorkshopStorageSkuDefinitions = () => storageSkuDefinitions;
