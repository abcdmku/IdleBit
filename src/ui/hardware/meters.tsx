import type { CSSProperties } from "react";
import { formatBits } from "../format";
import { SmoothFill } from "../SmoothProgress";

export type CacheSegmentKind = "read" | "write" | "overwrite" | "compute";
export type CacheSegmentState = "buffering" | "loading" | "loaded";
export type RamSegmentState = "reserved" | "loading" | "loaded";

export interface CacheSegment {
  kind: CacheSegmentKind;
  state: CacheSegmentState;
  coreId: number;
  bits: number;
  bufferBits: number;
  readyBits: number;
  committedBits: number;
  progress: number;
  bufferProgress: number;
}

export interface RamSegment {
  state: RamSegmentState;
  coreId: number;
  stickId?: number;
  startBit?: number;
  bits: number;
  loadedBits?: number;
  channelIndex?: number;
  progress: number;
}

export const clampMeter = (value: number | null | undefined) =>
  Math.min(1, Math.max(0, value ?? 0));

const getProgressPercent = (value: number | null | undefined) =>
  `${clampMeter(value) * 100}%`;

export const getCoreHue = (coreId: number) => (168 + (coreId - 1) * 47) % 360;

export const getCoreSegmentColor = (coreId: number, alpha: number) =>
  `hsla(${getCoreHue(coreId)}, 82%, 62%, ${alpha})`;

const cacheStateLabels: Array<{ state: CacheSegmentState; label: string }> = [
  { state: "buffering", label: "Buffer" },
  { state: "loaded", label: "Loaded" },
];

const getCacheSegmentAlpha = (state: CacheSegmentState) => {
  if (state === "loaded") return 0.94;
  if (state === "loading") return 0.66;
  return 0.52;
};

const getCacheSegmentWriteProgress = (segment: CacheSegment) => {
  if (segment.state === "loaded") return 1;
  return clampMeter(segment.progress);
};

export function ModuleMeter({
  value,
  snapKey,
  snapOnDecrease = true,
}: {
  value: number;
  snapKey?: string;
  snapOnDecrease?: boolean;
}) {
  return (
    <span className="module-meter" aria-hidden="true">
      <SmoothFill
        value={value}
        snapKey={snapKey}
        snapOnDecrease={snapOnDecrease}
      />
    </span>
  );
}

function CacheStateBadge({
  state,
  label,
  bits,
}: {
  state: CacheSegmentState;
  label: string;
  bits: number;
}) {
  return (
    <span
      className={`cache-state-badge ${state} ${bits > 0 ? "active" : ""}`}
      title={`${label}: ${formatBits(bits)}`}
    >
      <small>{label}</small>
      <strong>{formatBits(bits)}</strong>
    </span>
  );
}

