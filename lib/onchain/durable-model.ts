import { keccak256, toBytes, type Address, type Hex } from "viem";

import appDeployments from "../../contracts/config/app-deployments.v1.json";
import {
  getVerifiedDeepRelease,
  type LaunchModelReleaseManifest,
} from "../launch-model-gating";
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

export type DeepExploreReleaseBinding = {
  releaseVersion: "deep-full-range-v1";
  releaseCommit: string;
  sourceCommitment: Hex;
  lifecycleEvidenceHash: Hex;
  launcher: Address;
  feeHook: Address;
  growthVaultFactory: Address;
  automation: Address;
  deploymentBlock: number;
};

type DurableExplorePayloadV2 = DurableExplorePayload & {
  launchModels: {
    deep: DeepExploreReleaseBinding | null;
  };
};

type DurableExploreEnvelopeV1 = {
  schemaVersion: "programmable-durable-index-v1";
  contentHash: Hex;
  payload: DurableExplorePayload;
};

type DurableExploreEnvelopeV2 = {
  schemaVersion: "programmable-durable-index-v2";
  contentHash: Hex;
  payload: DurableExplorePayloadV2;
};

type DurableExploreEnvelope =
  | DurableExploreEnvelopeV1
  | DurableExploreEnvelopeV2;

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

function contentHash(payload: unknown) {
  return keccak256(toBytes(JSON.stringify(payload)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function matchesDeepReleaseBinding(
  value: unknown,
  expected: DeepExploreReleaseBinding | null,
) {
  if (expected === null) return value === null;
  if (!isRecord(value)) return false;
  return (
    value.releaseVersion === expected.releaseVersion &&
    value.releaseCommit === expected.releaseCommit &&
    sameValue(value.sourceCommitment, expected.sourceCommitment) &&
    sameValue(
      value.lifecycleEvidenceHash,
      expected.lifecycleEvidenceHash,
    ) &&
    sameValue(value.launcher, expected.launcher) &&
    sameValue(value.feeHook, expected.feeHook) &&
    sameValue(value.growthVaultFactory, expected.growthVaultFactory) &&
    sameValue(value.automation, expected.automation) &&
    value.deploymentBlock === expected.deploymentBlock
  );
}

export function resolveDeepExploreReleaseBinding(
  deployment: ReadyOnchainDeployment,
): DeepExploreReleaseBinding | null {
  const manifest = appDeployments[
    deployment.environment
  ] as unknown as LaunchModelReleaseManifest;
  const release = getVerifiedDeepRelease(manifest, deployment.chainId);
  if (!release) return null;
  return {
    releaseVersion: "deep-full-range-v1",
    releaseCommit: release.releaseCommit as string,
    sourceCommitment: release.sourceCommitment as Hex,
    lifecycleEvidenceHash: release.lifecycleEvidenceHash as Hex,
    launcher: release.launcher as Address,
    feeHook: release.feeHook as Address,
    growthVaultFactory: release.growthVaultFactory as Address,
    automation: release.automation as Address,
    deploymentBlock: release.deploymentBlock as number,
  };
}

export function validateDurableExploreEnvelope(
  value: unknown,
  deployment: ReadyOnchainDeployment,
  maxAgeMs: number,
  expectedDeepRelease = resolveDeepExploreReleaseBinding(deployment),
): DurableExploreRead {
  if (!isRecord(value) || !isRecord(value.payload)) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail: "The durable index envelope is malformed",
    };
  }
  const schemaVersion = value.schemaVersion;
  if (
    schemaVersion !== "programmable-durable-index-v1" &&
    schemaVersion !== "programmable-durable-index-v2"
  ) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail: "The durable index schema is not supported",
    };
  }
  const payload = value.payload;
  const generatedAt =
    typeof payload.generatedAt === "string"
      ? Date.parse(payload.generatedAt)
      : Number.NaN;
  const ageMs = Date.now() - generatedAt;
  if (
    typeof value.contentHash !== "string" ||
    contentHash(payload).toLowerCase() !==
      value.contentHash.toLowerCase() ||
    !Number.isFinite(generatedAt) ||
    ageMs < -60_000 ||
    !isRecord(payload.deployment) ||
    !isRecord(payload.model) ||
    !isRecord(payload.model.snapshot)
  ) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail: "The durable index does not match the verified deployment",
    };
  }
  if (
    payload.deployment.chainId !== deployment.chainId ||
    payload.deployment.releaseVersion !== deployment.releaseVersion ||
    !sameValue(payload.deployment.launcher, deployment.launcher) ||
    !sameValue(payload.deployment.feeHook, deployment.feeHook) ||
    payload.model.status !== "ready" ||
    payload.model.snapshot.chainId !== deployment.chainId ||
    typeof payload.model.snapshot.blockNumber !== "string" ||
    typeof payload.model.snapshot.blockHash !== "string" ||
    !Array.isArray(payload.model.tokens) ||
    !Array.isArray(payload.model.creatorClaims)
  ) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail: "The durable index does not match the verified deployment",
    };
  }
  if (schemaVersion === "programmable-durable-index-v1") {
    if (expectedDeepRelease !== null) {
      return {
        status: "unavailable",
        reason: "invalid",
        detail:
          "The durable index predates the verified Deep release binding",
      };
    }
  } else if (
    !isRecord(payload.launchModels) ||
    !matchesDeepReleaseBinding(
      payload.launchModels.deep,
      expectedDeepRelease,
    )
  ) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail:
        "The durable index Deep release binding does not match the verified lifecycle",
    };
  }
  if (ageMs > maxAgeMs) {
    return {
      status: "unavailable",
      reason: "stale",
      detail: `The durable index is ${Math.floor(ageMs / 1_000)} seconds old`,
    };
  }
  return {
    status: "ready",
    envelope: value as unknown as DurableExploreEnvelope,
    ageMs,
  };
}

