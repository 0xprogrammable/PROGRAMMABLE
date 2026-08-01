import "server-only";

import {
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiItem,
  parseAbiParameters,
  toEventSelector,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";

import {
  getStockPairedExpectedInitialTickForRelease,
  getStockPairedQuoteAssetForRelease,
  stockFeeSplitVaultAbi,
  stockPairedEthLaunchCoordinatorAbi,
  stockPairedHookAbi,
  stockQuoteRegistryAbi,
  STOCK_PAIRED_CREATOR_FEE_BPS,
  STOCK_PAIRED_PROGRAMMABLE_FEE_BPS,
  STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
} from "../stock-paired";
import {
  resolveVerifiedStockPairedRelease,
  resolveVerifiedStockPairedV2Release,
  resolveVerifiedStockPairedV3Release,
  type VerifiedStockPairedRelease,
} from "../stock-paired-release";
import { stateViewReadAbi, uerc20ReadAbi } from "../onchain/abis";
import type { CanonicalJsonValue } from "./canonical-fingerprint";
import { canonicalBytes32, type HexBytes32 } from "./codecs";
import { dataPipelineError, invalidInput, validationError } from "./errors";
import type {
  ExactBlockRpcClient,
  ExactBlockRpcLog,
  ExactBlockRpcReceipt,
  ExactBlockRpcTransaction,
} from "./reconciler-exact-block-reader.server";
import type {
  ReconcilerPreParityContract,
  ReconcilerRouteKey,
} from "./reconciler-preparity";
import {
  assertStockPairedReconcilerContribution,
  STOCK_PAIRED_RECONCILER_CONTRIBUTION_CONTRACT,
  type StockPairedReconcilerContribution,
  type StockPairedReconcilerRelease,
} from "./stock-paired-reconciler-contribution";

export const STOCK_PAIRED_RECONCILER_LOG_BLOCK_RANGE = 10_000n;
export const MAXIMUM_STOCK_PAIRED_RECONCILER_LAUNCHES = 256;
export const STOCK_PAIRED_RECONCILER_ROUTE_KEYS = Object.freeze([
  "explore-list",
  "explore-token",
  "explore-chart",
  "creator-profile",
  "launch-lookup",
] as const satisfies readonly ReconcilerRouteKey[]);
const MAXIMUM_LOGS_PER_REQUEST = 20_000;
const MAXIMUM_POOLS_PER_REQUEST = 64;
const CALLS_PER_LAUNCH = 27;
const MAXIMUM_USABLE_TICK = 887_200;
const MINIMUM_USABLE_TICK = -887_200;
const TOKEN_SUPPLY = 1_000_000_000n * 10n ** 18n;

const launchedEvent = parseAbiItem(
  "event StockPairedTokenLaunched(address indexed deployer,address indexed token,address indexed quoteAsset,bytes32 poolId,address rewardVault,address positionRecipient,uint256 positionTokenId,bytes32 launchHash)",
);
const liquidityEvent = parseAbiItem(
  "event StockPairedLiquidityConfigured(address indexed token,address indexed quoteAsset,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
);
const initialBuyEvent = parseAbiItem(
  "event StockPairedCreatorInitialBuy(address indexed deployer,address indexed token,address indexed quoteAsset,bytes32 poolId,uint256 quoteAmount,uint256 tokenAmount,bytes32 launchHash)",
);
const ethLaunchEvent = parseAbiItem(
  "event StockPairedEthTokenLaunched(address indexed creator,address indexed token,address indexed quoteAsset,uint256 initialBuyEthAmount,uint256 initialBuyQuoteAmount,uint256 initialBuyTokenAmount,bytes32 launchHash)",
);
const poolRegisteredEvent = parseAbiItem(
  "event PoolRegistered(bytes32 indexed poolId,address indexed token,address indexed quoteAsset,address rewardVault,address registrar,bool quoteIsCurrency0,bytes32 rewardConfigurationHash,bytes32 quoteConfigurationHash)",
);
const feeDisclosureEvent = parseAbiItem(
  "event PoolFeeDisclosure(bytes32 indexed poolId,address indexed token,address indexed quoteAsset,address rewardVault,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 creatorFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips)",
);
const feeAccruedEvent = parseAbiItem(
  "event QuoteSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,address indexed quoteAsset,bool isBuy,uint256 grossQuoteAmount,uint256 creatorFee,uint256 launcherFee)",
);
const vaultDeployedEvent = parseAbiItem(
  "event QuoteAssetFeeSplitVaultDeployed(address indexed vault,address indexed feeHook,bytes32 indexed poolId,address quoteAsset)",
);
const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
);

const launcherStateAbi = parseAbi([
  "function launchHashOf(address token) view returns (bytes32)",
  "function rewardVaultOf(address token) view returns (address)",
  "function quoteAssetOf(address token) view returns (address)",
]);
const rewardVaultFactoryStateAbi = parseAbi([
  "function isFactoryVault(address vault) view returns (bool)",
  "function configurationHashOf(address vault) view returns (bytes32)",
]);
const positionForwarderFactoryStateAbi = parseAbi([
  "function isFactoryForwarder(address forwarder) view returns (bool)",
  "function configurationHashOf(address forwarder) view returns (bytes32)",
]);

const REWARD_CONFIGURATION_PARAMETERS = parseAbiParameters(
  "uint256 chainId,address vault,address feeHook,address poolManager,address quoteAsset,bytes32 poolId,address[] beneficiaries,uint16[] sharesBps",
);
const POOL_KEY_PARAMETERS = parseAbiParameters(
  "address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks",
);

const LAUNCHER_EVENTS = Object.freeze([
  launchedEvent,
  liquidityEvent,
  initialBuyEvent,
]);
const HOOK_EVENTS = Object.freeze([
  poolRegisteredEvent,
  feeDisclosureEvent,
  feeAccruedEvent,
]);

type Json = CanonicalJsonValue;
type JsonRecord = Record<string, unknown>;

type DecodedLog = Readonly<{
  eventName: string;
  args: Readonly<Record<string, unknown>>;
  log: ExactBlockRpcLog;
}>;

type CallSpec = Readonly<{
  to: Address;
  data: Hex;
  decode: (data: Hex) => unknown;
}>;

type StockLaunch = Readonly<{
  coordinator: Address;
  token: Address;
  quoteAsset: Address;
  poolId: HexBytes32;
  rewardVault: Address;
  positionRecipient: Address;
  positionTokenId: bigint;
  launchHash: HexBytes32;
  blockNumber: bigint;
  blockHash: HexBytes32;
  transactionHash: HexBytes32;
  transactionIndex: number;
  blockGlobalLogIndex: number;
  log: ExactBlockRpcLog;
}>;

type Companions = Readonly<{
  liquidity: DecodedLog;
  initialBuy: DecodedLog;
  ethLaunch: DecodedLog;
  registration: DecodedLog;
  disclosure: DecodedLog;
  vaultDeployment: DecodedLog;
}>;

type LaunchInput = Readonly<{
  creator: Address;
  receiptLogIndex: number;
  value: bigint;
  name: string;
  symbol: string;
  creatorSalt: HexBytes32;
  description: string;
  website: string;
  image: string;
  extraData: Hex;
  beneficiaries: readonly Address[];
  sharesBps: readonly number[];
  minimumQuoteAmountOut: bigint;
  minimumInitialTokenOut: bigint;
}>;

export type StockPairedExactBlockContributionBuilder = (input: Readonly<{
  rpc: ExactBlockRpcClient;
  contract: ReconcilerPreParityContract;
  blockNumber: bigint;
  blockHash: HexBytes32;
  signal: AbortSignal;
}>) => Promise<StockPairedReconcilerContribution>;

function fail(operation: string): never {
  throw validationError("uniswap", operation);
}

function lowerAddress(value: Address): string {
  return value.toLowerCase();
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function exactAddress(value: unknown, operation: string): Address {
  if (typeof value !== "string" || !isAddress(value)) fail(operation);
  return getAddress(value);
}

function exactBytes32(value: unknown, operation: string): HexBytes32 {
  try {
    return canonicalBytes32(value);
  } catch {
    return fail(operation);
  }
}

function exactData(value: unknown, operation: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) {
    fail(operation);
  }
  return value.toLowerCase() as Hex;
}

