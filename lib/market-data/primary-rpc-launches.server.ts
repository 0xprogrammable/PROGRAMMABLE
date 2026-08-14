import "server-only";

import { mainnet } from "viem/chains";
import {
  createPublicClient,
  formatUnits,
  http,
  parseAbiItem,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";

import classicV2Manifest from
  "../../contracts/deployments/mainnet-classic-v2.json";
import classicV3Manifest from
  "../../contracts/deployments/mainnet-classic-v3.json";
import stockV1Manifest from
  "../../contracts/deployments/mainnet-stock-paired-v1.json";
import stockV2Manifest from
  "../../contracts/deployments/mainnet-stock-paired-v2.json";
import stockV3Manifest from
  "../../contracts/deployments/mainnet-stock-paired-v3.json";
import { canonicalTokenExploreEntryV1 } from "../explore-entry-v1";
import {
  memeLiquidityConfiguredEvent,
  memeTokenLaunchedEvent,
  uerc20ReadAbi,
} from "../onchain/abis";
import { buildTokenLinks, sanitizeImageUrl } from "../onchain/metadata";
import { productionMainnetRpcPrimary } from
  "../onchain/website-rpc-providers.server";
import {
  STOCK_PAIRED_CREATOR_FEE_BPS,
  STOCK_PAIRED_PROGRAMMABLE_FEE_BPS,
  STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
} from "../stock-paired";
import type { ExploreEntry, LauncherToken } from "../tokens";

export const PRIMARY_RPC_LAUNCH_CATALOG_BUDGET_MS = 18_000;

const REQUEST_TIMEOUT_MS = 4_000;
const LOG_WINDOW_RANGE = 4_096n;
const MAXIMUM_CONCURRENT_LOG_WINDOWS = 6;
const MAXIMUM_LOG_WINDOW_ATTEMPTS = 2;
const MAXIMUM_HEAD_READ_ATTEMPTS = 2;
const MAXIMUM_LOGS = 10_000;
const MAXIMUM_LAUNCHES = 5_000;
const MAXIMUM_CONCURRENT_RPC_READS = 100;

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;

const memeTokenLaunchedV2Event = parseAbiItem(
  "event MemeTokenLaunchedV2(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address rewardVault,address positionRecipient,uint256 positionTokenId,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 rewardConfigurationHash,bytes32 launchHash)",
);
const memeLiquidityConfiguredV2Event = parseAbiItem(
  "event MemeLiquidityConfiguredV2(address indexed token,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
);
const stockPairedTokenLaunchedEvent = parseAbiItem(
  "event StockPairedTokenLaunched(address indexed deployer,address indexed token,address indexed quoteAsset,bytes32 poolId,address rewardVault,address positionRecipient,uint256 positionTokenId,bytes32 launchHash)",
);
const stockPairedEthTokenLaunchedEvent = parseAbiItem(
  "event StockPairedEthTokenLaunched(address indexed creator,address indexed token,address indexed quoteAsset,uint256 initialBuyEthAmount,uint256 initialBuyQuoteAmount,uint256 initialBuyTokenAmount,bytes32 launchHash)",
);
const stockPairedLiquidityConfiguredEvent = parseAbiItem(
  "event StockPairedLiquidityConfigured(address indexed token,address indexed quoteAsset,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
);

const SPARSE_LAUNCH_EVENTS = Object.freeze([
  memeTokenLaunchedEvent,
  memeLiquidityConfiguredEvent,
  memeTokenLaunchedV2Event,
  memeLiquidityConfiguredV2Event,
  stockPairedTokenLaunchedEvent,
  stockPairedEthTokenLaunchedEvent,
  stockPairedLiquidityConfiguredEvent,
] satisfies readonly AbiEvent[]);

type ReleaseDefinition = Readonly<{
  releaseId:
    | "classic-v2"
    | "classic-v3"
    | "stock-paired-v1"
    | "stock-paired-v2"
    | "stock-paired-v3";
  model: "classic" | "stock-paired";
  launcher: Address;
  ethLaunchCoordinator: Address | null;
  hook: Address;
  startBlock: bigint;
  launchEvent:
    | "MemeTokenLaunched"
    | "MemeTokenLaunchedV2"
    | "StockPairedTokenLaunched";
  liquidityEvent:
    | "MemeLiquidityConfigured"
    | "MemeLiquidityConfiguredV2"
    | "StockPairedLiquidityConfigured";
}>;

const RELEASES = Object.freeze([
  releaseDefinition({
    releaseId: "classic-v2",
    model: "classic",
    manifest: classicV2Manifest,
    launcherKey: "memeLauncher",
    startBlock: classicV2Manifest.deploymentBlock,
    launchEvent: "MemeTokenLaunched",
    liquidityEvent: "MemeLiquidityConfigured",
  }),
  releaseDefinition({
    releaseId: "classic-v3",
    model: "classic",
    manifest: classicV3Manifest,
    launcherKey: "launcher",
    startBlock:
      classicV3Manifest.sourceVerification.contracts.launcher.deploymentBlock,
    launchEvent: "MemeTokenLaunchedV2",
    liquidityEvent: "MemeLiquidityConfiguredV2",
  }),
  releaseDefinition({
    releaseId: "stock-paired-v1",
    model: "stock-paired",
    manifest: stockV1Manifest,
    launcherKey: "launcher",
    startBlock: stockV1Manifest.startBlock,
    launchEvent: "StockPairedTokenLaunched",
    liquidityEvent: "StockPairedLiquidityConfigured",
  }),
  releaseDefinition({
    releaseId: "stock-paired-v2",
    model: "stock-paired",
    manifest: stockV2Manifest,
    launcherKey: "launcher",
    startBlock: stockV2Manifest.startBlock,
    launchEvent: "StockPairedTokenLaunched",
    liquidityEvent: "StockPairedLiquidityConfigured",
  }),
  releaseDefinition({
    releaseId: "stock-paired-v3",
    model: "stock-paired",
    manifest: stockV3Manifest,
    launcherKey: "launcher",
    startBlock: stockV3Manifest.startBlock,
    launchEvent: "StockPairedTokenLaunched",
    liquidityEvent: "StockPairedLiquidityConfigured",
  }),
] satisfies readonly ReleaseDefinition[]);

const RELEASE_BY_LAUNCHER = new Map(
  RELEASES.map((release) => [release.launcher, release] as const),
);
const RELEASE_BY_ETH_LAUNCH_COORDINATOR = new Map(
  RELEASES.flatMap((release) => release.ethLaunchCoordinator === null
    ? []
    : [[release.ethLaunchCoordinator, release] as const]),
);
const SPARSE_EVENT_ADDRESSES = Object.freeze([
  ...RELEASE_BY_LAUNCHER.keys(),
  ...RELEASE_BY_ETH_LAUNCH_COORDINATOR.keys(),
]);
const EARLIEST_START_BLOCK = RELEASES.reduce(
  (minimum, release) => release.startBlock < minimum
    ? release.startBlock
    : minimum,
  RELEASES[0]!.startBlock,
);

export type PrimaryRpcExploreEntriesV1 = Readonly<{
  source: "drpc";
  generatedAt: string;
  asOfBlock: string | null;
  asOfBlockHash: Hex | null;
  entries: readonly ExploreEntry[];
}>;

export type PrimaryRpcLaunchCatalogErrorCategory =
  | "configuration"
  | "transport"
  | "response"
  | "integrity"
  | "runtime";

export type PrimaryRpcLaunchCatalogPhase =
  | "initialization"
  | "head"
  | "logs"
  | "selection"
  | "metadata"
  | "blocks"
  | "entries";

export class PrimaryRpcLaunchCatalogError extends Error {
  override name = "PrimaryRpcLaunchCatalogError";

  constructor(
    readonly category: PrimaryRpcLaunchCatalogErrorCategory,
    readonly phase: PrimaryRpcLaunchCatalogPhase | "unassigned" = "unassigned",
  ) {
    super("Launch catalog is temporarily unavailable");
  }
}

export function safePrimaryRpcLaunchCatalogError(error: unknown): Readonly<{
  name: string;
  category: PrimaryRpcLaunchCatalogErrorCategory | "unexpected";
  phase: PrimaryRpcLaunchCatalogPhase | "unassigned" | "external";
  status: 503;
}> {
  return error instanceof PrimaryRpcLaunchCatalogError
    ? {
        name: error.name,
        category: error.category,
        phase: error.phase,
        status: 503,
      }
    : {
        name: "LaunchCatalogError",
        category: "unexpected",
        phase: "external",
        status: 503,
      };
}

export type PrimaryRpcLogQuery = Readonly<{
  address: readonly Address[];
  events: readonly AbiEvent[];
  fromBlock: bigint;
  toBlock: bigint;
  strict: true;
}>;

export type PrimaryRpcContractRead = Readonly<{
  address: Address;
  functionName: "name" | "symbol" | "decimals" | "metadata";
  blockNumber: bigint;
}>;

export type PrimaryRpcLaunchCatalogClient = Readonly<{
  getBlockNumber(): Promise<bigint>;
  getBlock(input: Readonly<{ blockNumber: bigint }>): Promise<unknown>;
  getLogs(input: PrimaryRpcLogQuery): Promise<readonly unknown[]>;
  readContract(input: PrimaryRpcContractRead): Promise<unknown>;
}>;

export type PrimaryRpcLaunchCatalogReaderOptions = Readonly<{
  signal?: AbortSignal;
  now?: Date;
  requestedTokenAddress?: Address;
  environment?: Readonly<Record<string, string | undefined>>;
  client?: PrimaryRpcLaunchCatalogClient;
}>;

type RpcEvent = Readonly<{
  release: ReleaseDefinition;
  source: "launcher" | "eth-launch-coordinator";
  name: string;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
  args: Readonly<Record<string, unknown>>;
}>;

type ParsedStockCreatorIdentity = Readonly<{
  release: ReleaseDefinition;
  event: RpcEvent;
  creator: Address;
  token: Address;
  quoteAsset: Address;
  launchHash: Hex;
}>;

type ParsedLaunch = Readonly<{
  release: ReleaseDefinition;
  event: RpcEvent;
  token: Address;
  poolId: Hex;
  creator?: Address;
  hook: Address;
  quoteAsset?: Address;
  rewardVault?: Address;
  positionRecipient: Address;
  positionTokenId: string;
  launchHash: Hex;
  buySwapFeeBps?: number;
  sellSwapFeeBps?: number;
  totalSwapFeeBps: number;
}>;

type ParsedLiquidity = Readonly<{
  event: RpcEvent;
  token: Address;
  quoteAsset?: Address;
  totalSupplyRaw: string;
  tokenLiquidityAmountRaw: string;
  lockedTokenDustRaw: string;
  initialTick: number;
  tickLower: number;
  tickUpper: number;
  lpFeePips: number;
  launchHash: Hex;
}>;

type TokenMetadata = Readonly<{
  name: string;
  symbol: string;
  decimals: number;
  description?: string;
  imageUrl?: string;
  links?: LauncherToken["links"];
  extraData?: Hex;
}>;

type BoundBlock = Readonly<{
  number: bigint;
  hash: Hex;
  timestamp: bigint;
}>;

export async function readPrimaryRpcExploreEntriesV1(
  options: PrimaryRpcLaunchCatalogReaderOptions = {},
): Promise<PrimaryRpcExploreEntriesV1> {
  const budget = createCatalogBudget(options.signal);
  const signal = budget.signal;
  let phase: PrimaryRpcLaunchCatalogPhase = "initialization";
  try {
    assertNotAborted(signal);
    const requestedToken = options.requestedTokenAddress === undefined
      ? null
      : canonicalAddress(options.requestedTokenAddress);
    if (options.requestedTokenAddress !== undefined && requestedToken === null) {
      throw new PrimaryRpcLaunchCatalogError("configuration");
    }
    const client = options.client ?? createPrimaryRpcClient(
      options.environment,
      signal,
    );
    const now = options.now ?? new Date();

    phase = "head";
    const headNumber = await readHeadWithRetry(
      () => client.getBlockNumber(),
      signal,
    );
    if (typeof headNumber !== "bigint" || headNumber < EARLIEST_START_BLOCK) {
      throw new PrimaryRpcLaunchCatalogError("response");
    }
    const head = parseBlock(
      await readHeadWithRetry(
        () => client.getBlock({ blockNumber: headNumber }),
        signal,
      ),
      headNumber,
    );

    phase = "logs";
    const rawLogs = await scanSparseLogs(client, head.number, signal);
    const events = rawLogs.map(parseRpcEvent).sort(compareRpcEvents);
    const parsed = parseLaunchEvents(events);
    const boundLaunches = bindStockCreatorIdentities(
      parsed.launches,
      parsed.stockCreatorIdentities,
    );
    if (boundLaunches.length > MAXIMUM_LAUNCHES) {
      throw new PrimaryRpcLaunchCatalogError("integrity");
    }

    phase = "selection";
    const launches = requestedToken === null
      ? boundLaunches
      : boundLaunches.filter((launch) => launch.token === requestedToken);
    const liquidities = requestedToken === null
      ? parsed.liquidities
      : parsed.liquidities.filter((liquidity) =>
          liquidity.token === requestedToken
        );
    if (launches.length === 0) {
      if (liquidities.length !== 0 ||
          (requestedToken === null && parsed.liquidities.length !== 0)) {
        throw new PrimaryRpcLaunchCatalogError("integrity");
      }
      return emptyCatalog(now, head);
    }

    phase = "metadata";
    const metadata = await readMetadata(
      client,
      [...new Set(launches.map((launch) => launch.token))],
      [...new Set(launches.flatMap((launch) =>
        launch.quoteAsset ? [launch.quoteAsset] : []
      ))],
      head.number,
      signal,
    );

    phase = "blocks";
    const launchBlocks = await readLaunchBlocks(
      client,
      launches,
      signal,
    );

    phase = "entries";
    assertNotAborted(signal);
    const entries = launches.map((launch) => buildExploreEntry(
      launch,
      requireLiquidity(launch, liquidities),
      requireLaunchBlock(launch, launchBlocks),
      metadata,
    ));
    if (liquidities.length !== launches.length) {
      throw new PrimaryRpcLaunchCatalogError("integrity");
    }
    assertUniqueCatalog(entries);
    assertNotAborted(signal);
    return {
      source: "drpc",
      generatedAt: now.toISOString(),
      asOfBlock: head.number.toString(),
      asOfBlockHash: head.hash,
      entries: entries.sort(compareEntries),
    };
  } catch (error) {
    throw normalizedCatalogError(error, phase);
  } finally {
    budget.dispose();
  }
}

function emptyCatalog(now: Date, head: BoundBlock): PrimaryRpcExploreEntriesV1 {
  return {
    source: "drpc",
    generatedAt: now.toISOString(),
    asOfBlock: head.number.toString(),
    asOfBlockHash: head.hash,
    entries: [],
  };
}

function createPrimaryRpcClient(
  environment: Readonly<Record<string, string | undefined>> | undefined,
  signal: AbortSignal,
): PrimaryRpcLaunchCatalogClient {
  let binding;
  try {
    binding = productionMainnetRpcPrimary(environment);
  } catch {
    throw new PrimaryRpcLaunchCatalogError("configuration");
  }
  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(binding.url, {
      batch: { batchSize: 100, wait: 0 },
      fetchOptions: { signal },
      retryCount: 0,
      timeout: REQUEST_TIMEOUT_MS,
    }),
  });
  return {
    getBlockNumber: () => publicClient.getBlockNumber(),
    getBlock: ({ blockNumber }) => publicClient.getBlock({ blockNumber }),
    getLogs: async (query) => publicClient.getLogs({
      address: [...query.address],
      events: [...query.events],
      fromBlock: query.fromBlock,
      toBlock: query.toBlock,
      strict: query.strict,
    }) as unknown as readonly unknown[],
    readContract: ({ address, functionName, blockNumber }) => {
      if (functionName === "name") {
        return publicClient.readContract({
          address,
          abi: uerc20ReadAbi,
          functionName: "name",
          blockNumber,
        });
      }
      if (functionName === "symbol") {
        return publicClient.readContract({
          address,
          abi: uerc20ReadAbi,
          functionName: "symbol",
          blockNumber,
        });
      }
      if (functionName === "decimals") {
        return publicClient.readContract({
          address,
          abi: uerc20ReadAbi,
          functionName: "decimals",
          blockNumber,
        });
      }
      return publicClient.readContract({
        address,
        abi: uerc20ReadAbi,
        functionName: "metadata",
        blockNumber,
      });
    },
  };
}

