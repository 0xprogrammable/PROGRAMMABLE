import { canonicalJson } from "./submission-core.mjs";
import {
  ACCEPTANCE_PATH,
  BASE64,
  COMMIT,
  DIGEST,
  MAXIMUM_INDEX_BYTES,
  MAXIMUM_RECORDS,
  MAXIMUM_SOURCE_OBJECT_BYTES,
  MAXIMUM_SOURCE_OBJECTS,
  PROGRAMMABLE_REGISTRY,
  PROGRAMMABLE_REGISTRY_SNAPSHOT_IDENTITY,
  REGISTRY_INDEX_CURRENT_VERSION,
  REGISTRY_INDEX_LEGACY_VERSION,
  REGISTRY_INDEX_SUPPORTED_VERSIONS,
  REGISTRY_PROJECT_SCHEMA_VERSION,
  REGISTRY_PUBLIC_BASELINE_COMMIT,
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_SOURCE_RECEIPT_VERSION
} from "./registry-discovery-definitions.mjs";
import { isProgrammableRegistryActiveIntake } from "./registry-intake-contract.mjs";
import {
  assertSortedUnique,
  compareUtf8,
  difference,
  exactKeys,
  fail,
  intersection,
  isPlainObject,
  parseJsonBytes,
  requireId,
  requireTimestamp,
  sha256,
  validateTextTree
} from "./registry-discovery-primitives.mjs";
import {
  commitTreeObjectId,
  gitObjectId,
  parseCanonicalRegistrySource,
  resolveReceiptPath
} from "./registry-discovery-git.mjs";

const LEGACY_INDEX_RECORD_KEYS = Object.freeze([
  "capabilities",
  "id",
  "kind",
  "name",
  "path",
  "sha256",
  "status",
  "summary",
  "surfaces",
  "tags"
]);
const CURRENT_INDEX_RECORD_KEYS = Object.freeze([
  "acceptancePath",
  "acceptanceSha256",
  ...LEGACY_INDEX_RECORD_KEYS
].sort(compareUtf8));

export function createSession({ index, search, source, loadRecord }) {
  return Object.freeze({ index, loadRecord, search, source: Object.freeze(source) });
}

export function validateSnapshot(snapshot) {
  exactKeys(snapshot, ["capturedAt", "index", "projects", "registry", "schemaVersion", "search", "sourceReceipt"], "offline snapshot");
  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) fail("REGISTRY_SNAPSHOT_INVALID", "offline Registry snapshot version is unsupported");
  requireTimestamp(snapshot.capturedAt, "snapshot capturedAt");
  exactKeys(snapshot.registry, ["defaultBranch", "numericRepositoryId", "repository", "repositoryUri"], "snapshot Registry identity");
  if (
    snapshot.registry.defaultBranch !== PROGRAMMABLE_REGISTRY_SNAPSHOT_IDENTITY.defaultBranch
    || snapshot.registry.numericRepositoryId !== PROGRAMMABLE_REGISTRY_SNAPSHOT_IDENTITY.numericRepositoryId
    || snapshot.registry.repository !== PROGRAMMABLE_REGISTRY_SNAPSHOT_IDENTITY.repository
    || snapshot.registry.repositoryUri !== PROGRAMMABLE_REGISTRY_SNAPSHOT_IDENTITY.repositoryUri
  ) fail("REGISTRY_IDENTITY_MISMATCH", "offline Registry snapshot has the wrong repository identity");
  validateIndexes(snapshot.index, snapshot.search, PROGRAMMABLE_REGISTRY_SNAPSHOT_IDENTITY.repository);
  if (!Array.isArray(snapshot.projects) || snapshot.projects.length !== snapshot.index.records.length) fail("REGISTRY_SNAPSHOT_INVALID", "offline Registry snapshot has an incomplete project set");
  const ids = [];
  for (const entry of snapshot.projects) {
    exactKeys(entry, ["canonicalSha256", "record", "sourceSha256"], "snapshot project");
    if (!DIGEST.test(entry.canonicalSha256 ?? "") || !DIGEST.test(entry.sourceSha256 ?? "")) fail("REGISTRY_SNAPSHOT_INVALID", "offline Registry snapshot has an invalid project digest");
    const summary = findIndexRecord(snapshot.index, entry.record?.id);
    if (entry.sourceSha256 !== summary.sha256 || sha256(Buffer.from(`${canonicalJson(entry.record)}\n`, "utf8")) !== entry.canonicalSha256) fail("REGISTRY_RECORD_DIGEST_MISMATCH", `offline Registry record ${summary.id} failed digest verification`);
    validateProjectRecord(entry.record, summary);
    ids.push(entry.record.id);
  }
  assertSortedUnique(ids, "snapshot project ids");
  validateSnapshotSourceReceipt(snapshot);
}

