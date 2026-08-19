import fs from "node:fs";
import path from "node:path";
import {
  MAX_JSON_STRUCTURE_DEPTH,
  MAX_JSON_STRUCTURE_NODES,
  MAX_PACKAGE_FILE_BYTES,
  STRICT_PACKAGE_JSON_OPTIONS,
  OpenWorldV2Error,
  inspectJsonStructure,
  isObject,
  strictJsonStructureFailure
} from "./open-world-v2-primitives.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;

export function isSafeRepositoryPath(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (path.posix.isAbsolute(value) || value.includes("\\") || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function isRepositorySchemaBinding(value) {
  return isObject(value)
    && Object.keys(value).sort().join("|") === "byteLength|kind|path|schemaId|sha256"
    && value.kind === "repository"
    && typeof value.schemaId === "string"
    && value.schemaId.length >= 1
    && value.schemaId.length <= 300
    && isSafeRepositoryPath(value.path)
    && digestPattern.test(value.sha256 ?? "")
    && Number.isInteger(value.byteLength)
    && value.byteLength >= 1;
}

function pathEscapesRoot(relativePath) {
  return relativePath === ".."
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath);
}

export function isPublicGitHubRepositoryTransport(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com" || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") return false;
    const segments = parsed.pathname.replace(/\.git$/u, "").split("/").filter(Boolean);
    return segments.length === 2 && segments.every((segment) => /^[A-Za-z0-9_.-]+$/u.test(segment));
  } catch {
    return false;
  }
}

function resolveWithin(root, relativePath) {
  if (!isSafeRepositoryPath(relativePath)) {
    throw new OpenWorldV2Error("UNSAFE_PACKAGE_PATH", `Unsafe repository-relative path: ${String(relativePath)}`, {
      details: { path: relativePath }
    });
  }
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (pathEscapesRoot(relative)) {
    throw new OpenWorldV2Error("PACKAGE_PATH_ESCAPE", `Path escapes package root: ${relativePath}`, {
      details: { path: relativePath }
    });
  }
  return resolved;
}

function parseJsonBytes(bytes, label) {
  try {
    const parsed = parseBoundedStrictJsonBytes(bytes, STRICT_PACKAGE_JSON_OPTIONS);
    const structure = inspectJsonStructure(parsed);
    if (!structure.ok) throw new OpenWorldV2Error("PACKAGE_JSON_STRUCTURE_INVALID", `${label} exceeds a safe JSON structural boundary.`, {
      details: {
        artifact: label,
        structureCode: structure.code,
        maxDepth: structure.maxDepth,
        maxNodes: structure.maxNodes,
        maxBytes: structure.maxBytes,
        status: "SPLIT_REVIEW_REQUIRED",
        splitReviewRequired: true,
        ideaEligibility: "ELIGIBLE_FOR_REVIEW",
        designEligible: true,
        automaticMaterialization: false,
        writePerformed: false,
        remediation: "Split the same project into bounded content-addressed review packages; this is not an idea, design, or product limit."
      }
    });
    return parsed;
  } catch (cause) {
    if (cause instanceof OpenWorldV2Error) throw cause;
    const structure = strictJsonStructureFailure(cause);
    if (structure !== null) {
      throw new OpenWorldV2Error("PACKAGE_JSON_STRUCTURE_INVALID", `${label} exceeds a safe JSON structural boundary.`, {
        details: {
          artifact: label,
          structureCode: structure.code,
          maxDepth: MAX_JSON_STRUCTURE_DEPTH,
          maxNodes: MAX_JSON_STRUCTURE_NODES,
          maxBytes: MAX_PACKAGE_FILE_BYTES,
          status: "SPLIT_REVIEW_REQUIRED",
          splitReviewRequired: true,
          ideaEligibility: "ELIGIBLE_FOR_REVIEW",
          designEligible: true,
          automaticMaterialization: false,
          writePerformed: false,
          remediation: "Split the same project into bounded content-addressed review packages; this is not an idea, design, or product limit."
        },
        cause
      });
    }
    throw new OpenWorldV2Error("PACKAGE_JSON_INVALID", `${label} is not valid JSON.`, {
      details: { artifact: label },
      cause
    });
  }
}

