import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "./canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "./hashing";
import type {
  ProjectionTargetLaneConfigurationV1,
  ProjectionTargetLaneV1,
} from "./protocol";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const LANES = Object.freeze([
  "registry.publication",
  "website.entitlement",
  "registry.custom-launched",
  "website.custom-launched",
] as const);

export interface ProjectionTargetConformanceFixtureV1 {
  readonly lane: ProjectionTargetLaneV1;
  readonly canonicalWrite: string;
}

export interface ProjectionTargetConformanceSubjectV1 {
  request(path: string, init: RequestInit): Promise<Response>;
}

export interface ProjectionTargetConformanceReportV1 {
  readonly schemaVersion: "programmable.projection-target-conformance-report.v1";
  readonly checkedLanes: readonly ProjectionTargetLaneV1[];
  readonly assertionCount: number;
  readonly passed: true;
}

/**
 * Test-runner-neutral conformance suite for Registry and Website target repos.
 * Callers provide one genuine approval-service write fixture per lane and a
 * test workload credential; the report never contains either credential or
 * projection bytes.
 */
export async function runProjectionTargetConformanceSuiteV1(input: Readonly<{
  subject: ProjectionTargetConformanceSubjectV1;
  lanes: readonly ProjectionTargetLaneConfigurationV1[];
  registryV2EndpointPath?: string;
  authorization: string;
  fixtures: readonly ProjectionTargetConformanceFixtureV1[];
}>): Promise<Readonly<ProjectionTargetConformanceReportV1>> {
  if (input.subject === null || typeof input.subject !== "object"
    || typeof input.subject.request !== "function") {
    throw new TypeError("projection target conformance subject is invalid");
  }
  const authorization = safeAuthorization(input.authorization);
  const configurations = laneMap(input.lanes);
  const fixtures = fixtureMap(input.fixtures, configurations);
  const checkedLanes = LANES.filter((lane) => configurations.has(lane));
  const registryPath = configurations.has("registry.custom-launched")
    ? registryEndpointPath(input.registryV2EndpointPath)
    : null;
  let assertions = 0;

  for (const lane of checkedLanes) {
    const configuration = configurations.get(lane)!;
    const fixture = fixtures.get(lane)!;
    const write = fixture.write;
    const projectionKey = stringField(write, "projectionKey");
    const path = routePath(lane, projectionKey, registryPath);
    const readHeaders = headers(configuration, authorization);

    const absent = await input.subject.request(path, {
      method: "GET",
      headers: readHeaders,
      redirect: "error",
    });
    assertStatus(absent, 404, `${lane} absent read`);
    assertions += 1;

    const created = await input.subject.request(path, {
      method: "PUT",
      headers: {
        ...readHeaders,
        "content-type": "application/json; charset=utf-8",
        "idempotency-key": fixture.idempotencyKey,
      },
      body: fixture.canonicalWrite,
      redirect: "error",
    });
    assertStatus(created, 201, `${lane} create`);
    const createdBody = await exactJsonResponse(created, `${lane} create`);
    assertAcknowledgement(createdBody, fixture, configuration);
    assertions += 3;

    const replay = await input.subject.request(path, {
      method: "PUT",
      headers: {
        ...readHeaders,
        "content-type": "application/json; charset=utf-8",
        "idempotency-key": fixture.idempotencyKey,
      },
      body: fixture.canonicalWrite,
      redirect: "error",
    });
    assertStatus(replay, 200, `${lane} replay`);
    const replayBody = await exactJsonResponse(replay, `${lane} replay`);
    if (canonicalizeJson(replayBody) !== canonicalizeJson(createdBody)) {
      throw new TypeError(`${lane} exact replay changed its acknowledgement`);
    }
    assertions += 3;

    const read = await input.subject.request(path, {
      method: "GET",
      headers: readHeaders,
      redirect: "error",
    });
    assertStatus(read, 200, `${lane} readback`);
    const readBody = await exactJsonResponse(read, `${lane} readback`);
    assertReadback(readBody, fixture, configuration);
    assertions += 3;
  }

  const firstLane = checkedLanes[0]!;
  const first = fixtures.get(firstLane)!;
  const firstConfiguration = configurations.get(firstLane)!;
  const firstPath = routePath(
    firstLane,
    stringField(first.write, "projectionKey"),
    registryPath,
  );
  const unauthenticated = await input.subject.request(firstPath, {
    method: "GET",
    headers: {
      ...headers(firstConfiguration, authorization),
      authorization: "Bearer invalid-projection-target-conformance-token",
    },
    redirect: "error",
  });
  assertStatus(unauthenticated, 401, "invalid credential");
  assertions += 1;

  const wrongAudience = await input.subject.request(firstPath, {
    method: "GET",
    headers: {
      ...headers(firstConfiguration, authorization),
      "x-programmable-audience": `${firstConfiguration.audience}-wrong`,
    },
    redirect: "error",
  });
  assertStatus(wrongAudience, 403, "wrong audience");
  assertions += 1;

  const wrongTarget = await input.subject.request(firstPath, {
    method: "GET",
    headers: {
      ...headers(firstConfiguration, authorization),
      "x-programmable-target-binding": canonicalSha256(
        "programmable.projection-target-conformance-wrong-target.v1",
        { target: firstConfiguration.targetBindingHash },
      ),
    },
    redirect: "error",
  });
  assertStatus(wrongTarget, 403, "wrong target");
  assertions += 1;

  const nonCanonical = await input.subject.request(firstPath, {
    method: "PUT",
    headers: {
      ...headers(firstConfiguration, authorization),
      "content-type": "application/json; charset=utf-8",
      "idempotency-key": first.idempotencyKey,
    },
    body: `${first.canonicalWrite}\n`,
    redirect: "error",
  });
  assertStatus(nonCanonical, 400, "non-canonical JSON");
  assertions += 1;

  const firstV1Lane = checkedLanes.find((lane) =>
    lane === "registry.publication" || lane === "website.entitlement");
  if (firstV1Lane !== undefined) {
    const v1Fixture = fixtures.get(firstV1Lane)!;
    const v1Configuration = configurations.get(firstV1Lane)!;
    const conflicting = conflictingV1Write(v1Fixture.write, firstV1Lane);
    const conflictingPath = routePath(
      firstV1Lane,
      stringField(conflicting, "projectionKey"),
      registryPath,
    );
    const conflict = await input.subject.request(conflictingPath, {
      method: "PUT",
      headers: {
        ...headers(v1Configuration, authorization),
        "content-type": "application/json; charset=utf-8",
        "idempotency-key": v1Fixture.idempotencyKey,
      },
      body: canonicalizeJson(conflicting),
      redirect: "error",
    });
    assertStatus(conflict, 409, "idempotency conflict");
    assertions += 1;
  }

  const method = await input.subject.request(firstPath, {
    method: "POST",
    headers: headers(firstConfiguration, authorization),
    redirect: "manual",
  });
  assertStatus(method, 405, "method gate");
  if (method.headers.get("allow") !== "GET, PUT" || method.headers.get("location") !== null) {
    throw new TypeError("projection target method gate is unsafe");
  }
  assertions += 3;

  return Object.freeze({
    schemaVersion: "programmable.projection-target-conformance-report.v1" as const,
    checkedLanes: Object.freeze([...checkedLanes]),
    assertionCount: assertions,
    passed: true as const,
  });
}

