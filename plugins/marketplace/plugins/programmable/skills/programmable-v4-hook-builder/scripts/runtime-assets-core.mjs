import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isCanonicalReviewTargetPath } from "./review-target-contract.mjs";
import { spawnSafeGitSync } from "./repository-root.mjs";

export const RUNTIME_ASSET_MANIFEST_V1 = Object.freeze({
  schema: "urn:programmable:runtime-assets:1",
  schemaVersion: 1,
  maximumAssets: 256,
  maximumManifestBytes: 1_000_000,
  maximumAssetBytes: 512_000_000,
  maximumTotalDeclaredBytes: 2_000_000_000,
  maximumStructuredTextSniffBytes: 8_000_000,
  maximumTextBytes: 1_024,
  maximumEvidencePaths: 512
});

const LOWER_HEX_40 = /^[0-9a-f]{40}$/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const ASSET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const REGULAR_BLOB = /^(100644) blob ([0-9a-f]{40})\t(.+)$/u;
const loadPhases = new Set([
  "static-preload",
  "runtime-on-demand",
  "level-on-demand",
  "streamed",
  "offline-build-only"
]);
const loadMechanisms = new Set([
  "bundled-copy",
  "http-fetch",
  "cdn-fetch",
  "ipfs-fetch",
  "map-provider",
  "sdk-resolver",
  "other-reviewed"
]);
const licenseStatuses = new Set(["declared", "review-required", "not-applicable-generated"]);
const provenanceKinds = new Set([
  "builder-created",
  "third-party-licensed",
  "public-domain",
  "procedurally-generated",
  "provider-supplied",
  "other-reviewed"
]);
const verificationStates = new Set([
  "content-hash-verified",
  "content-classification-review-required",
  "git-lfs-pointer-bound",
  "git-blob-review-required",
  "external-declared"
]);
const executableAssetExtension = /\.(?:bat|cjs|class|cmd|com|dll|dylib|exe|frag|glsl|htm|html|jar|java|js|jsx|mjs|node|php|ps1|py|rb|rs|sh|so|sol|ts|tsx|vert|wasm|wgsl)$/iu;
const executableMimeTypes = new Set([
  "application/javascript",
  "application/wasm",
  "image/svg+xml",
  "text/css",
  "text/html",
  "text/javascript"
]);
const structuredJsonMimeTypes = new Set([
  "application/geo+json",
  "application/json",
  "model/gltf+json"
]);
const ASCII_WHITESPACE_BYTES = new Set([0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const EXECUTABLE_SNIFF_BYTES = 262_144;
const EXECUTABLE_BINARY_MAGICS = Object.freeze([
  { name: "WebAssembly", bytes: Buffer.from([0x00, 0x61, 0x73, 0x6d]) },
  { name: "ELF executable", bytes: Buffer.from([0x7f, 0x45, 0x4c, 0x46]) },
  { name: "DOS or PE executable", bytes: Buffer.from([0x4d, 0x5a]) },
  { name: "Java class", bytes: Buffer.from([0xca, 0xfe, 0xba, 0xbe]) },
  { name: "Dalvik executable", bytes: Buffer.from("dex\n", "ascii") },
  { name: "Mach-O executable", bytes: Buffer.from([0xfe, 0xed, 0xfa, 0xce]) },
  { name: "Mach-O executable", bytes: Buffer.from([0xce, 0xfa, 0xed, 0xfe]) },
  { name: "Mach-O executable", bytes: Buffer.from([0xfe, 0xed, 0xfa, 0xcf]) },
  { name: "Mach-O executable", bytes: Buffer.from([0xcf, 0xfa, 0xed, 0xfe]) }
]);
const recognizedBinaryFormats = Object.freeze({
  "audio/wav": { extensions: new Set([".wav"]), inspect: inspectRiffWave },
  "audio/x-wav": { extensions: new Set([".wav"]), inspect: inspectRiffWave },
  "font/woff": { extensions: new Set([".woff"]), inspect: inspectWoff },
  "font/woff2": { extensions: new Set([".woff2"]), inspect: inspectWoff2 },
  "image/gif": { extensions: new Set([".gif"]), inspect: inspectGif },
  "image/jpeg": { extensions: new Set([".jpeg", ".jpg"]), inspect: inspectJpeg },
  "image/png": { extensions: new Set([".png"]), inspect: inspectPng },
  "image/webp": { extensions: new Set([".webp"]), inspect: inspectRiffWebp },
  "model/gltf-binary": { extensions: new Set([".glb"]), inspect: inspectGlb }
});

export function buildRuntimeAssetReview({ repositoryRoot, manifestPath, manifestBytes }) {
  if (!isCanonicalReviewTargetPath(manifestPath)) {
    throw new Error(`runtime asset manifest path is not canonical: ${String(manifestPath)}`);
  }
  if (!(manifestBytes instanceof Uint8Array) || manifestBytes.byteLength > RUNTIME_ASSET_MANIFEST_V1.maximumManifestBytes) {
    throw new Error(`runtime asset manifest exceeds ${RUNTIME_ASSET_MANIFEST_V1.maximumManifestBytes} bytes`);
  }

  let manifest;
  try {
    manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  } catch (error) {
    throw new Error(`runtime asset manifest is not valid UTF-8 JSON: ${error.message}`);
  }
  validateManifestShape(manifest);

  const seenIds = new Set();
  const seenRepositoryPaths = new Set();
  const evidencePaths = new Set();
  const assets = [];
  const diagnostics = [];
  let totalDeclaredBytes = 0;

  for (const asset of manifest.assets) {
    if (seenIds.has(asset.id)) throw new Error(`runtime asset id is duplicated: ${asset.id}`);
    seenIds.add(asset.id);
    totalDeclaredBytes += asset.bytes;
    if (totalDeclaredBytes > RUNTIME_ASSET_MANIFEST_V1.maximumTotalDeclaredBytes) {
      throw new Error(`runtime assets exceed ${RUNTIME_ASSET_MANIFEST_V1.maximumTotalDeclaredBytes} declared bytes`);
    }
    for (const evidencePath of [asset.license.evidencePath, asset.provenance.evidencePath]) {
      if (evidencePath === null) continue;
      if (!isCanonicalReviewTargetPath(evidencePath)) {
        throw new Error(`runtime asset evidence path is not canonical: ${String(evidencePath)}`);
      }
      evidencePaths.add(evidencePath);
      if (evidencePaths.size > RUNTIME_ASSET_MANIFEST_V1.maximumEvidencePaths) {
        throw new Error(`runtime asset evidence exceeds ${RUNTIME_ASSET_MANIFEST_V1.maximumEvidencePaths} paths`);
      }
    }

    let record;
    if (asset.source === "repository") {
      if (seenRepositoryPaths.has(asset.repositoryPath)) {
        throw new Error(`runtime asset repository path is duplicated: ${asset.repositoryPath}`);
      }
      seenRepositoryPaths.add(asset.repositoryPath);
      record = inspectRepositoryAsset(repositoryRoot, asset);
      if (record.verification !== "content-hash-verified") {
        diagnostics.push({
          code: "RUNTIME_ASSET_CONTENT_REVIEW_REQUIRED",
          assetId: asset.id,
          detail: record.verification === "git-lfs-pointer-bound"
            ? "The exact Git LFS pointer is bound, but the large object bytes were not materialized and hashed locally."
            : record.verification === "content-classification-review-required"
              ? "The exact bytes and hash are bound, but the declared format could not be classified as inert by the bounded content checks."
            : "The exact Git blob is bound, but transformed worktree bytes prevented local SHA-256 verification."
        });
      }
    } else {
      record = {
        id: asset.id,
        source: asset.source,
        repositoryPath: null,
        externalUri: asset.externalUri,
        gitBlob: null,
        sha256: asset.sha256,
        mime: asset.mime,
        bytes: asset.bytes,
        verification: "external-declared"
      };
      diagnostics.push({
        code: "RUNTIME_ASSET_EXTERNAL_REVIEW_REQUIRED",
        assetId: asset.id,
        detail: "The external runtime resource is declared but is not fetched or trusted by deterministic checks."
      });
    }

    if (asset.license.status === "review-required") {
      diagnostics.push({
        code: "RUNTIME_ASSET_LICENSE_REVIEW_REQUIRED",
        assetId: asset.id,
        detail: "The builder explicitly marked the runtime asset license for attributable review."
      });
    }
    assets.push(record);
  }

  assets.sort((left, right) => compareUtf8(left.id, right.id));
  diagnostics.sort((left, right) => (
    compareUtf8(left.code, right.code)
    || compareUtf8(left.assetId, right.assetId)
    || compareUtf8(left.detail, right.detail)
  ));
  return {
    schemaVersion: 1,
    manifestPath,
    binding: "exact-head-tree-and-declared-git-blobs",
    status: diagnostics.length === 0 ? "verified" : "review-required",
    totalDeclaredBytes,
    assets,
    diagnostics,
    evidencePaths: [...evidencePaths].sort(compareUtf8)
  };
}

export function isClosedRuntimeAssetReview(value) {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    "assets",
    "binding",
    "diagnostics",
    "manifestPath",
    "schemaVersion",
    "status",
    "totalDeclaredBytes"
  ])) return false;
  if (
    value.schemaVersion !== 1
    || value.binding !== "exact-head-tree-and-declared-git-blobs"
    || !new Set(["verified", "review-required"]).has(value.status)
    || !isCanonicalReviewTargetPath(value.manifestPath)
    || !Number.isInteger(value.totalDeclaredBytes)
    || value.totalDeclaredBytes < 0
    || value.totalDeclaredBytes > RUNTIME_ASSET_MANIFEST_V1.maximumTotalDeclaredBytes
    || !Array.isArray(value.assets)
    || value.assets.length > RUNTIME_ASSET_MANIFEST_V1.maximumAssets
    || !Array.isArray(value.diagnostics)
  ) return false;
  let previousId = null;
  let observedBytes = 0;
  for (const asset of value.assets) {
    if (!isPlainObject(asset) || !hasExactKeys(asset, [
      "bytes",
      "externalUri",
      "gitBlob",
      "id",
      "mime",
      "repositoryPath",
      "sha256",
      "source",
      "verification"
    ])) return false;
    if (
      !ASSET_ID.test(asset.id ?? "")
      || (previousId !== null && compareUtf8(previousId, asset.id) >= 0)
      || !new Set(["repository", "external"]).has(asset.source)
      || !verificationStates.has(asset.verification)
      || !MIME_TYPE.test(asset.mime ?? "")
      || !Number.isInteger(asset.bytes)
      || asset.bytes < 1
      || asset.bytes > RUNTIME_ASSET_MANIFEST_V1.maximumAssetBytes
      || (asset.sha256 !== null && !SHA256_DIGEST.test(asset.sha256))
    ) return false;
    if (asset.source === "repository") {
      if (
        !isCanonicalReviewTargetPath(asset.repositoryPath)
        || asset.externalUri !== null
        || !LOWER_HEX_40.test(asset.gitBlob ?? "")
        || !SHA256_DIGEST.test(asset.sha256 ?? "")
        || asset.verification === "external-declared"
      ) return false;
    } else if (
      asset.repositoryPath !== null
      || asset.gitBlob !== null
      || !isSafeExternalUri(asset.externalUri)
      || asset.verification !== "external-declared"
    ) return false;
    previousId = asset.id;
    observedBytes += asset.bytes;
  }
  if (observedBytes !== value.totalDeclaredBytes) return false;

  let previousDiagnostic = null;
  for (const diagnostic of value.diagnostics) {
    if (!isPlainObject(diagnostic) || !hasExactKeys(diagnostic, ["assetId", "code", "detail"])) return false;
    if (!ASSET_ID.test(diagnostic.assetId ?? "") || !isBoundedText(diagnostic.code, 128) || !isBoundedText(diagnostic.detail, 500)) return false;
    const key = `${diagnostic.code}\0${diagnostic.assetId}\0${diagnostic.detail}`;
    if (previousDiagnostic !== null && compareUtf8(previousDiagnostic, key) >= 0) return false;
    previousDiagnostic = key;
  }
  return (value.status === "verified") === (value.diagnostics.length === 0);
}

