import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { assertReadModelReleaseEvidenceCommitment } from
  "./read-model-evidence-commitment.mjs";

export const ROUTE_NAMES = Object.freeze([
  "exploreList",
  "tokenDetail",
  "tokenChart",
  "creatorProfile",
  "classicProfile",
  "stockProfile",
  "classicLaunchLookup",
  "stockLaunchLookup",
  "publicIndexer",
  "health",
]);

const DATASET_KEYS = Object.freeze([
  "launches",
  "chainEvents",
  "marketSnapshots",
  "marketCandles",
  "accounts",
  "rewardRows",
]);

const CACHE_KEYS = Object.freeze([
  "exploreList",
  "tokenDetail",
  "tokenChart",
  "creatorProfile",
  "classicProfile",
  "stockProfile",
  "classicLaunchLookup",
  "stockLaunchLookup",
  "publicIndexer",
  "tokenList",
  "health",
  "accountMutation",
  "transactionPreparation",
]);

const SHADOW_ROUTES = Object.freeze([
  "exploreList",
  "tokenDetail",
  "tokenChart",
  "creatorProfile",
  "classicProfile",
  "stockProfile",
  "classicLaunchLookup",
  "stockLaunchLookup",
]);
const ARTIFACT_KEYS = Object.freeze([
  "datasetManifest",
  "httpSamples",
  "rpcTrace",
]);
const RPC_OPERATIONS = new Set([
  "getChainId",
  "getBlockNumber",
  "getBlock",
  "getTransactionReceipt",
  "getBytecode",
]);
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const HEX_HASH = /^0x[0-9a-fA-F]{64}$/u;
const CANDIDATE_ID = /^1:(0x[0-9a-fA-F]{64}):(0x[0-9a-fA-F]{64}):([0-9]+)$/u;
const HEX_DIGEST = /^[0-9a-f]{64}$/u;
const HEX_BYTES32 = /^0x[0-9a-f]{64}$/u;
const GIT_SHA = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{20,80}$/u;
const ARTIFACT_FILE = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const SMOKE_PROFILE_ID = "read-model-smoke-v1";
const RELEASE_PROFILE_ID = "read-model-release-v1";
const PROFILE_CONTRACTS = Object.freeze({
  [SMOKE_PROFILE_ID]: Object.freeze({
    tokenKeyCount: 100,
    accountKeyCount: 100,
    candidateCount: 8,
    minimumEligibleLaunches: 200,
    expectedDataset: Object.freeze({
      launches: 200,
      chainEvents: 600,
      marketSnapshots: 200,
      marketCandles: 200,
      accounts: 100,
      rewardRows: 200,
    }),
  }),
  [RELEASE_PROFILE_ID]: Object.freeze({
    tokenKeyCount: 264,
    accountKeyCount: 100,
    candidateCount: 32,
    minimumEligibleLaunches: 264,
    expectedDataset: Object.freeze({
      launches: 264,
      chainEvents: 792,
      marketSnapshots: 264,
      marketCandles: 264,
      accounts: 100,
      rewardRows: 264,
    }),
  }),
});
const REQUIRED_RELEASE_VERSIONS = Object.freeze([
  "classic-v2",
  "classic-v3",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
]);

const EXPECTED_CACHE_CONTRACTS = Object.freeze({
  exploreList:
    "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
  tokenDetail:
    "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
  tokenChart:
    "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
  creatorProfile: "private, max-age=0, s-maxage=15",
  classicProfile: "no-store",
  stockProfile: "no-store",
  classicLaunchLookup: "no-store",
  stockLaunchLookup: "no-store",
  publicIndexer:
    "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
  tokenList:
    "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  health: "public, max-age=0, s-maxage=30",
  accountMutation: "private, no-store",
  transactionPreparation: "private, no-store",
});

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function object(value, path) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail(path, "expected an object");
  }
  return value;
}

function exactKeys(value, keys, path) {
  const input = object(value, path);
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(path, `expected exactly: ${expected.join(", ")}`);
  }
  return input;
}

function integer(value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(path, `expected an integer greater than or equal to ${minimum}`);
  }
  return value;
}

function string(value, path, maximumLength = 256) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength
  ) {
    fail(path, `expected a non-empty string of at most ${maximumLength} characters`);
  }
  return value;
}

function stringArray(value, path) {
  if (!Array.isArray(value) || value.length < 1) {
    fail(path, "expected a non-empty string array");
  }
  const parsed = value.map((entry, index) =>
    string(entry, `${path}[${index}]`),
  );
  if (new Set(parsed).size !== parsed.length) {
    fail(path, "entries must be unique");
  }
  return parsed;
}

function timestamp(value, path) {
  const parsed = Date.parse(string(value, path));
  if (!Number.isFinite(parsed)) fail(path, "expected an ISO timestamp");
  return parsed;
}

function sameRecord(left, right, keys) {
  return keys.every((key) => left[key] === right[key]);
}

function atLeastRecord(observed, minimums, keys) {
  return keys.every((key) => observed[key] >= minimums[key]);
}

function parseDataset(value, path) {
  const input = exactKeys(value, DATASET_KEYS, path);
  for (const key of DATASET_KEYS) integer(input[key], `${path}.${key}`, 1);
  return input;
}

function parseCacheContracts(value, path) {
  const input = exactKeys(value, CACHE_KEYS, path);
  for (const key of CACHE_KEYS) string(input[key], `${path}.${key}`);
  return input;
}

export function projectorCallsPerProviderPerAttempt(
  profile,
  candidateBatchSize,
) {
  integer(candidateBatchSize, "candidateBatchSize", 1);
  return (
    profile.projector.rpc.fixedCallsPerProviderPerAttempt +
    candidateBatchSize *
      profile.projector.rpc.callsPerCandidatePerProviderPerAttempt
  );
}

export function projectorWorstCaseRetryContract(profile, candidateBatchSize) {
  integer(candidateBatchSize, "candidateBatchSize", 1);
  const rpc = profile.projector.rpc;
  const operationWorstCaseMs =
    rpc.maxAttemptsPerCall * rpc.perCallTimeoutMs +
    Array.from(
      { length: rpc.maxAttemptsPerCall - 1 },
      (_, index) => rpc.baseBackoffMs * 2 ** index,
    ).reduce((total, value) => total + value, 0);
  const stateWaves = 1;
  const blockWaves = Math.ceil(
    (candidateBatchSize + 1) / rpc.maxConcurrencyPerProvider,
  );
  const receiptWaves = Math.ceil(
    candidateBatchSize / rpc.maxConcurrencyPerProvider,
  );
  const bytecodeWaves = receiptWaves;
  return {
    callsPerProvider:
      projectorCallsPerProviderPerAttempt(profile, candidateBatchSize) *
      rpc.maxAttemptsPerCall,
    durationMs:
      (stateWaves + blockWaves + receiptWaves + bytecodeWaves) *
      operationWorstCaseMs,
  };
}

