import "server-only";

import {
  getAddress,
  isAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import {
  getVerifiedDeepV2Release,
  type LaunchModelReleaseManifest,
} from "../launch-model-gating";
import {
  assertDeepV2LaunchCandidate,
  deepV2AutomationProfileAbi,
  deepV2FeeHookProfileAbi,
  deepV2GrowthVaultFactoryProfileAbi,
  deepV2GrowthVaultProfileAbi,
  deepV2LaunchProfileAbi,
  deepV2TokenLaunchedEvent,
  encodeDeepV2RewardAction,
  type DeepV2LaunchCandidate,
  type DeepV2ProfileRelease,
} from "./deep-v2-rewards";

export type DeepV2ProfileClient = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockNumber: bigint }): Promise<{ hash: Hex | null }>;
  getCode(args: {
    address: Address;
    blockNumber: bigint;
  }): Promise<Hex | undefined>;
  getLogs(args: Record<string, unknown>): Promise<
    readonly {
      args: Record<string, unknown>;
      blockNumber: bigint;
      blockHash: Hex | null;
      transactionHash: Hex;
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
  call(args: {
    account: Address;
    to: Address;
    data: Hex;
    value: bigint;
    blockNumber: bigint;
  }): Promise<{ data?: Hex }>;
  estimateGas(args: {
    account: Address;
    to: Address;
    data: Hex;
    value: bigint;
    blockNumber: bigint;
  }): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  getBalance(args: {
    address: Address;
    blockNumber: bigint;
  }): Promise<bigint>;
};

type BaseInput = {
  manifest: LaunchModelReleaseManifest;
  chainId: number;
  account: Address;
  candidate: DeepV2LaunchCandidate;
  clients: readonly DeepV2ProfileClient[];
};

const CONFIRMATIONS = 12n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const GROWTH_TARGET_NATIVE = 50_000_000_000_000_000n;
const TOKEN_RESERVE_TARGET = 150_000_000n * 10n ** 18n;
const COMPLETION_TOLERANCE_NATIVE = 1_000_000_000_000n;
const MINIMUM_NATIVE_LIQUIDITY_FOR_COMPLETION =
  GROWTH_TARGET_NATIVE - COMPLETION_TOLERANCE_NATIVE;

type Snapshot = {
  blockNumber: bigint;
  blockHash: Hex;
};

