#!/usr/bin/env node

import {
  createPublicClient,
  decodeEventLog,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
} from "viem";
import { mainnet } from "viem/chains";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_RPCS = ["https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"];
const CONFIRMATIONS = Number(process.env.MEME_MONITOR_CONFIRMATIONS ?? 12);
const POLL_INTERVAL_MS = Number(
  process.env.MEME_MONITOR_POLL_INTERVAL_MS ?? 12_000,
);
const MAX_BLOCK_RANGE = Number(process.env.MEME_MONITOR_MAX_BLOCK_RANGE ?? 500);
const REORG_LOOKBACK = Number(process.env.MEME_MONITOR_REORG_LOOKBACK ?? 64);
const ONCE =
  process.argv.includes("--once") || process.env.MEME_MONITOR_ONCE === "1";
const ZERO_HASH = `0x${"00".repeat(32)}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ALL_HOOK_MASK = (1n << 14n) - 1n;
const REQUIRED_HOOK_FLAGS = 8396n;

const OFFICIAL = {
  poolManager: {
    address: getAddress("0x000000000004444c5dc75cB358380D2e3dE08A90"),
    runtimeCodeHash:
      "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
  },
  positionManager: {
    address: getAddress("0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e"),
    runtimeCodeHash:
      "0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b",
  },
  uerc20Factory: {
    address: getAddress("0x000000e200088D55C39a11F609E5F667729ad49b"),
    runtimeCodeHash:
      "0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb",
  },
  permit2: {
    address: getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3"),
    runtimeCodeHash:
      "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131",
  },
  universalRouter: {
    address: getAddress("0xd92A36B0000531EF3063dEd4De20A0783308446C"),
    runtimeCodeHash:
      "0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49",
  },
};
const TREASURY = getAddress("0x4957f49620AFf3Adbbe8195a4f633E49cc93376c");

const launcherAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function launchHashOf(address token) view returns (bytes32)",
  "event MemeTokenLaunched(address indexed creator,address indexed token,bytes32 indexed poolId,address feeHook,address positionRecipient,uint256 positionTokenId,uint16 totalSwapFeeBps,bytes32 launchHash)",
  "event MemeLiquidityConfigured(address indexed token,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
]);
const hookAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function totalNativeFeesAccrued() view returns (uint256)",
  "function launcherFeesAccrued() view returns (uint256)",
  "function poolFeeConfig(bytes32 poolId) view returns (address creator,address registrar,uint16 totalSwapFeeBps,bool registered,uint256 creatorFeesAccrued)",
  "function feeDisclosure(bytes32 poolId) view returns (uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 creatorFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips)",
  "event PoolRegistered(bytes32 indexed poolId,address indexed token,address indexed creator,address registrar,uint16 totalSwapFeeBps)",
  "event PoolFeeDisclosure(bytes32 indexed poolId,address indexed token,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips)",
  "event HookFee(bytes32 indexed poolId,address indexed sender,uint128 feeAmount0,uint128 feeAmount1)",
  "event HookSwap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint24 swapFee)",
  "event NativeSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,uint256 grossNativeAmount,uint256 creatorFee,uint256 launcherFee)",
  "event CreatorFeesClaimed(bytes32 indexed poolId,address indexed creator,address indexed recipient,address caller,uint256 amount)",
  "event LauncherFeesClaimed(address indexed treasury,address indexed recipient,address indexed caller,uint256 amount)",
]);
const hookFactoryAbi = parseAbi([
  "function configurationHashOf(address hook) view returns (bytes32)",
  "event EthCreatorFeeHookDeployed(address indexed hook,address indexed poolManager,address indexed launcherFeeRecipient,bytes32 salt,bytes32 configurationHash)",
]);
const forwarderFactoryAbi = parseAbi([
  "function positionManager() view returns (address)",
  "function configurationHashOf(address forwarder) view returns (bytes32)",
  "event LockedPositionFeeForwarderDeployed(address indexed forwarder,address indexed feeRecipient,bytes32 indexed salt,bytes32 configurationHash,address positionManager)",
]);
const forwarderAbi = parseAbi([
  "function positionManager() view returns (address)",
  "function operator() view returns (address)",
  "function timelockBlockNumber() view returns (uint256)",
  "function feeRecipient() view returns (address)",
]);
const positionManagerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
]);
const tokenAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function creator() view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const claimsAbi = parseAbi([
  "function balanceOf(address owner,uint256 id) view returns (uint256)",
]);

function stringify(value) {
  return JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
  );
}

function emit(type, severity, payload = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    type,
    severity,
    ...payload,
  };
  const line = `${stringify(record)}\n`;
  (severity === "critical" ? process.stderr : process.stdout).write(line);
}

function fail(message, context = {}) {
  emit("monitor_failure", "critical", { message, ...context });
  throw new Error(message);
}

function assert(condition, message, context = {}) {
  if (!condition) fail(message, context);
}

function sameHex(actual, expected, label) {
  assert(
    typeof actual === "string" &&
      actual.toLowerCase() === expected.toLowerCase(),
    `${label} mismatch`,
    { actual, expected },
  );
}

function requiredAddress(value, label) {
  try {
    return getAddress(value);
  } catch {
    fail(`${label} must be a valid address`);
  }
}

function requiredHash(value, label) {
  assert(
    typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value),
    `${label} must be 32 bytes`,
  );
  return value;
}

function help() {
  process.stdout.write(`Usage:
  MAINNET_RPC_URLS=https://rpc-a,https://rpc-b \\
  MAINNET_MEME_DEPLOYMENT_JSON=/absolute/deployment.json \\
  MEME_MONITOR_STATE_FILE=/var/lib/programmable/meme-v1.json \\
  node contracts/scripts/monitor-meme-v1.mjs [--once]

