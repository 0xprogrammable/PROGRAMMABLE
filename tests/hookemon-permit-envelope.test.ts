import { describe, expect, it } from "vitest";

import {
  HOOKEMON_LAUNCH_PERMIT_TYPE_HASH_V1,
  HOOKEMON_PERMIT_ENVELOPE_BYTES_V1,
  HOOKEMON_PERMIT_ENVELOPE_TYPE_HASH_V1,
  assertHookemonLaunchPermitV1,
  assertHookemonPermitEnvelopeReleaseV1,
  assertHookemonPermitEnvelopeTypeHashesV1,
  computeHookemonPermitDigestV1,
  decodeHookemonPermitEnvelopeV1,
  encodeHookemonPermitEnvelopeV1,
  type HookemonLaunchPermitV1,
  type HookemonPermitEnvelopeExpectedReleaseV1,
  type HookemonPermitSignatureV1,
} from "../lib/custom-launch/hookemon-permit-envelope-v1";

const bytes32 = (byte: number) =>
  `0x${byte.toString(16).padStart(2, "0").repeat(32)}` as const;

const permit = Object.freeze({
  chainId: "1",
  router: "0x1111111111111111111111111111111111111111",
  launchWallet: "0x5e9a7a24dccc81cddd10b8a555300e227533c89f",
  profileKey: bytes32(0x22),
  architectureIdHash: bytes32(0x33),
  sourceLaunchPlanHash: bytes32(0x44),
  adoptionPlanHash: bytes32(0x55),
  architectureResultHash: bytes32(0x66),
  currentArchitectureStateHash: bytes32(0x77),
  stampRequestHash: bytes32(0x88),
  nonce: bytes32(0x99),
  validAfter: "1723300000",
  deadline: "1723301800",
  value: "0",
} as const satisfies HookemonLaunchPermitV1);

const signature = Object.freeze({
  r: bytes32(0x11),
  s: bytes32(0x22),
  v: 27,
} as const satisfies HookemonPermitSignatureV1);

