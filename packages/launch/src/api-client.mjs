import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  API_ORIGIN,
  CAPABILITIES_PATH_V3,
  CREATE_PATH_V1,
  CREATE_PATH_V2,
  CREATE_PATH_V3,
  CREATE_REQUEST_SCHEMA_V1,
  CREATE_REQUEST_SCHEMA_V2,
  CREATE_REQUEST_SCHEMA_V3,
  PREFLIGHT_PATH_V3,
  PREFLIGHT_SCHEMA_V1,
  TERMINAL_STATUSES,
  WALLET_HANDOFF_BASE_URL,
  WALLET_HANDOFF_STATUS,
} from "./constants.mjs";
import {
  atomicCreate,
  atomicWrite,
  defaultStateDirectory,
  loadApiKey,
  readStrictJsonFile,
  sha256Digest,
  sha256Hex,
} from "./io.mjs";
import { canonicalizeJson } from "./canonical-json.mjs";
import { validateLaunchFile } from "./validate.mjs";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_API_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_SUBMISSION_JOURNAL_BYTES = 12_582_912;
const PREFLIGHT_DISPOSITIONS = new Set([
  "supported",
  "supported_with_warnings",
  "needs_evidence",
  "unsupported",
]);
const REMEDIATION_SCHEMA_V1 = "programmable.custom-launch-remediation.v1";

export class ProgrammableApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ProgrammableApiError";
    this.details = details;
  }
}

export async function getLaunchCapabilities(options = {}) {
  const apiOrigin = normalizeApiOrigin(options.apiOrigin ?? API_ORIGIN);
  const result = await requestWithRetry({
    method: "GET",
    url: `${apiOrigin}${CAPABILITIES_PATH_V3}`,
    headers: { accept: "application/json" },
    maxAttempts: options.maxAttempts,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
  });
  assertResponseObject(result.body, "capabilities");
  return {
    httpStatus: result.status,
    retryAfter: result.retryAfter,
    resource: result.body,
  };
}

export async function validateLaunchRemote(options) {
  const launchPath = path.resolve(options.launchPath);
  const validation = await (options.validateLaunchFileImpl ?? validateLaunchFile)({
    launchPath,
    configPath: options.configPath,
  });
  const requestBytes = Buffer.from(await (options.readLaunchBytesImpl ?? readFile)(launchPath));
  const requestHash = sha256Digest(requestBytes);
  if (requestHash !== validation.requestSha256) {
    throw new TypeError(
      "REMOTE_VALIDATION_BYTES_CHANGED: launch.json changed after exact local validation",
    );
  }
  if (validation.schemaVersion !== CREATE_REQUEST_SCHEMA_V3) {
    throw new TypeError("remote preflight is available only for V3 Custom launch requests");
  }

  const apiOrigin = normalizeApiOrigin(options.apiOrigin ?? API_ORIGIN);
  const capabilities = await getLaunchCapabilities({
    apiOrigin,
    maxAttempts: options.maxAttempts,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
  });
  const apiKey = await (options.loadApiKeyImpl ?? loadApiKey)();
  const result = await requestWithRetry({
    method: "POST",
    url: `${apiOrigin}${PREFLIGHT_PATH_V3}`,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: requestBytes,
    maxAttempts: options.maxAttempts,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
  });
  assertPreflightResponse(result.body, requestHash);
  const action = resourceActionSummary(result.body, {
    apiOrigin,
    walletHandoffBaseUrl: capabilities.resource.walletHandoffBaseUrl,
  });
  return {
    ...validation,
    remoteValidation: true,
    capabilitiesHttpStatus: capabilities.httpStatus,
    preflightHttpStatus: result.status,
    capabilities: capabilities.resource,
    preflight: result.body,
    disposition: result.body.disposition,
    launchEligibility: result.body.launchEligibility,
    evidenceTier: result.body.evidenceTier,
    hardBlockFindingCodes: result.body.hardBlockFindingCodes,
    needsEvidenceFindingCodes: result.body.needsEvidenceFindingCodes,
    warningFindingCodes: result.body.warningFindingCodes,
    remediations: result.body.remediations,
    ...action,
  };
}

