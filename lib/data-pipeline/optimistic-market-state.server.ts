import "server-only";

import {
  decodeEventLog,
  decodeFunctionResult,
  formatUnits,
  keccak256,
  parseAbiItem,
  toBytes,
  toEventSelector,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";

import { stateViewReadAbi } from "../onchain/abis";
import {
  marketCapNativeWadFromSqrtPriceX96,
  nativePriceWadFromSqrtPriceX96,
} from "../onchain/math";
import type { LauncherToken } from "../tokens";
import {
  computeOfficialV4PoolId,
  type OfficialV4PoolKey,
} from "../uniswap/liquidity-launcher-sdk";
import {
  canonicalAddress,
  canonicalBytes32,
  canonicalRawData,
  parseNonnegativeIntegerText,
  type HexAddress,
  type HexBytes32,
  type HexData,
} from "./codecs";
import type {
  CandidateRpcBlock,
  CandidateRpcOptimisticPoolState,
  CandidateRpcProvider,
} from "./dual-rpc";
import {
  DataPipelineError,
  dataPipelineError,
  invalidInput,
  validationError,
} from "./errors";
import {
  isVerifiedDualRpcOptimisticBlock,
  type DualRpcOptimisticBlock,
  type OptimisticManifestLog,
  type OptimisticProviderHeadObservation,
} from "./optimistic-block-reader.server";
import type { OptimisticMarketFields } from "./optimistic-read-overlay.server";
import { getDataPipelineReleaseBinding } from "./release-binding.server";
import { assertProductionDualRpcProviders } from "./rpc-providers.server";

const ZERO_ADDRESS = `0x${"00".repeat(20)}` as HexAddress;
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as HexBytes32;
export const OPTIMISTIC_MARKET_STATE_VERSION =
  "optimistic-market-state-v1" as const;
export const OPTIMISTIC_MAINNET_STATE_VIEW =
  "0x7ffe42c4a5deea5b0fec41c94c136cf115597227" as const;
export const OPTIMISTIC_MAINNET_STATE_VIEW_RUNTIME_CODE_HASH =
  "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878" as const;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT160_MAX = (1n << 160n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const MINIMUM_TICK = -887_272;
const MAXIMUM_TICK = 887_272;
const MAXIMUM_LP_FEE_PIPS = 1_000_000;
const MAXIMUM_PROTOCOL_FEE_PIPS = 1_000;
const PROTOCOL_FEE_DIRECTION_MASK = 0x0fff;
const DEFAULT_HARD_DEADLINE_MS = 8_000;
const MAXIMUM_HARD_DEADLINE_MS = 8_000;
const OPTIMISTIC_CONFIRMATION_LIMIT = 12;
const EXPECTED_POOL_FEE = 0;
const EXPECTED_TICK_SPACING = 200;
const EXPECTED_LAUNCH_TOKEN_DECIMALS = 18;
const RELEASE_BINDING = getDataPipelineReleaseBinding();

const CLASSIC_V2_LAUNCH_EVENT = parseAbiItem(
  "event MemeTokenLaunched(address indexed creator,address indexed token,bytes32 indexed poolId,address feeHook,address positionRecipient,uint256 positionTokenId,uint16 totalSwapFeeBps,bytes32 launchHash)",
);
const CLASSIC_V2_LIQUIDITY_EVENT = parseAbiItem(
  "event MemeLiquidityConfigured(address indexed token,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
);
const CLASSIC_V3_LAUNCH_EVENT = parseAbiItem(
  "event MemeTokenLaunchedV2(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address rewardVault,address positionRecipient,uint256 positionTokenId,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 rewardConfigurationHash,bytes32 launchHash)",
);
const CLASSIC_V3_LIQUIDITY_EVENT = parseAbiItem(
  "event MemeLiquidityConfiguredV2(address indexed token,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
);
const STOCK_LAUNCH_EVENT = parseAbiItem(
  "event StockPairedTokenLaunched(address indexed deployer,address indexed token,address indexed quoteAsset,bytes32 poolId,address rewardVault,address positionRecipient,uint256 positionTokenId,bytes32 launchHash)",
);
const STOCK_LIQUIDITY_EVENT = parseAbiItem(
  "event StockPairedLiquidityConfigured(address indexed token,address indexed quoteAsset,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
);

const NEW_LAUNCH_EVENT_PAIRS = Object.freeze([
  Object.freeze({
    sourceContractName: "ClassicV2Launcher",
    launchModel: "classic" as const,
    launchEvent: CLASSIC_V2_LAUNCH_EVENT,
    liquidityEvent: CLASSIC_V2_LIQUIDITY_EVENT,
  }),
  Object.freeze({
    sourceContractName: "ClassicV3Launcher",
    launchModel: "classic" as const,
    launchEvent: CLASSIC_V3_LAUNCH_EVENT,
    liquidityEvent: CLASSIC_V3_LIQUIDITY_EVENT,
  }),
  ...["StockV1Launcher", "StockV2Launcher", "StockV3Launcher"].map(
    (sourceContractName) => Object.freeze({
      sourceContractName,
      launchModel: "stock-paired" as const,
      launchEvent: STOCK_LAUNCH_EVENT,
      liquidityEvent: STOCK_LIQUIDITY_EVENT,
    }),
  ),
]);

/**
 * Ephemeral launch facts for a token absent from the canonical token map.
 * Runtime callers must build this only after folding one complete,
 * unambiguous same-transaction Launcher + Liquidity event pair from the
 * branded `DualRpcOptimisticBlock`; never from request or database fields.
 * `readOptimisticMarketState` independently repeats that binding as its last
 * trust-boundary check.
 */
export type OptimisticNewLaunchMarketInput = Readonly<{
  tokenAddress: HexAddress;
  poolId: HexBytes32;
  totalSupplyRaw: string;
  tokenDecimals: number;
  launchModel: "classic" | "stock-paired";
  poolKey: OfficialV4PoolKey;
  quoteAssetAddress?: HexAddress;
  quoteAssetDecimals?: number;
  quoteIsCurrency0?: boolean;
}>;

export type OptimisticPoolState = Readonly<{
  sqrtPriceX96: string;
  currentTick: number;
  activeLiquidity: string;
  protocolFeePips: number;
  lpFeePips: number;
  slot0Result: HexData;
  liquidityResult: HexData;
}>;

export type OptimisticMarketStateResult = Readonly<{
  version: typeof OPTIMISTIC_MARKET_STATE_VERSION;
  finality: "optimistic";
  chainId: 1;
  blockNumber: string;
  blockHash: HexBytes32;
  confirmations: number;
  poolId: HexBytes32;
  tokenAddress: HexAddress;
  stateView: HexAddress;
  stateViewRuntimeCodeHash: HexBytes32;
  market: OptimisticMarketFields;
  marketCommitment: HexBytes32;
  evidenceCommitment: HexBytes32;
  pool: OptimisticPoolState;
  providerIdentities: readonly [string, string];
  providerVendorGroups: readonly [string, string];
  providerEndpointCommitments: readonly [HexBytes32, HexBytes32];
  providerOriginCommitments: readonly [HexBytes32, HexBytes32];
  providerHeads: readonly [string, string];
  providerHeadObservations?: readonly [
    OptimisticProviderHeadObservation,
    OptimisticProviderHeadObservation,
  ];
  blockProviderCallCounts: readonly [number, number];
  marketProviderCallCounts: readonly [number, number];
  totalProviderCallCounts: readonly [number, number];
}>;

type NormalizedValuation = Readonly<{
  tokenAddress: HexAddress;
  poolId: HexBytes32;
  totalSupplyRaw: bigint | null;
  tokenDecimals: number | null;
  launchModel: "classic" | "stock-paired";
  quoteAssetAddress: HexAddress | null;
  quoteAssetDecimals: number | null;
  quoteIsCurrency0: boolean | null;
}>;

type CanonicalEvidence = Readonly<{
  blockNumber: bigint;
  blockNumberText: string;
  blockHash: HexBytes32;
  parentHash: HexBytes32;
  timestamp: bigint;
  providerHeads: readonly [bigint, bigint];
  providerHeadObservations: readonly [
    OptimisticProviderHeadObservation,
    OptimisticProviderHeadObservation,
  ];
  blockProviderCallCounts: readonly [number, number];
}>;

type ProviderRead = Readonly<{
  head: bigint;
  headObservation: OptimisticProviderHeadObservation;
  rpcCallCount: number;
  runtimeBytecode: HexData;
  slot0Result: HexData;
  liquidityResult: HexData;
}>;

type DeadlineContext = { deadlineAt: number; expired: boolean };
type RpcCallCounter = { value: number };

function recordRpcCalls(counter: RpcCallCounter, count: unknown): void {
  if (
    typeof count !== "number" ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isSafeInteger(counter.value + count)
  ) {
    throw validationError("rpc", "optimistic-market-call-counts");
  }
  counter.value += count;
}

function validDecimals(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 255
  );
}

function uint256(value: bigint, operation: string): bigint {
  if (value < 0n || value > UINT256_MAX) {
    throw validationError("uniswap", operation);
  }
  return value;
}

function decimalBigInt(
  value: unknown,
  operation: string,
  maximumDigits = 78,
): bigint {
  try {
    return BigInt(parseNonnegativeIntegerText(value, maximumDigits));
  } catch {
    throw invalidInput("uniswap", operation);
  }
}

function exactPair<T>(
  actual: readonly [T, T],
  expected: readonly [T, T],
): boolean {
  return actual[0] === expected[0] && actual[1] === expected[1];
}

function canonicalHeadObservation(
  value: unknown,
  expectedHead: bigint,
): OptimisticProviderHeadObservation {
  if (typeof value !== "object" || value === null) {
    throw validationError("rpc", "optimistic-market-head-observation");
  }
  const candidate = value as Record<string, unknown>;
  let blockNumber: string;
  let blockHash: HexBytes32;
  try {
    blockNumber = parseNonnegativeIntegerText(candidate.blockNumber, 20);
    blockHash = canonicalBytes32(candidate.blockHash);
  } catch {
    throw validationError("rpc", "optimistic-market-head-observation");
  }
  if (
    BigInt(blockNumber) !== expectedHead ||
    blockHash === ZERO_BYTES32 ||
    typeof candidate.observedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.observedAt)) ||
    new Date(candidate.observedAt).toISOString() !== candidate.observedAt
  ) {
    throw validationError("rpc", "optimistic-market-head-observation");
  }
  return Object.freeze({
    blockNumber,
    blockHash,
    observedAt: candidate.observedAt,
  });
}

