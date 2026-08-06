const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const commitPattern = /^[a-f0-9]{40}$/i;
const sha256Pattern = /^[a-f0-9]{64}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const requiredSourceIds = new Set([
  "uniswap-deployments-feed",
  "cca-repository-readme",
  "liquidity-launcher-repository-readme",
  "uerc20-factory-repository-readme",
  "cca-repository-changelog",
  "cca-v2.1-factory-source",
  "liquidity-launcher-v3.0-source",
  "lbp-strategy-v3.1-source",
  "uerc20-factory-v2.0-source",
  "usuperc20-factory-v2.0-source",
  "liquidity-launchpad-docs-overview",
  "liquidity-launchpad-docs-deployments",
  "v4-docs-deployments",
  "universal-router-mainnet-deployments",
  "universal-router-base-deployments",
  "universal-router-unichain-deployments",
  "universal-router-sepolia-deployments"
]);

const requiredComponentReleases = new Map([
  ["ContinuousClearingAuctionFactory", {
    version: "v2.1.0",
    commit: "7d7602d257733315434570f2a0c2f94f1c7b207a"
  }],
  ["LiquidityLauncher", {
    version: "v3.0.0",
    commit: "3a3103543f50a13a0ae52a253bb98a925d72146f"
  }],
  ["LBPStrategy", {
    version: "v3.1.0",
    commit: "873cbb23c5019a795193c5ad561edff2f78ba5a3"
  }],
  ["UERC20Factory", {
    version: "v2.0.0",
    commit: "de5bacd215f6aae50e524297c18fcf78b69b6312"
  }],
  ["USUPERC20Factory", {
    version: "v2.0.0",
    commit: "de5bacd215f6aae50e524297c18fcf78b69b6312"
  }]
]);

const conflictedUniversalRouterRecordIds = new Set([
  "universal-router-universalrouter-ethereum",
  "universal-router-universalrouter-unichain",
  "universal-router-universalrouter-sepolia"
]);

const requiredProfiles = new Map([
  ["official-cca-lbp-new-token-ethereum", { chain: "Ethereum", chainId: 1 }],
  ["official-cca-lbp-new-token-base", { chain: "Base", chainId: 8453 }],
  ["official-cca-lbp-new-token-unichain", { chain: "Unichain", chainId: 130 }],
  ["official-cca-lbp-new-token-sepolia", { chain: "Sepolia", chainId: 11155111 }]
]);

const requiredProfileSlots = [
  "tokenFactory",
  "auctionFactory",
  "liquidityLauncher",
  "liquidityStrategy",
  "poolManager",
  "positionManager",
  "universalRouter",
  "permit2"
];

const expectedProfileContracts = {
  tokenFactory: new Set(["UERC20Factory", "USUPERC20Factory"]),
  auctionFactory: new Set(["ContinuousClearingAuctionFactory"]),
  liquidityLauncher: new Set(["LiquidityLauncher"]),
  liquidityStrategy: new Set(["LBPStrategy"]),
  poolManager: new Set(["PoolManager"]),
  positionManager: new Set(["PositionManager"]),
  universalRouter: new Set(["UniversalRouter"]),
  permit2: new Set(["Permit2"])
};

export const staleCcaV11Address = "0xCCccCcCAE7503Cac057829BF2811De42E16e0bD5";

export class OfficialLaunchpadReferenceError extends Error {}

