import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import { readBitqueryMarketChartV1 } from
  "../../../../../lib/market-data/bitquery.server";
import {
  mergeEnvioClassicV3CatalogEntriesV1,
  readEnvioClassicV3CatalogV1,
} from
  "../../../../../lib/market-data/envio-classic-v3-catalog.server";
import { exploreEntryMarketIdentitiesV1 } from
  "../../../../../lib/market-data/explore-market-identities";
import {
  isGmgnMarketChartForIdentityV1,
  preferExactGmgnMarketChartV1,
  type GmgnMarketChartV1,
} from "../../../../../lib/market-data/gmgn-chart-data-v1";
import { readGmgnMarketChartV1 } from
  "../../../../../lib/market-data/gmgn-chart.server";
import type {
  MarketChartErrorV1,
  MarketChartIdentityV1,
  MarketChartV1,
} from "../../../../../lib/market-data/market-data-v1";
import { isTokenChartRange } from "../../../../../lib/onchain/chart";
import {
  mergeRouterCustomExploreEntriesV1,
  publicLaunchSourceV1,
  readFinalizedRouterCustomExploreEntriesV1,
  routerCustomEntriesAtOrBeforeBlockV1,
} from "../../../../../lib/alchemy/router-custom-public.server";
import { readProductionCustomExploreDirectoryV1 } from
  "../../../../../lib/server/custom-launch/explore-directory-v1";
import { isCustomLaunchRegistryPublicReadEnabled } from
  "../../../../../lib/server/custom-launch/public-readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOKEN_CHART_CACHE_CONTROL =
  "public, max-age=0, s-maxage=2, stale-while-revalidate=2";
const GMGN_PRIMARY_CHART_MAXIMUM_AGE_MS = 60_000;
const GMGN_PRIMARY_CHART_MAXIMUM_CLOCK_SKEW_MS = 5_000;

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some((key) => key !== "address" && key !== "range") ||
    search.getAll("address").length !== 1 ||
    search.getAll("range").length > 1
  ) {
    return json({ error: "Unsupported query parameters" }, 400);
  }
  const rawAddress = search.get("address")?.trim();
  const range = search.get("range")?.trim().toLowerCase() ?? "all";
  if (!rawAddress || !isAddress(rawAddress)) {
    return json({ error: "Enter a valid Ethereum token address" }, 400);
  }
  if (!isTokenChartRange(range)) {
    return json({ error: "Choose a supported chart range" }, 400);
  }
  const address = getAddress(rawAddress);

  try {
    const catalog = await readEnvioClassicV3CatalogV1({
      signal: request.signal,
      deadlineMs: Date.now() + 8_000,
    });
    let entries = catalog.entries;
    let customStatus: "current" | "unavailable" = "unavailable";
    let customReadFailed = false;
    if (isCustomLaunchRegistryPublicReadEnabled()) {
      let customEntries;
      try {
        customEntries = await readProductionCustomExploreDirectoryV1(request.signal);
      } catch {
        // A Custom Registry outage cannot invalidate an already committed
        // canonical identity. Unknown identities remain indeterminate until
        // both Custom authorities have been read below.
        customReadFailed = true;
      }
      if (customEntries !== undefined) {
        entries = mergeEnvioClassicV3CatalogEntriesV1(entries, customEntries);
        customStatus = "current";
      }
    }
    let routerStatus: "current" | "unavailable" = "unavailable";
    let routerReadFailed = false;
    try {
      const verifiedRouterEntries =
        await readFinalizedRouterCustomExploreEntriesV1({
          signal: request.signal,
          deadlineMs: Date.now() + 8_000,
        });
      entries = mergeRouterCustomExploreEntriesV1(
        entries,
        routerCustomEntriesAtOrBeforeBlockV1(
          verifiedRouterEntries,
          catalog.asOfBlock,
        ),
      );
      routerStatus = "current";
    } catch {
      console.error("Token chart Router Custom read unavailable", {
        name: "RouterCustomReadError",
      });
      routerReadFailed = true;
    }
    const registryBoundLaunchSource = customStatus === "current"
      ? `${catalog.source}+registry.custom-launched`
      : catalog.source;
    const launchSource = publicLaunchSourceV1({
      registryCustomCurrent: customStatus === "current",
      routerCustomCurrent: routerStatus === "current",
    });
    if (
      launchSource !== registryBoundLaunchSource &&
      launchSource !==
        `${registryBoundLaunchSource}+canonical-launch-stamp-router`
    ) {
      throw new Error("Token chart launch source is not catalog-bound");
    }
    const entry = entries.find((candidate) =>
      candidate.tokenAddress?.toLowerCase() === address.toLowerCase()
    );
    if (entry === undefined) {
      if (customReadFailed || routerReadFailed) {
        return unavailable({
          address,
          range,
          launchSource,
          reason: "identity-unavailable",
          routerStatus,
          status: 503,
        });
      }
      return json({ error: "Token not found" }, 404);
    }
    const identities = exploreEntryMarketIdentitiesV1(entry);
    if (identities.length !== 1) {
      return unavailable({
        address,
        range,
        launchSource,
        reason: "identity-unavailable",
        routerStatus,
      });
    }
    if (range === "all" && !Number.isFinite(Date.parse(entry.launchedAt))) {
      return unavailable({
        address,
        range,
        launchSource,
        reason: "identity-unavailable",
        routerStatus,
      });
    }
    const identity = identities[0];
    let gmgnChart: GmgnMarketChartV1 | null = null;
    try {
      gmgnChart = await readGmgnMarketChartV1({
        entry,
        identity,
        range,
      }, {
        signal: request.signal,
      });
    } catch {
      // GMGN is an enrichment provider. Its failure must not hide a canonical
      // launch or prevent the existing exact-pool history fallback.
      console.error("Token chart GMGN read unavailable", {
        name: "GmgnChartReadError",
      });
    }
    const gmgnReadAt = new Date();
    if (isFreshExactReadyGmgnChart(gmgnChart, identity, range, gmgnReadAt)) {
      return chartResponse(
        gmgnChart,
        launchSource,
        entry.exploreKind === "token",
        routerStatus,
      );
    }

    const bitqueryChart = await readBitqueryMarketChartV1({
      identity,
      range,
      ...(range === "all" ? { historyStart: entry.launchedAt } : {}),
      signal: request.signal,
    });
    const chart = preferExactGmgnMarketChartV1({
      candidate: gmgnChart,
      fallback: bitqueryChart,
      identity,
      range,
      now: new Date(),
      maximumCandidateAgeMs: GMGN_PRIMARY_CHART_MAXIMUM_AGE_MS,
    });
    return chartResponse(
      chart,
      launchSource,
      entry.exploreKind === "token",
      routerStatus,
    );
  } catch (error) {
    console.error("Token chart identity read failed", {
      name: error instanceof Error ? error.name : "LaunchCatalogError",
    });
    return unavailable({
      address,
      range,
      launchSource: "envio-classic-v3",
      reason: "market-data-unavailable",
      routerStatus: "unavailable",
      status: 503,
    });
  }
}

