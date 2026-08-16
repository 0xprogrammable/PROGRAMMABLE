import { performance } from "node:perf_hooks";
import { TextDecoder, TextEncoder } from "node:util";
import {
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  GitHubPublicSourceError
} from "./github-public-source-contract.mjs";
import { parseBoundedLosslessJson } from "./github-public-source-lossless-json.mjs";
import {
  assertCanonicalApiUrl,
  assertPlainObject,
  githubUnavailableMessage,
  normalizeRetryAfter,
  normalizeTransportHeaderValue
} from "./github-public-source-shared.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const maximumTreeResponseBytes = 8_388_608;
const maximumOtherResponseBytes = 1_048_576;
// GitHub's JSON blob envelope base64-expands the canonical two-megabyte
// review-file ceiling. Production uses the batched exact-object resolver, but
// the bounded REST fallback still needs room for one valid canonical blob.
const maximumBlobResponseBytes = 3_000_000;

export async function requestGitHubJson(pathAndQuery, resourceKind, state) {
  const url = `${GITHUB_PUBLIC_SOURCE_CONTRACT_V1.apiOrigin}${pathAndQuery}`;
  assertCanonicalApiUrl(url);
  if (state.requestsRemaining <= 0) {
    throw new GitHubPublicSourceError(
      "GITHUB_UPSTREAM_REJECTED",
      "GitHub public source request budget was exhausted; reduce companion or declared-path breadth"
    );
  }
  state.requestsRemaining -= 1;
  const releaseTreeSlot = resourceKind === "tree" ? await state.treeRequestSemaphore.acquire() : null;
  let reservedResponseBytes = 0;
  try {
    const remainingMs = state.deadline - performance.now();
    if (remainingMs <= 0) {
      throw new GitHubPublicSourceError("GITHUB_TIMEOUT", "GitHub resolution timed out", { retryable: true });
    }
    reservedResponseBytes = reserveResponseBytes(resourceKind, state);

    const controller = new AbortController();
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        reject(new GitHubPublicSourceError("GITHUB_TIMEOUT", "GitHub resolution timed out", { retryable: true }));
      }, remainingMs);
    });

    let response;
    try {
      response = await Promise.race([
        Promise.resolve(
          state.transport({
            method: "GET",
            url,
            headers: Object.freeze({
              Accept: "application/vnd.github+json",
              "User-Agent": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.userAgent,
              "X-GitHub-Api-Version": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.githubApiVersion,
            }),
            redirect: "error",
            signal: controller.signal,
            maxResponseBytes: reservedResponseBytes,
          }),
        ),
        timeoutPromise,
      ]);
    } catch (error) {
      if (error instanceof GitHubPublicSourceError) throw error;
      throw new GitHubPublicSourceError("GITHUB_NETWORK_ERROR", "GitHub request failed", {
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }

    const normalized = normalizeTransportResponse(response, url);
    if (normalized.body.byteLength > reservedResponseBytes) {
      reservedResponseBytes = 0;
      throw new GitHubPublicSourceError(
        "GITHUB_RESPONSE_TOO_LARGE",
        "GitHub responses exceeded the total byte limit",
      );
    }
    state.responseBytesRemaining += reservedResponseBytes - normalized.body.byteLength;
    reservedResponseBytes = 0;

    const status = normalized.status;
    const retryAfterSeconds = normalizeRetryAfter(normalized.headers["retry-after"]);
    if (status >= 300 && status < 400) {
      throw new GitHubPublicSourceError("GITHUB_REDIRECT_REJECTED", "GitHub redirect was rejected", { status });
    }
    if (status === 429 || status === 403) {
      throw new GitHubPublicSourceError("GITHUB_RATE_LIMITED", "GitHub public API rate limit was reached", {
        retryable: true,
        status,
        retryAfterSeconds,
      });
    }
    if (status === 404) {
      const codeByResource = {
        repository: "GITHUB_PUBLIC_REPOSITORY_UNAVAILABLE",
        commit: "GITHUB_COMMIT_NOT_REACHABLE",
        tree: "GITHUB_TREE_NOT_REACHABLE",
        blob: "GITHUB_DECLARED_PATH_NOT_FOUND",
        "actions-run": "GITHUB_ACTIONS_RUN_NOT_REACHABLE",
      };
      throw new GitHubPublicSourceError(codeByResource[resourceKind], githubUnavailableMessage(resourceKind), {
        status,
      });
    }
    if (status >= 500) {
      throw new GitHubPublicSourceError("GITHUB_UNAVAILABLE", "GitHub public API is unavailable", {
        retryable: true,
        status,
        retryAfterSeconds,
      });
    }
    if (status < 200 || status >= 300) {
      throw new GitHubPublicSourceError("GITHUB_UPSTREAM_REJECTED", "GitHub public API rejected the request", {
        status,
      });
    }

    try {
      const text = decoder.decode(normalized.body);
      const parsed = parseBoundedLosslessJson(text);
      assertPlainObject(parsed, "GITHUB_PROTOCOL_ERROR", "GitHub response must be a JSON object");
      return parsed;
    } catch (error) {
      if (error instanceof GitHubPublicSourceError) throw error;
      throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub returned invalid JSON", { cause: error });
    }
  } finally {
    if (reservedResponseBytes > 0) state.responseBytesRemaining += reservedResponseBytes;
    releaseTreeSlot?.();
  }
}

