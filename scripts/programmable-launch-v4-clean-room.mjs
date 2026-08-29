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
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  canonicalizeJson,
  parseStrictJson,
} from "../packages/launch/src/canonical-json.mjs";
import { decodeExactProjectImageV4 } from "../packages/launch/src/image-validation-v4.mjs";

export const CLEAN_ROOM_SCHEMA = "programmable.launch-v4-clean-room-evidence.v1";
export const PREPARED_SCHEMA = "programmable.launch-v4-clean-room-prepared.v1";
export const RELEASE_REPOSITORY = "programmablehq/PROGRAMMABLE";
export const RELEASE_MANIFEST_REPOSITORY = "programmablehq/programmable";
export const RELEASE_TAG = "programmable-launch-v4.0.0";
export const RELEASE_VERSION = "4.0.0";
export const RELEASE_SIGNER_WORKFLOW =
  "programmablehq/PROGRAMMABLE/.github/workflows/release-programmable-launch.yml";
export const PRODUCTION_REF = "refs/heads/production";
export const CHAIN_ID = "4663";
export const CAIP2 = "eip155:4663";

const NODE_VERSION = "v24.14.0";
const NPM_VERSION = "11.16.0";
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const HEX_DATA = /^0x(?:[0-9a-f]{2})+$/u;
const RELEASE_NAMES = Object.freeze({
  tarball: "programmable-launch-4.0.0.tgz",
  checksum: "programmable-launch-4.0.0.tgz.sha256",
  sbom: "programmable-launch-4.0.0.cdx.json",
  manifest: "programmable-launch-4.0.0.release.json",
});
const RELEASE_FILES = Object.freeze(Object.values(RELEASE_NAMES).sort());
const MAX_JSON_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5_242_880;
const execFileAsync = promisify(execFile);

class CleanRoomError extends Error {
  constructor(code) {
    super(code);
    this.name = "CleanRoomError";
    this.code = code;
  }
}

