import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, TriangleAlert, X } from "lucide-react";
import {
  applyAction,
  createInitialGameState,
  createRackReadyGameState,
  deriveVisibleState,
  deserializeSave,
  serializeSave,
  tickGame,
  type GameState,
} from "../game";
import { idleBitPersistence } from "../platform";
import { SystemWorkbench, type SelectedComponent } from "./components";
import { toGameAction, type UiGameAction } from "./uiActions";

const SAVE_KEY = "save-v3";
const DEADLOCK_HELP_KEY = "ui.deadlock-help-seen-v1";
const DEADLOCK_COOLDOWN_HELP_KEY = "ui.deadlock-cooldown-help-seen-v1";
const PSU_FAILURE_HELP_KEY = "ui.psu-failure-help-seen-v1";
const PSU_FAILURE_MODAL_SEEN_KEY = "ui.psu-failure-modal-seen-v1";
const CREDIT_FAILURE_MODAL_SEEN_KEY = "ui.credit-failure-modal-seen-v1";
const PINNED_TASKS_KEY = "ui.pinned-tasks-v1";
const SEEN_TASKS_KEY = "ui.seen-tasks-v1";
const SEEN_RESEARCH_KEY = "ui.seen-research-v1";
const SEED_PARAM = "seed";
const RACK_READY_SEED = "rack-ready";

type UnlockSection = "tasks" | "research";

const toStoredIds = (value: unknown) =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter((id): id is string => typeof id === "string")))
    : [];

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
  const [seenTaskIds, setSeenTaskIds] = useState<string[]>([]);
  const [seenResearchIds, setSeenResearchIds] = useState<string[]>([]);
  const stateRef = useRef(state);
  const pausedRef = useRef(false);
  const persistenceReadyRef = useRef(false);
  const visible = useMemo(() => deriveVisibleState(state), [state]);
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
  const newTaskUnlockCount = resourceEffectsReady
    ? visibleTaskIds.filter((id) => !seenTaskIdSet.has(id)).length
    : 0;
  const newResearchUnlockCount = resourceEffectsReady
    ? visibleResearchIds.filter((id) => !seenResearchIdSet.has(id)).length
    : 0;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    const seed = new URLSearchParams(window.location.search).get(SEED_PARAM);

    if (seed === RACK_READY_SEED) {
      void (async () => {
        const seededState = createRackReadyGameState();

        try {
          await Promise.all([
            idleBitPersistence.set(SAVE_KEY, serializeSave(seededState)),
            idleBitPersistence.set(DEADLOCK_HELP_KEY, false),
            idleBitPersistence.set(DEADLOCK_COOLDOWN_HELP_KEY, false),
            idleBitPersistence.set(PSU_FAILURE_HELP_KEY, false),
            idleBitPersistence.set(PSU_FAILURE_MODAL_SEEN_KEY, false),
            idleBitPersistence.set(CREDIT_FAILURE_MODAL_SEEN_KEY, false),
            idleBitPersistence.set(PINNED_TASKS_KEY, []),
            idleBitPersistence.set(SEEN_TASKS_KEY, []),
            idleBitPersistence.set(SEEN_RESEARCH_KEY, []),
          ]);
        } catch {
          // Seeding should still work in memory if persistence is unavailable.
        }

        if (!cancelled) {
          stateRef.current = seededState;
          setState(seededState);
          setSelectedComponent("core:1");
          setDeadlockHelpSeen(false);
          setDeadlockCooldownHelpSeen(false);
          setPsuFailureHelpSeen(false);
          setPsuFailureModalSeen(false);
          setCreditFailureModalSeen(false);
          setPinnedTaskIds([]);
          setSeenTaskIds([]);
          setSeenResearchIds([]);
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${window.location.hash}`,
          );
          persistenceReadyRef.current = true;
          setResourceEffectsReady(true);
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    Promise.all([
      idleBitPersistence.get<string>(SAVE_KEY),
      idleBitPersistence.get<boolean>(DEADLOCK_HELP_KEY, false),
      idleBitPersistence.get<boolean>(DEADLOCK_COOLDOWN_HELP_KEY, false),
      idleBitPersistence.get<boolean>(PSU_FAILURE_HELP_KEY, false),
      idleBitPersistence.get<boolean>(PSU_FAILURE_MODAL_SEEN_KEY, false),
      idleBitPersistence.get<boolean>(CREDIT_FAILURE_MODAL_SEEN_KEY, false),
      idleBitPersistence.get<string[]>(PINNED_TASKS_KEY, []),
      idleBitPersistence.get<string[]>(SEEN_TASKS_KEY, []),
      idleBitPersistence.get<string[]>(SEEN_RESEARCH_KEY, []),
    ])
      .then(([
        rawSave,
        seenDeadlockHelp,
        seenDeadlockCooldownHelp,
        seenPsuFailureHelp,
        seenPsuFailureModal,
        seenCreditFailureModal,
        savedPinnedTaskIds,
        savedSeenTaskIds,
        savedSeenResearchIds,
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
          setPinnedTaskIds(toStoredIds(savedPinnedTaskIds));
          setSeenTaskIds(toStoredIds(savedSeenTaskIds));
          setSeenResearchIds(toStoredIds(savedSeenResearchIds));
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

  const markVisibleUnlocksSeen = useCallback(
    (section: UnlockSection) => {
      if (!resourceEffectsReady) return;

      if (section === "tasks") {
        setSeenTaskIds((current) => {
          const next = appendUnseenIds(current, visibleTaskIds);
          if (next === current) return current;
          void idleBitPersistence.set(SEEN_TASKS_KEY, next);
          return next;
        });
        return;
      }

      setSeenResearchIds((current) => {
        const next = appendUnseenIds(current, visibleResearchIds);
        if (next === current) return current;
        void idleBitPersistence.set(SEEN_RESEARCH_KEY, next);
        return next;
      });
    },
    [resourceEffectsReady, visibleResearchIds, visibleTaskIds],
  );

  const reset = async () => {
    const freshState = createInitialGameState();
    setSelectedComponent("core:1");
    stateRef.current = freshState;
    setState(freshState);
    setSeenTaskIds([]);
    setSeenResearchIds([]);
    await Promise.all([
      idleBitPersistence.set(SAVE_KEY, serializeSave(freshState)),
      idleBitPersistence.set(SEEN_TASKS_KEY, []),
      idleBitPersistence.set(SEEN_RESEARCH_KEY, []),
    ]);
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
        newTaskUnlockCount={newTaskUnlockCount}
        newResearchUnlockCount={newResearchUnlockCount}
        onSectionViewed={markVisibleUnlocksSeen}
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
        <p id={bodyId}>
          The power bill drained your balance. Reboot for a brief grace period
          before billing resumes.
        </p>
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
          The power bill drained your credits, so the PSU shut down before the
          balance could go negative — even idle hardware draws cr/s. Reboot
          for a brief grace period before billing resumes. Use it to earn
          credits, lower your draw, or power off when idle to avoid another
          cutoff.
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
