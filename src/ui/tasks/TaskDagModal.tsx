import type { ReactNode } from "react";
import {
  ArrowDownToLine,
  CheckCircle2,
  Cpu,
  Database,
  GitMerge,
  HardDrive,
  Layers,
  Loader2,
  PlayCircle,
  X,
} from "lucide-react";
import type { VisibleState } from "../../game";
import { formatBits, formatNumber } from "../format";
import { ModuleMeter } from "../hardware/meters";
import { clampMeter, firstBits, firstNumber } from "../panels/uiNumbers";
import { ResourceCost } from "../ResourceTokens";
import {
  getActiveRuntimeLabel,
  getNodeCacheBits,
  getNodeRamBits,
  getOperationCountFromOperations,
  getTaskCacheBits,
  getTaskRamBits,
  getTaskRewardCosts,
  getVisibleCacheBits,
  getVisibleRamBits,
  isChunkedTask,
} from "./taskData";
import type {
  UiActiveTask,
  UiTask,
  UiTaskGraphNode,
  UiTaskOperation,
} from "./taskTypes";

type PhaseKind = "cache" | "ram" | "compute" | "barrier";

interface DagStage {
  id: string;
  index: number;
  name: string;
  isBarrier: boolean;
  operationIds: string[];
  operations: UiTaskOperation[];
  cacheBits: number;
  ramBits: number;
  cycles: number;
  operationCount: number;
  parallelOps: number;
  totalOps: number;
}

const formatPercent = (ratio: number | null) =>
  ratio === null ? "N/A" : `${formatNumber(Math.max(0, ratio) * 100)}%`;

const detectBarrier = (operations: UiTaskOperation[]) =>
  operations.length > 0 && operations.every((operation) => operation.kind === "barrier");

const getStageOperations = (node: UiTaskGraphNode): UiTaskOperation[] =>
  Array.isArray(node.operations) ? node.operations : [];

const getStageOperationIds = (node: UiTaskGraphNode, operations: UiTaskOperation[]) =>
  Array.from(
    new Set([
      ...(node.operationIds ?? []),
      ...operations.map((operation) => operation.id),
    ]),
  );

const countParallelOps = (operations: UiTaskOperation[]) =>
  operations.filter((operation) => operation.parallel).length;

function buildStages(task: UiTask): DagStage[] {
  const subtasks = task.subtasks ?? [];
  const sourceNodes: UiTaskGraphNode[] =
    subtasks.length > 0
      ? subtasks
      : (task.dagNodes ?? []).filter((node) => node.kind === "execute" || node.kind === "recipe");

  return sourceNodes.map((node, index) => {
    const operations = getStageOperations(node);
    const operationIds = getStageOperationIds(node, operations);
    const cacheBits = getNodeCacheBits(node);
    const ramBits = getNodeRamBits(node);
    const cycles = firstNumber(node.cycles, node.requiredCycles) ?? 0;
    const operationCount =
      firstNumber(
        node.operationCount,
        Array.isArray(node.operations) ? getOperationCountFromOperations(operations) : undefined,
      ) ?? operations.reduce((total, operation) => total + (operation.count ?? 1), 0);
    const parallelOps = countParallelOps(operations);

    return {
      id: node.id ?? `stage-${index}`,
      index: index + 1,
      name: node.name ?? `Stage ${index + 1}`,
      isBarrier: detectBarrier(operations),
      operationIds,
      operations,
      cacheBits,
      ramBits,
      cycles,
      operationCount,
      parallelOps,
      totalOps: operations.length,
    };
  });
}

type StageRuntime = {
  active: boolean;
  completed: boolean;
  progress: number | null;
  label: string | null;
  phase: PhaseKind | null;
  deadlock: boolean;
};

