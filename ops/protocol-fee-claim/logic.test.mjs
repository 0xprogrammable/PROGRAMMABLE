import test from "node:test";
import assert from "node:assert/strict";
import {
  CLAIMS,
  CUSTOM_EVENT_TOPICS,
  CUSTOM_FEE_POLICY_KIND,
  CUSTOM_REGISTRY,
  HOOKS,
  MAINNET_CHAIN_ID,
  SELECTORS,
  TREASURY,
  atomicCapabilityStatus,
  buildClaimTransaction,
  buildWalletSendCalls,
  claimData,
  customLaunchClassification,
  customLaunchStateData,
  decodeCustomLaunchState,
  decodeCustomRegistryLog,
  decodeAddress,
  decodeUint256,
  encodeAddressArgument,
  formatEth,
  formatUnits,
  isTreasury,
  keccak256Hex,
  normalizeBatchId,
  readAccruedData,
  reduceCustomRegistryLogs,
  shortAddress,
  toQuantityHex,
} from "./logic.mjs";

test("binds exactly Classic and deployed Stock fee sources", () => {
  assert.equal(HOOKS.length, 5);
  assert.equal(CLAIMS.filter(({ kind }) => kind === "native").length, 3);
  assert.equal(CLAIMS.filter(({ kind }) => kind === "asset").length, 18);
  assert.ok(
    HOOKS.every(
      ({ address, runtimeCodeHash }) =>
        /^0x[0-9a-fA-F]{40}$/.test(address) &&
        /^0x[0-9a-f]{64}$/.test(runtimeCodeHash),
    ),
  );
  assert.equal(
    HOOKS.some(({ id }) => id.includes("deep")),
    false,
  );
});