export async function submitLaunch(options) {
  const launchPath = path.resolve(options.launchPath);
  if (typeof options.configPath !== "string" || options.configPath.length === 0) {
    throw new TypeError("submit requires --config so exact source and build artifacts are freshly repacked");
  }
  const validation = await (options.validateLaunchFileImpl ?? validateLaunchFile)({
    launchPath,
    configPath: options.configPath,
  });
  const requestPath = createPathForRequestSchema(validation.schemaVersion);
  const requestBytes = Buffer.from(await (options.readLaunchBytesImpl ?? readFile)(launchPath));
  const requestSha256 = sha256Digest(requestBytes);
  if (requestSha256 !== validation.requestSha256) {
    throw new TypeError(
      "SUBMISSION_BYTES_CHANGED_AFTER_VALIDATION: launch.json changed after exact config validation",
    );
  }
  const idempotencyKey = normalizeIdempotencyKey(
    options.idempotencyKey ?? `programmable-${sha256Hex(requestBytes)}`,
  );
  const apiOrigin = normalizeApiOrigin(options.apiOrigin ?? API_ORIGIN);
  const stateDirectory = path.resolve(options.stateDirectory ?? defaultStateDirectory());
  const journalPath = path.join(
    stateDirectory,
    "submissions",
    `${sha256Hex(Buffer.from(idempotencyKey, "utf8"))}.json`,
  );
  const binding = {
    schemaVersion: "programmable.launch-submit-journal.v1",
    apiOrigin,
    requestPath,
    idempotencyKey,
    requestSha256,
    requestBodyBase64: requestBytes.toString("base64"),
    lastResponse: null,
  };
  const journal = await bindJournal(journalPath, binding);
  const apiKey = await (options.loadApiKeyImpl ?? loadApiKey)();
  const result = await requestWithRetry({
    method: "POST",
    url: `${apiOrigin}${requestPath}`,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: Buffer.from(journal.requestBodyBase64, "base64"),
    maxAttempts: options.maxAttempts,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
  });
  await updateJournal(journalPath, journal, result);
  const action = resourceActionSummary(result.body, { apiOrigin });
  return {
    idempotencyKey,
    requestSha256,
    journalPath,
    httpStatus: result.status,
    retryAfter: result.retryAfter,
    resource: result.body,
    ...action,
  };
}

export async function statusLaunch(options) {
  if (typeof options.requestId !== "string" || !REQUEST_ID.test(options.requestId)) {
    throw new TypeError("status requires the Custom launch request UUID");
  }
  const apiOrigin = normalizeApiOrigin(options.apiOrigin ?? API_ORIGIN);
  const requestPath = createPathForApiVersion(options.apiVersion ?? 3);
  const apiKey = await (options.loadApiKeyImpl ?? loadApiKey)();
  const until = options.until ?? WALLET_HANDOFF_STATUS;
  if (until !== WALLET_HANDOFF_STATUS && until !== "finalized") {
    throw new TypeError("--until must be authorized or finalized");
  }
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 250) {
    throw new TypeError("poll interval must be at least 250 milliseconds");
  }
  while (true) {
    const result = await requestWithRetry({
      method: "GET",
      url: `${apiOrigin}${requestPath}/${encodeURIComponent(options.requestId)}`,
      headers: { authorization: `Bearer ${apiKey}` },
      maxAttempts: options.maxAttempts,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
    });
    const resource = result.body;
    const status = resource?.status;
    if (typeof status !== "string") {
      throw new ProgrammableApiError("Custom Launch API returned a resource without status", {
        httpStatus: result.status,
        requestId: errorRequestId(resource),
      });
    }
    const walletHandoffReady = status === WALLET_HANDOFF_STATUS
      || (requestPath === CREATE_PATH_V3 && status === "awaiting_funding_authorization");
    const reviewPending = requestPath === CREATE_PATH_V3 && status === "pending_review";
    const reviewActionRequired = requestPath === CREATE_PATH_V3 && status === "action_required";
    const stopped = TERMINAL_STATUSES.has(status)
      || reviewActionRequired
      || (until === WALLET_HANDOFF_STATUS && walletHandoffReady)
      || (until === "finalized" && status === "finalized");
    if (!options.watch || stopped) {
      const action = resourceActionSummary(resource, { apiOrigin });
      return {
        httpStatus: result.status,
        stopped,
        terminal: TERMINAL_STATUSES.has(status),
        reviewPending,
        reviewActionRequired,
        walletHandoffReady,
        walletHandoffStage: status === "awaiting_funding_authorization"
          ? "funding-signature-required"
          : status === WALLET_HANDOFF_STATUS
            ? "router-transaction-required"
            : null,
        resource,
        ...action,
      };
    }
    await (options.sleepImpl ?? sleep)(pollIntervalMs);
  }
}

