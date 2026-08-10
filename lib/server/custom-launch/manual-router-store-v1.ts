import "server-only";

import {
  BlobPreconditionFailedError,
  get,
  head,
  list as listBlobs,
  put,
} from "@vercel/blob";

import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "@/lib/server/projection-target/canonical-json";
import { canonicalSha256 } from "@/lib/server/projection-target/hashing";

const BASE_PATH = "custom-launch/manual-router/v1";
export const MAXIMUM_MANUAL_ROUTER_BLOB_BYTES_V1 = 1_048_576 as const;

export type ManualRouterPrivateBlobReadV1 = Readonly<{
  value: JsonValue;
  serialized: string;
  etag: string;
}>;

export interface ManualRouterPrivateBlobBoundaryV1 {
  get(path: string): Promise<Readonly<{
    statusCode: number;
    etag: string | null;
    body: string | null;
  }> | null>;
  head?(path: string): Promise<Readonly<{ etag: string }>>;
  put(
    path: string,
    body: string,
    options: Readonly<{
      allowOverwrite: boolean;
      ifMatch?: string;
    }>,
  ): Promise<Readonly<{ etag: string }>>;
  list(input: Readonly<{
    prefix: string;
    cursor?: string;
    limit: number;
  }>): Promise<Readonly<{
    paths: readonly string[];
    cursor: string | null;
    hasMore: boolean;
  }>>;
  isPreconditionFailure(error: unknown): boolean;
}

export class ManualRouterBlobCasConflictV1 extends Error {
  constructor(readonly path: string) {
    super("manual Router Blob compare-and-swap conflict");
    this.name = "ManualRouterBlobCasConflictV1";
  }
}

export class ManualRouterPrivateBlobStoreV1 {
  constructor(readonly boundary: ManualRouterPrivateBlobBoundaryV1) {
    if (
      !boundary
      || typeof boundary.get !== "function"
      || typeof boundary.put !== "function"
      || typeof boundary.list !== "function"
      || typeof boundary.isPreconditionFailure !== "function"
    ) throw new TypeError("manual Router Blob boundary is invalid");
  }

  async read(path: string): Promise<ManualRouterPrivateBlobReadV1 | null> {
    const checkedPath = manualRouterBlobPath(path);
    const result = await this.boundary.get(checkedPath);
    if (result === null || result.statusCode === 404) return null;
    if (
      result.statusCode !== 200
      || typeof result.etag !== "string"
      || result.etag.length < 1
      || typeof result.body !== "string"
    ) throw new TypeError("manual Router private Blob read failed");
    return Object.freeze({
      value: parseCanonicalManualRouterBlobV1(result.body),
      serialized: result.body,
      etag: result.etag,
    });
  }

  async readForCompareAndSwap(
    path: string,
  ): Promise<ManualRouterPrivateBlobReadV1> {
    const checkedPath = manualRouterBlobPath(path);
    if (typeof this.boundary.head !== "function") {
      throw new TypeError("manual Router Blob CAS metadata is unavailable");
    }
    const before = await this.boundary.head(checkedPath);
    const read = await this.read(checkedPath);
    const after = await this.boundary.head(checkedPath);
    if (
      read === null
      || before.etag !== after.etag
      || typeof after.etag !== "string"
      || after.etag.length < 1
      || after.etag.length > 1_024
      || /[\r\n\u0000]/u.test(after.etag)
    ) throw new ManualRouterBlobCasConflictV1(checkedPath);
    return Object.freeze({ ...read, etag: after.etag });
  }

  async putImmutable(
    path: string,
    value: unknown,
  ): Promise<Readonly<{ etag: string; idempotent: boolean }>> {
    const checkedPath = manualRouterBlobPath(path);
    const serialized = serializeCanonicalManualRouterBlobV1(value);
    try {
      const written = await this.boundary.put(checkedPath, serialized, {
        allowOverwrite: false,
      });
      return Object.freeze({ etag: written.etag, idempotent: false });
    } catch (error) {
      if (!this.boundary.isPreconditionFailure(error)) throw error;
      const existing = await this.read(checkedPath);
      if (existing?.serialized === serialized) {
        return Object.freeze({ etag: existing.etag, idempotent: true });
      }
      throw new ManualRouterBlobCasConflictV1(checkedPath);
    }
  }

