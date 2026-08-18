import "server-only";

import { createHash } from "node:crypto";

import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "../projection-target/canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "../projection-target/hashing";

export const PRODUCTION_ACTIVATION_WEBSITE_READBACK_PATH_V4 =
  "/.well-known/programmable/activation-readback-v4" as const;
export const PRODUCTION_ACTIVATION_WEBSITE_READBACK_CONFIGURATION_ENV_V4 =
  "PROGRAMMABLE_ACTIVATION_WEBSITE_READBACK_V4_CONFIGURATION_JSON" as const;

const CONFIGURATION_SCHEMA =
  "programmable.production-activation-website-provider-runtime-configuration.v4" as const;
const RESPONSE_SCHEMA =
  "programmable.production-activation-website-provider-readback.v4" as const;
const CONFIGURATION_HASH_DOMAIN =
  "programmable.production-activation-website-provider-runtime-configuration.v4" as const;
const ERROR_SCHEMA =
  "programmable.production-activation-website-provider-readback-error.v4" as const;
const CANONICAL_SERVICE_ORIGIN = "https://programmable.family" as const;
const CANONICAL_ROUTE_HOST = "programmable.family" as const;
const CANONICAL_VERCEL_PROJECT_ID =
  "prj_MM8nbhoztJnz1yhimwc9CVFYhAd7" as const;
const MAXIMUM_CONFIGURATION_BYTES = 65_536;

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const GIT_OID = /^[0-9a-f]{40}$/u;
// Keep the producer's identity grammar byte-for-byte no broader than the
// source-owned consumer's requireId grammar.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const VERCEL_DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{8,128}$/u;
const VERCEL_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

type Environment = Readonly<Record<string, string | undefined>>;

export interface ProductionActivationWebsiteReadbackRuntimeConfigurationV4 {
  readonly schemaVersion: typeof CONFIGURATION_SCHEMA;
  readonly website: Readonly<{
    serviceOrigin: typeof CANONICAL_SERVICE_ORIGIN;
    audience: string;
    targetId: string;
    targetGeneration: string;
    writeContractHash: Sha256Digest;
    providerProjectId: typeof CANONICAL_VERCEL_PROJECT_ID;
    routeHost: typeof CANONICAL_ROUTE_HOST;
  }>;
  readonly deployment: Readonly<{
    websiteCommit: string;
    websiteTree: string;
    websiteParent: string;
  }>;
  readonly genericPublic: Readonly<{
    genericLaunchReadBindingSha256: Sha256Digest;
    genericLaunchReadModelContractSha256: Sha256Digest;
    approvalArtifactVerifierBindingSha256: Sha256Digest;
  }>;
  readonly release: Readonly<{
    approvalServicePackageArtifactHash: Sha256Digest;
  }>;
  readonly configurationSha256: Sha256Digest;
}

type UnsignedRuntimeConfigurationV4 = Omit<
  ProductionActivationWebsiteReadbackRuntimeConfigurationV4,
  "configurationSha256"
>;

/**
 * Public, credential-free producer for the source-owned activation observer.
 *
 * The body is intentionally the consumer's exact ten-field schema. The
 * runtime-only configuration binds that body to the exact Website H/T/P,
 * Vercel project, Generic public configuration and Approval artifact already
 * staged for this deployment. Vercel's system identity supplies the one value
 * that cannot be known before creation: the deployment ID.
 */
export function createProductionActivationWebsiteReadbackHandlerV4(
  environment: Environment,
) {
  return function handleProductionActivationWebsiteReadbackV4(
    request: Request,
  ): Response {
    if (!validRequest(request, environment)) {
      return errorResponse(400, "invalid_request");
    }
    try {
      const configuration = runtimeConfiguration(environment);
      const deploymentId = exact(
        environment.VERCEL_DEPLOYMENT_ID,
        VERCEL_DEPLOYMENT_ID,
        "Vercel deployment ID",
      );
      const body = Object.freeze({
        schemaVersion: RESPONSE_SCHEMA,
        serviceOrigin: configuration.website.serviceOrigin,
        audience: configuration.website.audience,
        targetId: configuration.website.targetId,
        targetGeneration: configuration.website.targetGeneration,
        writeContractHash: configuration.website.writeContractHash,
        providerProjectId: configuration.website.providerProjectId,
        providerDeploymentId: deploymentId,
        providerDeploymentState: "READY" as const,
        routeHost: configuration.website.routeHost,
      });
      return canonicalResponse(200, body);
    } catch {
      return errorResponse(503, "unavailable");
    }
  };
}

export function handleProductionActivationWebsiteReadbackV4(
  request: Request,
): Response {
  return createProductionActivationWebsiteReadbackHandlerV4(process.env)(request);
}

