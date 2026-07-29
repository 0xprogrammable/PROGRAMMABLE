import {
  getAddress,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import {
  getStockPairedEthRoute,
  STOCK_PAIRED_ROUTE_RUNTIME_HASHES,
  STOCK_PAIRED_USDC,
  STOCK_PAIRED_V3_FACTORY,
  stockPairedV3FactoryAbi,
  stockPairedV3PoolAbi,
  type StockPairedV3Hop,
} from "../trade/stock-paired-route";
import type { LauncherToken } from "../tokens";

const Q192 = 1n << 192n;
const WAD = 10n ** 18n;
const STOCK_DECIMALS = 18;
const USDC_DECIMALS = 6;
export const STOCK_QUOTE_USD_CACHE_TTL_MS = 20_000;
const STOCK_QUOTE_USD_CACHE_MAX_ENTRIES = 32;

export type StockQuoteUsdSnapshot = {
  factoryRuntimeCodeHash: Hex | null;
  usdcRuntimeCodeHash: Hex | null;
  quoteAssetRuntimeCodeHash: Hex | null;
  poolRuntimeCodeHash: Hex | null;
  canonicalPool: Address;
  token0: Address;
  token1: Address;
  fee: number;
  liquidity: bigint;
  sqrtPriceX96: bigint;
};

type SnapshotReader = (
  client: PublicClient,
  input: {
    quoteAsset: Address;
    stockHop: StockPairedV3Hop;
    blockNumber: bigint;
  },
) => Promise<StockQuoteUsdSnapshot>;

type StockQuoteUsdCache = {
  read: (
    key: string,
    reader: () => Promise<bigint | null>,
  ) => Promise<bigint | null>;
};

export function createStockQuoteUsdCache(input?: {
  ttlMs?: number;
  now?: () => number;
}): StockQuoteUsdCache {
  const ttlMs = input?.ttlMs ?? STOCK_QUOTE_USD_CACHE_TTL_MS;
  const now = input?.now ?? Date.now;
  const values = new Map<
    string,
    { resolvedAt: number; value: bigint | null }
  >();
  const pending = new Map<string, Promise<bigint | null>>();

  return {
    read(key, reader) {
      const cached = values.get(key);
      if (cached && now() - cached.resolvedAt < ttlMs) {
        return Promise.resolve(cached.value);
      }
      if (cached) values.delete(key);

      const pendingRead = pending.get(key);
      if (pendingRead) return pendingRead;

      const request = reader().then((value) => {
        if (
          values.size >= STOCK_QUOTE_USD_CACHE_MAX_ENTRIES &&
          !values.has(key)
        ) {
          const oldestKey = values.keys().next().value;
          if (oldestKey) values.delete(oldestKey);
        }
        values.set(key, { resolvedAt: now(), value });
        return value;
      });
      pending.set(key, request);

      const clearPendingRead = () => {
        if (pending.get(key) === request) pending.delete(key);
      };
      void request.then(clearPendingRead, clearPendingRead);
      return request;
    },
  };
}

const stockQuoteUsdCache = createStockQuoteUsdCache();

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function runtimeCodeHash(code: Hex | undefined) {
  return code && code !== "0x" ? keccak256(code) : null;
}

function snapshotFingerprint(snapshot: StockQuoteUsdSnapshot) {
  return JSON.stringify({
    ...snapshot,
    liquidity: snapshot.liquidity.toString(),
    sqrtPriceX96: snapshot.sqrtPriceX96.toString(),
  });
}

function validDecimals(value: number) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 36;
}

export function stockQuoteAssetUsdWadFromSqrtPriceX96(input: {
  sqrtPriceX96: bigint;
  stockIsToken0: boolean;
  stockDecimals?: number;
  usdcDecimals?: number;
}) {
  const stockDecimals = input.stockDecimals ?? STOCK_DECIMALS;
  const usdcDecimals = input.usdcDecimals ?? USDC_DECIMALS;
  if (
    input.sqrtPriceX96 <= 0n ||
    !validDecimals(stockDecimals) ||
    !validDecimals(usdcDecimals)
  ) {
    throw new Error("The Stock-Paired USD price input is invalid");
  }

  const squared = input.sqrtPriceX96 * input.sqrtPriceX96;
  const stockScale = 10n ** BigInt(stockDecimals);
  const usdcScale = 10n ** BigInt(usdcDecimals);
  const priceUsdWad = input.stockIsToken0
    ? (squared * stockScale * WAD) / (Q192 * usdcScale)
    : (Q192 * stockScale * WAD) / (squared * usdcScale);
  if (priceUsdWad <= 0n) {
    throw new Error("The Stock-Paired USD price is below supported precision");
  }
  return priceUsdWad;
}

