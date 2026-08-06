export type TokenLinkKind = "website" | "x" | "telegram";

export type TokenLink = {
  kind: TokenLinkKind;
  url: string;
};

export type TokenTone = "rose" | "violet" | "mint" | "amber" | "sky" | "peach";

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
  launchDiscoverySource?: "alchemy-launch-overlay";
  launchedAt: string;
  totalSupply?: string;
  totalSupplyRaw?: string;
  tokenDecimals?: number;
  tokenLiquidityAmountRaw?: string;
  lockedTokenDustRaw?: string;
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
  totalSwapFeeBps: number;
  launchModel?: "classic" | "adaptive" | "deep" | "stock-paired";
  launchModelVersion?:
    | "classic-v3"
    | "stock-paired-v1"
    | "stock-paired-v2"
    | "stock-paired-v3";
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
  liquidityPath: "meme";
  metadataExtraData?: `0x${string}`;
};

export type CanonicalTokenExploreEntry = LauncherToken & Readonly<{
  exploreKind: "token";
  launchCategoryProvenance: Extract<
    ExploreLaunchCategoryProvenance,
    { category: "classic" }
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