function readPackageFile(packageRoot, relativePath, {
  maxBytes = MAX_PACKAGE_FILE_BYTES,
  limitCode = "PACKAGE_FILE_TOO_LARGE",
  limitMessage = `Package artifact exceeds the ${MAX_PACKAGE_FILE_BYTES}-byte parser safety boundary.`,
  limitDetails = {}
} = {}) {
  const absolutePath = resolveWithin(packageRoot, relativePath);
  let cursor = packageRoot;
  try {
    const segments = relativePath.split("/");
    for (const [index, segment] of segments.entries()) {
      cursor = path.join(cursor, segment);
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new OpenWorldV2Error("PACKAGE_SYMLINK_FORBIDDEN", `Package paths may not contain symlinks: ${relativePath}`, { details: { path: relativePath } });
      if (index < segments.length - 1 && !stat.isDirectory()) throw new OpenWorldV2Error("PACKAGE_PATH_NOT_DIRECTORY", `Intermediate package path is not a directory: ${relativePath}`, { details: { path: relativePath } });
      if (index === segments.length - 1 && !stat.isFile()) throw new OpenWorldV2Error("PACKAGE_FILE_NOT_REGULAR", `Package artifact is not a regular file: ${relativePath}`, { details: { path: relativePath } });
    }
    const realPath = fs.realpathSync(absolutePath);
    const relativeRealPath = path.relative(packageRoot, realPath);
    if (pathEscapesRoot(relativeRealPath)) throw new OpenWorldV2Error("PACKAGE_PATH_ESCAPE", `Resolved artifact escapes package root: ${relativePath}`, { details: { path: relativePath } });
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    const descriptor = fs.openSync(realPath, flags);
    try {
      const stat = fs.fstatSync(descriptor);
      if (stat.size > Math.min(MAX_PACKAGE_FILE_BYTES, maxBytes)) throw new OpenWorldV2Error(limitCode, limitMessage, { details: {
        path: relativePath,
        byteLength: stat.size,
        maxBytes,
        status: "SPLIT_REVIEW_REQUIRED",
        splitReviewRequired: true,
        ideaEligibility: "ELIGIBLE_FOR_REVIEW",
        designEligible: true,
        automaticMaterialization: false,
        writePerformed: false,
        ...limitDetails
      } });
      return fs.readFileSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (cause) {
    if (cause instanceof OpenWorldV2Error) throw cause;
    throw new OpenWorldV2Error("PACKAGE_FILE_UNREADABLE", `Cannot read required package file ${relativePath}.`, {
      details: { path: relativePath },
      cause
    });
  }
}

function collectRepositoryBindings(value, output = new Set(), seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return output;
  seen.add(value);
  if (isRepositorySchemaBinding(value)) output.add(value.path);
  for (const entry of Array.isArray(value) ? value : Object.values(value)) collectRepositoryBindings(entry, output, seen);
  return output;
}

export function validateOpenWorldPackageFromDisk({
  packageRoot,
  fragmentLimits,
  artifacts,
  supportingArtifacts,
  optionalSupportingArtifacts,
  submissionFile,
  reviewPackageIoLimits,
  validateSubmissionPackage
} = {}) {
  if (typeof packageRoot !== "string" || packageRoot.length === 0) {
    throw new OpenWorldV2Error("PACKAGE_ROOT_REQUIRED", "packageRoot must be a non-empty path.");
  }
  const requestedRoot = path.resolve(packageRoot);
  let stat;
  try {
    stat = fs.lstatSync(requestedRoot);
  } catch (cause) {
    throw new OpenWorldV2Error("PACKAGE_ROOT_UNREADABLE", "packageRoot cannot be inspected.", {
      details: { packageRoot: requestedRoot },
      cause
    });
  }
  if (stat.isSymbolicLink()) throw new OpenWorldV2Error("PACKAGE_ROOT_SYMLINK_FORBIDDEN", "packageRoot may not be a symlink.", { details: { packageRoot: requestedRoot } });
  if (!stat.isDirectory()) throw new OpenWorldV2Error("PACKAGE_ROOT_NOT_DIRECTORY", "packageRoot must be a directory.", { details: { packageRoot: requestedRoot } });
  const root = fs.realpathSync(requestedRoot);

  const records = {};
  for (const [key, spec] of Object.entries(artifacts)) {
    const bytes = readPackageFile(root, spec.file);
    records[key] = { value: parseJsonBytes(bytes, spec.file), bytes };
  }
  const submissionBytes = readPackageFile(root, submissionFile);
  const submission = parseJsonBytes(submissionBytes, submissionFile);
  const supportingRecords = {};
  for (const [key, spec] of Object.entries(supportingArtifacts)) {
    if (key === "securityAssessment" && submission.supportingPackage?.securityAssessment === null) {
      const orphanPath = resolveWithin(root, spec.file);
      if (fs.existsSync(orphanPath)) throw new OpenWorldV2Error("PACKAGE_ORPHAN_SECURITY_ASSESSMENT", "security-assessment.v1.json exists but submission.v2.json intentionally defers the derived assessment with a null binding.", {
        details: {
          path: spec.file,
          implementationAuthorization: "NOT_GRANTED",
          remediation: "Remove the unbound source-owned assessment; derive and bind the exact assessment in the post-pin Application package."
        }
      });
      continue;
    }
    const bytes = readPackageFile(root, spec.file);
    supportingRecords[key] = { value: parseJsonBytes(bytes, spec.file), bytes };
  }
  if (submission.supportingPackage?.feePolicy !== null && submission.supportingPackage?.feePolicy !== undefined) {
    const spec = optionalSupportingArtifacts.feePolicy;
    const bytes = readPackageFile(root, spec.file);
    supportingRecords.feePolicy = { value: parseJsonBytes(bytes, spec.file), bytes };
  }
  const feeConformanceArtifacts = submission.programmableFee?.conformance?.scopeArtifacts;
  if (Array.isArray(feeConformanceArtifacts) && feeConformanceArtifacts.length > 0) {
    supportingRecords.feeConformance = feeConformanceArtifacts.map((artifact, index) => {
      const entry = { feeScopeRef: artifact?.feeScopeRef };
      for (const key of ["receipt", "vectorSet"]) {
        const artifactPath = artifact?.[key]?.path;
        if (typeof artifactPath !== "string") continue;
        const bytes = readPackageFile(root, artifactPath);
        entry[key] = {
          value: parseJsonBytes(bytes, `programmableFee.conformance.scopeArtifacts[${index}].${key}`),
          bytes
        };
      }
      return entry;
    });
  }
  const tradeCapabilityMarkets = submission.tradeCapability?.markets;
  if (Array.isArray(tradeCapabilityMarkets) && tradeCapabilityMarkets.length > 0) {
    supportingRecords.tradeCapabilities = tradeCapabilityMarkets.map((market, index) => {
      const artifactPath = market?.manifest?.path;
      const entry = { marketRef: market?.marketRef, manifest: null, quoteResults: [], executionResults: [] };
      if (typeof artifactPath !== "string") return entry;
      const bytes = readPackageFile(root, artifactPath);
      const manifest = parseJsonBytes(bytes, `tradeCapability.markets[${index}].manifest`);
      entry.manifest = {
        value: manifest,
        bytes
      };
      for (const [testsKey, recordsKey] of [["quoteTests", "quoteResults"], ["executionTests", "executionResults"]]) {
        const tests = manifest?.testEvidence?.[testsKey];
        if (!Array.isArray(tests)) continue;
        entry[recordsKey] = tests.map((test, testIndex) => {
          const resultPath = test?.resultArtifactPath;
          const resultEntry = { testId: test?.id, result: null };
          if (typeof resultPath !== "string") return resultEntry;
          const resultBytes = readPackageFile(root, resultPath);
          resultEntry.result = {
            value: parseJsonBytes(resultBytes, `tradeCapability.markets[${index}].manifest.testEvidence.${testsKey}[${testIndex}].resultArtifactPath`),
            bytes: resultBytes
          };
          return resultEntry;
        });
      }
      return entry;
    });
  }
  const extensionPaths = new Set();
  collectRepositoryBindings(submission, extensionPaths);
  for (const record of Object.values(records)) collectRepositoryBindings(record.value, extensionPaths);
  for (const record of Object.values(supportingRecords)) collectRepositoryBindings(record.value, extensionPaths);
  if (extensionPaths.size > reviewPackageIoLimits.extensionSchemaFiles) throw new OpenWorldV2Error(
    "PACKAGE_EXTENSION_SCHEMA_COUNT_LIMIT",
    "This review package binds more extension schemas than one bounded review package can safely load.",
    {
      details: {
        count: extensionPaths.size,
        limit: reviewPackageIoLimits.extensionSchemaFiles,
        status: "SPLIT_REVIEW_REQUIRED",
        splitReviewRequired: true,
        ideaEligibility: "ELIGIBLE_FOR_REVIEW",
        designEligible: true,
        automaticMaterialization: false,
        writePerformed: false,
        remediation: "Split the same project into multiple content-addressed review packages; this is not an idea, hook, or project limit."
      }
    }
  );
  const extensionSchemaBytes = Object.create(null);
  let extensionBytesRead = 0;
  for (const extensionPath of [...extensionPaths].sort()) {
    const remainingBytes = reviewPackageIoLimits.extensionSchemaBytes - extensionBytesRead;
    const bytes = readPackageFile(root, extensionPath, {
      maxBytes: remainingBytes,
      limitCode: "PACKAGE_EXTENSION_SCHEMA_BYTES_LIMIT",
      limitMessage: "Extension schemas exceed the cumulative byte budget for one bounded review package.",
      limitDetails: {
        cumulativeLimit: reviewPackageIoLimits.extensionSchemaBytes,
        bytesReadBeforeArtifact: extensionBytesRead,
        ideaEligibility: "ELIGIBLE_FOR_REVIEW",
        remediation: "Split the same project into multiple content-addressed review packages; this is not an idea, hook, or project limit."
      }
    });
    extensionBytesRead += bytes.length;
    extensionSchemaBytes[extensionPath] = bytes;
  }
  return validateSubmissionPackage({ submission, submissionBytes, records, supportingRecords, extensionSchemaBytes, fragmentLimits });
}
