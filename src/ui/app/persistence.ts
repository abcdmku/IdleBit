import { DEV_SEED_IDS, serializeSave, type DevSeedId, type GameState } from "../../game";
import { idleBitPersistence, type PersistedValue } from "../../platform";

export const SAVE_KEY = "save-v7";
export const SAVE_PRE_SEED_BACKUP_KEY = `${SAVE_KEY}.pre-seed`;
export const DEADLOCK_HELP_KEY = "ui.deadlock-help-seen-v1";
export const DEADLOCK_COOLDOWN_HELP_KEY = "ui.deadlock-cooldown-help-seen-v1";
export const PSU_FAILURE_HELP_KEY = "ui.psu-failure-help-seen-v1";
export const PSU_FAILURE_MODAL_SEEN_KEY = "ui.psu-failure-modal-seen-v1";
export const CREDIT_FAILURE_MODAL_SEEN_KEY = "ui.credit-failure-modal-seen-v1";
export const PINNED_TASKS_KEY = "ui.pinned-tasks-v1";
export const SEEN_TASKS_KEY = "ui.seen-tasks-v1";
export const SEEN_RESEARCH_KEY = "ui.seen-research-v1";

const SEED_PARAM = "seed";
/**
 * URL `?seed=` value → canonical dev seed id. Every canonical id maps to
 * itself; "trillion" is the legacy alias for the rack-ready seed.
 */
const DEV_SEED_ALIASES = new Map<string, DevSeedId>([
  ...DEV_SEED_IDS.map((seedId) => [seedId, seedId] as const),
  ["trillion", "rack-ready"],
]);

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

/** Dev-only: the seed requested by the current URL, or null. */
export const getDevSeedId = (): DevSeedId | null => {
  if (!import.meta.env.DEV) return null;
  const requested =
    new URLSearchParams(window.location.search)
      .get(SEED_PARAM)
      ?.toLowerCase() ?? "";
  return DEV_SEED_ALIASES.get(requested) ?? null;
};

/**
 * True when the current URL requests any dev seed. The name predates the
 * later-chapter seeds; it gates the shared seed hydration branch (backup,
 * seeded state, URL cleanup) for all of them.
 */
export const isRackReadySeed = () => getDevSeedId() !== null;

export const clearRackReadySeed = () => {
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.hash}`,
  );
};

export const getSavedGame = () => idleBitPersistence.get<string>(SAVE_KEY);

/**
 * One-slot safety copy written before a dev seed replaces the real save.
 * Returns true when an existing save was backed up.
 */
export const backupSavedGameForSeed = async () => {
  const existing = await idleBitPersistence.get<string>(SAVE_KEY);
  if (typeof existing !== "string") return false;
  await idleBitPersistence.set(SAVE_PRE_SEED_BACKUP_KEY, existing);
  return true;
};

/**
 * The memory driver only engages when real storage is unavailable, so a
 * "successful" write there does not survive a reload.
 */
export const isGameSaveDurable = () => idleBitPersistence.driver !== "memory";

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

const preferenceRetryDelayMs = 1_000;

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fire-and-forget preference write with a rejection path: one delayed retry,
 * then a console warning so a failed storage/IPC write is never silently
 * dropped. The optimistic in-memory state stays correct for the session
 * either way; the warning tells the player/dev why the preference may
 * reappear next launch. Returns whether the value was durably written.
 */
export const persistUiPreferenceWithRetry = async <T extends PersistedValue>(
  key: string,
  value: T,
  retryDelayMs: number = preferenceRetryDelayMs,
): Promise<boolean> => {
  try {
    await persistUiPreference(key, value);
    return true;
  } catch {
    await delay(retryDelayMs);
  }

  try {
    await persistUiPreference(key, value);
    return true;
  } catch (error) {
    console.warn(
      `IdleBit: failed to persist UI preference "${key}"; it may reset on next launch.`,
      error,
    );
    return false;
  }
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