async function bindJournal(journalPath, binding) {
  try {
    await atomicCreate(
      journalPath,
      Buffer.from(`${canonicalizeJson(binding)}\n`, "utf8"),
      0o600,
    );
    return binding;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const existing = (await readStrictJsonFile(
    journalPath,
    MAX_SUBMISSION_JOURNAL_BYTES,
  )).value;
  for (const key of [
    "schemaVersion",
    "apiOrigin",
    "requestPath",
    "idempotencyKey",
    "requestSha256",
    "requestBodyBase64",
  ]) {
    if (existing[key] !== binding[key]) {
      throw new TypeError(
        `IDEMPOTENCY_BINDING_CONFLICT: ${binding.idempotencyKey} is already bound to different request bytes or origin`,
      );
    }
  }
  return existing;
}

async function updateJournal(journalPath, journal, result) {
  const publicResponse = {
    httpStatus: result.status,
    retryAfter: result.retryAfter,
    requestId: result.body?.requestId ?? result.body?.launchId ?? errorRequestId(result.body),
    status: result.body?.status ?? null,
  };
  await atomicWrite(
    journalPath,
    Buffer.from(`${canonicalizeJson({ ...journal, lastResponse: publicResponse })}\n`, "utf8"),
    0o600,
  );
}

async function requestWithRetry(options) {
  const maxAttempts = options.maxAttempts ?? 5;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new TypeError("maxAttempts must be between 1 and 20");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 300_000) {
    throw new TypeError("timeoutMs must be between 250 and 300000 milliseconds");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? sleep;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("request timed out")), timeoutMs);
    let response;
    let retryAfter = null;
    let responseBytes;
    try {
      response = await fetchImpl(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        redirect: "error",
        signal: controller.signal,
      });
      retryAfter = response.headers.get("retry-after");
      responseBytes = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      await sleepImpl(retryDelayMs(retryAfter, attempt));
      continue;
    } finally {
      clearTimeout(timeout);
    }
    let body;
    try {
      body = parseResponseBody(responseBytes, response.status);
    } catch (error) {
      if (response.status !== 429 && response.status !== 503) throw error;
      body = null;
    }
    if (response.status === 429 || response.status === 503) {
      if (attempt === maxAttempts) {
        throw apiError(response.status, body, retryAfter, options.url);
      }
      await sleepImpl(retryDelayMs(retryAfter, attempt));
      continue;
    }
    if (!response.ok) throw apiError(response.status, body, retryAfter, options.url);
    return { status: response.status, retryAfter, body };
  }
  throw new ProgrammableApiError("Custom Launch API request remained ambiguous after identical retries", {
    code: "AMBIGUOUS_TRANSPORT_RESULT",
    cause: lastError instanceof Error ? lastError.message : String(lastError),
  });
}

function parseResponseBody(bytes, status) {
  if (bytes.byteLength === 0) return null;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ProgrammableApiError("Custom Launch API returned invalid JSON", { httpStatus: status });
  }
}

function apiError(status, body, retryAfter, requestUrl) {
  const error = body?.error ?? body;
  const serverDetails = isJsonValue(error?.details) ? error.details : undefined;
  const remediations = typedRemediations(
    error?.remediations
      ?? (isPlainObject(serverDetails) ? serverDetails.remediations : undefined)
      ?? body?.remediations,
  );
  const apiOrigin = safeRequestOrigin(requestUrl);
  const action = resourceActionSummary(error, { apiOrigin });
  return new ProgrammableApiError(
    `Custom Launch API returned HTTP ${status}`,
    {
      httpStatus: status,
      code: safeApiCode(error?.code),
      requestId: safeErrorRequestId(error?.requestId),
      retryAfter: safeRetryAfter(retryAfter),
      ...(serverDetails === undefined ? {} : { serverDetails }),
      ...(remediations === null ? {} : { remediations }),
      ...action,
    },
  );
}