interface NormalizedFixtureV1 extends ProjectionTargetConformanceFixtureV1 {
  readonly write: Readonly<Record<string, JsonValue>>;
  readonly idempotencyKey: Sha256Digest;
  readonly requestDigest: Sha256Digest;
}

function fixtureMap(
  values: readonly ProjectionTargetConformanceFixtureV1[],
  lanes: ReadonlyMap<ProjectionTargetLaneV1, ProjectionTargetLaneConfigurationV1>,
): ReadonlyMap<ProjectionTargetLaneV1, Readonly<NormalizedFixtureV1>> {
  const result = new Map<ProjectionTargetLaneV1, Readonly<NormalizedFixtureV1>>();
  const idempotency = new Set<string>();
  for (const value of values) {
    if (!LANES.includes(value.lane) || result.has(value.lane)) {
      throw new TypeError("projection target conformance fixture lane is invalid or duplicated");
    }
    if (typeof value.canonicalWrite !== "string" || Buffer.byteLength(value.canonicalWrite) > 4_194_304) {
      throw new TypeError("projection target conformance fixture is invalid");
    }
    const parsed = parseStrictJson(value.canonicalWrite, {
      maximumBytes: 4_194_304,
      maximumDepth: 128,
    });
    if (canonicalizeJson(parsed) !== value.canonicalWrite || parsed === null
      || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new TypeError("projection target conformance fixture is not canonical JSON");
    }
    const write = parsed;
    const configuration = lanes.get(value.lane)!;
    if (
      write.targetBindingHash !== configuration.targetBindingHash
      || (value.lane.endsWith(".custom-launched")
        ? write.projectionKind !== value.lane
        : write.topic !== value.lane)
    ) throw new TypeError("projection target conformance fixture crosses its lane");
    const idempotencyKey = digest(write.idempotencyKey, "conformance idempotency key");
    const requestDigest = digest(write.requestDigest, "conformance request digest");
    if (!idempotency.add(idempotencyKey)) {
      throw new TypeError("projection target conformance fixtures reuse an idempotency key");
    }
    result.set(value.lane, Object.freeze({ ...value, write, idempotencyKey, requestDigest }));
  }
  if (
    result.size !== lanes.size
    || [...lanes.keys()].some((lane) => !result.has(lane))
  ) {
    throw new TypeError("projection target conformance fixtures do not match configured lanes");
  }
  return result;
}

