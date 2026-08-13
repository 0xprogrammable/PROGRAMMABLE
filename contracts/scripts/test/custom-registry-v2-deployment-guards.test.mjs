import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { decodeAbiParameters, encodeAbiParameters, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  REGISTRY_AUTHORIZATION_SCHEMA,
  AUTHORIZATION_SEMANTICS,
  REGISTRY_PREFLIGHT_SCHEMA,
  REGISTRY_SOURCE_VERIFICATION_SCHEMA,
  REGISTRY_VERIFICATION_SCHEMA,
  ZERO_ADDRESS,
  assessDeploymentCost,
  assertSettledDeployerNonce,
  assertArtifactBinding,
  assertDispatchAuthorizationWindow,
  assertDeployerBinding,
  assertExpectedDeploymentTransaction,
  assertFinalizedDeploymentTransaction,
  assertFinalizedReceiptAfterDispatchIntent,
  assertFinalizedAnchor,
  assertLiveBinding,
  assertPostDeploymentBinding,
  assertPreflightEnvelope,
  assertPredictedAddressUnoccupied,
  assertReviewedAuthorization,
  assertSourceBinding,
  assertSourceVerificationBinding,
  computeConstructorCommitment,
  computeReviewedPlanDigest,
  createRpcProviderBinding,
  createRpcProviderBindings,
  assertRpcProviderBindings,
  reviewedAuthorizationMessage,
  requireDistinctRpcOrigins,
  verifyReviewedAuthorizationSignature,
} from "../custom-registry-v2-deployment-guards.mjs";

test("requires genuinely distinct RPC origins", () => {
  assert.throws(
    () =>
      requireDistinctRpcOrigins(
        "https://rpc.example/a",
        "https://rpc.example/b",
      ),
    /origins must be distinct/,
  );
  assert.deepEqual(
    requireDistinctRpcOrigins(
      "https://rpc-a.example/path",
      "https://rpc-b.example/path",
    ),
    ["https://rpc-a.example", "https://rpc-b.example"],
  );
});

test("blocks a new release while the deployer has an unfinalized nonce", () => {
  assert.equal(
    assertSettledDeployerNonce({
      pendingNonces: [7, 7],
      finalizedNonces: [7, 7],
    }),
    7,
  );
  assert.throws(
    () =>
      assertSettledDeployerNonce({
        pendingNonces: [8, 8],
        finalizedNonces: [7, 7],
      }),
    /not settled/u,
  );
});

test("finalized inclusion must follow the complete trusted dispatch-intent interval", () => {
  const dispatchIntentTrustedTime = {
    adjustedTimeMilliseconds: 188_000,
    uncertaintyMilliseconds: 999,
  };
  assert.throws(
    () =>
      assertFinalizedReceiptAfterDispatchIntent({
        receiptBlockTimestamp: 188n,
        dispatchIntentTrustedTime,
      }),
    /does not follow/u,
  );
  assert.doesNotThrow(() =>
    assertFinalizedReceiptAfterDispatchIntent({
      receiptBlockTimestamp: 189n,
      dispatchIntentTrustedTime,
    }),
  );
  assert.throws(
    () =>
      assertFinalizedReceiptAfterDispatchIntent({
        receiptBlockTimestamp: 189n,
        dispatchIntentTrustedTime: {
          adjustedTimeMilliseconds: 188_000,
          uncertaintyMilliseconds: 1_000,
        },
      }),
    /does not follow/u,
  );
});

