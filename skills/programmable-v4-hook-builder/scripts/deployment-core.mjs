import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateOfficialLaunchpadReference } from "./official-launchpad-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DEPLOYMENT_SNAPSHOT = path.resolve(scriptDirectory, "..", "references", "deployment-snapshot.json");
export const DEFAULT_OFFICIAL_DEPLOYMENT_REFERENCE = path.resolve(
  scriptDirectory,
  "..",
  "references",
  "official-launchpad-deployments.json"
);
export const DEPLOYMENT_TRUST_TIERS = Object.freeze({
  feedSnapshot: "pinned-official-feed-snapshot",
  officialReference: "official-launchpad-reference-runtime-unverified"
});

const feedBackedRepositories = new Set([
  "https://github.com/uniswap/v4-core",
  "https://github.com/uniswap/v4-periphery",
  "https://github.com/uniswap/permit2",
  "https://github.com/uniswap/universal-router"
]);

export function loadDeploymentSnapshot(target = DEFAULT_DEPLOYMENT_SNAPSHOT) {
  const snapshot = JSON.parse(fs.readFileSync(target, "utf8"));
  const errors = [];
  if (snapshot.schemaVersion !== 1) errors.push("deployment snapshot schemaVersion must be 1");
  if (typeof snapshot.feedUrl !== "string" || !snapshot.feedUrl.startsWith("https://")) errors.push("deployment snapshot feedUrl must be HTTPS");
  if (!/^[a-fA-F0-9]{64}$/.test(snapshot.feedSha256 ?? "")) errors.push("deployment snapshot feedSha256 must be an exact SHA-256 digest");
  if (!/^[a-fA-F0-9]{40}$/.test(snapshot.source?.commit ?? "")) errors.push("deployment snapshot source.commit must be an exact Git commit");
  if (!Array.isArray(snapshot.records) || snapshot.records.length === 0) errors.push("deployment snapshot records must be a non-empty array");

  const ids = new Set();
  for (const [index, record] of (snapshot.records ?? []).entries()) {
    const context = `deployment snapshot records[${index}]`;
    if (typeof record.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id)) errors.push(`${context}.id is invalid`);
    else if (ids.has(record.id)) errors.push(`${context}.id is duplicated: ${record.id}`);
    else ids.add(record.id);
    if (!Number.isInteger(record.chainId) || record.chainId <= 0) errors.push(`${context}.chainId must be a positive integer`);
    if (!/^0x[a-fA-F0-9]{40}$/.test(record.address ?? "")) errors.push(`${context}.address is invalid`);
    if (typeof record.contract !== "string" || record.contract.length === 0) errors.push(`${context}.contract is required`);
    if (!normalizeRepository(record.sourceRepo)) errors.push(`${context}.sourceRepo must be an HTTPS GitHub repository`);
    if (!record.sourceRef) errors.push(`${context}.sourceRef is required`);
    if (typeof record.sourceCodeUrl !== "string" || !record.sourceCodeUrl.startsWith("https://github.com/")) errors.push(`${context}.sourceCodeUrl must preserve the exact HTTPS feed value`);
    if (!normalizeRepository(record.implementationRepo)) errors.push(`${context}.implementationRepo must identify the repository implied by sourceCodeUrl`);
    if (!["resolved", "unresolved", "ambiguous"].includes(record.sourceRefResolution)) errors.push(`${context}.sourceRefResolution is invalid`);
    if (!record.status) errors.push(`${context}.status is required`);
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
  return snapshot;
}

export function loadOfficialDeploymentReference(target = DEFAULT_OFFICIAL_DEPLOYMENT_REFERENCE) {
  const reference = JSON.parse(fs.readFileSync(target, "utf8"));
  validateOfficialLaunchpadReference(reference);
  return reference;
}

export function loadDeploymentRegistry({
  snapshotPath = DEFAULT_DEPLOYMENT_SNAPSHOT,
  officialReferencePath = DEFAULT_OFFICIAL_DEPLOYMENT_REFERENCE
} = {}) {
  const snapshot = loadDeploymentSnapshot(snapshotPath);
  const officialReference = loadOfficialDeploymentReference(officialReferencePath);
  return Object.freeze({
    snapshot,
    officialReference,
    identities: Object.freeze({
      deploymentSnapshotSha256: hashFile(snapshotPath),
      officialDeploymentReferenceSha256: hashFile(officialReferencePath)
    })
  });
}

