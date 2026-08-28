import "server-only";

import { getAddress } from "viem";

import type {
  DiscoverableLaunchMarketV2,
  DiscoverableMarketTradeCapabilityV1,
} from "../../custom-launch/contract-v2";
import { parseDiscoverableMarketTradeCapabilityV1 } from
  "../../custom-launch/trade-capability-v1";
import { computeOfficialV4PoolId } from
  "../../uniswap/liquidity-launcher-sdk";
import type { JsonValue } from "../projection-target/canonical-json";
import { canonicalSha256 } from "../projection-target/hashing";

export const FINALIZED_TRADE_ADAPTER_DESCRIPTOR_SCHEMA_V1 =
  "programmable.finalized-trade-adapter-descriptor.v1" as const;
export const FINALIZED_TRADE_ADAPTER_PROJECT_SCHEMA_V1 =
  "programmable.finalized-trade-adapter-project.v1" as const;
export const FINALIZED_TRADE_ADAPTER_VERIFIER_V1 =
  "programmable-server-trade-route-review:v1" as const;

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const HASH32 = /^0x[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,255}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const SIGNED_DECIMAL = /^-?(?:0|[1-9][0-9]*)$/u;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]+$/u;
const ROUTER_MARKET_ID = /^router-v1-[0-9a-f]{64}$/u;

type Sha256Digest = `sha256:${string}`;
type Hash32 = `0x${string}`;
type Address = `0x${string}`;
type JsonRecord = { readonly [key: string]: JsonValue };

export type FinalizedTradeAdapterAssetV1 = Readonly<{
  assetId: string;
  identity: Readonly<{ namespace: "eip155:1"; value: Address }>;
  name: string;
  symbol: string;
  decimals: number;
}>;

export type FinalizedTradeAdapterRuntimeTargetV1 = Readonly<{
  targetId: string;
  kind: "token" | "hook" | "other";
  identity: Readonly<{ namespace: "eip155:1"; value: Address }>;
  runtimeCodeKeccak256: Hash32;
  runtimeCodeSha256: Sha256Digest;
}>;

export type FinalizedTradeAdapterBindingContextV1 = Readonly<{
  routerLaunchId: Hash32;
  router: Address;
  token: Address;
  hook: Address;
  poolManager: Address;
  poolId: Hash32;
  artifactHash: Sha256Digest;
  graphBundleHash: Sha256Digest;
  finality: Readonly<{
    transactionHash: Hash32;
    blockNumber: string;
    blockHash: Hash32;
    logIndex: number;
  }>;
}>;

export type FinalizedTradeAdapterDescriptorV1 = Readonly<{
  schemaVersion: typeof FINALIZED_TRADE_ADAPTER_DESCRIPTOR_SCHEMA_V1;
  status: "verified";
  adapterId: "uniswap-v4-universal-router-exact-input:v1";
  projectId: Sha256Digest;
  chainProfileId: string;
  chainProfileHash: Sha256Digest;
  market: Readonly<DiscoverableLaunchMarketV2> & Readonly<{
    tradeCapability: Readonly<DiscoverableMarketTradeCapabilityV1>;
  }>;
  baseAsset: FinalizedTradeAdapterAssetV1;
  quoteAsset: FinalizedTradeAdapterAssetV1;
  runtimeTargets: readonly FinalizedTradeAdapterRuntimeTargetV1[];
  serverVerification: Readonly<{
    verifierAdapterId: typeof FINALIZED_TRADE_ADAPTER_VERIFIER_V1;
    verifiedAt: string;
    evidenceHash: Sha256Digest;
  }>;
  descriptorDigest: Sha256Digest;
}>;

type DescriptorCoreV1 = Omit<
  FinalizedTradeAdapterDescriptorV1,
  "descriptorDigest"
>;

export function finalizedTradeAdapterMarketIdV1(routerLaunchId: string) {
  return `router-v1-${routerLaunchId.slice(2).toLowerCase()}`;
}

export function isFinalizedTradeAdapterMarketIdV1(value: string) {
  return ROUTER_MARKET_ID.test(value);
}

