import {
  createPublicClient,
  formatUnits,
  getAddress,
  HttpRequestError,
  http,
  keccak256,
  LimitExceededRpcError,
  parseAbiItem,
  ResponseBodyTooLargeError,
  TimeoutError,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import {
  classicRewardVaultAbi,
  classicRewardVaultFactoryAbi,
  classicV3HookAbi,
} from "../classic-v3";
import {
  getConfiguredClassicV3Release,
  isClassicV3ReleaseVerified,
} from "../classic-v3-release";
import type { LauncherToken } from "../tokens";
import { stateViewReadAbi, uerc20ReadAbi } from "./abis";
import {
  marketCapNativeWadFromSqrtPriceX96,
  nativePriceWadFromSqrtPriceX96,
} from "./math";
import { buildTokenLinks, sanitizeImageUrl } from "./metadata";
import type { ExploreReadModel, ReadyOnchainDeployment } from "./types";

const launchedEvent = parseAbiItem(
  "event MemeTokenLaunchedV2(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address rewardVault,address positionRecipient,uint256 positionTokenId,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 rewardConfigurationHash,bytes32 launchHash)",
);
const feeEvent = parseAbiItem(
  "event NativeSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,bool indexed isBuy,uint16 appliedTotalSwapFeeBps,uint256 grossNativeAmount,uint256 creatorFee,uint256 launcherFee)",
);

export type ClassicV3Release = {
  launcher: Address;
  hook: Address;
  rewardVaultFactory: Address;
  launcherRuntimeCodeHash: Hex;
  hookRuntimeCodeHash: Hex;
  rewardVaultFactoryRuntimeCodeHash: Hex;
  startBlock: bigint;
};

type LaunchRecord = {
  deployer: Address;
  token: Address;
  poolId: Hex;
  feeHook: Address;
  rewardVault: Address;
  positionRecipient: Address;
  positionTokenId: bigint;
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  rewardConfigurationHash: Hex;
  launchHash: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
};

type FeeVolume = {
  grossNativeAmount: bigint;
  creatorFees: bigint;
  launcherFees: bigint;
  swapCount: number;
};

export type ClassicV3ExploreSlice = {
  tokens: LauncherToken[];
  launcherFeesAccrued: bigint;
};

const EMPTY_VOLUME: FeeVolume = {
  grossNativeAmount: 0n,
  creatorFees: 0n,
  launcherFees: 0n,
  swapCount: 0,
};

const RPC_PROVENANCE_BATCH_SIZE = 1;
const TOKEN_HYDRATION_BATCH_SIZE = 6;
const BLOCK_TIMESTAMP_BATCH_SIZE = 4;
const MINIMUM_LOG_BLOCK_RANGE = 100n;

function minimum(left: bigint, right: bigint) {
  return left < right ? left : right;
}

async function mapInBatches<Input, Output>(
  values: readonly Input[],
  batchSize: number,
  mapper: (value: Input) => Promise<Output>,
) {
  const output: Output[] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    output.push(
      ...(await Promise.all(
        values.slice(index, index + batchSize).map(mapper),
      )),
    );
  }
  return output;
}

async function allSettledOrThrow<
  const Values extends readonly unknown[],
