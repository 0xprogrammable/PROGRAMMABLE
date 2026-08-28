import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  keccak256,
  parseAbi,
} from "viem";

import {
  CLASSIC_V4_CHAIN_ID,
  CLASSIC_V4_CHAIN_ID_HEX,
  CLASSIC_V4_EXPECTED_CTO_AUTHORITY_OWNER,
  CLASSIC_V4_FINALITY_CONFIRMATIONS,
  CLASSIC_V4_LAUNCH_STAMP_ROUTER,
  CLASSIC_V4_LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH,
  CLASSIC_V4_OFFICIAL_DEPENDENCIES,
  CLASSIC_V4_SHARED_DEPENDENCIES,
  CLASSIC_V4_SOLC_VERSION,
  artifactRuntimeDescriptor,
  assertBytes32,
  assertTransactionHash,
  canonicalAddress,
  canonicalNonzeroAddress,
  digestJson,
  normalizeHex,
  normalizeRuntimeImmutables,
} from "./classic-v4-release-core.mjs";

export const CLASSIC_V4_LAUNCHER_UPGRADE_RELEASE =
  "classic-v4-launcher-v4";
export const CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER =
  CLASSIC_V4_EXPECTED_CTO_AUTHORITY_OWNER;
export const CLASSIC_V4_LAUNCHER_UPGRADE_ARTIFACT_PATH =
  "MemeLaunchV4.sol/MemeLaunchV4.json";
export const CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET = Object.freeze({
  contractName: "MemeLaunchV4",
  fqcn: "src/MemeLaunchV4.sol:MemeLaunchV4",
});
export const CLASSIC_V4_LAUNCHER_UPGRADE_MAX_GAS_LIMIT = 8_000_000n;
export const CLASSIC_V4_LAUNCHER_UPGRADE_MIN_GAS_LIMIT = 1_500_000n;

export const CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES = Object.freeze({
  poolManager: CLASSIC_V4_OFFICIAL_DEPENDENCIES.poolManager,
  positionManager: CLASSIC_V4_OFFICIAL_DEPENDENCIES.positionManager,
  tokenFactory: CLASSIC_V4_OFFICIAL_DEPENDENCIES.uerc20Factory,
  feeHook: Object.freeze({
    address: "0xADF955a44FD7F009380240d56D71dFAfB46020cc",
    runtimeCodeHash:
      "0xf3a1a628ce898c527f24569b426aa795ec65ff9d97afa2b89e8ea5a2b99ad280",
  }),
  positionPlanner: Object.freeze({
    address: "0xD8f8f5C5832648d59a5f465f8Dd02d36572D4A6c",
    runtimeCodeHash:
      "0xf522d2131dcecdea17c4de6d376df4b340d515d1da006b1421e7672f5a32317d",
  }),
  rewardVaultFactory: CLASSIC_V4_SHARED_DEPENDENCIES.rewardVaultFactory,
  initialBuyVestingWalletFactory:
    CLASSIC_V4_SHARED_DEPENDENCIES.initialBuyVestingWalletFactory,
  launchPolicy: CLASSIC_V4_SHARED_DEPENDENCIES.launchPolicy,
  positionForwarderFactory:
    CLASSIC_V4_SHARED_DEPENDENCIES.positionForwarderFactory,
});

export const CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER = Object.freeze({
  address: CLASSIC_V4_LAUNCH_STAMP_ROUTER,
  runtimeCodeHash: CLASSIC_V4_LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH,
});

export const CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS = Object.freeze({
  sourceClosure:
    "programmable.classic-v4-launcher-upgrade.source-closure.v1",
  sourceCommitment:
    "programmable.classic-v4-launcher-upgrade.source-commitment.v1",
  preparationPlan:
    "programmable.classic-v4-launcher-upgrade.preparation-plan.v1",
  receiptEvidence:
    "programmable.classic-v4-launcher-upgrade.receipt-evidence.v1",
  verificationEvidence:
    "programmable.classic-v4-launcher-upgrade.verification-evidence.v1",
  rpcSnapshot:
    "programmable.classic-v4-launcher-upgrade.rpc-snapshot.v1",
});

const launcherAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function positionPlanner() view returns (address)",
  "function rewardVaultFactory() view returns (address)",
  "function initialBuyVestingWalletFactory() view returns (address)",
  "function launchPolicy() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function ROUTER() view returns (address)",
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
  "function INITIAL_TICK() view returns (int24)",
  "function TICK_SPACING() view returns (int24)",
  "function LP_FEE_PIPS() view returns (uint24)",
]);

const positionManagerAbi = parseAbi([
  "function poolManager() view returns (address)",
]);
const hookAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
]);
const plannerAbi = parseAbi([
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function INITIAL_TICK() view returns (int24)",
  "function LIQUIDITY_TICK_LOWER() view returns (int24)",
  "function TICK_SPACING() view returns (int24)",
]);
const rewardVaultFactoryAbi = parseAbi([
  "function ctoAuthority() view returns (address)",
]);
const custodyFactoryAbi = parseAbi([
  "function MIN_DURATION_DAYS() view returns (uint16)",
  "function MAX_DURATION_DAYS() view returns (uint16)",
]);
const launchPolicyAbi = parseAbi([
  "function MAX_REWARD_BENEFICIARIES() view returns (uint256)",
  "function REWARD_SHARE_BASIS_POINTS() view returns (uint16)",
]);
const forwarderFactoryAbi = parseAbi([
  "function positionManager() view returns (address)",
  "function OPERATOR() view returns (address)",
  "function TIMELOCK_BLOCK() view returns (uint256)",
]);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const UINT256_MAX = (1n << 256n) - 1n;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  assert(
    actual.length === wanted.length &&
      actual.every((key, index) => key === wanted[index]),
    `${label} keys differ`,
  );
}

function assertCommit(value, label) {
  assert(
    typeof value === "string" &&
      /^[0-9a-f]{40}$/i.test(value) &&
      value !== "0".repeat(40),
    `Invalid ${label}`,
  );
  return value.toLowerCase();
}

function assertPositiveInteger(value, label) {
  assert(Number.isSafeInteger(value) && value > 0, `Invalid ${label}`);
  return value;
}

function assertDecimal(value, label, { positive = false } = {}) {
  assert(typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value), `Invalid ${label}`);
  if (positive) assert(BigInt(value) > 0n, `Invalid ${label}`);
  return value;
}

function creationCode(artifact) {
  const bytecode = artifact?.bytecode?.object;
  assert(
    typeof bytecode === "string" && /^0x[0-9a-f]+$/i.test(bytecode),
    "MemeLaunchV4 creation bytecode is unavailable",
  );
  return bytecode;
}

function validatedMetadata(artifact) {
  let metadata;
  try {
    metadata =
      typeof artifact?.metadata === "string"
        ? JSON.parse(artifact.metadata)
        : artifact?.metadata;
  } catch {
    throw new Error("MemeLaunchV4 artifact metadata is invalid");
  }
  assert(
    metadata?.compiler?.version === CLASSIC_V4_SOLC_VERSION &&
      metadata?.settings?.optimizer?.enabled === true &&
      metadata?.settings?.optimizer?.runs === 1_000 &&
      metadata?.settings?.evmVersion === "cancun" &&
      metadata?.settings?.metadata?.bytecodeHash === "none" &&
      metadata?.settings?.metadata?.appendCBOR === false,
    "MemeLaunchV4 compiler settings differ from the reviewed release",
  );
  assert(
    metadata?.sources &&
      typeof metadata.sources === "object" &&
      metadata.sources["src/MemeLaunchV4.sol"],
    "MemeLaunchV4 source closure is unavailable",
  );
  return metadata;
}

