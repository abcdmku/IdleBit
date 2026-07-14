import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Activity, Cpu, Globe2, ListTodo, TriangleAlert } from "lucide-react";
import type { DeadlockResource, VisibleState } from "../game";
import {
  HardwareBoard,
  PinnedTaskBar,
  ResearchPanel,
} from "./HardwareBoard";
import { ResourceHud } from "./ResourceHud";
import { ResourceGraph } from "./graph/ResourceGraph";
import { useScreenWakeLock } from "./hooks/useScreenWakeLock";
import { useResourceHistory } from "./graph/useResourceHistory";
import type { ResourceKind } from "./ResourceTokens";
import {
  TopbarPersistenceStatus,
  type PersistenceReadout,
} from "./TopbarPersistenceStatus";
import type { Dispatch } from "./uiActions";
import { getVisibleSelection, type SelectedComponent } from "./workbenchData";
import { getRackData } from "./rack/rackData";
import { CurrentObjective } from "./work/CurrentObjective";
import { WorkPanel } from "./work/WorkPanel";

export type { SelectedComponent } from "./workbenchData";

type SectionKey = "tasks" | "hardware" | "research";
type UnlockSectionKey = Exclude<SectionKey, "hardware">;
type HardwareViewKey = "system" | "infrastructure" | "cloud";

const InfrastructurePanel = lazy(() =>
  import("./infrastructure/InfrastructurePanel").then((module) => ({
    default: module.InfrastructurePanel,
  })),
);

const CloudPanel = lazy(() =>
  import("./cloud/CloudPanel").then((module) => ({
    default: module.CloudPanel,
  })),
);

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
  persistenceStatus?: PersistenceReadout;
  mutationsBlocked?: boolean;
}

function useIsMobile(breakpoint = 760) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);

  return isMobile;
}

