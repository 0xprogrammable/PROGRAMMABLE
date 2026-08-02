#!/usr/bin/env node

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  canonicalJson,
  commitReadModelReleaseEvidence,
  readModelReleaseEvidenceCommitment,
} from "./read-model-evidence-commitment.mjs";

export const REAL_BLOCK_SLA_EVIDENCE_KIND =
  "programmable-real-block-sla-evidence";
export const REAL_BLOCK_SLA_MAXIMUM_LATENCY_MS = 10_000;
export const REAL_BLOCK_SLA_MAXIMUM_EVIDENCE_AGE_MS = 10 * 60 * 1_000;

const MAXIMUM_EVIDENCE_BYTES = 1024 * 1024;
const MAXIMUM_DELIVERY_AGE_MS = 5 * 60 * 1_000;
const MAXIMUM_FUTURE_SKEW_MS = 30 * 1_000;
const MAXIMUM_BLOCK_AGE_AT_DELIVERY_MS = 2 * 60 * 1_000;
const COMMIT = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{20,80}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NONZERO_BYTES32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const UINT = /^(?:0|[1-9][0-9]{0,18})$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SAFE_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function fail(label) {
  throw new Error(`real block SLA evidence ${label} is invalid`);
}

function object(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(label);
  }
  return value;
}

function exactObject(value, label, keys) {
  const result = object(value, label);
  const actual = Object.keys(result).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(label);
  return result;
}

function exactString(value, label, expected) {
  if (value !== expected) fail(label);
  return value;
}

function pattern(value, label, expression) {
  if (typeof value !== "string" || !expression.test(value)) fail(label);
  return value;
}

function identifier(value, label) {
  return pattern(value, label, SAFE_ID);
}

function bytes32(value, label) {
  return pattern(value, label, NONZERO_BYTES32);
}

function uint(value, label) {
  const result = pattern(value, label, UINT);
  if (BigInt(result) > 9_223_372_036_854_775_807n) fail(label);
  return result;
}

function count(value, label, minimum = 0, maximum = 1_000_000) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(label);
  }
  return value;
}

function metadataProviderCallCount(value, tokenCount, label) {
  const result = count(value, label, 0, tokenCount * 6);
  if (
    tokenCount === 0
      ? result !== 0
      : result < tokenCount * 2 || result % 2 !== 0
  ) {
    fail(label);
  }
  return result;
}

function timestamp(value, label) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    fail(label);
  }
  return value;
}

function timestampMs(value, label) {
  return Date.parse(timestamp(value, label));
}

function exactOrigin(value, label) {
  let target;
  try {
    target = new URL(value);
  } catch {
    return fail(label);
  }
  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    target.pathname !== "/" ||
    target.search !== "" ||
    target.hash !== "" ||
    !target.hostname.endsWith(".vercel.app")
  ) {
    fail(label);
  }
  return target.origin;
}

function apiSurfaceUrl(value, label, expectedOrigin, surface, tokenAddress) {
  let target;
  try {
    target = new URL(value);
  } catch {
    return fail(label);
  }
  if (
    target.protocol !== "https:" ||
    target.origin !== expectedOrigin ||
    target.username !== "" ||
    target.password !== "" ||
    target.hash !== ""
  ) {
    fail(label);
  }
  const keys = [...target.searchParams.keys()].sort();
  const address = target.searchParams.get("address")?.toLowerCase();
  if (
    address !== tokenAddress ||
    target.searchParams.getAll("address").length !== 1
  ) {
    fail(label);
  }
  if (surface === "explore-token") {
    if (
      target.pathname !== "/api/explore/token" ||
      canonicalJson(keys) !== canonicalJson(["address"])
    ) {
      fail(label);
    }
  } else if (surface === "classic-chart") {
    const range = target.searchParams.get("range");
    if (
      target.pathname !== "/api/explore/token/chart" ||
      canonicalJson(keys) !== canonicalJson(["address", "range"]) ||
      !["1h", "1d", "1w", "all"].includes(range)
    ) {
      fail(label);
    }
  } else {
    fail(label);
  }
  return target.toString();
}

function sameBytes32(left, right, label) {
  if (
    !timingSafeEqual(
      Buffer.from(bytes32(left, label).slice(2), "hex"),
      Buffer.from(bytes32(right, label).slice(2), "hex"),
    )
  ) {
    fail(label);
  }
}

function commitmentFor(payload) {
  return readModelReleaseEvidenceCommitment(payload);
}

function assertedCommitment(actual, payload, label) {
  sameBytes32(actual, commitmentFor(payload), label);
  return actual;
}

export function queueRowEvidenceCommitment(queue) {
  return commitmentFor({
    wakeId: queue.wakeId,
    blockNumber: queue.blockNumber,
    nonceDigest: queue.nonceDigest,
    payloadSha256: queue.payloadSha256,
    persistedAt: queue.persistedAt,
  });
}

export function databaseBundleEvidenceCommitment(database) {
  return commitmentFor({
    transactionCommittedAt: database.transactionCommittedAt,
    chainHead: database.chainHead,
    blockEvidence: database.blockEvidence,
    eventEvidence: database.eventEvidence,
    marketEvidence: database.marketEvidence,
  });
}

export function commitRealBlockSlaEvidence(payload) {
  return commitReadModelReleaseEvidence(payload);
}

function assertTopLevelCommitment(evidence) {
  bytes32(evidence.evidenceSha256, "top-level commitment");
  sameBytes32(
    evidence.evidenceSha256,
    readModelReleaseEvidenceCommitment(evidence),
    "top-level commitment",
  );
}

