import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]{0,77}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const HASH32 = /^0x[0-9a-f]{64}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const ARTIFACT_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]+$/u;

const INPUT_KEYS = Object.freeze([
  "approvalArtifactSchema",
  "approvalRelease",
  "implementation",
  "persistence",
  "queryContract",
  "registryProjection",
  "schemaVersion",
  "websiteSource",
]);

export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  throw new TypeError("Canonical JSON contains an unsupported value");
}

export function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalSha256(domain, value) {
  if (!/^programmable\.[a-z0-9.-]+\.v[1-9][0-9]*$/u.test(domain)) {
    throw new TypeError("Hash domain must be a versioned Programmable namespace");
  }
  return sha256Bytes(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.of(0),
    Buffer.from(canonicalJson(value), "utf8"),
  ]));
}

export async function deriveGenericLaunchReadModelContractV2(input, options) {
  const repoRoot = resolve(options?.repoRoot ?? process.cwd());
  const read = options?.readFile ?? readFile;
  const value = exactObject(input, INPUT_KEYS, "derivation input");
  if (value.schemaVersion
    !== "programmable.generic-launch-read-model-contract-derivation-input.v1") {
    throw new TypeError("Generic launch read-model derivation input is invalid");
  }

  const websiteSource = sourceIdentity(value.websiteSource, "Website source");
  if (options?.gitIdentity) {
    const actual = options.gitIdentity(repoRoot);
    if (actual.commit !== websiteSource.commit || actual.tree !== websiteSource.tree) {
      throw new TypeError("Website source identity does not match the checkout");
    }
  }

  const implementation = await localArtifactComponent(
    value.implementation,
    websiteSource,
    repoRoot,
    read,
    "implementation",
  );
  const persistence = await persistenceComponent(
    value.persistence,
    websiteSource,
    repoRoot,
    read,
  );
  const queryContract = await queryComponent(
    value.queryContract,
    websiteSource,
    repoRoot,
    read,
  );
  const approvalArtifactSchema = approvalSchemaComponent(value.approvalArtifactSchema);
  const approvalRelease = approvalReleaseComponent(
    value.approvalRelease,
    approvalArtifactSchema.source,
  );
  const registryProjection = await registryComponent(
    value.registryProjection,
    websiteSource,
    repoRoot,
    read,
  );

  const componentBindingHashes = Object.freeze({
    implementationBindingHash: canonicalSha256(
      "programmable.generic-launch-read-model-implementation-binding.v1",
      implementation,
    ),
    persistenceBindingHash: canonicalSha256(
      "programmable.generic-launch-read-model-persistence-binding.v1",
      persistence,
    ),
    queryContractBindingHash: canonicalSha256(
      "programmable.generic-launch-read-model-query-contract-binding.v1",
      queryContract,
    ),
    approvalArtifactSchemaBindingHash: canonicalSha256(
      "programmable.generic-launch-read-model-approval-schema-binding.v1",
      approvalArtifactSchema,
    ),
    approvalReleaseBindingHash: canonicalSha256(
      "programmable.generic-launch-read-model-approval-release-binding.v1",
      approvalRelease,
    ),
    registryProjectionBindingHash: canonicalSha256(
      "programmable.generic-launch-read-model-registry-projection-binding.v1",
      registryProjection,
    ),
  });
  const contract = Object.freeze({
    schemaVersion: "programmable.generic-launch-read-model-contract.v2",
    sourceLane: "generic.finalized-launch-v2",
    ...componentBindingHashes,
  });
  const readModelBindingHash = canonicalSha256(contract.schemaVersion, contract);
  const core = Object.freeze({
    schemaVersion: "programmable.generic-launch-read-model-contract-derivation.v1",
    websiteSource,
    components: Object.freeze({
      implementation,
      persistence,
      queryContract,
      approvalArtifactSchema,
      approvalRelease,
      registryProjection,
    }),
    componentBindingHashes,
    contract,
    readModelBindingHash,
  });
  return Object.freeze({
    ...core,
    derivationHash: canonicalSha256(core.schemaVersion, core),
  });
}

async function localArtifactComponent(raw, websiteSource, repoRoot, read, label) {
  const value = exactObject(raw, ["artifacts"], `${label} component`);
  return Object.freeze({
    source: websiteSource,
    artifacts: await localArtifacts(value.artifacts, repoRoot, read, label),
  });
}

