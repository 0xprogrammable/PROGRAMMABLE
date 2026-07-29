import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  keccak256,
  type Address,
  type AbiEvent,
  type GetLogsReturnType,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import appDeployments from "../../contracts/config/app-deployments.v1.json";
import {
  deepAutomationReadAbi,
  deepConfiguredEvent,
  deepGrowthVaultFactoryReadAbi,
  deepGrowthVaultReadAbi,
  deepHookReadAbi,
  deepInitialBuyEvent,
  deepNativeSwapFeesAccruedEvent,
  deepTokenLaunchedEvent,
  DEEP_COMPLETION_TOLERANCE_WEI,
  DEEP_FULL_RANGE_TICK_LOWER,
  DEEP_FULL_RANGE_TICK_UPPER,
  DEEP_INITIAL_TICK,
  DEEP_MAX_SPOT_TWAP_DEVIATION_TICKS,
  DEEP_MINIMUM_NATIVE_LIQUIDITY_FOR_COMPLETION_WEI,
  DEEP_TOKEN_SUPPLY_WHOLE,
  DEEP_TWAP_WINDOW_SECONDS,
} from "../deep-v1";
import {
  DEEP_GROWTH_TARGET_WEI,
  DEEP_TOKEN_RESERVE_WHOLE,
} from "../launch";
import {
  getVerifiedDeepRelease,
  type DeepLaunchModelRelease,
  type LaunchModelReleaseManifest,
} from "../launch-model-gating";
import type { LauncherToken } from "../tokens";
import { stateViewReadAbi, uerc20ReadAbi } from "./abis";
import {
  marketCapNativeWadFromSqrtPriceX96,
  nativePriceWadFromSqrtPriceX96,
} from "./math";
import { buildTokenLinks, sanitizeImageUrl } from "./metadata";
import type {
  ExploreReadModel,
  ExploreSnapshot,
  OnchainDeployment,
} from "./types";

const CONFIRMATIONS = 12n;
const LOG_RANGE = 10_000n;
const DEEP_TOKEN_SUPPLY_RAW =
  BigInt(DEEP_TOKEN_SUPPLY_WHOLE) * 10n ** 18n;
const DEEP_TOKEN_RESERVE_RAW =
  BigInt(DEEP_TOKEN_RESERVE_WHOLE) * 10n ** 18n;

type VerifiedDeepRelease = DeepLaunchModelRelease & {
  launcher: Address;
  feeHook: Address;
  growthVaultFactory: Address;
  automation: Address;
  deploymentBlock: number;
  runtimeCodeHashes: Record<string, Hex>;
};

type DeepLaunchBundle = {
  launch: {
    deployer: Address;
    token: Address;
    poolId: Hex;
    feeHook: Address;
    growthVault: Address;
    oracleGuard: Address;
    upstreamRewardVault: Address;
    positionRecipient: Address;
    positionTokenId: bigint;
    buySwapFeeBps: number;
    sellSwapFeeBps: number;
    vaultConfigurationHash: Hex;
    launchHash: Hex;
    blockNumber: bigint;
    transactionHash: Hex;
    transactionIndex: number;
    logIndex: number;
  };
  configuration: {
    totalSupply: bigint;
    tokenReserve: bigint;
    tokenLiquidityAmount: bigint;
    lockedTokenDust: bigint;
    nativeTarget: bigint;
    tickLower: number;
    tickUpper: number;
    twapWindow: number;
    maxSpotTwapDeviationTicks: number;
  };
  initialBuy: {
    nativeAmount: bigint;
    tokenAmount: bigint;
  };
};

type DeepVolume = {
  grossNativeAmount: bigint;
  creatorFees: bigint;
  launcherFees: bigint;
  swapCount: number;
};

type DeepIndexedEvents = {
  bundles: DeepLaunchBundle[];
  volumes: Map<string, DeepVolume>;
};

const ZERO_VOLUME: DeepVolume = {
  grossNativeAmount: 0n,
  creatorFees: 0n,
  launcherFees: 0n,
  swapCount: 0,
};

function environmentFor(config: OnchainDeployment) {
  return config.environment === "rehearsal" ? "rehearsal" : "production";
}