function assertPreflightResponse(value, requestHash) {
  assertResponseObject(value, "preflight");
  assertPreflightField(value.schemaVersion === PREFLIGHT_SCHEMA_V1, "schemaVersion");
  assertPreflightField(value.requestHash === requestHash, "requestHash");
  assertPreflightField(
    Number.isSafeInteger(value.profileRevision) && value.profileRevision > 0,
    "profileRevision",
  );
  assertPreflightField(
    typeof value.serverTime === "string" && Number.isFinite(Date.parse(value.serverTime)),
    "serverTime",
  );
  assertPreflightField(PREFLIGHT_DISPOSITIONS.has(value.disposition), "disposition");
  assertPreflightField(isPlainObject(value.launchEligibility), "launchEligibility");
  for (const field of ["deployable", "routable", "featured"]) {
    assertPreflightField(typeof value.launchEligibility[field] === "boolean", `launchEligibility.${field}`);
  }
  assertPreflightField(
    typeof value.evidenceTier === "string" && value.evidenceTier.length > 0,
    "evidenceTier",
  );
  for (const field of [
    "hardBlockFindingCodes",
    "needsEvidenceFindingCodes",
    "warningFindingCodes",
  ]) {
    assertPreflightField(isCodeArray(value[field]), field);
  }
  assertPreflightField(
    value.staticBaseline === null || isPlainObject(value.staticBaseline),
    "staticBaseline",
  );
  assertPreflightField(typedRemediations(value.remediations) !== null, "remediations");
  for (const [field, expected] of [
    ["quotaConsumed", false],
    ["nonceAllocated", false],
    ["persisted", false],
    ["walletSignatureRequiredLater", true],
    ["walletBroadcastByService", false],
  ]) {
    assertPreflightField(value[field] === expected, field);
  }
}

function assertPreflightField(condition, field) {
  if (condition) return;
  throw new ProgrammableApiError(
    `Custom Launch API returned an invalid ${PREFLIGHT_SCHEMA_V1} response`,
    {
      code: "PREFLIGHT_CONTRACT_INVALID",
      serverDetails: { field },
    },
  );
}

function assertResponseObject(value, label) {
  if (!isPlainObject(value)) {
    throw new ProgrammableApiError(`Custom Launch API returned invalid ${label} JSON`, {
      code: `${label.toUpperCase()}_CONTRACT_INVALID`,
    });
  }
}

function typedRemediations(value) {
  if (!Array.isArray(value)) return null;
  return value.every(isTypedRemediation) ? value : null;
}

function isTypedRemediation(value) {
  if (!isPlainObject(value)
    || value.schemaVersion !== REMEDIATION_SCHEMA_V1
    || !nonemptyString(value.remediationId)
    || !nonemptyString(value.code)
    || !nonemptyString(value.stage)
    || !nonemptyString(value.requiredChange)
    || !nonemptyString(value.catalogUrl)
    || !nonemptyString(value.guideUrl)
    || !nonemptyString(value.resumeAt)
    || typeof value.retryable !== "boolean"
    || typeof value.requiresNewRequest !== "boolean") {
    return false;
  }
  for (const field of ["targetId", "targetRole", "sourcePath"]) {
    if (value[field] !== null && !nonemptyString(value[field])) return false;
  }
  return Object.hasOwn(value, "expected") && Object.hasOwn(value, "observed");
}

function resourceActionSummary(resource, { apiOrigin, walletHandoffBaseUrl } = {}) {
  if (!isPlainObject(resource)) return {};
  const output = isPlainObject(resource.output) ? resource.output : null;
  const outputAction = isPlainObject(output?.actionRequired) ? output.actionRequired : null;
  const resourceAction = isPlainObject(resource.actionRequired) ? resource.actionRequired : null;
  const summary = {};
  if (Object.hasOwn(resource, "actionRequired")) {
    summary.actionRequired = resource.actionRequired;
  } else if (output !== null && Object.hasOwn(output, "actionRequired")) {
    summary.actionRequired = output.actionRequired;
  }

  const handoffUrl = firstDefined(
    resource.walletHandoffUrl,
    output?.walletHandoffUrl,
    resourceAction?.walletHandoffUrl,
    outputAction?.walletHandoffUrl,
  );
  const safeHandoffUrl = safeWalletHandoffUrl(
    handoffUrl,
    apiOrigin,
    walletHandoffBaseUrl,
  );
  if (safeHandoffUrl !== null) summary.walletHandoffUrl = safeHandoffUrl;

  const expiresAt = safeExpiresAt(firstDefined(
    resource.expiresAt,
    output?.expiresAt,
    resourceAction?.expiresAt,
    outputAction?.expiresAt,
  ));
  if (expiresAt !== null) summary.expiresAt = expiresAt;

  const secondsRemaining = firstDefined(
    resource.secondsRemaining,
    output?.secondsRemaining,
    resourceAction?.secondsRemaining,
    outputAction?.secondsRemaining,
  );
  if (Number.isSafeInteger(secondsRemaining) && secondsRemaining >= 0) {
    summary.secondsRemaining = secondsRemaining;
  }

  const remediations = typedRemediations(firstDefined(
    resource.remediations,
    output?.remediations,
    resourceAction?.remediations,
    outputAction?.remediations,
  ));
  if (remediations !== null) summary.remediations = remediations;
  return summary;
}

