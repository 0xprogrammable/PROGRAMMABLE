import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  publicExploreEntryV1,
  withBitqueryMarketData,
  type ValuedExploreEntry,
} from "../../../../lib/explore-financial-data";
import {
  readBitqueryTokenMarketDataStrictV1,
  safeBitqueryMarketDataError,
} from "../../../../lib/market-data/bitquery.server";
import { exploreEntryMarketIdentitiesV1 } from
  "../../../../lib/market-data/explore-market-identities";
import {
  readPrimaryRpcExploreEntriesV1,
  safePrimaryRpcLaunchCatalogError,
} from "../../../../lib/market-data/primary-rpc-launches.server";
import type { ExploreEntry } from "../../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUCCESS_CACHE_CONTROL = "public, max-age=0, s-maxage=2";

function tokenAddress(entry: ExploreEntry): string | null {
  return entry.tokenAddress?.toLowerCase() ?? null;
}

function unavailableValuation(
  entry: ExploreEntry,
  hadMarketIdentity: boolean,
): ValuedExploreEntry {
  return {
    ...entry,
    valuation: {
      status: "unavailable",
      reason: hadMarketIdentity ? "source-unavailable" : "no-market",
    },
  };
}

function responseHeaders(input: Readonly<{
  marketAsOf?: string;
  hasBitqueryPrice: boolean;
}>) {
  return {
    "Cache-Control": SUCCESS_CACHE_CONTROL,
    "X-Programmable-Launch-Source": "drpc",
    "X-Programmable-Read-Source": "drpc+bitquery",
    "X-Programmable-Market-Source": "bitquery",
    ...(input.marketAsOf
      ? { "X-Programmable-Market-As-Of": input.marketAsOf }
      : {}),
    ...(input.hasBitqueryPrice
      ? { "X-Programmable-Price-Source": "bitquery" }
      : {}),
  };
}

export async function GET(request: NextRequest) {
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

  try {
    const address = getAddress(input).toLowerCase();
    const catalog = await readPrimaryRpcExploreEntriesV1({
      signal: request.signal,
    });
    const entry = catalog.entries.find(
      (candidate) => candidate.exploreKind === "token" &&
        tokenAddress(candidate) === address,
    ) ?? null;

    if (!entry) {
      return NextResponse.json(
        {
          status: "ready",
          token: null,
          customProject: null,
          snapshot: null,
        },
        {
          status: 404,
          headers: responseHeaders({
            hasBitqueryPrice: false,
          }),
        },
      );
    }

    const identities = exploreEntryMarketIdentitiesV1(entry);
    const marketByToken = await readBitqueryTokenMarketDataStrictV1(identities, {
      signal: request.signal,
    });
    const marketData = entry.tokenAddress
      ? marketByToken.get(entry.tokenAddress.toLowerCase())
      : undefined;
    if (identities.length > 0 && marketData === undefined) {
      throw new Error("Bitquery market response is incomplete");
    }
    const valuedEntry = marketData
      ? withBitqueryMarketData(entry, marketData)
      : unavailableValuation(entry, identities.length > 0);
    const primaryMarket = valuedEntry.marketData?.pools.find(
      (pool) => pool.identity.poolId === valuedEntry.marketData?.primaryPoolId,
    );
    const hasBitqueryPrice = primaryMarket?.latestTrade?.priceUsdWad !==
        undefined || primaryMarket?.latestTrade?.priceQuoteWad !== undefined;
    const marketAsOf = valuedEntry.valuation.status === "available"
      ? valuedEntry.valuation.asOfTime
      : primaryMarket?.asOfTime;
    const publicEntry = publicExploreEntryV1(valuedEntry);

    return NextResponse.json(
      {
        status: "ready",
        token: publicEntry.exploreKind === "token" ? publicEntry : null,
        customProject:
          publicEntry.exploreKind === "custom-project" ? publicEntry : null,
        snapshot:
          publicEntry.exploreKind === "token" ? { chainId: 1 } : null,
      },
      {
        headers: responseHeaders({
          hasBitqueryPrice,
          ...(marketAsOf ? { marketAsOf } : {}),
        }),
      },
    );
  } catch (error) {
    console.error("Token detail read failed", {
      launch: safePrimaryRpcLaunchCatalogError(error),
      market: safeBitqueryMarketDataError(error),
    });
    return NextResponse.json(
      { error: "Token data is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
