import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";

import { provenanceHeaders, type ReadProvenance } from "./cache";
import { canonicalBytes32, parseNonnegativeIntegerText } from "./codecs";
import { loadDataPipelineConfig, type DataPipelineFlagName } from "./config";
import { invalidInput } from "./errors";
import { getServerReadModel, type ServerReadModel } from "./read-model.server";
import type { PostgresTransaction } from "./postgres";

export const INDEXED_ROUTE_KEYS = [
  "explore-list",
  "explore-token",
  "explore-chart",
  "creator-profile",
  "classic-v3-profile",
  "launch-lookup",
] as const;

export type IndexedRouteKey = (typeof INDEXED_ROUTE_KEYS)[number];
export type ReviewedModel = "classic" | "stock-paired";
export type ReviewedRelease =
  | "classic-v2"
  | "classic-v3"
  | "stock-paired-v1"
  | "stock-paired-v2"
  | "stock-paired-v3";

export type ReviewedRouteScope = Readonly<{
  model: ReviewedModel;
  releaseVersion: ReviewedRelease;
}>;

export const ALL_REVIEWED_ROUTE_SCOPES: readonly ReviewedRouteScope[] =
  Object.freeze([
    Object.freeze({ model: "classic", releaseVersion: "classic-v2" }),
    Object.freeze({ model: "classic", releaseVersion: "classic-v3" }),
    Object.freeze({
      model: "stock-paired",
      releaseVersion: "stock-paired-v1",
    }),
    Object.freeze({
      model: "stock-paired",
      releaseVersion: "stock-paired-v2",
    }),
    Object.freeze({
      model: "stock-paired",
      releaseVersion: "stock-paired-v3",
    }),
  ]);

export type RouteCheckpoint = {
  blockNumber: string;
  blockHash: string;
};

export type IndexedProjectionVersion = RouteCheckpoint & {
  checkpointId: string;
  sourceGroup: string;
  projectorVersion: string;
  epochId: string;
  pointerGeneration: string;
  checkpointGeneration: string;
  reorgGeneration: string;
};

export type RouteScopeProjectionVersion = ReviewedRouteScope & {
  version: IndexedProjectionVersion;
};

const VALIDATED_RECORD_SCOPE_EVIDENCE = Symbol(
  "programmable.validated-record-scope-evidence",
);
const VALIDATED_RECORD_SCOPE_EVIDENCE_INSTANCES = new WeakSet<object>();

const AUTHORIZED_RELEASE_PROBE = Symbol(
  "programmable.authorized-release-probe",
);
const AUTHORIZED_RELEASE_PROBE_INSTANCES = new WeakSet<object>();

export type AuthorizedReleaseProbe = Readonly<{
  readonly [AUTHORIZED_RELEASE_PROBE]: true;
}>;

export type ValidatedRecordScopeEvidence = Readonly<{
  recordCount: number;
  recordScopes: readonly ReviewedRouteScope[];
  readonly [VALIDATED_RECORD_SCOPE_EVIDENCE]: true;
}>;

export type RouteComparisonSchema = Readonly<{
  addressFields?: readonly string[];
  hashFields?: readonly string[];
  integerFields?: readonly string[];
}>;

export type LegacyRouteResult = {
  response: Response;
  source: "rpc" | "blob";
  checkpoint?: RouteCheckpoint;
};

export type IndexedRouteResult = {
  response: Response;
  source: "indexed";
  scope: readonly ReviewedRouteScope[];
  /**
   * Route adapters must derive this evidence from the same validated records
   * used to construct `response`, before serializing the response body.
   */
  scopeEvidence: ValidatedRecordScopeEvidence;
  /** One exact immutable database checkpoint for every searched scope. */
  versions: readonly RouteScopeProjectionVersion[];
  /** Snapshot used only to compare an indexed response with the legacy path. */
  comparisonCheckpoint?: RouteCheckpoint;
  projectionLag?: number;
  reconciledAt?: string;
};

export type RouteScopeReadiness = ReviewedRouteScope & {
  eligibility: "eligible" | "ineligible";
  parity: "current" | "pending" | "stale" | "mismatch" | "missing";
  version?: IndexedProjectionVersion;
};

export type RouteReadiness = readonly RouteScopeReadiness[];

export type IndexedRouteSnapshot = Readonly<{
  readiness: RouteReadiness;
  /** May be omitted when the transaction proves the route is not current. */
  indexed?: IndexedRouteResult;
}>;

export type RouteComparison =
  | {
      kind: "match";
      legacyHash: string;
      indexedHash: string;
      mismatchPaths: readonly [];
    }
  | {
      kind: "mismatch";
      legacyHash: string;
      indexedHash: string;
      mismatchPaths: readonly string[];
    };

export type RouteComparisonEvent =
  | (RouteComparison & {
      route: IndexedRouteKey;
      scope: readonly ReviewedRouteScope[];
      readiness: RouteReadiness;
      blockNumber: string;
      blockHash: string;
    })
  | {
      kind: "incomparable";
      route: IndexedRouteKey;
      scope: readonly ReviewedRouteScope[];
      readiness?: RouteReadiness;
      reason:
        | "readiness-unavailable"
        | "model-ineligible"
        | "indexed-unavailable"
        | "invalid-result"
        | "checkpoint-missing"
        | "checkpoint-mismatch"
        | "body-oversize"
        | "non-json"
        | "invalid-json"
        | "invalid-response";
    };

export type CoordinatedRouteRead = {
  route: IndexedRouteKey;
  scope: readonly ReviewedRouteScope[];
  legacy: () => Promise<LegacyRouteResult>;
  /**
   * Must return readiness, the adapted payload, branded record-scope evidence,
   * and exact scoped checkpoints from one repeatable-read transaction. Keeping
   * this as one callback prevents same-checkpoint parity TOCTOU races.
   */
  indexedSnapshot: (
    transaction: PostgresTransaction,
  ) => Promise<IndexedRouteSnapshot>;
  /** Present only after server-side probe-token authorization. */
  releaseProbe?: AuthorizedReleaseProbe;
  comparisonSchema?: RouteComparisonSchema;
  recordComparison?: (event: RouteComparisonEvent) => void | Promise<void>;
  /**
   * Must enqueue the task outside the response critical path, for example
   * with Next.js `after()` or a request-context `waitUntil()` implementation.
   */
  scheduleShadowComparison?: (
    task: () => Promise<void>,
  ) => void | Promise<void>;
};

