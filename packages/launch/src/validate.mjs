import { readFile } from "node:fs/promises";
import path from "node:path";

import { getAddress, keccak256 } from "viem";

import {
  exactCompilerVersion,
  validateStandardJsonInput,
  canonicalIdentifier,
} from "./build.mjs";
import { canonicalizeJson, parseStrictJson } from "./canonical-json.mjs";
import {
  AGENT_ATTESTATION_SCHEMA,
  CREATE_REQUEST_SCHEMA,
  GRAPH_BUNDLE_SCHEMA,
  MAINNET_CHAIN_ID,
  MAX_REQUEST_BYTES,
  MAX_STANDARD_JSON_INPUT_BYTES,
  MAX_TOTAL_STANDARD_JSON_INPUT_BYTES,
  SOURCE_DESCRIPTOR_SCHEMA,
  SOURCE_MANIFEST_SCHEMA,
} from "./constants.mjs";
import { normalizeAndPredictSubmittedGraph } from "./graph.mjs";
import {
  assertAllowedKeys,
  assertExactKeys,
  canonicalRelativePath,
  compareUtf8,
  decodeExactUtf8,
  sha256Digest,
} from "./io.mjs";
import { buildLaunch } from "./pack.mjs";
import { VERIFICATION_BUNDLE_SCHEMA } from "./verification.mjs";

const HEX32 = /^0x[0-9a-f]{64}$/;
const NONZERO_HEX32 = /^0x(?!0{64}$)[0-9a-f]{64}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export async function validateLaunchFile({ launchPath, configPath }) {
  const absolute = path.resolve(launchPath);
  const bytes = await readFile(absolute);
  if (bytes.byteLength > MAX_REQUEST_BYTES) {
    throw new TypeError(`launch request exceeds the ${MAX_REQUEST_BYTES}-byte limit`);
  }
  const source = decodeExactUtf8(bytes, absolute);
  const request = parseStrictJson(source, { maximumBytes: MAX_REQUEST_BYTES });
  const result = validateLaunchRequest(request);
  if (configPath !== undefined) {
    const rebuilt = await buildLaunch({ configPath });
    if (!bytes.equals(rebuilt.requestBytes)) {
      throw new TypeError(
        `PACK_REPRODUCTION_MISMATCH: ${absolute} is not byte-identical to a fresh pack of ${path.resolve(configPath)}`,
      );
    }
  }
  return {
    ...result,
    requestSha256: sha256Digest(bytes),
    byteLength: bytes.byteLength,
    reproducedFromConfig: configPath !== undefined,
  };
}

export function validateLaunchRequest(request) {
  assertAllowedKeys(
    request,
    [
      "schemaVersion",
      "launchWallet",
      "chainId",
      "nonce",
      "sourceDescriptor",
      "sourceBundleManifest",
      "graphBundle",
      "agentAttestation",
    ],
    ["verificationBundle"],
    "launch request",
  );
  if (request.schemaVersion !== CREATE_REQUEST_SCHEMA) {
    throw new TypeError(`schemaVersion must be ${CREATE_REQUEST_SCHEMA}`);
  }
  const launchWallet = getAddress(request.launchWallet);
  if (request.chainId !== MAINNET_CHAIN_ID) throw new TypeError("chainId must be string 1");
  if (typeof request.nonce !== "string" || !NONZERO_HEX32.test(request.nonce)) {
    throw new TypeError("nonce must be nonzero lowercase bytes32");
  }
  const manifest = validateManifest(request.sourceBundleManifest);
  const sourceDescriptor = validateSourceDescriptor(request.sourceDescriptor, launchWallet);
  const manifestDigest = keccak256(`0x${Buffer.concat([
    Buffer.from("programmable.source-bundle.v2", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(manifest), "utf8"),
  ]).toString("hex")}`);
  if (manifestDigest !== sourceDescriptor.sourceBundleDigest) {
    throw new TypeError("sourceDescriptor.sourceBundleDigest does not match the manifest");
  }
  if (request.graphBundle?.schemaVersion !== GRAPH_BUNDLE_SCHEMA) {
    throw new TypeError(`graphBundle.schemaVersion must be ${GRAPH_BUNDLE_SCHEMA}`);
  }
  if (request.graphBundle.sourceBundleSha256 !== sourceDescriptor.bundleContentSha256) {
    throw new TypeError("graphBundle.sourceBundleSha256 does not match sourceDescriptor.bundleContentSha256");
  }
  const graph = normalizeAndPredictSubmittedGraph(request.graphBundle, launchWallet, request.nonce);
  validateAttestation(request.agentAttestation, graph.graphBundleHash);
  const verification = request.verificationBundle === undefined
    ? { verificationBundleHash: null, exactSourceIncluded: false }
    : validateVerificationBundle(request.verificationBundle, graph.graphBundle, graph.predictions);
  return {
    schemaVersion: request.schemaVersion,
    graphBundleHash: graph.graphBundleHash,
    verificationBundleHash: verification.verificationBundleHash,
    exactSourceIncluded: verification.exactSourceIncluded,
    predictions: graph.predictions,
  };
}

