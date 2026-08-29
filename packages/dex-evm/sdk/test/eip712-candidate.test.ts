import assert from "node:assert/strict";
import test from "node:test";

import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  EIP712_CANDIDATE_STATUS,
  ProgrammableSdkError,
  UNFROZEN_AUTHORIZATION_CANDIDATE_DESCRIPTOR,
  buildUnfrozenAuthorizationCandidateTypedData,
  hashUnfrozenAuthorizationCandidate,
  sha256IdentifierToBytes32,
  verifyUnfrozenCandidateEoaAuthorization,
  type Bytes32,
  type UnfrozenAuthorizationCandidateInput,
} from "../src/index.js";

const bytes32 = (byte: string): Bytes32 => `0x${byte.repeat(64 / byte.length)}` as Bytes32;

function changingGetProxy<T extends object>(target: T) {
  const descriptorReads = new Map<PropertyKey, number>();
  const getReads = new Map<PropertyKey, number>();
  const proxy = new Proxy(target, {
    get(current, key, receiver) {
      const reads = (getReads.get(key) ?? 0) + 1;
      getReads.set(key, reads);
      return reads === 1 ? Reflect.get(current, key, receiver) : undefined;
    },
    getOwnPropertyDescriptor(current, key) {
      descriptorReads.set(key, (descriptorReads.get(key) ?? 0) + 1);
      return Reflect.getOwnPropertyDescriptor(current, key);
    },
  });
  return { proxy, descriptorReads, getReads };
}

function assertOwnDescriptorsReadOnce(
  target: object,
  trace: ReturnType<typeof changingGetProxy>,
): void {
  const keys = Reflect.ownKeys(target);
  assert.equal(trace.descriptorReads.size, keys.length);
  for (const key of keys) assert.equal(trace.descriptorReads.get(key), 1, String(key));
  assert.equal(trace.getReads.size, 0);
}

const sdkError = (code: string) =>
  (error: unknown): boolean => error instanceof ProgrammableSdkError && error.code === code;

function baseline(
  principal: Address = "0x1111111111111111111111111111111111111111",
): UnfrozenAuthorizationCandidateInput {
  return {
    chainId: 46630,
    coreAddress: "0x2222222222222222222222222222222222222222",
    coreMajor: 1,
    constitutionId: bytes32("01"),
    marketId: bytes32("02"),
    effectiveEngineRevisionId: bytes32("03"),
    domainRevisionIdsHash: bytes32("04"),
    portableAuthorizationScopeId: bytes32("05"),
    principal,
    nonce: 6n,
    replayProtectionCommitment: bytes32("07"),
    fillStateCommitment: bytes32("08"),
    cancellationPolicyCommitment: bytes32("09"),
    expiry: 10n,
    replacementCommitment: bytes32("0b"),
    assetsCommitment: bytes32("0c"),
    assetProfilesCommitment: bytes32("0d"),
    exactSourcesCommitment: bytes32("0e"),
    recipientsOrPredicatesCommitment: bytes32("0f"),
    maximumEngineFundedGrossDebit: 16n,
    maximumProtocolAssessmentDebit: 17n,
    maximumTotalGrossDebit: 33n,
    maximumExternalWithholding: 18n,
    minimumSpendableCreditsCommitment: bytes32("13"),
    actionPayloadDigest: bytes32("14"),
    partialFillPolicyCommitment: bytes32("15"),
    sponsorAuthorizationCommitment: bytes32("16"),
    capabilityGrammarCommitment: bytes32("17"),
    refundGrammarCommitment: bytes32("18"),
  };
}

function mutateAuthorityField(
  input: UnfrozenAuthorizationCandidateInput,
  field: keyof UnfrozenAuthorizationCandidateInput,
): UnfrozenAuthorizationCandidateInput {
  const value = input[field];
  let replacement: unknown;
  if (typeof value === "bigint") replacement = value + 1n;
  else if (typeof value === "number") replacement = value + 1;
  else if (field === "coreAddress" || field === "principal") {
    replacement = "0xfefefefefefefefefefefefefefefefefefefefe";
  } else {
    replacement = bytes32("fe");
  }
  return { ...input, [field]: replacement } as UnfrozenAuthorizationCandidateInput;
}

