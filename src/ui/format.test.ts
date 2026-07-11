import { describe, expect, it } from "vitest";
import { amount, amountAdd } from "../game";
import {
  formatCost,
  formatExactResourceAmount,
  formatExactResourceRate,
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

describe("exact resource formatting", () => {
  it.each([
    ["99999", "99999"],
    ["100000", "100 K"],
    ["9999999", "9999 K"],
    ["10000000", "10 M"],
    ["9999999999", "9999 M"],
    ["10000000000", "10 B"],
    ["10000000000000", "10 T"],
    ["10000000000000000", "10 Q"],
    ["10000000000000000000", "10 Qn"],
    ["10000000000000000000000", "10 S"],
    ["10000000000000000000000000", "10 Sp"],
    ["9999999999999999999999999999", "9999 Sp"],
    ["10000000000000000000000000000", "1e28"],
  ])("keeps the named stack boundary for %s", (raw, expected) => {
    expect(formatExactResourceAmount(amount(raw))).toBe(expected);
  });

  it.each([
    ["53.333333333333333", "53.3"],
    ["0.12549", "0.125"],
    ["100000", "100 K"],
    ["1e309", "1e309"],
  ])("compacts the exact rate %s as %s", (raw, expected) => {
    expect(formatExactResourceRate(amount(raw))).toBe(expected);
  });

  it("bounds a 1,024-digit computed rate tail", () => {
    const repeatingRate = amount(`19079.${"9".repeat(1_019)}`);

    expect(String(repeatingRate)).toHaveLength(1_025);
    expect(formatExactResourceRate(repeatingRate)).toBe("19,080");
  });

  it("preserves zero, fractional digits, and negative truncation", () => {
    expect(formatExactResourceAmount(amount("0"))).toBe("0");
    expect(formatExactResourceAmount(amount("0.125"))).toBe("0.125");
    expect(formatExactResourceAmount(amount("-0.125"))).toBe("-0.125");
    expect(formatExactResourceAmount(amount("-100999.75"))).toBe("-100 K");
  });

  it("formats values beyond Number range and distinguishes a huge balance plus one", () => {
    const huge = amount("1e309");
    const hugePlusOne = amountAdd(huge, 1);

    expect(formatExactResourceAmount(huge)).toBe("1e309");
    expect(formatExactResourceAmount(hugePlusOne)).toBe("1…001e309");
    expect(formatExactResourceAmount(hugePlusOne)).not.toBe(
      formatExactResourceAmount(huge),
    );
  });
});
