import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionResult,
  isAddress,
  keccak256,
  parseAbiParameters,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import {
  PREDICTION_PRESET_ASSETS_V2,
  PREDICTION_SOLANA_MAINNET_GENESIS_V2,
  PREDICTION_SOLANA_TOKEN_2022_PROGRAM_V2,
  PREDICTION_SOLANA_TOKEN_PROGRAM_V2,
  predictionOnchainAssetKeyV2,
  type PredictionAssetIdentityV2,
  type PredictionBytes32V2,
} from "../prediction-market-assets-v2";
import {
  PREDICTION_V2_ASSET_REGISTRY_ABI,
  PREDICTION_V2_FACTORY_ABI,
  PREDICTION_V2_QUOTER_ABI,
  type PredictionV2MarketRecord,
  type PredictionV2OraclePolicy,
  type PredictionV2RegistrySnapshot,
} from "./abi";

export const PREDICTION_V2_FACE_SCALE = 10n;
export const PREDICTION_V2_PROTOCOL_FEE_BPS = 10n;
export const PREDICTION_V2_BPS_DENOMINATOR = 10_000n;
export const PREDICTION_V2_BOOTSTRAP_COLLATERAL_ATOMS = 2_000_000n;
export const PREDICTION_V2_LP_FEE_PIPS = 200;
export const PREDICTION_V2_TICK_SPACING = 10;
export const PREDICTION_V2_MIN_SQRT_PRICE_X96 = 4_295_128_739n;
export const PREDICTION_V2_MAX_SQRT_PRICE_X96 =
  1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;

const ZERO_BYTES32 = `0x${"0".repeat(64)}` as PredictionBytes32V2;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const MAX_UINT24 = (1 << 24) - 1;
const MIN_INT24 = -(1 << 23);
const MAX_INT24 = (1 << 23) - 1;
const MAX_UINT128 = (1n << 128n) - 1n;
const GLOBAL_NAMESPACE = stringToHex("GLOBAL_CRYPTO", { size: 32 });
const GLOBAL_CHAIN = stringToHex("GLOBAL", { size: 32 });
const NATIVE_STANDARD = stringToHex("NATIVE", { size: 32 });
const EIP155_NAMESPACE = stringToHex("EIP155", { size: 32 });
const ERC20_STANDARD = stringToHex("ERC20", { size: 32 });
const SOLANA_NAMESPACE = stringToHex("SOLANA", { size: 32 });
const USD_QUOTE = stringToHex("USD", { size: 32 });
const ORACLE_POLICY_HASH_DOMAIN = keccak256(stringToHex("PROGRAMMABLE_ORACLE_POLICY_V2"));
const SNAPSHOT_HASH_DOMAIN = keccak256(stringToHex("PROGRAMMABLE_ASSET_SNAPSHOT_V2"));
const ORACLE_POLICY_HASH_PARAMETERS = parseAbiParameters(
  "bytes32 domain, (bytes32 checkpointKind, address checkpointAdapter, bytes32 checkpointAdapterCodehash, bytes32 feedId, address feedAddress, bytes32 feedProxyCodehash, uint16 feedPhaseId, address feedAggregator, bytes32 feedAggregatorCodehash, bytes32 feedDescriptionHash, uint8 feedDecimals, bytes32 quoteCurrency, bytes32 assetEvidenceHash, uint256 maxOpenInterestAtoms, uint64 validUntil, uint32 policyVersion, bool active) policy",
);
const SNAPSHOT_HASH_PARAMETERS = parseAbiParameters(
  "bytes32 domain, bytes32 assetKey, uint64 revision, bytes32 sourceNamespace, bytes32 sourceChain, bytes32 assetIdentifier, bytes32 assetStandard, bytes32 displaySymbolHash, bytes32 oraclePolicyHash",
);
const SUPPORTED_EVM_CHAINS = new Set([1n, 56n, 4_663n, 8_453n]);

