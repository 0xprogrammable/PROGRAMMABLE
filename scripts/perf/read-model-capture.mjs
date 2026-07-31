#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";

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
  const response = await fetch(
    new URL(RUNTIME_CAPTURE_PATH, input.targetUrl),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-programmable-performance-probe": "1",
        "x-programmable-performance-probe-token": input.performanceProbeToken,
      },
      body: JSON.stringify({
        schemaVersion: 1,
        profileId: input.profile.profileId,
        gitHead: input.gitHead,
        targetUrl: input.targetUrl.toString(),
        vercelDeploymentId: input.deploymentId,
        captureNonce: input.captureNonce,
      }),
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

const rootDirectory = process.cwd();
const args = argumentsFrom(process.argv.slice(2));
const profile = parseReadModelLoadProfile(
  JSON.parse(
    readFileSync(
      resolve(rootDirectory, "config/read-model-load-profile.v1.json"),
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
exclusiveWrite(
  resolve(outputDirectory, datasetFile),
  `${JSON.stringify(capturedRuntime.datasetManifest, null, 2)}\n`,
);
exclusiveWrite(
  resolve(outputDirectory, rpcTraceFile),
  `${JSON.stringify(capturedRuntime.rpcTrace, null, 2)}\n`,
);
exclusiveWrite(
  resolve(outputDirectory, samplesFile),
  `${samples.map((sample) => JSON.stringify(sample)).join("\n")}\n`,
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
process.stdout.write(
  `${JSON.stringify({
    mode: "capture",
    releaseEvidenceAccepted: false,
    evidencePath,
    sampleCount: samples.length,
    artifacts: Object.fromEntries(
      Object.entries(evidence.artifacts).map(([key, value]) => [
        key,
        { file: basename(value.file), sha256: value.sha256 },
      ]),
    ),
  })}\n`,
);
