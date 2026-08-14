import "server-only";

import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
} from "node:crypto";
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
  parseGenericLaunchRecordV2,
  type GenericLaunchRecordV2,
} from "./generic-launch-contract-v2";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const HASH32 = /^0x[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const CURSOR = /^[A-Za-z0-9_-]{1,1024}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,77})$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]{0,77}$/u;
const MAX_SIGNED_MESSAGE_BYTES = 2_097_152;

export const GENERIC_LAUNCH_FEED_PATH_V2 =
  "/api/custom-launch/generic/v2/launches" as const;
export const GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V2 =
  "/api/custom-launch/generic/v2/launches/{recordHash}" as const;

export interface GenericLaunchReadModelContractV2 {
  readonly schemaVersion: "programmable.generic-launch-read-model-contract.v2";
  readonly sourceLane: "generic.finalized-launch-v2";
  readonly implementationBindingHash: Sha256Digest;
  readonly persistenceBindingHash: Sha256Digest;
  readonly queryContractBindingHash: Sha256Digest;
  readonly approvalArtifactSchemaBindingHash: Sha256Digest;
  readonly approvalReleaseBindingHash: Sha256Digest;
  readonly registryProjectionBindingHash: Sha256Digest;
}

export interface GenericLaunchReadBindingV2 {
  readonly schemaVersion: "programmable.generic-launch-read-binding.v2";
  readonly activationBindingHash: Sha256Digest;
  readonly activatedAt: string;
  readonly readModelBindingHash: Sha256Digest;
  readonly readModelVerifier: Readonly<{
    algorithm: "ed25519";
    publicKeySpkiBase64Url: string;
    publicKeySha256: Sha256Digest;
  }>;
  readonly registryIdentity: Readonly<{
    chainId: "1";
    generation: "2";
    registryAddress: `0x${string}`;
    registryRuntimeCodeKeccak256: `0x${string}`;
    registryPolicyCommitment: `0x${string}`;
    minimumFinalityBlocks: string;
  }>;
  readonly api: Readonly<{
    feedPath: typeof GENERIC_LAUNCH_FEED_PATH_V2;
    detailPathTemplate: typeof GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V2;
  }>;
}

export interface GenericLaunchReadPageV2 {
  readonly records: readonly GenericLaunchRecordV2[];
  readonly nextCursor: string | null;
  readonly total: string;
}

export interface SignedGenericLaunchReadEnvelopeV2 {
  readonly schemaVersion: "programmable.signed-generic-launch-read-envelope.v2";
  readonly activationBindingHash: Sha256Digest;
  readonly readModelBindingHash: Sha256Digest;
  readonly requestBindingHash: Sha256Digest;
  readonly payload: unknown;
  readonly signatureBase64Url: string;
}

export interface GenericLaunchReadStoreV2 {
  readonly sourceLane: "generic.finalized-launch-v2";
  readonly readModelContract: GenericLaunchReadModelContractV2;
  findFinalizedLaunches(input: Readonly<{
    limit: number;
    cursor?: string;
    requestBindingHash: Sha256Digest;
    signal: AbortSignal;
  }>): Promise<string>;
  findFinalizedLaunchByRecordHash(input: Readonly<{
    recordHash: Sha256Digest;
    requestBindingHash: Sha256Digest;
    signal: AbortSignal;
  }>): Promise<string>;
}

