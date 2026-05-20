import { useCallback, useEffect, useRef, useState } from "react";
import {
  createInitialGameState,
  createRackReadyGameState,
  deserializeSave,
  tickGame,
  type GameState,
} from "../../game";
import type { SelectedComponent } from "../components";
import { clearRackReadySeed, getSavedGame, saveGameState } from "../app/persistence";

interface UseGamePersistenceOptions {
  seedRackReady: boolean;
}

export function useGamePersistence({ seedRackReady }: UseGamePersistenceOptions) {
  const [state, setState] = useState<GameState>(() => createInitialGameState());
  const [selectedComponent, setSelectedComponent] =
    useState<SelectedComponent>("core:1");
  const [ready, setReady] = useState(false);
  const stateRef = useRef(state);
  const pausedRef = useRef(false);
  const readyRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  useEffect(() => {
    let cancelled = false;

    if (seedRackReady) {
      void (async () => {
        const seededState = createRackReadyGameState();

        await saveGameState(seededState);

        if (!cancelled) {
          stateRef.current = seededState;
          setState(seededState);
          setSelectedComponent("core:1");
          clearRackReadySeed();
          setReady(true);
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const rawSave = await getSavedGame();
      const restoredState = deserializeSave(rawSave);

      if (!cancelled) {
        stateRef.current = restoredState;
        setState(restoredState);
        setReady(true);
      }
    })().catch(() => {
      if (!cancelled) {
        setReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [seedRackReady]);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();

    const run = (time: number) => {
      const delta = time - previous;
      previous = time;
      if (!pausedRef.current) {
        setState((current) => tickGame(current, delta));
      }
      frame = requestAnimationFrame(run);
    };

    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!readyRef.current) return;
      void saveGameState(stateRef.current);
    }, 4000);

    return () => window.clearInterval(interval);
  }, []);

  const setPaused = useCallback((paused: boolean) => {
    pausedRef.current = paused;
  }, []);

  const resetGame = useCallback(async () => {
    const freshState = createInitialGameState();

    setSelectedComponent("core:1");
    stateRef.current = freshState;
    setState(freshState);
    await saveGameState(freshState);

    return freshState;
  }, []);

  return {
    state,
    setState,
    selectedComponent,
    setSelectedComponent,
    ready,
    setPaused,
    resetGame,
  };
}
