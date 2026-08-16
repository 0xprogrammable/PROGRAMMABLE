import "server-only";

import { keccak256, toFunctionSelector, type Hex } from "viem";

import deploymentSource from
  "@/config/custom-registry-v2.deployment.prelaunch.json";
import {
  CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH_V2,
  PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V2,
  type CustomRegistryLivePublicManifestV2,
  type CustomRegistryPublicManifestV2,
  type CustomRegistryV2DeploymentEvidence,
  type CustomRegistryV2FinalityBinding,
  type CustomRegistryV2ReleaseEvidence,
} from "@/lib/custom-launch/registry-public-manifest-v2";
import { productionRecoveryMainnetRpcPair } from
  "@/lib/onchain/website-rpc-providers.server";
import { parseStrictJson } from "../projection-target/canonical-json";

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const HASH32 = /^0x[0-9a-f]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const GIT_OBJECT_ID = /^[0-9a-f]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const ABI_WORD = /^0x[0-9a-f]{64}$/u;
const MAXIMUM_RPC_RESPONSE_BYTES = 262_144;
const RPC_TIMEOUT_MS = 5_000;

const MANIFEST_HEADERS = Object.freeze({
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=60, stale-while-revalidate=300",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
});

const READINESS_HEADERS = Object.freeze({
  "access-control-allow-origin": "*",
  "cache-control": "no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
});

export function resolveCustomRegistryPublicManifestV2(
  source: unknown = deploymentSource,
): CustomRegistryPublicManifestV2 {
  const value = exactObject(source, "Custom Registry V2 deployment", [
    "caip2", "chainId", "finality", "generation", "indexingEnabled",
    "profiles", "publicReadEnabled", "registry", "release", "schemaVersion",
    "status",
  ]);
  if (
    value.schemaVersion !== "programmable.custom-registry-v2-deployment.v1"
    || value.generation !== "2"
    || value.chainId !== "1"
    || value.caip2 !== "eip155:1"
  ) throw new TypeError("Custom Registry V2 deployment identity is invalid");

  const registry = exactObject(value.registry, "Custom Registry V2 registry", [
    "address", "deploymentBlock", "deploymentBlockHash",
    "deploymentTransactionHash", "runtimeCodeKeccak256",
  ]);
  const release = exactObject(value.release, "Custom Registry V2 release", [
    "abiArtifactSha256", "eventSetSha256", "sourceArtifactSha256",
    "sourceCommit", "sourceTree",
  ]);
  const finality = exactObject(value.finality, "Custom Registry V2 finality", [
    "minimumConfirmations", "policyBindingHash",
  ]);
  assertProfilePayloadIsOpaque(value.profiles);

  if (value.status === "prelaunch") {
    if (
      value.publicReadEnabled !== false
      || value.indexingEnabled !== false
      || Object.values(registry).some((entry) => entry !== null)
      || Object.values(release).some((entry) => entry !== null)
      || Object.values(finality).some((entry) => entry !== null)
    ) throw new TypeError("Custom Registry V2 prelaunch binding is invalid");
    return PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V2;
  }

  if (
    value.status !== "live"
    || value.publicReadEnabled !== true
    || value.indexingEnabled !== true
  ) throw new TypeError("Custom Registry V2 live binding is invalid");

  const registryEvidence = parseRegistryEvidence(registry);
  const releaseEvidence = parseReleaseEvidence(release);
  const finalityBinding = parseFinalityBinding(finality);
  return Object.freeze({
    schemaVersion: "programmable.custom-registry-public-manifest.v2" as const,
    status: "live" as const,
    generation: "2" as const,
    chainId: "1" as const,
    caip2: "eip155:1" as const,
    publicReadEnabled: true,
    indexingEnabled: true,
    registry: registryEvidence,
    release: releaseEvidence,
    finality: finalityBinding,
  });
}

export function createCustomRegistryManifestHandlerV2(
  source: unknown,
): (request: Request) => Response {
  return function customRegistryManifest(request: Request): Response {
    if (!validReadRequest(request)) {
      return Response.json({
        schemaVersion: "programmable.custom-registry-public-manifest-error.v2",
        status: "error",
        code: "invalid_manifest_request",
      }, { status: 400, headers: READINESS_HEADERS });
    }
    try {
      return Response.json(resolveCustomRegistryPublicManifestV2(source), {
        status: 200,
        headers: MANIFEST_HEADERS,
      });
    } catch {
      return Response.json({
        schemaVersion: "programmable.custom-registry-public-manifest-error.v2",
        status: "error",
        code: "custom_registry_manifest_invalid",
      }, { status: 503, headers: READINESS_HEADERS });
    }
  };
}