export function CachePipeline({
  segments,
  stateBits,
  capacityBits,
}: {
  segments: CacheSegment[];
  stateBits: Record<CacheSegmentState, number>;
  capacityBits: number;
}) {
  const getLaneSegments = (state: CacheSegmentState) =>
    segments.flatMap((segment) => {
      const bits = state === "buffering" ? segment.bufferBits : segment.readyBits;
      if (bits <= 0) return [];

      return [
        {
          ...segment,
          state,
          bits,
          progress: state === "buffering" ? 0 : 1,
          bufferProgress: state === "buffering" ? 1 : 0,
        },
      ];
    });

  return (
    <div className="cache-meter-block cache-pipeline" aria-label="Cache states">
      {cacheStateLabels.map(({ state, label }) => {
        const bits = stateBits[state];
        const laneSegments = getLaneSegments(state);

        return (
          <div
            className={`cache-pipeline-row ${state} ${bits > 0 ? "active" : ""}`}
            key={state}
          >
            <CacheStateBadge state={state} label={label} bits={bits} />
            <span className="cache-pipeline-track">
              <CachePressureMeter segments={laneSegments} capacityBits={capacityBits} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function RamPressureMeter({
  segments,
  capacityBits,
}: {
  segments: RamSegment[];
  capacityBits: number;
}) {
  const capacity = Math.max(1, capacityBits);
  const positioned = segments.some((segment) => segment.startBit !== undefined);
  let remaining = capacity;
  const visibleSegments = positioned
    ? segments
        .filter((segment) => segment.bits > 0)
        .map((segment) => ({
          ...segment,
          bits: Math.min(segment.bits, Math.max(0, capacity - (segment.startBit ?? 0))),
        }))
        .filter((segment) => segment.bits > 0)
    : segments.flatMap((segment) => {
        if (remaining <= 0 || segment.bits <= 0) return [];

        const startBit = capacity - remaining;
        const bits = Math.min(remaining, segment.bits);
        remaining -= bits;
        return [{ ...segment, startBit, bits }];
      });

  if (visibleSegments.length === 0) {
    return <ModuleMeter value={0} />;
  }

  return (
    <span className="module-meter ram-pressure-meter" aria-hidden="true">
      {visibleSegments.map((segment, index) => (
        <span
          key={`${segment.coreId}-${segment.state}-${index}`}
          className={`ram-pressure-segment ${segment.state}`}
          style={
            {
              width: `${(segment.bits / capacity) * 100}%`,
              left: `${((segment.startBit ?? 0) / capacity) * 100}%`,
              "--ram-core-color": getCoreSegmentColor(
                segment.coreId,
                segment.state === "loaded" ? 0.9 : 0.58,
              ),
              "--ram-core-solid-color": getCoreSegmentColor(
                segment.coreId,
                segment.state === "loaded" ? 0.94 : 0.82,
              ),
              "--ram-load-progress": `${
                (segment.state === "loaded" ? 1 : clampMeter(segment.progress)) * 100
              }%`,
              "--ram-load-progress-ratio":
                segment.state === "loaded" ? 1 : clampMeter(segment.progress),
            } as CSSProperties
          }
        >
          <SmoothFill
            className="ram-pressure-fill"
            value={segment.state === "loaded" ? 1 : segment.progress}
          />
        </span>
      ))}
    </span>
  );
}

function CachePressureMeter({
  segments,
  capacityBits,
}: {
  segments: CacheSegment[];
  capacityBits: number;
}) {
  const capacity = Math.max(1, capacityBits);
  let remaining = capacity;
  const visibleSegments = segments.flatMap((segment) => {
    if (remaining <= 0 || segment.bits <= 0) return [];

    const bits = Math.min(remaining, segment.bits);
    remaining -= bits;
    return [{ ...segment, bits }];
  });

  return (
    <span className="module-meter cache-pressure-meter" aria-hidden="true">
      {visibleSegments.map((segment, index) => (
        <span
          key={`${segment.kind}-${segment.state}-${index}`}
          className={`cache-pressure-segment cache-pressure-${segment.kind} ${segment.state}`}
          style={
            {
              width: `${(segment.bits / capacity) * 100}%`,
              "--cache-core-color": getCoreSegmentColor(
                segment.coreId,
                getCacheSegmentAlpha(segment.state),
              ),
              "--cache-core-solid-color": getCoreSegmentColor(
                segment.coreId,
                segment.state === "loaded" ? 0.94 : 0.86,
              ),
              "--cache-buffer-progress": `${
                (segment.state === "loading" || segment.state === "loaded"
                  ? 1
                  : clampMeter(segment.bufferProgress)) * 100
              }%`,
              "--cache-buffer-progress-ratio":
                segment.state === "loading" || segment.state === "loaded"
                  ? 1
                  : clampMeter(segment.bufferProgress),
              "--cache-write-progress": getProgressPercent(
                getCacheSegmentWriteProgress(segment),
              ),
              "--cache-write-progress-ratio": getCacheSegmentWriteProgress(segment),
            } as CSSProperties
          }
        >
          <SmoothFill
            className="cache-pressure-buffer"
            value={
              segment.state === "loading" || segment.state === "loaded"
                ? 1
                : segment.bufferProgress
            }
          />
          <SmoothFill
            className="cache-pressure-fill"
            value={getCacheSegmentWriteProgress(segment)}
          />
        </span>
      ))}
    </span>
  );
}
