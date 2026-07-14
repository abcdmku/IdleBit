import { promises as nodeFileSystem } from "node:fs";
import path from "node:path";

export type PersistenceStoreData = Record<string, string>;

export interface PersistenceFileSystem {
  mkdir(directoryPath: string): Promise<void>;
  readFile(filePath: string): Promise<string>;
  rename(sourcePath: string, targetPath: string): Promise<void>;
  writeFile(filePath: string, contents: string): Promise<void>;
}

export interface JsonPersistenceStoreOptions {
  filePath: string | (() => string);
  fileSystem?: PersistenceFileSystem;
}

export interface ElectronPersistenceStore {
  clear(keyPrefix?: unknown): Promise<void>;
  /** Resolves once every write enqueued so far has settled (never rejects). */
  flush(): Promise<void>;
  get(key: unknown): Promise<string | null>;
  remove(key: unknown): Promise<void>;
  set(key: unknown, value: unknown): Promise<void>;
}

const KEY_PATTERN = /^[a-zA-Z0-9._:-]+$/;
const MAX_KEY_LENGTH = 160;
const MAX_VALUE_BYTES = 5 * 1024 * 1024;

const defaultFileSystem: PersistenceFileSystem = {
  async mkdir(directoryPath) {
    await nodeFileSystem.mkdir(directoryPath, { recursive: true });
  },
  readFile(filePath) {
    return nodeFileSystem.readFile(filePath, "utf8");
  },
  rename(sourcePath, targetPath) {
    return nodeFileSystem.rename(sourcePath, targetPath);
  },
  writeFile(filePath, contents) {
    return nodeFileSystem.writeFile(filePath, contents, "utf8");
  },
};

function createPersistenceStoreData(): PersistenceStoreData {
  return Object.create(null) as PersistenceStoreData;
}

function normalizePersistenceStoreData(
  value: unknown,
): PersistenceStoreData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const normalized = createPersistenceStoreData();
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      return null;
    }
    normalized[key] = entry;
  }
  return normalized;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT",
  );
}

function parseStore(serializedStore: string): PersistenceStoreData {
  try {
    const parsedStore: unknown = JSON.parse(serializedStore);
    return normalizePersistenceStoreData(parsedStore) ?? createPersistenceStoreData();
  } catch {
    return createPersistenceStoreData();
  }
}

export function assertPersistenceKey(key: unknown): asserts key is string {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > MAX_KEY_LENGTH ||
    !KEY_PATTERN.test(key)
  ) {
    throw new Error("Invalid IdleBit persistence key.");
  }
}

export function assertPersistenceValue(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new Error("Invalid IdleBit persistence value.");
  }

  if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) {
    throw new Error("IdleBit persistence value is too large.");
  }
}

export function createJsonPersistenceStore({
  filePath,
  fileSystem = defaultFileSystem,
}: JsonPersistenceStoreOptions): ElectronPersistenceStore {
  let writeQueue: Promise<void> = Promise.resolve();
  const resolveFilePath = () =>
    typeof filePath === "function" ? filePath() : filePath;

  const readStore = async (): Promise<PersistenceStoreData> => {
    try {
      return parseStore(await fileSystem.readFile(resolveFilePath()));
    } catch (error) {
      if (isMissingFileError(error)) {
        return createPersistenceStoreData();
      }

      throw error;
    }
  };

  const writeStore = async (store: PersistenceStoreData): Promise<void> => {
    const targetPath = resolveFilePath();
    const temporaryPath = `${targetPath}.tmp`;

    await fileSystem.mkdir(path.dirname(targetPath));
    await fileSystem.writeFile(temporaryPath, JSON.stringify(store, null, 2));
    await fileSystem.rename(temporaryPath, targetPath);
  };

  const enqueueWrite = <T>(write: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(write, write);
    writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    async clear(keyPrefix?: unknown) {
      if (keyPrefix !== undefined) {
        assertPersistenceKey(keyPrefix);
      }

      await enqueueWrite(async () => {
        if (keyPrefix === undefined) {
          await writeStore(createPersistenceStoreData());
          return;
        }

        const store = await readStore();
        for (const key of Object.keys(store)) {
          if (key.startsWith(keyPrefix)) {
            delete store[key];
          }
        }
        await writeStore(store);
      });
    },

    async flush() {
      // writeQueue already swallows write failures, so this resolves once
      // every write enqueued before the flush call has settled.
      await writeQueue;
    },

    async get(key: unknown) {
      assertPersistenceKey(key);
      await writeQueue;
      const store = await readStore();
      return Object.hasOwn(store, key) ? store[key] : null;
    },

    async remove(key: unknown) {
      assertPersistenceKey(key);
      await enqueueWrite(async () => {
        const store = await readStore();
        delete store[key];
        await writeStore(store);
      });
    },

    async set(key: unknown, value: unknown) {
      assertPersistenceKey(key);
      assertPersistenceValue(value);
      await enqueueWrite(async () => {
        const store = await readStore();
        store[key] = value;
        await writeStore(store);
      });
    },
  };
}
