#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  concatHex,
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  getCreateAddress,
  http,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  parseEventLogs,
  recoverMessageAddress,
  stringToHex,
} from "viem";
import { mainnet } from "viem/chains";

const root = path.resolve(import.meta.dirname, "..", "..");
const contractsRoot = path.join(root, "contracts");
const releasePath = path.join(contractsRoot, "deployments", "mainnet-adaptive-v1.json");
const appManifestPath = path.join(contractsRoot, "config", "app-deployments.v1.json");
const requireLive = process.argv.includes("--require-live");
const rpcUrls = [
  process.env.ETHEREUM_RPC_URL,
  "https://eth.drpc.org",
  "https://ethereum-rpc.publicnode.com",
].filter(Boolean);
const treasury = getAddress("0x4957f49620AFf3Adbbe8195a4f633E49cc93376c");
const hookMask = (1n << 14n) - 1n;
const requiredHookFlags = 8_396n;

const artifactPaths = {
  positionPlanner: path.join(
    contractsRoot,
    "out",
    "AdaptiveCurvePositionPlannerV1.sol",
    "AdaptiveCurvePositionPlannerV1.json",
  ),
  hookFactory: path.join(
    contractsRoot,
    "out",
    "AdaptiveCurveFeeHookFactoryV1.sol",
    "AdaptiveCurveFeeHookFactoryV1.json",
  ),
  feeHook: path.join(
    contractsRoot,
    "out",
    "AdaptiveCurveFeeHookV1.sol",
    "AdaptiveCurveFeeHookV1.json",
  ),
  launcherTemplate: path.join(
    contractsRoot,
    "out",
    "AdaptiveCurveLaunchV1.sol",
    "AdaptiveCurveLaunchV1.json",
  ),
};

const launcherAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function adaptiveHookFactory() view returns (address)",
  "function positionPlanner() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function INITIAL_TICK() view returns (int24)",
  "function TICK_SPACING() view returns (int24)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function MIN_TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function MAX_TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function MIN_CURVE_POINTS() view returns (uint8)",
  "function MAX_CURVE_POINTS() view returns (uint8)",
]);
const hookFactoryAbi = parseAbi([
  "function ALL_HOOK_MASK() view returns (uint160)",
  "function REQUIRED_HOOK_FLAGS() view returns (uint160)",
]);
const positionFactoryAbi = parseAbi([
  "function positionManager() view returns (address)",
]);
const lifecycleEventsAbi = parseAbi([
  "event AdaptiveTokenLaunched(address indexed creator,address indexed token,bytes32 indexed poolId,address feeHook,bytes32 launchHash)",
  "event NativeSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,int24 fdvIndex,uint16 totalSwapFeeBps,uint256 grossNativeAmount,uint256 creatorFee,uint256 launcherFee)",
  "event CreatorFeesClaimed(bytes32 indexed poolId,address indexed creator,address indexed recipient,address caller,uint256 amount)",
  "event LauncherFeesClaimed(address indexed treasury,address indexed recipient,address indexed caller,uint256 amount)",
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

function validSignature(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{130}$/.test(value);
}

function unique(values) {
  return [...new Set(values)];
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function readArtifacts(release) {
  const artifacts = {};
  for (const [name, artifactPath] of Object.entries(artifactPaths)) {
    const artifact = await readJson(artifactPath);
    const runtime = artifact.deployedBytecode?.object;
    const creation = artifact.bytecode?.object;
    if (
      typeof runtime !== "string" ||
      !runtime.startsWith("0x") ||
      runtime.length <= 2 ||
      typeof creation !== "string" ||
      !creation.startsWith("0x") ||
      creation.length <= 2
    ) {
      fail(`Missing bytecode for ${name}; run forge build first`);
    }
    const actualBytes = (runtime.length - 2) / 2;
    const actualHash = keccak256(runtime);
    const expected = release.artifactRuntime[name];
    if (!expected || actualBytes !== expected.bytes || actualHash !== expected.codeHash) {
      fail(
        `${name} artifact drift: bytes ${actualBytes}/${expected?.bytes}, hash ${actualHash}/${expected?.codeHash}`,
      );
    }
    artifacts[name] = { creation, runtime };
  }
  if (release.artifactRuntime.launcherTemplate.bytes > 23_000) {
    fail("Adaptive launcher exceeds the reviewed 23,000-byte release ceiling");
  }
  return artifacts;
}

function expectedSourceCommitment(release, artifacts) {
  const bytecodeCommitment = keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32,bytes32,bytes32,bytes32"), [
      keccak256(artifacts.positionPlanner.creation),
      keccak256(artifacts.hookFactory.creation),
      keccak256(artifacts.feeHook.creation),
      keccak256(artifacts.launcherTemplate.creation),
    ]),
  );
  const dependencyCommitment = keccak256(
    encodeAbiParameters(
      parseAbiParameters("address,address,address,address,address,address,address,address,address"),
      [
        getAddress(release.officialDependencies.poolManager.address),
        getAddress(release.officialDependencies.positionManager.address),
        getAddress(release.officialDependencies.stateView.address),
        getAddress(release.officialDependencies.v4Quoter.address),
        getAddress(release.officialDependencies.uerc20Factory.address),
        getAddress(release.officialDependencies.permit2.address),
        getAddress(release.officialDependencies.universalRouter.address),
        getAddress(release.officialDependencies.positionForwarderFactory.address),
        treasury,
      ],
    ),
  );
  const economicsCommitment = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256,uint256,int256,int256,uint256,uint256,uint256,uint256,uint256,bytes32,bytes32,bytes32",
      ),
      [
        10n,
        0n,
        200n,
        204_200n,
        1_000_000_000n * 10n ** 18n,
        2n,
        8n,
        100n,
        1_000n,
        keccak256(stringToHex("immutable-piecewise-linear-negated-pre-swap-tick")),
        keccak256(stringToHex("optional-atomic-creator-buy")),
        keccak256(stringToHex("one-sided-permanently-locked-official-v4-position")),
      ],
    ),
  );
  const securityCommitment = keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32,bytes32,bytes32"), [
        keccak256(stringToHex("creator-bound-hook-nonce")),
        keccak256(stringToHex("forced-native-balance-preserved")),
        keccak256(stringToHex("creator-initiated-fee-claim")),
    ]),
  );
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32,bytes32,bytes32,bytes32,bytes32"), [
      keccak256(stringToHex("programmable.adaptive.infrastructure.v1.ethereum")),
      bytecodeCommitment,
      dependencyCommitment,
      economicsCommitment,
      securityCommitment,
    ]),
  );
}

