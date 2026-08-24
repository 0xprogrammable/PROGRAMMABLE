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

export const CUSTOM_LAUNCH_API_SCHEMA_V1 =
  "programmable.custom-launch-api.v1" as const;

const MAXIMUM_BROWSER_BODY_BYTES = 4_096;
const MAXIMUM_BACKEND_BODY_BYTES = 65_536;
const DEFAULT_BACKEND_TIMEOUT_MS = 5_000;
const DEFAULT_EXPIRY_DAYS = 90;
const MAXIMUM_EXPIRY_DAYS = 366;
const CURRENT_SCOPES = Object.freeze([
  "custom-launch:create",
  "custom-launch:read",
] as const);

const RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  Vary: "Authorization, X-Privy-Identity-Token",
});

export type DeveloperApiKeySummaryV1 = Readonly<{
  id: string;
  label: string;
  keyPrefix: string;
  scopes: readonly (typeof CURRENT_SCOPES)[number][];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}>;

export interface DeveloperApiKeyBridgeV1 {
  list(request: Request): Promise<Response>;
  create(request: Request): Promise<Response>;
  revoke(request: Request, credentialId: string): Promise<Response>;
}

export type DeveloperApiKeyBackendFetchV1 = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createDeveloperApiKeyBridgeV1(input: Readonly<{
  authenticator: WalletPrincipalAuthenticatorV1;
  backendBaseUrl: string;
  websiteToken: string;
  fetchBackend: DeveloperApiKeyBackendFetchV1;
  backendTimeoutMs?: number;
}>): DeveloperApiKeyBridgeV1 {
  const backendBaseUrl = normalizedBackendBaseUrl(input.backendBaseUrl);
  const websiteToken = boundedWebsiteToken(input.websiteToken);
  const timeoutMs = input.backendTimeoutMs ?? DEFAULT_BACKEND_TIMEOUT_MS;
  if (
    typeof input.authenticator?.authenticate !== "function"
    || typeof input.fetchBackend !== "function"
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 250
    || timeoutMs > 15_000
  ) throw new TypeError("Developer API key bridge configuration is invalid");

  const callBackend = async (
    request: Request,
    principal: AuthenticatedWalletPrincipalV1,
    walletAddress: `0x${string}`,
    method: "GET" | "POST" | "DELETE",
    pathname: string,
    body?: Readonly<Record<string, JsonValue>>,
  ) => {
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${websiteToken}`,
      "X-Programmable-Privy-User-Id": principal.privyUserId,
      "X-Programmable-Wallet-Address": walletAddress,
    });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([request.signal, timeoutSignal]);
    return input.fetchBackend(new URL(pathname, backendBaseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal,
    });
  };

  return Object.freeze({
    async list(request: Request) {
      if (request.method !== "GET") {
        return errorResponse(405, "method_not_allowed", "GET");
      }
      try {
        requireJsonResponse(request);
        const walletInput = exactWalletQuery(request);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(principal, walletInput);
        const backend = await callBackend(
          request,
          principal,
          walletAddress,
          "GET",
          "/v1/wallet-admin/api-keys",
        );
        if (!backend.ok) throw mappedBackendError(backend.status);
        const value = await readBoundedBackendJson(backend);
        const record = jsonRecord(value);
        const apiKeys = parseApiKeyList(record.apiKeys);
        return jsonResponse(200, {
          schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
          apiKeys,
        });
      } catch (error) {
        return mappedError(error);
      }
    },

    async create(request: Request) {
      if (request.method !== "POST") {
        return errorResponse(405, "method_not_allowed", "POST");
      }
      try {
        requireJsonRequest(request);
        const body = await readBrowserJson(request);
        const parsed = parseCreateBody(body);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(principal, parsed.walletAddress);
        const backend = await callBackend(
          request,
          principal,
          walletAddress,
          "POST",
          "/v1/wallet-admin/api-keys",
          Object.freeze({
            schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
            label: parsed.label,
            expiresInDays: parsed.expiresInDays,
          }),
        );
        if (!backend.ok) throw mappedBackendError(backend.status);
        const value = await readBoundedBackendJson(backend);
        const record = jsonRecord(value);
        const apiKey = parseApiKeySummary(record.apiKey);
        const apiKeySecret = requiredString(record.apiKeySecret, 74, 74);
        if (!/^pm_live_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$/u.test(apiKeySecret)) {
          throw new BackendContractErrorV1();
        }
        if (!apiKeySecret.startsWith(`${apiKey.keyPrefix}_`)) {
          throw new BackendContractErrorV1();
        }
        return jsonResponse(201, {
          schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
          apiKey,
          apiKeySecret,
        });
      } catch (error) {
        return mappedError(error);
      }
    },

    async revoke(request: Request, credentialId: string) {
      if (request.method !== "DELETE") {
        return errorResponse(405, "method_not_allowed", "DELETE");
      }
      try {
        requireJsonResponse(request);
        const normalizedCredentialId = requireBrowserCredentialId(credentialId);
        const walletInput = exactWalletQuery(request);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(principal, walletInput);
        const backend = await callBackend(
          request,
          principal,
          walletAddress,
          "DELETE",
          `/v1/wallet-admin/api-keys/${encodeURIComponent(normalizedCredentialId)}`,
          Object.freeze({ schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1 }),
        );
        if (backend.status === 404) {
          return errorResponse(404, "api_key_not_found");
        }
        if (!backend.ok) throw mappedBackendError(backend.status);
        const value = await readBoundedBackendJson(backend);
        const record = jsonRecord(value);
        if (
          record.revoked !== true
          || record.credentialId !== normalizedCredentialId
        ) throw new BackendContractErrorV1();
        return jsonResponse(200, {
          schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
          revoked: true,
          credentialId: normalizedCredentialId,
        });
      } catch (error) {
        return mappedError(error);
      }
    },
  });
}

let productionBridge: DeveloperApiKeyBridgeV1 | null = null;

export function getProductionDeveloperApiKeyBridgeV1() {
  productionBridge ??= createDeveloperApiKeyBridgeV1({
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

function parseCreateBody(value: JsonValue) {
  const record = exactBrowserRecord(value, [
    "schemaVersion",
    "walletAddress",
    "label",
    "expiresInDays",
  ], ["schemaVersion", "walletAddress", "label"]);
  if (record.schemaVersion !== CUSTOM_LAUNCH_API_SCHEMA_V1) {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  if (typeof record.walletAddress !== "string" || record.walletAddress.length !== 42) {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  if (
    typeof record.label !== "string"
    || record.label.length < 1
    || record.label.length > 96
  ) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  const walletAddress = record.walletAddress;
  const label = record.label;
  if (label !== label.trim() || /[\u0000-\u001f\u007f]/u.test(label)) {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  const expiresInDays = record.expiresInDays === undefined
    ? DEFAULT_EXPIRY_DAYS
    : record.expiresInDays;
  if (
    !Number.isInteger(expiresInDays)
    || (expiresInDays as number) < 1
    || (expiresInDays as number) > MAXIMUM_EXPIRY_DAYS
  ) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  return Object.freeze({ walletAddress, label, expiresInDays });
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

async function readBrowserJson(request: Request): Promise<JsonValue> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_BROWSER_BODY_BYTES) {
    throw new BrowserRequestErrorV1(413, "request_too_large");
  }
  const text = await request.text();
  if (!text || Buffer.byteLength(text, "utf8") > MAXIMUM_BROWSER_BODY_BYTES) {
    throw new BrowserRequestErrorV1(413, "request_too_large");
  }
  try {
    return parseStrictJson(text, {
      maximumBytes: MAXIMUM_BROWSER_BODY_BYTES,
      maximumDepth: 8,
    });
  } catch {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
}

async function readBoundedBackendJson(response: Response): Promise<JsonValue> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_BACKEND_BODY_BYTES) {
    throw new BackendContractErrorV1();
  }
  const text = await response.text();
  if (!text || Buffer.byteLength(text, "utf8") > MAXIMUM_BACKEND_BODY_BYTES) {
    throw new BackendContractErrorV1();
  }
  try {
    return parseStrictJson(text, {
      maximumBytes: MAXIMUM_BACKEND_BODY_BYTES,
      maximumDepth: 12,
    });
  } catch {
    throw new BackendContractErrorV1();
  }
}

function parseApiKeyList(value: JsonValue | undefined) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new BackendContractErrorV1();
  }
  return Object.freeze(value.map(parseApiKeySummary));
}

function parseApiKeySummary(value: JsonValue | undefined): DeveloperApiKeySummaryV1 {
  const record = jsonRecord(value);
  const id = requireBackendCredentialId(record.id);
  const label = requiredString(record.label, 1, 96);
  const keyPrefix = requiredString(record.keyPrefix, 30, 30);
  if (!/^pm_live_[A-Za-z0-9_-]{22}$/u.test(keyPrefix)) {
    throw new BackendContractErrorV1();
  }
  if (!Array.isArray(record.scopes) || record.scopes.length !== CURRENT_SCOPES.length) {
    throw new BackendContractErrorV1();
  }
  const scopes = record.scopes.map((scope) => {
    if (!CURRENT_SCOPES.includes(scope as (typeof CURRENT_SCOPES)[number])) {
      throw new BackendContractErrorV1();
    }
    return scope as (typeof CURRENT_SCOPES)[number];
  });
  if (
    new Set(scopes).size !== scopes.length
    || !CURRENT_SCOPES.every((scope) => scopes.includes(scope))
  ) throw new BackendContractErrorV1();
  return Object.freeze({
    id,
    label,
    keyPrefix,
    scopes: Object.freeze(scopes),
    createdAt: requiredTimestamp(record.createdAt),
    expiresAt: optionalTimestamp(record.expiresAt),
    lastUsedAt: optionalTimestamp(record.lastUsedAt),
    revokedAt: optionalTimestamp(record.revokedAt),
  });
}

function exactBrowserRecord(
  value: JsonValue,
  allowed: readonly string[],
  required: readonly string[],
) {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  const record = value;
  const keys = Object.keys(record);
  if (
    keys.some((key) => !allowed.includes(key))
    || required.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
  ) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  return record;
}

function jsonRecord(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    throw new BackendContractErrorV1();
  }
  return value;
}

function requiredString(value: JsonValue | undefined, minimum: number, maximum: number) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw new BackendContractErrorV1();
  }
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

function optionalTimestamp(value: JsonValue | undefined) {
  if (value === null) return null;
  return requiredTimestamp(value);
}

function requireBrowserCredentialId(value: JsonValue | undefined) {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) throw new BrowserRequestErrorV1(400, "credential_id_invalid");
  return value.toLowerCase();
}

function requireBackendCredentialId(value: JsonValue | undefined) {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) throw new BackendContractErrorV1();
  return value.toLowerCase();
}

function requireJsonRequest(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new BrowserRequestErrorV1(415, "json_body_required");
  }
  requireJsonResponse(request);
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

function mappedBackendError(status: number) {
  if (status === 404) return new BrowserRequestErrorV1(404, "api_key_not_found");
  return new BackendContractErrorV1();
}

function mappedError(error: unknown) {
  if (error instanceof WalletPrincipalAuthenticationErrorV1) {
    return errorResponse(error.status, error.code);
  }
  if (error instanceof BrowserRequestErrorV1) {
    return errorResponse(error.status, error.code);
  }
  console.error("Developer API key request failed", {
    name: error instanceof Error ? error.name : "DeveloperApiKeyError",
  });
  return errorResponse(503, "api_key_service_unavailable");
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
    schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
    error: Object.freeze({
      code,
      message: status >= 500
        ? "The API key service is temporarily unavailable."
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
    super("api_key_backend_contract_invalid");
    this.name = "BackendContractErrorV1";
  }
}
