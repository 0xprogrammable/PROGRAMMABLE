import "server-only";

import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import descriptorSource from
  "@/config/generic-launch-foundation.prelaunch.v1.json";
import {
  canonicalizeJson,
  type JsonValue,
} from "../projection-target/canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "../projection-target/hashing";
import {
  parseGenericLaunchFoundationDescriptorV1,
  parseGenericLaunchRecordV1,
  type GenericLaunchFoundationDescriptorV1,
  type GenericLaunchRecordV1,
} from "./generic-launch-contract-v1";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const CURSOR = /^[A-Za-z0-9_-]{1,1024}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,15})$/u;
const MAX_SIGNED_MESSAGE_BYTES = 2_097_152;

export interface GenericLaunchReadModelContractV1 {
  readonly schemaVersion: "programmable.generic-launch-read-model-contract.v1";
  readonly sourceLane: "generic.finalized-launch";
  readonly implementationBindingHash: Sha256Digest;
  readonly persistenceBindingHash: Sha256Digest;
  readonly queryContractBindingHash: Sha256Digest;
}

export interface GenericLaunchReadPageV1 {
  readonly records: readonly GenericLaunchRecordV1[];
  readonly nextCursor: string | null;
  readonly total: string;
}

export interface SignedGenericLaunchReadEnvelopeV1 {
  readonly schemaVersion: "programmable.signed-generic-launch-read-envelope.v1";
  readonly activationBindingHash: Sha256Digest;
  readonly readModelBindingHash: Sha256Digest;
  readonly requestBindingHash: Sha256Digest;
  readonly payload: unknown;
  readonly signatureBase64Url: string;
}

export interface GenericLaunchReadStoreV1 {
  readonly sourceLane: "generic.finalized-launch";
  readonly readModelContract: GenericLaunchReadModelContractV1;
  findFinalizedLaunches(input: Readonly<{
    limit: number;
    cursor?: string;
    requestBindingHash: Sha256Digest;
    signal: AbortSignal;
  }>): Promise<SignedGenericLaunchReadEnvelopeV1>;
  findFinalizedLaunchByRecordHash(input: Readonly<{
    recordHash: Sha256Digest;
    requestBindingHash: Sha256Digest;
    signal: AbortSignal;
  }>): Promise<SignedGenericLaunchReadEnvelopeV1>;
}

export function createGenericLaunchReadHandlersV1(
  input: Readonly<{
    descriptor: GenericLaunchFoundationDescriptorV1;
    store: GenericLaunchReadStoreV1 | null;
  }>,
) {
  const descriptor = parseGenericLaunchFoundationDescriptorV1(input.descriptor);
  const readModel = descriptor.activation === true
    ? prepareActiveReadModel(descriptor, input.store)
    : null;
  if (descriptor.activation === false && input.store !== null) {
    throw new TypeError("disabled generic launch foundation cannot bind a read store");
  }

  return Object.freeze({
    async feed(request: Request): Promise<Response> {
      const query = parseFeedRequest(request);
      if (query === null) {
        return errorResponse(400, "invalid_generic_launch_feed_request");
      }
      if (descriptor.activation === false || readModel === null) {
        return errorResponse(503, "generic_launch_foundation_not_active");
      }
      const requestBindingHash = canonicalSha256(
        "programmable.generic-launch-feed-request.v1",
        Object.freeze({
          limit: query.limit,
          cursor: query.cursor ?? null,
        }),
      );
      try {
        const envelope = await readModel.store.findFinalizedLaunches({
          limit: query.limit,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          requestBindingHash,
          signal: request.signal,
        });
        const payload = verifySignedEnvelope(
          descriptor,
          readModel,
          envelope,
          requestBindingHash,
        );
        const verified = assertPage(
          descriptor,
          payload,
          query.limit,
          query.cursor ?? null,
        );
        return jsonResponse(200, {
          schemaVersion: "programmable.generic-launch-feed.v1",
          records: verified.records,
          nextCursor: verified.nextCursor,
          total: verified.total,
        });
      } catch {
        return errorResponse(503, "generic_launch_read_model_unavailable");
      }
    },

    async detail(request: Request, recordHash: string): Promise<Response> {
      if (!validBaseReadRequest(request) || new URL(request.url).search !== ""
        || !DIGEST.test(recordHash)) {
        return errorResponse(400, "invalid_generic_launch_detail_request");
      }
      if (descriptor.activation === false || readModel === null) {
        return errorResponse(503, "generic_launch_foundation_not_active");
      }
      const requestBindingHash = canonicalSha256(
        "programmable.generic-launch-detail-request.v1",
        Object.freeze({ recordHash }),
      );
      try {
        const envelope = await readModel.store.findFinalizedLaunchByRecordHash({
          recordHash: recordHash as Sha256Digest,
          requestBindingHash,
          signal: request.signal,
        });
        const payload = verifySignedEnvelope(
          descriptor,
          readModel,
          envelope,
          requestBindingHash,
        );
        if (payload === null) {
          return errorResponse(404, "generic_launch_not_found");
        }
        const verified = assertDescriptorBoundRecord(descriptor, payload);
        if (verified.recordHash !== recordHash) {
          throw new TypeError("generic launch read-model key does not match record");
        }
        return jsonResponse(200, {
          schemaVersion: "programmable.generic-launch-view.v1",
          record: verified,
        });
      } catch {
        return errorResponse(503, "generic_launch_read_model_unavailable");
      }
    },
  });
}

