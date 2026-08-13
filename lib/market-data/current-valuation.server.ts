import "server-only";

import {
  enrichTokensWithAlchemyPoolState,
  withSameBlockEthUsdQuote,
} from "../alchemy/live-market.server";
import {
  isCanonicalClassicNativeTokenEntry,
  withBitqueryMarketData,
  withCurrentOnchainValuation,
  type ValuedExploreEntry,
} from "../explore-financial-data";
import {
  readOfficialV4LiquidityEvidence,
  type OfficialV4LiquidityEvidenceV1,
} from "../onchain/uniswap-v4-subgraph";
import type {
  ExploreSnapshot,
  ReadyOnchainDeployment,
} from "../onchain/types";
import type { ExploreEntry, LauncherToken } from "../tokens";
import {
  MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD,
  type TokenMarketDataV1,
} from "./market-data-v1";

const HISTORICAL_BITQUERY_DETAIL_TOKEN_ADDRESS =
  "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce"; // gitleaks:allow -- public Ethereum token address
export const CURRENT_EVIDENCE_ROUTE_DEADLINE_MS = 4_500;

export type CurrentEvidenceSnapshotOutcome =
  | Readonly<{ status: "fulfilled"; value: ExploreSnapshot | null }>
  | Readonly<{ status: "rejected"; error: unknown }>;

function withoutUnevidencedCurrentBitqueryValuation(
  entry: ValuedExploreEntry,
  allowHistoricalBitqueryFallback: boolean,
  reason: "source-unavailable" | "liquidity-unavailable" =
    "source-unavailable",
) {
  if (
    allowHistoricalBitqueryFallback &&
    entry.exploreKind === "token" &&
    entry.tokenAddress.toLowerCase() === HISTORICAL_BITQUERY_DETAIL_TOKEN_ADDRESS &&
    entry.valuation.status === "available" &&
    entry.valuation.source === "bitquery" &&
    entry.valuation.freshness === "stale" &&
    (entry.marketData?.pools.every((pool) =>
      pool.valuation.status !== "available" ||
      pool.valuation.freshness === "stale"
    ) ?? true)
  ) return entry;
  const marketData = entry.marketData
    ? {
        ...entry.marketData,
        pools: entry.marketData.pools.map((pool) => ({
          ...pool,
          valuation: pool.valuation.status === "available"
            ? {
                status: "unavailable" as const,
                reason: reason === "source-unavailable"
                  ? "source-unavailable" as const
                  : "inconsistent-market-data" as const,
              }
            : pool.valuation,
        })),
      }
    : undefined;
  if (
    entry.valuation.status === "available" &&
    entry.valuation.source === "bitquery"
  ) {
    return {
      ...entry,
      ...(marketData ? { marketData } : {}),
      valuation: {
        status: "unavailable" as const,
        reason,
      },
    };
  }
  return marketData ? { ...entry, marketData } : entry;
}

function deadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  upstreamSignal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    };
    const settle = (
      complete: (value: T | PromiseLike<T>) => void,
      value: T,
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      complete(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = (reason: unknown) => {
      if (!controller.signal.aborted) controller.abort(reason);
      fail(reason);
    };
    const abortFromUpstream = () => abort(
      upstreamSignal?.reason ?? new Error("Current market evidence aborted"),
    );
    const timer = setTimeout(() => abort(
      new Error("Current market evidence deadline exceeded"),
    ), timeoutMs);
    if (upstreamSignal?.aborted) {
      abortFromUpstream();
      return;
    }
    upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
    Promise.resolve().then(() => operation(controller.signal)).then(
      (value) => {
        settle(resolve, value);
      },
      (error) => {
        fail(error);
      },
    );
  });
}

export async function settleCurrentEvidenceSnapshot<T>(input: Readonly<{
  read: (signal: AbortSignal) => Promise<T | null>;
  requireComplete: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}>): Promise<T | null> {
  try {
    const snapshot = await deadline(
      input.read,
      input.timeoutMs ?? CURRENT_EVIDENCE_ROUTE_DEADLINE_MS,
      input.signal,
    );
    if (snapshot === null && input.requireComplete) {
      throw new Error("Current market evidence reference head is unavailable");
    }
    return snapshot;
  } catch (error) {
    if (input.requireComplete) throw error;
    return null;
  }
}

