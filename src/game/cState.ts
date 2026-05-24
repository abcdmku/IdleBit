import type { GameState, HardwareState } from "./types";

export const getGlobalCStateLevel = (state: GameState) =>
  Math.max(
    0,
    state.hardware?.cStateLevel ?? 0,
    ...(state.systems ?? []).map((system) =>
      Math.max(0, system.hardware?.cStateLevel ?? 0),
    ),
  );

export const withGlobalCStateLevel = (
  state: GameState,
  hardware: HardwareState,
): HardwareState => ({
  ...hardware,
  cStateLevel: getGlobalCStateLevel(state),
});