function exactText(value: unknown, operation: string): string {
  if (typeof value !== "string") fail(operation);
  return value;
}

function record(value: unknown, operation: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(operation);
  }
  return value as JsonRecord;
}

function array(value: unknown, operation: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(operation);
  return value;
}

function tuple(
  value: unknown,
  length: number,
  operation: string,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== length) fail(operation);
  return value;
}

function integer(value: unknown, operation: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  return fail(operation);
}

function nonnegative(value: unknown, operation: string): bigint {
  const parsed = integer(value, operation);
  if (parsed < 0n) fail(operation);
  return parsed;
}

function safeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  operation: string,
): number {
  const parsed = integer(value, operation);
  if (parsed < BigInt(minimum) || parsed > BigInt(maximum)) fail(operation);
  return Number(parsed);
}

function callSpec(
  to: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): CallSpec {
  const request = { abi, functionName, args } as never;
  return Object.freeze({
    to,
    data: encodeFunctionData(request),
    decode: (data: Hex) => decodeFunctionResult({
      abi,
      functionName,
      data,
    } as never) as unknown,
  });
}

export function stockPairedReconcilerBlockRanges(
  fromBlock: bigint,
  toBlock: bigint,
): readonly Readonly<{ fromBlock: bigint; toBlock: bigint }>[] {
  if (fromBlock < 0n || toBlock < fromBlock) {
    throw invalidInput("rpc", "stock-reconciler-log-range");
  }
  const ranges: Array<Readonly<{ fromBlock: bigint; toBlock: bigint }>> = [];
  for (
    let start = fromBlock;
    start <= toBlock;
    start += STOCK_PAIRED_RECONCILER_LOG_BLOCK_RANGE
  ) {
    const end = start + STOCK_PAIRED_RECONCILER_LOG_BLOCK_RANGE - 1n;
    ranges.push(Object.freeze({
      fromBlock: start,
      toBlock: end > toBlock ? toBlock : end,
    }));
  }
  return Object.freeze(ranges);
}

function eventMap(events: readonly AbiEvent[]) {
  return new Map(
    events.map((event) => [toEventSelector(event).toLowerCase(), event]),
  );
}

function decodeKnownEvent(
  events: ReadonlyMap<string, AbiEvent>,
  log: ExactBlockRpcLog,
): DecodedLog {
  const event = events.get((log.topics[0] ?? "").toLowerCase());
  if (!event) fail("stock-reconciler-log-selector");
  let decoded: ReturnType<typeof decodeEventLog>;
  try {
    decoded = decodeEventLog({
      abi: [event],
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
      strict: true,
    });
  } catch {
    return fail("stock-reconciler-log-decode");
  }
  if (
    decoded.args === null ||
    typeof decoded.args !== "object" ||
    Array.isArray(decoded.args)
  ) {
    fail("stock-reconciler-log-args");
  }
  return Object.freeze({
    eventName: decoded.eventName,
    args: decoded.args as Readonly<Record<string, unknown>>,
    log,
  });
}

async function readUncappedLogs(input: Readonly<{
  rpc: ExactBlockRpcClient;
  addresses: Address | readonly Address[];
  topics: readonly (Hex | readonly Hex[] | null)[];
  fromBlock: bigint;
  toBlock: bigint;
  signal: AbortSignal;
}>): Promise<readonly ExactBlockRpcLog[]> {
  const logs = await input.rpc.getLogs({
    addresses: input.addresses,
    topics: input.topics,
    fromBlock: input.fromBlock,
    toBlock: input.toBlock,
    maximumLogs: MAXIMUM_LOGS_PER_REQUEST,
    signal: input.signal,
  });
  if (logs.length < MAXIMUM_LOGS_PER_REQUEST) return logs;
  if (input.fromBlock === input.toBlock) {
    throw dataPipelineError({
      dependency: "rpc",
      code: "response_oversize",
      retryable: false,
      countsTowardCircuit: true,
      metadata: { operation: "stock-reconciler-single-block-log-boundary" },
    });
  }
  const midpoint = input.fromBlock + (input.toBlock - input.fromBlock) / 2n;
  const [left, right] = await Promise.all([
    readUncappedLogs({ ...input, toBlock: midpoint }),
    readUncappedLogs({ ...input, fromBlock: midpoint + 1n }),
  ]);
  return Object.freeze([...left, ...right]);
}

async function readLogsInRanges(input: Readonly<{
  rpc: ExactBlockRpcClient;
  addresses: Address | readonly Address[];
  events: readonly AbiEvent[];
  fromBlock: bigint;
  toBlock: bigint;
  signal: AbortSignal;
}>): Promise<readonly DecodedLog[]> {
  if (input.toBlock < input.fromBlock) return Object.freeze([]);
  const selectors = eventMap(input.events);
  const allowedAddresses = new Set(
    (Array.isArray(input.addresses) ? input.addresses : [input.addresses])
      .map((address) => lowerAddress(address)),
  );
  const output: DecodedLog[] = [];
  for (const range of stockPairedReconcilerBlockRanges(
    input.fromBlock,
    input.toBlock,
  )) {
    const logs = await readUncappedLogs({
      rpc: input.rpc,
      addresses: input.addresses,
      topics: [[...selectors.keys()] as Hex[]],
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      signal: input.signal,
    });
    if (logs.some((log) =>
      !allowedAddresses.has(lowerAddress(log.address)) ||
      !selectors.has((log.topics[0] ?? "").toLowerCase()) ||
      log.blockNumber < range.fromBlock ||
      log.blockNumber > range.toBlock
    )) {
      fail("stock-reconciler-log-filter-binding");
    }
    output.push(...logs.map((log) => decodeKnownEvent(selectors, log)));
  }
  for (let index = 1; index < output.length; index += 1) {
    const left = output[index - 1]!.log;
    const right = output[index]!.log;
    if (
      right.blockNumber < left.blockNumber ||
      (right.blockNumber === left.blockNumber &&
        (right.transactionIndex < left.transactionIndex ||
          (right.transactionIndex === left.transactionIndex &&
            right.logIndex <= left.logIndex)))
    ) {
      fail("stock-reconciler-log-order");
    }
  }
  return Object.freeze(output);
}

async function readPoolSwapLogs(input: Readonly<{
  rpc: ExactBlockRpcClient;
  poolManager: Address;
  poolIds: readonly HexBytes32[];
  fromBlock: bigint;
  toBlock: bigint;
  signal: AbortSignal;
}>): Promise<readonly DecodedLog[]> {
  const selectorMap = eventMap([swapEvent]);
  const output: DecodedLog[] = [];
  for (
    let offset = 0;
    offset < input.poolIds.length;
    offset += MAXIMUM_POOLS_PER_REQUEST
  ) {
    const poolIds = input.poolIds.slice(
      offset,
      offset + MAXIMUM_POOLS_PER_REQUEST,
    );
    for (const range of stockPairedReconcilerBlockRanges(
      input.fromBlock,
      input.toBlock,
    )) {
      const logs = await readUncappedLogs({
        rpc: input.rpc,
        addresses: input.poolManager,
        topics: [toEventSelector(swapEvent), poolIds],
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        signal: input.signal,
      });
      const allowedPoolIds = new Set(
        poolIds.map((poolId) => poolId.toLowerCase()),
      );
      if (logs.some((log) =>
        !sameHex(log.address, input.poolManager) ||
        log.blockNumber < range.fromBlock ||
        log.blockNumber > range.toBlock ||
        !sameHex(log.topics[0] ?? "0x", toEventSelector(swapEvent)) ||
        !allowedPoolIds.has((log.topics[1] ?? "").toLowerCase())
      )) {
        fail("stock-reconciler-swap-log-filter-binding");
      }
      output.push(...logs.map((log) => decodeKnownEvent(selectorMap, log)));
    }
  }
  output.sort((left, right) =>
    left.log.blockNumber === right.log.blockNumber
      ? left.log.transactionIndex === right.log.transactionIndex
        ? left.log.logIndex - right.log.logIndex
        : left.log.transactionIndex - right.log.transactionIndex
      : left.log.blockNumber < right.log.blockNumber ? -1 : 1
  );
  return Object.freeze(output);
}

