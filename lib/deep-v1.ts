import {
  encodeFunctionData,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";

import {
  validateClassicV3LaunchDraft,
  type ClassicV3LaunchConfiguration,
} from "./classic-v3";
import {
  DEEP_GROWTH_TARGET_ETH,
  DEEP_GROWTH_TARGET_WEI,
  DEEP_INITIAL_POSITION_WHOLE,
  DEEP_TOKEN_RESERVE_WHOLE,
  MEME_MIN_INITIAL_BUY_WEI,
  type LaunchDraft,
} from "./launch";
import {
  encodeMemeMetadataExtraData,
  LaunchInputError,
  MAX_METADATA_URL_BYTES,
  normalizeOptionalHttpsUrl,
} from "./launch-transaction";

export const DEEP_TOKEN_SUPPLY_WHOLE = 1_000_000_000;
export const DEEP_MIN_INITIAL_BUY_WEI = MEME_MIN_INITIAL_BUY_WEI;
export const DEEP_INITIAL_TICK = 204_200;
export const DEEP_TICK_SPACING = 200;
export const DEEP_FULL_RANGE_TICK_LOWER = -887_200;
export const DEEP_FULL_RANGE_TICK_UPPER = 887_200;
export const DEEP_TWAP_WINDOW_SECONDS = 1_800;
export const DEEP_ORACLE_CARDINALITY_TARGET = 192;
export const DEEP_MAX_SPOT_TWAP_DEVIATION_TICKS = 600;
export const DEEP_MAX_HOOK_TICK_DELTA = 400;
export const DEEP_COMPLETION_TOLERANCE_WEI = 1_000_000_000_000n;
export const DEEP_MINIMUM_NATIVE_LIQUIDITY_FOR_COMPLETION_WEI =
  DEEP_GROWTH_TARGET_WEI - DEEP_COMPLETION_TOLERANCE_WEI;

export const deepLaunchAbi = parseAbi([
  "function launch((string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps) parameters) payable returns ((address token,address growthVault,address oracleGuard,address upstreamRewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,bytes32 poolId,bytes32 vaultConfigurationHash,bytes32 launchHash) result)",
  "function predictTokenAddress(string name,string symbol,address deployer,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function rangeSourceFactory() view returns (address)",
  "function growthVaultFactory() view returns (address)",
  "function automation() view returns (address)",
  "function positionPlanner() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function TOKEN_RESERVE_TARGET() view returns (uint256)",
  "function GROWTH_TARGET_NATIVE() view returns (uint256)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
  "function INITIAL_TICK() view returns (int24)",
  "function TICK_SPACING() view returns (int24)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TWAP_WINDOW() view returns (uint32)",
  "function MAX_SPOT_TWAP_DEVIATION_TICKS() view returns (int24)",
  "function MAX_ABS_TICK_DELTA() view returns (int24)",
  "function launchHashOf(address token) view returns (bytes32)",
  "function growthVaultOf(address token) view returns (address)",
]);

export const deepHookReadAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function maxAbsTickDelta() view returns (int24)",
  "function LAUNCHER_FEE_BPS() view returns (uint16)",
  "function MIN_TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function MAX_TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function TOTAL_SWAP_FEE_STEP_BPS() view returns (uint16)",
  "function TRANSFER_TAX_BPS() view returns (uint16)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
  "function launcherFeesAccrued() view returns (uint256)",
  "function feeDisclosure(bytes32 poolId) view returns (uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips,address rewardVault)",
  "function poolFeeConfig(bytes32 poolId) view returns (address rewardVault,address registrar,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bool registered,uint256 creatorFeesAccrued)",
]);

export const deepHookFactoryReadAbi = parseAbi([
  "function ALL_HOOK_MASK() view returns (uint160)",
  "function REQUIRED_HOOK_FLAGS() view returns (uint160)",
  "function isFactoryHook(address hook) view returns (bool)",
]);

export const deepGrowthVaultReadAbi = parseAbi([
  "function feeHook() view returns (address)",
  "function poolManager() view returns (address)",
  "function oracleGuard() view returns (address)",
  "function upstreamVault() view returns (address)",
  "function poolId() view returns (bytes32)",
  "function token() view returns (address)",
  "function configurationHash() view returns (bytes32)",
  "function beneficiaryCount() view returns (uint256)",
  "function beneficiaryAt(uint256 index) view returns (address)",
  "function shareBpsOf(address beneficiary) view returns (uint16)",
  "function payoutAddressOf(address beneficiary) view returns (address)",
  "function claimedBy(address beneficiary) view returns (uint256)",
  "function claimable(address beneficiary) view returns (uint256)",
  "function growthTargetNative() view returns (uint256)",
  "function completionToleranceNative() view returns (uint256)",
  "function minimumNativeLiquidityForCompletion() view returns (uint256)",
  "function tokenReserveTarget() view returns (uint256)",
  "function totalNativeAllocatedToGrowth() view returns (uint256)",
  "function totalNativeAddedToLiquidity() view returns (uint256)",
  "function totalRewardFeesReceived() view returns (uint256)",
  "function deferredRewardFees() view returns (uint256)",
  "function pendingGrowthNative() view returns (uint256)",
  "function growthTargetReached() view returns (bool)",
  "function oracleReady() view returns (bool)",
  "function workState() view returns (uint8 action,uint256 hookCreatorFees,uint256 pendingNative,uint256 nextCompoundTimestamp,uint256 trustedNativeDepth,uint256 depthCapNative)",
  "function claimRewards() returns (uint256 amount)",
  "function setPayoutAddress(address newPayoutAddress)",
]);