function validateManifestShape(manifest) {
  if (!isPlainObject(manifest) || !hasExactKeys(manifest, ["$schema", "assets", "schemaVersion"])) {
    throw new Error("runtime asset manifest fields do not match the closed v1 contract");
  }
  if (manifest.$schema !== RUNTIME_ASSET_MANIFEST_V1.schema || manifest.schemaVersion !== 1) {
    throw new Error("runtime asset manifest schema version is unsupported");
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length > RUNTIME_ASSET_MANIFEST_V1.maximumAssets) {
    throw new Error(`runtime asset manifest accepts at most ${RUNTIME_ASSET_MANIFEST_V1.maximumAssets} assets`);
  }
  for (const asset of manifest.assets) validateAsset(asset);
}

function validateAsset(asset) {
  if (!isPlainObject(asset) || !hasExactKeys(asset, [
    "bytes",
    "externalUri",
    "gitBlob",
    "id",
    "license",
    "load",
    "mime",
    "provenance",
    "repositoryPath",
    "sha256",
    "source"
  ])) throw new Error("runtime asset fields do not match the closed v1 contract");
  if (!ASSET_ID.test(asset.id ?? "")) throw new Error(`runtime asset id is invalid: ${String(asset.id)}`);
  if (!new Set(["repository", "external"]).has(asset.source)) throw new Error(`runtime asset source is invalid: ${asset.id}`);
  if (!MIME_TYPE.test(asset.mime ?? "")) throw new Error(`runtime asset MIME type is invalid: ${asset.id}`);
  if (
    executableMimeTypes.has(asset.mime)
    || (asset.repositoryPath !== null && executableAssetExtension.test(asset.repositoryPath))
  ) throw new Error(`executable code or shader content cannot use the runtime asset channel: ${asset.id}`);
  if (!Number.isInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > RUNTIME_ASSET_MANIFEST_V1.maximumAssetBytes) {
    throw new Error(`runtime asset size is outside the bounded contract: ${asset.id}`);
  }
  if (asset.sha256 !== null && !SHA256_DIGEST.test(asset.sha256)) throw new Error(`runtime asset SHA-256 is invalid: ${asset.id}`);
  if (asset.source === "repository") {
    if (
      !isCanonicalReviewTargetPath(asset.repositoryPath)
      || asset.externalUri !== null
      || !LOWER_HEX_40.test(asset.gitBlob ?? "")
      || !SHA256_DIGEST.test(asset.sha256 ?? "")
    ) throw new Error(`repository runtime asset binding is incomplete: ${asset.id}`);
  } else if (
    asset.repositoryPath !== null
    || asset.gitBlob !== null
    || !isSafeExternalUri(asset.externalUri)
  ) throw new Error(`external runtime asset binding is invalid: ${asset.id}`);
  validateLoad(asset.load, asset.id);
  validateLicense(asset.license, asset.id);
  validateProvenance(asset.provenance, asset.id);
}

