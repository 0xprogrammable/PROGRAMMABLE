import { formatEther, parseEther } from "viem";

export const PLATFORM_FEE_BPS = 10;
export const CLASSIC_TOTAL_SWAP_FEE_PERCENT = "1";
export const CLASSIC_TOTAL_SWAP_FEE_BPS = 100;
export const LAUNCH_DRAFT_STORAGE_KEY = "launcher.launch-draft.v1";
export const MEME_TOKEN_SUPPLY_WHOLE = 1_000_000_000;
export const MEME_TOKEN_SUPPLY_WEI = 1_000_000_000n * 10n ** 18n;
export const CLASSIC_BONDING_TOKEN_ALLOCATION_WEI =
  800_000_000n * 10n ** 18n;
export const CLASSIC_GRADUATION_TOKEN_RESERVE_WEI =
  MEME_TOKEN_SUPPLY_WEI - CLASSIC_BONDING_TOKEN_ALLOCATION_WEI;
export const MEME_INITIAL_TICK = 204_200;
export const CLASSIC_DEV_BUY_GAS_BUFFER_BPS = 15_000n;
export const MEME_STARTING_FDV_ETH = 1.3556577608171038;
export const MEME_STARTING_FDV_ETH_LABEL =
  `${MEME_STARTING_FDV_ETH.toFixed(2)} ETH`;
export const MEME_MIN_INITIAL_BUY_WEI = 600_000_000_000_000n;
export const MEME_MIN_INITIAL_BUY_ETH = "0.0006";
export const MEME_MIN_INITIAL_BUY_ETH_LABEL =
  `${MEME_MIN_INITIAL_BUY_ETH} ETH`;
export const CLASSIC_STANDARD_TICK_LOWER = -887_200;
export const CLASSIC_BONDING_TICK_LOWER = 174_800;
// Compatibility alias for older drafts and release evidence.
export const CLASSIC_DEEP_30_TICK_LOWER = CLASSIC_BONDING_TICK_LOWER;
const Q96 = 1n << 96n;
// Exact TickMath Q64.96 outputs pinned by ClassicPositionPlannerV1.
const MEME_INITIAL_SQRT_PRICE_X96 =
  2_151_813_121_295_408_910_812_139_624_586_144n;
const MEME_MIN_SQRT_PRICE_X96 = 4_310_618_292n;
const CLASSIC_BONDING_SQRT_PRICE_X96 =
  494_793_039_472_815_777_531_937_397_972_213n;
const MEME_INITIAL_LIQUIDITY =
  (MEME_TOKEN_SUPPLY_WEI * Q96) /
  (MEME_INITIAL_SQRT_PRICE_X96 - MEME_MIN_SQRT_PRICE_X96);
const CLASSIC_BONDING_INITIAL_LIQUIDITY =
  (CLASSIC_BONDING_TOKEN_ALLOCATION_WEI * Q96) /
  (MEME_INITIAL_SQRT_PRICE_X96 - CLASSIC_BONDING_SQRT_PRICE_X96);
const CLASSIC_BONDING_END_PRICE_MULTIPLE_WAD =
  18_913_066_072_547_532_342n;
export const ADAPTIVE_MIN_FDV_INDEX = -887_272;
export const ADAPTIVE_MAX_FDV_INDEX = 887_272;
export const ADAPTIVE_MIN_FEE_BPS = 100;
export const ADAPTIVE_MAX_FEE_BPS = 1_000;
export const ADAPTIVE_MIN_CURVE_POINTS = 2;
export const ADAPTIVE_MAX_CURVE_POINTS = 8;
export const CLASSIC_V3_MIN_FEE_BPS = 100;
export const CLASSIC_V3_MAX_FEE_BPS = 1_000;
export const CLASSIC_V3_FEE_STEP_BPS = 100;
export const CLASSIC_V4_MIN_FEE_BPS = 10;
export const CLASSIC_V4_MAX_FEE_BPS = 1_000;
export const CLASSIC_V4_FEE_STEP_BPS = 10;
export const CLASSIC_V3_MAX_REWARD_BENEFICIARIES = 5;
export const CLASSIC_INITIAL_BUY_MIN_DURATION_DAYS = 1;
export const CLASSIC_INITIAL_BUY_MAX_DURATION_DAYS = 3_650;
export const REWARD_SHARE_BPS = 10_000;
export const DEEP_GROWTH_TARGET_WEI = 50_000_000_000_000_000n;
export const DEEP_GROWTH_TARGET_ETH = "0.05";
export const DEEP_TOKEN_RESERVE_WHOLE = 150_000_000;
export const DEEP_INITIAL_POSITION_WHOLE = 850_000_000;

