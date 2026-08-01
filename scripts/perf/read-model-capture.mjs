#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseReadModelLoadProfile,
  ROUTE_NAMES,
  sha256Bytes,
} from "./read-model-gate-core.mjs";
import { buildReadModelReleaseProbe } from "./read-model-release-probe.mjs";

const RUNTIME_CAPTURE_PATH = "/api/ops/read-model-performance-capture";
const MAX_RUNTIME_EVIDENCE_BYTES = 8 * 1024 * 1024;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const HEX_DIGEST = /^[0-9a-f]{64}$/u;
const SHADOW_PROBE_ROUTES = new Set([
  "exploreList",
  "tokenDetail",
  "tokenChart",
  "creatorProfile",
  "classicProfile",
  "stockProfile",
  "classicLaunchLookup",
  "stockLaunchLookup",
]);
export const EXPLORE_MATRIX_SORTS = Object.freeze([
  "newest",
  "oldest",
  "market-cap",
  "market-cap-asc",
]);
export const EXPLORE_MATRIX_PAGE_SIZE = 6;
export const EXPLORE_MATRIX_MAX_QUERY_CASES_PER_KIND = 8;
export const EXPLORE_MATRIX_CLAMP_PAGE = Number.MAX_SAFE_INTEGER;
export const EXPLORE_MATRIX_MANIFEST_FILE =
  "explore-matrix-evidence.v1.json";
export const EXPLORE_MATRIX_PAGES_FILE = "explore-matrix-pages.v1.jsonl";
const EXPLORE_MATRIX_MAXIMUM_PAGES_PER_CASE = 100;
const REQUIRED_RELEASE_VERSIONS = Object.freeze([
  "classic-v2",
  "classic-v3",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
]);

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
      )
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("explore matrix contains a non-JSON value");
  }
  return encoded;
}

export function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

export function normalizeExploreMatrixQuery(value) {
  if (typeof value !== "string") {
    throw new Error("explore matrix query must be a string");
  }
  return value.trim().toLowerCase().replace(/^\$/u, "");
}

function alternatingAsciiCase(value) {
  let upper = true;
  return [...value]
    .map((character) => {
      if (!/[a-z]/iu.test(character)) return character;
      const result = upper
        ? character.toUpperCase()
        : character.toLowerCase();
      upper = !upper;
      return result;
    })
    .join("");
}

function caseIdentity(value) {
  return {
    caseId: value.caseId,
    kind: value.kind,
    query: value.query,
    normalizedQuery: value.normalizedQuery,
    sourceTokenAddress: value.sourceTokenAddress,
    sourceReleaseVersion: value.sourceReleaseVersion,
  };
}

export function commitExploreMatrixCase(value) {
  return sha256Canonical(caseIdentity(value));
}

function committedCase(value) {
  const identity = caseIdentity(value);
  return Object.freeze({
    ...identity,
    commitment: commitExploreMatrixCase(identity),
  });
}

function emptyExploreMatrixCase() {
  return committedCase({
    caseId: "empty",
    kind: "empty",
    query: "   ",
    normalizedQuery: "",
    sourceTokenAddress: null,
    sourceReleaseVersion: null,
  });
}

function argumentsFrom(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("capture arguments must be --name value pairs");
    }
    const key = name.slice(2);
    if (values[key]) throw new Error(`duplicate argument: ${name}`);
    values[key] = value;
  }
  for (const required of [
    "target-url",
    "deployment-id",
    "output-directory",
    "kind",
  ]) {
    if (!values[required]) throw new Error(`--${required} is required`);
  }
  if (!new Set(["preview", "production-canary"]).has(values.kind)) {
    throw new Error("--kind must be preview or production-canary");
  }
  return values;
}

function gitHead(rootDirectory) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: rootDirectory,
    encoding: "utf8",
  }).trim();
}

function secret(environment, name) {
  const value = environment[name];
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 512 ||
    /[\r\n]/u.test(value)
  ) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function deterministicSchedule(profile) {
  const schedule = [];
  for (const route of ROUTE_NAMES) {
    const count = profile.load.routeMixBps[route] / 10;
    if (!Number.isInteger(count)) {
      throw new Error("route mix must resolve exactly across 1000 samples");
    }
    schedule.push(...Array.from({ length: count }, () => route));
  }
  let state = 0x4f1bbcdc;
  for (let index = schedule.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const swapIndex = state % (index + 1);
    [schedule[index], schedule[swapIndex]] = [
      schedule[swapIndex],
      schedule[index],
    ];
  }
  return schedule;
}

function datasetAddress(values, sequence, name) {
  if (!Array.isArray(values) || values.length < 1) {
    throw new Error(`runtime dataset has no ${name}`);
  }
  const coverageIndex = sequence % values.length;
  const value = values[coverageIndex];
  if (typeof value !== "string" || !ADDRESS.test(value)) {
    throw new Error(`runtime dataset contains an invalid ${name} address`);
  }
  return value;
}

function datasetLaunch(values, sequence, name) {
  if (!Array.isArray(values) || values.length < 1) {
    throw new Error(`runtime dataset has no ${name} launches`);
  }
  const coverageIndex = sequence % values.length;
  const value = values[coverageIndex];
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !ADDRESS.test(value.account) ||
    !HASH.test(value.transactionHash)
  ) {
    throw new Error(`runtime dataset contains an invalid ${name} launch`);
  }
  return value;
}

