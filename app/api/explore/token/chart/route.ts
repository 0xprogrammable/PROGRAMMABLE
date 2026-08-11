import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  getAlchemyOnchainDeployment,
  readAlchemyExploreModel,
  safeAlchemyError,
} from "../../../../../lib/alchemy/explore.server";
import {
  enrichTokensWithAlchemyPoolState,
  readVerifiedOperationalMarketSnapshot,
  withSameBlockEthUsdQuote,
  withoutUnboundEthUsdQuote,
} from "../../../../../lib/alchemy/live-market.server";
import {
  assertTokenChartSupported,
  isTokenChartRange,
  readTokenChartSeries,
  TokenChartIntegrityError,
  TokenChartUnavailableError,
  type TokenChartFreshness,
} from "../../../../../lib/onchain/chart";
import { readDurableExploreModel } from "../../../../../lib/onchain/durable-model";
import type {
  ExploreReadModel,
  ReadyOnchainDeployment,
} from "../../../../../lib/onchain/types";
import type { LauncherToken } from "../../../../../lib/tokens";

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

function unavailableDataQuality(
  reason:
    | "integrity"
    | "source-unavailable"
    | "unsupported-pool-orientation",
) {
  return {
    schemaVersion: TOKEN_CHART_DATA_QUALITY_SCHEMA_VERSION,
    status: "unavailable" as const,
    reason,
  };
}

type ReadyExploreModel = Extract<ExploreReadModel, { status: "ready" }>;

async function readChartIdentityModel(
  deployment: ReadyOnchainDeployment,
): Promise<Readonly<{
  model: ReadyExploreModel;
  readSource: "rpc" | "durable+rpc";
}>> {
  let primaryError: unknown;
  try {
    const model = await readAlchemyExploreModel();
    if (
      model.status === "ready" &&
      model.snapshot.chainId === deployment.chainId
    ) {
      return { model, readSource: "rpc" };
    }
    primaryError = new Error("Live chart identity is unavailable");
  } catch (error) {
    primaryError = error;
  }

  try {
    const durable = await readDurableExploreModel(
      deployment,
      Number.MAX_SAFE_INTEGER,
    );
    if (durable.status === "ready") {
      const model = durable.envelope.payload.model;
      if (
        model.status === "ready" &&
        model.snapshot.chainId === deployment.chainId
      ) {
        return { model, readSource: "durable+rpc" };
      }
    }
  } catch {
    // The original live-read failure is the useful sanitized telemetry cause.
  }

  throw primaryError ?? new Error("Chart identity is unavailable");
}

function chartIdentityToken(
  token: LauncherToken,
  readSource: "rpc" | "durable+rpc",
): LauncherToken {
  if (readSource === "rpc") return token;
  const identityOnly = { ...token };
  // An old aggregate is not current chart history. Reconstruct volume from
  // exact logs when the canonical identity came from the durable snapshot.
  delete identityOnly.grossVolumeWei;
  return identityOnly;
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
    if (deployment.status !== "ready") {
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
    const [identityRead, operationalSnapshot] = await Promise.all([
      readChartIdentityModel(deployment),
      readVerifiedOperationalMarketSnapshot(deployment),
    ]);
    const { model, readSource } = identityRead;

    const token = model.tokens.find(
      (candidate) =>
        candidate.tokenAddress.toLowerCase() === address.toLowerCase(),
    );
    if (!token && readSource === "durable+rpc") {
      return NextResponse.json(
        {
          status: "unavailable",
          address,
          error: "Token identity is temporarily unavailable",
          dataQuality: unavailableDataQuality("source-unavailable"),
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "5",
            "X-Programmable-Data-Quality": "unavailable",
            "X-Programmable-Read-Source": readSource,
          },
        },
      );
    }
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
            "X-Programmable-Read-Source": readSource,
          },
        },
      );
    }

    const tokenForChart = chartIdentityToken(token, readSource);
    assertTokenChartSupported(tokenForChart);

    // A lagging launch-discovery snapshot is useful for canonical identity,
    // but it is never market-currentness authority. Returning unavailable here
    // lets the client preserve its last verified chart instead of appending a
    // stale model point as though it were the current price.
    if (operationalSnapshot === null) {
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
            "X-Programmable-Read-Source": readSource,
          },
        },
      );
    }

    let liveSnapshot = operationalSnapshot;
    try {
      liveSnapshot = await withSameBlockEthUsdQuote({
        deployment,
        snapshot: liveSnapshot,
      });
    } catch {
      liveSnapshot = withoutUnboundEthUsdQuote(liveSnapshot);
    }
    const liveToken = (
      await enrichTokensWithAlchemyPoolState({
        deployment,
        snapshot: liveSnapshot,
        tokens: [tokenForChart],
      })
    )[0] ?? tokenForChart;
    const series = await readTokenChartSeries({
      deployment,
      token: liveToken,
      snapshotBlock: BigInt(liveSnapshot.blockNumber),
      ethUsdQuote: liveSnapshot.ethUsdQuote,
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
          "X-Programmable-Read-Source": readSource,
        },
      },
    );
  } catch (error) {
    const integrityFailure = error instanceof TokenChartIntegrityError;
    const unsupportedPool = error instanceof TokenChartUnavailableError;
    if (!unsupportedPool) {
      console.error(
        "Token chart read failed",
        safeAlchemyError(error),
      );
    }
    return NextResponse.json(
      {
        status: "unavailable",
        error: unsupportedPool
          ? "Price history is unavailable for this pool"
          : "Onchain chart data is temporarily unavailable",
        dataQuality: unavailableDataQuality(
          integrityFailure
            ? "integrity"
            : unsupportedPool
              ? error.reason
              : "source-unavailable",
        ),
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          ...(integrityFailure || unsupportedPool
            ? {}
            : { "Retry-After": "5" }),
          "X-Programmable-Data-Quality": "unavailable",
        },
      },
    );
  }
}
