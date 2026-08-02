import "server-only";

import type {
  IndexedChartDataV2,
  IndexedClassicV3ProfileDataV2,
  IndexedCreatorProfileDataV2,
  IndexedExploreListDataV2,
  IndexedLaunchLookupDataV2,
  IndexedRouteEnvelopeV2,
  IndexedRowSourceV2,
  IndexedStockPairedProfileDataV2,
  IndexedTokenDetailDataV2,
} from "./route-adapters.server";
import type {
  IndexedRouteSnapshotQueries,
} from "./postgres-read-model.server";
import type {
  PostgresParameter,
  PostgresTransaction,
} from "./postgres";
import type { ReviewedRouteScope } from "./route-coordinator.server";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BYTES32 = /^0x[0-9a-f]{64}$/;

type BoundaryRow = Record<string, unknown>;
type ReadyEnvelope<T> = Extract<IndexedRouteEnvelopeV2<T>, { status: "ready" }>;

const DISCOVERY_SCOPE = Object.freeze([
  Object.freeze({ model: "classic", releaseVersion: "classic-v2" }),
  Object.freeze({ model: "classic", releaseVersion: "classic-v3" }),
  Object.freeze({ model: "stock-paired", releaseVersion: "stock-paired-v1" }),
  Object.freeze({ model: "stock-paired", releaseVersion: "stock-paired-v2" }),
  Object.freeze({ model: "stock-paired", releaseVersion: "stock-paired-v3" }),
]) satisfies readonly ReviewedRouteScope[];

const CLASSIC_V3_SCOPE = Object.freeze([
  Object.freeze({ model: "classic", releaseVersion: "classic-v3" }),
]) satisfies readonly ReviewedRouteScope[];

const STOCK_SCOPE = Object.freeze([
  Object.freeze({ model: "stock-paired", releaseVersion: "stock-paired-v1" }),
  Object.freeze({ model: "stock-paired", releaseVersion: "stock-paired-v2" }),
  Object.freeze({ model: "stock-paired", releaseVersion: "stock-paired-v3" }),
]) satisfies readonly ReviewedRouteScope[];

function fail(field: string): never {
  throw new Error(`Invalid indexed public route ${field}`);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(field);
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(field);
  return value;
}

function nonnegativeInteger(value: unknown, field: string): string {
  if (typeof value === "bigint") {
    if (value < 0n) fail(field);
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) fail(field);
    return String(value);
  }
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)$/.test(value) ||
    value.length > 78
  ) {
    fail(field);
  }
  return value;
}

function integerNumber(value: unknown, field: string): number {
  const parsed = Number(nonnegativeInteger(value, field));
  if (!Number.isSafeInteger(parsed)) fail(field);
  return parsed;
}

function byteaBytes32(value: unknown, field: string): `0x${string}` {
  if (value instanceof Uint8Array) {
    if (value.byteLength !== 32) fail(field);
    return `0x${Array.from(value, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")}`;
  }
  if (typeof value === "string") {
    const normalized = value.startsWith("\\x")
      ? `0x${value.slice(2).toLowerCase()}`
      : value.toLowerCase();
    if (BYTES32.test(normalized)) return normalized as `0x${string}`;
  }
  fail(field);
}

function scopeKey(scope: ReviewedRouteScope): string {
  return `${scope.model}:${scope.releaseVersion}`;
}

function parsedScope(value: unknown, field: string): ReviewedRouteScope {
  const candidate = object(value, field);
  const model = candidate.model;
  const releaseVersion = candidate.releaseVersion;
  if (
    (model !== "classic" && model !== "stock-paired") ||
    ![
      "classic-v2",
      "classic-v3",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ].includes(String(releaseVersion)) ||
    (String(releaseVersion).startsWith("classic-")
      ? model !== "classic"
      : model !== "stock-paired")
  ) {
    fail(field);
  }
  return {
    model,
    releaseVersion: releaseVersion as ReviewedRouteScope["releaseVersion"],
  };
}

function exactScopes(
  value: unknown,
  expected: readonly ReviewedRouteScope[],
  field: string,
) {
  const scopes = array(value, field).map((entry) => parsedScope(entry, field));
  const actualKeys = scopes.map(scopeKey).sort();
  const expectedKeys = expected.map(scopeKey).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    new Set(actualKeys).size !== actualKeys.length
  ) {
    fail(field);
  }
  return scopes;
}

function matchingRecordScopes(
  value: unknown,
  expected: readonly ReviewedRouteScope[],
) {
  const actualKeys = array(value, "record scope evidence")
    .map((entry) => parsedScope(entry, "record scope evidence"))
    .map(scopeKey)
    .sort();
  const expectedKeys = expected.map(scopeKey).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail("record scope evidence");
  }
}