export const deepGrowthVaultFactoryReadAbi = parseAbi([
  "function implementation() view returns (address)",
  "function hookFactory() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function positionManager() view returns (address)",
  "function poolManager() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function rangeSourceFactory() view returns (address)",
  "function isFactoryVault(address vault) view returns (bool)",
]);

export const deepGrowthVaultImplementationReadAbi = parseAbi([
  "function FACTORY() view returns (address)",
  "function MIN_UTILIZATION_BPS() view returns (uint16)",
  "function TRUSTED_DEPTH_CAP_BPS() view returns (uint16)",
  "function MAX_COMPOUND_NATIVE() view returns (uint256)",
  "function MIN_COMPOUND_NATIVE() view returns (uint256)",
  "function COMPOUND_COOLDOWN_SECONDS() view returns (uint64)",
  "function STRESS_TICK() view returns (int24)",
]);

export const deepAutomationReadAbi = parseAbi([
  "function vaultFactory() view returns (address)",
  "function launcher() view returns (address)",
  "function MAX_BATCH_SIZE() view returns (uint256)",
  "function OBSERVATION_CARDINALITY_TARGET() view returns (uint16)",
  "function checkVault(address vault) view returns (uint8 action)",
]);

export const deepTokenLaunchedEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeTokenLaunched(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address growthVault,address oracleGuard,address upstreamRewardVault,address positionRecipient,uint256 positionTokenId,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 vaultConfigurationHash,bytes32 launchHash)",
);

export const deepConfiguredEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeConfigured(address indexed token,uint256 totalSupply,uint256 tokenReserve,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 nativeTarget,int24 tickLower,int24 tickUpper,uint32 twapWindow,int24 maxSpotTwapDeviationTicks,bytes32 launchHash)",
);

export const deepInitialBuyEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeCreatorInitialBuy(address indexed deployer,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,bytes32 launchHash)",
);

export const deepNativeSwapFeesAccruedEvent = parseAbiItem(
  "event NativeSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,bool indexed isBuy,uint16 appliedTotalSwapFeeBps,uint256 grossNativeAmount,uint256 creatorFee,uint256 launcherFee)",
);

export const deepRewardFeesClaimedEvent = parseAbiItem(
  "event RewardFeesClaimed(address indexed beneficiary,address indexed payoutAddress,uint256 amount,uint256 beneficiaryTotalClaimed)",
);

export type DeepLaunchConfiguration = ClassicV3LaunchConfiguration;

export function validateDeepLaunchDraft(
  draft: LaunchDraft,
  launcherAccount: string,
): DeepLaunchConfiguration {
  if (draft.launchModel !== "deep") {
    throw new LaunchInputError("Choose the Deep launch model");
  }

  return validateClassicV3LaunchDraft(
    { ...draft, launchModel: "classic-v3" },
    launcherAccount,
  );
}

export function encodeDeepLaunch(
  draft: LaunchDraft,
  creatorSalt: Hex,
  launcherAccount: string,
) {
  const configuration = validateDeepLaunchDraft(draft, launcherAccount);
  return encodeFunctionData({
    abi: deepLaunchAbi,
    functionName: "launch",
    args: [
      {
        name: draft.tokenName.trim(),
        symbol: draft.tokenSymbol.trim(),
        buySwapFeeBps: configuration.fees.buySwapFeeBps,
        sellSwapFeeBps: configuration.fees.sellSwapFeeBps,
        creatorSalt,
        metadata: {
          description: draft.tokenDescription.trim(),
          website: normalizeOptionalHttpsUrl(
            draft.tokenWebsite,
            "the website",
            MAX_METADATA_URL_BYTES,
          ),
          image: normalizeOptionalHttpsUrl(
            draft.tokenImage,
            "the token image URL",
            MAX_METADATA_URL_BYTES,
          ),
          extraData: encodeMemeMetadataExtraData(draft),
        },
        rewardBeneficiaries: configuration.rewards.beneficiaries,
        rewardSharesBps: configuration.rewards.sharesBps,
      },
    ],
  });
}

export function deepPresetDisclosure() {
  return {
    growthTarget: `${DEEP_GROWTH_TARGET_ETH} ETH`,
    initialPosition: `${DEEP_INITIAL_POSITION_WHOLE / 1_000_000}M tokens`,
    lockedReserve: `${DEEP_TOKEN_RESERVE_WHOLE / 1_000_000}M tokens`,
    summary:
      "Creator fees deepen the original permanently locked pool before creator rewards begin.",
    reserve:
      "Unused reserve stays locked in the vault and is not active liquidity.",
    automation:
      "Execution is permissionless and may be delayed. The 30-minute same-pool TWAP is a circuit breaker, not an independent price oracle.",
    review: "This model has not received an independent external audit.",
  } as const;
}

export type DeepLaunchRecord = {
  deployer: Address;
  token: Address;
  poolId: Hex;
  feeHook: Address;
  growthVault: Address;
  oracleGuard: Address;
  upstreamRewardVault: Address;
  positionRecipient: Address;
  positionTokenId: bigint;
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  vaultConfigurationHash: Hex;
  launchHash: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
};
