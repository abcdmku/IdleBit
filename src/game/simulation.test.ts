import { describe, expect, it } from "vitest";
import {
  applyAction,
  createInitialGameState,
  deriveVisibleState,
  tickGame,
} from "./index";
import type { GameState, JobId, UpgradeId } from "./types";

const finishActiveJobs = (state: GameState) => {
  let nextState = state;
  let guard = 0;

  while (nextState.activeJobs.length > 0 && guard < 2000) {
    nextState = tickGame(nextState, 500);
    guard += 1;
  }

  return nextState;
};

const runJob = (state: GameState, jobId: JobId) =>
  finishActiveJobs(applyAction(state, { type: "startJob", jobId }));

const buy = (state: GameState, upgradeId: UpgradeId) =>
  applyAction(state, { type: "buyUpgrade", upgradeId });

const fund = (state: GameState): GameState => ({
  ...state,
  resources: { credits: 10_000, data: 10_000 },
});

const earnEarlyResources = (state: GameState) => {
  let nextState = state;

  for (let index = 0; index < 12; index += 1) {
    nextState = runJob(nextState, index % 2 === 0 ? "bitFlip" : "byteCopy");
  }

  return nextState;
};

const unlockMultiCore = () => {
  let state = earnEarlyResources(createInitialGameState());

  state = buy(buy(buy(state, "clock"), "clock"), "clock");
  state = buy(buy(state, "cache"), "cache");
  state = runJob(state, "microBenchmark");
  state = runJob(state, "parallelismBenchmark");

  return state;
};

describe("IdleBit simulation", () => {
  it("starts as a primitive CPU with hidden system stats", () => {
    const state = createInitialGameState();
    const visible = deriveVisibleState(state);

    expect(state.hardware.clockHz).toBe(10);
    expect(state.hardware.cacheBytes).toBe(1);
    expect(state.hardware.cores).toBe(1);
    expect(visible.stage).toBe("primitiveCpu");
    expect(visible.flags.systemStats).toBe(false);
  });

  it("completes jobs and unlocks cache after early work", () => {
    let state = createInitialGameState();

    state = runJob(state, "bitFlip");
    state = runJob(state, "bitFlip");
    state = runJob(state, "bitFlip");

    expect(state.resources.credits).toBe(18);
    expect(state.flags.cache).toBe(true);
  });

  it("buys clock and cache upgrades with separate scaling", () => {
    let state = earnEarlyResources(createInitialGameState());
    const beforeClock = state.hardware.clockHz;
    const beforeCache = state.hardware.cacheBytes;

    state = buy(state, "clock");
    state = buy(state, "cache");

    expect(state.hardware.clockHz).toBeGreaterThan(beforeClock);
    expect(state.hardware.cacheBytes).toBeGreaterThan(beforeCache);
  });

  it("unlocks the vertical slice through scheduler and system stats", () => {
    let state = fund(unlockMultiCore());

    expect(state.flags.multiCore).toBe(true);

    state = buy(buy(buy(state, "core"), "core"), "core");

    expect(state.hardware.cores).toBe(4);
    expect(state.flags.scheduler).toBe(true);

    state = runJob(state, "multiCoreBenchmark");

    expect(state.flags.secondCpu).toBe(true);

    state = buy(state, "secondCpu");

    expect(state.flags.systemStats).toBe(true);
    expect(state.hardware.ramGb).toBe(16);
    expect(state.hardware.psuWatts).toBe(450);
  });

  it("pulls queued jobs onto multiple cores after queue unlock", () => {
    let state = fund(unlockMultiCore());

    state = buy(state, "core");
    state = buy(state, "basicQueue");
    state = applyAction(state, { type: "queueJob", jobId: "bitFlip" });
    state = applyAction(state, { type: "queueJob", jobId: "byteCopy" });
    state = tickGame(state, 16);

    expect(state.activeJobs).toHaveLength(2);
    expect(state.queue).toHaveLength(0);
  });

  it("round-trips visible state after buying auto-repeat", () => {
    let state = earnEarlyResources(createInitialGameState());

    state = buy(state, "autoRepeat");
    state = applyAction(state, { type: "setAutoRepeat", jobId: "byteCopy" });

    expect(state.autoRepeatJobId).toBe("byteCopy");
    expect(deriveVisibleState(state).milestone.length).toBeGreaterThan(0);
  });
});