export async function loadClassicV4LauncherUpgradeArtifact(outputDirectory) {
  const artifact = JSON.parse(
    await readFile(
      path.join(
        path.resolve(outputDirectory),
        CLASSIC_V4_LAUNCHER_UPGRADE_ARTIFACT_PATH,
      ),
      "utf8",
    ),
  );
  validatedMetadata(artifact);
  return artifact;
}

export function computeClassicV4LauncherUpgradeBuildCommitments(artifact) {
  const metadata = validatedMetadata(artifact);
  const descriptor = artifactRuntimeDescriptor(artifact, "launcher");
  assert(descriptor.bytes <= 24_576, "MemeLaunchV4 exceeds EIP-170");
  assert(descriptor.bytes <= 23_000, "MemeLaunchV4 exceeds the reviewed runtime budget");
  const sources = Object.entries(metadata.sources)
    .map(([sourcePath, source]) => {
      assert(
        /^(?:src|lib\/[a-z0-9-]+)\/[A-Za-z0-9_./-]+\.sol$/.test(sourcePath) &&
          !sourcePath.split("/").includes(".."),
        "MemeLaunchV4 artifact contains an invalid source path",
      );
      return {
        sourcePath,
        sourceHash: assertBytes32(source?.keccak256, `${sourcePath} source hash`),
      };
    })
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  const dependencyRoots = [
    ...new Set(
      sources
        .filter(({ sourcePath }) => sourcePath.startsWith("lib/"))
        .map(({ sourcePath }) => sourcePath.split("/")[1]),
    ),
  ].sort();
  assert(dependencyRoots.length > 0, "MemeLaunchV4 dependency closure is empty");
  return {
    artifact: descriptor,
    sourceClosureDigest: digestJson(
      sources,
      CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.sourceClosure,
    ),
    sourceCount: sources.length,
    dependencyRoots,
  };
}

function addressResult(value) {
  return encodeAbiParameters(
    [{ type: "address" }],
    [canonicalAddress(value)],
  );
}

function uintResult(value, type = "uint256") {
  return encodeAbiParameters([{ type }], [BigInt(value)]);
}

function intResult(value, type = "int256") {
  return encodeAbiParameters([{ type }], [BigInt(value)]);
}

function callCheck(label, target, abi, functionName, expected) {
  return {
    label,
    target: canonicalAddress(target),
    data: encodeFunctionData({ abi, functionName }),
    expected: normalizeHex(expected),
  };
}

