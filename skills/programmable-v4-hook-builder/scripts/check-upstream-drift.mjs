#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseCliOrExit } from "./cli-args.mjs";
import {
  compareOfficialDeploymentRecords,
  OfficialLaunchpadReferenceError,
  validateOfficialLaunchpadReference
} from "./official-launchpad-core.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);
const defaultSnapshotPath = path.resolve(scriptDirectory, "..", "references", "upstream-sources.json");
const maximumInputBytes = 2_000_000;
const maximumNetworkBytes = 10_000_000;
const defaultNetworkTimeoutMs = 10_000;
const gitObjectPattern = /^[a-f0-9]{40}$/i;
const sha256Pattern = /^[a-f0-9]{64}$/i;

export class DriftInputError extends Error {}

export function analyzeDrift(snapshot, observations, launchpadReference = null) {
  const trackedRepositories = validateSnapshot(snapshot);
  const validatedReference = validateLaunchpadReference(snapshot, launchpadReference);
  const { repositories: observedRepositories, deploymentRecords, sourceArtifacts } = validateObservations(
    observations,
    validatedReference !== null
  );
  const observedFeeds = new Map(observations.feeds.map((feed) => [feed.url, feed]));
  const knownRepositories = collectKnownRepositoryKeys(snapshot);
  const findings = [];

  for (const source of trackedRepositories) {
    const observed = observedRepositories.get(source.key);
    if (!observed) {
      findings.push({
        code: "tracked-repository-missing",
        repository: source.repository,
        expected: "present",
        actual: "missing"
      });
      continue;
    }

    compareField(findings, source.repository, "defaultBranch", source.defaultBranch, observed.defaultBranch);
    compareField(findings, source.repository, "ref", source.trackedRef, observed.ref);
    compareField(findings, source.repository, "commit", source.commit.toLowerCase(), observed.commit?.toLowerCase() ?? null);
    compareField(findings, source.repository, "archived", source.archived, observed.archived);
    if (source.compareLicense) {
      compareField(findings, source.repository, "license", source.license, observed.license);
    }
  }

  for (const feed of snapshot.observedOfficialFeeds) {
    const observed = observedFeeds.get(feed.url);
    if (!observed) {
      findings.push({
        code: "tracked-feed-missing",
        url: feed.url,
        expected: "present",
        actual: "missing"
      });
      continue;
    }
    if (feed.sha256.toLowerCase() !== observed.sha256.toLowerCase()) {
      findings.push({
        code: "feed-sha256-drift",
        url: feed.url,
        field: "sha256",
        expected: feed.sha256.toLowerCase(),
        actual: observed.sha256.toLowerCase()
      });
    }
  }

  if (validatedReference) {
    findings.push(...compareOfficialSourceArtifacts(validatedReference.reference, sourceArtifacts));
    findings.push(...compareOfficialDeploymentRecords(validatedReference.reference, deploymentRecords));
  }

  const policy = snapshot.driftPolicy;
  const repositoryPatterns = policy.repositoryNamePatterns.map((pattern) => new RegExp(pattern, "i"));
  for (const observed of observedRepositories.values()) {
    const identity = parseGitHubRepository(observed.repository);
    if (identity.owner.toLowerCase() !== policy.organization.toLowerCase()) continue;
    if (policy.ignoreArchivedRepositories && observed.archived) continue;
    if (knownRepositories.has(identity.key)) continue;
    if (!repositoryPatterns.some((pattern) => pattern.test(identity.name))) continue;
    findings.push({
      code: "untracked-relevant-repository",
      repository: canonicalRepositoryUrl(identity),
      expected: "recorded or explicitly classified",
      actual: "untracked"
    });
  }

  findings.sort(compareFindings);
  const compared = {
    repositories: trackedRepositories.length,
    feeds: snapshot.observedOfficialFeeds.length
  };
  if (validatedReference) {
    compared.deploymentRecords = validatedReference.reference.records.length;
    compared.officialSourceArtifacts = validatedReference.reference.sources
      .filter((source) => source.authorityKind !== "official-deployment-feed").length;
  }
  return {
    status: findings.length === 0 ? "clean" : "drift",
    snapshotDate: snapshot.snapshotDate,
    compared,
    findings
  };
}

