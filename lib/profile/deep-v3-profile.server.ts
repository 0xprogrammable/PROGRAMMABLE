import "server-only";

import {
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import {
  assertDeepV3LaunchProvenance,
  assertDeepV3ReleaseRuntime,
  deepV3AutomationReadAbi,
  deepV3HookReadAbi,
  deepV3LaunchReadAbi,
  deepV3StateViewReadAbi,
  deepV3TokenLaunchedEvent,
  deepV3VaultBindingHash,
  deepV3VaultFactoryReadAbi,
  deepV3VaultReadAbi,
  DEEP_V3_FIXED_POLICY,
  DEEP_V3_RELEASE_VERSION,
  resolveVerifiedDeepV3ReadRelease,
  type DeepV3LaunchProvenance,
  type VerifiedDeepV3ReadRelease,
} from "../onchain/deep-v3-read-model";
import { uerc20ReadAbi } from "../onchain/abis";
import {
  marketCapNativeWadFromSqrtPriceX96,
  nativePriceWadFromSqrtPriceX96,
} from "../onchain/math";
import { buildTokenLinks, sanitizeImageUrl } from "../onchain/metadata";
import type { TokenLink } from "../tokens";

export type DeepV3ProfileClient = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(args: {
    blockNumber: bigint;
  }): Promise<{ hash: Hex | null; timestamp?: bigint }>;
  getCode(args: {
    address: Address;
    blockNumber?: bigint;
  }): Promise<Hex | undefined>;
  getLogs(args: Record<string, unknown>): Promise<
    readonly {
      args: Record<string, unknown>;
      blockNumber: bigint;
      blockHash: Hex | null;
      transactionHash: Hex;
      transactionIndex: number;
      logIndex: number;
      removed: boolean;
    }[]
  >;
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    blockNumber: bigint;
  }): Promise<unknown>;
};

type DeepV3ProfileInput = {
  manifest: unknown;
  chainId: number;
  account: Address;
  candidate: DeepV3LaunchProvenance;
  clients: readonly DeepV3ProfileClient[];
};

export type DeepV3ProfileSnapshot = {
  blockNumber: bigint;
  blockHash: Hex;
};

type CanonicalPoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

type CanonicalState = {
  token: {
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: bigint;
    creator: Address;
    description: string;
    website: string;
    image: string;
    extraData: Hex;
  };
  launcher: {
    vault: Address;
    launchHash: Hex;
    poolKey: CanonicalPoolKey;
  };
  hook: {
    poolManager: Address;
    positionManager: Address;
    factory: Address;
    treasury: Address;
    totalHookFeeBps: bigint;
    growthFeeBps: bigint;
    programmableFeeBps: bigint;
    transferTaxBps: bigint;
    lpFeePips: bigint;
    tickSpacing: bigint;
    finalizedLifecycle: bigint;
    poolConfig: readonly [Address, Address, bigint, bigint];
    disclosure: readonly [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      Address,
    ];
  };
  factory: {
    recognized: boolean;
    configurationHash: Hex;
    bindingHash: Hex;
    implementation: Address;
    planner: Address;
  };
  vault: {
    factory: Address;
    initialized: boolean;
    hook: Address;
    poolManager: Address;
    positionManager: Address;
    planner: Address;
    poolId: Hex;
    token: Address;
    configurationHash: Hex;
    poolKey: CanonicalPoolKey;
    pendingGrowthNative: bigint;
    initialTokenDust: bigint;
    accountedTokenDust: bigint;
    totalGrowthEthReceived: bigint;
    totalNativeSwapped: bigint;
    totalTokenAcquired: bigint;
    totalNativeAdded: bigint;
    totalTokenAdded: bigint;
    totalLiquidityAdded: bigint;
    lastCompoundTimestamp: bigint;
    compoundNonce: bigint;
    workState: readonly [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      Hex,
    ];
    lockedLiquidity: bigint;
    trustedNativeDepth: bigint;
    rollingExposure: bigint;
  };
  automation: {
    factory: Address;
    launcher: Address;
    registered: boolean;
  };
  pool: {
    sqrtPriceX96: bigint;
    tick: number;
    protocolFeePips: number;
    lpFeePips: number;
    activeLiquidity: bigint;
  };
};

const CONFIRMATIONS = 12n;
const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function address(value: unknown, label: string, allowZero = false): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const normalized = getAddress(value);
  if (!allowZero && sameAddress(normalized, ZERO_ADDRESS)) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