async function scanSparseLogs(
  client: PrimaryRpcLaunchCatalogClient,
  head: bigint,
  signal: AbortSignal | undefined,
): Promise<readonly unknown[]> {
  const windows: Array<Readonly<{ fromBlock: bigint; toBlock: bigint }>> = [];
  for (
    let fromBlock = EARLIEST_START_BLOCK;
    fromBlock <= head;
    fromBlock += LOG_WINDOW_RANGE
  ) {
    windows.push({
      fromBlock,
      toBlock: minBigInt(head, fromBlock + LOG_WINDOW_RANGE - 1n),
    });
  }
  const pages = await mapBounded(
    windows,
    (window) => readSparseLogWindow(client, window, signal),
    MAXIMUM_CONCURRENT_LOG_WINDOWS,
  );
  const logs = pages.flat();
  if (logs.length > MAXIMUM_LOGS) {
    throw new PrimaryRpcLaunchCatalogError("integrity");
  }
  return logs;
}

async function readSparseLogWindow(
  client: PrimaryRpcLaunchCatalogClient,
  window: Readonly<{ fromBlock: bigint; toBlock: bigint }>,
  signal: AbortSignal | undefined,
): Promise<readonly unknown[]> {
  for (let attempt = 1; attempt <= MAXIMUM_LOG_WINDOW_ATTEMPTS; attempt += 1) {
    assertNotAborted(signal);
    try {
      const page = await abortableCall(() => client.getLogs({
        address: SPARSE_EVENT_ADDRESSES,
        events: SPARSE_LAUNCH_EVENTS,
        fromBlock: window.fromBlock,
        toBlock: window.toBlock,
        strict: true,
      }), signal);
      if (!Array.isArray(page)) {
        throw new PrimaryRpcLaunchCatalogError("response");
      }
      return page;
    } catch (error) {
      if (error instanceof PrimaryRpcLaunchCatalogError) throw error;
      assertNotAborted(signal);
      if (attempt === MAXIMUM_LOG_WINDOW_ATTEMPTS) {
        throw new PrimaryRpcLaunchCatalogError("transport");
      }
    }
  }
  throw new PrimaryRpcLaunchCatalogError("runtime");
}

