import type { GameAction } from "../game";

export type UiGameAction =
  | GameAction
  | { type: "startTask"; taskId: string }
  | { type: "startTaskOnCore"; taskId: string; coreId: number }
  | { type: "queueTask"; taskId: string; cpuId?: number }
  | { type: "cancelTask"; taskId: string; instanceId?: string }
  | { type: "cancelQueuedTask"; taskId: string }
  | { type: "buyResearch"; researchId: string }
  | {
      type: "buyUpgrade";
      upgradeId: string;
      coreId?: number;
      coreIds?: number[];
      cpuId?: number;
      sourceCpuId?: number;
      ramStickId?: number;
      ramStickIds?: number[];
    }
  | {
      type: "downgradeUpgrade";
      upgradeId: string;
      coreId?: number;
      coreIds?: number[];
      cpuId?: number;
      sourceCpuId?: number;
      ramStickId?: number;
      ramStickIds?: number[];
    };

export type Dispatch = (action: UiGameAction) => void;
