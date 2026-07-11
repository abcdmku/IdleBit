import type { Cost, GameState, ResearchState } from "./types";
import { amount, amountMultiply, amountRound } from "./amount";
import { roundedCost } from "./exactCosts";

export const CLICK_RATE_MAX_LEVEL = 36;
export const CLICK_RATE_UNLOCK_COST = "500000";
export const CLICK_RATE_FIRST_LEVEL_COST = "100000";
export const CLICK_RATE_COST_MULTIPLIER = "1.4";
export const DEFAULT_TASK_HOLD_REPEAT_MS = 110;
export const TASK_HOLD_MAX_MS = 30_000;

const credits = (value: string | number): Cost => roundedCost("credits", value);

export const getClickRateLevelFromResearch = (
  research: Partial<ResearchState> | undefined,
) => {
  const level = research?.clickRateLevel ?? 0;

  return Math.max(
    0,
    Math.min(
      CLICK_RATE_MAX_LEVEL,
      Math.trunc(Number.isFinite(level) ? level : 0),
    ),
  );
};

export const getClickRateLevel = (state: GameState) =>
  getClickRateLevelFromResearch(state.research);

export const getClickRateUpgradeCost = (targetLevel: number): Cost[] => {
  if (targetLevel <= 0 || targetLevel > CLICK_RATE_MAX_LEVEL) return [];

  let cost = amount(CLICK_RATE_FIRST_LEVEL_COST);

  for (let currentLevel = 2; currentLevel <= targetLevel; currentLevel += 1) {
    cost = amountRound(amountMultiply(cost, CLICK_RATE_COST_MULTIPLIER));
  }

  return [credits(cost)];
};

export const getClickRateHz = (level: number) => {
  const safeLevel = Number.isFinite(level) ? level : 0;
  const boundedLevel = Math.max(
    0,
    Math.min(CLICK_RATE_MAX_LEVEL, Math.trunc(safeLevel)),
  );

  return boundedLevel <= 0
    ? 1000 / DEFAULT_TASK_HOLD_REPEAT_MS
    : 10 + (boundedLevel - 1) * 2;
};

export const getClickRateRepeatMs = (level: number) =>
  level <= 0 ? DEFAULT_TASK_HOLD_REPEAT_MS : 1000 / getClickRateHz(level);

export const getVisibleInputConfig = (state: GameState) => {
  const clickRateLevel = getClickRateLevel(state);

  return {
    clickRateLevel,
    taskHoldRateHz: getClickRateHz(clickRateLevel),
    taskHoldRepeatMs: getClickRateRepeatMs(clickRateLevel),
    taskHoldMaxMs: TASK_HOLD_MAX_MS,
  };
};
