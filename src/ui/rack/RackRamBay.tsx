import type { CSSProperties } from "react";
import { formatBits } from "../format";
import { SmoothFill } from "../SmoothProgress";
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

export function RackRamBay({ usedBits, totalBits, slots, issue }: RackRamBayProps) {
  if (totalBits <= 0) return null;

  const ratio = Math.max(0, Math.min(1, usedBits / totalBits));
  const percent = Math.round(ratio * 100);
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
      <span className="rack-component-bay-caption" aria-hidden="true">
        RAM
      </span>
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
                <SmoothFill
                  className="rack-memory-stick-fill"
                  value={slot.ratio}
                  orientation="vertical"
                  snapKey={slot.active}
                  snapOnDecrease={false}
                />
              )}
            </span>
          ))}
        </span>
      </span>
      <span className="rack-gauge-strip rack-gauge-strip--queue">
        <span className="rack-gauge-bar" aria-hidden="true">
          <SmoothFill
            className="rack-gauge-bar-fill"
            value={ratio}
            snapKey={issue}
            snapOnDecrease={false}
          />
        </span>
        <span className="rack-gauge-value">{percent}%</span>
      </span>
    </span>
  );
}