async function readCalls(
  rpc: ExactBlockRpcClient,
  calls: readonly CallSpec[],
  blockHash: HexBytes32,
  signal: AbortSignal,
): Promise<readonly unknown[]> {
  const results = await rpc.callMany({
    calls: calls.map(({ to, data }) => Object.freeze({ to, data })),
    blockHash,
    signal,
  });
  if (results.length !== calls.length) fail("stock-reconciler-call-cardinality");
  return Object.freeze(results.map((result, index) =>
    calls[index]!.decode(result)));
}

function configuredRelease(
  releaseVersion: StockPairedReconcilerRelease,
): VerifiedStockPairedRelease {
  const release = releaseVersion === "stock-paired-v1"
    ? resolveVerifiedStockPairedRelease()
    : releaseVersion === "stock-paired-v2"
      ? resolveVerifiedStockPairedV2Release()
      : resolveVerifiedStockPairedV3Release();
  if (!release || release.internalContractRelease !== releaseVersion) {
    fail("stock-reconciler-release-manifest");
  }
  return release;
}

function resolveRelease(
  contract: ReconcilerPreParityContract,
  releaseVersion: StockPairedReconcilerRelease,
): VerifiedStockPairedRelease {
  if (
    contract.chainId !== "1" ||
    contract.releaseId !== releaseVersion ||
    contract.modelId !== "stock-paired" ||
    contract.routeKeys.length !== STOCK_PAIRED_RECONCILER_ROUTE_KEYS.length ||
    contract.routeKeys.some(
      (routeKey, index) =>
        routeKey !== STOCK_PAIRED_RECONCILER_ROUTE_KEYS[index],
    )
  ) {
    throw invalidInput("config", "stock-reconciler-release");
  }
  return configuredRelease(releaseVersion);
}

async function assertRuntime(input: Readonly<{
  rpc: ExactBlockRpcClient;
  release: VerifiedStockPairedRelease;
  blockHash: HexBytes32;
  signal: AbortSignal;
}>): Promise<void> {
  const runtimeFields = [
    "quoteRegistry",
    "positionPlanner",
    "feeSplitVaultFactory",
    "hookFactory",
    "feeHook",
    "launcher",
    "ethLaunchCoordinator",
    "positionForwarderFactory",
  ] as const;
  const runtime = [
    ...runtimeFields.map((label) => ({
        label,
        address: input.release.addresses[label],
        expectedHash: input.release.runtimeCodeHashes[label],
      })),
    ...Object.entries(input.release.officialDependencies)
      .map(([label, dependency]) => ({
        label,
        address: dependency.address,
        expectedHash: dependency.runtimeCodeHash,
      })),
    {
      label: "issuerBeacon",
      address: input.release.issuerRuntime.beacon,
      expectedHash: input.release.issuerRuntime.beaconRuntimeCodeHash,
    },
    {
      label: "issuerImplementation",
      address: input.release.issuerRuntime.implementation,
      expectedHash: input.release.issuerRuntime.implementationRuntimeCodeHash,
    },
    ...(input.release.issuerRuntime.gmTokenManager &&
      input.release.issuerRuntime.gmTokenManagerRuntimeCodeHash
      ? [{
          label: "issuerGmTokenManager",
          address: input.release.issuerRuntime.gmTokenManager,
          expectedHash:
            input.release.issuerRuntime.gmTokenManagerRuntimeCodeHash,
        }]
      : []),
  ];
  for (const item of runtime) {
    const codeHash = await input.rpc.getCodeHash({
      address: item.address,
      blockHash: input.blockHash,
      signal: input.signal,
    });
    if (!sameHex(codeHash, item.expectedHash)) {
      fail(`stock-reconciler-runtime-${item.label}`);
    }
  }
}

function oneByKey(
  values: readonly DecodedLog[],
  key: (value: DecodedLog) => string,
  operation: string,
): ReadonlyMap<string, DecodedLog> {
  const output = new Map<string, DecodedLog>();
  for (const value of values) {
    const identity = key(value).toLowerCase();
    if (output.has(identity)) fail(operation);
    output.set(identity, value);
  }
  return output;
}

function launchRecords(
  logs: readonly DecodedLog[],
  release: VerifiedStockPairedRelease,
): readonly StockLaunch[] {
  const launched = logs.filter(({ eventName }) =>
    eventName === "StockPairedTokenLaunched");
  if (
    launched.length < 1 ||
    launched.length > MAXIMUM_STOCK_PAIRED_RECONCILER_LAUNCHES
  ) {
    fail("stock-reconciler-launch-cardinality");
  }
  const tokens = new Set<string>();
  const pools = new Set<string>();
  const output = launched.map(({ args, log }) => {
    const coordinator = exactAddress(args.deployer,
      "stock-reconciler-launch-coordinator");
    const token = exactAddress(args.token, "stock-reconciler-launch-token");
    const quoteAsset = exactAddress(
      args.quoteAsset,
      "stock-reconciler-launch-quote",
    );
    const poolId = exactBytes32(args.poolId, "stock-reconciler-launch-pool");
    if (
      !sameHex(coordinator, release.addresses.ethLaunchCoordinator) ||
      !getStockPairedQuoteAssetForRelease(release, quoteAsset) ||
      tokens.has(lowerAddress(token)) ||
      pools.has(poolId)
    ) {
      fail("stock-reconciler-launch-identity");
    }
    tokens.add(lowerAddress(token));
    pools.add(poolId);
    return Object.freeze({
      coordinator,
      token,
      quoteAsset,
      poolId,
      rewardVault: exactAddress(args.rewardVault,
        "stock-reconciler-launch-vault"),
      positionRecipient: exactAddress(
        args.positionRecipient,
        "stock-reconciler-launch-position-recipient",
      ),
      positionTokenId: nonnegative(
        args.positionTokenId,
        "stock-reconciler-position-token-id",
      ),
      launchHash: exactBytes32(args.launchHash,
        "stock-reconciler-launch-hash"),
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      transactionIndex: log.transactionIndex,
      blockGlobalLogIndex: log.logIndex,
      log,
    });
  });
  output.sort((left, right) =>
    left.blockNumber === right.blockNumber
      ? left.transactionIndex === right.transactionIndex
        ? left.blockGlobalLogIndex - right.blockGlobalLogIndex
        : left.transactionIndex - right.transactionIndex
      : left.blockNumber < right.blockNumber ? -1 : 1
  );
  return Object.freeze(output);
}

function sameTransaction(event: DecodedLog, launch: StockLaunch): boolean {
  return sameHex(event.log.blockHash, launch.blockHash) &&
    sameHex(event.log.transactionHash, launch.transactionHash) &&
    event.log.blockNumber === launch.blockNumber &&
    event.log.transactionIndex === launch.transactionIndex;
}

