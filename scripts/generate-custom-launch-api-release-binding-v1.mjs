#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  deriveCustomLaunchApiFlyReleaseIdentity,
} from "./verify-custom-launch-api-fly-release.mjs";
import {
  parseDeterministicCustomLaunchApiReleaseBindingV1,
} from "./verify-custom-launch-api-release-binding-v1.mjs";

const execFile = promisify(execFileCallback);
const MAXIMUM_INPUT_BYTES = 4 * 1024 * 1024;
const BINDING_PATH =
  "services/custom-launch-api-v1/release/public-v3-release-binding-v1.json";
const SERVICE_PATH = "services/custom-launch-api-v1";
const PROFILE_PATH =
  `${SERVICE_PATH}/release/direct-native-hook-graph-admission-profile.v3.json`;
const API_CONTRACT_PATH = `${SERVICE_PATH}/release/custom-launch-api-contract.v3.json`;
const PUBLIC_OPENAPI_PATH = "public/openapi/custom-launch-v3.json";
const LAUNCH_PACKAGE_MANIFEST_PATH = "packages/launch/package.json";
const PUBLIC_PROFILE_SCHEMA_VERSION =
  "programmable.direct-native-hook-graph-admission-profile.v3";
const PUBLIC_PROFILE_ID = "programmable.direct-native-hook-graph.v1";
const PUBLIC_PROFILE_VERSION = "3.3.0";
const LAUNCH_PACKAGE_VERSION = "3.3.6";
const PLATFORM_ADMISSION_POLICY = Object.freeze({
  schemaVersion: "programmable.direct-native-platform-admission-policy.v1",
  mode: "deterministic-exact-source-graph-static-baseline-v1",
  receiptSchemaVersion: "programmable.platform-admission-receipt.v1",
  engineId: "programmable.direct-native-static-admission",
  engineVersion: "1.0.0",
  exactSourceCompilerGraphBindingRequired: true,
  staticBaselineGateVersion: "1.0.0",
  blockingFindingRules: Object.freeze([
    Object.freeze({
      code: "RUNTIME_CALLCODE",
      targetRoles: Object.freeze(["any"]),
    }),
    Object.freeze({
      code: "RUNTIME_SELFDESTRUCT",
      targetRoles: Object.freeze(["any"]),
    }),
    Object.freeze({
      code: "SOURCE_SELFDESTRUCT_SURFACE",
      targetRoles: Object.freeze(["any"]),
    }),
    Object.freeze({
      code: "V4_CALLBACK_AUTHENTICATION_MISSING",
      targetRoles: Object.freeze(["hook"]),
    }),
    Object.freeze({
      code: "V4_CALLBACK_AUTHENTICATION_INVALID",
      targetRoles: Object.freeze(["hook"]),
    }),
    Object.freeze({
      code: "V4_CALLBACK_POOL_MANAGER_MISMATCH",
      targetRoles: Object.freeze(["hook"]),
    }),
    Object.freeze({
      code: "V4_ENABLED_CALLBACK_IMPLEMENTATION_MISSING",
      targetRoles: Object.freeze(["hook"]),
    }),
  ]),
  warningDisposition: "bound-and-visible",
  noBlockingFindingDisposition: "router-simulation-eligible",
  blockingFindingDisposition: "action-required",
  routerSimulationRequiredBeforeAuthorization: true,
  receiptAuthority: "platform-only",
  assurance: "launch-admission-only",
  safetyClaim: false,
  feeBehaviorClaim: false,
});
const EXPECTED_MIGRATIONS = Object.freeze([
  "0001_custom_launch_api_private_schema_v1.sql",
  "0002_reserve_custom_launch_permit_nonce.sql",
  "0003_harden_custom_launch_api_limits_v1.sql",
  "0004_exact_source_verification_v1.sql",
  "0005_fee_enforced_launch_profile_v2.sql",
  "0006_public_launch_profile_rev3.sql",
  "0007_direct_native_hook_profile_v3.sql",
  "0008_direct_native_platform_admission_v3.sql",
  "0009_admit_eip3009_authorization_patch_v2.sql",
  "0010_durable_launch_lifecycle_queue_v3.sql",
  "0011_custom_launch_project_metadata_v3.sql",
  "0012_custom_launch_api_reliability_v1.sql",
]);
const EXPECTED_SUPABASE_MIGRATIONS = Object.freeze([
  "20260824110842_programmable_custom_launch_api_private_schema_v1.sql",
  "20260824112627_reserve_custom_launch_permit_nonce.sql",
  "20260824121433_harden_custom_launch_api_limits_v1.sql",
  "20260825053733_exact_source_verification_v1.sql",
  "20260825123910_fee_enforced_launch_profile_v2.sql",
  "20260825203306_public_launch_profile_rev3.sql",
  "20260826000538_direct_native_hook_profile_v3.sql",
  "20260826045034_direct_native_platform_admission_v3.sql",
  "20260826105310_admit_eip3009_authorization_patch_v2.sql",
  "20260826135927_durable_launch_lifecycle_queue_v3.sql",
  "20260826175335_custom_launch_project_metadata_v3.sql",
  "20260827074734_custom_launch_api_reliability_v1.sql",
]);
const EXPECTED_API_ROUTES = Object.freeze([
  Object.freeze({ method: "GET", path: "/v3/capabilities" }),
  Object.freeze({ method: "GET", path: "/v3/custom-launches" }),
  Object.freeze({ method: "GET", path: "/v3/custom-launches/{id}" }),
  Object.freeze({ method: "GET", path: "/v3/finalized-custom-launches" }),
  Object.freeze({ method: "GET", path: "/v3/wallet-admin/custom-launches" }),
  Object.freeze({ method: "GET", path: "/v3/wallet-admin/custom-launches/{id}" }),
  Object.freeze({ method: "POST", path: "/v3/custom-launches" }),
  Object.freeze({ method: "POST", path: "/v3/custom-launches/preflight" }),
  Object.freeze({
    method: "POST",
    path: "/v3/wallet-admin/custom-launches/{id}/funding-authorization",
  }),
]);
const READINESS_KEYS = Object.freeze([
  "schemaVersion",
  "status",
  "service",
  "sourceCommit",
  "sourceTree",
  "migrationInventorySha256",
  "apiContractSha256",
  "walletAdminSecurity",
  "publicProfile",
  "chain",
]);
const WALLET_ADMIN_SECURITY_KEYS = Object.freeze([
  "assertionVersion",
  "assertionMode",
  "legacyBearerRequestsAccepted",
]);
const PUBLIC_PROFILE_KEYS = Object.freeze([
  "profileId",
  "profileVersion",
  "profileSha256",
  "productionLaunchAuthorized",
]);
const CHAIN_KEYS = Object.freeze([
  "chainId",
  "router",
  "routerRuntimeCodeHash",
  "graphFactory",
  "graphFactoryRuntimeCodeHash",
  "poolManager",
  "poolManagerRuntimeCodeHash",
  "permitAuthority",
  "permitAuthorityRuntimeCodeHash",
]);
const ADDRESS_KEYS = Object.freeze([
  "router",
  "graphFactory",
  "poolManager",
  "permitAuthority",
]);
const DEFAULT_WALLET_ADMIN_ASSERTION_MODE = "compatibility";
const WALLET_ADMIN_SECURITY_BY_ASSERTION_MODE = Object.freeze({
  compatibility: Object.freeze({
    assertionVersion: "2",
    assertionMode: "compatibility",
    legacyBearerRequestsAccepted: true,
  }),
  enforced: Object.freeze({
    assertionVersion: "2",
    assertionMode: "enforced",
    legacyBearerRequestsAccepted: false,
  }),
});
const COMMIT = /^(?!0{40}$)[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9A-Fa-f]{40}$/u;
const CODE_HASH = /^0x[0-9a-f]{64}$/u;
const SECRET_FIELD = /(?:authorization|cookie|password|private.?key|secret|token)/iu;
const PATH_ARGUMENTS = Object.freeze([
  "websiteRoot",
  "backendRoot",
  "flyReleases",
  "flyMachines",
  "flyImages",
  "apiReadiness",
  "supabaseMigrationList",
  "databaseSchemaEvidenceOutput",
]);
const OPTIONAL_ARGUMENTS = Object.freeze(["walletAdminAssertionMode"]);
const ARGUMENTS = Object.freeze([...PATH_ARGUMENTS, ...OPTIONAL_ARGUMENTS]);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalize(value) {
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("release JSON contains an unsupported value");
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function prettyJsonSha256(value) {
  return sha256(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

function exactKeys(value, keys) {
  return isObject(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function expectedWalletAdminSecurity(assertionModeInput) {
  const assertionMode = assertionModeInput ?? DEFAULT_WALLET_ADMIN_ASSERTION_MODE;
  if (typeof assertionMode !== "string"
    || !Object.hasOwn(WALLET_ADMIN_SECURITY_BY_ASSERTION_MODE, assertionMode)) {
    throw new Error("wallet-admin assertion mode is unsupported");
  }
  return WALLET_ADMIN_SECURITY_BY_ASSERTION_MODE[assertionMode];
}

async function readBoundedFile(path, label) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    throw new Error(`${label} is unavailable`);
  }
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAXIMUM_INPUT_BYTES) {
    throw new Error(`${label} is not one bounded regular file`);
  }
  return readFile(path);
}

async function readJson(path, label) {
  const bytes = await readBoundedFile(path, label);
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} is not UTF-8 JSON`);
  }
  return Object.freeze({ bytes, value });
}

function normalizeRemote(remote) {
  let value = remote.trim();
  if (value.startsWith("git@github.com:")) {
    value = `https://github.com/${value.slice("git@github.com:".length)}`;
  } else if (value.startsWith("ssh://git@github.com/")) {
    value = `https://github.com/${value.slice("ssh://git@github.com/".length)}`;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("repository origin is not a canonical GitHub remote");
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com"
    || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error("repository origin is not a canonical GitHub remote");
  }
  return url.pathname.replace(/^\//u, "").replace(/\.git$/u, "").toLowerCase();
}

async function git(root, args, label) {
  try {
    const result = await execFile("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.trim();
  } catch {
    throw new Error(`${label} Git identity is unavailable`);
  }
}

async function repositoryIdentity(rootInput, expectedRepository, label) {
  if (typeof rootInput !== "string" || !isAbsolute(rootInput)) {
    throw new Error(`${label} root must be absolute`);
  }
  let root;
  try {
    root = await realpath(rootInput);
  } catch {
    throw new Error(`${label} root is unavailable`);
  }
  const topLevel = await git(root, ["rev-parse", "--show-toplevel"], label);
  let canonicalTopLevel;
  try {
    canonicalTopLevel = await realpath(topLevel);
  } catch {
    throw new Error(`${label} repository root is unavailable`);
  }
  if (canonicalTopLevel !== root) throw new Error(`${label} root is not the repository root`);
  const [status, commitSha, treeSha, origin] = await Promise.all([
    git(root, ["status", "--porcelain=v1", "--untracked-files=all"], label),
    git(root, ["rev-parse", "--verify", "HEAD^{commit}"], label),
    git(root, ["rev-parse", "--verify", "HEAD^{tree}"], label),
    git(root, ["remote", "get-url", "origin"], label),
  ]);
  if (status !== "") throw new Error(`${label} repository is not clean`);
  if (!COMMIT.test(commitSha) || !COMMIT.test(treeSha)) {
    throw new Error(`${label} Git identity is invalid`);
  }
  if (normalizeRemote(origin) !== expectedRepository.toLowerCase()) {
    throw new Error(`${label} repository origin is unexpected`);
  }
  return Object.freeze({ root, commitSha, treeSha });
}

function assertNoSecretFields(value, label, depth = 0) {
  if (depth > 32) throw new Error(`${label} nesting is invalid`);
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretFields(item, label, depth + 1);
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) throw new Error(`${label} contains a prohibited secret field`);
    assertNoSecretFields(child, label, depth + 1);
  }
}

