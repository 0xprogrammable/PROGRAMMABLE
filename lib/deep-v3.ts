import {
  encodeFunctionData,
  getAddress,
  isAddress,
  parseAbi,
  parseAbiItem,
  type Hex,
} from "viem";

import type { LaunchDraft } from "./launch";
import {
  encodeMemeMetadataExtraData,
  LaunchInputError,
  MAX_METADATA_URL_BYTES,
  normalizeOptionalHttpsUrl,
  validateMemeLaunchDraft,
} from "./launch-transaction";

export const DEEP_V3_RELEASE_VERSION = "deep-full-range-v3";
export const DEEP_V3_INTERNAL_CONTRACT_RELEASE =
  "liquidity-growth-full-range-v3";
export const DEEP_V3_RELEASE_MANIFEST =
  "contracts/deployments/mainnet-deep-full-range-v3.json";
export const DEEP_V3_KEEPER_RELEASE_VERSION =
  "deep-keeper-v3-ops-v2";
export const DEEP_V3_SOURCE_COMMITMENT =
  "0x902cc5e0737e604164e8962bcbdc536eb5df7a1aa508ee322736b2fd394fd440";
export const DEEP_V3_TREASURY =
  "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
export const DEEP_V3_LOCKED_POSITION_FACTORY =
  "0x291a9ff1059d225d02B1659430804486404dB507";
export const DEEP_V3_LOCKED_POSITION_FACTORY_RUNTIME_HASH =
  "0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2";
export const DEEP_V3_REQUIRED_HOOK_FLAGS = 0x3aecn;

export const DEEP_V3_OFFICIAL_DEPENDENCIES = {
  poolManager: {
    address: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    runtimeCodeHash:
      "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
    sourceRef: "v4-core@1.0.0",
  },
  positionManager: {
    address: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
    runtimeCodeHash:
      "0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b",
    sourceRef: "v4-periphery@2656054",
  },
  stateView: {
    address: "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",
    runtimeCodeHash:
      "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878",
    sourceRef: "v4-periphery@2656054",
  },
  v4Quoter: {
    address: "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203",
    runtimeCodeHash:
      "0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441",
    sourceRef: "v4-periphery@2656054",
  },
  uerc20Factory: {
    address: "0x000000e200088D55C39a11F609E5F667729ad49b",
    runtimeCodeHash:
      "0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb",
    sourceRef: "uerc20-factory@v2.0.0",
  },
  permit2: {
    address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    runtimeCodeHash:
      "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131",
    sourceRef: "permit2",
  },
  universalRouter: {
    address: "0xd92A36B0000531EF3063dEd4De20A0783308446C",
    runtimeCodeHash:
      "0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49",
    sourceRef: "universal-router@d2d9c4a",
  },
} as const;

export const DEEP_V3_FIXED_POLICY = {
  tokenSupplyWei: 1_000_000_000n * 10n ** 18n,
  totalHookFeeBps: 100,
  growthFeeBps: 90,
  programmableFeeBps: 10,
  transferTaxBps: 0,
  minimumInitialBuyWei: 600_000_000_000_000n,
  initialTick: 204_200,
  tickSpacing: 200,
  lpFeePips: 0,
  fullRangeTickLower: -887_200,
  fullRangeTickUpper: 887_200,
  maximumInitialBuyImpactTicks: 400,
  initialSqrtPriceX96: 2_151_813_121_295_408_910_812_139_624_586_144n,
  minimumInitialBuySqrtPriceLimitX96:
    2_109_206_475_762_646_020_212_180_903_141_694n,
  initialBuySlippageBps: 100,
  twapWindowSeconds: 1_800,
  shortTwapWindowSeconds: 300,
  compoundCooldownSeconds: 300,
  minimumCompoundNativeWei: 2_000_000_000_000_000n,
  maximumCompoundNativeWei: 250_000_000_000_000_000n,
  trustedDepthCycleCapBps: 25,
  rollingExposureWindowSeconds: 1_800,
  rollingExposureRecordCapacity: 8,
  oracleObservationCardinalityTarget: 192,
} as const;