export function createActiveGenericLaunchReadBindingV2(
  input: Omit<GenericLaunchReadBindingV2, "schemaVersion" | "activationBindingHash">,
): GenericLaunchReadBindingV2 {
  const activatedAt = canonicalTimestamp(input.activatedAt);
  const verifierValue = exactObject(input.readModelVerifier, [
    "algorithm", "publicKeySha256", "publicKeySpkiBase64Url",
  ], "generic launch V2 read verifier");
  if (verifierValue.algorithm !== "ed25519"
    || typeof verifierValue.publicKeySpkiBase64Url !== "string"
    || !BASE64URL.test(verifierValue.publicKeySpkiBase64Url)) {
    throw new TypeError("generic launch V2 read verifier is invalid");
  }
  const verifier = Object.freeze({
    algorithm: "ed25519" as const,
    publicKeySpkiBase64Url: verifierValue.publicKeySpkiBase64Url,
    publicKeySha256: digest(
      verifierValue.publicKeySha256,
      "generic launch V2 read verifier public key hash",
    ),
  });
  const registryValue = exactObject(input.registryIdentity, [
    "chainId", "generation", "minimumFinalityBlocks", "registryAddress",
    "registryPolicyCommitment", "registryRuntimeCodeKeccak256",
  ], "generic launch V2 registry identity");
  if (registryValue.chainId !== "1" || registryValue.generation !== "2") {
    throw new TypeError("generic launch V2 registry identity is invalid");
  }
  const registryIdentity = Object.freeze({
    chainId: "1" as const,
    generation: "2" as const,
    registryAddress: evmAddress(
      registryValue.registryAddress,
      "generic launch V2 registry address",
    ),
    registryRuntimeCodeKeccak256: hash32(
      registryValue.registryRuntimeCodeKeccak256,
      "generic launch V2 registry runtime hash",
    ),
    registryPolicyCommitment: hash32(
      registryValue.registryPolicyCommitment,
      "generic launch V2 registry policy commitment",
    ),
    minimumFinalityBlocks: positiveDecimal(
      registryValue.minimumFinalityBlocks,
      "generic launch V2 registry minimum finality",
    ),
  });
  const apiValue = exactObject(input.api, [
    "detailPathTemplate", "feedPath",
  ], "generic launch V2 API binding");
  if (apiValue.feedPath !== GENERIC_LAUNCH_FEED_PATH_V2
    || apiValue.detailPathTemplate !== GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V2) {
    throw new TypeError("generic launch V2 API binding is invalid");
  }
  const core = Object.freeze({
    schemaVersion: "programmable.generic-launch-read-binding.v2" as const,
    activatedAt,
    readModelBindingHash: digest(
      input.readModelBindingHash,
      "generic launch V2 read model binding",
    ),
    readModelVerifier: verifier,
    registryIdentity,
    api: Object.freeze({
      feedPath: GENERIC_LAUNCH_FEED_PATH_V2,
      detailPathTemplate: GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V2,
    }),
  });
  return Object.freeze({
    ...core,
    activationBindingHash: canonicalSha256(core.schemaVersion, core),
  });
}

export function parseGenericLaunchReadBindingV2(
  raw: unknown,
): GenericLaunchReadBindingV2 {
  const value = exactObject(raw, [
    "activatedAt", "activationBindingHash", "api", "readModelBindingHash",
    "readModelVerifier", "registryIdentity", "schemaVersion",
  ], "generic launch V2 read binding");
  if (value.schemaVersion !== "programmable.generic-launch-read-binding.v2") {
    throw new TypeError("generic launch V2 read binding schema is invalid");
  }
  const binding = createActiveGenericLaunchReadBindingV2({
    activatedAt: value.activatedAt as string,
    readModelBindingHash: value.readModelBindingHash as Sha256Digest,
    readModelVerifier:
      value.readModelVerifier as GenericLaunchReadBindingV2["readModelVerifier"],
    registryIdentity:
      value.registryIdentity as GenericLaunchReadBindingV2["registryIdentity"],
    api: value.api as GenericLaunchReadBindingV2["api"],
  });
  if (binding.activationBindingHash !== value.activationBindingHash) {
    throw new TypeError("generic launch V2 activation binding is invalid");
  }
  return binding;
}

