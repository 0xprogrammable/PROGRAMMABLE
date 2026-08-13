import { isLaunchStampProvenanceV1, type ExploreEntry } from "../tokens";
import type { MarketChartIdentityV1 } from "./market-data-v1";

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const NATIVE_ETH_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;

export function exploreEntryMarketIdentitiesV1(
  entry: ExploreEntry,
): readonly MarketChartIdentityV1[] {
  const tokenAddress = canonicalAddress(entry.tokenAddress);
  if (tokenAddress === null) return [];
  if (entry.exploreKind === "token") {
    const chainId = entry.launchStampProvenance?.chainId ??
      parseChainIdFromTokenId(entry.id);
    const poolId = canonicalPoolId(entry.poolId);
    const quoteAddress = poolId === null
      ? null
      : canonicalTokenQuoteAddress(entry, tokenAddress, poolId);
    return chainId === 1 && poolId !== null && quoteAddress !== null
      ? [{
          chainId: "1",
          tokenAddress,
          poolId,
          quoteAddress,
          protocol: "uniswap_v4",
        }]
      : [];
  }
  if (entry.chainId !== "1") return [];
  const byPool = new Map<string, MarketChartIdentityV1>();
  for (const market of entry.markets) {
    const poolId = canonicalPoolId(market.poolId);
    if (poolId === null || market.status === "verification_pending") continue;
    const base = canonicalAddress(market.baseAsset.identity.value);
    const quote = canonicalAddress(market.quoteAsset.identity.value);
    if (base !== tokenAddress && quote !== tokenAddress) continue;
    const oppositeAddress: `0x${string}` | null = base === tokenAddress
      ? quote
      : base;
    if (oppositeAddress === null || oppositeAddress === tokenAddress) continue;
    byPool.set(poolId, {
      chainId: "1",
      tokenAddress,
      poolId,
      quoteAddress: oppositeAddress,
      protocol: "uniswap_v4",
    });
  }
  return [...byPool.values()].sort((first, second) =>
    first.poolId.localeCompare(second.poolId)
  );
}

export function exploreEntriesMarketIdentitiesV1(
  entries: readonly ExploreEntry[],
): readonly MarketChartIdentityV1[] {
  const byPool = new Map<string, MarketChartIdentityV1>();
  const conflictedPools = new Set<string>();
  for (const entry of entries) {
    for (const identity of exploreEntryMarketIdentitiesV1(entry)) {
      if (conflictedPools.has(identity.poolId)) continue;
      const existing = byPool.get(identity.poolId);
      if (
        existing &&
        (existing.tokenAddress !== identity.tokenAddress ||
          existing.quoteAddress !== identity.quoteAddress)
      ) {
        byPool.delete(identity.poolId);
        conflictedPools.add(identity.poolId);
        continue;
      }
      byPool.set(identity.poolId, identity);
    }
  }
  return [...byPool.values()].sort((first, second) =>
    first.poolId.localeCompare(second.poolId)
  );
}

function canonicalTokenQuoteAddress(
  entry: Extract<ExploreEntry, { exploreKind: "token" }>,
  tokenAddress: `0x${string}`,
  poolId: `0x${string}`,
): `0x${string}` | null {
  const stamp = entry.launchStampProvenance;
  if (stamp) {
    if (!isLaunchStampProvenanceV1(stamp, {
      chainId: 1,
      tokenAddress,
      hookAddress: entry.hookAddress,
      poolId,
    })) return null;
    const currency0 = canonicalAddress(stamp.poolKey.currency0);
    const currency1 = canonicalAddress(stamp.poolKey.currency1);
    if (currency0 === tokenAddress && currency1 !== tokenAddress) {
      return currency1;
    }
    if (currency1 === tokenAddress && currency0 !== tokenAddress) {
      return currency0;
    }
    return null;
  }
  const configuredQuote = canonicalAddress(entry.quoteAssetAddress);
  if (configuredQuote !== null && configuredQuote !== tokenAddress) {
    return configuredQuote;
  }
  return entry.launchModel === "stock-paired" ||
      entry.launchModel === "custom-graph"
    ? null
    : NATIVE_ETH_ADDRESS;
}

function parseChainIdFromTokenId(value: string): number | null {
  const [chainId] = value.split(":", 1);
  if (!chainId || !/^\d+$/u.test(chainId)) return null;
  const parsed = Number(chainId);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function canonicalAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return ADDRESS.test(normalized) ? normalized as `0x${string}` : null;
}

function canonicalPoolId(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return BYTES32.test(normalized) ? normalized as `0x${string}` : null;
}
