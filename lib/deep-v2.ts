import {
  encodeFunctionData,
  getAddress,
  isAddress,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";

import {
  deepHookFactoryReadAbi,
  deepHookReadAbi,
} from "./deep-v1";
import {
  PLATFORM_FEE_BPS,
  REWARD_SHARE_BPS,
  type LaunchDraft,
} from "./launch";
import {
  encodeMemeMetadataExtraData,
  LaunchInputError,
  MAX_METADATA_URL_BYTES,
  normalizeOptionalHttpsUrl,
  validateMemeLaunchDraft,
} from "./launch-transaction";

export const DEEP_V2_RELEASE_VERSION = "deep-full-range-v2";
export const DEEP_V2_INTERNAL_CONTRACT_RELEASE =
  "liquidity-growth-full-range-v2";
export const DEEP_V2_RELEASE_MANIFEST =
  "contracts/deployments/mainnet-deep-full-range-v2.json";
export const DEEP_V2_KEEPER_RELEASE_VERSION = "deep-keeper-v2";
export const DEEP_V2_KEEPER_COMPATIBILITY_STATUS = "verified-deep-v2";

export const DEEP_V2_FIXED_POLICY = {
  tokenSupplyWei: 1_000_000_000n * 10n ** 18n,
  tokenReserveTargetWei: 150_000_000n * 10n ** 18n,
  growthTargetNativeWei: 50_000_000_000_000_000n,
  totalSwapFeeBps: 100,
  creatorFeeBps: 90,
  programmableFeeBps: 10,
  minimumInitialBuyWei: 600_000_000_000_000n,
  initialTick: 204_200,
  tickSpacing: 200,
  lpFeePips: 0,
  twapWindowSeconds: 1_800,
  oracleRangeHalfWidthTicks: 20_000,
  maximumSpotTwapDeviationTicks: 600,
  maximumAbsoluteTickDelta: 400,
} as const;

export const DEEP_V2_AUTOMATION_POLICY = {
  maximumBatchSize: 32,
  initialObservationCardinalityNext: 2,
  observationCardinalityStep: 16,
  observationCardinalityTarget: 192,
  minimumOracleActivationNativeWei: 2_000_000_000_000_000n,
  minimumUtilizationBps: 8_500,
  trustedDepthCapBps: 25,
  maximumCompoundNativeWei: 250_000_000_000_000_000n,
  minimumCompoundNativeWei: 2_000_000_000_000_000n,
  minimumKeeperProcessNativeWei: 2_000_000_000_000_000n,
  compoundCooldownSeconds: 300,
  rollingExposureWindowSeconds: 1_800,
  rollingExposureRecordCapacity: 8,
  stressTick: 218_000,
  fullRangeTickLower: -887_200,
  fullRangeTickUpper: 887_200,
} as const;

export const DEEP_V2_MANIFEST_FIXED_POLICY = {
  tokenSupplyWei: DEEP_V2_FIXED_POLICY.tokenSupplyWei.toString(),
  tokenReserveTargetWei:
    DEEP_V2_FIXED_POLICY.tokenReserveTargetWei.toString(),
  growthTargetNativeWei:
    DEEP_V2_FIXED_POLICY.growthTargetNativeWei.toString(),
  totalSwapFeeBps: DEEP_V2_FIXED_POLICY.totalSwapFeeBps,
  creatorFeeBps: DEEP_V2_FIXED_POLICY.creatorFeeBps,
  programmableFeeBps: DEEP_V2_FIXED_POLICY.programmableFeeBps,
  minimumInitialBuyWei:
    DEEP_V2_FIXED_POLICY.minimumInitialBuyWei.toString(),
  initialTick: DEEP_V2_FIXED_POLICY.initialTick,
  tickSpacing: DEEP_V2_FIXED_POLICY.tickSpacing,
  lpFeePips: DEEP_V2_FIXED_POLICY.lpFeePips,
  twapWindowSeconds: DEEP_V2_FIXED_POLICY.twapWindowSeconds,
  oracleRangeHalfWidthTicks:
    DEEP_V2_FIXED_POLICY.oracleRangeHalfWidthTicks,
  maximumSpotTwapDeviationTicks:
    DEEP_V2_FIXED_POLICY.maximumSpotTwapDeviationTicks,
  maximumAbsoluteTickDelta:
    DEEP_V2_FIXED_POLICY.maximumAbsoluteTickDelta,
  compoundCooldownSeconds:
    DEEP_V2_AUTOMATION_POLICY.compoundCooldownSeconds,
  rollingExposureWindowSeconds:
    DEEP_V2_AUTOMATION_POLICY.rollingExposureWindowSeconds,
  rollingExposureRecordCapacity:
    DEEP_V2_AUTOMATION_POLICY.rollingExposureRecordCapacity,
  minimumKeeperProcessNativeWei:
    DEEP_V2_AUTOMATION_POLICY.minimumKeeperProcessNativeWei.toString(),
  oracleObservationCardinalityTarget:
    DEEP_V2_AUTOMATION_POLICY.observationCardinalityTarget,
} as const;

export const deepV2LaunchAbi = parseAbi([
  "function launch((string name,string symbol,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata) parameters) payable returns ((address token,address growthVault,address oracleGuard,address upstreamRewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,bytes32 poolId,bytes32 vaultConfigurationHash,bytes32 launchHash) result)",
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
  "function TOKEN_DECIMALS() view returns (uint8)",
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function TOKEN_RESERVE_TARGET() view returns (uint256)",
  "function GROWTH_TARGET_NATIVE() view returns (uint256)",
  "function TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function CREATOR_FEE_BPS() view returns (uint16)",
  "function PROGRAMMABLE_FEE_BPS() view returns (uint16)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
  "function MAX_TOKEN_NAME_BYTES() view returns (uint256)",
  "function MAX_TOKEN_SYMBOL_BYTES() view returns (uint256)",
  "function MAX_TOKEN_DESCRIPTION_BYTES() view returns (uint256)",
  "function MAX_METADATA_URL_BYTES() view returns (uint256)",
  "function MAX_SOCIAL_EXTRA_DATA_BYTES() view returns (uint256)",
  "function INITIAL_TICK() view returns (int24)",
  "function TICK_SPACING() view returns (int24)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TWAP_WINDOW() view returns (uint32)",
  "function ORACLE_RANGE_HALF_WIDTH_TICKS() view returns (int24)",
  "function MAX_SPOT_TWAP_DEVIATION_TICKS() view returns (int24)",
  "function MAX_ABS_TICK_DELTA() view returns (int24)",
  "function launchHashOf(address token) view returns (bytes32)",
  "function growthVaultOf(address token) view returns (address)",
]);

// V2 deliberately reuses the reviewed V1 composite fee-oracle hook and its
// deterministic factory. These aliases make that shared dependency explicit.
export const deepV2HookReadAbi = deepHookReadAbi;
export const deepV2HookFactoryReadAbi = deepHookFactoryReadAbi;

export const deepV2GrowthVaultReadAbi = parseAbi([
  "function feeHook() view returns (address)",
  "function poolManager() view returns (address)",
  "function oracleGuard() view returns (address)",
  "function positionManager() view returns (address)",
  "function upstreamVault() view returns (address)",
  "function poolId() view returns (bytes32)",
  "function token() view returns (address)",
  "function initialPositionTokenId() view returns (uint256)",
  "function initialPositionRecipient() view returns (address)",
  "function growthTargetNative() view returns (uint256)",
  "function tokenReserveTarget() view returns (uint256)",
  "function completionToleranceNative() view returns (uint256)",
  "function minimumNativeLiquidityForCompletion() view returns (uint256)",
  "function beneficiaryCount() view returns (uint256)",
  "function creator() view returns (address)",
  "function configurationHash() view returns (bytes32)",
  "function initialized() view returns (bool)",
  "function shareBpsOf(address beneficiary) view returns (uint16)",
  "function payoutAddressOf(address beneficiary) view returns (address)",
  "function claimedBy(address beneficiary) view returns (uint256)",
  "function totalCreatorFeesReceived() view returns (uint256)",
  "function totalNativeAllocatedToGrowth() view returns (uint256)",
  "function totalRewardFeesReceived() view returns (uint256)",
  "function deferredRewardFees() view returns (uint256)",
  "function totalRewardFeesClaimed() view returns (uint256)",
  "function pendingGrowthNative() view returns (uint256)",
  "function totalNativeAddedToLiquidity() view returns (uint256)",
  "function totalTokenBudgeted() view returns (uint256)",
  "function totalTokenAddedToLiquidity() view returns (uint256)",
  "function totalLiquidityAdded() view returns (uint256)",
  "function totalNativeRecycled() view returns (uint256)",
  "function totalTokenRecycled() view returns (uint256)",
  "function lastCompoundTimestamp() view returns (uint64)",
  "function growthTargetReached() view returns (bool)",
  "function nativeLiquidityShortfallAtCompletion() view returns (uint256)",
  "function FACTORY() view returns (address)",
  "function BASIS_POINTS() view returns (uint16)",
  "function MIN_UTILIZATION_BPS() view returns (uint16)",
  "function TRUSTED_DEPTH_CAP_BPS() view returns (uint16)",
  "function MAX_COMPOUND_NATIVE() view returns (uint256)",
  "function MIN_COMPOUND_NATIVE() view returns (uint256)",
  "function MIN_KEEPER_PROCESS_NATIVE() view returns (uint256)",
  "function COMPOUND_COOLDOWN_SECONDS() view returns (uint64)",
  "function ROLLING_EXPOSURE_WINDOW_SECONDS() view returns (uint64)",
  "function ROLLING_EXPOSURE_RECORD_CAPACITY() view returns (uint8)",
  "function STRESS_TICK() view returns (int24)",
  "function MAX_ABS_TICK_DELTA() view returns (int24)",
  "function TWAP_WINDOW() view returns (uint32)",
  "function MAX_SPOT_TWAP_DEVIATION_TICKS() view returns (int24)",
  "function FULL_RANGE_TICK_LOWER() view returns (int24)",
  "function FULL_RANGE_TICK_UPPER() view returns (int24)",
  "function LOCKED_POSITION_SALT() view returns (bytes32)",
  "function process() returns (uint256 received,(uint256 nativeBudget,uint256 tokenBudget,uint256 nativeAdded,uint256 tokenAdded,uint256 nativeRecycled,uint256 tokenRecycled,uint128 liquidityAdded,uint256 nativeDust) compoundResult)",
  "function compoundPending() returns ((uint256 nativeBudget,uint256 tokenBudget,uint256 nativeAdded,uint256 tokenAdded,uint256 nativeRecycled,uint256 tokenRecycled,uint128 liquidityAdded,uint256 nativeDust) result)",
  "function workState() view returns (uint8 action,uint256 hookCreatorFees,uint256 pendingNative,uint256 nextCompoundTimestamp,uint256 trustedNativeDepth,uint256 depthCapNative)",
  "function trustedDepthAndCap() view returns (uint256 nativeVirtualDepth,uint256 depthCapNative)",
  "function rollingWindowNativeAdded() view returns (uint256 activeExposure)",
  "function rollingWindowCapacity() view returns (uint256 activeExposure,uint256 depthCapNative,uint256 remainingCapacity)",
  "function oracleReady() view returns (bool ready)",
  "function beneficiaryAt(uint256 index) view returns (address)",
  "function lockedLiquidity() view returns (uint128 liquidity)",
  "function claimable(address beneficiary) view returns (uint256 amount)",
  "function setPayoutAddress(address newPayoutAddress)",
  "function claimRewards() returns (uint256 amount)",
]);

export const deepV2GrowthVaultFactoryReadAbi = parseAbi([
  "function implementation() view returns (address)",
  "function hookFactory() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function positionManager() view returns (address)",
  "function poolManager() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function rangeSourceFactory() view returns (address)",
  "function configurationHashOf(address vault) view returns (bytes32)",
  "function initializationCommitment(address vault) view returns (bytes32)",
  "function isFactoryVault(address vault) view returns (bool)",
]);

export const deepV2GrowthVaultImplementationReadAbi =
  deepV2GrowthVaultReadAbi;

export const deepV2AutomationReadAbi = parseAbi([
  "function vaultFactory() view returns (address)",
  "function launcher() view returns (address)",
  "function MAX_BATCH_SIZE() view returns (uint256)",
  "function INITIAL_OBSERVATION_CARDINALITY_NEXT() view returns (uint16)",
  "function OBSERVATION_CARDINALITY_STEP() view returns (uint16)",
  "function OBSERVATION_CARDINALITY_TARGET() view returns (uint16)",
  "function MIN_ORACLE_ACTIVATION_NATIVE() view returns (uint256)",
  "function isRegisteredVault(address vault) view returns (bool)",
  "function registeredVaultCount() view returns (uint256)",
  "function registeredVaultAt(uint256 index) view returns (address)",
  "function registerAndStageOracle(address vaultAddress)",
  "function stageOracle(address vaultAddress) returns (bool grew,uint16 previousCardinalityNext,uint16 newCardinalityNext)",
  "function stageOracleBatch(address[] candidates) returns (uint256 attempted,uint256 succeeded)",
  "function checkVault(address vaultAddress) view returns (uint8 action)",
  "function checkBatch(address[] candidates) view returns ((address vault,uint8 action)[] ready)",
  "function scan(uint256 cursor,uint256 limit) view returns ((address vault,uint8 action)[] ready,uint256 nextCursor)",
  "function performVault(address vaultAddress) returns (bool succeeded,uint8 action)",
  "function performBatch(address[] candidates) returns (uint256 attempted,uint256 succeeded)",
  "function assessVault(address vaultAddress) view returns (uint8 action)",
]);

export const deepV2TokenLaunchedEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeTokenLaunchedV2(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address growthVault,address oracleGuard,address upstreamRewardVault,address positionRecipient,uint256 positionTokenId,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 vaultConfigurationHash,bytes32 launchHash)",
);

