import { describe, expect, it } from "vitest";
import {
  createCpuHardwareState,
  createInitialGameState,
  getCoreClockHz,
  getCpuClockHz,
  getCpuForCore,
  getCpuHardware,
  syncHardwarePackages,
} from "./progression";
import type { GameState } from "./types";

const withCpus = (cpus: GameState["hardware"]["cpus"]): GameState => {
  const initial = createInitialGameState();
  return syncHardwarePackages({
    ...initial,
    hardware: { ...initial.hardware, cpus },
  });
};

describe("cached CPU hardware lookup (F-PERF-1)", () => {
  it("resolves the owning package per core with find-equivalent semantics", () => {
    const state = withCpus([
      createCpuHardwareState(1, [1, 2], { tierId: "hz", level: 3 }),
      createCpuHardwareState(2, [3, 4], { tierId: "khz", level: 2 }),
    ]);

    expect(getCpuForCore(state, 1).id).toBe(1);
    expect(getCpuForCore(state, 2).id).toBe(1);
    expect(getCpuForCore(state, 3).id).toBe(2);
    expect(getCpuForCore(state, 4).id).toBe(2);
    // Unknown cores fall back to CPU 1, matching the previous ?? 1 path.
    expect(getCpuForCore(state, 999).id).toBe(1);
    // Unknown package ids fall back to the first package.
    expect(getCpuHardware(state, 999).id).toBe(1);
  });

  it("returns identity-stable normalized packages instead of rebuilding per call", () => {
    const state = withCpus([
      createCpuHardwareState(1, [1, 2], { tierId: "hz", level: 3 }),
      createCpuHardwareState(2, [3], { tierId: "khz", level: 2 }),
    ]);

    expect(getCpuForCore(state, 3)).toBe(getCpuForCore(state, 3));
    expect(getCpuHardware(state, 2)).toBe(getCpuForCore(state, 3));
    expect(getCpuHardware(state, 1)).toBe(getCpuForCore(state, 2));
  });

  it("recomputes the lookup when hardware changes", () => {
    const state = withCpus([
      createCpuHardwareState(1, [1, 2], { tierId: "hz", level: 3 }),
      createCpuHardwareState(2, [3], { tierId: "khz", level: 2 }),
    ]);
    const upgraded = syncHardwarePackages({
      ...state,
      hardware: {
        ...state.hardware,
        cpus: state.hardware.cpus.map((cpu) =>
          cpu.id === 2 ? { ...cpu, level: 5 } : cpu,
        ),
      },
    });

    expect(getCpuForCore(state, 3).level).toBe(2);
    expect(getCpuForCore(upgraded, 3).level).toBe(5);
    expect(getCoreClockHz(upgraded, 3)).toBe(getCpuClockHz("khz", 5));
    // The untouched state's cache entry is unaffected.
    expect(getCoreClockHz(state, 3)).toBe(getCpuClockHz("khz", 2));
  });

  it("derives core clocks from the owning package tier and level", () => {
    const state = withCpus([
      createCpuHardwareState(1, [1], { tierId: "hz", level: 4 }),
      createCpuHardwareState(2, [2], { tierId: "mhz", level: 3 }),
    ]);

    expect(getCoreClockHz(state, 1)).toBe(getCpuClockHz("hz", 4));
    expect(getCoreClockHz(state, 2)).toBe(getCpuClockHz("mhz", 3));
  });

  it("synthesizes a default package when no CPUs exist", () => {
    const initial = createInitialGameState();
    const state: GameState = {
      ...initial,
      hardware: { ...initial.hardware, cpus: [] },
    };

    expect(getCpuHardware(state).id).toBe(1);
    expect(getCpuForCore(state, 1).coreIds).toEqual([1]);
  });

  it("reuses the synced hardware block for repeated syncs of the same hardware", () => {
    const initial = createInitialGameState();
    const synced = syncHardwarePackages(initial);
    const syncedAgain = syncHardwarePackages(initial);

    expect(syncedAgain.hardware).toBe(synced.hardware);
    // A different hardware object misses the cache and recomputes.
    const changed = syncHardwarePackages({
      ...initial,
      hardware: { ...initial.hardware, psuLevel: 2 },
    });
    expect(changed.hardware).not.toBe(synced.hardware);
    expect(changed.hardware.psuLevel).toBe(2);
  });
});
