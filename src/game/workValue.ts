import {
  amount,
  amountAdd,
  amountCompare,
  amountDivide,
  amountMultiply,
  type Amount,
  type AmountInput,
} from "./amount";

/** One paid bit/cycle work unit has one Credit of unmodified gross value. */
export const BASE_CREDITS_PER_PAID_WORK_UNIT = amount(1);
export const WORK_VALUE_BASIS_POINTS = amount(10_000);

export interface WorkValueMultiplier {
  /** Stable, user-auditable reason that this service differs from base value. */
  id: string;
  basisPoints: Amount;
}

const requireNonNegativeAmount = (
  value: AmountInput,
  label: string,
): Amount => {
  const normalized = amount(value);
  if (amountCompare(normalized, 0) < 0) {
    throw new RangeError(`${label} must be non-negative`);
  }
  return normalized;
};

export const createWorkValueMultiplier = (
  id: string,
  basisPoints: AmountInput,
): WorkValueMultiplier => {
  const normalizedId = id.trim();
  if (!normalizedId) throw new Error("Work-value multiplier requires an id");
  return {
    id: normalizedId,
    basisPoints: requireNonNegativeAmount(
      basisPoints,
      "Work-value multiplier basis points",
    ),
  };
};

/** Sums exact paid work across component lanes without Number projection. */
export const sumPaidWorkUnits = (
  values: readonly AmountInput[],
): Amount => values.reduce<Amount>(
  (total, value) =>
    amountAdd(total, requireNonNegativeAmount(value, "Paid work")),
  amount(0),
);

/**
 * Exact gross settlement: paid work × one Credit per unit × named service
 * multiplier. Hardware rate and elapsed time deliberately do not enter value.
 */
export const getWorkValueCredits = (
  paidWorkUnits: AmountInput,
  multiplier: WorkValueMultiplier,
): Amount => amountDivide(
  amountMultiply(
    amountMultiply(
      requireNonNegativeAmount(paidWorkUnits, "Paid work"),
      BASE_CREDITS_PER_PAID_WORK_UNIT,
    ),
    multiplier.basisPoints,
  ),
  WORK_VALUE_BASIS_POINTS,
);
