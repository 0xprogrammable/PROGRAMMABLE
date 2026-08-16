import {
  CliFailure,
  requireJsonResult,
  runBundledCommand
} from "./cli-runtime.mjs";
import { canonicalJson, STANDARD_VERSION } from "./submission-core.mjs";
import {
  appendReviewTargetClosureDiagnostics,
  calculateReviewTargetHash
} from "./review-target-core.mjs";
import { isExternalPackageReviewRecord } from "./package-dependency-contract.mjs";
import {
  isCanonicalReviewTargetPath,
  isClosedReviewTargetClosure,
  REVIEW_TARGET_CLOSURE_METHOD_V1,
  REVIEW_TARGET_CONTRACT_V1
} from "./review-target-contract.mjs";
import { isClosedRuntimeAssetReview } from "./runtime-assets-core.mjs";
import {
  DIGEST_PATTERN,
  REVIEW_DIGEST_PATTERN,
  compareUtf8,
  containsUnsafeText
} from "./cli-prepare-pr-values.mjs";

export function buildReviewTargetDocument(repositoryRoot, packageRoot, additionalClosureDiagnostics = []) {
  let reviewTarget;
  try {
    reviewTarget = requireJsonResult(
      runBundledCommand(
        "cli-review-target.mjs",
        [repositoryRoot, packageRoot],
        { cwd: repositoryRoot, failureCode: "REVIEW_TARGET_INVALID" }
      ),
      "cli-review-target.mjs"
    );
    reviewTarget = appendReviewTargetClosureDiagnostics(reviewTarget, additionalClosureDiagnostics);
  } catch (error) {
    if (error instanceof CliFailure && /Git LFS pointer/u.test(error.message)) {
      throw new CliFailure(
        "TOOLING_BLOCKED",
        "declared source/test Git LFS content must be materialized before prepare-pr",
        { exitCode: 1, details: error.details }
      );
    }
    throw error;
  }
  return validatePreparePrReviewTarget(reviewTarget);
}

export function validatePreparePrReviewTarget(reviewTarget) {
  const topLevelKeys = [
    "closure",
    "closureMethod",
    "externalImports",
    "files",
    "importResolutions",
    "javascriptImportResolutions",
    "reviewTargetHash",
    "schemaVersion",
    "standardVersion",
    "submissionHash",
    ...(Object.hasOwn(reviewTarget ?? {}, "runtimeAssets") ? ["runtimeAssets"] : [])
  ];
  if (
    !isPlainObject(reviewTarget)
    || !hasExactKeys(reviewTarget, topLevelKeys)
    || reviewTarget.schemaVersion !== 1
    || reviewTarget.standardVersion !== STANDARD_VERSION
    || reviewTarget.closureMethod !== REVIEW_TARGET_CLOSURE_METHOD_V1
    || !isClosedReviewTargetClosure(reviewTarget.closure)
    || !DIGEST_PATTERN.test(reviewTarget.reviewTargetHash ?? "")
    || !DIGEST_PATTERN.test(reviewTarget.submissionHash ?? "")
    || !Array.isArray(reviewTarget.files)
    || reviewTarget.files.length === 0
    || reviewTarget.files.length > REVIEW_TARGET_CONTRACT_V1.maximumFiles
    || !Array.isArray(reviewTarget.externalImports)
    || !Array.isArray(reviewTarget.importResolutions)
    || !Array.isArray(reviewTarget.javascriptImportResolutions)
    || (Object.hasOwn(reviewTarget, "runtimeAssets") && !isClosedRuntimeAssetReview(reviewTarget.runtimeAssets))
    || reviewTarget.reviewTargetHash !== calculateReviewTargetHash(reviewTarget)
  ) {
    throw new CliFailure("REVIEW_TARGET_INVALID", "the review target did not produce a bounded exact identity", { exitCode: 1 });
  }
  const paths = new Set();
  let totalBytes = 0;
  let previousPath = null;
  for (const record of reviewTarget.files) {
    const declaresExternalPackage = Object.hasOwn(record ?? {}, "sourceClass")
      || Object.hasOwn(record ?? {}, "packageDependency");
    const expectedRecordKeys = declaresExternalPackage
      ? ["bytes", "kind", "packageDependency", "path", "sha256", "sourceClass"]
      : ["bytes", "kind", "path", "sha256"];
    if (
      !isPlainObject(record)
      || !hasExactKeys(record, expectedRecordKeys)
      || !isCanonicalReviewTargetPath(record.path)
      || !isBoundedReviewText(record.kind, 200)
      || !Number.isInteger(record.bytes)
      || record.bytes < 0
      || record.bytes > REVIEW_TARGET_CONTRACT_V1.maximumFileBytes
      || !REVIEW_DIGEST_PATTERN.test(record.sha256 ?? "")
      || paths.has(record.path)
      || (previousPath !== null && compareUtf8(previousPath, record.path) >= 0)
      || (declaresExternalPackage && !isExternalPackageReviewRecord(record))
      || (declaresExternalPackage && !hasExactKeys(record.packageDependency, [
        "centralSourceVerified",
        "evidenceState",
        "integrity",
        "integrityVerified",
        "packageName",
        "repository",
        "revision",
        "version"
      ]))
    ) {
      throw new CliFailure("REVIEW_TARGET_INVALID", "the review target contains an unpublishable file record", { exitCode: 1 });
    }
    previousPath = record.path;
    paths.add(record.path);
    totalBytes += record.bytes;
    if (totalBytes > REVIEW_TARGET_CONTRACT_V1.maximumTotalBytes) {
      throw new CliFailure("REVIEW_TARGET_INVALID", "the review target exceeds the canonical total byte limit", { exitCode: 1 });
    }
  }
  validateClosedStringSet(reviewTarget.externalImports, "external import");
  validateClosedImportResolutions(reviewTarget.importResolutions, { javascript: false });
  validateClosedImportResolutions(reviewTarget.javascriptImportResolutions, { javascript: true });
  return reviewTarget;
}