function getStageRuntime(
  stage: DagStage,
  task: UiTask,
  activeTask: UiActiveTask | null,
): StageRuntime {
  const idSet = new Set(stage.operationIds);
  const nameSet = new Set(stage.operations.map((operation) => operation.name));

  if (!activeTask) {
    return {
      active: false,
      completed: false,
      progress: null,
      label: null,
      phase: null,
      deadlock: false,
    };
  }

  const matches =
    activeTask.coreProgress?.filter((operation) => {
      if (operation.operationId && idSet.has(operation.operationId)) return true;
      if (operation.operationName && nameSet.has(operation.operationName)) return true;
      return false;
    }) ?? [];

  if (matches.length === 0) {
    const overall = clampMeter(activeTask.progress);
    const progressShare =
      task.subtasks && task.subtasks.length > 0 ? 1 / task.subtasks.length : 1;
    const startAt = (stage.index - 1) * progressShare;
    const endAt = stage.index * progressShare;
    const completed = overall >= endAt - 1e-3;
    return {
      active: false,
      completed,
      progress: completed ? 1 : null,
      label: null,
      phase: null,
      deadlock: false,
    };
  }

  const avgProgress =
    matches.reduce((sum, operation) => sum + clampMeter(operation.progress), 0) /
    matches.length;
  const sample = matches[0];
  const memoryState = sample?.memoryState ?? "";
  const status = sample?.status ?? "";
  const phase: PhaseKind | null = stage.isBarrier
    ? "barrier"
    : memoryState === "cacheLoad" || status === "loadingCache"
      ? "cache"
      : memoryState === "ramLoad" || status === "loadingRam"
        ? "ram"
        : "compute";
  const deadlock =
    status === "deadlocked" ||
    Boolean(sample?.lockResource) ||
    Boolean(activeTask.lockResource);

  return {
    active: true,
    completed: false,
    progress: avgProgress,
    label: getActiveRuntimeLabel(activeTask),
    phase,
    deadlock,
  };
}

function getFitLabel(
  node: UiTaskGraphNode,
  visible: VisibleState,
  kind: "cache" | "ram",
) {
  if (kind === "cache" && node.cacheFit) return node.cacheFit;
  const need = kind === "cache" ? getNodeCacheBits(node) : getNodeRamBits(node);
  if (need <= 0) return "n/a";
  const capacity =
    kind === "cache" ? getVisibleCacheBits(visible) : getVisibleRamBits(visible);
  if (capacity > need) return "fits+";
  if (capacity === need) return "fits";
  return "over";
}