function requestPath(
  route,
  sequence,
  keyIndex,
  keys,
  captureNonce,
  probeIssuedAtMs,
  shadowProbeToken,
) {
  const token = datasetAddress(keys.tokenAddresses, keyIndex, "token");
  const account = datasetAddress(keys.accountAddresses, keyIndex, "account");
  const classicLaunch = datasetLaunch(
    keys.classicLaunches,
    keyIndex,
    "Classic",
  );
  const stockLaunch = datasetLaunch(keys.stockLaunches, keyIndex, "Stock");
  const releaseProbe = SHADOW_PROBE_ROUTES.has(route)
    ? buildReadModelReleaseProbe({
        route,
        issuedAtMs: probeIssuedAtMs,
        captureNonce,
        sequence,
        secret: shadowProbeToken,
      })
    : null;
  const cacheBuster = encodeURIComponent(
    releaseProbe?.nonce ??
      `perf-${probeIssuedAtMs}-${captureNonce.slice(2)}-${sequence}`,
  );
  const encodedToken = encodeURIComponent(token);
  const encodedAccount = encodeURIComponent(account);
  const result = (datasetKey, path) => ({
    datasetKey,
    key: `${route}:${sequence}:${datasetKey.toLowerCase()}`,
    path: `${path}${path.includes("?") ? "&" : "?"}${
      releaseProbe ? "__read_model_probe" : "__performance_probe"
    }=${cacheBuster}`,
    releaseProbe,
  });
  if (route === "exploreList") {
    return result(
      token,
      `/api/explore?limit=6&page=1&q=${encodedToken}&sort=market-cap`,
    );
  }
  if (route === "tokenDetail") {
    return result(token, `/api/explore/token?address=${encodedToken}`);
  }
  if (route === "tokenChart") {
    const range = sequence % 2 === 1 ? "1h" : "all";
    return result(
      token,
      `/api/explore/token/chart?address=${encodedToken}&range=${range}`,
    );
  }
  if (route === "creatorProfile") {
    return result(account, `/api/explore/profile?account=${encodedAccount}`);
  }
  if (route === "classicProfile") {
    return result(account, `/api/profile/classic-v3?account=${encodedAccount}`);
  }
  if (route === "stockProfile") {
    return result(account, `/api/profile/stock-paired?account=${encodedAccount}`);
  }
  if (route === "classicLaunchLookup") {
    return result(
      classicLaunch.transactionHash,
      `/api/profile/classic-v3?account=${encodeURIComponent(classicLaunch.account)}&launch=${encodeURIComponent(classicLaunch.transactionHash)}`,
    );
  }
  if (route === "stockLaunchLookup") {
    return result(
      stockLaunch.transactionHash,
      `/api/explore/launch/stock-paired?account=${encodeURIComponent(stockLaunch.account)}&transaction=${encodeURIComponent(stockLaunch.transactionHash)}`,
    );
  }
  if (route === "publicIndexer") {
    return result(
      token,
      `/api/indexers/v1/tokens?address=${encodedToken}`,
    );
  }
  return result("health", "/api/ops/health");
}

function optionalIntegerHeader(response, name) {
  const value = response.headers.get(name);
  if (value === null || !/^(0|[1-9]\d*)$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function optionalBooleanHeader(response, name) {
  const value = response.headers.get(name);
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function responseMatchesDatasetKey(route, body, datasetKey, expectedRange) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  if (route === "exploreList") {
    return (
      sameAddress(body.query, datasetKey) &&
      Array.isArray(body.tokens) &&
      body.tokens.some((token) => sameAddress(token?.tokenAddress, datasetKey))
    );
  }
  if (route === "tokenDetail") {
    return sameAddress(body.token?.tokenAddress, datasetKey);
  }
  if (route === "tokenChart") {
    return (
      sameAddress(body.address, datasetKey) &&
      Array.isArray(body.points) &&
      body.range === expectedRange
    );
  }
  if (route === "creatorProfile") {
    return sameAddress(body.account, datasetKey);
  }
  if (route === "classicProfile" || route === "stockProfile") {
    return sameAddress(body.account, datasetKey) && Array.isArray(body.rewards);
  }
  if (route === "classicLaunchLookup") {
    return (
      typeof body.launch === "object" &&
      body.launch !== null &&
      body.launch.launchTransactionHash?.toLowerCase() ===
        datasetKey.toLowerCase()
    );
  }
  if (route === "stockLaunchLookup") {
    return (
      typeof body.launch === "object" &&
      body.launch !== null &&
      body.launch.transactionHash?.toLowerCase() === datasetKey.toLowerCase()
    );
  }
  if (route === "publicIndexer") {
    return sameAddress(body.address, datasetKey);
  }
  return body.status === "healthy";
}

function validSafeInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function eligibleLaunchIndex(eligibleLaunches) {
  if (!Array.isArray(eligibleLaunches) || eligibleLaunches.length < 1) {
    throw new Error("explore matrix requires the complete eligible launch inventory");
  }
  const result = new Map();
  for (const launch of eligibleLaunches) {
    if (
      launch === null ||
      typeof launch !== "object" ||
      Array.isArray(launch) ||
      !ADDRESS.test(launch.tokenAddress) ||
      !REQUIRED_RELEASE_VERSIONS.includes(launch.releaseVersion)
    ) {
      throw new Error("explore matrix eligible launch is invalid");
    }
    const tokenAddress = launch.tokenAddress.toLowerCase();
    if (result.has(tokenAddress)) {
      throw new Error("explore matrix eligible token inventory is duplicated");
    }
    result.set(tokenAddress, launch.releaseVersion);
  }
  for (const releaseVersion of REQUIRED_RELEASE_VERSIONS) {
    if (![...result.values()].includes(releaseVersion)) {
      throw new Error(`explore matrix has no ${releaseVersion} inventory`);
    }
  }
  return result;
}

function frozenInventoryCommitment(eligibleLaunches) {
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

function minimalExploreToken(token, releases) {
  if (
    token === null ||
    typeof token !== "object" ||
    Array.isArray(token) ||
    !ADDRESS.test(token.tokenAddress) ||
    typeof token.name !== "string" ||
    token.name.length < 1 ||
    token.name.length > 256 ||
    typeof token.symbol !== "string" ||
    token.symbol.length < 1 ||
    token.symbol.length > 128
  ) {
    throw new Error("explore matrix response contains an invalid token identity");
  }
  const tokenAddress = token.tokenAddress.toLowerCase();
  const releaseVersion = releases.get(tokenAddress);
  if (!releaseVersion) {
    throw new Error("explore matrix response contains a non-inventory token");
  }
  return Object.freeze({
    tokenAddress,
    name: token.name,
    symbol: token.symbol,
    releaseVersion,
  });
}

function parseExploreMatrixBody(body, request, releases) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("explore matrix response is not an object");
  }
  if (
    body.status !== "ready" ||
    !Array.isArray(body.tokens) ||
    !validSafeInteger(body.page, 1) ||
    !validSafeInteger(body.pageSize, 1) ||
    !validSafeInteger(body.total) ||
    !validSafeInteger(body.totalPages) ||
    body.sort !== request.sort ||
    typeof body.query !== "string" ||
    normalizeExploreMatrixQuery(body.query) !== request.normalizedQuery
  ) {
    throw new Error("explore matrix response has invalid pagination metadata");
  }
  const snapshot = body.snapshot;
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot) ||
    snapshot.chainId !== 1 ||
    typeof snapshot.blockNumber !== "string" ||
    !/^(0|[1-9]\d*)$/u.test(snapshot.blockNumber) ||
    !HASH.test(snapshot.blockHash) ||
    !validSafeInteger(snapshot.confirmations)
  ) {
    throw new Error("explore matrix response has no canonical checkpoint");
  }
  return {
    page: body.page,
    pageSize: body.pageSize,
    total: body.total,
    totalPages: body.totalPages,
    sort: body.sort,
    tokens: body.tokens.map((token) => minimalExploreToken(token, releases)),
    snapshot,
  };
}

