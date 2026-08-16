import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./submission-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import {
  APPLICATION_RECHECK_SCHEMA_VERSION,
  HISTORICAL_APPLICATION_FILES,
  TARGET_APPLICATION_CONTRACT,
  TARGET_APPLICATION_CONTRACT_VERSION,
  TARGET_SUBMISSION_STANDARD,
  TARGET_VALIDATOR_PROFILE,
  sha256Bytes,
  sha256Canonical
} from "./open-world-migration-contract.mjs";
import {
  APPLICATION_ID_PATTERN,
  FULL_GIT_OBJECT_PATTERN,
  MAX_PACKAGE_BYTES,
  MAX_PACKAGE_FILE_BYTES,
  MAX_SUBMISSION_BYTES,
  REVIEW_FILES,
  assertInside,
  cloneJson,
  fail,
  fileIdentity,
  isPlainObject,
  requireDirectory,
  requireNonEmptyString,
  requireSafeRepositoryPath,
  requireSha256,
  runGitBytes,
  runGitText
} from "./open-world-migration-shared.mjs";

export function applicationRecheckDryRun({
  applicationPackageDirectory,
  sourceRepositoryRoot,
  expectedPackageSha256 = null
}) {
  const packageSnapshot = readHistoricalPackage(applicationPackageDirectory);
  const application = packageSnapshot.documents.application;
  const applicationId = requireApplicationIdentity(application);
  const applicationDirectory = `submissions/${applicationId}`;
  const applicationRevision = requireApplicationRevision(application.applicationRevision);
  const packageSha256 = sha256Canonical({
    applicationDirectory,
    applicationRevision,
    files: packageSnapshot.files.map(({ path: filePath, byteLength, sha256 }) => ({
      path: filePath,
      byteLength,
      sha256
    }))
  });

  if (expectedPackageSha256 !== null) {
    requireSha256(expectedPackageSha256, "expected package SHA-256");
    if (expectedPackageSha256 !== packageSha256) {
      fail("EXPECTED_PACKAGE_MISMATCH", "the historical package does not match the expected package SHA-256", {
        expected: expectedPackageSha256,
        observed: packageSha256
      });
    }
  }

  verifyReviewPackageBindings(application, packageSnapshot);
  const sourceBinding = requirePrimarySourceBinding(application);
  const submissionBinding = requireSubmissionBinding(application);
  const historicalCompatibility = verifyHistoricalCompatibility(
    packageSnapshot.documents.compatibility,
    applicationId,
    sourceBinding
  );
  verifyEvidenceIndex(packageSnapshot.documents.evidenceIndex, applicationId, sourceBinding);

  const sourceSnapshot = readBoundSourceSubmission({
    sourceRepositoryRoot,
    submissionBinding,
    sourceBinding,
    applicationId
  });

  const original = Object.freeze({
    application: Object.freeze({
      contract: inferHistoricalApplicationContract(application.schemaVersion),
      schemaVersion: cloneJson(application.schemaVersion),
      applicationId,
      applicationRevision,
      sha256: packageSnapshot.byPath.get("application.json").sha256
    }),
    submission: Object.freeze({
      schemaId: typeof sourceSnapshot.document.$schema === "string" ? sourceSnapshot.document.$schema : null,
      standardVersion: requireNonEmptyString(sourceSnapshot.document.standardVersion, "source submission standardVersion", 100),
      path: submissionBinding.path,
      sha256: submissionBinding.sha256
    }),
    source: Object.freeze({
      numericRepositoryId: sourceBinding.numericRepositoryId,
      commit: sourceBinding.revisionObjectId,
      tree: sourceBinding.treeObjectId,
      submissionBlob: sourceSnapshot.blobObjectId
    }),
    package: Object.freeze({
      applicationDirectory,
      sha256: packageSha256,
      files: packageSnapshot.files.map(({ path: filePath, byteLength, sha256 }) => Object.freeze({
        path: filePath,
        byteLength,
        sha256
      }))
    })
  });

  const historicalResult = Object.freeze({
    status: "preserved-bound-evidence",
    replayed: false,
    validatorExecution: "not-run",
    interpretation: "historical-declared-result-only",
    declaredResult: historicalCompatibility.result,
    report: Object.freeze({
      schemaVersion: cloneJson(historicalCompatibility.schemaVersion),
      sha256: packageSnapshot.byPath.get("compatibility-report.json").sha256
    }),
    applicationAndSourceBindingsVerified: true,
    packageBindingsVerified: true,
    approvalInherited: false,
    note: "The historical bytes and declared result are preserved. This dry-run does not claim to replay the original validator or approval process."
  });

  const targetPreview = Object.freeze({
    status: "intent-recapture-required",
    materialized: false,
    applicationContract: Object.freeze({
      id: TARGET_APPLICATION_CONTRACT,
      version: TARGET_APPLICATION_CONTRACT_VERSION,
      submissionStandard: TARGET_SUBMISSION_STANDARD,
      validatorProfile: TARGET_VALIDATOR_PROFILE
    }),
    applicationId,
    proposedApplicationRevision: null,
    lineage: Object.freeze({
      kind: "schema-migration-preview",
      previous: cloneJson(original)
    }),
    intentCapture: Object.freeze({
      schemaVersion: "1.0.0",
      captureStatus: "unavailable-legacy",
      originalIdea: null,
      language: null,
      agentInterpretationStatus: "unconfirmed",
      facts: Object.freeze([
        Object.freeze({
          id: "legacy-application-title",
          statement: requireNonEmptyString(application.title, "application title", 120),
          provenance: "legacy-declared",
          confirmationStatus: "unconfirmed",
          sourceReferences: Object.freeze(["application.json#/title"])
        }),
        Object.freeze({
          id: "legacy-application-summary",
          statement: requireNonEmptyString(application.summary, "application summary", 5_000),
          provenance: "legacy-declared",
          confirmationStatus: "unconfirmed",
          sourceReferences: Object.freeze(["application.json#/summary"])
        })
      ]),
      unresolvedMaterialDecisions: Object.freeze([
        "Recapture or explicitly confirm the original product intent before assessing fidelity or materializing a v3 application."
      ])
    }),
    fidelity: Object.freeze({
      schemaVersion: "1.0.0",
      status: "unassessed",
      reasonCode: "ORIGINAL_INTENT_UNAVAILABLE",
      requirementBindings: Object.freeze([])
    }),
    reviewResult: null,
    approvalInherited: false,
    nextAction: "Capture and confirm the owner's product intent, then create a separate v3 application revision through the ordinary reviewed workflow."
  });

  const reportWithoutDigest = {
    kind: "application-recheck-report",
    schemaVersion: APPLICATION_RECHECK_SCHEMA_VERSION,
    dryRun: true,
    readOnly: true,
    original,
    historicalResult,
    targetPreview,
    delta: {
      classifications: ["legacy-data-gap"],
      historicalResultOverwritten: false,
      targetApprovalCreated: false,
      sourceRevisionCreated: false
    },
    historicalEvidencePreserved: true,
    sourceSubmissionPreserved: true,
    writePerformed: false,
    networkAccessed: false,
    externalActionsPerformed: []
  };
  const report = Object.freeze({
    ...reportWithoutDigest,
    reportSha256: sha256Canonical(reportWithoutDigest)
  });

  assertSnapshotsUnchanged({ packageSnapshot, sourceSnapshot });
  return report;
}

