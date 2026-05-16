import type { GameAction } from "../game";

export type UiGameAction =
  | GameAction
  | { type: "startTask"; taskId: string }
  | { type: "startTaskOnCore"; taskId: string; coreId: number }
  | { type: "queueTask"; taskId: string }
  | { type: "buyResearch"; researchId: string };

export type Dispatch = (action: UiGameAction) => void;