function parseRpcEvent(value: unknown): RpcEvent {
  const row = record(value);
  const address = canonicalAddress(row?.address);
  const launcherRelease = address === null
    ? undefined
    : RELEASE_BY_LAUNCHER.get(address);
  const coordinatorRelease = address === null
    ? undefined
    : RELEASE_BY_ETH_LAUNCH_COORDINATOR.get(address);
  const name = nonEmptyString(row?.eventName);
  const blockNumber = unsignedBigInt(row?.blockNumber);
  const blockHash = canonicalBytes32(row?.blockHash);
  const transactionHash = canonicalBytes32(row?.transactionHash);
  const transactionIndex = nonNegativeSafeInteger(row?.transactionIndex);
  const logIndex = nonNegativeSafeInteger(row?.logIndex);
  const args = record(row?.args);
  const source = launcherRelease === undefined
    ? coordinatorRelease === undefined ? null : "eth-launch-coordinator"
    : coordinatorRelease === undefined ? "launcher" : null;
  const release = launcherRelease ?? coordinatorRelease;
  const expectedEvent = source === "launcher"
    ? name === release?.launchEvent || name === release?.liquidityEvent
    : source === "eth-launch-coordinator"
      ? name === "StockPairedEthTokenLaunched" &&
        release?.model === "stock-paired"
      : false;
  if (
    release === undefined || name === null || blockNumber === null ||
    blockHash === null || transactionHash === null ||
    transactionIndex === null || logIndex === null || args === null ||
    row?.removed === true || blockNumber < release.startBlock ||
    source === null || !expectedEvent
  ) {
    throw new PrimaryRpcLaunchCatalogError("integrity");
  }
  return {
    release,
    source,
    name,
    blockNumber,
    blockHash,
    transactionHash,
    transactionIndex,
    logIndex,
    args,
  };
}

