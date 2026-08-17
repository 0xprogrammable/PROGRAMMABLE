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
import type {
  MarketChartErrorV1,
  MarketChartV1,
} from "../../../../../lib/market-data/market-data-v1";
import { isTokenChartRange } from "../../../../../lib/onchain/chart";
import { readProductionCustomExploreDirectoryV1 } from
  "../../../../../lib/server/custom-launch/explore-directory-v1";
import { isCustomLaunchRegistryPublicReadEnabled } from
  "../../../../../lib/server/custom-launch/public-readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOKEN_CHART_CACHE_CONTROL =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=60";

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
    if (isCustomLaunchRegistryPublicReadEnabled()) {
      let customEntries;
      try {
        customEntries = await readProductionCustomExploreDirectoryV1(request.signal);
      } catch {
        // A Custom Registry outage cannot invalidate an already committed
        // canonical identity, but an unknown address remains indeterminate.
        if (!entries.some((entry) =>
          entry.tokenAddress?.toLowerCase() === address.toLowerCase()
        )) {
          return unavailable({
            address,
            range,
            launchSource: catalog.source,
            reason: "identity-unavailable",
            status: 503,
          });
        }
      }
      if (customEntries !== undefined) {
        entries = mergeEnvioClassicV3CatalogEntriesV1(entries, customEntries);
        customStatus = "current";
      }
    }
    const entry = entries.find((candidate) =>
      candidate.tokenAddress?.toLowerCase() === address.toLowerCase()
    );
    if (entry === undefined) {
      return json({ error: "Token not found" }, 404);
    }
    const launchSource = customStatus === "current"
      ? `${catalog.source}+registry.custom-launched`
      : catalog.source;
    const identities = exploreEntryMarketIdentitiesV1(entry);
    if (identities.length !== 1) {
      return unavailable({
        address,
        range,
        launchSource,
        reason: "identity-unavailable",
      });
    }
    if (range === "all" && !Number.isFinite(Date.parse(entry.launchedAt))) {
      return unavailable({
        address,
        range,
        launchSource,
        reason: "identity-unavailable",
      });
    }
    const chart = await readBitqueryMarketChartV1({
      identity: identities[0],
      range,
      ...(range === "all" ? { historyStart: entry.launchedAt } : {}),
      signal: request.signal,
    });
    return chartResponse(chart, launchSource, entry.exploreKind === "token");
  } catch (error) {
    console.error("Token chart identity read failed", {
      name: error instanceof Error ? error.name : "LaunchCatalogError",
    });
    return unavailable({
      address,
      range,
      launchSource: "envio-classic-v3",
      reason: "market-data-unavailable",
      status: 503,
    });
  }
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
        ...(status === 503 ? { "Retry-After": "5" } : {}),
      },
    },
  );
}

function chartResponse(
  chart: MarketChartV1,
  launchSource: string,
  isCanonicalToken: boolean,
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
      // Only canonical token charts with a live Bitquery result may be shared
      // at the edge; transient fallbacks must be retried instead of cached.
      "Cache-Control": isCanonicalToken && chart.readStatus === "live"
        ? TOKEN_CHART_CACHE_CONTROL
        : "no-store",
      "X-Programmable-Data-Quality": dataQuality,
      "X-Programmable-Launch-Source": launchSource,
      "X-Programmable-Read-Source": `${launchSource}+bitquery`,
      "X-Programmable-Market-Provider": "bitquery",
      "X-Programmable-Market-Read-Status": chart.readStatus,
      ...(hasPriceHistory
        ? {
            "X-Programmable-Market-Source": "bitquery",
            "X-Programmable-Price-Source": "bitquery",
          }
        : {}),
      ...(chart.asOfTime
        ? { "X-Programmable-Market-As-Of": chart.asOfTime }
        : {}),
    },
  });
}
