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
import { withOperationalRpcFailover } from "../onchain/operational-rpc-failover.server";
import type { ExploreSnapshot, ReadyOnchainDeployment } from "../onchain/types";
import { usdValueFromWei } from "../onchain/usd";
import {
  isLaunchStampProvenanceV1,
  type LauncherToken,
} from "../tokens";

const LIVE_POOL_STATE_TTL_MS = 5_000;
const MAX_LIVE_POOL_STATE_ENTRIES = 256;

type LivePoolState = Readonly<{
  sqrtPriceX96: bigint;
  tick: number;
  protocolFeePips: number;
  lpFeePips: number;
  activeLiquidity: bigint;
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

const NATIVE_CURRENCY = "0x0000000000000000000000000000000000000000";

function validLaunchStampForToken(token: LauncherToken) {
  const stamp = token.launchStampProvenance;
  if (!stamp) return false;
  if (
    !token.creatorAddress ||
    !token.launchTransactionHash ||
    !token.launchBlockNumber ||
    token.launchTransactionIndex === undefined ||
    token.launchLogIndex === undefined
  ) return false;

  return isLaunchStampProvenanceV1(stamp, {
    tokenAddress: token.tokenAddress,
    hookAddress: token.hookAddress,
    poolId: token.poolId,
    launchWallet: token.creatorAddress,
    transactionHash: token.launchTransactionHash,
    blockNumber: token.launchBlockNumber,
    transactionIndex: token.launchTransactionIndex,
    launchLogIndex: token.launchLogIndex,
  });
}

function hasNativeTokenPriceOrientation(token: LauncherToken) {
  const stamp = token.launchStampProvenance;
  if (stamp) {
    return validLaunchStampForToken(token) &&
      stamp.poolKey.currency0.toLowerCase() === NATIVE_CURRENCY &&
      stamp.poolKey.currency1.toLowerCase() === token.tokenAddress.toLowerCase();
  }

  // Existing canonical read models are native/token pools. A Custom Graph is
  // never allowed to inherit that assumption without its complete PoolKey.
  return token.launchModel !== "custom-graph";
}

function validPoolStateToken(token: LauncherToken) {
  if (!/^0x[0-9a-f]{64}$/iu.test(token.poolId)) return false;
  if (token.launchStampProvenance) return validLaunchStampForToken(token);
  return token.launchModel !== "stock-paired" &&
    token.launchModel !== "custom-graph";
}

function validValuationToken(token: LauncherToken) {
  return (
    hasNativeTokenPriceOrientation(token) &&
    typeof token.totalSupplyRaw === "string" &&
    /^(?:0|[1-9]\d*)$/u.test(token.totalSupplyRaw) &&
    typeof token.tokenDecimals === "number" &&
    Number.isInteger(token.tokenDecimals) &&
    token.tokenDecimals >= 0 &&
    token.tokenDecimals <= 255
  );
}

function withoutNativeValuation(token: LauncherToken): LauncherToken {
  const withoutValuation = { ...token };
  delete withoutValuation.tokenPriceEth;
  delete withoutValuation.tokenPriceEthWei;
  delete withoutValuation.tokenPriceUsdWad;
  delete withoutValuation.tokenPriceQuote;
  delete withoutValuation.tokenPriceQuoteWad;
  delete withoutValuation.marketCapEth;
  delete withoutValuation.marketCapEthWei;
  delete withoutValuation.marketCapQuote;
  delete withoutValuation.marketCapQuoteWad;
  delete withoutValuation.indexedMarketCapEth;
  delete withoutValuation.indexedMarketCapEthWei;
  delete withoutValuation.indexedMarketCapUsdWad;
  delete withoutValuation.indexedValuationBlockNumber;
  delete withoutValuation.fdvUsdWad;
  return withoutValuation;
}

function snapshotBlock(snapshot: ExploreSnapshot) {
  if (!/^(?:0|[1-9]\d*)$/u.test(snapshot.blockNumber)) {
    throw new Error("Alchemy live market snapshot block is invalid");
  }
  return BigInt(snapshot.blockNumber);
}

function poolStateCacheKey(input: {
  deployment: ReadyOnchainDeployment;
  blockNumber: bigint;
  poolId: string;
}) {
  return [
    input.deployment.chainId,
    input.deployment.stateView.toLowerCase(),
    input.blockNumber.toString(),
    input.poolId.toLowerCase(),
  ].join(":");
}

function applyLivePoolState(
  token: LauncherToken,
  state: LivePoolState | null,
  snapshot: ExploreSnapshot,
) {
  if (!validPoolStateToken(token)) return token;
  // Preserve a last-known-good valuation with its original indexed block. The
  // chart consumer treats that provenance as stale/partial and never relabels
  // it as the current snapshot while the live read is unavailable.
  if (!state) return token;

  const currentState = {
    // A successful live read starts a new, single-block valuation set. Never
    // combine its block provenance with older indexed or price-API values.
    ...withoutNativeValuation(token),
    currentTick: state.tick,
    activeLiquidity: state.activeLiquidity.toString(),
    protocolFeePips: state.protocolFeePips,
    lpFeePips: state.lpFeePips,
  } satisfies LauncherToken;
  if (state.activeLiquidity <= 0n || !validValuationToken(token)) {
    return withoutNativeValuation(currentState);
  }

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
    ...currentState,
    tokenPriceEthWei: tokenPriceEthWei.toString(),
    tokenPriceEth: formatUnits(tokenPriceEthWei, 18),
    marketCapEthWei: marketCapEthWei.toString(),
    marketCapEth: formatUnits(marketCapEthWei, 18),
    indexedValuationBlockNumber: state.blockNumber.toString(),
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
  const eligible = input.tokens.filter(validPoolStateToken);
  if (eligible.length === 0) return [...input.tokens];

  const blockNumber = snapshotBlock(input.snapshot);
  const states = new Map<string, Promise<LivePoolState | null>>();
  const missing: LauncherToken[] = [];
  for (const token of eligible) {
    const poolId = token.poolId.toLowerCase();
    const cacheKey = poolStateCacheKey({
      deployment: input.deployment,
      blockNumber,
      poolId,
    });
    const cached = currentCacheEntry(cacheKey);
    if (cached) states.set(poolId, cached);
    else missing.push(token);
  }

  if (missing.length > 0) {
    const batch = withOperationalRpcFailover(
      input.deployment,
      async (rpcDeployment) => {
        const client = createPublicClient({
          chain: rpcDeployment.chainId === 1 ? mainnet : sepolia,
          transport: http(rpcDeployment.rpcUrl, {
            retryCount: 1,
            timeout: 12_000,
          }),
        });
        const [slot0Results, liquidityResults] = await Promise.all([
          client.multicall({
            allowFailure: true,
            blockNumber,
            contracts: missing.map((token) => ({
              address: rpcDeployment.stateView,
              abi: stateViewReadAbi,
              functionName: "getSlot0" as const,
              args: [token.poolId as Hex],
            })),
          }),
          client.multicall({
            allowFailure: true,
            blockNumber,
            contracts: missing.map((token) => ({
              address: rpcDeployment.stateView,
              abi: stateViewReadAbi,
              functionName: "getLiquidity" as const,
              args: [token.poolId as Hex],
            })),
          }),
        ]);
        return missing.map((_, index): LivePoolState | null => {
          const slot0 = slot0Results[index];
          const liquidity = liquidityResults[index];
          if (
            slot0?.status !== "success" ||
            liquidity?.status !== "success"
          ) {
            return null;
          }
          const [sqrtPriceX96, tick, protocolFeePips, lpFeePips] = slot0.result;
          if (sqrtPriceX96 <= 0n) return null;
          return {
            sqrtPriceX96,
            tick,
            protocolFeePips,
            lpFeePips,
            activeLiquidity: liquidity.result,
            blockNumber,
          };
        });
      },
    )
      .catch(() => missing.map(() => null));

    missing.forEach((token, index) => {
      const poolId = token.poolId.toLowerCase();
      const cacheKey = poolStateCacheKey({
        deployment: input.deployment,
        blockNumber,
        poolId,
      });
      const value = batch.then((results) => results[index] ?? null);
      livePoolStateCache.set(cacheKey, {
        expiresAt: Date.now() + LIVE_POOL_STATE_TTL_MS,
        value,
      });
      states.set(poolId, value);
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