function verifiedReleaseFor(config: OnchainDeployment) {
  const environment = environmentFor(config);
  const manifest = appDeployments[
    environment
  ] as unknown as LaunchModelReleaseManifest;
  return getVerifiedDeepRelease(manifest, config.chainId) as
    | VerifiedDeepRelease
    | null;
}

export function isDeepExploreReleaseReady(config: OnchainDeployment) {
  return verifiedReleaseFor(config) !== null;
}

function createClient(config: OnchainDeployment, rpcUrl: string) {
  return createPublicClient({
    chain: config.chainId === 1 ? mainnet : sepolia,
    batch: { multicall: true },
    transport: http(rpcUrl, { retryCount: 2, timeout: 12_000 }),
  });
}

function minimum(left: bigint, right: bigint) {
  return left < right ? left : right;
}

async function assertRuntimeCode(
  client: PublicClient,
  address: Address,
  expectedHash: Hex,
  blockNumber: bigint,
  label: string,
) {
  const code = await client.getCode({ address, blockNumber });
  if (!code || code === "0x" || keccak256(code) !== expectedHash) {
    throw new Error(`${label} runtime code does not match the Deep release`);
  }
}

function releaseRuntimeEntries(release: VerifiedDeepRelease) {
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
  ] as const;
  return fields.map((field) => ({
    field,
    address: getAddress(release[field] as string),
    hash: release.runtimeCodeHashes[field] as Hex,
  }));
}

async function getLogsInRanges<const Event extends AbiEvent>(
  client: PublicClient,
  input: {
    address: Address;
    event: Event;
    fromBlock: bigint;
    toBlock: bigint;
  },
): Promise<
  GetLogsReturnType<
    Event,
    Event extends AbiEvent ? [Event] : undefined,
    true,
    bigint,
    bigint
  >
> {
  const logs: GetLogsReturnType<
    Event,
    Event extends AbiEvent ? [Event] : undefined,
    true,
    bigint,
    bigint
  > = [];
  for (
    let rangeStart = input.fromBlock;
    rangeStart <= input.toBlock;
    rangeStart += LOG_RANGE
  ) {
    logs.push(
      ...(await client.getLogs({
        address: input.address,
        event: input.event,
        fromBlock: rangeStart,
        toBlock: minimum(input.toBlock, rangeStart + LOG_RANGE - 1n),
        strict: true,
      })),
    );
  }
  return logs;
}

export function deepAtomicEventKey(
  transactionHash: Hex,
  token: Address,
  launchHash: Hex,
) {
  return [
    transactionHash.toLowerCase(),
    token.toLowerCase(),
    launchHash.toLowerCase(),
  ].join(":");
}

function atomicEventKey(log: {
  transactionHash: Hex | null;
  blockNumber: bigint | null;
  args: { token: Address; launchHash: Hex };
}) {
  if (!log.transactionHash || log.blockNumber === null) {
    throw new Error("Deep event is missing confirmed transaction data");
  }
  return deepAtomicEventKey(
    log.transactionHash,
    log.args.token,
    log.args.launchHash,
  );
}