function getResearchCount(visible: VisibleState) {
  return visible.research.filter((research) => !research.completed).length;
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
  persistenceStatus,
  mutationsBlocked = false,
}: SystemWorkbenchProps) {
  const component = getVisibleSelection(visible, selectedComponent);
  const isMobile = useIsMobile();
  const hardwarePanelRef = useRef<HTMLElement | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>("tasks");
  const [hardwareView, setHardwareView] =
    useState<HardwareViewKey>("system");
  const [hardwareUpgradesHidden, setHardwareUpgradesHidden] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [keepScreenAwake, setKeepScreenAwake] = useState(false);
  const { supported: keepScreenAwakeSupported } =
    useScreenWakeLock(keepScreenAwake);
  const history = useResourceHistory(
    visible.resources.credits,
    visible.resources.data,
  );

  const handleSelectResource = useCallback(
    (_resource: ResourceKind) => {
      if (isMobile) {
        setGraphOpen(true);
        setActiveSection("research");
        return;
      }

      setGraphOpen((prev) => !prev);
    },
    [isMobile],
  );

  const handleCloseGraph = useCallback(() => {
    setGraphOpen(false);
  }, []);

  const activeWorkCount = visible.activeWork.length;
  const researchCount = getResearchCount(visible);
  const bufferUpgradeVisible =
    visible.automationBuffer.nextUpgrade?.unlocked === true;
  const researchPanelVisible = researchCount > 0 || bufferUpgradeVisible;

  // Mobile puts the resource graph on the research tab. If the graph closes
  // (or research empties) while the research panel itself is hidden, that tab
  // unmounts and no panel would carry the active class — fall back to Work.
  useEffect(() => {
    if (!isMobile) return;
    if (activeSection !== "research") return;
    if (graphOpen || researchPanelVisible) return;
    setActiveSection("tasks");
  }, [activeSection, graphOpen, isMobile, researchPanelVisible]);

  const rightRailVisible = graphOpen || researchPanelVisible;
  const stageCompact = useMemo(
    () => !getRackData(visible).showRack,
    [visible],
  );
  const stageModifiers = `${rightRailVisible ? "" : " no-right-rail"}${
    stageCompact ? " stage-compact" : ""
  }`;
  const coreCount = visible.hardware.cores;
  const hasNewTasks = newTaskUnlockCount > 0;
  const hasNewResearch = newResearchUnlockCount > 0;
  const alertTarget =
    showPsuFailureHelp ? "psu" : deadlockHelpResource ?? deadlockCooldownHelpResource;
  const infrastructureAvailable = visible.currentChapter.index >= 4;
  const cloudAvailable = visible.currentChapter.index >= 6;

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
    <main
      className={`workbench ${mutationsBlocked ? "mutations-blocked" : ""}${stageModifiers}`}
      aria-label="IdleBit system workbench"
      aria-busy={mutationsBlocked}
    >
      <div className="topbar">
        <span className="topbar-brand">
          <span className="brand-bar" aria-hidden="true" />
          IdleBit
        </span>
        <CurrentObjective visible={visible} variant="topbar" />
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
        <span
          className="topbar-persistence-slot"
          data-persistence-phase={persistenceStatus?.phase}
        >
          <TopbarPersistenceStatus status={persistenceStatus} />
        </span>
        <ResourceHud
          visible={visible}
          onReset={onReset}
          animateResourceGains={animateResourceGains}
          onSelectResource={handleSelectResource}
          graphOpen={graphOpen}
          resourceGraphTitle={
            isMobile ? "Show credits/data graph" : "Toggle credits/data graph"
          }
          hardwarePurchasesVisible={!hardwareUpgradesHidden}
          onHardwarePurchasesVisibleChange={(visible) =>
            setHardwareUpgradesHidden(!visible)
          }
          keepScreenAwake={keepScreenAwake}
          onKeepScreenAwakeChange={setKeepScreenAwake}
          keepScreenAwakeSupported={keepScreenAwakeSupported}
          resetDisabled={mutationsBlocked}
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
            aria-current={activeSection === "tasks" ? "page" : undefined}
            aria-label={
              hasNewTasks
                ? `Work, ${activeWorkCount} active work ${
                    activeWorkCount === 1 ? "item" : "items"
                  }, ${newTaskUnlockCount} new tasks`
                : `Work, ${activeWorkCount} active work ${
                    activeWorkCount === 1 ? "item" : "items"
                  }`
            }
            title={
              hasNewTasks
                ? `${activeWorkCount} active · ${newTaskUnlockCount} new tasks`
                : `${activeWorkCount} active work ${
                    activeWorkCount === 1 ? "item" : "items"
                  }`
            }
          >
            <ListTodo size={13} />
            <span>Work</span>
            <span className="new-dot" aria-hidden="true" />
            <span className="count" aria-hidden="true">
              {activeWorkCount}
            </span>
          </button>
          <button
            type="button"
            className={`section-tab ${activeSection === "hardware" ? "active" : ""}`}
            onClick={() => setActiveSection("hardware")}
            aria-current={activeSection === "hardware" ? "page" : undefined}
          >
            <Cpu size={13} />
            <span>HW</span>
            <span className="count">{coreCount}</span>
          </button>
          {(researchPanelVisible || graphOpen) && (
            <button
              type="button"
              className={`section-tab ${activeSection === "research" ? "active" : ""} ${
                hasNewResearch ? "has-notification" : ""
              }`}
              onClick={() => setActiveSection("research")}
              aria-current={activeSection === "research" ? "page" : undefined}
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
          )}
        </nav>
      )}

      {isMobile && activeSection === "hardware" && infrastructureAvailable && (
        <nav className="mobile-hardware-view-tabs" aria-label="Hardware view">
          <button
            type="button"
            className={hardwareView === "system" ? "active" : ""}
            aria-current={hardwareView === "system" ? "page" : undefined}
            onClick={() => setHardwareView("system")}
          >
            System
          </button>
          <button
            type="button"
            className={hardwareView === "infrastructure" ? "active" : ""}
            aria-current={
              hardwareView === "infrastructure" ? "page" : undefined
            }
            onClick={() => setHardwareView("infrastructure")}
          >
            Infrastructure
          </button>
          {cloudAvailable && (
            <button
              type="button"
              className={hardwareView === "cloud" ? "active" : ""}
              aria-current={hardwareView === "cloud" ? "page" : undefined}
              onClick={() => setHardwareView("cloud")}
            >
              Cloud
            </button>
          )}
        </nav>
      )}

      <section
        className={`board-stage${stageModifiers}`}
        aria-label="System board"
      >
        <aside
          className={`panel tasks-panel ${activeSection === "tasks" ? "active" : ""}`}
          aria-label="Work"
        >
          <WorkPanel
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
          className={`panel hw-panel ${activeSection === "hardware" ? "active" : ""} ${
            hardwareUpgradesHidden ? "hide-upgrades" : ""
          }`}
          aria-label="Hardware"
          ref={hardwarePanelRef}
        >
          <div className="panel-header">
            <Cpu size={14} />
            <span>Hardware</span>
            {infrastructureAvailable && (
              <div className="hardware-view-tabs" role="group" aria-label="Hardware view">
                <button
                  type="button"
                  className={hardwareView === "system" ? "active" : ""}
                  aria-pressed={hardwareView === "system"}
                  onClick={() => setHardwareView("system")}
                >
                  System
                </button>
                <button
                  type="button"
                  className={hardwareView === "infrastructure" ? "active" : ""}
                  aria-pressed={hardwareView === "infrastructure"}
                  onClick={() => setHardwareView("infrastructure")}
                >
                  Infrastructure
                </button>
                {cloudAvailable && (
                  <button
                    type="button"
                    className={hardwareView === "cloud" ? "active" : ""}
                    aria-pressed={hardwareView === "cloud"}
                    onClick={() => setHardwareView("cloud")}
                  >
                    <Globe2 size={12} aria-hidden="true" /> Cloud
                  </button>
                )}
              </div>
            )}
            {hardwareView === "system" && (
              <label className="hardware-upgrade-toggle">
                <input
                  type="checkbox"
                  checked={hardwareUpgradesHidden}
                  onChange={(event) =>
                    setHardwareUpgradesHidden(event.currentTarget.checked)
                  }
                />
                <span>Hide upgrades</span>
              </label>
            )}
          </div>
          <div className="panel-body">
            {hardwareView === "system" || !infrastructureAvailable ? (
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
            ) : hardwareView === "cloud" && cloudAvailable ? (
              <Suspense
                fallback={<p className="late-surface-loading">Loading Cloud controls…</p>}
              >
                <CloudPanel
                  visible={visible.cloud}
                  availableFacilities={visible.infrastructure.facilities.map(
                    (facility) => ({
                      id: facility.id,
                      name: facility.name,
                      capacityPerSecond: facility.cloudCapacityPerSecond,
                    }),
                  )}
                  planetaryAvailable={visible.currentChapter.index >= 7}
                  onCommissionRegion={(name) =>
                    dispatch({ type: "commissionCloudRegion", name })
                  }
                  onCommissionZone={(options) =>
                    dispatch({ type: "commissionCloudZone", ...options })
                  }
                  onPlaceReplica={(zoneId) =>
                    dispatch({ type: "placeCloudReplica", zoneId })
                  }
                  onSetRegionalDemand={(regionId, demand) =>
                    dispatch({
                      type: "setCloudRegionalDemand",
                      regionId,
                      demand,
                    })
                  }
                  onSetRoutingLinks={(links) =>
                    dispatch({ type: "setCloudRoutingLinks", links })
                  }
                  onSetFailoverPolicy={(automaticFailover, delayMs) =>
                    dispatch({
                      type: "setCloudFailoverPolicy",
                      automaticFailover,
                      delayMs,
                    })
                  }
                  onDrawIncident={(windowMs) =>
                    dispatch({ type: "drawCloudIncident", optIn: true, windowMs })
                  }
                  onRequestFailover={() =>
                    dispatch({ type: "requestCloudFailover" })
                  }
                  onStartSla={(definitionId) =>
                    dispatch({ type: "startCloudSla", definitionId })
                  }
                  onStartFinale={() =>
                    dispatch({ type: "startPlanetaryFinale" })
                  }
                  onSelectCharter={(charterId) =>
                    dispatch({ type: "selectFinaleCharter", charterId })
                  }
                />
              </Suspense>
            ) : (
              <Suspense
                fallback={<p className="late-surface-loading">Loading infrastructure…</p>}
              >
                <InfrastructurePanel
                  visible={visible.infrastructure}
                  resources={visible.exactResources}
                  facilityAvailable={visible.currentChapter.index >= 5}
                  onSetNodeManaged={(systemId, managed) =>
                    dispatch({ type: "setSystemManaged", systemId, managed })
                  }
                  onPurchaseServerBatch={(skuId, count) =>
                    dispatch({
                      type: "purchaseAggregateServerBatch",
                      skuId,
                      count,
                    })
                  }
                  onCommissionCluster={(name, nodeIds) =>
                    dispatch({ type: "commissionCluster", name, nodeIds })
                  }
                  onSetClusterFaultDomain={(clusterId, replicaFaultDomain) =>
                    dispatch({
                      type: "setClusterPolicy",
                      clusterId,
                      replicaFaultDomain,
                    })
                  }
                  onStartWorkload={(clusterId, definitionId) =>
                    dispatch({
                      type: "startClusterWorkload",
                      clusterId,
                      definitionId,
                    })
                  }
                  onCancelWorkload={(workloadId) =>
                    dispatch({ type: "cancelClusterWorkload", workloadId })
                  }
                  onSetWorkloadWeight={(workloadId, weight) =>
                    dispatch({
                      type: "setClusterWorkloadWeight",
                      workloadId,
                      weight,
                    })
                  }
                  onCommissionFacility={(templateId) =>
                    dispatch({ type: "commissionFacility", templateId })
                  }
                  onCommissionRack={(facilityId, templateId) =>
                    dispatch({
                      type: "commissionFacilityRack",
                      facilityId,
                      templateId,
                    })
                  }
                  onPlaceNode={(facilityId, rackId, nodeId) =>
                    dispatch({
                      type: "placeFleetNodeInRack",
                      facilityId,
                      rackId,
                      nodeId,
                    })
                  }
                  onRemoveNode={(nodeId) =>
                    dispatch({ type: "removeFleetNodeFromRack", nodeId })
                  }
                />
              </Suspense>
            )}
          </div>
        </section>

        {(graphOpen || researchPanelVisible) && <div
          className={`right-column ${activeSection === "research" ? "active" : ""}`}
        >
          {graphOpen && (
            <ResourceGraph history={history} onClose={handleCloseGraph} />
          )}
          {researchPanelVisible && <aside
            className={`panel research-panel ${activeSection === "research" ? "active" : ""}`}
            aria-label="Research"
          >
            <ResearchPanel
              visible={visible}
              dispatch={dispatch}
              mutationsDisabled={mutationsBlocked}
            />
          </aside>}
        </div>}
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
