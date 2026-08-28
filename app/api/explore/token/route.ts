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
  readFinalizedRouterCustomIdentitySnapshotV1,
  ROUTER_CUSTOM_FINALITY_CONFIRMATIONS,
  ROUTER_CUSTOM_LAUNCH_SOURCE,
} from "../../../../lib/alchemy/router-custom-public.server";
import { readProductionCustomExploreDirectoryV1 } from
  "../../../../lib/server/custom-launch/explore-directory-v1";
import { readProductionSourceVerificationDisplayV1 } from
  "../../../../lib/server/custom-launch/source-verification-display-v1";
import { routerTradeProjectForServerBoundEntryV1 } from
  "../../../../lib/server/custom-launch/router-trade-descriptor-v1";
import {
  publicExploreCatalogEntriesV1,
  publicExplorePresentationEntryV1,
} from
  "../../../../lib/public-explore-catalog-v1";
import { isCustomLaunchRegistryPublicReadEnabled } from
  "../../../../lib/server/custom-launch/public-readiness";
import { readPublicCreatorArticleV1 } from
  "../../../../lib/server/creator-article/public-read.server";
import { canonicalSha256 } from
  "../../../../lib/server/projection-target/hashing";
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
  canonicalStatus: "current" | "last-known-good" | "unavailable";
  routerStatus: "current" | "last-known-good" | "unavailable";
}>) {
  return {
    "Cache-Control": SUCCESS_CACHE_CONTROL,
    "X-Programmable-Launch-Source": input.launchSource,
    "X-Programmable-Read-Source": `${input.launchSource}+dexscreener`,
    "X-Programmable-Market-Provider": "dexscreener",
    "X-Programmable-Market-Read-Status": input.marketStatus,
    "X-Programmable-Canonical-Read-Status": input.canonicalStatus,
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
  const catalogRead = readEnvioClassicV3CatalogV1({
    signal: readSignal,
    deadlineMs,
  }).then(
    (catalog) => catalog,
    () => {
      console.error("Token detail Envio identity read unavailable", {
        name: "EnvioClassicV3ReadError",
      });
      return null;
    },
  );
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
  const routerRead = readFinalizedRouterCustomIdentitySnapshotV1({
    signal: readSignal,
    deadlineMs,
  }).then(
    (snapshot) => ({
      entries: snapshot.entries,
      failed: snapshot.status !== "current",
      status: snapshot.status,
      snapshot,
      verifiedIdentityCount: snapshot.entries.length,
    }),
    () => {
      console.error("Token detail Router Custom read unavailable", {
        name: "RouterCustomReadError",
      });
      return {
        entries: [] as readonly CanonicalTokenExploreEntry[],
        failed: true,
        status: "unavailable" as const,
        snapshot: null,
        verifiedIdentityCount: 0,
      };
    },
  );
  const [catalog, registryReadResult, routerReadResult] = await Promise.all([
    catalogRead,
    registryRead,
    routerRead,
  ]);
  const canonicalReadFailed = catalog === null || catalog.status !== "current";
  let registryCustomStatus = registryReadResult.status;
  let routerCustomStatus = routerReadResult.status;
  let registryReadFailed = registryReadResult.failed;
  let routerReadFailed = routerReadResult.failed;
  let customEntries = registryReadResult.entries;
  let routerEntries = routerReadResult.entries;
  const requestedRouterIdentityRead = routerEntries.some(
    (candidate) => tokenAddress(candidate) === address,
  );
  const canonicalEntry = catalog?.entries.find(
    (candidate) => candidate.exploreKind === "token" &&
      tokenAddress(candidate) === address,
  ) ?? null;
  if (catalog === null) {
    // Registry projects do not carry an independent onchain snapshot.
    // Only the Router lane may stand alone on its bound durable cursor.
    customEntries = [];
    registryCustomStatus = "unavailable";
    registryReadFailed = registryEnabled;
  }
  let registryIdentityEntries: readonly ExploreEntry[];
  try {
    registryIdentityEntries = mergeEnvioClassicV3CatalogEntriesV1(
      catalog?.entries ?? [],
      customEntries,
    );
  } catch {
    console.error("Token detail Custom Registry identity merge unavailable", {
      name: "CustomRegistryIdentityError",
    });
    customEntries = [];
    registryIdentityEntries = catalog?.entries ?? [];
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
  const publicIdentityEntries = publicExploreCatalogEntriesV1(identityEntries);
  if (
    catalog === null &&
    (routerReadResult.snapshot === null ||
      routerCustomStatus === "unavailable")
  ) {
    return unavailableResponse({
      "X-Programmable-Launch-Source": ROUTER_CUSTOM_LAUNCH_SOURCE,
      "X-Programmable-Read-Source": ROUTER_CUSTOM_LAUNCH_SOURCE,
      "X-Programmable-Router-Read-Status": routerCustomStatus,
    });
  }
  const customStatus =
    registryCustomStatus === "current" && routerCustomStatus === "current"
      ? "current" as const
      : registryCustomStatus === "current" &&
          routerCustomStatus === "last-known-good"
        ? "last-known-good" as const
      : "unavailable" as const;
  const routerAvailable = routerCustomStatus !== "unavailable";
  const acceptedRouterSnapshot = routerAvailable
    ? routerReadResult.snapshot
    : null;
  const launchSource = publicLaunchSourceV1({
    envioAvailable: catalog !== null,
    registryCustomCurrent: registryCustomStatus === "current",
    routerCustomCurrent: routerAvailable,
  });
  const projectedRouterIdentityCount = publicIdentityEntries.filter(
    (candidate) => candidate.exploreKind === "token" &&
      candidate.launchCategoryProvenance.source ===
        ROUTER_CUSTOM_LAUNCH_SOURCE,
  ).length;
  const routerOwnsAggregateBoundary = acceptedRouterSnapshot !== null &&
    (catalog === null ||
      BigInt(acceptedRouterSnapshot.asOfBlock) > BigInt(catalog.asOfBlock));
  const identityAsOfBlock = routerOwnsAggregateBoundary
    ? acceptedRouterSnapshot!.asOfBlock
    : catalog?.asOfBlock ?? "0";
  const identityAsOfBlockHash = routerOwnsAggregateBoundary
    ? acceptedRouterSnapshot!.asOfBlockHash
    : catalog?.asOfBlockHash;
  const identityGeneratedAt = catalog?.generatedAt ??
    acceptedRouterSnapshot!.generatedAt;
  const identityCommitment = catalog === null
    ? canonicalSha256("programmable.public-identity-fallback.v1", {
        chainId: 1,
        launchSource: ROUTER_CUSTOM_LAUNCH_SOURCE,
        asOfBlock: identityAsOfBlock,
        entries: publicIdentityEntries,
      })
    : envioClassicV3IdentityCommitmentV1(catalog, publicIdentityEntries);
  const catalogScope = catalog?.scope ?? {
    included: [] as readonly string[],
    excluded: [
      "classic-v1",
      "classic-v2",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ] as const,
    publicCategories: ["classic", "custom"] as const,
  };
  const includedSources = new Set<string>(catalogScope.included);
  if (registryCustomStatus === "current") {
    includedSources.add("registry.custom-launched");
  }
  if (routerAvailable) includedSources.add(ROUTER_CUSTOM_LAUNCH_SOURCE);
  const catalogBoundary = {
    source: "envio-classic-v3" as const,
    launchSource,
    status: catalog?.status ?? "last-known-good" as const,
    lastIndexedAt: identityGeneratedAt,
    asOfBlock: identityAsOfBlock,
    asOfBlockHash: identityAsOfBlockHash,
    identityCount: publicIdentityEntries.length,
    identityCommitment,
    completeness: {
      ...(catalog?.completeness ?? {
        classic: "unavailable" as const,
        stock: "excluded" as const,
        custom: "unavailable" as const,
      }),
      custom: customStatus,
      registryCustom: registryCustomStatus,
      routerCustom: routerCustomStatus,
    },
    scope: {
      ...catalogScope,
      included: [...includedSources],
    },
    ...(catalog ? { evidence: catalog.evidence } : {}),
    routerStamp: {
      source: ROUTER_CUSTOM_LAUNCH_SOURCE,
      status: routerCustomStatus,
      finalityConfirmations: ROUTER_CUSTOM_FINALITY_CONFIRMATIONS,
      verifiedIdentityCount: routerAvailable
        ? routerReadResult.verifiedIdentityCount
        : 0,
      projectedIdentityCount: projectedRouterIdentityCount,
      ...(acceptedRouterSnapshot
        ? {
            generatedAt: acceptedRouterSnapshot.generatedAt,
            asOfBlock: acceptedRouterSnapshot.asOfBlock,
            asOfBlockHash: acceptedRouterSnapshot.asOfBlockHash,
            identityCommitment:
              acceptedRouterSnapshot.identityCommitment,
          }
        : {}),
    },
  };
  if (
    requestedRouterIdentityRead &&
    entry?.launchCategoryProvenance.source !== ROUTER_CUSTOM_LAUNCH_SOURCE &&
    canonicalEntry === null
  ) {
    return unavailableResponse({
      "X-Programmable-Launch-Source": launchSource,
      "X-Programmable-Read-Source": `${launchSource}+dexscreener`,
      "X-Programmable-Market-Provider": "dexscreener",
      "X-Programmable-Router-Read-Status": routerCustomStatus,
    });
  }
  if (!entry) {
    if (canonicalReadFailed || registryReadFailed || routerReadFailed) {
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
        routerTradeProject: null,
        sourceVerification: null,
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
          lastIndexedAt: identityGeneratedAt,
          canonicalStatus: catalog?.status ?? "unavailable",
          routerStatus: routerCustomStatus,
        }),
      },
    );
  }

  const routerTradeProject = entry.exploreKind === "token"
    ? routerTradeProjectForServerBoundEntryV1(
        entry,
        acceptedRouterSnapshot,
      )
    : null;
  const sourceVerificationPromise = entry.exploreKind === "token"
      && entry.launchCategoryProvenance.category === "custom"
      && entry.launchCategoryProvenance.source === ROUTER_CUSTOM_LAUNCH_SOURCE
    ? readProductionSourceVerificationDisplayV1(
        entry.tokenAddress!,
        readSignal,
      )
    : Promise.resolve(null);

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
    const publicEntry = publicExploreEntryV1(
      publicExplorePresentationEntryV1(valuedEntry),
    );

    return NextResponse.json(
      {
        status: "ready",
        token: publicEntry.exploreKind === "token" ? publicEntry : null,
        customProject:
          publicEntry.exploreKind === "custom-project" ? publicEntry : null,
        routerTradeProject,
        sourceVerification: await sourceVerificationPromise,
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
          lastIndexedAt: identityGeneratedAt,
          canonicalStatus: catalog?.status ?? "unavailable",
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
    const publicEntry = publicExploreEntryV1(
      publicExplorePresentationEntryV1({
        ...entry,
        valuation: { status: "unavailable", reason: "source-unavailable" },
      }),
    );
    const creatorArticle = await readPublicCreatorArticleV1(entry.tokenAddress!);
    return NextResponse.json(
      {
        status: "ready",
        token: publicEntry.exploreKind === "token" ? publicEntry : null,
        customProject:
          publicEntry.exploreKind === "custom-project" ? publicEntry : null,
        routerTradeProject,
        sourceVerification: await sourceVerificationPromise,
        creatorArticle,
        snapshot: publicEntry.exploreKind === "token" ? { chainId: 1 } : null,
        catalog: catalogBoundary,
      },
      {
        headers: canonicalResponseHeaders({
          hasDexscreenerPrice: false,
          marketStatus: "unavailable",
          launchSource,
          lastIndexedAt: identityGeneratedAt,
          canonicalStatus: catalog?.status ?? "unavailable",
          routerStatus: routerCustomStatus,
        }),
      },
    );
  }
}