export function validateStockQuoteUsdSnapshot(input: {
  quoteAsset: Address;
  expectedQuoteAssetRuntimeCodeHash: Hex;
  stockHop: StockPairedV3Hop;
  snapshot: StockQuoteUsdSnapshot;
}) {
  const {
    quoteAsset,
    expectedQuoteAssetRuntimeCodeHash,
    stockHop,
    snapshot,
  } = input;
  const expectedCurrencies = new Set([
    STOCK_PAIRED_USDC.toLowerCase(),
    quoteAsset.toLowerCase(),
  ]);
  const actualCurrencies = new Set([
    snapshot.token0.toLowerCase(),
    snapshot.token1.toLowerCase(),
  ]);

  if (
    snapshot.factoryRuntimeCodeHash?.toLowerCase() !==
      STOCK_PAIRED_ROUTE_RUNTIME_HASHES.v3Factory.toLowerCase() ||
    snapshot.usdcRuntimeCodeHash?.toLowerCase() !==
      STOCK_PAIRED_ROUTE_RUNTIME_HASHES.usdc.toLowerCase() ||
    snapshot.quoteAssetRuntimeCodeHash?.toLowerCase() !==
      expectedQuoteAssetRuntimeCodeHash.toLowerCase() ||
    snapshot.poolRuntimeCodeHash?.toLowerCase() !==
      stockHop.poolRuntimeCodeHash.toLowerCase() ||
    !sameAddress(snapshot.canonicalPool, stockHop.pool) ||
    actualCurrencies.size !== expectedCurrencies.size ||
    [...actualCurrencies].some(
      (currency) => !expectedCurrencies.has(currency),
    ) ||
    snapshot.fee !== stockHop.fee ||
    snapshot.liquidity <= 0n
  ) {
    throw new Error("The reviewed Stock-Paired USD route is invalid");
  }

  return stockQuoteAssetUsdWadFromSqrtPriceX96({
    sqrtPriceX96: snapshot.sqrtPriceX96,
    stockIsToken0: sameAddress(snapshot.token0, quoteAsset),
  });
}

export async function readStockQuoteUsdSnapshot(
  client: PublicClient,
  input: {
    quoteAsset: Address;
    stockHop: StockPairedV3Hop;
    blockNumber: bigint;
  },
): Promise<StockQuoteUsdSnapshot> {
  const { quoteAsset, stockHop, blockNumber } = input;
  const [
    factoryCode,
    usdcCode,
    quoteAssetCode,
    poolCode,
    canonicalPool,
    token0,
    token1,
    fee,
    liquidity,
    slot0,
  ] = await Promise.all([
    client.getCode({ address: STOCK_PAIRED_V3_FACTORY, blockNumber }),
    client.getCode({ address: STOCK_PAIRED_USDC, blockNumber }),
    client.getCode({ address: quoteAsset, blockNumber }),
    client.getCode({ address: stockHop.pool, blockNumber }),
    client.readContract({
      address: STOCK_PAIRED_V3_FACTORY,
      abi: stockPairedV3FactoryAbi,
      functionName: "getPool",
      args: [STOCK_PAIRED_USDC, quoteAsset, stockHop.fee],
      blockNumber,
    }),
    client.readContract({
      address: stockHop.pool,
      abi: stockPairedV3PoolAbi,
      functionName: "token0",
      blockNumber,
    }),
    client.readContract({
      address: stockHop.pool,
      abi: stockPairedV3PoolAbi,
      functionName: "token1",
      blockNumber,
    }),
    client.readContract({
      address: stockHop.pool,
      abi: stockPairedV3PoolAbi,
      functionName: "fee",
      blockNumber,
    }),
    client.readContract({
      address: stockHop.pool,
      abi: stockPairedV3PoolAbi,
      functionName: "liquidity",
      blockNumber,
    }),
    client.readContract({
      address: stockHop.pool,
      abi: stockPairedV3PoolAbi,
      functionName: "slot0",
      blockNumber,
    }),
  ]);

  return {
    factoryRuntimeCodeHash: runtimeCodeHash(factoryCode),
    usdcRuntimeCodeHash: runtimeCodeHash(usdcCode),
    quoteAssetRuntimeCodeHash: runtimeCodeHash(quoteAssetCode),
    poolRuntimeCodeHash: runtimeCodeHash(poolCode),
    canonicalPool: getAddress(canonicalPool),
    token0: getAddress(token0),
    token1: getAddress(token1),
    fee,
    liquidity,
    sqrtPriceX96: slot0[0],
  };
}

