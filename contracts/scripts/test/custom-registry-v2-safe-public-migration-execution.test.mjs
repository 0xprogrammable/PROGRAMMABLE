import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getAddress, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  canonicalTransactionJournalPath,
} from "../custom-registry-v2-release-evidence.mjs";

const executionModulePath = new URL(
  "../custom-registry-v2-safe-public-migration-execution.mjs",
  import.meta.url,
);
const scripts = path.resolve(import.meta.dirname, "..");
const run = (name, args = [], env = {}) =>
  spawnSync(process.execPath, [path.join(scripts, name), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
const sha256 = (bytes) =>
  `0x${createHash("sha256").update(bytes).digest("hex")}`;
const trustedTime = (timestamp) => ({
  source: "sntp:time.apple.com",
  systemTimeMilliseconds: timestamp * 1_000,
  offsetMilliseconds: 0,
  uncertaintyMilliseconds: 0,
  adjustedTimeMilliseconds: timestamp * 1_000,
  adjustedTimestamp: timestamp,
});

async function executionModule() {
  try {
    return await import(executionModulePath);
  } catch {
    return {};
  }
}

async function fixture(migrationModule) {
  const directory = await mkdtemp(
    path.join(os.homedir(), ".programmable-registry-v2-migration-test-"),
  );
  await chmod(directory, 0o700);
  process.env.REGISTRY_RELEASE_EVIDENCE_ROOT = directory;
  const legacy = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const releaseOwner = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const outerTransaction = {
    type: "eip1559",
    chainId: 1,
    from: legacy.address,
    to: "0x00000000000000000000000000000000000000a1",
    input: "0x12345678",
    valueWei: "0",
    nonce: 7,
    gasLimit: "250000",
    maxFeePerGas: "30000000000",
    maxPriorityFeePerGas: "2000000000",
  };
  const plan = {
    schemaVersion: "programmable.custom-registry-v2-safe-public-migration-plan.v2",
    status: "PREFLIGHT_ONLY_TWELVE_HARDWARE_KEYS_NO_SIGNING_NO_BROADCAST",
    chainId: 1,
    source: { commit: "a".repeat(40), tree: "b".repeat(40) },
    policySha256: `0x${"33".repeat(32)}`,
    hardwareInventorySha256: `0x${"55".repeat(32)}`,
    migrationPlanDigest: `0x${"66".repeat(32)}`,
    continuationEvidenceSha256: null,
    rpcProviderBindings: [
      {
        providerId: "provider-a",
        rpcOrigin: "https://a.example",
        rpcEndpointSha256: `0x${"77".repeat(32)}`,
      },
      {
        providerId: "provider-b",
        rpcOrigin: "https://b.example",
        rpcEndpointSha256: `0x${"88".repeat(32)}`,
      },
    ],
    releaseAuthorization: {
      owner: releaseOwner.address,
      maximumDispatchIntentAuthorizationValiditySeconds: 300,
      authorizationSemantics:
        "EXACT_RAW_TRANSACTION_HASH_AUTHORIZED_DURABLE_DISPATCH_INTENT_ACTIVATES_LATER_IDENTICAL_RAW_SEND_REBROADCAST_AND_INCLUSION_NO_WORKFLOW_CANCELLATION",
      stagedRawTransactionTrustBoundary:
        "OWNER_ONLY_0400_CURRENT_USER_TEMPORARY_PUBLIC_ONE_OF_ONE_CUSTODY_WORKFLOW_NOT_AN_ONCHAIN_OWNER_GATE",
      dispatchIntentFinalConfirmation:
        "EXPLICIT_EXACT_TRANSACTION_HASH_REQUIRED_IMMEDIATELY_BEFORE_DURABLE_ACTIVATION",
      nonceScopedJournalExclusivity:
        "ONE_CANONICAL_CHAIN_SIGNER_NONCE_JOURNAL_BLOCKS_CHANGED_TRANSACTION_UNTIL_NONCE_IS_CANONICALLY_CONSUMED",
    },
    remainingRoles: ["approver"],
    transactions: [
      {
        role: "approver",
        safe: outerTransaction.to,
        legacyOwner: legacy.address,
        outerTransaction,
      },
    ],
    signingAllowed: false,
    broadcastAllowed: false,
    activationAllowed: false,
    createdAtTimestamp: 1_000,
    createdAtTrustedTime: trustedTime(1_000),
    expiresAtTimestamp: 1_600,
  };
  const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`);
  const planPath = path.join(directory, "plan.json");
  await writeFile(planPath, planBytes, { mode: 0o600 });
  const planSha256 = sha256(planBytes);
  const serializedTransaction = await legacy.signTransaction({
    chainId: 1,
    type: "eip1559",
    to: outerTransaction.to,
    data: outerTransaction.input,
    value: 0n,
    nonce: outerTransaction.nonce,
    gas: BigInt(outerTransaction.gasLimit),
    maxFeePerGas: BigInt(outerTransaction.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(outerTransaction.maxPriorityFeePerGas),
  });
  const staged = {
    schemaVersion: migrationModule.SAFE_PUBLIC_MIGRATION_STAGED_SCHEMA,
    status: "SIGNED_RAW_TRANSACTION_STAGED_NO_RELEASE_WORKFLOW_AUTHORIZATION",
    chainId: 1,
    role: "approver",
    planSha256,
    preflightSha256: planSha256,
    source: plan.source,
    policySha256: plan.policySha256,
    continuationEvidenceSha256: null,
    signingAuthorizedByExplicitCli: true,
    networkCallsPerformedByStager: false,
    releaseWorkflowDispatchAuthorityCreated: false,
    signedAtTimestamp: 1_005,
    trustedTime: trustedTime(1_005),
    transactionHash: keccak256(serializedTransaction),
    serializedTransaction,
  };
  const stagedBytes = Buffer.from(`${JSON.stringify(staged, null, 2)}\n`);
  const stagedPath = path.join(directory, "staged-approver.json");
  await writeFile(stagedPath, stagedBytes, { mode: 0o400 });
  const stagedSha256 = sha256(stagedBytes);
  const authorization = {
    schemaVersion: migrationModule.SAFE_PUBLIC_MIGRATION_AUTHORIZATION_SCHEMA,
    status: "REVIEWED_REMAINING_ROLES_READY_FOR_EXPLICIT_DISPATCH_INTENTS",
    planSha256,
    source: plan.source,
    policySha256: plan.policySha256,
    continuationEvidenceSha256: null,
    ownerAuthorizationAddress: releaseOwner.address,
    notBeforeTimestamp: 1_010,
    dispatchIntentExpiresAtTimestamp: 1_300,
    authorizationSemantics: plan.releaseAuthorization.authorizationSemantics,
    signingAllowed: false,
    broadcastAllowed: false,
    dispatchIntentActivationAllowed: true,
    broadcastRequiresDurableDispatchIntent: true,
    authorizedTransactions: [
      {
        role: "approver",
        stagedTransactionSha256: stagedSha256,
        authorizedTransactionHash: staged.transactionHash,
        signer: legacy.address,
        nonce: outerTransaction.nonce,
      },
    ],
  };
  authorization.reviewedPlanDigest =
    migrationModule.computeSafeMigrationAuthorizationDigest(authorization);
  authorization.ownerAuthorizationSignature = await releaseOwner.signMessage({
    message: migrationModule.safeMigrationAuthorizationMessage(
      authorization.reviewedPlanDigest,
    ),
  });
  const authorizationBytes = Buffer.from(
    `${JSON.stringify(authorization, null, 2)}\n`,
  );
  const authorizationPath = path.join(directory, "authorization.json");
  await writeFile(authorizationPath, authorizationBytes, { mode: 0o600 });
  const authorizationSha256 = sha256(authorizationBytes);
  const journalRecords = [
    {
      schemaVersion: migrationModule.SAFE_PUBLIC_MIGRATION_JOURNAL_SCHEMA,
      event: "JOURNAL_OPEN",
      planSha256,
      authorizationSha256,
      stagedTransactionSha256: stagedSha256,
      role: "approver",
      signer: legacy.address,
      nonce: outerTransaction.nonce,
    },
    {
      event: migrationModule.SAFE_PUBLIC_MIGRATION_SIGNED_EVENT,
      transactionHash: staged.transactionHash,
      stagedTransactionSha256: stagedSha256,
      serializedTransaction,
    },
    {
      event: "DISPATCH_INTENT_ACTIVATED",
      transactionHash: staged.transactionHash,
      authorizationSha256,
      authorizationSemantics: authorization.authorizationSemantics,
      exactSerializedTransactionOnly: true,
      changedTransactionRequiresFreshAuthorization: true,
      workflowCancellationAllowed: false,
      activatedAtTimestamp: 1_011,
      activatedTrustedTime: trustedTime(1_011),
    },
    {
      event: "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
      transactionHash: staged.transactionHash,
      observedAtTimestamp: 1_020,
      blockNumber: "1234",
      blockHash: `0x${"44".repeat(32)}`,
    },
    {
      event: "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
      transactionHash: staged.transactionHash,
      observedAtTimestamp: 1_021,
    },
  ];
  const journalBytes = Buffer.from(
    journalRecords.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
  );
  const journalPath = canonicalTransactionJournalPath({
    chainId: 1,
    signer: legacy.address,
    nonce: outerTransaction.nonce,
  });
  await writeFile(journalPath, journalBytes, { mode: 0o600 });
  const bundle = {
    schemaVersion: migrationModule.SAFE_PUBLIC_MIGRATION_EXECUTION_BUNDLE_SCHEMA,
    status: "EXACT_ROLE_EXECUTION_EVIDENCE_AWAITING_FINALIZED_CHAIN_VERIFICATION",
    chainId: 1,
    role: "approver",
    transactionHash: staged.transactionHash,
    artifacts: {
      plan: {
        path: planPath,
        sha256: planSha256,
        bytesBase64: planBytes.toString("base64"),
      },
      stagedTransaction: {
        path: stagedPath,
        sha256: stagedSha256,
        bytesBase64: stagedBytes.toString("base64"),
      },
      ownerAuthorization: {
        path: authorizationPath,
        sha256: authorizationSha256,
        bytesBase64: authorizationBytes.toString("base64"),
      },
      transactionJournal: {
        path: journalPath,
        sha256: sha256(journalBytes),
        bytesBase64: journalBytes.toString("base64"),
      },
    },
  };
  return {
    directory,
    plan,
    planPath,
    planSha256,
    staged,
    authorization,
    journalRecords,
    bundle,
    legacy,
  };
}

test("execution core exposes the migration bundle validation contract", async () => {
  const migrationModule = await executionModule();
  assert.equal(typeof migrationModule.assertSafeMigrationExecutionBundle, "function");
  assert.equal(typeof migrationModule.readSafeMigrationExecutionBundle, "function");
});

test("execution bundle validates exact embedded and protected role artifacts", async () => {
  const migrationModule = await executionModule();
  assert.equal(typeof migrationModule.assertSafeMigrationExecutionBundle, "function");
  const value = await fixture(migrationModule);
  try {
    const parsed = await migrationModule.assertSafeMigrationExecutionBundle({
      bundle: value.bundle,
      plan: value.plan,
      plannedRole: value.plan.transactions[0],
      nowTimestamp: 1_200,
    });
    assert.equal(parsed.transactionHash, value.staged.transactionHash);
    assert.equal(parsed.signer, value.legacy.address);
    assert.equal(parsed.nonce, 7);
    assert.deepEqual(parsed.journalRecords, value.journalRecords);
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("execution bundle validates real two-provider broadcast response records", async () => {
  const migrationModule = await executionModule();
  const value = await fixture(migrationModule);
  try {
    const records = structuredClone(value.journalRecords);
    records.splice(3, 0, {
      event: "BROADCAST_PROVIDER_RESPONSES",
      transactionHash: value.staged.transactionHash,
      requestStartedAtTimestamp: 1_012,
      requestStartedTrustedTime: trustedTime(1_012),
      responseObservedAtTimestamp: 1_013,
      responseObservedTrustedTime: trustedTime(1_013),
      providerResponses: value.plan.rpcProviderBindings.map((binding) => ({
        ...binding,
        status: "fulfilled",
        transactionHash: value.staged.transactionHash,
      })),
    });
    const bytes = Buffer.from(
      records.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
    );
    await writeFile(value.bundle.artifacts.transactionJournal.path, bytes, {
      mode: 0o600,
    });
    value.bundle.artifacts.transactionJournal.sha256 = sha256(bytes);
    value.bundle.artifacts.transactionJournal.bytesBase64 =
      bytes.toString("base64");
    await assert.doesNotReject(
      migrationModule.assertSafeMigrationExecutionBundle({
        bundle: value.bundle,
        plan: value.plan,
        plannedRole: value.plan.transactions[0],
        nowTimestamp: 1_200,
      }),
    );
    records[3].providerResponses[0].providerId = "wrong-provider";
    const changedBytes = Buffer.from(
      records.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
    );
    await writeFile(
      value.bundle.artifacts.transactionJournal.path,
      changedBytes,
      { mode: 0o600 },
    );
    value.bundle.artifacts.transactionJournal.sha256 = sha256(changedBytes);
    value.bundle.artifacts.transactionJournal.bytesBase64 =
      changedBytes.toString("base64");
    await assert.rejects(
      migrationModule.assertSafeMigrationExecutionBundle({
        bundle: value.bundle,
        plan: value.plan,
        plannedRole: value.plan.transactions[0],
        nowTimestamp: 1_200,
      }),
      /provider response evidence is invalid/u,
    );
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("execution bundle rejects changed staged bytes even when hash-shaped metadata remains", async () => {
  const migrationModule = await executionModule();
  assert.equal(typeof migrationModule.assertSafeMigrationExecutionBundle, "function");
  const value = await fixture(migrationModule);
  try {
    const changed = structuredClone(value.bundle);
    const staged = JSON.parse(
      Buffer.from(changed.artifacts.stagedTransaction.bytesBase64, "base64"),
    );
    staged.role = "registrar";
    changed.artifacts.stagedTransaction.bytesBase64 = Buffer.from(
      `${JSON.stringify(staged, null, 2)}\n`,
    ).toString("base64");
    await assert.rejects(
      migrationModule.assertSafeMigrationExecutionBundle({
        bundle: changed,
        plan: value.plan,
        plannedRole: value.plan.transactions[0],
        nowTimestamp: 1_200,
      }),
      /artifact bytes or digest mismatch/u,
    );
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("execution bundle rejects an activation-enabled or non-preflight source plan", async () => {
  const migrationModule = await executionModule();
  const value = await fixture(migrationModule);
  try {
    const changedPlan = structuredClone(value.plan);
    changedPlan.activationAllowed = true;
    assert.throws(
      () => migrationModule.assertSafeMigrationSourcePlan(changedPlan),
      /source plan is invalid/u,
    );
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("pre-sign plan guard rejects forged target, calldata, value, owner, and gas", async () => {
  const migrationModule = await executionModule();
  assert.equal(typeof migrationModule.assertSafeMigrationPlanTransactions, "function");
  const { safePublicMigrationTransaction, safeTransactionHash } = await import(
    "../custom-registry-v2-safe-public-migration-guards.mjs"
  );
  const safe = "0x00000000000000000000000000000000000000a1";
  const legacyOwner = privateKeyToAccount(`0x${"11".repeat(32)}`).address;
  const hardwareOwners = [
    "0x0000000000000000000000000000000000003011",
    "0x0000000000000000000000000000000000003012",
    "0x0000000000000000000000000000000000003013",
  ];
  const multiSendCallOnly =
    "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";
  const migration = safePublicMigrationTransaction({
    safe,
    legacyOwner,
    hardwareOwners,
    safeNonce: 0n,
    multiSendCallOnly,
  });
  const transaction = {
    role: "approver",
    safe,
    legacyOwner,
    hardwareOwners,
    expectedOwners: migration.expectedOwners,
    expectedThreshold: 2,
    expectedSafeNonceBefore: "0",
    expectedSafeNonceAfter: "1",
    safeTransactionHash: safeTransactionHash({
      safe,
      transaction: migration.safeTransaction,
    }),
    outerTransaction: {
      type: "eip1559",
      chainId: 1,
      from: legacyOwner,
      to: safe,
      input: migration.execTransactionData,
      valueWei: "0",
      nonce: 7,
      gasLimit: "250000",
      maxFeePerGas: "30000000000",
      maxPriorityFeePerGas: "2000000000",
    },
    maximumCostWei: "7500000000000000",
  };
  const plan = {
    remainingRoles: ["approver"],
    transactions: [transaction],
    feeReview: {
      ownerAggregateCostCeilingWei: "8000000000000000",
      aggregateMaximumCostWei: transaction.maximumCostWei,
      reviewedMaxFeePerGas: transaction.outerTransaction.maxFeePerGas,
      reviewedMaxPriorityFeePerGas:
        transaction.outerTransaction.maxPriorityFeePerGas,
    },
  };
  const intentRoles = [
    { role: "approver", safe, legacyOwner, hardwareOwners },
  ];
  assert.equal(
    migrationModule.assertSafeMigrationPlanTransactions({
      plan,
      intentRoles,
      multiSendCallOnly,
    }),
    true,
  );
  for (const mutate of [
    (entry) => {
      entry.safe = "0x000000000000000000000000000000000000dead";
      entry.outerTransaction.to = entry.safe;
    },
    (entry) => {
      entry.outerTransaction.input = "0x";
    },
    (entry) => {
      entry.outerTransaction.valueWei = "1000000000000000000";
    },
    (entry) => {
      entry.legacyOwner = "0x000000000000000000000000000000000000beef";
      entry.outerTransaction.from = getAddress(entry.legacyOwner);
    },
    (entry) => {
      entry.outerTransaction.gasLimit = "999999999999999999";
    },
  ]) {
    const forged = structuredClone(plan);
    mutate(forged.transactions[0]);
    assert.throws(
      () =>
        migrationModule.assertSafeMigrationPlanTransactions({
          plan: forged,
          intentRoles,
          multiSendCallOnly,
        }),
      /exact transaction binding/u,
    );
  }
});

test("execution bundle rejects an authorization that does not cover every remaining plan role", async () => {
  const migrationModule = await executionModule();
  assert.equal(typeof migrationModule.assertSafeMigrationAuthorization, "function");
  const value = await fixture(migrationModule);
  try {
    const plan = structuredClone(value.plan);
    plan.remainingRoles.push("registrar");
    plan.transactions.push({
      ...structuredClone(plan.transactions[0]),
      role: "registrar",
      safe: "0x00000000000000000000000000000000000000b3",
      legacyOwner: "0x00000000000000000000000000000000000000b2",
      outerTransaction: {
        ...structuredClone(plan.transactions[0].outerTransaction),
        from: "0x00000000000000000000000000000000000000b2",
        to: "0x00000000000000000000000000000000000000b3",
      },
    });
    assert.throws(
      () =>
        migrationModule.assertSafeMigrationAuthorization({
          authorization: value.authorization,
          plan,
          planSha256: value.planSha256,
          stagedTransactions: [value.staged],
          stagedTransactionSha256ByRole: new Map([
            ["approver", value.bundle.artifacts.stagedTransaction.sha256],
          ]),
          nowTimestamp: 1_200,
        }),
      /every remaining migration role/u,
    );
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("expired authorization is accepted only for post-dispatch verification", async () => {
  const migrationModule = await executionModule();
  assert.equal(typeof migrationModule.assertSafeMigrationExecutionBundle, "function");
  const value = await fixture(migrationModule);
  try {
    await assert.rejects(
      migrationModule.assertSafeMigrationExecutionBundle({
        bundle: value.bundle,
        plan: value.plan,
        plannedRole: value.plan.transactions[0],
        nowTimestamp: 1_500,
      }),
      /stale or invalid/u,
    );
    await assert.doesNotReject(
      migrationModule.assertSafeMigrationExecutionBundle({
        bundle: value.bundle,
        plan: value.plan,
        plannedRole: value.plan.transactions[0],
        nowTimestamp: 1_500,
        allowExpired: true,
      }),
    );
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("read helper binds the protected bundle file digest before parsing", async () => {
  const migrationModule = await executionModule();
  assert.equal(typeof migrationModule.readSafeMigrationExecutionBundle, "function");
  const value = await fixture(migrationModule);
  try {
    const bundleBytes = Buffer.from(`${JSON.stringify(value.bundle, null, 2)}\n`);
    const bundlePath = path.join(value.directory, "bundle.json");
    await writeFile(bundlePath, bundleBytes, { mode: 0o600 });
    const parsed = await migrationModule.readSafeMigrationExecutionBundle({
      bundlePath,
      bundleSha256: sha256(bundleBytes),
      plan: value.plan,
      plannedRole: value.plan.transactions[0],
      nowTimestamp: 1_200,
    });
    assert.equal(parsed.bundle.role, "approver");
    await assert.rejects(
      migrationModule.readSafeMigrationExecutionBundle({
        bundlePath,
        bundleSha256: `0x${"00".repeat(32)}`,
        plan: value.plan,
        plannedRole: value.plan.transactions[0],
        nowTimestamp: 1_200,
      }),
      /bundle digest mismatch/u,
    );
    assert.equal((await readFile(bundlePath)).toString(), bundleBytes.toString());
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("continuation provenance binds the original authorized execution bundle", async () => {
  const migrationModule = await executionModule();
  assert.equal(
    typeof migrationModule.assertSafeMigrationContinuationExecutionBinding,
    "function",
  );
  const value = await fixture(migrationModule);
  try {
    const execution = await migrationModule.assertSafeMigrationExecutionBundle({
      bundle: value.bundle,
      plan: value.plan,
      plannedRole: value.plan.transactions[0],
      nowTimestamp: 1_500,
      allowExpired: true,
    });
    const entry = {
      role: "approver",
      transactionHash: value.staged.transactionHash,
      sourcePlanSha256: value.bundle.artifacts.plan.sha256,
      ownerAuthorizationSha256:
        value.bundle.artifacts.ownerAuthorization.sha256,
      transactionJournalSha256:
        value.bundle.artifacts.transactionJournal.sha256,
      executionBundlePath: "/protected/approver-execution.json",
      executionBundleSha256: `0x${"77".repeat(32)}`,
    };
    assert.equal(
      migrationModule.assertSafeMigrationContinuationExecutionBinding({
        entry,
        execution,
        executionBundlePath: entry.executionBundlePath,
        executionBundleSha256: entry.executionBundleSha256,
        migrationPlanDigest: value.plan.migrationPlanDigest,
        source: value.plan.source,
        darkSafeVerificationSha256: value.plan.darkSafeVerificationSha256,
        policySha256: value.plan.policySha256,
        safeControllerPolicySha256: value.plan.safeControllerPolicySha256,
        releasePolicySha256: value.plan.releasePolicySha256,
        predeploymentManifestSha256:
          value.plan.predeploymentManifestSha256,
        hardwareInventorySha256: value.plan.hardwareInventorySha256,
        releaseAuthorization: value.plan.releaseAuthorization,
      }),
      true,
    );
    assert.throws(
      () =>
        migrationModule.assertSafeMigrationContinuationExecutionBinding({
          entry: {
            ...entry,
            transactionJournalSha256: `0x${"00".repeat(32)}`,
          },
          execution,
          executionBundlePath: entry.executionBundlePath,
          executionBundleSha256: entry.executionBundleSha256,
          migrationPlanDigest: value.plan.migrationPlanDigest,
          source: value.plan.source,
          darkSafeVerificationSha256: value.plan.darkSafeVerificationSha256,
          policySha256: value.plan.policySha256,
          safeControllerPolicySha256: value.plan.safeControllerPolicySha256,
          releasePolicySha256: value.plan.releasePolicySha256,
          predeploymentManifestSha256:
            value.plan.predeploymentManifestSha256,
          hardwareInventorySha256: value.plan.hardwareInventorySha256,
          releaseAuthorization: value.plan.releaseAuthorization,
        }),
      /continuation execution provenance/u,
    );
    for (const mutate of [
      (binding) => {
        binding.darkSafeVerificationSha256 = `0x${"11".repeat(32)}`;
      },
      (binding) => {
        binding.safeControllerPolicySha256 = `0x${"22".repeat(32)}`;
      },
      (binding) => {
        binding.releasePolicySha256 = `0x${"33".repeat(32)}`;
      },
      (binding) => {
        binding.predeploymentManifestSha256 = `0x${"44".repeat(32)}`;
      },
      (binding) => {
        binding.releaseAuthorization = {
          ...binding.releaseAuthorization,
          owner: "0x0000000000000000000000000000000000000042",
        };
      },
    ]) {
      const binding = {
        entry,
        execution,
        executionBundlePath: entry.executionBundlePath,
        executionBundleSha256: entry.executionBundleSha256,
        migrationPlanDigest: value.plan.migrationPlanDigest,
        source: value.plan.source,
        darkSafeVerificationSha256: value.plan.darkSafeVerificationSha256,
        policySha256: value.plan.policySha256,
        safeControllerPolicySha256: value.plan.safeControllerPolicySha256,
        releasePolicySha256: value.plan.releasePolicySha256,
        predeploymentManifestSha256:
          value.plan.predeploymentManifestSha256,
        hardwareInventorySha256: value.plan.hardwareInventorySha256,
        releaseAuthorization: value.plan.releaseAuthorization,
      };
      mutate(binding);
      assert.throws(
        () =>
          migrationModule.assertSafeMigrationContinuationExecutionBinding(
            binding,
          ),
        /continuation execution provenance|release authorization/u,
      );
    }
    const historicalExecution = {
      ...execution,
      plan: {
        ...execution.plan,
        releaseAuthorization: {
          ...execution.plan.releaseAuthorization,
          owner: "0x0000000000000000000000000000000000000042",
        },
      },
    };
    assert.throws(
      () =>
        migrationModule.assertSafeMigrationContinuationExecutionBinding({
          entry,
          execution: historicalExecution,
          executionBundlePath: entry.executionBundlePath,
          executionBundleSha256: entry.executionBundleSha256,
          migrationPlanDigest: value.plan.migrationPlanDigest,
          source: value.plan.source,
          darkSafeVerificationSha256: value.plan.darkSafeVerificationSha256,
          policySha256: value.plan.policySha256,
          safeControllerPolicySha256: value.plan.safeControllerPolicySha256,
          releasePolicySha256: value.plan.releasePolicySha256,
          predeploymentManifestSha256:
            value.plan.predeploymentManifestSha256,
          hardwareInventorySha256: value.plan.hardwareInventorySha256,
          releaseAuthorization: value.plan.releaseAuthorization,
        }),
      /release authorization/u,
    );
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("finalized receipt must follow the durable dispatch-intent interval", async () => {
  const migrationModule = await executionModule();
  assert.equal(
    typeof migrationModule.assertSafeMigrationReceiptFollowsDispatchIntent,
    "function",
  );
  const value = await fixture(migrationModule);
  try {
    const execution = await migrationModule.assertSafeMigrationExecutionBundle({
      bundle: value.bundle,
      plan: value.plan,
      plannedRole: value.plan.transactions[0],
      nowTimestamp: 1_500,
      allowExpired: true,
    });
    assert.throws(
      () =>
        migrationModule.assertSafeMigrationReceiptFollowsDispatchIntent({
          receiptBlockTimestamp: 1_011n,
          execution,
        }),
      /must follow durable dispatch intent/u,
    );
    assert.equal(
      migrationModule.assertSafeMigrationReceiptFollowsDispatchIntent({
        receiptBlockTimestamp: 1_012n,
        execution,
      }),
      true,
    );
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("migration nonce preflight rejects an existing canonical dispatch intent", async () => {
  const migrationModule = await executionModule();
  assert.equal(typeof migrationModule.assertSafeMigrationSignerNonceAvailable, "function");
  const value = await fixture(migrationModule);
  try {
    const journalPath = canonicalTransactionJournalPath({
      chainId: 1,
      signer: value.legacy.address,
      nonce: 7,
    });
    await rm(journalPath, { force: true });
    assert.equal(
      migrationModule.assertSafeMigrationSignerNonceAvailable({
        signer: value.legacy.address,
        pendingNonces: [7, 7],
        finalizedNonces: [7, 7],
      }),
      7,
    );
    await writeFile(journalPath, "durable-intent\n", { mode: 0o600 });
    assert.throws(
      () =>
        migrationModule.assertSafeMigrationSignerNonceAvailable({
          signer: value.legacy.address,
          pendingNonces: [7, 7],
          finalizedNonces: [7, 7],
        }),
      /existing durable transaction intent blocks this signer and nonce/u,
    );
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("context reader resolves the original plan and unique role without caller decoding", async () => {
  const migrationModule = await executionModule();
  assert.equal(typeof migrationModule.readSafeMigrationExecutionBundleContext, "function");
  const value = await fixture(migrationModule);
  try {
    const bundleBytes = Buffer.from(`${JSON.stringify(value.bundle, null, 2)}\n`);
    const bundlePath = path.join(value.directory, "bundle-context.json");
    await writeFile(bundlePath, bundleBytes, { mode: 0o600 });
    const parsed = await migrationModule.readSafeMigrationExecutionBundleContext({
      bundlePath,
      bundleSha256: sha256(bundleBytes),
      nowTimestamp: 2_000,
      allowExpired: true,
    });
    assert.equal(parsed.plan.migrationPlanDigest, value.plan.migrationPlanDigest);
    assert.equal(parsed.plannedRole.role, "approver");
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("bundle creator content-addresses the four exact durable role artifacts", async () => {
  const migrationModule = await executionModule();
  assert.equal(typeof migrationModule.createSafeMigrationExecutionBundle, "function");
  const value = await fixture(migrationModule);
  try {
    const created = await migrationModule.createSafeMigrationExecutionBundle({
      role: "approver",
      planPath: value.bundle.artifacts.plan.path,
      planSha256: value.bundle.artifacts.plan.sha256,
      stagedTransactionPath:
        value.bundle.artifacts.stagedTransaction.path,
      stagedTransactionSha256:
        value.bundle.artifacts.stagedTransaction.sha256,
      ownerAuthorizationPath:
        value.bundle.artifacts.ownerAuthorization.path,
      ownerAuthorizationSha256:
        value.bundle.artifacts.ownerAuthorization.sha256,
      transactionJournalPath:
        value.bundle.artifacts.transactionJournal.path,
      transactionJournalSha256:
        value.bundle.artifacts.transactionJournal.sha256,
      nowTimestamp: 1_200,
      allowExpired: true,
    });
    assert.equal(created.bundle.transactionHash, value.staged.transactionHash);
    assert.equal(
      created.bundle.artifacts.transactionJournal.bytesBase64,
      value.bundle.artifacts.transactionJournal.bytesBase64,
    );
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("migration execution CLIs fail closed before any signing or RPC write", () => {
  const cases = [
    [
      "stage-custom-registry-v2-safe-public-migration-transaction.mjs",
      /explicit --stage-signed-transaction is required/u,
    ],
    [
      "authorize-custom-registry-v2-safe-public-migration.mjs",
      /--preflight is required/u,
    ],
    [
      "broadcast-custom-registry-v2-safe-public-migration.mjs",
      /explicit --broadcast is required/u,
    ],
    [
      "assemble-custom-registry-v2-safe-public-migration-receipts.mjs",
      /--output is required/u,
    ],
  ];
  for (const [name, expected] of cases) {
    const result = run(name);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test("migration recovery forbids creating a new dispatch intent", () => {
  const result = run(
    "broadcast-custom-registry-v2-safe-public-migration.mjs",
    [
      "--broadcast",
      "--recover",
      "--activate-dispatch-intent",
      `0x${"55".repeat(32)}`,
    ],
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /recovery forbids dispatch-intent activation/u);
});

test("receipt recovery appends only completion when receipt is already journaled", async () => {
  const migrationModule = await executionModule();
  assert.equal(typeof migrationModule.safeMigrationReceiptTailEvents, "function");
  const events = migrationModule.safeMigrationReceiptTailEvents({
    existingReceipt: {
      event: "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
      transactionHash: `0x${"11".repeat(32)}`,
      blockNumber: "123",
      blockHash: `0x${"22".repeat(32)}`,
    },
    transactionHash: `0x${"11".repeat(32)}`,
    blockNumber: 123n,
    blockHash: `0x${"22".repeat(32)}`,
    observedTrustedTime: trustedTime(2_000),
    completedTrustedTime: trustedTime(2_001),
  });
  assert.deepEqual(events.map(({ event }) => event), [
    "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
  ]);
  assert.throws(
    () =>
      migrationModule.safeMigrationReceiptTailEvents({
        existingReceipt: {
          event: "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
          transactionHash: `0x${"11".repeat(32)}`,
          blockNumber: "999",
          blockHash: `0x${"22".repeat(32)}`,
        },
        transactionHash: `0x${"11".repeat(32)}`,
        blockNumber: 123n,
        blockHash: `0x${"22".repeat(32)}`,
        observedTrustedTime: trustedTime(2_000),
        completedTrustedTime: trustedTime(2_001),
      }),
    /existing migration receipt differs/u,
  );
});

test("candidate migration journal record is fully validated before append", async () => {
  const migrationModule = await executionModule();
  assert.equal(typeof migrationModule.assertSafeMigrationJournalCandidate, "function");
  const value = await fixture(migrationModule);
  try {
    const badCandidate = {
      event: "BROADCAST_PROVIDER_RESPONSES",
      transactionHash: value.staged.transactionHash,
      requestStartedAtTimestamp: 1_012,
      requestStartedTrustedTime: trustedTime(1_012),
      responseObservedAtTimestamp: 1_013,
      responseObservedTrustedTime: trustedTime(1_013),
      providerResponses: value.plan.rpcProviderBindings.map((binding) => ({
        ...binding,
        status: "fulfilled",
        transactionHash: `0x${"99".repeat(32)}`,
      })),
    };
    assert.throws(
      () =>
        migrationModule.assertSafeMigrationJournalCandidate({
          records: value.journalRecords.slice(0, 3),
          candidate: badCandidate,
          plan: value.plan,
          plannedRole: value.plan.transactions[0],
          stagedTransaction: value.staged,
          stagedTransactionSha256:
            value.bundle.artifacts.stagedTransaction.sha256,
          authorization: value.authorization,
          authorizationSha256:
            value.bundle.artifacts.ownerAuthorization.sha256,
          planSha256: value.planSha256,
        }),
      /provider response evidence is invalid/u,
    );
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});
