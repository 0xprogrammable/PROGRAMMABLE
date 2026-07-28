import {
  encodeFunctionData,
  getAddress,
  isAddress,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

import {
  CLASSIC_V3_FEE_STEP_BPS,
  CLASSIC_V3_MAX_FEE_BPS,
  CLASSIC_V3_MAX_REWARD_BENEFICIARIES,
  CLASSIC_V3_MIN_FEE_BPS,
  PLATFORM_FEE_BPS,
  REWARD_SHARE_BPS,
  type LaunchDraft,
  type RewardSplitDraft,
} from "./launch";
import {
  encodeMemeMetadataExtraData,
  LaunchInputError,
  normalizeOptionalHttpsUrl,
  validateMemeLaunchDraft,
  MAX_METADATA_URL_BYTES,
} from "./launch-transaction";

export const classicV3LaunchAbi = parseAbi([
  "function launch((string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps) parameters) payable returns ((address token,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,bytes32 poolId,bytes32 launchHash) result)",
  "function predictTokenAddress(string name,string symbol,address deployer,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function predictRewardVault(address token,address deployer,address[] beneficiaries,uint16[] sharesBps) view returns (address)",
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
]);

export const classicV3HookAbi = parseAbi([
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
  "function feeDisclosure(bytes32 poolId) view returns (uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips,address rewardVault)",
  "function poolFeeConfig(bytes32 poolId) view returns (address rewardVault,address registrar,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bool registered,uint256 creatorFeesAccrued)",
]);

export const classicV3HookFactoryAbi = parseAbi([
  "function isFactoryHook(address hook) view returns (bool)",
]);

export const feeSplitVaultFactoryAbi = parseAbi([
  "function isFactoryVault(address vault) view returns (bool)",
]);

export const feeSplitVaultAbi = parseAbi([
  "function feeHook() view returns (address)",
  "function poolId() view returns (bytes32)",
  "function configurationHash() view returns (bytes32)",
  "function beneficiaryCount() view returns (uint256)",
  "function beneficiaryAt(uint256 index) view returns (address)",
  "function shareBpsOf(address beneficiary) view returns (uint16)",
  "function payoutAddressOf(address beneficiary) view returns (address)",
  "function claimedBy(address beneficiary) view returns (uint256)",
  "function totalCreatorFeesReceived() view returns (uint256)",
  "function totalCreatorFeesClaimed() view returns (uint256)",
  "function claimable(address beneficiary) view returns (uint256)",
  "function setPayoutAddress(address newPayoutAddress)",
  "function claim() returns (uint256 amount)",
]);

export type ClassicV3RewardConfiguration = {
  beneficiaries: Address[];
  sharesBps: number[];
};

export type ClassicV3FeeConfiguration = {
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  buyCreatorFeeBps: number;
  sellCreatorFeeBps: number;
  platformFeeBps: typeof PLATFORM_FEE_BPS;
};

export type ClassicV3LaunchConfiguration = {
  fees: ClassicV3FeeConfiguration;
  rewards: ClassicV3RewardConfiguration;
};

export type ClassicV3LaunchDisclosure = {
  buyFee: string;
  sellFee: string;
  rewards: readonly {
    beneficiary: Address;
    share: string;
  }[];
};

export type ClassicV3DeploymentManifest = {
  chainId: number;
  classicV3Status?: string;
  ethCreatorFeeHookFactoryV3?: string | null;
  ethCreatorFeeHookV3?: string | null;
  feeSplitVaultFactoryV1?: string | null;
  memeLaunchV2?: string | null;
  lockedPositionFeeForwarderFactory?: string | null;
  runtimeCodeHashes?: {
    ethCreatorFeeHookFactoryV3?: string | null;
    ethCreatorFeeHookV3?: string | null;
    feeSplitVaultFactoryV1?: string | null;
    memeLaunchV2?: string | null;
    lockedPositionFeeForwarderFactory?: string | null;
  };
  deploymentBlocks?: {
    memeLaunchV2?: number | null;
  };
};

function parsePercentToBps(value: string, label: string) {
  const normalized = value.trim();
  if (!/^(?:[1-9]|10)$/.test(normalized)) {
    throw new LaunchInputError(`${label} must be a whole percentage from 1% to 10%`);
  }
  const basisPoints = Number(normalized) * 100;
  if (
    basisPoints < CLASSIC_V3_MIN_FEE_BPS ||
    basisPoints > CLASSIC_V3_MAX_FEE_BPS ||
    basisPoints % CLASSIC_V3_FEE_STEP_BPS !== 0
  ) {
    throw new LaunchInputError(`${label} must be a whole percentage from 1% to 10%`);
  }
  return basisPoints;
}

function parseShareBps(value: string, label: string) {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d?)(?:\.\d{1,2})?$|^100(?:\.0{1,2})?$/.test(normalized)) {
    throw new LaunchInputError(`${label} must be a percentage with at most two decimals`);
  }
  const [whole, fraction = ""] = normalized.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (basisPoints <= 0 || basisPoints > REWARD_SHARE_BPS) {
    throw new LaunchInputError(`${label} must be greater than 0%`);
  }
  return basisPoints;
}

function readBeneficiary(value: string, label: string) {
  if (!isAddress(value.trim())) {
    throw new LaunchInputError(`Enter a valid Ethereum address for ${label}`);
  }
  return getAddress(value.trim());
}