export const deepV2ConfiguredEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeConfiguredV2(address indexed token,uint256 totalSupply,uint256 tokenReserve,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 nativeTarget,int24 tickLower,int24 tickUpper,uint32 twapWindow,int24 maxSpotTwapDeviationTicks,bytes32 launchHash)",
);

export const deepV2InitialBuyEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeCreatorInitialBuyV2(address indexed deployer,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,bytes32 launchHash)",
);

export const deepV2VaultDeployedEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeVaultDeployedV2(address indexed vault,address indexed feeHook,bytes32 indexed poolId,address upstreamVault,bytes32 salt,bytes32 configurationHash)",
);

export const deepV2VaultRegisteredEvent = parseAbiItem(
  "event VaultRegistered(address indexed vault,bytes32 indexed poolId,uint256 indexed registryIndex)",
);

export const deepV2WorkPerformedEvent = parseAbiItem(
  "event WorkPerformed(address indexed vault,uint8 indexed action,address indexed executor)",
);

export type DeepV2LaunchConfiguration = {
  fees: {
    buySwapFeeBps: 100;
    sellSwapFeeBps: 100;
    buyCreatorFeeBps: 90;
    sellCreatorFeeBps: 90;
    platformFeeBps: typeof PLATFORM_FEE_BPS;
  };
  rewards: {
    beneficiaries: [Address];
    sharesBps: [typeof REWARD_SHARE_BPS];
  };
};

