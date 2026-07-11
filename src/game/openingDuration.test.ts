import { describe, expect, it } from "vitest";

import { createInitialGameState } from "./progression";
import { deriveVisibleState } from "./selectors";
import { applyAction, tickGame } from "./simulation";
import { amountToSafeNumber } from "./amount";
import { getTaskDefinition } from "./content/tasks";
import { estimateJobSeconds } from "./math";

describe("opening hardware work", () => {
  it("makes a two-operation fetch faster than a read-mutate-write Bit Flip", () => {
    const state = createInitialGameState();
    const visible = deriveVisibleState(state);
    const fetchBit = visible.tasks.find((task) => task.id === "fetchBit");
    const decodeBit = visible.tasks.find((task) => task.id === "decodeBit");

    expect(fetchBit?.projection?.durationMs).toBe(2_000);
    expect(decodeBit?.projection?.durationMs).toBeGreaterThan(2_000);
    expect(estimateJobSeconds(state, getTaskDefinition("bitFlip"))).toBe(3);
  });

  it("reports real Fetch Bit operations separately from cycles and transferred bits", () => {
    const visible = deriveVisibleState(createInitialGameState());
    const fetchBit = visible.tasks.find((task) => task.id === "fetchBit");

    expect(fetchBit?.operationCount).toBe(2);
    expect(fetchBit?.paidWorkUnits).toBe(2);
    expect(fetchBit?.rewardCredits).toBe(2);
    expect(fetchBit?.operations.map((operation) => operation.name)).toEqual([
      "Fetch Bit",
      "Latch Bit",
    ]);
  });

  it("bases job payout on paid CPU and bit-transfer work", () => {
    const fetchBit = getTaskDefinition("fetchBit");
    const bitFlip = getTaskDefinition("bitFlip");

    expect(fetchBit.operationCount).toBe(2);
    expect(bitFlip.operationCount).toBe(3);
    expect(fetchBit.paidWorkUnits).toBe(2);
    expect(bitFlip.paidWorkUnits).toBe(3);
    expect(fetchBit.rewardCreditsExact).toBe(fetchBit.paidWorkUnitsExact);
    expect(bitFlip.rewardCreditsExact).toBe(bitFlip.paidWorkUnitsExact);
    expect(bitFlip.rewardCredits).toBeGreaterThan(fetchBit.rewardCredits);
  });

  it("loads one cache bit in exactly one second at one hertz", () => {
    let state = applyAction(createInitialGameState(), {
      type: "startTask",
      taskId: "fetchBit",
    });
    const operation = state.activeTasks[0]?.coreOperations[0];
    expect(operation?.totalLoadCycles).toBe("1");
    expect(operation?.remainingLoadCycles).toBe("1");

    state = tickGame(state, 500);
    expect(
      amountToSafeNumber(
        state.activeTasks[0]?.coreOperations[0]?.remainingLoadCycles ?? 0,
      ),
    ).toBeCloseTo(0.5, 8);

    state = tickGame(state, 500);
    expect(state.activeTasks[0]?.coreOperations[0]?.operationName).toBe(
      "Latch Bit",
    );
    expect(state.activeTasks[0]?.coreOperations[0]?.totalLoadCycles).toBe("0");
    expect(state.completedTasks.fetchBit ?? 0).toBe(0);
  });
});
