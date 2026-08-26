import "server-only";

import { getAddress, isAddress } from "viem";

import { parseStrictJson, type JsonValue } from
  "../projection-target/canonical-json";
import {
  createPrivyWalletPrincipalAuthenticatorV1,
  WalletPrincipalAuthenticationErrorV1,
  type AuthenticatedWalletPrincipalV1,
  type WalletPrincipalAuthenticatorV1,
} from "../creator-article/wallet-principal.server";
import {
  PreservedBackendPublicErrorV1,
  readPreservedBackendPublicErrorV1,
} from "./backend-public-error-v1";

export const CUSTOM_LAUNCH_LIST_SCHEMA_V1 =
  "programmable.custom-launch-list.v1" as const;
export const CUSTOM_LAUNCH_LIST_SCHEMA_V2 =
  "programmable.custom-launch-list.v2" as const;
export const CUSTOM_LAUNCH_LIST_SCHEMA_V3 =
  "programmable.custom-launch-list.v3" as const;
export const CUSTOM_LAUNCH_HISTORY_SCHEMA_V1 =
  "programmable.custom-launch-history.v1" as const;

// Wallet-admin lists are deliberately compact (`output: null`). A single
// authorized resource carries the exact graph transaction and can exceed
// 128 KiB because initcode is bound in both the artifact and calldata.
const MAXIMUM_BACKEND_LIST_BODY_BYTES = 262_144;
const MAXIMUM_BACKEND_RESOURCE_BODY_BYTES = 1_048_576;
const MAXIMUM_BROWSER_FUNDING_BODY_BYTES = 1_024;
const DEFAULT_BACKEND_TIMEOUT_MS = 5_000;
const DEFAULT_PAGE_SIZE = 5;
const MAXIMUM_PAGE_SIZE = 10;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const REQUEST_HASH = /^sha256:[0-9a-f]{64}$/u;
const STATUSES_V1 = new Set([
  "received",
  "validating",
  "prepared",
  "authorized",
  "submitted",
  "finalized",
  "failed",
  "cancelled",
]);
const STATUSES_V2 = new Set([...STATUSES_V1, "simulating"]);
const STATUSES_V3 = new Set([
  ...STATUSES_V2,
  "awaiting_funding_authorization",
  "funding_authorization_verified",
]);
const FUNDING_SIGNATURE_SCHEMA_V1 =
  "programmable.custom-launch-funding-authorization-signature.v1" as const;
const LOWER_BYTES32 = /^0x[0-9a-f]{64}$/u;
const LOWER_SIGNATURE = /^0x[0-9a-f]{130}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/u;
const RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  Vary: "Authorization, X-Privy-Identity-Token",
});

export type DeveloperCustomLaunchV1 = Readonly<{
  schemaVersion: "programmable.custom-launch.v1";
  launchId: string;
  requestId: string;
  onchainLaunchId: `0x${string}` | null;
  routeId: "custom-launch:create:v1";
  ownerWallet: `0x${string}`;
  status: string;
  requestHash: string;
  createdAt: string;
  updatedAt: string;
  output: Readonly<Record<string, JsonValue>> | null;
  failure: Readonly<{
    code: string;
    message: string;
    retryable: boolean;
  }> | null;
}>;

export type DeveloperCustomLaunchV2 = Readonly<{
  schemaVersion: "programmable.custom-launch.v2";
  launchId: string;
  requestId: string;
  onchainLaunchId: `0x${string}` | null;
  routeId: "custom-launch:create:v2";
  ownerWallet: `0x${string}`;
  status: string;
  requestHash: string;
  launchProfileHash: `sha256:${string}`;
  launchIntentHash: `sha256:${string}`;
  createdAt: string;
  updatedAt: string;
  output: Readonly<Record<string, JsonValue>> | null;
  failure: DeveloperCustomLaunchV1["failure"];
}>;