function validateManifest(value) {
  assertExactKeys(value, ["schemaVersion", "entries"], "sourceBundleManifest");
  if (value.schemaVersion !== SOURCE_MANIFEST_SCHEMA
    || !Array.isArray(value.entries) || value.entries.length === 0 || value.entries.length > 200_000) {
    throw new TypeError("sourceBundleManifest is invalid");
  }
  const entries = value.entries.map((entry, index) => {
    const label = `sourceBundleManifest.entries[${index}]`;
    assertExactKeys(entry, [
      "path",
      "kind",
      "mode",
      "byteLength",
      "contentSha256",
      "symlinkTarget",
    ], label);
    const entryPath = canonicalRelativePath(entry.path, `${label}.path`);
    if (entry.kind !== "file" && entry.kind !== "symlink") throw new TypeError(`${label}.kind is invalid`);
    if (typeof entry.byteLength !== "string" || !DECIMAL.test(entry.byteLength)
      || BigInt(entry.byteLength) > (1n << 64n) - 1n) {
      throw new TypeError(`${label}.byteLength is invalid`);
    }
    if (typeof entry.contentSha256 !== "string" || !SHA256.test(entry.contentSha256)) {
      throw new TypeError(`${label}.contentSha256 is invalid`);
    }
    if (entry.kind === "file") {
      if ((entry.mode !== "100644" && entry.mode !== "100755") || entry.symlinkTarget !== null) {
        throw new TypeError(`${label} file mode or symlinkTarget is invalid`);
      }
    } else if (entry.mode !== "120000" || typeof entry.symlinkTarget !== "string") {
      throw new TypeError(`${label} symlink mode or target is invalid`);
    }
    return { ...entry, path: entryPath };
  });
  for (let index = 1; index < entries.length; index += 1) {
    if (compareUtf8(entries[index - 1].path, entries[index].path) >= 0) {
      throw new TypeError("source bundle entries must be uniquely UTF-8 sorted");
    }
  }
  return { schemaVersion: SOURCE_MANIFEST_SCHEMA, entries };
}

function validateSourceDescriptor(value, launchWallet) {
  assertExactKeys(value, [
    "schemaVersion",
    "kind",
    "controllerWallet",
    "sourceLineageNonce",
    "sourceBundleDigest",
    "bundleContentSha256",
    "publicOriginCommitment",
  ], "sourceDescriptor");
  if (value.schemaVersion !== SOURCE_DESCRIPTOR_SCHEMA || value.kind !== "deterministic-source-bundle") {
    throw new TypeError("sourceDescriptor schema or kind is invalid");
  }
  if (getAddress(value.controllerWallet) !== launchWallet) {
    throw new TypeError("sourceDescriptor.controllerWallet does not match launchWallet");
  }
  if (typeof value.sourceLineageNonce !== "string" || !DECIMAL.test(value.sourceLineageNonce)) {
    throw new TypeError("sourceDescriptor.sourceLineageNonce is invalid");
  }
  if (typeof value.sourceBundleDigest !== "string" || !HEX32.test(value.sourceBundleDigest)
    || typeof value.bundleContentSha256 !== "string" || !SHA256.test(value.bundleContentSha256)
    || typeof value.publicOriginCommitment !== "string" || !HEX32.test(value.publicOriginCommitment)) {
    throw new TypeError("sourceDescriptor contains an invalid digest");
  }
  return value;
}

function validateAttestation(value, graphBundleHash) {
  assertExactKeys(value, [
    "schemaVersion",
    "subjectGraphBundleHash",
    "agentId",
    "checkedAt",
    "checks",
  ], "agentAttestation");
  if (value.schemaVersion !== AGENT_ATTESTATION_SCHEMA
    || value.subjectGraphBundleHash !== graphBundleHash) {
    throw new TypeError("agentAttestation is not bound to the normalized graph bundle");
  }
  canonicalIdentifier(value.agentId, "agentAttestation.agentId");
  if (typeof value.checkedAt !== "string" || !ISO_UTC.test(value.checkedAt)
    || new Date(value.checkedAt).toISOString() !== value.checkedAt) {
    throw new TypeError("agentAttestation.checkedAt is invalid");
  }
  if (!Array.isArray(value.checks) || value.checks.length === 0 || value.checks.length > 64) {
    throw new TypeError("agentAttestation.checks is invalid");
  }
  const ids = new Set();
  for (const [index, check] of value.checks.entries()) {
    assertExactKeys(check, ["checkId", "evidenceSha256"], `agentAttestation.checks[${index}]`);
    const checkId = canonicalIdentifier(check.checkId, `agentAttestation.checks[${index}].checkId`);
    if (ids.has(checkId)) throw new TypeError("agent attestation check IDs must be unique");
    ids.add(checkId);
    if (typeof check.evidenceSha256 !== "string" || !SHA256.test(check.evidenceSha256)) {
      throw new TypeError(`agentAttestation.checks[${index}].evidenceSha256 is invalid`);
    }
  }
}

