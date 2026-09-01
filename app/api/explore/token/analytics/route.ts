import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  mergeRouterCustomExploreEntriesV1,
  publicLaunchSourceV1,
  readFinalizedRouterCustomIdentitySnapshotV1,
  ROUTER_CUSTOM_LAUNCH_SOURCE,
} from "../../../../../lib/alchemy/router-custom-public.server";
import {
  mergeEnvioClassicV3CatalogEntriesV1,
  readEnvioClassicV3CatalogV1,
} from
  "../../../../../lib/market-data/envio-classic-v3-catalog.server";
import { exploreEntryMarketIdentitiesV1 } from
  "../../../../../lib/market-data/explore-market-identities";
import {
  isGmgnMarketSnapshotForExploreEntryV1,
  isGmgnMarketSnapshotV1,
  type GmgnMarketSnapshotV1,
} from "../../../../../lib/market-data/gmgn-market-data-v1";
import {
  isGmgnTokenPoolInfoV1,
  isGmgnTokenSecurityV1,
  isGmgnTokenWalletRankingV1,
  type GmgnTokenPoolInfoV1,
  type GmgnTokenSecurityV1,
  type GmgnTokenWalletRankingV1,
} from "../../../../../lib/market-data/gmgn-token-analytics-v1";
import {
  readGmgnTokenPoolInfoV1,
  readGmgnTokenSecurityV1,
  readGmgnTokenTopHoldersV1,
  readGmgnTokenTopTradersV1,
} from
  "../../../../../lib/market-data/gmgn-token-analytics.server";
import { readGmgnMarketSnapshotV1 } from
  "../../../../../lib/market-data/gmgn.server";
import type { MarketChartIdentityV1 } from
  "../../../../../lib/market-data/market-data-v1";
import { readProductionCustomExploreDirectoryV1 } from
  "../../../../../lib/server/custom-launch/explore-directory-v1";
import { isCustomLaunchRegistryPublicReadEnabled } from
  "../../../../../lib/server/custom-launch/public-readiness";
import { tryParseViewChainId } from
  "../../../../../lib/view-chain";
import type {
  CanonicalTokenExploreEntry,
  ExploreEntry,
} from "../../../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REQUEST_BUDGET_MS = 8_000;
const PUBLIC_SUMMARY_CACHE_CONTROL =
  "public, max-age=0, s-maxage=15, stale-while-revalidate=30";
const PRIVATE_RANKING_CACHE_CONTROL = "private, max-age=0, no-store";
const NO_STORE = "no-store";
const DEFAULT_RANKING_LIMIT = 20;
const MAXIMUM_RANKING_LIMIT = 20;

type AnalyticsSection = "summary" | "holders" | "traders";
type AnalyticsStatus = "ready" | "partial" | "unavailable";
type CanonicalReadStatus = "current" | "last-known-good" | "unavailable";
type RouterReadStatus = "current" | "last-known-good" | "unavailable";

type ReadyCanonicalToken = Readonly<{
  kind: "ready";
  entry: Extract<ExploreEntry, { exploreKind: "token" }>;
  launchSource: string;
  lastIndexedAt: string;
  canonicalStatus: CanonicalReadStatus;
  routerStatus: RouterReadStatus;
}>;

type NonReadyCanonicalToken<Kind extends "not-found" | "unavailable"> =
  Readonly<{
  kind: Kind;
  launchSource: string;
  lastIndexedAt?: string;
  canonicalStatus: CanonicalReadStatus;
  routerStatus: RouterReadStatus;
}>;

type CanonicalResolution = ReadyCanonicalToken |
  NonReadyCanonicalToken<"not-found"> |
  NonReadyCanonicalToken<"unavailable">;

const JSON_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

