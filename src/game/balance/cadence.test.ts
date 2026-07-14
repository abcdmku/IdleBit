import { createRngState } from "../rng";
import { describe, expect, it } from "vitest";
import {
  cadenceExpectsBufferOverflow,
  generateSessionSchedule,
  planReturnDelay,
  sessionCadenceProfiles,
} from "./cadence";

describe("balance session cadence", () => {
  it("replays seeded Monte Carlo schedules exactly", () => {
    const options = {
      profile: sessionCadenceProfiles.regular,
      mode: "monte-carlo" as const,
      seed: 7123,
      startAtMs: 0,
      endAtMs: 30 * 24 * 60 * 60 * 1000,
      offlineCapacityAt: () => 48 * 60 * 60 * 1000,
    };
    const first = generateSessionSchedule(options);
    const replay = generateSessionSchedule(options);
    const otherSeed = generateSessionSchedule({ ...options, seed: 7124 });

    expect(replay).toEqual(first);
    expect(otherSeed).not.toEqual(first);
  });

  it("chases buffer capacity only for profiles with an explicit fill ratio", () => {
    const hourMs = 60 * 60 * 1000;
    for (const capacityHours of [2, 8]) {
      const planned = planReturnDelay({
        profile: sessionCadenceProfiles.fullIdle,
        mode: "deterministic",
        rng: createRngState(1),
        nextSessionIndex: 7,
        offlineCapacityMs: capacityHours * hourMs,
      });
      expect(planned.delayMs).toBe(Math.round(capacityHours * hourMs * 0.94));
      expect(planned.delayMs).toBeLessThan(capacityHours * hourMs);
    }
  });

  it("keeps daily players on their true cadence so small buffers overflow", () => {
    const hourMs = 60 * 60 * 1000;
    for (const profile of [
      sessionCadenceProfiles.regular,
      sessionCadenceProfiles.engaged,
    ]) {
      for (const capacityHours of [2, 8, 12]) {
        const planned = planReturnDelay({
          profile,
          mode: "deterministic",
          rng: createRngState(1),
          nextSessionIndex: 7,
          offlineCapacityMs: capacityHours * hourMs,
        });
        expect(planned.delayMs).toBe(profile.baseReturnDelayMs);
        expect(cadenceExpectsBufferOverflow(profile, capacityHours * hourMs)).toBe(
          true,
        );
      }
      expect(cadenceExpectsBufferOverflow(profile, 48 * hourMs)).toBe(false);
    }
    expect(
      cadenceExpectsBufferOverflow(sessionCadenceProfiles.fullIdle, 2 * hourMs),
    ).toBe(false);
  });

  it("does not erase Monte Carlo missed visits by clamping them to capacity", () => {
    const hourMs = 60 * 60 * 1000;
    const planned = planReturnDelay({
      profile: {
        ...sessionCadenceProfiles.regular,
        attendanceProbability: 0,
        returnJitterRatio: 0,
      },
      mode: "monte-carlo",
      rng: createRngState(17),
      nextSessionIndex: 1,
      offlineCapacityMs: 2 * hourMs,
    });

    expect(planned.delayMs).toBeGreaterThan(2 * hourMs);
  });

  it("marks deterministic weekly deep sessions for engaged play", () => {
    const schedule = generateSessionSchedule({
      profile: sessionCadenceProfiles.engaged,
      mode: "deterministic",
      seed: 9,
      startAtMs: 0,
      endAtMs: 15 * 24 * 60 * 60 * 1000,
      offlineCapacityAt: () => 48 * 60 * 60 * 1000,
    });
    expect(schedule.filter((session) => session.kind === "deep").length).toBeGreaterThanOrEqual(2);
  });
});