  async compareAndSwap(
    path: string,
    expectedEtag: string | null,
    value: unknown,
  ): Promise<Readonly<{ etag: string }>> {
    const checkedPath = manualRouterBlobPath(path);
    if (
      expectedEtag !== null
      && (expectedEtag.length < 1 || expectedEtag.length > 1_024)
    ) throw new TypeError("manual Router Blob ETag is invalid");
    const serialized = serializeCanonicalManualRouterBlobV1(value);
    try {
      return await this.boundary.put(checkedPath, serialized, {
        allowOverwrite: expectedEtag !== null,
        ...(expectedEtag === null ? {} : { ifMatch: expectedEtag }),
      });
    } catch (error) {
      if (this.boundary.isPreconditionFailure(error)) {
        throw new ManualRouterBlobCasConflictV1(checkedPath);
      }
      throw error;
    }
  }

  async listPaths(
    prefix: string,
    cursor: string | null = null,
  ): Promise<Readonly<{
    paths: readonly string[];
    cursor: string | null;
    hasMore: boolean;
  }>> {
    const checkedPrefix = manualRouterBlobPrefix(prefix);
    if (
      cursor !== null
      && (cursor.length < 1 || cursor.length > 4_096 || /[\r\n\u0000]/u.test(cursor))
    ) throw new TypeError("manual Router Blob cursor is invalid");
    const result = await this.boundary.list({
      prefix: checkedPrefix,
      ...(cursor === null ? {} : { cursor }),
      limit: 1_000,
    });
    if (
      typeof result.hasMore !== "boolean"
      || (result.hasMore && !result.cursor)
      || (!result.hasMore && result.cursor !== null)
      || !Array.isArray(result.paths)
      || result.paths.length > 1_000
    ) throw new TypeError("manual Router private Blob list failed");
    const paths = [...new Set(result.paths.map((path) => {
      const checked = manualRouterBlobPath(path);
      if (!checked.startsWith(checkedPrefix)) {
        throw new TypeError("manual Router Blob list escaped its private prefix");
      }
      return checked;
    }))].sort();
    if (paths.length !== result.paths.length) {
      throw new TypeError("manual Router private Blob list is ambiguous");
    }
    return Object.freeze({
      paths: Object.freeze(paths),
      cursor: result.hasMore ? result.cursor : null,
      hasMore: result.hasMore,
    });
  }
}

export function createProductionManualRouterPrivateBlobStoreV1():
ManualRouterPrivateBlobStoreV1 {
  const token = process.env.OPS_BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new TypeError("OPS_BLOB_READ_WRITE_TOKEN is not configured");
  return new ManualRouterPrivateBlobStoreV1(Object.freeze({
    async get(path: string) {
      const result = await get(path, {
        access: "private",
        token,
        useCache: false,
      });
      if (!result) return null;
      return Object.freeze({
        statusCode: result.statusCode,
        etag: result.blob.etag,
        body: result.stream === null
          ? null
          : await new Response(result.stream).text(),
      });
    },
    async head(path: string) {
      const result = await head(path, { token });
      return Object.freeze({ etag: result.etag });
    },
    async put(
      path: string,
      body: string,
      options: Readonly<{ allowOverwrite: boolean; ifMatch?: string }>,
    ) {
      const result = await put(path, body, {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: options.allowOverwrite,
        cacheControlMaxAge: 0,
        ...(options.ifMatch === undefined ? {} : { ifMatch: options.ifMatch }),
        token,
      });
      return Object.freeze({ etag: result.etag });
    },
    async list({ prefix, cursor, limit }: Readonly<{
      prefix: string;
      cursor?: string;
      limit: number;
    }>) {
      const result = await listBlobs({
        prefix,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
        token,
      });
      return Object.freeze({
        paths: Object.freeze(result.blobs.map(({ pathname }) => pathname)),
        cursor: result.cursor ?? null,
        hasMore: result.hasMore,
      });
    },
    isPreconditionFailure(error: unknown) {
      return error instanceof BlobPreconditionFailedError
        || (
          error instanceof Error
          && error.name === "BlobPreconditionFailedError"
        );
    },
  }));
}