export function validateSnapshotSourceReceipt(snapshot) {
  const receipt = snapshot.sourceReceipt;
  exactKeys(receipt, ["authority", "commitObjectId", "objects", "paths", "repository", "schemaVersion", "treeObjectId"], "snapshot source receipt");
  if (
    receipt.schemaVersion !== SNAPSHOT_SOURCE_RECEIPT_VERSION
    || receipt.authority !== "public-released-git-baseline"
    || receipt.commitObjectId !== REGISTRY_PUBLIC_BASELINE_COMMIT
    || !COMMIT.test(receipt.treeObjectId ?? "")
  ) fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "snapshot source receipt identity is invalid");
  exactKeys(receipt.repository, ["defaultBranch", "numericRepositoryId", "repository", "repositoryUri"], "snapshot source repository");
  if (
    receipt.repository.defaultBranch !== PROGRAMMABLE_REGISTRY_SNAPSHOT_IDENTITY.defaultBranch
    || receipt.repository.numericRepositoryId !== PROGRAMMABLE_REGISTRY_SNAPSHOT_IDENTITY.numericRepositoryId
    || receipt.repository.repository !== PROGRAMMABLE_REGISTRY_SNAPSHOT_IDENTITY.repository
    || receipt.repository.repositoryUri !== PROGRAMMABLE_REGISTRY_SNAPSHOT_IDENTITY.repositoryUri
    || canonicalJson(receipt.repository) !== canonicalJson(snapshot.registry)
  ) fail("REGISTRY_IDENTITY_MISMATCH", "snapshot source receipt has the wrong public Registry identity");

  if (!Array.isArray(receipt.objects) || receipt.objects.length < 3 || receipt.objects.length > MAXIMUM_SOURCE_OBJECTS) {
    fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "snapshot source object inventory is invalid");
  }
  const objectMap = new Map();
  for (const object of receipt.objects) {
    exactKeys(object, ["byteLength", "contentBase64", "objectId", "type"], "snapshot source object");
    if (
      !COMMIT.test(object.objectId ?? "")
      || !new Set(["blob", "commit", "tree"]).has(object.type)
      || !Number.isSafeInteger(object.byteLength)
      || object.byteLength < 1
      || object.byteLength > MAXIMUM_SOURCE_OBJECT_BYTES
      || typeof object.contentBase64 !== "string"
      || !BASE64.test(object.contentBase64)
      || object.contentBase64.length % 4 !== 0
      || objectMap.has(object.objectId)
    ) fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "snapshot source object metadata is invalid");
    const bytes = Buffer.from(object.contentBase64, "base64");
    if (
      bytes.length !== object.byteLength
      || bytes.toString("base64") !== object.contentBase64
      || gitObjectId(object.type, bytes) !== object.objectId
    ) fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "snapshot source object content does not match its Git id");
    objectMap.set(object.objectId, { bytes, type: object.type });
  }
  assertSortedUnique(receipt.objects.map(({ objectId }) => objectId), "snapshot source object ids");
  const commitObject = objectMap.get(receipt.commitObjectId);
  if (commitObject?.type !== "commit" || commitTreeObjectId(commitObject.bytes) !== receipt.treeObjectId) {
    fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "snapshot source commit does not bind the declared root tree");
  }

  if (!Array.isArray(receipt.paths) || receipt.paths.length !== snapshot.index.records.length + 2) {
    fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "snapshot source path inventory is incomplete");
  }
  const expectedPaths = [
    "registry/index.json",
    ...snapshot.index.records.map(({ path: recordPath }) => recordPath),
    "registry/search-index.json"
  ].sort(compareUtf8);
  const actualPaths = receipt.paths.map(({ path: sourcePath }) => sourcePath);
  if (canonicalJson(actualPaths) !== canonicalJson(expectedPaths)) {
    fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "snapshot source path inventory does not match the Registry index");
  }
  const usedObjectIds = new Set([receipt.commitObjectId]);
  const pathBytes = new Map();
  for (const binding of receipt.paths) {
    exactKeys(binding, ["blobObjectId", "byteLength", "mode", "path", "sha256"], "snapshot source path");
    if (
      typeof binding.path !== "string"
      || !expectedPaths.includes(binding.path)
      || binding.mode !== "100644"
      || !COMMIT.test(binding.blobObjectId ?? "")
      || !DIGEST.test(binding.sha256 ?? "")
      || !Number.isSafeInteger(binding.byteLength)
      || binding.byteLength < 2
      || binding.byteLength > MAXIMUM_INDEX_BYTES
    ) fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "snapshot source path binding is invalid");
    const resolved = resolveReceiptPath(receipt.treeObjectId, binding.path, objectMap, usedObjectIds);
    if (
      resolved.mode !== binding.mode
      || resolved.objectId !== binding.blobObjectId
      || resolved.bytes.length !== binding.byteLength
      || sha256(resolved.bytes) !== binding.sha256
    ) fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", `snapshot source path ${binding.path} failed its Git binding`);
    pathBytes.set(binding.path, resolved.bytes);
  }
  if (canonicalJson([...usedObjectIds].sort(compareUtf8)) !== canonicalJson(receipt.objects.map(({ objectId }) => objectId))) {
    fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "snapshot source object inventory contains missing or unrelated objects");
  }

  const sourceIndex = parseCanonicalRegistrySource(pathBytes.get("registry/index.json"), "snapshot source Registry index");
  const sourceSearch = parseCanonicalRegistrySource(pathBytes.get("registry/search-index.json"), "snapshot source Registry search index");
  if (canonicalJson(sourceIndex) !== canonicalJson(snapshot.index) || canonicalJson(sourceSearch) !== canonicalJson(snapshot.search)) {
    fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "snapshot indexes differ from the public Git source bytes");
  }
  for (const entry of snapshot.projects) {
    const summary = findIndexRecord(snapshot.index, entry.record.id);
    const sourceBytes = pathBytes.get(summary.path);
    const sourceRecord = parseJsonBytes(sourceBytes, `snapshot source Registry record ${entry.record.id}`);
    if (
      sha256(sourceBytes) !== summary.sha256
      || sha256(sourceBytes) !== entry.sourceSha256
      || canonicalJson(sourceRecord) !== canonicalJson(entry.record)
    ) fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", `snapshot project ${entry.record.id} differs from the public Git source bytes`);
  }
}

