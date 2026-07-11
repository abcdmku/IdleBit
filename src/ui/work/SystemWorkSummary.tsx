import type { VisibleState } from "../../game";
import { SmoothProgress } from "../SmoothProgress";
import { formatWorkDuration, formatWorkKind } from "./workFormat";

export function SystemWorkSummary({
  visible,
  systemId,
  compact = false,
}: {
  visible: VisibleState;
  systemId: string | number;
  /** Headerless lane for embedding in fleet cards — the card is the context. */
  compact?: boolean;
}) {
  const work = (visible.activeWork ?? []).filter(
    (item) =>
      item.systemId !== null && String(item.systemId) === String(systemId),
  );
  return (
    <section
      className={`system-work-summary${compact ? " compact" : ""}`}
      aria-label={`Work running on system ${systemId}`}
    >
      {!compact && (
        <header>
          <span>System work</span>
          <small>{work.length > 0 ? `${work.length} active` : "Idle"}</small>
        </header>
      )}
      <div
        className="system-work-summary-list"
        tabIndex={0}
        aria-label={`Active work list for system ${systemId}`}
      >
        {work.length === 0 ? (
          <div
            className="system-work-summary-item idle"
            aria-label="No active work"
          >
            <span className="system-work-idle-track" aria-hidden="true" />
          </div>
        ) : work.map((item) => (
          <div className="system-work-summary-item" key={item.id}>
            <span>
              <b>{item.name}</b>
              <small>{formatWorkKind(item.kind)}</small>
            </span>
            <span>
              <SmoothProgress
                value={Math.max(0, Math.min(1, item.progress))}
                max={1}
                label={`${item.name} progress`}
              />
              <small>
                {item.remainingMs === null
                  ? "Running"
                  : formatWorkDuration(item.remainingMs)}
              </small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