function knownLiquidityIneligible(token: LauncherToken | undefined): boolean {
  const stateLiquidity = token?.liveMarketStateEvidence?.activeLiquidity;
  if (stateLiquidity === "0") return true;
  const activeDepth = token?.liveMarketPriceEvidence
    ?.activeVirtualLiquidityUsdWad;
  if (!activeDepth || !/^(?:0|[1-9]\d*)$/u.test(activeDepth)) return false;
  return BigInt(activeDepth) <
    BigInt(MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD);
}

function exactStateAtSnapshot(
  token: LauncherToken | undefined,
  snapshot: ExploreSnapshot,
) {
  const state = token?.liveMarketStateEvidence;
  return state !== undefined &&
    state.blockNumber === snapshot.blockNumber &&
    state.blockHash.toLowerCase() === snapshot.blockHash.toLowerCase()
    ? state
    : undefined;
}

function exactPriceAtSnapshot(
  token: LauncherToken | undefined,
  snapshot: ExploreSnapshot,
) {
  const price = token?.liveMarketPriceEvidence;
  return price !== undefined &&
    price.blockNumber === snapshot.blockNumber &&
    price.blockHash.toLowerCase() === snapshot.blockHash.toLowerCase()
    ? price
    : undefined;
}

function baseValuedEntry(
  entry: ExploreEntry,
  marketByToken: ReadonlyMap<string, TokenMarketDataV1>,
  context: Readonly<{ maximumValuationAgeMs?: number; now?: Date }>,
): ValuedExploreEntry {
  const marketData = entry.tokenAddress
    ? marketByToken.get(entry.tokenAddress.toLowerCase())
    : undefined;
  if (marketData) {
    return withBitqueryMarketData(entry, marketData, context);
  }
  return {
    ...entry,
    valuation: {
      status: "unavailable",
      reason:
        entry.exploreKind === "custom-project" && entry.markets.length === 0
          ? "no-market"
          : "source-unavailable",
    },
  };
}

/**
 * Adds Bitquery trades, volume and chart data after a page has already been
 * ordered from exact current evidence. The independently proven valuation is
 * preserved, while every numeric Bitquery valuation remains sanitized.
 */
export async function attachBitqueryMarketDataToValuedEntries(input: Readonly<{
  entries: readonly ValuedExploreEntry[];
  marketByToken:
    | ReadonlyMap<string, TokenMarketDataV1>
    | Promise<ReadonlyMap<string, TokenMarketDataV1>>;
  maximumValuationAgeMs?: number;
  now?: Date;
}>): Promise<ValuedExploreEntry[]> {
  const marketByToken = await input.marketByToken;
  return input.entries.map((entry) => {
    const withMarketData = baseValuedEntry(entry, marketByToken, {
      maximumValuationAgeMs: input.maximumValuationAgeMs,
      now: input.now,
    });
    const withPreservedValuation = {
      ...withMarketData,
      valuation: entry.valuation,
    } as ValuedExploreEntry;
    const reason = entry.valuation.status === "unavailable" &&
        entry.valuation.reason === "liquidity-unavailable"
      ? "liquidity-unavailable" as const
      : "source-unavailable" as const;
    return withoutUnevidencedCurrentBitqueryValuation(
      withPreservedValuation,
      false,
      reason,
    );
  });
}

function classicNativeToken(entry: ExploreEntry): entry is Extract<
  ExploreEntry,
  { exploreKind: "token" }
> {
  return isCanonicalClassicNativeTokenEntry(entry);
}

/**
 * Keeps Bitquery attached for trades, volume and charts, but promotes a public
 * current FDV only from the independently bound StateView/Chainlink and
 * official-v4 liquidity evidence paths.
 */
