import type { VisibleState } from "../../game";
import { clampMeter } from "../panels/uiNumbers";
import type { CacheSegment, CacheSegmentKind, CacheSegmentState, RamSegment } from "./meters";

const CACHE_DISPLAY_EPSILON_BITS = 1e-9;
const normalizeCacheBits = (bits: number) =>
  Math.abs(bits) <= CACHE_DISPLAY_EPSILON_BITS ? 0 : bits;

const getCacheSegmentKind = (
  action: string | null | undefined,
): CacheSegmentKind =>
  action === "overwrite"
    ? "overwrite"
    : action === "write"
      ? "write"
      : action === "read"
        ? "read"
        : "compute";

const getLegacyCacheReadyBits = (
  bits: number,
  state: CacheSegmentState,
  progress: number,
  bufferProgress: number,
) => {
  if (state === "loaded") return bits;
  if (state === "buffering") return bits * Math.min(progress, bufferProgress);
  return bits * progress;
};

export const toCacheSegment = (
  segment: VisibleState["metrics"]["cacheResidency"][number],
): CacheSegment => {
  const state = segment.state ?? "loaded";
  const progress = clampMeter(segment.progress ?? 1);
  const bufferProgress = clampMeter(segment.bufferProgress ?? 1);
  const readyBits = normalizeCacheBits(
    segment.readyBits ?? getLegacyCacheReadyBits(segment.bits, state, progress, bufferProgress),
  );
  const bufferBits = normalizeCacheBits(
    segment.bufferBits ??
    (state === "buffering"
      ? Math.max(0, segment.bits * bufferProgress - readyBits)
      : 0),
  );
  const committedBits = normalizeCacheBits(
    segment.committedBits ?? readyBits + bufferBits,
  );

  return {
    kind: getCacheSegmentKind(segment.memoryAction),
    state: bufferBits > 0 ? "buffering" : "loaded",
    coreId: segment.coreId,
    bits: segment.bits,
    readyBits,
    bufferBits,
    committedBits,
    progress,
    bufferProgress,
  };
};

const emptyCacheStateBits = (): Record<CacheSegmentState, number> => ({
  buffering: 0,
  loading: 0,
  loaded: 0,
});

export const getCacheStateBits = (segments: CacheSegment[]) =>
  segments.reduce((totals, segment) => {
    totals.buffering += segment.bufferBits;
    totals.loaded += segment.readyBits;
    return totals;
  }, emptyCacheStateBits());

export const getCachePrimaryState = (segments: CacheSegment[]) => {
  if (segments.some((segment) => segment.bufferBits > 0)) return "Buffer";
  if (segments.some((segment) => segment.readyBits > 0)) return "Loaded";
  return "Idle";
};

export const getRamReservation = (visible: VisibleState) => {
  const segments = (visible.metrics.ramResidency ?? []).map(
    (segment): RamSegment => ({
      state: segment.state ?? "loaded",
      coreId: segment.coreId,
      stickId: segment.stickId,
      startBit: segment.startBit,
      bits: segment.bits,
      loadedBits: segment.loadedBits,
      channelIndex: segment.channelIndex,
      progress: clampMeter(segment.progress ?? 1),
    }),
  );

  return {
    segments,
    reservedBits: segments.reduce((total, segment) => total + segment.bits, 0),
    loadingBits: segments
      .filter((segment) => segment.state === "reserved" || segment.state === "loading")
      .reduce((total, segment) => total + segment.bits, 0),
  };
};

