import { canonicalJson, validateAgainstSchema } from "./submission-core.mjs";
import { sha256Bytes } from "./open-world-v2-core.mjs";
import {
  compareUtf8,
  createFindingAdder,
  fatalUtf8Decoder,
  gitObjectPattern,
  isObject,
  readJson,
  sourceManifestReport
} from "./public-pr-application-v3-shared.mjs";
import {
  gitBlobObjectId
} from "./public-pr-application-v3-source-git.mjs";

const sourceClosureManifestSchema = readJson(
  new URL("../references/source-closure-manifest-v1.schema.json", import.meta.url)
);

export function validateSourceClosureManifestV1(manifest, { schema = sourceClosureManifestSchema } = {}) {
  const findings = [];
  const seen = new Set();
  const add = createFindingAdder(findings, seen);

  for (const finding of validateAgainstSchema(manifest, schema)) {
    add(
      "blocker",
      finding.code,
      finding.path,
      finding.message,
      "Make the source-closure manifest match its versioned, content-addressed contract.",
      "source-closure-contract"
    );
  }
  if (!isObject(manifest)) return sourceManifestReport(findings);

  if (!Number.isSafeInteger(manifest.entryCount) || manifest.entryCount < 1) {
    add("blocker", "SOURCE_MANIFEST_ENTRY_COUNT_INVALID", "$.entryCount", "entryCount must be one positive safe integer.", "Regenerate the manifest with an exact logical entry count.", "tooling-transport");
  }
  if (!Number.isSafeInteger(manifest.fragmentCount) || manifest.fragmentCount < 1) {
    add("blocker", "SOURCE_MANIFEST_FRAGMENT_COUNT_INVALID", "$.fragmentCount", "fragmentCount must be one positive safe integer.", "Regenerate the manifest with an exact fragment count.", "tooling-transport");
  }

  const fragments = Array.isArray(manifest.fragments) ? manifest.fragments : [];
  if (manifest.fragmentCount !== fragments.length) {
    add("blocker", "SOURCE_MANIFEST_FRAGMENT_COUNT_MISMATCH", "$.fragmentCount", "fragmentCount does not equal the number of bound fragments.", "Bind every fragment exactly once and update the count.", "source-closure-binding");
  }
  const identities = {
    id: new Set(),
    path: new Set(),
    sequence: new Set()
  };
  let observedEntryCount = 0;
  let previousLastPath = null;
  for (const [index, fragment] of fragments.entries()) {
    const basePath = `$.fragments[${index}]`;
    if (!isObject(fragment)) continue;
    for (const field of ["id", "path", "sequence"]) {
      const value = fragment[field];
      if (identities[field].has(value)) {
        add("blocker", "SOURCE_MANIFEST_FRAGMENT_IDENTITY_DUPLICATE", `${basePath}.${field}`, `Fragment ${field} is duplicated.`, "Use one unique ID, path, and sequence for every fragment.", "source-closure-binding");
      }
      identities[field].add(value);
    }
    if (fragment.sequence !== index) {
      add("blocker", "SOURCE_MANIFEST_FRAGMENT_SEQUENCE_INVALID", `${basePath}.sequence`, "Fragments must use contiguous zero-based sequence numbers in array order.", "Sort the fragment bindings and number them from zero without gaps.", "source-closure-binding");
    }
    if (!Number.isSafeInteger(fragment.entryCount) || fragment.entryCount < 1) {
      add("blocker", "SOURCE_MANIFEST_FRAGMENT_ENTRY_COUNT_INVALID", `${basePath}.entryCount`, "A fragment needs one positive safe entry count.", "Regenerate the fragment binding from its exact entries.", "source-closure-binding");
    } else {
      observedEntryCount += fragment.entryCount;
      if (!Number.isSafeInteger(observedEntryCount)) {
        add("blocker", "SOURCE_MANIFEST_ENTRY_COUNT_OVERFLOW", "$.entryCount", "The summed fragment entry count exceeds safe integer precision.", "Split the review transport without changing the product idea.", "tooling-transport");
      }
    }
    if (typeof fragment.firstPath === "string" && typeof fragment.lastPath === "string") {
      if (compareUtf8(fragment.firstPath, fragment.lastPath) > 0) {
        add("blocker", "SOURCE_MANIFEST_FRAGMENT_RANGE_INVALID", basePath, "A fragment firstPath sorts after its lastPath.", "Regenerate the fragment from bytewise-sorted repository paths.", "source-closure-binding");
      }
      if (previousLastPath !== null && compareUtf8(previousLastPath, fragment.firstPath) >= 0) {
        add("blocker", "SOURCE_MANIFEST_FRAGMENT_RANGE_OVERLAP", basePath, "Fragment path ranges overlap or are not strictly ordered.", "Regenerate non-overlapping fragments in UTF-8 bytewise path order.", "source-closure-binding");
      }
      previousLastPath = fragment.lastPath;
    }
  }
  if (Number.isSafeInteger(manifest.entryCount) && observedEntryCount !== manifest.entryCount) {
    add("blocker", "SOURCE_MANIFEST_ENTRY_COUNT_MISMATCH", "$.entryCount", "entryCount does not equal the sum of fragment entry counts.", "Regenerate the root binding from the exact fragment set.", "source-closure-binding");
  }
  return sourceManifestReport(findings);
}

