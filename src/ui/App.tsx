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
import { SystemWorkbench, type SelectedComponent } from "./components";
import type { UiGameAction } from "./uiActions";

const SAVE_KEY = "save-v2";
const DEADLOCK_HELP_KEY = "ui.deadlock-help-seen-v1";
const DEADLOCK_COOLDOWN_HELP_KEY = "ui.deadlock-cooldown-help-seen-v1";

export function App() {
  const [state, setState] = useState<GameState>(() => createInitialGameState());
  const [selectedComponent, setSelectedComponent] =
    useState<SelectedComponent>("core:1");
  const [resourceEffectsReady, setResourceEffectsReady] = useState(false);
  const [deadlockHelpSeen, setDeadlockHelpSeen] = useState<boolean | null>(null);
  const [deadlockCooldownHelpSeen, setDeadlockCooldownHelpSeen] =
    useState<boolean | null>(null);
  const stateRef = useRef(state);
  const pausedRef = useRef(false);
  const visible = useMemo(() => deriveVisibleState(state), [state]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      idleBitPersistence.get<string>(SAVE_KEY),
      idleBitPersistence.get<boolean>(DEADLOCK_HELP_KEY, false),
      idleBitPersistence.get<boolean>(DEADLOCK_COOLDOWN_HELP_KEY, false),
    ])
      .then(([rawSave, seenDeadlockHelp, seenDeadlockCooldownHelp]) => {
        if (!cancelled) {
          setState(deserializeSave(rawSave));
          setDeadlockHelpSeen(Boolean(seenDeadlockHelp));
          setDeadlockCooldownHelpSeen(Boolean(seenDeadlockCooldownHelp));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setResourceEffectsReady(true);
        }
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
      if (!pausedRef.current) {
        setState((current) => tickGame(current, delta));
      }
      frame = requestAnimationFrame(run);
    };

    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, []);

  const save = async (nextState: GameState) => {
    await idleBitPersistence.set(SAVE_KEY, serializeSave(nextState));
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      void save(stateRef.current);
    }, 4000);

    return () => window.clearInterval(interval);
  }, []);

  const dispatch = (action: UiGameAction) => {
    setState((current) => applyAction(current, action as GameAction));
  };

  const primaryDeadlockResource =
    resourceEffectsReady && deadlockHelpSeen === false
      ? (visible.metrics.deadlocks[0]?.resource ?? null)
      : null;
  const cooldownHelpResource =
    resourceEffectsReady &&
    deadlockHelpSeen === true &&
    deadlockCooldownHelpSeen === false
      ? (visible.metrics.deadlocks[0]?.resource ?? null)
      : null;
  const watchdogActive =
    Boolean(visible.metrics.systemSchedulerWatchdog) ||
    visible.metrics.cpuSockets.some((socket) => Boolean(socket.watchdog));

  useEffect(() => {
    pausedRef.current = Boolean(
      (primaryDeadlockResource || cooldownHelpResource) && !watchdogActive,
    );
  }, [primaryDeadlockResource, cooldownHelpResource, watchdogActive]);

  const dismissDeadlockHelp = () => {
    setDeadlockHelpSeen(true);
    void idleBitPersistence.set(DEADLOCK_HELP_KEY, true);
  };

  const dismissDeadlockCooldownHelp = () => {
    setDeadlockCooldownHelpSeen(true);
    void idleBitPersistence.set(DEADLOCK_COOLDOWN_HELP_KEY, true);
  };

  const reset = async () => {
    const freshState = createInitialGameState();
    setSelectedComponent("core:1");
    setState(freshState);
    await idleBitPersistence.set(SAVE_KEY, serializeSave(freshState));
  };

  return (
    <div className="app-shell">
      <SystemWorkbench
        visible={visible}
        dispatch={dispatch}
        selectedComponent={selectedComponent}
        onSelectComponent={setSelectedComponent}
        onReset={() => void reset()}
        animateResourceGains={resourceEffectsReady}
        deadlockHelpResource={primaryDeadlockResource}
        deadlockCooldownHelpResource={cooldownHelpResource}
        onDismissDeadlockHelp={dismissDeadlockHelp}
        onDismissDeadlockCooldownHelp={dismissDeadlockCooldownHelp}
      />
    </div>
  );
}
