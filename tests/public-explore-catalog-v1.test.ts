import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SHARD_PUBLIC_PRESENTATION_V1 } from
  "../lib/custom-launch/router-trade-adapters-v1";
import {
  publicExploreCatalogEntriesV1,
  publicExplorePresentationEntryV1,
} from
  "../lib/public-explore-catalog-v1";
import type {
  CanonicalTokenExploreEntry,
  ExploreEntry,
} from "../lib/tokens";
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

  it("attaches the exact SHARD image and social links only to its launch stamp", () => {
    const exact = {
      ...routerEntry(
        SHARD_PUBLIC_PRESENTATION_V1.tokenAddress,
        SHARD_PUBLIC_PRESENTATION_V1.launchId,
      ),
      launchStampProvenance: {
        ...customGraphExploreEntry.launchStampProvenance,
        launchId: SHARD_PUBLIC_PRESENTATION_V1.launchId,
        stampHash: SHARD_PUBLIC_PRESENTATION_V1.stampHash,
      },
    } as CanonicalTokenExploreEntry;
    const enriched = publicExplorePresentationEntryV1(exact);

    expect(enriched).toMatchObject({
      description: SHARD_PUBLIC_PRESENTATION_V1.description,
      imageUrl: SHARD_PUBLIC_PRESENTATION_V1.imageUrl,
      links: SHARD_PUBLIC_PRESENTATION_V1.links,
    });
    expect(publicExplorePresentationEntryV1({
      ...exact,
      launchStampProvenance: {
        ...exact.launchStampProvenance!,
        stampHash: `0x${"ab".repeat(32)}`,
      },
    } as CanonicalTokenExploreEntry)).not.toHaveProperty("imageUrl");

    const image = readFileSync(
      `public${SHARD_PUBLIC_PRESENTATION_V1.imageUrl}`,
    );
    expect(createHash("sha256").update(image).digest("hex")).toBe(
      "01311db4e3af189d4b383b7a0f63c615adfcf959c552b2a61df5e5597768fb91",
    );
  });
});
