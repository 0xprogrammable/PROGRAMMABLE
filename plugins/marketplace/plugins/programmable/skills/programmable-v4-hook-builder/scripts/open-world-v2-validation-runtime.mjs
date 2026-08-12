import {
  MAX_JSON_STRUCTURE_DEPTH,
  MAX_JSON_STRUCTURE_NODES,
  MAX_PACKAGE_FILE_BYTES,
  STRICT_PACKAGE_JSON_OPTIONS,
  canonicalJson,
  inspectJsonStructure,
  isObject,
  sha256Bytes,
  strictJsonStructureFailure
} from "./open-world-v2-primitives.mjs";
import { isSafeRepositoryPath } from "./open-world-v2-package-io.mjs";
import {
  extensionBytesFor,
  validateExtensionInstance
} from "./open-world-v2-extension-schema-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import {
  EXTENSION_SPLIT_REVIEW_CODES,
  EXTENSION_TOOLING_REVIEW_CODES,
  OPEN_WORLD_V2_REPORT_VERSION,
  OPEN_WORLD_V2_STANDARD_VERSION,
  STRUCTURAL_SPLIT_REVIEW_CODES,
  builtinSchemaCatalog,
  digestPattern,
  severityOrder,
  slugPattern
} from "./open-world-v2-contracts.mjs";