export function validateOfficialLaunchpadReference(reference) {
  assertObject(reference, "reference");
  if (reference.schemaVersion !== 1) fail("reference.schemaVersion must be 1");
  if (reference.referenceKind !== "official-uniswap-launchpad-deployment-reference") {
    fail("reference.referenceKind is unsupported");
  }
  if (!datePattern.test(reference.snapshotDate ?? "")) {
    fail("reference.snapshotDate must use YYYY-MM-DD");
  }
  validateAuthorityPolicy(reference.authorityPolicy);

  if (!Array.isArray(reference.sources)) fail("reference.sources must be an array");
  const sourcesById = new Map();
  for (const [index, source] of reference.sources.entries()) {
    validateSource(source, `reference.sources[${index}]`);
    if (sourcesById.has(source.id)) fail(`duplicate source id ${source.id}`);
    sourcesById.set(source.id, source);
  }
  for (const sourceId of requiredSourceIds) {
    if (!sourcesById.has(sourceId)) fail(`missing required official source ${sourceId}`);
  }

  validateDocumentedConflicts(reference.documentedConflicts, sourcesById);
  validateForbiddenDefaults(reference.forbiddenDefaults);

  if (!Array.isArray(reference.records) || reference.records.length === 0) {
    fail("reference.records must be a non-empty array");
  }
  const recordsById = new Map();
  const componentVersions = new Map();
  for (const [index, record] of reference.records.entries()) {
    validateRecord(record, `reference.records[${index}]`, sourcesById);
    if (recordsById.has(record.id)) fail(`duplicate deployment record id ${record.id}`);
    if (record.address.toLowerCase() === staleCcaV11Address.toLowerCase()) {
      fail(`stale CCA v1.1 address is forbidden in active record ${record.id}`);
    }
    recordsById.set(record.id, record);
    if (!componentVersions.has(record.contract)) componentVersions.set(record.contract, new Set());
    componentVersions.get(record.contract).add(record.version);
  }
  for (const [contract, release] of requiredComponentReleases) {
    if (!componentVersions.get(contract)?.has(release.version)) {
      fail(`missing required ${contract} ${release.version} deployment record`);
    }
  }
  for (const contract of ["PoolManager", "PositionManager", "UniversalRouter", "Permit2"]) {
    if (!componentVersions.has(contract)) fail(`missing required ${contract} deployment record`);
  }

  if (!Array.isArray(reference.profiles) || reference.profiles.length === 0) {
    fail("reference.profiles must be a non-empty array");
  }
  const profilesById = new Map();
  for (const [index, profile] of reference.profiles.entries()) {
    validateProfile(profile, `reference.profiles[${index}]`, recordsById);
    if (profilesById.has(profile.id)) fail(`duplicate launch profile id ${profile.id}`);
    profilesById.set(profile.id, profile);
  }
  for (const [profileId, expected] of requiredProfiles) {
    const profile = profilesById.get(profileId);
    if (!profile) fail(`missing required launch profile ${profileId}`);
    if (profile.chain !== expected.chain || profile.chainId !== expected.chainId) {
      fail(`${profileId} must target ${expected.chain} (${expected.chainId})`);
    }
  }

  return { sourcesById, recordsById, profilesById };
}

export function resolveOfficialLaunchProfile(reference, profileId, options = {}) {
  const validated = validateOfficialLaunchpadReference(reference);
  assertObject(options, "options");
  if (Object.keys(options).length > 0) {
    fail("prompt-supplied deployment addresses are forbidden; select a committed profile id");
  }
  if (typeof profileId !== "string" || profileId.length === 0) fail("profileId must be a non-empty string");
  const profile = validated.profilesById.get(profileId);
  if (!profile) fail(`unknown official launch profile ${profileId}`);

  const records = {};
  for (const slot of requiredProfileSlots) {
    const record = validated.recordsById.get(profile.records[slot]);
    records[slot] = Object.freeze({
      ...record,
      authoritySourceIds: Object.freeze([...record.authoritySourceIds])
    });
  }
  const hasSourceConflict = Object.values(records)
    .some((record) => record.sourceResolutionStatus === "official-feed-ref-conflicted");
  return Object.freeze({
    id: profile.id,
    chain: profile.chain,
    chainId: profile.chainId,
    status: profile.status,
    sourceConflictStatus: hasSourceConflict ? "blocked-official-source-conflict" : "no-recorded-source-conflict",
    runtimeVerificationStatus: "unverified",
    executionStatus: hasSourceConflict
      ? "blocked-official-source-conflict"
      : "blocked-pending-runtime-and-interface-verification",
    records: Object.freeze(records)
  });
}

