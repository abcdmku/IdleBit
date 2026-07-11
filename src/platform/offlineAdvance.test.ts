import { describe, expect, it, vi } from "vitest";

import {
  createOfflineAdvanceRunner,
  OFFLINE_ADVANCE_WORKER_CHANNEL,
  type OfflineAdvanceWorkerHandlers,
  type OfflineAdvanceWorkerPort,
  type OfflineAdvanceWorkerRequest,
} from "./offlineAdvance";

interface TestRequest {
  elapsedMs: number;
  state: number;
}

interface TestResult {
  state: number;
}

class FakeWorkerPort implements OfflineAdvanceWorkerPort {
  handlers: OfflineAdvanceWorkerHandlers | null = null;
  messages: unknown[] = [];
  terminated = false;

  emitError(error: unknown) {
    this.handlers?.onError(error);
  }

  emitMessage(message: unknown) {
    this.handlers?.onMessage(message);
  }

  postMessage(message: unknown) {
    this.messages.push(message);
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

describe("offline advance runner", () => {
  it("uses the injected synchronous implementation without a Worker", async () => {
    const advanceSynchronously = vi.fn(
      ({ elapsedMs, state }: TestRequest): TestResult => ({
        state: state + elapsedMs,
      }),
    );
    const runner = createOfflineAdvanceRunner({ advanceSynchronously });

    await expect(runner.run({ elapsedMs: 5, state: 10 })).resolves.toEqual({
      state: 15,
    });
    expect(runner.mode).toBe("synchronous");
    expect(advanceSynchronously).toHaveBeenCalledOnce();
  });

  it("routes typed requests and responses through a Worker port", async () => {
    const worker = new FakeWorkerPort();
    const advanceSynchronously = vi.fn<(request: TestRequest) => TestResult>();
    const runner = createOfflineAdvanceRunner({
      advanceSynchronously,
      createWorker: () => worker,
    });

    const result = runner.run({ elapsedMs: 20, state: 3 });
    const message = worker.messages[0] as OfflineAdvanceWorkerRequest<TestRequest>;

    expect(message).toEqual({
      channel: OFFLINE_ADVANCE_WORKER_CHANNEL,
      kind: "request",
      request: { elapsedMs: 20, state: 3 },
      requestId: 1,
    });

    worker.emitMessage({
      channel: OFFLINE_ADVANCE_WORKER_CHANNEL,
      kind: "success",
      requestId: message.requestId,
      result: { state: 23 },
    });

    await expect(result).resolves.toEqual({ state: 23 });
    expect(runner.mode).toBe("worker");
    expect(advanceSynchronously).not.toHaveBeenCalled();
  });

  it("falls back synchronously when Worker creation or transport fails", async () => {
    const createFailureFallback = vi.fn(
      ({ state }: TestRequest): TestResult => ({ state: state + 1 }),
    );
    const createFailureRunner = createOfflineAdvanceRunner({
      advanceSynchronously: createFailureFallback,
      createWorker: () => {
        throw new Error("worker unavailable");
      },
    });

    await expect(
      createFailureRunner.run({ elapsedMs: 10, state: 4 }),
    ).resolves.toEqual({ state: 5 });
    expect(createFailureRunner.mode).toBe("synchronous");

    const worker = new FakeWorkerPort();
    const transportFallback = vi.fn(
      ({ elapsedMs, state }: TestRequest): TestResult => ({
        state: state + elapsedMs,
      }),
    );
    const transportFailureRunner = createOfflineAdvanceRunner({
      advanceSynchronously: transportFallback,
      createWorker: () => worker,
    });
    const result = transportFailureRunner.run({ elapsedMs: 6, state: 2 });

    worker.emitError(new Error("worker crashed"));

    await expect(result).resolves.toEqual({ state: 8 });
    expect(transportFailureRunner.mode).toBe("synchronous");
    expect(worker.terminated).toBe(true);
    expect(transportFallback).toHaveBeenCalledOnce();
  });

  it("falls back when a matching Worker reply violates the protocol", async () => {
    const worker = new FakeWorkerPort();
    const advanceSynchronously = vi.fn(
      ({ elapsedMs, state }: TestRequest): TestResult => ({
        state: state + elapsedMs,
      }),
    );
    const runner = createOfflineAdvanceRunner({
      advanceSynchronously,
      createWorker: () => worker,
    });
    const result = runner.run({ elapsedMs: 7, state: 4 });
    const request = worker.messages[0] as OfflineAdvanceWorkerRequest<TestRequest>;

    worker.emitMessage({
      channel: OFFLINE_ADVANCE_WORKER_CHANNEL,
      kind: "success",
      requestId: request.requestId,
    });

    await expect(result).resolves.toEqual({ state: 11 });
    expect(advanceSynchronously).toHaveBeenCalledOnce();
    expect(runner.mode).toBe("synchronous");
    expect(worker.terminated).toBe(true);
  });

  it("ignores malformed replies that do not target a pending request", async () => {
    const worker = new FakeWorkerPort();
    const advanceSynchronously = vi.fn<(request: TestRequest) => TestResult>();
    const runner = createOfflineAdvanceRunner({
      advanceSynchronously,
      createWorker: () => worker,
    });
    const result = runner.run({ elapsedMs: 9, state: 5 });
    const request = worker.messages[0] as OfflineAdvanceWorkerRequest<TestRequest>;

    worker.emitMessage({
      channel: OFFLINE_ADVANCE_WORKER_CHANNEL,
      kind: "success",
      requestId: request.requestId + 1,
    });
    worker.emitMessage({
      channel: "another-channel",
      kind: "success",
      requestId: request.requestId,
    });
    worker.emitMessage({
      channel: OFFLINE_ADVANCE_WORKER_CHANNEL,
      kind: "success",
      requestId: request.requestId,
      result: { state: 14 },
    });

    await expect(result).resolves.toEqual({ state: 14 });
    expect(advanceSynchronously).not.toHaveBeenCalled();
    expect(runner.mode).toBe("worker");
    expect(worker.terminated).toBe(false);
  });

  it("preserves Worker failures and rejects pending work on disposal", async () => {
    const worker = new FakeWorkerPort();
    const runner = createOfflineAdvanceRunner<TestRequest, TestResult>({
      advanceSynchronously: ({ state }) => ({ state }),
      createWorker: () => worker,
    });
    const failedResult = runner.run({ elapsedMs: 1, state: 1 });
    const failedRequest =
      worker.messages[0] as OfflineAdvanceWorkerRequest<TestRequest>;

    worker.emitMessage({
      channel: OFFLINE_ADVANCE_WORKER_CHANNEL,
      error: { message: "invalid state", name: "RangeError" },
      kind: "failure",
      requestId: failedRequest.requestId,
    });

    await expect(failedResult).rejects.toMatchObject({
      message: "invalid state",
      name: "RangeError",
    });

    const pendingResult = runner.run({ elapsedMs: 2, state: 2 });
    runner.dispose();

    await expect(pendingResult).rejects.toThrow(
      "Offline advance runner has been disposed.",
    );
    await expect(runner.run({ elapsedMs: 3, state: 3 })).rejects.toThrow(
      "Offline advance runner has been disposed.",
    );
  });
});
