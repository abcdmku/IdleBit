export type PersistenceDriver = "browser" | "electron" | "memory";

export type PersistedValue =
  | boolean
  | number
  | string
  | null
  | PersistedValue[]
  | { [key: string]: PersistedValue };

export interface PersistenceOptions {
  namespace?: string;
}

export interface PersistenceAdapter {
  readonly driver: PersistenceDriver;
  clear(): Promise<void>;
  get<T extends PersistedValue>(key: string, fallbackValue: T): Promise<T>;
  get<T extends PersistedValue>(key: string): Promise<T | null>;
  remove(key: string): Promise<void>;
  set<T extends PersistedValue>(key: string, value: T): Promise<void>;
}

interface StringPersistenceBridge {
  clear(keyPrefix?: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
}

interface IdleBitPlatformBridge {
  persistence?: StringPersistenceBridge;
  runtime?: {
    kind?: string;
  };
}

declare global {
  interface Window {
    idleBitPlatform?: IdleBitPlatformBridge;
  }
}

const DEFAULT_NAMESPACE = "idlebit";
const KEY_PATTERN = /^[a-zA-Z0-9._:-]+$/;
const MAX_KEY_LENGTH = 160;
const memoryStore = new Map<string, string>();

function bridge(): StringPersistenceBridge | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.idleBitPlatform?.persistence ?? null;
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storage = window.localStorage;
    const probeKey = "__idlebit_storage_probe__";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

function storageKey(namespace: string, key: string): string {
  const fullKey = `${namespace}:${key}`;

  if (
    !namespace.trim() ||
    !key.trim() ||
    fullKey.length > MAX_KEY_LENGTH ||
    !KEY_PATTERN.test(fullKey)
  ) {
    throw new Error("Invalid persistence key.");
  }

  return fullKey;
}

function parseStoredValue<T extends PersistedValue>(rawValue: string): T {
  return JSON.parse(rawValue) as T;
}

function stringifyPersistedValue(value: PersistedValue): string {
  return JSON.stringify(value);
}

function createMemoryPersistenceAdapter(namespace: string): PersistenceAdapter {
  return {
    driver: "memory",
    async clear() {
      for (const key of Array.from(memoryStore.keys())) {
        if (key.startsWith(`${namespace}:`)) {
          memoryStore.delete(key);
        }
      }
    },
    async get<T extends PersistedValue>(
      key: string,
      fallbackValue?: T,
    ): Promise<T | null> {
      const rawValue = memoryStore.get(storageKey(namespace, key));

      if (rawValue === undefined) {
        return fallbackValue ?? null;
      }

      return parseStoredValue<T>(rawValue);
    },
    async remove(key: string) {
      memoryStore.delete(storageKey(namespace, key));
    },
    async set<T extends PersistedValue>(key: string, value: T) {
      memoryStore.set(storageKey(namespace, key), stringifyPersistedValue(value));
    },
  };
}

function createBrowserPersistenceAdapter(
  namespace: string,
  storage: Storage,
): PersistenceAdapter {
  return {
    driver: "browser",
    async clear() {
      const prefix = `${namespace}:`;

      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);

        if (key?.startsWith(prefix)) {
          storage.removeItem(key);
        }
      }
    },
    async get<T extends PersistedValue>(
      key: string,
      fallbackValue?: T,
    ): Promise<T | null> {
      const rawValue = storage.getItem(storageKey(namespace, key));

      if (rawValue === null) {
        return fallbackValue ?? null;
      }

      return parseStoredValue<T>(rawValue);
    },
    async remove(key: string) {
      storage.removeItem(storageKey(namespace, key));
    },
    async set<T extends PersistedValue>(key: string, value: T) {
      storage.setItem(storageKey(namespace, key), stringifyPersistedValue(value));
    },
  };
}

function createElectronPersistenceAdapter(
  namespace: string,
  platformBridge: StringPersistenceBridge,
): PersistenceAdapter {
  return {
    driver: "electron",
    async clear() {
      await platformBridge.clear(`${namespace}:`);
    },
    async get<T extends PersistedValue>(
      key: string,
      fallbackValue?: T,
    ): Promise<T | null> {
      const rawValue = await platformBridge.getItem(storageKey(namespace, key));

      if (rawValue === null) {
        return fallbackValue ?? null;
      }

      return parseStoredValue<T>(rawValue);
    },
    async remove(key: string) {
      await platformBridge.removeItem(storageKey(namespace, key));
    },
    async set<T extends PersistedValue>(key: string, value: T) {
      await platformBridge.setItem(
        storageKey(namespace, key),
        stringifyPersistedValue(value),
      );
    },
  };
}

export function createPersistenceAdapter(
  options: PersistenceOptions = {},
): PersistenceAdapter {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const electronBridge = bridge();

  if (electronBridge) {
    return createElectronPersistenceAdapter(namespace, electronBridge);
  }

  const storage = browserStorage();

  if (storage) {
    return createBrowserPersistenceAdapter(namespace, storage);
  }

  return createMemoryPersistenceAdapter(namespace);
}

export const idleBitPersistence = createPersistenceAdapter();
