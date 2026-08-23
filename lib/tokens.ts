export type TokenLinkKind = "website" | "x" | "telegram";

export type TokenLink = {
  kind: TokenLinkKind;
  url: string;
};

export type TokenTone = "rose" | "violet" | "mint" | "amber" | "sky" | "peach";

export type LaunchStampProvenanceV1 = Readonly<{
  schemaVersion: "programmable.launch-stamp-provenance.v1";
  chainId: number;
  routerAddress: `0x${string}`;
  routerRuntimeCodeHash: `0x${string}`;
  routerStartBlock: string;
  finalityConfirmations: number;
  kind: "custom-graph" | "classic";
  launchId: `0x${string}`;
  stampHash: `0x${string}`;
  launchWallet: `0x${string}`;
  transactionHash: `0x${string}`;
  blockNumber: string;
  blockHash: `0x${string}`;
  transactionIndex: number;
  routeLogIndex: number;
  launchLogIndex: number;
  finalizedAtBlockNumber: string;
  finalizedAtBlockHash: `0x${string}`;
  poolManagerAddress: `0x${string}`;
  poolId: `0x${string}`;
  poolKey: Readonly<{
    currency0: `0x${string}`;
    currency1: `0x${string}`;
    fee: number;
    tickSpacing: number;
    hooks: `0x${string}`;
  }>;
  poolKeyHash: `0x${string}`;
  componentSetHash: `0x${string}`;
  routePayloadHash: `0x${string}`;
  routeLauncherAddress: `0x${string}`;
  routeLauncherRuntimeCodeHash: `0x${string}`;
  expectedResultHash: `0x${string}`;
  permitDigest: `0x${string}`;
  components: readonly Readonly<{
    address: `0x${string}`;
    kind: "token" | "hook" | "other";
    scope: "exclusive" | "shared-infrastructure";
    runtimeCodeHash: `0x${string}`;
    logIndex: number;
    exclusiveProof: Readonly<{
      launchId: `0x${string}`;
      stampHash: `0x${string}`;
    }> | null;
  }>[];
  tokenProof: Readonly<{
    tokenAddress: `0x${string}`;
    launchId: `0x${string}`;
    stampHash: `0x${string}`;
  }>;
  poolProof: Readonly<{
    poolManagerAddress: `0x${string}`;
    poolId: `0x${string}`;
    launchId: `0x${string}`;
    stampHash: `0x${string}`;
  }>;
}>;

export const CANONICAL_LAUNCH_STAMP_V1 = Object.freeze({
  chainId: 1,
  routerAddress: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
  routerRuntimeCodeHash:
    "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
  routerStartBlock: "25717612",
  finalityConfirmations: 64,
  poolManagerAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
} as const);

type LaunchStampExpectedIdentity = Readonly<{
  chainId?: number;
  tokenAddress?: `0x${string}`;
  hookAddress?: `0x${string}`;
  poolId?: `0x${string}`;
  launchWallet?: `0x${string}`;
  transactionHash?: `0x${string}`;
  blockNumber?: string;
  transactionIndex?: number;
  launchLogIndex?: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/iu.test(value);
}

function isBytes32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/iu.test(value);
}

function isNonZeroBytes32(value: unknown): value is `0x${string}` {
  return isBytes32(value) && BigInt(value) !== 0n;
}

function isNonZeroAddress(value: unknown): value is `0x${string}` {
  return isAddress(value) && BigInt(value) !== 0n;
}

function areCanonicalCurrencies(value: unknown): value is Readonly<{
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: unknown;
  tickSpacing: unknown;
  hooks: unknown;
}> {
  return isRecord(value) &&
    isAddress(value.currency0) &&
    isAddress(value.currency1) &&
    BigInt(value.currency0) < BigInt(value.currency1);
}

function isUnsignedDecimal(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value);
}

function sameHex(left: unknown, right: unknown) {
  return typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase();
}

/**
 * Validates the complete, finalized Router proof carried through the public
 * Website and indexer surfaces. PoolId recomputation and onchain getter checks
 * remain server-side responsibilities; this guard prevents a partial or
 * category-mismatched proof from being rendered as canonical provenance.
 */
