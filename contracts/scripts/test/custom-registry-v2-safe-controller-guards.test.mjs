import assert from "node:assert/strict";
import test from "node:test";
import {
  SAFE_AUTHORIZATION_SCHEMA,
  SAFE_PLAN_SCHEMA,
  assertProxyCreationLog,
  assertSafeCostReviewEnvelope,
  assertSafeCustodyProof,
  assertSafePreflightEnvelope,
  assertSafeReviewedAuthorization,
  assertDistinctControllerOwners,
  assertSafeRuntimeState,
  computeSafeReviewedPlanDigest,
  predictSafeProxyAddress,
  safeInitializer,
  safeTransactionInput,
} from "../custom-registry-v2-safe-controller-guards.mjs";
import { encodeEventTopics, encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ZERO = "0x0000000000000000000000000000000000000000";
const setup = {
  threshold: 1,
  to: ZERO,
  data: "0x",
  fallbackHandler: ZERO,
  paymentToken: ZERO,
  payment: "0",
  paymentReceiver: ZERO,
};

test("predicts a stable owner-bound Safe CREATE2 address", () => {
  const owner = "0x1111111111111111111111111111111111111111";
  const initializer = safeInitializer(owner, setup);
  const input = {
    factory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
    proxyCreationCode: "0x6080604052600080fd",
    initializer,
    saltNonce: "1",
  };
  const first = predictSafeProxyAddress(input);
  assert.equal(first, predictSafeProxyAddress(input));
  assert.notEqual(first, predictSafeProxyAddress({ ...input, saltNonce: "2" }));
  assert.notEqual(
    first,
    predictSafeProxyAddress({
      ...input,
      initializer: safeInitializer(
        "0x2222222222222222222222222222222222222222",
        setup,
      ),
    }),
  );
});

test("requires isolated deployer, admin, release owner, and Safe owners", () => {
  const addresses = Array.from(
    { length: 7 },
    (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`,
  );
  assert.doesNotThrow(() =>
    assertDistinctControllerOwners({
      deployer: addresses[0],
      admin: addresses[1],
      releaseOwner: addresses[2],
      owners: addresses.slice(3),
    }),
  );
  assert.throws(
    () =>
      assertDistinctControllerOwners({
        deployer: addresses[0],
        admin: addresses[1],
        releaseOwner: addresses[2],
        owners: [addresses[3], addresses[3], addresses[5], addresses[6]],
      }),
    /must be distinct/u,
  );
});

test("requires one owner, threshold one, no modules, fallback, or guard", () => {
  const expected = {
    version: "1.4.1",
    singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
    owner: "0x1111111111111111111111111111111111111111",
  };
  const actual = {
    version: "1.4.1",
    masterCopy: expected.singleton,
    owners: [expected.owner],
    threshold: 1n,
    modules: [],
    nextModule: "0x0000000000000000000000000000000000000001",
    fallbackStorage: `0x${"0".repeat(64)}`,
    guardStorage: `0x${"0".repeat(64)}`,
  };
  assert.doesNotThrow(() => assertSafeRuntimeState({ actual, expected }));
  assert.throws(
    () =>
      assertSafeRuntimeState({
        actual: { ...actual, threshold: 2n },
        expected,
      }),
    /state is invalid/u,
  );
});

test("binds exact Safe transaction input, reviewed authorization, and cost-only state", () => {
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const input = safeTransactionInput({
    singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
    initializer: "0x1234",
    saltNonce: "5",
  });
  assert.match(input, /^0x1688f0b9/u);
  const plan = {
    schemaVersion: SAFE_PLAN_SCHEMA,
    status: "PREFLIGHT_ONLY_NO_TRANSACTION",
    chainId: 1,
    signingAllowed: false,
    broadcastAllowed: false,
    fundingSufficient: true,
    expiresAtTimestamp: 200,
    controllers: [{}, {}, {}, {}],
    policySha256: `0x${"22".repeat(32)}`,
    custodyProofSha256: `0x${"33".repeat(32)}`,
    source: { commit: "a", tree: "b" },
    releaseAuthorization: {
      owner: account.address,
      maximumValiditySeconds: 300,
    },
  };
  assertSafePreflightEnvelope(plan, 199);
  assert.throws(
    () =>
      assertSafePreflightEnvelope({ ...plan, expiresAtTimestamp: 198 }, 199),
    /preflight plan/u,
  );
  assertSafeCostReviewEnvelope({
    ...plan,
    status: "UNFUNDED_COST_REVIEW_ONLY",
    fundingSufficient: false,
  });
  const preflightSha256 = `0x${"44".repeat(32)}`;
  const authorization = {
    schemaVersion: SAFE_AUTHORIZATION_SCHEMA,
    status: "REVIEWED_READY_FOR_EXPLICIT_SAFE_BROADCAST",
    signingAllowed: true,
    broadcastAllowed: true,
    preflightSha256,
    source: plan.source,
    policySha256: plan.policySha256,
    custodyProofSha256: plan.custodyProofSha256,
    ownerAuthorizationAddress: account.address,
    expiresAtTimestamp: 190,
  };
  authorization.reviewedPlanDigest = computeSafeReviewedPlanDigest({
    preflightSha256,
    ownerAuthorizationAddress: account.address,
    expiresAtTimestamp: authorization.expiresAtTimestamp,
    sourceCommit: plan.source.commit,
    sourceTree: plan.source.tree,
    policySha256: plan.policySha256,
    custodyProofSha256: plan.custodyProofSha256,
  });
  assertSafeReviewedAuthorization({
    authorization,
    preflightSha256,
    plan,
    nowTimestamp: 180,
  });
  assert.throws(
    () =>
      assertSafeReviewedAuthorization({
        authorization: {
          ...authorization,
          policySha256: `0x${"55".repeat(32)}`,
        },
        preflightSha256,
        plan,
        nowTimestamp: 180,
      }),
    /authorization/u,
  );
});

test("binds per-role Keychain readback custody proof", () => {
  const roles = [
    "deployer",
    "admin",
    "approver",
    "registrar",
    "finalizer",
    "revoker",
  ];
  const addresses = roles.map(
    (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`,
  );
  addresses[1] = "0xd60858E400460aE6EDEe06504FC4eb7BB94d3De6";
  const proof = {
    schemaVersion: "programmable.custom-registry-v2-keychain-custody-proof.v1",
    chainId: "1",
    allReadbacksVerified: true,
    secretValuesPrinted: false,
    plaintextRetention:
      "0400_TEMP_ORIGINALS_PRESERVED_PENDING_EXPLICIT_RETENTION_DECISION",
    roles: roles.map((role, index) => ({
      role,
      publicAddress: addresses[index],
      account: addresses[index],
      service: `programmable.custom-registry.v2.production-custody.20260813.${role}`,
      sourceKeyFileSha256: `0x${(index + 1).toString(16).repeat(64)}`,
      readbackSha256: `0x${(index + 1).toString(16).repeat(64)}`,
      readbackByteLength: 67,
      accessibility: "when-unlocked-this-device-only",
      synchronizable: false,
      result: "IMPORTED_AND_READBACK_VERIFIED",
    })),
  };
  assertSafeCustodyProof({
    proof,
    deployer: addresses[0],
    admin: "0xd60858E400460aE6EDEe06504FC4eb7BB94d3De6",
    owners: addresses.slice(2),
  });
  assert.throws(
    () =>
      assertSafeCustodyProof({
        proof: {
          ...proof,
          roles: proof.roles.map((entry, index) =>
            index === 2 ? { ...entry, readbackByteLength: 66 } : entry,
          ),
        },
        deployer: addresses[0],
        admin: addresses[1],
        owners: addresses.slice(2),
      }),
    /approver/u,
  );
});

test("requires one exact factory ProxyCreation event", () => {
  const factory = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
  const proxy = "0x1111111111111111111111111111111111111111";
  const singleton = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
  const topics = encodeEventTopics({
    abi: [
      {
        type: "event",
        name: "ProxyCreation",
        inputs: [
          { indexed: true, name: "proxy", type: "address" },
          { indexed: false, name: "singleton", type: "address" },
        ],
      },
    ],
    eventName: "ProxyCreation",
    args: { proxy },
  });
  const logs = [
    {
      address: factory,
      topics,
      data: encodeAbiParameters([{ type: "address" }], [singleton]),
    },
  ];
  assertProxyCreationLog({ logs, factory, proxy, singleton });
  assert.throws(
    () => assertProxyCreationLog({ logs, factory, proxy, singleton: ZERO }),
    /does not match/u,
  );
});