export function createGenericLaunchReadHandlersV2(input: Readonly<{
  binding: GenericLaunchReadBindingV2 | null;
  store: GenericLaunchReadStoreV2 | null;
}>) {
  if (input.binding === null) {
    if (input.store !== null) {
      throw new TypeError("inactive generic launch V2 cannot bind a read store");
    }
    return inactiveHandlers();
  }
  const binding = parseGenericLaunchReadBindingV2(input.binding);
  const readModel = prepareActiveReadModel(binding, input.store);
  return Object.freeze({
    async feed(request: Request): Promise<Response> {
      const query = parseFeedRequest(request);
      if (query === null) {
        return errorResponse(400, "invalid_generic_launch_v2_feed_request");
      }
      try {
        const requestBindingHash = canonicalSha256(
          "programmable.generic-launch-feed-request.v2",
          Object.freeze({
            limit: query.limit,
            cursor: query.cursor ?? null,
            requestChallengeBase64Url: randomBytes(32).toString("base64url"),
          }),
        );
        const envelope = await readModel.store.findFinalizedLaunches({
          limit: query.limit,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          requestBindingHash,
          signal: request.signal,
        });
        const payload = verifySignedEnvelope(
          binding,
          readModel,
          envelope,
          requestBindingHash,
        );
        const page = assertPage(
          binding,
          readModel.readModelBindingHash,
          payload,
          query.limit,
          query.cursor ?? null,
        );
        return jsonResponse(200, {
          schemaVersion: "programmable.generic-launch-feed.v2",
          records: page.records,
          nextCursor: page.nextCursor,
          total: page.total,
        });
      } catch {
        return errorResponse(503, "generic_launch_v2_read_model_unavailable");
      }
    },

    async detail(request: Request, recordHash: string): Promise<Response> {
      if (!validBaseReadRequest(request) || new URL(request.url).search !== ""
        || !DIGEST.test(recordHash)) {
        return errorResponse(400, "invalid_generic_launch_v2_detail_request");
      }
      try {
        const requestBindingHash = canonicalSha256(
          "programmable.generic-launch-detail-request.v2",
          Object.freeze({
            recordHash,
            requestChallengeBase64Url: randomBytes(32).toString("base64url"),
          }),
        );
        const envelope = await readModel.store.findFinalizedLaunchByRecordHash({
          recordHash: recordHash as Sha256Digest,
          requestBindingHash,
          signal: request.signal,
        });
        const payload = verifySignedEnvelope(
          binding,
          readModel,
          envelope,
          requestBindingHash,
        );
        if (payload === null) {
          return errorResponse(404, "generic_launch_v2_not_found");
        }
        const record = assertBindingBoundRecord(
          binding,
          readModel.readModelBindingHash,
          payload,
        );
        if (record.recordHash !== recordHash) {
          throw new TypeError("generic launch V2 read key does not match record");
        }
        return jsonResponse(200, {
          schemaVersion: "programmable.generic-launch-view.v2",
          record,
        });
      } catch {
        return errorResponse(503, "generic_launch_v2_read_model_unavailable");
      }
    },
  });
}

const productionHandlers = createGenericLaunchReadHandlersV2({
  binding: null,
  store: null,
});

export function handleProductionGenericLaunchFeedV2(
  request: Request,
): Promise<Response> {
  return productionHandlers.feed(request);
}

export function handleProductionGenericLaunchDetailV2(
  request: Request,
  recordHash: string,
): Promise<Response> {
  return productionHandlers.detail(request, recordHash);
}

function inactiveHandlers() {
  return Object.freeze({
    async feed(request: Request): Promise<Response> {
      if (parseFeedRequest(request) === null) {
        return errorResponse(400, "invalid_generic_launch_v2_feed_request");
      }
      return errorResponse(503, "generic_launch_v2_not_active");
    },
    async detail(request: Request, recordHash: string): Promise<Response> {
      if (!validBaseReadRequest(request) || new URL(request.url).search !== ""
        || !DIGEST.test(recordHash)) {
        return errorResponse(400, "invalid_generic_launch_v2_detail_request");
      }
      return errorResponse(503, "generic_launch_v2_not_active");
    },
  });
}

