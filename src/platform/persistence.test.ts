import { afterEach, describe, expect, it, vi } from "vitest";

import { createPersistenceAdapter } from "./persistence";
import type { IdleBitPlatformBridge } from "./platformBridge";

afterEach(() => {
  window.localStorage.clear();
  window.idleBitPlatform = undefined;
  vi.restoreAllMocks();
});

describe("immediate persistence", () => {
  it("writes browser storage before returning", async () => {
    const adapter = createPersistenceAdapter({ namespace: "immediate-browser" });

    expect(adapter.driver).toBe("browser");
    expect(adapter.setImmediate("departure", { savedAt: 123 })).toBe(true);
    expect(window.localStorage.getItem("immediate-browser:departure")).toBe(
      '{"savedAt":123}',
    );
    await expect(adapter.get("departure")).resolves.toEqual({ savedAt: 123 });
  });

  it("reports a synchronous browser write failure", () => {
    const adapter = createPersistenceAdapter({ namespace: "immediate-failure" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });

    expect(adapter.setImmediate("departure", "save")).toBe(false);
  });

  it("writes the memory fallback before returning", async () => {
    const storageWrite = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("storage unavailable", "SecurityError");
      });
    const adapter = createPersistenceAdapter({ namespace: "immediate-memory" });
    storageWrite.mockRestore();

    expect(adapter.driver).toBe("memory");
    expect(adapter.setImmediate("departure", ["saved", 123])).toBe(true);
    await expect(adapter.get("departure")).resolves.toEqual(["saved", 123]);
  });

  it("reports immediate Electron persistence as unavailable", async () => {
    const setItem = vi.fn(async () => undefined);
    const platformBridge: IdleBitPlatformBridge = {
      persistence: {
        clear: vi.fn(async () => undefined),
        getItem: vi.fn(async () => null),
        removeItem: vi.fn(async () => undefined),
        setItem,
      },
      runtime: { kind: "electron" },
    };
    window.idleBitPlatform = platformBridge;
    const adapter = createPersistenceAdapter({ namespace: "immediate-electron" });

    expect(adapter.driver).toBe("electron");
    expect(adapter.setImmediate("departure", "save")).toBe(false);
    expect(setItem).not.toHaveBeenCalled();

    await adapter.set("departure", "save");
    expect(setItem).toHaveBeenCalledWith(
      "immediate-electron:departure",
      '"save"',
    );
  });
});
