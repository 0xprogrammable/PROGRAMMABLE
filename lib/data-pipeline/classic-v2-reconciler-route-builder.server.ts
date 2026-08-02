import "server-only";

import {
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddress,
  parseAbi,
  parseAbiItem,
  toEventSelector,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";

import deployment from "../../contracts/deployments/mainnet-classic-v2.json";
import dependencies from "../../contracts/dependencies/ethereum-mainnet.json";
import type { CanonicalJsonValue } from "./canonical-fingerprint";
import { canonicalBytes32, type HexBytes32 } from "./codecs";
import {
  assembleReconcilerCorpusPages,
  createReconcilerCorpusManifest,
} from "./reconciler-corpus-partitions";
import {
  dataPipelineError,
  invalidInput,
  validationError,
} from "./errors";
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
  creatorFeesClaimedEvent,
  creatorFeeHookReadAbi,
  stateViewReadAbi,
  uerc20ReadAbi,
} from "../onchain/abis";

const ZERO_ADDRESS = `0x${"00".repeat(20)}` as Address;
const MAXIMUM_LOGS_PER_REQUEST = 20_000;
const MAXIMUM_POOLS_PER_LOG_REQUEST = 64;
const CALLS_PER_LAUNCH = 14;
const EXPECTED_INITIAL_TICK = 204_200;
const EXPECTED_TICK_LOWER = -887_200;

export const CLASSIC_V2_RECONCILER_ROUTE_KEYS = Object.freeze([
  "explore-list",
  "explore-token",
  "explore-chart",
  "creator-profile",
] as const satisfies readonly ReconcilerRouteKey[]);

// QuickNode and the portable fallback both support this exact range. Keeping
// every request at the common boundary avoids provider-dependent corpora.
export const CLASSIC_V2_RECONCILER_LOG_BLOCK_RANGE = 10_000n;

export type ClassicV2ReconcilerRouteContribution = Readonly<{
  tokens: readonly CanonicalJsonValue[];
  charts: readonly CanonicalJsonValue[];
}>;

const launcherAbi = parseAbi([
  "function launch((string name,string symbol,uint16 totalSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata) parameters) payable",
  "function predictTokenAddress(string name,string symbol,address creator,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function predictPositionRecipient(address token,address creator) view returns (address)",
  "function poolKey(address token) view returns (address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
  "function launchHashOf(address token) view returns (bytes32)",
  "function poolManager() view returns (address)",
  "function feeHook() view returns (address)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
]);

const hookInfrastructureAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function TICK_SPACING() view returns (int24)",
]);

const launchedEvent = parseAbiItem(
  "event MemeTokenLaunched(address indexed creator,address indexed token,bytes32 indexed poolId,address feeHook,address positionRecipient,uint256 positionTokenId,uint16 totalSwapFeeBps,bytes32 launchHash)",
);
const liquidityEvent = parseAbiItem(
  "event MemeLiquidityConfigured(address indexed token,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
);
const initialBuyEvent = parseAbiItem(
  "event MemeCreatorInitialBuy(address indexed creator,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,bytes32 launchHash)",
);
const registeredEvent = parseAbiItem(
  "event PoolRegistered(bytes32 indexed poolId,address indexed token,address indexed creator,address registrar,uint16 totalSwapFeeBps)",
);
const disclosureEvent = parseAbiItem(
  "event PoolFeeDisclosure(bytes32 indexed poolId,address indexed token,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips)",
);
const feeAccruedEvent = parseAbiItem(
  "event NativeSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,uint256 grossNativeAmount,uint256 creatorFee,uint256 launcherFee)",
);
const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
);

const LAUNCHER_EVENTS = Object.freeze([
  launchedEvent,
  liquidityEvent,
  initialBuyEvent,
]);
const HOOK_EVENTS = Object.freeze([
  registeredEvent,
  disclosureEvent,
  feeAccruedEvent,
  creatorFeesClaimedEvent,
]);

type Json = CanonicalJsonValue;

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

type LaunchRecord = Readonly<{
  creator: Address;
  token: Address;
  poolId: HexBytes32;
  hook: Address;
  positionRecipient: Address;
  positionTokenId: bigint;
  totalSwapFeeBps: number;
  launchHash: HexBytes32;
  blockNumber: bigint;
  blockHash: HexBytes32;
  transactionHash: HexBytes32;
  transactionIndex: number;
  blockGlobalLogIndex: number;
  log: ExactBlockRpcLog;
}>;

type Release = Readonly<{
  launcher: Address;
  hook: Address;
  hookFactory: Address;
  positionForwarderFactory: Address;
  treasury: Address;
  poolManager: Address;
  stateView: Address;
  startBlock: bigint;
  runtime: ReadonlyArray<Readonly<{
    address: Address;
    expectedHash: HexBytes32;
    label: string;
  }>>;
}>;

type LaunchTransactionEvidence = Readonly<{
  receiptLogIndex: number;
  value: bigint;
  name: string;
  symbol: string;
  totalSwapFeeBps: number;
  creatorSalt: HexBytes32;
  description: string;
  website: string;
  image: string;
  extraData: Hex;
}>;

type LaunchCompanionEvidence = Readonly<{
  liquidity: DecodedLog;
  initialBuy: DecodedLog;
  registration: DecodedLog;
  disclosure: DecodedLog;
}>;

function fail(operation: string): never {
  throw validationError("uniswap", operation);
}

function lowerAddress(value: Address): string {
  return value.toLowerCase();
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
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)
  ) {
    fail(operation);
  }
  return value.toLowerCase() as Hex;
}

function exactText(value: unknown, operation: string): string {
  if (typeof value !== "string") fail(operation);
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

function absolute(value: unknown, operation: string): bigint {
  const parsed = integer(value, operation);
  return parsed < 0n ? -parsed : parsed;
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

function tuple(
  value: unknown,
  length: number,
  operation: string,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== length) fail(operation);
  return value;
}

function record(
  value: unknown,
  operation: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(operation);
  }
  return value as Readonly<Record<string, unknown>>;
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function exactRouteKeys(contract: ReconcilerPreParityContract): boolean {
  return contract.routeKeys.length === CLASSIC_V2_RECONCILER_ROUTE_KEYS.length &&
    contract.routeKeys.every(
      (routeKey, index) => routeKey === CLASSIC_V2_RECONCILER_ROUTE_KEYS[index],
    );
}

export function classicV2ReconcilerBlockRanges(
  fromBlock: bigint,
  toBlock: bigint,
): readonly Readonly<{ fromBlock: bigint; toBlock: bigint }>[] {
  if (fromBlock < 0n || toBlock < fromBlock) {
    throw invalidInput("rpc", "classic-v2-log-range");
  }
  const ranges: Array<Readonly<{ fromBlock: bigint; toBlock: bigint }>> = [];
  for (
    let start = fromBlock;
    start <= toBlock;
    start += CLASSIC_V2_RECONCILER_LOG_BLOCK_RANGE
  ) {
    const end = start + CLASSIC_V2_RECONCILER_LOG_BLOCK_RANGE - 1n;
    ranges.push(Object.freeze({
      fromBlock: start,
      toBlock: end > toBlock ? toBlock : end,
    }));
  }
  return Object.freeze(ranges);
}

export function assertClassicV2ReconcilerLaunchCount(count: number): number {
  if (
    !Number.isSafeInteger(count) ||
    count < 1
  ) {
    fail("classic-v2-launch-cardinality");
  }
  return count;
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
    decode: (result: Hex) =>
      decodeFunctionResult({
        abi,
        functionName,
        data: result,
      } as never) as unknown,
  });
}