function validateChain(chain, profileChain) {
  if (!exactKeys(chain, CHAIN_KEYS) || chain.chainId !== "1") {
    throw new Error("API readiness chain identity is invalid");
  }
  for (const key of ADDRESS_KEYS) {
    if (!ADDRESS.test(chain[key] ?? "") || profileChain?.[key] !== chain[key]) {
      throw new Error("API readiness chain identity differs from the public profile");
    }
    const codeHashKey = `${key}RuntimeCodeHash`;
    if (!CODE_HASH.test(chain[codeHashKey] ?? "")
      || profileChain?.[codeHashKey] !== chain[codeHashKey]) {
      throw new Error("API readiness chain identity differs from the public profile");
    }
  }
}

async function migrationInventory(backendRoot) {
  const migrationRoot = join(backendRoot, SERVICE_PATH, "migrations");
  let entries;
  try {
    entries = await readdir(migrationRoot, { withFileTypes: true });
  } catch {
    throw new Error("backend migration inventory is unavailable");
  }
  const names = entries
    .filter((entry) => entry.name.endsWith(".sql"))
    .map((entry) => {
      if (!entry.isFile()) throw new Error("backend migration inventory contains a non-file");
      return entry.name;
    })
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  if (names.join("\0") !== EXPECTED_MIGRATIONS.join("\0")) {
    throw new Error("backend migration inventory is incomplete or contains an unknown migration");
  }
  return Object.freeze({
    schemaVersion: "programmable.custom-launch-api-migration-inventory.v1",
    migrations: Object.freeze(await Promise.all(names.map(async (name) => Object.freeze({
      path: `migrations/${name}`,
      sha256: sha256(await readBoundedFile(join(migrationRoot, name), "backend migration")),
    })))),
  });
}

