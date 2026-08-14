import "server-only";

import { createHash, createPublicKey, timingSafeEqual } from "node:crypto";

import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "../projection-target/canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "../projection-target/hashing";
import {
  createProductionGenericLaunchReadProbeSignerV1,
  type GenericLaunchReadProbeSignerV1,
} from "./generic-launch-read-signer-v2";
import { parseGenericLaunchReadBindingV2 } from "./generic-launch-read-v2";

export const GENERIC_LAUNCH_READ_STAGE_PROBE_PATH_V1 =
  "/api/ops/custom-launch/generic-v2-signer-probe" as const;
export const GENERIC_LAUNCH_READ_STAGE_PROBE_SECRET_ENV_V1 =
  "PROGRAMMABLE_GENERIC_LAUNCH_SIGNER_PROBE_TOKEN" as const;
export const GENERIC_LAUNCH_READ_STAGE_PROBE_EXPECTED_ENV_V1 =
  "PROGRAMMABLE_GENERIC_LAUNCH_SIGNER_PROBE_EXPECTED_V1_JSON" as const;
export const GENERIC_LAUNCH_READ_STAGE_PROBE_REQUEST_SCHEMA_V1 =
  "programmable.website-generic-launch-read-stage-probe-request.v1" as const;
export const GENERIC_LAUNCH_READ_STAGE_PROBE_RECEIPT_SCHEMA_V1 =
  "programmable.website-generic-launch-read-stage-probe-receipt.v1" as const;

const MAXIMUM_BODY_BYTES = 4_096;
const MAXIMUM_CONFIGURATION_BYTES = 65_536;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const GIT_OID = /^[0-9a-f]{40}$/u;
const OPERATION_ID = /^[0-9a-f]{32}$/u;
const FLY_MACHINE_ID = /^[0-9a-f]{14}$/u;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{20,80}$/u;
const VERCEL_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;
const VERCEL_PROJECT_ID = /^prj_[A-Za-z0-9]{20,80}$/u;

export type GenericLaunchReadStageProbeRequestV1 = Readonly<{
  schemaVersion: typeof GENERIC_LAUNCH_READ_STAGE_PROBE_REQUEST_SCHEMA_V1;
  operationId: string;
  nonceSha256: Sha256Digest;
  sourceCommit: string;
  sourceTree: string;
  genericImageDigest: Sha256Digest;
  genericBindingSha256: Sha256Digest;
  genericSignRequestSha256: Sha256Digest;
  targetMachineId: string;
}>;

type Dependencies = Readonly<{
  environment?: Readonly<Record<string, string | undefined>>;
  createProbeSigner?: typeof createProductionGenericLaunchReadProbeSignerV1;
}>;

export async function handleProductionGenericLaunchReadStageProbeV1(
  request: Request,
  dependencies: Dependencies = {},
): Promise<Response> {
  const environment = dependencies.environment ?? process.env;
  const expectedSecret = environment[
    GENERIC_LAUNCH_READ_STAGE_PROBE_SECRET_ENV_V1
  ];
  if (!validSecret(expectedSecret)) {
    return response(503, "probe_unavailable");
  }
  if (!authorized(request.headers, expectedSecret)) {
    return response(401, "unauthorized");
  }
  const url = new URL(request.url);
  if (request.method !== "POST" || url.search !== "") {
    return response(400, "invalid_request");
  }
  let input: GenericLaunchReadStageProbeRequestV1;
  try {
    const source = await request.text();
    if (Buffer.byteLength(source, "utf8") > MAXIMUM_BODY_BYTES) {
      throw new TypeError("probe request is too large");
    }
    input = parseGenericLaunchReadStageProbeRequestV1(parseStrictJson(source, {
      maximumBytes: MAXIMUM_BODY_BYTES,
      maximumDepth: 3,
    }));
  } catch {
    return response(400, "invalid_request");
  }
  try {
    const expected = parseExpectedProbe(configuration(
      environment,
      GENERIC_LAUNCH_READ_STAGE_PROBE_EXPECTED_ENV_V1,
    ));
    assertExpectedProbe(input, expected);
    const deployment = productionDeployment(url, environment);
    const activeReadBinding = parseGenericLaunchReadBindingV2(configuration(
      environment,
      "PROGRAMMABLE_GENERIC_LAUNCH_READ_BINDING_V2_JSON",
    ));
    const signer = await (
      dependencies.createProbeSigner
      ?? createProductionGenericLaunchReadProbeSignerV1
    )({ activeReadBinding, environment });
    if (rawSha256(canonicalizeJson(
      signer.binding as unknown as JsonValue,
    )) !== input.genericBindingSha256) {
      throw new TypeError("Generic signer binding digest differs");
    }
    if (signer.workloadIdentity.projectId !== deployment.projectId) {
      throw new TypeError("Vercel deployment and workload identity differ");
    }
    const payload = Object.freeze({
      schemaVersion:
        "programmable.website-generic-launch-read-stage-probe-payload.v1" as const,
      request: input,
      workloadIdentity: signer.workloadIdentity,
      deployment,
    });
    const requestBindingHash = canonicalSha256(
      "programmable.website-generic-launch-read-stage-probe-binding.v1",
      payload as unknown as JsonValue,
    );
    const evidence = await signer.signWithEvidence({
      requestBindingHash,
      payload: payload as unknown as JsonValue,
      targetMachineId: input.targetMachineId,
      signal: request.signal,
    });
    const providerResponseSha256 = rawSha256(canonicalizeJson(
      evidence.providerResponse as unknown as JsonValue,
    ));
    const receipt = evidence.providerResponse.providerReceipt;
    return Response.json({
      schemaVersion: GENERIC_LAUNCH_READ_STAGE_PROBE_RECEIPT_SCHEMA_V1,
      status: "verified",
      operationId: input.operationId,
      nonceSha256: input.nonceSha256,
      sourceCommit: input.sourceCommit,
      sourceTree: input.sourceTree,
      genericImageDigest: input.genericImageDigest,
      genericBindingSha256: input.genericBindingSha256,
      genericSignRequestSha256: input.genericSignRequestSha256,
      targetMachineId: input.targetMachineId,
      deployment,
      workloadIdentity: signer.workloadIdentity,
      signerBinding: publicSignerBinding(signer),
      activationBindingHash: evidence.signedEnvelope.activationBindingHash,
      readModelBindingHash: evidence.signedEnvelope.readModelBindingHash,
      requestBindingHash,
      signedEnvelope: evidence.signedEnvelope,
      providerResponse: evidence.providerResponse,
      providerResponseSha256,
      observedAt: receipt.observedAt,
      expiresAt: receipt.expiresAt,
    }, { status: 200, headers: headers() });
  } catch {
    return response(503, "probe_unavailable");
  }
}