export function parseReadModelLoadProfile(value) {
  const input = exactKeys(
    value,
    [
      "schemaVersion",
      "profileId",
      "scope",
      "evidence",
      "dataset",
      "datasetCoverage",
      "load",
      "projector",
      "providerLimits",
      "shadow",
      "cacheContracts",
    ],
    "profile",
  );
  if (input.schemaVersion !== 1) fail("profile.schemaVersion", "expected 1");
  const contract = PROFILE_CONTRACTS[input.profileId];
  if (!contract) {
    fail(
      "profile.profileId",
      "expected read-model-smoke-v1 or read-model-release-v1",
    );
  }
  const releaseProfile = input.profileId === RELEASE_PROFILE_ID;

  const scope = exactKeys(
    input.scope,
    ["models", "excludedModels"],
    "profile.scope",
  );
  const models = stringArray(scope.models, "profile.scope.models");
  const excludedModels = stringArray(
    scope.excludedModels,
    "profile.scope.excludedModels",
  );
  if (
    models.join(",") !== "classic,stock-paired" ||
    excludedModels.join(",") !== "adaptive,deep"
  ) {
    fail("profile.scope", "must cover Classic and Stock-Paired only");
  }

  const evidence = exactKeys(
    input.evidence,
    [
      "maximumAgeSeconds",
      "requiredKinds",
      "requireExactGitHead",
      "requireLiveVercelBinding",
      "requiredArtifactDigests",
    ],
    "profile.evidence",
  );
  integer(evidence.maximumAgeSeconds, "profile.evidence.maximumAgeSeconds", 60);
  if (
    stringArray(evidence.requiredKinds, "profile.evidence.requiredKinds").join(",") !==
      "preview,production-canary" ||
    evidence.requireExactGitHead !== true ||
    evidence.requireLiveVercelBinding !== true ||
    stringArray(
      evidence.requiredArtifactDigests,
      "profile.evidence.requiredArtifactDigests",
    ).join(",") !== ARTIFACT_KEYS.join(",")
  ) {
    fail("profile.evidence", "release binding requirements are incomplete");
  }

  const dataset = parseDataset(input.dataset, "profile.dataset");
  if (!sameRecord(dataset, contract.expectedDataset, DATASET_KEYS)) {
    fail("profile.dataset", "does not match the profile dataset floor");
  }

  const datasetCoverage = exactKeys(
    input.datasetCoverage,
    [
      "minimumEligibleLaunches",
      "maximumEligibleLaunches",
      "maximumClassicLookupLaunches",
      "maximumStockLookupLaunches",
      "minimumRowsPerLaunch",
      "requiredReleaseVersions",
      "minimumClassicLookupLaunches",
      "minimumStockLookupLaunches",
      "tokenSampleCount",
      "accountSampleCount",
      "classicLaunchSampleCount",
      "stockLaunchSampleCount",
      "candidateSampleCount",
    ],
    "profile.datasetCoverage",
  );
  for (const key of [
    "minimumEligibleLaunches",
    "maximumEligibleLaunches",
    "maximumClassicLookupLaunches",
    "maximumStockLookupLaunches",
    "minimumClassicLookupLaunches",
    "minimumStockLookupLaunches",
    "tokenSampleCount",
    "accountSampleCount",
    "classicLaunchSampleCount",
    "stockLaunchSampleCount",
    "candidateSampleCount",
  ]) {
    integer(datasetCoverage[key], `profile.datasetCoverage.${key}`, 1);
  }
  const minimumRowsPerLaunch = exactKeys(
    datasetCoverage.minimumRowsPerLaunch,
    ["chainEvents", "marketSnapshots", "marketCandles", "rewardRows"],
    "profile.datasetCoverage.minimumRowsPerLaunch",
  );
  for (const key of Object.keys(minimumRowsPerLaunch)) {
    integer(
      minimumRowsPerLaunch[key],
      `profile.datasetCoverage.minimumRowsPerLaunch.${key}`,
      1,
    );
  }
  if (
    stringArray(
      datasetCoverage.requiredReleaseVersions,
      "profile.datasetCoverage.requiredReleaseVersions",
    ).join(",") !== REQUIRED_RELEASE_VERSIONS.join(",") ||
    datasetCoverage.minimumEligibleLaunches !==
      contract.minimumEligibleLaunches ||
    datasetCoverage.maximumEligibleLaunches !== 400 ||
    datasetCoverage.maximumClassicLookupLaunches !== 300 ||
    datasetCoverage.maximumStockLookupLaunches !== 100 ||
    datasetCoverage.minimumClassicLookupLaunches !== 32 ||
    datasetCoverage.minimumStockLookupLaunches !== 32 ||
    datasetCoverage.tokenSampleCount !== contract.tokenKeyCount ||
    datasetCoverage.accountSampleCount !== contract.accountKeyCount ||
    datasetCoverage.classicLaunchSampleCount !== 32 ||
    datasetCoverage.stockLaunchSampleCount !== 32 ||
    datasetCoverage.candidateSampleCount !== contract.candidateCount ||
    !sameRecord(
      minimumRowsPerLaunch,
      {
        chainEvents: 3,
        marketSnapshots: 1,
        marketCandles: 1,
        rewardRows: 1,
      },
      ["chainEvents", "marketSnapshots", "marketCandles", "rewardRows"],
    )
  ) {
    fail("profile.datasetCoverage", "does not match the v1 real-corpus contract");
  }

  const load = exactKeys(
    input.load,
    [
      "concurrency",
      "durationSeconds",
      "minimumCompletedRequests",
      "probeTimeoutMs",
      "maximumErrorRateBps",
      "maximumCacheHitRateBps",
      "minimumDistinctTokenKeys",
      "minimumDistinctAccountKeys",
      "minimumDistinctClassicLaunchKeys",
      "minimumDistinctStockLaunchKeys",
      "probeCacheControl",
      "requiredVercelCacheStatuses",
      "routeMixBps",
      "maximumRouteP95Ms",
      "maximumRouteP99Ms",
    ],
    "profile.load",
  );
  integer(load.concurrency, "profile.load.concurrency", 1);
  integer(load.durationSeconds, "profile.load.durationSeconds", 1);
  integer(
    load.minimumCompletedRequests,
    "profile.load.minimumCompletedRequests",
    1,
  );
  integer(load.probeTimeoutMs, "profile.load.probeTimeoutMs", 1);
  integer(load.maximumErrorRateBps, "profile.load.maximumErrorRateBps");
  integer(load.maximumCacheHitRateBps, "profile.load.maximumCacheHitRateBps");
  integer(load.minimumDistinctTokenKeys, "profile.load.minimumDistinctTokenKeys", 2);
  integer(
    load.minimumDistinctAccountKeys,
    "profile.load.minimumDistinctAccountKeys",
    2,
  );
  integer(
    load.minimumDistinctClassicLaunchKeys,
    "profile.load.minimumDistinctClassicLaunchKeys",
    2,
  );
  integer(
    load.minimumDistinctStockLaunchKeys,
    "profile.load.minimumDistinctStockLaunchKeys",
    2,
  );
  if (load.probeCacheControl !== "private, no-store") {
    fail("profile.load.probeCacheControl", "expected private, no-store");
  }
  if (
    stringArray(
      load.requiredVercelCacheStatuses,
      "profile.load.requiredVercelCacheStatuses",
    ).join(",") !== "MISS,BYPASS"
  ) {
    fail("profile.load.requiredVercelCacheStatuses", "expected MISS and BYPASS");
  }
  const routeMix = exactKeys(
    load.routeMixBps,
    ROUTE_NAMES,
    "profile.load.routeMixBps",
  );
  const latencyBudgets = exactKeys(
    load.maximumRouteP95Ms,
    ROUTE_NAMES,
    "profile.load.maximumRouteP95Ms",
  );
  const p99LatencyBudgets = exactKeys(
    load.maximumRouteP99Ms,
    ROUTE_NAMES,
    "profile.load.maximumRouteP99Ms",
  );
  const routeMixTotal = ROUTE_NAMES.reduce(
    (total, route) =>
      total + integer(routeMix[route], `profile.load.routeMixBps.${route}`),
    0,
  );
  for (const route of ROUTE_NAMES) {
    integer(latencyBudgets[route], `profile.load.maximumRouteP95Ms.${route}`, 1);
    integer(
      p99LatencyBudgets[route],
      `profile.load.maximumRouteP99Ms.${route}`,
      1,
    );
    if (p99LatencyBudgets[route] < latencyBudgets[route]) {
      fail(`profile.load.maximumRouteP99Ms.${route}`, "must be at least p95");
    }
  }
  if (
    routeMixTotal !== 10_000 ||
    load.concurrency !== 20 ||
    load.durationSeconds !== 60 ||
    load.minimumCompletedRequests !== 1_000 ||
    load.probeTimeoutMs !== 30_000 ||
    load.maximumErrorRateBps !== 0 ||
    load.maximumCacheHitRateBps !== 0 ||
    load.minimumDistinctTokenKeys !== contract.tokenKeyCount ||
    load.minimumDistinctAccountKeys !== contract.accountKeyCount ||
    load.minimumDistinctClassicLaunchKeys !== 32 ||
    load.minimumDistinctStockLaunchKeys !== 32
  ) {
    fail("profile.load", "does not match the v1 load contract");
  }

  const projector = exactKeys(
    input.projector,
    [
      "hostingDeadlineMs",
      "hardDeadlineMs",
      "minimumReserveMs",
      "smokeCandidateBatchSize",
      "maximumCandidateBatchSize",
      "rpc",
    ],
    "profile.projector",
  );
  for (const key of [
    "hostingDeadlineMs",
    "hardDeadlineMs",
    "minimumReserveMs",
    "smokeCandidateBatchSize",
    "maximumCandidateBatchSize",
  ]) {
    integer(projector[key], `profile.projector.${key}`, 1);
  }
  if (
    projector.hostingDeadlineMs !== 90_000 ||
    projector.hardDeadlineMs !== 75_000 ||
    projector.minimumReserveMs !== 15_000 ||
    projector.smokeCandidateBatchSize !== 8 ||
    projector.maximumCandidateBatchSize !==
      (releaseProfile ? 32 : 8) ||
    projector.hostingDeadlineMs - projector.hardDeadlineMs <
      projector.minimumReserveMs
  ) {
    fail("profile.projector", "deadline or batch contract is invalid");
  }

  const rpc = exactKeys(
    projector.rpc,
    [
      "providerCount",
      "perCallTimeoutMs",
      "maxAttemptsPerCall",
      "baseBackoffMs",
      "maxConcurrencyPerProvider",
      "fixedCallsPerProviderPerAttempt",
      "callsPerCandidatePerProviderPerAttempt",
      "smokeFirstAttemptCallsPerProvider",
      "theoreticalWorstCaseCallsPerProvider",
      "theoreticalWorstCaseDurationMs",
      "globalRetryAllowancePerProvider",
      "maxCallsPerProviderPerRun",
      "maxAggregateCallsPerRun",
    ],
    "profile.projector.rpc",
  );
  for (const key of Object.keys(rpc)) {
    integer(rpc[key], `profile.projector.rpc.${key}`, key === "baseBackoffMs" ? 0 : 1);
  }
  if (
    rpc.providerCount !== 2 ||
    rpc.perCallTimeoutMs !== 5_000 ||
    rpc.maxAttemptsPerCall !== 3 ||
    rpc.baseBackoffMs !== 50 ||
    rpc.maxConcurrencyPerProvider !== 4
  ) {
    fail("profile.projector.rpc", "does not match the runtime RPC policy");
  }
  const firstAttempt = projectorCallsPerProviderPerAttempt(
    input,
    projector.smokeCandidateBatchSize,
  );
  const theoretical = projectorWorstCaseRetryContract(
    input,
    projector.maximumCandidateBatchSize,
  );
  const releaseFirstAttempt = projectorCallsPerProviderPerAttempt(
    input,
    projector.maximumCandidateBatchSize,
  );
  if (
    rpc.smokeFirstAttemptCallsPerProvider !== firstAttempt ||
    rpc.theoreticalWorstCaseCallsPerProvider !== theoretical.callsPerProvider ||
    rpc.theoreticalWorstCaseDurationMs !== theoretical.durationMs ||
    rpc.maxCallsPerProviderPerRun !==
      releaseFirstAttempt + rpc.globalRetryAllowancePerProvider ||
    rpc.maxAggregateCallsPerRun !==
      rpc.maxCallsPerProviderPerRun * rpc.providerCount ||
    theoretical.durationMs <= projector.hardDeadlineMs
  ) {
    fail("profile.projector.rpc", "call or retry math is inconsistent");
  }

  const providerLimits = exactKeys(
    input.providerLimits,
    ["envio"],
    "profile.providerLimits",
  );
  const envio = exactKeys(
    providerLimits.envio,
    ["planQueriesPerMinute", "steadyQueriesPerMinute", "burstQueriesPerMinute"],
    "profile.providerLimits.envio",
  );
  for (const key of Object.keys(envio)) {
    integer(envio[key], `profile.providerLimits.envio.${key}`, 1);
  }
  if (
    envio.steadyQueriesPerMinute * 2 > envio.planQueriesPerMinute ||
    envio.burstQueriesPerMinute * 4 > envio.planQueriesPerMinute * 3 ||
    envio.steadyQueriesPerMinute > envio.burstQueriesPerMinute
  ) {
    fail("profile.providerLimits.envio", "provider headroom is insufficient");
  }

  const shadow = exactKeys(
    input.shadow,
    [
      "requiredRoutes",
      "minimumSamples",
      "maximumP50Ms",
      "maximumP95Ms",
      "maximumP99Ms",
      "maximumLiveComparisonP50Ms",
      "maximumLiveComparisonP95Ms",
      "maximumLiveComparisonP99Ms",
      "maximumParityMismatches",
      "maximumFallbacks",
    ],
    "profile.shadow",
  );
  if (
    stringArray(shadow.requiredRoutes, "profile.shadow.requiredRoutes").join(",") !==
    SHADOW_ROUTES.join(",")
  ) {
    fail("profile.shadow.requiredRoutes", "must cover every indexed read route");
  }
  for (const key of [
    "minimumSamples",
    "maximumP50Ms",
    "maximumP95Ms",
    "maximumP99Ms",
    "maximumLiveComparisonP50Ms",
    "maximumLiveComparisonP95Ms",
    "maximumLiveComparisonP99Ms",
    "maximumParityMismatches",
    "maximumFallbacks",
  ]) {
    integer(shadow[key], `profile.shadow.${key}`, key === "minimumSamples" ? 1 : 0);
  }
  if (
    shadow.maximumP50Ms > shadow.maximumP95Ms ||
    shadow.maximumP95Ms > shadow.maximumP99Ms ||
    shadow.maximumLiveComparisonP50Ms >
      shadow.maximumLiveComparisonP95Ms ||
    shadow.maximumLiveComparisonP95Ms >
      shadow.maximumLiveComparisonP99Ms
  ) {
    fail("profile.shadow", "latency percentiles are not monotonic");
  }

  const cacheContracts = parseCacheContracts(
    input.cacheContracts,
    "profile.cacheContracts",
  );
  if (!sameRecord(cacheContracts, EXPECTED_CACHE_CONTRACTS, CACHE_KEYS)) {
    fail("profile.cacheContracts", "does not match the route cache contract");
  }
  return input;
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readArtifact(directory, descriptor, path) {
  const input = exactKeys(descriptor, ["file", "sha256"], path);
  const file = string(input.file, `${path}.file`);
  const digest = string(input.sha256, `${path}.sha256`);
  if (!ARTIFACT_FILE.test(file) || !HEX_DIGEST.test(digest)) {
    fail(path, "invalid artifact filename or digest");
  }
  const artifactPath = resolve(directory, file);
  if (dirname(artifactPath) !== directory) fail(path, "artifact escaped its bundle");
  const stats = lstatSync(artifactPath);
  if (!stats.isFile() || stats.size < 1 || stats.size > MAX_ARTIFACT_BYTES) {
    fail(path, "artifact size is outside the accepted range");
  }
  const bytes = readFileSync(artifactPath);
  const actualDigest = sha256Bytes(bytes);
  if (actualDigest !== digest) fail(path, "artifact digest mismatch");
  return { path: artifactPath, bytes, sha256: actualDigest };
}

function parseReleaseEvidence(value) {
  const input = exactKeys(
    value,
    [
      "schemaVersion",
      "profileId",
      "evidenceKind",
      "capturedAt",
      "captureNonce",
      "target",
      "artifacts",
      "evidenceSha256",
    ],
    "evidence",
  );
  assertReadModelReleaseEvidenceCommitment(input);
  if (input.schemaVersion !== 1) fail("evidence.schemaVersion", "expected 1");
  string(input.profileId, "evidence.profileId");
  string(input.evidenceKind, "evidence.evidenceKind");
  timestamp(input.capturedAt, "evidence.capturedAt");
  if (!HEX_BYTES32.test(string(input.captureNonce, "evidence.captureNonce"))) {
    fail("evidence.captureNonce", "expected a bytes32 nonce");
  }
  const target = exactKeys(
    input.target,
    ["url", "vercelDeploymentId", "gitHead"],
    "evidence.target",
  );
  const targetUrl = new URL(string(target.url, "evidence.target.url", 1_024));
  if (
    targetUrl.protocol !== "https:" ||
    targetUrl.username !== "" ||
    targetUrl.password !== "" ||
    targetUrl.search !== "" ||
    targetUrl.hash !== "" ||
    !targetUrl.hostname.endsWith(".vercel.app")
  ) {
    fail("evidence.target.url", "expected a deployment-specific Vercel URL");
  }
  if (!DEPLOYMENT_ID.test(string(target.vercelDeploymentId, "evidence.target.vercelDeploymentId"))) {
    fail("evidence.target.vercelDeploymentId", "invalid deployment id");
  }
  if (!GIT_SHA.test(string(target.gitHead, "evidence.target.gitHead"))) {
    fail("evidence.target.gitHead", "invalid Git commit");
  }
  exactKeys(input.artifacts, ARTIFACT_KEYS, "evidence.artifacts");
  return input;
}

function parseAddressList(value, path, expectedLength) {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    fail(path, `expected exactly ${expectedLength} addresses`);
  }
  const canonical = value.map((entry, index) => {
    const address = string(entry, `${path}[${index}]`);
    if (!HEX_ADDRESS.test(address)) {
      fail(`${path}[${index}]`, "expected an Ethereum address");
    }
    return address.toLowerCase();
  });
  if (new Set(canonical).size !== expectedLength) {
    fail(path, "addresses must be unique");
  }
  return canonical;
}