The watcher never signs or sends a transaction. It waits for a configurable
confirmation depth, compares logs and block hashes through two independent
RPCs, persists a canonical cursor, rewinds on a detected reorg, validates each
launch against current custody state, and exits non-zero on any critical
invariant failure. Structured JSON lines are written to stdout/stderr.
`);
}

async function loadDeployment(path) {
  const raw = JSON.parse(await readFile(resolve(path), "utf8"));
  assert(raw?.schemaVersion === 1, "Unsupported deployment schemaVersion");
  assert(raw?.chainId === 1, "Deployment chainId must be 1");
  assert(
    Number.isSafeInteger(raw.deploymentBlock) && raw.deploymentBlock > 0,
    "deploymentBlock must be a positive safe integer",
  );
  const addresses = Object.fromEntries(
    [
      "positionForwarderFactory",
      "hookFactory",
      "feeHook",
      "memeLauncher",
    ].map((key) => [
      key,
      requiredAddress(raw?.addresses?.[key], `addresses.${key}`),
    ]),
  );
  const runtimeCodeHashes = Object.fromEntries(
    [
      "positionForwarderFactory",
      "hookFactory",
      "feeHook",
      "memeLauncher",
    ].map((key) => [
      key,
      requiredHash(
        raw?.runtimeCodeHashes?.[key],
        `runtimeCodeHashes.${key}`,
      ),
    ]),
  );
  const deploymentId = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
      ],
      [
        addresses.positionForwarderFactory,
        addresses.hookFactory,
        addresses.feeHook,
        addresses.memeLauncher,
      ],
    ),
  );
  return {
    ...raw,
    addresses,
    runtimeCodeHashes,
    deploymentId,
  };
}

function createClients() {
  const endpoints = (process.env.MAINNET_RPC_URLS ?? DEFAULT_RPCS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  assert(endpoints.length >= 2, "At least two RPC URLs are required");
  assert(new Set(endpoints).size === endpoints.length, "RPC URLs must be distinct");
  return endpoints.slice(0, 2).map((endpoint) => ({
    endpoint,
    client: createPublicClient({
      chain: mainnet,
      transport: http(endpoint, { retryCount: 3, timeout: 15_000 }),
    }),
  }));
}

async function loadState(stateFile, deployment) {
  const initial = {
    schemaVersion: 1,
    chainId: 1,
    deploymentId: deployment.deploymentId,
    cursor: deployment.deploymentBlock - 1,
    cursorHash: null,
    checkpoints: [],
    launches: {},
  };
  if (!stateFile) return initial;
  try {
    const state = JSON.parse(await readFile(resolve(stateFile), "utf8"));
    assert(state.schemaVersion === 1, "Unsupported monitor state schema");
    assert(state.chainId === 1, "Monitor state chain mismatch");
    sameHex(state.deploymentId, deployment.deploymentId, "monitor deploymentId");
    assert(
      Number.isSafeInteger(state.cursor) &&
        state.cursor >= deployment.deploymentBlock - 1,
      "Monitor cursor is invalid",
    );
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return initial;
    throw error;
  }
}

async function persistState(stateFile, state) {
  if (!stateFile) return;
  const destination = resolve(stateFile);
  const temporary = `${destination}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, destination);
}

