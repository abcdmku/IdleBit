import { describe, expect, it } from "vitest";

import {
  assertSafeBalanceGenerationOutput,
  type BalanceGenerationOutputGuardInput,
} from "./generatorGuard";

describe("balance generator output guard", () => {
  const canonical = "/workspace/idlebit/docs/balance/generated";
  const workspace = "/workspace/idlebit";
  const baseInput: BalanceGenerationOutputGuardInput = {
    requestedProfileCount: 0,
    requestedMonteCarloSeedCount: 0,
    outputOverride: undefined,
    outputDirectoryIdentity: canonical,
    canonicalOutputDirectoryIdentity: canonical,
    workspaceDirectoryIdentity: workspace,
    outputFilesystemRootIdentity: "/",
  };

  it("reserves the canonical directory for the default complete generation", () => {
    expect(assertSafeBalanceGenerationOutput(baseInput)).toBe(true);
  });

  it("requires an explicit output for profile or seed diagnostics", () => {
    expect(() =>
      assertSafeBalanceGenerationOutput({
        ...baseInput,
        requestedProfileCount: 1,
      }),
    ).toThrow(/explicit --output/);
    expect(
      assertSafeBalanceGenerationOutput({
        ...baseInput,
        requestedMonteCarloSeedCount: 1,
        outputOverride: "tmp/balance-diagnostic",
        outputDirectoryIdentity: `${workspace}/tmp/balance-diagnostic`,
      }),
    ).toBe(false);
  });

  it("rejects a custom run whose filesystem identity aliases canonical", () => {
    expect(() =>
      assertSafeBalanceGenerationOutput({
        ...baseInput,
        requestedProfileCount: 1,
        outputOverride: "canonical-alias",
      }),
    ).toThrow(/resolved canonical/);
  });

  it.each([
    {
      label: "filesystem root",
      outputDirectoryIdentity: "/",
      error: /filesystem root/,
    },
    {
      label: "--output=.",
      outputDirectoryIdentity: workspace,
      error: /current workspace root/,
    },
    {
      label: "workspace ancestor",
      outputDirectoryIdentity: "/workspace",
      error: /ancestor of the current workspace/,
    },
    {
      label: "canonical docs ancestor",
      outputDirectoryIdentity: `${workspace}/docs`,
      error: /ancestor of the canonical generated-evidence directory/,
    },
    {
      label: "canonical balance ancestor",
      outputDirectoryIdentity: `${workspace}/docs/balance`,
      error: /ancestor of the canonical generated-evidence directory/,
    },
  ])("rejects dangerous $label targets", ({ outputDirectoryIdentity, error }) => {
    expect(() =>
      assertSafeBalanceGenerationOutput({
        ...baseInput,
        outputOverride: outputDirectoryIdentity,
        outputDirectoryIdentity,
      }),
    ).toThrow(error);
  });
});
