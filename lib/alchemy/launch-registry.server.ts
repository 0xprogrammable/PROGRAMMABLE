import "server-only";

import {
  isAddress,
  isHex,
  keccak256,
  toBytes,
  type Hex,
} from "viem";

import { resolveDurableExploreBlobToken } from "../onchain/durable-model";
import type { ReadyOnchainDeployment } from "../onchain/types";
import type { LauncherToken } from "../tokens";

const ALCHEMY_LAUNCH_REGISTRY_DIRECTORY =
  "indexes/mainnet-classic-v2/alchemy-launch-registry-v1";
const SCHEMA_VERSION = "programmable-alchemy-launch-registry-v1";
const REPOSITORY_COMMIT = /^[0-9a-f]{40}$/u;

export type AlchemyLaunchCursor = Readonly<{
  blockNumber: string;
  blockHash: Hex;
}>;

export type AlchemyLaunchRegistry = Readonly<{
  generatedAt: string;
  repositoryCommit: string;
  chainId: number;
  cursor: AlchemyLaunchCursor;
  tokens: readonly LauncherToken[];
}>;

type AlchemyLaunchRegistryEnvelope = Readonly<{
  schemaVersion: typeof SCHEMA_VERSION;
  contentHash: Hex;
  payload: AlchemyLaunchRegistry;
}>;

export type AlchemyLaunchRegistryRead = Readonly<{
  registry: AlchemyLaunchRegistry;
  etag: string | null;
}>;

function contentHash(payload: AlchemyLaunchRegistry) {
  return keccak256(toBytes(JSON.stringify(payload)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validIntegerString(value: unknown) {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value);
}

function requiredRepositoryCommit(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const value = environment.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
  if (!value || !REPOSITORY_COMMIT.test(value)) {
    throw new Error("Alchemy launch registry commit binding is unavailable");
  }
  return value;
}

function registryPath(repositoryCommit: string) {
  return `${ALCHEMY_LAUNCH_REGISTRY_DIRECTORY}/${repositoryCommit}.json`;
}

function validLaunchToken(value: unknown, cursorBlock: bigint) {
  if (!isRecord(value)) return false;
  if (
    !isAddress(String(value.tokenAddress ?? "")) ||
    !isAddress(String(value.hookAddress ?? "")) ||
    !isHex(String(value.poolId ?? ""), { strict: true }) ||
    String(value.poolId).length !== 66 ||
    !validIntegerString(value.launchBlockNumber) ||
    BigInt(value.launchBlockNumber as string) > cursorBlock ||
    !isHex(String(value.launchTransactionHash ?? ""), { strict: true }) ||
    String(value.launchTransactionHash).length !== 66 ||
    !Number.isSafeInteger(value.launchLogIndex) ||
    (value.launchLogIndex as number) < 0 ||
    typeof value.name !== "string" ||
    typeof value.symbol !== "string" ||
    typeof value.launchedAt !== "string" ||
    !Number.isFinite(Date.parse(value.launchedAt))
  ) {
    return false;
  }
  return true;
}

export function validateAlchemyLaunchRegistryEnvelope(
  value: unknown,
  deployment: ReadyOnchainDeployment,
): AlchemyLaunchRegistry {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SCHEMA_VERSION ||
    typeof value.contentHash !== "string" ||
    !isRecord(value.payload)
  ) {
    throw new Error("Alchemy launch registry envelope is malformed");
  }
  const payload = value.payload;
  const repositoryCommit = requiredRepositoryCommit();
  if (
    payload.chainId !== deployment.chainId ||
    payload.repositoryCommit !== repositoryCommit ||
    typeof payload.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(payload.generatedAt)) ||
    !isRecord(payload.cursor) ||
    !validIntegerString(payload.cursor.blockNumber) ||
    !isHex(String(payload.cursor.blockHash ?? ""), { strict: true }) ||
    String(payload.cursor.blockHash).length !== 66 ||
    !Array.isArray(payload.tokens)
  ) {
    throw new Error("Alchemy launch registry payload is malformed");
  }
  const registry = payload as unknown as AlchemyLaunchRegistry;
  if (contentHash(registry).toLowerCase() !== value.contentHash.toLowerCase()) {
    throw new Error("Alchemy launch registry content hash is invalid");
  }
  const cursorBlock = BigInt(registry.cursor.blockNumber);
  if (!registry.tokens.every((token) => validLaunchToken(token, cursorBlock))) {
    throw new Error("Alchemy launch registry contains an invalid token");
  }
  const tokenKeys = registry.tokens.map((token) =>
    token.tokenAddress.toLowerCase(),
  );
  const eventKeys = registry.tokens.map((token) =>
    [
      token.launchTransactionHash?.toLowerCase(),
      token.launchLogIndex,
    ].join(":"),
  );
  if (
    new Set(tokenKeys).size !== tokenKeys.length ||
    new Set(eventKeys).size !== eventKeys.length
  ) {
    throw new Error("Alchemy launch registry contains duplicate provenance");
  }
  return registry;
}

export async function readAlchemyLaunchRegistry(
  deployment: ReadyOnchainDeployment,
  initialCursor: AlchemyLaunchCursor,
): Promise<AlchemyLaunchRegistryRead> {
  const token = resolveDurableExploreBlobToken();
  if (!token) throw new Error("Alchemy launch registry storage is not configured");
  const repositoryCommit = requiredRepositoryCommit();
  const { get } = await import("@vercel/blob");
  const result = await get(registryPath(repositoryCommit), {
    access: "private",
    token,
    useCache: false,
  });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return {
      registry: {
        generatedAt: new Date().toISOString(),
        repositoryCommit,
        chainId: deployment.chainId,
        cursor: initialCursor,
        tokens: [],
      },
      etag: null,
    };
  }
  const registry = validateAlchemyLaunchRegistryEnvelope(
    JSON.parse(await new Response(result.stream).text()),
    deployment,
  );
  return { registry, etag: result.blob.etag };
}

export async function writeAlchemyLaunchRegistry(
  deployment: ReadyOnchainDeployment,
  registry: AlchemyLaunchRegistry,
  expectedEtag: string | null,
) {
  const token = resolveDurableExploreBlobToken();
  if (!token) throw new Error("Alchemy launch registry storage is not configured");
  const repositoryCommit = requiredRepositoryCommit();
  const validated = validateAlchemyLaunchRegistryEnvelope(
    {
      schemaVersion: SCHEMA_VERSION,
      contentHash: contentHash(registry),
      payload: registry,
    },
    deployment,
  );
  const envelope: AlchemyLaunchRegistryEnvelope = {
    schemaVersion: SCHEMA_VERSION,
    contentHash: contentHash(validated),
    payload: validated,
  };
  const { get, put } = await import("@vercel/blob");
  const path = registryPath(repositoryCommit);
  try {
    return await put(path, JSON.stringify(envelope), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: expectedEtag !== null,
      cacheControlMaxAge: 60,
      ...(expectedEtag ? { ifMatch: expectedEtag } : {}),
      token,
    });
  } catch (error) {
    if (expectedEtag === null) {
      const existing = await get(path, {
        access: "private",
        token,
        useCache: false,
      });
      if (existing?.statusCode === 200) {
        const conflict = new Error("Alchemy launch registry was created concurrently");
        conflict.name = "AlchemyLaunchRegistryCreateConflictError";
        throw conflict;
      }
    }
    throw error;
  }
}