function normalizeBlock(block) {
  return {
    number: Number(block.number),
    hash: block.hash,
    parentHash: block.parentHash,
  };
}

async function agreedBlock(clients, blockNumber) {
  const blocks = await Promise.all(
    clients.map(({ client }) =>
      client.getBlock({ blockNumber: BigInt(blockNumber) }),
    ),
  );
  const normalized = blocks.map(normalizeBlock);
  assert(
    stringify(normalized[0]) === stringify(normalized[1]),
    "Independent RPCs disagree on block header",
    { blockNumber, providers: normalized },
  );
  return normalized[0];
}

async function initializeCursorHash(state, clients) {
  if (state.cursorHash) return;
  const header = await agreedBlock(clients, state.cursor);
  state.cursorHash = header.hash;
  state.checkpoints = [{ number: state.cursor, hash: header.hash }];
}

async function ensureCanonicalCursor(state, deployment, clients) {
  const header = await agreedBlock(clients, state.cursor);
  if (header.hash.toLowerCase() === state.cursorHash.toLowerCase()) return false;

  const previousCursor = state.cursor;
  const previousHash = state.cursorHash;
  const rewindTo = Math.max(
    deployment.deploymentBlock - 1,
    state.cursor - REORG_LOOKBACK,
  );
  const rewindHeader = await agreedBlock(clients, rewindTo);
  state.cursor = rewindTo;
  state.cursorHash = rewindHeader.hash;
  state.checkpoints = [{ number: rewindTo, hash: rewindHeader.hash }];
  state.launches = Object.fromEntries(
    Object.entries(state.launches).filter(
      ([, launch]) => launch.blockNumber <= rewindTo,
    ),
  );
  emit("reorg_detected", "critical", {
    previousCursor,
    previousHash,
    canonicalHash: header.hash,
    rewoundTo: rewindTo,
  });
  return true;
}

function normalizedLogs(logs) {
  return logs
    .map((log) => ({
      address: log.address,
      blockNumber: Number(log.blockNumber),
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      transactionIndex: log.transactionIndex,
      logIndex: log.logIndex,
      data: log.data,
      topics: log.topics,
    }))
    .sort(
      (left, right) =>
        left.blockNumber - right.blockNumber ||
        left.transactionIndex - right.transactionIndex ||
        left.logIndex - right.logIndex,
    );
}

async function agreedLogs(clients, addresses, fromBlock, toBlock) {
  const sets = await Promise.all(
    clients.map(({ client }) =>
      client.getLogs({
        address: addresses,
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(toBlock),
      }),
    ),
  );
  const normalized = sets.map(normalizedLogs);
  assert(
    stringify(normalized[0]) === stringify(normalized[1]),
    "Independent RPCs disagree on confirmed logs",
    {
      fromBlock,
      toBlock,
      primaryCount: normalized[0].length,
      secondaryCount: normalized[1].length,
    },
  );
  return normalized[0];
}

function decodeLog(log, deployment) {
  const address = log.address.toLowerCase();
  const candidates =
    address === deployment.addresses.memeLauncher.toLowerCase()
      ? launcherAbi
      : address === deployment.addresses.feeHook.toLowerCase()
        ? hookAbi
        : address === deployment.addresses.hookFactory.toLowerCase()
          ? hookFactoryAbi
          : address === deployment.addresses.positionForwarderFactory.toLowerCase()
            ? forwarderFactoryAbi
            : null;
  if (!candidates) return null;
  try {
    return {
      ...decodeEventLog({
        abi: candidates,
        data: log.data,
        topics: log.topics,
      }),
      address: log.address,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
    };
  } catch {
    return null;
  }
}