async function verifyDependencies(release, clients) {
  for (const [name, dependency] of Object.entries(release.officialDependencies)) {
    if (!isAddress(dependency.address) || !validHash(dependency.runtimeCodeHash)) {
      fail(`Adaptive dependency ${name} is malformed`);
    }
    const codes = await Promise.all(
      clients.map((client) => client.getCode({ address: getAddress(dependency.address) })),
    );
    for (const code of codes) {
      if (!code || code === "0x") fail(`Adaptive dependency ${name} has no runtime code`);
      const actualHash = keccak256(code);
      if (actualHash !== dependency.runtimeCodeHash) {
        fail(
          `Adaptive dependency ${name} runtime drift: ${actualHash} != ${dependency.runtimeCodeHash}`,
        );
      }
    }
  }
}

function verifyCandidatePlan(release, artifacts) {
  const candidate = release.candidatePlan;
  if (
    !candidate ||
    candidate.status !== "simulation-only-refresh-before-signing" ||
    !isAddress(candidate.deployer) ||
    !Number.isSafeInteger(candidate.startingNonce) ||
    candidate.startingNonce < 0 ||
    candidate.transactionCount !== 3 ||
    !validHash(candidate.sampleHookSalt)
  ) {
    fail("Adaptive candidate plan is missing or malformed");
  }

  const deployer = getAddress(candidate.deployer);
  const positionPlanner = getCreateAddress({
    from: deployer,
    nonce: BigInt(candidate.startingNonce),
  });
  const hookFactory = getCreateAddress({
    from: deployer,
    nonce: BigInt(candidate.startingNonce + 1),
  });
  const launcher = getCreateAddress({
    from: deployer,
    nonce: BigInt(candidate.startingNonce + 2),
  });
  const constructorArguments = encodeAbiParameters(
    parseAbiParameters("address,address"),
    [
      getAddress(release.officialDependencies.poolManager.address),
      treasury,
    ],
  );
  const sampleHook = getCreate2Address({
    from: hookFactory,
    salt: candidate.sampleHookSalt,
    bytecodeHash: keccak256(concatHex([artifacts.feeHook.creation, constructorArguments])),
  });
  const hookInitCodeHash = keccak256(
    concatHex([artifacts.feeHook.creation, constructorArguments]),
  );
  const expected = { positionPlanner, hookFactory, launcher, sampleHook };
  for (const [field, address] of Object.entries(expected)) {
    if (!sameAddress(candidate[field], address)) {
      fail(`Adaptive candidate ${field} is not deterministic`);
    }
  }
  if ((BigInt(sampleHook) & hookMask) !== requiredHookFlags) {
    fail("Adaptive candidate sample hook has the wrong callback permission bits");
  }
  if (
    candidate.hookInitCodeHash !== hookInitCodeHash ||
    candidate.allHookMask !== hookMask.toString() ||
    candidate.requiredHookFlags !== requiredHookFlags.toString()
  ) {
    fail("Adaptive candidate hook init code or permission disclosure is invalid");
  }
}

