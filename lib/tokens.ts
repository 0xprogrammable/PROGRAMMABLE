export type TokenLinkKind = "website" | "x" | "telegram";

export type TokenLink = {
  kind: TokenLinkKind;
  url: string;
};

export type TokenTone = "rose" | "violet" | "mint" | "amber" | "sky" | "peach";

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
