import type { ExploreEntry } from "../tokens";
import type { MarketDataIdentityV1 } from "./market-data-v1";

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;

export function exploreEntryMarketIdentitiesV1(
  entry: ExploreEntry,
): readonly MarketDataIdentityV1[] {
  const tokenAddress = canonicalAddress(entry.tokenAddress);
  if (tokenAddress === null) return [];
  if (entry.exploreKind === "token") {
    const chainId = entry.launchStampProvenance?.chainId ??
      parseChainIdFromTokenId(entry.id);
    const poolId = canonicalPoolId(entry.poolId);
    return chainId === 1 && poolId !== null
      ? [{
          chainId: "1",
          tokenAddress,
          poolId,
          protocol: "uniswap_v4",
        }]
      : [];
  }
  if (entry.chainId !== "1") return [];
  const byPool = new Map<string, MarketDataIdentityV1>();
  for (const market of entry.markets) {
    const poolId = canonicalPoolId(market.poolId);
    if (poolId === null || market.status === "verification_pending") continue;
    const base = canonicalAddress(market.baseAsset.identity.value);
    const quote = canonicalAddress(market.quoteAsset.identity.value);
    if (base !== tokenAddress && quote !== tokenAddress) continue;
    byPool.set(poolId, {
      chainId: "1",
      tokenAddress,
      poolId,
      protocol: "uniswap_v4",
    });
  }
  return [...byPool.values()].sort((first, second) =>
    first.poolId.localeCompare(second.poolId)
  );
}

export function exploreEntriesMarketIdentitiesV1(
  entries: readonly ExploreEntry[],
): readonly MarketDataIdentityV1[] {
  const byPool = new Map<string, MarketDataIdentityV1>();
  const conflictedPools = new Set<string>();
  for (const entry of entries) {
    for (const identity of exploreEntryMarketIdentitiesV1(entry)) {
      if (conflictedPools.has(identity.poolId)) continue;
      const existing = byPool.get(identity.poolId);
      if (existing && existing.tokenAddress !== identity.tokenAddress) {
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
