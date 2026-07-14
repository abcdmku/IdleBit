import {
  BriefcaseBusiness,
  FolderKanban,
  ListTodo,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import type { TaskId, VisibleState } from "../../game";
import type { Dispatch } from "../uiActions";
import type { SelectedComponent } from "../workbenchData";
import { TaskBay } from "../tasks/TaskBay";
import { AutomationBufferPanel } from "./AutomationBufferPanel";
import { CurrentObjective } from "./CurrentObjective";
import { DepartureForecast } from "./DepartureForecast";
import {
  ContractsView,
  LiveOperationsView,
  MissionsView,
  ProjectsView,
  StandingOrdersView,
} from "./WorkViews";

type WorkViewKey =
  | "campaign"
  | "market"
  | "automation"
  | "jobs";

const workViews = [
  { id: "jobs", label: "Jobs", shortLabel: "Jobs", Icon: ListTodo },
  { id: "campaign", label: "Campaign", shortLabel: "Campaign", Icon: FolderKanban },
  { id: "market", label: "Contract Market", shortLabel: "Market", Icon: BriefcaseBusiness },
  { id: "automation", label: "Automation", shortLabel: "Automation", Icon: SlidersHorizontal },
] as const satisfies ReadonlyArray<{
  id: WorkViewKey;
  label: string;
  shortLabel: string;
  Icon: typeof ListTodo;
}>;

export function WorkPanel({
  visible,
  selectedComponent,
  onSelectComponent,
  dispatch,
  pinnedTaskIds = [],
  onTogglePinnedTask,
}: {
  visible: VisibleState;
  selectedComponent: SelectedComponent;
  onSelectComponent?: (component: SelectedComponent) => void;
  dispatch: Dispatch;
  pinnedTaskIds?: string[];
  onTogglePinnedTask?: (taskId: string) => void;
}) {
  const [activeView, setActiveView] = useState<WorkViewKey>("jobs");
  const [targetSystemId, setTargetSystemId] = useState(
    visible.standingOrder.systemId ?? visible.selectedSystem.id,
  );
  const [standingTaskId, setStandingTaskId] = useState<TaskId | null>(
    visible.standingOrder.taskId,
  );
  const liveOperations = visible.liveOperations;
  const availableWorkViews = workViews.filter(({ id }) => {
    if (id === "jobs") return true;
    if (id === "campaign") return visible.workViews.campaign;
    if (id === "market") return visible.workViews.market;
    if (id === "automation") return visible.workViews.automation;
    return false;
  });
  const resolvedActiveView = availableWorkViews.some(
    ({ id }) => id === activeView,
  )
    ? activeView
    : "jobs";

  // Sync the form only from the configured standing order itself. Selecting
  // a different system elsewhere in the UI must never wipe unsaved picks in
  // these dropdowns (the deps intentionally exclude selectedSystem.id).
  useEffect(() => {
    setStandingTaskId(visible.standingOrder.taskId);
    setTargetSystemId(
      (current) => visible.standingOrder.systemId ?? current,
    );
  }, [visible.standingOrder.systemId, visible.standingOrder.taskId]);

  useEffect(() => {
    if (resolvedActiveView !== activeView) setActiveView(resolvedActiveView);
  }, [activeView, resolvedActiveView]);

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % availableWorkViews.length;
    }
    if (event.key === "ArrowLeft") {
      nextIndex =
        (index - 1 + availableWorkViews.length) % availableWorkViews.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = availableWorkViews.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = availableWorkViews[nextIndex]!;
    setActiveView(next.id);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [nextIndex]?.focus();
  };

  return (
    <>
      <div className="panel-header work-panel-header">
        <ListTodo size={14} />
        <span>Work</span>
      </div>
      <div className="panel-body work-panel-body">
        <div className="work-view-tabs" role="tablist" aria-label="Work views">
          {availableWorkViews.map(({ id, label, shortLabel, Icon }, index) => (
            <button
              type="button"
              role="tab"
              id={`work-tab-${id}`}
              aria-controls={`work-panel-${id}`}
              aria-selected={resolvedActiveView === id}
              aria-label={label}
              title={label}
              tabIndex={resolvedActiveView === id ? 0 : -1}
              className={resolvedActiveView === id ? "active" : ""}
              onClick={() => setActiveView(id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              key={id}
            >
              <Icon size={12} aria-hidden="true" />
              {shortLabel}
            </button>
          ))}
        </div>

        <section
          className="work-view-panel"
          role="tabpanel"
          id={`work-panel-${resolvedActiveView}`}
          aria-labelledby={`work-tab-${resolvedActiveView}`}
          tabIndex={0}
        >
          {resolvedActiveView === "campaign" && (
            <div className="work-combined-view">
              <MissionsView visible={visible} />
              <ProjectsView
                visible={visible}
                dispatch={dispatch}
                targetSystemId={targetSystemId}
                onTargetSystemChange={setTargetSystemId}
              />
            </div>
          )}
          {resolvedActiveView === "market" && (
            <ContractsView visible={visible} dispatch={dispatch} />
          )}
          {resolvedActiveView === "automation" && (
            <div className="work-combined-view">
              <AutomationBufferPanel visible={visible} />
              {visible.automationBuffer.maxOfflineMs > 0 && (
                <DepartureForecast visible={visible} />
              )}
              {visible.cron.unlocked && (
                <StandingOrdersView
                  visible={visible}
                  dispatch={dispatch}
                  selectedTaskId={standingTaskId}
                  selectedSystemId={targetSystemId}
                  onTaskChange={setStandingTaskId}
                  onSystemChange={setTargetSystemId}
                />
              )}
              {liveOperations?.unlocked && (
                <LiveOperationsView visible={visible} dispatch={dispatch} />
              )}
            </div>
          )}
          {resolvedActiveView === "jobs" && (
            <div className="work-jobs-view">
              <CurrentObjective visible={visible} variant="mobile" />
              <TaskBay
                visible={visible}
                selectedComponent={selectedComponent}
                onSelectComponent={onSelectComponent}
                dispatch={dispatch}
                pinnedTaskIds={pinnedTaskIds}
                onTogglePinnedTask={onTogglePinnedTask}
                embedded
              />
            </div>
          )}
        </section>
      </div>
    </>
  );
}