function matchesExploreMatrixQuery(token, normalizedQuery) {
  if (normalizedQuery === "") return true;
  return (
    token.name.toLowerCase().includes(normalizedQuery) ||
    token.symbol.toLowerCase().includes(normalizedQuery) ||
    token.tokenAddress.includes(normalizedQuery)
  );
}

function boundedQueryCandidates(inventory, kind) {
  const field = kind === "name" ? "name" : "symbol";
  const ordered = [...inventory].sort(
    (left, right) =>
      REQUIRED_RELEASE_VERSIONS.indexOf(left.releaseVersion) -
        REQUIRED_RELEASE_VERSIONS.indexOf(right.releaseVersion) ||
      left.tokenAddress.localeCompare(right.tokenAddress),
  );
  const candidates = [];
  const seenQueries = new Set();
  for (const token of ordered) {
    const normalizedQuery = normalizeExploreMatrixQuery(token[field]);
    if (
      normalizedQuery.length < 1 ||
      normalizedQuery.length > 128 ||
      seenQueries.has(normalizedQuery)
    ) {
      continue;
    }
    const matchCount = inventory.filter((candidate) =>
      matchesExploreMatrixQuery(candidate, normalizedQuery),
    ).length;
    if (matchCount < 1 || matchCount > EXPLORE_MATRIX_PAGE_SIZE) continue;
    seenQueries.add(normalizedQuery);
    candidates.push({ token, normalizedQuery });
  }
  if (candidates.length < 1) {
    throw new Error(`explore matrix has no bounded real ${kind} query case`);
  }
  return candidates;
}

function selectedQueryCandidates(candidates) {
  const selected = [];
  const usedQueries = new Set();
  for (const releaseVersion of REQUIRED_RELEASE_VERSIONS) {
    const candidate = candidates.find(
      (entry) =>
        entry.token.releaseVersion === releaseVersion &&
        !usedQueries.has(entry.normalizedQuery),
    );
    if (candidate) {
      selected.push(candidate);
      usedQueries.add(candidate.normalizedQuery);
    }
  }
  for (const candidate of candidates) {
    if (selected.length >= EXPLORE_MATRIX_MAX_QUERY_CASES_PER_KIND) break;
    if (usedQueries.has(candidate.normalizedQuery)) continue;
    selected.push(candidate);
    usedQueries.add(candidate.normalizedQuery);
  }
  return selected;
}

function queryCase(kind, candidate) {
  const rawValue = alternatingAsciiCase(
    kind === "address"
      ? candidate.token.tokenAddress
      : candidate.normalizedQuery,
  );
  const query = `  ${kind === "symbol" ? "$" : ""}${rawValue}  `;
  const identityDigest = sha256Canonical({
    kind,
    query,
    sourceTokenAddress: candidate.token.tokenAddress,
  });
  return committedCase({
    caseId: `${kind}-${identityDigest.slice(0, 20)}`,
    kind,
    query,
    normalizedQuery: normalizeExploreMatrixQuery(query),
    sourceTokenAddress: candidate.token.tokenAddress,
    sourceReleaseVersion: candidate.token.releaseVersion,
  });
}

