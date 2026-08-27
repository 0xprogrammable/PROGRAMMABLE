import {
  encodeFunctionData,
  formatEther,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

import {
  formatClassicV3Percent,
  validateClassicInitialBuyCustody,
  validateRewardConfiguration,
  type ClassicInitialBuyCustodyConfiguration,
  type ClassicV3FeeConfiguration,
  type ClassicV3RewardConfiguration,
} from "./classic-v3";
import {
  getClassicInitialBuyCurveQuote,
  parseClassicFeePercentToBps,
  PLATFORM_FEE_BPS,
  type ClassicLiquidityPreset,
  type LaunchDraft,
} from "./launch";
import {
  encodeMemeMetadataExtraData,
  LaunchInputError,
  MAX_METADATA_URL_BYTES,
  normalizeOptionalHttpsUrl,
  validateMemeLaunchDraft,
} from "./launch-transaction";

export const classicV4LaunchAbi = parseAbi([
  "function launchFor(address launchWallet,(string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps,(uint8 mode,uint16 durationDays,uint16 cliffDays) initialBuyCustody) parameters) payable returns ((address token,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,address initialBuyCustody,bytes32 poolId,bytes32 launchHash,address graduationVault,address finalPositionRecipient,uint256 graduationReserveAmount,uint256 finalPositionTokenId,uint128 finalLiquidity) result)",
  "function predictTokenAddress(string name,string symbol,address deployer,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function predictRewardVault(address token,address deployer,address[] beneficiaries,uint16[] sharesBps) view returns (address)",
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function rewardVaultFactory() view returns (address)",
  "function initialBuyVestingWalletFactory() view returns (address)",
  "function launchPolicy() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function positionPlanner() view returns (address)",
  "function graduationVaultFactory() view returns (address)",
  "function graduationVaultOf(address token) view returns (address)",
  "function finalPositionRecipientOf(address token) view returns (address)",
  "function graduate(address token) returns (uint256 finalPositionTokenId)",
  "function maxBuyAndGraduate(address token,address recipient) payable returns (uint256 tokenAmount,uint256 finalPositionTokenId)",
  "function ROUTER() view returns (address)",
  "function liquidityPresetForSalt(bytes32 creatorSalt) pure returns (uint8)",
  "function STANDARD_LIQUIDITY_PRESET() view returns (uint8)",
  "function BONDING_LIQUIDITY_PRESET() view returns (uint8)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
  "function MAX_REWARD_BENEFICIARIES() view returns (uint256)",
  "function REWARD_SHARE_BASIS_POINTS() view returns (uint16)",
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function INITIAL_TICK() view returns (int24)",
  "function TICK_SPACING() view returns (int24)",
  "function LP_FEE_PIPS() view returns (uint24)",
]);

export const CLASSIC_V4_LAUNCH_STAMP_ROUTER =
  "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56" as const;
export const CLASSIC_V4_LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH =
  "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546" as const;

export const classicV4HookAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function LAUNCHER_FEE_BPS() view returns (uint16)",
  "function MIN_TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function MAX_TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function TOTAL_SWAP_FEE_STEP_BPS() view returns (uint16)",
  "function TRANSFER_TAX_BPS() view returns (uint16)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
  "function BASIS_POINTS() view returns (uint16)",
  "function BONDING_TICK_LOWER() view returns (int24)",
  "function BONDING_TICK_UPPER() view returns (int24)",
  "function FINAL_TICK_LOWER() view returns (int24)",
  "function FINAL_TICK_UPPER() view returns (int24)",
  "function bondingState(bytes32 poolId) view returns (bool ready,bool completed,uint160 endpointSqrtPriceX96)",
  "function bondingProgress(bytes32 poolId) view returns (uint8 state,uint16 progressBps,uint256 tokenRemaining,uint256 nativeRemainingNet)",
  "function totalSwapFeeBpsFor(bytes32 poolId,bool isBuy) view returns (uint16)",
]);

export const classicV4HookFactoryAbi = parseAbi([
  "function isFactoryHook(address hook) view returns (bool)",
  "function REQUIRED_HOOK_FLAGS() view returns (uint160)",
]);