export type DeveloperCustomLaunchV3 = Readonly<{
  schemaVersion: "programmable.custom-launch.v3";
  launchId: string;
  requestId: string;
  onchainLaunchId: `0x${string}` | null;
  routeId: "custom-launch:create:v3";
  ownerWallet: `0x${string}`;
  status: string;
  requestHash: string;
  launchProfileHash: `sha256:${string}`;
  launchIntentHash: `sha256:${string}`;
  fundingIntentHash: `0x${string}`;
  createdAt: string;
  updatedAt: string;
  output: Readonly<Record<string, JsonValue>> | null;
  failure: DeveloperCustomLaunchV1["failure"];
}>;

type DeveloperCustomLaunch = DeveloperCustomLaunchV1
  | DeveloperCustomLaunchV2
  | DeveloperCustomLaunchV3;
type BackendHistoryVersion = "v1" | "v2" | "v3";

export interface DeveloperLaunchHistoryBridgeV1 {
  list(request: Request): Promise<Response>;
  get(request: Request, launchId: string): Promise<Response>;
  submitFundingAuthorization(
    request: Request,
    launchId: string,
  ): Promise<Response>;
}

export type DeveloperLaunchHistoryBackendFetchV1 = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createDeveloperLaunchHistoryBridgeV1(input: Readonly<{
  authenticator: WalletPrincipalAuthenticatorV1;
  backendBaseUrl: string;
  websiteToken: string;
  fetchBackend: DeveloperLaunchHistoryBackendFetchV1;
  backendTimeoutMs?: number;
}>): DeveloperLaunchHistoryBridgeV1 {
  const backendBaseUrl = normalizedBackendBaseUrl(input.backendBaseUrl);
  const websiteToken = boundedWebsiteToken(input.websiteToken);
  const timeoutMs = input.backendTimeoutMs ?? DEFAULT_BACKEND_TIMEOUT_MS;
  if (
    typeof input.authenticator?.authenticate !== "function"
    || typeof input.fetchBackend !== "function"
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 250
    || timeoutMs > 15_000
  ) throw new TypeError("Developer launch history bridge configuration is invalid");

  return Object.freeze({
    async list(request: Request) {
      if (request.method !== "GET") {
        return errorResponse(405, "method_not_allowed", "GET");
      }
      try {
        requireJsonResponse(request);
        const query = exactHistoryQuery(request);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(principal, query.walletAddress);
        const headers = new Headers({
          Accept: "application/json",
          Authorization: `Bearer ${websiteToken}`,
          "X-Programmable-Privy-User-Id": principal.privyUserId,
          "X-Programmable-Wallet-Address": walletAddress,
        });
        const expectedWallet = walletAddress.toLowerCase();
        const readVersion = async (version: BackendHistoryVersion) => {
          const cursorState = query.cursor?.[version];
          if (cursorState?.done) {
            return Object.freeze({
              version,
              launches: Object.freeze([] as DeveloperCustomLaunch[]),
              nextCursor: null,
              done: true,
            });
          }
          const backendUrl = new URL(
            `/${version}/wallet-admin/custom-launches`,
            backendBaseUrl,
          );
          backendUrl.searchParams.set("limit", String(query.limit));
          if (cursorState?.cursor) {
            backendUrl.searchParams.set("cursor", cursorState.cursor);
          }
          const backend = await input.fetchBackend(backendUrl, {
            method: "GET",
            headers,
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.any([
              request.signal,
              AbortSignal.timeout(timeoutMs),
            ]),
          });
          // During route-isolated rollouts, a missing additive list is an
          // empty lane. Earlier history must remain available independently.
          if (version !== "v1" && backend.status === 404) {
            return Object.freeze({
              version,
              launches: Object.freeze([] as DeveloperCustomLaunch[]),
              nextCursor: null,
              done: true,
            });
          }
          if (version === "v3" && backend.status === 503) {
            const pending = await readPreservedBackendPublicErrorV1(
              backend.clone(),
            );
            if (
              pending?.code === "CUSTOM_LAUNCH_V3_INTEGRATION_PENDING"
              && pending.retryAfter === "30"
            ) {
              return Object.freeze({
                version,
                launches: Object.freeze([] as DeveloperCustomLaunch[]),
                nextCursor: null,
                done: true,
              });
            }
          }
          if (!backend.ok) throw await mappedBackendError(backend);
          const record = jsonRecord(await readBoundedBackendJson(
            backend,
            MAXIMUM_BACKEND_LIST_BODY_BYTES,
          ));
          const expectedSchema = version === "v1"
            ? CUSTOM_LAUNCH_LIST_SCHEMA_V1
            : version === "v2"
              ? CUSTOM_LAUNCH_LIST_SCHEMA_V2
              : CUSTOM_LAUNCH_LIST_SCHEMA_V3;
          if (
            record.schemaVersion !== expectedSchema ||
            !Array.isArray(record.launches) ||
            record.launches.length > query.limit
          ) throw new BackendContractErrorV1();
          const launches = Object.freeze(record.launches.map((launch) =>
            parseLaunch(launch, expectedWallet, version)
          ));
          const nextCursor = record.nextCursor === null
            ? null
            : canonicalCursor(record.nextCursor, "backend");
          return Object.freeze({
            version,
            launches,
            nextCursor,
            done: nextCursor === null,
          });
        };
        const [v1, v2, v3] = await Promise.all([
          readVersion("v1"),
          readVersion("v2"),
          readVersion("v3"),
        ]);
        const launches = Object.freeze([
          ...v1.launches,
          ...v2.launches,
          ...v3.launches,
        ]
          .sort(compareLaunchHistoryEntries));
        const nextCursor = v1.done && v2.done && v3.done
          ? null
          : encodeCombinedHistoryCursor({ v1, v2, v3 });
        return jsonResponse(200, {
          schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
          launches,
          nextCursor,
        });
      } catch (error) {
        return mappedError(error);
      }
    },

    async get(request: Request, launchId: string) {
      if (request.method !== "GET") {
        return errorResponse(405, "method_not_allowed", "GET");
      }
      try {
        requireJsonResponse(request);
        if (!UUID.test(launchId)) {
          throw new BrowserRequestErrorV1(404, "launch_not_found");
        }
        const walletInput = exactWalletQuery(request);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(
          principal,
          walletInput.walletAddress,
        );
        const headers = new Headers({
          Accept: "application/json",
          Authorization: `Bearer ${websiteToken}`,
          "X-Programmable-Privy-User-Id": principal.privyUserId,
          "X-Programmable-Wallet-Address": walletAddress,
        });
        const readVersion = async (version: BackendHistoryVersion) => {
          const backendUrl = new URL(
            `/${version}/wallet-admin/custom-launches/${
              encodeURIComponent(launchId.toLowerCase())
            }`,
            backendBaseUrl,
          );
          const backend = await input.fetchBackend(backendUrl, {
            method: "GET",
            headers,
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.any([
              request.signal,
              AbortSignal.timeout(timeoutMs),
            ]),
          });
          if (backend.status === 404) return null;
          if (!backend.ok) throw await mappedBackendError(backend);
          return parseLaunch(
            await readBoundedBackendJson(
              backend,
              MAXIMUM_BACKEND_RESOURCE_BODY_BYTES,
            ),
            walletAddress.toLowerCase(),
            version,
          );
        };
        let launch: DeveloperCustomLaunch | null = null;
        if (walletInput.version) {
          launch = await readVersion(walletInput.version);
        } else {
          launch = await readVersion("v1")
            ?? await readVersion("v2")
            ?? await readVersion("v3");
        }
        if (!launch) throw new BrowserRequestErrorV1(404, "launch_not_found");
        if (launch.requestId !== launchId.toLowerCase()) {
          throw new BackendContractErrorV1();
        }
        return jsonResponse(200, { ...launch });
      } catch (error) {
        return mappedError(error);
      }
    },

    async submitFundingAuthorization(request: Request, launchId: string) {
      if (request.method !== "POST") {
        return errorResponse(405, "method_not_allowed", "POST");
      }
      try {
        requireJsonRequest(request);
        if (!UUID.test(launchId)) {
          throw new BrowserRequestErrorV1(404, "launch_not_found");
        }
        const walletInput = exactWalletQuery(request);
        if (walletInput.version !== "v3") {
          throw new BrowserRequestErrorV1(400, "request_schema_invalid");
        }
        const body = parseFundingSignatureSubmission(
          await readBoundedBrowserJson(request),
        );
        const idempotencyKey = request.headers.get("idempotency-key");
        if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
          throw new BrowserRequestErrorV1(400, "idempotency_key_invalid");
        }
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(
          principal,
          walletInput.walletAddress,
        );
        const headers = new Headers({
          Accept: "application/json",
          Authorization: `Bearer ${websiteToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-Programmable-Privy-User-Id": principal.privyUserId,
          "X-Programmable-Wallet-Address": walletAddress,
        });
        const backendUrl = new URL(
          `/v3/wallet-admin/custom-launches/${
            encodeURIComponent(launchId.toLowerCase())
          }/funding-authorization`,
          backendBaseUrl,
        );
        const backend = await input.fetchBackend(backendUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(timeoutMs),
          ]),
        });
        if (!backend.ok) throw await mappedBackendError(backend);
        if (backend.status !== 200 && backend.status !== 202) {
          throw new BackendContractErrorV1();
        }
        const launch = parseLaunch(
          await readBoundedBackendJson(
            backend,
            MAXIMUM_BACKEND_RESOURCE_BODY_BYTES,
          ),
          walletAddress.toLowerCase(),
          "v3",
        );
        if (launch.requestId !== launchId.toLowerCase()) {
          throw new BackendContractErrorV1();
        }
        return jsonResponse(backend.status, { ...launch });
      } catch (error) {
        return mappedError(error);
      }
    },
  });
}

let productionBridge: DeveloperLaunchHistoryBridgeV1 | null = null;

export function getProductionDeveloperLaunchHistoryBridgeV1() {
  productionBridge ??= createDeveloperLaunchHistoryBridgeV1({
    authenticator: createPrivyWalletPrincipalAuthenticatorV1(),
    backendBaseUrl: requiredEnvironment(
      "PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL",
    ),
    websiteToken: requiredEnvironment(
      "PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN",
    ),
    fetchBackend: fetch,
  });
  return productionBridge;
}

function exactHistoryQuery(request: Request) {
  const search = new URL(request.url).searchParams;
  for (const key of search.keys()) {
    if (key !== "walletAddress" && key !== "limit" && key !== "cursor") {
      throw new BrowserRequestErrorV1(400, "request_schema_invalid");
    }
    if (search.getAll(key).length !== 1) {
      throw new BrowserRequestErrorV1(400, "request_schema_invalid");
    }
  }
  const walletAddress = search.get("walletAddress");
  if (walletAddress === null) {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  const limitValue = search.get("limit");
  const limit = limitValue === null
    ? DEFAULT_PAGE_SIZE
    : parsePageSize(limitValue);
  const cursorValue = search.get("cursor");
  return Object.freeze({
    walletAddress,
    limit,
    cursor: cursorValue === null
      ? null
      : parseCombinedHistoryCursor(cursorValue),
  });
}

function exactWalletQuery(request: Request) {
  const search = new URL(request.url).searchParams;
  for (const key of search.keys()) {
    if (key !== "walletAddress" && key !== "version") {
      throw new BrowserRequestErrorV1(400, "request_schema_invalid");
    }
    if (search.getAll(key).length !== 1) {
      throw new BrowserRequestErrorV1(400, "request_schema_invalid");
    }
  }
  const walletAddress = search.get("walletAddress");
  const versionValue = search.get("version");
  if (
    !walletAddress ||
    (versionValue !== null
      && versionValue !== "v1"
      && versionValue !== "v2"
      && versionValue !== "v3")
  ) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  return Object.freeze({
    walletAddress,
    version: versionValue as BackendHistoryVersion | null,
  });
}

function parsePageSize(value: string) {
  if (!/^[1-9][0-9]?$/u.test(value)) {
    throw new BrowserRequestErrorV1(400, "pagination_invalid");
  }
  const parsed = Number(value);
  if (parsed > MAXIMUM_PAGE_SIZE) {
    throw new BrowserRequestErrorV1(400, "pagination_invalid");
  }
  return parsed;
}

type CombinedHistoryCursorLane = Readonly<{
  cursor: string | null;
  done: boolean;
}>;

type CombinedHistoryCursor = Readonly<{
  v1: CombinedHistoryCursorLane;
  v2: CombinedHistoryCursorLane;
  v3: CombinedHistoryCursorLane;
}>;

function parseCombinedHistoryCursor(value: string): CombinedHistoryCursor {
  const invalid = () => {
    throw new BrowserRequestErrorV1(400, "pagination_invalid");
  };
  if (
    value.length < 16 ||
    value.length > 2_048 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) return invalid();
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return invalid();
    const decoded = parseStrictJson(bytes.toString("utf8"), {
      maximumBytes: 2_048,
      maximumDepth: 4,
    });
    if (decoded === null || Array.isArray(decoded) || typeof decoded !== "object") {
      return invalid();
    }
    // One-release compatibility for a browser that still holds the old V1
    // backend cursor. V2 starts at its first bounded page and dedupes by route.
    if ("createdAt" in decoded || "launchId" in decoded) {
      const legacy = canonicalCursor(value, "browser");
      return Object.freeze({
        v1: Object.freeze({ cursor: legacy, done: false }),
        v2: Object.freeze({ cursor: null, done: false }),
        v3: Object.freeze({ cursor: null, done: false }),
      });
    }
    const decodedKeys = Object.keys(decoded);
    const twoLaneCursor = decodedKeys.length === 2
      && "v1" in decoded
      && "v2" in decoded;
    const threeLaneCursor = decodedKeys.length === 3
      && "v1" in decoded
      && "v2" in decoded
      && "v3" in decoded;
    if (!twoLaneCursor && !threeLaneCursor) return invalid();
    const lane = (candidate: JsonValue | undefined) => {
      if (
        candidate === null ||
        candidate === undefined ||
        Array.isArray(candidate) ||
        typeof candidate !== "object" ||
        Object.keys(candidate).length !== 2 ||
        typeof candidate.done !== "boolean" ||
        (candidate.cursor !== null && typeof candidate.cursor !== "string") ||
        (candidate.done && candidate.cursor !== null) ||
        (!candidate.done && candidate.cursor === null)
      ) return invalid();
      return Object.freeze({
        cursor: candidate.cursor === null
          ? null
          : canonicalCursor(candidate.cursor, "browser"),
        done: candidate.done,
      });
    };
    const result = Object.freeze({
      v1: lane(decoded.v1),
      v2: lane(decoded.v2),
      v3: threeLaneCursor
        ? lane(decoded.v3)
        : Object.freeze({ cursor: null, done: false }),
    });
    if (result.v1.done && result.v2.done && result.v3.done) return invalid();
    const canonicalValue = twoLaneCursor
      ? Object.freeze({ v1: result.v1, v2: result.v2 })
      : result;
    const canonical = Buffer.from(JSON.stringify(canonicalValue), "utf8")
      .toString("base64url");
    if (canonical !== value) return invalid();
    return result;
  } catch (error) {
    if (error instanceof BrowserRequestErrorV1) throw error;
    return invalid();
  }
}

function encodeCombinedHistoryCursor(input: Readonly<{
  v1: Readonly<{ done: boolean; nextCursor: string | null }>;
  v2: Readonly<{ done: boolean; nextCursor: string | null }>;
  v3: Readonly<{ done: boolean; nextCursor: string | null }>;
}>) {
  const lane = (value: Readonly<{ done: boolean; nextCursor: string | null }>) =>
    Object.freeze({
      cursor: value.done
        ? null
        : canonicalCursor(value.nextCursor ?? undefined, "backend"),
      done: value.done,
    });
  return Buffer.from(JSON.stringify(Object.freeze({
    v1: lane(input.v1),
    v2: lane(input.v2),
    v3: lane(input.v3),
  })), "utf8").toString("base64url");
}

function compareLaunchHistoryEntries(
  left: DeveloperCustomLaunch,
  right: DeveloperCustomLaunch,
) {
  const timeOrder = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (timeOrder !== 0) return timeOrder;
  const idOrder = left.requestId.localeCompare(right.requestId);
  if (idOrder !== 0) return idOrder;
  return left.routeId.localeCompare(right.routeId);
}

function canonicalCursor(value: JsonValue | undefined, source: "browser" | "backend") {
  const invalid = () => {
    if (source === "browser") {
      throw new BrowserRequestErrorV1(400, "pagination_invalid");
    }
    throw new BackendContractErrorV1();
  };
  if (
    typeof value !== "string"
    || value.length < 16
    || value.length > 512
    || !/^[A-Za-z0-9_-]+$/u.test(value)
  ) return invalid();
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return invalid();
    const decoded = parseStrictJson(bytes.toString("utf8"), {
      maximumBytes: 512,
      maximumDepth: 2,
    });
    if (decoded === null || Array.isArray(decoded) || typeof decoded !== "object") {
      return invalid();
    }
    const record = decoded;
    if (
      Object.keys(record).length !== 2
      || typeof record.createdAt !== "string"
      || !CANONICAL_TIMESTAMP.test(record.createdAt)
      || !Number.isFinite(Date.parse(record.createdAt))
      || new Date(record.createdAt).toISOString() !== record.createdAt
      || typeof record.launchId !== "string"
      || !UUID.test(record.launchId)
    ) return invalid();
    const canonical = Buffer.from(JSON.stringify({
      createdAt: record.createdAt,
      launchId: record.launchId.toLowerCase(),
    }), "utf8").toString("base64url");
    if (canonical !== value) return invalid();
    return value;
  } catch (error) {
    if (
      error instanceof BrowserRequestErrorV1
      || error instanceof BackendContractErrorV1
    ) throw error;
    return invalid();
  }
}

function parseLaunch(
  value: JsonValue,
  expectedWallet: string,
  version: BackendHistoryVersion,
): DeveloperCustomLaunch {
  const record = jsonRecord(value);
  const expectedSchema = version === "v1"
    ? "programmable.custom-launch.v1"
    : version === "v2"
      ? "programmable.custom-launch.v2"
      : "programmable.custom-launch.v3";
  const expectedRoute = version === "v1"
    ? "custom-launch:create:v1"
    : version === "v2"
      ? "custom-launch:create:v2"
      : "custom-launch:create:v3";
  const statuses = version === "v1"
    ? STATUSES_V1
    : version === "v2"
      ? STATUSES_V2
      : STATUSES_V3;
  if (
    record.schemaVersion !== expectedSchema
    || typeof record.launchId !== "string"
    || !UUID.test(record.launchId)
    || typeof record.requestId !== "string"
    || !UUID.test(record.requestId)
    || record.requestId.toLowerCase() !== record.launchId.toLowerCase()
    || (record.onchainLaunchId !== null && (
      typeof record.onchainLaunchId !== "string"
      || !/^0x[0-9a-f]{64}$/u.test(record.onchainLaunchId)
    ))
    || record.routeId !== expectedRoute
    || typeof record.ownerWallet !== "string"
    || !isAddress(record.ownerWallet)
    || record.ownerWallet.toLowerCase() !== expectedWallet
    || typeof record.status !== "string"
    || !statuses.has(record.status)
    || typeof record.requestHash !== "string"
    || !REQUEST_HASH.test(record.requestHash)
    || (version !== "v1" && (
      typeof record.launchProfileHash !== "string"
      || !REQUEST_HASH.test(record.launchProfileHash)
      || typeof record.launchIntentHash !== "string"
      || !REQUEST_HASH.test(record.launchIntentHash)
    ))
    || (version === "v3" && (
      typeof record.fundingIntentHash !== "string"
      || !LOWER_BYTES32.test(record.fundingIntentHash)
    ))
  ) throw new BackendContractErrorV1();
  const output = record.output === null
    ? null
    : jsonRecord(record.output);
  const failure = record.failure === null
    ? null
    : parseFailure(record.failure);
  const base = {
    launchId: record.launchId.toLowerCase(),
    requestId: record.requestId.toLowerCase(),
    onchainLaunchId: record.onchainLaunchId as `0x${string}` | null,
    ownerWallet: record.ownerWallet.toLowerCase() as `0x${string}`,
    status: record.status,
    requestHash: record.requestHash,
    createdAt: requiredTimestamp(record.createdAt),
    updatedAt: requiredTimestamp(record.updatedAt),
    output,
    failure,
  };
  if (version === "v1") {
    return Object.freeze({
      ...base,
      schemaVersion: "programmable.custom-launch.v1" as const,
      routeId: "custom-launch:create:v1" as const,
    });
  }
  const profileBase = {
    ...base,
    launchProfileHash: record.launchProfileHash as `sha256:${string}`,
    launchIntentHash: record.launchIntentHash as `sha256:${string}`,
  };
  return version === "v2"
    ? Object.freeze({
        ...profileBase,
        schemaVersion: "programmable.custom-launch.v2" as const,
        routeId: "custom-launch:create:v2" as const,
      })
    : Object.freeze({
        ...profileBase,
        schemaVersion: "programmable.custom-launch.v3" as const,
        routeId: "custom-launch:create:v3" as const,
        fundingIntentHash: record.fundingIntentHash as `0x${string}`,
      });
}

function parseFailure(value: JsonValue) {
  const record = jsonRecord(value);
  if (
    typeof record.code !== "string"
    || record.code.length < 1
    || record.code.length > 128
    || typeof record.message !== "string"
    || record.message.length < 1
    || record.message.length > 512
    || typeof record.retryable !== "boolean"
  ) throw new BackendContractErrorV1();
  return Object.freeze({
    code: record.code,
    message: record.message,
    retryable: record.retryable,
  });
}

function parseFundingSignatureSubmission(value: JsonValue) {
  const record = jsonRecord(value);
  const keys = Object.keys(record);
  if (
    keys.length !== 4
    || !keys.every((key) => [
      "schemaVersion",
      "fundingIntentHash",
      "typedDataDigest",
      "signature",
    ].includes(key))
    || record.schemaVersion !== FUNDING_SIGNATURE_SCHEMA_V1
    || typeof record.fundingIntentHash !== "string"
    || !LOWER_BYTES32.test(record.fundingIntentHash)
    || typeof record.typedDataDigest !== "string"
    || !LOWER_BYTES32.test(record.typedDataDigest)
    || typeof record.signature !== "string"
    || !LOWER_SIGNATURE.test(record.signature)
  ) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  return Object.freeze({
    schemaVersion: FUNDING_SIGNATURE_SCHEMA_V1,
    fundingIntentHash: record.fundingIntentHash,
    typedDataDigest: record.typedDataDigest,
    signature: record.signature,
  });
}

function requireLinkedWallet(
  principal: AuthenticatedWalletPrincipalV1,
  value: string,
) {
  if (!isAddress(value)) {
    throw new BrowserRequestErrorV1(400, "wallet_address_invalid");
  }
  const walletAddress = getAddress(value);
  if (!principal.wallets.some((wallet) =>
    wallet.toLowerCase() === walletAddress.toLowerCase())) {
    throw new BrowserRequestErrorV1(403, "wallet_not_linked");
  }
  return walletAddress;
}

async function readBoundedBackendJson(
  response: Response,
  maximumBytes: number,
): Promise<JsonValue> {
  const contentLength = response.headers.get("content-length");
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (
    declaredLength !== null && (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > maximumBytes
    )
  ) throw new BackendContractErrorV1();
  if (!response.body) throw new BackendContractErrorV1();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new BackendContractErrorV1();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof BackendContractErrorV1) throw error;
    throw new BackendContractErrorV1();
  }
  if (!text) throw new BackendContractErrorV1();
  try {
    return parseStrictJson(text, {
      maximumBytes,
      maximumDepth: 16,
    });
  } catch {
    throw new BackendContractErrorV1();
  }
}

async function readBoundedBrowserJson(request: Request): Promise<JsonValue> {
  const contentLength = request.headers.get("content-length");
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (
    declaredLength !== null
    && (!Number.isSafeInteger(declaredLength)
      || declaredLength < 1
      || declaredLength > MAXIMUM_BROWSER_FUNDING_BODY_BYTES)
  ) throw new BrowserRequestErrorV1(413, "request_too_large");
  const text = await request.text();
  if (
    !text
    || Buffer.byteLength(text, "utf8") > MAXIMUM_BROWSER_FUNDING_BODY_BYTES
  ) throw new BrowserRequestErrorV1(413, "request_too_large");
  try {
    return parseStrictJson(text, {
      maximumBytes: MAXIMUM_BROWSER_FUNDING_BODY_BYTES,
      maximumDepth: 4,
    });
  } catch {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
}

function jsonRecord(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> {
  if (
    value === null
    || value === undefined
    || Array.isArray(value)
    || typeof value !== "object"
  ) throw new BackendContractErrorV1();
  return value;
}

function requiredTimestamp(value: JsonValue | undefined) {
  if (
    typeof value !== "string"
    || value.length < 20
    || value.length > 40
    || !Number.isFinite(Date.parse(value))
  ) throw new BackendContractErrorV1();
  return value;
}

function requireJsonResponse(request: Request) {
  const accept = request.headers.get("accept")?.toLowerCase();
  if (accept && !accept.includes("application/json") && !accept.includes("*/*")) {
    throw new BrowserRequestErrorV1(406, "json_response_required");
  }
}

function requireJsonRequest(request: Request) {
  requireJsonResponse(request);
  const contentType = request.headers.get("content-type")?.toLowerCase();
  if (!contentType || !contentType.startsWith("application/json")) {
    throw new BrowserRequestErrorV1(415, "json_request_required");
  }
}

function normalizedBackendBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Custom launch API base URL is invalid");
  }
  const localHttp = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (
    (url.protocol !== "https:" && !localHttp)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) throw new TypeError("Custom launch API base URL is invalid");
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/`;
  return url;
}

function boundedWebsiteToken(value: string) {
  if (
    typeof value !== "string"
    || value.length < 43
    || value.length > 512
    || /[\s\u0000]/u.test(value)
  ) throw new TypeError("Custom launch website token is invalid");
  return value;
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

async function mappedBackendError(response: Response) {
  const preserved = await readPreservedBackendPublicErrorV1(response);
  return preserved ?? new BackendContractErrorV1();
}

function mappedError(error: unknown) {
  if (error instanceof WalletPrincipalAuthenticationErrorV1) {
    return errorResponse(error.status, error.code);
  }
  if (error instanceof BrowserRequestErrorV1) {
    return errorResponse(error.status, error.code);
  }
  if (error instanceof PreservedBackendPublicErrorV1) {
    return errorResponse(
      error.status,
      error.code,
      undefined,
      error.publicMessage,
      error.requestId,
      error.retryAfter,
    );
  }
  console.error("Developer launch history request failed", {
    name: error instanceof Error ? error.name : "DeveloperLaunchHistoryError",
  });
  return errorResponse(503, "launch_history_unavailable");
}

function jsonResponse(
  status: number,
  body: Readonly<Record<string, unknown>>,
  allow?: string,
  requestId?: string | null,
  retryAfter?: string | null,
) {
  const headers = new Headers(RESPONSE_HEADERS);
  if (allow) headers.set("Allow", allow);
  if (requestId) headers.set("X-Request-Id", requestId);
  if (retryAfter) headers.set("Retry-After", retryAfter);
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(
  status: number,
  code: string,
  allow?: string,
  publicMessage?: string,
  requestId?: string | null,
  retryAfter?: string | null,
) {
  return jsonResponse(status, {
    schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
    error: Object.freeze({
      code,
      message: publicMessage ?? (status >= 500
        ? "Launch history is temporarily unavailable."
        : "The request could not be completed."),
      ...(requestId ? { requestId } : {}),
    }),
  }, allow, requestId, retryAfter);
}

class BrowserRequestErrorV1 extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "BrowserRequestErrorV1";
  }
}

class BackendContractErrorV1 extends Error {
  constructor() {
    super("launch_history_backend_contract_invalid");
    this.name = "BackendContractErrorV1";
  }
}
