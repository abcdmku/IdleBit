import { afterEach, describe, expect, it } from "vitest";
import { getDevSeedId, isRackReadySeed } from "./persistence";

describe("dev seed URL recognition", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it.each([
    ["rack-ready", "rack-ready"],
    ["trillion", "rack-ready"],
    ["workshop-ready", "workshop-ready"],
    ["cloud-ready", "cloud-ready"],
    ["planetary-ready", "planetary-ready"],
    ["Planetary-Ready", "planetary-ready"],
  ] as const)("recognizes ?seed=%s as the %s seed", (raw, expected) => {
    window.history.replaceState(null, "", `/?seed=${raw}`);
    expect(getDevSeedId()).toBe(expected);
    expect(isRackReadySeed()).toBe(true);
  });

  it("ignores unknown and missing seed values", () => {
    window.history.replaceState(null, "", "/?seed=unknown");
    expect(getDevSeedId()).toBeNull();
    expect(isRackReadySeed()).toBe(false);

    window.history.replaceState(null, "", "/");
    expect(getDevSeedId()).toBeNull();
    expect(isRackReadySeed()).toBe(false);
  });
});