export const classicV4PositionPlannerAbi = parseAbi([
  "function STANDARD_PRESET() view returns (uint8)",
  "function BONDING_PRESET() view returns (uint8)",
  "function DEEP30_PRESET() view returns (uint8)",
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function BONDING_TOKEN_ALLOCATION() view returns (uint256)",
  "function GRADUATION_TOKEN_RESERVE() view returns (uint256)",
  "function INITIAL_TICK() view returns (int24)",
  "function BONDING_TICK_LOWER() view returns (int24)",
  "function DEEP30_TICK_LOWER() view returns (int24)",
  "function FINAL_TICK_LOWER() view returns (int24)",
  "function FINAL_TICK_UPPER() view returns (int24)",
  "function TICK_SPACING() view returns (int24)",
]);

export const classicGraduationVaultV1Abi = parseAbi([
  "function bondingMaxBuyQuote() view returns (uint256 grossNativeAmount,uint256 netNativeAmount)",
  "function maxBuyAndGraduate(address recipient) payable returns (uint256 tokenAmount,uint256 finalPositionTokenId)",
  "function graduate()",
  "function graduated() view returns (bool)",
  "function finalPositionTokenId() view returns (uint256)",
  "function poolId() view returns (bytes32)",
]);

export const classicGraduationVaultFactoryV1Abi = parseAbi([
  "function positionManager() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function isFactoryVault(address vault) view returns (bool)",
]);

export type ClassicV4LiquidityConfiguration = {
  preset: ClassicLiquidityPreset;
  presetCode: 0 | 1;
};

export type ClassicV4LaunchConfiguration = {
  fees: ClassicV3FeeConfiguration;
  liquidity: ClassicV4LiquidityConfiguration;
  rewards: ClassicV3RewardConfiguration;
  initialBuyCustody: ClassicInitialBuyCustodyConfiguration;
};

export type ClassicV4LaunchDisclosure = {
  buyFee: string;
  sellFee: string;
  rewards: readonly {
    beneficiary: `0x${string}`;
    share: string;
  }[];
  liquidity: string;
  activationBuy: string;
  initialBuyCustody: string;
};

function compactEther(value: bigint, maximumFractionDigits = 6) {
  const [whole, fraction = ""] = formatEther(value).split(".");
  const trimmed = fraction.slice(0, maximumFractionDigits).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function requireClassicV4FeeBps(value: string, label: string) {
  const basisPoints = parseClassicFeePercentToBps(value);
  if (basisPoints === null) {
    throw new LaunchInputError(
      `${label} must be from 0.1% to 10% in 0.1% steps`,
    );
  }
  return basisPoints;
}

function readLiquidityPreset(value: unknown): ClassicV4LiquidityConfiguration {
  if (value === undefined || value === null || value === "standard") {
    return { preset: "standard", presetCode: 0 };
  }
  if (value === "bonding" || value === "deep-30") {
    return { preset: "bonding", presetCode: 1 };
  }
  throw new LaunchInputError("Choose a valid Classic liquidity mode");
}

export function validateClassicV4LaunchDraft(
  draft: LaunchDraft,
  launcherAccount: string,
): ClassicV4LaunchConfiguration {
  if (draft.launchModel !== "classic-v3") {
    throw new LaunchInputError("Choose the Classic launch model");
  }

  validateMemeLaunchDraft({
    ...draft,
    launchModel: "classic",
    totalSwapFeePercent: "1",
  });

  const buySwapFeeBps = requireClassicV4FeeBps(
    draft.buySwapFeePercent,
    "Buy fee",
  );
  const sellSwapFeeBps = requireClassicV4FeeBps(
    draft.sellSwapFeePercent,
    "Sell fee",
  );
  const liquidity = readLiquidityPreset(
    (draft as Partial<LaunchDraft>).classicLiquidityPreset,
  );
  const activationBuy = getClassicInitialBuyCurveQuote(
    draft.initialBuyEth,
    draft.buySwapFeePercent,
    liquidity.preset,
  );
  if (activationBuy.status === "over-capacity") {
    throw new LaunchInputError(
      `Activation Buy exceeds the ${liquidity.preset === "bonding" ? "Bonding" : "Classic"} curve. Use at most ${compactEther(activationBuy.maximumGrossActivationBuyWei)} ETH at this buy fee`,
    );
  }
  if (activationBuy.status !== "ready") {
    throw new LaunchInputError("Enter a valid Activation Buy");
  }

  return {
    fees: {
      buySwapFeeBps,
      sellSwapFeeBps,
      buyCreatorFeeBps: buySwapFeeBps - PLATFORM_FEE_BPS,
      sellCreatorFeeBps: sellSwapFeeBps - PLATFORM_FEE_BPS,
      platformFeeBps: PLATFORM_FEE_BPS,
    },
    liquidity,
    rewards: validateRewardConfiguration(draft, launcherAccount),
    initialBuyCustody: validateClassicInitialBuyCustody(draft),
  };
}

export function encodeClassicV4Launch(
  draft: LaunchDraft,
  creatorSalt: Hex,
  launcherAccount: Address,
) {
  const configuration = validateClassicV4LaunchDraft(draft, launcherAccount);
  const presetSalt = encodeClassicV4PresetSalt(
    creatorSalt,
    configuration.liquidity.presetCode,
  );
  return encodeFunctionData({
    abi: classicV4LaunchAbi,
    functionName: "launchFor",
    args: [
      launcherAccount,
      {
        name: draft.tokenName.trim(),
        symbol: draft.tokenSymbol.trim(),
        buySwapFeeBps: configuration.fees.buySwapFeeBps,
        sellSwapFeeBps: configuration.fees.sellSwapFeeBps,
        creatorSalt: presetSalt,
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
        initialBuyCustody: {
          mode: configuration.initialBuyCustody.modeCode,
          durationDays: configuration.initialBuyCustody.durationDays,
          cliffDays: configuration.initialBuyCustody.cliffDays,
        },
      },
    ],
  });
}

export function encodeClassicV4PresetSalt(
  creatorSalt: Hex,
  presetCode: 0 | 1,
): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(creatorSalt)) {
    throw new LaunchInputError("The Classic launch salt is invalid");
  }
  return `0x${presetCode.toString(16).padStart(2, "0")}${creatorSalt.slice(4).toLowerCase()}` as Hex;
}

