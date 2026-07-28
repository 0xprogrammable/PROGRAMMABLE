#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import Ajv from "ajv";
import {
  concatHex,
  createPublicClient,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  getCreateAddress,
  http,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
} from "viem";
import { mainnet } from "viem/chains";

const root = path.resolve(import.meta.dirname, "..", "..");
const contractsRoot = path.join(root, "contracts");
const releasePath = path.join(
  contractsRoot,
  "deployments",
  "mainnet-deep-full-range-v1.json",
);
const appManifestPath = path.join(
  contractsRoot,
  "config",
  "app-deployments.v1.json",
);
const dependencySnapshotPath = path.join(
  contractsRoot,
  "dependencies",
  "ethereum-mainnet.json",
);
const releaseSchemaPath = path.join(
  contractsRoot,
  "deployments",
  "schema",
  "deep-full-range-release-v1.schema.json",
);
const lifecycleEvidencePath = path.join(
  contractsRoot,
  "deployments",
  "evidence",
  "deep-full-range-mainnet-canary-v1.json",
);
const requireLive = process.argv.includes("--require-live");
const offline = process.argv.includes("--offline");
if (requireLive && offline) {
  throw new Error("--require-live cannot be combined with --offline");
}

const expectedTreasury = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
const expectedForwarderFactory =
  "0x291a9ff1059d225d02B1659430804486404dB507";
const expectedReleaseManifest =
  "contracts/deployments/mainnet-deep-full-range-v1.json";
const expectedLifecycleEvidenceHash =
  "0x98d978a75cf42c698089765d558bfda5ee6a8bbc4f9377a51a8a1777b08b83eb";
const expectedLifecycleEvidence = {
  schemaVersion: 1,
  releaseVersion: "deep-full-range-v1",
  releaseCommit: "75d00e2369cd8bc67421859270c0fbf3edc478ff",
  chainId: 1,
  account: "0x2bb333d48dfaf1596d9036671d2e43168994249e",
  launcher: "0x7aef9a4038fabb1d477bbfd3a106f81b93eb5aeb",
  automation: "0x856a8e8421e76f55cd1e0d65b4f3c1b474289b2f",
  feeHook: "0x48dc3009ec1d3298bba31f718a9a29d02fc9b0cc",
  token: "0x3a778578b3a21dd842c29be3d1816b1af37d54f3",
  growthVault: "0x3e311de17c37071504f534bb46d4b5fb59f37549",
  poolId:
    "0x9f865e32ce5486b5a72eb5edc290b497a4c40605a303db1e28bc33a37638ab9c",
  launchHash:
    "0x2f095043ea96c40ca356b89e5c3e18792fc8820ed8d9c6116b4a44ca85514896",
  launchTransaction:
    "0xde8041b9d960d72478e6264c745679ce6c17e19959ec15aa283590f3f0fffa4d",
  keeperTransaction:
    "0x7af2803cf42d8ab8455c875549b5637fd3e9969fa4d5e5ba8a7296707f132a47",
  oracleCardinalityNext: 18,
};
const deployedFields = [
  "feeSplitVaultFactory",
  "hookFactory",
  "feeHook",
  "rangeSourceFactory",
  "growthVaultFactory",
  "growthVaultImplementation",
  "launcher",
  "automation",
  "positionPlanner",
];
const externalTransactionFields = [
  "feeSplitVaultFactory",
  "hookFactory",
  "feeHook",
  "rangeSourceFactory",
  "growthVaultFactory",
  "launcher",
];
const exactGitCommits = {
  "v4-core": "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc",
  "v4-periphery": "ad04c9f24a170accf5ea1b2836bbafd514537ca6",
  "openzeppelin-contracts": "21c8312b022f495ebe3621d5daeed20552b43ff9",
  "openzeppelin-uniswap-hooks":
    "26dc8e53f812a1ca390d470342adb6cd8c3286ad",
  "liquidity-launcher": "e4660afe4f820f4a39181c7ea1f9bce6c423499f",
  "uerc20-factory": "6f18f1cdf80dc173d33d3cd6bbe91ee52c314f68",
};
const artifactDefinitions = {
  feeSplitVaultFactory: [
    "FeeSplitVaultFactoryV1.sol",
    "FeeSplitVaultFactoryV1",
  ],
  feeSplitVault: ["FeeSplitVaultV1.sol", "FeeSplitVaultV1"],
  hookFactory: [
    "LiquidityGrowthFeeOracleHookFactoryV1.sol",
    "LiquidityGrowthFeeOracleHookFactoryV1",
  ],
  feeHookTemplate: [
    "LiquidityGrowthFeeOracleHookV1.sol",
    "LiquidityGrowthFeeOracleHookV1",
  ],
  rangeSourceFactory: [
    "LiquidityGrowthRangeSourceFactoryV1.sol",
    "LiquidityGrowthRangeSourceFactoryV1",
  ],
  rangeSource: [
    "LiquidityGrowthRangeSourceV1.sol",
    "LiquidityGrowthRangeSourceV1",
  ],
  growthVaultFactoryTemplate: [
    "LiquidityGrowthFullRangeVaultFactoryV1.sol",
    "LiquidityGrowthFullRangeVaultFactoryV1",
  ],
  growthVaultImplementationTemplate: [
    "LiquidityGrowthFullRangeVaultV1.sol",
    "LiquidityGrowthFullRangeVaultV1",
  ],
  launcherTemplate: [
    "LiquidityGrowthFullRangeLaunchV1.sol",
    "LiquidityGrowthFullRangeLaunchV1",
  ],
  automationTemplate: [
    "LiquidityGrowthFullRangeAutomationV1.sol",
    "LiquidityGrowthFullRangeAutomationV1",
  ],
  positionPlanner: [
    "LiquidityGrowthFullRangePositionPlannerV1.sol",
    "LiquidityGrowthFullRangePositionPlannerV1",
  ],
};

const hookAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function maxAbsTickDelta() view returns (int24)",
  "function LAUNCHER_FEE_BPS() view returns (uint16)",
  "function MIN_TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function MAX_TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function TOTAL_SWAP_FEE_STEP_BPS() view returns (uint16)",
  "function TRANSFER_TAX_BPS() view returns (uint16)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
]);
const hookFactoryAbi = parseAbi([
  "function ALL_HOOK_MASK() view returns (uint160)",
  "function REQUIRED_HOOK_FLAGS() view returns (uint160)",
  "function isFactoryHook(address hook) view returns (bool)",
]);
const growthFactoryAbi = parseAbi([
  "function implementation() view returns (address)",
  "function hookFactory() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function positionManager() view returns (address)",
  "function poolManager() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function rangeSourceFactory() view returns (address)",
]);
const growthImplementationAbi = parseAbi([
  "function FACTORY() view returns (address)",
]);
const launcherAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function rangeSourceFactory() view returns (address)",
  "function growthVaultFactory() view returns (address)",
  "function automation() view returns (address)",
  "function positionPlanner() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function TOKEN_RESERVE_TARGET() view returns (uint256)",
  "function GROWTH_TARGET_NATIVE() view returns (uint256)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
  "function INITIAL_TICK() view returns (int24)",
  "function TICK_SPACING() view returns (int24)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TWAP_WINDOW() view returns (uint32)",
  "function MAX_SPOT_TWAP_DEVIATION_TICKS() view returns (int24)",
  "function MAX_ABS_TICK_DELTA() view returns (int24)",
]);
const automationAbi = parseAbi([
  "function vaultFactory() view returns (address)",
  "function launcher() view returns (address)",
  "function MAX_BATCH_SIZE() view returns (uint256)",
  "function OBSERVATION_CARDINALITY_TARGET() view returns (uint16)",
  "function MIN_ORACLE_ACTIVATION_NATIVE() view returns (uint256)",
]);
const lifecycleLauncherAbi = parseAbi([
  "function growthVaultOf(address token) view returns (address)",
  "function launchHashOf(address token) view returns (bytes32)",
  "event LiquidityGrowthFullRangeTokenLaunched(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address growthVault,address oracleGuard,address upstreamRewardVault,address positionRecipient,uint256 positionTokenId,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 vaultConfigurationHash,bytes32 launchHash)",
  "event LiquidityGrowthFullRangeCreatorInitialBuy(address indexed deployer,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,bytes32 launchHash)",
]);
const lifecycleAutomationAbi = parseAbi([
  "function isRegisteredVault(address vault) view returns (bool)",
  "function stageOracle(address vaultAddress) returns (bool grew,uint16 previousCardinalityNext,uint16 newCardinalityNext)",
  "event OracleGrowthStaged(address indexed vault,bytes32 indexed poolId,address indexed executor,uint16 previousCardinalityNext,uint16 newCardinalityNext)",
]);
const lifecycleHookAbi = parseAbi([
  "function stateById(bytes32 poolId) view returns (uint16 index,uint16 cardinality,uint16 cardinalityNext)",
  "event IncreaseObservationCardinalityNext(bytes32 indexed poolId,uint16 observationCardinalityNextOld,uint16 observationCardinalityNextNew)",
]);
const lifecycleVaultAbi = parseAbi([
  "function poolId() view returns (bytes32)",
]);
const forwarderFactoryAbi = parseAbi([
  "function positionManager() view returns (address)",
]);