function assertDisabled(release, appRelease) {
  for (const field of ["positionPlanner", "hookFactory", "launcher"]) {
    if (
      release.addresses[field] !== null ||
      release.transactions[field] !== null ||
      release.deploymentBlocks[field] !== null ||
      release.deploymentEvidence[field] !== null ||
      release.runtimeCodeHashes[field] !== null
    ) {
      fail(`Undeployed Adaptive manifest contains a populated ${field}`);
    }
  }
  if (
    release.releaseCommit !== null ||
    release.startingNonce !== null ||
    release.sourceVerification?.status !== "not-submitted" ||
    release.lifecycleEvidence?.status !== "not-run" ||
    release.lifecycleEvidence?.releaseEligible !== false ||
    release.lifecycleEvidence?.evidenceHash !== null ||
    release.lifecycleEvidence?.attestation?.signer !== null ||
    release.lifecycleEvidence?.attestation?.signature !== null
  ) {
    fail("Undeployed Adaptive manifest contains live release evidence");
  }
  for (const field of ["positionPlanner", "hookFactory", "launcher", "canaryFeeHook"]) {
    if (
      release.sourceVerification?.[field]?.etherscan !== null ||
      release.sourceVerification?.[field]?.sourcify !== null
    ) {
      fail(`Undeployed Adaptive manifest contains ${field} source evidence`);
    }
  }
  if (
    appRelease.adaptiveLaunchStatus !== "not-deployed" ||
    appRelease.adaptiveCurvePositionPlanner != null ||
    appRelease.adaptiveCurveFeeHookFactory !== null ||
    appRelease.adaptiveCurveLaunch !== null ||
    appRelease.runtimeCodeHashes.adaptiveCurvePositionPlanner != null ||
    appRelease.runtimeCodeHashes.adaptiveCurveFeeHookFactory !== null ||
    appRelease.runtimeCodeHashes.adaptiveCurveLaunch !== null ||
    appRelease.deploymentTransactions?.adaptiveCurvePositionPlanner != null ||
    appRelease.deploymentTransactions?.adaptiveCurveFeeHookFactory != null ||
    appRelease.deploymentTransactions?.adaptiveCurveLaunch != null ||
    appRelease.deploymentBlocks?.adaptiveCurvePositionPlanner != null ||
    appRelease.deploymentBlocks?.adaptiveCurveFeeHookFactory != null ||
    appRelease.deploymentBlocks?.adaptiveCurveLaunch != null
  ) {
    fail("Application manifest disagrees with the undeployed Adaptive release");
  }
}

function verifyCompilerConfiguration(sourceVerification) {
  const compiler = sourceVerification?.compiler;
  if (
    compiler?.version !== "0.8.26" ||
    compiler?.optimizerEnabled !== true ||
    compiler?.optimizerRuns !== 1_000 ||
    compiler?.evmVersion !== "cancun" ||
    compiler?.bytecodeHash !== "none" ||
    compiler?.cborMetadata !== false
  ) {
    fail("Adaptive source-verification compiler settings do not match Foundry");
  }
}