const MARKET_FIELDS = [
  "vault",
  "checkpoint",
  "poolId",
  "marketId",
  "assetKey",
  "registrySnapshotHash",
  "resolutionPolicyHash",
  "registryRevision",
  "policyValidUntil",
  "snapshotAssetCap",
] as const;
const SWAP_FIELDS = [
  "actualInput",
  "amountOut",
  "sqrtPriceX96After",
  "tickAfter",
  "poolManagerProtocolFee",
  "lpFee",
] as const;
const BUY_FIELDS = [
  "requestedCollateralAtoms",
  "maximumPaymentAtoms",
  "executedCollateralAtoms",
  "collateralRefundAtoms",
  "protocolFeeAtoms",
  "feeReserveRefundAtoms",
  "actualPaymentAtoms",
  "outcomeAtoms",
  "swap",
] as const;
const SELL_FIELDS = [
  "outcomeInAtoms",
  "requestedSwapAtoms",
  "grossCollateralAtoms",
  "protocolFeeAtoms",
  "netCollateralAtoms",
  "soldRefundAtoms",
  "complementRefundAtoms",
  "swap",
] as const;
const IDENTITY_FIELDS = [
  "sourceNamespace",
  "sourceChain",
  "assetIdentifier",
  "assetStandard",
] as const;
const POLICY_FIELDS = [
  "checkpointKind",
  "checkpointAdapter",
  "checkpointAdapterCodehash",
  "feedId",
  "feedAddress",
  "feedProxyCodehash",
  "feedPhaseId",
  "feedAggregator",
  "feedAggregatorCodehash",
  "feedDescriptionHash",
  "feedDecimals",
  "quoteCurrency",
  "assetEvidenceHash",
  "maxOpenInterestAtoms",
  "validUntil",
  "policyVersion",
  "active",
] as const;
const SNAPSHOT_FIELDS = [
  "assetKey",
  "revision",
  "identity",
  "displaySymbol",
  "policy",
] as const;

export type PredictionV2SwapQuote = Readonly<{
  actualInput: bigint;
  amountOut: bigint;
  sqrtPriceX96After: bigint;
  tickAfter: number;
  poolManagerProtocolFee: number;
  lpFee: number;
}>;

export type PredictionV2BuyQuote = Readonly<{
  requestedCollateralAtoms: bigint;
  maximumPaymentAtoms: bigint;
  executedCollateralAtoms: bigint;
  collateralRefundAtoms: bigint;
  protocolFeeAtoms: bigint;
  feeReserveRefundAtoms: bigint;
  actualPaymentAtoms: bigint;
  outcomeAtoms: bigint;
  swap: PredictionV2SwapQuote;
}>;

export type PredictionV2SellQuote = Readonly<{
  outcomeInAtoms: bigint;
  requestedSwapAtoms: bigint;
  grossCollateralAtoms: bigint;
  protocolFeeAtoms: bigint;
  netCollateralAtoms: bigint;
  soldRefundAtoms: bigint;
  complementRefundAtoms: bigint;
  swap: PredictionV2SwapQuote;
}>;

function invalid(label: string): never {
  throw new Error(`Invalid Protocol V2 ${label}.`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactTuple(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (Array.isArray(value)) {
    if (value.length !== fields.length) invalid(`${label} tuple length`);
    return Object.fromEntries(fields.map((field, index) => [field, value[index]]));
  }
  if (!isPlainRecord(value)) invalid(`${label} tuple`);
  const keys = Object.keys(value);
  if (keys.length !== fields.length || !fields.every((field) => Object.hasOwn(value, field))) {
    invalid(`${label} tuple fields`);
  }
  return value;
}

function bytes32(value: unknown, label: string, allowZero = false): PredictionBytes32V2 {
  if (typeof value !== "string" || !BYTES32_PATTERN.test(value)) invalid(label);
  const normalized = value.toLowerCase() as PredictionBytes32V2;
  if (!allowZero && normalized === ZERO_BYTES32) invalid(label);
  return normalized;
}

function address(value: unknown, label: string, allowZero = false): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) invalid(label);
  if (!allowZero && value.toLowerCase() === zeroAddress) invalid(label);
  return value as Address;
}