export async function GET(request: NextRequest) {
  const query = parseQuery(request);
  if (query instanceof NextResponse) return query;

  const deadlineMs = Date.now() + REQUEST_BUDGET_MS;
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(REQUEST_BUDGET_MS),
  ]);

  let canonical: CanonicalResolution;
  try {
    canonical = await resolveCanonicalTokenV1(
      query.address.toLowerCase(),
      signal,
      deadlineMs,
    );
  } catch (error) {
    console.error("Token analytics canonical identity read failed", {
      name: error instanceof Error ? error.name : "CanonicalIdentityReadError",
    });
    return canonicalUnavailableResponse({
      launchSource: "envio-classic-v3",
      canonicalStatus: "unavailable",
      routerStatus: "unavailable",
    });
  }

  if (canonical.kind === "unavailable") {
    return canonicalUnavailableResponse(canonical);
  }
  if (canonical.kind === "not-found") {
    return NextResponse.json(
      { error: "Token not found" },
      {
        status: 404,
        headers: {
          ...JSON_SECURITY_HEADERS,
          "Cache-Control": NO_STORE,
          "X-Programmable-Chain-Id": "1",
          "X-Programmable-Launch-Source": canonical.launchSource,
          "X-Programmable-Read-Source": canonical.launchSource,
          "X-Programmable-Canonical-Read-Status": canonical.canonicalStatus,
          "X-Programmable-Router-Read-Status": canonical.routerStatus,
          ...(canonical.lastIndexedAt
            ? {
                "X-Programmable-Identity-Last-Indexed-At":
                  canonical.lastIndexedAt,
              }
            : {}),
        },
      },
    );
  }

  const identities = exploreEntryMarketIdentitiesV1(canonical.entry);
  if (identities.length !== 1) {
    return analyticsResponse({
      canonical,
      section: query.section,
      status: "unavailable",
      identity: null,
      analytics: emptyAnalytics(query.section),
    });
  }
  const identity = identities[0]!;
  const wait = { signal, deadlineMs } as const;

  if (query.section === "summary") {
    const [securityRead, poolRead] = await Promise.allSettled([
      readGmgnTokenSecurityV1(identity, wait),
      readGmgnTokenPoolInfoV1(identity, wait),
    ]);
    const security = securityRead.status === "fulfilled" &&
        exactSecurityForIdentity(securityRead.value, identity)
      ? securityRead.value
      : null;
    const pool = poolRead.status === "fulfilled" &&
        exactPoolForIdentity(poolRead.value, identity)
      ? poolRead.value
      : null;
    const acceptedCount = Number(security !== null) + Number(pool !== null);
    return analyticsResponse({
      canonical,
      section: query.section,
      status: acceptedCount === 2
        ? "ready"
        : acceptedCount === 1
          ? "partial"
          : "unavailable",
      identity,
      analytics: { security, pool },
    });
  }

  // Ranking responses do not carry a pool or quote identity. Confirm the
  // provider's exact token, v4 pool, quote and canonical supply through the
  // existing /v1/token/info adapter before making either weighted read.
  let verification: GmgnMarketSnapshotV1 | null = null;
  try {
    const candidate = await readGmgnMarketSnapshotV1(canonical.entry, wait);
    verification = exactMarketVerification(
        candidate,
        canonical.entry,
        identity,
      )
      ? candidate
      : null;
  } catch {
    verification = null;
  }
  if (verification === null) {
    return analyticsResponse({
      canonical,
      section: query.section,
      status: "unavailable",
      identity,
      analytics: { ranking: null },
    });
  }

  let ranking: GmgnTokenWalletRankingV1 | null = null;
  try {
    const candidate = query.section === "holders"
      ? await readGmgnTokenTopHoldersV1(
          identity,
          { limit: query.limit },
          wait,
        )
      : await readGmgnTokenTopTradersV1(
          identity,
          { limit: query.limit },
          wait,
        );
    ranking = exactRankingForIdentity(
        candidate,
        identity,
        query.section,
        query.limit,
      )
      ? candidate
      : null;
  } catch {
    ranking = null;
  }
  return analyticsResponse({
    canonical,
    section: query.section,
    status: ranking === null ? "unavailable" : "ready",
    identity,
    analytics: { ranking },
  });
}