function validateLoad(load, assetId) {
  if (!isPlainObject(load) || !hasExactKeys(load, ["failureBehavior", "integrityEnforced", "mechanism", "phase", "reference"])) {
    throw new Error(`runtime asset load declaration is invalid: ${assetId}`);
  }
  if (
    !loadPhases.has(load.phase)
    || !loadMechanisms.has(load.mechanism)
    || !isBoundedText(load.reference)
    || !isBoundedText(load.failureBehavior)
    || !new Set([true, false, null]).has(load.integrityEnforced)
  ) throw new Error(`runtime asset load declaration is invalid: ${assetId}`);
}

function validateLicense(license, assetId) {
  if (!isPlainObject(license) || !hasExactKeys(license, ["evidencePath", "expression", "status", "url"])) {
    throw new Error(`runtime asset license declaration is invalid: ${assetId}`);
  }
  if (
    !licenseStatuses.has(license.status)
    || (license.expression !== null && !isBoundedText(license.expression, 300))
    || (license.evidencePath !== null && !isCanonicalReviewTargetPath(license.evidencePath))
    || (license.url !== null && !isSafeExternalUri(license.url))
  ) throw new Error(`runtime asset license declaration is invalid: ${assetId}`);
  if (license.status === "declared" && license.expression === null && license.evidencePath === null && license.url === null) {
    throw new Error(`declared runtime asset license needs an expression or evidence: ${assetId}`);
  }
}