export const PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1 =
  parseGenericLaunchFoundationDescriptorV1(descriptorSource);

const prelaunchHandlers = createGenericLaunchReadHandlersV1({
  descriptor: PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1,
  store: null,
});

export function handleProductionGenericLaunchFeedV1(
  request: Request,
): Promise<Response> {
  return prelaunchHandlers.feed(request);
}

export function handleProductionGenericLaunchDetailV1(
  request: Request,
  recordHash: string,
): Promise<Response> {
  return prelaunchHandlers.detail(request, recordHash);
}

function prepareActiveReadModel(
  descriptor: GenericLaunchFoundationDescriptorV1,
  store: GenericLaunchReadStoreV1 | null,
): Readonly<{
  store: GenericLaunchReadStoreV1;
  readModelBindingHash: Sha256Digest;
  publicKey: ReturnType<typeof createPublicKey>;
}> {
  if (descriptor.activation !== true || descriptor.readModelBindingHash === null
    || descriptor.readModelVerifier === null) {
    throw new TypeError("active generic launch read model is invalid");
  }
  const capturedStore = captureReadStore(store);
  const contract = parseGenericLaunchReadModelContractV1(
    capturedStore.readModelContract,
  );
  const readModelBindingHash = canonicalSha256(contract.schemaVersion, contract);
  if (readModelBindingHash !== descriptor.readModelBindingHash) {
    throw new TypeError("generic launch read model contract is not descriptor-bound");
  }
  const spki = Buffer.from(
    descriptor.readModelVerifier.publicKeySpkiBase64Url,
    "base64url",
  );
  const publicKeySha256 = `sha256:${createHash("sha256").update(spki).digest("hex")}`;
  if (publicKeySha256 !== descriptor.readModelVerifier.publicKeySha256) {
    throw new TypeError("generic launch read model public key hash is invalid");
  }
  const publicKey = createPublicKey({ key: spki, format: "der", type: "spki" });
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("generic launch read model public key is not Ed25519");
  }
  return Object.freeze({
    store: Object.freeze({
      sourceLane: "generic.finalized-launch" as const,
      readModelContract: contract,
      findFinalizedLaunches: capturedStore.findFinalizedLaunches,
      findFinalizedLaunchByRecordHash:
        capturedStore.findFinalizedLaunchByRecordHash,
    }),
    readModelBindingHash,
    publicKey,
  });
}

function verifySignedEnvelope(
  descriptor: GenericLaunchFoundationDescriptorV1,
  readModel: Readonly<{
    readModelBindingHash: Sha256Digest;
    publicKey: ReturnType<typeof createPublicKey>;
  }>,
  raw: unknown,
  requestBindingHash: Sha256Digest,
): unknown {
  if (descriptor.activation !== true || descriptor.activationBindingHash === null) {
    throw new TypeError("generic launch foundation is not active");
  }
  const value = exactObject(raw, [
    "activationBindingHash", "payload", "readModelBindingHash",
    "requestBindingHash", "schemaVersion", "signatureBase64Url",
  ], "signed generic launch read envelope");
  if (value.schemaVersion !== "programmable.signed-generic-launch-read-envelope.v1"
    || value.activationBindingHash !== descriptor.activationBindingHash
    || value.readModelBindingHash !== readModel.readModelBindingHash
    || value.requestBindingHash !== requestBindingHash
    || typeof value.signatureBase64Url !== "string"
    || !BASE64URL_SIGNATURE.test(value.signatureBase64Url)) {
    throw new TypeError("signed generic launch read envelope is invalid");
  }
  const signed = Object.freeze({
    schemaVersion: "programmable.generic-launch-read-signature-message.v1" as const,
    activationBindingHash: descriptor.activationBindingHash,
    readModelBindingHash: readModel.readModelBindingHash,
    requestBindingHash,
    payload: value.payload,
  });
  const canonicalMessage = canonicalizeJson(signed as unknown as JsonValue);
  if (Buffer.byteLength(canonicalMessage, "utf8") > MAX_SIGNED_MESSAGE_BYTES) {
    throw new TypeError("signed generic launch read envelope exceeds its bound");
  }
  const valid = verifySignature(
    null,
    Buffer.from(canonicalMessage, "utf8"),
    readModel.publicKey,
    Buffer.from(value.signatureBase64Url, "base64url"),
  );
  if (!valid) throw new TypeError("generic launch read signature is invalid");
  return value.payload;
}

