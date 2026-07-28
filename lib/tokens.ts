export type TokenLinkKind = "website" | "x" | "telegram";

export type TokenLink = {
  kind: TokenLinkKind;
  url: string;
};

export type TokenTone =
  | "rose"
  | "violet"
  | "mint"
  | "amber"
  | "sky"
  | "peach";

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
  fdvUsdWad?: string;
  grossVolumeEth?: string;
  grossVolumeWei?: string;
  creatorFeesGeneratedEth?: string;
  creatorFeesGeneratedWei?: string;
  launcherFeesGeneratedEth?: string;
  launcherFeesGeneratedWei?: string;
  creatorFeesAccruedEth?: string;
  creatorFeesAccruedWei?: string;
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
  launcherFeeBps?: number;
  transferTaxBps?: number;
  totalSwapFeeBps: number;
  launchModel?: "classic" | "adaptive" | "deep";
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
  pendingGrowthNativeWei?: string;
  deferredRewardFeesWei?: string;
  growthTargetReached?: boolean;
  oracleReady?: boolean;
  automationAction?: 0 | 1 | 2 | 3;
  nextCompoundTimestamp?: string;
  trustedNativeDepthWei?: string;
  depthCapNativeWei?: string;
  automationGuaranteed?: false;
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