async function readLaunchState(client, deployment, launch, blockNumber) {
  const read = (address, abi, functionName, args = []) =>
    client.readContract({ address, abi, functionName, args, blockNumber });
  const [
    recordedLaunchHash,
    feeConfiguration,
    feeDisclosure,
    positionOwner,
    positionLiquidity,
    forwarderConfigurationHash,
    forwarderPositionManager,
    forwarderOperator,
    forwarderTimelock,
    forwarderFeeRecipient,
    totalSupply,
    tokenCreator,
    launcherTokenBalance,
    positionManagerTokenBalance,
    forwarderTokenBalance,
    hookTokenClaims,
  ] = await Promise.all([
    read(deployment.addresses.memeLauncher, launcherAbi, "launchHashOf", [
      launch.token,
    ]),
    read(deployment.addresses.feeHook, hookAbi, "poolFeeConfig", [
      launch.poolId,
    ]),
    read(deployment.addresses.feeHook, hookAbi, "feeDisclosure", [
      launch.poolId,
    ]),
    read(OFFICIAL.positionManager.address, positionManagerAbi, "ownerOf", [
      BigInt(launch.positionTokenId),
    ]),
    read(
      OFFICIAL.positionManager.address,
      positionManagerAbi,
      "getPositionLiquidity",
      [BigInt(launch.positionTokenId)],
    ),
    read(
      deployment.addresses.positionForwarderFactory,
      forwarderFactoryAbi,
      "configurationHashOf",
      [launch.positionRecipient],
    ),
    read(launch.positionRecipient, forwarderAbi, "positionManager"),
    read(launch.positionRecipient, forwarderAbi, "operator"),
    read(launch.positionRecipient, forwarderAbi, "timelockBlockNumber"),
    read(launch.positionRecipient, forwarderAbi, "feeRecipient"),
    read(launch.token, tokenAbi, "totalSupply"),
    read(launch.token, tokenAbi, "creator"),
    read(launch.token, tokenAbi, "balanceOf", [
      deployment.addresses.memeLauncher,
    ]),
    read(launch.token, tokenAbi, "balanceOf", [
      OFFICIAL.positionManager.address,
    ]),
    read(launch.token, tokenAbi, "balanceOf", [launch.positionRecipient]),
    read(OFFICIAL.poolManager.address, claimsAbi, "balanceOf", [
      deployment.addresses.feeHook,
      BigInt(launch.token),
    ]),
  ]);
  return {
    recordedLaunchHash,
    feeConfiguration,
    feeDisclosure,
    positionOwner,
    positionLiquidity,
    forwarderConfigurationHash,
    forwarderPositionManager,
    forwarderOperator,
    forwarderTimelock,
    forwarderFeeRecipient,
    totalSupply,
    tokenCreator,
    launcherTokenBalance,
    positionManagerTokenBalance,
    forwarderTokenBalance,
    hookTokenClaims,
  };
}

function validateLaunchState(deployment, launch, state) {
  sameHex(state.recordedLaunchHash, launch.launchHash, "launchHashOf");
  const [creator, registrar, feeBps, registered] = state.feeConfiguration;
  sameHex(creator, launch.creator, "pool fee creator");
  sameHex(registrar, deployment.addresses.memeLauncher, "pool registrar");
  assert(registered, "Pool is no longer registered");
  assert(
    feeBps === launch.totalSwapFeeBps,
    "Pool fee differs from launch event",
  );
  const [
    buySwapFeeBps,
    sellSwapFeeBps,
    creatorFeeBps,
    launcherFeeBps,
    transferTaxBps,
    lpFeePips,
  ] = state.feeDisclosure;
  assert(buySwapFeeBps === feeBps, "Buy hook fee disclosure mismatch");
  assert(sellSwapFeeBps === feeBps, "Sell hook fee disclosure mismatch");
  assert(
    creatorFeeBps + launcherFeeBps === feeBps,
    "Disclosed fee split does not reconcile",
  );
  assert(launcherFeeBps === 10, "Launcher fee disclosure changed");
  assert(transferTaxBps === 0, "Transfer tax disclosure changed");
  assert(lpFeePips === 0, "LP fee disclosure changed");
  sameHex(state.positionOwner, launch.positionRecipient, "position owner");
  assert(state.positionLiquidity > 0n, "Locked position has zero liquidity");
  assert(
    state.forwarderConfigurationHash !== ZERO_HASH,
    "Position recipient lacks factory provenance",
  );
  sameHex(
    state.forwarderPositionManager,
    OFFICIAL.positionManager.address,
    "forwarder positionManager",
  );
  sameHex(state.forwarderOperator, ZERO_ADDRESS, "forwarder operator");
  assert(
    state.forwarderTimelock === (1n << 256n) - 1n,
    "forwarder timelock changed",
  );
  sameHex(
    state.forwarderFeeRecipient,
    launch.creator,
    "forwarder fee recipient",
  );
  assert(
    state.totalSupply === 1_000_000_000n * 10n ** 18n,
    "Token total supply changed",
  );
  sameHex(
    state.tokenCreator,
    deployment.addresses.memeLauncher,
    "token creator contract",
  );
  assert(state.launcherTokenBalance === 0n, "Launcher retains launched tokens");
  assert(
    state.positionManagerTokenBalance === 0n,
    "PositionManager retains launched tokens",
  );
  assert(
    state.forwarderTokenBalance === BigInt(launch.lockedTokenDust),
    "Locked token dust changed",
  );
  assert(state.hookTokenClaims === 0n, "Fee hook accrued token claims");
}