function assertProvider(value, providerId, block) {
  const provider = exactObject(value, `${providerId} provider`, [
    "providerId",
    "providerDeploymentId",
    "endpointHost",
    "endpointUrlSha256",
    "blockEvidenceHead",
    "marketStateHead",
    "blockEvidenceCallCount",
    "marketStateCallCount",
    "totalCallCount",
  ]);
  exactString(provider.providerId, `${providerId} identity`, providerId);
  pattern(provider.providerDeploymentId, `${providerId} deployment`, UUID);
  const endpointHost = pattern(
    provider.endpointHost,
    `${providerId} endpoint host`,
    SAFE_HOST,
  );
  if (
    (providerId === "alchemy" &&
      endpointHost !== "alchemy.com" &&
      !endpointHost.endsWith(".alchemy.com")) ||
    (providerId === "quicknode" &&
      endpointHost !== "quicknode.com" &&
      !endpointHost.endsWith(".quicknode.com") &&
      endpointHost !== "quiknode.pro" &&
      !endpointHost.endsWith(".quiknode.pro"))
  ) {
    fail(`${providerId} endpoint host`);
  }
  bytes32(provider.endpointUrlSha256, `${providerId} endpoint commitment`);
  const blockNumber = BigInt(block.blockNumber);
  const providerHead = (value, phase) => {
    const head = exactObject(value, `${providerId} ${phase} head`, [
      "blockNumber",
      "blockHash",
      "observedAt",
    ]);
    const number = BigInt(
      uint(head.blockNumber, `${providerId} ${phase} head block`),
    );
    bytes32(head.blockHash, `${providerId} ${phase} head hash`);
    const observedAt = timestampMs(
      head.observedAt,
      `${providerId} ${phase} head observation`,
    );
    const confirmations = number - blockNumber;
    if (confirmations < 0n || confirmations > 11n) {
      fail(`${providerId} ${phase} confirmations`);
    }
    if (number === blockNumber && head.blockHash !== block.blockHash) {
      fail(`${providerId} ${phase} target hash`);
    }
    return { confirmations: Number(confirmations), number, observedAt };
  };
  const blockHead = providerHead(provider.blockEvidenceHead, "block evidence");
  const marketHead = providerHead(provider.marketStateHead, "market state");
  if (
    marketHead.number < blockHead.number ||
    (marketHead.number === blockHead.number &&
      provider.marketStateHead.blockHash !==
        provider.blockEvidenceHead.blockHash)
  ) {
    fail(`${providerId} head ordering`);
  }
  if (
    count(provider.blockEvidenceCallCount, `${providerId} block calls`) !== 4 ||
    count(provider.marketStateCallCount, `${providerId} market calls`) !== 7 ||
    count(provider.totalCallCount, `${providerId} total calls`) !== 11
  ) {
    fail(`${providerId} call count`);
  }
  return { blockHead, marketHead };
}

function assertDatabase(databaseValue, block, delivery) {
  const database = exactObject(databaseValue, "database", [
    "transactionCommittedAt",
    "chainHead",
    "blockEvidence",
    "eventEvidence",
    "marketEvidence",
    "bundleEvidenceCommitment",
  ]);
  const chainHead = exactObject(database.chainHead, "database chain head", [
    "chainId",
    "blockNumber",
    "blockHash",
    "generation",
  ]);
  if (chainHead.chainId !== 1) fail("database chain");
  uint(chainHead.generation, "database generation");

  const blockEvidence = exactObject(
    database.blockEvidence,
    "database block evidence",
    ["blockNumber", "blockHash", "evidenceCommitment"],
  );
  const eventEvidence = exactObject(
    database.eventEvidence,
    "database event evidence",
    ["blockNumber", "blockHash", "rowCount", "evidenceCommitment"],
  );
  const marketEvidence = exactObject(
    database.marketEvidence,
    "database market evidence",
    ["blockNumber", "blockHash", "rowCount", "evidenceCommitment"],
  );
  for (const [label, record] of [
    ["database chain head", chainHead],
    ["database block evidence", blockEvidence],
    ["database event evidence", eventEvidence],
    ["database market evidence", marketEvidence],
  ]) {
    if (
      uint(record.blockNumber, `${label} block`) !== block.blockNumber ||
      bytes32(record.blockHash, `${label} hash`) !== block.blockHash
    ) {
      fail(label);
    }
  }
  bytes32(blockEvidence.evidenceCommitment, "database block commitment");
  count(eventEvidence.rowCount, "database event row count");
  bytes32(eventEvidence.evidenceCommitment, "database event commitment");
  count(marketEvidence.rowCount, "database market row count", 1);
  bytes32(marketEvidence.evidenceCommitment, "database market commitment");
  const committedAt = timestampMs(
    database.transactionCommittedAt,
    "database commit timestamp",
  );
  if (committedAt < delivery.queueResponseAt) fail("database commit ordering");
  assertedCommitment(
    database.bundleEvidenceCommitment,
    {
      transactionCommittedAt: database.transactionCommittedAt,
      chainHead,
      blockEvidence,
      eventEvidence,
      marketEvidence,
    },
    "database bundle commitment",
  );
  return { committedAt, marketEvidence };
}