function readHistoricalPackage(directory) {
  const root = requireDirectory(directory, "application package");
  const observedNames = fs.readdirSync(root).sort();
  const expectedNames = [...HISTORICAL_APPLICATION_FILES].sort();
  if (canonicalJson(observedNames) !== canonicalJson(expectedNames)) {
    fail("PACKAGE_FILES_INVALID", "the historical application package must contain exactly the six canonical files", {
      expected: expectedNames,
      observed: observedNames
    });
  }

  let totalBytes = 0;
  const byPath = new Map();
  for (const filePath of HISTORICAL_APPLICATION_FILES) {
    const absolutePath = path.join(root, filePath);
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail("PACKAGE_FILE_INVALID", `${filePath} must be a regular non-symlink file`);
    }
    if (stat.size < 1 || stat.size > MAX_PACKAGE_FILE_BYTES) {
      fail("PACKAGE_FILE_INVALID", `${filePath} is outside the bounded file-size contract`);
    }
    totalBytes += stat.size;
    if (totalBytes > MAX_PACKAGE_BYTES) {
      fail("PACKAGE_FILE_INVALID", "the historical application package exceeds the bounded total size");
    }
    const bytes = fs.readFileSync(absolutePath);
    if (bytes.length !== stat.size) fail("PACKAGE_CHANGED_DURING_RECHECK", `${filePath} changed while it was read`);
    byPath.set(filePath, Object.freeze({
      path: filePath,
      absolutePath,
      bytes,
      byteLength: bytes.length,
      sha256: sha256Bytes(bytes),
      identity: fileIdentity(stat)
    }));
  }

  const documents = {
    application: parseCanonicalJsonFile(byPath.get("application.json")),
    compatibility: parseCanonicalJsonFile(byPath.get("compatibility-report.json")),
    evidenceIndex: parseCanonicalJsonFile(byPath.get("evidence-index.json"))
  };
  return Object.freeze({
    root,
    byPath,
    documents: Object.freeze(documents),
    files: HISTORICAL_APPLICATION_FILES.map((filePath) => byPath.get(filePath))
  });
}

