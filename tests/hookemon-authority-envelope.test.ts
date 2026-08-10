import { describe, expect, it, vi } from "vitest";

import {
  HOOKEMON_ACTION_AUTHORITY_ENVELOPE_SCHEMA_V1,
  HOOKEMON_BROWSER_ACTION_SCHEMA_V1,
  canonicalHookemonAuthoritySha256V1,
  canonicalizeHookemonAuthorityJsonV1,
  computeHookemonActionAuthorityEnvelopeHashV1,
  computeHookemonActionSelectorHashV1,
  computeHookemonAuthorityActionHashV1,
  hookemonActionAuthoritySigningBytesV1,
  verifyHookemonActionAuthorityEnvelopeV1,
  type HookemonActionAuthorityEnvelopeCoreV1,
  type HookemonAuthorityBrowserActionCoreV1,
} from "../lib/custom-launch/hookemon-authority-envelope-v1";

const sha = (byte: number) =>
  `sha256:${byte.toString(16).padStart(2, "0").repeat(32)}` as const;
const bytes32 = (byte: number) =>
  `0x${byte.toString(16).padStart(2, "0").repeat(32)}` as const;

const bindingHash = sha(0x11);
const releaseHeadHash = sha(0x12);
const currentnessEvidenceHash = sha(0x13);
const authorityKeyId = "hookemon-action-authority-2026-08";
const signature = `ed25519:${"A".repeat(86)}` as const;

const actionCoreBase = Object.freeze({
  schemaVersion: HOOKEMON_BROWSER_ACTION_SCHEMA_V1,
  bindingHash,
  stateVersion: "7",
  actionIndex: 0,
  actionKind: "ERC20_APPROVAL",
  dataHash: bytes32(0x21),
  previousFinalityEvidenceHash: null,
  permitDigest: null,
  validAfterEpochSeconds: "1723300000",
  expiresAtEpochSeconds: "1723301800",
  currentness: Object.freeze({
    schemaVersion: "programmable.hookemon-dual-rpc-currentness.v1",
    currentnessEvidenceHash,
    observations: Object.freeze([
      Object.freeze({ providerIdentityHash: sha(0x31), pendingNonce: "0x8" }),
      Object.freeze({ providerIdentityHash: sha(0x32), pendingNonce: "0x8" }),
    ]),
  }),
  transaction: Object.freeze({
    method: "eth_sendTransaction",
    chainId: "0x1",
    from: "0x5e9a7a24dccc81cddd10b8a555300e227533c89f",
    to: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    nonce: "0x8",
    gas: "0x15f90",
    data: "0x095ea7b3",
    value: "0x0",
  }),
} as const);

function authorityFixture() {
  const selectorHash = computeHookemonActionSelectorHashV1({
    bindingHash: actionCoreBase.bindingHash,
    stateVersion: actionCoreBase.stateVersion,
    actionIndex: actionCoreBase.actionIndex,
    actionKind: actionCoreBase.actionKind,
    previousFinalityEvidenceHash: actionCoreBase.previousFinalityEvidenceHash,
    permitDigest: actionCoreBase.permitDigest,
    validAfterEpochSeconds: actionCoreBase.validAfterEpochSeconds,
    expiresAtEpochSeconds: actionCoreBase.expiresAtEpochSeconds,
    currentnessEvidenceHash,
  });
  const actionCore: HookemonAuthorityBrowserActionCoreV1 = Object.freeze({
    ...actionCoreBase,
    selectorHash,
  });
  const action = Object.freeze({
    ...actionCore,
    actionHash: computeHookemonAuthorityActionHashV1(actionCore),
  });
  const envelopeCore: HookemonActionAuthorityEnvelopeCoreV1 = Object.freeze({
    schemaVersion: HOOKEMON_ACTION_AUTHORITY_ENVELOPE_SCHEMA_V1,
    bindingHash,
    releaseHeadHash,
    revocationEpoch: "2",
    selectorHash: action.selectorHash,
    actionHash: action.actionHash,
    authorityKeyId,
    signatureAlgorithm: "ed25519",
  });
  const envelope = Object.freeze({
    ...envelopeCore,
    envelopeHash: computeHookemonActionAuthorityEnvelopeHashV1(envelopeCore),
    signature,
  });
  const expectedRelease = Object.freeze({
    bindingHash,
    releaseHeadHash,
    revocationEpoch: "2",
    authorityKeyId,
  });
  return { action, envelope, envelopeCore, expectedRelease };
}

