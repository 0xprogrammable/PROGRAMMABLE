import { describe, expect, it } from "vitest";

// @ts-expect-error Directly executable Node module has no declaration file.
import { canonicalSha256, createGenesisCanaryPublicIdentities } from "../scripts/serve-custom-registry-genesis-canary.mjs";

describe("Custom Registry genesis canary identities", () => {
  it("derives stable Projection V2 project and launch IDs", () => {
    const identities = createGenesisCanaryPublicIdentities({
      sourceCommit: "1".repeat(40),
      primaryContract: `0x${"2".repeat(40)}`,
    });

    expect(identities.grantBindingHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(identities.projectId).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(identities.launchId).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(identities.launchIdentity).toEqual({
      namespace: "eip155:1/contract",
      value: `0x${"2".repeat(40)}`,
    });
    expect(createGenesisCanaryPublicIdentities({
      sourceCommit: "1".repeat(40),
      primaryContract: `0x${"2".repeat(40)}`,
    })).toEqual(identities);
  });

  it("domain-separates canonical public bindings", () => {
    const value = { b: 2, a: 1 };
    expect(canonicalSha256("domain-a", value)).not.toBe(
      canonicalSha256("domain-b", value),
    );
    expect(canonicalSha256("domain-a", value)).toBe(
      canonicalSha256("domain-a", { a: 1, b: 2 }),
    );
  });
});