function prepareActiveReadModel(
  binding: GenericLaunchReadBindingV2,
  store: GenericLaunchReadStoreV2 | null,
): Readonly<{
  store: GenericLaunchReadStoreV2;
  readModelBindingHash: Sha256Digest;
  publicKey: ReturnType<typeof createPublicKey>;
}> {
  const capturedStore = captureReadStore(store);
  const contract = parseGenericLaunchReadModelContractV2(
    capturedStore.readModelContract,
  );
  const readModelBindingHash = canonicalSha256(contract.schemaVersion, contract);
  if (readModelBindingHash !== binding.readModelBindingHash) {
    throw new TypeError("generic launch V2 read model is not activation-bound");
  }
  const spki = Buffer.from(
    binding.readModelVerifier.publicKeySpkiBase64Url,
    "base64url",
  );
  const publicKeySha256 =
    `sha256:${createHash("sha256").update(spki).digest("hex")}`;
  if (publicKeySha256 !== binding.readModelVerifier.publicKeySha256) {
    throw new TypeError("generic launch V2 read public key hash is invalid");
  }
  const publicKey = createPublicKey({ key: spki, format: "der", type: "spki" });
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("generic launch V2 read public key is not Ed25519");
  }
  return Object.freeze({
    store: Object.freeze({
      sourceLane: "generic.finalized-launch-v2" as const,
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
  binding: GenericLaunchReadBindingV2,
  readModel: Readonly<{
    readModelBindingHash: Sha256Digest;
    publicKey: ReturnType<typeof createPublicKey>;
  }>,
  raw: string,
  requestBindingHash: Sha256Digest,
): unknown {
  if (typeof raw !== "string"
    || Buffer.byteLength(raw, "utf8") > MAX_SIGNED_MESSAGE_BYTES) {
    throw new TypeError("signed generic launch V2 read envelope exceeds its bound");
  }
  const envelopeSnapshot = parseStrictJson(raw, {
    maximumBytes: MAX_SIGNED_MESSAGE_BYTES,
    maximumDepth: 128,
  });
  if (canonicalizeJson(envelopeSnapshot) !== raw) {
    throw new TypeError("signed generic launch V2 read envelope is not canonical");
  }
  const value = exactObject(envelopeSnapshot, [
    "activationBindingHash", "payload", "readModelBindingHash",
    "requestBindingHash", "schemaVersion", "signatureBase64Url",
  ], "signed generic launch V2 read envelope");
  if (value.schemaVersion !== "programmable.signed-generic-launch-read-envelope.v2"
    || value.activationBindingHash !== binding.activationBindingHash
    || value.readModelBindingHash !== readModel.readModelBindingHash
    || value.requestBindingHash !== requestBindingHash
    || typeof value.signatureBase64Url !== "string"
    || !BASE64URL_SIGNATURE.test(value.signatureBase64Url)) {
    throw new TypeError("signed generic launch V2 read envelope is invalid");
  }
  const message = Object.freeze({
    schemaVersion: "programmable.generic-launch-read-signature-message.v2" as const,
    activationBindingHash: binding.activationBindingHash,
    readModelBindingHash: readModel.readModelBindingHash,
    requestBindingHash,
    payload: value.payload,
  });
  const canonicalMessage = canonicalizeJson(message as unknown as JsonValue);
  if (!verifySignature(
    null,
    Buffer.from(canonicalMessage, "utf8"),
    readModel.publicKey,
    Buffer.from(value.signatureBase64Url, "base64url"),
  )) throw new TypeError("generic launch V2 read signature is invalid");
  const snapshot = exactObject(parseStrictJson(canonicalMessage, {
    maximumBytes: MAX_SIGNED_MESSAGE_BYTES,
    maximumDepth: 128,
  }), [
    "activationBindingHash", "payload", "readModelBindingHash",
    "requestBindingHash", "schemaVersion",
  ], "verified generic launch V2 read message");
  if (snapshot.schemaVersion
      !== "programmable.generic-launch-read-signature-message.v2"
    || snapshot.activationBindingHash !== binding.activationBindingHash
    || snapshot.readModelBindingHash !== readModel.readModelBindingHash
    || snapshot.requestBindingHash !== requestBindingHash) {
    throw new TypeError("verified generic launch V2 read message is invalid");
  }
  return snapshot.payload;
}

function captureReadStore(
  raw: GenericLaunchReadStoreV2 | null,
): GenericLaunchReadStoreV2 {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("active generic launch V2 read store is invalid");
  }
  const prototype = Object.getPrototypeOf(raw) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("active generic launch V2 read store must be a plain object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const keys = Reflect.ownKeys(descriptors);
  const expected = [
    "findFinalizedLaunchByRecordHash", "findFinalizedLaunches",
    "readModelContract", "sourceLane",
  ];
  if (keys.some((key) => typeof key !== "string")) {
    throw new TypeError("active generic launch V2 read store contains symbols");
  }
  const sortedKeys = (keys as string[]).sort();
  if (sortedKeys.length !== expected.length
    || sortedKeys.some((key, index) => key !== expected[index])) {
    throw new TypeError("active generic launch V2 read store has unexpected properties");
  }
  const captured: Record<string, unknown> = Object.create(null);
  for (const key of sortedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || descriptor.get !== undefined
      || descriptor.set !== undefined || !descriptor.enumerable
      || !("value" in descriptor)) {
      throw new TypeError(
        "active generic launch V2 read store contains non-data properties",
      );
    }
    captured[key] = descriptor.value;
  }
  if (captured.sourceLane !== "generic.finalized-launch-v2"
    || typeof captured.findFinalizedLaunches !== "function"
    || typeof captured.findFinalizedLaunchByRecordHash !== "function") {
    throw new TypeError("active generic launch V2 read store is invalid");
  }
  const findFinalizedLaunches = captured.findFinalizedLaunches as
    GenericLaunchReadStoreV2["findFinalizedLaunches"];
  const findFinalizedLaunchByRecordHash =
    captured.findFinalizedLaunchByRecordHash as
      GenericLaunchReadStoreV2["findFinalizedLaunchByRecordHash"];
  return Object.freeze({
    sourceLane: "generic.finalized-launch-v2" as const,
    readModelContract:
      captured.readModelContract as GenericLaunchReadModelContractV2,
    findFinalizedLaunches: (
      input: Parameters<GenericLaunchReadStoreV2["findFinalizedLaunches"]>[0],
    ) => findFinalizedLaunches(input),
    findFinalizedLaunchByRecordHash: (
      input: Parameters<
        GenericLaunchReadStoreV2["findFinalizedLaunchByRecordHash"]
      >[0],
    ) => findFinalizedLaunchByRecordHash(input),
  });
}

function parseGenericLaunchReadModelContractV2(
  raw: unknown,
): GenericLaunchReadModelContractV2 {
  const value = exactObject(raw, [
    "approvalArtifactSchemaBindingHash", "approvalReleaseBindingHash",
    "implementationBindingHash", "persistenceBindingHash",
    "queryContractBindingHash", "registryProjectionBindingHash",
    "schemaVersion", "sourceLane",
  ], "generic launch V2 read model contract");
  if (value.schemaVersion !== "programmable.generic-launch-read-model-contract.v2"
    || value.sourceLane !== "generic.finalized-launch-v2") {
    throw new TypeError("generic launch V2 read model contract is invalid");
  }
  return Object.freeze({
    schemaVersion: "programmable.generic-launch-read-model-contract.v2" as const,
    sourceLane: "generic.finalized-launch-v2" as const,
    implementationBindingHash: digest(
      value.implementationBindingHash,
      "generic launch V2 read model implementation binding",
    ),
    persistenceBindingHash: digest(
      value.persistenceBindingHash,
      "generic launch V2 read model persistence binding",
    ),
    queryContractBindingHash: digest(
      value.queryContractBindingHash,
      "generic launch V2 read model query binding",
    ),
    approvalArtifactSchemaBindingHash: digest(
      value.approvalArtifactSchemaBindingHash,
      "generic launch V2 Approval schema binding",
    ),
    approvalReleaseBindingHash: digest(
      value.approvalReleaseBindingHash,
      "generic launch V2 Approval release binding",
    ),
    registryProjectionBindingHash: digest(
      value.registryProjectionBindingHash,
      "generic launch V2 Registry projection binding",
    ),
  });
}

function assertPage(
  binding: GenericLaunchReadBindingV2,
  readModelBindingHash: Sha256Digest,
  raw: unknown,
  limit: number,
  currentCursor: string | null,
): GenericLaunchReadPageV2 {
  const value = exactObject(raw, ["nextCursor", "records", "total"],
    "generic launch V2 page");
  if (!Array.isArray(value.records) || value.records.length > limit) {
    throw new TypeError("generic launch V2 page exceeds its bound");
  }
  const records = value.records.map((candidate) =>
    assertBindingBoundRecord(binding, readModelBindingHash, candidate));
  if (new Set(records.map(({ recordHash }) => recordHash)).size !== records.length) {
    throw new TypeError("generic launch V2 page contains duplicate records");
  }
  const nextCursor = value.nextCursor === null
    ? null
    : cursor(value.nextCursor, "generic launch V2 next cursor");
  if (nextCursor !== null
    && (records.length === 0 || nextCursor === currentCursor)) {
    throw new TypeError("generic launch V2 page cannot advance its cursor");
  }
  const total = decimal(value.total, "generic launch V2 total");
  if (BigInt(total) < BigInt(records.length)) {
    throw new TypeError("generic launch V2 total is invalid");
  }
  return Object.freeze({ records: Object.freeze(records), nextCursor, total });
}

function assertBindingBoundRecord(
  binding: GenericLaunchReadBindingV2,
  readModelBindingHash: Sha256Digest,
  raw: unknown,
): GenericLaunchRecordV2 {
  const record = parseGenericLaunchRecordV2(raw);
  const registry = record.sourceProjection.lifecycle;
  if (record.readModelBindingHash !== readModelBindingHash
    || registry.chainId !== binding.registryIdentity.chainId
    || registry.generation !== binding.registryIdentity.generation
    || registry.registryAddress !== binding.registryIdentity.registryAddress
    || registry.registryRuntimeCodeKeccak256
      !== binding.registryIdentity.registryRuntimeCodeKeccak256
    || registry.registryPolicyCommitment
      !== binding.registryIdentity.registryPolicyCommitment
    || registry.minimumFinalityBlocks
      !== binding.registryIdentity.minimumFinalityBlocks) {
    throw new TypeError("generic launch V2 record is not activation-bound");
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
    || request.headers.get("accept")?.trim().toLowerCase()
      !== "application/json") return false;
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
  const keys = Reflect.ownKeys(raw);
  if (keys.some((key) => typeof key !== "string")) {
    throw new TypeError(`${label} contains symbols`);
  }
  const sorted = (keys as string[]).sort();
  const expected = [...expectedKeys].sort();
  if (sorted.length !== expected.length
    || sorted.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has unexpected properties`);
  }
  for (const key of sorted) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor === undefined || descriptor.get !== undefined
      || descriptor.set !== undefined || !descriptor.enumerable
      || !("value" in descriptor)) {
      throw new TypeError(`${label} contains non-data properties`);
    }
  }
  return raw as Readonly<Record<string, unknown>>;
}

function digest(value: unknown, label: string): Sha256Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Sha256Digest;
}

function hash32(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !HASH32.test(value)
    || /^0x0{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as `0x${string}`;
}

function evmAddress(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !ADDRESS.test(value)
    || /^0x0{40}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as `0x${string}`;
}

function decimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function positiveDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !POSITIVE_DECIMAL.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function cursor(value: unknown, label: string): string {
  if (typeof value !== "string" || !CURSOR.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("generic launch V2 activation timestamp is invalid");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new TypeError("generic launch V2 activation timestamp is invalid");
  }
  return value;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
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
    schemaVersion: "programmable.custom-launch-error.v1",
    code,
  });
}
