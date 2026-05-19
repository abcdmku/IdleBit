import { useEffect, useRef, useState } from "react";
import { Activity, Cpu, ListTodo, TriangleAlert } from "lucide-react";
import type { DeadlockResource, VisibleState } from "../game";
import {
  HardwareBoard,
  PinnedTaskBar,
  ResearchPanel,
  ResourceHud,
  TaskBay,
} from "./HardwareBoard";
import type { Dispatch } from "./uiActions";
import { getVisibleSelection, type SelectedComponent } from "./workbenchData";

export type { SelectedComponent } from "./workbenchData";

type SectionKey = "tasks" | "hardware" | "research";
type UnlockSectionKey = Exclude<SectionKey, "hardware">;

const getAlertScrollBehavior = (): ScrollBehavior => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "smooth";
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
};

interface SystemWorkbenchProps {
  visible: VisibleState;
  dispatch: Dispatch;
  selectedComponent: SelectedComponent;
  onSelectComponent: (component: SelectedComponent) => void;
  onReset: () => void;
  animateResourceGains: boolean;
  deadlockHelpResource?: DeadlockResource | null;
  deadlockCooldownHelpResource?: DeadlockResource | null;
  showPsuFailureHelp?: boolean;
  showPsuFailureNotice?: boolean;
  onDismissDeadlockHelp?: () => void;
  onDismissDeadlockCooldownHelp?: () => void;
  onDismissPsuFailureHelp?: () => void;
  onDismissPsuFailureNotice?: () => void;
  pinnedTaskIds: string[];
  onTogglePinnedTask: (taskId: string) => void;
  onUnpinTask: (taskId: string) => void;
  onClearPinnedTasks: () => void;
  newTaskUnlockCount?: number;
  newResearchUnlockCount?: number;
  onSectionViewed?: (section: UnlockSectionKey) => void;
}

function useIsMobile(breakpoint = 760) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);

  return isMobile;
}

function getTaskCount(visible: VisibleState) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks = (visible as any).tasks as unknown[] | undefined;
  return tasks?.length ?? 0;
}

function getResearchCount(visible: VisibleState) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const research = (visible as any).research as Array<{ purchased?: boolean; completed?: boolean }> | undefined;
  return (research ?? []).filter((r) => !r.purchased && !r.completed).length;
}