function parseCanonicalJsonFile(record) {
  let source;
  let document;
  try {
    source = record.bytes.toString("utf8");
    if (!Buffer.from(source, "utf8").equals(record.bytes)) throw new Error("invalid UTF-8");
    document = parseBoundedStrictJsonBytes(record.bytes, {
      maxSourceBytes: MAX_PACKAGE_FILE_BYTES,
      maxDepth: 256,
      maxNodes: 250_000,
      maxNumberCharacters: MAX_PACKAGE_FILE_BYTES
    });
  } catch {
    fail("PACKAGE_JSON_INVALID", `${record.path} must contain valid UTF-8 JSON`);
  }
  if (source !== `${canonicalJson(document)}\n`) {
    fail("PACKAGE_JSON_NOT_CANONICAL", `${record.path} must be canonical JSON with one final newline`);
  }
  return document;
}

function verifyReviewPackageBindings(application, packageSnapshot) {
  if (!Array.isArray(application.reviewPackage) || application.reviewPackage.length !== REVIEW_FILES.length) {
    fail("REVIEW_BINDING_INVALID", "application.json must bind exactly the five historical review files");
  }
  for (let index = 0; index < REVIEW_FILES.length; index += 1) {
    const expectedPath = REVIEW_FILES[index];
    const declared = application.reviewPackage[index];
    const observed = packageSnapshot.byPath.get(expectedPath);
    if (
      !isPlainObject(declared)
      || canonicalJson(Object.keys(declared).sort()) !== canonicalJson(["byteLength", "path", "sha256"])
      || declared.path !== expectedPath
      || !Number.isInteger(declared.byteLength)
      || declared.byteLength !== observed.byteLength
      || declared.sha256 !== observed.sha256
    ) {
      fail("REVIEW_BINDING_INVALID", `${expectedPath} does not match its application.json byte binding`);
    }
  }
}

function verifyHistoricalCompatibility(compatibility, applicationId, sourceBinding) {
  if (!isPlainObject(compatibility)) {
    fail("HISTORICAL_RESULT_INVALID", "compatibility-report.json must contain one object");
  }
  if (compatibility.applicationId !== applicationId) {
    fail("HISTORICAL_RESULT_INVALID", "compatibility-report.json does not match the application id");
  }
  const declaredSource = compatibility.source;
  if (
    !isPlainObject(declaredSource)
    || declaredSource.numericRepositoryId !== sourceBinding.numericRepositoryId
    || declaredSource.revisionObjectId !== sourceBinding.revisionObjectId
    || declaredSource.treeObjectId !== sourceBinding.treeObjectId
  ) {
    fail("HISTORICAL_RESULT_INVALID", "compatibility-report.json does not match the historical source binding");
  }
  const result = compatibility.result;
  if (typeof result !== "string" || result.length < 1 || result.length > 200) {
    fail("HISTORICAL_RESULT_INVALID", "compatibility-report.json has no bounded declared result");
  }
  return compatibility;
}