function validateProvenance(provenance, assetId) {
  if (!isPlainObject(provenance) || !hasExactKeys(provenance, ["creator", "evidencePath", "kind", "source"])) {
    throw new Error(`runtime asset provenance declaration is invalid: ${assetId}`);
  }
  if (
    !provenanceKinds.has(provenance.kind)
    || !isBoundedText(provenance.source)
    || (provenance.creator !== null && !isBoundedText(provenance.creator, 300))
    || (provenance.evidencePath !== null && !isCanonicalReviewTargetPath(provenance.evidencePath))
  ) throw new Error(`runtime asset provenance declaration is invalid: ${assetId}`);
}

function inspectRepositoryAsset(repositoryRoot, asset) {
  const treeRecord = runGit(repositoryRoot, ["ls-tree", "--full-tree", "HEAD", "--", asset.repositoryPath], "runtime asset tree entry");
  const match = REGULAR_BLOB.exec(treeRecord);
  if (!match || match[3] !== asset.repositoryPath) {
    throw new Error(`runtime asset must be a non-executable regular blob in HEAD: ${asset.repositoryPath}`);
  }
  const gitBlob = match[2];
  if (gitBlob !== asset.gitBlob) throw new Error(`runtime asset Git blob does not match HEAD: ${asset.repositoryPath}`);
  const gitBytes = parseBoundedInteger(
    runGit(repositoryRoot, ["cat-file", "-s", gitBlob], "runtime asset blob size"),
    RUNTIME_ASSET_MANIFEST_V1.maximumAssetBytes,
    `runtime asset Git blob size is invalid: ${asset.repositoryPath}`
  );

  let pointer = null;
  if (gitBytes <= 4_096) {
    const result = spawnSafeGitSync(["-C", repositoryRoot, "cat-file", "blob", gitBlob], {
      encoding: null,
      timeout: 5_000,
      maxBuffer: 8_192
    });
    if (result.status !== 0 || !(result.stdout instanceof Uint8Array)) {
      throw new Error(`runtime asset Git blob is unavailable: ${asset.repositoryPath}`);
    }
    pointer = parseLfsPointer(Buffer.from(result.stdout));
  }

  const target = path.resolve(repositoryRoot, asset.repositoryPath);
  const stat = lstatRegularFile(target, asset.repositoryPath);
  if (pointer !== null) {
    if (pointer.bytes !== asset.bytes || pointer.sha256 !== asset.sha256) {
      throw new Error(`runtime asset Git LFS pointer does not match declared size and SHA-256: ${asset.repositoryPath}`);
    }
    if (stat.size === asset.bytes) {
      const observed = stableSha256(target, stat, asset.repositoryPath);
      if (observed !== asset.sha256) throw new Error(`materialized runtime asset SHA-256 differs from its Git LFS pointer: ${asset.repositoryPath}`);
      const classification = classifyMaterializedRuntimeAsset(target, stat, asset);
      return repositoryRecord(asset, classification === "verified"
        ? "content-hash-verified"
        : "content-classification-review-required");
    }
    return repositoryRecord(asset, "git-lfs-pointer-bound");
  }

  if (gitBytes !== asset.bytes) throw new Error(`runtime asset size does not match its Git blob: ${asset.repositoryPath}`);
  const worktreeBlob = runGit(
    repositoryRoot,
    ["hash-object", "--no-filters", "--", asset.repositoryPath],
    "runtime asset worktree identity"
  );
  if (worktreeBlob !== gitBlob || stat.size !== asset.bytes) {
    return repositoryRecord(asset, "git-blob-review-required");
  }
  const observed = stableSha256(target, stat, asset.repositoryPath);
  if (observed !== asset.sha256) throw new Error(`runtime asset SHA-256 does not match the exact Git blob bytes: ${asset.repositoryPath}`);
  const classification = classifyMaterializedRuntimeAsset(target, stat, asset);
  return repositoryRecord(asset, classification === "verified"
    ? "content-hash-verified"
    : "content-classification-review-required");
}

