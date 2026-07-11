import type { Cost, GameState, HardwareState } from "./types";
import { roundedGrowthCost } from "./exactCosts";

export const BOOTLOADER_MAX_LEVEL = 36;
export const BOOTLOADER_UNLOCK_COST = "100000";
export const BOOTLOADER_FIRST_LEVEL_COST = "10000";
export const BOOTLOADER_COST_MULTIPLIER = "1.2";
export const DEFAULT_BOOT_SECONDS = 10;
export const BOOTLOADER_LEVEL_ONE_SECONDS = 9.2;
export const BOOTLOADER_SECONDS_PER_LEVEL = 0.26;
export const BOOTLOADER_MIN_SECONDS = 0.1;

export const getBootloaderLevelFromHardware = (hardware: Partial<HardwareState>) =>
  Math.max(
    0,
    Math.min(
      BOOTLOADER_MAX_LEVEL,
      Math.trunc(hardware.bootloaderLevel ?? 0),
    ),
  );

export const getGlobalBootloaderLevel = (state: GameState) =>
  Math.max(
    getBootloaderLevelFromHardware(state.hardware),
    ...(state.systems ?? []).map((system) =>
      getBootloaderLevelFromHardware(system.hardware),
    ),
  );

export const withGlobalBootloaderLevel = (
  state: GameState,
  hardware: HardwareState,
): HardwareState => ({
  ...hardware,
  bootloaderLevel: getGlobalBootloaderLevel(state),
});

export const getBootloaderUpgradeCost = (targetLevel: number): Cost[] => [
  roundedGrowthCost(
    "credits",
    BOOTLOADER_FIRST_LEVEL_COST,
    BOOTLOADER_COST_MULTIPLIER,
    Math.max(0, Math.trunc(targetLevel) - 1),
  ),
];

export const getBootSecondsForBootloaderLevel = (level: number) => {
  const boundedLevel = Math.max(
    0,
    Math.min(BOOTLOADER_MAX_LEVEL, Math.trunc(level)),
  );
  if (boundedLevel <= 0) return DEFAULT_BOOT_SECONDS;

  const seconds =
    BOOTLOADER_LEVEL_ONE_SECONDS -
    (boundedLevel - 1) * BOOTLOADER_SECONDS_PER_LEVEL;

  return Math.max(BOOTLOADER_MIN_SECONDS, Math.round(seconds * 100) / 100);
};

export const getBootSeconds = (state: GameState) =>
  getBootSecondsForBootloaderLevel(getGlobalBootloaderLevel(state));

export const getBootloaderReducedSecondsForLevel = (
  level: number,
  baseSeconds: number,
) => {
  const savedSeconds =
    DEFAULT_BOOT_SECONDS - getBootSecondsForBootloaderLevel(level);
  return Math.max(
    BOOTLOADER_MIN_SECONDS,
    Math.round((baseSeconds - savedSeconds) * 100) / 100,
  );
};

export const getBootloaderReducedSeconds = (
  state: GameState,
  baseSeconds: number,
) =>
  getBootloaderReducedSecondsForLevel(
    getGlobalBootloaderLevel(state),
    baseSeconds,
  );
