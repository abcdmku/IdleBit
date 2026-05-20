export const clampMeter = (value: number | null) =>
  Math.min(1, Math.max(0, value ?? 0));

export const firstNumber = (...values: Array<number | null | undefined>) =>
  values.find((value): value is number => typeof value === "number");

export const firstPositiveNumber = (...values: Array<number | null | undefined>) =>
  values.find(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value > 0,
  );

export const firstBoolean = (...values: Array<boolean | null | undefined>) =>
  values.find((value): value is boolean => typeof value === "boolean");

export const bytesToBits = (bytes: number | null | undefined) =>
  typeof bytes === "number" ? bytes * 8 : undefined;

export const firstBits = (
  bitValues: Array<number | null | undefined>,
  byteValues: Array<number | null | undefined>,
) => firstNumber(...bitValues) ?? bytesToBits(firstNumber(...byteValues)) ?? 0;
