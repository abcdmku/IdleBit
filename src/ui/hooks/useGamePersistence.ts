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
  createInitialGameState,
  createRackReadyGameState,
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
  clearRackReadySeed,
  getSavedGame,
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
          setPersistenceStatus({
            phase: "saved",
            message: "Saved",
            lastSavedAtMs: timestampMs,
            announcement: announceSuccess ? "polite" : null,
          });
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
          restored = createRackReadyGameState();
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
    ) => {
      if (!readyRef.current || writeBlockedRef.current) return;
      if (kind === "save" && catchupActiveRef.current) return;
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
      const stamped =
        kind === "departure"
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
      await persistState(stamped, timestampMs);
      return true;
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
          try {
            await persistCurrentState("departure", "queued");
          } finally {
            idleBitLifecycle.acknowledgeBeforeClose(requestId);
          }
        })();
      }),
    [persistCurrentState],
  );

  const setPaused = useCallback((paused: boolean) => {
    pausedRef.current = paused;
  }, []);

  const resetGame = useCallback(async () => {
    if (!readyRef.current || catchupActiveRef.current) return null;
    writeBlockedRef.current = false;
    const timestampMs = now();
    const freshState = clearDeparture(createInitialGameState(), timestampMs);
    setSelectedComponent("core:1");
    commitState(freshState);
    await persistState(freshState, timestampMs, { allowBlockedWrite: true });
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
