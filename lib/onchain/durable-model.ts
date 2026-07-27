import { keccak256, toBytes, type Address, type Hex } from "viem";

import type {
  ExploreReadModel,
  ReadyOnchainDeployment,
} from "./types";

const DURABLE_INDEX_PATH =
  "indexes/mainnet-classic-v2/explore-model.json";
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1_000;

type DurableExplorePayload = {
  generatedAt: string;
  deployment: {
    chainId: number;
    releaseVersion: string;
    launcher: Address;
    feeHook: Address;
  };
  model: Extract<ExploreReadModel, { status: "ready" }>;
};

type DurableExploreEnvelope = {
  schemaVersion: "programmable-durable-index-v1";
  contentHash: Hex;
  payload: DurableExplorePayload;
};

export type DurableExploreRead =
  | {
      status: "ready";
      envelope: DurableExploreEnvelope;
      ageMs: number;
    }
  | {
      status: "unavailable";
      reason: "not-configured" | "missing" | "invalid" | "stale";
      detail: string;
    };

function contentHash(payload: DurableExplorePayload) {
  return keccak256(toBytes(JSON.stringify(payload)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateEnvelope(
  value: unknown,
  deployment: ReadyOnchainDeployment,
  maxAgeMs: number,
): DurableExploreRead {
  if (!isRecord(value) || !isRecord(value.payload)) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail: "The durable index envelope is malformed",
    };
  }
  const envelope = value as unknown as DurableExploreEnvelope;
  const payload = envelope.payload;
  const generatedAt = Date.parse(payload.generatedAt);
  const ageMs = Date.now() - generatedAt;
  if (
    envelope.schemaVersion !== "programmable-durable-index-v1" ||
    typeof envelope.contentHash !== "string" ||
    contentHash(payload).toLowerCase() !==
      envelope.contentHash.toLowerCase() ||
    !Number.isFinite(generatedAt) ||
    ageMs < -60_000 ||
    !isRecord(payload.deployment) ||
    payload.deployment.chainId !== deployment.chainId ||
    payload.deployment.releaseVersion !== deployment.releaseVersion ||
    payload.deployment.launcher?.toLowerCase() !==
      deployment.launcher.toLowerCase() ||
    payload.deployment.feeHook?.toLowerCase() !==
      deployment.feeHook.toLowerCase() ||
    !isRecord(payload.model) ||
    payload.model.status !== "ready" ||
    payload.model.snapshot?.chainId !== deployment.chainId ||
    typeof payload.model.snapshot?.blockNumber !== "string" ||
    !Array.isArray(payload.model.tokens) ||
    !Array.isArray(payload.model.creatorClaims)
  ) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail: "The durable index does not match the verified deployment",
    };
  }
  if (ageMs > maxAgeMs) {
    return {
      status: "unavailable",
      reason: "stale",
      detail: `The durable index is ${Math.floor(ageMs / 1_000)} seconds old`,
    };
  }
  return { status: "ready", envelope, ageMs };
}

export async function readDurableExploreModel(
  deployment: ReadyOnchainDeployment,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): Promise<DurableExploreRead> {
  const blobToken =
    process.env.OPS_BLOB_READ_WRITE_TOKEN ??
    process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return {
      status: "unavailable",
      reason: "not-configured",
      detail: "Persistent index storage is not configured",
    };
  }

  try {
    const { get } = await import("@vercel/blob");
    const result = await get(DURABLE_INDEX_PATH, {
      access: "private",
      token: blobToken,
      useCache: false,
    });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return {
        status: "unavailable",
        reason: "missing",
        detail: "No durable index snapshot exists",
      };
    }
    const text = await new Response(result.stream).text();
    return validateEnvelope(JSON.parse(text), deployment, maxAgeMs);
  } catch (error) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail:
        error instanceof Error
          ? error.message
          : "The durable index could not be read",
    };
  }
}

export async function writeDurableExploreModel(
  deployment: ReadyOnchainDeployment,
  model: ExploreReadModel,
) {
  if (model.status !== "ready") {
    throw new Error("Only a verified ready model can be persisted");
  }
  const blobToken =
    process.env.OPS_BLOB_READ_WRITE_TOKEN ??
    process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    throw new Error("Persistent index storage is not configured");
  }

  const existing = await readDurableExploreModel(
    deployment,
    Number.MAX_SAFE_INTEGER,
  );
  if (
    existing.status === "ready" &&
    BigInt(existing.envelope.payload.model.snapshot.blockNumber) >=
      BigInt(model.snapshot.blockNumber)
  ) {
    return {
      updated: false,
      blockNumber: existing.envelope.payload.model.snapshot.blockNumber,
      tokenCount: existing.envelope.payload.model.tokens.length,
    };
  }

  const payload: DurableExplorePayload = {
    generatedAt: new Date().toISOString(),
    deployment: {
      chainId: deployment.chainId,
      releaseVersion: deployment.releaseVersion,
      launcher: deployment.launcher,
      feeHook: deployment.feeHook,
    },
    model,
  };
  const envelope: DurableExploreEnvelope = {
    schemaVersion: "programmable-durable-index-v1",
    contentHash: contentHash(payload),
    payload,
  };
  const { put } = await import("@vercel/blob");
  await put(DURABLE_INDEX_PATH, JSON.stringify(envelope), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    token: blobToken,
  });
  return {
    updated: true,
    blockNumber: model.snapshot.blockNumber,
    tokenCount: model.tokens.length,
  };
}