function bytes(value: unknown, size: number, label: string): Hex {
  if (
    typeof value !== "string" ||
    !isHex(value, { strict: true }) ||
    value.length !== 2 + size * 2
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function bytes32(value: unknown, label: string) {
  return bytes(value, 32, label);
}

function uint(value: unknown, label: string) {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return BigInt(value);
  }
  throw new Error(`Invalid ${label}`);
}

function unsignedNumber(value: unknown, label: string) {
  const parsed = uint(value, label);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Invalid ${label}`);
  }
  return Number(parsed);
}

function signedNumber(value: unknown, label: string) {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value)
  ) {
    return value;
  }
  if (
    typeof value === "bigint" &&
    value >= BigInt(Number.MIN_SAFE_INTEGER) &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return Number(value);
  }
  throw new Error(`Invalid ${label}`);
}

function bool(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`Invalid ${label}`);
  return value;
}

function tuple(value: unknown, length: number, label: string) {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function object(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function tupleOrObjectValue(
  value: unknown,
  index: number,
  key: string,
  label: string,
) {
  if (Array.isArray(value)) {
    if (index >= value.length) throw new Error(`Invalid ${label}`);
    return value[index];
  }
  const candidate = object(value, label);
  if (!(key in candidate)) throw new Error(`Invalid ${label}`);
  return candidate[key];
}

function canonicalJson(value: unknown) {
  return JSON.stringify(value, (_, entry) =>
    typeof entry === "bigint" ? entry.toString() : entry,
  );
}

function agreement<T>(label: string, values: readonly T[]) {
  if (
    values.length !== 2 ||
    canonicalJson(values[0]) !== canonicalJson(values[1])
  ) {
    throw new Error(`Independent RPCs disagree on ${label}`);
  }
  return values[0];
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function safeText(
  value: unknown,
  label: string,
  maximumBytes: number,
  required: boolean,
) {
  if (
    typeof value !== "string" ||
    utf8Bytes(value) > maximumBytes ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)
  ) {
    throw new Error(`Invalid ${label}`);
  }
  const normalized = value.trim();
  if (required && normalized.length === 0) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

function poolKey(value: unknown, label: string): CanonicalPoolKey {
  return {
    currency0: address(
      tupleOrObjectValue(value, 0, "currency0", label),
      `${label} currency0`,
      true,
    ),
    currency1: address(
      tupleOrObjectValue(value, 1, "currency1", label),
      `${label} currency1`,
    ),
    fee: unsignedNumber(
      tupleOrObjectValue(value, 2, "fee", label),
      `${label} fee`,
    ),
    tickSpacing: signedNumber(
      tupleOrObjectValue(value, 3, "tickSpacing", label),
      `${label} tick spacing`,
    ),
    hooks: address(
      tupleOrObjectValue(value, 4, "hooks", label),
      `${label} hook`,
    ),
  };
}

function metadata(value: unknown) {
  const description = safeText(
    tupleOrObjectValue(value, 0, "description", "token metadata"),
    "token description",
    280,
    false,
  );
  const websiteValue = tupleOrObjectValue(
    value,
    1,
    "website",
    "token metadata",
  );
  const imageValue = tupleOrObjectValue(
    value,
    2,
    "image",
    "token metadata",
  );
  const extraDataValue = tupleOrObjectValue(
    value,
    3,
    "extraData",
    "token metadata",
  );
  if (
    typeof websiteValue !== "string" ||
    utf8Bytes(websiteValue) > 2_048 ||
    typeof imageValue !== "string" ||
    utf8Bytes(imageValue) > 2_048 ||
    typeof extraDataValue !== "string" ||
    !isHex(extraDataValue, { strict: true }) ||
    (extraDataValue.length - 2) / 2 > 1_200
  ) {
    throw new Error("Invalid token metadata");
  }
  return {
    description,
    website: websiteValue,
    image: imageValue,
    extraData: extraDataValue as Hex,
  };
}

export async function resolveDeepV3ProfileSnapshot(
  clients: readonly DeepV3ProfileClient[],
  chainId: number,
): Promise<DeepV3ProfileSnapshot> {
  if (clients.length !== 2) {
    throw new Error("Deep V3 profiles require two independent RPC providers");
  }
  const heads = await Promise.all(
    clients.map(async (client) => {
      if ((await client.getChainId()) !== chainId) {
        throw new Error("Deep V3 profile RPC chain does not match the release");
      }
      return client.getBlockNumber();
    }),
  );
  const lowest = heads[0] < heads[1] ? heads[0] : heads[1];
  if (lowest <= CONFIRMATIONS) {
    throw new Error("Deep V3 profile has no confirmed snapshot");
  }
  const blockNumber = lowest - CONFIRMATIONS;
  const hashes = await Promise.all(
    clients.map(async (client) =>
      bytes32(
        (await client.getBlock({ blockNumber })).hash,
        "Deep V3 snapshot block hash",
      ),
    ),
  );
  return {
    blockNumber,
    blockHash: agreement("Deep V3 snapshot block", hashes),
  };
}

function normalizedLaunchLog(
  log: Awaited<ReturnType<DeepV3ProfileClient["getLogs"]>>[number],
) {
  return {
    creator: address(log.args.deployer, "Deep V3 launch creator"),
    tokenAddress: address(log.args.token, "Deep V3 launch token"),
    poolId: bytes32(log.args.poolId, "Deep V3 launch PoolId"),
    hookAddress: address(log.args.feeHook, "Deep V3 launch hook"),
    vaultAddress: address(log.args.growthVault, "Deep V3 launch vault"),
    positionRecipient: address(
      log.args.positionRecipient,
      "Deep V3 position recipient",
    ),
    positionTokenId: uint(
      log.args.positionTokenId,
      "Deep V3 position token ID",
    ),
    vaultConfigurationHash: bytes32(
      log.args.vaultConfigurationHash,
      "Deep V3 vault configuration hash",
    ),
    launchHash: bytes32(log.args.launchHash, "Deep V3 launch hash"),
    blockNumber: log.blockNumber,
    blockHash: bytes32(log.blockHash, "Deep V3 launch block hash"),
    transactionHash: bytes32(
      log.transactionHash,
      "Deep V3 launch transaction",
    ),
    transactionIndex: log.transactionIndex,
    logIndex: log.logIndex,
    removed: log.removed,
  };
}

async function assertCanonicalLaunch(
  clients: readonly DeepV3ProfileClient[],
  release: VerifiedDeepV3ReadRelease,
  candidate: DeepV3LaunchProvenance,
  snapshot: DeepV3ProfileSnapshot,
) {
  const launchBlock = BigInt(candidate.blockNumber);
  if (launchBlock > snapshot.blockNumber) {
    throw new Error("Deep V3 launch is newer than the confirmed snapshot");
  }
  const canonicalBlocks = await Promise.all(
    clients.map(async (client) => {
      const block = await client.getBlock({ blockNumber: launchBlock });
      return {
        hash: bytes32(block.hash, "Deep V3 canonical launch block"),
        timestamp: uint(block.timestamp, "Deep V3 launch timestamp"),
      };
    }),
  );
  const canonicalBlock = agreement(
    "Deep V3 canonical launch block",
    canonicalBlocks,
  );
  if (!sameHex(canonicalBlock.hash, candidate.blockHash)) {
    throw new Error("Deep V3 launch block is no longer canonical");
  }

  const providerLogs = await Promise.all(
    clients.map((client) =>
      client.getLogs({
        address: release.addresses.launcher,
        event: deepV3TokenLaunchedEvent,
        fromBlock: launchBlock,
        toBlock: launchBlock,
        strict: true,
      }),
    ),
  );
  const matches = providerLogs.map((logs) =>
    logs
      .filter(
        (log) =>
          !log.removed &&
          log.blockNumber === launchBlock &&
          log.blockHash !== null &&
          sameHex(log.blockHash, candidate.blockHash) &&
          sameHex(log.transactionHash, candidate.transactionHash) &&
          log.transactionIndex === candidate.transactionIndex &&
          log.logIndex === candidate.logIndex,
      )
      .map(normalizedLaunchLog),
  );
  if (matches.some((logs) => logs.length !== 1)) {
    throw new Error("Canonical Deep V3 launch event is missing");
  }
  const launch = agreement(
    "Deep V3 canonical launch event",
    matches.map((logs) => logs[0]),
  );
  if (
    launch.removed ||
    !sameAddress(launch.creator, candidate.creator) ||
    !sameAddress(launch.tokenAddress, candidate.tokenAddress) ||
    !sameAddress(launch.hookAddress, candidate.hookAddress) ||
    !sameAddress(launch.vaultAddress, candidate.vaultAddress) ||
    !sameAddress(
      launch.positionRecipient,
      candidate.positionRecipient,
    ) ||
    launch.positionTokenId.toString() !== candidate.positionTokenId ||
    !sameHex(launch.poolId, candidate.poolId) ||
    !sameHex(launch.launchHash, candidate.launchHash) ||
    !sameHex(
      launch.vaultConfigurationHash,
      candidate.vaultConfigurationHash,
    )
  ) {
    throw new Error("Deep V3 launch event does not match its provenance");
  }
  return canonicalBlock.timestamp;
}

async function read(
  client: DeepV3ProfileClient,
  blockNumber: bigint,
  contract: Address,
  abi: readonly unknown[],
  functionName: string,
  args?: readonly unknown[],
) {
  return client.readContract({
    address: contract,
    abi,
    functionName,
    ...(args ? { args } : {}),
    blockNumber,
  });
}

async function readCanonicalState(
  client: DeepV3ProfileClient,
  release: VerifiedDeepV3ReadRelease,
  candidate: DeepV3LaunchProvenance,
  blockNumber: bigint,
): Promise<CanonicalState> {
  const tokenAddress = candidate.tokenAddress;
  const vaultAddress = candidate.vaultAddress;
  const poolId = candidate.poolId;
  const [
    tokenName,
    tokenSymbol,
    tokenDecimals,
    tokenTotalSupply,
    tokenCreator,
    tokenMetadata,
    launcherVault,
    launcherLaunchHash,
    launcherPoolKey,
    hookPoolManager,
    hookPositionManager,
    hookFactory,
    hookTreasury,
    totalHookFeeBps,
    growthFeeBps,
    programmableFeeBps,
    transferTaxBps,
    hookLpFeePips,
    hookTickSpacing,
    lifecycleFinalized,
    hookPoolConfigRaw,
    hookDisclosureRaw,
    factoryRecognized,
    factoryConfigurationHash,
    factoryBindingHash,
    factoryImplementation,
    factoryPlanner,
    vaultFactory,
    vaultInitialized,
    vaultHook,
    vaultPoolManager,
    vaultPositionManager,
    vaultPlanner,
    vaultPoolId,
    vaultToken,
    vaultConfigurationHash,
    vaultPoolKey,
    pendingGrowthNative,
    initialTokenDust,
    accountedTokenDust,
    totalGrowthEthReceived,
    totalNativeSwapped,
    totalTokenAcquired,
    totalNativeAdded,
    totalTokenAdded,
    totalLiquidityAdded,
    lastCompoundTimestamp,
    compoundNonce,
    workStateRaw,
    lockedLiquidity,
    trustedNativeDepth,
    rollingExposure,
    automationFactory,
    automationLauncher,
    automationRegistered,
    slot0Raw,
    activeLiquidity,
  ] = await Promise.all([
    read(client, blockNumber, tokenAddress, uerc20ReadAbi, "name"),
    read(client, blockNumber, tokenAddress, uerc20ReadAbi, "symbol"),
    read(client, blockNumber, tokenAddress, uerc20ReadAbi, "decimals"),
    read(client, blockNumber, tokenAddress, uerc20ReadAbi, "totalSupply"),
    read(client, blockNumber, tokenAddress, uerc20ReadAbi, "creator"),
    read(client, blockNumber, tokenAddress, uerc20ReadAbi, "metadata"),
    read(
      client,
      blockNumber,
      release.addresses.launcher,
      deepV3LaunchReadAbi,
      "growthVaultOf",
      [tokenAddress],
    ),
    read(
      client,
      blockNumber,
      release.addresses.launcher,
      deepV3LaunchReadAbi,
      "launchHashOf",
      [tokenAddress],
    ),
    read(
      client,
      blockNumber,
      release.addresses.launcher,
      deepV3LaunchReadAbi,
      "poolKey",
      [tokenAddress],
    ),
    read(
      client,
      blockNumber,
      release.addresses.feeHook,
      deepV3HookReadAbi,
      "poolManager",
    ),
    read(
      client,
      blockNumber,
      release.addresses.feeHook,
      deepV3HookReadAbi,
      "positionManager",
    ),
    read(
      client,
      blockNumber,
      release.addresses.feeHook,
      deepV3HookReadAbi,
      "growthVaultFactory",
    ),
    read(
      client,
      blockNumber,
      release.addresses.feeHook,
      deepV3HookReadAbi,
      "launcherFeeRecipient",
    ),
    read(
      client,
      blockNumber,
      release.addresses.feeHook,
      deepV3HookReadAbi,
      "TOTAL_HOOK_FEE_BPS",
    ),
    read(
      client,
      blockNumber,
      release.addresses.feeHook,
      deepV3HookReadAbi,
      "GROWTH_FEE_BPS",
    ),
    read(
      client,
      blockNumber,
      release.addresses.feeHook,
      deepV3HookReadAbi,
      "PROGRAMMABLE_FEE_BPS",
    ),
    read(
      client,
      blockNumber,
      release.addresses.feeHook,
      deepV3HookReadAbi,
      "TRANSFER_TAX_BPS",
    ),
    read(
      client,
      blockNumber,
      release.addresses.feeHook,
      deepV3HookReadAbi,
      "LP_FEE_PIPS",
    ),
    read(
      client,
      blockNumber,
      release.addresses.feeHook,
      deepV3HookReadAbi,
      "TICK_SPACING",
    ),
    read(
      client,
      blockNumber,
      release.addresses.feeHook,
      deepV3HookReadAbi,
      "LIFECYCLE_FINALIZED",
    ),
    read(
      client,
      blockNumber,
      release.addresses.feeHook,
      deepV3HookReadAbi,
      "poolFeeConfig",
      [poolId],
    ),
    read(
      client,
      blockNumber,
      release.addresses.feeHook,
      deepV3HookReadAbi,
      "feeDisclosure",
      [poolId],
    ),
    read(
      client,
      blockNumber,
      release.addresses.growthVaultFactory,
      deepV3VaultFactoryReadAbi,
      "isFactoryVault",
      [vaultAddress],
    ),
    read(
      client,
      blockNumber,
      release.addresses.growthVaultFactory,
      deepV3VaultFactoryReadAbi,
      "configurationHashOf",
      [vaultAddress],
    ),
    read(
      client,
      blockNumber,
      release.addresses.growthVaultFactory,
      deepV3VaultFactoryReadAbi,
      "vaultBindingHash",
      [vaultAddress],
    ),
    read(
      client,
      blockNumber,
      release.addresses.growthVaultFactory,
      deepV3VaultFactoryReadAbi,
      "implementation",
    ),
    read(
      client,
      blockNumber,
      release.addresses.growthVaultFactory,
      deepV3VaultFactoryReadAbi,
      "planner",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "FACTORY",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "initialized",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "feeHook",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "poolManager",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "positionManager",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "planner",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "poolId",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "token",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "configurationHash",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "poolKey",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "pendingGrowthNative",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "initialTokenDust",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "accountedTokenDust",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "totalGrowthETHReceived",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "totalNativeSwapped",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "totalTokenAcquired",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "totalNativeAdded",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "totalTokenAdded",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "totalLiquidityAdded",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "lastCompoundTimestamp",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "compoundNonce",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "workState",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "lockedLiquidity",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "trustedNativeDepth",
    ),
    read(
      client,
      blockNumber,
      vaultAddress,
      deepV3VaultReadAbi,
      "rollingExposure",
    ),
    read(
      client,
      blockNumber,
      release.addresses.automation,
      deepV3AutomationReadAbi,
      "vaultFactory",
    ),
    read(
      client,
      blockNumber,
      release.addresses.automation,
      deepV3AutomationReadAbi,
      "launcher",
    ),
    read(
      client,
      blockNumber,
      release.addresses.automation,
      deepV3AutomationReadAbi,
      "isRegisteredVault",
      [vaultAddress],
    ),
    read(
      client,
      blockNumber,
      release.officialDependencies.stateView.address,
      deepV3StateViewReadAbi,
      "getSlot0",
      [poolId],
    ),
    read(
      client,
      blockNumber,
      release.officialDependencies.stateView.address,
      deepV3StateViewReadAbi,
      "getLiquidity",
      [poolId],
    ),
  ]);

  const parsedMetadata = metadata(tokenMetadata);
  const poolConfig = tuple(hookPoolConfigRaw, 4, "Deep V3 pool config");
  const disclosure = tuple(
    hookDisclosureRaw,
    6,
    "Deep V3 fee disclosure",
  );
  const workState = tuple(workStateRaw, 6, "Deep V3 work state");
  const slot0 = tuple(slot0Raw, 4, "Deep V3 slot0");

  return {
    token: {
      name: safeText(tokenName, "token name", 48, true),
      symbol: safeText(tokenSymbol, "token symbol", 12, true),
      decimals: unsignedNumber(tokenDecimals, "token decimals"),
      totalSupply: uint(tokenTotalSupply, "token total supply"),
      creator: address(tokenCreator, "token creator"),
      ...parsedMetadata,
    },
    launcher: {
      vault: address(launcherVault, "launcher vault"),
      launchHash: bytes32(launcherLaunchHash, "launcher launch hash"),
      poolKey: poolKey(launcherPoolKey, "launcher pool key"),
    },
    hook: {
      poolManager: address(hookPoolManager, "hook PoolManager"),
      positionManager: address(
        hookPositionManager,
        "hook PositionManager",
      ),
      factory: address(hookFactory, "hook vault factory"),
      treasury: address(hookTreasury, "hook treasury"),
      totalHookFeeBps: uint(totalHookFeeBps, "total hook fee"),
      growthFeeBps: uint(growthFeeBps, "growth fee"),
      programmableFeeBps: uint(
        programmableFeeBps,
        "Programmable fee",
      ),
      transferTaxBps: uint(transferTaxBps, "transfer tax"),
      lpFeePips: uint(hookLpFeePips, "hook LP fee"),
      tickSpacing: uint(hookTickSpacing, "hook tick spacing"),
      finalizedLifecycle: uint(
        lifecycleFinalized,
        "finalized lifecycle",
      ),
      poolConfig: [
        address(poolConfig[0], "configured growth vault"),
        address(poolConfig[1], "pool registrar"),
        uint(poolConfig[2], "pool lifecycle"),
        uint(poolConfig[3], "accrued growth fees"),
      ],
      disclosure: [
        uint(disclosure[0], "disclosed total fee"),
        uint(disclosure[1], "disclosed growth fee"),
        uint(disclosure[2], "disclosed Programmable fee"),
        uint(disclosure[3], "disclosed transfer tax"),
        uint(disclosure[4], "disclosed LP fee"),
        address(disclosure[5], "disclosed growth vault"),
      ],
    },
    factory: {
      recognized: bool(factoryRecognized, "factory vault status"),
      configurationHash: bytes32(
        factoryConfigurationHash,
        "factory configuration hash",
      ),
      bindingHash: bytes32(factoryBindingHash, "factory binding hash"),
      implementation: address(
        factoryImplementation,
        "factory implementation",
      ),
      planner: address(factoryPlanner, "factory planner"),
    },
    vault: {
      factory: address(vaultFactory, "vault factory"),
      initialized: bool(vaultInitialized, "vault initialization"),
      hook: address(vaultHook, "vault hook"),
      poolManager: address(vaultPoolManager, "vault PoolManager"),
      positionManager: address(
        vaultPositionManager,
        "vault PositionManager",
      ),
      planner: address(vaultPlanner, "vault planner"),
      poolId: bytes32(vaultPoolId, "vault PoolId"),
      token: address(vaultToken, "vault token"),
      configurationHash: bytes32(
        vaultConfigurationHash,
        "vault configuration hash",
      ),
      poolKey: poolKey(vaultPoolKey, "vault pool key"),
      pendingGrowthNative: uint(
        pendingGrowthNative,
        "pending growth ETH",
      ),
      initialTokenDust: uint(initialTokenDust, "initial token dust"),
      accountedTokenDust: uint(
        accountedTokenDust,
        "accounted token dust",
      ),
      totalGrowthEthReceived: uint(
        totalGrowthEthReceived,
        "total growth ETH received",
      ),
      totalNativeSwapped: uint(
        totalNativeSwapped,
        "total native swapped",
      ),
      totalTokenAcquired: uint(
        totalTokenAcquired,
        "total token acquired",
      ),
      totalNativeAdded: uint(totalNativeAdded, "total native added"),
      totalTokenAdded: uint(totalTokenAdded, "total token added"),
      totalLiquidityAdded: uint(
        totalLiquidityAdded,
        "total liquidity added",
      ),
      lastCompoundTimestamp: uint(
        lastCompoundTimestamp,
        "last compound timestamp",
      ),
      compoundNonce: uint(compoundNonce, "compound nonce"),
      workState: [
        uint(workState[0], "work action"),
        uint(workState[1], "work hook growth fees"),
        uint(workState[2], "work pending native"),
        uint(workState[3], "next eligible timestamp"),
        uint(workState[4], "rolling capacity"),
        bytes(workState[5], 4, "work blocked reason"),
      ],
      lockedLiquidity: uint(lockedLiquidity, "locked liquidity"),
      trustedNativeDepth: uint(
        trustedNativeDepth,
        "trusted native depth",
      ),
      rollingExposure: uint(rollingExposure, "rolling exposure"),
    },
    automation: {
      factory: address(automationFactory, "automation factory"),
      launcher: address(automationLauncher, "automation launcher"),
      registered: bool(
        automationRegistered,
        "automation registration",
      ),
    },
    pool: {
      sqrtPriceX96: uint(slot0[0], "pool sqrt price"),
      tick: signedNumber(slot0[1], "pool tick"),
      protocolFeePips: unsignedNumber(slot0[2], "protocol fee"),
      lpFeePips: unsignedNumber(slot0[3], "pool LP fee"),
      activeLiquidity: uint(activeLiquidity, "active pool liquidity"),
    },
  };
}

function samePoolKey(left: CanonicalPoolKey, right: CanonicalPoolKey) {
  return (
    sameAddress(left.currency0, right.currency0) &&
    sameAddress(left.currency1, right.currency1) &&
    left.fee === right.fee &&
    left.tickSpacing === right.tickSpacing &&
    sameAddress(left.hooks, right.hooks)
  );
}

function assertCanonicalState(
  state: CanonicalState,
  release: VerifiedDeepV3ReadRelease,
  candidate: DeepV3LaunchProvenance,
) {
  const expectedPoolKey: CanonicalPoolKey = {
    currency0: ZERO_ADDRESS,
    currency1: candidate.tokenAddress,
    fee: DEEP_V3_FIXED_POLICY.lpFeePips,
    tickSpacing: DEEP_V3_FIXED_POLICY.tickSpacing,
    hooks: release.addresses.feeHook,
  };
  const expectedBinding = deepV3VaultBindingHash({
    chainId: release.chainId,
    factory: release.addresses.growthVaultFactory,
    vault: candidate.vaultAddress,
    hook: release.addresses.feeHook,
    poolId: candidate.poolId,
    token: candidate.tokenAddress,
  });
  if (
    state.token.decimals !== 18 ||
    state.token.totalSupply !==
      BigInt(DEEP_V3_FIXED_POLICY.tokenSupplyWei) ||
    !sameAddress(state.token.creator, release.addresses.launcher) ||
    !sameAddress(state.launcher.vault, candidate.vaultAddress) ||
    !sameHex(state.launcher.launchHash, candidate.launchHash) ||
    !samePoolKey(state.launcher.poolKey, expectedPoolKey)
  ) {
    throw new Error("Deep V3 token or launcher binding is inconsistent");
  }
  if (
    !state.factory.recognized ||
    !sameHex(
      state.factory.configurationHash,
      candidate.vaultConfigurationHash,
    ) ||
    !sameHex(state.factory.bindingHash, expectedBinding) ||
    !sameAddress(
      state.factory.implementation,
      release.addresses.growthVaultImplementation,
    ) ||
    !sameAddress(state.factory.planner, release.addresses.zapPlanner)
  ) {
    throw new Error("Deep V3 vault factory binding is inconsistent");
  }
  if (
    !state.vault.initialized ||
    !sameAddress(
      state.vault.factory,
      release.addresses.growthVaultFactory,
    ) ||
    !sameAddress(state.vault.hook, release.addresses.feeHook) ||
    !sameAddress(
      state.vault.poolManager,
      release.officialDependencies.poolManager.address,
    ) ||
    !sameAddress(
      state.vault.positionManager,
      release.officialDependencies.positionManager.address,
    ) ||
    !sameAddress(state.vault.planner, release.addresses.zapPlanner) ||
    !sameHex(state.vault.poolId, candidate.poolId) ||
    !sameAddress(state.vault.token, candidate.tokenAddress) ||
    !sameHex(
      state.vault.configurationHash,
      candidate.vaultConfigurationHash,
    ) ||
    !samePoolKey(state.vault.poolKey, expectedPoolKey)
  ) {
    throw new Error("Deep V3 vault does not belong to the canonical pool");
  }
  const [configuredVault, registrar, lifecycle, growthFeesAccrued] =
    state.hook.poolConfig;
  const [
    totalFee,
    growthFee,
    programmableFee,
    transferTax,
    lpFee,
    disclosedVault,
  ] = state.hook.disclosure;
  if (
    !sameAddress(
      state.hook.poolManager,
      release.officialDependencies.poolManager.address,
    ) ||
    !sameAddress(
      state.hook.positionManager,
      release.officialDependencies.positionManager.address,
    ) ||
    !sameAddress(
      state.hook.factory,
      release.addresses.growthVaultFactory,
    ) ||
    !sameAddress(state.hook.treasury, release.addresses.treasury) ||
    state.hook.totalHookFeeBps !==
      BigInt(DEEP_V3_FIXED_POLICY.totalSwapFeeBps) ||
    state.hook.growthFeeBps !==
      BigInt(DEEP_V3_FIXED_POLICY.growthFeeBps) ||
    state.hook.programmableFeeBps !==
      BigInt(DEEP_V3_FIXED_POLICY.programmableFeeBps) ||
    state.hook.transferTaxBps !== 0n ||
    state.hook.lpFeePips !== 0n ||
    state.hook.tickSpacing !==
      BigInt(DEEP_V3_FIXED_POLICY.tickSpacing) ||
    lifecycle !== state.hook.finalizedLifecycle ||
    state.hook.finalizedLifecycle !== 5n ||
    !sameAddress(configuredVault, candidate.vaultAddress) ||
    !sameAddress(registrar, release.addresses.launcher) ||
    totalFee !== BigInt(DEEP_V3_FIXED_POLICY.totalSwapFeeBps) ||
    growthFee !== BigInt(DEEP_V3_FIXED_POLICY.growthFeeBps) ||
    programmableFee !==
      BigInt(DEEP_V3_FIXED_POLICY.programmableFeeBps) ||
    transferTax !== 0n ||
    lpFee !== 0n ||
    !sameAddress(disclosedVault, candidate.vaultAddress)
  ) {
    throw new Error("Deep V3 hook fee or lifecycle binding is inconsistent");
  }
  if (
    !state.automation.registered ||
    !sameAddress(
      state.automation.factory,
      release.addresses.growthVaultFactory,
    ) ||
    !sameAddress(
      state.automation.launcher,
      release.addresses.launcher,
    )
  ) {
    throw new Error("Deep V3 automation binding is inconsistent");
  }
  if (
    state.vault.initialTokenDust >= state.token.totalSupply ||
    state.vault.initialTokenDust + state.vault.totalTokenAcquired !==
      state.vault.totalTokenAdded + state.vault.accountedTokenDust ||
    state.vault.totalGrowthEthReceived !==
      state.vault.totalNativeSwapped +
        state.vault.totalNativeAdded +
        state.vault.pendingGrowthNative ||
    state.vault.totalLiquidityAdded !== state.vault.lockedLiquidity ||
    (state.vault.compoundNonce === 0n) !==
      (state.vault.lastCompoundTimestamp === 0n) ||
    state.vault.workState[0] > 1n ||
    state.vault.workState[1] !== growthFeesAccrued ||
    state.vault.workState[2] !== state.vault.pendingGrowthNative ||
    state.vault.workState[3] !==
      (state.vault.lastCompoundTimestamp === 0n
        ? 0n
        : state.vault.lastCompoundTimestamp +
          BigInt(DEEP_V3_FIXED_POLICY.compoundCooldownSeconds)) ||
    state.pool.sqrtPriceX96 <= 0n ||
    state.pool.lpFeePips !== DEEP_V3_FIXED_POLICY.lpFeePips
  ) {
    throw new Error("Deep V3 growth accounting is inconsistent");
  }
}

export type DeepV3ProfileToken = {
  deepReleaseVersion: typeof DEEP_V3_RELEASE_VERSION;
  launchModel: "deep";
  tokenAddress: Address;
  tokenName: string;
  tokenSymbol: string;
  description?: string;
  imageUrl?: string;
  links: readonly TokenLink[];
  creator: Address;
  launcher: Address;
  hookAddress: Address;
  vaultAddress: Address;
  poolId: Hex;
  positionRecipient: Address;
  positionTokenId: string;
  launchHash: Hex;
  launchTransactionHash: Hex;
  launchBlockNumber: string;
  launchedAt: string;
  totalSupplyRaw: string;
  tokenDecimals: 18;
  totalHookFeeBps: 100;
  growthFeeBps: 90;
  programmableFeeBps: 10;
  transferTaxBps: 0;
  lpFeePips: 0;
  sqrtPriceX96: string;
  currentTick: number;
  protocolFeePips: number;
  activeLiquidity: string;
  nativePriceWad: string;
  marketCapNativeWad: string;
  pendingGrowthNativeWei: string;
  accruedGrowthFeesWei: string;
  totalGrowthEthReceivedWei: string;
  totalNativeSwappedWei: string;
  totalTokenAcquiredRaw: string;
  totalNativeAddedWei: string;
  totalTokenAddedRaw: string;
  lockedLiquidity: string;
  trustedNativeDepthWei: string;
  rollingExposureWei: string;
  compoundCount: string;
  lastCompoundTimestamp: string;
  automationAction: 0 | 1;
  nextEligibleTimestamp: string;
  rollingCapacityWei: string;
  blockedReason: Hex;
};

export type DeepV3Profile = {
  status: "ready";
  chainId: 1;
  account: Address;
  snapshot: {
    blockNumber: string;
    blockHash: Hex;
  };
  token: DeepV3ProfileToken;
};

/**
 * Reads one creator-owned Deep token. Deep V3 has no creator reward or
 * payout surface, so this return type deliberately contains no claim action.
 */
export async function readDeepV3ProfileToken(
  input: DeepV3ProfileInput,
): Promise<DeepV3Profile> {
  const release = resolveVerifiedDeepV3ReadRelease(
    input.manifest,
    input.chainId,
  );
  if (!release) {
    throw new Error("Deep V3 profile requires the verified live release");
  }
  const candidate = assertDeepV3LaunchProvenance(
    input.candidate,
    release,
  );
  const account = address(input.account, "Deep V3 profile account");
  if (!sameAddress(account, candidate.creator)) {
    throw new Error("Deep V3 token does not belong to this profile");
  }

  const snapshot = await resolveDeepV3ProfileSnapshot(
    input.clients,
    release.chainId,
  );
  await Promise.all(
    input.clients.map((client) =>
      assertDeepV3ReleaseRuntime(client, release, snapshot.blockNumber),
    ),
  );
  const launchTimestamp = await assertCanonicalLaunch(
    input.clients,
    release,
    candidate,
    snapshot,
  );
  const states = await Promise.all(
    input.clients.map((client) =>
      readCanonicalState(
        client,
        release,
        candidate,
        snapshot.blockNumber,
      ),
    ),
  );
  const state = agreement("Deep V3 token state", states);
  assertCanonicalState(state, release, candidate);

  const imageUrl = sanitizeImageUrl(state.token.image) ?? undefined;
  const links = buildTokenLinks(
    state.token.website,
    state.token.extraData,
  );
  const nativePriceWad = nativePriceWadFromSqrtPriceX96(
    state.pool.sqrtPriceX96,
    state.token.decimals,
  );
  const marketCapNativeWad = marketCapNativeWadFromSqrtPriceX96(
    state.token.totalSupply,
    state.pool.sqrtPriceX96,
  );

  return {
    status: "ready",
    chainId: 1,
    account,
    snapshot: {
      blockNumber: snapshot.blockNumber.toString(),
      blockHash: snapshot.blockHash,
    },
    token: {
      deepReleaseVersion: DEEP_V3_RELEASE_VERSION,
      launchModel: "deep",
      tokenAddress: candidate.tokenAddress,
      tokenName: state.token.name,
      tokenSymbol: state.token.symbol,
      ...(state.token.description
        ? { description: state.token.description }
        : {}),
      ...(imageUrl ? { imageUrl } : {}),
      links,
      creator: candidate.creator,
      launcher: candidate.launcher,
      hookAddress: candidate.hookAddress,
      vaultAddress: candidate.vaultAddress,
      poolId: candidate.poolId,
      positionRecipient: candidate.positionRecipient,
      positionTokenId: candidate.positionTokenId,
      launchHash: candidate.launchHash,
      launchTransactionHash: candidate.transactionHash,
      launchBlockNumber: candidate.blockNumber,
      launchedAt: new Date(
        Number(launchTimestamp) * 1_000,
      ).toISOString(),
      totalSupplyRaw: state.token.totalSupply.toString(),
      tokenDecimals: 18,
      totalHookFeeBps: 100,
      growthFeeBps: 90,
      programmableFeeBps: 10,
      transferTaxBps: 0,
      lpFeePips: 0,
      sqrtPriceX96: state.pool.sqrtPriceX96.toString(),
      currentTick: state.pool.tick,
      protocolFeePips: state.pool.protocolFeePips,
      activeLiquidity: state.pool.activeLiquidity.toString(),
      nativePriceWad: nativePriceWad.toString(),
      marketCapNativeWad: marketCapNativeWad.toString(),
      pendingGrowthNativeWei:
        state.vault.pendingGrowthNative.toString(),
      accruedGrowthFeesWei: state.hook.poolConfig[3].toString(),
      totalGrowthEthReceivedWei:
        state.vault.totalGrowthEthReceived.toString(),
      totalNativeSwappedWei: state.vault.totalNativeSwapped.toString(),
      totalTokenAcquiredRaw: state.vault.totalTokenAcquired.toString(),
      totalNativeAddedWei: state.vault.totalNativeAdded.toString(),
      totalTokenAddedRaw: state.vault.totalTokenAdded.toString(),
      lockedLiquidity: state.vault.lockedLiquidity.toString(),
      trustedNativeDepthWei:
        state.vault.trustedNativeDepth.toString(),
      rollingExposureWei: state.vault.rollingExposure.toString(),
      compoundCount: state.vault.compoundNonce.toString(),
      lastCompoundTimestamp:
        state.vault.lastCompoundTimestamp.toString(),
      automationAction: Number(state.vault.workState[0]) as 0 | 1,
      nextEligibleTimestamp: state.vault.workState[3].toString(),
      rollingCapacityWei: state.vault.workState[4].toString(),
      blockedReason: state.vault.workState[5],
    },
  };
}
