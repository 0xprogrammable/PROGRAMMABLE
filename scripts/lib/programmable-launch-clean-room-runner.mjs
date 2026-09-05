#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  canonicalizeJson,
  parseStrictJson,
} from "../../packages/launch/src/canonical-json.mjs";
import { decodeExactProjectImageV4 } from "../../packages/launch/src/image-validation-v4.mjs";
import * as legacyReleaseBinding from "../programmable-launch-v4-release-binding.mjs";

/** Create isolated release-specific runners. Defaults preserve the immutable 4.0 contract. */
export function createCleanRoomRunner({
  CLEAN_ROOM_SCHEMA = "programmable.launch-v4-clean-room-evidence.v1",
  PREPARED_SCHEMA = "programmable.launch-v4-clean-room-prepared.v1",
  RECOVERY_SCHEMA = "programmable.launch-v4-clean-room-recovery.v1",
  PRODUCER_SCHEMA = "programmable.launch-v4-clean-room-producer.v1",
  REVIEWED_RELEASE_COORDINATE_SCHEMA = "programmable.launch-v4-clean-room-release-coordinate.v1",
  REVIEWED_RELEASE_COORDINATE_PATH = "docs/operations/releases/custom-launch-v4/clean-room-release-coordinate.json",
  RELEASE_REPOSITORY = "programmablehq/PROGRAMMABLE",
  RELEASE_MANIFEST_REPOSITORY = "programmablehq/programmable",
  RELEASE_TAG = "programmable-launch-v4.0.0",
  RELEASE_VERSION = "4.0.0",
  RELEASE_SIGNER_WORKFLOW = "programmablehq/PROGRAMMABLE/.github/workflows/release-programmable-launch.yml",
  PRODUCTION_REF = "refs/heads/production",
  CHAIN_ID = "4663",
  CAIP2 = "eip155:4663",

  RELEASE_BINDING = legacyReleaseBinding,
  CLEAN_ROOM_WORKFLOW_PATH = ".github/workflows/programmable-launch-v4-clean-room.yml",
  EXAMPLE_PROJECT = "robinhood-v4-no-broadcast",
  TREE_DIGEST_DOMAIN = "programmable.launch-v4-clean-room-tree.v1",
  REQUEST_SCHEMA = "programmable.custom-launch-create-request.v4",
  REQUEST_DIGEST_DOMAIN = "programmable.custom-launch-request.v4",
  TRANSACTION_SCHEMA = "programmable.exact-wallet-transaction.v4",
  TRANSACTION_DIGEST_DOMAIN = "programmable.exact-wallet-transaction-preimage.v4",
  REQUIRE_NATIVE20 = false,
  IDEMPOTENCY_PREFIX = "programmable-v4-clean-room-",
  ASSERT_FEE_REVIEW = null,
  ASSERT_INITIAL_BUY_REVIEW = null,
  NORMALIZE_FUNDING_PLAN = null,
  EXPECTED_PROFILE = null,
} = {}) {
const { V4_RELEASE_BINDING_PATH, V4_RELEASE_BINDING_SCHEMA, auditV4ReleaseBinding } = RELEASE_BINDING;
const NODE_VERSION = "v24.14.0";
const NPM_VERSION = "11.16.0";
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const HEX_DATA = /^0x(?:[0-9a-f]{2})+$/u;
const RELEASE_NAMES = Object.freeze({
  tarball: `programmable-launch-${RELEASE_VERSION}.tgz`,
  checksum: `programmable-launch-${RELEASE_VERSION}.tgz.sha256`,
  sbom: `programmable-launch-${RELEASE_VERSION}.cdx.json`,
  manifest: `programmable-launch-${RELEASE_VERSION}.release.json`,
});
const RELEASE_FILES = Object.freeze(Object.values(RELEASE_NAMES).sort());
const PRODUCTION_ENVIRONMENT = "production";
const RECOVERY_STATUSES = new Set([
  "received", "validating", "action_required", "awaiting_wallet_signature",
  "wallet_action_required",
]);
const FORBIDDEN_TRANSACTION_FIELDS = Object.freeze([
  "walletSignature", "signature", "signedTransaction", "rawTransaction", "transactionHash",
]);
const MAX_JSON_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5_242_880;
const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

class CleanRoomError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "CleanRoomError";
    this.code = code;
  }
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${canonicalizeJson(value)}\n`, "utf8");
}

function prettyCanonicalJsonBytes(value) {
  function sortJson(entry) {
    if (Array.isArray(entry)) return entry.map(sortJson);
    if (!plainObject(entry)) return entry;
    return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, sortJson(entry[key])]));
  }
  return Buffer.from(`${JSON.stringify(sortJson(value), null, 2)}\n`, "utf8");
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function framedSha256(domain, value) {
  return sha256(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(value), "utf8"),
  ]));
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  if (!plainObject(value)) throw new CleanRoomError(`${label.toUpperCase()}_NOT_OBJECT`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalizeJson(actual) !== canonicalizeJson(expected)) {
    throw new CleanRoomError(`${label.toUpperCase()}_SHAPE_INVALID`);
  }
}

function exactJson(left, right, code) {
  if (canonicalizeJson(left) !== canonicalizeJson(right)) throw new CleanRoomError(code);
}

function requireValue(condition, code) {
  if (!condition) throw new CleanRoomError(code);
}

function parseJsonBytes(bytes, label, maximumBytes = MAX_JSON_BYTES) {
  requireValue(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maximumBytes,
    `${label}_BYTES_INVALID`);
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CleanRoomError(`${label}_UTF8_INVALID`);
  }
  try {
    return parseStrictJson(source, { maximumBytes });
  } catch {
    throw new CleanRoomError(`${label}_JSON_INVALID`);
  }
}

function parseCliJson(stdout, label) {
  return parseJsonBytes(Buffer.from(stdout, "utf8"), label);
}

function safeBaseEnv(extra = {}) {
  const result = {};
  for (const name of [
    "HOME", "LANG", "LC_ALL", "NODE_EXTRA_CA_CERTS", "PATH", "SSL_CERT_DIR",
    "SSL_CERT_FILE", "TMPDIR", "XDG_CONFIG_HOME",
  ]) {
    if (typeof process.env[name] === "string") result[name] = process.env[name];
  }
  return { ...result, ...extra };
}

async function runCommand(file, args, options = {}) {
  try {
    const result = await (options.execFileImpl ?? execFileAsync)(file, args, {
      cwd: options.cwd,
      env: options.env ?? safeBaseEnv(),
      encoding: "utf8",
      maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
      timeout: options.timeout ?? 300_000,
      windowsHide: true,
    });
    if (options.requireSilentStderr && result.stderr !== "") {
      throw new CleanRoomError(`${options.stage}_STDERR_REJECTED`);
    }
    return result.stdout;
  } catch (error) {
    if (error instanceof CleanRoomError) throw error;
    throw new CleanRoomError(`${options.stage ?? "COMMAND"}_FAILED`);
  }
}

async function assertRegularFile(filePath, label, maximumBytes = Number.MAX_SAFE_INTEGER) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch {
    throw new CleanRoomError(`${label}_MISSING`);
  }
  requireValue(metadata.isFile() && !metadata.isSymbolicLink(), `${label}_NOT_REGULAR`);
  requireValue(metadata.size > 0 && metadata.size <= maximumBytes, `${label}_SIZE_INVALID`);
  return metadata;
}

async function assertPathAbsent(filePath, label) {
  try {
    await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw new CleanRoomError(`${label}_PATH_UNREADABLE`);
  }
  throw new CleanRoomError(`${label}_ALREADY_EXISTS`);
}

async function readReleaseFiles(directory) {
  const entries = (await readdir(directory)).sort();
  exactJson(entries, RELEASE_FILES, "RELEASE_DIRECTORY_SHAPE_INVALID");
  const files = {};
  for (const name of RELEASE_FILES) {
    await assertRegularFile(path.join(directory, name), "RELEASE_ASSET", 64 * 1024 * 1024);
    files[name] = await readFile(path.join(directory, name));
  }
  return files;
}

function validateReleaseFiles(files) {
  exactKeys(files, RELEASE_FILES, "release_files");
  const manifestBytes = files[RELEASE_NAMES.manifest];
  const manifest = parseJsonBytes(manifestBytes, "RELEASE_MANIFEST", 2 * 1024 * 1024);
  requireValue(prettyCanonicalJsonBytes(manifest).equals(manifestBytes),
    "RELEASE_MANIFEST_NOT_CANONICAL");
  exactKeys(manifest, [
    "schemaVersion", "repository", "source", "package", "toolchain",
    "machineContractBinding", "assets",
  ], "release_manifest");
  requireValue(manifest.schemaVersion === "programmable.launch-cli-release-assets.v2",
    "RELEASE_MANIFEST_SCHEMA_INVALID");
  requireValue(manifest.repository === RELEASE_MANIFEST_REPOSITORY,
    "RELEASE_MANIFEST_REPOSITORY_INVALID");
  exactKeys(manifest.source, ["ref", "commitSha", "treeSha"], "release_source");
  requireValue(manifest.source.ref === PRODUCTION_REF, "RELEASE_SOURCE_REF_INVALID");
  requireValue(COMMIT.test(manifest.source.commitSha ?? ""), "RELEASE_SOURCE_COMMIT_INVALID");
  requireValue(COMMIT.test(manifest.source.treeSha ?? ""), "RELEASE_SOURCE_TREE_INVALID");
  exactKeys(manifest.package, ["name", "version", "tag"], "release_package");
  requireValue(manifest.package.name === "@programmable/launch"
    && manifest.package.version === RELEASE_VERSION
    && manifest.package.tag === RELEASE_TAG, "RELEASE_PACKAGE_IDENTITY_INVALID");
  exactJson(manifest.toolchain, { node: "24.14.0", npm: NPM_VERSION },
    "RELEASE_TOOLCHAIN_INVALID");
  exactKeys(manifest.machineContractBinding, ["schemaVersion", "path", "sha256"],
    "machine_contract_binding");
  requireValue(
    manifest.machineContractBinding.schemaVersion
      === V4_RELEASE_BINDING_SCHEMA
      && manifest.machineContractBinding.path
        === V4_RELEASE_BINDING_PATH
      && SHA256.test(manifest.machineContractBinding.sha256 ?? ""),
    "MACHINE_CONTRACT_BINDING_INVALID",
  );
  requireValue(Array.isArray(manifest.assets) && manifest.assets.length === 3,
    "RELEASE_ASSETS_INVALID");
  const expectedPayloads = [
    [RELEASE_NAMES.tarball, "application/gzip"],
    [RELEASE_NAMES.checksum, "text/plain"],
    [RELEASE_NAMES.sbom, "application/vnd.cyclonedx+json"],
  ].sort(([left], [right]) => left.localeCompare(right));
  for (const [index, [name, mediaType]] of expectedPayloads.entries()) {
    const asset = manifest.assets[index];
    exactKeys(asset, ["name", "mediaType", "bytes", "sha256"], `release_asset_${index}`);
    requireValue(asset.name === name && asset.mediaType === mediaType,
      "RELEASE_ASSET_IDENTITY_INVALID");
    requireValue(Number.isSafeInteger(asset.bytes) && asset.bytes === files[name].length,
      "RELEASE_ASSET_SIZE_MISMATCH");
    requireValue(SHA256_HEX.test(asset.sha256 ?? "")
      && `sha256:${asset.sha256}` === sha256(files[name]), "RELEASE_ASSET_DIGEST_MISMATCH");
  }
  const tarballDigest = sha256(files[RELEASE_NAMES.tarball]);
  const expectedChecksum = `${tarballDigest.slice("sha256:".length)}  ${RELEASE_NAMES.tarball}\n`;
  requireValue(files[RELEASE_NAMES.checksum].toString("utf8") === expectedChecksum,
    "RELEASE_CHECKSUM_MISMATCH");
  const sbom = parseJsonBytes(files[RELEASE_NAMES.sbom], "RELEASE_SBOM", 16 * 1024 * 1024);
  requireValue(prettyCanonicalJsonBytes(sbom).equals(files[RELEASE_NAMES.sbom]),
    "RELEASE_SBOM_NOT_CANONICAL");
  requireValue(sbom.bomFormat === "CycloneDX" && /^1\.[5-9]$/u.test(sbom.specVersion ?? "")
    && !Object.hasOwn(sbom, "serialNumber") && !Object.hasOwn(sbom.metadata ?? {}, "timestamp"),
  "RELEASE_SBOM_INVALID");
  return Object.freeze({
    repository: RELEASE_REPOSITORY,
    tag: RELEASE_TAG,
    version: RELEASE_VERSION,
    source: Object.freeze({ ...manifest.source }),
    machineContractBinding: Object.freeze({ ...manifest.machineContractBinding }),
    assets: Object.freeze(RELEASE_FILES.map((name) => Object.freeze({
      name,
      bytes: files[name].length,
      sha256: sha256(files[name]),
    }))),
  });
}

function validateReviewedReleaseCoordinate(value, bindingResult) {
  exactKeys(value, [
    "$schema", "schemaVersion", "releaseReady", "repository", "tag", "version",
    "source", "releaseBinding", "machineContractBinding", "manifestSha256", "assets",
    "blockers",
  ], "reviewed_release_coordinate");
  requireValue(value.$schema === "./clean-room-release-coordinate.schema.json"
    && value.schemaVersion === REVIEWED_RELEASE_COORDINATE_SCHEMA,
  "REVIEWED_RELEASE_COORDINATE_SCHEMA_INVALID");
  requireValue(value.repository === RELEASE_REPOSITORY
    && value.tag === RELEASE_TAG && value.version === RELEASE_VERSION,
  "REVIEWED_RELEASE_COORDINATE_IDENTITY_INVALID");
  exactKeys(value.source, ["ref", "commitSha", "treeSha"], "reviewed_release_source");
  requireValue(value.source.ref === PRODUCTION_REF,
    "REVIEWED_RELEASE_SOURCE_REF_INVALID");
  exactKeys(value.releaseBinding, ["path", "sha256"], "reviewed_release_binding");
  exactKeys(value.machineContractBinding, ["schemaVersion", "path", "sha256"],
    "reviewed_machine_contract_binding");
  requireValue(value.releaseBinding.path === V4_RELEASE_BINDING_PATH
    && value.machineContractBinding.schemaVersion === V4_RELEASE_BINDING_SCHEMA
    && value.machineContractBinding.path === V4_RELEASE_BINDING_PATH,
  "REVIEWED_RELEASE_BINDING_IDENTITY_INVALID");
  requireValue(Array.isArray(value.assets) && value.assets.length === RELEASE_FILES.length,
    "REVIEWED_RELEASE_ASSETS_INVALID");
  for (const [index, asset] of value.assets.entries()) {
    exactKeys(asset, ["name", "sha256"], `reviewed_release_asset_${index}`);
    requireValue(asset.name === RELEASE_FILES[index]
      && (asset.sha256 === null || SHA256.test(asset.sha256 ?? "")),
    "REVIEWED_RELEASE_ASSET_INVALID");
  }
  requireValue(value.source.commitSha === null || COMMIT.test(value.source.commitSha ?? ""),
    "REVIEWED_RELEASE_SOURCE_COMMIT_INVALID");
  requireValue(value.source.treeSha === null || COMMIT.test(value.source.treeSha ?? ""),
    "REVIEWED_RELEASE_SOURCE_TREE_INVALID");
  for (const [digest, code] of [
    [value.releaseBinding.sha256, "REVIEWED_RELEASE_BINDING_DIGEST_INVALID"],
    [value.machineContractBinding.sha256, "REVIEWED_MACHINE_BINDING_DIGEST_INVALID"],
    [value.manifestSha256, "REVIEWED_RELEASE_MANIFEST_DIGEST_INVALID"],
  ]) {
    requireValue(digest === null || SHA256.test(digest ?? ""), code);
  }
  requireValue(plainObject(bindingResult)
    && typeof bindingResult.releaseReady === "boolean"
    && SHA256.test(bindingResult.bindingSha256 ?? ""),
  "REVIEWED_RELEASE_BINDING_RESULT_INVALID");
  const manifestAsset = value.assets.find(({ name }) => name === RELEASE_NAMES.manifest);
  if (value.manifestSha256 !== null && manifestAsset?.sha256 !== null) {
    requireValue(value.manifestSha256 === manifestAsset?.sha256,
      "REVIEWED_RELEASE_MANIFEST_ASSET_DRIFT");
  }
  const blockers = [
    ...(!bindingResult.releaseReady ? ["releaseBindingReady"] : []),
    ...(!(COMMIT.test(value.source.commitSha ?? "") && COMMIT.test(value.source.treeSha ?? ""))
      ? ["releaseSourceCoordinate"] : []),
    ...(!SHA256.test(value.manifestSha256 ?? "") ? ["releaseManifestDigest"] : []),
    ...(value.assets.some(({ sha256: digest }) => !SHA256.test(digest ?? ""))
      ? ["releaseAssetDigests"] : []),
    ...(!(value.releaseBinding.sha256 === bindingResult.bindingSha256
      && value.machineContractBinding.sha256 === bindingResult.bindingSha256)
      ? ["machineContractBindingDigest"] : []),
  ];
  requireValue(Array.isArray(value.blockers)
    && value.blockers.every((entry) => typeof entry === "string")
    && new Set(value.blockers).size === value.blockers.length,
  "REVIEWED_RELEASE_BLOCKERS_INVALID");
  exactJson(value.blockers, blockers, "REVIEWED_RELEASE_BLOCKERS_DRIFT");
  requireValue(value.releaseReady === (blockers.length === 0),
    "REVIEWED_RELEASE_READY_DRIFT");
  return value;
}

function requireReviewedReleaseCoordinateReady(coordinate, bindingResult) {
  requireValue(bindingResult.releaseReady === true, "V4_RELEASE_BINDING_NOT_READY");
  requireValue(coordinate.releaseReady === true,
    "REVIEWED_RELEASE_COORDINATE_BLOCKED");
  return coordinate;
}

function assertReleaseMatchesReviewedCoordinate(release, coordinate) {
  requireValue(coordinate.releaseReady === true,
    "REVIEWED_RELEASE_COORDINATE_BLOCKED");
  requireValue(release.repository === coordinate.repository
    && release.tag === coordinate.tag && release.version === coordinate.version,
  "RELEASE_REVIEWED_IDENTITY_MISMATCH");
  exactJson(release.source, coordinate.source, "RELEASE_REVIEWED_SOURCE_MISMATCH");
  exactJson(release.machineContractBinding, coordinate.machineContractBinding,
    "RELEASE_REVIEWED_MACHINE_BINDING_MISMATCH");
  const reviewedAssets = coordinate.assets.map(({ name, sha256: digest }) => ({
    name,
    sha256: digest,
  }));
  exactJson(release.assets.map(({ name, sha256: digest }) => ({ name, sha256: digest })),
    reviewedAssets, "RELEASE_REVIEWED_ASSET_MISMATCH");
  requireValue(coordinate.manifestSha256
      === reviewedAssets.find(({ name }) => name === RELEASE_NAMES.manifest)?.sha256,
  "RELEASE_REVIEWED_MANIFEST_MISMATCH");
  return release;
}

async function loadReviewedReleaseCoordinate() {
  let binding;
  try {
    binding = auditV4ReleaseBinding({ repositoryRoot: REPOSITORY_ROOT });
  } catch (error) {
    throw new CleanRoomError("V4_RELEASE_BINDING_NOT_READY", { cause: error });
  }
  const coordinatePath = path.join(REPOSITORY_ROOT, REVIEWED_RELEASE_COORDINATE_PATH);
  await assertRegularFile(coordinatePath, "REVIEWED_RELEASE_COORDINATE", 1_048_576);
  const bytes = await readFile(coordinatePath);
  const coordinate = validateReviewedReleaseCoordinate(
    parseJsonBytes(bytes, "REVIEWED_RELEASE_COORDINATE", 1_048_576),
    binding,
  );
  requireValue(prettyCanonicalJsonBytes(coordinate).equals(bytes),
    "REVIEWED_RELEASE_COORDINATE_NOT_CANONICAL");
  requireReviewedReleaseCoordinateReady(coordinate, binding);
  return Object.freeze({
    coordinate: Object.freeze(structuredClone(coordinate)),
    coordinateSha256: sha256(bytes),
  });
}

async function verifyTarball(directory, release) {
  const tarball = path.join(directory, RELEASE_NAMES.tarball);
  const entries = (await runCommand("tar", ["-tzf", tarball], {
    stage: "TARBALL_LIST", cwd: directory,
  })).trim().split("\n");
  requireValue(entries.length > 1 && entries.every((entry) =>
    entry.startsWith("package/")
      && !entry.includes("\\")
      && !entry.split("/").some((segment) => segment === "..")),
  "TARBALL_ENTRY_INVALID");
  const packageJson = parseCliJson(await runCommand("tar", [
    "-xOzf", tarball, "package/package.json",
  ], { stage: "TARBALL_PACKAGE", cwd: directory }), "TARBALL_PACKAGE");
  requireValue(packageJson.name === "@programmable/launch"
    && packageJson.version === RELEASE_VERSION
    && packageJson.packageManager === `npm@${NPM_VERSION}`,
  "TARBALL_PACKAGE_IDENTITY_INVALID");
  requireValue(release.source.commitSha.length === 40, "TARBALL_SOURCE_UNBOUND");
}

async function directoryDigest(root) {
  const realRoot = await realpath(root);
  const entries = [];
  async function visit(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        entries.push({ path: relative, type: "directory" });
        await visit(absolute, relative);
      } else if (entry.isFile()) {
        entries.push({ path: relative, type: "file", sha256: sha256(await readFile(absolute)) });
      } else if (entry.isSymbolicLink()) {
        const target = await readlink(absolute);
        requireValue(!path.isAbsolute(target), "TREE_ABSOLUTE_SYMLINK_REJECTED");
        const resolved = path.resolve(path.dirname(absolute), target);
        requireValue(resolved === realRoot || resolved.startsWith(`${realRoot}${path.sep}`),
          "TREE_ESCAPING_SYMLINK_REJECTED");
        entries.push({ path: relative, type: "symlink", target });
      } else {
        throw new CleanRoomError("TREE_SPECIAL_FILE_REJECTED");
      }
    }
  }
  await visit(realRoot, "");
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return framedSha256(TREE_DIGEST_DOMAIN, entries);
}

function validateCleanRoomImage(bytes) {
  requireValue(bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES, "PROJECT_IMAGE_SIZE_INVALID");
  let decoded;
  try {
    decoded = decodeExactProjectImageV4(bytes);
  } catch {
    throw new CleanRoomError("PROJECT_IMAGE_V4_DECODE_INVALID");
  }
  requireValue(new Set(["image/png", "image/gif"]).has(decoded.mediaType)
    && decoded.frameCount === 1, "PROJECT_IMAGE_V4_CONTRACT_INVALID");
  return decoded;
}

function requiredPublicInput(value, pattern, code) {
  requireValue(typeof value === "string" && pattern.test(value), code);
  return value;
}

function exactHttps(value, code) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CleanRoomError(code);
  }
  requireValue(url.protocol === "https:" && !url.username && !url.password && !url.hash, code);
  return url.href;
}

async function downloadAndVerifyRelease(releaseDirectory, reviewedRelease) {
  requireValue(typeof process.env.GH_TOKEN === "string" && process.env.GH_TOKEN.length >= 20,
    "GITHUB_TOKEN_INVALID");
  const githubEnv = safeBaseEnv({ GH_TOKEN: process.env.GH_TOKEN });
  await mkdir(releaseDirectory, { recursive: false, mode: 0o700 });
  for (const name of RELEASE_FILES) {
    await runCommand("gh", [
      "release", "download", RELEASE_TAG,
      "--repo", RELEASE_REPOSITORY,
      "--pattern", name,
      "--dir", releaseDirectory,
    ], { stage: "RELEASE_DOWNLOAD", cwd: releaseDirectory, env: githubEnv });
  }
  await runCommand("gh", ["release", "verify", RELEASE_TAG, "--repo", RELEASE_REPOSITORY], {
    stage: "RELEASE_VERIFY", cwd: releaseDirectory, env: githubEnv,
  });
  const firstFiles = await readReleaseFiles(releaseDirectory);
  const release = validateReleaseFiles(firstFiles);
  const tagCommit = (await runCommand("gh", [
    "api", `repos/${RELEASE_REPOSITORY}/git/ref/tags/${RELEASE_TAG}`, "--jq", ".object.sha",
  ], { stage: "RELEASE_TAG", cwd: releaseDirectory, env: githubEnv })).trim();
  requireValue(tagCommit === release.source.commitSha, "RELEASE_TAG_COMMIT_MISMATCH");
  const tree = (await runCommand("gh", [
    "api", `repos/${RELEASE_REPOSITORY}/git/commits/${release.source.commitSha}`,
    "--jq", ".tree.sha",
  ], { stage: "RELEASE_TREE", cwd: releaseDirectory, env: githubEnv })).trim();
  requireValue(tree === release.source.treeSha, "RELEASE_SOURCE_TREE_MISMATCH");
  for (const name of RELEASE_FILES) {
    const assetPath = path.join(releaseDirectory, name);
    await runCommand("gh", [
      "release", "verify-asset", RELEASE_TAG, assetPath, "--repo", RELEASE_REPOSITORY,
    ], { stage: "RELEASE_ASSET_VERIFY", cwd: releaseDirectory, env: githubEnv });
    await runCommand("gh", [
      "attestation", "verify", assetPath,
      "--repo", RELEASE_REPOSITORY,
      "--signer-workflow", RELEASE_SIGNER_WORKFLOW,
      "--source-ref", PRODUCTION_REF,
      "--source-digest", release.source.commitSha,
      "--signer-digest", release.source.commitSha,
      "--deny-self-hosted-runners",
    ], { stage: "RELEASE_ATTESTATION_VERIFY", cwd: releaseDirectory, env: githubEnv });
  }
  const finalFiles = await readReleaseFiles(releaseDirectory);
  const finalRelease = validateReleaseFiles(finalFiles);
  exactJson(finalRelease, release, "RELEASE_BYTES_CHANGED_AFTER_VERIFICATION");
  assertReleaseMatchesReviewedCoordinate(finalRelease, reviewedRelease.coordinate);
  await verifyTarball(releaseDirectory, release);
  return release;
}

async function runCli(cliPath, args, { cwd, apiKey, timeout = 300_000, stage }) {
  const stdout = await runCommand(process.execPath, [cliPath, ...args], {
    cwd,
    env: safeBaseEnv(apiKey === undefined ? {} : { PROGRAMMABLE_API_KEY: apiKey }),
    requireSilentStderr: true,
    timeout,
    stage,
  });
  return parseCliJson(stdout, stage);
}

function assertLocalValidation(value) {
  requireValue(value?.schemaVersion === REQUEST_SCHEMA
    && value.chainId === CHAIN_ID
    && value.caip2 === CAIP2
    && /^0x[0-9a-f]{64}$/u.test(value.chainDeploymentDescriptorDigest ?? "")
    && value.profile?.profileVersion === RELEASE_VERSION
    && SHA256.test(value.profile?.profileDigest ?? "")
    && SHA256.test(value.requestSha256 ?? "")
    && value.reproducedFromConfig === true
    && value.exactSourceIncluded === true,
  "LOCAL_VALIDATION_INVALID");
}

async function prepareCleanRoom(options) {
  requireValue(!Object.hasOwn(process.env, "PROGRAMMABLE_API_KEY"),
    "PREPARE_REFUSES_PROGRAMMABLE_API_KEY");
  const reviewedRelease = await loadReviewedReleaseCoordinate();
  requireValue(process.version === NODE_VERSION, "NODE_VERSION_INVALID");
  const npmVersion = (await runCommand("npm", ["--version"], {
    stage: "NPM_VERSION", requireSilentStderr: true,
  })).trim();
  requireValue(npmVersion === NPM_VERSION, "NPM_VERSION_INVALID");
  const workspace = path.resolve(options.workspace);
  await mkdir(workspace, { recursive: false, mode: 0o700 });
  const releaseDirectory = path.join(workspace, "release");
  const installDirectory = path.join(workspace, "install");
  const projectDirectory = path.join(workspace, "project");
  const release = await downloadAndVerifyRelease(releaseDirectory, reviewedRelease);
  await runCommand("npm", [
    "install", "--prefix", installDirectory, "--ignore-scripts", "--no-audit", "--no-fund",
    path.join(releaseDirectory, RELEASE_NAMES.tarball),
  ], { stage: "CLI_INSTALL", cwd: workspace, timeout: 300_000 });
  const packageRoot = path.join(installDirectory, "node_modules", "@programmable", "launch");
  const packageJson = parseJsonBytes(await readFile(path.join(packageRoot, "package.json")),
    "INSTALLED_PACKAGE", 1_048_576);
  requireValue(packageJson.name === "@programmable/launch" && packageJson.version === RELEASE_VERSION,
    "INSTALLED_PACKAGE_IDENTITY_INVALID");
  const cliPath = path.join(packageRoot, "bin", "programmable-launch.mjs");
  await assertRegularFile(cliPath, "INSTALLED_CLI", 1_048_576);
  const installedVersion = (await runCommand(process.execPath, [cliPath, "--version"], {
    stage: "INSTALLED_CLI_VERSION", requireSilentStderr: true, cwd: workspace,
  })).trim();
  requireValue(installedVersion === RELEASE_VERSION, "INSTALLED_CLI_VERSION_INVALID");
  const projectSourceRevision = (await runCommand("git", ["-C", REPOSITORY_ROOT, "rev-parse", "HEAD"],
    { stage: "PROJECT_SOURCE_REVISION", requireSilentStderr: true })).trim();
  requireValue(COMMIT.test(projectSourceRevision) && projectSourceRevision === process.env.GITHUB_SHA,
    "PROJECT_SOURCE_REVISION_INVALID");
  await cp(path.join(REPOSITORY_ROOT, "packages", "launch", "examples", EXAMPLE_PROJECT, "project"),
    projectDirectory, { recursive: true, errorOnExist: true, force: false, dereference: false });
  const imagePath = path.resolve(options.image);
  await assertRegularFile(imagePath, "PROJECT_IMAGE", MAX_IMAGE_BYTES);
  const imageBytes = await readFile(imagePath);
  validateCleanRoomImage(imageBytes);
  await mkdir(path.join(projectDirectory, "assets"), { recursive: false, mode: 0o700 });
  await writeFile(path.join(projectDirectory, "assets", "project-image"), imageBytes,
    { flag: "wx", mode: 0o600 });
  await runCommand("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    stage: "PROJECT_INSTALL", cwd: projectDirectory, timeout: 300_000,
  });
  const launchWallet = requiredPublicInput(options.launchWallet, ADDRESS, "LAUNCH_WALLET_INVALID");
  const imageUri = exactHttps(options.imageUri, "PROJECT_IMAGE_URI_INVALID");
  const websiteUrl = exactHttps(options.websiteUrl, "PROJECT_WEBSITE_URL_INVALID");
  requiredPublicInput(options.xUrl, /^https:\/\/x\.com\/[A-Za-z0-9_]{1,64}$/u,
    "PROJECT_X_URL_INVALID");
  const checkedAt = new Date().toISOString();
  const nonce = `0x${randomBytes(32).toString("hex")}`;
  let buildArgs = ["run", "build"];
  if (REQUIRE_NATIVE20) {
    const fundingPlan = NORMALIZE_FUNDING_PLAN({
      schemaVersion: "programmable.robinhood-funding-plan.v1",
      capitalSource: "buyer-funded", pricingModel: "concentrated-liquidity",
      nativeAllocations: { initialLiquidityWei: "0", initialBuyWei: options.initialBuyWei, reserveWei: "0", otherLaunchValueWei: "0" },
      maxLaunchValueWei: options.initialBuyWei, maxGasCostWei: options.maxGasCostWei, launchMode: "fund-and-launch",
    }, { valueWei: options.initialBuyWei });
    requireValue(fundingPlan.nativeAllocations.initialBuyWei !== "0", "NATIVE20_INITIAL_BUY_REQUIRED");
    const input = {
      launchWallet, nonce, checkedAt,
      minimumTokensOut: requiredPublicInput(options.minimumTokensOut, /^[1-9][0-9]{0,77}$/u, "NATIVE20_MINIMUM_TOKENS_OUT_REQUIRED"),
      publicOrigin: { url: "https://github.com/programmablehq/PROGRAMMABLE", revision: projectSourceRevision },
      projectMetadata: {
        schemaVersion: "programmable.project-metadata-input.v1",
        token: { name: "Robinhood Native20 Example", symbol: "RHN20" },
        presentation: {
          description: "Buyer-funded token inventory example with a fixed native ETH platform fee and an explicit gas budget.",
          image: { sourcePath: "assets/project-image", uri: imageUri },
          links: [{ kind: "website", uri: websiteUrl }, { kind: "x", uri: options.xUrl }],
        },
      },
      fundingPlan,
    };
    await writeFile(path.join(projectDirectory, "native20-input.json"), canonicalJsonBytes(input), { flag: "wx", mode: 0o600 });
    buildArgs = ["run", "build", "--", "--input", "native20-input.json"];
  }
  await runCommand("npm", buildArgs, {
    stage: "PROJECT_BUILD",
    cwd: projectDirectory,
    timeout: 300_000,
    env: safeBaseEnv({
      PROGRAMMABLE_CHECKED_AT: checkedAt,
      PROGRAMMABLE_LAUNCH_NONCE: nonce,
      PROGRAMMABLE_LAUNCH_WALLET: launchWallet,
      PROGRAMMABLE_PROJECT_IMAGE_SOURCE_PATH: "assets/project-image",
      PROGRAMMABLE_PROJECT_IMAGE_VALIDATOR_MODULE: pathToFileURL(
        path.join(packageRoot, "src", "image-validation-v4.mjs"),
      ).href,
      PROGRAMMABLE_PROJECT_IMAGE_URI: imageUri,
      PROGRAMMABLE_SOURCE_ORIGIN: "https://github.com/programmablehq/PROGRAMMABLE",
      PROGRAMMABLE_SOURCE_REVISION: projectSourceRevision,
      PROGRAMMABLE_WEBSITE_URL: websiteUrl,
      PROGRAMMABLE_X_URL: options.xUrl,
      ...(REQUIRE_NATIVE20 ? { PROGRAMMABLE_LAUNCH_MODULE_PATH: path.join(packageRoot, "src", "index.mjs") } : {}),
    }),
  });
  const configPath = path.join(projectDirectory, "programmable-launch.config.json");
  const launchPath = path.join(projectDirectory, "launch.json");
  const receiptPath = path.join(projectDirectory, "launch.receipt.json");
  await runCli(cliPath, [
    "pack", "--config", configPath, "--output", launchPath, "--receipt", receiptPath,
  ], { cwd: projectDirectory, stage: "PACK" });
  const localValidation = await runCli(cliPath, [
    "validate", launchPath, "--config", configPath,
  ], { cwd: projectDirectory, stage: "LOCAL_VALIDATE" });
  assertLocalValidation(localValidation);
  const localValidationPath = path.join(projectDirectory, ".clean-room-local-validation.json");
  const localValidationBytes = canonicalJsonBytes(localValidation);
  await writeFile(localValidationPath, localValidationBytes, { flag: "wx", mode: 0o600 });
  const launchBytes = await readFile(launchPath);
  requireValue(sha256(launchBytes) === localValidation.requestSha256,
    "PREPARED_REQUEST_DIGEST_MISMATCH");
  const prepared = {
    schemaVersion: PREPARED_SCHEMA,
    release: {
      ...release,
      reviewedCoordinate: {
        path: REVIEWED_RELEASE_COORDINATE_PATH,
        sha256: reviewedRelease.coordinateSha256,
      },
      attestation: {
        verified: true,
        signerWorkflow: RELEASE_SIGNER_WORKFLOW,
        sourceRef: PRODUCTION_REF,
        sourceDigest: release.source.commitSha,
      },
    },
    bindings: {
      installTreeSha256: await directoryDigest(installDirectory),
      projectTreeSha256: await directoryDigest(projectDirectory),
      configSha256: sha256(await readFile(configPath)),
      launchSha256: sha256(launchBytes),
      receiptSha256: sha256(await readFile(receiptPath)),
      localValidationSha256: sha256(localValidationBytes),
    },
  };
  await writeFile(path.join(workspace, "prepared.json"), canonicalJsonBytes(prepared), {
    flag: "wx", mode: 0o600,
  });
  return prepared;
}

function validatePrepared(value) {
  exactKeys(value, ["schemaVersion", "release", "bindings"], "prepared");
  requireValue(value.schemaVersion === PREPARED_SCHEMA, "PREPARED_SCHEMA_INVALID");
  exactKeys(value.release, [
    "repository", "tag", "version", "source", "machineContractBinding", "assets",
    "reviewedCoordinate", "attestation",
  ], "prepared_release");
  requireValue(value.release.repository === RELEASE_REPOSITORY
    && value.release.tag === RELEASE_TAG && value.release.version === RELEASE_VERSION,
  "PREPARED_RELEASE_IDENTITY_INVALID");
  exactKeys(value.release.source, ["ref", "commitSha", "treeSha"], "prepared_release_source");
  requireValue(value.release.source.ref === PRODUCTION_REF
    && COMMIT.test(value.release.source.commitSha ?? "")
    && COMMIT.test(value.release.source.treeSha ?? ""), "PREPARED_RELEASE_SOURCE_INVALID");
  exactKeys(value.release.machineContractBinding,
    ["schemaVersion", "path", "sha256"], "prepared_machine_contract_binding");
  requireValue(
    value.release.machineContractBinding.schemaVersion
      === V4_RELEASE_BINDING_SCHEMA
      && value.release.machineContractBinding.path
        === V4_RELEASE_BINDING_PATH
      && SHA256.test(value.release.machineContractBinding.sha256 ?? ""),
    "PREPARED_MACHINE_CONTRACT_BINDING_INVALID",
  );
  requireValue(Array.isArray(value.release.assets)
    && value.release.assets.length === RELEASE_FILES.length,
  "PREPARED_RELEASE_ASSETS_INVALID");
  for (const [index, asset] of value.release.assets.entries()) {
    exactKeys(asset, ["name", "bytes", "sha256"], `prepared_release_asset_${index}`);
    requireValue(asset.name === RELEASE_FILES[index]
      && Number.isSafeInteger(asset.bytes) && asset.bytes > 0
      && SHA256.test(asset.sha256 ?? ""), "PREPARED_RELEASE_ASSET_INVALID");
  }
  exactKeys(value.release.reviewedCoordinate, ["path", "sha256"],
    "prepared_reviewed_coordinate");
  requireValue(value.release.reviewedCoordinate.path === REVIEWED_RELEASE_COORDINATE_PATH
    && SHA256.test(value.release.reviewedCoordinate.sha256 ?? ""),
  "PREPARED_REVIEWED_COORDINATE_INVALID");
  exactKeys(value.release.attestation,
    ["verified", "signerWorkflow", "sourceRef", "sourceDigest"], "prepared_attestation");
  requireValue(value.release.attestation.verified === true
    && value.release.attestation.signerWorkflow === RELEASE_SIGNER_WORKFLOW
    && value.release.attestation.sourceRef === PRODUCTION_REF
    && value.release.attestation.sourceDigest === value.release.source.commitSha,
  "PREPARED_ATTESTATION_INVALID");
  exactKeys(value.bindings, [
    "installTreeSha256", "projectTreeSha256", "configSha256", "launchSha256",
    "receiptSha256", "localValidationSha256",
  ], "prepared_bindings");
  requireValue(Object.values(value.bindings).every((digest) => SHA256.test(digest ?? "")),
    "PREPARED_BINDING_INVALID");
  return value;
}

function requireSameResourceBinding(resource, expected, code) {
  requireValue(resource?.chainId === CHAIN_ID && resource.caip2 === CAIP2
    && resource.chainDeploymentId === expected.chainDeployment.chainDeploymentId
    && resource.chainDeploymentDescriptorDigest === expected.chainDeploymentDescriptorDigest
    && resource.profile?.profileDigest === expected.profile.profileDigest,
  code);
  exactJson(resource.chainDeployment, expected.chainDeployment, code);
  exactJson(resource.profile, expected.profile, code);
}

function validateProducerProvenance(value) {
  exactKeys(value, [
    "schemaVersion", "repository", "repositoryId", "workflowPath", "workflowRef",
    "sourceSha", "workflowSha", "runId", "runAttempt", "actor", "actorId", "environment",
  ], "producer_provenance");
  requireValue(value.schemaVersion === PRODUCER_SCHEMA
    && value.repository === RELEASE_REPOSITORY
    && value.repositoryId === "1314365508"
    && value.workflowPath === CLEAN_ROOM_WORKFLOW_PATH
    && value.workflowRef
      === `${RELEASE_REPOSITORY}/${CLEAN_ROOM_WORKFLOW_PATH}@${PRODUCTION_REF}`
    && COMMIT.test(value.sourceSha ?? "")
    && value.workflowSha === value.sourceSha
    && /^[1-9][0-9]*$/u.test(value.runId ?? "")
    && value.runAttempt === "1"
    && value.actor === "hazarxyz"
    && value.actorId === "258789013"
    && value.environment === PRODUCTION_ENVIRONMENT,
  "PRODUCER_PROVENANCE_INVALID");
  return value;
}

function producerProvenanceFromEnvironment() {
  return validateProducerProvenance({
    schemaVersion: PRODUCER_SCHEMA,
    repository: process.env.GITHUB_REPOSITORY,
    repositoryId: process.env.GITHUB_REPOSITORY_ID,
    workflowPath: CLEAN_ROOM_WORKFLOW_PATH,
    workflowRef: process.env.GITHUB_WORKFLOW_REF,
    sourceSha: process.env.GITHUB_SHA,
    workflowSha: process.env.GITHUB_WORKFLOW_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    actor: process.env.GITHUB_ACTOR,
    actorId: process.env.GITHUB_ACTOR_ID,
    environment: process.env.PROGRAMMABLE_CLEAN_ROOM_ENVIRONMENT,
  });
}

function buildCleanRoomRecoveryReceipt(input) {
  const { prepared, local, firstSubmit, producer } = input;
  validatePrepared(prepared);
  assertLocalValidation(local);
  validateProducerProvenance(producer);
  requireValue(firstSubmit?.apiVersion === "v4"
    && firstSubmit.chainId === CHAIN_ID && firstSubmit.caip2 === CAIP2
    && firstSubmit.requestSha256 === local.requestSha256
    && typeof firstSubmit.idempotencyKey === "string"
    && firstSubmit.idempotencyKey.length >= 16,
  "RECOVERY_SUBMIT_INVALID");
  const resource = firstSubmit.resource;
  requireValue(UUID.test(resource?.launchId ?? "")
    && UUID.test(resource?.requestId ?? "")
    && SHA256.test(resource?.requestHash ?? "")
    && resource.rawRequestSha256 === local.requestSha256
    && resource.chainId === CHAIN_ID && resource.caip2 === CAIP2
    && RECOVERY_STATUSES.has(resource.status)
    && resource.onchain === null && resource.failure === null
    && FORBIDDEN_TRANSACTION_FIELDS.every((field) => !Object.hasOwn(resource, field))
    && (resource.walletTransaction === null || plainObject(resource.walletTransaction))
    && (resource.walletTransaction === null || FORBIDDEN_TRANSACTION_FIELDS.every(
      (field) => !Object.hasOwn(resource.walletTransaction, field),
    )),
  "RECOVERY_RESOURCE_INVALID");
  const releaseAsset = (name) => prepared.release.assets.find((asset) => asset.name === name);
  const observedAt = input.observedAt ?? new Date().toISOString();
  requireValue(Number.isFinite(Date.parse(observedAt)) && observedAt.endsWith("Z"),
    "RECOVERY_OBSERVED_AT_INVALID");
  const preimage = {
    schemaVersion: RECOVERY_SCHEMA,
    producer: structuredClone(producer),
    release: {
      repository: RELEASE_REPOSITORY,
      tag: RELEASE_TAG,
      version: RELEASE_VERSION,
      sourceCommit: prepared.release.source.commitSha,
      sourceTree: prepared.release.source.treeSha,
      reviewedCoordinateSha256: prepared.release.reviewedCoordinate.sha256,
      machineContractBindingSha256: prepared.release.machineContractBinding.sha256,
      tarballSha256: releaseAsset(RELEASE_NAMES.tarball)?.sha256,
      checksumSha256: releaseAsset(RELEASE_NAMES.checksum)?.sha256,
      sbomSha256: releaseAsset(RELEASE_NAMES.sbom)?.sha256,
      manifestSha256: releaseAsset(RELEASE_NAMES.manifest)?.sha256,
    },
    request: {
      chainId: CHAIN_ID,
      caip2: CAIP2,
      rawRequestSha256: local.requestSha256,
      requestDigest: resource.requestHash,
    },
    submission: {
      launchId: resource.launchId,
      requestId: resource.requestId,
      status: resource.status,
      idempotencyKeySha256: sha256(Buffer.from(firstSubmit.idempotencyKey, "utf8")),
    },
    safety: {
      apiCredentialRecorded: false,
      rawRequestRecorded: false,
      transactionCalldataRecorded: false,
      walletSignatureObserved: false,
      rawTransactionRecorded: false,
      transactionBroadcastObserved: false,
    },
    observedAt,
  };
  const receipt = {
    ...preimage,
    recoveryDigest: framedSha256(RECOVERY_SCHEMA, preimage),
  };
  validateCleanRoomRecoveryReceipt(receipt);
  if (typeof input.apiKey === "string") {
    requireValue(!canonicalizeJson(receipt).includes(input.apiKey),
      "API_KEY_LEAKED_TO_RECOVERY");
  }
  return receipt;
}

function validateCleanRoomRecoveryReceipt(value) {
  exactKeys(value, [
    "schemaVersion", "producer", "release", "request", "submission", "safety",
    "observedAt", "recoveryDigest",
  ], "clean_room_recovery");
  requireValue(value.schemaVersion === RECOVERY_SCHEMA, "RECOVERY_SCHEMA_INVALID");
  validateProducerProvenance(value.producer);
  exactKeys(value.release, [
    "repository", "tag", "version", "sourceCommit", "sourceTree",
    "reviewedCoordinateSha256", "machineContractBindingSha256", "tarballSha256",
    "checksumSha256", "sbomSha256", "manifestSha256",
  ], "recovery_release");
  requireValue(value.release.repository === RELEASE_REPOSITORY
    && value.release.tag === RELEASE_TAG && value.release.version === RELEASE_VERSION
    && COMMIT.test(value.release.sourceCommit ?? "")
    && COMMIT.test(value.release.sourceTree ?? "")
    && [
      value.release.reviewedCoordinateSha256,
      value.release.machineContractBindingSha256,
      value.release.tarballSha256,
      value.release.checksumSha256,
      value.release.sbomSha256,
      value.release.manifestSha256,
    ].every((digest) => SHA256.test(digest ?? "")),
  "RECOVERY_RELEASE_INVALID");
  exactKeys(value.request,
    ["chainId", "caip2", "rawRequestSha256", "requestDigest"], "recovery_request");
  requireValue(value.request.chainId === CHAIN_ID && value.request.caip2 === CAIP2
    && SHA256.test(value.request.rawRequestSha256 ?? "")
    && SHA256.test(value.request.requestDigest ?? ""),
  "RECOVERY_REQUEST_INVALID");
  exactKeys(value.submission,
    ["launchId", "requestId", "status", "idempotencyKeySha256"], "recovery_submission");
  requireValue(UUID.test(value.submission.launchId ?? "")
    && UUID.test(value.submission.requestId ?? "")
    && RECOVERY_STATUSES.has(value.submission.status)
    && SHA256.test(value.submission.idempotencyKeySha256 ?? ""),
  "RECOVERY_SUBMISSION_INVALID");
  exactKeys(value.safety, [
    "apiCredentialRecorded", "rawRequestRecorded", "transactionCalldataRecorded",
    "walletSignatureObserved", "rawTransactionRecorded", "transactionBroadcastObserved",
  ], "recovery_safety");
  requireValue(Object.values(value.safety).every((entry) => entry === false),
    "RECOVERY_SAFETY_INVALID");
  requireValue(Number.isFinite(Date.parse(value.observedAt)) && value.observedAt.endsWith("Z"),
    "RECOVERY_OBSERVED_AT_INVALID");
  requireValue(SHA256.test(value.recoveryDigest ?? ""), "RECOVERY_DIGEST_INVALID");
  const preimage = { ...value };
  delete preimage.recoveryDigest;
  requireValue(value.recoveryDigest === framedSha256(RECOVERY_SCHEMA, preimage),
    "RECOVERY_DIGEST_MISMATCH");
  return value;
}

function buildCleanRoomEvidence(input) {
  const { prepared, request, local, remote, firstSubmit, replaySubmit, status, producer, recovery } = input;
  validatePrepared(prepared);
  assertLocalValidation(local);
  validateProducerProvenance(producer);
  validateCleanRoomRecoveryReceipt(recovery);
  const releaseAsset = (name) => prepared.release.assets.find((asset) => asset.name === name);
  requireValue(request?.schemaVersion === REQUEST_SCHEMA
    && request.chainId === CHAIN_ID && request.caip2 === CAIP2,
  "REQUEST_CHAIN_INVALID");
  requireValue(REQUIRE_NATIVE20
    ? request.funding?.mode === "wallet-transaction-value" && /^[1-9][0-9]{0,77}$/u.test(request.funding.valueWei)
    : request.funding?.mode === "none" && request.funding.valueWei === "0",
  "REQUEST_FUNDING_INVALID");
  requireValue(REQUIRE_NATIVE20
    ? request.liquidityModel?.model === "project-provided-liquidity"
      && request.liquidityModel.declaredLaunchState === "liquidity-provided-by-launch"
      && canonicalizeJson(request.liquidityModel.targetIds) === '["initializer"]'
    : request.liquidityModel?.model === "none-empty-pool"
      && request.liquidityModel.declaredLaunchState === "pool-initialized-empty"
      && Array.isArray(request.liquidityModel.targetIds)
      && request.liquidityModel.targetIds.length === 0,
  "REQUEST_LIQUIDITY_INVALID");
  requireValue(remote?.remoteValidation === true && remote.apiVersion === "v4"
    && remote.chainId === CHAIN_ID && remote.caip2 === CAIP2
    && remote.requestSha256 === local.requestSha256,
  "REMOTE_VALIDATION_INVALID");
  const capabilities = remote.capabilities;
  requireValue(capabilities?.apiVersion === "v4"
    && capabilities.chain?.id === CHAIN_ID && capabilities.chain.caip2 === CAIP2
    && capabilities.readiness?.status === "ready"
    && capabilities.safety?.walletSignatureProduced === false
    && capabilities.safety?.transactionBroadcast === false
    && capabilities.walletHandoff?.separateWalletSignatureRequired === true,
  "REMOTE_CAPABILITIES_INVALID");
  exactJson(request.chainDeployment, capabilities.chainDeployment,
    "REQUEST_DEPLOYMENT_CAPABILITIES_DRIFT");
  exactJson(request.profile, capabilities.profile, "REQUEST_PROFILE_CAPABILITIES_DRIFT");
  requireValue(request.chainDeploymentDescriptorDigest
      === capabilities.chainDeploymentDescriptorDigest,
  "REQUEST_DEPLOYMENT_DIGEST_DRIFT");
  const preflight = remote.preflight;
  const expectedRequestDigest = framedSha256(REQUEST_DIGEST_DOMAIN, request);
  requireValue(preflight?.chainId === CHAIN_ID && preflight.caip2 === CAIP2
    && preflight.rawRequestSha256 === local.requestSha256
    && preflight.requestHash === expectedRequestDigest
    && preflight.chainDeploymentDescriptorDigest === capabilities.chainDeploymentDescriptorDigest
    && preflight.profile?.profileDigest === capabilities.profile.profileDigest
    && (REQUIRE_NATIVE20 ? preflight.disposition === "supported_with_warnings" : preflight.disposition === "supported")
    && preflight.launchEligibility?.deployable === true
    && preflight.launchEligibility?.routable === !REQUIRE_NATIVE20
    && preflight.quotaConsumed === false && preflight.nonceAllocated === false
    && preflight.persisted === false && preflight.walletSignatureRequiredLater === true
    && preflight.walletBroadcastByService === false,
  "REMOTE_PREFLIGHT_INVALID");
  exactJson(preflight.profile, capabilities.profile, "PREFLIGHT_PROFILE_DRIFT");
  for (const [result, code] of [
    [firstSubmit, "FIRST_SUBMIT_INVALID"],
    [replaySubmit, "REPLAY_SUBMIT_INVALID"],
  ]) {
    requireValue(result?.apiVersion === "v4" && result.chainId === CHAIN_ID
      && result.caip2 === CAIP2 && result.requestSha256 === local.requestSha256
      && typeof result.idempotencyKey === "string" && result.idempotencyKey.length >= 16,
    code);
    requireSameResourceBinding(result.resource, capabilities, code);
    requireValue(result.resource.requestHash === preflight.requestHash
      && result.resource.rawRequestSha256 === local.requestSha256, code);
  }
  requireValue(firstSubmit.idempotencyKey === replaySubmit.idempotencyKey,
    "IDEMPOTENCY_KEY_REPLAY_DRIFT");
  requireValue(firstSubmit.resource.launchId === replaySubmit.resource.launchId
    && firstSubmit.resource.requestId === replaySubmit.resource.requestId,
  "IDEMPOTENCY_LAUNCH_REPLAY_DRIFT");
  requireValue(firstSubmit.resource.requestHash === replaySubmit.resource.requestHash,
    "IDEMPOTENCY_REQUEST_DIGEST_REPLAY_DRIFT");
  exactJson(recovery.producer, producer, "RECOVERY_PRODUCER_DRIFT");
  requireValue(recovery.release.sourceCommit === prepared.release.source.commitSha
    && recovery.release.sourceTree === prepared.release.source.treeSha
    && recovery.release.reviewedCoordinateSha256
      === prepared.release.reviewedCoordinate.sha256
    && recovery.release.machineContractBindingSha256
      === prepared.release.machineContractBinding.sha256
    && recovery.release.tarballSha256 === releaseAsset(RELEASE_NAMES.tarball)?.sha256
    && recovery.release.checksumSha256 === releaseAsset(RELEASE_NAMES.checksum)?.sha256
    && recovery.release.sbomSha256 === releaseAsset(RELEASE_NAMES.sbom)?.sha256
    && recovery.release.manifestSha256 === releaseAsset(RELEASE_NAMES.manifest)?.sha256
    && recovery.request.rawRequestSha256 === local.requestSha256
    && recovery.request.requestDigest === firstSubmit.resource.requestHash
    && recovery.submission.launchId === firstSubmit.resource.launchId
    && recovery.submission.requestId === firstSubmit.resource.requestId
    && recovery.submission.idempotencyKeySha256
      === sha256(Buffer.from(firstSubmit.idempotencyKey, "utf8")),
  "RECOVERY_EVIDENCE_BINDING_DRIFT");
  const resource = status?.resource;
  requireValue(status?.apiVersion === "v4" && status.chainId === CHAIN_ID
    && status.caip2 === CAIP2 && status.stopped === true && status.terminal === false
    && status.walletHandoffReady === true
    && status.walletHandoffStage === "router-transaction-required"
    && resource?.status === "wallet_action_required"
    && resource.launchId === firstSubmit.resource.launchId
    && resource.requestId === firstSubmit.resource.requestId
    && resource.requestHash === preflight.requestHash
    && resource.rawRequestSha256 === local.requestSha256
    && resource.onchain === null && resource.failure === null,
  "WALLET_ACTION_STATUS_INVALID");
  requireSameResourceBinding(resource, capabilities, "STATUS_RESOURCE_BINDING_INVALID");
  const transaction = resource.walletTransaction;
  requireValue(transaction?.schemaVersion === TRANSACTION_SCHEMA
    && transaction.chainId === CHAIN_ID && transaction.caip2 === CAIP2
    && transaction.apiVersion === "v4"
    && transaction.from?.toLowerCase() === request.launchWallet.toLowerCase()
    && transaction.to === capabilities.chainDeployment.contracts.programmableLaunchStampRouter.address
    && transaction.valueWei === request.funding.valueWei
    && transaction.selector === "0xe5f6b8cd"
    && HEX_DATA.test(transaction.calldata ?? "")
    && transaction.calldata.startsWith(transaction.selector)
    && SHA256.test(transaction.transactionPreimageHash ?? "")
    && transaction.transactionPreimageHash === resource.walletTransactionPreimageHash
    && transaction.chainDeploymentDescriptorDigest
      === capabilities.chainDeploymentDescriptorDigest
    && transaction.profile?.profileDigest === capabilities.profile.profileDigest
    && !Object.hasOwn(transaction, "walletSignature")
    && !Object.hasOwn(transaction, "signedTransaction")
    && !Object.hasOwn(transaction, "rawTransaction")
    && !Object.hasOwn(transaction, "transactionHash"),
  "EXACT_WALLET_TRANSACTION_INVALID");
  exactJson(transaction.chainDeployment, capabilities.chainDeployment,
    "TRANSACTION_DEPLOYMENT_DRIFT");
  exactJson(transaction.profile, capabilities.profile, "TRANSACTION_PROFILE_DRIFT");
  exactJson(transaction.finalityPolicy, capabilities.chainDeployment.finality,
    "TRANSACTION_FINALITY_DRIFT");
  const transactionPreimage = { ...transaction };
  delete transactionPreimage.transactionPreimageHash;
  requireValue(transaction.transactionPreimageHash === framedSha256(
    TRANSACTION_DIGEST_DOMAIN,
    transactionPreimage,
  ), "TRANSACTION_PREIMAGE_DIGEST_MISMATCH");
  const profilePreimage = { ...capabilities.profile };
  delete profilePreimage.profileDigest;
  requireValue(capabilities.profile.profileDigest === framedSha256(
    capabilities.profile.schemaVersion,
    profilePreimage,
  ), "PROFILE_DIGEST_MISMATCH");
  let native20 = null;
  if (REQUIRE_NATIVE20) {
    exactJson(request.profile, EXPECTED_PROFILE, "NATIVE20_PROFILE_INVALID");
    const plan = NORMALIZE_FUNDING_PLAN(request.fundingPlan, request.funding);
    requireValue(plan.capitalSource === "buyer-funded" && plan.pricingModel === "concentrated-liquidity"
      && plan.launchMode === "fund-and-launch" && plan.nativeAllocations.initialBuyWei !== "0"
      && plan.maxLaunchValueWei === plan.nativeAllocations.initialBuyWei
      && ["initialLiquidityWei", "reserveWei", "otherLaunchValueWei"].every(key => plan.nativeAllocations[key] === "0"),
    "NATIVE20_FUNDING_PLAN_INVALID");
    exactJson(resource.fundingPlan, plan, "NATIVE20_RESOURCE_FUNDING_PLAN_DRIFT");
    exactJson(resource.funding, request.funding, "NATIVE20_RESOURCE_FUNDING_DRIFT");
    exactJson(transaction.commitments, resource.commitments, "NATIVE20_TRANSACTION_COMMITMENTS_DRIFT");
    requireValue(request.launchIntentHash === resource.commitments?.launchIntent,
      "NATIVE20_LAUNCH_INTENT_DRIFT");
    const admission = resource.admissionReceipt;
    requireValue(plainObject(admission)
      && ["supported", "supported_with_warnings"].includes(admission.disposition)
      && admission.requestHash === resource.requestHash
      && admission.rawRequestSha256 === resource.rawRequestSha256
      && admission.profileDigest === resource.profile.profileDigest,
    "NATIVE20_ADMISSION_BINDING_INVALID");
    exactJson(admission.commitments, resource.commitments, "NATIVE20_ADMISSION_COMMITMENTS_DRIFT");
    const { receiptDigest, ...admissionPreimage } = admission;
    requireValue(receiptDigest === framedSha256(admission.schemaVersion, admissionPreimage),
      "NATIVE20_ADMISSION_DIGEST_INVALID");
    requireValue(plainObject(resource.preparedArtifact), "NATIVE20_PREPARED_ARTIFACT_REQUIRED");
    const proof = ASSERT_FEE_REVIEW(resource.feeReview, resource);
    requireValue(proof.creatorBuyFeeBps === 0 && proof.creatorSellFeeBps === 0
      && proof.moduleTargetId === null && proof.poolKey.fee === 0 && proof.poolKey.tickSpacing === 60,
    "NATIVE20_EXAMPLE_FEE_CONFIGURATION_INVALID");
    requireValue(resource.controller?.address === request.launchWallet, "NATIVE20_CONTROLLER_BINDING_INVALID");
    const initialBuyReview = ASSERT_INITIAL_BUY_REVIEW(resource.initialBuyReview, resource);
    native20 = { feeReview: structuredClone(proof), initialBuyReview: structuredClone(initialBuyReview), fundingPlan: structuredClone(plan),
      handoff: { preparedArtifactHash: proof.preparedArtifactHash, graphSha256: proof.graphSha256,
        verificationBundleSha256: proof.verificationBundleSha256, launchIntentHash: request.launchIntentHash,
        admissionReceiptDigest: receiptDigest, feeReviewDigest: admission.feeReviewDigest,
        initialBuyReviewDigest: admission.initialBuyReviewDigest, admissionIssuedAt: admission.issuedAt,
        launchWallet: request.launchWallet } };
  }
  const observedAt = input.observedAt ?? new Date().toISOString();
  requireValue(Number.isFinite(Date.parse(observedAt)) && observedAt.endsWith("Z"),
    "OBSERVED_AT_INVALID");
  const preimage = {
    schemaVersion: CLEAN_ROOM_SCHEMA,
    producer: structuredClone(producer),
    release: {
      repository: RELEASE_REPOSITORY,
      tag: RELEASE_TAG,
      version: RELEASE_VERSION,
      sourceCommit: prepared.release.source.commitSha,
      sourceTree: prepared.release.source.treeSha,
      reviewedCoordinateSha256: prepared.release.reviewedCoordinate.sha256,
      machineContractBindingSha256: prepared.release.machineContractBinding.sha256,
      tarballSha256: releaseAsset(RELEASE_NAMES.tarball)?.sha256,
      checksumSha256: releaseAsset(RELEASE_NAMES.checksum)?.sha256,
      sbomSha256: releaseAsset(RELEASE_NAMES.sbom)?.sha256,
      manifestSha256: releaseAsset(RELEASE_NAMES.manifest)?.sha256,
      attestationsVerified: true,
      signerWorkflow: RELEASE_SIGNER_WORKFLOW,
    },
    request: {
      chainId: CHAIN_ID,
      caip2: CAIP2,
      rawRequestSha256: local.requestSha256,
      requestDigest: preflight.requestHash,
      idempotencyKeySha256: sha256(Buffer.from(firstSubmit.idempotencyKey, "utf8")),
    },
    walletHandoff: {
      launchId: resource.launchId,
      requestId: resource.requestId,
      status: resource.status,
      chainDeploymentId: resource.chainDeploymentId,
      chainDeploymentDescriptorDigest: resource.chainDeploymentDescriptorDigest,
      profileDigest: resource.profile.profileDigest,
      transactionPreimageHash: transaction.transactionPreimageHash,
      transactionTarget: transaction.to,
      transactionValueWei: transaction.valueWei,
      transactionCalldataSha256: sha256(Buffer.from(transaction.calldata, "utf8")),
      ...(native20?.handoff ?? {}),
    },
    replay: {
      identicalIdempotencyKey: true,
      sameLaunchId: true,
      sameRequestDigest: true,
    },
    recovery: {
      recoveryDigest: recovery.recoveryDigest,
    },
    safety: {
      walletSignatureObserved: false,
      transactionBroadcastObserved: false,
      onchainEvidenceObserved: false,
      apiCredentialRecorded: false,
      rawRequestRecorded: false,
      rawTransactionRecorded: false,
    },
    observedAt,
    ...(native20 === null ? {} : { feeReview: native20.feeReview, initialBuyReview: native20.initialBuyReview, fundingPlan: native20.fundingPlan }),
  };
  const evidence = {
    ...preimage,
    evidenceDigest: framedSha256(CLEAN_ROOM_SCHEMA, preimage),
  };
  validateCleanRoomEvidence(evidence);
  if (typeof input.apiKey === "string") {
    requireValue(!canonicalizeJson(evidence).includes(input.apiKey), "API_KEY_LEAKED_TO_EVIDENCE");
  }
  return evidence;
}

function validateCleanRoomEvidence(value) {
  exactKeys(value, [
    "schemaVersion", "producer", "release", "request", "walletHandoff", "replay",
    "recovery", "safety", "observedAt", "evidenceDigest",
    ...(REQUIRE_NATIVE20 ? ["feeReview", "initialBuyReview", "fundingPlan"] : []),
  ], "clean_room_evidence");
  requireValue(value.schemaVersion === CLEAN_ROOM_SCHEMA, "EVIDENCE_SCHEMA_INVALID");
  validateProducerProvenance(value.producer);
  exactKeys(value.release, [
    "repository", "tag", "version", "sourceCommit", "sourceTree", "tarballSha256",
    "checksumSha256", "sbomSha256", "manifestSha256", "reviewedCoordinateSha256",
    "machineContractBindingSha256", "attestationsVerified", "signerWorkflow",
  ], "evidence_release");
  requireValue(value.release.repository === RELEASE_REPOSITORY
    && value.release.tag === RELEASE_TAG && value.release.version === RELEASE_VERSION
    && COMMIT.test(value.release.sourceCommit ?? "") && COMMIT.test(value.release.sourceTree ?? "")
    && SHA256.test(value.release.tarballSha256 ?? "")
    && SHA256.test(value.release.checksumSha256 ?? "")
    && SHA256.test(value.release.sbomSha256 ?? "")
    && SHA256.test(value.release.manifestSha256 ?? "")
    && SHA256.test(value.release.reviewedCoordinateSha256 ?? "")
    && SHA256.test(value.release.machineContractBindingSha256 ?? "")
    && value.release.attestationsVerified === true
    && value.release.signerWorkflow === RELEASE_SIGNER_WORKFLOW,
  "EVIDENCE_RELEASE_INVALID");
  exactKeys(value.request, [
    "chainId", "caip2", "rawRequestSha256", "requestDigest", "idempotencyKeySha256",
  ], "evidence_request");
  requireValue(value.request.chainId === CHAIN_ID && value.request.caip2 === CAIP2
    && SHA256.test(value.request.rawRequestSha256 ?? "")
    && SHA256.test(value.request.requestDigest ?? "")
    && SHA256.test(value.request.idempotencyKeySha256 ?? ""),
  "EVIDENCE_REQUEST_INVALID");
  exactKeys(value.walletHandoff, [
    "launchId", "requestId", "status", "chainDeploymentId",
    "chainDeploymentDescriptorDigest", "profileDigest", "transactionPreimageHash",
    "transactionTarget", "transactionValueWei", "transactionCalldataSha256",
    ...(REQUIRE_NATIVE20 ? ["preparedArtifactHash", "graphSha256", "verificationBundleSha256",
      "launchIntentHash", "admissionReceiptDigest", "feeReviewDigest", "initialBuyReviewDigest", "admissionIssuedAt", "launchWallet"] : []),
  ], "evidence_wallet_handoff");
  requireValue(UUID.test(value.walletHandoff.launchId ?? "")
    && UUID.test(value.walletHandoff.requestId ?? "")
    && value.walletHandoff.status === "wallet_action_required"
    && value.walletHandoff.chainDeploymentId === "robinhood-mainnet-custom-launch-v1"
    && /^0x[0-9a-f]{64}$/u.test(value.walletHandoff.chainDeploymentDescriptorDigest ?? "")
    && SHA256.test(value.walletHandoff.profileDigest ?? "")
    && (!REQUIRE_NATIVE20 || value.walletHandoff.profileDigest === EXPECTED_PROFILE.profileDigest)
    && SHA256.test(value.walletHandoff.transactionPreimageHash ?? "")
    && ADDRESS.test(value.walletHandoff.transactionTarget ?? "")
    && (REQUIRE_NATIVE20 ? /^[1-9][0-9]{0,77}$/u.test(value.walletHandoff.transactionValueWei ?? "")
      : value.walletHandoff.transactionValueWei === "0")
    && SHA256.test(value.walletHandoff.transactionCalldataSha256 ?? ""),
  "EVIDENCE_WALLET_HANDOFF_INVALID");
  if (REQUIRE_NATIVE20) {
    const handoff = value.walletHandoff;
    requireValue([handoff.preparedArtifactHash, handoff.graphSha256, handoff.verificationBundleSha256,
      handoff.launchIntentHash, handoff.admissionReceiptDigest, handoff.feeReviewDigest, handoff.initialBuyReviewDigest]
      .every((digest) => SHA256.test(digest ?? ""))
      && ADDRESS.test(handoff.launchWallet ?? "")
      && Number.isFinite(Date.parse(handoff.admissionIssuedAt)) && handoff.admissionIssuedAt.endsWith("Z")
      && Date.parse(handoff.admissionIssuedAt) <= Date.parse(value.observedAt),
    "NATIVE20_EVIDENCE_HANDOFF_INVALID");
    // Reverification checks the redacted proof's integrity and captured bindings. The
    // workflow attestation authenticates its producer; this does not recreate admission.
    const proof = ASSERT_FEE_REVIEW(value.feeReview, {
      admissionReceipt: { feeReviewDigest: handoff.feeReviewDigest },
      commitments: { verification: handoff.verificationBundleSha256 }, preparedArtifact: null,
    });
    requireValue(proof.preparedArtifactHash === handoff.preparedArtifactHash
      && proof.graphSha256 === handoff.graphSha256
      && proof.creatorBuyFeeBps === 0 && proof.creatorSellFeeBps === 0
      && proof.moduleTargetId === null && proof.poolKey.fee === 0 && proof.poolKey.tickSpacing === 60,
    "NATIVE20_EVIDENCE_FEE_BINDING_INVALID");
    const plan = NORMALIZE_FUNDING_PLAN(value.fundingPlan, { valueWei: handoff.transactionValueWei });
    requireValue(plan.capitalSource === "buyer-funded" && plan.pricingModel === "concentrated-liquidity"
      && plan.launchMode === "fund-and-launch" && plan.nativeAllocations.initialBuyWei !== "0"
      && plan.maxLaunchValueWei === plan.nativeAllocations.initialBuyWei
      && ["initialLiquidityWei", "reserveWei", "otherLaunchValueWei"].every(key => plan.nativeAllocations[key] === "0"),
    "NATIVE20_EVIDENCE_FUNDING_PLAN_INVALID");
    ASSERT_INITIAL_BUY_REVIEW(value.initialBuyReview, {
      controller: { address: handoff.launchWallet }, fundingPlan: plan, funding: { valueWei: handoff.transactionValueWei },
      feeReview: proof, commitments: { verification: handoff.verificationBundleSha256 }, preparedArtifact: null,
      admissionReceipt: { initialBuyReviewDigest: handoff.initialBuyReviewDigest, issuedAt: handoff.admissionIssuedAt },
    });
  }
  exactKeys(value.replay,
    ["identicalIdempotencyKey", "sameLaunchId", "sameRequestDigest"], "evidence_replay");
  requireValue(Object.values(value.replay).every((entry) => entry === true),
    "EVIDENCE_REPLAY_INVALID");
  exactKeys(value.recovery, ["recoveryDigest"], "evidence_recovery");
  requireValue(SHA256.test(value.recovery.recoveryDigest ?? ""),
    "EVIDENCE_RECOVERY_INVALID");
  exactKeys(value.safety, [
    "walletSignatureObserved", "transactionBroadcastObserved", "onchainEvidenceObserved",
    "apiCredentialRecorded", "rawRequestRecorded", "rawTransactionRecorded",
  ], "evidence_safety");
  requireValue(Object.values(value.safety).every((entry) => entry === false),
    "EVIDENCE_SAFETY_INVALID");
  requireValue(Number.isFinite(Date.parse(value.observedAt)) && value.observedAt.endsWith("Z"),
    "EVIDENCE_OBSERVED_AT_INVALID");
  requireValue(SHA256.test(value.evidenceDigest ?? ""), "EVIDENCE_DIGEST_INVALID");
  const preimage = { ...value };
  delete preimage.evidenceDigest;
  requireValue(value.evidenceDigest === framedSha256(CLEAN_ROOM_SCHEMA, preimage),
    "EVIDENCE_DIGEST_MISMATCH");
  return value;
}

async function runCleanRoom(options) {
  requireValue(process.version === NODE_VERSION, "NODE_VERSION_INVALID");
  const reviewedRelease = await loadReviewedReleaseCoordinate();
  const workspace = path.resolve(options.workspace);
  const preparedPath = path.join(workspace, "prepared.json");
  await assertRegularFile(preparedPath, "PREPARED_HANDOFF", 4 * 1024 * 1024);
  const preparedBytes = await readFile(preparedPath);
  const prepared = validatePrepared(parseJsonBytes(preparedBytes, "PREPARED_HANDOFF"));
  requireValue(canonicalJsonBytes(prepared).equals(preparedBytes), "PREPARED_HANDOFF_NOT_CANONICAL");
  requireValue(prepared.release.reviewedCoordinate.sha256
      === reviewedRelease.coordinateSha256,
  "PREPARED_REVIEWED_COORDINATE_CHANGED");
  const releaseFromBytes = validateReleaseFiles(await readReleaseFiles(path.join(workspace, "release")));
  const preparedReleaseBytes = { ...prepared.release };
  delete preparedReleaseBytes.attestation;
  delete preparedReleaseBytes.reviewedCoordinate;
  exactJson(releaseFromBytes, preparedReleaseBytes, "PREPARED_RELEASE_BYTES_CHANGED");
  assertReleaseMatchesReviewedCoordinate(releaseFromBytes, reviewedRelease.coordinate);
  const installDirectory = path.join(workspace, "install");
  const projectDirectory = path.join(workspace, "project");
  requireValue(await directoryDigest(installDirectory) === prepared.bindings.installTreeSha256,
    "INSTALL_TREE_CHANGED");
  requireValue(await directoryDigest(projectDirectory) === prepared.bindings.projectTreeSha256,
    "PROJECT_TREE_CHANGED");
  const apiKey = process.env.PROGRAMMABLE_API_KEY;
  requireValue(typeof apiKey === "string" && apiKey.length >= 20 && apiKey.length <= 4096
    && !/[\s\u0000-\u001f\u007f]/u.test(apiKey), "DEDICATED_API_KEY_INVALID");
  const packageRoot = path.join(installDirectory, "node_modules", "@programmable", "launch");
  const cliPath = path.join(packageRoot, "bin", "programmable-launch.mjs");
  const configPath = path.join(projectDirectory, "programmable-launch.config.json");
  const launchPath = path.join(projectDirectory, "launch.json");
  const receiptPath = path.join(projectDirectory, "launch.receipt.json");
  const localValidationPath = path.join(projectDirectory, ".clean-room-local-validation.json");
  const [configBytes, launchBytes, receiptBytes, localBytes] = await Promise.all([
    readFile(configPath), readFile(launchPath), readFile(receiptPath), readFile(localValidationPath),
  ]);
  requireValue(sha256(configBytes) === prepared.bindings.configSha256
    && sha256(launchBytes) === prepared.bindings.launchSha256
    && sha256(receiptBytes) === prepared.bindings.receiptSha256
    && sha256(localBytes) === prepared.bindings.localValidationSha256,
  "PREPARED_FILE_BINDING_CHANGED");
  const request = parseJsonBytes(launchBytes, "PREPARED_REQUEST");
  const local = parseJsonBytes(localBytes, "LOCAL_VALIDATION");
  const idempotencyKey = `${IDEMPOTENCY_PREFIX}${sha256(launchBytes).slice("sha256:".length)}`;
  const stateDirectory = path.join(workspace, "private-submit-state");
  const output = path.resolve(options.output);
  const recoveryOutput = path.resolve(options.recoveryOutput);
  requireValue(output !== recoveryOutput, "OUTPUT_PATHS_MUST_BE_DISTINCT");
  requireValue(output !== workspace && !output.startsWith(`${workspace}${path.sep}`)
    && recoveryOutput !== workspace
    && !recoveryOutput.startsWith(`${workspace}${path.sep}`),
  "OUTPUT_PATHS_MUST_BE_OUTSIDE_PRIVATE_WORKSPACE");
  await Promise.all([
    assertPathAbsent(output, "EVIDENCE_OUTPUT"),
    assertPathAbsent(recoveryOutput, "RECOVERY_OUTPUT"),
  ]);
  const producer = producerProvenanceFromEnvironment();
  let evidence;
  let recovery;
  try {
    const remote = await runCli(cliPath, [
      "validate", launchPath, "--config", configPath, "--remote",
      "--max-attempts", "5", "--timeout-ms", "30000",
    ], { cwd: projectDirectory, apiKey, stage: "REMOTE_VALIDATE" });
    const submitArgs = [
      "submit", launchPath, "--config", configPath,
      "--idempotency-key", idempotencyKey, "--state-dir", stateDirectory,
      "--max-attempts", "5", "--timeout-ms", "30000",
    ];
    const firstSubmit = await runCli(cliPath, submitArgs, {
      cwd: projectDirectory, apiKey, stage: "SUBMIT",
    });
    recovery = buildCleanRoomRecoveryReceipt({
      prepared,
      local,
      firstSubmit,
      producer,
      apiKey,
    });
    await writeFile(recoveryOutput, canonicalJsonBytes(recovery), {
      flag: "wx",
      mode: 0o600,
    });
    const replaySubmit = await runCli(cliPath, submitArgs, {
      cwd: projectDirectory, apiKey, stage: "SUBMIT_REPLAY",
    });
    const status = await runCli(cliPath, [
      "status", firstSubmit.resource?.launchId,
      "--api-version", "4", "--chain-id", CHAIN_ID,
      "--watch", "--until", "authorized", "--poll-ms", "1000",
      "--max-attempts", "5", "--timeout-ms", "30000",
    ], {
      cwd: projectDirectory,
      apiKey,
      stage: "STATUS_WALLET_ACTION_REQUIRED",
      timeout: 900_000,
    });
    evidence = buildCleanRoomEvidence({
      prepared, request, local, remote, firstSubmit, replaySubmit, status, producer, recovery, apiKey,
    });
  } finally {
    await rm(stateDirectory, { recursive: true, force: true, maxRetries: 3 });
  }
  requireValue(await directoryDigest(installDirectory) === prepared.bindings.installTreeSha256,
    "INSTALL_TREE_CHANGED_DURING_RUN");
  requireValue(await directoryDigest(projectDirectory) === prepared.bindings.projectTreeSha256,
    "PROJECT_TREE_CHANGED_DURING_RUN");
  await verifyRecoveryFile(recoveryOutput);
  await writeFile(output, canonicalJsonBytes(evidence), { flag: "wx", mode: 0o600 });
  return evidence;
}

async function verifyEvidenceFile(filePath) {
  await assertRegularFile(filePath, "EVIDENCE_FILE", 2 * 1024 * 1024);
  const bytes = await readFile(filePath);
  const evidence = validateCleanRoomEvidence(parseJsonBytes(bytes, "EVIDENCE_FILE"));
  requireValue(canonicalJsonBytes(evidence).equals(bytes), "EVIDENCE_FILE_NOT_CANONICAL");
  return evidence;
}

async function verifyRecoveryFile(filePath) {
  await assertRegularFile(filePath, "RECOVERY_FILE", 2 * 1024 * 1024);
  const bytes = await readFile(filePath);
  const receipt = validateCleanRoomRecoveryReceipt(parseJsonBytes(bytes, "RECOVERY_FILE"));
  requireValue(canonicalJsonBytes(receipt).equals(bytes), "RECOVERY_FILE_NOT_CANONICAL");
  return receipt;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  requireValue(new Set(["prepare", "run", "verify-evidence", "verify-recovery"]).has(command),
    "COMMAND_INVALID");
  requireValue(rest.length % 2 === 0, "ARGUMENTS_INVALID");
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    requireValue(/^--[a-z][a-z-]*$/u.test(flag ?? "") && typeof value === "string",
      "ARGUMENTS_INVALID");
    const key = flag.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    requireValue(!Object.hasOwn(options, key), "ARGUMENT_DUPLICATE");
    options[key] = value;
  }
  const allowed = command === "prepare"
    ? ["workspace", "image", "launchWallet", "imageUri", "websiteUrl", "xUrl", ...(REQUIRE_NATIVE20 ? ["initialBuyWei", "minimumTokensOut", "maxGasCostWei"] : [])]
    : command === "run"
      ? ["workspace", "output", "recoveryOutput"]
      : ["input"];
  exactKeys(options, allowed, "arguments");
  return { command, options };
}

async function main(argv) {
  const { command, options } = parseArguments(argv);
  if (command === "prepare") await prepareCleanRoom(options);
  else if (command === "run") await runCleanRoom(options);
  else if (command === "verify-evidence") await verifyEvidenceFile(path.resolve(options.input));
  else await verifyRecoveryFile(path.resolve(options.input));
  process.stdout.write(`${command === "prepare"
    ? "PROGRAMMABLE_LAUNCH_V4_CLEAN_ROOM_PREPARED"
    : command === "run"
      ? "PROGRAMMABLE_LAUNCH_V4_WALLET_ACTION_REQUIRED"
      : command === "verify-evidence"
        ? "PROGRAMMABLE_LAUNCH_V4_CLEAN_ROOM_EVIDENCE_VALID"
        : "PROGRAMMABLE_LAUNCH_V4_CLEAN_ROOM_RECOVERY_VALID"}\n`);
}

return Object.freeze({
  CLEAN_ROOM_SCHEMA,
  PREPARED_SCHEMA,
  RECOVERY_SCHEMA,
  PRODUCER_SCHEMA,
  REVIEWED_RELEASE_COORDINATE_SCHEMA,
  REVIEWED_RELEASE_COORDINATE_PATH,
  RELEASE_REPOSITORY,
  RELEASE_MANIFEST_REPOSITORY,
  RELEASE_TAG,
  RELEASE_VERSION,
  RELEASE_SIGNER_WORKFLOW,
  PRODUCTION_REF,
  CHAIN_ID,
  CAIP2,
  canonicalJsonBytes,
  sha256,
  validateReleaseFiles,
  validateReviewedReleaseCoordinate,
  requireReviewedReleaseCoordinateReady,
  assertReleaseMatchesReviewedCoordinate,
  validateCleanRoomImage,
  prepareCleanRoom,
  validateProducerProvenance,
  buildCleanRoomRecoveryReceipt,
  validateCleanRoomRecoveryReceipt,
  buildCleanRoomEvidence,
  validateCleanRoomEvidence,
  runCleanRoom,
  verifyEvidenceFile,
  verifyRecoveryFile,
  main,
  CleanRoomError,
});
}

const defaultRunner = createCleanRoomRunner();
export const {
  CLEAN_ROOM_SCHEMA,
  PREPARED_SCHEMA,
  RECOVERY_SCHEMA,
  PRODUCER_SCHEMA,
  REVIEWED_RELEASE_COORDINATE_SCHEMA,
  REVIEWED_RELEASE_COORDINATE_PATH,
  RELEASE_REPOSITORY,
  RELEASE_MANIFEST_REPOSITORY,
  RELEASE_TAG,
  RELEASE_VERSION,
  RELEASE_SIGNER_WORKFLOW,
  PRODUCTION_REF,
  CHAIN_ID,
  CAIP2,
  canonicalJsonBytes,
  sha256,
  validateReleaseFiles,
  validateReviewedReleaseCoordinate,
  requireReviewedReleaseCoordinateReady,
  assertReleaseMatchesReviewedCoordinate,
  validateCleanRoomImage,
  prepareCleanRoom,
  validateProducerProvenance,
  buildCleanRoomRecoveryReceipt,
  validateCleanRoomRecoveryReceipt,
  buildCleanRoomEvidence,
  validateCleanRoomEvidence,
  runCleanRoom,
  verifyEvidenceFile,
  verifyRecoveryFile,
} = defaultRunner;
const { main, CleanRoomError } = defaultRunner;

const directInvocation = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (directInvocation) {
  main(process.argv.slice(2)).catch((error) => {
    const code = error instanceof CleanRoomError ? error.code : "CLEAN_ROOM_INTERNAL_ERROR";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