const ROUTE_FLAGS = Object.freeze({
  "explore-list": "INDEXED_EXPLORE_LIST_READS_ENABLED",
  "explore-token": "INDEXED_EXPLORE_TOKEN_READS_ENABLED",
  "explore-chart": "INDEXED_EXPLORE_CHART_READS_ENABLED",
  "creator-profile": "INDEXED_CREATOR_PROFILE_READS_ENABLED",
  "classic-v3-profile": "INDEXED_CLASSIC_V3_PROFILE_READS_ENABLED",
  "launch-lookup": "INDEXED_LAUNCH_LOOKUP_ENABLED",
} satisfies Record<IndexedRouteKey, DataPipelineFlagName>);

const RELEASE_MODELS = Object.freeze({
  "classic-v2": "classic",
  "classic-v3": "classic",
  "stock-paired-v1": "stock-paired",
  "stock-paired-v2": "stock-paired",
  "stock-paired-v3": "stock-paired",
} satisfies Record<ReviewedRelease, ReviewedModel>);

const DISCOVERY_ROUTES: ReadonlySet<IndexedRouteKey> = new Set([
  "explore-token",
  "explore-chart",
  "launch-lookup",
]);

const PROJECTION_HEADERS = [
  "X-Programmable-Read-Source",
  "X-Programmable-Projection-Block",
  "X-Programmable-Projection-Hash",
  "X-Programmable-Projection-Lag",
  "X-Programmable-Reconciled-At",
  "X-Programmable-Release-Version",
] as const;

const SHARED_CACHE_HEADERS = [
  "Vercel-CDN-Cache-Control",
  "CDN-Cache-Control",
  "Surrogate-Control",
  "Age",
] as const;

const RELEASE_PROBE_HEADERS = [
  "x-programmable-shadow-overhead-ms",
  "x-programmable-shadow-parity",
  "x-programmable-live-fallback",
] as const;

const MAX_COMPARISON_BODY_BYTES = 512 * 1024;
const MAX_CANONICAL_NODES = 20_000;
const MAX_CANONICAL_DEPTH = 64;
const MAX_MISMATCH_PATHS = 8;

type ValidatedRouteIdentity = Readonly<{
  route: IndexedRouteKey;
  scope: readonly ReviewedRouteScope[];
}>;

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

type CanonicalizationPolicy = Readonly<{
  addressFields: ReadonlySet<string>;
  hashFields: ReadonlySet<string>;
  integerFields: ReadonlySet<string>;
}>;

class ComparisonReadError extends Error {
  readonly reason: Extract<
    RouteComparisonEvent,
    { kind: "incomparable" }
  >["reason"];

  constructor(
    reason: Extract<RouteComparisonEvent, { kind: "incomparable" }>["reason"],
  ) {
    super("Route response is not comparable");
    this.name = "ComparisonReadError";
    this.reason = reason;
  }
}

function supportedRoute(value: unknown): value is IndexedRouteKey {
  return (
    typeof value === "string" &&
    (INDEXED_ROUTE_KEYS as readonly string[]).includes(value)
  );
}

function supportedModel(value: unknown): value is ReviewedModel {
  return value === "classic" || value === "stock-paired";
}

function supportedRelease(value: unknown): value is ReviewedRelease {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(RELEASE_MODELS, value)
  );
}

function scopeKey(scope: ReviewedRouteScope): string {
  return `${scope.model}:${scope.releaseVersion}`;
}

function validatedScope(value: unknown): readonly ReviewedRouteScope[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > ALL_REVIEWED_ROUTE_SCOPES.length
  ) {
    throw invalidInput("config", "indexed-route-scope");
  }
  const selected = new Map<string, ReviewedRouteScope>();
  for (const candidate of value) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      !supportedModel((candidate as ReviewedRouteScope).model) ||
      !supportedRelease((candidate as ReviewedRouteScope).releaseVersion)
    ) {
      throw invalidInput("config", "indexed-route-scope");
    }
    const scope = candidate as ReviewedRouteScope;
    if (RELEASE_MODELS[scope.releaseVersion] !== scope.model) {
      throw invalidInput("config", "indexed-route-scope");
    }
    const key = scopeKey(scope);
    if (selected.has(key)) {
      throw invalidInput("config", "indexed-route-scope");
    }
    selected.set(
      key,
      Object.freeze({
        model: scope.model,
        releaseVersion: scope.releaseVersion,
      }),
    );
  }
  return Object.freeze(
    ALL_REVIEWED_ROUTE_SCOPES.filter((scope) =>
      selected.has(scopeKey(scope)),
    ).map((scope) => selected.get(scopeKey(scope))!),
  );
}

function sameScope(
  left: readonly ReviewedRouteScope[],
  right: readonly ReviewedRouteScope[],
): boolean {
  return (
    left.length === right.length &&
    left.every((scope, index) => scopeKey(scope) === scopeKey(right[index]!))
  );
}

function validateIdentity(input: CoordinatedRouteRead): ValidatedRouteIdentity {
  if (!supportedRoute(input.route)) {
    throw invalidInput("config", "indexed-route-identity");
  }
  const scope = validatedScope(input.scope);
  if (input.route === "classic-v3-profile" && scope.length !== 1) {
    throw invalidInput("config", "indexed-route-scope");
  }
  if (
    input.route === "classic-v3-profile" &&
    (scope[0]?.model !== "classic" || scope[0]?.releaseVersion !== "classic-v3")
  ) {
    throw invalidInput("config", "indexed-route-identity");
  }
  return Object.freeze({ route: input.route, scope });
}