function parseLaunchEvents(events: readonly RpcEvent[]): Readonly<{
  launches: ParsedLaunch[];
  liquidities: ParsedLiquidity[];
  stockCreatorIdentities: ParsedStockCreatorIdentity[];
}> {
  const launches: ParsedLaunch[] = [];
  const liquidities: ParsedLiquidity[] = [];
  const stockCreatorIdentities: ParsedStockCreatorIdentity[] = [];
  const coordinates = new Set<string>();
  for (const event of events) {
    const coordinate = eventCoordinate(event);
    if (coordinates.has(coordinate)) {
      throw new PrimaryRpcLaunchCatalogError("integrity");
    }
    coordinates.add(coordinate);
    if (event.source === "eth-launch-coordinator") {
      stockCreatorIdentities.push(parseStockCreatorIdentity(event));
    } else if (event.name === event.release.launchEvent) {
      launches.push(parseLaunch(event));
    } else {
      liquidities.push(parseLiquidity(event));
    }
  }
  return { launches, liquidities, stockCreatorIdentities };
}

function parseStockCreatorIdentity(
  event: RpcEvent,
): ParsedStockCreatorIdentity {
  if (
    event.source !== "eth-launch-coordinator" ||
    event.release.model !== "stock-paired" ||
    event.release.ethLaunchCoordinator === null
  ) {
    throw new PrimaryRpcLaunchCatalogError("integrity");
  }
  return {
    release: event.release,
    event,
    creator: requiredAddress(event.args, "creator"),
    token: requiredAddress(event.args, "token"),
    quoteAsset: requiredAddress(event.args, "quoteAsset"),
    launchHash: requiredBytes32(event.args, "launchHash"),
  };
}