function parseExpectedProbe(value: unknown) {
  const expected = record(value, "expected Generic launch read stage probe");
  exactKeys(expected, [
    "genericBindingSha256", "genericImageDigest", "genericSignRequestSha256",
    "machineIds", "nonceSha256", "operationId", "schemaVersion",
    "sourceCommit", "sourceTree",
  ], "expected Generic launch read stage probe");
  if (expected.schemaVersion
    !== "programmable.website-generic-launch-read-stage-probe-expected.v1"
    || !Array.isArray(expected.machineIds)
    || expected.machineIds.length !== 2) {
    throw new TypeError("expected Generic launch read stage probe is invalid");
  }
  const machineIds = expected.machineIds.map((machineId) => exact<string>(
    machineId,
    FLY_MACHINE_ID,
    "expected Generic Machine ID",
  ));
  if (machineIds[0] === machineIds[1]
    || machineIds.join("\n") !== [...machineIds].sort().join("\n")) {
    throw new TypeError("expected Generic Machine IDs are not exact");
  }
  return Object.freeze({
    schemaVersion:
      "programmable.website-generic-launch-read-stage-probe-expected.v1" as const,
    operationId: exact<string>(
      expected.operationId,
      OPERATION_ID,
      "expected probe operation ID",
    ),
    nonceSha256: digest(expected.nonceSha256, "expected probe nonce"),
    sourceCommit: exact<string>(
      expected.sourceCommit,
      GIT_OID,
      "expected Generic source commit",
    ),
    sourceTree: exact<string>(
      expected.sourceTree,
      GIT_OID,
      "expected Generic source tree",
    ),
    genericImageDigest: digest(
      expected.genericImageDigest,
      "expected Generic image digest",
    ),
    genericBindingSha256: digest(
      expected.genericBindingSha256,
      "expected Generic binding digest",
    ),
    genericSignRequestSha256: digest(
      expected.genericSignRequestSha256,
      "expected Generic sign request digest",
    ),
    machineIds: Object.freeze(machineIds),
  });
}

function assertExpectedProbe(
  input: GenericLaunchReadStageProbeRequestV1,
  expected: ReturnType<typeof parseExpectedProbe>,
): void {
  for (const field of [
    "operationId", "nonceSha256", "sourceCommit", "sourceTree",
    "genericImageDigest", "genericBindingSha256", "genericSignRequestSha256",
  ] as const) {
    if (input[field] !== expected[field]) {
      throw new TypeError(`Generic stage probe ${field} differs`);
    }
  }
  if (!expected.machineIds.includes(input.targetMachineId)) {
    throw new TypeError("Generic stage probe target Machine differs");
  }
}