export function buildClassicV4LaunchDisclosure(
  draft: LaunchDraft,
  launcherAccount: string,
): ClassicV4LaunchDisclosure {
  const configuration = validateClassicV4LaunchDraft(draft, launcherAccount);
  const feeLine = (totalBps: number, creatorBps: number) =>
    `${formatClassicV3Percent(totalBps)} total · ${formatClassicV3Percent(
      creatorBps,
    )} creator · ${formatClassicV3Percent(PLATFORM_FEE_BPS)} Programmable`;

  const activationBuy = getClassicInitialBuyCurveQuote(
    draft.initialBuyEth,
    draft.buySwapFeePercent,
    configuration.liquidity.preset,
  );
  if (activationBuy.status !== "ready") {
    throw new LaunchInputError("Enter a valid Activation Buy");
  }

  return {
    buyFee: feeLine(
      configuration.fees.buySwapFeeBps,
      configuration.fees.buyCreatorFeeBps,
    ),
    sellFee: feeLine(
      configuration.fees.sellSwapFeeBps,
      configuration.fees.sellCreatorFeeBps,
    ),
    rewards: configuration.rewards.beneficiaries.map((beneficiary, index) => ({
      beneficiary,
      share: formatClassicV3Percent(configuration.rewards.sharesBps[index]),
    })),
    liquidity:
      configuration.liquidity.preset === "bonding"
        ? "Bonding · 80% sold on the launch curve · 20% reserved for the final permanently locked liquidity position · Max completes the same pool automatically"
        : "Standard · full one-sided range · one position, permanently locked",
    activationBuy:
      activationBuy.preview.remainingCurveCapacityWei === null
        ? `${compactEther(activationBuy.preview.grossEthWei)} ETH plus network gas`
        : `${compactEther(activationBuy.preview.grossEthWei)} ETH plus network gas · ${compactEther(activationBuy.preview.remainingCurveCapacityWei)} ETH net curve capacity remains`,
    initialBuyCustody:
      configuration.initialBuyCustody.mode === "unlocked"
        ? "Available immediately"
        : configuration.initialBuyCustody.mode === "fixed-lock"
          ? `Locked for ${configuration.initialBuyCustody.durationDays} days`
          : configuration.initialBuyCustody.mode === "linear"
            ? `Vested linearly over ${configuration.initialBuyCustody.durationDays} days`
            : `${configuration.initialBuyCustody.cliffDays}-day cliff, then vested through day ${configuration.initialBuyCustody.durationDays}`,
  };
}
