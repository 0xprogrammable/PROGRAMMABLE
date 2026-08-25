import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  API_ORIGIN,
  CREATE_PATH,
  TERMINAL_STATUSES,
  WALLET_HANDOFF_STATUS,
} from "./constants.mjs";
import {
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
const MAX_SUBMISSION_JOURNAL_BYTES = 12_582_912;

export class ProgrammableApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ProgrammableApiError";
    this.details = details;
  }
}

export async function submitLaunch(options) {
  const launchPath = path.resolve(options.launchPath);
  if (typeof options.configPath !== "string" || options.configPath.length === 0) {
    throw new TypeError("submit requires --config so exact source and build artifacts are freshly repacked");
  }
  await validateLaunchFile({ launchPath, configPath: options.configPath });
  const requestBytes = await readFile(launchPath);
  const requestSha256 = sha256Digest(requestBytes);
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
    requestPath: CREATE_PATH,
    idempotencyKey,
    requestSha256,
    requestBodyBase64: requestBytes.toString("base64"),
    lastResponse: null,
  };
  const journal = await bindJournal(journalPath, binding);
  const apiKey = await (options.loadApiKeyImpl ?? loadApiKey)();
  const result = await requestWithRetry({
    method: "POST",
    url: `${apiOrigin}${CREATE_PATH}`,
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
  return {
    idempotencyKey,
    requestSha256,
    journalPath,
    httpStatus: result.status,
    retryAfter: result.retryAfter,
    resource: result.body,
  };
}

export async function statusLaunch(options) {
  if (typeof options.requestId !== "string" || !REQUEST_ID.test(options.requestId)) {
    throw new TypeError("status requires the Custom launch request UUID");
  }
  const apiOrigin = normalizeApiOrigin(options.apiOrigin ?? API_ORIGIN);
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
      url: `${apiOrigin}${CREATE_PATH}/${encodeURIComponent(options.requestId)}`,
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
    const stopped = TERMINAL_STATUSES.has(status)
      || (until === WALLET_HANDOFF_STATUS && status === WALLET_HANDOFF_STATUS)
      || (until === "finalized" && status === "finalized");
    if (!options.watch || stopped) {
      return {
        httpStatus: result.status,
        stopped,
        terminal: TERMINAL_STATUSES.has(status),
        walletHandoffReady: status === WALLET_HANDOFF_STATUS,
        resource,
      };
    }
    await (options.sleepImpl ?? sleep)(pollIntervalMs);
  }
}

async function bindJournal(journalPath, binding) {
  let existing;
  try {
    existing = (await readStrictJsonFile(journalPath, MAX_SUBMISSION_JOURNAL_BYTES)).value;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existing === undefined) {
    await atomicWrite(
      journalPath,
      Buffer.from(`${canonicalizeJson(binding)}\n`, "utf8"),
      0o600,
    );
    return binding;
  }
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
    try {
      response = await fetchImpl(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      await sleepImpl(retryDelayMs(null, attempt));
      continue;
    } finally {
      clearTimeout(timeout);
    }
    const retryAfter = response.headers.get("retry-after");
    const responseBytes = Buffer.from(await response.arrayBuffer());
    const body = parseResponseBody(responseBytes, response.status);
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
  return new ProgrammableApiError(
    typeof error?.message === "string" ? error.message : `Custom Launch API returned HTTP ${status}`,
    {
      httpStatus: status,
      code: typeof error?.code === "string" ? error.code : null,
      requestId: typeof error?.requestId === "string" ? error.requestId : null,
      retryAfter,
    },
  );
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

function errorRequestId(body) {
  return typeof body?.error?.requestId === "string" ? body.error.requestId : null;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
