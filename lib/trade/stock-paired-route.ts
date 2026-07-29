import { getAddress, parseAbi, type Address, type Hex } from "viem";

import {
  STOCK_PAIRED_V2_QUOTE_ASSETS,
  STOCK_PAIRED_V2_ROUTE_POLICY,
} from "../stock-paired-v2";

export const STOCK_PAIRED_NATIVE_ETH =
  "0x0000000000000000000000000000000000000000" as Address;

export const STOCK_PAIRED_WETH = STOCK_PAIRED_V2_ROUTE_POLICY.weth;
export const STOCK_PAIRED_USDC = STOCK_PAIRED_V2_ROUTE_POLICY.usdc;
export const STOCK_PAIRED_V3_FACTORY =
  STOCK_PAIRED_V2_ROUTE_POLICY.v3Factory;
export const STOCK_PAIRED_V3_SWAP_ROUTER =
  STOCK_PAIRED_V2_ROUTE_POLICY.v3SwapRouter;
export const STOCK_PAIRED_V3_QUOTER =
  STOCK_PAIRED_V2_ROUTE_POLICY.v3Quoter;
export const STOCK_PAIRED_MIN_ROUTE_ROUND_TRIP_BPS = 9_000n;

export const STOCK_PAIRED_ROUTE_RUNTIME_HASHES = {
  v3Factory: STOCK_PAIRED_V2_ROUTE_POLICY.v3FactoryRuntimeCodeHash,
  v3SwapRouter: STOCK_PAIRED_V2_ROUTE_POLICY.v3SwapRouterRuntimeCodeHash,
  v3Quoter: STOCK_PAIRED_V2_ROUTE_POLICY.v3QuoterRuntimeCodeHash,
  weth: STOCK_PAIRED_V2_ROUTE_POLICY.wethRuntimeCodeHash,
  usdc: STOCK_PAIRED_V2_ROUTE_POLICY.usdcRuntimeCodeHash,
} as const satisfies Record<string, Hex>;

export type StockPairedEthRouteRuntimeCodeHashes = {
  v3Factory: Hex;
  v3SwapRouter: Hex;
  v3Quoter: Hex;
  weth: Hex;
  usdc: Hex;
  pools: Record<string, Hex>;
};

export type StockPairedV3Hop = {
  pool: Address;
  poolRuntimeCodeHash: Hex;
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
};

const WETH_USDC_HOP = {
  pool: STOCK_PAIRED_V2_ROUTE_POLICY.wethUsdcPool,
  poolRuntimeCodeHash:
    STOCK_PAIRED_V2_ROUTE_POLICY.wethUsdcPoolRuntimeCodeHash,
  tokenIn: STOCK_PAIRED_WETH,
  tokenOut: STOCK_PAIRED_USDC,
  fee: STOCK_PAIRED_V2_ROUTE_POLICY.wethUsdcFee,
} as const satisfies StockPairedV3Hop;

const STOCK_USDC_HOPS = new Map<
  string,
  Omit<StockPairedV3Hop, "tokenIn">
>(
  STOCK_PAIRED_V2_QUOTE_ASSETS.map((asset) => [
    asset.address.toLowerCase(),
    {
      pool: asset.route.pool,
      poolRuntimeCodeHash: asset.route.poolRuntimeCodeHash,
      tokenOut: asset.address,
      fee: asset.route.stockPoolFee,
    },
  ]),
);

function reverseHop(hop: StockPairedV3Hop): StockPairedV3Hop {
  return {
    ...hop,
    tokenIn: hop.tokenOut,
    tokenOut: hop.tokenIn,
  };
}

export function getStockPairedEthRoute(quoteAsset: Address) {
  const stockHop = STOCK_USDC_HOPS.get(quoteAsset.toLowerCase());
  if (!stockHop) {
    throw new Error("The selected stock does not have a reviewed ETH route");
  }
  const buyHops: readonly StockPairedV3Hop[] = [
    WETH_USDC_HOP,
    {
      ...stockHop,
      tokenIn: STOCK_PAIRED_USDC,
    },
  ];
  return {
    quoteAsset: getAddress(quoteAsset),
    buyHops,
    sellHops: [...buyHops].reverse().map(reverseHop),
  };
}

export function getStockPairedEthRouteRuntimeCodeHashes(
  quoteAsset: Address,
): StockPairedEthRouteRuntimeCodeHashes {
  const route = getStockPairedEthRoute(quoteAsset);
  return {
    ...STOCK_PAIRED_ROUTE_RUNTIME_HASHES,
    pools: Object.fromEntries(
      route.buyHops.map((hop) => [
        hop.pool.toLowerCase(),
        hop.poolRuntimeCodeHash,
      ]),
    ),
  };
}

export function encodeStockPairedV3Path(
  hops: readonly StockPairedV3Hop[],
): Hex {
  if (hops.length === 0) {
    throw new Error("A Stock-Paired route needs at least one v3 hop");
  }
  let encoded = hops[0].tokenIn.slice(2).toLowerCase();
  for (let index = 0; index < hops.length; index += 1) {
    const hop = hops[index];
    if (
      index > 0 &&
      hops[index - 1].tokenOut.toLowerCase() !== hop.tokenIn.toLowerCase()
    ) {
      throw new Error("The Stock-Paired v3 route is not contiguous");
    }
    if (!Number.isInteger(hop.fee) || hop.fee < 0 || hop.fee > 0xffffff) {
      throw new Error("The Stock-Paired v3 route has an invalid fee");
    }
    encoded += hop.fee.toString(16).padStart(6, "0");
    encoded += hop.tokenOut.slice(2).toLowerCase();
  }
  return `0x${encoded}` as Hex;
}

export const stockPairedV3FactoryAbi = parseAbi([
  "function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)",
]);

export const stockPairedV3PoolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
]);

export const stockPairedV3QuoterAbi = parseAbi([
  "function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)",
]);