export function buildExploreMatrixCases(inventory) {
  if (!Array.isArray(inventory) || inventory.length < 1) {
    throw new Error("explore matrix inventory is empty");
  }
  const nameCases = selectedQueryCandidates(
    boundedQueryCandidates(inventory, "name"),
  ).map((candidate) => queryCase("name", candidate));
  const symbolCases = selectedQueryCandidates(
    boundedQueryCandidates(inventory, "symbol"),
  ).map((candidate) => queryCase("symbol", candidate));
  const addressCandidates = selectedQueryCandidates(
    inventory.map((token) => ({
      token,
      normalizedQuery: token.tokenAddress,
    })),
  );
  const addressCases = addressCandidates.map((candidate) =>
    queryCase("address", candidate),
  );
  if (
    nameCases.length !== EXPLORE_MATRIX_MAX_QUERY_CASES_PER_KIND ||
    symbolCases.length !== EXPLORE_MATRIX_MAX_QUERY_CASES_PER_KIND ||
    addressCases.length !== EXPLORE_MATRIX_MAX_QUERY_CASES_PER_KIND
  ) {
    throw new Error(
      "explore matrix requires eight unique bounded real cases per query kind",
    );
  }
  return Object.freeze([
    emptyExploreMatrixCase(),
    ...nameCases,
    ...symbolCases,
    ...addressCases,
  ]);
}

function exploreMatrixRequestPath(input) {
  const search = new URLSearchParams();
  search.set("limit", String(EXPLORE_MATRIX_PAGE_SIZE));
  search.set("page", String(input.requestedPage));
  search.set("q", input.queryCase.query);
  search.set("sort", input.sort);
  search.set("__read_model_probe", input.probeNonce);
  return `/api/explore?${search.toString()}`;
}

function pageIdentity(value) {
  const identity = { ...value };
  delete identity.pageCommitment;
  return identity;
}

export function commitExploreMatrixPage(value) {
  return sha256Canonical(pageIdentity(value));
}

export function serializeExploreMatrixPages(pages) {
  if (!Array.isArray(pages) || pages.length < 1) {
    throw new Error("explore matrix pages are empty");
  }
  return `${pages.map((page) => JSON.stringify(page)).join("\n")}\n`;
}

export function exploreMatrixCorpusCommitment(input) {
  return sha256Canonical({
    captureNonce: input.captureNonce,
    target: input.target,
    datasetManifestSha256: input.datasetManifestSha256,
    inventorySha256: input.inventorySha256,
    casesSha256: input.casesSha256,
    pagesSha256: input.pagesSha256,
    checkpointSha256: input.checkpointSha256,
    eligibleLaunchCount: input.eligibleLaunchCount,
    caseCount: input.caseCount,
    pageCount: input.pageCount,
    tokenObservationCount: input.tokenObservationCount,
  });
}

async function captureExploreMatrixPage(input) {
  const issuedAtMs = input.now();
  const releaseProbe = buildReadModelReleaseProbe({
    route: "exploreList",
    issuedAtMs,
    captureNonce: input.captureNonce,
    sequence: input.sequence,
    secret: input.shadowProbeToken,
  });
  const requestPath = exploreMatrixRequestPath({
    queryCase: input.queryCase,
    sort: input.sort,
    requestedPage: input.requestedPage,
    probeNonce: releaseProbe.nonce,
  });
  const startedAtMs = input.now();
  const response = await input.fetchImpl(new URL(requestPath, input.targetUrl), {
    headers: {
      Accept: "application/json",
      "x-programmable-shadow-probe": "1",
      "x-programmable-shadow-probe-signature": releaseProbe.signature,
    },
    redirect: "error",
    signal: AbortSignal.timeout(input.probeTimeoutMs),
  });
  const bodyBytes = Buffer.from(await response.arrayBuffer());
  const completedAtMs = input.now();
  let body;
  try {
    body = JSON.parse(bodyBytes.toString("utf8"));
  } catch {
    throw new Error("explore matrix response is not JSON");
  }
  const parsed = parseExploreMatrixBody(
    body,
    { ...input.queryCase, sort: input.sort },
    input.releases,
  );
  const parity = response.headers.get("x-programmable-shadow-parity") ?? "missing";
  const readSource = response.headers.get("x-programmable-read-source") ?? "missing";
  const fallback = optionalBooleanHeader(
    response,
    "x-programmable-live-fallback",
  );
  const shadowOverheadMs = optionalIntegerHeader(
    response,
    "x-programmable-shadow-overhead-ms",
  );
  const record = {
    schemaVersion: 1,
    sequence: input.sequence,
    probeIssuedAtMs: issuedAtMs,
    probeNonce: releaseProbe.nonce,
    probeSignatureSha256: sha256Bytes(
      Buffer.from(releaseProbe.signature, "hex"),
    ),
    caseId: input.queryCase.caseId,
    caseCommitment: input.queryCase.commitment,
    sort: input.sort,
    requestedPage: input.requestedPage,
    resolvedPage: parsed.page,
    pageSize: parsed.pageSize,
    total: parsed.total,
    totalPages: parsed.totalPages,
    isClamp: input.isClamp,
    requestPath,
    startedAtMs,
    completedAtMs,
    durationMs: completedAtMs - startedAtMs,
    status: response.status,
    cacheControl: response.headers.get("cache-control") ?? "missing",
    vercelCache: response.headers.get("x-vercel-cache") ?? "NONE",
    shadowOverheadMs,
    parity,
    readSource,
    fallback,
    checkpointSha256: sha256Canonical(parsed.snapshot),
    bodySha256: sha256Bytes(bodyBytes),
    bodyBytes: bodyBytes.byteLength,
    tokenRowsSha256: sha256Canonical(parsed.tokens),
    tokens: parsed.tokens,
  };
  return {
    page: Object.freeze({
      ...record,
      pageCommitment: commitExploreMatrixPage(record),
    }),
    snapshot: parsed.snapshot,
  };
}

