import {
  encodeFunctionData,
  getAddress,
  isAddress,
  parseAbi,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import stockAssetsJson from "../config/stock-paired-assets.v1.json";
import {
  validateRewardConfiguration,
  type ClassicV3RewardConfiguration,
} from "./classic-v3";
import {
  MEME_MIN_INITIAL_BUY_ETH,
  type LaunchDraft,
} from "./launch";
import {
  encodeMemeMetadataExtraData,
  LaunchInputError,
  MAX_METADATA_URL_BYTES,
  normalizeOptionalHttpsUrl,
  validateMemeLaunchDraft,
} from "./launch-transaction";

export const STOCK_PAIRED_MIN_INITIAL_BUY_RAW = 10_000_000_000_000_000n;
export const STOCK_PAIRED_MIN_INITIAL_BUY = "0.01";
export const STOCK_PAIRED_TOTAL_SWAP_FEE_BPS = 100;
export const STOCK_PAIRED_CREATOR_FEE_BPS = 90;
export const STOCK_PAIRED_PROGRAMMABLE_FEE_BPS = 10;

export type StockQuoteAsset = {
  symbol: string;
  name: string;
  underlying: string;
  address: Address;
  ondoAssetUrl: string;
};

type StockAssetConfig = {
  schemaVersion: number;
  chainId: number;
  model: string;
  assets: Array<{
    symbol: string;
    name: string;
    underlying: string;
    address: string;
    ondoAssetUrl: string;
  }>;
};

function loadStockQuoteAssets(): readonly StockQuoteAsset[] {
  const config = stockAssetsJson as StockAssetConfig;
  if (
    config.schemaVersion !== 1 ||
    config.chainId !== 1 ||
    config.model !== "stock-paired-v1" ||
    config.assets.length !== 7
  ) {
    throw new Error("The Stock-Paired asset registry is invalid");
  }

  const seen = new Set<string>();
  return Object.freeze(
    config.assets.map((asset) => {
      if (
        !asset.symbol ||
        !asset.name ||
        !asset.underlying ||
        !isAddress(asset.address) ||
        !asset.ondoAssetUrl.startsWith("https://app.ondo.finance/assets/")
      ) {
        throw new Error("The Stock-Paired asset registry is invalid");
      }
      const address = getAddress(asset.address);
      const key = address.toLowerCase();
      if (seen.has(key)) {
        throw new Error("The Stock-Paired asset registry contains duplicates");
      }
      seen.add(key);
      return Object.freeze({
        symbol: asset.symbol,
        name: asset.name,
        underlying: asset.underlying,
        address,
        ondoAssetUrl: asset.ondoAssetUrl,
      });
    }),
  );
}

export const STOCK_QUOTE_ASSETS = loadStockQuoteAssets();

export function getStockQuoteAsset(value: string) {
  if (!isAddress(value.trim())) return null;
  const address = getAddress(value.trim());
  return (
    STOCK_QUOTE_ASSETS.find(
      (asset) => asset.address.toLowerCase() === address.toLowerCase(),
    ) ?? null
  );
}

export function parseStockInitialBuyAmount(value: string) {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 40 ||
    !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(normalized)
  ) {
    return null;
  }
  try {
    const amount = parseUnits(normalized, 18);
    return amount >= STOCK_PAIRED_MIN_INITIAL_BUY_RAW ? amount : null;
  } catch {
    return null;
  }
}

export type StockPairedLaunchConfiguration = {
  quoteAsset: StockQuoteAsset;
  initialBuyQuoteAmount: bigint;
  rewards: ClassicV3RewardConfiguration;
  totalSwapFeeBps: typeof STOCK_PAIRED_TOTAL_SWAP_FEE_BPS;
  creatorFeeBps: typeof STOCK_PAIRED_CREATOR_FEE_BPS;
  programmableFeeBps: typeof STOCK_PAIRED_PROGRAMMABLE_FEE_BPS;
};