export function createCustomRegistryReadinessHandlerV2(input: Readonly<{
  deploymentSource: unknown;
  rpcUrls: () => readonly [URL, URL];
  rpcFetch: typeof fetch;
  now: () => Date;
}>): (request: Request) => Promise<Response> {
  return async function customRegistryReadiness(request: Request): Promise<Response> {
    let manifest: CustomRegistryPublicManifestV2;
    try {
      manifest = resolveCustomRegistryPublicManifestV2(input.deploymentSource);
    } catch {
      return readinessError(503, "custom_registry_manifest_invalid", "prelaunch", input.now);
    }
    if (!validReadRequest(request)) {
      return readinessError(400, "invalid_readiness_request", manifest.status, input.now);
    }
    if (manifest.status !== "live") {
      return readinessError(503, "custom_registry_prelaunch", manifest.status, input.now);
    }
    try {
      await assertCustomRegistryV2DeploymentReadiness({
        deploymentSource: input.deploymentSource,
        rpcUrls: input.rpcUrls(),
        rpcFetch: input.rpcFetch,
      });
      return Response.json({
        schemaVersion: "programmable.custom-registry-readiness.v2",
        status: "ready",
        registryStatus: "live",
        generation: "2",
        chainId: "1",
        manifestPath: CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH_V2,
        runtimeBindings: "verified",
        providerQuorum: "verified",
        checkedAt: input.now().toISOString(),
      }, { status: 200, headers: READINESS_HEADERS });
    } catch {
      return readinessError(503, "custom_registry_not_ready", manifest.status, input.now);
    }
  };
}

export async function assertCustomRegistryV2DeploymentReadiness(input: Readonly<{
  deploymentSource: unknown;
  rpcUrls: readonly [URL, URL];
  rpcFetch: typeof fetch;
}>): Promise<CustomRegistryLivePublicManifestV2> {
  const manifest = resolveCustomRegistryPublicManifestV2(input.deploymentSource);
  if (manifest.status !== "live") {
    throw new TypeError("Custom Registry V2 deployment is not live");
  }
  if (
    input.rpcUrls.length !== 2
    || input.rpcUrls[0].toString() === input.rpcUrls[1].toString()
  ) throw new TypeError("Custom Registry V2 RPC quorum is invalid");
  await Promise.all(input.rpcUrls.map((url) => verifyRegistryDeploymentWithProvider(
    manifest,
    url,
    input.rpcFetch,
  )));
  return manifest;
}

async function verifyRegistryDeploymentWithProvider(
  manifest: CustomRegistryLivePublicManifestV2,
  rpcUrl: URL,
  rpcFetch: typeof fetch,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await rpcFetch(rpcUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
        { jsonrpc: "2.0", id: 2, method: "eth_getCode", params: [manifest.registry.address, "latest"] },
        { jsonrpc: "2.0", id: 3, method: "eth_getTransactionReceipt", params: [manifest.registry.deploymentTransactionHash] },
        { jsonrpc: "2.0", id: 4, method: "eth_getBlockByNumber", params: [decimalToQuantity(manifest.registry.deploymentBlock), false] },
        { jsonrpc: "2.0", id: 5, method: "eth_blockNumber", params: [] },
        { jsonrpc: "2.0", id: 6, method: "eth_call", params: [{
          to: manifest.registry.address,
          data: toFunctionSelector("REGISTRY_POLICY_COMMITMENT()"),
        }, "latest"] },
        { jsonrpc: "2.0", id: 7, method: "eth_call", params: [{
          to: manifest.registry.address,
          data: toFunctionSelector("MINIMUM_FINALITY_BLOCKS()"),
        }, "latest"] },
        { jsonrpc: "2.0", id: 8, method: "eth_call", params: [{
          to: manifest.registry.address,
          data: toFunctionSelector("REGISTRY_GENERATION()"),
        }, "latest"] },
      ]),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type")
      ?.split(";", 1)[0]?.trim().toLowerCase();
    const declaredLength = response.headers.get("content-length");
    if (
      response.status !== 200
      || contentType !== "application/json"
      || (declaredLength !== null && (!/^\d+$/u.test(declaredLength)
        || Number(declaredLength) > MAXIMUM_RPC_RESPONSE_BYTES))
    ) {
      await response.body?.cancel();
      throw new TypeError("Custom Registry V2 RPC response is invalid");
    }
    const bytes = await readBoundedResponse(response, MAXIMUM_RPC_RESPONSE_BYTES);
    const parsed = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes), {
      maximumBytes: MAXIMUM_RPC_RESPONSE_BYTES,
      maximumDepth: 16,
    });
    assertRegistryDeploymentRpcResults(parsed, manifest);
  } finally {
    clearTimeout(timeout);
  }
}

