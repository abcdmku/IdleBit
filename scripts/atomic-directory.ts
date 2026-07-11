import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

type Utf8Writer = (
  filename: string,
  contents: string,
  encoding: "utf8",
) => Promise<unknown>;

type DirectoryRenamer = (
  source: string,
  destination: string,
) => Promise<unknown>;

export interface AtomicDirectoryOptions {
  /** Test seam for proving that a partial write cannot damage canonical output. */
  writeFile?: Utf8Writer;
  /** Test seam for proving that a failed publication restores canonical output. */
  rename?: DirectoryRenamer;
  token?: string;
}

const exists = async (filename: string) => {
  try {
    await stat(filename);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

const safeBundlePath = (directory: string, filename: string) => {
  const resolved = path.resolve(directory, filename);
  if (
    resolved !== directory &&
    !resolved.startsWith(`${directory}${path.sep}`)
  ) {
    throw new Error(`Artifact filename escapes output directory: ${filename}`);
  }
  return resolved;
};

const validateBundle = async (
  directory: string,
  bundle: Readonly<Record<string, string>>,
) => {
  for (const [filename, expected] of Object.entries(bundle).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const actual = await readFile(safeBundlePath(directory, filename), "utf8");
    if (actual !== expected) {
      throw new Error(`Artifact validation failed after writing ${filename}.`);
    }
  }
};

/**
 * Builds and verifies a complete sibling directory before swapping it into
 * place. The existing canonical directory is never removed before the new
 * bundle is ready, and is restored if the final swap fails.
 */
export const replaceDirectoryAtomically = async (
  outputDirectoryInput: string,
  bundle: Readonly<Record<string, string>>,
  options: AtomicDirectoryOptions = {},
) => {
  const outputDirectory = path.resolve(outputDirectoryInput);
  const parentDirectory = path.dirname(outputDirectory);
  const outputName = path.basename(outputDirectory);
  const token = options.token ?? randomUUID();
  const temporaryDirectory = path.join(
    parentDirectory,
    `.${outputName}.tmp-${token}`,
  );
  const backupDirectory = path.join(
    parentDirectory,
    `.${outputName}.bak-${token}`,
  );
  const writer = options.writeFile ?? writeFile;
  const renamer = options.rename ?? rename;
  let canonicalMoved = false;
  let replacementInstalled = false;

  await mkdir(parentDirectory, { recursive: true });
  await mkdir(temporaryDirectory);
  try {
    for (const [filename, contents] of Object.entries(bundle).sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      const destination = safeBundlePath(temporaryDirectory, filename);
      await mkdir(path.dirname(destination), { recursive: true });
      await writer(destination, contents, "utf8");
    }
    await validateBundle(temporaryDirectory, bundle);

    if (await exists(outputDirectory)) {
      await renamer(outputDirectory, backupDirectory);
      canonicalMoved = true;
    }
    try {
      await renamer(temporaryDirectory, outputDirectory);
      replacementInstalled = true;
    } catch (swapError) {
      if (canonicalMoved) {
        await renamer(backupDirectory, outputDirectory);
        canonicalMoved = false;
      }
      throw swapError;
    }

    if (canonicalMoved) {
      await rm(backupDirectory, { recursive: true, force: true });
      canonicalMoved = false;
    }
  } finally {
    if (!replacementInstalled) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
    if (canonicalMoved && !(await exists(outputDirectory))) {
      await renamer(backupDirectory, outputDirectory);
      canonicalMoved = false;
    }
  }
};
