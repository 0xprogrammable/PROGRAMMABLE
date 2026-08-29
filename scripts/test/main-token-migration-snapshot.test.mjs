import assert from "node:assert/strict";
import test from "node:test";

import {
  MAIN_TOKEN_MIGRATION_POLICY,
  buildMainTokenMigrationSnapshot,
  buildMainTokenMigrationSnapshotArtifact,
  canonicalJson,
  sha256CanonicalJson,
} from "../main-token-migration-snapshot-core.mjs";

const WINDOW_START = 1_800_000_000n;
const DEADLINE = WINDOW_START + 259_200n;
const SENDER_A = "0x1111111111111111111111111111111111111111";
const SENDER_B = "0x2222222222222222222222222222222222222222";
const CONTRACT_SENDER = "0x3333333333333333333333333333333333333333";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function hash(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function topicAddress(address) {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function makeLog({
  amountRaw,
  blockNumber = 15n,
  from = SENDER_A,
  logIndex = 0n,
  to = MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
  transactionIndex = 0n,
  txHash = hash(10_000n + logIndex),
} = {}) {
  return {
    address: MAIN_TOKEN_MIGRATION_POLICY.tokenAddress,
    blockHash: hash(1_000n + blockNumber),
    blockNumber,
    data: `0x${amountRaw.toString(16).padStart(64, "0")}`,
    logIndex,
    removed: false,
    topics: [
      MAIN_TOKEN_MIGRATION_POLICY.transferTopic,
      topicAddress(from),
      topicAddress(to),
    ],
    transactionHash: txHash,
    transactionIndex,
  };
}

function baseInput(overrides = {}) {
  const firstAmount = 9_007_199_254_740_993n;
  const secondAmount = 12_345_678_901_234_567_890n;
  const thirdAmount = 77n;
  const first = makeLog({
    amountRaw: firstAmount,
    blockNumber: 11n,
    logIndex: 1n,
    transactionIndex: 2n,
  });
  const second = makeLog({
    amountRaw: secondAmount,
    blockNumber: 12n,
    from: SENDER_B,
    logIndex: 0n,
    transactionIndex: 1n,
  });
  const third = makeLog({
    amountRaw: thirdAmount,
    blockNumber: 13n,
    from: SENDER_A,
    logIndex: 2n,
    transactionIndex: 0n,
  });
  const contractDeposit = makeLog({
    amountRaw: 5n,
    blockNumber: 14n,
    from: CONTRACT_SENDER,
    logIndex: 3n,
    transactionIndex: 0n,
  });
  const zero = makeLog({
    amountRaw: 0n,
    blockNumber: 15n,
    from: SENDER_B,
    logIndex: 4n,
    transactionIndex: 0n,
  });
  const closingBalanceRaw = firstAmount + secondAmount + thirdAmount + 5n;
  return {
    boundaryBlock: {
      hash: hash(121n),
      number: 121n,
      parentHash: hash(120n),
      timestamp: DEADLINE,
    },
    chainId: 1n,
    closingBalanceRaw,
    closingDecimals: 18n,
    closingRuntimeCode: "0x60006000",
    closingTotalSupplyRaw: MAIN_TOKEN_MIGRATION_POLICY.tokenTotalSupplyRaw,
    closingWalletCode: "0x",
    deadlineTimestamp: DEADLINE,
    endBlock: {
      hash: hash(120n),
      number: 120n,
      parentHash: hash(119n),
      timestamp: DEADLINE - 1n,
    },
    finalizedBlock: {
      hash: hash(130n),
      number: 130n,
      parentHash: hash(129n),
      timestamp: DEADLINE + 100n,
    },
    genesisHash: MAIN_TOKEN_MIGRATION_POLICY.ethereumGenesisHash,
    inboundLogs: [zero, third, first, second, first, contractDeposit],
    migrationWallet: MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
    openingBalanceRaw: 0n,
    openingDecimals: 18n,
    openingRuntimeCode: "0x60006000",
    openingTotalSupplyRaw: MAIN_TOKEN_MIGRATION_POLICY.tokenTotalSupplyRaw,
    openingWalletCode: "0x",
    outboundLogs: [],
    previousBlock: {
      hash: hash(9n),
      number: 9n,
      parentHash: hash(8n),
      timestamp: WINDOW_START - 1n,
    },
    startBlock: {
      hash: hash(10n),
      number: 10n,
      parentHash: hash(9n),
      timestamp: WINDOW_START,
    },
    tokenAddress: MAIN_TOKEN_MIGRATION_POLICY.tokenAddress,
    windowStartTimestamp: WINDOW_START,
    ...overrides,
  };
}

test("freezes the exact Ethereum V4 migration identities and 72-hour rule", () => {
  assert.equal(MAIN_TOKEN_MIGRATION_POLICY.chainId, 1n);
  assert.equal(
    MAIN_TOKEN_MIGRATION_POLICY.tokenAddress,
    "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
  );
  assert.equal(
    MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
    "0x14e24Ac373b3E65851627E4e757300Ac9053438C",
  );
  assert.equal(MAIN_TOKEN_MIGRATION_POLICY.tokenDecimals, 18n);
  assert.equal(MAIN_TOKEN_MIGRATION_POLICY.windowSeconds, 259_200n);
  assert.equal(
    MAIN_TOKEN_MIGRATION_POLICY.cutoffRule,
    "block.timestamp >= windowStart && block.timestamp < deadline",
  );
});

test("deduplicates, sorts, and aggregates raw units by Transfer event sender", () => {
  const input = baseInput();
  const snapshot = buildMainTokenMigrationSnapshot(input);
  assert.deepEqual(snapshot.allocations, [
    {
      address: SENDER_A,
      amountRaw: "9007199254741070",
      eventCount: "2",
    },
    {
      address: SENDER_B,
      amountRaw: "12345678901234567890",
      eventCount: "1",
    },
    {
      address: CONTRACT_SENDER,
      amountRaw: "5",
      eventCount: "1",
    },
  ]);
  assert.equal(snapshot.counts.deduplicatedTransferEventCount, "5");
  assert.equal(snapshot.counts.eligibleInboundEventCount, "4");
  assert.equal(snapshot.counts.zeroValueEventCount, "1");
  assert.equal(snapshot.reconciliation.openingBalanceRaw, "0");
  assert.equal(snapshot.reconciliation.inboundRaw, input.closingBalanceRaw.toString());
  assert.equal(snapshot.reconciliation.outboundRaw, "0");
  assert.equal(snapshot.reconciliation.matches, true);
  assert.deepEqual(
    snapshot.events.map((event) => event.blockNumber),
    ["11", "12", "13", "14", "15"],
  );
  assert.equal(snapshot.allocations[2].address, CONTRACT_SENDER);
});

test("emits byte-identical canonical JSON and a stable SHA-256 digest", () => {
  const firstInput = baseInput();
  const secondInput = baseInput({ inboundLogs: [...baseInput().inboundLogs].reverse() });
  const first = buildMainTokenMigrationSnapshot(firstInput);
  const second = buildMainTokenMigrationSnapshot(secondInput);
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(sha256CanonicalJson(first), sha256CanonicalJson(second));
  assert.equal(canonicalJson({ b: 2, a: 1 }), "{\"a\":1,\"b\":2}");
  const artifact = buildMainTokenMigrationSnapshotArtifact(first, true);
  assert.match(artifact.snapshotSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(artifact.rpcAgreement.independentEndpointCount, "2");
  assert.equal(artifact.rpcAgreement.snapshotsIdentical, true);
  assert.throws(
    () => buildMainTokenMigrationSnapshotArtifact(first, false),
    /two independent RPC snapshots were not confirmed/u,
  );
});

test("rejects any deadline that is not exactly 72 hours", () => {
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ deadlineTimestamp: DEADLINE + 1n })),
    /deadline is not exactly 72 hours/u,
  );
});

