import { createThermalState } from "./thermal";
import type {
  HardwareState,
  WorkshopSystemState,
} from "./types";
import type { WorkshopCoolingTierId } from "./content/cooling";

export const DEFAULT_WORKSHOP_EXPANSION_SLOTS = 4;

const getLegacyCoolingTierId = (
  hardware?: Partial<HardwareState>,
): WorkshopCoolingTierId => {
  const rawLevel = hardware?.coolingLevel;
  const level =
    typeof rawLevel === "number" && Number.isFinite(rawLevel)
      ? Math.max(0, Math.trunc(rawLevel))
      : 0;
  if (level >= 4) return "liquidCooling";
  if (level === 3) return "caseAirflow";
  if (level === 2) return "fanCooling";
  if (level === 1) return "passiveHeatsink";
  return "none";
};

export const createWorkshopSystemState = (
  hardware?: Partial<HardwareState>,
): WorkshopSystemState => ({
  thermal: createThermalState(),
  highestObservedThermalStatus: "nominal",
  coolingTierId: getLegacyCoolingTierId(hardware),
  overclockPresetId: "stock",
  expansionSlots: DEFAULT_WORKSHOP_EXPANSION_SLOTS,
  accelerators: [],
  nextAcceleratorId: 1,
  storageSkuId: "storageNone",
  activeStorageWorkload: null,
  completedStorageWorkloads: 0,
  evidence: {
    gpuRenderCompletions: 0,
    npuInferenceCompletions: 0,
  },
});
