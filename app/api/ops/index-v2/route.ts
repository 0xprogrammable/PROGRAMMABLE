import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  getWebsiteReadOnchainDeployment,
  readLiveExploreModel,
  writeDurableExploreModel,
} from "../../../../lib/onchain";
import { historicalReadOnchainDeployment } from "../../../../lib/onchain/historical-read-rpc.server";
import { writePortfolioHistorySnapshot } from "../../../../lib/profile/portfolio-history-storage.server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

const INDEX_REFRESH_DEADLINE_MS = 270_000;

class IndexRefreshDeadlineError extends Error {
  override name = "IndexRefreshDeadlineError";
}

async function withIndexRefreshDeadline<Output>(
  read: () => Promise<Output>,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new IndexRefreshDeadlineError()),
          INDEX_REFRESH_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function errorClassChain(error: unknown) {
  const classes: Array<{ name: string; code?: number }> = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current) && classes.length < 6) {
    seen.add(current);
    const code =
      typeof current === "object" &&
        "code" in current &&
        typeof (current as { code?: unknown }).code === "number"
        ? (current as { code: number }).code
        : undefined;
    classes.push({
      name: current instanceof Error ? current.name : "UnknownIndexError",
      ...(code === undefined ? {} : { code }),
    });
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return classes;
}

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const secretLength = typeof cronSecret === "string"
    ? Buffer.byteLength(cronSecret, "utf8")
    : 0;
  if (
    typeof cronSecret !== "string" ||
    secretLength < 32 ||
    secretLength > 1_024 ||
    !authorization?.startsWith("Bearer ")
  ) {
    return false;
  }

  const provided = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(cronSecret, "utf8");
  return (
    provided.length === expected.length &&
    timingSafeEqual(provided, expected)
  );
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const startedAt = Date.now();
  try {
    const deployment = getWebsiteReadOnchainDeployment("production");
    if (deployment.status !== "ready") {
      throw new Error(
        "The verified production release is not operationally eligible",
      );
    }
    const durableRefreshDeployment = historicalReadOnchainDeployment(deployment);
    const model = await withIndexRefreshDeadline(() =>
      readLiveExploreModel(durableRefreshDeployment),
    );
    if (model.status !== "ready") {
      throw new Error("The live Explore model is not ready");
    }
    const [result, history] = await Promise.all([
      writeDurableExploreModel(deployment, model),
      writePortfolioHistorySnapshot(model),
    ]);
    console.info("Programmable index refresh completed", {
      blockNumber: result.blockNumber,
      tokenCount: result.tokenCount,
      updated: result.updated,
      portfolioHistoryStatus: history.status,
      portfolioHistoryPath: history.path,
      deepReleaseVersion: result.deepReleaseVersion,
      deepLifecycleEvidenceHash:
        result.deepLifecycleEvidenceHash,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        ok: true,
        blockNumber: result.blockNumber,
        tokenCount: result.tokenCount,
        updated: result.updated,
        portfolioHistory: {
          status: history.status,
          path: history.path,
          tokenCount: history.tokenCount,
          blockNumber: history.blockNumber,
        },
        deepReleaseVersion: result.deepReleaseVersion,
        deepLifecycleEvidenceHash:
          result.deepLifecycleEvidenceHash,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Programmable index refresh failed", {
      errorName:
        error instanceof Error ? error.name : "UnknownIndexError",
      errorClassChain: errorClassChain(error),
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Index refresh failed" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
