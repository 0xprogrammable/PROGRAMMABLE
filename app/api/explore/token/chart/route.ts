import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  readAlchemyExploreModel,
  safeAlchemyError,
} from "../../../../../lib/alchemy/explore.server";
import { suppressRouterBoundCustomProjectDuplicates } from
  "../../../../../lib/alchemy/router-custom-collision";
import {
  createExploreConsumerSource,
  type ExploreConsumerSource,
} from "../../../../../lib/explore-consumer.server";
import { canonicalTokenExploreEntryV1 } from
  "../../../../../lib/explore-entry-v1";
import { withBitqueryMarketData } from
  "../../../../../lib/explore-financial-data";
import {
  readBitqueryMarketChartV1,
  readBitqueryTokenMarketDataV1,
} from "../../../../../lib/market-data/bitquery.server";
import { hydrateMissingCanonicalTokenSupplyV1 } from
  "../../../../../lib/market-data/canonical-token-supply.server";
import { exploreEntryMarketIdentitiesV1 } from
  "../../../../../lib/market-data/explore-market-identities";
import type { MarketChartV1 } from
  "../../../../../lib/market-data/market-data-v1";
import { PROGRAMMABLE_MARKET_CHART_ERROR_SCHEMA_VERSION } from
  "../../../../../lib/market-data/market-data-v1";
import { getOnchainDeployment } from "../../../../../lib/onchain/config";
import { readDurableExploreModel } from
  "../../../../../lib/onchain/durable-model";
import { isTokenChartRange } from "../../../../../lib/onchain/chart";
import type { ExploreReadModel } from "../../../../../lib/onchain/types";
import { readProductionCustomExploreDirectoryV1 } from
  "../../../../../lib/server/custom-launch/explore-directory-v1";
import type {
  CustomProjectExploreEntry,
  ExploreEntry,
} from "../../../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const readCanonicalChartSource = createExploreConsumerSource<ExploreReadModel>({});
const readCustomChartSource = createExploreConsumerSource<
  readonly CustomProjectExploreEntry[]
>({});

async function readPrimaryChartModel() {
  const model = await readAlchemyExploreModel();
  if (model.status !== "ready") {
    throw new Error("Primary Explore model is unavailable");
  }
  return model;
}

async function readDurableChartFallback() {
  const deployment = getOnchainDeployment("production");
  if (deployment.status !== "ready") {
    throw new Error("Production Explore deployment is not ready");
  }
  const read = await readDurableExploreModel(
    deployment,
    Number.MAX_SAFE_INTEGER,
  );
  if (read.status !== "ready") {
    throw new Error(`Durable Explore fallback is ${read.reason}`);
  }
  return { value: read.envelope.payload.model, ageMs: read.ageMs };
}