async function captureExploreMatrixPlans(input, plans, sequenceState) {
  const results = [];
  for (
    let offset = 0;
    offset < plans.length;
    offset += input.concurrency
  ) {
    const batchPlans = plans.slice(offset, offset + input.concurrency);
    const batchInputs = batchPlans.map((plan) => ({
      ...plan,
      sequence: sequenceState.value++,
    }));
    results.push(
      ...(await Promise.all(
        batchInputs.map((plan) =>
          captureExploreMatrixPage({ ...input, ...plan }),
        ),
      )),
    );
  }
  return results;
}

function continuationPlans(firstPages, caseById) {
  return firstPages.flatMap(({ page }) => {
    if (
      !validSafeInteger(page.totalPages) ||
      page.totalPages > EXPLORE_MATRIX_MAXIMUM_PAGES_PER_CASE
    ) {
      throw new Error("explore matrix page count exceeds the bounded corpus");
    }
    const queryCase = caseById.get(page.caseId);
    if (!queryCase) throw new Error("explore matrix case binding is missing");
    return [
      ...Array.from(
        { length: Math.max(0, page.totalPages - 1) },
        (_, index) => ({
          queryCase,
          sort: page.sort,
          requestedPage: index + 2,
          isClamp: false,
        }),
      ),
      {
        queryCase,
        sort: page.sort,
        requestedPage: EXPLORE_MATRIX_CLAMP_PAGE,
        isClamp: true,
      },
    ];
  });
}

function inventoryFromEmptyPages(pages, releases) {
  const newestPages = pages
    .filter(
      (page) =>
        page.caseId === "empty" &&
        page.sort === "newest" &&
        page.isClamp === false,
    )
    .sort((left, right) => left.requestedPage - right.requestedPage);
  const inventory = newestPages.flatMap((page) => page.tokens);
  const observed = inventory.map((token) => token.tokenAddress);
  const expected = [...releases.keys()].sort();
  if (
    new Set(observed).size !== observed.length ||
    observed.length !== expected.length ||
    [...observed].sort().some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      "explore matrix empty traversal does not equal the frozen launch inventory",
    );
  }
  return inventory;
}

export async function captureExploreMatrix(input) {
  const releases = eligibleLaunchIndex(input.datasetManifest.eligibleLaunches);
  const common = {
    targetUrl: input.targetUrl,
    captureNonce: input.captureNonce,
    shadowProbeToken: input.shadowProbeToken,
    probeTimeoutMs: input.probeTimeoutMs,
    releases,
    fetchImpl: input.fetchImpl ?? fetch,
    now: input.now ?? Date.now,
    concurrency: Math.max(1, Math.min(20, input.concurrency ?? 8)),
  };
  const sequenceState = { value: 0 };
  const emptyCase = emptyExploreMatrixCase();
  const emptyFirst = await captureExploreMatrixPlans(
    common,
    EXPLORE_MATRIX_SORTS.map((sort) => ({
      queryCase: emptyCase,
      sort,
      requestedPage: 1,
      isClamp: false,
    })),
    sequenceState,
  );
  const emptyCaseById = new Map([[emptyCase.caseId, emptyCase]]);
  const emptyRest = await captureExploreMatrixPlans(
    common,
    continuationPlans(emptyFirst, emptyCaseById),
    sequenceState,
  );
  const emptyPages = [...emptyFirst, ...emptyRest].map((entry) => entry.page);
  const inventory = inventoryFromEmptyPages(emptyPages, releases);
  const cases = buildExploreMatrixCases(inventory);
  const queryCases = cases.filter((queryCase) => queryCase.kind !== "empty");
  const caseById = new Map(cases.map((queryCase) => [queryCase.caseId, queryCase]));
  const queryFirst = await captureExploreMatrixPlans(
    common,
    queryCases.flatMap((queryCase) =>
      EXPLORE_MATRIX_SORTS.map((sort) => ({
        queryCase,
        sort,
        requestedPage: 1,
        isClamp: false,
      })),
    ),
    sequenceState,
  );
  const queryRest = await captureExploreMatrixPlans(
    common,
    continuationPlans(queryFirst, caseById),
    sequenceState,
  );
  const captured = [...emptyFirst, ...emptyRest, ...queryFirst, ...queryRest];
  const pages = captured.map((entry) => entry.page);
  const pagesBytes = Buffer.from(serializeExploreMatrixPages(pages), "utf8");
  const pagesSha256 = sha256Bytes(pagesBytes);
  const casesSha256 = sha256Canonical(cases);
  const checkpoint = captured[0]?.snapshot;
  if (!checkpoint) throw new Error("explore matrix checkpoint is missing");
  const checkpointSha256 = sha256Canonical(checkpoint);
  const inventorySha256 = frozenInventoryCommitment(
    input.datasetManifest.eligibleLaunches,
  );
  const target = {
    url: input.targetUrl.toString(),
    vercelDeploymentId: input.deploymentId,
    gitHead: input.gitHead,
  };
  const caseCounts = Object.fromEntries(
    ["empty", "name", "symbol", "address"].map((kind) => [
      kind,
      cases.filter((queryCase) => queryCase.kind === kind).length,
    ]),
  );
  const tokenObservationCount = pages.reduce(
    (total, page) => total + page.tokens.length,
    0,
  );
  const corpusInput = {
    captureNonce: input.captureNonce,
    target,
    datasetManifestSha256: input.datasetManifestSha256,
    inventorySha256,
    casesSha256,
    pagesSha256,
    checkpointSha256,
    eligibleLaunchCount: input.datasetManifest.eligibleLaunches.length,
    caseCount: cases.length,
    pageCount: pages.length,
    tokenObservationCount,
  };
  const manifest = Object.freeze({
    schemaVersion: 1,
    profileId: input.profileId,
    captureNonce: input.captureNonce,
    capturedAt: new Date((input.now ?? Date.now)()).toISOString(),
    target,
    dataset: {
      manifestFile: "dataset-manifest.v1.json",
      manifestSha256: input.datasetManifestSha256,
      generatedAt: input.datasetManifest.generatedAt,
      eligibleLaunchCount: input.datasetManifest.eligibleLaunches.length,
      releaseCounts: input.datasetManifest.releaseCounts,
      inventorySha256,
    },
    checkpoint: {
      snapshot: checkpoint,
      snapshotSha256: checkpointSha256,
    },
    matrix: {
      sorts: EXPLORE_MATRIX_SORTS,
      pageSize: EXPLORE_MATRIX_PAGE_SIZE,
      maxQueryCasesPerKind: EXPLORE_MATRIX_MAX_QUERY_CASES_PER_KIND,
      cases,
      casesSha256,
      caseCounts,
      caseCount: cases.length,
      pageCount: pages.length,
      tokenObservationCount,
      pagesFile: EXPLORE_MATRIX_PAGES_FILE,
      pagesSha256,
      corpusSha256: exploreMatrixCorpusCommitment(corpusInput),
    },
  });
  if (!HEX_DIGEST.test(manifest.matrix.corpusSha256)) {
    throw new Error("explore matrix corpus commitment failed");
  }
  return { manifest, pages, pagesBytes };
}