async function sourcifyMatched(address) {
  const response = await fetch(
    `https://sourcify.dev/server/v2/contract/1/${getAddress(address)}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (response.status === 404) return false;
  if (!response.ok) fail(`Sourcify returned HTTP ${response.status} for ${address}`);
  const body = await response.json();
  return [
    body?.match,
    body?.creationMatch,
    body?.runtimeMatch,
  ].some((value) => value === "exact_match" || value === "match");
}

async function etherscanMatched(address) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) fail("ETHERSCAN_API_KEY is required to verify a live Adaptive release");
  const url = new URL("https://api.etherscan.io/v2/api");
  url.searchParams.set("chainid", "1");
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "getsourcecode");
  url.searchParams.set("address", getAddress(address));
  url.searchParams.set("apikey", apiKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) fail(`Etherscan returned HTTP ${response.status} for ${address}`);
  const body = await response.json();
  const source = body?.result?.[0];
  return (
    body?.status === "1" &&
    typeof source?.SourceCode === "string" &&
    source.SourceCode.length > 0 &&
    typeof source?.CompilerVersion === "string" &&
    source.CompilerVersion.includes("v0.8.26")
  );
}

async function verifySourceEvidence(release) {
  verifyCompilerConfiguration(release.sourceVerification);
  const contracts = {
    positionPlanner: release.addresses.positionPlanner,
    hookFactory: release.addresses.hookFactory,
    launcher: release.addresses.launcher,
    canaryFeeHook: release.lifecycleEvidence.feeHook,
  };
  for (const [field, rawAddress] of Object.entries(contracts)) {
    const address = getAddress(rawAddress);
    const evidence = release.sourceVerification[field];
    if (
      evidence?.etherscan?.status !== "exact-match" ||
      evidence?.etherscan?.url !== `https://etherscan.io/address/${address}#code` ||
      evidence?.sourcify?.status !== "exact-match" ||
      evidence?.sourcify?.url !== `https://repo.sourcify.dev/contracts/full_match/1/${address}/`
    ) {
      fail(`Adaptive ${field} source-verification evidence is incomplete`);
    }
    const [sourcify, etherscan] = await Promise.all([
      sourcifyMatched(address),
      etherscanMatched(address),
    ]);
    if (!sourcify || !etherscan) {
      fail(`Adaptive ${field} source is not verified by both providers`);
    }
  }
}

async function verifyDeploymentTransactions(release, artifacts, clients) {
  const deployer = getAddress(release.addresses.deployer);
  const fields = ["positionPlanner", "hookFactory", "launcher"];
  const expectedInput = {
    positionPlanner: artifacts.positionPlanner.creation,
    hookFactory: artifacts.hookFactory.creation,
    launcher: concatHex([
      artifacts.launcherTemplate.creation,
      encodeAbiParameters(
        parseAbiParameters("address,address,address,address,address,address,address"),
        [
          getAddress(release.officialDependencies.poolManager.address),
          getAddress(release.officialDependencies.positionManager.address),
          getAddress(release.officialDependencies.uerc20Factory.address),
          getAddress(release.addresses.hookFactory),
          getAddress(release.addresses.positionPlanner),
          getAddress(release.addresses.positionForwarderFactory),
          treasury,
        ],
      ),
    ]),
  };

  for (const [index, field] of fields.entries()) {
    const address = getAddress(release.addresses[field]);
    const transactionHash = release.transactions[field];
    const expectedNonce = release.startingNonce + index;
    const expectedAddress = getCreateAddress({
      from: deployer,
      nonce: BigInt(expectedNonce),
    });
    if (!sameAddress(address, expectedAddress)) {
      fail(`Adaptive ${field} address is not deterministic`);
    }

    const [transactions, receipts] = await Promise.all([
      Promise.all(clients.map((client) => client.getTransaction({ hash: transactionHash }))),
      Promise.all(
        clients.map((client) => client.getTransactionReceipt({ hash: transactionHash })),
      ),
    ]);
    for (const transaction of transactions) {
      if (
        !sameAddress(transaction.from, deployer) ||
        transaction.to !== null ||
        transaction.nonce !== expectedNonce ||
        transaction.input !== expectedInput[field]
      ) {
        fail(`Adaptive ${field} deployment transaction does not match the reviewed plan`);
      }
    }
    for (const receipt of receipts) {
      if (
        receipt.status !== "success" ||
        !sameAddress(receipt.contractAddress, address) ||
        Number(receipt.blockNumber) !== release.deploymentBlocks[field]
      ) {
        fail(`Adaptive ${field} deployment receipt does not match the release manifest`);
      }
    }
    const recorded = release.deploymentEvidence[field];
    if (
      recorded?.transactionHash !== transactionHash ||
      !sameAddress(recorded?.from, deployer) ||
      recorded?.nonce !== expectedNonce ||
      !sameAddress(recorded?.contractAddress, address) ||
      recorded?.blockNumber !== release.deploymentBlocks[field] ||
      recorded?.status !== "success"
    ) {
      fail(`Adaptive ${field} recorded receipt evidence does not match`);
    }
    if (field === "launcher") {
      const constructorArguments = recorded.constructorArguments;
      if (
        !sameAddress(
          constructorArguments?.poolManager,
          release.officialDependencies.poolManager.address,
        ) ||
        !sameAddress(
          constructorArguments?.positionManager,
          release.officialDependencies.positionManager.address,
        ) ||
        !sameAddress(
          constructorArguments?.tokenFactory,
          release.officialDependencies.uerc20Factory.address,
        ) ||
        !sameAddress(constructorArguments?.hookFactory, release.addresses.hookFactory) ||
        !sameAddress(constructorArguments?.positionPlanner, release.addresses.positionPlanner) ||
        !sameAddress(
          constructorArguments?.positionForwarderFactory,
          release.addresses.positionForwarderFactory,
        ) ||
        !sameAddress(constructorArguments?.treasury, treasury)
      ) {
        fail("Adaptive launcher constructor evidence does not match");
      }
    }
  }
}

