import "server-only";

import { getAddress, isAddress } from "viem";

import { parseStrictJson, type JsonValue } from
  "../projection-target/canonical-json";

export const SOURCE_VERIFICATION_DISPLAY_SCHEMA_V1 =
  "programmable.source-verification-display.v1" as const;

export type SourceVerificationDisplayV1 = Readonly<{
  schemaVersion: typeof SOURCE_VERIFICATION_DISPLAY_SCHEMA_V1;
  status: "verified" | "in-progress" | "not-verified";
  label: "Source verified" | "Verification in progress" | "Source not verified";
  updatedAt: string | null;
}>;

const BACKEND_SCHEMA = "programmable.source-verification-status.v1";
const MAXIMUM_RESPONSE_BYTES = 32_768;
const DEFAULT_TIMEOUT_MS = 1_500;
const STATES = new Set([
  "queued",
  "retrying",
  "exact_match",
  "needs_attention",
]);

const NOT_VERIFIED = Object.freeze({
  schemaVersion: SOURCE_VERIFICATION_DISPLAY_SCHEMA_V1,
  status: "not-verified" as const,
  label: "Source not verified" as const,
  updatedAt: null,
});

export async function readSourceVerificationDisplayV1(input: Readonly<{
  address: string;
  backendBaseUrl: string;
  websiteToken: string;
  fetchBackend: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}>): Promise<SourceVerificationDisplayV1> {
  if (!isAddress(input.address)) {
    throw new TypeError("Source verification address is invalid");
  }
  const baseUrl = normalizedBackendBaseUrl(input.backendBaseUrl);
  const websiteToken = boundedWebsiteToken(input.websiteToken);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 5_000) {
    throw new TypeError("Source verification timeout is invalid");
  }
  const url = new URL(
    `/v1/website/source-verifications/${getAddress(input.address)}`,
    baseUrl,
  );
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (input.signal) signals.push(input.signal);
  const response = await input.fetchBackend(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${websiteToken}`,
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.any(signals),
  });
  if (response.status === 404) return NOT_VERIFIED;
  if (!response.ok) {
    throw new Error("Source verification backend is unavailable");
  }
  const value = await readBoundedJson(response);
  const record = jsonRecord(value);
  if (
    record.schemaVersion !== BACKEND_SCHEMA
    || typeof record.status !== "string"
    || !STATES.has(record.status)
    || !Array.isArray(record.components)
    || record.components.length < 1
    || record.components.length > 16
    || typeof record.updatedAt !== "string"
    || !Number.isFinite(Date.parse(record.updatedAt))
  ) throw new Error("Source verification backend contract is invalid");
  const componentStates = record.components.map((component) => {
    const candidate = jsonRecord(component);
    if (
      typeof candidate.status !== "string"
      || !STATES.has(candidate.status)
      || typeof candidate.address !== "string"
      || !isAddress(candidate.address)
    ) throw new Error("Source verification backend contract is invalid");
    return candidate.status;
  });
  const updatedAt = new Date(record.updatedAt).toISOString();
  if (record.status === "exact_match") {
    if (componentStates.some((status) => status !== "exact_match")) {
      throw new Error("Source verification backend contract is inconsistent");
    }
    return Object.freeze({
      schemaVersion: SOURCE_VERIFICATION_DISPLAY_SCHEMA_V1,
      status: "verified" as const,
      label: "Source verified" as const,
      updatedAt,
    });
  }
  if (record.status === "queued" || record.status === "retrying") {
    return Object.freeze({
      schemaVersion: SOURCE_VERIFICATION_DISPLAY_SCHEMA_V1,
      status: "in-progress" as const,
      label: "Verification in progress" as const,
      updatedAt,
    });
  }
  return Object.freeze({ ...NOT_VERIFIED, updatedAt });
}

export async function readProductionSourceVerificationDisplayV1(
  address: string,
  signal?: AbortSignal,
): Promise<SourceVerificationDisplayV1> {
  try {
    return await readSourceVerificationDisplayV1({
      address,
      backendBaseUrl: requiredEnvironment(
        "PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL",
      ),
      websiteToken: requiredEnvironment(
        "PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN",
      ),
      fetchBackend: fetch,
      signal,
    });
  } catch (error) {
    console.error("Exact source verification display unavailable", {
      name: error instanceof Error ? error.name : "SourceVerificationReadError",
    });
    return NOT_VERIFIED;
  }
}

async function readBoundedJson(response: Response): Promise<JsonValue> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_RESPONSE_BYTES) {
    throw new Error("Source verification response is too large");
  }
  const text = await response.text();
  if (!text || Buffer.byteLength(text, "utf8") > MAXIMUM_RESPONSE_BYTES) {
    throw new Error("Source verification response is invalid");
  }
  return parseStrictJson(text, {
    maximumBytes: MAXIMUM_RESPONSE_BYTES,
    maximumDepth: 8,
  });
}

function jsonRecord(value: JsonValue | undefined) {
  if (
    value === null
    || value === undefined
    || Array.isArray(value)
    || typeof value !== "object"
  ) throw new Error("Source verification response is invalid");
  return value;
}

function normalizedBackendBaseUrl(value: string) {
  const url = new URL(value);
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