function unsigned(value: unknown, label: string, allowZero = true): bigint {
  if (typeof value !== "bigint" || value < 0n || (!allowZero && value === 0n)) invalid(label);
  return value;
}

function smallUnsigned(value: unknown, max: number, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > max) invalid(label);
  return Number(value);
}

function canonicalDisplaySymbol(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z0-9._-]{1,16}$/u.test(value)) {
    invalid("registry display symbol");
  }
  return value;
}

export function isCanonicalPredictionV2Identity(
  value: unknown,
): value is PredictionAssetIdentityV2 {
  let identity: Record<string, unknown>;
  try {
    identity = exactTuple(value, IDENTITY_FIELDS, "asset identity");
  } catch {
    return false;
  }
  if (!IDENTITY_FIELDS.every((field) => {
    try {
      bytes32(identity[field], `asset identity ${field}`, true);
      return true;
    } catch {
      return false;
    }
  })) return false;

  const sourceNamespace = String(identity.sourceNamespace).toLowerCase();
  const sourceChain = String(identity.sourceChain).toLowerCase();
  const assetIdentifier = String(identity.assetIdentifier).toLowerCase();
  const assetStandard = String(identity.assetStandard).toLowerCase();

  if (sourceNamespace === GLOBAL_NAMESPACE) {
    return sourceChain === GLOBAL_CHAIN && assetStandard === NATIVE_STANDARD &&
      PREDICTION_PRESET_ASSETS_V2.some((preset) =>
        preset.identity.assetIdentifier === assetIdentifier
      );
  }
  if (sourceNamespace === EIP155_NAMESPACE) {
    const chainId = BigInt(sourceChain);
    const addressBits = BigInt(assetIdentifier);
    return SUPPORTED_EVM_CHAINS.has(chainId) && addressBits > 0n &&
      (addressBits >> 160n) === 0n && assetStandard === ERC20_STANDARD;
  }
  if (sourceNamespace === SOLANA_NAMESPACE) {
    return sourceChain === PREDICTION_SOLANA_MAINNET_GENESIS_V2 &&
      assetIdentifier !== ZERO_BYTES32 &&
      (assetStandard === PREDICTION_SOLANA_TOKEN_PROGRAM_V2 ||
        assetStandard === PREDICTION_SOLANA_TOKEN_2022_PROGRAM_V2);
  }
  return false;
}

export function assertCanonicalPredictionV2Identity(
  value: unknown,
): PredictionAssetIdentityV2 {
  if (!isCanonicalPredictionV2Identity(value)) invalid("asset identity");
  const identity = exactTuple(value, IDENTITY_FIELDS, "asset identity");
  return {
    sourceNamespace: bytes32(identity.sourceNamespace, "source namespace"),
    sourceChain: bytes32(identity.sourceChain, "source chain"),
    assetIdentifier: bytes32(identity.assetIdentifier, "asset identifier"),
    assetStandard: bytes32(identity.assetStandard, "asset standard"),
  };
}

