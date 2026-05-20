import { useCallback, useEffect, useMemo, useState } from "react";
import type { VisibleState } from "../../game";
import {
  PINNED_TASKS_KEY,
  SEEN_RESEARCH_KEY,
  SEEN_TASKS_KEY,
  getPinnedUnlockPreferences,
  persistUiPreference,
  resetPinnedUnlockPreferenceStorage,
  type PinnedUnlockPreferenceSnapshot,
} from "../app/persistence";

export type UnlockSection = "tasks" | "research";

const emptyPinnedUnlockPreferences: PinnedUnlockPreferenceSnapshot = {
  pinnedTaskIds: [],
  seenTaskIds: [],
  seenResearchIds: [],
};

const idsFromKey = (key: string) => (key.length > 0 ? key.split("|") : []);

const appendUnseenIds = (current: string[], ids: string[]) => {
  if (ids.length === 0) return current;

  const merged = new Set(current);
  let changed = false;

  for (const id of ids) {
    if (merged.has(id)) continue;
    merged.add(id);
    changed = true;
  }

  return changed ? Array.from(merged) : current;
};

interface UsePinnedUnlockPreferencesOptions {
  seedRackReady: boolean;
  trackingReady: boolean;
  visible: VisibleState;
}

export function usePinnedUnlockPreferences({
  seedRackReady,
  trackingReady,
  visible,
}: UsePinnedUnlockPreferencesOptions) {
  const [ready, setReady] = useState(false);
  const [pinnedTaskIds, setPinnedTaskIds] = useState<string[]>([]);
  const [seenTaskIds, setSeenTaskIds] = useState<string[]>([]);
  const [seenResearchIds, setSeenResearchIds] = useState<string[]>([]);
  const visibleTaskIdsKey = visible.tasks.map((task) => task.id).join("|");
  const visibleTaskIds = useMemo(
    () => idsFromKey(visibleTaskIdsKey),
    [visibleTaskIdsKey],
  );
  const visibleResearchIdsKey = visible.research
    .filter((research) => !research.completed)
    .map((research) => research.id)
    .join("|");
  const visibleResearchIds = useMemo(
    () => idsFromKey(visibleResearchIdsKey),
    [visibleResearchIdsKey],
  );
  const seenTaskIdSet = useMemo(() => new Set(seenTaskIds), [seenTaskIds]);
  const seenResearchIdSet = useMemo(
    () => new Set(seenResearchIds),
    [seenResearchIds],
  );
  const newTaskUnlockCount = visibleTaskIds.filter(
    (id) => !seenTaskIdSet.has(id),
  ).length;
  const newResearchUnlockCount = visibleResearchIds.filter(
    (id) => !seenResearchIdSet.has(id),
  ).length;

  const applySnapshot = useCallback(
    (snapshot: PinnedUnlockPreferenceSnapshot) => {
      setPinnedTaskIds(snapshot.pinnedTaskIds);
      setSeenTaskIds(snapshot.seenTaskIds);
      setSeenResearchIds(snapshot.seenResearchIds);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (seedRackReady) {
        try {
          await resetPinnedUnlockPreferenceStorage();
        } catch {
          // Seeding should still work in memory if persistence is unavailable.
        }
        return emptyPinnedUnlockPreferences;
      }

      return getPinnedUnlockPreferences();
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

  const persistPinnedTaskIds = useCallback((next: string[]) => {
    void persistUiPreference(PINNED_TASKS_KEY, next);
  }, []);

  const togglePinnedTask = useCallback(
    (taskId: string) => {
      setPinnedTaskIds((current) => {
        const next = current.includes(taskId)
          ? current.filter((id) => id !== taskId)
          : [...current, taskId];
        persistPinnedTaskIds(next);
        return next;
      });
    },
    [persistPinnedTaskIds],
  );

  const unpinTask = useCallback(
    (taskId: string) => {
      setPinnedTaskIds((current) => {
        if (!current.includes(taskId)) return current;
        const next = current.filter((id) => id !== taskId);
        persistPinnedTaskIds(next);
        return next;
      });
    },
    [persistPinnedTaskIds],
  );

  const clearPinnedTasks = useCallback(() => {
    setPinnedTaskIds(() => {
      persistPinnedTaskIds([]);
      return [];
    });
  }, [persistPinnedTaskIds]);

  const markVisibleUnlocksSeen = useCallback(
    (section: UnlockSection) => {
      if (!ready || !trackingReady) return;

      if (section === "tasks") {
        setSeenTaskIds((current) => {
          const next = appendUnseenIds(current, visibleTaskIds);
          if (next === current) return current;
          void persistUiPreference(SEEN_TASKS_KEY, next);
          return next;
        });
        return;
      }

      setSeenResearchIds((current) => {
        const next = appendUnseenIds(current, visibleResearchIds);
        if (next === current) return current;
        void persistUiPreference(SEEN_RESEARCH_KEY, next);
        return next;
      });
    },
    [ready, trackingReady, visibleResearchIds, visibleTaskIds],
  );

  const resetPinnedUnlockPreferences = useCallback(async () => {
    applySnapshot(emptyPinnedUnlockPreferences);
    await resetPinnedUnlockPreferenceStorage();
  }, [applySnapshot]);

  return {
    ready,
    pinnedTaskIds,
    newTaskUnlockCount,
    newResearchUnlockCount,
    togglePinnedTask,
    unpinTask,
    clearPinnedTasks,
    markVisibleUnlocksSeen,
    resetPinnedUnlockPreferences,
  };
}