function validateApiContract(contract) {
  if (!exactKeys(contract, [
    "schemaVersion", "requestSchemaVersion", "profileId", "profileVersion", "routes",
  ])
    || contract.schemaVersion !== "programmable.custom-launch-api-contract.v3"
    || contract.requestSchemaVersion !== "programmable.custom-launch-create-request.v3"
    || contract.profileId !== PUBLIC_PROFILE_ID
    || contract.profileVersion !== PUBLIC_PROFILE_VERSION
    || !Array.isArray(contract.routes)
    || contract.routes.length !== EXPECTED_API_ROUTES.length) {
    throw new Error("backend API contract is invalid");
  }
  contract.routes.forEach((route, index) => {
    if (!exactKeys(route, ["method", "path"])
      || route.method !== EXPECTED_API_ROUTES[index]?.method
      || route.path !== EXPECTED_API_ROUTES[index]?.path) {
      throw new Error("backend API route inventory is invalid");
    }
  });
}

function validateProfile(profile) {
  if (!isObject(profile)
    || profile.schemaVersion !== PUBLIC_PROFILE_SCHEMA_VERSION
    || profile.profileId !== PUBLIC_PROFILE_ID
    || profile.profileVersion !== PUBLIC_PROFILE_VERSION
    || profile.profileRevision !== 3
    || profile.productionLaunchAuthorized !== true
    || !isObject(profile.chain)
    || !isObject(profile.platformAdmissionPolicy)
    || Object.hasOwn(profile, "platformFeeProofPolicy")
    || canonicalize(profile.platformAdmissionPolicy)
      !== canonicalize(PLATFORM_ADMISSION_POLICY)) {
    throw new Error("backend public admission profile is invalid");
  }
}

