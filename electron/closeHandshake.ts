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
  requestClose(): void;
  scheduleTimeout?: (
    callback: () => void,
    timeoutMs: number,
  ) => ReturnType<typeof setTimeout>;
  sendBeforeClose(request: BeforeCloseRequest): void;
  timeoutMs?: number;
}

export const DEFAULT_CLOSE_HANDSHAKE_TIMEOUT_MS = 1_500;

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
        complete(requestId);
      }, Math.max(0, timeoutMs));

      try {
        sendBeforeClose({ requestId });
      } catch {
        complete(requestId);
      }
    },
  };
}
