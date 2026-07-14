import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SmoothFill, SmoothProgress } from "./SmoothProgress";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("SmoothProgress", () => {
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

  it("publishes exact ARIA snapshots and snaps backward batch resets", () => {
    act(() => root.render(<SmoothProgress value={0.25} label="Batch" />));
    const meter = container.querySelector<HTMLElement>('[role="progressbar"]')!;
    const fill = meter.querySelector<HTMLElement>(".progress-fill")!;
    expect(meter.getAttribute("aria-valuenow")).toBe("0.25");
    expect(fill.style.getPropertyValue("--meter-progress")).toBe("0.25");
    expect(fill.classList.contains("is-snapping")).toBe(false);

    act(() => root.render(<SmoothProgress value={0.75} label="Batch" />));
    expect(fill.classList.contains("is-snapping")).toBe(false);

    act(() => root.render(<SmoothProgress value={0.05} label="Batch" />));
    expect(fill.classList.contains("is-snapping")).toBe(true);
    expect(meter.getAttribute("aria-valuenow")).toBe("0.05");
  });

  it("snaps every decrease on monotonic meters, including tiny ones", () => {
    act(() => root.render(<SmoothProgress value={0.5} label="Batch" />));
    const fill = container.querySelector<HTMLElement>(".progress-fill")!;
    expect(fill.classList.contains("is-snapping")).toBe(false);

    // A decrease of <= 0.001 must still snap: monotonic meters never run
    // backward, no matter how small the reset delta is.
    act(() => root.render(<SmoothProgress value={0.4995} label="Batch" />));
    expect(fill.classList.contains("is-snapping")).toBe(true);
    expect(fill.style.getPropertyValue("--meter-progress")).toBe("0.4995");
  });

  it("smooths bidirectional gauges but snaps semantic safety-state changes", () => {
    act(() =>
      root.render(
        <SmoothFill
          value={0.8}
          snapKey="nominal"
          snapOnDecrease={false}
        />,
      ),
    );
    const fill = container.querySelector<HTMLElement>(".progress-fill")!;

    act(() =>
      root.render(
        <SmoothFill
          value={0.4}
          snapKey="nominal"
          snapOnDecrease={false}
        />,
      ),
    );
    expect(fill.classList.contains("is-snapping")).toBe(false);
    expect(fill.style.getPropertyValue("--meter-progress")).toBe("0.4");

    act(() =>
      root.render(
        <SmoothFill
          value={0.5}
          snapKey="critical"
          snapOnDecrease={false}
        />,
      ),
    );
    expect(fill.classList.contains("is-snapping")).toBe(true);
  });

  it("clamps visual and exact semantic values without inventing state", () => {
    act(() =>
      root.render(
        <SmoothProgress
          value={12_000}
          max={10_000}
          label="Workload"
          valueText="Complete"
        />,
      ),
    );
    const meter = container.querySelector<HTMLElement>('[role="progressbar"]')!;
    const fill = meter.querySelector<HTMLElement>(".progress-fill")!;

    expect(meter.getAttribute("aria-valuemax")).toBe("10000");
    expect(meter.getAttribute("aria-valuenow")).toBe("10000");
    expect(meter.getAttribute("aria-valuetext")).toBe("Complete");
    expect(fill.style.getPropertyValue("--meter-progress")).toBe("1");
  });
});
