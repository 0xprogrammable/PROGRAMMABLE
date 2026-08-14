import { createHash } from "node:crypto";

import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "./canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "./hashing";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,255}$/u;
const SAFE_PROJECTION_KEY = /^[^\u0000-\u001f\u007f]{1,512}$/u;
const DEFAULT_MAXIMUM_REQUEST_BYTES = 4_194_304;
const DEFAULT_MAXIMUM_DEPTH = 128;
const V1_REGISTRY_ROUTE = "/v1/internal/projections/registry";
const V1_WEBSITE_ROUTE = "/v1/internal/projections/website-entitlements";
const V2_WEBSITE_ROUTE = "/v2/internal/projections/custom-launches";
const V2_APPROVAL_V3_ROUTE = "/v2/internal/projections/approval-descriptors";
const HASH32 = /^0x[0-9a-f]{64}$/u;

export type ProjectionTargetLaneV1 =
  | "registry.publication"
  | "website.entitlement"
  | "registry.custom-launched"
  | "website.custom-launched"
  | "website.approval-v3";

export const PROJECTION_TARGET_REFERENCE_CONTRACT_V1 = Object.freeze({
  schemaVersion: "programmable.projection-target-reference-contract.v1",
  routes: Object.freeze({
    "registry.publication": `${V1_REGISTRY_ROUTE}/{projectionKey}`,
    "website.entitlement": `${V1_WEBSITE_ROUTE}/{projectionKey}`,
    "registry.custom-launched": "{configuredRegistryEndpointPath}/v2/custom-launches/{projectionKey}",
    "website.custom-launched": `${V2_WEBSITE_ROUTE}/{projectionKey}`,
    "website.approval-v3": `${V2_APPROVAL_V3_ROUTE}/{projectionKey}`,
  }),
  methods: Object.freeze(["GET", "PUT"] as const),
  createdStatus: 201,
  exactReplayStatus: 200,
  readStatus: 200,
  absentStatus: 404,
  conflictStatus: 409,
  requestBodyEncoding: "canonical-json-utf8",
  authority: "projection-only-never-launch-approval",
} as const);

export interface ProjectionTargetLaneConfigurationV1 {
  readonly lane: ProjectionTargetLaneV1;
  readonly targetBindingHash: Sha256Digest;
  readonly audience: string;
}

export interface ProjectionTargetCredentialVerificationRequestV1 {
  readonly bearerToken: string;
  readonly lane: ProjectionTargetLaneV1;
  readonly audience: string;
  readonly targetBindingHash: Sha256Digest;
  readonly method: "GET" | "PUT";
  readonly projectionKey: string;
  readonly idempotencyKey: Sha256Digest | null;
  readonly requestDigest: Sha256Digest | null;
  readonly signal: AbortSignal;
}

export interface ProjectionTargetCredentialPreflightRequestV2 {
  readonly bearerToken: string;
  readonly lane: ProjectionTargetLaneV1;
  readonly audience: string;
  readonly targetBindingHash: Sha256Digest;
  readonly method: "PUT";
  readonly projectionKey: string;
  readonly idempotencyKey: Sha256Digest;
  readonly signal: AbortSignal;
}

