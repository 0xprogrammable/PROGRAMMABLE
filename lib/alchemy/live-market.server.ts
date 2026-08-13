import "server-only";

import {
  createPublicClient,
  formatUnits,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import { stateViewReadAbi } from "../onchain/abis";
import {
  marketCapNativeWadFromSqrtPriceX96,
  nativePriceWadFromSqrtPriceX96,
} from "../onchain/math";
import {
  OperationalRpcUnavailableError,
  withOperationalRpcFailover,
} from "../onchain/operational-rpc-failover.server";
import { readOperationalRpcHealth } from "../onchain/rpc-health";
import type { ExploreSnapshot, ReadyOnchainDeployment } from "../onchain/types";
import {
  assertValidEthUsdSnapshot,
  ETH_USD_FEED_ADDRESS,
  usdValueFromWei,
} from "../onchain/usd";
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
  blockHash: Hex;
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
const Q96 = 1n << 96n;
const ethUsdReadAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

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
  delete withoutValuation.liveMarketStateEvidence;
  delete withoutValuation.liveMarketPriceEvidence;
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

function unixTimestampIso(value: string): string | undefined {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) return undefined;
  try {
    const seconds = BigInt(value);
    if (seconds > 8_640_000_000_000n) return undefined;
    return new Date(Number(seconds) * 1_000).toISOString();
  } catch {
    return undefined;
  }
}

/**
 * A launch-discovery snapshot may be newer than the durable market snapshot.
 * Never carry the durable ETH/USD quote across that block boundary: doing so
 * combines a current pool ratio with an older FX observation and produces a
 * plausible but incorrect USD FDV.
 */
export function withoutUnboundEthUsdQuote(
  snapshot: ExploreSnapshot,
): ExploreSnapshot {
  const withoutQuote = { ...snapshot };
  delete withoutQuote.ethUsdQuote;
  delete withoutQuote.blockTimestamp;
  return withoutQuote;
}

/**
 * Resolves the market read target from the two configured operational RPCs,
 * not from the potentially lagging launch-discovery model. Only a fresh
 * confirmed block with matching hashes from both providers can be labelled as
 * current market data.
 */
export async function readVerifiedOperationalMarketSnapshot(
  deployment: ReadyOnchainDeployment,
): Promise<ExploreSnapshot | null> {
  const health = await readOperationalRpcHealth(deployment);
  if (
    health.status !== "healthy" ||
    health.read.status !== "available" ||
    health.quorum.status !== "verified" ||
    health.confirmedBlock === null
  ) return null;

  return {
    chainId: deployment.chainId,
    blockNumber: health.confirmedBlock.number,
    blockHash: health.confirmedBlock.hash,
    confirmations: Number(deployment.confirmations),
  };
}

/**
 * Reads Chainlink at the exact pool-state block and verifies the provider's
 * block hash before the quote can be used. Capacity/transport failures use the
 * fixed operational secondary through the same bounded failover policy as
 * StateView reads.
 */
export async function withSameBlockEthUsdQuote(input: {
  deployment: ReadyOnchainDeployment;
  snapshot: ExploreSnapshot;
}): Promise<ExploreSnapshot> {
  const snapshot = withoutUnboundEthUsdQuote(input.snapshot);
  if (input.deployment.chainId !== 1) return snapshot;
  const blockNumber = snapshotBlock(snapshot);
  const quote = await withOperationalRpcFailover(
    input.deployment,
    async (rpcDeployment) => {
      const client = createPublicClient({
        chain: mainnet,
        transport: http(rpcDeployment.rpcUrl, {
          retryCount: 1,
          timeout: 12_000,
        }),
      });
      const [decimals, roundData, block] = await Promise.all([
        client.readContract({
          address: ETH_USD_FEED_ADDRESS,
          abi: ethUsdReadAbi,
          functionName: "decimals",
          blockNumber,
        }),
        client.readContract({
          address: ETH_USD_FEED_ADDRESS,
          abi: ethUsdReadAbi,
          functionName: "latestRoundData",
          blockNumber,
        }),
        client.getBlock({ blockNumber }),
      ]);
      const [roundId, answer, , updatedAt, answeredInRound] = roundData;
      assertValidEthUsdSnapshot({
        expectedBlockHash: snapshot.blockHash,
        actualBlockHash: block.hash,
        blockTimestamp: block.timestamp,
        roundId,
        answeredInRound,
        answer,
        updatedAt,
      });
      return {
        roundId,
        answeredInRound,
        answer,
        decimals,
        updatedAt,
        blockTimestamp: block.timestamp,
      };
    },
  );

  return {
    ...snapshot,
    blockTimestamp: quote.blockTimestamp.toString(),
    ethUsdQuote: {
      feedAddress: ETH_USD_FEED_ADDRESS,
      roundId: quote.roundId.toString(),
      answeredInRound: quote.answeredInRound.toString(),
      answer: quote.answer.toString(),
      decimals: quote.decimals,
      updatedAt: quote.updatedAt.toString(),
    },
  };
}

