import { performance } from "node:perf_hooks";
import {
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  GITHUB_PUBLIC_SOURCE_ERROR_CODES_V1,
  GitHubPublicSourceError
} from "./github-public-source-contract.mjs";
import {
  isCanonicalGitHubRepositoryPathV1,
  normalizeLocalBlobBytes,
  validateGitHubPublicSourceRequestV1
} from "./github-public-source-request.mjs";
import { createGitHubPublicFetchTransportV1 } from "./github-public-source-fetch-transport.mjs";
import { createBoundedSemaphore } from "./github-public-source-api.mjs";
import { resolveRepository } from "./github-public-source-repository.mjs";
import {
  assertExactKeys,
  assertPlainObject,
  deepFreeze,
  stableStringify
} from "./github-public-source-shared.mjs";
import { parseBoundedLosslessJson } from "./github-public-source-lossless-json.mjs";

export {
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  GITHUB_PUBLIC_SOURCE_ERROR_CODES_V1,
  GitHubPublicSourceError,
  createGitHubPublicFetchTransportV1,
  isCanonicalGitHubRepositoryPathV1,
  parseBoundedLosslessJson,
  validateGitHubPublicSourceRequestV1
};

const allowedOptionKeys = new Set([
  "transport",
  "timeoutMs",
  "maxResponseBytes",
  "localBlobBytes",
  "exactObjectResolver",
]);
// Nine repositories resolved serially need at least 27 GitHub round trips even
// without Actions evidence. Three-wide deterministic batches keep the shared
// ten-second deadline practical without creating an unbounded request fan-out.
const maximumConcurrentRepositories = 3;
// A GitHub recursive tree response is bounded at roughly 7 MB. Two tree slots
// preserve the resolver's aggregate byte limit while other repositories wait.
const maximumConcurrentTreeRequests = 2;
const maximumGitHubRequests = GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.anonymousRestRequests;

export async function resolveGitHubPublicSourceV1(input, options = {}) {
  const request = validateGitHubPublicSourceRequestV1(input);
  const resolverOptions = normalizeOptions(options, request);
  const state = {
    deadline: performance.now() + resolverOptions.timeoutMs,
    requestsRemaining: maximumGitHubRequests,
    responseBytesRemaining: resolverOptions.maxResponseBytes,
    treeRequestSemaphore: createBoundedSemaphore(maximumConcurrentTreeRequests),
    transport: resolverOptions.transport,
    localBlobBytes: resolverOptions.localBlobBytes,
    exactObjectResolver: resolverOptions.exactObjectResolver,
  };

  const repositories = [
    { request: request.primary, role: "primary" },
    ...request.companions.map((companion) => ({ request: companion, role: "companion" })),
  ];
  const resolvedRepositories = await resolveRepositoryBatches(repositories, state);
  const [primary, ...companions] = resolvedRepositories;

  return deepFreeze({
    schemaVersion: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.schemaVersion,
    kind: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.kind,
    canonicalProviderOrigin: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.canonicalProviderOrigin,
    githubApiVersion: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.githubApiVersion,
    primary,
    companions,
  });
}

async function resolveRepositoryBatches(repositories, state) {
  const resolved = new Array(repositories.length);
  for (let offset = 0; offset < repositories.length; offset += maximumConcurrentRepositories) {
    const batch = repositories.slice(offset, offset + maximumConcurrentRepositories);
    const settled = await Promise.allSettled(
      batch.map(({ request, role }) => resolveRepository(request, role, state)),
    );
    // Inspect in canonical request order so simultaneous failures do not make
    // the resolver's observable result depend on network completion order.
    for (let index = 0; index < settled.length; index += 1) {
      const outcome = settled[index];
      if (outcome.status === "rejected") throw outcome.reason;
      resolved[offset + index] = outcome.value;
    }
  }
  return resolved;
}

export function serializeGitHubPublicSourceV1(value) {
  return stableStringify(value);
}

function normalizeOptions(options, request) {
  assertPlainObject(options, "INVALID_OPTIONS", "resolver options must be an object");
  assertExactKeys(options, allowedOptionKeys, "INVALID_OPTIONS");
  const timeoutMs = options.timeoutMs ?? GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.defaultTimeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.minimumTimeoutMs ||
    timeoutMs > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.maximumTimeoutMs
  ) {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "timeoutMs is outside the contract bounds");
  }

  const maxResponseBytes =
    options.maxResponseBytes ?? GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.defaultTotalResponseBytes;
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.minimumTotalResponseBytes ||
    maxResponseBytes > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.maximumTotalResponseBytes
  ) {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "maxResponseBytes is outside the contract bounds");
  }

  const transport = options.transport ?? createGitHubPublicFetchTransportV1();
  if (typeof transport !== "function") {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "transport must be a function");
  }
  const exactObjectResolver = options.exactObjectResolver ?? null;
  if (exactObjectResolver !== null && typeof exactObjectResolver !== "function") {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "exactObjectResolver must be a function");
  }
  const localBlobBytes = normalizeLocalBlobBytes(options.localBlobBytes, request);
  return { timeoutMs, maxResponseBytes, transport, localBlobBytes, exactObjectResolver };
}