function sourceOf(value: unknown, field: string): IndexedRowSourceV2 {
  const source = object(object(value, field).source, `${field} source`);
  parsedScope(
    {
      model: source.modelVersion,
      releaseVersion: source.releaseVersion,
    },
    `${field} source scope`,
  );
  return source as IndexedRowSourceV2;
}

function routeEvidence(
  value: unknown,
  expectedScope: readonly ReviewedRouteScope[],
) {
  const evidence = array(value, "route evidence");
  const scopes = evidence.map((entry, index) => {
    const row = object(entry, `route evidence ${index}`);
    for (const key of ["parityRecordId", "reconciliationId", "parityBindingId"]) {
      if (typeof row[key] !== "string" || !UUID.test(row[key] as string)) {
        fail(`route evidence ${key}`);
      }
    }
    for (const key of ["parityEvidenceCommitment", "parityBindingCommitment"]) {
      if (
        typeof row[key] !== "string" ||
        !BYTES32.test((row[key] as string).toLowerCase())
      ) {
        fail(`route evidence ${key}`);
      }
    }
    return parsedScope(
      {
        model: row.model ?? row.modelVersion,
        releaseVersion: row.releaseVersion,
      },
      `route evidence ${index} scope`,
    );
  });
  exactScopes(scopes, expectedScope, "route evidence scope");
}

function readyEnvelope<T>(value: unknown): ReadyEnvelope<T> {
  const envelope = object(value, "payload");
  if (envelope.status !== "ready") fail("payload status");
  object(envelope.snapshot, "payload snapshot");
  object(envelope.data, "payload data");
  return envelope as ReadyEnvelope<T>;
}

function expectedHttpStatus<T>(
  kind:
    | "explore"
    | "token"
    | "chart"
    | "creator"
    | "classic-profile"
    | "stock-profile"
    | "launch",
  envelope: ReadyEnvelope<T>,
): number {
  if (kind === "token") {
    return (envelope.data as IndexedTokenDetailDataV2).token ? 200 : 404;
  }
  if (kind === "launch") {
    const data = envelope.data as IndexedLaunchLookupDataV2;
    return data.surface === "stock-paired" && data.resolution === "pending"
      ? 202
      : 200;
  }
  return 200;
}

function sourcesFor<T>(
  kind:
    | "explore"
    | "token"
    | "chart"
    | "creator"
    | "classic-profile"
    | "stock-profile"
    | "launch",
  envelope: ReadyEnvelope<T>,
): readonly IndexedRowSourceV2[] {
  if (kind === "explore") {
    return (envelope.data as IndexedExploreListDataV2).tokens.map(
      (token, index) => sourceOf(token, `explore token ${index}`),
    );
  }
  if (kind === "token") {
    const token = (envelope.data as IndexedTokenDetailDataV2).token;
    return token ? [sourceOf(token, "token detail")] : [];
  }
  if (kind === "chart") {
    return [sourceOf({ source: (envelope.data as IndexedChartDataV2).source }, "chart")];
  }
  if (kind === "creator") {
    const data = envelope.data as IndexedCreatorProfileDataV2;
    return [
      ...data.tokens.map((token, index) =>
        sourceOf(token, `creator token ${index}`),
      ),
      ...data.claims.map((claim, index) =>
        sourceOf(claim, `creator claim ${index}`),
      ),
    ];
  }
  if (kind === "classic-profile") {
    return (envelope.data as IndexedClassicV3ProfileDataV2).rewards.map(
      (reward, index) => sourceOf(reward, `Classic reward ${index}`),
    );
  }
  if (kind === "stock-profile") {
    return (envelope.data as IndexedStockPairedProfileDataV2).rewards.map(
      (reward, index) => sourceOf(reward, `Stock reward ${index}`),
    );
  }
  const token = (envelope.data as IndexedLaunchLookupDataV2).token;
  return token ? [sourceOf(token, "launch token")] : [];
}

