import { formatBits } from "../format";

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

  return (
    <span
      className={`rack-component-bay rack-component-bay--ram ${
        issue ? "rack-component-bay--issue" : ""
      }`}
      title={`RAM ${formatBits(usedBits)} / ${formatBits(totalBits)}`}
      aria-label={`RAM ${formatBits(usedBits)} / ${formatBits(totalBits)}`}
    >
      <span
        className={`rack-memory-bank ${slots.length > 8 ? "dense" : ""}`}
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
            <span
              className="rack-memory-stick-fill"
              style={{
                height: `${Math.max(0, Math.min(1, slot.ratio)) * 100}%`,
              }}
            />
          </span>
        ))}
      </span>
      <span className="rack-component-stat">
        {formatBits(usedBits)}
        <span className="rack-component-stat-sub"> / {formatBits(totalBits)}</span>
      </span>
    </span>
  );
}
