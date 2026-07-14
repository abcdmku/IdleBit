import type { Amount } from "../game/amount";
import type { ResourceBag } from "../game/types";

export interface DisplayCost {
  resource: string;
  amount: number;
}

const STACK_K_THRESHOLD = 100_000;
const RESOURCE_STACK_BANDS = [
  { threshold: 1e25, divisor: 1e24, suffix: "Sp" },
  { threshold: 1e22, divisor: 1e21, suffix: "S" },
  { threshold: 1e19, divisor: 1e18, suffix: "Qn" },
  {
    threshold: 1e16,
    divisor: 1e15,
    suffix: "Q",
  },
  {
    threshold: 1e13,
    divisor: 1e12,
    suffix: "T",
  },
  { threshold: 10_000_000_000, divisor: 1_000_000_000, suffix: "B" },
  { threshold: 10_000_000, divisor: 1_000_000, suffix: "M" },
  { threshold: STACK_K_THRESHOLD, divisor: 1_000, suffix: "K" },
] as const;
const GAME_CURRENCY_RESOURCES = new Set(["credits", "data"]);

const EXACT_RESOURCE_STACK_BANDS = [
  { thresholdExponent: 25, divisorExponent: 24, suffix: "Sp" },
  { thresholdExponent: 22, divisorExponent: 21, suffix: "S" },
  { thresholdExponent: 19, divisorExponent: 18, suffix: "Qn" },
  { thresholdExponent: 16, divisorExponent: 15, suffix: "Q" },
  { thresholdExponent: 13, divisorExponent: 12, suffix: "T" },
  { thresholdExponent: 10, divisorExponent: 9, suffix: "B" },
  { thresholdExponent: 7, divisorExponent: 6, suffix: "M" },
  { thresholdExponent: 5, divisorExponent: 3, suffix: "K" },
] as const;
const MAX_NAMED_BAND_COEFFICIENT_DIGITS = 4;
const SCIENTIFIC_LEADING_DIGITS = 6;
const SCIENTIFIC_TRAILING_DIGITS = 3;

const parseCanonicalAmount = (value: Amount) => {
  const raw = String(value);
  const negative = raw.startsWith("-");
  const unsigned = negative || raw.startsWith("+") ? raw.slice(1) : raw;
  const [rawInteger = "0", rawFraction = ""] = unsigned.split(".");
  const integer = rawInteger.replace(/^0+(?=\d)/, "") || "0";
  const fraction = rawFraction.replace(/0+$/, "");
  const zero = integer === "0" && !/[1-9]/.test(fraction);

  return {
    sign: negative && !zero ? "-" : "",
    integer,
    fraction,
    zero,
  };
};

const formatExactScientific = ({
  sign,
  integer,
  fraction,
}: ReturnType<typeof parseCanonicalAmount>) => {
  const significantDigits = `${integer}${fraction}`;
  const leadingDigits = significantDigits.slice(0, SCIENTIFIC_LEADING_DIGITS);
  const leadingFraction = leadingDigits.slice(1).replace(/0+$/, "");
  const coefficient = `${leadingDigits[0]}${
    leadingFraction ? `.${leadingFraction}` : ""
  }`;
  const omittedDigits = significantDigits.slice(SCIENTIFIC_LEADING_DIGITS);
  const omittedNonZero = /[1-9]/.test(omittedDigits);
  const distinguishingTail = omittedNonZero
    ? `…${significantDigits.slice(-SCIENTIFIC_TRAILING_DIGITS)}`
    : "";

  return `${sign}${coefficient}${distinguishingTail}e${integer.length - 1}`;
};

/**
 * Formats canonical Amount strings without projecting them through JavaScript
 * numbers. Named stack bands retain the legacy truncation rules; values beyond
 * a four-digit Sp coefficient use a bounded scientific representation.
 *
 * Display rule: fractional tails are clamped to at most one decimal digit
 * (tenths). Exactness lives in the simulation; this is a render-only clamp.
 */
export const formatExactResourceAmount = (value: Amount) => {
  const parsed = parseCanonicalAmount(value);
  if (parsed.zero) return "0";

  const spCoefficientDigits = parsed.integer.length - 24;
  if (spCoefficientDigits > MAX_NAMED_BAND_COEFFICIENT_DIGITS) {
    return formatExactScientific(parsed);
  }

  const band = EXACT_RESOURCE_STACK_BANDS.find(
    ({ thresholdExponent }) =>
      parsed.integer.length >= thresholdExponent + 1,
  );
  if (!band) {
    const tenths = parsed.fraction.slice(0, 1).replace(/0$/, "");
    return `${parsed.sign}${parsed.integer}${tenths ? `.${tenths}` : ""}`;
  }

  const coefficient = parsed.integer.slice(0, -band.divisorExponent);
  return `${parsed.sign}${coefficient} ${band.suffix}`;
};

/**
 * Currency display rule: Credits and Data AMOUNTS (costs, payouts, balances,
 * refunds) never show decimals. The fractional tail is dropped at render time
 * (magnitude floor); stack suffixes above 100K are unchanged.
 */
