import {
  ZERO_AMOUNT,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountDivide,
  amountMultiply,
  type Amount,
  type AmountInput,
} from "./amount";

export type HardwareWorkResourceId =
  | "cache"
  | "ram"
  | "compute"
  | "storageRead"
  | "storageWrite"
  | "networkIngress"
  | "networkEgress";

export interface HardwareWorkStage {
  id: string;
  resource: HardwareWorkResourceId;
  /** Bits for transfer stages; cycles for compute stages. */
  work: Amount;
}

export interface HardwareWorkRecipe {
  /** Ordered stages. Their durations add because the payload traverses them. */
  stages: HardwareWorkStage[];
}

export type HardwareWorkRates = Record<HardwareWorkResourceId, Amount>;

export const createHardwareWorkStage = (
  id: string,
  resource: HardwareWorkResourceId,
  work: AmountInput,
): HardwareWorkStage => ({ id, resource, work: amountClampMin(work) });

export const createHardwareWorkRecipe = (
  stages: readonly HardwareWorkStage[],
): HardwareWorkRecipe => ({
  stages: stages.map((stage) => createHardwareWorkStage(
    stage.id,
    stage.resource,
    stage.work,
  )),
});

/**
 * Per-lane authored work totals in first-appearance order — the compact
 * "what will this consume" summary cards render as a mix bar.
 */
export const summarizeHardwareWorkMix = (
  recipe: HardwareWorkRecipe,
): Array<{ resource: HardwareWorkResourceId; work: Amount }> => {
  const order: HardwareWorkResourceId[] = [];
  const totals = new Map<HardwareWorkResourceId, Amount>();
  for (const stage of recipe.stages) {
    if (!totals.has(stage.resource)) order.push(stage.resource);
    totals.set(
      stage.resource,
      amountAdd(totals.get(stage.resource) ?? ZERO_AMOUNT, stage.work),
    );
  }
  return order.map((resource) => ({
    resource,
    work: totals.get(resource) ?? ZERO_AMOUNT,
  }));
};

export const createHardwareWorkRates = (
  input: Partial<Record<HardwareWorkResourceId, AmountInput>> = {},
): HardwareWorkRates => ({
  cache: amountClampMin(input.cache ?? 0),
  ram: amountClampMin(input.ram ?? 0),
  compute: amountClampMin(input.compute ?? 0),
  storageRead: amountClampMin(input.storageRead ?? 0),
  storageWrite: amountClampMin(input.storageWrite ?? 0),
  networkIngress: amountClampMin(input.networkIngress ?? 0),
  networkEgress: amountClampMin(input.networkEgress ?? 0),
});

/** Paid logical work: exact transferred bits plus executed CPU cycles. */
export const getHardwareWorkTotal = (
  recipe: HardwareWorkRecipe,
): Amount => recipe.stages.reduce(
  (total, stage) => amountAdd(total, amountClampMin(stage.work)),
  ZERO_AMOUNT,
);

/**
 * Exact sequential path duration. A stage with work but no physical rate is
 * blocked (`null`); zero-work stages cost no time. In particular, one cache bit
 * at one hertz is exactly 1,000 ms.
 */
export const getHardwareWorkDurationMs = (
  recipe: HardwareWorkRecipe,
  rates: HardwareWorkRates,
): Amount | null => {
  let seconds = ZERO_AMOUNT;
  for (const stage of recipe.stages) {
    const work = amountClampMin(stage.work);
    if (amountCompare(work, 0) <= 0) continue;
    const rate = amountClampMin(rates[stage.resource]);
    if (amountCompare(rate, 0) <= 0) return null;
    seconds = amountAdd(seconds, amountDivide(work, rate));
  }
  return amountMultiply(seconds, 1_000);
};

/** Completed recipe units for an elapsed interval at the current rates. */
export const getHardwareWorkCompletedUnits = (
  recipe: HardwareWorkRecipe,
  rates: HardwareWorkRates,
  elapsedMs: AmountInput,
): Amount => {
  const durationMs = getHardwareWorkDurationMs(recipe, rates);
  if (durationMs === null || amountCompare(durationMs, 0) <= 0) {
    return ZERO_AMOUNT;
  }
  return amountDivide(amountClampMin(elapsedMs), durationMs);
};
