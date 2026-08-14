import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  readBitqueryExploreEntriesV1,
  safeBitqueryLaunchCatalogError,
} from "../../../../../lib/market-data/bitquery-launches.server";
import {
  readBitqueryMarketChartStrictV1,
  readBitqueryTokenMarketDataStrictV1,
  safeBitqueryMarketDataError,
} from "../../../../../lib/market-data/bitquery.server";
import { exploreEntryMarketIdentitiesV1 } from
  "../../../../../lib/market-data/explore-market-identities";
import {
  PROGRAMMABLE_MARKET_CHART_ERROR_SCHEMA_VERSION,
  type MarketChartV1,
  type MarketValuationV1,
} from "../../../../../lib/market-data/market-data-v1";
import { isTokenChartRange } from "../../../../../lib/onchain/chart";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UNAVAILABLE_VALUATION = Object.freeze({
  status: "unavailable",
  reason: "source-unavailable",
} as const satisfies MarketValuationV1);

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
    const catalog = await readBitqueryExploreEntriesV1({
      signal: request.signal,
    });
    const entry = catalog.entries.find((candidate) =>
      candidate.exploreKind === "token" &&
      candidate.tokenAddress.toLowerCase() === address.toLowerCase()
    );
    if (!entry || entry.exploreKind !== "token") {
      return json({ error: "Token not found" }, 404);
    }
    const identities = exploreEntryMarketIdentitiesV1(entry);
    if (identities.length === 0) {
      return unavailable(address, range, "Price history is unavailable for this market");
    }

    let identity = identities[0]!;
    if (identities.length > 1) {
      const market = await readBitqueryTokenMarketDataStrictV1(identities, {
        signal: request.signal,
      });
      const primary = market.get(address.toLowerCase());
      identity = identities.find((candidate) =>
        candidate.poolId === primary?.primaryPoolId
      ) ?? identity;
    }
    const chart = await readBitqueryMarketChartStrictV1({
      identity,
      range,
      historyStart: entry.launchedAt,
      signal: request.signal,
    });
    if (chart.status === "unavailable") {
      return unavailable(address, range, "Price history is temporarily unavailable");
    }
    const response = {
      ...chart,
      valuation: UNAVAILABLE_VALUATION,
      address,
    };
    const hasPrice = chart.points.some(
      (point) => point.priceUsd !== undefined || point.priceQuote !== undefined,
    );
    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store",
        "X-Programmable-Data-Quality": chart.status,
        "X-Programmable-Market-Source": "bitquery",
        ...(hasPrice ? { "X-Programmable-Price-Source": "bitquery" } : {}),
        ...(chart.asOfTime
          ? { "X-Programmable-Market-As-Of": chart.asOfTime }
          : {}),
      },
    });
  } catch (error) {
    console.error("Bitquery token chart read failed", {
      catalog: safeBitqueryLaunchCatalogError(error),
      market: safeBitqueryMarketDataError(error),
    });
    return unavailable(address, range, "Price history is temporarily unavailable");
  }
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function unavailable(
  address: `0x${string}`,
  range: MarketChartV1["range"],
  error: string,
) {
  return NextResponse.json(
    {
      schemaVersion: PROGRAMMABLE_MARKET_CHART_ERROR_SCHEMA_VERSION,
      source: "bitquery",
      status: "unavailable",
      generatedAt: new Date().toISOString(),
      address,
      range,
      reason: "market-data-unavailable",
      error,
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "5",
        "X-Programmable-Data-Quality": "unavailable",
        "X-Programmable-Market-Source": "bitquery",
      },
    },
  );
}