async function persistenceComponent(raw, websiteSource, repoRoot, read) {
  const value = exactObject(raw, ["artifacts", "hostedEvidence"],
    "persistence component");
  const evidence = exactObject(value.hostedEvidence, [
    "catalogSha256",
    "executionEvidenceSha256",
    "migrationPlanSha256",
    "migratedThrough",
    "targetBindingHash",
  ], "hosted persistence evidence");
  if (evidence.migratedThrough !== "0005") {
    throw new TypeError("Hosted persistence is not migrated through 0005");
  }
  return Object.freeze({
    source: websiteSource,
    artifacts: await localArtifacts(value.artifacts, repoRoot, read, "persistence"),
    hostedEvidence: Object.freeze({
      targetBindingHash: digest(evidence.targetBindingHash, "persistence target"),
      migrationPlanSha256: digest(evidence.migrationPlanSha256, "migration plan"),
      executionEvidenceSha256: digest(
        evidence.executionEvidenceSha256,
        "migration execution evidence",
      ),
      catalogSha256: digest(evidence.catalogSha256, "hosted catalog"),
      migratedThrough: "0005",
    }),
  });
}

async function queryComponent(raw, websiteSource, repoRoot, read) {
  const value = exactObject(raw, [
    "artifacts", "detailPathTemplate", "feedPath", "readinessPath",
  ], "query contract component");
  if (value.feedPath !== "/api/custom-launch/generic/v2/launches"
    || value.detailPathTemplate
      !== "/api/custom-launch/generic/v2/launches/{recordHash}"
    || value.readinessPath !== "/api/custom-launch/generic/v2/readiness") {
    throw new TypeError("Generic launch V2 query paths are invalid");
  }
  return Object.freeze({
    source: websiteSource,
    artifacts: await localArtifacts(value.artifacts, repoRoot, read, "query contract"),
    feedPath: value.feedPath,
    detailPathTemplate: value.detailPathTemplate,
    readinessPath: value.readinessPath,
  });
}

function approvalSchemaComponent(raw) {
  const value = exactObject(raw, [
    "artifact", "audience", "domain", "handoffEvidenceSha256",
    "schemaVersion", "source", "status",
  ], "Approval artifact schema component");
  if (value.status !== "frozen"
    || value.domain !== "programmable.approval-registry-descriptor-binding.v3"
    || value.audience !== "programmable.custom-registry.v2") {
    throw new TypeError("Approval artifact schema is not frozen for Registry V2");
  }
  return Object.freeze({
    status: "frozen",
    source: sourceIdentity(value.source, "Approval schema source"),
    schemaVersion: nonempty(value.schemaVersion, "Approval schema version"),
    domain: value.domain,
    audience: value.audience,
    artifact: externalArtifact(value.artifact, "Approval schema artifact"),
    handoffEvidenceSha256: digest(
      value.handoffEvidenceSha256,
      "Approval schema handoff evidence",
    ),
  });
}

function approvalReleaseComponent(raw, schemaSource) {
  const value = exactObject(raw, [
    "aggregateReadinessBindingHash",
    "artifactVerifierBindingHash",
    "liveDeploymentEvidenceSha256",
    "packageArtifactSha256",
    "source",
    "status",
  ], "Approval release component");
  const source = sourceIdentity(value.source, "Approval release source");
  if (value.status !== "live"
    || source.repositoryFullName !== schemaSource.repositoryFullName) {
    throw new TypeError("Approval release is not a live release of the frozen schema");
  }
  return Object.freeze({
    status: "live",
    source,
    packageArtifactSha256: digest(
      value.packageArtifactSha256,
      "Approval package artifact",
    ),
    aggregateReadinessBindingHash: digest(
      value.aggregateReadinessBindingHash,
      "Approval aggregate readiness binding",
    ),
    artifactVerifierBindingHash: digest(
      value.artifactVerifierBindingHash,
      "Approval artifact verifier binding",
    ),
    liveDeploymentEvidenceSha256: digest(
      value.liveDeploymentEvidenceSha256,
      "Approval live deployment evidence",
    ),
  });
}