export async function collectLiveObservations(snapshot, fetchImplementation = globalThis.fetch, options = {}) {
  if (typeof fetchImplementation !== "function") {
    throw new DriftInputError("this Node runtime does not provide fetch");
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new DriftInputError("live observation options must be an object");
  }
  const validatedReference = validateLaunchpadReference(snapshot, options.launchpadReference ?? null);
  const timeoutMs = options.timeoutMs
    ?? validatedReference?.reference.authorityPolicy.networkTimeoutMs
    ?? defaultNetworkTimeoutMs;
  validateNetworkTimeout(timeoutMs);
  const trackedRepositories = validateSnapshot(snapshot);
  const policy = snapshot.driftPolicy;
  const repositoryMetadata = new Map();
  let page = 1;

  while (true) {
    const url = new URL(`https://api.github.com/orgs/${encodeURIComponent(policy.organization)}/repos`);
    url.searchParams.set("type", "public");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const batch = await fetchJson(url, fetchImplementation, maximumNetworkBytes, timeoutMs);
    if (!Array.isArray(batch)) throw new DriftInputError(`${url}: expected a JSON array`);
    for (const repository of batch) {
      const metadata = normalizeGitHubMetadata(repository, url);
      if (repositoryMetadata.has(metadata.key)) {
        throw new DriftInputError(`GitHub returned duplicate repository ${metadata.repository}`);
      }
      repositoryMetadata.set(metadata.key, metadata);
    }
    if (batch.length < 100) break;
    page += 1;
  }

  for (const source of trackedRepositories) {
    if (repositoryMetadata.has(source.key)) continue;
    const identity = parseGitHubRepository(source.repository);
    const url = `https://api.github.com/repos/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.name)}`;
    const metadata = normalizeGitHubMetadata(
      await fetchJson(url, fetchImplementation, maximumNetworkBytes, timeoutMs),
      url
    );
    repositoryMetadata.set(metadata.key, metadata);
  }

  for (const source of trackedRepositories) {
    const metadata = repositoryMetadata.get(source.key);
    const identity = parseGitHubRepository(source.repository);
    const refName = source.trackedRef.replace(/^refs\/heads\//, "");
    const url = `https://api.github.com/repos/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.name)}/commits/${encodeURIComponent(refName)}`;
    const commit = await fetchJson(url, fetchImplementation, maximumNetworkBytes, timeoutMs);
    if (!commit || typeof commit.sha !== "string" || !gitObjectPattern.test(commit.sha)) {
      throw new DriftInputError(`${url}: expected an exact 40-character commit id`);
    }
    metadata.ref = source.trackedRef;
    metadata.commit = commit.sha.toLowerCase();
  }

  const feeds = [];
  const sourceArtifacts = [];
  let deploymentRecords = null;
  for (const feed of snapshot.observedOfficialFeeds) {
    const bytes = await fetchBytes(feed.url, fetchImplementation, maximumNetworkBytes, timeoutMs);
    feeds.push({
      url: feed.url,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex")
    });
    if (validatedReference?.feed.url === feed.url) {
      deploymentRecords = parseDeploymentFeed(bytes, feed.url);
    }
  }

  if (validatedReference && deploymentRecords === null) {
    throw new DriftInputError(`official deployment feed was not observed: ${validatedReference.feed.url}`);
  }
  if (validatedReference) {
    for (const source of validatedReference.reference.sources) {
      if (source.authorityKind === "official-deployment-feed") continue;
      const bytes = await fetchBytes(source.immutableUrl, fetchImplementation, maximumNetworkBytes, timeoutMs);
      sourceArtifacts.push({
        url: source.immutableUrl,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex")
      });
    }
  }

  const result = {
    repositories: [...repositoryMetadata.values()]
      .map(({ key: _key, ...repository }) => repository)
      .sort((left, right) => left.repository.localeCompare(right.repository)),
    feeds: feeds.sort((left, right) => left.url.localeCompare(right.url))
  };
  if (validatedReference) {
    result.deploymentRecords = deploymentRecords;
    result.sourceArtifacts = sourceArtifacts.sort((left, right) => left.url.localeCompare(right.url));
  }
  return result;
}

async function run() {
  const { options } = parseCliOrExit({
    command: "check-upstream-drift.mjs",
    usage: "check-upstream-drift.mjs [--snapshot <path>] [--deployment-reference <path>] [--observations <path>] [--json]",
    summary: "Compare pinned upstream sources with live public metadata or a deterministic offline observation file.",
    options: [
      {
        name: "--snapshot",
        key: "snapshot",
        type: "value",
        valueName: "path",
        description: "Read a source snapshot other than references/upstream-sources.json."
      },
      {
        name: "--deployment-reference",
        key: "deploymentReference",
        type: "value",
        valueName: "path",
        description: "Read an explicit official launchpad deployment reference."
      },
      {
        name: "--observations",
        key: "observations",
        type: "value",
        valueName: "path",
        description: "Use an offline observation JSON file and perform no network requests."
      },
      {
        name: "--json",
        key: "json",
        type: "boolean",
        description: "Print the deterministic result as JSON."
      }
    ],
    positionals: { min: 0, max: 0 }
  });

  try {
    const snapshotPath = path.resolve(options.snapshot ?? defaultSnapshotPath);
    const snapshot = readJsonFile(snapshotPath, "snapshot");
    const launchpadReference = readLaunchpadReference(snapshot, snapshotPath, options.deploymentReference);
    const observations = options.observations
      ? readJsonFile(options.observations, "observations")
      : await collectLiveObservations(snapshot, globalThis.fetch, { launchpadReference });
    const result = analyzeDrift(snapshot, observations, launchpadReference);
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : renderResult(result));
    process.exitCode = result.status === "clean" ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`check-upstream-drift.mjs: ${message}\n`);
    process.exitCode = 2;
  }
}

