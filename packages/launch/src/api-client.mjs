import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  API_ORIGIN,
  CAPABILITIES_PATH_V3,
  CREATE_PATH_V1,
  CREATE_PATH_V2,
  CREATE_PATH_V3,
  CREATE_REQUEST_SCHEMA_V3,
  DIRECT_NATIVE_PROFILE_ID,
  DIRECT_NATIVE_PROFILE_REVISION,
  DIRECT_NATIVE_PROFILE_VERSION,
  MAX_REQUEST_BYTES,
  PERMIT_REISSUE_CAPABILITY_SCHEMA_V1,
  PERMIT_REISSUE_DISPOSITION_SCHEMA_V1,
  PERMIT_REISSUE_PATH_TEMPLATE_V3,
  PERMIT_REISSUE_REQUEST_SCHEMA_V1,
  PREFLIGHT_PATH_V3,
  PREFLIGHT_SCHEMA_V1,
  TERMINAL_STATUSES,
  WALLET_HANDOFF_BASE_URL,
  WALLET_HANDOFF_STATUS,
} from "./constants.mjs";
import {
  atomicCreate,
  atomicWrite,
  decodeExactUtf8,
  defaultStateDirectory,
  loadApiKey,
  readStrictJsonFile,
  sha256Digest,
  sha256Hex,
} from "./io.mjs";
import { canonicalizeJson, parseStrictJson } from "./canonical-json.mjs";
import { validateDirectNativePermitWindow } from "./profile-direct-native-v1.mjs";
import { validateLaunchFile } from "./validate.mjs";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_API_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const NONZERO_HEX32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
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
  const apiOrigin = productionApiOrigin(options.apiOrigin);
  const result = await requestWithRetry({
    method: "GET",
    url: `${apiOrigin}${CAPABILITIES_PATH_V3}`,
    headers: { accept: "application/json" },
    maxAttempts: options.maxAttempts,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
  });
  assertCapabilitiesResponse(result.body);
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
  const requestSha256 = sha256Digest(requestBytes);
  if (requestSha256 !== validation.requestSha256) {
    throw new TypeError(
      "REMOTE_VALIDATION_BYTES_CHANGED: launch.json changed after exact local validation",
    );
  }
  if (validation.schemaVersion !== CREATE_REQUEST_SCHEMA_V3) {
    throw new TypeError("remote preflight is available only for V3 Custom launch requests");
  }
  const serverRequestHash = customLaunchRequestHashV3(requestBytes);

  const apiOrigin = productionApiOrigin(options.apiOrigin);
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
  assertPreflightResponse(result.body, serverRequestHash);
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

function customLaunchRequestHashV3(requestBytes) {
  const source = decodeExactUtf8(requestBytes, "V3 launch request");
  const request = parseStrictJson(source, { maximumBytes: MAX_REQUEST_BYTES });
  if (!isPlainObject(request) || request.schemaVersion !== CREATE_REQUEST_SCHEMA_V3) {
    throw new TypeError(`request schemaVersion must be ${CREATE_REQUEST_SCHEMA_V3}`);
  }
  return sha256Digest(Buffer.concat([
    Buffer.from(request.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(request), "utf8"),
  ]));
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
  if (validation.schemaVersion !== CREATE_REQUEST_SCHEMA_V3) {
    throw new TypeError(
      `LEGACY_SUBMISSION_READ_ONLY: V1 and V2 launch creation are read-only; submit a ${CREATE_REQUEST_SCHEMA_V3} request built for profile version ${DIRECT_NATIVE_PROFILE_VERSION}`,
    );
  }
  const requestPath = CREATE_PATH_V3;
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
  const apiOrigin = productionApiOrigin(options.apiOrigin);
  const capabilities = validation.schemaVersion === CREATE_REQUEST_SCHEMA_V3
    ? await getLaunchCapabilities({
      apiOrigin,
      maxAttempts: options.maxAttempts,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
    })
    : null;
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
  const action = resourceActionSummary(result.body, {
    walletHandoffBaseUrl: capabilities?.resource.walletHandoffBaseUrl,
  });
  return {
    idempotencyKey,
    requestSha256,
    journalPath,
    ...(Array.isArray(validation.diagnostics) && validation.diagnostics.length !== 0
      ? { diagnostics: validation.diagnostics }
      : {}),
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
  const apiOrigin = productionApiOrigin(options.apiOrigin);
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
      const action = resourceActionSummary(resource);
      const permitRecovery = permitRecoverySummary(resource);
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
        ...(permitRecovery === null ? {} : { permitRecovery }),
        ...action,
      };
    }
    await (options.sleepImpl ?? sleep)(pollIntervalMs);
  }
}

