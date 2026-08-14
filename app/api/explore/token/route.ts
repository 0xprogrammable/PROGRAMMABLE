import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import { suppressRouterBoundCustomProjectDuplicates } from
  "../../../../lib/alchemy/router-custom-collision";
import {
  publicExploreEntryV1,
  withBitqueryMarketData,
  type ValuedExploreEntry,
} from "../../../../lib/explore-financial-data";
import { readBitqueryExploreEntriesV1 } from
  "../../../../lib/market-data/bitquery-launches.server";
import { readBitqueryTokenMarketDataStrictV1 } from
  "../../../../lib/market-data/bitquery.server";
import { exploreEntryMarketIdentitiesV1 } from
  "../../../../lib/market-data/explore-market-identities";
import { readProductionCustomExploreDirectoryV1 } from
  "../../../../lib/server/custom-launch/explore-directory-v1";
import type {
  CustomProjectExploreEntry,
  ExploreEntry,
} from "../../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUCCESS_CACHE_CONTROL = "public, max-age=0, s-maxage=2";

function tokenAddress(entry: ExploreEntry): string | null {
  return entry.tokenAddress?.toLowerCase() ?? null;
}

async function readOptionalCustomProjects(
  signal: AbortSignal,
): Promise<readonly CustomProjectExploreEntry[]> {
  try {
    return await readProductionCustomExploreDirectoryV1(signal);
  } catch {
    return [];
  }
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
  launchSource: "bitquery" | "registry.custom-launched";
  marketAsOf?: string;
  hasBitqueryPrice: boolean;
}>) {
  return {
    "Cache-Control": SUCCESS_CACHE_CONTROL,
    "X-Programmable-Launch-Source": input.launchSource,
    "X-Programmable-Read-Source": "bitquery",
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
    const [catalog, registryProjects] = await Promise.all([
      readBitqueryExploreEntriesV1({ signal: request.signal }),
      readOptionalCustomProjects(request.signal),
    ]);
    const canonicalEntries = catalog.entries.filter(
      (entry) => entry.exploreKind === "token",
    );
    const catalogCustomEntries = catalog.entries.filter(
      (entry): entry is CustomProjectExploreEntry =>
        entry.exploreKind === "custom-project",
    );
    const customEntries = suppressRouterBoundCustomProjectDuplicates(
      canonicalEntries,
      [...catalogCustomEntries, ...registryProjects],
    );
    const canonicalEntry = canonicalEntries.find(
      (entry) => tokenAddress(entry) === address,
    ) ?? null;
    const customEntry = customEntries.find(
      (entry) => tokenAddress(entry) === address,
    ) ?? null;

    if (canonicalEntry && customEntry) {
      throw new Error("Bitquery and Custom Registry disagree on launch category");
    }

    const entry = canonicalEntry ?? customEntry;
    const customEntryComesFromCatalog = customEntry !== null &&
      catalogCustomEntries.some((candidate) => candidate.id === customEntry.id);
    const launchSource = canonicalEntry || customEntryComesFromCatalog
      ? "bitquery" as const
      : "registry.custom-launched" as const;

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
            launchSource: "bitquery",
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
          launchSource,
          hasBitqueryPrice,
          ...(marketAsOf ? { marketAsOf } : {}),
        }),
      },
    );
  } catch (error) {
    console.error("Bitquery token detail read failed", {
      name: error instanceof Error ? error.name : "Error",
    });
    return NextResponse.json(
      { error: "Token data is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