export function resolveDeployment(snapshot, query) {
  const active = snapshot.records.filter((record) => record.status === "active");
  let matches;
  if (query.id) {
    matches = active.filter((record) => record.id === query.id);
  } else {
    matches = active.filter((record) => {
      if (query.chainId !== undefined && record.chainId !== query.chainId) return false;
      if (query.contract !== undefined && record.contract.toLowerCase() !== query.contract.toLowerCase()) return false;
      return true;
    });
  }
  if (matches.length !== 1) {
    const selector = query.id ?? `chainId=${String(query.chainId)}, contract=${String(query.contract)}`;
    throw new Error(`deployment selector must resolve to exactly one active record (${selector}); found ${matches.length}`);
  }
  return matches[0];
}

export function resolveDeploymentBinding(registry, query) {
  if (!registry?.snapshot || !registry?.officialReference) {
    throw new Error("deployment registry must contain the pinned feed snapshot and official launchpad reference");
  }
  const snapshotMatches = deploymentMatches(registry.snapshot.records, query);
  if (snapshotMatches.length > 1) throwResolutionError(query, snapshotMatches.length);
  if (snapshotMatches.length === 1) {
    return Object.freeze({
      trustTier: DEPLOYMENT_TRUST_TIERS.feedSnapshot,
      runtimeVerificationStatus: "required-before-execution",
      authorityReferenceSha256: registry.identities.deploymentSnapshotSha256,
      authorityReferenceKind: "pinned-official-deployment-feed-snapshot",
      record: Object.freeze({ ...snapshotMatches[0] })
    });
  }

  const validated = validateOfficialLaunchpadReference(registry.officialReference);
  const officialMatches = deploymentMatches([...validated.recordsById.values()], query);
  if (officialMatches.length !== 1) throwResolutionError(query, officialMatches.length);
  const record = normalizeOfficialReferenceRecord(officialMatches[0]);
  return Object.freeze({
    trustTier: DEPLOYMENT_TRUST_TIERS.officialReference,
    runtimeVerificationStatus: "required-before-execution",
    authorityReferenceSha256: registry.identities.officialDeploymentReferenceSha256,
    authorityReferenceKind: "committed-official-launchpad-reference",
    record: Object.freeze(record)
  });
}

export function verifyFeedBackedDependency(dependency, { chainId, snapshot, registry }) {
  return inspectFeedBackedDependency(dependency, { chainId, snapshot, registry }).errors;
}

export function inspectFeedBackedDependency(dependency, { chainId, snapshot, registry }) {
  const errors = [];
  const warnings = [];
  const repository = normalizeRepository(dependency?.repository);
  const shouldUseFeed = feedBackedRepositories.has(repository);
  if (!shouldUseFeed && !dependency?.deploymentRecordId) return { errors, warnings, binding: null };
  if (!dependency?.deploymentRecordId) {
    errors.push("official Uniswap dependency is missing deploymentRecordId");
    return { errors, warnings, binding: null };
  }

  let binding;
  try {
    binding = registry
      ? resolveDeploymentBinding(registry, { id: dependency.deploymentRecordId })
      : Object.freeze({
        trustTier: DEPLOYMENT_TRUST_TIERS.feedSnapshot,
        runtimeVerificationStatus: "required-before-execution",
        authorityReferenceSha256: null,
        authorityReferenceKind: "pinned-official-deployment-feed-snapshot",
        record: resolveDeployment(snapshot, { id: dependency.deploymentRecordId })
      });
  } catch (error) {
    errors.push(error.message);
    return { errors, warnings, binding: null };
  }
  const { record } = binding;
  const recordLabel = binding.trustTier === DEPLOYMENT_TRUST_TIERS.officialReference
    ? "official reference record"
    : "snapshot record";
  if (record.chainId !== chainId) errors.push(`deployment record ${record.id} is for chain ${record.chainId}, not target chain ${chainId}`);
  if ((dependency.chainAddress ?? "").toLowerCase() !== record.address.toLowerCase()) errors.push(`deployment address differs from ${recordLabel} ${record.id}`);
  if (normalizeRepository(dependency.repository) !== normalizeRepository(record.implementationRepo)) errors.push(`dependency repository differs from implementation source for ${recordLabel} ${record.id}`);
  if (record.sourceRefResolution === "ambiguous") {
    const message = `deployment record ${record.id} has a conflicted official sourceRef and cannot establish this router generation for execution`;
    if (binding.trustTier === DEPLOYMENT_TRUST_TIERS.officialReference) warnings.push(message);
    else errors.push(`deployment record ${record.id} has an ambiguous feed sourceRef and cannot establish this router generation`);
  }
  if (record.sourceRefResolution === "resolved" && dependency.revision?.toLowerCase() !== record.sourceCommit?.toLowerCase()) errors.push(`dependency revision differs from resolved source commit for ${recordLabel} ${record.id}`);
  if (binding.trustTier === DEPLOYMENT_TRUST_TIERS.officialReference) {
    warnings.push(`deployment record ${record.id} is a committed official reference whose runtime and interfaces remain unverified`);
  }
  return { errors, warnings, binding };
}