function assertRegistryDeploymentRpcResults(
  raw: unknown,
  manifest: CustomRegistryLivePublicManifestV2,
): void {
  if (!Array.isArray(raw) || raw.length !== 8) {
    throw new TypeError("Custom Registry V2 RPC response is invalid");
  }
  const results = new Map<number, unknown>();
  for (const candidate of raw) {
    const value = exactObject(candidate, "Custom Registry V2 RPC result", [
      "id", "jsonrpc", "result",
    ]);
    if (
      value.jsonrpc !== "2.0"
      || !Number.isSafeInteger(value.id)
      || results.has(value.id as number)
    ) throw new TypeError("Custom Registry V2 RPC response is invalid");
    results.set(value.id as number, value.result);
  }
  if (results.get(1) !== "0x1") {
    throw new TypeError("Custom Registry V2 RPC chain is invalid");
  }
  const code = results.get(2);
  if (
    typeof code !== "string"
    || !/^0x(?:[0-9a-f]{2})+$/u.test(code)
    || keccak256(code as Hex) !== manifest.registry.runtimeCodeKeccak256
  ) throw new TypeError("Custom Registry V2 runtime binding is invalid");

  const receipt = exactOpenObject(results.get(3), "Custom Registry V2 receipt");
  if (
    receipt.status !== "0x1"
    || receipt.contractAddress !== manifest.registry.address
    || receipt.transactionHash !== manifest.registry.deploymentTransactionHash
    || receipt.blockHash !== manifest.registry.deploymentBlockHash
    || quantityToDecimal(receipt.blockNumber) !== manifest.registry.deploymentBlock
  ) throw new TypeError("Custom Registry V2 receipt binding is invalid");

  const block = exactOpenObject(results.get(4), "Custom Registry V2 block");
  if (
    block.hash !== manifest.registry.deploymentBlockHash
    || quantityToDecimal(block.number) !== manifest.registry.deploymentBlock
  ) throw new TypeError("Custom Registry V2 block binding is invalid");
  const head = quantityToDecimal(results.get(5));
  if (
    BigInt(head) < BigInt(manifest.registry.deploymentBlock)
      + BigInt(manifest.finality.minimumConfirmations)
  ) throw new TypeError("Custom Registry V2 deployment is not final");
  if (results.get(6) !== manifest.finality.policyBindingHash) {
    throw new TypeError("Custom Registry V2 policy binding is invalid");
  }
  if (
    abiWordToDecimal(results.get(7)) !== manifest.finality.minimumConfirmations
    || abiWordToDecimal(results.get(8)) !== "2"
  ) throw new TypeError("Custom Registry V2 contract identity is invalid");
}

function parseRegistryEvidence(
  value: Readonly<Record<string, unknown>>,
): CustomRegistryV2DeploymentEvidence {
  return Object.freeze({
    address: address(value.address, "registry address"),
    runtimeCodeKeccak256: hash32(value.runtimeCodeKeccak256, "registry runtime"),
    deploymentTransactionHash: hash32(value.deploymentTransactionHash, "deployment transaction"),
    deploymentBlock: decimal(value.deploymentBlock, "deployment block"),
    deploymentBlockHash: hash32(value.deploymentBlockHash, "deployment block hash"),
  });
}