async function indexDeepEvents(
  client: PublicClient,
  release: VerifiedDeepRelease,
  toBlock: bigint,
): Promise<DeepIndexedEvents> {
  const fromBlock = BigInt(release.deploymentBlock);
  if (fromBlock > toBlock) return { bundles: [], volumes: new Map() };
  const [launchLogs, configurationLogs, initialBuyLogs, feeLogs] =
    await Promise.all([
      getLogsInRanges(client, {
        address: release.launcher,
        event: deepTokenLaunchedEvent,
        fromBlock,
        toBlock,
      }),
      getLogsInRanges(client, {
        address: release.launcher,
        event: deepConfiguredEvent,
        fromBlock,
        toBlock,
      }),
      getLogsInRanges(client, {
        address: release.launcher,
        event: deepInitialBuyEvent,
        fromBlock,
        toBlock,
      }),
      getLogsInRanges(client, {
        address: release.feeHook,
        event: deepNativeSwapFeesAccruedEvent,
        fromBlock,
        toBlock,
      }),
    ]);

  const configurations = new Map(
    configurationLogs
      .filter((log) => !log.removed && log.blockNumber !== null)
      .map((log) => [atomicEventKey(log), log]),
  );
  const initialBuys = new Map(
    initialBuyLogs
      .filter((log) => !log.removed && log.blockNumber !== null)
      .map((log) => [atomicEventKey(log), log]),
  );
  const bundles = launchLogs
    .filter((log) => !log.removed && log.blockNumber !== null)
    .map((log) => {
      const configuration = configurations.get(atomicEventKey(log));
      const initialBuy = initialBuys.get(atomicEventKey(log));
      if (
        !configuration ||
        !initialBuy ||
        configuration.args.token.toLowerCase() !==
          log.args.token.toLowerCase() ||
        initialBuy.args.token.toLowerCase() !==
          log.args.token.toLowerCase() ||
        initialBuy.args.poolId !== log.args.poolId ||
        configuration.args.launchHash !== log.args.launchHash ||
        initialBuy.args.launchHash !== log.args.launchHash
      ) {
        throw new Error("Deep launch events do not form one atomic record");
      }
      return {
        launch: {
          deployer: getAddress(log.args.deployer),
          token: getAddress(log.args.token),
          poolId: log.args.poolId,
          feeHook: getAddress(log.args.feeHook),
          growthVault: getAddress(log.args.growthVault),
          oracleGuard: getAddress(log.args.oracleGuard),
          upstreamRewardVault: getAddress(log.args.upstreamRewardVault),
          positionRecipient: getAddress(log.args.positionRecipient),
          positionTokenId: log.args.positionTokenId,
          buySwapFeeBps: log.args.buySwapFeeBps,
          sellSwapFeeBps: log.args.sellSwapFeeBps,
          vaultConfigurationHash: log.args.vaultConfigurationHash,
          launchHash: log.args.launchHash,
          blockNumber: log.blockNumber as bigint,
          transactionHash: log.transactionHash,
          transactionIndex: log.transactionIndex,
          logIndex: log.logIndex,
        },
        configuration: {
          totalSupply: configuration.args.totalSupply,
          tokenReserve: configuration.args.tokenReserve,
          tokenLiquidityAmount: configuration.args.tokenLiquidityAmount,
          lockedTokenDust: configuration.args.lockedTokenDust,
          nativeTarget: configuration.args.nativeTarget,
          tickLower: configuration.args.tickLower,
          tickUpper: configuration.args.tickUpper,
          twapWindow: configuration.args.twapWindow,
          maxSpotTwapDeviationTicks:
            configuration.args.maxSpotTwapDeviationTicks,
        },
        initialBuy: {
          nativeAmount: initialBuy.args.nativeAmount,
          tokenAmount: initialBuy.args.tokenAmount,
        },
      } satisfies DeepLaunchBundle;
    });

  if (
    configurations.size !== bundles.length ||
    initialBuys.size !== bundles.length
  ) {
    throw new Error("Deep launch events contain unmatched records");
  }

  const volumes = new Map<string, DeepVolume>();
  for (const log of feeLogs) {
    if (log.removed) continue;
    const key = log.args.poolId.toLowerCase();
    const current = volumes.get(key) ?? ZERO_VOLUME;
    volumes.set(key, {
      grossNativeAmount:
        current.grossNativeAmount + log.args.grossNativeAmount,
      creatorFees: current.creatorFees + log.args.creatorFee,
      launcherFees: current.launcherFees + log.args.launcherFee,
      swapCount: current.swapCount + 1,
    });
  }
  return { bundles, volumes };
}

