import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TopbarPersistenceStatus,
  type PersistenceReadout,
} from "./TopbarPersistenceStatus";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("TopbarPersistenceStatus", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  const renderStatus = (status: PersistenceReadout) => {
    act(() => root.render(<TopbarPersistenceStatus status={status} />));
  };

  it("does not render routine unannounced Saved status", () => {
    renderStatus({
      phase: "saved",
      message: "Saved",
      lastSavedAtMs: 100,
      announcement: null,
    });

    expect(container.querySelector(".topbar-persistence")).toBeNull();
  });

  it("keeps polite Saved announcements available without visible chrome", () => {
    renderStatus({
      phase: "saved",
      message: "Saved",
      lastSavedAtMs: 100,
      announcement: "polite",
    });

    const status = container.querySelector(".topbar-persistence");
    expect(status?.classList.contains("sr-only")).toBe(true);
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toBe("Saved");
  });

  it("shows saving state and exposes errors assertively", () => {
    renderStatus({
      phase: "saving",
      message: "Saving…",
      lastSavedAtMs: 100,
      announcement: null,
    });
    expect(
      container.querySelector(".topbar-persistence.saving")?.textContent,
    ).toBe("Saving…");
    expect(container.querySelector(".topbar-persistence.sr-only")).toBeNull();

    renderStatus({
      phase: "error",
      message: "Save failed: disk unavailable",
      lastSavedAtMs: 100,
      announcement: "assertive",
    });
    const error = container.querySelector(".topbar-persistence.error");
    expect(error?.getAttribute("role")).toBe("alert");
    expect(error?.getAttribute("aria-live")).toBe("assertive");
    expect(error?.textContent).toContain("disk unavailable");
  });
});