function companions(input: Readonly<{
  launches: readonly StockLaunch[];
  launcherLogs: readonly DecodedLog[];
  coordinatorLogs: readonly DecodedLog[];
  hookLogs: readonly DecodedLog[];
  factoryLogs: readonly DecodedLog[];
  release: VerifiedStockPairedRelease;
}>): ReadonlyMap<string, Companions> {
  const liquidity = oneByKey(
    input.launcherLogs.filter(({ eventName }) =>
      eventName === "StockPairedLiquidityConfigured"),
    ({ args }) => lowerAddress(exactAddress(
      args.token,
      "stock-reconciler-liquidity-token",
    )),
    "stock-reconciler-liquidity-cardinality",
  );
  const initialBuy = oneByKey(
    input.launcherLogs.filter(({ eventName }) =>
      eventName === "StockPairedCreatorInitialBuy"),
    ({ args }) => lowerAddress(exactAddress(
      args.token,
      "stock-reconciler-initial-buy-token",
    )),
    "stock-reconciler-initial-buy-cardinality",
  );
  const ethLaunch = oneByKey(
    input.coordinatorLogs.filter(({ eventName }) =>
      eventName === "StockPairedEthTokenLaunched"),
    ({ args }) => lowerAddress(exactAddress(
      args.token,
      "stock-reconciler-eth-launch-token",
    )),
    "stock-reconciler-eth-launch-cardinality",
  );
  const registrations = oneByKey(
    input.hookLogs.filter(({ eventName }) => eventName === "PoolRegistered"),
    ({ args }) => exactBytes32(
      args.poolId,
      "stock-reconciler-registration-pool",
    ),
    "stock-reconciler-registration-cardinality",
  );
  const disclosures = oneByKey(
    input.hookLogs.filter(({ eventName }) => eventName === "PoolFeeDisclosure"),
    ({ args }) => exactBytes32(
      args.poolId,
      "stock-reconciler-disclosure-pool",
    ),
    "stock-reconciler-disclosure-cardinality",
  );
  const vaultDeployments = oneByKey(
    input.factoryLogs.filter(({ eventName }) =>
      eventName === "QuoteAssetFeeSplitVaultDeployed"),
    ({ args }) => lowerAddress(exactAddress(
      args.vault,
      "stock-reconciler-deployed-vault",
    )),
    "stock-reconciler-vault-deployment-cardinality",
  );
  const output = new Map<string, Companions>();
  for (const launch of input.launches) {
    const tokenKey = lowerAddress(launch.token);
    const values = {
      liquidity: liquidity.get(tokenKey),
      initialBuy: initialBuy.get(tokenKey),
      ethLaunch: ethLaunch.get(tokenKey),
      registration: registrations.get(launch.poolId),
      disclosure: disclosures.get(launch.poolId),
      vaultDeployment: vaultDeployments.get(lowerAddress(launch.rewardVault)),
    };
    if (
      !values.liquidity ||
      !values.initialBuy ||
      !values.ethLaunch ||
      !values.registration ||
      !values.disclosure ||
      !values.vaultDeployment ||
      Object.values(values).some((value) => !sameTransaction(value!, launch))
    ) {
      fail("stock-reconciler-companion-provenance");
    }
    const all = Object.values(values) as DecodedLog[];
    if (all.some(({ args }) =>
      "launchHash" in args &&
      !sameHex(exactBytes32(
        args.launchHash,
        "stock-reconciler-companion-launch-hash",
      ), launch.launchHash)
    )) {
      fail("stock-reconciler-companion-launch-hash");
    }
    const { liquidity: liquidityLog, initialBuy: initialBuyLog,
      ethLaunch: ethLaunchLog, registration, disclosure, vaultDeployment } =
      values as Record<keyof typeof values, DecodedLog>;
    if (
      !sameHex(exactAddress(liquidityLog.args.quoteAsset,
        "stock-reconciler-liquidity-quote"), launch.quoteAsset) ||
      !sameHex(exactAddress(initialBuyLog.args.deployer,
        "stock-reconciler-initial-buy-deployer"), launch.coordinator) ||
      !sameHex(exactAddress(initialBuyLog.args.quoteAsset,
        "stock-reconciler-initial-buy-quote"), launch.quoteAsset) ||
      !sameHex(exactBytes32(initialBuyLog.args.poolId,
        "stock-reconciler-initial-buy-pool"), launch.poolId) ||
      !sameHex(exactAddress(ethLaunchLog.args.quoteAsset,
        "stock-reconciler-eth-launch-quote"), launch.quoteAsset) ||
      !sameHex(exactAddress(registration.args.token,
        "stock-reconciler-registration-token"), launch.token) ||
      !sameHex(exactAddress(registration.args.quoteAsset,
        "stock-reconciler-registration-quote"), launch.quoteAsset) ||
      !sameHex(exactAddress(registration.args.rewardVault,
        "stock-reconciler-registration-vault"), launch.rewardVault) ||
      !sameHex(exactAddress(registration.args.registrar,
        "stock-reconciler-registration-registrar"), input.release.addresses.launcher) ||
      !sameHex(exactAddress(disclosure.args.token,
        "stock-reconciler-disclosure-token"), launch.token) ||
      !sameHex(exactAddress(disclosure.args.quoteAsset,
        "stock-reconciler-disclosure-quote"), launch.quoteAsset) ||
      !sameHex(exactAddress(disclosure.args.rewardVault,
        "stock-reconciler-disclosure-vault"), launch.rewardVault) ||
      !sameHex(exactAddress(vaultDeployment.args.feeHook,
        "stock-reconciler-vault-hook"), input.release.addresses.feeHook) ||
      !sameHex(exactBytes32(vaultDeployment.args.poolId,
        "stock-reconciler-vault-pool"), launch.poolId) ||
      !sameHex(exactAddress(vaultDeployment.args.quoteAsset,
        "stock-reconciler-vault-quote"), launch.quoteAsset)
    ) {
      fail("stock-reconciler-companion-identity");
    }
    output.set(tokenKey, Object.freeze({
      liquidity: liquidityLog,
      initialBuy: initialBuyLog,
      ethLaunch: ethLaunchLog,
      registration,
      disclosure,
      vaultDeployment,
    }));
  }
  return output;
}

function receiptContains(
  receipt: ExactBlockRpcReceipt,
  expected: ExactBlockRpcLog,
): number | null {
  const matches = receipt.logs.filter((log) =>
    sameHex(log.address, expected.address) &&
    sameHex(log.transactionHash, expected.transactionHash) &&
    log.logIndex === expected.logIndex &&
    sameHex(log.data, expected.data) &&
    log.topics.length === expected.topics.length &&
    log.topics.every((topic, index) =>
      sameHex(topic, expected.topics[index]!))
  );
  return matches.length === 1 ? matches[0]!.receiptLogIndex : null;
}