function classifyMaterializedRuntimeAsset(target, expectedStat, asset) {
  return withStableAssetDescriptor(target, expectedStat, asset.repositoryPath, (descriptor, opened) => {
    const leading = readDescriptorRange(descriptor, 0, Math.min(opened.size, EXECUTABLE_SNIFF_BYTES));
    rejectExecutablePrefix(leading, asset.id);

    const extension = path.extname(asset.repositoryPath).toLowerCase();
    const binaryFormat = recognizedBinaryFormats[asset.mime];
    if (binaryFormat !== undefined) {
      const inspection = binaryFormat.inspect(descriptor, opened.size);
      if (inspection.executableSuffixOffset !== null) {
        const suffix = readDescriptorRange(
          descriptor,
          inspection.executableSuffixOffset,
          Math.min(opened.size - inspection.executableSuffixOffset, EXECUTABLE_SNIFF_BYTES)
        );
        rejectExecutablePrefix(suffix, asset.id);
      }
      return binaryFormat.extensions.has(extension) && inspection.closed === true
        ? "verified"
        : "review-required";
    }

    if (structuredJsonMimeTypes.has(asset.mime)) {
      if (opened.size > RUNTIME_ASSET_MANIFEST_V1.maximumStructuredTextSniffBytes) return "review-required";
      const bytes = readDescriptorRange(descriptor, 0, opened.size);
      try {
        JSON.parse(decodeStrictUtf8(bytes));
      } catch {
        rejectExecutablePrefix(bytes, asset.id);
        return "review-required";
      }
      return new Set([".geojson", ".gltf", ".json"]).has(extension)
        ? "verified"
        : "review-required";
    }

    return "review-required";
  });
}