function sameHeightHasSameHash(
  first: OptimisticProviderHeadObservation,
  second: OptimisticProviderHeadObservation,
): boolean {
  return first.blockNumber !== second.blockNumber ||
    first.blockHash === second.blockHash;
}

function normalizedPoolKey(value: OfficialV4PoolKey): OfficialV4PoolKey {
  try {
    return Object.freeze({
      currency0: canonicalAddress(value.currency0) as Address,
      currency1: canonicalAddress(value.currency1) as Address,
      fee: value.fee,
      tickSpacing: value.tickSpacing,
      hooks: canonicalAddress(value.hooks) as Address,
    });
  } catch {
    throw invalidInput("uniswap", "optimistic-pool-key");
  }
}

function normalizeKnownToken(
  token: LauncherToken,
  inputPoolId: HexBytes32,
  inputTokenAddress: HexAddress,
): NormalizedValuation {
  let poolId: HexBytes32;
  let tokenAddress: HexAddress;
  try {
    poolId = canonicalBytes32(token.poolId);
    tokenAddress = canonicalAddress(token.tokenAddress);
  } catch {
    throw invalidInput("uniswap", "optimistic-token-identity");
  }
  if (poolId !== inputPoolId || tokenAddress !== inputTokenAddress) {
    throw invalidInput("uniswap", "optimistic-token-identity");
  }

  const stock = token.launchModel === "stock-paired";
  if (!stock && token.launchModel !== "classic") {
    throw invalidInput("uniswap", "optimistic-launch-model");
  }
  const supply = token.totalSupplyRaw === undefined
    ? null
    : decimalBigInt(token.totalSupplyRaw, "optimistic-total-supply");
  const decimals = token.tokenDecimals === undefined
    ? null
    : token.tokenDecimals;
  if (decimals !== null && !validDecimals(decimals)) {
    throw invalidInput("uniswap", "optimistic-token-decimals");
  }

  if (!stock) {
    if (
      token.quoteAssetAddress !== undefined ||
      token.quoteIsCurrency0 !== undefined
    ) {
      throw invalidInput("uniswap", "optimistic-classic-orientation");
    }
    return Object.freeze({
      tokenAddress,
      poolId,
      totalSupplyRaw: supply,
      tokenDecimals: decimals,
      launchModel: "classic" as const,
      quoteAssetAddress: null,
      quoteAssetDecimals: null,
      quoteIsCurrency0: null,
    });
  }

  if (!token.quoteAssetAddress || typeof token.quoteIsCurrency0 !== "boolean") {
    throw invalidInput("uniswap", "optimistic-stock-orientation");
  }
  let quoteAssetAddress: HexAddress;
  try {
    quoteAssetAddress = canonicalAddress(token.quoteAssetAddress);
  } catch {
    throw invalidInput("uniswap", "optimistic-stock-orientation");
  }
  if (
    quoteAssetAddress === tokenAddress ||
    token.quoteIsCurrency0 !== (BigInt(quoteAssetAddress) < BigInt(tokenAddress))
  ) {
    throw invalidInput("uniswap", "optimistic-stock-orientation");
  }
  return Object.freeze({
    tokenAddress,
    poolId,
    totalSupplyRaw: supply,
    tokenDecimals: decimals,
    launchModel: "stock-paired" as const,
    quoteAssetAddress,
    // Every currently verified Stock-Paired quote asset is 18 decimals. A new
    // launch must carry this explicitly instead of inheriting the convention.
    quoteAssetDecimals: 18,
    quoteIsCurrency0: token.quoteIsCurrency0,
  });
}