export function classicV4LauncherUpgradeDependencyBindingChecks() {
  const dependencies = CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES;
  return [
    callCheck(
      "PositionManager PoolManager",
      dependencies.positionManager.address,
      positionManagerAbi,
      "poolManager",
      addressResult(dependencies.poolManager.address),
    ),
    callCheck(
      "fee hook PoolManager",
      dependencies.feeHook.address,
      hookAbi,
      "poolManager",
      addressResult(dependencies.poolManager.address),
    ),
    callCheck(
      "fee hook reward vault factory",
      dependencies.feeHook.address,
      hookAbi,
      "feeSplitVaultFactory",
      addressResult(dependencies.rewardVaultFactory.address),
    ),
    callCheck(
      "fee hook LP fee",
      dependencies.feeHook.address,
      hookAbi,
      "LP_FEE_PIPS",
      uintResult(0, "uint24"),
    ),
    callCheck(
      "fee hook tick spacing",
      dependencies.feeHook.address,
      hookAbi,
      "TICK_SPACING",
      intResult(200, "int24"),
    ),
    callCheck(
      "position planner supply",
      dependencies.positionPlanner.address,
      plannerAbi,
      "TOKEN_SUPPLY",
      uintResult(1_000_000_000n * 10n ** 18n),
    ),
    callCheck(
      "position planner initial tick",
      dependencies.positionPlanner.address,
      plannerAbi,
      "INITIAL_TICK",
      intResult(204_200, "int24"),
    ),
    callCheck(
      "position planner lower tick",
      dependencies.positionPlanner.address,
      plannerAbi,
      "LIQUIDITY_TICK_LOWER",
      intResult(174_800, "int24"),
    ),
    callCheck(
      "position planner spacing",
      dependencies.positionPlanner.address,
      plannerAbi,
      "TICK_SPACING",
      intResult(200, "int24"),
    ),
    callCheck(
      "reward vault CTO authority",
      dependencies.rewardVaultFactory.address,
      rewardVaultFactoryAbi,
      "ctoAuthority",
      addressResult(CLASSIC_V4_SHARED_DEPENDENCIES.ctoAuthority.address),
    ),
    callCheck(
      "custody minimum duration",
      dependencies.initialBuyVestingWalletFactory.address,
      custodyFactoryAbi,
      "MIN_DURATION_DAYS",
      uintResult(1, "uint16"),
    ),
    callCheck(
      "custody maximum duration",
      dependencies.initialBuyVestingWalletFactory.address,
      custodyFactoryAbi,
      "MAX_DURATION_DAYS",
      uintResult(3_650, "uint16"),
    ),
    callCheck(
      "launch policy maximum beneficiaries",
      dependencies.launchPolicy.address,
      launchPolicyAbi,
      "MAX_REWARD_BENEFICIARIES",
      uintResult(5),
    ),
    callCheck(
      "launch policy reward shares",
      dependencies.launchPolicy.address,
      launchPolicyAbi,
      "REWARD_SHARE_BASIS_POINTS",
      uintResult(10_000, "uint16"),
    ),
    callCheck(
      "forwarder PositionManager",
      dependencies.positionForwarderFactory.address,
      forwarderFactoryAbi,
      "positionManager",
      addressResult(dependencies.positionManager.address),
    ),
    callCheck(
      "forwarder operator",
      dependencies.positionForwarderFactory.address,
      forwarderFactoryAbi,
      "OPERATOR",
      addressResult(ZERO_ADDRESS),
    ),
    callCheck(
      "forwarder timelock",
      dependencies.positionForwarderFactory.address,
      forwarderFactoryAbi,
      "TIMELOCK_BLOCK",
      uintResult(UINT256_MAX),
    ),
  ];
}

export function classicV4LauncherUpgradeRuntimeBindingChecks(address) {
  const launcher = canonicalNonzeroAddress(address, "launcher");
  const dependencies = CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES;
  const addressBindings = [
    ["launcher PoolManager", "poolManager", dependencies.poolManager.address],
    ["launcher PositionManager", "positionManager", dependencies.positionManager.address],
    ["launcher token factory", "tokenFactory", dependencies.tokenFactory.address],
    ["launcher fee hook", "feeHook", dependencies.feeHook.address],
    ["launcher position planner", "positionPlanner", dependencies.positionPlanner.address],
    ["launcher reward vault factory", "rewardVaultFactory", dependencies.rewardVaultFactory.address],
    ["launcher custody factory", "initialBuyVestingWalletFactory", dependencies.initialBuyVestingWalletFactory.address],
    ["launcher policy", "launchPolicy", dependencies.launchPolicy.address],
    ["launcher forwarder factory", "positionForwarderFactory", dependencies.positionForwarderFactory.address],
    ["launcher canonical Router", "ROUTER", CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER.address],
  ];
  return [
    ...addressBindings.map(([label, functionName, expected]) =>
      callCheck(label, launcher, launcherAbi, functionName, addressResult(expected)),
    ),
    callCheck(
      "launcher supply",
      launcher,
      launcherAbi,
      "TOKEN_SUPPLY",
      uintResult(1_000_000_000n * 10n ** 18n),
    ),
    callCheck(
      "launcher minimum initial buy",
      launcher,
      launcherAbi,
      "MIN_INITIAL_BUY_WEI",
      uintResult(600_000_000_000_000n),
    ),
    callCheck(
      "launcher initial tick",
      launcher,
      launcherAbi,
      "INITIAL_TICK",
      intResult(204_200, "int24"),
    ),
    callCheck(
      "launcher tick spacing",
      launcher,
      launcherAbi,
      "TICK_SPACING",
      intResult(200, "int24"),
    ),
    callCheck(
      "launcher LP fee",
      launcher,
      launcherAbi,
      "LP_FEE_PIPS",
      uintResult(0, "uint24"),
    ),
  ];
}