function verifyEvidenceIndex(evidenceIndex, applicationId, sourceBinding) {
  if (!isPlainObject(evidenceIndex)) fail("EVIDENCE_INDEX_INVALID", "evidence-index.json must contain one object");
  if (Object.hasOwn(evidenceIndex, "applicationId") && evidenceIndex.applicationId !== applicationId) {
    fail("EVIDENCE_INDEX_INVALID", "evidence-index.json does not match the application id");
  }
  if (isPlainObject(evidenceIndex.source)) {
    const source = evidenceIndex.source;
    if (
      source.numericRepositoryId !== sourceBinding.numericRepositoryId
      || source.revisionObjectId !== sourceBinding.revisionObjectId
      || source.treeObjectId !== sourceBinding.treeObjectId
    ) {
      fail("EVIDENCE_INDEX_INVALID", "evidence-index.json does not match the historical source binding");
    }
  }
}

function readBoundSourceSubmission({ sourceRepositoryRoot, submissionBinding, sourceBinding, applicationId }) {
  const root = requireDirectory(sourceRepositoryRoot, "source repository");
  const realRoot = fs.realpathSync(root);
  const relativePath = requireSafeRepositoryPath(submissionBinding.path, "submission binding path");
  const absolutePath = path.resolve(realRoot, ...relativePath.split("/"));
  assertInside(realRoot, absolutePath, "submission binding path");
  const statBefore = fs.lstatSync(absolutePath);
  if (!statBefore.isFile() || statBefore.isSymbolicLink()) {
    fail("SOURCE_SUBMISSION_INVALID", "the bound source submission must be a regular non-symlink file");
  }
  if (statBefore.size < 1 || statBefore.size > MAX_SUBMISSION_BYTES) {
    fail("SOURCE_SUBMISSION_INVALID", "the bound source submission is outside the bounded file-size contract");
  }
  const localBytes = fs.readFileSync(absolutePath);
  if (localBytes.length !== statBefore.size || sha256Bytes(localBytes) !== submissionBinding.sha256) {
    fail("SOURCE_SUBMISSION_BINDING_MISMATCH", "the source submission bytes do not match application.json");
  }

  const commit = runGitText(realRoot, ["rev-parse", "--verify", "HEAD"], "source commit");
  const tree = runGitText(realRoot, ["rev-parse", "--verify", "HEAD^{tree}"], "source tree");
  if (commit !== sourceBinding.revisionObjectId || tree !== sourceBinding.treeObjectId) {
    fail("SOURCE_GIT_BINDING_MISMATCH", "the local source checkout does not match the historical commit and tree", {
      expectedCommit: sourceBinding.revisionObjectId,
      observedCommit: commit,
      expectedTree: sourceBinding.treeObjectId,
      observedTree: tree
    });
  }
  const blobObjectId = runGitText(realRoot, ["rev-parse", "--verify", `HEAD:${relativePath}`], "source submission blob");
  if (!FULL_GIT_OBJECT_PATTERN.test(blobObjectId)) {
    fail("SOURCE_GIT_INVALID", "Git returned an invalid source submission blob id");
  }
  const committedBytes = runGitBytes(realRoot, ["cat-file", "blob", blobObjectId], "source submission blob");
  if (!committedBytes.equals(localBytes)) {
    fail("SOURCE_WORKTREE_DIRTY", "the local source submission differs from the exact committed blob");
  }

  let document;
  try {
    document = parseBoundedStrictJsonBytes(localBytes, {
      maxSourceBytes: MAX_SUBMISSION_BYTES,
      maxDepth: 256,
      maxNodes: 250_000,
      maxNumberCharacters: MAX_SUBMISSION_BYTES
    });
  } catch {
    fail("SOURCE_SUBMISSION_INVALID", "the bound source submission is not valid UTF-8 JSON");
  }
  if (!isPlainObject(document) || document?.model?.id !== applicationId) {
    fail("SOURCE_SUBMISSION_INVALID", "the bound source submission does not match the application id");
  }

  return Object.freeze({
    root: realRoot,
    relativePath,
    absolutePath,
    bytes: localBytes,
    sha256: submissionBinding.sha256,
    blobObjectId,
    document,
    identity: fileIdentity(statBefore)
  });
}