function lifecycleEvidenceHash(release, evidence) {
  const identityCommitment = keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32,uint256,address,address,address,address,bytes32,bytes32"),
      [
        keccak256(stringToHex("programmable.adaptive.lifecycle.v1")),
        1n,
        getAddress(release.addresses.launcher),
        getAddress(evidence.creator),
        getAddress(evidence.token),
        getAddress(evidence.feeHook),
        evidence.poolId,
        evidence.launchHash,
      ],
    ),
  );
  const transactionCommitment = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32,bytes32,bytes32,bytes32,bytes32,uint256,uint256,uint256,uint256,uint256",
      ),
      [
        evidence.transactions.launch,
        evidence.transactions.buy,
        evidence.transactions.sell,
        evidence.transactions.creatorClaim,
        evidence.transactions.launcherClaim,
        BigInt(evidence.blocks.launch),
        BigInt(evidence.blocks.buy),
        BigInt(evidence.blocks.sell),
        BigInt(evidence.blocks.creatorClaim),
        BigInt(evidence.blocks.launcherClaim),
      ],
    ),
  );
  const accountingCommitment = keccak256(
    encodeAbiParameters(
      parseAbiParameters("uint256,uint256,uint256,uint256,uint256"),
      [
        BigInt(evidence.creatorFeesAccruedWei),
        BigInt(evidence.launcherFeesAccruedWei),
        BigInt(evidence.creatorFeesClaimedWei),
        BigInt(evidence.launcherFeesClaimedWei),
        BigInt(evidence.treasuryBalanceDeltaWei),
      ],
    ),
  );
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32,bytes32,bytes32"), [
      identityCommitment,
      transactionCommitment,
      accountingCommitment,
    ]),
  );
}

function logsFor(receipt, address, eventName) {
  return parseEventLogs({
    abi: lifecycleEventsAbi,
    logs: receipt.logs,
    eventName,
    strict: true,
  }).filter((log) => sameAddress(log.address, address));
}

