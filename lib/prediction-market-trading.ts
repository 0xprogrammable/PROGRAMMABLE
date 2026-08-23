import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  keccak256,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import {
  ROBINHOOD_V4_POOL_MANAGER_ADDRESS,
  ROBINHOOD_V4_POOL_MANAGER_RUNTIME_CODE_HASH,
  ROBINHOOD_V4_QUOTER_ADDRESS,
  ROBINHOOD_V4_QUOTER_RUNTIME_CODE_HASH,
  ROBINHOOD_V4_STATE_VIEW_ADDRESS,
  ROBINHOOD_V4_STATE_VIEW_RUNTIME_CODE_HASH,
  createPredictionMarketPublicClients,
  type PredictionMarketPublicClient,
  type PredictionMarketReleaseConfig,
} from "./prediction-market-chain";
import {
  ROBINHOOD_BTC_USD_FEED_ADDRESS,
  ROBINHOOD_USDG_ADDRESS,
  formatPredictionThreshold,
  type PredictionPermitSignature,
} from "./prediction-market";
import { predictionMarketErrorMessage } from "./prediction-market-errors";
import {
  ROBINHOOD_MULTICALL3_ADDRESS,
  ROBINHOOD_MULTICALL3_RUNTIME_CODE_HASH,
  robinhoodChain,
} from "./chains";
import type { PreparedTransaction } from "./prepared-transaction";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;
const CONFIRMATIONS = 3n;
const MAX_RPC_HEAD_DIVERGENCE = 300n;
const GAS_BUFFER_PERCENT = 120n;
const MAX_ACTION_GAS = 5_000_000n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const Q192 = 1n << 192n;
const FACE_SCALE = 10n;
const MAX_BUY_COLLATERAL_ATOMS = UINT128_MAX * FACE_SCALE;
const PREDICTION_DIRECTORY_MARKET_BATCH_SIZE = 4;
const MIN_SQRT_PRICE = 4_295_128_739n;
const MAX_SQRT_PRICE =
  1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;

export const PREDICTION_OUTCOME_DECIMALS = 5;
export const PREDICTION_COLLATERAL_DECIMALS = 6;
export const PREDICTION_DEFAULT_SLIPPAGE_BPS = 50;
export const PREDICTION_MAX_SLIPPAGE_BPS = 1_000;

export type PredictionOutcome = "YES" | "NO";
export type PredictionMarketState = "OPEN" | "FINAL_YES" | "FINAL_NO" | "FINAL_INVALID";
export type PredictionCheckpointStatus = "AWAITING" | "FINAL" | "INVALID";

export type PredictionMarketLoadRequestV1 = Readonly<{
  accountKey: string;
  generation: number;
  semanticKey: string;
}>;

export function isPredictionMarketLoadRequestCurrent(
  candidate: PredictionMarketLoadRequestV1,
  current: PredictionMarketLoadRequestV1 | null,
) {
  return current !== null
    && candidate.accountKey === current.accountKey
    && candidate.generation === current.generation
    && candidate.semanticKey === current.semanticKey;
}

export type PredictionPoolKey = Readonly<{
  currency0: Address;
  currency1: Address;
  fee: number;
  hooks: Address;
  tickSpacing: number;
}>;

export type PredictionMarketView = Readonly<{
  accountedLiabilityAtoms: bigint;
  blockNumber: bigint;
  blockTimestamp: bigint;
  canonicalPoolId: Hex;
  checkpoint: Address;
  checkpointStatus: PredictionCheckpointStatus;
  cutoff: bigint;
  fallbackChallengeDeadline: bigint;
  fallbackRequestedAt: bigint;
  hardResolutionDeadline: bigint;
  liquidity: bigint;
  noBalanceAtoms: bigint;
  noToken: Address;
  noTokenName: string;
  observationTime: bigint;
  poolId: Hex;
  poolKey: PredictionPoolKey;
  probabilityYesBps: number;
  protocolFee: number;
  resolvedPriceAtoms: bigint;
  resolutionDeadline: bigint;
  router: Address;
  semanticKey: Hex;
  sqrtPriceX96: bigint;
  state: PredictionMarketState;
  thresholdAtoms: bigint;
  tick: number;
  title: string;
  vault: Address;
  yesBalanceAtoms: bigint;
  yesToken: Address;
  yesTokenName: string;
}>;

export type PredictionMarketDirectory = Readonly<{
  blockNumber: bigint;
  blockTimestamp: bigint;
  marketCount: bigint;
  markets: readonly PredictionMarketView[];
  nextCursor: bigint;
}>;

export type PredictionMarketSnapshot = Readonly<{
  blockHash: Hex;
  blockNumber: bigint;
  blockTimestamp: bigint;
  marketCount: bigint;
  router: Address;
}>;

export type PredictionMarketBatchFailure = Readonly<{
  reason: string;
  semanticKey: Hex;
}>;

export type PredictionMarketBatchRead = Readonly<{
  failures: readonly PredictionMarketBatchFailure[];
  markets: readonly PredictionMarketView[];
  snapshot: PredictionMarketSnapshot;
}>;

export type PredictionSwapQuote = Readonly<{
  actualInput: bigint;
  amountOut: bigint;
  lpFee: number;
  protocolFee: number;
  sqrtPriceX96After: bigint;
  tickAfter: number;
}>;

export type PredictionBuyQuote = Readonly<{
  averagePriceBps: number;
  blockNumber: bigint;
  collateralInAtoms: bigint;
  collateralRefundAtoms: bigint;
  market: PredictionMarketView;
  minOutcomeAtoms: bigint;
  outcome: PredictionOutcome;
  outcomeAtoms: bigint;
  priceImpactBps: number;
  probabilityAfterBps: number;
  sqrtPriceLimitX96: bigint;
  swap: PredictionSwapQuote;
  zeroForOne: boolean;
}>;

export type PredictionBuyPayoutSummary = Readonly<{
  estimatedCostAtoms: bigint;
  maximumLossAtoms: bigint;
  minimumNeutralPayoutAtoms: bigint;
  minimumWinningProfitAtoms: bigint;
  minimumWinningPayoutAtoms: bigint;
  neutralPayoutAtoms: bigint;
  potentialProfitAtoms: bigint;
  winningPayoutAtoms: bigint;
}>;

export type PredictionSellQuote = Readonly<{
  averagePriceBps: number;
  blockNumber: bigint;
  collateralAtoms: bigint;
  complementRefundAtoms: bigint;
  market: PredictionMarketView;
  minCollateralAtoms: bigint;
  outcome: PredictionOutcome;
  outcomeAtoms: bigint;
  priceImpactBps: number;
  probabilityAfterBps: number;
  soldRefundAtoms: bigint;
  sqrtPriceLimitX96: bigint;
  swap: PredictionSwapQuote;
  swapAtoms: bigint;
  zeroForOne: boolean;
}>;

type ReleaseBindings = Readonly<{
  collateral: Address;
  factoryCodeHash: Hex | null;
  feed: Address;
  hook: Address;
  hookCodeHash: Hex | null;
  manager: Address;
  predictionQuoterCodeHash: Hex | null;
  predictionQuoterFactory: Address;
  predictionQuoterManager: Address;
  protocolManagerCodeHash: Hex | null;
  protocolMulticallCodeHash: Hex | null;
  protocolQuoterCodeHash: Hex | null;
  protocolStateViewCodeHash: Hex | null;
  router: Address;
  routerCodeHash: Hex | null;
}>;

const poolKeyComponents = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