function normalizeNewLaunch(
  launch: OptimisticNewLaunchMarketInput,
  inputPoolId: HexBytes32,
  inputTokenAddress: HexAddress,
): NormalizedValuation {
  let poolId: HexBytes32;
  let tokenAddress: HexAddress;
  try {
    poolId = canonicalBytes32(launch.poolId);
    tokenAddress = canonicalAddress(launch.tokenAddress);
  } catch {
    throw invalidInput("uniswap", "optimistic-launch-identity");
  }
  if (
    poolId !== inputPoolId ||
    tokenAddress !== inputTokenAddress ||
    !validDecimals(launch.tokenDecimals) ||
    launch.tokenDecimals !== EXPECTED_LAUNCH_TOKEN_DECIMALS ||
    (launch.launchModel !== "classic" &&
      launch.launchModel !== "stock-paired")
  ) {
    throw invalidInput("uniswap", "optimistic-launch-identity");
  }
  const totalSupplyRaw = decimalBigInt(
    launch.totalSupplyRaw,
    "optimistic-total-supply",
  );
  const poolKey = normalizedPoolKey(launch.poolKey);
  let computedPoolId: HexBytes32;
  try {
    computedPoolId = canonicalBytes32(computeOfficialV4PoolId(poolKey));
  } catch {
    throw invalidInput("uniswap", "optimistic-pool-key");
  }
  if (
    computedPoolId !== poolId ||
    (poolKey.currency0 !== tokenAddress && poolKey.currency1 !== tokenAddress)
  ) {
    throw invalidInput("uniswap", "optimistic-pool-key");
  }

  if (launch.launchModel === "classic") {
    if (
      poolKey.currency0 !== ZERO_ADDRESS ||
      poolKey.currency1 !== tokenAddress ||
      launch.quoteAssetAddress !== undefined ||
      launch.quoteAssetDecimals !== undefined ||
      launch.quoteIsCurrency0 !== undefined
    ) {
      throw invalidInput("uniswap", "optimistic-classic-orientation");
    }
    return Object.freeze({
      tokenAddress,
      poolId,
      totalSupplyRaw,
      tokenDecimals: launch.tokenDecimals,
      launchModel: "classic" as const,
      quoteAssetAddress: null,
      quoteAssetDecimals: null,
      quoteIsCurrency0: null,
    });
  }

  let quoteAssetAddress: HexAddress;
  try {
    quoteAssetAddress = canonicalAddress(launch.quoteAssetAddress);
  } catch {
    throw invalidInput("uniswap", "optimistic-stock-orientation");
  }
  if (
    !validDecimals(launch.quoteAssetDecimals) ||
    typeof launch.quoteIsCurrency0 !== "boolean" ||
    quoteAssetAddress === tokenAddress ||
    launch.quoteIsCurrency0 !== (BigInt(quoteAssetAddress) < BigInt(tokenAddress)) ||
    poolKey.currency0 !== (launch.quoteIsCurrency0 ? quoteAssetAddress : tokenAddress) ||
    poolKey.currency1 !== (launch.quoteIsCurrency0 ? tokenAddress : quoteAssetAddress)
  ) {
    throw invalidInput("uniswap", "optimistic-stock-orientation");
  }
  return Object.freeze({
    tokenAddress,
    poolId,
    totalSupplyRaw,
    tokenDecimals: launch.tokenDecimals,
    launchModel: "stock-paired" as const,
    quoteAssetAddress,
    quoteAssetDecimals: launch.quoteAssetDecimals,
    quoteIsCurrency0: launch.quoteIsCurrency0,
  });
}

