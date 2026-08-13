import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  SAFE_CUSTODY_PROOF_SCHEMA,
  SAFE_AUTHORIZATION_SCHEMA,
  SAFE_PLAN_SCHEMA,
  assertAtomicProxyCreationLogs,
  assertProxyCreationLog,
  assertSafeCostReviewEnvelope,
  assertSafeCustodyProof,
  assertSafePolicyBoundPlan,
  assertSafePreflightEnvelope,
  assertSafeReviewedAuthorization,
  assertDistinctControllerOwners,
  assertSafeRuntimeState,
  computeSafeReviewedPlanDigest,
  predictSafeProxyAddress,
  safeAtomicBatchInput,
  safeInitializer,
  safeTransactionInput,
} from "../custom-registry-v2-safe-controller-guards.mjs";
import { encodeEventTopics, encodeAbiParameters, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AUTHORIZATION_SEMANTICS,
  FLASHBOTS_PRIVATE_SUBMISSION,
} from "../custom-registry-v2-deployment-guards.mjs";
import { verifySafeCustodyRoleReadbacks } from "../custom-registry-v2-keychain-custody.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
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
    rpcProviders: ["provider-a", "provider-b"],
    rpcProviderBindings: [
      { providerId: "provider-a", rpcOrigin: "https://rpc-a.example" },
      { providerId: "provider-b", rpcOrigin: "https://rpc-b.example" },
    ],
    signingAllowed: false,
    broadcastAllowed: false,
    fundingSufficient: true,
    createdAtTimestamp: 100,
    validitySeconds: 100,
    expiresAtTimestamp: 200,
    controllers: [{}, {}, {}, {}],
    policySha256: `0x${"22".repeat(32)}`,
    custodyProofSha256: `0x${"33".repeat(32)}`,
    source: { commit: "a", tree: "b" },
    releaseAuthorization: {
      owner: account.address,
      maximumDispatchIntentAuthorizationValiditySeconds: 300,
      authorizationSemantics: AUTHORIZATION_SEMANTICS,
      stagedRawTransactionTrustBoundary:
        "OWNER_ONLY_0400_CURRENT_USER_DARK_DEPLOYMENT_WORKFLOW_NOT_AN_ONCHAIN_OWNER_GATE",
      dispatchIntentFinalConfirmation:
        "EXPLICIT_EXACT_TRANSACTION_HASH_REQUIRED_IMMEDIATELY_BEFORE_DURABLE_ACTIVATION",
      nonceScopedJournalExclusivity:
        "ONE_CANONICAL_CHAIN_SIGNER_NONCE_JOURNAL_BLOCKS_CHANGED_TRANSACTION_UNTIL_NONCE_IS_CANONICALLY_CONSUMED",
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
    status: "REVIEWED_READY_FOR_EXPLICIT_DISPATCH_INTENT",
    signingAllowed: false,
    broadcastAllowed: false,
    dispatchIntentActivationAllowed: true,
    broadcastRequiresDurableDispatchIntent: true,
    preflightSha256,
    stagedTransactionSha256: `0x${"66".repeat(32)}`,
    authorizedTransactionHash: `0x${"77".repeat(32)}`,
    source: plan.source,
    policySha256: plan.policySha256,
    custodyProofSha256: plan.custodyProofSha256,
    ownerAuthorizationAddress: account.address,
    notBeforeTimestamp: 180,
    dispatchIntentExpiresAtTimestamp: 190,
    authorizationSemantics: AUTHORIZATION_SEMANTICS,
  };
  authorization.reviewedPlanDigest = computeSafeReviewedPlanDigest({
    preflightSha256,
    stagedTransactionSha256: authorization.stagedTransactionSha256,
    authorizedTransactionHash: authorization.authorizedTransactionHash,
    ownerAuthorizationAddress: account.address,
    notBeforeTimestamp: authorization.notBeforeTimestamp,
    dispatchIntentExpiresAtTimestamp:
      authorization.dispatchIntentExpiresAtTimestamp,
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

test("binds every Safe plan transaction to official policy and CREATE2 provenance", () => {
  const policyBytes = readFileSync(
    path.join(root, "config/custom-registry-v2-safe-controller-policy.json"),
  );
  const policy = JSON.parse(policyBytes);
  const policySha256 = `0x${createHash("sha256")
    .update(policyBytes)
    .digest("hex")}`;
  const roles = ["approver", "registrar", "finalizer", "revoker"];
  const accounts = Array.from({ length: 7 }, (_, index) =>
    privateKeyToAccount(
      `0x${(index + 1).toString(16).padStart(2, "0").repeat(32)}`,
    ),
  );
  const [deployer, admin, releaseOwner, ...owners] = accounts;
  const controllers = roles.map((role, index) => {
    const owner = owners[index].address;
    const saltNonce = String(101 + index);
    const initializer = safeInitializer(owner, policy.setup);
    return {
      role,
      owner,
      saltNonce,
      initializer,
      initializerKeccak256: keccak256(initializer),
      predictedAddress: predictSafeProxyAddress({
        factory: policy.proxyFactory.address,
        singleton: policy.singleton.address,
        proxyCreationCode: policy.proxyFactory.proxyCreationCode,
        initializer,
        saltNonce,
      }),
      atomicCall: {
        to: policy.proxyFactory.address,
        data: safeTransactionInput({
          singleton: policy.singleton.address,
          initializer,
          saltNonce,
        }),
        valueWei: "0",
      },
      predictedAddressNonces: [0, 0],
      predictedAddressBalancesWei: ["0", "0"],
    };
  });
  const manifest = {
    schemaVersion: "programmable.custom-registry-predeployment.v3",
    status: "SOURCE_ONLY_NOT_DEPLOYED",
    activationAllowed: false,
    sourceDigests: {
      "config/custom-registry-v2-safe-controller-policy.json": policySha256,
    },
    releaseAuthorization: {
      owner: releaseOwner.address,
      maximumDispatchIntentAuthorizationValiditySeconds: 300,
      authorizationSemantics: AUTHORIZATION_SEMANTICS,
      stagedRawTransactionTrustBoundary:
        "OWNER_ONLY_0400_CURRENT_USER_DARK_DEPLOYMENT_WORKFLOW_NOT_AN_ONCHAIN_OWNER_GATE",
      dispatchIntentFinalConfirmation:
        "EXPLICIT_EXACT_TRANSACTION_HASH_REQUIRED_IMMEDIATELY_BEFORE_DURABLE_ACTIVATION",
      nonceScopedJournalExclusivity:
        "ONE_CANONICAL_CHAIN_SIGNER_NONCE_JOURNAL_BLOCKS_CHANGED_TRANSACTION_UNTIL_NONCE_IS_CANONICALLY_CONSUMED",
    },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const sourceManifestSha256 = `0x${createHash("sha256")
    .update(manifestBytes)
    .digest("hex")}`;
  const custodyRoles = ["deployer", "admin", ...roles];
  const custodyAddresses = [
    deployer.address,
    admin.address,
    ...owners.map(({ address }) => address),
  ];
  const plan = {
    schemaVersion: SAFE_PLAN_SCHEMA,
    status: "PREFLIGHT_ONLY_NO_TRANSACTION",
    chainId: 1,
    rpcProviders: ["provider-a", "provider-b"],
    rpcProviderBindings: [
      { providerId: "provider-a", rpcOrigin: "https://rpc-a.example" },
      { providerId: "provider-b", rpcOrigin: "https://rpc-b.example" },
    ],
    source: { commit: "a".repeat(40), tree: "b".repeat(40) },
    sourceManifestSha256,
    policySha256,
    custodyProofSha256: `0x${"44".repeat(32)}`,
    predictionInputsSha256: `0x${"45".repeat(32)}`,
    privateSubmission: {
      ...FLASHBOTS_PRIVATE_SUBMISSION,
      providerContractSha256: `0x${"46".repeat(32)}`,
      noPublicFallback: true,
    },
    custody: {
      inventorySha256: `0x${"55".repeat(32)}`,
      roles: custodyRoles.map((role, index) => ({
        role,
        publicAddress: custodyAddresses[index],
        service: `programmable.custom-registry.v2.production-custody.20260813.${role}`,
        readbackSha256: `0x${(index + 10)
          .toString(16)
          .padStart(2, "0")
          .repeat(32)}`,
      })),
    },
    safeVersion: policy.safeVersion,
    singleton: policy.singleton,
    proxyFactory: policy.proxyFactory,
    multiSendCallOnly: policy.multiSendCallOnly,
    storageSlots: policy.storageSlots,
    commonFinalizedAnchor: {
      blockNumber: "1",
      blockHash: `0x${"66".repeat(32)}`,
    },
    deployer: deployer.address,
    admin: admin.address,
    releaseAuthorization: {
      owner: releaseOwner.address,
      maximumDispatchIntentAuthorizationValiditySeconds: 300,
      authorizationSemantics: AUTHORIZATION_SEMANTICS,
      stagedRawTransactionTrustBoundary:
        "OWNER_ONLY_0400_CURRENT_USER_DARK_DEPLOYMENT_WORKFLOW_NOT_AN_ONCHAIN_OWNER_GATE",
      dispatchIntentFinalConfirmation:
        "EXPLICIT_EXACT_TRANSACTION_HASH_REQUIRED_IMMEDIATELY_BEFORE_DURABLE_ACTIVATION",
      nonceScopedJournalExclusivity:
        "ONE_CANONICAL_CHAIN_SIGNER_NONCE_JOURNAL_BLOCKS_CHANGED_TRANSACTION_UNTIL_NONCE_IS_CANONICALLY_CONSUMED",
    },
    exactPendingNonce: 0,
    exactFinalizedNonce: 0,
    deployerBalanceWei: "2640000",
    controllers,
    atomicTransaction: {
      chainId: 1,
      from: deployer.address,
      to: policy.multiSendCallOnly.address,
      input: safeAtomicBatchInput(
        controllers.map(({ atomicCall }) => atomicCall),
      ),
      valueWei: "0",
      nonce: 0,
      gasLimit: "492000",
      maxFeePerGas: "5",
      maxPriorityFeePerGas: "1",
    },
    atomicInputKeccak256: keccak256(
      safeAtomicBatchInput(controllers.map(({ atomicCall }) => atomicCall)),
    ),
    atomicGasEstimates: ["400000", "410000"],
    totalGasLimit: "492000",
    observedFeePerGas: "4",
    reviewedMaxFeePerGas: "5",
    reviewedMaxTotalCostWei: "3000000",
    maximumTotalCostWei: "2460000",
    fundingSufficient: true,
    createdAtTimestamp: 100,
    validitySeconds: 100,
    expiresAtTimestamp: 200,
    signingAllowed: false,
    broadcastAllowed: false,
  };
  assertSafePolicyBoundPlan({
    plan,
    policy,
    manifest,
    sourceManifestSha256,
  });
  assert.throws(
    () =>
      assertSafePolicyBoundPlan({
        plan: {
          ...plan,
          controllers: plan.controllers.map((controller, index) =>
            index === 0
              ? { ...controller, predictedAddress: accounts[6].address }
              : controller,
          ),
        },
        policy,
        manifest,
        sourceManifestSha256,
      }),
    /transaction binding/u,
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
    schemaVersion: SAFE_CUSTODY_PROOF_SCHEMA,
    chainId: "1",
    keychain: "current-user-default-keychain",
    allReadbacksVerified: true,
    allEvmAddressesRecovered: true,
    roleIsolationBasis:
      "SIX_DISTINCT_GENERIC_PASSWORD_ITEMS_WITH_DISTINCT_PRIVATE_KEY_HASHES_AND_PUBLIC_ADDRESSES",
    secretValuesPrinted: false,
    inventorySha256: `0x${"99".repeat(32)}`,
    plaintextRetention: "NO_DURABLE_PLAINTEXT_FINAL_KEYS",
    restartReadbackVerified: true,
    encryptedBackupStrategyVerified: true,
    temporaryGovernance:
      "SAME_HOST_ONE_OF_ONE_DARK_DEPLOYMENT_ONLY_MIGRATE_TO_DISTINCT_HARDWARE_TWO_OF_THREE_BEFORE_PUBLIC_ACTIVATION",
    roles: roles.map((role, index) => ({
      role,
      publicAddress: addresses[index],
      recoveredPublicAddress: addresses[index],
      evmAddressRecoveryVerified: true,
      addressRecoveryBasis: "KEYCHAIN_READBACK_DERIVES_EXPECTED_EVM_ADDRESS",
      account: addresses[index],
      service: `programmable.custom-registry.v2.production-custody.20260813.${role}`,
      readbackSha256: `0x${(index + 1).toString(16).repeat(64)}`,
      readbackByteLength: 67,
      persistentRefSha256: `0x${(index + 7).toString(16).repeat(64)}`,
      sourcePrivateKeyFilePresent: false,
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
  assert.throws(
    () =>
      assertSafeCustodyProof({
        proof: {
          ...proof,
          roles: proof.roles.map((entry, index) =>
            index === 5
              ? {
                  ...entry,
                  readbackSha256: proof.roles[4].readbackSha256,
                  sourceKeyFileSha256: proof.roles[4].sourceKeyFileSha256,
                }
              : entry,
          ),
        },
        deployer: addresses[0],
        admin: addresses[1],
        owners: addresses.slice(2),
      }),
    /isolate/u,
  );
});

test("re-reads and derives all six production Keychain custody roles without printing secrets", async () => {
  const roles = [
    "deployer",
    "admin",
    "approver",
    "registrar",
    "finalizer",
    "revoker",
  ];
  const privateKeys = roles.map(
    (_, index) => `0x${(index + 1).toString(16).padStart(64, "0")}`,
  );
  const entries = privateKeys.map((privateKey, index) => {
    const bytes = Buffer.from(`${privateKey}\n`);
    return {
      role: roles[index],
      publicAddress: privateKeyToAccount(privateKey).address,
      service: `programmable.custom-registry.v2.production-custody.20260813.${roles[index]}`,
      readbackSha256: `0x${createHash("sha256").update(bytes).digest("hex")}`,
    };
  });
  const verified = await verifySafeCustodyRoleReadbacks({
    entries,
    readbackFunction: async ({ role }) =>
      Buffer.from(`${privateKeys[roles.indexOf(role)]}\n`),
  });
  assert.deepEqual(
    verified.map(({ role, publicAddress }) => ({ role, publicAddress })),
    entries.map(({ role, publicAddress }) => ({ role, publicAddress })),
  );
  await assert.rejects(
    verifySafeCustodyRoleReadbacks({
      entries,
      readbackFunction: async ({ role }) =>
        Buffer.from(
          `${privateKeys[role === "revoker" ? 4 : roles.indexOf(role)]}\n`,
        ),
    }),
    /revoker/u,
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

test("binds the exact ordered SafeSetup and ProxyCreation event pairs", () => {
  const factory = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
  const singleton = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
  const controllers = ["approver", "registrar", "finalizer", "revoker"].map(
    (role, index) => ({
      role,
      predictedAddress: `0x${(index + 11).toString(16).padStart(40, "0")}`,
      owner: `0x${(index + 21).toString(16).padStart(40, "0")}`,
    }),
  );
  const setupEvent = [
    {
      type: "event",
      name: "SafeSetup",
      inputs: [
        { indexed: true, name: "initiator", type: "address" },
        { indexed: false, name: "owners", type: "address[]" },
        { indexed: false, name: "threshold", type: "uint256" },
        { indexed: false, name: "initializer", type: "address" },
        { indexed: false, name: "fallbackHandler", type: "address" },
      ],
    },
  ];
  const creationEvent = [
    {
      type: "event",
      name: "ProxyCreation",
      inputs: [
        { indexed: true, name: "proxy", type: "address" },
        { indexed: false, name: "singleton", type: "address" },
      ],
    },
  ];
  const logs = controllers.flatMap((controller) => [
    {
      address: controller.predictedAddress,
      topics: encodeEventTopics({
        abi: setupEvent,
        eventName: "SafeSetup",
        args: { initiator: factory },
      }),
      data: encodeAbiParameters(
        [
          { type: "address[]" },
          { type: "uint256" },
          { type: "address" },
          { type: "address" },
        ],
        [[controller.owner], 1n, ZERO, ZERO],
      ),
    },
    {
      address: factory,
      topics: encodeEventTopics({
        abi: creationEvent,
        eventName: "ProxyCreation",
        args: { proxy: controller.predictedAddress },
      }),
      data: encodeAbiParameters([{ type: "address" }], [singleton]),
    },
  ]);

  assertAtomicProxyCreationLogs({ logs, factory, controllers, singleton });
  const reordered = [...logs];
  [reordered[0], reordered[2]] = [reordered[2], reordered[0]];
  assert.throws(
    () =>
      assertAtomicProxyCreationLogs({
        logs: reordered,
        factory,
        controllers,
        singleton,
      }),
    /differs from plan/u,
  );
  assert.throws(
    () =>
      assertAtomicProxyCreationLogs({
        logs: logs.slice(0, -1),
        factory,
        controllers,
        singleton,
      }),
    /exactly eight logs/u,
  );
});
