import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyAction,
  createInitialGameState,
  deriveVisibleState,
  deserializeSave,
  serializeSave,
  tickGame,
  type GameAction,
  type GameState,
} from "../game";
import { idleBitPersistence } from "../platform";
import { CpuBoard, Header, JobPanel, UpgradePanel } from "./components";

const SAVE_KEY = "save-v1";

export function App() {
  const [state, setState] = useState<GameState>(() => createInitialGameState());
  const [saveStatus, setSaveStatus] = useState("Loading");
  const stateRef = useRef(state);
  const visible = useMemo(() => deriveVisibleState(state), [state]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let cancelled = false;

    idleBitPersistence
      .get<string>(SAVE_KEY)
      .then((rawSave) => {
        if (!cancelled) {
          setState(deserializeSave(rawSave));
          setSaveStatus(`Ready: ${idleBitPersistence.driver}`);
        }
      })
      .catch(() => {
        if (!cancelled) setSaveStatus("Unsaved");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();

    const run = (time: number) => {
      const delta = time - previous;
      previous = time;
      setState((current) => tickGame(current, delta));
      frame = requestAnimationFrame(run);
    };

    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, []);

  const save = async (nextState: GameState) => {
    await idleBitPersistence.set(SAVE_KEY, serializeSave(nextState));
    setSaveStatus("Saved");
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      void save(stateRef.current);
    }, 4000);

    return () => window.clearInterval(interval);
  }, []);

  const dispatch = (action: GameAction) => {
    setState((current) => applyAction(current, action));
  };

  const reset = async () => {
    const freshState = createInitialGameState();
    setState(freshState);
    await idleBitPersistence.set(SAVE_KEY, serializeSave(freshState));
    setSaveStatus("Reset");
  };

  return (
    <div className="app-shell">
      <Header
        visible={visible}
        saveStatus={saveStatus}
        onSave={() => void save(state)}
        onReset={() => void reset()}
      />
      <div className="game-layout">
        <JobPanel state={state} visible={visible} dispatch={dispatch} />
        <CpuBoard visible={visible} />
        <UpgradePanel visible={visible} dispatch={dispatch} />
      </div>
    </div>
  );
}