export function classicV4LauncherUpgradeConstructorArguments() {
  return encodeAbiParameters(
    Array.from({ length: 9 }, () => ({ type: "address" })),
    Object.values(CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES).map(
      ({ address }) => address,
    ),
  );
}

export function classicV4LauncherUpgradeTransactionData(artifact) {
  validatedMetadata(artifact);
  return (
    creationCode(artifact) +
    classicV4LauncherUpgradeConstructorArguments().slice(2)
  );
}

export function buildClassicV4LauncherUpgradePlan({
  artifact,
  releaseCommit,
  releaseTree,
  repositoryClean,
  startingNonce,
  observedAtBlock,
  observedAtBlockHash,
  sourcePinsDigest,
  snapshot,
}) {
  assert(repositoryClean === true, "Launcher upgrade requires a clean worktree");
  const commit = assertCommit(releaseCommit, "release commit");
  const tree = assertCommit(releaseTree, "release tree");
  assert(
    Number.isSafeInteger(startingNonce) && startingNonce >= 0,
    "Invalid starting nonce",
  );
  assertPositiveInteger(observedAtBlock, "observed block");
  assertBytes32(observedAtBlockHash, "observed block hash");
  assertBytes32(sourcePinsDigest, "source pins digest");
  const build = computeClassicV4LauncherUpgradeBuildCommitments(artifact);
  const deployer = canonicalAddress(CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER);
  const predictedAddress = getContractAddress({
    from: deployer,
    nonce: BigInt(startingNonce),
    opcode: "CREATE",
  });
  const constructorArguments = classicV4LauncherUpgradeConstructorArguments();
  const data = classicV4LauncherUpgradeTransactionData(artifact);
  const runtimeTemplate = build.artifact;
  const sourceCommitment = digestJson(
    {
      contract: CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET,
      artifact: runtimeTemplate,
      sourceClosureDigest: build.sourceClosureDigest,
      sourcePinsDigest,
      dependencies: CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES,
      router: CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER,
      constructorArguments,
    },
    CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.sourceCommitment,
  );
  const reviewedGasLimit = assertDecimal(
    snapshot?.reviewedGasLimit,
    "reviewed gas limit",
    { positive: true },
  );
  assert(
    BigInt(reviewedGasLimit) >= CLASSIC_V4_LAUNCHER_UPGRADE_MIN_GAS_LIMIT &&
      BigInt(reviewedGasLimit) <= CLASSIC_V4_LAUNCHER_UPGRADE_MAX_GAS_LIMIT,
    "Reviewed gas limit is outside the launcher upgrade envelope",
  );
  const preflight = {
    independentRpcCount: snapshot?.independentRpcCount,
    freshDeterministicBuild: snapshot?.freshDeterministicBuild,
    sourcePinsVerified: snapshot?.sourcePinsVerified,
    dependencyRuntimeVerified: snapshot?.dependencyRuntimeVerified,
    dependencyBindingsVerified: snapshot?.dependencyBindingsVerified,
    canonicalRouterVerified: snapshot?.canonicalRouterVerified,
    constructorSimulationVerified: snapshot?.constructorSimulationVerified,
    predictedAddressVacant: snapshot?.predictedAddressVacant,
    deployerNonceReconciled: snapshot?.deployerNonceReconciled,
    deployerBalanceVerified: snapshot?.deployerBalanceVerified,
    estimatedGas: assertDecimal(snapshot?.estimatedGas, "estimated gas", {
      positive: true,
    }),
    reviewedGasLimit,
    gasPriceWei: assertDecimal(snapshot?.gasPriceWei, "gas price", {
      positive: true,
    }),
    deployerBalanceWei: assertDecimal(
      snapshot?.deployerBalanceWei,
      "deployer balance",
      { positive: true },
    ),
    requiredBalanceWei: assertDecimal(
      snapshot?.requiredBalanceWei,
      "required balance",
      { positive: true },
    ),
  };
  for (const [key, value] of Object.entries(preflight)) {
    if (typeof value === "boolean") assert(value, `Preflight ${key} is not verified`);
  }
  assert(preflight.independentRpcCount === 2, "Two independent RPCs are required");
  assert(
    BigInt(preflight.estimatedGas) <= BigInt(preflight.reviewedGasLimit),
    "Estimated gas exceeds the reviewed limit",
  );
  assert(
    BigInt(preflight.deployerBalanceWei) >= BigInt(preflight.requiredBalanceWei),
    "Deployer balance is below the reviewed gas envelope",
  );
  const unsignedPlan = {
    schemaVersion: 1,
    status: "simulation-only",
    model: "classic",
    internalContractRelease: CLASSIC_V4_LAUNCHER_UPGRADE_RELEASE,
    chainId: CLASSIC_V4_CHAIN_ID,
    releaseCommit: commit,
    releaseTree: tree,
    sourceCommitment,
    sourceClosureDigest: build.sourceClosureDigest,
    sourcePinsDigest: sourcePinsDigest.toLowerCase(),
    deployer,
    startingNonce,
    observedAtBlock,
    observedAtBlockHash: observedAtBlockHash.toLowerCase(),
    predictedAddress,
    dependencies: CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES,
    router: CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER,
    runtimeTemplate,
    constructorArguments,
    transaction: {
      transactionType: "CREATE",
      from: deployer,
      to: null,
      nonce: startingNonce,
      value: "0",
      predictedAddress,
      data,
      dataHash: keccak256(data),
      gasLimit: reviewedGasLimit,
    },
    preflight,
    executionBoundary: {
      signs: false,
      broadcasts: false,
      writes: false,
      ownerApprovalRequiredForDeployment: true,
    },
  };
  return {
    ...unsignedPlan,
    planDigest: digestJson(
      unsignedPlan,
      CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.preparationPlan,
    ),
  };
}