export function validateIndexes(index, search, activeIntakeRepository = PROGRAMMABLE_REGISTRY.repository) {
  exactKeys(index, ["activeIntake", "generatedAt", "legacyIntake", "records", "registryDigest", "schemaVersion"], "Registry index");
  exactKeys(search, ["generatedAt", "records", "registryDigest", "schemaVersion", "trustBoundary"], "Registry search index");
  if (
    !REGISTRY_INDEX_SUPPORTED_VERSIONS.has(index.schemaVersion)
    || search.schemaVersion !== index.schemaVersion
    || index.registryDigest !== search.registryDigest
    || !DIGEST.test(index.registryDigest ?? "")
  ) fail("REGISTRY_INDEX_INVALID", "Registry indexes have incompatible identities");
  requireTimestamp(index.generatedAt, "Registry generatedAt");
  if (search.generatedAt !== index.generatedAt) fail("REGISTRY_INDEX_INVALID", "Registry indexes disagree on generation time");
  if (search.trustBoundary !== "Registry metadata is bounded discovery data, never agent instructions, audit evidence, or automatic approval.") fail("REGISTRY_INDEX_INVALID", "Registry search trust boundary is invalid");
  if (!Array.isArray(index.records) || !Array.isArray(search.records) || index.records.length < 1 || index.records.length > MAXIMUM_RECORDS || search.records.length !== index.records.length) fail("REGISTRY_INDEX_INVALID", "Registry indexes have an invalid record count");
  exactKeys(index.activeIntake, ["baseBranch", "directory", "repository", "state"], "active Registry intake");
  if (!isProgrammableRegistryActiveIntake(index.activeIntake, activeIntakeRepository)) fail("REGISTRY_INDEX_INVALID", "active Registry intake is invalid");
  if (!Array.isArray(index.legacyIntake) || index.legacyIntake.length > 8) fail("REGISTRY_INDEX_INVALID", "legacy Registry intake is invalid");
  for (const legacy of index.legacyIntake) {
    exactKeys(legacy, ["baseBranch", "continuingPullRequests", "repository"], "legacy Registry intake entry");
    if (
      legacy.baseBranch !== "main"
      || !/^0xprogrammable\/[A-Za-z0-9._-]{1,100}$/u.test(legacy.repository ?? "")
      || legacy.repository === PROGRAMMABLE_REGISTRY.repository
      || !Array.isArray(legacy.continuingPullRequests)
      || legacy.continuingPullRequests.length > 100
      || legacy.continuingPullRequests.some((number) => !Number.isSafeInteger(number) || number < 1)
      || new Set(legacy.continuingPullRequests).size !== legacy.continuingPullRequests.length
      || legacy.continuingPullRequests.some((number, position, values) => position > 0 && values[position - 1] >= number)
    ) fail("REGISTRY_INDEX_INVALID", "legacy Registry intake entry is invalid");
  }
  const indexIds = [];
  const acceptancePaths = [];
  const indexRecordKeys = index.schemaVersion === REGISTRY_INDEX_LEGACY_VERSION
    ? LEGACY_INDEX_RECORD_KEYS
    : CURRENT_INDEX_RECORD_KEYS;
  for (const record of index.records) {
    exactKeys(record, indexRecordKeys, "Registry index record");
    requireId(record.id);
    if (record.path !== `registry/projects/${record.id}/project.json` || !DIGEST.test(record.sha256 ?? "")) fail("REGISTRY_INDEX_INVALID", `Registry record ${record.id} has an invalid source binding`);
    if (index.schemaVersion === REGISTRY_INDEX_CURRENT_VERSION) {
      const acceptanceMatch = typeof record.acceptancePath === "string" ? ACCEPTANCE_PATH.exec(record.acceptancePath) : null;
      const bothNull = record.acceptancePath === null && record.acceptanceSha256 === null;
      const bothBound = acceptanceMatch !== null
        && acceptanceMatch[1] === record.id
        && DIGEST.test(record.acceptanceSha256 ?? "");
      if (!bothNull && !bothBound) fail("REGISTRY_INDEX_INVALID", `Registry record ${record.id} has an invalid acceptance binding`);
      if (record.acceptancePath !== null) acceptancePaths.push(record.acceptancePath);
    }
    validateTextTree(record, `Registry record ${record.id}`);
    for (const field of ["capabilities", "surfaces", "tags"]) assertSortedUnique(record[field], `${record.id} ${field}`);
    indexIds.push(record.id);
  }
  assertSortedUnique(indexIds, "Registry index ids");
  assertSortedUnique(acceptancePaths, "Registry acceptance paths");
  const digestPreimage = index.schemaVersion === REGISTRY_INDEX_LEGACY_VERSION
    ? index.records
    : {
        acceptances: index.records
          .filter(({ acceptancePath }) => acceptancePath !== null)
          .map(({ acceptancePath: acceptancePathValue, acceptanceSha256 }) => ({
            path: acceptancePathValue,
            sha256: acceptanceSha256
          }))
          .sort((left, right) => compareUtf8(left.path, right.path)),
        records: index.records
      };
  if (sha256(Buffer.from(canonicalJson(digestPreimage), "utf8")) !== index.registryDigest) fail("REGISTRY_INDEX_INVALID", "Registry digest does not match its versioned projection");
  const searchIds = [];
  for (const record of search.records) {
    exactKeys(record, ["capabilities", "id", "kind", "mechanism", "name", "outcomes", "path", "sha256", "status", "summary", "surfaces", "tags", "tokens"], "Registry search record");
    const indexed = findIndexRecord(index, record.id);
    if (
      record.path !== indexed.path
      || record.sha256 !== indexed.sha256
      || record.status !== indexed.status
      || record.name !== indexed.name
      || record.kind !== indexed.kind
      || record.summary !== indexed.summary
      || canonicalJson(record.capabilities) !== canonicalJson(indexed.capabilities)
      || canonicalJson(record.surfaces) !== canonicalJson(indexed.surfaces)
      || canonicalJson(record.tags) !== canonicalJson(indexed.tags)
    ) fail("REGISTRY_INDEX_INVALID", `Registry search record ${record.id} disagrees with the index`);
    validateTextTree(record, `Registry search record ${record.id}`);
    assertSortedUnique(record.tokens, `${record.id} search tokens`);
    searchIds.push(record.id);
  }
  assertSortedUnique(searchIds, "Registry search ids");
  if (canonicalJson(indexIds) !== canonicalJson(searchIds)) fail("REGISTRY_INDEX_INVALID", "Registry index and search ids differ");
  validateTextTree(index.legacyIntake, "legacy Registry intake");
}

