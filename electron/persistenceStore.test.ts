import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createJsonPersistenceStore,
  type PersistenceFileSystem,
} from "./persistenceStore.js";

describe("JSON persistence store", () => {
  let directoryPath = "";
  let filePath = "";

  beforeEach(async () => {
    directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), "idlebit-store-"));
    filePath = path.join(directoryPath, "storage", "persistence.json");
  });

  afterEach(async () => {
    await fs.rm(directoryPath, { force: true, recursive: true });
  });

  it("recovers from missing and corrupt store files", async () => {
    const store = createJsonPersistenceStore({ filePath });

    await expect(store.get("idlebit:save")).resolves.toBeNull();

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{not-json", "utf8");

    await expect(store.get("idlebit:save")).resolves.toBeNull();
    await store.set("idlebit:save", "recovered");

    await expect(store.get("idlebit:save")).resolves.toBe("recovered");
    await expect(fs.readFile(filePath, "utf8")).resolves.toContain(
      '"idlebit:save": "recovered"',
    );
  });

  it("treats reserved object property names as ordinary own keys", async () => {
    const store = createJsonPersistenceStore({ filePath });
    const reservedEntries = [
      ["toString", "string value"],
      ["constructor", "constructor value"],
      ["__proto__", "prototype value"],
    ] as const;

    for (const [key] of reservedEntries) {
      await expect(store.get(key)).resolves.toBeNull();
    }
    for (const [key, value] of reservedEntries) {
      await store.set(key, value);
    }

    const restoredStore = createJsonPersistenceStore({ filePath });
    for (const [key, value] of reservedEntries) {
      await expect(restoredStore.get(key)).resolves.toBe(value);
    }

    const serialized = JSON.parse(await fs.readFile(filePath, "utf8")) as object;
    for (const [key] of reservedEntries) {
      expect(Object.hasOwn(serialized, key)).toBe(true);
    }

    await restoredStore.remove("__proto__");
    await expect(restoredStore.get("__proto__")).resolves.toBeNull();
  });

  it("serializes concurrent writes through temporary-file renames", async () => {
    const operations: string[] = [];
    const recordingFileSystem: PersistenceFileSystem = {
      async mkdir(targetPath) {
        operations.push(`mkdir:${targetPath}`);
        await fs.mkdir(targetPath, { recursive: true });
      },
      readFile(targetPath) {
        return fs.readFile(targetPath, "utf8");
      },
      async rename(sourcePath, targetPath) {
        operations.push(`rename:${sourcePath}->${targetPath}`);
        await fs.rename(sourcePath, targetPath);
      },
      async writeFile(targetPath, contents) {
        operations.push(`write:${targetPath}`);
        await fs.writeFile(targetPath, contents, "utf8");
      },
    };
    const store = createJsonPersistenceStore({
      filePath,
      fileSystem: recordingFileSystem,
    });

    await Promise.all([
      store.set("idlebit:first", "one"),
      store.set("idlebit:second", "two"),
      store.set("idlebit:third", "three"),
    ]);

    const fileOperations = operations.filter(
      (operation) => operation.startsWith("write:") || operation.startsWith("rename:"),
    );
    expect(fileOperations).toEqual([
      `write:${filePath}.tmp`,
      `rename:${filePath}.tmp->${filePath}`,
      `write:${filePath}.tmp`,
      `rename:${filePath}.tmp->${filePath}`,
      `write:${filePath}.tmp`,
      `rename:${filePath}.tmp->${filePath}`,
    ]);
    await expect(store.get("idlebit:first")).resolves.toBe("one");
    await expect(store.get("idlebit:second")).resolves.toBe("two");
    await expect(store.get("idlebit:third")).resolves.toBe("three");
  });

  it("flush resolves only after every enqueued write has been committed", async () => {
    const store = createJsonPersistenceStore({ filePath });

    void store.set("idlebit:first", "one");
    void store.set("idlebit:second", "two");
    await store.flush();

    const serialized = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<
      string,
      string
    >;
    expect(serialized).toMatchObject({
      "idlebit:first": "one",
      "idlebit:second": "two",
    });
  });

  it("flush resolves even when an enqueued write failed", async () => {
    const failingStore = createJsonPersistenceStore({
      filePath,
      fileSystem: {
        async mkdir() {},
        async readFile() {
          throw Object.assign(new Error("permission denied"), {
            code: "EACCES",
          });
        },
        async rename() {},
        async writeFile() {},
      },
    });

    await expect(failingStore.set("idlebit:save", "value")).rejects.toThrow(
      "permission denied",
    );
    await expect(failingStore.flush()).resolves.toBeUndefined();
  });

  it("removes individual keys and clears only a requested namespace", async () => {
    const store = createJsonPersistenceStore({ filePath });

    await store.set("idlebit:save", "save");
    await store.set("idlebit:ui", "preference");
    await store.set("other:save", "other");
    await store.remove("idlebit:save");

    await expect(store.get("idlebit:save")).resolves.toBeNull();
    await expect(store.get("idlebit:ui")).resolves.toBe("preference");

    await store.clear("idlebit:");

    await expect(store.get("idlebit:ui")).resolves.toBeNull();
    await expect(store.get("other:save")).resolves.toBe("other");
  });

  it("rejects invalid input and propagates filesystem failures", async () => {
    const store = createJsonPersistenceStore({ filePath });

    await expect(store.get("bad key")).rejects.toThrow(
      "Invalid IdleBit persistence key.",
    );
    await expect(store.set("idlebit:save", 42)).rejects.toThrow(
      "Invalid IdleBit persistence value.",
    );
    await expect(
      store.set("idlebit:save", "x".repeat(5 * 1024 * 1024 + 1)),
    ).rejects.toThrow("IdleBit persistence value is too large.");

    const failingStore = createJsonPersistenceStore({
      filePath,
      fileSystem: {
        async mkdir() {},
        async readFile() {
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        },
        async rename() {},
        async writeFile() {},
      },
    });

    await expect(failingStore.get("idlebit:save")).rejects.toThrow(
      "permission denied",
    );
  });
});