function laneMap(
  values: readonly ProjectionTargetLaneConfigurationV1[],
): ReadonlyMap<ProjectionTargetLaneV1, ProjectionTargetLaneConfigurationV1> {
  const result = new Map<ProjectionTargetLaneV1, ProjectionTargetLaneConfigurationV1>();
  for (const value of values) {
    if (!LANES.includes(value.lane) || result.has(value.lane)
      || typeof value.audience !== "string" || value.audience.length < 1
      || value.audience.length > 256 || /[\u0000-\u001f\u007f]/u.test(value.audience)) {
      throw new TypeError("projection target conformance lane is invalid or duplicated");
    }
    digest(value.targetBindingHash, "conformance target binding");
    result.set(value.lane, Object.freeze({ ...value }));
  }
  if (result.size < 1 || result.size > LANES.length) {
    throw new TypeError("projection target conformance requires one or more lane bindings");
  }
  return result;
}

function assertAcknowledgement(
  value: JsonValue,
  fixture: Readonly<NormalizedFixtureV1>,
  configuration: ProjectionTargetLaneConfigurationV1,
): void {
  const record = jsonRecord(value, "projection target acknowledgement");
  if (
    record.targetBindingHash !== configuration.targetBindingHash
    || record.idempotencyKey !== fixture.idempotencyKey
    || record.requestDigest !== fixture.requestDigest
    || record.projectionKey !== fixture.write.projectionKey
    || (fixture.lane.endsWith(".custom-launched")
      ? record.projectionKind !== fixture.lane
      : record.topic !== fixture.lane)
    || typeof record.externalReference !== "string"
    || /^https?:\/\//iu.test(record.externalReference)
    || typeof record.targetRevision !== "string"
  ) throw new TypeError(`${fixture.lane} acknowledgement is not exact`);
}