async function verifyLaunch(deployment, clients, launch, blockNumber) {
  const states = await Promise.all(
    clients.map(({ client }) =>
      readLaunchState(client, deployment, launch, blockNumber),
    ),
  );
  assert(
    stringify(states[0]) === stringify(states[1]),
    "Independent RPCs disagree on launch custody",
    { token: launch.token },
  );
  validateLaunchState(deployment, launch, states[0]);
}

async function verifyGlobalState(client, deployment, blockNumber) {
  const runtimeEntries = [
    ...Object.entries(OFFICIAL),
    ...[
      "positionForwarderFactory",
      "hookFactory",
      "feeHook",
      "memeLauncher",
    ].map((key) => [
      `owned.${key}`,
      {
        address: deployment.addresses[key],
        runtimeCodeHash: deployment.runtimeCodeHashes[key],
      },
    ]),
  ];
  const runtimeHashes = Object.fromEntries(
    await Promise.all(
      runtimeEntries.map(async ([key, item]) => {
        const code = await client.getCode({
          address: item.address,
          blockNumber,
        });
        assert(code && code !== "0x", `${key} runtime code missing`);
        const runtimeCodeHash = keccak256(code);
        sameHex(runtimeCodeHash, item.runtimeCodeHash, `${key} runtime hash`);
        return [key, runtimeCodeHash];
      }),
    ),
  );

  const read = (address, abi, functionName, args = []) =>
    client.readContract({ address, abi, functionName, args, blockNumber });
  const [
    launcherPoolManager,
    launcherPositionManager,
    launcherTokenFactory,
    launcherHook,
    launcherForwarderFactory,
    hookPoolManager,
    hookTreasury,
    totalNativeFees,
    launcherFees,
    nativeClaims,
    hookEthBalance,
    factoryPositionManager,
    hookConfigurationHash,
  ] = await Promise.all([
    read(deployment.addresses.memeLauncher, launcherAbi, "poolManager"),
    read(deployment.addresses.memeLauncher, launcherAbi, "positionManager"),
    read(deployment.addresses.memeLauncher, launcherAbi, "tokenFactory"),
    read(deployment.addresses.memeLauncher, launcherAbi, "feeHook"),
    read(
      deployment.addresses.memeLauncher,
      launcherAbi,
      "positionForwarderFactory",
    ),
    read(deployment.addresses.feeHook, hookAbi, "poolManager"),
    read(deployment.addresses.feeHook, hookAbi, "launcherFeeRecipient"),
    read(deployment.addresses.feeHook, hookAbi, "totalNativeFeesAccrued"),
    read(deployment.addresses.feeHook, hookAbi, "launcherFeesAccrued"),
    read(OFFICIAL.poolManager.address, claimsAbi, "balanceOf", [
      deployment.addresses.feeHook,
      0n,
    ]),
    client.getBalance({
      address: deployment.addresses.feeHook,
      blockNumber,
    }),
    read(
      deployment.addresses.positionForwarderFactory,
      forwarderFactoryAbi,
      "positionManager",
    ),
    read(
      deployment.addresses.hookFactory,
      hookFactoryAbi,
      "configurationHashOf",
      [deployment.addresses.feeHook],
    ),
  ]);

  sameHex(
    launcherPoolManager,
    OFFICIAL.poolManager.address,
    "launcher PoolManager",
  );
  sameHex(
    launcherPositionManager,
    OFFICIAL.positionManager.address,
    "launcher PositionManager",
  );
  sameHex(
    launcherTokenFactory,
    OFFICIAL.uerc20Factory.address,
    "launcher UERC20Factory",
  );
  sameHex(launcherHook, deployment.addresses.feeHook, "launcher fee hook");
  sameHex(
    launcherForwarderFactory,
    deployment.addresses.positionForwarderFactory,
    "launcher forwarder factory",
  );
  sameHex(hookPoolManager, OFFICIAL.poolManager.address, "hook PoolManager");
  sameHex(hookTreasury, TREASURY, "hook treasury");
  sameHex(
    factoryPositionManager,
    OFFICIAL.positionManager.address,
    "factory PositionManager",
  );
  assert(hookConfigurationHash !== ZERO_HASH, "Hook factory provenance missing");
  assert(
    (BigInt(deployment.addresses.feeHook) & ALL_HOOK_MASK) ===
      REQUIRED_HOOK_FLAGS,
    "Hook permission bits changed",
  );
  assert(totalNativeFees === nativeClaims, "Native claim accounting mismatch");
  assert(launcherFees <= totalNativeFees, "Launcher fees exceed total fees");
  assert(hookEthBalance === 0n, "Hook holds raw ETH");

  return {
    runtimeHashes,
    launcherPoolManager,
    launcherPositionManager,
    launcherTokenFactory,
    launcherHook,
    launcherForwarderFactory,
    hookPoolManager,
    hookTreasury,
    totalNativeFees,
    launcherFees,
    nativeClaims,
    hookEthBalance,
    factoryPositionManager,
    hookConfigurationHash,
  };
}