export function productionActivationWebsiteReadbackConfigurationSha256V4(
  value: UnsignedRuntimeConfigurationV4,
): Sha256Digest {
  return canonicalSha256(
    CONFIGURATION_HASH_DOMAIN,
    value as unknown as JsonValue,
  );
}

export function canonicalJsonSha256V4(value: JsonValue): Sha256Digest {
  return `sha256:${createHash("sha256")
    .update(canonicalizeJson(value), "utf8")
    .digest("hex")}`;
}

function runtimeConfiguration(
  environment: Environment,
): ProductionActivationWebsiteReadbackRuntimeConfigurationV4 {
  const source = environment[
    PRODUCTION_ACTIVATION_WEBSITE_READBACK_CONFIGURATION_ENV_V4
  ];
  if (
    typeof source !== "string"
    || source.trim() !== source
    || source.length === 0
    || Buffer.byteLength(source, "utf8") > MAXIMUM_CONFIGURATION_BYTES
  ) {
    throw new TypeError("Activation Website readback configuration is unavailable");
  }
  const configuration = parseRuntimeConfiguration(parseStrictJson(source, {
    maximumBytes: MAXIMUM_CONFIGURATION_BYTES,
    maximumDepth: 8,
  }));
  assertRuntimeIdentity(configuration, environment);
  return configuration;
}

function parseRuntimeConfiguration(
  value: JsonValue,
): ProductionActivationWebsiteReadbackRuntimeConfigurationV4 {
  const input = record(value, "Activation Website readback configuration");
  exactKeys(input, [
    "configurationSha256",
    "deployment",
    "genericPublic",
    "release",
    "schemaVersion",
    "website",
  ], "Activation Website readback configuration");
  if (input.schemaVersion !== CONFIGURATION_SCHEMA) {
    throw new TypeError("Activation Website readback configuration schema is invalid");
  }
  const websiteInput = record(input.website, "Activation Website configuration");
  exactKeys(websiteInput, [
    "audience",
    "providerProjectId",
    "routeHost",
    "serviceOrigin",
    "targetGeneration",
    "targetId",
    "writeContractHash",
  ], "Activation Website configuration");
  const deploymentInput = record(
    input.deployment,
    "Activation Website deployment",
  );
  exactKeys(deploymentInput, [
    "websiteCommit",
    "websiteParent",
    "websiteTree",
  ], "Activation Website deployment");
  const genericInput = record(
    input.genericPublic,
    "Activation Website Generic public identity",
  );
  exactKeys(genericInput, [
    "approvalArtifactVerifierBindingSha256",
    "genericLaunchReadBindingSha256",
    "genericLaunchReadModelContractSha256",
  ], "Activation Website Generic public identity");
  const releaseInput = record(input.release, "Activation Website release identity");
  exactKeys(releaseInput, [
    "approvalServicePackageArtifactHash",
  ], "Activation Website release identity");

  const unsigned = Object.freeze({
    schemaVersion: CONFIGURATION_SCHEMA,
    website: Object.freeze({
      serviceOrigin: exactLiteral(
        websiteInput.serviceOrigin,
        CANONICAL_SERVICE_ORIGIN,
        "Website service origin",
      ),
      audience: exact(websiteInput.audience, SAFE_ID, "Website audience"),
      targetId: exact(websiteInput.targetId, SAFE_ID, "Website target ID"),
      targetGeneration: exact(
        websiteInput.targetGeneration,
        SAFE_ID,
        "Website target generation",
      ),
      writeContractHash: digest(
        websiteInput.writeContractHash,
        "Website write contract",
      ),
      providerProjectId: exactLiteral(
        websiteInput.providerProjectId,
        CANONICAL_VERCEL_PROJECT_ID,
        "Website Vercel project",
      ),
      routeHost: exactLiteral(
        websiteInput.routeHost,
        CANONICAL_ROUTE_HOST,
        "Website route host",
      ),
    }),
    deployment: Object.freeze({
      websiteCommit: exact(
        deploymentInput.websiteCommit,
        GIT_OID,
        "Website commit",
      ),
      websiteTree: exact(deploymentInput.websiteTree, GIT_OID, "Website tree"),
      websiteParent: exact(
        deploymentInput.websiteParent,
        GIT_OID,
        "Website parent",
      ),
    }),
    genericPublic: Object.freeze({
      genericLaunchReadBindingSha256: digest(
        genericInput.genericLaunchReadBindingSha256,
        "Generic launch read binding",
      ),
      genericLaunchReadModelContractSha256: digest(
        genericInput.genericLaunchReadModelContractSha256,
        "Generic launch read-model contract",
      ),
      approvalArtifactVerifierBindingSha256: digest(
        genericInput.approvalArtifactVerifierBindingSha256,
        "Approval artifact verifier binding",
      ),
    }),
    release: Object.freeze({
      approvalServicePackageArtifactHash: digest(
        releaseInput.approvalServicePackageArtifactHash,
        "Approval service package artifact",
      ),
    }),
  }) satisfies UnsignedRuntimeConfigurationV4;
  const configurationSha256 = digest(
    input.configurationSha256,
    "Activation Website readback configuration",
  );
  if (
    configurationSha256
    !== productionActivationWebsiteReadbackConfigurationSha256V4(unsigned)
  ) {
    throw new TypeError("Activation Website readback configuration differs");
  }
  return Object.freeze({ ...unsigned, configurationSha256 });
}