export function isLaunchStampProvenanceV1(
  value: unknown,
  expected: LaunchStampExpectedIdentity = {},
): value is LaunchStampProvenanceV1 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "programmable.launch-stamp-provenance.v1" ||
    !Number.isSafeInteger(value.chainId) ||
    value.chainId !== CANONICAL_LAUNCH_STAMP_V1.chainId ||
    !isAddress(value.routerAddress) ||
    !sameHex(
      value.routerAddress,
      CANONICAL_LAUNCH_STAMP_V1.routerAddress,
    ) ||
    !isBytes32(value.routerRuntimeCodeHash) ||
    !sameHex(
      value.routerRuntimeCodeHash,
      CANONICAL_LAUNCH_STAMP_V1.routerRuntimeCodeHash,
    ) ||
    !isUnsignedDecimal(value.routerStartBlock) ||
    value.routerStartBlock !== CANONICAL_LAUNCH_STAMP_V1.routerStartBlock ||
    !Number.isSafeInteger(value.finalityConfirmations) ||
    value.finalityConfirmations !==
      CANONICAL_LAUNCH_STAMP_V1.finalityConfirmations ||
    (value.kind !== "custom-graph" && value.kind !== "classic") ||
    !isBytes32(value.launchId) ||
    !isBytes32(value.stampHash) ||
    !isNonZeroAddress(value.launchWallet) ||
    !isBytes32(value.transactionHash) ||
    !isUnsignedDecimal(value.blockNumber) ||
    !isBytes32(value.blockHash) ||
    !Number.isSafeInteger(value.transactionIndex) ||
    Number(value.transactionIndex) < 0 ||
    !Number.isSafeInteger(value.routeLogIndex) ||
    Number(value.routeLogIndex) < 0 ||
    !Number.isSafeInteger(value.launchLogIndex) ||
    Number(value.launchLogIndex) !== Number(value.routeLogIndex) + 1 ||
    !isUnsignedDecimal(value.finalizedAtBlockNumber) ||
    !isBytes32(value.finalizedAtBlockHash) ||
    !isAddress(value.poolManagerAddress) ||
    !sameHex(
      value.poolManagerAddress,
      CANONICAL_LAUNCH_STAMP_V1.poolManagerAddress,
    ) ||
    !isBytes32(value.poolId) ||
    !areCanonicalCurrencies(value.poolKey) ||
    !Number.isSafeInteger(value.poolKey.fee) ||
    Number(value.poolKey.fee) < 0 ||
    (Number(value.poolKey.fee) !== 0x80_00_00 &&
      Number(value.poolKey.fee) > 1_000_000) ||
    !Number.isSafeInteger(value.poolKey.tickSpacing) ||
    Number(value.poolKey.tickSpacing) < 1 ||
    Number(value.poolKey.tickSpacing) > 32_767 ||
    !isAddress(value.poolKey.hooks) ||
    !isNonZeroBytes32(value.poolKeyHash) ||
    !isNonZeroBytes32(value.componentSetHash) ||
    !isBytes32(value.routePayloadHash) ||
    !isNonZeroAddress(value.routeLauncherAddress) ||
    !isNonZeroBytes32(value.routeLauncherRuntimeCodeHash) ||
    !isBytes32(value.expectedResultHash) ||
    !isBytes32(value.permitDigest) ||
    !Array.isArray(value.components) ||
    value.components.length < 2 ||
    value.components.length > 16 ||
    !isRecord(value.tokenProof) ||
    !isNonZeroAddress(value.tokenProof.tokenAddress) ||
    !sameHex(value.tokenProof.launchId, value.launchId) ||
    !sameHex(value.tokenProof.stampHash, value.stampHash) ||
    !isRecord(value.poolProof) ||
    !sameHex(value.poolProof.poolManagerAddress, value.poolManagerAddress) ||
    !sameHex(value.poolProof.poolId, value.poolId) ||
    !sameHex(value.poolProof.launchId, value.launchId) ||
    !sameHex(value.poolProof.stampHash, value.stampHash)
  ) {
    return false;
  }

  if (
    BigInt(value.blockNumber) < BigInt(value.routerStartBlock) ||
    BigInt(value.finalizedAtBlockNumber) <
      BigInt(value.blockNumber) + BigInt(value.finalityConfirmations) ||
    (expected.chainId !== undefined && value.chainId !== expected.chainId) ||
    (expected.tokenAddress !== undefined &&
      !sameHex(value.tokenProof.tokenAddress, expected.tokenAddress)) ||
    (expected.hookAddress !== undefined &&
      !sameHex(value.poolKey.hooks, expected.hookAddress)) ||
    (expected.poolId !== undefined && !sameHex(value.poolId, expected.poolId))
    || (expected.launchWallet !== undefined &&
      !sameHex(value.launchWallet, expected.launchWallet))
    || (expected.transactionHash !== undefined &&
      !sameHex(value.transactionHash, expected.transactionHash))
    || (expected.blockNumber !== undefined &&
      value.blockNumber !== expected.blockNumber)
    || (expected.transactionIndex !== undefined &&
      value.transactionIndex !== expected.transactionIndex)
    || (expected.launchLogIndex !== undefined &&
      value.launchLogIndex !== expected.launchLogIndex)
  ) {
    return false;
  }

  const seenComponents = new Set<string>();
  const seenComponentLogIndexes = new Set<number>();
  let previousComponentLogIndex: number | null = null;
  let tokenComponentCount = 0;
  let hookComponentCount = 0;
  for (const component of value.components) {
    if (
      !isRecord(component) ||
      !isAddress(component.address) ||
      (component.kind !== "token" &&
        component.kind !== "hook" &&
        component.kind !== "other") ||
      (component.scope !== "exclusive" &&
        component.scope !== "shared-infrastructure") ||
      !isNonZeroBytes32(component.runtimeCodeHash) ||
      !Number.isSafeInteger(component.logIndex) ||
      Number(component.logIndex) < 0 ||
      Number(component.logIndex) >= Number(value.routeLogIndex)
    ) {
      return false;
    }
    const componentAddress = component.address.toLowerCase();
    if (seenComponents.has(componentAddress)) return false;
    seenComponents.add(componentAddress);
    const componentLogIndex = Number(component.logIndex);
    if (seenComponentLogIndexes.has(componentLogIndex)) return false;
    if (
      previousComponentLogIndex !== null &&
      componentLogIndex !== previousComponentLogIndex + 1
    ) return false;
    seenComponentLogIndexes.add(componentLogIndex);
    previousComponentLogIndex = componentLogIndex;

    if (component.scope === "exclusive") {
      if (
        !isRecord(component.exclusiveProof) ||
        !sameHex(component.exclusiveProof.launchId, value.launchId) ||
        !sameHex(component.exclusiveProof.stampHash, value.stampHash)
      ) {
        return false;
      }
    } else if (component.exclusiveProof !== null) {
      return false;
    }

    if (
      component.kind === "token" &&
      sameHex(component.address, value.tokenProof.tokenAddress) &&
      component.scope === "exclusive"
    ) {
      tokenComponentCount += 1;
    }
    if (
      component.kind === "hook" &&
      sameHex(component.address, value.poolKey.hooks) &&
      component.scope ===
        (value.kind === "custom-graph" ? "exclusive" : "shared-infrastructure")
    ) {
      hookComponentCount += 1;
    }
  }

  return tokenComponentCount === 1 &&
    hookComponentCount === 1 &&
    previousComponentLogIndex === Number(value.routeLogIndex) - 1;
}

