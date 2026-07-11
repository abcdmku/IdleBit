import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountMin,
  amountMultiply,
  amountSubtract,
  sumAmounts,
  type Amount,
} from "./amount";

export interface RoutingEdge {
  id: string;
  from: string;
  to: string;
  capacity: Amount;
  /** Stable integer score; it may combine price, carbon, and latency policy. */
  costPerUnit: number;
  latencyMs: number;
}

type ConnectivityLink = Pick<RoutingEdge, "from" | "to" | "capacity">;

/**
 * Whether one undirected positive-capacity link component contains enough of
 * the supplied eligible regions. Link endpoints outside the eligible set may
 * connect eligible regions, but do not count toward the required total.
 */
export const hasConnectedRegionComponent = (
  eligibleRegionIds: readonly string[],
  links: readonly ConnectivityLink[],
  requiredCount: number,
): boolean => {
  if (requiredCount <= 0) return true;

  const eligibleIds = new Set(eligibleRegionIds.filter(Boolean));
  if (eligibleIds.size < requiredCount) return false;

  const adjacency = new Map<string, Set<string>>();
  const connect = (from: string, to: string) => {
    const neighbors = adjacency.get(from) ?? new Set<string>();
    neighbors.add(to);
    adjacency.set(from, neighbors);
  };

  for (const link of links) {
    if (
      !link.from ||
      !link.to ||
      link.from === link.to ||
      amountCompare(link.capacity, 0) <= 0
    ) {
      continue;
    }
    connect(link.from, link.to);
    connect(link.to, link.from);
  }

  const visited = new Set<string>();
  for (const start of eligibleIds) {
    if (visited.has(start) || !adjacency.has(start)) continue;

    const pending = [start];
    visited.add(start);
    let eligibleCount = 0;
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (eligibleIds.has(current)) eligibleCount += 1;
      if (eligibleCount >= requiredCount) return true;

      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
  }

  return false;
};

export interface RoutedEdgeFlow {
  edgeId: string;
  from: string;
  to: string;
  flow: Amount;
  capacity: Amount;
  costPerUnit: number;
  latencyMs: number;
}

export interface RoutedPathFlow {
  edgeIds: string[];
  flow: Amount;
  costPerUnit: number;
  latencyMs: number;
}

export interface MinCostFlowResult {
  requested: Amount;
  delivered: Amount;
  unmet: Amount;
  totalCost: Amount;
  edgeFlows: RoutedEdgeFlow[];
  paths: RoutedPathFlow[];
  p95LatencyMs: number | null;
}

interface ResidualArc {
  from: string;
  to: string;
  capacity: Amount;
  cost: number;
  edgeIndex: number;
  direction: 1 | -1;
  ordinal: number;
  reverse: ResidualArc | null;
}

const normalizeInteger = (value: number, name: string) => {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
  if (value < 0) throw new Error(`${name} must be non-negative`);
  return value;
};

const normalizeLatency = (value: number) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Routing latency must be finite and non-negative");
  }
  return value;
};

const validateEdges = (edges: readonly RoutingEdge[]) => {
  const ids = new Set<string>();
  return edges.map((edge) => {
    if (!edge.id || ids.has(edge.id)) {
      throw new Error(`Routing edge IDs must be unique: ${edge.id}`);
    }
    if (!edge.from || !edge.to || edge.from === edge.to) {
      throw new Error(`Routing edge ${edge.id} must connect distinct nodes`);
    }
    ids.add(edge.id);
    return {
      ...edge,
      capacity: amountClampMin(edge.capacity),
      costPerUnit: normalizeInteger(edge.costPerUnit, "Routing cost"),
      latencyMs: normalizeLatency(edge.latencyMs),
    };
  });
};

const makeResidualNetwork = (edges: readonly RoutingEdge[]) => {
  const arcs: ResidualArc[] = [];
  edges.forEach((edge, edgeIndex) => {
    const forward: ResidualArc = {
      from: edge.from,
      to: edge.to,
      capacity: edge.capacity,
      cost: edge.costPerUnit,
      edgeIndex,
      direction: 1,
      ordinal: edgeIndex * 2,
      reverse: null,
    };
    const reverse: ResidualArc = {
      from: edge.to,
      to: edge.from,
      capacity: ZERO_AMOUNT,
      cost: -edge.costPerUnit,
      edgeIndex,
      direction: -1,
      ordinal: edgeIndex * 2 + 1,
      reverse: forward,
    };
    forward.reverse = reverse;
    arcs.push(forward, reverse);
  });
  return arcs;
};

