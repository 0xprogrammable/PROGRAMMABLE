import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  getAlchemyOnchainDeployment,
  enrichTokensWithAlchemyPrices,
  readAlchemyExploreModel,
  safeAlchemyError,
} from "../../../../lib/alchemy/explore.server";
import { enrichTokensWithAlchemyPoolState } from "../../../../lib/alchemy/live-market.server";
import { suppressRouterBoundCustomProjectDuplicates } from "../../../../lib/alchemy/router-custom-collision";
import {
  createExploreConsumerSource,
  type ExploreConsumerSource,
} from "../../../../lib/explore-consumer.server";
import { canonicalTokenExploreEntryV1 } from "../../../../lib/explore-entry-v1";
import {
  buildExploreDataQuality,
  withExploreValuation,
  type ValuedExploreEntry,
} from "../../../../lib/explore-financial-data";
import { readExploreReferenceHeadWithinRouteBudget } from "../../../../lib/explore-reference-head.server";
import { getOnchainDeployment } from "../../../../lib/onchain/config";
import { readDurableExploreModel } from "../../../../lib/onchain/durable-model";
import { readProductionCustomExploreDirectoryV1 } from "../../../../lib/server/custom-launch/explore-directory-v1";
import type { ExploreReadModel } from "../../../../lib/onchain/types";
import type { CustomProjectExploreEntry } from "../../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const readCanonicalTokenSource = createExploreConsumerSource<ExploreReadModel>({});
const readCustomTokenSource = createExploreConsumerSource<
  readonly CustomProjectExploreEntry[]
>({});

async function readPrimaryTokenModel() {
  const model = await readAlchemyExploreModel();
  if (model.status !== "ready") {
    throw new Error("Primary Explore model is unavailable");
  }
  return model;
}

