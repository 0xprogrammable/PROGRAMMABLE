#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  evaluateReadModelReleaseEvidence,
  loadReadModelReleaseEvidence,
  parseReadModelLoadProfile,
  sha256Bytes,
} from "./read-model-gate-core.mjs";
import {
  commitExploreMatrixCase,
  commitExploreMatrixPage,
  EXPLORE_MATRIX_CLAMP_PAGE,
  EXPLORE_MATRIX_MANIFEST_FILE,
  EXPLORE_MATRIX_MAX_QUERY_CASES_PER_KIND,
  EXPLORE_MATRIX_PAGE_SIZE,
  EXPLORE_MATRIX_PAGES_FILE,
  EXPLORE_MATRIX_SORTS,
  exploreMatrixCorpusCommitment,
  normalizeExploreMatrixQuery,
  sha256Canonical,
} from "./read-model-capture.mjs";
import {
  verifyLiveCacheAndKeyContracts,
  verifyLiveRollbackTarget,
  verifyLiveVercelBinding,
} from "./read-model-live-verifier.mjs";
import { expectedProductionProviderBindings } from "./read-model-provider-binding.mjs";
import { evaluateReadModelSourceContracts } from "./read-model-source-contracts.mjs";

function parseArguments(argv) {
  let evidencePath;
  let requireReleaseEvidence = false;
  let ifPresent = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--evidence") {
      evidencePath = argv[index + 1];
      if (!evidencePath || evidencePath.startsWith("--")) {
        throw new Error("--evidence requires a bundle path");
      }
      index += 1;
      continue;
    }
    if (argument === "--require-release-evidence") {
      requireReleaseEvidence = true;
      continue;
    }
    if (argument === "--if-present") {
      ifPresent = true;
      continue;
    }
    throw new Error(`unsupported argument: ${argument}`);
  }
  if (!requireReleaseEvidence) {
    throw new Error("the gate only accepts --require-release-evidence mode");
  }
  return { evidencePath, ifPresent };
}

function output(value, exitCode) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = exitCode;
}

const HEX_ADDRESS = /^0x[0-9a-f]{40}$/u;
const HEX_HASH = /^0x[0-9a-f]{64}$/u;
const HEX_DIGEST = /^[0-9a-f]{64}$/u;
const PROBE_NONCE = /^[1-9]\d{12}-[0-9a-f]{64}-(?:0|[1-9]\d{0,9})$/u;
const MATRIX_MAXIMUM_BYTES = 32 * 1024 * 1024;
const RELEASE_VERSIONS = Object.freeze([
  "classic-v2",
  "classic-v3",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
]);

function matrixObject(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path}: expected an object`);
  }
  return value;
}

function matrixExact(value, keys, path) {
  const input = matrixObject(value, path);
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${path}: unexpected shape`);
  }
  return input;
}

function matrixString(value, path, maximum = 512) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum
  ) {
    throw new Error(`${path}: expected a bounded non-empty string`);
  }
  return value;
}

