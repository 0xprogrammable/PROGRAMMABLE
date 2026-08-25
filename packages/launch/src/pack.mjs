import { readFile } from "node:fs/promises";
import path from "node:path";

import { getAddress, keccak256 } from "viem";

import { loadCompilationUnits, loadTargetArtifact, canonicalIdentifier } from "./build.mjs";
import { canonicalizeJson } from "./canonical-json.mjs";
import {
  AGENT_ATTESTATION_SCHEMA,
  CREATE_REQUEST_SCHEMA,
  MAINNET_CHAIN_ID,
  MAX_REQUEST_BYTES,
  OPENAPI_URL,
  PACK_CONFIG_SCHEMA,
  PACKAGE_VERSION,
  SOURCE_DESCRIPTOR_SCHEMA,
} from "./constants.mjs";
import { buildGraphBundle } from "./graph.mjs";
import {
  assertExactKeys,
  atomicWrite,
  canonicalRelativePath,
  compareUtf8,
  readStrictJsonFile,
  sha256Digest,
} from "./io.mjs";
import { buildSourceBundle } from "./source-bundle.mjs";
import { buildVerificationBundle } from "./verification.mjs";

const NONZERO_HEX32 = /^0x(?!0{64}$)[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export async function buildLaunch({ configPath }) {
  const absoluteConfig = path.resolve(configPath);
  const { value: config } = await readStrictJsonFile(absoluteConfig, 2_097_152);
  assertPackConfig(config);
  const configDirectory = path.dirname(absoluteConfig);
  const sourceRoot = resolveSourceRoot(configDirectory, config.source.root);
  const launchWallet = getAddress(config.launchWallet);
  const nonce = canonicalNonce(config.nonce);

  const units = await loadCompilationUnits(config.compilationUnits, sourceRoot);
  const unitsById = new Map(units.map((unit) => [unit.compilationUnitId, unit]));
  const targets = [];
  for (const [index, target] of config.targets.entries()) {
    targets.push(await loadTargetArtifact(target, index, sourceRoot, unitsById));
  }

  const attestationEvidence = await buildAttestationEvidence(
    config.agentAttestation,
    sourceRoot,
  );
  const sourcePaths = new Set([
    ...config.source.paths,
    ...units.map(({ standardJsonRelativePath }) => standardJsonRelativePath),
    ...targets.map(({ artifactRelativePath }) => artifactRelativePath),
    ...attestationEvidence.map(({ evidencePath }) => evidencePath),
  ]);
  const sourceBundle = await buildSourceBundle(sourceRoot, [...sourcePaths]);
  const publicOriginCommitment = publicOriginCommitmentV1(config.source.publicOrigin);
  const sourceDescriptor = {
    schemaVersion: SOURCE_DESCRIPTOR_SCHEMA,
    kind: "deterministic-source-bundle",
    controllerWallet: launchWallet,
    sourceLineageNonce: canonicalUint(
      config.source.sourceLineageNonce,
      "source.sourceLineageNonce",
    ),
    sourceBundleDigest: sourceBundle.sourceBundleDigest,
    bundleContentSha256: sourceBundle.bundleContentSha256,
    publicOriginCommitment,
  };
  const { graphBundle, graphBundleHash, predictions } = buildGraphBundle({
    targets,
    pool: config.pool,
    sourceBundleSha256: sourceBundle.bundleContentSha256,
    launchWallet,
    nonce,
  });
  const { verificationBundle, verificationBundleHash } = buildVerificationBundle(
    units,
    targets,
    predictions,
  );
  const checks = attestationEvidence.map(({ checkId, evidenceSha256 }) => ({
    checkId,
    evidenceSha256,
  }));
  const agentAttestation = {
    schemaVersion: AGENT_ATTESTATION_SCHEMA,
    subjectGraphBundleHash: graphBundleHash,
    agentId: canonicalIdentifier(config.agentAttestation.agentId, "agentAttestation.agentId"),
    checkedAt: canonicalCheckedAt(config.agentAttestation.checkedAt),
    checks,
  };
  const request = {
    schemaVersion: CREATE_REQUEST_SCHEMA,
    launchWallet,
    chainId: MAINNET_CHAIN_ID,
    nonce,
    sourceDescriptor,
    sourceBundleManifest: sourceBundle.manifest,
    graphBundle,
    agentAttestation,
    verificationBundle,
  };
  const requestBytes = Buffer.from(`${canonicalizeJson(request)}\n`, "utf8");
  if (requestBytes.byteLength > MAX_REQUEST_BYTES) {
    throw new TypeError(`packed launch request exceeds the ${MAX_REQUEST_BYTES}-byte limit`);
  }
  const requestSha256 = sha256Digest(requestBytes);
  const receipt = {
    schemaVersion: "programmable.launch-pack-receipt.v1",
    package: { name: "@programmable/launch", version: PACKAGE_VERSION },
    openapi: OPENAPI_URL,
    requestSha256,
    sourceBundleDigest: sourceBundle.sourceBundleDigest,
    bundleContentSha256: sourceBundle.bundleContentSha256,
    graphBundleHash,
    verificationBundleHash,
    predictions,
  };
  const receiptBytes = Buffer.from(`${canonicalizeJson(receipt)}\n`, "utf8");
  return {
    configDirectory,
    request,
    requestBytes,
    receipt,
    receiptBytes,
    requestSha256,
    graphBundleHash,
    verificationBundleHash,
    predictions,
  };
}

export async function packLaunch({ configPath, outputPath, receiptPath }) {
  const built = await buildLaunch({ configPath });
  const resolvedOutput = path.resolve(outputPath ?? path.join(built.configDirectory, "launch.json"));
  const resolvedReceipt = path.resolve(receiptPath ?? `${resolvedOutput}.receipt.json`);
  await atomicWrite(resolvedOutput, built.requestBytes, 0o600);
  await atomicWrite(resolvedReceipt, built.receiptBytes, 0o600);
  return {
    outputPath: resolvedOutput,
    receiptPath: resolvedReceipt,
    requestSha256: built.requestSha256,
    graphBundleHash: built.graphBundleHash,
    verificationBundleHash: built.verificationBundleHash,
    predictions: built.predictions,
  };
}

function assertPackConfig(config) {
  assertExactKeys(config, [
    "schemaVersion",
    "launchWallet",
    "chainId",
    "nonce",
    "source",
    "compilationUnits",
    "targets",
    "pool",
    "agentAttestation",
  ], "pack config");
  if (config.schemaVersion !== PACK_CONFIG_SCHEMA) {
    throw new TypeError(`pack config schemaVersion must be ${PACK_CONFIG_SCHEMA}`);
  }
  if (config.chainId !== MAINNET_CHAIN_ID) throw new TypeError("pack config chainId must be string 1");
  if (!Array.isArray(config.targets) || config.targets.length === 0 || config.targets.length > 16) {
    throw new TypeError("pack config targets must contain between 1 and 16 entries");
  }
  assertExactKeys(config.source, [
    "root",
    "paths",
    "sourceLineageNonce",
    "publicOrigin",
  ], "pack config source");
  if (typeof config.source.root !== "string" || config.source.root.length === 0
    || path.isAbsolute(config.source.root)) {
    throw new TypeError("source.root must be a relative directory");
  }
  if (!Array.isArray(config.source.paths) || config.source.paths.length === 0) {
    throw new TypeError("source.paths must be a non-empty array");
  }
  for (const sourcePath of config.source.paths) canonicalRelativePath(sourcePath, "source.paths entry");
  assertExactKeys(config.source.publicOrigin, ["url", "revision"], "source.publicOrigin");
  const origin = new URL(config.source.publicOrigin.url);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.hash) {
    throw new TypeError("source.publicOrigin.url must be a credential-free HTTPS URL without a fragment");
  }
  if (typeof config.source.publicOrigin.revision !== "string"
    || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(config.source.publicOrigin.revision)) {
    throw new TypeError("source.publicOrigin.revision must be an exact lowercase object id");
  }
  assertExactKeys(config.agentAttestation, ["agentId", "checkedAt", "checks"], "agentAttestation");
  if (!Array.isArray(config.agentAttestation.checks)
    || config.agentAttestation.checks.length === 0
    || config.agentAttestation.checks.length > 64) {
    throw new TypeError("agentAttestation.checks must contain between 1 and 64 checks");
  }
}