async function settleSource<T>(
  read: Promise<ExploreConsumerSource<T>>,
): Promise<ExploreConsumerSource<T> | null> {
  try {
    return await read;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some(
      (key) => key !== "address" && key !== "range",
    ) ||
    search.getAll("address").length !== 1 ||
    search.getAll("range").length > 1
  ) {
    return NextResponse.json(
      { error: "Unsupported query parameters" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const input = search.get("address")?.trim();
  const range = search.get("range")?.trim().toLowerCase() ?? "all";
  if (!input || !isAddress(input)) {
    return NextResponse.json(
      { error: "Enter a valid Ethereum token address" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!isTokenChartRange(range)) {
    return NextResponse.json(
      { error: "Choose a supported chart range" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const address = getAddress(input);
    const [canonicalSource, customSource] = await Promise.all([
      settleSource(readCanonicalChartSource({
        primary: readPrimaryChartModel,
        fallback: readDurableChartFallback,
      })),
      settleSource(readCustomChartSource({
        primary: () => readProductionCustomExploreDirectoryV1(request.signal),
      })),
    ]);
    if (canonicalSource === null && customSource === null) {
      return unavailable(
        address,
        range,
        "identity-unavailable",
        "Token identity is temporarily unavailable",
      );
    }
    const model = canonicalSource?.value ?? null;
    const token = model?.tokens.find(
      (candidate) => candidate.tokenAddress.toLowerCase() === address.toLowerCase(),
    );
    const customProjects = suppressRouterBoundCustomProjectDuplicates(
      model?.tokens ?? [],
      customSource?.value ?? [],
    );
    const customProject = customProjects.find(
      (candidate) => candidate.tokenAddress?.toLowerCase() === address.toLowerCase(),
    );
    if (token && customProject) {
      throw new Error("Canonical token chart sources disagree on launch category");
    }
    const unresolvedEntry: ExploreEntry | null = token
      ? canonicalTokenExploreEntryV1(token)
      : customProject ?? null;
    const entry = unresolvedEntry
      ? (await hydrateMissingCanonicalTokenSupplyV1([
          unresolvedEntry,
        ]))[0] ?? unresolvedEntry
      : null;
    if (!entry) {
      if (
        canonicalSource?.status === "current" &&
        customSource?.status === "current"
      ) {
        return NextResponse.json(
          { error: "Token not found" },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        );
      }
      return unavailable(
        address,
        range,
        "identity-unavailable",
        "Token identity is temporarily unavailable",
      );
    }
    const identities = exploreEntryMarketIdentitiesV1(entry);
    if (identities.length === 0) {
      return unavailable(
        address,
        range,
        "market-data-unavailable",
        "Price history is unavailable for this market",
      );
    }
    const marketByToken = await readBitqueryTokenMarketDataV1(identities, {
      signal: request.signal,
    });
    const marketDataRead = marketByToken.get(address.toLowerCase());
    const marketData = marketDataRead
      ? withBitqueryMarketData(entry, marketDataRead).marketData
      : undefined;
    const identity = identities.find(
      (candidate) => candidate.poolId === marketData?.primaryPoolId,
    ) ?? identities[0];
    const primaryMarket = marketData?.pools.find(
      (candidate) => candidate.identity.poolId === identity.poolId,
    );
    const chart = await readBitqueryMarketChartV1({
      identity,
      range,
      ...(primaryMarket ? { valuation: primaryMarket.valuation } : {}),
      signal: request.signal,
    });
    if (chart.status === "unavailable") {
      return unavailable(
        address,
        range,
        "market-data-unavailable",
        "Price history is temporarily unavailable",
        chart,
      );
    }

    const fdvUsdWad = chart.valuation.status === "available"
      ? chart.valuation.fdvUsdWad
      : undefined;
    const hasVerifiedPrice = chart.points.some(
      (point) => point.priceUsd !== undefined || point.priceQuote !== undefined,
    );
    return NextResponse.json(
      {
        ...chart,
        address,
        ...(fdvUsdWad ? { fdvUsdWad } : {}),
        valuationMetric: chart.valuation.status === "available"
          ? chart.valuation.metric
          : null,
      },
      {
        headers: {
          "Cache-Control":
            chart.status === "ready" &&
                chart.valuation.status === "available" &&
                chart.valuation.freshness === "current"
              ? "public, max-age=0, s-maxage=2, stale-while-revalidate=5"
              : "no-store",
          "X-Programmable-Data-Quality": chart.status,
          "X-Programmable-Market-Source": "bitquery",
          ...(hasVerifiedPrice
            ? { "X-Programmable-Price-Source": "bitquery" }
            : {}),
          ...(chart.asOfTime
            ? { "X-Programmable-Market-As-Of": chart.asOfTime }
            : {}),
        },
      },
    );
  } catch (error) {
    console.error("Token chart read failed", safeAlchemyError(error));
    return unavailable(
      getAddress(input),
      range,
      "market-data-unavailable",
      "Price history is temporarily unavailable",
    );
  }
}

function unavailable(
  address: `0x${string}`,
  range: MarketChartV1["range"],
  reason: "identity-unavailable" | "market-data-unavailable",
  error: string,
  chart?: MarketChartV1,
) {
  return NextResponse.json(
    chart
      ? { ...chart, address, error }
      : {
          schemaVersion: PROGRAMMABLE_MARKET_CHART_ERROR_SCHEMA_VERSION,
          source: "bitquery",
          status: "unavailable",
          generatedAt: new Date().toISOString(),
          address,
          range,
          reason,
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