function matrixInteger(value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${path}: expected a safe integer >= ${minimum}`);
  }
  return value;
}

function matrixDigest(value, path) {
  if (!HEX_DIGEST.test(matrixString(value, path, 64))) {
    throw new Error(`${path}: expected a sha256 digest`);
  }
  return value;
}

function parseMatrixCase(value, index) {
  const path = `exploreMatrix.cases[${index}]`;
  const input = matrixExact(
    value,
    [
      "caseId",
      "kind",
      "query",
      "normalizedQuery",
      "sourceTokenAddress",
      "sourceReleaseVersion",
      "commitment",
    ],
    path,
  );
  matrixString(input.caseId, `${path}.caseId`, 128);
  if (!["empty", "name", "symbol", "address"].includes(input.kind)) {
    throw new Error(`${path}.kind: unsupported case kind`);
  }
  if (typeof input.query !== "string" || input.query.length > 256) {
    throw new Error(`${path}.query: expected a bounded string`);
  }
  if (
    typeof input.normalizedQuery !== "string" ||
    input.normalizedQuery.length > 128
  ) {
    throw new Error(`${path}.normalizedQuery: expected a bounded string`);
  }
  if (input.kind === "empty") {
    if (
      input.sourceTokenAddress !== null ||
      input.sourceReleaseVersion !== null
    ) {
      throw new Error(`${path}: empty case must not claim a source token`);
    }
  } else if (
    !HEX_ADDRESS.test(input.sourceTokenAddress) ||
    !RELEASE_VERSIONS.includes(input.sourceReleaseVersion)
  ) {
    throw new Error(`${path}: query case has an invalid source token`);
  }
  matrixDigest(input.commitment, `${path}.commitment`);
  return input;
}

function parseMatrixToken(value, pageIndex, tokenIndex) {
  const path = `exploreMatrix.pages[${pageIndex}].tokens[${tokenIndex}]`;
  const input = matrixExact(
    value,
    ["tokenAddress", "name", "symbol", "releaseVersion"],
    path,
  );
  if (!HEX_ADDRESS.test(input.tokenAddress)) {
    throw new Error(`${path}.tokenAddress: expected a canonical address`);
  }
  matrixString(input.name, `${path}.name`, 256);
  matrixString(input.symbol, `${path}.symbol`, 128);
  if (!RELEASE_VERSIONS.includes(input.releaseVersion)) {
    throw new Error(`${path}.releaseVersion: unsupported release`);
  }
  return input;
}

function parseMatrixPage(value, index) {
  const path = `exploreMatrix.pages[${index}]`;
  const input = matrixExact(
    value,
    [
      "schemaVersion",
      "sequence",
      "probeIssuedAtMs",
      "probeNonce",
      "probeSignatureSha256",
      "caseId",
      "caseCommitment",
      "sort",
      "requestedPage",
      "resolvedPage",
      "pageSize",
      "total",
      "totalPages",
      "isClamp",
      "requestPath",
      "startedAtMs",
      "completedAtMs",
      "durationMs",
      "status",
      "cacheControl",
      "vercelCache",
      "shadowOverheadMs",
      "parity",
      "readSource",
      "fallback",
      "checkpointSha256",
      "bodySha256",
      "bodyBytes",
      "tokenRowsSha256",
      "tokens",
      "pageCommitment",
    ],
    path,
  );
  if (input.schemaVersion !== 1) {
    throw new Error(`${path}.schemaVersion: expected 1`);
  }
  for (const [field, minimum] of [
    ["sequence", 0],
    ["probeIssuedAtMs", 1],
    ["requestedPage", 1],
    ["resolvedPage", 1],
    ["pageSize", 1],
    ["total", 0],
    ["totalPages", 0],
    ["startedAtMs", 1],
    ["completedAtMs", 1],
    ["durationMs", 0],
    ["status", 100],
    ["bodyBytes", 0],
  ]) {
    matrixInteger(input[field], `${path}.${field}`, minimum);
  }
  if (input.shadowOverheadMs !== null) {
    matrixInteger(input.shadowOverheadMs, `${path}.shadowOverheadMs`);
  }
  if (typeof input.isClamp !== "boolean") {
    throw new Error(`${path}.isClamp: expected a boolean`);
  }
  for (const field of [
    "probeNonce",
    "caseId",
    "sort",
    "requestPath",
    "cacheControl",
    "vercelCache",
    "parity",
    "readSource",
  ]) {
    matrixString(input[field], `${path}.${field}`, 4_096);
  }
  for (const field of [
    "probeSignatureSha256",
    "caseCommitment",
    "checkpointSha256",
    "bodySha256",
    "tokenRowsSha256",
    "pageCommitment",
  ]) {
    matrixDigest(input[field], `${path}.${field}`);
  }
  if (input.fallback !== null && typeof input.fallback !== "boolean") {
    throw new Error(`${path}.fallback: expected a measured boolean or null`);
  }
  if (!Array.isArray(input.tokens)) {
    throw new Error(`${path}.tokens: expected an array`);
  }
  input.tokens = input.tokens.map((token, tokenIndex) =>
    parseMatrixToken(token, index, tokenIndex),
  );
  return input;
}

export function parseExploreMatrixManifest(value) {
  const input = matrixExact(
    value,
    [
      "schemaVersion",
      "profileId",
      "captureNonce",
      "capturedAt",
      "target",
      "dataset",
      "checkpoint",
      "matrix",
    ],
    "exploreMatrix",
  );
  if (input.schemaVersion !== 1) {
    throw new Error("exploreMatrix.schemaVersion: expected 1");
  }
  matrixString(input.profileId, "exploreMatrix.profileId");
  if (!/^0x[0-9a-f]{64}$/u.test(input.captureNonce)) {
    throw new Error("exploreMatrix.captureNonce: expected bytes32");
  }
  if (!Number.isFinite(Date.parse(matrixString(input.capturedAt, "exploreMatrix.capturedAt")))) {
    throw new Error("exploreMatrix.capturedAt: expected an ISO timestamp");
  }
  const target = matrixExact(
    input.target,
    ["url", "vercelDeploymentId", "gitHead"],
    "exploreMatrix.target",
  );
  const targetUrl = new URL(matrixString(target.url, "exploreMatrix.target.url", 1_024));
  if (
    targetUrl.protocol !== "https:" ||
    targetUrl.pathname !== "/" ||
    targetUrl.search !== "" ||
    targetUrl.hash !== "" ||
    !targetUrl.hostname.endsWith(".vercel.app")
  ) {
    throw new Error("exploreMatrix.target.url: expected a staged Vercel URL");
  }
  matrixString(target.vercelDeploymentId, "exploreMatrix.target.vercelDeploymentId");
  if (!/^[0-9a-f]{40}$/u.test(target.gitHead)) {
    throw new Error("exploreMatrix.target.gitHead: expected a Git SHA");
  }
  const dataset = matrixExact(
    input.dataset,
    [
      "manifestFile",
      "manifestSha256",
      "generatedAt",
      "eligibleLaunchCount",
      "releaseCounts",
      "inventorySha256",
    ],
    "exploreMatrix.dataset",
  );
  matrixString(dataset.manifestFile, "exploreMatrix.dataset.manifestFile");
  matrixDigest(dataset.manifestSha256, "exploreMatrix.dataset.manifestSha256");
  if (!Number.isFinite(Date.parse(matrixString(dataset.generatedAt, "exploreMatrix.dataset.generatedAt")))) {
    throw new Error("exploreMatrix.dataset.generatedAt: expected an ISO timestamp");
  }
  matrixInteger(
    dataset.eligibleLaunchCount,
    "exploreMatrix.dataset.eligibleLaunchCount",
    1,
  );
  matrixExact(
    dataset.releaseCounts,
    RELEASE_VERSIONS,
    "exploreMatrix.dataset.releaseCounts",
  );
  for (const releaseVersion of RELEASE_VERSIONS) {
    matrixInteger(
      dataset.releaseCounts[releaseVersion],
      `exploreMatrix.dataset.releaseCounts.${releaseVersion}`,
      1,
    );
  }
  matrixDigest(dataset.inventorySha256, "exploreMatrix.dataset.inventorySha256");
  const checkpoint = matrixExact(
    input.checkpoint,
    ["snapshot", "snapshotSha256"],
    "exploreMatrix.checkpoint",
  );
  matrixObject(checkpoint.snapshot, "exploreMatrix.checkpoint.snapshot");
  matrixDigest(checkpoint.snapshotSha256, "exploreMatrix.checkpoint.snapshotSha256");
  const matrix = matrixExact(
    input.matrix,
    [
      "sorts",
      "pageSize",
      "maxQueryCasesPerKind",
      "cases",
      "casesSha256",
      "caseCounts",
      "caseCount",
      "pageCount",
      "tokenObservationCount",
      "pagesFile",
      "pagesSha256",
      "corpusSha256",
    ],
    "exploreMatrix.matrix",
  );
  if (!Array.isArray(matrix.sorts)) {
    throw new Error("exploreMatrix.matrix.sorts: expected an array");
  }
  for (const [field, minimum] of [
    ["pageSize", 1],
    ["maxQueryCasesPerKind", 1],
    ["caseCount", 1],
    ["pageCount", 1],
    ["tokenObservationCount", 1],
  ]) {
    matrixInteger(matrix[field], `exploreMatrix.matrix.${field}`, minimum);
  }
  if (!Array.isArray(matrix.cases) || matrix.cases.length < 1) {
    throw new Error("exploreMatrix.matrix.cases: expected cases");
  }
  matrix.cases = matrix.cases.map(parseMatrixCase);
  matrixExact(
    matrix.caseCounts,
    ["empty", "name", "symbol", "address"],
    "exploreMatrix.matrix.caseCounts",
  );
  for (const kind of ["empty", "name", "symbol", "address"]) {
    matrixInteger(
      matrix.caseCounts[kind],
      `exploreMatrix.matrix.caseCounts.${kind}`,
      1,
    );
  }
  matrixString(matrix.pagesFile, "exploreMatrix.matrix.pagesFile");
  for (const field of ["casesSha256", "pagesSha256", "corpusSha256"]) {
    matrixDigest(matrix[field], `exploreMatrix.matrix.${field}`);
  }
  return input;
}

function readMatrixArtifact(directory, filename) {
  const path = resolve(directory, filename);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${filename}: expected a regular file`);
  }
  if (stat.size < 2 || stat.size > MATRIX_MAXIMUM_BYTES) {
    throw new Error(`${filename}: invalid artifact size`);
  }
  const bytes = readFileSync(path);
  return { path, bytes, sha256: sha256Bytes(bytes) };
}