export interface ProjectionTargetCredentialClaimsV1 {
  readonly schemaVersion: "programmable.projection-target-credential-claims.v2";
  readonly principalId: string;
  readonly credentialId: string;
  readonly credentialTokenHash: Sha256Digest;
  readonly method: "GET" | "PUT";
  readonly lane: ProjectionTargetLaneV1;
  readonly audience: string;
  readonly targetBindingHash: Sha256Digest;
  readonly projectionKey: string;
  readonly idempotencyKey: Sha256Digest | null;
  readonly requestDigest: Sha256Digest | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface ProjectionTargetCredentialUseV2 {
  readonly schemaVersion: "programmable.projection-target-credential-use.v2";
  readonly credentialId: string;
  readonly requestBindingHash: Sha256Digest;
  readonly canonicalUse: string;
}

export type ProjectionTargetCredentialUseResultV2 =
  | Readonly<{ kind: "created" }>
  | Readonly<{ kind: "existing" }>
  | Readonly<{ kind: "conflict" }>;

interface AuthenticatedCredentialEntryV1 {
  readonly claims: Readonly<ProjectionTargetCredentialClaimsV1>;
  readonly verifier: ProjectionTargetCredentialVerifierV1;
}

const AUTHENTICATED_CREDENTIALS = new WeakMap<
  AuthenticatedProjectionTargetCredentialV1,
  Readonly<AuthenticatedCredentialEntryV1>
>();
const AUTHENTICATED_CREDENTIAL_MINT = Symbol("authenticated-projection-target-credential-v1");

/** Opaque credential capability. A request cannot authenticate with a caller-supplied Boolean. */
class AuthenticatedProjectionTargetCredentialV1 {
  constructor(
    token: typeof AUTHENTICATED_CREDENTIAL_MINT,
    entry: Readonly<AuthenticatedCredentialEntryV1>,
  ) {
    if (token !== AUTHENTICATED_CREDENTIAL_MINT) {
      throw new TypeError("projection target credential mint is private");
    }
    AUTHENTICATED_CREDENTIALS.set(this, entry);
    Object.freeze(this);
  }
}

interface CredentialVerifierEntryV1 {
  readonly verifierBindingHash: Sha256Digest;
  readonly preflightBearer: (
    input: ProjectionTargetCredentialPreflightRequestV2,
  ) => Promise<boolean>;
  readonly verifyBearer: (
    input: ProjectionTargetCredentialVerificationRequestV1,
  ) => Promise<ProjectionTargetCredentialClaimsV1 | null>;
  readonly now: () => Date;
}

const CREDENTIAL_VERIFIERS = new WeakMap<
  ProjectionTargetCredentialVerifierV1,
  Readonly<CredentialVerifierEntryV1>
>();
const CREDENTIAL_VERIFIER_BRAND: unique symbol = Symbol("projection-target-credential-verifier-v1");

/**
 * Opaque verifier handle. It deliberately exposes no authenticate or mint
 * method; only the module-private target handler can consume it.
 */
export interface ProjectionTargetCredentialVerifierV1 {
  readonly [CREDENTIAL_VERIFIER_BRAND]: true;
}

export function createProjectionTargetCredentialVerifierV1(input: Readonly<{
  verifierBindingHash: Sha256Digest;
  preflightBearer(
    request: ProjectionTargetCredentialPreflightRequestV2,
  ): Promise<boolean>;
  verifyBearer(
    request: ProjectionTargetCredentialVerificationRequestV1,
  ): Promise<ProjectionTargetCredentialClaimsV1 | null>;
  now?: () => Date;
}>): ProjectionTargetCredentialVerifierV1 {
  const verifierBindingHash = digest(input.verifierBindingHash, "credential verifier binding");
  if (
    typeof input.preflightBearer !== "function"
    || typeof input.verifyBearer !== "function"
  ) {
    throw new TypeError("projection target credential verifier is invalid");
  }
  if (input.now !== undefined && typeof input.now !== "function") {
    throw new TypeError("projection target credential verifier clock is invalid");
  }
  const verifier = Object.freeze({
    [CREDENTIAL_VERIFIER_BRAND]: true as const,
  });
  CREDENTIAL_VERIFIERS.set(verifier, Object.freeze({
    verifierBindingHash,
    preflightBearer: input.preflightBearer,
    verifyBearer: input.verifyBearer,
    now: input.now ?? (() => new Date()),
  }));
  return verifier;
}

export function resolveProjectionTargetCredentialVerifierBindingV1(
  value: unknown,
): Sha256Digest | null {
  if (value === null || typeof value !== "object") return null;
  return CREDENTIAL_VERIFIERS.get(value as ProjectionTargetCredentialVerifierV1)
    ?.verifierBindingHash ?? null;
}

export interface ProjectionTargetStoredRecordV1 {
  readonly schemaVersion: "programmable.projection-target-stored-record.v1";
  readonly lane: ProjectionTargetLaneV1;
  readonly targetBindingHash: Sha256Digest;
  readonly audience: string;
  readonly projectionKey: string;
  readonly idempotencyKey: Sha256Digest;
  readonly requestDigest: Sha256Digest;
  readonly canonicalWrite: string;
  readonly canonicalAcknowledgement: string;
  readonly canonicalReadback: string;
  readonly recordBindingHash: Sha256Digest;
}

export type ProjectionTargetAtomicPutResultV1 =
  | Readonly<{ kind: "created"; record: ProjectionTargetStoredRecordV1 }>
  | Readonly<{ kind: "existing"; record: ProjectionTargetStoredRecordV1 }>
  | Readonly<{ kind: "conflict" }>;

/**
 * Target-owned atomic persistence boundary. Implementations must update the
 * lane/key and idempotency-key indexes in one transaction.
 */
export interface ProjectionTargetAtomicStoreV1 {
  claimCredentialUseIfAbsentOrExact(input: Readonly<{
    use: ProjectionTargetCredentialUseV2;
    signal: AbortSignal;
  }>): Promise<ProjectionTargetCredentialUseResultV2>;
  putIfAbsentOrExact(input: Readonly<{
    record: ProjectionTargetStoredRecordV1;
    signal: AbortSignal;
  }>): Promise<ProjectionTargetAtomicPutResultV1>;
  get(input: Readonly<{
    lane: ProjectionTargetLaneV1;
    projectionKey: string;
    signal: AbortSignal;
  }>): Promise<ProjectionTargetStoredRecordV1 | null>;
}

/** Deterministic conformance store. Production targets replace this with one atomic durable adapter. */
export function createInMemoryProjectionTargetAtomicStoreV1(): ProjectionTargetAtomicStoreV1 {
  const byIdentity = new Map<string, ProjectionTargetStoredRecordV1>();
  const byIdempotency = new Map<Sha256Digest, ProjectionTargetStoredRecordV1>();
  const credentialUses = new Map<string, ProjectionTargetCredentialUseV2>();
  return Object.freeze({
    async claimCredentialUseIfAbsentOrExact(input: Readonly<{
      use: ProjectionTargetCredentialUseV2;
      signal: AbortSignal;
    }>): Promise<ProjectionTargetCredentialUseResultV2> {
      input.signal.throwIfAborted();
      const existing = credentialUses.get(input.use.credentialId);
      if (existing !== undefined) {
        return Object.freeze({
          kind: existing.requestBindingHash === input.use.requestBindingHash
            && existing.canonicalUse === input.use.canonicalUse
            ? "existing" as const
            : "conflict" as const,
        });
      }
      credentialUses.set(input.use.credentialId, Object.freeze({ ...input.use }));
      return Object.freeze({ kind: "created" as const });
    },
    async putIfAbsentOrExact(input: Readonly<{
      record: ProjectionTargetStoredRecordV1;
      signal: AbortSignal;
    }>): Promise<ProjectionTargetAtomicPutResultV1> {
      input.signal.throwIfAborted();
      const proposed = validateStoredRecord(input.record);
      const identity = identityKey(proposed.lane, proposed.projectionKey);
      const existingIdentity = byIdentity.get(identity);
      const existingIdempotency = byIdempotency.get(proposed.idempotencyKey);
      if (existingIdentity !== undefined || existingIdempotency !== undefined) {
        const existing = existingIdentity ?? existingIdempotency!;
        if (
          existingIdentity !== undefined
          && existingIdempotency !== undefined
          && existingIdentity.recordBindingHash !== existingIdempotency.recordBindingHash
        ) return Object.freeze({ kind: "conflict" as const });
        if (existing.recordBindingHash !== proposed.recordBindingHash) {
          return Object.freeze({ kind: "conflict" as const });
        }
        return Object.freeze({ kind: "existing" as const, record: existing });
      }
      byIdentity.set(identity, proposed);
      byIdempotency.set(proposed.idempotencyKey, proposed);
      return Object.freeze({ kind: "created" as const, record: proposed });
    },
    async get(input: Readonly<{
      lane: ProjectionTargetLaneV1;
      projectionKey: string;
      signal: AbortSignal;
    }>): Promise<ProjectionTargetStoredRecordV1 | null> {
      input.signal.throwIfAborted();
      return byIdentity.get(identityKey(input.lane, input.projectionKey)) ?? null;
    },
  });
}

export interface ProjectionTargetReferenceHandlerV1 {
  readonly contract: typeof PROJECTION_TARGET_REFERENCE_CONTRACT_V1;
  handle(request: Request): Promise<Response>;
}

interface ValidatedLaneV1 extends ProjectionTargetLaneConfigurationV1 {
  readonly routePrefix: string;
}

interface ValidatedHandlerOptionsV1 {
  readonly lanes: ReadonlyMap<ProjectionTargetLaneV1, Readonly<ValidatedLaneV1>>;
  readonly routes: readonly Readonly<ValidatedLaneV1>[];
  readonly credentialVerifier: ProjectionTargetCredentialVerifierV1;
  readonly store: ProjectionTargetAtomicStoreV1;
  readonly validateStoredRecordSemantics: (
    record: ProjectionTargetStoredRecordV1,
  ) => void;
  readonly maximumRequestBytes: number;
  readonly maximumDepth: number;
  readonly now: () => Date;
}

/**
 * Fetch-compatible target handler for Registry and Website repositories.
 * It authenticates and stores exact projections; it has no approval, grant,
 * launch, fee-policy, or onchain authority.
 */
export function createProjectionTargetReferenceHandlerV1(input: Readonly<{
  lanes: readonly ProjectionTargetLaneConfigurationV1[];
  /** Exact pathname of the configured v2 Registry endpoint, without a trailing slash. */
  registryV2EndpointPath?: string;
  credentialVerifier: ProjectionTargetCredentialVerifierV1;
  store: ProjectionTargetAtomicStoreV1;
  validateStoredRecordSemantics?: (
    record: ProjectionTargetStoredRecordV1,
  ) => void;
  maximumRequestBytes?: number;
  maximumDepth?: number;
  now?: () => Date;
}>): ProjectionTargetReferenceHandlerV1 {
  const options = validateHandlerOptions(input);
  return Object.freeze({
    contract: PROJECTION_TARGET_REFERENCE_CONTRACT_V1,
    async handle(request: Request): Promise<Response> {
      try {
        return await handleProjectionRequest(options, request);
      } catch (error) {
        if (error instanceof ProjectionTargetHttpErrorV1) {
          return errorResponse(error.status, error.code, error.allow);
        }
        if (request.signal.aborted) {
          return errorResponse(503, "request_unavailable");
        }
        return errorResponse(503, "target_unavailable");
      }
    },
  });
}

async function handleProjectionRequest(
  options: Readonly<ValidatedHandlerOptionsV1>,
  request: Request,
): Promise<Response> {
  request.signal.throwIfAborted();
  const url = new URL(request.url);
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw httpError(400, "invalid_target_request");
  }
  const route = resolveRoute(options.routes, url.pathname);
  if (route === null) throw httpError(404, "projection_not_found");
  if (request.method !== "GET" && request.method !== "PUT") {
    throw httpError(405, "method_not_allowed", "GET, PUT");
  }
  const method = request.method;
  assertAcceptHeader(request.headers);
  assertRouteHeaders(request.headers, route, method);
  const bearerToken = authorizationBearer(request.headers);