async function captureSample(input) {
  const request = requestPath(
    input.route,
    input.sequence,
    input.keyIndex,
    input.keys,
    input.captureNonce,
    input.probeIssuedAtMs,
    input.shadowProbeToken,
  );
  const startedAtMs = Date.now();
  const headers = { Accept: "application/json" };
  const shadowProbe = SHADOW_PROBE_ROUTES.has(input.route);
  if (shadowProbe) {
    headers["x-programmable-shadow-probe"] = "1";
    headers["x-programmable-shadow-probe-signature"] =
      request.releaseProbe.signature;
  }
  try {
    const response = await fetch(new URL(request.path, input.targetUrl), {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(input.probeTimeoutMs),
    });
    const body = Buffer.from(await response.arrayBuffer());
    const completedAtMs = Date.now();
    const parity = response.headers.get("x-programmable-shadow-parity");
    const readSource = response.headers.get("x-programmable-read-source");
    let parsedBody;
    try {
      parsedBody = JSON.parse(body.toString("utf8"));
    } catch {
      parsedBody = null;
    }
    return {
      route: input.route,
      requestKey: request.key,
      datasetKey: request.datasetKey,
      keyMatched: responseMatchesDatasetKey(
        input.route,
        parsedBody,
        request.datasetKey,
        input.route === "tokenChart"
          ? input.sequence % 2 === 1
            ? "1h"
            : "all"
          : undefined,
      ),
      startedAtMs,
      completedAtMs,
      durationMs: completedAtMs - startedAtMs,
      status: response.status,
      cacheControl: response.headers.get("cache-control") ?? "missing",
      vercelCache: response.headers.get("x-vercel-cache") ?? "NONE",
      bodySha256: sha256Bytes(body),
      bodyBytes: body.byteLength,
      shadowOverheadMs: optionalIntegerHeader(
        response,
        "x-programmable-shadow-overhead-ms",
      ),
      parity:
        parity === "match" ||
        parity === "mismatch" ||
        parity === "incomparable"
          ? parity
          : shadowProbe
            ? "missing"
            : "not-observed",
      readSource:
        readSource === "rpc" || readSource === "blob" || readSource === "indexed"
          ? readSource
          : shadowProbe
            ? "missing"
            : "not-observed",
      fallback:
        shadowProbe
          ? optionalBooleanHeader(
              response,
              "x-programmable-live-fallback",
            )
          : null,
    };
  } catch (error) {
    const completedAtMs = Date.now();
    const body = Buffer.from(
      error instanceof Error ? error.name : "RequestError",
    );
    return {
      route: input.route,
      requestKey: request.key,
      datasetKey: request.datasetKey,
      keyMatched: false,
      startedAtMs,
      completedAtMs,
      durationMs: completedAtMs - startedAtMs,
      status: 599,
      cacheControl: "missing",
      vercelCache: "NONE",
      bodySha256: sha256Bytes(body),
      bodyBytes: body.byteLength,
      shadowOverheadMs: null,
      parity: shadowProbe ? "missing" : "not-observed",
      readSource: shadowProbe ? "missing" : "not-observed",
      fallback: null,
    };
  }
}

function exactKeys(value, expected, subject) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${subject} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`${subject} has an unexpected shape`);
  }
  return value;
}