function parseMatrixPages(bytes) {
  const text = bytes.toString("utf8");
  if (!text.endsWith("\n")) {
    throw new Error("explore matrix pages must end with a newline");
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.length < 1 || lines.length > 20_000 || lines.some((line) => line.length < 2)) {
    throw new Error("explore matrix pages have an invalid cardinality");
  }
  return lines.map((line, index) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`explore matrix page ${index} is not JSON`);
    }
    return parseMatrixPage(value, index);
  });
}

export function loadExploreMatrixReleaseEvidence(input) {
  const directory = dirname(resolve(input.evidencePath));
  const manifestArtifact = readMatrixArtifact(
    directory,
    EXPLORE_MATRIX_MANIFEST_FILE,
  );
  const pagesArtifact = readMatrixArtifact(directory, EXPLORE_MATRIX_PAGES_FILE);
  const manifest = parseExploreMatrixManifest(
    JSON.parse(manifestArtifact.bytes.toString("utf8")),
  );
  const pages = parseMatrixPages(pagesArtifact.bytes);
  return {
    manifest,
    pages,
    artifacts: {
      exploreMatrixManifest: manifestArtifact,
      exploreMatrixPages: pagesArtifact,
    },
  };
}

function expectedMatrixRequestPath(queryCase, page) {
  const search = new URLSearchParams();
  search.set("limit", String(EXPLORE_MATRIX_PAGE_SIZE));
  search.set("page", String(page.requestedPage));
  search.set("q", queryCase.query);
  search.set("sort", page.sort);
  search.set("__read_model_probe", page.probeNonce);
  return `/api/explore?${search.toString()}`;
}