// AssetMode and the legacy draft fields remain only so an older browser draft can
// be read safely. The active product always normalizes to a new MemeLaunchV1 token.
export type AssetMode = "new" | "existing";
export type LiquidityMode = "meme";
export type BehaviorId = "fixed-fee";
export type LaunchModel =
  | "classic"
  | "classic-v3"
  | "adaptive"
  | "deep"
  | "stock-paired";
export type RewardDestinationMode = "launcher" | "external" | "split";
export type ClassicLiquidityPreset = "standard" | "bonding";
export type ClassicContractRelease = "classic-v3" | "classic-v4";
export type ClassicInitialBuyCustodyMode =
  | "unlocked"
  | "fixed-lock"
  | "linear"
  | "cliff-linear";

export type ClassicInitialBuyPreview = {
  grossEthWei: bigint;
  poolEthWei: bigint;
  tokenAmountWei: bigint;
  grossEthAmount: number;
  poolEthAmount: number;
  tokenAmount: number;
  supplyPercent: number;
  bounded: boolean;
  curveCapacityWei: bigint | null;
  remainingCurveCapacityWei: bigint | null;
  maximumGrossActivationBuyWei: bigint | null;
  endPriceMultipleWad: bigint | null;
};

export type ClassicInitialBuyCurveQuote =
  | { status: "invalid" }
  | {
      status: "over-capacity";
      grossEthWei: bigint;
      poolEthWei: bigint;
      curveCapacityWei: bigint;
      maximumGrossActivationBuyWei: bigint;
      bounded: boolean;
      endPriceMultipleWad: bigint | null;
    }
  | { status: "ready"; preview: ClassicInitialBuyPreview };

export type AdaptiveCurvePointDraft = {
  fdvIndex: number;
  totalSwapFeeBps: number;
};

export type RewardSplitDraft = {
  beneficiary: string;
  sharePercent: string;
};

export type LaunchDraft = {
  version: 1;
  launchModel: LaunchModel;
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
  stockQuoteAsset: string;
  initialBuyQuoteAmount: string;
  customHookAddress: string;
  customHookSource: string;
  launchSalt: string;
  hookSaltNonce: string;
  adaptiveCurvePoints: AdaptiveCurvePointDraft[];
  buySwapFeePercent: string;
  sellSwapFeePercent: string;
  classicLiquidityPreset: ClassicLiquidityPreset;
  classicContractRelease: ClassicContractRelease;
  rewardDestinationMode: RewardDestinationMode;
  rewardExternalAddress: string;
  rewardSplits: RewardSplitDraft[];
  initialBuyCustodyMode: ClassicInitialBuyCustodyMode;
  initialBuyDurationDays: string;
  initialBuyCliffDays: string;
  updatedAt: string;
};

export function createEmptyDraft(): LaunchDraft {
  return {
    version: 1,
    launchModel: "classic",
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
    stockQuoteAsset: "",
    initialBuyQuoteAmount: "0.01",
    customHookAddress: "",
    customHookSource: "",
    launchSalt: "",
    hookSaltNonce: "",
    adaptiveCurvePoints: [],
    buySwapFeePercent: "1",
    sellSwapFeePercent: "1",
    classicLiquidityPreset: "standard",
    classicContractRelease: "classic-v3",
    rewardDestinationMode: "launcher",
    rewardExternalAddress: "",
    rewardSplits: [
      { beneficiary: "", sharePercent: "50" },
      { beneficiary: "", sharePercent: "50" },
    ],
    initialBuyCustodyMode: "unlocked",
    initialBuyDurationDays: "30",
    initialBuyCliffDays: "7",
    updatedAt: new Date(0).toISOString(),
  };
}

export function createClassicV3Draft(): LaunchDraft {
  return {
    ...createEmptyDraft(),
    launchModel: "classic-v3",
    selectedBehaviors: ["fixed-fee"],
    buySwapFeePercent: "1",
    sellSwapFeePercent: "1",
    classicLiquidityPreset: "standard",
    classicContractRelease: "classic-v3",
    rewardDestinationMode: "launcher",
    initialBuyCustodyMode: "unlocked",
    initialBuyDurationDays: "30",
    initialBuyCliffDays: "7",
  };
}

