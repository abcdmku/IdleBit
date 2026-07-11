import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountMultiply,
  amountSubtract,
  type Amount,
} from "./amount";
import { exactRateResourceIds } from "./weightedFair";
import type {
  CapacityProfile,
  RateResourceId,
} from "./infrastructureTypes";

export type PlacementResourceId =
  | RateResourceId
  | "memoryBits"
  | "storageBits";

export type PlacementVector = Record<PlacementResourceId, Amount>;

export const placementResourceIds: readonly PlacementResourceId[] = [
  ...exactRateResourceIds,
  "memoryBits",
  "storageBits",
] as const;

type AmountValue = Amount | string | number;

const compareIds = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

export const createPlacementVector = (
  values: Partial<Record<PlacementResourceId, AmountValue>> = {},
): PlacementVector =>
  Object.fromEntries(
    placementResourceIds.map((resource) => [
      resource,
      amountClampMin(values[resource] ?? ZERO_AMOUNT),
    ]),
  ) as PlacementVector;

export const placementVectorFromCapacity = (
  profile: CapacityProfile,
): PlacementVector =>
  createPlacementVector({
    ...profile.rates,
    memoryBits: profile.memoryBits,
    storageBits: profile.storageBits,
  });

export const addPlacementVectors = (
  left: PlacementVector,
  right: PlacementVector,
): PlacementVector =>
  createPlacementVector(
    Object.fromEntries(
      placementResourceIds.map((resource) => [
        resource,
        amountAdd(left[resource], right[resource]),
      ]),
    ) as PlacementVector,
  );

export const subtractPlacementVectors = (
  left: PlacementVector,
  right: PlacementVector,
): PlacementVector =>
  createPlacementVector(
    Object.fromEntries(
      placementResourceIds.map((resource) => [
        resource,
        amountSubtract(left[resource], right[resource]),
      ]),
    ) as PlacementVector,
  );

export const scalePlacementVector = (
  vector: PlacementVector,
  multiplier: AmountValue,
): PlacementVector => {
  const scale = amount(multiplier);
  if (amountCompare(scale, 0) < 0) {
    throw new Error("Placement vector scale must be non-negative");
  }
  return createPlacementVector(
    Object.fromEntries(
      placementResourceIds.map((resource) => [
        resource,
        amountMultiply(vector[resource], scale),
      ]),
    ) as PlacementVector,
  );
};

export const placementVectorFits = (
  available: PlacementVector,
  demand: PlacementVector,
) =>
  placementResourceIds.every(
    (resource) => amountCompare(demand[resource], available[resource]) <= 0,
  );

export interface PlacementNode {
  id: string;
  capacity: PlacementVector;
}

export interface PlacementRequest {
  id: string;
  demand: PlacementVector;
}

export interface PlacementAssignment {
  requestId: string;
  nodeId: string;
}

export interface PlacementResult {
  assignments: PlacementAssignment[];
  unplacedRequestIds: string[];
  remainingByNode: Record<string, PlacementVector>;
}

interface ExactFraction {
  numerator: Amount;
  denominator: Amount;
  infinite: boolean;
  resource: PlacementResourceId;
}

const fraction = (
  numerator: Amount,
  denominator: Amount,
  resource: PlacementResourceId,
): ExactFraction => ({
  numerator,
  denominator,
  infinite:
    amountCompare(numerator, 0) > 0 && amountCompare(denominator, 0) === 0,
  resource,
});

/** Compares non-negative fractions without converting either side to Number. */
const compareFractions = (left: ExactFraction, right: ExactFraction) => {
  if (left.infinite || right.infinite) {
    if (left.infinite && right.infinite) return 0;
    return left.infinite ? 1 : -1;
  }
  return amountCompare(
    amountMultiply(left.numerator, right.denominator),
    amountMultiply(right.numerator, left.denominator),
  );
};

const dominantFraction = (
  demand: PlacementVector,
  totalCapacity: PlacementVector,
) => {
  let dominant = fraction(ZERO_AMOUNT, amount(1), placementResourceIds[0]);
  for (const resource of placementResourceIds) {
    const candidate = fraction(
      demand[resource],
      totalCapacity[resource],
      resource,
    );
    if (compareFractions(candidate, dominant) > 0) dominant = candidate;
  }
  return dominant;
};

const assertUniqueIds = (
  kind: string,
  values: readonly { id: string }[],
) => {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) throw new Error(`Duplicate ${kind} id: ${value.id}`);
    seen.add(value.id);
  }
};

const getResidualScore = (
  capacity: PlacementVector,
  residual: PlacementVector,
) =>
  placementResourceIds
    .map((resource) =>
      fraction(residual[resource], capacity[resource], resource),
    )
    .sort(
      (left, right) =>
        compareFractions(right, left) ||
        compareIds(left.resource, right.resource),
    );

const compareResidualScores = (
  left: readonly ExactFraction[],
  right: readonly ExactFraction[],
) => {
  for (let index = 0; index < left.length; index += 1) {
    const comparison = compareFractions(left[index], right[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
};

/**
 * Places the hardest requests first, then chooses the fitting node with the
 * lexicographically tightest normalized residual profile. IDs are the final
 * tie-breaker, so input ordering cannot change the result.
 */
export const placeBestFit = (
  nodes: readonly PlacementNode[],
  requests: readonly PlacementRequest[],
): PlacementResult => {
  assertUniqueIds("placement node", nodes);
  assertUniqueIds("placement request", requests);

  const normalizedNodes = nodes
    .map((node) => ({
      id: node.id,
      capacity: createPlacementVector(node.capacity),
    }))
    .sort((left, right) => compareIds(left.id, right.id));
  const totalCapacity = normalizedNodes.reduce(
    (total, node) => addPlacementVectors(total, node.capacity),
    createPlacementVector(),
  );
  const orderedRequests = requests
    .map((request) => ({
      id: request.id,
      demand: createPlacementVector(request.demand),
    }))
    .sort((left, right) => {
      const dominance = compareFractions(
        dominantFraction(right.demand, totalCapacity),
        dominantFraction(left.demand, totalCapacity),
      );
      return dominance || compareIds(left.id, right.id);
    });
  const remaining = new Map(
    normalizedNodes.map((node) => [node.id, node.capacity]),
  );
  const assignments: PlacementAssignment[] = [];
  const unplacedRequestIds: string[] = [];

  for (const request of orderedRequests) {
    const candidates = normalizedNodes
      .flatMap((node) => {
        const available = remaining.get(node.id)!;
        if (!placementVectorFits(available, request.demand)) return [];
        const residual = subtractPlacementVectors(available, request.demand);
        return [
          {
            nodeId: node.id,
            residual,
            score: getResidualScore(node.capacity, residual),
          },
        ];
      })
      .sort(
        (left, right) =>
          compareResidualScores(left.score, right.score) ||
          compareIds(left.nodeId, right.nodeId),
      );

    const selected = candidates[0];
    if (!selected) {
      unplacedRequestIds.push(request.id);
      continue;
    }
    remaining.set(selected.nodeId, selected.residual);
    assignments.push({ requestId: request.id, nodeId: selected.nodeId });
  }

  assignments.sort((left, right) => compareIds(left.requestId, right.requestId));
  unplacedRequestIds.sort(compareIds);
  return {
    assignments,
    unplacedRequestIds,
    remainingByNode: Object.fromEntries(
      normalizedNodes.map((node) => [node.id, remaining.get(node.id)!]),
    ),
  };
};