function frozenInventorySha256(eligibleLaunches) {
  return sha256Canonical(
    eligibleLaunches
      .map((launch) => ({
        tokenAddress: launch.tokenAddress.toLowerCase(),
        transactionHash: launch.transactionHash.toLowerCase(),
        releaseVersion: launch.releaseVersion,
      }))
      .sort((left, right) =>
        left.tokenAddress.localeCompare(right.tokenAddress),
      ),
  );
}

function queryMatchesInventoryToken(token, query) {
  if (query === "") return true;
  return (
    token.name.toLowerCase().includes(query) ||
    token.symbol.toLowerCase().includes(query) ||
    token.tokenAddress.includes(query)
  );
}

function sameArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function evaluateExploreMatrixReleaseEvidence(matrixBundle, releaseBundle) {
  const { manifest, pages } = matrixBundle;
  const checks = [];
  const failures = [];
  const check = (id, accepted, detail) => {
    checks.push({ id, status: accepted ? "pass" : "fail", detail });
    if (!accepted) failures.push({ id, detail });
  };
  const evidence = releaseBundle.evidence;
  const dataset = releaseBundle.datasetManifest;
  const eligibleLaunches = dataset.eligibleLaunches.map((launch) => ({
    tokenAddress: launch.tokenAddress.toLowerCase(),
    transactionHash: launch.transactionHash.toLowerCase(),
    releaseVersion: launch.releaseVersion,
  }));
  const releaseByToken = new Map(
    eligibleLaunches.map((launch) => [
      launch.tokenAddress,
      launch.releaseVersion,
    ]),
  );
  const matrixTargetMatches =
    new URL(manifest.target.url).toString() ===
      new URL(evidence.target.url).toString() &&
    manifest.target.vercelDeploymentId === evidence.target.vercelDeploymentId &&
    manifest.target.gitHead === evidence.target.gitHead &&
    manifest.profileId === evidence.profileId &&
    manifest.captureNonce === evidence.captureNonce;
  check(
    "explore-matrix-deployment-binding",
    matrixTargetMatches,
    "matrix nonce, profile, Git SHA, URL and deployment id match the release bundle",
  );

  const expectedInventorySha256 = frozenInventorySha256(eligibleLaunches);
  const datasetBinding =
    manifest.dataset.manifestFile === "dataset-manifest.v1.json" &&
    manifest.dataset.manifestSha256 ===
      releaseBundle.artifacts.datasetManifest.sha256 &&
    manifest.dataset.generatedAt === dataset.generatedAt &&
    manifest.dataset.eligibleLaunchCount === eligibleLaunches.length &&
    sha256Canonical(manifest.dataset.releaseCounts) ===
      sha256Canonical(dataset.releaseCounts) &&
    manifest.dataset.inventorySha256 === expectedInventorySha256;
  check(
    "explore-matrix-inventory-binding",
    datasetBinding,
    `${manifest.dataset.eligibleLaunchCount} launches bind to the exact dataset digest and release counts`,
  );

  const snapshot = manifest.checkpoint.snapshot;
  const checkpointValid =
    snapshot.chainId === 1 &&
    typeof snapshot.blockNumber === "string" &&
    /^(0|[1-9]\d*)$/u.test(snapshot.blockNumber) &&
    typeof snapshot.blockHash === "string" &&
    HEX_HASH.test(snapshot.blockHash.toLowerCase()) &&
    Number.isSafeInteger(snapshot.confirmations) &&
    snapshot.confirmations >= 0 &&
    manifest.checkpoint.snapshotSha256 === sha256Canonical(snapshot) &&
    pages.every(
      (page) =>
        page.checkpointSha256 === manifest.checkpoint.snapshotSha256,
    );
  check(
    "explore-matrix-checkpoint-binding",
    checkpointValid,
    `every page binds to checkpoint ${String(snapshot.blockNumber)}:${String(snapshot.blockHash)}`,
  );

  const cases = manifest.matrix.cases;
  const caseById = new Map(cases.map((queryCase) => [queryCase.caseId, queryCase]));
  const actualCaseCounts = Object.fromEntries(
    ["empty", "name", "symbol", "address"].map((kind) => [
      kind,
      cases.filter((queryCase) => queryCase.kind === kind).length,
    ]),
  );
  const casesBound =
    manifest.matrix.sorts.length === EXPLORE_MATRIX_SORTS.length &&
    manifest.matrix.sorts.every(
      (sort, index) => sort === EXPLORE_MATRIX_SORTS[index],
    ) &&
    manifest.matrix.pageSize === EXPLORE_MATRIX_PAGE_SIZE &&
    manifest.matrix.maxQueryCasesPerKind ===
      EXPLORE_MATRIX_MAX_QUERY_CASES_PER_KIND &&
    manifest.matrix.caseCount === cases.length &&
    new Set(cases.map((queryCase) => queryCase.caseId)).size === cases.length &&
    cases.every(
      (queryCase) =>
        queryCase.normalizedQuery ===
          normalizeExploreMatrixQuery(queryCase.query) &&
        queryCase.commitment === commitExploreMatrixCase(queryCase),
    ) &&
    actualCaseCounts.empty === 1 &&
    ["name", "symbol", "address"].every(
      (kind) =>
        actualCaseCounts[kind] ===
        EXPLORE_MATRIX_MAX_QUERY_CASES_PER_KIND,
    ) &&
    ["empty", "name", "symbol", "address"].every(
      (kind) => manifest.matrix.caseCounts[kind] === actualCaseCounts[kind],
    ) &&
    cases.filter((queryCase) => queryCase.kind === "empty")[0]
      ?.normalizedQuery === "" &&
    manifest.matrix.casesSha256 === sha256Canonical(cases);
  check(
    "explore-matrix-case-commitments",
    casesBound,
    `${cases.length} deterministic empty/name/symbol/address cases are committed`,
  );

  const requestPaths = new Set();
  const pageEvidenceValid = pages.every((page, index) => {
    const queryCase = caseById.get(page.caseId);
    const expectedNonce = `${page.probeIssuedAtMs}-${manifest.captureNonce.slice(2)}-${page.sequence}`;
    const requestPath = queryCase
      ? expectedMatrixRequestPath(queryCase, page)
      : "missing";
    requestPaths.add(page.requestPath);
    return (
      page.sequence === index &&
      page.probeNonce === expectedNonce &&
      PROBE_NONCE.test(page.probeNonce) &&
      page.probeIssuedAtMs <= page.startedAtMs &&
      page.startedAtMs - page.probeIssuedAtMs <= 5_000 &&
      page.completedAtMs - page.startedAtMs === page.durationMs &&
      HEX_DIGEST.test(page.probeSignatureSha256) &&
      queryCase !== undefined &&
      page.caseCommitment === queryCase.commitment &&
      EXPLORE_MATRIX_SORTS.includes(page.sort) &&
      page.pageSize === EXPLORE_MATRIX_PAGE_SIZE &&
      page.requestPath === requestPath &&
      page.tokenRowsSha256 === sha256Canonical(page.tokens) &&
      page.pageCommitment === commitExploreMatrixPage(page) &&
      page.tokens.every(
        (token) =>
          releaseByToken.get(token.tokenAddress) === token.releaseVersion,
      )
    );
  });
  check(
    "explore-matrix-signed-page-bindings",
    pageEvidenceValid && requestPaths.size === pages.length,
    `${pages.length} unique route-bound probe nonces and page commitments were captured`,
  );

  const cacheValid = pages.every(
    (page) =>
      page.status === 200 &&
      page.cacheControl === "private, no-store" &&
      ["MISS", "BYPASS"].includes(page.vercelCache),
  );
  check(
    "explore-matrix-cache",
    cacheValid,
    "every matrix page reached the staged origin under the private no-store probe contract",
  );
  const parityValid = pages.every(
    (page) =>
      page.parity === "match" &&
      ["rpc", "blob", "indexed"].includes(page.readSource) &&
      Number.isSafeInteger(page.shadowOverheadMs) &&
      page.shadowOverheadMs >= 0 &&
      page.shadowOverheadMs <= page.durationMs,
  );
  check(
    "explore-matrix-parity",
    parityValid,
    "every signed Explore matrix response reports exact shadow parity",
  );
  const fallbackValid = pages.every((page) => page.fallback === false);
  check(
    "explore-matrix-fallback",
    fallbackValid,
    "no matrix request used a live fallback",
  );

  const emptyNewestRows = pages
    .filter(
      (page) =>
        page.caseId === "empty" &&
        page.sort === "newest" &&
        page.isClamp === false,
    )
    .sort((left, right) => left.requestedPage - right.requestedPage)
    .flatMap((page) => page.tokens);
  const inventoryByToken = new Map(
    emptyNewestRows.map((token) => [token.tokenAddress, token]),
  );
  const expectedAddresses = [...releaseByToken.keys()].sort();
  const observedAddresses = [...inventoryByToken.keys()].sort();
  const metadataStable = pages.every((page) =>
    page.tokens.every((token) => {
      const frozen = inventoryByToken.get(token.tokenAddress);
      return (
        frozen !== undefined &&
        frozen.name === token.name &&
        frozen.symbol === token.symbol &&
        frozen.releaseVersion === token.releaseVersion
      );
    }),
  );
  check(
    "explore-matrix-frozen-inventory",
    sameArray(observedAddresses, expectedAddresses) && metadataStable,
    `${observedAddresses.length}/${expectedAddresses.length} frozen token identities were observed with stable metadata`,
  );

  const queryCasesValid = cases.every((queryCase) => {
    if (queryCase.kind === "empty") {
      return (
        queryCase.sourceTokenAddress === null &&
        queryCase.sourceReleaseVersion === null &&
        queryCase.normalizedQuery === ""
      );
    }
    const source = inventoryByToken.get(queryCase.sourceTokenAddress);
    if (!source || source.releaseVersion !== queryCase.sourceReleaseVersion) {
      return false;
    }
    if (queryCase.kind === "name") {
      return normalizeExploreMatrixQuery(source.name) === queryCase.normalizedQuery;
    }
    if (queryCase.kind === "symbol") {
      return normalizeExploreMatrixQuery(source.symbol) === queryCase.normalizedQuery;
    }
    return source.tokenAddress === queryCase.normalizedQuery;
  });
  check(
    "explore-matrix-real-query-sources",
    queryCasesValid,
    "every bounded query is derived from a committed token name, symbol or address",
  );

  let traversalValid = true;
  let clampValid = true;
  let missingCases = 0;
  const releaseSortCoverage = new Map();
  for (const queryCase of cases) {
    const expectedMatches = [...inventoryByToken.values()].filter((token) =>
      queryMatchesInventoryToken(token, queryCase.normalizedQuery),
    );
    if (
      queryCase.kind !== "empty" &&
      (expectedMatches.length < 1 ||
        expectedMatches.length > EXPLORE_MATRIX_PAGE_SIZE)
    ) {
      traversalValid = false;
    }
    const expectedMatchAddresses = expectedMatches
      .map((token) => token.tokenAddress)
      .sort();
    const expectedTotalPages = Math.ceil(
      expectedMatches.length / EXPLORE_MATRIX_PAGE_SIZE,
    );
    const expectedRealPageCount = Math.max(1, expectedTotalPages);
    for (const sort of EXPLORE_MATRIX_SORTS) {
      const group = pages.filter(
        (page) => page.caseId === queryCase.caseId && page.sort === sort,
      );
      const realPages = group
        .filter((page) => page.isClamp === false)
        .sort((left, right) => left.requestedPage - right.requestedPage);
      const clampPages = group.filter((page) => page.isClamp === true);
      if (group.length < 1) missingCases += 1;
      const realRequestedPages = realPages.map((page) => page.requestedPage);
      const expectedRequestedPages = Array.from(
        { length: expectedRealPageCount },
        (_, index) => index + 1,
      );
      const realAddresses = realPages
        .flatMap((page) => page.tokens.map((token) => token.tokenAddress))
        .sort();
      const pageMetadataValid = realPages.every((page, index) => {
        const expectedResolvedPage = expectedTotalPages === 0 ? 1 : index + 1;
        const expectedTokenCount = Math.min(
          EXPLORE_MATRIX_PAGE_SIZE,
          Math.max(
            0,
            expectedMatches.length - index * EXPLORE_MATRIX_PAGE_SIZE,
          ),
        );
        return (
          page.resolvedPage === expectedResolvedPage &&
          page.total === expectedMatches.length &&
          page.totalPages === expectedTotalPages &&
          page.tokens.length === expectedTokenCount
        );
      });
      traversalValid =
        traversalValid &&
        sameArray(realRequestedPages, expectedRequestedPages) &&
        new Set(realAddresses).size === realAddresses.length &&
        sameArray(realAddresses, expectedMatchAddresses) &&
        pageMetadataValid;
      const lastRealPage = realPages.at(-1);
      const clampPage = clampPages[0];
      clampValid =
        clampValid &&
        clampPages.length === 1 &&
        clampPage?.requestedPage === EXPLORE_MATRIX_CLAMP_PAGE &&
        clampPage?.resolvedPage === Math.max(1, expectedTotalPages) &&
        clampPage?.total === expectedMatches.length &&
        clampPage?.totalPages === expectedTotalPages &&
        lastRealPage !== undefined &&
        sameArray(
          clampPage.tokens.map((token) => token.tokenAddress),
          lastRealPage.tokens.map((token) => token.tokenAddress),
        );
      if (queryCase.kind === "empty") {
        for (const releaseVersion of RELEASE_VERSIONS) {
          const expectedReleaseAddresses = eligibleLaunches
            .filter((launch) => launch.releaseVersion === releaseVersion)
            .map((launch) => launch.tokenAddress)
            .sort();
          const observedReleaseAddresses = realPages
            .flatMap((page) => page.tokens)
            .filter((token) => token.releaseVersion === releaseVersion)
            .map((token) => token.tokenAddress)
            .sort();
          releaseSortCoverage.set(
            `${releaseVersion}:${sort}`,
            sameArray(observedReleaseAddresses, expectedReleaseAddresses),
          );
        }
      }
    }
  }
  check(
    "explore-matrix-case-coverage",
    missingCases === 0 &&
      pages.every((page) => caseById.has(page.caseId)) &&
      pages.length === manifest.matrix.pageCount,
    `${missingCases} case/sort traversals are missing`,
  );
  check(
    "explore-matrix-page-and-cursor-coverage",
    traversalValid,
    "every real page is present once with no cursor gap, duplicate or inventory omission",
  );
  check(
    "explore-matrix-page-clamping",
    clampValid,
    "every case and sort includes one maximum-page clamp bound to the final real page",
  );
  for (const releaseVersion of RELEASE_VERSIONS) {
    for (const sort of EXPLORE_MATRIX_SORTS) {
      check(
        `explore-matrix-release-${releaseVersion}-${sort}`,
        releaseSortCoverage.get(`${releaseVersion}:${sort}`) === true,
        `${releaseVersion} is completely represented in the ${sort} traversal`,
      );
    }
  }

  const tokenObservationCount = pages.reduce(
    (total, page) => total + page.tokens.length,
    0,
  );
  const pagesDigestBound =
    manifest.matrix.pagesFile === EXPLORE_MATRIX_PAGES_FILE &&
    manifest.matrix.pagesSha256 ===
      matrixBundle.artifacts.exploreMatrixPages.sha256 &&
    manifest.matrix.pageCount === pages.length &&
    manifest.matrix.tokenObservationCount === tokenObservationCount;
  check(
    "explore-matrix-page-digest",
    pagesDigestBound,
    `${pages.length} pages and ${tokenObservationCount} token observations match the committed artifact`,
  );
  const corpusSha256 = exploreMatrixCorpusCommitment({
    captureNonce: manifest.captureNonce,
    target: manifest.target,
    datasetManifestSha256: manifest.dataset.manifestSha256,
    inventorySha256: manifest.dataset.inventorySha256,
    casesSha256: manifest.matrix.casesSha256,
    pagesSha256: manifest.matrix.pagesSha256,
    checkpointSha256: manifest.checkpoint.snapshotSha256,
    eligibleLaunchCount: manifest.dataset.eligibleLaunchCount,
    caseCount: manifest.matrix.caseCount,
    pageCount: manifest.matrix.pageCount,
    tokenObservationCount: manifest.matrix.tokenObservationCount,
  });
  check(
    "explore-matrix-corpus-digest",
    corpusSha256 === manifest.matrix.corpusSha256,
    "deployment, dataset, checkpoint, cases, pages and counts share one corpus commitment",
  );

  const matrixCapturedAtMs = Date.parse(manifest.capturedAt);
  const releaseCapturedAtMs = Date.parse(evidence.capturedAt);
  const firstMatrixStart = Math.min(...pages.map((page) => page.startedAtMs));
  const lastMatrixCompletion = Math.max(
    ...pages.map((page) => page.completedAtMs),
  );
  const lastLoadCompletion = Math.max(
    ...releaseBundle.httpSamples.map((sample) => sample.completedAtMs),
  );
  const captureWindowValid =
    firstMatrixStart >= lastLoadCompletion &&
    lastMatrixCompletion <= matrixCapturedAtMs &&
    matrixCapturedAtMs <= releaseCapturedAtMs &&
    releaseCapturedAtMs - matrixCapturedAtMs <= 5_000;
  check(
    "explore-matrix-capture-window",
    captureWindowValid,
    "the separate matrix ran after the load sample and before the signed release manifest",
  );

  return {
    schemaVersion: 1,
    status: failures.length === 0 ? "accepted" : "rejected",
    releaseEvidenceAccepted: failures.length === 0,
    checks,
    failures,
    artifactDigests: {
      exploreMatrixManifest:
        matrixBundle.artifacts.exploreMatrixManifest.sha256,
      exploreMatrixPages: matrixBundle.artifacts.exploreMatrixPages.sha256,
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const rootDirectory = process.cwd();
  const args = parseArguments(argv);
  const evidencePath =
    args.evidencePath ??
    process.env.PROGRAMMABLE_READ_MODEL_PERF_EVIDENCE_PATH;
  if (!evidencePath && args.ifPresent) {
    output(
      {
        schemaVersion: 1,
        mode: "release",
        status: "skipped",
        releaseEvidenceAccepted: false,
        reason: "no exact release evidence was explicitly provided",
      },
      0,
    );
    return;
  }
  if (!evidencePath) {
    throw new Error(
      "PROGRAMMABLE_READ_MODEL_PERF_EVIDENCE_PATH or --evidence is required",
    );
  }
  const profile = parseReadModelLoadProfile(
    JSON.parse(
      readFileSync(
        resolve(rootDirectory, "config/read-model-release-profile.v1.json"),
        "utf8",
      ),
    ),
  );
  const gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: rootDirectory,
    encoding: "utf8",
  }).trim();
  const expectedProviders = expectedProductionProviderBindings();
  const resolvedEvidencePath = resolve(rootDirectory, evidencePath);
  const bundle = loadReadModelReleaseEvidence({
    profile,
    evidencePath: resolvedEvidencePath,
  });
  const matrixBundle = loadExploreMatrixReleaseEvidence({
    evidencePath: resolvedEvidencePath,
  });
  const expectedTargetUrl = process.env.PROGRAMMABLE_READ_MODEL_TARGET_URL;
  const expectedDeploymentId =
    process.env.PROGRAMMABLE_READ_MODEL_VERCEL_DEPLOYMENT_ID;
  if (!expectedTargetUrl || !expectedDeploymentId) {
    throw new Error(
      "PROGRAMMABLE_READ_MODEL_TARGET_URL and PROGRAMMABLE_READ_MODEL_VERCEL_DEPLOYMENT_ID are required",
    );
  }
  const exactWorkflowTarget =
    new URL(bundle.evidence.target.url).toString() ===
      new URL(expectedTargetUrl).toString() &&
    bundle.evidence.target.vercelDeploymentId === expectedDeploymentId;
  const evidenceResult = evaluateReadModelReleaseEvidence(bundle, {
    gitHead,
    expectedProviders,
  });
  const matrixResult = evaluateExploreMatrixReleaseEvidence(
    matrixBundle,
    bundle,
  );
  const sourceResult = evaluateReadModelSourceContracts(
    rootDirectory,
    profile,
  );
  const [vercelResult, rollbackResult, cacheResult] = await Promise.all([
    verifyLiveVercelBinding({
      evidence: bundle.evidence,
      gitHead,
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
    }),
    verifyLiveRollbackTarget({
      stagedDeploymentId: bundle.evidence.target.vercelDeploymentId,
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
      productionDomain:
        process.env.PROGRAMMABLE_PRODUCTION_DOMAIN ?? "programmable.family",
    }),
    verifyLiveCacheAndKeyContracts({
      profile,
      evidence: bundle.evidence,
      datasetManifest: bundle.datasetManifest,
    }),
  ]);
  const failures = [
    ...(exactWorkflowTarget
      ? []
      : [
          {
            id: "workflow-target-binding",
            detail: "evidence does not target the staged deployment",
          },
        ]),
    ...evidenceResult.failures,
    ...matrixResult.failures,
    ...sourceResult.failures,
    ...vercelResult.failures,
    ...rollbackResult.failures,
    ...cacheResult.failures,
  ];
  output(
    {
      schemaVersion: 1,
      profileId: profile.profileId,
      mode: "release",
      status: failures.length === 0 ? "accepted" : "rejected",
      releaseEvidenceAccepted: failures.length === 0,
      evidenceSha256: bundle.evidence.evidenceSha256,
      checks: [
        {
          id: "workflow-target-binding",
          status: exactWorkflowTarget ? "pass" : "fail",
          detail: "evidence targets the staged deployment",
        },
        ...evidenceResult.checks,
        ...matrixResult.checks,
        ...sourceResult.checks,
        ...vercelResult.checks,
        ...rollbackResult.checks,
        ...cacheResult.checks,
      ],
      failures,
      artifactDigests: {
        ...evidenceResult.artifactDigests,
        ...matrixResult.artifactDigests,
      },
    },
    failures.length === 0 ? 0 : 1,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    output(
      {
        schemaVersion: 1,
        mode: "release",
        status: "rejected",
        releaseEvidenceAccepted: false,
        checks: [],
        failures: [
          {
            id: "gate-input",
            detail: error instanceof Error ? error.message : "invalid input",
          },
        ],
      },
      1,
    );
  });
}