async function verifyLifecycleEvidence(release, clients) {
  const evidence = release.lifecycleEvidence;
  if (
    evidence?.status !== "verified-current-release" ||
    evidence?.releaseEligible !== true ||
    evidence?.requiredRelease !== "adaptive-v1" ||
    evidence?.independentRpcCount < 2 ||
    !isAddress(evidence?.creator) ||
    !isAddress(evidence?.token) ||
    !isAddress(evidence?.feeHook) ||
    !validHash(evidence?.poolId) ||
    !validHash(evidence?.launchHash) ||
    !validHash(evidence?.evidenceHash) ||
    !sameAddress(evidence?.attestation?.signer, release.addresses.deployer) ||
    !validSignature(evidence?.attestation?.signature)
  ) {
    fail("Adaptive lifecycle evidence is missing or incomplete");
  }
  const amounts = {
    creatorAccrued: BigInt(evidence.creatorFeesAccruedWei),
    launcherAccrued: BigInt(evidence.launcherFeesAccruedWei),
    creatorClaimed: BigInt(evidence.creatorFeesClaimedWei),
    launcherClaimed: BigInt(evidence.launcherFeesClaimedWei),
    treasuryDelta: BigInt(evidence.treasuryBalanceDeltaWei),
  };
  if (
    amounts.creatorAccrued <= 0n ||
    amounts.launcherAccrued <= 0n ||
    amounts.creatorAccrued !== amounts.creatorClaimed ||
    amounts.launcherAccrued !== amounts.launcherClaimed ||
    amounts.launcherClaimed !== amounts.treasuryDelta
  ) {
    fail("Adaptive lifecycle fee accounting is inconsistent");
  }
  const calculatedEvidenceHash = lifecycleEvidenceHash(release, evidence);
  if (calculatedEvidenceHash !== evidence.evidenceHash) {
    fail("Adaptive lifecycle evidence hash does not match its contents");
  }
  const recoveredSigner = await recoverMessageAddress({
    message: { raw: calculatedEvidenceHash },
    signature: evidence.attestation.signature,
  });
  if (!sameAddress(recoveredSigner, evidence.attestation.signer)) {
    fail("Adaptive lifecycle evidence signature is invalid");
  }

  const primaryReceipts = {};
  for (const field of ["launch", "buy", "sell", "creatorClaim", "launcherClaim"]) {
    const transactionHash = evidence.transactions?.[field];
    if (!validHash(transactionHash)) fail(`Adaptive lifecycle ${field} transaction is missing`);
    const receipts = await Promise.all(
      clients.map((client) => client.getTransactionReceipt({ hash: transactionHash })),
    );
    if (
      receipts.some(
        (receipt) =>
          receipt.status !== "success" ||
          Number(receipt.blockNumber) !== evidence.blocks?.[field],
      )
    ) {
      fail(`Adaptive lifecycle ${field} receipt does not match`);
    }
    primaryReceipts[field] = receipts[0];
  }

  const launchEvents = logsFor(
    primaryReceipts.launch,
    release.addresses.launcher,
    "AdaptiveTokenLaunched",
  );
  const launchEvent = launchEvents.find(
    (event) =>
      sameAddress(event.args.creator, evidence.creator) &&
      sameAddress(event.args.token, evidence.token) &&
      event.args.poolId === evidence.poolId &&
      sameAddress(event.args.feeHook, evidence.feeHook) &&
      event.args.launchHash === evidence.launchHash,
  );
  if (!launchEvent) fail("Adaptive lifecycle launch event does not match");

  const feeEvents = ["buy", "sell"].flatMap((field) =>
    logsFor(primaryReceipts[field], evidence.feeHook, "NativeSwapFeesAccrued"),
  ).filter((event) => event.args.poolId === evidence.poolId);
  const accrued = feeEvents.reduce(
    (total, event) => ({
      creator: total.creator + event.args.creatorFee,
      launcher: total.launcher + event.args.launcherFee,
    }),
    { creator: 0n, launcher: 0n },
  );
  if (
    accrued.creator !== amounts.creatorAccrued ||
    accrued.launcher !== amounts.launcherAccrued
  ) {
    fail("Adaptive lifecycle swap-fee events do not match accounting evidence");
  }

  const creatorClaim = logsFor(
    primaryReceipts.creatorClaim,
    evidence.feeHook,
    "CreatorFeesClaimed",
  ).find(
    (event) =>
      event.args.poolId === evidence.poolId &&
      sameAddress(event.args.creator, evidence.creator) &&
      sameAddress(event.args.recipient, evidence.creator) &&
      sameAddress(event.args.caller, evidence.creator) &&
      event.args.amount === amounts.creatorClaimed,
  );
  if (!creatorClaim) fail("Adaptive lifecycle creator claim does not match");

  const launcherClaim = logsFor(
    primaryReceipts.launcherClaim,
    evidence.feeHook,
    "LauncherFeesClaimed",
  ).find(
    (event) =>
      sameAddress(event.args.treasury, treasury) &&
      sameAddress(event.args.recipient, treasury) &&
      event.args.amount === amounts.launcherClaimed,
  );
  if (!launcherClaim) {
    fail("Adaptive lifecycle Launcher claim does not match");
  }
}