  if (method === "GET") {
    if (request.body !== null || request.headers.has("content-type")
      || request.headers.has("idempotency-key")) {
      throw httpError(400, "invalid_read_request");
    }
    await authenticateAndClaimCredential(options, route, Object.freeze({
      bearerToken,
      lane: route.lane,
      audience: route.audience,
      targetBindingHash: route.targetBindingHash,
      method,
      projectionKey: route.projectionKey,
      idempotencyKey: null,
      requestDigest: null,
      signal: request.signal,
    }));
    let record: ProjectionTargetStoredRecordV1 | null;
    try {
      record = await options.store.get({
        lane: route.lane,
        projectionKey: route.projectionKey,
        signal: request.signal,
      });
    } catch {
      throw httpError(503, "persistence_unavailable");
    }
    if (record === null) throw httpError(404, "projection_not_found");
    const stored = validateStoredRecord(record);
    assertStoredRoute(stored, route);
    return canonicalResponse(200, stored.canonicalReadback);
  }

  assertPutContentType(request.headers);
  let headerIdempotencyKey: Sha256Digest;
  try {
    headerIdempotencyKey = digest(
      request.headers.get("idempotency-key"),
      "projection target idempotency header",
    );
  } catch {
    throw httpError(400, "idempotency_key_invalid");
  }
  try {
    const verifier = resolveCredentialVerifier(options.credentialVerifier);
    const authenticated = await verifier.preflightBearer(Object.freeze({
      bearerToken,
      lane: route.lane,
      audience: route.audience,
      targetBindingHash: route.targetBindingHash,
      method: "PUT" as const,
      projectionKey: route.projectionKey,
      idempotencyKey: headerIdempotencyKey,
      signal: request.signal,
    }));
    if (!authenticated) throw new TypeError("credential preflight rejected");
  } catch {
    throw httpError(401, "credential_rejected");
  }
  const canonicalWrite = await readCanonicalRequestBody(
    request,
    options.maximumRequestBytes,
    options.maximumDepth,
  );
  const write = parseStrictJson(canonicalWrite, {
    maximumBytes: options.maximumRequestBytes,
    maximumDepth: options.maximumDepth,
  });
  let validated: Readonly<ValidatedProjectionWriteV1>;
  try {
    validated = validateProjectionWrite(route, write, headerIdempotencyKey);
  } catch (error) {
    if (error instanceof ProjectionTargetHttpErrorV1) throw error;
    throw httpError(400, "write_contract_mismatch");
  }
  const credentialRequest = Object.freeze({
    bearerToken,
    lane: route.lane,
    audience: route.audience,
    targetBindingHash: route.targetBindingHash,
    method,
    projectionKey: route.projectionKey,
    idempotencyKey: validated.idempotencyKey,
    requestDigest: validated.requestDigest,
    signal: request.signal,
  });
  let credential: AuthenticatedProjectionTargetCredentialV1;
  try {
    credential = await authenticateCredential(
      options.credentialVerifier,
      route,
      credentialRequest,
    );
  } catch {
    throw httpError(401, "credential_rejected");
  }
  const acknowledgedAt = canonicalNow(options.now);
  const responseMaterial = buildResponseMaterial(route, validated, acknowledgedAt);
  const proposed = createStoredRecord({
    route,
    write: validated,
    canonicalWrite,
    canonicalAcknowledgement: canonicalizeJson(responseMaterial.acknowledgement),
    canonicalReadback: canonicalizeJson(responseMaterial.readback),
  });
  try {
    options.validateStoredRecordSemantics(proposed);
  } catch {
    throw httpError(400, "projection_semantics_invalid");
  }
  await claimCredentialUse(options.store, credential, request.signal);
  let persisted: ProjectionTargetAtomicPutResultV1;
  try {
    persisted = await options.store.putIfAbsentOrExact({
      record: proposed,
      signal: request.signal,
    });
  } catch {
    throw httpError(503, "persistence_unavailable");
  }
  if (persisted.kind === "conflict") throw httpError(409, "projection_conflict");
  const record = validateStoredRecord(persisted.record);
  assertStoredRoute(record, route);
  return canonicalResponse(
    persisted.kind === "created" ? 201 : 200,
    record.canonicalAcknowledgement,
  );
}

async function authenticateAndClaimCredential(
  options: Readonly<ValidatedHandlerOptionsV1>,
  route: Readonly<ResolvedRouteV1>,
  request: ProjectionTargetCredentialVerificationRequestV1,
): Promise<void> {
  let credential: AuthenticatedProjectionTargetCredentialV1;
  try {
    credential = await authenticateCredential(
      options.credentialVerifier,
      route,
      request,
    );
  } catch {
    throw httpError(401, "credential_rejected");
  }
  await claimCredentialUse(options.store, credential, request.signal);
}

