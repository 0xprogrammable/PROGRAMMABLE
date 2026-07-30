import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  parseAbiParameters,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import stockAssetsJson from "../config/stock-paired-assets.v1.json";
import {
  validateRewardConfiguration,
  type ClassicV3RewardConfiguration,
} from "./classic-v3";
import type { VerifiedStockPairedRelease } from "./stock-paired-release";
import {
  STOCK_PAIRED_V2_QUOTE_ASSETS,
  type StockPairedV2QuoteAsset,
} from "./stock-paired-v2";
import {
  MEME_MIN_INITIAL_BUY_ETH,
  MEME_MIN_INITIAL_BUY_WEI,
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
export const STOCK_PAIRED_MIN_INITIAL_BUY_ETH_WEI = MEME_MIN_INITIAL_BUY_WEI;
export const STOCK_PAIRED_MIN_INITIAL_BUY_ETH = MEME_MIN_INITIAL_BUY_ETH;
export const STOCK_PAIRED_DEFAULT_INITIAL_BUY_ETH = "0.01";
export const STOCK_PAIRED_TOTAL_SWAP_FEE_BPS = 100;
export const STOCK_PAIRED_CREATOR_FEE_BPS = 90;
export const STOCK_PAIRED_PROGRAMMABLE_FEE_BPS = 10;
export const STOCK_PAIRED_CURRENCY0_SEARCH_ATTEMPTS = 256;

const stockPairedCurrency0SaltParameters = parseAbiParameters(
  "string domain, bytes32 baseSalt, uint256 attempt",
);
const STOCK_PAIRED_CURRENCY0_SALT_DOMAIN =
  "programmable.stock-paired.currency0.v1";

export function isStockPairedLaunchedTokenCurrency0(
  launchedToken: Address,
  quoteAsset: Address,
) {
  return BigInt(launchedToken) < BigInt(quoteAsset);
}

export function deriveStockPairedCurrency0Salt(
  baseSalt: Hex,
  attempt: number,
) {
  if (
    !isHex(baseSalt, { strict: true }) ||
    baseSalt.length !== 66 ||
    !Number.isSafeInteger(attempt) ||
    attempt < 0 ||
    attempt >= STOCK_PAIRED_CURRENCY0_SEARCH_ATTEMPTS
  ) {
    throw new LaunchInputError(
      "The Stock-Paired launch identifier is invalid",
    );
  }
  return keccak256(
    encodeAbiParameters(stockPairedCurrency0SaltParameters, [
      STOCK_PAIRED_CURRENCY0_SALT_DOMAIN,
      baseSalt,
      BigInt(attempt),
    ]),
  );
}

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
const STOCK_PAIRED_ETH_QUOTE_SYMBOLS = new Set([
  "NVDAon",
  "SPYon",
  "GOOGLon",
  "SLVon",
  "TSLAon",
  "AAPLon",
]);
export const STOCK_PAIRED_ETH_QUOTE_ASSETS = Object.freeze(
  STOCK_PAIRED_V2_QUOTE_ASSETS,
);
const STOCK_PAIRED_V1_ETH_QUOTE_ASSETS = Object.freeze(
  STOCK_QUOTE_ASSETS.filter((asset) =>
    STOCK_PAIRED_ETH_QUOTE_SYMBOLS.has(asset.symbol),
  ),
);

export type AnyStockPairedQuoteAsset =
  StockQuoteAsset | StockPairedV2QuoteAsset;

export function getStockPairedQuoteAssetsForRelease(
  release: Pick<VerifiedStockPairedRelease, "internalContractRelease">,
): readonly AnyStockPairedQuoteAsset[] {
  return release.internalContractRelease === "stock-paired-v2"
    ? STOCK_PAIRED_V2_QUOTE_ASSETS
    : STOCK_QUOTE_ASSETS;
}

export function getStockPairedEthQuoteAssetsForRelease(
  release: Pick<VerifiedStockPairedRelease, "internalContractRelease">,
): readonly AnyStockPairedQuoteAsset[] {
  return release.internalContractRelease === "stock-paired-v2"
    ? STOCK_PAIRED_V2_QUOTE_ASSETS
    : STOCK_PAIRED_V1_ETH_QUOTE_ASSETS;
}

export function getStockPairedQuoteAssetForRelease(
  release: Pick<VerifiedStockPairedRelease, "internalContractRelease">,
  value: string,
) {
  if (!isAddress(value.trim())) return null;
  const address = getAddress(value.trim());
  return (
    getStockPairedQuoteAssetsForRelease(release).find(
      (asset) => asset.address.toLowerCase() === address.toLowerCase(),
    ) ?? null
  );
}

export function getStockQuoteAsset(value: string) {
  if (!isAddress(value.trim())) return null;
  const address = getAddress(value.trim());
  return (
    STOCK_QUOTE_ASSETS.find(
      (asset) => asset.address.toLowerCase() === address.toLowerCase(),
    ) ?? null
  );
}

export function getStockPairedEthQuoteAsset(value: string) {
  if (!isAddress(value.trim())) return null;
  const address = getAddress(value.trim());
  return (
    STOCK_PAIRED_ETH_QUOTE_ASSETS.find(
      (asset) => asset.address.toLowerCase() === address.toLowerCase(),
    ) ?? null
  );
}

export function parseStockInitialBuyEthAmount(value: string) {
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
    return amount >= STOCK_PAIRED_MIN_INITIAL_BUY_ETH_WEI ? amount : null;
  } catch {
    return null;
  }
}