async function runtimeEvidence(input) {
  const startedAtMs = Date.now();
  const requestBody = JSON.stringify({
    schemaVersion: 2,
    profileId: input.profile.profileId,
    gitHead: input.gitHead,
    targetUrl: input.targetUrl.toString(),
    vercelDeploymentId: input.deploymentId,
    captureNonce: input.captureNonce,
    issuedAtMs: startedAtMs,
  });
  const releaseSignature = createHmac(
    "sha256",
    input.performanceProbeToken,
  )
    .update(requestBody, "utf8")
    .digest("hex");
  const response = await fetch(
    new URL(RUNTIME_CAPTURE_PATH, input.targetUrl),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-programmable-performance-probe": "1",
        "x-programmable-performance-probe-token": input.performanceProbeToken,
        "x-programmable-release-capture-signature": `v1=${releaseSignature}`,
      },
      body: requestBody,
      redirect: "error",
      signal: AbortSignal.timeout(input.profile.projector.hostingDeadlineMs),
    },
  );
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    !response.ok ||
    (Number.isFinite(declaredLength) &&
      declaredLength > MAX_RUNTIME_EVIDENCE_BYTES) ||
    response.headers.get("cache-control") !== "private, no-store"
  ) {
    throw new Error("staged runtime evidence endpoint rejected the capture");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const completedAtMs = Date.now();
  if (bytes.byteLength < 2 || bytes.byteLength > MAX_RUNTIME_EVIDENCE_BYTES) {
    throw new Error("staged runtime evidence has an invalid size");
  }
  let payload;
  try {
    payload = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("staged runtime evidence is not JSON");
  }
  const envelope = exactKeys(
    payload,
    ["schemaVersion", "captureNonce", "datasetManifest", "rpcTrace"],
    "runtime evidence",
  );
  const rpcTrace = exactKeys(
    envelope.rpcTrace,
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
    "runtime RPC trace",
  );
  const datasetManifest = exactKeys(
    envelope.datasetManifest,
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
    "runtime dataset manifest",
  );
  const datasetGeneratedAtMs = Date.parse(datasetManifest.generatedAt);
  if (
    envelope.schemaVersion !== 1 ||
    envelope.captureNonce !== input.captureNonce ||
    rpcTrace.schemaVersion !== 1 ||
    rpcTrace.profileId !== input.profile.profileId ||
    rpcTrace.gitHead !== input.gitHead ||
    new URL(rpcTrace.targetUrl).toString() !== input.targetUrl.toString() ||
    rpcTrace.vercelDeploymentId !== input.deploymentId ||
    rpcTrace.captureNonce !== input.captureNonce ||
    !Number.isSafeInteger(rpcTrace.startedAtMs) ||
    !Number.isSafeInteger(rpcTrace.completedAtMs) ||
    rpcTrace.startedAtMs < startedAtMs - 5_000 ||
    rpcTrace.completedAtMs > completedAtMs + 5_000 ||
    datasetManifest.schemaVersion !== 1 ||
    datasetManifest.profileId !== input.profile.profileId ||
    !Number.isFinite(datasetGeneratedAtMs) ||
    datasetGeneratedAtMs < startedAtMs - 5_000 ||
    datasetGeneratedAtMs > completedAtMs + 5_000
  ) {
    throw new Error("staged runtime evidence is not bound to this capture");
  }
  return { datasetManifest, rpcTrace };
}

function exclusiveWrite(path, contents) {
  writeFileSync(path, contents, { flag: "wx", mode: 0o600 });
}