async function authenticateCredential(
  verifier: ProjectionTargetCredentialVerifierV1,
  route: Readonly<ResolvedRouteV1>,
  request: ProjectionTargetCredentialVerificationRequestV1,
): Promise<AuthenticatedProjectionTargetCredentialV1> {
  const credential = await authenticateProjectionTargetCredentialV1(
    verifier,
    request,
  );
  if (credential === null) throw new TypeError("credential rejected");
  assertCredentialCapability(verifier, credential, route, request.method);
  return credential;
}

async function claimCredentialUse(
  store: ProjectionTargetAtomicStoreV1,
  credential: AuthenticatedProjectionTargetCredentialV1,
  signal: AbortSignal,
): Promise<void> {
  const entry = AUTHENTICATED_CREDENTIALS.get(credential);
  if (entry === undefined) throw httpError(401, "credential_rejected");
  const useMaterial = Object.freeze({ ...entry.claims });
  const canonicalUse = canonicalizeJson(useMaterial);
  const use = Object.freeze({
    schemaVersion: "programmable.projection-target-credential-use.v2" as const,
    credentialId: entry.claims.credentialId,
    requestBindingHash: canonicalSha256(
      "programmable.projection-target-credential-use.v2",
      useMaterial,
    ),
    canonicalUse,
  });
  let result: ProjectionTargetCredentialUseResultV2;
  try {
    result = await store.claimCredentialUseIfAbsentOrExact({ use, signal });
  } catch {
    throw httpError(503, "persistence_unavailable");
  }
  if (result.kind === "conflict") {
    throw httpError(401, "credential_reuse_rejected");
  }
}

interface ResolvedRouteV1 extends ValidatedLaneV1 {
  readonly projectionKey: string;
}

function resolveRoute(
  routes: readonly Readonly<ValidatedLaneV1>[],
  pathname: string,
): Readonly<ResolvedRouteV1> | null {
  for (const route of routes) {
    const prefix = `${route.routePrefix}/`;
    if (!pathname.startsWith(prefix)) continue;
    const encoded = pathname.slice(prefix.length);
    if (encoded.length === 0 || encoded.includes("/")) return null;
    let projectionKey: string;
    try {
      projectionKey = decodeURIComponent(encoded);
    } catch {
      return null;
    }
    if (encodeURIComponent(projectionKey) !== encoded || !safeProjectionKey(projectionKey)) {
      return null;
    }
    return Object.freeze({ ...route, projectionKey });
  }
  return null;
}

interface ValidatedProjectionWriteV1 {
  readonly version: 1 | 2 | 3;
  readonly value: Readonly<Record<string, JsonValue>>;
  readonly idempotencyKey: Sha256Digest;
  readonly requestDigest: Sha256Digest;
  readonly recordDigest: Sha256Digest;
}

