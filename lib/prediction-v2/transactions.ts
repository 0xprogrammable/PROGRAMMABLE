import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  encodeFunctionResult,
  isAddress,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import {
  predictionAssetIdentityCandidatesV2,
  predictionAssetSelectionKeyV2,
  predictionOnchainAssetKeyV2,
  type PredictionAssetIdentityV2,
  type PredictionAssetSelectionV2,
  type PredictionBytes32V2,
} from "../prediction-market-assets-v2";
import {
  PREDICTION_V2_EXECUTION_ROUTER_ABI,
  PREDICTION_V2_EXPOSURE_CONTROLLER_ABI,
  PREDICTION_V2_FACTORY_ABI,
  PREDICTION_V2_QUOTER_ABI,
  PREDICTION_V2_VAULT_ABI,
  type PredictionV2PoolKey,
  type PredictionV2RegistrySnapshot,
} from "./abi";
import {
  bindPredictionV2MarketState,
  predictionV2BuyPreview,
  predictionV2SellPreview,
  predictionV2SlippageFloor,
  requirePredictionV2PriceImpactConfirmation,
  type PredictionV2BoundMarketState,
} from "./accounting";
import {
  PREDICTION_V2_BOOTSTRAP_COLLATERAL_ATOMS,
  PREDICTION_V2_LP_FEE_PIPS,
  PREDICTION_V2_MAX_SQRT_PRICE_X96,
  PREDICTION_V2_MIN_SQRT_PRICE_X96,
  PREDICTION_V2_TICK_SPACING,
  assertCanonicalPredictionV2Identity,
  predictionV2RegistrySnapshotHash,
  validatePredictionV2BuyQuote,
  validatePredictionV2RegistrySnapshot,
  validatePredictionV2SellQuote,
  type PredictionV2BuyQuote,
  type PredictionV2SellQuote,
} from "./codec";

const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_UINT80 = (1n << 80n) - 1n;
const MAX_INT192 = (1n << 191n) - 1n;
const MINIMUM_MARKET_DURATION_SECONDS = 24n * 60n * 60n;
const MAXIMUM_MARKET_DURATION_SECONDS = 30n * 24n * 60n * 60n;

export type PredictionV2PermitSignature = Readonly<{
  value: bigint;
  deadline: bigint;
  v: 27 | 28;
  r: PredictionBytes32V2;
  s: PredictionBytes32V2;
}>;

export type PredictionV2PreparedTransaction = Readonly<{
  chainId: 4_663;
  to: Address;
  data: Hex;
  value: 0n;
}>;

export type PredictionV2PreparedCreate = PredictionV2PreparedTransaction & Readonly<{
  selectionKey: string;
  onchainAssetKey: PredictionBytes32V2;
  registryRevision: bigint;
  registrySnapshotHash: PredictionBytes32V2;
  expectedMarketId: PredictionBytes32V2;
  registrySnapshot: PredictionV2RegistrySnapshot;
}>;

type PredictionV2QuoteContextBase = Readonly<{
  chainId: 4_663;
  quoter: Address;
  vault: Address;
  poolKey: PredictionV2PoolKey;
  sqrtPriceLimitX96: bigint;
  observedBlockNumber: bigint;
  observedBlockHash: PredictionBytes32V2;
  marketState: PredictionV2BoundMarketState;
}>;

export type PredictionV2BuyQuoteIntent = Readonly<{
  quoter: Address;
  poolManager: Address;
  vault: Address;
  poolKey: PredictionV2PoolKey;
  buyYes: boolean;
  requestedCollateralAtoms: bigint;
  sqrtPriceLimitX96: bigint;
}>;

export type PredictionV2SellQuoteIntent = Readonly<{
  quoter: Address;
  poolManager: Address;
  vault: Address;
  poolKey: PredictionV2PoolKey;
  sellYes: boolean;
  outcomeAtoms: bigint;
  sqrtPriceLimitX96: bigint;
}>;

export type PredictionV2BoundBuyQuote = PredictionV2QuoteContextBase & Readonly<{
  buyYes: boolean;
  requestedCollateralAtoms: bigint;
  quoteCall: Readonly<{ to: Address; data: Hex }>;
  quoteResult: Hex;
  quote: PredictionV2BuyQuote;
}>;

export type PredictionV2BoundSellQuote = PredictionV2QuoteContextBase & Readonly<{
  sellYes: boolean;
  outcomeAtoms: bigint;
  quoteCall: Readonly<{ to: Address; data: Hex }>;
  quoteResult: Hex;
  quote: PredictionV2SellQuote;
}>;

export type PredictionV2BoundBuyCapacityPreflight = Readonly<{
  chainId: 4_663;
  exposureController: Address;
  vault: Address;
  /** Full split notional, not the possibly smaller executed collateral. */
  delta: bigint;
  observedBlockNumber: bigint;
  observedBlockHash: PredictionBytes32V2;
  vaultExposureControllerCall: Readonly<{ to: Address; data: Hex }>;
  vaultExposureControllerResult: Hex;
  capacityCall: Readonly<{ to: Address; data: Hex }>;
  capacityResult: "0x";
}>;