export type ExploreLaunchCategoryProvenance =
  | Readonly<{
      schemaVersion: "programmable.explore-launch-category-provenance.v1";
      category: "classic";
      source: "canonical-launch-read-model";
      recordId: string;
      modelId: string | null;
      modelVersion: string | null;
    }>
  | Readonly<{
      schemaVersion: "programmable.explore-launch-category-provenance.v1";
      category: "classic" | "custom";
      source: "canonical-launch-stamp-router";
      launchId: `0x${string}`;
      stampHash: `0x${string}`;
      routerAddress: `0x${string}`;
      transactionHash: `0x${string}`;
      blockHash: `0x${string}`;
      blockNumber: string;
      transactionIndex: number;
      logIndex: number;
    }>
  | Readonly<{
      schemaVersion: "programmable.explore-launch-category-provenance.v1";
      category: "custom";
      source: "registry.custom-launched";
      projectId: `sha256:${string}`;
      launchId: `sha256:${string}`;
      sourceRecordBindingHash: `sha256:${string}`;
      finalizedLaunchBindingHash: `sha256:${string}`;
      registryAddress: `0x${string}`;
      registryStartBlock: string;
      transactionHash: `0x${string}`;
      blockHash: `0x${string}`;
      blockNumber: string;
      transactionIndex: number;
      logIndex: number;
      configurationHash: `0x${string}`;
    }>
  | Readonly<{
      schemaVersion: "programmable.explore-launch-category-provenance.v1";
      category: "custom";
      source: "interface-preview";
      projectId: `sha256:${string}`;
      launchId: `sha256:${string}`;
      sourceRecordBindingHash: `sha256:${string}`;
      finalizedLaunchBindingHash: `sha256:${string}`;
    }>;