test("uses the deployed claim and read selectors", () => {
  assert.deepEqual(SELECTORS, {
    launcherFeesAccrued: "0x1497233e",
    launcherAssetFeesAccrued: "0x31b8ca96",
    launcherFeeRecipient: "0x4c50e2c4",
    claimLauncherFees: "0x64d46b85",
    claimLauncherAssetFees: "0xaee8cd6f",
    customRegistrationCount: "0x0d3eafd6",
    customLaunchState: "0x2b76b49c",
  });
});

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressWord(address) {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function eventLog(topic, launchId, dataWords = [], extraTopics = []) {
  return {
    address: CUSTOM_REGISTRY.address,
    blockNumber: "0x18835f0",
    logIndex: "0x1",
    transactionHash: `0x${"44".repeat(32)}`,
    topics: [topic, launchId, ...extraTopics],
    data: `0x${dataWords.join("")}`,
  };
}

test("binds the deployed Custom Registry and canonical discovery topics", () => {
  assert.equal(
    CUSTOM_REGISTRY.address,
    "0x17e18c88bda9bfb73924cdc989c07b0707e72671",
  );
  assert.equal(CUSTOM_REGISTRY.startBlock, 25_701_139n);
  assert.match(CUSTOM_REGISTRY.runtimeCodeHash, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(CUSTOM_EVENT_TOPICS), [
    "registered",
    "provenance",
    "feePolicy",
    "finalized",
    "revoked",
  ]);
  assert.ok(
    Object.values(CUSTOM_EVENT_TOPICS).every((topic) =>
      /^0x[0-9a-f]{64}$/.test(topic),
    ),
  );
});

test("reduces a finalized Custom fee launch without inventing a claim call", () => {
  const launchId = `0x${"11".repeat(32)}`;
  const projectId = `0x${"22".repeat(32)}`;
  const feePolicyHash = `0x${"33".repeat(32)}`;
  const runtimeHash = `0x${"55".repeat(32)}`;
  const primary = "0x1234567890123456789012345678901234567890";
  const logs = [
    eventLog(
      CUSTOM_EVENT_TOPICS.registered,
      launchId,
      [
        word(1),
        word(1),
        word(1),
        "66".repeat(32),
        "77".repeat(32),
        addressWord(TREASURY),
        "88".repeat(32),
        "99".repeat(32),
        word(25_701_424),
      ],
      [projectId, `0x${addressWord(primary)}`],
    ),
    eventLog(
      CUSTOM_EVENT_TOPICS.provenance,
      launchId,
      [
        "01".repeat(32),
        "02".repeat(32),
        "03".repeat(32),
        "04".repeat(32),
        "05".repeat(32),
        "06".repeat(32),
        runtimeHash.slice(2),
      ],
      [`0x${"aa".repeat(32)}`, `0x${"bb".repeat(32)}`],
    ),
    eventLog(
      CUSTOM_EVENT_TOPICS.feePolicy,
      launchId,
      [
        word(CUSTOM_FEE_POLICY_KIND.native),
        word(10),
        word(10),
        word(0),
        word(10),
        addressWord("0x0000000000000000000000000000000000000000"),
        addressWord(TREASURY),
      ],
      [feePolicyHash, `0x${"00".repeat(32)}`],
    ),
    eventLog(CUSTOM_EVENT_TOPICS.finalized, launchId),
  ];
  logs.forEach((log, index) => {
    log.logIndex = `0x${index.toString(16)}`;
  });

  assert.equal(decodeCustomRegistryLog(logs[0]).type, "registered");
  const [launch] = reduceCustomRegistryLogs(logs);
  assert.equal(launch.primaryContract.toLowerCase(), primary.toLowerCase());
  assert.equal(launch.primaryRuntimeCodeHash, runtimeHash);
  assert.equal(launch.feePolicy.programmableShareBps, 10);
  assert.equal(launch.finalized, true);
  assert.throws(
    () => reduceCustomRegistryLogs([...logs, logs[0]]),
    /Doppelte Custom-Registrierung/,
  );
  assert.throws(
    () =>
      decodeCustomRegistryLog({
        ...logs[0],
        address: "0x0000000000000000000000000000000000000001",
      }),
    /nicht kanonisch/,
  );
  assert.equal(
    customLaunchClassification({
      ...launch,
      currentStatus: 2,
      stateVerified: true,
      runtimeVerified: true,
    }),
    "adapter-required",
  );
});

test("recognizes the live no-market canary as non-claimable", () => {
  assert.equal(
    customLaunchClassification({
      finalized: true,
      revoked: false,
      currentStatus: 2,
      stateVerified: true,
      runtimeVerified: true,
      feePolicy: {
        kind: CUSTOM_FEE_POLICY_KIND.noQualifyingMarket,
        programmableShareBps: 0,
        programmableRecipient: "0x0000000000000000000000000000000000000000",
      },
    }),
    "no-market",
  );
});

test("fails closed on unverified Custom runtime or fee recipient", () => {
  const base = {
    finalized: true,
    revoked: false,
    currentStatus: 2,
    stateVerified: true,
    runtimeVerified: true,
    feePolicy: {
      kind: CUSTOM_FEE_POLICY_KIND.native,
      programmableShareBps: 10,
      programmableRecipient: TREASURY,
    },
  };
  assert.equal(
    customLaunchClassification({ ...base, runtimeVerified: false }),
    "blocked",
  );
  assert.equal(
    customLaunchClassification({
      ...base,
      feePolicy: {
        ...base.feePolicy,
        programmableRecipient: "0x0000000000000000000000000000000000000001",
      },
    }),
    "blocked",
  );
});

test("encodes and decodes exact Custom launch state reads", () => {
  const launchId = `0x${"ab".repeat(32)}`;
  assert.equal(
    customLaunchStateData(launchId),
    `${SELECTORS.customLaunchState}${launchId.slice(2)}`,
  );
  const feePolicyHash = `0x${"cd".repeat(32)}`;
  const stateData = `0x${[
    word(2),
    word(1),
    word(2),
    word(1),
    "11".repeat(32),
    "22".repeat(32),
    feePolicyHash.slice(2),
    "33".repeat(32),
  ].join("")}`;
  assert.deepEqual(decodeCustomLaunchState(stateData), {
    status: 2,
    feePolicyHash,
  });
});

test("checks the immutable treasury without checksum assumptions", () => {
  assert.equal(isTreasury(TREASURY.toLowerCase()), true);
  assert.equal(isTreasury("0x0000000000000000000000000000000000000000"), false);
});

test("decodes ABI words", () => {
  const addressWord = `0x${"0".repeat(24)}${TREASURY.slice(2).toLowerCase()}`;
  assert.equal(
    decodeAddress(addressWord).toLowerCase(),
    TREASURY.toLowerCase(),
  );
  assert.equal(decodeUint256("0x0de0b6b3a7640000"), 1_000_000_000_000_000_000n);
});

test("formats ETH and RPC quantities", () => {
  assert.equal(formatEth(1_408_228_182_792_482_473n), "1.408228");
  assert.equal(formatEth(1_000_000_000_000_000_000n), "1");
  assert.equal(formatUnits(199_592_153_522_990_767n, 18), "0.199592");
  assert.equal(toQuantityHex(21_000n), "0x5208");
  assert.equal(shortAddress(TREASURY), "0x4957…376c");
});

test("encodes Stock asset reads and claims", () => {
  const stockClaim = CLAIMS.find(({ kind }) => kind === "asset");
  assert.ok(stockClaim);
  const argument = encodeAddressArgument(stockClaim.asset);
  assert.equal(argument.length, 64);
  assert.equal(
    readAccruedData(stockClaim),
    `${SELECTORS.launcherAssetFeesAccrued}${argument}`,
  );
  assert.equal(
    claimData(stockClaim),
    `${SELECTORS.claimLauncherAssetFees}${argument}`,
  );
});

test("matches Ethereum Keccak-256 vectors used for runtime binding", () => {
  assert.equal(
    keccak256Hex("0x"),
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
  );
  assert.equal(
    keccak256Hex("0x68656c6c6f"),
    "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
  );
});

test("detects MetaMask atomic batching support", () => {
  assert.equal(
    atomicCapabilityStatus({
      [MAINNET_CHAIN_ID]: { atomic: { status: "supported" } },
    }),
    "supported",
  );
  assert.equal(
    atomicCapabilityStatus({
      [MAINNET_CHAIN_ID]: { atomic: { status: "ready" } },
    }),
    "ready",
  );
  assert.equal(atomicCapabilityStatus({}), null);
});

test("builds an EIP-5792 atomic claim batch", () => {
  const claims = [CLAIMS[0], CLAIMS.find(({ kind }) => kind === "asset")];
  const batch = buildWalletSendCalls(TREASURY, claims);
  assert.equal(batch.version, "2.0.0");
  assert.equal(batch.chainId, MAINNET_CHAIN_ID);
  assert.equal(batch.atomicRequired, true);
  assert.equal(batch.calls.length, 2);
  assert.deepEqual(batch.calls[0], {
    to: claims[0].address,
    data: SELECTORS.claimLauncherFees,
    value: "0x0",
  });
  assert.throws(
    () =>
      buildWalletSendCalls(
        "0x0000000000000000000000000000000000000000",
        claims,
      ),
    /Treasury/,
  );
});

test("builds only treasury-origin direct fallback transactions", () => {
  const transaction = buildClaimTransaction(TREASURY, CLAIMS[0]);
  assert.deepEqual(transaction, {
    from: TREASURY,
    to: CLAIMS[0].address,
    data: SELECTORS.claimLauncherFees,
    value: "0x0",
  });
  assert.throws(
    () =>
      buildClaimTransaction(
        "0x0000000000000000000000000000000000000000",
        CLAIMS[0],
      ),
    /Treasury/,
  );
});

test("normalizes MetaMask batch identifiers", () => {
  assert.equal(normalizeBatchId({ id: "0x1234" }), "0x1234");
  assert.equal(normalizeBatchId("0xabcd"), "0xabcd");
  assert.throws(() => normalizeBatchId({}), /Batch-ID/);
});