export function validateClosedStringSet(values, label) {
  if (values.length > REVIEW_TARGET_CONTRACT_V1.maximumImportResolutions) {
    throw new CliFailure("REVIEW_TARGET_INVALID", `the review target contains too many ${label} records`, { exitCode: 1 });
  }
  const seen = new Set();
  let previous = null;
  for (const value of values) {
    if (
      !isBoundedReviewText(value, 1_024)
      || seen.has(value)
      || (previous !== null && compareUtf8(previous, value) >= 0)
    ) {
      throw new CliFailure("REVIEW_TARGET_INVALID", `the review target contains an invalid ${label} record`, { exitCode: 1 });
    }
    seen.add(value);
    previous = value;
  }
}

export function validateClosedImportResolutions(records, { javascript }) {
  if (records.length > REVIEW_TARGET_CONTRACT_V1.maximumImportResolutions) {
    throw new CliFailure("REVIEW_TARGET_INVALID", "the review target contains too many import resolution records", { exitCode: 1 });
  }
  const identities = new Set();
  let previous = null;
  for (const record of records) {
    const keys = javascript
      ? ["importer", "kind", "resolvedPath", "specifier"]
      : Object.hasOwn(record ?? {}, "packageName")
        ? ["importer", "kind", "packageName", "remappingPrefix", "remappingTarget", "resolvedPath", "specifier"]
        : ["importer", "kind", "remappingPrefix", "remappingTarget", "resolvedPath", "specifier"];
    if (
      !isPlainObject(record)
      || !hasExactKeys(record, keys)
      || !isCanonicalReviewTargetPath(record.importer)
      || !isCanonicalReviewTargetPath(record.resolvedPath)
      || !isBoundedReviewText(record.kind, 200)
      || !isBoundedReviewText(record.specifier, 1_024)
      || (!javascript && !isNullableBoundedReviewText(record.remappingPrefix, 1_024))
      || (!javascript && !isNullableBoundedReviewText(record.remappingTarget, 1_024))
      || (Object.hasOwn(record, "packageName") && !isBoundedReviewText(record.packageName, 214))
    ) {
      throw new CliFailure("REVIEW_TARGET_INVALID", "the review target contains an invalid import resolution record", { exitCode: 1 });
    }
    const identity = canonicalJson(record);
    if (
      identities.has(identity)
      || (previous !== null && compareImportResolutionRecords(previous, record) >= 0)
    ) {
      throw new CliFailure("REVIEW_TARGET_INVALID", "the review target contains duplicate or noncanonically ordered import resolution records", { exitCode: 1 });
    }
    identities.add(identity);
    previous = record;
  }
}

export function compareImportResolutionRecords(left, right) {
  return compareUtf8(left.specifier, right.specifier)
    || compareUtf8(left.importer, right.importer)
    || compareUtf8(left.resolvedPath, right.resolvedPath)
    || compareUtf8(canonicalJson(left), canonicalJson(right));
}

export function isNullableBoundedReviewText(value, maximumBytes) {
  return value === null || isBoundedReviewText(value, maximumBytes);
}

export function isBoundedReviewText(value, maximumBytes) {
  return typeof value === "string"
    && value.length > 0
    && Buffer.byteLength(value, "utf8") <= maximumBytes
    && value.normalize("NFC") === value
    && !containsUnsafeText(value);
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort(compareUtf8);
  const sortedExpected = [...expected].sort(compareUtf8);
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}