export type DeepV2IndexedLaunchProvenance = {
  deepReleaseVersion: "deep-full-range-v2";
  launcher: `0x${string}`;
  creator: `0x${string}`;
  tokenAddress: `0x${string}`;
  vaultAddress: `0x${string}`;
  hookAddress: `0x${string}`;
  poolId: `0x${string}`;
  launchHash: `0x${string}`;
  vaultConfigurationHash: `0x${string}`;
  blockNumber: string;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  logIndex: number;
};

export type DeepV3IndexedLaunchProvenance = {
  deepReleaseVersion: "deep-full-range-v3";
  launchModel: "deep";
  launcher: `0x${string}`;
  creator: `0x${string}`;
  tokenAddress: `0x${string}`;
  vaultAddress: `0x${string}`;
  hookAddress: `0x${string}`;
  positionRecipient: `0x${string}`;
  positionTokenId: string;
  poolId: `0x${string}`;
  launchHash: `0x${string}`;
  vaultConfigurationHash: `0x${string}`;
  blockNumber: string;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  logIndex: number;
};

export type LauncherToken = {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;
  links?: TokenLink[];
  tokenAddress: `0x${string}`;
  hookAddress: `0x${string}`;
  poolId: `0x${string}`;
  creatorAddress?: `0x${string}`;
  positionRecipient?: `0x${string}`;
  positionTokenId?: string;
  launchHash?: `0x${string}`;
  launchBlockNumber?: string;
  launchTransactionHash?: `0x${string}`;
  launchTransactionIndex?: number;
  launchLogIndex?: number;
  launchDiscoverySource?: "operational-launch-overlay";
  launchedAt: string;
  totalSupply?: string;
  totalSupplyRaw?: string;
  tokenDecimals?: number;
  tokenLiquidityAmountRaw?: string;
  lockedTokenDustRaw?: string;
  initialBuyEthAmountWei?: string;
  initialBuyTokenAmountRaw?: string;
  initialBuyCustody?: Readonly<{
    custodyAddress: `0x${string}` | null;
    mode: "unlocked" | "fixed-lock" | "linear" | "cliff-linear";
    durationDays: number;
    cliffDays: number;
    configurationHash: `0x${string}`;
    cliffTimestamp: string;
    releaseTimestamp: string;
  }>;
  tokenPriceEth?: string;
  tokenPriceEthWei?: string;
  tokenPriceUsdWad?: string;
  marketCapEth?: string;
  marketCapEthWei?: string;
  indexedMarketCapEth?: string;
  indexedMarketCapEthWei?: string;
  indexedMarketCapUsdWad?: string;
  indexedValuationBlockNumber?: string;
  quoteAssetAddress?: `0x${string}`;
  quoteAssetSymbol?: string;
  quoteAssetName?: string;
  quoteIsCurrency0?: boolean;
  rewardVaultAddress?: `0x${string}`;
  tokenPriceQuote?: string;
  tokenPriceQuoteWad?: string;
  marketCapQuote?: string;
  marketCapQuoteWad?: string;
  grossVolumeQuote?: string;
  grossVolumeQuoteRaw?: string;
  creatorFeesGeneratedQuote?: string;
  creatorFeesGeneratedQuoteRaw?: string;
  programmableFeesGeneratedQuote?: string;
  programmableFeesGeneratedQuoteRaw?: string;
  creatorFeesAccruedQuote?: string;
  creatorFeesAccruedQuoteRaw?: string;
  fdvUsdWad?: string;
  liveMarketStateEvidence?: Readonly<{
    source: "uniswap-v4-stateview-v1";
    blockNumber: string;
    blockHash: `0x${string}`;
    sqrtPriceX96: string;
    activeLiquidity: string;
  }>;
  liveMarketPriceEvidence?: Readonly<{
    schemaVersion: "programmable.stateview-chainlink-price-evidence.v1";
    source: "uniswap-v4-stateview-chainlink-v1";
    chainId: "1";
    poolId: `0x${string}`;
    tokenAddress: `0x${string}`;
    quoteAddress: `0x${string}`;
    stateViewAddress: `0x${string}`;
    stateViewRuntimeCodeHash: `0x${string}`;
    blockNumber: string;
    blockHash: `0x${string}`;
    blockTimestamp: string;
    blockTime: string;
    sqrtPriceX96: string;
    activeLiquidity: string;
    activeVirtualToken0Wei: string;
    activeVirtualLiquidityUsdWad: string;
    activeVirtualLiquidityValueBasis:
      "stateview-active-liquidity-virtual-depth-usd";
    tokenPriceEthWei: string;
    tokenPriceUsdWad: string;
    totalSupplyRaw: string;
    tokenDecimals: number;
    fdvUsdWad: string;
    ethUsdQuote: Readonly<{
      feedAddress: `0x${string}`;
      roundId: string;
      answeredInRound: string;
      answer: string;
      decimals: number;
      updatedAt: string;
      updatedAtTime: string;
    }>;
  }>;
  grossVolumeEth?: string;
  grossVolumeWei?: string;
  creatorFeesGeneratedEth?: string;
  creatorFeesGeneratedWei?: string;
  launcherFeesGeneratedEth?: string;
  launcherFeesGeneratedWei?: string;
  creatorFeesAccruedEth?: string;
  creatorFeesAccruedWei?: string;
  growthFeesGeneratedEth?: string;
  growthFeesGeneratedWei?: string;
  growthFeesAccruedEth?: string;
  growthFeesAccruedWei?: string;
  swapCount?: number;
  currentTick?: number;
  initialTick?: number;
  tickLower?: number;
  tickUpper?: number;
  activeLiquidity?: string;
  protocolFeePips?: number;
  lpFeePips?: number;
  buyHookFeeBps?: number;
  sellHookFeeBps?: number;
  creatorFeeBps?: number;
  buyCreatorFeeBps?: number;
  sellCreatorFeeBps?: number;
  growthFeeBps?: number;
  programmableFeeBps?: number;
  launcherFeeBps?: number;
  transferTaxBps?: number;
  totalSwapFeeBps: number | null;
  launchModel?:
    | "classic"
    | "adaptive"
    | "deep"
    | "stock-paired"
    | "custom-graph";
  launchModelVersion?:
    | "classic-v2"
    | "classic-v3"
    | "stock-paired-v1"
    | "stock-paired-v2"
    | "stock-paired-v3"
    | "programmable-launch-stamp-router-v1";
  deepReleaseVersion?:
    "deep-full-range-v1" | "deep-full-range-v2" | "deep-full-range-v3";
  adaptiveCurveHash?: `0x${string}`;
  adaptiveCurvePoints?: {
    fdvIndex: number;
    totalSwapFeeBps: number;
  }[];
  adaptiveUsesPreSwapTick?: boolean;
  adaptiveSymmetricBuyAndSell?: boolean;
  growthVaultAddress?: `0x${string}`;
  oracleGuardAddress?: `0x${string}`;
  upstreamRewardVaultAddress?: `0x${string}`;
  growthTargetNativeWei?: string;
  completionToleranceNativeWei?: string;
  minimumNativeLiquidityForCompletionWei?: string;
  tokenReserveRaw?: string;
  totalNativeAllocatedToGrowthWei?: string;
  totalNativeAddedToLiquidityWei?: string;
  totalTokenAddedToLiquidityRaw?: string;
  totalGrowthEthReceivedWei?: string;
  totalNativeSwappedWei?: string;
  totalTokenAcquiredRaw?: string;
  pendingGrowthNativeWei?: string;
  deferredRewardFeesWei?: string;
  growthTargetReached?: boolean;
  oracleReady?: boolean;
  automationAction?: 0 | 1 | 2 | 3;
  nextCompoundTimestamp?: string;
  trustedNativeDepthWei?: string;
  depthCapNativeWei?: string;
  lockedLiquidity?: string;
  rollingExposureWei?: string;
  compoundCount?: string;
  lastCompoundTimestamp?: string;
  automationGuaranteed?: false;
  deepV2Provenance?: DeepV2IndexedLaunchProvenance;
  deepV3Provenance?: DeepV3IndexedLaunchProvenance;
  launchStampProvenance?: LaunchStampProvenanceV1;
  uniswapV4Pool?: {
    source: "official-uniswap-v4-subgraph";
    indexedBlockNumber: string;
    indexedBlockHash: `0x${string}`;
    volumeUsdWad: string;
    tvlUsdWad: string;
    transactionCount: string;
    liquidity: string;
    sqrtPriceX96: string;
    tick?: number;
    feeTierPips: string;
  };
  liquidityPath: "meme" | "programmable-v4";
  metadataExtraData?: `0x${string}`;
};