function fail(label: string): never {
  throw new Error(`Invalid Protocol V2 ${label}.`);
}

function nonzeroAddress(value: unknown, label: string): Address {
  if (
    typeof value !== "string" || !isAddress(value, { strict: false }) ||
    value.toLowerCase() === zeroAddress
  ) fail(label);
  return value as Address;
}

function nonzeroBytes32(value: unknown, label: string): PredictionBytes32V2 {
  if (
    typeof value !== "string" || !BYTES32_PATTERN.test(value) ||
    value.toLowerCase() === ZERO_BYTES32
  ) fail(label);
  return value.toLowerCase() as PredictionBytes32V2;
}

function sameIdentity(
  left: PredictionAssetIdentityV2,
  right: PredictionAssetIdentityV2,
) {
  return left.sourceNamespace === right.sourceNamespace &&
    left.sourceChain === right.sourceChain &&
    left.assetIdentifier === right.assetIdentifier &&
    left.assetStandard === right.assetStandard;
}

function samePoolKey(left: PredictionV2PoolKey, right: PredictionV2PoolKey) {
  return left.currency0.toLowerCase() === right.currency0.toLowerCase() &&
    left.currency1.toLowerCase() === right.currency1.toLowerCase() &&
    left.fee === right.fee && left.tickSpacing === right.tickSpacing &&
    left.hooks.toLowerCase() === right.hooks.toLowerCase();
}

function validateNow(value: bigint) {
  if (value <= 0n || value > MAX_UINT32) fail("current timestamp");
}

function validateDeadline(deadline: bigint, nowUnixSeconds: bigint, label: string) {
  if (deadline <= nowUnixSeconds) fail(`${label} deadline`);
}

function validateSqrtPriceLimit(value: bigint) {
  if (
    value <= PREDICTION_V2_MIN_SQRT_PRICE_X96 ||
    value >= PREDICTION_V2_MAX_SQRT_PRICE_X96
  ) fail("sqrt price limit");
}

function validateQuoteBlock(input: Readonly<{
  observedBlockNumber: bigint;
  observedBlockHash: PredictionBytes32V2;
  latestConfirmedBlockNumber: bigint;
  maximumQuoteAgeBlocks: number;
}>) {
  const observedBlockHash = nonzeroBytes32(input.observedBlockHash, "quote block hash");
  if (
    input.observedBlockNumber <= 0n || input.latestConfirmedBlockNumber < input.observedBlockNumber ||
    !Number.isInteger(input.maximumQuoteAgeBlocks) || input.maximumQuoteAgeBlocks < 0 ||
    input.maximumQuoteAgeBlocks > 10 ||
    input.latestConfirmedBlockNumber - input.observedBlockNumber > BigInt(input.maximumQuoteAgeBlocks)
  ) fail("quote freshness");
  return observedBlockHash;
}

export function validatePredictionV2PoolKey(value: PredictionV2PoolKey): PredictionV2PoolKey {
  const currency0 = nonzeroAddress(value.currency0, "currency0");
  const currency1 = nonzeroAddress(value.currency1, "currency1");
  const hooks = nonzeroAddress(value.hooks, "hook");
  if (currency0.toLowerCase() === currency1.toLowerCase()) fail("pool currencies");
  if (value.fee !== PREDICTION_V2_LP_FEE_PIPS) fail("pool LP fee binding");
  if (value.tickSpacing !== PREDICTION_V2_TICK_SPACING) fail("pool tick spacing binding");
  return { currency0, currency1, fee: value.fee, tickSpacing: value.tickSpacing, hooks };
}

function validatePermit(
  permit: PredictionV2PermitSignature,
  expectedValue: bigint,
  nowUnixSeconds: bigint,
  minimumDeadline?: bigint,
) {
  if (permit.value !== expectedValue) fail("permit amount");
  validateDeadline(permit.deadline, nowUnixSeconds, "permit");
  if (minimumDeadline !== undefined && permit.deadline < minimumDeadline) {
    fail("permit/trade deadline ordering");
  }
  if (permit.v !== 27 && permit.v !== 28) fail("permit recovery id");
  return {
    ...permit,
    r: nonzeroBytes32(permit.r, "permit r"),
    s: nonzeroBytes32(permit.s, "permit s"),
  };
}

export function encodePredictionV2BuyQuoteCall(input: Readonly<{
  vault: Address;
  poolKey: PredictionV2PoolKey;
  buyYes: boolean;
  requestedCollateralAtoms: bigint;
  sqrtPriceLimitX96: bigint;
}>): Hex {
  const vault = nonzeroAddress(input.vault, "quote vault");
  const poolKey = validatePredictionV2PoolKey(input.poolKey);
  if (
    input.requestedCollateralAtoms <= 0n ||
    input.requestedCollateralAtoms % 10n !== 0n
  ) fail("quote collateral amount");
  validateSqrtPriceLimit(input.sqrtPriceLimitX96);
  return encodeFunctionData({
    abi: PREDICTION_V2_QUOTER_ABI,
    functionName: "quoteBuy",
    args: [
      vault,
      poolKey,
      input.buyYes,
      input.requestedCollateralAtoms,
      input.sqrtPriceLimitX96,
    ],
  });
}

