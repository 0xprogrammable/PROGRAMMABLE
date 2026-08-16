import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  publicExploreEntryV1,
} from "../../../../lib/explore-financial-data";
import { readDexscreenerExploreEntriesV1 } from
  "../../../../lib/market-data/dexscreener-explore.server";
import { readLastGoodLaunchCatalogV1 } from
  "../../../../lib/market-data/last-good-launch-catalog.server";
import type { ExploreEntry } from "../../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUCCESS_CACHE_CONTROL = "public, max-age=0, s-maxage=2";

function tokenAddress(entry: ExploreEntry): string | null {
  return entry.tokenAddress?.toLowerCase() ?? null;
}

function canonicalResponseHeaders(input: Readonly<{
  marketAsOf?: string;
  hasDexscreenerPrice: boolean;
  marketStatus: "complete" | "partial" | "unavailable";
  launchSource: "durable-blob" | "committed-envio-baseline";
}>) {
  return {
    "Cache-Control": SUCCESS_CACHE_CONTROL,
    "X-Programmable-Launch-Source": input.launchSource,
    "X-Programmable-Read-Source": `${input.launchSource}+dexscreener`,
    "X-Programmable-Market-Provider": "dexscreener",
    "X-Programmable-Market-Read-Status": input.marketStatus,
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
    catalog = await readLastGoodLaunchCatalogV1();
  } catch (error) {
    console.error("Token detail identity read failed", {
      name: error instanceof Error ? error.name : "LaunchCatalogError",
    });
    return unavailableResponse({
      "X-Programmable-Market-Provider": "dexscreener",
      "X-Programmable-Read-Source": "last-good+dexscreener",
    });
  }

  const canonicalEntry = catalog.entries.find(
    (candidate) => candidate.exploreKind === "token" &&
      tokenAddress(candidate) === address,
  ) ?? null;
  const entry: ExploreEntry | null = canonicalEntry;

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
        headers: canonicalResponseHeaders({
          hasDexscreenerPrice: false,
          marketStatus: "complete",
          launchSource: catalog.source,
        }),
      },
    );
  }

  try {
    const market = await readDexscreenerExploreEntriesV1([entry]);
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
        snapshot:
          publicEntry.exploreKind === "token" ? { chainId: 1 } : null,
      },
      {
        headers: canonicalResponseHeaders({
          hasDexscreenerPrice,
          marketStatus: market.marketRead.status,
          launchSource: catalog.source,
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
    return NextResponse.json(
      {
        status: "ready",
        token: publicEntry.exploreKind === "token" ? publicEntry : null,
        customProject: null,
        snapshot: publicEntry.exploreKind === "token" ? { chainId: 1 } : null,
      },
      {
        headers: canonicalResponseHeaders({
          hasDexscreenerPrice: false,
          marketStatus: "unavailable",
          launchSource: catalog.source,
        }),
      },
    );
  }
}