function bindStockCreatorIdentities(
  launches: readonly ParsedLaunch[],
  identities: readonly ParsedStockCreatorIdentity[],
): ParsedLaunch[] {
  const consumedIdentities = new Set<string>();
  const bound = launches.map((launch): ParsedLaunch => {
    if (launch.release.model !== "stock-paired") return launch;
    const coordinator = launch.release.ethLaunchCoordinator;
    if (
      coordinator === null ||
      requiredAddress(launch.event.args, "deployer") !== coordinator ||
      launch.quoteAsset === undefined
    ) {
      throw new PrimaryRpcLaunchCatalogError("integrity");
    }
    const matches = identities.filter((identity) =>
      identity.release === launch.release &&
      identity.event.blockNumber === launch.event.blockNumber &&
      identity.event.blockHash === launch.event.blockHash &&
      identity.event.transactionHash === launch.event.transactionHash &&
      identity.event.transactionIndex === launch.event.transactionIndex &&
      identity.token === launch.token &&
      identity.quoteAsset === launch.quoteAsset &&
      identity.launchHash === launch.launchHash
    );
    if (matches.length !== 1) {
      throw new PrimaryRpcLaunchCatalogError("integrity");
    }
    const identity = matches[0]!;
    consumedIdentities.add(eventCoordinate(identity.event));
    return { ...launch, creator: identity.creator };
  });
  if (consumedIdentities.size !== identities.length) {
    throw new PrimaryRpcLaunchCatalogError("integrity");
  }
  return bound;
}

function parseLaunch(event: RpcEvent): ParsedLaunch {
  const { args, release } = event;
  const token = requiredAddress(args, "token");
  const poolId = requiredBytes32(args, "poolId");
  const positionRecipient = requiredAddress(args, "positionRecipient");
  const positionTokenId = requiredUnsigned(args, "positionTokenId");
  const launchHash = requiredBytes32(args, "launchHash");
  if (release.releaseId === "classic-v2") {
    const hook = requiredAddress(args, "feeHook");
    if (hook !== release.hook) {
      throw new PrimaryRpcLaunchCatalogError("integrity");
    }
    return {
      release,
      event,
      token,
      poolId,
      creator: requiredAddress(args, "creator"),
      hook,
      positionRecipient,
      positionTokenId,
      launchHash,
      totalSwapFeeBps: requiredSmallUnsigned(args, "totalSwapFeeBps", 10_000),
    };
  }
  if (release.releaseId === "classic-v3") {
    const hook = requiredAddress(args, "feeHook");
    const buySwapFeeBps = requiredSmallUnsigned(args, "buySwapFeeBps", 10_000);
    const sellSwapFeeBps = requiredSmallUnsigned(
      args,
      "sellSwapFeeBps",
      10_000,
    );
    if (hook !== release.hook) {
      throw new PrimaryRpcLaunchCatalogError("integrity");
    }
    return {
      release,
      event,
      token,
      poolId,
      creator: requiredAddress(args, "deployer"),
      hook,
      rewardVault: requiredAddress(args, "rewardVault"),
      positionRecipient,
      positionTokenId,
      launchHash,
      buySwapFeeBps,
      sellSwapFeeBps,
      totalSwapFeeBps: Math.max(buySwapFeeBps, sellSwapFeeBps),
    };
  }
  return {
    release,
    event,
    token,
    poolId,
    hook: release.hook,
    quoteAsset: requiredAddress(args, "quoteAsset"),
    rewardVault: requiredAddress(args, "rewardVault"),
    positionRecipient,
    positionTokenId,
    launchHash,
    totalSwapFeeBps: STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
  };
}

function parseLiquidity(event: RpcEvent): ParsedLiquidity {
  return {
    event,
    token: requiredAddress(event.args, "token"),
    ...(event.release.model === "stock-paired"
      ? { quoteAsset: requiredAddress(event.args, "quoteAsset") }
      : {}),
    totalSupplyRaw: requiredUnsigned(event.args, "totalSupply"),
    tokenLiquidityAmountRaw: requiredUnsigned(
      event.args,
      "tokenLiquidityAmount",
    ),
    lockedTokenDustRaw: requiredUnsigned(event.args, "lockedTokenDust"),
    initialTick: requiredSignedSafeInteger(event.args, "initialTick"),
    tickLower: requiredSignedSafeInteger(event.args, "tickLower"),
    tickUpper: requiredSignedSafeInteger(event.args, "tickUpper"),
    lpFeePips: requiredSmallUnsigned(event.args, "lpFeePips", 1_000_000),
    launchHash: requiredBytes32(event.args, "launchHash"),
  };
}