describe("Hookemon typed permit envelope", () => {
  it("pins the two type hashes and exact static 576-byte encoding", () => {
    expect(() => assertHookemonPermitEnvelopeTypeHashesV1()).not.toThrow();
    expect(HOOKEMON_PERMIT_ENVELOPE_TYPE_HASH_V1).toBe(
      "0x76aee0e3ca5251fb636fbe95fc3c44609c3fa524a51d0054aab916ec752319d0",
    );
    expect(HOOKEMON_LAUNCH_PERMIT_TYPE_HASH_V1).toBe(
      "0x9bbf58469f9b0d79df750050233f3adb8e1c7f52e505a731334edd22f0025226",
    );
    const envelope = encodeHookemonPermitEnvelopeV1(permit, signature);
    expect((envelope.length - 2) / 2).toBe(HOOKEMON_PERMIT_ENVELOPE_BYTES_V1);
    expect(envelope.slice(0, 66)).toBe(HOOKEMON_PERMIT_ENVELOPE_TYPE_HASH_V1);
    expect(computeHookemonPermitDigestV1(permit)).toBe(
      "0x14b306e4d9837eb980aff1e379e687feb5659ed8a994454788b4101b83bac4e1",
    );
    expect(decodeHookemonPermitEnvelopeV1(envelope)).toEqual({
      permit,
      signature,
      permitDigest: computeHookemonPermitDigestV1(permit),
      envelopeHash: expect.stringMatching(/^0x[0-9a-f]{64}$/u),
    });
  });

  it("recomputes the EIP-712 digest and binds every release field and time", () => {
    const envelope = encodeHookemonPermitEnvelopeV1(permit, signature);
    const expected = expectedRelease(permit);
    expect(assertHookemonPermitEnvelopeReleaseV1({
      envelope,
      expected,
      currentEpochSeconds: "1723300000",
    }).permitDigest).toBe(expected.permitDigest);

    for (const [field, value] of Object.entries({
      router: "0x2222222222222222222222222222222222222222",
      launchWallet: "0x3333333333333333333333333333333333333333",
      profileKey: bytes32(0xa1),
      architectureIdHash: bytes32(0xa2),
      sourceLaunchPlanHash: bytes32(0xa3),
      adoptionPlanHash: bytes32(0xa4),
      architectureResultHash: bytes32(0xa5),
      currentArchitectureStateHash: bytes32(0xa6),
      stampRequestHash: bytes32(0xa7),
      nonce: bytes32(0xa8),
      permitDigest: bytes32(0xa9),
      validAfterEpochSeconds: "1723300001",
      expiresAtEpochSeconds: "1723301799",
    })) {
      expect(() => assertHookemonPermitEnvelopeReleaseV1({
        envelope,
        expected: { ...expected, [field]: value },
        currentEpochSeconds: "1723300000",
      }), field).toThrow(/exact current release/u);
    }
    expect(() => assertHookemonPermitEnvelopeReleaseV1({
      envelope,
      expected,
      currentEpochSeconds: "1723299999",
    })).toThrow(/exact current release/u);
    expect(() => assertHookemonPermitEnvelopeReleaseV1({
      envelope,
      expected,
      currentEpochSeconds: permit.deadline,
    })).toThrow(/exact current release/u);
  });

  it("rejects noncanonical ABI words, tags, signatures and windows", () => {
    const envelope = encodeHookemonPermitEnvelopeV1(permit, signature);
    const replaceWord = (index: number, word: string) =>
      `${envelope.slice(0, 2 + index * 64)}${word}${
        envelope.slice(2 + (index + 1) * 64)
      }`;
    expect(() => decodeHookemonPermitEnvelopeV1(
      replaceWord(0, bytes32(0xaa).slice(2)),
    )).toThrow(/tag drifted/u);
    expect(() => decodeHookemonPermitEnvelopeV1(
      replaceWord(2, `${"01".repeat(12)}${permit.router.slice(2)}`),
    )).toThrow(/address word is non-canonical/u);
    expect(() => decodeHookemonPermitEnvelopeV1(
      replaceWord(12, "01".padEnd(64, "0")),
    )).toThrow(/uint64 word overflowed/u);
    expect(() => decodeHookemonPermitEnvelopeV1(envelope.toUpperCase()))
      .toThrow(/encoding is invalid/u);
    expect(() => encodeHookemonPermitEnvelopeV1(permit, {
      ...signature,
      r: `0x${"f".repeat(64)}`,
    })).toThrow(/non-canonical/u);
    expect(() => encodeHookemonPermitEnvelopeV1(permit, {
      ...signature,
      s: `0x${"f".repeat(64)}`,
    })).toThrow(/non-canonical/u);
    expect(() => encodeHookemonPermitEnvelopeV1(permit, {
      ...signature,
      v: 29 as 27,
    })).toThrow(/non-canonical/u);
    expect(() => assertHookemonLaunchPermitV1({
      ...permit,
      deadline: (BigInt(permit.validAfter) + 3_601n).toString(),
    })).toThrow(/Mainnet zero-value policy/u);
  });
});

function expectedRelease(
  value: HookemonLaunchPermitV1,
): HookemonPermitEnvelopeExpectedReleaseV1 {
  return Object.freeze({
    router: value.router,
    launchWallet: value.launchWallet,
    profileKey: value.profileKey,
    architectureIdHash: value.architectureIdHash,
    sourceLaunchPlanHash: value.sourceLaunchPlanHash,
    adoptionPlanHash: value.adoptionPlanHash,
    architectureResultHash: value.architectureResultHash,
    currentArchitectureStateHash: value.currentArchitectureStateHash,
    stampRequestHash: value.stampRequestHash,
    nonce: value.nonce,
    permitDigest: computeHookemonPermitDigestV1(value),
    validAfterEpochSeconds: value.validAfter,
    expiresAtEpochSeconds: value.deadline,
  });
}
