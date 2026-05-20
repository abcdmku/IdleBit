import { useCallback, useEffect, useMemo } from "react";
import { applyAction, deriveVisibleState } from "../game";
import { SystemWorkbench } from "./components";
import { CreditFailurePopup, PsuFailureModal } from "./FailureNotices";
import { isRackReadySeed } from "./app/persistence";
import { useGamePersistence } from "./hooks/useGamePersistence";
import { useNoticePreferences } from "./hooks/useNoticePreferences";
import { usePinnedUnlockPreferences } from "./hooks/usePinnedUnlockPreferences";
import { toGameAction, type UiGameAction } from "./uiActions";

export function App() {
  const seedRackReady = useMemo(() => isRackReadySeed(), []);
  const game = useGamePersistence({ seedRackReady });
  const noticePreferences = useNoticePreferences({ seedRackReady });
  const {
    state,
    setState,
    selectedComponent,
    setSelectedComponent,
    ready: gameReady,
    setPaused,
    resetGame,
  } = game;
  const {
    ready: noticesReady,
    deadlockHelpSeen,
    deadlockCooldownHelpSeen,
    psuFailureHelpSeen,
    psuFailureModalSeen,
    creditFailureModalSeen,
    dismissDeadlockHelp,
    dismissDeadlockCooldownHelp,
    dismissPsuFailureHelp,
    dismissPsuFailureModal: markPsuFailureModalSeen,
    dismissCreditFailurePopup: markCreditFailurePopupSeen,
  } = noticePreferences;
  const visible = useMemo(() => deriveVisibleState(state), [state]);
  const pinnedUnlockPreferences = usePinnedUnlockPreferences({
    seedRackReady,
    trackingReady: gameReady && noticesReady,
    visible,
  });
  const {
    ready: pinnedUnlocksReady,
    pinnedTaskIds,
    newTaskUnlockCount: pendingTaskUnlockCount,
    newResearchUnlockCount: pendingResearchUnlockCount,
    togglePinnedTask,
    unpinTask,
    clearPinnedTasks,
    markVisibleUnlocksSeen,
    resetPinnedUnlockPreferences,
  } = pinnedUnlockPreferences;
  const resourceEffectsReady =
    gameReady && noticesReady && pinnedUnlocksReady;
  const newTaskUnlockCount = resourceEffectsReady
    ? pendingTaskUnlockCount
    : 0;
  const newResearchUnlockCount = resourceEffectsReady
    ? pendingResearchUnlockCount
    : 0;

  const dispatch = useCallback(
    (action: UiGameAction) => {
      setState((current) => applyAction(current, toGameAction(action)));
    },
    [setState],
  );

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
    setPaused(
      Boolean(
        showPsuFailureModal ||
          showCreditFailurePopup ||
          ((primaryDeadlockResource || cooldownHelpResource) && !watchdogActive) ||
          showPsuFailureHelp,
      ),
    );
  }, [
    cooldownHelpResource,
    primaryDeadlockResource,
    setPaused,
    showCreditFailurePopup,
    showPsuFailureHelp,
    showPsuFailureModal,
    watchdogActive,
  ]);

  const dismissPsuFailureModal = useCallback(() => {
    markPsuFailureModalSeen();
    dispatch({ type: "acknowledgePowerFailure" });
  }, [dispatch, markPsuFailureModalSeen]);

  const dismissPsuFailureBadge = useCallback(() => {
    dispatch({ type: "acknowledgePowerFailure" });
  }, [dispatch]);

  const dismissCreditFailurePopup = useCallback(() => {
    if (creditFailureModalSeen === false) {
      markCreditFailurePopupSeen();
    }
    dispatch({ type: "acknowledgePowerFailure" });
  }, [creditFailureModalSeen, dispatch, markCreditFailurePopupSeen]);

  const reset = useCallback(async () => {
    await resetGame();
    await resetPinnedUnlockPreferences();
  }, [resetGame, resetPinnedUnlockPreferences]);

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
