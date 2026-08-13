import "server-only";

import deploymentSource from
  "@/config/custom-registry-v2.deployment.prelaunch.json";
import { parseStrictJson } from "../projection-target/canonical-json";
import { canonicalSha256 } from "../projection-target/hashing";
import { getProductionApprovalV3ProjectionPoolV1 } from
  "../projection-target/approval-v3-target";
import { productionMainnetRpcPair } from
  "../../onchain/website-rpc-providers.server";
import {
  assertCustomRegistryV2DeploymentReadiness,
  resolveCustomRegistryPublicManifestV2,
} from "./registry-manifest-v2";
import {
  createApprovalArtifactVerifierV3,
  createGenericLaunchProjectorV2,
  type ApprovalArtifactVerifierBindingV3,
} from "./generic-launch-projector-v2";
import { createDualRpcGenericLaunchRegistryReaderV2 } from
  "./generic-launch-registry-reader-v2";
import {
  assertPostgresGenericLaunchReadStoreReadyV2,
  createPostgresGenericLaunchMaterializationStoreV2,
  createPostgresGenericLaunchReadStoreV2,
} from "./generic-launch-postgres-v2";
import {
  createGenericLaunchReadHandlersV2,
  parseGenericLaunchReadBindingV2,
  type GenericLaunchReadModelContractV2,
} from "./generic-launch-read-v2";
import { createProductionGenericLaunchReadSignerV2 } from
  "./generic-launch-read-signer-v2";

const MAXIMUM_CONFIGURATION_BYTES = 65_536;
const HASH32 = /^0x[0-9a-f]{64}$/u;

export async function projectProductionGenericLaunchV2(input: Readonly<{
  approvalId: `0x${string}`;
  signal?: AbortSignal;
}>) {
  const manifest = resolveCustomRegistryPublicManifestV2();
  if (manifest.status !== "live") {
    throw new TypeError("Custom Registry V2 is not live");
  }
  const readModelContract = productionReadModelContract();
  const readModelBindingHash = canonicalSha256(
    readModelContract.schemaVersion,
    readModelContract,
  );
  const pool = getProductionApprovalV3ProjectionPoolV1();
  await pool.assertProductionReadiness();
  const pair = productionMainnetRpcPair();
  await assertCustomRegistryV2DeploymentReadiness({
    deploymentSource,
    rpcUrls: [new URL(pair.primary.url), new URL(pair.secondary.url)],
    rpcFetch: globalThis.fetch.bind(globalThis),
  });
  const projector = createGenericLaunchProjectorV2({
    store: createPostgresGenericLaunchMaterializationStoreV2(pool),
    verifyApprovalArtifact: createApprovalArtifactVerifierV3(
      productionApprovalVerifierBinding(),
    ),
    readRegistryLifecycle: createDualRpcGenericLaunchRegistryReaderV2({
      release: {
        registryAddress: manifest.registry.address,
        registryRuntimeCodeKeccak256: manifest.registry.runtimeCodeKeccak256,
        registryPolicyCommitment: manifest.finality.policyBindingHash,
        deploymentBlock: manifest.registry.deploymentBlock,
        minimumFinalityBlocks: manifest.finality.minimumConfirmations,
      },
      rpcUrls: [pair.primary.url, pair.secondary.url],
    }),
    readModelBindingHash,
  });
  return await projector.project(input);
}

export async function handleProductionGenericLaunchFeedV2(
  request: Request,
): Promise<Response> {
  try {
    return await (await productionReadHandlers()).feed(request);
  } catch {
    return unavailable("generic_launch_v2_not_active");
  }
}

export async function handleProductionGenericLaunchDetailV2(
  request: Request,
  recordHash: string,
): Promise<Response> {
  try {
    return await (await productionReadHandlers()).detail(request, recordHash);
  } catch {
    return unavailable("generic_launch_v2_not_active");
  }
}