function parseLaunchSample(value, path) {
  const launch = exactKeys(value, ["account", "transactionHash"], path);
  const account = string(launch.account, `${path}.account`);
  const transactionHash = string(
    launch.transactionHash,
    `${path}.transactionHash`,
  );
  if (!HEX_ADDRESS.test(account) || !HEX_HASH.test(transactionHash)) {
    fail(path, "invalid launch key");
  }
  return `${account.toLowerCase()}:${transactionHash.toLowerCase()}`;
}

function parseDatasetManifest(value, profile) {
  const contract = PROFILE_CONTRACTS[profile.profileId];
  if (!contract) fail("datasetManifest.profileId", "unknown profile");
  const input = exactKeys(
    value,
    [
      "schemaVersion",
      "profileId",
      "generatedAt",
      "counts",
      "releaseCounts",
      "eligibleLaunches",
      "accountEvidence",
      "accessEvidence",
      "keys",
    ],
    "datasetManifest",
  );
  if (input.schemaVersion !== 1) fail("datasetManifest.schemaVersion", "expected 1");
  string(input.profileId, "datasetManifest.profileId");
  timestamp(input.generatedAt, "datasetManifest.generatedAt");
  const counts = parseDataset(input.counts, "datasetManifest.counts");
  const releaseCounts = exactKeys(
    input.releaseCounts,
    REQUIRED_RELEASE_VERSIONS,
    "datasetManifest.releaseCounts",
  );
  for (const releaseVersion of REQUIRED_RELEASE_VERSIONS) {
    integer(
      releaseCounts[releaseVersion],
      `datasetManifest.releaseCounts.${releaseVersion}`,
      1,
    );
  }
  if (
    REQUIRED_RELEASE_VERSIONS.reduce(
      (total, releaseVersion) => total + releaseCounts[releaseVersion],
      0,
    ) !== counts.launches
  ) {
    fail("datasetManifest.releaseCounts", "must sum to the eligible launch count");
  }
  if (!Array.isArray(input.eligibleLaunches)) {
    fail("datasetManifest.eligibleLaunches", "expected every eligible launch");
  }
  const eligibleLaunches = input.eligibleLaunches.map((value, index) => {
    const path = `datasetManifest.eligibleLaunches[${index}]`;
    const launch = exactKeys(
      value,
      ["account", "transactionHash", "tokenAddress", "releaseVersion"],
      path,
    );
    const account = string(launch.account, `${path}.account`);
    const transactionHash = string(
      launch.transactionHash,
      `${path}.transactionHash`,
    );
    const tokenAddress = string(launch.tokenAddress, `${path}.tokenAddress`);
    const releaseVersion = string(
      launch.releaseVersion,
      `${path}.releaseVersion`,
    );
    if (
      !HEX_ADDRESS.test(account) ||
      !HEX_HASH.test(transactionHash) ||
      !HEX_ADDRESS.test(tokenAddress) ||
      !REQUIRED_RELEASE_VERSIONS.includes(releaseVersion)
    ) {
      fail(path, "invalid eligible launch");
    }
    return {
      account: account.toLowerCase(),
      transactionHash: transactionHash.toLowerCase(),
      tokenAddress: tokenAddress.toLowerCase(),
      releaseVersion,
    };
  });
  if (eligibleLaunches.length !== counts.launches) {
    fail(
      "datasetManifest.eligibleLaunches",
      "must contain every counted eligible launch",
    );
  }
  if (
    new Set(eligibleLaunches.map((launch) => launch.transactionHash)).size !==
      eligibleLaunches.length ||
    new Set(eligibleLaunches.map((launch) => launch.tokenAddress)).size !==
      eligibleLaunches.length
  ) {
    fail("datasetManifest.eligibleLaunches", "token and transaction keys must be unique");
  }
  for (const releaseVersion of REQUIRED_RELEASE_VERSIONS) {
    if (
      eligibleLaunches.filter(
        (launch) => launch.releaseVersion === releaseVersion,
      ).length !== releaseCounts[releaseVersion]
    ) {
      fail(
        `datasetManifest.releaseCounts.${releaseVersion}`,
        "does not match the eligible launch records",
      );
    }
  }
  const keys = exactKeys(
    input.keys,
    [
      "tokenAddresses",
      "accountAddresses",
      "classicLaunches",
      "stockLaunches",
      "candidateIds",
    ],
    "datasetManifest.keys",
  );
  const tokenSamples = parseAddressList(
    keys.tokenAddresses,
    "datasetManifest.keys.tokenAddresses",
    contract.tokenKeyCount,
  );
  const accountSamples = parseAddressList(
    keys.accountAddresses,
    "datasetManifest.keys.accountAddresses",
    contract.accountKeyCount,
  );
  if (
    !Array.isArray(input.accountEvidence) ||
    input.accountEvidence.length !== contract.accountKeyCount
  ) {
    fail(
      "datasetManifest.accountEvidence",
      `expected exactly ${contract.accountKeyCount} attested accounts`,
    );
  }
  const accountEvidence = input.accountEvidence.map((value, index) => {
    const path = `datasetManifest.accountEvidence[${index}]`;
    const evidence = exactKeys(
      value,
      ["account", "profileRows", "rewardRows"],
      path,
    );
    const account = string(evidence.account, `${path}.account`).toLowerCase();
    if (!HEX_ADDRESS.test(account)) fail(`${path}.account`, "invalid address");
    const profileRows = integer(evidence.profileRows, `${path}.profileRows`);
    const rewardRows = integer(evidence.rewardRows, `${path}.rewardRows`);
    if (profileRows + rewardRows < 1) {
      fail(path, "account must have real profile or reward evidence");
    }
    return { account, profileRows, rewardRows };
  });
  const evidenceAccounts = accountEvidence.map((entry) => entry.account);
  if (
    new Set(evidenceAccounts).size !== contract.accountKeyCount ||
    accountSamples.some((account) => !evidenceAccounts.includes(account)) ||
    accountEvidence.reduce((total, entry) => total + entry.profileRows, 0) >
      counts.accounts ||
    accountEvidence.reduce((total, entry) => total + entry.rewardRows, 0) >
      counts.rewardRows
  ) {
    fail(
      "datasetManifest.accountEvidence",
      "must exactly attest the sampled real account corpus",
    );
  }
  const accessEvidence = exactKeys(
    input.accessEvidence,
    [
      "projectorSessionUser",
      "projectorCurrentRole",
      "projectorCurrentSettingRole",
      "apiReaderSessionUser",
      "apiReaderCurrentRole",
      "apiReaderCurrentSettingRole",
      "apiReaderDeniedSqlstate",
      "apiReaderFunctionExecute",
      "apiReaderViewSelect",
    ],
    "datasetManifest.accessEvidence",
  );
  for (const key of [
    "projectorSessionUser",
    "projectorCurrentRole",
    "projectorCurrentSettingRole",
    "apiReaderSessionUser",
    "apiReaderCurrentRole",
    "apiReaderCurrentSettingRole",
    "apiReaderDeniedSqlstate",
  ]) {
    string(accessEvidence[key], `datasetManifest.accessEvidence.${key}`);
  }
  if (
    accessEvidence.projectorSessionUser !== "programmable_projector_login" ||
    accessEvidence.projectorCurrentRole !== "programmable_projector" ||
    accessEvidence.projectorCurrentSettingRole !== "programmable_projector" ||
    accessEvidence.apiReaderSessionUser !== "programmable_api_reader_login" ||
    accessEvidence.apiReaderCurrentRole !== "programmable_api_reader" ||
    accessEvidence.apiReaderCurrentSettingRole !== "programmable_api_reader" ||
    accessEvidence.apiReaderDeniedSqlstate !== "42501" ||
    accessEvidence.apiReaderFunctionExecute !== false ||
    accessEvidence.apiReaderViewSelect !== false
  ) {
    fail(
      "datasetManifest.accessEvidence",
      "must prove projector-only corpus access and the API reader denial",
    );
  }
  const eligibleTokens = new Set(
    eligibleLaunches.map((launch) => launch.tokenAddress),
  );
  if (tokenSamples.some((token) => !eligibleTokens.has(token))) {
    fail("datasetManifest.keys.tokenAddresses", "contains a non-eligible token");
  }
  for (const key of ["classicLaunches", "stockLaunches"]) {
    if (!Array.isArray(keys[key]) || keys[key].length !== 32) {
      fail(`datasetManifest.keys.${key}`, "expected exactly 32 launch keys");
    }
    const canonical = keys[key].map((entry, index) =>
      parseLaunchSample(entry, `datasetManifest.keys.${key}[${index}]`),
    );
    if (new Set(canonical).size !== 32) {
      fail(`datasetManifest.keys.${key}`, "launch keys must be unique");
    }
    const allowedRelease = (releaseVersion) =>
      key === "classicLaunches"
        ? releaseVersion === "classic-v3"
        : releaseVersion.startsWith("stock-paired-");
    const eligibleIdentities = new Set(
      eligibleLaunches
        .filter((launch) => allowedRelease(launch.releaseVersion))
        .map(
          (launch) => `${launch.account}:${launch.transactionHash}`,
        ),
    );
    if (canonical.some((identity) => !eligibleIdentities.has(identity))) {
      fail(`datasetManifest.keys.${key}`, "contains a non-eligible launch");
    }
  }
  if (
    !Array.isArray(keys.candidateIds) ||
    keys.candidateIds.length !== contract.candidateCount
  ) {
    fail(
      "datasetManifest.keys.candidateIds",
      `expected exactly ${contract.candidateCount} candidate keys`,
    );
  }
  const candidateIds = keys.candidateIds.map((candidateId, index) =>
    string(candidateId, `datasetManifest.keys.candidateIds[${index}]`),
  );
  if (
    candidateIds.some((candidateId) => !CANDIDATE_ID.test(candidateId)) ||
    new Set(candidateIds).size !== contract.candidateCount
  ) {
    fail(
      "datasetManifest.keys.candidateIds",
      "candidate keys must be unique canonical mainnet candidate ids",
    );
  }
  return input;
}

