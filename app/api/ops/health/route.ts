import { NextResponse } from "next/server";

import {
  getOperationalOnchainDeployment,
  readDurableExploreModel,
  readIndependentRpcHealth,
} from "../../../../lib/onchain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_INDEX_AGE_MS = 15 * 60 * 1_000;

export async function GET() {
  const startedAt = Date.now();
  try {
    const deployment = getOperationalOnchainDeployment("production");
    if (deployment.status !== "ready") {
      throw new Error(
        "The verified production release is not operationally eligible",
      );
    }
    const [index, rpc] = await Promise.all([
      readDurableExploreModel(deployment, MAX_INDEX_AGE_MS),
      readIndependentRpcHealth(deployment),
    ]);
    if (index.status !== "ready") {
      throw new Error(`Durable index ${index.reason}: ${index.detail}`);
    }

    return NextResponse.json(
      {
        status: "healthy",
        chainId: rpc.chainId,
        index: {
          ageSeconds: Math.floor(index.ageMs / 1_000),
          blockNumber:
            index.envelope.payload.model.snapshot.blockNumber,
          tokenCount: index.envelope.payload.model.tokens.length,
        },
        rpc,
        checkedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=0, s-maxage=30",
        },
      },
    );
  } catch (error) {
    console.error("Programmable operations health check failed", {
      errorName:
        error instanceof Error ? error.name : "UnknownHealthError",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        status: "unhealthy",
        checkedAt: new Date().toISOString(),
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
