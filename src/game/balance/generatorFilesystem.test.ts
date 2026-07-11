import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename as fsRename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { replaceDirectoryAtomically } from "../../../scripts/atomic-directory";
import {
  BALANCE_DIAGNOSTIC_OWNERSHIP_CONTENT,
  BALANCE_DIAGNOSTIC_OWNERSHIP_MARKER,
  assertSafeBalanceDiagnosticOutput,
  withBalanceDiagnosticOwnership,
} from "../../../scripts/balance-output-ownership";
import { resolveFilesystemPathIdentity } from "../../../scripts/filesystem-path-identity";
import { assertSafeBalanceGenerationOutput } from "./generatorGuard";

describe("balance generator filesystem publication", () => {
  it("rejects an existing nonempty directory without generator ownership", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "idlebit-balance-owner-"));
    const unowned = path.join(root, "unowned-source");
    try {
      await mkdir(unowned);
      await writeFile(path.join(unowned, "application.ts"), "source", "utf8");

      await expect(assertSafeBalanceDiagnosticOutput(unowned)).rejects.toThrow(
        /without the IdleBit diagnostic ownership marker/,
      );
      await expect(
        assertSafeBalanceDiagnosticOutput(path.resolve("src")),
      ).rejects.toThrow(/without the IdleBit diagnostic ownership marker/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts newly absent and existing empty diagnostic targets", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "idlebit-balance-owner-"));
    try {
      const absent = path.join(root, "absent");
      const empty = path.join(root, "empty");
      await mkdir(empty);

      await expect(
        assertSafeBalanceDiagnosticOutput(absent),
      ).resolves.toBeUndefined();
      await expect(
        assertSafeBalanceDiagnosticOutput(empty),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits exact ownership only for diagnostics and permits an owned rerun", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "idlebit-balance-owner-"));
    const diagnostic = path.join(root, "diagnostic");
    try {
      const csvBundle = { "evidence.csv": "first" };
      expect(withBalanceDiagnosticOwnership(csvBundle, false)).toBe(csvBundle);
      expect(
        withBalanceDiagnosticOwnership(csvBundle, false),
      ).not.toHaveProperty(BALANCE_DIAGNOSTIC_OWNERSHIP_MARKER);

      await replaceDirectoryAtomically(
        diagnostic,
        withBalanceDiagnosticOwnership(csvBundle, true),
        { token: "first-diagnostic" },
      );
      expect(
        await readFile(
          path.join(diagnostic, BALANCE_DIAGNOSTIC_OWNERSHIP_MARKER),
          "utf8",
        ),
      ).toBe(BALANCE_DIAGNOSTIC_OWNERSHIP_CONTENT);
      await expect(
        assertSafeBalanceDiagnosticOutput(diagnostic),
      ).resolves.toBeUndefined();

      await replaceDirectoryAtomically(
        diagnostic,
        withBalanceDiagnosticOwnership({ "evidence.csv": "second" }, true),
        { token: "second-diagnostic" },
      );
      expect(
        await readFile(path.join(diagnostic, "evidence.csv"), "utf8"),
      ).toBe("second");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a near-match ownership marker instead of trusting its filename", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "idlebit-balance-owner-"));
    const diagnostic = path.join(root, "diagnostic");
    try {
      await mkdir(diagnostic);
      await writeFile(
        path.join(diagnostic, BALANCE_DIAGNOSTIC_OWNERSHIP_MARKER),
        `${BALANCE_DIAGNOSTIC_OWNERSHIP_CONTENT}tampered`,
        "utf8",
      );

      await expect(
        assertSafeBalanceDiagnosticOutput(diagnostic),
      ).rejects.toThrow(/marker content is invalid/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves a not-yet-created output through a symlink or junction parent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "idlebit-balance-identity-"));
    try {
      const realParent = path.join(root, "real-parent");
      const aliasParent = path.join(root, "parent-alias");
      await mkdir(realParent);
      await symlink(
        realParent,
        aliasParent,
        process.platform === "win32" ? "junction" : "dir",
      );

      const [canonical, alias, workspace] = await Promise.all([
        resolveFilesystemPathIdentity(path.join(realParent, "generated")),
        resolveFilesystemPathIdentity(path.join(aliasParent, "generated")),
        resolveFilesystemPathIdentity(root),
      ]);
      expect(alias.identity).toBe(canonical.identity);
      expect(() =>
        assertSafeBalanceGenerationOutput({
          requestedProfileCount: 1,
          requestedMonteCarloSeedCount: 0,
          outputOverride: alias.resolvedPath,
          outputDirectoryIdentity: alias.identity,
          canonicalOutputDirectoryIdentity: canonical.identity,
          workspaceDirectoryIdentity: workspace.identity,
          outputFilesystemRootIdentity: alias.filesystemRootIdentity,
        }),
      ).toThrow(/resolved canonical/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("folds case aliases when the containing filesystem is case-insensitive", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "idlebit-balance-identity-"));
    try {
      await mkdir(path.join(root, "CaseParent"));
      const [canonical, caseAlias] = await Promise.all([
        resolveFilesystemPathIdentity(
          path.join(root, "CaseParent", "Generated"),
          { caseInsensitive: true },
        ),
        resolveFilesystemPathIdentity(
          path.join(root, "caseparent", "generated"),
          { caseInsensitive: true },
        ),
      ]);
      expect(caseAlias.identity).toBe(canonical.identity);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves canonical evidence and cleans staging after an injected write failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "idlebit-balance-atomic-"));
    const canonical = path.join(root, "generated");
    try {
      await mkdir(canonical);
      await writeFile(path.join(canonical, "marker.csv"), "old canonical", "utf8");
      let writeCount = 0;

      await expect(
        replaceDirectoryAtomically(
          canonical,
          { "a.csv": "new a", "b.csv": "new b" },
          {
            token: "injected-failure",
            writeFile: async (filename, contents, encoding) => {
              writeCount += 1;
              if (writeCount === 2) throw new Error("injected write failure");
              await writeFile(filename, contents, encoding);
            },
          },
        ),
      ).rejects.toThrow("injected write failure");

      expect(await readFile(path.join(canonical, "marker.csv"), "utf8")).toBe(
        "old canonical",
      );
      expect(await readdir(root)).toEqual(["generated"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("publishes a fully validated replacement without leaving siblings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "idlebit-balance-atomic-"));
    const canonical = path.join(root, "generated");
    try {
      await mkdir(canonical);
      await writeFile(path.join(canonical, "obsolete.csv"), "old", "utf8");

      await replaceDirectoryAtomically(
        canonical,
        { "a.csv": "new a", "nested/b.csv": "new b" },
        { token: "successful-swap" },
      );

      expect(await readFile(path.join(canonical, "a.csv"), "utf8")).toBe("new a");
      expect(await readFile(path.join(canonical, "nested/b.csv"), "utf8")).toBe(
        "new b",
      );
      expect(await readdir(root)).toEqual(["generated"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("restores canonical output and cleans siblings when the publication rename fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "idlebit-balance-atomic-"));
    const canonical = path.join(root, "generated");
    try {
      await mkdir(canonical);
      await writeFile(path.join(canonical, "marker.csv"), "old canonical", "utf8");
      let renameCount = 0;

      await expect(
        replaceDirectoryAtomically(
          canonical,
          { "replacement.csv": "new evidence" },
          {
            token: "failed-publication",
            rename: async (source, destination) => {
              renameCount += 1;
              if (renameCount === 2) {
                throw new Error("injected publication rename failure");
              }
              await fsRename(source, destination);
            },
          },
        ),
      ).rejects.toThrow("injected publication rename failure");

      expect(renameCount).toBe(3);
      expect(await readFile(path.join(canonical, "marker.csv"), "utf8")).toBe(
        "old canonical",
      );
      expect(await readdir(root)).toEqual(["generated"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
