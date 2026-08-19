import path from "node:path";
import { canonicalJson } from "./submission-core.mjs";
import {
  MAXIMUM_INDEX_BYTES,
  MAXIMUM_RECORD_BYTES,
  MAXIMUM_SNAPSHOT_BYTES,
  PROGRAMMABLE_REGISTRY,
  REGISTRY_PUBLIC_BASELINE_COMMIT,
  SNAPSHOT_SCHEMA_VERSION
} from "./registry-discovery-definitions.mjs";
import {
  decoder,
  fail,
  fetchBytes,
  fetchCanonicalRegistryJson,
  fetchJson,
  isPlainObject,
  parseJsonBytes,
  rawUrl,
  readCanonicalRegistryJson,
  readRegularFile,
  requireCommit,
  requireTimestamp,
  sha256
} from "./registry-discovery-primitives.mjs";
import {
  createGitSourceReceipt,
  assertGitObjectId,
  commitTreeObjectId,
  gitObjectBytes,
  gitText,
  isCanonicalRegistryRemote,
  parseCanonicalRegistrySource,
  resolveGitPath
} from "./registry-discovery-git.mjs";
import {
  createSession,
  findIndexRecord,
  parseAndVerifyRecord,
  validateIndexes,
  validateProjectRecord,
  validateSnapshot
} from "./registry-discovery-validation.mjs";

export async function openLiveRegistry({ fetchImplementation = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (typeof fetchImplementation !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    fail("REGISTRY_OPTIONS_INVALID", "live Registry options are invalid", 2);
  }
  const repository = await fetchJson(PROGRAMMABLE_REGISTRY.apiRepository, MAXIMUM_INDEX_BYTES, { fetchImplementation, timeoutMs });
  if (
    String(repository.id) !== PROGRAMMABLE_REGISTRY.numericRepositoryId
    || repository.full_name !== PROGRAMMABLE_REGISTRY.repository
    || repository.html_url !== PROGRAMMABLE_REGISTRY.repositoryUri
    || repository.private !== false
    || repository.default_branch !== PROGRAMMABLE_REGISTRY.defaultBranch
  ) fail("REGISTRY_IDENTITY_MISMATCH", "the fixed Programmable Registry identity changed");

  const commitValue = await fetchJson(
    `${PROGRAMMABLE_REGISTRY.apiRepository}/commits/${PROGRAMMABLE_REGISTRY.defaultBranch}`,
    MAXIMUM_INDEX_BYTES,
    { fetchImplementation, timeoutMs }
  );
  const commit = requireCommit(commitValue.sha, "Registry commit");
  const tree = requireCommit(commitValue.commit?.tree?.sha, "Registry tree");
  const [index, search] = await Promise.all([
    fetchCanonicalRegistryJson(rawUrl(commit, "registry/index.json"), MAXIMUM_INDEX_BYTES, { fetchImplementation, timeoutMs }),
    fetchCanonicalRegistryJson(rawUrl(commit, "registry/search-index.json"), MAXIMUM_INDEX_BYTES, { fetchImplementation, timeoutMs })
  ]);
  validateIndexes(index, search);
  return createSession({
    index,
    search,
    source: {
      commit,
      defaultBranch: PROGRAMMABLE_REGISTRY.defaultBranch,
      mode: "live",
      numericRepositoryId: PROGRAMMABLE_REGISTRY.numericRepositoryId,
      repository: PROGRAMMABLE_REGISTRY.repository,
      repositoryUri: PROGRAMMABLE_REGISTRY.repositoryUri,
      tree
    },
    loadRecord: async (id) => {
      const summary = findIndexRecord(index, id);
      const bytes = await fetchBytes(rawUrl(commit, summary.path), MAXIMUM_RECORD_BYTES, { fetchImplementation, timeoutMs });
      return parseAndVerifyRecord(bytes, summary);
    }
  });
}

export function openLocalRegistry({ repositoryRoot }) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.trim() !== repositoryRoot || repositoryRoot.length === 0) {
    fail("REGISTRY_OPTIONS_INVALID", "local Registry root is invalid", 2);
  }
  const root = path.resolve(repositoryRoot);
  const index = readCanonicalRegistryJson(path.join(root, "registry/index.json"), MAXIMUM_INDEX_BYTES, "local Registry index");
  const search = readCanonicalRegistryJson(path.join(root, "registry/search-index.json"), MAXIMUM_INDEX_BYTES, "local Registry search index");
  validateIndexes(index, search);
  return createSession({
    index,
    search,
    source: {
      defaultBranch: PROGRAMMABLE_REGISTRY.defaultBranch,
      mode: "local-maintenance",
      numericRepositoryId: PROGRAMMABLE_REGISTRY.numericRepositoryId,
      repository: PROGRAMMABLE_REGISTRY.repository,
      repositoryUri: PROGRAMMABLE_REGISTRY.repositoryUri
    },
    loadRecord: async (id) => {
      const summary = findIndexRecord(index, id);
      const bytes = readRegularFile(path.join(root, summary.path), MAXIMUM_RECORD_BYTES, `local Registry record ${id}`);
      return parseAndVerifyRecord(bytes, summary);
    }
  });
}

