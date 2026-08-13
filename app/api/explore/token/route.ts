import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  getAlchemyOnchainDeployment,
  readAlchemyExploreModel,
  safeAlchemyError,
} from "../../../../lib/alchemy/explore.server";
import { readVerifiedOperationalMarketSnapshot } from
  "../../../../lib/alchemy/live-market.server";
import { suppressRouterBoundCustomProjectDuplicates } from "../../../../lib/alchemy/router-custom-collision";
import {
  createExploreConsumerSource,
  exploreLaunchSourceHeader,
  exploreReadSourceHeader,
  type ExploreConsumerSource,
} from "../../../../lib/explore-consumer.server";
import { canonicalTokenExploreEntryV1 } from "../../../../lib/explore-entry-v1";
import {
  buildExploreDataQuality,
  publicExploreEntryV1,
  type ValuedExploreEntry,
} from "../../../../lib/explore-financial-data";
import { readBitqueryTokenMarketDataV1 } from
  "../../../../lib/market-data/bitquery.server";
import { hydrateMissingCanonicalTokenSupplyV1 } from
  "../../../../lib/market-data/canonical-token-supply.server";
import { exploreEntryMarketIdentitiesV1 } from
  "../../../../lib/market-data/explore-market-identities";
import {
  CURRENT_EVIDENCE_ROUTE_DEADLINE_MS,
  settleCurrentEvidenceSnapshot,
  valueExploreEntriesWithCurrentEvidence,
} from "../../../../lib/market-data/current-valuation.server";
import type { TokenMarketDataV1 } from
  "../../../../lib/market-data/market-data-v1";
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
    const deployment = getAlchemyOnchainDeployment();
    const currentEvidenceDeadlineAt =
      Date.now() + CURRENT_EVIDENCE_ROUTE_DEADLINE_MS;
    const operationalSnapshotRead = deployment.status === "ready"
      ? settleCurrentEvidenceSnapshot({
          read: readVerifiedOperationalMarketSnapshot(deployment),
          requireComplete: false,
          timeoutMs: CURRENT_EVIDENCE_ROUTE_DEADLINE_MS,
        })
      : Promise.resolve(null);
    const [
      canonicalAttempt,
      customAttempt,
      referenceHead,
    ] = await Promise.all([
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
    const sourceHeaders = {
      "X-Programmable-Launch-Source": exploreLaunchSourceHeader({
        canonical: canonicalSource,
        custom: customSource,
      }),
      "X-Programmable-Read-Source": exploreReadSourceHeader({
        canonical: canonicalSource,
        custom: customSource,
      }),
    };
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
            ...sourceHeaders,
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
        {
          status: 503,
          headers: { "Cache-Control": "no-store", ...sourceHeaders },
        },
      );
    }

    const identityAsOfBlock = model?.status === "ready"
      ? (model.launchDiscoverySnapshot ?? model.snapshot).blockNumber
      : null;
    const referenceBlock = greatestBlockNumber(
      identityAsOfBlock,
      referenceHead?.blockNumber,
    );
    const unresolvedIdentityEntry = token
      ? canonicalTokenExploreEntryV1(token)
      : customProject ?? null;
    const marketByToken = unresolvedIdentityEntry
      ? readBitqueryTokenMarketDataV1(
          exploreEntryMarketIdentitiesV1(unresolvedIdentityEntry),
          { signal: request.signal },
        )
      : Promise.resolve(new Map<string, TokenMarketDataV1>());
    const identityEntry = unresolvedIdentityEntry
      ? await hydrateMissingCanonicalTokenSupplyV1([
          unresolvedIdentityEntry,
        ]).then((entries) => entries[0] ?? unresolvedIdentityEntry)
      : null;
    const valuedEntry: ValuedExploreEntry | null = identityEntry
      ? (await valueExploreEntriesWithCurrentEvidence({
          entries: [identityEntry],
          marketByToken,
          deployment: deployment.status === "ready" ? deployment : null,
          operationalSnapshot: operationalSnapshotRead,
          now: new Date(),
          allowHistoricalBitqueryFallback: true,
          timeoutMs: Math.max(0, currentEvidenceDeadlineAt - Date.now()),
        }))[0] ?? null
      : null;
    const primaryMarket = valuedEntry?.marketData?.pools.find(
      (pool) => pool.identity.poolId === valuedEntry.marketData?.primaryPoolId,
    );
    const hasVerifiedPrice = primaryMarket?.status === "current" &&
      (primaryMarket.latestTrade?.priceUsdWad !== undefined ||
        primaryMarket.latestTrade?.priceQuoteWad !== undefined);
    const valuedToken = valuedEntry?.exploreKind === "token"
      ? valuedEntry
      : null;
    const valuedCustomProject = valuedEntry?.exploreKind === "custom-project"
      ? valuedEntry
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
    const publicValuedToken = valuedToken
      ? publicExploreEntryV1(valuedToken)
      : null;
    const publicValuedCustomProject = valuedCustomProject
      ? publicExploreEntryV1(valuedCustomProject)
      : null;
    const currentOnchainValuation =
      valuedEntry?.valuation.status === "available" &&
        valuedEntry.valuation.source === "stateview-chainlink" &&
        valuedEntry.valuation.freshness === "current"
        ? valuedEntry.valuation
        : null;
    const status = "ready" as const;
    return NextResponse.json(
      {
        status,
        token: publicValuedToken,
        customProject: publicValuedCustomProject,
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
          "X-Programmable-Market-Source": currentOnchainValuation
            ? "stateview-chainlink+official-uniswap-v4-subgraph+bitquery"
            : "bitquery",
          ...(dataQuality.valuation.asOfTime
            ? {
                "X-Programmable-Market-As-Of":
                  dataQuality.valuation.asOfTime,
              }
            : {}),
          ...(currentOnchainValuation
            ? {
                "X-Programmable-Price-Source": "stateview-chainlink",
                "X-Programmable-Valuation-Block":
                  currentOnchainValuation.asOfBlock ?? "",
              }
            : hasVerifiedPrice
              ? { "X-Programmable-Price-Source": "bitquery" }
            : {}),
          ...sourceHeaders,
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
