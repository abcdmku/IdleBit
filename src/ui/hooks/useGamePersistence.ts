import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch as ReactDispatch,
  type SetStateAction,
} from "react";
import {
  advanceGame,
  createDevSeedGameState,
  createInitialGameState,
  deserializeSave,
  recordDeparture,
  recordSave,
  type GameState,
} from "../../game";
import {
  createGameOfflineAdvanceRunner,
  idleBitLifecycle,
  type GameOfflineAdvanceRunner,
} from "../../platform";
import type { SelectedComponent } from "../components";
import {
  backupSavedGameForSeed,
  clearRackReadySeed,
  getDevSeedId,
  getSavedGame,
  isGameSaveDurable,
  saveGameState,
  saveGameStateImmediate,
} from "../app/persistence";

export type GamePersistencePhase =
  | "hydrating"
  | "saving"
  | "saved"
  | "error";

export interface GamePersistenceStatus {
  phase: GamePersistencePhase;
  message: string;
  lastSavedAtMs: number | null;
  announcement: "polite" | "assertive" | null;
}

export interface UseGamePersistenceOptions {
  seedRackReady: boolean;
  createOfflineRunner?: () => GameOfflineAdvanceRunner;
  now?: () => number;
  saveIntervalMs?: number;
}

const DEFAULT_SAVE_INTERVAL_MS = 4_000;
export const FOREGROUND_ADVANCE_INTERVAL_MS = 500;
/** Bounded departure-save retries before an Electron close goes unacknowledged. */
export const ELECTRON_CLOSE_SAVE_ATTEMPTS = 3;
const NON_DURABLE_SAVE_MESSAGE =
  "Saved to memory only — storage is unavailable, so progress will be lost when this page closes.";
const getCurrentTime = () => Date.now();

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;

const clearDeparture = (state: GameState, timestampMs: number) =>
  recordSave(
    {
      ...state,
      time: {
        ...state.time,
        departedAtMs: null,
      },
    },
    timestampMs,
  );

interface PersistStateOptions {
  allowBlockedWrite?: boolean;
  announceSuccess?: boolean;
  shouldIgnoreStatus?: () => boolean;
}