function parseHttpSample(value, index) {
  const path = `httpSamples[${index}]`;
  const input = exactKeys(
    value,
    [
      "route",
      "requestKey",
      "datasetKey",
      "keyMatched",
      "startedAtMs",
      "completedAtMs",
      "durationMs",
      "status",
      "cacheControl",
      "vercelCache",
      "bodySha256",
      "bodyBytes",
      "shadowOverheadMs",
      "parity",
      "readSource",
      "fallback",
    ],
    path,
  );
  if (!ROUTE_NAMES.includes(input.route)) fail(`${path}.route`, "unknown route");
  string(input.requestKey, `${path}.requestKey`);
  const datasetKey = string(input.datasetKey, `${path}.datasetKey`);
  const launchRoute =
    input.route === "classicLaunchLookup" ||
    input.route === "stockLaunchLookup";
  if (
    (input.route === "health" && datasetKey !== "health") ||
    (launchRoute && !HEX_HASH.test(datasetKey)) ||
    (input.route !== "health" && !launchRoute && !HEX_ADDRESS.test(datasetKey))
  ) {
    fail(`${path}.datasetKey`, "does not match the route key contract");
  }
  if (typeof input.keyMatched !== "boolean") {
    fail(`${path}.keyMatched`, "expected a measured boolean");
  }
  integer(input.startedAtMs, `${path}.startedAtMs`, 1);
  integer(input.completedAtMs, `${path}.completedAtMs`, 1);
  integer(input.durationMs, `${path}.durationMs`);
  integer(input.status, `${path}.status`, 100);
  string(input.cacheControl, `${path}.cacheControl`);
  string(input.vercelCache, `${path}.vercelCache`);
  if (!HEX_DIGEST.test(string(input.bodySha256, `${path}.bodySha256`))) {
    fail(`${path}.bodySha256`, "invalid response digest");
  }
  integer(input.bodyBytes, `${path}.bodyBytes`);
  if (input.completedAtMs - input.startedAtMs !== input.durationMs) {
    fail(`${path}.durationMs`, "does not match the measured interval");
  }
  const shadowRequired = SHADOW_ROUTES.includes(input.route);
  if (shadowRequired) {
    integer(input.shadowOverheadMs, `${path}.shadowOverheadMs`);
    if (input.shadowOverheadMs > input.durationMs) {
      fail(`${path}.shadowOverheadMs`, "cannot exceed total request duration");
    }
    if (
      input.parity !== "match" &&
      input.parity !== "mismatch" &&
      input.parity !== "incomparable"
    ) {
      fail(`${path}.parity`, "missing raw parity result");
    }
    if (
      input.readSource !== "rpc" &&
      input.readSource !== "blob" &&
      input.readSource !== "indexed"
    ) {
      fail(`${path}.readSource`, "missing selected read source");
    }
    if (typeof input.fallback !== "boolean") {
      fail(`${path}.fallback`, "missing raw fallback result");
    }
  } else if (
    input.shadowOverheadMs !== null ||
    input.parity !== "not-observed" ||
    input.readSource !== "not-observed" ||
    input.fallback !== null
  ) {
    fail(path, "non-shadow samples must not fabricate shadow measurements");
  }
  return input;
}