function canonicalCheckpoint(value: RouteCheckpoint): RouteCheckpoint {
  return Object.freeze({
    blockNumber: parseNonnegativeIntegerText(value.blockNumber),
    blockHash: canonicalBytes32(value.blockHash),
  });
}

function canonicalUuid(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw invalidInput("config", field);
  }
  return value.toLowerCase();
}

function canonicalIdentifier(
  value: unknown,
  field: string,
  allowPlus: boolean,
): string {
  const pattern = allowPlus
    ? /^[A-Za-z0-9][A-Za-z0-9._+:/-]*$/
    : /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > 128 ||
    !pattern.test(value)
  ) {
    throw invalidInput("config", field);
  }
  return value;
}

function canonicalPositiveInteger(value: string, field: string): string {
  const canonical = parseNonnegativeIntegerText(value);
  if (canonical === "0") throw invalidInput("config", field);
  return canonical;
}

function canonicalProjectionVersion(
  value: IndexedProjectionVersion,
): IndexedProjectionVersion {
  const checkpoint = canonicalCheckpoint(value);
  return Object.freeze({
    ...checkpoint,
    checkpointId: canonicalUuid(value.checkpointId, "projection-checkpoint"),
    sourceGroup: canonicalIdentifier(
      value.sourceGroup,
      "projection-source-group",
      false,
    ),
    projectorVersion: canonicalIdentifier(
      value.projectorVersion,
      "projection-projector-version",
      true,
    ),
    epochId: canonicalUuid(value.epochId, "projection-epoch"),
    pointerGeneration: canonicalPositiveInteger(
      value.pointerGeneration,
      "projection-pointer-generation",
    ),
    checkpointGeneration: canonicalPositiveInteger(
      value.checkpointGeneration,
      "projection-checkpoint-generation",
    ),
    reorgGeneration: parseNonnegativeIntegerText(value.reorgGeneration),
  });
}

function sameProjectionVersion(
  left: IndexedProjectionVersion,
  right: IndexedProjectionVersion,
): boolean {
  return (
    left.checkpointId === right.checkpointId &&
    left.sourceGroup === right.sourceGroup &&
    left.projectorVersion === right.projectorVersion &&
    left.blockNumber === right.blockNumber &&
    left.blockHash === right.blockHash &&
    left.epochId === right.epochId &&
    left.pointerGeneration === right.pointerGeneration &&
    left.checkpointGeneration === right.checkpointGeneration &&
    left.reorgGeneration === right.reorgGeneration
  );
}

/**
 * Route-specific adapters call this on their typed, validated records before
 * constructing the JSON response. The coordinator accepts no unbranded scope
 * assertion, and independently enforces the searched-scope allowlist.
 */
export function validatedRecordScopeEvidence<T>(
  records: readonly T[],
  scopeOf: (record: T, index: number) => ReviewedRouteScope,
): ValidatedRecordScopeEvidence {
  if (!Array.isArray(records) || records.length > 5_000) {
    throw invalidInput("config", "indexed-record-scope-evidence");
  }
  const selected = new Map<string, ReviewedRouteScope>();
  records.forEach((record, index) => {
    const scope = validatedScope([scopeOf(record, index)])[0]!;
    selected.set(scopeKey(scope), scope);
  });
  const recordScopes = Object.freeze(
    ALL_REVIEWED_ROUTE_SCOPES.filter((scope) =>
      selected.has(scopeKey(scope)),
    ).map((scope) => selected.get(scopeKey(scope))!),
  );
  const evidence = {
    recordCount: records.length,
    recordScopes,
  } as ValidatedRecordScopeEvidence;
  Object.defineProperty(evidence, VALIDATED_RECORD_SCOPE_EVIDENCE, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  VALIDATED_RECORD_SCOPE_EVIDENCE_INSTANCES.add(evidence);
  return Object.freeze(evidence);
}

function validReleaseProbeToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Buffer.byteLength(value, "utf8") >= 32 &&
    Buffer.byteLength(value, "utf8") <= 512 &&
    /^[A-Za-z0-9._~+/=-]+$/u.test(value)
  );
}

/**
 * Converts the exact internal probe headers into an unforgeable in-process
 * capability. The capability stores no token and must never be serialized.
 */
