import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  mergeLastGoodLaunchCatalogEntriesV1,
  readLastGoodLaunchCatalogV1,
} from
  "../../../../../lib/market-data/last-good-launch-catalog.server";
import { isTokenChartRange } from "../../../../../lib/onchain/chart";
import { readProductionCustomExploreDirectoryV1 } from
  "../../../../../lib/server/custom-launch/explore-directory-v1";
import { isCustomLaunchRegistryPublicReadEnabled } from
  "../../../../../lib/server/custom-launch/public-readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const catalog = await readLastGoodLaunchCatalogV1();
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
        )) return unavailable(address, range, catalog.source, 503);
      }
      if (customEntries !== undefined) {
        entries = mergeLastGoodLaunchCatalogEntriesV1(entries, customEntries);
        customStatus = "current";
      }
    }
    if (!entries.some((entry) =>
      entry.tokenAddress?.toLowerCase() === address.toLowerCase()
    )) {
      return json({ error: "Token not found" }, 404);
    }
    const launchSource = customStatus === "current"
      ? `${catalog.source}+registry.custom-launched`
      : catalog.source;
    return unavailable(address, range, launchSource, 200);
  } catch (error) {
    console.error("Token chart identity read failed", {
      name: error instanceof Error ? error.name : "LaunchCatalogError",
    });
    return unavailable(address, range, "last-good", 503);
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
  range: string,
  launchSource: string,
  status: 200 | 503,
) {
  return NextResponse.json(
    {
      schemaVersion: "programmable.market-chart-unavailable.v1",
      source: null,
      status: "unavailable",
      generatedAt: new Date().toISOString(),
      address,
      range,
      reason: "history-provider-unavailable",
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Programmable-Data-Quality": "unavailable",
        "X-Programmable-Launch-Source": launchSource,
        "X-Programmable-Read-Source": launchSource,
        ...(status === 503 ? { "Retry-After": "5" } : {}),
      },
    },
  );
}
