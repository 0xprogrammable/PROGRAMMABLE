import crypto from "node:crypto";

import { canonicalJsonSha256V2, canonicalJsonV2 } from "./canonical-json-core.mjs";

const RECEIPT_SCHEMA = "urn:programmable:upstream-reviewed-drift:1.0.0";
const REVIEW_ACTION = "unchanged-observed-only";
const COMPATIBILITY_ACTION = "none-not-resolved";
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;

export function validateReviewedDriftReceipt(receipt, sourceMap, {
  sourceBytes,
  availablePaths = undefined
} = {}) {
  plainObject(receipt, "receipt");
  exactKeys(receipt, [
    "$schema",
    "deploymentFeed",
    "entries",
    "kind",
    "receiptId",
    "reviewedAt",
    "schemaVersion",
    "sourceMap",
    "testedBaseline"
  ], "receipt");
  equal(receipt.$schema, RECEIPT_SCHEMA, "receipt.$schema");
  equal(receipt.schemaVersion, "1.0.0", "receipt.schemaVersion");
  equal(receipt.kind, "programmable-upstream-reviewed-drift", "receipt.kind");
  stringMatching(receipt.receiptId, /^upstream-drift-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/u, "receipt.receiptId");
  timestamp(receipt.reviewedAt, "receipt.reviewedAt");

  plainObject(sourceMap, "source map");
  plainObject(receipt.sourceMap, "receipt.sourceMap");
  exactKeys(receipt.sourceMap, ["observedAt", "path", "sha256", "snapshotDate"], "receipt.sourceMap");
  equal(receipt.sourceMap.path, "references/upstream-sources.json", "receipt.sourceMap.path");
  stringMatching(receipt.sourceMap.sha256, SHA256_PATTERN, "receipt.sourceMap.sha256");
  stringMatching(receipt.sourceMap.snapshotDate, /^\d{4}-\d{2}-\d{2}$/u, "receipt.sourceMap.snapshotDate");
  timestamp(receipt.sourceMap.observedAt, "receipt.sourceMap.observedAt");
  equal(receipt.sourceMap.snapshotDate, sourceMap.snapshotDate, "source snapshotDate binding");
  equal(receipt.sourceMap.observedAt, sourceMap.observedAt, "source observedAt binding");
  equal(receipt.reviewedAt, sourceMap.observedAt, "receipt review timestamp binding");
  if (!(sourceBytes instanceof Uint8Array)) fail("sourceBytes must contain the exact upstream source-map bytes");
  equal(receipt.sourceMap.sha256, `sha256:${crypto.createHash("sha256").update(sourceBytes).digest("hex")}`, "source-map byte digest");

  validateBaseline(receipt.testedBaseline, sourceMap.programmableTestedBaseline);
  validateDeploymentFeed(receipt.deploymentFeed, sourceMap.observedOfficialFeeds);
  validateEntries(receipt.entries, sourceMap.observedOfficialSources, receipt.reviewedAt, availablePaths);
  return true;
}