function readLaunchpadReference(snapshot, snapshotPath, explicitPath) {
  const pin = snapshot.officialLaunchpadDeploymentReference ?? null;
  if (pin !== null) {
    if (!pin || typeof pin !== "object" || Array.isArray(pin)) {
      throw new DriftInputError("snapshot.officialLaunchpadDeploymentReference must be an object");
    }
    if (typeof pin.path !== "string" || pin.path.length === 0 || path.isAbsolute(pin.path)
      || pin.path.includes("\\") || pin.path.split("/").includes("..")) {
      throw new DriftInputError("snapshot.officialLaunchpadDeploymentReference.path must be a safe relative path");
    }
    if (!sha256Pattern.test(pin.sha256 ?? "")) {
      throw new DriftInputError("snapshot.officialLaunchpadDeploymentReference.sha256 must be an exact SHA-256 digest");
    }
  }
  if (!explicitPath && !pin) return null;

  const referencePath = explicitPath
    ? path.resolve(explicitPath)
    : path.resolve(path.dirname(snapshotPath), pin.path);
  const bytes = readFileBytes(referencePath, "deployment reference");
  if (pin) {
    const actualSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== pin.sha256.toLowerCase()) {
      throw new DriftInputError(
        `deployment reference SHA-256 mismatch: expected ${pin.sha256.toLowerCase()}, observed ${actualSha256}`
      );
    }
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new DriftInputError(`deployment reference file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateLaunchpadReference(snapshot, launchpadReference) {
  if (launchpadReference === null || launchpadReference === undefined) return null;
  let validated;
  try {
    validated = validateOfficialLaunchpadReference(launchpadReference);
  } catch (error) {
    if (error instanceof OfficialLaunchpadReferenceError) {
      throw new DriftInputError(`deployment reference: ${error.message}`);
    }
    throw error;
  }
  if (launchpadReference.snapshotDate !== snapshot.snapshotDate) {
    throw new DriftInputError("deployment reference snapshotDate must equal the upstream snapshotDate");
  }
  const feed = validated.sourcesById.get("uniswap-deployments-feed");
  const trackedFeed = snapshot.observedOfficialFeeds.find((candidate) => candidate.url === feed.url);
  if (!trackedFeed) {
    throw new DriftInputError(`deployment reference feed is not tracked by the upstream snapshot: ${feed.url}`);
  }
  if (trackedFeed.sha256.toLowerCase() !== feed.contentSha256.toLowerCase()) {
    throw new DriftInputError("deployment reference feed hash does not match the upstream snapshot feed hash");
  }
  return { reference: launchpadReference, feed };
}

function compareOfficialSourceArtifacts(reference, observedArtifacts) {
  const observedByUrl = new Map(observedArtifacts.map((artifact) => [artifact.url, artifact]));
  const findings = [];
  for (const source of reference.sources) {
    if (source.authorityKind === "official-deployment-feed") continue;
    const observed = observedByUrl.get(source.immutableUrl);
    if (!observed) {
      findings.push({
        code: "official-source-artifact-missing",
        url: source.immutableUrl,
        expected: "present",
        actual: "missing"
      });
      continue;
    }
    if (source.contentSha256.toLowerCase() !== observed.sha256.toLowerCase()) {
      findings.push({
        code: "official-source-sha256-drift",
        url: source.immutableUrl,
        field: "sha256",
        expected: source.contentSha256.toLowerCase(),
        actual: observed.sha256.toLowerCase()
      });
    }
  }
  return findings;
}

function parseDeploymentFeed(bytes, url) {
  let feed;
  try {
    feed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new DriftInputError(`${url}: deployment feed is not valid JSON`);
  }
  if (!feed || typeof feed !== "object" || Array.isArray(feed) || !Array.isArray(feed.records)) {
    throw new DriftInputError(`${url}: deployment feed records must be an array`);
  }
  return feed.records;
}

function validateNetworkTimeout(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60_000) {
    throw new DriftInputError("network timeout must be an integer from 10 through 60000 milliseconds");
  }
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new DriftInputError("snapshot must be a JSON object");
  }
  if (typeof snapshot.snapshotDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.snapshotDate)) {
    throw new DriftInputError("snapshot.snapshotDate must use YYYY-MM-DD");
  }
  validatePolicy(snapshot.driftPolicy);
  if (!Array.isArray(snapshot.observedOfficialFeeds)) {
    throw new DriftInputError("snapshot.observedOfficialFeeds must be an array");
  }

  const feedUrls = new Set();
  for (const [index, feed] of snapshot.observedOfficialFeeds.entries()) {
    const location = `snapshot.observedOfficialFeeds[${index}]`;
    validateHttpsUrl(feed?.url, `${location}.url`);
    if (!sha256Pattern.test(feed?.sha256 ?? "")) {
      throw new DriftInputError(`${location}.sha256 must be an exact SHA-256 digest`);
    }
    if (feedUrls.has(feed.url)) throw new DriftInputError(`duplicate tracked feed ${feed.url}`);
    feedUrls.add(feed.url);
  }

  const trackedRepositories = [];
  collectTrackedRepositories(snapshot, "$", trackedRepositories);
  const repositories = new Set();
  for (const source of trackedRepositories) {
    if (repositories.has(source.key)) throw new DriftInputError(`duplicate tracked repository ${source.repository}`);
    repositories.add(source.key);
  }
  return trackedRepositories;
}

function validatePolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new DriftInputError("snapshot.driftPolicy must be an object");
  }
  if (typeof policy.organization !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(policy.organization)) {
    throw new DriftInputError("snapshot.driftPolicy.organization is invalid");
  }
  if (!Array.isArray(policy.repositoryNamePatterns) || policy.repositoryNamePatterns.length === 0) {
    throw new DriftInputError("snapshot.driftPolicy.repositoryNamePatterns must be a non-empty array");
  }
  for (const [index, pattern] of policy.repositoryNamePatterns.entries()) {
    if (typeof pattern !== "string" || pattern.length === 0 || pattern.length > 100) {
      throw new DriftInputError(`snapshot.driftPolicy.repositoryNamePatterns[${index}] is invalid`);
    }
    try {
      new RegExp(pattern, "i");
    } catch {
      throw new DriftInputError(`snapshot.driftPolicy.repositoryNamePatterns[${index}] is not a valid regular expression`);
    }
  }
  if (typeof policy.ignoreArchivedRepositories !== "boolean") {
    throw new DriftInputError("snapshot.driftPolicy.ignoreArchivedRepositories must be boolean");
  }
}

function collectTrackedRepositories(value, location, output) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectTrackedRepositories(entry, `${location}[${index}]`, output));
    return;
  }
  if (!value || typeof value !== "object") return;

  if (Object.hasOwn(value, "trackedRef")) {
    const identity = parseGitHubRepository(value.repository, `${location}.repository`);
    if (typeof value.defaultBranch !== "string" || value.defaultBranch.length === 0) {
      throw new DriftInputError(`${location}.defaultBranch must be a non-empty string`);
    }
    if (value.trackedRef !== `refs/heads/${value.defaultBranch}`) {
      throw new DriftInputError(`${location}.trackedRef must identify the recorded default branch`);
    }
    if (!gitObjectPattern.test(value.commit ?? "")) {
      throw new DriftInputError(`${location}.commit must be an exact 40-character Git object id`);
    }
    if (typeof value.archived !== "boolean") {
      throw new DriftInputError(`${location}.archived must be boolean`);
    }
    const compareLicense = Object.hasOwn(value, "license");
    const license = compareLicense ? normalizeLicense(value.license, `${location}.license`) : undefined;
    output.push({
      repository: canonicalRepositoryUrl(identity),
      key: identity.key,
      defaultBranch: value.defaultBranch,
      trackedRef: value.trackedRef,
      commit: value.commit,
      archived: value.archived,
      compareLicense,
      license
    });
  }

  for (const [key, child] of Object.entries(value)) {
    collectTrackedRepositories(child, `${location}.${key}`, output);
  }
}

function validateObservations(observations, requireDeploymentRecords = false) {
  if (!observations || typeof observations !== "object" || Array.isArray(observations)) {
    throw new DriftInputError("observations must be a JSON object");
  }
  if (!Array.isArray(observations.repositories)) {
    throw new DriftInputError("observations.repositories must be an array");
  }
  if (!Array.isArray(observations.feeds)) {
    throw new DriftInputError("observations.feeds must be an array");
  }

  const repositories = new Map();
  for (const [index, observed] of observations.repositories.entries()) {
    const location = `observations.repositories[${index}]`;
    const identity = parseGitHubRepository(observed?.repository, `${location}.repository`);
    if (repositories.has(identity.key)) {
      throw new DriftInputError(`duplicate observed repository ${canonicalRepositoryUrl(identity)}`);
    }
    const defaultBranch = nullableString(observed.defaultBranch, `${location}.defaultBranch`);
    const ref = nullableString(observed.ref, `${location}.ref`);
    const commit = observed.commit === null || observed.commit === undefined
      ? null
      : exactDigest(observed.commit, gitObjectPattern, `${location}.commit`, "Git object id");
    if (typeof observed.archived !== "boolean") {
      throw new DriftInputError(`${location}.archived must be boolean`);
    }
    repositories.set(identity.key, {
      repository: canonicalRepositoryUrl(identity),
      defaultBranch,
      ref,
      commit,
      archived: observed.archived,
      license: normalizeLicense(observed.license, `${location}.license`)
    });
  }

  const feedUrls = new Set();
  for (const [index, observed] of observations.feeds.entries()) {
    const location = `observations.feeds[${index}]`;
    validateHttpsUrl(observed?.url, `${location}.url`);
    exactDigest(observed.sha256, sha256Pattern, `${location}.sha256`, "SHA-256 digest");
    if (feedUrls.has(observed.url)) throw new DriftInputError(`duplicate observed feed ${observed.url}`);
    feedUrls.add(observed.url);
  }
  if (requireDeploymentRecords && !Array.isArray(observations.deploymentRecords)) {
    throw new DriftInputError("observations.deploymentRecords must be an array when a deployment reference is selected");
  }
  if (requireDeploymentRecords && !Array.isArray(observations.sourceArtifacts)) {
    throw new DriftInputError("observations.sourceArtifacts must be an array when a deployment reference is selected");
  }
  const sourceArtifactUrls = new Set();
  for (const [index, artifact] of (observations.sourceArtifacts ?? []).entries()) {
    const location = `observations.sourceArtifacts[${index}]`;
    validateHttpsUrl(artifact?.url, `${location}.url`);
    exactDigest(artifact.sha256, sha256Pattern, `${location}.sha256`, "SHA-256 digest");
    if (sourceArtifactUrls.has(artifact.url)) {
      throw new DriftInputError(`duplicate observed source artifact ${artifact.url}`);
    }
    sourceArtifactUrls.add(artifact.url);
  }
  return {
    repositories,
    deploymentRecords: Array.isArray(observations.deploymentRecords) ? observations.deploymentRecords : [],
    sourceArtifacts: Array.isArray(observations.sourceArtifacts) ? observations.sourceArtifacts : []
  };
}

function collectKnownRepositoryKeys(snapshot) {
  const repositories = new Set();
  visit(snapshot);
  return repositories;

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.repository === "string") {
      try {
        repositories.add(parseGitHubRepository(value.repository).key);
      } catch {
        // Non-GitHub source records are not part of GitHub organization discovery.
      }
    }
    Object.values(value).forEach(visit);
  }
}

function normalizeGitHubMetadata(repository, location) {
  if (!repository || typeof repository !== "object" || Array.isArray(repository)) {
    throw new DriftInputError(`${location}: expected a repository object`);
  }
  const identity = parseGitHubRepository(repository.html_url, `${location}.html_url`);
  if (typeof repository.default_branch !== "string" || repository.default_branch.length === 0) {
    throw new DriftInputError(`${location}.default_branch must be a non-empty string`);
  }
  if (typeof repository.archived !== "boolean") {
    throw new DriftInputError(`${location}.archived must be boolean`);
  }
  return {
    key: identity.key,
    repository: canonicalRepositoryUrl(identity),
    defaultBranch: repository.default_branch,
    ref: `refs/heads/${repository.default_branch}`,
    commit: null,
    archived: repository.archived,
    license: normalizeLicense(repository.license?.spdx_id ?? null, `${location}.license.spdx_id`)
  };
}

async function fetchJson(url, fetchImplementation, limit, timeoutMs) {
  const bytes = await fetchBytes(url, fetchImplementation, limit, timeoutMs, {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  });
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new DriftInputError(`${url}: response is not valid JSON`);
  }
}

async function fetchBytes(url, fetchImplementation, limit, timeoutMs, additionalHeaders = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImplementation(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
        "User-Agent": "programmable-v4-hook-builder-drift-check",
        ...additionalHeaders
      },
      redirect: "error",
      signal: controller.signal
    });
    if (!response?.ok) {
      const rateLimit = response?.headers?.get?.("x-ratelimit-remaining");
      const suffix = rateLimit === "0" ? " (GitHub public API rate limit exhausted)" : "";
      throw new DriftInputError(`${url}: HTTP ${response?.status ?? "unknown"}${suffix}`);
    }
    const contentLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(contentLength) && contentLength > limit) {
      throw new DriftInputError(`${url}: response exceeds the ${limit} byte limit`);
    }
    if (!response.body || typeof response.body.getReader !== "function") {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > limit) throw new DriftInputError(`${url}: response exceeds the ${limit} byte limit`);
      return bytes;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new DriftInputError(`${url}: response exceeds the ${limit} byte limit`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    if (error instanceof DriftInputError) throw error;
    const detail = controller.signal.aborted
      ? `request timed out after ${timeoutMs}ms`
      : error instanceof Error ? error.message : String(error);
    throw new DriftInputError(`${url}: ${detail}`);
  } finally {
    clearTimeout(timeout);
  }
}

function compareField(findings, repository, field, expected, actual) {
  if (expected === actual) return;
  findings.push({
    code: `${field.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}-drift`,
    repository,
    field,
    expected,
    actual
  });
}

function compareFindings(left, right) {
  const leftTarget = left.repository ?? left.url ?? left.recordId ?? "";
  const rightTarget = right.repository ?? right.url ?? right.recordId ?? "";
  return leftTarget.localeCompare(rightTarget)
    || left.code.localeCompare(right.code)
    || (left.field ?? "").localeCompare(right.field ?? "");
}

function renderResult(result) {
  const deploymentSummary = Object.hasOwn(result.compared, "deploymentRecords")
    ? `, ${result.compared.deploymentRecords} deployment records and ${result.compared.officialSourceArtifacts} official source artifacts`
    : "";
  const summary = `Compared ${result.compared.repositories} repositories, ${result.compared.feeds} feeds${deploymentSummary} against the ${result.snapshotDate} snapshot.`;
  if (result.status === "clean") return `Upstream drift check is clean. ${summary}\n`;
  const lines = [`Upstream drift detected (${result.findings.length} findings). ${summary}`];
  for (const finding of result.findings) {
    const target = finding.repository ?? finding.url ?? finding.recordId;
    const field = finding.field ? ` ${finding.field}` : "";
    lines.push(`- [${finding.code}] ${target}${field}: expected ${formatValue(finding.expected)}; observed ${formatValue(finding.actual)}`);
  }
  return `${lines.join("\n")}\n`;
}

function readJsonFile(inputPath, label) {
  const absolutePath = path.resolve(inputPath);
  const bytes = readFileBytes(absolutePath, label);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new DriftInputError(`${label} file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readFileBytes(absolutePath, label) {
  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch (error) {
    throw new DriftInputError(`${label} file cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile()) throw new DriftInputError(`${label} path is not a file: ${absolutePath}`);
  if (stat.size > maximumInputBytes) {
    throw new DriftInputError(`${label} file exceeds the ${maximumInputBytes} byte limit`);
  }
  try {
    return fs.readFileSync(absolutePath);
  } catch (error) {
    throw new DriftInputError(`${label} file cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseGitHubRepository(repository, location = "repository") {
  if (typeof repository !== "string") throw new DriftInputError(`${location} must be a GitHub repository URL`);
  let url;
  try {
    url = new URL(repository);
  } catch {
    throw new DriftInputError(`${location} must be a GitHub repository URL`);
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.search || url.hash) {
    throw new DriftInputError(`${location} must be an HTTPS github.com repository URL`);
  }
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length !== 2) throw new DriftInputError(`${location} must identify one GitHub repository`);
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/i, "");
  if (!owner || !name || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new DriftInputError(`${location} contains an invalid GitHub owner or repository name`);
  }
  return { owner, name, key: `${owner}/${name}`.toLowerCase() };
}

function canonicalRepositoryUrl(identity) {
  return `https://github.com/${identity.owner}/${identity.name}.git`;
}

function normalizeLicense(value, location) {
  if (value === null || value === undefined || value === "NOASSERTION") return null;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 100) {
    throw new DriftInputError(`${location} must be null or a non-empty SPDX identifier`);
  }
  return value.trim();
}

function nullableString(value, location) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 300) {
    throw new DriftInputError(`${location} must be null or a non-empty string`);
  }
  return value;
}

function exactDigest(value, pattern, location, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new DriftInputError(`${location} must be an exact ${label}`);
  }
  return value.toLowerCase();
}

function validateHttpsUrl(value, location) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new DriftInputError(`${location} must be an HTTPS URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new DriftInputError(`${location} must be an HTTPS URL without credentials`);
  }
}

function formatValue(value) {
  return value === null ? "null" : JSON.stringify(value);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await run();
}