function normalizeValuation(input: Readonly<{
  token?: LauncherToken;
  newLaunch?: OptimisticNewLaunchMarketInput;
  poolId: unknown;
  tokenAddress: unknown;
}>): NormalizedValuation {
  let poolId: HexBytes32;
  let tokenAddress: HexAddress;
  try {
    poolId = canonicalBytes32(input.poolId);
    tokenAddress = canonicalAddress(input.tokenAddress);
  } catch {
    throw invalidInput("uniswap", "optimistic-market-identity");
  }
  if ((input.token === undefined) === (input.newLaunch === undefined)) {
    throw invalidInput("uniswap", "optimistic-market-token-source");
  }
  return input.token
    ? normalizeKnownToken(input.token, poolId, tokenAddress)
    : normalizeNewLaunch(input.newLaunch!, poolId, tokenAddress);
}

function decodeKnownEvent(
  log: OptimisticManifestLog,
  event: AbiEvent,
): Record<string, unknown> | null {
  if (log.topics[0]?.toLowerCase() !== toEventSelector(event).toLowerCase()) {
    return null;
  }
  try {
    const decoded = decodeEventLog({
      abi: [event],
      eventName: event.name,
      topics: [...log.topics] as [Hex, ...Hex[]],
      data: log.data,
      strict: true,
    });
    if (
      decoded.eventName !== event.name ||
      typeof decoded.args !== "object" ||
      decoded.args === null ||
      Array.isArray(decoded.args)
    ) {
      throw new Error("invalid event result");
    }
    return decoded.args as Record<string, unknown>;
  } catch {
    throw validationError("rpc", "optimistic-new-launch-event");
  }
}

function eventAddress(value: unknown): HexAddress | null {
  try {
    return canonicalAddress(value);
  } catch {
    return null;
  }
}

function eventBytes32(value: unknown): HexBytes32 | null {
  try {
    return canonicalBytes32(value);
  } catch {
    return null;
  }
}

function eventUint(value: unknown): bigint | null {
  return typeof value === "bigint" && value >= 0n ? value : null;
}

function assertNewLaunchEvidence(
  launch: OptimisticNewLaunchMarketInput,
  evidence: DualRpcOptimisticBlock,
): void {
  const tokenAddress = canonicalAddress(launch.tokenAddress);
  const poolId = canonicalBytes32(launch.poolId);
  const poolKey = normalizedPoolKey(launch.poolKey);
  const totalSupply = decimalBigInt(
    launch.totalSupplyRaw,
    "optimistic-total-supply",
  );
  if (
    poolKey.fee !== EXPECTED_POOL_FEE ||
    poolKey.tickSpacing !== EXPECTED_TICK_SPACING ||
    poolKey.hooks === ZERO_ADDRESS
  ) {
    throw invalidInput("uniswap", "optimistic-new-launch-pool-policy");
  }

  let matchingPairs = 0;
  for (const pair of NEW_LAUNCH_EVENT_PAIRS) {
    if (pair.launchModel !== launch.launchModel) continue;
    const source = RELEASE_BINDING.sources.find(
      ({ contractName }) => contractName === pair.sourceContractName,
    );
    if (
      !source ||
      BigInt(source.startBlock) > BigInt(evidence.block.number)
    ) {
      continue;
    }
    const sourceLogs = evidence.logs.filter(
      (log) =>
        log.sourceContractName === pair.sourceContractName &&
        log.address === source.address &&
        log.blockNumber === evidence.block.number &&
        log.blockHash === evidence.block.hash,
    );
    for (const launchLog of sourceLogs) {
      const launchArgs = decodeKnownEvent(launchLog, pair.launchEvent);
      if (!launchArgs) continue;
      if (
        eventAddress(launchArgs.token) !== tokenAddress ||
        eventBytes32(launchArgs.poolId) !== poolId ||
        (launch.launchModel === "classic" &&
          eventAddress(launchArgs.feeHook) !== poolKey.hooks) ||
        (launch.launchModel === "stock-paired" &&
          eventAddress(launchArgs.quoteAsset) !==
            canonicalAddress(launch.quoteAssetAddress))
      ) {
        continue;
      }

      const matchingLiquidity = sourceLogs.filter((liquidityLog) => {
        if (liquidityLog.transactionHash !== launchLog.transactionHash) {
          return false;
        }
        const args = decodeKnownEvent(liquidityLog, pair.liquidityEvent);
        if (!args) return false;
        const launchHash = eventBytes32(launchArgs.launchHash);
        const configuredSupply = eventUint(args.totalSupply);
        const tokenLiquidity = eventUint(args.tokenLiquidityAmount);
        const lockedDust = eventUint(args.lockedTokenDust);
        return (
          launchHash !== null &&
          eventBytes32(args.launchHash) === launchHash &&
          eventAddress(args.token) === tokenAddress &&
          configuredSupply === totalSupply &&
          tokenLiquidity !== null &&
          lockedDust !== null &&
          tokenLiquidity + lockedDust === totalSupply &&
          (launch.launchModel === "classic" ||
            eventAddress(args.quoteAsset) ===
              canonicalAddress(launch.quoteAssetAddress))
        );
      });
      if (matchingLiquidity.length === 1) matchingPairs += 1;
    }
  }
  if (matchingPairs !== 1) {
    throw invalidInput("uniswap", "optimistic-new-launch-evidence");
  }
}

