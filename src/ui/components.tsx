import { useEffect, useState } from "react";
import { Activity, Cpu, ListTodo, TriangleAlert } from "lucide-react";
import type { DeadlockResource, VisibleState } from "../game";
import {
  HardwareBoard,
  ResearchPanel,
  ResourceHud,
  TaskBay,
} from "./HardwareBoard";
import type { Dispatch } from "./uiActions";
import { getVisibleSelection, type SelectedComponent } from "./workbenchData";

export type { SelectedComponent } from "./workbenchData";

type SectionKey = "tasks" | "hardware" | "research";

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
}: SystemWorkbenchProps) {
  const component = getVisibleSelection(visible, selectedComponent);
  const isMobile = useIsMobile();
  const [activeSection, setActiveSection] = useState<SectionKey>("hardware");

  const taskCount = getTaskCount(visible);
  const researchCount = getResearchCount(visible);
  const coreCount = visible.hardware.cores;

  useEffect(() => {
    const helpResource = deadlockHelpResource ?? deadlockCooldownHelpResource;
    if (!isMobile || (!helpResource && !showPsuFailureHelp)) return;
    setActiveSection("hardware");
    onSelectComponent(
      showPsuFailureHelp ? "psu" : helpResource === "cache" ? "cache" : "ram",
    );
  }, [
    deadlockHelpResource,
    deadlockCooldownHelpResource,
    showPsuFailureHelp,
    isMobile,
    onSelectComponent,
  ]);

  return (
    <main className="workbench" aria-label="IdleBit system workbench">
      <div className="topbar">
        <span className="topbar-brand">
          <span className="brand-bar" aria-hidden="true" />
          IdleBit
        </span>
        <span className="topbar-stage">
          <span>{visible.stageLabel}</span>
          <strong>{visible.milestone}</strong>
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
            className={`section-tab ${activeSection === "tasks" ? "active" : ""}`}
            onClick={() => setActiveSection("tasks")}
          >
            <ListTodo size={13} />
            <span>Tasks</span>
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
            className={`section-tab ${activeSection === "research" ? "active" : ""}`}
            onClick={() => setActiveSection("research")}
          >
            <Activity size={13} />
            <span>R&amp;D</span>
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
          />
        </aside>

        <section
          className={`panel hw-panel ${activeSection === "hardware" ? "active" : ""}`}
          aria-label="Hardware"
        >
          <div className="panel-header">
            <Cpu size={14} />
            <span>Hardware</span>
            <small>{visible.stageLabel}</small>
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
    </main>
  );
}
