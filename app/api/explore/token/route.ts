import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  publicExploreEntryV1,
} from "../../../../lib/explore-financial-data";
import { readDexscreenerExploreEntriesV1 } from
  "../../../../lib/market-data/dexscreener-explore.server";
import {
  envioClassicV3IdentityCommitmentV1,
  mergeEnvioClassicV3CatalogEntriesV1,
  readEnvioClassicV3CatalogV1,
} from
  "../../../../lib/market-data/envio-classic-v3-catalog.server";
import { readProductionCustomExploreDirectoryV1 } from
  "../../../../lib/server/custom-launch/explore-directory-v1";
import { isCustomLaunchRegistryPublicReadEnabled } from
  "../../../../lib/server/custom-launch/public-readiness";
import { readPublicCreatorArticleV1 } from
  "../../../../lib/server/creator-article/public-read.server";
import type { ExploreEntry } from "../../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const FAST_LANE_REQUEST_BUDGET_MS = 8_000;

const SUCCESS_CACHE_CONTROL =
  "public, max-age=0, s-maxage=5, stale-while-revalidate=30";

function tokenAddress(entry: ExploreEntry): string | null {
  return entry.tokenAddress?.toLowerCase() ?? null;
}

function canonicalResponseHeaders(input: Readonly<{
  marketAsOf?: string;
  hasDexscreenerPrice: boolean;
  marketStatus: "complete" | "partial" | "unavailable";
  launchSource: string;
  lastIndexedAt: string;
}>) {
  return {
    "Cache-Control": SUCCESS_CACHE_CONTROL,
    "X-Programmable-Launch-Source": input.launchSource,
    "X-Programmable-Read-Source": `${input.launchSource}+dexscreener`,
    "X-Programmable-Market-Provider": "dexscreener",
    "X-Programmable-Market-Read-Status": input.marketStatus,
    "X-Programmable-Identity-Last-Indexed-At": input.lastIndexedAt,
    ...(input.hasDexscreenerPrice
      ? { "X-Programmable-Market-Source": "dexscreener" }
      : {}),
    ...(input.marketAsOf
      ? { "X-Programmable-Market-As-Of": input.marketAsOf }
      : {}),
    ...(input.hasDexscreenerPrice
      ? { "X-Programmable-Price-Source": "dexscreener" }
      : {}),
  };
}

function unavailableResponse(
  headers: Record<string, string>,
) {
  return NextResponse.json(
    { error: "Token data is temporarily unavailable" },
    {
      status: 503,
      headers: {
        ...headers,
        "Cache-Control": "no-store",
        "Retry-After": "5",
      },
    },
  );
}