export function TaskDagModal({
  task,
  visible,
  activeTask,
  onClose,
  memoryUnlocked,
}: {
  task: UiTask;
  visible: VisibleState;
  activeTask: UiActiveTask | null;
  onClose: () => void;
  memoryUnlocked: boolean;
}) {
  const progress = activeTask ? clampMeter(activeTask.progress) : clampMeter(task.progress ?? 0);
  const stages = buildStages(task);
  const chunked = isChunkedTask(task);
  const workUnitCount = chunked ? Math.max(1, task.workUnitCount ?? 1) : 1;
  const workUnitName = task.workUnitName ?? "chunk";
  const assignedCores =
    activeTask?.assignedCoreIds ??
    [activeTask?.coreId].filter((coreId): coreId is number => typeof coreId === "number");
  const requiredCores = firstNumber(task.requiredCores, task.minCores) ?? 1;
  const reservedBits =
    activeTask?.coreProgress?.reduce(
      (total, operation) =>
        total +
        firstBits(
          [operation.memoryReservedBits],
          [operation.memoryReservedBytes],
        ),
      0,
    ) ?? 0;
  const loadNote = activeTask
    ? getActiveRuntimeLabel(activeTask)
    : getTaskCacheBits(task) > 0 || (memoryUnlocked && getTaskRamBits(task) > 0)
      ? "Load → Compute"
      : "Direct";
  const coreNote =
    assignedCores.length > 0
      ? `Cores ${assignedCores.join(", ")}`
      : chunked
        ? `${formatNumber(workUnitCount)} ${workUnitName}s`
        : `${formatNumber(requiredCores)}x`;
  const payoutRewards = getTaskRewardCosts(task);
  const payoutNote: ReactNode =
    payoutRewards.length > 0 ? (
      <span className="dag-payout">
        <ResourceCost costs={payoutRewards} compact />
      </span>
    ) : (
      "None"
    );
  const activeStageIndex = stages.findIndex((stage) => {
    const runtime = getStageRuntime(stage, task, activeTask);
    return runtime.active;
  });

  return (
    <div className="task-dag-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="task-dag-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dag-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="task-dag-header">
          <div>
            <span>{task.kind ?? "task"}</span>
            <strong id="task-dag-title">{task.name}</strong>
          </div>
          <button
            type="button"
            className="task-dag-close"
            onClick={onClose}
            aria-label="Close task inspect"
            title="Close"
          >
            <X size={15} />
          </button>
        </div>

        <div className="task-dag-summary" aria-label="Task runtime summary">
          <DagSummaryTile label="Progress" value={formatPercent(progress)} meter={progress} />
          <DagSummaryTile label="Load" value={loadNote} />
          <DagSummaryTile label="Cores" value={coreNote} />
          <DagSummaryTile label="Payout" value={payoutNote} />
          <DagSummaryTile
            label="Cache"
            value={`${formatBits(getTaskCacheBits(task))} · ${getFitLabel(task, visible, "cache")}`}
          />
          {memoryUnlocked && (
            <DagSummaryTile
              label="RAM"
              value={
                reservedBits > 0
                  ? `${formatBits(reservedBits)} reserved`
                  : `${formatBits(getTaskRamBits(task))} · ${getFitLabel(task, visible, "ram")}`
              }
            />
          )}
        </div>

        <DagLegend memoryUnlocked={memoryUnlocked} chunked={chunked} />

        <div className="task-dag-scroll">
          <ol
            className={`dag-pipeline ${chunked ? "is-chunked" : ""}`}
            aria-label="Task execution pipeline"
          >
            <PipelineCap
              kind="start"
              label="Accept task"
              note={
                chunked
                  ? `Splits into ${formatNumber(workUnitCount)} ${workUnitName}${workUnitCount === 1 ? "" : "s"}`
                  : `${formatNumber(stages.length)} stage${stages.length === 1 ? "" : "s"}`
              }
            />

            {stages.length === 0 ? (
              <li className="dag-empty">No pipeline detail available.</li>
            ) : (
              stages.map((stage, index) => {
                const previousStage = stages[index - 1];
                const runtime = getStageRuntime(stage, task, activeTask);
                const isFuture = activeStageIndex >= 0 && index > activeStageIndex;
                return (
                  <PipelineStage
                    key={stage.id}
                    stage={stage}
                    previousStage={previousStage}
                    runtime={runtime}
                    memoryUnlocked={memoryUnlocked}
                    chunked={chunked}
                    workUnitCount={workUnitCount}
                    workUnitName={workUnitName}
                    isFuture={isFuture}
                  />
                );
              })
            )}

            <PipelineCap kind="end" label="Complete" note={payoutLabel(payoutRewards)} />
          </ol>
        </div>
      </section>
    </div>
  );
}

function payoutLabel(rewards: ReturnType<typeof getTaskRewardCosts>) {
  if (rewards.length === 0) return "No payout";
  return rewards
    .map((reward) => `+${formatNumber(reward.amount)} ${reward.resource}`)
    .join(" · ");
}

function DagSummaryTile({
  label,
  value,
  meter,
}: {
  label: string;
  value: ReactNode;
  meter?: number;
}) {
  return (
    <div className="dag-summary-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {typeof meter === "number" && <ModuleMeter value={meter} />}
    </div>
  );
}

