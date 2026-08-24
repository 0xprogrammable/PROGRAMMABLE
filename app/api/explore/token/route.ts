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
import {
  mergeRouterCustomExploreEntriesV1,
  publicLaunchSourceV1,
  readFinalizedRouterCustomExploreEntriesV1,
  ROUTER_CUSTOM_FINALITY_CONFIRMATIONS,
  ROUTER_CUSTOM_LAUNCH_SOURCE,
  routerCustomEntriesAtOrBeforeBlockV1,
} from "../../../../lib/alchemy/router-custom-public.server";
import { readProductionCustomExploreDirectoryV1 } from
  "../../../../lib/server/custom-launch/explore-directory-v1";
import { isCustomLaunchRegistryPublicReadEnabled } from
  "../../../../lib/server/custom-launch/public-readiness";
import { readPublicCreatorArticleV1 } from
  "../../../../lib/server/creator-article/public-read.server";
import type {
  CanonicalTokenExploreEntry,
  ExploreEntry,
} from "../../../../lib/tokens";

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
  routerStatus: "current" | "unavailable";
}>) {
  return {
    "Cache-Control": SUCCESS_CACHE_CONTROL,
    "X-Programmable-Launch-Source": input.launchSource,
    "X-Programmable-Read-Source": `${input.launchSource}+dexscreener`,
    "X-Programmable-Market-Provider": "dexscreener",
    "X-Programmable-Market-Read-Status": input.marketStatus,
    "X-Programmable-Router-Read-Status": input.routerStatus,
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
  const registryEnabled = isCustomLaunchRegistryPublicReadEnabled();
  const registryRead = registryEnabled
    ? readProductionCustomExploreDirectoryV1(readSignal).then(
        (entries) => ({
          entries,
          failed: false,
          status: "current" as const,
        }),
        () => {
          console.error("Token detail Custom Registry read unavailable", {
            name: "CustomRegistryReadError",
          });
          return {
            entries: [] as readonly ExploreEntry[],
            failed: true,
            status: "unavailable" as const,
          };
        },
      )
    : Promise.resolve({
        entries: [] as readonly ExploreEntry[],
        failed: false,
        status: "unavailable" as const,
      });
  const routerRead = readFinalizedRouterCustomExploreEntriesV1({
    signal: readSignal,
    deadlineMs,
  }).then(
    (verified) => ({
      entries: routerCustomEntriesAtOrBeforeBlockV1(
        verified,
        catalog.asOfBlock,
      ),
      failed: false,
      status: "current" as const,
      verifiedIdentityCount: verified.length,
    }),
    () => {
      console.error("Token detail Router Custom read unavailable", {
        name: "RouterCustomReadError",
      });
      return {
        entries: [] as readonly CanonicalTokenExploreEntry[],
        failed: true,
        status: "unavailable" as const,
        verifiedIdentityCount: 0,
      };
    },
  );
  const [registryReadResult, routerReadResult] = await Promise.all([
    registryRead,
    routerRead,
  ]);
  let registryCustomStatus = registryReadResult.status;
  let routerCustomStatus = routerReadResult.status;
  let registryReadFailed = registryReadResult.failed;
  let routerReadFailed = routerReadResult.failed;
  let customEntries = registryReadResult.entries;
  let routerEntries = routerReadResult.entries;
  const requestedRouterIdentityRead = routerEntries.some(
    (candidate) => tokenAddress(candidate) === address,
  );
  let registryIdentityEntries: readonly ExploreEntry[];
  try {
    registryIdentityEntries = mergeEnvioClassicV3CatalogEntriesV1(
      catalog.entries,
      customEntries,
    );
  } catch {
    console.error("Token detail Custom Registry identity merge unavailable", {
      name: "CustomRegistryIdentityError",
    });
    customEntries = [];
    registryIdentityEntries = catalog.entries;
    registryCustomStatus = "unavailable";
    registryReadFailed = registryEnabled;
  }
  let identityEntries: readonly ExploreEntry[];
  try {
    identityEntries = mergeRouterCustomExploreEntriesV1(
      registryIdentityEntries,
      routerEntries,
    );
  } catch {
    console.error("Token detail Router Custom identity merge unavailable", {
      name: "RouterCustomIdentityError",
    });
    routerEntries = [];
    identityEntries = registryIdentityEntries;
    routerCustomStatus = "unavailable";
    routerReadFailed = true;
  }
  const entry: ExploreEntry | null = identityEntries.find(
    (candidate) => tokenAddress(candidate) === address,
  ) ?? null;
  const customStatus =
    registryCustomStatus === "current" && routerCustomStatus === "current"
      ? "current" as const
      : "unavailable" as const;
  const launchSource = publicLaunchSourceV1({
    registryCustomCurrent: registryCustomStatus === "current",
    routerCustomCurrent: routerCustomStatus === "current",
  });
  const projectedRouterIdentityCount = identityEntries.filter(
    (candidate) => candidate.exploreKind === "token" &&
      candidate.launchCategoryProvenance.source ===
        ROUTER_CUSTOM_LAUNCH_SOURCE,
  ).length;
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
      registryCustom: registryCustomStatus,
      routerCustom: routerCustomStatus,
    },
    scope: {
      ...catalog.scope,
      included: routerCustomStatus === "current"
        ? [...catalog.scope.included, ROUTER_CUSTOM_LAUNCH_SOURCE]
        : catalog.scope.included,
    },
    evidence: catalog.evidence,
    routerStamp: {
      source: ROUTER_CUSTOM_LAUNCH_SOURCE,
      status: routerCustomStatus,
      finalityConfirmations: ROUTER_CUSTOM_FINALITY_CONFIRMATIONS,
      verifiedIdentityCount: routerReadResult.verifiedIdentityCount,
      projectedIdentityCount: projectedRouterIdentityCount,
    },
  };

  if (routerReadFailed && requestedRouterIdentityRead && canonicalEntry === null) {
    return unavailableResponse({
      "X-Programmable-Launch-Source": launchSource,
      "X-Programmable-Read-Source": `${launchSource}+dexscreener`,
      "X-Programmable-Market-Provider": "dexscreener",
      "X-Programmable-Router-Read-Status": routerCustomStatus,
    });
  }
  if (!entry) {
    if (registryReadFailed || routerReadFailed) {
      return unavailableResponse({
        "X-Programmable-Launch-Source": launchSource,
        "X-Programmable-Read-Source": `${launchSource}+dexscreener`,
        "X-Programmable-Market-Provider": "dexscreener",
        "X-Programmable-Router-Read-Status": routerCustomStatus,
      });
    }
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
          routerStatus: routerCustomStatus,
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
          routerStatus: routerCustomStatus,
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
          routerStatus: routerCustomStatus,
        }),
      },
    );
  }
}