export async function main(argv = process.argv.slice(2)) {
  const rootDirectory = process.cwd();
  const args = argumentsFrom(argv);
  const profile = parseReadModelLoadProfile(
    JSON.parse(
      readFileSync(
        resolve(rootDirectory, "config/read-model-release-profile.v1.json"),
        "utf8",
      ),
    ),
  );
  const targetUrl = new URL(args["target-url"]);
  if (
    targetUrl.protocol !== "https:" ||
    targetUrl.username !== "" ||
    targetUrl.password !== "" ||
    targetUrl.pathname !== "/" ||
    targetUrl.search !== "" ||
    targetUrl.hash !== "" ||
    !targetUrl.hostname.endsWith(".vercel.app")
  ) {
    throw new Error("--target-url must be a deployment-specific Vercel URL");
  }
  if (!/^dpl_[A-Za-z0-9]{20,80}$/u.test(args["deployment-id"])) {
    throw new Error("--deployment-id must be a Vercel deployment id");
  }
  const outputDirectory = resolve(args["output-directory"]);
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const currentGitHead = gitHead(rootDirectory);
  const captureNonce = `0x${randomBytes(32).toString("hex")}`;
  if (!BYTES32.test(captureNonce)) throw new Error("capture nonce failed");
  const performanceProbeToken = secret(
    process.env,
    "PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN",
  );
  const shadowProbeToken = secret(
    process.env,
    "PROGRAMMABLE_SHADOW_PROBE_TOKEN",
  );
  const capturedRuntime = await runtimeEvidence({
    targetUrl,
    deploymentId: args["deployment-id"],
    profile,
    gitHead: currentGitHead,
    captureNonce,
    performanceProbeToken,
  });
  if (!Array.isArray(capturedRuntime.datasetManifest.eligibleLaunches)) {
    throw new Error("runtime dataset has no eligible launch corpus");
  }
  const loadKeys = {
    tokenAddresses: capturedRuntime.datasetManifest.keys.tokenAddresses,
    accountAddresses: capturedRuntime.datasetManifest.keys.accountAddresses,
    classicLaunches: capturedRuntime.datasetManifest.keys.classicLaunches,
    stockLaunches: capturedRuntime.datasetManifest.keys.stockLaunches,
  };
  const schedule = deterministicSchedule(profile);
  const probeIssuedAtMs = Date.now();
  const samples = [];
  const routeKeyClass = (route) =>
    ["exploreList", "tokenDetail", "tokenChart", "publicIndexer"].includes(route)
      ? "token"
      : ["creatorProfile", "classicProfile", "stockProfile"].includes(route)
        ? "account"
        : route === "classicLaunchLookup"
          ? "classic"
          : route === "stockLaunchLookup"
            ? "stock"
            : "health";
  const keyClassIndexes = new Map(
    ["token", "account", "classic", "stock", "health"].map((key) => [key, 0]),
  );
  if (
    schedule.length !== profile.load.minimumCompletedRequests ||
    schedule.length % profile.load.concurrency !== 0
  ) {
    throw new Error("load schedule must be one exact concurrency-aligned cycle");
  }
  const batchCount = schedule.length / profile.load.concurrency;
  const captureDurationMs = profile.load.durationSeconds * 1_000;
  let loadAnchorMs;
  for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
    if (batchIndex > 0 && batchCount > 1) {
      const scheduledStart =
        loadAnchorMs +
        Math.floor((batchIndex * captureDurationMs) / (batchCount - 1));
      const delayMs = scheduledStart - Date.now();
      if (delayMs > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
      }
    }
    const batchStart = samples.length;
    const routes = Array.from(
      { length: profile.load.concurrency },
      (_, offset) => {
        const route = schedule[(batchStart + offset) % schedule.length];
        const keyClass = routeKeyClass(route);
        const keyIndex = keyClassIndexes.get(keyClass);
        keyClassIndexes.set(keyClass, keyIndex + 1);
        return { route, keyIndex };
      },
    );
    const batch = await Promise.all(
      routes.map(({ route, keyIndex }, offset) =>
        captureSample({
          targetUrl,
          route,
          sequence: batchStart + offset,
          keyIndex,
          keys: loadKeys,
          captureNonce,
          probeIssuedAtMs,
          shadowProbeToken,
          probeTimeoutMs: profile.load.probeTimeoutMs,
        }),
      ),
    );
    samples.push(...batch);
    if (batchIndex === 0) {
      loadAnchorMs = Math.min(...batch.map((sample) => sample.startedAtMs));
    }
  }

  const datasetFile = "dataset-manifest.v1.json";
  const samplesFile = "http-samples.v1.jsonl";
  const rpcTraceFile = "rpc-trace.v1.json";
  const datasetContents = `${JSON.stringify(capturedRuntime.datasetManifest, null, 2)}\n`;
  const datasetManifestSha256 = sha256Bytes(
    Buffer.from(datasetContents, "utf8"),
  );
  const exploreMatrix = await captureExploreMatrix({
    targetUrl,
    deploymentId: args["deployment-id"],
    profileId: profile.profileId,
    gitHead: currentGitHead,
    captureNonce,
    shadowProbeToken,
    probeTimeoutMs: profile.load.probeTimeoutMs,
    concurrency: profile.load.concurrency,
    datasetManifest: capturedRuntime.datasetManifest,
    datasetManifestSha256,
  });

  exclusiveWrite(resolve(outputDirectory, datasetFile), datasetContents);
  exclusiveWrite(
    resolve(outputDirectory, rpcTraceFile),
    `${JSON.stringify(capturedRuntime.rpcTrace, null, 2)}\n`,
  );
  exclusiveWrite(
    resolve(outputDirectory, samplesFile),
    `${samples.map((sample) => JSON.stringify(sample)).join("\n")}\n`,
  );
  exclusiveWrite(
    resolve(outputDirectory, EXPLORE_MATRIX_PAGES_FILE),
    exploreMatrix.pagesBytes,
  );
  exclusiveWrite(
    resolve(outputDirectory, EXPLORE_MATRIX_MANIFEST_FILE),
    `${JSON.stringify(exploreMatrix.manifest, null, 2)}\n`,
  );
  const artifactDescriptor = (file) => ({
    file,
    sha256: sha256Bytes(readFileSync(resolve(outputDirectory, file))),
  });
  const evidence = {
    schemaVersion: 1,
    profileId: profile.profileId,
    evidenceKind: args.kind,
    capturedAt: new Date().toISOString(),
    captureNonce,
    target: {
      url: targetUrl.toString(),
      vercelDeploymentId: args["deployment-id"],
      gitHead: currentGitHead,
    },
    artifacts: {
      datasetManifest: artifactDescriptor(datasetFile),
      httpSamples: artifactDescriptor(samplesFile),
      rpcTrace: artifactDescriptor(rpcTraceFile),
    },
  };
  const evidencePath = resolve(
    outputDirectory,
    "read-model-release-evidence.v1.json",
  );
  exclusiveWrite(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  if (args["github-output"]) {
    appendFileSync(
      resolve(args["github-output"]),
      `evidence_path=${evidencePath}\nevidence_directory=${outputDirectory}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }
  const outputArtifacts = {
    ...evidence.artifacts,
    exploreMatrixManifest: artifactDescriptor(EXPLORE_MATRIX_MANIFEST_FILE),
    exploreMatrixPages: artifactDescriptor(EXPLORE_MATRIX_PAGES_FILE),
  };
  process.stdout.write(
    `${JSON.stringify({
      mode: "capture",
      releaseEvidenceAccepted: false,
      evidencePath,
      sampleCount: samples.length,
      exploreMatrixPageCount: exploreMatrix.pages.length,
      artifacts: Object.fromEntries(
        Object.entries(outputArtifacts).map(([key, value]) => [
          key,
          { file: basename(value.file), sha256: value.sha256 },
        ]),
      ),
    })}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