function fail(message) {
  throw new Error(message);
}

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function validHash(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function validCommit(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function validBlock(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function unique(values) {
  return [...new Set(values)];
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function readCanonicalLifecycleEvidence() {
  const raw = await fs.readFile(lifecycleEvidencePath);
  let evidence;
  try {
    evidence = JSON.parse(raw.toString("utf8"));
  } catch {
    fail("Deep lifecycle evidence is not valid JSON");
  }
  const evidenceHash = keccak256(raw);
  if (evidenceHash !== expectedLifecycleEvidenceHash) {
    fail("Deep lifecycle evidence bytes differ from the reviewed artifact");
  }
  const expected = expectedLifecycleEvidence;
  if (
    evidence.schemaVersion !== expected.schemaVersion ||
    evidence.releaseVersion !== expected.releaseVersion ||
    evidence.releaseCommit !== expected.releaseCommit ||
    evidence.chainId !== expected.chainId ||
    !sameAddress(evidence.account, expected.account) ||
    !sameAddress(evidence.launcher, expected.launcher) ||
    !sameAddress(evidence.automation, expected.automation) ||
    !sameAddress(evidence.feeHook, expected.feeHook) ||
    !sameAddress(evidence.token, expected.token) ||
    !sameAddress(evidence.growthVault, expected.growthVault) ||
    evidence.poolId !== expected.poolId ||
    evidence.launchHash !== expected.launchHash ||
    evidence.launch?.transactionHash !== expected.launchTransaction ||
    evidence.keeper?.transactionHash !== expected.keeperTransaction ||
    evidence.postState?.oracleCardinalityNext !==
      expected.oracleCardinalityNext
  ) {
    fail("Deep lifecycle evidence differs from the reviewed Mainnet canary");
  }
  if (
    evidence.launch.blockNumber !== 25_632_994 ||
    evidence.launch.blockHash !==
      "0x36fecdb27df170c3f975c073e042bb16d02d96dc87eb28e5ad6215d390c23ccb" ||
    evidence.launch.nonce !== 40 ||
    evidence.launch.valueWei !== "600000000000000" ||
    !validHash(evidence.launch.calldataHash) ||
    evidence.launch.buySwapFeeBps !== 100 ||
    evidence.launch.sellSwapFeeBps !== 100 ||
    evidence.keeper.blockNumber !== 25_632_999 ||
    evidence.keeper.blockHash !==
      "0x2c0ad1d7a5feedd46151312e832f5762e06596d2a933a4ed876b0f7ef8f84336" ||
    evidence.keeper.nonce !== 41 ||
    evidence.keeper.valueWei !== "0" ||
    !validHash(evidence.keeper.calldataHash) ||
    evidence.keeper.previousCardinalityNext !== 2 ||
    evidence.keeper.newCardinalityNext !== 18
  ) {
    fail("Deep lifecycle transaction evidence is malformed");
  }
  return { evidence, evidenceHash };
}

function lifecycleEvent(receipt, address, abi, eventName) {
  const matches = [];
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, address)) continue;
    try {
      const decoded = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      if (decoded.eventName === eventName) matches.push(decoded.args);
    } catch {
      // Logs emitted by another event on the same contract are irrelevant.
    }
  }
  if (matches.length !== 1) {
    fail(`Deep lifecycle expected exactly one ${eventName} event`);
  }
  return matches[0];
}

async function verifyLifecycleThroughClient(client, evidence) {
  const launchBlock = BigInt(evidence.launch.blockNumber);
  const keeperBlock = BigInt(evidence.keeper.blockNumber);
  const [
    launchTransaction,
    launchReceipt,
    keeperTransaction,
    keeperReceipt,
  ] = await Promise.all([
    client.getTransaction({ hash: evidence.launch.transactionHash }),
    client.getTransactionReceipt({ hash: evidence.launch.transactionHash }),
    client.getTransaction({ hash: evidence.keeper.transactionHash }),
    client.getTransactionReceipt({ hash: evidence.keeper.transactionHash }),
  ]);

  if (
    launchTransaction.blockNumber !== launchBlock ||
    launchTransaction.blockHash !== evidence.launch.blockHash ||
    launchTransaction.nonce !== evidence.launch.nonce ||
    !sameAddress(launchTransaction.from, evidence.account) ||
    !sameAddress(launchTransaction.to, evidence.launcher) ||
    launchTransaction.value !== BigInt(evidence.launch.valueWei) ||
    keccak256(launchTransaction.input) !== evidence.launch.calldataHash ||
    launchReceipt.status !== "success" ||
    launchReceipt.blockNumber !== launchBlock ||
    launchReceipt.blockHash !== evidence.launch.blockHash
  ) {
    fail("Deep canary launch transaction or receipt differs");
  }
  const expectedKeeperInput = encodeFunctionData({
    abi: lifecycleAutomationAbi,
    functionName: "stageOracle",
    args: [evidence.growthVault],
  });
  if (
    keeperTransaction.blockNumber !== keeperBlock ||
    keeperTransaction.blockHash !== evidence.keeper.blockHash ||
    keeperTransaction.nonce !== evidence.keeper.nonce ||
    !sameAddress(keeperTransaction.from, evidence.account) ||
    !sameAddress(keeperTransaction.to, evidence.automation) ||
    keeperTransaction.value !== BigInt(evidence.keeper.valueWei) ||
    keeperTransaction.input !== expectedKeeperInput ||
    keccak256(keeperTransaction.input) !== evidence.keeper.calldataHash ||
    keeperReceipt.status !== "success" ||
    keeperReceipt.blockNumber !== keeperBlock ||
    keeperReceipt.blockHash !== evidence.keeper.blockHash
  ) {
    fail("Deep canary keeper transaction or receipt differs");
  }
  if (
    launchReceipt.logs.some((log) => log.removed) ||
    keeperReceipt.logs.some((log) => log.removed)
  ) {
    fail("Deep lifecycle evidence contains a removed log");
  }

  const launchEvent = lifecycleEvent(
    launchReceipt,
    evidence.launcher,
    lifecycleLauncherAbi,
    "LiquidityGrowthFullRangeTokenLaunched",
  );
  if (
    !sameAddress(launchEvent.deployer, evidence.account) ||
    !sameAddress(launchEvent.token, evidence.token) ||
    launchEvent.poolId !== evidence.poolId ||
    !sameAddress(launchEvent.feeHook, evidence.feeHook) ||
    !sameAddress(launchEvent.growthVault, evidence.growthVault) ||
    Number(launchEvent.buySwapFeeBps) !== evidence.launch.buySwapFeeBps ||
    Number(launchEvent.sellSwapFeeBps) !==
      evidence.launch.sellSwapFeeBps ||
    launchEvent.launchHash !== evidence.launchHash
  ) {
    fail("Deep canary launch event differs");
  }
  const initialBuyEvent = lifecycleEvent(
    launchReceipt,
    evidence.launcher,
    lifecycleLauncherAbi,
    "LiquidityGrowthFullRangeCreatorInitialBuy",
  );
  if (
    !sameAddress(initialBuyEvent.deployer, evidence.account) ||
    !sameAddress(initialBuyEvent.token, evidence.token) ||
    initialBuyEvent.poolId !== evidence.poolId ||
    initialBuyEvent.nativeAmount !== BigInt(evidence.launch.valueWei) ||
    initialBuyEvent.tokenAmount <= 0n ||
    initialBuyEvent.launchHash !== evidence.launchHash
  ) {
    fail("Deep canary initial-buy event differs");
  }
  const oracleGrowthEvent = lifecycleEvent(
    keeperReceipt,
    evidence.automation,
    lifecycleAutomationAbi,
    "OracleGrowthStaged",
  );
  if (
    !sameAddress(oracleGrowthEvent.vault, evidence.growthVault) ||
    oracleGrowthEvent.poolId !== evidence.poolId ||
    !sameAddress(oracleGrowthEvent.executor, evidence.account) ||
    Number(oracleGrowthEvent.previousCardinalityNext) !==
      evidence.keeper.previousCardinalityNext ||
    Number(oracleGrowthEvent.newCardinalityNext) !==
      evidence.keeper.newCardinalityNext
  ) {
    fail("Deep canary automation event differs");
  }
  const hookGrowthEvent = lifecycleEvent(
    keeperReceipt,
    evidence.feeHook,
    lifecycleHookAbi,
    "IncreaseObservationCardinalityNext",
  );
  if (
    hookGrowthEvent.poolId !== evidence.poolId ||
    Number(hookGrowthEvent.observationCardinalityNextOld) !==
      evidence.keeper.previousCardinalityNext ||
    Number(hookGrowthEvent.observationCardinalityNextNew) !==
      evidence.keeper.newCardinalityNext
  ) {
    fail("Deep canary hook cardinality event differs");
  }

  const [
    recordedVault,
    recordedLaunchHash,
    recordedPoolId,
    registered,
    oracleState,
    tokenCode,
    vaultCode,
  ] = await Promise.all([
    client.readContract({
      address: evidence.launcher,
      abi: lifecycleLauncherAbi,
      functionName: "growthVaultOf",
      args: [evidence.token],
      blockNumber: keeperBlock,
    }),
    client.readContract({
      address: evidence.launcher,
      abi: lifecycleLauncherAbi,
      functionName: "launchHashOf",
      args: [evidence.token],
      blockNumber: keeperBlock,
    }),
    client.readContract({
      address: evidence.growthVault,
      abi: lifecycleVaultAbi,
      functionName: "poolId",
      blockNumber: keeperBlock,
    }),
    client.readContract({
      address: evidence.automation,
      abi: lifecycleAutomationAbi,
      functionName: "isRegisteredVault",
      args: [evidence.growthVault],
      blockNumber: keeperBlock,
    }),
    client.readContract({
      address: evidence.feeHook,
      abi: lifecycleHookAbi,
      functionName: "stateById",
      args: [evidence.poolId],
      blockNumber: keeperBlock,
    }),
    client.getCode({ address: evidence.token, blockNumber: keeperBlock }),
    client.getCode({ address: evidence.growthVault, blockNumber: keeperBlock }),
  ]);
  if (
    !sameAddress(recordedVault, evidence.growthVault) ||
    recordedLaunchHash !== evidence.launchHash ||
    recordedPoolId !== evidence.poolId ||
    registered !== true ||
    Number(oracleState[2]) !== evidence.postState.oracleCardinalityNext ||
    !tokenCode ||
    tokenCode === "0x" ||
    !vaultCode ||
    vaultCode === "0x"
  ) {
    fail("Deep canary post-state differs at the keeper block");
  }
}

async function verifyCanonicalLifecycleEvidence(
  lifecycle,
  clients,
  release,
) {
  if (clients.length !== 2) {
    fail("Deep lifecycle verification requires two RPC clients");
  }
  await Promise.all(
    clients.map((client) =>
      verifyLifecycleThroughClient(client, lifecycle.evidence),
    ),
  );
  if (release.status !== "not-deployed") {
    if (
      release.releaseCommit !== lifecycle.evidence.releaseCommit ||
      !sameAddress(release.addresses.launcher, lifecycle.evidence.launcher) ||
      !sameAddress(
        release.addresses.automation,
        lifecycle.evidence.automation,
      ) ||
      !sameAddress(release.addresses.feeHook, lifecycle.evidence.feeHook) ||
      !sameAddress(
        release.lifecycleEvidence.canaryToken,
        lifecycle.evidence.token,
      ) ||
      release.lifecycleEvidence.launchTransaction !==
        lifecycle.evidence.launch.transactionHash ||
      release.lifecycleEvidence.keeperTransaction !==
        lifecycle.evidence.keeper.transactionHash ||
      release.lifecycleEvidence.evidenceHash !== lifecycle.evidenceHash
    ) {
      fail("Deep live manifest is not bound to canonical lifecycle evidence");
    }
  }
}

function abiEncode(types, values) {
  return encodeAbiParameters(parseAbiParameters(types), values);
}

function normalizedAddress(value) {
  if (!isAddress(value)) fail(`Invalid address ${value}`);
  return value.toLowerCase();
}

async function verifyArtifacts(release) {
  const artifacts = {};
  for (const [field, [directory, contractName]] of Object.entries(
    artifactDefinitions,
  )) {
    const artifactPath = path.join(
      contractsRoot,
      "out",
      directory,
      `${contractName}.json`,
    );
    const artifact = await readJson(artifactPath);
    const creation = artifact.bytecode?.object;
    const runtime = artifact.deployedBytecode?.object;
    if (
      typeof creation !== "string" ||
      creation.length <= 2 ||
      typeof runtime !== "string" ||
      runtime.length <= 2
    ) {
      fail(`Missing ${field} bytecode; run forge build`);
    }
    const observed = {
      creationBytes: (creation.length - 2) / 2,
      creationCodeHash: keccak256(creation),
      bytes: (runtime.length - 2) / 2,
      codeHash: keccak256(runtime),
    };
    const expected = release.artifactRuntime?.[field];
    for (const key of Object.keys(observed)) {
      if (observed[key] !== expected?.[key]) {
        fail(
          `${field} artifact ${key} drift: ${observed[key]}/${expected?.[key]}`,
        );
      }
    }
    if (expected.fqcn !== `src/${directory}:${contractName}`) {
      fail(`${field} has the wrong source-verification FQCN`);
    }
    if (observed.bytes > 24_576) {
      fail(`${field} exceeds the EIP-170 runtime limit`);
    }
    artifacts[field] = { creation, runtime };
  }
  return artifacts;
}

function expectedSourceCommitment(release, artifacts) {
  const factoryBytecodeCommitment = keccak256(
    abiEncode(
      "bytes32,bytes32,bytes32,bytes32,bytes32,bytes32",
      [
        keccak256(artifacts.feeSplitVaultFactory.creation),
        keccak256(artifacts.feeSplitVault.creation),
        keccak256(artifacts.hookFactory.creation),
        keccak256(artifacts.feeHookTemplate.creation),
        keccak256(artifacts.rangeSourceFactory.creation),
        keccak256(artifacts.rangeSource.creation),
      ],
    ),
  );
  const fullRangeBytecodeCommitment = keccak256(
    abiEncode("bytes32,bytes32,bytes32,bytes32,bytes32", [
      keccak256(artifacts.growthVaultFactoryTemplate.creation),
      keccak256(artifacts.growthVaultImplementationTemplate.creation),
      keccak256(artifacts.launcherTemplate.creation),
      keccak256(artifacts.automationTemplate.creation),
      keccak256(artifacts.positionPlanner.creation),
    ]),
  );
  const bytecodeCommitment = keccak256(
    abiEncode("bytes32,bytes32", [
      factoryBytecodeCommitment,
      fullRangeBytecodeCommitment,
    ]),
  );
  const dependencies = release.officialDependencies;
  const dependencyCommitment = keccak256(
    abiEncode(
      "address,address,address,address,address,address,address,address,address",
      [
        dependencies.poolManager.address,
        dependencies.positionManager.address,
        dependencies.stateView.address,
        dependencies.v4Quoter.address,
        dependencies.uerc20Factory.address,
        dependencies.permit2.address,
        dependencies.universalRouter.address,
        dependencies.positionForwarderFactory.address,
        release.addresses.treasury,
      ].map(normalizedAddress),
    ),
  );
  const marketPolicyCommitment = keccak256(
    abiEncode(
      "uint256,uint256,uint256,uint256,int256,int256,int256,int256,int256,uint256,uint256,uint256,uint256",
      [
        10n,
        100n,
        1_000n,
        0n,
        200n,
        204_200n,
        218_000n,
        -887_200n,
        887_200n,
        1_000_000_000n * 10n ** 18n,
        150_000_000n * 10n ** 18n,
        50_000_000_000_000_000n,
        600_000_000_000_000n,
      ],
    ),
  );
  const growthPolicyCommitment = keccak256(
    abiEncode(
      "uint256,uint256,uint256,uint256,uint256,uint256,uint256",
      [2_000_000_000_000_000n, 1_800n, 1_800n, 600n, 400n, 25n, 8_500n],
    ),
  );
  const policyCommitment = keccak256(
    abiEncode("bytes32,bytes32", [
      marketPolicyCommitment,
      growthPolicyCommitment,
    ]),
  );
  const securityCommitment = keccak256(
    abiEncode("bytes32,bytes32,bytes32,bytes32,bytes32,bytes32", [
      keccak256(stringToHex("one-immutable-add-only-full-range-position")),
      keccak256(
        stringToHex("four-times-launch-reserve-and-stress-tick-solvency"),
      ),
      keccak256(stringToHex("staged-192-observation-30-minute-twap")),
      keccak256(stringToHex("trusted-depth-relative-compound-cap")),
      keccak256(stringToHex("permanently-locked-unused-reserve")),
      keccak256(stringToHex("zero-admin-zero-withdrawal")),
    ]),
  );
  return keccak256(
    abiEncode("bytes32,bytes32,bytes32,bytes32,bytes32", [
      keccak256(
        stringToHex(
          "programmable.deep.full-range.infrastructure.v1.ethereum",
        ),
      ),
      bytecodeCommitment,
      dependencyCommitment,
      policyCommitment,
      securityCommitment,
    ]),
  );
}

function verifyIdentity(release) {
  if (
    release.schemaVersion !== 1 ||
    release.model !== "deep" ||
    release.internalContractRelease !==
      "liquidity-growth-full-range-v1" ||
    release.releaseVersion !== "deep-full-range-v1" ||
    release.chainId !== 1 ||
    release.transactionCount !== 6 ||
    !sameAddress(release.addresses?.treasury, expectedTreasury) ||
    !sameAddress(
      release.addresses?.positionForwarderFactory,
      expectedForwarderFactory,
    )
  ) {
    fail("Deep FullRange release identity is invalid");
  }
  if (!validHash(release.sourceCommitment)) {
    fail("Deep FullRange source commitment is malformed");
  }
}

function verifyCompiler(release) {
  const expected = {
    version: "0.8.26",
    optimizerEnabled: true,
    optimizerRuns: 1_000,
    evmVersion: "cancun",
    bytecodeHash: "none",
    cborMetadata: false,
    viaIR: false,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (
      release.compiler?.[field] !== value ||
      release.sourceVerification?.compiler?.[field] !== value
    ) {
      fail(`Deep FullRange compiler field ${field} does not match Foundry`);
    }
  }
  if (Object.keys(release.compiler?.linkedLibraries ?? {}).length !== 0) {
    fail("Deep FullRange unexpectedly declares linked libraries");
  }
}

function verifyPolicies(release) {
  const policy = release.immutablePolicy;
  const expected = {
    launcherFeeBps: 10,
    minimumTotalSwapFeeBps: 100,
    maximumTotalSwapFeeBps: 1_000,
    totalSwapFeeStepBps: 100,
    transferTaxBps: 0,
    lpFeePips: 0,
    tickSpacing: 200,
    initialTick: 204_200,
    tokenSupply: "1000000000000000000000000000",
    tokenReserveTarget: "150000000000000000000000000",
    growthTargetNativeWei: "50000000000000000",
    minimumInitialBuyWei: "600000000000000",
    minimumOracleActivationNativeWei: "2000000000000000",
    twapWindowSeconds: 1_800,
    compoundCooldownSeconds: 1_800,
    maximumSpotTwapDeviationTicks: 600,
    maximumHookTickDelta: 400,
    maximumTrustedDepthBps: 25,
    minimumTokenReserveBps: 8_500,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (policy?.[field] !== value) {
      fail(`Deep FullRange immutable policy drift at ${field}`);
    }
  }
  const keeper = release.keeperPolicy;
  if (
    keeper?.confirmations !== 12 ||
    keeper.independentReadRpcCount !== 2 ||
    keeper.intervalMilliseconds !== 300_000 ||
    keeper.defaultMaxBatchSize !== 4 ||
    keeper.defaultMaxGas !== "3000000" ||
    keeper.maximumOperationalBatchSize !== 8 ||
    keeper.extendedBatchMinimumGas !== "6000000" ||
    keeper.vaultSubsidyCapWei !== "30000000000000000"
  ) {
    fail("Deep keeper policy differs from the reviewed release envelope");
  }
}

function verifyLocalEvidenceDescriptors(release) {
  const preflight = release.forkPreflight;
  if (
    preflight?.status !== "passed-local-not-release-evidence" ||
    preflight.dependencyDeploymentBlock !== 25_622_180 ||
    preflight.behaviorSnapshotBlock !== 25_612_664 ||
    preflight.results?.deployment !== "4/4" ||
    preflight.results?.fullRange !== "50/50" ||
    preflight.results?.mainnetFork !== "6/6" ||
    preflight.results?.deterministic !== "391/391" ||
    preflight.results?.invariants !==
      "9/9 at 1000 runs x 128 calls" ||
    preflight.slither?.version !== "0.11.5" ||
    preflight.slither?.highOrMediumFindings !== 0 ||
    preflight.slither?.complete !== false
  ) {
    fail("Deep local preflight evidence descriptors are stale or malformed");
  }
}

async function verifyDependencyProvenance(release, snapshot) {
  if (
    snapshot.chainId !== 1 ||
    snapshot.runtimeSnapshot?.blockNumber !==
      release.dependencyProvenance?.runtimeSnapshotBlock ||
    release.dependencyProvenance?.deploymentForkBlock !== 25_622_180 ||
    snapshot.source?.deployments !==
      release.dependencyProvenance?.uniswapDeploymentDataset?.url ||
    snapshot.source?.generatedAt !==
      release.dependencyProvenance?.uniswapDeploymentDataset?.generatedAt ||
    snapshot.source?.sourceCommit !==
      release.dependencyProvenance?.uniswapDeploymentDataset?.sourceCommit
  ) {
    fail("Deep dependency snapshot provenance is inconsistent");
  }
  for (const field of [
    "poolManager",
    "positionManager",
    "stateView",
    "v4Quoter",
    "uerc20Factory",
    "permit2",
    "universalRouter",
  ]) {
    const pinned = release.officialDependencies?.[field];
    const observed = snapshot.contracts?.[field];
    if (
      !sameAddress(pinned?.address, observed?.address) ||
      pinned?.runtimeCodeHash !== observed?.runtimeCodeHash
    ) {
      fail(`Deep official dependency ${field} differs from the pinned snapshot`);
    }
  }
  const forwarder = release.officialDependencies?.positionForwarderFactory;
  if (
    !sameAddress(forwarder?.address, expectedForwarderFactory) ||
    forwarder?.runtimeCodeHash !==
      "0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2" ||
    !validHash(forwarder?.deploymentTransaction) ||
    forwarder?.deploymentBlock !== 25_622_031
  ) {
    fail("Deep position-forwarder provenance is invalid");
  }
  for (const [dependency, commit] of Object.entries(exactGitCommits)) {
    if (release.dependencyProvenance?.gitCommits?.[dependency] !== commit) {
      fail(`Deep dependency commit ${dependency} changed in the manifest`);
    }
    const observed = execFileSync(
      "git",
      ["-C", path.join(contractsRoot, "lib", dependency), "rev-parse", "HEAD"],
      { encoding: "utf8" },
    ).trim();
    if (observed !== commit) {
      fail(`Deep dependency checkout ${dependency} is ${observed}, expected ${commit}`);
    }
  }
}

function verifySourceInputs(release) {
  const contracts = release.sourceVerification?.contracts;
  const expectedFqcns = Object.fromEntries(
    Object.entries(artifactDefinitions).map(([field, [file, contractName]]) => [
      field,
      `src/${file}:${contractName}`,
    ]),
  );
  const mapping = {
    feeSplitVaultFactory: "feeSplitVaultFactory",
    hookFactory: "hookFactory",
    feeHook: "feeHookTemplate",
    rangeSourceFactory: "rangeSourceFactory",
    growthVaultFactory: "growthVaultFactoryTemplate",
    growthVaultImplementation: "growthVaultImplementationTemplate",
    launcher: "launcherTemplate",
    automation: "automationTemplate",
    positionPlanner: "positionPlanner",
    feeSplitVaultTemplate: "feeSplitVault",
    rangeSourceTemplate: "rangeSource",
  };
  const expectedInputShape = {
    feeSplitVaultFactory: ["CREATE", []],
    hookFactory: ["CREATE", []],
    feeHook: [
      "CREATE2_FACTORY_CALL",
      ["address", "address", "address", "int24"],
    ],
    rangeSourceFactory: ["CREATE", []],
    growthVaultFactory: [
      "CREATE",
      ["address", "address", "address", "address", "address"],
    ],
    growthVaultImplementation: ["INTERNAL_CREATE", ["address"]],
    launcher: [
      "CREATE",
      [
        "address",
        "address",
        "address",
        "address",
        "address",
        "address",
        "address",
        "address",
      ],
    ],
    automation: ["INTERNAL_CREATE", ["address", "address"]],
    positionPlanner: ["INTERNAL_CREATE", []],
    feeSplitVaultTemplate: [
      "PER_POOL_CREATE2",
      ["address", "bytes32", "address[]", "uint16[]"],
    ],
    rangeSourceTemplate: [
      "PER_POOL_CREATE2",
      [
        "address",
        "tuple(address,address,uint24,int24,address)",
        "address",
        "uint32",
        "int24",
        "int24",
      ],
    ],
  };
  for (const [field, artifactField] of Object.entries(mapping)) {
    if (contracts?.[field]?.fqcn !== expectedFqcns[artifactField]) {
      fail(`Deep source-verification input ${field} has the wrong FQCN`);
    }
    const [deploymentKind, constructorTypes] =
      expectedInputShape[field];
    if (
      contracts[field].deploymentKind !== deploymentKind ||
      JSON.stringify(contracts[field].constructorTypes) !==
        JSON.stringify(constructorTypes)
    ) {
      fail(`Deep source-verification input ${field} has the wrong shape`);
    }
  }
  for (const field of [
    "feeSplitVaultFactory",
    "hookFactory",
    "rangeSourceFactory",
    "positionPlanner",
  ]) {
    const input = contracts[field];
    if (
      input.constructorTypes.length !== 0 ||
      input.encodedConstructorArguments !== "0x"
    ) {
      fail(`Deep no-argument source input ${field} is invalid`);
    }
  }
}

function verifyDisabled(release, appRelease) {
  if (
    release.status !== "not-deployed" ||
    release.releaseEligible !== false ||
    release.releaseCommit !== null ||
    release.startBlock !== null ||
    release.startingNonce !== null ||
    release.candidatePlan?.status !== "not-fixed-refresh-before-signing" ||
    release.lifecycleEvidence?.status !== "not-run" ||
    release.lifecycleEvidence?.releaseEligible !== false ||
    release.sourceVerification?.status !== "not-submitted" ||
    release.activation?.appStatus !== "disabled" ||
    release.activation?.keeperStatus !== "disabled" ||
    release.keeperPolicy?.enabled !== false ||
    release.keeperPolicy?.transactionSubmission !== false ||
    !Array.isArray(release.blockers) ||
    release.blockers.length === 0
  ) {
    fail("Undeployed Deep manifest contains live or enabled release state");
  }
  for (const field of deployedFields) {
    if (
      release.addresses?.[field] !== null ||
      release.transactions?.[field] !== null ||
      release.deploymentBlocks?.[field] !== null ||
      release.deploymentEvidence?.[field] !== null ||
      release.runtimeCodeHashes?.[field] !== null
    ) {
      fail(`Undeployed Deep manifest contains populated ${field} evidence`);
    }
    const source = release.sourceVerification?.contracts?.[field];
    if (source?.etherscan !== null || source?.sourcify !== null) {
      fail(`Undeployed Deep manifest contains ${field} source evidence`);
    }
  }
  for (const [field, source] of Object.entries(
    release.sourceVerification?.contracts ?? {},
  )) {
    if (source.etherscan !== null || source.sourcify !== null) {
      fail(`Undeployed Deep manifest contains ${field} source evidence`);
    }
    if (
      source.constructorTypes.length > 0 &&
      (source.constructorArguments !== null ||
        source.encodedConstructorArguments !== null)
    ) {
      fail(`Undeployed Deep manifest contains ${field} constructor evidence`);
    }
  }
  for (const [field, value] of Object.entries(release.candidatePlan ?? {})) {
    if (field !== "status" && value !== null) {
      fail(`Undeployed Deep candidate plan contains ${field}`);
    }
  }
  if (
    appRelease?.schemaVersion !== 1 ||
    appRelease.model !== "deep" ||
    appRelease.internalContractRelease !==
      "liquidity-growth-full-range-v1" ||
    appRelease.releaseVersion !== "deep-full-range-v1" ||
    appRelease.releaseManifest !== expectedReleaseManifest ||
    appRelease.status !== "not-deployed" ||
    appRelease.releaseEligible !== false ||
    appRelease.sourceVerificationStatus !== "not-submitted" ||
    appRelease.deploymentVerificationStatus !== "not-run" ||
    appRelease.releaseCommit !== null ||
    appRelease.startBlock !== null ||
    appRelease.deploymentBlock !== null ||
    appRelease.deploymentTransaction !== null ||
    appRelease.lifecycleEvidenceHash !== null
  ) {
    fail("Application manifest disagrees with the disabled Deep release");
  }
  for (const field of deployedFields) {
    if (
      appRelease[field] !== null ||
      appRelease.runtimeCodeHashes?.[field] !== null
    ) {
      fail(`Application manifest unexpectedly enables Deep ${field}`);
    }
  }
  if (
    !sameAddress(
      appRelease.positionForwarderFactory,
      release.addresses.positionForwarderFactory,
    ) ||
    appRelease.runtimeCodeHashes?.positionForwarderFactory !==
      release.runtimeCodeHashes.positionForwarderFactory ||
    appRelease.sourceCommitment !== release.sourceCommitment
  ) {
    fail("Application Deep dependency or source commitment differs");
  }
}

function verifyCandidatePlan(release, artifacts) {
  const candidate = release.candidatePlan;
  if (
    candidate?.status !== "reviewed-refresh-at-signing" ||
    !isAddress(candidate.deployer) ||
    !validBlock(candidate.observedAtBlock) ||
    !Number.isSafeInteger(candidate.startingNonce) ||
    candidate.startingNonce < 0 ||
    candidate.startingNonce !== release.startingNonce ||
    !sameAddress(candidate.deployer, release.addresses.deployer) ||
    !validHash(candidate.hookSalt)
  ) {
    fail("Live Deep deterministic candidate is missing or malformed");
  }
  const deployer = candidate.deployer.toLowerCase();
  const nonce = BigInt(candidate.startingNonce);
  const feeSplitVaultFactory = getCreateAddress({ from: deployer, nonce });
  const hookFactory = getCreateAddress({ from: deployer, nonce: nonce + 1n });
  const rangeSourceFactory = getCreateAddress({
    from: deployer,
    nonce: nonce + 3n,
  });
  const growthVaultFactory = getCreateAddress({
    from: deployer,
    nonce: nonce + 4n,
  });
  const growthVaultImplementation = getCreateAddress({
    from: growthVaultFactory,
    nonce: 1n,
  });
  const launcher = getCreateAddress({ from: deployer, nonce: nonce + 5n });
  const automation = getCreateAddress({ from: launcher, nonce: 1n });
  const positionPlanner = getCreateAddress({ from: launcher, nonce: 2n });
  const hookConstructor = abiEncode("address,address,address,int24", [
    release.officialDependencies.poolManager.address.toLowerCase(),
    expectedTreasury.toLowerCase(),
    feeSplitVaultFactory,
    400,
  ]);
  const hookInitCodeHash = keccak256(
    concatHex([artifacts.feeHookTemplate.creation, hookConstructor]),
  );
  const feeHook = getCreate2Address({
    from: hookFactory,
    salt: candidate.hookSalt,
    bytecodeHash: hookInitCodeHash,
  });
  const expected = {
    feeSplitVaultFactory,
    hookFactory,
    feeHook,
    rangeSourceFactory,
    growthVaultFactory,
    growthVaultImplementation,
    launcher,
    automation,
    positionPlanner,
  };
  for (const [field, address] of Object.entries(expected)) {
    if (
      !sameAddress(candidate[field], address) ||
      !sameAddress(release.addresses[field], address)
    ) {
      fail(`Live Deep deterministic ${field} address is invalid`);
    }
  }
  if (
    candidate.hookInitCodeHash !== hookInitCodeHash ||
    (BigInt(feeHook) & ((1n << 14n) - 1n)) !== 0x30ccn
  ) {
    fail("Live Deep hook init code or permission flags are invalid");
  }
}

async function verifyDependencyRuntime(release, clients) {
  for (const [field, dependency] of Object.entries(
    release.officialDependencies,
  )) {
    if (!isAddress(dependency.address) || !validHash(dependency.runtimeCodeHash)) {
      fail(`Deep dependency ${field} is malformed`);
    }
    const codes = await Promise.all(
      clients.map((client) =>
        client.getCode({ address: dependency.address.toLowerCase() }),
      ),
    );
    for (const code of codes) {
      if (!code || code === "0x" || keccak256(code) !== dependency.runtimeCodeHash) {
        fail(`Deep dependency ${field} runtime differs across the release pin`);
      }
    }
  }
}

async function verifyLiveSources(release) {
  if (!process.env.ETHERSCAN_API_KEY) {
    fail("ETHERSCAN_API_KEY is required for a live Deep release check");
  }
  for (const field of deployedFields) {
    const address = getAddress(release.addresses[field].toLowerCase());
    const source = release.sourceVerification.contracts[field];
    if (
      source?.etherscan?.status !== "exact-match" ||
      source?.etherscan?.url !==
        `https://etherscan.io/address/${address}#code` ||
      source?.sourcify?.status !== "exact-match" ||
      source?.sourcify?.url !==
        `https://repo.sourcify.dev/contracts/full_match/1/${address}/`
    ) {
      fail(`Deep ${field} source-verification record is incomplete`);
    }
    const etherscanUrl = new URL("https://api.etherscan.io/v2/api");
    etherscanUrl.searchParams.set("chainid", "1");
    etherscanUrl.searchParams.set("module", "contract");
    etherscanUrl.searchParams.set("action", "getsourcecode");
    etherscanUrl.searchParams.set("address", address);
    etherscanUrl.searchParams.set("apikey", process.env.ETHERSCAN_API_KEY);
    const sourcifyResponse = await fetch(
      `https://sourcify.dev/server/v2/contract/1/${address}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!sourcifyResponse.ok) {
      fail(`Deep ${field} source provider did not return success`);
    }
    let etherscan;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const etherscanResponse = await fetch(etherscanUrl, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!etherscanResponse.ok) {
        fail(`Deep ${field} source provider did not return success`);
      }
      etherscan = await etherscanResponse.json();
      if (etherscan?.status === "1") break;
      if (
        !String(etherscan?.result ?? etherscan?.message)
          .toLowerCase()
          .includes("rate limit") ||
        attempt === 4
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
    const sourcify = await sourcifyResponse.json();
    const etherscanSource = etherscan?.result?.[0];
    const expectedContractName = source.fqcn.split(":").at(-1);
    const expectedConstructorArguments =
      source.encodedConstructorArguments === "0x"
        ? ""
        : source.encodedConstructorArguments?.slice(2);
    if (
      etherscan?.status !== "1" ||
      !etherscanSource?.SourceCode ||
      etherscanSource.ContractName !== expectedContractName ||
      etherscanSource.CompilerVersion !== "v0.8.26+commit.8a97fa7a" ||
      etherscanSource.OptimizationUsed !== "1" ||
      etherscanSource.Runs !== "1000" ||
      etherscanSource.EVMVersion !== "cancun" ||
      etherscanSource.ConstructorArguments.toLowerCase() !==
        expectedConstructorArguments?.toLowerCase()
    ) {
      fail(`Deep ${field} exact Etherscan source record differs`);
    }
    if (
      ![sourcify?.match, sourcify?.creationMatch, sourcify?.runtimeMatch].some(
        (value) => value === "exact_match" || value === "match",
      )
    ) {
      fail(`Deep ${field} is not matched by Sourcify`);
    }
  }
}

function verifyConstructorArguments(release) {
  const source = release.sourceVerification.contracts;
  const addresses = release.addresses;
  const dependencies = release.officialDependencies;
  const expected = {
    feeHook: [
      dependencies.poolManager.address,
      expectedTreasury,
      addresses.feeSplitVaultFactory,
      400,
    ],
    growthVaultFactory: [
      addresses.hookFactory,
      addresses.feeSplitVaultFactory,
      dependencies.positionManager.address,
      addresses.positionForwarderFactory,
      addresses.rangeSourceFactory,
    ],
    growthVaultImplementation: [addresses.growthVaultFactory],
    launcher: [
      dependencies.poolManager.address,
      dependencies.positionManager.address,
      dependencies.uerc20Factory.address,
      addresses.feeHook,
      addresses.feeSplitVaultFactory,
      addresses.rangeSourceFactory,
      addresses.growthVaultFactory,
      addresses.positionForwarderFactory,
    ],
    automation: [addresses.growthVaultFactory, addresses.launcher],
  };
  for (const [field, values] of Object.entries(expected)) {
    const input = source[field];
    const normalizedValues = values.map((value) =>
      typeof value === "string" && isAddress(value)
        ? value.toLowerCase()
        : value,
    );
    const encoded = abiEncode(input.constructorTypes.join(","), normalizedValues);
    if (
      JSON.stringify(input.constructorArguments) !==
        JSON.stringify(values) ||
      input.encodedConstructorArguments !== encoded
    ) {
      fail(`Deep ${field} constructor verification input is invalid`);
    }
  }
}

async function verifyLiveRelease(release, appRelease, clients, artifacts) {
  const releaseReady =
    release.status === "deployment-source-and-lifecycle-verified";
  const keeperPending =
    release.status ===
    "deployed-source-and-canary-verified-keeper-pending";
  if (
    (!releaseReady && !keeperPending) ||
    !validCommit(release.releaseCommit) ||
    !validBlock(release.startBlock) ||
    !Number.isSafeInteger(release.startingNonce) ||
    release.startingNonce < 0 ||
    release.sourceVerification?.status !== "verified" ||
    !validHash(release.lifecycleEvidence?.evidenceHash) ||
    release.lifecycleEvidence?.independentRpcCount !== 2 ||
    release.activation?.requiresExactManifestMatch !== true ||
    !Array.isArray(release.blockers)
  ) {
    fail("Live Deep release lacks required deployment, source or lifecycle state");
  }
  if (
    releaseReady
      ? release.releaseEligible !== true ||
        release.lifecycleEvidence?.status !== "verified-current-release" ||
        release.lifecycleEvidence?.releaseEligible !== true ||
        release.activation?.appStatus !== "ready" ||
        release.activation?.keeperStatus !== "ready" ||
        release.blockers.length !== 0
      : release.releaseEligible !== false ||
        release.lifecycleEvidence?.status !==
          "launch-and-oracle-verified" ||
        release.lifecycleEvidence?.releaseEligible !== false ||
        release.activation?.appStatus !== "disabled" ||
        release.activation?.keeperStatus !==
          "disabled-awaiting-lifecycle-proof" ||
        release.blockers.length === 0
  ) {
    fail("Deep release eligibility does not match its activation state");
  }
  verifyCandidatePlan(release, artifacts);
  verifyConstructorArguments(release);

  const blocks = [];
  for (const field of deployedFields) {
    if (
      !isAddress(release.addresses[field]) ||
      !validHash(release.transactions[field]) ||
      !validBlock(release.deploymentBlocks[field]) ||
      !validHash(release.runtimeCodeHashes[field])
    ) {
      fail(`Live Deep release lacks ${field} deployment evidence`);
    }
    const evidence = release.deploymentEvidence[field];
    if (
      evidence?.transactionHash !== release.transactions[field] ||
      evidence?.blockNumber !== release.deploymentBlocks[field] ||
      evidence?.receiptStatus !== "success" ||
      !validHash(evidence?.blockHash)
    ) {
      fail(`Live Deep ${field} receipt record is incomplete`);
    }
    blocks.push(release.deploymentBlocks[field]);
    const codes = await Promise.all(
      clients.map((client) =>
        client.getCode({ address: release.addresses[field].toLowerCase() }),
      ),
    );
    for (const code of codes) {
      if (
        !code ||
        (code.length - 2) / 2 > 24_576 ||
        keccak256(code) !== release.runtimeCodeHashes[field]
      ) {
        fail(`Live Deep ${field} runtime hash differs`);
      }
    }
  }
  if (release.startBlock !== Math.min(...blocks)) {
    fail("Deep startBlock must be the first infrastructure deployment block");
  }
  if (
    release.transactions.growthVaultImplementation !==
      release.transactions.growthVaultFactory ||
    release.transactions.automation !== release.transactions.launcher ||
    release.transactions.positionPlanner !== release.transactions.launcher
  ) {
    fail("Deep internal CREATE transaction provenance is invalid");
  }
  if (
    new Set(
      externalTransactionFields.map(
        (field) => release.transactions[field],
      ),
    ).size !== 6
  ) {
    fail("Deep deployment must contain six distinct external transactions");
  }

  const nonceOffsets = {
    feeSplitVaultFactory: 0,
    hookFactory: 1,
    feeHook: 2,
    rangeSourceFactory: 3,
    growthVaultFactory: 4,
    launcher: 5,
  };
  for (const field of externalTransactionFields) {
    const [receipt, transaction] = await Promise.all([
      clients[0].getTransactionReceipt({
        hash: release.transactions[field],
      }),
      clients[0].getTransaction({
        hash: release.transactions[field],
      }),
    ]);
    const evidence = release.deploymentEvidence[field];
    if (
      receipt.status !== "success" ||
      receipt.blockNumber !== BigInt(release.deploymentBlocks[field]) ||
      receipt.blockHash !== evidence.blockHash ||
      !sameAddress(receipt.from, release.addresses.deployer) ||
      !sameAddress(transaction.from, release.addresses.deployer) ||
      transaction.nonce !==
        release.startingNonce + nonceOffsets[field] ||
      transaction.value !== 0n ||
      evidence.nonce !== transaction.nonce ||
      evidence.valueWei !== "0" ||
      !sameAddress(evidence.from, release.addresses.deployer) ||
      evidence.transactionInputHash !== keccak256(transaction.input)
    ) {
      fail(`Deep ${field} live receipt differs from the manifest`);
    }
    if (
      field === "feeHook"
        ? !sameAddress(receipt.to, release.addresses.hookFactory) ||
          !sameAddress(transaction.to, release.addresses.hookFactory) ||
          !sameAddress(evidence.to, release.addresses.hookFactory)
        : receipt.to !== null ||
          transaction.to !== null ||
          evidence.to !== null ||
          !sameAddress(
            receipt.contractAddress,
            release.addresses[field],
          )
    ) {
      fail(`Deep ${field} CREATE/CREATE2 receipt target is invalid`);
    }
  }

  const read = clients[0];
  const addresses = Object.fromEntries(
    Object.entries(release.addresses).map(([field, value]) => [
      field,
      typeof value === "string" && isAddress(value)
        ? value.toLowerCase()
        : value,
    ]),
  );
  const dependencies = Object.fromEntries(
    Object.entries(release.officialDependencies).map(([field, value]) => [
      field,
      value.address.toLowerCase(),
    ]),
  );
  const values = await Promise.all([
    read.readContract({ address: addresses.feeHook, abi: hookAbi, functionName: "poolManager" }),
    read.readContract({ address: addresses.feeHook, abi: hookAbi, functionName: "launcherFeeRecipient" }),
    read.readContract({ address: addresses.feeHook, abi: hookAbi, functionName: "feeSplitVaultFactory" }),
    read.readContract({ address: addresses.feeHook, abi: hookAbi, functionName: "maxAbsTickDelta" }),
    read.readContract({ address: addresses.feeHook, abi: hookAbi, functionName: "LAUNCHER_FEE_BPS" }),
    read.readContract({ address: addresses.feeHook, abi: hookAbi, functionName: "MIN_TOTAL_SWAP_FEE_BPS" }),
    read.readContract({ address: addresses.feeHook, abi: hookAbi, functionName: "MAX_TOTAL_SWAP_FEE_BPS" }),
    read.readContract({ address: addresses.feeHook, abi: hookAbi, functionName: "TOTAL_SWAP_FEE_STEP_BPS" }),
    read.readContract({ address: addresses.feeHook, abi: hookAbi, functionName: "TRANSFER_TAX_BPS" }),
    read.readContract({ address: addresses.feeHook, abi: hookAbi, functionName: "LP_FEE_PIPS" }),
    read.readContract({ address: addresses.feeHook, abi: hookAbi, functionName: "TICK_SPACING" }),
    read.readContract({ address: addresses.hookFactory, abi: hookFactoryAbi, functionName: "ALL_HOOK_MASK" }),
    read.readContract({ address: addresses.hookFactory, abi: hookFactoryAbi, functionName: "REQUIRED_HOOK_FLAGS" }),
    read.readContract({ address: addresses.hookFactory, abi: hookFactoryAbi, functionName: "isFactoryHook", args: [addresses.feeHook] }),
    read.readContract({ address: addresses.growthVaultFactory, abi: growthFactoryAbi, functionName: "implementation" }),
    read.readContract({ address: addresses.growthVaultFactory, abi: growthFactoryAbi, functionName: "hookFactory" }),
    read.readContract({ address: addresses.growthVaultFactory, abi: growthFactoryAbi, functionName: "feeSplitVaultFactory" }),
    read.readContract({ address: addresses.growthVaultFactory, abi: growthFactoryAbi, functionName: "positionManager" }),
    read.readContract({ address: addresses.growthVaultFactory, abi: growthFactoryAbi, functionName: "poolManager" }),
    read.readContract({ address: addresses.growthVaultFactory, abi: growthFactoryAbi, functionName: "positionForwarderFactory" }),
    read.readContract({ address: addresses.growthVaultFactory, abi: growthFactoryAbi, functionName: "rangeSourceFactory" }),
    read.readContract({ address: addresses.growthVaultImplementation, abi: growthImplementationAbi, functionName: "FACTORY" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "poolManager" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "positionManager" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "tokenFactory" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "feeHook" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "feeSplitVaultFactory" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "rangeSourceFactory" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "growthVaultFactory" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "automation" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "positionPlanner" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "positionForwarderFactory" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "TOKEN_SUPPLY" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "TOKEN_RESERVE_TARGET" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "GROWTH_TARGET_NATIVE" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "MIN_INITIAL_BUY_WEI" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "INITIAL_TICK" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "TICK_SPACING" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "LP_FEE_PIPS" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "TWAP_WINDOW" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "MAX_SPOT_TWAP_DEVIATION_TICKS" }),
    read.readContract({ address: addresses.launcher, abi: launcherAbi, functionName: "MAX_ABS_TICK_DELTA" }),
    read.readContract({ address: addresses.automation, abi: automationAbi, functionName: "vaultFactory" }),
    read.readContract({ address: addresses.automation, abi: automationAbi, functionName: "launcher" }),
    read.readContract({ address: addresses.automation, abi: automationAbi, functionName: "MAX_BATCH_SIZE" }),
    read.readContract({ address: addresses.automation, abi: automationAbi, functionName: "OBSERVATION_CARDINALITY_TARGET" }),
    read.readContract({ address: addresses.automation, abi: automationAbi, functionName: "MIN_ORACLE_ACTIVATION_NATIVE" }),
    read.readContract({ address: addresses.positionForwarderFactory, abi: forwarderFactoryAbi, functionName: "positionManager" }),
  ]);
  const addressExpectations = [
    [values[0], dependencies.poolManager],
    [values[1], expectedTreasury],
    [values[2], addresses.feeSplitVaultFactory],
    [values[14], addresses.growthVaultImplementation],
    [values[15], addresses.hookFactory],
    [values[16], addresses.feeSplitVaultFactory],
    [values[17], dependencies.positionManager],
    [values[18], dependencies.poolManager],
    [values[19], addresses.positionForwarderFactory],
    [values[20], addresses.rangeSourceFactory],
    [values[21], addresses.growthVaultFactory],
    [values[22], dependencies.poolManager],
    [values[23], dependencies.positionManager],
    [values[24], dependencies.uerc20Factory],
    [values[25], addresses.feeHook],
    [values[26], addresses.feeSplitVaultFactory],
    [values[27], addresses.rangeSourceFactory],
    [values[28], addresses.growthVaultFactory],
    [values[29], addresses.automation],
    [values[30], addresses.positionPlanner],
    [values[31], addresses.positionForwarderFactory],
    [values[42], addresses.growthVaultFactory],
    [values[43], addresses.launcher],
    [values[47], dependencies.positionManager],
  ];
  if (
    addressExpectations.some(([actual, expected]) => !sameAddress(actual, expected)) ||
    values[3] !== 400 ||
    values[4] !== 10 ||
    values[5] !== 100 ||
    values[6] !== 1_000 ||
    values[7] !== 100 ||
    values[8] !== 0 ||
    values[9] !== 0 ||
    values[10] !== 200 ||
    values[11] !== 16_383n ||
    values[12] !== 0x30ccn ||
    values[13] !== true ||
    values[32] !== 1_000_000_000n * 10n ** 18n ||
    values[33] !== 150_000_000n * 10n ** 18n ||
    values[34] !== 50_000_000_000_000_000n ||
    values[35] !== 600_000_000_000_000n ||
    values[36] !== 204_200 ||
    values[37] !== 200 ||
    values[38] !== 0 ||
    values[39] !== 1_800 ||
    values[40] !== 600 ||
    values[41] !== 400 ||
    values[44] !== 32n ||
    values[45] !== 192 ||
    values[46] !== 2_000_000_000_000_000n
  ) {
    fail("Deep live immutable configuration or factory provenance differs");
  }

  const fields = [
    "launcher",
    "hookFactory",
    "feeHook",
    "feeSplitVaultFactory",
    "rangeSourceFactory",
    "growthVaultFactory",
    "growthVaultImplementation",
    "automation",
    "positionPlanner",
    "positionForwarderFactory",
  ];
  if (
    appRelease?.schemaVersion !== 1 ||
    appRelease.model !== "deep" ||
    appRelease.internalContractRelease !==
      "liquidity-growth-full-range-v1" ||
    appRelease.releaseVersion !== "deep-full-range-v1" ||
    appRelease.releaseCommit !== release.releaseCommit ||
    appRelease.sourceCommitment !== release.sourceCommitment ||
    appRelease.releaseManifest !== expectedReleaseManifest ||
    appRelease.status !== release.status ||
    appRelease.releaseEligible !== release.releaseEligible ||
    appRelease.sourceVerificationStatus !== "verified" ||
    appRelease.deploymentVerificationStatus !== "verified" ||
    appRelease.startBlock !== release.startBlock ||
    appRelease.deploymentBlock !== release.startBlock ||
    appRelease.deploymentTransaction !== release.transactions.launcher ||
    appRelease.lifecycleEvidenceHash !==
      release.lifecycleEvidence.evidenceHash
  ) {
    fail("Application Deep release status differs from the verified manifest");
  }
  for (const field of fields) {
    if (
      !sameAddress(appRelease[field], release.addresses[field]) ||
      appRelease.runtimeCodeHashes?.[field] !==
        release.runtimeCodeHashes[field]
    ) {
      fail(`Application Deep ${field} differs from the verified manifest`);
    }
  }
  if (
    release.keeperPolicy.status !==
      (releaseReady
        ? "verified-ready-disabled-by-default"
        : "deployed-disabled-lifecycle-pending") ||
    release.keeperPolicy.enabled !== false ||
    release.keeperPolicy.transactionSubmission !== false ||
    !sameAddress(
      release.keeperPolicy.coordinator,
      release.addresses.automation,
    ) ||
    release.keeperPolicy.coordinatorRuntimeCodeHash !==
      release.runtimeCodeHashes.automation
  ) {
    fail("Deep keeper activation record is not bound to the verified automation");
  }
  if (
    !releaseReady &&
    (!sameAddress(
      release.keeperPolicy.signerAddress,
      "0x4A7190dA29b6BC41980983e55E0dB35bbaff5fe0",
    ) ||
      release.keeperPolicy.signingBackend !== "privy-policy-wallet" ||
      release.keeperPolicy.executionPath !== "/api/ops/deep-keeper")
  ) {
    fail("Deep pending keeper record is not bound to its policy wallet");
  }
  await verifyLiveSources(release);
}

const release = await readJson(releasePath);
const releaseSchema = await readJson(releaseSchemaPath);
const appManifest = await readJson(appManifestPath);
const dependencySnapshot = await readJson(dependencySnapshotPath);
const lifecycle = await readCanonicalLifecycleEvidence();
const appRelease = appManifest.production?.launchModelReleases?.deep;

if (
  appManifest.schemaVersion !== 1 ||
  appManifest.production?.chainId !== 1 ||
  appManifest.production?.status !== "ready"
) {
  fail("Application deployment manifest is not pinned to Ethereum Mainnet");
}
const ajv = new Ajv({ allErrors: true, strict: false });
const validateReleaseSchema = ajv.compile(releaseSchema);
if (!validateReleaseSchema(release)) {
  fail(
    `Deep release manifest schema failed: ${ajv.errorsText(
      validateReleaseSchema.errors,
      { separator: "; " },
    )}`,
  );
}
verifyIdentity(release);
verifyCompiler(release);
verifyPolicies(release);
verifyLocalEvidenceDescriptors(release);
verifySourceInputs(release);
await verifyDependencyProvenance(release, dependencySnapshot);
const artifacts = await verifyArtifacts(release);
const sourceCommitment = expectedSourceCommitment(release, artifacts);
if (sourceCommitment !== release.sourceCommitment) {
  fail(
    `Deep source commitment drift: ${sourceCommitment}/${release.sourceCommitment}`,
  );
}

let clients = [];
if (!offline) {
  const rpcUrls = unique([
    process.env.ETHEREUM_RPC_URL,
    process.env.ETHEREUM_RPC_URL_SECONDARY,
    "https://eth.drpc.org",
    "https://ethereum-rpc.publicnode.com",
  ].filter(Boolean)).slice(0, 2);
  if (rpcUrls.length !== 2) fail("Deep release verification requires two RPCs");
  clients = rpcUrls.map((rpcUrl) =>
    createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl, { retryCount: 1, timeout: 15_000 }),
    }),
  );
  await verifyDependencyRuntime(release, clients);
  await verifyCanonicalLifecycleEvidence(lifecycle, clients, release);
}

if (release.status === "not-deployed") {
  verifyDisabled(release, appRelease);
  if (requireLive) fail("Deep FullRange is not deployed");
  console.log(
    `Deep FullRange artifacts, source commitment, dependency provenance and disabled app state match${offline ? " (offline)" : " through two RPCs"}; deployment remains disabled.`,
  );
} else {
  if (offline) fail("A live Deep release cannot be verified offline");
  await verifyLiveRelease(release, appRelease, clients, artifacts);
  if (requireLive && !release.releaseEligible) {
    fail("Deep FullRange is deployed but its keeper lifecycle is not complete");
  }
  console.log(
    release.releaseEligible
      ? "Deep FullRange receipts, runtime hashes, source verification, lifecycle evidence, app gate and keeper binding match."
      : "Deep FullRange deployment, exact sources and launch/oracle canary match; the app remains disabled until fee processing and compounding are proven.",
  );
}