test("candidate descriptor is explicitly UNFROZEN and not a portable Scope algorithm", () => {
  const typedData = buildUnfrozenAuthorizationCandidateTypedData(baseline());
  assert.equal(UNFROZEN_AUTHORIZATION_CANDIDATE_DESCRIPTOR.status, EIP712_CANDIDATE_STATUS);
  assert.deepEqual(UNFROZEN_AUTHORIZATION_CANDIDATE_DESCRIPTOR.blockers, [
    "portable-capability-grammar",
    "portable-refund-grammar",
    "SPEC-GAP-011",
  ]);
  assert.match(
    typedData.domain.version,
    /candidate-unfrozen$/,
  );
  assert.equal(Object.isFrozen(typedData), true);
  assert.equal(Object.isFrozen(typedData.domain), true);
  assert.equal(Object.isFrozen(typedData.message), true);
  assert.equal(Object.isFrozen(UNFROZEN_AUTHORIZATION_CANDIDATE_DESCRIPTOR), true);
  assert.equal(Object.isFrozen(UNFROZEN_AUTHORIZATION_CANDIDATE_DESCRIPTOR.blockers), true);
  assert.equal(Object.isFrozen(UNFROZEN_AUTHORIZATION_CANDIDATE_DESCRIPTOR.types), true);
  assert.equal(
    Object.isFrozen(
      UNFROZEN_AUTHORIZATION_CANDIDATE_DESCRIPTOR.types.ProgrammableAuthorizationCandidateV1,
    ),
    true,
  );
  assert.equal(
    Object.isFrozen(
      UNFROZEN_AUTHORIZATION_CANDIDATE_DESCRIPTOR.types.ProgrammableAuthorizationCandidateV1[0],
    ),
    true,
  );
  assert.throws(() => {
    (UNFROZEN_AUTHORIZATION_CANDIDATE_DESCRIPTOR.blockers as unknown as string[]).pop();
  }, TypeError);
  assert.deepEqual(UNFROZEN_AUTHORIZATION_CANDIDATE_DESCRIPTOR.blockers, [
    "portable-capability-grammar",
    "portable-refund-grammar",
    "SPEC-GAP-011",
  ]);
});

test("candidate build and verification reject accessors without invoking them", async () => {
  let buildReads = 0;
  const buildInput = { ...baseline() } as Record<string, unknown>;
  Object.defineProperty(buildInput, "nonce", {
    enumerable: true,
    get: () => {
      buildReads += 1;
      return buildReads === 1 ? 6n : 7n;
    },
  });
  assert.throws(
    () =>
      buildUnfrozenAuthorizationCandidateTypedData(
        buildInput as unknown as UnfrozenAuthorizationCandidateInput,
      ),
    sdkError("SDK_INPUT_ACCESSOR_REJECTED"),
  );
  assert.equal(buildReads, 0);

  const signer = privateKeyToAccount(generatePrivateKey());
  const authorization = baseline(signer.address);
  const signature = await signer.signTypedData(
    buildUnfrozenAuthorizationCandidateTypedData(authorization),
  );
  let requestReads = 0;
  const request = { authorization, expectedPrincipal: signer.address, signature } as Record<
    string,
    unknown
  >;
  Object.defineProperty(request, "authorization", {
    enumerable: true,
    get: () => {
      requestReads += 1;
      return authorization;
    },
  });
  await assert.rejects(
    () =>
      verifyUnfrozenCandidateEoaAuthorization(
        request as unknown as Parameters<typeof verifyUnfrozenCandidateEoaAuthorization>[0],
      ),
    sdkError("SDK_INPUT_ACCESSOR_REJECTED"),
  );
  assert.equal(requestReads, 0);

  let authorizationReads = 0;
  const nestedAuthorization = { ...authorization } as Record<string, unknown>;
  Object.defineProperty(nestedAuthorization, "principal", {
    enumerable: true,
    get: () => {
      authorizationReads += 1;
      return signer.address;
    },
  });
  assert.equal(
    await verifyUnfrozenCandidateEoaAuthorization({
      authorization: nestedAuthorization as unknown as UnfrozenAuthorizationCandidateInput,
      expectedPrincipal: signer.address,
      signature,
    }),
    false,
  );
  assert.equal(authorizationReads, 0);
});

test("candidate build and verification snapshot Proxy descriptors exactly once", async () => {
  const buildTarget = baseline();
  const buildTrace = changingGetProxy(buildTarget);
  assert.deepEqual(
    buildUnfrozenAuthorizationCandidateTypedData(buildTrace.proxy),
    buildUnfrozenAuthorizationCandidateTypedData(buildTarget),
  );
  assertOwnDescriptorsReadOnce(buildTarget, buildTrace);

  const signer = privateKeyToAccount(generatePrivateKey());
  const authorizationTarget = baseline(signer.address);
  const signature = await signer.signTypedData(
    buildUnfrozenAuthorizationCandidateTypedData(authorizationTarget),
  );
  const authorizationTrace = changingGetProxy(authorizationTarget);
  const requestTarget = {
    authorization: authorizationTrace.proxy,
    expectedPrincipal: signer.address,
    signature,
  };
  const requestTrace = changingGetProxy(requestTarget);
  assert.equal(await verifyUnfrozenCandidateEoaAuthorization(requestTrace.proxy), true);
  assertOwnDescriptorsReadOnce(requestTarget, requestTrace);
  assertOwnDescriptorsReadOnce(authorizationTarget, authorizationTrace);
});

test("portable SHA-256 conversion requires the exact identifier form", () => {
  const digest = "a".repeat(64);
  assert.equal(sha256IdentifierToBytes32(`sha256:${digest}`), `0x${digest}`);
  for (const malformed of [
    `garbage:${digest}`,
    `SHA256:${digest}`,
    `sha256:${digest.toUpperCase()}`,
    `sha256:${digest.slice(1)}`,
  ]) {
    assert.throws(
      () => sha256IdentifierToBytes32(malformed as `sha256:${string}`),
      /exact lowercase/,
    );
  }
});

