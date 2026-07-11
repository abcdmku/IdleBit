import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export interface FilesystemPathIdentity {
  /** Lexically resolved path used for the actual write. */
  resolvedPath: string;
  /** Requested suffix joined to the real nearest existing ancestor. */
  canonicalPath: string;
  /** Stable comparison key, case-folded only on a case-insensitive filesystem. */
  identity: string;
  filesystemRootIdentity: string;
  caseInsensitive: boolean;
}

export interface FilesystemPathIdentityOptions {
  /** Test seam; production detects the nearest existing ancestor's behavior. */
  caseInsensitive?: boolean;
}

const isMissingPathError = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
};

const nearestExistingAncestor = async (resolvedPath: string) => {
  const suffix: string[] = [];
  let candidate = resolvedPath;
  while (true) {
    try {
      return {
        realAncestor: await realpath(candidate),
        suffix,
      };
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      suffix.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
};

const toggleLastAlphabeticCharacter = (filename: string) => {
  for (let index = filename.length - 1; index >= 0; index -= 1) {
    const character = filename[index]!;
    if (character >= "a" && character <= "z") {
      return `${filename.slice(0, index)}${character.toUpperCase()}${filename.slice(index + 1)}`;
    }
    if (character >= "A" && character <= "Z") {
      return `${filename.slice(0, index)}${character.toLowerCase()}${filename.slice(index + 1)}`;
    }
  }
  return null;
};

const sameFilesystemEntry = async (left: string, right: string) => {
  try {
    const [leftStat, rightStat] = await Promise.all([stat(left), stat(right)]);
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
};

const detectCaseInsensitiveFilesystem = async (existingPath: string) => {
  if (process.platform === "win32") return true;
  const caseAlias = toggleLastAlphabeticCharacter(existingPath);
  return caseAlias === null
    ? false
    : sameFilesystemEntry(existingPath, caseAlias);
};

const identityKey = (filename: string, caseInsensitive: boolean) => {
  const normalized = path.normalize(filename).replaceAll("\\", "/");
  const root = path.parse(path.normalize(filename)).root.replaceAll("\\", "/");
  const withoutTrailingSeparator =
    normalized.length > root.length
      ? normalized.replace(/\/+$/, "")
      : normalized;
  return caseInsensitive
    ? withoutTrailingSeparator.toLocaleLowerCase("en-US")
    : withoutTrailingSeparator;
};

/**
 * Resolves symlinks/junctions in the nearest existing ancestor and preserves a
 * possibly-not-yet-created suffix, yielding an identity safe for path guards.
 */
export const resolveFilesystemPathIdentity = async (
  inputPath: string,
  options: FilesystemPathIdentityOptions = {},
): Promise<FilesystemPathIdentity> => {
  const resolvedPath = path.resolve(inputPath);
  const { realAncestor, suffix } = await nearestExistingAncestor(resolvedPath);
  const canonicalPath = path.join(realAncestor, ...suffix);
  const caseInsensitive =
    options.caseInsensitive ??
    (await detectCaseInsensitiveFilesystem(realAncestor));
  return {
    resolvedPath,
    canonicalPath,
    identity: identityKey(canonicalPath, caseInsensitive),
    filesystemRootIdentity: identityKey(
      path.parse(canonicalPath).root,
      caseInsensitive,
    ),
    caseInsensitive,
  };
};
