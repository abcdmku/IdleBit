import { formatWatts } from "../format";
import { formatPowerRate } from "./rackFormatting";
import { getRackPipIndexes } from "./rackMetrics";

interface RackPowerBayProps {
  drawWatts: number;
  capWatts: number;
  powerCostPerSecond: number;
  issue: boolean;
}

export function RackPowerBay({
  drawWatts,
  capWatts,
  powerCostPerSecond,
  issue,
}: RackPowerBayProps) {
  if (capWatts <= 0) return null;

  const powerBarCount = 6;
  const powerRatio = drawWatts / capWatts;
  const activePowerBars = Math.ceil(
    Math.max(0, Math.min(1, powerRatio)) * powerBarCount,
  );
  const title = `PSU ${formatWatts(drawWatts)} / ${formatWatts(capWatts)}${
    powerCostPerSecond > 0
      ? `, ${formatPowerRate(powerCostPerSecond)} credits per second`
      : ""
  }`;

  return (
    <span
      className={`rack-component-bay rack-component-bay--power ${
        issue ? "rack-component-bay--issue" : ""
      }`}
      title={title}
      aria-label={title}
    >
      <span className="rack-power-stack" aria-hidden="true">
        {getRackPipIndexes(powerBarCount).map((barIndex) => (
          <span
            key={barIndex}
            className={`rack-power-bar ${barIndex < activePowerBars ? "active" : ""}`}
          />
        ))}
      </span>
      <span className="rack-component-stat rack-component-stat--power">
        <span className="rack-component-power-value">
          {formatWatts(drawWatts)}
        </span>
        <span className="rack-component-stat-sub rack-component-power-value">
          / {formatWatts(capWatts)}
        </span>
        {powerCostPerSecond > 0 && (
          <span className="rack-component-rate">
            -{formatPowerRate(powerCostPerSecond)} cr/s
          </span>
        )}
      </span>
    </span>
  );
}