function captureReadStore(
  raw: GenericLaunchReadStoreV1 | null,
): GenericLaunchReadStoreV1 {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("active generic launch read model is invalid");
  }
  const prototype = Object.getPrototypeOf(raw) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("active generic launch read model must be a plain object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const keys = Reflect.ownKeys(descriptors);
  const expected = [
    "findFinalizedLaunchByRecordHash",
    "findFinalizedLaunches",
    "readModelContract",
    "sourceLane",
  ];
  if (keys.some((key) => typeof key !== "string")) {
    throw new TypeError("active generic launch read model contains symbols");
  }
  const sortedKeys = (keys as string[]).sort();
  if (sortedKeys.length !== expected.length
    || sortedKeys.some((key, index) => key !== expected[index])) {
    throw new TypeError("active generic launch read model has unexpected properties");
  }
  const captured: Record<string, unknown> = Object.create(null);
  for (const key of sortedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || descriptor.get !== undefined
      || descriptor.set !== undefined || !descriptor.enumerable
      || !("value" in descriptor)) {
      throw new TypeError("active generic launch read model contains non-data properties");
    }
    captured[key] = descriptor.value;
  }
  if (captured.sourceLane !== "generic.finalized-launch"
    || typeof captured.findFinalizedLaunches !== "function"
    || typeof captured.findFinalizedLaunchByRecordHash !== "function") {
    throw new TypeError("active generic launch read model is invalid");
  }
  const findFinalizedLaunches = captured.findFinalizedLaunches as
    GenericLaunchReadStoreV1["findFinalizedLaunches"];
  const findFinalizedLaunchByRecordHash =
    captured.findFinalizedLaunchByRecordHash as
      GenericLaunchReadStoreV1["findFinalizedLaunchByRecordHash"];
  return Object.freeze({
    sourceLane: "generic.finalized-launch" as const,
    readModelContract:
      captured.readModelContract as GenericLaunchReadModelContractV1,
    findFinalizedLaunches: (
      input: Parameters<GenericLaunchReadStoreV1["findFinalizedLaunches"]>[0],
    ) => findFinalizedLaunches(input),
    findFinalizedLaunchByRecordHash: (
      input: Parameters<
        GenericLaunchReadStoreV1["findFinalizedLaunchByRecordHash"]
      >[0],
    ) =>
      findFinalizedLaunchByRecordHash(input),
  });
}

function parseGenericLaunchReadModelContractV1(
  raw: unknown,
): GenericLaunchReadModelContractV1 {
  const value = exactObject(raw, [
    "implementationBindingHash", "persistenceBindingHash",
    "queryContractBindingHash", "schemaVersion", "sourceLane",
  ], "generic launch read model contract");
  if (value.schemaVersion !== "programmable.generic-launch-read-model-contract.v1"
    || value.sourceLane !== "generic.finalized-launch") {
    throw new TypeError("generic launch read model contract is invalid");
  }
  return Object.freeze({
    schemaVersion: "programmable.generic-launch-read-model-contract.v1" as const,
    sourceLane: "generic.finalized-launch" as const,
    implementationBindingHash: digest(
      value.implementationBindingHash,
      "read model implementation",
    ),
    persistenceBindingHash: digest(
      value.persistenceBindingHash,
      "read model persistence",
    ),
    queryContractBindingHash: digest(
      value.queryContractBindingHash,
      "read model query contract",
    ),
  });
}