>(
  values: Values,
): Promise<{ -readonly [Key in keyof Values]: Awaited<Values[Key]> }> {
  const results = await Promise.allSettled(values);
  const failure = results.find(
    (result): result is PromiseRejectedResult =>
      result.status === "rejected",
  );
  if (failure) throw failure.reason;
  return results.map(
    (result) => (result as PromiseFulfilledResult<unknown>).value,
  ) as { -readonly [Key in keyof Values]: Awaited<Values[Key]> };
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function clientFor(config: ReadyOnchainDeployment, endpoint: string) {
  return createPublicClient({
    chain: config.chainId === 1 ? mainnet : sepolia,
    batch: { multicall: true },
    transport: http(endpoint, { retryCount: 1, timeout: 10_000 }),
  });
}

function resolveClassicV3Release(
  config: ReadyOnchainDeployment,
): ClassicV3Release | null {
  const configured = getConfiguredClassicV3Release(config.environment);
  const { appManifest, releaseManifest } = configured;
  if (
    configured.chainId !== config.chainId ||
    !isClassicV3ReleaseVerified(
      appManifest,
      releaseManifest,
      config.chainId,
    )
  ) {
    return null;
  }
  const startBlock = appManifest.deploymentBlocks?.memeLaunchV2;
  if (!Number.isSafeInteger(startBlock) || (startBlock ?? -1) < 0) return null;
  return {
    launcher: getAddress(appManifest.memeLaunchV2 as string),
    hook: getAddress(appManifest.ethCreatorFeeHookV3 as string),
    rewardVaultFactory: getAddress(
      appManifest.classicRewardVaultFactoryV1 as string,
    ),
    launcherRuntimeCodeHash:
      appManifest.runtimeCodeHashes?.memeLaunchV2 as Hex,
    hookRuntimeCodeHash:
      appManifest.runtimeCodeHashes?.ethCreatorFeeHookV3 as Hex,
    rewardVaultFactoryRuntimeCodeHash:
      appManifest.runtimeCodeHashes?.classicRewardVaultFactoryV1 as Hex,
    startBlock: BigInt(startBlock as number),
  };
}

async function assertRuntime(
  client: PublicClient,
  address: Address,
  expectedHash: Hex,
  blockNumber: bigint,
  label: string,
) {
  const code = await client.getCode({ address, blockNumber });
  if (!code || code === "0x" || keccak256(code) !== expectedHash) {
    throw new Error(`${label} runtime does not match the Classic V3 release`);
  }
}

function assertCanonicalClassicV3EventSource(
  eventName: string,
  actualAddress: Address,
  release: ClassicV3Release,
) {
  const expectedAddress =
    eventName === "MemeTokenLaunchedV2"
      ? release.launcher
      : eventName === "NativeSwapFeesAccrued"
        ? release.hook
        : null;
  if (expectedAddress === null) {
    throw new Error(
      `RPC returned event outside the canonical Classic V3 filter: ${eventName}`,
    );
  }
  if (!sameHex(actualAddress, expectedAddress)) {
    throw new Error(
      `RPC returned ${eventName} from a non-canonical Classic V3 contract`,
    );
  }
}

export async function readClassicV3Events(
  client: PublicClient,
  config: ReadyOnchainDeployment,
  release: ClassicV3Release,
  toBlock: bigint,
  fromBlockFloor: bigint,
) {
  const launches: LaunchRecord[] = [];
  const volumes = new Map<string, FeeVolume>();
  let fromBlock =
    fromBlockFloor > release.startBlock
      ? fromBlockFloor
      : release.startBlock;
  let logBlockRange = config.logBlockRange;
  while (fromBlock <= toBlock) {
    const rangeEnd = minimum(
      toBlock,
      fromBlock + logBlockRange - 1n,
    );
    const readLogs = () =>
      allSettledOrThrow([
        client.getLogs({
          address: release.launcher,
          event: launchedEvent,
          fromBlock,
          toBlock: rangeEnd,
          strict: true,
        }),
        client.getLogs({
          address: release.hook,
          event: feeEvent,
          fromBlock,
          toBlock: rangeEnd,
          strict: true,
        }),
      ] as const);
    let logs: Awaited<ReturnType<typeof readLogs>>;
    try {
      logs = await readLogs();
    } catch (error) {
      if (
        (error instanceof TimeoutError ||
          error instanceof LimitExceededRpcError ||
          error instanceof HttpRequestError ||
          error instanceof ResponseBodyTooLargeError) &&
        logBlockRange > MINIMUM_LOG_BLOCK_RANGE &&
        rangeEnd > fromBlock
      ) {
        const reducedRange = logBlockRange / 2n;
        logBlockRange =
          reducedRange < MINIMUM_LOG_BLOCK_RANGE
            ? MINIMUM_LOG_BLOCK_RANGE
            : reducedRange;
        console.warn(
          "Classic V3 log range reduced after RPC rejection",
          {
            fromBlock: fromBlock.toString(),
            attemptedToBlock: rangeEnd.toString(),
            nextRange: logBlockRange.toString(),
            errorName: error.name,
          },
        );
        continue;
      }
      throw error;
    }
    const [launchLogs, feeLogs] = logs;
    for (const log of launchLogs) {
      assertCanonicalClassicV3EventSource(
        log.eventName,
        log.address,
        release,
      );
      if (log.removed || log.blockNumber === null) continue;
      launches.push({
        deployer: getAddress(log.args.deployer),
        token: getAddress(log.args.token),
        poolId: log.args.poolId,
        feeHook: getAddress(log.args.feeHook),
        rewardVault: getAddress(log.args.rewardVault),
        positionRecipient: getAddress(log.args.positionRecipient),
        positionTokenId: log.args.positionTokenId,
        buySwapFeeBps: log.args.buySwapFeeBps,
        sellSwapFeeBps: log.args.sellSwapFeeBps,
        rewardConfigurationHash: log.args.rewardConfigurationHash,
        launchHash: log.args.launchHash,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        transactionIndex: log.transactionIndex,
        logIndex: log.logIndex,
      });
    }
    for (const log of feeLogs) {
      assertCanonicalClassicV3EventSource(
        log.eventName,
        log.address,
        release,
      );
      if (log.removed) continue;
      const key = log.args.poolId.toLowerCase();
      const current = volumes.get(key) ?? { ...EMPTY_VOLUME };
      current.grossNativeAmount += log.args.grossNativeAmount;
      current.creatorFees += log.args.creatorFee;
      current.launcherFees += log.args.launcherFee;
      current.swapCount += 1;
      volumes.set(key, current);
    }
    fromBlock = rangeEnd + 1n;
  }
  return { launches, volumes };
}

function eventFingerprint(
  value: Awaited<ReturnType<typeof readClassicV3Events>>,
) {
  return JSON.stringify(
    {
      launches: value.launches,
      volumes: [...value.volumes.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    },
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
  );
}

function assertUniqueLaunches(
  launches: readonly LaunchRecord[],
  release: ClassicV3Release,
) {
  const tokens = new Set<string>();
  const pools = new Set<string>();
  for (const launch of launches) {
    const token = launch.token.toLowerCase();
    const pool = launch.poolId.toLowerCase();
    if (
      tokens.has(token) ||
      pools.has(pool) ||
      !sameHex(launch.feeHook, release.hook)
    ) {
      throw new Error(`Invalid Classic V3 launch provenance for ${launch.token}`);
    }
    tokens.add(token);
    pools.add(pool);
  }
}

async function hydrateToken(
  client: PublicClient,
  config: ReadyOnchainDeployment,
  release: ClassicV3Release,
  launch: LaunchRecord,
  volume: FeeVolume,
  timestamp: bigint,
  snapshotBlock: bigint,
): Promise<LauncherToken> {
  const [
    name,
    symbol,
    decimals,
    totalSupply,
    recordedCreator,
    metadata,
    slot0,
    activeLiquidity,
    disclosure,
    poolConfig,
    factoryVault,
    vaultHook,
    vaultPoolId,
    vaultConfigurationHash,
  ] = await Promise.all([
    client.readContract({ address: launch.token, abi: uerc20ReadAbi, functionName: "name", blockNumber: snapshotBlock }),
    client.readContract({ address: launch.token, abi: uerc20ReadAbi, functionName: "symbol", blockNumber: snapshotBlock }),
    client.readContract({ address: launch.token, abi: uerc20ReadAbi, functionName: "decimals", blockNumber: snapshotBlock }),
    client.readContract({ address: launch.token, abi: uerc20ReadAbi, functionName: "totalSupply", blockNumber: snapshotBlock }),
    client.readContract({ address: launch.token, abi: uerc20ReadAbi, functionName: "creator", blockNumber: snapshotBlock }),
    client.readContract({ address: launch.token, abi: uerc20ReadAbi, functionName: "metadata", blockNumber: snapshotBlock }).catch(() => null),
    client.readContract({ address: config.stateView, abi: stateViewReadAbi, functionName: "getSlot0", args: [launch.poolId], blockNumber: snapshotBlock }),
    client.readContract({ address: config.stateView, abi: stateViewReadAbi, functionName: "getLiquidity", args: [launch.poolId], blockNumber: snapshotBlock }),
    client.readContract({ address: release.hook, abi: classicV3HookAbi, functionName: "feeDisclosure", args: [launch.poolId], blockNumber: snapshotBlock }),
    client.readContract({ address: release.hook, abi: classicV3HookAbi, functionName: "poolFeeConfig", args: [launch.poolId], blockNumber: snapshotBlock }),
    client.readContract({ address: release.rewardVaultFactory, abi: classicRewardVaultFactoryAbi, functionName: "isFactoryVault", args: [launch.rewardVault], blockNumber: snapshotBlock }),
    client.readContract({ address: launch.rewardVault, abi: classicRewardVaultAbi, functionName: "feeHook", blockNumber: snapshotBlock }),
    client.readContract({ address: launch.rewardVault, abi: classicRewardVaultAbi, functionName: "poolId", blockNumber: snapshotBlock }),
    client.readContract({ address: launch.rewardVault, abi: classicRewardVaultAbi, functionName: "configurationHash", blockNumber: snapshotBlock }),
  ]);
  const [sqrtPriceX96, currentTick, protocolFeePips, lpFeePips] = slot0;
  const [
    buySwapFeeBps,
    sellSwapFeeBps,
    buyCreatorFeeBps,
    sellCreatorFeeBps,
    launcherFeeBps,
    transferTaxBps,
    disclosedLpFeePips,
    disclosedRewardVault,
  ] = disclosure;
  const [configuredVault, registrar, configuredBuyFee, configuredSellFee, registered, creatorFeesAccrued] = poolConfig;
  if (
    getAddress(recordedCreator) !== release.launcher ||
    !factoryVault ||
    !sameHex(vaultHook, release.hook) ||
    !sameHex(vaultPoolId, launch.poolId) ||
    !sameHex(vaultConfigurationHash, launch.rewardConfigurationHash) ||
    !sameHex(disclosedRewardVault, launch.rewardVault) ||
    !sameHex(configuredVault, launch.rewardVault) ||
    !sameHex(registrar, release.launcher) ||
    !registered ||
    buySwapFeeBps !== launch.buySwapFeeBps ||
    sellSwapFeeBps !== launch.sellSwapFeeBps ||
    configuredBuyFee !== launch.buySwapFeeBps ||
    configuredSellFee !== launch.sellSwapFeeBps ||
    buyCreatorFeeBps + launcherFeeBps !== buySwapFeeBps ||
    sellCreatorFeeBps + launcherFeeBps !== sellSwapFeeBps ||
    launcherFeeBps !== 10 ||
    transferTaxBps !== 0 ||
    disclosedLpFeePips !== 0 ||
    lpFeePips !== 0
  ) {
    throw new Error(`Classic V3 launch state mismatch for ${launch.token}`);
  }
  const tokenPriceEthWei = nativePriceWadFromSqrtPriceX96(sqrtPriceX96, decimals);
  const marketCapEthWei = marketCapNativeWadFromSqrtPriceX96(totalSupply, sqrtPriceX96);
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
    hookAddress: launch.feeHook,
    poolId: launch.poolId,
    creatorAddress: launch.deployer,
    rewardVaultAddress: launch.rewardVault,
    positionRecipient: launch.positionRecipient,
    positionTokenId: launch.positionTokenId.toString(),
    launchHash: launch.launchHash,
    launchBlockNumber: launch.blockNumber.toString(),
    launchTransactionHash: launch.transactionHash,
    launchTransactionIndex: launch.transactionIndex,
    launchLogIndex: launch.logIndex,
    launchedAt: new Date(Number(timestamp) * 1_000).toISOString(),
    totalSupply: formatUnits(totalSupply, decimals),
    totalSupplyRaw: totalSupply.toString(),
    tokenDecimals: decimals,
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
    creatorFeesAccruedEth: formatUnits(creatorFeesAccrued, 18),
    creatorFeesAccruedWei: creatorFeesAccrued.toString(),
    swapCount: volume.swapCount,
    currentTick,
    activeLiquidity: activeLiquidity.toString(),
    protocolFeePips,
    lpFeePips,
    buyHookFeeBps: buySwapFeeBps,
    sellHookFeeBps: sellSwapFeeBps,
    creatorFeeBps:
      buyCreatorFeeBps === sellCreatorFeeBps ? buyCreatorFeeBps : undefined,
    buyCreatorFeeBps,
    sellCreatorFeeBps,
    programmableFeeBps: launcherFeeBps,
    launcherFeeBps,
    transferTaxBps,
    totalSwapFeeBps: Math.max(buySwapFeeBps, sellSwapFeeBps),
    launchModel: "classic",
    launchModelVersion: "classic-v3",
    liquidityPath: "meme",
    metadataExtraData: extraData,
  };
}

export function isClassicV3ExploreReleaseReady(
  config: ReadyOnchainDeployment,
) {
  return resolveClassicV3Release(config) !== null;
}

export async function readClassicV3ExploreModel(
  config: ReadyOnchainDeployment,
  snapshotBlockNumber: string,
  options: Readonly<{ fromBlock?: bigint }> = {},
): Promise<ClassicV3ExploreSlice> {
  const release = resolveClassicV3Release(config);
  if (!release || !/^(?:0|[1-9]\d*)$/.test(snapshotBlockNumber)) {
    return { tokens: [], launcherFeesAccrued: 0n };
  }
  const toBlock = BigInt(snapshotBlockNumber);
  if (toBlock < release.startBlock) {
    return { tokens: [], launcherFeesAccrued: 0n };
  }
  const clients = [
    clientFor(config, config.rpcUrl),
    ...(config.rpcUrlSecondary
      ? [clientFor(config, config.rpcUrlSecondary)]
      : []),
  ];
  await mapInBatches(
    clients,
    RPC_PROVENANCE_BATCH_SIZE,
    (client) =>
      mapInBatches(
        [
          {
            address: release.launcher,
            expectedHash: release.launcherRuntimeCodeHash,
            label: "Classic V3 launcher",
          },
          {
            address: release.hook,
            expectedHash: release.hookRuntimeCodeHash,
            label: "Classic V3 hook",
          },
          {
            address: release.rewardVaultFactory,
            expectedHash: release.rewardVaultFactoryRuntimeCodeHash,
            label: "Classic V3 reward vault factory",
          },
          {
            address: config.stateView,
            expectedHash: config.stateViewRuntimeCodeHash,
            label: "Uniswap StateView",
          },
        ],
        1,
        ({ address, expectedHash, label }) =>
          assertRuntime(
            client,
            address,
            expectedHash,
            toBlock,
            label,
          ),
      ),
  );
  const eventSets = await allSettledOrThrow(
    clients.map((client) =>
      readClassicV3Events(
        client,
        config,
        release,
        toBlock,
        options.fromBlock ?? release.startBlock,
      )),
  );
  const launcherFees = await mapInBatches(
    clients,
    RPC_PROVENANCE_BATCH_SIZE,
    (client) =>
        client.readContract({
          address: release.hook,
          abi: classicV3HookAbi,
          functionName: "launcherFeesAccrued",
          blockNumber: toBlock,
        }),
  );
  const fingerprint = eventFingerprint(eventSets[0]);
  if (
    eventSets.some((candidate) => eventFingerprint(candidate) !== fingerprint) ||
    launcherFees.some((value) => value !== launcherFees[0])
  ) {
    throw new Error("Independent RPCs disagree on Classic V3 state");
  }
  const { launches, volumes } = eventSets[0];
  assertUniqueLaunches(launches, release);
  const timestamps = new Map<string, bigint>();
  await mapInBatches(
    [...new Set(launches.map((launch) => launch.blockNumber.toString()))].map(
      (blockNumber) => blockNumber,
    ),
    BLOCK_TIMESTAMP_BATCH_SIZE,
    async (blockNumber) => {
      const block = await clients[0].getBlock({
        blockNumber: BigInt(blockNumber),
      });
      timestamps.set(blockNumber, block.timestamp);
    },
  );
  const tokenSets = await mapInBatches(
    clients,
    RPC_PROVENANCE_BATCH_SIZE,
    (client) =>
      mapInBatches(
        launches,
        TOKEN_HYDRATION_BATCH_SIZE,
        (launch) =>
          hydrateToken(
            client,
            config,
            release,
            launch,
            volumes.get(launch.poolId.toLowerCase()) ?? EMPTY_VOLUME,
            timestamps.get(launch.blockNumber.toString()) ?? 0n,
            toBlock,
          ),
      ),
  );
  const tokenFingerprint = JSON.stringify(tokenSets[0]);
  if (tokenSets.some((candidate) => JSON.stringify(candidate) !== tokenFingerprint)) {
    throw new Error("Independent RPCs disagree on Classic V3 token state");
  }
  return { tokens: tokenSets[0], launcherFeesAccrued: launcherFees[0] };
}

export function mergeClassicV3ExploreModel<T extends ExploreReadModel>(
  model: T,
  slice: ClassicV3ExploreSlice,
): T {
  if (model.status !== "ready") return model;
  const tokens = new Map(
    model.tokens.map((token) => [token.tokenAddress.toLowerCase(), token]),
  );
  const alreadyIncluded =
    slice.tokens.length > 0 &&
    slice.tokens.every((token) => {
      const existing = tokens.get(token.tokenAddress.toLowerCase());
      return (
        existing?.launchModelVersion === "classic-v3" &&
        existing.launchTransactionHash === token.launchTransactionHash
      );
    });
  for (const token of slice.tokens) {
    const key = token.tokenAddress.toLowerCase();
    const existing = tokens.get(key);
    if (existing && existing.launchTransactionHash !== token.launchTransactionHash) {
      throw new Error(`Duplicate token across launch releases: ${token.tokenAddress}`);
    }
    tokens.set(key, token);
  }
  const launcherFeesAccrued =
    BigInt(model.launcherFeesAccruedWei) +
    (alreadyIncluded ? 0n : slice.launcherFeesAccrued);
  return {
    ...model,
    tokens: [...tokens.values()],
    launcherFeesAccruedWei: launcherFeesAccrued.toString(),
    launcherFeesAccruedEth: formatUnits(launcherFeesAccrued, 18),
  } as T;
}