export function compareOfficialDeploymentRecords(reference, observedRecords) {
  const { recordsById } = validateOfficialLaunchpadReference(reference);
  if (!Array.isArray(observedRecords)) fail("observed deployment records must be an array");
  const observedById = new Map();
  for (const [index, observed] of observedRecords.entries()) {
    assertObject(observed, `observedRecords[${index}]`);
    if (typeof observed.id !== "string" || observed.id.length === 0) {
      fail(`observedRecords[${index}].id must be a non-empty string`);
    }
    if (observedById.has(observed.id)) fail(`duplicate observed deployment record ${observed.id}`);
    observedById.set(observed.id, observed);
  }

  const fields = [
    "protocol",
    "contract",
    "chain",
    "chainId",
    "address",
    "tier",
    "sourceRepo",
    "sourceRef",
    "sourceCodeUrl",
    "env",
    "status"
  ];
  const findings = [];
  for (const record of recordsById.values()) {
    const observed = observedById.get(record.feedRecordId);
    if (!observed) {
      findings.push({
        code: "official-deployment-record-missing",
        recordId: record.id,
        expected: "present",
        actual: "missing"
      });
      continue;
    }
    for (const field of fields) {
      if (record[field] === observed[field]) continue;
      findings.push({
        code: `official-deployment-${toKebabCase(field)}-drift`,
        recordId: record.id,
        field,
        expected: record[field],
        actual: observed[field] ?? null
      });
    }
  }
  findings.sort((left, right) => left.recordId.localeCompare(right.recordId)
    || left.code.localeCompare(right.code)
    || (left.field ?? "").localeCompare(right.field ?? ""));
  return findings;
}

function validateAuthorityPolicy(policy) {
  assertObject(policy, "reference.authorityPolicy");
  const expected = {
    promptSuppliedAddresses: "reject",
    recordSelection: "committed-id-only",
    unknownChainOrComponent: "block",
    driftDecision: "block",
    offlineVerification: "committed-reference-only",
    runtimeVerification: "required-before-execution",
    sourceVerification: "required-before-release-claim"
  };
  for (const [key, value] of Object.entries(expected)) {
    if (policy[key] !== value) fail(`reference.authorityPolicy.${key} must be ${value}`);
  }
}

function validateSource(source, location) {
  assertObject(source, location);
  nonEmptyString(source.id, `${location}.id`);
  const kinds = new Set(["official-deployment-feed", "official-repository", "official-documentation"]);
  if (!kinds.has(source.authorityKind)) fail(`${location}.authorityKind is unsupported`);

  if (source.authorityKind === "official-deployment-feed") {
    if (source.url !== "https://developers.uniswap.org/deployments.json") {
      fail(`${location}.url must be the official Uniswap deployments feed`);
    }
    exactDigest(source.contentSha256, sha256Pattern, `${location}.contentSha256`, "SHA-256 digest");
    nonEmptyString(source.generatedAt, `${location}.generatedAt`);
    assertObject(source.source, `${location}.source`);
    validateOfficialRepository(source.source.repository, `${location}.source.repository`);
    exactDigest(source.source.commit, commitPattern, `${location}.source.commit`, "Git commit");
    return;
  }

  validateOfficialRepository(source.repository, `${location}.repository`);
  exactDigest(source.commit, commitPattern, `${location}.commit`, "Git commit");
  validateRelativePath(source.path, `${location}.path`);
  exactDigest(source.contentSha256, sha256Pattern, `${location}.contentSha256`, "SHA-256 digest");
  const repositoryName = new URL(source.repository).pathname.replace(/\.git$/i, "").split("/").filter(Boolean)[1];
  const expectedUrl = `https://raw.githubusercontent.com/Uniswap/${repositoryName}/${source.commit}/${source.path}`;
  if (source.immutableUrl !== expectedUrl) fail(`${location}.immutableUrl does not match its repository, commit and path`);
}

function validateForbiddenDefaults(forbiddenDefaults) {
  if (!Array.isArray(forbiddenDefaults) || forbiddenDefaults.length === 0) {
    fail("reference.forbiddenDefaults must be a non-empty array");
  }
  const stale = forbiddenDefaults.find((entry) => entry?.address?.toLowerCase?.() === staleCcaV11Address.toLowerCase());
  if (!stale) fail("reference.forbiddenDefaults must reject the CCA v1.1 deployment");
  if (stale.contract !== "ContinuousClearingAuctionFactory" || stale.version !== "v1.1.0") {
    fail("the stale CCA default must identify ContinuousClearingAuctionFactory v1.1.0");
  }
  if (stale.replacementContract !== "ContinuousClearingAuctionFactory" || stale.replacementVersion !== "v2.1.0") {
    fail("the stale CCA default must point to ContinuousClearingAuctionFactory v2.1.0");
  }
  if (stale.releaseCommit !== "8508f332c3daf330b189290b335fd9da4e95f3f0") {
    fail("the stale CCA default must retain its pinned v1.1 deployment commit");
  }
  if (stale.replacementAddress !== "0x000000001F26a0044BaA66024e7b6599c61963F8") {
    fail("the stale CCA default must point to the pinned v2.1 deployment address");
  }
  if (stale.decision !== "reject") fail("the stale CCA default decision must be reject");
}

