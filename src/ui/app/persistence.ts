import { serializeSave, type GameState } from "../../game";
import { idleBitPersistence, type PersistedValue } from "../../platform";

export const SAVE_KEY = "save-v7";
export const DEADLOCK_HELP_KEY = "ui.deadlock-help-seen-v1";
export const DEADLOCK_COOLDOWN_HELP_KEY = "ui.deadlock-cooldown-help-seen-v1";
export const PSU_FAILURE_HELP_KEY = "ui.psu-failure-help-seen-v1";
export const PSU_FAILURE_MODAL_SEEN_KEY = "ui.psu-failure-modal-seen-v1";
export const CREDIT_FAILURE_MODAL_SEEN_KEY = "ui.credit-failure-modal-seen-v1";
export const PINNED_TASKS_KEY = "ui.pinned-tasks-v1";
export const SEEN_TASKS_KEY = "ui.seen-tasks-v1";
export const SEEN_RESEARCH_KEY = "ui.seen-research-v1";

const SEED_PARAM = "seed";
const RACK_READY_SEED = "rack-ready";
const RACK_READY_SEED_ALIASES = new Set([RACK_READY_SEED, "trillion"]);

export interface NoticePreferenceSnapshot {
  deadlockHelpSeen: boolean;
  deadlockCooldownHelpSeen: boolean;
  psuFailureHelpSeen: boolean;
  psuFailureModalSeen: boolean;
  creditFailureModalSeen: boolean;
}

export interface PinnedUnlockPreferenceSnapshot {
  pinnedTaskIds: string[];
  seenTaskIds: string[];
  seenResearchIds: string[];
}

export const toStoredIds = (value: unknown) =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter((id): id is string => typeof id === "string")))
    : [];

export const isRackReadySeed = () =>
  import.meta.env.DEV &&
  RACK_READY_SEED_ALIASES.has(
    new URLSearchParams(window.location.search)
      .get(SEED_PARAM)
      ?.toLowerCase() ?? "",
  );

export const clearRackReadySeed = () => {
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.hash}`,
  );
};

export const getSavedGame = () => idleBitPersistence.get<string>(SAVE_KEY);

export const getUiPreference = async <T extends PersistedValue>(
  key: string,
  fallback: T,
): Promise<T> => {
  try {
    return await idleBitPersistence.get<T>(key, fallback);
  } catch {
    return fallback;
  }
};

export const getNoticePreferences = async (): Promise<NoticePreferenceSnapshot> => {
  const [
    deadlockHelpSeen,
    deadlockCooldownHelpSeen,
    psuFailureHelpSeen,
    psuFailureModalSeen,
    creditFailureModalSeen,
  ] = await Promise.all([
    getUiPreference(DEADLOCK_HELP_KEY, false),
    getUiPreference(DEADLOCK_COOLDOWN_HELP_KEY, false),
    getUiPreference(PSU_FAILURE_HELP_KEY, false),
    getUiPreference(PSU_FAILURE_MODAL_SEEN_KEY, false),
    getUiPreference(CREDIT_FAILURE_MODAL_SEEN_KEY, false),
  ]);

  return {
    deadlockHelpSeen: Boolean(deadlockHelpSeen),
    deadlockCooldownHelpSeen: Boolean(deadlockCooldownHelpSeen),
    psuFailureHelpSeen: Boolean(psuFailureHelpSeen),
    psuFailureModalSeen: Boolean(psuFailureModalSeen),
    creditFailureModalSeen: Boolean(creditFailureModalSeen),
  };
};

export const getPinnedUnlockPreferences =
  async (): Promise<PinnedUnlockPreferenceSnapshot> => {
    const [pinnedTaskIds, seenTaskIds, seenResearchIds] = await Promise.all([
      getUiPreference<string[]>(PINNED_TASKS_KEY, []),
      getUiPreference<string[]>(SEEN_TASKS_KEY, []),
      getUiPreference<string[]>(SEEN_RESEARCH_KEY, []),
    ]);

    return {
      pinnedTaskIds: toStoredIds(pinnedTaskIds),
      seenTaskIds: toStoredIds(seenTaskIds),
      seenResearchIds: toStoredIds(seenResearchIds),
    };
  };

export const saveGameState = (
  state: GameState,
  savedAtMs: number = Date.now(),
) => idleBitPersistence.set(SAVE_KEY, serializeSave(state, savedAtMs));

export const saveGameStateImmediate = (
  state: GameState,
  savedAtMs: number = Date.now(),
) => idleBitPersistence.setImmediate(SAVE_KEY, serializeSave(state, savedAtMs));

export const persistUiPreference = async <T extends PersistedValue>(
  key: string,
  value: T,
) => {
  await idleBitPersistence.set(key, value);
};

export const resetNoticePreferenceStorage = async () => {
  await Promise.all([
    persistUiPreference(DEADLOCK_HELP_KEY, false),
    persistUiPreference(DEADLOCK_COOLDOWN_HELP_KEY, false),
    persistUiPreference(PSU_FAILURE_HELP_KEY, false),
    persistUiPreference(PSU_FAILURE_MODAL_SEEN_KEY, false),
    persistUiPreference(CREDIT_FAILURE_MODAL_SEEN_KEY, false),
  ]);
};

export const resetPinnedUnlockPreferenceStorage = async () => {
  await Promise.all([
    persistUiPreference(PINNED_TASKS_KEY, []),
    persistUiPreference(SEEN_TASKS_KEY, []),
    persistUiPreference(SEEN_RESEARCH_KEY, []),
  ]);
};
