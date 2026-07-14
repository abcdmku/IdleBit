import { useCallback, useEffect, useState } from "react";
import {
  CREDIT_FAILURE_MODAL_SEEN_KEY,
  DEADLOCK_COOLDOWN_HELP_KEY,
  DEADLOCK_HELP_KEY,
  PSU_FAILURE_HELP_KEY,
  PSU_FAILURE_MODAL_SEEN_KEY,
  getNoticePreferences,
  persistUiPreferenceWithRetry,
  resetNoticePreferenceStorage,
  type NoticePreferenceSnapshot,
} from "../app/persistence";

const defaultNoticePreferences: NoticePreferenceSnapshot = {
  deadlockHelpSeen: false,
  deadlockCooldownHelpSeen: false,
  psuFailureHelpSeen: false,
  psuFailureModalSeen: false,
  creditFailureModalSeen: false,
};

interface UseNoticePreferencesOptions {
  seedRackReady: boolean;
}

export function useNoticePreferences({
  seedRackReady,
}: UseNoticePreferencesOptions) {
  const [ready, setReady] = useState(false);
  const [deadlockHelpSeen, setDeadlockHelpSeen] = useState<boolean | null>(null);
  const [deadlockCooldownHelpSeen, setDeadlockCooldownHelpSeen] =
    useState<boolean | null>(null);
  const [psuFailureHelpSeen, setPsuFailureHelpSeen] =
    useState<boolean | null>(null);
  const [psuFailureModalSeen, setPsuFailureModalSeen] =
    useState<boolean | null>(null);
  const [creditFailureModalSeen, setCreditFailureModalSeen] =
    useState<boolean | null>(null);

  const applySnapshot = useCallback((snapshot: NoticePreferenceSnapshot) => {
    setDeadlockHelpSeen(snapshot.deadlockHelpSeen);
    setDeadlockCooldownHelpSeen(snapshot.deadlockCooldownHelpSeen);
    setPsuFailureHelpSeen(snapshot.psuFailureHelpSeen);
    setPsuFailureModalSeen(snapshot.psuFailureModalSeen);
    setCreditFailureModalSeen(snapshot.creditFailureModalSeen);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (seedRackReady) {
        try {
          await resetNoticePreferenceStorage();
        } catch {
          // Seeding should still work in memory if persistence is unavailable.
        }
        return defaultNoticePreferences;
      }

      return getNoticePreferences();
    })()
      .then((snapshot) => {
        if (!cancelled) {
          applySnapshot(snapshot);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applySnapshot, seedRackReady]);

  const dismissDeadlockHelp = useCallback(() => {
    setDeadlockHelpSeen(true);
    void persistUiPreferenceWithRetry(DEADLOCK_HELP_KEY, true);
  }, []);

  const dismissDeadlockCooldownHelp = useCallback(() => {
    setDeadlockCooldownHelpSeen(true);
    void persistUiPreferenceWithRetry(DEADLOCK_COOLDOWN_HELP_KEY, true);
  }, []);

  const dismissPsuFailureHelp = useCallback(() => {
    setPsuFailureHelpSeen(true);
    void persistUiPreferenceWithRetry(PSU_FAILURE_HELP_KEY, true);
  }, []);

  const dismissPsuFailureModal = useCallback(() => {
    setPsuFailureModalSeen(true);
    void persistUiPreferenceWithRetry(PSU_FAILURE_MODAL_SEEN_KEY, true);
  }, []);

  const dismissCreditFailurePopup = useCallback(() => {
    setCreditFailureModalSeen(true);
    void persistUiPreferenceWithRetry(CREDIT_FAILURE_MODAL_SEEN_KEY, true);
  }, []);

  const resetNoticePreferences = useCallback(async () => {
    applySnapshot(defaultNoticePreferences);
    await resetNoticePreferenceStorage();
  }, [applySnapshot]);

  return {
    ready,
    deadlockHelpSeen,
    deadlockCooldownHelpSeen,
    psuFailureHelpSeen,
    psuFailureModalSeen,
    creditFailureModalSeen,
    dismissDeadlockHelp,
    dismissDeadlockCooldownHelp,
    dismissPsuFailureHelp,
    dismissPsuFailureModal,
    dismissCreditFailurePopup,
    resetNoticePreferences,
  };
}
