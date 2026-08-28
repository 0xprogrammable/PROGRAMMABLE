#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { getContractAddress, keccak256 } from "viem";

import {
  CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES,
  CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
  CLASSIC_V4_LAUNCHER_UPGRADE_MAX_GAS_LIMIT,
  CLASSIC_V4_LAUNCHER_UPGRADE_MIN_GAS_LIMIT,
  CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER,
  buildClassicV4LauncherUpgradePlan,
  classicV4LauncherUpgradeDependencyBindingChecks,
  classicV4LauncherUpgradeTransactionData,
  computeClassicV4LauncherUpgradeBuildCommitments,
  loadClassicV4LauncherUpgradeArtifact,
  validateClassicV4LauncherUpgradePlan,
} from "../../scripts/classic-v4-launcher-upgrade-core.mjs";
import {
  CLASSIC_V4_DIGEST_DOMAINS,
  canonicalAddress,
  digestJson,
  normalizeHex,
  normalizeRuntimeImmutables,
} from "../../scripts/classic-v4-release-core.mjs";
import {
  assertCleanClassicV4FoundryEnvironment,
  verifyClassicV4SourcePins,
} from "./prepare-classic-v4-mainnet-release.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const contractsRoot = path.join(repositoryRoot, "contracts");
const sourcePinsPath = path.join(contractsRoot, "dependencies/source-pins.json");
const DEFAULT_RPC_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
];
const REQUEST_TIMEOUT_MS = 15_000;
const ALL_PINNED_DEPENDENCY_ROOTS = Object.freeze([
  "blocknumberish",
  "continuous-clearing-auction",
  "forge-std",
  "liquidity-launcher",
  "openzeppelin-contracts",
  "openzeppelin-uniswap-hooks",
  "permit2",
  "solady",
  "solmate",
  "uerc20-factory",
  "v4-core",
  "v4-periphery",
]);

function fail(message) {
  throw new Error(message);
}

function quantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function controlledBuildEnvironment(environment) {
  const controlled = {};
  for (const key of ["PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL"]) {
    if (typeof environment[key] === "string") controlled[key] = environment[key];
  }
  controlled.NO_COLOR = "1";
  return controlled;
}

