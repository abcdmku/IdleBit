import { app, ipcMain } from "electron";
import path from "node:path";

import {
  createJsonPersistenceStore,
  type ElectronPersistenceStore,
} from "./persistenceStore.js";

const STORE_DIRECTORY = "storage";
const STORE_FILENAME = "persistence.json";

const CHANNELS = {
  clear: "idlebit:persistence:clear",
  get: "idlebit:persistence:get",
  remove: "idlebit:persistence:remove",
  set: "idlebit:persistence:set",
} as const;

function storePath(): string {
  return path.join(app.getPath("userData"), STORE_DIRECTORY, STORE_FILENAME);
}

export function registerPersistenceIpc(
  store: ElectronPersistenceStore = createJsonPersistenceStore({
    filePath: storePath,
  }),
): void {
  ipcMain.handle(CHANNELS.get, async (_event, key: unknown) => {
    return store.get(key);
  });

  ipcMain.handle(CHANNELS.set, async (_event, key: unknown, value: unknown) => {
    await store.set(key, value);
  });

  ipcMain.handle(CHANNELS.remove, async (_event, key: unknown) => {
    await store.remove(key);
  });

  ipcMain.handle(CHANNELS.clear, async (_event, keyPrefix?: unknown) => {
    await store.clear(keyPrefix);
  });
}
