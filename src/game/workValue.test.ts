import { describe, expect, it } from "vitest";

import { amountAdd, amountMultiply } from "./amount";
import {
  createWorkValueMultiplier,
  getWorkValueCredits,
  sumPaidWorkUnits,
} from "./workValue";

describe("exact paid-work value", () => {
  it("values one base work unit at one Credit", () => {
    const base = createWorkValueMultiplier("base", 10_000);
    expect(getWorkValueCredits(1, base)).toBe("1");
  });

  it("applies an explicit named service multiplier to exact work", () => {
    const attended = createWorkValueMultiplier(
      "attended-live-operations",
      24_000,
    );
    expect(getWorkValueCredits(900, attended)).toBe("2160");
  });

  it("sums component work and preserves values beyond Number range", () => {
    const work = sumPaidWorkUnits(["1e309", "2e309", 5]);
    const expected = amountAdd("3e309", 5);
    expect(work).toBe(expected);
    expect(
      getWorkValueCredits(
        work,
        createWorkValueMultiplier("double", 20_000),
      ),
    ).toBe(amountMultiply(expected, 2));
  });

  it("rejects unnamed multipliers and negative work", () => {
    expect(() => createWorkValueMultiplier(" ", 10_000)).toThrow(
      "requires an id",
    );
    const base = createWorkValueMultiplier("base", 10_000);
    expect(() => getWorkValueCredits(-1, base)).toThrow(
      "Paid work must be non-negative",
    );
  });
});