export function encodePredictionV2SellQuoteCall(input: Readonly<{
  vault: Address;
  poolKey: PredictionV2PoolKey;
  sellYes: boolean;
  outcomeAtoms: bigint;
  sqrtPriceLimitX96: bigint;
}>): Hex {
  const vault = nonzeroAddress(input.vault, "quote vault");
  const poolKey = validatePredictionV2PoolKey(input.poolKey);
  if (input.outcomeAtoms <= 0n || input.outcomeAtoms > (1n << 128n) - 1n) {
    fail("quote outcome amount");
  }
  validateSqrtPriceLimit(input.sqrtPriceLimitX96);
  return encodeFunctionData({
    abi: PREDICTION_V2_QUOTER_ABI,
    functionName: "quoteSellOptimal",
    args: [vault, poolKey, input.sellYes, input.outcomeAtoms, input.sqrtPriceLimitX96],
  });
}

export function encodePredictionV2VaultExposureControllerCall(): Hex {
  return encodeFunctionData({
    abi: PREDICTION_V2_VAULT_ABI,
    functionName: "exposureController",
  });
}

export function decodePredictionV2VaultExposureController(
  data: Hex,
): Address {
  if (!/^0x0{24}[0-9a-fA-F]{40}$/u.test(data)) {
    fail("vault exposure controller result");
  }
  try {
    return nonzeroAddress(decodeFunctionResult({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName: "exposureController",
      data,
    }), "vault exposure controller");
  } catch {
    fail("vault exposure controller result");
  }
}

export function encodePredictionV2RequireIncreaseCapacityCall(input: Readonly<{
  vault: Address;
  delta: bigint;
}>): Hex {
  const vault = nonzeroAddress(input.vault, "capacity vault");
  if (input.delta <= 0n) fail("capacity delta");
  return encodeFunctionData({
    abi: PREDICTION_V2_EXPOSURE_CONTROLLER_ABI,
    functionName: "requireIncreaseCapacity",
    args: [vault, input.delta],
  });
}

export function bindPredictionV2BuyQuote(input: Readonly<{
  chainId: 4_663;
  quoter: Address;
  vault: Address;
  poolKey: PredictionV2PoolKey;
  buyYes: boolean;
  requestedCollateralAtoms: bigint;
  sqrtPriceLimitX96: bigint;
  observedBlockNumber: bigint;
  observedBlockHash: PredictionBytes32V2;
  marketState: PredictionV2BoundMarketState;
  quoteCall: Readonly<{ to: Address; data: Hex }>;
  quoteResult: Hex;
}>): PredictionV2BoundBuyQuote {
  if (input.chainId !== 4_663) fail("quote chain");
  const quoter = nonzeroAddress(input.quoter, "quoter");
  const vault = nonzeroAddress(input.vault, "quote vault");
  const poolKey = validatePredictionV2PoolKey(input.poolKey);
  validateSqrtPriceLimit(input.sqrtPriceLimitX96);
  if (input.observedBlockNumber <= 0n) fail("quote block number");
  const observedBlockHash = nonzeroBytes32(input.observedBlockHash, "quote block hash");
  const marketState = bindPredictionV2MarketState(input.marketState);
  if (
    marketState.chainId !== input.chainId ||
    marketState.vault.toLowerCase() !== vault.toLowerCase() ||
    !samePoolKey(marketState.poolKey, poolKey) ||
    marketState.observedBlockNumber !== input.observedBlockNumber ||
    marketState.observedBlockHash !== observedBlockHash
  ) fail("buy quote/market-state binding");
  const expectedQuoteCall = encodePredictionV2BuyQuoteCall({
    vault,
    poolKey,
    buyYes: input.buyYes,
    requestedCollateralAtoms: input.requestedCollateralAtoms,
    sqrtPriceLimitX96: input.sqrtPriceLimitX96,
  });
  const quoteCallTarget = nonzeroAddress(input.quoteCall.to, "buy quote call target");
  if (
    quoteCallTarget.toLowerCase() !== quoter.toLowerCase() ||
    input.quoteCall.data !== expectedQuoteCall
  ) fail("buy quote call binding");
  let decodedQuote: unknown;
  try {
    decodedQuote = decodeFunctionResult({
      abi: PREDICTION_V2_QUOTER_ABI,
      functionName: "quoteBuy",
      data: input.quoteResult,
    });
  } catch {
    fail("buy quote result");
  }
  const quote = validatePredictionV2BuyQuote(decodedQuote);
  const canonicalQuoteResult = encodeFunctionResult({
    abi: PREDICTION_V2_QUOTER_ABI,
    functionName: "quoteBuy",
    result: quote,
  });
  if (canonicalQuoteResult.toLowerCase() !== input.quoteResult.toLowerCase()) {
    fail("buy quote result canonicality");
  }
  if (
    input.requestedCollateralAtoms !== quote.requestedCollateralAtoms ||
    input.requestedCollateralAtoms <= 0n
  ) fail("buy quote amount binding");
  const boundQuote: PredictionV2BoundBuyQuote = {
    chainId: 4_663,
    quoter,
    vault,
    poolKey,
    buyYes: input.buyYes,
    requestedCollateralAtoms: input.requestedCollateralAtoms,
    sqrtPriceLimitX96: input.sqrtPriceLimitX96,
    observedBlockNumber: input.observedBlockNumber,
    observedBlockHash,
    marketState,
    quoteCall: { to: quoteCallTarget, data: input.quoteCall.data },
    quoteResult: input.quoteResult,
    quote,
  };
  predictionV2BuyPreview({ boundQuote, slippageBps: 1 });
  return boundQuote;
}