function decodeSwapQuote(value: unknown): PredictionV2SwapQuote {
  const swap = exactTuple(value, SWAP_FIELDS, "swap quote");
  const actualInput = unsigned(swap.actualInput, "swap actual input", false);
  const amountOut = unsigned(swap.amountOut, "swap amount out", false);
  const sqrtPriceX96After = unsigned(swap.sqrtPriceX96After, "post-swap price", false);
  if (
    actualInput > MAX_UINT128 || amountOut > MAX_UINT128 ||
    sqrtPriceX96After < PREDICTION_V2_MIN_SQRT_PRICE_X96 ||
    sqrtPriceX96After > PREDICTION_V2_MAX_SQRT_PRICE_X96
  ) invalid("swap bounds");
  const tickAfter = Number(swap.tickAfter);
  if (!Number.isInteger(swap.tickAfter) || tickAfter < MIN_INT24 || tickAfter > MAX_INT24) {
    invalid("post-swap tick");
  }
  const poolManagerProtocolFee = smallUnsigned(
    swap.poolManagerProtocolFee,
    MAX_UINT24,
    "pool manager protocol fee",
  );
  if (
    (poolManagerProtocolFee & 0xfff) > 1_000 ||
    (poolManagerProtocolFee >> 12) > 1_000
  ) invalid("pool manager directional protocol fee");
  const lpFee = smallUnsigned(swap.lpFee, MAX_UINT24, "LP fee");
  if (lpFee !== PREDICTION_V2_LP_FEE_PIPS) invalid("LP fee binding");
  return {
    actualInput,
    amountOut,
    sqrtPriceX96After,
    tickAfter,
    poolManagerProtocolFee,
    lpFee,
  };
}

export function predictionV2FeeFor(collateralAtoms: bigint): bigint {
  if (collateralAtoms < 0n) invalid("fee input");
  return (collateralAtoms * PREDICTION_V2_PROTOCOL_FEE_BPS) /
    PREDICTION_V2_BPS_DENOMINATOR;
}

export function validatePredictionV2BuyQuote(value: unknown): PredictionV2BuyQuote {
  const quote = exactTuple(value, BUY_FIELDS, "buy quote");
  const requestedCollateralAtoms = unsigned(
    quote.requestedCollateralAtoms,
    "requested collateral",
    false,
  );
  if (
    requestedCollateralAtoms % PREDICTION_V2_FACE_SCALE !== 0n ||
    requestedCollateralAtoms / PREDICTION_V2_FACE_SCALE > MAX_UINT128
  ) invalid("requested collateral denomination");
  const maximumPaymentAtoms = unsigned(quote.maximumPaymentAtoms, "maximum payment", false);
  const executedCollateralAtoms = unsigned(
    quote.executedCollateralAtoms,
    "executed collateral",
    false,
  );
  const collateralRefundAtoms = unsigned(quote.collateralRefundAtoms, "collateral refund");
  const protocolFeeAtoms = unsigned(quote.protocolFeeAtoms, "protocol fee");
  const feeReserveRefundAtoms = unsigned(quote.feeReserveRefundAtoms, "fee reserve refund");
  const actualPaymentAtoms = unsigned(quote.actualPaymentAtoms, "actual payment", false);
  const outcomeAtoms = unsigned(quote.outcomeAtoms, "outcome amount", false);
  const swap = decodeSwapQuote(quote.swap);
  const completeSetAtoms = requestedCollateralAtoms / PREDICTION_V2_FACE_SCALE;
  const maximumFeeAtoms = predictionV2FeeFor(requestedCollateralAtoms);
  const expectedExecuted = swap.actualInput * PREDICTION_V2_FACE_SCALE;
  const expectedProtocolFee = predictionV2FeeFor(expectedExecuted);
  if (
    swap.actualInput > completeSetAtoms ||
    maximumPaymentAtoms !== requestedCollateralAtoms + maximumFeeAtoms ||
    executedCollateralAtoms !== expectedExecuted ||
    collateralRefundAtoms !== requestedCollateralAtoms - expectedExecuted ||
    protocolFeeAtoms !== expectedProtocolFee ||
    feeReserveRefundAtoms !== maximumFeeAtoms - expectedProtocolFee ||
    actualPaymentAtoms !== expectedExecuted + expectedProtocolFee ||
    outcomeAtoms !== swap.actualInput + swap.amountOut ||
    maximumPaymentAtoms !== actualPaymentAtoms + collateralRefundAtoms + feeReserveRefundAtoms
  ) invalid("buy accounting");
  return {
    requestedCollateralAtoms,
    maximumPaymentAtoms,
    executedCollateralAtoms,
    collateralRefundAtoms,
    protocolFeeAtoms,
    feeReserveRefundAtoms,
    actualPaymentAtoms,
    outcomeAtoms,
    swap,
  };
}