async function agreedGlobalState(clients, deployment, blockNumber) {
  const states = await Promise.all(
    clients.map(({ client }) =>
      verifyGlobalState(client, deployment, blockNumber),
    ),
  );
  assert(
    stringify(states[0]) === stringify(states[1]),
    "Independent RPCs disagree on global contract state",
  );
  return states[0];
}

function validateLaunchEventSet(events, deployment) {
  const launches = events.filter(
    (event) => event.eventName === "MemeTokenLaunched",
  );
  return launches.map((event) => {
    const args = event.args;
    sameHex(args.feeHook, deployment.addresses.feeHook, "launch event fee hook");
    assert(
      args.totalSwapFeeBps >= 100 &&
        args.totalSwapFeeBps <= 1000 &&
        args.totalSwapFeeBps % 100 === 0,
      "Invalid launch fee in event",
    );
    const liquidity = events.find(
      (candidate) =>
        candidate.eventName === "MemeLiquidityConfigured" &&
        candidate.transactionHash === event.transactionHash &&
        candidate.args.token.toLowerCase() === args.token.toLowerCase() &&
        candidate.args.launchHash.toLowerCase() ===
          args.launchHash.toLowerCase(),
    );
    assert(liquidity, "Launch is missing MemeLiquidityConfigured");
    assert(
      liquidity.args.totalSupply ===
        liquidity.args.tokenLiquidityAmount + liquidity.args.lockedTokenDust,
      "Launch supply does not reconcile",
    );
    assert(
      liquidity.args.totalSupply === 1_000_000_000n * 10n ** 18n,
      "Launch supply changed",
    );
    assert(liquidity.args.lpFeePips === 0, "Launch LP fee changed");

    const registration = events.find(
      (candidate) =>
        candidate.eventName === "PoolRegistered" &&
        candidate.transactionHash === event.transactionHash &&
        candidate.args.poolId.toLowerCase() === args.poolId.toLowerCase(),
    );
    assert(registration, "Launch is missing PoolRegistered");
    sameHex(registration.args.token, args.token, "registered token");
    sameHex(registration.args.creator, args.creator, "registered creator");
    sameHex(
      registration.args.registrar,
      deployment.addresses.memeLauncher,
      "registered launcher",
    );
    assert(
      registration.args.totalSwapFeeBps === args.totalSwapFeeBps,
      "Registered fee differs from launch",
    );
    const disclosure = events.find(
      (candidate) =>
        candidate.eventName === "PoolFeeDisclosure" &&
        candidate.transactionHash === event.transactionHash &&
        candidate.args.poolId.toLowerCase() === args.poolId.toLowerCase(),
    );
    assert(disclosure, "Launch is missing PoolFeeDisclosure");
    sameHex(disclosure.args.token, args.token, "disclosed token");
    assert(
      disclosure.args.buySwapFeeBps === args.totalSwapFeeBps &&
        disclosure.args.sellSwapFeeBps === args.totalSwapFeeBps,
      "Disclosed buy or sell fee differs from launch",
    );
    assert(
      disclosure.args.launcherFeeBps === 10,
      "Disclosed Launcher fee changed",
    );
    assert(
      disclosure.args.transferTaxBps === 0,
      "Disclosed transfer tax changed",
    );
    assert(disclosure.args.lpFeePips === 0, "Disclosed LP fee changed");

    return {
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      creator: getAddress(args.creator),
      token: getAddress(args.token),
      poolId: args.poolId,
      positionRecipient: getAddress(args.positionRecipient),
      positionTokenId: args.positionTokenId.toString(),
      totalSwapFeeBps: args.totalSwapFeeBps,
      launchHash: args.launchHash,
      lockedTokenDust: liquidity.args.lockedTokenDust.toString(),
    };
  });
}