function validateSplitRows(rows: readonly RewardSplitDraft[]) {
  if (rows.length < 2 || rows.length > CLASSIC_V3_MAX_REWARD_BENEFICIARIES) {
    throw new LaunchInputError(
      `Use 2 to ${CLASSIC_V3_MAX_REWARD_BENEFICIARIES} reward recipients`,
    );
  }

  const beneficiaries: Address[] = [];
  const sharesBps: number[] = [];
  const seen = new Set<string>();
  let total = 0;

  rows.forEach((row, index) => {
    const beneficiary = readBeneficiary(
      row.beneficiary,
      `recipient ${index + 1}`,
    );
    const key = beneficiary.toLowerCase();
    if (seen.has(key)) {
      throw new LaunchInputError("Each reward recipient must be unique");
    }
    seen.add(key);
    const share = parseShareBps(row.sharePercent, `Recipient ${index + 1} share`);
    beneficiaries.push(beneficiary);
    sharesBps.push(share);
    total += share;
  });

  if (total !== REWARD_SHARE_BPS) {
    throw new LaunchInputError("Reward shares must total exactly 100%");
  }
  return { beneficiaries, sharesBps };
}

export function validateClassicV3LaunchDraft(
  draft: LaunchDraft,
  launcherAccount: string,
): ClassicV3LaunchConfiguration {
  if (draft.launchModel !== "classic-v3") {
    throw new LaunchInputError("Choose the Classic launch model");
  }

  validateMemeLaunchDraft({
    ...draft,
    launchModel: "classic",
    totalSwapFeePercent: "1",
  });

  const buySwapFeeBps = parsePercentToBps(
    draft.buySwapFeePercent,
    "Buy fee",
  );
  const sellSwapFeeBps = parsePercentToBps(
    draft.sellSwapFeePercent,
    "Sell fee",
  );

  let rewards: ClassicV3RewardConfiguration;
  if (draft.rewardDestinationMode === "launcher") {
    rewards = {
      beneficiaries: [readBeneficiary(launcherAccount, "the launch wallet")],
      sharesBps: [REWARD_SHARE_BPS],
    };
  } else if (draft.rewardDestinationMode === "external") {
    rewards = {
      beneficiaries: [
        readBeneficiary(draft.rewardExternalAddress, "the reward wallet"),
      ],
      sharesBps: [REWARD_SHARE_BPS],
    };
  } else if (draft.rewardDestinationMode === "split") {
    rewards = validateSplitRows(draft.rewardSplits);
  } else {
    throw new LaunchInputError("Choose a reward destination");
  }

  return {
    fees: {
      buySwapFeeBps,
      sellSwapFeeBps,
      buyCreatorFeeBps: buySwapFeeBps - PLATFORM_FEE_BPS,
      sellCreatorFeeBps: sellSwapFeeBps - PLATFORM_FEE_BPS,
      platformFeeBps: PLATFORM_FEE_BPS,
    },
    rewards,
  };
}

export function encodeClassicV3Launch(
  draft: LaunchDraft,
  creatorSalt: Hex,
  launcherAccount: string,
) {
  const configuration = validateClassicV3LaunchDraft(draft, launcherAccount);
  return encodeFunctionData({
    abi: classicV3LaunchAbi,
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

function validAddress(value: string | null | undefined) {
  return Boolean(value && isAddress(value));
}

function validHash(value: string | null | undefined) {
  return Boolean(value && /^0x[a-fA-F0-9]{64}$/.test(value));
}

export function isClassicV3DeploymentReady(
  manifest: ClassicV3DeploymentManifest,
  expectedChainId: number,
) {
  return (
    manifest.chainId === expectedChainId &&
    manifest.classicV3Status === "ready" &&
    validAddress(manifest.ethCreatorFeeHookFactoryV3) &&
    validAddress(manifest.ethCreatorFeeHookV3) &&
    validAddress(manifest.feeSplitVaultFactoryV1) &&
    validAddress(manifest.memeLaunchV2) &&
    validAddress(manifest.lockedPositionFeeForwarderFactory) &&
    validHash(manifest.runtimeCodeHashes?.ethCreatorFeeHookFactoryV3) &&
    validHash(manifest.runtimeCodeHashes?.ethCreatorFeeHookV3) &&
    validHash(manifest.runtimeCodeHashes?.feeSplitVaultFactoryV1) &&
    validHash(manifest.runtimeCodeHashes?.memeLaunchV2) &&
    validHash(manifest.runtimeCodeHashes?.lockedPositionFeeForwarderFactory) &&
    typeof manifest.deploymentBlocks?.memeLaunchV2 === "number" &&
    Number.isSafeInteger(manifest.deploymentBlocks.memeLaunchV2) &&
    manifest.deploymentBlocks.memeLaunchV2 >= 0
  );
}

export function formatClassicV3Percent(bps: number) {
  return `${(bps / 100).toFixed(2)}%`;
}

export function buildClassicV3LaunchDisclosure(
  draft: LaunchDraft,
  launcherAccount: string,
): ClassicV3LaunchDisclosure {
  const configuration = validateClassicV3LaunchDraft(draft, launcherAccount);
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
    rewards: configuration.rewards.beneficiaries.map(
      (beneficiary, index) => ({
        beneficiary,
        share: formatClassicV3Percent(
          configuration.rewards.sharesBps[index],
        ),
      }),
    ),
  };
}