export function bindPredictionV2SellQuote(input: Readonly<{
  chainId: 4_663;
  quoter: Address;
  vault: Address;
  poolKey: PredictionV2PoolKey;
  sellYes: boolean;
  outcomeAtoms: bigint;
  sqrtPriceLimitX96: bigint;
  observedBlockNumber: bigint;
  observedBlockHash: PredictionBytes32V2;
  marketState: PredictionV2BoundMarketState;
  quoteCall: Readonly<{ to: Address; data: Hex }>;
  quoteResult: Hex;
}>): PredictionV2BoundSellQuote {
  if (input.chainId !== 4_663) fail("quote chain");
  const quoter = nonzeroAddress(input.quoter, "quoter");
  const vault = nonzeroAddress(input.vault, "quote vault");
  const poolKey = validatePredictionV2PoolKey(input.poolKey);
  validateSqrtPriceLimit(input.sqrtPriceLimitX96);
  if (input.observedBlockNumber <= 0n) fail("quote block number");
  const observedBlockHash = nonzeroBytes32(input.observedBlockHash, "quote block hash");
  const marketState = bindPredictionV2MarketState(input.marketState);
  if (
    marketState.chainId !== input.chainId ||
    marketState.vault.toLowerCase() !== vault.toLowerCase() ||
    !samePoolKey(marketState.poolKey, poolKey) ||
    marketState.observedBlockNumber !== input.observedBlockNumber ||
    marketState.observedBlockHash !== observedBlockHash
  ) fail("sell quote/market-state binding");
  const expectedQuoteCall = encodePredictionV2SellQuoteCall({
    vault,
    poolKey,
    sellYes: input.sellYes,
    outcomeAtoms: input.outcomeAtoms,
    sqrtPriceLimitX96: input.sqrtPriceLimitX96,
  });
  const quoteCallTarget = nonzeroAddress(input.quoteCall.to, "sell quote call target");
  if (
    quoteCallTarget.toLowerCase() !== quoter.toLowerCase() ||
    input.quoteCall.data !== expectedQuoteCall
  ) fail("sell quote call binding");
  let decodedQuote: unknown;
  try {
    decodedQuote = decodeFunctionResult({
      abi: PREDICTION_V2_QUOTER_ABI,
      functionName: "quoteSellOptimal",
      data: input.quoteResult,
    });
  } catch {
    fail("sell quote result");
  }
  const quote = validatePredictionV2SellQuote(decodedQuote);
  const canonicalQuoteResult = encodeFunctionResult({
    abi: PREDICTION_V2_QUOTER_ABI,
    functionName: "quoteSellOptimal",
    result: quote,
  });
  if (canonicalQuoteResult.toLowerCase() !== input.quoteResult.toLowerCase()) {
    fail("sell quote result canonicality");
  }
  if (input.outcomeAtoms !== quote.outcomeInAtoms || input.outcomeAtoms <= 0n) {
    fail("sell quote amount binding");
  }
  const boundQuote: PredictionV2BoundSellQuote = {
    chainId: 4_663,
    quoter,
    vault,
    poolKey,
    sellYes: input.sellYes,
    outcomeAtoms: input.outcomeAtoms,
    sqrtPriceLimitX96: input.sqrtPriceLimitX96,
    observedBlockNumber: input.observedBlockNumber,
    observedBlockHash,
    marketState,
    quoteCall: { to: quoteCallTarget, data: input.quoteCall.data },
    quoteResult: input.quoteResult,
    quote,
  };
  predictionV2SellPreview({ boundQuote, slippageBps: 1 });
  return boundQuote;
}

/**
 * Binds two successful eth_calls at the quote's exact confirmed block:
 * vault.exposureController() and controller.requireIncreaseCapacity(vault, requestedCollateral).
 * This is a pre-sign diagnostic only; execution rechecks capacity atomically and can still race.
 */