export function validateStockPairedLaunchDraft(
  draft: LaunchDraft,
  launcherAccount: string,
): StockPairedLaunchConfiguration {
  if (draft.launchModel !== "stock-paired") {
    throw new LaunchInputError("Choose the Stock-Paired launch model");
  }

  validateMemeLaunchDraft({
    ...draft,
    launchModel: "classic",
    totalSwapFeePercent: "1",
    initialBuyEth: MEME_MIN_INITIAL_BUY_ETH,
  });

  const quoteAsset = getStockQuoteAsset(draft.stockQuoteAsset);
  if (!quoteAsset) {
    throw new LaunchInputError("Choose one of the supported quote assets");
  }
  const initialBuyQuoteAmount = parseStockInitialBuyAmount(
    draft.initialBuyQuoteAmount,
  );
  if (initialBuyQuoteAmount === null) {
    throw new LaunchInputError(
      `Enter an Initial Buy of at least ${STOCK_PAIRED_MIN_INITIAL_BUY} ${quoteAsset.symbol}`,
    );
  }

  return {
    quoteAsset,
    initialBuyQuoteAmount,
    rewards: validateRewardConfiguration(draft, launcherAccount),
    totalSwapFeeBps: STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
    creatorFeeBps: STOCK_PAIRED_CREATOR_FEE_BPS,
    programmableFeeBps: STOCK_PAIRED_PROGRAMMABLE_FEE_BPS,
  };
}

export const stockPairedLaunchAbi = parseAbi([
  "function launch((string name,string symbol,address quoteAsset,uint256 initialBuyQuoteAmount,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps) parameters) returns ((address token,address quoteAsset,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyQuoteAmount,uint256 initialBuyTokenAmount,int24 initialTick,bool quoteIsCurrency0,bytes32 poolId,bytes32 quoteConfigurationHash,bytes32 launchHash) result)",
  "function predictTokenAddress(string name,string symbol,address deployer,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function predictRewardVault(address token,address quoteAsset,address deployer,address[] beneficiaries,uint16[] sharesBps) view returns (address)",
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function quoteRegistry() view returns (address)",
  "function positionPlanner() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function MIN_INITIAL_BUY_QUOTE_AMOUNT() view returns (uint256)",
]);

export const stockPairedHookAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function quoteRegistry() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function CREATOR_FEE_BPS() view returns (uint16)",
  "function LAUNCHER_FEE_BPS() view returns (uint16)",
  "function TRANSFER_TAX_BPS() view returns (uint16)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
  "function poolFeeConfig(bytes32 poolId) view returns (address quoteAsset,address launchedToken,address rewardVault,address registrar,bool quoteIsCurrency0,bool registered,uint256 creatorFeesAccrued)",
  "function feeDisclosure(bytes32 poolId) view returns (address quoteAsset,address launchedToken,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 creatorFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips,address rewardVault)",
]);

export const stockPairedHookFactoryAbi = parseAbi([
  "function isFactoryHook(address hook) view returns (bool)",
]);

export const stockQuoteRegistryAbi = parseAbi([
  "function assetCount() view returns (uint256)",
  "function assetAt(uint256 index) view returns (address)",
  "function isSupported(address asset) view returns (bool)",
  "function assertAssetReady(address asset) view returns (bytes32 assetConfigurationHash)",
]);

export const stockQuoteTokenAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);

export const stockFeeSplitVaultAbi = parseAbi([
  "function feeHook() view returns (address)",
  "function poolId() view returns (bytes32)",
  "function quoteAsset() view returns (address)",
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

export const stockFeeSplitVaultFactoryAbi = parseAbi([
  "function isFactoryVault(address vault) view returns (bool)",
]);

export function encodeStockPairedLaunch(
  draft: LaunchDraft,
  creatorSalt: Hex,
  launcherAccount: string,
) {
  const configuration = validateStockPairedLaunchDraft(
    draft,
    launcherAccount,
  );
  return encodeFunctionData({
    abi: stockPairedLaunchAbi,
    functionName: "launch",
    args: [
      {
        name: draft.tokenName.trim(),
        symbol: draft.tokenSymbol.trim(),
        quoteAsset: configuration.quoteAsset.address,
        initialBuyQuoteAmount: configuration.initialBuyQuoteAmount,
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

export function encodeStockQuoteApproval(
  launcher: Address,
  amount: bigint,
) {
  return encodeFunctionData({
    abi: stockQuoteTokenAbi,
    functionName: "approve",
    args: [launcher, amount],
  });
}