function validateProjectionWrite(
  route: Readonly<ResolvedRouteV1>,
  value: JsonValue,
  headerIdempotencyKey: Sha256Digest,
): Readonly<ValidatedProjectionWriteV1> {
  const write = jsonRecord(value, "projection target write");
  if (route.lane === "registry.publication" || route.lane === "website.entitlement") {
    exactKeys(write, [
      "idempotencyKey", "messageId", "payloadDigest", "projection", "projectionDigest",
      "projectionKey", "projectionKind", "requestDigest", "schemaVersion",
      "targetBindingHash", "topic",
    ], "v1 projection target write");
    if (
      write.schemaVersion !== "programmable.registry-website-projection-write.v1"
      || write.targetBindingHash !== route.targetBindingHash
      || write.topic !== route.lane
      || write.projectionKind !== (route.lane === "registry.publication" ? "launched" : "launch_eligible")
      || write.projectionKey !== route.projectionKey
      || write.idempotencyKey !== headerIdempotencyKey
      || typeof write.messageId !== "string"
      || !SAFE_ID.test(write.messageId)
    ) throw httpError(400, "write_contract_mismatch");
    const idempotencyKey = digest(write.idempotencyKey, "v1 projection idempotency key");
    digest(write.payloadDigest, "v1 projection payload digest");
    const projectionDigest = digest(write.projectionDigest, "v1 projection record digest");
    const requestDigest = digest(write.requestDigest, "v1 projection request digest");
    if (
      write.projection === null
      || Array.isArray(write.projection)
      || typeof write.projection !== "object"
      || projectionDigest !== canonicalSha256(
        "programmable.registry-website-projection-record.v1",
        write.projection,
      )
    ) throw httpError(400, "write_digest_mismatch");
    const { requestDigest: _ignored, ...withoutRequestDigest } = write;
    void _ignored;
    if (requestDigest !== canonicalSha256(
      "programmable.registry-website-projection-write.v1",
      withoutRequestDigest,
    )) throw httpError(400, "write_digest_mismatch");
    return Object.freeze({ version: 1, value: write, idempotencyKey, requestDigest, recordDigest: projectionDigest });
  }

  if (route.lane === "website.approval-v3") {
    exactKeys(write, [
      "approvalEvidenceHash", "approvalId", "authorization",
      "authorizationDigest", "descriptorHash", "idempotencyKey", "launchId",
      "projectionKey", "projectionKind", "registryObservationDigest",
      "requestDigest", "schemaVersion", "signedReceiptArtifactHash",
      "targetBindingHash",
    ], "Approval v3 artifact projection write");
    if (
      write.schemaVersion
        !== "programmable.approval-v3-artifact-projection-write.v1"
      || write.targetBindingHash !== route.targetBindingHash
      || write.projectionKind !== route.lane
      || write.projectionKey !== route.projectionKey
      || write.idempotencyKey !== headerIdempotencyKey
    ) throw httpError(400, "write_contract_mismatch");
    const approvalId = nonzeroHash32(write.approvalId, "Approval v3 approval ID");
    const descriptorHash = nonzeroHash32(
      write.descriptorHash,
      "Approval v3 descriptor hash",
    );
    const launchId = nonzeroHash32(write.launchId, "Approval v3 launch ID");
    const signedReceiptArtifactHash = digest(
      write.signedReceiptArtifactHash,
      "Approval v3 signed artifact hash",
    );
    const approvalEvidenceHash = nonzeroHash32(
      write.approvalEvidenceHash,
      "Approval v3 evidence hash",
    );
    const authorizationDigest = digest(
      write.authorizationDigest,
      "Approval v3 authorization digest",
    );
    digest(write.registryObservationDigest, "Approval v3 Registry observation");
    const idempotencyKey = digest(
      write.idempotencyKey,
      "Approval v3 idempotency key",
    );
    const requestDigest = digest(
      write.requestDigest,
      "Approval v3 request digest",
    );
    const authorization = jsonRecord(
      write.authorization,
      "Approval v3 authorization",
    );
    exactKeys(authorization, [
      "approvalEvidenceHash", "artifact", "signedReceiptArtifactHash",
    ], "Approval v3 authorization");
    const artifact = jsonRecord(
      authorization.artifact,
      "Approval v3 signed artifact",
    );
    exactKeys(artifact, ["envelope", "payload"], "Approval v3 signed artifact");
    const payload = jsonRecord(artifact.payload, "Approval v3 artifact payload");
    const envelope = jsonRecord(artifact.envelope, "Approval v3 artifact envelope");
    const payloadAuthorization = jsonRecord(
      payload.authorization,
      "Approval v3 payload authorization",
    );
    if (
      write.projectionKey !== `approval:${approvalId}`
      || payload.schemaVersion
        !== "programmable.approval-registry-descriptor-binding.v3"
      || payloadAuthorization.approvalId !== approvalId
      || payload.descriptorHash !== descriptorHash
      || payload.launchId !== launchId
      || envelope.schemaVersion !== "1.0.0"
      || envelope.domain
        !== "programmable.approval-registry-descriptor-binding.v3"
      || envelope.audience !== "programmable.custom-registry.v2"
      || authorization.signedReceiptArtifactHash !== signedReceiptArtifactHash
      || authorization.approvalEvidenceHash !== approvalEvidenceHash
      || rawCanonicalSha256(artifact) !== signedReceiptArtifactHash
      || approvalEvidenceHash !== `0x${signedReceiptArtifactHash.slice(7)}`
      || rawCanonicalSha256(authorization) !== authorizationDigest
      || canonicalSha256(
        "programmable.approval-v3-website-artifact-idempotency.v1",
        { approvalId, descriptorHash, launchId, signedReceiptArtifactHash },
      ) !== idempotencyKey
    ) throw httpError(400, "write_digest_mismatch");
    const { requestDigest: _ignored, ...withoutRequestDigest } = write;
    void _ignored;
    if (canonicalSha256(
      "programmable.approval-v3-artifact-projection-write.v1",
      withoutRequestDigest,
    ) !== requestDigest) throw httpError(400, "write_digest_mismatch");
    return Object.freeze({
      version: 3,
      value: write,
      idempotencyKey,
      requestDigest,
      recordDigest: authorizationDigest,
    });
  }

  exactKeys(write, [
    "idempotencyKey", "launchId", "projectId", "projectionKey", "projectionKind",
    "record", "recordDigest", "requestDigest", "schemaVersion", "sourceAuthorityHash",
    "targetBindingHash",
  ], "v2 projection target write");
  if (
    write.schemaVersion !== "programmable.custom-launch-projection-write.v2"
    || write.targetBindingHash !== route.targetBindingHash
    || write.projectionKind !== route.lane
    || write.projectionKey !== route.projectionKey
    || write.idempotencyKey !== headerIdempotencyKey
  ) throw httpError(400, "write_contract_mismatch");
  const projectId = digest(write.projectId, "v2 projection project id");
  const launchId = digest(write.launchId, "v2 projection launch id");
  const idempotencyKey = digest(write.idempotencyKey, "v2 projection idempotency key");
  digest(write.sourceAuthorityHash, "v2 projection source authority");
  const recordDigest = digest(write.recordDigest, "v2 projection record digest");
  const requestDigest = digest(write.requestDigest, "v2 projection request digest");
  if (write.record === undefined) throw httpError(400, "write_contract_mismatch");
  const record = jsonRecord(write.record, "v2 projection record");
  const recordDomain = route.lane === "registry.custom-launched"
    ? "programmable.custom-launch-registry-record.v2"
    : "programmable.custom-launch-website-record.v2";
  if (
    write.projectionKey !== `custom:${launchId}`
    || record.schemaVersion !== recordDomain
    || record.launchFamily !== "custom"
    || record.projectId !== projectId
    || record.launchId !== launchId
    || (route.lane === "website.custom-launched"
      && (record.status !== "launched" || record.action !== "view_live_launch"))
    || recordDigest !== canonicalSha256(recordDomain, record)
  ) throw httpError(400, "write_digest_mismatch");
  const { requestDigest: _ignored, ...withoutRequestDigest } = write;
  void _ignored;
  if (requestDigest !== canonicalSha256(
    "programmable.custom-launch-projection-write.v2",
    withoutRequestDigest,
  )) throw httpError(400, "write_digest_mismatch");
  return Object.freeze({ version: 2, value: write, idempotencyKey, requestDigest, recordDigest });
}