/**
 * Requests the deployed-contract permit-reissue disposition. Router V1 has no
 * successful reissue path, so a conforming current server answers with a typed
 * 409 that remains available on ProgrammableApiError.details.serverDetails.
 */
export async function requestPermitReissueDisposition(options) {
  if (typeof options?.launchId !== "string" || !REQUEST_ID.test(options.launchId)) {
    throw new TypeError("permit reissue disposition requires the Custom launch UUID");
  }
  if (typeof options.expectedRequestHash !== "string"
    || !SHA256.test(options.expectedRequestHash)) {
    throw new TypeError("expectedRequestHash must be a lowercase sha256 digest");
  }
  if (typeof options.expectedLaunchIntentHash !== "string"
    || !SHA256.test(options.expectedLaunchIntentHash)) {
    throw new TypeError("expectedLaunchIntentHash must be a lowercase sha256 digest");
  }
  if (typeof options.replacementNonce !== "string"
    || !NONZERO_HEX32.test(options.replacementNonce)) {
    throw new TypeError("replacementNonce must be a nonzero lowercase 0x-prefixed 32-byte value");
  }
  const replacementPermitWindow = validateDirectNativePermitWindow(
    options.replacementPermitWindow,
  );
  const idempotencyKey = normalizeIdempotencyKey(options.idempotencyKey);
  const request = {
    schemaVersion: PERMIT_REISSUE_REQUEST_SCHEMA_V1,
    expectedRequestHash: options.expectedRequestHash,
    expectedLaunchIntentHash: options.expectedLaunchIntentHash,
    replacementNonce: options.replacementNonce,
    replacementPermitWindow,
  };
  const apiOrigin = productionApiOrigin(options.apiOrigin);
  const apiKey = await (options.loadApiKeyImpl ?? loadApiKey)();
  const requestPath = PERMIT_REISSUE_PATH_TEMPLATE_V3.replace(
    "{launchId}",
    encodeURIComponent(options.launchId),
  );
  try {
    const result = await requestWithRetry({
      method: "POST",
      url: `${apiOrigin}${requestPath}`,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: Buffer.from(canonicalizeJson(request), "utf8"),
      maxAttempts: options.maxAttempts,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
    });
    throw new ProgrammableApiError(
      "Custom Launch API returned a success response for an unsupported Router V1 permit reissue",
      {
        code: "PERMIT_REISSUE_CONTRACT_INVALID",
        httpStatus: result.status,
        serverDetails: { expectedHttpStatus: 409 },
      },
    );
  } catch (error) {
    if (!(error instanceof ProgrammableApiError) || error.details?.httpStatus !== 409) throw error;
    const allowedCodes = new Set([
      "PERMIT_REISSUE_UNSUPPORTED",
      "PERMIT_REISSUE_NOT_APPLICABLE",
      "PERMIT_REISSUE_RESOURCE_BINDING_MISMATCH",
    ]);
    if (!allowedCodes.has(error.details.code)
      || error.details.serverDetails?.schemaVersion
        !== PERMIT_REISSUE_DISPOSITION_SCHEMA_V1) {
      throw new ProgrammableApiError(
        "Custom Launch API returned an invalid permit-reissue disposition",
        {
          code: "PERMIT_REISSUE_CONTRACT_INVALID",
          httpStatus: 409,
          serverDetails: { observedCode: error.details.code ?? null },
        },
      );
    }
    throw error;
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
        throw apiError(response.status, body, retryAfter);
      }
      await sleepImpl(retryDelayMs(retryAfter, attempt));
      continue;
    }
    if (!response.ok) throw apiError(response.status, body, retryAfter);
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