function validateDocumentedConflicts(conflicts, sourcesById) {
  if (!Array.isArray(conflicts)) fail("reference.documentedConflicts must be an array");
  const byId = new Map();
  for (const [index, conflict] of conflicts.entries()) {
    const location = `reference.documentedConflicts[${index}]`;
    assertObject(conflict, location);
    nonEmptyString(conflict.id, `${location}.id`);
    if (byId.has(conflict.id)) fail(`duplicate documented conflict ${conflict.id}`);
    for (const key of ["sourceId", "documentationSourceId"]) {
      if (!Object.hasOwn(conflict, key)) continue;
      if (!sourcesById.has(conflict[key])) fail(`${location}.${key} references unknown source ${conflict[key]}`);
    }
    for (const sourceId of conflict.preferredEvidence ?? []) {
      if (!sourcesById.has(sourceId)) fail(`${location}.preferredEvidence references unknown source ${sourceId}`);
    }
    for (const [comparisonIndex, comparison] of (conflict.comparisons ?? []).entries()) {
      if (!sourcesById.has(comparison.repositorySourceId)) {
        fail(`${location}.comparisons[${comparisonIndex}].repositorySourceId references an unknown source`);
      }
    }
    byId.set(conflict.id, conflict);
  }
  for (const requiredId of [
    "cca-readme-changelog-latest-label-disagreement",
    "launchpad-docs-behind-feed-and-release-readmes",
    "universal-router-generic-record-disagreement"
  ]) {
    if (!byId.has(requiredId)) fail(`missing documented official-source conflict ${requiredId}`);
  }
}

function validateRecord(record, location, sourcesById) {
  assertObject(record, location);
  for (const field of ["id", "feedRecordId", "protocol", "contract", "version", "chain", "tier", "sourceRepo", "sourceRef", "sourceCodeUrl", "env", "status", "sourceResolutionStatus", "runtimeVerification"]) {
    nonEmptyString(record[field], `${location}.${field}`);
  }
  if (record.id !== record.feedRecordId) fail(`${location}.feedRecordId must equal its official feed record id`);
  if (!Number.isSafeInteger(record.chainId) || record.chainId <= 0) fail(`${location}.chainId must be a positive integer`);
  if (!addressPattern.test(record.address ?? "")) fail(`${location}.address must be an exact EVM address`);
  if (record.status !== "active") fail(`${location}.status must be active`);
  if (!new Set(["mainnet", "testnet"]).has(record.env)) fail(`${location}.env is unsupported`);
  if (!new Set(["labs-launched", "labs-supported"]).has(record.tier)) fail(`${location}.tier is unsupported`);
  validateOfficialRepository(record.sourceRepo, `${location}.sourceRepo`);
  validateOfficialCodeUrl(record.sourceCodeUrl, `${location}.sourceCodeUrl`);
  if (record.runtimeVerification !== "required-before-execution") {
    fail(`${location}.runtimeVerification must be required-before-execution`);
  }
  if (!Array.isArray(record.authoritySourceIds) || !record.authoritySourceIds.includes("uniswap-deployments-feed")) {
    fail(`${location}.authoritySourceIds must include uniswap-deployments-feed`);
  }
  for (const sourceId of record.authoritySourceIds) {
    if (!sourcesById.has(sourceId)) fail(`${location}.authoritySourceIds contains unknown source ${sourceId}`);
  }

  const expectedRelease = requiredComponentReleases.get(record.contract);
  if (expectedRelease && record.version !== expectedRelease.version) {
    fail(`${location}.version must be ${expectedRelease.version} for ${record.contract}`);
  }
  if (expectedRelease) {
    exactDigest(record.releaseCommit, commitPattern, `${location}.releaseCommit`, "Git commit");
    if (record.releaseCommit.toLowerCase() !== expectedRelease.commit) {
      fail(`${location}.releaseCommit must be the pinned ${record.contract} ${expectedRelease.version} deployment commit`);
    }
    validateOfficialCodeUrl(record.immutableSourceCodeUrl, `${location}.immutableSourceCodeUrl`);
    if (!new URL(record.immutableSourceCodeUrl).pathname.includes(`/${record.releaseCommit}/`)) {
      fail(`${location}.immutableSourceCodeUrl must contain its exact releaseCommit`);
    }
    if (record.sourceResolutionStatus !== "release-commit-pinned") {
      fail(`${location}.sourceResolutionStatus must be release-commit-pinned`);
    }
  } else {
    if (record.releaseCommit !== null) fail(`${location}.releaseCommit must be null until the feed ref is resolved`);
    if (record.immutableSourceCodeUrl !== null) {
      fail(`${location}.immutableSourceCodeUrl must be null until the feed ref is resolved`);
    }
    const expectedResolution = conflictedUniversalRouterRecordIds.has(record.id)
      ? "official-feed-ref-conflicted"
      : "official-feed-ref-unresolved";
    if (record.sourceResolutionStatus !== expectedResolution) {
      fail(`${location}.sourceResolutionStatus must be ${expectedResolution}`);
    }
  }
}