function poolStateCacheKey(input: {
  deployment: ReadyOnchainDeployment;
  blockNumber: bigint;
  poolId: string;
  blockHash: Hex;
}) {
  return [
    input.deployment.chainId,
    input.deployment.stateView.toLowerCase(),
    input.blockNumber.toString(),
    input.blockHash.toLowerCase(),
    input.poolId.toLowerCase(),
  ].join(":");
}

function applyLivePoolState(
  token: LauncherToken,
  state: LivePoolState | null,
  snapshot: ExploreSnapshot,
  deployment: ReadyOnchainDeployment,
) {
  if (!validPoolStateToken(token)) return token;
  // Preserve a last-known-good valuation with its original indexed block. The
  // chart consumer treats that provenance as stale/partial and never relabels
  // it as the current snapshot while the live read is unavailable.
  if (!state) {
    const withoutEvidence = { ...token };
    delete withoutEvidence.liveMarketStateEvidence;
    delete withoutEvidence.liveMarketPriceEvidence;
    return withoutEvidence;
  }
  if (state.blockHash.toLowerCase() !== snapshot.blockHash.toLowerCase()) {
    return withoutNativeValuation(token);
  }

  const currentState = {
    // A successful live read starts a new, single-block valuation set. Never
    // combine its block provenance with older indexed or price-API values.
    ...withoutNativeValuation(token),
    currentTick: state.tick,
    activeLiquidity: state.activeLiquidity.toString(),
    protocolFeePips: state.protocolFeePips,
    lpFeePips: state.lpFeePips,
    liveMarketStateEvidence: {
      source: "uniswap-v4-stateview-v1",
      blockNumber: state.blockNumber.toString(),
      blockHash: state.blockHash,
      sqrtPriceX96: state.sqrtPriceX96.toString(),
      activeLiquidity: state.activeLiquidity.toString(),
    },
  } satisfies LauncherToken;
  if (state.activeLiquidity <= 0n || !validValuationToken(token)) {
    return {
      ...withoutNativeValuation(currentState),
      liveMarketStateEvidence: currentState.liveMarketStateEvidence,
    };
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
  const activeVirtualToken0Wei =
    (state.activeLiquidity * Q96) / state.sqrtPriceX96;
  const activeVirtualLiquidityUsdWad = snapshot.ethUsdQuote
    ? usdValueFromWei(
        (2n * activeVirtualToken0Wei).toString(),
        BigInt(snapshot.ethUsdQuote.answer),
        snapshot.ethUsdQuote.decimals,
      )
    : undefined;
  const blockTimestamp = snapshot.blockTimestamp;
  const blockTime = blockTimestamp
    ? unixTimestampIso(blockTimestamp)
    : undefined;
  const quoteUpdatedAt = snapshot.ethUsdQuote?.updatedAt;
  const quoteUpdatedAtTime = quoteUpdatedAt
    ? unixTimestampIso(quoteUpdatedAt)
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
    ...(tokenPriceUsdWad === undefined ||
      marketCapUsdWad === undefined ||
      activeVirtualLiquidityUsdWad === undefined ||
      !snapshot.ethUsdQuote ||
      !snapshot.ethUsdQuote.answeredInRound ||
      !blockTimestamp ||
      !blockTime ||
      !quoteUpdatedAtTime ||
      deployment.chainId !== 1
      ? {}
      : {
          liveMarketPriceEvidence: {
            schemaVersion:
              "programmable.stateview-chainlink-price-evidence.v1",
            source: "uniswap-v4-stateview-chainlink-v1",
            chainId: "1",
            poolId: token.poolId,
            tokenAddress: token.tokenAddress,
            quoteAddress: NATIVE_CURRENCY,
            stateViewAddress: deployment.stateView,
            stateViewRuntimeCodeHash: deployment.stateViewRuntimeCodeHash,
            blockNumber: state.blockNumber.toString(),
            blockHash: snapshot.blockHash,
            blockTimestamp,
            blockTime,
            sqrtPriceX96: state.sqrtPriceX96.toString(),
            activeLiquidity: state.activeLiquidity.toString(),
            activeVirtualToken0Wei: activeVirtualToken0Wei.toString(),
            activeVirtualLiquidityUsdWad:
              activeVirtualLiquidityUsdWad.toString(),
            activeVirtualLiquidityValueBasis:
              "stateview-active-liquidity-virtual-depth-usd",
            tokenPriceEthWei: tokenPriceEthWei.toString(),
            tokenPriceUsdWad: tokenPriceUsdWad.toString(),
            totalSupplyRaw: totalSupplyRaw.toString(),
            tokenDecimals,
            fdvUsdWad: marketCapUsdWad.toString(),
            ethUsdQuote: {
              ...snapshot.ethUsdQuote,
              answeredInRound: snapshot.ethUsdQuote.answeredInRound,
              updatedAtTime: quoteUpdatedAtTime,
            },
          },
        }),
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
      blockHash: input.snapshot.blockHash,
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
        const [slot0Results, liquidityResults, block] = await Promise.all([
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
          client.getBlock({ blockNumber }),
        ]);
        if (block.hash.toLowerCase() !== input.snapshot.blockHash.toLowerCase()) {
          throw new OperationalRpcUnavailableError();
        }
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
            blockHash: block.hash,
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
        blockHash: input.snapshot.blockHash,
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
        input.deployment,
      );
    }),
  );
  return resolved;
}
