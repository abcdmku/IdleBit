import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, TriangleAlert, X } from "lucide-react";
import {
  applyAction,
  createInitialGameState,
  deriveVisibleState,
  deserializeSave,
  serializeSave,
  tickGame,
  type GameState,
} from "../game";
import { idleBitPersistence } from "../platform";
import { SystemWorkbench, type SelectedComponent } from "./components";
import { toGameAction, type UiGameAction } from "./uiActions";

const SAVE_KEY = "save-v2";
const DEADLOCK_HELP_KEY = "ui.deadlock-help-seen-v1";
const DEADLOCK_COOLDOWN_HELP_KEY = "ui.deadlock-cooldown-help-seen-v1";
const PSU_FAILURE_HELP_KEY = "ui.psu-failure-help-seen-v1";
const PSU_FAILURE_MODAL_SEEN_KEY = "ui.psu-failure-modal-seen-v1";
const CREDIT_FAILURE_MODAL_SEEN_KEY = "ui.credit-failure-modal-seen-v1";
const PINNED_TASKS_KEY = "ui.pinned-tasks-v1";

export function App() {
  const [state, setState] = useState<GameState>(() => createInitialGameState());
  const [selectedComponent, setSelectedComponent] =
    useState<SelectedComponent>("core:1");
  const [resourceEffectsReady, setResourceEffectsReady] = useState(false);
  const [deadlockHelpSeen, setDeadlockHelpSeen] = useState<boolean | null>(null);
  const [deadlockCooldownHelpSeen, setDeadlockCooldownHelpSeen] =
    useState<boolean | null>(null);
  const [psuFailureHelpSeen, setPsuFailureHelpSeen] =
    useState<boolean | null>(null);
  const [psuFailureModalSeen, setPsuFailureModalSeen] =
    useState<boolean | null>(null);
  const [creditFailureModalSeen, setCreditFailureModalSeen] =
    useState<boolean | null>(null);
  const [pinnedTaskIds, setPinnedTaskIds] = useState<string[]>([]);
  const stateRef = useRef(state);
  const pausedRef = useRef(false);
  const persistenceReadyRef = useRef(false);
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
      idleBitPersistence.get<boolean>(PSU_FAILURE_HELP_KEY, false),
      idleBitPersistence.get<boolean>(PSU_FAILURE_MODAL_SEEN_KEY, false),
      idleBitPersistence.get<boolean>(CREDIT_FAILURE_MODAL_SEEN_KEY, false),
      idleBitPersistence.get<string[]>(PINNED_TASKS_KEY, []),
    ])
      .then(([
        rawSave,
        seenDeadlockHelp,
        seenDeadlockCooldownHelp,
        seenPsuFailureHelp,
        seenPsuFailureModal,
        seenCreditFailureModal,
        savedPinnedTaskIds,
      ]) => {
        if (!cancelled) {
          const restoredState = deserializeSave(rawSave);
          stateRef.current = restoredState;
          setState(restoredState);
          setDeadlockHelpSeen(Boolean(seenDeadlockHelp));
          setDeadlockCooldownHelpSeen(Boolean(seenDeadlockCooldownHelp));
          setPsuFailureHelpSeen(Boolean(seenPsuFailureHelp));
          setPsuFailureModalSeen(Boolean(seenPsuFailureModal));
          setCreditFailureModalSeen(Boolean(seenCreditFailureModal));
          if (Array.isArray(savedPinnedTaskIds)) {
            setPinnedTaskIds(
              savedPinnedTaskIds.filter((id): id is string => typeof id === "string"),
            );
          }
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          persistenceReadyRef.current = true;
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
    try {
      await idleBitPersistence.set(SAVE_KEY, serializeSave(nextState));
    } catch {
      // A failed save should never crash the renderer or wipe the in-memory run.
    }
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!persistenceReadyRef.current) return;
      void save(stateRef.current);
    }, 4000);

    return () => window.clearInterval(interval);
  }, []);

  const dispatch = (action: UiGameAction) => {
    setState((current) => applyAction(current, toGameAction(action)));
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
  const showPsuFailureHelp =
    resourceEffectsReady &&
    psuFailureHelpSeen === false &&
    visible.metrics.powerOverloadFailure.active &&
    (visible.metrics.powerState === "on" ||
      visible.metrics.powerState === "shuttingDown");
  const hasPsuFailureNotice =
    resourceEffectsReady && state.power.lastFailureReason === "psuOverload";
  const hasCreditFailureNotice =
    resourceEffectsReady && state.power.lastFailureReason === "unpaidBill";
  const showPsuFailureModal =
    hasPsuFailureNotice && psuFailureModalSeen === false;
  const showPsuFailureBadge =
    hasPsuFailureNotice && psuFailureModalSeen === true;
  const showCreditFailurePopup = hasCreditFailureNotice;
  const watchdogActive =
    Boolean(visible.metrics.systemSchedulerWatchdog) ||
    visible.metrics.cpuSockets.some((socket) => Boolean(socket.watchdog));

  useEffect(() => {
    pausedRef.current = Boolean(
      showPsuFailureModal ||
        showCreditFailurePopup ||
        ((primaryDeadlockResource || cooldownHelpResource) && !watchdogActive) ||
        showPsuFailureHelp,
    );
  }, [
    primaryDeadlockResource,
    cooldownHelpResource,
    showCreditFailurePopup,
    showPsuFailureModal,
    showPsuFailureHelp,
    watchdogActive,
  ]);

  const dismissDeadlockHelp = () => {
    setDeadlockHelpSeen(true);
    void idleBitPersistence.set(DEADLOCK_HELP_KEY, true);
  };

  const dismissDeadlockCooldownHelp = () => {
    setDeadlockCooldownHelpSeen(true);
    void idleBitPersistence.set(DEADLOCK_COOLDOWN_HELP_KEY, true);
  };

  const dismissPsuFailureHelp = () => {
    setPsuFailureHelpSeen(true);
    void idleBitPersistence.set(PSU_FAILURE_HELP_KEY, true);
  };

  const dismissPsuFailureModal = () => {
    setPsuFailureModalSeen(true);
    void idleBitPersistence.set(PSU_FAILURE_MODAL_SEEN_KEY, true);
    dispatch({ type: "acknowledgePowerFailure" });
  };

  const dismissPsuFailureBadge = () => {
    dispatch({ type: "acknowledgePowerFailure" });
  };

  const dismissCreditFailurePopup = () => {
    if (creditFailureModalSeen === false) {
      setCreditFailureModalSeen(true);
      void idleBitPersistence.set(CREDIT_FAILURE_MODAL_SEEN_KEY, true);
    }
    dispatch({ type: "acknowledgePowerFailure" });
  };

  const persistPinnedTaskIds = useCallback((next: string[]) => {
    void idleBitPersistence.set(PINNED_TASKS_KEY, next);
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

  const reset = async () => {
    const freshState = createInitialGameState();
    setSelectedComponent("core:1");
    stateRef.current = freshState;
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
        showPsuFailureHelp={showPsuFailureHelp}
        showPsuFailureNotice={showPsuFailureBadge}
        onDismissDeadlockHelp={dismissDeadlockHelp}
        onDismissDeadlockCooldownHelp={dismissDeadlockCooldownHelp}
        onDismissPsuFailureHelp={dismissPsuFailureHelp}
        onDismissPsuFailureNotice={dismissPsuFailureBadge}
        pinnedTaskIds={pinnedTaskIds}
        onTogglePinnedTask={togglePinnedTask}
        onUnpinTask={unpinTask}
        onClearPinnedTasks={clearPinnedTasks}
      />
      {showPsuFailureModal && (
        <PsuFailureModal onDismiss={dismissPsuFailureModal} />
      )}
      {showCreditFailurePopup && (
        <CreditFailurePopup
          firstTime={creditFailureModalSeen === false}
          onDismiss={dismissCreditFailurePopup}
        />
      )}
    </div>
  );
}

function PsuFailureModal({ onDismiss }: { onDismiss: () => void }) {
  const titleId = "psu-failure-title";
  const bodyId = "psu-failure-body";

  return (
    <div className="psu-failure-overlay">
      <section
        className="psu-failure-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <div className="psu-failure-header">
          <span id={titleId}>
            <TriangleAlert size={20} />
            PSU failure
          </span>
          <button
            type="button"
            className="psu-failure-close"
            onClick={onDismiss}
            aria-label="Close PSU failure notice"
          >
            <X size={17} />
          </button>
        </div>

        <p id={bodyId}>
          Draw stayed above the PSU rating until overload protection tripped.
          The system shut off and cleared active and queued work. Increase PSU
          capacity or reduce load before rebooting.
        </p>

        <button type="button" className="psu-failure-primary" onClick={onDismiss}>
          Understood
          <Check size={15} />
        </button>
      </section>
    </div>
  );
}

function CreditFailurePopup({
  firstTime,
  onDismiss,
}: {
  firstTime: boolean;
  onDismiss: () => void;
}) {
  const titleId = "credit-failure-title";
  const bodyId = "credit-failure-body";

  if (!firstTime) {
    return (
      <aside
        className="credit-failure-toast"
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <span id={titleId}>
          <TriangleAlert size={16} />
          Out of credits
        </span>
        <p id={bodyId}>Power billing shut the system off.</p>
        <button type="button" onClick={onDismiss}>
          Got it
        </button>
      </aside>
    );
  }

  return (
    <div className="credit-failure-overlay">
      <section
        className="credit-failure-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <div className="credit-failure-header">
          <span id={titleId}>
            <TriangleAlert size={20} />
            Out of credits
          </span>
          <button
            type="button"
            className="credit-failure-close"
            onClick={onDismiss}
            aria-label="Close credit failure notice"
          >
            <X size={17} />
          </button>
        </div>

        <p id={bodyId}>
          Power billing spent the last credits while the system was on. Idle
          hardware still costs cr/s, so the PSU shut down instead of letting
          credits go negative. Earn credits, reduce draw, or power off when
          idle before rebooting.
        </p>

        <button
          type="button"
          className="credit-failure-primary"
          onClick={onDismiss}
        >
          Understood
          <Check size={15} />
        </button>
      </section>
    </div>
  );
}