function validateProfile(profile, location, recordsById) {
  assertObject(profile, location);
  nonEmptyString(profile.id, `${location}.id`);
  nonEmptyString(profile.chain, `${location}.chain`);
  if (!Number.isSafeInteger(profile.chainId) || profile.chainId <= 0) fail(`${location}.chainId must be a positive integer`);
  assertObject(profile.records, `${location}.records`);
  const keys = Object.keys(profile.records).sort();
  if (keys.length !== requiredProfileSlots.length || keys.some((key, index) => key !== [...requiredProfileSlots].sort()[index])) {
    fail(`${location}.records must contain exactly ${requiredProfileSlots.join(", ")}`);
  }
  let hasSourceConflict = false;
  for (const slot of requiredProfileSlots) {
    const recordId = profile.records[slot];
    nonEmptyString(recordId, `${location}.records.${slot}`);
    const record = recordsById.get(recordId);
    if (!record) fail(`${location}.records.${slot} references unknown record ${recordId}`);
    if (record.chainId !== profile.chainId || record.chain !== profile.chain) {
      fail(`${location}.records.${slot} is not on ${profile.chain} (${profile.chainId})`);
    }
    if (!expectedProfileContracts[slot].has(record.contract)) {
      fail(`${location}.records.${slot} references ${record.contract}, not ${[...expectedProfileContracts[slot]].join(" or ")}`);
    }
    if (record.sourceResolutionStatus === "official-feed-ref-conflicted") hasSourceConflict = true;
  }
  const expectedStatus = hasSourceConflict
    ? "reference-conflicted-runtime-unverified"
    : "reference-ready-runtime-unverified";
  if (profile.status !== expectedStatus) {
    fail(`${location}.status must be ${expectedStatus}`);
  }
}

function validateOfficialRepository(value, location) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${location} must be an official Uniswap GitHub repository URL`);
  }
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash
    || parts.length !== 2 || parts[0] !== "Uniswap") {
    fail(`${location} must be an official Uniswap GitHub repository URL`);
  }
}

function validateOfficialCodeUrl(value, location) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${location} must be an official Uniswap GitHub source URL`);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash
    || parts.length < 5 || parts[0] !== "Uniswap" || parts[2] !== "blob") {
    fail(`${location} must be an official Uniswap GitHub source URL`);
  }
}

function validateRelativePath(value, location) {
  nonEmptyString(value, location);
  if (value.startsWith("/") || value.includes("\\") || value.split("/").includes("..")) {
    fail(`${location} must be a safe repository-relative path`);
  }
}

function exactDigest(value, pattern, location, label) {
  if (typeof value !== "string" || !pattern.test(value)) fail(`${location} must be an exact ${label}`);
}

function nonEmptyString(value, location) {
  if (typeof value !== "string" || value.length === 0) fail(`${location} must be a non-empty string`);
}

function assertObject(value, location) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${location} must be an object`);
}

function toKebabCase(value) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

function fail(message) {
  throw new OfficialLaunchpadReferenceError(message);
}