function DagLegend({
  memoryUnlocked,
  chunked,
}: {
  memoryUnlocked: boolean;
  chunked: boolean;
}) {
  return (
    <div className="dag-legend" aria-label="Pipeline legend">
      <span className="dag-legend-title">Phase key</span>
      <span className="dag-legend-chip phase-cache">
        <Database size={11} aria-hidden /> Cache load
      </span>
      {memoryUnlocked && (
        <span className="dag-legend-chip phase-ram">
          <HardDrive size={11} aria-hidden /> RAM stage
        </span>
      )}
      <span className="dag-legend-chip phase-compute">
        <Cpu size={11} aria-hidden /> Compute
      </span>
      <span className="dag-legend-chip phase-barrier">
        <GitMerge size={11} aria-hidden /> Sync barrier
      </span>
      {chunked && (
        <span className="dag-legend-chip phase-chunk">
          <Layers size={11} aria-hidden /> Parallel chunks
        </span>
      )}
    </div>
  );
}

function PipelineCap({
  kind,
  label,
  note,
}: {
  kind: "start" | "end";
  label: string;
  note?: ReactNode;
}) {
  return (
    <li className={`dag-cap ${kind}`} aria-hidden="false">
      <span className="dag-cap-node">
        {kind === "start" ? (
          <PlayCircle size={14} aria-hidden />
        ) : (
          <CheckCircle2 size={14} aria-hidden />
        )}
      </span>
      <div className="dag-cap-body">
        <strong>{label}</strong>
        {note ? <small>{note}</small> : null}
      </div>
    </li>
  );
}