async function readStockQuoteAssetUsdWadUncached(input: {
  clients: readonly PublicClient[];
  quoteAsset: Address;
  expectedQuoteAssetRuntimeCodeHash: Hex;
  blockNumber: bigint;
  readSnapshot?: SnapshotReader;
}) {
  if (input.clients.length < 2) return null;

  try {
    const route = getStockPairedEthRoute(input.quoteAsset);
    const stockHop = route.buyHops.find(
      (hop) =>
        sameAddress(hop.tokenIn, STOCK_PAIRED_USDC) &&
        sameAddress(hop.tokenOut, input.quoteAsset),
    );
    if (!stockHop) return null;

    const readSnapshot = input.readSnapshot ?? readStockQuoteUsdSnapshot;
    const snapshots = await Promise.all(
      input.clients.map((client) =>
        readSnapshot(client, {
          quoteAsset: input.quoteAsset,
          stockHop,
          blockNumber: input.blockNumber,
        }),
      ),
    );
    const referenceSnapshot = snapshotFingerprint(snapshots[0]);
    if (
      snapshots.some(
        (snapshot) => snapshotFingerprint(snapshot) !== referenceSnapshot,
      )
    ) {
      return null;
    }
    const prices = snapshots.map((snapshot) =>
      validateStockQuoteUsdSnapshot({
        quoteAsset: input.quoteAsset,
        expectedQuoteAssetRuntimeCodeHash:
          input.expectedQuoteAssetRuntimeCodeHash,
        stockHop,
        snapshot,
      }),
    );
    const reference = prices[0];
    return prices.every((price) => price === reference) ? reference : null;
  } catch {
    return null;
  }
}

export function readStockQuoteAssetUsdWad(input: {
  clients: readonly PublicClient[];
  quoteAsset: Address;
  expectedQuoteAssetRuntimeCodeHash: Hex;
  blockNumber: bigint;
  readSnapshot?: SnapshotReader;
}) {
  if (input.clients.length < 2) return Promise.resolve(null);
  if (input.readSnapshot) {
    return readStockQuoteAssetUsdWadUncached(input);
  }

  const cacheKey = [
    input.quoteAsset.toLowerCase(),
    input.expectedQuoteAssetRuntimeCodeHash.toLowerCase(),
  ].join(":");
  return stockQuoteUsdCache.read(cacheKey, () =>
    readStockQuoteAssetUsdWadUncached(input),
  );
}

export function enrichStockPairedTokenWithUsd(
  token: LauncherToken,
  quoteAssetPriceUsdWad: bigint | null,
): LauncherToken {
  if (
    quoteAssetPriceUsdWad === null ||
    quoteAssetPriceUsdWad <= 0n ||
    !token.tokenPriceQuoteWad ||
    !/^\d+$/.test(token.tokenPriceQuoteWad) ||
    !token.marketCapQuoteWad ||
    !/^\d+$/.test(token.marketCapQuoteWad)
  ) {
    return token;
  }

  const tokenPriceUsdWad =
    (BigInt(token.tokenPriceQuoteWad) * quoteAssetPriceUsdWad) / WAD;
  const fdvUsdWad =
    (BigInt(token.marketCapQuoteWad) * quoteAssetPriceUsdWad) / WAD;
  if (tokenPriceUsdWad <= 0n || fdvUsdWad <= 0n) return token;

  return {
    ...token,
    tokenPriceUsdWad: tokenPriceUsdWad.toString(),
    fdvUsdWad: fdvUsdWad.toString(),
  };
}