const factoryAbi = [
  { type: "function", name: "collateral", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "btcUsdPriceFeed", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "hook", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "manager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "router", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "marketCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "marketKeyAt", stateMutability: "view", inputs: [{ name: "index", type: "uint256" }], outputs: [{ type: "bytes32" }] },
  {
    type: "function",
    name: "markets",
    stateMutability: "view",
    inputs: [{ name: "semanticKey", type: "bytes32" }],
    outputs: [
      { name: "vault", type: "address" },
      { name: "checkpoint", type: "address" },
      { name: "poolId", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "getPoolKey",
    stateMutability: "view",
    inputs: [{ name: "semanticKey", type: "bytes32" }],
    outputs: [{ name: "key", type: "tuple", components: poolKeyComponents }],
  },
] as const;

const vaultAbi = [
  { type: "function", name: "accountedLiability", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "canonicalPoolId", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "checkpoint", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "collateral", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "cutoff", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "noToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "router", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "state", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "threshold", stateMutability: "view", inputs: [], outputs: [{ type: "int192" }] },
  { type: "function", name: "yesToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "finalizeWithRounds",
    stateMutability: "nonpayable",
    inputs: [{ name: "beforeRoundId", type: "uint80" }, { name: "afterRoundId", type: "uint80" }],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "finalizeUnavailable",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "requestUnprovenFallback",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ type: "uint32" }],
  },
  {
    type: "function",
    name: "finalizeUnproven",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "finalizeResolved",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "yesAtoms", type: "uint256" },
      { name: "noAtoms", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const checkpointAbi = [
  { type: "function", name: "fallbackChallengeDeadline", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "fallbackRequestedAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "hardResolutionDeadline", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "observationTime", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "oraclePhaseId", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "resolvedPrice", stateMutability: "view", inputs: [], outputs: [{ type: "int192" }] },
  { type: "function", name: "resolutionDeadline", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "status", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const releaseQuoterAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "poolManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const stateViewAbi = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  { type: "function", name: "getLiquidity", stateMutability: "view", inputs: [{ name: "poolId", type: "bytes32" }], outputs: [{ type: "uint128" }] },
] as const;

const swapQuoteComponents = [
  { name: "actualInput", type: "uint256" },
  { name: "amountOut", type: "uint256" },
  { name: "sqrtPriceX96After", type: "uint160" },
  { name: "tickAfter", type: "int24" },
  { name: "protocolFee", type: "uint24" },
  { name: "lpFee", type: "uint24" },
] as const;

const predictionQuoterAbi = [
  {
    type: "function",
    name: "quoteBuy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "key", type: "tuple", components: poolKeyComponents },
      { name: "buyYes", type: "bool" },
      { name: "collateralAtoms", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    outputs: [{
      name: "quote",
      type: "tuple",
      components: [
        { name: "collateralInAtoms", type: "uint256" },
        { name: "collateralRefundAtoms", type: "uint256" },
        { name: "outcomeAtoms", type: "uint256" },
        { name: "swap", type: "tuple", components: swapQuoteComponents },
      ],
    }],
  },
  {
    type: "function",
    name: "quoteSellOptimal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "key", type: "tuple", components: poolKeyComponents },
      { name: "sellYes", type: "bool" },
      { name: "outcomeAtoms", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    outputs: [{
      name: "quote",
      type: "tuple",
      components: [
        { name: "outcomeInAtoms", type: "uint256" },
        { name: "swapAtoms", type: "uint256" },
        { name: "collateralAtoms", type: "uint256" },
        { name: "soldRefundAtoms", type: "uint256" },
        { name: "complementRefundAtoms", type: "uint256" },
        { name: "swap", type: "tuple", components: swapQuoteComponents },
      ],
    }],
  },
] as const;

const officialQuoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [{
      name: "params",
      type: "tuple",
      components: [
        { name: "poolKey", type: "tuple", components: poolKeyComponents },
        { name: "zeroForOne", type: "bool" },
        { name: "exactAmount", type: "uint128" },
        { name: "hookData", type: "bytes" },
      ],
    }],
    outputs: [{ name: "amountOut", type: "uint256" }, { name: "gasEstimate", type: "uint256" }],
  },
] as const;

const routerAbi = [
  {
    type: "function",
    name: "buyOutcomeWithPermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "key", type: "tuple", components: poolKeyComponents },
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "buyYes", type: "bool" },
          { name: "collateralAtoms", type: "uint256" },
          { name: "minOutcomeAtoms", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "permitDeadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "sellOutcomeWithPermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "key", type: "tuple", components: poolKeyComponents },
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "sellYes", type: "bool" },
          { name: "outcomeAtoms", type: "uint256" },
          { name: "swapAtoms", type: "uint256" },
          { name: "minCollateralAtoms", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "permitDeadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const chainlinkFeedAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "getRoundData",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint80" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

export type PredictionResolutionRound = Readonly<{
  answer: bigint;
  answeredInRound: bigint;
  roundId: bigint;
  startedAt: bigint;
  updatedAt: bigint;
}>;

export type PredictionResolutionProof = Readonly<{
  after: PredictionResolutionRound;
  before: PredictionResolutionRound;
  blockNumber: bigint;
  expectedCheckpointStatus: "FINAL" | "INVALID";
  expectedMarketState: "FINAL_YES" | "FINAL_NO" | "FINAL_INVALID";
  market: PredictionMarketView;
}>;

export type PredictionActionReceipt = Readonly<{
  blockHash: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
}>;

function hashCode(code: Hex | undefined) {
  return code && code !== "0x" ? keccak256(code) : null;
}

function normalize(value: unknown) {
  return JSON.stringify(value, (_, item: unknown) => {
    if (typeof item === "bigint") return item.toString();
    if (typeof item === "string" && item.startsWith("0x")) return item.toLowerCase();
    return item;
  });
}

function assertSame(primary: unknown, secondary: unknown, label: string) {
  if (normalize(primary) !== normalize(secondary)) {
    throw new Error(`The two Robinhood RPCs disagree about ${label}. Try again after they agree.`);
  }
}

type PredictionConfirmedBlock = Readonly<{
  hash: Hex | null;
  number: bigint | null;
  parentHash: Hex;
  timestamp: bigint;
}>;

function predictionConfirmedBlockIdentity(block: PredictionConfirmedBlock) {
  if (block.hash === null || block.number === null) {
    throw new Error("The confirmed Robinhood block has no canonical identity");
  }
  return {
    hash: block.hash,
    number: block.number,
    parentHash: block.parentHash,
    timestamp: block.timestamp,
  };
}

export function assertPredictionConfirmedBlocksMatch(
  primary: PredictionConfirmedBlock,
  secondary: PredictionConfirmedBlock,
) {
  assertSame(
    predictionConfirmedBlockIdentity(primary),
    predictionConfirmedBlockIdentity(secondary),
    "the confirmed block",
  );
}

function stateName(value: number): PredictionMarketState {
  const states = ["OPEN", "FINAL_YES", "FINAL_NO", "FINAL_INVALID"] as const;
  if (!Number.isInteger(value) || value < 0 || value >= states.length) {
    throw new Error("The market returned an unknown lifecycle state");
  }
  return states[value];
}

function checkpointStatusName(value: number): PredictionCheckpointStatus {
  const states = ["AWAITING", "FINAL", "INVALID"] as const;
  if (!Number.isInteger(value) || value < 0 || value >= states.length) {
    throw new Error("The oracle checkpoint returned an unknown state");
  }
  return states[value];
}

export function predictionYesProbabilityBps(
  sqrtPriceX96: bigint,
  yesIsCurrency0: boolean,
) {
  if (sqrtPriceX96 < MIN_SQRT_PRICE || sqrtPriceX96 > MAX_SQRT_PRICE) {
    throw new Error("The v4 pool price is outside supported bounds");
  }
  const squared = sqrtPriceX96 * sqrtPriceX96;
  const denominator = Q192 + squared;
  const numerator = yesIsCurrency0 ? squared : Q192;
  return Number((numerator * 10_000n + denominator / 2n) / denominator);
}

export function applyPredictionSlippageFloor(amount: bigint, slippageBps: number) {
  if (
    amount <= 0n ||
    !Number.isInteger(slippageBps) ||
    slippageBps < 1 ||
    slippageBps > PREDICTION_MAX_SLIPPAGE_BPS
  ) {
    throw new Error("Trade amount or slippage is invalid");
  }
  const minimum = amount * BigInt(10_000 - slippageBps) / 10_000n;
  return minimum === 0n ? 1n : minimum;
}

export function parsePredictionBuyAmount(value: string) {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,5})?$/u.test(normalized)) return null;
  try {
    const atoms = parseUnits(normalized, PREDICTION_COLLATERAL_DECIMALS);
    return atoms > 0n && atoms <= MAX_BUY_COLLATERAL_ATOMS && atoms % FACE_SCALE === 0n
      ? atoms
      : null;
  } catch {
    return null;
  }
}

export function parsePredictionSellAmount(value: string) {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,5})?$/u.test(normalized)) return null;
  try {
    const atoms = parseUnits(normalized, PREDICTION_OUTCOME_DECIMALS);
    return atoms > 0n && atoms <= UINT128_MAX ? atoms : null;
  } catch {
    return null;
  }
}