export function validatePredictionV2SellQuote(value: unknown): PredictionV2SellQuote {
  const quote = exactTuple(value, SELL_FIELDS, "sell quote");
  const outcomeInAtoms = unsigned(quote.outcomeInAtoms, "outcome input", false);
  const requestedSwapAtoms = unsigned(quote.requestedSwapAtoms, "requested swap", false);
  const grossCollateralAtoms = unsigned(quote.grossCollateralAtoms, "gross collateral", false);
  const protocolFeeAtoms = unsigned(quote.protocolFeeAtoms, "protocol fee");
  const netCollateralAtoms = unsigned(quote.netCollateralAtoms, "net collateral", false);
  const soldRefundAtoms = unsigned(quote.soldRefundAtoms, "sold outcome refund");
  const complementRefundAtoms = unsigned(
    quote.complementRefundAtoms,
    "complement outcome refund",
  );
  const swap = decodeSwapQuote(quote.swap);
  if (
    outcomeInAtoms > MAX_UINT128 || requestedSwapAtoms > outcomeInAtoms ||
    swap.actualInput > requestedSwapAtoms || swap.actualInput > outcomeInAtoms
  ) invalid("sell amount bounds");
  const soldRemainder = outcomeInAtoms - swap.actualInput;
  const mergeAtoms = soldRemainder < swap.amountOut ? soldRemainder : swap.amountOut;
  const expectedGross = mergeAtoms * PREDICTION_V2_FACE_SCALE;
  const expectedFee = predictionV2FeeFor(expectedGross);
  if (
    mergeAtoms === 0n ||
    grossCollateralAtoms !== expectedGross ||
    protocolFeeAtoms !== expectedFee ||
    netCollateralAtoms !== expectedGross - expectedFee ||
    soldRefundAtoms !== soldRemainder - mergeAtoms ||
    complementRefundAtoms !== swap.amountOut - mergeAtoms
  ) invalid("sell accounting");
  return {
    outcomeInAtoms,
    requestedSwapAtoms,
    grossCollateralAtoms,
    protocolFeeAtoms,
    netCollateralAtoms,
    soldRefundAtoms,
    complementRefundAtoms,
    swap,
  };
}

export function decodePredictionV2BuyQuote(data: Hex): PredictionV2BuyQuote {
  return validatePredictionV2BuyQuote(decodeFunctionResult({
    abi: PREDICTION_V2_QUOTER_ABI,
    functionName: "quoteBuy",
    data,
  }));
}

export function decodePredictionV2SellQuote(data: Hex): PredictionV2SellQuote {
  return validatePredictionV2SellQuote(decodeFunctionResult({
    abi: PREDICTION_V2_QUOTER_ABI,
    functionName: "quoteSellOptimal",
    data,
  }));
}

