import "server-only";

import { keccak256, type Hex } from "viem";

import {
  CUSTOM_REGISTRY_CONTRACT_KEYS,
  CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH,
  PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
  type CustomRegistryContractKeyV1,
  type CustomRegistryPublicManifestV1,
} from "../../custom-launch/registry-public-manifest-v1";
import { parseStrictJson } from "../projection-target/canonical-json";

const MAXIMUM_RPC_RESPONSE_BYTES = 131_072;
const RPC_TIMEOUT_MS = 5_000;

const CONTRACT_ENVIRONMENT = Object.freeze({
  registry: Object.freeze({
    address: "PROGRAMMABLE_CUSTOM_REGISTRY_ADDRESS",
    runtimeCodeKeccak256:
      "PROGRAMMABLE_CUSTOM_REGISTRY_RUNTIME_CODE_KECCAK256",
  }),
  partnerFactoryRegistry: Object.freeze({
    address: "PROGRAMMABLE_CUSTOM_PARTNER_FACTORY_REGISTRY_ADDRESS",
    runtimeCodeKeccak256:
      "PROGRAMMABLE_CUSTOM_PARTNER_FACTORY_REGISTRY_RUNTIME_CODE_KECCAK256",
  }),
  feePolicyVerifier: Object.freeze({
    address: "PROGRAMMABLE_CUSTOM_FEE_POLICY_VERIFIER_ADDRESS",
    runtimeCodeKeccak256:
      "PROGRAMMABLE_CUSTOM_FEE_POLICY_VERIFIER_RUNTIME_CODE_KECCAK256",
  }),
  atomicRegistrar: Object.freeze({
    address: "PROGRAMMABLE_CUSTOM_ATOMIC_REGISTRAR_ADDRESS",
    runtimeCodeKeccak256:
      "PROGRAMMABLE_CUSTOM_ATOMIC_REGISTRAR_RUNTIME_CODE_KECCAK256",
  }),
} satisfies Readonly<Record<CustomRegistryContractKeyV1, Readonly<{
  address: string;
  runtimeCodeKeccak256: string;
}>>>);

const SPECIFICATION_ENVIRONMENT = Object.freeze({
  abi: Object.freeze({
    identifier: "PROGRAMMABLE_CUSTOM_REGISTRY_ABI_IDENTIFIER",
    url: "PROGRAMMABLE_CUSTOM_REGISTRY_ABI_URL",
  }),
  eventSet: Object.freeze({
    identifier: "PROGRAMMABLE_CUSTOM_REGISTRY_EVENT_SET_IDENTIFIER",
    url: "PROGRAMMABLE_CUSTOM_REGISTRY_EVENT_SET_URL",
  }),
  hashSpec: Object.freeze({
    identifier: "PROGRAMMABLE_CUSTOM_REGISTRY_HASH_SPEC_IDENTIFIER",
    url: "PROGRAMMABLE_CUSTOM_REGISTRY_HASH_SPEC_URL",
  }),
});

export const CUSTOM_REGISTRY_PUBLIC_ENVIRONMENT_KEYS_V1 = Object.freeze([
  "PROGRAMMABLE_CUSTOM_REGISTRY_PUBLIC_ENABLED",
  "PROGRAMMABLE_CUSTOM_REGISTRY_START_BLOCK",
  "PROGRAMMABLE_CUSTOM_REGISTRY_GENERATION",
  ...CUSTOM_REGISTRY_CONTRACT_KEYS.flatMap((key) => [
    CONTRACT_ENVIRONMENT[key].address,
    CONTRACT_ENVIRONMENT[key].runtimeCodeKeccak256,
  ]),
  ...Object.values(SPECIFICATION_ENVIRONMENT).flatMap((binding) => [
    binding.identifier,
    binding.url,
  ]),
] as const);

type Environment = Readonly<Record<string, string | undefined>>;

export function resolveCustomRegistryPublicManifestV1(
  environment: Environment = process.env,
): CustomRegistryPublicManifestV1 {
  void environment;
  return PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1;
}

export type CustomRegistryRuntimeVerificationV1 =
  | "not-configured"
  | "verified";

export async function verifyCustomRegistryRuntimeBindingsV1(
  manifest: CustomRegistryPublicManifestV1,
  rpcUrlValue: string,
  rpcFetch: typeof fetch,
): Promise<void> {
  if (manifest.status !== "live") {
    throw new TypeError("Custom Registry manifest is not live");
  }
  const rpcUrl = exactRpcUrl(rpcUrlValue);
  const calls = [
    { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
    ...CUSTOM_REGISTRY_CONTRACT_KEYS.map((key, index) => ({
      jsonrpc: "2.0",
      id: index + 2,
      method: "eth_getCode",
      params: [manifest.contracts[key].address, "latest"],
    })),
  ];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await rpcFetch(rpcUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(calls),
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
      || (declaredLength !== null && (
        !/^\d+$/u.test(declaredLength)
        || Number(declaredLength) > MAXIMUM_RPC_RESPONSE_BYTES
      ))
    ) {
      await response.body?.cancel();
      throw new TypeError("Custom Registry RPC response is invalid");
    }
    const body = await readBoundedBody(response, MAXIMUM_RPC_RESPONSE_BYTES);
    const parsed = parseStrictJson(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
      { maximumBytes: MAXIMUM_RPC_RESPONSE_BYTES, maximumDepth: 6 },
    );
    assertRuntimeBindingResults(parsed, manifest);
  } finally {
    clearTimeout(timeout);
  }
}