export function predictionMarketPageIndices({
  cursor,
  limit,
  marketCount,
}: {
  cursor?: bigint;
  limit: number;
  marketCount: bigint;
}) {
  if (marketCount < 0n || marketCount > UINT256_MAX) {
    throw new Error("Market count is invalid");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Market directory limit must be between 1 and 100");
  }
  if (cursor !== undefined && (cursor < 0n || cursor > UINT256_MAX)) {
    throw new Error("Market directory cursor is invalid");
  }
  const upperBound = cursor === undefined || cursor > marketCount ? marketCount : cursor;
  const count = Number(upperBound < BigInt(limit) ? upperBound : BigInt(limit));
  return {
    indices: Array.from(
      { length: count },
      (_, index) => upperBound - 1n - BigInt(index),
    ),
    nextCursor: upperBound - BigInt(count),
  } as const;
}

async function mapPredictionMarketsInBatches<Input, Output>(
  values: readonly Input[],
  mapper: (value: Input) => Promise<Output>,
) {
  const output: Output[] = [];
  for (
    let index = 0;
    index < values.length;
    index += PREDICTION_DIRECTORY_MARKET_BATCH_SIZE
  ) {
    output.push(
      ...(await Promise.all(
        values
          .slice(index, index + PREDICTION_DIRECTORY_MARKET_BATCH_SIZE)
          .map(mapper),
      )),
    );
  }
  return output;
}

export function formatPredictionUsdg(atoms: bigint) {
  const value = formatUnits(atoms, PREDICTION_COLLATERAL_DECIMALS);
  return `${trimDecimal(value, 6)} USDG`;
}

export function formatPredictionOutcome(atoms: bigint, outcome?: PredictionOutcome) {
  const value = trimDecimal(formatUnits(atoms, PREDICTION_OUTCOME_DECIMALS), 5);
  return outcome ? `${value} ${outcome}` : value;
}

export function predictionMarketRedeemableAtoms({
  noBalanceAtoms,
  state,
  yesBalanceAtoms,
}: Pick<PredictionMarketView, "noBalanceAtoms" | "state" | "yesBalanceAtoms">) {
  if (yesBalanceAtoms < 0n || noBalanceAtoms < 0n) {
    throw new Error("Prediction outcome balances cannot be negative");
  }
  if (state === "FINAL_YES") return yesBalanceAtoms * FACE_SCALE;
  if (state === "FINAL_NO") return noBalanceAtoms * FACE_SCALE;
  if (state === "FINAL_INVALID") {
    return (yesBalanceAtoms + noBalanceAtoms) * FACE_SCALE / 2n;
  }
  return 0n;
}

export function predictionBuyPayoutSummary({
  collateralInAtoms,
  collateralRefundAtoms,
  minOutcomeAtoms,
  outcomeAtoms,
}: Pick<
  PredictionBuyQuote,
  "collateralInAtoms" | "collateralRefundAtoms" | "minOutcomeAtoms" | "outcomeAtoms"
>): PredictionBuyPayoutSummary {
  if (
    collateralInAtoms <= 0n ||
    collateralInAtoms > MAX_BUY_COLLATERAL_ATOMS ||
    collateralInAtoms % FACE_SCALE !== 0n ||
    collateralRefundAtoms < 0n ||
    collateralRefundAtoms >= collateralInAtoms ||
    collateralRefundAtoms % FACE_SCALE !== 0n ||
    outcomeAtoms <= 0n ||
    outcomeAtoms > UINT128_MAX ||
    minOutcomeAtoms <= 0n ||
    minOutcomeAtoms > outcomeAtoms ||
    minOutcomeAtoms > UINT128_MAX
  ) {
    throw new Error("The prediction buy payout quote is invalid");
  }

  const estimatedCostAtoms = collateralInAtoms - collateralRefundAtoms;
  const winningPayoutAtoms = outcomeAtoms * FACE_SCALE;
  const minimumWinningPayoutAtoms = minOutcomeAtoms * FACE_SCALE;
  return {
    estimatedCostAtoms,
    maximumLossAtoms: collateralInAtoms,
    minimumNeutralPayoutAtoms: minOutcomeAtoms * FACE_SCALE / 2n,
    minimumWinningPayoutAtoms,
    minimumWinningProfitAtoms: minimumWinningPayoutAtoms - collateralInAtoms,
    neutralPayoutAtoms: outcomeAtoms * FACE_SCALE / 2n,
    potentialProfitAtoms: winningPayoutAtoms - estimatedCostAtoms,
    winningPayoutAtoms,
  };
}

