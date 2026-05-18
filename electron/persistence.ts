import { app, ipcMain } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

type PersistenceStore = Record<string, string>;

const STORE_DIRECTORY = "storage";
const STORE_FILENAME = "persistence.json";
const KEY_PATTERN = /^[a-zA-Z0-9._:-]+$/;
const MAX_KEY_LENGTH = 160;
const MAX_VALUE_BYTES = 5 * 1024 * 1024;
let writeQueue: Promise<void> = Promise.resolve();

const CHANNELS = {
  clear: "idlebit:persistence:clear",
  get: "idlebit:persistence:get",
  remove: "idlebit:persistence:remove",
  set: "idlebit:persistence:set",
} as const;

function storePath(): string {
  return path.join(app.getPath("userData"), STORE_DIRECTORY, STORE_FILENAME);
}

function storeDirectory(): string {
  return path.dirname(storePath());
}

function isPersistenceStore(value: unknown): value is PersistenceStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === "string");
}

function assertStorageKey(key: unknown): asserts key is string {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > MAX_KEY_LENGTH ||
    !KEY_PATTERN.test(key)
  ) {
    throw new Error("Invalid IdleBit persistence key.");
  }
}

function assertStorageValue(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new Error("Invalid IdleBit persistence value.");
  }

  if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) {
    throw new Error("IdleBit persistence value is too large.");
  }
}

async function readStore(): Promise<PersistenceStore> {
  try {
    const serializedStore = await fs.readFile(storePath(), "utf8");
    const parsedStore: unknown = JSON.parse(serializedStore);

    if (!isPersistenceStore(parsedStore)) {
      return {};
    }

    return parsedStore;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }

    throw error;
  }
}

async function writeStore(store: PersistenceStore): Promise<void> {
  await fs.mkdir(storeDirectory(), { recursive: true });

  const targetPath = storePath();
  const temporaryPath = `${targetPath}.tmp`;
  const serializedStore = JSON.stringify(store, null, 2);

  await fs.writeFile(temporaryPath, serializedStore, "utf8");
  await fs.rename(temporaryPath, targetPath);
}

async function enqueueStoreWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(write, write);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function registerPersistenceIpc(): void {
  ipcMain.handle(CHANNELS.get, async (_event, key: unknown) => {
    assertStorageKey(key);
    const store = await readStore();
    return store[key] ?? null;
  });

  ipcMain.handle(CHANNELS.set, async (_event, key: unknown, value: unknown) => {
    assertStorageKey(key);
    assertStorageValue(value);

    await enqueueStoreWrite(async () => {
      const store = await readStore();
      store[key] = value;
      await writeStore(store);
    });
  });

  ipcMain.handle(CHANNELS.remove, async (_event, key: unknown) => {
    assertStorageKey(key);

    await enqueueStoreWrite(async () => {
      const store = await readStore();
      delete store[key];
      await writeStore(store);
    });
  });

  ipcMain.handle(CHANNELS.clear, async (_event, keyPrefix?: unknown) => {
    if (keyPrefix === undefined) {
      await enqueueStoreWrite(async () => {
        await writeStore({});
      });
      return;
    }

    assertStorageKey(keyPrefix);

    await enqueueStoreWrite(async () => {
      const store = await readStore();

      for (const key of Object.keys(store)) {
        if (key.startsWith(keyPrefix)) {
          delete store[key];
        }
      }

      await writeStore(store);
    });
  });
}