function parseJsonLines(bytes, path) {
  const text = bytes.toString("utf8");
  if (text.endsWith("\n") === false) fail(path, "must end with a newline");
  const lines = text.slice(0, -1).split("\n");
  if (lines.some((line) => line.length < 2)) fail(path, "contains an empty line");
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      fail(`${path}[${index}]`, "invalid JSON line");
    }
  });
}

function parseRpcTrace(value, profile) {
  const contract = PROFILE_CONTRACTS[profile.profileId];
  if (!contract) fail("rpcTrace.profileId", "unknown profile");
  const input = exactKeys(
    value,
    [
      "schemaVersion",
      "profileId",
      "gitHead",
      "targetUrl",
      "vercelDeploymentId",
      "captureNonce",
      "startedAtMs",
      "completedAtMs",
      "candidateBatchSize",
      "hardDeadlineMs",
      "maxCallsPerProvider",
      "elapsedMs",
      "providerCallCounts",
      "candidateEvidence",
      "calls",
    ],
    "rpcTrace",
  );
  if (input.schemaVersion !== 1) fail("rpcTrace.schemaVersion", "expected 1");
  string(input.profileId, "rpcTrace.profileId");
  if (!GIT_SHA.test(string(input.gitHead, "rpcTrace.gitHead"))) {
    fail("rpcTrace.gitHead", "invalid Git commit");
  }
  string(input.targetUrl, "rpcTrace.targetUrl", 1_024);
  string(input.vercelDeploymentId, "rpcTrace.vercelDeploymentId");
  if (!HEX_BYTES32.test(string(input.captureNonce, "rpcTrace.captureNonce"))) {
    fail("rpcTrace.captureNonce", "expected a bytes32 nonce");
  }
  integer(input.startedAtMs, "rpcTrace.startedAtMs", 1);
  integer(input.completedAtMs, "rpcTrace.completedAtMs", 1);
  integer(input.candidateBatchSize, "rpcTrace.candidateBatchSize", 1);
  integer(input.hardDeadlineMs, "rpcTrace.hardDeadlineMs", 1);
  integer(input.maxCallsPerProvider, "rpcTrace.maxCallsPerProvider", 1);
  integer(input.elapsedMs, "rpcTrace.elapsedMs");
  if (
    input.completedAtMs < input.startedAtMs ||
    input.completedAtMs - input.startedAtMs !== input.elapsedMs
  ) {
    fail("rpcTrace.elapsedMs", "does not match the measured runtime interval");
  }
  if (!Array.isArray(input.providerCallCounts) || input.providerCallCounts.length !== 2) {
    fail("rpcTrace.providerCallCounts", "expected exactly two provider counts");
  }
  input.providerCallCounts.forEach((count, index) =>
    integer(count, `rpcTrace.providerCallCounts[${index}]`, 1),
  );
  if (
    !Array.isArray(input.candidateEvidence) ||
    input.candidateEvidence.length !== contract.candidateCount
  ) {
    fail(
      "rpcTrace.candidateEvidence",
      `expected exactly ${contract.candidateCount} verified candidates`,
    );
  }
  const candidateEvidence = input.candidateEvidence.map((value, index) => {
    const path = `rpcTrace.candidateEvidence[${index}]`;
    const candidate = exactKeys(
      value,
      [
        "candidateId",
        "candidateBlockNumber",
        "candidateBlockHash",
        "transactionHash",
        "sourceAddress",
      ],
      path,
    );
    const candidateId = string(candidate.candidateId, `${path}.candidateId`);
    const idMatch = CANDIDATE_ID.exec(candidateId);
    const candidateBlockNumber = string(
      candidate.candidateBlockNumber,
      `${path}.candidateBlockNumber`,
    );
    const candidateBlockHash = string(
      candidate.candidateBlockHash,
      `${path}.candidateBlockHash`,
    ).toLowerCase();
    const transactionHash = string(
      candidate.transactionHash,
      `${path}.transactionHash`,
    ).toLowerCase();
    const sourceAddress = string(
      candidate.sourceAddress,
      `${path}.sourceAddress`,
    ).toLowerCase();
    if (
      idMatch === null ||
      !/^(0|[1-9][0-9]*)$/u.test(candidateBlockNumber) ||
      !HEX_HASH.test(candidateBlockHash) ||
      !HEX_HASH.test(transactionHash) ||
      !HEX_ADDRESS.test(sourceAddress) ||
      idMatch[1].toLowerCase() !== candidateBlockHash ||
      idMatch[2].toLowerCase() !== transactionHash
    ) {
      fail(path, "invalid or internally inconsistent candidate evidence");
    }
    return {
      candidateId,
      candidateBlockNumber,
      candidateBlockHash,
      transactionHash,
      sourceAddress,
    };
  });
  const candidateBlockNumbers = candidateEvidence.map((candidate) =>
    BigInt(candidate.candidateBlockNumber),
  );
  if (
    new Set(candidateEvidence.map((candidate) => candidate.candidateId)).size !==
      contract.candidateCount ||
    new Set(candidateEvidence.map((candidate) => candidate.candidateBlockNumber))
      .size !== contract.candidateCount ||
    new Set(candidateEvidence.map((candidate) => candidate.transactionHash)).size !==
      contract.candidateCount ||
    new Set(
      candidateEvidence.map(
        (candidate) =>
          `${candidate.candidateBlockNumber}:${candidate.sourceAddress}`,
      ),
    ).size !== contract.candidateCount ||
    candidateBlockNumbers.some(
      (blockNumber, index) =>
        index > 0 && blockNumber <= candidateBlockNumbers[index - 1],
    )
  ) {
    fail(
      "rpcTrace.candidateEvidence",
      "candidates must cover strictly ordered unique blocks, transactions and block/source pairs",
    );
  }
  if (!Array.isArray(input.calls) || input.calls.length < 1) {
    fail("rpcTrace.calls", "expected raw call traces");
  }
  for (const [index, value] of input.calls.entries()) {
    const call = exactKeys(
      value,
      [
        "providerIdentity",
        "providerVendorGroup",
        "providerEndpointCommitment",
        "providerOriginCommitment",
        "operation",
        "attempt",
        "startedOffsetMs",
        "durationMs",
        "outcome",
      ],
      `rpcTrace.calls[${index}]`,
    );
    string(call.providerIdentity, `rpcTrace.calls[${index}].providerIdentity`);
    string(call.providerVendorGroup, `rpcTrace.calls[${index}].providerVendorGroup`);
    if (
      !HEX_BYTES32.test(call.providerEndpointCommitment) ||
      !HEX_BYTES32.test(call.providerOriginCommitment)
    ) {
      fail(`rpcTrace.calls[${index}]`, "invalid provider commitment");
    }
    if (!RPC_OPERATIONS.has(call.operation)) {
      fail(`rpcTrace.calls[${index}].operation`, "unknown RPC operation");
    }
    integer(call.attempt, `rpcTrace.calls[${index}].attempt`, 1);
    integer(call.startedOffsetMs, `rpcTrace.calls[${index}].startedOffsetMs`);
    integer(call.durationMs, `rpcTrace.calls[${index}].durationMs`);
    if (call.outcome !== "success" && call.outcome !== "error") {
      fail(`rpcTrace.calls[${index}].outcome`, "invalid call outcome");
    }
  }
  return input;
}