export function formatPredictionMarketObservation(timestamp: bigint) {
  const date = new Date(Number(timestamp) * 1_000);
  if (!Number.isFinite(date.getTime())) throw new Error("The market result time is invalid");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} at ${hour}:${minute} UTC`;
}

function trimDecimal(value: string, maximumFraction: number) {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.slice(0, maximumFraction).replace(/0+$/u, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function quotePriceBps(collateralAtoms: bigint, outcomeAtoms: bigint) {
  if (collateralAtoms === 0n || outcomeAtoms === 0n) return 0;
  return Number(collateralAtoms * 10_000n / (outcomeAtoms * FACE_SCALE));
}

function priceLimit(zeroForOne: boolean) {
  return zeroForOne ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n;
}

function toPoolKey(key: {
  currency0: Address;
  currency1: Address;
  fee: number;
  hooks: Address;
  tickSpacing: number;
}): PredictionPoolKey {
  return {
    currency0: getAddress(key.currency0),
    currency1: getAddress(key.currency1),
    fee: key.fee,
    hooks: getAddress(key.hooks),
    tickSpacing: key.tickSpacing,
  };
}

async function confirmedBlock(
  clients: ReturnType<typeof createPredictionMarketPublicClients>,
  config: PredictionMarketReleaseConfig,
) {
  const [chainIds, heads] = await Promise.all([
    Promise.all(clients.map((client) => client.getChainId())),
    Promise.all(clients.map((client) => client.getBlockNumber())),
  ]);
  if (chainIds.some((chainId) => chainId !== robinhoodChain.id)) {
    throw new Error("A configured RPC is not serving Robinhood Chain");
  }
  const lowestHead = heads[0] < heads[1] ? heads[0] : heads[1];
  const highestHead = heads[0] > heads[1] ? heads[0] : heads[1];
  if (highestHead - lowestHead > MAX_RPC_HEAD_DIVERGENCE) {
    throw new Error("The two Robinhood RPCs are too far apart for a current market quote");
  }
  if (lowestHead <= CONFIRMATIONS) {
    throw new Error("Robinhood Chain has not reached a usable confirmed block");
  }
  const blockNumber = lowestHead - CONFIRMATIONS;
  if (blockNumber < config.deploymentBlock) {
    throw new Error("The confirmed chain head predates the reviewed release");
  }
  return blockNumber;
}

export async function readPredictionMarketSnapshot({
  clients = createPredictionMarketPublicClients(),
  config,
}: {
  clients?: ReturnType<typeof createPredictionMarketPublicClients>;
  config: PredictionMarketReleaseConfig;
}): Promise<PredictionMarketSnapshot> {
  const blockNumber = await confirmedBlock(clients, config);
  const [release, blocks, counts] = await Promise.all([
    verifiedRelease(clients, config, blockNumber),
    Promise.all(clients.map((client) => client.getBlock({ blockNumber }))),
    Promise.all(
      clients.map((client) =>
        client.readContract({
          address: config.factoryAddress,
          abi: factoryAbi,
          blockNumber,
          functionName: "marketCount",
        }),
      ),
    ),
  ]);
  assertPredictionConfirmedBlocksMatch(blocks[0], blocks[1]);
  assertSame(counts[0], counts[1], "the market count");
  if (blocks[0].hash === null) {
    throw new Error("The confirmed Robinhood block has no canonical hash");
  }
  return {
    blockHash: blocks[0].hash,
    blockNumber,
    blockTimestamp: blocks[0].timestamp,
    marketCount: counts[0],
    router: release.router,
  };
}

async function readReleaseBindings(
  client: PredictionMarketPublicClient,
  config: PredictionMarketReleaseConfig,
  blockNumber: bigint,
): Promise<ReleaseBindings> {
  const [collateral, feed, hook, manager, router, factoryCode, quoterCode, managerCode, multicallCode, protocolQuoterCode, stateViewCode] =
    await Promise.all([
      client.readContract({ address: config.factoryAddress, abi: factoryAbi, blockNumber, functionName: "collateral" }),
      client.readContract({ address: config.factoryAddress, abi: factoryAbi, blockNumber, functionName: "btcUsdPriceFeed" }),
      client.readContract({ address: config.factoryAddress, abi: factoryAbi, blockNumber, functionName: "hook" }),
      client.readContract({ address: config.factoryAddress, abi: factoryAbi, blockNumber, functionName: "manager" }),
      client.readContract({ address: config.factoryAddress, abi: factoryAbi, blockNumber, functionName: "router" }),
      client.getBytecode({ address: config.factoryAddress, blockNumber }),
      client.getBytecode({ address: config.predictionQuoterAddress, blockNumber }),
      client.getBytecode({ address: ROBINHOOD_V4_POOL_MANAGER_ADDRESS, blockNumber }),
      client.getBytecode({ address: ROBINHOOD_MULTICALL3_ADDRESS, blockNumber }),
      client.getBytecode({ address: ROBINHOOD_V4_QUOTER_ADDRESS, blockNumber }),
      client.getBytecode({ address: ROBINHOOD_V4_STATE_VIEW_ADDRESS, blockNumber }),
    ]);
  const [hookCode, routerCode, predictionQuoterFactory, predictionQuoterManager] = await Promise.all([
    client.getBytecode({ address: hook, blockNumber }),
    client.getBytecode({ address: router, blockNumber }),
    client.readContract({ address: config.predictionQuoterAddress, abi: releaseQuoterAbi, blockNumber, functionName: "factory" }),
    client.readContract({ address: config.predictionQuoterAddress, abi: releaseQuoterAbi, blockNumber, functionName: "poolManager" }),
  ]);
  return {
    collateral: getAddress(collateral),
    factoryCodeHash: hashCode(factoryCode),
    feed: getAddress(feed),
    hook: getAddress(hook),
    hookCodeHash: hashCode(hookCode),
    manager: getAddress(manager),
    predictionQuoterCodeHash: hashCode(quoterCode),
    predictionQuoterFactory: getAddress(predictionQuoterFactory),
    predictionQuoterManager: getAddress(predictionQuoterManager),
    protocolManagerCodeHash: hashCode(managerCode),
    protocolMulticallCodeHash: hashCode(multicallCode),
    protocolQuoterCodeHash: hashCode(protocolQuoterCode),
    protocolStateViewCodeHash: hashCode(stateViewCode),
    router: getAddress(router),
    routerCodeHash: hashCode(routerCode),
  };
}

function assertReleaseBindings(bindings: ReleaseBindings, config: PredictionMarketReleaseConfig) {
  if (
    bindings.factoryCodeHash?.toLowerCase() !== config.runtimeCodeHash ||
    bindings.hookCodeHash?.toLowerCase() !== config.hookRuntimeCodeHash ||
    bindings.routerCodeHash?.toLowerCase() !== config.routerRuntimeCodeHash ||
    bindings.predictionQuoterCodeHash?.toLowerCase() !== config.predictionQuoterRuntimeCodeHash
  ) {
    throw new Error("The prediction contracts do not match the reviewed release");
  }
  if (
    bindings.collateral.toLowerCase() !== ROBINHOOD_USDG_ADDRESS.toLowerCase() ||
    bindings.feed.toLowerCase() !== ROBINHOOD_BTC_USD_FEED_ADDRESS.toLowerCase() ||
    bindings.manager.toLowerCase() !== ROBINHOOD_V4_POOL_MANAGER_ADDRESS.toLowerCase() ||
    bindings.predictionQuoterFactory.toLowerCase() !== config.factoryAddress.toLowerCase() ||
    bindings.predictionQuoterManager.toLowerCase() !== ROBINHOOD_V4_POOL_MANAGER_ADDRESS.toLowerCase()
  ) {
    throw new Error("The prediction release has unexpected immutable wiring");
  }
  if (
    bindings.protocolManagerCodeHash?.toLowerCase() !== ROBINHOOD_V4_POOL_MANAGER_RUNTIME_CODE_HASH ||
    bindings.protocolMulticallCodeHash?.toLowerCase() !== ROBINHOOD_MULTICALL3_RUNTIME_CODE_HASH ||
    bindings.protocolQuoterCodeHash?.toLowerCase() !== ROBINHOOD_V4_QUOTER_RUNTIME_CODE_HASH ||
    bindings.protocolStateViewCodeHash?.toLowerCase() !== ROBINHOOD_V4_STATE_VIEW_RUNTIME_CODE_HASH
  ) {
    throw new Error("The official Uniswap v4 read stack does not match the reviewed release");
  }
}

async function verifiedRelease(
  clients: ReturnType<typeof createPredictionMarketPublicClients>,
  config: PredictionMarketReleaseConfig,
  blockNumber: bigint,
) {
  const bindings = await Promise.all(
    clients.map((client) => readReleaseBindings(client, config, blockNumber)),
  );
  assertSame(bindings[0], bindings[1], "the reviewed release");
  assertReleaseBindings(bindings[0], config);
  return bindings[0];
}

async function readMarketAt(
  client: PredictionMarketPublicClient,
  config: PredictionMarketReleaseConfig,
  release: ReleaseBindings,
  semanticKey: Hex,
  blockNumber: bigint,
  account?: Address,
): Promise<PredictionMarketView> {
  const [block, record, rawPoolKey] = await Promise.all([
    client.getBlock({ blockNumber }),
    client.readContract({ address: config.factoryAddress, abi: factoryAbi, blockNumber, functionName: "markets", args: [semanticKey] }),
    client.readContract({ address: config.factoryAddress, abi: factoryAbi, blockNumber, functionName: "getPoolKey", args: [semanticKey] }),
  ]);
  const [vault, checkpoint, poolId] = record;
  if (vault.toLowerCase() === ZERO_ADDRESS || poolId === ZERO_BYTES32) {
    throw new Error("This canonical market does not exist");
  }
  const poolKey = toPoolKey(rawPoolKey);
  const [
    accountedLiabilityAtoms,
    canonicalPoolId,
    vaultCheckpoint,
    collateral,
    cutoff,
    vaultFactory,
    noToken,
    router,
    rawState,
    thresholdAtoms,
    yesToken,
    fallbackChallengeDeadline,
    fallbackRequestedAt,
    hardResolutionDeadline,
    observationTime,
    resolvedPriceAtoms,
    resolutionDeadline,
    rawCheckpointStatus,
    slot0,
    liquidity,
  ] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, blockNumber, functionName: "accountedLiability" }),
    client.readContract({ address: vault, abi: vaultAbi, blockNumber, functionName: "canonicalPoolId" }),
    client.readContract({ address: vault, abi: vaultAbi, blockNumber, functionName: "checkpoint" }),
    client.readContract({ address: vault, abi: vaultAbi, blockNumber, functionName: "collateral" }),
    client.readContract({ address: vault, abi: vaultAbi, blockNumber, functionName: "cutoff" }),
    client.readContract({ address: vault, abi: vaultAbi, blockNumber, functionName: "factory" }),
    client.readContract({ address: vault, abi: vaultAbi, blockNumber, functionName: "noToken" }),
    client.readContract({ address: vault, abi: vaultAbi, blockNumber, functionName: "router" }),
    client.readContract({ address: vault, abi: vaultAbi, blockNumber, functionName: "state" }),
    client.readContract({ address: vault, abi: vaultAbi, blockNumber, functionName: "threshold" }),
    client.readContract({ address: vault, abi: vaultAbi, blockNumber, functionName: "yesToken" }),
    client.readContract({ address: checkpoint, abi: checkpointAbi, blockNumber, functionName: "fallbackChallengeDeadline" }),
    client.readContract({ address: checkpoint, abi: checkpointAbi, blockNumber, functionName: "fallbackRequestedAt" }),
    client.readContract({ address: checkpoint, abi: checkpointAbi, blockNumber, functionName: "hardResolutionDeadline" }),
    client.readContract({ address: checkpoint, abi: checkpointAbi, blockNumber, functionName: "observationTime" }),
    client.readContract({ address: checkpoint, abi: checkpointAbi, blockNumber, functionName: "resolvedPrice" }),
    client.readContract({ address: checkpoint, abi: checkpointAbi, blockNumber, functionName: "resolutionDeadline" }),
    client.readContract({ address: checkpoint, abi: checkpointAbi, blockNumber, functionName: "status" }),
    client.readContract({ address: ROBINHOOD_V4_STATE_VIEW_ADDRESS, abi: stateViewAbi, blockNumber, functionName: "getSlot0", args: [poolId] }),
    client.readContract({ address: ROBINHOOD_V4_STATE_VIEW_ADDRESS, abi: stateViewAbi, blockNumber, functionName: "getLiquidity", args: [poolId] }),
  ]);
  if (
    canonicalPoolId.toLowerCase() !== poolId.toLowerCase() ||
    vaultCheckpoint.toLowerCase() !== checkpoint.toLowerCase() ||
    collateral.toLowerCase() !== ROBINHOOD_USDG_ADDRESS.toLowerCase() ||
    vaultFactory.toLowerCase() !== config.factoryAddress.toLowerCase() ||
    router.toLowerCase() !== release.router.toLowerCase() ||
    poolKey.hooks.toLowerCase() !== release.hook.toLowerCase() ||
    poolKey.fee !== 200 ||
    poolKey.tickSpacing !== 10 ||
    !(
      (poolKey.currency0.toLowerCase() === yesToken.toLowerCase() && poolKey.currency1.toLowerCase() === noToken.toLowerCase()) ||
      (poolKey.currency0.toLowerCase() === noToken.toLowerCase() && poolKey.currency1.toLowerCase() === yesToken.toLowerCase())
    )
  ) {
    throw new Error("The market does not match the canonical factory and v4 pool registry");
  }
  const [yesTokenName, noTokenName, yesBalanceAtoms, noBalanceAtoms] = await Promise.all([
    client.readContract({ address: yesToken, abi: erc20Abi, blockNumber, functionName: "name" }),
    client.readContract({ address: noToken, abi: erc20Abi, blockNumber, functionName: "name" }),
    account
      ? client.readContract({ address: yesToken, abi: erc20Abi, blockNumber, functionName: "balanceOf", args: [account] })
      : Promise.resolve(0n),
    account
      ? client.readContract({ address: noToken, abi: erc20Abi, blockNumber, functionName: "balanceOf", args: [account] })
      : Promise.resolve(0n),
  ]);
  const [sqrtPriceX96, tick, protocolFee] = slot0;
  const yesIsCurrency0 = poolKey.currency0.toLowerCase() === yesToken.toLowerCase();
  return {
    accountedLiabilityAtoms,
    blockNumber,
    blockTimestamp: block.timestamp,
    canonicalPoolId,
    checkpoint: getAddress(checkpoint),
    checkpointStatus: checkpointStatusName(rawCheckpointStatus),
    cutoff: BigInt(cutoff),
    fallbackChallengeDeadline: BigInt(fallbackChallengeDeadline),
    fallbackRequestedAt: BigInt(fallbackRequestedAt),
    hardResolutionDeadline: BigInt(hardResolutionDeadline),
    liquidity,
    noBalanceAtoms,
    noToken: getAddress(noToken),
    noTokenName,
    observationTime: BigInt(observationTime),
    poolId,
    poolKey,
    probabilityYesBps: predictionYesProbabilityBps(sqrtPriceX96, yesIsCurrency0),
    protocolFee,
    resolvedPriceAtoms,
    resolutionDeadline: BigInt(resolutionDeadline),
    router: release.router,
    semanticKey,
    sqrtPriceX96,
    state: stateName(rawState),
    thresholdAtoms,
    tick,
    title: `Will BTC be at or above ${formatPredictionThreshold(thresholdAtoms)} on ${formatPredictionMarketObservation(BigInt(observationTime))}?`,
    vault: getAddress(vault),
    yesBalanceAtoms,
    yesToken: getAddress(yesToken),
    yesTokenName,
  };
}

async function readVerifiedMarket(
  clients: ReturnType<typeof createPredictionMarketPublicClients>,
  config: PredictionMarketReleaseConfig,
  semanticKey: Hex,
  blockNumber: bigint,
  account?: Address,
) {
  const release = await verifiedRelease(clients, config, blockNumber);
  const markets = await Promise.all(
    clients.map((client) => readMarketAt(client, config, release, semanticKey, blockNumber, account)),
  );
  assertSame(markets[0], markets[1], "the market state");
  return markets[0];
}

export async function readPredictionMarketsAtSnapshot({
  account,
  clients = createPredictionMarketPublicClients(),
  config,
  semanticKeys,
  snapshot,
}: {
  account: Address;
  clients?: ReturnType<typeof createPredictionMarketPublicClients>;
  config: PredictionMarketReleaseConfig;
  semanticKeys: readonly string[];
  snapshot: PredictionMarketSnapshot;
}): Promise<PredictionMarketBatchRead> {
  if (!isAddress(account)) throw new Error("The wallet address is invalid");
  if (
    snapshot.blockHash.length !== 66 ||
    snapshot.blockNumber < config.deploymentBlock ||
    snapshot.blockTimestamp <= 0n ||
    snapshot.marketCount < 0n ||
    !isAddress(snapshot.router)
  ) {
    throw new Error("The prediction market snapshot is invalid");
  }
  const keys = [...new Set(semanticKeys.map(requireSemanticKey))];
  const [release, blocks] = await Promise.all([
    verifiedRelease(clients, config, snapshot.blockNumber),
    Promise.all(
      clients.map((client) =>
        client.getBlock({ blockNumber: snapshot.blockNumber }),
      ),
    ),
  ]);
  assertPredictionConfirmedBlocksMatch(blocks[0], blocks[1]);
  assertSame(
    {
      blockHash: blocks[0].hash,
      blockNumber: blocks[0].number,
      blockTimestamp: blocks[0].timestamp,
      marketCount: snapshot.marketCount,
      router: release.router,
    },
    snapshot,
    "the portfolio snapshot",
  );

  const normalizedAccount = getAddress(account);
  const results = await mapPredictionMarketsInBatches(keys, async (semanticKey) => {
    try {
      const markets = await Promise.all(
        clients.map((client) =>
          readMarketAt(
            client,
            config,
            release,
            semanticKey,
            snapshot.blockNumber,
            normalizedAccount,
          ),
        ),
      );
      assertSame(markets[0], markets[1], "the market state");
      return { kind: "market", market: markets[0] } as const;
    } catch (error) {
      return {
        kind: "failure",
        failure: {
          reason: predictionMarketErrorMessage(
            error,
            "Canonical market verification failed",
          ),
          semanticKey,
        },
      } as const;
    }
  });

  const failures: PredictionMarketBatchFailure[] = [];
  const markets: PredictionMarketView[] = [];
  for (const result of results) {
    if (result.kind === "failure") failures.push(result.failure);
    if (result.kind === "market") markets.push(result.market);
  }
  return {
    failures,
    markets,
    snapshot,
  };
}

function requireSemanticKey(value: string) {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new Error("The prediction market key is invalid");
  }
  return value.toLowerCase() as Hex;
}

export async function readPredictionMarket({
  account,
  clients = createPredictionMarketPublicClients(),
  config,
  semanticKey,
}: {
  account?: Address;
  clients?: ReturnType<typeof createPredictionMarketPublicClients>;
  config: PredictionMarketReleaseConfig;
  semanticKey: string;
}) {
  if (account && !isAddress(account)) throw new Error("The wallet address is invalid");
  const key = requireSemanticKey(semanticKey);
  const blockNumber = await confirmedBlock(clients, config);
  return readVerifiedMarket(clients, config, key, blockNumber, account ? getAddress(account) : undefined);
}

export async function readPredictionMarketDirectory({
  account,
  clients = createPredictionMarketPublicClients(),
  config,
  cursor,
  limit = 24,
}: {
  account?: Address;
  clients?: ReturnType<typeof createPredictionMarketPublicClients>;
  config: PredictionMarketReleaseConfig;
  cursor?: bigint;
  limit?: number;
}): Promise<PredictionMarketDirectory> {
  if (account && !isAddress(account)) throw new Error("The wallet address is invalid");
  const blockNumber = await confirmedBlock(clients, config);
  const release = await verifiedRelease(clients, config, blockNumber);
  const [blocks, counts] = await Promise.all([
    Promise.all(clients.map((client) => client.getBlock({ blockNumber }))),
    Promise.all(clients.map((client) => client.readContract({ address: config.factoryAddress, abi: factoryAbi, blockNumber, functionName: "marketCount" }))),
  ]);
  assertPredictionConfirmedBlocksMatch(blocks[0], blocks[1]);
  assertSame(counts[0], counts[1], "the market count");
  const marketCount = counts[0];
  const page = predictionMarketPageIndices({ cursor, limit, marketCount });
  const { indices } = page;
  const keysByClient = await Promise.all(
    clients.map((client) => Promise.all(indices.map((index) => client.readContract({
      address: config.factoryAddress,
      abi: factoryAbi,
      blockNumber,
      functionName: "marketKeyAt",
      args: [index],
    })))),
  );
  assertSame(keysByClient[0], keysByClient[1], "the market directory");
  const marketsByClient = await Promise.all(
    clients.map((client) =>
      mapPredictionMarketsInBatches(keysByClient[0], (key) =>
        readMarketAt(
          client,
          config,
          release,
          key,
          blockNumber,
          account ? getAddress(account) : undefined,
        ),
      ),
    ),
  );
  assertSame(marketsByClient[0], marketsByClient[1], "the market directory state");
  return {
    blockNumber,
    blockTimestamp: blocks[0].timestamp,
    marketCount,
    markets: marketsByClient[0],
    nextCursor: page.nextCursor,
  };
}

function ensureTradable(market: PredictionMarketView) {
  if (market.state !== "OPEN") throw new Error("This market is already final");
  if (market.blockTimestamp >= market.cutoff) {
    throw new Error("Trading is closed for this market");
  }
}

function rawSwapQuote(quote: {
  actualInput: bigint;
  amountOut: bigint;
  sqrtPriceX96After: bigint;
  tickAfter: number;
  protocolFee: number;
  lpFee: number;
}): PredictionSwapQuote {
  return { ...quote };
}

async function simulateOfficialQuote(
  client: PredictionMarketPublicClient,
  market: PredictionMarketView,
  zeroForOne: boolean,
  amountIn: bigint,
  blockNumber: bigint,
) {
  if (amountIn <= 0n || amountIn > UINT128_MAX) {
    throw new Error("The v4 swap amount is outside uint128 bounds");
  }
  const simulation = await client.simulateContract({
    address: ROBINHOOD_V4_QUOTER_ADDRESS,
    abi: officialQuoterAbi,
    blockNumber,
    functionName: "quoteExactInputSingle",
    args: [{
      poolKey: market.poolKey,
      zeroForOne,
      exactAmount: amountIn,
      hookData: "0x",
    }],
  });
  return simulation.result[0];
}

export async function quotePredictionBuy({
  clients = createPredictionMarketPublicClients(),
  collateralAtoms,
  config,
  outcome,
  semanticKey,
  slippageBps = PREDICTION_DEFAULT_SLIPPAGE_BPS,
}: {
  clients?: ReturnType<typeof createPredictionMarketPublicClients>;
  collateralAtoms: bigint;
  config: PredictionMarketReleaseConfig;
  outcome: PredictionOutcome;
  semanticKey: string;
  slippageBps?: number;
}): Promise<PredictionBuyQuote> {
  if (
    collateralAtoms <= 0n ||
    collateralAtoms > MAX_BUY_COLLATERAL_ATOMS ||
    collateralAtoms % FACE_SCALE !== 0n
  ) {
    throw new Error("Buy amount is outside supported bounds or uses more than five USDG decimal places");
  }
  const key = requireSemanticKey(semanticKey);
  const blockNumber = await confirmedBlock(clients, config);
  const market = await readVerifiedMarket(clients, config, key, blockNumber);
  ensureTradable(market);
  const buyYes = outcome === "YES";
  const unwanted = buyYes ? market.noToken : market.yesToken;
  const zeroForOne = market.poolKey.currency0.toLowerCase() === unwanted.toLowerCase();
  const sqrtPriceLimitX96 = priceLimit(zeroForOne);
  const custom = await Promise.all(clients.map((client) => client.simulateContract({
    address: config.predictionQuoterAddress,
    abi: predictionQuoterAbi,
    blockNumber,
    functionName: "quoteBuy",
    args: [market.vault, market.poolKey, buyYes, collateralAtoms, sqrtPriceLimitX96],
  })));
  assertSame(custom[0].result, custom[1].result, "the complete buy quote");
  const quote = custom[0].result;
  const requestedSwapAtoms = collateralAtoms / FACE_SCALE;
  const officialOutputs = await Promise.all(
    clients.map((client) => simulateOfficialQuote(client, market, zeroForOne, requestedSwapAtoms, blockNumber)),
  );
  assertSame(officialOutputs[0], officialOutputs[1], "the official v4 buy quote");
  if (officialOutputs[0] !== quote.swap.amountOut) {
    throw new Error("The market route and official Uniswap v4 quote disagree");
  }
  const yesIsCurrency0 = market.poolKey.currency0.toLowerCase() === market.yesToken.toLowerCase();
  const probabilityAfterBps = predictionYesProbabilityBps(quote.swap.sqrtPriceX96After, yesIsCurrency0);
  const netCollateralAtoms = quote.collateralInAtoms - quote.collateralRefundAtoms;
  return {
    averagePriceBps: quotePriceBps(netCollateralAtoms, quote.outcomeAtoms),
    blockNumber,
    collateralInAtoms: quote.collateralInAtoms,
    collateralRefundAtoms: quote.collateralRefundAtoms,
    market,
    minOutcomeAtoms: applyPredictionSlippageFloor(quote.outcomeAtoms, slippageBps),
    outcome,
    outcomeAtoms: quote.outcomeAtoms,
    priceImpactBps: Math.abs(probabilityAfterBps - market.probabilityYesBps),
    probabilityAfterBps,
    sqrtPriceLimitX96,
    swap: rawSwapQuote(quote.swap),
    zeroForOne,
  };
}

export async function quotePredictionSell({
  clients = createPredictionMarketPublicClients(),
  config,
  outcome,
  outcomeAtoms,
  semanticKey,
  slippageBps = PREDICTION_DEFAULT_SLIPPAGE_BPS,
}: {
  clients?: ReturnType<typeof createPredictionMarketPublicClients>;
  config: PredictionMarketReleaseConfig;
  outcome: PredictionOutcome;
  outcomeAtoms: bigint;
  semanticKey: string;
  slippageBps?: number;
}): Promise<PredictionSellQuote> {
  if (outcomeAtoms <= 0n || outcomeAtoms > UINT128_MAX) {
    throw new Error("Sell amount is outside supported outcome-token bounds");
  }
  const key = requireSemanticKey(semanticKey);
  const blockNumber = await confirmedBlock(clients, config);
  const market = await readVerifiedMarket(clients, config, key, blockNumber);
  ensureTradable(market);
  const sellYes = outcome === "YES";
  const sold = sellYes ? market.yesToken : market.noToken;
  const zeroForOne = market.poolKey.currency0.toLowerCase() === sold.toLowerCase();
  const sqrtPriceLimitX96 = priceLimit(zeroForOne);
  const custom = await Promise.all(clients.map((client) => client.simulateContract({
    address: config.predictionQuoterAddress,
    abi: predictionQuoterAbi,
    blockNumber,
    functionName: "quoteSellOptimal",
    args: [market.vault, market.poolKey, sellYes, outcomeAtoms, sqrtPriceLimitX96],
  })));
  assertSame(custom[0].result, custom[1].result, "the complete sell quote");
  const quote = custom[0].result;
  const officialOutputs = await Promise.all(
    clients.map((client) => simulateOfficialQuote(client, market, zeroForOne, quote.swapAtoms, blockNumber)),
  );
  assertSame(officialOutputs[0], officialOutputs[1], "the official v4 sell quote");
  if (officialOutputs[0] !== quote.swap.amountOut) {
    throw new Error("The market route and official Uniswap v4 quote disagree");
  }
  const yesIsCurrency0 = market.poolKey.currency0.toLowerCase() === market.yesToken.toLowerCase();
  const probabilityAfterBps = predictionYesProbabilityBps(quote.swap.sqrtPriceX96After, yesIsCurrency0);
  return {
    averagePriceBps: quotePriceBps(quote.collateralAtoms, quote.outcomeInAtoms),
    blockNumber,
    collateralAtoms: quote.collateralAtoms,
    complementRefundAtoms: quote.complementRefundAtoms,
    market,
    minCollateralAtoms: applyPredictionSlippageFloor(quote.collateralAtoms, slippageBps),
    outcome,
    outcomeAtoms: quote.outcomeInAtoms,
    priceImpactBps: Math.abs(probabilityAfterBps - market.probabilityYesBps),
    probabilityAfterBps,
    soldRefundAtoms: quote.soldRefundAtoms,
    sqrtPriceLimitX96,
    swap: rawSwapQuote(quote.swap),
    swapAtoms: quote.swapAtoms,
    zeroForOne,
  };
}

function assertPermit(permit: PredictionPermitSignature) {
  if (
    permit.deadline <= 0n ||
    permit.deadline > UINT256_MAX ||
    (permit.v !== 27 && permit.v !== 28) ||
    !/^0x[0-9a-fA-F]{64}$/u.test(permit.r) ||
    !/^0x[0-9a-fA-F]{64}$/u.test(permit.s)
  ) {
    throw new Error("The prediction permit is invalid");
  }
}

async function prepareAction(
  client: PredictionMarketPublicClient,
  owner: Address,
  to: Address,
  data: Hex,
): Promise<PreparedTransaction> {
  const [estimatedGas, gasPriceWei, nativeBalanceWei] = await Promise.all([
    client.estimateGas({ account: owner, data, to, value: 0n }),
    client.getGasPrice(),
    client.getBalance({ address: owner }),
  ]);
  const gasLimit = (estimatedGas * GAS_BUFFER_PERCENT + 99n) / 100n;
  if (gasLimit > MAX_ACTION_GAS) throw new Error("The market action gas estimate exceeds the safety limit");
  if (nativeBalanceWei < gasLimit * gasPriceWei) {
    throw new Error("This wallet does not have enough ETH for the maximum estimated gas");
  }
  return {
    chainId: robinhoodChain.id,
    data,
    gasLimit: gasLimit.toString(),
    kind: "prediction-market-action",
    to,
    value: "0",
  };
}

export async function readPredictionPermitNonce({
  client,
  owner,
  token,
}: {
  client: PredictionMarketPublicClient;
  owner: Address;
  token: Address;
}) {
  if (!isAddress(owner) || !isAddress(token)) throw new Error("Permit addresses are invalid");
  return client.readContract({ address: token, abi: erc20Abi, functionName: "nonces", args: [owner] });
}

export async function readPredictionPermitNonceQuorum({
  clients = createPredictionMarketPublicClients(),
  config,
  owner,
  token,
}: {
  clients?: ReturnType<typeof createPredictionMarketPublicClients>;
  config: PredictionMarketReleaseConfig;
  owner: Address;
  token: Address;
}) {
  if (!isAddress(owner) || !isAddress(token)) throw new Error("Permit addresses are invalid");
  const blockNumber = await confirmedBlock(clients, config);
  await verifiedRelease(clients, config, blockNumber);
  const nonces = await Promise.all(clients.map((client) => client.readContract({
    address: token,
    abi: erc20Abi,
    blockNumber,
    functionName: "nonces",
    args: [owner],
  })));
  assertSame(nonces[0], nonces[1], "the exact permit nonce");
  return { blockNumber, nonce: nonces[0] };
}

export async function preparePredictionBuy({
  client,
  deadline,
  owner,
  permit,
  quote,
}: {
  client: PredictionMarketPublicClient;
  deadline: bigint;
  owner: Address;
  permit: PredictionPermitSignature;
  quote: PredictionBuyQuote;
}) {
  assertPermit(permit);
  if (deadline <= 0n || deadline > permit.deadline) throw new Error("The trade deadline is invalid");
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "buyOutcomeWithPermit",
    args: [
      quote.market.vault,
      quote.market.poolKey,
      {
        buyYes: quote.outcome === "YES",
        collateralAtoms: quote.collateralInAtoms,
        minOutcomeAtoms: quote.minOutcomeAtoms,
        sqrtPriceLimitX96: quote.sqrtPriceLimitX96,
        deadline,
      },
      permit.deadline,
      permit.v,
      permit.r,
      permit.s,
    ],
  });
  return prepareAction(client, getAddress(owner), quote.market.router, data);
}

export async function preparePredictionSell({
  client,
  deadline,
  owner,
  permit,
  quote,
}: {
  client: PredictionMarketPublicClient;
  deadline: bigint;
  owner: Address;
  permit: PredictionPermitSignature;
  quote: PredictionSellQuote;
}) {
  assertPermit(permit);
  if (deadline <= 0n || deadline > permit.deadline) throw new Error("The trade deadline is invalid");
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "sellOutcomeWithPermit",
    args: [
      quote.market.vault,
      quote.market.poolKey,
      {
        sellYes: quote.outcome === "YES",
        outcomeAtoms: quote.outcomeAtoms,
        swapAtoms: quote.swapAtoms,
        minCollateralAtoms: quote.minCollateralAtoms,
        sqrtPriceLimitX96: quote.sqrtPriceLimitX96,
        deadline,
      },
      permit.deadline,
      permit.v,
      permit.r,
      permit.s,
    ],
  });
  return prepareAction(client, getAddress(owner), quote.market.router, data);
}

function compositeRoundId(phaseId: number, aggregatorRoundId: bigint) {
  if (
    !Number.isInteger(phaseId) ||
    phaseId <= 0 ||
    phaseId > 65_535 ||
    aggregatorRoundId <= 0n ||
    aggregatorRoundId > (1n << 64n) - 1n
  ) {
    throw new Error("The Chainlink round identifier is invalid");
  }
  return (BigInt(phaseId) << 64n) | aggregatorRoundId;
}

function parseResolutionRound(
  raw: readonly [bigint, bigint, bigint, bigint, bigint],
  expectedRoundId: bigint,
  blockTimestamp: bigint,
): PredictionResolutionRound {
  const [roundId, answer, startedAt, updatedAt, answeredInRound] = raw;
  if (
    roundId !== expectedRoundId ||
    answer <= 0n ||
    startedAt <= 0n ||
    startedAt > updatedAt ||
    updatedAt <= 0n ||
    updatedAt > blockTimestamp ||
    answeredInRound < roundId
  ) {
    throw new Error("Chainlink returned malformed or incomplete round evidence");
  }
  return { answer, answeredInRound, roundId, startedAt, updatedAt };
}

async function readRoundAcrossProviders(
  clients: ReturnType<typeof createPredictionMarketPublicClients>,
  roundId: bigint,
  blockNumber: bigint,
  blockTimestamp: bigint,
) {
  const raw = await Promise.all(clients.map((client) => client.readContract({
    address: ROBINHOOD_BTC_USD_FEED_ADDRESS,
    abi: chainlinkFeedAbi,
    blockNumber,
    functionName: "getRoundData",
    args: [roundId],
  })));
  assertSame(raw[0], raw[1], `Chainlink round ${roundId}`);
  return parseResolutionRound(raw[0], roundId, blockTimestamp);
}

export async function discoverPredictionResolutionProof({
  clients = createPredictionMarketPublicClients(),
  config,
  semanticKey,
}: {
  clients?: ReturnType<typeof createPredictionMarketPublicClients>;
  config: PredictionMarketReleaseConfig;
  semanticKey: string;
}): Promise<PredictionResolutionProof> {
  const key = requireSemanticKey(semanticKey);
  const blockNumber = await confirmedBlock(clients, config);
  const market = await readVerifiedMarket(clients, config, key, blockNumber);
  if (market.state !== "OPEN") throw new Error("This market is already final");
  if (market.blockTimestamp <= market.observationTime) {
    throw new Error("The result time has not passed on the confirmed chain");
  }
  const phases = await Promise.all(clients.map((client) => client.readContract({
    address: market.checkpoint,
    abi: checkpointAbi,
    blockNumber,
    functionName: "oraclePhaseId",
  })));
  assertSame(phases[0], phases[1], "the checkpoint oracle phase");
  const phaseId = phases[0];
  const latestRaw = await Promise.all(clients.map((client) => client.readContract({
    address: ROBINHOOD_BTC_USD_FEED_ADDRESS,
    abi: chainlinkFeedAbi,
    blockNumber,
    functionName: "latestRoundData",
  })));
  assertSame(latestRaw[0], latestRaw[1], "the latest Chainlink round");
  const latestRoundId = latestRaw[0][0];
  if (Number(latestRoundId >> 64n) !== phaseId) {
    throw new Error("The Chainlink feed phase changed after market creation");
  }
  const latest = parseResolutionRound(
    latestRaw[0],
    latestRoundId,
    market.blockTimestamp,
  );
  if (latest.updatedAt <= market.observationTime) {
    throw new Error("Chainlink has not published the first completed round after the result time");
  }

  let low = 1n;
  let high = latestRoundId & ((1n << 64n) - 1n);
  while (low < high) {
    const middle = low + (high - low) / 2n;
    const round = await readRoundAcrossProviders(
      clients,
      compositeRoundId(phaseId, middle),
      blockNumber,
      market.blockTimestamp,
    );
    if (round.updatedAt > market.observationTime) high = middle;
    else low = middle + 1n;
  }
  if (low <= 1n) {
    throw new Error("No adjacent Chainlink round exists before the result time");
  }
  const afterRoundId = compositeRoundId(phaseId, low);
  const beforeRoundId = compositeRoundId(phaseId, low - 1n);
  const [before, after] = await Promise.all([
    readRoundAcrossProviders(clients, beforeRoundId, blockNumber, market.blockTimestamp),
    readRoundAcrossProviders(clients, afterRoundId, blockNumber, market.blockTimestamp),
  ]);
  if (
    before.updatedAt > market.observationTime ||
    after.updatedAt <= market.observationTime ||
    after.roundId !== before.roundId + 1n
  ) {
    throw new Error("The discovered Chainlink rounds do not uniquely bracket the result time");
  }
  const invalid =
    market.observationTime - before.updatedAt > 25n * 60n * 60n ||
    after.updatedAt - market.observationTime > 25n * 60n * 60n;
  const expectedMarketState = invalid
    ? "FINAL_INVALID"
    : before.answer >= market.thresholdAtoms
      ? "FINAL_YES"
      : "FINAL_NO";
  return {
    after,
    before,
    blockNumber,
    expectedCheckpointStatus: invalid ? "INVALID" : "FINAL",
    expectedMarketState,
    market,
  };
}

export async function preparePredictionResolution({
  client,
  owner,
  proof,
}: {
  client: PredictionMarketPublicClient;
  owner: Address;
  proof: PredictionResolutionProof;
}) {
  const data = encodeFunctionData({
    abi: vaultAbi,
    functionName: "finalizeWithRounds",
    args: [proof.before.roundId, proof.after.roundId],
  });
  return prepareAction(client, getAddress(owner), proof.market.vault, data);
}

export async function preparePredictionRedeem({
  client,
  market,
  owner,
  noAtoms = market.noBalanceAtoms,
  yesAtoms = market.yesBalanceAtoms,
}: {
  client: PredictionMarketPublicClient;
  market: PredictionMarketView;
  owner: Address;
  noAtoms?: bigint;
  yesAtoms?: bigint;
}) {
  if (market.state === "OPEN") throw new Error("The market is not final yet");
  if (yesAtoms < 0n || noAtoms < 0n || (yesAtoms === 0n && noAtoms === 0n)) {
    throw new Error("There are no outcome tokens to redeem");
  }
  if (predictionMarketRedeemableAtoms({
    noBalanceAtoms: noAtoms,
    state: market.state,
    yesBalanceAtoms: yesAtoms,
  }) === 0n) {
    throw new Error("These outcome tokens have no payout to redeem");
  }
  const data = encodeFunctionData({
    abi: vaultAbi,
    functionName: "redeem",
    args: [yesAtoms, noAtoms, getAddress(owner)],
  });
  return prepareAction(client, getAddress(owner), market.vault, data);
}

export type PredictionFallbackAction =
  | "FINALIZE_CHECKPOINT"
  | "FINALIZE_UNAVAILABLE"
  | "REQUEST_UNPROVEN_FALLBACK"
  | "FINALIZE_UNPROVEN";

export async function preparePredictionFallbackAction({
  action,
  client,
  market,
  owner,
}: {
  action: PredictionFallbackAction;
  client: PredictionMarketPublicClient;
  market: PredictionMarketView;
  owner: Address;
}) {
  const functionName = action === "FINALIZE_CHECKPOINT"
    ? "finalizeResolved"
    : action === "FINALIZE_UNAVAILABLE"
      ? "finalizeUnavailable"
      : action === "REQUEST_UNPROVEN_FALLBACK"
        ? "requestUnprovenFallback"
        : "finalizeUnproven";
  const data = encodeFunctionData({ abi: vaultAbi, functionName });
  return prepareAction(client, getAddress(owner), market.vault, data);
}

export async function waitForPredictionAction({
  clients = createPredictionMarketPublicClients(),
  transactionHash,
}: {
  clients?: ReturnType<typeof createPredictionMarketPublicClients>;
  transactionHash: Hex;
}): Promise<PredictionActionReceipt> {
  const receipts = await Promise.all(clients.map((client) => client.waitForTransactionReceipt({
    // Reads deliberately lag the lower RPC head by three blocks. Four receipt
    // confirmations guarantee that an immediate refresh includes this action.
    confirmations: 4,
    hash: transactionHash,
    timeout: 120_000,
  })));
  const evidence = receipts.map((receipt) => ({
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    transactionHash: receipt.transactionHash,
  }));
  assertSame(evidence[0], evidence[1], "the confirmed transaction receipt");
  if (receipts[0].status !== "success") throw new Error("The market transaction reverted");
  return {
    blockHash: receipts[0].blockHash,
    blockNumber: receipts[0].blockNumber,
    transactionHash: receipts[0].transactionHash,
  };
}

export function predictionDirectionalProtocolFee(protocolFee: number, zeroForOne: boolean) {
  if (!Number.isInteger(protocolFee) || protocolFee < 0 || protocolFee > 0xffffff) {
    throw new Error("The v4 protocol fee is invalid");
  }
  return zeroForOne ? protocolFee % 4_096 : protocolFee >> 12;
}

export function formatPredictionPriceAtoms(priceAtoms: bigint) {
  if (priceAtoms <= 0n) return "—";
  return formatPredictionThreshold(priceAtoms);
}

export const predictionMarketInternal = {
  chainlinkFeedAbi,
  checkpointAbi,
  erc20Abi,
  factoryAbi,
  mapPredictionMarketsInBatches,
  vaultAbi,
} as const;
