import { NextResponse } from "next/server";

import {
  getOperationalOnchainDeployment,
  readDurableExploreModel,
  readIndependentRpcHealth,
} from "../../../../lib/onchain";
import { readIndexedReadModelHealth } from "../../../../lib/data-pipeline/read-model-health.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_INDEX_AGE_MS = 15 * 60 * 1_000;

export async function GET() {
  const startedAt = Date.now();
  try {
    const indexed = await readIndexedReadModelHealth();
    const deployment = getOperationalOnchainDeployment("production");
    if (deployment.status !== "ready") {
      throw new Error(
        "The verified production release is not operationally eligible",
      );
    }
    if (indexed) {
      if (indexed.chainId !== deployment.chainId) {
        throw new Error("Indexed read-model chain binding is unavailable");
      }
      const rpc = await readIndependentRpcHealth(deployment);
      if (
        rpc.chainId !== deployment.chainId ||
        rpc.chainId !== indexed.chainId
      ) {
        throw new Error("Indexed read-model chain binding is unavailable");
      }
      return NextResponse.json(
        {
          status: "healthy",
          chainId: indexed.chainId,
          index: indexed.index,
          rpc,
          checkedAt: new Date().toISOString(),
        },
        {
          headers: {
            "Cache-Control": "public, max-age=0, s-maxage=30",
          },
        },
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