export function verifyBoundSourceClosureManifestV1({ repository, manifest, bytes, observedBlobObjectId }) {
  const report = validateSourceClosureManifestV1(manifest);
  const findings = report.findings.map((finding) => ({ ...finding }));
  const seen = new Set(findings.map(({ code, path: findingPath }) => `${code}:${findingPath}`));
  const add = createFindingAdder(findings, seen);
  const binding = repository?.sourceManifest;

  if (!isObject(repository) || repository.sourceClosureMode !== "manifest" || !isObject(binding)) {
    add("blocker", "SOURCE_MANIFEST_BINDING_MISSING", "$.sourceManifest", "The repository does not declare manifest source-closure mode with an exact binding.", "Declare a complete sourceManifest binding before verifying its bytes.", "source-closure-binding");
    return sourceManifestReport(findings);
  }
  if (!Buffer.isBuffer(bytes)) {
    add("blocker", "SOURCE_MANIFEST_BYTES_INVALID", "$.sourceManifest", "Manifest verification requires the exact file bytes.", "Read the exact committed manifest blob without text normalization.", "source-closure-binding");
    return sourceManifestReport(findings);
  }
  let decoded = null;
  try {
    decoded = fatalUtf8Decoder.decode(bytes);
  } catch {
    add("blocker", "SOURCE_MANIFEST_UTF8_INVALID", "$.sourceManifest", "The bound manifest bytes are not valid UTF-8.", "Regenerate the canonical manifest as UTF-8 JSON.", "source-closure-binding");
  }
  if (decoded !== null && decoded !== `${canonicalJson(manifest)}\n`) {
    add("blocker", "SOURCE_MANIFEST_NOT_CANONICAL", "$.sourceManifest", "The bound manifest bytes are not canonical JSON with one final newline.", "Canonicalize the manifest before hashing and committing it.", "source-closure-binding");
  }
  if (binding.byteLength !== bytes.length || binding.sha256 !== sha256Bytes(bytes)) {
    add("blocker", "SOURCE_MANIFEST_BYTE_BINDING_MISMATCH", "$.sourceManifest", "Manifest bytes do not match the declared byte length and SHA-256.", "Bind the exact committed bytes.", "source-closure-binding");
  }
  if (!gitObjectPattern.test(observedBlobObjectId ?? "") || observedBlobObjectId !== binding.blobObjectId) {
    add("blocker", "SOURCE_MANIFEST_BLOB_BINDING_MISMATCH", "$.sourceManifest.blobObjectId", "The observed Git blob does not match the declared manifest blob.", "Read the manifest blob from the exact declared commit and path.", "source-closure-binding");
  }
  if (Buffer.isBuffer(bytes) && gitBlobObjectId(bytes) !== observedBlobObjectId) {
    add("blocker", "SOURCE_MANIFEST_GIT_OBJECT_HASH_MISMATCH", "$.sourceManifest.blobObjectId", "Raw manifest bytes do not hash to the Git blob identity returned for the pinned tree.", "Repair the local object database or alternate and rerun against intact raw Git objects.", "source-closure-binding");
  }
  for (const [manifestField, repositoryField] of [
    ["numericRepositoryId", "numericRepositoryId"],
    ["repositoryUri", "repositoryUri"]
  ]) {
    if (manifest?.repository?.[manifestField] !== repository?.[repositoryField]) {
      add("blocker", "SOURCE_MANIFEST_REPOSITORY_BINDING_MISMATCH", `$.repository.${manifestField}`, "Manifest repository identity does not match its application binding.", "Regenerate the manifest from the exact declared repository revision.", "source-closure-binding");
    }
  }
  if (binding.entryCount !== manifest?.entryCount || binding.fragmentCount !== manifest?.fragmentCount) {
    add("blocker", "SOURCE_MANIFEST_SUMMARY_BINDING_MISMATCH", "$.sourceManifest", "Manifest entry or fragment counts do not match the application binding.", "Copy the exact root-manifest counts into the application binding.", "source-closure-binding");
  }
  return sourceManifestReport(findings);
}
