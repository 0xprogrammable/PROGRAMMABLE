import { getAddress, parseAbi, type Address, type Hex } from "viem";

export const STOCK_PAIRED_NATIVE_ETH =
  "0x0000000000000000000000000000000000000000" as Address;

export const STOCK_PAIRED_WETH = getAddress(
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
);
export const STOCK_PAIRED_USDC = getAddress(
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
);
export const STOCK_PAIRED_V3_FACTORY = getAddress(
  "0x1F98431c8aD98523631AE4a59f267346ea31F984",
);
export const STOCK_PAIRED_V3_SWAP_ROUTER = getAddress(
  "0xE592427A0AEce92De3Edee1F18E0157C05861564",
);
export const STOCK_PAIRED_V3_QUOTER = getAddress(
  "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
);
export const STOCK_PAIRED_MIN_ROUTE_ROUND_TRIP_BPS = 9_000n;

export const STOCK_PAIRED_ROUTE_RUNTIME_HASHES = {
  v3Factory:
    "0x4d7b8525cd5d14343fa67a732fba5b24cddba11620ca88392f4ec6c52f91fd69",
  v3SwapRouter:
    "0xbb90113d2f9a5e9b7feb15a1d1fff06c1ee1575b3f9b1181778ffd0cf633e7ea",
  v3Quoter:
    "0x06148f47d0f41a68d3bc970030a7150e5d608cfbc28d372440a2e41ce543d92b",
  weth: "0xd0a06b12ac47863b5c7be4185c2deaad1c61557033f56c7d4ea74429cbb25e23",
  usdc: "0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505",
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
  pool: getAddress("0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"),
  poolRuntimeCodeHash:
    "0xa981b66c747a3d9fa29d7e200d5faaa2826960523d0e5a0df8148e8868c480b4",
  tokenIn: STOCK_PAIRED_WETH,
  tokenOut: STOCK_PAIRED_USDC,
  fee: 500,
} as const satisfies StockPairedV3Hop;

const STOCK_USDC_HOPS = new Map<string, Omit<StockPairedV3Hop, "tokenIn">>([
  [
    "0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee",
    {
      pool: getAddress("0xf5294094BCe435bFbd0eC488be5C462aAF32Bc7A"),
      poolRuntimeCodeHash:
        "0x0c488df5bd90182f1e19b3c300eab4f99ab3c68d756250fd22589441b7c67e06",
      tokenOut: getAddress("0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE"),
      fee: 10_000,
    },
  ],
  [
    "0xfedc5f4a6c38211c1338aa411018dfaf26612c08",
    {
      pool: getAddress("0x5638bbDE046EC2EFC7C8f3fd8DC5A9A1016f7EEB"),
      poolRuntimeCodeHash:
        "0x9ce9b74c4e3e51f9bcf2ad9d28f09df179f96f7d17e423aa9207a69dc1558252",
      tokenOut: getAddress("0xFeDC5f4a6c38211c1338aa411018DFAf26612c08"),
      fee: 3_000,
    },
  ],
  [
    "0xba47214edd2bb43099611b208f75e4b42fdcfedc",
    {
      pool: getAddress("0x39FCB1935f6Ccb0A106D05eB928205C59646af57"),
      poolRuntimeCodeHash:
        "0x1d93fa3dcce7502a231f47d3c9fcf22545d604735365a13d2b5823abd5ec85ee",
      tokenOut: getAddress("0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc"),
      fee: 10_000,
    },
  ],
  [
    "0xf3e4872e6a4cf365888d93b6146a2baa7348f1a4",
    {
      pool: getAddress("0xEeb8F880EAd7281A301ef2E6791A6bBe790603eD"),
      poolRuntimeCodeHash:
        "0x78981bb1657e3a587ec8a74460e263f638f051511c62431b090277d38698ea79",
      tokenOut: getAddress("0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4"),
      fee: 10_000,
    },
  ],
  [
    "0xf6b1117ec07684d3958cad8beb1b302bfd21103f",
    {
      pool: getAddress("0x31227b50eCCDC9C589826AA2D9E7C5619B1895Da"),
      poolRuntimeCodeHash:
        "0x8924e50b838c5e1ee3ec68c18a41e29c4d1403a03384f900c5659184e00d03d9",
      tokenOut: getAddress("0xf6b1117ec07684D3958caD8BEb1b302bfD21103f"),
      fee: 10_000,
    },
  ],
  [
    "0x14c3abf95cb9c93a8b82c1cdcb76d72cb87b2d4c",
    {
      pool: getAddress("0xad82C9EB065a5CFed71DB087e4a52C8a09c69921"),
      poolRuntimeCodeHash:
        "0x1ef0d1ec03b74d0240a743a2ac44941fad4401a3600a219afdc25f6b3d816b2a",
      tokenOut: getAddress("0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c"),
      fee: 10_000,
    },
  ],
]);

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
]);

export const stockPairedV3QuoterAbi = parseAbi([
  "function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)",
]);
