import { parseBoundedStrictJson } from "./strict-json-core.mjs";

import {
  API_ORIGIN,
  GITHUB_API_VERSION,
  MAX_API_JSON_BYTES,
  MAX_GITHUB_REQUESTS,
  MAX_GITHUB_RESPONSE_BYTES,
  REGISTRY_ACCEPTANCE_V3_GITHUB_DEADLINE_MS
} from "./registry-acceptance-v3-github-constants.mjs";

import { fail } from "./registry-acceptance-v3-github-primitives.mjs";

export async function githubJson(apiPath, {
  budget,
  fetchImplementation,
  githubToken,
  maxBytes = MAX_API_JSON_BYTES,
  signal
}) {
  budget.consumeRequest();
  const url = new URL(apiPath, API_ORIGIN);
  if (url.origin !== API_ORIGIN) fail("REGISTRY_REVIEW_API_INVALID", "GitHub API target escaped the canonical origin");
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "programmable-v4-builder-registry-acceptance-v3",
    "X-GitHub-Api-Version": GITHUB_API_VERSION
  };
  if (typeof githubToken === "string" && githubToken.length > 0) headers.Authorization = `Bearer ${githubToken}`;
  let response;
  try {
    response = await fetchImplementation(url, { headers, method: "GET", redirect: "error", signal });
  } catch {
    budget.assertActive();
    fail("REGISTRY_REVIEW_NETWORK_FAILED", "Read-only GitHub verification request failed");
  }
  let responseOrigin = API_ORIGIN;
  try {
    if (typeof response?.url === "string" && response.url.length > 0) responseOrigin = new URL(response.url).origin;
  } catch {
    fail("REGISTRY_REVIEW_API_INVALID", "GitHub API response URL is malformed");
  }
  if (response?.redirected === true || responseOrigin !== API_ORIGIN) fail("REGISTRY_REVIEW_API_INVALID", "GitHub API response was redirected or escaped the canonical origin");
  if (!response || response.status !== 200) {
    fail("REGISTRY_REVIEW_NETWORK_FAILED", `GitHub API returned ${String(response?.status ?? "no response")}`);
  }
  const bytes = await readResponseBytesBounded(response, maxBytes, budget);
  try {
    return parseBoundedStrictJson(bytes.toString("utf8"), {
      maxSourceBytes: maxBytes,
      maxDepth: 64,
      maxNodes: 100_000,
      maxNumberCharacters: maxBytes
    });
  } catch {
    fail("REGISTRY_REVIEW_API_INVALID", "GitHub API returned invalid bounded JSON");
  }
}

export async function readResponseBytesBounded(response, maximumBytes, budget) {
  const declared = response.headers?.get?.("content-length");
  if (declared !== null && declared !== undefined && (!/^[0-9]+$/u.test(declared) || Number(declared) > maximumBytes)) fail("REGISTRY_REVIEW_API_BOUNDED", "GitHub API response exceeds the closed byte bound");
  if (declared !== null && declared !== undefined) budget.assertResponseCapacity(Number(declared));
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximumBytes) fail("REGISTRY_REVIEW_API_BOUNDED", "GitHub API response exceeds the closed byte bound");
    budget.consumeResponseBytes(bytes.length);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      budget.assertActive();
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) fail("REGISTRY_REVIEW_API_BOUNDED", "GitHub API response exceeds the closed byte bound");
      budget.consumeResponseBytes(value.byteLength);
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks, length);
}

export function createGithubRequestContext({ deadlineMs, fetchImplementation, githubToken, signal }) {
  if (
    !Number.isSafeInteger(deadlineMs)
    || deadlineMs < 1
    || deadlineMs > REGISTRY_ACCEPTANCE_V3_GITHUB_DEADLINE_MS
  ) fail("REGISTRY_REVIEW_DEADLINE_INVALID", "GitHub verification deadline must be a positive bounded duration");
  if (githubToken !== null && (
    typeof githubToken !== "string"
    || githubToken.length < 1
    || githubToken.length > 1024
    || /[\u0000-\u0020\u007f-\u009f]/u.test(githubToken)
  )) fail("REGISTRY_REVIEW_TOKEN_INVALID", "Explicit GitHub token is malformed");
  const controller = new AbortController();
  const deadlineAt = Date.now() + deadlineMs;
  const timeout = setTimeout(() => controller.abort(new Error("GitHub verification deadline exceeded")), deadlineMs);
  timeout.unref?.();
  const combinedSignal = signal === undefined
    ? controller.signal
    : AbortSignal.any([controller.signal, signal]);
  let requests = 0;
  let responseBytes = 0;
  const budget = {
    assertActive() {
      if (combinedSignal.aborted || Date.now() > deadlineAt) fail("REGISTRY_REVIEW_DEADLINE", "GitHub verification exceeded its absolute deadline");
    },
    consumeRequest() {
      this.assertActive();
      requests += 1;
      if (requests > MAX_GITHUB_REQUESTS) fail("REGISTRY_REVIEW_API_BOUNDED", "GitHub verification exceeded its aggregate request bound");
    },
    assertResponseCapacity(byteLength) {
      this.assertActive();
      if (!Number.isSafeInteger(byteLength) || byteLength < 0 || responseBytes + byteLength > MAX_GITHUB_RESPONSE_BYTES) {
        fail("REGISTRY_REVIEW_API_BOUNDED", "GitHub verification exceeded its aggregate response-byte bound");
      }
    },
    consumeResponseBytes(byteLength) {
      this.assertResponseCapacity(byteLength);
      responseBytes += byteLength;
    }
  };
  const context = {
    budget,
    dispose() {
      clearTimeout(timeout);
      controller.abort();
      context.fetchImplementation = null;
      context.githubToken = null;
    },
    fetchImplementation,
    githubToken,
    signal: combinedSignal
  };
  return context;
}
