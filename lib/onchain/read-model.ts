import {
  createPublicClient,
  formatUnits,
  getAddress,
  HttpRequestError,
  keccak256,
  LimitExceededRpcError,
  ResponseBodyTooLargeError,
  RpcRequestError,
  TimeoutError,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import type { LauncherToken } from "../tokens";

import {
  creatorFeeHookReadAbi,
  creatorFeesClaimedEvent,
  memeCreatorInitialBuyEvent,
  memeLiquidityConfiguredEvent,
  memeTokenLaunchedEvent,
  nativeSwapFeesAccruedEvent,
  stateViewReadAbi,
  uerc20ReadAbi,
} from "./abis";
import { getPublicOnchainDeployment } from "./config";
import { pairVerifiedLaunchEvents } from "./events";
import {
  marketCapNativeWadFromSqrtPriceX96,
  nativePriceWadFromSqrtPriceX96,
} from "./math";
import {
  buildTokenLinks,
  sanitizeImageUrl,
} from "./metadata";
import {
  persistentRpcHttp,
  withPersistentRpcIntegrityScope,
} from "./persistent-rpc-cache.server";
import { enrichExploreModelWithUsd } from "./usd";
import type {
  ExploreReadModel,
  CreatorClaimEventRecord,
  FeeVolume,
  InitialBuyEventRecord,
  LaunchEventRecord,
  LiquidityEventRecord,
  OnchainDeployment,
  ReadyOnchainDeployment,
  VerifiedLaunchRecord,
} from "./types";
import {
  readDurableExploreModel,
  selectFreshDurableExploreModel,
} from "./durable-model";
import { resolveExploreReadSource } from "./explore-read-source";
import {
  isClassicV3ExploreReleaseReady,
  mergeClassicV3ExploreModel,
  readClassicV3ExploreModel,
} from "./classic-v3-read-model";
import {
  isDeepExploreReleaseReady,
  mergeDeepExploreModel,
  readDeepExploreModel,
} from "./deep-read-model";
import {
  isDeepV2ExploreReleaseReady,
  readDeepV2ExploreModel,
} from "./deep-v2-read-model";
import {
  isDeepV3ExploreReleaseReady,
  mergeDeepV3ExploreModel,
  readDeepV3ExploreModel,
} from "./deep-v3-explore";
import {
  isStockPairedExploreReleaseReady,
  mergeStockPairedExploreModel,
  readStockPairedExploreModel,
} from "./stock-paired-read-model";

const ZERO_FEE_VOLUME: FeeVolume = {
  grossNativeAmount: 0n,
  creatorFees: 0n,
  launcherFees: 0n,
  swapCount: 0,
};

const TOKEN_HYDRATION_BATCH_SIZE = 12;
const BLOCK_TIMESTAMP_BATCH_SIZE = 4;
const RPC_PROVENANCE_BATCH_SIZE = 1;
const MINIMUM_LOG_BLOCK_RANGE = 1n;
const TRANSIENT_RETRIES_PER_WINDOW = 1;
const MINIMUM_RANGE_TRANSIENT_RETRIES = 2;
const CLASSIC_LAUNCHER_EVENTS = [
  memeTokenLaunchedEvent,
  memeLiquidityConfiguredEvent,
  memeCreatorInitialBuyEvent,
] as const;
const CLASSIC_FEE_HOOK_EVENTS = [
  nativeSwapFeesAccruedEvent,
  creatorFeesClaimedEvent,
] as const;

function isTransientLogReadError(error: unknown) {
  if (error instanceof TimeoutError) return true;
  if (error instanceof HttpRequestError) {
    return (
      error.status === undefined ||
      error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500
    );
  }
  return (
    error instanceof RpcRequestError &&
    error.code === -32603 &&
    error.details.trim().toLowerCase() === "service temporarily unavailable"
  );
}

type FeeDisclosure = readonly [
  buySwapFeeBps: number,
  sellSwapFeeBps: number,
  creatorFeeBps: number,
  launcherFeeBps: number,
  transferTaxBps: number,
  lpFeePips: number,
];

async function readFeeDisclosure(
  client: PublicClient,
  config: ReadyOnchainDeployment,
  poolId: Hex,
  registeredFeeBps: number,
  snapshotBlock: bigint,
): Promise<FeeDisclosure> {
  if (config.releaseVersion === "classic-v2") {
    return client.readContract({
      address: config.feeHook,
      abi: creatorFeeHookReadAbi,
      functionName: "feeDisclosure",
      args: [poolId],
      blockNumber: snapshotBlock,
    });
  }

  const [launcherFeeBps, lpFeePips] = await Promise.all([
    client.readContract({
      address: config.feeHook,
      abi: creatorFeeHookReadAbi,
      functionName: "LAUNCHER_FEE_BPS",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: config.feeHook,
      abi: creatorFeeHookReadAbi,
      functionName: "LP_FEE_PIPS",
      blockNumber: snapshotBlock,
    }),
  ]);
  if (launcherFeeBps > registeredFeeBps) {
    throw new Error("V1 launcher fee exceeds the registered pool fee");
  }

  return [
    registeredFeeBps,
    registeredFeeBps,
    registeredFeeBps - launcherFeeBps,
    launcherFeeBps,
    0,
    lpFeePips,
  ] as const;
}

function createOnchainClient(
  config: OnchainDeployment,
  rpcUrl = config.rpcUrl,
): PublicClient {
  return createPublicClient({
    chain: config.chainId === 1 ? mainnet : sepolia,
    batch: { multicall: true },
    transport: persistentRpcHttp(rpcUrl, {
      chainId: config.chainId,
      maxLogBlockRange: config.logBlockRange,
      http: {
        retryCount: 1,
        timeout: 10_000,
      },
      ...(config.status === "ready"
        ? {
            immutableCodeBindings: [
              {
                address: config.launcher,
                expectedRuntimeCodeHash: config.launcherRuntimeCodeHash,
                notBeforeBlock: config.deploymentBlock,
              },
              {
                address: config.feeHook,
                expectedRuntimeCodeHash: config.feeHookRuntimeCodeHash,
                notBeforeBlock: config.deploymentBlock,
              },
              {
                address: config.stateView,
                expectedRuntimeCodeHash: config.stateViewRuntimeCodeHash,
                notBeforeBlock: config.deploymentBlock,
              },
            ],
          }
        : {}),
    }),
  });
}

function minimum(first: bigint, second: bigint) {
  return first < second ? first : second;
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

async function withReadStage<Output>(
  stage: string,
  read: () => Promise<Output>,
) {
  try {
    return await read();
  } catch (cause) {
    const error = new Error(`Explore read failed at ${stage}`, { cause });
    error.name = `ExploreReadStage:${stage}`;
    throw error;
  }
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
    throw new Error(`${label} runtime code does not match the manifest`);
  }
}

export type IndexedEvents = {
  launches: LaunchEventRecord[];
  liquidities: LiquidityEventRecord[];
  initialBuys: InitialBuyEventRecord[];
  volumes: Map<string, FeeVolume>;
  creatorClaims: CreatorClaimEventRecord[];
};

export function indexedEventsFingerprint(events: IndexedEvents) {
  return JSON.stringify(
    {
      launches: events.launches,
      liquidities: events.liquidities,
      initialBuys: events.initialBuys,
      volumes: [...events.volumes.entries()].sort(([first], [second]) =>
        first.localeCompare(second),
      ),
      creatorClaims: events.creatorClaims,
    },
    (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
  );
}

function assertCanonicalClassicEventSource(
  eventName: string,
  actualAddress: Address,
  config: ReadyOnchainDeployment,
) {
  const expectedAddress =
    eventName === "MemeTokenLaunched" ||
    eventName === "MemeLiquidityConfigured" ||
    eventName === "MemeCreatorInitialBuy"
      ? config.launcher
      : eventName === "NativeSwapFeesAccrued" ||
          eventName === "CreatorFeesClaimed"
        ? config.feeHook
        : null;
  if (expectedAddress === null) {
    throw new Error(
      `RPC returned event outside the canonical Classic filter: ${eventName}`,
    );
  }
  if (actualAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(
      `RPC returned ${eventName} from a non-canonical contract`,
    );
  }
}

export async function indexVerifiedEvents(
  client: PublicClient,
  config: ReadyOnchainDeployment,
  toBlock: bigint,
): Promise<IndexedEvents> {
  const launches: LaunchEventRecord[] = [];
  const liquidities: LiquidityEventRecord[] = [];
  const initialBuys: InitialBuyEventRecord[] = [];
  const volumes = new Map<string, FeeVolume>();
  const creatorClaims: CreatorClaimEventRecord[] = [];

  let fromBlock = config.deploymentBlock;
  const configuredLogBlockRange = toBlock >= fromBlock
    ? toBlock - fromBlock + 1n
    : config.logBlockRange;
  let logBlockRange = configuredLogBlockRange;
  let transientRetries = 0;
  while (fromBlock <= toBlock) {
    const rangeEnd = minimum(
      toBlock,
      fromBlock + logBlockRange - 1n,
    );
    const readLogs = () =>
      allSettledOrThrow([
        client.getLogs({
          address: config.launcher,
          events: CLASSIC_LAUNCHER_EVENTS,
          fromBlock,
          toBlock: rangeEnd,
          strict: true,
        }),
        client.getLogs({
          address: config.feeHook,
          events: CLASSIC_FEE_HOOK_EVENTS,
          fromBlock,
          toBlock: rangeEnd,
          strict: true,
        }),
      ] as const);
    let logs: Awaited<ReturnType<typeof readLogs>>;
    try {
      logs = await readLogs();
    } catch (error) {
      const transient = isTransientLogReadError(error);
      const transientRetryLimit =
        logBlockRange === MINIMUM_LOG_BLOCK_RANGE
          ? MINIMUM_RANGE_TRANSIENT_RETRIES
          : TRANSIENT_RETRIES_PER_WINDOW;
      if (transient && transientRetries < transientRetryLimit) {
        transientRetries += 1;
        console.warn("Explore log window retried after transient RPC rejection", {
          fromBlock: fromBlock.toString(),
          attemptedToBlock: rangeEnd.toString(),
          retry: transientRetries,
          retryLimit: transientRetryLimit,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        continue;
      }
      if (
        (transient ||
          error instanceof LimitExceededRpcError ||
          error instanceof ResponseBodyTooLargeError) &&
        logBlockRange > MINIMUM_LOG_BLOCK_RANGE &&
        rangeEnd > fromBlock
      ) {
        const reducedRange = logBlockRange / 2n;
        logBlockRange =
          reducedRange < MINIMUM_LOG_BLOCK_RANGE
            ? MINIMUM_LOG_BLOCK_RANGE
            : reducedRange;
        transientRetries = 0;
        console.warn("Explore log range reduced after RPC rejection", {
          fromBlock: fromBlock.toString(),
          attemptedToBlock: rangeEnd.toString(),
          nextRange: logBlockRange.toString(),
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        continue;
      }
      throw error;
    }
    for (const log of logs.flat()) {
      assertCanonicalClassicEventSource(
        log.eventName,
        log.address,
        config,
      );
      if (log.removed) continue;

      switch (log.eventName) {
        case "MemeTokenLaunched":
          if (log.blockNumber === null) continue;
          launches.push({
            creator: getAddress(log.args.creator),
            token: getAddress(log.args.token),
            poolId: log.args.poolId,
            feeHook: getAddress(log.args.feeHook),
            positionRecipient: getAddress(log.args.positionRecipient),
            positionTokenId: log.args.positionTokenId,
            totalSwapFeeBps: log.args.totalSwapFeeBps,
            launchHash: log.args.launchHash,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            transactionIndex: log.transactionIndex,
            logIndex: log.logIndex,
          });
          break;
        case "MemeLiquidityConfigured":
          if (log.blockNumber === null) continue;
          liquidities.push({
            token: getAddress(log.args.token),
            totalSupply: log.args.totalSupply,
            tokenLiquidityAmount: log.args.tokenLiquidityAmount,
            lockedTokenDust: log.args.lockedTokenDust,
            initialTick: log.args.initialTick,
            tickLower: log.args.tickLower,
            tickUpper: log.args.tickUpper,
            lpFeePips: log.args.lpFeePips,
            launchHash: log.args.launchHash,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            transactionIndex: log.transactionIndex,
            logIndex: log.logIndex,
          });
          break;
        case "MemeCreatorInitialBuy":
          if (log.blockNumber === null) continue;
          initialBuys.push({
            creator: getAddress(log.args.creator),
            token: getAddress(log.args.token),
            poolId: log.args.poolId,
            nativeAmount: log.args.nativeAmount,
            tokenAmount: log.args.tokenAmount,
            launchHash: log.args.launchHash,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            transactionIndex: log.transactionIndex,
            logIndex: log.logIndex,
          });
          break;
        case "NativeSwapFeesAccrued": {
          const poolKey = log.args.poolId.toLowerCase();
          const current = volumes.get(poolKey) ?? ZERO_FEE_VOLUME;
          volumes.set(poolKey, {
            grossNativeAmount:
              current.grossNativeAmount + log.args.grossNativeAmount,
            creatorFees: current.creatorFees + log.args.creatorFee,
            launcherFees: current.launcherFees + log.args.launcherFee,
            swapCount: current.swapCount + 1,
          });
          break;
        }
        case "CreatorFeesClaimed":
          if (log.blockNumber === null) continue;
          creatorClaims.push({
            poolId: log.args.poolId,
            creator: getAddress(log.args.creator),
            recipient: getAddress(log.args.recipient),
            caller: getAddress(log.args.caller),
            amount: log.args.amount,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            transactionIndex: log.transactionIndex,
            logIndex: log.logIndex,
          });
          break;
        default:
          throw new Error("RPC returned an undecodable Classic event");
      }
    }
    fromBlock = rangeEnd + 1n;
    transientRetries = 0;
    if (logBlockRange < configuredLogBlockRange) {
      logBlockRange = minimum(
        configuredLogBlockRange,
        logBlockRange * 2n,
      );
    }
  }

  return {
    launches,
    liquidities,
    initialBuys,
    volumes,
    creatorClaims,
  };
}

async function hydrateVerifiedToken(
  client: PublicClient,
  config: ReadyOnchainDeployment,
  launch: VerifiedLaunchRecord,
  volume: FeeVolume,
  blockTimestamp: bigint,
  snapshotBlock: bigint,
): Promise<LauncherToken> {
  const [
    name,
    symbol,
    decimals,
    totalSupply,
    recordedCreator,
    slot0,
    activeLiquidity,
    feeConfig,
    metadata,
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
      address: config.feeHook,
      abi: creatorFeeHookReadAbi,
      functionName: "poolFeeConfig",
      args: [launch.poolId],
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
  ]);

  const [sqrtPriceX96, currentTick, protocolFeePips, lpFeePips] =
    slot0;
  const [
    poolCreator,
    registrar,
    registeredFeeBps,
    registered,
    creatorFeesAccrued,
  ] = feeConfig;
  const feeDisclosure = await readFeeDisclosure(
    client,
    config,
    launch.poolId,
    registeredFeeBps,
    snapshotBlock,
  );
  const [
    buyHookFeeBps,
    sellHookFeeBps,
    creatorFeeBps,
    launcherFeeBps,
    transferTaxBps,
    disclosedLpFeePips,
  ] = feeDisclosure;

  if (
    getAddress(recordedCreator) !== config.launcher ||
    totalSupply !== launch.liquidity.totalSupply ||
    !registered ||
    getAddress(poolCreator) !== launch.creator ||
    getAddress(registrar) !== config.launcher ||
    registeredFeeBps !== launch.totalSwapFeeBps ||
    buyHookFeeBps !== registeredFeeBps ||
    sellHookFeeBps !== registeredFeeBps ||
    creatorFeeBps + launcherFeeBps !== registeredFeeBps ||
    transferTaxBps !== 0 ||
    disclosedLpFeePips !== lpFeePips ||
    lpFeePips !== launch.liquidity.lpFeePips
  ) {
    throw new Error(
      `Launch provenance mismatch for ${launch.token}`,
    );
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
    hookAddress: launch.feeHook,
    poolId: launch.poolId,
    creatorAddress: launch.creator,
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
      launch.liquidity.tokenLiquidityAmount.toString(),
    lockedTokenDustRaw: launch.liquidity.lockedTokenDust.toString(),
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
    initialTick: launch.liquidity.initialTick,
    tickLower: launch.liquidity.tickLower,
    tickUpper: launch.liquidity.tickUpper,
    activeLiquidity: activeLiquidity.toString(),
    protocolFeePips,
    lpFeePips,
    buyHookFeeBps,
    sellHookFeeBps,
    creatorFeeBps,
    launcherFeeBps,
    transferTaxBps,
    totalSwapFeeBps: launch.totalSwapFeeBps,
    launchModel: "classic",
    liquidityPath: "meme",
    metadataExtraData: extraData,
  };
}

async function readReadyModel(
  config: ReadyOnchainDeployment,
): Promise<ExploreReadModel> {
  const client = createOnchainClient(config);
  const clients = [
    client,
    ...(config.rpcUrlSecondary
      ? [createOnchainClient(config, config.rpcUrlSecondary)]
      : []),
  ];
  const chainStates = await withReadStage("chain-heads", () =>
    mapInBatches(
      clients,
      RPC_PROVENANCE_BATCH_SIZE,
      async (candidate) => ({
        chainId: await candidate.getChainId(),
        head: await candidate.getBlockNumber(),
      }),
    ),
  );
  if (chainStates.some((state) => state.chainId !== config.chainId)) {
    throw new Error("RPC chain does not match the deployment manifest");
  }

  const head = chainStates.reduce(
    (lowest, state) => minimum(lowest, state.head),
    chainStates[0].head,
  );
  const toBlock =
    head > config.confirmations ? head - config.confirmations : 0n;
  const snapshotBlocks = await withReadStage("snapshot-blocks", () =>
    mapInBatches(
      clients,
      RPC_PROVENANCE_BATCH_SIZE,
      (candidate) =>
        candidate.getBlock({ blockNumber: toBlock }),
    ),
  );
  const snapshotBlock = snapshotBlocks[0];
  if (!snapshotBlock.hash) {
    throw new Error("Confirmed snapshot block has no hash");
  }
  if (
    snapshotBlocks.some(
      (block) =>
        !block.hash ||
        block.hash.toLowerCase() !== snapshotBlock.hash?.toLowerCase(),
    )
  ) {
    throw new Error(
      "Independent RPCs disagree on the confirmed snapshot block",
    );
  }

  if (toBlock < config.deploymentBlock) {
    return {
      status: "ready",
      tokens: [],
      snapshot: {
        chainId: config.chainId,
        blockNumber: toBlock.toString(),
        blockHash: snapshotBlock.hash,
        confirmations: Number(config.confirmations),
      },
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    };
  }

  await withReadStage("runtime-code", () =>
    mapInBatches(
      clients,
      RPC_PROVENANCE_BATCH_SIZE,
      (candidate) =>
        mapInBatches(
          [
            {
              address: config.launcher,
              expectedHash: config.launcherRuntimeCodeHash,
              label: "Launcher",
            },
            {
              address: config.feeHook,
              expectedHash: config.feeHookRuntimeCodeHash,
              label: "Creator fee hook",
            },
            {
              address: config.stateView,
              expectedHash: config.stateViewRuntimeCodeHash,
              label: "Uniswap StateView",
            },
          ],
          1,
          ({ address, expectedHash, label }) =>
            assertRuntimeCode(
              candidate,
              address,
              expectedHash,
              toBlock,
              label,
            ),
        ),
    ),
  );

  const indexedEventSets = await allSettledOrThrow(
    clients.map((candidate) =>
      withReadStage("classic-events", () =>
        withPersistentRpcIntegrityScope(() =>
          indexVerifiedEvents(candidate, config, toBlock),
        ),
      ),
    ),
  );
  const launcherFeeValues = await withReadStage(
    "launcher-fee-accounting",
    () =>
      mapInBatches(
        clients,
        RPC_PROVENANCE_BATCH_SIZE,
        (candidate) =>
          candidate.readContract({
            address: config.feeHook,
            abi: creatorFeeHookReadAbi,
            functionName: "launcherFeesAccrued",
            blockNumber: toBlock,
          }),
      ),
  );
  const eventFingerprint = indexedEventsFingerprint(indexedEventSets[0]);
  if (
    indexedEventSets.some(
      (events) => indexedEventsFingerprint(events) !== eventFingerprint,
    ) ||
    launcherFeeValues.some(
      (value) => value !== launcherFeeValues[0],
    )
  ) {
    throw new Error(
      "Independent RPCs disagree on canonical events or fee accounting",
    );
  }
  const {
    launches,
    liquidities,
    initialBuys,
    volumes,
    creatorClaims,
  } = indexedEventSets[0];
  const launcherFeesAccrued = launcherFeeValues[0];
  const verified = pairVerifiedLaunchEvents(
    config.chainId,
    config.launcher,
    config.feeHook,
    launches,
    liquidities,
    initialBuys,
  );
  const launchByPool = new Map(
    verified.map((launch) => [launch.poolId.toLowerCase(), launch]),
  );
  const verifiedClaims = creatorClaims.filter((claim) => {
    const launch = launchByPool.get(claim.poolId.toLowerCase());
    return (
      launch !== undefined &&
      claim.creator.toLowerCase() === launch.creator.toLowerCase()
    );
  });

  const blockNumbers = [
    ...new Set(
      [
        ...verified.map((launch) => launch.blockNumber),
        ...verifiedClaims.map((claim) => claim.blockNumber),
      ].map(String),
    ),
  ].map(BigInt);
  const blockTimestamps = new Map<string, bigint>();
  await withReadStage("block-timestamps", () =>
    mapInBatches(
      blockNumbers,
      BLOCK_TIMESTAMP_BATCH_SIZE,
      async (blockNumber) => {
        const block = await client.getBlock({ blockNumber });
        blockTimestamps.set(blockNumber.toString(), block.timestamp);
      },
    ),
  );

  const tokenSets = await withReadStage("classic-token-state", () =>
    mapInBatches(
      clients,
      RPC_PROVENANCE_BATCH_SIZE,
      (candidate) =>
        mapInBatches(
          verified,
          TOKEN_HYDRATION_BATCH_SIZE,
          (launch) =>
            hydrateVerifiedToken(
              candidate,
              config,
              launch,
              volumes.get(launch.poolId.toLowerCase()) ??
                ZERO_FEE_VOLUME,
              blockTimestamps.get(launch.blockNumber.toString()) ?? 0n,
              toBlock,
            ),
        ),
    ),
  );
  const tokenFingerprint = JSON.stringify(tokenSets[0]);
  if (
    tokenSets.some(
      (candidateTokens) =>
        JSON.stringify(candidateTokens) !== tokenFingerprint,
    )
  ) {
    throw new Error(
      "Independent RPCs disagree on canonical token state",
    );
  }
  const tokens = tokenSets[0];
  const serializedClaims = verifiedClaims
    .map((claim) => {
      const launch = launchByPool.get(claim.poolId.toLowerCase());
      if (!launch) return null;
      return {
        poolId: claim.poolId,
        tokenAddress: launch.token,
        creatorAddress: claim.creator,
        recipientAddress: claim.recipient,
        callerAddress: claim.caller,
        amountWei: claim.amount.toString(),
        amountEth: formatUnits(claim.amount, 18),
        blockNumber: claim.blockNumber.toString(),
        transactionHash: claim.transactionHash,
        transactionIndex: claim.transactionIndex,
        logIndex: claim.logIndex,
        claimedAt: new Date(
          Number(
            blockTimestamps.get(claim.blockNumber.toString()) ?? 0n,
          ) * 1_000,
        ).toISOString(),
      };
    })
    .filter((claim) => claim !== null);

  return {
    status: "ready",
    tokens,
    snapshot: {
      chainId: config.chainId,
      blockNumber: toBlock.toString(),
      blockHash: snapshotBlock.hash,
      confirmations: Number(config.confirmations),
    },
    creatorClaims: serializedClaims,
    launcherFeesAccruedWei: launcherFeesAccrued.toString(),
    launcherFeesAccruedEth: formatUnits(launcherFeesAccrued, 18),
  };
}

type ReadyExploreModel = Extract<ExploreReadModel, { status: "ready" }>;

function launchIdentity(token: LauncherToken) {
  return [
    token.tokenAddress.toLowerCase(),
    token.launchTransactionHash?.toLowerCase() ?? "",
    token.launchLogIndex ?? -1,
  ].join(":");
}

function claimIdentity(
  claim: ReadyExploreModel["creatorClaims"][number],
) {
  return [
    claim.transactionHash.toLowerCase(),
    claim.logIndex,
  ].join(":");
}

function mergeIncrementalClassicModel(
  base: ReadyExploreModel,
  incremental: ReadyExploreModel,
): ReadyExploreModel {
  if (base.snapshot.chainId !== incremental.snapshot.chainId) {
    throw new Error("Incremental Explore registry changed chains");
  }
  const tokens = new Map(
    base.tokens.map((token) => [token.tokenAddress.toLowerCase(), token]),
  );
  for (const token of incremental.tokens) {
    const key = token.tokenAddress.toLowerCase();
    const existing = tokens.get(key);
    if (existing && launchIdentity(existing) !== launchIdentity(token)) {
      throw new Error(
        `Incremental Explore registry changed launch identity for ${token.tokenAddress}`,
      );
    }
    tokens.set(key, token);
  }
  const claims = new Map(
    base.creatorClaims.map((claim) => [claimIdentity(claim), claim]),
  );
  for (const claim of incremental.creatorClaims) {
    claims.set(claimIdentity(claim), claim);
  }
  return {
    status: "ready",
    tokens: [...tokens.values()],
    snapshot: incremental.snapshot,
    creatorClaims: [...claims.values()],
    launcherFeesAccruedWei: incremental.launcherFeesAccruedWei,
    launcherFeesAccruedEth: incremental.launcherFeesAccruedEth,
  };
}

async function assertSnapshotIsCanonical(
  config: ReadyOnchainDeployment,
  snapshot: ReadyExploreModel["snapshot"],
) {
  if (snapshot.chainId !== config.chainId) {
    throw new Error("Durable Explore snapshot changed chains");
  }
  const clients = [
    createOnchainClient(config),
    ...(config.rpcUrlSecondary
      ? [createOnchainClient(config, config.rpcUrlSecondary)]
      : []),
  ];
  const blocks = await mapInBatches(
    clients,
    RPC_PROVENANCE_BATCH_SIZE,
    (client) =>
      client.getBlock({ blockNumber: BigInt(snapshot.blockNumber) }),
  );
  if (
    blocks.some(
      (block) =>
        !block.hash ||
        block.hash.toLowerCase() !== snapshot.blockHash.toLowerCase(),
    )
  ) {
    throw new Error("Durable Explore snapshot is no longer canonical");
  }
}

export async function advanceExploreLaunchDiscovery(
  config: ReadyOnchainDeployment,
  base: ExploreReadModel,
  target: "confirmed" | "latest" = "confirmed",
): Promise<ReadyExploreModel> {
  if (base.status !== "ready") {
    throw new Error("Incremental Explore requires a ready durable registry");
  }
  if (
    isDeepExploreReleaseReady(config) ||
    isDeepV2ExploreReleaseReady(config) ||
    isDeepV3ExploreReleaseReady(config)
  ) {
    throw new Error(
      "Incremental Alchemy registry does not support an active Deep release",
    );
  }

  await assertSnapshotIsCanonical(config, base.snapshot);
  const fromBlock = BigInt(base.snapshot.blockNumber) + 1n;
  const incrementalConfig: ReadyOnchainDeployment = {
    ...config,
    confirmations: target === "latest" ? 0n : config.confirmations,
    deploymentBlock: fromBlock,
  };
  const incremental = await readReadyModel(incrementalConfig);
  if (incremental.status !== "ready") {
    throw new Error("Incremental Classic registry is not ready");
  }
  const incomingBlock = BigInt(incremental.snapshot.blockNumber);
  const currentBlock = BigInt(base.snapshot.blockNumber);
  if (incomingBlock < currentBlock) {
    throw new Error("Incremental Explore head moved behind the durable cursor");
  }
  if (incomingBlock === currentBlock) {
    if (
      incremental.snapshot.blockHash.toLowerCase() !==
      base.snapshot.blockHash.toLowerCase()
    ) {
      throw new Error("Incremental Explore head replaced the durable cursor");
    }
    return base;
  }

  let registry = mergeIncrementalClassicModel(base, incremental);
  if (isClassicV3ExploreReleaseReady(config)) {
    registry = mergeClassicV3ExploreModel(
      registry,
      await withReadStage("classic-v3-incremental", () =>
        readClassicV3ExploreModel(
          incrementalConfig,
          incremental.snapshot.blockNumber,
          { fromBlock },
        ),
      ),
    );
  }
  if (isStockPairedExploreReleaseReady(config)) {
    registry = mergeStockPairedExploreModel(
      registry,
      await withReadStage("stock-paired-incremental", () =>
        readStockPairedExploreModel(
          incrementalConfig,
          incremental.snapshot.blockNumber,
          { fromBlock },
        ),
      ),
    );
  }
  return registry;
}

async function readReadyRegistryModel(
  config: ReadyOnchainDeployment,
): Promise<ExploreReadModel> {
  let registry = await readReadyModel(config);
  if (!registry.snapshot) {
    throw new Error("The Classic registry has no confirmed snapshot");
  }
  const snapshotBlockNumber = registry.snapshot.blockNumber;
  if (isClassicV3ExploreReleaseReady(config)) {
    registry = mergeClassicV3ExploreModel(
      registry,
      await withReadStage("classic-v3", () =>
        readClassicV3ExploreModel(config, snapshotBlockNumber),
      ),
    );
  }
  if (isDeepExploreReleaseReady(config)) {
    registry = mergeDeepExploreModel(
      registry,
      await withReadStage("deep-v1", () =>
        readDeepExploreModel(config, snapshotBlockNumber),
      ),
    );
  }
  if (isDeepV2ExploreReleaseReady(config)) {
    registry = mergeDeepExploreModel(
      registry,
      await withReadStage("deep-v2", () =>
        readDeepV2ExploreModel(config, snapshotBlockNumber),
      ),
    );
  }
  if (isDeepV3ExploreReleaseReady(config)) {
    registry = mergeDeepV3ExploreModel(
      registry,
      await withReadStage("deep-v3", () =>
        readDeepV3ExploreModel(config, snapshotBlockNumber),
      ),
    );
  }
  if (isStockPairedExploreReleaseReady(config)) {
    registry = mergeStockPairedExploreModel(
      registry,
      await withReadStage("stock-paired", () =>
        readStockPairedExploreModel(config, snapshotBlockNumber),
      ),
    );
  }
  return registry;
}

let cachedRead:
  | {
      key: string;
      expiresAt: number;
      value: Promise<ExploreReadModel>;
    }
  | undefined;

const liveReadFlights = new Map<string, Promise<ExploreReadModel>>();

function liveReadFlightKey(config: OnchainDeployment) {
  return [
    config.environment,
    config.status,
    config.chainId,
    config.releaseVersion,
    config.launcher,
    config.feeHook,
    config.deploymentBlock,
    config.rpcUrl,
    config.rpcUrlSecondary,
    config.confirmations,
    config.logBlockRange,
  ].join(":");
}

function emptyReadModel(): ExploreReadModel {
  return {
    status: "not-deployed",
    tokens: [],
    snapshot: null,
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}

export async function readLiveExploreModel(
  config: OnchainDeployment = getPublicOnchainDeployment(),
): Promise<ExploreReadModel> {
  const key = liveReadFlightKey(config);
  const existing = liveReadFlights.get(key);
  if (existing) return existing;
  const value = (async () => {
    const model = config.status === "ready"
      ? readReadyRegistryModel(config)
      : emptyReadModel();
    const resolvedModel = await model;
    if (config.status !== "ready") return resolvedModel;

    try {
      return await enrichExploreModelWithUsd(resolvedModel, config);
    } catch (error) {
      console.error("ETH/USD enrichment failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      return resolvedModel;
    }
  })();
  liveReadFlights.set(key, value);
  try {
    return await value;
  } finally {
    if (liveReadFlights.get(key) === value) {
      liveReadFlights.delete(key);
    }
  }
}

export async function readExploreModel(
  config: OnchainDeployment = getPublicOnchainDeployment(),
): Promise<ExploreReadModel> {
  if (config.status === "not-deployed") {
    return emptyReadModel();
  }

  const cacheTtlMs = 15_000;
  const cacheKey = [
    config.chainId,
    config.launcher,
    config.deploymentBlock,
    config.confirmations,
    isDeepExploreReleaseReady(config) ? "deep-v1-ready" : "deep-v1-off",
    isDeepV2ExploreReleaseReady(config) ? "deep-v2-ready" : "deep-v2-off",
    isDeepV3ExploreReleaseReady(config) ? "deep-v3-ready" : "deep-v3-off",
    isStockPairedExploreReleaseReady(config)
      ? "stock-paired-ready"
      : "stock-paired-off",
    isClassicV3ExploreReleaseReady(config)
      ? "classic-v3-ready"
      : "classic-v3-off",
  ].join(":");
  if (
    cachedRead &&
    cachedRead.key === cacheKey &&
    cachedRead.expiresAt > Date.now()
  ) {
    return cachedRead.value;
  }

  const value = (async () => {
    return resolveExploreReadSource(config, {
      readDurable: readDurableExploreModel,
      selectFreshDurable: selectFreshDurableExploreModel,
      readLive: readReadyRegistryModel,
      enrichWithUsd: enrichExploreModelWithUsd,
      warn: console.warn,
      error: console.error,
    });
  })().catch((error) => {
    if (cachedRead?.value === value) cachedRead = undefined;
    throw error;
  });
  cachedRead = {
    key: cacheKey,
    expiresAt: Date.now() + cacheTtlMs,
    value,
  };
  return value;
}
