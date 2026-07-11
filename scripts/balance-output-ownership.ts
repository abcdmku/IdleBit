import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const BALANCE_DIAGNOSTIC_OWNERSHIP_MARKER =
  ".idlebit-balance-diagnostic-output";
export const BALANCE_DIAGNOSTIC_OWNERSHIP_CONTENT =
  "idlebit-balance-diagnostic-output:v1\n";

const isMissingPathError = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

/**
 * A noncanonical target is safe to initialize when absent/empty. Replacing a
 * nonempty target requires the exact regular-file marker emitted by this
 * generator on an earlier diagnostic publication.
 */
export const assertSafeBalanceDiagnosticOutput = async (
  outputDirectory: string,
) => {
  let entries: string[];
  try {
    entries = await readdir(outputDirectory);
  } catch (error) {
    if (isMissingPathError(error)) return;
    if ((error as NodeJS.ErrnoException).code === "ENOTDIR") {
      throw new Error(
        "Balance diagnostic output path exists but is not a directory.",
      );
    }
    throw error;
  }
  if (entries.length === 0) return;

  const markerPath = path.join(
    outputDirectory,
    BALANCE_DIAGNOSTIC_OWNERSHIP_MARKER,
  );
  let markerStat;
  try {
    markerStat = await lstat(markerPath);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error(
        "Refusing to replace an existing nonempty balance output directory without the IdleBit diagnostic ownership marker.",
      );
    }
    throw error;
  }
  if (!markerStat.isFile()) {
    throw new Error(
      "Balance diagnostic ownership marker must be a regular file with exact generator content.",
    );
  }
  const markerContent = await readFile(markerPath, "utf8");
  if (markerContent !== BALANCE_DIAGNOSTIC_OWNERSHIP_CONTENT) {
    throw new Error(
      "Balance diagnostic ownership marker content is invalid; refusing to replace the directory.",
    );
  }
};

/** Adds ownership only to noncanonical bundles; canonical CSV output is unchanged. */
export const withBalanceDiagnosticOwnership = (
  bundle: Readonly<Record<string, string>>,
  diagnosticOutput: boolean,
): Readonly<Record<string, string>> =>
  diagnosticOutput
    ? {
        ...bundle,
        [BALANCE_DIAGNOSTIC_OWNERSHIP_MARKER]:
          BALANCE_DIAGNOSTIC_OWNERSHIP_CONTENT,
      }
    : bundle;