function assertPage(
  descriptor: GenericLaunchFoundationDescriptorV1,
  raw: unknown,
  limit: number,
  currentCursor: string | null,
): GenericLaunchReadPageV1 {
  const value = exactObject(raw, ["nextCursor", "records", "total"],
    "generic launch page");
  if (!Array.isArray(value.records) || value.records.length > limit) {
    throw new TypeError("generic launch page exceeds its bound");
  }
  const records = value.records.map((record) =>
    assertDescriptorBoundRecord(descriptor, record));
  if (new Set(records.map(({ recordHash }) => recordHash)).size !== records.length) {
    throw new TypeError("generic launch page contains duplicate records");
  }
  const nextCursor = value.nextCursor === null
    ? null
    : cursor(value.nextCursor, "generic launch next cursor");
  if (nextCursor !== null
    && (records.length === 0 || nextCursor === currentCursor)) {
    throw new TypeError("generic launch page cannot advance its cursor");
  }
  const total = decimal(value.total, "generic launch total");
  if (BigInt(total) < BigInt(records.length)) {
    throw new TypeError("generic launch total is invalid");
  }
  return Object.freeze({ records: Object.freeze(records), nextCursor, total });
}

function assertDescriptorBoundRecord(
  descriptor: GenericLaunchFoundationDescriptorV1,
  raw: unknown,
): GenericLaunchRecordV1 {
  if (descriptor.activation !== true || descriptor.routeAdapterReleases === null
    || descriptor.subjectSourceBindingHash === null
    || descriptor.executionResultSourceBindingHash === null
    || descriptor.readModelBindingHash === null) {
    throw new TypeError("generic launch foundation is not active");
  }
  const record = parseGenericLaunchRecordV1(raw);
  if (record.subject.subjectSourceBindingHash
      !== descriptor.subjectSourceBindingHash
    || record.executionResult.executionResultSourceBindingHash
      !== descriptor.executionResultSourceBindingHash
    || record.readModelBindingHash !== descriptor.readModelBindingHash
    || descriptor.routeAdapterReleases[
      `${record.routeAdapterRelease.adapterId}@${record.routeAdapterRelease.releaseVersion}`
    ]?.releaseHash !== record.routeAdapterRelease.releaseHash) {
    throw new TypeError("generic launch record is not descriptor-bound");
  }
  return record;
}

function parseFeedRequest(
  request: Request,
): Readonly<{ limit: number; cursor?: string }> | null {
  if (!validBaseReadRequest(request)) return null;
  const url = new URL(request.url);
  if (url.search === "") return Object.freeze({ limit: 100 });
  const keys = [...url.searchParams.keys()];
  if (keys.length < 1 || keys.length > 2 || keys[0] !== "limit"
    || (keys.length === 2 && keys[1] !== "cursor")) return null;
  const limitValue = url.searchParams.get("limit");
  if (limitValue === null || !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(limitValue)) {
    return null;
  }
  const limit = Number(limitValue);
  const cursorValue = url.searchParams.get("cursor");
  if (cursorValue !== null && !CURSOR.test(cursorValue)) return null;
  const canonical = `?limit=${limit}${cursorValue === null
    ? ""
    : `&cursor=${cursorValue}`}`;
  if (url.search !== canonical) return null;
  return Object.freeze({
    limit,
    ...(cursorValue === null ? {} : { cursor: cursorValue }),
  });
}

function validBaseReadRequest(request: Request): boolean {
  if (request.method !== "GET" || request.body !== null
    || request.headers.has("content-type")
    || request.headers.get("accept")?.trim().toLowerCase() !== "application/json") {
    return false;
  }
  const url = new URL(request.url);
  return url.username === "" && url.password === "" && url.hash === "";
}

function exactObject(
  raw: unknown,
  expectedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(raw) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(raw);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new TypeError(`${label} contains symbol properties`);
  }
  const keys = (ownKeys as string[]).sort();
  const expected = [...expectedKeys].sort();
  if (keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has unexpected properties`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor === undefined || descriptor.get !== undefined
      || descriptor.set !== undefined || !descriptor.enumerable
      || !("value" in descriptor)) {
      throw new TypeError(`${label} contains non-data properties`);
    }
  }
  return raw as Readonly<Record<string, unknown>>;
}

function digest(raw: unknown, label: string): Sha256Digest {
  if (typeof raw !== "string" || !DIGEST.test(raw)) {
    throw new TypeError(`${label} is invalid`);
  }
  return raw as Sha256Digest;
}

function cursor(raw: unknown, label: string): string {
  if (typeof raw !== "string" || !CURSOR.test(raw)) {
    throw new TypeError(`${label} is invalid`);
  }
  return raw;
}

function decimal(raw: unknown, label: string): string {
  if (typeof raw !== "string" || !DECIMAL.test(raw)) {
    throw new TypeError(`${label} is invalid`);
  }
  return raw;
}

function jsonResponse(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(canonicalizeJson(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse(status, {
    schemaVersion: "programmable.generic-launch-error.v1",
    code,
    message: code,
  });
}
