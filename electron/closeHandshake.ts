export const BEFORE_CLOSE_CHANNEL = "idlebit:lifecycle:before-close" as const;
export const ACKNOWLEDGE_CLOSE_CHANNEL =
  "idlebit:lifecycle:acknowledge-close" as const;

export interface BeforeCloseRequest {
  requestId: number;
}

export interface CloseEvent {
  preventDefault(): void;
}

export interface CloseHandshakeController {
  readonly pendingRequestId: number | null;
  acknowledge(requestId: number): boolean;
  dispose(): void;
  handleClose(event: CloseEvent): void;
}

export interface CloseHandshakeOptions {
  cancelTimeout?: (timeout: ReturnType<typeof setTimeout>) => void;
  isWindowDestroyed(): boolean;
  /**
   * Called when the fail-safe timeout force-closes the window without a
   * renderer acknowledgement, i.e. the departure save may not have landed.
   */
  onTimeoutClose?(): void;
  requestClose(): void;
  scheduleTimeout?: (
    callback: () => void,
    timeoutMs: number,
  ) => ReturnType<typeof setTimeout>;
  sendBeforeClose(request: BeforeCloseRequest): void;
  timeoutMs?: number;
}

/**
 * Bounded fail-safe: generous enough for a departure save with retries over a
 * full store rewrite, but still guarantees the window closes.
 */
export const DEFAULT_CLOSE_HANDSHAKE_TIMEOUT_MS = 5_000;

/**
 * Persistence-store key (renderer namespace) recording that the fail-safe
 * timeout closed the window without an acknowledged departure save.
 */
export const FORCED_CLOSE_FLAG_KEY = "idlebit:lifecycle.forced-close-v1";

export function parseCloseAcknowledgementRequestId(
  value: unknown,
): number | null {
  if (
    !value ||
    typeof value !== "object" ||
    !Object.hasOwn(value, "requestId")
  ) {
    return null;
  }

  const requestId = (value as { requestId: unknown }).requestId;
  return Number.isSafeInteger(requestId) && Number(requestId) > 0
    ? Number(requestId)
    : null;
}

export function createCloseHandshake({
  cancelTimeout = clearTimeout,
  isWindowDestroyed,
  onTimeoutClose,
  requestClose,
  scheduleTimeout = setTimeout,
  sendBeforeClose,
  timeoutMs = DEFAULT_CLOSE_HANDSHAKE_TIMEOUT_MS,
}: CloseHandshakeOptions): CloseHandshakeController {
  let allowNextClose = false;
  let disposed = false;
  let nextRequestId = 1;
  let pendingRequestId: number | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const clearPendingTimeout = () => {
    if (timeout !== null) {
      cancelTimeout(timeout);
      timeout = null;
    }
  };

  const complete = (requestId: number): boolean => {
    if (disposed || pendingRequestId !== requestId) {
      return false;
    }

    pendingRequestId = null;
    clearPendingTimeout();
    if (isWindowDestroyed()) {
      return true;
    }

    allowNextClose = true;
    try {
      requestClose();
      return true;
    } catch {
      allowNextClose = false;
      return false;
    }
  };

  return {
    get pendingRequestId() {
      return pendingRequestId;
    },

    acknowledge(requestId) {
      return Number.isSafeInteger(requestId) && requestId > 0
        ? complete(requestId)
        : false;
    },

    dispose() {
      disposed = true;
      allowNextClose = false;
      pendingRequestId = null;
      clearPendingTimeout();
    },

    handleClose(event) {
      if (disposed) {
        return;
      }

      if (allowNextClose) {
        allowNextClose = false;
        return;
      }

      event.preventDefault();
      if (pendingRequestId !== null) {
        return;
      }

      const requestId = nextRequestId;
      nextRequestId += 1;
      pendingRequestId = requestId;
      timeout = scheduleTimeout(() => {
        if (complete(requestId)) {
          // The renderer never acknowledged, so the departure save may be
          // unsaved; leave persistent evidence of the forced close.
          onTimeoutClose?.();
        }
      }, Math.max(0, timeoutMs));

      try {
        sendBeforeClose({ requestId });
      } catch {
        complete(requestId);
      }
    },
  };
}