export function finalizedTradeAdapterProjectIdV1(
  context: FinalizedTradeAdapterBindingContextV1,
) {
  return canonicalSha256(FINALIZED_TRADE_ADAPTER_PROJECT_SCHEMA_V1, context);
}

function record(value: JsonValue | undefined): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function exactRecord(
  value: JsonValue | undefined,
  keys: readonly string[],
): JsonRecord | null {
  const candidate = record(value);
  if (candidate === null) return null;
  const actual = Object.keys(candidate).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
      && actual.every((key, index) => key === expected[index])
    ? candidate
    : null;
}

function digest(value: JsonValue | undefined): Sha256Digest | null {
  return typeof value === "string" && DIGEST.test(value)
    ? value as Sha256Digest
    : null;
}

function hash32(value: JsonValue | undefined): Hash32 | null {
  return typeof value === "string" && HASH32.test(value)
    ? value as Hash32
    : null;
}

function address(value: JsonValue | undefined): Address | null {
  return typeof value === "string" && ADDRESS.test(value)
    ? value as Address
    : null;
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function identity(
  value: JsonValue | undefined,
): Readonly<{ namespace: "eip155:1"; value: Address }> | null {
  const candidate = exactRecord(value, ["namespace", "value"]);
  const valueAddress = candidate ? address(candidate.value) : null;
  return candidate?.namespace === "eip155:1" && valueAddress
    ? Object.freeze({ namespace: "eip155:1" as const, value: valueAddress })
    : null;
}

function text(
  value: JsonValue | undefined,
  minimum: number,
  maximum: number,
) {
  return typeof value === "string"
      && value === value.trim()
      && value.length >= minimum
      && value.length <= maximum
      && SAFE_TEXT.test(value)
    ? value
    : null;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function parseAssetV1(
  value: JsonValue | undefined,
): FinalizedTradeAdapterAssetV1 | null {
  const candidate = exactRecord(value, [
    "assetId", "decimals", "identity", "name", "symbol",
  ]);
  const assetIdentity = candidate ? identity(candidate.identity) : null;
  const name = candidate ? text(candidate.name, 1, 64) : null;
  const symbol = candidate ? text(candidate.symbol, 1, 32) : null;
  if (
    candidate === null
    || typeof candidate.assetId !== "string"
    || !IDENTIFIER.test(candidate.assetId)
    || assetIdentity === null
    || name === null
    || symbol === null
    || !Number.isSafeInteger(candidate.decimals)
    || Number(candidate.decimals) < 0
    || Number(candidate.decimals) > 255
  ) return null;
  return deepFreeze({
    assetId: candidate.assetId,
    identity: assetIdentity,
    name,
    symbol,
    decimals: Number(candidate.decimals),
  });
}

function parseRuntimeTargetsV1(
  value: JsonValue | undefined,
  context: FinalizedTradeAdapterBindingContextV1,
): readonly FinalizedTradeAdapterRuntimeTargetV1[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 64) {
    return null;
  }
  const targets: FinalizedTradeAdapterRuntimeTargetV1[] = [];
  const targetIds = new Set<string>();
  const addresses = new Set<string>();
  let previousTargetId = "";
  for (const item of value) {
    const candidate = exactRecord(item, [
      "identity", "kind", "runtimeCodeKeccak256", "runtimeCodeSha256",
      "targetId",
    ]);
    const targetIdentity = candidate ? identity(candidate.identity) : null;
    const runtimeCodeKeccak256 = candidate
      ? hash32(candidate.runtimeCodeKeccak256)
      : null;
    const runtimeCodeSha256 = candidate
      ? digest(candidate.runtimeCodeSha256)
      : null;
    if (
      candidate === null
      || typeof candidate.targetId !== "string"
      || !IDENTIFIER.test(candidate.targetId)
      || candidate.targetId <= previousTargetId
      || (candidate.kind !== "token"
        && candidate.kind !== "hook"
        && candidate.kind !== "other")
      || targetIdentity === null
      || runtimeCodeKeccak256 === null
      || runtimeCodeSha256 === null
      || targetIds.has(candidate.targetId)
      || addresses.has(targetIdentity.value)
    ) return null;
    previousTargetId = candidate.targetId;
    targetIds.add(candidate.targetId);
    addresses.add(targetIdentity.value);
    targets.push(deepFreeze({
      targetId: candidate.targetId,
      kind: candidate.kind,
      identity: targetIdentity,
      runtimeCodeKeccak256,
      runtimeCodeSha256,
    }));
  }
  const tokens = targets.filter(({ kind }) => kind === "token");
  const hooks = targets.filter(({ kind }) => kind === "hook");
  if (
    tokens.length !== 1
    || hooks.length !== 1
    || !sameHex(tokens[0]!.identity.value, context.token)
    || !sameHex(hooks[0]!.identity.value, context.hook)
  ) return null;
  return Object.freeze(targets);
}

function parseMarketV1(
  value: JsonValue | undefined,
  input: Readonly<{
    context: FinalizedTradeAdapterBindingContextV1;
    chainProfileId: string;
    chainProfileHash: Sha256Digest;
    baseAsset: FinalizedTradeAdapterAssetV1;
    quoteAsset: FinalizedTradeAdapterAssetV1;
  }>,
): FinalizedTradeAdapterDescriptorV1["market"] | null {
  const market = exactRecord(value, [
    "baseAssetId", "kind", "marketAssetId", "marketEvidenceHash", "marketId",
    "quoteAssetId", "status", "tradeCapability", "uniswapV4", "verification",
  ]);
  if (
    market === null
    || typeof market.marketId !== "string"
    || market.marketId !== finalizedTradeAdapterMarketIdV1(
      input.context.routerLaunchId,
    )
    || typeof market.kind !== "string"
    || !IDENTIFIER.test(market.kind)
    || typeof market.marketAssetId !== "string"
    || !IDENTIFIER.test(market.marketAssetId)
    || market.baseAssetId !== input.baseAsset.assetId
    || market.quoteAssetId !== input.quoteAsset.assetId
    || market.status !== "active"
    || digest(market.marketEvidenceHash) === null
  ) return null;

  const verification = exactRecord(market.verification, [
    "status", "verifierAdapterId", "verifierBindingHash",
  ]);
  if (
    verification === null
    || verification.status !== "verified"
    || typeof verification.verifierAdapterId !== "string"
    || !IDENTIFIER.test(verification.verifierAdapterId)
    || digest(verification.verifierBindingHash) === null
  ) return null;

  const pool = exactRecord(market.uniswapV4, [
    "currency0AssetId", "currency1AssetId", "dynamicFee", "feeRaw",
    "hooksAssetId", "poolId", "poolKeyEvidenceHash", "poolManager",
    "poolManagerInterfaceEvidenceBindingHash",
    "poolManagerReviewEvidenceBindingHash", "poolManagerRuntimeCodeKeccak256",
    "poolManagerRuntimeCodeSha256", "tickSpacing",
  ]);
  const poolManager = pool ? identity(pool.poolManager) : null;
  const poolId = pool ? hash32(pool.poolId) : null;
  const poolManagerRuntimeCodeKeccak256 = pool
    ? hash32(pool.poolManagerRuntimeCodeKeccak256)
    : null;
  const poolManagerRuntimeCodeSha256 = pool
    ? digest(pool.poolManagerRuntimeCodeSha256)
    : null;
  if (
    pool === null
    || poolManager === null
    || poolId === null
    || !sameHex(poolManager.value, input.context.poolManager)
    || !sameHex(poolId, input.context.poolId)
    || typeof pool.currency0AssetId !== "string"
    || typeof pool.currency1AssetId !== "string"
    || !IDENTIFIER.test(pool.currency0AssetId)
    || !IDENTIFIER.test(pool.currency1AssetId)
    || typeof pool.feeRaw !== "string"
    || !DECIMAL.test(pool.feeRaw)
    || BigInt(pool.feeRaw) > 0xff_ffffn
    || typeof pool.tickSpacing !== "string"
    || !SIGNED_DECIMAL.test(pool.tickSpacing)
    || BigInt(pool.tickSpacing) < -0x80_0000n
    || BigInt(pool.tickSpacing) > 0x7f_ffffn
    || typeof pool.dynamicFee !== "boolean"
    || pool.dynamicFee !== (BigInt(pool.feeRaw) === 0x80_0000n)
    || (pool.hooksAssetId !== null
      && (typeof pool.hooksAssetId !== "string"
        || !IDENTIFIER.test(pool.hooksAssetId)))
    || digest(pool.poolKeyEvidenceHash) === null
    || digest(pool.poolManagerInterfaceEvidenceBindingHash) === null
    || digest(pool.poolManagerReviewEvidenceBindingHash) === null
    || poolManagerRuntimeCodeKeccak256 === null
    || poolManagerRuntimeCodeSha256 === null
  ) return null;

  const capability = parseDiscoverableMarketTradeCapabilityV1({
    value: market.tradeCapability,
    chainId: "1",
    marketId: market.marketId,
    baseAssetId: input.baseAsset.assetId,
    quoteAssetId: input.quoteAsset.assetId,
    poolId,
  });
  const baseCurrency = capability?.poolKey.currency0AssetId
      === input.baseAsset.assetId
    ? capability.poolKey.currency0
    : capability?.poolKey.currency1;
  const quoteCurrency = capability?.poolKey.currency0AssetId
      === input.quoteAsset.assetId
    ? capability.poolKey.currency0
    : capability?.poolKey.currency1;
  if (
    capability === null
    || capability.chainProfileId !== input.chainProfileId
    || capability.chainProfileHash !== input.chainProfileHash
    || capability.adapterId !==
      "uniswap-v4-universal-router-exact-input:v1"
    || capability.poolKey.currency0AssetId !== pool.currency0AssetId
    || capability.poolKey.currency1AssetId !== pool.currency1AssetId
    || capability.poolKey.feeRaw !== pool.feeRaw
    || capability.poolKey.tickSpacing !== pool.tickSpacing
    || capability.poolKey.hooksAssetId !== pool.hooksAssetId
    || capability.poolKeyEvidenceHash !== pool.poolKeyEvidenceHash
    || !sameHex(capability.poolKey.hooks.value, input.context.hook)
    || baseCurrency === undefined
    || quoteCurrency === undefined
    || !sameHex(baseCurrency.value, input.baseAsset.identity.value)
    || !sameHex(quoteCurrency.value, input.quoteAsset.identity.value)
  ) return null;

  const recomputedPoolId = computeOfficialV4PoolId({
    currency0: getAddress(capability.poolKey.currency0.value),
    currency1: getAddress(capability.poolKey.currency1.value),
    fee: Number(capability.poolKey.feeRaw),
    tickSpacing: Number(capability.poolKey.tickSpacing),
    hooks: getAddress(capability.poolKey.hooks.value),
  });
  if (!sameHex(recomputedPoolId, input.context.poolId)) return null;

  return deepFreeze({
    marketId: market.marketId,
    kind: market.kind,
    status: "active" as const,
    marketAssetId: market.marketAssetId,
    baseAssetId: input.baseAsset.assetId,
    quoteAssetId: input.quoteAsset.assetId,
    marketEvidenceHash: market.marketEvidenceHash as Sha256Digest,
    verification: {
      status: "verified" as const,
      verifierAdapterId: verification.verifierAdapterId,
      verifierBindingHash: verification.verifierBindingHash as Sha256Digest,
    },
    uniswapV4: {
      poolId,
      poolManager,
      poolManagerReviewEvidenceBindingHash:
        pool.poolManagerReviewEvidenceBindingHash as Sha256Digest,
      poolManagerInterfaceEvidenceBindingHash:
        pool.poolManagerInterfaceEvidenceBindingHash as Sha256Digest,
      poolManagerRuntimeCodeKeccak256,
      poolManagerRuntimeCodeSha256,
      currency0AssetId: pool.currency0AssetId,
      currency1AssetId: pool.currency1AssetId,
      feeRaw: pool.feeRaw,
      dynamicFee: pool.dynamicFee,
      tickSpacing: pool.tickSpacing,
      hooksAssetId: pool.hooksAssetId as string | null,
      poolKeyEvidenceHash: pool.poolKeyEvidenceHash as Sha256Digest,
    },
    tradeCapability: capability,
  });
}

export function finalizedTradeAdapterDescriptorDigestV1(
  context: FinalizedTradeAdapterBindingContextV1,
  descriptor: DescriptorCoreV1,
) {
  return canonicalSha256(FINALIZED_TRADE_ADAPTER_DESCRIPTOR_SCHEMA_V1, {
    outerBinding: context,
    descriptor,
  });
}

export function parseFinalizedTradeAdapterDescriptorV1(
  value: JsonValue | undefined,
  context: FinalizedTradeAdapterBindingContextV1,
): FinalizedTradeAdapterDescriptorV1 | null {
  const candidate = exactRecord(value, [
    "adapterId", "baseAsset", "chainProfileHash", "chainProfileId",
    "descriptorDigest", "market", "projectId", "quoteAsset", "runtimeTargets",
    "schemaVersion", "serverVerification", "status",
  ]);
  const projectId = candidate ? digest(candidate.projectId) : null;
  const chainProfileHash = candidate ? digest(candidate.chainProfileHash) : null;
  const descriptorDigest = candidate ? digest(candidate.descriptorDigest) : null;
  const baseAsset = candidate ? parseAssetV1(candidate.baseAsset) : null;
  const quoteAsset = candidate ? parseAssetV1(candidate.quoteAsset) : null;
  if (
    candidate === null
    || candidate.schemaVersion !== FINALIZED_TRADE_ADAPTER_DESCRIPTOR_SCHEMA_V1
    || candidate.status !== "verified"
    || candidate.adapterId !==
      "uniswap-v4-universal-router-exact-input:v1"
    || projectId === null
    || projectId !== finalizedTradeAdapterProjectIdV1(context)
    || typeof candidate.chainProfileId !== "string"
    || !IDENTIFIER.test(candidate.chainProfileId)
    || chainProfileHash === null
    || descriptorDigest === null
    || baseAsset === null
    || quoteAsset === null
    || !sameHex(baseAsset.identity.value, context.token)
    || baseAsset.assetId === quoteAsset.assetId
    || sameHex(baseAsset.identity.value, quoteAsset.identity.value)
  ) return null;

  const runtimeTargets = parseRuntimeTargetsV1(
    candidate.runtimeTargets,
    context,
  );
  const serverVerification = exactRecord(candidate.serverVerification, [
    "evidenceHash", "verifiedAt", "verifierAdapterId",
  ]);
  const evidenceHash = serverVerification
    ? digest(serverVerification.evidenceHash)
    : null;
  if (
    runtimeTargets === null
    || serverVerification === null
    || serverVerification.verifierAdapterId !==
      FINALIZED_TRADE_ADAPTER_VERIFIER_V1
    || typeof serverVerification.verifiedAt !== "string"
    || !Number.isFinite(Date.parse(serverVerification.verifiedAt))
    || new Date(serverVerification.verifiedAt).toISOString()
      !== serverVerification.verifiedAt
    || evidenceHash === null
  ) return null;

  const market = parseMarketV1(candidate.market, {
    context,
    chainProfileId: candidate.chainProfileId,
    chainProfileHash,
    baseAsset,
    quoteAsset,
  });
  if (market === null) return null;

  const core = deepFreeze({
    schemaVersion: FINALIZED_TRADE_ADAPTER_DESCRIPTOR_SCHEMA_V1,
    status: "verified" as const,
    adapterId: "uniswap-v4-universal-router-exact-input:v1" as const,
    projectId,
    chainProfileId: candidate.chainProfileId,
    chainProfileHash,
    market,
    baseAsset,
    quoteAsset,
    runtimeTargets,
    serverVerification: {
      verifierAdapterId: FINALIZED_TRADE_ADAPTER_VERIFIER_V1,
      verifiedAt: serverVerification.verifiedAt,
      evidenceHash,
    },
  });
  if (
    finalizedTradeAdapterDescriptorDigestV1(context, core)
      !== descriptorDigest
  ) return null;
  return deepFreeze({ ...core, descriptorDigest });
}