export function decodePredictionV2MarketRecord(
  data: Hex,
): PredictionV2MarketRecord | null {
  const raw = decodeFunctionResult({
    abi: PREDICTION_V2_FACTORY_ABI,
    functionName: "markets",
    data,
  });
  const market = exactTuple(raw, MARKET_FIELDS, "market");
  const defaultRecord =
    market.vault === zeroAddress && market.checkpoint === zeroAddress &&
    String(market.poolId).toLowerCase() === ZERO_BYTES32 &&
    String(market.marketId).toLowerCase() === ZERO_BYTES32 &&
    String(market.assetKey).toLowerCase() === ZERO_BYTES32 &&
    String(market.registrySnapshotHash).toLowerCase() === ZERO_BYTES32 &&
    String(market.resolutionPolicyHash).toLowerCase() === ZERO_BYTES32 &&
    market.registryRevision === 0n && market.policyValidUntil === 0n &&
    market.snapshotAssetCap === 0n;
  if (defaultRecord) return null;
  return {
    vault: address(market.vault, "market vault"),
    checkpoint: address(market.checkpoint, "market checkpoint"),
    poolId: bytes32(market.poolId, "market pool id"),
    marketId: bytes32(market.marketId, "market id"),
    assetKey: bytes32(market.assetKey, "market asset key"),
    registrySnapshotHash: bytes32(market.registrySnapshotHash, "registry snapshot hash"),
    resolutionPolicyHash: bytes32(market.resolutionPolicyHash, "resolution policy hash"),
    registryRevision: unsigned(market.registryRevision, "registry revision", false),
    policyValidUntil: unsigned(market.policyValidUntil, "policy validity", false),
    snapshotAssetCap: unsigned(market.snapshotAssetCap, "snapshot asset cap", false),
  };
}

function decodeIdentity(value: unknown): PredictionAssetIdentityV2 {
  return assertCanonicalPredictionV2Identity(value);
}

function decodeOraclePolicy(value: unknown): PredictionV2OraclePolicy {
  const policy = exactTuple(value, POLICY_FIELDS, "oracle policy");
  const checkpointKind = bytes32(policy.checkpointKind, "checkpoint kind");
  const checkpointAdapter = address(policy.checkpointAdapter, "checkpoint adapter");
  const checkpointAdapterCodehash = bytes32(
    policy.checkpointAdapterCodehash,
    "checkpoint adapter codehash",
  );
  const feedId = bytes32(policy.feedId, "feed id", true);
  const feedAddress = address(policy.feedAddress, "feed address", true);
  const feedProxyCodehash = bytes32(policy.feedProxyCodehash, "feed proxy codehash", true);
  const feedPhaseId = smallUnsigned(policy.feedPhaseId, 0xffff, "feed phase id");
  const feedAggregator = address(policy.feedAggregator, "feed aggregator", true);
  const feedAggregatorCodehash = bytes32(
    policy.feedAggregatorCodehash,
    "feed aggregator codehash",
    true,
  );
  const feedDescriptionHash = bytes32(policy.feedDescriptionHash, "feed description hash");
  const feedDecimals = smallUnsigned(policy.feedDecimals, 18, "feed decimals");
  const quoteCurrency = bytes32(policy.quoteCurrency, "quote currency");
  const assetEvidenceHash = bytes32(policy.assetEvidenceHash, "asset evidence hash");
  const maxOpenInterestAtoms = unsigned(
    policy.maxOpenInterestAtoms,
    "maximum open interest",
    false,
  );
  const validUntil = unsigned(policy.validUntil, "policy valid until", false);
  const policyVersion = smallUnsigned(policy.policyVersion, 0xffff_ffff, "policy version");
  if (typeof policy.active !== "boolean") invalid("policy active flag");
  const usesAddressFeed = feedAddress.toLowerCase() !== zeroAddress;
  const usesIdFeed = feedId !== ZERO_BYTES32;
  if (usesAddressFeed === usesIdFeed) invalid("oracle feed reference");
  if (usesAddressFeed) {
    if (
      feedProxyCodehash === ZERO_BYTES32 || feedPhaseId === 0 ||
      feedAggregator.toLowerCase() === zeroAddress ||
      feedAggregatorCodehash === ZERO_BYTES32
    ) invalid("oracle feed phase binding");
  } else if (
    feedProxyCodehash !== ZERO_BYTES32 || feedPhaseId !== 0 ||
    feedAggregator.toLowerCase() !== zeroAddress ||
    feedAggregatorCodehash !== ZERO_BYTES32
  ) invalid("id-based feed binding");
  if (
    feedDecimals === 0 || quoteCurrency !== USD_QUOTE ||
    maxOpenInterestAtoms < PREDICTION_V2_BOOTSTRAP_COLLATERAL_ATOMS ||
    policyVersion === 0
  ) invalid("oracle policy invariants");
  return {
    checkpointKind,
    checkpointAdapter,
    checkpointAdapterCodehash,
    feedId,
    feedAddress,
    feedProxyCodehash,
    feedPhaseId,
    feedAggregator,
    feedAggregatorCodehash,
    feedDescriptionHash,
    feedDecimals,
    quoteCurrency,
    assetEvidenceHash,
    maxOpenInterestAtoms,
    validUntil,
    policyVersion,
    active: policy.active,
  };
}