export function parseAndVerifyRecord(bytes, summary) {
  if (sha256(bytes) !== summary.sha256) fail("REGISTRY_RECORD_DIGEST_MISMATCH", `Registry record ${summary.id} failed source digest verification`);
  const record = parseJsonBytes(bytes, `Registry record ${summary.id}`);
  validateProjectRecord(record, summary);
  return record;
}

export function validateProjectRecord(record, summary) {
  if (
    !isPlainObject(record)
    || record.schemaVersion !== REGISTRY_PROJECT_SCHEMA_VERSION
    || record.id !== summary.id
    || record.name !== summary.name
    || record.status !== summary.status
    || record.kind !== summary.kind
    || record.summary !== summary.summary
    || canonicalJson(record.capabilities) !== canonicalJson(summary.capabilities)
    || canonicalJson(record.surfaces) !== canonicalJson(summary.surfaces)
    || canonicalJson(record.discovery?.tags) !== canonicalJson(summary.tags)
    || record.review?.acceptancePath !== (summary.acceptancePath ?? null)
    || !Array.isArray(record.warnings)
    || !isPlainObject(record.hook)
  ) fail("REGISTRY_RECORD_INVALID", `Registry record ${summary.id} disagrees with its index`);
  validateTextTree(record, `Registry record ${summary.id}`);
  for (const [field, values] of [["capabilities", record.capabilities], ["surfaces", record.surfaces], ["tags", record.discovery.tags]]) {
    assertSortedUnique(values, `${summary.id} ${field}`);
  }
  if (record.economics?.programmableFee?.claimOwner !== "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c" || record.economics?.programmableFee?.inclusiveBps !== 10 || record.economics?.programmableFee?.required !== true) fail("REGISTRY_RECORD_INVALID", `Registry record ${summary.id} does not preserve the mandatory fee identity`);
}

