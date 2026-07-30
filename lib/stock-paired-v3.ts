import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

import stockAssetsV3Json from "../config/stock-paired-assets.v3.json";

const TICK_SPACING = 200;
const ASSET_COUNT = 6;

export type StockPairedV3QuoteAsset = {
  symbol: string;
  name: string;
  displayName: string;
  underlying: string;
  address: Address;
  ondoAssetUrl: string;
  logoUrl: string;
  initialAbsoluteTick: number;
  targetQuoteAmountWad: string;
  route: {
    stockPoolFee: number;
    pool: Address;
    poolRuntimeCodeHash: Hex;
  };
};

type Config = {
  schemaVersion: number;
  chainId: number;
  model: string;
  internalContractRelease: string;
  launchPolicy: {
    targetInitialFdvEth: string;
    tickSpacing: number;
    disclosure: string;
  };
  priceCalibration: {
    method: string;
    blockNumber: number;
    blockHash: string;
    blockTimestamp: number;
    maximumInitialFdvDeviationBps: number;
    maximumReferenceDriftBps: number;
    maximumTickRoundingDeviationBps: number;
    maximumActivationEvidenceAgeSeconds: number;
    oracleClaim: boolean;
  };
  assets: Array<StockPairedV3QuoteAsset>;
};

function loadConfig() {
  const config = stockAssetsV3Json as Config;
  if (
    config.schemaVersion !== 3 ||
    config.chainId !== 1 ||
    config.model !== "stock-paired" ||
    config.internalContractRelease !== "stock-paired-v3" ||
    config.launchPolicy.targetInitialFdvEth !== "1.355657760817103798" ||
    config.launchPolicy.tickSpacing !== TICK_SPACING ||
    config.priceCalibration.method !==
      "pinned-pool-midpoint-with-independent-underlying-cross-check" ||
    config.priceCalibration.blockNumber !== 25_642_460 ||
    !isHex(config.priceCalibration.blockHash, { strict: true }) ||
    config.priceCalibration.blockHash.length !== 66 ||
    config.priceCalibration.maximumInitialFdvDeviationBps !== 500 ||
    config.priceCalibration.maximumReferenceDriftBps !== 300 ||
    config.priceCalibration.maximumTickRoundingDeviationBps !== 100 ||
    config.priceCalibration.maximumActivationEvidenceAgeSeconds !== 900 ||
    config.priceCalibration.oracleClaim !== false ||
    config.assets.length !== ASSET_COUNT
  ) {
    throw new Error("The Stock-Paired V3 release config is invalid");
  }
  const addresses = new Set<string>();
  const symbols = new Set<string>();
  const assets = config.assets.map((asset) => {
    if (
      !asset.symbol ||
      !asset.name ||
      !asset.displayName ||
      !asset.underlying ||
      !isAddress(asset.address) ||
      !asset.ondoAssetUrl.startsWith("https://app.ondo.finance/assets/") ||
      !asset.logoUrl.startsWith("https://cdn.ondo.finance/tokens/logos/") ||
      !Number.isSafeInteger(asset.initialAbsoluteTick) ||
      asset.initialAbsoluteTick <= 0 ||
      asset.initialAbsoluteTick % TICK_SPACING !== 0 ||
      !/^[1-9]\d*$/.test(asset.targetQuoteAmountWad) ||
      !Number.isSafeInteger(asset.route.stockPoolFee) ||
      asset.route.stockPoolFee <= 0 ||
      !isAddress(asset.route.pool) ||
      !isHex(asset.route.poolRuntimeCodeHash, { strict: true }) ||
      asset.route.poolRuntimeCodeHash.length !== 66
    ) {
      throw new Error("The Stock-Paired V3 release config is invalid");
    }
    const address = getAddress(asset.address);
    const addressKey = address.toLowerCase();
    if (addresses.has(addressKey) || symbols.has(asset.symbol)) {
      throw new Error("The Stock-Paired V3 release config contains duplicates");
    }
    addresses.add(addressKey);
    symbols.add(asset.symbol);
    return Object.freeze({
      ...asset,
      address,
      route: Object.freeze({
        ...asset.route,
        pool: getAddress(asset.route.pool),
        poolRuntimeCodeHash: asset.route.poolRuntimeCodeHash as Hex,
      }),
    });
  });
  return Object.freeze({
    targetInitialFdvEth: config.launchPolicy.targetInitialFdvEth,
    disclosure: config.launchPolicy.disclosure,
    tickSpacing: config.launchPolicy.tickSpacing,
    calibration: Object.freeze(config.priceCalibration),
    assets: Object.freeze(assets),
  });
}

export const STOCK_PAIRED_V3_CONFIG = loadConfig();
export const STOCK_PAIRED_V3_QUOTE_ASSETS = STOCK_PAIRED_V3_CONFIG.assets;