function requireLiquidity(
  launch: ParsedLaunch,
  liquidities: readonly ParsedLiquidity[],
): ParsedLiquidity {
  const matches = liquidities.filter((liquidity) =>
    liquidity.event.release.launcher === launch.release.launcher &&
    liquidity.event.transactionHash === launch.event.transactionHash &&
    liquidity.token === launch.token &&
    liquidity.launchHash === launch.launchHash &&
    liquidity.quoteAsset === launch.quoteAsset
  );
  if (matches.length !== 1) {
    throw new PrimaryRpcLaunchCatalogError("integrity");
  }
  return matches[0]!;
}

async function readMetadata(
  client: PrimaryRpcLaunchCatalogClient,
  tokenAddresses: readonly Address[],
  quoteAddresses: readonly Address[],
  blockNumber: bigint,
  signal: AbortSignal | undefined,
): Promise<ReadonlyMap<Address, TokenMetadata>> {
  const tokenSet = new Set(tokenAddresses);
  const addresses = [...new Set([...tokenAddresses, ...quoteAddresses])];
  const rows = await mapBounded(addresses, async (address) => {
    assertNotAborted(signal);
    const [name, symbol, decimals] = await providerCall(
      () => Promise.all([
        client.readContract({ address, functionName: "name", blockNumber }),
        client.readContract({ address, functionName: "symbol", blockNumber }),
        client.readContract({ address, functionName: "decimals", blockNumber }),
      ]),
      signal,
    );
    const rawMetadata = tokenSet.has(address)
      ? await providerCall(
          () => client.readContract({
            address,
            functionName: "metadata",
            blockNumber,
          }),
          signal,
        )
      : null;
    return [
      address,
      parseMetadata(name, symbol, decimals, rawMetadata, tokenSet.has(address)),
    ] as const;
  });
  return new Map(rows);
}