function assertReadback(
  value: JsonValue,
  fixture: Readonly<NormalizedFixtureV1>,
  configuration: ProjectionTargetLaneConfigurationV1,
): void {
  const record = jsonRecord(value, "projection target readback");
  const expectedPayload = fixture.lane.endsWith(".custom-launched")
    ? fixture.write.record
    : fixture.write.projection;
  const observedPayload = fixture.lane.endsWith(".custom-launched")
    ? record.record
    : record.projection;
  if (
    record.targetBindingHash !== configuration.targetBindingHash
    || record.idempotencyKey !== fixture.idempotencyKey
    || record.projectionKey !== fixture.write.projectionKey
    || expectedPayload === undefined
    || observedPayload === undefined
    || canonicalizeJson(observedPayload) !== canonicalizeJson(expectedPayload)
    || typeof record.externalReference !== "string"
    || /^https?:\/\//iu.test(record.externalReference)
  ) throw new TypeError(`${fixture.lane} readback is not exact`);
}

function conflictingV1Write(
  value: Readonly<Record<string, JsonValue>>,
  lane: ProjectionTargetLaneV1,
): Readonly<Record<string, JsonValue>> {
  if (value.schemaVersion !== "programmable.registry-website-projection-write.v1") {
    throw new TypeError("registry conformance fixture is not v1");
  }
  const { requestDigest: _ignored, ...withoutRequestDigest } = value;
  void _ignored;
  const originalProjection = value.projection as JsonValue;
  const entitlementConflict = lane === "website.entitlement"
    ? conflictingWebsiteEntitlementProjection(originalProjection)
    : null;
  const projectionKey = entitlementConflict?.projectionKey
    ?? `${stringField(value, "projectionKey")}:conflict`;
  const projection = entitlementConflict?.projection ?? value.projection;
  const mutated = Object.freeze({
    ...withoutRequestDigest,
    projectionKey,
    projection,
    projectionDigest: canonicalSha256(
      "programmable.registry-website-projection-record.v1",
      projection as JsonValue,
    ),
  });
  return Object.freeze({
    ...mutated,
    requestDigest: canonicalSha256(
      "programmable.registry-website-projection-write.v1",
      mutated,
    ),
  });
}

function conflictingWebsiteEntitlementProjection(value: JsonValue): Readonly<{
  projectionKey: Sha256Digest;
  projection: Readonly<Record<string, JsonValue>>;
}> {
  const projection = jsonRecord(value, "website entitlement projection");
  const generation = stringField(projection, "websiteProjectionGeneration");
  if (!/^[1-9][0-9]*$/u.test(generation)) {
    throw new TypeError("website entitlement generation is invalid");
  }
  const changed: Readonly<Record<string, JsonValue>> = Object.freeze({
    ...projection,
    websiteProjectionGeneration: String(BigInt(generation) + 1n),
  });
  const authorityKeys = [
    "decisionReceiptHash", "signedReceiptArtifactHash", "approvedLaunchCapabilityIds",
    "approvedChainProfiles", "approvedChainProfileSetHash",
    "chainProfileRegistrySnapshotHash", "selectedChainProfileBindingHash",
    "chainProfileId", "chainProfileHash", "launchCapabilityIds",
    "launchCapabilityBindingHash", "launchArtifactCommitmentHash",
    "launchArtifactManifestHash", "publicSourceAuthorityHash",
    "exactSourceRevisionBindingHash", "runnerEvidenceDigest",
    "runnerAuthenticationEvidenceDigest", "launcherWallet", "launcherExecutionMode",
    "launcherAuthorizationCommitmentHash", "launcherAuthorizationRouteHash",
    "executionBindingHash", "executionAuthorizationPolicyHash",
    "feeEnforcementCoverageHash", "permitIssuanceGeneration",
    "websiteProjectionGeneration", "validFrom", "validUntil",
  ] as const;
  const authority: Record<string, JsonValue> = {};
  for (const key of authorityKeys) {
    const entry = changed[key];
    if (entry === undefined) throw new TypeError("website entitlement authority is incomplete");
    authority[key] = entry;
  }
  const projectionKey = canonicalSha256(
    "programmable.website-launch-entitlement-authority.v1",
    authority,
  );
  const deduplicationKey = canonicalSha256(
    "programmable.website-launch-entitlement-deduplication.v1",
    {
      decisionReceiptHash: changed.decisionReceiptHash!,
      launchArtifactCommitmentHash: changed.launchArtifactCommitmentHash!,
      launchEntitlementBindingHash: projectionKey,
      permitIssuanceGeneration: changed.permitIssuanceGeneration!,
      websiteProjectionGeneration: changed.websiteProjectionGeneration!,
    },
  );
  const { outboxId: _ignoredOutboxId, ...withoutOldOutbox } = changed;
  void _ignoredOutboxId;
  const withoutOutboxId = Object.freeze({
    ...withoutOldOutbox,
    launchEntitlementBindingHash: projectionKey,
    deduplicationKey,
  });
  return Object.freeze({
    projectionKey,
    projection: Object.freeze({
      ...withoutOutboxId,
      outboxId: canonicalSha256(
        "programmable.website-launch-entitlement-outbox.v1",
        withoutOutboxId,
      ),
    }),
  });
}