export function shouldReplaceDurableSnapshot(
  current: { blockNumber: string; blockHash: Hex },
  incoming: { blockNumber: string; blockHash: Hex },
) {
  const currentBlock = BigInt(current.blockNumber);
  const incomingBlock = BigInt(incoming.blockNumber);
  return (
    incomingBlock > currentBlock ||
    (incomingBlock === currentBlock &&
      incoming.blockHash.toLowerCase() !== current.blockHash.toLowerCase())
  );
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
    return validateDurableExploreEnvelope(
      JSON.parse(text),
      deployment,
      maxAgeMs,
    );
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
  const deepRelease = resolveDeepExploreReleaseBinding(deployment);

  const existing = await readDurableExploreModel(
    deployment,
    Number.MAX_SAFE_INTEGER,
  );
  if (
    existing.status === "ready" &&
    !shouldReplaceDurableSnapshot(
      existing.envelope.payload.model.snapshot,
      model.snapshot,
    )
  ) {
    return {
      updated: false,
      blockNumber: existing.envelope.payload.model.snapshot.blockNumber,
      tokenCount: existing.envelope.payload.model.tokens.length,
      deepReleaseVersion: deepRelease?.releaseVersion ?? null,
      deepLifecycleEvidenceHash:
        deepRelease?.lifecycleEvidenceHash ?? null,
    };
  }

  const payload: DurableExplorePayloadV2 = {
    generatedAt: new Date().toISOString(),
    deployment: {
      chainId: deployment.chainId,
      releaseVersion: deployment.releaseVersion,
      launcher: deployment.launcher,
      feeHook: deployment.feeHook,
    },
    launchModels: {
      deep: deepRelease,
    },
    model,
  };
  const envelope: DurableExploreEnvelopeV2 = {
    schemaVersion: "programmable-durable-index-v2",
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
    deepReleaseVersion: deepRelease?.releaseVersion ?? null,
    deepLifecycleEvidenceHash:
      deepRelease?.lifecycleEvidenceHash ?? null,
  };
}