export function validateClassicV4LauncherUpgradePlan(plan, artifact) {
  assertExactKeys(
    plan,
    [
      "schemaVersion",
      "status",
      "model",
      "internalContractRelease",
      "chainId",
      "releaseCommit",
      "releaseTree",
      "sourceCommitment",
      "sourceClosureDigest",
      "sourcePinsDigest",
      "deployer",
      "startingNonce",
      "observedAtBlock",
      "observedAtBlockHash",
      "predictedAddress",
      "dependencies",
      "router",
      "runtimeTemplate",
      "constructorArguments",
      "transaction",
      "preflight",
      "executionBoundary",
      "planDigest",
    ],
    "Classic V4 launcher upgrade plan",
  );
  assert(
    plan.schemaVersion === 1 &&
      plan.status === "simulation-only" &&
      plan.model === "classic" &&
      plan.internalContractRelease === CLASSIC_V4_LAUNCHER_UPGRADE_RELEASE &&
      plan.chainId === CLASSIC_V4_CHAIN_ID,
    "Classic V4 launcher upgrade identity is invalid",
  );
  const rebuilt = buildClassicV4LauncherUpgradePlan({
    artifact,
    releaseCommit: plan.releaseCommit,
    releaseTree: plan.releaseTree,
    repositoryClean: true,
    startingNonce: plan.startingNonce,
    observedAtBlock: plan.observedAtBlock,
    observedAtBlockHash: plan.observedAtBlockHash,
    sourcePinsDigest: plan.sourcePinsDigest,
    snapshot: plan.preflight,
  });
  assert(
    digestJson(plan, CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.rpcSnapshot) ===
      digestJson(rebuilt, CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.rpcSnapshot),
    "Classic V4 launcher upgrade plan differs from the reviewed artifact",
  );
  return plan;
}