const findCheapestResidualPath = (
  nodes: readonly string[],
  arcs: readonly ResidualArc[],
  source: string,
  sink: string,
) => {
  const distances = new Map(nodes.map((node) => [node, Number.POSITIVE_INFINITY]));
  const signatures = new Map<string, string>();
  const previous = new Map<string, ResidualArc>();
  distances.set(source, 0);
  signatures.set(source, "");
  const sortedArcs = [...arcs].sort(
    (left, right) =>
      left.from.localeCompare(right.from) ||
      left.to.localeCompare(right.to) ||
      left.ordinal - right.ordinal,
  );

  for (let pass = 0; pass < nodes.length - 1; pass += 1) {
    let changed = false;
    for (const arc of sortedArcs) {
      if (amountCompare(arc.capacity, 0) <= 0) continue;
      const fromDistance = distances.get(arc.from) ?? Number.POSITIVE_INFINITY;
      if (!Number.isFinite(fromDistance)) continue;
      const candidate = fromDistance + arc.cost;
      const candidateSignature = `${signatures.get(arc.from) ?? ""}|${String(
        arc.ordinal,
      ).padStart(8, "0")}`;
      const current = distances.get(arc.to) ?? Number.POSITIVE_INFINITY;
      const currentSignature = signatures.get(arc.to) ?? "\uffff";
      if (
        candidate < current ||
        (candidate === current && candidateSignature < currentSignature)
      ) {
        distances.set(arc.to, candidate);
        signatures.set(arc.to, candidateSignature);
        previous.set(arc.to, arc);
        changed = true;
      }
    }
    if (!changed) break;
  }
  if (!previous.has(sink)) return null;

  const path: ResidualArc[] = [];
  const seen = new Set<string>();
  let node = sink;
  while (node !== source) {
    if (seen.has(node)) throw new Error("Residual predecessor cycle detected");
    seen.add(node);
    const arc = previous.get(node);
    if (!arc) return null;
    path.push(arc);
    node = arc.from;
  }
  return path.reverse();
};

const decomposePathFlows = (
  edges: readonly RoutingEdge[],
  flows: readonly Amount[],
  source: string,
  sink: string,
): RoutedPathFlow[] => {
  const remaining = flows.map((flow) => amountClampMin(flow));
  const outgoing = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const list = outgoing.get(edge.from) ?? [];
    list.push(index);
    outgoing.set(edge.from, list);
  });
  for (const list of outgoing.values()) {
    list.sort((left, right) => edges[left]!.id.localeCompare(edges[right]!.id));
  }
  const result: RoutedPathFlow[] = [];

  const findPath = (
    node: string,
    visited: Set<string>,
    path: number[],
  ): number[] | null => {
    if (node === sink) return path;
    if (visited.has(node)) return null;
    const nextVisited = new Set(visited).add(node);
    for (const edgeIndex of outgoing.get(node) ?? []) {
      if (amountCompare(remaining[edgeIndex] ?? ZERO_AMOUNT, 0) <= 0) continue;
      const found = findPath(
        edges[edgeIndex]!.to,
        nextVisited,
        [...path, edgeIndex],
      );
      if (found) return found;
    }
    return null;
  };

  while (true) {
    const path = findPath(source, new Set(), []);
    if (!path || path.length === 0) break;
    const flow = path.reduce(
      (minimum, edgeIndex) => amountMin(minimum, remaining[edgeIndex]!),
      remaining[path[0]!]!,
    );
    for (const edgeIndex of path) {
      remaining[edgeIndex] = amountSubtract(remaining[edgeIndex]!, flow);
    }
    result.push({
      edgeIds: path.map((edgeIndex) => edges[edgeIndex]!.id),
      flow,
      costPerUnit: path.reduce(
        (total, edgeIndex) => total + edges[edgeIndex]!.costPerUnit,
        0,
      ),
      latencyMs: path.reduce(
        (total, edgeIndex) => total + edges[edgeIndex]!.latencyMs,
        0,
      ),
    });
  }
  return result;
};

export const getFlowWeightedP95Latency = (
  paths: readonly RoutedPathFlow[],
): number | null => {
  const positive = paths.filter((path) => amountCompare(path.flow, 0) > 0);
  if (positive.length === 0) return null;
  const total = sumAmounts(positive.map((path) => path.flow));
  const threshold = amountMultiply(total, "0.95");
  let cumulative = ZERO_AMOUNT;
  for (const path of [...positive].sort(
    (left, right) =>
      left.latencyMs - right.latencyMs ||
      left.edgeIds.join("/").localeCompare(right.edgeIds.join("/")),
  )) {
    cumulative = amountAdd(cumulative, path.flow);
    if (amountCompare(cumulative, threshold) >= 0) return path.latencyMs;
  }
  return positive[positive.length - 1]!.latencyMs;
};

