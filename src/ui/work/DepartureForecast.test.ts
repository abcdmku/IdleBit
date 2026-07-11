import { describe, expect, it } from "vitest";
import { amount, amountAdd } from "../../game";
import { getCreditRunwayWithinCoverageMs } from "./DepartureForecast";

describe("exact departure credit runway", () => {
  it("never projects a huge balance through Number", () => {
    const sevenDaysMs = 168 * 60 * 60 * 1_000;
    expect(
      getCreditRunwayWithinCoverageMs(amount("1e309"), 1, sevenDaysMs),
    ).toBe(sevenDaysMs);
    expect(
      getCreditRunwayWithinCoverageMs(
        amountAdd(amount("1e309"), 1),
        1,
        sevenDaysMs,
      ),
    ).toBe(sevenDaysMs);
  });

  it("converts only a runway proven smaller than bounded coverage", () => {
    expect(getCreditRunwayWithinCoverageMs(amount("1.5"), 1, 10_000)).toBe(
      1_500,
    );
    expect(getCreditRunwayWithinCoverageMs(amount(10), 0, 10_000)).toBeNull();
  });
});