export function authorizeRouteReleaseProbe(
  headers: Headers,
): AuthorizedReleaseProbe | null {
  if (headers.get("x-programmable-shadow-probe") !== "1") return null;

  const expectedToken = process.env.PROGRAMMABLE_SHADOW_PROBE_TOKEN;
  if (!validReleaseProbeToken(expectedToken)) {
    throw invalidInput("config", "release-probe-token");
  }
  const supplied = headers.get("x-programmable-shadow-probe-token");
  if (!validReleaseProbeToken(supplied)) return null;

  const expectedDigest = createHash("sha256")
    .update(expectedToken, "utf8")
    .digest();
  const suppliedDigest = createHash("sha256").update(supplied, "utf8").digest();
  if (!timingSafeEqual(expectedDigest, suppliedDigest)) return null;

  const capability = {} as AuthorizedReleaseProbe;
  Object.defineProperty(capability, AUTHORIZED_RELEASE_PROBE, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  AUTHORIZED_RELEASE_PROBE_INSTANCES.add(capability);
  return Object.freeze(capability);
}

function validatedReleaseProbe(
  value: AuthorizedReleaseProbe | undefined,
): AuthorizedReleaseProbe | null {
  if (value === undefined) return null;
  if (
    !value ||
    typeof value !== "object" ||
    value[AUTHORIZED_RELEASE_PROBE] !== true ||
    !AUTHORIZED_RELEASE_PROBE_INSTANCES.has(value) ||
    !Object.isFrozen(value)
  ) {
    throw invalidInput("config", "release-probe-capability");
  }
  return value;
}

function hasReleaseProbeHeaders(response: Response): boolean {
  return RELEASE_PROBE_HEADERS.some((name) => response.headers.has(name));
}

function validResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function validateLegacyResult(value: LegacyRouteResult): LegacyRouteResult {
  if (
    !value ||
    !validResponse(value.response) ||
    (value.source !== "rpc" && value.source !== "blob") ||
    hasReleaseProbeHeaders(value.response)
  ) {
    throw new ComparisonReadError("invalid-result");
  }
  return value;
}

function validateIndexedResult(
  value: IndexedRouteResult,
  identity: ValidatedRouteIdentity,
): IndexedRouteResult {
  if (
    !value ||
    !validResponse(value.response) ||
    value.source !== "indexed" ||
    hasReleaseProbeHeaders(value.response)
  ) {
    throw new ComparisonReadError("invalid-result");
  }
  try {
    if (!sameScope(validatedScope(value.scope), identity.scope)) {
      throw new ComparisonReadError("invalid-result");
    }
    const evidence = value.scopeEvidence;
    if (
      !evidence ||
      typeof evidence !== "object" ||
      evidence[VALIDATED_RECORD_SCOPE_EVIDENCE] !== true ||
      !VALIDATED_RECORD_SCOPE_EVIDENCE_INSTANCES.has(evidence) ||
      !Object.isFrozen(evidence) ||
      !Object.isFrozen(evidence.recordScopes) ||
      !Number.isSafeInteger(evidence.recordCount) ||
      evidence.recordCount < 0 ||
      evidence.recordCount > 5_000 ||
      !Array.isArray(evidence.recordScopes)
    ) {
      throw new ComparisonReadError("invalid-result");
    }
    const recordScopes =
      evidence.recordScopes.length === 0
        ? (Object.freeze([]) as readonly ReviewedRouteScope[])
        : validatedScope(evidence.recordScopes);
    for (const recordScope of recordScopes) {
      if (
        !identity.scope.some(
          (allowed) => scopeKey(allowed) === scopeKey(recordScope),
        )
      ) {
        throw new ComparisonReadError("invalid-result");
      }
    }
    if (DISCOVERY_ROUTES.has(identity.route) && recordScopes.length > 1) {
      throw new ComparisonReadError("invalid-result");
    }

    const versions = validateScopedProjectionVersions(value.versions, identity);
    const comparisonCheckpoint = value.comparisonCheckpoint
      ? canonicalCheckpoint(value.comparisonCheckpoint)
      : undefined;
    if (
      comparisonCheckpoint &&
      versions.length === 1 &&
      (comparisonCheckpoint.blockNumber !== versions[0]!.version.blockNumber ||
        comparisonCheckpoint.blockHash !== versions[0]!.version.blockHash)
    ) {
      throw new ComparisonReadError("invalid-result");
    }
    const result = Object.freeze({
      ...value,
      scope: identity.scope,
      scopeEvidence: evidence,
      versions,
      ...(comparisonCheckpoint ? { comparisonCheckpoint } : {}),
    });
    indexedProvenance(result, identity.scope);
    return result;
  } catch {
    throw new ComparisonReadError("invalid-result");
  }
}

function validateScopedProjectionVersions(
  value: readonly RouteScopeProjectionVersion[],
  identity: ValidatedRouteIdentity,
): readonly RouteScopeProjectionVersion[] {
  if (!Array.isArray(value) || value.length !== identity.scope.length) {
    throw new ComparisonReadError("invalid-result");
  }
  const selected = new Map<string, RouteScopeProjectionVersion>();
  for (const candidate of value) {
    const scope = validatedScope([candidate])[0]!;
    const key = scopeKey(scope);
    if (
      selected.has(key) ||
      !identity.scope.some((allowed) => scopeKey(allowed) === key)
    ) {
      throw new ComparisonReadError("invalid-result");
    }
    selected.set(
      key,
      Object.freeze({
        ...scope,
        version: canonicalProjectionVersion(candidate.version),
      }),
    );
  }
  return Object.freeze(
    identity.scope.map((scope) => selected.get(scopeKey(scope))!),
  );
}

function validateReadiness(
  value: RouteReadiness,
  identity: ValidatedRouteIdentity,
): RouteReadiness {
  if (!Array.isArray(value) || value.length !== identity.scope.length) {
    throw new ComparisonReadError("invalid-result");
  }
  const selected = new Map<string, RouteScopeReadiness>();
  for (const candidate of value) {
    let scope: readonly ReviewedRouteScope[];
    try {
      scope = validatedScope([candidate]);
    } catch {
      throw new ComparisonReadError("invalid-result");
    }
    const member = scope[0]!;
    const key = scopeKey(member);
    if (
      selected.has(key) ||
      !identity.scope.some((allowed) => scopeKey(allowed) === key) ||
      (candidate.eligibility !== "eligible" &&
        candidate.eligibility !== "ineligible") ||
      !["current", "pending", "stale", "mismatch", "missing"].includes(
        candidate.parity,
      )
    ) {
      throw new ComparisonReadError("invalid-result");
    }
    let version: IndexedProjectionVersion | undefined;
    if (candidate.parity === "current") {
      if (!candidate.version) {
        throw new ComparisonReadError("invalid-result");
      }
      try {
        version = canonicalProjectionVersion(candidate.version);
      } catch {
        throw new ComparisonReadError("invalid-result");
      }
    }
    selected.set(
      key,
      Object.freeze({
        ...member,
        eligibility: candidate.eligibility,
        parity: candidate.parity,
        ...(version ? { version } : {}),
      }),
    );
  }
  return Object.freeze(
    identity.scope.map((scope) => selected.get(scopeKey(scope))!),
  );
}

function validateSnapshotReadiness(
  value: IndexedRouteSnapshot,
  identity: ValidatedRouteIdentity,
): RouteReadiness {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ComparisonReadError("invalid-result");
  }
  return validateReadiness(value.readiness, identity);
}