function parseMetadata(
  rawName: unknown,
  rawSymbol: unknown,
  rawDecimals: unknown,
  rawMetadata: unknown,
  requireExtendedMetadata: boolean,
): TokenMetadata {
  const name = nonEmptyString(rawName);
  const symbol = nonEmptyString(rawSymbol);
  const decimals = nonNegativeSafeInteger(rawDecimals);
  if (
    name === null || symbol === null || decimals === null || decimals > 255
  ) {
    throw new PrimaryRpcLaunchCatalogError("integrity");
  }
  if (!requireExtendedMetadata) return { name, symbol, decimals };
  if (!Array.isArray(rawMetadata) || rawMetadata.length !== 4) {
    throw new PrimaryRpcLaunchCatalogError("integrity");
  }
  const [descriptionValue, website, image, extraDataValue] = rawMetadata;
  const description = typeof descriptionValue === "string" &&
      descriptionValue.trim().length > 0
    ? descriptionValue.trim()
    : null;
  const extraData = canonicalHex(extraDataValue);
  if (typeof website !== "string" || typeof image !== "string" || extraData === null) {
    throw new PrimaryRpcLaunchCatalogError("integrity");
  }
  const imageUrl = sanitizeImageUrl(image);
  const links = buildTokenLinks(website, extraData);
  return {
    name,
    symbol,
    decimals,
    ...(description ? { description } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(links.length > 0 ? { links } : {}),
    ...(extraData !== "0x" ? { extraData } : {}),
  };
}

async function readLaunchBlocks(
  client: PrimaryRpcLaunchCatalogClient,
  launches: readonly ParsedLaunch[],
  signal: AbortSignal | undefined,
): Promise<ReadonlyMap<string, BoundBlock>> {
  const numbers = [...new Set(launches.map((launch) => launch.event.blockNumber))];
  const blocks = await mapBounded(numbers, async (blockNumber) => {
    assertNotAborted(signal);
    const block = parseBlock(
      await providerCall(
        () => client.getBlock({ blockNumber }),
        signal,
      ),
      blockNumber,
    );
    return [blockNumber.toString(), block] as const;
  });
  return new Map(blocks);
}

function requireLaunchBlock(
  launch: ParsedLaunch,
  blocks: ReadonlyMap<string, BoundBlock>,
): BoundBlock {
  const block = blocks.get(launch.event.blockNumber.toString());
  if (block === undefined || block.hash !== launch.event.blockHash) {
    throw new PrimaryRpcLaunchCatalogError("integrity");
  }
  return block;
}

function buildExploreEntry(
  launch: ParsedLaunch,
  liquidity: ParsedLiquidity,
  block: BoundBlock,
  metadata: ReadonlyMap<Address, TokenMetadata>,
): ExploreEntry {
  const tokenMetadata = metadata.get(launch.token);
  const quoteMetadata = launch.quoteAsset
    ? metadata.get(launch.quoteAsset)
    : undefined;
  if (tokenMetadata === undefined || (launch.quoteAsset && !quoteMetadata)) {
    throw new PrimaryRpcLaunchCatalogError("integrity");
  }
  const token: LauncherToken = {
    id: `1:${launch.token}`,
    name: tokenMetadata.name,
    symbol: tokenMetadata.symbol,
    ...(tokenMetadata.description
      ? { description: tokenMetadata.description }
      : {}),
    ...(tokenMetadata.imageUrl ? { imageUrl: tokenMetadata.imageUrl } : {}),
    ...(tokenMetadata.links ? { links: tokenMetadata.links } : {}),
    ...(tokenMetadata.extraData
      ? { metadataExtraData: tokenMetadata.extraData }
      : {}),
    tokenAddress: launch.token,
    hookAddress: launch.hook,
    poolId: launch.poolId,
    ...(launch.creator ? { creatorAddress: launch.creator } : {}),
    ...(launch.rewardVault ? { rewardVaultAddress: launch.rewardVault } : {}),
    positionRecipient: launch.positionRecipient,
    positionTokenId: launch.positionTokenId,
    launchHash: launch.launchHash,
    launchBlockNumber: launch.event.blockNumber.toString(),
    launchTransactionHash: launch.event.transactionHash,
    launchTransactionIndex: launch.event.transactionIndex,
    launchLogIndex: launch.event.logIndex,
    launchedAt: timestampToIso(block.timestamp),
    totalSupply: formatUnits(
      BigInt(liquidity.totalSupplyRaw),
      tokenMetadata.decimals,
    ),
    totalSupplyRaw: liquidity.totalSupplyRaw,
    tokenDecimals: tokenMetadata.decimals,
    tokenLiquidityAmountRaw: liquidity.tokenLiquidityAmountRaw,
    lockedTokenDustRaw: liquidity.lockedTokenDustRaw,
    initialTick: liquidity.initialTick,
    tickLower: liquidity.tickLower,
    tickUpper: liquidity.tickUpper,
    lpFeePips: liquidity.lpFeePips,
    ...(launch.quoteAsset && quoteMetadata
      ? {
          quoteAssetAddress: launch.quoteAsset,
          quoteAssetName: quoteMetadata.name,
          quoteAssetSymbol: quoteMetadata.symbol,
        }
      : {}),
    ...(launch.buySwapFeeBps === undefined
      ? {}
      : { buyHookFeeBps: launch.buySwapFeeBps }),
    ...(launch.sellSwapFeeBps === undefined
      ? {}
      : { sellHookFeeBps: launch.sellSwapFeeBps }),
    ...(launch.release.model === "stock-paired"
      ? {
          buyHookFeeBps: STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
          sellHookFeeBps: STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
          creatorFeeBps: STOCK_PAIRED_CREATOR_FEE_BPS,
          programmableFeeBps: STOCK_PAIRED_PROGRAMMABLE_FEE_BPS,
          launcherFeeBps: STOCK_PAIRED_PROGRAMMABLE_FEE_BPS,
          transferTaxBps: 0,
        }
      : {}),
    totalSwapFeeBps: launch.totalSwapFeeBps,
    launchModel: launch.release.model,
    ...modelVersionFields(launch.release),
    liquidityPath: "meme",
  };
  return canonicalTokenExploreEntryV1(token);
}

function modelVersionFields(
  release: ReleaseDefinition,
): Pick<LauncherToken, "launchModelVersion"> | Record<string, never> {
  switch (release.releaseId) {
    case "classic-v3":
    case "stock-paired-v1":
    case "stock-paired-v2":
    case "stock-paired-v3":
      return { launchModelVersion: release.releaseId };
    case "classic-v2":
      return {};
  }
}

function parseBlock(value: unknown, expectedNumber: bigint): BoundBlock {
  const row = record(value);
  const number = unsignedBigInt(row?.number);
  const hash = canonicalBytes32(row?.hash);
  const timestamp = unsignedBigInt(row?.timestamp);
  if (number !== expectedNumber || hash === null || timestamp === null) {
    throw new PrimaryRpcLaunchCatalogError("response");
  }
  return { number, hash, timestamp };
}

function releaseDefinition(input: Readonly<{
  releaseId: ReleaseDefinition["releaseId"];
  model: ReleaseDefinition["model"];
  manifest: unknown;
  launcherKey: "launcher" | "memeLauncher";
  startBlock: unknown;
  launchEvent: ReleaseDefinition["launchEvent"];
  liquidityEvent: ReleaseDefinition["liquidityEvent"];
}>): ReleaseDefinition {
  const manifest = record(input.manifest);
  const addresses = record(manifest?.addresses);
  const launcher = canonicalAddress(addresses?.[input.launcherKey]);
  const ethLaunchCoordinator = input.model === "stock-paired"
    ? canonicalAddress(addresses?.ethLaunchCoordinator)
    : null;
  const hook = canonicalAddress(addresses?.feeHook);
  const startBlock = unsignedBigInt(input.startBlock);
  if (
    manifest?.chainId !== 1 || launcher === null || hook === null ||
    startBlock === null ||
    (input.model === "stock-paired" && ethLaunchCoordinator === null)
  ) {
    throw new PrimaryRpcLaunchCatalogError("configuration");
  }
  return {
    releaseId: input.releaseId,
    model: input.model,
    launcher,
    ethLaunchCoordinator,
    hook,
    startBlock,
    launchEvent: input.launchEvent,
    liquidityEvent: input.liquidityEvent,
  };
}

function assertUniqueCatalog(entries: readonly ExploreEntry[]): void {
  const tokens = new Set<string>();
  const pools = new Set<string>();
  for (const entry of entries) {
    const token = entry.tokenAddress?.toLowerCase();
    if (
      !token || tokens.has(token) || entry.exploreKind !== "token" ||
      pools.has(entry.poolId)
    ) {
      throw new PrimaryRpcLaunchCatalogError("integrity");
    }
    tokens.add(token);
    pools.add(entry.poolId);
  }
}

function compareEntries(first: ExploreEntry, second: ExploreEntry): number {
  if (first.launchedAt !== second.launchedAt) {
    return second.launchedAt.localeCompare(first.launchedAt);
  }
  return first.id.localeCompare(second.id);
}

function compareRpcEvents(first: RpcEvent, second: RpcEvent): number {
  if (first.blockNumber !== second.blockNumber) {
    return first.blockNumber < second.blockNumber ? -1 : 1;
  }
  if (first.transactionIndex !== second.transactionIndex) {
    return first.transactionIndex - second.transactionIndex;
  }
  if (first.logIndex !== second.logIndex) {
    return first.logIndex - second.logIndex;
  }
  return first.transactionHash.localeCompare(second.transactionHash);
}

function eventCoordinate(event: RpcEvent): string {
  return `${event.blockNumber}:${event.transactionIndex}:${event.logIndex}`;
}

async function providerCall<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  try {
    return await abortableCall(operation, signal);
  } catch (error) {
    if (error instanceof PrimaryRpcLaunchCatalogError) throw error;
    throw new PrimaryRpcLaunchCatalogError("transport");
  }
}