function normalizedExpected(input) {
  const repositoryCommit = pattern(
    input.expectedRepositoryCommit,
    "expected repository commit",
    COMMIT,
  );
  const deploymentId = pattern(
    input.expectedDeploymentId,
    "expected deployment ID",
    DEPLOYMENT_ID,
  );
  const targetOrigin = exactOrigin(input.expectedTargetUrl, "expected target");
  const nowMs = input.nowMs ?? Date.now();
  const maximumEvidenceAgeMs =
    input.maximumEvidenceAgeMs ?? REAL_BLOCK_SLA_MAXIMUM_EVIDENCE_AGE_MS;
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(maximumEvidenceAgeMs) ||
    maximumEvidenceAgeMs < 1_000 ||
    maximumEvidenceAgeMs > REAL_BLOCK_SLA_MAXIMUM_EVIDENCE_AGE_MS
  ) {
    fail("verification clock");
  }
  return { repositoryCommit, deploymentId, targetOrigin, nowMs, maximumEvidenceAgeMs };
}

export function verifyRealBlockSlaEvidence(evidenceValue, input) {
  const expected = normalizedExpected(input);
  const evidence = exactObject(evidenceValue, "root", [
    "kind",
    "schemaVersion",
    "repositoryCommit",
    "capturedAt",
    "deployment",
    "activity",
    "quickNodeDelivery",
    "queue",
    "dualRpc",
    "optimisticDatabase",
    "api",
    "sla",
    "evidenceSha256",
  ]);
  assertTopLevelCommitment(evidence);
  exactString(evidence.kind, "kind", REAL_BLOCK_SLA_EVIDENCE_KIND);
  if (evidence.schemaVersion !== 1) fail("schema version");
  if (
    pattern(evidence.repositoryCommit, "repository commit", COMMIT) !==
    expected.repositoryCommit
  ) {
    fail("repository binding");
  }
  const capturedAt = timestampMs(evidence.capturedAt, "capture timestamp");
  if (
    capturedAt < expected.nowMs - expected.maximumEvidenceAgeMs ||
    capturedAt > expected.nowMs + MAXIMUM_FUTURE_SKEW_MS
  ) {
    fail("capture freshness");
  }

  const deployment = exactObject(evidence.deployment, "deployment", [
    "id",
    "url",
    "projectId",
    "readyState",
    "repositoryCommit",
  ]);
  if (
    pattern(deployment.id, "deployment ID", DEPLOYMENT_ID) !==
      expected.deploymentId ||
    exactOrigin(deployment.url, "deployment URL") !== expected.targetOrigin ||
    deployment.repositoryCommit !== expected.repositoryCommit ||
    deployment.readyState !== "READY"
  ) {
    fail("deployment binding");
  }
  identifier(deployment.projectId, "deployment project");

  const activity = exactObject(evidence.activity, "activity", [
    "kind",
    "signingPerformed",
    "spendingPerformed",
  ]);
  if (
    activity.kind !== "organic-stream-block" ||
    activity.signingPerformed !== false ||
    activity.spendingPerformed !== false
  ) {
    fail("organic activity");
  }

  const delivery = exactObject(evidence.quickNodeDelivery, "delivery", [
    "deliveryId",
    "streamId",
    "nonceDigest",
    "payloadSha256",
    "chainId",
    "blockNumber",
    "blockHash",
    "blockTimestamp",
    "signedAt",
    "requestReceivedAt",
  ]);
  identifier(delivery.deliveryId, "delivery ID");
  identifier(delivery.streamId, "stream ID");
  bytes32(delivery.nonceDigest, "delivery nonce digest");
  bytes32(delivery.payloadSha256, "delivery payload commitment");
  if (delivery.chainId !== 1) fail("delivery chain");
  const block = {
    blockNumber: uint(delivery.blockNumber, "delivery block"),
    blockHash: bytes32(delivery.blockHash, "delivery block hash"),
  };
  const blockTimestamp = timestampMs(
    delivery.blockTimestamp,
    "delivery block timestamp",
  );
  const signedAt = timestampMs(delivery.signedAt, "delivery signed timestamp");
  const requestReceivedAt = timestampMs(
    delivery.requestReceivedAt,
    "delivery receipt timestamp",
  );
  if (
    signedAt < requestReceivedAt - MAXIMUM_DELIVERY_AGE_MS ||
    signedAt > requestReceivedAt + MAXIMUM_FUTURE_SKEW_MS ||
    blockTimestamp < requestReceivedAt - MAXIMUM_BLOCK_AGE_AT_DELIVERY_MS ||
    blockTimestamp > requestReceivedAt + MAXIMUM_FUTURE_SKEW_MS
  ) {
    fail("delivery freshness");
  }

  const queue = exactObject(evidence.queue, "queue", [
    "wakeId",
    "blockNumber",
    "nonceDigest",
    "payloadSha256",
    "enqueued",
    "persistedAt",
    "rowCommitment",
    "response",
    "duplicate",
  ]);
  uint(queue.wakeId, "queue wake ID");
  if (
    uint(queue.blockNumber, "queue block") !== block.blockNumber ||
    bytes32(queue.nonceDigest, "queue nonce digest") !== delivery.nonceDigest ||
    bytes32(queue.payloadSha256, "queue payload commitment") !==
      delivery.payloadSha256 ||
    queue.enqueued !== true
  ) {
    fail("queue binding");
  }
  const persistedAt = timestampMs(queue.persistedAt, "queue persistence timestamp");
  if (persistedAt < requestReceivedAt) fail("queue persistence ordering");
  assertedCommitment(
    queue.rowCommitment,
    {
      wakeId: queue.wakeId,
      blockNumber: queue.blockNumber,
      nonceDigest: queue.nonceDigest,
      payloadSha256: queue.payloadSha256,
      persistedAt: queue.persistedAt,
    },
    "queue row commitment",
  );
  const response = exactObject(queue.response, "queue response", [
    "status",
    "sentAt",
    "cacheControl",
  ]);
  const queueResponseAt = timestampMs(response.sentAt, "queue response timestamp");
  if (
    response.status !== 202 ||
    response.cacheControl !== "no-store" ||
    persistedAt > queueResponseAt
  ) {
    fail("queue persisted-before-202 proof");
  }
  const duplicate = exactObject(queue.duplicate, "duplicate delivery", [
    "receivedAt",
    "responseStatus",
    "enqueued",
    "wakeId",
    "queueRowCountBefore",
    "queueRowCountAfter",
    "secondJobCreated",
  ]);
  const duplicateReceivedAt = timestampMs(
    duplicate.receivedAt,
    "duplicate timestamp",
  );
  if (
    duplicateReceivedAt < queueResponseAt ||
    duplicate.responseStatus !== 202 ||
    duplicate.enqueued !== false ||
    duplicate.wakeId !== queue.wakeId ||
    duplicate.queueRowCountBefore !== 1 ||
    duplicate.queueRowCountAfter !== 1 ||
    duplicate.secondJobCreated !== false
  ) {
    fail("duplicate nonce proof");
  }

  const dualRpc = exactObject(evidence.dualRpc, "dual RPC", [
    "block",
    "alchemy",
    "quicknode",
  ]);
  const dualBlock = exactObject(dualRpc.block, "dual RPC block", [
    "chainId",
    "blockNumber",
    "blockHash",
    "parentHash",
    "blockTimestamp",
    "logsCommitment",
  ]);
  if (
    dualBlock.chainId !== 1 ||
    uint(dualBlock.blockNumber, "dual RPC block number") !== block.blockNumber ||
    bytes32(dualBlock.blockHash, "dual RPC block hash") !== block.blockHash ||
    timestamp(dualBlock.blockTimestamp, "dual RPC block timestamp") !==
      delivery.blockTimestamp
  ) {
    fail("dual RPC block binding");
  }
  bytes32(dualBlock.parentHash, "dual RPC parent hash");
  bytes32(dualBlock.logsCommitment, "dual RPC logs commitment");
  const alchemy = assertProvider(dualRpc.alchemy, "alchemy", block);
  const quicknode = assertProvider(dualRpc.quicknode, "quicknode", block);
  if (
    alchemy.blockHead.observedAt < requestReceivedAt ||
    alchemy.blockHead.observedAt > capturedAt ||
    alchemy.marketHead.observedAt < requestReceivedAt ||
    alchemy.marketHead.observedAt > capturedAt ||
    quicknode.blockHead.observedAt < requestReceivedAt ||
    quicknode.blockHead.observedAt > capturedAt ||
    quicknode.marketHead.observedAt < requestReceivedAt ||
    quicknode.marketHead.observedAt > capturedAt
  ) {
    fail("provider observation freshness");
  }
  if (
    dualRpc.alchemy.endpointHost === dualRpc.quicknode.endpointHost ||
    dualRpc.alchemy.endpointUrlSha256 === dualRpc.quicknode.endpointUrlSha256 ||
    dualRpc.alchemy.providerDeploymentId ===
      dualRpc.quicknode.providerDeploymentId ||
    (alchemy.blockHead.number === quicknode.blockHead.number &&
      dualRpc.alchemy.blockEvidenceHead.blockHash !==
        dualRpc.quicknode.blockEvidenceHead.blockHash) ||
    (alchemy.marketHead.number === quicknode.marketHead.number &&
      dualRpc.alchemy.marketStateHead.blockHash !==
        dualRpc.quicknode.marketStateHead.blockHash)
  ) {
    fail("provider independence");
  }
  const confirmations = Math.min(
    alchemy.marketHead.confirmations,
    quicknode.marketHead.confirmations,
  );

  const database = assertDatabase(evidence.optimisticDatabase, block, {
    queueResponseAt,
  });
  const api = exactObject(evidence.api, "API", [
    "firstVisibleAt",
    "observations",
  ]);
  const firstVisibleAt = timestampMs(api.firstVisibleAt, "first visible timestamp");
  if (
    firstVisibleAt < database.committedAt ||
    !Array.isArray(api.observations) ||
    api.observations.length !== 2
  ) {
    fail("API visibility");
  }
  const observedUrls = new Set();
  const observedSurfaces = new Set();
  const observedTokens = new Set();
  const observedReleases = new Set();
  const observedTimes = [];
  for (const [index, observationValue] of api.observations.entries()) {
    const observation = exactObject(
      observationValue,
      `API observation ${index}`,
      [
        "url",
        "surface",
        "tokenAddress",
        "releaseVersion",
        "status",
        "cacheControl",
        "source",
        "finality",
        "chainId",
        "blockNumber",
        "blockHash",
        "confirmations",
        "marketEvidenceCommitment",
        "responseSha256",
        "observedAt",
      ],
    );
    if (
      observation.surface !== "explore-token" &&
      observation.surface !== "classic-chart"
    ) {
      fail(`API observation ${index} surface`);
    }
    const tokenAddress = pattern(
      observation.tokenAddress,
      `API observation ${index} token`,
      ADDRESS,
    );
    if (
      observation.releaseVersion !== "classic-v2" &&
      observation.releaseVersion !== "classic-v3"
    ) {
      fail(`API observation ${index} release`);
    }
    const normalizedUrl = apiSurfaceUrl(
      observation.url,
      `API observation ${index} URL`,
      expected.targetOrigin,
      observation.surface,
      tokenAddress,
    );
    if (observedUrls.has(normalizedUrl)) fail("duplicate API observation URL");
    observedUrls.add(normalizedUrl);
    observedSurfaces.add(observation.surface);
    observedTokens.add(tokenAddress);
    observedReleases.add(observation.releaseVersion);
    const observedAt = timestampMs(
      observation.observedAt,
      `API observation ${index} timestamp`,
    );
    if (
      observation.status !== 200 ||
      observation.cacheControl !== "no-store" ||
      observation.source !== "dual-rpc-head" ||
      observation.finality !== "optimistic" ||
      observation.chainId !== 1 ||
      uint(observation.blockNumber, `API observation ${index} block`) !==
        block.blockNumber ||
      bytes32(observation.blockHash, `API observation ${index} hash`) !==
        block.blockHash ||
      count(observation.confirmations, `API observation ${index} confirmations`, 0, 11) !==
        confirmations ||
      bytes32(
        observation.marketEvidenceCommitment,
        `API observation ${index} market commitment`,
      ) !== database.marketEvidence.evidenceCommitment ||
      observedAt < database.committedAt ||
      observedAt > capturedAt
    ) {
      fail(`API observation ${index}`);
    }
    bytes32(observation.responseSha256, `API observation ${index} response`);
    observedTimes.push(observedAt);
  }
  const earliestObservedAt = Math.min(...observedTimes);
  const allRequiredSurfacesVisibleAt = Math.max(...observedTimes);
  if (
    observedSurfaces.size !== 2 ||
    !observedSurfaces.has("explore-token") ||
    !observedSurfaces.has("classic-chart") ||
    observedTokens.size !== 1 ||
    observedReleases.size !== 1 ||
    firstVisibleAt !== earliestObservedAt
  ) {
    fail("required API surfaces");
  }

  const sla = exactObject(evidence.sla, "SLA", [
    "maximumDeliveryToFirstVisibleMs",
    "deliveryToFirstVisibleMs",
    "deliveryToAllRequiredSurfacesVisibleMs",
  ]);
  const measuredLatency = firstVisibleAt - requestReceivedAt;
  const allRequiredSurfacesLatency =
    allRequiredSurfacesVisibleAt - requestReceivedAt;
  if (
    sla.maximumDeliveryToFirstVisibleMs !== REAL_BLOCK_SLA_MAXIMUM_LATENCY_MS ||
    !Number.isSafeInteger(sla.deliveryToFirstVisibleMs) ||
    sla.deliveryToFirstVisibleMs !== measuredLatency ||
    !Number.isSafeInteger(sla.deliveryToAllRequiredSurfacesVisibleMs) ||
    sla.deliveryToAllRequiredSurfacesVisibleMs !==
      allRequiredSurfacesLatency ||
    measuredLatency < 0 ||
    measuredLatency > REAL_BLOCK_SLA_MAXIMUM_LATENCY_MS ||
    allRequiredSurfacesLatency < measuredLatency ||
    allRequiredSurfacesLatency > REAL_BLOCK_SLA_MAXIMUM_LATENCY_MS ||
    capturedAt < duplicateReceivedAt ||
    capturedAt < firstVisibleAt
  ) {
    fail("latency SLA");
  }

  return Object.freeze({
    ok: true,
    repositoryCommit: evidence.repositoryCommit,
    deploymentId: deployment.id,
    targetOrigin: expected.targetOrigin,
    deliveryId: delivery.deliveryId,
    streamId: delivery.streamId,
    blockNumber: block.blockNumber,
    blockHash: block.blockHash,
    confirmations,
    deliveryToFirstVisibleMs: measuredLatency,
    deliveryToAllRequiredSurfacesVisibleMs: allRequiredSurfacesLatency,
    evidenceSha256: evidence.evidenceSha256,
  });
}

