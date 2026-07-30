import {
  getAddress,
  isAddress,
  isHash,
  type Address,
  type Hex,
} from "viem";

import stockPairedV2Json from "../config/stock-paired-assets.v2.json";

export const STOCK_PAIRED_V2_ASSET_COUNT = 11;
export const STOCK_PAIRED_V2_MIN_ROUTE_ROUND_TRIP_BPS = 9_000;

export type StockPairedV2QuoteAsset = {
  symbol: string;
  name: string;
  displayName: string;
  underlying: string;
  address: Address;
  ondoAssetUrl: string;
  logoUrl: string;
  route: {
    stockPoolFee: number;
    pool: Address;
    poolRuntimeCodeHash: Hex;
    snapshotRoundTripBps: number;
  };
};

export type StockPairedV2RoutePolicy = {
  v3Factory: Address;
  v3FactoryRuntimeCodeHash: Hex;
  v3SwapRouter: Address;
  v3SwapRouterRuntimeCodeHash: Hex;
  v3Quoter: Address;
  v3QuoterRuntimeCodeHash: Hex;
  weth: Address;
  wethRuntimeCodeHash: Hex;
  usdc: Address;
  usdcRuntimeCodeHash: Hex;
  wethUsdcFee: number;
  wethUsdcPool: Address;
  wethUsdcPoolRuntimeCodeHash: Hex;
  minimumRoundTripBps: number;
  snapshotInputWei: string;
};

type StockPairedV2Config = {
  schemaVersion: number;
  chainId: number;
  model: string;
  internalContractRelease: string;
  routePolicy: {
    v3Factory: string;
    v3FactoryRuntimeCodeHash: string;
    v3SwapRouter: string;
    v3SwapRouterRuntimeCodeHash: string;
    v3Quoter: string;
    v3QuoterRuntimeCodeHash: string;
    weth: string;
    wethRuntimeCodeHash: string;
    usdc: string;
    usdcRuntimeCodeHash: string;
    wethUsdcFee: number;
    wethUsdcPool: string;
    wethUsdcPoolRuntimeCodeHash: string;
    minimumRoundTripBps: number;
    snapshotInputWei: string;
  };
  assets: Array<{
    symbol: string;
    name: string;
    displayName: string;
    underlying: string;
    address: string;
    ondoAssetUrl: string;
    logoUrl: string;
    route: {
      stockPoolFee: number;
      pool: string;
      poolRuntimeCodeHash: string;
      snapshotRoundTripBps: number;
    };
  }>;
};

function invalidConfig(): never {
  throw new Error("The Stock-Paired expansion registry is invalid");
}

function loadStockPairedV2RoutePolicy(): StockPairedV2RoutePolicy {
  const policy = (stockPairedV2Json as StockPairedV2Config).routePolicy;
  if (
    !isAddress(policy.v3Factory) ||
    !isHash(policy.v3FactoryRuntimeCodeHash) ||
    !isAddress(policy.v3SwapRouter) ||
    !isHash(policy.v3SwapRouterRuntimeCodeHash) ||
    !isAddress(policy.v3Quoter) ||
    !isHash(policy.v3QuoterRuntimeCodeHash) ||
    !isAddress(policy.weth) ||
    !isHash(policy.wethRuntimeCodeHash) ||
    !isAddress(policy.usdc) ||
    !isHash(policy.usdcRuntimeCodeHash) ||
    policy.wethUsdcFee !== 500 ||
    !isAddress(policy.wethUsdcPool) ||
    !isHash(policy.wethUsdcPoolRuntimeCodeHash) ||
    policy.minimumRoundTripBps !==
      STOCK_PAIRED_V2_MIN_ROUTE_ROUND_TRIP_BPS ||
    policy.snapshotInputWei !== "10000000000000000"
  ) {
    invalidConfig();
  }
  return Object.freeze({
    v3Factory: getAddress(policy.v3Factory),
    v3FactoryRuntimeCodeHash: policy.v3FactoryRuntimeCodeHash as Hex,
    v3SwapRouter: getAddress(policy.v3SwapRouter),
    v3SwapRouterRuntimeCodeHash: policy.v3SwapRouterRuntimeCodeHash as Hex,
    v3Quoter: getAddress(policy.v3Quoter),
    v3QuoterRuntimeCodeHash: policy.v3QuoterRuntimeCodeHash as Hex,
    weth: getAddress(policy.weth),
    wethRuntimeCodeHash: policy.wethRuntimeCodeHash as Hex,
    usdc: getAddress(policy.usdc),
    usdcRuntimeCodeHash: policy.usdcRuntimeCodeHash as Hex,
    wethUsdcFee: policy.wethUsdcFee,
    wethUsdcPool: getAddress(policy.wethUsdcPool),
    wethUsdcPoolRuntimeCodeHash:
      policy.wethUsdcPoolRuntimeCodeHash as Hex,
    minimumRoundTripBps: policy.minimumRoundTripBps,
    snapshotInputWei: policy.snapshotInputWei,
  });
}

