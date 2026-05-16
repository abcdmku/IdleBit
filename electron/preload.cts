import { contextBridge, ipcRenderer } from "electron";

const CHANNELS = {
  clear: "idlebit:persistence:clear",
  get: "idlebit:persistence:get",
  remove: "idlebit:persistence:remove",
  set: "idlebit:persistence:set",
} as const;

const idleBitPlatform = {
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