export function canonicalJsonBytes(value) {
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

export function sha256(bytes) {
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

export function validateReleaseFiles(files) {
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
      === "programmable.launch-cli-v4-release-binding.v1"
      && manifest.machineContractBinding.path
        === "docs/operations/releases/custom-launch-v4/cli-release-binding.json"
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
  return framedSha256("programmable.launch-v4-clean-room-tree.v1", entries);
}

export function validateCleanRoomImage(bytes) {
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

async function downloadAndVerifyRelease(releaseDirectory) {
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
  requireValue(value?.schemaVersion === "programmable.custom-launch-create-request.v4"
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

export async function prepareCleanRoom(options) {
  requireValue(!Object.hasOwn(process.env, "PROGRAMMABLE_API_KEY"),
    "PREPARE_REFUSES_PROGRAMMABLE_API_KEY");
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
  const release = await downloadAndVerifyRelease(releaseDirectory);
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
  await cp(path.join(packageRoot, "examples", "robinhood-v4-no-broadcast", "project"),
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
  await runCommand("npm", ["run", "build"], {
    stage: "PROJECT_BUILD",
    cwd: projectDirectory,
    timeout: 300_000,
    env: safeBaseEnv({
      PROGRAMMABLE_CHECKED_AT: checkedAt,
      PROGRAMMABLE_LAUNCH_NONCE: nonce,
      PROGRAMMABLE_LAUNCH_WALLET: launchWallet,
      PROGRAMMABLE_PROJECT_IMAGE_SOURCE_PATH: "assets/project-image",
      PROGRAMMABLE_PROJECT_IMAGE_URI: imageUri,
      PROGRAMMABLE_SOURCE_ORIGIN: "https://github.com/programmablehq/PROGRAMMABLE",
      PROGRAMMABLE_SOURCE_REVISION: release.source.commitSha,
      PROGRAMMABLE_WEBSITE_URL: websiteUrl,
      PROGRAMMABLE_X_URL: options.xUrl,
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
    "repository", "tag", "version", "source", "machineContractBinding", "assets", "attestation",
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
      === "programmable.launch-cli-v4-release-binding.v1"
      && value.release.machineContractBinding.path
        === "docs/operations/releases/custom-launch-v4/cli-release-binding.json"
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

export function buildCleanRoomEvidence(input) {
  const { prepared, request, local, remote, firstSubmit, replaySubmit, status } = input;
  validatePrepared(prepared);
  assertLocalValidation(local);
  requireValue(request?.schemaVersion === "programmable.custom-launch-create-request.v4"
    && request.chainId === CHAIN_ID && request.caip2 === CAIP2,
  "REQUEST_CHAIN_INVALID");
  requireValue(request.funding?.mode === "none" && request.funding.valueWei === "0",
    "REQUEST_FUNDING_INVALID");
  requireValue(request.liquidityModel?.model === "none-empty-pool"
    && request.liquidityModel.declaredLaunchState === "pool-not-initialized"
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
  const expectedRequestDigest = framedSha256("programmable.custom-launch-request.v4", request);
  requireValue(preflight?.chainId === CHAIN_ID && preflight.caip2 === CAIP2
    && preflight.rawRequestSha256 === local.requestSha256
    && preflight.requestHash === expectedRequestDigest
    && preflight.chainDeploymentDescriptorDigest === capabilities.chainDeploymentDescriptorDigest
    && preflight.profile?.profileDigest === capabilities.profile.profileDigest
    && preflight.disposition === "supported"
    && preflight.launchEligibility?.deployable === true
    && preflight.launchEligibility?.routable === true
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
  requireValue(transaction?.schemaVersion === "programmable.exact-wallet-transaction.v4"
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
    "programmable.exact-wallet-transaction-preimage.v4",
    transactionPreimage,
  ), "TRANSACTION_PREIMAGE_DIGEST_MISMATCH");
  const profilePreimage = { ...capabilities.profile };
  delete profilePreimage.profileDigest;
  requireValue(capabilities.profile.profileDigest === framedSha256(
    capabilities.profile.schemaVersion,
    profilePreimage,
  ), "PROFILE_DIGEST_MISMATCH");
  const observedAt = input.observedAt ?? new Date().toISOString();
  requireValue(Number.isFinite(Date.parse(observedAt)) && observedAt.endsWith("Z"),
    "OBSERVED_AT_INVALID");
  const releaseAsset = (name) => prepared.release.assets.find((asset) => asset.name === name);
  const preimage = {
    schemaVersion: CLEAN_ROOM_SCHEMA,
    release: {
      repository: RELEASE_REPOSITORY,
      tag: RELEASE_TAG,
      version: RELEASE_VERSION,
      sourceCommit: prepared.release.source.commitSha,
      sourceTree: prepared.release.source.treeSha,
      tarballSha256: releaseAsset(RELEASE_NAMES.tarball)?.sha256,
      checksumSha256: releaseAsset(RELEASE_NAMES.checksum)?.sha256,
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
    },
    replay: {
      identicalIdempotencyKey: true,
      sameLaunchId: true,
      sameRequestDigest: true,
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

export function validateCleanRoomEvidence(value) {
  exactKeys(value, [
    "schemaVersion", "release", "request", "walletHandoff", "replay", "safety",
    "observedAt", "evidenceDigest",
  ], "clean_room_evidence");
  requireValue(value.schemaVersion === CLEAN_ROOM_SCHEMA, "EVIDENCE_SCHEMA_INVALID");
  exactKeys(value.release, [
    "repository", "tag", "version", "sourceCommit", "sourceTree", "tarballSha256",
    "checksumSha256", "manifestSha256", "attestationsVerified", "signerWorkflow",
  ], "evidence_release");
  requireValue(value.release.repository === RELEASE_REPOSITORY
    && value.release.tag === RELEASE_TAG && value.release.version === RELEASE_VERSION
    && COMMIT.test(value.release.sourceCommit ?? "") && COMMIT.test(value.release.sourceTree ?? "")
    && SHA256.test(value.release.tarballSha256 ?? "")
    && SHA256.test(value.release.checksumSha256 ?? "")
    && SHA256.test(value.release.manifestSha256 ?? "")
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
  ], "evidence_wallet_handoff");
  requireValue(UUID.test(value.walletHandoff.launchId ?? "")
    && UUID.test(value.walletHandoff.requestId ?? "")
    && value.walletHandoff.status === "wallet_action_required"
    && value.walletHandoff.chainDeploymentId === "robinhood-mainnet-custom-launch-v1"
    && /^0x[0-9a-f]{64}$/u.test(value.walletHandoff.chainDeploymentDescriptorDigest ?? "")
    && SHA256.test(value.walletHandoff.profileDigest ?? "")
    && SHA256.test(value.walletHandoff.transactionPreimageHash ?? "")
    && ADDRESS.test(value.walletHandoff.transactionTarget ?? "")
    && value.walletHandoff.transactionValueWei === "0"
    && SHA256.test(value.walletHandoff.transactionCalldataSha256 ?? ""),
  "EVIDENCE_WALLET_HANDOFF_INVALID");
  exactKeys(value.replay,
    ["identicalIdempotencyKey", "sameLaunchId", "sameRequestDigest"], "evidence_replay");
  requireValue(Object.values(value.replay).every((entry) => entry === true),
    "EVIDENCE_REPLAY_INVALID");
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

export async function runCleanRoom(options) {
  requireValue(process.version === NODE_VERSION, "NODE_VERSION_INVALID");
  const workspace = path.resolve(options.workspace);
  const preparedPath = path.join(workspace, "prepared.json");
  await assertRegularFile(preparedPath, "PREPARED_HANDOFF", 4 * 1024 * 1024);
  const preparedBytes = await readFile(preparedPath);
  const prepared = validatePrepared(parseJsonBytes(preparedBytes, "PREPARED_HANDOFF"));
  requireValue(canonicalJsonBytes(prepared).equals(preparedBytes), "PREPARED_HANDOFF_NOT_CANONICAL");
  const releaseFromBytes = validateReleaseFiles(await readReleaseFiles(path.join(workspace, "release")));
  const preparedReleaseBytes = { ...prepared.release };
  delete preparedReleaseBytes.attestation;
  exactJson(releaseFromBytes, preparedReleaseBytes, "PREPARED_RELEASE_BYTES_CHANGED");
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
  const idempotencyKey = `programmable-v4-clean-room-${sha256(launchBytes).slice("sha256:".length)}`;
  const stateDirectory = path.join(workspace, "private-submit-state");
  let evidence;
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
      prepared, request, local, remote, firstSubmit, replaySubmit, status, apiKey,
    });
  } finally {
    await rm(stateDirectory, { recursive: true, force: true, maxRetries: 3 });
  }
  requireValue(await directoryDigest(installDirectory) === prepared.bindings.installTreeSha256,
    "INSTALL_TREE_CHANGED_DURING_RUN");
  requireValue(await directoryDigest(projectDirectory) === prepared.bindings.projectTreeSha256,
    "PROJECT_TREE_CHANGED_DURING_RUN");
  const output = path.resolve(options.output);
  await writeFile(output, canonicalJsonBytes(evidence), { flag: "wx", mode: 0o600 });
  return evidence;
}

export async function verifyEvidenceFile(filePath) {
  await assertRegularFile(filePath, "EVIDENCE_FILE", 2 * 1024 * 1024);
  const bytes = await readFile(filePath);
  const evidence = validateCleanRoomEvidence(parseJsonBytes(bytes, "EVIDENCE_FILE"));
  requireValue(canonicalJsonBytes(evidence).equals(bytes), "EVIDENCE_FILE_NOT_CANONICAL");
  return evidence;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  requireValue(new Set(["prepare", "run", "verify-evidence"]).has(command), "COMMAND_INVALID");
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
    ? ["workspace", "image", "launchWallet", "imageUri", "websiteUrl", "xUrl"]
    : command === "run"
      ? ["workspace", "output"]
      : ["input"];
  exactKeys(options, allowed, "arguments");
  return { command, options };
}

async function main(argv) {
  const { command, options } = parseArguments(argv);
  if (command === "prepare") await prepareCleanRoom(options);
  else if (command === "run") await runCleanRoom(options);
  else await verifyEvidenceFile(path.resolve(options.input));
  process.stdout.write(`${command === "prepare"
    ? "PROGRAMMABLE_LAUNCH_V4_CLEAN_ROOM_PREPARED"
    : command === "run"
      ? "PROGRAMMABLE_LAUNCH_V4_WALLET_ACTION_REQUIRED"
      : "PROGRAMMABLE_LAUNCH_V4_CLEAN_ROOM_EVIDENCE_VALID"}\n`);
}

const directInvocation = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (directInvocation) {
  main(process.argv.slice(2)).catch((error) => {
    const code = error instanceof CleanRoomError ? error.code : "CLEAN_ROOM_INTERNAL_ERROR";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