export function validateDeepV2LaunchDraft(
  draft: LaunchDraft,
  launcherAccount: string,
): DeepV2LaunchConfiguration {
  if (draft.launchModel !== "deep") {
    throw new LaunchInputError("Choose the Deep launch model");
  }
  validateMemeLaunchDraft(draft);
  if (
    draft.buySwapFeePercent.trim() !== "1" ||
    draft.sellSwapFeePercent.trim() !== "1"
  ) {
    throw new LaunchInputError(
      "Deep V2 uses a fixed 1.00% buy and sell fee",
    );
  }
  if (draft.rewardDestinationMode !== "launcher") {
    throw new LaunchInputError(
      "Deep V2 rewards are bound to the launch wallet",
    );
  }
  if (!isAddress(launcherAccount)) {
    throw new LaunchInputError(
      "Connect a valid Ethereum wallet before launching",
    );
  }

  return {
    fees: {
      buySwapFeeBps: 100,
      sellSwapFeeBps: 100,
      buyCreatorFeeBps: 90,
      sellCreatorFeeBps: 90,
      platformFeeBps: PLATFORM_FEE_BPS,
    },
    rewards: {
      beneficiaries: [getAddress(launcherAccount)],
      sharesBps: [REWARD_SHARE_BPS],
    },
  };
}

export function encodeDeepV2Launch(
  draft: LaunchDraft,
  creatorSalt: Hex,
  launcherAccount: string,
) {
  validateDeepV2LaunchDraft(draft, launcherAccount);
  return encodeFunctionData({
    abi: deepV2LaunchAbi,
    functionName: "launch",
    args: [
      {
        name: draft.tokenName.trim(),
        symbol: draft.tokenSymbol.trim(),
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
      },
    ],
  });
}

export function deepV2PresetDisclosure() {
  return {
    growthTarget: "0.05 ETH",
    initialPosition: "850M tokens",
    lockedReserve: "150M tokens",
    swapFee: "1.00%",
    growthAndCreatorFee: "0.90%",
    programmableFee: "0.10%",
    summary:
      "Creator fees deepen the original permanently locked pool before creator rewards begin.",
    reserve:
      "Unused reserve stays locked in the vault and is not active liquidity.",
    automation:
      "A funded external keeper may attempt eligible work after the five-minute cooldown. The same-pool 30-minute TWAP and rolling exposure cap can delay execution.",
    review: "This model has not received an independent external audit.",
  } as const;
}