/** Deterministic successive-shortest-augmenting-path min-cost max-flow. */
export const routeMinCostFlow = (input: {
  source: string;
  sink: string;
  requested: Amount;
  edges: readonly RoutingEdge[];
}): MinCostFlowResult => {
  if (!input.source || !input.sink || input.source === input.sink) {
    throw new Error("Routing requires distinct source and sink nodes");
  }
  const edges = validateEdges(input.edges).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const requested = amountClampMin(input.requested);
  const nodes = [...new Set([
    input.source,
    input.sink,
    ...edges.flatMap((edge) => [edge.from, edge.to]),
  ])].sort();
  const arcs = makeResidualNetwork(edges);
  const flows = edges.map(() => ZERO_AMOUNT);
  let delivered = ZERO_AMOUNT;
  let totalCost = ZERO_AMOUNT;
  const maximumAugmentations = Math.max(1, edges.length * nodes.length * 8);

  for (let iteration = 0; amountCompare(delivered, requested) < 0; iteration += 1) {
    if (iteration >= maximumAugmentations) {
      throw new Error("Routing augmentation limit exceeded");
    }
    const path = findCheapestResidualPath(nodes, arcs, input.source, input.sink);
    if (!path) break;
    let augmentation = amountSubtract(requested, delivered);
    for (const arc of path) augmentation = amountMin(augmentation, arc.capacity);
    if (amountCompare(augmentation, 0) <= 0) break;
    for (const arc of path) {
      arc.capacity = amountSubtract(arc.capacity, augmentation);
      arc.reverse!.capacity = amountAdd(arc.reverse!.capacity, augmentation);
      flows[arc.edgeIndex] =
        arc.direction === 1
          ? amountAdd(flows[arc.edgeIndex]!, augmentation)
          : amountSubtract(flows[arc.edgeIndex]!, augmentation);
      totalCost = amountAdd(
        totalCost,
        amountMultiply(augmentation, arc.cost),
      );
    }
    delivered = amountAdd(delivered, augmentation);
  }

  const paths = decomposePathFlows(edges, flows, input.source, input.sink);
  return {
    requested,
    delivered,
    unmet: amountSubtract(requested, delivered),
    totalCost: amount(totalCost),
    edgeFlows: edges.map((edge, index) => ({
      edgeId: edge.id,
      from: edge.from,
      to: edge.to,
      flow: amountClampMin(flows[index] ?? ZERO_AMOUNT),
      capacity: edge.capacity,
      costPerUnit: edge.costPerUnit,
      latencyMs: edge.latencyMs,
    })),
    paths,
    p95LatencyMs: getFlowWeightedP95Latency(paths),
  };
};

export interface RegionalSupply {
  regionId: string;
  capacity: Amount;
}

export interface RegionalDemand {
  regionId: string;
  demand: Amount;
}

export interface RegionalRoutingResult extends MinCostFlowResult {
  suppliedByRegion: Record<string, Amount>;
  fulfilledByRegion: Record<string, Amount>;
}

/** Adds deterministic super-source/sink arcs for multi-region placement. */
export const routeRegionalDemand = (input: {
  supplies: readonly RegionalSupply[];
  demands: readonly RegionalDemand[];
  links: readonly RoutingEdge[];
}): RegionalRoutingResult => {
  const source = "__planetary_source__";
  const sink = "__planetary_sink__";
  const supplies = [...input.supplies].sort((a, b) =>
    a.regionId.localeCompare(b.regionId),
  );
  const demands = [...input.demands].sort((a, b) =>
    a.regionId.localeCompare(b.regionId),
  );
  const sourceEdges: RoutingEdge[] = supplies.map((supply) => ({
    id: `supply:${supply.regionId}`,
    from: source,
    to: supply.regionId,
    capacity: amountClampMin(supply.capacity),
    costPerUnit: 0,
    latencyMs: 0,
  }));
  const sinkEdges: RoutingEdge[] = demands.map((demand) => ({
    id: `demand:${demand.regionId}`,
    from: demand.regionId,
    to: sink,
    capacity: amountClampMin(demand.demand),
    costPerUnit: 0,
    latencyMs: 0,
  }));
  const result = routeMinCostFlow({
    source,
    sink,
    requested: sumAmounts(demands.map((demand) => demand.demand)),
    edges: [...sourceEdges, ...input.links, ...sinkEdges],
  });
  const flows = new Map(result.edgeFlows.map((flow) => [flow.edgeId, flow.flow]));
  return {
    ...result,
    edgeFlows: result.edgeFlows.filter(
      (flow) => !flow.edgeId.startsWith("supply:") && !flow.edgeId.startsWith("demand:"),
    ),
    paths: result.paths.map((path) => ({
      ...path,
      edgeIds: path.edgeIds.filter(
        (edgeId) => !edgeId.startsWith("supply:") && !edgeId.startsWith("demand:"),
      ),
    })),
    suppliedByRegion: Object.fromEntries(
      supplies.map((supply) => [
        supply.regionId,
        flows.get(`supply:${supply.regionId}`) ?? ZERO_AMOUNT,
      ]),
    ),
    fulfilledByRegion: Object.fromEntries(
      demands.map((demand) => [
        demand.regionId,
        flows.get(`demand:${demand.regionId}`) ?? ZERO_AMOUNT,
      ]),
    ),
  };
};
