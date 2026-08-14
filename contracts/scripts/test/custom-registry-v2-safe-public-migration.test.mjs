import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  SAFE_PUBLIC_MIGRATION_ABI,
  assertSafePublicMigrationReceiptLogs,
  assertSafePublicMigrationReceiptTime,
  assertSafePublicMigrationReleaseAuthorization,
  assertSafePublicMigrationContinuationEvidence,
  assertHardwareOwnerControlProof,
  assertHardwareThresholdControlProof,
  hardwareOwnerControlTypedData,
  hardwareOwnerSetHash,
  hardwareThresholdControlTypedData,
  classifySafePublicMigrationState,
  prevalidatedOwnerSignature,
  safePublicMigrationBatch,
  safePublicMigrationTransaction,
  safeTransactionHash,
  sortedSafeSignatures,
} from "../custom-registry-v2-safe-public-migration-guards.mjs";

const safe = "0x0000000000000000000000000000000000001000";
const legacy = "0x0000000000000000000000000000000000002000";
const hardware = [
  "0x0000000000000000000000000000000000003001",
  "0x0000000000000000000000000000000000003002",
  "0x0000000000000000000000000000000000003003",
];
const multiSend = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";

test("builds one atomic legacy-removal migration to exact hardware 2-of-3", () => {
  const batch = safePublicMigrationBatch({
    safe,
    legacyOwner: legacy,
    hardwareOwners: hardware,
  });
  assert.deepEqual(batch.expectedOwners, [hardware[1], hardware[0], hardware[2]]);
  assert.equal(batch.calls.length, 3);
  assert.deepEqual(
    decodeFunctionData({ abi: SAFE_PUBLIC_MIGRATION_ABI, data: batch.calls[0] }),
    {
      functionName: "addOwnerWithThreshold",
      args: [getAddress(hardware[0]), 1n],
    },
  );
  assert.deepEqual(
    decodeFunctionData({ abi: SAFE_PUBLIC_MIGRATION_ABI, data: batch.calls[1] }),
    {
      functionName: "addOwnerWithThreshold",
      args: [getAddress(hardware[1]), 2n],
    },
  );
  assert.deepEqual(
    decodeFunctionData({ abi: SAFE_PUBLIC_MIGRATION_ABI, data: batch.calls[2] }),
    {
      functionName: "swapOwner",
      args: [getAddress(hardware[0]), getAddress(legacy), getAddress(hardware[2])],
    },
  );
});

test("binds the exact direct-owner prevalidated Safe transaction", () => {
  const migration = safePublicMigrationTransaction({
    safe,
    legacyOwner: legacy,
    hardwareOwners: hardware,
    safeNonce: 0,
    multiSendCallOnly: multiSend,
  });
  const decoded = decodeFunctionData({
    abi: SAFE_PUBLIC_MIGRATION_ABI,
    data: migration.execTransactionData,
  });
  assert.equal(decoded.functionName, "execTransaction");
  assert.equal(decoded.args[0], getAddress(multiSend));
  assert.equal(decoded.args[3], 1);
  assert.deepEqual(decoded.args.slice(4, 7), [0n, 0n, 0n]);
  assert.equal(decoded.args[9], prevalidatedOwnerSignature(legacy));
  const hash = safeTransactionHash({
    safe,
    transaction: migration.safeTransaction,
  });
  assert.match(hash, /^0x[0-9a-f]{64}$/u);
  assert.notEqual(hash, keccak256(migration.execTransactionData));
});

test("rejects duplicate or legacy hardware identities", () => {
  assert.throws(
    () =>
      safePublicMigrationBatch({
        safe,
        legacyOwner: legacy,
        hardwareOwners: [hardware[0], hardware[0], hardware[2]],
      }),
    /identities/u,
  );
  assert.throws(
    () =>
      safePublicMigrationBatch({
        safe,
        legacyOwner: legacy,
        hardwareOwners: [legacy, hardware[1], hardware[2]],
      }),
    /identities/u,
  );
});