function currentReadinessVersions(
  readiness: RouteReadiness,
): readonly RouteScopeProjectionVersion[] | null {
  if (
    readiness.length < 1 ||
    readiness.some(
      (member) =>
        member.eligibility !== "eligible" ||
        member.parity !== "current" ||
        !member.version,
    )
  ) {
    return null;
  }
  return Object.freeze(
    readiness.map((member) =>
      Object.freeze({
        model: member.model,
        releaseVersion: member.releaseVersion,
        version: canonicalProjectionVersion(member.version!),
      }),
    ),
  );
}

function sameScopedProjectionVersions(
  readiness: readonly RouteScopeProjectionVersion[],
  indexed: readonly RouteScopeProjectionVersion[],
): boolean {
  return (
    readiness.length === indexed.length &&
    readiness.every((expected, index) => {
      const actual = indexed[index];
      return (
        actual !== undefined &&
        scopeKey(expected) === scopeKey(actual) &&
        sameProjectionVersion(expected.version, actual.version)
      );
    })
  );
}

function comparisonPolicy(
  schema: RouteComparisonSchema = {},
): CanonicalizationPolicy {
  const fields = (value: readonly string[] | undefined) => {
    if (!value) return new Set<string>();
    if (!Array.isArray(value) || value.length > 128) {
      throw invalidInput("config", "comparison-schema");
    }
    const output = new Set<string>();
    for (const field of value) {
      if (
        typeof field !== "string" ||
        field.length < 1 ||
        field.length > 64 ||
        /[\u0000-\u001f\u007f]/u.test(field)
      ) {
        throw invalidInput("config", "comparison-schema");
      }
      output.add(field);
    }
    return output;
  };
  return Object.freeze({
    addressFields: fields(schema.addressFields),
    hashFields: fields(schema.hashFields),
    integerFields: fields(schema.integerFields),
  });
}

function normalizeString(
  value: string,
  field: string | undefined,
  policy: CanonicalizationPolicy,
): string {
  if (
    field &&
    policy.addressFields.has(field) &&
    /^0x[0-9a-fA-F]{40}$/.test(value)
  ) {
    return value.toLowerCase();
  }
  if (
    field &&
    policy.hashFields.has(field) &&
    /^0x[0-9a-fA-F]{64}$/.test(value)
  ) {
    return value.toLowerCase();
  }
  if (
    field &&
    policy.integerFields.has(field) &&
    /^-?\d+$/.test(value) &&
    value.length <= 256
  ) {
    return BigInt(value).toString();
  }
  return value;
}

function normalizeCanonicalValue(
  value: unknown,
  state: { nodes: number },
  depth: number,
  policy: CanonicalizationPolicy,
  field?: string,
  arrayElement = false,
): CanonicalValue | undefined {
  state.nodes += 1;
  if (state.nodes > MAX_CANONICAL_NODES || depth > MAX_CANONICAL_DEPTH) {
    throw invalidInput("config", "route-response-complexity");
  }
  if (value === undefined) return arrayElement ? null : undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return normalizeString(value, field, policy);
  if (typeof value === "number") {
    if (
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    ) {
      throw invalidInput("config", "route-response-number");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      normalizeCanonicalValue(entry, state, depth + 1, policy, field, true)!,
    );
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidInput("config", "route-response-object");
    }
    const output = Object.create(null) as Record<string, CanonicalValue>;
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const normalized = normalizeCanonicalValue(
        (value as Record<string, unknown>)[key],
        state,
        depth + 1,
        policy,
        key,
      );
      if (normalized !== undefined) output[key] = normalized;
    }
    return output;
  }
  throw invalidInput("config", "route-response-type");
}

function normalizedRouteResponse(
  value: unknown,
  schema: RouteComparisonSchema = {},
): CanonicalValue {
  const normalized = normalizeCanonicalValue(
    value,
    { nodes: 0 },
    0,
    comparisonPolicy(schema),
  );
  if (normalized === undefined) {
    throw invalidInput("config", "route-response-root");
  }
  return normalized;
}

export function canonicalizeRouteResponse(
  value: unknown,
  schema: RouteComparisonSchema = {},
): string {
  return JSON.stringify(normalizedRouteResponse(value, schema));
}

export function hashCanonicalRouteResponse(
  value: unknown,
  schema: RouteComparisonSchema = {},
): string {
  const digest = createHash("sha256")
    .update(canonicalizeRouteResponse(value, schema), "utf8")
    .digest("hex");
  return `0x${digest}`;
}

function safePathSegment(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(key) ? `.${key}` : '["<key>"]';
}

function collectMismatchPaths(
  left: CanonicalValue,
  right: CanonicalValue,
  path: string,
  output: string[],
): void {
  if (output.length >= MAX_MISMATCH_PATHS) return;
  if (Object.is(left, right)) return;
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (output.length >= MAX_MISMATCH_PATHS) return;
      if (index >= left.length || index >= right.length) {
        output.push(`${path}[${index}]`);
      } else {
        collectMismatchPaths(
          left[index]!,
          right[index]!,
          `${path}[${index}]`,
          output,
        );
      }
    }
    return;
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const keys = Array.from(
      new Set([...Object.keys(left), ...Object.keys(right)]),
    ).sort();
    for (const key of keys) {
      if (output.length >= MAX_MISMATCH_PATHS) return;
      const nextPath = `${path}${safePathSegment(key)}`;
      if (!(key in left) || !(key in right)) {
        output.push(nextPath);
      } else {
        collectMismatchPaths(left[key]!, right[key]!, nextPath, output);
      }
    }
    return;
  }
  output.push(path);
}