function normalizeEvidence(
  evidence: DualRpcOptimisticBlock,
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider],
): CanonicalEvidence {
  assertProductionDualRpcProviders(providers);
  if (
    evidence.finality !== "optimistic" ||
    evidence.chainId !== 1 ||
    !Number.isSafeInteger(evidence.confirmations) ||
    evidence.confirmations < 0 ||
    evidence.confirmations >= OPTIMISTIC_CONFIRMATION_LIMIT ||
    !exactPair(evidence.providerIdentities, [
      providers[0].identity,
      providers[1].identity,
    ]) ||
    !exactPair(evidence.providerVendorGroups, [
      providers[0].vendorGroup,
      providers[1].vendorGroup,
    ]) ||
    !exactPair(evidence.providerEndpointCommitments, [
      providers[0].endpointCommitment,
      providers[1].endpointCommitment,
    ]) ||
    !exactPair(evidence.providerOriginCommitments, [
      providers[0].endpointOriginCommitment,
      providers[1].endpointOriginCommitment,
    ]) ||
    providers[0].client === providers[1].client ||
    typeof providers[0].client.readOptimisticPoolState !== "function" ||
    typeof providers[1].client.readOptimisticPoolState !== "function"
  ) {
    throw invalidInput("rpc", "optimistic-market-evidence");
  }

  try {
    const blockNumberText = parseNonnegativeIntegerText(
      evidence.block.number,
      20,
    );
    const blockNumber = BigInt(blockNumberText);
    const blockHash = canonicalBytes32(evidence.block.hash);
    const parentHash = canonicalBytes32(evidence.block.parentHash);
    const timestamp = decimalBigInt(
      evidence.block.timestamp,
      "optimistic-block-timestamp",
      20,
    );
    const heads = evidence.providerHeads.map((head) =>
      decimalBigInt(head, "optimistic-provider-head", 20)
    ) as [bigint, bigint];
    if (
      !Array.isArray(evidence.providerHeadObservations) ||
      evidence.providerHeadObservations.length !== 2
    ) {
      throw validationError("rpc", "optimistic-market-head-observation");
    }
    const providerHeadObservations = Object.freeze([
      canonicalHeadObservation(evidence.providerHeadObservations[0], heads[0]),
      canonicalHeadObservation(evidence.providerHeadObservations[1], heads[1]),
    ] as const);
    if (!sameHeightHasSameHash(
      providerHeadObservations[0],
      providerHeadObservations[1],
    )) {
      throw validationError("rpc", "optimistic-market-provider-head-mismatch");
    }
    const blockProviderCallCounts = evidence.providerCallCounts as unknown;
    if (
      !Array.isArray(blockProviderCallCounts) ||
      blockProviderCallCounts.length !== 2 ||
      blockProviderCallCounts.some((count, providerIndex) =>
        !Number.isSafeInteger(count) ||
        count !== (heads[providerIndex] === blockNumber ? 4 : 5))
    ) {
      throw validationError("rpc", "optimistic-market-block-call-counts");
    }
    if (
      heads[0] < blockNumber ||
      heads[1] < blockNumber ||
      Number((heads[0] < heads[1] ? heads[0] : heads[1]) - blockNumber) !==
        evidence.confirmations
    ) {
      throw validationError("rpc", "optimistic-market-confirmations");
    }
    return Object.freeze({
      blockNumber,
      blockNumberText,
      blockHash,
      parentHash,
      timestamp,
      providerHeads: Object.freeze([heads[0], heads[1]] as const),
      providerHeadObservations,
      blockProviderCallCounts: Object.freeze([
        blockProviderCallCounts[0] as number,
        blockProviderCallCounts[1] as number,
      ] as const),
    });
  } catch (error) {
    if (error instanceof DataPipelineError) throw error;
    throw invalidInput("rpc", "optimistic-market-evidence");
  }
}

function assertHeader(
  header: CandidateRpcBlock,
  evidence: CanonicalEvidence,
): void {
  let hash: HexBytes32;
  let parentHash: HexBytes32;
  try {
    hash = canonicalBytes32(header.hash);
    parentHash = canonicalBytes32(header.parentHash);
  } catch {
    throw validationError("rpc", "optimistic-market-block");
  }
  if (
    header.number !== evidence.blockNumber ||
    hash !== evidence.blockHash ||
    parentHash !== evidence.parentHash ||
    header.timestamp !== evidence.timestamp
  ) {
    throw validationError("rpc", "optimistic-market-block");
  }
}

function canonicalProviderState(
  value: CandidateRpcOptimisticPoolState,
  input: Readonly<{
    stateView: HexAddress;
    poolId: HexBytes32;
    evidence: CanonicalEvidence;
    head: bigint;
    headObservation: OptimisticProviderHeadObservation;
    rpcCallCount: number;
  }>,
): ProviderRead {
  let stateView: HexAddress;
  let poolId: HexBytes32;
  let blockHash: HexBytes32;
  let runtimeBytecode: HexData;
  let slot0Result: HexData;
  let liquidityResult: HexData;
  try {
    stateView = canonicalAddress(value.stateView);
    poolId = canonicalBytes32(value.poolId);
    blockHash = canonicalBytes32(value.blockHash);
    runtimeBytecode = canonicalRawData(value.runtimeBytecode);
    slot0Result = canonicalRawData(value.slot0Result);
    liquidityResult = canonicalRawData(value.liquidityResult);
  } catch {
    throw validationError("rpc", "optimistic-market-state");
  }
  if (
    stateView !== input.stateView ||
    poolId !== input.poolId ||
    value.blockNumber !== input.evidence.blockNumberText ||
    blockHash !== input.evidence.blockHash ||
    value.rpcCallCount !== 3 ||
    runtimeBytecode === "0x" ||
    keccak256(runtimeBytecode) !==
      OPTIMISTIC_MAINNET_STATE_VIEW_RUNTIME_CODE_HASH ||
    slot0Result === "0x" ||
    liquidityResult === "0x"
  ) {
    throw validationError("rpc", "optimistic-market-state");
  }
  return Object.freeze({
    head: input.head,
    headObservation: input.headObservation,
    rpcCallCount: input.rpcCallCount,
    runtimeBytecode,
    slot0Result,
    liquidityResult,
  });
}