function eventMap(events: readonly AbiEvent[]) {
  return new Map(
    events.map((event) => [toEventSelector(event).toLowerCase(), event]),
  );
}

function decodeKnownEvent(
  eventBySelector: ReadonlyMap<string, AbiEvent>,
  log: ExactBlockRpcLog,
): DecodedLog {
  const selector = log.topics[0]?.toLowerCase();
  const event = selector ? eventBySelector.get(selector) : undefined;
  if (!event) fail("classic-v2-log-selector");
  let decoded: ReturnType<typeof decodeEventLog>;
  try {
    decoded = decodeEventLog({
      abi: [event],
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
      strict: true,
    });
  } catch {
    return fail("classic-v2-log-decode");
  }
  if (
    typeof decoded.args !== "object" ||
    decoded.args === null ||
    Array.isArray(decoded.args)
  ) {
    fail("classic-v2-log-args");
  }
  return Object.freeze({
    eventName: decoded.eventName,
    args: decoded.args as Readonly<Record<string, unknown>>,
    log,
  });
}

async function readUncappedLogs(input: {
  rpc: ExactBlockRpcClient;
  addresses: Address | readonly Address[];
  topics: readonly (Hex | readonly Hex[] | null)[];
  fromBlock: bigint;
  toBlock: bigint;
  signal: AbortSignal;
}): Promise<readonly ExactBlockRpcLog[]> {
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
      metadata: { operation: "classic-v2-single-block-log-boundary" },
    });
  }
  const midpoint = input.fromBlock + (input.toBlock - input.fromBlock) / 2n;
  const [left, right] = await Promise.all([
    readUncappedLogs({ ...input, toBlock: midpoint }),
    readUncappedLogs({ ...input, fromBlock: midpoint + 1n }),
  ]);
  return Object.freeze([...left, ...right]);
}

async function readLogsInRanges(input: {
  rpc: ExactBlockRpcClient;
  addresses: Address | readonly Address[];
  events: readonly AbiEvent[];
  fromBlock: bigint;
  toBlock: bigint;
  signal: AbortSignal;
}): Promise<readonly DecodedLog[]> {
  if (input.toBlock < input.fromBlock) return Object.freeze([]);
  const selectorMap = eventMap(input.events);
  const selectors = [...selectorMap.keys()] as Hex[];
  const allowedAddresses = new Set(
    (Array.isArray(input.addresses) ? input.addresses : [input.addresses])
      .map((address) => lowerAddress(address)),
  );
  const output: DecodedLog[] = [];
  for (const { fromBlock, toBlock } of classicV2ReconcilerBlockRanges(
    input.fromBlock,
    input.toBlock,
  )) {
    const logs = await readUncappedLogs({
      rpc: input.rpc,
      addresses: input.addresses,
      topics: [selectors],
      fromBlock,
      toBlock,
      signal: input.signal,
    });
    if (logs.some((log) =>
      !allowedAddresses.has(lowerAddress(log.address)) ||
      !selectorMap.has((log.topics[0] ?? "").toLowerCase()) ||
      log.blockNumber < fromBlock ||
      log.blockNumber > toBlock
    )) {
      fail("classic-v2-log-filter-binding");
    }
    output.push(...logs.map((log) => decodeKnownEvent(selectorMap, log)));
  }
  for (let index = 1; index < output.length; index += 1) {
    const previous = output[index - 1]!.log;
    const current = output[index]!.log;
    if (
      current.blockNumber < previous.blockNumber ||
      (current.blockNumber === previous.blockNumber &&
        (current.transactionIndex < previous.transactionIndex ||
          (current.transactionIndex === previous.transactionIndex &&
            current.logIndex <= previous.logIndex)))
    ) {
      fail("classic-v2-log-corpus-order");
    }
  }
  return Object.freeze(output);
}

