import { Check, Clock3, Database, TriangleAlert, X, Zap } from "lucide-react";
import {
  getAutomationBufferDefinition,
  type AdvanceReport,
  type VisibleState,
} from "../../game";
import { ExactResourceAmount, ExactResourceCost } from "../ResourceTokens";
import { useDialogFocus } from "../hooks/useDialogFocus";

const clusterWorkFallbackNames: Record<string, string> = {
  replicatedShardCommit: "Replicated Shard Commit",
  fabricIntegritySweep: "Fabric Integrity Sweep",
};

const formatDuration = (milliseconds: number) => {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

export const getReturnReportKey = (report: AdvanceReport) =>
  [
    report.elapsedMs,
    report.simulatedMs,
    report.overflowMs,
    report.bufferLevelId,
    report.standingOrderRenewals,
    report.creditsEarned,
    report.creditsSpent,
    report.dataEarned,
    report.dataSpent,
    JSON.stringify(report.completedWork),
    JSON.stringify(report.completedClusterWork ?? {}),
    JSON.stringify(report.completedCloudSlas ?? {}),
    JSON.stringify(report.completionEvents ?? []),
    JSON.stringify(report.blockers),
  ].join(":");

export function ReturnSummaryDialog({
  report,
  visible,
  onDismiss,
}: {
  report: AdvanceReport;
  visible: VisibleState;
  onDismiss: () => void;
}) {
  const titleId = "return-summary-title";
  const descriptionId = "return-summary-description";
  const dialogRef = useDialogFocus<HTMLElement>(onDismiss);
  const completedWork = Object.entries(report.completedWork).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0,
  );
  const completedClusterWork = Object.entries(
    report.completedClusterWork ?? {},
  ).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === "number" && entry[1] > 0,
  );
  const completedCloudSlas = Object.entries(report.completedCloudSlas ?? {}).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === "number" && entry[1] > 0,
  );
  const completedContracts = (report.completionEvents ?? []).filter(
    (event) => event.source === "contract",
  );
  const completedProjectPhases = (report.completionEvents ?? []).filter(
    (event) => event.source === "project",
  );
  const taskName = (taskId: string) =>
    visible.tasks.find((task) => task.id === taskId)?.name ?? taskId;
  const clusterWorkName = (workId: string) =>
    visible.infrastructure.workloadDefinitions.find(
      (definition) => definition.id === workId,
    )?.name ?? clusterWorkFallbackNames[workId] ?? workId;
  const cloudSlaName = (definitionId: string) =>
    visible.cloud.slaDefinitions.find(
      (definition) => definition.id === definitionId,
    )?.name ?? definitionId;
  const departureBuffer = getAutomationBufferDefinition(report.bufferLevelId);
  const bufferUtilization =
    report.bufferCapacityMs > 0
      ? Math.min(100, Math.round((report.simulatedMs / report.bufferCapacityMs) * 100))
      : 0;
  const nextBuffer = visible.automationBuffer.nextUpgrade;

  return (
    <div className="command-dialog-overlay">
      <section
        ref={dialogRef}
        className="command-dialog return-summary-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header>
          <span id={titleId}>
            <Clock3 size={19} aria-hidden="true" />
            Return summary
          </span>
          <button type="button" onClick={onDismiss} aria-label="Close return summary">
            <X size={16} />
          </button>
        </header>
        <p id={descriptionId}>
          The departure buffer processed {formatDuration(report.simulatedMs)} of
          {" "}{formatDuration(report.elapsedMs)} away.
        </p>

        <dl className="return-summary-times">
          <div>
            <dt>Productive</dt>
            <dd>{formatDuration(report.productiveMs)}</dd>
          </div>
          <div>
            <dt>Paused</dt>
            <dd>{formatDuration(report.pausedMs)}</dd>
          </div>
          <div className={report.overflowMs > 0 ? "warning" : ""}>
            <dt>Outside buffer</dt>
            <dd>{formatDuration(report.overflowMs)}</dd>
          </div>
          <div>
            <dt>Renewals</dt>
            <dd>{report.standingOrderRenewals}</dd>
          </div>
          <div>
            <dt>Buffer used</dt>
            <dd title={`${departureBuffer.name}: ${formatDuration(report.bufferCapacityMs)} max`}>
              {bufferUtilization}%
            </dd>
          </div>
        </dl>

        <div className="return-summary-ledger" aria-label="Offline resource ledger">
          <span aria-hidden="true" />
          <small>Earned</small>
          <small>Spent</small>
          <span className="return-summary-resource-label">
            <Zap size={13} aria-hidden="true" /> Credits
          </span>
          <span aria-label={`${report.creditsEarned} credits earned`}>
            <ExactResourceAmount
              resource="credits"
              amount={report.creditsEarned}
              plus
              compact
            />
          </span>
          <span
            className="return-summary-spent"
            aria-label={`${report.creditsSpent} credits spent`}
          >
            −
            <ExactResourceAmount
              resource="credits"
              amount={report.creditsSpent}
              compact
            />
          </span>
          <span className="return-summary-resource-label">
            <Database size={13} aria-hidden="true" /> Data
          </span>
          <span aria-label={`${report.dataEarned} data earned`}>
            <ExactResourceAmount
              resource="data"
              amount={report.dataEarned}
              plus
              compact
            />
          </span>
          <span
            className="return-summary-spent"
            aria-label={`${report.dataSpent} data spent`}
          >
            −
            <ExactResourceAmount
              resource="data"
              amount={report.dataSpent}
              compact
            />
          </span>
        </div>

        {completedWork.length > 0 && (
          <div className="return-summary-section">
            <strong>Completed work</strong>
            <ul>
              {completedWork.map(([taskId, count]) => (
                <li key={taskId}>
                  <span>{taskName(taskId)}</span>
                  <b>×{count}</b>
                </li>
              ))}
            </ul>
          </div>
        )}

        {completedClusterWork.length > 0 && (
          <div className="return-summary-section">
            <strong>Completed infrastructure work</strong>
            <ul>
              {completedClusterWork.map(([workId, count]) => (
                <li key={workId}>
                  <span>{clusterWorkName(workId)}</span>
                  <b>×{count}</b>
                </li>
              ))}
            </ul>
          </div>
        )}

        {completedContracts.length > 0 && (
          <div className="return-summary-section">
            <strong>Completed contracts</strong>
            <ul>
              {completedContracts.map((completion) => (
                <li key={completion.instanceId}>
                  <span>{completion.name}</span>
                  <b>Collected</b>
                </li>
              ))}
            </ul>
          </div>
        )}

        {completedProjectPhases.length > 0 && (
          <div className="return-summary-section">
            <strong>Completed project phases</strong>
            <ul>
              {completedProjectPhases.map((completion) => (
                <li key={completion.instanceId}>
                  <span>{completion.name}</span>
                  <b>Complete</b>
                </li>
              ))}
            </ul>
          </div>
        )}

        {completedCloudSlas.length > 0 && (
          <div className="return-summary-section">
            <strong>Completed Cloud SLA windows</strong>
            <ul>
              {completedCloudSlas.map(([definitionId, count]) => (
                <li key={definitionId}>
                  <span>{cloudSlaName(definitionId)}</span>
                  <b>×{count}</b>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="return-summary-section return-summary-next-buffer">
          <strong>Next Automation Buffer</strong>
          {nextBuffer ? (
            <div>
              <span>
                {nextBuffer.name} · {formatDuration(nextBuffer.maxOfflineMs)} max
              </span>
              <ExactResourceCost
                costs={nextBuffer.costs}
                resources={visible.exactResources}
                compact
              />
              {nextBuffer.blockedReason && <small>{nextBuffer.blockedReason}</small>}
            </div>
          ) : (
            <span>Maximum seven-day buffer installed.</span>
          )}
        </div>

        {report.blockers.length > 0 && (
          <div className="return-summary-section warning">
            <strong>
              <TriangleAlert size={13} aria-hidden="true" /> Stopped by
            </strong>
            <ul>
              {report.blockers.map((blocker, index) => (
                <li key={`${blocker}-${index}`}>{blocker}</li>
              ))}
            </ul>
          </div>
        )}

        <button type="button" className="command-dialog-primary" onClick={onDismiss}>
          Continue
          <Check size={15} aria-hidden="true" />
        </button>
      </section>
    </div>
  );
}