export function createAdaptiveDraft(): LaunchDraft {
  return {
    ...createEmptyDraft(),
    launchModel: "adaptive",
    selectedBehaviors: [],
    totalSwapFeePercent: "",
    initialBuyEth: "0",
    adaptiveCurvePoints: [
      { fdvIndex: ADAPTIVE_MIN_FDV_INDEX, totalSwapFeeBps: 500 },
      { fdvIndex: -204_200, totalSwapFeeBps: 500 },
      { fdvIndex: -160_000, totalSwapFeeBps: 200 },
      { fdvIndex: ADAPTIVE_MAX_FDV_INDEX, totalSwapFeeBps: 100 },
    ],
  };
}

export function createDeepDraft(): LaunchDraft {
  return {
    ...createClassicV3Draft(),
    launchModel: "deep",
  };
}

export function createStockPairedDraft(): LaunchDraft {
  return {
    ...createClassicV3Draft(),
    launchModel: "stock-paired",
    initialBuyEth: "0.01",
    stockQuoteAsset: "",
    initialBuyQuoteAmount: "",
    totalSwapFeePercent: "1",
    buySwapFeePercent: "1",
    sellSwapFeePercent: "1",
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

export function parseClassicFeePercentToBps(value: string) {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]|10)(?:\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const [whole, fraction = ""] = normalized.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return basisPoints >= CLASSIC_V4_MIN_FEE_BPS &&
    basisPoints <= CLASSIC_V4_MAX_FEE_BPS &&
    basisPoints % CLASSIC_V4_FEE_STEP_BPS === 0
    ? basisPoints
    : null;
}

export function normalizeClassicLiquidityPreset(
  value: unknown,
): ClassicLiquidityPreset {
  return value === "bonding" || value === "deep-30" ? "bonding" : "standard";
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

export function getClassicInitialBuyPreview(
  initialBuyEth: string,
  buyFeePercent: string,
  liquidityPreset: ClassicLiquidityPreset = "standard",
): ClassicInitialBuyPreview | null {
  const quote = getClassicInitialBuyCurveQuote(
    initialBuyEth,
    buyFeePercent,
    liquidityPreset,
  );
  return quote.status === "ready" ? quote.preview : null;
}

function divideRoundingUp(numerator: bigint, denominator: bigint) {
  return (numerator + denominator - 1n) / denominator;
}

function amount0DeltaRoundingUp(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  liquidity: bigint,
) {
  const lower =
    sqrtPriceAX96 < sqrtPriceBX96 ? sqrtPriceAX96 : sqrtPriceBX96;
  const upper =
    sqrtPriceAX96 < sqrtPriceBX96 ? sqrtPriceBX96 : sqrtPriceAX96;
  const numerator = divideRoundingUp(
    (liquidity << 96n) * (upper - lower),
    upper,
  );
  return divideRoundingUp(numerator, lower);
}

function maximumGrossForNetCapacity(
  netCapacityWei: bigint,
  feeBps: number,
) {
  return (
    (netCapacityWei * 10_000n) /
    (10_000n - BigInt(feeBps))
  );
}

function decimalNumber(value: bigint, decimals = 18) {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const remainder = (value % divisor).toString().padStart(decimals, "0");
  return Number(`${whole}.${remainder}`);
}

/**
 * Mirrors the launcher's zero-for-one exact-input v4 math using integer
 * rounding. The returned token amount is a deterministic preview; the launch
 * route must still execute the complete transaction with eth_call before a
 * wallet is opened.
 */
export function getClassicInitialBuyCurveQuote(
  initialBuyEth: string,
  buyFeePercent: string,
  liquidityPreset: ClassicLiquidityPreset = "standard",
): ClassicInitialBuyCurveQuote {
  const initialBuyWei = parseInitialBuyWei(initialBuyEth);
  const buyFeeBps = parseClassicFeePercentToBps(buyFeePercent);

  if (initialBuyWei === null || buyFeeBps === null) {
    return { status: "invalid" };
  }

  const poolEthWei =
    initialBuyWei -
    (initialBuyWei * BigInt(buyFeeBps)) / 10_000n;
  const bounded = normalizeClassicLiquidityPreset(liquidityPreset) === "bonding";
  const initialLiquidity = bounded
      ? CLASSIC_BONDING_INITIAL_LIQUIDITY
      : MEME_INITIAL_LIQUIDITY;
  const lowerSqrtPriceX96 = bounded
    ? CLASSIC_BONDING_SQRT_PRICE_X96
    : MEME_MIN_SQRT_PRICE_X96;
  const curveCapacityWei = amount0DeltaRoundingUp(
    lowerSqrtPriceX96,
    MEME_INITIAL_SQRT_PRICE_X96,
    initialLiquidity,
  );
  const maximumGrossActivationBuyWei = maximumGrossForNetCapacity(
    curveCapacityWei,
    buyFeeBps,
  );

  if (poolEthWei > curveCapacityWei) {
    return {
      status: "over-capacity",
      grossEthWei: initialBuyWei,
      poolEthWei,
      curveCapacityWei,
      maximumGrossActivationBuyWei,
      bounded,
      endPriceMultipleWad: bounded
        ? CLASSIC_BONDING_END_PRICE_MULTIPLE_WAD
        : null,
    };
  }

  const nextSqrtPriceX96 =
    poolEthWei === curveCapacityWei
      ? lowerSqrtPriceX96
      : divideRoundingUp(
          (initialLiquidity << 96n) * MEME_INITIAL_SQRT_PRICE_X96,
          (initialLiquidity << 96n) +
            poolEthWei * MEME_INITIAL_SQRT_PRICE_X96,
        );
  const tokenAmountWei =
    (initialLiquidity *
      (MEME_INITIAL_SQRT_PRICE_X96 - nextSqrtPriceX96)) /
    Q96;
  const maximumTokenAmountWei = bounded
    ? CLASSIC_BONDING_TOKEN_ALLOCATION_WEI
    : MEME_TOKEN_SUPPLY_WEI;
  if (tokenAmountWei <= 0n || tokenAmountWei > maximumTokenAmountWei) {
    return { status: "invalid" };
  }

  const grossEthAmount = Number(formatEther(initialBuyWei));
  const poolEthAmount = Number(formatEther(poolEthWei));
  const tokenAmount = decimalNumber(tokenAmountWei);
  return {
    status: "ready",
    preview: {
      grossEthWei: initialBuyWei,
      poolEthWei,
      tokenAmountWei,
      grossEthAmount,
      poolEthAmount,
      tokenAmount,
      supplyPercent:
        Number((tokenAmountWei * 100_000_000n) / MEME_TOKEN_SUPPLY_WEI) /
        1_000_000,
      bounded,
      curveCapacityWei: bounded ? curveCapacityWei : null,
      remainingCurveCapacityWei: bounded
        ? curveCapacityWei - poolEthWei
        : null,
      maximumGrossActivationBuyWei: bounded
        ? maximumGrossActivationBuyWei
        : null,
      endPriceMultipleWad: bounded
        ? CLASSIC_BONDING_END_PRICE_MULTIPLE_WAD
        : null,
    },
  };
}

export function parseOptionalInitialBuyWei(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    normalized.length === 0 ||
    normalized.length > 40 ||
    !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(normalized)
  ) {
    return null;
  }

  try {
    return parseEther(normalized);
  } catch {
    return null;
  }
}

export function getInitialBuyEthLabel(draft: LaunchDraft) {
  const normalized = draft.initialBuyEth.trim();
  return `${normalized || MEME_MIN_INITIAL_BUY_ETH} ETH`;
}

export function maximumClassicDevBuyWei(input: {
  nativeBalanceWei: bigint;
  gasLimit: bigint;
  gasPriceWei: bigint;
}) {
  if (
    input.nativeBalanceWei < 0n ||
    input.gasLimit <= 0n ||
    input.gasPriceWei <= 0n
  ) {
    throw new Error("The wallet balance or network gas data is invalid");
  }

  const gasReserve =
    (input.gasLimit *
      input.gasPriceWei *
      CLASSIC_DEV_BUY_GAS_BUFFER_BPS +
      9_999n) /
    10_000n;
  return input.nativeBalanceWei > gasReserve
    ? input.nativeBalanceWei - gasReserve
    : 0n;
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