export function compareRouteResponses(
  legacy: unknown,
  indexed: unknown,
  schema: RouteComparisonSchema = {},
): RouteComparison {
  const normalizedLegacy = normalizedRouteResponse(legacy, schema);
  const normalizedIndexed = normalizedRouteResponse(indexed, schema);
  const legacyCanonical = JSON.stringify(normalizedLegacy);
  const indexedCanonical = JSON.stringify(normalizedIndexed);
  const legacyHash = `0x${createHash("sha256").update(legacyCanonical).digest("hex")}`;
  const indexedHash = `0x${createHash("sha256").update(indexedCanonical).digest("hex")}`;
  if (legacyHash === indexedHash) {
    return Object.freeze({
      kind: "match" as const,
      legacyHash,
      indexedHash,
      mismatchPaths: Object.freeze([]) as readonly [],
    });
  }
  const mismatchPaths: string[] = [];
  collectMismatchPaths(normalizedLegacy, normalizedIndexed, "$", mismatchPaths);
  return Object.freeze({
    kind: "mismatch" as const,
    legacyHash,
    indexedHash,
    mismatchPaths: Object.freeze(mismatchPaths),
  });
}

async function boundedJsonBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (
    !/(?:^|\s|;)application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(
      contentType,
    )
  ) {
    throw new ComparisonReadError("non-json");
  }
  const declaredLength = response.headers.get("Content-Length");
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    if (BigInt(declaredLength) > BigInt(MAX_COMPARISON_BODY_BYTES)) {
      throw new ComparisonReadError("body-oversize");
    }
  }

  let clone: Response;
  try {
    clone = response.clone();
  } catch {
    throw new ComparisonReadError("invalid-response");
  }
  if (!clone.body) {
    if (clone.status === 204 || clone.status === 205) return null;
    throw new ComparisonReadError("invalid-json");
  }

  const reader = clone.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_COMPARISON_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ComparisonReadError("body-oversize");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof ComparisonReadError) throw error;
    throw new ComparisonReadError("invalid-json");
  }
}

function copiedResponse(response: Response, headers: Headers): Response {
  let clone: Response;
  try {
    clone = response.clone();
  } catch {
    throw new ComparisonReadError("invalid-response");
  }
  return new Response(clone.body, {
    status: clone.status,
    statusText: clone.statusText,
    headers,
  });
}

type ReleaseProbeObservation = Readonly<{
  shadowOverheadMs?: number;
  shadowParity?: "match" | "mismatch";
  liveFallback?: boolean;
}>;

function releaseProbeResponse(
  response: Response,
  capability: AuthorizedReleaseProbe,
  observation: ReleaseProbeObservation,
): Response {
  if (!AUTHORIZED_RELEASE_PROBE_INSTANCES.has(capability)) {
    throw invalidInput("config", "release-probe-capability");
  }
  const headers = new Headers(response.headers);
  for (const name of RELEASE_PROBE_HEADERS) headers.delete(name);
  for (const name of SHARED_CACHE_HEADERS) headers.delete(name);
  // Vercel must add the cache observation itself after the application returns.
  headers.delete("X-Vercel-Cache");
  headers.set("Cache-Control", "private, no-store");

  if (observation.shadowOverheadMs !== undefined) {
    if (
      !Number.isSafeInteger(observation.shadowOverheadMs) ||
      observation.shadowOverheadMs < 0
    ) {
      throw invalidInput("config", "release-probe-overhead");
    }
    headers.set(
      "x-programmable-shadow-overhead-ms",
      String(observation.shadowOverheadMs),
    );
  }
  if (observation.shadowParity !== undefined) {
    headers.set("x-programmable-shadow-parity", observation.shadowParity);
  }
  if (observation.liveFallback !== undefined) {
    headers.set(
      "x-programmable-live-fallback",
      observation.liveFallback ? "true" : "false",
    );
  }
  return copiedResponse(response, headers);
}

function withoutProjectionHeaders(response: Response): Headers {
  const headers = new Headers(response.headers);
  for (const name of PROJECTION_HEADERS) headers.delete(name);
  return headers;
}

function fallbackResponse(result: LegacyRouteResult): Response {
  const headers = withoutProjectionHeaders(result.response);
  for (const name of SHARED_CACHE_HEADERS) headers.delete(name);
  headers.set("Cache-Control", "private, no-store");
  for (const [name, value] of Object.entries(
    provenanceHeaders({ source: result.source }),
  )) {
    headers.set(name, value);
  }
  return copiedResponse(result.response, headers);
}

function indexedProvenance(
  result: IndexedRouteResult,
  scope: readonly ReviewedRouteScope[],
): ReadProvenance {
  if (scope.length !== 1) {
    return {
      source: "indexed",
      reconciledAt: result.reconciledAt,
    };
  }
  const version = result.versions[0]!.version;
  return {
    source: "indexed",
    projectionBlock: version.blockNumber,
    projectionHash: version.blockHash as `0x${string}`,
    projectionLag: result.projectionLag,
    reconciledAt: result.reconciledAt,
    releaseVersion: scope[0]!.releaseVersion,
  };
}

function indexedResponse(
  result: IndexedRouteResult,
  scope: readonly ReviewedRouteScope[],
): Response {
  const headers = withoutProjectionHeaders(result.response);
  const provenance: ReadProvenance = {
    ...indexedProvenance(result, scope),
  };
  for (const [name, value] of Object.entries(provenanceHeaders(provenance))) {
    headers.set(name, value);
  }
  return copiedResponse(result.response, headers);
}

function unavailableResponse(): Response {
  return Response.json(
    { error: "read_temporarily_unavailable" },
    {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": "1",
      },
    },
  );
}

async function safeRecord(
  input: CoordinatedRouteRead,
  event: RouteComparisonEvent,
): Promise<void> {
  if (!input.recordComparison) return;
  try {
    await input.recordComparison(event);
  } catch {
    // Comparison telemetry must never affect the public response.
  }
}

function incomparableEvent(
  input: CoordinatedRouteRead,
  identity: ValidatedRouteIdentity,
  reason: Extract<RouteComparisonEvent, { kind: "incomparable" }>["reason"],
  readiness?: RouteReadiness,
): RouteComparisonEvent {
  return Object.freeze({
    kind: "incomparable" as const,
    route: identity.route,
    scope: identity.scope,
    ...(readiness ? { readiness } : {}),
    reason,
  });
}

