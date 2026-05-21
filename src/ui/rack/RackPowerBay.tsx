import type { CSSProperties } from "react";
import { formatNumber, formatWatts } from "../format";
import { formatPowerRate } from "./rackFormatting";

interface RackPowerBayProps {
  drawWatts: number;
  capWatts: number;
  powerCostPerSecond: number;
  issue: boolean;
}

const formatCapChip = (watts: number) => {
  if (watts <= 0) return null;
  if (watts >= 1_000_000) {
    const value = watts / 1_000_000;
    return `${value >= 100 ? Math.round(value) : Number(value.toFixed(value >= 10 ? 0 : 1))}MW`;
  }
  if (watts >= 1_000) {
    const value = watts / 1_000;
    return `${value >= 100 ? Math.round(value) : Number(value.toFixed(value >= 10 ? 0 : 1))}kW`;
  }
  return `${formatNumber(watts)}W`;
};

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
  const capChip = formatCapChip(capWatts);

  return (
    <span
      className={`rack-component-bay rack-component-bay--power rack-component-bay--power-${heatZone} ${
        issue ? "rack-component-bay--issue" : ""
      }`}
      title={title}
      aria-label={title}
    >
      <span className="rack-component-bay-viz">
        <span
          className={`rack-power-column ${overload ? "overload" : ""}`}
          aria-hidden="true"
        >
          <span
            className="rack-power-column-fill"
            style={{ "--rack-power-fill": fill } as CSSProperties}
          />
          <span className="rack-power-column-threshold" aria-hidden="true" />
        </span>
      </span>
      <span className="rack-gauge-strip rack-gauge-strip--power">
        <span className="rack-gauge-value rack-component-power-value">
          {formatWatts(drawWatts)}
        </span>
        {capChip && (
          <span className="rack-gauge-chip rack-component-power-value">{capChip}</span>
        )}
        {powerCostPerSecond > 0 && (
          <span className="rack-gauge-chip rack-gauge-chip--rate rack-component-rate">
            -{formatPowerRate(powerCostPerSecond)} cr/s
          </span>
        )}
      </span>
    </span>
  );
}
