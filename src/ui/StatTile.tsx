import type { ReactNode } from "react";

/**
 * Value-first readout: a big mono number over a tiny caption, optionally
 * backed by a 0..1 meter. Replaces label-left/value-right text ledgers so
 * numbers — not words — carry the interface.
 */
export function StatTile({
  label,
  value,
  unit,
  accent,
  meter,
  title,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  accent?: "cyan" | "green" | "violet" | "amber" | "rose";
  /** 0..1 fill for capacity-backed stats; omit for plain numbers. */
  meter?: number;
  title?: string;
}) {
  return (
    <div
      className={`stat-tile${accent ? ` is-${accent}` : ""}`}
      title={title}
      aria-label={title ?? `${label} ${typeof value === "string" ? value : ""}${unit ? ` ${unit}` : ""}`}
    >
      <strong className="stat-tile-value">
        {value}
        {unit && <small>{unit}</small>}
      </strong>
      {typeof meter === "number" && (
        <span className="stat-tile-meter" aria-hidden="true">
          <span
            className="stat-tile-meter-fill"
            style={{ transform: `scaleX(${Math.min(1, Math.max(0, meter))})` }}
          />
        </span>
      )}
      <span className="stat-tile-label">{label}</span>
    </div>
  );
}

/** Evenly divided row of stat tiles. */
export function StatTileRow({
  children,
  dense = false,
}: {
  children: ReactNode;
  dense?: boolean;
}) {
  return (
    <div className={`stat-tile-row${dense ? " dense" : ""}`}>{children}</div>
  );
}