export const DEEP_V3_MANIFEST_FIXED_POLICY = {
  tokenSupplyWei: DEEP_V3_FIXED_POLICY.tokenSupplyWei.toString(),
  totalSwapFeeBps: DEEP_V3_FIXED_POLICY.totalHookFeeBps,
  growthFeeBps: DEEP_V3_FIXED_POLICY.growthFeeBps,
  programmableFeeBps: DEEP_V3_FIXED_POLICY.programmableFeeBps,
  transferTaxBps: DEEP_V3_FIXED_POLICY.transferTaxBps,
  lpFeePips: DEEP_V3_FIXED_POLICY.lpFeePips,
  tickSpacing: DEEP_V3_FIXED_POLICY.tickSpacing,
  initialTick: DEEP_V3_FIXED_POLICY.initialTick,
  fullRangeTickLower: DEEP_V3_FIXED_POLICY.fullRangeTickLower,
  fullRangeTickUpper: DEEP_V3_FIXED_POLICY.fullRangeTickUpper,
  minimumInitialBuyWei:
    DEEP_V3_FIXED_POLICY.minimumInitialBuyWei.toString(),
  minimumCompoundNativeWei:
    DEEP_V3_FIXED_POLICY.minimumCompoundNativeWei.toString(),
  maximumCompoundNativeWei:
    DEEP_V3_FIXED_POLICY.maximumCompoundNativeWei.toString(),
  compoundCooldownSeconds:
    DEEP_V3_FIXED_POLICY.compoundCooldownSeconds,
  rollingExposureWindowSeconds:
    DEEP_V3_FIXED_POLICY.rollingExposureWindowSeconds,
  rollingExposureRecordCapacity:
    DEEP_V3_FIXED_POLICY.rollingExposureRecordCapacity,
  trustedDepthCycleCapBps:
    DEEP_V3_FIXED_POLICY.trustedDepthCycleCapBps,
  maximumOptimizerIterations: 64,
  twapWindowSeconds: DEEP_V3_FIXED_POLICY.twapWindowSeconds,
  shortTwapWindowSeconds: DEEP_V3_FIXED_POLICY.shortTwapWindowSeconds,
  oracleObservationCardinalityTarget:
    DEEP_V3_FIXED_POLICY.oracleObservationCardinalityTarget,
  maximumObservationTickDelta:
    DEEP_V3_FIXED_POLICY.maximumInitialBuyImpactTicks,
  maximumRawTruncatedTwapDeltaTicks: 25,
  maximumShortLongTwapDeviationTicks: 50,
  maximumPreSpotTwapDeviationTicks: 100,
  maximumInternalSwapImpactTicks: 25,
  maximumPostSpotTwapDeviationTicks: 125,
} as const;

export const deepV3LaunchAbi = parseAbi([
  "function launch((string name,string symbol,(string description,string website,string image,bytes extraData) metadata,bytes32 creatorSalt,uint256 minimumInitialTokenOut,uint160 initialBuySqrtPriceLimitX96,uint256 deadline) parameters) payable returns ((address token,bytes32 poolId,address growthVault,address positionRecipient,uint256 positionTokenId,address oracleGuard,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,uint256 initialLockedTokenDust,bytes32 vaultConfigurationHash,bytes32 launchHash) result)",
  "function predictTokenAddress(string name,string symbol,address deployer,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function growthVaultFactory() view returns (address)",
  "function automation() view returns (address)",
  "function positionPlanner() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function TOKEN_DECIMALS() view returns (uint8)",
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
  "function TOTAL_HOOK_FEE_BPS() view returns (uint16)",
  "function GROWTH_FEE_BPS() view returns (uint16)",
  "function PROGRAMMABLE_FEE_BPS() view returns (uint16)",
  "function INITIAL_TICK() view returns (int24)",
  "function TICK_SPACING() view returns (int24)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function MIN_INITIAL_BUY_SQRT_PRICE_LIMIT_X96() view returns (uint160)",
  "function launchHashOf(address token) view returns (bytes32)",
  "function growthVaultOf(address token) view returns (address)",
  "error InitialBuyOutputBelowMinimum(uint256 actual,uint256 minimum)",
]);

export const deepV3HookReadAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function growthVaultFactory() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function TOTAL_HOOK_FEE_BPS() view returns (uint16)",
  "function GROWTH_FEE_BPS() view returns (uint16)",
  "function PROGRAMMABLE_FEE_BPS() view returns (uint16)",
  "function TRANSFER_TAX_BPS() view returns (uint16)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
  "function maxAbsTickDelta() view returns (int24)",
]);

export const deepV3HookFactoryReadAbi = parseAbi([
  "function isFactoryHook(address hook) view returns (bool)",
  "function ALL_HOOK_MASK() view returns (uint160)",
  "function REQUIRED_HOOK_FLAGS() view returns (uint160)",
]);

export const deepV3GrowthVaultFactoryReadAbi = parseAbi([
  "function implementation() view returns (address)",
  "function planner() view returns (address)",
  "function configurationHashOf(address vault) view returns (bytes32)",
  "function isFactoryVault(address vault) view returns (bool)",
]);

export const deepV3GrowthVaultImplementationReadAbi = parseAbi([
  "function FACTORY() view returns (address)",
  "function TRUSTED_DEPTH_CYCLE_CAP_BPS() view returns (uint16)",
  "function MIN_COMPOUND_NATIVE() view returns (uint256)",
  "function MAX_COMPOUND_NATIVE() view returns (uint256)",
  "function COMPOUND_COOLDOWN_SECONDS() view returns (uint64)",
  "function ROLLING_EXPOSURE_WINDOW_SECONDS() view returns (uint64)",
  "function ROLLING_EXPOSURE_RECORD_CAPACITY() view returns (uint8)",
  "function TWAP_WINDOW() view returns (uint64)",
  "function SHORT_TWAP_WINDOW() view returns (uint64)",
  "function FULL_RANGE_TICK_LOWER() view returns (int24)",
  "function FULL_RANGE_TICK_UPPER() view returns (int24)",
]);

