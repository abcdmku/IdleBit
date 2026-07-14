import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCloseHandshake,
  parseCloseAcknowledgementRequestId,
} from "./closeHandshake.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("Electron close handshake", () => {
  it("waits for acknowledgement and bypasses exactly one follow-up close", () => {
    const requestClose = vi.fn();
    const sendBeforeClose = vi.fn();
    const controller = createCloseHandshake({
      isWindowDestroyed: () => false,
      requestClose,
      sendBeforeClose,
    });
    const firstEvent = { preventDefault: vi.fn() };
    const repeatedEvent = { preventDefault: vi.fn() };

    controller.handleClose(firstEvent);
    controller.handleClose(repeatedEvent);

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce();
    expect(sendBeforeClose).toHaveBeenCalledOnce();
    expect(sendBeforeClose).toHaveBeenCalledWith({ requestId: 1 });
    expect(requestClose).not.toHaveBeenCalled();
    expect(controller.acknowledge(999)).toBe(false);

    expect(controller.acknowledge(1)).toBe(true);
    expect(requestClose).toHaveBeenCalledOnce();

    const allowedEvent = { preventDefault: vi.fn() };
    controller.handleClose(allowedEvent);
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled();

    const laterEvent = { preventDefault: vi.fn() };
    controller.handleClose(laterEvent);
    expect(laterEvent.preventDefault).toHaveBeenCalledOnce();
    expect(sendBeforeClose).toHaveBeenCalledTimes(2);

    controller.dispose();
  });

  it("closes after the fail-safe timeout when the renderer does not reply", () => {
    vi.useFakeTimers();
    const requestClose = vi.fn();
    const controller = createCloseHandshake({
      isWindowDestroyed: () => false,
      requestClose,
      sendBeforeClose: vi.fn(),
      timeoutMs: 25,
    });

    controller.handleClose({ preventDefault: vi.fn() });
    expect(requestClose).not.toHaveBeenCalled();

    vi.advanceTimersByTime(24);
    expect(requestClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestClose).toHaveBeenCalledOnce();

    const allowedEvent = { preventDefault: vi.fn() };
    controller.handleClose(allowedEvent);
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("records forced-close evidence when the timeout fires unacknowledged", () => {
    vi.useFakeTimers();
    const onTimeoutClose = vi.fn();
    const requestClose = vi.fn();
    const controller = createCloseHandshake({
      isWindowDestroyed: () => false,
      onTimeoutClose,
      requestClose,
      sendBeforeClose: vi.fn(),
      timeoutMs: 25,
    });

    controller.handleClose({ preventDefault: vi.fn() });
    expect(onTimeoutClose).not.toHaveBeenCalled();

    vi.advanceTimersByTime(25);
    expect(requestClose).toHaveBeenCalledOnce();
    expect(onTimeoutClose).toHaveBeenCalledOnce();
  });

  it("does not record forced-close evidence when the renderer acknowledges in time", () => {
    vi.useFakeTimers();
    const onTimeoutClose = vi.fn();
    const requestClose = vi.fn();
    const controller = createCloseHandshake({
      isWindowDestroyed: () => false,
      onTimeoutClose,
      requestClose,
      sendBeforeClose: vi.fn(),
      timeoutMs: 25,
    });

    controller.handleClose({ preventDefault: vi.fn() });
    expect(controller.acknowledge(1)).toBe(true);
    expect(requestClose).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(1_000);
    expect(onTimeoutClose).not.toHaveBeenCalled();
  });

  it("validates acknowledgement payloads", () => {
    expect(parseCloseAcknowledgementRequestId({ requestId: 3 })).toBe(3);
    expect(parseCloseAcknowledgementRequestId({ requestId: 0 })).toBeNull();
    expect(parseCloseAcknowledgementRequestId({ requestId: "3" })).toBeNull();
    expect(
      parseCloseAcknowledgementRequestId(Object.create({ requestId: 3 })),
    ).toBeNull();
    expect(parseCloseAcknowledgementRequestId(null)).toBeNull();
  });
});
