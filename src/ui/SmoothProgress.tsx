import { useLayoutEffect, useRef, type CSSProperties } from "react";

type MeterStyle = CSSProperties & { "--meter-progress": number };

type SmoothFillKey = string | number | boolean | null | undefined;

/**
 * Shared snap detection for runtime meters that interpolate across 500ms
 * simulation snapshots via a CSS transition. Returns true on exactly the
 * renders where the transition must be suppressed: monotonic meters snap on
 * EVERY decrease — no jitter tolerance — so a batch reset never animates
 * backward, and any semantic snapKey change also snaps. Bidirectional gauges
 * pass snapOnDecrease={false} and rely on snapKey alone.
 */
export function useMeterSnap(
  value: number,
  snapKey?: SmoothFillKey,
  snapOnDecrease = true,
): boolean {
  const previous = useRef({ value, snapKey });
  const snapping =
    (snapOnDecrease && value < previous.current.value) ||
    !Object.is(previous.current.snapKey, snapKey);

  useLayoutEffect(() => {
    previous.current = { value, snapKey };
  }, [value, snapKey]);

  return snapping;
}

export function SmoothFill({
  value,
  max = 1,
  className = "",
  orientation = "horizontal",
  snapKey,
  snapOnDecrease = true,
}: {
  value: number;
  max?: number;
  className?: string;
  orientation?: "horizontal" | "vertical";
  snapKey?: SmoothFillKey;
  snapOnDecrease?: boolean;
}) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const safeValue = Number.isFinite(value)
    ? Math.max(0, Math.min(safeMax, value))
    : 0;
  const ratio = safeValue / safeMax;
  const snapping = useMeterSnap(ratio, snapKey, snapOnDecrease);

  return (
    <span
      className={`progress-fill ${orientation === "vertical" ? "is-vertical" : ""} ${
        snapping ? "is-snapping" : ""
      } ${className}`.trim()}
      style={{ "--meter-progress": ratio } as MeterStyle}
    />
  );
}

export function SmoothProgress({
  value,
  max = 1,
  className = "",
  label,
  valueText,
  resetKey,
}: {
  value: number;
  max?: number;
  className?: string;
  label?: string;
  valueText?: string;
  resetKey?: SmoothFillKey;
}) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const safeValue = Number.isFinite(value)
    ? Math.max(0, Math.min(safeMax, value))
    : 0;
  return (
    <span
      className={`smooth-progress ${className}`.trim()}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={safeValue}
      aria-valuetext={valueText}
    >
      <SmoothFill
        value={safeValue}
        max={safeMax}
        snapKey={resetKey}
      />
    </span>
  );
}
