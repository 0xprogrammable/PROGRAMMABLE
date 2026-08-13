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
  assertHardwareOwnerControlProof,
  assertHardwareThresholdControlProof,
  hardwareOwnerControlTypedData,
  hardwareOwnerSetHash,
  hardwareThresholdControlTypedData,
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
