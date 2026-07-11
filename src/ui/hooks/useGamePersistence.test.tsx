import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  advanceGame,
  createInitialGameState,
  deserializeSave,
  exactResourceBag,
  recordDeparture,
  serializeSave,
  type GameState,
} from "../../game";
import {
  idleBitPersistence,
  idleBitLifecycle,
  type GameOfflineAdvanceRunner,
} from "../../platform";
import {
  FOREGROUND_ADVANCE_INTERVAL_MS,
  useGamePersistence,
  type UseGamePersistenceOptions,
} from "./useGamePersistence";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

type PersistenceHook = ReturnType<typeof useGamePersistence>;

function Harness({ options }: { options: UseGamePersistenceOptions }) {
  latestHook = useGamePersistence(options);
  return (
    <output
      data-ready={String(latestHook.ready)}
      data-phase={latestHook.persistenceStatus.phase}
      data-message={latestHook.persistenceStatus.message}
      data-report={latestHook.state.lastAdvanceReport?.mode ?? "none"}
    />
  );
}

let latestHook: PersistenceHook;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const makeRunner = (
  run: GameOfflineAdvanceRunner["run"],
): GameOfflineAdvanceRunner => ({
  mode: "synchronous",
  run,
  dispose: vi.fn(),
});

describe("useGamePersistence", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cancelRafSpy: ReturnType<typeof vi.spyOn>;
  let originalVisibilityDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    await idleBitPersistence.clear();
    originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 1);
    cancelRafSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    rafSpy.mockRestore();
    cancelRafSpy.mockRestore();
    if (originalVisibilityDescriptor) {
      Object.defineProperty(
        document,
        "visibilityState",
        originalVisibilityDescriptor,
      );
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
    await idleBitPersistence.clear();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it("hydrates a departure through the offline runner", async () => {
    const departed = recordDeparture(createInitialGameState(), 1_000);
    await idleBitPersistence.set("save-v7", serializeSave(departed, 1_000));
    const run = vi.fn<GameOfflineAdvanceRunner["run"]>((request) =>
      Promise.resolve(advanceGame(request.state, request.elapsedMs, "offline")),
    );
    const runner = makeRunner(run);

    act(() => {
      root.render(
        <Harness
          options={{
            seedRackReady: false,
            createOfflineRunner: () => runner,
            now: () => 10_000,
            saveIntervalMs: 1_000_000,
          }}
        />,
      );
    });
    await flushEffects();

    expect(run).toHaveBeenCalledWith({
      state: expect.objectContaining({
        time: expect.objectContaining({ departedAtMs: 1_000 }),
      }),
      elapsedMs: 9_000,
      mode: "offline",
    });
    expect(latestHook.ready).toBe(true);
    expect(latestHook.state.time.departedAtMs).toBeNull();
    expect(latestHook.state.lastAdvanceReport).toMatchObject({
      mode: "offline",
      elapsedMs: 9_000,
      overflowMs: 9_000,
    });
    expect(latestHook.persistenceStatus.phase).toBe("saved");
    expect(latestHook.persistenceStatus.announcement).toBe("polite");
  });

  it("falls back to the foreground engine when the runner fails", async () => {
    const departed = recordDeparture(createInitialGameState(), 2_000);
    await idleBitPersistence.set("save-v7", serializeSave(departed, 2_000));
    const runner = makeRunner(vi.fn().mockRejectedValue(new Error("worker failed")));

    act(() => {
      root.render(
        <Harness
          options={{
            seedRackReady: false,
            createOfflineRunner: () => runner,
            now: () => 7_000,
            saveIntervalMs: 1_000_000,
          }}
        />,
      );
    });
    await flushEffects();

    expect(latestHook.state.lastAdvanceReport).toMatchObject({
      mode: "offline",
      elapsedMs: 5_000,
      overflowMs: 5_000,
    });
    expect(latestHook.persistenceStatus.phase).toBe("saved");
  });

  it("accumulates animation frames into deterministic foreground intervals", async () => {
    const callbacks: FrameRequestCallback[] = [];
    rafSpy.mockImplementation((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });

    act(() => {
      root.render(
        <Harness
          options={{
            seedRackReady: false,
            createOfflineRunner: () => makeRunner(vi.fn()),
            now: () => 10_000,
            saveIntervalMs: 1_000_000,
          }}
        />,
      );
    });
    await flushEffects();
    expect(latestHook.ready).toBe(true);
    const initialTick = latestHook.state.tick;
    const base = performance.now();
    const runLatestFrame = (time: number) => {
      const callback = callbacks.at(-1);
      if (!callback) throw new Error("Foreground animation frame was not scheduled");
      act(() => callback(time));
    };

    runLatestFrame(base);
    runLatestFrame(base + 100);
    runLatestFrame(base + 200);
    expect(latestHook.state.tick).toBe(initialTick);

    runLatestFrame(base + FOREGROUND_ADVANCE_INTERVAL_MS);
    expect(latestHook.state.tick).toBeCloseTo(
      initialTick + FOREGROUND_ADVANCE_INTERVAL_MS / 1_000,
      6,
    );

    runLatestFrame(base + FOREGROUND_ADVANCE_INTERVAL_MS + 125);
    expect(latestHook.state.tick).toBeCloseTo(
      initialTick + FOREGROUND_ADVANCE_INTERVAL_MS / 1_000,
      6,
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flushEffects();
    expect(latestHook.state.tick).toBeCloseTo(
      initialTick + (FOREGROUND_ADVANCE_INTERVAL_MS + 125) / 1_000,
      6,
    );
  });

  it("surfaces storage write failures", async () => {
    const setSpy = vi
      .spyOn(idleBitPersistence, "set")
      .mockRejectedValue(new Error("disk unavailable"));
    const runner = makeRunner(vi.fn());

    act(() => {
      root.render(
        <Harness
          options={{
            seedRackReady: false,
            createOfflineRunner: () => runner,
            now: () => 10_000,
            saveIntervalMs: 1_000_000,
          }}
        />,
      );
    });
    await flushEffects();

    expect(latestHook.ready).toBe(true);
    expect(latestHook.persistenceStatus).toMatchObject({
      phase: "error",
      message: "Save failed: disk unavailable",
    });
    setSpy.mockRestore();
  });

  it("persists the owned buffer snapshot on departure", async () => {
    let timestampMs = 1_000;
    const runner = makeRunner(vi.fn());

    act(() => {
      root.render(
        <Harness
          options={{
            seedRackReady: false,
            createOfflineRunner: () => runner,
            now: () => timestampMs,
            saveIntervalMs: 1_000_000,
          }}
        />,
      );
    });
    await flushEffects();

    act(() => {
      latestHook.setState((current: GameState) => ({
        ...current,
        automationBuffer: {
          ...current.automationBuffer,
          ownedLevelId: "localScheduler",
        },
      }));
    });
    timestampMs = 5_000;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flushEffects();

    const raw = await idleBitPersistence.get<string>("save-v7");
    const saved = deserializeSave(raw);
    expect(saved.time).toMatchObject({
      lastSavedAtMs: 5_000,
      departedAtMs: 5_000,
    });
    expect(saved.automationBuffer).toMatchObject({
      ownedLevelId: "localScheduler",
      departureLevelId: "localScheduler",
      offlineProcessedMs: 0,
    });
  });

  it("ignores mutations and stale Worker results during catch-up", async () => {
    let timestampMs = 1_000;
    const pendingAdvance = deferred<ReturnType<typeof advanceGame>>();
    const requests: Parameters<GameOfflineAdvanceRunner["run"]>[0][] = [];
    const run = vi.fn<GameOfflineAdvanceRunner["run"]>((request) => {
      requests.push(request);
      return pendingAdvance.promise;
    });
    const runner = makeRunner(run);

    act(() => {
      root.render(
        <Harness
          options={{
            seedRackReady: false,
            createOfflineRunner: () => runner,
            now: () => timestampMs,
            saveIntervalMs: 1_000_000,
          }}
        />,
      );
    });
    await flushEffects();

    act(() => {
      latestHook.setState((current) => ({
        ...current,
        resources: { credits: 10, data: 0 },
        exactResources: exactResourceBag(10, 0),
      }));
    });

    timestampMs = 2_000;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flushEffects();

    timestampMs = 3_000;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flushEffects();

    expect(latestHook.catchupActive).toBe(true);
    expect(run).toHaveBeenCalledOnce();

    act(() => {
      latestHook.setState((current) => ({
        ...current,
        resources: { ...current.resources, credits: 999 },
        exactResources: exactResourceBag(999, current.resources.data),
      }));
    });
    let resetResult: GameState | null = null;
    await act(async () => {
      resetResult = await latestHook.resetGame();
    });
    expect(resetResult).toBeNull();
    expect(latestHook.state.resources.credits).toBe(10);

    timestampMs = 4_000;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flushEffects();
    expect(latestHook.state.time.departedAtMs).toBe(4_000);

    await act(async () => {
      pendingAdvance.resolve(
        advanceGame(requests[0]!.state, requests[0]!.elapsedMs, "offline"),
      );
      await pendingAdvance.promise;
    });
    await flushEffects();

    expect(latestHook.state.time.departedAtMs).toBe(4_000);
    expect(latestHook.state.lastAdvanceReport).toBeNull();
    expect(latestHook.state.resources.credits).toBe(10);
  });

  it("quarantines writes after a save read failure until explicit reset", async () => {
    vi.useFakeTimers();
    const getSpy = vi
      .spyOn(idleBitPersistence, "get")
      .mockRejectedValue(new Error("read unavailable"));
    const setSpy = vi
      .spyOn(idleBitPersistence, "set")
      .mockResolvedValue(undefined);
    const runner = makeRunner(vi.fn());

    act(() => {
      root.render(
        <Harness
          options={{
            seedRackReady: false,
            createOfflineRunner: () => runner,
            now: () => 10_000,
            saveIntervalMs: 100,
          }}
        />,
      );
    });
    await flushEffects();

    expect(latestHook.persistenceStatus).toMatchObject({
      phase: "error",
      message: "Load failed: read unavailable",
    });

    act(() => vi.advanceTimersByTime(500));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flushEffects();
    expect(setSpy).not.toHaveBeenCalled();

    let resetResult: GameState | null = null;
    await act(async () => {
      resetResult = await latestHook.resetGame();
    });
    expect(resetResult).not.toBeNull();
    expect(setSpy).toHaveBeenCalledOnce();

    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  it("does not advance a StrictMode hydration that was cancelled after reading", async () => {
    const firstRead = deferred<string | null>();
    const secondRead = deferred<string | null>();
    const departed = recordDeparture(createInitialGameState(), 1_000);
    const getSpy = vi
      .spyOn(idleBitPersistence, "get")
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(() => secondRead.promise);
    const run = vi.fn<GameOfflineAdvanceRunner["run"]>();
    const runner = makeRunner(run);

    act(() => {
      root.render(
        <StrictMode>
          <Harness
            options={{
              seedRackReady: false,
              createOfflineRunner: () => runner,
              now: () => 10_000,
              saveIntervalMs: 1_000_000,
            }}
          />
        </StrictMode>,
      );
    });

    await act(async () => {
      firstRead.resolve(serializeSave(departed, 1_000));
      await firstRead.promise;
    });
    await flushEffects();
    expect(run).not.toHaveBeenCalled();

    await act(async () => {
      secondRead.resolve(null);
      await secondRead.promise;
    });
    await flushEffects();
    expect(run).not.toHaveBeenCalled();
    expect(latestHook.ready).toBe(true);

    getSpy.mockRestore();
  });

  it("keeps routine autosave status changes out of the live region", async () => {
    vi.useFakeTimers();
    const runner = makeRunner(vi.fn());
    act(() => {
      root.render(
        <Harness
          options={{
            seedRackReady: false,
            createOfflineRunner: () => runner,
            now: () => 10_000,
            saveIntervalMs: 100,
          }}
        />,
      );
    });
    await flushEffects();
    expect(latestHook.persistenceStatus.announcement).toBe("polite");

    act(() => vi.advanceTimersByTime(100));
    await flushEffects();
    expect(latestHook.persistenceStatus).toMatchObject({
      phase: "saved",
      announcement: null,
    });
  });

  it("writes a stamped departure synchronously on pagehide", async () => {
    let timestampMs = 1_000;
    const runner = makeRunner(vi.fn());
    const immediateSpy = vi
      .spyOn(idleBitPersistence, "setImmediate")
      .mockReturnValue(true);
    const setSpy = vi.spyOn(idleBitPersistence, "set");

    act(() => {
      root.render(
        <Harness
          options={{
            seedRackReady: false,
            createOfflineRunner: () => runner,
            now: () => timestampMs,
            saveIntervalMs: 1_000_000,
          }}
        />,
      );
    });
    await flushEffects();
    immediateSpy.mockClear();
    setSpy.mockClear();

    timestampMs = 8_000;
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));

    expect(immediateSpy).toHaveBeenCalledOnce();
    const [key, rawSave] = immediateSpy.mock.calls[0]!;
    expect(key).toBe("save-v7");
    expect(deserializeSave(rawSave as string).time).toMatchObject({
      lastSavedAtMs: 8_000,
      departedAtMs: 8_000,
    });
    expect(latestHook.state.time.departedAtMs).toBe(8_000);
    expect(setSpy).not.toHaveBeenCalled();

    immediateSpy.mockRestore();
    setSpy.mockRestore();
  });

  it("falls back to the queued departure save when immediate storage is unavailable", async () => {
    let timestampMs = 1_000;
    const runner = makeRunner(vi.fn());
    const immediateSpy = vi
      .spyOn(idleBitPersistence, "setImmediate")
      .mockReturnValue(false);
    const setSpy = vi.spyOn(idleBitPersistence, "set");

    act(() => {
      root.render(
        <Harness
          options={{
            seedRackReady: false,
            createOfflineRunner: () => runner,
            now: () => timestampMs,
            saveIntervalMs: 1_000_000,
          }}
        />,
      );
    });
    await flushEffects();
    immediateSpy.mockClear();
    setSpy.mockClear();

    timestampMs = 9_000;
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    await flushEffects();

    expect(immediateSpy).toHaveBeenCalledOnce();
    expect(setSpy).toHaveBeenCalledOnce();
    expect(
      deserializeSave(setSpy.mock.calls[0]?.[1] as string).time,
    ).toMatchObject({ lastSavedAtMs: 9_000, departedAtMs: 9_000 });

    immediateSpy.mockRestore();
    setSpy.mockRestore();
  });

  it("acknowledges Electron close only after the queued departure save", async () => {
    let beforeClose:
      | ((request: { requestId: number }) => void)
      | undefined;
    const unsubscribe = vi.fn();
    const onBeforeCloseSpy = vi
      .spyOn(idleBitLifecycle, "onBeforeClose")
      .mockImplementation((listener) => {
        beforeClose = listener;
        return unsubscribe;
      });
    const acknowledgeSpy = vi
      .spyOn(idleBitLifecycle, "acknowledgeBeforeClose")
      .mockReturnValue(true);
    let timestampMs = 1_000;
    const runner = makeRunner(vi.fn());

    act(() => {
      root.render(
        <Harness
          options={{
            seedRackReady: false,
            createOfflineRunner: () => runner,
            now: () => timestampMs,
            saveIntervalMs: 1_000_000,
          }}
        />,
      );
    });
    await flushEffects();

    const pendingWrite = deferred<void>();
    const setSpy = vi
      .spyOn(idleBitPersistence, "set")
      .mockImplementation(() => pendingWrite.promise);
    timestampMs = 11_000;
    act(() => beforeClose?.({ requestId: 7 }));
    await act(async () => Promise.resolve());
    expect(setSpy).toHaveBeenCalledOnce();
    expect(acknowledgeSpy).not.toHaveBeenCalled();

    await act(async () => {
      pendingWrite.resolve();
      await pendingWrite.promise;
    });
    await flushEffects();
    expect(acknowledgeSpy).toHaveBeenCalledWith(7);

    setSpy.mockRestore();
    onBeforeCloseSpy.mockRestore();
    acknowledgeSpy.mockRestore();
  });
});
