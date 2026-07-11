import { useLayoutEffect, useRef, type CSSProperties } from "react";

type MeterStyle = CSSProperties & { "--meter-progress": number };

type SmoothFillKey = string | number | boolean | null | undefined;

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
  const previous = useRef({ ratio, snapKey });
  const snapping =
    (snapOnDecrease && ratio + 0.001 < previous.current.ratio) ||
    !Object.is(previous.current.snapKey, snapKey);

  useLayoutEffect(() => {
    previous.current = { ratio, snapKey };
  }, [ratio, snapKey]);

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