export function bindPredictionV2BuyCapacityPreflight(input: Readonly<{
  boundQuote: PredictionV2BoundBuyQuote;
  observedBlockNumber: bigint;
  observedBlockHash: PredictionBytes32V2;
  vaultExposureControllerCall: Readonly<{ to: Address; data: Hex }>;
  vaultExposureControllerResult: Hex;
  capacityCall: Readonly<{ to: Address; data: Hex }>;
  capacityResult: Hex;
}>): PredictionV2BoundBuyCapacityPreflight {
  const boundQuote = bindPredictionV2BuyQuote(input.boundQuote);
  if (!boundQuote.marketState.checkpointTradingHealthy) {
    fail("checkpoint trading health");
  }
  const observedBlockHash = nonzeroBytes32(input.observedBlockHash, "capacity block hash");
  if (
    input.observedBlockNumber !== boundQuote.observedBlockNumber ||
    observedBlockHash !== boundQuote.observedBlockHash
  ) fail("capacity/quote block binding");
  const vaultExposureControllerCallTarget = nonzeroAddress(
    input.vaultExposureControllerCall.to,
    "exposure controller read target",
  );
  if (
    vaultExposureControllerCallTarget.toLowerCase() !== boundQuote.vault.toLowerCase() ||
    input.vaultExposureControllerCall.data !== encodePredictionV2VaultExposureControllerCall()
  ) fail("exposure controller read binding");
  const exposureController = decodePredictionV2VaultExposureController(
    input.vaultExposureControllerResult,
  );
  const capacityCallTarget = nonzeroAddress(
    input.capacityCall.to,
    "capacity read target",
  );
  const expectedCapacityCall = encodePredictionV2RequireIncreaseCapacityCall({
    vault: boundQuote.vault,
    delta: boundQuote.requestedCollateralAtoms,
  });
  if (
    capacityCallTarget.toLowerCase() !== exposureController.toLowerCase() ||
    input.capacityCall.data !== expectedCapacityCall
  ) fail("capacity call binding");
  if (input.capacityResult !== "0x") fail("capacity result");
  return {
    chainId: 4_663,
    exposureController,
    vault: boundQuote.vault,
    delta: boundQuote.requestedCollateralAtoms,
    observedBlockNumber: boundQuote.observedBlockNumber,
    observedBlockHash: boundQuote.observedBlockHash,
    vaultExposureControllerCall: {
      to: vaultExposureControllerCallTarget,
      data: input.vaultExposureControllerCall.data,
    },
    vaultExposureControllerResult: input.vaultExposureControllerResult,
    capacityCall: {
      to: capacityCallTarget,
      data: input.capacityCall.data,
    },
    capacityResult: "0x",
  };
}

export function preparePredictionV2BuyWithPermit(input: Readonly<{
  router: Address;
  boundQuote: PredictionV2BoundBuyQuote;
  capacityPreflight: PredictionV2BoundBuyCapacityPreflight;
  intent: PredictionV2BuyQuoteIntent;
  latestConfirmedBlockNumber: bigint;
  maximumQuoteAgeBlocks: number;
  slippageBps: number;
  tradeDeadline: bigint;
  permit: PredictionV2PermitSignature;
  explicitlyConfirmedHighPriceImpact: boolean;
  nowUnixSeconds: bigint;
}>): PredictionV2PreparedTransaction {
  validateNow(input.nowUnixSeconds);
  const router = nonzeroAddress(input.router, "router");
  const boundQuote = bindPredictionV2BuyQuote(input.boundQuote);
  const capacityPreflight = bindPredictionV2BuyCapacityPreflight({
    boundQuote,
    observedBlockNumber: input.capacityPreflight.observedBlockNumber,
    observedBlockHash: input.capacityPreflight.observedBlockHash,
    vaultExposureControllerCall: input.capacityPreflight.vaultExposureControllerCall,
    vaultExposureControllerResult: input.capacityPreflight.vaultExposureControllerResult,
    capacityCall: input.capacityPreflight.capacityCall,
    capacityResult: input.capacityPreflight.capacityResult,
  });
  if (
    input.capacityPreflight.chainId !== 4_663 ||
    capacityPreflight.exposureController.toLowerCase() !==
      input.capacityPreflight.exposureController.toLowerCase() ||
    capacityPreflight.vault.toLowerCase() !== input.capacityPreflight.vault.toLowerCase() ||
    capacityPreflight.delta !== input.capacityPreflight.delta ||
    capacityPreflight.vault.toLowerCase() !== boundQuote.vault.toLowerCase() ||
    capacityPreflight.delta !== boundQuote.requestedCollateralAtoms
  ) fail("capacity preflight binding");
  const intent = {
    ...input.intent,
    quoter: nonzeroAddress(input.intent.quoter, "intended quoter"),
    poolManager: nonzeroAddress(input.intent.poolManager, "intended PoolManager"),
    vault: nonzeroAddress(input.intent.vault, "intended vault"),
    poolKey: validatePredictionV2PoolKey(input.intent.poolKey),
  };
  validateSqrtPriceLimit(intent.sqrtPriceLimitX96);
  if (
    boundQuote.quoter.toLowerCase() !== intent.quoter.toLowerCase() ||
    boundQuote.marketState.poolManager.toLowerCase() !== intent.poolManager.toLowerCase() ||
    boundQuote.vault.toLowerCase() !== intent.vault.toLowerCase() ||
    !samePoolKey(boundQuote.poolKey, intent.poolKey) ||
    boundQuote.buyYes !== intent.buyYes ||
    boundQuote.requestedCollateralAtoms !== intent.requestedCollateralAtoms ||
    boundQuote.sqrtPriceLimitX96 !== intent.sqrtPriceLimitX96
  ) fail("buy quote intent binding");
  validateQuoteBlock({
    observedBlockNumber: boundQuote.observedBlockNumber,
    observedBlockHash: boundQuote.observedBlockHash,
    latestConfirmedBlockNumber: input.latestConfirmedBlockNumber,
    maximumQuoteAgeBlocks: input.maximumQuoteAgeBlocks,
  });
  const quote = boundQuote.quote;
  validateDeadline(input.tradeDeadline, input.nowUnixSeconds, "trade");
  const permit = validatePermit(
    input.permit,
    quote.maximumPaymentAtoms,
    input.nowUnixSeconds,
    input.tradeDeadline,
  );
  const minOutcomeAtoms = predictionV2SlippageFloor(quote.outcomeAtoms, input.slippageBps);
  const preview = predictionV2BuyPreview({ boundQuote, slippageBps: input.slippageBps });
  requirePredictionV2PriceImpactConfirmation(
    preview.priceImpact.probabilityPointMagnitudeBps,
    input.explicitlyConfirmedHighPriceImpact,
  );
  return {
    chainId: 4_663,
    to: router,
    value: 0n,
    data: encodeFunctionData({
      abi: PREDICTION_V2_EXECUTION_ROUTER_ABI,
      functionName: "buyOutcomeWithPermit",
      args: [
        boundQuote.vault,
        boundQuote.poolKey,
        {
          buyYes: boundQuote.buyYes,
          collateralAtoms: quote.requestedCollateralAtoms,
          minOutcomeAtoms,
          sqrtPriceLimitX96: boundQuote.sqrtPriceLimitX96,
          deadline: input.tradeDeadline,
        },
        permit.deadline,
        permit.v,
        permit.r,
        permit.s,
      ],
    }),
  };
}

