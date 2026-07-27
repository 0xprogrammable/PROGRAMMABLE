import { parseEther } from "viem";

export const PLATFORM_FEE_BPS = 10;
export const CLASSIC_TOTAL_SWAP_FEE_PERCENT = "1";
export const CLASSIC_TOTAL_SWAP_FEE_BPS = 100;
export const LAUNCH_DRAFT_STORAGE_KEY = "launcher.launch-draft.v1";
export const MEME_TOKEN_SUPPLY_WHOLE = 1_000_000_000;
export const MEME_INITIAL_TICK = 204_200;
export const MEME_STARTING_FDV_ETH = 1.3556577608171038;
export const MEME_STARTING_FDV_ETH_LABEL =
  `${MEME_STARTING_FDV_ETH.toFixed(2)} ETH`;
export const MEME_MIN_INITIAL_BUY_WEI = 600_000_000_000_000n;
export const MEME_MIN_INITIAL_BUY_ETH = "0.0006";
export const MEME_MIN_INITIAL_BUY_ETH_LABEL =
  `${MEME_MIN_INITIAL_BUY_ETH} ETH`;

// AssetMode and the legacy draft fields remain only so an older browser draft can
// be read safely. The active product always normalizes to a new MemeLaunchV1 token.
export type AssetMode = "new" | "existing";
export type LiquidityMode = "meme";
export type BehaviorId = "fixed-fee";

export type LaunchDraft = {
  version: 1;
  assetMode: AssetMode;
  tokenName: string;
  tokenSymbol: string;
  tokenSupply: string;
  tokenDescription: string;
  tokenWebsite: string;
  tokenImage: string;
  tokenX: string;
  tokenTelegram: string;
  tokenAddress: string;
  existingTokenName: string;
  existingTokenSymbol: string;
  existingTokenSupply: string;
  liquidityMode: LiquidityMode;
  auctionSalePercent: string;
  auctionLiquidityPercent: string;
  auctionFloorValuationEth: string;
  auctionStartBlock: string;
  auctionEndBlock: string;
  auctionClaimBlock: string;
  auctionMigrationBlock: string;
  directEthAmount: string;
  directTokenAmount: string;
  directTokensPerEth: string;
  selectedBehaviors: BehaviorId[];
  lpFeePercent: string;
  totalSwapFeePercent: string;
  initialBuyEth: string;
  customHookAddress: string;
  customHookSource: string;
  launchSalt: string;
  updatedAt: string;
};

export function createEmptyDraft(): LaunchDraft {
  return {
    version: 1,
    assetMode: "new",
    tokenName: "",
    tokenSymbol: "",
    tokenSupply: "1000000000",
    tokenDescription: "",
    tokenWebsite: "",
    tokenImage: "",
    tokenX: "",
    tokenTelegram: "",
    tokenAddress: "",
    existingTokenName: "",
    existingTokenSymbol: "",
    existingTokenSupply: "",
    liquidityMode: "meme",
    auctionSalePercent: "",
    auctionLiquidityPercent: "",
    auctionFloorValuationEth: "",
    auctionStartBlock: "",
    auctionEndBlock: "",
    auctionClaimBlock: "",
    auctionMigrationBlock: "",
    directEthAmount: "",
    directTokenAmount: "",
    directTokensPerEth: "",
    selectedBehaviors: ["fixed-fee"],
    lpFeePercent: "0",
    totalSwapFeePercent: CLASSIC_TOTAL_SWAP_FEE_PERCENT,
    initialBuyEth: MEME_MIN_INITIAL_BUY_ETH,
    customHookAddress: "",
    customHookSource: "",
    launchSalt: "",
    updatedAt: new Date(0).toISOString(),
  };
}

export function getDraftAssetLabel(draft: LaunchDraft) {
  return draft.tokenSymbol.trim() || draft.tokenName.trim() || "the new token";
}

export function buildLaunchSummary(draft: LaunchDraft) {
  const asset =
    draft.tokenName.trim() || draft.tokenSymbol.trim() || "The token";
  return `${asset} launches at ${MEME_STARTING_FDV_ETH_LABEL} starting FDV with its complete supply in one permanently locked, one-sided Uniswap v4 position`;
}

export function parseTotalSwapFeeBps(value: string) {
  const normalized = value.trim();
  return normalized === CLASSIC_TOTAL_SWAP_FEE_PERCENT
    ? CLASSIC_TOTAL_SWAP_FEE_BPS
    : null;
}

export function parseInitialBuyWei(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    normalized.length === 0 ||
    normalized.length > 40 ||
    !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(normalized)
  ) {
    return null;
  }

  try {
    const amount = parseEther(normalized);
    return amount >= MEME_MIN_INITIAL_BUY_WEI ? amount : null;
  } catch {
    return null;
  }
}

export function getInitialBuyEthLabel(draft: LaunchDraft) {
  const normalized = draft.initialBuyEth.trim();
  return `${normalized || MEME_MIN_INITIAL_BUY_ETH} ETH`;
}

export function getMemeFeeBreakdown(draft: LaunchDraft) {
  const totalSwapFeeBps = parseTotalSwapFeeBps(
    draft.totalSwapFeePercent,
  );
  if (totalSwapFeeBps === null) return null;
  return {
    totalSwapFeeBps,
    creatorFeeBps: totalSwapFeeBps - PLATFORM_FEE_BPS,
    launcherFeeBps: PLATFORM_FEE_BPS,
  };
}

function formatBps(bps: number) {
  return `${(bps / 100).toFixed(2)}%`;
}

export function buildPlainTextPlan(draft: LaunchDraft) {
  const fees = getMemeFeeBreakdown(draft);
  const initialBuy = getInitialBuyEthLabel(draft);
  return [
    "Programmable setup",
    "",
    `Token: ${getDraftAssetLabel(draft)}`,
    "Token supply: 1,000,000,000 at 18 decimals",
    `Creator initial buy: ${initialBuy}; purchased tokens go directly to the creator`,
    "Launch cost: no launch fee or liquidity deposit; the creator pays the initial buy and network gas",
    `Starting FDV: ${MEME_STARTING_FDV_ETH_LABEL}; the approximate USD value follows ETH`,
    "Liquidity: the complete supply enters one one-sided Uniswap v4 position at launch",
    "Position custody: permanently locked",
    "Transfer fee: 0.00%",
    "Uniswap LP fee: 0.00%",
    `Total swap fee: ${fees ? formatBps(fees.totalSwapFeeBps) : "unset"}`,
    `Creator share: ${fees ? formatBps(fees.creatorFeeBps) : "unset"} in native ETH`,
    `Programmable share: ${formatBps(PLATFORM_FEE_BPS)} in native ETH, deducted from the fixed total`,
    "Fee scope: the canonical Programmable pool; separate pools can bypass its hook",
    "",
    buildLaunchSummary(draft),
  ].join("\n");
}