function buildResponseMaterial(
  route: Readonly<ResolvedRouteV1>,
  write: Readonly<ValidatedProjectionWriteV1>,
  now: string,
): Readonly<{ acknowledgement: JsonValue; readback: JsonValue }> {
  const revisionDigest = canonicalSha256("programmable.projection-target-revision.v1", {
    lane: route.lane,
    targetBindingHash: route.targetBindingHash,
    requestDigest: write.requestDigest,
  });
  const targetRevision = `r-${revisionDigest.slice("sha256:".length, "sha256:".length + 32)}`;
  const externalReference = `programmable:${route.lane}:${write.recordDigest}`;
  if (write.version === 1) {
    const value = write.value;
    const acknowledgement = Object.freeze({
      schemaVersion: "programmable.registry-website-projection-write-ack.v1",
      targetBindingHash: value.targetBindingHash!,
      topic: value.topic!,
      projectionKind: value.projectionKind!,
      projectionKey: value.projectionKey!,
      idempotencyKey: value.idempotencyKey!,
      payloadDigest: value.payloadDigest!,
      projectionDigest: value.projectionDigest!,
      requestDigest: value.requestDigest!,
      externalReference,
      targetRevision,
      acknowledgedAt: now,
    }) as JsonValue;
    const readback = Object.freeze({
      schemaVersion: "programmable.registry-website-projection-readback.v1",
      targetBindingHash: value.targetBindingHash!,
      topic: value.topic!,
      projectionKind: value.projectionKind!,
      projectionKey: value.projectionKey!,
      idempotencyKey: value.idempotencyKey!,
      payloadDigest: value.payloadDigest!,
      projectionDigest: value.projectionDigest!,
      projection: value.projection!,
      externalReference,
      targetRevision,
      observedAt: now,
    }) as JsonValue;
    return Object.freeze({ acknowledgement, readback });
  }
  if (write.version === 3) {
    const value = write.value;
    const common = Object.freeze({
      targetBindingHash: value.targetBindingHash!,
      projectionKind: value.projectionKind!,
      projectionKey: value.projectionKey!,
      approvalId: value.approvalId!,
      descriptorHash: value.descriptorHash!,
      launchId: value.launchId!,
      signedReceiptArtifactHash: value.signedReceiptArtifactHash!,
      approvalEvidenceHash: value.approvalEvidenceHash!,
      authorizationDigest: value.authorizationDigest!,
      registryObservationDigest: value.registryObservationDigest!,
      idempotencyKey: value.idempotencyKey!,
      requestDigest: value.requestDigest!,
    });
    const acknowledgement = Object.freeze({
      schemaVersion:
        "programmable.approval-v3-artifact-projection-write-ack.v1",
      ...common,
      externalReference,
      targetRevision,
      acknowledgedAt: now,
    }) as JsonValue;
    const readback = Object.freeze({
      schemaVersion:
        "programmable.approval-v3-artifact-projection-readback.v1",
      ...common,
      authorization: value.authorization!,
      externalReference,
      targetRevision,
      observedAt: now,
    }) as JsonValue;
    return Object.freeze({ acknowledgement, readback });
  }
  const value = write.value;
  const acknowledgement = Object.freeze({
    schemaVersion: "programmable.custom-launch-projection-write-ack.v2",
    targetBindingHash: value.targetBindingHash!,
    projectionKind: value.projectionKind!,
    projectionKey: value.projectionKey!,
    projectId: value.projectId!,
    launchId: value.launchId!,
    idempotencyKey: value.idempotencyKey!,
    sourceAuthorityHash: value.sourceAuthorityHash!,
    recordDigest: value.recordDigest!,
    requestDigest: value.requestDigest!,
    externalReference,
    targetRevision,
    acknowledgedAt: now,
  }) as JsonValue;
  const readback = Object.freeze({
    schemaVersion: "programmable.custom-launch-projection-readback.v2",
    targetBindingHash: value.targetBindingHash!,
    projectionKind: value.projectionKind!,
    projectionKey: value.projectionKey!,
    projectId: value.projectId!,
    launchId: value.launchId!,
    idempotencyKey: value.idempotencyKey!,
    sourceAuthorityHash: value.sourceAuthorityHash!,
    recordDigest: value.recordDigest!,
    record: value.record!,
    externalReference,
    targetRevision,
    observedAt: now,
  }) as JsonValue;
  return Object.freeze({ acknowledgement, readback });
}

function createStoredRecord(input: Readonly<{
  route: Readonly<ResolvedRouteV1>;
  write: Readonly<ValidatedProjectionWriteV1>;
  canonicalWrite: string;
  canonicalAcknowledgement: string;
  canonicalReadback: string;
}>): Readonly<ProjectionTargetStoredRecordV1> {
  const preimage = Object.freeze({
    schemaVersion: "programmable.projection-target-stored-record.v1" as const,
    lane: input.route.lane,
    targetBindingHash: input.route.targetBindingHash,
    audience: input.route.audience,
    projectionKey: input.route.projectionKey,
    idempotencyKey: input.write.idempotencyKey,
    requestDigest: input.write.requestDigest,
    canonicalWrite: input.canonicalWrite,
    canonicalAcknowledgement: input.canonicalAcknowledgement,
    canonicalReadback: input.canonicalReadback,
  });
  return Object.freeze({
    ...preimage,
    recordBindingHash: canonicalSha256(
      "programmable.projection-target-stored-record.v1",
      preimage,
    ),
  });
}

function validateStoredRecord(value: ProjectionTargetStoredRecordV1): Readonly<ProjectionTargetStoredRecordV1> {
  const stored = value as unknown as Readonly<Record<string, unknown>>;
  exactKeys(stored, [
    "audience", "canonicalAcknowledgement", "canonicalReadback", "canonicalWrite",
    "idempotencyKey", "lane", "projectionKey", "recordBindingHash", "requestDigest",
    "schemaVersion", "targetBindingHash",
  ], "projection target stored record");
  if (
    value.schemaVersion !== "programmable.projection-target-stored-record.v1"
    || !isLane(value.lane)
    || !safeProjectionKey(value.projectionKey)
    || !SAFE_ID.test(value.audience)
  ) throw new TypeError("projection target stored record is invalid");
  digest(value.targetBindingHash, "stored target binding");
  digest(value.idempotencyKey, "stored idempotency key");
  digest(value.requestDigest, "stored request digest");
  digest(value.recordBindingHash, "stored record binding");
  const parsedBodies = new Map<string, JsonValue>();
  for (const [label, body] of [
    ["write", value.canonicalWrite],
    ["acknowledgement", value.canonicalAcknowledgement],
    ["readback", value.canonicalReadback],
  ] as const) {
    if (typeof body !== "string" || body.length < 2 || body.length > DEFAULT_MAXIMUM_REQUEST_BYTES * 2) {
      throw new TypeError(`stored projection ${label} is invalid`);
    }
    const parsed = parseStrictJson(body, {
      maximumBytes: DEFAULT_MAXIMUM_REQUEST_BYTES * 2,
      maximumDepth: DEFAULT_MAXIMUM_DEPTH,
    });
    if (canonicalizeJson(parsed) !== body) {
      throw new TypeError(`stored projection ${label} is not canonical`);
    }
    parsedBodies.set(label, parsed);
  }
  const { recordBindingHash: _ignored, ...preimage } = value;
  void _ignored;
  if (value.recordBindingHash !== canonicalSha256(
    "programmable.projection-target-stored-record.v1",
    preimage as unknown as JsonValue,
  )) throw new TypeError("projection target stored record binding is invalid");
  const route = Object.freeze({
    lane: value.lane,
    targetBindingHash: value.targetBindingHash,
    audience: value.audience,
    routePrefix: "",
    projectionKey: value.projectionKey,
  });
  const write = validateProjectionWrite(
    route,
    parsedBodies.get("write")!,
    value.idempotencyKey,
  );
  if (write.requestDigest !== value.requestDigest) {
    throw new TypeError("stored projection request digest is invalid");
  }
  const acknowledgement = jsonRecord(
    parsedBodies.get("acknowledgement")!,
    "stored projection acknowledgement",
  );
  const acknowledgedAt = acknowledgement.acknowledgedAt;
  canonicalInstant(acknowledgedAt, "stored projection acknowledgement time");
  const expected = buildResponseMaterial(route, write, acknowledgedAt as string);
  if (
    canonicalizeJson(expected.acknowledgement) !== value.canonicalAcknowledgement
    || canonicalizeJson(expected.readback) !== value.canonicalReadback
  ) throw new TypeError("stored projection acknowledgement or readback is not byte-equivalent");
  return Object.freeze({ ...value });
}