export function preparePredictionV2SellWithPermit(input: Readonly<{
  router: Address;
  boundQuote: PredictionV2BoundSellQuote;
  intent: PredictionV2SellQuoteIntent;
  latestConfirmedBlockNumber: bigint;
  maximumQuoteAgeBlocks: number;
  slippageBps: number;
  tradeDeadline: bigint;
  permit: PredictionV2PermitSignature;
  explicitlyConfirmedHighPriceImpact: boolean;
  nowUnixSeconds: bigint;
}>): PredictionV2PreparedTransaction {
  validateNow(input.nowUnixSeconds);
  const router = nonzeroAddress(input.router, "router");
  const boundQuote = bindPredictionV2SellQuote(input.boundQuote);
  if (!boundQuote.marketState.checkpointTradingHealthy) {
    fail("checkpoint trading health");
  }
  const intent = {
    ...input.intent,
    quoter: nonzeroAddress(input.intent.quoter, "intended quoter"),
    poolManager: nonzeroAddress(input.intent.poolManager, "intended PoolManager"),
    vault: nonzeroAddress(input.intent.vault, "intended vault"),
    poolKey: validatePredictionV2PoolKey(input.intent.poolKey),
  };
  validateSqrtPriceLimit(intent.sqrtPriceLimitX96);
  if (
    boundQuote.quoter.toLowerCase() !== intent.quoter.toLowerCase() ||
    boundQuote.marketState.poolManager.toLowerCase() !== intent.poolManager.toLowerCase() ||
    boundQuote.vault.toLowerCase() !== intent.vault.toLowerCase() ||
    !samePoolKey(boundQuote.poolKey, intent.poolKey) ||
    boundQuote.sellYes !== intent.sellYes ||
    boundQuote.outcomeAtoms !== intent.outcomeAtoms ||
    boundQuote.sqrtPriceLimitX96 !== intent.sqrtPriceLimitX96
  ) fail("sell quote intent binding");
  validateQuoteBlock({
    observedBlockNumber: boundQuote.observedBlockNumber,
    observedBlockHash: boundQuote.observedBlockHash,
    latestConfirmedBlockNumber: input.latestConfirmedBlockNumber,
    maximumQuoteAgeBlocks: input.maximumQuoteAgeBlocks,
  });
  const quote = boundQuote.quote;
  validateDeadline(input.tradeDeadline, input.nowUnixSeconds, "trade");
  const permit = validatePermit(
    input.permit,
    quote.outcomeInAtoms,
    input.nowUnixSeconds,
    input.tradeDeadline,
  );
  const minCollateralAtoms = predictionV2SlippageFloor(
    quote.netCollateralAtoms,
    input.slippageBps,
  );
  const preview = predictionV2SellPreview({ boundQuote, slippageBps: input.slippageBps });
  requirePredictionV2PriceImpactConfirmation(
    preview.priceImpact.probabilityPointMagnitudeBps,
    input.explicitlyConfirmedHighPriceImpact,
  );
  return {
    chainId: 4_663,
    to: router,
    value: 0n,
    data: encodeFunctionData({
      abi: PREDICTION_V2_EXECUTION_ROUTER_ABI,
      functionName: "sellOutcomeWithPermit",
      args: [
        boundQuote.vault,
        boundQuote.poolKey,
        {
          sellYes: boundQuote.sellYes,
          outcomeAtoms: quote.outcomeInAtoms,
          swapAtoms: quote.requestedSwapAtoms,
          minCollateralAtoms,
          sqrtPriceLimitX96: boundQuote.sqrtPriceLimitX96,
          deadline: input.tradeDeadline,
        },
        permit.deadline,
        permit.v,
        permit.r,
        permit.s,
      ],
    }),
  };
}

