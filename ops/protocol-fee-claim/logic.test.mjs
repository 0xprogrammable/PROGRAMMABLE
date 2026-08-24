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
  LAUNCH_STAMP_ROUTER,
  LAUNCH_STAMP_SELECTORS,
  LAUNCH_STAMP_TOPICS,
  MAINNET_CHAIN_ID,
  ROUTER_CUSTOM_CLAIM_PROFILES,
  SELECTORS,
  TREASURY,
  TOKEN_SELECTORS,
  atomicCapabilityStatus,
  buildWalletSendCalls,
  claimData,
  createRefreshQueue,
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
  decodeLaunchStampLog,
  decodeLaunchStampProof,
  decodeLaunchStampRecord,
  decodeAddress,
  decodeUint256,
  encodeAddressArgument,
  exactRouterFinalizedCheckpoint,
  formatEth,
  formatUnits,
  isTreasury,
  keccak256Hex,
  launchStampAddressReadData,
  launchStampBytes32ReadData,
  launchStampLogSetFingerprint,
  launchStampPoolReadData,
  normalizeBatchId,
  parseCustomV2Release,
  poolManagerBalanceOfData,
  readAccruedData,
  reduceClassicLaunchLogs,
  reduceCustomRegistryLogs,
  reduceLaunchStampLogs,
  requireAtomicClaimCapability,
  routerFinalizedBoundary,
  routerCustomClaimClassification,
  shortAddress,
  toQuantityHex,
  withTimeout,
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
  assert.equal(manifest.customV1.status, "HOLD");
  assert.equal(manifest.customV1.futureFinalizedStandardSourcesAutoAdded, false);
  assert.equal(
    manifest.schemaVersion,
    "programmable.fee-claim-discovery.v2",
  );
  assert.equal(
    manifest.launchStampRouter.address.toLowerCase(),
    LAUNCH_STAMP_ROUTER.address.toLowerCase(),
  );
  assert.equal(
    manifest.launchStampRouter.startBlock,
    LAUNCH_STAMP_ROUTER.startBlock.toString(),
  );
  assert.equal(
    manifest.launchStampRouter.runtimeCodeHash,
    LAUNCH_STAMP_ROUTER.runtimeCodeHash,
  );
  assert.equal(
    manifest.launchStampRouter.eventTopic,
    LAUNCH_STAMP_TOPICS.launchStamped,
  );
  assert.deepEqual(manifest.launchStampRouter.finality, {
    blockTag: LAUNCH_STAMP_ROUTER.finalizedTag,
    maximumProviderSpreadBlocks:
      LAUNCH_STAMP_ROUTER.maximumFinalizedSpread.toString(),
    policy:
      "bounded_three_provider_finalized_views_then_exact_common_block_hash_or_block",
  });
  assert.equal(
    manifest.launchStampRouter.futureRouterLaunchesAutoDiscovered,
    true,
  );
  assert.equal(
    manifest.launchStampRouter.unknownClaimProfile,
    "visible_and_block_all_claims",
  );
  assert.deepEqual(manifest.launchStampRouter.verification, [
    "router_and_trust_root_runtime_hashes",
    "exact_consensus_finalized_checkpoint_quorum",
    "independent_rpc_log_quorum",
    "router_claim_bindings_and_displayed_balances_at_finalized_checkpoint",
    "launch_id_by_token",
    "launch_id_by_pool_manager_and_pool_id",
    "launch_stamp_record_and_component_proofs",
    "route_and_hook_runtime_hashes_at_finalized_checkpoint",
  ]);
  assert.deepEqual(manifest.launchStampRouter.logQuorum.publicRpcEndpoints, [
    "https://eth.drpc.org",
    "https://rpc.mevblocker.io",
  ]);
  assert.deepEqual(
    manifest.launchStampRouter.claimProfiles.map(
      ({ id, launchId, source, runtimeCodeHash }) => ({
        id,
        launchId,
        source: source.toLowerCase(),
        runtimeCodeHash,
      }),
    ),
    [
      ROUTER_CUSTOM_CLAIM_PROFILES.nativeAccumulatorV1,
      ROUTER_CUSTOM_CLAIM_PROFILES.dualCurrencyRedeemerV1,
    ].map(({ id, bindings: [binding] }) => ({
      id,
      launchId: binding.launchId,
      source: binding.source.toLowerCase(),
      runtimeCodeHash: binding.runtimeCodeHash,
    })),
  );
  assert.equal(manifest.execution.atomicRequired, true);
  assert.equal(manifest.execution.maximumCallsPerAtomicBatch, 64);
  assert.equal(
    manifest.execution.preflightEveryCallImmediatelyBeforeWallet,
    true,
  );
  assert.equal(manifest.execution.unsupportedWalletBehavior, "fail_closed");
});