export const formatExactCurrencyAmount = (value: Amount) => {
  const parsed = parseCanonicalAmount(value);
  if (parsed.zero) return "0";

  const spCoefficientDigits = parsed.integer.length - 24;
  if (spCoefficientDigits > MAX_NAMED_BAND_COEFFICIENT_DIGITS) {
    return formatExactScientific(parsed);
  }

  const band = EXACT_RESOURCE_STACK_BANDS.find(
    ({ thresholdExponent }) => parsed.integer.length >= thresholdExponent + 1,
  );
  if (!band) {
    return parsed.integer === "0" ? "0" : `${parsed.sign}${parsed.integer}`;
  }

  const coefficient = parsed.integer.slice(0, -band.divisorExponent);
  return `${parsed.sign}${coefficient} ${band.suffix}`;
};

/**
 * Generic display quantity: at most ONE decimal place (tenths). Unit-bearing
 * readouts should scale their unit first (see formatWatts/formatClock) so the
 * mantissa is >= 1 before this clamp applies.
 */
export const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1,
  }).format(value);

/** Alias naming the display rule: unit-scale first, then clamp to tenths. */
export const formatQuantity = formatNumber;

const formatWholeMagnitude = (value: number) => {
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.floor(Math.abs(value))}`;
};

/**
 * Currency display rule: Credits/Data AMOUNTS never show decimals — the
 * fraction is dropped at render time (magnitude floor) below the 100K stack
 * threshold, and stack suffixes take over above it.
 */
export const formatResourceAmount = (amount: number) => {
  const absAmount = Math.abs(amount);
  if (!Number.isFinite(amount)) {
    return formatNumber(amount);
  }
  const band = RESOURCE_STACK_BANDS.find(
    (candidate) => absAmount >= candidate.threshold,
  );
  if (!band) {
    return formatWholeMagnitude(amount);
  }

  return `${formatWholeMagnitude(amount / band.divisor)} ${band.suffix}`;
};

/** Alias naming the currency display rule for number-domain amounts. */
export const formatCurrencyAmount = formatResourceAmount;

export const formatResourceRate = (amountPerSecond: number) => {
  const absAmountPerSecond = Math.abs(amountPerSecond);
  if (absAmountPerSecond >= STACK_K_THRESHOLD) {
    return formatResourceAmount(amountPerSecond);
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(amountPerSecond);
};

/**
 * Applies the compact rate precision to exact values that are small enough to
 * project safely, while retaining exact stack/scientific formatting at scale.
 */
export const formatExactResourceRate = (value: Amount) => {
  const parsed = parseCanonicalAmount(value);
  return parsed.integer.length >= 6
    ? formatExactResourceAmount(value)
    : formatResourceRate(Number(value));
};

export const formatDisplayCostAmount = (cost: DisplayCost) =>
  GAME_CURRENCY_RESOURCES.has(cost.resource)
    ? formatResourceAmount(cost.amount)
    : formatNumber(cost.amount);

export const formatClock = (hz: number) => {
  if (hz >= 1_000_000_000) return `${formatNumber(hz / 1_000_000_000)} GHz`;
  if (hz >= 1_000_000) return `${formatNumber(hz / 1_000_000)} MHz`;
  if (hz >= 1_000) return `${formatNumber(hz / 1_000)} kHz`;
  return `${formatNumber(hz)} Hz`;
};

export const formatBytes = (bytes: number) => {
  if (bytes >= 1024 * 1024) return `${formatNumber(bytes / 1024 / 1024)} MB`;
  if (bytes >= 1024) return `${formatNumber(bytes / 1024)} KB`;
  return `${formatNumber(bytes)} B`;
};

export const formatBits = (bits: number) => {
  if (bits >= 1_000_000_000) return `${formatNumber(bits / 1_000_000_000)} Gb`;
  if (bits >= 1_000_000) return `${formatNumber(bits / 1_000_000)} Mb`;
  if (bits >= 1_000) return `${formatNumber(bits / 1_000)} Kb`;
  return `${formatNumber(bits)} b`;
};

export const formatBitRate = (bitsPerSecond: number) =>
  `${formatBits(bitsPerSecond)}/s`;

const formatUnitNumber = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value);

export const formatWatts = (watts: number) => {
  const absWatts = Math.abs(watts);
  const sign = watts < 0 ? "-" : "";

  if (absWatts === 0) return "0 W";
  if (absWatts < 0.000001)
    return `${sign}${formatUnitNumber(absWatts * 1_000_000_000)} nW`;
  if (absWatts < 0.001) return `${sign}${formatUnitNumber(absWatts * 1_000_000)} uW`;
  if (absWatts < 1) return `${sign}${formatUnitNumber(absWatts * 1_000)} mW`;
  if (absWatts >= 1_000_000) return `${sign}${formatNumber(absWatts / 1_000_000)} MW`;
  if (absWatts >= 1_000) return `${sign}${formatNumber(absWatts / 1_000)} kW`;
  return `${sign}${formatNumber(absWatts)} W`;
};

export const formatCost = (costs: DisplayCost[]) =>
  costs
    .map((cost) => `${formatDisplayCostAmount(cost)} ${cost.resource}`)
    .join(" + ");

export const formatResources = (resources: ResourceBag) => [
  { label: "Credits", value: formatResourceAmount(resources.credits) },
  { label: "Data", value: formatResourceAmount(resources.data) },
];
