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
} from "viem";
import { mainnet, sepolia } from "viem/chains";

const root = path.resolve(import.meta.dirname, "..", "..");
const contractsRoot = path.join(root, "contracts");
const appManifestPath = path.join(contractsRoot, "config", "app-deployments.v1.json");
const requireLive = process.argv.includes("--require-live");
const requestedNetwork =
  process.argv.find((argument) => argument.startsWith("--network="))?.split("=")[1] ?? "all";
const hookMask = (1n << 14n) - 1n;
const requiredHookFlags = 8_396n;
const expectedTreasury = getAddress("0x4957f49620AFf3Adbbe8195a4f633E49cc93376c");

const networkDefinitions = {
  mainnet: {
    chain: mainnet,
    environment: "production",
    releasePath: path.join(contractsRoot, "deployments", "mainnet-classic-v3.json"),
    rpcUrls: [
      process.env.ETHEREUM_RPC_URL,
      "https://eth.drpc.org",
      "https://ethereum-rpc.publicnode.com",
    ].filter(Boolean),
  },
  sepolia: {
    chain: sepolia,
    environment: "rehearsal",
    releasePath: path.join(contractsRoot, "deployments", "sepolia-classic-v3.json"),
    rpcUrls: [
      process.env.SEPOLIA_RPC_URL,
      "https://sepolia.drpc.org",
      "https://ethereum-sepolia-rpc.publicnode.com",
    ].filter(Boolean),
  },
};

const artifactPaths = {
  feeSplitVaultFactory: path.join(
    contractsRoot,
    "out",
    "FeeSplitVaultFactoryV1.sol",
    "FeeSplitVaultFactoryV1.json",
  ),
  hookFactory: path.join(
    contractsRoot,
    "out",
    "EthCreatorFeeHookFactoryV3.sol",
    "EthCreatorFeeHookFactoryV3.json",
  ),
  feeHookTemplate: path.join(
    contractsRoot,
    "out",
    "EthCreatorFeeHookV3.sol",
    "EthCreatorFeeHookV3.json",
  ),
  launcherTemplate: path.join(
    contractsRoot,
    "out",
    "MemeLaunchV2.sol",
    "MemeLaunchV2.json",
  ),
};

const hookAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function LAUNCHER_FEE_BPS() view returns (uint16)",
  "function MIN_TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function MAX_TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function TOTAL_SWAP_FEE_STEP_BPS() view returns (uint16)",
  "function TRANSFER_TAX_BPS() view returns (uint16)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
]);
const launcherAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
]);
const hookFactoryAbi = parseAbi([
  "function isFactoryHook(address hook) view returns (bool)",
]);
const positionFactoryAbi = parseAbi([
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

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function unique(values) {
  return [...new Set(values)];
}

async function verifyArtifacts(release) {
  for (const [name, artifactPath] of Object.entries(artifactPaths)) {
    const artifact = await readJson(artifactPath);
    const runtime = artifact.deployedBytecode?.object;
    if (typeof runtime !== "string" || !runtime.startsWith("0x") || runtime.length <= 2) {
      fail(`Missing deployed bytecode for ${name}; run forge build first`);
    }
    const expected = release.artifactRuntime?.[name];
    const bytes = (runtime.length - 2) / 2;
    const hash = keccak256(runtime);
    if (!expected || expected.bytes !== bytes || expected.codeHash !== hash) {
      fail(
        `${name} artifact drift: bytes ${bytes}/${expected?.bytes}, hash ${hash}/${expected?.codeHash}`,
      );
    }
  }
  if (release.artifactRuntime.launcherTemplate.bytes > 23_000) {
    fail("Classic launcher exceeds the reviewed 23,000-byte release ceiling");
  }
}

function verifyCandidatePlan(release, creationBytecode) {
  const candidate = release.candidatePlan;
  if (!candidate || candidate.status !== "simulation-only-refresh-before-signing") {
    fail("Classic candidate plan is missing its simulation-only status");
  }
  if (
    !isAddress(candidate.deployer) ||
    !Number.isSafeInteger(candidate.startingNonce) ||
    candidate.startingNonce < 0 ||
    candidate.transactionCount !== 4
  ) {
    fail("Classic candidate plan identity is invalid");
  }

  const deployer = getAddress(candidate.deployer);
  const vaultFactory = getCreateAddress({
    from: deployer,
    nonce: BigInt(candidate.startingNonce),
  });
  const hookFactory = getCreateAddress({
    from: deployer,
    nonce: BigInt(candidate.startingNonce + 1),
  });
  const launcher = getCreateAddress({
    from: deployer,
    nonce: BigInt(candidate.startingNonce + 3),
  });
  const constructorArguments = encodeAbiParameters(
    parseAbiParameters("address,address,address"),
    [
      getAddress(release.officialDependencies.poolManager.address),
      expectedTreasury,
      vaultFactory,
    ],
  );
  const feeHook = getCreate2Address({
    from: hookFactory,
    salt: candidate.hookSalt,
    bytecodeHash: keccak256(concatHex([creationBytecode, constructorArguments])),
  });

  const expected = {
    feeSplitVaultFactory: vaultFactory,
    hookFactory,
    feeHook,
    launcher,
  };
  for (const [field, address] of Object.entries(expected)) {
    if (!sameAddress(candidate[field], address)) {
      fail(`Classic candidate ${field} is not deterministic`);
    }
  }
  if ((BigInt(feeHook) & hookMask) !== requiredHookFlags) {
    fail("Classic candidate hook has the wrong callback permission bits");
  }
}

async function verifyDependencies(release, clients) {
  for (const [name, dependency] of Object.entries(release.officialDependencies)) {
    if (!isAddress(dependency.address) || !validHash(dependency.runtimeCodeHash)) {
      fail(`Classic dependency ${name} is malformed`);
    }
    const codes = await Promise.all(
      clients.map((client) => client.getCode({ address: dependency.address })),
    );
    for (const code of codes) {
      if (!code || code === "0x") fail(`Classic dependency ${name} has no runtime code`);
      const actual = keccak256(code);
      if (actual !== dependency.runtimeCodeHash) {
        fail(
          `Classic dependency ${name} runtime drift: ${actual} != ${dependency.runtimeCodeHash}`,
        );
      }
    }
  }
}

function assertDisabled(release, appRelease) {
  for (const field of ["feeSplitVaultFactory", "hookFactory", "feeHook", "launcher"]) {
    if (
      release.addresses[field] !== null ||
      release.transactions[field] !== null ||
      release.runtimeCodeHashes[field] !== null
    ) {
      fail(`Undeployed Classic manifest contains a populated ${field}`);
    }
  }
  if (
    appRelease.classicV3Status !== "not-deployed" ||
    appRelease.ethCreatorFeeHookFactoryV3 !== null ||
    appRelease.ethCreatorFeeHookV3 !== null ||
    appRelease.feeSplitVaultFactoryV1 !== null ||
    appRelease.memeLaunchV2 !== null ||
    appRelease.runtimeCodeHashes.ethCreatorFeeHookFactoryV3 !== null ||
    appRelease.runtimeCodeHashes.ethCreatorFeeHookV3 !== null ||
    appRelease.runtimeCodeHashes.feeSplitVaultFactoryV1 !== null ||
    appRelease.runtimeCodeHashes.memeLaunchV2 !== null ||
    appRelease.deploymentBlocks.ethCreatorFeeHookFactoryV3 !== null ||
    appRelease.deploymentBlocks.ethCreatorFeeHookV3 !== null ||
    appRelease.deploymentBlocks.feeSplitVaultFactoryV1 !== null ||
    appRelease.deploymentBlocks.memeLaunchV2 !== null
  ) {
    fail("Application manifest disagrees with the disabled Classic release");
  }
}

async function verifyLiveRelease(release, appRelease, clients) {
  if (release.status !== "deployment-source-and-lifecycle-verified") {
    fail(`Unsupported live Classic release status: ${release.status}`);
  }
  if (
    !/^[a-f0-9]{40}$/.test(release.releaseCommit ?? "") ||
    !Number.isSafeInteger(release.startingNonce) ||
    release.startingNonce < 0 ||
    !validHash(release.hookSalt) ||
    release.sourceVerification?.status !== "verified" ||
    release.lifecycleEvidence?.status !== "verified-current-release" ||
    release.lifecycleEvidence?.releaseEligible !== true
  ) {
    fail("Live Classic release lacks commit, deterministic plan, source verification or lifecycle evidence");
  }

  const mapping = {
    feeSplitVaultFactory: "feeSplitVaultFactoryV1",
    hookFactory: "ethCreatorFeeHookFactoryV3",
    feeHook: "ethCreatorFeeHookV3",
    launcher: "memeLaunchV2",
  };
  for (const [releaseField, appField] of Object.entries(mapping)) {
    const address = release.addresses[releaseField];
    const expectedHash = release.runtimeCodeHashes[releaseField];
    if (!isAddress(address) || !validHash(expectedHash)) {
      fail(`Live Classic manifest is missing ${releaseField}`);
    }
    if (
      !sameAddress(address, appRelease[appField]) ||
      expectedHash !== appRelease.runtimeCodeHashes[appField]
    ) {
      fail(`Application Classic ${releaseField} differs from the release manifest`);
    }
    const codes = await Promise.all(clients.map((client) => client.getCode({ address })));
    for (const code of codes) {
      if (!code || keccak256(code) !== expectedHash) {
        fail(`Deployed Classic ${releaseField} runtime does not match`);
      }
    }
  }
  if (appRelease.classicV3Status !== "ready") {
    fail("Application Classic release is not ready");
  }

  const primary = clients[0];
  const hook = getAddress(release.addresses.feeHook);
  const launcher = getAddress(release.addresses.launcher);
  const hookFactory = getAddress(release.addresses.hookFactory);
  const vaultFactory = getAddress(release.addresses.feeSplitVaultFactory);
  const dependencies = release.officialDependencies;
  const values = await Promise.all([
    primary.readContract({ address: hook, abi: hookAbi, functionName: "poolManager" }),
    primary.readContract({ address: hook, abi: hookAbi, functionName: "launcherFeeRecipient" }),
    primary.readContract({ address: hook, abi: hookAbi, functionName: "feeSplitVaultFactory" }),
    primary.readContract({ address: hook, abi: hookAbi, functionName: "LAUNCHER_FEE_BPS" }),
    primary.readContract({ address: hook, abi: hookAbi, functionName: "MIN_TOTAL_SWAP_FEE_BPS" }),
    primary.readContract({ address: hook, abi: hookAbi, functionName: "MAX_TOTAL_SWAP_FEE_BPS" }),
    primary.readContract({ address: hook, abi: hookAbi, functionName: "TOTAL_SWAP_FEE_STEP_BPS" }),
    primary.readContract({ address: hook, abi: hookAbi, functionName: "TRANSFER_TAX_BPS" }),
    primary.readContract({ address: hook, abi: hookAbi, functionName: "LP_FEE_PIPS" }),
    primary.readContract({ address: hook, abi: hookAbi, functionName: "TICK_SPACING" }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "poolManager" }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "positionManager" }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "tokenFactory" }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "feeHook" }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "feeSplitVaultFactory" }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "positionForwarderFactory" }),
    primary.readContract({ address: launcher, abi: launcherAbi, functionName: "MIN_INITIAL_BUY_WEI" }),
    primary.readContract({
      address: hookFactory,
      abi: hookFactoryAbi,
      functionName: "isFactoryHook",
      args: [hook],
    }),
    primary.readContract({
      address: getAddress(release.addresses.positionForwarderFactory),
      abi: positionFactoryAbi,
      functionName: "positionManager",
    }),
  ]);
  const expected = [
    [values[0], dependencies.poolManager.address, "hook PoolManager"],
    [values[1], expectedTreasury, "treasury"],
    [values[2], vaultFactory, "hook reward factory"],
    [values[10], dependencies.poolManager.address, "launcher PoolManager"],
    [values[11], dependencies.positionManager.address, "launcher PositionManager"],
    [values[12], dependencies.uerc20Factory.address, "launcher UERC20Factory"],
    [values[13], hook, "launcher hook"],
    [values[14], vaultFactory, "launcher reward factory"],
    [values[15], release.addresses.positionForwarderFactory, "launcher position factory"],
    [values[18], dependencies.positionManager.address, "position factory PositionManager"],
  ];
  for (const [actual, wanted, label] of expected) {
    if (!sameAddress(actual, wanted)) fail(`Classic ${label} mismatch`);
  }
  if (
    values[3] !== 10 ||
    values[4] !== 100 ||
    values[5] !== 1_000 ||
    values[6] !== 100 ||
    values[7] !== 0 ||
    values[8] !== 0 ||
    values[9] !== 200 ||
    values[16] !== 600_000_000_000_000n ||
    values[17] !== true ||
    (BigInt(hook) & hookMask) !== requiredHookFlags
  ) {
    fail("Classic immutable economics or provenance mismatch");
  }
}