function normalizedSemanticHeaders(response: Response) {
  const contentType = response.headers.get("Content-Type");
  const cacheControl = response.headers.get("Cache-Control");
  return {
    contentType: contentType?.trim().toLowerCase() ?? null,
    cacheControl:
      cacheControl
        ?.split(",")
        .map((directive) => directive.trim().toLowerCase())
        .filter(Boolean)
        .sort()
        .join(",") ?? null,
  };
}

function comparisonReason(
  error: unknown,
): Extract<RouteComparisonEvent, { kind: "incomparable" }>["reason"] {
  return error instanceof ComparisonReadError
    ? error.reason
    : "invalid-response";
}

async function recordedComparison(
  input: CoordinatedRouteRead,
  event: RouteComparisonEvent,
): Promise<RouteComparisonEvent> {
  await safeRecord(input, event);
  return event;
}

async function compareShadowResults(
  input: CoordinatedRouteRead,
  identity: ValidatedRouteIdentity,
  readiness: RouteReadiness,
  legacy: LegacyRouteResult,
  indexed: IndexedRouteResult,
): Promise<RouteComparisonEvent> {
  if (!legacy.checkpoint || !indexed.comparisonCheckpoint) {
    return recordedComparison(
      input,
      incomparableEvent(input, identity, "checkpoint-missing", readiness),
    );
  }

  let legacyCheckpoint: RouteCheckpoint;
  let indexedCheckpoint: RouteCheckpoint;
  try {
    legacyCheckpoint = canonicalCheckpoint(legacy.checkpoint);
    indexedCheckpoint = canonicalCheckpoint(indexed.comparisonCheckpoint);
  } catch {
    return recordedComparison(
      input,
      incomparableEvent(input, identity, "invalid-result", readiness),
    );
  }
  if (
    legacyCheckpoint.blockNumber !== indexedCheckpoint.blockNumber ||
    legacyCheckpoint.blockHash !== indexedCheckpoint.blockHash
  ) {
    return recordedComparison(
      input,
      incomparableEvent(input, identity, "checkpoint-mismatch", readiness),
    );
  }

  try {
    const [legacyBody, indexedBody] = await Promise.all([
      boundedJsonBody(legacy.response),
      boundedJsonBody(indexed.response),
    ]);
    const comparison = compareRouteResponses(
      {
        status: legacy.response.status,
        headers: normalizedSemanticHeaders(legacy.response),
        body: legacyBody,
      },
      {
        status: indexed.response.status,
        headers: normalizedSemanticHeaders(indexed.response),
        body: indexedBody,
      },
      input.comparisonSchema,
    );
    return recordedComparison(
      input,
      Object.freeze({
        ...comparison,
        route: identity.route,
        scope: identity.scope,
        readiness,
        blockNumber: legacyCheckpoint.blockNumber,
        blockHash: legacyCheckpoint.blockHash,
      }),
    );
  } catch (error) {
    return recordedComparison(
      input,
      incomparableEvent(input, identity, comparisonReason(error), readiness),
    );
  }
}

async function runShadowComparison(
  input: CoordinatedRouteRead,
  identity: ValidatedRouteIdentity,
  readModel: ServerReadModel,
  legacy: LegacyRouteResult,
): Promise<RouteComparisonEvent> {
  let snapshot: IndexedRouteSnapshot;
  let readiness: RouteReadiness;
  try {
    snapshot = await readModel.repeatableReadSnapshot(input.indexedSnapshot);
    readiness = validateSnapshotReadiness(snapshot, identity);
  } catch (error) {
    return recordedComparison(
      input,
      incomparableEvent(
        input,
        identity,
        error instanceof ComparisonReadError
          ? error.reason
          : "readiness-unavailable",
      ),
    );
  }
  if (readiness.some((member) => member.eligibility !== "eligible")) {
    return recordedComparison(
      input,
      incomparableEvent(input, identity, "model-ineligible", readiness),
    );
  }

  if (!snapshot.indexed) {
    return recordedComparison(
      input,
      incomparableEvent(input, identity, "indexed-unavailable", readiness),
    );
  }

  let indexed: IndexedRouteResult;
  try {
    indexed = validateIndexedResult(snapshot.indexed, identity);
  } catch (error) {
    return recordedComparison(
      input,
      incomparableEvent(
        input,
        identity,
        error instanceof ComparisonReadError
          ? error.reason
          : "indexed-unavailable",
        readiness,
      ),
    );
  }
  return compareShadowResults(input, identity, readiness, legacy, indexed);
}

async function runSynchronousShadowProbe(
  input: CoordinatedRouteRead,
  identity: ValidatedRouteIdentity,
  readModel: ServerReadModel,
  legacy: LegacyRouteResult,
  capability: AuthorizedReleaseProbe,
): Promise<Response> {
  const startedAt = performance.now();
  let observedEvent: RouteComparisonEvent | undefined;

  let comparisonResponse: Response | undefined;
  try {
    comparisonResponse = legacy.response.clone();
  } catch {
    const event = incomparableEvent(input, identity, "invalid-response");
    observedEvent = event;
    await safeRecord(input, event);
  }
  if (comparisonResponse) {
    observedEvent = await runShadowComparison(input, identity, readModel, {
      ...legacy,
      response: comparisonResponse,
    });
  }

  const elapsed = Math.ceil(performance.now() - startedAt);
  const parity =
    observedEvent?.kind === "match" || observedEvent?.kind === "mismatch"
      ? observedEvent.kind
      : undefined;
  return releaseProbeResponse(legacy.response, capability, {
    shadowOverheadMs: Math.max(0, elapsed),
    ...(parity ? { shadowParity: parity } : {}),
  });
}