function validatedLaunchInputs(input: Readonly<{
  launches: readonly StockLaunch[];
  companions: ReadonlyMap<string, Companions>;
  transactions: readonly ExactBlockRpcTransaction[];
  receipts: readonly ExactBlockRpcReceipt[];
  release: VerifiedStockPairedRelease;
}>): ReadonlyMap<string, LaunchInput> {
  if (
    input.launches.length !== input.transactions.length ||
    input.launches.length !== input.receipts.length
  ) {
    fail("stock-reconciler-transaction-cardinality");
  }
  const output = new Map<string, LaunchInput>();
  for (let index = 0; index < input.launches.length; index += 1) {
    const launch = input.launches[index]!;
    const transaction = input.transactions[index]!;
    const receipt = input.receipts[index]!;
    const companion = input.companions.get(lowerAddress(launch.token));
    if (!companion) fail("stock-reconciler-transaction-companion");
    if (
      !sameHex(transaction.transactionHash, launch.transactionHash) ||
      transaction.blockNumber !== launch.blockNumber ||
      !sameHex(transaction.blockHash, launch.blockHash) ||
      transaction.transactionIndex !== launch.transactionIndex ||
      !sameHex(transaction.to, input.release.addresses.ethLaunchCoordinator) ||
      !sameHex(receipt.transactionHash, launch.transactionHash) ||
      receipt.blockNumber !== launch.blockNumber ||
      !sameHex(receipt.blockHash, launch.blockHash) ||
      receipt.transactionIndex !== launch.transactionIndex
    ) {
      fail("stock-reconciler-transaction-binding");
    }
    const launchReceiptIndex = receiptContains(receipt, launch.log);
    if (
      launchReceiptIndex === null ||
      Object.values(companion).some(({ log }) =>
        receiptContains(receipt, log) === null)
    ) {
      fail("stock-reconciler-receipt-provenance");
    }
    let decoded: ReturnType<typeof decodeFunctionData>;
    try {
      decoded = decodeFunctionData({
        abi: stockPairedEthLaunchCoordinatorAbi,
        data: transaction.input,
      });
    } catch {
      return fail("stock-reconciler-calldata-decode");
    }
    if (decoded.functionName !== "launch" || decoded.args.length !== 1) {
      fail("stock-reconciler-calldata-selector");
    }
    const envelope = record(decoded.args[0], "stock-reconciler-envelope");
    const parameters = record(envelope.launch, "stock-reconciler-parameters");
    const metadata = record(parameters.metadata, "stock-reconciler-metadata");
    const beneficiaries = array(
      parameters.rewardBeneficiaries,
      "stock-reconciler-beneficiaries",
    ).map((value) => exactAddress(value, "stock-reconciler-beneficiary"));
    const sharesBps = array(
      parameters.rewardSharesBps,
      "stock-reconciler-shares",
    ).map((value) => safeInteger(value, 1, 10_000,
      "stock-reconciler-share"));
    const ethArgs = companion.ethLaunch.args;
    const creator = exactAddress(ethArgs.creator,
      "stock-reconciler-eth-creator");
    const initialBuyEthAmount = nonnegative(
      ethArgs.initialBuyEthAmount,
      "stock-reconciler-initial-eth",
    );
    const initialBuyQuoteAmount = nonnegative(
      ethArgs.initialBuyQuoteAmount,
      "stock-reconciler-initial-quote",
    );
    const initialBuyTokenAmount = nonnegative(
      ethArgs.initialBuyTokenAmount,
      "stock-reconciler-initial-token",
    );
    const minimumQuoteAmountOut = nonnegative(
      envelope.minimumQuoteAmountOut,
      "stock-reconciler-minimum-quote",
    );
    const minimumInitialTokenOut = nonnegative(
      envelope.minimumInitialTokenOut,
      "stock-reconciler-minimum-token",
    );
    if (
      !sameHex(creator, transaction.from) ||
      !sameHex(exactAddress(parameters.quoteAsset,
        "stock-reconciler-calldata-quote"), launch.quoteAsset) ||
      transaction.value !== initialBuyEthAmount ||
      initialBuyEthAmount <= 0n ||
      initialBuyQuoteAmount < minimumQuoteAmountOut ||
      initialBuyTokenAmount < minimumInitialTokenOut ||
      nonnegative(parameters.initialBuyQuoteAmount,
        "stock-reconciler-calldata-initial-quote") !== 0n ||
      minimumQuoteAmountOut === 0n ||
      minimumInitialTokenOut === 0n ||
      nonnegative(envelope.deadline, "stock-reconciler-deadline") <= 0n ||
      beneficiaries.length < 1 ||
      beneficiaries.length > 8 ||
      beneficiaries.length !== sharesBps.length ||
      new Set(beneficiaries.map(lowerAddress)).size !== beneficiaries.length ||
      sharesBps.reduce((sum, share) => sum + share, 0) !== 10_000 ||
      !sameHex(exactAddress(companion.ethLaunch.args.token,
        "stock-reconciler-eth-token"), launch.token)
    ) {
      fail("stock-reconciler-calldata-provenance");
    }
    const initialArgs = companion.initialBuy.args;
    if (
      nonnegative(initialArgs.quoteAmount,
        "stock-reconciler-event-initial-quote") !== initialBuyQuoteAmount ||
      nonnegative(initialArgs.tokenAmount,
        "stock-reconciler-event-initial-token") !== initialBuyTokenAmount
    ) {
      fail("stock-reconciler-initial-buy-provenance");
    }
    output.set(lowerAddress(launch.token), Object.freeze({
      creator,
      receiptLogIndex: launchReceiptIndex,
      value: transaction.value,
      name: exactText(parameters.name, "stock-reconciler-name"),
      symbol: exactText(parameters.symbol, "stock-reconciler-symbol"),
      creatorSalt: exactBytes32(parameters.creatorSalt,
        "stock-reconciler-creator-salt"),
      description: exactText(metadata.description,
        "stock-reconciler-description"),
      website: exactText(metadata.website, "stock-reconciler-website"),
      image: exactText(metadata.image, "stock-reconciler-image"),
      extraData: exactData(metadata.extraData, "stock-reconciler-extra-data"),
      beneficiaries: Object.freeze(beneficiaries),
      sharesBps: Object.freeze(sharesBps),
      minimumQuoteAmountOut,
      minimumInitialTokenOut,
    }));
  }
  return output;
}

function poolIdentity(
  token: Address,
  quoteAsset: Address,
  hook: Address,
): Readonly<{ poolId: HexBytes32; quoteIsCurrency0: boolean }> {
  const quoteIsCurrency0 = BigInt(quoteAsset) < BigInt(token);
  const currency0 = quoteIsCurrency0 ? quoteAsset : token;
  const currency1 = quoteIsCurrency0 ? token : quoteAsset;
  return Object.freeze({
    quoteIsCurrency0,
    poolId: keccak256(encodeAbiParameters(POOL_KEY_PARAMETERS, [
      currency0,
      currency1,
      0,
      200,
      hook,
    ])),
  });
}

function rewardConfigurationHash(input: Readonly<{
  vault: Address;
  hook: Address;
  poolManager: Address;
  quoteAsset: Address;
  poolId: HexBytes32;
  beneficiaries: readonly Address[];
  sharesBps: readonly number[];
}>): HexBytes32 {
  return keccak256(encodeAbiParameters(REWARD_CONFIGURATION_PARAMETERS, [
    1n,
    input.vault,
    input.hook,
    input.poolManager,
    input.quoteAsset,
    input.poolId,
    [...input.beneficiaries],
    [...input.sharesBps],
  ]));
}

function feeTotals(
  logs: readonly DecodedLog[],
  launch: StockLaunch,
): Readonly<{ gross: bigint; creator: bigint; launcher: bigint; count: number }> {
  let gross = 0n;
  let creator = 0n;
  let launcher = 0n;
  let count = 0;
  for (const event of logs) {
    if (
      event.eventName !== "QuoteSwapFeesAccrued" ||
      !sameHex(exactBytes32(
        event.args.poolId,
        "stock-reconciler-fee-pool",
      ), launch.poolId)
    ) {
      continue;
    }
    const grossAmount = nonnegative(
      event.args.grossQuoteAmount,
      "stock-reconciler-gross-quote",
    );
    const creatorAmount = nonnegative(
      event.args.creatorFee,
      "stock-reconciler-creator-fee",
    );
    const launcherAmount = nonnegative(
      event.args.launcherFee,
      "stock-reconciler-launcher-fee",
    );
    if (
      typeof event.args.isBuy !== "boolean" ||
      !sameHex(exactAddress(
        event.args.quoteAsset,
        "stock-reconciler-fee-quote",
      ), launch.quoteAsset) ||
      creatorAmount + launcherAmount !==
        grossAmount * BigInt(STOCK_PAIRED_TOTAL_SWAP_FEE_BPS) / 10_000n ||
      launcherAmount !==
        grossAmount * BigInt(STOCK_PAIRED_PROGRAMMABLE_FEE_BPS) / 10_000n
    ) {
      fail("stock-reconciler-fee-conservation");
    }
    gross += grossAmount;
    creator += creatorAmount;
    launcher += launcherAmount;
    count += 1;
  }
  return Object.freeze({ gross, creator, launcher, count });
}

function swapState(
  logs: readonly DecodedLog[],
  poolId: HexBytes32,
): Readonly<{ count: number; last: DecodedLog | null }> {
  const matches = logs.filter(({ eventName, args }) =>
    eventName === "Swap" &&
    sameHex(exactBytes32(args.id, "stock-reconciler-swap-pool"), poolId)
  );
  return Object.freeze({ count: matches.length, last: matches.at(-1) ?? null });
}

function isoTimestamp(timestamp: bigint): string {
  if (timestamp < 0n || timestamp > 8_640_000_000_000n) {
    fail("stock-reconciler-block-time");
  }
  return new Date(Number(timestamp) * 1_000).toISOString();
}

function contributionDocument(
  releaseVersion: StockPairedReconcilerRelease,
  parts: Omit<StockPairedReconcilerContribution,
    "contractVersion" | "releaseVersion" | "modelId">,
): StockPairedReconcilerContribution {
  return assertStockPairedReconcilerContribution(Object.freeze({
    contractVersion: STOCK_PAIRED_RECONCILER_CONTRIBUTION_CONTRACT,
    releaseVersion,
    modelId: "stock-paired" as const,
    ...parts,
  }));
}