test("verifies direct and shared threshold hardware control proofs", async () => {
  const accounts = [
    privateKeyToAccount(
      "0x1000000000000000000000000000000000000000000000000000000000000001",
    ),
    privateKeyToAccount(
      "0x2000000000000000000000000000000000000000000000000000000000000002",
    ),
    privateKeyToAccount(
      "0x3000000000000000000000000000000000000000000000000000000000000003",
    ),
  ];
  const source = {
    commit: "a".repeat(40),
    tree: "b".repeat(40),
  };
  const migrationPlanDigest = `0x${"11".repeat(32)}`;
  const nowTimestamp = 1_700_000_100;
  const trustedTime = {
    source: "sntp:time.apple.com",
    systemTimeMilliseconds: nowTimestamp * 1000,
    offsetMilliseconds: 0,
    uncertaintyMilliseconds: 1,
    adjustedTimeMilliseconds: nowTimestamp * 1000,
    adjustedTimestamp: nowTimestamp,
  };
  const directProof = {
    role: "approver",
    safe,
    hardwareOwner: accounts[0].address,
    ownerIndex: 0,
    migrationPlanDigest,
    sourceCommit: source.commit,
    sourceTree: source.tree,
    challenge: `0x${"22".repeat(32)}`,
    notBeforeTimestamp: nowTimestamp - 10,
    expiresAtTimestamp: nowTimestamp + 60,
    deviceDisplayVerified: true,
    independentCustodianAttested: true,
    independentSeedAndBackupAttested: true,
  };
  directProof.signature = await accounts[0].signTypedData(
    hardwareOwnerControlTypedData({
      proof: directProof,
      migrationPlanDigest,
      source,
    }),
  );
  assert.equal(
    await assertHardwareOwnerControlProof({
      proof: directProof,
      migrationPlanDigest,
      source,
      nowTimestamp,
      trustedTime,
    }),
    accounts[0].address,
  );

  const hardwareOwners = accounts.map(({ address }) => address);
  const thresholdProof = {
    role: "approver",
    safe,
    migrationPlanDigest,
    hardwareOwnerSetHash: hardwareOwnerSetHash(hardwareOwners),
    challenge: `0x${"33".repeat(32)}`,
    notBeforeTimestamp: nowTimestamp - 10,
    expiresAtTimestamp: nowTimestamp + 60,
  };
  const typedData = hardwareThresholdControlTypedData({
    proof: thresholdProof,
    migrationPlanDigest,
    source,
  });
  thresholdProof.signatures = await Promise.all(
    accounts.map(async (account) => ({
      hardwareOwner: account.address,
      signature: await account.signTypedData(typedData),
    })),
  );
  const result = await assertHardwareThresholdControlProof({
    proof: thresholdProof,
    role: "approver",
    safe,
    hardwareOwners,
    migrationPlanDigest,
    source,
    nowTimestamp,
    trustedTime,
  });
  assert.match(result.dataHash, /^0x[0-9a-f]{64}$/u);
  assert.equal(sortedSafeSignatures(result.signatures.slice(0, 2)).length, 262);
});

test("requires the exact Safe v1.4.1 owner-change event sequence", () => {
  const migration = safePublicMigrationTransaction({
    safe,
    legacyOwner: legacy,
    hardwareOwners: hardware,
    safeNonce: 0,
    multiSendCallOnly: multiSend,
  });
  const safeTxHash = safeTransactionHash({
    safe,
    transaction: migration.safeTransaction,
  });
  const eventLog = (eventName, args, dataTypes = [], dataValues = []) => ({
    address: safe,
    topics: encodeEventTopics({
      abi: SAFE_PUBLIC_MIGRATION_ABI,
      eventName,
      args,
    }),
    data:
      dataTypes.length === 0
        ? "0x"
        : encodeAbiParameters(dataTypes.map((type) => ({ type })), dataValues),
  });
  const logs = [
    eventLog("AddedOwner", { owner: hardware[0] }),
    eventLog("AddedOwner", { owner: hardware[1] }),
    eventLog("ChangedThreshold", {}, ["uint256"], [2n]),
    eventLog("RemovedOwner", { owner: legacy }),
    eventLog("AddedOwner", { owner: hardware[2] }),
    eventLog(
      "ExecutionSuccess",
      { txHash: safeTxHash },
      ["uint256"],
      [0n],
    ),
  ];
  assert.equal(
    assertSafePublicMigrationReceiptLogs({
      logs,
      safe,
      legacyOwner: legacy,
      hardwareOwners: hardware,
      safeTransactionHash: safeTxHash,
    }),
    true,
  );
  assert.throws(
    () =>
      assertSafePublicMigrationReceiptLogs({
        logs: [logs[1], logs[0], ...logs.slice(2)],
        safe,
        legacyOwner: legacy,
        hardwareOwners: hardware,
        safeTransactionHash: safeTxHash,
      }),
    /sequence/u,
  );
});