export function validatePredictionV2RegistrySnapshot(
  value: unknown,
): PredictionV2RegistrySnapshot {
  const snapshot = exactTuple(value, SNAPSHOT_FIELDS, "registry snapshot");
  const identity = decodeIdentity(snapshot.identity);
  const assetKey = bytes32(snapshot.assetKey, "snapshot asset key");
  if (predictionOnchainAssetKeyV2(identity) !== assetKey) {
    invalid("snapshot asset key binding");
  }
  const displaySymbol = canonicalDisplaySymbol(snapshot.displaySymbol);
  const preset = PREDICTION_PRESET_ASSETS_V2.find(({ identity: candidate }) =>
    candidate.assetIdentifier === identity.assetIdentifier &&
    identity.sourceNamespace === GLOBAL_NAMESPACE
  );
  if (preset && displaySymbol !== preset.symbol) invalid("preset display symbol binding");
  return {
    assetKey,
    revision: unsigned(snapshot.revision, "snapshot revision", false),
    identity,
    displaySymbol,
    policy: decodeOraclePolicy(snapshot.policy),
  };
}

export function predictionV2OraclePolicyHash(
  value: PredictionV2OraclePolicy,
): PredictionBytes32V2 {
  const policy = decodeOraclePolicy(value);
  return keccak256(encodeAbiParameters(ORACLE_POLICY_HASH_PARAMETERS, [
    ORACLE_POLICY_HASH_DOMAIN,
    policy,
  ])) as PredictionBytes32V2;
}

export function predictionV2RegistrySnapshotHash(
  value: PredictionV2RegistrySnapshot,
): PredictionBytes32V2 {
  const snapshot = validatePredictionV2RegistrySnapshot(value);
  return keccak256(encodeAbiParameters(SNAPSHOT_HASH_PARAMETERS, [
    SNAPSHOT_HASH_DOMAIN,
    snapshot.assetKey,
    snapshot.revision,
    snapshot.identity.sourceNamespace,
    snapshot.identity.sourceChain,
    snapshot.identity.assetIdentifier,
    snapshot.identity.assetStandard,
    keccak256(stringToHex(snapshot.displaySymbol)),
    predictionV2OraclePolicyHash(snapshot.policy),
  ])) as PredictionBytes32V2;
}

export function decodePredictionV2RegistrySnapshot(
  data: Hex,
  functionName: "getSnapshot" | "latestSnapshot" | "requireActiveAsset",
): PredictionV2RegistrySnapshot {
  const snapshot = validatePredictionV2RegistrySnapshot(decodeFunctionResult({
    abi: PREDICTION_V2_ASSET_REGISTRY_ABI,
    functionName,
    data,
  }));
  const canonical = encodeFunctionResult({
    abi: PREDICTION_V2_ASSET_REGISTRY_ABI,
    functionName,
    result: snapshot,
  });
  if (canonical.toLowerCase() !== data.toLowerCase()) {
    invalid("registry snapshot result canonicality");
  }
  if (functionName === "requireActiveAsset" && !snapshot.policy.active) {
    invalid("active registry snapshot");
  }
  return snapshot;
}
