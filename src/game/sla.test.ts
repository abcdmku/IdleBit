import { describe, expect, it } from "vitest";
import { createRngState } from "./rng";
import {
  advanceFailover,
  createSlaWindowState,
  drawOptInIncident,
  evaluateSlaWindow,
  getHealthyReplicaFaultDomains,
  getIncidentZoneStatus,
  getNextFailoverEventMs,
  recordSlaInterval,
  requestFailover,
  type SlaPolicy,
} from "./sla";

const policy: SlaPolicy = {
  availabilityTargetBps: 9_900,
  minimumReplicaQuorum: 2,
  maximumP95LatencyMs: 200,
  deadlineMs: 10_000,
};

describe("time-integrated SLA mechanics", () => {
  it("integrates availability, distinct-domain quorum, deadline, and p95 latency", () => {
    let state = createSlaWindowState();
    state = recordSlaInterval(state, policy, {
      elapsedMs: 9_900,
      serviceOnline: true,
      healthyReplicaFaultDomains: ["rack-a", "rack-b", "rack-b"],
      latencyMs: 87,
      committed: true,
    });
    state = recordSlaInterval(state, policy, {
      elapsedMs: 100,
      serviceOnline: true,
      healthyReplicaFaultDomains: ["rack-a"],
      latencyMs: 20,
    });

    expect(evaluateSlaWindow(state, policy)).toEqual({
      availabilityBps: 9_900,
      p95LatencyMs: 100,
      distinctQuorumViolationMs: 100,
      serviceViolationMs: 0,
      deadlineMet: true,
      availabilityMet: true,
      latencyMet: true,
      success: true,
    });
  });

  it("is delta invariant across interval chunking", () => {
    const sample = {
      serviceOnline: true,
      healthyReplicaFaultDomains: ["zone-a", "zone-b"],
      latencyMs: 150,
    };
    const oneShot = recordSlaInterval(createSlaWindowState(), policy, {
      ...sample,
      elapsedMs: 1_000,
    });
    let chunked = createSlaWindowState();
    for (let index = 0; index < 10; index += 1) {
      chunked = recordSlaInterval(chunked, policy, {
        ...sample,
        elapsedMs: 100,
      });
    }
    expect(chunked).toEqual(oneShot);
  });

  it("repairs corrupt latency totals and never accepts a commit while unavailable", () => {
    const unavailableCommit = recordSlaInterval(createSlaWindowState(), policy, {
      elapsedMs: 100,
      serviceOnline: false,
      healthyReplicaFaultDomains: ["a", "b"],
      latencyMs: 10,
      committed: true,
    });
    expect(unavailableCommit.commitElapsedMs).toBeNull();
    expect(unavailableCommit.latencyBuckets.every((bucket) => bucket.durationMs === 0)).toBe(
      true,
    );
  });

  it("counts replicas only across distinct healthy failure domains", () => {
    const zones = [
      { id: "a1", faultDomainId: "a", status: "online" as const, capacityBps: 10_000 },
      { id: "a2", faultDomainId: "a", status: "online" as const, capacityBps: 10_000 },
      { id: "b", faultDomainId: "b", status: "paused" as const, capacityBps: 0 },
    ];
    expect(
      getHealthyReplicaFaultDomains(zones, [
        { id: "r1", zoneId: "a1", healthy: true },
        { id: "r2", zoneId: "a2", healthy: true },
        { id: "r3", zoneId: "b", healthy: true },
      ]),
    ).toEqual(["a"]);
  });

  it("applies an explicit failover delay and deterministic target selection", () => {
    const initial = {
      activeZoneId: "zone-a",
      pendingZoneId: null,
      completesAtMs: null,
      lastCompletedAtMs: null,
    };
    const pending = requestFailover({
      state: initial,
      nowMs: 1_000,
      delayMs: 500,
      zones: [
        { id: "zone-b", faultDomainId: "b", status: "online", capacityBps: 8_000 },
        { id: "zone-c", faultDomainId: "c", status: "online", capacityBps: 9_000 },
      ],
      replicas: [
        { id: "rb", zoneId: "zone-b", healthy: true },
        { id: "rc", zoneId: "zone-c", healthy: true },
      ],
    });
    expect(pending.pendingZoneId).toBe("zone-c");
    expect(getNextFailoverEventMs(pending, 1_200)).toBe(300);
    expect(advanceFailover(pending, 1_499)).toEqual(pending);
    expect(advanceFailover(pending, 1_500)).toEqual({
      activeZoneId: "zone-c",
      pendingZoneId: null,
      completesAtMs: null,
      lastCompletedAtMs: 1_500,
    });
  });

  it("draws opt-in incidents once from saved RNG and only derates capacity", () => {
    const rng = createRngState(44);
    const absent = drawOptInIncident({
      rng,
      optIn: false,
      nowMs: 10,
      windowMs: 10_000,
      zoneIds: ["b", "a"],
      incidentIndex: 1,
    });
    expect(absent).toEqual({ rng, incident: null });

    const first = drawOptInIncident({
      rng,
      optIn: true,
      nowMs: 10,
      windowMs: 10_000,
      zoneIds: ["b", "a"],
      incidentIndex: 1,
    });
    const replay = drawOptInIncident({
      rng,
      optIn: true,
      nowMs: 10,
      windowMs: 10_000,
      zoneIds: ["b", "a"],
      incidentIndex: 1,
    });
    expect(replay).toEqual(first);
    expect(first.incident).not.toBeNull();
    const active = getIncidentZoneStatus(
      first.incident!,
      first.incident!.startsAtMs,
    );
    expect(active.status).toBe("derated");
    expect(active.capacityBps).toBeGreaterThan(0);
    expect(active.capacityBps).toBeLessThan(10_000);
  });
});