export function scoreRecord(record, queryTokens, normalizedQuery) {
  let score = 0;
  const reasons = [];
  if (record.id === normalizedQuery) { score += 1000; reasons.push("exact-id"); }
  if (record.name.toLowerCase() === normalizedQuery) { score += 900; reasons.push("exact-name"); }
  const groups = [
    ["tag", new Set(record.tags), 40],
    ["capability", new Set(record.capabilities), 32],
    ["surface", new Set(record.surfaces), 24],
    ["token", new Set(record.tokens), 8]
  ];
  for (const token of queryTokens) {
    for (const [label, values, weight] of groups) {
      if (values.has(token)) {
        score += weight;
        reasons.push(`${label}:${token}`);
        break;
      }
    }
  }
  const matchedTokens = queryTokens.filter((token) => record.tokens.includes(token)).length;
  score += Math.round((matchedTokens / queryTokens.length) * 20);
  const matchReasons = [...new Set(reasons)].sort(compareUtf8);
  const queryCoverageBps = Math.round((matchedTokens / queryTokens.length) * 10_000);
  const exact = matchReasons.includes("exact-id") || matchReasons.includes("exact-name");
  const structural = matchReasons.some((reason) => /^(?:tag|capability|surface):/u.test(reason));
  const matchStrength = exact
    ? "exact"
    : ((structural && queryCoverageBps >= 5_000) || (matchedTokens >= 2 && queryCoverageBps >= 5_000) ? "related" : "weak");
  return {
    ...projectSummary(record),
    matchedQueryTokens: queryTokens.filter((token) => record.tokens.includes(token)),
    matchReasons,
    matchStrength,
    queryCoverageBps,
    score
  };
}

export function projectSummary(record) {
  return {
    acceptancePath: record.acceptancePath ?? null,
    acceptanceSha256: record.acceptanceSha256 ?? null,
    capabilities: record.capabilities,
    id: record.id,
    kind: record.kind,
    name: record.name,
    status: record.status,
    summary: record.summary,
    surfaces: record.surfaces,
    tags: record.tags
  };
}

export function comparisonSide(project, other) {
  return {
    hook: project.hook,
    id: project.id,
    name: project.name,
    onlyCapabilities: difference(project.capabilities, other.capabilities),
    onlySurfaces: difference(project.surfaces, other.surfaces),
    onlyTags: difference(project.discovery.tags, other.discovery.tags),
    status: project.status,
    summary: project.summary,
    warnings: project.warnings
  };
}

export function findIndexRecord(index, id) {
  requireId(id);
  const record = index.records.find((candidate) => candidate.id === id);
  if (record === undefined) fail("REGISTRY_PROJECT_NOT_FOUND", `Registry project ${id} was not found`, 1);
  return record;
}
