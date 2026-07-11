export interface BalanceGenerationOutputGuardInput {
  requestedProfileCount: number;
  requestedMonteCarloSeedCount: number;
  outputOverride: string | undefined;
  outputDirectoryIdentity: string;
  canonicalOutputDirectoryIdentity: string;
  workspaceDirectoryIdentity: string;
  outputFilesystemRootIdentity: string;
}

const isStrictAncestorIdentity = (ancestor: string, descendant: string) =>
  ancestor !== descendant &&
  descendant.startsWith(ancestor.endsWith("/") ? ancestor : `${ancestor}/`);

/** Prevent diagnostic subsets from replacing the canonical evidence bundle. */
export const assertSafeBalanceGenerationOutput = (
  input: BalanceGenerationOutputGuardInput,
) => {
  const customGeneration =
    input.requestedProfileCount > 0 ||
    input.requestedMonteCarloSeedCount > 0;
  if (customGeneration && !input.outputOverride?.trim()) {
    throw new Error(
      "Custom balance diagnostics require an explicit --output directory (or IDLEBIT_BALANCE_OUTPUT); canonical generated evidence is reserved for the default run.",
    );
  }
  if (input.outputDirectoryIdentity === input.outputFilesystemRootIdentity) {
    throw new Error(
      "Balance output directory cannot be a filesystem root.",
    );
  }
  if (input.outputDirectoryIdentity === input.workspaceDirectoryIdentity) {
    throw new Error(
      "Balance output directory cannot be the current workspace root.",
    );
  }
  if (
    isStrictAncestorIdentity(
      input.outputDirectoryIdentity,
      input.workspaceDirectoryIdentity,
    )
  ) {
    throw new Error(
      "Balance output directory cannot be an ancestor of the current workspace.",
    );
  }
  if (
    isStrictAncestorIdentity(
      input.outputDirectoryIdentity,
      input.canonicalOutputDirectoryIdentity,
    )
  ) {
    throw new Error(
      "Balance output directory cannot be an ancestor of the canonical generated-evidence directory.",
    );
  }
  if (
    customGeneration &&
    input.outputDirectoryIdentity === input.canonicalOutputDirectoryIdentity
  ) {
    throw new Error(
      "Custom balance diagnostics cannot replace the resolved canonical generated-evidence directory; choose a distinct --output directory.",
    );
  }
  return !customGeneration;
};
