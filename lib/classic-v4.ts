import { encodeFunctionData, parseAbi, type Hex } from "viem";

import {
  formatClassicV3Percent,
  validateClassicInitialBuyCustody,
  validateRewardConfiguration,
  type ClassicInitialBuyCustodyConfiguration,
  type ClassicV3FeeConfiguration,
  type ClassicV3RewardConfiguration,
} from "./classic-v3";
import {
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
  "function launch((string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint8 liquidityPreset,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps,(uint8 mode,uint16 durationDays,uint16 cliffDays) initialBuyCustody) parameters) payable returns ((address token,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,address initialBuyCustody,bytes32 poolId,bytes32 launchHash) result)",
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
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
  "function MAX_REWARD_BENEFICIARIES() view returns (uint256)",
  "function REWARD_SHARE_BASIS_POINTS() view returns (uint16)",
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
  initialBuyCustody: string;
};

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
  if (value === "deep-30") {
    return { preset: "deep-30", presetCode: 1 };
  }
  throw new LaunchInputError("Choose a valid Classic liquidity depth");
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
  launcherAccount: string,
) {
  const configuration = validateClassicV4LaunchDraft(draft, launcherAccount);
  return encodeFunctionData({
    abi: classicV4LaunchAbi,
    functionName: "launch",
    args: [
      {
        name: draft.tokenName.trim(),
        symbol: draft.tokenSymbol.trim(),
        buySwapFeeBps: configuration.fees.buySwapFeeBps,
        sellSwapFeeBps: configuration.fees.sellSwapFeeBps,
        liquidityPreset: configuration.liquidity.presetCode,
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
        initialBuyCustody: {
          mode: configuration.initialBuyCustody.modeCode,
          durationDays: configuration.initialBuyCustody.durationDays,
          cliffDays: configuration.initialBuyCustody.cliffDays,
        },
      },
    ],
  });
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
      configuration.liquidity.preset === "deep-30"
        ? "Deeper · about 30% higher active liquidity at launch · bounded to about 18.9× the opening price and about 5.9 ETH net curve capacity · one position, permanently locked"
        : "Standard · full one-sided range · one position, permanently locked",
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