const selectedNetworks =
  requestedNetwork === "all"
    ? Object.keys(networkDefinitions)
    : [requestedNetwork];
for (const name of selectedNetworks) {
  const definition = networkDefinitions[name];
  if (!definition) fail(`Unsupported network ${name}`);
}

const appManifest = await readJson(appManifestPath);
const feeHookArtifact = await readJson(artifactPaths.feeHookTemplate);
const feeHookCreationCode = feeHookArtifact.bytecode?.object;
if (!feeHookCreationCode || feeHookCreationCode === "0x") {
  fail("Classic hook creation bytecode is missing; run forge build first");
}

for (const name of selectedNetworks) {
  const definition = networkDefinitions[name];
  const release = await readJson(definition.releasePath);
  if (
    release.schemaVersion !== 1 ||
    release.model !== "classic" ||
    release.internalContractRelease !== "classic-v3" ||
    release.chainId !== definition.chain.id
  ) {
    fail(`${name} Classic release identity is invalid`);
  }
  if (!sameAddress(release.addresses.treasury, expectedTreasury)) {
    fail(`${name} Classic treasury mismatch`);
  }

  const clients = unique(definition.rpcUrls)
    .slice(0, 2)
    .map((rpcUrl) =>
      createPublicClient({
        chain: definition.chain,
        transport: http(rpcUrl, { retryCount: 1, timeout: 15_000 }),
      }),
    );
  if (clients.length < 2) fail(`${name} requires two independent RPCs`);

  await verifyArtifacts(release);
  verifyCandidatePlan(release, feeHookCreationCode);
  await verifyDependencies(release, clients);

  const appRelease = appManifest[definition.environment];
  if (release.status === "not-deployed") {
    assertDisabled(release, appRelease);
    if (requireLive) fail(`${name} Classic configurable release is not deployed`);
    const currentNonce = await clients[0].getTransactionCount({
      address: getAddress(release.candidatePlan.deployer),
    });
    const freshness =
      currentNonce === release.candidatePlan.startingNonce
        ? "candidate nonce is current"
        : `candidate nonce is stale (${release.candidatePlan.startingNonce}/${currentNonce})`;
    console.log(
      `${name}: artifacts, deterministic plan and two-RPC dependency hashes match; deployment disabled; ${freshness}.`,
    );
    continue;
  }

  await verifyLiveRelease(release, appRelease, clients);
  console.log(`${name}: live Classic release, app manifest and two-RPC runtime evidence match.`);
}