test("enforces the start and exclusive deadline block boundaries", () => {
  const earlyStart = baseInput();
  earlyStart.startBlock.timestamp = WINDOW_START - 1n;
  assert.throws(
    () => buildMainTokenMigrationSnapshot(earlyStart),
    /start block is before the window start/u,
  );

  const lateEnd = baseInput();
  lateEnd.endBlock.timestamp = DEADLINE;
  assert.throws(
    () => buildMainTokenMigrationSnapshot(lateEnd),
    /end block is not before the exclusive deadline/u,
  );

  const earlyBoundary = baseInput();
  earlyBoundary.boundaryBlock.timestamp = DEADLINE - 1n;
  assert.throws(
    () => buildMainTokenMigrationSnapshot(earlyBoundary),
    /boundary block does not reach the exclusive deadline/u,
  );
});

test("requires the block after the deadline window to be finalized", () => {
  const input = baseInput();
  input.finalizedBlock.number = input.boundaryBlock.number - 1n;
  assert.throws(
    () => buildMainTokenMigrationSnapshot(input),
    /deadline boundary is not finalized/u,
  );
});

test("rejects conflicting txHash plus logIndex duplicates", () => {
  const input = baseInput();
  const original = input.inboundLogs[2];
  const conflict = {
    ...original,
    data: `0x${99n.toString(16).padStart(64, "0")}`,
  };
  input.inboundLogs.push(conflict);
  assert.throws(
    () => buildMainTokenMigrationSnapshot(input),
    /duplicate .* has conflicting event bytes/u,
  );
});

test("fails closed on any nonzero outbound transfer", () => {
  const outbound = makeLog({
    amountRaw: 1n,
    blockNumber: 16n,
    from: MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
    logIndex: 20n,
    to: SENDER_A,
  });
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ outboundLogs: [outbound] })),
    /nonzero outbound transfer/u,
  );
});

test("fails closed on self-transfers and mint-to-wallet events", () => {
  const selfTransfer = makeLog({
    amountRaw: 1n,
    blockNumber: 16n,
    from: MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
    logIndex: 21n,
    to: MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
  });
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({
      inboundLogs: [selfTransfer],
      outboundLogs: [selfTransfer],
    })),
    /nonzero self-transfer/u,
  );

  const mint = makeLog({
    amountRaw: 1n,
    blockNumber: 16n,
    from: ZERO_ADDRESS,
    logIndex: 22n,
  });
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ inboundLogs: [mint] })),
    /received a nonzero mint/u,
  );
});

test("requires zero opening balance and exact balance reconciliation", () => {
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ openingBalanceRaw: 1n })),
    /opening V4 balance is nonzero/u,
  );
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ closingBalanceRaw: 1n })),
    /do not reconcile/u,
  );
});

test("rejects wrong chain, token, wallet code, and removed or wrong-emitter logs", () => {
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ chainId: 2n })),
    /chainId is not Ethereum mainnet/u,
  );
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ genesisHash: hash(0n) })),
    /genesis hash is not Ethereum mainnet/u,
  );
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ closingWalletCode: "0x6000" })),
    /not an unchanged plain Ethereum account/u,
  );

  const removedInput = baseInput();
  removedInput.inboundLogs[0].removed = true;
  assert.throws(
    () => buildMainTokenMigrationSnapshot(removedInput),
    /removed or lacks a removal marker/u,
  );

  const wrongEmitterInput = baseInput();
  wrongEmitterInput.inboundLogs[0].address = SENDER_A;
  assert.throws(
    () => buildMainTokenMigrationSnapshot(wrongEmitterInput),
    /address is not the frozen address/u,
  );
});
