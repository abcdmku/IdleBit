import { describe, expect, it } from "vitest";

import { advanceGame } from "./advance";
import { createRackReadyGameState } from "./devSeeds";
import { deriveVisibleState } from "./selectors";
import { deserializeSave, serializeSave } from "./save";
import { applyAction } from "./simulation";
import { materializeSystem } from "./systems";
import type { GameState } from "./types";

const withOfflineScheduler = (state: GameState): GameState => ({
  ...state,
  automationBuffer: {
    ...state.automationBuffer,
    ownedLevelId: "systemScheduler",
    departureLevelId: "systemScheduler",
    offlineProcessedMs: 0,
  },
});

describe("per-system idle power policies", () => {
  it("updates only the targeted system and projects the saved policy", () => {
    const initial = createRackReadyGameState();
    const updated = applyAction(initial, {
      type: "setIdlePowerPolicy",
      systemId: 2,
      policy: "shutdown-when-idle",
    });

    expect(materializeSystem(updated, 1).power.idlePolicy).toBe("low-power");
    expect(materializeSystem(updated, 2).power.idlePolicy).toBe(
      "shutdown-when-idle",
    );
    expect(
      deriveVisibleState(updated).systems.find((system) => system.id === 2),
    ).toMatchObject({ idlePowerPolicy: "shutdown-when-idle" });
  });

  it("round-trips policies and repairs malformed saved values", () => {
    const configured = applyAction(createRackReadyGameState(), {
      type: "setIdlePowerPolicy",
      systemId: 2,
      policy: "shutdown-when-idle",
    });
    const restored = deserializeSave(serializeSave(configured, 123));
    expect(materializeSystem(restored, 2).power.idlePolicy).toBe(
      "shutdown-when-idle",
    );

    const envelope = JSON.parse(serializeSave(configured, 123)) as {
      state: GameState;
    };
    envelope.state.systems[1]!.power.idlePolicy = "invalid" as never;
    envelope.state.power.idlePolicy = "invalid" as never;
    const repaired = deserializeSave(JSON.stringify(envelope));
    expect(materializeSystem(repaired, 2).power.idlePolicy).toBe("low-power");
  });

  it("finishes queued offline work before shutting the system down", () => {
    let state = withOfflineScheduler(createRackReadyGameState());
    state = applyAction(state, {
      type: "setIdlePowerPolicy",
      systemId: 1,
      policy: "shutdown-when-idle",
    });
    state = applyAction(state, {
      type: "queueTask",
      taskId: "fetchBit",
      systemId: 1,
    });
    expect(materializeSystem(state, 1).queue).toContain("fetchBit");

    const completedBefore = state.completedTasks.fetchBit ?? 0;
    const advanced = advanceGame(state, 30_000, "offline").state;
    const system = materializeSystem(advanced, 1);

    expect(advanced.completedTasks.fetchBit ?? 0).toBeGreaterThan(
      completedBefore,
    );
    expect(system.activeTasks).toHaveLength(0);
    expect(system.queue).toHaveLength(0);
    expect(system.power.state).toBe("off");
  });

  it("keeps an idle low-power system on while offline", () => {
    const state = withOfflineScheduler(createRackReadyGameState());
    const advanced = advanceGame(state, 30_000, "offline").state;

    expect(materializeSystem(advanced, 1).power).toMatchObject({
      idlePolicy: "low-power",
      state: "on",
    });
  });
});
