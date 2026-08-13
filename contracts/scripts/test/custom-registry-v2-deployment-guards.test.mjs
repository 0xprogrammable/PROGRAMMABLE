import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  assessDeploymentCost,
  assertArtifactBinding,
  assertDeployerBinding,
  assertLiveBinding,
  assertPostDeploymentBinding,
  assertPreflightEnvelope,
  assertPredictedAddressUnoccupied,
  assertReviewedAuthorization,
  assertSourceBinding,
  computeConstructorCommitment,
  computeReviewedPlanDigest,
  reviewedAuthorizationMessage,
  requireDistinctRpcOrigins,
  verifyReviewedAuthorizationSignature,
} from "../custom-registry-v2-deployment-guards.mjs";

test("requires genuinely distinct RPC origins", () => {
  assert.throws(
    () => requireDistinctRpcOrigins("https://rpc.example/a", "https://rpc.example/b"),
    /origins must be distinct/,
  );
  assert.deepEqual(
    requireDistinctRpcOrigins("https://rpc-a.example/path", "https://rpc-b.example/path"),
    ["https://rpc-a.example", "https://rpc-b.example"],
  );
});

test("fails closed on block gas, fee, cost and balance ceilings", () => {
  const valid = {
    gasLimit: 1_000_000n,
    blockGasLimit: 36_000_000n,
    observedFeePerGas: 2n,
    maxFeePerGas: 3n,
    maxTotalCostWei: 3_000_000n,
    deployerBalance: 3_000_000n,
  };
  assert.equal(assessDeploymentCost(valid), 3_000_000n);
  assert.throws(() => assessDeploymentCost({ ...valid, blockGasLimit: valid.gasLimit }), /block gas/);
  assert.throws(() => assessDeploymentCost({ ...valid, observedFeePerGas: 4n }), /fee per gas/);
  assert.throws(() => assessDeploymentCost({ ...valid, maxTotalCostWei: 2_999_999n }), /maximum cost/);
  assert.throws(() => assessDeploymentCost({ ...valid, deployerBalance: 2_999_999n }), /balance is insufficient/);
});

const planFixture = () => ({
  schemaVersion: "programmable.custom-registry-deployment-preflight.v2",
  status: "PREFLIGHT_ONLY_NO_TRANSACTION",
  broadcastAllowed: false,
  signingAllowed: false,
  expiresAtTimestamp: 200,
  source: { commit: "a", tree: "b" },
  releaseAuthorization: {
    owner: privateKeyToAccount(`0x${"22".repeat(32)}`).address,
    maximumValiditySeconds: 300,
  },
  commonFinalizedAnchor: { blockNumber: "100", blockHash: "0xanchor" },
  create: { exactPendingNonce: 7 },
});

test("requires a separate exact reviewed, signed, and unexpired authorization", async () => {
  const plan = planFixture();
  const preflightSha256 = `0x${"11".repeat(32)}`;
  const account = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const authorization = {
    schemaVersion: "programmable.custom-registry-deployment-authorization.v2",
    status: "REVIEWED_READY_FOR_EXPLICIT_BROADCAST",
    broadcastAllowed: true,
    signingAllowed: true,
    preflightSha256,
    source: plan.source,
    ownerAuthorizationAddress: account.address,
    expiresAtTimestamp: 190,
  };
  authorization.reviewedPlanDigest = computeReviewedPlanDigest({
    preflightSha256,
    ownerAuthorizationAddress: account.address,
    expiresAtTimestamp: authorization.expiresAtTimestamp,
    sourceCommit: plan.source.commit,
    sourceTree: plan.source.tree,
  });
  authorization.ownerAuthorizationSignature = await account.signMessage({
    message: reviewedAuthorizationMessage(authorization.reviewedPlanDigest),
  });
  assert.doesNotThrow(() => assertReviewedAuthorization({ authorization, preflightSha256, plan, nowTimestamp: 180 }));
  await verifyReviewedAuthorizationSignature(authorization);
  assert.throws(
    () => assertReviewedAuthorization({ authorization: { ...authorization, broadcastAllowed: false }, preflightSha256, plan, nowTimestamp: 180 }),
    /authorization is stale or invalid/,
  );
  assert.throws(
    () => assertReviewedAuthorization({ authorization: { ...authorization, expiresAtTimestamp: 481 }, preflightSha256, plan: { ...plan, expiresAtTimestamp: 900 }, nowTimestamp: 180 }),
    /authorization is stale or invalid/,
  );
  assert.throws(
    () => assertReviewedAuthorization({ authorization: { ...authorization, ownerAuthorizationAddress: "0x0000000000000000000000000000000000000001" }, preflightSha256, plan, nowTimestamp: 180 }),
    /authorization is stale or invalid/,
  );
  assert.throws(
    () => assertReviewedAuthorization({ authorization, preflightSha256, plan, nowTimestamp: 191 }),
    /authorization is stale or invalid/,
  );
  assert.throws(
    () => assertReviewedAuthorization({ authorization: { ...authorization, reviewedPlanDigest: `0x${"33".repeat(32)}` }, preflightSha256, plan, nowTimestamp: 180 }),
    /reviewed plan digest mismatch/,
  );
  await assert.rejects(
    () => verifyReviewedAuthorizationSignature({ ...authorization, ownerAuthorizationAddress: "0x0000000000000000000000000000000000000001" }),
    /signature mismatch/,
  );
});