function assertRuntimeIdentity(
  configuration: ProductionActivationWebsiteReadbackRuntimeConfigurationV4,
  environment: Environment,
): void {
  if (
    environment.VERCEL_ENV !== "production"
    || environment.VERCEL_TARGET_ENV !== "production"
    || environment.VERCEL_PROJECT_ID !== configuration.website.providerProjectId
    || environment.VERCEL_GIT_COMMIT_SHA
      !== configuration.deployment.websiteCommit
    || environment.PROGRAMMABLE_RELEASE_COMMIT_SHA
      !== configuration.deployment.websiteCommit
    || environment.PROGRAMMABLE_WEBSITE_PROJECTION_AUDIENCE
      !== configuration.website.audience
    || environment.PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH
      !== configuration.release.approvalServicePackageArtifactHash
  ) {
    throw new TypeError("Activation Website runtime identity differs");
  }
  const genericInputs = Object.freeze({
    genericLaunchReadBindingSha256: configurationDigest(
      environment,
      "PROGRAMMABLE_GENERIC_LAUNCH_READ_BINDING_V2_JSON",
    ),
    genericLaunchReadModelContractSha256: configurationDigest(
      environment,
      "PROGRAMMABLE_GENERIC_LAUNCH_READ_MODEL_CONTRACT_V2_JSON",
    ),
    approvalArtifactVerifierBindingSha256: configurationDigest(
      environment,
      "PROGRAMMABLE_APPROVAL_V3_ARTIFACT_VERIFIER_BINDING_JSON",
    ),
  });
  if (
    canonicalizeJson(genericInputs)
    !== canonicalizeJson(configuration.genericPublic)
  ) {
    throw new TypeError("Activation Website Generic public identity differs");
  }
}

function configurationDigest(environment: Environment, name: string): Sha256Digest {
  const source = environment[name];
  if (
    typeof source !== "string"
    || source.trim() !== source
    || source.length === 0
    || Buffer.byteLength(source, "utf8") > MAXIMUM_CONFIGURATION_BYTES
  ) {
    throw new TypeError(`${name} is unavailable`);
  }
  return canonicalJsonSha256V4(parseStrictJson(source, {
    maximumBytes: MAXIMUM_CONFIGURATION_BYTES,
    maximumDepth: 64,
  }));
}

function validRequest(request: Request, environment: Environment): boolean {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  const deploymentHost = environment.VERCEL_URL;
  return request.method === "GET"
    && request.body === null
    && url.protocol === "https:"
    && url.username === ""
    && url.password === ""
    && url.pathname === PRODUCTION_ACTIVATION_WEBSITE_READBACK_PATH_V4
    && url.search === ""
    && url.hash === ""
    && typeof deploymentHost === "string"
    && VERCEL_HOST.test(deploymentHost)
    && (url.host === CANONICAL_ROUTE_HOST || url.host === deploymentHost);
}

function canonicalResponse(status: number, body: JsonValue): Response {
  return new Response(`${canonicalizeJson(body)}\n`, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
    },
  });
}

function errorResponse(status: number, code: "invalid_request" | "unavailable") {
  return canonicalResponse(status, Object.freeze({
    schemaVersion: ERROR_SCHEMA,
    code,
  }));
}

function record(value: JsonValue, label: string): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Record<string, JsonValue>;
}

function exactKeys(
  value: Record<string, JsonValue>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value).sort();
  if (keys.join("\n") !== [...expected].sort().join("\n")) {
    throw new TypeError(`${label} fields differ`);
  }
}

function exact<T extends string>(
  value: JsonValue | undefined,
  pattern: RegExp,
  label: string,
): T {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as T;
}

function exactLiteral<T extends string>(
  value: JsonValue | undefined,
  expected: T,
  label: string,
): T {
  if (value !== expected) throw new TypeError(`${label} differs`);
  return expected;
}

function digest(
  value: JsonValue | undefined,
  label: string,
): Sha256Digest {
  return exact<Sha256Digest>(value, DIGEST, label);
}