function monotonicTimestamp(): string {
  return new Date(performance.timeOrigin + performance.now()).toISOString();
}

async function exactMarketHeaders(input: Readonly<{
  provider: CandidateRpcProvider;
  evidence: CanonicalEvidence;
  head: bigint;
  rpcCallCounter: RpcCallCounter;
}>): Promise<Readonly<{
  target: CandidateRpcBlock;
  headObservation: OptimisticProviderHeadObservation;
}>> {
  const blockNumbers = input.head === input.evidence.blockNumber
    ? [input.evidence.blockNumber]
    : [input.evidence.blockNumber, input.head];
  let headers: readonly CandidateRpcBlock[];
  if (input.provider.client.getBlocks) {
    recordRpcCalls(input.rpcCallCounter, blockNumbers.length);
    headers = await input.provider.client.getBlocks({ blockNumbers });
  } else if (input.head === input.evidence.blockNumber) {
    recordRpcCalls(input.rpcCallCounter, 1);
    headers = [await input.provider.client.getBlock({
      blockNumber: input.evidence.blockNumber,
    })];
  } else {
    throw invalidInput("rpc", "optimistic-market-head-header-port");
  }
  if (headers.length !== blockNumbers.length) {
    throw validationError("rpc", "optimistic-market-head-header-count");
  }
  const target = headers[0]!;
  assertHeader(target, input.evidence);
  const headHeader = input.head === input.evidence.blockNumber
    ? target
    : headers[1]!;
  let headHash: HexBytes32;
  try {
    headHash = canonicalBytes32(headHeader.hash);
  } catch {
    throw validationError("rpc", "optimistic-market-head-header");
  }
  if (headHeader.number !== input.head || headHash === ZERO_BYTES32) {
    throw validationError("rpc", "optimistic-market-head-header");
  }
  return Object.freeze({
    target,
    headObservation: Object.freeze({
      blockNumber: input.head.toString(),
      blockHash: headHash,
      observedAt: monotonicTimestamp(),
    }),
  });
}

async function readProviderState(input: Readonly<{
  provider: CandidateRpcProvider;
  stateView: HexAddress;
  poolId: HexBytes32;
  evidence: CanonicalEvidence;
  deadline: DeadlineContext;
}>): Promise<ProviderRead> {
  const readState = input.provider.client.readOptimisticPoolState;
  if (!readState) throw invalidInput("rpc", "optimistic-market-state-port");
  const rpcCallCounter: RpcCallCounter = { value: 0 };

  assertWithinDeadline(input.deadline);
  recordRpcCalls(rpcCallCounter, 1);
  const chainIdPromise = input.provider.client.getChainId();
  recordRpcCalls(rpcCallCounter, 1);
  const headPromise = input.provider.client.getBlockNumber();
  const [chainId, head] = await Promise.all([chainIdPromise, headPromise]);
  if (chainId !== 1 || typeof head !== "bigint" || head < input.evidence.blockNumber) {
    throw validationError("rpc", "optimistic-market-head");
  }
  const before = await exactMarketHeaders({
    provider: input.provider,
    evidence: input.evidence,
    head,
    rpcCallCounter,
  });
  assertHeader(before.target, input.evidence);
  assertWithinDeadline(input.deadline);
  const raw = await readState({
    stateView: input.stateView,
    poolId: input.poolId,
    blockNumber: input.evidence.blockNumber,
    blockHash: input.evidence.blockHash,
    requireCanonical: true,
  });
  recordRpcCalls(rpcCallCounter, raw.rpcCallCount);
  assertWithinDeadline(input.deadline);
  recordRpcCalls(rpcCallCounter, 1);
  const after = await input.provider.client.getBlock({
    blockNumber: input.evidence.blockNumber,
  });
  assertHeader(after, input.evidence);
  assertWithinDeadline(input.deadline);
  const expectedRpcCallCount = head === input.evidence.blockNumber ? 7 : 8;
  if (rpcCallCounter.value !== expectedRpcCallCount) {
    throw validationError("rpc", "optimistic-market-call-counts");
  }
  return canonicalProviderState(raw, {
    ...input,
    head,
    headObservation: before.headObservation,
    rpcCallCount: rpcCallCounter.value,
  });
}

function deadlineMs(value: unknown): number {
  const parsed = value ?? DEFAULT_HARD_DEADLINE_MS;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAXIMUM_HARD_DEADLINE_MS
  ) {
    throw invalidInput("rpc", "optimistic-market-deadline");
  }
  return parsed;
}

function timeoutError(): DataPipelineError {
  return dataPipelineError({
    dependency: "rpc",
    code: "timeout",
    retryable: true,
    countsTowardCircuit: true,
    metadata: { operation: "optimistic-market-state" },
  });
}

function assertWithinDeadline(context: DeadlineContext): void {
  if (context.expired || Date.now() >= context.deadlineAt) throw timeoutError();
}

