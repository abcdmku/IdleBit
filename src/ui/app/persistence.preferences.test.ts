import { afterEach, describe, expect, it, vi } from "vitest";
import { idleBitPersistence } from "../../platform";
import { persistUiPreferenceWithRetry } from "./persistence";

describe("persistUiPreferenceWithRetry", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await idleBitPersistence.clear();
  });

  it("writes the preference on the first attempt when storage works", async () => {
    const set = vi.spyOn(idleBitPersistence, "set");

    await expect(
      persistUiPreferenceWithRetry("ui.test-pref-v1", true, 0),
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledTimes(1);
    await expect(
      idleBitPersistence.get<boolean>("ui.test-pref-v1", false),
    ).resolves.toBe(true);
  });

  it("retries a rejected write once and succeeds", async () => {
    const set = vi
      .spyOn(idleBitPersistence, "set")
      .mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(
      persistUiPreferenceWithRetry("ui.test-pref-v1", true, 0),
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledTimes(2);
    await expect(
      idleBitPersistence.get<boolean>("ui.test-pref-v1", false),
    ).resolves.toBe(true);
  });

  it("surfaces a persistent failure instead of dropping it silently", async () => {
    const set = vi
      .spyOn(idleBitPersistence, "set")
      .mockRejectedValue(new Error("storage unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      persistUiPreferenceWithRetry("ui.test-pref-v1", true, 0),
    ).resolves.toBe(false);
    expect(set).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('ui.test-pref-v1'),
      expect.any(Error),
    );
  });
});