function validateHandlerOptions(input: Readonly<{
  lanes: readonly ProjectionTargetLaneConfigurationV1[];
  registryV2EndpointPath?: string;
  credentialVerifier: ProjectionTargetCredentialVerifierV1;
  store: ProjectionTargetAtomicStoreV1;
  validateStoredRecordSemantics?: (
    record: ProjectionTargetStoredRecordV1,
  ) => void;
  maximumRequestBytes?: number;
  maximumDepth?: number;
  now?: () => Date;
}>): Readonly<ValidatedHandlerOptionsV1> {
  if (resolveProjectionTargetCredentialVerifierBindingV1(input.credentialVerifier) === null) {
    throw new TypeError("projection target credential verifier is not authentic");
  }
  if (
    input.store === null
    || typeof input.store !== "object"
    || typeof input.store.claimCredentialUseIfAbsentOrExact !== "function"
    || typeof input.store.putIfAbsentOrExact !== "function"
    || typeof input.store.get !== "function"
  ) throw new TypeError("projection target atomic store is invalid");
  const supported = new Set<ProjectionTargetLaneV1>([
    "registry.publication", "website.entitlement",
    "registry.custom-launched", "website.custom-launched",
    "website.approval-v3",
  ]);
  const lanes = new Map<ProjectionTargetLaneV1, Readonly<ValidatedLaneV1>>();
  for (const value of input.lanes) {
    if (!supported.has(value.lane) || lanes.has(value.lane) || !SAFE_ID.test(value.audience)) {
      throw new TypeError("projection target lane configuration is invalid or duplicated");
    }
    const registryV2EndpointPath = value.lane === "registry.custom-launched"
      ? safeRegistryEndpointPath(input.registryV2EndpointPath)
      : null;
    const routePrefix = value.lane === "registry.publication"
      ? V1_REGISTRY_ROUTE
      : value.lane === "website.entitlement"
        ? V1_WEBSITE_ROUTE
        : value.lane === "website.approval-v3"
          ? V2_APPROVAL_V3_ROUTE
        : value.lane === "website.custom-launched"
          ? V2_WEBSITE_ROUTE
          : `${registryV2EndpointPath!}/v2/custom-launches`;
    lanes.set(value.lane, Object.freeze({
      lane: value.lane,
      targetBindingHash: digest(value.targetBindingHash, `${value.lane} target binding`),
      audience: value.audience,
      routePrefix,
    }));
  }
  if (lanes.size < 1 || lanes.size > supported.size) {
    throw new TypeError("projection target requires one or more supported lanes");
  }
  const maximumRequestBytes = input.maximumRequestBytes ?? DEFAULT_MAXIMUM_REQUEST_BYTES;
  if (
    !Number.isSafeInteger(maximumRequestBytes)
    || maximumRequestBytes < 1_024
    || maximumRequestBytes > DEFAULT_MAXIMUM_REQUEST_BYTES
  ) throw new TypeError("projection target request byte limit is invalid");
  const maximumDepth = input.maximumDepth ?? DEFAULT_MAXIMUM_DEPTH;
  if (!Number.isSafeInteger(maximumDepth) || maximumDepth < 8 || maximumDepth > 256) {
    throw new TypeError("projection target JSON depth limit is invalid");
  }
  if (input.now !== undefined && typeof input.now !== "function") {
    throw new TypeError("projection target clock is invalid");
  }
  if (
    input.validateStoredRecordSemantics !== undefined
    && typeof input.validateStoredRecordSemantics !== "function"
  ) throw new TypeError("projection target semantic validator is invalid");
  return Object.freeze({
    lanes,
    routes: Object.freeze([...lanes.values()].sort((left, right) =>
      right.routePrefix.length - left.routePrefix.length)),
    credentialVerifier: input.credentialVerifier,
    store: input.store,
    validateStoredRecordSemantics:
      input.validateStoredRecordSemantics ?? (() => {}),
    maximumRequestBytes,
    maximumDepth,
    now: input.now ?? (() => new Date()),
  });
}

async function readCanonicalRequestBody(
  request: Request,
  maximumBytes: number,
  maximumDepth: number,
): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/u.test(declared) || Number(declared) > maximumBytes)) {
    throw httpError(413, "request_too_large");
  }
  if (request.body === null) throw httpError(400, "request_body_missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maximumBytes) throw httpError(413, "request_too_large");
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total < 2) throw httpError(400, "request_body_missing");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total),
    );
    const parsed = parseStrictJson(source, { maximumBytes, maximumDepth });
    if (canonicalizeJson(parsed) !== source) throw new TypeError("non-canonical JSON");
  } catch {
    throw httpError(400, "canonical_json_required");
  }
  return source;
}

function validateCredentialClaims(
  value: ProjectionTargetCredentialClaimsV1,
  request: ProjectionTargetCredentialVerificationRequestV1,
  now: Date,
): Readonly<ProjectionTargetCredentialClaimsV1> {
  exactKeys(value as unknown as Readonly<Record<string, unknown>>, [
    "audience", "credentialId", "credentialTokenHash", "expiresAt",
    "idempotencyKey", "issuedAt", "lane", "method", "principalId",
    "projectionKey", "requestDigest", "schemaVersion", "targetBindingHash",
  ], "projection target credential claims");
  const issuedAt = canonicalInstant(value.issuedAt, "credential issuedAt");
  const expiresAt = canonicalInstant(value.expiresAt, "credential expiresAt");
  const nowMs = now.getTime();
  if (
    value.schemaVersion !== "programmable.projection-target-credential-claims.v2"
    || !SAFE_ID.test(value.principalId)
    || !SAFE_ID.test(value.credentialId)
    || !DIGEST.test(value.credentialTokenHash)
    || value.method !== request.method
    || value.lane !== request.lane
    || value.audience !== request.audience
    || value.targetBindingHash !== request.targetBindingHash
    || value.projectionKey !== request.projectionKey
    || value.idempotencyKey !== request.idempotencyKey
    || value.requestDigest !== request.requestDigest
    || !safeProjectionKey(value.projectionKey)
    || (value.method === "GET"
      ? value.idempotencyKey !== null || value.requestDigest !== null
      : value.idempotencyKey === null || value.requestDigest === null)
    || !Number.isFinite(nowMs)
    || issuedAt > nowMs
    || expiresAt <= nowMs
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > 600_000
  ) throw new TypeError("projection target credential claims are invalid");
  return Object.freeze({ ...value });
}

