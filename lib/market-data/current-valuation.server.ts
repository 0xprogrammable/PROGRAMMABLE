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

function deadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Current market evidence deadline exceeded")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function settleCurrentEvidenceSnapshot<T>(input: Readonly<{
  read: Promise<T | null>;
  requireComplete: boolean;
  timeoutMs?: number;
}>): Promise<T | null> {
  try {
    const snapshot = await deadline(
      input.read,
      input.timeoutMs ?? CURRENT_EVIDENCE_ROUTE_DEADLINE_MS,
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
    ? deadline((async () => {
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
        const liquidityRead = readOfficialV4LiquidityEvidence({
          tokens: candidates,
          referenceHead: {
            chainId: 1,
            blockNumber: operationalSnapshot.blockNumber,
            blockHash: operationalSnapshot.blockHash,
          },
          now: input.now,
        });
        const pricedSnapshotRead = withSameBlockEthUsdQuote({
          deployment,
          snapshot: operationalSnapshot,
        });
        let liquidityCoverageFailed = false;
        const [liquidityEvidence, pricedSnapshot] = await Promise.all([
          input.requireCompleteLiquidityCoverage
            ? liquidityRead
            : liquidityRead.catch(
                () => {
                  liquidityCoverageFailed = true;
                  return [] as readonly OfficialV4LiquidityEvidenceV1[];
                },
              ),
          input.requireCompleteLiquidityCoverage
            ? pricedSnapshotRead
            : pricedSnapshotRead.catch(() => null),
        ]);
        if (liquidityCoverageFailed) {
          return { status: "source-unavailable" as const };
        }
        const liquidityByPool = new Map(
          liquidityEvidence.map((evidence) => [
            evidence.identity.poolId.toLowerCase(),
            evidence,
          ]),
        );
        const priceCandidates = candidates.filter((entry) =>
          liquidityByPool.has(entry.poolId.toLowerCase()),
        );
        const pricedTokens = pricedSnapshot && priceCandidates.length > 0
          ? await enrichTokensWithAlchemyPoolState({
              deployment,
              snapshot: pricedSnapshot,
              tokens: priceCandidates,
            }).catch((error) => {
              if (input.requireCompleteLiquidityCoverage) throw error;
              return [] as LauncherToken[];
            })
          : [];
        const pricedByToken = new Map(
          pricedTokens.map((token) => [
            token.tokenAddress.toLowerCase(),
            token,
          ]),
        );
        const stateCoverageIncomplete =
          input.requireCompleteLiquidityCoverage &&
          priceCandidates.some((candidate) => {
            const priced = pricedByToken.get(
              candidate.tokenAddress.toLowerCase(),
            );
            const state = priced?.liveMarketStateEvidence;
            const price = priced?.liveMarketPriceEvidence;
            const exactState = state !== undefined &&
              state.blockNumber === operationalSnapshot.blockNumber &&
              state.blockHash.toLowerCase() ===
                operationalSnapshot.blockHash.toLowerCase();
            const exactPrice = price !== undefined &&
              price.blockNumber === operationalSnapshot.blockNumber &&
              price.blockHash.toLowerCase() ===
                operationalSnapshot.blockHash.toLowerCase();
            return !exactState ||
              (state.activeLiquidity !== "0" && !exactPrice);
          });
        if (stateCoverageIncomplete) {
          throw new Error("Current StateView market evidence is incomplete");
        }
        return {
          status: "complete" as const,
          liquidityByPool,
          pricedByToken,
        };
      })(), timeoutMs).then(
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
  const { liquidityByPool, pricedByToken } = outcome.value;
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
    if (!liquidityByPool.has(entry.poolId.toLowerCase())) {
      return withoutUnevidencedCurrentBitqueryValuation(
        valued,
        input.allowHistoricalBitqueryFallback === true,
        "liquidity-unavailable",
      );
    }
    if (knownLiquidityIneligible(priced)) {
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