function parseReleaseJson(bytes, label) {
  try {
    return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} is not UTF-8 JSON`);
  }
}

function validateWebsiteArtifacts(publicOpenApiBytes, launchPackageManifestBytes) {
  const openApi = parseReleaseJson(publicOpenApiBytes, "Website V3 OpenAPI");
  const launchPackage = parseReleaseJson(
    launchPackageManifestBytes,
    "launch package manifest",
  );
  if (openApi?.info?.version !== LAUNCH_PACKAGE_VERSION
    || openApi?.["x-programmable-profile"]?.profileId !== PUBLIC_PROFILE_ID
    || openApi?.["x-programmable-profile"]?.profileVersion !== PUBLIC_PROFILE_VERSION
    || openApi?.["x-programmable-profile"]?.profileRevision !== 3
    || openApi?.["x-programmable-profile"]?.productionLaunchAuthorized !== true
    || openApi?.["x-programmable-admission-policy"]?.currentProfileVersion
      !== PUBLIC_PROFILE_VERSION
    || canonicalize(openApi?.["x-programmable-admission-policy"]
      ?.legacyExactProfileVersions) !== canonicalize([
      "3.2.0",
      "3.1.0",
      "3.0.0",
      "2.0.0",
    ])
    || openApi?.["x-programmable-admission-policy"]?.manualProjectAllowlist !== false
    || canonicalize(openApi?.["x-programmable-admission-policy"]
      ?.hardBlockFindingRules) !== canonicalize(
      PLATFORM_ADMISSION_POLICY.blockingFindingRules,
    )) {
    throw new Error("Website V3 OpenAPI is not the enabled revision 3 profile contract");
  }
  if (launchPackage?.name !== "@programmable/launch"
    || launchPackage?.version !== LAUNCH_PACKAGE_VERSION) {
    throw new Error("launch package manifest is not the 3.3.6 public CLI contract");
  }
}

function validateReadiness(
  readiness,
  backend,
  inventory,
  contract,
  profile,
  walletAdminSecurity,
) {
  const profileSha256 = sha256(Buffer.from(canonicalize(profile), "utf8"));
  const migrationInventorySha256 = prettyJsonSha256(inventory);
  const apiContractSha256 = prettyJsonSha256(contract);
  if (!exactKeys(readiness, READINESS_KEYS)
    || readiness.schemaVersion !== "programmable.custom-launch-api-readiness.v2"
    || readiness.status !== "ready"
    || readiness.service !== "custom-launch-api-v1"
    || readiness.sourceCommit !== backend.commitSha
    || readiness.sourceTree !== backend.treeSha
    || readiness.migrationInventorySha256 !== migrationInventorySha256
    || readiness.apiContractSha256 !== apiContractSha256
    || !exactKeys(readiness.walletAdminSecurity, WALLET_ADMIN_SECURITY_KEYS)
    || readiness.walletAdminSecurity.assertionVersion
      !== walletAdminSecurity.assertionVersion
    || readiness.walletAdminSecurity.assertionMode
      !== walletAdminSecurity.assertionMode
    || readiness.walletAdminSecurity.legacyBearerRequestsAccepted
      !== walletAdminSecurity.legacyBearerRequestsAccepted
    || !exactKeys(readiness.publicProfile, PUBLIC_PROFILE_KEYS)
    || readiness.publicProfile.profileId !== profile.profileId
    || readiness.publicProfile.profileVersion !== profile.profileVersion
    || readiness.publicProfile.profileSha256 !== profileSha256
    || readiness.publicProfile.productionLaunchAuthorized !== true) {
    throw new Error("API readiness differs from the exact backend artifacts");
  }
  validateChain(readiness.chain, profile.chain);
  return Object.freeze({
    migrationInventorySha256,
    apiContractSha256,
    profileSha256,
    readinessIdentitySha256: sha256(Buffer.from(canonicalize(readiness), "utf8")),
  });
}

async function assertOutputDoesNotExist(outputPath) {
  try {
    await lstat(outputPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw new Error("canonical backend binding output could not be inspected");
  }
  throw new Error("canonical backend binding output already exists");
}

async function externalOutputPath(path, repositories, label) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new Error(`${label} must be an absolute path`);
  }
  let parent;
  try {
    parent = await realpath(dirname(path));
  } catch {
    throw new Error(`${label} parent is unavailable`);
  }
  const filename = basename(path);
  const canonical = join(parent, filename);
  if (filename === "" || filename === "." || filename === ".."
    || repositories.some((root) => canonical === root || canonical.startsWith(`${root}/`))) {
    throw new Error(`${label} must remain outside both repositories`);
  }
  await assertOutputDoesNotExist(canonical);
  return canonical;
}

async function databaseSchemaEvidence(backendRoot, migrationList) {
  if (!exactKeys(migrationList, ["message", "migrations"])
    || typeof migrationList.message !== "string"
    || !Array.isArray(migrationList.migrations)
    || migrationList.migrations.length !== EXPECTED_SUPABASE_MIGRATIONS.length) {
    throw new Error("Supabase migration-list readback is invalid");
  }
  assertNoSecretFields(migrationList, "Supabase migration-list readback");
  const expectedVersions = EXPECTED_SUPABASE_MIGRATIONS.map((name) => name.split("_", 1)[0]);
  const migrations = migrationList.migrations.map((migration) => {
    if (!exactKeys(migration, ["local", "remote", "time"])
      || typeof migration.local !== "string"
      || migration.local !== migration.remote
      || typeof migration.time !== "string"
      || migration.time.length < 1 || migration.time.length > 128) {
      throw new Error("Supabase migration-list entry is invalid");
    }
    return Object.freeze({
      local: migration.local,
      remote: migration.remote,
      time: migration.time,
    });
  }).sort((left, right) => Buffer.from(left.local).compare(Buffer.from(right.local)));
  if (migrations.map((migration) => migration.local).join("\0")
    !== expectedVersions.join("\0")) {
    throw new Error("Supabase migration-list does not match the exact backend migrations");
  }
  const mirrorByteChecks = await Promise.all(EXPECTED_MIGRATIONS.map(async (
    runtimeName,
    index,
  ) => {
    const supabaseName = EXPECTED_SUPABASE_MIGRATIONS[index];
    const runtimePath = `${SERVICE_PATH}/migrations/${runtimeName}`;
    const supabasePath = `${SERVICE_PATH}/supabase/migrations/${supabaseName}`;
    const [runtimeBytes, supabaseBytes] = await Promise.all([
      readBoundedFile(join(backendRoot, runtimePath), "runtime migration mirror"),
      readBoundedFile(join(backendRoot, supabasePath), "Supabase migration"),
    ]);
    if (!runtimeBytes.equals(supabaseBytes)) {
      throw new Error("backend migration mirrors are not byte-identical");
    }
    return Object.freeze({
      runtimePath,
      supabasePath,
      sha256: sha256(runtimeBytes),
      byteEqual: true,
    });
  }));
  return Object.freeze({
    schemaVersion: "programmable.custom-launch-api-database-schema-evidence.v1",
    status: "passed",
    supabaseMigrationList: Object.freeze({ migrations: Object.freeze(migrations) }),
    mirrorByteChecks: Object.freeze(mirrorByteChecks),
  });
}

export async function materializeCustomLaunchApiReleaseBindingV1(input) {
  const walletAdminSecurity = expectedWalletAdminSecurity(
    input.walletAdminAssertionMode,
  );
  const [website, backend] = await Promise.all([
    repositoryIdentity(
      input.websiteRoot,
      "0xprogrammable/PROGRAMMABLE",
      "Website",
    ),
    repositoryIdentity(
      input.backendRoot,
      "0xprogrammable/programmable-open-hook-v2-internal",
      "backend",
    ),
  ]);
  const outputPath = join(backend.root, BINDING_PATH);
  await assertOutputDoesNotExist(outputPath);
  const databaseEvidenceOutputPath = await externalOutputPath(
    input.databaseSchemaEvidenceOutput,
    [website.root, backend.root],
    "database schema evidence output",
  );
  const [
    publicOpenApiBytes,
    launchPackageManifestBytes,
    profileDocument,
    apiContractDocument,
    inventory,
    readinessDocument,
    supabaseMigrationListDocument,
    flyReleases,
    flyMachines,
    flyImages,
  ] = await Promise.all([
    readBoundedFile(join(website.root, PUBLIC_OPENAPI_PATH), "Website V3 OpenAPI"),
    readBoundedFile(join(website.root, LAUNCH_PACKAGE_MANIFEST_PATH), "launch package manifest"),
    readJson(join(backend.root, PROFILE_PATH), "backend public admission profile"),
    readJson(join(backend.root, API_CONTRACT_PATH), "backend API contract"),
    migrationInventory(backend.root),
    readJson(input.apiReadiness, "API readiness readback"),
    readJson(input.supabaseMigrationList, "Supabase migration-list readback"),
    readJson(input.flyReleases, "Fly releases readback"),
    readJson(input.flyMachines, "Fly machines readback"),
    readJson(input.flyImages, "Fly images readback"),
  ]);
  validateWebsiteArtifacts(publicOpenApiBytes, launchPackageManifestBytes);
  validateProfile(profileDocument.value);
  validateApiContract(apiContractDocument.value);
  const identities = validateReadiness(
    readinessDocument.value,
    backend,
    inventory,
    apiContractDocument.value,
    profileDocument.value,
    walletAdminSecurity,
  );
  const databaseEvidence = await databaseSchemaEvidence(
    backend.root,
    supabaseMigrationListDocument.value,
  );
  const databaseEvidenceBytes = Buffer.from(
    `${JSON.stringify(databaseEvidence, null, 2)}\n`,
    "utf8",
  );
  const fly = deriveCustomLaunchApiFlyReleaseIdentity({
    releases: flyReleases.value,
    machines: flyMachines.value,
    images: flyImages.value,
    expectedImageTag: `main-${backend.commitSha.slice(0, 12)}`,
  });
  const binding = {
    schemaVersion: "programmable.custom-launch-api-release-binding.v1",
    materializationState: "materialized",
    backend: {
      repository: "0xprogrammable/programmable-open-hook-v2-internal",
      servicePath: SERVICE_PATH,
      candidateCommitSha: backend.commitSha,
      candidateTreeSha: backend.treeSha,
    },
    website: {
      repository: "0xprogrammable/programmable",
      candidateCommitSha: website.commitSha,
      candidateTreeSha: website.treeSha,
      publicOpenApiSha256: sha256(publicOpenApiBytes),
      launchPackageManifestSha256: sha256(launchPackageManifestBytes),
    },
    fly: {
      app: "programmable-custom-launch-api",
      origin: "https://programmable-custom-launch-api.fly.dev",
      region: "fra",
      ...fly,
    },
    database: {
      migrationInventorySha256: identities.migrationInventorySha256,
      lastMigration: `migrations/${EXPECTED_MIGRATIONS.at(-1)}`,
      schemaEvidenceSha256: sha256(databaseEvidenceBytes),
    },
    api: {
      readinessSchemaVersion: "programmable.custom-launch-api-readiness.v2",
      readinessIdentitySha256: identities.readinessIdentitySha256,
      apiContractSha256: identities.apiContractSha256,
      profileId: PUBLIC_PROFILE_ID,
      profileVersion: PUBLIC_PROFILE_VERSION,
      publicProfilePath: PROFILE_PATH,
      publicProfileSha256: identities.profileSha256,
    },
    chain: Object.fromEntries(CHAIN_KEYS.map((key) => [key, readinessDocument.value.chain[key]])),
  };
  const bytes = Buffer.from(`${JSON.stringify(binding, null, 2)}\n`, "utf8");
  parseDeterministicCustomLaunchApiReleaseBindingV1(bytes);
  try {
    await writeFile(databaseEvidenceOutputPath, databaseEvidenceBytes, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(outputPath, bytes, { flag: "wx", mode: 0o600 });
  } catch {
    throw new Error("release evidence outputs could not be created exclusively");
  }
  const [writtenBytes, writtenDatabaseEvidence] = await Promise.all([
    readBoundedFile(outputPath, "canonical backend binding output"),
    readBoundedFile(databaseEvidenceOutputPath, "database schema evidence output"),
  ]);
  if (!writtenBytes.equals(bytes) || !writtenDatabaseEvidence.equals(databaseEvidenceBytes)) {
    throw new Error("release evidence output differs after creation");
  }
  return Object.freeze({
    outputPath,
    documentSha256: sha256(bytes),
    databaseEvidenceOutputPath,
    databaseSchemaEvidenceSha256: sha256(databaseEvidenceBytes),
    binding: Object.freeze(binding),
  });
}

export function parseCustomLaunchApiReleaseBindingArguments(argv) {
  if (argv.length !== PATH_ARGUMENTS.length * 2
    && argv.length !== ARGUMENTS.length * 2) {
    throw new Error("invalid command arguments");
  }
  const parsed = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const rawKey = argv[index];
    const value = argv[index + 1];
    if (typeof rawKey !== "string" || !rawKey.startsWith("--")
      || typeof value !== "string") throw new Error("invalid command arguments");
    const key = rawKey.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    if (!ARGUMENTS.includes(key) || parsed[key] !== undefined) {
      throw new Error("invalid command arguments");
    }
    if (PATH_ARGUMENTS.includes(key) && !isAbsolute(value)) {
      throw new Error("all path arguments must be absolute file or repository paths");
    }
    if (key === "walletAdminAssertionMode") expectedWalletAdminSecurity(value);
    parsed[key] = value;
  }
  if (PATH_ARGUMENTS.some((key) => parsed[key] === undefined)) {
    throw new Error("required command argument is unavailable");
  }
  return parsed;
}

async function main(argv) {
  const result = await materializeCustomLaunchApiReleaseBindingV1(
    parseCustomLaunchApiReleaseBindingArguments(argv),
  );
  if (!SHA256.test(result.documentSha256)
    || !SHA256.test(result.databaseSchemaEvidenceSha256)) {
    throw new Error("release evidence digest is invalid");
  }
  process.stdout.write([
    `CUSTOM_LAUNCH_API_RELEASE_BINDING_MATERIALIZED ${result.documentSha256}`,
    `CUSTOM_LAUNCH_API_DATABASE_SCHEMA_EVIDENCE_MATERIALIZED ${result.databaseSchemaEvidenceSha256}`,
    "",
  ].join("\n"));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