export type CanonicalTokenExploreEntry = LauncherToken & Readonly<{
  exploreKind: "token";
  launchCategoryProvenance:
    | Extract<
        ExploreLaunchCategoryProvenance,
        { category: "classic" }
      >
    | Extract<
        ExploreLaunchCategoryProvenance,
        { source: "canonical-launch-stamp-router" }
      >;
}>;

export type CustomProjectExploreEntry = Readonly<{
  exploreKind: "custom-project";
  id: string;
  name: string;
  symbol?: string;
  description?: string;
  imageUrl?: string;
  links: readonly TokenLink[];
  launchedAt: string;
  finalizedAt: string;
  chainId: string;
  modelId: string;
  customProjectId: `sha256:${string}`;
  customLaunchId: `sha256:${string}`;
  launchingWallet: Readonly<{ namespace: string; value: string }>;
  postLaunchAuthorityInventory: Readonly<PostLaunchAuthorityInventoryV1>;
  postLaunchAuthorityInventoryHash: `sha256:${string}`;
  tokenAddress?: `0x${string}`;
  tokenDecimals?: number;
  markets: readonly Readonly<{
    marketId: string;
    kind: string;
    status: "active" | "paused" | "closed" | "verification_pending";
    poolId?: `0x${string}`;
    baseAsset: Readonly<{
      assetId: string;
      identity: Readonly<{ namespace: string; value: string }>;
      name?: string;
      symbol?: string;
      decimals?: number;
    }>;
    quoteAsset: Readonly<{
      assetId: string;
      identity: Readonly<{ namespace: string; value: string }>;
      name?: string;
      symbol?: string;
      decimals?: number;
    }>;
    tradeCapability?: Readonly<DiscoverableMarketTradeCapabilityV1>;
  }>[];
  launchCategoryProvenance: Extract<
    ExploreLaunchCategoryProvenance,
    { category: "custom" }
  >;
}>;

export type ExploreEntry = CanonicalTokenExploreEntry | CustomProjectExploreEntry;

/**
 * Static tokens are deliberately empty. Explore must only render records
 * proven by the configured launcher events through the onchain API.
 */
export const launcherTokens: LauncherToken[] = [];

export type PreviewToken = {
  id: string;
  name: string;
  symbol: string;
  description: string;
  tokenAddress: `0x${string}`;
  launchedAt: string;
  marketCapUsd: number;
  tone: TokenTone;
  linkKinds: TokenLinkKind[];
};

/**
 * Kept for the current card adapter, but intentionally empty so an undeployed
 * production registry never looks as if tokens already exist.
 */
export const previewTokens: PreviewToken[] = [];
import type {
  DiscoverableMarketTradeCapabilityV1,
  PostLaunchAuthorityInventoryV1,
} from "./custom-launch/contract-v2";