export async function compileClassicV4LauncherUpgradeFreshArtifact({
  environment = process.env,
  execute = execFileAsync,
  createTemporaryDirectory = mkdtemp,
  removeTemporaryDirectory = rm,
  artifactLoader = loadClassicV4LauncherUpgradeArtifact,
  contractsDirectory = contractsRoot,
  temporaryParent = tmpdir(),
} = {}) {
  assertCleanClassicV4FoundryEnvironment(environment);
  const temporaryRoot = await createTemporaryDirectory(
    path.join(temporaryParent, "classic-v4-launcher-upgrade-build-"),
  );
  const outputDirectory = path.join(temporaryRoot, "out");
  const cacheDirectory = path.join(temporaryRoot, "cache");
  try {
    await execute(
      "forge",
      [
        "build",
        "--force",
        "--offline",
        "--no-auto-detect",
        "--use",
        "0.8.26",
        "--evm-version",
        "cancun",
        "--optimize",
        "true",
        "--optimizer-runs",
        "1000",
        "--no-metadata",
        "--root",
        contractsDirectory,
        "--config-path",
        path.join(contractsDirectory, "foundry.toml"),
        "--out",
        outputDirectory,
        "--cache-path",
        cacheDirectory,
        "src/MemeLaunchV4.sol",
      ],
      {
        cwd: contractsDirectory,
        env: controlledBuildEnvironment(environment),
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return await artifactLoader(outputDirectory);
  } finally {
    await removeTemporaryDirectory(temporaryRoot, {
      recursive: true,
      force: true,
    });
  }
}

export function assertClassicV4LauncherUpgradeRpcEndpoints(endpoints) {
  if (!Array.isArray(endpoints) || endpoints.length !== 2) {
    fail("Exactly two independent Mainnet RPC endpoints are required");
  }
  const hostnames = new Set();
  for (const endpoint of endpoints) {
    let parsed;
    try {
      parsed = new URL(endpoint);
    } catch {
      fail("RPC endpoints must be valid URLs");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      fail("RPC endpoints must be credential-free HTTPS URLs");
    }
    hostnames.add(parsed.hostname.toLowerCase());
  }
  if (hostnames.size !== 2) {
    fail("Two independent Mainnet RPC hostnames are required");
  }
}

export async function classicV4LauncherUpgradeRpc(
  endpoint,
  method,
  params = [],
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) fail(`RPC ${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) fail(`RPC ${method} failed: ${payload.error.message}`);
  if (payload?.result === undefined) fail(`RPC ${method} returned no result`);
  return payload.result;
}

async function gitIdentity(execute = execFileAsync) {
  const [topLevel, head, tree, statusOutput] = await Promise.all([
    execute("git", ["rev-parse", "--show-toplevel"], { cwd: repositoryRoot }),
    execute("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }),
    execute("git", ["rev-parse", "HEAD^{tree}"], { cwd: repositoryRoot }),
    execute("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: repositoryRoot,
    }),
  ]);
  return {
    repositoryTopLevel: topLevel.stdout.trim(),
    releaseCommit: head.stdout.trim().toLowerCase(),
    releaseTree: tree.stdout.trim().toLowerCase(),
    repositoryClean: statusOutput.stdout.trim() === "",
  };
}

function assertExactIdentity(identity, expected = null) {
  if (
    identity?.repositoryTopLevel !== repositoryRoot ||
    identity?.repositoryClean !== true ||
    (expected &&
      (identity.releaseCommit !== expected.releaseCommit ||
        identity.releaseTree !== expected.releaseTree))
  ) {
    fail("Current clean Git identity differs from the launcher upgrade release");
  }
}

async function dependencyGitState(root, execute = execFileAsync) {
  const directory = path.join(contractsRoot, "lib", root);
  try {
    const [topLevel, head, statusOutput, remoteUrl] = await Promise.all([
      execute("git", ["rev-parse", "--show-toplevel"], { cwd: directory }),
      execute("git", ["rev-parse", "HEAD"], { cwd: directory }),
      execute("git", ["status", "--porcelain", "--untracked-files=all"], {
        cwd: directory,
      }),
      execute("git", ["remote", "get-url", "origin"], { cwd: directory }),
    ]);
    return {
      topLevel: topLevel.stdout.trim(),
      head: head.stdout.trim().toLowerCase(),
      clean: statusOutput.stdout.trim() === "",
      remoteUrl: remoteUrl.stdout.trim(),
    };
  } catch {
    fail(`Pinned dependency ${root} is not a readable Git checkout`);
  }
}

async function sourcePinState(roots, execute = execFileAsync) {
  const [sourcePins, entries, states] = await Promise.all([
    readFile(sourcePinsPath, "utf8").then(JSON.parse),
    readdir(path.join(contractsRoot, "lib"), { withFileTypes: true }),
    Promise.all(
      roots.map(async (root) => [root, await dependencyGitState(root, execute)]),
    ),
  ]);
  const localDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const dependencyGitStates = Object.fromEntries(states);
  return {
    sourcePins,
    localDirectories,
    dependencyGitStates,
    digest: verifyClassicV4SourcePins({
      sourcePins,
      localDirectories,
      dependencyRoots: roots,
      dependencyGitStates,
    }),
  };
}

function dependencyEntries() {
  return [
    ...Object.entries(CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES),
    ["launchStampRouter", CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER],
  ];
}

async function readEndpointHead(endpoint, deployer, rpcClient) {
  const [chainId, latest, latestNonce, pendingNonce, balance, gasPrice] =
    await Promise.all([
      rpcClient(endpoint, "eth_chainId"),
      rpcClient(endpoint, "eth_getBlockByNumber", ["latest", false]),
      rpcClient(endpoint, "eth_getTransactionCount", [deployer, "latest"]),
      rpcClient(endpoint, "eth_getTransactionCount", [deployer, "pending"]),
      rpcClient(endpoint, "eth_getBalance", [deployer, "latest"]),
      rpcClient(endpoint, "eth_gasPrice"),
    ]);
  if (normalizeHex(chainId) !== "0x1") fail("RPC is not Ethereum Mainnet");
  if (!latest?.number || !latest?.hash) fail("RPC Mainnet head is incomplete");
  return {
    headNumber: Number(BigInt(latest.number)),
    headHash: latest.hash.toLowerCase(),
    latestNonce: Number(BigInt(latestNonce)),
    pendingNonce: Number(BigInt(pendingNonce)),
    balance: BigInt(balance),
    gasPrice: BigInt(gasPrice),
  };
}

async function verifyEndpointAtBlock({
  endpoint,
  blockNumber,
  blockHash,
  deployer,
  startingNonce,
  predictedAddress,
  transactionData,
  artifact,
  rpcClient,
}) {
  const blockTag = quantity(blockNumber);
  const [block, blockNonce, codes, calls, vacancy, simulation] =
    await Promise.all([
      rpcClient(endpoint, "eth_getBlockByNumber", [blockTag, false]),
      rpcClient(endpoint, "eth_getTransactionCount", [deployer, blockTag]),
      Promise.all(
        dependencyEntries().map(async ([name, expected]) => {
          const code = await rpcClient(endpoint, "eth_getCode", [
            expected.address,
            blockTag,
          ]);
          if (
            code === "0x" ||
            normalizeHex(keccak256(code)) !== normalizeHex(expected.runtimeCodeHash)
          ) {
            fail(`${name} runtime code hash drifted at the shared block`);
          }
          return [name, keccak256(code)];
        }),
      ),
      Promise.all(
        classicV4LauncherUpgradeDependencyBindingChecks().map(async (check) => {
          const actual = await rpcClient(endpoint, "eth_call", [
            { to: check.target, data: check.data },
            blockTag,
          ]);
          if (normalizeHex(actual) !== normalizeHex(check.expected)) {
            fail(`${check.label} drifted at the shared block`);
          }
          return check.label;
        }),
      ),
      rpcClient(endpoint, "eth_getCode", [predictedAddress, blockTag]),
      rpcClient(endpoint, "eth_call", [
        {
          from: deployer,
          nonce: quantity(startingNonce),
          value: "0x0",
          data: transactionData,
        },
        blockTag,
      ]),
    ]);
  if (
    !block?.number ||
    !block?.hash ||
    Number(BigInt(block.number)) !== blockNumber ||
    normalizeHex(block.hash) !== normalizeHex(blockHash)
  ) {
    fail("RPC shared block binding differs");
  }
  if (Number(BigInt(blockNonce)) !== startingNonce) {
    fail("Deployer nonce differs at the shared block");
  }
  if (vacancy !== "0x") fail("Predicted launcher address is occupied");
  const simulatedTemplateHash = keccak256(
    normalizeRuntimeImmutables(simulation, artifact),
  );
  const expectedTemplateHash =
    computeClassicV4LauncherUpgradeBuildCommitments(artifact).artifact
      .runtimeTemplateHash;
  if (normalizeHex(simulatedTemplateHash) !== normalizeHex(expectedTemplateHash)) {
    fail("Constructor simulation runtime differs from the reviewed artifact");
  }
  return {
    blockHash: block.hash.toLowerCase(),
    dependencyRuntimeDigest: digestJson(
      Object.fromEntries(codes),
      CLASSIC_V4_DIGEST_DOMAINS.deploymentRpcSnapshot,
    ),
    dependencyBindingDigest: digestJson(
      calls,
      CLASSIC_V4_DIGEST_DOMAINS.deploymentRpcSnapshot,
    ),
    simulatedRuntimeTemplateHash: simulatedTemplateHash,
  };
}

export async function prepareClassicV4LauncherUpgradeSnapshot({
  endpoints,
  artifact,
  rpcClient = classicV4LauncherUpgradeRpc,
}) {
  assertClassicV4LauncherUpgradeRpcEndpoints(endpoints);
  const deployer = canonicalAddress(CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER);
  const heads = await Promise.all(
    endpoints.map((endpoint) => readEndpointHead(endpoint, deployer, rpcClient)),
  );
  const [left, right] = heads;
  if (
    left.latestNonce !== right.latestNonce ||
    left.pendingNonce !== right.pendingNonce ||
    left.latestNonce !== left.pendingNonce
  ) {
    fail("RPCs disagree on nonce or the dev wallet has a pending transaction");
  }
  if (Math.abs(left.headNumber - right.headNumber) > 4) {
    fail("Mainnet RPC heads differ by more than four blocks");
  }
  const startingNonce = left.pendingNonce;
  const observedAtBlock = Math.min(left.headNumber, right.headNumber);
  const observedBlocks = await Promise.all(
    endpoints.map((endpoint) =>
      rpcClient(endpoint, "eth_getBlockByNumber", [
        quantity(observedAtBlock),
        false,
      ]),
    ),
  );
  if (
    observedBlocks.some(
      (block) =>
        !block?.hash || Number(BigInt(block.number)) !== observedAtBlock,
    ) ||
    normalizeHex(observedBlocks[0].hash) !== normalizeHex(observedBlocks[1].hash)
  ) {
    fail("Mainnet RPCs disagree on the shared observed block");
  }
  const observedAtBlockHash = observedBlocks[0].hash.toLowerCase();
  const predictedAddress = getContractAddress({
    from: deployer,
    nonce: BigInt(startingNonce),
    opcode: "CREATE",
  });
  const transactionData = classicV4LauncherUpgradeTransactionData(artifact);
  const fixedSnapshots = await Promise.all(
    endpoints.map((endpoint) =>
      verifyEndpointAtBlock({
        endpoint,
        blockNumber: observedAtBlock,
        blockHash: observedAtBlockHash,
        deployer,
        startingNonce,
        predictedAddress,
        transactionData,
        artifact,
        rpcClient,
      }),
    ),
  );
  if (
    digestJson(
      fixedSnapshots[0],
      CLASSIC_V4_DIGEST_DOMAINS.deploymentRpcSnapshot,
    ) !==
    digestJson(
      fixedSnapshots[1],
      CLASSIC_V4_DIGEST_DOMAINS.deploymentRpcSnapshot,
    )
  ) {
    fail("Independent RPCs disagree on the fixed launcher snapshot");
  }
  const liveChecks = await Promise.all(
    endpoints.map(async (endpoint) => {
      const [latestCode, estimate] = await Promise.all([
        rpcClient(endpoint, "eth_getCode", [predictedAddress, "latest"]),
        rpcClient(endpoint, "eth_estimateGas", [
          {
            from: deployer,
            nonce: quantity(startingNonce),
            value: "0x0",
            data: transactionData,
          },
          "pending",
        ]),
      ]);
      if (latestCode !== "0x") fail("Predicted launcher address is occupied");
      return BigInt(estimate);
    }),
  );
  const estimatedGas = liveChecks.reduce(
    (maximum, value) => (value > maximum ? value : maximum),
    0n,
  );
  let reviewedGasLimit = (estimatedGas * 120n + 99n) / 100n + 50_000n;
  if (reviewedGasLimit < CLASSIC_V4_LAUNCHER_UPGRADE_MIN_GAS_LIMIT) {
    reviewedGasLimit = CLASSIC_V4_LAUNCHER_UPGRADE_MIN_GAS_LIMIT;
  }
  if (reviewedGasLimit > CLASSIC_V4_LAUNCHER_UPGRADE_MAX_GAS_LIMIT) {
    fail("Launcher deployment exceeds the reviewed gas envelope");
  }
  const gasPrice = heads.reduce(
    (maximum, state) => (state.gasPrice > maximum ? state.gasPrice : maximum),
    0n,
  );
  const balance = heads.reduce(
    (minimum, state) => (state.balance < minimum ? state.balance : minimum),
    heads[0].balance,
  );
  const requiredBalance = reviewedGasLimit * gasPrice;
  if (balance < requiredBalance) {
    fail("Dev wallet balance is below the reviewed launcher gas envelope");
  }
  return {
    startingNonce,
    observedAtBlock,
    observedAtBlockHash,
    predictedAddress,
    snapshot: {
      independentRpcCount: 2,
      freshDeterministicBuild: true,
      sourcePinsVerified: true,
      dependencyRuntimeVerified: true,
      dependencyBindingsVerified: true,
      canonicalRouterVerified: true,
      constructorSimulationVerified: true,
      predictedAddressVacant: true,
      deployerNonceReconciled: true,
      deployerBalanceVerified: true,
      estimatedGas: estimatedGas.toString(),
      reviewedGasLimit: reviewedGasLimit.toString(),
      gasPriceWei: gasPrice.toString(),
      deployerBalanceWei: balance.toString(),
      requiredBalanceWei: requiredBalance.toString(),
    },
  };
}

async function freshBuildAndPins({
  identityReader = gitIdentity,
  artifactBuilder = compileClassicV4LauncherUpgradeFreshArtifact,
  sourcePinReader = sourcePinState,
} = {}) {
  const beforeIdentity = await identityReader();
  assertExactIdentity(beforeIdentity);
  const beforePins = await sourcePinReader(ALL_PINNED_DEPENDENCY_ROOTS);
  const artifact = await artifactBuilder();
  const build = computeClassicV4LauncherUpgradeBuildCommitments(artifact);
  const [afterIdentity, afterPins] = await Promise.all([
    identityReader(),
    sourcePinReader(ALL_PINNED_DEPENDENCY_ROOTS),
  ]);
  assertExactIdentity(afterIdentity, beforeIdentity);
  if (normalizeHex(beforePins.digest) !== normalizeHex(afterPins.digest)) {
    fail("Source pins changed during the deterministic launcher build");
  }
  for (const root of build.dependencyRoots) {
    if (!ALL_PINNED_DEPENDENCY_ROOTS.includes(root)) {
      fail(`Unpinned launcher dependency root ${root}`);
    }
  }
  return {
    identity: afterIdentity,
    artifact,
    sourcePinsDigest: afterPins.digest,
  };
}

export async function loadClassicV4LauncherUpgradeSealedBuild(
  plan,
  dependencies = {},
) {
  const sealed = await freshBuildAndPins(dependencies);
  if (
    sealed.identity.releaseCommit !== plan?.releaseCommit ||
    sealed.identity.releaseTree !== plan?.releaseTree
  ) {
    fail("Current Git identity differs from the reviewed launcher plan");
  }
  if (
    normalizeHex(sealed.sourcePinsDigest) !== normalizeHex(plan?.sourcePinsDigest)
  ) {
    fail("Current source pins differ from the reviewed launcher plan");
  }
  validateClassicV4LauncherUpgradePlan(plan, sealed.artifact);
  return sealed.artifact;
}

function parseArguments(argv) {
  const forbidden = argv.find(
    (argument) =>
      argument === "--broadcast" ||
      argument === "--private-key" ||
      argument.startsWith("--private-key=") ||
      argument === "--mnemonic" ||
      argument.startsWith("--mnemonic="),
  );
  if (forbidden) {
    fail(`${forbidden.split("=", 1)[0]} is forbidden; this tool never signs or broadcasts`);
  }
  const options = {
    rpcA: process.env.CLASSIC_V4_LAUNCHER_UPGRADE_RPC_A ?? DEFAULT_RPC_ENDPOINTS[0],
    rpcB: process.env.CLASSIC_V4_LAUNCHER_UPGRADE_RPC_B ?? DEFAULT_RPC_ENDPOINTS[1],
    write: false,
    output: null,
    wallet: null,
    acknowledgement: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") {
      options.write = true;
      continue;
    }
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument : argument.slice(0, separator);
    const inline = separator === -1 ? null : argument.slice(separator + 1);
    if (
      ![
        "--rpc-a",
        "--rpc-b",
        "--output",
        "--wallet",
        "--acknowledge-release-source-digest",
      ].includes(key)
    ) {
      fail(`Unknown argument: ${key}`);
    }
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    if (key === "--rpc-a") options.rpcA = value;
    if (key === "--rpc-b") options.rpcB = value;
    if (key === "--output") options.output = value;
    if (key === "--wallet") options.wallet = value;
    if (key === "--acknowledge-release-source-digest") {
      options.acknowledgement = value;
    }
  }
  return options;
}

export function assertClassicV4LauncherUpgradePlanWriteAcknowledgement(
  plan,
  { wallet, acknowledgement },
) {
  if (
    !wallet ||
    canonicalAddress(wallet, "wallet") !==
      canonicalAddress(CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER)
  ) {
    fail("--write requires the explicit dev wallet");
  }
  if (
    normalizeHex(acknowledgement) !== normalizeHex(plan.releaseSourceDigest)
  ) {
    fail(
      "--write requires --acknowledge-release-source-digest from a reviewed check run",
    );
  }
}

async function writeAcknowledgedPlan(plan, options) {
  if (!options.output || !path.isAbsolute(options.output)) {
    fail("--write requires an absolute --output path");
  }
  assertClassicV4LauncherUpgradePlanWriteAcknowledgement(plan, options);
  const output = path.resolve(options.output);
  const relative = path.relative(repositoryRoot, output);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    fail("The launcher plan must be written outside the source repository");
  }
  const parent = path.dirname(output);
  const [realParent, parentStats] = await Promise.all([
    realpath(parent),
    stat(parent),
  ]);
  if (!parentStats.isDirectory() || realParent !== parent) {
    fail("The output parent must be an existing real directory");
  }
  await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const endpoints = [options.rpcA, options.rpcB];
  assertClassicV4LauncherUpgradeRpcEndpoints(endpoints);
  const sealed = await freshBuildAndPins();
  const live = await prepareClassicV4LauncherUpgradeSnapshot({
    endpoints,
    artifact: sealed.artifact,
  });
  const plan = buildClassicV4LauncherUpgradePlan({
    artifact: sealed.artifact,
    releaseCommit: sealed.identity.releaseCommit,
    releaseTree: sealed.identity.releaseTree,
    repositoryClean: sealed.identity.repositoryClean,
    startingNonce: live.startingNonce,
    observedAtBlock: live.observedAtBlock,
    observedAtBlockHash: live.observedAtBlockHash,
    sourcePinsDigest: sealed.sourcePinsDigest,
    snapshot: live.snapshot,
  });
  const finalIdentity = await gitIdentity();
  assertExactIdentity(finalIdentity, sealed.identity);
  validateClassicV4LauncherUpgradePlan(plan, sealed.artifact);
  if (options.write) await writeAcknowledgedPlan(plan, options);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `Classic V4 launcher upgrade preparation failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