export function loadReadModelReleaseEvidence(input) {
  const profile = parseReadModelLoadProfile(input.profile);
  const evidencePath = resolve(input.evidencePath);
  const evidence = parseReleaseEvidence(
    JSON.parse(readFileSync(evidencePath, "utf8")),
  );
  const directory = dirname(evidencePath);
  const artifactFilenames = ARTIFACT_KEYS.map(
    (key) => evidence.artifacts[key].file,
  );
  if (new Set(artifactFilenames).size !== ARTIFACT_KEYS.length) {
    fail("evidence.artifacts", "artifact filenames must be unique");
  }
  const artifacts = {};
  for (const key of ARTIFACT_KEYS) {
    artifacts[key] = readArtifact(
      directory,
      evidence.artifacts[key],
      `evidence.artifacts.${key}`,
    );
  }
  const datasetManifest = parseDatasetManifest(
    JSON.parse(artifacts.datasetManifest.bytes.toString("utf8")),
    profile,
  );
  const httpSamples = parseJsonLines(
    artifacts.httpSamples.bytes,
    "httpSamples",
  ).map(parseHttpSample);
  const rpcTrace = parseRpcTrace(
    JSON.parse(artifacts.rpcTrace.bytes.toString("utf8")),
    profile,
  );
  return {
    profile,
    evidence,
    artifacts,
    datasetManifest,
    httpSamples,
    rpcTrace,
  };
}

export function percentile(values, percentileValue) {
  if (!Array.isArray(values) || values.length < 1) {
    fail("percentile", "requires at least one sample");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.ceil((percentileValue / 100) * sorted.length) - 1,
  );
  return sorted[index];
}