export function openGitRegistry({ repositoryRoot, commit }) {
  if (
    typeof repositoryRoot !== "string"
    || repositoryRoot.trim() !== repositoryRoot
    || repositoryRoot.length === 0
    || commit !== REGISTRY_PUBLIC_BASELINE_COMMIT
  ) {
    fail("REGISTRY_OPTIONS_INVALID", "exact Git Registry source must use the reviewed public baseline commit", 2);
  }
  const root = path.resolve(repositoryRoot);
  const remoteUrl = gitText(root, ["remote", "get-url", "origin"], "Registry origin URL");
  if (!isCanonicalRegistryRemote(remoteUrl)) {
    fail("REGISTRY_IDENTITY_MISMATCH", "the Git Registry origin is not the canonical public repository");
  }
  const originMain = gitText(root, ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"], "Registry origin/main");
  const resolvedCommit = gitText(root, ["rev-parse", "--verify", `${commit}^{commit}`], "Registry commit");
  if (originMain !== commit || resolvedCommit !== commit) {
    fail("REGISTRY_IDENTITY_MISMATCH", "the requested Registry commit is not the exact fetched public origin/main");
  }

  const commitBytes = gitObjectBytes(root, "commit", commit);
  assertGitObjectId("commit", commitBytes, commit, "Registry commit object");
  const tree = commitTreeObjectId(commitBytes);
  const objectStore = new Map([[commit, Object.freeze({ bytes: commitBytes, type: "commit" })]]);
  const indexBinding = resolveGitPath(root, tree, "registry/index.json", objectStore);
  const searchBinding = resolveGitPath(root, tree, "registry/search-index.json", objectStore);
  const index = parseCanonicalRegistrySource(indexBinding.bytes, "Git Registry index");
  const search = parseCanonicalRegistrySource(searchBinding.bytes, "Git Registry search index");
  validateIndexes(index, search);

  const bindings = [indexBinding, searchBinding];
  const recordBytes = new Map();
  for (const summary of index.records) {
    const binding = resolveGitPath(root, tree, summary.path, objectStore);
    bindings.push(binding);
    recordBytes.set(summary.id, binding.bytes);
    parseAndVerifyRecord(binding.bytes, summary);
  }
  const sourceReceipt = createGitSourceReceipt({ bindings, commit, objectStore, tree });

  return createSession({
    index,
    search,
    source: {
      commit,
      defaultBranch: PROGRAMMABLE_REGISTRY.defaultBranch,
      mode: "exact-public-git-baseline",
      numericRepositoryId: PROGRAMMABLE_REGISTRY.numericRepositoryId,
      receipt: sourceReceipt,
      repository: PROGRAMMABLE_REGISTRY.repository,
      repositoryUri: PROGRAMMABLE_REGISTRY.repositoryUri,
      tree
    },
    loadRecord: async (id) => {
      const summary = findIndexRecord(index, id);
      const bytes = recordBytes.get(id);
      if (bytes === undefined) fail("REGISTRY_RECORD_MISSING", `Git Registry record ${id} is missing`);
      return parseAndVerifyRecord(bytes, summary);
    }
  });
}

export function openOfflineRegistry({ skillRoot }) {
  const snapshotPath = path.join(path.resolve(skillRoot), "references/programmable-registry-snapshot.json");
  const bytes = readRegularFile(snapshotPath, MAXIMUM_SNAPSHOT_BYTES, "offline Registry snapshot");
  const snapshot = parseJsonBytes(bytes, "offline Registry snapshot");
  if (decoder.decode(bytes) !== `${canonicalJson(snapshot)}\n`) fail("REGISTRY_SNAPSHOT_INVALID", "the offline Registry snapshot is not canonical");
  validateSnapshot(snapshot);
  const records = new Map(snapshot.projects.map(({ record }) => [record.id, record]));
  const entries = new Map(snapshot.projects.map((entry) => [entry.record.id, entry]));
  return createSession({
    index: snapshot.index,
    search: snapshot.search,
    source: {
      ...snapshot.registry,
      baseline: snapshot.sourceReceipt.authority,
      capturedAt: snapshot.capturedAt,
      commit: snapshot.sourceReceipt.commitObjectId,
      mode: "offline-snapshot",
      sourceReceiptSha256: sha256(Buffer.from(canonicalJson(snapshot.sourceReceipt), "utf8")),
      tree: snapshot.sourceReceipt.treeObjectId
    },
    loadRecord: async (id) => {
      const summary = findIndexRecord(snapshot.index, id);
      const record = records.get(id);
      if (record === undefined) fail("REGISTRY_RECORD_MISSING", `offline Registry record ${id} is missing`);
      const bytes = Buffer.from(`${canonicalJson(record)}\n`, "utf8");
      const snapshotEntry = entries.get(id);
      // The source Registry hashes its original bytes. The portable snapshot separately binds canonical record bytes.
      if (
        snapshotEntry === undefined
        || snapshotEntry.canonicalSha256 !== sha256(bytes)
        || snapshotEntry.sourceSha256 !== summary.sha256
      ) {
        fail("REGISTRY_RECORD_DIGEST_MISMATCH", `offline Registry record ${id} failed digest verification`);
      }
      validateProjectRecord(record, summary);
      return record;
    }
  });
}

export async function createRegistrySnapshot(session, { capturedAt = session?.index?.generatedAt } = {}) {
  requireTimestamp(capturedAt, "snapshot capturedAt");
  if (!isPlainObject(session?.source?.receipt)) {
    fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "snapshot creation requires an exact public Git source receipt", 2);
  }
  const projects = [];
  for (const summary of session.index.records) {
    const record = await session.loadRecord(summary.id);
    projects.push({
      canonicalSha256: sha256(Buffer.from(`${canonicalJson(record)}\n`, "utf8")),
      record,
      sourceSha256: summary.sha256
    });
  }
  return {
    capturedAt,
    index: session.index,
    projects,
    registry: {
      defaultBranch: PROGRAMMABLE_REGISTRY.defaultBranch,
      numericRepositoryId: PROGRAMMABLE_REGISTRY.numericRepositoryId,
      repository: PROGRAMMABLE_REGISTRY.repository,
      repositoryUri: PROGRAMMABLE_REGISTRY.repositoryUri
    },
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    search: session.search,
    sourceReceipt: session.source.receipt
  };
}