function loadStockPairedV2Assets(): readonly StockPairedV2QuoteAsset[] {
  const config = stockPairedV2Json as StockPairedV2Config;
  if (
    config.schemaVersion !== 2 ||
    config.chainId !== 1 ||
    config.model !== "stock-paired" ||
    config.internalContractRelease !== "stock-paired-v2" ||
    config.routePolicy.wethUsdcFee !== 500 ||
    config.routePolicy.minimumRoundTripBps !==
      STOCK_PAIRED_V2_MIN_ROUTE_ROUND_TRIP_BPS ||
    config.routePolicy.snapshotInputWei !== "10000000000000000" ||
    config.assets.length !== STOCK_PAIRED_V2_ASSET_COUNT
  ) {
    invalidConfig();
  }

  const addresses = new Set<string>();
  const symbols = new Set<string>();
  const pools = new Set<string>();
  return Object.freeze(
    config.assets.map((asset) => {
      if (
        !asset.symbol ||
        !asset.name ||
        !asset.displayName ||
        !asset.underlying ||
        !isAddress(asset.address) ||
        !asset.ondoAssetUrl.startsWith("https://app.ondo.finance/assets/") ||
        !asset.logoUrl.startsWith(
          "https://cdn.ondo.finance/tokens/logos/",
        ) ||
        !asset.logoUrl.endsWith("_160x160.png") ||
        !Number.isInteger(asset.route.stockPoolFee) ||
        ![100, 500, 3_000, 10_000].includes(asset.route.stockPoolFee) ||
        !isAddress(asset.route.pool) ||
        !isHash(asset.route.poolRuntimeCodeHash) ||
        !Number.isInteger(asset.route.snapshotRoundTripBps) ||
        asset.route.snapshotRoundTripBps <
          STOCK_PAIRED_V2_MIN_ROUTE_ROUND_TRIP_BPS ||
        asset.route.snapshotRoundTripBps > 10_000
      ) {
        invalidConfig();
      }

      const address = getAddress(asset.address);
      const pool = getAddress(asset.route.pool);
      const addressKey = address.toLowerCase();
      const symbolKey = asset.symbol.toLowerCase();
      const poolKey = pool.toLowerCase();
      if (
        addresses.has(addressKey) ||
        symbols.has(symbolKey) ||
        pools.has(poolKey)
      ) {
        invalidConfig();
      }
      addresses.add(addressKey);
      symbols.add(symbolKey);
      pools.add(poolKey);

      return Object.freeze({
        symbol: asset.symbol,
        name: asset.name,
        displayName: asset.displayName,
        underlying: asset.underlying,
        address,
        ondoAssetUrl: asset.ondoAssetUrl,
        logoUrl: asset.logoUrl,
        route: Object.freeze({
          stockPoolFee: asset.route.stockPoolFee,
          pool,
          poolRuntimeCodeHash: asset.route.poolRuntimeCodeHash as Hex,
          snapshotRoundTripBps: asset.route.snapshotRoundTripBps,
        }),
      });
    }),
  );
}

export const STOCK_PAIRED_V2_QUOTE_ASSETS = loadStockPairedV2Assets();
export const STOCK_PAIRED_V2_ROUTE_POLICY = loadStockPairedV2RoutePolicy();

export function getStockPairedV2QuoteAsset(value: string) {
  if (!isAddress(value.trim())) return null;
  const address = getAddress(value.trim());
  return (
    STOCK_PAIRED_V2_QUOTE_ASSETS.find(
      (asset) => asset.address.toLowerCase() === address.toLowerCase(),
    ) ?? null
  );
}