async function withinDeadline<T>(
  operation: Promise<T>,
  context: DeadlineContext,
  maximumMs: number,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          context.expired = true;
          reject(timeoutError());
        }, maximumMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function decodePoolState(read: ProviderRead): OptimisticPoolState {
  let slot0: readonly [bigint, number, number, number];
  let liquidity: bigint;
  try {
    slot0 = decodeFunctionResult({
      abi: stateViewReadAbi,
      functionName: "getSlot0",
      data: read.slot0Result,
    });
    liquidity = decodeFunctionResult({
      abi: stateViewReadAbi,
      functionName: "getLiquidity",
      data: read.liquidityResult,
    });
  } catch {
    throw validationError("rpc", "optimistic-market-state-decode");
  }
  const [sqrtPriceX96, currentTick, protocolFeePips, lpFeePips] = slot0;
  if (
    typeof sqrtPriceX96 !== "bigint" ||
    sqrtPriceX96 <= 0n ||
    sqrtPriceX96 > UINT160_MAX ||
    !Number.isSafeInteger(currentTick) ||
    currentTick < MINIMUM_TICK ||
    currentTick > MAXIMUM_TICK ||
    !Number.isSafeInteger(protocolFeePips) ||
    protocolFeePips < 0 ||
    (protocolFeePips & PROTOCOL_FEE_DIRECTION_MASK) >
      MAXIMUM_PROTOCOL_FEE_PIPS ||
    (protocolFeePips >> 12) > MAXIMUM_PROTOCOL_FEE_PIPS ||
    !Number.isSafeInteger(lpFeePips) ||
    lpFeePips < 0 ||
    lpFeePips > MAXIMUM_LP_FEE_PIPS ||
    typeof liquidity !== "bigint" ||
    liquidity < 0n ||
    liquidity > UINT128_MAX
  ) {
    throw validationError("rpc", "optimistic-market-state-range");
  }
  return Object.freeze({
    sqrtPriceX96: sqrtPriceX96.toString(),
    currentTick,
    activeLiquidity: liquidity.toString(),
    protocolFeePips,
    lpFeePips,
    slot0Result: read.slot0Result,
    liquidityResult: read.liquidityResult,
  });
}