function assertSnapshotsUnchanged({ packageSnapshot, sourceSnapshot }) {
  for (const record of packageSnapshot.files) {
    const stat = fs.lstatSync(record.absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink() || fileIdentity(stat) !== record.identity) {
      fail("PACKAGE_CHANGED_DURING_RECHECK", `${record.path} changed during the read-only recheck`);
    }
    const bytes = fs.readFileSync(record.absolutePath);
    if (bytes.length !== record.byteLength || sha256Bytes(bytes) !== record.sha256) {
      fail("PACKAGE_CHANGED_DURING_RECHECK", `${record.path} changed during the read-only recheck`);
    }
  }
  const sourceStat = fs.lstatSync(sourceSnapshot.absolutePath);
  const sourceBytes = fs.readFileSync(sourceSnapshot.absolutePath);
  if (
    !sourceStat.isFile()
    || sourceStat.isSymbolicLink()
    || fileIdentity(sourceStat) !== sourceSnapshot.identity
    || sourceBytes.length !== sourceSnapshot.bytes.length
    || sha256Bytes(sourceBytes) !== sourceSnapshot.sha256
  ) {
    fail("SOURCE_CHANGED_DURING_RECHECK", "the source submission changed during the read-only recheck");
  }
}

function requireApplicationIdentity(application) {
  if (!isPlainObject(application) || !APPLICATION_ID_PATTERN.test(application.applicationId ?? "")) {
    fail("APPLICATION_INVALID", "application.json has no canonical application id");
  }
  return application.applicationId;
}

function requireApplicationRevision(value) {
  if (!Number.isInteger(value) || value < 1 || value > 1_000_000) {
    fail("APPLICATION_INVALID", "application.json has an invalid application revision");
  }
  return value;
}

function requirePrimarySourceBinding(application) {
  const source = application?.source?.primary;
  if (
    !isPlainObject(source)
    || typeof source.numericRepositoryId !== "string"
    || !/^[1-9][0-9]{0,63}$/u.test(source.numericRepositoryId)
    || typeof source.repositoryUri !== "string"
    || !FULL_GIT_OBJECT_PATTERN.test(source.revisionObjectId ?? "")
    || !FULL_GIT_OBJECT_PATTERN.test(source.treeObjectId ?? "")
  ) {
    fail("SOURCE_BINDING_INVALID", "application.json has no complete historical primary source binding");
  }
  return source;
}

function requireSubmissionBinding(application) {
  const binding = application?.programmableFee?.submissionBinding;
  if (!isPlainObject(binding)) {
    fail("SOURCE_BINDING_INVALID", "application.json has no source submission binding");
  }
  const repositoryPath = requireSafeRepositoryPath(binding.path, "submission binding path");
  requireSha256(binding.sha256, "submission binding SHA-256");
  const declaredPaths = application?.source?.primary?.sourcePaths;
  if (Array.isArray(declaredPaths) && !declaredPaths.includes(repositoryPath)) {
    fail("SOURCE_BINDING_INVALID", "the source submission binding is not declared in primary.sourcePaths");
  }
  return Object.freeze({ path: repositoryPath, sha256: binding.sha256 });
}

function inferHistoricalApplicationContract(schemaVersion) {
  if (schemaVersion === 2) return "public-pr-application-v2";
  if (schemaVersion === 1) return "public-pr-application-v1";
  return "unknown-historical-application-contract";
}