function validateVerificationBundle(value, graphBundle, predictions) {
  assertExactKeys(value, ["schemaVersion", "compilationUnits", "components"], "verificationBundle");
  if (value.schemaVersion !== VERIFICATION_BUNDLE_SCHEMA) {
    throw new TypeError(`verificationBundle.schemaVersion must be ${VERIFICATION_BUNDLE_SCHEMA}`);
  }
  if (!Array.isArray(value.compilationUnits) || value.compilationUnits.length === 0
    || value.compilationUnits.length > 16) {
    throw new TypeError("verificationBundle.compilationUnits is invalid");
  }
  const units = new Map();
  let priorUnit = null;
  let totalStandardJsonBytes = 0;
  for (const [index, unit] of value.compilationUnits.entries()) {
    const label = `verificationBundle.compilationUnits[${index}]`;
    assertExactKeys(unit, [
      "compilationUnitId",
      "compilerVersion",
      "standardJsonInputBase64",
      "standardJsonInputSha256",
    ], label);
    const id = canonicalIdentifier(unit.compilationUnitId, `${label}.compilationUnitId`);
    if (priorUnit !== null && compareUtf8(priorUnit, id) >= 0) {
      throw new TypeError("verification compilation units must be uniquely UTF-8 sorted");
    }
    priorUnit = id;
    exactCompilerVersion(unit.compilerVersion, `${label}.compilerVersion`);
    const bytes = decodeCanonicalBase64(unit.standardJsonInputBase64, `${label}.standardJsonInputBase64`);
    if (bytes.byteLength > MAX_STANDARD_JSON_INPUT_BYTES) {
      throw new TypeError(
        `${label}.standardJsonInputBase64 exceeds the ${MAX_STANDARD_JSON_INPUT_BYTES}-byte decoded limit`,
      );
    }
    totalStandardJsonBytes += bytes.byteLength;
    if (totalStandardJsonBytes > MAX_TOTAL_STANDARD_JSON_INPUT_BYTES) {
      throw new TypeError(
        `verificationBundle Standard JSON exceeds the ${MAX_TOTAL_STANDARD_JSON_INPUT_BYTES}-byte aggregate decoded limit`,
      );
    }
    if (sha256Digest(bytes) !== unit.standardJsonInputSha256) {
      throw new TypeError(`${label}.standardJsonInputSha256 does not match exact decoded bytes`);
    }
    const source = decodeExactUtf8(bytes, `${label} Standard JSON`);
    const input = parseStrictJson(source, { maximumBytes: MAX_STANDARD_JSON_INPUT_BYTES });
    validateStandardJsonInput(input, id);
    units.set(id, { unit, input });
  }
  if (!Array.isArray(value.components) || value.components.length === 0
    || value.components.length > 16 || value.components.length !== graphBundle.targets.length) {
    throw new TypeError("verificationBundle.components must exactly cover graph targets");
  }
  const predictionByTarget = new Map(predictions.map((prediction) => [prediction.targetId, prediction]));
  let priorTarget = null;
  for (const [index, component] of value.components.entries()) {
    const label = `verificationBundle.components[${index}]`;
    assertExactKeys(component, [
      "targetId",
      "compilationUnitId",
      "sourcePath",
      "contractName",
      "constructorArguments",
    ], label);
    const targetId = canonicalIdentifier(component.targetId, `${label}.targetId`);
    if (priorTarget !== null && compareUtf8(priorTarget, targetId) >= 0) {
      throw new TypeError("verification components must be uniquely UTF-8 sorted");
    }
    priorTarget = targetId;
    const unit = units.get(component.compilationUnitId);
    if (!unit) throw new TypeError(`${label} references unknown compilation unit`);
    if (typeof component.sourcePath !== "string" || !Object.hasOwn(unit.input.sources, component.sourcePath)) {
      throw new TypeError(`${label}.sourcePath is absent from its Standard JSON input`);
    }
    canonicalIdentifier(component.contractName, `${label}.contractName`);
    if (typeof component.constructorArguments !== "string" || !HEX_DATA.test(component.constructorArguments)) {
      throw new TypeError(`${label}.constructorArguments must be lowercase even hex`);
    }
    const prediction = predictionByTarget.get(targetId);
    if (!prediction || prediction.resolvedConstructorArguments !== component.constructorArguments) {
      throw new TypeError(`${label}.constructorArguments do not match the resolved graph init code`);
    }
  }
  const graphIds = graphBundle.targets.map(({ targetId }) => targetId).sort(compareUtf8);
  const componentIds = value.components.map(({ targetId }) => targetId);
  if (graphIds.some((targetId, index) => targetId !== componentIds[index])) {
    throw new TypeError("verification components do not exactly cover graph targets");
  }
  const normalized = {
    schemaVersion: VERIFICATION_BUNDLE_SCHEMA,
    compilationUnits: value.compilationUnits,
    components: value.components,
  };
  const verificationBundleHash = sha256Digest(Buffer.concat([
    Buffer.from(VERIFICATION_BUNDLE_SCHEMA, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(normalized), "utf8"),
  ]));
  return { verificationBundleHash, exactSourceIncluded: true };
}

function decodeCanonicalBase64(value, label) {
  if (typeof value !== "string" || value.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new TypeError(`${label} is not canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new TypeError(`${label} is not canonical base64`);
  return bytes;
}
