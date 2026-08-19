import { analyzeOpenWorldSecurity } from "./open-world-security-core.mjs";
import {
  MAX_PACKAGE_FILE_BYTES,
  canonicalJson,
  inspectJsonStructure,
  isObject,
  sha256Bytes
} from "./open-world-v2-primitives.mjs";
import { isSafeRepositoryPath } from "./open-world-v2-package-io.mjs";
import { validateExtensionInstance } from "./open-world-v2-extension-schema-core.mjs";
import {
  validateTradeCapabilityManifestV1,
  validateTradeResultPairV1,
  validateTradeTestResultV1
} from "./trade-capability-manifest-core.mjs";
import {
  EXTENSION_SPLIT_REVIEW_CODES,
  OPEN_WORLD_V2_ARTIFACTS,
  OPEN_WORLD_V2_FEE_CONFORMANCE_ARTIFACTS,
  OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS,
  OPEN_WORLD_V2_SUPPORTING_ARTIFACTS,
  OPEN_WORLD_V2_TRADE_CAPABILITY_ARTIFACT,
  STRUCTURAL_SPLIT_REVIEW_CODES,
  bundledSchemas,
  isExactZeroScopeFeeNotApplicableDeclaration
} from "./open-world-v2-contracts.mjs";

export function validateOpenWorldV2Intake(context) {
  let { submission, records, supportingRecords } = context;
  const {
    submissionBytes,
    add,
    addSplitReason,
    parseStrictRecordJson,
    requireObject,
    structuralFailureReport
  } = context;
  const directSubmissionValue = submission;
  const directRecordsValue = records;
  const addTradeDomainFindings = (findings, basePath, details = {}) => {
    for (const finding of findings) {
      const suffix = finding.path === "$"
        ? ""
        : typeof finding.path === "string" && finding.path.startsWith("$")
          ? finding.path.slice(1)
          : "";
      add(finding.severity ?? "blocker", finding.code, `${basePath}${suffix}`, finding.message, {
        ...(finding.details ?? {}),
        ...details,
        evidenceStatus: "LOCAL_REPORTED_EVIDENCE_ONLY",
        implementationAuthorization: "NOT_GRANTED"
      });
    }
  };
  let structuralFailure = false;
  const inspectDirectValue = (value, findingPath) => {
    if (value === undefined) return;
    const result = inspectJsonStructure(value);
    if (result.ok) return;
    structuralFailure = true;
    const splitReview = STRUCTURAL_SPLIT_REVIEW_CODES.has(result.code);
    if (splitReview) addSplitReason({ collection: findingPath, code: result.code, limit: result.maxBytes, maxDepth: result.maxDepth, maxNodes: result.maxNodes });
    add(splitReview ? "split-review" : "blocker", result.code, findingPath, result.message, {
      maxDepth: result.maxDepth,
      maxNodes: result.maxNodes,
      maxBytes: result.maxBytes,
      ...(splitReview ? {
        ideaEligibility: "ELIGIBLE_FOR_REVIEW",
        designEligible: true,
        automaticMaterialization: false,
        remediation: "Split the same project into bounded content-addressed review packages."
      } : {})
    });
  };
  const inspectDirectBytes = (value, findingPath) => {
    if (!Buffer.isBuffer(value) && typeof value !== "string" && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) return;
    const byteLength = typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength;
    if (byteLength <= MAX_PACKAGE_FILE_BYTES) return;
    structuralFailure = true;
    addSplitReason({ collection: findingPath, code: "JSON_STRUCTURE_BYTE_LIMIT", count: byteLength, limit: MAX_PACKAGE_FILE_BYTES });
    add("split-review", "JSON_STRUCTURE_BYTE_LIMIT", findingPath, "JSON byte source exceeds one bounded review package; split review is required.", {
      byteLength,
      maxBytes: MAX_PACKAGE_FILE_BYTES,
      ideaEligibility: "ELIGIBLE_FOR_REVIEW",
      designEligible: true,
      automaticMaterialization: false,
      remediation: "Split the same project into bounded content-addressed review packages."
    });
  };
  inspectDirectValue(directSubmissionValue, "$");
  inspectDirectBytes(submissionBytes, "$.bytes");
  for (const [key] of Object.entries(OPEN_WORLD_V2_ARTIFACTS)) {
    inspectDirectValue(isObject(directRecordsValue) ? directRecordsValue[key]?.value : undefined, `$.records.${key}.value`);
    inspectDirectBytes(isObject(directRecordsValue) ? directRecordsValue[key]?.bytes : undefined, `$.records.${key}.bytes`);
  }
  if (isObject(supportingRecords)) {
    for (const key of [...Object.keys(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS), ...Object.keys(OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS)]) {
      inspectDirectValue(supportingRecords[key]?.value, `$.supportingRecords.${key}.value`);
      inspectDirectBytes(supportingRecords[key]?.bytes, `$.supportingRecords.${key}.bytes`);
    }
    if (Array.isArray(supportingRecords.feeConformance)) {
      supportingRecords.feeConformance.forEach((entry, index) => {
        for (const key of ["receipt", "vectorSet"]) {
          inspectDirectValue(entry?.[key]?.value, `$.supportingRecords.feeConformance[${index}].${key}.value`);
          inspectDirectBytes(entry?.[key]?.bytes, `$.supportingRecords.feeConformance[${index}].${key}.bytes`);
        }
      });
    }
    if (Array.isArray(supportingRecords.tradeCapabilities)) {
      supportingRecords.tradeCapabilities.forEach((entry, index) => {
        inspectDirectValue(entry?.manifest?.value, `$.supportingRecords.tradeCapabilities[${index}].manifest.value`);
        inspectDirectBytes(entry?.manifest?.bytes, `$.supportingRecords.tradeCapabilities[${index}].manifest.bytes`);
        for (const recordsKey of ["quoteResults", "executionResults"]) {
          if (!Array.isArray(entry?.[recordsKey])) continue;
          entry[recordsKey].forEach((resultEntry, resultIndex) => {
            inspectDirectValue(resultEntry?.result?.value, `$.supportingRecords.tradeCapabilities[${index}].${recordsKey}[${resultIndex}].result.value`);
            inspectDirectBytes(resultEntry?.result?.bytes, `$.supportingRecords.tradeCapabilities[${index}].${recordsKey}[${resultIndex}].result.bytes`);
          });
        }
      });
    }
  }
  if (structuralFailure) return structuralFailureReport();
  if (!requireObject(submission, "$", "SUBMISSION_INVALID")) submission = {};
  if (!requireObject(records, "$.records", "RECORDS_INVALID")) records = {};
  const parsedRecords = {};
  const recordDigests = {};
  for (const [key, spec] of Object.entries(OPEN_WORLD_V2_ARTIFACTS)) {
    const record = records[key];
    const recordPath = `$.records.${key}`;
    if (!requireObject(record, recordPath, "RECORD_MISSING")) continue;
    const bytes = Buffer.isBuffer(record.bytes) ? record.bytes : typeof record.bytes === "string" ? Buffer.from(record.bytes) : null;
    if (bytes === null) {
      add("blocker", "RECORD_BYTES_MISSING", `${recordPath}.bytes`, "Exact record bytes are required.");
      continue;
    }
    const parsed = parseStrictRecordJson(bytes, {
      collection: `record-bytes:${key}`,
      findingPath: `${recordPath}.bytes`,
      invalidCode: "RECORD_JSON_INVALID",
      invalidMessage: "Record bytes are not valid duplicate-free JSON.",
      structureMessage: "Record bytes exceed a safe JSON structural boundary."
    });
    if (parsed === null) continue;
    if (canonicalJson(parsed) !== canonicalJson(record.value)) add("blocker", "RECORD_VALUE_BYTES_MISMATCH", recordPath, "Parsed record bytes differ from the supplied record value.");
    parsedRecords[key] = parsed;
    recordDigests[key] = sha256Bytes(bytes);
    const binding = submission?.intentPackage?.[key];
    const bindingPath = `$.intentPackage.${key}`;
    if (!requireObject(binding, bindingPath, "ARTIFACT_BINDING_MISSING")) continue;
    if (binding.artifactType !== spec.artifactType) add("blocker", "ARTIFACT_TYPE_MISMATCH", `${bindingPath}.artifactType`, "Artifact binding uses the wrong artifact type.");
    if (binding.schemaId !== spec.schemaId) add("blocker", "ARTIFACT_SCHEMA_ID_MISMATCH", `${bindingPath}.schemaId`, "Artifact binding uses the wrong versioned schema ID.");
    if (binding.path !== spec.file) add("blocker", "ARTIFACT_PATH_MISMATCH", `${bindingPath}.path`, `Artifact must use the versioned filename ${spec.file}.`);
    if (binding.sha256 !== recordDigests[key]) add("blocker", "ARTIFACT_HASH_MISMATCH", `${bindingPath}.sha256`, "Artifact binding SHA-256 does not match exact bytes.");
    if (binding.byteLength !== bytes.length) add("blocker", "ARTIFACT_LENGTH_MISMATCH", `${bindingPath}.byteLength`, "Artifact binding byte length does not match exact bytes.");
  }
  if (!requireObject(supportingRecords, "$.supportingRecords", "SUPPORTING_RECORDS_INVALID")) supportingRecords = {};
  const parsedSupportingRecords = {};
  const supportingRecordBytes = {};
  let securityAnalysis = null;
  const supportingSpecs = {
    feePolicySchema: OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.feePolicySchema,
    securityAssessmentSchema: OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.securityAssessmentSchema
  };
  if (submission.supportingPackage?.feePolicy !== null && submission.supportingPackage?.feePolicy !== undefined) supportingSpecs.feePolicy = OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS.feePolicy;
  else if (supportingRecords.feePolicy !== undefined) add("blocker", "ORPHAN_FEE_POLICY_INSTANCE", "$.supportingRecords.feePolicy", "A fee-policy instance cannot exist without an exact supportingPackage binding.");
  const embeddedSecurityAssessment = submission.supportingPackage?.securityAssessment;
  if (embeddedSecurityAssessment !== null && embeddedSecurityAssessment !== undefined) supportingSpecs.securityAssessment = OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.securityAssessment;
  else if (supportingRecords.securityAssessment !== undefined) add("blocker", "ORPHAN_SECURITY_ASSESSMENT", "$.supportingRecords.securityAssessment", "A security assessment record cannot exist without an exact source-submission binding.");
  for (const [key, spec] of Object.entries(supportingSpecs)) {
    const record = supportingRecords[key];
    const recordPath = `$.supportingRecords.${key}`;
    if (!requireObject(record, recordPath, "SUPPORTING_RECORD_MISSING")) continue;
    const bytes = Buffer.isBuffer(record.bytes) ? record.bytes : typeof record.bytes === "string" ? Buffer.from(record.bytes) : null;
    if (bytes === null) {
      add("blocker", "SUPPORTING_RECORD_BYTES_MISSING", `${recordPath}.bytes`, "Exact supporting artifact bytes are required.");
      continue;
    }
    const parsed = parseStrictRecordJson(bytes, {
      collection: `supporting-record-bytes:${key}`,
      findingPath: `${recordPath}.bytes`,
      invalidCode: "SUPPORTING_RECORD_JSON_INVALID",
      invalidMessage: "Supporting artifact bytes are not valid duplicate-free UTF-8 JSON.",
      structureMessage: "Supporting artifact bytes exceed a safe JSON structural boundary."
    });
    if (parsed === null) continue;
    if (canonicalJson(parsed) !== canonicalJson(record.value)) add("blocker", "SUPPORTING_RECORD_VALUE_BYTES_MISMATCH", recordPath, "Parsed supporting artifact bytes differ from the supplied value.");
    parsedSupportingRecords[key] = parsed;
    supportingRecordBytes[key] = bytes;
    const binding = submission?.supportingPackage?.[key];
    const bindingPath = `$.supportingPackage.${key}`;
    if (!requireObject(binding, bindingPath, "SUPPORTING_ARTIFACT_BINDING_MISSING")) continue;
    if (binding.artifactType !== spec.artifactType) add("blocker", "SUPPORTING_ARTIFACT_TYPE_MISMATCH", `${bindingPath}.artifactType`, "Supporting artifact uses the wrong artifact type.");
    if (binding.schemaId !== spec.schemaId) add("blocker", "SUPPORTING_ARTIFACT_SCHEMA_ID_MISMATCH", `${bindingPath}.schemaId`, "Supporting artifact uses the wrong versioned schema ID.");
    if (binding.path !== spec.file) add("blocker", "SUPPORTING_ARTIFACT_PATH_MISMATCH", `${bindingPath}.path`, `Supporting artifact must use ${spec.file}.`);
    if (binding.sha256 !== sha256Bytes(bytes)) add("blocker", "SUPPORTING_ARTIFACT_HASH_MISMATCH", `${bindingPath}.sha256`, "Supporting artifact SHA-256 does not match exact bytes.");
    if (binding.byteLength !== bytes.length) add("blocker", "SUPPORTING_ARTIFACT_LENGTH_MISMATCH", `${bindingPath}.byteLength`, "Supporting artifact byte length does not match exact bytes.");
  }
  const declaredFeeConformanceArtifacts = Array.isArray(submission.programmableFee?.conformance?.scopeArtifacts)
    ? submission.programmableFee.conformance.scopeArtifacts
    : [];
  const suppliedFeeConformanceRecords = supportingRecords.feeConformance === undefined
    ? []
    : Array.isArray(supportingRecords.feeConformance)
      ? supportingRecords.feeConformance
      : null;
  if (suppliedFeeConformanceRecords === null) {
    add("blocker", "FEE_CONFORMANCE_SUPPORTING_RECORDS_INVALID", "$.supportingRecords.feeConformance", "Typed fee-conformance supporting records must be an array aligned to scopeArtifacts.");
  } else if (suppliedFeeConformanceRecords.length !== declaredFeeConformanceArtifacts.length) {
    add("blocker", "FEE_CONFORMANCE_SUPPORTING_RECORD_COUNT_MISMATCH", "$.supportingRecords.feeConformance", "Every declared fee-conformance scope artifact must have exactly one typed receipt/vector record pair.", {
      declared: declaredFeeConformanceArtifacts.length,
      supplied: suppliedFeeConformanceRecords.length
    });
  }
  const parsedFeeConformanceRecords = [];
  for (const [index, declaration] of declaredFeeConformanceArtifacts.entries()) {
    const declarationPath = `$.programmableFee.conformance.scopeArtifacts[${index}]`;
    const supplied = suppliedFeeConformanceRecords?.[index];
    const suppliedPath = `$.supportingRecords.feeConformance[${index}]`;
    const parsedEntry = { feeScopeRef: declaration?.feeScopeRef, receipt: null, vectorSet: null };
    if (!requireObject(supplied, suppliedPath, "FEE_CONFORMANCE_SUPPORTING_RECORD_MISSING")) {
      parsedFeeConformanceRecords.push(parsedEntry);
      continue;
    }
    if (supplied.feeScopeRef !== declaration?.feeScopeRef) add("blocker", "FEE_CONFORMANCE_SUPPORTING_SCOPE_MISMATCH", `${suppliedPath}.feeScopeRef`, "Typed fee-conformance records must align to the declared fee scope.");
    for (const key of ["receipt", "vectorSet"]) {
      const spec = OPEN_WORLD_V2_FEE_CONFORMANCE_ARTIFACTS[key];
      const binding = declaration?.[key];
      const bindingPath = `${declarationPath}.${key}`;
      const record = supplied[key];
      const recordPath = `${suppliedPath}.${key}`;
      if (!requireObject(binding, bindingPath, "FEE_CONFORMANCE_ARTIFACT_BINDING_MISSING")) continue;
      if (!requireObject(record, recordPath, "FEE_CONFORMANCE_SUPPORTING_RECORD_MISSING")) continue;
      if (binding.artifactType !== spec.artifactType) add("blocker", "FEE_CONFORMANCE_ARTIFACT_TYPE_MISMATCH", `${bindingPath}.artifactType`, `Typed ${key} binding uses the wrong artifact type.`);
      if (binding.schemaId !== spec.schemaId) add("blocker", "FEE_CONFORMANCE_ARTIFACT_SCHEMA_ID_MISMATCH", `${bindingPath}.schemaId`, `Typed ${key} binding uses the wrong schema ID.`);
      if (!isSafeRepositoryPath(binding.path)) add("blocker", "FEE_CONFORMANCE_ARTIFACT_PATH_INVALID", `${bindingPath}.path`, `Typed ${key} binding requires a safe repository-relative path.`);
      const bytes = Buffer.isBuffer(record.bytes) ? record.bytes : typeof record.bytes === "string" ? Buffer.from(record.bytes) : null;
      if (bytes === null) {
        add("blocker", "FEE_CONFORMANCE_ARTIFACT_BYTES_MISSING", `${recordPath}.bytes`, `Exact typed ${key} bytes are required.`);
        continue;
      }
      const parsed = parseStrictRecordJson(bytes, {
        collection: `fee-conformance:${index}:${key}`,
        findingPath: `${recordPath}.bytes`,
        invalidCode: "FEE_CONFORMANCE_ARTIFACT_JSON_INVALID",
        invalidMessage: `Typed ${key} bytes are not valid duplicate-free UTF-8 JSON.`,
        structureMessage: `Typed ${key} bytes exceed a safe JSON structural boundary.`
      });
      if (parsed === null) continue;
      if (canonicalJson(parsed) !== canonicalJson(record.value)) add("blocker", "FEE_CONFORMANCE_ARTIFACT_VALUE_BYTES_MISMATCH", recordPath, `Parsed typed ${key} bytes differ from the supplied value.`);
      if (binding.sha256 !== sha256Bytes(bytes)) add("blocker", "FEE_CONFORMANCE_ARTIFACT_HASH_MISMATCH", `${bindingPath}.sha256`, `Typed ${key} binding SHA-256 does not match exact bytes.`);
      if (binding.byteLength !== bytes.length) add("blocker", "FEE_CONFORMANCE_ARTIFACT_LENGTH_MISMATCH", `${bindingPath}.byteLength`, `Typed ${key} binding byte length does not match exact bytes.`);
      parsedEntry[key] = { value: parsed, bytes, binding };
    }
    parsedFeeConformanceRecords.push(parsedEntry);
  }
  const declaredTradeCapabilityMarkets = Array.isArray(submission.tradeCapability?.markets)
    ? submission.tradeCapability.markets
    : [];
  const suppliedTradeCapabilityRecords = supportingRecords.tradeCapabilities === undefined
    ? []
    : Array.isArray(supportingRecords.tradeCapabilities)
      ? supportingRecords.tradeCapabilities
      : null;
  if (suppliedTradeCapabilityRecords === null) {
    add("blocker", "TRADE_CAPABILITY_SUPPORTING_RECORDS_INVALID", "$.supportingRecords.tradeCapabilities", "Typed trade-capability supporting records must be an array aligned to selected trade markets.");
  } else if (declaredTradeCapabilityMarkets.length === 0 && suppliedTradeCapabilityRecords.length > 0) {
    add("blocker", "ORPHAN_TRADE_CAPABILITY_MANIFEST", "$.supportingRecords.tradeCapabilities", "Trade-capability manifests are forbidden when the submission selects no tradable market.", { applicability: submission.tradeCapability?.applicability ?? null, implementationAuthorization: "NOT_GRANTED" });
  } else if (suppliedTradeCapabilityRecords.length !== declaredTradeCapabilityMarkets.length) {
    add("blocker", "TRADE_CAPABILITY_SUPPORTING_RECORD_COUNT_MISMATCH", "$.supportingRecords.tradeCapabilities", "Every explicitly selected tradable market must have exactly one typed trade-capability manifest record.", {
      declared: declaredTradeCapabilityMarkets.length,
      supplied: suppliedTradeCapabilityRecords.length
    });
  }
  const parsedTradeCapabilityRecords = [];
  for (const [index, declaration] of declaredTradeCapabilityMarkets.entries()) {
    const declarationPath = `$.tradeCapability.markets[${index}]`;
    const binding = declaration?.manifest;
    const bindingPath = `${declarationPath}.manifest`;
    const supplied = suppliedTradeCapabilityRecords?.[index];
    const suppliedPath = `$.supportingRecords.tradeCapabilities[${index}]`;
    const parsedEntry = { marketRef: declaration?.marketRef, manifest: null, quoteResults: [], executionResults: [] };
    if (!requireObject(binding, bindingPath, "TRADE_CAPABILITY_MANIFEST_BINDING_MISSING")) {
      parsedTradeCapabilityRecords.push(parsedEntry);
      continue;
    }
    if (!requireObject(supplied, suppliedPath, "TRADE_CAPABILITY_SUPPORTING_RECORD_MISSING")) {
      parsedTradeCapabilityRecords.push(parsedEntry);
      continue;
    }
    if (supplied.marketRef !== declaration?.marketRef) add("blocker", "TRADE_CAPABILITY_SUPPORTING_MARKET_MISMATCH", `${suppliedPath}.marketRef`, "Typed trade-capability record must align to the selected marketRef.");
    if (binding.artifactType !== OPEN_WORLD_V2_TRADE_CAPABILITY_ARTIFACT.artifactType) add("blocker", "TRADE_CAPABILITY_MANIFEST_ARTIFACT_TYPE_MISMATCH", `${bindingPath}.artifactType`, "Trade-capability manifest binding uses the wrong artifact type.");
    if (binding.schemaId !== OPEN_WORLD_V2_TRADE_CAPABILITY_ARTIFACT.schemaId) add("blocker", "TRADE_CAPABILITY_MANIFEST_SCHEMA_ID_MISMATCH", `${bindingPath}.schemaId`, "Trade-capability manifest binding uses the wrong schema ID.");
    if (!isSafeRepositoryPath(binding.path)) add("blocker", "TRADE_CAPABILITY_MANIFEST_PATH_INVALID", `${bindingPath}.path`, "Trade-capability manifest binding requires a safe repository-relative path.");
    const record = supplied.manifest;
    const recordPath = `${suppliedPath}.manifest`;
    if (!requireObject(record, recordPath, "TRADE_CAPABILITY_SUPPORTING_RECORD_MISSING")) {
      parsedTradeCapabilityRecords.push(parsedEntry);
      continue;
    }
    const bytes = Buffer.isBuffer(record.bytes) ? record.bytes : typeof record.bytes === "string" ? Buffer.from(record.bytes) : null;
    if (bytes === null) {
      add("blocker", "TRADE_CAPABILITY_MANIFEST_BYTES_MISSING", `${recordPath}.bytes`, "Exact trade-capability manifest bytes are required.");
      parsedTradeCapabilityRecords.push(parsedEntry);
      continue;
    }
    const parsed = parseStrictRecordJson(bytes, {
      collection: `trade-capability:${index}`,
      findingPath: `${recordPath}.bytes`,
      invalidCode: "TRADE_CAPABILITY_MANIFEST_JSON_INVALID",
      invalidMessage: "Trade-capability manifest bytes are not valid duplicate-free UTF-8 JSON.",
      structureMessage: "Trade-capability manifest bytes exceed a safe JSON structural boundary."
    });
    if (parsed === null) {
      parsedTradeCapabilityRecords.push(parsedEntry);
      continue;
    }
    if (canonicalJson(parsed) !== canonicalJson(record.value)) add("blocker", "TRADE_CAPABILITY_MANIFEST_VALUE_BYTES_MISMATCH", recordPath, "Parsed trade-capability manifest bytes differ from the supplied value.");
    if (!bytes.equals(Buffer.from(`${canonicalJson(parsed)}\n`, "utf8"))) add("blocker", "TRADE_CAPABILITY_MANIFEST_CANONICAL_BYTES_REQUIRED", `${recordPath}.bytes`, "Trade-capability manifest bytes must use canonical JSON with one final newline so the exact source snapshot can be mirrored into Application review.");
    if (binding.sha256 !== sha256Bytes(bytes)) add("blocker", "TRADE_CAPABILITY_MANIFEST_HASH_MISMATCH", `${bindingPath}.sha256`, "Trade-capability manifest binding SHA-256 does not match exact bytes.");
    if (binding.byteLength !== bytes.length) add("blocker", "TRADE_CAPABILITY_MANIFEST_LENGTH_MISMATCH", `${bindingPath}.byteLength`, "Trade-capability manifest binding byte length does not match exact bytes.");
    parsedEntry.manifest = { value: parsed, bytes, binding };
    const manifestFindings = validateTradeCapabilityManifestV1(parsed, {
      applicationId: submission.applicationId,
      marketRef: declaration?.marketRef,
      routeType: declaration?.routeType
    });
    addTradeDomainFindings(manifestFindings, `${recordPath}.value`, { marketRef: declaration?.marketRef ?? null });
    const manifestValid = manifestFindings.length === 0;
    const resultValidity = { quoteResults: [], executionResults: [] };
    for (const [testsKey, recordsKey] of [["quoteTests", "quoteResults"], ["executionTests", "executionResults"]]) {
      const declaredTests = Array.isArray(parsed?.testEvidence?.[testsKey]) ? parsed.testEvidence[testsKey] : [];
      const suppliedResults = supplied[recordsKey] === undefined
        ? []
        : Array.isArray(supplied[recordsKey]) ? supplied[recordsKey] : null;
      if (suppliedResults === null) {
        add("blocker", "TRADE_TEST_RESULT_RECORDS_INVALID", `${suppliedPath}.${recordsKey}`, "Trade test result records must be an array aligned to their manifest declarations.");
        continue;
      }
      if (suppliedResults.length !== declaredTests.length) {
        add("blocker", "TRADE_TEST_RESULT_RECORD_COUNT_MISMATCH", `${suppliedPath}.${recordsKey}`, "Every declared trade test must have exactly one local reported result artifact.", { declared: declaredTests.length, supplied: suppliedResults.length, testsKey });
      }
      for (const [testIndex, test] of declaredTests.entries()) {
        const resultEntry = suppliedResults[testIndex];
        const resultEntryPath = `${suppliedPath}.${recordsKey}[${testIndex}]`;
        const parsedResultEntry = { testId: test?.id, result: null };
        if (!requireObject(resultEntry, resultEntryPath, "TRADE_TEST_RESULT_RECORD_MISSING")) {
          parsedEntry[recordsKey].push(parsedResultEntry);
          continue;
        }
        if (resultEntry.testId !== test?.id) add("blocker", "TRADE_TEST_RESULT_ID_MISMATCH", `${resultEntryPath}.testId`, "Trade result record must align to the exact declared test id.");
        const resultRecord = resultEntry.result;
        const resultRecordPath = `${resultEntryPath}.result`;
        if (!requireObject(resultRecord, resultRecordPath, "TRADE_TEST_RESULT_RECORD_MISSING")) {
          parsedEntry[recordsKey].push(parsedResultEntry);
          continue;
        }
        const resultBytes = Buffer.isBuffer(resultRecord.bytes) ? resultRecord.bytes : typeof resultRecord.bytes === "string" ? Buffer.from(resultRecord.bytes) : null;
        if (resultBytes === null) {
          add("blocker", "TRADE_TEST_RESULT_BYTES_MISSING", `${resultRecordPath}.bytes`, "Exact local trade test result bytes are required.");
          parsedEntry[recordsKey].push(parsedResultEntry);
          continue;
        }
        const parsedResult = parseStrictRecordJson(resultBytes, {
          collection: `trade-capability:${index}:${testsKey}:${testIndex}`,
          findingPath: `${resultRecordPath}.bytes`,
          invalidCode: "TRADE_TEST_RESULT_JSON_INVALID",
          invalidMessage: "Trade test result bytes are not valid duplicate-free UTF-8 JSON.",
          structureMessage: "Trade test result bytes exceed a safe JSON structural boundary."
        });
        if (parsedResult === null) {
          parsedEntry[recordsKey].push(parsedResultEntry);
          continue;
        }
        if (canonicalJson(parsedResult) !== canonicalJson(resultRecord.value)) add("blocker", "TRADE_TEST_RESULT_VALUE_BYTES_MISMATCH", resultRecordPath, "Parsed trade test result bytes differ from the supplied value.");
        if (!resultBytes.equals(Buffer.from(`${canonicalJson(parsedResult)}\n`, "utf8"))) add("blocker", "TRADE_TEST_RESULT_CANONICAL_BYTES_REQUIRED", `${resultRecordPath}.bytes`, "Trade test result bytes must use canonical JSON with one final newline so the exact source snapshot can be mirrored into Application review.");
        const resultFindings = validateTradeTestResultV1(
          parsedResult,
          manifestValid ? { manifest: parsed, test } : {}
        );
        addTradeDomainFindings(resultFindings, `${resultRecordPath}.value`, {
          marketRef: declaration?.marketRef ?? null,
          testId: test?.id ?? null,
          testKind: testsKey === "quoteTests" ? "quote" : "execution"
        });
        resultValidity[recordsKey][testIndex] = resultFindings.length === 0;
        parsedResultEntry.result = { value: parsedResult, bytes: resultBytes };
        parsedEntry[recordsKey].push(parsedResultEntry);
      }
    }
    if (manifestValid) {
      for (const mode of parsed.capabilities.modeMatrix.filter(({ support }) => support === "supported")) {
        const quoteIndex = parsed.testEvidence.quoteTests.findIndex(({ modeRef }) => modeRef === mode.id);
        const executionIndex = parsed.testEvidence.executionTests.findIndex(({ modeRef, scenario }) => modeRef === mode.id && scenario === "successful-swap");
        if (
          quoteIndex < 0
          || executionIndex < 0
          || resultValidity.quoteResults[quoteIndex] !== true
          || resultValidity.executionResults[executionIndex] !== true
        ) continue;
        const quoteTest = parsed.testEvidence.quoteTests[quoteIndex];
        const executionTest = parsed.testEvidence.executionTests[executionIndex];
        const pairFindings = validateTradeResultPairV1(
          parsedEntry.quoteResults[quoteIndex].result.value,
          parsedEntry.executionResults[executionIndex].result.value,
          { manifest: parsed, quoteTest, executionTest }
        );
        addTradeDomainFindings(pairFindings, `${suppliedPath}.executionResults[${executionIndex}].result.value`, {
          marketRef: declaration?.marketRef ?? null,
          modeId: mode.id,
          quoteTestId: quoteTest.id,
          executionTestId: executionTest.id
        });
      }
    }
    parsedTradeCapabilityRecords.push(parsedEntry);
  }
  const canonicalBundledFeeSchemaBytes = Buffer.from(`${canonicalJson(bundledSchemas.feePolicySchema)}\n`, "utf8");
  const canonicalBundledSecuritySchemaBytes = Buffer.from(`${canonicalJson(bundledSchemas.securityAssessmentSchema)}\n`, "utf8");
  if (supportingRecordBytes.feePolicySchema && !supportingRecordBytes.feePolicySchema.equals(canonicalBundledFeeSchemaBytes)) add("blocker", "FEE_POLICY_SCHEMA_ARTIFACT_MUTATED", "$.supportingRecords.feePolicySchema", "fee-policy-v2.schema.json must match the exact canonical bundled bytes for its stable schema URN.");
  if (supportingRecordBytes.securityAssessmentSchema && !supportingRecordBytes.securityAssessmentSchema.equals(canonicalBundledSecuritySchemaBytes)) add("blocker", "SECURITY_SCHEMA_ARTIFACT_MUTATED", "$.supportingRecords.securityAssessmentSchema", "security-assessment-v1.schema.json must match the exact canonical bundled bytes for its stable schema URN.");
  if (parsedSupportingRecords.securityAssessment) {
    for (const issue of validateExtensionInstance(parsedSupportingRecords.securityAssessment, bundledSchemas.securityAssessmentSchema, { trustedSchema: true })) {
      if (EXTENSION_SPLIT_REVIEW_CODES.has(issue.code)) {
        addSplitReason({ collection: "supporting-record:securityAssessment", code: issue.code });
        add("split-review", "SECURITY_ASSESSMENT_SPLIT_REVIEW_REQUIRED", "$.supportingRecords.securityAssessment", issue.message, { schemaCode: issue.code, instancePath: issue.path, ideaEligibility: "ELIGIBLE_FOR_REVIEW", designEligible: true, automaticMaterialization: false });
      } else add("blocker", "SECURITY_ASSESSMENT_SCHEMA_INVALID", "$.supportingRecords.securityAssessment", issue.message, { schemaCode: issue.code, instancePath: issue.path });
    }
    if (parsedSupportingRecords.securityAssessment.subject?.id !== submission.applicationId) add("blocker", "SECURITY_ASSESSMENT_SUBJECT_MISMATCH", "$.supportingRecords.securityAssessment.subject.id", "Security assessment must bind the same applicationId.");
    if (parsedSupportingRecords.securityAssessment.subject?.stage !== submission.stage) add("blocker", "SECURITY_ASSESSMENT_STAGE_MISMATCH", "$.supportingRecords.securityAssessment.subject.stage", "Security assessment stage must equal the submission stage so a prototype cannot masquerade as an idea or proposal.");
    securityAnalysis = analyzeOpenWorldSecurity(parsedSupportingRecords.securityAssessment);
    if (parsedSupportingRecords.securityAssessment.assessment?.state === "source-assessed") add("blocker", "SOURCE_SUBMISSION_DERIVED_SECURITY_ASSESSMENT_FORBIDDEN", "$.supportingRecords.securityAssessment.assessment.state", "A source-assessed record cannot live inside the source commit whose revision it assesses without a cryptographic self-reference cycle.", { implementationAuthorization: "NOT_GRANTED", remediation: "Keep submission.supportingPackage.securityAssessment null, then derive and bind the exact source-assessed artifact in Public Application v3 after the source commit exists." });
    for (const securityFinding of securityAnalysis.findings) {
      const severity = ["SAFE_REDESIGN", "CHANGES_REQUIRED"].includes(securityFinding.outcome) ? "blocker" : "review";
      add(
        severity,
        `SECURITY_${securityFinding.code}`,
        `$.supportingRecords.securityAssessment${securityFinding.path === "$" ? "" : securityFinding.path.slice(1)}`,
        securityFinding.message,
        {
          outcome: securityFinding.outcome,
          remediation: securityFinding.remediation,
          implementationAuthorization: "NOT_GRANTED"
        }
      );
    }
  } else if (embeddedSecurityAssessment === null) {
    securityAnalysis = {
      route: "INDEPENDENT_REVIEW",
      summary: { SAFE_REDESIGN: 0, CHANGES_REQUIRED: 0, INDEPENDENT_REVIEW: 1, TRUST_TIER: 0, observationConflicts: 0 },
      assurance: "The source submission intentionally carries no self-referential assessment. Exact source coverage must be derived after the source commit exists."
    };
    add("review", "DERIVED_SECURITY_ASSESSMENT_REQUIRED", "$.supportingPackage.securityAssessment", "The source-owned submission intentionally defers its source assessment until after the source commit exists.", { outcome: "INDEPENDENT_REVIEW", implementationAuthorization: "NOT_GRANTED", remediation: "Generate a derived application-package assessment against the exact commit, tree, and verified source manifests before Application v3 materialization or launch review." });
  }
  if (parsedSupportingRecords.feePolicy) {
    for (const issue of validateExtensionInstance(parsedSupportingRecords.feePolicy, bundledSchemas.feePolicySchema, { trustedSchema: true })) {
      if (EXTENSION_SPLIT_REVIEW_CODES.has(issue.code)) {
        addSplitReason({ collection: "supporting-record:feePolicy", code: issue.code });
        add("split-review", "FEE_POLICY_INSTANCE_SPLIT_REVIEW_REQUIRED", "$.supportingRecords.feePolicy", issue.message, { schemaCode: issue.code, instancePath: issue.path, ideaEligibility: "ELIGIBLE_FOR_REVIEW", designEligible: true, automaticMaterialization: false });
      } else add("blocker", "FEE_POLICY_INSTANCE_SCHEMA_INVALID", "$.supportingRecords.feePolicy", issue.message, { schemaCode: issue.code, instancePath: issue.path });
    }
    const projectedScopes = (submission.programmableFee?.feeScopes ?? []).map(({ id, chainId, poolId, quoteCurrency, collectionProfile }) => ({ id, chainId, poolId, quoteCurrency, collectionProfile }));
    if (canonicalJson(parsedSupportingRecords.feePolicy.feeScopes ?? []) !== canonicalJson(projectedScopes)) add("blocker", "FEE_POLICY_INSTANCE_SCOPE_MISMATCH", "$.supportingRecords.feePolicy.feeScopes", "Scoped fee-policy instance must exactly match the submission's canonical execution scopes.");
  }
  const exactZeroScopeFeeNotApplicable = isExactZeroScopeFeeNotApplicableDeclaration(submission);
  if (submission.programmableFee?.conformance?.status === "not-applicable"
    && (submission.supportingPackage?.feePolicy !== null || parsedSupportingRecords.feePolicy !== undefined)) {
    add("blocker", "FEE_NOT_APPLICABLE_POLICY_FORBIDDEN", "$.supportingPackage.feePolicy", "Fee-policy supporting artifacts must remain null when exact zero-scope conformance is not-applicable.");
  }
  if (submission.stage === "prototype" && !parsedSupportingRecords.feePolicy && !exactZeroScopeFeeNotApplicable) add("blocker", "PROTOTYPE_FEE_POLICY_INSTANCE_MISSING", "$.supportingPackage.feePolicy", "A prototype with any canonical, unresolved, or otherwise applicable execution scope requires a real scoped fee-policy.v2.json instance; only an exact zero-scope not-applicable declaration may keep it null.");

  Object.assign(context, {
    submission,
    records,
    supportingRecords,
    parsedRecords,
    recordDigests,
    parsedSupportingRecords,
    parsedFeeConformanceRecords,
    parsedTradeCapabilityRecords,
    securityAnalysis,
    exactZeroScopeFeeNotApplicable
  });
  return null;
}