test("binds migration authority to the reviewed window without imposing a mining deadline", () => {
  const plan = {
    createdAtTimestamp: 1_700_000_100,
    expiresAtTimestamp: 1_700_000_700,
    createdAtTrustedTime: {
      source: "sntp:time.apple.com",
      systemTimeMilliseconds: 1_700_000_100_000,
      offsetMilliseconds: 0,
      uncertaintyMilliseconds: 1,
      adjustedTimeMilliseconds: 1_700_000_100_000,
      adjustedTimestamp: 1_700_000_100,
    },
    hardwareProofWindow: {
      notBeforeTimestamp: 1_700_000_000,
      expiresAtTimestamp: 1_700_001_000,
    },
  };
  assert.equal(
    assertSafePublicMigrationReceiptTime({
      receiptBlockTimestamp: 1_700_000_101n,
      plan,
    }),
    true,
  );
  assert.equal(
    assertSafePublicMigrationReceiptTime({
      receiptBlockTimestamp: 1_700_001_500n,
      plan,
    }),
    true,
  );
  assert.throws(
    () =>
      assertSafePublicMigrationReceiptTime({
        receiptBlockTimestamp: 1_700_000_100n,
        plan,
      }),
    /reviewed plan activation/u,
  );
});

test("classifies resumable legacy and migrated Safe states and rejects all others", () => {
  const common = {
    runtimeCodeKeccak256: `0x${"11".repeat(32)}`,
    version: "1.4.1",
    masterCopy: "0x0000000000000000000000000000000000004000",
    modules: [],
    nextModule: "0x0000000000000000000000000000000000000001",
    fallbackStorage: `0x${"00".repeat(32)}`,
    guardStorage: `0x${"00".repeat(32)}`,
  };
  const expected = {
    safe,
    legacyOwner: legacy,
    hardwareOwners: hardware,
    proxyRuntimeCodeKeccak256: common.runtimeCodeKeccak256,
    safeVersion: common.version,
    singleton: common.masterCopy,
  };
  assert.equal(
    classifySafePublicMigrationState({
      actual: {
        ...common,
        owners: [legacy],
        threshold: 1n,
        safeNonce: 0n,
      },
      expected,
    }),
    "LEGACY_ONE_OF_ONE_PENDING",
  );
  assert.equal(
    classifySafePublicMigrationState({
      actual: {
        ...common,
        owners: [hardware[1], hardware[0], hardware[2]],
        threshold: 2n,
        safeNonce: 1n,
      },
      expected,
    }),
    "MIGRATED_HARDWARE_TWO_OF_THREE_FINALIZED",
  );
  assert.throws(
    () =>
      classifySafePublicMigrationState({
        actual: {
          ...common,
          owners: [hardware[0]],
          threshold: 1n,
          safeNonce: 1n,
        },
        expected,
      }),
    /neither exact legacy nor migrated/u,
  );
});