function isFreshExactReadyGmgnChart(
  chart: unknown,
  identity: MarketChartIdentityV1,
  range: MarketChartV1["range"],
  now: Date,
): chart is GmgnMarketChartV1 {
  if (
    !isGmgnMarketChartForIdentityV1(chart, identity, range) ||
    chart.status !== "ready" ||
    !Number.isFinite(now.getTime())
  ) return false;
  const generatedAtMs = Date.parse(chart.generatedAt);
  const proofAtMs = Date.parse(chart.identityProof.verifiedAt);
  return generatedAtMs <=
      now.getTime() + GMGN_PRIMARY_CHART_MAXIMUM_CLOCK_SKEW_MS &&
    now.getTime() - generatedAtMs <= GMGN_PRIMARY_CHART_MAXIMUM_AGE_MS &&
    generatedAtMs - proofAtMs <= GMGN_PRIMARY_CHART_MAXIMUM_AGE_MS;
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function unavailable(input: Readonly<{
  address: `0x${string}`;
  range: "1h" | "1d" | "1w" | "all";
  launchSource: string;
  reason: MarketChartErrorV1["reason"];
  routerStatus?: "current" | "unavailable";
  status?: 200 | 503;
}>) {
  const status = input.status ?? 200;
  const body: MarketChartErrorV1 = {
    schemaVersion: "programmable.market-chart-error.v1",
    source: "bitquery",
    status: "unavailable",
    generatedAt: new Date().toISOString(),
    address: input.address,
    range: input.range,
    reason: input.reason,
    error: "Price history is temporarily unavailable",
  };
  return NextResponse.json(
    body,
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Programmable-Data-Quality": "unavailable",
        "X-Programmable-Launch-Source": input.launchSource,
        "X-Programmable-Read-Source": input.launchSource,
        "X-Programmable-Router-Read-Status":
          input.routerStatus ?? "unavailable",
        ...(status === 503 ? { "Retry-After": "5" } : {}),
      },
    },
  );
}

function chartResponse(
  chart: MarketChartV1 | GmgnMarketChartV1,
  launchSource: string,
  isCanonicalToken: boolean,
  routerStatus: "current" | "unavailable",
) {
  const dataQuality = chart.status === "ready" ||
      chart.status === "insufficient-history"
    ? "current"
    : chart.status === "partial"
      ? "partial"
      : "unavailable";
  const hasPriceHistory = chart.points.length > 0;
  return NextResponse.json(chart, {
    headers: {
      // Registry Custom visibility stays fail-closed at the identity boundary.
      // Only canonical token charts with a live provider result may be shared
      // at the edge; transient fallbacks must be retried instead of cached.
      "Cache-Control": isCanonicalToken && chart.readStatus === "live"
        ? TOKEN_CHART_CACHE_CONTROL
        : "no-store",
      "X-Programmable-Data-Quality": dataQuality,
      "X-Programmable-Launch-Source": launchSource,
      "X-Programmable-Read-Source": `${launchSource}+${chart.source}`,
      "X-Programmable-Router-Read-Status": routerStatus,
      "X-Programmable-Market-Provider": chart.source,
      "X-Programmable-Market-Read-Status": chart.readStatus,
      ...(hasPriceHistory
        ? {
            "X-Programmable-Market-Source": chart.source,
            "X-Programmable-Price-Source": chart.source,
          }
        : {}),
      ...(chart.asOfTime
        ? { "X-Programmable-Market-As-Of": chart.asOfTime }
        : {}),
    },
  });
}
