import { describe, expect, it } from "vitest";
import { amount } from "./amount";
import {
  getFlowWeightedP95Latency,
  hasConnectedRegionComponent,
  routeMinCostFlow,
  routeRegionalDemand,
} from "./routing";

const connectivityLink = (
  from: string,
  to: string,
  capacity: string | number = 1,
) => ({ from, to, capacity: amount(capacity) });

describe("regional routing connectivity", () => {
  it("does not find a component in an empty graph", () => {
    expect(hasConnectedRegionComponent([], [], 1)).toBe(false);
    expect(hasConnectedRegionComponent(["north", "south"], [], 2)).toBe(false);
  });

  it("ignores zero-capacity links", () => {
    expect(
      hasConnectedRegionComponent(
        ["north", "south"],
        [connectivityLink("north", "south", 0)],
        2,
      ),
    ).toBe(false);
  });

  it("treats positive-capacity links as an undirected chain", () => {
    expect(
      hasConnectedRegionComponent(
        ["north", "central", "south"],
        [
          connectivityLink("central", "north"),
          connectivityLink("central", "south"),
        ],
        3,
      ),
    ).toBe(true);
  });

  it("requires the eligible regions to share one component", () => {
    expect(
      hasConnectedRegionComponent(
        ["north", "central", "south", "island"],
        [
          connectivityLink("north", "central"),
          connectivityLink("south", "island"),
        ],
        3,
      ),
    ).toBe(false);
  });

  it("does not count extra regions, while allowing them to bridge eligible ones", () => {
    const links = [
      connectivityLink("north", "transit"),
      connectivityLink("transit", "south"),
      connectivityLink("transit", "off-map"),
    ];

    expect(hasConnectedRegionComponent(["north", "south"], links, 2)).toBe(true);
    expect(hasConnectedRegionComponent(["north", "south"], links, 3)).toBe(false);
  });
});

describe("planetary min-cost routing", () => {
  it("uses cheapest paths first and reports exact unmet demand", () => {
    const result = routeMinCostFlow({
      source: "a",
      sink: "d",
      requested: amount(12),
      edges: [
        { id: "ab", from: "a", to: "b", capacity: amount(5), costPerUnit: 1, latencyMs: 10 },
        { id: "bd", from: "b", to: "d", capacity: amount(5), costPerUnit: 1, latencyMs: 10 },
        { id: "ac", from: "a", to: "c", capacity: amount(4), costPerUnit: 3, latencyMs: 30 },
        { id: "cd", from: "c", to: "d", capacity: amount(4), costPerUnit: 3, latencyMs: 30 },
      ],
    });

    expect(result.delivered).toBe("9");
    expect(result.unmet).toBe("3");
    expect(result.totalCost).toBe("34");
    expect(result.edgeFlows.map(({ edgeId, flow }) => [edgeId, flow])).toEqual([
      ["ab", "5"],
      ["ac", "4"],
      ["bd", "5"],
      ["cd", "4"],
    ]);
    expect(result.p95LatencyMs).toBe(60);
  });

  it("keeps capacities and costs exact beyond Number range", () => {
    const result = routeMinCostFlow({
      source: "west",
      sink: "east",
      requested: amount("2e309"),
      edges: [
        {
          id: "backbone",
          from: "west",
          to: "east",
          capacity: amount("3e309"),
          costPerUnit: 7,
          latencyMs: 80,
        },
      ],
    });
    expect(result.delivered).toBe(amount("2e309"));
    expect(result.totalCost).toBe(amount("14e309"));
    expect(result.unmet).toBe("0");
  });

  it("uses stable edge IDs to resolve equal-cost routes", () => {
    const edges = [
      { id: "b1", from: "a", to: "b", capacity: amount(1), costPerUnit: 1, latencyMs: 1 },
      { id: "b2", from: "b", to: "z", capacity: amount(1), costPerUnit: 1, latencyMs: 1 },
      { id: "c1", from: "a", to: "c", capacity: amount(1), costPerUnit: 1, latencyMs: 1 },
      { id: "c2", from: "c", to: "z", capacity: amount(1), costPerUnit: 1, latencyMs: 1 },
    ];
    const result = routeMinCostFlow({
      source: "a",
      sink: "z",
      requested: amount(1),
      edges,
    });
    const reordered = routeMinCostFlow({
      source: "a",
      sink: "z",
      requested: amount(1),
      edges: [...edges].reverse(),
    });
    expect(result.paths).toEqual([
      { edgeIds: ["b1", "b2"], flow: "1", costPerUnit: 2, latencyMs: 2 },
    ]);
    expect(reordered).toEqual(result);
  });

  it("routes multiple supplies and demands through deterministic super nodes", () => {
    const result = routeRegionalDemand({
      supplies: [
        { regionId: "north", capacity: amount(7) },
        { regionId: "south", capacity: amount(5) },
      ],
      demands: [
        { regionId: "east", demand: amount(4) },
        { regionId: "west", demand: amount(6) },
      ],
      links: [
        { id: "n-e", from: "north", to: "east", capacity: amount(7), costPerUnit: 1, latencyMs: 20 },
        { id: "n-w", from: "north", to: "west", capacity: amount(7), costPerUnit: 4, latencyMs: 70 },
        { id: "s-w", from: "south", to: "west", capacity: amount(5), costPerUnit: 1, latencyMs: 25 },
      ],
    });
    expect(result.delivered).toBe("10");
    expect(result.fulfilledByRegion).toEqual({ east: "4", west: "6" });
    expect(result.suppliedByRegion).toEqual({ north: "5", south: "5" });
  });

  it("computes flow-weighted p95 without projecting exact flow to Number", () => {
    expect(
      getFlowWeightedP95Latency([
        { edgeIds: ["fast"], flow: amount("95e309"), costPerUnit: 1, latencyMs: 20 },
        { edgeIds: ["slow"], flow: amount("5e309"), costPerUnit: 2, latencyMs: 200 },
      ]),
    ).toBe(20);
  });

  it("rejects negative policy cost edges before constructing residual arcs", () => {
    expect(() =>
      routeMinCostFlow({
        source: "a",
        sink: "b",
        requested: amount(1),
        edges: [
          {
            id: "negative",
            from: "a",
            to: "b",
            capacity: amount(1),
            costPerUnit: -1,
            latencyMs: 1,
          },
        ],
      }),
    ).toThrow(/non-negative/);
  });
});
