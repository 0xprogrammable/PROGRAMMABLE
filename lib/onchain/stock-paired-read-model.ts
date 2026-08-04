import {
  createPublicClient,
  formatUnits,
  getAddress,
  HttpRequestError,
  http,
  keccak256,
  parseAbiItem,
  ResponseBodyTooLargeError,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";

import {
  getStockPairedExpectedInitialTickForRelease,
  getStockPairedQuoteAssetForRelease,
  STOCK_PAIRED_CREATOR_FEE_BPS,
  STOCK_PAIRED_PROGRAMMABLE_FEE_BPS,
  STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
  stockPairedHookAbi,
} from "../stock-paired";
import {
  getConfiguredStockPairedReleases,
  type VerifiedStockPairedRelease,
} from "../stock-paired-release";
import type { LauncherToken } from "../tokens";
import { stateViewReadAbi, uerc20ReadAbi } from "./abis";
import { buildTokenLinks, sanitizeImageUrl } from "./metadata";
import {
  enrichStockPairedTokenWithUsd,
  readStockQuoteAssetUsdWad,
} from "./stock-paired-usd";
import type {
  ExploreReadModel,
  ReadyOnchainDeployment,
} from "./types";

const launchedEvent = parseAbiItem(
  "event StockPairedTokenLaunched(address indexed deployer,address indexed token,address indexed quoteAsset,bytes32 poolId,address rewardVault,address positionRecipient,uint256 positionTokenId,bytes32 launchHash)",
);
const ethLaunchedEvent = parseAbiItem(
  "event StockPairedEthTokenLaunched(address indexed creator,address indexed token,address indexed quoteAsset,uint256 initialBuyEthAmount,uint256 initialBuyQuoteAmount,uint256 initialBuyTokenAmount,bytes32 launchHash)",
);
const liquidityEvent = parseAbiItem(
  "event StockPairedLiquidityConfigured(address indexed token,address indexed quoteAsset,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
);
const initialBuyEvent = parseAbiItem(
  "event StockPairedCreatorInitialBuy(address indexed deployer,address indexed token,address indexed quoteAsset,bytes32 poolId,uint256 quoteAmount,uint256 tokenAmount,bytes32 launchHash)",
);
const feeEvent = parseAbiItem(
  "event QuoteSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,address indexed quoteAsset,bool isBuy,uint256 grossQuoteAmount,uint256 creatorFee,uint256 launcherFee)",
);

type StockLaunch = {
  deployer: Address;
  token: Address;
  quoteAsset: Address;
  poolId: Hex;
  rewardVault: Address;
  positionRecipient: Address;
  positionTokenId: bigint;
  launchHash: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
};

type StockEthLaunch = {
  creator: Address;
  token: Address;
  quoteAsset: Address;
  initialBuyEthAmount: bigint;
  initialBuyQuoteAmount: bigint;
  initialBuyTokenAmount: bigint;
  launchHash: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
};

type StockLiquidity = {
  token: Address;
  quoteAsset: Address;
  totalSupply: bigint;
  tokenLiquidityAmount: bigint;
  lockedTokenDust: bigint;
  initialTick: number;
  tickLower: number;
  tickUpper: number;
  lpFeePips: number;
  launchHash: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
};

type StockInitialBuy = {
  deployer: Address;
  token: Address;
  quoteAsset: Address;
  poolId: Hex;
  quoteAmount: bigint;
  tokenAmount: bigint;
  launchHash: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
};

type StockVolume = {
  grossQuoteAmount: bigint;
  creatorFees: bigint;
  programmableFees: bigint;
  swapCount: number;
};

const EMPTY_VOLUME: StockVolume = {
  grossQuoteAmount: 0n,
  creatorFees: 0n,
  programmableFees: 0n,
  swapCount: 0,
};
const Q192 = 1n << 192n;
const WAD = 10n ** 18n;
const RPC_PROVENANCE_BATCH_SIZE = 1;
const TOKEN_HYDRATION_BATCH_SIZE = 6;
const BLOCK_TIMESTAMP_BATCH_SIZE = 4;
const QUOTE_PRICE_BATCH_SIZE = 2;
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

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function clientFor(endpoint: string) {
  return createPublicClient({
    chain: mainnet,
    batch: { multicall: true },
    transport: http(endpoint, { retryCount: 1, timeout: 10_000 }),
  });
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
    throw new Error(`${label} runtime does not match the release manifest`);
  }
}