export function renderReviewedDriftMarkdown(receipt) {
  plainObject(receipt, "receipt");
  if (!Array.isArray(receipt.entries)) fail("receipt.entries must be an array");
  const lines = [
    "<!-- reviewed-drift-v1:start -->",
    `Current reviewed upstream range receipt: \`${escapeCell(receipt.receiptId)}\`, captured \`${escapeCell(receipt.reviewedAt)}\`. These are observed source heads, not a tested compatibility set or deployment claim.`,
    "",
    "| Repository | Reviewed range | Files | Impact | Adopted guidance | Baseline action |",
    "| --- | --- | ---: | --- | --- | --- |"
  ];
  for (const entry of receipt.entries) {
    lines.push(`| ${escapeCell(entry.name)} | \`${entry.fromCommit.slice(0, 12)}..${entry.toCommit.slice(0, 12)}\` | ${entry.changedFiles.length} | ${escapeCell(entry.impact)} | ${entry.adoptedGuidance.map((item) => `\`${escapeCell(item)}\``).join("<br>")} | ${escapeCell(entry.testedBaselineAction)} |`);
  }
  lines.push("<!-- reviewed-drift-v1:end -->");
  return `${lines.join("\n")}\n`;
}

function validateBaseline(receiptBaseline, sourceBaseline) {
  plainObject(receiptBaseline, "receipt.testedBaseline");
  exactKeys(receiptBaseline, ["action", "bindings", "digestAlgorithm", "sha256"], "receipt.testedBaseline");
  equal(receiptBaseline.action, "unchanged", "tested baseline action");
  equal(receiptBaseline.digestAlgorithm, "sha256-canonical-json-v2", "tested baseline digest algorithm");
  stringMatching(receiptBaseline.sha256, SHA256_PATTERN, "tested baseline digest");
  if (!Array.isArray(sourceBaseline) || sourceBaseline.length === 0) fail("source programmableTestedBaseline must be a non-empty array");
  if (!Array.isArray(receiptBaseline.bindings)) fail("receipt.testedBaseline.bindings must be an array");
  equal(canonicalJsonV2(receiptBaseline.bindings), canonicalJsonV2(sourceBaseline), "tested baseline bindings");
  equal(receiptBaseline.sha256, canonicalJsonSha256V2(sourceBaseline), "tested baseline digest");
}

function validateDeploymentFeed(receiptFeed, sourceFeeds) {
  plainObject(receiptFeed, "receipt.deploymentFeed");
  exactKeys(receiptFeed, ["action", "name", "sha256", "sourceCommit"], "receipt.deploymentFeed");
  equal(receiptFeed.action, "unchanged", "deployment feed action");
  equal(receiptFeed.name, "Uniswap Deployments Feed", "deployment feed name");
  stringMatching(receiptFeed.sha256, /^[0-9a-f]{64}$/u, "deployment feed sha256");
  stringMatching(receiptFeed.sourceCommit, COMMIT_PATTERN, "deployment feed source commit");
  if (!Array.isArray(sourceFeeds)) fail("source observedOfficialFeeds must be an array");
  const sourceFeed = sourceFeeds.find(({ name }) => name === receiptFeed.name);
  if (sourceFeed === undefined) fail("source map omits Uniswap Deployments Feed");
  equal(receiptFeed.sha256, sourceFeed.sha256, "deployment feed digest binding");
  equal(receiptFeed.sourceCommit, sourceFeed.source?.commit, "deployment feed source-commit binding");
}

function validateEntries(entries, sourceEntries, reviewedAt, availablePaths) {
  if (!Array.isArray(entries) || entries.length === 0) fail("receipt.entries must be a non-empty array");
  if (!Array.isArray(sourceEntries)) fail("source observedOfficialSources must be an array");
  const observed = sourceEntries.filter((entry) => entry.observedAt === reviewedAt);
  equal(entries.length, 7, "reviewed entry count");
  equal(observed.length, entries.length, "observed source range count");
  assertSortedUnique(entries.map(({ repository }) => repository), "receipt entry repositories");
  const observedByRepository = new Map(observed.map((entry) => [entry.repository, entry]));
  if (observedByRepository.size !== observed.length) fail("observed source repositories must be unique");

  for (const [index, entry] of entries.entries()) {
    const label = `receipt.entries[${index}]`;
    plainObject(entry, label);
    exactKeys(entry, [
      "adoptedGuidance",
      "changedFiles",
      "commitTimestamp",
      "compatibilitySetAction",
      "fromCommit",
      "impact",
      "name",
      "repository",
      "testedBaselineAction",
      "toCommit",
      "trackedRef"
    ], label);
    stringMatching(entry.repository, /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/u, `${label}.repository`);
    stringMatching(entry.fromCommit, COMMIT_PATTERN, `${label}.fromCommit`);
    stringMatching(entry.toCommit, COMMIT_PATTERN, `${label}.toCommit`);
    if (entry.fromCommit === entry.toCommit) fail(`${label} must describe a non-empty commit range`);
    timestamp(entry.commitTimestamp, `${label}.commitTimestamp`);
    equal(entry.testedBaselineAction, REVIEW_ACTION, `${label}.testedBaselineAction`);
    equal(entry.compatibilitySetAction, COMPATIBILITY_ACTION, `${label}.compatibilitySetAction`);
    if (typeof entry.impact !== "string" || entry.impact.length < 20) fail(`${label}.impact must be a substantive string`);
    validatePaths(entry.changedFiles, `${label}.changedFiles`, undefined);
    validatePaths(entry.adoptedGuidance, `${label}.adoptedGuidance`, availablePaths);

    const source = observedByRepository.get(entry.repository);
    if (source === undefined) fail(`${label} has no same-review-time source-map entry`);
    equal(entry.name, source.name, `${label}.name binding`);
    equal(entry.trackedRef, source.trackedRef, `${label}.trackedRef binding`);
    equal(entry.fromCommit, source.previousObservedCommit, `${label}.fromCommit binding`);
    equal(entry.toCommit, source.commit, `${label}.toCommit binding`);
    equal(entry.commitTimestamp, source.commitTimestamp, `${label}.commitTimestamp binding`);
    equal(source.compatibilitySet, null, `${label} source compatibilitySet`);
    equal(source.notAResolvedBaseline, true, `${label} source notAResolvedBaseline`);
  }
}

function validatePaths(values, label, availablePaths) {
  if (!Array.isArray(values) || values.length === 0) fail(`${label} must be a non-empty array`);
  assertSortedUnique(values, label);
  for (const value of values) {
    if (
      typeof value !== "string"
      || value.length === 0
      || value.length > 512
      || value.startsWith("/")
      || value.includes("\\")
      || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) fail(`${label} contains an unsafe relative path`);
    if (availablePaths !== undefined && !availablePaths.has(value)) fail(`${label} references missing package path ${value}`);
  }
}

function assertSortedUnique(values, label) {
  if (new Set(values).size !== values.length) fail(`${label} must be unique`);
  const sorted = [...values].sort(compareUtf8);
  if (canonicalJsonV2(values) !== canonicalJsonV2(sorted)) fail(`${label} must use UTF-8 bytewise sort order`);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  if (canonicalJsonV2(actual) !== canonicalJsonV2(expected)) fail(`${label} has unsupported or missing fields`);
}

function plainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
}

function stringMatching(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) fail(`${label} has an unsupported value`);
}

function timestamp(value, label) {
  stringMatching(value, TIMESTAMP_PATTERN, label);
  if (new Date(value).toISOString().replace(".000Z", "Z") !== value) fail(`${label} must be a canonical UTC timestamp`);
}

function equal(actual, expected, label) {
  if (actual !== expected) fail(`${label} does not match its reviewed binding`);
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function fail(message) {
  throw new Error(`reviewed drift receipt: ${message}`);
}