async function runSynchronousLiveProbe(
  input: CoordinatedRouteRead,
  identity: ValidatedRouteIdentity,
  readiness: RouteReadiness,
  indexed: IndexedRouteResult,
  selectedResponse: Response,
  capability: AuthorizedReleaseProbe,
): Promise<Response> {
  const startedAt = performance.now();
  let observedEvent: RouteComparisonEvent | undefined;

  try {
    const legacy = validateLegacyResult(await input.legacy());
    observedEvent = await compareShadowResults(
      input,
      identity,
      readiness,
      legacy,
      indexed,
    );
  } catch (error) {
    observedEvent = incomparableEvent(
      input,
      identity,
      comparisonReason(error),
      readiness,
    );
    await safeRecord(input, observedEvent);
  }

  const elapsed = Math.ceil(performance.now() - startedAt);
  const parity =
    observedEvent?.kind === "match" || observedEvent?.kind === "mismatch"
      ? observedEvent.kind
      : undefined;
  return releaseProbeResponse(selectedResponse, capability, {
    shadowOverheadMs: Math.max(0, elapsed),
    ...(parity ? { shadowParity: parity } : {}),
    liveFallback: false,
  });
}

function scheduleShadowRead(
  input: CoordinatedRouteRead,
  identity: ValidatedRouteIdentity,
  readModel: ServerReadModel,
  legacy: LegacyRouteResult,
): void {
  const scheduler = input.scheduleShadowComparison;
  if (!scheduler) throw invalidInput("config", "shadow-scheduler");

  const schedule = (task: () => Promise<void>) => {
    try {
      const scheduled = scheduler(task);
      if (scheduled && typeof scheduled.then === "function") {
        void scheduled.catch(() => undefined);
      }
    } catch {
      // Shadow telemetry must never replace or mutate the legacy response.
    }
  };

  let comparisonResponse: Response;
  try {
    comparisonResponse = legacy.response.clone();
  } catch {
    schedule(() =>
      safeRecord(input, incomparableEvent(input, identity, "invalid-response")),
    );
    return;
  }

  const comparisonLegacy: LegacyRouteResult = {
    ...legacy,
    response: comparisonResponse,
  };
  const task = async () => {
    try {
      await runShadowComparison(input, identity, readModel, comparisonLegacy);
    } catch {
      await safeRecord(
        input,
        incomparableEvent(input, identity, "invalid-response"),
      );
    }
  };
  schedule(task);
}

async function fallbackOrUnavailable(
  input: CoordinatedRouteRead,
  fallbackEnabled: boolean,
): Promise<Readonly<{ response: Response; usedFallback: boolean }>> {
  if (!fallbackEnabled) {
    return Object.freeze({
      response: unavailableResponse(),
      usedFallback: false,
    });
  }
  try {
    return Object.freeze({
      response: fallbackResponse(validateLegacyResult(await input.legacy())),
      usedFallback: true,
    });
  } catch {
    return Object.freeze({
      response: unavailableResponse(),
      usedFallback: false,
    });
  }
}

async function liveFallbackOrUnavailable(
  input: CoordinatedRouteRead,
  fallbackEnabled: boolean,
  releaseProbe: AuthorizedReleaseProbe | null,
): Promise<Response> {
  const outcome = await fallbackOrUnavailable(input, fallbackEnabled);
  if (!releaseProbe) return outcome.response;
  return releaseProbeResponse(
    outcome.response,
    releaseProbe,
    outcome.usedFallback ? { liveFallback: true } : {},
  );
}

export async function coordinateRouteRead(
  input: CoordinatedRouteRead,
): Promise<Response> {
  const identity = validateIdentity(input);
  const releaseProbe = validatedReleaseProbe(input.releaseProbe);
  const config = loadDataPipelineConfig();
  const routeEnabled = config.flags[ROUTE_FLAGS[identity.route]];
  if (!routeEnabled) {
    const legacy = validateLegacyResult(await input.legacy()).response;
    return releaseProbe
      ? releaseProbeResponse(legacy, releaseProbe, {})
      : legacy;
  }

  // Configuration errors are intentionally not converted into a fallback.
  // Enabling an indexed route without its database must fail closed.
  const readModel = await getServerReadModel();
  if (!readModel) throw invalidInput("config", "indexed-read-model");

  if (config.flags.INDEXED_READ_SHADOW_COMPARE_ENABLED) {
    if (!releaseProbe && !input.scheduleShadowComparison) {
      throw invalidInput("config", "shadow-scheduler");
    }
    const legacy = validateLegacyResult(await input.legacy());
    if (releaseProbe) {
      return runSynchronousShadowProbe(
        input,
        identity,
        readModel,
        legacy,
        releaseProbe,
      );
    }
    scheduleShadowRead(input, identity, readModel, legacy);
    return legacy.response;
  }

  let snapshot: IndexedRouteSnapshot;
  let readiness: RouteReadiness;
  try {
    snapshot = await readModel.repeatableReadSnapshot(input.indexedSnapshot);
    readiness = validateSnapshotReadiness(snapshot, identity);
  } catch {
    return liveFallbackOrUnavailable(
      input,
      config.flags.INDEXED_READ_LIVE_FALLBACK_ENABLED,
      releaseProbe,
    );
  }
  const readyVersions = currentReadinessVersions(readiness);
  if (!readyVersions) {
    return liveFallbackOrUnavailable(
      input,
      config.flags.INDEXED_READ_LIVE_FALLBACK_ENABLED,
      releaseProbe,
    );
  }
  if (!snapshot.indexed) {
    return liveFallbackOrUnavailable(
      input,
      config.flags.INDEXED_READ_LIVE_FALLBACK_ENABLED,
      releaseProbe,
    );
  }

  let indexed: IndexedRouteResult;
  let response: Response;
  try {
    indexed = validateIndexedResult(snapshot.indexed, identity);
    if (!sameScopedProjectionVersions(readyVersions, indexed.versions)) {
      throw new ComparisonReadError("checkpoint-mismatch");
    }
    response = indexedResponse(indexed, identity.scope);
  } catch {
    return liveFallbackOrUnavailable(
      input,
      config.flags.INDEXED_READ_LIVE_FALLBACK_ENABLED,
      releaseProbe,
    );
  }

  if (!releaseProbe) return response;
  return runSynchronousLiveProbe(
    input,
    identity,
    readiness,
    indexed,
    response,
    releaseProbe,
  );
}
