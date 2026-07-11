import { formatWatts } from "../format";
import { SmoothFill } from "../SmoothProgress";
import { formatPowerRate } from "./rackFormatting";

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

  const ratio = capWatts > 0 ? drawWatts / capWatts : 0;
  const fill = Math.max(0, Math.min(1, ratio));
  const overload = ratio > 1;
  const heatZone = overload
    ? "overload"
    : ratio >= 0.95
      ? "critical"
      : ratio >= 0.6
        ? "warn"
        : "nominal";

  const title = `PSU ${formatWatts(drawWatts)} / ${formatWatts(capWatts)}${
    powerCostPerSecond > 0
      ? `, ${formatPowerRate(powerCostPerSecond)} credits per second`
      : ""
  }`;

  return (
    <span
      className={`rack-component-bay rack-component-bay--power rack-component-bay--power-${heatZone} ${
        issue ? "rack-component-bay--issue" : ""
      }`}
      title={title}
      aria-label={title}
    >
      <span className="rack-component-bay-caption" aria-hidden="true">
        PSU
      </span>
      <span className="rack-component-bay-viz">
        <span
          className={`rack-power-column ${overload ? "overload" : ""}`}
          aria-hidden="true"
        >
          <SmoothFill
            className="rack-power-column-fill"
            value={fill}
            orientation="vertical"
            snapKey={`${heatZone}:${issue}`}
            snapOnDecrease={false}
          />
          <span className="rack-power-column-threshold" aria-hidden="true" />
        </span>
      </span>
      {/* The column fill + heat-zone color IS the readout; exact watts and
          the cost rate live in the bay tooltip and the header net rate. */}
      <span className="rack-gauge-strip rack-gauge-strip--queue">
        <span className="rack-gauge-value rack-component-power-value">
          {Math.round(ratio * 100)}%
        </span>
      </span>
    </span>
  );
}