async function readDurableTokenFallback() {
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

async function settleTokenSource<T>(
  read: Promise<ExploreConsumerSource<T>>,
): Promise<
  | Readonly<{ source: ExploreConsumerSource<T>; error: null }>
  | Readonly<{ source: null; error: unknown }>
> {
  try {
    return { source: await read, error: null };
  } catch (error) {
    return { source: null, error };
  }
}

function greatestBlockNumber(...values: Array<string | null | undefined>) {
  let greatest: bigint | null = null;
  for (const value of values) {
    if (!value || !/^[1-9]\d*$/u.test(value)) continue;
    const parsed = BigInt(value);
    if (greatest === null || parsed > greatest) greatest = parsed;
  }
  return greatest?.toString() ?? null;
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
    const address = getAddress(input);
    const [canonicalAttempt, customAttempt, referenceHead] = await Promise.all([
      settleTokenSource(readCanonicalTokenSource({
        primary: readPrimaryTokenModel,
        fallback: readDurableTokenFallback,
      })),
      settleTokenSource(readCustomTokenSource({
        primary: () => readProductionCustomExploreDirectoryV1(request.signal),
      })),
      readExploreReferenceHeadWithinRouteBudget(),
    ]);
    if (canonicalAttempt.source === null && customAttempt.source === null) {
      throw canonicalAttempt.error ?? customAttempt.error;
    }
    const canonicalSource = canonicalAttempt.source;
    const customSource = customAttempt.source;
    const model = canonicalSource?.value ?? null;
    const token = model?.tokens.find(
      (candidate) =>
        candidate.tokenAddress.toLowerCase() === address.toLowerCase(),
    );
    const customProjects = suppressRouterBoundCustomProjectDuplicates(
      model?.tokens ?? [],
      customSource?.value ?? [],
    );
    const customProject = customProjects.find(
      (candidate) => candidate.tokenAddress?.toLowerCase() === address.toLowerCase(),
    );
    if (token && customProject) {
      throw new Error("Canonical token detail sources disagree on launch category");
    }

    if (
      canonicalSource?.status === "current" &&
      customSource?.status === "current" &&
      model?.status === "ready" &&
      !token &&
      !customProject
    ) {
      return NextResponse.json(
        {
          status: model.status,
          token: null,
          snapshot: model.snapshot,
          launchDiscoverySnapshot: model.launchDiscoverySnapshot,
        },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
            "X-Programmable-Launch-Source": "alchemy",
            "X-Programmable-Read-Source": "blob",
          },
        },
      );
    }

    if (!token && !customProject) {
      return NextResponse.json(
        {
          status: "unavailable",
          error: "Token identity is temporarily unavailable",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    let priced = token;
    let priceApiApplied = false;
    if (priced && canonicalSource?.status === "current") {
      try {
        const previous = priced;
        priced = (await enrichTokensWithAlchemyPrices([priced]))[0] ?? priced;
        priceApiApplied =
          priced.tokenPriceUsdWad !== previous.tokenPriceUsdWad ||
          priced.fdvUsdWad !== previous.fdvUsdWad;
      } catch {
        // Keep the canonical token when price enrichment is unavailable.
      }
    }
    const liveSnapshot =
      model?.status === "ready"
        ? (model.launchDiscoverySnapshot ?? model.snapshot)
        : null;
    let deployment: ReturnType<typeof getAlchemyOnchainDeployment> | null = null;
    if (canonicalSource?.status === "current") {
      try {
        deployment = getAlchemyOnchainDeployment();
      } catch {
        // Provider readiness is independent from canonical launch identity.
      }
    }
    let enriched = priced;
    if (priced && liveSnapshot && deployment?.status === "ready") {
      try {
        enriched = (
          await enrichTokensWithAlchemyPoolState({
            deployment,
            snapshot: liveSnapshot,
            tokens: [priced],
          })
        )[0] ?? priced;
      } catch {
        // Preserve the identity and older valuation with explicit freshness.
      }
    }
    const identityAsOfBlock = liveSnapshot?.blockNumber ?? null;
    const referenceBlock = greatestBlockNumber(
      identityAsOfBlock,
      referenceHead?.blockNumber,
    );
    const valuationContext = {
      referenceBlock,
      forceStale: canonicalSource?.status === "last-known-good",
    } as const;
    const valuedToken = enriched
      ? withExploreValuation(
          canonicalTokenExploreEntryV1(enriched),
          valuationContext,
        )
      : null;
    const valuedCustomProject = customProject
      ? withExploreValuation(customProject, valuationContext)
      : null;
    const qualityEntries = [valuedToken, valuedCustomProject].filter(
      (entry): entry is ValuedExploreEntry => entry !== null,
    );
    const sourceAges = [canonicalSource?.ageMs, customSource?.ageMs].filter(
      (value): value is number => value !== undefined,
    );
    const dataQuality = buildExploreDataQuality({
      entries: qualityEntries,
      canonicalStatus: canonicalSource?.status ?? "unavailable",
      customStatus: customSource?.status ?? "unavailable",
      identityAsOfBlock,
      referenceBlock,
      identityAgeMs: sourceAges.length > 0 ? Math.max(...sourceAges) : null,
    });
    const status = "ready" as const;
    return NextResponse.json(
      {
        status,
        token: valuedToken,
        customProject: valuedCustomProject,
        dataQuality,
        snapshot: model?.snapshot ?? null,
        launchDiscoverySnapshot:
          model?.status === "ready"
            ? model.launchDiscoverySnapshot
            : undefined,
      },
      {
        headers: {
          "Cache-Control":
            customProject || dataQuality.status !== "complete"
              ? "no-store"
              : status === "ready"
              ? "public, max-age=0, s-maxage=2, stale-while-revalidate=5"
              : "public, max-age=0, s-maxage=30",
          "X-Programmable-Data-Quality": dataQuality.status,
          "X-Programmable-Valuation-Metric": "fdv",
          "X-Programmable-Price-Source":
            priceApiApplied ? "alchemy" : "read-model",
          "X-Programmable-Launch-Source": customProject
            ? "registry.custom-launched"
            : canonicalSource?.status === "current" ? "alchemy" : "partial",
          "X-Programmable-Read-Source": customProject
            ? "postgres"
            : canonicalSource?.origin === "fallback"
              ? "durable"
              : "blob",
        },
      },
    );
  } catch (error) {
    console.error(
      "Token detail consumer read failed",
      safeAlchemyError(error),
    );
    return NextResponse.json(
      { error: "Token data is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
