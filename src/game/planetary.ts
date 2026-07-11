import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountDivide,
  amountMin,
  amountMultiply,
  amountSubtract,
  type Amount,
} from "./amount";
import type { FinaleCharterId } from "./types";

export interface FinaleCharterModifiers {
  operatingCostBps: number;
  coolingCapacityBps: number;
  failoverDelayBps: number;
  openContractRewardBps: number;
  minimumOpenCapacityBps: number;
}

export const finaleCharterModifiers: Readonly<
  Record<FinaleCharterId, FinaleCharterModifiers>
> = {
  resilience: {
    operatingCostBps: 10_000,
    coolingCapacityBps: 10_000,
    failoverDelayBps: 7_000,
    openContractRewardBps: 10_000,
    minimumOpenCapacityBps: 0,
  },
  efficiency: {
    operatingCostBps: 8_000,
    coolingCapacityBps: 11_500,
    failoverDelayBps: 10_000,
    openContractRewardBps: 10_000,
    minimumOpenCapacityBps: 0,
  },
  openCompute: {
    operatingCostBps: 10_000,
    coolingCapacityBps: 10_000,
    failoverDelayBps: 10_000,
    openContractRewardBps: 12_500,
    minimumOpenCapacityBps: 2_000,
  },
};

export const getFinaleCharterModifiers = (
  charterId: FinaleCharterId | null,
): FinaleCharterModifiers =>
  charterId === null
    ? {
        operatingCostBps: 10_000,
        coolingCapacityBps: 10_000,
        failoverDelayBps: 10_000,
        openContractRewardBps: 10_000,
        minimumOpenCapacityBps: 0,
      }
    : finaleCharterModifiers[charterId];

export interface PlanetaryFinalePhaseDefinition {
  id: string;
  name: string;
  requiredRegionCount: number;
  contributionRequired: Amount;
}

export interface PlanetaryFinalePlan {
  id: string;
  phases: PlanetaryFinalePhaseDefinition[];
}

export interface PlanetaryFinaleRuntime {
  plan: PlanetaryFinalePlan;
  phaseIndex: number;
  phaseContribution: Amount;
  totalContribution: Amount;
  elapsedMs: number;
  completedPhaseIds: string[];
  complete: boolean;
}

export interface PlanetaryFinaleAdvanceResult {
  runtime: PlanetaryFinaleRuntime;
  contributed: Amount;
  completedPhaseIds: string[];
  blockedReason: string | null;
}

const boundedInteger = (
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(value)))
    : fallback;

const compareIds = (left: string, right: string) => left.localeCompare(right);

export const normalizePlanetaryFinalePlan = (
  input: PlanetaryFinalePlan,
): PlanetaryFinalePlan => {
  const ids = new Set<string>();
  const phases = input.phases.map((phase, index) => {
    const id = phase.id.trim() || `phase-${index + 1}`;
    if (ids.has(id)) throw new Error(`Duplicate planetary phase id: ${id}`);
    ids.add(id);
    return {
      id,
      name: phase.name.trim() || `Planetary phase ${index + 1}`,
      requiredRegionCount: boundedInteger(
        phase.requiredRegionCount,
        1,
        1_000,
        1,
      ),
      contributionRequired: amountClampMin(phase.contributionRequired),
    };
  });
  if (phases.length === 0) {
    throw new Error("Planetary finale requires at least one phase");
  }
  return { id: input.id.trim() || "planetary-finale", phases };
};

export const createPlanetaryFinaleRuntime = (
  input: PlanetaryFinalePlan,
): PlanetaryFinaleRuntime => ({
  plan: normalizePlanetaryFinalePlan(input),
  phaseIndex: 0,
  phaseContribution: ZERO_AMOUNT,
  totalContribution: ZERO_AMOUNT,
  elapsedMs: 0,
  completedPhaseIds: [],
  complete: false,
});

export const normalizePlanetaryFinaleRuntime = (
  input: PlanetaryFinaleRuntime,
): PlanetaryFinaleRuntime => {
  const plan = normalizePlanetaryFinalePlan(input.plan);
  const phaseIndex = boundedInteger(
    input.phaseIndex,
    0,
    plan.phases.length,
    0,
  );
  const completedPhaseIds = plan.phases
    .slice(0, phaseIndex)
    .map((phase) => phase.id);
  // Completion is derived from the persisted phase index; a stray boolean in
  // a damaged save must not skip the planetary campaign.
  if (phaseIndex >= plan.phases.length) {
    return {
      plan,
      phaseIndex: plan.phases.length,
      phaseContribution: ZERO_AMOUNT,
      totalContribution: amountClampMin(input.totalContribution),
      elapsedMs: boundedInteger(
        input.elapsedMs,
        0,
        Number.MAX_SAFE_INTEGER,
        0,
      ),
      completedPhaseIds: plan.phases.map((phase) => phase.id),
      complete: true,
    };
  }
  const current = plan.phases[phaseIndex]!;
  return {
    plan,
    phaseIndex,
    phaseContribution: amountMin(
      amountClampMin(input.phaseContribution),
      current.contributionRequired,
    ),
    totalContribution: amountClampMin(input.totalContribution),
    elapsedMs: boundedInteger(
      input.elapsedMs,
      0,
      Number.MAX_SAFE_INTEGER,
      0,
    ),
    completedPhaseIds,
    complete: false,
  };
};