function rejectExecutablePrefix(bytes, assetId) {
  let offset = 0;
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) offset = 3;
  while (offset < bytes.length && ASCII_WHITESPACE_BYTES.has(bytes[offset])) offset += 1;
  const prefix = bytes.subarray(offset);
  for (const magic of EXECUTABLE_BINARY_MAGICS) {
    if (prefix.subarray(0, magic.bytes.length).equals(magic.bytes)) {
      throw new Error(`executable ${magic.name} content cannot use the runtime asset channel: ${assetId}`);
    }
  }
  const text = decodeUtf8Prefix(prefix);
  if (text === null) return;
  const normalized = stripLeadingSourceComments(text).trimStart();
  if (
    /^(?:#!|<!doctype\s+html\b|<\?php\b|<(?:html|script|svg)\b)/iu.test(normalized)
    || /^(?:["']use strict["']\s*;|(?:async\s+)?function\s+[A-Za-z_$]|class\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[^\{]+)?\s*\{|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|(?:export|import)\s+(?:default\b|type\b|["'{*A-Za-z_$])|(?:await\s+)?(?:eval|fetch|require)\s*\(|new\s+(?:Function|SharedWorker|Worker)\s*\(|(?:console|document|globalThis|module\.exports|process|self|WebAssembly|window)\s*[.[]|\(?\s*(?:async\s*)?\([^)]*\)\s*=>|pragma\s+solidity\b)/u.test(normalized)
    || /^(?:#version\s+\d+\b|@(?:compute|fragment|vertex)\b|precision\s+(?:highp|lowp|mediump)\b)/u.test(normalized)
  ) {
    throw new Error(`executable script, markup or shader content cannot use the runtime asset channel: ${assetId}`);
  }
}

function stripLeadingSourceComments(source) {
  let remaining = source;
  for (let index = 0; index < 64; index += 1) {
    const line = /^\/\/[^\r\n]*(?:\r?\n|$)/u.exec(remaining);
    if (line) {
      remaining = remaining.slice(line[0].length).trimStart();
      continue;
    }
    const block = /^\/\*[\s\S]*?\*\//u.exec(remaining);
    if (block) {
      remaining = remaining.slice(block[0].length).trimStart();
      continue;
    }
    const markup = /^<!--[\s\S]*?-->/u.exec(remaining);
    if (markup) {
      remaining = remaining.slice(markup[0].length).trimStart();
      continue;
    }
    break;
  }
  return remaining;
}

function decodeUtf8Prefix(bytes) {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/\u0000/u.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function decodeStrictUtf8(bytes) {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (decoded.startsWith("\uFEFF")) return decoded.slice(1);
  return decoded;
}

function inspectGlb(descriptor, size) {
  if (size < 12) return ambiguousInspection();
  const header = readDescriptorRange(descriptor, 0, 12);
  if (header.toString("ascii", 0, 4) !== "glTF" || header.readUInt32LE(4) !== 2) return ambiguousInspection();
  const declared = header.readUInt32LE(8);
  if (!Number.isSafeInteger(declared) || declared < 20 || declared > size) return ambiguousInspection();
  if (declared < size) return { closed: false, executableSuffixOffset: declared };

  const jsonHeader = readDescriptorRange(descriptor, 12, 8);
  const jsonBytes = jsonHeader.readUInt32LE(0);
  if (
    jsonHeader.readUInt32LE(4) !== 0x4e4f534a
    || jsonBytes < 2
    || jsonBytes % 4 !== 0
    || 20 + jsonBytes > size
    || jsonBytes > RUNTIME_ASSET_MANIFEST_V1.maximumStructuredTextSniffBytes
  ) return ambiguousInspection();
  try {
    JSON.parse(decodeStrictUtf8(readDescriptorRange(descriptor, 20, jsonBytes)).trimEnd());
  } catch {
    return ambiguousInspection();
  }
  const nextOffset = 20 + jsonBytes;
  if (nextOffset === size) return { closed: true, executableSuffixOffset: null };
  if (nextOffset + 8 > size) return ambiguousInspection();
  const binaryHeader = readDescriptorRange(descriptor, nextOffset, 8);
  const binaryBytes = binaryHeader.readUInt32LE(0);
  if (binaryHeader.readUInt32LE(4) !== 0x004e4942 || nextOffset + 8 + binaryBytes !== size) {
    return ambiguousInspection();
  }
  return { closed: true, executableSuffixOffset: null };
}

function inspectPng(descriptor, size) {
  const signature = readDescriptorRange(descriptor, 0, Math.min(size, 8));
  if (!signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ambiguousInspection();
  let offset = 8;
  for (let chunks = 0; chunks < 1_000_000 && offset + 12 <= size; chunks += 1) {
    const header = readDescriptorRange(descriptor, offset, 8);
    const length = header.readUInt32BE(0);
    const boundary = offset + 12 + length;
    if (!Number.isSafeInteger(boundary) || boundary > size) return ambiguousInspection();
    const type = header.toString("ascii", 4, 8);
    if (chunks === 0 && (type !== "IHDR" || length !== 13)) return ambiguousInspection();
    if (type === "IEND") {
      if (length !== 0) return ambiguousInspection();
      return {
        closed: boundary === size,
        executableSuffixOffset: boundary === size ? null : boundary
      };
    }
    offset = boundary;
  }
  return ambiguousInspection();
}

function inspectJpeg(descriptor, size) {
  if (size < 4) return ambiguousInspection();
  const leading = readDescriptorRange(descriptor, 0, 2);
  const trailing = readDescriptorRange(descriptor, size - 2, 2);
  return {
    closed: leading.equals(Buffer.from([0xff, 0xd8])) && trailing.equals(Buffer.from([0xff, 0xd9])),
    executableSuffixOffset: null
  };
}

function inspectGif(descriptor, size) {
  if (size < 7) return ambiguousInspection();
  const leading = readDescriptorRange(descriptor, 0, 6).toString("ascii");
  const trailing = readDescriptorRange(descriptor, size - 1, 1)[0];
  return {
    closed: (leading === "GIF87a" || leading === "GIF89a") && trailing === 0x3b,
    executableSuffixOffset: null
  };
}

function inspectRiffWebp(descriptor, size) {
  return inspectRiff(descriptor, size, "WEBP");
}

function inspectRiffWave(descriptor, size) {
  return inspectRiff(descriptor, size, "WAVE");
}

function inspectRiff(descriptor, size, formType) {
  if (size < 12) return ambiguousInspection();
  const header = readDescriptorRange(descriptor, 0, 12);
  if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== formType) return ambiguousInspection();
  return closedLengthInspection(header.readUInt32LE(4) + 8, size);
}

function inspectWoff(descriptor, size) {
  if (size < 12) return ambiguousInspection();
  const header = readDescriptorRange(descriptor, 0, 12);
  if (header.toString("ascii", 0, 4) !== "wOFF") return ambiguousInspection();
  return closedLengthInspection(header.readUInt32BE(8), size);
}

function inspectWoff2(descriptor, size) {
  if (size < 12) return ambiguousInspection();
  const header = readDescriptorRange(descriptor, 0, 12);
  if (header.toString("ascii", 0, 4) !== "wOF2") return ambiguousInspection();
  return closedLengthInspection(header.readUInt32BE(8), size);
}

function closedLengthInspection(declaredLength, size) {
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > size) return ambiguousInspection();
  return {
    closed: declaredLength === size,
    executableSuffixOffset: declaredLength === size ? null : declaredLength
  };
}

function ambiguousInspection() {
  return { closed: false, executableSuffixOffset: null };
}

function withStableAssetDescriptor(target, expectedStat, repositoryPath, operation) {
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (
      !opened.isFile()
      || opened.dev !== expectedStat.dev
      || opened.ino !== expectedStat.ino
      || opened.size !== expectedStat.size
    ) throw new Error(`runtime asset changed while it was opened: ${repositoryPath}`);
    const result = operation(descriptor, opened);
    const finalStat = fs.fstatSync(descriptor);
    if (finalStat.size !== opened.size || finalStat.mtimeMs !== opened.mtimeMs) {
      throw new Error(`runtime asset changed while it was inspected: ${repositoryPath}`);
    }
    return result;
  } finally {
    fs.closeSync(descriptor);
  }
}

function readDescriptorRange(descriptor, offset, length) {
  const bytes = Buffer.alloc(length);
  let consumed = 0;
  while (consumed < length) {
    const count = fs.readSync(descriptor, bytes, consumed, length - consumed, offset + consumed);
    if (count <= 0) throw new Error("runtime asset ended during bounded content inspection");
    consumed += count;
  }
  return bytes;
}

function repositoryRecord(asset, verification) {
  return {
    id: asset.id,
    source: "repository",
    repositoryPath: asset.repositoryPath,
    externalUri: null,
    gitBlob: asset.gitBlob,
    sha256: asset.sha256,
    mime: asset.mime,
    bytes: asset.bytes,
    verification
  };
}

function stableSha256(target, expectedStat, repositoryPath) {
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (
      !opened.isFile()
      || opened.dev !== expectedStat.dev
      || opened.ino !== expectedStat.ino
      || opened.size !== expectedStat.size
    ) throw new Error(`runtime asset changed while it was opened: ${repositoryPath}`);
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(1_048_576);
    let offset = 0;
    while (offset < opened.size) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, opened.size - offset), offset);
      if (bytesRead <= 0) throw new Error(`runtime asset ended during hashing: ${repositoryPath}`);
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const finalStat = fs.fstatSync(descriptor);
    if (finalStat.size !== opened.size || finalStat.mtimeMs !== opened.mtimeMs) {
      throw new Error(`runtime asset changed while it was hashed: ${repositoryPath}`);
    }
    return `sha256:${hash.digest("hex")}`;
  } finally {
    fs.closeSync(descriptor);
  }
}