async function verifyLiveRelease(release, appRelease, artifacts, clients) {
  if (release.status !== "deployment-source-and-lifecycle-verified") {
    fail(`Unsupported live Adaptive release status: ${release.status}`);
  }
  if (
    !/^[a-f0-9]{40}$/.test(release.releaseCommit ?? "") ||
    !Number.isSafeInteger(release.startingNonce) ||
    release.startingNonce < 0 ||
    !isAddress(release.addresses.deployer) ||
    !sameAddress(release.addresses.treasury, treasury) ||
    release.sourceVerification?.status !== "verified"
  ) {
    fail("Live Adaptive release lacks commit, deterministic deployment or source verification");
  }

  const mapping = {
    positionPlanner: "adaptiveCurvePositionPlanner",
    hookFactory: "adaptiveCurveFeeHookFactory",
    launcher: "adaptiveCurveLaunch",
  };
  for (const field of ["positionPlanner", "hookFactory", "launcher"]) {
    if (
      !isAddress(release.addresses[field]) ||
      !validHash(release.transactions[field]) ||
      !validHash(release.runtimeCodeHashes[field]) ||
      !Number.isSafeInteger(release.deploymentBlocks[field]) ||
      release.deploymentBlocks[field] <= 0
    ) {
      fail(`Live Adaptive manifest is missing ${field}`);
    }
    const codes = await Promise.all(
      clients.map((client) => client.getCode({ address: getAddress(release.addresses[field]) })),
    );
    if (
      codes.some(
        (code) => !code || code === "0x" || keccak256(code) !== release.runtimeCodeHashes[field],
      )
    ) {
      fail(`Deployed Adaptive ${field} runtime does not match`);
    }
  }
  for (const [releaseField, appField] of Object.entries(mapping)) {
    if (
      !sameAddress(release.addresses[releaseField], appRelease[appField]) ||
      release.runtimeCodeHashes[releaseField] !== appRelease.runtimeCodeHashes[appField] ||
      release.transactions[releaseField] !== appRelease.deploymentTransactions?.[appField] ||
      release.deploymentBlocks[releaseField] !== appRelease.deploymentBlocks?.[appField]
    ) {
      fail(`Application Adaptive ${releaseField} differs from the release manifest`);
    }
  }
  if (appRelease.adaptiveLaunchStatus !== "ready") {
    fail("Application Adaptive release is not ready");
  }

  await verifyDeploymentTransactions(release, artifacts, clients);
  await verifyLifecycleEvidence(release, clients);
  await verifySourceEvidence(release);

  const primary = clients[0];
  const launcher = getAddress(release.addresses.launcher);
  const hookFactory = getAddress(release.addresses.hookFactory);
  const dependencies = release.officialDependencies;
  const values = await Promise.all([
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "poolManager" }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "positionManager" }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "tokenFactory" }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "adaptiveHookFactory" }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "positionPlanner" }),
    primary.readContract({
      address: launcher,
      abi: launcherAbi,
      functionName: "positionForwarderFactory",
    }),
    primary.readContract({
      address: launcher,
      abi: launcherAbi,
      functionName: "launcherFeeRecipient",
    }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "TOKEN_SUPPLY" }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "INITIAL_TICK" }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "TICK_SPACING" }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "LP_FEE_PIPS" }),
    primary.readContract({
      address: launcher,
      abi: launcherAbi,
      functionName: "MIN_TOTAL_SWAP_FEE_BPS",
    }),
    primary.readContract({
      address: launcher,
      abi: launcherAbi,
      functionName: "MAX_TOTAL_SWAP_FEE_BPS",
    }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "MIN_CURVE_POINTS" }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "MAX_CURVE_POINTS" }),
    primary.readContract({
      address: hookFactory,
      abi: hookFactoryAbi,
      functionName: "ALL_HOOK_MASK",
    }),
    primary.readContract({
      address: hookFactory,
      abi: hookFactoryAbi,
      functionName: "REQUIRED_HOOK_FLAGS",
    }),
    primary.readContract({
      address: getAddress(release.addresses.positionForwarderFactory),
      abi: positionFactoryAbi,
      functionName: "positionManager",
    }),
  ]);

  const addresses = [
    [values[0], dependencies.poolManager.address, "PoolManager"],
    [values[1], dependencies.positionManager.address, "PositionManager"],
    [values[2], dependencies.uerc20Factory.address, "UERC20Factory"],
    [values[3], hookFactory, "hook factory"],
    [values[4], release.addresses.positionPlanner, "position planner"],
    [values[5], release.addresses.positionForwarderFactory, "position forwarder factory"],
    [values[6], treasury, "treasury"],
    [values[17], dependencies.positionManager.address, "position factory PositionManager"],
  ];
  for (const [actual, expected, label] of addresses) {
    if (!sameAddress(actual, expected)) fail(`Adaptive ${label} mismatch`);
  }
  if (
    values[7] !== 1_000_000_000n * 10n ** 18n ||
    values[8] !== 204_200 ||
    values[9] !== 200 ||
    values[10] !== 0 ||
    values[11] !== 100 ||
    values[12] !== 1_000 ||
    values[13] !== 2 ||
    values[14] !== 8 ||
    values[15] !== hookMask ||
    values[16] !== requiredHookFlags
  ) {
    fail("Adaptive immutable economics or hook permissions mismatch");
  }
}