async function readHeadWithRetry<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  for (let attempt = 1; attempt <= MAXIMUM_HEAD_READ_ATTEMPTS; attempt += 1) {
    assertNotAborted(signal);
    try {
      return await providerCall(operation, signal);
    } catch (error) {
      if (
        !(error instanceof PrimaryRpcLaunchCatalogError) ||
        error.category !== "transport" ||
        attempt === MAXIMUM_HEAD_READ_ATTEMPTS
      ) {
        throw error;
      }
      assertNotAborted(signal);
    }
  }
  throw new PrimaryRpcLaunchCatalogError("runtime");
}

async function abortableCall<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  assertNotAborted(signal);
  let pending: Promise<T>;
  try {
    pending = operation();
  } catch (error) {
    throw error;
  }
  if (signal === undefined) return pending;
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(new PrimaryRpcLaunchCatalogError("transport"));
    signal.addEventListener("abort", abort, { once: true });
    pending.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function createCatalogBudget(externalSignal: AbortSignal | undefined): Readonly<{
  signal: AbortSignal;
  dispose(): void;
}> {
  const deadline = new AbortController();
  const timeout = setTimeout(
    () => deadline.abort(),
    PRIMARY_RPC_LAUNCH_CATALOG_BUDGET_MS,
  );
  const signal = externalSignal === undefined
    ? deadline.signal
    : AbortSignal.any([externalSignal, deadline.signal]);
  return {
    signal,
    dispose() {
      clearTimeout(timeout);
      deadline.abort();
    },
  };
}

function normalizedCatalogError(
  error: unknown,
  phase: PrimaryRpcLaunchCatalogPhase,
): PrimaryRpcLaunchCatalogError {
  if (error instanceof PrimaryRpcLaunchCatalogError) {
    return error.phase === "unassigned"
      ? new PrimaryRpcLaunchCatalogError(error.category, phase)
      : error;
  }
  return new PrimaryRpcLaunchCatalogError("runtime", phase);
}

async function mapBounded<T, R>(
  values: readonly T[],
  operation: (value: T) => Promise<R>,
  maximumConcurrency = MAXIMUM_CONCURRENT_RPC_READS,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(maximumConcurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await operation(values[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new PrimaryRpcLaunchCatalogError("transport");
  }
}

function requiredAddress(
  values: Readonly<Record<string, unknown>>,
  name: string,
): Address {
  const value = canonicalAddress(values[name]);
  if (value === null) throw new PrimaryRpcLaunchCatalogError("integrity");
  return value;
}

function requiredBytes32(
  values: Readonly<Record<string, unknown>>,
  name: string,
): Hex {
  const value = canonicalBytes32(values[name]);
  if (value === null) throw new PrimaryRpcLaunchCatalogError("integrity");
  return value;
}

function requiredUnsigned(
  values: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const value = unsignedBigInt(values[name]);
  if (value === null) throw new PrimaryRpcLaunchCatalogError("integrity");
  return value.toString();
}

function requiredSmallUnsigned(
  values: Readonly<Record<string, unknown>>,
  name: string,
  maximum: number,
): number {
  const parsed = nonNegativeSafeInteger(values[name]);
  if (parsed === null || parsed > maximum) {
    throw new PrimaryRpcLaunchCatalogError("integrity");
  }
  return parsed;
}

function requiredSignedSafeInteger(
  values: Readonly<Record<string, unknown>>,
  name: string,
): number {
  const value = values[name];
  const parsed = typeof value === "bigint" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed)) {
    throw new PrimaryRpcLaunchCatalogError("integrity");
  }
  return parsed;
}

function canonicalAddress(value: unknown): Address | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return ADDRESS.test(normalized) ? normalized as Address : null;
}

function canonicalBytes32(value: unknown): Hex | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return BYTES32.test(normalized) ? normalized as Hex : null;
}

function canonicalHex(value: unknown): Hex | null {
  if (
    typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)
  ) return null;
  return value.toLowerCase() as Hex;
}

function unsignedBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return BigInt(value);
  }
  return null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  const parsed = unsignedBigInt(value);
  if (parsed === null || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(parsed);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function timestampToIso(timestamp: bigint): string {
  if (timestamp > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1_000))) {
    throw new PrimaryRpcLaunchCatalogError("integrity");
  }
  const milliseconds = Number(timestamp) * 1_000;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.valueOf())) {
    throw new PrimaryRpcLaunchCatalogError("integrity");
  }
  return date.toISOString();
}

function minBigInt(first: bigint, second: bigint): bigint {
  return first < second ? first : second;
}