type CanonicalVaultState = {
  initialized: boolean;
  feeHook: Address;
  oracleGuard: Address;
  upstreamVault: Address;
  poolId: Hex;
  token: Address;
  creator: Address;
  configurationHash: Hex;
  beneficiaryCount: bigint;
  beneficiary: Address;
  shareBps: bigint;
  payoutAddress: Address;
  claimed: bigint;
  claimable: bigint;
  growthTarget: bigint;
  tokenReserve: bigint;
  completionTolerance: bigint;
  minimumNativeLiquidityForCompletion: bigint;
  totalCreatorFeesReceived: bigint;
  totalNativeAllocatedToGrowth: bigint;
  totalRewardFeesReceived: bigint;
  deferredRewardFees: bigint;
  totalRewardFeesClaimed: bigint;
  pendingGrowthNative: bigint;
  totalNativeAddedToLiquidity: bigint;
  totalTokenAddedToLiquidity: bigint;
  growthTargetReached: boolean;
  oracleReady: boolean;
  workState: readonly [bigint, bigint, bigint, bigint, bigint, bigint];
  factoryRecognized: boolean;
  factoryConfigurationHash: Hex;
  launcherVault: Address;
  launcherLaunchHash: Hex;
  hookPoolConfig: readonly [Address, Address, bigint, bigint, boolean, bigint];
  automationRegistered: boolean;
};

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function address(value: unknown, label: string) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const normalized = getAddress(value);
  if (normalized.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

function bytes32(value: unknown, label: string): Hex {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(value)
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Hex;
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

function canonicalJson(value: unknown) {
  return JSON.stringify(value, (_, item) =>
    typeof item === "bigint" ? item.toString() : item,
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

function profileRelease(
  manifest: LaunchModelReleaseManifest,
  chainId: number,
): DeepV2ProfileRelease {
  const verified = getVerifiedDeepV2Release(manifest, chainId);
  if (!verified) {
    throw new Error("Deep profiles require an eligible verified Deep V2 release");
  }
  const hashes = verified.runtimeCodeHashes;
  return {
    chainId: chainId as 1 | 11_155_111,
    releaseVersion: "deep-full-range-v2",
    launcher: address(verified.launcher, "Deep V2 release launcher"),
    launcherRuntimeCodeHash: bytes32(
      hashes?.launcher,
      "Deep V2 launcher runtime hash",
    ),
    feeHook: address(verified.feeHook, "Deep V2 release hook"),
    feeHookRuntimeCodeHash: bytes32(
      hashes?.feeHook,
      "Deep V2 hook runtime hash",
    ),
    growthVaultFactory: address(
      verified.growthVaultFactory,
      "Deep V2 release vault factory",
    ),
    growthVaultFactoryRuntimeCodeHash: bytes32(
      hashes?.growthVaultFactory,
      "Deep V2 vault factory runtime hash",
    ),
    growthVaultImplementation: address(
      verified.growthVaultImplementation,
      "Deep V2 release vault implementation",
    ),
    growthVaultImplementationRuntimeCodeHash: bytes32(
      hashes?.growthVaultImplementation,
      "Deep V2 vault implementation runtime hash",
    ),
    automation: address(
      verified.automation,
      "Deep V2 release automation",
    ),
    automationRuntimeCodeHash: bytes32(
      hashes?.automation,
      "Deep V2 automation runtime hash",
    ),
  };
}

async function confirmedSnapshot(
  clients: readonly DeepV2ProfileClient[],
  chainId: number,
) {
  if (clients.length !== 2) {
    throw new Error("Deep V2 profiles require two independent RPC providers");
  }
  const heads = await Promise.all(
    clients.map(async (client) => {
      const actualChainId = await client.getChainId();
      if (actualChainId !== chainId) {
        throw new Error("Deep V2 profile RPC chain does not match the release");
      }
      return client.getBlockNumber();
    }),
  );
  const lowest = heads[0] < heads[1] ? heads[0] : heads[1];
  if (lowest <= CONFIRMATIONS) {
    throw new Error("Deep V2 profile has no confirmed snapshot");
  }
  const blockNumber = lowest - CONFIRMATIONS;
  const hashes = await Promise.all(
    clients.map(async (client) => {
      const block = await client.getBlock({ blockNumber });
      return bytes32(block.hash, "Deep V2 snapshot block hash");
    }),
  );
  return {
    blockNumber,
    blockHash: agreement("Deep V2 snapshot block", hashes),
  } satisfies Snapshot;
}

async function assertReleaseRuntime(
  clients: readonly DeepV2ProfileClient[],
  release: DeepV2ProfileRelease,
  snapshot: Snapshot,
) {
  const contracts = [
    [
      "Deep V2 launcher",
      release.launcher,
      release.launcherRuntimeCodeHash,
    ],
    [
      "Deep V2 hook",
      release.feeHook,
      release.feeHookRuntimeCodeHash,
    ],
    [
      "Deep V2 vault factory",
      release.growthVaultFactory,
      release.growthVaultFactoryRuntimeCodeHash,
    ],
    [
      "Deep V2 vault implementation",
      release.growthVaultImplementation,
      release.growthVaultImplementationRuntimeCodeHash,
    ],
    [
      "Deep V2 automation",
      release.automation,
      release.automationRuntimeCodeHash,
    ],
  ] as const;
  await Promise.all(
    clients.flatMap((client) =>
      contracts.map(async ([label, contract, expectedHash]) => {
        const code = await client.getCode({
          address: contract,
          blockNumber: snapshot.blockNumber,
        });
        if (
          !code ||
          code === "0x" ||
          keccak256(code).toLowerCase() !== expectedHash.toLowerCase()
        ) {
          throw new Error(
            `${label} runtime does not match the verified Deep V2 release`,
          );
        }
      }),
    ),
  );
}

function normalizedLaunchLog(
  log: Awaited<ReturnType<DeepV2ProfileClient["getLogs"]>>[number],
) {
  const args = log.args;
  return {
    creator: address(args.deployer, "Deep V2 launch creator"),
    tokenAddress: address(args.token, "Deep V2 launch token"),
    poolId: bytes32(args.poolId, "Deep V2 launch PoolId"),
    hookAddress: address(args.feeHook, "Deep V2 launch hook"),
    vaultAddress: address(args.growthVault, "Deep V2 launch vault"),
    oracleGuard: address(args.oracleGuard, "Deep V2 oracle guard"),
    upstreamVault: address(
      args.upstreamRewardVault,
      "Deep V2 upstream reward vault",
    ),
    positionRecipient: address(
      args.positionRecipient,
      "Deep V2 position recipient",
    ),
    positionTokenId: uint(args.positionTokenId, "Deep V2 position token ID"),
    buySwapFeeBps: uint(args.buySwapFeeBps, "Deep V2 buy fee"),
    sellSwapFeeBps: uint(args.sellSwapFeeBps, "Deep V2 sell fee"),
    vaultConfigurationHash: bytes32(
      args.vaultConfigurationHash,
      "Deep V2 vault configuration hash",
    ),
    launchHash: bytes32(args.launchHash, "Deep V2 launch hash"),
    blockNumber: log.blockNumber,
    blockHash: bytes32(log.blockHash, "Deep V2 launch block hash"),
    transactionHash: bytes32(
      log.transactionHash,
      "Deep V2 launch transaction",
    ),
    logIndex: log.logIndex,
    removed: log.removed,
  };
}

async function assertCanonicalLaunch(
  clients: readonly DeepV2ProfileClient[],
  release: DeepV2ProfileRelease,
  candidate: DeepV2LaunchCandidate,
  snapshot: Snapshot,
) {
  if (candidate.blockNumber > snapshot.blockNumber) {
    throw new Error("The Deep V2 launch is newer than the confirmed snapshot");
  }
  const canonicalBlocks = await Promise.all(
    clients.map(async (client) => {
      const block = await client.getBlock({
        blockNumber: candidate.blockNumber,
      });
      return bytes32(block.hash, "Deep V2 canonical launch block");
    }),
  );
  const canonicalBlockHash = agreement(
    "Deep V2 canonical launch block",
    canonicalBlocks,
  );
  if (canonicalBlockHash.toLowerCase() !== candidate.blockHash.toLowerCase()) {
    throw new Error("The Deep V2 launch block is no longer canonical");
  }

  const providerLogs = await Promise.all(
    clients.map((client) =>
      client.getLogs({
        address: release.launcher,
        event: deepV2TokenLaunchedEvent,
        fromBlock: candidate.blockNumber,
        toBlock: candidate.blockNumber,
        strict: true,
      }),
    ),
  );
  const matches = providerLogs.map((logs) =>
    logs
      .filter(
        (log) =>
          !log.removed &&
          log.blockNumber === candidate.blockNumber &&
          log.blockHash?.toLowerCase() ===
            candidate.blockHash.toLowerCase() &&
          log.transactionHash.toLowerCase() ===
            candidate.transactionHash.toLowerCase() &&
          log.logIndex === candidate.logIndex,
      )
      .map(normalizedLaunchLog),
  );
  if (matches.some((logs) => logs.length !== 1)) {
    throw new Error("The canonical Deep V2 launch event is missing");
  }
  const launch = agreement(
    "Deep V2 canonical launch event",
    matches.map((logs) => logs[0]),
  );
  if (
    launch.removed ||
    !sameAddress(launch.creator, candidate.creator) ||
    !sameAddress(launch.tokenAddress, candidate.tokenAddress) ||
    !sameAddress(launch.hookAddress, candidate.hookAddress) ||
    !sameAddress(launch.vaultAddress, candidate.vaultAddress) ||
    launch.poolId.toLowerCase() !== candidate.poolId.toLowerCase() ||
    launch.launchHash.toLowerCase() !== candidate.launchHash.toLowerCase() ||
    launch.vaultConfigurationHash.toLowerCase() !==
      candidate.vaultConfigurationHash.toLowerCase() ||
    launch.buySwapFeeBps !== 100n ||
    launch.sellSwapFeeBps !== 100n
  ) {
    throw new Error("The Deep V2 launch event does not match its release record");
  }
  return launch;
}

async function read(
  client: DeepV2ProfileClient,
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

async function readVaultState(
  client: DeepV2ProfileClient,
  release: DeepV2ProfileRelease,
  candidate: DeepV2LaunchCandidate,
  account: Address,
  blockNumber: bigint,
): Promise<CanonicalVaultState> {
  const [
    initialized,
    feeHook,
    oracleGuard,
    upstreamVault,
    poolId,
    token,
    creator,
    configurationHash,
    beneficiaryCount,
    beneficiary,
    shareBps,
    payoutAddress,
    claimed,
    claimable,
    growthTarget,
    tokenReserve,
    completionTolerance,
    minimumNativeLiquidityForCompletion,
    totalCreatorFeesReceived,
    totalNativeAllocatedToGrowth,
    totalRewardFeesReceived,
    deferredRewardFees,
    totalRewardFeesClaimed,
    pendingGrowthNative,
    totalNativeAddedToLiquidity,
    totalTokenAddedToLiquidity,
    growthTargetReached,
    oracleReady,
    workStateRaw,
    factoryRecognized,
    factoryConfigurationHash,
    launcherVault,
    launcherLaunchHash,
    hookPoolConfigRaw,
    automationRegistered,
  ] = await Promise.all([
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "initialized",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "feeHook",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "oracleGuard",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "upstreamVault",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "poolId",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "token",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "creator",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "configurationHash",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "beneficiaryCount",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "beneficiaryAt",
      [0n],
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "shareBpsOf",
      [account],
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "payoutAddressOf",
      [account],
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "claimedBy",
      [account],
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "claimable",
      [account],
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "growthTargetNative",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "tokenReserveTarget",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "completionToleranceNative",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "minimumNativeLiquidityForCompletion",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "totalCreatorFeesReceived",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "totalNativeAllocatedToGrowth",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "totalRewardFeesReceived",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "deferredRewardFees",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "totalRewardFeesClaimed",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "pendingGrowthNative",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "totalNativeAddedToLiquidity",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "totalTokenAddedToLiquidity",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "growthTargetReached",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "oracleReady",
    ),
    read(
      client,
      blockNumber,
      candidate.vaultAddress,
      deepV2GrowthVaultProfileAbi,
      "workState",
    ),
    read(
      client,
      blockNumber,
      release.growthVaultFactory,
      deepV2GrowthVaultFactoryProfileAbi,
      "isFactoryVault",
      [candidate.vaultAddress],
    ),
    read(
      client,
      blockNumber,
      release.growthVaultFactory,
      deepV2GrowthVaultFactoryProfileAbi,
      "configurationHashOf",
      [candidate.vaultAddress],
    ),
    read(
      client,
      blockNumber,
      release.launcher,
      deepV2LaunchProfileAbi,
      "growthVaultOf",
      [candidate.tokenAddress],
    ),
    read(
      client,
      blockNumber,
      release.launcher,
      deepV2LaunchProfileAbi,
      "launchHashOf",
      [candidate.tokenAddress],
    ),
    read(
      client,
      blockNumber,
      release.feeHook,
      deepV2FeeHookProfileAbi,
      "poolFeeConfig",
      [candidate.poolId],
    ),
    read(
      client,
      blockNumber,
      release.automation,
      deepV2AutomationProfileAbi,
      "isRegisteredVault",
      [candidate.vaultAddress],
    ),
  ]);

  const workState = tuple(workStateRaw, 6, "Deep V2 work state").map(
    (value, index) => uint(value, `Deep V2 work state ${index}`),
  ) as unknown as CanonicalVaultState["workState"];
  const hookPoolConfig = tuple(
    hookPoolConfigRaw,
    6,
    "Deep V2 hook pool configuration",
  );
  return {
    initialized: bool(initialized, "Deep V2 initialization status"),
    feeHook: address(feeHook, "Deep V2 vault hook"),
    oracleGuard: address(oracleGuard, "Deep V2 vault oracle guard"),
    upstreamVault: address(upstreamVault, "Deep V2 upstream vault"),
    poolId: bytes32(poolId, "Deep V2 vault PoolId"),
    token: address(token, "Deep V2 vault token"),
    creator: address(creator, "Deep V2 vault creator"),
    configurationHash: bytes32(
      configurationHash,
      "Deep V2 vault configuration hash",
    ),
    beneficiaryCount: uint(
      beneficiaryCount,
      "Deep V2 beneficiary count",
    ),
    beneficiary: address(beneficiary, "Deep V2 beneficiary"),
    shareBps: uint(shareBps, "Deep V2 beneficiary share"),
    payoutAddress: address(payoutAddress, "Deep V2 payout address"),
    claimed: uint(claimed, "Deep V2 claimed rewards"),
    claimable: uint(claimable, "Deep V2 claimable rewards"),
    growthTarget: uint(growthTarget, "Deep V2 growth target"),
    tokenReserve: uint(tokenReserve, "Deep V2 token reserve"),
    completionTolerance: uint(
      completionTolerance,
      "Deep V2 completion tolerance",
    ),
    minimumNativeLiquidityForCompletion: uint(
      minimumNativeLiquidityForCompletion,
      "Deep V2 minimum completion liquidity",
    ),
    totalCreatorFeesReceived: uint(
      totalCreatorFeesReceived,
      "Deep V2 creator fees received",
    ),
    totalNativeAllocatedToGrowth: uint(
      totalNativeAllocatedToGrowth,
      "Deep V2 native allocated to growth",
    ),
    totalRewardFeesReceived: uint(
      totalRewardFeesReceived,
      "Deep V2 reward fees received",
    ),
    deferredRewardFees: uint(
      deferredRewardFees,
      "Deep V2 deferred reward fees",
    ),
    totalRewardFeesClaimed: uint(
      totalRewardFeesClaimed,
      "Deep V2 reward fees claimed",
    ),
    pendingGrowthNative: uint(
      pendingGrowthNative,
      "Deep V2 pending growth",
    ),
    totalNativeAddedToLiquidity: uint(
      totalNativeAddedToLiquidity,
      "Deep V2 native liquidity growth",
    ),
    totalTokenAddedToLiquidity: uint(
      totalTokenAddedToLiquidity,
      "Deep V2 token liquidity growth",
    ),
    growthTargetReached: bool(
      growthTargetReached,
      "Deep V2 growth target status",
    ),
    oracleReady: bool(oracleReady, "Deep V2 oracle status"),
    workState,
    factoryRecognized: bool(
      factoryRecognized,
      "Deep V2 factory vault status",
    ),
    factoryConfigurationHash: bytes32(
      factoryConfigurationHash,
      "Deep V2 factory configuration hash",
    ),
    launcherVault: address(launcherVault, "Deep V2 launcher vault"),
    launcherLaunchHash: bytes32(
      launcherLaunchHash,
      "Deep V2 launcher launch hash",
    ),
    hookPoolConfig: [
      address(hookPoolConfig[0], "Deep V2 hook reward vault"),
      address(hookPoolConfig[1], "Deep V2 hook registrar"),
      uint(hookPoolConfig[2], "Deep V2 hook buy fee"),
      uint(hookPoolConfig[3], "Deep V2 hook sell fee"),
      bool(hookPoolConfig[4], "Deep V2 hook registration"),
      uint(hookPoolConfig[5], "Deep V2 hook accrued creator fees"),
    ],
    automationRegistered: bool(
      automationRegistered,
      "Deep V2 automation registration",
    ),
  };
}

function assertVaultState(
  state: CanonicalVaultState,
  release: DeepV2ProfileRelease,
  candidate: DeepV2LaunchCandidate,
  account: Address,
) {
  if (
    !state.initialized ||
    !state.factoryRecognized ||
    !state.automationRegistered ||
    state.factoryConfigurationHash.toLowerCase() !==
      candidate.vaultConfigurationHash.toLowerCase() ||
    state.configurationHash.toLowerCase() !==
      candidate.vaultConfigurationHash.toLowerCase() ||
    !sameAddress(state.launcherVault, candidate.vaultAddress) ||
    state.launcherLaunchHash.toLowerCase() !==
      candidate.launchHash.toLowerCase()
  ) {
    throw new Error(
      "The Deep V2 vault is not authenticated by its release automation",
    );
  }
  if (
    !sameAddress(state.feeHook, release.feeHook) ||
    !sameAddress(state.token, candidate.tokenAddress) ||
    state.poolId.toLowerCase() !== candidate.poolId.toLowerCase()
  ) {
    throw new Error("The Deep V2 vault does not match its canonical pool");
  }
  if (
    !sameAddress(state.creator, account) ||
    state.beneficiaryCount !== 1n ||
    !sameAddress(state.beneficiary, account) ||
    state.shareBps !== 10_000n
  ) {
    throw new Error("Deep V2 requires exactly one creator beneficiary");
  }
  const [rewardVault, registrar, buyFee, sellFee, registered, accrued] =
    state.hookPoolConfig;
  if (
    !registered ||
    !sameAddress(rewardVault, state.upstreamVault) ||
    !sameAddress(registrar, release.launcher) ||
    buyFee !== 100n ||
    sellFee !== 100n ||
    accrued !== state.workState[1]
  ) {
    throw new Error("The Deep V2 hook fee configuration is not canonical");
  }
  if (
    state.growthTarget !== GROWTH_TARGET_NATIVE ||
    state.tokenReserve !== TOKEN_RESERVE_TARGET ||
    state.completionTolerance !== COMPLETION_TOLERANCE_NATIVE ||
    state.minimumNativeLiquidityForCompletion !==
      MINIMUM_NATIVE_LIQUIDITY_FOR_COMPLETION ||
    state.totalNativeAllocatedToGrowth > state.growthTarget ||
    state.claimed + state.claimable > state.totalRewardFeesReceived ||
    state.totalRewardFeesClaimed > state.totalRewardFeesReceived ||
    state.pendingGrowthNative !== state.workState[2] ||
    state.workState[0] > 2n
  ) {
    throw new Error("The Deep V2 vault accounting is not canonical");
  }
}

export type DeepV2RewardProfile = {
  status: "ready";
  deepReleaseVersion: "deep-full-range-v2";
  chainId: 1 | 11_155_111;
  account: Address;
  snapshot: {
    blockNumber: string;
    blockHash: Hex;
  };
  reward: {
    tokenAddress: Address;
    vaultAddress: Address;
    oracleGuardAddress: Address;
    upstreamRewardVaultAddress: Address;
    poolId: Hex;
    payoutAddress: Address;
    shareBps: 10_000;
    claimableWei: string;
    claimedWei: string;
    buySwapFeeBps: 100;
    sellSwapFeeBps: 100;
    platformFeeBps: 10;
    growthTargetWei: string;
    tokenReserveRaw: string;
    totalCreatorFeesReceivedWei: string;
    nativeAllocatedToGrowthWei: string;
    nativeAddedToLiquidityWei: string;
    tokenAddedToLiquidityRaw: string;
    pendingGrowthNativeWei: string;
    deferredRewardFeesWei: string;
    totalRewardFeesReceivedWei: string;
    growthTargetReached: boolean;
    oracleReady: boolean;
    automationAction: 0 | 1 | 2;
    nextCompoundTimestamp: string;
    trustedNativeDepthWei: string;
    depthCapNativeWei: string;
    launchTransactionHash: Hex;
  };
};

export async function readDeepV2RewardProfile(
  input: BaseInput,
): Promise<DeepV2RewardProfile> {
  const release = profileRelease(input.manifest, input.chainId);
  const candidate = assertDeepV2LaunchCandidate(
    input.candidate,
    release,
  );
  const account = address(input.account, "Deep V2 profile account");
  if (!sameAddress(account, candidate.creator)) {
    throw new Error("This Deep V2 reward does not belong to the account");
  }
  const snapshot = await confirmedSnapshot(input.clients, input.chainId);
  await assertReleaseRuntime(input.clients, release, snapshot);
  await assertCanonicalLaunch(
    input.clients,
    release,
    candidate,
    snapshot,
  );
  const providerStates = await Promise.all(
    input.clients.map((client) =>
      readVaultState(
        client,
        release,
        candidate,
        account,
        snapshot.blockNumber,
      ),
    ),
  );
  const state = agreement("Deep V2 reward accounting", providerStates);
  assertVaultState(state, release, candidate, account);

  return {
    status: "ready",
    deepReleaseVersion: "deep-full-range-v2",
    chainId: release.chainId,
    account,
    snapshot: {
      blockNumber: snapshot.blockNumber.toString(),
      blockHash: snapshot.blockHash,
    },
    reward: {
      tokenAddress: candidate.tokenAddress,
      vaultAddress: candidate.vaultAddress,
      oracleGuardAddress: state.oracleGuard,
      upstreamRewardVaultAddress: state.upstreamVault,
      poolId: candidate.poolId,
      payoutAddress: state.payoutAddress,
      shareBps: 10_000,
      claimableWei: state.claimable.toString(),
      claimedWei: state.claimed.toString(),
      buySwapFeeBps: 100,
      sellSwapFeeBps: 100,
      platformFeeBps: 10,
      growthTargetWei: state.growthTarget.toString(),
      tokenReserveRaw: state.tokenReserve.toString(),
      totalCreatorFeesReceivedWei:
        state.totalCreatorFeesReceived.toString(),
      nativeAllocatedToGrowthWei:
        state.totalNativeAllocatedToGrowth.toString(),
      nativeAddedToLiquidityWei:
        state.totalNativeAddedToLiquidity.toString(),
      tokenAddedToLiquidityRaw:
        state.totalTokenAddedToLiquidity.toString(),
      pendingGrowthNativeWei: state.pendingGrowthNative.toString(),
      deferredRewardFeesWei: state.deferredRewardFees.toString(),
      totalRewardFeesReceivedWei:
        state.totalRewardFeesReceived.toString(),
      growthTargetReached: state.growthTargetReached,
      oracleReady: state.oracleReady,
      automationAction: Number(state.workState[0]) as 0 | 1 | 2,
      nextCompoundTimestamp: state.workState[3].toString(),
      trustedNativeDepthWei: state.workState[4].toString(),
      depthCapNativeWei: state.workState[5].toString(),
      launchTransactionHash: candidate.transactionHash,
    },
  };
}

export async function prepareDeepV2RewardAction(
  input: BaseInput & {
    action: "claim" | "update-payout";
    newPayoutAddress?: Address;
  },
) {
  const profile = await readDeepV2RewardProfile(input);
  if (input.action === "claim" && BigInt(profile.reward.claimableWei) === 0n) {
    throw new Error("There are no Deep V2 rewards to claim");
  }
  let newPayoutAddress: Address | undefined;
  if (input.action === "update-payout") {
    newPayoutAddress = address(
      input.newPayoutAddress,
      "Deep V2 new payout address",
    );
    if (sameAddress(newPayoutAddress, profile.reward.payoutAddress)) {
      throw new Error("The Deep V2 payout address is unchanged");
    }
  }
  const data = encodeDeepV2RewardAction({
    action: input.action,
    newPayoutAddress,
  });
  const blockNumber = BigInt(profile.snapshot.blockNumber);
  const [simulations, gasEstimates, gasPrices, balances] = await Promise.all([
    Promise.all(
      input.clients.map((client) =>
        client.call({
          account: profile.account,
          to: profile.reward.vaultAddress,
          data,
          value: 0n,
          blockNumber,
        }),
      ),
    ),
    Promise.all(
      input.clients.map((client) =>
        client.estimateGas({
          account: profile.account,
          to: profile.reward.vaultAddress,
          data,
          value: 0n,
          blockNumber,
        }),
      ),
    ),
    Promise.all(input.clients.map((client) => client.getGasPrice())),
    Promise.all(
      input.clients.map((client) =>
        client.getBalance({
          address: profile.account,
          blockNumber,
        }),
      ),
    ),
  ]);
  agreement(
    "Deep V2 reward simulation",
    simulations.map((simulation) => simulation.data ?? "0x"),
  );
  const balance = agreement("Deep V2 beneficiary balance", balances);
  const estimatedGas =
    gasEstimates[0] > gasEstimates[1] ? gasEstimates[0] : gasEstimates[1];
  const gasPrice = gasPrices[0] > gasPrices[1] ? gasPrices[0] : gasPrices[1];
  if (estimatedGas <= 0n || gasPrice <= 0n) {
    throw new Error("The Deep V2 reward gas estimate is invalid");
  }
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;
  if (balance < gasLimit * gasPrice) {
    throw new Error("This wallet needs more ETH for the network fee");
  }
  return {
    status: "ready" as const,
    action: input.action,
    account: profile.account,
    vaultAddress: profile.reward.vaultAddress,
    deepReleaseVersion: "deep-full-range-v2" as const,
    transaction: {
      kind:
        input.action === "claim"
          ? ("claim-deep-rewards" as const)
          : ("update-deep-payout" as const),
      chainId: profile.chainId,
      from: profile.account,
      to: profile.reward.vaultAddress,
      data,
      value: "0" as const,
      gasLimit: gasLimit.toString(),
    },
  };
}