export function createOpenWorldV2ValidationRuntime({
  submission,
  submissionBytes,
  records,
  supportingRecords,
  extensionSchemaBytes = {},
  fragmentLimits = {}
} = {}) {
  const context = {
    submission,
    submissionBytes,
    records,
    supportingRecords,
    extensionSchemaBytes,
    fragmentLimits
  };
  const findings = [];
  const splitReasons = [];
  const add = (severity, code, findingPath, message, details = null) => {
    findings.push({ severity, code, path: findingPath, message, ...(details === null ? {} : { details }) });
  };
  const addSplitReason = (reason) => {
    const key = canonicalJson(reason);
    if (!splitReasons.some((candidate) => canonicalJson(candidate) === key)) splitReasons.push(reason);
  };
  const parseStrictRecordJson = (bytes, {
    collection,
    findingPath,
    invalidCode,
    invalidMessage,
    structureMessage
  }) => {
    let parsed;
    try {
      parsed = parseBoundedStrictJsonBytes(bytes, STRICT_PACKAGE_JSON_OPTIONS);
    } catch (cause) {
      const strictStructure = strictJsonStructureFailure(cause);
      if (strictStructure !== null) {
        addSplitReason({
          collection,
          code: strictStructure.code,
          maxDepth: MAX_JSON_STRUCTURE_DEPTH,
          maxNodes: MAX_JSON_STRUCTURE_NODES,
          maxBytes: MAX_PACKAGE_FILE_BYTES
        });
        add("split-review", strictStructure.code, findingPath, structureMessage, {
          maxDepth: MAX_JSON_STRUCTURE_DEPTH,
          maxNodes: MAX_JSON_STRUCTURE_NODES,
          maxBytes: MAX_PACKAGE_FILE_BYTES,
          ideaEligibility: "ELIGIBLE_FOR_REVIEW",
          designEligible: true,
          automaticMaterialization: false
        });
      } else {
        add("blocker", invalidCode, findingPath, invalidMessage);
      }
      return null;
    }
    const structure = inspectJsonStructure(parsed);
    if (!structure.ok) {
      const splitReview = STRUCTURAL_SPLIT_REVIEW_CODES.has(structure.code);
      if (splitReview) addSplitReason({ collection, code: structure.code, maxDepth: structure.maxDepth, maxNodes: structure.maxNodes, maxBytes: structure.maxBytes });
      add(splitReview ? "split-review" : "blocker", structure.code, findingPath, structureMessage, {
        maxDepth: structure.maxDepth,
        maxNodes: structure.maxNodes,
        maxBytes: structure.maxBytes,
        ...(splitReview ? {
          ideaEligibility: "ELIGIBLE_FOR_REVIEW",
          designEligible: true,
          automaticMaterialization: false
        } : {})
      });
      return null;
    }
    return parsed;
  };
  const requireObject = (value, findingPath, code) => {
    if (isObject(value)) return true;
    add("blocker", code, findingPath, "Expected an object.");
    return false;
  };
  const requireArray = (value, findingPath, code) => {
    if (Array.isArray(value)) return value;
    add("blocker", code, findingPath, "Expected an array.");
    return [];
  };
  const requireSlug = (value, findingPath, code = "SLUG_INVALID") => {
    if (typeof value !== "string" || value.length > 120 || !slugPattern.test(value)) add("blocker", code, findingPath, "Expected a lowercase open slug.");
  };
  const structuralFailureReport = () => {
    findings.sort((left, right) => (severityOrder[left.severity] ?? 99) - (severityOrder[right.severity] ?? 99) || left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
    const blockerCount = findings.filter(({ severity }) => severity === "blocker").length;
    const splitReviewRequired = splitReasons.length > 0;
    const valid = blockerCount === 0 && splitReviewRequired;
    return {
      reportVersion: OPEN_WORLD_V2_REPORT_VERSION,
      standardVersion: OPEN_WORLD_V2_STANDARD_VERSION,
      valid,
      ok: valid,
      status: valid ? "SPLIT_REVIEW_REQUIRED" : "INVALID",
      reviewRequired: false,
      ideaEligibility: "ELIGIBLE_FOR_REVIEW",
      designEligible: true,
      automaticMaterialization: false,
      writePerformed: false,
      counts: {
        blocker: blockerCount,
        review: 0,
        splitReview: findings.filter(({ severity }) => severity === "split-review").length
      },
      splitReview: { required: splitReviewRequired, reasons: splitReasons.slice().sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))) },
      security: null,
      findings
    };
  };
  const extensionCache = new Map();

  function validateSchemaBinding(binding, payload, findingPath, bindingRole) {
    if (!requireObject(binding, findingPath, "SCHEMA_BINDING_MISSING")) return;
    if (typeof binding.schemaId !== "string" || binding.schemaId.length === 0) add("blocker", "SCHEMA_ID_MISSING", `${findingPath}.schemaId`, "A schema binding requires a non-empty schemaId.");
    if (binding.kind === "builtin") {
      if (binding.path !== null || binding.sha256 !== null || binding.byteLength !== null) add("blocker", "BUILTIN_SCHEMA_BINDING_INVALID", findingPath, "Builtin schemas use null path, sha256, and byteLength.");
      const catalogEntry = builtinSchemaCatalog.get(binding.schemaId);
      if (!catalogEntry || !catalogEntry.appliesTo.includes(bindingRole)) add("blocker", "BUILTIN_SCHEMA_NOT_CATALOGED", `${findingPath}.schemaId`, "Unknown or context-invalid builtin schema ID. Bind a cataloged versioned builtin or exact repository schema bytes.", { schemaId: binding.schemaId, bindingRole });
      if (catalogEntry?.validation === "draft-only" && context.submission.stage !== "proposal") add("blocker", "DRAFT_SCHEMA_OUTSIDE_PROPOSAL", findingPath, "The unconfirmed draft builtin is valid only at proposal stage.");
      return;
    }
    if (binding.kind !== "repository") {
      add("blocker", "SCHEMA_BINDING_KIND_INVALID", `${findingPath}.kind`, "Schema kind must be builtin or repository.");
      return;
    }
    if (!isSafeRepositoryPath(binding.path)) {
      add("blocker", "EXTENSION_SCHEMA_PATH_INVALID", `${findingPath}.path`, "Repository schema path is unsafe or invalid.");
      return;
    }
    const supplied = extensionBytesFor(extensionSchemaBytes, binding.path);
    if (supplied === undefined) {
      add("blocker", "EXTENSION_SCHEMA_BYTES_MISSING", findingPath, "Exact bytes for the repository extension schema are missing.");
      return;
    }
    const bytes = Buffer.isBuffer(supplied) ? supplied : Buffer.from(supplied);
    if (bytes.length > MAX_PACKAGE_FILE_BYTES) {
      addSplitReason({ collection: `extension-schema:${binding.path}`, code: "JSON_STRUCTURE_BYTE_LIMIT", count: bytes.length, limit: MAX_PACKAGE_FILE_BYTES });
      add("split-review", "JSON_STRUCTURE_BYTE_LIMIT", findingPath, "Repository extension schema bytes exceed one bounded review package.", {
        byteLength: bytes.length,
        maxBytes: MAX_PACKAGE_FILE_BYTES,
        ideaEligibility: "ELIGIBLE_FOR_REVIEW",
        designEligible: true,
        automaticMaterialization: false
      });
      return;
    }
    if (!digestPattern.test(binding.sha256 ?? "") || sha256Bytes(bytes) !== binding.sha256) add("blocker", "EXTENSION_SCHEMA_HASH_MISMATCH", `${findingPath}.sha256`, "Extension schema SHA-256 does not match its exact bytes.");
    if (!Number.isInteger(binding.byteLength) || binding.byteLength !== bytes.length) add("blocker", "EXTENSION_SCHEMA_LENGTH_MISMATCH", `${findingPath}.byteLength`, "Extension schema byte length does not match its exact bytes.");
    let parsed = extensionCache.get(binding.path);
    if (!parsed) {
      parsed = parseStrictRecordJson(bytes, {
        collection: `extension-schema:${binding.path}`,
        findingPath,
        invalidCode: "EXTENSION_SCHEMA_JSON_INVALID",
        invalidMessage: "Repository extension schema bytes are not valid duplicate-free JSON.",
        structureMessage: "Repository extension schema exceeds a safe JSON structural boundary."
      });
      if (parsed === null) return;
      extensionCache.set(binding.path, parsed);
    }
    if (!isObject(parsed) || parsed.$id !== binding.schemaId) {
      add("blocker", "EXTENSION_SCHEMA_ID_MISMATCH", `${findingPath}.schemaId`, "Bound schemaId does not match the extension schema $id.");
      return;
    }
    for (const issue of validateExtensionInstance(payload, parsed)) {
      if (EXTENSION_SPLIT_REVIEW_CODES.has(issue.code)) {
        addSplitReason({ collection: `extension-schema:${binding.path}`, code: issue.code });
        add("split-review", "EXTENSION_SCHEMA_SPLIT_REVIEW_REQUIRED", findingPath, issue.message, {
          schemaCode: issue.code,
          instancePath: issue.path,
          ideaEligibility: "ELIGIBLE_FOR_REVIEW",
          designEligible: true,
          automaticMaterialization: false,
          remediation: "Split the schema or payload into bounded content-addressed review fragments."
        });
      } else if (EXTENSION_TOOLING_REVIEW_CODES.has(issue.code)) {
        add("review", "EXTENSION_SCHEMA_TOOLING_REVIEW_REQUIRED", findingPath, issue.message, {
          schemaCode: issue.code,
          instancePath: issue.path,
          route: "INTEGRATION_PENDING",
          classification: "tooling-review",
          writePerformed: false
        });
      } else {
        add("blocker", "EXTENSION_PAYLOAD_INVALID", findingPath, issue.message, { schemaCode: issue.code, instancePath: issue.path });
      }
    }
  }

  Object.assign(context, {
    findings,
    splitReasons,
    add,
    addSplitReason,
    parseStrictRecordJson,
    requireObject,
    requireArray,
    requireSlug,
    structuralFailureReport,
    validateSchemaBinding
  });
  return context;
}