const [release, appManifest] = await Promise.all([
  readJson(releasePath),
  readJson(appManifestPath),
]);
if (
  release.schemaVersion !== 1 ||
  release.model !== "adaptive-v1" ||
  release.releaseVersion !== "adaptive-v1" ||
  release.chainId !== 1
) {
  fail("Adaptive release manifest identity is invalid");
}
if (appManifest.production?.chainId !== 1) {
  fail("Application production manifest is not Ethereum Mainnet");
}
if (!sameAddress(release.addresses.treasury, treasury)) {
  fail("Adaptive treasury does not match the reviewed address");
}
verifyCompilerConfiguration(release.sourceVerification);
if (
  !sameAddress(
    release.addresses.positionForwarderFactory,
    appManifest.production.lockedPositionFeeForwarderFactory,
  ) ||
  !sameAddress(
    release.addresses.positionForwarderFactory,
    release.officialDependencies.positionForwarderFactory.address,
  )
) {
  fail("Adaptive position forwarder factory differs between release sources");
}

const artifacts = await readArtifacts(release);
const sourceCommitment = expectedSourceCommitment(release, artifacts);
if (release.sourceCommitment !== sourceCommitment) {
  fail(`Adaptive source commitment drift: ${sourceCommitment} != ${release.sourceCommitment}`);
}
verifyCandidatePlan(release, artifacts);

const clients = unique(rpcUrls)
  .slice(0, 2)
  .map((rpcUrl) =>
    createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl, { retryCount: 1, timeout: 15_000 }),
    }),
  );
if (clients.length < 2) fail("Adaptive verification requires two independent RPCs");
await verifyDependencies(release, clients);

if (release.status === "not-deployed") {
  assertDisabled(release, appManifest.production);
  if (requireLive) fail("Adaptive V1 is not deployed");
  const currentNonce = await clients[0].getTransactionCount({
    address: getAddress(release.candidatePlan.deployer),
  });
  const freshness =
    currentNonce === release.candidatePlan.startingNonce
      ? "candidate nonce is current"
      : `candidate nonce is stale (${release.candidatePlan.startingNonce}/${currentNonce})`;
  console.log(
    `Adaptive artifacts, deterministic plan, source commitment and two-RPC dependency hashes match; deployment disabled; ${freshness}.`,
  );
  process.exit(0);
}

await verifyLiveRelease(release, appManifest.production, artifacts, clients);
console.log(
  "Adaptive deployment, receipts, source verification, lifecycle evidence and immutable configuration match.",
);
