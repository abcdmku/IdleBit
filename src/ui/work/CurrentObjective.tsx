import type { VisibleState } from "../../game";

/**
 * Single source for the tutorial objective chip.
 * The blockedReason -> name -> milestone fallback chain is load-bearing
 * guidance; keep it exactly as-is.
 */
export function CurrentObjective({
  visible,
  variant,
}: {
  visible: VisibleState;
  variant: "topbar" | "mobile";
}) {
  const stage = visible.currentChapter?.name ?? visible.stageLabel;
  const objective =
    visible.currentObjective?.blockedReason ??
    visible.currentObjective?.name ??
    visible.milestone;

  return (
    <div
      className={variant === "topbar" ? "topbar-stage" : "mobile-current-objective"}
      aria-label={`Current objective: ${stage}. ${objective}`}
    >
      {variant === "topbar" ? <span>{stage}</span> : <small>{stage}</small>}
      <strong>{objective}</strong>
    </div>
  );
}
