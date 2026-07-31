import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  getOperationalOnchainDeployment,
  readLiveExploreModel,
  writeDurableExploreModel,
} from "../../../../lib/onchain";
import { writePortfolioHistorySnapshot } from "../../../../lib/profile/portfolio-history-storage.server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

const INDEX_READ_ATTEMPTS = 2;

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!cronSecret || !authorization?.startsWith("Bearer ")) {
    return false;
  }

  const provided = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(cronSecret);
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
    const deployment = getOperationalOnchainDeployment("production");
    if (deployment.status !== "ready") {
      throw new Error(
        "The verified production release is not operationally eligible",
      );
    }
    let model: Awaited<ReturnType<typeof readLiveExploreModel>> | null =
      null;
    let lastReadError: unknown;
    for (let attempt = 1; attempt <= INDEX_READ_ATTEMPTS; attempt += 1) {
      try {
        model = await readLiveExploreModel(deployment);
        break;
      } catch (error) {
        lastReadError = error;
        if (attempt < INDEX_READ_ATTEMPTS) {
          console.warn("Programmable index read will retry", {
            attempt,
            errorName:
              error instanceof Error ? error.name : "UnknownIndexError",
          });
        }
      }
    }
    if (!model) {
      throw lastReadError ?? new Error("Index read failed");
    }
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