function parseQuery(request: NextRequest): Readonly<{
  address: `0x${string}`;
  section: AnalyticsSection;
  limit: number;
}> | NextResponse {
  const search = request.nextUrl.searchParams;
  const allowed = new Set(["address", "chain", "section", "limit"]);
  if (
    [...search.keys()].some((key) => !allowed.has(key)) ||
    search.getAll("address").length !== 1 ||
    search.getAll("chain").length > 1 ||
    search.getAll("section").length > 1 ||
    search.getAll("limit").length > 1
  ) return inputError("Unsupported query parameters");

  const rawAddress = search.get("address")?.trim();
  if (!rawAddress || !isAddress(rawAddress)) {
    return inputError("Enter a valid Ethereum token address");
  }
  const parsedChain = search.get("chain") === null
    ? 1
    : tryParseViewChainId(search.get("chain")!);
  if (parsedChain !== 1) return inputError("Unsupported chain");

  const rawSection = search.get("section")?.trim().toLowerCase() ?? "summary";
  if (
    rawSection !== "summary" &&
    rawSection !== "holders" &&
    rawSection !== "traders"
  ) return inputError("Choose a supported analytics section");

  const rawLimit = search.get("limit")?.trim();
  const limit = rawLimit === undefined || rawLimit === null || rawLimit === ""
    ? DEFAULT_RANKING_LIMIT
    : /^[1-9][0-9]*$/u.test(rawLimit)
      ? Number(rawLimit)
      : Number.NaN;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAXIMUM_RANKING_LIMIT
  ) return inputError("Choose a limit from 1 to 20");

  return {
    address: getAddress(rawAddress),
    section: rawSection,
    limit,
  };
}

