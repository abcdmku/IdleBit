import { Cpu } from "lucide-react";
import { getAutomationBufferDefinition, type VisibleState } from "../../game";
import { StatTile, StatTileRow } from "../StatTile";
import { formatBufferDuration } from "./workFormat";

/**
 * Status-only readout for the owned Automation Buffer. Buffer level
 * purchases live in the R&D column beside research (see ResearchPanel).
 */
export function AutomationBufferPanel({
  visible,
}: {
  visible: VisibleState;
}) {
  const buffer = visible.automationBuffer;
  const ownedBuffer = getAutomationBufferDefinition(buffer.ownedLevelId);
  const standingOrder = visible.standingOrders?.find(
    (order) => order.taskId === visible.standingOrder.taskId,
  );
  const standingOrderName =
    standingOrder?.name ?? visible.standingOrder.taskId ?? null;

  return (
    <section
      className="automation-buffer-panel"
      aria-labelledby="automation-buffer-title"
    >
      <header>
        <span className="automation-buffer-heading">
          <Cpu size={14} aria-hidden="true" />
          <strong id="automation-buffer-title">Automation Buffer</strong>
        </span>
        <strong className="automation-buffer-level">{ownedBuffer.name}</strong>
      </header>

      {buffer.maxOfflineMs > 0 ? (
        <StatTileRow dense>
          <StatTile
            label="Remaining"
            value={formatBufferDuration(buffer.remainingOfflineMs)}
            accent="cyan"
            meter={Math.max(
              0,
              Math.min(1, buffer.remainingOfflineMs / buffer.maxOfflineMs),
            )}
          />
          <StatTile
            label="Max"
            value={formatBufferDuration(buffer.maxOfflineMs)}
          />
        </StatTileRow>
      ) : (
        // Two "0m" tiles say nothing; one line states the situation.
        <p className="automation-buffer-note" title={ownedBuffer.capability}>
          No offline coverage yet
        </p>
      )}

      {/* One short status line; the capability detail lives in its tooltip. */}
      <p
        className="automation-buffer-note"
        title={ownedBuffer.capability}
      >
        {visible.standingOrder.taskId
          ? `Standing order: ${standingOrderName} · ${
              visible.standingOrder.enabled ? "armed" : "paused"
            }`
          : "No standing order"}
      </p>
    </section>
  );
}