export function buildClassicV4LauncherUpgradeReceiptEvidence({
  plan,
  transactionHash,
  transaction,
  receipt,
}) {
  assertTransactionHash(transactionHash);
  const expected = plan.transaction;
  const transactionTo = transaction?.to
    ? canonicalAddress(transaction.to)
    : null;
  assert(
    normalizeHex(transaction?.hash) === normalizeHex(transactionHash) &&
      normalizeHex(transaction?.from) === normalizeHex(expected.from) &&
      transactionTo === null &&
      Number(BigInt(transaction?.nonce ?? -1)) === expected.nonce &&
      BigInt(transaction?.value ?? -1) === 0n &&
      normalizeHex(keccak256(transaction?.input ?? "0x")) ===
        normalizeHex(expected.dataHash),
    "Submitted transaction differs from the reviewed launcher deployment",
  );
  assert(
    receipt &&
      normalizeHex(receipt.status) === "0x1" &&
      normalizeHex(receipt.transactionHash) === normalizeHex(transactionHash) &&
      normalizeHex(receipt.from) === normalizeHex(expected.from) &&
      receipt.to === null &&
      normalizeHex(receipt.contractAddress) ===
        normalizeHex(plan.predictedAddress) &&
      normalizeHex(receipt.blockHash) === normalizeHex(transaction.blockHash) &&
      Number(BigInt(receipt.blockNumber)) ===
        Number(BigInt(transaction.blockNumber)),
    "Launcher deployment receipt differs from the reviewed transaction",
  );
  const unsignedEvidence = {
    schemaVersion: 1,
    status: "receipt-confirmed",
    chainId: CLASSIC_V4_CHAIN_ID,
    planDigest: plan.planDigest,
    sourceCommitment: plan.sourceCommitment,
    transactionHash: transactionHash.toLowerCase(),
    blockNumber: Number(BigInt(receipt.blockNumber)),
    blockHash: receipt.blockHash.toLowerCase(),
    contractAddress: canonicalAddress(receipt.contractAddress),
    from: canonicalAddress(transaction.from),
    to: null,
    nonce: Number(BigInt(transaction.nonce)),
    value: "0",
    dataHash: keccak256(transaction.input),
    gasUsed: BigInt(receipt.gasUsed).toString(),
    effectiveGasPrice: BigInt(receipt.effectiveGasPrice ?? 0).toString(),
  };
  return {
    ...unsignedEvidence,
    evidenceDigest: digestJson(
      unsignedEvidence,
      CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.receiptEvidence,
    ),
  };
}

export function validateClassicV4LauncherUpgradeReceiptEvidence(plan, evidence) {
  assertExactKeys(
    evidence,
    [
      "schemaVersion",
      "status",
      "chainId",
      "planDigest",
      "sourceCommitment",
      "transactionHash",
      "blockNumber",
      "blockHash",
      "contractAddress",
      "from",
      "to",
      "nonce",
      "value",
      "dataHash",
      "gasUsed",
      "effectiveGasPrice",
      "evidenceDigest",
    ],
    "Classic V4 launcher receipt evidence",
  );
  assert(
    evidence.schemaVersion === 1 &&
      evidence.status === "receipt-confirmed" &&
      evidence.chainId === CLASSIC_V4_CHAIN_ID &&
      normalizeHex(evidence.planDigest) === normalizeHex(plan.planDigest) &&
      normalizeHex(evidence.sourceCommitment) === normalizeHex(plan.sourceCommitment) &&
      normalizeHex(evidence.contractAddress) === normalizeHex(plan.predictedAddress) &&
      normalizeHex(evidence.from) === normalizeHex(plan.deployer) &&
      evidence.to === null &&
      evidence.nonce === plan.startingNonce &&
      evidence.value === "0" &&
      normalizeHex(evidence.dataHash) === normalizeHex(plan.transaction.dataHash),
    "Classic V4 launcher receipt evidence identity differs",
  );
  assertTransactionHash(evidence.transactionHash);
  assertPositiveInteger(evidence.blockNumber, "receipt block");
  assertBytes32(evidence.blockHash, "receipt block hash");
  assertDecimal(evidence.gasUsed, "receipt gas used", { positive: true });
  assertDecimal(evidence.effectiveGasPrice, "receipt effective gas price");
  const { evidenceDigest, ...unsignedEvidence } = evidence;
  assert(
    normalizeHex(evidenceDigest) ===
      normalizeHex(
        digestJson(
          unsignedEvidence,
          CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.receiptEvidence,
        ),
      ),
    "Classic V4 launcher receipt evidence digest differs",
  );
  return evidence;
}

