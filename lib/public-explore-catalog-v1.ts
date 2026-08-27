import type { ExploreEntry } from "./tokens";

/**
 * Finalized Router identities that remain addressable by their direct token
 * routes but are intentionally not part of the public Explore catalog.
 *
 * The boundary is exact EIP-155 identity, never mutable presentation metadata
 * such as a token name or symbol.
 */
export const PUBLIC_EXPLORE_CATALOG_EXCLUSIONS_V1 = Object.freeze([
  {
    chainId: 1,
    tokenAddress: "0xD0f3E1e5C985D2b37a66Cf07feCB0d8191c0445F",
    launchId:
      "0x786d3d5cdd0c6ba81621eb01fbcc6b5912556a2d7dbe886431346460afeee197",
  },
  {
    chainId: 1,
    tokenAddress: "0x69D278968AbF120F878F2E1E016Ab615D3686c19",
    launchId:
      "0x6d6ed0e1e69a7cd6afa177e3454c9e32eed61cbd3f855ee56aff1915a6776fc2",
  },
  {
    chainId: 1,
    tokenAddress: "0x9DEeB39D2590b0cAD5fc473F755C5F97Dcc8f7cE",
    launchId:
      "0x5a52180427785716bff0a36218dde89f0459db265d0c2bdfcfde81a8fe733c92",
  },
] as const);

const EXCLUDED_LAUNCH_IDENTITIES = new Set(
  PUBLIC_EXPLORE_CATALOG_EXCLUSIONS_V1.map(
    ({ chainId, tokenAddress, launchId }) =>
      `${chainId}:${tokenAddress.toLowerCase()}:${launchId.toLowerCase()}`,
  ),
);

export function publicExploreCatalogEntriesV1(
  entries: readonly ExploreEntry[],
): readonly ExploreEntry[] {
  return Object.freeze(entries.filter((entry) => {
    if (entry.exploreKind !== "token") return true;
    const provenance = entry.launchStampProvenance;
    if (provenance === undefined) return true;
    const identity = [
      provenance.chainId,
      entry.tokenAddress.toLowerCase(),
      provenance.launchId.toLowerCase(),
    ].join(":");
    return !EXCLUDED_LAUNCH_IDENTITIES.has(identity);
  }));
}