function parseReleaseEvidence(
  value: Readonly<Record<string, unknown>>,
): CustomRegistryV2ReleaseEvidence {
  return Object.freeze({
    sourceCommit: gitObject(value.sourceCommit, "source commit"),
    sourceTree: gitObject(value.sourceTree, "source tree"),
    sourceArtifactSha256: sha256(value.sourceArtifactSha256, "source artifact"),
    abiArtifactSha256: sha256(value.abiArtifactSha256, "ABI artifact"),
    eventSetSha256: sha256(value.eventSetSha256, "event-set artifact"),
  });
}

function parseFinalityBinding(
  value: Readonly<Record<string, unknown>>,
): CustomRegistryV2FinalityBinding {
  const minimumConfirmations = decimal(
    value.minimumConfirmations,
    "minimum confirmations",
  );
  if (BigInt(minimumConfirmations) < 1n || BigInt(minimumConfirmations) > 255n) {
    throw new TypeError("Custom Registry V2 minimum confirmations are invalid");
  }
  return Object.freeze({
    minimumConfirmations,
    policyBindingHash: hash32(value.policyBindingHash, "policy binding"),
  });
}

function assertProfilePayloadIsOpaque(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Custom Registry V2 profile payload is invalid");
  }
}

function exactObject(
  value: unknown,
  label: string,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  const object = exactOpenObject(value, label);
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) throw new TypeError(`${label} keys are invalid`);
  return object;
}

function exactOpenObject(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function address(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !ADDRESS.test(value)) {
    throw new TypeError(`Custom Registry V2 ${label} is invalid`);
  }
  return value as `0x${string}`;
}

function hash32(value: unknown, label: string): `0x${string}` {
  if (
    typeof value !== "string"
    || !HASH32.test(value)
    || value === `0x${"00".repeat(32)}`
  ) throw new TypeError(`Custom Registry V2 ${label} is invalid`);
  return value as `0x${string}`;
}

function sha256(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`Custom Registry V2 ${label} is invalid`);
  }
  return value as `sha256:${string}`;
}

function gitObject(value: unknown, label: string): string {
  if (typeof value !== "string" || !GIT_OBJECT_ID.test(value)) {
    throw new TypeError(`Custom Registry V2 ${label} is invalid`);
  }
  return value;
}

function decimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new TypeError(`Custom Registry V2 ${label} is invalid`);
  }
  return value;
}

function decimalToQuantity(value: string): `0x${string}` {
  return `0x${BigInt(value).toString(16)}`;
}

function quantityToDecimal(value: unknown): string {
  if (typeof value !== "string" || !QUANTITY.test(value)) {
    throw new TypeError("Custom Registry V2 RPC quantity is invalid");
  }
  return BigInt(value).toString(10);
}

function abiWordToDecimal(value: unknown): string {
  if (typeof value !== "string" || !ABI_WORD.test(value)) {
    throw new TypeError("Custom Registry V2 ABI word is invalid");
  }
  return BigInt(value).toString(10);
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (response.body === null) throw new TypeError("RPC response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumBytes) throw new TypeError("RPC response body is too large");
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function validReadRequest(request: Request): boolean {
  const url = new URL(request.url);
  const accept = request.headers.get("accept")?.trim().toLowerCase();
  return request.method === "GET"
    && request.body === null
    && (accept === "application/json" || accept === "*/*")
    && !request.headers.has("content-type")
    && url.username === ""
    && url.password === ""
    && url.search === ""
    && url.hash === "";
}

function readinessError(
  status: 400 | 503,
  code: string,
  registryStatus: CustomRegistryPublicManifestV2["status"],
  now: () => Date,
): Response {
  return Response.json({
    schemaVersion: "programmable.custom-registry-readiness.v2",
    status: "unready",
    registryStatus,
    generation: "2",
    chainId: "1",
    code,
    manifestPath: CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH_V2,
    runtimeBindings: "not-run",
    providerQuorum: "not-run",
    checkedAt: now().toISOString(),
  }, { status, headers: READINESS_HEADERS });
}

export function handleProductionCustomRegistryManifestV2(
  request: Request,
): Response {
  return createCustomRegistryManifestHandlerV2(deploymentSource)(request);
}

export function handleProductionCustomRegistryReadinessV2(
  request: Request,
): Promise<Response> {
  return createCustomRegistryReadinessHandlerV2({
    deploymentSource,
    rpcUrls: () => {
      const pair = productionRecoveryMainnetRpcPair();
      return [new URL(pair.primary.url), new URL(pair.secondary.url)] as const;
    },
    rpcFetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
  })(request);
}