describe("Hookemon browser Authority envelope", () => {
  it("uses deterministic JCS domain-separated hashes", () => {
    expect(canonicalizeHookemonAuthorityJsonV1({ z: 1, a: [true, null] }))
      .toBe('{"a":[true,null],"z":1}');
    expect(canonicalHookemonAuthoritySha256V1(
      "programmable.hookemon-action-selector.v1",
      { z: 1, a: [true, null] },
    )).toBe(
      "sha256:659507239a465c86f48d72fdf5ee558872fd91c9ba6daf60240d43a18be6ef86",
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalizeHookemonAuthorityJsonV1(cyclic)).toThrow(/cyclic/u);
    expect(() => canonicalizeHookemonAuthorityJsonV1("\ud800"))
      .toThrow(/lone high surrogate/u);
    expect(() => canonicalizeHookemonAuthorityJsonV1({ value: undefined }))
      .toThrow(/does not support undefined/u);
  });

  it("recomputes selector, full action, envelope and exact signing bytes", async () => {
    const fixture = authorityFixture();
    expect(fixture.action.selectorHash).toBe(
      "sha256:2cf4ad9ff274d61d3b0cbb6c4bae4f8ebf6d9eac591dc4697a89fab5eb118416",
    );
    expect(fixture.action.actionHash).toBe(
      "sha256:44a334672604fb0cb8c95c75051c8f5843a4327adf1128f4edd6586caf752e8a",
    );
    expect(fixture.envelope.envelopeHash).toBe(
      "sha256:b6a546d1b73b0d582865198d89eaa6e729f05bf20ff53cd7c971a00c97b38305",
    );
    const verifySignature = vi.fn((request: Readonly<{
      keyId: string;
      signingBytes: Uint8Array;
      signature: Uint8Array;
    }>) => {
      void request;
      return true;
    });
    const verified = await verifyHookemonActionAuthorityEnvelopeV1({
      action: fixture.action,
      envelope: fixture.envelope,
      expectedRelease: fixture.expectedRelease,
      verifySignature,
    });
    expect(verified).toEqual({
      action: fixture.action,
      envelope: fixture.envelope,
    });
    expect(verifySignature).toHaveBeenCalledOnce();
    const request = verifySignature.mock.calls[0]![0];
    expect(request.keyId).toBe(authorityKeyId);
    expect(request.signature).toHaveLength(64);
    expect(request.signingBytes).toEqual(
      hookemonActionAuthoritySigningBytesV1({
        ...fixture.envelopeCore,
        envelopeHash: fixture.envelope.envelopeHash,
      }),
    );
    expect(new TextDecoder().decode(request.signingBytes)).toContain(
      "programmable.hookemon-action-authority-envelope-signing.v1\u0000",
    );
  });

  it("rejects relabeling, transaction/currentness drift and release drift", async () => {
    const fixture = authorityFixture();
    const verifySignature = vi.fn(() => true);
    const mutations: unknown[] = [
      { ...fixture.action, actionKind: "EOA_CREATE" },
      { ...fixture.action, actionIndex: 1 },
      {
        ...fixture.action,
        transaction: { ...fixture.action.transaction, to: bytes32(0x44) },
      },
      {
        ...fixture.action,
        currentness: {
          ...fixture.action.currentness,
          currentnessEvidenceHash: sha(0x45),
        },
      },
      { ...fixture.action, selectorHash: sha(0x46) },
      { ...fixture.action, actionHash: sha(0x47) },
    ];
    for (const action of mutations) {
      await expect(verifyHookemonActionAuthorityEnvelopeV1({
        action,
        envelope: fixture.envelope,
        expectedRelease: fixture.expectedRelease,
        verifySignature,
      })).rejects.toThrow();
    }
    for (const [field, value] of Object.entries({
      bindingHash: sha(0x51),
      releaseHeadHash: sha(0x52),
      revocationEpoch: "3",
      authorityKeyId: "different-key",
    })) {
      await expect(verifyHookemonActionAuthorityEnvelopeV1({
        action: fixture.action,
        envelope: fixture.envelope,
        expectedRelease: { ...fixture.expectedRelease, [field]: value },
        verifySignature,
      }), field).rejects.toThrow(/exact release/u);
    }
    await expect(verifyHookemonActionAuthorityEnvelopeV1({
      action: fixture.action,
      envelope: fixture.envelope,
      expectedRelease: fixture.expectedRelease,
      verifySignature: () => false,
    })).rejects.toThrow(/signature is invalid/u);
  });

  it("rejects free envelope hashes, padded signatures and unexpected fields", async () => {
    const fixture = authorityFixture();
    const verifySignature = () => true;
    await expect(verifyHookemonActionAuthorityEnvelopeV1({
      action: fixture.action,
      envelope: { ...fixture.envelope, envelopeHash: sha(0x61) },
      expectedRelease: fixture.expectedRelease,
      verifySignature,
    })).rejects.toThrow(/exact release/u);
    await expect(verifyHookemonActionAuthorityEnvelopeV1({
      action: fixture.action,
      envelope: { ...fixture.envelope, signature: `${signature}=` },
      expectedRelease: fixture.expectedRelease,
      verifySignature,
    })).rejects.toThrow(/signature encoding/u);
    await expect(verifyHookemonActionAuthorityEnvelopeV1({
      action: { ...fixture.action, opaque: "accepted" },
      envelope: fixture.envelope,
      expectedRelease: fixture.expectedRelease,
      verifySignature,
    })).rejects.toThrow(/unexpected fields/u);
  });
});
