import { NextResponse } from "next/server";

import {
  getOperationalOnchainDeployment,
  readDurableExploreModel,
  readOperationalRpcHealth,
  type OperationalRpcHealth,
} from "../../../../lib/onchain";
import { readIndexedReadModelHealth } from "../../../../lib/data-pipeline/read-model-health.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_INDEX_AGE_MS = 15 * 60 * 1_000;

type IndexedHealthRead = Readonly<{
  health: Awaited<ReturnType<typeof readIndexedReadModelHealth>>;
  status: "available" | "disabled" | "unavailable";
}>;

async function readIndexedHealth(): Promise<IndexedHealthRead> {
  try {
    const health = await readIndexedReadModelHealth();
    return {
      health,
      status: health ? "available" : "disabled",
    };
  } catch (error) {
    console.error("Programmable indexed read-model health is unavailable", {
      errorName:
        error instanceof Error ? error.name : "UnknownIndexedHealthError",
    });
    return { health: null, status: "unavailable" };
  }
}

function unhealthyRpcResponse(
  rpc: OperationalRpcHealth,
  startedAt: number,
) {
  console.error("Programmable operations RPC health check failed", {
    errorName: "OperationalRpcHealthUnhealthy",
    readStatus: rpc.read.status,
    quorumStatus: rpc.quorum.status,
    durationMs: Date.now() - startedAt,
  });
  return NextResponse.json(
    {
      status: "unhealthy",
      rpc,
      checkedAt: new Date().toISOString(),
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const indexedRead = await readIndexedHealth();
    const indexed = indexedRead.health;
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
      const rpc = await readOperationalRpcHealth(deployment);
      if (rpc.status === "unhealthy") {
        return unhealthyRpcResponse(rpc, startedAt);
      }
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
          indexSource: "indexed",
          indexedReadModel: { status: indexedRead.status },
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
      readOperationalRpcHealth(deployment),
    ]);
    if (index.status !== "ready") {
      throw new Error(`Durable index ${index.reason}: ${index.detail}`);
    }
    if (rpc.status === "unhealthy") {
      return unhealthyRpcResponse(rpc, startedAt);
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
        indexSource: "durable",
        indexedReadModel: { status: indexedRead.status },
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