function sameHex(left, right, label) {
  if (
    typeof left !== "string" || typeof right !== "string" ||
    !/^0x[0-9a-f]{64}$/u.test(left) || !/^0x[0-9a-f]{64}$/u.test(right) ||
    !timingSafeEqual(Buffer.from(left.slice(2), "hex"), Buffer.from(right.slice(2), "hex"))
  ) fail(label);
}

/** Verifies the DB-authored, challenge-bound v2 capture export. */
export function verifyRealBlockSlaDatabaseAttestation(value, input) {
  const expected = normalizedExpected(input);
  const evidence = exactObject(value, "database attestation", [
    "kind", "schemaVersion", "exportId", "challengeSha256", "exportedAt", "runtimeReceipt",
    "apiObservations", "receiptSha256", "challenge", "attestationHmacSha256",
  ]);
  if (
    evidence.kind !== "programmable-real-block-sla-db-attestation" ||
    evidence.schemaVersion !== 2
  ) fail("database attestation version");
  pattern(evidence.exportId, "export receipt", UUID);
  pattern(evidence.challenge, "export challenge", NONZERO_BYTES32);
  const challengeSha = `0x${createHash("sha256").update(evidence.challenge, "utf8").digest("hex")}`;
  sameHex(evidence.challengeSha256, challengeSha, "challenge receipt");
  bytes32(evidence.receiptSha256, "DB receipt hash");
  bytes32(evidence.attestationHmacSha256, "attestation HMAC");
  const secret = input.probeToken ?? process.env.PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN;
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    fail("attestation verifier secret");
  }
  const unsigned = Object.fromEntries(Object.entries(evidence).filter(
    ([key]) => key !== "challenge" && key !== "attestationHmacSha256",
  ));
  const expectedHmac = `0x${createHmac("sha256", secret)
    .update(`${canonicalJson(unsigned)}:${evidence.challenge}`, "utf8").digest("hex")}`;
  sameHex(evidence.attestationHmacSha256, expectedHmac, "attestation HMAC");
  const exportedAt = timestampMs(evidence.exportedAt, "DB export timestamp");
  if (
    exportedAt < expected.nowMs - expected.maximumEvidenceAgeMs ||
    exportedAt > expected.nowMs + MAXIMUM_FUTURE_SKEW_MS
  ) fail("DB export freshness");

  const runtime = exactObject(evidence.runtimeReceipt, "runtime receipt", [
    "deliveryReceiptId", "wakeId", "initialNonceDigest", "duplicateNonceDigest",
    "streamId", "payloadSha256",
    "signedAt", "requestReceivedAt", "databaseReceivedAt", "jobPersistedAt",
    "acknowledgedAt", "duplicateReceivedAt", "duplicateAcknowledgedAt",
    "initialResponseStatus", "duplicateResponseStatus",
    "repositoryCommit", "deploymentId", "deploymentOrigin", "projectId",
    "blockNumber", "blockHash", "parentHash", "blockTimestamp",
    "blockEvidenceCommitment", "logsCommitment", "providerADeploymentId",
    "providerBDeploymentId", "providerAEndpointHost", "providerBEndpointHost",
    "providerAEndpointUrlSha256", "providerBEndpointUrlSha256",
    "blockProviderAHead", "blockProviderAHeadHash", "blockProviderAObservedAt",
    "blockProviderBHead", "blockProviderBHeadHash", "blockProviderBObservedAt",
    "blockProviderCallCountA", "blockProviderCallCountB", "eventRowCount",
    "metadataTokenCount", "metadataProviderCallCountA",
    "metadataProviderCallCountB", "marketRowCount", "reorgGeneration", "bundleVisibleAt",
    "events", "markets",
  ]);
  if (
    runtime.repositoryCommit !== expected.repositoryCommit ||
    runtime.deploymentId !== expected.deploymentId ||
    exactOrigin(runtime.deploymentOrigin, "runtime deployment origin") !== expected.targetOrigin
  ) fail("runtime deployment binding");
  identifier(runtime.projectId, "runtime project");
  uint(runtime.deliveryReceiptId, "delivery receipt ID");
  uint(runtime.wakeId, "wake ID");
  bytes32(runtime.initialNonceDigest, "initial nonce digest");
  bytes32(runtime.duplicateNonceDigest, "duplicate nonce digest");
  bytes32(runtime.payloadSha256, "payload digest");
  identifier(runtime.streamId, "stream ID");
  timestamp(runtime.signedAt, "provider signed timestamp");
  const requestReceivedAt = timestampMs(
    runtime.requestReceivedAt,
    "handler delivery receipt",
  );
  const receivedAt = timestampMs(runtime.databaseReceivedAt, "DB delivery receipt");
  const persistedAt = timestampMs(runtime.jobPersistedAt, "DB queue persistence");
  const eligibleAt = timestampMs(runtime.acknowledgedAt, "DB 202 eligibility");
  const duplicateAt = timestampMs(runtime.duplicateReceivedAt, "DB duplicate receipt");
  const duplicateEligibleAt = timestampMs(
    runtime.duplicateAcknowledgedAt,
    "DB duplicate 202 eligibility",
  );
  if (
    requestReceivedAt !== receivedAt ||
    persistedAt > eligibleAt || receivedAt > persistedAt ||
    duplicateAt < eligibleAt || duplicateEligibleAt < duplicateAt ||
    duplicateEligibleAt > receivedAt + REAL_BLOCK_SLA_MAXIMUM_LATENCY_MS ||
    runtime.initialResponseStatus !== 503 ||
    runtime.duplicateResponseStatus !== 202
  ) fail("durable queue ordering");
  const visibleAt = timestampMs(runtime.bundleVisibleAt, "DB bundle visibility");
  if (visibleAt < eligibleAt) fail("DB visibility ordering");
  const targetBlock = BigInt(uint(runtime.blockNumber, "runtime block"));
  const targetHash = bytes32(runtime.blockHash, "runtime block hash");
  bytes32(runtime.parentHash, "runtime parent hash");
  timestamp(runtime.blockTimestamp, "runtime block timestamp");
  bytes32(runtime.blockEvidenceCommitment, "runtime block evidence");
  bytes32(runtime.logsCommitment, "runtime logs commitment");
  pattern(runtime.providerADeploymentId, "Alchemy deployment", UUID);
  pattern(runtime.providerBDeploymentId, "QuickNode deployment", UUID);
  if (runtime.providerADeploymentId === runtime.providerBDeploymentId) {
    fail("provider deployment independence");
  }
  bytes32(runtime.providerAEndpointUrlSha256, "Alchemy endpoint receipt");
  bytes32(runtime.providerBEndpointUrlSha256, "QuickNode endpoint receipt");
  const providerAHost = pattern(
    runtime.providerAEndpointHost,
    "Alchemy endpoint host",
    SAFE_HOST,
  );
  const providerBHost = pattern(
    runtime.providerBEndpointHost,
    "QuickNode endpoint host",
    SAFE_HOST,
  );
  if (
    (providerAHost !== "alchemy.com" && !providerAHost.endsWith(".alchemy.com")) ||
    (providerBHost !== "quicknode.com" &&
      !providerBHost.endsWith(".quicknode.com") &&
      providerBHost !== "quiknode.pro" &&
      !providerBHost.endsWith(".quiknode.pro")) ||
    providerAHost === providerBHost ||
    runtime.providerAEndpointUrlSha256 === runtime.providerBEndpointUrlSha256
  ) fail("provider endpoint independence");
  uint(runtime.reorgGeneration, "runtime reorg generation");

  const runtimeHead = (provider, phase, numberValue, hashValue, observedValue) => {
    const number = BigInt(uint(numberValue, `${provider} ${phase} head`));
    const hash = bytes32(hashValue, `${provider} ${phase} head hash`);
    const observedAt = timestampMs(observedValue, `${provider} ${phase} observed at`);
    if (
      number < targetBlock || number > targetBlock + 11n ||
      (number === targetBlock && hash !== targetHash) ||
      observedAt < receivedAt || observedAt > visibleAt
    ) fail(`${provider} ${phase} head telemetry`);
    return { hash, number, observedAt };
  };
  const sameHeightHash = (left, right, label) => {
    if (left.number === right.number && left.hash !== right.hash) fail(label);
  };
  const blockHeadA = runtimeHead(
    "Alchemy", "block", runtime.blockProviderAHead,
    runtime.blockProviderAHeadHash, runtime.blockProviderAObservedAt,
  );
  const blockHeadB = runtimeHead(
    "QuickNode", "block", runtime.blockProviderBHead,
    runtime.blockProviderBHeadHash, runtime.blockProviderBObservedAt,
  );
  sameHeightHash(blockHeadA, blockHeadB, "same-height block head agreement");
  const blockCallsA = count(runtime.blockProviderCallCountA, "Alchemy block calls");
  const blockCallsB = count(runtime.blockProviderCallCountB, "QuickNode block calls");
  if (
    blockCallsA !== (blockHeadA.number === targetBlock ? 4 : 5) ||
    blockCallsB !== (blockHeadB.number === targetBlock ? 4 : 5)
  ) fail("block provider call count");
  const eventCount = count(runtime.eventRowCount, "event row count");
  const metadataCount = count(runtime.metadataTokenCount, "metadata token count", 0, 16);
  const metadataCallsA = metadataProviderCallCount(
    runtime.metadataProviderCallCountA,
    metadataCount,
    "Alchemy metadata calls",
  );
  const metadataCallsB = metadataProviderCallCount(
    runtime.metadataProviderCallCountB,
    metadataCount,
    "QuickNode metadata calls",
  );
  const marketCount = count(runtime.marketRowCount, "market row count", 1, 100);
  if (!Array.isArray(runtime.events) || runtime.events.length !== eventCount ||
      !Array.isArray(runtime.markets) || runtime.markets.length !== marketCount) {
    fail("runtime row receipts");
  }
  for (const event of runtime.events) {
    const row = exactObject(event, "event receipt", [
      "optimisticEventId", "payloadCommitment",
    ]);
    pattern(row.optimisticEventId, "optimistic event", UUID);
    bytes32(row.payloadCommitment, "event payload commitment");
  }
  const marketRows = [];
  let marketCallsA = 0;
  let marketCallsB = 0;
  for (const market of runtime.markets) {
    const row = exactObject(market, "market receipt", [
      "optimisticMarketStateId", "poolId", "tokenAddress", "releaseVersion",
      "evidenceCommitment",
      "marketCommitment", "confirmations", "marketProviderAHead",
      "marketProviderAHeadHash", "marketProviderAObservedAt", "marketProviderBHead",
      "marketProviderBHeadHash", "marketProviderBObservedAt",
      "marketProviderCallCountA", "marketProviderCallCountB",
      "totalProviderCallCountA", "totalProviderCallCountB",
    ]);
    pattern(row.optimisticMarketStateId, "market state", UUID);
    bytes32(row.poolId, "market pool");
    pattern(row.tokenAddress, "market token", ADDRESS);
    if (
      row.releaseVersion !== null &&
      row.releaseVersion !== "classic-v2" &&
      row.releaseVersion !== "classic-v3"
    ) {
      fail("market release");
    }
    bytes32(row.evidenceCommitment, "market evidence");
    bytes32(row.marketCommitment, "market commitment");
    const confirmations = count(row.confirmations, "market confirmations", 0, 11);
    const headA = runtimeHead(
      "Alchemy", "market", row.marketProviderAHead,
      row.marketProviderAHeadHash, row.marketProviderAObservedAt,
    );
    const headB = runtimeHead(
      "QuickNode", "market", row.marketProviderBHead,
      row.marketProviderBHeadHash, row.marketProviderBObservedAt,
    );
    if (
      headA.number < blockHeadA.number || headB.number < blockHeadB.number ||
      headA.observedAt < blockHeadA.observedAt ||
      headB.observedAt < blockHeadB.observedAt
    ) fail("market head ordering");
    sameHeightHash(headA, headB, "same-height market head agreement");
    sameHeightHash(blockHeadA, headA, "same-provider Alchemy head agreement");
    sameHeightHash(blockHeadB, headB, "same-provider QuickNode head agreement");
    sameHeightHash(blockHeadA, headB, "same-height cross-provider head agreement");
    sameHeightHash(blockHeadB, headA, "same-height cross-provider head agreement");
    if (
      confirmations !== Number(
        (headA.number < headB.number ? headA.number : headB.number) - targetBlock,
      )
    ) fail("market confirmation count");
    const callsA = count(row.marketProviderCallCountA, "Alchemy market calls");
    const callsB = count(row.marketProviderCallCountB, "QuickNode market calls");
    if (
      callsA !== (headA.number === targetBlock ? 7 : 8) ||
      callsB !== (headB.number === targetBlock ? 7 : 8)
    ) fail("dynamic provider call count");
    marketCallsA += callsA;
    marketCallsB += callsB;
    marketRows.push(row);
  }
  const totalCallsA = blockCallsA + metadataCallsA + marketCallsA;
  const totalCallsB = blockCallsB + metadataCallsB + marketCallsB;
  for (const row of marketRows) {
    if (
      count(row.totalProviderCallCountA, "Alchemy total calls") !== totalCallsA ||
      count(row.totalProviderCallCountB, "QuickNode total calls") !== totalCallsB
    ) fail("aggregate provider call count");
  }

  if (!Array.isArray(evidence.apiObservations) || evidence.apiObservations.length !== 2) {
    fail("API observation receipts");
  }
  const surfaces = new Set();
  const stateIds = new Set();
  const releases = new Set();
  const generations = new Set();
  const observationTimes = [];
  for (const observationValue of evidence.apiObservations) {
    const observation = object(observationValue, "API observation receipt");
    pattern(observation.apiObservationId, "API observation ID", UUID);
    if (observation.surface !== "explore-token" && observation.surface !== "classic-chart") {
      fail("API surface");
    }
    surfaces.add(observation.surface);
    stateIds.add(pattern(observation.optimisticMarketStateId, "API market state", UUID));
    if (observation.releaseVersion !== "classic-v2" && observation.releaseVersion !== "classic-v3") {
      fail("API release");
    }
    releases.add(observation.releaseVersion);
    generations.add(uint(observation.reorgGeneration, "API reorg generation"));
    if (observation.responseStatus !== 200 || observation.cacheControl !== "no-store") {
      fail("API no-store receipt");
    }
    bytes32(observation.responseBodySha256, "API body digest");
    count(observation.responseBodySize, "API body size", 2, MAXIMUM_EVIDENCE_BYTES);
    const observedAt = timestampMs(observation.observedAt, "API DB observation");
    if (observedAt < visibleAt || observedAt > exportedAt) fail("API observation ordering");
    observationTimes.push(observedAt);
  }
  const observedStateId = [...stateIds][0];
  const observedRelease = [...releases][0];
  const boundMarket = marketRows.find(
    (market) => market.optimisticMarketStateId === observedStateId,
  );
  if (
    surfaces.size !== 2 || stateIds.size !== 1 || releases.size !== 1 ||
    generations.size !== 1 || boundMarket?.releaseVersion !== observedRelease
  ) fail("same-market public surfaces");
  const firstLatency = Math.min(...observationTimes) - receivedAt;
  const allLatency = Math.max(...observationTimes) - receivedAt;
  if (firstLatency < 0 || firstLatency > REAL_BLOCK_SLA_MAXIMUM_LATENCY_MS ||
      allLatency < firstLatency || allLatency > REAL_BLOCK_SLA_MAXIMUM_LATENCY_MS) {
    fail("real-block SLA latency");
  }
  return Object.freeze({
    ok: true,
    repositoryCommit: runtime.repositoryCommit,
    deploymentId: runtime.deploymentId,
    targetOrigin: runtime.deploymentOrigin,
    blockNumber: runtime.blockNumber,
    blockHash: runtime.blockHash,
    deliveryToFirstVisibleMs: firstLatency,
    deliveryToAllRequiredSurfacesVisibleMs: allLatency,
    evidenceSha256: evidence.receiptSha256,
    databaseAttested: true,
  });
}

