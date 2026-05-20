import type { ReactNode } from "react";
import { X } from "lucide-react";
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
  isElasticTask,
} from "./taskData";
import type { UiActiveTask, UiTask, UiTaskGraphNode } from "./taskTypes";

const formatPercent = (ratio: number | null) =>
  ratio === null ? "N/A" : `${formatNumber(Math.max(0, ratio) * 100)}%`;

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
      : isElasticTask(task)
        ? "Uses idle cores"
        : `${formatNumber(requiredCores)}x`;
  const payoutRewards = getTaskRewardCosts(task);
  const payoutNote =
    payoutRewards.length > 0 ? (
      <span className="payout-note">
        <ResourceCost costs={payoutRewards} compact />
      </span>
    ) : (
      "None"
    );

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
            value={`${formatBits(getTaskCacheBits(task))} - ${getFitLabel(task, visible, "cache")}`}
          />
          {memoryUnlocked && (
            <DagSummaryTile
              label="RAM"
              value={
                reservedBits > 0
                  ? `${formatBits(reservedBits)} reserved`
                  : `${formatBits(getTaskRamBits(task))} - ${getFitLabel(task, visible, "ram")}`
              }
            />
          )}
        </div>

        <div className="task-dag-scroll">
          <TaskDagNode
            node={task}
            visible={visible}
            activeTask={activeTask}
            memoryUnlocked={memoryUnlocked}
          />
        </div>
      </section>
    </div>
  );
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

function TaskDagNode({
  node,
  visible,
  activeTask,
  memoryUnlocked,
  dependencyHint,
}: {
  node: UiTaskGraphNode;
  visible: VisibleState;
  activeTask: UiActiveTask | null;
  memoryUnlocked: boolean;
  dependencyHint?: string;
}) {
  const children = getDagChildren(node);
  const dependencies = getDependencyLabels(node);
  const runtime = getNodeRuntime(node, activeTask);
  const progress = getNodeProgress(node, activeTask);
  const operationCount = firstNumber(
    node.operationCount,
    Array.isArray(node.operations)
      ? getOperationCountFromOperations(node.operations)
      : undefined,
  );
  const memoryActions = Array.from(
    new Set(
      [
        node.memoryAction,
        ...(Array.isArray(node.operations)
          ? node.operations.map((operation) => operation.memoryAction)
          : []),
      ].filter((action): action is string => Boolean(action)),
    ),
  );
  const label = node.kind ?? (children.length > 0 ? "task" : "operation");

  return (
    <div className={`dag-node-wrap ${children.length > 0 ? "has-children" : ""}`}>
      <article className={`dag-node ${label}`}>
        <div className="dag-node-title">
          <span>{label}</span>
          <strong>{node.name ?? node.id ?? "Operation"}</strong>
        </div>
        <div className="dag-node-meta">
          {operationCount !== undefined && <span>{formatNumber(operationCount)} ops</span>}
          {memoryActions.length > 0 && <span>{memoryActions.join("/")}</span>}
          <span>{formatBits(getNodeCacheBits(node))} cache</span>
          {memoryUnlocked && <span>{formatBits(getNodeRamBits(node))} ram</span>}
        </div>
        <small>
          {dependencies.length > 0 ? dependencies.join(", ") : dependencyHint ?? "Root"}
        </small>
        {runtime && <em>{runtime}</em>}
        {progress !== null && (
          <span className="dag-node-progress" aria-hidden="true">
            <span style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      </article>
      {children.length > 0 && (
        <div className="dag-children">
          {children.map((child, index) => (
            <TaskDagNode
              key={`${child.id ?? child.name ?? "node"}-${index}`}
              node={child}
              visible={visible}
              activeTask={activeTask}
              memoryUnlocked={memoryUnlocked}
              dependencyHint={index === 0 ? "Start" : `After ${children[index - 1]?.name ?? "previous"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function getDagChildren(node: UiTaskGraphNode) {
  const recipeNodes = [
    ...(node.subtasks ?? []),
    ...(node.subTasks ?? []),
    ...(node.tasks ?? []),
    ...(node.children ?? []),
  ];
  const dagNodes = node.dagNodes ?? [];
  const operations = Array.isArray(node.operations) ? node.operations : [];
  const isRootTask = node.kind === undefined || node.kind === "task";

  if (dagNodes.length > 0) return dagNodes;
  if (recipeNodes.length > 0) return recipeNodes;
  return isRootTask ? operations : [];
}

function getDependencyLabels(node: UiTaskGraphNode) {
  const dependencies = [
    ...(node.dependencyIds ?? []),
    ...(node.dependencies ?? []),
    ...(node.dependsOn ?? []),
    ...(node.requires ?? []),
  ];

  return dependencies
    .map((dependency) =>
      typeof dependency === "string"
        ? dependency
        : dependency.name ?? dependency.id ?? null,
    )
    .filter((dependency): dependency is string => Boolean(dependency));
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

function getNodeRuntime(node: UiTaskGraphNode, activeTask: UiActiveTask | null) {
  if (!activeTask) return null;
  if (node.id === activeTask.taskId) return getActiveRuntimeLabel(activeTask);

  const operationIds = new Set([
    ...(node.operationIds ?? []),
    ...(Array.isArray(node.operations)
      ? node.operations.map((operation) => operation.id)
      : []),
  ]);
  const operationNames = new Set(
    Array.isArray(node.operations)
      ? node.operations.map((operation) => operation.name)
      : [],
  );
  const matchesNodeKind = (operation: NonNullable<UiActiveTask["coreProgress"]>[number]) => {
    if (node.kind === "cacheLoad") {
      return operation.status === "loadingCache" || operation.memoryState === "cacheLoad";
    }
    if (node.kind === "ramLoad") {
      return operation.status === "loadingRam" || operation.memoryState === "ramLoad";
    }
    if (node.kind === "execute") {
      return operation.status === "running";
    }
    return true;
  };
  const matches =
    activeTask.coreProgress?.filter(
      (operation) =>
        matchesNodeKind(operation) &&
        ((operation.operationId !== null && operationIds.has(operation.operationId)) ||
          (operation.operationName !== null &&
            operationNames.has(operation.operationName)) ||
          (node.id && operation.operationId === node.id) ||
          (node.name && operation.operationName === node.name)),
    ) ?? [];
  if (matches.length === 0) return null;

  const states = matches.map(
    (operation) => operation.memoryState ?? operation.status ?? "running",
  );
  return Array.from(new Set(states)).join(" / ");
}

function getNodeProgress(node: UiTaskGraphNode, activeTask: UiActiveTask | null) {
  if (activeTask) return null;
  return typeof node.progress === "number" ? clampMeter(node.progress) : null;
}