function headers(
  configuration: ProjectionTargetLaneConfigurationV1,
  authorization: string,
): Record<string, string> {
  return {
    accept: "application/json",
    authorization,
    "x-programmable-audience": configuration.audience,
    "x-programmable-target-binding": configuration.targetBindingHash,
    ...(configuration.lane.endsWith(".custom-launched")
      ? { "x-programmable-projection-kind": configuration.lane }
      : {}),
  };
}

function routePath(
  lane: ProjectionTargetLaneV1,
  projectionKey: string,
  registryEndpointPath: string | null,
): string {
  const encoded = encodeURIComponent(projectionKey);
  if (lane === "registry.publication") return `/v1/internal/projections/registry/${encoded}`;
  if (lane === "website.entitlement") return `/v1/internal/projections/website-entitlements/${encoded}`;
  if (lane === "registry.custom-launched") {
    if (registryEndpointPath === null) {
      throw new TypeError("registry v2 conformance route is unavailable");
    }
    return `${registryEndpointPath}/v2/custom-launches/${encoded}`;
  }
  return `/v2/internal/projections/custom-launches/${encoded}`;
}

async function exactJsonResponse(response: Response, label: string): Promise<JsonValue> {
  if (response.headers.get("location") !== null
    || response.headers.get("cache-control") !== "no-store"
    || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
      !== "application/json") {
    throw new TypeError(`${label} response headers are unsafe`);
  }
  const body = await response.text();
  const parsed = parseStrictJson(body, { maximumBytes: 4_194_304, maximumDepth: 128 });
  if (canonicalizeJson(parsed) !== body) throw new TypeError(`${label} response is not canonical JSON`);
  return parsed;
}

function assertStatus(response: Response, expected: number, label: string): void {
  if (response.status !== expected || response.headers.get("location") !== null) {
    throw new TypeError(`${label} returned HTTP ${response.status}, expected ${expected}`);
  }
}

function registryEndpointPath(value: string | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.endsWith("/")
    || value.includes("//") || /[\s?#\u0000]/u.test(value)) {
    throw new TypeError("projection target conformance registry endpoint path is invalid");
  }
  return value;
}

function safeAuthorization(value: string): string {
  if (!value.startsWith("Bearer ") || value.length < 28 || value.length > 8_200
    || /[\r\n\u0000]/u.test(value)) {
    throw new TypeError("projection target conformance authorization is invalid");
  }
  return value;
}

function stringField(value: Readonly<Record<string, JsonValue>>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length < 1) {
    throw new TypeError(`projection target conformance ${key} is invalid`);
  }
  return field;
}

function jsonRecord(value: JsonValue, label: string): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function digest(value: unknown, label: string): Sha256Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Sha256Digest;
}