function observedMaximumConcurrency(samples) {
  const events = samples.flatMap((sample) => [
    [sample.startedAtMs, 1],
    [sample.completedAtMs, -1],
  ]);
  events.sort((left, right) => left[0] - right[0] || right[1] - left[1]);
  let active = 0;
  let maximum = 0;
  for (const [, delta] of events) {
    active += delta;
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

export function evaluateReadModelReleaseEvidence(bundle, input) {
  const { profile, evidence, datasetManifest, httpSamples, rpcTrace } = bundle;
  const releaseProfile = profile.profileId === RELEASE_PROFILE_ID;
  const requiredCandidateBatchSize = releaseProfile
    ? profile.projector.maximumCandidateBatchSize
    : profile.projector.smokeCandidateBatchSize;
  const checks = [];
  const failures = [];
  const check = (id, condition, detail) => {
    checks.push({ id, status: condition ? "pass" : "fail", detail });
    if (!condition) failures.push({ id, detail });
  };
  const nowMs = input.nowMs ?? Date.now();
  const capturedAtMs = Date.parse(evidence.capturedAt);
  const evidenceAgeMs = nowMs - capturedAtMs;
  const datasetGeneratedAtMs = Date.parse(datasetManifest.generatedAt);
  const eligibleClassicLookupLaunches = datasetManifest.eligibleLaunches.filter(
    (launch) => launch.releaseVersion === "classic-v3",
  );
  const eligibleStockLaunches = datasetManifest.eligibleLaunches.filter(
    (launch) => launch.releaseVersion.startsWith("stock-paired-"),
  );
  const eligibleAccounts = new Set(
    datasetManifest.eligibleLaunches.map((launch) => launch.account),
  );
  const coverage = profile.datasetCoverage;
  const ratioCountsValid =
    datasetManifest.counts.chainEvents >=
      datasetManifest.counts.launches *
        coverage.minimumRowsPerLaunch.chainEvents &&
    datasetManifest.counts.marketSnapshots >=
      datasetManifest.counts.launches *
        coverage.minimumRowsPerLaunch.marketSnapshots &&
    datasetManifest.counts.marketCandles >=
      datasetManifest.counts.launches *
        coverage.minimumRowsPerLaunch.marketCandles &&
    datasetManifest.counts.rewardRows >=
      datasetManifest.counts.launches *
        coverage.minimumRowsPerLaunch.rewardRows;
  const exactBinding =
    evidence.profileId === profile.profileId &&
    datasetManifest.profileId === profile.profileId &&
    rpcTrace.profileId === profile.profileId &&
    evidence.target.gitHead === input.gitHead &&
    rpcTrace.gitHead === input.gitHead &&
    rpcTrace.captureNonce === evidence.captureNonce &&
    rpcTrace.targetUrl === evidence.target.url &&
    rpcTrace.vercelDeploymentId === evidence.target.vercelDeploymentId;
  check("exact-binding", exactBinding, "profile, commit, target and trace binding are exact");
  check(
    "evidence-kind",
    profile.evidence.requiredKinds.includes(evidence.evidenceKind),
    "only preview or production-canary evidence is accepted",
  );
  check(
    "freshness",
    evidenceAgeMs >= 0 &&
      evidenceAgeMs <= profile.evidence.maximumAgeSeconds * 1_000,
    `evidence age is ${Math.max(0, Math.floor(evidenceAgeMs / 1_000))} seconds`,
  );
  check(
    "dataset-cardinality",
    datasetManifest.counts.launches >= coverage.minimumEligibleLaunches &&
      datasetManifest.counts.launches <= coverage.maximumEligibleLaunches &&
      datasetManifest.eligibleLaunches.length ===
        datasetManifest.counts.launches &&
      coverage.requiredReleaseVersions.every(
        (releaseVersion) => datasetManifest.releaseCounts[releaseVersion] > 0,
      ) &&
      eligibleClassicLookupLaunches.length >=
        coverage.minimumClassicLookupLaunches &&
      eligibleClassicLookupLaunches.length <=
        coverage.maximumClassicLookupLaunches &&
      eligibleStockLaunches.length >=
        coverage.minimumStockLookupLaunches &&
      eligibleStockLaunches.length <= coverage.maximumStockLookupLaunches,
    `${datasetManifest.eligibleLaunches.length} unique eligible launches across exactly five releases`,
  );
  check(
    "dataset-row-coverage",
    atLeastRecord(datasetManifest.counts, profile.dataset, DATASET_KEYS) &&
      ratioCountsValid &&
      datasetManifest.counts.accounts >= eligibleAccounts.size,
    "projection rows and real accounts meet the ratio-bound corpus floor",
  );
  check(
    "deterministic-real-samples",
    datasetManifest.keys.tokenAddresses.length === coverage.tokenSampleCount &&
      datasetManifest.keys.accountAddresses.length ===
        coverage.accountSampleCount &&
      datasetManifest.keys.classicLaunches.length ===
        coverage.classicLaunchSampleCount &&
      datasetManifest.keys.stockLaunches.length ===
        coverage.stockLaunchSampleCount &&
      datasetManifest.keys.candidateIds.length ===
        coverage.candidateSampleCount,
    `${coverage.tokenSampleCount} token, ${coverage.accountSampleCount} account, ${coverage.classicLaunchSampleCount} Classic, ${coverage.stockLaunchSampleCount} Stock and ${coverage.candidateSampleCount} candidate keys`,
  );
  check(
    "release-corpus-cycles",
    !releaseProfile ||
      (datasetManifest.eligibleLaunches.length >= 264 &&
        Math.ceil(
          datasetManifest.keys.tokenAddresses.length /
            profile.projector.maximumCandidateBatchSize,
        ) >= 9),
    releaseProfile
      ? `${datasetManifest.keys.tokenAddresses.length} real launch tokens require at least nine 32-row cycles`
      : "smoke profile keeps corpus-cycle enforcement disabled",
  );
  check(
    "projector-only-corpus",
    datasetManifest.accessEvidence.projectorSessionUser ===
      "programmable_projector_login" &&
      datasetManifest.accessEvidence.projectorCurrentRole ===
        "programmable_projector" &&
      datasetManifest.accessEvidence.projectorCurrentSettingRole ===
        "programmable_projector" &&
      datasetManifest.accessEvidence.apiReaderSessionUser ===
        "programmable_api_reader_login" &&
      datasetManifest.accessEvidence.apiReaderCurrentRole ===
        "programmable_api_reader" &&
      datasetManifest.accessEvidence.apiReaderCurrentSettingRole ===
        "programmable_api_reader" &&
      datasetManifest.accessEvidence.apiReaderDeniedSqlstate === "42501" &&
      datasetManifest.accessEvidence.apiReaderFunctionExecute === false &&
      datasetManifest.accessEvidence.apiReaderViewSelect === false,
    "the projector login can capture the corpus and the public API reader cannot execute or select it",
  );
  check(
    "dataset-freshness",
    datasetGeneratedAtMs <= capturedAtMs &&
      capturedAtMs - datasetGeneratedAtMs <=
        profile.evidence.maximumAgeSeconds * 1_000,
    "dataset counts were captured within the release evidence window",
  );
  check(
    "rpc-trace-freshness",
    rpcTrace.startedAtMs <= rpcTrace.completedAtMs &&
      rpcTrace.completedAtMs <= capturedAtMs &&
      capturedAtMs - rpcTrace.completedAtMs <=
        profile.evidence.maximumAgeSeconds * 1_000,
    "the raw projector run completed within the release evidence window",
  );

  const completed = httpSamples.length;
  const errors = httpSamples.filter(
    (sample) => sample.status < 200 || sample.status >= 300,
  ).length;
  const errorRateBps = completed > 0 ? Math.ceil((errors * 10_000) / completed) : 10_000;
  const firstStart = Math.min(...httpSamples.map((sample) => sample.startedAtMs));
  const lastCompletion = Math.max(
    ...httpSamples.map((sample) => sample.completedAtMs),
  );
  const maximumConcurrency = observedMaximumConcurrency(httpSamples);
  const cacheHits = httpSamples.filter((sample) =>
    ["HIT", "STALE"].includes(sample.vercelCache),
  ).length;
  const cacheHitRateBps = completed
    ? Math.ceil((cacheHits * 10_000) / completed)
    : 10_000;
  const distinctTokenKeys = new Set(
    httpSamples
      .filter((sample) =>
        ["exploreList", "tokenDetail", "tokenChart", "publicIndexer"].includes(
          sample.route,
        ),
      )
      .map((sample) => sample.datasetKey.toLowerCase()),
  ).size;
  const distinctAccountKeys = new Set(
    httpSamples
      .filter((sample) =>
        ["creatorProfile", "classicProfile", "stockProfile"].includes(
          sample.route,
        ),
      )
      .map((sample) => sample.datasetKey.toLowerCase()),
  ).size;
  const distinctClassicLaunchKeys = new Set(
    httpSamples
      .filter((sample) => sample.route === "classicLaunchLookup")
      .map((sample) => sample.datasetKey.toLowerCase()),
  ).size;
  const distinctStockLaunchKeys = new Set(
    httpSamples
      .filter((sample) => sample.route === "stockLaunchLookup")
      .map((sample) => sample.datasetKey.toLowerCase()),
  ).size;
  check(
    "throughput-shape",
    completed >= profile.load.minimumCompletedRequests &&
      lastCompletion - firstStart >= profile.load.durationSeconds * 1_000 &&
      maximumConcurrency >= profile.load.concurrency,
    `${completed} requests over ${lastCompletion - firstStart}ms at observed concurrency ${maximumConcurrency}`,
  );
  check(
    "throughput-errors",
    errorRateBps <= profile.load.maximumErrorRateBps,
    `${errors} failed requests, ${errorRateBps} error basis points`,
  );
  check(
    "throughput-cache-and-identity",
    new Set(httpSamples.map((sample) => sample.requestKey)).size === completed &&
      httpSamples.every((sample) =>
        profile.load.requiredVercelCacheStatuses.includes(sample.vercelCache),
      ) &&
      cacheHitRateBps <= profile.load.maximumCacheHitRateBps &&
      httpSamples.every((sample) => sample.keyMatched === true),
    `${completed} unique origin requests with ${cacheHitRateBps} cache-hit basis points and exact response identities`,
  );
  check(
    "throughput-key-distribution",
    distinctTokenKeys === profile.load.minimumDistinctTokenKeys &&
      distinctTokenKeys === datasetManifest.keys.tokenAddresses.length &&
      distinctAccountKeys === profile.load.minimumDistinctAccountKeys &&
      distinctAccountKeys === datasetManifest.keys.accountAddresses.length &&
      distinctClassicLaunchKeys ===
        profile.load.minimumDistinctClassicLaunchKeys &&
      distinctClassicLaunchKeys ===
        datasetManifest.keys.classicLaunches.length &&
      distinctStockLaunchKeys ===
        profile.load.minimumDistinctStockLaunchKeys &&
      distinctStockLaunchKeys === datasetManifest.keys.stockLaunches.length,
    `${distinctTokenKeys} token, ${distinctAccountKeys} account, ${distinctClassicLaunchKeys} Classic and ${distinctStockLaunchKeys} Stock keys were repeatedly exercised`,
  );
  check(
    "http-capture-freshness",
    firstStart >= rpcTrace.completedAtMs && lastCompletion <= capturedAtMs,
    "HTTP load ran after the runtime trace and before the evidence manifest",
  );

  for (const route of ROUTE_NAMES) {
    const routeSamples = httpSamples.filter((sample) => sample.route === route);
    const exactMix =
      routeSamples.length * 10_000 ===
      completed * profile.load.routeMixBps[route];
    check(
      `route-mix-${route}`,
      exactMix,
      `${routeSamples.length}/${completed} samples`,
    );
    const selectedPathDurations = routeSamples.map((sample) =>
      profile.shadow.requiredRoutes.includes(route)
        ? sample.durationMs - sample.shadowOverheadMs
        : sample.durationMs,
    );
    const p95 = routeSamples.length
      ? percentile(selectedPathDurations, 95)
      : Number.POSITIVE_INFINITY;
    const p99 = routeSamples.length
      ? percentile(selectedPathDurations, 99)
      : Number.POSITIVE_INFINITY;
    check(
      `route-latency-p95-${route}`,
      p95 <= profile.load.maximumRouteP95Ms[route],
      `${route} p95 is ${p95}ms`,
    );
    check(
      `route-latency-p99-${route}`,
      p99 <= profile.load.maximumRouteP99Ms[route],
      `${route} p99 is ${p99}ms`,
    );
    check(
      `route-cache-${route}`,
      routeSamples.length > 0 &&
        routeSamples.every(
          (sample) =>
            sample.cacheControl ===
            (profile.shadow.requiredRoutes.includes(route)
              ? profile.load.probeCacheControl
              : profile.cacheContracts[route]),
        ),
      `${route} raw cache headers match the probe contract`,
    );
  }

  const shadowSamples = httpSamples.filter((sample) =>
    profile.shadow.requiredRoutes.includes(sample.route),
  );
  const indexedComparisonDurations = shadowSamples
    .filter(
      (sample) => sample.readSource === "rpc" || sample.readSource === "blob",
    )
    .map((sample) => sample.shadowOverheadMs);
  const liveComparisonDurations = shadowSamples
    .filter((sample) => sample.readSource === "indexed")
    .map((sample) => sample.shadowOverheadMs);
  const parityMismatches = shadowSamples.filter(
    (sample) => sample.parity !== "match",
  ).length;
  const fallbacks = shadowSamples.filter((sample) => sample.fallback === true).length;
  const measuredPercentiles = (values) =>
    values.length > 0
      ? {
          p50: percentile(values, 50),
          p95: percentile(values, 95),
          p99: percentile(values, 99),
        }
      : { p50: 0, p95: 0, p99: 0 };
  const indexedComparison = measuredPercentiles(indexedComparisonDurations);
  const liveComparison = measuredPercentiles(liveComparisonDurations);
  check(
    "shadow-overhead",
    shadowSamples.length >= profile.shadow.minimumSamples &&
      indexedComparison.p50 <= profile.shadow.maximumP50Ms &&
      indexedComparison.p95 <= profile.shadow.maximumP95Ms &&
      indexedComparison.p99 <= profile.shadow.maximumP99Ms &&
      liveComparison.p50 <=
        profile.shadow.maximumLiveComparisonP50Ms &&
      liveComparison.p95 <=
        profile.shadow.maximumLiveComparisonP95Ms &&
      liveComparison.p99 <= profile.shadow.maximumLiveComparisonP99Ms,
    `indexed-comparison p50/p95/p99 ${indexedComparison.p50}/${indexedComparison.p95}/${indexedComparison.p99}ms; live-comparison ${liveComparison.p50}/${liveComparison.p95}/${liveComparison.p99}ms across ${shadowSamples.length} samples`,
  );
  check(
    "shadow-parity",
    parityMismatches <= profile.shadow.maximumParityMismatches &&
      shadowSamples.every((sample) => sample.parity === "match"),
    `${parityMismatches} parity mismatches`,
  );
  check(
    "live-fallbacks",
    fallbacks <= profile.shadow.maximumFallbacks &&
      shadowSamples.every((sample) => sample.fallback === false),
    `${fallbacks} live fallbacks`,
  );

  check(
    "projector-runtime-policy",
    rpcTrace.candidateBatchSize === requiredCandidateBatchSize &&
      rpcTrace.candidateEvidence.length === rpcTrace.candidateBatchSize &&
      rpcTrace.candidateEvidence.every(
        (candidate, index) =>
          candidate.candidateId === datasetManifest.keys.candidateIds[index],
      ) &&
      rpcTrace.hardDeadlineMs === profile.projector.hardDeadlineMs &&
      rpcTrace.maxCallsPerProvider ===
        profile.projector.rpc.maxCallsPerProviderPerRun &&
      rpcTrace.elapsedMs <= profile.projector.hardDeadlineMs,
    "raw projector trace uses the enforced batch, deadline and call budget",
  );
  const expectedProviders = input.expectedProviders;
  const expectedProviderCommitments = new Set(
    expectedProviders.map((provider) => provider.endpointCommitment),
  );
  const observedProviderOrigins = [];
  const providerTraceChecks = expectedProviders.map((expected, providerIndex) => {
    const calls = rpcTrace.calls.filter(
      (call) => call.providerVendorGroup === expected.vendorGroup,
    );
    const successfulOperationCounts = Object.fromEntries(
      [...RPC_OPERATIONS].map((operation) => [
        operation,
        calls.filter(
          (call) => call.operation === operation && call.outcome === "success",
        ).length,
      ]),
    );
    const origins = new Set(
      calls.map((call) => call.providerOriginCommitment),
    );
    observedProviderOrigins.push(...origins);
    return (
      calls.length === rpcTrace.providerCallCounts[providerIndex] &&
      calls.length <= profile.projector.rpc.maxCallsPerProviderPerRun &&
      calls.every(
        (call) =>
          call.providerIdentity === expected.identity &&
          call.providerEndpointCommitment === expected.endpointCommitment &&
          call.attempt <= profile.projector.rpc.maxAttemptsPerCall &&
          call.startedOffsetMs + call.durationMs <=
            rpcTrace.elapsedMs,
      ) &&
      successfulOperationCounts.getChainId === 1 &&
      successfulOperationCounts.getBlockNumber === 1 &&
      successfulOperationCounts.getBlock === requiredCandidateBatchSize + 1 &&
      successfulOperationCounts.getTransactionReceipt ===
        requiredCandidateBatchSize &&
      successfulOperationCounts.getBytecode === requiredCandidateBatchSize
    );
  });
  const aggregateCalls = rpcTrace.providerCallCounts.reduce(
    (total, count) => total + count,
    0,
  );
  check(
    "rpc-provider-trace",
    expectedProviders.length === 2 &&
      expectedProviderCommitments.size === 2 &&
      observedProviderOrigins.length === 2 &&
      new Set(observedProviderOrigins).size === 2 &&
      providerTraceChecks.every(Boolean) &&
      rpcTrace.calls.length === aggregateCalls &&
      aggregateCalls <= profile.projector.rpc.maxAggregateCallsPerRun,
    `${aggregateCalls} raw calls bound to exact Alchemy and QuickNode commitments`,
  );

  return {
    schemaVersion: 1,
    profileId: profile.profileId,
    mode: "release",
    releaseEvidenceAccepted: failures.length === 0,
    checks,
    failures,
    artifactDigests: Object.fromEntries(
      ARTIFACT_KEYS.map((key) => [key, bundle.artifacts[key].sha256]),
    ),
  };
}