export async function GET(request: NextRequest) {
  const deadlineMs = Date.now() + FAST_LANE_REQUEST_BUDGET_MS;
  const readSignal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(FAST_LANE_REQUEST_BUDGET_MS),
  ]);
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some((key) => key !== "address") ||
    search.getAll("address").length !== 1
  ) {
    return NextResponse.json(
      { error: "Unsupported query parameters" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const input = search.get("address")?.trim();
  if (!input || !isAddress(input)) {
    return NextResponse.json(
      { error: "Enter a valid Ethereum token address" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const requestedTokenAddress = getAddress(input);
  const address = requestedTokenAddress.toLowerCase();
  let catalog;
  try {
    catalog = await readEnvioClassicV3CatalogV1({
      signal: readSignal,
      deadlineMs,
    });
  } catch (error) {
    console.error("Token detail identity read failed", {
      name: error instanceof Error ? error.name : "LaunchCatalogError",
    });
    return unavailableResponse({
      "X-Programmable-Launch-Source": "envio-classic-v3",
      "X-Programmable-Market-Provider": "dexscreener",
      "X-Programmable-Read-Source": "envio-classic-v3+dexscreener",
    });
  }

  const canonicalEntry = catalog.entries.find(
    (candidate) => candidate.exploreKind === "token" &&
      tokenAddress(candidate) === address,
  ) ?? null;
  let customEntries: readonly ExploreEntry[] = [];
  let customStatus: "current" | "unavailable" = "unavailable";
  if (isCustomLaunchRegistryPublicReadEnabled()) {
    try {
      customEntries = await readProductionCustomExploreDirectoryV1(
        readSignal,
      );
      customStatus = "current";
    } catch {
      console.error("Token detail Custom Registry read unavailable", {
        name: "CustomRegistryReadError",
      });
      if (canonicalEntry === null) {
        return unavailableResponse({
          "X-Programmable-Launch-Source": catalog.source,
          "X-Programmable-Read-Source": `${catalog.source}+registry.custom-launched`,
          "X-Programmable-Market-Provider": "dexscreener",
        });
      }
    }
  }
  let identityEntries: readonly ExploreEntry[];
  try {
    identityEntries = mergeEnvioClassicV3CatalogEntriesV1(
      catalog.entries,
      customEntries,
    );
  } catch {
    return unavailableResponse({
      "X-Programmable-Launch-Source": catalog.source,
      "X-Programmable-Read-Source": `${catalog.source}+registry.custom-launched`,
      "X-Programmable-Market-Provider": "dexscreener",
    });
  }
  const entry: ExploreEntry | null = canonicalEntry ?? customEntries.find(
    (candidate) => tokenAddress(candidate) === address,
  ) ?? null;
  const launchSource = customStatus === "current"
    ? `${catalog.source}+registry.custom-launched`
    : catalog.source;
  const catalogBoundary = {
    source: catalog.source,
    launchSource,
    status: catalog.status,
    lastIndexedAt: catalog.generatedAt,
    asOfBlock: catalog.asOfBlock,
    asOfBlockHash: catalog.asOfBlockHash,
    identityCount: identityEntries.length,
    identityCommitment: envioClassicV3IdentityCommitmentV1(
      catalog,
      identityEntries,
    ),
    completeness: {
      ...catalog.completeness,
      custom: customStatus,
    },
    scope: catalog.scope,
    evidence: catalog.evidence,
  };

  if (!entry) {
    return NextResponse.json(
      {
        status: "ready",
        token: null,
        customProject: null,
        creatorArticle: null,
        snapshot: null,
        catalog: catalogBoundary,
      },
      {
        status: 404,
        headers: canonicalResponseHeaders({
          hasDexscreenerPrice: false,
          marketStatus: "complete",
          launchSource,
          lastIndexedAt: catalog.generatedAt,
        }),
      },
    );
  }

  try {
    const creatorArticlePromise = readPublicCreatorArticleV1(
      entry.tokenAddress!,
    );
    const market = await readDexscreenerExploreEntriesV1([entry], {
      signal: readSignal,
      deadlineMs,
    });
    const valuedEntry = market.entries[0];
    if (!valuedEntry) throw new Error("Dexscreener identity mapping failed");
    const hasDexscreenerPrice = valuedEntry.valuation.status === "available";
    const marketAsOf = valuedEntry.valuation.status === "available"
      ? valuedEntry.valuation.asOfTime
      : undefined;
    const publicEntry = publicExploreEntryV1(valuedEntry);

    return NextResponse.json(
      {
        status: "ready",
        token: publicEntry.exploreKind === "token" ? publicEntry : null,
        customProject:
          publicEntry.exploreKind === "custom-project" ? publicEntry : null,
        creatorArticle: await creatorArticlePromise,
        snapshot:
          publicEntry.exploreKind === "token" ? { chainId: 1 } : null,
        catalog: catalogBoundary,
      },
      {
        headers: canonicalResponseHeaders({
          hasDexscreenerPrice,
          marketStatus: market.marketRead.status,
          launchSource,
          lastIndexedAt: catalog.generatedAt,
          ...(marketAsOf ? { marketAsOf } : {}),
        }),
      },
    );
  } catch (error) {
    console.error("Token detail market read failed", {
      name: error instanceof Error ? error.name : "DexscreenerReadError",
    });
    // Unexpected adapter failures remain fail-soft: the already verified
    // identity is returned without valuation rather than hidden behind a 503.
    const publicEntry = publicExploreEntryV1({
      ...entry,
      valuation: { status: "unavailable", reason: "source-unavailable" },
    });
    const creatorArticle = await readPublicCreatorArticleV1(entry.tokenAddress!);
    return NextResponse.json(
      {
        status: "ready",
        token: publicEntry.exploreKind === "token" ? publicEntry : null,
        customProject:
          publicEntry.exploreKind === "custom-project" ? publicEntry : null,
        creatorArticle,
        snapshot: publicEntry.exploreKind === "token" ? { chainId: 1 } : null,
        catalog: catalogBoundary,
      },
      {
        headers: canonicalResponseHeaders({
          hasDexscreenerPrice: false,
          marketStatus: "unavailable",
          launchSource,
          lastIndexedAt: catalog.generatedAt,
        }),
      },
    );
  }
}