async function processEvents(logs, deployment, clients, state, blockNumber) {
  const events = logs
    .map((log) => decodeLog(log, deployment))
    .filter(Boolean);
  const launches = validateLaunchEventSet(events, deployment);
  for (const launch of launches) {
    await verifyLaunch(deployment, clients, launch, blockNumber);
    state.launches[launch.token.toLowerCase()] = launch;
    emit("meme_token_launched", "info", launch);
  }

  for (const event of events) {
    if (event.eventName === "NativeSwapFeesAccrued") {
      const totalFee = event.args.creatorFee + event.args.launcherFee;
      const hookFee = events.find(
        (candidate) =>
          candidate.eventName === "HookFee" &&
          candidate.transactionHash === event.transactionHash &&
          candidate.args.poolId.toLowerCase() ===
            event.args.poolId.toLowerCase() &&
          candidate.args.sender.toLowerCase() ===
            event.args.swapSender.toLowerCase(),
      );
      const hookSwap = events.find(
        (candidate) =>
          candidate.eventName === "HookSwap" &&
          candidate.transactionHash === event.transactionHash &&
          candidate.args.id.toLowerCase() ===
            event.args.poolId.toLowerCase() &&
          candidate.args.sender.toLowerCase() ===
            event.args.swapSender.toLowerCase(),
      );
      assert(hookFee, "Native fee accrual is missing HookFee");
      assert(hookSwap, "Native fee accrual is missing HookSwap");
      assert(
        hookFee.args.feeAmount0 === totalFee &&
          hookFee.args.feeAmount1 === 0n,
        "HookFee does not reconcile with native accrual",
      );
      assert(
        hookSwap.args.amount0 === -totalFee &&
          hookSwap.args.amount1 === 0n,
        "HookSwap delta does not reconcile with native accrual",
      );
      const trackedLaunch = Object.values(state.launches).find(
        (launch) =>
          launch.poolId.toLowerCase() === event.args.poolId.toLowerCase(),
      );
      assert(trackedLaunch, "Fee accrual belongs to an unknown launch pool");
      assert(
        hookSwap.args.swapFee === trackedLaunch.totalSwapFeeBps * 100,
        "HookSwap fee pips differ from launch disclosure",
      );
      emit("native_swap_fees_accrued", "info", {
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        poolId: event.args.poolId,
        swapSender: event.args.swapSender,
        grossNativeAmount: event.args.grossNativeAmount,
        creatorFee: event.args.creatorFee,
        launcherFee: event.args.launcherFee,
      });
    } else if (event.eventName === "HookFee") {
      emit("hook_fee", "info", {
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        poolId: event.args.poolId,
        sender: event.args.sender,
        feeAmount0: event.args.feeAmount0,
        feeAmount1: event.args.feeAmount1,
      });
    } else if (event.eventName === "HookSwap") {
      emit("hook_swap", "info", {
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        poolId: event.args.id,
        sender: event.args.sender,
        amount0: event.args.amount0,
        amount1: event.args.amount1,
        swapFee: event.args.swapFee,
      });
    } else if (event.eventName === "CreatorFeesClaimed") {
      emit("creator_fees_claimed", "info", {
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        poolId: event.args.poolId,
        creator: event.args.creator,
        recipient: event.args.recipient,
        caller: event.args.caller,
        amount: event.args.amount,
      });
    } else if (event.eventName === "LauncherFeesClaimed") {
      sameHex(event.args.treasury, TREASURY, "claim event treasury");
      emit("launcher_fees_claimed", "info", {
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        treasury: event.args.treasury,
        recipient: event.args.recipient,
        caller: event.args.caller,
        amount: event.args.amount,
      });
    } else if (event.eventName === "EthCreatorFeeHookDeployed") {
      sameHex(event.args.hook, deployment.addresses.feeHook, "deployed hook");
      sameHex(
        event.args.poolManager,
        OFFICIAL.poolManager.address,
        "deployed hook PoolManager",
      );
      sameHex(
        event.args.launcherFeeRecipient,
        TREASURY,
        "deployed hook treasury",
      );
      emit("fee_hook_deployed", "info", {
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        hook: event.args.hook,
        salt: event.args.salt,
        configurationHash: event.args.configurationHash,
      });
    }
  }
  return events.length;
}

