import { describe, expect, it } from "vitest";
import { amount, amountAdd } from "../game";
import {
  formatCost,
  formatCurrencyAmount,
  formatExactCurrencyAmount,
  formatExactResourceAmount,
  formatExactResourceRate,
  formatQuantity,
  formatResourceAmount,
  formatResourceRate,
  formatResources,
  formatWatts,
} from "./format";

describe("resource formatting", () => {
  it("keeps resource amounts unscaled below 100,000 and never shows decimals", () => {
    expect(formatResourceAmount(99.5)).toBe("99");
    expect(formatResourceAmount(99_999)).toBe("99999");
  });

  it("floors currency amounts to whole units at render time", () => {
    expect(formatCurrencyAmount(0)).toBe("0");
    expect(formatCurrencyAmount(0.999)).toBe("0");
    expect(formatCurrencyAmount(24_374.3316083554)).toBe("24374");
    expect(formatCurrencyAmount(-12.7)).toBe("-12");
    expect(formatCurrencyAmount(999.999)).toBe("999");
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

  it("clamps rates to at most one decimal place", () => {
    expect(formatResourceRate(0.125)).toBe("0.1");
    expect(formatResourceRate(53.333333333)).toBe("53.3");
    expect(formatResourceRate(100_000)).toBe("100 K");
  });

  it("clamps generic quantities to tenths, including negatives", () => {
    expect(formatQuantity(-1_028.4321)).toBe("-1,028");
    expect(formatQuantity(-10.28)).toBe("-10.3");
    expect(formatQuantity(0)).toBe("0");
  });

  it("scales watts so the mantissa is >= 1 before rounding to tenths", () => {
    expect(formatWatts(0.000979116887)).toBe("979.1 uW");
    expect(formatWatts(-0.000979116887)).toBe("-979.1 uW");
    expect(formatWatts(0.0000005)).toBe("500 nW");
    expect(formatWatts(0.25)).toBe("250 mW");
    expect(formatWatts(0)).toBe("0 W");
    expect(formatWatts(1_234)).toBe("1.2 kW");
    expect(formatWatts(2_500_000)).toBe("2.5 MW");
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
    ["0.12549", "0.1"],
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

  it("clamps exact fractional tails to tenths and keeps negative truncation", () => {
    expect(formatExactResourceAmount(amount("0"))).toBe("0");
    expect(formatExactResourceAmount(amount("0.125"))).toBe("0.1");
    expect(formatExactResourceAmount(amount("-0.125"))).toBe("-0.1");
    expect(formatExactResourceAmount(amount("53.333333333333333"))).toBe("53.3");
    expect(formatExactResourceAmount(amount("2.04"))).toBe("2");
    expect(formatExactResourceAmount(amount("-100999.75"))).toBe("-100 K");
  });

  it("never shows decimals on exact currency amounts", () => {
    expect(formatExactCurrencyAmount(amount("0"))).toBe("0");
    expect(formatExactCurrencyAmount(amount("0.999"))).toBe("0");
    expect(formatExactCurrencyAmount(amount("-0.999"))).toBe("0");
    expect(formatExactCurrencyAmount(amount("24374.3316083554"))).toBe("24374");
    expect(formatExactCurrencyAmount(amount("-12.7"))).toBe("-12");
    expect(formatExactCurrencyAmount(amount("100000.5"))).toBe("100 K");
    expect(formatExactCurrencyAmount(amount("-100999.75"))).toBe("-100 K");
    expect(formatExactCurrencyAmount(amount("1e309"))).toBe("1e309");
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