async function registryComponent(raw, websiteSource, repoRoot, read) {
  const value = exactObject(raw, [
    "abiArtifactSha256", "artifacts", "deploymentArtifactSha256",
    "eventSetSha256", "liveVerificationEvidenceSha256",
    "minimumFinalityBlocks", "registryAddress", "registryPolicyCommitment",
    "registryRuntimeCodeKeccak256", "source", "sourceArtifactSha256",
    "sourceVerificationEvidenceSha256", "status",
  ], "Registry projection component");
  if (value.status !== "live") {
    throw new TypeError("Registry projection is not live");
  }
  const artifacts = await localArtifacts(value.artifacts, repoRoot, read,
    "Registry projection");
  const deployment = artifacts.find(({ path }) =>
    path === "config/custom-registry-v2.deployment.prelaunch.json");
  if (!deployment
    || deployment.sha256 !== digest(
      value.deploymentArtifactSha256,
      "Registry deployment artifact",
    )) {
    throw new TypeError("Registry deployment artifact is not in the projection closure");
  }
  const registrySource = sourceIdentity(value.source, "Registry source");
  const registryAddress = address(value.registryAddress, "Registry address");
  const registryRuntimeCodeKeccak256 = hash32(
    value.registryRuntimeCodeKeccak256,
    "Registry runtime code hash",
  );
  const registryPolicyCommitment = hash32(
    value.registryPolicyCommitment,
    "Registry policy commitment",
  );
  const minimumFinalityBlocks = positiveDecimal(
    value.minimumFinalityBlocks,
    "Registry minimum finality blocks",
  );
  const sourceArtifactSha256 = digest(
    value.sourceArtifactSha256,
    "Registry source artifact",
  );
  const abiArtifactSha256 = digest(value.abiArtifactSha256, "Registry ABI artifact");
  const eventSetSha256 = digest(value.eventSetSha256, "Registry event set");
  const deploymentBytes = read === readFile
    ? await readRegularArtifact(resolve(repoRoot, deployment.path), "Registry deployment")
    : await read(resolve(repoRoot, deployment.path));
  assertRegistryDeploymentConfig(JSON.parse(deploymentBytes.toString("utf8")), {
    registrySource,
    registryAddress,
    registryRuntimeCodeKeccak256,
    registryPolicyCommitment,
    minimumFinalityBlocks,
    sourceArtifactSha256,
    abiArtifactSha256,
    eventSetSha256,
  });
  return Object.freeze({
    status: "live",
    websiteSource,
    registrySource,
    artifacts,
    deploymentArtifactSha256: deployment.sha256,
    sourceArtifactSha256,
    abiArtifactSha256,
    eventSetSha256,
    registryAddress,
    registryRuntimeCodeKeccak256,
    registryPolicyCommitment,
    minimumFinalityBlocks,
    liveVerificationEvidenceSha256: digest(
      value.liveVerificationEvidenceSha256,
      "Registry live verification evidence",
    ),
    sourceVerificationEvidenceSha256: digest(
      value.sourceVerificationEvidenceSha256,
      "Registry source verification evidence",
    ),
  });
}

function assertRegistryDeploymentConfig(raw, expected) {
  const value = exactObject(raw, [
    "caip2", "chainId", "finality", "generation", "indexingEnabled",
    "profiles", "publicReadEnabled", "registry", "release", "schemaVersion",
    "status",
  ], "Registry deployment config");
  const registry = exactObject(value.registry, [
    "address", "deploymentBlock", "deploymentBlockHash",
    "deploymentTransactionHash", "runtimeCodeKeccak256",
  ], "Registry deployment identity");
  const release = exactObject(value.release, [
    "abiArtifactSha256", "eventSetSha256", "sourceArtifactSha256",
    "sourceCommit", "sourceTree",
  ], "Registry deployment release");
  const finality = exactObject(value.finality, [
    "minimumConfirmations", "policyBindingHash",
  ], "Registry deployment finality");
  if (value.schemaVersion !== "programmable.custom-registry-v2-deployment.v1"
    || value.status !== "live" || value.generation !== "2"
    || value.chainId !== "1" || value.caip2 !== "eip155:1"
    || value.publicReadEnabled !== true || value.indexingEnabled !== true
    || address(registry.address, "deployed Registry address")
      !== expected.registryAddress
    || registry.runtimeCodeKeccak256 !== expected.registryRuntimeCodeKeccak256
    || release.sourceCommit !== expected.registrySource.commit
    || release.sourceTree !== expected.registrySource.tree
    || release.sourceArtifactSha256 !== expected.sourceArtifactSha256
    || release.abiArtifactSha256 !== expected.abiArtifactSha256
    || release.eventSetSha256 !== expected.eventSetSha256
    || finality.minimumConfirmations !== expected.minimumFinalityBlocks
    || finality.policyBindingHash !== expected.registryPolicyCommitment) {
    throw new TypeError("Registry projection does not match the live deployment config");
  }
}