export const deepV3AutomationReadAbi = parseAbi([
  "function vaultFactory() view returns (address)",
  "function launcher() view returns (address)",
  "function MAX_BATCH_SIZE() view returns (uint256)",
  "function INITIAL_OBSERVATION_CARDINALITY_NEXT() view returns (uint16)",
  "function OBSERVATION_CARDINALITY_STEP() view returns (uint16)",
  "function OBSERVATION_CARDINALITY_TARGET() view returns (uint16)",
  "function MIN_ORACLE_ACTIVATION_NATIVE() view returns (uint256)",
]);

export const deepV3KeeperExecutorReadAbi = parseAbi([
  "function automation() view returns (address)",
  "function MAX_BATCH_SIZE() view returns (uint256)",
]);

export const deepV3LockedPositionFactoryReadAbi = parseAbi([
  "function positionManager() view returns (address)",
]);

export const deepV3TokenLaunchedEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeTokenLaunchedV3(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address growthVault,address positionRecipient,uint256 positionTokenId,bytes32 vaultConfigurationHash,bytes32 launchHash)",
);

export const deepV3ConfiguredEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeConfiguredV3(address indexed token,uint256 totalSupply,uint256 initialLockedTokenDust,uint16 totalHookFeeBps,uint16 growthFeeBps,uint16 programmableFeeBps,int24 initialTick,int24 fullRangeTickLower,int24 fullRangeTickUpper,bytes32 launchHash)",
);

export const deepV3InitialBuyEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeCreatorInitialBuyV3(address indexed deployer,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,uint160 sqrtPriceLimitX96,bytes32 launchHash)",
);

export type DeepV3LaunchProtection = {
  minimumInitialTokenOut: bigint;
  initialBuySqrtPriceLimitX96: bigint;
  deadline: bigint;
};

export type DeepV3LaunchConfiguration = {
  fees: {
    totalHookFeeBps: 100;
    growthFeeBps: 90;
    programmableFeeBps: 10;
    transferTaxBps: 0;
  };
};

export function validateDeepV3LaunchDraft(
  draft: LaunchDraft,
  launcherAccount: string,
): DeepV3LaunchConfiguration {
  if (draft.launchModel !== "deep") {
    throw new LaunchInputError("Choose the Deep launch model");
  }
  validateMemeLaunchDraft(draft);
  if (
    draft.buySwapFeePercent.trim() !== "1" ||
    draft.sellSwapFeePercent.trim() !== "1"
  ) {
    throw new LaunchInputError(
      "Deep uses a fixed 1.00% buy and sell fee",
    );
  }
  if (draft.rewardDestinationMode !== "launcher") {
    throw new LaunchInputError(
      "Deep does not support creator reward destinations",
    );
  }
  if (!isAddress(launcherAccount)) {
    throw new LaunchInputError(
      "Connect a valid Ethereum wallet before launching",
    );
  }

  getAddress(launcherAccount);
  return {
    fees: {
      totalHookFeeBps: 100,
      growthFeeBps: 90,
      programmableFeeBps: 10,
      transferTaxBps: 0,
    },
  };
}

function validateProtection(
  protection: DeepV3LaunchProtection,
): DeepV3LaunchProtection {
  if (protection.minimumInitialTokenOut <= 1n) {
    throw new LaunchInputError(
      "Deep requires meaningful initial buy output protection",
    );
  }
  if (
    protection.initialBuySqrtPriceLimitX96 !==
    DEEP_V3_FIXED_POLICY.minimumInitialBuySqrtPriceLimitX96
  ) {
    throw new LaunchInputError(
      "Deep requires the reviewed initial buy price limit",
    );
  }
  if (protection.deadline <= 0n) {
    throw new LaunchInputError("Deep requires a valid launch deadline");
  }
  return protection;
}

export function encodeDeepV3Launch(
  draft: LaunchDraft,
  creatorSalt: Hex,
  launcherAccount: string,
  rawProtection: DeepV3LaunchProtection,
) {
  validateDeepV3LaunchDraft(draft, launcherAccount);
  const protection = validateProtection(rawProtection);
  return encodeFunctionData({
    abi: deepV3LaunchAbi,
    functionName: "launch",
    args: [
      {
        name: draft.tokenName.trim(),
        symbol: draft.tokenSymbol.trim(),
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
        creatorSalt,
        minimumInitialTokenOut: protection.minimumInitialTokenOut,
        initialBuySqrtPriceLimitX96:
          protection.initialBuySqrtPriceLimitX96,
        deadline: protection.deadline,
      },
    ],
  });
}

export function deepV3PresetDisclosure() {
  return {
    swapFee: "1.00%",
    growthFee: "0.90%",
    programmableFee: "0.10%",
    summary:
      "The growth fee buys the token and adds both assets to the original permanently locked pool.",
    automation:
      "Automated execution has been removed. Deep remains unavailable while its execution model is redesigned.",
    rewards:
      "Deep does not pay creator rewards. The full 0.90% growth fee remains committed to locked liquidity.",
    protocolFees:
      "The 1.00% is the Deep hook fee. Any Uniswap protocol fee enabled for the pool is separate.",
    review: "This model has not received an independent external audit.",
  } as const;
}