test("binds non-disclosing exact RPC endpoint digests across release phases", () => {
  const providerIds = ["provider-a", "provider-b"];
  const reviewedUrls = [
    "https://rpc-a.example/key-one?network=mainnet",
    "https://rpc-b.example/key-two?network=mainnet",
  ];
  const bindings = createRpcProviderBindings(providerIds, reviewedUrls);
  assert.equal(bindings[0].rpcOrigin, "https://rpc-a.example");
  assert.match(bindings[0].rpcEndpointSha256, /^0x[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(bindings), /key-one|key-two/u);
  assert.deepEqual(
    assertRpcProviderBindings({
      plan: { rpcProviderBindings: bindings },
      providerIds,
      rpcUrls: reviewedUrls,
    }),
    bindings,
  );
  assert.throws(
    () =>
      assertRpcProviderBindings({
        plan: { rpcProviderBindings: bindings },
        providerIds,
        rpcUrls: [
          "https://rpc-a.example/different",
          "https://rpc-b.example/also-different",
        ],
      }),
    /drifted/u,
  );
});

test("binds private Safe submission to exact Flashbots Protect hash-only privacy", () => {
  assert.deepEqual(
    createRpcProviderBinding(
      "flashbots-protect-max-privacy",
      "https://rpc.flashbots.net/?hint=hash",
    ),
    {
      providerId: "flashbots-protect-max-privacy",
      sanitizedUrl: "https://rpc.flashbots.net/?hint=hash",
    },
  );
  for (const [providerId, endpoint] of [
    ["flashbots-protect-max-privacy", "https://rpc.flashbots.net/fast"],
    [
      "flashbots-protect-max-privacy",
      "https://rpc.flashbots.net/?hint=calldata",
    ],
    ["flashbots-protect-max-privacy", "https://rpc.flashbots.net/"],
    ["unreviewed-relay", "https://rpc.flashbots.net/?hint=hash"],
    [
      "flashbots-protect-max-privacy",
      "https://rpc.flashbots.net/?hint=hash&originId=secret",
    ],
  ]) {
    assert.throws(
      () => createRpcProviderBinding(providerId, endpoint),
      /exact Flashbots Protect/u,
    );
  }
});

test("fails closed on block gas, fee, priority, cost and balance ceilings", () => {
  const valid = {
    gasLimit: 1_000_000n,
    blockGasLimit: 36_000_000n,
    observedFeePerGas: 2n,
    maxFeePerGas: 3n,
    maxPriorityFeePerGas: 1n,
    maxTotalCostWei: 3_000_000n,
    deployerBalance: 3_000_000n,
  };
  assert.equal(assessDeploymentCost(valid), 3_000_000n);
  assert.throws(
    () => assessDeploymentCost({ ...valid, blockGasLimit: valid.gasLimit }),
    /block gas/,
  );
  assert.throws(
    () => assessDeploymentCost({ ...valid, observedFeePerGas: 4n }),
    /fee per gas/,
  );
  assert.throws(
    () => assessDeploymentCost({ ...valid, maxPriorityFeePerGas: 4n }),
    /priority fee/,
  );
  assert.throws(
    () => assessDeploymentCost({ ...valid, maxTotalCostWei: 2_999_999n }),
    /maximum cost/,
  );
  assert.throws(
    () => assessDeploymentCost({ ...valid, deployerBalance: 2_999_999n }),
    /balance is insufficient/,
  );
});

const planFixture = () => ({
  schemaVersion: REGISTRY_PREFLIGHT_SCHEMA,
  status: "PREFLIGHT_ONLY_NO_TRANSACTION",
  chainId: 1,
  broadcastAllowed: false,
  signingAllowed: false,
  createdAtTimestamp: 100,
  expiresAtTimestamp: 200,
  source: { commit: "a", tree: "b" },
  releaseAuthorization: {
    owner: privateKeyToAccount(`0x${"22".repeat(32)}`).address,
    maximumDispatchIntentAuthorizationValiditySeconds: 300,
    authorizationSemantics: AUTHORIZATION_SEMANTICS,
  },
  commonFinalizedAnchor: {
    blockNumber: "100",
    blockHash: `0x${"aa".repeat(32)}`,
  },
  create: { exactPendingNonce: 7, exactFinalizedNonce: 7 },
});

test("requires a separate exact reviewed, signed, and unexpired authorization", async () => {
  const plan = planFixture();
  const preflightSha256 = `0x${"11".repeat(32)}`;
  const account = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const authorization = {
    schemaVersion: REGISTRY_AUTHORIZATION_SCHEMA,
    status: "REVIEWED_READY_FOR_EXPLICIT_DISPATCH_INTENT",
    broadcastAllowed: false,
    signingAllowed: false,
    dispatchIntentActivationAllowed: true,
    broadcastRequiresDurableDispatchIntent: true,
    preflightSha256,
    stagedTransactionSha256: `0x${"33".repeat(32)}`,
    authorizedTransactionHash: `0x${"44".repeat(32)}`,
    source: plan.source,
    ownerAuthorizationAddress: account.address,
    notBeforeTimestamp: 180,
    dispatchIntentExpiresAtTimestamp: 190,
    authorizationSemantics: AUTHORIZATION_SEMANTICS,
  };
  authorization.reviewedPlanDigest = computeReviewedPlanDigest({
    preflightSha256,
    stagedTransactionSha256: authorization.stagedTransactionSha256,
    authorizedTransactionHash: authorization.authorizedTransactionHash,
    ownerAuthorizationAddress: account.address,
    notBeforeTimestamp: authorization.notBeforeTimestamp,
    dispatchIntentExpiresAtTimestamp:
      authorization.dispatchIntentExpiresAtTimestamp,
    sourceCommit: plan.source.commit,
    sourceTree: plan.source.tree,
  });
  authorization.ownerAuthorizationSignature = await account.signMessage({
    message: reviewedAuthorizationMessage(authorization.reviewedPlanDigest),
  });
  assert.doesNotThrow(() =>
    assertReviewedAuthorization({
      authorization,
      preflightSha256,
      plan,
      nowTimestamp: 180,
    }),
  );
  await verifyReviewedAuthorizationSignature(authorization);
  assert.throws(
    () =>
      assertReviewedAuthorization({
        authorization: { ...authorization, broadcastAllowed: true },
        preflightSha256,
        plan,
        nowTimestamp: 180,
      }),
    /authorization is stale or invalid/,
  );
  assert.throws(
    () =>
      assertReviewedAuthorization({
        authorization: {
          ...authorization,
          dispatchIntentExpiresAtTimestamp: 181,
          notBeforeTimestamp: 182,
        },
        preflightSha256,
        plan,
        nowTimestamp: 180,
      }),
    /authorization is stale or invalid/,
  );
  assert.throws(
    () =>
      assertReviewedAuthorization({
        authorization,
        preflightSha256,
        plan,
        nowTimestamp: 191,
      }),
    /authorization is stale or invalid/,
  );
  assert.throws(
    () =>
      assertReviewedAuthorization({
        authorization: {
          ...authorization,
          reviewedPlanDigest: `0x${"33".repeat(32)}`,
        },
        preflightSha256,
        plan,
        nowTimestamp: 180,
      }),
    /reviewed plan digest mismatch/,
  );
  await assert.rejects(
    () =>
      verifyReviewedAuthorizationSignature({
        ...authorization,
        ownerAuthorizationAddress: "0x0000000000000000000000000000000000000001",
      }),
    /signature mismatch/,
  );
});

test("owner authorization keeps one explicit not-before across delayed offline signing", () => {
  const window = {
    notBeforeTimestamp: 1_000,
    dispatchIntentExpiresAtTimestamp: 1_300,
    planCreatedAtTimestamp: 900,
    planExpiresAtTimestamp: 1_400,
  };
  assert.doesNotThrow(() =>
    assertDispatchAuthorizationWindow({ ...window, nowTimestamp: 1_000 }),
  );
  assert.doesNotThrow(() =>
    assertDispatchAuthorizationWindow({ ...window, nowTimestamp: 1_120 }),
  );
  for (const mutation of [
    { notBeforeTimestamp: 1_121 },
    { dispatchIntentExpiresAtTimestamp: 1_301 },
    { dispatchIntentExpiresAtTimestamp: 1_120 },
  ]) {
    assert.throws(
      () =>
        assertDispatchAuthorizationWindow({
          ...window,
          nowTimestamp: 1_120,
          ...mutation,
        }),
      /window is stale or invalid/u,
    );
  }
});

test("binds source, finalized anchor, nonce and live target state without brittle latest equality", () => {
  const plan = planFixture();
  assertPreflightEnvelope(plan, 199);
  assert.throws(
    () => assertPreflightEnvelope({ ...plan, expiresAtTimestamp: 98 }, 99),
    /preflight plan/,
  );
  assertSourceBinding({ commit: "a", tree: "b", clean: true, plan });
  assert.throws(
    () => assertSourceBinding({ commit: "x", tree: "b", clean: true, plan }),
    /source identity/,
  );
  assertDeployerBinding(
    "0x0000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000001",
  );
  assert.throws(
    () =>
      assertDeployerBinding(
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002",
      ),
    /deployer key/,
  );
  const observation = {
    finalized: { number: 101n, hash: `0x${"bb".repeat(32)}` },
    nonce: 7,
    balance: 100n,
    predictedCode: "0x",
    predictedNonce: 0,
    predictedBalance: 0n,
  };
  assertLiveBinding({ first: observation, second: { ...observation }, plan });
  assert.throws(
    () =>
      assertLiveBinding({
        first: observation,
        second: { ...observation, nonce: 8 },
        plan,
      }),
    /live broadcast state/,
  );
  assertFinalizedAnchor({
    anchor: plan.commonFinalizedAnchor,
    observations: [
      { number: 100n, hash: plan.commonFinalizedAnchor.blockHash },
      { number: 100n, hash: plan.commonFinalizedAnchor.blockHash },
    ],
  });
  assert.throws(
    () =>
      assertFinalizedAnchor({
        anchor: plan.commonFinalizedAnchor,
        observations: [
          { number: 100n, hash: plan.commonFinalizedAnchor.blockHash },
          { number: 100n, hash: `0x${"bb".repeat(32)}` },
        ],
      }),
    /not canonical/,
  );
});

test("binds exact deployment data, policies, ABI, bytecode and transaction", () => {
  const artifactBytecode = "0x1234";
  const deploymentData = "0x12345678";
  const manifestBytes = Buffer.from("manifest");
  const committedAbiBytes = Buffer.from("abi");
  const productionPolicyBytes = Buffer.from("policy");
  const safeVerificationBytes = Buffer.from("safe");
  const sha = (bytes) =>
    `0x${createHash("sha256").update(bytes).digest("hex")}`;
  const plan = {
    source: {
      creationBytecodeKeccak256: keccak256(artifactBytecode),
      deploymentDataKeccak256: keccak256(deploymentData),
      sourceManifestSha256: sha(manifestBytes),
      committedAbiSha256: sha(committedAbiBytes),
    },
    productionPolicy: { documentSha256: sha(productionPolicyBytes) },
    safeControllers: { verificationSha256: sha(safeVerificationBytes) },
    create: {
      deployer: "0x0000000000000000000000000000000000000001",
      exactPendingNonce: 7,
      exactFinalizedNonce: 7,
      gasLimit: "100",
      reviewedMaxFeePerGas: "3",
      reviewedMaxPriorityFeePerGas: "1",
    },
  };
  plan.expectedTransaction = {
    type: "eip1559",
    chainId: 1,
    from: plan.create.deployer,
    to: null,
    input: deploymentData,
    valueWei: "0",
    nonce: 7,
    gasLimit: "100",
    maxFeePerGas: "3",
    maxPriorityFeePerGas: "1",
  };
  const manifest = { artifact: { abiSha256: sha(committedAbiBytes) } };
  assertArtifactBinding({
    artifactBytecode,
    deploymentData,
    manifestBytes,
    committedAbiBytes,
    productionPolicyBytes,
    safeVerificationBytes,
    manifest,
    plan,
  });
  assertExpectedDeploymentTransaction({ plan, deploymentData });
  assert.throws(
    () =>
      assertExpectedDeploymentTransaction({
        plan: {
          ...plan,
          expectedTransaction: { ...plan.expectedTransaction, nonce: 8 },
        },
        deploymentData,
      }),
    /exact deployment transaction/,
  );
  assert.throws(
    () =>
      assertArtifactBinding({
        artifactBytecode,
        deploymentData,
        manifestBytes,
        committedAbiBytes,
        productionPolicyBytes: Buffer.from("mutated"),
        safeVerificationBytes,
        manifest,
        plan,
      }),
    /drifted from plan/,
  );
});

test("binds constructor order and exact empty initialized Registry state", () => {
  const config = {
    initialAdminDelay: "172800",
    initialAdmin: "0x0000000000000000000000000000000000000001",
    initialApprover: "0x0000000000000000000000000000000000000002",
    initialRegistrar: "0x0000000000000000000000000000000000000003",
    initialFinalizer: "0x0000000000000000000000000000000000000004",
    initialRevoker: "0x0000000000000000000000000000000000000005",
    minimumFinalityBlocks: "12",
    registryPolicyCommitment: `0x${"44".repeat(32)}`,
  };
  assert.notEqual(
    computeConstructorCommitment(config),
    computeConstructorCommitment({
      ...config,
      initialApprover: config.initialRegistrar,
      initialRegistrar: config.initialApprover,
    }),
  );
  const runtime = "0x6000";
  const expected = {
    ...config,
    runtimeCodeKeccak256: keccak256(runtime),
    controllers: [
      config.initialApprover,
      config.initialRegistrar,
      config.initialFinalizer,
      config.initialRevoker,
    ],
  };
  const actual = {
    runtimeA: runtime,
    runtimeB: runtime,
    chainId: 1n,
    registryGeneration: 2n,
    adminDelay: decodeAbiParameters(
      [{ type: "uint48" }],
      encodeAbiParameters([{ type: "uint48" }], [172800]),
    )[0],
    admin: config.initialAdmin,
    pendingAdmin: ZERO_ADDRESS,
    pendingAdminSchedule: 0n,
    pendingAdminDelay: 0,
    pendingAdminDelaySchedule: 0,
    minimumFinalityBlocks: 12n,
    policy: config.registryPolicyCommitment,
    controllers: expected.controllers,
    pendingControllers: expected.controllers.map(() => ({
      controller: ZERO_ADDRESS,
      acceptAfter: 0n,
    })),
    roleAssignments: expected.controllers.map(() => ({
      expectedControllerHasRole: true,
      zeroAddressHasRole: false,
      adminHasRole: false,
    })),
    approvalCount: 0n,
    registrationCount: 0n,
    transitionCount: 0n,
  };
  assert.equal(typeof actual.adminDelay, "number");
  assertPostDeploymentBinding({ actual, expected });
  assert.throws(
    () =>
      assertPostDeploymentBinding({
        actual: { ...actual, transitionCount: 1n },
        expected,
      }),
    /post-deployment/,
  );
  assert.throws(
    () =>
      assertPostDeploymentBinding({
        actual: { ...actual, runtimeA: "0x6001", runtimeB: "0x6001" },
        expected,
      }),
    /post-deployment/,
  );
  assertPredictedAddressUnoccupied({ code: "0x", nonce: 0, balance: 0n });
  assert.throws(
    () =>
      assertPredictedAddressUnoccupied({ code: "0x", nonce: 1, balance: 0n }),
    /occupied/,
  );
});

test("rejects adversarial finalized receipt, nonce, input, fee, and runtime while allowing later exact inclusion", () => {
  const transactionHash = `0x${"11".repeat(32)}`;
  const expectedRuntime = `0x${"22".repeat(32)}`;
  const plan = {
    expiresAtTimestamp: 200,
    expectedTransaction: {
      from: "0x0000000000000000000000000000000000000001",
      input: "0x1234",
      valueWei: "0",
      nonce: 7,
      gasLimit: "100",
      maxFeePerGas: "10",
      maxPriorityFeePerGas: "1",
    },
    create: { predictedAddress: "0x0000000000000000000000000000000000000002" },
    expectedRuntime: { codeKeccak256: expectedRuntime },
  };
  const authorization = { notBeforeTimestamp: 180 };
  const dispatchIntentTrustedTime = {
    adjustedTimeMilliseconds: 188_000,
    uncertaintyMilliseconds: 999,
  };
  const actual = {
    hash: transactionHash,
    blockNumber: "100",
    blockHash: `0x${"33".repeat(32)}`,
    receiptBlockNumber: "100",
    receiptBlockHash: `0x${"33".repeat(32)}`,
    fetchedReceiptBlockNumber: "100",
    fetchedReceiptBlockHash: `0x${"33".repeat(32)}`,
    receiptTransactionHash: transactionHash,
    from: plan.expectedTransaction.from,
    to: null,
    input: "0x1234",
    value: "0",
    nonce: 7,
    chainId: 1,
    type: "eip1559",
    gas: "100",
    maxFeePerGas: "10",
    maxPriorityFeePerGas: "1",
    receiptStatus: "success",
    receiptContractAddress: plan.create.predictedAddress,
    receiptGasUsed: "90",
    receiptEffectiveGasPrice: "9",
    receiptBlockTimestamp: "189",
    runtimeCodeKeccak256: expectedRuntime,
  };
  assertFinalizedDeploymentTransaction({
    actual,
    transactionHash,
    plan,
    authorization,
    dispatchIntentTrustedTime,
  });
  assert.throws(
    () =>
      assertFinalizedDeploymentTransaction({
        actual: { ...actual, receiptBlockTimestamp: "179" },
        transactionHash,
        plan,
        authorization,
        dispatchIntentTrustedTime,
      }),
    /does not follow/u,
  );
  assertFinalizedDeploymentTransaction({
    actual: { ...actual, receiptBlockTimestamp: "9999999999" },
    transactionHash,
    plan,
    authorization,
    dispatchIntentTrustedTime,
  });
  assert.throws(
    () =>
      assertFinalizedDeploymentTransaction({
        actual: { ...actual, receiptBlockTimestamp: "188" },
        transactionHash,
        plan,
        authorization,
        dispatchIntentTrustedTime,
      }),
    /does not follow/u,
  );
  for (const [field, value] of [
    ["nonce", 8],
    ["input", "0x5678"],
    ["maxPriorityFeePerGas", "2"],
    ["receiptStatus", "reverted"],
    ["runtimeCodeKeccak256", `0x${"44".repeat(32)}`],
  ]) {
    assert.throws(
      () =>
        assertFinalizedDeploymentTransaction({
          actual: { ...actual, [field]: value },
          transactionHash,
          plan,
          authorization,
          dispatchIntentTrustedTime,
        }),
      /exact signed plan/,
    );
  }
});

test("requires exact Etherscan and Sourcify evidence bound to finalized onchain identity", () => {
  const sourceIdentity = { commit: "a".repeat(40), tree: "b".repeat(40) };
  const onchain = {
    schemaVersion: REGISTRY_VERIFICATION_SCHEMA,
    status: "VERIFIED_FINALIZED_ONCHAIN_AWAITING_SOURCE",
    verified: false,
    source: sourceIdentity,
    contractAddress: "0x0000000000000000000000000000000000000001",
    transactionHash: `0x${"11".repeat(32)}`,
    runtimeCodeKeccak256: `0x${"22".repeat(32)}`,
    constructorArguments: "0x1234",
  };
  const source = {
    schemaVersion: REGISTRY_SOURCE_VERIFICATION_SCHEMA,
    status:
      "SELF_COMPILED_ETHERSCAN_VERIFIED_SOURCE_EXACT_CLOSURE_SOURCIFY_V2_EXACT",
    verified: true,
    chainId: 1,
    source: sourceIdentity,
    contractAddress: onchain.contractAddress,
    transactionHash: onchain.transactionHash,
    runtimeCodeKeccak256: onchain.runtimeCodeKeccak256,
    constructorArguments: onchain.constructorArguments,
    fqcn: "src/ProgrammableCustomRegistryV2.sol:ProgrammableCustomRegistryV2",
    compiler: {
      version: "v0.8.26+commit.8a97fa7a",
      platform: "darwin",
      architecture: "arm64",
      binarySha256: `0x${"33".repeat(32)}`,
      standardJsonInputSha256: `0x${"44".repeat(32)}`,
      standardJsonOutputSha256: `0x${"55".repeat(32)}`,
    },
    sourceClosure: Object.fromEntries(
      Array.from({ length: 13 }, (_, index) => [
        `source-${index}.sol`,
        `0x${"66".repeat(32)}`,
      ]),
    ),
    etherscan: {
      status: "verified-source-exact-closure",
      similarMatch: null,
      url: `https://etherscan.io/address/${onchain.contractAddress}#code`,
    },
    sourcify: {
      status: "exact-match",
      url: `https://sourcify.dev/server/v2/contract/1/${onchain.contractAddress}`,
    },
  };
  assertSourceVerificationBinding({ onchain, source });
  assert.throws(
    () =>
      assertSourceVerificationBinding({
        onchain,
        source: { ...source, runtimeCodeKeccak256: `0x${"33".repeat(32)}` },
      }),
    /does not bind/,
  );
  assert.throws(
    () =>
      assertSourceVerificationBinding({
        onchain,
        source: { ...source, sourcify: { status: "partial-match" } },
      }),
    /does not bind/,
  );
});