async function localArtifacts(raw, repoRoot, read, label) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) {
    throw new TypeError(`${label} artifacts are invalid`);
  }
  const result = [];
  for (const candidate of raw) {
    const value = exactObject(candidate, ["path", "sha256"], `${label} artifact`);
    const path = artifactPath(value.path, `${label} artifact path`);
    const fullPath = resolve(repoRoot, path);
    const rel = relative(repoRoot, fullPath);
    if (rel.startsWith(`..${sep}`) || rel === ".." || rel === "") {
      throw new TypeError(`${label} artifact escapes the repository`);
    }
    const expected = digest(value.sha256, `${label} artifact digest`);
    const bytes = read === readFile
      ? await readRegularArtifact(fullPath, label)
      : await read(fullPath);
    if (bytes.byteLength === 0 || bytes.byteLength > 4_194_304
      || sha256Bytes(bytes) !== expected) {
      throw new TypeError(`${label} artifact bytes do not match ${path}`);
    }
    result.push(Object.freeze({ path, sha256: expected }));
  }
  const paths = result.map(({ path }) => path);
  if (new Set(paths).size !== paths.length
    || canonicalJson(paths) !== canonicalJson([...paths].sort())) {
    throw new TypeError(`${label} artifacts must be unique and sorted`);
  }
  return Object.freeze(result);
}

async function readRegularArtifact(path, label) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > 4_194_304) {
      throw new TypeError(`${label} artifact is not a bounded regular file`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function sourceIdentity(raw, label) {
  const value = exactObject(raw, [
    "commit", "repositoryFullName", "repositoryId", "tree",
  ], label);
  return Object.freeze({
    repositoryId: positiveDecimal(value.repositoryId, `${label} repository ID`),
    repositoryFullName: match(value.repositoryFullName, REPOSITORY,
      `${label} repository name`),
    commit: match(value.commit, GIT_OID, `${label} commit`),
    tree: match(value.tree, GIT_OID, `${label} tree`),
  });
}

function externalArtifact(raw, label) {
  const value = exactObject(raw, ["path", "sha256"], label);
  return Object.freeze({
    path: artifactPath(value.path, `${label} path`),
    sha256: digest(value.sha256, `${label} digest`),
  });
}

function exactObject(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    throw new TypeError(`${label} must contain exactly ${keys.join(", ")}`);
  }
  return value;
}

function artifactPath(value, label) {
  return match(value, ARTIFACT_PATH, label);
}

function digest(value, label) {
  return match(value, SHA256, label);
}

function hash32(value, label) {
  return match(value, HASH32, label);
}

function address(value, label) {
  const result = match(value, ADDRESS, label);
  if (/^0x0{40}$/iu.test(result)) throw new TypeError(`${label} is zero`);
  return result.toLowerCase();
}

function positiveDecimal(value, label) {
  return match(value, POSITIVE_DECIMAL, label);
}

function nonempty(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function match(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function currentGitIdentity(repoRoot) {
  const git = (args) => execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (git(["status", "--porcelain"]) !== "") {
    throw new TypeError("Website checkout must be clean");
  }
  return Object.freeze({
    commit: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
  });
}

export async function readProtectedDerivationInput(path, expectedSha256) {
  const expected = digest(expectedSha256, "protected derivation input");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600
      || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
      throw new TypeError("Protected derivation input must be an owner-only regular file");
    }
    if (stat.size <= 0 || stat.size > 1_048_576) {
      throw new TypeError("Protected derivation input size is invalid");
    }
    const bytes = await handle.readFile();
    if (sha256Bytes(bytes) !== expected) {
      throw new TypeError("Protected derivation input digest does not match");
    }
    return JSON.parse(bytes.toString("utf8"));
  } finally {
    await handle.close();
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  const repoRoot = resolve(args.repoRoot ?? process.cwd());
  const inputPath = resolve(args.input);
  const outputPath = resolve(args.output);
  if (inputPath === outputPath) throw new TypeError("Input and output must differ");
  const input = await readProtectedDerivationInput(inputPath, args.inputSha256);
  const artifact = await deriveGenericLaunchReadModelContractV2(input, {
    repoRoot,
    gitIdentity: currentGitIdentity,
  });
  const bytes = `${canonicalJson(artifact)}\n`;
  await writeFile(outputPath, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    outputPath,
    artifactSha256: sha256Bytes(bytes),
    derivationHash: artifact.derivationHash,
    readModelBindingHash: artifact.readModelBindingHash,
  })}\n`);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--input", "--input-sha256", "--output", "--repo-root"].includes(key)) {
      throw new TypeError(`Unknown argument: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`${key} is required`);
    const field = key === "--repo-root"
      ? "repoRoot"
      : key === "--input-sha256" ? "inputSha256" : key.slice(2);
    result[field] = value;
    index += 1;
  }
  if (!result.input || !result.inputSha256 || !result.output) {
    throw new TypeError(
      "Usage: --input <protected.json> --input-sha256 <sha256:...> --output <new-artifact.json>",
    );
  }
  return result;
}

if (process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
