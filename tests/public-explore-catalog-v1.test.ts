import { describe, expect, it } from "vitest";

import { publicExploreCatalogEntriesV1 } from
  "../lib/public-explore-catalog-v1";
import type { ExploreEntry } from "../lib/tokens";
import { customGraphExploreEntry } from "./launch-stamp-surface-fixture";

function routerEntry(
  tokenAddress: `0x${string}`,
  launchId: `0x${string}`,
): ExploreEntry {
  return {
    ...customGraphExploreEntry,
    id: `1:${tokenAddress.toLowerCase()}`,
    tokenAddress,
    launchStampProvenance: {
      ...customGraphExploreEntry.launchStampProvenance,
      launchId,
    },
    launchCategoryProvenance: {
      ...customGraphExploreEntry.launchCategoryProvenance,
      launchId,
    },
  };
}

describe("public Explore catalog exclusions", () => {
  it("requires both the exact token address and exact launch id", () => {
    const tokenAddress =
      "0x69D278968AbF120F878F2E1E016Ab615D3686c19" as const;
    const launchId =
      "0x6d6ed0e1e69a7cd6afa177e3454c9e32eed61cbd3f855ee56aff1915a6776fc2" as const;
    const exact = routerEntry(tokenAddress, launchId);
    const addressOnly = routerEntry(tokenAddress, `0x${"ab".repeat(32)}`);
    const launchOnly = routerEntry(
      "0x1111111111111111111111111111111111111111",
      launchId,
    );

    expect(publicExploreCatalogEntriesV1([
      exact,
      addressOnly,
      launchOnly,
    ])).toEqual([addressOnly, launchOnly]);
  });
});
