import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLASSIC_LAUNCHERS,
  CLAIMS,
  CUSTOM_EVENT_TOPICS,
  CUSTOM_FEE_POLICY_KIND,
  CUSTOM_REGISTRY,
  CUSTOM_V2_POLICY,
  CUSTOM_V2_SELECTORS,
  HOOKS,
  MAINNET_CHAIN_ID,
  SELECTORS,
  TREASURY,
  TOKEN_SELECTORS,
  atomicCapabilityStatus,
  buildWalletSendCalls,
  claimData,
  customClaimDefinitionClassification,
  customLaunchClassification,
  customLaunchStateData,
  customV2Bytes32ReadData,
  customV2IndexedReadData,
  customV2SourceClassification,
  decodeAbiString,
  decodeClassicLaunchLog,
  decodeCustomLaunchState,
  decodeCustomV2SourceState,
  decodeCustomRegistryLog,
  decodeAddress,
  decodeUint256,
  encodeAddressArgument,
  formatEth,
  formatUnits,
  isTreasury,
  keccak256Hex,
  normalizeBatchId,
  parseCustomV2Release,
  readAccruedData,
  reduceClassicLaunchLogs,
  reduceCustomRegistryLogs,
  requireAtomicClaimCapability,
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

test("keeps the public claim discovery manifest aligned with the scanner", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("./claim-discovery.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.chainId, BigInt(MAINNET_CHAIN_ID).toString());
  assert.equal(manifest.rewardWallet.toLowerCase(), TREASURY.toLowerCase());
  assert.deepEqual(
    manifest.classic.launchDiscovery.map(
      ({ launcher, startBlock, eventTopic, feeHook }) => ({
        launcher: launcher.toLowerCase(),
        startBlock,
        eventTopic,
        feeHook: feeHook.toLowerCase(),
      }),
    ),
    CLASSIC_LAUNCHERS.map(({ address, startBlock, eventTopic, feeHook }) => ({
      launcher: address.toLowerCase(),
      startBlock: startBlock.toString(),
      eventTopic,
      feeHook: feeHook.toLowerCase(),
    })),
  );
  assert.equal(
    manifest.classic.legacyAggregateClaim.feeHook.toLowerCase(),
    HOOKS.find(({ id }) => id === "classic-v1").address.toLowerCase(),
  );
  assert.equal(
    manifest.stock.claimLegCount,
    CLAIMS.filter(({ kind }) => kind === "asset").length,
  );
  assert.equal(
    manifest.customV1.registry.toLowerCase(),
    CUSTOM_REGISTRY.address.toLowerCase(),
  );
  assert.equal(
    manifest.customV1.startBlock,
    CUSTOM_REGISTRY.startBlock.toString(),
  );
  assert.equal(manifest.execution.atomicRequired, true);
  assert.equal(manifest.execution.unsupportedWalletBehavior, "fail_closed");
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

test("binds the verified V2 and V3 Classic launch discovery sources", () => {
  assert.equal(CLASSIC_LAUNCHERS.length, 2);
  assert.deepEqual(
    CLASSIC_LAUNCHERS.map(({ id }) => id),
    ["classic-v3", "classic-v2"],
  );
  assert.ok(
    CLASSIC_LAUNCHERS.every(
      ({ address, startBlock, runtimeCodeHash, eventTopic, feeHook }) =>
        /^0x[0-9a-fA-F]{40}$/.test(address) &&
        startBlock > 0n &&
        /^0x[0-9a-f]{64}$/.test(runtimeCodeHash) &&
        /^0x[0-9a-f]{64}$/.test(eventTopic) &&
        /^0x[0-9a-fA-F]{40}$/.test(feeHook),
    ),
  );
  assert.deepEqual(TOKEN_SELECTORS, {
    name: "0x06fdde03",
    symbol: "0x95d89b41",
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

function classicLog(launcher, { block = 25_700_000n, index = 0n } = {}) {
  const creator = "0x1234567890123456789012345678901234567890";
  const token = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  return {
    address: launcher.address,
    blockNumber: `0x${block.toString(16)}`,
    logIndex: `0x${index.toString(16)}`,
    transactionHash: `0x${"44".repeat(32)}`,
    topics: [
      launcher.eventTopic,
      `0x${addressWord(creator)}`,
      `0x${addressWord(token)}`,
      `0x${"55".repeat(32)}`,
    ],
    data: `0x${addressWord(launcher.feeHook)}`,
  };
}

function abiString(value) {
  const bytes = Buffer.from(value, "utf8").toString("hex");
  const padded = bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0");
  return `0x${word(32)}${word(bytes.length / 2)}${padded}`;
}

test("decodes token metadata used for readable Classic launch rows", () => {
  assert.equal(decodeAbiString(abiString("PROGRAMMABLE")), "PROGRAMMABLE");
  assert.equal(decodeAbiString(abiString("PINK")), "PINK");
  assert.throws(() => decodeAbiString("0x1234"), /unvollständig/);
});

test("reduces canonical Classic V2 and V3 launch events newest first", () => {
  const v3 = CLASSIC_LAUNCHERS[0];
  const v2 = CLASSIC_LAUNCHERS[1];
  const v3Log = classicLog(v3, { block: 25_700_002n });
  const v2Log = classicLog(v2, { block: 25_700_001n });
  v2Log.topics[2] = `0x${addressWord("0x1111111111111111111111111111111111111111")}`;
  v2Log.topics[3] = `0x${"66".repeat(32)}`;

  const launches = reduceClassicLaunchLogs([
    { launcher: v2, log: v2Log },
    { launcher: v3, log: v3Log },
  ]);
  assert.equal(launches.length, 2);
  assert.equal(launches[0].releaseId, "classic-v3");
  assert.equal(launches[1].releaseId, "classic-v2");
  assert.equal(launches[0].feeHook.toLowerCase(), v3.feeHook.toLowerCase());
  assert.equal(decodeClassicLaunchLog(v3Log, v3).blockNumber, 25_700_002n);

  assert.throws(
    () =>
      decodeClassicLaunchLog(
        {
          ...v3Log,
          data: `0x${addressWord("0x0000000000000000000000000000000000000001")}`,
        },
        v3,
      ),
    /Fee-Hook stimmt nicht/,
  );
  assert.throws(
    () =>
      reduceClassicLaunchLogs([
        { launcher: v3, log: v3Log },
        { launcher: v3, log: v3Log },
      ]),
    /Doppelter Classic-Launch/,
  );
});

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
  assert.equal(
    customLaunchClassification({
      ...base,
      standardClaimBindingVerified: true,
      amount: 123n,
    }),
    "ready",
  );
  assert.equal(
    customLaunchClassification({
      ...base,
      feePolicy: {
        ...base.feePolicy,
        kind: CUSTOM_FEE_POLICY_KIND.partner,
        programmableShareBps: 5,
      },
      standardClaimBindingVerified: true,
      amount: 0n,
    }),
    "empty",
  );
  assert.equal(
    customClaimDefinitionClassification(
      {
        ...base,
        kind: "custom",
        standardClaimBindingVerified: true,
        amount: 123n,
      },
      { amount: 123n, recipientMatches: true, status: "ready" },
    ),
    "ready",
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

test("fails closed instead of opening sequential wallet confirmations", () => {
  assert.equal(requireAtomicClaimCapability("supported"), "supported");
  assert.equal(requireAtomicClaimCapability("ready"), "ready");
  assert.throws(
    () => requireAtomicClaimCapability(null),
    /Es wurde nichts gesendet/,
  );
});

test("normalizes MetaMask batch identifiers", () => {
  assert.equal(normalizeBatchId({ id: "0x1234" }), "0x1234");
  assert.equal(normalizeBatchId("0xabcd"), "0xabcd");
  assert.throws(() => normalizeBatchId({}), /Batch-ID/);
});

function activeCustomV2Release() {
  const contract = (suffix) => ({
    address: `0x${suffix.repeat(40)}`,
    runtimeCodeHash: `0x${suffix.repeat(64)}`,
  });
  return {
    schemaVersion: CUSTOM_V2_POLICY.schemaVersion,
    status: "READY_FOR_MANUAL_CLAIM",
    activationAllowed: true,
    sourceRevision: {
      repository: "https://github.com/0xprogrammable/programmable",
      commit: "1".repeat(40),
      tree: "2".repeat(40),
    },
    deployment: { chainId: "1", startBlock: "25750000" },
    contracts: {
      sourceRegistry: contract("1"),
      customRegistryV2: contract("2"),
      customRegistrar: contract("3"),
      launchStampRouter: contract("4"),
    },
    policy: {
      asset: CUSTOM_V2_POLICY.nativeAsset,
      recipient: TREASURY,
      programmableFeeBps: "10",
      claimSelector: CUSTOM_V2_POLICY.claimSelector,
      sourceInterfaceId: CUSTOM_V2_POLICY.sourceInterfaceId,
      minimumActivationDelayBlocks: "64",
      minimumLaunchFinalityBlocks: "64",
    },
  };
}

test("keeps Custom V2 disabled until an exact deployed release is bound", () => {
  assert.deepEqual(
    parseCustomV2Release({
      schemaVersion: CUSTOM_V2_POLICY.schemaVersion,
      status: "HOLD",
      activationAllowed: false,
    }),
    { active: false, status: "HOLD" },
  );
  const release = parseCustomV2Release(activeCustomV2Release());
  assert.equal(release.active, true);
  assert.equal(release.startBlock, 25_750_000n);
  assert.equal(
    release.contracts.customRegistrar.address,
    `0x${"3".repeat(40)}`,
  );

  assert.throws(
    () =>
      parseCustomV2Release({
        ...activeCustomV2Release(),
        policy: {
          ...activeCustomV2Release().policy,
          recipient: "0x0000000000000000000000000000000000000001",
        },
      }),
    /Fee-Policy/,
  );
  assert.throws(
    () =>
      parseCustomV2Release({
        ...activeCustomV2Release(),
        contracts: {
          ...activeCustomV2Release().contracts,
          customRegistrar: {
            address: `0x${"3".repeat(40)}`,
            runtimeCodeHash: null,
          },
        },
      }),
    /Runtime/,
  );
  assert.throws(
    () =>
      parseCustomV2Release({
        ...activeCustomV2Release(),
        contracts: {
          ...activeCustomV2Release().contracts,
          launchStampRouter: activeCustomV2Release().contracts.customRegistrar,
        },
      }),
    /eindeutig/,
  );
});

test("binds the exact Custom V2 selectors and decodes one source record", () => {
  assert.deepEqual(CUSTOM_V2_SELECTORS, {
    finalizedSourceCount: "0xf8ec37a7",
    finalizedLaunchIdAt: "0xcb2235c0",
    finalizedSourceIdAt: "0xf5f62028",
    isFinalizedExecutable: "0xcb2b7132",
    launchIdForSource: "0x3eeacd13",
    sourceState: "0x447c24c0",
    sourceRegistry: "0xee9ab677",
    customRegistryV2: "0xab0adbf2",
    launchStampRouter: "0xa87eb510",
    supportedChainId: "0x356c6567",
    chainId: "0x85e1f4d0",
    registryGeneration: "0x8ca2d907",
    minimumFinalityBlocks: "0x03580b1c",
    minimumActivationDelayBlocks: "0x92636c45",
    rewardWallet: "0xb66ceef6",
    claimSelector: "0x7011b80b",
    sourceInterfaceId: "0x1b11e61b",
    programmableFeeRecipient: "0x424ff2a5",
    accruedProgrammableFees: "0x3129853d",
    totalProgrammableFeesClaimed: "0x4a383b32",
    programmableFeeBps: "0x32c0314d",
    claimProgrammableFees: "0xb9d2fad0",
  });
  const sourceId = `0x${"ab".repeat(32)}`;
  const source = "0x1234567890123456789012345678901234567890";
  const runtime = `0x${"cd".repeat(32)}`;
  const stateData = `0x${[
    sourceId.slice(2),
    addressWord(source),
    runtime.slice(2),
    addressWord(CUSTOM_V2_POLICY.nativeAsset),
    `${CUSTOM_V2_POLICY.claimSelector.slice(2)}${"0".repeat(56)}`,
    addressWord(TREASURY),
    word(25_750_064),
    word(1),
    word(0),
  ].join("")}`;
  assert.deepEqual(decodeCustomV2SourceState(stateData), {
    sourceId,
    source,
    runtimeCodeHash: runtime,
    asset: CUSTOM_V2_POLICY.nativeAsset,
    claimSelector: CUSTOM_V2_POLICY.claimSelector,
    recipient: TREASURY.toLowerCase(),
    activationBlock: 25_750_064n,
    registered: true,
    quarantined: false,
  });
  assert.equal(
    customV2IndexedReadData(CUSTOM_V2_SELECTORS.finalizedSourceIdAt, 7n),
    `${CUSTOM_V2_SELECTORS.finalizedSourceIdAt}${word(7)}`,
  );
  assert.equal(
    customV2Bytes32ReadData(CUSTOM_V2_SELECTORS.sourceState, sourceId),
    `${CUSTOM_V2_SELECTORS.sourceState}${sourceId.slice(2)}`,
  );
});

test("builds direct permissionless Custom claims into the same wallet batch", () => {
  const custom = {
    id: "custom-v2:source",
    hookId: "custom-v2",
    name: "Custom V2",
    detail: "Launch 1",
    kind: "custom",
    address: "0x1234567890123456789012345678901234567890",
    asset: CUSTOM_V2_POLICY.nativeAsset,
    unit: "ETH",
    decimals: 18,
    bindingVerified: true,
  };
  assert.equal(
    readAccruedData(custom),
    `${CUSTOM_V2_SELECTORS.accruedProgrammableFees}${"0".repeat(64)}`,
  );
  assert.equal(
    claimData(custom),
    `${CUSTOM_V2_SELECTORS.claimProgrammableFees}${"0".repeat(64)}`,
  );
  const batch = buildWalletSendCalls(TREASURY, [CLAIMS[0], custom]);
  assert.deepEqual(batch.calls[1], {
    to: custom.address,
    data: `${CUSTOM_V2_SELECTORS.claimProgrammableFees}${"0".repeat(64)}`,
    value: "0x0",
  });
  assert.equal(
    customV2SourceClassification({
      ...custom,
      amount: 1n,
      registered: true,
      quarantined: false,
      executable: true,
    }),
    "ready",
  );
  assert.equal(
    customV2SourceClassification({
      ...custom,
      amount: 0n,
      registered: true,
      quarantined: false,
      executable: true,
    }),
    "empty",
  );
});