async function readPoolSwapBatches(input: {
  rpc: ExactBlockRpcClient;
  poolManager: Address;
  poolIds: readonly HexBytes32[];
  fromBlock: bigint;
  toBlock: bigint;
  signal: AbortSignal;
}): Promise<readonly DecodedLog[]> {
  const selectorMap = eventMap([swapEvent]);
  const output: DecodedLog[] = [];
  for (
    let poolIndex = 0;
    poolIndex < input.poolIds.length;
    poolIndex += MAXIMUM_POOLS_PER_LOG_REQUEST
  ) {
    const poolIds = input.poolIds.slice(
      poolIndex,
      poolIndex + MAXIMUM_POOLS_PER_LOG_REQUEST,
    );
    for (const { fromBlock, toBlock } of classicV2ReconcilerBlockRanges(
      input.fromBlock,
      input.toBlock,
    )) {
      const logs = await readUncappedLogs({
        rpc: input.rpc,
        addresses: input.poolManager,
        topics: [toEventSelector(swapEvent), poolIds],
        fromBlock,
        toBlock,
        signal: input.signal,
      });
      if (logs.some((log) =>
        !sameHex(log.address, input.poolManager) ||
        !sameHex(log.topics[0] ?? "0x", toEventSelector(swapEvent)) ||
        log.blockNumber < fromBlock ||
        log.blockNumber > toBlock
      )) {
        fail("classic-v2-swap-log-filter-binding");
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

function resolvedRelease(contract: ReconcilerPreParityContract): Release {
  if (
    contract.chainId !== "1" ||
    contract.releaseId !== "classic-v2" ||
    contract.modelId !== "classic" ||
    !exactRouteKeys(contract)
  ) {
    throw invalidInput("config", "classic-v2-reconciler-release");
  }
  if (
    deployment.chainId !== 1 ||
    deployment.status !== "deployment-and-source-verified" ||
    deployment.lifecycleEvidence.status !== "verified-current-release" ||
    deployment.lifecycleEvidence.releaseEligible !== true
  ) {
    fail("classic-v2-reconciler-manifest");
  }
  const launcher = exactAddress(
    deployment.addresses.memeLauncher,
    "classic-v2-launcher",
  );
  const hook = exactAddress(deployment.addresses.feeHook, "classic-v2-hook");
  const hookFactory = exactAddress(
    deployment.addresses.hookFactory,
    "classic-v2-hook-factory",
  );
  const positionForwarderFactory = exactAddress(
    deployment.addresses.positionForwarderFactory,
    "classic-v2-position-forwarder-factory",
  );
  const treasury = exactAddress(
    deployment.addresses.treasury,
    "classic-v2-treasury",
  );
  const poolManager = exactAddress(
    dependencies.contracts.poolManager.address,
    "classic-v2-pool-manager",
  );
  const stateView = exactAddress(
    dependencies.contracts.stateView.address,
    "classic-v2-state-view",
  );
  const startBlock = BigInt(deployment.transactions.memeLauncher.blockNumber);
  return Object.freeze({
    launcher,
    hook,
    hookFactory,
    positionForwarderFactory,
    treasury,
    poolManager,
    stateView,
    startBlock,
    runtime: Object.freeze([
      Object.freeze({
        address: hookFactory,
        expectedHash: exactBytes32(
          deployment.runtimeCodeHashes.hookFactory,
          "classic-v2-hook-factory-runtime-hash",
        ),
        label: "hook-factory",
      }),
      Object.freeze({
        address: hook,
        expectedHash: exactBytes32(
          deployment.runtimeCodeHashes.feeHook,
          "classic-v2-hook-runtime-hash",
        ),
        label: "hook",
      }),
      Object.freeze({
        address: launcher,
        expectedHash: exactBytes32(
          deployment.runtimeCodeHashes.memeLauncher,
          "classic-v2-launcher-runtime-hash",
        ),
        label: "launcher",
      }),
      Object.freeze({
        address: positionForwarderFactory,
        expectedHash: exactBytes32(
          deployment.runtimeCodeHashes.positionForwarderFactory,
          "classic-v2-position-forwarder-factory-runtime-hash",
        ),
        label: "position-forwarder-factory",
      }),
      Object.freeze({
        address: poolManager,
        expectedHash: exactBytes32(
          dependencies.contracts.poolManager.runtimeCodeHash,
          "classic-v2-pool-manager-runtime-hash",
        ),
        label: "pool-manager",
      }),
      Object.freeze({
        address: stateView,
        expectedHash: exactBytes32(
          dependencies.contracts.stateView.runtimeCodeHash,
          "classic-v2-state-view-runtime-hash",
        ),
        label: "state-view",
      }),
    ]),
  });
}

async function assertRuntime(
  rpc: ExactBlockRpcClient,
  release: Release,
  blockHash: HexBytes32,
  signal: AbortSignal,
) {
  for (const runtime of release.runtime) {
    const codeHash = await rpc.getCodeHash({
      address: runtime.address,
      blockHash,
      signal,
    });
    if (codeHash !== runtime.expectedHash) {
      fail(`classic-v2-runtime-${runtime.label}`);
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
  release: Release,
): readonly LaunchRecord[] {
  const launched = logs.filter((value) =>
    value.eventName === "MemeTokenLaunched"
  );
  assertClassicV2ReconcilerLaunchCount(launched.length);
  const tokens = new Set<string>();
  const pools = new Set<string>();
  const output = launched.map(({ args, log }) => {
    const token = exactAddress(args.token, "classic-v2-launch-token");
    const poolId = exactBytes32(args.poolId, "classic-v2-launch-pool");
    const totalSwapFeeBps = safeInteger(
      args.totalSwapFeeBps,
      100,
      1_000,
      "classic-v2-launch-fee",
    );
    if (
      tokens.has(lowerAddress(token)) ||
      pools.has(poolId) ||
      totalSwapFeeBps % 100 !== 0 ||
      !sameHex(
        exactAddress(args.feeHook, "classic-v2-launch-hook"),
        release.hook,
      )
    ) {
      fail("classic-v2-launch-identity");
    }
    tokens.add(lowerAddress(token));
    pools.add(poolId);
    return Object.freeze({
      creator: exactAddress(args.creator, "classic-v2-launch-creator"),
      token,
      poolId,
      hook: release.hook,
      positionRecipient: exactAddress(
        args.positionRecipient,
        "classic-v2-position-recipient",
      ),
      positionTokenId: nonnegative(
        args.positionTokenId,
        "classic-v2-position-token-id",
      ),
      totalSwapFeeBps,
      launchHash: exactBytes32(args.launchHash, "classic-v2-launch-hash"),
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

function sameTransaction(event: DecodedLog, launch: LaunchRecord): boolean {
  return event.log.blockNumber === launch.blockNumber &&
    sameHex(event.log.blockHash, launch.blockHash) &&
    sameHex(event.log.transactionHash, launch.transactionHash) &&
    event.log.transactionIndex === launch.transactionIndex;
}

function validatedCompanions(input: {
  launches: readonly LaunchRecord[];
  launcherLogs: readonly DecodedLog[];
  hookLogs: readonly DecodedLog[];
  release: Release;
}): ReadonlyMap<string, LaunchCompanionEvidence> {
  const liquidity = oneByKey(
    input.launcherLogs.filter((value) =>
      value.eventName === "MemeLiquidityConfigured"
    ),
    (value) => lowerAddress(exactAddress(
      value.args.token,
      "classic-v2-liquidity-token",
    )),
    "classic-v2-liquidity-cardinality",
  );
  const initialBuy = oneByKey(
    input.launcherLogs.filter((value) =>
      value.eventName === "MemeCreatorInitialBuy"
    ),
    (value) => lowerAddress(exactAddress(
      value.args.token,
      "classic-v2-initial-buy-token",
    )),
    "classic-v2-initial-buy-cardinality",
  );
  const registered = oneByKey(
    input.hookLogs.filter((value) => value.eventName === "PoolRegistered"),
    (value) => exactBytes32(
      value.args.poolId,
      "classic-v2-registration-pool",
    ),
    "classic-v2-registration-cardinality",
  );
  const disclosure = oneByKey(
    input.hookLogs.filter((value) =>
      value.eventName === "PoolFeeDisclosure"
    ),
    (value) => exactBytes32(
      value.args.poolId,
      "classic-v2-disclosure-pool",
    ),
    "classic-v2-disclosure-cardinality",
  );
  const companions = new Map<string, LaunchCompanionEvidence>();
  for (const launch of input.launches) {
    const tokenKey = lowerAddress(launch.token);
    const liquidityLog = liquidity.get(tokenKey);
    const initialBuyLog = initialBuy.get(tokenKey);
    const registrationLog = registered.get(launch.poolId);
    const disclosureLog = disclosure.get(launch.poolId);
    if (
      !liquidityLog ||
      !initialBuyLog ||
      !registrationLog ||
      !disclosureLog ||
      !sameTransaction(liquidityLog, launch) ||
      !sameTransaction(initialBuyLog, launch) ||
      !sameTransaction(registrationLog, launch) ||
      !sameTransaction(disclosureLog, launch)
    ) {
      fail("classic-v2-launch-companion-provenance");
    }
    if (
      !sameHex(
        exactBytes32(
          liquidityLog.args.launchHash,
          "classic-v2-liquidity-launch-hash",
        ),
        launch.launchHash,
      ) ||
      !sameHex(
        exactBytes32(
          initialBuyLog.args.launchHash,
          "classic-v2-initial-buy-launch-hash",
        ),
        launch.launchHash,
      ) ||
      !sameHex(
        exactAddress(initialBuyLog.args.creator, "classic-v2-initial-creator"),
        launch.creator,
      ) ||
      !sameHex(
        exactBytes32(initialBuyLog.args.poolId, "classic-v2-initial-pool"),
        launch.poolId,
      ) ||
      !sameHex(
        exactAddress(registrationLog.args.token, "classic-v2-registered-token"),
        launch.token,
      ) ||
      !sameHex(
        exactAddress(
          registrationLog.args.creator,
          "classic-v2-registered-creator",
        ),
        launch.creator,
      ) ||
      !sameHex(
        exactAddress(
          registrationLog.args.registrar,
          "classic-v2-registered-registrar",
        ),
        input.release.launcher,
      ) ||
      safeInteger(
        registrationLog.args.totalSwapFeeBps,
        100,
        1_000,
        "classic-v2-registered-fee",
      ) !== launch.totalSwapFeeBps ||
      !sameHex(
        exactAddress(disclosureLog.args.token, "classic-v2-disclosed-token"),
        launch.token,
      ) ||
      safeInteger(
        disclosureLog.args.buySwapFeeBps,
        100,
        1_000,
        "classic-v2-disclosed-buy-fee",
      ) !== launch.totalSwapFeeBps ||
      safeInteger(
        disclosureLog.args.sellSwapFeeBps,
        100,
        1_000,
        "classic-v2-disclosed-sell-fee",
      ) !== launch.totalSwapFeeBps ||
      safeInteger(
        disclosureLog.args.launcherFeeBps,
        0,
        1_000,
        "classic-v2-disclosed-launcher-fee",
      ) !== 10 ||
      safeInteger(
        disclosureLog.args.transferTaxBps,
        0,
        10_000,
        "classic-v2-disclosed-transfer-tax",
      ) !== 0 ||
      safeInteger(
        disclosureLog.args.lpFeePips,
        0,
        1_000_000,
        "classic-v2-disclosed-lp-fee",
      ) !== 0
    ) {
      fail("classic-v2-launch-companion-mismatch");
    }
    companions.set(tokenKey, Object.freeze({
      liquidity: liquidityLog,
      initialBuy: initialBuyLog,
      registration: registrationLog,
      disclosure: disclosureLog,
    }));
  }
  return companions;
}

function receiptContains(
  receipt: ExactBlockRpcReceipt,
  expected: ExactBlockRpcLog,
): readonly { receiptLogIndex: number }[] {
  return receipt.logs.filter((log) =>
    sameHex(log.address, expected.address) &&
    log.logIndex === expected.logIndex &&
    sameHex(log.transactionHash, expected.transactionHash) &&
    sameHex(log.data, expected.data) &&
    log.topics.length === expected.topics.length &&
    log.topics.every((topic, index) =>
      sameHex(topic, expected.topics[index]!)
    )
  );
}

function validatedLaunchTransactions(input: {
  launches: readonly LaunchRecord[];
  transactions: readonly ExactBlockRpcTransaction[];
  receipts: readonly ExactBlockRpcReceipt[];
  companions: ReadonlyMap<string, LaunchCompanionEvidence>;
  release: Release;
}): ReadonlyMap<string, LaunchTransactionEvidence> {
  if (
    input.transactions.length !== input.launches.length ||
    input.receipts.length !== input.launches.length
  ) {
    fail("classic-v2-launch-transaction-cardinality");
  }
  const output = new Map<string, LaunchTransactionEvidence>();
  for (let index = 0; index < input.launches.length; index += 1) {
    const launch = input.launches[index]!;
    const transaction = input.transactions[index]!;
    const receipt = input.receipts[index]!;
    if (
      !sameHex(transaction.transactionHash, launch.transactionHash) ||
      transaction.blockNumber !== launch.blockNumber ||
      !sameHex(transaction.blockHash, launch.blockHash) ||
      transaction.transactionIndex !== launch.transactionIndex ||
      !sameHex(transaction.from, launch.creator) ||
      !sameHex(transaction.to, input.release.launcher) ||
      !sameHex(receipt.transactionHash, launch.transactionHash) ||
      receipt.blockNumber !== launch.blockNumber ||
      !sameHex(receipt.blockHash, launch.blockHash) ||
      receipt.transactionIndex !== launch.transactionIndex
    ) {
      fail("classic-v2-launch-transaction-binding");
    }
    const launchReceiptLogs = receiptContains(receipt, launch.log);
    const companion = input.companions.get(lowerAddress(launch.token));
    if (!companion || launchReceiptLogs.length !== 1) {
      fail("classic-v2-launch-receipt-log");
    }
    for (const expected of [
      companion.liquidity,
      companion.initialBuy,
      companion.registration,
      companion.disclosure,
    ]) {
      if (receiptContains(receipt, expected.log).length !== 1) {
        fail("classic-v2-launch-receipt-companion");
      }
    }
    let decoded: ReturnType<typeof decodeFunctionData>;
    try {
      decoded = decodeFunctionData({
        abi: launcherAbi,
        data: transaction.input,
      });
    } catch {
      return fail("classic-v2-launch-calldata-decode");
    }
    if (decoded.functionName !== "launch" || decoded.args.length !== 1) {
      fail("classic-v2-launch-calldata-selector");
    }
    const parameters = record(decoded.args[0], "classic-v2-launch-parameters");
    const metadata = record(
      parameters.metadata,
      "classic-v2-launch-metadata",
    );
    const totalSwapFeeBps = safeInteger(
      parameters.totalSwapFeeBps,
      100,
      1_000,
      "classic-v2-launch-calldata-fee",
    );
    if (
      totalSwapFeeBps !== launch.totalSwapFeeBps ||
      totalSwapFeeBps % 100 !== 0 ||
      transaction.value <= 0n ||
      transaction.value !== nonnegative(
        companion.initialBuy.args.nativeAmount,
        "classic-v2-initial-buy-native",
      )
    ) {
      fail("classic-v2-launch-calldata-economics");
    }
    output.set(lowerAddress(launch.token), Object.freeze({
      receiptLogIndex: launchReceiptLogs[0]!.receiptLogIndex,
      value: transaction.value,
      name: exactText(parameters.name, "classic-v2-launch-name"),
      symbol: exactText(parameters.symbol, "classic-v2-launch-symbol"),
      totalSwapFeeBps,
      creatorSalt: exactBytes32(
        parameters.creatorSalt,
        "classic-v2-creator-salt",
      ),
      description: exactText(
        metadata.description,
        "classic-v2-launch-description",
      ),
      website: exactText(metadata.website, "classic-v2-launch-website"),
      image: exactText(metadata.image, "classic-v2-launch-image"),
      extraData: exactData(metadata.extraData, "classic-v2-launch-extra-data"),
    }));
  }
  return output;
}

async function readCalls(
  rpc: ExactBlockRpcClient,
  specs: readonly CallSpec[],
  blockHash: HexBytes32,
  signal: AbortSignal,
): Promise<readonly unknown[]> {
  const results = await rpc.callMany({
    calls: specs.map(({ to, data }) => Object.freeze({ to, data })),
    blockHash,
    signal,
  });
  if (results.length !== specs.length) fail("classic-v2-call-cardinality");
  return Object.freeze(results.map((result, index) =>
    specs[index]!.decode(result)
  ));
}

function feeTotals(
  feeLogs: readonly DecodedLog[],
  swapLogs: readonly DecodedLog[],
  poolId: HexBytes32,
  totalSwapFeeBps: number,
) {
  const fees = feeLogs.filter((event) =>
    event.eventName === "NativeSwapFeesAccrued" &&
    sameHex(
      exactBytes32(event.args.poolId, "classic-v2-accrual-pool"),
      poolId,
    )
  );
  const swaps = swapLogs.filter((event) =>
    event.eventName === "Swap" &&
    sameHex(exactBytes32(event.args.id, "classic-v2-swap-pool"), poolId)
  );
  if (swaps.length < 1 || fees.length > swaps.length) {
    fail("classic-v2-swap-fee-event-coverage");
  }
  let gross = 0n;
  let creator = 0n;
  let launcher = 0n;
  const feeAmounts = fees.map((fee) => {
    const grossAmount = nonnegative(
      fee.args.grossNativeAmount,
      "classic-v2-gross-fee",
    );
    const creatorAmount = nonnegative(
      fee.args.creatorFee,
      "classic-v2-creator-fee",
    );
    const launcherAmount = nonnegative(
      fee.args.launcherFee,
      "classic-v2-launcher-fee",
    );
    const actualTotalFee = creatorAmount + launcherAmount;
    const floorTotalFee = grossAmount * BigInt(totalSwapFeeBps) / 10_000n;
    const ceilingTotalFee =
      (grossAmount * BigInt(totalSwapFeeBps) + 9_999n) / 10_000n;
    const expectedLauncherFee = grossAmount * 10n / 10_000n;
    if (
      actualTotalFee === 0n ||
      (actualTotalFee !== floorTotalFee &&
        actualTotalFee !== ceilingTotalFee) ||
      launcherAmount !== (
        expectedLauncherFee > actualTotalFee
          ? actualTotalFee
          : expectedLauncherFee
      ) ||
      creatorAmount !== actualTotalFee - launcherAmount
    ) {
      fail("classic-v2-fee-conservation");
    }
    gross += grossAmount;
    creator += creatorAmount;
    launcher += launcherAmount;
    return Object.freeze({
      grossAmount,
      actualTotalFee,
      sender: exactAddress(fee.args.swapSender, "classic-v2-fee-sender"),
    });
  });

  const swapNativeAmounts = swaps.map((swap) => {
    if (
      safeInteger(swap.args.fee, 0, 1_000_000, "classic-v2-swap-lp-fee") !== 0
    ) {
      fail("classic-v2-fee-conservation");
    }
    const amount = absolute(swap.args.amount0, "classic-v2-swap-native");
    if (amount === 0n) fail("classic-v2-swap-native");
    return Object.freeze({
      amount,
      sender: exactAddress(swap.args.sender, "classic-v2-swap-sender"),
    });
  });

  const candidates = fees.map((fee, feeIndex) => {
    const related = swaps.flatMap((swap, swapIndex) => {
      if (
        fee.log.blockNumber !== swap.log.blockNumber ||
        fee.log.transactionIndex !== swap.log.transactionIndex ||
        !sameHex(fee.log.blockHash, swap.log.blockHash) ||
        !sameHex(fee.log.transactionHash, swap.log.transactionHash) ||
        !sameHex(feeAmounts[feeIndex]!.sender, swapNativeAmounts[swapIndex]!.sender)
      ) {
        return [];
      }
      return [swapIndex];
    });
    const previous = related.filter((swapIndex) =>
      swaps[swapIndex]!.log.logIndex < fee.log.logIndex
    ).at(-1);
    const next = related.find((swapIndex) =>
      swaps[swapIndex]!.log.logIndex > fee.log.logIndex
    );
    return Object.freeze([previous, next]
      .filter((swapIndex): swapIndex is number => swapIndex !== undefined)
      .filter((swapIndex, index, values) =>
        values.indexOf(swapIndex) === index &&
        (
          feeAmounts[feeIndex]!.grossAmount ===
            swapNativeAmounts[swapIndex]!.amount ||
          feeAmounts[feeIndex]!.grossAmount ===
            swapNativeAmounts[swapIndex]!.amount +
              feeAmounts[feeIndex]!.actualTotalFee
        )
      ));
  });

  let assignmentCount = 0;
  let matchedSwapIndexes: readonly number[] = Object.freeze([]);
  function assign(feeIndex: number, previousSwapIndex: number, path: number[]) {
    if (assignmentCount > 1) return;
    if (feeIndex === candidates.length) {
      assignmentCount += 1;
      matchedSwapIndexes = Object.freeze([...path]);
      return;
    }
    for (const swapIndex of candidates[feeIndex]!) {
      if (swapIndex <= previousSwapIndex) continue;
      path.push(swapIndex);
      assign(feeIndex + 1, swapIndex, path);
      path.pop();
    }
  }
  assign(0, -1, []);
  if (assignmentCount !== 1) {
    fail("classic-v2-swap-fee-provenance");
  }
  const matched = new Set(matchedSwapIndexes);
  for (let index = 0; index < swaps.length; index += 1) {
    if (
      !matched.has(index) &&
      swapNativeAmounts[index]!.amount * BigInt(totalSwapFeeBps) / 10_000n !== 0n
    ) {
      fail("classic-v2-swap-fee-event-coverage");
    }
  }
  return Object.freeze({
    gross,
    creator,
    launcher,
    lastSwap: swaps.at(-1)!,
  });
}

function creatorClaimTotal(
  hookLogs: readonly DecodedLog[],
  poolId: HexBytes32,
  creator: Address,
): bigint {
  let total = 0n;
  for (const event of hookLogs) {
    if (event.eventName !== "CreatorFeesClaimed") continue;
    if (!sameHex(
      exactBytes32(event.args.poolId, "classic-v2-claim-pool"),
      poolId,
    )) {
      continue;
    }
    const amount = nonnegative(event.args.amount, "classic-v2-claim-amount");
    const recipient = exactAddress(
      event.args.recipient,
      "classic-v2-claim-recipient",
    );
    const caller = exactAddress(event.args.caller, "classic-v2-claim-caller");
    if (
      amount === 0n ||
      !sameHex(
        exactAddress(event.args.creator, "classic-v2-claim-creator"),
        creator,
      ) ||
      sameHex(recipient, ZERO_ADDRESS) ||
      sameHex(caller, ZERO_ADDRESS) ||
      (!sameHex(recipient, creator) && !sameHex(caller, creator))
    ) {
      fail("classic-v2-claim-provenance");
    }
    total += amount;
  }
  return total;
}

function isoTimestamp(timestamp: bigint): string {
  if (timestamp < 0n || timestamp > 8_640_000_000_000n) {
    fail("classic-v2-block-timestamp");
  }
  return new Date(Number(timestamp) * 1_000).toISOString();
}

export async function buildClassicV2ExactBlockContribution(input: {
  rpc: ExactBlockRpcClient;
  contract: ReconcilerPreParityContract;
  blockNumber: bigint;
  blockHash: HexBytes32;
  signal: AbortSignal;
}): Promise<ClassicV2ReconcilerRouteContribution> {
  const release = resolvedRelease(input.contract);
  if (
    input.blockNumber < release.startBlock ||
    input.blockNumber.toString() !== input.contract.checkpointBlockNumber ||
    !sameHex(input.blockHash, input.contract.checkpointBlockHash)
  ) {
    fail("classic-v2-checkpoint-binding");
  }
  await assertRuntime(input.rpc, release, input.blockHash, input.signal);

  const infrastructureSpecs = [
    callSpec(release.launcher, launcherAbi, "poolManager"),
    callSpec(release.launcher, launcherAbi, "feeHook"),
    callSpec(release.launcher, launcherAbi, "MIN_INITIAL_BUY_WEI"),
    callSpec(release.hook, hookInfrastructureAbi, "poolManager"),
    callSpec(release.hook, hookInfrastructureAbi, "launcherFeeRecipient"),
    callSpec(release.hook, creatorFeeHookReadAbi, "LAUNCHER_FEE_BPS"),
    callSpec(release.hook, creatorFeeHookReadAbi, "LP_FEE_PIPS"),
    callSpec(release.hook, hookInfrastructureAbi, "TICK_SPACING"),
  ];
  const [infrastructure, launcherLogs, hookLogs] = await Promise.all([
    readCalls(
      input.rpc,
      infrastructureSpecs,
      input.blockHash,
      input.signal,
    ),
    readLogsInRanges({
      rpc: input.rpc,
      addresses: release.launcher,
      events: LAUNCHER_EVENTS,
      fromBlock: release.startBlock,
      toBlock: input.blockNumber,
      signal: input.signal,
    }),
    readLogsInRanges({
      rpc: input.rpc,
      addresses: release.hook,
      events: HOOK_EVENTS,
      fromBlock: release.startBlock,
      toBlock: input.blockNumber,
      signal: input.signal,
    }),
  ]);
  const minimumInitialBuy = nonnegative(
    infrastructure[2],
    "classic-v2-minimum-initial-buy",
  );
  if (
    !sameHex(
      exactAddress(infrastructure[0], "classic-v2-launcher-pool-manager"),
      release.poolManager,
    ) ||
    !sameHex(
      exactAddress(infrastructure[1], "classic-v2-launcher-hook"),
      release.hook,
    ) ||
    minimumInitialBuy < 1n ||
    !sameHex(
      exactAddress(infrastructure[3], "classic-v2-hook-pool-manager"),
      release.poolManager,
    ) ||
    !sameHex(
      exactAddress(infrastructure[4], "classic-v2-hook-treasury"),
      release.treasury,
    ) ||
    safeInteger(
      infrastructure[5],
      0,
      10_000,
      "classic-v2-launcher-fee-constant",
    ) !== 10 ||
    safeInteger(
      infrastructure[6],
      0,
      1_000_000,
      "classic-v2-lp-fee-constant",
    ) !== 0 ||
    safeInteger(
      infrastructure[7],
      -887_272,
      887_272,
      "classic-v2-tick-spacing",
    ) !== 200
  ) {
    fail("classic-v2-infrastructure-state");
  }

  const launches = launchRecords(launcherLogs, release);
  const corpusManifest = createReconcilerCorpusManifest({
    contract: input.contract,
    identities: launches.map((launch) => Object.freeze({
      tokenAddress: lowerAddress(launch.token),
      poolId: launch.poolId,
      launchTransactionHash: launch.transactionHash,
      launchBlockNumber: launch.blockNumber.toString(),
      launchTransactionIndex: launch.transactionIndex,
      launchLogIndex: launch.blockGlobalLogIndex,
    })),
  });
  const companions = validatedCompanions({
    launches,
    launcherLogs,
    hookLogs,
    release,
  });
  const launchTransactions = new Map<string, LaunchTransactionEvidence>();
  const stateValues: unknown[] = [];
  const poolSwapLogs: DecodedLog[] = [];
  const timestamps = new Map<string, bigint>();
  const timestampHashes = new Map<string, HexBytes32>();
  const completedCorpusPages: Array<(typeof corpusManifest.pages)[number]> = [];
  for (const page of corpusManifest.pages) {
    const pageRpc = input.rpc.createPartitionClient(page);
    await pageRpc.assertCheckpoint({
      blockNumber: input.blockNumber,
      blockHash: input.blockHash,
      signal: input.signal,
    });
    const pageLaunches = launches.slice(page.startIndex, page.endIndexExclusive);
    const [transactions, receipts, pagePoolSwapLogs] = await Promise.all([
      pageRpc.getTransactions({
        transactions: pageLaunches.map((launch) => Object.freeze({
          transactionHash: launch.transactionHash,
          expectedBlockNumber: launch.blockNumber,
          expectedBlockHash: launch.blockHash,
          expectedTo: release.launcher,
        })),
        signal: input.signal,
      }),
      pageRpc.getTransactionReceipts({
        receipts: pageLaunches.map((launch) => Object.freeze({
          transactionHash: launch.transactionHash,
          expectedBlockNumber: launch.blockNumber,
          expectedBlockHash: launch.blockHash,
        })),
        signal: input.signal,
      }),
      readPoolSwapBatches({
        rpc: pageRpc,
        poolManager: release.poolManager,
        poolIds: pageLaunches.map(({ poolId }) => poolId),
        fromBlock: release.startBlock,
        toBlock: input.blockNumber,
        signal: input.signal,
      }),
    ]);
    poolSwapLogs.push(...pagePoolSwapLogs);
    const pageTransactions = validatedLaunchTransactions({
      launches: pageLaunches,
      transactions,
      receipts,
      companions,
      release,
    });
    for (const [key, transaction] of pageTransactions) {
      if (launchTransactions.has(key)) fail("classic-v2-launch-transaction-duplicate");
      launchTransactions.set(key, transaction);
    }
    const stateSpecs = pageLaunches.flatMap((launch) => {
      const transaction = pageTransactions.get(lowerAddress(launch.token));
      if (!transaction) fail("classic-v2-launch-transaction-missing");
      return [
        callSpec(launch.token, uerc20ReadAbi, "name"),
        callSpec(launch.token, uerc20ReadAbi, "symbol"),
        callSpec(launch.token, uerc20ReadAbi, "decimals"),
        callSpec(launch.token, uerc20ReadAbi, "totalSupply"),
        callSpec(launch.token, uerc20ReadAbi, "creator"),
        callSpec(launch.token, uerc20ReadAbi, "metadata"),
        callSpec(release.stateView, stateViewReadAbi, "getSlot0", [launch.poolId]),
        callSpec(release.stateView, stateViewReadAbi, "getLiquidity", [launch.poolId]),
        callSpec(release.hook, creatorFeeHookReadAbi, "feeDisclosure", [launch.poolId]),
        callSpec(release.hook, creatorFeeHookReadAbi, "poolFeeConfig", [launch.poolId]),
        callSpec(release.launcher, launcherAbi, "launchHashOf", [launch.token]),
        callSpec(release.launcher, launcherAbi, "predictTokenAddress", [
          transaction.name,
          transaction.symbol,
          launch.creator,
          transaction.creatorSalt,
        ]),
        callSpec(release.launcher, launcherAbi, "predictPositionRecipient", [
          launch.token,
          launch.creator,
        ]),
        callSpec(release.launcher, launcherAbi, "poolKey", [launch.token]),
      ];
    });
    stateValues.push(...await readCalls(
      pageRpc,
      stateSpecs,
      input.blockHash,
      input.signal,
    ));
    const timestampBindings = [];
    for (const launch of pageLaunches) {
      const key = launch.blockNumber.toString();
      const knownHash = timestampHashes.get(key);
      if (knownHash !== undefined && !sameHex(knownHash, launch.blockHash)) {
        fail("classic-v2-launch-block-hash-conflict");
      }
      if (!timestamps.has(key) && knownHash === undefined) {
        timestampHashes.set(key, launch.blockHash);
        timestampBindings.push({
          blockNumber: launch.blockNumber,
          expectedHash: launch.blockHash,
        });
      }
    }
    const pageTimestamps = await pageRpc.getBlockTimestamps({
      blocks: timestampBindings,
      signal: input.signal,
    });
    if (pageTimestamps.length !== timestampBindings.length) {
      fail("classic-v2-launch-timestamp-cardinality");
    }
    timestampBindings.forEach((binding, index) => {
      timestamps.set(binding.blockNumber.toString(), pageTimestamps[index]!);
    });
    await pageRpc.assertCheckpoint({
      blockNumber: input.blockNumber,
      blockHash: input.blockHash,
      signal: input.signal,
    });
    completedCorpusPages.push(page);
  }
  assembleReconcilerCorpusPages(corpusManifest, completedCorpusPages);
  poolSwapLogs.sort((left, right) =>
    left.log.blockNumber === right.log.blockNumber
      ? left.log.transactionIndex === right.log.transactionIndex
        ? left.log.logIndex - right.log.logIndex
        : left.log.transactionIndex - right.log.transactionIndex
      : left.log.blockNumber < right.log.blockNumber ? -1 : 1
  );

  const tokens: Json[] = [];
  const charts: Json[] = [];
  for (let index = 0; index < launches.length; index += 1) {
    const launch = launches[index]!;
    const companion = companions.get(lowerAddress(launch.token));
    const transaction = launchTransactions.get(lowerAddress(launch.token));
    if (!companion || !transaction) fail("classic-v2-launch-evidence-missing");
    if (transaction.value < minimumInitialBuy) {
      fail("classic-v2-initial-buy-below-current-minimum");
    }
    const offset = index * CALLS_PER_LAUNCH;
    const name = exactText(stateValues[offset], "classic-v2-token-name");
    const symbol = exactText(stateValues[offset + 1], "classic-v2-token-symbol");
    const decimals = safeInteger(
      stateValues[offset + 2],
      0,
      255,
      "classic-v2-token-decimals",
    );
    const totalSupply = nonnegative(
      stateValues[offset + 3],
      "classic-v2-total-supply",
    );
    const recordedCreator = exactAddress(
      stateValues[offset + 4],
      "classic-v2-token-creator",
    );
    const metadata = tuple(
      stateValues[offset + 5],
      4,
      "classic-v2-token-metadata",
    );
    const slot0 = tuple(stateValues[offset + 6], 4, "classic-v2-slot0");
    nonnegative(stateValues[offset + 7], "classic-v2-active-liquidity");
    const disclosure = tuple(
      stateValues[offset + 8],
      6,
      "classic-v2-fee-disclosure",
    );
    const poolConfig = tuple(
      stateValues[offset + 9],
      5,
      "classic-v2-pool-config",
    );
    const currentLaunchHash = exactBytes32(
      stateValues[offset + 10],
      "classic-v2-current-launch-hash",
    );
    const predictedToken = tuple(
      stateValues[offset + 11],
      2,
      "classic-v2-predicted-token",
    );
    const predictedPositionRecipient = exactAddress(
      stateValues[offset + 12],
      "classic-v2-predicted-position-recipient",
    );
    const poolKey = tuple(
      stateValues[offset + 13],
      5,
      "classic-v2-pool-key",
    );
    const [descriptionValue, websiteValue, imageValue, extraDataValue] = metadata;
    const description = exactText(descriptionValue, "classic-v2-description");
    const website = exactText(websiteValue, "classic-v2-website");
    const image = exactText(imageValue, "classic-v2-image");
    const extraData = exactData(extraDataValue, "classic-v2-extra-data");
    const [sqrtPriceValue, tickValue, protocolFeeValue, currentLpFeeValue] = slot0;
    nonnegative(sqrtPriceValue, "classic-v2-current-price");
    safeInteger(tickValue, -887_272, 887_272, "classic-v2-current-tick");
    safeInteger(protocolFeeValue, 0, 1_000_000, "classic-v2-protocol-fee");
    const currentLpFeePips = safeInteger(
      currentLpFeeValue,
      0,
      1_000_000,
      "classic-v2-current-lp-fee",
    );
    const [
      buySwapFeeValue,
      sellSwapFeeValue,
      creatorFeeValue,
      launcherFeeValue,
      transferTaxValue,
      disclosedLpFeeValue,
    ] = disclosure;
    const buySwapFeeBps = safeInteger(
      buySwapFeeValue,
      100,
      1_000,
      "classic-v2-buy-fee",
    );
    const sellSwapFeeBps = safeInteger(
      sellSwapFeeValue,
      100,
      1_000,
      "classic-v2-sell-fee",
    );
    const creatorFeeBps = safeInteger(
      creatorFeeValue,
      0,
      1_000,
      "classic-v2-creator-fee-bps",
    );
    const launcherFeeBps = safeInteger(
      launcherFeeValue,
      0,
      1_000,
      "classic-v2-launcher-fee-bps",
    );
    const transferTaxBps = safeInteger(
      transferTaxValue,
      0,
      10_000,
      "classic-v2-transfer-tax",
    );
    const lpFeePips = safeInteger(
      disclosedLpFeeValue,
      0,
      1_000_000,
      "classic-v2-disclosed-lp-fee",
    );
    const [
      configuredCreatorValue,
      registrarValue,
      configuredTotalFeeValue,
      registeredValue,
      pendingCreatorFeesValue,
    ] = poolConfig;
    if (
      !sameHex(recordedCreator, release.launcher) ||
      !sameHex(currentLaunchHash, launch.launchHash) ||
      !sameHex(
        exactAddress(predictedToken[0], "classic-v2-predicted-token-address"),
        launch.token,
      ) ||
      !sameHex(predictedPositionRecipient, launch.positionRecipient) ||
      !sameHex(
        exactAddress(poolKey[0], "classic-v2-pool-currency-zero"),
        ZERO_ADDRESS,
      ) ||
      !sameHex(
        exactAddress(poolKey[1], "classic-v2-pool-currency-one"),
        launch.token,
      ) ||
      safeInteger(poolKey[2], 0, 1_000_000, "classic-v2-pool-fee") !== 0 ||
      safeInteger(
        poolKey[3],
        -887_272,
        887_272,
        "classic-v2-pool-tick-spacing",
      ) !== 200 ||
      !sameHex(
        exactAddress(poolKey[4], "classic-v2-pool-hook"),
        release.hook,
      ) ||
      !sameHex(
        exactAddress(
          configuredCreatorValue,
          "classic-v2-configured-creator",
        ),
        launch.creator,
      ) ||
      !sameHex(
        exactAddress(registrarValue, "classic-v2-configured-registrar"),
        release.launcher,
      ) ||
      safeInteger(
        configuredTotalFeeValue,
        100,
        1_000,
        "classic-v2-configured-total-fee",
      ) !== launch.totalSwapFeeBps ||
      registeredValue !== true ||
      buySwapFeeBps !== launch.totalSwapFeeBps ||
      sellSwapFeeBps !== launch.totalSwapFeeBps ||
      creatorFeeBps + launcherFeeBps !== launch.totalSwapFeeBps ||
      launcherFeeBps !== 10 ||
      transferTaxBps !== 0 ||
      lpFeePips !== 0 ||
      currentLpFeePips !== 0 ||
      name !== transaction.name ||
      symbol !== transaction.symbol ||
      description !== transaction.description ||
      website !== transaction.website ||
      image !== transaction.image ||
      !sameHex(extraData, transaction.extraData)
    ) {
      fail("classic-v2-current-state-mismatch");
    }
    exactBytes32(predictedToken[1], "classic-v2-effective-graffiti");
    const pendingCreatorFees = nonnegative(
      pendingCreatorFeesValue,
      "classic-v2-pending-creator-fees",
    );

    const liquidityArgs = companion.liquidity.args;
    const liquiditySupply = nonnegative(
      liquidityArgs.totalSupply,
      "classic-v2-liquidity-supply",
    );
    const tokenLiquidity = nonnegative(
      liquidityArgs.tokenLiquidityAmount,
      "classic-v2-token-liquidity",
    );
    const lockedDust = nonnegative(
      liquidityArgs.lockedTokenDust,
      "classic-v2-locked-dust",
    );
    const initialTick = safeInteger(
      liquidityArgs.initialTick,
      -887_272,
      887_272,
      "classic-v2-initial-tick",
    );
    const tickLower = safeInteger(
      liquidityArgs.tickLower,
      -887_272,
      887_272,
      "classic-v2-tick-lower",
    );
    const tickUpper = safeInteger(
      liquidityArgs.tickUpper,
      -887_272,
      887_272,
      "classic-v2-tick-upper",
    );
    const eventLpFeePips = safeInteger(
      liquidityArgs.lpFeePips,
      0,
      1_000_000,
      "classic-v2-event-lp-fee",
    );
    if (
      liquiditySupply !== totalSupply ||
      tokenLiquidity + lockedDust !== totalSupply ||
      initialTick !== EXPECTED_INITIAL_TICK ||
      tickLower !== EXPECTED_TICK_LOWER ||
      tickUpper !== initialTick ||
      eventLpFeePips !== lpFeePips ||
      nonnegative(
        companion.initialBuy.args.tokenAmount,
        "classic-v2-initial-buy-token",
      ) < 1n
    ) {
      fail("classic-v2-liquidity-conservation");
    }
    const totals = feeTotals(
      hookLogs,
      poolSwapLogs,
      launch.poolId,
      launch.totalSwapFeeBps,
    );
    const claimedCreatorFees = creatorClaimTotal(
      hookLogs,
      launch.poolId,
      launch.creator,
    );
    if (totals.creator !== pendingCreatorFees + claimedCreatorFees) {
      fail("classic-v2-creator-fee-accounting");
    }
    const lastSwap = totals.lastSwap;
    const timestamp = timestamps.get(launch.blockNumber.toString());
    if (timestamp === undefined) fail("classic-v2-launch-timestamp-missing");

    tokens.push({
      releaseVersion: "classic-v2",
      modelId: "classic",
      tokenAddress: lowerAddress(launch.token),
      creatorAddress: lowerAddress(launch.creator),
      launchTransactionHash: launch.transactionHash,
      launchBlockNumber: launch.blockNumber.toString(),
      launchTransactionIndex: launch.transactionIndex,
      launchLogIndex: transaction.receiptLogIndex,
      launchedAt: isoTimestamp(timestamp),
      poolId: launch.poolId,
      hookAddress: lowerAddress(launch.hook),
      rewardVaultAddress: null,
      positionRecipient: lowerAddress(launch.positionRecipient),
      positionTokenId: launch.positionTokenId.toString(),
      launchHash: launch.launchHash,
      name,
      symbol,
      decimals,
      totalSupplyRaw: totalSupply.toString(),
      quoteAssetAddress: lowerAddress(ZERO_ADDRESS),
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
    });
    charts.push({
      releaseVersion: "classic-v2",
      modelId: "classic",
      tokenAddress: lowerAddress(launch.token),
      poolId: launch.poolId,
      quoteAssetAddress: lowerAddress(ZERO_ADDRESS),
      state: {
        blockNumber: lastSwap.log.blockNumber.toString(),
        blockHash: lastSwap.log.blockHash,
        transactionHash: lastSwap.log.transactionHash,
        transactionIndex: lastSwap.log.transactionIndex,
        logIndex: lastSwap.log.logIndex,
        sqrtPriceX96: nonnegative(
          lastSwap.args.sqrtPriceX96,
          "classic-v2-latest-swap-price",
        ).toString(),
        liquidity: nonnegative(
          lastSwap.args.liquidity,
          "classic-v2-latest-swap-liquidity",
        ).toString(),
        tick: safeInteger(
          lastSwap.args.tick,
          -887_272,
          887_272,
          "classic-v2-latest-swap-tick",
        ),
        lpFeePips,
      },
      volume: {
        quoteAssetAddress: lowerAddress(ZERO_ADDRESS),
        grossQuoteRaw: totals.gross.toString(),
        creatorFeeQuoteRaw: totals.creator.toString(),
        launcherFeeQuoteRaw: totals.launcher.toString(),
      },
    });
  }

  return Object.freeze({
    tokens: Object.freeze(tokens),
    charts: Object.freeze(charts),
  });
}
