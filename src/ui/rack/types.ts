import type { VisibleState, VisibleUpgrade } from "../../game";
import type { DisplayCost } from "../format";
import type { ReactNode } from "react";

export type RackView = "list" | "detail" | "builder";
export type BuilderTab = "new" | "configure";
export type BuilderNewMode = "premade" | "custom";

export type UiRecord = Record<string, unknown>;

export interface UiRackSystemSource extends UiRecord {
  id?: string | number;
  systemId?: string | number;
  machineId?: string | number;
  name?: string;
  label?: string;
  role?: string;
  tier?: string;
  status?: string;
  powerState?: string;
  cores?: number;
  coreCount?: number;
  ramBits?: number;
  ramBytes?: number;
  powerUsedWatts?: number;
  visible?: UiRecord;
  visibleState?: UiRecord;
  state?: UiRecord;
  hardware?: UiRecord;
  metrics?: UiRecord;
  flags?: UiRecord;
  resources?: UiRecord;
  cron?: UiRecord;
  tasks?: unknown[];
  activeTasks?: unknown[];
  queue?: unknown[];
  upgrades?: unknown[];
}

export interface UiRackSystem {
  id: string;
  name: string;
  role: string;
  tier: string | null;
  status: string;
  visible: VisibleState;
  cores: number;
  clockHz: number;
  ramBits: number;
  ramUsedBits: number;
  drawWatts: number;
  psuCapWatts: number;
  powerCostPerSecond: number;
  activeTaskCount: number;
  queueCount: number;
  source: UiRackSystemSource | null;
}

export interface UiSystemPreset {
  id?: string | number;
  presetId?: string | number;
  templateId?: string | number;
  name?: string;
  label?: string;
  role?: string;
  description?: string;
  tier?: string;
  costs?: DisplayCost[];
  cost?: DisplayCost[];
  price?: DisplayCost[];
  canAfford?: boolean;
  canBuy?: boolean;
  disabled?: boolean;
  blockedReason?: string | null;
  lockedReason?: string | null;
  powerDeltaWatts?: number;
  cores?: number;
  coreCount?: number;
  ramBits?: number;
  ramBytes?: number;
  cacheBits?: number;
  cacheBytes?: number;
  components?: Partial<
    Record<"cpu" | "ram" | "memory" | "scheduler" | "psu" | "powerSupply", string>
  >;
  actionType?: string;
}

export interface UiCustomMachineTier {
  id?: string | number;
  tierId?: string | number;
  name?: string;
  label?: string;
  description?: string;
  costs?: DisplayCost[];
  cost?: DisplayCost[];
  price?: DisplayCost[];
  canAfford?: boolean;
  canSelect?: boolean;
  disabled?: boolean;
  blockedReason?: string | null;
  cpuPackageCount?: number;
  cores?: number;
  coreCount?: number;
  ramBits?: number;
  ramBytes?: number;
  cacheBits?: number;
  cacheBytes?: number;
  clockLevel?: number;
  cacheLevel?: number;
  cacheSpeedLevel?: number;
  schedulerSlots?: number;
  ramStickCount?: number;
  ramLevel?: number;
  ramSpeedLevel?: number;
  psuLevel?: number;
  powerDeltaWatts?: number;
  clockHz?: number;
}

export interface UiCustomMachineGroup {
  id?: string | number;
  slotId?: string | number;
  component?: string;
  name?: string;
  label?: string;
  tiers?: UiCustomMachineTier[];
  options?: UiCustomMachineTier[];
}

export interface UiCustomMachineBuilder {
  title?: string;
  name?: string;
  groups?: UiCustomMachineGroup[];
  slots?: UiCustomMachineGroup[];
  tiers?: UiCustomMachineGroup[];
  components?: UiCustomMachineGroup[];
  costs?: DisplayCost[];
  cost?: DisplayCost[];
  canAfford?: boolean;
  canBuy?: boolean;
  blockedReason?: string | null;
  lockedReason?: string | null;
  actionType?: string;
}

export interface UiRackData {
  systems: UiRackSystem[];
  presets: UiSystemPreset[];
  customBuilder: UiCustomMachineBuilder | null;
  showRack: boolean;
  hasSystemModel: boolean;
  selectedSystemId: string | null;
}

export interface RackQueueDisplayItem {
  id: string;
  name: string;
  waitingReason: string;
  instanceId?: string;
  active: boolean;
  progress: number;
  deadlocked?: boolean;
}

export interface RackComponentWarnings {
  off: boolean;
  any: boolean;
  cpu: boolean;
  ram: boolean;
  psu: boolean;
}

export type RenderBuilderUpgradeStepper = (
  upgrade: VisibleUpgrade,
  className: string,
) => ReactNode;