test("requires exact completed role evidence for a mixed-state continuation", () => {
  const transaction = {
    role: "approver",
    transactionHash: `0x${"22".repeat(32)}`,
    blockNumber: "123",
    blockHash: `0x${"33".repeat(32)}`,
    sourcePlanSha256: `0x${"44".repeat(32)}`,
    ownerAuthorizationSha256: `0x${"55".repeat(32)}`,
    transactionJournalSha256: `0x${"66".repeat(32)}`,
    receiptEvidenceSha256: `0x${"88".repeat(32)}`,
    executionBundlePath:
      "/protected/migration/approver-execution-bundle.json",
    executionBundleSha256: `0x${"99".repeat(32)}`,
    receiptBlockTimestamp: 1_700_000_101,
    sourcePlanWindow: {
      createdAtTimestamp: 1_700_000_100,
      expiresAtTimestamp: 1_700_000_700,
      createdAtTrustedTime: {
        adjustedTimestamp: 1_700_000_100,
      },
    },
    reviewedTransaction: {
      input: "0x1234",
      nonce: 7,
      gasLimit: "100000",
      maxFeePerGas: "100",
      maxPriorityFeePerGas: "2",
    },
  };
  const evidence = {
    schemaVersion:
      "programmable.custom-registry-v2-safe-public-migration-continuation.v1",
    chainId: 1,
    migrationPlanDigest: `0x${"77".repeat(32)}`,
    status: "FINALIZED_PARTIAL_MIGRATIONS_BOUND_FOR_CONTINUATION",
    transactions: [transaction],
  };
  assert.equal(
    assertSafePublicMigrationContinuationEvidence({
      evidence,
      migrationPlanDigest: evidence.migrationPlanDigest,
      migratedRoles: ["approver"],
    }).get("approver"),
    transaction,
  );
  assert.throws(
    () =>
      assertSafePublicMigrationContinuationEvidence({
        evidence,
        migrationPlanDigest: evidence.migrationPlanDigest,
        migratedRoles: ["approver", "registrar"],
      }),
    /continuation evidence is invalid/u,
  );
  const missingBundle = structuredClone(evidence);
  delete missingBundle.transactions[0].executionBundleSha256;
  assert.throws(
    () =>
      assertSafePublicMigrationContinuationEvidence({
        evidence: missingBundle,
        migrationPlanDigest: evidence.migrationPlanDigest,
        migratedRoles: ["approver"],
      }),
    /continuation transaction is invalid/u,
  );
});

test("binds migration execution authority to the exact release owner workflow", () => {
  const releaseAuthorization = {
    owner: "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
    maximumDispatchIntentAuthorizationValiditySeconds: 300,
    authorizationSemantics:
      "EXACT_RAW_TRANSACTION_HASH_AUTHORIZED_DURABLE_DISPATCH_INTENT_ACTIVATES_LATER_IDENTICAL_RAW_SEND_REBROADCAST_AND_INCLUSION_NO_WORKFLOW_CANCELLATION",
    stagedRawTransactionTrustBoundary:
      "OWNER_ONLY_0400_CURRENT_USER_TEMPORARY_PUBLIC_ONE_OF_ONE_CUSTODY_WORKFLOW_NOT_AN_ONCHAIN_OWNER_GATE",
    dispatchIntentFinalConfirmation:
      "EXPLICIT_EXACT_TRANSACTION_HASH_REQUIRED_IMMEDIATELY_BEFORE_DURABLE_ACTIVATION",
    nonceScopedJournalExclusivity:
      "ONE_CANONICAL_CHAIN_SIGNER_NONCE_JOURNAL_BLOCKS_CHANGED_TRANSACTION_UNTIL_NONCE_IS_CANONICALLY_CONSUMED",
  };
  assert.equal(
    assertSafePublicMigrationReleaseAuthorization({
      actual: releaseAuthorization,
      expected: releaseAuthorization,
      releaseOwner: releaseAuthorization.owner,
    }),
    true,
  );
  assert.throws(
    () =>
      assertSafePublicMigrationReleaseAuthorization({
        actual: { ...releaseAuthorization, owner: legacy },
        expected: releaseAuthorization,
        releaseOwner: releaseAuthorization.owner,
      }),
    /release authorization/u,
  );
});