test("keeps the static Vercel scanner on wallet RPC and serializes refreshes", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(
    app,
    /const operation = provider\(\)\.request\(\{ method, params \}\);/,
  );
  assert.doesNotMatch(app, /fetch\(["']\/rpc/);
  assert.match(app, /const refreshClaims = createRefreshQueue\(refreshClaimsOnce\);/);
  assert.match(app, /await refreshClaims\(\);/);
  assert.match(app, /async function preflightClaimBatch\(claims\)/);
  assert.match(app, /\{ from: state\.account, to, data, value \}/);
  assert.match(app, /launchStampPoolReadData\(/);
  assert.match(app, /status: "retired",\s*registryVerified: true/);
  assert.match(
    app,
    /const finalizedBlock = await readRouterFinalizedBoundary\(\);/,
  );
  assert.match(
    app,
    /readVerifiedRouterLaunch\(candidate, finalizedTag\)/,
  );
  assert.doesNotMatch(
    app,
    /readVerifiedRouterLaunch\(candidate, finalizedTag, blockTag\)/,
  );
  assert.match(app, /withTimeout\(\s*operation,/);
});

test("queues one fresh scan when refresh is requested during an active scan", async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const runs = [];
  const refresh = createRefreshQueue(async () => {
    runs.push(runs.length + 1);
    if (runs.length === 1) await firstGate;
  });

  const first = refresh();
  await Promise.resolve();
  const second = refresh();
  const third = refresh();
  releaseFirst();
  await Promise.all([first, second, third]);

  assert.deepEqual(runs, [1, 2]);
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

function launchStampLog({
  launchId = `0x${"11".repeat(32)}`,
  token = "0x1234567890123456789012345678901234567890",
  hook = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  poolId = `0x${"22".repeat(32)}`,
  stampHash = `0x${"33".repeat(32)}`,
  block = 25_827_140n,
  index = 0n,
} = {}) {
  return {
    address: LAUNCH_STAMP_ROUTER.address,
    blockHash: `0x${"88".repeat(32)}`,
    blockNumber: `0x${block.toString(16)}`,
    transactionIndex: "0x1",
    logIndex: `0x${index.toString(16)}`,
    transactionHash: `0x${"44".repeat(32)}`,
    topics: [
      LAUNCH_STAMP_TOPICS.launchStamped,
      launchId,
      `0x${addressWord(token)}`,
      `0x${addressWord(hook)}`,
    ],
    data: `0x${[
      addressWord(LAUNCH_STAMP_ROUTER.poolManager.address),
      poolId.slice(2),
      stampHash.slice(2),
    ].join("")}`,
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

test("binds the canonical Mainnet Launch Stamp Router trust root", () => {
  assert.deepEqual(LAUNCH_STAMP_ROUTER, {
    address: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
    startBlock: 25_717_612n,
    endBlock: null,
    finalizedTag: "finalized",
    maximumFinalizedSpread: 32n,
    runtimeCodeHash:
      "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
    sourceCommit: "0a7134bbb912222639627fb9078df2f8dd3a6c38",
    sourceTree: "24ffb0c6b04af7993254560b4f03608de8f52231",
    abiSha256:
      "sha256:bb4e728e9f9c850eb01f928e8a798ac206a82e241a8d93b3b3c686635c88ed86",
    permitAuthority: {
      address: "0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b",
      runtimeCodeHash:
        "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
    },
    graphFactory: {
      address: "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
      runtimeCodeHash:
        "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
    },
    poolManager: {
      address: "0x000000000004444c5dc75cB358380D2e3dE08A90",
      runtimeCodeHash:
        "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
    },
  });
  assert.deepEqual(LAUNCH_STAMP_TOPICS, {
    launchStamped:
      "0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2",
    launchRouteStamped:
      "0x45e7cc355b63ca67d6278a0d8d23470ce2a0741a9c60283d7dee712df7a877a5",
    componentStamped:
      "0x8147265e7396d6400cee8d049456a1f7438fdfbe2a7c81c976d51ba67e52ff4b",
  });
  assert.deepEqual(LAUNCH_STAMP_SELECTORS, {
    chainId: "0x85e1f4d0",
    permitAuthority: "0xc3a3d03c",
    permitAuthorityRuntimeCodeHash: "0xa497c61c",
    graphFactory: "0x1cc9e5ce",
    graphFactoryRuntimeCodeHash: "0x92989a00",
    poolManager: "0x62308e85",
    poolManagerRuntimeCodeHash: "0x38d831c4",
    launchIdByToken: "0x1dad847c",
    launchIdByPool: "0x361df6f3",
    launchIdByComponent: "0x58c5e373",
    componentRuntimeCodeHash: "0xc892d353",
    launchStamp: "0x4c9e4764",
    stampProof: "0x174b9f9d",
  });
});

test("decodes and reduces canonical Launch Stamp events", () => {
  const older = launchStampLog({ block: 25_827_140n });
  const newer = launchStampLog({
    launchId: `0x${"55".repeat(32)}`,
    poolId: `0x${"66".repeat(32)}`,
    stampHash: `0x${"77".repeat(32)}`,
    block: 25_827_141n,
    index: 2n,
  });
  const decoded = decodeLaunchStampLog(older);
  assert.equal(decoded.launchId, older.topics[1]);
  assert.equal(decoded.token.toLowerCase(), `0x${older.topics[2].slice(-40)}`);
  assert.equal(decoded.hook.toLowerCase(), `0x${older.topics[3].slice(-40)}`);
  assert.equal(
    decoded.poolManager.toLowerCase(),
    LAUNCH_STAMP_ROUTER.poolManager.address.toLowerCase(),
  );
  assert.equal(decoded.poolId, `0x${"22".repeat(32)}`);
  assert.equal(decoded.stampHash, `0x${"33".repeat(32)}`);

  const launches = reduceLaunchStampLogs([older, newer]);
  assert.deepEqual(
    launches.map(({ launchId }) => launchId),
    [newer.topics[1], older.topics[1]],
  );
  assert.throws(
    () => reduceLaunchStampLogs([older, older]),
    /Doppelter Launch-Stamp/,
  );
  assert.equal(
    launchStampLogSetFingerprint([older, newer]),
    launchStampLogSetFingerprint([newer, older]),
  );
  assert.notEqual(
    launchStampLogSetFingerprint([older, newer]),
    launchStampLogSetFingerprint([older]),
  );
  assert.notEqual(
    launchStampLogSetFingerprint([older, newer]),
    launchStampLogSetFingerprint([]),
  );
  const sameSizeRawDivergence = {
    ...newer,
    data: `${newer.data.slice(0, -1)}${newer.data.endsWith("0") ? "1" : "0"}`,
  };
  assert.notEqual(
    launchStampLogSetFingerprint([older, newer]),
    launchStampLogSetFingerprint([older, sameSizeRawDivergence]),
  );
  const malformedAddressPadding = {
    ...older,
    topics: [
      older.topics[0],
      older.topics[1],
      `0x${"ff".repeat(12)}${older.topics[2].slice(-40)}`,
      older.topics[3],
    ],
  };
  assert.throws(
    () => launchStampLogSetFingerprint([malformedAddressPadding]),
    /Eventadresse/,
  );
  assert.throws(
    () =>
      decodeLaunchStampLog({
        ...older,
        data: `0x${[
          addressWord("0x0000000000000000000000000000000000000001"),
          "22".repeat(32),
          "33".repeat(32),
        ].join("")}`,
      }),
    /Identität ist unvollständig/,
  );
});

test("uses a bounded common finalized Router boundary and rejects a stale wallet view", () => {
  const older = {
    number: "0x18a1b37",
    hash: `0x${"ab".repeat(32)}`,
  };
  const newer = {
    number: "0x18a1b57",
    hash: `0x${"cd".repeat(32)}`,
  };
  assert.equal(
    routerFinalizedBoundary([older, newer, { ...newer }], 1n, 32n),
    BigInt(older.number),
  );
  assert.throws(
    () =>
      routerFinalizedBoundary(
        [{ ...older, number: "0x18a1b36" }, newer, { ...newer }],
        1n,
        32n,
      ),
    /zu weit auseinander/,
  );
});

test("requires one exact common Router checkpoint from all three RPCs", () => {
  const hash = `0x${"ab".repeat(32)}`;
  const block = { number: "0x18a1b17", hash };
  assert.deepEqual(
    exactRouterFinalizedCheckpoint([block, { ...block }, { ...block }], 1n),
    { number: 25_828_119n, hash },
  );
  assert.throws(
    () =>
      exactRouterFinalizedCheckpoint(
        [
          { number: "0x18a1ad0", hash: `0x${"cd".repeat(32)}` },
          block,
          { ...block },
        ],
        1n,
      ),
    /stimmt im RPC-Quorum nicht überein/,
  );
  assert.throws(
    () =>
      exactRouterFinalizedCheckpoint(
        [block, { ...block, hash: `0x${"ef".repeat(32)}` }, { ...block }],
        1n,
      ),
    /stimmt im RPC-Quorum nicht überein/,
  );
  assert.throws(
    () => exactRouterFinalizedCheckpoint([block, { ...block }], 1n),
    /fehlt im RPC-Quorum/,
  );
});

test("terminates a stalled scan RPC instead of occupying the refresh queue", async () => {
  await assert.rejects(
    withTimeout(
      new Promise(() => {}),
      5,
      "Wallet-RPC-Zeitlimit im Test überschritten",
    ),
    /Wallet-RPC-Zeitlimit im Test überschritten/,
  );
});

test("decodes exact Launch Stamp records, proofs and lookup calldata", () => {
  const launchId = `0x${"11".repeat(32)}`;
  const token = "0x1234567890123456789012345678901234567890";
  const hook = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  const routeLauncher = "0x9876543210987654321098765432109876543210";
  const hashes = Array.from({ length: 8 }, (_, index) =>
    (index + 2).toString(16).padStart(2, "0").repeat(32),
  );
  const recordWords = [
    word(1),
    addressWord(TREASURY),
    addressWord(token),
    addressWord(hook),
    addressWord(LAUNCH_STAMP_ROUTER.poolManager.address),
    hashes[0],
    hashes[1],
    hashes[2],
    hashes[3],
    addressWord(routeLauncher),
    hashes[4],
    hashes[5],
    hashes[6],
    hashes[7],
  ];
  const poolId = `0x${hashes[0]}`;
  const record = decodeLaunchStampRecord(`0x${recordWords.join("")}`);
  assert.equal(record.kind, 1);
  assert.equal(record.launchWallet.toLowerCase(), TREASURY.toLowerCase());
  assert.equal(record.token.toLowerCase(), token.toLowerCase());
  assert.equal(record.hook.toLowerCase(), hook.toLowerCase());
  assert.equal(record.routeLauncher.toLowerCase(), routeLauncher.toLowerCase());
  assert.equal(record.poolId, poolId);
  assert.equal(record.stampHash, `0x${hashes[7]}`);

  assert.deepEqual(
    decodeLaunchStampProof(`0x${launchId.slice(2)}${hashes[7]}`),
    { launchId, stampHash: `0x${hashes[7]}` },
  );
  assert.equal(
    launchStampBytes32ReadData(LAUNCH_STAMP_SELECTORS.launchStamp, launchId),
    `${LAUNCH_STAMP_SELECTORS.launchStamp}${launchId.slice(2)}`,
  );
  assert.equal(
    launchStampAddressReadData(LAUNCH_STAMP_SELECTORS.launchIdByToken, token),
    `${LAUNCH_STAMP_SELECTORS.launchIdByToken}${addressWord(token)}`,
  );
  assert.equal(
    launchStampPoolReadData(
      LAUNCH_STAMP_SELECTORS.launchIdByPool,
      LAUNCH_STAMP_ROUTER.poolManager.address,
      poolId,
    ),
    `${LAUNCH_STAMP_SELECTORS.launchIdByPool}${addressWord(LAUNCH_STAMP_ROUTER.poolManager.address)}${poolId.slice(2)}`,
  );
  assert.throws(
    () => decodeLaunchStampRecord(`0x${[word(3), ...recordWords.slice(1)].join("")}`),
    /Art wird nicht unterstützt/,
  );
  assert.throws(
    () => decodeLaunchStampProof(`0x${launchId.slice(2)}`),
    /ungültige ABI-Länge/,
  );
});

test("keeps the retired Custom Registry V1 policy inert", () => {
  assert.equal(CUSTOM_REGISTRY.status, "retired");
  assert.equal(
    CUSTOM_REGISTRY.address,
    "0x0000000000000000000000000000000000000000",
  );
  assert.equal(CUSTOM_REGISTRY.startBlock, 0n);
  assert.equal(CUSTOM_REGISTRY.runtimeCodeHash, null);
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
  assert.equal(
    customV2SourceClassification({
      ...custom,
      registered: true,
      quarantined: false,
      executable: true,
    }),
    "blocked",
  );
});

test("binds audited Router Custom profiles with exact read and claim calldata", () => {
  assert.deepEqual(ROUTER_CUSTOM_CLAIM_PROFILES, {
    nativeAccumulatorV1: {
      id: "native-accumulator-v1",
      bindings: [
        {
          launchId:
            "0x6d6ed0e1e69a7cd6afa177e3454c9e32eed61cbd3f855ee56aff1915a6776fc2",
          source: "0xd7451a039373f54e493deE42A751fEcBfAFBa0cc",
          runtimeCodeHash:
            "0xff70a4d3d889b730a064b270fc187f0cba40582f1fa6f5875893066b17a1257b",
        },
      ],
      recipient: "0x4968150a",
      feeBps: "0xb6c7448d",
      accrued: "0x0986bdb6",
      claim: "0xa95e4f21",
      expectedFeeBps: 10n,
    },
    protocolFeeSourceV1: {
      id: "protocol-fee-source-v1",
      bindings: [],
      recipient: CUSTOM_V2_SELECTORS.programmableFeeRecipient,
      feeBps: `${CUSTOM_V2_SELECTORS.programmableFeeBps}${"0".repeat(64)}`,
      accrued: `${CUSTOM_V2_SELECTORS.accruedProgrammableFees}${"0".repeat(64)}`,
      claim: `${CUSTOM_V2_SELECTORS.claimProgrammableFees}${"0".repeat(64)}`,
      expectedFeeBps: 10n,
    },
    dualCurrencyRedeemerV1: {
      id: "dual-currency-redeemer-v1",
      bindings: [
        {
          launchId:
            "0x5a52180427785716bff0a36218dde89f0459db265d0c2bdfcfde81a8fe733c92",
          source: "0xEBa46F25dff528141DE5317109aCB5a989296044",
          runtimeCodeHash:
            "0xd59d31add7a3b206972725889dbb726782c0fbd82514710cf2d645749dc3fa25",
        },
      ],
      recipient: "0x46904840",
      feePips: "0x9fa59765",
      poolManager: "0xdc4c90d3",
      currency0: "0x79f1232b",
      currency1: "0x10d737b8",
      poolId: "0x3e0dc34e",
      balanceOf: "0x00fdd58e",
      claim:
        "0xfc656ac500000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000",
      expectedFeePips: 1_000n,
      secondaryUnit: "PCAN",
      secondaryDecimals: 18,
    },
  });

  const nativeProfile = ROUTER_CUSTOM_CLAIM_PROFILES.nativeAccumulatorV1;
  const protocolProfile = ROUTER_CUSTOM_CLAIM_PROFILES.protocolFeeSourceV1;
  const nativeClaim = {
    id: "launch-stamp:fade",
    kind: "custom",
    address: "0xd7451a039373f54e493dee42a751fecbfafba0cc",
    readData: nativeProfile.accrued,
    claimData: nativeProfile.claim,
  };
  assert.equal(readAccruedData(nativeClaim), nativeProfile.accrued);
  assert.equal(claimData(nativeClaim), nativeProfile.claim);
  assert.equal(
    readAccruedData({ ...nativeClaim, readData: protocolProfile.accrued }),
    protocolProfile.accrued,
  );
  assert.equal(
    claimData({ ...nativeClaim, claimData: protocolProfile.claim }),
    protocolProfile.claim,
  );

  const pcanProfile = ROUTER_CUSTOM_CLAIM_PROFILES.dualCurrencyRedeemerV1;
  const pcanClaim = {
    id: "launch-stamp:pcan",
    kind: "custom",
    address: pcanProfile.bindings[0].source,
    claimData: pcanProfile.claim,
  };
  assert.equal(claimData(pcanClaim), pcanProfile.claim);
  assert.equal(
    poolManagerBalanceOfData(
      pcanProfile.balanceOf,
      pcanClaim.address,
      "0x9DEeB39D2590b0cAD5fc473F755C5F97Dcc8f7cE",
    ),
    `${pcanProfile.balanceOf}${encodeAddressArgument(pcanClaim.address)}${encodeAddressArgument("0x9DEeB39D2590b0cAD5fc473F755C5F97Dcc8f7cE")}`,
  );

  const batch = buildWalletSendCalls(TREASURY, [nativeClaim, pcanClaim]);
  assert.deepEqual(batch.calls, [
    {
      to: nativeClaim.address,
      data: nativeProfile.claim,
      value: "0x0",
    },
    {
      to: pcanClaim.address,
      data: pcanProfile.claim,
      value: "0x0",
    },
  ]);
  assert.throws(
    () => readAccruedData({ ...nativeClaim, readData: "0x1234" }),
    /Claim-Lesedaten/,
  );
  assert.throws(
    () => claimData({ ...nativeClaim, claimData: "0x1234" }),
    /Claim-Calldata/,
  );
});

test("classifies Router Custom claims fail-closed", () => {
  const ready = {
    id: "launch-stamp:fade",
    kind: "custom",
    origin: "launch-stamp-router",
    provenanceVerified: true,
    runtimeVerified: true,
    claimMode: "manual",
    claimBindingVerified: true,
    amount: 1n,
  };
  assert.equal(routerCustomClaimClassification(ready), "ready");
  assert.equal(
    routerCustomClaimClassification({ ...ready, amount: 0n }),
    "empty",
  );
  assert.equal(
    routerCustomClaimClassification({
      ...ready,
      amount: 0n,
      secondaryAmount: 1n,
    }),
    "ready",
  );
  assert.equal(
    routerCustomClaimClassification({
      ...ready,
      amount: 0n,
      secondaryAmount: undefined,
    }),
    "empty",
  );
  assert.equal(
    routerCustomClaimClassification({
      ...ready,
      amount: 0n,
      secondaryAmount: "1",
    }),
    "blocked",
  );
  assert.equal(
    routerCustomClaimClassification({ ...ready, amount: undefined }),
    "blocked",
  );
  assert.equal(
    routerCustomClaimClassification({ ...ready, runtimeVerified: false }),
    "blocked",
  );
  assert.equal(
    routerCustomClaimClassification({
      ...ready,
      claimMode: "no-manual-claim",
      claimBindingVerified: false,
      amount: undefined,
    }),
    "no-manual-claim",
  );
  assert.equal(
    customClaimDefinitionClassification(ready, { amount: 2n }),
    "ready",
  );
});

test("rejects duplicate onchain calls in one atomic batch", () => {
  const profile = ROUTER_CUSTOM_CLAIM_PROFILES.nativeAccumulatorV1;
  const first = {
    id: "launch-stamp:first",
    kind: "custom",
    address: "0xd7451a039373f54e493dee42a751fecbfafba0cc",
    claimData: profile.claim,
  };
  const duplicate = { ...first, id: "launch-stamp:second" };
  assert.throws(
    () => buildWalletSendCalls(TREASURY, [first, duplicate]),
    /Doppelter Claim im atomaren Batch/,
  );
});