export const getNextPlanetaryFinaleEventMs = (
  runtimeInput: PlanetaryFinaleRuntime,
  routedContributionPerSecond: Amount,
  connectedRegionIds: readonly string[],
): Amount | null => {
  const runtime = normalizePlanetaryFinaleRuntime(runtimeInput);
  if (runtime.complete) return null;
  const phase = runtime.plan.phases[runtime.phaseIndex]!;
  if (
    new Set(connectedRegionIds.filter(Boolean)).size < phase.requiredRegionCount ||
    amountCompare(routedContributionPerSecond, 0) <= 0
  ) {
    return null;
  }
  const remaining = amountSubtract(
    phase.contributionRequired,
    runtime.phaseContribution,
  );
  return amountMultiply(
    amountDivide(remaining, routedContributionPerSecond),
    1_000,
  );
};

/**
 * Advances routed contribution through milestone phases. No phase can progress
 * without its required count of distinct connected regions.
 */
export const advancePlanetaryFinale = (input: {
  runtime: PlanetaryFinaleRuntime;
  elapsedMs: number;
  routedContributionPerSecond: Amount;
  connectedRegionIds: readonly string[];
}): PlanetaryFinaleAdvanceResult => {
  let runtime = normalizePlanetaryFinaleRuntime(input.runtime);
  const elapsedMs = boundedInteger(
    input.elapsedMs,
    0,
    Number.MAX_SAFE_INTEGER - runtime.elapsedMs,
    0,
  );
  if (runtime.complete || elapsedMs === 0) {
    return {
      runtime,
      contributed: ZERO_AMOUNT,
      completedPhaseIds: [],
      blockedReason: null,
    };
  }
  const connectedRegionCount = new Set(
    input.connectedRegionIds.filter(Boolean),
  ).size;
  const rate = amountClampMin(input.routedContributionPerSecond);
  const initialPhase = runtime.plan.phases[runtime.phaseIndex]!;
  if (connectedRegionCount < initialPhase.requiredRegionCount) {
    return {
      runtime: { ...runtime, elapsedMs: runtime.elapsedMs + elapsedMs },
      contributed: ZERO_AMOUNT,
      completedPhaseIds: [],
      blockedReason: `Requires ${initialPhase.requiredRegionCount} connected regions.`,
    };
  }
  if (amountCompare(rate, 0) <= 0) {
    return {
      runtime: { ...runtime, elapsedMs: runtime.elapsedMs + elapsedMs },
      contributed: ZERO_AMOUNT,
      completedPhaseIds: [],
      blockedReason: "No routed planetary contribution capacity.",
    };
  }

  let budget = amountMultiply(rate, amount(elapsedMs / 1_000));
  let contributed = ZERO_AMOUNT;
  const completedPhaseIds: string[] = [];
  while (!runtime.complete && amountCompare(budget, 0) > 0) {
    const phase = runtime.plan.phases[runtime.phaseIndex]!;
    if (connectedRegionCount < phase.requiredRegionCount) break;
    const needed = amountSubtract(
      phase.contributionRequired,
      runtime.phaseContribution,
    );
    const applied = amountMin(needed, budget);
    runtime = {
      ...runtime,
      phaseContribution: amountAdd(runtime.phaseContribution, applied),
      totalContribution: amountAdd(runtime.totalContribution, applied),
    };
    contributed = amountAdd(contributed, applied);
    budget = amountSubtract(budget, applied);
    if (
      amountCompare(runtime.phaseContribution, phase.contributionRequired) < 0
    ) {
      break;
    }
    completedPhaseIds.push(phase.id);
    const nextIndex = runtime.phaseIndex + 1;
    runtime = {
      ...runtime,
      phaseIndex: nextIndex,
      phaseContribution: ZERO_AMOUNT,
      completedPhaseIds: runtime.plan.phases
        .slice(0, nextIndex)
        .map((item) => item.id),
      complete: nextIndex >= runtime.plan.phases.length,
    };
  }
  runtime = { ...runtime, elapsedMs: runtime.elapsedMs + elapsedMs };
  const nextPhase = runtime.plan.phases[runtime.phaseIndex];
  const blockedReason =
    !runtime.complete &&
    nextPhase &&
    connectedRegionCount < nextPhase.requiredRegionCount
      ? `Requires ${nextPhase.requiredRegionCount} connected regions.`
      : null;
  return { runtime, contributed, completedPhaseIds, blockedReason };
};

export const canonicalPlanetaryFinalePlan: PlanetaryFinalePlan = {
  id: "planetary-commons",
  phases: [
    {
      id: "regional-bootstrap",
      name: "Regional bootstrap",
      requiredRegionCount: 2,
      contributionRequired: amount("1000000000000"),
    },
    {
      id: "global-routing",
      name: "Global routing",
      requiredRegionCount: 3,
      contributionRequired: amount("1000000000000000"),
    },
    {
      id: "commons-commit",
      name: "Commons commit",
      requiredRegionCount: 4,
      contributionRequired: amount("1000000000000000000"),
    },
  ],
};

export const getConnectedRegionIds = (ids: readonly string[]) =>
  [...new Set(ids.filter(Boolean))].sort(compareIds);