export async function valueExploreEntriesWithCurrentEvidence(input: Readonly<{
  entries: readonly ExploreEntry[];
  marketByToken:
    | ReadonlyMap<string, TokenMarketDataV1>
    | Promise<ReadonlyMap<string, TokenMarketDataV1>>;
  deployment: ReadyOnchainDeployment | null;
  operationalSnapshot:
    | ExploreSnapshot
    | null
    | Promise<ExploreSnapshot | null | CurrentEvidenceSnapshotOutcome>;
  maximumValuationAgeMs?: number;
  now?: Date;
  requireCompleteLiquidityCoverage?: boolean;
  allowHistoricalBitqueryFallback?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}>): Promise<ValuedExploreEntry[]> {
  const candidates = input.entries.filter(classicNativeToken);
  const timeoutMs = input.timeoutMs ?? CURRENT_EVIDENCE_ROUTE_DEADLINE_MS;
  const deployment = input.deployment?.chainId === 1
    ? input.deployment
    : null;
  const operationalSnapshotRead = Promise.resolve(input.operationalSnapshot)
    .then(
      (value): CurrentEvidenceSnapshotOutcome =>
        typeof value === "object" && value !== null &&
          "status" in value &&
          (value.status === "fulfilled" || value.status === "rejected")
          ? value as CurrentEvidenceSnapshotOutcome
          : { status: "fulfilled", value: value as ExploreSnapshot | null },
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
  const canReadCurrentEvidence = candidates.length > 0 &&
    timeoutMs > 0 &&
    deployment !== null;

  const currentEvidenceOutcome = canReadCurrentEvidence
    ? deadline(async (signal) => {
        const operationalSnapshotOutcome = await operationalSnapshotRead;
        if (operationalSnapshotOutcome.status === "rejected") {
          throw operationalSnapshotOutcome.error;
        }
        const operationalSnapshot = operationalSnapshotOutcome.value;
        if (operationalSnapshot === null) {
          throw new Error(
            "Current market evidence reference head is unavailable",
          );
        }
        const pricedSnapshotRead = withSameBlockEthUsdQuote({
          deployment,
          snapshot: operationalSnapshot,
          signal,
        });
        // StateView and Chainlink are both bound to the same confirmed block.
        // Start them together; the first StateView pass deliberately carries
        // no quote, then the exact-block cache applies the verified quote
        // without another provider read.
        const stateSnapshotRead = enrichTokensWithAlchemyPoolState({
          deployment,
          snapshot: operationalSnapshot,
          tokens: candidates,
          signal,
        });
        const [pricedSnapshot, stateTokens] = await Promise.all([
          input.requireCompleteLiquidityCoverage
            ? pricedSnapshotRead
            : pricedSnapshotRead.catch(() => null),
          input.requireCompleteLiquidityCoverage
            ? stateSnapshotRead
            : stateSnapshotRead.catch(() => [] as LauncherToken[]),
        ]);
        if (!pricedSnapshot) {
          return { status: "source-unavailable" as const };
        }
        const stateByToken = new Map(
          stateTokens.map((token) => [token.tokenAddress.toLowerCase(), token]),
        );
        const stateCoverageIncomplete = candidates.some((candidate) =>
          exactStateAtSnapshot(
            stateByToken.get(candidate.tokenAddress.toLowerCase()),
            operationalSnapshot,
          ) === undefined
        );
        if (stateCoverageIncomplete) {
          if (input.requireCompleteLiquidityCoverage) {
            throw new Error("Current StateView market evidence is incomplete");
          }
          return { status: "source-unavailable" as const };
        }

        const pricedTokens = await enrichTokensWithAlchemyPoolState({
          deployment,
          snapshot: pricedSnapshot,
          tokens: candidates,
          signal,
        }).catch((error) => {
          if (input.requireCompleteLiquidityCoverage) throw error;
          return [] as LauncherToken[];
        });
        const pricedByToken = new Map(
          pricedTokens.map((token) => [
            token.tokenAddress.toLowerCase(),
            token,
          ]),
        );
        const priceCoverageIncomplete = candidates.some((candidate) => {
          const priced = pricedByToken.get(
            candidate.tokenAddress.toLowerCase(),
          );
          const state = exactStateAtSnapshot(priced, operationalSnapshot);
          return state === undefined ||
            (state.activeLiquidity !== "0" &&
              exactPriceAtSnapshot(priced, operationalSnapshot) === undefined);
        });
        if (priceCoverageIncomplete) {
          if (input.requireCompleteLiquidityCoverage) {
            throw new Error("Current StateView market evidence is incomplete");
          }
          return { status: "source-unavailable" as const };
        }

        const liquidityCandidates = candidates.filter((candidate) => {
          const priced = pricedByToken.get(candidate.tokenAddress.toLowerCase());
          return exactPriceAtSnapshot(priced, operationalSnapshot) !== undefined &&
            !knownLiquidityIneligible(priced);
        });
        const liquidityRequestedPools = new Set(
          liquidityCandidates.map((candidate) => candidate.poolId.toLowerCase()),
        );
        let liquidityCoverageFailed = false;
        const liquidityEvidence = liquidityCandidates.length === 0
          ? [] as readonly OfficialV4LiquidityEvidenceV1[]
          : await readOfficialV4LiquidityEvidence({
              tokens: liquidityCandidates,
              referenceHead: {
                chainId: 1,
                blockNumber: operationalSnapshot.blockNumber,
                blockHash: operationalSnapshot.blockHash,
              },
              now: input.now,
            }, { signal }).catch((error) => {
              if (input.requireCompleteLiquidityCoverage) throw error;
              liquidityCoverageFailed = true;
              return [] as readonly OfficialV4LiquidityEvidenceV1[];
            });
        if (liquidityCoverageFailed) {
          return { status: "source-unavailable" as const };
        }
        const liquidityByPool = new Map(
          liquidityEvidence.map((evidence) => [
            evidence.identity.poolId.toLowerCase(),
            evidence,
          ]),
        );
        return {
          status: "complete" as const,
          liquidityByPool,
          liquidityRequestedPools,
          pricedByToken,
        };
      }, timeoutMs, input.signal).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    )
    : null;

  const marketByToken = await input.marketByToken;
  const marketEntries = input.entries.map((entry) =>
    baseValuedEntry(entry, marketByToken, {
      maximumValuationAgeMs: input.maximumValuationAgeMs,
      now: input.now,
    }),
  );
  const baseEntries = marketEntries.map((entry) =>
    withoutUnevidencedCurrentBitqueryValuation(
      entry,
      input.allowHistoricalBitqueryFallback === true,
    ),
  );
  if (candidates.length === 0) return baseEntries;
  if (!canReadCurrentEvidence || currentEvidenceOutcome === null) {
    if (input.requireCompleteLiquidityCoverage) {
      throw new Error(timeoutMs <= 0
        ? "Current market evidence deadline exceeded"
        : "Current market evidence reference head is unavailable");
    }
    return baseEntries;
  }

  const outcome = await currentEvidenceOutcome;
  if (outcome.status === "rejected") {
    if (input.requireCompleteLiquidityCoverage) throw outcome.error;
    return baseEntries;
  }
  if (outcome.value.status === "source-unavailable") return baseEntries;
  const { liquidityByPool, liquidityRequestedPools, pricedByToken } =
    outcome.value;
  return marketEntries.map((entry) => {
    if (entry.exploreKind !== "token") return entry;
    const priced = pricedByToken.get(entry.tokenAddress.toLowerCase());
    const currentEntry = priced
      ? ({ ...entry, ...priced } as typeof entry)
      : entry;
    const valued = withCurrentOnchainValuation(
      currentEntry,
      liquidityByPool.get(entry.poolId.toLowerCase()),
    );
    if (knownLiquidityIneligible(priced)) {
      return withoutUnevidencedCurrentBitqueryValuation(
        valued,
        input.allowHistoricalBitqueryFallback === true,
        "liquidity-unavailable",
      );
    }
    if (
      liquidityRequestedPools.has(entry.poolId.toLowerCase()) &&
      !liquidityByPool.has(entry.poolId.toLowerCase())
    ) {
      return withoutUnevidencedCurrentBitqueryValuation(
        valued,
        input.allowHistoricalBitqueryFallback === true,
        "liquidity-unavailable",
      );
    }
    return withoutUnevidencedCurrentBitqueryValuation(
      valued,
      input.allowHistoricalBitqueryFallback === true,
      "source-unavailable",
    );
  });
}