function safeWalletHandoffUrl(value, apiOrigin, advertisedBaseUrl) {
  if (typeof value !== "string") return null;
  let candidate;
  try {
    candidate = new URL(value);
  } catch {
    return null;
  }
  if (candidate.username || candidate.password) return null;
  const bases = [
    safeWalletHandoffBase(advertisedBaseUrl, apiOrigin, true),
    safeWalletHandoffBase(WALLET_HANDOFF_BASE_URL, apiOrigin, false),
  ].filter((entry) => entry !== null);
  if (isLoopbackOrigin(apiOrigin)) {
    bases.push(`${apiOrigin}/`);
  }
  return bases.some((base) => candidate.href.startsWith(base)) ? candidate.href : null;
}

function safeWalletHandoffBase(value, apiOrigin, allowAdvertisedHttps) {
  if (typeof value !== "string") return null;
  let base;
  try {
    base = new URL(value);
  } catch {
    return null;
  }
  if (base.username || base.password || base.search || base.hash) return null;
  const productionBase = base.protocol === "https:"
    && (allowAdvertisedHttps || base.origin === new URL(WALLET_HANDOFF_BASE_URL).origin);
  const loopbackBase = isLoopbackOrigin(apiOrigin) && base.origin === apiOrigin;
  return productionBase || loopbackBase
    ? `${base.origin}${base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`}`
    : null;
}

function isLoopbackOrigin(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

function safeExpiresAt(value) {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function safeRequestOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function isCodeArray(value) {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === "string" && SAFE_API_CODE.test(entry));
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value, depth = 0) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (depth >= 32) return false;
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1));
  return isPlainObject(value)
    && Object.values(value).every((entry) => isJsonValue(entry, depth + 1));
}

function nonemptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function safeApiCode(value) {
  return typeof value === "string" && SAFE_API_CODE.test(value) ? value : null;
}

function safeErrorRequestId(value) {
  return typeof value === "string" && REQUEST_ID.test(value) ? value : null;
}

function safeRetryAfter(value) {
  if (typeof value !== "string") return null;
  if (/^[0-9]{1,10}$/.test(value)) return value;
  const when = Date.parse(value);
  return Number.isFinite(when) ? new Date(when).toUTCString() : null;
}

function retryDelayMs(retryAfter, attempt) {
  if (retryAfter !== null && retryAfter !== undefined) {
    if (/^[0-9]+$/.test(retryAfter)) return Math.min(Number(retryAfter) * 1_000, 3_600_000);
    const when = Date.parse(retryAfter);
    if (Number.isFinite(when)) return Math.min(Math.max(0, when - Date.now()), 3_600_000);
  }
  return Math.min(1_000 * 2 ** (attempt - 1), 30_000);
}

function normalizeIdempotencyKey(value) {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY.test(value)) {
    throw new TypeError("Idempotency-Key must be 16 to 128 characters from [A-Za-z0-9._:-]");
  }
  return value;
}

function normalizeApiOrigin(value) {
  const url = new URL(value);
  const isProduction = url.origin === API_ORIGIN;
  const isLoopback = (url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost")
    && (url.protocol === "http:" || url.protocol === "https:");
  if ((!isProduction && !isLoopback) || url.pathname !== "/" || url.search || url.hash
    || url.username || url.password) {
    throw new TypeError("API origin must be https://api.programmable.market or an explicit loopback test origin");
  }
  return url.origin;
}

function createPathForRequestSchema(schemaVersion) {
  if (schemaVersion === CREATE_REQUEST_SCHEMA_V1) return CREATE_PATH_V1;
  if (schemaVersion === CREATE_REQUEST_SCHEMA_V2) return CREATE_PATH_V2;
  if (schemaVersion === CREATE_REQUEST_SCHEMA_V3) return CREATE_PATH_V3;
  throw new TypeError("launch request schema does not map to a Custom Launch API route");
}

function createPathForApiVersion(value) {
  if (value === 1 || value === "1" || value === "v1") return CREATE_PATH_V1;
  if (value === 2 || value === "2" || value === "v2") return CREATE_PATH_V2;
  if (value === 3 || value === "3" || value === "v3") return CREATE_PATH_V3;
  throw new TypeError("apiVersion must be 1, 2, or 3");
}

function errorRequestId(body) {
  return typeof body?.error?.requestId === "string" ? body.error.requestId : null;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
