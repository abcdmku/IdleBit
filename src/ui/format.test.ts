import { describe, expect, it } from "vitest";
import {
  formatCost,
  formatResourceAmount,
  formatResourceRate,
  formatResources,
} from "./format";

describe("resource formatting", () => {
  it("keeps resource amounts unscaled below 100,000", () => {
    expect(formatResourceAmount(99.5)).toBe("99.5");
    expect(formatResourceAmount(99_999)).toBe("99999");
  });

  it("truncates resource amounts with current RuneScape-style stack suffixes", () => {
    expect(formatResourceAmount(100_000)).toBe("100 K");
    expect(formatResourceAmount(999_999)).toBe("999 K");
    expect(formatResourceAmount(1_000_000)).toBe("1000 K");
    expect(formatResourceAmount(9_999_999)).toBe("9999 K");
    expect(formatResourceAmount(10_000_000)).toBe("10 M");
    expect(formatResourceAmount(999_999_999)).toBe("999 M");
    expect(formatResourceAmount(9_999_999_999)).toBe("9999 M");
    expect(formatResourceAmount(10_000_000_000)).toBe("10 B");
    expect(formatResourceAmount(9_999_999_999_999)).toBe("9999 B");
    expect(formatResourceAmount(1e13)).toBe("10 T");
    expect(formatResourceAmount(9_999_999_999_990_000)).toBe("9999 T");
    expect(formatResourceAmount(1e16)).toBe("10 Q");
    expect(formatResourceAmount(999_999_999_999_000_000)).toBe("999 Q");
    expect(formatResourceAmount(1e19)).toBe("10 Qn");
    expect(formatResourceAmount(1e22)).toBe("10 S");
    expect(formatResourceAmount(1e25)).toBe("10 Sp");
  });

  it("applies the scale to game currencies in shared resource helpers", () => {
    expect(
      formatCost([
        { resource: "credits", amount: 1_000_000 },
        { resource: "data", amount: 1_000_000_000 },
      ]),
    ).toBe("1000 K credits + 1000 M data");
    expect(formatCost([{ resource: "cores", amount: 1_000_000 }])).toBe(
      "1,000,000 cores",
    );
    expect(formatResources({ credits: 1_000_000, data: 1_000_000_000 })).toEqual([
      { label: "Credits", value: "1000 K" },
      { label: "Data", value: "1000 M" },
    ]);
  });

  it("preserves fractional credit rates until they reach the resource scale", () => {
    expect(formatResourceRate(0.125)).toBe("0.125");
    expect(formatResourceRate(100_000)).toBe("100 K");
  });
});
