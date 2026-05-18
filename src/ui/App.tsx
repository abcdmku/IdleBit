import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronRight, X } from "lucide-react";
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
const SECOND_CPU_GUIDE_KEY = "ui.second-cpu-guide-seen-v1";

interface SecondCpuGuideStep {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  targetSelector?: string;
}

interface GuideRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const SECOND_CPU_GUIDE_STEPS: SecondCpuGuideStep[] = [
  {
    id: "intro",
    eyebrow: "Automation layer online",
    title: "Automation comes online as your system grows.",
    body:
      "The second CPU unlocks your first real optimization loop: CRON can keep repeatable system work moving while you tune power, heat, reliability, and throughput that decide how far the rig can scale.",
  },
  {
    id: "automation",
    eyebrow: "Automation",
    title: "CRON keeps upkeep moving.",
    body:
      "This is the new heartbeat. Once researched, CRON can relaunch visible repeatable system tasks so the machine keeps producing maintenance work while you tune the bottlenecks around it.",
    targetSelector: ".cron-section",
  },
  {
    id: "system-scheduler",
    eyebrow: "Routing",
    title: "The System Scheduler feeds the machine.",
    body:
      "System tasks still enter here first. It owns the system queue, checks RAM pressure, and hands CPU work down to the CPU schedulers when the machine has room to run it.",
    targetSelector: ".system-scheduler-section",
  },
  {
    id: "ram",
    eyebrow: "Staging",
    title: "RAM decides whether system work can flow.",
    body:
      "Automation can create demand faster than CPUs can consume it. RAM size and frequency decide how much system work can stage before the CPU packages ever get a turn.",
    targetSelector: ".memory-section",
  },
  {
    id: "cpu-packages",
    eyebrow: "Throughput",
    title: "CPU packages still do the hard work.",
    body:
      "Automation creates the loop, but CPU schedulers, cache, and cores decide when work actually runs. If these back up, tune local queue slots, cache, or core speed.",
    targetSelector: ".cpu-package",
  },
  {
    id: "psu",
    eyebrow: "Power",
    title: "Power turns growth into a budget.",
    body:
      "The PSU is where scaling starts to cost something. Watch draw, billing, states, and headroom so automation keeps earning more than the machine spends to stay awake.",
    targetSelector: ".psu-section",
  },
  {
    id: "thermal",
    eyebrow: "Heat",
    title: "Thermal control keeps speed sustainable.",
    body:
      "More work and higher clocks create pressure. Cooling buys room for sustained throughput, but it draws power too, so heat becomes another tuning choice instead of a flat upgrade.",
    targetSelector: ".thermal-section",
  },
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getSpotlightStyle = (rect: GuideRect): CSSProperties => ({
  top: `${Math.max(8, rect.top - 7)}px`,
  left: `${Math.max(8, rect.left - 7)}px`,
  width: `${Math.max(0, rect.width + 14)}px`,
  height: `${Math.max(0, rect.height + 14)}px`,
});

const getPopoverStyle = (rect: GuideRect): CSSProperties => {
  const padding = 16;
  const gap = 14;
  const width = Math.min(380, window.innerWidth - padding * 2);
  const estimatedHeight = 238;
  const rectRight = rect.left + rect.width;
  const canSitRight = rectRight + gap + width <= window.innerWidth - padding;
  const canSitLeft = rect.left - gap - width >= padding;
  const left = canSitRight
    ? rectRight + gap
    : canSitLeft
      ? rect.left - gap - width
      : clamp(rect.left, padding, window.innerWidth - width - padding);

  return {
    left: `${left}px`,
    top: `${clamp(
      rect.top,
      padding,
      Math.max(padding, window.innerHeight - estimatedHeight - padding),
    )}px`,
    width: `${width}px`,
  };
};

export function App() {
  const [state, setState] = useState<GameState>(() => createInitialGameState());
  const [selectedComponent, setSelectedComponent] =
    useState<SelectedComponent>("core:1");
  const [resourceEffectsReady, setResourceEffectsReady] = useState(false);
  const [deadlockHelpSeen, setDeadlockHelpSeen] = useState<boolean | null>(null);
  const [deadlockCooldownHelpSeen, setDeadlockCooldownHelpSeen] =
    useState<boolean | null>(null);
  const [secondCpuGuideSeen, setSecondCpuGuideSeen] = useState<boolean | null>(null);
  const [secondCpuGuideOpen, setSecondCpuGuideOpen] = useState(false);
  const stateRef = useRef(state);
  const pausedRef = useRef(false);
  const persistenceReadyRef = useRef(false);
  const previousSecondCpuRef = useRef(false);
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
      idleBitPersistence.get<boolean>(SECOND_CPU_GUIDE_KEY, false),
    ])
      .then(([
        rawSave,
        seenDeadlockHelp,
        seenDeadlockCooldownHelp,
        seenSecondCpuGuide,
      ]) => {
        if (!cancelled) {
          const restoredState = deserializeSave(rawSave);
          stateRef.current = restoredState;
          setState(restoredState);
          setDeadlockHelpSeen(Boolean(seenDeadlockHelp));
          setDeadlockCooldownHelpSeen(Boolean(seenDeadlockCooldownHelp));
          setSecondCpuGuideSeen(Boolean(seenSecondCpuGuide));
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
  const watchdogActive =
    Boolean(visible.metrics.systemSchedulerWatchdog) ||
    visible.metrics.cpuSockets.some((socket) => Boolean(socket.watchdog));

  useEffect(() => {
    if (!resourceEffectsReady || secondCpuGuideSeen === null) return;

    if (secondCpuGuideSeen) {
      previousSecondCpuRef.current = visible.hardware.secondCpu;
      return;
    }

    const wasSecondCpu = previousSecondCpuRef.current;
    const isSecondCpu = visible.hardware.secondCpu;

    if (isSecondCpu && !wasSecondCpu) {
      setSecondCpuGuideOpen(true);
    }

    previousSecondCpuRef.current = isSecondCpu;
  }, [resourceEffectsReady, secondCpuGuideSeen, visible.hardware.secondCpu]);

  useEffect(() => {
    pausedRef.current = Boolean(
      secondCpuGuideOpen ||
        ((primaryDeadlockResource || cooldownHelpResource) && !watchdogActive),
    );
  }, [
    primaryDeadlockResource,
    cooldownHelpResource,
    watchdogActive,
    secondCpuGuideOpen,
  ]);

  const dismissDeadlockHelp = () => {
    setDeadlockHelpSeen(true);
    void idleBitPersistence.set(DEADLOCK_HELP_KEY, true);
  };

  const dismissDeadlockCooldownHelp = () => {
    setDeadlockCooldownHelpSeen(true);
    void idleBitPersistence.set(DEADLOCK_COOLDOWN_HELP_KEY, true);
  };

  const dismissSecondCpuGuide = () => {
    setSecondCpuGuideOpen(false);
    setSecondCpuGuideSeen(true);
    void idleBitPersistence.set(SECOND_CPU_GUIDE_KEY, true);
  };

  const reset = async () => {
    const freshState = createInitialGameState();
    setSelectedComponent("core:1");
    setSecondCpuGuideOpen(false);
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
        onDismissDeadlockHelp={dismissDeadlockHelp}
        onDismissDeadlockCooldownHelp={dismissDeadlockCooldownHelp}
      />
      {secondCpuGuideOpen && (
        <SecondCpuGuideModal onDismiss={dismissSecondCpuGuide} />
      )}
    </div>
  );
}

function SecondCpuGuideModal({ onDismiss }: { onDismiss: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<GuideRect | null>(null);
  const currentStep = SECOND_CPU_GUIDE_STEPS[stepIndex] ?? SECOND_CPU_GUIDE_STEPS[0]!;
  const finalStep = stepIndex === SECOND_CPU_GUIDE_STEPS.length - 1;
  const titleId = "second-cpu-guide-title";
  const bodyId = "second-cpu-guide-body";

  useEffect(() => {
    const selector = currentStep.targetSelector;

    if (!selector) {
      setTargetRect(null);
      return undefined;
    }

    const target = document.querySelector<HTMLElement>(selector);
    if (!target) {
      setTargetRect(null);
      return undefined;
    }

    let frame = 0;
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "auto",
      });
    }

    const measureTarget = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        setTargetRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      });
    };

    measureTarget();
    window.addEventListener("resize", measureTarget);
    window.addEventListener("scroll", measureTarget, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measureTarget);
      window.removeEventListener("scroll", measureTarget, true);
    };
  }, [currentStep.targetSelector]);

  const advanceGuide = () => {
    if (finalStep) {
      onDismiss();
      return;
    }

    setStepIndex((current) =>
      Math.min(current + 1, SECOND_CPU_GUIDE_STEPS.length - 1),
    );
  };

  return (
    <div
      className={`second-cpu-guide-overlay ${
        targetRect ? "spotlighting" : ""
      }`}
    >
      {targetRect && (
        <span
          className="second-cpu-guide-spotlight"
          style={getSpotlightStyle(targetRect)}
          aria-hidden="true"
        />
      )}
      <section
        className={`second-cpu-guide-modal ${
          targetRect ? "anchored" : "centered"
        }`}
        style={targetRect ? getPopoverStyle(targetRect) : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <div className="second-cpu-guide-header">
          <div>
            <span>{currentStep.eyebrow}</span>
            <strong id={titleId}>{currentStep.title}</strong>
          </div>
          <button
            type="button"
            className="second-cpu-guide-close"
            onClick={onDismiss}
            aria-label="Close second CPU guide"
          >
            <X size={15} />
          </button>
        </div>

        <p id={bodyId} className="second-cpu-guide-intro">
          {currentStep.body}
        </p>

        <div className="second-cpu-guide-footer">
          <span>
            {stepIndex + 1} / {SECOND_CPU_GUIDE_STEPS.length}
          </span>
          <button
            type="button"
            className="second-cpu-guide-primary"
            onClick={advanceGuide}
          >
            {finalStep ? (
              <>
                Start automating
                <Check size={14} />
              </>
            ) : (
              <>
                Next
                <ChevronRight size={14} />
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}