function lstatRegularFile(target, repositoryPath) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    throw new Error(`runtime asset worktree file is unavailable: ${repositoryPath}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`runtime asset worktree path is not a regular file: ${repositoryPath}`);
  }
  return stat;
}

function parseLfsPointer(bytes) {
  if (bytes.length > 4_096) return null;
  const match = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\noid sha256:([0-9a-f]{64})\r?\nsize ([1-9][0-9]{0,11})\r?\n?$/u.exec(bytes.toString("utf8"));
  if (!match) return null;
  const size = Number(match[2]);
  if (!Number.isSafeInteger(size) || size > RUNTIME_ASSET_MANIFEST_V1.maximumAssetBytes) {
    throw new Error("runtime asset Git LFS pointer size exceeds the bounded contract");
  }
  return { sha256: `sha256:${match[1]}`, bytes: size };
}

function runGit(repositoryRoot, args, label) {
  const result = spawnSafeGitSync(["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 65_536
  });
  if (result.status !== 0 || result.error) throw new Error(`${label} is unavailable`);
  return result.stdout.trim();
}

function parseBoundedInteger(source, maximum, message) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(source)) throw new Error(message);
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(message);
  return value;
}

function isSafeExternalUri(value) {
  if (!isBoundedText(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "ipfs:";
  } catch {
    return false;
  }
}

function isBoundedText(value, maximumBytes = RUNTIME_ASSET_MANIFEST_V1.maximumTextBytes) {
  return typeof value === "string"
    && value.length > 0
    && Buffer.byteLength(value, "utf8") <= maximumBytes
    && value.normalize("NFC") === value
    && !CONTROL_OR_BIDI.test(value);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort(compareUtf8);
  const sorted = [...expected].sort(compareUtf8);
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}
