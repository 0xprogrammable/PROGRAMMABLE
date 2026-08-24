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

export const CUSTOM_LAUNCH_LIST_SCHEMA_V1 =
  "programmable.custom-launch-list.v1" as const;

const MAXIMUM_BACKEND_BODY_BYTES = 131_072;
const DEFAULT_BACKEND_TIMEOUT_MS = 5_000;
const DEFAULT_PAGE_SIZE = 5;
const MAXIMUM_PAGE_SIZE = 10;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const REQUEST_HASH = /^sha256:[0-9a-f]{64}$/u;
const STATUSES = new Set([
  "received",
  "validating",
  "prepared",
  "authorized",
  "submitted",
  "finalized",
  "failed",
  "cancelled",
]);
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

export interface DeveloperLaunchHistoryBridgeV1 {
  list(request: Request): Promise<Response>;
  get(request: Request, launchId: string): Promise<Response>;
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
        const backendUrl = new URL(
          "/v1/wallet-admin/custom-launches",
          backendBaseUrl,
        );
        backendUrl.searchParams.set("limit", String(query.limit));
        if (query.cursor !== null) {
          backendUrl.searchParams.set("cursor", query.cursor);
        }
        const headers = new Headers({
          Accept: "application/json",
          Authorization: `Bearer ${websiteToken}`,
          "X-Programmable-Privy-User-Id": principal.privyUserId,
          "X-Programmable-Wallet-Address": walletAddress,
        });
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
        if (!backend.ok) throw new BackendContractErrorV1();
        const value = await readBoundedBackendJson(backend);
        const record = jsonRecord(value);
        if (record.schemaVersion !== CUSTOM_LAUNCH_LIST_SCHEMA_V1) {
          throw new BackendContractErrorV1();
        }
        if (!Array.isArray(record.launches) || record.launches.length > query.limit) {
          throw new BackendContractErrorV1();
        }
        const expectedWallet = walletAddress.toLowerCase();
        const launches = Object.freeze(record.launches.map((launch) =>
          parseLaunch(launch, expectedWallet)
        ));
        const nextCursor = record.nextCursor === null
          ? null
          : canonicalCursor(record.nextCursor, "backend");
        return jsonResponse(200, {
          schemaVersion: CUSTOM_LAUNCH_LIST_SCHEMA_V1,
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
        const walletAddress = requireLinkedWallet(principal, walletInput);
        const backendUrl = new URL(
          `/v1/wallet-admin/custom-launches/${encodeURIComponent(launchId.toLowerCase())}`,
          backendBaseUrl,
        );
        const headers = new Headers({
          Accept: "application/json",
          Authorization: `Bearer ${websiteToken}`,
          "X-Programmable-Privy-User-Id": principal.privyUserId,
          "X-Programmable-Wallet-Address": walletAddress,
        });
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
        if (backend.status === 404) {
          throw new BrowserRequestErrorV1(404, "launch_not_found");
        }
        if (!backend.ok) throw new BackendContractErrorV1();
        const launch = parseLaunch(
          await readBoundedBackendJson(backend),
          walletAddress.toLowerCase(),
        );
        if (launch.requestId !== launchId.toLowerCase()) {
          throw new BackendContractErrorV1();
        }
        return jsonResponse(200, { ...launch });
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
    cursor: cursorValue === null ? null : canonicalCursor(cursorValue, "browser"),
  });
}

function exactWalletQuery(request: Request) {
  const entries = [...new URL(request.url).searchParams.entries()];
  if (
    entries.length !== 1
    || entries[0]?.[0] !== "walletAddress"
    || !entries[0][1]
  ) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  return entries[0][1];
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
): DeveloperCustomLaunchV1 {
  const record = jsonRecord(value);
  if (
    record.schemaVersion !== "programmable.custom-launch.v1"
    || typeof record.launchId !== "string"
    || !UUID.test(record.launchId)
    || typeof record.requestId !== "string"
    || !UUID.test(record.requestId)
    || record.requestId.toLowerCase() !== record.launchId.toLowerCase()
    || (record.onchainLaunchId !== null && (
      typeof record.onchainLaunchId !== "string"
      || !/^0x[0-9a-f]{64}$/u.test(record.onchainLaunchId)
    ))
    || record.routeId !== "custom-launch:create:v1"
    || typeof record.ownerWallet !== "string"
    || !isAddress(record.ownerWallet)
    || record.ownerWallet.toLowerCase() !== expectedWallet
    || typeof record.status !== "string"
    || !STATUSES.has(record.status)
    || typeof record.requestHash !== "string"
    || !REQUEST_HASH.test(record.requestHash)
  ) throw new BackendContractErrorV1();
  const output = record.output === null
    ? null
    : jsonRecord(record.output);
  const failure = record.failure === null
    ? null
    : parseFailure(record.failure);
  return Object.freeze({
    schemaVersion: "programmable.custom-launch.v1" as const,
    launchId: record.launchId.toLowerCase(),
    requestId: record.requestId.toLowerCase(),
    onchainLaunchId: record.onchainLaunchId as `0x${string}` | null,
    routeId: "custom-launch:create:v1" as const,
    ownerWallet: record.ownerWallet.toLowerCase() as `0x${string}`,
    status: record.status,
    requestHash: record.requestHash,
    createdAt: requiredTimestamp(record.createdAt),
    updatedAt: requiredTimestamp(record.updatedAt),
    output,
    failure,
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

async function readBoundedBackendJson(response: Response): Promise<JsonValue> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength)
    && declaredLength > MAXIMUM_BACKEND_BODY_BYTES
  ) throw new BackendContractErrorV1();
  const text = await response.text();
  if (!text || Buffer.byteLength(text, "utf8") > MAXIMUM_BACKEND_BODY_BYTES) {
    throw new BackendContractErrorV1();
  }
  try {
    return parseStrictJson(text, {
      maximumBytes: MAXIMUM_BACKEND_BODY_BYTES,
      maximumDepth: 16,
    });
  } catch {
    throw new BackendContractErrorV1();
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

function mappedError(error: unknown) {
  if (error instanceof WalletPrincipalAuthenticationErrorV1) {
    return errorResponse(error.status, error.code);
  }
  if (error instanceof BrowserRequestErrorV1) {
    return errorResponse(error.status, error.code);
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
) {
  const headers = new Headers(RESPONSE_HEADERS);
  if (allow) headers.set("Allow", allow);
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(status: number, code: string, allow?: string) {
  return jsonResponse(status, {
    schemaVersion: CUSTOM_LAUNCH_LIST_SCHEMA_V1,
    error: Object.freeze({
      code,
      message: status >= 500
        ? "Launch history is temporarily unavailable."
        : "The request could not be completed.",
    }),
  }, allow);
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