function PipelineStage({
  stage,
  previousStage,
  runtime,
  memoryUnlocked,
  chunked,
  workUnitCount,
  workUnitName,
  isFuture,
}: {
  stage: DagStage;
  previousStage?: DagStage;
  runtime: StageRuntime;
  memoryUnlocked: boolean;
  chunked: boolean;
  workUnitCount: number;
  workUnitName: string;
  isFuture: boolean;
}) {
  if (stage.isBarrier) {
    return (
      <li
        className={[
          "dag-barrier",
          runtime.active ? "is-active" : "",
          runtime.completed ? "is-done" : "",
          isFuture ? "is-future" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span className="dag-barrier-rail" aria-hidden />
        <div className="dag-barrier-body">
          <span className="dag-barrier-icon" aria-hidden>
            <GitMerge size={14} />
          </span>
          <div className="dag-barrier-text">
            <span>Sync barrier</span>
            <strong>{stage.name}</strong>
            <small>Waits for all parallel cores to finish before continuing.</small>
          </div>
          {runtime.active && (
            <span className="dag-barrier-state">
              {runtime.deadlock ? "Stalled" : runtime.label ?? "Waiting"}
            </span>
          )}
        </div>
      </li>
    );
  }

  const showCache = stage.cacheBits > 0;
  const showRam = memoryUnlocked && stage.ramBits > 0;
  const showCompute = stage.cycles > 0;
  const chunkBadge = chunked && showCompute;
  const parallelBadge = !chunked && stage.parallelOps > 0;
  const carriedFromPrev = previousStage && previousStage.ramBits > 0 && stage.ramBits === 0;

  return (
    <li
      className={[
        "dag-stage",
        runtime.active ? "is-active" : "",
        runtime.completed ? "is-done" : "",
        runtime.deadlock ? "is-deadlock" : "",
        isFuture ? "is-future" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="dag-stage-index" aria-hidden>
        {runtime.completed ? <CheckCircle2 size={12} /> : stage.index}
      </span>
      <div className="dag-stage-card">
        <div className="dag-stage-head">
          <div className="dag-stage-title">
            <span>Stage {stage.index}</span>
            <strong>{stage.name}</strong>
          </div>
          <div className="dag-stage-tags">
            {chunkBadge && (
              <span className="dag-tag chunk" title={`${workUnitCount} ${workUnitName}s spread across cores`}>
                <Layers size={11} aria-hidden /> &times;{formatNumber(workUnitCount)}
              </span>
            )}
            {parallelBadge && (
              <span className="dag-tag parallel" title="Runs across cores in parallel">
                <Layers size={11} aria-hidden /> parallel
              </span>
            )}
            {stage.operationCount > 0 && (
              <span className="dag-tag ops">
                {formatNumber(stage.operationCount)} ops
              </span>
            )}
          </div>
        </div>

        <div className="dag-stage-flow" role="list" aria-label="Stage sub-pipeline">
          {showCache ? (
            <PhaseChip
              kind="cache"
              icon={<Database size={12} aria-hidden />}
              label="Cache load"
              detail={formatBits(stage.cacheBits)}
              isActive={runtime.active && runtime.phase === "cache"}
              isDone={runtime.completed || (runtime.active && runtime.phase !== "cache" && runtime.phase !== null && runtime.phase !== "ram") || (runtime.active && runtime.phase === "ram")}
            />
          ) : (
            <PhaseChip
              kind="cache"
              icon={<Database size={12} aria-hidden />}
              label="No cache"
              detail="—"
              isMuted
            />
          )}
          {memoryUnlocked && (
            showRam ? (
              <PhaseChip
                kind="ram"
                icon={<HardDrive size={12} aria-hidden />}
                label={carriedFromPrev ? "RAM held" : "RAM stage"}
                detail={formatBits(stage.ramBits)}
                hint={carriedFromPrev ? "kept from previous stage" : undefined}
                isActive={runtime.active && runtime.phase === "ram"}
                isDone={runtime.completed || (runtime.active && (runtime.phase === "compute"))}
              />
            ) : (
              <PhaseChip
                kind="ram"
                icon={<HardDrive size={12} aria-hidden />}
                label="No RAM"
                detail="—"
                isMuted
              />
            )
          )}
          {showCompute && (
            <PhaseChip
              kind="compute"
              icon={<Cpu size={12} aria-hidden />}
              label="Compute"
              detail={`${formatNumber(stage.cycles)} cycles`}
              isActive={runtime.active && runtime.phase === "compute"}
              isDone={runtime.completed}
            />
          )}
        </div>

        {chunked && showCompute && (
          <ChunkLanes count={workUnitCount} progress={runtime.completed ? 1 : runtime.active ? runtime.progress ?? 0 : 0} />
        )}

        {(runtime.active || runtime.progress !== null) && (
          <div className="dag-stage-progress" aria-label="Stage progress">
            <span className="dag-stage-progress-fill" style={{ width: `${clampMeter(runtime.progress) * 100}%` }} />
          </div>
        )}

        {runtime.active && (
          <div className="dag-stage-status">
            {runtime.deadlock ? (
              <span className="dag-stage-status-text deadlock">
                <Loader2 size={11} aria-hidden /> {runtime.label ?? "Deadlock"}
              </span>
            ) : (
              <span className="dag-stage-status-text">
                <ArrowDownToLine size={11} aria-hidden /> {runtime.label ?? "Running"}
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function PhaseChip({
  kind,
  icon,
  label,
  detail,
  hint,
  isActive,
  isDone,
  isMuted,
}: {
  kind: PhaseKind;
  icon: ReactNode;
  label: string;
  detail: string;
  hint?: string;
  isActive?: boolean;
  isDone?: boolean;
  isMuted?: boolean;
}) {
  return (
    <span
      role="listitem"
      className={[
        "dag-phase",
        `phase-${kind}`,
        isMuted ? "is-muted" : "",
        isActive ? "is-active" : "",
        isDone && !isActive ? "is-done" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="dag-phase-icon">{icon}</span>
      <span className="dag-phase-text">
        <span>{label}</span>
        <strong>{detail}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
    </span>
  );
}

function ChunkLanes({ count, progress }: { count: number; progress: number }) {
  const lanes = Math.min(count, 16);
  const completedLanes = Math.max(0, Math.min(lanes, Math.round(clampMeter(progress) * lanes)));
  return (
    <div className="dag-chunk-lanes" aria-hidden>
      {Array.from({ length: lanes }).map((_, index) => (
        <span
          key={index}
          className={`dag-chunk-lane ${index < completedLanes ? "is-done" : ""}`}
        />
      ))}
      {count > lanes && <span className="dag-chunk-overflow">+{count - lanes}</span>}
    </div>
  );
}