export type StockPairedLaunchConfiguration = {
  quoteAsset: StockQuoteAsset;
  initialBuyEthAmount: bigint;
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

  const quoteAsset = getStockPairedEthQuoteAsset(draft.stockQuoteAsset);
  if (!quoteAsset) {
    throw new LaunchInputError(
      "Choose one of the supported ETH-routed quote assets",
    );
  }
  const initialBuyEthAmount = parseStockInitialBuyEthAmount(
    draft.initialBuyEth,
  );
  if (initialBuyEthAmount === null) {
    throw new LaunchInputError(
      `Enter an Initial Buy of at least ${STOCK_PAIRED_MIN_INITIAL_BUY_ETH} ETH`,
    );
  }

  return {
    quoteAsset,
    initialBuyEthAmount,
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

export const stockPairedEthLaunchCoordinatorAbi = parseAbi([
  "function launch((uint256 minimumQuoteAmountOut,uint256 minimumInitialTokenOut,uint256 deadline,(string name,string symbol,address quoteAsset,uint256 initialBuyQuoteAmount,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps) launch) parameters) payable returns ((address token,address quoteAsset,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyQuoteAmount,uint256 initialBuyTokenAmount,int24 initialTick,bool quoteIsCurrency0,bytes32 poolId,bytes32 quoteConfigurationHash,bytes32 launchHash) result)",
  "function predictTokenAddress(string name,string symbol,address creator,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function launcher() view returns (address)",
  "function v3SwapRouter() view returns (address)",
  "function v3Factory() view returns (address)",
  "function weth() view returns (address)",
  "function usdc() view returns (address)",
  "function stockPoolFee(address quoteAsset) view returns (uint24)",
  "function routePath(address quoteAsset) view returns (bytes path)",
  "event StockPairedEthTokenLaunched(address indexed creator,address indexed token,address indexed quoteAsset,uint256 initialBuyEthAmount,uint256 initialBuyQuoteAmount,uint256 initialBuyTokenAmount,bytes32 launchHash)",
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

export const stockFeeSplitVaultAbi = parseAbi([
  "event BeneficiaryFeesClaimed(address indexed beneficiary,address indexed payoutAddress,address indexed quoteAsset,uint256 amount,uint256 beneficiaryTotalClaimed,uint256 vaultTotalReceived)",
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

export function encodeStockPairedEthLaunch(
  draft: LaunchDraft,
  creatorSalt: Hex,
  launcherAccount: string,
  envelope: {
    minimumQuoteAmountOut: bigint;
    minimumInitialTokenOut: bigint;
    deadline: bigint;
  },
) {
  const configuration = validateStockPairedLaunchDraft(draft, launcherAccount);
  if (
    envelope.minimumQuoteAmountOut <= 0n ||
    envelope.minimumInitialTokenOut <= 0n ||
    envelope.deadline <= 0n
  ) {
    throw new LaunchInputError("The Stock-Paired launch protection is invalid");
  }
  return encodeFunctionData({
    abi: stockPairedEthLaunchCoordinatorAbi,
    functionName: "launch",
    args: [
      {
        minimumQuoteAmountOut: envelope.minimumQuoteAmountOut,
        minimumInitialTokenOut: envelope.minimumInitialTokenOut,
        deadline: envelope.deadline,
        launch: {
          name: draft.tokenName.trim(),
          symbol: draft.tokenSymbol.trim(),
          quoteAsset: configuration.quoteAsset.address,
          initialBuyQuoteAmount: 0n,
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
      },
    ],
  });
}