function eventFingerprint(events: DeepIndexedEvents) {
  return JSON.stringify(
    {
      bundles: events.bundles,
      volumes: [...events.volumes.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    },
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
  );
}

async function hydrateDeepToken(
  client: PublicClient,
  config: OnchainDeployment,
  release: VerifiedDeepRelease,
  bundle: DeepLaunchBundle,
  volume: DeepVolume,
  blockTimestamp: bigint,
  snapshotBlock: bigint,
): Promise<LauncherToken> {
  const { launch, configuration } = bundle;
  const [
    name,
    symbol,
    decimals,
    totalSupply,
    tokenCreator,
    metadata,
    slot0,
    activeLiquidity,
    feeDisclosure,
    poolConfig,
    factoryVault,
    vaultHook,
    vaultPoolId,
    vaultToken,
    vaultOracleGuard,
    upstreamVault,
    vaultConfigurationHash,
    growthTarget,
    completionTolerance,
    minimumNativeLiquidityForCompletion,
    tokenReserve,
    nativeAllocated,
    nativeAdded,
    pendingGrowth,
    deferredRewardFees,
    growthTargetReached,
    oracleReady,
    workState,
    automationAction,
  ] = await Promise.all([
    client.readContract({
      address: launch.token,
      abi: uerc20ReadAbi,
      functionName: "name",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.token,
      abi: uerc20ReadAbi,
      functionName: "symbol",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.token,
      abi: uerc20ReadAbi,
      functionName: "decimals",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.token,
      abi: uerc20ReadAbi,
      functionName: "totalSupply",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.token,
      abi: uerc20ReadAbi,
      functionName: "creator",
      blockNumber: snapshotBlock,
    }),
    client
      .readContract({
        address: launch.token,
        abi: uerc20ReadAbi,
        functionName: "metadata",
        blockNumber: snapshotBlock,
      })
      .catch(() => null),
    client.readContract({
      address: config.stateView,
      abi: stateViewReadAbi,
      functionName: "getSlot0",
      args: [launch.poolId],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: config.stateView,
      abi: stateViewReadAbi,
      functionName: "getLiquidity",
      args: [launch.poolId],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.feeHook,
      abi: deepHookReadAbi,
      functionName: "feeDisclosure",
      args: [launch.poolId],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.feeHook,
      abi: deepHookReadAbi,
      functionName: "poolFeeConfig",
      args: [launch.poolId],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.growthVaultFactory,
      abi: deepGrowthVaultFactoryReadAbi,
      functionName: "isFactoryVault",
      args: [launch.growthVault],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "feeHook",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "poolId",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "token",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "oracleGuard",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "upstreamVault",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "configurationHash",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "growthTargetNative",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "completionToleranceNative",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "minimumNativeLiquidityForCompletion",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "tokenReserveTarget",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "totalNativeAllocatedToGrowth",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "totalNativeAddedToLiquidity",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "pendingGrowthNative",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "deferredRewardFees",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "growthTargetReached",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "oracleReady",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepGrowthVaultReadAbi,
      functionName: "workState",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.automation,
      abi: deepAutomationReadAbi,
      functionName: "checkVault",
      args: [launch.growthVault],
      blockNumber: snapshotBlock,
    }),
  ]);
  const [sqrtPriceX96, currentTick, protocolFeePips, lpFeePips] = slot0;
  const buyCreatorFeeBps = feeDisclosure[2];
  const sellCreatorFeeBps = feeDisclosure[3];
  if (
    launch.feeHook !== release.feeHook ||
    getAddress(tokenCreator) !== release.launcher ||
    decimals !== 18 ||
    totalSupply !== DEEP_TOKEN_SUPPLY_RAW ||
    configuration.totalSupply !== totalSupply ||
    configuration.tokenReserve !== DEEP_TOKEN_RESERVE_RAW ||
    configuration.nativeTarget !== DEEP_GROWTH_TARGET_WEI ||
    configuration.tickLower !== DEEP_FULL_RANGE_TICK_LOWER ||
    configuration.tickUpper !== DEEP_FULL_RANGE_TICK_UPPER ||
    configuration.twapWindow !== DEEP_TWAP_WINDOW_SECONDS ||
    configuration.maxSpotTwapDeviationTicks !==
      DEEP_MAX_SPOT_TWAP_DEVIATION_TICKS ||
    !factoryVault ||
    getAddress(vaultHook) !== release.feeHook ||
    vaultPoolId !== launch.poolId ||
    getAddress(vaultToken) !== launch.token ||
    getAddress(vaultOracleGuard) !== launch.oracleGuard ||
    getAddress(upstreamVault) !== launch.upstreamRewardVault ||
    vaultConfigurationHash !== launch.vaultConfigurationHash ||
    growthTarget !== DEEP_GROWTH_TARGET_WEI ||
    completionTolerance !== DEEP_COMPLETION_TOLERANCE_WEI ||
    minimumNativeLiquidityForCompletion !==
      DEEP_MINIMUM_NATIVE_LIQUIDITY_FOR_COMPLETION_WEI ||
    tokenReserve !== DEEP_TOKEN_RESERVE_RAW ||
    workState[2] !== pendingGrowth ||
    workState[0] > 2 ||
    automationAction > 3 ||
    feeDisclosure[0] !== launch.buySwapFeeBps ||
    feeDisclosure[1] !== launch.sellSwapFeeBps ||
    buyCreatorFeeBps + feeDisclosure[4] !== feeDisclosure[0] ||
    sellCreatorFeeBps + feeDisclosure[4] !== feeDisclosure[1] ||
    feeDisclosure[4] !== 10 ||
    feeDisclosure[5] !== 0 ||
    feeDisclosure[6] !== 0 ||
    getAddress(feeDisclosure[7]) !== launch.upstreamRewardVault ||
    getAddress(poolConfig[0]) !== launch.upstreamRewardVault ||
    getAddress(poolConfig[1]) !== release.launcher ||
    poolConfig[2] !== launch.buySwapFeeBps ||
    poolConfig[3] !== launch.sellSwapFeeBps ||
    !poolConfig[4] ||
    lpFeePips !== 0
  ) {
    throw new Error(`Deep launch provenance mismatch for ${launch.token}`);
  }

  const tokenPriceEthWei = nativePriceWadFromSqrtPriceX96(
    sqrtPriceX96,
    decimals,
  );
  const marketCapEthWei = marketCapNativeWadFromSqrtPriceX96(
    totalSupply,
    sqrtPriceX96,
  );
  const description = metadata?.[0]?.trim() || undefined;
  const website = metadata?.[1] ?? "";
  const image = metadata?.[2] ?? "";
  const extraData = metadata?.[3] ?? "0x";

  return {
    id: `${config.chainId}:${launch.token.toLowerCase()}`,
    name,
    symbol,
    description,
    imageUrl: sanitizeImageUrl(image) ?? undefined,
    links: buildTokenLinks(website, extraData),
    tokenAddress: launch.token,
    hookAddress: release.feeHook,
    poolId: launch.poolId,
    creatorAddress: launch.deployer,
    positionRecipient: launch.positionRecipient,
    positionTokenId: launch.positionTokenId.toString(),
    launchHash: launch.launchHash,
    launchBlockNumber: launch.blockNumber.toString(),
    launchTransactionHash: launch.transactionHash,
    launchTransactionIndex: launch.transactionIndex,
    launchLogIndex: launch.logIndex,
    launchedAt: new Date(Number(blockTimestamp) * 1_000).toISOString(),
    totalSupply: formatUnits(totalSupply, decimals),
    totalSupplyRaw: totalSupply.toString(),
    tokenDecimals: decimals,
    tokenLiquidityAmountRaw:
      configuration.tokenLiquidityAmount.toString(),
    lockedTokenDustRaw: configuration.lockedTokenDust.toString(),
    tokenPriceEth: formatUnits(tokenPriceEthWei, 18),
    tokenPriceEthWei: tokenPriceEthWei.toString(),
    marketCapEth: formatUnits(marketCapEthWei, 18),
    marketCapEthWei: marketCapEthWei.toString(),
    grossVolumeEth: formatUnits(volume.grossNativeAmount, 18),
    grossVolumeWei: volume.grossNativeAmount.toString(),
    creatorFeesGeneratedEth: formatUnits(volume.creatorFees, 18),
    creatorFeesGeneratedWei: volume.creatorFees.toString(),
    launcherFeesGeneratedEth: formatUnits(volume.launcherFees, 18),
    launcherFeesGeneratedWei: volume.launcherFees.toString(),
    creatorFeesAccruedEth: formatUnits(poolConfig[5], 18),
    creatorFeesAccruedWei: poolConfig[5].toString(),
    swapCount: volume.swapCount,
    currentTick,
    initialTick: DEEP_INITIAL_TICK,
    tickLower: configuration.tickLower,
    tickUpper: configuration.tickUpper,
    activeLiquidity: activeLiquidity.toString(),
    protocolFeePips,
    lpFeePips,
    buyHookFeeBps: feeDisclosure[0],
    sellHookFeeBps: feeDisclosure[1],
    creatorFeeBps:
      buyCreatorFeeBps === sellCreatorFeeBps
        ? buyCreatorFeeBps
        : undefined,
    buyCreatorFeeBps,
    sellCreatorFeeBps,
    launcherFeeBps: feeDisclosure[4],
    transferTaxBps: feeDisclosure[5],
    totalSwapFeeBps: Math.max(feeDisclosure[0], feeDisclosure[1]),
    launchModel: "deep",
    deepReleaseVersion: "deep-full-range-v1",
    growthVaultAddress: launch.growthVault,
    oracleGuardAddress: launch.oracleGuard,
    upstreamRewardVaultAddress: launch.upstreamRewardVault,
    growthTargetNativeWei: growthTarget.toString(),
    completionToleranceNativeWei: completionTolerance.toString(),
    minimumNativeLiquidityForCompletionWei:
      minimumNativeLiquidityForCompletion.toString(),
    tokenReserveRaw: tokenReserve.toString(),
    totalNativeAllocatedToGrowthWei: nativeAllocated.toString(),
    totalNativeAddedToLiquidityWei: nativeAdded.toString(),
    pendingGrowthNativeWei: pendingGrowth.toString(),
    deferredRewardFeesWei: deferredRewardFees.toString(),
    growthTargetReached,
    oracleReady,
    automationAction: automationAction as 0 | 1 | 2 | 3,
    nextCompoundTimestamp: workState[3].toString(),
    trustedNativeDepthWei: workState[4].toString(),
    depthCapNativeWei: workState[5].toString(),
    automationGuaranteed: false,
    liquidityPath: "meme",
    metadataExtraData: extraData,
  };
}

function emptyDeepModel(snapshot: ExploreSnapshot): ExploreReadModel {
  return {
    status: "ready",
    tokens: [],
    snapshot,
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}

export async function readDeepExploreModel(
  config: OnchainDeployment,
  snapshotBlockInput?: string,
): Promise<ExploreReadModel | null> {
  const release = verifiedReleaseFor(config);
  if (!release || config.status !== "ready") return null;
  const rpcUrls = [
    config.rpcUrl,
    ...(config.rpcUrlSecondary ? [config.rpcUrlSecondary] : []),
  ];
  const clients = rpcUrls.map((rpcUrl) => createClient(config, rpcUrl));
  const chainStates = await Promise.all(
    clients.map(async (client) => ({
      chainId: await client.getChainId(),
      head: await client.getBlockNumber(),
    })),
  );
  if (chainStates.some((state) => state.chainId !== config.chainId)) {
    throw new Error("Deep RPC chain does not match the release manifest");
  }
  const lowestHead = chainStates.reduce(
    (lowest, state) => minimum(lowest, state.head),
    chainStates[0].head,
  );
  const snapshotBlockNumber = snapshotBlockInput
    ? BigInt(snapshotBlockInput)
    : lowestHead > CONFIRMATIONS
      ? lowestHead - CONFIRMATIONS
      : 0n;
  if (snapshotBlockNumber > lowestHead) {
    throw new Error("Deep snapshot is ahead of the available RPC head");
  }
  const blocks = await Promise.all(
    clients.map((client) =>
      client.getBlock({ blockNumber: snapshotBlockNumber }),
    ),
  );
  const snapshotBlock = blocks[0];
  if (
    !snapshotBlock.hash ||
    blocks.some(
      (block) =>
        !block.hash ||
        block.hash.toLowerCase() !== snapshotBlock.hash?.toLowerCase(),
    )
  ) {
    throw new Error("Independent RPCs disagree on the Deep snapshot");
  }
  const snapshot: ExploreSnapshot = {
    chainId: config.chainId,
    blockNumber: snapshotBlockNumber.toString(),
    blockHash: snapshotBlock.hash,
    confirmations: Number(CONFIRMATIONS),
  };
  if (snapshotBlockNumber < BigInt(release.deploymentBlock)) {
    return emptyDeepModel(snapshot);
  }

  await Promise.all(
    clients.flatMap((client) => [
      ...releaseRuntimeEntries(release).map((entry) =>
        assertRuntimeCode(
          client,
          entry.address,
          entry.hash,
          snapshotBlockNumber,
          `Deep ${entry.field}`,
        ),
      ),
      assertRuntimeCode(
        client,
        config.stateView,
        config.stateViewRuntimeCodeHash,
        snapshotBlockNumber,
        "Uniswap StateView",
      ),
    ]),
  );
  const [eventSets, launcherFees] = await Promise.all([
    Promise.all(
      clients.map((client) =>
        indexDeepEvents(client, release, snapshotBlockNumber),
      ),
    ),
    Promise.all(
      clients.map((client) =>
        client.readContract({
          address: release.feeHook,
          abi: deepHookReadAbi,
          functionName: "launcherFeesAccrued",
          blockNumber: snapshotBlockNumber,
        }),
      ),
    ),
  ]);
  const fingerprint = eventFingerprint(eventSets[0]);
  if (
    eventSets.some((events) => eventFingerprint(events) !== fingerprint) ||
    launcherFees.some((value) => value !== launcherFees[0])
  ) {
    throw new Error(
      "Independent RPCs disagree on Deep events or fee accounting",
    );
  }
  const events = eventSets[0];
  const blockNumbers = [
    ...new Set(events.bundles.map(({ launch }) => launch.blockNumber.toString())),
  ].map(BigInt);
  const blockTimestamps = new Map<string, bigint>();
  await Promise.all(
    blockNumbers.map(async (blockNumber) => {
      const block = await clients[0].getBlock({ blockNumber });
      blockTimestamps.set(blockNumber.toString(), block.timestamp);
    }),
  );
  const tokenSets = await Promise.all(
    clients.map((client) =>
      Promise.all(
        events.bundles.map((bundle) =>
          hydrateDeepToken(
            client,
            config,
            release,
            bundle,
            events.volumes.get(bundle.launch.poolId.toLowerCase()) ??
              ZERO_VOLUME,
            blockTimestamps.get(bundle.launch.blockNumber.toString()) ?? 0n,
            snapshotBlockNumber,
          ),
        ),
      ),
    ),
  );
  const tokenFingerprint = JSON.stringify(tokenSets[0]);
  if (
    tokenSets.some(
      (candidate) => JSON.stringify(candidate) !== tokenFingerprint,
    )
  ) {
    throw new Error("Independent RPCs disagree on Deep token state");
  }
  return {
    status: "ready",
    tokens: tokenSets[0],
    snapshot,
    creatorClaims: [],
    launcherFeesAccruedWei: launcherFees[0].toString(),
    launcherFeesAccruedEth: formatUnits(launcherFees[0], 18),
  };
}

export function mergeDeepExploreModel(
  classic: ExploreReadModel,
  deep: ExploreReadModel | null,
): ExploreReadModel {
  if (!deep) return classic;
  if (
    classic.status !== "ready" ||
    deep.status !== "ready" ||
    classic.snapshot.chainId !== deep.snapshot.chainId ||
    classic.snapshot.blockNumber !== deep.snapshot.blockNumber ||
    classic.snapshot.blockHash.toLowerCase() !==
      deep.snapshot.blockHash.toLowerCase()
  ) {
    throw new Error("Classic and Deep registries do not share one snapshot");
  }
  const tokens = [...classic.tokens, ...deep.tokens];
  const unique = new Set(tokens.map((token) => token.tokenAddress.toLowerCase()));
  if (unique.size !== tokens.length) {
    throw new Error("Classic and Deep registries contain the same token");
  }
  const launcherFees =
    BigInt(classic.launcherFeesAccruedWei) +
    BigInt(deep.launcherFeesAccruedWei);
  return {
    status: "ready",
    tokens,
    snapshot: classic.snapshot,
    creatorClaims: classic.creatorClaims,
    launcherFeesAccruedWei: launcherFees.toString(),
    launcherFeesAccruedEth: formatUnits(launcherFees, 18),
  };
}
