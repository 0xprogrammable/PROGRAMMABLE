import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  publicExploreEntryV1,
  withBitqueryMarketData,
  type ValuedExploreEntry,
} from "../../../../lib/explore-financial-data";
import {
  BitqueryMarketDataError,
  readBitqueryTokenMarketDataStrictV1,
  safeBitqueryMarketDataError,
} from "../../../../lib/market-data/bitquery.server";
import { exploreEntryMarketIdentitiesV1 } from
  "../../../../lib/market-data/explore-market-identities";
import {
  readPrimaryRpcExploreEntriesV1,
  safePrimaryRpcLaunchCatalogError,
} from "../../../../lib/market-data/primary-rpc-launches.server";
import { readProductionCustomExploreDirectoryV1 } from
  "../../../../lib/server/custom-launch/explore-directory-v1";
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
      reason: hadMarketIdentity || entry.exploreKind === "token" ||
          entry.markets.length > 0
        ? "source-unavailable"
        : "no-market",
    },
  };
}

function canonicalResponseHeaders(input: Readonly<{
  marketAsOf?: string;
  hasBitqueryPrice: boolean;
  marketRead: boolean;
}>) {
  return {
    "Cache-Control": SUCCESS_CACHE_CONTROL,
    "X-Programmable-Launch-Source": "drpc",
    "X-Programmable-Read-Source": input.marketRead ? "drpc+bitquery" : "drpc",
    ...(input.marketRead
      ? { "X-Programmable-Market-Source": "bitquery" }
      : {}),
    ...(input.marketAsOf
      ? { "X-Programmable-Market-As-Of": input.marketAsOf }
      : {}),
    ...(input.hasBitqueryPrice
      ? { "X-Programmable-Price-Source": "bitquery" }
      : {}),
  };
}

function customResponseHeaders(input: Readonly<{
  marketAsOf?: string;
  hasBitqueryPrice: boolean;
  marketRead: boolean;
}>) {
  return {
    "Cache-Control": SUCCESS_CACHE_CONTROL,
    "X-Programmable-Launch-Source": "registry.custom-launched",
    "X-Programmable-Read-Source": input.marketRead
      ? "drpc+registry.custom-launched+bitquery"
      : "drpc+registry.custom-launched",
    ...(input.marketRead
      ? { "X-Programmable-Market-Source": "bitquery" }
      : {}),
    ...(input.marketAsOf
      ? { "X-Programmable-Market-As-Of": input.marketAsOf }
      : {}),
    ...(input.hasBitqueryPrice
      ? { "X-Programmable-Price-Source": "bitquery" }
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
    catalog = await readPrimaryRpcExploreEntriesV1({
      requestedTokenAddress,
      signal: request.signal,
    });
  } catch (error) {
    console.error("Token detail identity read failed", {
      launch: safePrimaryRpcLaunchCatalogError(error),
    });
    return unavailableResponse(canonicalResponseHeaders({
      hasBitqueryPrice: false,
      marketRead: false,
    }));
  }

  const canonicalEntry = catalog.entries.find(
    (candidate) => candidate.exploreKind === "token" &&
      tokenAddress(candidate) === address,
  ) ?? null;
  let entry: ExploreEntry | null = canonicalEntry;
  let isCustom = false;

  if (entry === null) {
    let customProjects;
    try {
      customProjects = await readProductionCustomExploreDirectoryV1(
        request.signal,
      );
    } catch {
      console.error("Token detail Custom Registry read failed", {
        launch: {
          name: "CustomRegistryReadError",
          category: "unexpected",
        },
      });
      return unavailableResponse(customResponseHeaders({
        hasBitqueryPrice: false,
        marketRead: false,
      }));
    }
    entry = customProjects.find(
      (candidate) => tokenAddress(candidate) === address,
    ) ?? null;
    isCustom = entry !== null;
  }

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
        headers: customResponseHeaders({
          hasBitqueryPrice: false,
          marketRead: false,
        }),
      },
    );
  }

  const identities = exploreEntryMarketIdentitiesV1(entry);
  let marketByToken: Awaited<
    ReturnType<typeof readBitqueryTokenMarketDataStrictV1>
  > = new Map();
  try {
    if (identities.length > 0) {
      marketByToken = await readBitqueryTokenMarketDataStrictV1(identities, {
        signal: request.signal,
      });
    }
    const marketData = entry.tokenAddress
      ? marketByToken.get(entry.tokenAddress.toLowerCase())
      : undefined;
    if (identities.length > 0 && marketData === undefined) {
      throw new BitqueryMarketDataError("integrity");
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
        headers: (isCustom
          ? customResponseHeaders
          : canonicalResponseHeaders)({
          hasBitqueryPrice,
          marketRead: identities.length > 0,
          ...(marketAsOf ? { marketAsOf } : {}),
        }),
      },
    );
  } catch (error) {
    console.error("Token detail market read failed", {
      market: safeBitqueryMarketDataError(error),
    });
    return unavailableResponse((isCustom
      ? customResponseHeaders
      : canonicalResponseHeaders)({
      hasBitqueryPrice: false,
      marketRead: true,
    }));
  }
}