export async function handleProductionGenericLaunchReadinessV2(
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.search !== "" || request.body !== null) {
    return Response.json({
      schemaVersion: "programmable.generic-launch-readiness.v2",
      status: "unready",
      code: "invalid_request",
    }, { status: 400, headers: readinessHeaders() });
  }
  try {
    const feed = await handleProductionGenericLaunchFeedV2(new Request(
      `${url.origin}/api/custom-launch/generic/v2/launches?limit=1`,
      { headers: { accept: "application/json" } },
    ));
    const payload = await feed.json() as Readonly<{
      schemaVersion?: unknown;
      records?: unknown;
    }>;
    if (feed.status !== 200
      || payload.schemaVersion !== "programmable.generic-launch-feed.v2"
      || !Array.isArray(payload.records) || payload.records.length < 1) {
      throw new TypeError("Generic launch feed is not materialized");
    }
    return Response.json({
      schemaVersion: "programmable.generic-launch-readiness.v2",
      status: "ready",
      generation: "2",
      chainId: "1",
      feedPath: "/api/custom-launch/generic/v2/launches",
      detailPathTemplate:
        "/api/custom-launch/generic/v2/launches/{recordHash}",
      checkedAt: new Date().toISOString(),
    }, { status: 200, headers: readinessHeaders() });
  } catch {
    return Response.json({
      schemaVersion: "programmable.generic-launch-readiness.v2",
      status: "unready",
      code: "generic_launch_v2_not_active",
      checkedAt: new Date().toISOString(),
    }, { status: 503, headers: readinessHeaders() });
  }
}

async function productionReadHandlers() {
  const binding = parseGenericLaunchReadBindingV2(
    configuration("PROGRAMMABLE_GENERIC_LAUNCH_READ_BINDING_V2_JSON"),
  );
  const manifest = resolveCustomRegistryPublicManifestV2();
  if (manifest.status !== "live"
    || binding.registryIdentity.registryAddress !== manifest.registry.address
    || binding.registryIdentity.registryRuntimeCodeKeccak256
      !== manifest.registry.runtimeCodeKeccak256
    || binding.registryIdentity.registryPolicyCommitment
      !== manifest.finality.policyBindingHash
    || binding.registryIdentity.minimumFinalityBlocks
      !== manifest.finality.minimumConfirmations) {
    throw new TypeError("Generic launch read binding is not the live Registry");
  }
  const readModelContract = productionReadModelContract();
  const signer = await createProductionGenericLaunchReadSignerV2({
    activeReadBinding: binding,
  });
  const pool = getProductionApprovalV3ProjectionPoolV1();
  await pool.assertProductionReadiness();
  await assertPostgresGenericLaunchReadStoreReadyV2(pool);
  const pair = productionMainnetRpcPair();
  await assertCustomRegistryV2DeploymentReadiness({
    deploymentSource,
    rpcUrls: [new URL(pair.primary.url), new URL(pair.secondary.url)],
    rpcFetch: globalThis.fetch.bind(globalThis),
  });
  return createGenericLaunchReadHandlersV2({
    binding,
    store: createPostgresGenericLaunchReadStoreV2({
      pool,
      signer,
      readModelContract,
    }),
  });
}

function productionReadModelContract(): GenericLaunchReadModelContractV2 {
  return configuration(
    "PROGRAMMABLE_GENERIC_LAUNCH_READ_MODEL_CONTRACT_V2_JSON",
  ) as unknown as GenericLaunchReadModelContractV2;
}

function productionApprovalVerifierBinding(): ApprovalArtifactVerifierBindingV3 {
  return configuration(
    "PROGRAMMABLE_APPROVAL_V3_ARTIFACT_VERIFIER_BINDING_JSON",
  ) as unknown as ApprovalArtifactVerifierBindingV3;
}

function configuration(name: string): unknown {
  const source = process.env[name]?.trim();
  if (!source || Buffer.byteLength(source, "utf8") > MAXIMUM_CONFIGURATION_BYTES) {
    throw new TypeError(`${name} is not configured`);
  }
  return parseStrictJson(source, {
    maximumBytes: MAXIMUM_CONFIGURATION_BYTES,
    maximumDepth: 64,
  });
}

function unavailable(code: string): Response {
  return Response.json({
    schemaVersion: "programmable.custom-launch-error.v1",
    code,
  }, {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function readinessHeaders(): HeadersInit {
  return {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  };
}

export function parseGenericProjectorApprovalId(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !HASH32.test(value)
    || value === `0x${"00".repeat(32)}`) {
    throw new TypeError("Generic launch projector Approval ID is invalid");
  }
  return value as `0x${string}`;
}