export function useGamePersistence({
  seedRackReady,
  createOfflineRunner = createGameOfflineAdvanceRunner,
  now = getCurrentTime,
  saveIntervalMs = DEFAULT_SAVE_INTERVAL_MS,
}: UseGamePersistenceOptions) {
  const [state, setState] = useState<GameState>(() => createInitialGameState());
  const [selectedComponent, setSelectedComponent] =
    useState<SelectedComponent>("core:1");
  const [ready, setReady] = useState(false);
  const [persistenceStatus, setPersistenceStatus] =
    useState<GamePersistenceStatus>({
      phase: "hydrating",
      message: "Loading save…",
      lastSavedAtMs: null,
      announcement: null,
    });
  const [catchupActive, setCatchupActiveState] = useState(false);
  const stateRef = useRef(state);
  const pausedRef = useRef(false);
  const readyRef = useRef(false);
  const catchupActiveRef = useRef(false);
  const catchupTokenRef = useRef(0);
  const stateRevisionRef = useRef(0);
  const writeBlockedRef = useRef(false);
  const resetForegroundClockRef = useRef(true);
  const foregroundAccumulatedMsRef = useRef(0);
  const offlineRunnerRef = useRef<GameOfflineAdvanceRunner | null>(null);
  const saveSequenceRef = useRef(0);
  const durableWriteSequenceRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const nonDurableWarnedRef = useRef(false);

  const setCatchupActive = useCallback((active: boolean) => {
    catchupActiveRef.current = active;
    setCatchupActiveState(active);
  }, []);

  const invalidateCatchup = useCallback(() => {
    catchupTokenRef.current += 1;
    setCatchupActive(false);
  }, [setCatchupActive]);

  const setGameState: ReactDispatch<SetStateAction<GameState>> = useCallback(
    (update) => {
      setState((current) => {
        if (!readyRef.current || catchupActiveRef.current) return current;
        const next =
          typeof update === "function"
            ? (update as (state: GameState) => GameState)(current)
            : update;
        if (next === current) return current;
        stateRef.current = next;
        stateRevisionRef.current += 1;
        return next;
      });
    },
    [],
  );

  const commitState = useCallback(
    (next: GameState) => {
      stateRef.current = next;
      stateRevisionRef.current += 1;
      setState(next);
    },
    [],
  );

  const persistState = useCallback(
    async (
      next: GameState,
      timestampMs: number,
      {
        allowBlockedWrite = false,
        announceSuccess = false,
        shouldIgnoreStatus,
      }: PersistStateOptions = {},
    ) => {
      if (writeBlockedRef.current && !allowBlockedWrite) return false;
      const sequence = saveSequenceRef.current + 1;
      saveSequenceRef.current = sequence;
      setPersistenceStatus({
        phase: "saving",
        message: "Saving…",
        lastSavedAtMs: next.time.lastSavedAtMs,
        announcement: null,
      });

      const write = saveQueueRef.current
        .catch(() => undefined)
        .then(() =>
          sequence < durableWriteSequenceRef.current
            ? undefined
            : saveGameState(next, timestampMs),
        );
      saveQueueRef.current = write;

      try {
        await write;
        if (shouldIgnoreStatus?.()) return true;
        if (saveSequenceRef.current === sequence) {
          if (isGameSaveDurable()) {
            setPersistenceStatus({
              phase: "saved",
              message: "Saved",
              lastSavedAtMs: timestampMs,
              announcement: announceSuccess ? "polite" : null,
            });
          } else {
            // The memory fallback accepted the write but nothing was stored
            // durably; keep a visible warning instead of reporting Saved.
            setPersistenceStatus({
              phase: "error",
              message: NON_DURABLE_SAVE_MESSAGE,
              lastSavedAtMs: timestampMs,
              announcement: nonDurableWarnedRef.current ? null : "assertive",
            });
            nonDurableWarnedRef.current = true;
          }
        }
        return true;
      } catch (error) {
        if (shouldIgnoreStatus?.()) return false;
        if (saveSequenceRef.current === sequence) {
          setPersistenceStatus({
            phase: "error",
            message: `Save failed: ${errorMessage(error, "Storage unavailable.")}`,
            lastSavedAtMs: next.time.lastSavedAtMs,
            announcement: "assertive",
          });
        }
        return false;
      }
    },
    [],
  );

  const runOfflineAdvance = useCallback(
    async (
      source: GameState,
      elapsedMs: number,
      shouldAbort: () => boolean = () => false,
    ) => {
      if (shouldAbort()) return null;
      const runner = offlineRunnerRef.current;
      if (runner) {
        try {
          const result = await runner.run({
            state: source,
            elapsedMs,
            mode: "offline",
          });
          return shouldAbort() ? null : result;
        } catch {
          if (shouldAbort()) return null;
          // Worker and bridge failures fall through to the pure engine.
        }
      }

      if (shouldAbort()) return null;
      return advanceGame(source, elapsedMs, "offline");
    },
    [],
  );

  useEffect(() => {
    let runner: GameOfflineAdvanceRunner | null = null;
    try {
      runner = createOfflineRunner();
    } catch {
      // The pure engine remains available when a platform runner cannot start.
    }
    offlineRunnerRef.current = runner;
    return () => {
      if (offlineRunnerRef.current === runner) {
        offlineRunnerRef.current = null;
      }
      runner?.dispose();
    };
  }, [createOfflineRunner]);

  useEffect(() => {
    let cancelled = false;
    let hydrationCatchupToken: number | null = null;

    const hydrate = async () => {
      setCatchupActive(false);
      setPersistenceStatus({
        phase: "hydrating",
        message: "Loading save…",
        lastSavedAtMs: null,
        announcement: null,
      });

      try {
        const timestampMs = now();
        let restored: GameState;

        if (seedRackReady) {
          // Dev seeds share SAVE_KEY with real saves; keep a one-slot backup
          // so following a seed link cannot silently destroy a progression
          // save. A backup failure aborts into the load-error quarantine
          // below instead of clobbering the existing save.
          await backupSavedGameForSeed();
          if (cancelled) return;
          // Tests drive the hook without a seed URL; rack-ready stays the
          // default so a bare seed flag keeps its original meaning.
          restored = createDevSeedGameState(getDevSeedId() ?? "rack-ready");
          clearRackReadySeed();
        } else {
          const rawSave = await getSavedGame();
          if (cancelled) return;
          restored = deserializeSave(rawSave);
        }
        if (cancelled) return;

        const departureTimestamp =
          restored.time.departedAtMs ?? restored.time.lastSavedAtMs;
        const elapsedMs =
          departureTimestamp === null
            ? 0
            : Math.max(0, timestampMs - departureTimestamp);

        if (elapsedMs > 0) {
          setPersistenceStatus({
            phase: "hydrating",
            message: "Processing offline time…",
            lastSavedAtMs: restored.time.lastSavedAtMs,
            announcement: null,
          });
          const departureState =
            restored.time.departedAtMs === null
              ? recordDeparture(restored, departureTimestamp ?? timestampMs)
              : restored;
          if (cancelled) return;
          hydrationCatchupToken = catchupTokenRef.current + 1;
          catchupTokenRef.current = hydrationCatchupToken;
          setCatchupActive(true);
          const result = await runOfflineAdvance(
            departureState,
            elapsedMs,
            () =>
              cancelled ||
              catchupTokenRef.current !== hydrationCatchupToken,
          );
          if (
            cancelled ||
            result === null ||
            catchupTokenRef.current !== hydrationCatchupToken
          ) {
            return;
          }
          restored = result.state;
          setCatchupActive(false);
          hydrationCatchupToken = null;
        }

        if (cancelled) return;
        const hydrated = clearDeparture(restored, timestampMs);

        commitState(hydrated);
        setSelectedComponent("core:1");
        readyRef.current = true;
        setReady(true);
        if (cancelled) return;
        await persistState(hydrated, timestampMs, {
          announceSuccess: true,
          shouldIgnoreStatus: () => cancelled,
        });
        if (cancelled) return;
      } catch (error) {
        if (cancelled) return;
        writeBlockedRef.current = true;
        const fallback = createInitialGameState();
        commitState(fallback);
        readyRef.current = true;
        setReady(true);
        setPersistenceStatus({
          phase: "error",
          message: `Load failed: ${errorMessage(error, "Save unavailable.")}`,
          lastSavedAtMs: null,
          announcement: "assertive",
        });
      } finally {
        if (
          hydrationCatchupToken !== null &&
          catchupTokenRef.current === hydrationCatchupToken
        ) {
          setCatchupActive(false);
          hydrationCatchupToken = null;
        }
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
      if (
        hydrationCatchupToken !== null &&
        catchupTokenRef.current === hydrationCatchupToken
      ) {
        catchupTokenRef.current += 1;
        catchupActiveRef.current = false;
      }
    };
  }, [
    commitState,
    now,
    persistState,
    runOfflineAdvance,
    seedRackReady,
    setCatchupActive,
  ]);

  const persistCurrentState = useCallback(
    async (
      kind: "save" | "departure",
      strategy: "queued" | "immediate" = "queued",
    ): Promise<boolean> => {
      // True means the state is settled (written, or intentionally skipped);
      // false means a write was attempted and failed.
      if (!readyRef.current || writeBlockedRef.current) return true;
      if (kind === "save" && catchupActiveRef.current) return true;
      if (kind === "departure") invalidateCatchup();
      const timestampMs = now();
      let current = stateRef.current;
      const pendingForegroundMs = foregroundAccumulatedMsRef.current;
      if (
        pendingForegroundMs > 0 &&
        !pausedRef.current &&
        !catchupActiveRef.current
      ) {
        foregroundAccumulatedMsRef.current = 0;
        current = advanceGame(
          current,
          pendingForegroundMs,
          "foreground",
        ).state;
      }
      // A pending departure stamp means the offline interval since the
      // original departedAtMs was never applied (catch-up in flight or
      // failed). Re-stamping would silently drop that interval, so keep the
      // original departure and buffer snapshot and only refresh the save
      // timestamp.
      const stamped =
        kind === "departure" && current.time.departedAtMs === null
          ? recordDeparture(current, timestampMs)
          : recordSave(current, timestampMs);
      commitState(stamped);
      if (strategy === "immediate") {
        const sequence = saveSequenceRef.current + 1;
        saveSequenceRef.current = sequence;
        if (saveGameStateImmediate(stamped, timestampMs)) {
          durableWriteSequenceRef.current = sequence;
          return true;
        }
      }
      return persistState(stamped, timestampMs);
    },
    [commitState, invalidateCatchup, now, persistState],
  );

  const resumeFromDeparture = useCallback(async () => {
    if (
      !readyRef.current ||
      catchupActiveRef.current ||
      writeBlockedRef.current
    ) {
      return;
    }
    const departed = stateRef.current;
    const departedAtMs = departed.time.departedAtMs;
    if (departedAtMs === null) return;

    const sourceRevision = stateRevisionRef.current;
    const catchupToken = catchupTokenRef.current + 1;
    catchupTokenRef.current = catchupToken;
    setCatchupActive(true);
    const timestampMs = now();
    setPersistenceStatus({
      phase: "hydrating",
      message: "Processing offline time…",
      lastSavedAtMs: departed.time.lastSavedAtMs,
      announcement: null,
    });

    const resultIsStale = () =>
      catchupTokenRef.current !== catchupToken ||
      stateRevisionRef.current !== sourceRevision ||
      stateRef.current.time.departedAtMs !== departedAtMs;

    try {
      const elapsedMs = Math.max(0, timestampMs - departedAtMs);
      const result = await runOfflineAdvance(
        departed,
        elapsedMs,
        resultIsStale,
      );
      if (result === null || resultIsStale()) return;
      const returned = clearDeparture(result.state, timestampMs);
      commitState(returned);
      const returnedRevision = stateRevisionRef.current;
      await persistState(returned, timestampMs, {
        announceSuccess: true,
        shouldIgnoreStatus: () =>
          catchupTokenRef.current !== catchupToken ||
          stateRevisionRef.current !== returnedRevision,
      });
    } catch (error) {
      if (resultIsStale()) return;
      setPersistenceStatus({
        phase: "error",
        message: `Offline processing failed: ${errorMessage(
          error,
          "Unable to process elapsed time.",
        )}`,
        lastSavedAtMs: departed.time.lastSavedAtMs,
        announcement: "assertive",
      });
    } finally {
      if (catchupTokenRef.current === catchupToken) {
        setCatchupActive(false);
      }
    }
  }, [commitState, now, persistState, runOfflineAdvance, setCatchupActive]);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();

    const run = (time: number) => {
      const delta = Math.max(0, time - previous);
      previous = time;
      if (!readyRef.current) {
        resetForegroundClockRef.current = true;
        foregroundAccumulatedMsRef.current = 0;
      } else if (resetForegroundClockRef.current) {
        resetForegroundClockRef.current = false;
        foregroundAccumulatedMsRef.current = 0;
      } else if (
        !pausedRef.current &&
        !catchupActiveRef.current &&
        document.visibilityState !== "hidden"
      ) {
        foregroundAccumulatedMsRef.current += delta;
        if (
          foregroundAccumulatedMsRef.current >=
          FOREGROUND_ADVANCE_INTERVAL_MS
        ) {
          const elapsedMs = foregroundAccumulatedMsRef.current;
          foregroundAccumulatedMsRef.current = 0;
          setGameState((current) =>
            advanceGame(current, elapsedMs, "foreground").state,
          );
        }
      } else {
        foregroundAccumulatedMsRef.current = 0;
      }
      frame = requestAnimationFrame(run);
    };

    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, [setGameState]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!readyRef.current || document.visibilityState === "hidden") return;
      void persistCurrentState("save");
    }, saveIntervalMs);

    return () => window.clearInterval(interval);
  }, [persistCurrentState, saveIntervalMs]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      resetForegroundClockRef.current = true;
      if (document.visibilityState === "hidden") {
        void persistCurrentState("departure");
      } else {
        void resumeFromDeparture();
      }
    };
    const handlePageHide = () => {
      resetForegroundClockRef.current = true;
      void persistCurrentState("departure", "immediate");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [persistCurrentState, resumeFromDeparture]);

  useEffect(
    () =>
      idleBitLifecycle.onBeforeClose(({ requestId }) => {
        void (async () => {
          let settled = false;
          for (
            let attempt = 0;
            attempt < ELECTRON_CLOSE_SAVE_ATTEMPTS && !settled;
            attempt += 1
          ) {
            try {
              settled = await persistCurrentState("departure", "queued");
            } catch {
              settled = false;
            }
          }
          if (settled) {
            idleBitLifecycle.acknowledgeBeforeClose(requestId);
          }
          // When every attempt fails the close stays unacknowledged: the
          // main-process handshake timeout force-closes after its bounded
          // window and persists forced-close evidence instead of silently
          // authorizing the close over a dropped departure save.
        })();
      }),
    [persistCurrentState],
  );

  const setPaused = useCallback((paused: boolean) => {
    pausedRef.current = paused;
  }, []);

  const resetGame = useCallback(async () => {
    if (!readyRef.current || catchupActiveRef.current) return null;
    const wasWriteBlocked = writeBlockedRef.current;
    writeBlockedRef.current = false;
    const timestampMs = now();
    const freshState = clearDeparture(createInitialGameState(), timestampMs);
    setSelectedComponent("core:1");
    commitState(freshState);
    const persisted = await persistState(freshState, timestampMs, {
      allowBlockedWrite: true,
    });
    if (!persisted) {
      // The fresh save never reached storage, so the reset did not take
      // effect durably. Restore the previous write quarantine and report
      // failure so callers do not wipe preferences on top of a save that
      // will return on the next launch.
      writeBlockedRef.current = wasWriteBlocked;
      return null;
    }
    return freshState;
  }, [commitState, now, persistState]);

  return {
    state,
    setState: setGameState,
    selectedComponent,
    setSelectedComponent,
    ready,
    catchupActive,
    mutationsBlocked: !ready || catchupActive,
    persistenceStatus,
    setPaused,
    resetGame,
  };
}
