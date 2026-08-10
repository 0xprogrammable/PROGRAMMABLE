import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  getAlchemyOnchainDeployment,
  readAlchemyExploreModel,
  safeAlchemyError,
} from "../../../../../lib/alchemy/explore.server";
import { enrichTokensWithAlchemyPoolState } from "../../../../../lib/alchemy/live-market.server";
import {
  isTokenChartRange,
  readTokenChartSeries,
  TokenChartIntegrityError,
  type TokenChartFreshness,
} from "../../../../../lib/onchain/chart";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOKEN_CHART_DATA_QUALITY_SCHEMA_VERSION =
  "programmable.explore-chart-data-quality.v1" as const;

function chartDataQualityStatus(freshness: TokenChartFreshness) {
  return freshness.history.status === "current" &&
    freshness.price.status === "current" &&
    freshness.valuation.status === "current"
    ? "current" as const
    : "partial" as const;
}

function unavailableDataQuality(reason: "integrity" | "source-unavailable") {
  return {
    schemaVersion: TOKEN_CHART_DATA_QUALITY_SCHEMA_VERSION,
    status: "unavailable" as const,
    reason,
  };
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
  const requestedRange =
    search.get("range")?.trim().toLowerCase() ?? "all";
  if (!input || !isAddress(input)) {
    return NextResponse.json(
      { error: "Enter a valid Ethereum token address" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!isTokenChartRange(requestedRange)) {
    return NextResponse.json(
      { error: "Choose a supported chart range" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const address = getAddress(input);
    const deployment = getAlchemyOnchainDeployment();
    const model = await readAlchemyExploreModel();
    if (deployment.status !== "ready" || model.status !== "ready") {
      return NextResponse.json(
        {
          status: "unavailable",
          address,
          error: "Onchain chart data is temporarily unavailable",
          dataQuality: unavailableDataQuality("source-unavailable"),
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "5",
            "X-Programmable-Data-Quality": "unavailable",
            "X-Programmable-Read-Source": "rpc",
          },
        },
      );
    }

    const token = model.tokens.find(
      (candidate) =>
        candidate.tokenAddress.toLowerCase() === address.toLowerCase(),
    );
    if (!token) {
      return NextResponse.json(
        {
          error: "Token not found",
          snapshotBlock: model.snapshot.blockNumber,
          snapshotHash: model.snapshot.blockHash,
        },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
            "X-Programmable-Read-Source": "rpc",
          },
        },
      );
    }

    const liveSnapshot = model.launchDiscoverySnapshot ?? model.snapshot;
    const liveToken = (
      await enrichTokensWithAlchemyPoolState({
        deployment,
        snapshot: liveSnapshot,
        tokens: [token],
      })
    )[0] ?? token;
    const series = await readTokenChartSeries({
      deployment,
      token: liveToken,
      snapshotBlock: BigInt(liveSnapshot.blockNumber),
      ethUsdQuote: model.snapshot.ethUsdQuote,
      range: requestedRange,
    });
    const { freshness, ...publicSeries } = series;
    const qualityStatus = series.status === "partial"
      ? "partial" as const
      : chartDataQualityStatus(freshness);
    return NextResponse.json(
      {
        ...publicSeries,
        address,
        range: requestedRange,
        valuationMetric: "fdv",
        dataQuality: {
          schemaVersion: TOKEN_CHART_DATA_QUALITY_SCHEMA_VERSION,
          status: qualityStatus,
          asOfBlock: liveSnapshot.blockNumber,
          blockHash: liveSnapshot.blockHash,
          finality:
            liveSnapshot.confirmations > 0 ? "confirmed" : "latest",
          history: freshness.history,
          price: freshness.price,
          valuation: freshness.valuation,
        },
        snapshotBlock: liveSnapshot.blockNumber,
        snapshotHash: liveSnapshot.blockHash,
      },
      {
        headers: {
          "Cache-Control":
            qualityStatus === "current"
              ? "public, max-age=0, s-maxage=2, stale-while-revalidate=2"
              : "no-store",
          "X-Programmable-Data-Quality": qualityStatus,
          "X-Programmable-Valuation-Metric": "fdv",
          "X-Programmable-Read-Source": "rpc",
        },
      },
    );
  } catch (error) {
    const integrityFailure = error instanceof TokenChartIntegrityError;
    console.error(
      "Alchemy token chart read failed",
      safeAlchemyError(error),
    );
    return NextResponse.json(
      {
        status: "unavailable",
        error: "Onchain chart data is temporarily unavailable",
        dataQuality: unavailableDataQuality(
          integrityFailure ? "integrity" : "source-unavailable",
        ),
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          ...(integrityFailure ? {} : { "Retry-After": "5" }),
          "X-Programmable-Data-Quality": "unavailable",
        },
      },
    );
  }
}