function stockPriceQuoteWad(input: {
  sqrtPriceX96: bigint;
  quoteIsCurrency0: boolean;
  tokenDecimals: number;
  quoteDecimals: number;
}) {
  const {
    sqrtPriceX96,
    quoteIsCurrency0,
    tokenDecimals,
    quoteDecimals,
  } = input;
  if (sqrtPriceX96 <= 0n) {
    throw new Error("The Stock-Paired pool is not initialized");
  }
  const squared = sqrtPriceX96 * sqrtPriceX96;
  const tokenScale = 10n ** BigInt(tokenDecimals);
  const quoteScale = 10n ** BigInt(quoteDecimals);
  return quoteIsCurrency0
    ? (Q192 * tokenScale * WAD) / (squared * quoteScale)
    : (squared * tokenScale * WAD) / (Q192 * quoteScale);
}

async function readEvents(
  client: PublicClient,
  config: ReadyOnchainDeployment,
  release: VerifiedStockPairedRelease,
  toBlock: bigint,
  fromBlockFloor: bigint,
) {
  const launches: StockLaunch[] = [];
  const ethLaunches: StockEthLaunch[] = [];
  const liquidities: StockLiquidity[] = [];
  const initialBuys: StockInitialBuy[] = [];
  const volumes = new Map<string, StockVolume>();

  const releaseStartBlock = BigInt(release.startBlock);
  let fromBlock =
    fromBlockFloor > releaseStartBlock
      ? fromBlockFloor
      : releaseStartBlock;
  let logBlockRange = config.logBlockRange;
  while (fromBlock <= toBlock) {
    const rangeEnd = minimum(
      toBlock,
      fromBlock + logBlockRange - 1n,
    );
    const readLogs = () =>
      Promise.all([
        client.getLogs({
          address: release.addresses.launcher,
          event: launchedEvent,
          fromBlock,
          toBlock: rangeEnd,
          strict: true,
        }),
        client.getLogs({
          address: release.addresses.ethLaunchCoordinator,
          event: ethLaunchedEvent,
          fromBlock,
          toBlock: rangeEnd,
          strict: true,
        }),
        client.getLogs({
          address: release.addresses.launcher,
          event: liquidityEvent,
          fromBlock,
          toBlock: rangeEnd,
          strict: true,
        }),
        client.getLogs({
          address: release.addresses.launcher,
          event: initialBuyEvent,
          fromBlock,
          toBlock: rangeEnd,
          strict: true,
        }),
        client.getLogs({
          address: release.addresses.feeHook,
          event: feeEvent,
          fromBlock,
          toBlock: rangeEnd,
          strict: true,
        }),
      ]);
    let logs: Awaited<ReturnType<typeof readLogs>>;
    try {
      logs = await readLogs();
    } catch (error) {
      if (
        (error instanceof HttpRequestError ||
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
          "Stock-Paired log range reduced after RPC rejection",
          {
            release: release.internalContractRelease,
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
    const [
      launchLogs,
      ethLaunchLogs,
      liquidityLogs,
      initialBuyLogs,
      feeLogs,
    ] = logs;

    for (const log of launchLogs) {
      if (log.removed || log.blockNumber === null) continue;
      launches.push({
        deployer: getAddress(log.args.deployer),
        token: getAddress(log.args.token),
        quoteAsset: getAddress(log.args.quoteAsset),
        poolId: log.args.poolId,
        rewardVault: getAddress(log.args.rewardVault),
        positionRecipient: getAddress(log.args.positionRecipient),
        positionTokenId: log.args.positionTokenId,
        launchHash: log.args.launchHash,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        transactionIndex: log.transactionIndex,
        logIndex: log.logIndex,
      });
    }
    for (const log of ethLaunchLogs) {
      if (log.removed || log.blockNumber === null) continue;
      ethLaunches.push({
        creator: getAddress(log.args.creator),
        token: getAddress(log.args.token),
        quoteAsset: getAddress(log.args.quoteAsset),
        initialBuyEthAmount: log.args.initialBuyEthAmount,
        initialBuyQuoteAmount: log.args.initialBuyQuoteAmount,
        initialBuyTokenAmount: log.args.initialBuyTokenAmount,
        launchHash: log.args.launchHash,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        transactionIndex: log.transactionIndex,
        logIndex: log.logIndex,
      });
    }
    for (const log of liquidityLogs) {
      if (log.removed || log.blockNumber === null) continue;
      liquidities.push({
        token: getAddress(log.args.token),
        quoteAsset: getAddress(log.args.quoteAsset),
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
      });
    }
    for (const log of initialBuyLogs) {
      if (log.removed || log.blockNumber === null) continue;
      initialBuys.push({
        deployer: getAddress(log.args.deployer),
        token: getAddress(log.args.token),
        quoteAsset: getAddress(log.args.quoteAsset),
        poolId: log.args.poolId,
        quoteAmount: log.args.quoteAmount,
        tokenAmount: log.args.tokenAmount,
        launchHash: log.args.launchHash,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
      });
    }
    for (const log of feeLogs) {
      if (log.removed || log.blockNumber === null) continue;
      const key = log.args.poolId.toLowerCase();
      const current = volumes.get(key) ?? { ...EMPTY_VOLUME };
      current.grossQuoteAmount += log.args.grossQuoteAmount;
      current.creatorFees += log.args.creatorFee;
      current.programmableFees += log.args.launcherFee;
      current.swapCount += 1;
      volumes.set(key, current);
    }
    fromBlock = rangeEnd + 1n;
  }

  return { launches, ethLaunches, liquidities, initialBuys, volumes };
}

function eventFingerprint(value: Awaited<ReturnType<typeof readEvents>>) {
  return JSON.stringify(
    {
      launches: value.launches,
      ethLaunches: value.ethLaunches,
      liquidities: value.liquidities,
      initialBuys: value.initialBuys,
      volumes: [...value.volumes.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    },
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
  );
}

export function pairStockPairedLaunches(
  events: Awaited<ReturnType<typeof readEvents>>,
) {
  if (
    events.launches.length !== events.liquidities.length ||
    events.launches.length !== events.initialBuys.length ||
    events.launches.length !== events.ethLaunches.length
  ) {
    throw new Error("Unpaired Stock-Paired launch evidence");
  }
  const tokens = new Set<string>();
  const pools = new Set<string>();
  for (const launch of events.launches) {
    const tokenKey = launch.token.toLowerCase();
    const poolKey = launch.poolId.toLowerCase();
    if (tokens.has(tokenKey) || pools.has(poolKey)) {
      throw new Error(
        `Duplicate Stock-Paired launch provenance for ${launch.token}`,
      );
    }
    tokens.add(tokenKey);
    pools.add(poolKey);
  }
  return events.launches.map((launch) => {
    const liquidity = events.liquidities.filter(
      (candidate) =>
        sameHex(candidate.token, launch.token) &&
        sameHex(candidate.quoteAsset, launch.quoteAsset) &&
        sameHex(candidate.launchHash, launch.launchHash) &&
        sameHex(candidate.transactionHash, launch.transactionHash) &&
        candidate.blockNumber === launch.blockNumber,
    );
    const initialBuy = events.initialBuys.filter(
      (candidate) =>
        sameHex(candidate.deployer, launch.deployer) &&
        sameHex(candidate.token, launch.token) &&
        sameHex(candidate.quoteAsset, launch.quoteAsset) &&
        sameHex(candidate.poolId, launch.poolId) &&
        sameHex(candidate.launchHash, launch.launchHash) &&
        sameHex(candidate.transactionHash, launch.transactionHash) &&
        candidate.blockNumber === launch.blockNumber,
    );
    const ethLaunch = events.ethLaunches.filter(
      (candidate) =>
        sameHex(candidate.token, launch.token) &&
        sameHex(candidate.quoteAsset, launch.quoteAsset) &&
        sameHex(candidate.launchHash, launch.launchHash) &&
        sameHex(candidate.transactionHash, launch.transactionHash) &&
        candidate.blockNumber === launch.blockNumber,
    );
    if (
      liquidity.length !== 1 ||
      initialBuy.length !== 1 ||
      ethLaunch.length !== 1 ||
      ethLaunch[0].initialBuyQuoteAmount !== initialBuy[0].quoteAmount ||
      ethLaunch[0].initialBuyTokenAmount !== initialBuy[0].tokenAmount ||
      ethLaunch[0].initialBuyEthAmount <= 0n
    ) {
      throw new Error(
        `Incomplete Stock-Paired launch provenance for ${launch.token}`,
      );
    }
    return {
      launch,
      ethLaunch: ethLaunch[0],
      liquidity: liquidity[0],
      initialBuy: initialBuy[0],
    };
  });
}

async function hydrateToken(
  client: PublicClient,
  config: ReadyOnchainDeployment,
  release: VerifiedStockPairedRelease,
  record: ReturnType<typeof pairStockPairedLaunches>[number],
  volume: StockVolume,
  timestamp: bigint,
  snapshotBlock: bigint,
): Promise<LauncherToken> {
  const { launch, ethLaunch, liquidity, initialBuy } = record;
  const quote = getStockPairedQuoteAssetForRelease(
    release,
    launch.quoteAsset,
  );
  if (!quote) {
    throw new Error(`Unsupported quote asset in launch ${launch.token}`);
  }

  const [
    name,
    symbol,
    decimals,
    totalSupply,
    recordedCreator,
    metadata,
    slot0,
    activeLiquidity,
    feeConfig,
    disclosure,
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
      address: release.addresses.feeHook,
      abi: stockPairedHookAbi,
      functionName: "poolFeeConfig",
      args: [launch.poolId],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.addresses.feeHook,
      abi: stockPairedHookAbi,
      functionName: "feeDisclosure",
      args: [launch.poolId],
      blockNumber: snapshotBlock,
    }),
  ]);

  const [sqrtPriceX96, currentTick, protocolFeePips, lpFeePips] =
    slot0;
  const [
    configuredQuote,
    configuredToken,
    configuredVault,
    registrar,
    quoteIsCurrency0,
    registered,
    creatorFeesAccrued,
  ] = feeConfig;
  const [
    disclosedQuote,
    disclosedToken,
    buyFeeBps,
    sellFeeBps,
    creatorFeeBps,
    programmableFeeBps,
    transferTaxBps,
    disclosedLpFeePips,
    disclosedVault,
  ] = disclosure;
  const expectedInitialTick =
    getStockPairedExpectedInitialTickForRelease(
      release,
      quote.address,
      quoteIsCurrency0,
    );

  if (
    getAddress(recordedCreator) !== release.addresses.launcher ||
    totalSupply !== liquidity.totalSupply ||
    !registered ||
    !sameHex(configuredQuote, quote.address) ||
    !sameHex(configuredToken, launch.token) ||
    !sameHex(configuredVault, launch.rewardVault) ||
    !sameHex(registrar, release.addresses.launcher) ||
    !sameHex(disclosedQuote, quote.address) ||
    !sameHex(disclosedToken, launch.token) ||
    !sameHex(disclosedVault, launch.rewardVault) ||
    buyFeeBps !== STOCK_PAIRED_TOTAL_SWAP_FEE_BPS ||
    sellFeeBps !== STOCK_PAIRED_TOTAL_SWAP_FEE_BPS ||
    creatorFeeBps !== STOCK_PAIRED_CREATOR_FEE_BPS ||
    programmableFeeBps !== STOCK_PAIRED_PROGRAMMABLE_FEE_BPS ||
    transferTaxBps !== 0 ||
    disclosedLpFeePips !== 0 ||
    lpFeePips !== 0 ||
    liquidity.lpFeePips !== 0 ||
    expectedInitialTick === null ||
    liquidity.initialTick !== expectedInitialTick ||
    initialBuy.quoteAmount <= 0n ||
    initialBuy.tokenAmount <= 0n ||
    !sameHex(launch.deployer, release.addresses.ethLaunchCoordinator)
  ) {
    throw new Error(
      `Stock-Paired launch provenance mismatch for ${launch.token}`,
    );
  }

  const tokenPriceQuoteWad = stockPriceQuoteWad({
    sqrtPriceX96,
    quoteIsCurrency0,
    tokenDecimals: decimals,
    quoteDecimals: 18,
  });
  const marketCapQuoteWad =
    (totalSupply * tokenPriceQuoteWad) / 10n ** BigInt(decimals);
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
    hookAddress: release.addresses.feeHook,
    poolId: launch.poolId,
    creatorAddress: ethLaunch.creator,
    positionRecipient: launch.positionRecipient,
    positionTokenId: launch.positionTokenId.toString(),
    rewardVaultAddress: launch.rewardVault,
    launchHash: launch.launchHash,
    launchBlockNumber: launch.blockNumber.toString(),
    launchTransactionHash: launch.transactionHash,
    launchTransactionIndex: launch.transactionIndex,
    launchLogIndex: launch.logIndex,
    launchedAt: new Date(Number(timestamp) * 1_000).toISOString(),
    totalSupply: formatUnits(totalSupply, decimals),
    totalSupplyRaw: totalSupply.toString(),
    tokenDecimals: decimals,
    tokenLiquidityAmountRaw: liquidity.tokenLiquidityAmount.toString(),
    lockedTokenDustRaw: liquidity.lockedTokenDust.toString(),
    quoteAssetAddress: quote.address,
    quoteAssetSymbol: quote.symbol,
    quoteAssetName: quote.name,
    quoteIsCurrency0,
    tokenPriceQuote: formatUnits(tokenPriceQuoteWad, 18),
    tokenPriceQuoteWad: tokenPriceQuoteWad.toString(),
    marketCapQuote: formatUnits(marketCapQuoteWad, 18),
    marketCapQuoteWad: marketCapQuoteWad.toString(),
    grossVolumeQuote: formatUnits(volume.grossQuoteAmount, 18),
    grossVolumeQuoteRaw: volume.grossQuoteAmount.toString(),
    creatorFeesGeneratedQuote: formatUnits(volume.creatorFees, 18),
    creatorFeesGeneratedQuoteRaw: volume.creatorFees.toString(),
    programmableFeesGeneratedQuote: formatUnits(
      volume.programmableFees,
      18,
    ),
    programmableFeesGeneratedQuoteRaw:
      volume.programmableFees.toString(),
    creatorFeesAccruedQuote: formatUnits(creatorFeesAccrued, 18),
    creatorFeesAccruedQuoteRaw: creatorFeesAccrued.toString(),
    swapCount: volume.swapCount,
    currentTick,
    initialTick: liquidity.initialTick,
    tickLower: liquidity.tickLower,
    tickUpper: liquidity.tickUpper,
    activeLiquidity: activeLiquidity.toString(),
    protocolFeePips,
    lpFeePips,
    buyHookFeeBps: buyFeeBps,
    sellHookFeeBps: sellFeeBps,
    creatorFeeBps,
    programmableFeeBps,
    launcherFeeBps: programmableFeeBps,
    transferTaxBps,
    totalSwapFeeBps: STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
    launchModel: "stock-paired",
    launchModelVersion: release.internalContractRelease,
    liquidityPath: "meme",
    metadataExtraData: extraData,
  };
}

export function isStockPairedExploreReleaseReady(
  config: ReadyOnchainDeployment,
) {
  return (
    config.environment === "production" &&
    config.chainId === 1 &&
    getConfiguredStockPairedReleases().length > 0
  );
}

export async function readStockPairedExploreModel(
  config: ReadyOnchainDeployment,
  snapshotBlockNumber: string,
  options: Readonly<{ fromBlock?: bigint }> = {},
): Promise<LauncherToken[]> {
  const releases = getConfiguredStockPairedReleases();
  if (
    releases.length === 0 ||
    !isStockPairedExploreReleaseReady(config) ||
    !/^(?:0|[1-9]\d*)$/.test(snapshotBlockNumber)
  ) {
    return [];
  }
  const toBlock = BigInt(snapshotBlockNumber);
  const activeReleases = releases.filter(
    (release) => toBlock >= BigInt(release.startBlock),
  );
  if (activeReleases.length === 0) return [];

  const clients = [
    clientFor(config.rpcUrl),
    ...(config.rpcUrlSecondary ? [clientFor(config.rpcUrlSecondary)] : []),
  ];
  await mapInBatches(
    clients,
    RPC_PROVENANCE_BATCH_SIZE,
    (candidate) =>
      mapInBatches(
        [
          {
            address: config.stateView,
            expectedHash: config.stateViewRuntimeCodeHash,
            label: "Uniswap StateView",
          },
          ...activeReleases.flatMap((release) => [
            {
              address: release.addresses.launcher,
              expectedHash: release.runtimeCodeHashes.launcher,
              label: `${release.internalContractRelease} launcher`,
            },
            {
              address: release.addresses.ethLaunchCoordinator,
              expectedHash:
                release.runtimeCodeHashes.ethLaunchCoordinator,
              label: `${release.internalContractRelease} ETH launch coordinator`,
            },
            {
              address: release.addresses.feeHook,
              expectedHash: release.runtimeCodeHashes.feeHook,
              label: `${release.internalContractRelease} hook`,
            },
            {
              address: release.addresses.quoteRegistry,
              expectedHash: release.runtimeCodeHashes.quoteRegistry,
              label: `${release.internalContractRelease} quote registry`,
            },
            {
              address: release.addresses.feeSplitVaultFactory,
              expectedHash:
                release.runtimeCodeHashes.feeSplitVaultFactory,
              label: `${release.internalContractRelease} reward-vault factory`,
            },
          ]),
        ],
        1,
        ({ address, expectedHash, label }) =>
          assertRuntime(
            candidate,
            address,
            expectedHash,
            toBlock,
            label,
          ),
      ),
  );

  const tokenGroups = await mapInBatches(
    activeReleases,
    1,
    async (release) => {
      const eventSets = await mapInBatches(
        clients,
        RPC_PROVENANCE_BATCH_SIZE,
        (candidate) =>
          readEvents(
            candidate,
            config,
            release,
            toBlock,
            options.fromBlock ?? BigInt(release.startBlock),
          ),
      );
      const fingerprint = eventFingerprint(eventSets[0]);
      if (
        eventSets.some(
          (candidate) => eventFingerprint(candidate) !== fingerprint,
        )
      ) {
        throw new Error(
          `Independent RPCs disagree on ${release.internalContractRelease} launch events`,
        );
      }

      const records = pairStockPairedLaunches(eventSets[0]);
      const timestamps = new Map<string, bigint>();
      await mapInBatches(
        [
          ...new Set(
            records.map(({ launch }) => launch.blockNumber.toString()),
          ),
        ],
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
        (candidate) =>
          mapInBatches(
            records,
            TOKEN_HYDRATION_BATCH_SIZE,
            (record) =>
              hydrateToken(
                candidate,
                config,
                release,
                record,
                eventSets[0].volumes.get(
                  record.launch.poolId.toLowerCase(),
                ) ?? EMPTY_VOLUME,
                timestamps.get(record.launch.blockNumber.toString()) ?? 0n,
                toBlock,
              ),
          ),
      );
      const tokenFingerprint = JSON.stringify(tokenSets[0]);
      if (
        tokenSets.some(
          (candidate) => JSON.stringify(candidate) !== tokenFingerprint,
        )
      ) {
        throw new Error(
          `Independent RPCs disagree on ${release.internalContractRelease} token state`,
        );
      }
      const quoteAssetPrices = new Map<string, bigint | null>();
      await mapInBatches(
        [
          ...new Set(
            tokenSets[0]
              .map((token) => token.quoteAssetAddress?.toLowerCase())
              .filter((address): address is string => Boolean(address)),
          ),
        ],
        QUOTE_PRICE_BATCH_SIZE,
        async (address) => {
          quoteAssetPrices.set(
            address,
            await readStockQuoteAssetUsdWad({
              clients,
              quoteAsset: getAddress(address),
              expectedQuoteAssetRuntimeCodeHash:
                release.issuerRuntime.tokenRuntimeCodeHash,
              blockNumber: toBlock,
            }),
          );
        },
      );

      return tokenSets[0].map((token) =>
        enrichStockPairedTokenWithUsd(
          token,
          token.quoteAssetAddress
            ? (quoteAssetPrices.get(
                token.quoteAssetAddress.toLowerCase(),
              ) ?? null)
            : null,
        ),
      );
    },
  );
  const tokens = tokenGroups.flat();
  if (
    new Set(tokens.map((token) => token.tokenAddress.toLowerCase())).size !==
    tokens.length
  ) {
    throw new Error("Duplicate token across Stock-Paired releases");
  }
  return tokens;
}

function isSameStockPairedLaunch(
  existing: LauncherToken,
  incoming: LauncherToken,
) {
  return (
    existing.launchModel === "stock-paired" &&
    incoming.launchModel === "stock-paired" &&
    existing.launchHash !== undefined &&
    incoming.launchHash !== undefined &&
    existing.launchTransactionHash !== undefined &&
    incoming.launchTransactionHash !== undefined &&
    existing.creatorAddress !== undefined &&
    incoming.creatorAddress !== undefined &&
    existing.positionRecipient !== undefined &&
    incoming.positionRecipient !== undefined &&
    existing.positionTokenId !== undefined &&
    incoming.positionTokenId !== undefined &&
    existing.rewardVaultAddress !== undefined &&
    incoming.rewardVaultAddress !== undefined &&
    existing.quoteAssetAddress !== undefined &&
    incoming.quoteAssetAddress !== undefined &&
    sameHex(existing.tokenAddress, incoming.tokenAddress) &&
    sameHex(existing.hookAddress, incoming.hookAddress) &&
    sameHex(existing.poolId, incoming.poolId) &&
    sameHex(existing.launchHash, incoming.launchHash) &&
    sameHex(
      existing.launchTransactionHash,
      incoming.launchTransactionHash,
    ) &&
    sameHex(existing.creatorAddress, incoming.creatorAddress) &&
    sameHex(existing.positionRecipient, incoming.positionRecipient) &&
    existing.positionTokenId === incoming.positionTokenId &&
    sameHex(existing.rewardVaultAddress, incoming.rewardVaultAddress) &&
    sameHex(existing.quoteAssetAddress, incoming.quoteAssetAddress) &&
    existing.launchBlockNumber === incoming.launchBlockNumber &&
    existing.launchTransactionIndex === incoming.launchTransactionIndex &&
    existing.launchLogIndex === incoming.launchLogIndex
  );
}

export function mergeStockPairedExploreModel<T extends ExploreReadModel>(
  model: T,
  stockTokens: readonly LauncherToken[],
): T {
  if (model.status !== "ready" || stockTokens.length === 0) return model;
  const tokens = new Map(
    model.tokens.map((token) => [token.tokenAddress.toLowerCase(), token]),
  );
  for (const token of stockTokens) {
    const key = token.tokenAddress.toLowerCase();
    const existing = tokens.get(key);
    if (existing && !isSameStockPairedLaunch(existing, token)) {
      throw new Error(
        `Duplicate token across launch models: ${token.tokenAddress}`,
      );
    }
    tokens.set(key, token);
  }
  return { ...model, tokens: [...tokens.values()] } as T;
}
