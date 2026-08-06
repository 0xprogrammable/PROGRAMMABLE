import type { DiscoverableMarketTradeCapabilityV1 } from "./contract-v2";

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const HASH32 = /^0x[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const HEX_BYTES = /^0x(?:[0-9a-f]{2}){0,2048}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,76})$/u;
const SIGNED_DECIMAL = /^-?(?:0|[1-9][0-9]{0,76})$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,255}$/u;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord : null;
}

function hasExactKeys(value: JsonRecord, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function identity(value: unknown, namespace: string) {
  const candidate = record(value);
  return candidate !== null
    && hasExactKeys(candidate, ["namespace", "value"])
    && candidate.namespace === namespace
    && typeof candidate.value === "string"
    && ADDRESS.test(candidate.value);
}

function digest(value: unknown) {
  return typeof value === "string" && DIGEST.test(value);
}

function integer(value: unknown, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

export function parseDiscoverableMarketTradeCapabilityV1(input: Readonly<{
  value: unknown;
  chainId: string;
  marketId: string;
  baseAssetId: string;
  quoteAssetId: string;
  poolId?: string;
}>): DiscoverableMarketTradeCapabilityV1 | null {
  const value = record(input.value);
  if (value === null || !hasExactKeys(value, [
    "actionPolicy", "adapterId", "approvalPolicy", "baseAssetId", "capabilityId",
    "chainId", "chainProfileHash", "chainProfileId", "deadlinePolicy",
    "dependencies", "exactness", "hookAssetIdentityEvidenceHash", "hookDataPolicy",
    "marketId", "marketVerificationBindingHash", "planBindingHash", "poolKey",
    "poolKeyEvidenceHash", "quoteAssetId", "quotePolicy", "recipientPolicy",
    "routerGeneration", "schemaVersion", "sideBindings", "slippagePolicy", "status",
    "supportedSides", "tradeCapabilityBindingHash",
  ])
    || value.schemaVersion !== "programmable.discoverable-market-trade-capability.v1"
    || value.adapterId !== "uniswap-v4-universal-router-exact-input:v1"
    || value.exactness !== "exact-input"
    || value.recipientPolicy !== "connected-wallet-only"
    || value.status !== "verified"
    || value.chainId !== input.chainId
    || value.marketId !== input.marketId
    || value.baseAssetId !== input.baseAssetId
    || value.quoteAssetId !== input.quoteAssetId
    || typeof value.capabilityId !== "string" || !IDENTIFIER.test(value.capabilityId)
    || typeof value.chainProfileId !== "string" || !IDENTIFIER.test(value.chainProfileId)
    || typeof value.routerGeneration !== "string" || !IDENTIFIER.test(value.routerGeneration)
    || !digest(value.chainProfileHash) || !digest(value.planBindingHash)
    || !digest(value.poolKeyEvidenceHash) || !digest(value.marketVerificationBindingHash)
    || !digest(value.tradeCapabilityBindingHash)
    || (value.hookAssetIdentityEvidenceHash !== null
      && !digest(value.hookAssetIdentityEvidenceHash))) return null;

  const namespace = `eip155:${input.chainId}`;
  const poolKey = record(value.poolKey);
  if (poolKey === null || !hasExactKeys(poolKey, [
    "currency0", "currency0AssetId", "currency1", "currency1AssetId", "feeRaw",
    "hooks", "hooksAssetId", "poolId", "tickSpacing",
  ])
    || typeof poolKey.poolId !== "string" || !HASH32.test(poolKey.poolId)
    || (input.poolId !== undefined && poolKey.poolId !== input.poolId)
    || typeof poolKey.currency0AssetId !== "string"
    || !IDENTIFIER.test(poolKey.currency0AssetId)
    || typeof poolKey.currency1AssetId !== "string"
    || !IDENTIFIER.test(poolKey.currency1AssetId)
    || !identity(poolKey.currency0, namespace)
    || !identity(poolKey.currency1, namespace)
    || !identity(poolKey.hooks, namespace)
    || typeof poolKey.feeRaw !== "string" || !DECIMAL.test(poolKey.feeRaw)
    || BigInt(poolKey.feeRaw) > 0xffffffn
    || typeof poolKey.tickSpacing !== "string" || !SIGNED_DECIMAL.test(poolKey.tickSpacing)
    || BigInt(poolKey.tickSpacing) < -0x800000n || BigInt(poolKey.tickSpacing) > 0x7fffffn
    || (poolKey.hooksAssetId !== null
      && (typeof poolKey.hooksAssetId !== "string"
        || !IDENTIFIER.test(poolKey.hooksAssetId)))) return null;
  const currencyAssetIds = new Set([
    poolKey.currency0AssetId,
    poolKey.currency1AssetId,
  ]);
  if (!currencyAssetIds.has(input.baseAssetId)
    || !currencyAssetIds.has(input.quoteAssetId)
    || (poolKey.hooksAssetId === null)
      !== ((poolKey.hooks as JsonRecord).value === ZERO_ADDRESS)
    || (poolKey.hooksAssetId === null)
      !== (value.hookAssetIdentityEvidenceHash === null)) return null;

  const expectedRoles = [
    "uniswap-permit2", "uniswap-v4-quoter", "uniswap-v4-state-view",
    "uniswap-v4-universal-router",
  ] as const;
  if (!Array.isArray(value.dependencies) || value.dependencies.length !== 4) return null;
  const dependencyIds = new Set<string>();
  const dependencyAddresses = new Set<string>();
  for (let index = 0; index < value.dependencies.length; index += 1) {
    const dependency = record(value.dependencies[index]);
    const role = expectedRoles[index];
    const expectedCapabilityId = role === "uniswap-v4-universal-router"
      ? `capability:uniswap-v4-${value.routerGeneration}`
      : `capability:${role}:v1`;
    if (dependency === null || !hasExactKeys(dependency, [
      "capabilityId", "chainProfileId", "dependencyId", "identity",
      "interfaceEvidenceBindingHash", "reviewEvidenceBindingHash", "role",
      "runtimeCodeKeccak256", "runtimeCodeSha256",
    ])
      || dependency.role !== role
      || dependency.capabilityId !== expectedCapabilityId
      || dependency.chainProfileId !== value.chainProfileId
      || typeof dependency.dependencyId !== "string"
      || !IDENTIFIER.test(dependency.dependencyId)
      || !identity(dependency.identity, namespace)
      || typeof dependency.runtimeCodeKeccak256 !== "string"
      || !HASH32.test(dependency.runtimeCodeKeccak256)
      || !digest(dependency.runtimeCodeSha256)
      || !digest(dependency.reviewEvidenceBindingHash)
      || !digest(dependency.interfaceEvidenceBindingHash)) return null;
    dependencyIds.add(dependency.dependencyId);
    dependencyAddresses.add((dependency.identity as JsonRecord).value as string);
  }
  if (dependencyIds.size !== 4 || dependencyAddresses.size !== 4) return null;

  if (!Array.isArray(value.supportedSides) || !Array.isArray(value.sideBindings)) return null;
  const supportedSides = value.supportedSides;
  const sideBindings = value.sideBindings;
  if (supportedSides.length < 1 || supportedSides.length > 2
    || supportedSides.some((side) =>
      side !== "base-to-quote" && side !== "quote-to-base")
    || new Set(supportedSides).size !== supportedSides.length
    || [...supportedSides].sort().some((side, index) => side !== supportedSides[index])
    || sideBindings.length !== supportedSides.length) return null;
  const baseIsCurrency0 = poolKey.currency0AssetId === input.baseAssetId;
  for (let index = 0; index < supportedSides.length; index += 1) {
    const side = supportedSides[index];
    const sideBinding = record(sideBindings[index]);
    const inputAssetId = side === "base-to-quote" ? input.baseAssetId : input.quoteAssetId;
    const outputAssetId = side === "base-to-quote" ? input.quoteAssetId : input.baseAssetId;
    const zeroForOne = side === "base-to-quote" ? baseIsCurrency0 : !baseIsCurrency0;
    const inputCurrency = (zeroForOne ? poolKey.currency0 : poolKey.currency1) as JsonRecord;
    if (sideBinding === null || !hasExactKeys(sideBinding, [
      "inputAssetId", "inputCurrencyKind", "outputAssetId", "settlementAction",
      "side", "takeAction", "zeroForOne",
    ])
      || sideBinding.side !== side
      || sideBinding.inputAssetId !== inputAssetId
      || sideBinding.outputAssetId !== outputAssetId
      || sideBinding.zeroForOne !== zeroForOne
      || sideBinding.inputCurrencyKind
        !== (inputCurrency.value === ZERO_ADDRESS ? "native" : "erc20")
      || sideBinding.settlementAction !== "SETTLE_ALL"
      || sideBinding.takeAction !== "TAKE_ALL") return null;
  }

  const hookData = record(value.hookDataPolicy);
  if (hookData === null || !hasExactKeys(hookData, ["data", "hookDataHash", "kind"])
    || (hookData.kind !== "empty" && hookData.kind !== "fixed")
    || typeof hookData.data !== "string" || !HEX_BYTES.test(hookData.data)
    || !digest(hookData.hookDataHash)
    || (hookData.kind === "empty") !== (hookData.data === "0x")
    || (poolKey.hooksAssetId === null && hookData.data !== "0x")) return null;
  const action = record(value.actionPolicy);
  if (action === null || !hasExactKeys(action, [
    "exactOutput", "multiHop", "settleAction", "swapAction", "takeAction",
  ]) || action.swapAction !== "SWAP_EXACT_IN_SINGLE"
    || action.settleAction !== "SETTLE_ALL" || action.takeAction !== "TAKE_ALL"
    || action.multiHop !== false || action.exactOutput !== false) return null;
  const quote = record(value.quotePolicy);
  if (quote === null || !hasExactKeys(quote, [
    "adapterId", "currentStateRequired", "executionMode", "maximumQuoteAgeSeconds",
  ]) || quote.adapterId !== "uniswap-v4-quoter-exact-input:v1"
    || quote.executionMode !== "offchain-static-call-only"
    || quote.currentStateRequired !== true
    || !integer(quote.maximumQuoteAgeSeconds, 1, 300)) return null;
  const slippage = record(value.slippagePolicy);
  if (slippage === null || !hasExactKeys(slippage, [
    "amountOutMinimumRequired", "kind", "maximumSlippageBps",
  ]) || slippage.kind !== "user-bounded-minimum-output"
    || slippage.amountOutMinimumRequired !== true
    || !integer(slippage.maximumSlippageBps, 1, 5_000)) return null;
  const deadline = record(value.deadlinePolicy);
  if (deadline === null || !hasExactKeys(deadline, [
    "deadlineRequired", "kind", "maximumHorizonSeconds",
  ]) || deadline.kind !== "bounded-user-deadline"
    || deadline.deadlineRequired !== true
    || !integer(deadline.maximumHorizonSeconds, 1, 3_600)) return null;
  const approval = record(value.approvalPolicy);
  if (approval === null || !hasExactKeys(approval, ["erc20Input", "nativeInput"])
    || approval.erc20Input !== "erc20-approve-permit2-then-permit2-approve-router"
    || approval.nativeInput !== "transaction-value") return null;
  return value as unknown as DiscoverableMarketTradeCapabilityV1;
}