export function SystemWorkbench({
  visible,
  dispatch,
  selectedComponent,
  onSelectComponent,
  onReset,
  animateResourceGains,
  deadlockHelpResource = null,
  deadlockCooldownHelpResource = null,
  showPsuFailureHelp = false,
  showPsuFailureNotice = false,
  onDismissDeadlockHelp,
  onDismissDeadlockCooldownHelp,
  onDismissPsuFailureHelp,
  onDismissPsuFailureNotice,
  pinnedTaskIds,
  onTogglePinnedTask,
  onUnpinTask,
  onClearPinnedTasks,
  newTaskUnlockCount = 0,
  newResearchUnlockCount = 0,
  onSectionViewed,
}: SystemWorkbenchProps) {
  const component = getVisibleSelection(visible, selectedComponent);
  const isMobile = useIsMobile();
  const hardwarePanelRef = useRef<HTMLElement | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>("hardware");

  const taskCount = getTaskCount(visible);
  const researchCount = getResearchCount(visible);
  const coreCount = visible.hardware.cores;
  const hasNewTasks = newTaskUnlockCount > 0;
  const hasNewResearch = newResearchUnlockCount > 0;
  const alertTarget =
    showPsuFailureHelp ? "psu" : deadlockHelpResource ?? deadlockCooldownHelpResource;

  useEffect(() => {
    if (!isMobile || !alertTarget) return;
    setActiveSection("hardware");
    onSelectComponent(
      showPsuFailureHelp ? "psu" : alertTarget === "cache" ? "cache" : "ram",
    );
  }, [
    alertTarget,
    deadlockHelpResource,
    deadlockCooldownHelpResource,
    showPsuFailureHelp,
    isMobile,
    onSelectComponent,
  ]);

  useEffect(() => {
    if (!isMobile || !alertTarget || activeSection !== "hardware") return;

    const frame = window.requestAnimationFrame(() => {
      hardwarePanelRef.current
        ?.querySelector<HTMLElement>(".deadlock-help-caption")
        ?.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: getAlertScrollBehavior(),
        });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, alertTarget, isMobile]);

  useEffect(() => {
    if (!onSectionViewed) return;

    if (!isMobile) {
      onSectionViewed("tasks");
      onSectionViewed("research");
      return;
    }

    if (activeSection === "tasks" || activeSection === "research") {
      onSectionViewed(activeSection);
    }
  }, [activeSection, isMobile, onSectionViewed]);

  return (
    <main className="workbench" aria-label="IdleBit system workbench">
      <div className="topbar">
        <span className="topbar-brand">
          <span className="brand-bar" aria-hidden="true" />
          IdleBit
        </span>
        {showPsuFailureNotice && (
          <button
            type="button"
            className="topbar-alert-badge psu-failure"
            onClick={onDismissPsuFailureNotice}
            title="Acknowledge PSU overload failure"
          >
            <TriangleAlert size={13} />
            <span>PSU tripped</span>
          </button>
        )}
        <ResourceHud
          visible={visible}
          onReset={onReset}
          animateResourceGains={animateResourceGains}
        />
      </div>

      {isMobile && (
        <nav className="section-tabs" aria-label="Sections">
          <button
            type="button"
            className={`section-tab ${activeSection === "tasks" ? "active" : ""} ${
              hasNewTasks ? "has-notification" : ""
            }`}
            onClick={() => setActiveSection("tasks")}
            aria-label={
              hasNewTasks ? `Tasks, ${newTaskUnlockCount} new` : "Tasks"
            }
            title={hasNewTasks ? `${newTaskUnlockCount} new tasks` : "Tasks"}
          >
            <ListTodo size={13} />
            <span>Tasks</span>
            <span className="new-dot" aria-hidden="true" />
            <span className="count">{taskCount}</span>
          </button>
          <button
            type="button"
            className={`section-tab ${activeSection === "hardware" ? "active" : ""}`}
            onClick={() => setActiveSection("hardware")}
          >
            <Cpu size={13} />
            <span>HW</span>
            <span className="count">{coreCount}</span>
          </button>
          <button
            type="button"
            className={`section-tab ${activeSection === "research" ? "active" : ""} ${
              hasNewResearch ? "has-notification" : ""
            }`}
            onClick={() => setActiveSection("research")}
            aria-label={
              hasNewResearch
                ? `Research, ${newResearchUnlockCount} new`
                : "Research"
            }
            title={
              hasNewResearch
                ? `${newResearchUnlockCount} new research`
                : "Research"
            }
          >
            <Activity size={13} />
            <span>R&amp;D</span>
            <span className="new-dot" aria-hidden="true" />
            <span className="count">{researchCount}</span>
          </button>
        </nav>
      )}

      <section className="board-stage" aria-label="System board">
        <aside
          className={`panel tasks-panel ${activeSection === "tasks" ? "active" : ""}`}
          aria-label="Tasks"
        >
          <TaskBay
            visible={visible}
            selectedComponent={component}
            onSelectComponent={onSelectComponent}
            dispatch={dispatch}
            pinnedTaskIds={pinnedTaskIds}
            onTogglePinnedTask={onTogglePinnedTask}
          />
          {!isMobile && (
            <PinnedTaskBar
              visible={visible}
              pinnedTaskIds={pinnedTaskIds}
              onUnpinTask={onUnpinTask}
              onClearPinnedTasks={onClearPinnedTasks}
              dispatch={dispatch}
              selectedComponent={selectedComponent}
              variant="embedded"
            />
          )}
        </aside>

        <section
          className={`panel hw-panel ${activeSection === "hardware" ? "active" : ""}`}
          aria-label="Hardware"
          ref={hardwarePanelRef}
        >
          <div className="panel-header">
            <Cpu size={14} />
            <span>Hardware</span>
          </div>
          <div className="panel-body">
            <HardwareBoard
              visible={visible}
              dispatch={dispatch}
              selectedComponent={component}
              onSelectComponent={onSelectComponent}
              deadlockHelpResource={deadlockHelpResource}
              deadlockCooldownHelpResource={deadlockCooldownHelpResource}
              showPsuFailureHelp={showPsuFailureHelp}
              onDismissDeadlockHelp={onDismissDeadlockHelp}
              onDismissDeadlockCooldownHelp={onDismissDeadlockCooldownHelp}
              onDismissPsuFailureHelp={onDismissPsuFailureHelp}
            />
          </div>
        </section>

        <aside
          className={`panel research-panel ${activeSection === "research" ? "active" : ""}`}
          aria-label="Research"
        >
          <ResearchPanel visible={visible} dispatch={dispatch} />
        </aside>
      </section>
      {isMobile && (
        <PinnedTaskBar
          visible={visible}
          pinnedTaskIds={pinnedTaskIds}
          onUnpinTask={onUnpinTask}
          onClearPinnedTasks={onClearPinnedTasks}
          dispatch={dispatch}
          selectedComponent={selectedComponent}
          variant="floating"
        />
      )}
    </main>
  );
}