export function preparePredictionV2CreateWithPermit(input: Readonly<{
  factory: Address;
  selection: PredictionAssetSelectionV2;
  identity: PredictionAssetIdentityV2;
  onchainAssetKey: PredictionBytes32V2;
  registrySnapshot: PredictionV2RegistrySnapshot;
  /** Exact result of AssetRegistryV2.hashSnapshot(snapshot) from the bound read. */
  registryHashSnapshotResult: PredictionBytes32V2;
  /** Snapshot hash returned by Factory.activeMarketId for these create parameters. */
  factoryActiveSnapshotHash: PredictionBytes32V2;
  /** Market id returned by that same Factory.activeMarketId call. */
  factoryActiveMarketId: PredictionBytes32V2;
  /** Registry revision returned by that same Factory.activeMarketId call. */
  factoryActiveRegistryRevision: bigint;
  /** Snapshot hash pinned by the UI release registry. */
  releaseRegistrySnapshotHash: PredictionBytes32V2;
  observationTime: bigint;
  threshold: bigint;
  permit: PredictionV2PermitSignature;
  nowUnixSeconds: bigint;
}>): PredictionV2PreparedCreate {
  validateNow(input.nowUnixSeconds);
  const factory = nonzeroAddress(input.factory, "factory");
  const selectionKey = predictionAssetSelectionKeyV2(input.selection);
  if (!selectionKey) fail("asset selection");
  const identity = assertCanonicalPredictionV2Identity(input.identity);
  if (!predictionAssetIdentityCandidatesV2(input.selection).some((candidate) =>
    sameIdentity(candidate, identity)
  )) fail("selection/identity binding");
  const onchainAssetKey = nonzeroBytes32(input.onchainAssetKey, "onchain asset key");
  if (predictionOnchainAssetKeyV2(identity) !== onchainAssetKey) fail("onchain asset key binding");
  const registrySnapshot = validatePredictionV2RegistrySnapshot(input.registrySnapshot);
  if (
    registrySnapshot.assetKey !== onchainAssetKey ||
    !sameIdentity(registrySnapshot.identity, identity) ||
    !registrySnapshot.policy.active
  ) fail("registry snapshot binding");
  const computedSnapshotHash = predictionV2RegistrySnapshotHash(registrySnapshot);
  const registryHashSnapshotResult = nonzeroBytes32(
    input.registryHashSnapshotResult,
    "Registry hashSnapshot result",
  );
  const factoryActiveSnapshotHash = nonzeroBytes32(
    input.factoryActiveSnapshotHash,
    "Factory active snapshot hash",
  );
  const releaseRegistrySnapshotHash = nonzeroBytes32(
    input.releaseRegistrySnapshotHash,
    "release Registry snapshot hash",
  );
  const factoryActiveMarketId = nonzeroBytes32(
    input.factoryActiveMarketId,
    "Factory active market id",
  );
  if (
    registryHashSnapshotResult !== computedSnapshotHash ||
    factoryActiveSnapshotHash !== computedSnapshotHash ||
    releaseRegistrySnapshotHash !== computedSnapshotHash ||
    input.factoryActiveRegistryRevision !== registrySnapshot.revision
  ) fail("Registry snapshot hash binding");
  if (
    input.observationTime <= input.nowUnixSeconds + MINIMUM_MARKET_DURATION_SECONDS ||
    input.observationTime > input.nowUnixSeconds + MAXIMUM_MARKET_DURATION_SECONDS ||
    input.observationTime > MAX_UINT32 ||
    input.observationTime > registrySnapshot.policy.validUntil
  ) fail("observation time");
  if (input.threshold <= 0n || input.threshold > MAX_INT192) fail("threshold");
  const permit = validatePermit(
    input.permit,
    PREDICTION_V2_BOOTSTRAP_COLLATERAL_ATOMS,
    input.nowUnixSeconds,
  );
  return {
    chainId: 4_663,
    to: factory,
    value: 0n,
    selectionKey,
    onchainAssetKey,
    registryRevision: registrySnapshot.revision,
    registrySnapshotHash: computedSnapshotHash,
    expectedMarketId: factoryActiveMarketId,
    registrySnapshot,
    data: encodeFunctionData({
      abi: PREDICTION_V2_FACTORY_ABI,
      functionName: "createMarketWithPermit",
      args: [
        identity,
        Number(input.observationTime),
        input.threshold,
        factoryActiveMarketId,
        permit.deadline,
        permit.v,
        permit.r,
        permit.s,
      ],
    }),
  };
}