export function parseGenericLaunchReadStageProbeRequestV1(
  value: unknown,
): GenericLaunchReadStageProbeRequestV1 {
  const input = record(value, "Generic launch read stage probe request");
  exactKeys(input, [
    "genericBindingSha256", "genericImageDigest", "genericSignRequestSha256",
    "nonceSha256", "operationId", "schemaVersion", "sourceCommit",
    "sourceTree", "targetMachineId",
  ], "Generic launch read stage probe request");
  if (input.schemaVersion !== GENERIC_LAUNCH_READ_STAGE_PROBE_REQUEST_SCHEMA_V1) {
    throw new TypeError("Generic launch read stage probe schema is invalid");
  }
  return Object.freeze({
    schemaVersion: GENERIC_LAUNCH_READ_STAGE_PROBE_REQUEST_SCHEMA_V1,
    operationId: exact(input.operationId, OPERATION_ID, "probe operation ID"),
    nonceSha256: digest(input.nonceSha256, "probe nonce"),
    sourceCommit: exact(input.sourceCommit, GIT_OID, "Generic source commit"),
    sourceTree: exact(input.sourceTree, GIT_OID, "Generic source tree"),
    genericImageDigest: digest(input.genericImageDigest, "Generic image digest"),
    genericBindingSha256: digest(input.genericBindingSha256, "Generic binding digest"),
    genericSignRequestSha256: digest(
      input.genericSignRequestSha256,
      "Generic sign request digest",
    ),
    targetMachineId: exact(
      input.targetMachineId,
      FLY_MACHINE_ID,
      "Generic target Machine ID",
    ),
  });
}

function productionDeployment(
  requestUrl: URL,
  environment: Readonly<Record<string, string | undefined>>,
) {
  const host = exact(environment.VERCEL_URL, VERCEL_HOST, "Vercel deployment host");
  const deploymentId = exact(
    environment.VERCEL_DEPLOYMENT_ID,
    DEPLOYMENT_ID,
    "Vercel deployment ID",
  );
  const projectId = exact(
    environment.VERCEL_PROJECT_ID,
    VERCEL_PROJECT_ID,
    "Vercel project ID",
  );
  const gitCommitSha = exact(
    environment.VERCEL_GIT_COMMIT_SHA,
    GIT_OID,
    "Website Git commit",
  );
  if (environment.VERCEL_TARGET_ENV !== "production"
    || requestUrl.protocol !== "https:"
    || requestUrl.username !== "" || requestUrl.password !== ""
    || requestUrl.host !== host
    || requestUrl.pathname !== GENERIC_LAUNCH_READ_STAGE_PROBE_PATH_V1) {
    throw new TypeError("Generic launch signer probe is not on exact stage");
  }
  return Object.freeze({
    schemaVersion:
      "programmable.website-generic-launch-read-stage-probe-deployment.v1" as const,
    deploymentId,
    origin: `https://${host}`,
    projectId,
    targetEnvironment: "production" as const,
    gitCommitSha,
  });
}

function publicSignerBinding(signer: GenericLaunchReadProbeSignerV1) {
  const binding = signer.binding;
  const publicKey = createPublicKey({
    key: Buffer.from(binding.publicKeySpkiBase64Url, "base64url"),
    format: "der",
    type: "spki",
  });
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("Generic launch read probe public key is invalid");
  }
  return Object.freeze({
    schemaVersion:
      "programmable.website-generic-launch-read-stage-probe-signer.v1" as const,
    endpoint: binding.endpoint,
    audience: binding.audience,
    keyId: binding.keyId,
    keyEpoch: binding.keyEpoch,
    providerIdentityHash: binding.providerIdentityHash,
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    publicKeySpkiBase64Url: binding.publicKeySpkiBase64Url,
    publicKeySpkiSha256: binding.publicKeySpkiSha256,
  });
}

function configuration(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): unknown {
  const source = environment[name]?.trim();
  if (!source || Buffer.byteLength(source, "utf8") > MAXIMUM_CONFIGURATION_BYTES) {
    throw new TypeError(`${name} is not configured`);
  }
  return parseStrictJson(source, {
    maximumBytes: MAXIMUM_CONFIGURATION_BYTES,
    maximumDepth: 64,
  });
}

function authorized(headersValue: Headers, expectedValue: string): boolean {
  const authorization = headersValue.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const expected = Buffer.from(expectedValue, "utf8");
  const actual = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function validSecret(value: unknown): value is string {
  return typeof value === "string"
    && Buffer.byteLength(value, "utf8") >= 32
    && Buffer.byteLength(value, "utf8") <= 1_024
    && !/[\r\n]/u.test(value);
}

function response(status: number, code: string): Response {
  return Response.json({
    schemaVersion: "programmable.generic-launch-signer-probe-error.v1",
    status: "error",
    code,
  }, { status, headers: headers() });
}

function headers(): HeadersInit {
  return {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  };
}

function exact<T extends string>(
  value: unknown,
  pattern: RegExp,
  label: string,
): T {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as T;
}

function digest(value: unknown, label: string): Sha256Digest {
  return exact<Sha256Digest>(value, DIGEST, label);
}

function rawSha256(value: string): Sha256Digest {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
}