async function readEnvelope<T>(input: {
  transaction: PostgresTransaction;
  sql: string;
  values: readonly PostgresParameter[];
  kind:
    | "explore"
    | "token"
    | "chart"
    | "creator"
    | "classic-profile"
    | "stock-profile"
    | "launch";
  scope: readonly ReviewedRouteScope[];
}): Promise<IndexedRouteEnvelopeV2<T>> {
  const rows = await input.transaction.query<BoundaryRow>(
    input.sql,
    input.values,
  );
  if (rows.length === 0) {
    return { status: "not-ready", reason: "reconciliation-incomplete" };
  }
  if (rows.length !== 1) fail("row cardinality");
  const row = rows[0]!;
  if (row.payload_complete !== true) fail("payload completeness");
  const envelope = readyEnvelope<T>(row.payload);
  const sources = sourcesFor(input.kind, envelope);
  const recordCount = integerNumber(row.record_count, "record count");
  if (recordCount !== sources.length) fail("record count evidence");
  const recordScope = sources.map((source) =>
    parsedScope(
      {
        model: source.modelVersion,
        releaseVersion: source.releaseVersion,
      },
      "record source scope",
    ),
  );
  matchingRecordScopes(row.record_scopes, recordScope);
  routeEvidence(row.route_evidence, input.scope);

  const snapshot = object(envelope.snapshot, "snapshot");
  const checkpointBlock = nonnegativeInteger(
    row.comparison_checkpoint_block_number,
    "comparison checkpoint block",
  );
  const checkpointHash = byteaBytes32(
    row.comparison_checkpoint_block_hash,
    "comparison checkpoint hash",
  );
  if (
    snapshot.blockNumber !== checkpointBlock ||
    typeof snapshot.blockHash !== "string" ||
    snapshot.blockHash.toLowerCase() !== checkpointHash
  ) {
    fail("comparison checkpoint binding");
  }
  exactScopes(
    array(snapshot.releasePointers, "snapshot pointers").map(
      (pointer, index) => {
        const parsed = object(pointer, `snapshot pointer ${index}`);
        return parsedScope(
          {
            model: parsed.modelVersion,
            releaseVersion: parsed.releaseVersion,
          },
          `snapshot pointer ${index}`,
        );
      },
    ),
    input.scope,
    "snapshot scope",
  );
  if (
    integerNumber(row.http_status, "http status") !==
    expectedHttpStatus(input.kind, envelope)
  ) {
    fail("HTTP status evidence");
  }
  return envelope;
}

export const postgresPublicRouteQueries: IndexedRouteSnapshotQueries =
  Object.freeze({
    explore(transaction, request) {
      return readEnvelope<IndexedExploreListDataV2>({
        transaction,
        sql: `select * from programmable_private.get_public_explore_page_v1($1, $2, $3, $4, $5)`,
        values: [
          request.chainId,
          request.query,
          request.sort,
          request.page,
          request.pageSize,
        ],
        kind: "explore",
        scope: DISCOVERY_SCOPE,
      });
    },
    tokenDetail(transaction, request) {
      return readEnvelope<IndexedTokenDetailDataV2>({
        transaction,
        sql: `select * from programmable_private.get_public_explore_token_v1($1, $2)`,
        values: [request.chainId, request.address],
        kind: "token",
        scope: DISCOVERY_SCOPE,
      });
    },
    tokenChart(transaction, request) {
      return readEnvelope<IndexedChartDataV2>({
        transaction,
        sql: `select * from programmable_private.get_public_token_chart_v1($1, $2, $3)`,
        values: [request.chainId, request.address, request.range],
        kind: "chart",
        scope: DISCOVERY_SCOPE,
      });
    },
    creatorProfile(transaction, request) {
      return readEnvelope<IndexedCreatorProfileDataV2>({
        transaction,
        sql: `select * from programmable_private.get_public_creator_profile_v1($1, $2)`,
        values: [request.chainId, request.account],
        kind: "creator",
        scope: DISCOVERY_SCOPE,
      });
    },
    classicV3Profile(transaction, request) {
      return readEnvelope<IndexedClassicV3ProfileDataV2>({
        transaction,
        sql: `select * from programmable_private.get_public_classic_v3_profile_v1($1, $2)`,
        values: [request.chainId, request.account],
        kind: "classic-profile",
        scope: CLASSIC_V3_SCOPE,
      });
    },
    stockPairedProfile(transaction, request) {
      return readEnvelope<IndexedStockPairedProfileDataV2>({
        transaction,
        sql: `select * from programmable_private.get_public_stock_paired_profile_v1($1, $2)`,
        values: [request.chainId, request.account],
        kind: "stock-profile",
        scope: STOCK_SCOPE,
      });
    },
    launchLookup(transaction, request) {
      return readEnvelope<IndexedLaunchLookupDataV2>({
        transaction,
        sql: `select * from programmable_private.get_public_launch_lookup_v1($1, $2, $3, $4)`,
        values: [
          request.chainId,
          request.surface,
          request.account,
          request.transactionHash,
        ],
        kind: "launch",
        scope:
          request.surface === "classic-v3" ? CLASSIC_V3_SCOPE : STOCK_SCOPE,
      });
    },
  });
