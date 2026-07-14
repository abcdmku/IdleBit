import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CachePipeline,
  RamPressureMeter,
  type CacheSegment,
  type RamSegment,
} from "./meters";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const makeCacheSegment = (
  bufferBits: number,
  readyBits: number,
): CacheSegment => ({
  kind: "write",
  state: "buffering",
  coreId: 1,
  bits: bufferBits + readyBits,
  bufferBits,
  readyBits,
  committedBits: readyBits,
  progress: 0,
  bufferProgress: 0.5,
});

const makeRamSegment = (
  bits: number,
  startBit: number,
  progress = 0.5,
): RamSegment => ({
  state: "loading",
  coreId: 1,
  startBit,
  bits,
  progress,
});

describe("pressure meter segments", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  const renderCachePipeline = (bufferBits: number) => {
    act(() =>
      root.render(
        <CachePipeline
          segments={[makeCacheSegment(bufferBits, 0)]}
          stateBits={{ buffering: bufferBits, loading: 0, loaded: 0 }}
          capacityBits={1}
        />,
      ),
    );
    return container.querySelector<HTMLElement>(
      ".cache-pipeline-row.buffering .cache-pressure-segment",
    )!;
  };

  it("interpolates cache lane growth and snaps batch resets", () => {
    // Growth across snapshots keeps the width transition live so CSS can
    // interpolate the 500ms steps at display FPS.
    let segment = renderCachePipeline(0.25);
    expect(segment.style.width).toBe("25%");
    expect(segment.classList.contains("is-snapping")).toBe(false);

    segment = renderCachePipeline(0.5);
    expect(segment.style.width).toBe("50%");
    expect(segment.classList.contains("is-snapping")).toBe(false);

    // A decrease is a batch commit/consumption: never animate backward.
    segment = renderCachePipeline(0.2);
    expect(segment.style.width).toBe("20%");
    expect(segment.classList.contains("is-snapping")).toBe(true);

    // The next growth re-enables interpolation.
    segment = renderCachePipeline(0.4);
    expect(segment.classList.contains("is-snapping")).toBe(false);
  });

  const renderRamMeter = (segment: RamSegment) => {
    act(() =>
      root.render(
        <RamPressureMeter segments={[segment]} capacityBits={8} />,
      ),
    );
    return container.querySelector<HTMLElement>(".ram-pressure-segment")!;
  };

  it("interpolates RAM block growth and snaps shrink or leftward moves", () => {
    let segment = renderRamMeter(makeRamSegment(4, 0));
    expect(segment.style.width).toBe("50%");
    expect(segment.style.left).toBe("0%");
    expect(segment.classList.contains("is-snapping")).toBe(false);

    segment = renderRamMeter(makeRamSegment(6, 0));
    expect(segment.style.width).toBe("75%");
    expect(segment.classList.contains("is-snapping")).toBe(false);

    // Freed reservation: extent shrinks — snap, never animate backward.
    segment = renderRamMeter(makeRamSegment(2, 0));
    expect(segment.classList.contains("is-snapping")).toBe(true);

    // Rightward slide (packing behind a growing neighbour) interpolates.
    segment = renderRamMeter(makeRamSegment(2, 2));
    expect(segment.classList.contains("is-snapping")).toBe(false);

    // Leftward slide is a repack after a free: snap.
    segment = renderRamMeter(makeRamSegment(2, 1));
    expect(segment.classList.contains("is-snapping")).toBe(true);
  });
});
