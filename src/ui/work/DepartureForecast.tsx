import { Clock3 } from "lucide-react";
import {
  amount,
  getCreditRunwayWithinCoverageMs as getExactCreditRunwayWithinCoverageMs,
  type Amount,
  type VisibleState,
} from "../../game";
import { formatExactResourceRate, formatWatts } from "../format";
import { StatTile, StatTileRow } from "../StatTile";
import { formatBufferDuration, formatWorkDuration } from "./workFormat";

export const getCreditRunwayWithinCoverageMs = (
  credits: Amount,
  powerCostPerSecond: number,
  coverageMs: number,
) => {
  if (!Number.isFinite(powerCostPerSecond) || powerCostPerSecond <= 0) return null;
  return getExactCreditRunwayWithinCoverageMs(
    credits,
    amount(powerCostPerSecond),
    coverageMs,
  );
};

const clampMeter = (value: number) =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function DepartureForecast({ visible }: { visible: VisibleState }) {
  const forecast = visible.departureForecast;
  const buffer = visible.automationBuffer;
  const coverageMs = forecast.coverageMs;
  const creditRunwayMs = forecast.creditRunwayMs;

  const renewalActive =
    forecast.renewalSupported &&
    forecast.renewalEnabled &&
    forecast.renewalTaskName;
  const renewalValue = renewalActive ? forecast.renewalTaskName! : "None";
  const renewalTitle = forecast.renewalSupported
    ? renewalActive
      ? `Renews ${forecast.renewalTaskName}. Invalid work falls back to a safe eligible job.`
      : "No standing order to renew."
    : "This buffer level does not renew standing orders.";

  const completesValue =
    coverageMs <= 0
      ? "None"
      : forecast.timedActiveCount === 0
        ? forecast.unknownDurationCount > 0
          ? "Unknown"
          : "Idle"
        : `${forecast.fittingActiveCount}/${forecast.timedActiveCount}`;
  const completesTitle =
    coverageMs <= 0
      ? "No offline coverage."
      : forecast.timedActiveCount === 0
        ? forecast.unknownDurationCount > 0
          ? "No completion estimate for the active work."
          : "Nothing is active."
        : `${forecast.fittingActiveCount} of ${forecast.timedActiveCount} timed active item${
            forecast.timedActiveCount === 1 ? "" : "s"
          } complete within coverage.`;

  const powerPolicyDetail = forecast.powerPolicies
    .map(
      (system) =>
        `${system.name}: ${system.powerState}, ${formatWatts(
          system.drawWatts,
        )}, ${Math.round(system.psuStress * 100)}% PSU`,
    )
    .join(" · ");
  const powerValue =
    forecast.powerPolicies.length === 0
      ? "Unknown"
      : forecast.powerPolicies.every((system) => system.powerState === "off")
        ? "Off"
        : formatWatts(
            forecast.powerPolicies.reduce(
              (total, system) => total + system.drawWatts,
              0,
            ),
          );
  const maxPsuStress = forecast.powerPolicies.reduce(
    (max, system) => Math.max(max, system.psuStress),
    0,
  );

  const runwayCovered =
    creditRunwayMs !== null && coverageMs > 0 && creditRunwayMs >= coverageMs;
  const runwayValue =
    creditRunwayMs === null
      ? "None"
      : runwayCovered
        ? "Covered"
        : formatBufferDuration(creditRunwayMs);
  const runwayTitle =
    creditRunwayMs === null
      ? "No billable operating cost."
      : runwayCovered
        ? "Credits cover the full buffer window."
        : `Credits last ${formatWorkDuration(creditRunwayMs)} of ${formatWorkDuration(coverageMs)} coverage.`;

  return (
    <aside className="departure-forecast" aria-label="Pre-departure forecast">
      <header>
        <span title="Projection of what completes, renews, and pauses while the game is closed. Unsafe overload or unpaid operation pauses without destructive loss.">
          <Clock3 size={13} aria-hidden="true" /> Departure forecast
        </span>
      </header>
      <StatTileRow dense>
        <StatTile
          label="Coverage"
          value={formatBufferDuration(coverageMs)}
          accent="violet"
          meter={
            buffer.maxOfflineMs > 0
              ? clampMeter(coverageMs / buffer.maxOfflineMs)
              : 0
          }
          title={`${formatWorkDuration(coverageMs)} of ${formatBufferDuration(buffer.maxOfflineMs)} offline window`}
        />
        <StatTile
          label="Completes"
          value={completesValue}
          title={completesTitle}
        />
        <StatTile
          label="Renewal"
          value={renewalValue}
          accent={renewalActive ? "green" : undefined}
          title={renewalTitle}
        />
      </StatTileRow>
      <StatTileRow dense>
        <StatTile
          label="Power"
          value={powerValue}
          accent={maxPsuStress > 0.8 ? "rose" : "violet"}
          meter={clampMeter(maxPsuStress)}
          title={`${powerPolicyDetail || "Unknown"} · Pauses before unsafe overload.`}
        />
        <StatTile
          label="Cost"
          value={formatExactResourceRate(
            forecast.aggregateOperatingCostPerSecond,
          )}
          unit="cr/s"
          accent="amber"
        />
        <StatTile
          label="Runway"
          value={runwayValue}
          accent="green"
          meter={
            creditRunwayMs === null
              ? undefined
              : coverageMs > 0
                ? clampMeter(creditRunwayMs / coverageMs)
                : 0
          }
          title={runwayTitle}
        />
      </StatTileRow>
      {/* Reserved single-line slot: a projected blocker recolors it without
          reflowing the panel. */}
      <small
        className={`departure-forecast-pause${
          forecast.projectedPauseReason ? " work-blocked-reason" : ""
        }`}
        role="status"
        title={
          forecast.projectedPauseReason ??
          "Unsafe overload or unpaid operation pauses without destructive loss."
        }
      >
        {forecast.projectedPauseReason ?? ""}
      </small>
    </aside>
  );
}