function assertCredentialCapability(
  verifier: ProjectionTargetCredentialVerifierV1,
  credential: AuthenticatedProjectionTargetCredentialV1,
  route: Readonly<ResolvedRouteV1>,
  method: "GET" | "PUT",
): void {
  const entry = AUTHENTICATED_CREDENTIALS.get(credential);
  if (
    entry === undefined
    || entry.verifier !== verifier
    || entry.claims.method !== method
    || entry.claims.lane !== route.lane
    || entry.claims.audience !== route.audience
    || entry.claims.targetBindingHash !== route.targetBindingHash
    || entry.claims.projectionKey !== route.projectionKey
  ) throw httpError(401, "credential_rejected");
}

function resolveCredentialVerifier(
  value: ProjectionTargetCredentialVerifierV1,
): Readonly<CredentialVerifierEntryV1> {
  const entry = CREDENTIAL_VERIFIERS.get(value);
  if (entry === undefined) throw new TypeError("projection target credential verifier is not authentic");
  return entry;
}

async function authenticateProjectionTargetCredentialV1(
  verifier: ProjectionTargetCredentialVerifierV1,
  input: ProjectionTargetCredentialVerificationRequestV1,
): Promise<AuthenticatedProjectionTargetCredentialV1 | null> {
  const entry = resolveCredentialVerifier(verifier);
  input.signal.throwIfAborted();
  const claims = await entry.verifyBearer(Object.freeze({ ...input }));
  input.signal.throwIfAborted();
  if (claims === null) return null;
  const normalized = validateCredentialClaims(claims, input, entry.now());
  return new AuthenticatedProjectionTargetCredentialV1(
    AUTHENTICATED_CREDENTIAL_MINT,
    Object.freeze({ claims: normalized, verifier }),
  );
}

function assertRouteHeaders(
  headers: Headers,
  route: Readonly<ResolvedRouteV1>,
  method: "GET" | "PUT",
): void {
  if (
    headers.get("x-programmable-audience") !== route.audience
    || headers.get("x-programmable-target-binding") !== route.targetBindingHash
  ) throw httpError(403, "target_binding_rejected");
  const kind = headers.get("x-programmable-projection-kind");
  if (
    route.lane.endsWith(".custom-launched")
    || route.lane === "website.approval-v3"
  ) {
    if (headers.get("x-programmable-projection-kind") !== route.lane) {
      throw httpError(403, "projection_lane_rejected");
    }
  } else if (kind !== null) {
    throw httpError(400, "unexpected_projection_lane_header");
  }
  if (method === "PUT" && !headers.has("idempotency-key")) {
    throw httpError(400, "idempotency_key_required");
  }
}

function authorizationBearer(headers: Headers): string {
  const value = headers.get("authorization");
  if (value === null) throw httpError(401, "credential_required");
  if (!value.startsWith("Bearer ")) throw httpError(401, "credential_required");
  const token = value.slice("Bearer ".length);
  if (token.length < 20 || token.length > 8_192 || /[\s\u0000]/u.test(token)) {
    throw httpError(401, "credential_required");
  }
  return token;
}

function assertAcceptHeader(headers: Headers): void {
  if (headers.get("accept")?.trim().toLowerCase() !== "application/json") {
    throw httpError(406, "json_response_required");
  }
}

function assertPutContentType(headers: Headers): void {
  const value = headers.get("content-type")?.trim().toLowerCase();
  if (value !== "application/json" && value !== "application/json; charset=utf-8") {
    throw httpError(415, "canonical_json_content_type_required");
  }
}

function assertStoredRoute(
  value: ProjectionTargetStoredRecordV1,
  route: Readonly<ResolvedRouteV1>,
): void {
  if (
    value.lane !== route.lane
    || value.targetBindingHash !== route.targetBindingHash
    || value.audience !== route.audience
    || value.projectionKey !== route.projectionKey
  ) throw httpError(503, "stored_projection_invalid");
}

function canonicalResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: responseHeaders(),
  });
}

function errorResponse(status: number, code: string, allow?: string): Response {
  const headers = responseHeaders();
  if (allow !== undefined) headers.set("allow", allow);
  return new Response(canonicalizeJson({
    schemaVersion: "programmable.projection-target-error.v1",
    code,
  }), { status, headers });
}

function responseHeaders(): Headers {
  return new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
}

class ProjectionTargetHttpErrorV1 extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly allow?: string,
  ) {
    super(code);
    this.name = "ProjectionTargetHttpErrorV1";
  }
}

function httpError(status: number, code: string, allow?: string): ProjectionTargetHttpErrorV1 {
  return new ProjectionTargetHttpErrorV1(status, code, allow);
}

function canonicalNow(now: () => Date): string {
  const value = now();
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) throw new TypeError("projection target clock is invalid");
  return new Date(milliseconds).toISOString();
}

function canonicalInstant(value: unknown, label: string): number {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError(`${label} is invalid`);
  }
  return milliseconds;
}

function safeRegistryEndpointPath(value: string | undefined): string {
  if (
    typeof value !== "string"
    || value.length < 2
    || value.length > 256
    || !value.startsWith("/")
    || value.endsWith("/")
    || value.includes("//")
    || value.includes("?")
    || value.includes("#")
    || /[\u0000-\u0020\u007f]/u.test(value)
  ) throw new TypeError("v2 registry endpoint path is invalid");
  return value;
}

function safeProjectionKey(value: unknown): value is string {
  return typeof value === "string"
    && SAFE_PROJECTION_KEY.test(value)
    && !/^https?:\/\//iu.test(value);
}

function jsonRecord(value: JsonValue, label: string): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw httpError(400, `${label.replaceAll(" ", "_")}_invalid`);
  }
  return value;
}

function exactKeys(value: object, expected: readonly string[], label: string): void {
  const own = Reflect.ownKeys(value);
  if (own.some((key) => typeof key !== "string")) throw new TypeError(`${label} contains symbols`);
  const actual = (own as string[]).sort();
  const sorted = [...expected].sort();
  if (
    actual.length !== sorted.length
    || actual.some((key, index) => key !== sorted[index])
  ) throw httpError(400, "write_contract_mismatch");
}

function digest(value: unknown, label: string): Sha256Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Sha256Digest;
}

function nonzeroHash32(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !HASH32.test(value)
    || value === `0x${"0".repeat(64)}`
  ) throw new TypeError(`${label} is invalid`);
  return value;
}

function rawCanonicalSha256(value: JsonValue): Sha256Digest {
  return `sha256:${createHash("sha256")
    .update(canonicalizeJson(value), "utf8")
    .digest("hex")}`;
}

function identityKey(lane: ProjectionTargetLaneV1, projectionKey: string): string {
  return `${lane}\u0000${projectionKey}`;
}

function isLane(value: unknown): value is ProjectionTargetLaneV1 {
  return value === "registry.publication"
    || value === "website.entitlement"
    || value === "registry.custom-launched"
    || value === "website.custom-launched"
    || value === "website.approval-v3";
}