async function buildContribution(
  releaseVersion: StockPairedReconcilerRelease,
  input: Parameters<StockPairedExactBlockContributionBuilder>[0],
): Promise<StockPairedReconcilerContribution> {
  const release = resolveRelease(input.contract, releaseVersion);
  if (
    input.contract.checkpointBlockNumber !== input.blockNumber.toString() ||
    !sameHex(input.contract.checkpointBlockHash, input.blockHash)
  ) {
    throw invalidInput("config", "stock-reconciler-checkpoint-binding");
  }
  if (input.blockNumber < BigInt(release.startBlock)) {
    fail("stock-reconciler-checkpoint-before-release");
  }
  await assertRuntime({
    rpc: input.rpc,
    release,
    blockHash: input.blockHash,
    signal: input.signal,
  });

  const fromBlock = BigInt(release.startBlock);
  const [launcherLogs, coordinatorLogs, hookLogs, factoryLogs] =
    await Promise.all([
      readLogsInRanges({
        rpc: input.rpc,
        addresses: release.addresses.launcher,
        events: LAUNCHER_EVENTS,
        fromBlock,
        toBlock: input.blockNumber,
        signal: input.signal,
      }),
      readLogsInRanges({
        rpc: input.rpc,
        addresses: release.addresses.ethLaunchCoordinator,
        events: [ethLaunchEvent],
        fromBlock,
        toBlock: input.blockNumber,
        signal: input.signal,
      }),
      readLogsInRanges({
        rpc: input.rpc,
        addresses: release.addresses.feeHook,
        events: HOOK_EVENTS,
        fromBlock,
        toBlock: input.blockNumber,
        signal: input.signal,
      }),
      readLogsInRanges({
        rpc: input.rpc,
        addresses: release.addresses.feeSplitVaultFactory,
        events: [vaultDeployedEvent],
        fromBlock,
        toBlock: input.blockNumber,
        signal: input.signal,
      }),
    ]);
  const launches = launchRecords(launcherLogs, release);
  const launchCompanions = companions({
    launches,
    launcherLogs,
    coordinatorLogs,
    hookLogs,
    factoryLogs,
    release,
  });
  const transactionBindings = launches.map((launch) => Object.freeze({
    transactionHash: launch.transactionHash,
    expectedBlockNumber: launch.blockNumber,
    expectedBlockHash: launch.blockHash,
    expectedTo: release.addresses.ethLaunchCoordinator,
  }));
  const receiptBindings = launches.map((launch) => Object.freeze({
    transactionHash: launch.transactionHash,
    expectedBlockNumber: launch.blockNumber,
    expectedBlockHash: launch.blockHash,
  }));
  const [transactions, receipts, poolSwapLogs] = await Promise.all([
    input.rpc.getTransactions({
      transactions: transactionBindings,
      signal: input.signal,
    }),
    input.rpc.getTransactionReceipts({
      receipts: receiptBindings,
      signal: input.signal,
    }),
    readPoolSwapLogs({
      rpc: input.rpc,
      poolManager: release.officialDependencies.poolManager.address,
      poolIds: launches.map(({ poolId }) => poolId),
      fromBlock,
      toBlock: input.blockNumber,
      signal: input.signal,
    }),
  ]);
  const launchInputs = validatedLaunchInputs({
    launches,
    companions: launchCompanions,
    transactions,
    receipts,
    release,
  });

  for (const quoteAsset of new Set(launches.map(({ quoteAsset }) => quoteAsset))) {
    const codeHash = await input.rpc.getCodeHash({
      address: quoteAsset,
      blockHash: input.blockHash,
      signal: input.signal,
    });
    if (!sameHex(codeHash, release.issuerRuntime.tokenRuntimeCodeHash)) {
      fail("stock-reconciler-quote-runtime");
    }
  }

  const calls = launches.flatMap((launch) => {
    const launchInput = launchInputs.get(lowerAddress(launch.token));
    if (!launchInput) fail("stock-reconciler-launch-input-missing");
    return [
      callSpec(launch.token, uerc20ReadAbi, "name"),
      callSpec(launch.token, uerc20ReadAbi, "symbol"),
      callSpec(launch.token, uerc20ReadAbi, "decimals"),
      callSpec(launch.token, uerc20ReadAbi, "totalSupply"),
      callSpec(launch.token, uerc20ReadAbi, "creator"),
      callSpec(launch.token, uerc20ReadAbi, "metadata"),
      callSpec(release.officialDependencies.stateView.address,
        stateViewReadAbi, "getSlot0", [launch.poolId]),
      callSpec(release.officialDependencies.stateView.address,
        stateViewReadAbi, "getLiquidity", [launch.poolId]),
      callSpec(release.addresses.feeHook, stockPairedHookAbi,
        "feeDisclosure", [launch.poolId]),
      callSpec(release.addresses.feeHook, stockPairedHookAbi,
        "poolFeeConfig", [launch.poolId]),
      callSpec(release.addresses.ethLaunchCoordinator,
        stockPairedEthLaunchCoordinatorAbi, "predictTokenAddress", [
          launchInput.name,
          launchInput.symbol,
          launchInput.creator,
          launchInput.creatorSalt,
        ]),
      callSpec(release.addresses.launcher, launcherStateAbi,
        "launchHashOf", [launch.token]),
      callSpec(release.addresses.launcher, launcherStateAbi,
        "rewardVaultOf", [launch.token]),
      callSpec(release.addresses.launcher, launcherStateAbi,
        "quoteAssetOf", [launch.token]),
      callSpec(release.addresses.feeSplitVaultFactory,
        rewardVaultFactoryStateAbi, "isFactoryVault", [launch.rewardVault]),
      callSpec(release.addresses.feeSplitVaultFactory,
        rewardVaultFactoryStateAbi, "configurationHashOf", [launch.rewardVault]),
      callSpec(launch.rewardVault, stockFeeSplitVaultAbi, "feeHook"),
      callSpec(launch.rewardVault, stockFeeSplitVaultAbi, "poolId"),
      callSpec(launch.rewardVault, stockFeeSplitVaultAbi, "quoteAsset"),
      callSpec(launch.rewardVault, stockFeeSplitVaultAbi, "configurationHash"),
      callSpec(launch.rewardVault, stockFeeSplitVaultAbi, "beneficiaryCount"),
      callSpec(launch.rewardVault, stockFeeSplitVaultAbi,
        "totalCreatorFeesReceived"),
      callSpec(launch.rewardVault, stockFeeSplitVaultAbi,
        "totalCreatorFeesClaimed"),
      callSpec(release.addresses.quoteRegistry, stockQuoteRegistryAbi,
        "isSupported", [launch.quoteAsset]),
      callSpec(release.addresses.quoteRegistry, stockQuoteRegistryAbi,
        "assertAssetReady", [launch.quoteAsset]),
      callSpec(release.addresses.positionForwarderFactory,
        positionForwarderFactoryStateAbi, "isFactoryForwarder", [
          launch.positionRecipient,
        ]),
      callSpec(release.addresses.positionForwarderFactory,
        positionForwarderFactoryStateAbi, "configurationHashOf", [
          launch.positionRecipient,
        ]),
    ];
  });
  const values = await readCalls(
    input.rpc,
    calls,
    input.blockHash,
    input.signal,
  );

  const timestamps = new Map<string, bigint>();
  for (const launch of launches) {
    const key = launch.blockNumber.toString();
    if (!timestamps.has(key)) {
      timestamps.set(key, await input.rpc.getBlockTimestamp({
        blockNumber: launch.blockNumber,
        expectedHash: launch.blockHash,
        signal: input.signal,
      }));
    }
  }

  const tokens: Json[] = [];
  const charts: Json[] = [];
  const lookups: Json[] = [];
  for (let index = 0; index < launches.length; index += 1) {
    const launch = launches[index]!;
    const launchInput = launchInputs.get(lowerAddress(launch.token));
    const companion = launchCompanions.get(lowerAddress(launch.token));
    if (!launchInput || !companion) {
      fail("stock-reconciler-launch-evidence-missing");
    }
    const offset = index * CALLS_PER_LAUNCH;
    const name = exactText(values[offset], "stock-reconciler-current-name");
    const symbol = exactText(values[offset + 1],
      "stock-reconciler-current-symbol");
    const decimals = safeInteger(values[offset + 2], 0, 255,
      "stock-reconciler-current-decimals");
    const totalSupply = nonnegative(values[offset + 3],
      "stock-reconciler-current-supply");
    const tokenCreator = exactAddress(values[offset + 4],
      "stock-reconciler-token-creator");
    const metadata = tuple(values[offset + 5], 4,
      "stock-reconciler-current-metadata");
    const slot0 = tuple(values[offset + 6], 4,
      "stock-reconciler-slot0");
    nonnegative(values[offset + 7], "stock-reconciler-active-liquidity");
    const disclosure = tuple(values[offset + 8], 9,
      "stock-reconciler-current-disclosure");
    const poolConfig = tuple(values[offset + 9], 7,
      "stock-reconciler-current-pool-config");
    const predictedToken = tuple(values[offset + 10], 2,
      "stock-reconciler-predicted-token");
    const currentLaunchHash = exactBytes32(values[offset + 11],
      "stock-reconciler-current-launch-hash");
    const currentRewardVault = exactAddress(values[offset + 12],
      "stock-reconciler-current-reward-vault");
    const currentQuoteAsset = exactAddress(values[offset + 13],
      "stock-reconciler-current-quote-asset");
    const isFactoryVault = values[offset + 14];
    const factoryConfigurationHash = exactBytes32(values[offset + 15],
      "stock-reconciler-factory-configuration-hash");
    const vaultHook = exactAddress(values[offset + 16],
      "stock-reconciler-vault-hook");
    const vaultPoolId = exactBytes32(values[offset + 17],
      "stock-reconciler-vault-pool");
    const vaultQuoteAsset = exactAddress(values[offset + 18],
      "stock-reconciler-vault-quote");
    const vaultConfigurationHash = exactBytes32(values[offset + 19],
      "stock-reconciler-vault-configuration-hash");
    const beneficiaryCount = safeInteger(values[offset + 20], 1, 8,
      "stock-reconciler-beneficiary-count");
    const totalReceived = nonnegative(values[offset + 21],
      "stock-reconciler-total-received");
    const totalClaimed = nonnegative(values[offset + 22],
      "stock-reconciler-total-claimed");
    const registrySupported = values[offset + 23];
    const quoteConfigurationHash = exactBytes32(values[offset + 24],
      "stock-reconciler-quote-configuration-hash");
    const isFactoryForwarder = values[offset + 25];
    const forwarderConfigurationHash = exactBytes32(values[offset + 26],
      "stock-reconciler-forwarder-configuration-hash");

    const pool = poolIdentity(
      launch.token,
      launch.quoteAsset,
      release.addresses.feeHook,
    );
    const expectedRewardHash = rewardConfigurationHash({
      vault: launch.rewardVault,
      hook: release.addresses.feeHook,
      poolManager: release.officialDependencies.poolManager.address,
      quoteAsset: launch.quoteAsset,
      poolId: launch.poolId,
      beneficiaries: launchInput.beneficiaries,
      sharesBps: launchInput.sharesBps,
    });
    const registration = companion.registration.args;
    if (
      name !== launchInput.name ||
      symbol !== launchInput.symbol ||
      decimals !== 18 ||
      totalSupply !== TOKEN_SUPPLY ||
      !sameHex(tokenCreator, release.addresses.launcher) ||
      exactText(metadata[0], "stock-reconciler-current-description") !==
        launchInput.description ||
      exactText(metadata[1], "stock-reconciler-current-website") !==
        launchInput.website ||
      exactText(metadata[2], "stock-reconciler-current-image") !==
        launchInput.image ||
      !sameHex(exactData(metadata[3], "stock-reconciler-current-extra-data"),
        launchInput.extraData) ||
      !sameHex(pool.poolId, launch.poolId) ||
      !sameHex(exactAddress(predictedToken[0],
        "stock-reconciler-predicted-token-address"), launch.token) ||
      !sameHex(currentLaunchHash, launch.launchHash) ||
      !sameHex(currentRewardVault, launch.rewardVault) ||
      !sameHex(currentQuoteAsset, launch.quoteAsset) ||
      isFactoryVault !== true ||
      !sameHex(factoryConfigurationHash, expectedRewardHash) ||
      !sameHex(vaultConfigurationHash, expectedRewardHash) ||
      !sameHex(vaultHook, release.addresses.feeHook) ||
      !sameHex(vaultPoolId, launch.poolId) ||
      !sameHex(vaultQuoteAsset, launch.quoteAsset) ||
      beneficiaryCount !== launchInput.beneficiaries.length ||
      totalClaimed > totalReceived ||
      registrySupported !== true ||
      isFactoryForwarder !== true ||
      sameHex(forwarderConfigurationHash, `0x${"00".repeat(32)}`) ||
      !sameHex(exactBytes32(registration.rewardConfigurationHash,
        "stock-reconciler-registration-reward-hash"), expectedRewardHash) ||
      !sameHex(exactBytes32(registration.quoteConfigurationHash,
        "stock-reconciler-registration-quote-hash"), quoteConfigurationHash) ||
      registration.quoteIsCurrency0 !== pool.quoteIsCurrency0
    ) {
      fail("stock-reconciler-current-provenance");
    }

    const [disclosedQuote, disclosedToken, buySwapFee, sellSwapFee,
      creatorFee, launcherFee, transferTax, lpFee, disclosedVault] = disclosure;
    const [configuredQuote, configuredToken, configuredVault, registrar,
      quoteIsCurrency0, registered, pendingCreatorFees] = poolConfig;
    const currentPendingCreatorFees = nonnegative(
      pendingCreatorFees,
      "stock-reconciler-pending-creator-fees",
    );
    const buySwapFeeBps = safeInteger(buySwapFee, 0, 10_000,
      "stock-reconciler-buy-fee");
    const sellSwapFeeBps = safeInteger(sellSwapFee, 0, 10_000,
      "stock-reconciler-sell-fee");
    const creatorFeeBps = safeInteger(creatorFee, 0, 10_000,
      "stock-reconciler-creator-fee");
    const launcherFeeBps = safeInteger(launcherFee, 0, 10_000,
      "stock-reconciler-launcher-fee");
    const transferTaxBps = safeInteger(transferTax, 0, 10_000,
      "stock-reconciler-transfer-tax");
    const lpFeePips = safeInteger(lpFee, 0, 1_000_000,
      "stock-reconciler-lp-fee");
    if (
      !sameHex(exactAddress(disclosedQuote,
        "stock-reconciler-disclosed-quote"), launch.quoteAsset) ||
      !sameHex(exactAddress(disclosedToken,
        "stock-reconciler-disclosed-token"), launch.token) ||
      !sameHex(exactAddress(disclosedVault,
        "stock-reconciler-disclosed-vault"), launch.rewardVault) ||
      !sameHex(exactAddress(configuredQuote,
        "stock-reconciler-configured-quote"), launch.quoteAsset) ||
      !sameHex(exactAddress(configuredToken,
        "stock-reconciler-configured-token"), launch.token) ||
      !sameHex(exactAddress(configuredVault,
        "stock-reconciler-configured-vault"), launch.rewardVault) ||
      !sameHex(exactAddress(registrar,
        "stock-reconciler-configured-registrar"), release.addresses.launcher) ||
      quoteIsCurrency0 !== pool.quoteIsCurrency0 ||
      registered !== true ||
      buySwapFeeBps !== STOCK_PAIRED_TOTAL_SWAP_FEE_BPS ||
      sellSwapFeeBps !== STOCK_PAIRED_TOTAL_SWAP_FEE_BPS ||
      creatorFeeBps !== STOCK_PAIRED_CREATOR_FEE_BPS ||
      launcherFeeBps !== STOCK_PAIRED_PROGRAMMABLE_FEE_BPS ||
      transferTaxBps !== 0 ||
      lpFeePips !== 0
    ) {
      fail("stock-reconciler-current-fee-configuration");
    }
    const disclosedEvent = companion.disclosure.args;
    if (
      safeInteger(disclosedEvent.buySwapFeeBps, 0, 10_000,
        "stock-reconciler-event-buy-fee") !== buySwapFeeBps ||
      safeInteger(disclosedEvent.sellSwapFeeBps, 0, 10_000,
        "stock-reconciler-event-sell-fee") !== sellSwapFeeBps ||
      safeInteger(disclosedEvent.creatorFeeBps, 0, 10_000,
        "stock-reconciler-event-creator-fee") !== creatorFeeBps ||
      safeInteger(disclosedEvent.launcherFeeBps, 0, 10_000,
        "stock-reconciler-event-launcher-fee") !== launcherFeeBps ||
      safeInteger(disclosedEvent.transferTaxBps, 0, 10_000,
        "stock-reconciler-event-transfer-tax") !== transferTaxBps ||
      safeInteger(disclosedEvent.lpFeePips, 0, 1_000_000,
        "stock-reconciler-event-lp-fee") !== lpFeePips
    ) {
      fail("stock-reconciler-event-fee-configuration");
    }

    const liquidityArgs = companion.liquidity.args;
    const tokenLiquidity = nonnegative(
      liquidityArgs.tokenLiquidityAmount,
      "stock-reconciler-token-liquidity",
    );
    const lockedDust = nonnegative(
      liquidityArgs.lockedTokenDust,
      "stock-reconciler-locked-dust",
    );
    const initialTick = safeInteger(liquidityArgs.initialTick,
      -887_272, 887_272, "stock-reconciler-initial-tick");
    const tickLower = safeInteger(liquidityArgs.tickLower,
      -887_272, 887_272, "stock-reconciler-lower-tick");
    const tickUpper = safeInteger(liquidityArgs.tickUpper,
      -887_272, 887_272, "stock-reconciler-upper-tick");
    const expectedInitialTick = getStockPairedExpectedInitialTickForRelease(
      release,
      launch.quoteAsset,
      pool.quoteIsCurrency0,
    );
    if (
      nonnegative(liquidityArgs.totalSupply,
        "stock-reconciler-liquidity-supply") !== totalSupply ||
      tokenLiquidity + lockedDust !== totalSupply ||
      expectedInitialTick === null ||
      initialTick !== expectedInitialTick ||
      (pool.quoteIsCurrency0
        ? tickLower !== MINIMUM_USABLE_TICK || tickUpper !== initialTick
        : tickLower !== initialTick || tickUpper !== MAXIMUM_USABLE_TICK) ||
      safeInteger(liquidityArgs.lpFeePips, 0, 1_000_000,
        "stock-reconciler-event-liquidity-fee") !== lpFeePips
    ) {
      fail("stock-reconciler-liquidity-provenance");
    }

    const currentSlot0 = {
      sqrtPriceX96: nonnegative(slot0[0], "stock-reconciler-current-price"),
      tick: safeInteger(slot0[1], -887_272, 887_272,
        "stock-reconciler-current-tick"),
      protocolFee: safeInteger(slot0[2], 0, 1_000_000,
        "stock-reconciler-protocol-fee"),
      lpFee: safeInteger(slot0[3], 0, 1_000_000,
        "stock-reconciler-current-lp-fee"),
    };
    const swaps = swapState(poolSwapLogs, launch.poolId);
    const totals = feeTotals(hookLogs, launch);
    const lastSwap = swaps.last;
    if (!lastSwap || swaps.count < totals.count || totals.count < 1) {
      fail("stock-reconciler-swap-coverage");
    }
    const lastSwapPrice = nonnegative(lastSwap.args.sqrtPriceX96,
      "stock-reconciler-last-swap-price");
    const lastSwapLiquidity = nonnegative(lastSwap.args.liquidity,
      "stock-reconciler-last-swap-liquidity");
    const lastSwapTick = safeInteger(lastSwap.args.tick, -887_272, 887_272,
      "stock-reconciler-last-swap-tick");
    if (
      currentSlot0.sqrtPriceX96 !== lastSwapPrice ||
      currentSlot0.tick !== lastSwapTick ||
      currentSlot0.lpFee !== lpFeePips ||
      totalReceived + currentPendingCreatorFees !== totals.creator
    ) {
      fail("stock-reconciler-current-pool-state");
    }
    const timestamp = timestamps.get(launch.blockNumber.toString());
    if (timestamp === undefined) fail("stock-reconciler-launch-time-missing");

    const tokenJson: Json = {
      releaseVersion,
      modelId: "stock-paired",
      tokenAddress: lowerAddress(launch.token),
      creatorAddress: lowerAddress(launchInput.creator),
      launchTransactionHash: launch.transactionHash,
      launchBlockNumber: launch.blockNumber.toString(),
      launchTransactionIndex: launch.transactionIndex,
      launchLogIndex: launchInput.receiptLogIndex,
      launchedAt: isoTimestamp(timestamp),
      poolId: launch.poolId,
      hookAddress: lowerAddress(release.addresses.feeHook),
      quoteAssetAddress: lowerAddress(launch.quoteAsset),
      rewardVaultAddress: lowerAddress(launch.rewardVault),
      positionRecipient: lowerAddress(launch.positionRecipient),
      positionTokenId: launch.positionTokenId.toString(),
      launchHash: launch.launchHash,
      name,
      symbol,
      decimals,
      totalSupplyRaw: totalSupply.toString(),
      fees: {
        buySwapFeeBps,
        sellSwapFeeBps,
        buyCreatorFeeBps: creatorFeeBps,
        sellCreatorFeeBps: creatorFeeBps,
        launcherFeeBps,
        transferTaxBps,
        lpFeePips,
      },
      liquidity: {
        tokenLiquidityAmountRaw: tokenLiquidity.toString(),
        lockedTokenDustRaw: lockedDust.toString(),
        initialTick,
        tickLower,
        tickUpper,
      },
    };
    tokens.push(tokenJson);
    charts.push({
      releaseVersion,
      modelId: "stock-paired",
      tokenAddress: lowerAddress(launch.token),
      poolId: launch.poolId,
      quoteAssetAddress: lowerAddress(launch.quoteAsset),
      state: {
        blockNumber: lastSwap.log.blockNumber.toString(),
        blockHash: lastSwap.log.blockHash,
        transactionHash: lastSwap.log.transactionHash,
        transactionIndex: lastSwap.log.transactionIndex,
        logIndex: lastSwap.log.logIndex,
        sqrtPriceX96: lastSwapPrice.toString(),
        liquidity: lastSwapLiquidity.toString(),
        tick: lastSwapTick,
        lpFeePips,
      },
      volume: {
        quoteAssetAddress: lowerAddress(launch.quoteAsset),
        grossQuoteRaw: totals.gross.toString(),
        creatorFeeQuoteRaw: totals.creator.toString(),
        launcherFeeQuoteRaw: totals.launcher.toString(),
      },
    });
    lookups.push({
      releaseVersion,
      modelId: "stock-paired",
      account: lowerAddress(launchInput.creator),
      launchTransactionHash: launch.transactionHash,
      tokenAddress: lowerAddress(launch.token),
    });
  }

  const profileTokens = new Map<string, Json[]>();
  tokens.forEach((token, index) => {
    const account = lowerAddress(
      launchInputs.get(lowerAddress(launches[index]!.token))!.creator,
    );
    const existing = profileTokens.get(account) ?? [];
    const row = token as {
      tokenAddress: string;
      launchTransactionHash: string;
    };
    existing.push({
      releaseVersion,
      modelId: "stock-paired",
      tokenAddress: row.tokenAddress,
      launchTransactionHash: row.launchTransactionHash,
    });
    profileTokens.set(account, existing);
  });
  const profiles = [...profileTokens.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([account, profileTokenRows]) => ({
      account,
      tokens: profileTokenRows,
    }));

  return contributionDocument(releaseVersion, {
    tokens: Object.freeze(tokens),
    charts: Object.freeze(charts),
    profiles: Object.freeze(profiles),
    launches: Object.freeze(lookups),
  });
}

export const buildStockPairedV1ExactBlockContribution:
  StockPairedExactBlockContributionBuilder =
  async (input) => buildContribution("stock-paired-v1", input);

export const buildStockPairedV2ExactBlockContribution:
  StockPairedExactBlockContributionBuilder =
  async (input) => buildContribution("stock-paired-v2", input);

export const buildStockPairedV3ExactBlockContribution:
  StockPairedExactBlockContributionBuilder =
  async (input) => buildContribution("stock-paired-v3", input);
