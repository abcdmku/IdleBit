import type { CSSProperties } from "react";
import { formatBits } from "../format";
import { getRackRamGridMetrics } from "./rackMetrics";

export interface RackRamVisualSlot {
  id: string;
  ratio: number;
  populated: boolean;
  active: boolean;
  title: string;
}

interface RackRamBayProps {
  usedBits: number;
  totalBits: number;
  slots: RackRamVisualSlot[];
  issue: boolean;
}

const formatCapChip = (bits: number) => {
  if (bits <= 0) return null;
  if (bits >= 1_000_000_000) {
    const value = bits / 1_000_000_000;
    return `${value >= 100 ? Math.round(value) : Number(value.toFixed(value >= 10 ? 0 : 1))}G`;
  }
  if (bits >= 1_000_000) {
    const value = bits / 1_000_000;
    return `${value >= 100 ? Math.round(value) : Number(value.toFixed(value >= 10 ? 0 : 1))}M`;
  }
  if (bits >= 1_000) {
    const value = bits / 1_000;
    return `${value >= 100 ? Math.round(value) : Number(value.toFixed(value >= 10 ? 0 : 1))}K`;
  }
  return `${Math.round(bits)}`;
};

export function RackRamBay({ usedBits, totalBits, slots, issue }: RackRamBayProps) {
  if (totalBits <= 0) return null;

  const ratio = Math.max(0, Math.min(1, usedBits / totalBits));
  const percent = Math.round(ratio * 100);
  const capChip = formatCapChip(totalBits);
  const metrics = getRackRamGridMetrics(slots.length);
  const fullLabel = `RAM ${formatBits(usedBits)} / ${formatBits(totalBits)}`;
  const showFill = metrics.density !== "micro";

  return (
    <span
      className={`rack-component-bay rack-component-bay--ram ${
        issue ? "rack-component-bay--issue" : ""
      }`}
      title={fullLabel}
      aria-label={fullLabel}
    >
      <span className="rack-component-bay-viz">
        <span
          className={`rack-memory-bank ${metrics.density}`}
          style={
            {
              "--rack-ram-columns": metrics.columns,
              "--rack-ram-stick-width": `${metrics.stickWidth}px`,
              "--rack-ram-stick-height": `${metrics.stickHeight}px`,
              "--rack-ram-gap": `${metrics.gap}px`,
            } as CSSProperties
          }
          aria-hidden="true"
        >
          {slots.map((slot) => (
            <span
              key={slot.id}
              className={`rack-memory-stick ${slot.populated ? "populated" : ""} ${
                slot.active ? "loading" : ""
              }`}
              title={slot.title}
            >
              {showFill && (
                <span
                  className="rack-memory-stick-fill"
                  style={{
                    height: `${Math.max(0, Math.min(1, slot.ratio)) * 100}%`,
                  }}
                />
              )}
            </span>
          ))}
        </span>
      </span>
      <span className="rack-gauge-strip">
        <span
          className="rack-gauge-bar"
          style={{ "--rack-gauge-fill": ratio } as CSSProperties}
          aria-hidden="true"
        />
        <span className="rack-gauge-value">{percent}%</span>
        {capChip && <span className="rack-gauge-chip">{capChip}</span>}
      </span>
    </span>
  );
}