export function realBlockSlaGateArgumentsFrom(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !["--evidence", "--expected-commit", "--deployment-id", "--target-url"].includes(name) ||
      !value ||
      value.startsWith("--") ||
      values.has(name)
    ) {
      throw new Error(
        "usage: --evidence <path> --expected-commit <sha> --deployment-id <id> --target-url <exact-staged-origin>",
      );
    }
    values.set(name, value);
  }
  if (values.size !== 4) {
    throw new Error(
      "usage: --evidence <path> --expected-commit <sha> --deployment-id <id> --target-url <exact-staged-origin>",
    );
  }
  return Object.freeze({
    evidencePath: values.get("--evidence"),
    expectedRepositoryCommit: values.get("--expected-commit"),
    expectedDeploymentId: values.get("--deployment-id"),
    expectedTargetUrl: values.get("--target-url"),
  });
}

export async function readRealBlockSlaEvidence(path) {
  const absolutePath = resolve(path);
  const metadata = await lstat(absolutePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 2 ||
    metadata.size > MAXIMUM_EVIDENCE_BYTES
  ) {
    fail("file");
  }
  let value;
  try {
    value = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch {
    fail("file");
  }
  return value;
}

async function main() {
  const args = realBlockSlaGateArgumentsFrom(process.argv.slice(2));
  const evidence = await readRealBlockSlaEvidence(args.evidencePath);
  if (!evidence?.runtimeReceipt) {
    fail("DB-authored promotion attestation required");
  }
  const result = verifyRealBlockSlaDatabaseAttestation(evidence, args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "real block SLA gate failed"}\n`,
    );
    process.exitCode = 1;
  });
}
