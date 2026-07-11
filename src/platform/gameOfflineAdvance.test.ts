import { describe, expect, it } from "vitest";

import { createInitialGameState, type AdvanceResult } from "../game";
import { createGameOfflineAdvanceRunner } from "./gameOfflineAdvance";
import {
  handleGameOfflineAdvanceWorkerMessage,
  type GameOfflineAdvanceFunction,
  type GameOfflineAdvanceRequest,
  type GameOfflineAdvanceWorkerResponse,
} from "./gameOfflineAdvanceHandler";
import {
  OFFLINE_ADVANCE_WORKER_CHANNEL,
  type OfflineAdvanceWorkerHandlers,
  type OfflineAdvanceWorkerPort,
} from "./offlineAdvance";

const request = (): GameOfflineAdvanceRequest => ({
  elapsedMs: 1_000,
  mode: "offline",
  state: createInitialGameState(),
});

class HandlerWorkerPort implements OfflineAdvanceWorkerPort {
  private handlers: OfflineAdvanceWorkerHandlers | null = null;
  terminated = false;

  postMessage(message: unknown) {
    handleGameOfflineAdvanceWorkerMessage(message, (response) => {
      this.handlers?.onMessage(response);
    });
  }

  subscribe(handlers: OfflineAdvanceWorkerHandlers) {
    this.handlers = handlers;
    return () => {
      this.handlers = null;
    };
  }

  terminate() {
    this.terminated = true;
  }
}

describe("game offline advance Worker adapter", () => {
  it("handles the typed protocol with the public game advance engine", () => {
    const responses: GameOfflineAdvanceWorkerResponse[] = [];
    const handled = handleGameOfflineAdvanceWorkerMessage(
      {
        channel: OFFLINE_ADVANCE_WORKER_CHANNEL,
        kind: "request",
        request: request(),
        requestId: 41,
      },
      (response) => responses.push(response),
    );

    expect(handled).toBe(true);
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      channel: OFFLINE_ADVANCE_WORKER_CHANNEL,
      kind: "success",
      requestId: 41,
      result: {
        report: {
          elapsedMs: 1_000,
          mode: "offline",
          simulatedMs: 0,
        },
      },
    });
  });

  it("serializes engine failures into the existing failure protocol", () => {
    const responses: GameOfflineAdvanceWorkerResponse[] = [];
    const failingAdvance: GameOfflineAdvanceFunction = () => {
      throw new RangeError("bad offline state");
    };

    handleGameOfflineAdvanceWorkerMessage(
      {
        channel: OFFLINE_ADVANCE_WORKER_CHANNEL,
        kind: "request",
        request: request(),
        requestId: 42,
      },
      (response) => responses.push(response),
      failingAdvance,
    );

    expect(responses[0]).toMatchObject({
      channel: OFFLINE_ADVANCE_WORKER_CHANNEL,
      error: {
        message: "bad offline state",
        name: "RangeError",
      },
      kind: "failure",
      requestId: 42,
    });
  });

  it("runs through an injected Worker port without a browser Worker", async () => {
    const worker = new HandlerWorkerPort();
    const runner = createGameOfflineAdvanceRunner({
      createWorker: () => worker,
    });

    const result: AdvanceResult = await runner.run(request());

    expect(result.report.mode).toBe("offline");
    expect(result.report.elapsedMs).toBe(1_000);
    expect(result.report.simulatedMs).toBe(0);
    expect(runner.mode).toBe("worker");

    runner.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("uses the pure synchronous path when Worker creation fails", async () => {
    const runner = createGameOfflineAdvanceRunner({
      createWorker: () => {
        throw new Error("Worker unavailable");
      },
    });

    const result = await runner.run(request());

    expect(result.report.mode).toBe("offline");
    expect(result.report.elapsedMs).toBe(1_000);
    expect(result.report.simulatedMs).toBe(0);
    expect(runner.mode).toBe("synchronous");
  });
});