function marketFields(input: Readonly<{
  valuation: NormalizedValuation;
  pool: OptimisticPoolState;
  block: DualRpcOptimisticBlock;
}>): OptimisticMarketFields {
  const base = {
    indexedValuationBlockNumber: input.block.block.number,
    currentTick: input.pool.currentTick,
    activeLiquidity: input.pool.activeLiquidity,
  } satisfies OptimisticMarketFields;
  // Quote-denominated fields are intentionally absent from the public overlay
  // whitelist. A stock pool therefore exposes only its exact state until a
  // separate internally generated, same-block dual-RPC USD proof exists.
  if (input.valuation.launchModel === "stock-paired") {
    return Object.freeze(base);
  }
  const { totalSupplyRaw, tokenDecimals } = input.valuation;
  if (totalSupplyRaw === null || tokenDecimals === null) {
    return Object.freeze(base);
  }
  uint256(totalSupplyRaw, "optimistic-total-supply");
  const sqrtPriceX96 = BigInt(input.pool.sqrtPriceX96);

  let tokenPriceEthWei: bigint;
  let marketCapEthWei: bigint;
  try {
    tokenPriceEthWei = uint256(
      nativePriceWadFromSqrtPriceX96(sqrtPriceX96, tokenDecimals),
      "optimistic-classic-price",
    );
    marketCapEthWei = uint256(
      marketCapNativeWadFromSqrtPriceX96(totalSupplyRaw, sqrtPriceX96),
      "optimistic-classic-market-cap",
    );
  } catch (error) {
    if (error instanceof DataPipelineError) throw error;
    throw validationError("uniswap", "optimistic-classic-valuation");
  }
  return Object.freeze({
    ...base,
    tokenPriceEth: formatUnits(tokenPriceEthWei, 18),
    tokenPriceEthWei: tokenPriceEthWei.toString(),
    marketCapEth: formatUnits(marketCapEthWei, 18),
    marketCapEthWei: marketCapEthWei.toString(),
    indexedMarketCapEth: formatUnits(marketCapEthWei, 18),
    indexedMarketCapEthWei: marketCapEthWei.toString(),
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function computeOptimisticMarketStateCommitments(input: Readonly<{
  blockNumber: string;
  blockHash: HexBytes32;
  stateView: HexAddress;
  poolId: HexBytes32;
  tokenAddress: HexAddress;
  pool: OptimisticPoolState;
  market: OptimisticMarketFields;
  providerIdentities: readonly [string, string];
  providerVendorGroups: readonly [string, string];
  providerEndpointCommitments: readonly [HexBytes32, HexBytes32];
  providerOriginCommitments: readonly [HexBytes32, HexBytes32];
  providerHeads: readonly [string, string];
  providerHeadObservations?: readonly [
    OptimisticProviderHeadObservation,
    OptimisticProviderHeadObservation,
  ];
  blockProviderCallCounts: readonly [number, number];
  marketProviderCallCounts: readonly [number, number];
  totalProviderCallCounts: readonly [number, number];
  confirmations: number;
}>): Readonly<{
  marketCommitment: HexBytes32;
  evidenceCommitment: HexBytes32;
}> {
  const marketCommitment = keccak256(toBytes(canonicalJson({
    version: OPTIMISTIC_MARKET_STATE_VERSION,
    chainId: 1,
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    poolId: input.poolId,
    tokenAddress: input.tokenAddress,
    stateView: input.stateView,
    stateViewRuntimeCodeHash:
      OPTIMISTIC_MAINNET_STATE_VIEW_RUNTIME_CODE_HASH,
    market: input.market,
    pool: input.pool,
  })));
  const evidenceCommitment = keccak256(toBytes(canonicalJson({
    version: OPTIMISTIC_MARKET_STATE_VERSION,
    marketCommitment,
    providerIdentities: input.providerIdentities,
    providerVendorGroups: input.providerVendorGroups,
    providerEndpointCommitments: input.providerEndpointCommitments,
    providerOriginCommitments: input.providerOriginCommitments,
    providerHeads: input.providerHeads,
    blockProviderCallCounts: input.blockProviderCallCounts,
    marketProviderCallCounts: input.marketProviderCallCounts,
    totalProviderCallCounts: input.totalProviderCallCounts,
    confirmations: input.confirmations,
  })));
  return Object.freeze({ marketCommitment, evidenceCommitment });
}

/**
 * Reads the exact StateView slot0/liquidity bytes from the same independent
 * dRPC + QuickNode pair that produced the optimistic block evidence. Each
 * provider is fenced by matching header reads before and after its EIP-1898
 * calls. No latest state, subgraph, Graph or single-provider fallback exists.
 */
export async function readOptimisticMarketState(input: Readonly<{
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  evidence: DualRpcOptimisticBlock;
  stateView: HexAddress;
  poolId: HexBytes32;
  tokenAddress: HexAddress;
  token?: LauncherToken;
  newLaunch?: OptimisticNewLaunchMarketInput;
  hardDeadlineMs?: number;
}>): Promise<OptimisticMarketStateResult> {
  let stateView: HexAddress;
  try {
    stateView = canonicalAddress(input.stateView);
  } catch {
    throw invalidInput("uniswap", "optimistic-state-view");
  }
  if (stateView !== OPTIMISTIC_MAINNET_STATE_VIEW) {
    throw invalidInput("uniswap", "optimistic-state-view");
  }
  const valuation = normalizeValuation(input);
  const evidence = normalizeEvidence(input.evidence, input.providers);
  const maximumMs = deadlineMs(input.hardDeadlineMs);
  const deadline: DeadlineContext = {
    deadlineAt: Date.now() + maximumMs,
    expired: false,
  };
  if (input.newLaunch) {
    if (!isVerifiedDualRpcOptimisticBlock(input.evidence)) {
      throw invalidInput("rpc", "optimistic-new-launch-evidence-origin");
    }
    assertNewLaunchEvidence(input.newLaunch, input.evidence);
  }

  try {
    const reads = await withinDeadline(
      Promise.all(input.providers.map((provider) => readProviderState({
        provider,
        stateView,
        poolId: valuation.poolId,
        evidence,
        deadline,
      }))) as Promise<[ProviderRead, ProviderRead]>,
      deadline,
      maximumMs,
    );
    if (
      reads[0].slot0Result !== reads[1].slot0Result ||
      reads[0].liquidityResult !== reads[1].liquidityResult ||
      reads[0].runtimeBytecode !== reads[1].runtimeBytecode
    ) {
      throw validationError("rpc", "optimistic-market-provider-mismatch");
    }
    const pool = decodePoolState(reads[0]);
    const market = marketFields({
      valuation,
      pool,
      block: input.evidence,
    });
    const lowestHead = reads[0].head < reads[1].head
      ? reads[0].head
      : reads[1].head;
    const confirmations = lowestHead - evidence.blockNumber;
    if (
      reads[0].head < evidence.providerHeads[0] ||
      reads[1].head < evidence.providerHeads[1] ||
      confirmations < 0n ||
      confirmations >= BigInt(OPTIMISTIC_CONFIRMATION_LIMIT)
    ) {
      throw validationError("rpc", "optimistic-market-confirmations");
    }
    if (
      reads[0].head === reads[1].head &&
      reads[0].headObservation.blockHash !==
        reads[1].headObservation.blockHash
    ) {
      throw validationError("rpc", "optimistic-market-provider-head-mismatch");
    }
    for (const blockObservation of evidence.providerHeadObservations) {
      for (const marketObservation of [
        reads[0].headObservation,
        reads[1].headObservation,
      ]) {
        if (!sameHeightHasSameHash(blockObservation, marketObservation)) {
          throw validationError(
            "rpc",
            "optimistic-market-provider-head-mismatch",
          );
        }
      }
    }
    const providerHeads = [
      reads[0].head.toString(),
      reads[1].head.toString(),
    ] as const;
    const providerHeadObservations = Object.freeze([
      reads[0].headObservation,
      reads[1].headObservation,
    ] as const);
    const blockProviderCallCounts = evidence.blockProviderCallCounts;
    const marketProviderCallCounts = Object.freeze([
      reads[0].rpcCallCount,
      reads[1].rpcCallCount,
    ] as const);
    const totalProviderCallCounts = Object.freeze([
      blockProviderCallCounts[0] + marketProviderCallCounts[0],
      blockProviderCallCounts[1] + marketProviderCallCounts[1],
    ] as const);
    const commitments = computeOptimisticMarketStateCommitments({
      blockNumber: evidence.blockNumberText,
      blockHash: evidence.blockHash,
      stateView,
      poolId: valuation.poolId,
      tokenAddress: valuation.tokenAddress,
      pool,
      market,
      providerIdentities: input.evidence.providerIdentities,
      providerVendorGroups: input.evidence.providerVendorGroups,
      providerEndpointCommitments:
        input.evidence.providerEndpointCommitments,
      providerOriginCommitments: input.evidence.providerOriginCommitments,
      providerHeads,
      providerHeadObservations,
      blockProviderCallCounts,
      marketProviderCallCounts,
      totalProviderCallCounts,
      confirmations: Number(confirmations),
    });
    return Object.freeze({
      version: OPTIMISTIC_MARKET_STATE_VERSION,
      finality: "optimistic" as const,
      chainId: 1 as const,
      blockNumber: evidence.blockNumberText,
      blockHash: evidence.blockHash,
      confirmations: Number(confirmations),
      poolId: valuation.poolId,
      tokenAddress: valuation.tokenAddress,
      stateView,
      stateViewRuntimeCodeHash:
        OPTIMISTIC_MAINNET_STATE_VIEW_RUNTIME_CODE_HASH,
      market,
      ...commitments,
      pool,
      providerIdentities: input.evidence.providerIdentities,
      providerVendorGroups: input.evidence.providerVendorGroups,
      providerEndpointCommitments:
        input.evidence.providerEndpointCommitments,
      providerOriginCommitments: input.evidence.providerOriginCommitments,
      providerHeads,
      providerHeadObservations,
      blockProviderCallCounts,
      marketProviderCallCounts,
      totalProviderCallCounts,
    });
  } catch (error) {
    if (error instanceof DataPipelineError) throw error;
    throw dataPipelineError({
      dependency: "rpc",
      code: "dependency_unavailable",
      retryable: true,
      countsTowardCircuit: true,
      metadata: { operation: "optimistic-market-state" },
    });
  }
}