async function resolveCanonicalTokenV1(
  address: string,
  signal: AbortSignal,
  deadlineMs: number,
): Promise<CanonicalResolution> {
  const catalogRead = readEnvioClassicV3CatalogV1({ signal, deadlineMs }).then(
    (catalog) => catalog,
    () => {
      console.error("Token analytics Envio identity read unavailable", {
        name: "EnvioClassicV3ReadError",
      });
      return null;
    },
  );
  const registryEnabled = isCustomLaunchRegistryPublicReadEnabled();
  const registryRead = registryEnabled
    ? readProductionCustomExploreDirectoryV1(signal).then(
        (entries) => ({
          entries,
          failed: false,
          status: "current" as const,
        }),
        () => {
          console.error("Token analytics Custom Registry read unavailable", {
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
    signal,
    deadlineMs,
  }).then(
    (snapshot) => ({
      entries: snapshot.entries,
      failed: snapshot.status !== "current",
      status: snapshot.status,
      snapshot,
    }),
    () => {
      console.error("Token analytics Router Custom read unavailable", {
        name: "RouterCustomReadError",
      });
      return {
        entries: [] as readonly CanonicalTokenExploreEntry[],
        failed: true,
        status: "unavailable" as const,
        snapshot: null,
      };
    },
  );

  const [catalog, registryResult, routerResult] = await Promise.all([
    catalogRead,
    registryRead,
    routerRead,
  ]);
  const canonicalReadFailed = catalog === null || catalog.status !== "current";
  let registryStatus = registryResult.status;
  let routerStatus = routerResult.status;
  let registryReadFailed = registryResult.failed;
  let routerReadFailed = routerResult.failed;
  let customEntries = registryResult.entries;
  let routerEntries = routerResult.entries;
  const requestedRouterIdentityRead = routerEntries.some(
    (candidate) => tokenAddress(candidate) === address,
  );
  const canonicalEntry = catalog?.entries.find(
    (candidate) => candidate.exploreKind === "token" &&
      tokenAddress(candidate) === address,
  ) ?? null;

  if (catalog === null) {
    // Registry records do not provide their own onchain snapshot. The Router
    // lane can stand alone only when its bound durable identity snapshot did.
    customEntries = [];
    registryStatus = "unavailable";
    registryReadFailed = registryEnabled;
  }

  let registryIdentityEntries: readonly ExploreEntry[];
  try {
    registryIdentityEntries = mergeEnvioClassicV3CatalogEntriesV1(
      catalog?.entries ?? [],
      customEntries,
    );
  } catch {
    customEntries = [];
    registryIdentityEntries = catalog?.entries ?? [];
    registryStatus = "unavailable";
    registryReadFailed = registryEnabled;
  }

  let identityEntries: readonly ExploreEntry[];
  try {
    identityEntries = mergeRouterCustomExploreEntriesV1(
      registryIdentityEntries,
      routerEntries,
    );
  } catch {
    routerEntries = [];
    identityEntries = registryIdentityEntries;
    routerStatus = "unavailable";
    routerReadFailed = true;
  }

  const entry = identityEntries.find(
    (candidate) => tokenAddress(candidate) === address,
  ) ?? null;
  if (
    catalog === null &&
    (routerResult.snapshot === null || routerStatus === "unavailable")
  ) {
    return {
      kind: "unavailable",
      launchSource: ROUTER_CUSTOM_LAUNCH_SOURCE,
      canonicalStatus: "unavailable",
      routerStatus,
    };
  }

  const routerAvailable = routerStatus !== "unavailable";
  const acceptedRouterSnapshot = routerAvailable
    ? routerResult.snapshot
    : null;
  const launchSource = publicLaunchSourceV1({
    envioAvailable: catalog !== null,
    registryCustomCurrent: registryStatus === "current",
    routerCustomCurrent: routerAvailable,
  });
  const lastIndexedAt = catalog?.generatedAt ??
    acceptedRouterSnapshot?.generatedAt;
  const canonicalStatus = catalog?.status ?? "unavailable" as const;

  if (
    requestedRouterIdentityRead &&
    entry?.launchCategoryProvenance.source !== ROUTER_CUSTOM_LAUNCH_SOURCE &&
    canonicalEntry === null
  ) {
    return {
      kind: "unavailable",
      launchSource,
      canonicalStatus,
      routerStatus,
      ...(lastIndexedAt ? { lastIndexedAt } : {}),
    };
  }

  if (!entry || entry.exploreKind !== "token") {
    if (canonicalReadFailed || registryReadFailed || routerReadFailed) {
      return {
        kind: "unavailable",
        launchSource,
        canonicalStatus,
        routerStatus,
        ...(lastIndexedAt ? { lastIndexedAt } : {}),
      };
    }
    return {
      kind: "not-found",
      launchSource,
      canonicalStatus,
      routerStatus,
      ...(lastIndexedAt ? { lastIndexedAt } : {}),
    };
  }

  if (!lastIndexedAt) {
    return {
      kind: "unavailable",
      launchSource,
      canonicalStatus,
      routerStatus,
    };
  }
  return {
    kind: "ready",
    entry,
    launchSource,
    lastIndexedAt,
    canonicalStatus,
    routerStatus,
  };
}

function exactMarketVerification(
  value: GmgnMarketSnapshotV1 | null,
  entry: ExploreEntry,
  identity: MarketChartIdentityV1,
): value is GmgnMarketSnapshotV1 {
  return isGmgnMarketSnapshotV1(value) &&
    isGmgnMarketSnapshotForExploreEntryV1(value, entry) &&
    sameIdentity(value.identity, identity);
}

function exactSecurityForIdentity(
  value: GmgnTokenSecurityV1 | null,
  identity: MarketChartIdentityV1,
): value is GmgnTokenSecurityV1 {
  return isGmgnTokenSecurityV1(value) &&
    value.tokenAddress === identity.tokenAddress &&
    sameIdentity(value.identity, identity);
}

function exactPoolForIdentity(
  value: GmgnTokenPoolInfoV1 | null,
  identity: MarketChartIdentityV1,
): value is GmgnTokenPoolInfoV1 {
  return isGmgnTokenPoolInfoV1(value) &&
    value.tokenAddress === identity.tokenAddress &&
    value.poolAddress === identity.poolId &&
    value.quoteAddress === identity.quoteAddress &&
    value.exchange === "uniswap_v4" &&
    sameIdentity(value.identity, identity);
}

function exactRankingForIdentity(
  value: GmgnTokenWalletRankingV1 | null,
  identity: MarketChartIdentityV1,
  section: "holders" | "traders",
  limit: number,
): value is GmgnTokenWalletRankingV1 {
  return isGmgnTokenWalletRankingV1(value) &&
    value.kind === section &&
    value.query.limit === limit &&
    value.wallets.length <= limit &&
    value.tokenAddress === identity.tokenAddress &&
    sameIdentity(value.identity, identity);
}

function sameIdentity(
  first: MarketChartIdentityV1,
  second: MarketChartIdentityV1,
): boolean {
  return first.chainId === second.chainId &&
    first.tokenAddress === second.tokenAddress &&
    first.poolId === second.poolId &&
    first.quoteAddress === second.quoteAddress &&
    first.protocol === second.protocol;
}

function analyticsResponse(input: Readonly<{
  canonical: ReadyCanonicalToken;
  section: AnalyticsSection;
  status: AnalyticsStatus;
  identity: MarketChartIdentityV1 | null;
  analytics:
    | Readonly<{
        security: GmgnTokenSecurityV1 | null;
        pool: GmgnTokenPoolInfoV1 | null;
      }>
    | Readonly<{ ranking: GmgnTokenWalletRankingV1 | null }>;
}>) {
  const hasData = input.status !== "unavailable";
  const marketReadStatus = input.status === "ready"
    ? "complete"
    : input.status;
  const dataQuality = input.status === "ready"
    ? "current"
    : input.status;
  const cacheControl = input.status === "unavailable"
    ? NO_STORE
    : input.section === "summary"
      ? PUBLIC_SUMMARY_CACHE_CONTROL
      : PRIVATE_RANKING_CACHE_CONTROL;
  return NextResponse.json(
    {
      schemaVersion: "programmable.token-analytics.v1" as const,
      status: input.status,
      provider: "gmgn" as const,
      section: input.section,
      identity: input.identity,
      analytics: input.analytics,
    },
    {
      status: 200,
      headers: {
        ...JSON_SECURITY_HEADERS,
        "Cache-Control": cacheControl,
        "X-Programmable-Chain-Id": "1",
        "X-Programmable-Launch-Source": input.canonical.launchSource,
        "X-Programmable-Read-Source":
          `${input.canonical.launchSource}+gmgn`,
        "X-Programmable-Canonical-Read-Status":
          input.canonical.canonicalStatus,
        "X-Programmable-Router-Read-Status": input.canonical.routerStatus,
        "X-Programmable-Identity-Last-Indexed-At":
          input.canonical.lastIndexedAt,
        "X-Programmable-Analytics-Provider": "gmgn",
        "X-Programmable-Analytics-Read-Status": input.status,
        "X-Programmable-Market-Provider": "gmgn",
        "X-Programmable-Market-Read-Status": marketReadStatus,
        "X-Programmable-Data-Quality": dataQuality,
        ...(hasData
          ? { "X-Programmable-Market-Source": "gmgn" }
          : {}),
      },
    },
  );
}

function canonicalUnavailableResponse(input: Readonly<{
  launchSource: string;
  canonicalStatus: CanonicalReadStatus;
  routerStatus: RouterReadStatus;
  lastIndexedAt?: string;
}>) {
  return NextResponse.json(
    { error: "Token data is temporarily unavailable" },
    {
      status: 503,
      headers: {
        ...JSON_SECURITY_HEADERS,
        "Cache-Control": NO_STORE,
        "Retry-After": "5",
        "X-Programmable-Chain-Id": "1",
        "X-Programmable-Launch-Source": input.launchSource,
        "X-Programmable-Read-Source": input.launchSource,
        "X-Programmable-Canonical-Read-Status": input.canonicalStatus,
        "X-Programmable-Router-Read-Status": input.routerStatus,
        ...(input.lastIndexedAt
          ? {
              "X-Programmable-Identity-Last-Indexed-At":
                input.lastIndexedAt,
            }
          : {}),
      },
    },
  );
}

function inputError(message: string) {
  return NextResponse.json(
    { error: message },
    {
      status: 400,
      headers: {
        ...JSON_SECURITY_HEADERS,
        "Cache-Control": NO_STORE,
      },
    },
  );
}

function emptyAnalytics(section: AnalyticsSection) {
  return section === "summary"
    ? { security: null, pool: null }
    : { ranking: null };
}

function tokenAddress(entry: ExploreEntry): string | null {
  return entry.tokenAddress?.toLowerCase() ?? null;
}