export function serializeCanonicalManualRouterBlobV1(value: unknown): string {
  const serialized = canonicalizeJson(value);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes < 1 || bytes > MAXIMUM_MANUAL_ROUTER_BLOB_BYTES_V1) {
    throw new TypeError("manual Router Blob artifact exceeds its byte bound");
  }
  return serialized;
}

export function parseCanonicalManualRouterBlobV1(serialized: string): JsonValue {
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes < 1 || bytes > MAXIMUM_MANUAL_ROUTER_BLOB_BYTES_V1) {
    throw new TypeError("manual Router Blob artifact byte length is invalid");
  }
  const value = parseStrictJson(serialized, {
    maximumBytes: MAXIMUM_MANUAL_ROUTER_BLOB_BYTES_V1,
    maximumDepth: 128,
  });
  if (canonicalizeJson(value) !== serialized) {
    throw new TypeError("manual Router Blob artifact is not canonical JSON");
  }
  return value;
}

export function manualRouterContentPathV1(
  kind:
    | "signed-artifacts"
    | "pointer-history"
    | "proofs"
    | "failed-transactions"
    | "applicant-index-history",
  hash: `sha256:${string}`,
): string {
  return `${BASE_PATH}/${kind}/${sha256Hex(hash)}.json`;
}

export function manualRouterApplicantIndexPathV1(input: Readonly<{
  approvedGitHubUserId: string;
  approvedLaunchWallet: `0x${string}`;
}>): string {
  if (
    !/^[1-9][0-9]{0,63}$/u.test(input.approvedGitHubUserId)
    || !/^0x[0-9a-fA-F]{40}$/u.test(input.approvedLaunchWallet)
    || BigInt(input.approvedLaunchWallet) === 0n
  ) throw new TypeError("manual Router Applicant index principal is invalid");
  const principalHash = canonicalSha256(
    "programmable.manual-router-applicant-index-key.v1",
    {
      approvedGitHubUserId: input.approvedGitHubUserId,
      approvedLaunchWallet: input.approvedLaunchWallet.toLowerCase(),
    },
  );
  return `${BASE_PATH}/applicants/${sha256Hex(principalHash)}.json`;
}

export function manualRouterApplicantIndexPrefixV1(): string {
  return `${BASE_PATH}/applicants/`;
}

/**
 * Mutable acceptance pointer. Its key is the stable Hookbuilder application
 * subject, never an acceptance-claim revision. A rotated claim therefore has
 * exactly one CAS predecessor instead of creating a second implicit head.
 */
export function manualRouterRouteAcceptanceHeadPathV1(
  acceptanceSubjectHash: `sha256:${string}`,
): string {
  return `${BASE_PATH}/route-acceptance-heads/${sha256Hex(
    acceptanceSubjectHash,
  )}.json`;
}

export function manualRouterRouteAcceptanceHistoryPathV1(
  acceptanceHash: `sha256:${string}`,
): string {
  return `${BASE_PATH}/route-acceptance-history/${sha256Hex(
    acceptanceHash,
  )}.json`;
}

export function manualRouterRouteAcceptanceRecordPathV1(
  applicantAcceptanceRecordHash: `sha256:${string}`,
): string {
  return `${BASE_PATH}/route-acceptance-records/${sha256Hex(
    applicantAcceptanceRecordHash,
  )}.json`;
}

function sha256Hex(value: `sha256:${string}`): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError("manual Router content hash is invalid");
  }
  return value.slice(7);
}

function manualRouterBlobPath(value: string): string {
  if (
    !value.startsWith(`${BASE_PATH}/`)
    || value.length > 512
    || !/^[a-z0-9/.-]+$/u.test(value)
    || value.includes("..")
    || !value.endsWith(".json")
  ) throw new TypeError("manual Router Blob path is invalid");
  return value;
}

function manualRouterBlobPrefix(value: string): string {
  if (
    !value.startsWith(`${BASE_PATH}/`)
    || value.length > 480
    || !/^[a-z0-9/.-]+$/u.test(value)
    || value.includes("..")
    || !value.endsWith("/")
  ) throw new TypeError("manual Router Blob prefix is invalid");
  return value;
}