function exactRpcUrl(value: string): URL {
  if (value.trim() !== value || value.length === 0 || value.length > 2_048) {
    throw new TypeError("Custom Registry readiness RPC URL is invalid");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
  ) throw new TypeError("Custom Registry readiness RPC URL is invalid");
  return url;
}

async function readBoundedBody(
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
      if (length > maximumBytes) {
        throw new TypeError("RPC response body is too large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function assertRuntimeBindingResults(
  value: unknown,
  manifest: CustomRegistryPublicManifestV1,
): void {
  if (!Array.isArray(value) || value.length !== 5) {
    throw new TypeError("Custom Registry RPC response is invalid");
  }
  const byId = new Map<number, string>();
  for (const candidate of value) {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new TypeError("Custom Registry RPC response is invalid");
    }
    const record = candidate as Record<string, unknown>;
    if (
      Object.keys(record).sort().join("\0") !== "id\0jsonrpc\0result"
      || record.jsonrpc !== "2.0"
      || !Number.isSafeInteger(record.id)
      || typeof record.result !== "string"
      || byId.has(record.id as number)
    ) throw new TypeError("Custom Registry RPC response is invalid");
    byId.set(record.id as number, record.result);
  }
  if (byId.get(1) !== "0x1") {
    throw new TypeError("Custom Registry RPC is on the wrong chain");
  }
  for (const [index, key] of CUSTOM_REGISTRY_CONTRACT_KEYS.entries()) {
    const code = byId.get(index + 2);
    if (
      typeof code !== "string"
      || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(code)
      || keccak256(code as Hex) !== manifest.contracts[key].runtimeCodeKeccak256
    ) throw new TypeError(`Custom Registry ${key} runtime binding does not match`);
  }
}

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

export function createCustomRegistryManifestHandlerV1(
  environment: Environment,
): (request: Request) => Response {
  return function customRegistryManifest(request: Request): Response {
    if (!validReadRequest(request)) {
      return Response.json({
        schemaVersion: "programmable.custom-registry-public-manifest-error.v1",
        status: "error",
        code: "invalid_manifest_request",
      }, { status: 400, headers: READINESS_HEADERS });
    }
    return Response.json(resolveCustomRegistryPublicManifestV1(environment), {
      status: 200,
      headers: MANIFEST_HEADERS,
    });
  };
}

export function createCustomRegistryReadinessHandlerV1(input: Readonly<{
  environment: Environment;
  rpcFetch: typeof fetch;
  now: () => Date;
}>): (request: Request) => Promise<Response> {
  return async function customRegistryReadiness(request: Request): Promise<Response> {
    const manifest = resolveCustomRegistryPublicManifestV1(input.environment);
    if (!validReadRequest(request)) {
      return readinessError(
        400,
        "invalid_readiness_request",
        manifest.status,
        input.now,
      );
    }
    if (manifest.status !== "live") {
      return readinessError(
        503,
        "custom_registry_prelaunch",
        manifest.status,
        input.now,
      );
    }
    try {
      const configuredRpc = input.environment
        .PROGRAMMABLE_CUSTOM_REGISTRY_READINESS_RPC_URL;
      let runtimeBindings: CustomRegistryRuntimeVerificationV1 = "not-configured";
      if (configuredRpc !== undefined && configuredRpc !== "") {
        await verifyCustomRegistryRuntimeBindingsV1(
          manifest,
          configuredRpc,
          input.rpcFetch,
        );
        runtimeBindings = "verified";
      }
      return Response.json({
        schemaVersion: "programmable.custom-registry-readiness.v1",
        status: "ready",
        registryStatus: "live",
        chainId: "1",
        generation: manifest.generation,
        manifestPath: CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH,
        runtimeBindings,
        checkedAt: input.now().toISOString(),
      }, { status: 200, headers: READINESS_HEADERS });
    } catch {
      return readinessError(
        503,
        "custom_registry_not_ready",
        manifest.status,
        input.now,
      );
    }
  };
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
  registryStatus: CustomRegistryPublicManifestV1["status"],
  now: () => Date,
): Response {
  return Response.json({
    schemaVersion: "programmable.custom-registry-readiness.v1",
    status: "unready",
    registryStatus,
    chainId: "1",
    code,
    manifestPath: CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH,
    runtimeBindings: "not-run",
    checkedAt: now().toISOString(),
  }, { status, headers: READINESS_HEADERS });
}

export function handleProductionCustomRegistryManifestV1(
  request: Request,
): Response {
  return createCustomRegistryManifestHandlerV1(process.env)(request);
}

export function handleProductionCustomRegistryReadinessV1(
  request: Request,
): Promise<Response> {
  return createCustomRegistryReadinessHandlerV1({
    environment: process.env,
    rpcFetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
  })(request);
}