function apiError(status, body, retryAfter) {
  const error = body?.error ?? body;
  const serverDetails = isJsonValue(error?.details) ? error.details : undefined;
  const remediations = typedRemediations(
    error?.remediations
      ?? (isPlainObject(serverDetails) ? serverDetails.remediations : undefined)
      ?? body?.remediations,
  );
  const action = resourceActionSummary(error);
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
    value.profileRevision === DIRECT_NATIVE_PROFILE_REVISION,
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

function assertCapabilitiesResponse(value) {
  assertCapabilitiesField(isPlainObject(value), "$", value);
  assertCapabilitiesField(
    value.schemaVersion === "programmable.custom-launch-capabilities.v1",
    "schemaVersion",
  );
  assertCapabilitiesField(value.apiVersion === "v3", "apiVersion");
  assertCapabilitiesField(
    typeof value.serverTime === "string" && Number.isFinite(Date.parse(value.serverTime)),
    "serverTime",
  );
  assertCapabilitiesField(value.readinessUrl === `${API_ORIGIN}/readyz`, "readinessUrl");
  assertCapabilitiesField(isPlainObject(value.chain), "chain");
  assertCapabilitiesField(value.chain?.id === "1", "chain.id");
  assertCapabilitiesField(value.chain?.name === "Ethereum Mainnet", "chain.name");
  assertCapabilitiesField(isPlainObject(value.profile), "profile");
  assertCapabilitiesField(value.profile?.profileId === DIRECT_NATIVE_PROFILE_ID, "profile.profileId");
  assertCapabilitiesField(
    value.profile?.profileRevision === DIRECT_NATIVE_PROFILE_REVISION,
    "profile.profileRevision",
  );
  assertCapabilitiesField(
    value.profile?.profileVersion === DIRECT_NATIVE_PROFILE_VERSION,
    "profile.profileVersion",
  );
  assertCapabilitiesField(
    value.profile?.productionLaunchAuthorized === true,
    "profile.productionLaunchAuthorized",
  );
  assertCapabilitiesField(isPlainObject(value.routes), "routes");
  for (const [field, expected] of Object.entries({
    create: CREATE_PATH_V3,
    preflight: PREFLIGHT_PATH_V3,
    status: `${CREATE_PATH_V3}/{launchId}`,
    list: CREATE_PATH_V3,
    finalizedMetadata: "/v3/finalized-custom-launches",
    capabilities: CAPABILITIES_PATH_V3,
    permitReissue: PERMIT_REISSUE_PATH_TEMPLATE_V3,
  })) {
    assertCapabilitiesField(value.routes?.[field] === expected, `routes.${field}`);
  }
  assertCapabilitiesField(isPlainObject(value.authentication), "authentication");
  for (const [field, expected] of Object.entries({
    create: "bearer-api-key",
    preflight: "bearer-api-key",
    status: "bearer-api-key",
    finalizedMetadata: "none",
    capabilities: "none",
    permitReissue: "bearer-api-key",
  })) {
    assertCapabilitiesField(
      value.authentication?.[field] === expected,
      `authentication.${field}`,
    );
  }
  assertCapabilitiesField(
    Array.isArray(value.authentication?.requiredScopes)
      && value.authentication.requiredScopes.length === 2
      && value.authentication.requiredScopes[0] === "custom-launch:create"
      && value.authentication.requiredScopes[1] === "custom-launch:read",
    "authentication.requiredScopes",
  );
  assertCapabilitiesField(
    value.authentication?.apiKeyIsWallet === false,
    "authentication.apiKeyIsWallet",
  );
  assertCapabilitiesField(isPlainObject(value.preflight), "preflight");
  for (const [field, expected] of Object.entries({
    quotaConsumed: false,
    nonceAllocated: false,
    persisted: false,
    walletSignatureProduced: false,
    transactionBroadcast: false,
    exactProductionAdmissionEngine: true,
  })) {
    assertCapabilitiesField(value.preflight?.[field] === expected, `preflight.${field}`);
  }
  assertCapabilitiesField(isPlainObject(value.projectMetadata), "projectMetadata");
  for (const [field, expected] of Object.entries({
    schemaVersion: "programmable.project-metadata.v1",
    inputSchemaVersion: "programmable.project-metadata-input.v1",
    requiredForProfileVersion: DIRECT_NATIVE_PROFILE_VERSION,
    strictNewPackPolicyProfileVersion: DIRECT_NATIVE_PROFILE_VERSION,
    imageMayBeNull: false,
    maximumLinks: 32,
    exactlyOneRequiredLinkPerKind: true,
    websiteUriPolicy: "canonical-public-credential-free-https",
    xUriPattern: "^https://x\\.com/[A-Za-z0-9_]{1,64}$",
    projectMetadataHashDomain: "programmable.project-metadata.v1",
    graphBundleHashBindingDomain: "programmable.custom-graph-project-metadata.v1",
    postDeploymentTokenReadbackRequired: true,
  })) {
    assertCapabilitiesField(
      value.projectMetadata?.[field] === expected,
      `projectMetadata.${field}`,
    );
  }
  assertCapabilitiesField(
    canonicalizeJson(value.projectMetadata?.requiredFields) === canonicalizeJson([
      "token.name",
      "token.symbol",
      "presentation.description",
      "presentation.image",
      "presentation.links",
    ]),
    "projectMetadata.requiredFields",
  );
  assertCapabilitiesField(
    canonicalizeJson(value.projectMetadata?.requiredForProfileVersions)
      === canonicalizeJson(["3.2.0", "3.3.0"]),
    "projectMetadata.requiredForProfileVersions",
  );
  assertCapabilitiesField(
    canonicalizeJson(value.projectMetadata?.legacyMetadataProfileVersions)
      === canonicalizeJson(["3.2.0"]),
    "projectMetadata.legacyMetadataProfileVersions",
  );
  assertCapabilitiesField(
    canonicalizeJson(value.projectMetadata?.legacyWithoutMetadataProfileVersions)
      === canonicalizeJson(["2.0.0", "3.0.0", "3.1.0"]),
    "projectMetadata.legacyWithoutMetadataProfileVersions",
  );
  assertCapabilitiesField(
    canonicalizeJson(value.projectMetadata?.requiredLinkKinds) === canonicalizeJson([
      "website",
      "x",
    ]),
    "projectMetadata.requiredLinkKinds",
  );
  assertCapabilitiesField(
    canonicalizeJson(value.projectMetadata?.legacyImageMayBeNullProfileVersions)
      === canonicalizeJson(["3.2.0"]),
    "projectMetadata.legacyImageMayBeNullProfileVersions",
  );
  assertCapabilitiesField(
    canonicalizeJson(value.projectMetadata?.profilePolicy) === canonicalizeJson({
      schemaVersion: "programmable.project-metadata-policy.v1",
      descriptionMinimumUtf8Bytes: 20,
      descriptionMaximumUtf8Bytes: 4_096,
      descriptionMinimumUnicodeLettersOrNumbers: 8,
      imageRequired: true,
      imageReceiptSourceManifestBindingRequired: true,
      imageMediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
      linksMaximumCount: 32,
      requiredLinkKinds: ["website", "x"],
      exactlyOneRequiredLinkPerKind: true,
      websiteUriPolicy: "canonical-public-credential-free-https",
      xUriPattern: "^https://x\\.com/[A-Za-z0-9_]{1,64}$",
    }),
    "projectMetadata.profilePolicy",
  );
  assertCapabilitiesField(
    canonicalizeJson(value.projectMetadata?.enforcement) === canonicalizeJson({
      routes: ["POST /v3/custom-launches/preflight", "POST /v3/custom-launches"],
      serverSide: true,
      clientBypassAccepted: false,
      failureCode: "PROJECT_METADATA_POLICY_INVALID",
      legacyProfilesNotRetrofitted: true,
    }),
    "projectMetadata.enforcement",
  );
  assertCapabilitiesField(isPlainObject(value.permitReissue), "permitReissue");
  for (const [field, expected] of Object.entries({
    schemaVersion: PERMIT_REISSUE_CAPABILITY_SCHEMA_V1,
    endpoint: PERMIT_REISSUE_PATH_TEMPLATE_V3,
    requestSchemaVersion: PERMIT_REISSUE_REQUEST_SCHEMA_V1,
    dispositionSchemaVersion: PERMIT_REISSUE_DISPOSITION_SCHEMA_V1,
    disposition: "unsupported",
    httpStatus: 409,
    reasonCode: "ROUTER_V1_PERMIT_NONCE_IS_CREATE2_ROUTE_NONCE",
    authenticationScope: "custom-launch:create",
    idempotencyKeyRequired: true,
    noReplacementNonceReserved: true,
    noReplacementPermitIssued: true,
    oldPermitStateRequired: "expired-and-unconsumed",
    oldPermitInvalidation: "original-signature-expired-by-signed-deadline",
    currentReleaseRecovery: "repack-and-submit-new-launch-request",
  })) {
    assertCapabilitiesField(
      value.permitReissue?.[field] === expected,
      `permitReissue.${field}`,
    );
  }
  assertCapabilitiesField(
    canonicalizeJson(value.permitReissue?.resourceBindingRequired)
      === canonicalizeJson(["launchId", "expectedRequestHash", "expectedLaunchIntentHash"]),
    "permitReissue.resourceBindingRequired",
  );
  assertCapabilitiesField(
    Array.isArray(value.permitReissue?.futureContractRequirements)
      && value.permitReissue.futureContractRequirements.length > 0
      && value.permitReissue.futureContractRequirements.every(nonemptyString),
    "permitReissue.futureContractRequirements",
  );
  assertCapabilitiesField(
    safeWalletHandoffBase(value.walletHandoffBaseUrl) !== null,
    "walletHandoffBaseUrl",
  );
}

function assertCapabilitiesField(condition, field, value) {
  if (condition) return;
  throw new ProgrammableApiError(
    "Custom Launch API capabilities do not match the production V3 machine contract",
    {
      code: "CAPABILITIES_CONTRACT_INVALID",
      serverDetails: { field },
      ...(field === "$" && value !== undefined ? { cause: "response-is-not-an-object" } : {}),
    },
  );
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

function resourceActionSummary(resource, { walletHandoffBaseUrl } = {}) {
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

function permitRecoverySummary(resource) {
  if (resource?.status !== "failed"
    || resource?.failure?.code !== "PERMIT_EXPIRED"
    || resource?.onchainLaunchId !== null) {
    return null;
  }
  const launchId = typeof resource.launchId === "string"
    ? resource.launchId
    : typeof resource.requestId === "string"
      ? resource.requestId
      : null;
  return {
    action: "repack-and-submit-new-launch-request",
    requiresFreshNonce: true,
    requiresNewIdempotencyKey: true,
    predictedAddressesMayChange: true,
    automaticReissue: false,
    permitReissueEndpoint: launchId === null
      ? PERMIT_REISSUE_PATH_TEMPLATE_V3
      : PERMIT_REISSUE_PATH_TEMPLATE_V3.replace(
          "{launchId}",
          encodeURIComponent(launchId),
        ),
  };
}

function safeWalletHandoffUrl(value, advertisedBaseUrl) {
  if (typeof value !== "string") return null;
  let candidate;
  try {
    candidate = new URL(value);
  } catch {
    return null;
  }
  if (candidate.username || candidate.password) return null;
  const bases = [
    safeWalletHandoffBase(advertisedBaseUrl),
    safeWalletHandoffBase(WALLET_HANDOFF_BASE_URL),
  ].filter((entry) => entry !== null);
  if (candidate.origin !== new URL(WALLET_HANDOFF_BASE_URL).origin) return null;
  return bases.some((base) => pathIsWithin(candidate.pathname, new URL(base).pathname))
    ? candidate.href
    : null;
}

function safeWalletHandoffBase(value) {
  if (typeof value !== "string") return null;
  let base;
  try {
    base = new URL(value);
  } catch {
    return null;
  }
  if (base.username || base.password || base.search || base.hash) return null;
  const productionBase = new URL(WALLET_HANDOFF_BASE_URL);
  const normalizedPath = base.pathname === "/" ? "/" : base.pathname.replace(/\/$/u, "");
  return base.protocol === "https:"
    && base.origin === productionBase.origin
    && normalizedPath === productionBase.pathname
    ? `${base.origin}${base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`}`
    : null;
}

function pathIsWithin(candidatePath, basePath) {
  const normalizedBase = basePath === "/" ? "/" : basePath.replace(/\/$/u, "");
  return normalizedBase === "/"
    || candidatePath === normalizedBase
    || candidatePath.startsWith(`${normalizedBase}/`);
}

function safeExpiresAt(value) {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value))
    ? value
    : null;
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

function productionApiOrigin(value) {
  if (value === undefined || value === API_ORIGIN) return API_ORIGIN;
  throw new TypeError(
    `API origin is fixed to ${API_ORIGIN}; test network behavior through an injected fetch implementation`,
  );
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