test("binds source, deployer, finalized anchor, nonce, and live economics", () => {
  const plan = planFixture();
  assertPreflightEnvelope(plan, 199);
  assert.throws(() => assertPreflightEnvelope({ ...plan, expiresAtTimestamp: 198 }, 199), /preflight plan/);
  assertSourceBinding({ commit: "a", tree: "b", clean: true, plan });
  assert.throws(() => assertSourceBinding({ commit: "x", tree: "b", clean: true, plan }), /source identity/);
  assertDeployerBinding("0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000001");
  assert.throws(() => assertDeployerBinding("0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"), /deployer key/);
  const observation = {
    finalized: { number: 100n, hash: "0xanchor" },
    nonce: 7,
    balance: 100n,
    latest: { gasLimit: 30n, baseFeePerGas: 2n },
    priorityFee: 1n,
  };
  assertLiveBinding({ first: observation, second: { ...observation }, plan });
  assert.throws(() => assertLiveBinding({ first: observation, second: { ...observation, nonce: 8 }, plan }), /live broadcast state/);
});

test("binds committed ABI, bytecode, manifest, and exact constructor order", () => {
  const artifactBytecode = "0x1234";
  const manifestBytes = Buffer.from("manifest");
  const committedAbiBytes = Buffer.from("abi");
  const sha256 = (bytes) => `0x${createHash("sha256").update(bytes).digest("hex")}`;
  const plan = { source: { creationBytecodeKeccak256: keccak256(artifactBytecode), sourceManifestSha256: sha256(manifestBytes) } };
  const manifest = { artifact: { abiSha256: sha256(committedAbiBytes) } };
  assertArtifactBinding({ artifactBytecode, manifestBytes, committedAbiBytes, manifest, plan });
  assert.throws(
    () => assertArtifactBinding({ artifactBytecode, manifestBytes, committedAbiBytes: Buffer.from("mutated"), manifest, plan }),
    /ABI, bytecode, or manifest/,
  );
  const config = {
    initialAdminDelay: "172800",
    initialAdmin: "0x0000000000000000000000000000000000000001",
    initialApprover: "0x0000000000000000000000000000000000000002",
    initialRegistrar: "0x0000000000000000000000000000000000000003",
    initialFinalizer: "0x0000000000000000000000000000000000000004",
    initialRevoker: "0x0000000000000000000000000000000000000005",
    minimumFinalityBlocks: "64",
    registryPolicyCommitment: `0x${"44".repeat(32)}`,
  };
  assert.notEqual(
    computeConstructorCommitment(config),
    computeConstructorCommitment({ ...config, initialApprover: config.initialRegistrar, initialRegistrar: config.initialApprover }),
  );
});

test("fails closed on independent occupied code and post-deployment mismatch", () => {
  assertPredictedAddressUnoccupied("0x", "0x");
  assert.throws(() => assertPredictedAddressUnoccupied("0x", "0x6000"), /independent RPC/);
  const expected = {
    initialAdminDelay: "10",
    initialAdmin: "0x0000000000000000000000000000000000000001",
    minimumFinalityBlocks: "64",
    registryPolicyCommitment: `0x${"44".repeat(32)}`,
    controllers: [
      "0x0000000000000000000000000000000000000002",
      "0x0000000000000000000000000000000000000003",
      "0x0000000000000000000000000000000000000004",
      "0x0000000000000000000000000000000000000005",
    ],
  };
  const actual = {
    runtimeA: "0x6000",
    runtimeB: "0x6000",
    chainId: 1n,
    adminDelay: 10n,
    admin: expected.initialAdmin,
    minimumFinalityBlocks: 64n,
    policy: expected.registryPolicyCommitment,
    controllers: expected.controllers,
    roleAssignments: [true, true, true, true],
  };
  assertPostDeploymentBinding({ actual, expected });
  assert.throws(
    () => assertPostDeploymentBinding({ actual: { ...actual, controllers: [...actual.controllers.slice(0, 3), actual.controllers[0]] }, expected }),
    /post-deployment/,
  );
  assert.throws(
    () => assertPostDeploymentBinding({ actual: { ...actual, roleAssignments: [true, false, true, true] }, expected }),
    /post-deployment/,
  );
});