export function expectedRouterContract(generation) {
  return {
    V2_0: "UniversalRouter",
    V2_1_1: "UniversalRouter#v2.1.1",
    V2_2_0: "UniversalRouter#v2.2"
  }[generation] ?? null;
}

export function snapshotIdentity(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    feedVersion: snapshot.feedVersion,
    generatedAt: snapshot.generatedAt,
    retrievedAt: snapshot.retrievedAt,
    feedUrl: snapshot.feedUrl,
    feedSha256: snapshot.feedSha256,
    source: snapshot.source
  };
}

export function registryIdentity(registry) {
  const officialFeed = registry.officialReference.sources.find((source) => source.id === "uniswap-deployments-feed");
  return {
    deploymentSnapshot: {
      ...snapshotIdentity(registry.snapshot),
      sha256: registry.identities.deploymentSnapshotSha256,
      trustTier: DEPLOYMENT_TRUST_TIERS.feedSnapshot,
      runtimeVerificationStatus: "required-before-execution"
    },
    officialLaunchpadReference: {
      referenceKind: registry.officialReference.referenceKind,
      snapshotDate: registry.officialReference.snapshotDate,
      sha256: registry.identities.officialDeploymentReferenceSha256,
      feedSha256: officialFeed.contentSha256,
      source: officialFeed.source,
      trustTier: DEPLOYMENT_TRUST_TIERS.officialReference,
      runtimeVerificationStatus: "required-before-execution"
    }
  };
}

export function deploymentBindingEvidence(binding, registry) {
  const { record } = binding;
  const feed = binding.trustTier === DEPLOYMENT_TRUST_TIERS.officialReference
    ? registry.officialReference.sources.find((source) => source.id === "uniswap-deployments-feed")
    : {
      contentSha256: registry.snapshot.feedSha256,
      source: registry.snapshot.source
    };
  return {
    deploymentTrustTier: binding.trustTier,
    authorityReferenceSha256: binding.authorityReferenceSha256,
    feedSha256: feed.contentSha256,
    feedSourceRepository: feed.source.repository,
    feedSourceCommit: feed.source.commit,
    feedSourceRef: record.sourceRef,
    feedSourceCodeUrl: record.sourceCodeUrl,
    implementationRepository: record.implementationRepo,
    sourceRefResolution: record.sourceRefResolution
  };
}

function deploymentMatches(records, query) {
  return records.filter((record) => {
    if (record.status !== "active") return false;
    if (query.id !== undefined) return record.id === query.id;
    if (query.chainId !== undefined && record.chainId !== query.chainId) return false;
    if (query.contract !== undefined && record.contract.toLowerCase() !== query.contract.toLowerCase()) return false;
    return true;
  });
}

function throwResolutionError(query, count) {
  const selector = query.id ?? `chainId=${String(query.chainId)}, contract=${String(query.contract)}`;
  throw new Error(`deployment selector must resolve to exactly one active record (${selector}); found ${count}`);
}

function normalizeOfficialReferenceRecord(record) {
  const sourceRefResolution = {
    "release-commit-pinned": "resolved",
    "official-feed-ref-conflicted": "ambiguous",
    "official-feed-ref-unresolved": "unresolved"
  }[record.sourceResolutionStatus];
  return {
    ...record,
    implementationRepo: repositoryFromSourceCodeUrl(record.immutableSourceCodeUrl ?? record.sourceCodeUrl),
    sourceRefResolution,
    sourceCommit: sourceRefResolution === "resolved" ? record.releaseCommit : null
  };
}

function repositoryFromSourceCodeUrl(value) {
  try {
    const url = new URL(value);
    const [owner, repository] = url.pathname.split("/").filter(Boolean);
    return normalizeRepository(`https://github.com/${owner}/${repository}`);
  } catch {
    return null;
  }
}

function hashFile(target) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex")}`;
}

function normalizeRepository(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\.git$/i, "").replace(/\/$/, "").toLowerCase();
  return /^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(normalized) ? normalized : null;
}