test("every candidate authority field changes the EIP-712 digest", () => {
  const authorization = baseline();
  const digest = hashUnfrozenAuthorizationCandidate(authorization);
  const fields = Object.keys(authorization) as (keyof UnfrozenAuthorizationCandidateInput)[];
  assert.equal(fields.length, 29);
  for (const field of fields) {
    assert.notEqual(hashUnfrozenAuthorizationCandidate(mutateAuthorityField(authorization, field)), digest, field);
  }
});

test("candidate EOA verifier binds recovered signer to the message Principal", async () => {
  const signer = privateKeyToAccount(generatePrivateKey());
  const authorization = baseline(signer.address);
  const signature = await signer.signTypedData(buildUnfrozenAuthorizationCandidateTypedData(authorization));
  assert.equal(
    await verifyUnfrozenCandidateEoaAuthorization({
      authorization,
      expectedPrincipal: signer.address,
      signature,
    }),
    true,
  );
  assert.equal(
    await verifyUnfrozenCandidateEoaAuthorization({
      authorization: { ...authorization, principal: "0xfefefefefefefefefefefefefefefefefefefefe" },
      expectedPrincipal: signer.address,
      signature,
    }),
    false,
  );

  const curveOrder =
    0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const originalS = BigInt(`0x${signature.slice(66, 130)}`);
  const originalV = Number.parseInt(signature.slice(130, 132), 16);
  const highS = (curveOrder - originalS).toString(16).padStart(64, "0");
  const highV = (originalV === 27 ? 28 : 27).toString(16).padStart(2, "0");
  const highSignature = `0x${signature.slice(2, 66)}${highS}${highV}` as Hex;
  assert.equal(
    await verifyUnfrozenCandidateEoaAuthorization({
      authorization,
      expectedPrincipal: signer.address,
      signature: highSignature,
    }),
    false,
  );
  assert.equal(
    await verifyUnfrozenCandidateEoaAuthorization({
      authorization,
      expectedPrincipal: signer.address,
      signature: signature.slice(0, -2) as Hex,
    }),
    false,
  );
  assert.equal(
    await verifyUnfrozenCandidateEoaAuthorization({
      authorization,
      expectedPrincipal: signer.address,
      signature: `${signature.slice(0, -2)}00` as Hex,
    }),
    false,
  );
  assert.equal(
    await verifyUnfrozenCandidateEoaAuthorization({
      authorization,
      expectedPrincipal: signer.address,
      signature: `0x${signature.slice(2, 66)}${"00".repeat(32)}${signature.slice(130, 132)}` as Hex,
    }),
    false,
  );
  assert.equal(
    await verifyUnfrozenCandidateEoaAuthorization({
      authorization,
      expectedPrincipal: signer.address,
      signature: `0x${"zz".repeat(65)}` as Hex,
    }),
    false,
  );
});

test("candidate uint128 maximum is accepted and maximum plus one is rejected", () => {
  assert.throws(
    () =>
      buildUnfrozenAuthorizationCandidateTypedData({
        ...baseline(),
        nonce: 6 as unknown as bigint,
      }),
    /nonce/,
  );
  const maximum = (1n << 128n) - 1n;
  assert.doesNotThrow(() =>
    buildUnfrozenAuthorizationCandidateTypedData({
      ...baseline(),
      maximumEngineFundedGrossDebit: maximum,
    }),
  );
  assert.throws(
    () =>
      buildUnfrozenAuthorizationCandidateTypedData({
        ...baseline(),
        maximumEngineFundedGrossDebit: maximum + 1n,
      }),
    /maximumEngineFundedGrossDebit/,
  );
  assert.throws(
    () =>
      buildUnfrozenAuthorizationCandidateTypedData({
        ...baseline(),
        constitutionId: `0x${"a".repeat(63)}` as Bytes32,
      }),
    /constitutionId/,
  );

  const uint64Maximum = (1n << 64n) - 1n;
  assert.doesNotThrow(() =>
    buildUnfrozenAuthorizationCandidateTypedData({ ...baseline(), expiry: uint64Maximum }),
  );
  assert.throws(
    () => buildUnfrozenAuthorizationCandidateTypedData({ ...baseline(), expiry: uint64Maximum + 1n }),
    /expiry/,
  );

  const uint256Maximum = (1n << 256n) - 1n;
  assert.doesNotThrow(() =>
    buildUnfrozenAuthorizationCandidateTypedData({ ...baseline(), nonce: uint256Maximum }),
  );
  assert.throws(
    () => buildUnfrozenAuthorizationCandidateTypedData({ ...baseline(), nonce: uint256Maximum + 1n }),
    /nonce/,
  );

  assert.doesNotThrow(() =>
    buildUnfrozenAuthorizationCandidateTypedData({ ...baseline(), coreMajor: 0xffff_ffff }),
  );
  assert.throws(
    () => buildUnfrozenAuthorizationCandidateTypedData({ ...baseline(), coreMajor: 0x1_0000_0000 }),
    /coreMajor/,
  );
});