export function encodePredictionV2ChainlinkRoundProof(input: Readonly<{
  beforeRoundId: bigint;
  afterRoundId: bigint;
}>): Hex {
  const beforePhase = input.beforeRoundId >> 64n;
  const afterPhase = input.afterRoundId >> 64n;
  const beforeAggregatorRound = input.beforeRoundId & ((1n << 64n) - 1n);
  const afterAggregatorRound = input.afterRoundId & ((1n << 64n) - 1n);
  const samePhaseAdjacent = afterPhase === beforePhase &&
    afterAggregatorRound === beforeAggregatorRound + 1n;
  if (
    input.beforeRoundId <= 0n || input.beforeRoundId > MAX_UINT80 ||
    input.afterRoundId <= 0n || input.afterRoundId > MAX_UINT80 ||
    beforePhase === 0n || beforeAggregatorRound === 0n ||
    !samePhaseAdjacent
  ) fail("Chainlink round proof");
  return encodeAbiParameters(
    parseAbiParameters("uint80 beforeRoundId, uint80 afterRoundId"),
    [input.beforeRoundId, input.afterRoundId],
  );
}

export function preparePredictionV2FinalizeWithChainlinkRounds(input: Readonly<{
  vault: Address;
  beforeRoundId: bigint;
  afterRoundId: bigint;
}>): PredictionV2PreparedTransaction {
  const vault = nonzeroAddress(input.vault, "finalize vault");
  const proof = encodePredictionV2ChainlinkRoundProof(input);
  return {
    chainId: 4_663,
    to: vault,
    value: 0n,
    data: encodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName: "finalize",
      args: [proof],
    }),
  };
}

function preparePredictionV2VaultNoArg(
  vaultInput: Address,
  functionName:
    | "finalizeUnavailable"
    | "requestUnprovenFallback"
    | "finalizeUnproven"
    | "finalizeResolved",
): PredictionV2PreparedTransaction {
  const vault = nonzeroAddress(vaultInput, `${functionName} vault`);
  return {
    chainId: 4_663,
    to: vault,
    value: 0n,
    data: encodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName,
    }),
  };
}

export function preparePredictionV2FinalizeUnavailable(
  vault: Address,
): PredictionV2PreparedTransaction {
  return preparePredictionV2VaultNoArg(vault, "finalizeUnavailable");
}

export function preparePredictionV2RequestUnprovenFallback(
  vault: Address,
): PredictionV2PreparedTransaction {
  return preparePredictionV2VaultNoArg(vault, "requestUnprovenFallback");
}

export function preparePredictionV2FinalizeUnproven(
  vault: Address,
): PredictionV2PreparedTransaction {
  return preparePredictionV2VaultNoArg(vault, "finalizeUnproven");
}

export function preparePredictionV2FinalizeResolved(
  vault: Address,
): PredictionV2PreparedTransaction {
  return preparePredictionV2VaultNoArg(vault, "finalizeResolved");
}

function validateRedemption(input: Readonly<{
  yesAtoms: bigint;
  noAtoms: bigint;
  recipient: Address;
}>) {
  if (input.yesAtoms < 0n || input.noAtoms < 0n ||
    (input.yesAtoms === 0n && input.noAtoms === 0n)) fail("redemption amount");
  return nonzeroAddress(input.recipient, "redemption recipient");
}

export function preparePredictionV2Redeem(input: Readonly<{
  vault: Address;
  yesAtoms: bigint;
  noAtoms: bigint;
  recipient: Address;
}>): PredictionV2PreparedTransaction {
  const vault = nonzeroAddress(input.vault, "redeem vault");
  const recipient = validateRedemption(input);
  return {
    chainId: 4_663,
    to: vault,
    value: 0n,
    data: encodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName: "redeem",
      args: [input.yesAtoms, input.noAtoms, recipient],
    }),
  };
}

export function preparePredictionV2FinalizeAndRedeemWithChainlinkRounds(
  input: Readonly<{
    vault: Address;
    beforeRoundId: bigint;
    afterRoundId: bigint;
    yesAtoms: bigint;
    noAtoms: bigint;
    recipient: Address;
  }>,
): PredictionV2PreparedTransaction {
  const vault = nonzeroAddress(input.vault, "finalize and redeem vault");
  const recipient = validateRedemption(input);
  const proof = encodePredictionV2ChainlinkRoundProof(input);
  return {
    chainId: 4_663,
    to: vault,
    value: 0n,
    data: encodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName: "finalizeAndRedeem",
      args: [proof, input.yesAtoms, input.noAtoms, recipient],
    }),
  };
}