function reserveResponseBytes(resourceKind, state) {
  if (state.responseBytesRemaining <= 0) {
    throw new GitHubPublicSourceError("GITHUB_RESPONSE_TOO_LARGE", "GitHub responses exceeded the total byte limit");
  }
  const perResponseLimit = resourceKind === "tree"
    ? maximumTreeResponseBytes
    : resourceKind === "blob"
      ? maximumBlobResponseBytes
      : maximumOtherResponseBytes;
  const reserved = Math.min(perResponseLimit, state.responseBytesRemaining);
  state.responseBytesRemaining -= reserved;
  return reserved;
}

export function createBoundedSemaphore(limit) {
  let active = 0;
  const waiters = [];

  return Object.freeze({
    acquire() {
      return new Promise((resolve) => {
        const grant = () => {
          active += 1;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            active -= 1;
            waiters.shift()?.();
          });
        };
        if (active < limit) grant();
        else waiters.push(grant);
      });
    },
  });
}


function normalizeTransportResponse(response, expectedUrl) {
  assertPlainObject(response, "GITHUB_PROTOCOL_ERROR", "transport response must be an object");
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "transport status was invalid");
  }
  if (response.redirected === true) {
    throw new GitHubPublicSourceError("GITHUB_REDIRECT_REJECTED", "GitHub redirect was rejected", {
      status: response.status,
    });
  }
  if (response.responseUrl !== undefined && response.responseUrl !== "" && response.responseUrl !== expectedUrl) {
    throw new GitHubPublicSourceError("GITHUB_REDIRECT_REJECTED", "GitHub response URL changed");
  }

  let body;
  if (typeof response.body === "string") {
    body = encoder.encode(response.body);
  } else if (response.body instanceof Uint8Array) {
    body = response.body;
  } else if (response.body instanceof ArrayBuffer) {
    body = new Uint8Array(response.body);
  } else {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "transport body must be bytes or text");
  }

  return {
    status: response.status,
    headers: normalizeHeaders(response.headers),
    body,
  };
}

function normalizeHeaders(headers) {
  if (headers === undefined || headers === null) return Object.create(null);
  const output = Object.create(null);
  if (typeof headers.get === "function") {
    for (const name of ["retry-after", "x-ratelimit-remaining", "content-type"]) {
      output[name] = headers.get(name);
    }
    return output;
  }
  assertPlainObject(headers, "GITHUB_PROTOCOL_ERROR", "transport headers must be an object");
  for (const [name, value] of Object.entries(headers)) {
    output[name.toLowerCase()] = normalizeTransportHeaderValue(value);
  }
  return output;
}