async function buildAttestationEvidence(attestation, sourceRoot) {
  const evidence = [];
  for (const [index, check] of attestation.checks.entries()) {
    assertExactKeys(check, ["checkId", "evidence"], `agentAttestation.checks[${index}]`);
    const checkId = canonicalIdentifier(check.checkId, `agentAttestation.checks[${index}].checkId`);
    const evidencePath = canonicalRelativePath(check.evidence, `${checkId} evidence path`);
    const bytes = await readFile(path.join(sourceRoot, ...evidencePath.split("/")));
    evidence.push({ checkId, evidencePath, evidenceSha256: sha256Digest(bytes) });
  }
  evidence.sort((left, right) => compareUtf8(left.checkId, right.checkId));
  if (new Set(evidence.map(({ checkId }) => checkId)).size !== evidence.length) {
    throw new TypeError("agent attestation check IDs must be unique");
  }
  return evidence;
}

function publicOriginCommitmentV1(publicOrigin) {
  const bytes = Buffer.concat([
    Buffer.from("programmable.public-source-origin.v1", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(publicOrigin), "utf8"),
  ]);
  return keccak256(`0x${bytes.toString("hex")}`);
}

function resolveSourceRoot(configDirectory, configuredRoot) {
  const resolved = path.resolve(configDirectory, configuredRoot);
  if (resolved === path.parse(resolved).root) throw new TypeError("source.root cannot be a filesystem root");
  return resolved;
}

function canonicalNonce(value) {
  if (typeof value !== "string" || !NONZERO_HEX32.test(value)) {
    throw new TypeError("nonce must be a nonzero lowercase bytes32 value");
  }
  return value;
}

function canonicalUint(value, label) {
  if (typeof value !== "string" || !DECIMAL.test(value) || BigInt(value) >= 1n << 256n) {
    throw new TypeError(`${label} must be a canonical uint256 string`);
  }
  return value;
}

function canonicalCheckedAt(value) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || new Date(value).toISOString() !== value) {
    throw new TypeError("agentAttestation.checkedAt must be a canonical UTC timestamp with milliseconds");
  }
  return value;
}