export function classicV4LauncherUpgradeRuntimeTemplateHash(code, artifact) {
  assert(typeof code === "string" && /^0x[0-9a-f]+$/i.test(code) && code !== "0x", "Invalid launcher runtime code");
  return keccak256(normalizeRuntimeImmutables(code, artifact));
}

export function buildClassicV4LauncherUpgradeVerificationEvidence({
  plan,
  receiptEvidence,
  verificationBlock,
  verificationBlockHash,
  verificationTimestamp,
  runtimeCode,
  artifact,
}) {
  validateClassicV4LauncherUpgradeReceiptEvidence(plan, receiptEvidence);
  assertPositiveInteger(verificationBlock, "verification block");
  assertBytes32(verificationBlockHash, "verification block hash");
  assert(
    Number.isSafeInteger(verificationTimestamp) && verificationTimestamp > 0,
    "Invalid verification timestamp",
  );
  const confirmations = verificationBlock - receiptEvidence.blockNumber + 1;
  assert(
    confirmations >= CLASSIC_V4_FINALITY_CONFIRMATIONS,
    `Launcher deployment requires ${CLASSIC_V4_FINALITY_CONFIRMATIONS} confirmations`,
  );
  const runtimeTemplateHash =
    classicV4LauncherUpgradeRuntimeTemplateHash(runtimeCode, artifact);
  assert(
    normalizeHex(runtimeTemplateHash) ===
      normalizeHex(plan.runtimeTemplate.runtimeTemplateHash),
    "Deployed launcher runtime differs from the reviewed artifact",
  );
  const unsignedEvidence = {
    schemaVersion: 1,
    status: "finalized",
    chainId: CLASSIC_V4_CHAIN_ID,
    planDigest: plan.planDigest,
    receiptEvidenceDigest: receiptEvidence.evidenceDigest,
    sourceCommitment: plan.sourceCommitment,
    verificationBlock,
    verificationBlockHash: verificationBlockHash.toLowerCase(),
    checkedAt: new Date(verificationTimestamp * 1_000).toISOString(),
    independentRpcCount: 2,
    confirmations,
    transactionHash: receiptEvidence.transactionHash,
    contractAddress: plan.predictedAddress,
    runtimeCodeHash: keccak256(runtimeCode),
    runtimeTemplateHash,
    dependencyRuntimeVerified: true,
    dependencyBindingsVerified: true,
    constructorBindingsVerified: true,
    canonicalRouterVerified: true,
  };
  return {
    ...unsignedEvidence,
    evidenceDigest: digestJson(
      unsignedEvidence,
      CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.verificationEvidence,
    ),
  };
}

export function classicV4LauncherUpgradeChainIdentity() {
  return {
    chainId: CLASSIC_V4_CHAIN_ID,
    chainIdHex: CLASSIC_V4_CHAIN_ID_HEX,
    finalityConfirmations: CLASSIC_V4_FINALITY_CONFIRMATIONS,
  };
}
