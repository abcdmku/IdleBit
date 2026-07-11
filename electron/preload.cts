import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent,
} from "electron";

interface BeforeCloseRequest {
  requestId: number;
}

const CHANNELS = {
  clear: "idlebit:persistence:clear",
  get: "idlebit:persistence:get",
  remove: "idlebit:persistence:remove",
  set: "idlebit:persistence:set",
} as const;

const LIFECYCLE_CHANNELS = {
  acknowledgeClose: "idlebit:lifecycle:acknowledge-close",
  beforeClose: "idlebit:lifecycle:before-close",
} as const;

function parseBeforeCloseRequest(value: unknown): BeforeCloseRequest | null {
  if (
    !value ||
    typeof value !== "object" ||
    !Object.hasOwn(value, "requestId")
  ) {
    return null;
  }

  const requestId = (value as { requestId: unknown }).requestId;
  return typeof requestId === "number" &&
    Number.isSafeInteger(requestId) &&
    requestId > 0
    ? { requestId }
    : null;
}

const idleBitPlatform = {
  lifecycle: {
    acknowledgeBeforeClose: (requestId: number) => {
      if (Number.isSafeInteger(requestId) && requestId > 0) {
        ipcRenderer.send(LIFECYCLE_CHANNELS.acknowledgeClose, { requestId });
      }
    },
    onBeforeClose: (listener: (request: BeforeCloseRequest) => void) => {
      if (typeof listener !== "function") {
        return () => undefined;
      }

      const handleBeforeClose = (
        _event: IpcRendererEvent,
        payload: unknown,
      ) => {
        const request = parseBeforeCloseRequest(payload);
        if (request) {
          listener(request);
        }
      };

      ipcRenderer.on(LIFECYCLE_CHANNELS.beforeClose, handleBeforeClose);
      return () => {
        ipcRenderer.removeListener(
          LIFECYCLE_CHANNELS.beforeClose,
          handleBeforeClose,
        );
      };
    },
  },
  persistence: {
    clear: (keyPrefix?: string) =>
      ipcRenderer.invoke(CHANNELS.clear, keyPrefix) as Promise<void>,
    getItem: (key: string) =>
      ipcRenderer.invoke(CHANNELS.get, key) as Promise<string | null>,
    removeItem: (key: string) =>
      ipcRenderer.invoke(CHANNELS.remove, key) as Promise<void>,
    setItem: (key: string, value: string) =>
      ipcRenderer.invoke(CHANNELS.set, key, value) as Promise<void>,
  },
  runtime: {
    kind: "electron",
  },
} as const;

contextBridge.exposeInMainWorld("idleBitPlatform", idleBitPlatform);
