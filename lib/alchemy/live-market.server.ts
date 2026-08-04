import "server-only";

import {
  createPublicClient,
  formatUnits,
  http,
  type Hex,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import { stateViewReadAbi } from "../onchain/abis";
import {
  marketCapNativeWadFromSqrtPriceX96,
  nativePriceWadFromSqrtPriceX96,
} from "../onchain/math";
import type { ExploreSnapshot, ReadyOnchainDeployment } from "../onchain/types";
import { usdValueFromWei } from "../onchain/usd";
import type { LauncherToken } from "../tokens";

const LIVE_POOL_STATE_TTL_MS = 5_000;
const MAX_LIVE_POOL_STATE_ENTRIES = 256;

type LivePoolState = Readonly<{
  sqrtPriceX96: bigint;
  tick: number;
  protocolFeePips: number;
  lpFeePips: number;
  blockNumber: bigint;
}>;

const livePoolStateCache = new Map<
  string,
  Readonly<{
    expiresAt: number;
    value: Promise<LivePoolState | null>;
  }>
>();

function currentCacheEntry(key: string) {
  const entry = livePoolStateCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt > Date.now()) return entry.value;
  livePoolStateCache.delete(key);
  return null;
}

function trimPoolStateCache() {
  while (livePoolStateCache.size > MAX_LIVE_POOL_STATE_ENTRIES) {
    const oldest = livePoolStateCache.keys().next().value;
    if (oldest === undefined) return;
    livePoolStateCache.delete(oldest);
  }
}

function validPoolToken(token: LauncherToken) {
  return (
    token.launchModel !== "stock-paired" &&
    typeof token.totalSupplyRaw === "string" &&
    /^(?:0|[1-9]\d*)$/u.test(token.totalSupplyRaw) &&
    typeof token.tokenDecimals === "number" &&
    Number.isInteger(token.tokenDecimals) &&
    token.tokenDecimals >= 0 &&
    token.tokenDecimals <= 255 &&
    /^0x[0-9a-f]{64}$/iu.test(token.poolId)
  );
}

function snapshotBlock(snapshot: ExploreSnapshot) {
  if (!/^(?:0|[1-9]\d*)$/u.test(snapshot.blockNumber)) {
    throw new Error("Alchemy live market snapshot block is invalid");
  }
  return BigInt(snapshot.blockNumber);
}

function applyLivePoolState(
  token: LauncherToken,
  state: LivePoolState | null,
  snapshot: ExploreSnapshot,
) {
  if (!state || !validPoolToken(token)) return token;

  const tokenDecimals = token.tokenDecimals as number;
  const totalSupplyRaw = BigInt(token.totalSupplyRaw as string);
  const tokenPriceEthWei = nativePriceWadFromSqrtPriceX96(
    state.sqrtPriceX96,
    tokenDecimals,
  );
  const marketCapEthWei = marketCapNativeWadFromSqrtPriceX96(
    totalSupplyRaw,
    state.sqrtPriceX96,
  );
  const tokenPriceUsdWad = snapshot.ethUsdQuote
    ? usdValueFromWei(
        tokenPriceEthWei.toString(),
        BigInt(snapshot.ethUsdQuote.answer),
        snapshot.ethUsdQuote.decimals,
      )
    : undefined;
  const marketCapUsdWad = snapshot.ethUsdQuote
    ? usdValueFromWei(
        marketCapEthWei.toString(),
        BigInt(snapshot.ethUsdQuote.answer),
        snapshot.ethUsdQuote.decimals,
      )
    : undefined;

  return {
    ...token,
    tokenPriceEthWei: tokenPriceEthWei.toString(),
    tokenPriceEth: formatUnits(tokenPriceEthWei, 18),
    marketCapEthWei: marketCapEthWei.toString(),
    marketCapEth: formatUnits(marketCapEthWei, 18),
    indexedValuationBlockNumber: state.blockNumber.toString(),
    currentTick: state.tick,
    protocolFeePips: state.protocolFeePips,
    lpFeePips: state.lpFeePips,
    ...(tokenPriceUsdWad === undefined
      ? {}
      : { tokenPriceUsdWad: tokenPriceUsdWad.toString() }),
    ...(marketCapUsdWad === undefined
      ? {}
      : { fdvUsdWad: marketCapUsdWad.toString() }),
  } satisfies LauncherToken;
}

export async function enrichTokensWithAlchemyPoolState(input: {
  deployment: ReadyOnchainDeployment;
  snapshot: ExploreSnapshot;
  tokens: readonly LauncherToken[];
}) {
  const eligible = input.tokens.filter(validPoolToken);
  if (eligible.length === 0) return [...input.tokens];

  const blockNumber = snapshotBlock(input.snapshot);
  const states = new Map<string, Promise<LivePoolState | null>>();
  const missing: LauncherToken[] = [];
  for (const token of eligible) {
    const key = token.poolId.toLowerCase();
    const cached = currentCacheEntry(key);
    if (cached) states.set(key, cached);
    else missing.push(token);
  }

  if (missing.length > 0) {
    const client = createPublicClient({
      chain: input.deployment.chainId === 1 ? mainnet : sepolia,
      transport: http(input.deployment.rpcUrl, {
        retryCount: 2,
        timeout: 12_000,
      }),
    });
    const batch = client
      .multicall({
        allowFailure: true,
        blockNumber,
        contracts: missing.map((token) => ({
          address: input.deployment.stateView,
          abi: stateViewReadAbi,
          functionName: "getSlot0" as const,
          args: [token.poolId as Hex],
        })),
      })
      .then((results) =>
        results.map((result): LivePoolState | null => {
          if (result.status !== "success") return null;
          const [sqrtPriceX96, tick, protocolFeePips, lpFeePips] = result.result;
          if (sqrtPriceX96 <= 0n) return null;
          return {
            sqrtPriceX96,
            tick,
            protocolFeePips,
            lpFeePips,
            blockNumber,
          };
        }),
      )
      .catch(() => missing.map(() => null));

    missing.forEach((token, index) => {
      const key = token.poolId.toLowerCase();
      const value = batch.then((results) => results[index] ?? null);
      livePoolStateCache.set(key, {
        expiresAt: Date.now() + LIVE_POOL_STATE_TTL_MS,
        value,
      });
      states.set(key, value);
    });
    trimPoolStateCache();
  }

  const resolved = await Promise.all(
    input.tokens.map(async (token) => {
      const state = states.get(token.poolId.toLowerCase());
      return applyLivePoolState(
        token,
        state ? await state : null,
        input.snapshot,
      );
    }),
  );
  return resolved;
}