async function cycle(deployment, clients, state, stateFile) {
  const heads = await Promise.all(
    clients.map(({ client }) => client.getBlockNumber()),
  );
  const safeHead =
    heads.reduce((minimum, head) => (head < minimum ? head : minimum)) -
    BigInt(CONFIRMATIONS);
  assert(safeHead >= 0n, "RPC head is below confirmation depth");

  await initializeCursorHash(state, clients);
  const rewound = await ensureCanonicalCursor(state, deployment, clients);
  if (rewound) await persistState(stateFile, state);

  let processedEvents = 0;
  while (BigInt(state.cursor) < safeHead) {
    const fromBlock = state.cursor + 1;
    const toBlock = Math.min(
      Number(safeHead),
      fromBlock + MAX_BLOCK_RANGE - 1,
    );
    const firstHeader = await agreedBlock(clients, fromBlock);
    sameHex(
      firstHeader.parentHash,
      state.cursorHash,
      "processed range parent hash",
    );
    const logs = await agreedLogs(
      clients,
      [
        deployment.addresses.positionForwarderFactory,
        deployment.addresses.hookFactory,
        deployment.addresses.feeHook,
        deployment.addresses.memeLauncher,
      ],
      fromBlock,
      toBlock,
    );
    processedEvents += await processEvents(
      logs,
      deployment,
      clients,
      state,
      BigInt(toBlock),
    );
    const endHeader = await agreedBlock(clients, toBlock);
    state.cursor = toBlock;
    state.cursorHash = endHeader.hash;
    state.checkpoints.push({ number: toBlock, hash: endHeader.hash });
    state.checkpoints = state.checkpoints.slice(-REORG_LOOKBACK);
    await persistState(stateFile, state);
  }

  const globalState = await agreedGlobalState(clients, deployment, safeHead);
  emit("monitor_healthy", "info", {
    heads,
    safeHead,
    confirmations: CONFIRMATIONS,
    cursor: state.cursor,
    cursorHash: state.cursorHash,
    processedEvents,
    trackedLaunches: Object.keys(state.launches).length,
    totalNativeFees: globalState.totalNativeFees,
    launcherFees: globalState.launcherFees,
  });
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    help();
    return;
  }
  assert(
    Number.isInteger(CONFIRMATIONS) && CONFIRMATIONS >= 2,
    "MEME_MONITOR_CONFIRMATIONS must be at least 2",
  );
  assert(
    Number.isInteger(MAX_BLOCK_RANGE) && MAX_BLOCK_RANGE > 0,
    "MEME_MONITOR_MAX_BLOCK_RANGE must be positive",
  );
  assert(
    Number.isInteger(REORG_LOOKBACK) && REORG_LOOKBACK >= CONFIRMATIONS,
    "REORG_LOOKBACK must be at least the confirmation depth",
  );
  const deploymentPath =
    process.env.MAINNET_MEME_DEPLOYMENT_JSON ?? process.argv[2];
  assert(
    deploymentPath,
    "Set MAINNET_MEME_DEPLOYMENT_JSON or pass deployment.json",
  );
  const stateFile = process.env.MEME_MONITOR_STATE_FILE;
  assert(
    ONCE || stateFile,
    "Continuous mode requires MEME_MONITOR_STATE_FILE",
  );

  const deployment = await loadDeployment(deploymentPath);
  const clients = createClients();
  const chainIds = await Promise.all(
    clients.map(({ client }) => client.getChainId()),
  );
  assert(chainIds.every((chainId) => chainId === 1), "RPC chain ID mismatch");
  const state = await loadState(stateFile, deployment);

  do {
    await cycle(deployment, clients, state, stateFile);
    if (!ONCE) {
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, POLL_INTERVAL_MS),
      );
    }
  } while (!ONCE);
}

main().catch((error) => {
  if (!error.message?.includes("mismatch")) {
    emit("monitor_stopped", "critical", {
      message: error.message,
      stack: error.stack,
    });
  }
  process.exitCode = 1;
});
