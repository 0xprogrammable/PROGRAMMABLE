import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ApplicationRecheckError,
  applicationRecheckDryRun,
  migrateLegacySubmissionToOpenWorldV2,
  sha256Bytes,
  sha256Canonical
} from "../open-world-migration-core.mjs";
import {
  PUBLIC_PR_APPLICATION_V3_CAPTURE_STATUSES,
  PUBLIC_PR_APPLICATION_V3_REQUIRED_REVIEW_KINDS,
  generatePublicPrApplicationV3,
  validatePublicPrApplicationV3,
  validateSourceClosureManifestV1,
  verifyBoundSourceClosureManifestV1
} from "../public-pr-application-v3-core.mjs";
import { canonicalJson, validateAgainstSchema } from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../..");
const recheckCli = path.resolve(testDirectory, "..", "application-recheck.mjs");
const HASH_A = `sha256:${"a".repeat(64)}`;

test("pure v1.6 migration is deterministic, source-bound, and explicitly unassessed", () => {
  const legacySubmission = legacySubmissionFixture();
  const before = canonicalJson(legacySubmission);
  const rawBytes = Buffer.from(`${JSON.stringify(legacySubmission, null, 2)}\n`, "utf8");
  const sourceRef = {
    path: "submissions/legacy-open-world/submission.json",
    sha256: sha256Bytes(rawBytes),
    byteLength: rawBytes.length,
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    repositoryUri: "https://github.com/example/legacy-open-world",
    numericRepositoryId: "123456789",
    applicationPackageSha256: HASH_A
  };

  const first = migrateLegacySubmissionToOpenWorldV2({ legacySubmission, sourceRef });
  const second = migrateLegacySubmissionToOpenWorldV2({
    legacySubmission: JSON.parse(JSON.stringify(legacySubmission)),
    sourceRef: { ...sourceRef }
  });

  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(canonicalJson(legacySubmission), before);
  assert.equal(first.source.standardVersion, "1.6.0");
  assert.equal(first.source.sha256, sourceRef.sha256);
  assert.equal(first.source.canonicalDocumentSha256, sha256Canonical(legacySubmission));
  assert.equal(first.source.commit, sourceRef.commit);
  assert.equal(first.source.tree, sourceRef.tree);
  assert.equal(first.source.applicationPackageSha256, HASH_A);
  assert.deepEqual(first.target.lineage, {
    kind: "schema-migration",
    previous: {
      schemaId: first.source.schemaId,
      standardVersion: "1.6.0",
      path: sourceRef.path,
      byteLength: sourceRef.byteLength,
      sha256: sourceRef.sha256,
      commit: sourceRef.commit,
      tree: sourceRef.tree,
      applicationPackageSha256: HASH_A
    }
  });
  assert.equal(first.writePerformed, false);
  assert.equal(first.networkAccessed, false);
  assert.deepEqual(first.externalActionsPerformed, []);

  const files = new Map(first.files.map((record) => [record.path, record]));
  assert.deepEqual([...files.keys()], [
    "legacy-migration-profile.v1.schema.json",
    "idea-source.v1.json",
    "intent-contract.v1.json",
    "architecture-decisions.v1.json",
    "intent-fidelity.v1.json",
    "fee-policy-v2.schema.json",
    "security-assessment-v1.schema.json",
    "security-assessment.v1.json",
    "submission.v2.json"
  ]);
  for (const record of files.values()) {
    const bytes = Buffer.from(record.content, "utf8");
    assert.equal(record.byteLength, bytes.length);
    assert.equal(record.sha256, sha256Bytes(bytes));
    assert.equal(record.content, `${canonicalJson(JSON.parse(record.content))}\n`);
  }

  const ideaSource = parseFile(files, "idea-source.v1.json");
  assert.equal(ideaSource.captureStatus, "unavailable-legacy");
  assert.equal(ideaSource.originalEntryId, null);
  assert.deepEqual(ideaSource.entries, []);

  const intent = parseFile(files, "intent-contract.v1.json");
  assert.equal(intent.status, "legacy-unconfirmed");
  assert.equal(intent.confirmation.state, "legacy-unconfirmed");
  assert.ok(intent.facts.length >= 1);
  assert.ok(intent.facts.every((fact) => fact.state === "legacy-unconfirmed"));
  assert.ok(intent.facts.every((fact) => fact.provenance.every(({ relation }) => relation === "legacy-derived")));
  assert.ok(intent.facts.every((fact) => fact.semanticPayload.captureStatus === "unavailable-legacy"));

  const fidelity = parseFile(files, "intent-fidelity.v1.json");
  assert.equal(fidelity.overallStatus, "incomplete");
  assert.ok(fidelity.traces.length >= 1);
  assert.ok(fidelity.traces.every(({ status }) => status === "unassessed"));

  const submission = parseFile(files, "submission.v2.json");
  assert.equal(submission.schemaVersion, 2);
  assert.equal(submission.standardVersion, "2.0.0");
  assert.equal(submission.intentPackage.ideaSource.path, "idea-source.v1.json");
  assert.equal(submission.intentPackage.intentContract.path, "intent-contract.v1.json");
  assert.equal(submission.intentPackage.architectureDecisions.path, "architecture-decisions.v1.json");
  assert.equal(submission.intentPackage.intentFidelity.path, "intent-fidelity.v1.json");
  assert.equal(submission.supportingPackage.feePolicySchema.path, "fee-policy-v2.schema.json");
  assert.equal(submission.supportingPackage.feePolicy, null);
  assert.equal(submission.supportingPackage.securityAssessmentSchema.path, "security-assessment-v1.schema.json");
  assert.equal(submission.supportingPackage.securityAssessment.path, "security-assessment.v1.json");
  assert.equal(submission.programmableFee.policyId, "programmable-volume-fee-v2");
  assert.equal(submission.programmableFee.policyVersion, "2.0.0");
  assert.equal(submission.programmableFee.policyHashPreimage, "programmable-volume-fee-v2@2.0.0");
  assert.equal(submission.markets[0].executionClass, "unknown");
  assert.deepEqual(submission.markets[0].canonicalScopes, []);
  assert.deepEqual(submission.programmableFee.executionScopeRefs, []);
  assert.deepEqual(submission.programmableFee.feeScopes, []);
  assert.equal(submission.programmableFee.conformance.status, "required");
  assert.deepEqual(submission.programmableFee.conformance.evidenceRefs, []);
  assert.equal(parseFile(files, "fee-policy-v2.schema.json").$id, "urn:programmable:fee-policy-v2:1.0.0");
  assert.equal(parseFile(files, "security-assessment-v1.schema.json").$id, "urn:programmable:open-world-security:1.0.0");
  const securityAssessment = parseFile(files, "security-assessment.v1.json");
  assert.equal(securityAssessment.subject.id, submission.applicationId);
  assert.equal(securityAssessment.subject.stage, "proposal");
  assert.deepEqual(securityAssessment.assessment, {
    state: "unassessed",
    reasonCode: "LEGACY_INTENT_UNAVAILABLE",
    evidenceRefs: [],
    sourceCoverage: null
  });
  assert.deepEqual(securityAssessment.layers.intent.customProfiles, []);
  assert.equal(first.migrationReport.targetPreview.captureStatus, "unavailable-legacy");
  assert.equal(first.migrationReport.targetPreview.legacyFactState, "legacy-unconfirmed");
  assert.equal(first.migrationReport.targetPreview.fidelityAssessment, "unassessed");
  assert.equal(first.migrationReport.targetPreview.executionClass, "unknown");
  assert.equal(first.migrationReport.targetPreview.feeScopeStatus, "UNRESOLVED");
  assert.equal(first.migrationReport.targetPreview.route, "INTEGRATION_PENDING");
  assert.equal(first.migrationReport.historicalResult.approvalInherited, false);
  assert.equal(first.migrationReport.historicalResult.historicalFeeProjection.policyId, "programmable-volume-fee-v1");
  assert.equal(first.migrationReport.targetPreview.feePolicy.policyId, "programmable-volume-fee-v2");
  assert.equal(first.migrationReport.targetPreview.feePolicy.conformanceStatus, "required");
  assert.equal(first.migrationReport.targetPreview.approvalCreated, false);
});

test("pure migration never republishes unreviewed legacy prose or secrets", () => {
  const secret = "github_pat_11AA22BB33_CC44DD55EE66FF77";
  const legacySubmission = legacySubmissionFixture();
  legacySubmission.model.name = `private ${secret}`;
  legacySubmission.model.summary = `do not publish ${secret}`;
  legacySubmission.builder.licenseDeclaration = `internal-${secret}`;
  const rawBytes = Buffer.from(`${JSON.stringify(legacySubmission, null, 2)}\n`, "utf8");
  const result = migrateLegacySubmissionToOpenWorldV2({
    legacySubmission,
    sourceRef: {
      path: "submissions/legacy-open-world/submission.json",
      sha256: sha256Bytes(rawBytes),
      byteLength: rawBytes.length,
      commit: "a".repeat(40),
      tree: "b".repeat(40),
      repositoryUri: "https://github.com/example/legacy-open-world",
      numericRepositoryId: "123456789"
    }
  });
  assert.equal(canonicalJson(result).includes(secret), false);
  assert.ok(result.files.every(({ content }) => !content.includes(secret)));
});

test("pure migration rejects an ambiguous or mismatched source binding", () => {
  const legacySubmission = legacySubmissionFixture();
  const rawBytes = Buffer.from(`${canonicalJson(legacySubmission)}\n`, "utf8");
  const base = {
    path: "submissions/legacy-open-world/submission.json",
    sha256: sha256Bytes(rawBytes),
    byteLength: rawBytes.length,
    commit: "a".repeat(40),
    tree: "b".repeat(40)
  };
  assertRecheckCode(() => migrateLegacySubmissionToOpenWorldV2({
    legacySubmission,
    sourceRef: { ...base, commit: null }
  }), "MIGRATION_SOURCE_REF_INVALID");
  assertRecheckCode(() => migrateLegacySubmissionToOpenWorldV2({
    legacySubmission,
    sourceRef: { ...base, canonicalDocumentSha256: HASH_A }
  }), "MIGRATION_SOURCE_REF_INVALID");
  assertRecheckCode(() => migrateLegacySubmissionToOpenWorldV2({
    legacySubmission,
    sourceRef: { ...base, path: "../submission.json" }
  }), "SOURCE_BINDING_INVALID");
});

test("pure migration converts only exact legacy chain IDs to canonical uint256 strings", () => {
  const exact = legacySubmissionFixture();
  exact.target = { chainId: 8453 };
  const exactBytes = Buffer.from(`${canonicalJson(exact)}\n`, "utf8");
  const migrated = migrateLegacySubmissionToOpenWorldV2({
    legacySubmission: exact,
    sourceRef: {
      path: "submissions/legacy-open-world/submission.json",
      sha256: sha256Bytes(exactBytes),
      byteLength: exactBytes.length,
      commit: "a".repeat(40),
      tree: "b".repeat(40)
    }
  });
  assert.equal(
    parseFile(new Map(migrated.files.map((record) => [record.path, record])), "submission.v2.json").markets[0].profile.chainId,
    "8453"
  );

  const ambiguous = legacySubmissionFixture();
  ambiguous.target = { chainId: 9007199254740992 };
  const ambiguousBytes = Buffer.from(`${canonicalJson(ambiguous)}\n`, "utf8");
  assertRecheckCode(() => migrateLegacySubmissionToOpenWorldV2({
    legacySubmission: ambiguous,
    sourceRef: {
      path: "submissions/legacy-open-world/submission.json",
      sha256: sha256Bytes(ambiguousBytes),
      byteLength: ambiguousBytes.length,
      commit: "a".repeat(40),
      tree: "b".repeat(40)
    }
  }), "LEGACY_SUBMISSION_INVALID");

  for (const [chainId, expected] of [
    [Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)],
    [((1n << 256n) - 1n).toString(), ((1n << 256n) - 1n).toString()]
  ]) {
    const candidate = legacySubmissionFixture();
    candidate.target = { chainId };
    const bytes = Buffer.from(`${canonicalJson(candidate)}\n`, "utf8");
    const result = migrateLegacySubmissionToOpenWorldV2({
      legacySubmission: candidate,
      sourceRef: {
        path: "submissions/legacy-open-world/submission.json",
        sha256: sha256Bytes(bytes),
        byteLength: bytes.length,
        commit: "a".repeat(40),
        tree: "b".repeat(40)
      }
    });
    const submission = parseFile(new Map(result.files.map((record) => [record.path, record])), "submission.v2.json");
    assert.equal(submission.markets[0].profile.chainId, expected);
  }

  for (const chainId of [1.5, -1, "0", "01", `${(1n << 256n).toString()}`]) {
    const candidate = legacySubmissionFixture();
    candidate.target = { chainId };
    const bytes = Buffer.from(`${canonicalJson(candidate)}\n`, "utf8");
    assertRecheckCode(() => migrateLegacySubmissionToOpenWorldV2({
      legacySubmission: candidate,
      sourceRef: {
        path: "submissions/legacy-open-world/submission.json",
        sha256: sha256Bytes(bytes),
        byteLength: bytes.length,
        commit: "a".repeat(40),
        tree: "b".repeat(40)
      }
    }), "LEGACY_SUBMISSION_INVALID");
  }
});

test("pure migration accepts safe source paths beyond 1024 characters within package budgets", () => {
  const legacySubmission = legacySubmissionFixture();
  const rawBytes = Buffer.from(`${JSON.stringify(legacySubmission, null, 2)}\n`, "utf8");
  const result = migrateLegacySubmissionToOpenWorldV2({
    legacySubmission,
    sourceRef: {
      path: `legacy/${"segment/".repeat(150)}application.json`,
      sha256: sha256Bytes(rawBytes),
      byteLength: rawBytes.length,
      commit: "a".repeat(40),
      tree: "b".repeat(40)
    }
  });
  assert.equal(result.source.path.length > 1024, true);
  assert.equal(result.target.applicationId, legacySubmission.model.id);
});

test("application recheck preserves the exact package and separates history from target preview", (t) => {
  const fixture = createApplicationFixture(t);
  const beforePackage = snapshotDirectory(fixture.packageRoot);
  const beforeSubmission = fs.readFileSync(fixture.submissionPath);

  const first = applicationRecheckDryRun({
    applicationPackageDirectory: fixture.packageRoot,
    sourceRepositoryRoot: fixture.sourceRoot
  });
  const second = applicationRecheckDryRun({
    applicationPackageDirectory: fixture.packageRoot,
    sourceRepositoryRoot: fixture.sourceRoot,
    expectedPackageSha256: first.original.package.sha256
  });

  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(first.original.application.schemaVersion, 2);
  assert.equal(first.original.submission.standardVersion, "1.6.0");
  assert.equal(first.original.submission.sha256, fixture.submissionSha256);
  assert.equal(first.original.source.commit, fixture.commit);
  assert.equal(first.original.source.tree, fixture.tree);
  assert.match(first.original.package.sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(first.historicalResult.status, "preserved-bound-evidence");
  assert.equal(first.historicalResult.declaredResult, "architecture-review-required");
  assert.equal(first.historicalResult.replayed, false);
  assert.equal(first.historicalResult.approvalInherited, false);
  assert.equal(first.targetPreview.intentCapture.captureStatus, "unavailable-legacy");
  assert.equal(first.targetPreview.intentCapture.originalIdea, null);
  assert.equal(first.targetPreview.intentCapture.agentInterpretationStatus, "unconfirmed");
  assert.ok(first.targetPreview.intentCapture.facts.every(({ confirmationStatus }) => confirmationStatus === "unconfirmed"));
  assert.equal(first.targetPreview.fidelity.status, "unassessed");
  assert.deepEqual(first.targetPreview.fidelity.requirementBindings, []);
  assert.equal(first.targetPreview.reviewResult, null);
  assert.equal(first.targetPreview.approvalInherited, false);
  assert.equal(first.historicalEvidencePreserved, true);
  assert.equal(first.sourceSubmissionPreserved, true);
  assert.equal(first.writePerformed, false);
  assert.equal(first.networkAccessed, false);
  assert.deepEqual(snapshotDirectory(fixture.packageRoot), beforePackage);
  assert.deepEqual(fs.readFileSync(fixture.submissionPath), beforeSubmission);

  const withoutDigest = { ...first };
  delete withoutDigest.reportSha256;
  assert.equal(first.reportSha256, sha256Canonical(withoutDigest));
});

test("application recheck fails closed on package tampering and a stale Git checkout", (t) => {
  const tampered = createApplicationFixture(t);
  fs.appendFileSync(path.join(tampered.packageRoot, "PROPOSAL.md"), "tampered\n");
  assertRecheckCode(() => applicationRecheckDryRun({
    applicationPackageDirectory: tampered.packageRoot,
    sourceRepositoryRoot: tampered.sourceRoot
  }), "REVIEW_BINDING_INVALID");

  const stale = createApplicationFixture(t);
  fs.writeFileSync(path.join(stale.sourceRoot, "README.md"), "later commit\n");
  runGit(stale.sourceRoot, ["add", "README.md"]);
  runGit(stale.sourceRoot, ["commit", "-q", "-m", "later"]);
  assertRecheckCode(() => applicationRecheckDryRun({
    applicationPackageDirectory: stale.packageRoot,
    sourceRepositoryRoot: stale.sourceRoot
  }), "SOURCE_GIT_BINDING_MISMATCH");
});

test("application recheck CLI is canonical, read-only, and rejects write options", (t) => {
  const fixture = createApplicationFixture(t);
  const beforePackage = snapshotDirectory(fixture.packageRoot);
  const beforeSubmission = fs.readFileSync(fixture.submissionPath);
  const execution = childProcess.spawnSync(process.execPath, [
    recheckCli,
    "--application-package",
    fixture.packageRoot,
    "--source-repository",
    fixture.sourceRoot,
    "--dry-run"
  ], { encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  const output = JSON.parse(execution.stdout);
  assert.equal(execution.stdout, `${canonicalJson(output)}\n`);
  assert.equal(output.dryRun, true);
  assert.equal(output.writePerformed, false);
  assert.equal(output.networkAccessed, false);
  assert.deepEqual(snapshotDirectory(fixture.packageRoot), beforePackage);
  assert.deepEqual(fs.readFileSync(fixture.submissionPath), beforeSubmission);

  const rejected = childProcess.spawnSync(process.execPath, [
    recheckCli,
    "--application-package",
    fixture.packageRoot,
    "--source-repository",
    fixture.sourceRoot,
    "--write"
  ], { encoding: "utf8" });
  assert.equal(rejected.status, 2);
  const error = JSON.parse(rejected.stdout);
  assert.equal(error.ok, false);
  assert.equal(error.error.code, "USAGE_ERROR");
  assert.equal(error.writePerformed, false);
});

test("public application v3 dedicated validator enforces every conditional review boundary", () => {
  const schema = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "public-pr-application-v3.schema.json"),
    "utf8"
  ));
  const example = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "assets", "templates", "open-world-v2", "public-pr-application-v3.example.json"),
    "utf8"
  ));
  assert.equal(schema.$id, "https://programmable.money/schemas/public-pr-application-v3.json");
  assert.deepEqual(validateAgainstSchema(example, schema), []);
  assert.equal(validatePublicPrApplicationV3(example).valid, true);
  assert.equal(schema.$defs.sourceClosure.properties.companions.maxItems, 8);
  assert.equal(schema.$defs.sourceRepository.properties.githubActionsRunIds.maxItems, 16);
  assert.deepEqual(schema.$defs.intentCapture.properties.captureStatus.enum, PUBLIC_PR_APPLICATION_V3_CAPTURE_STATUSES);
  assert.deepEqual(example.reviewPackage.requiredKinds, PUBLIC_PR_APPLICATION_V3_REQUIRED_REVIEW_KINDS);
  assert.equal(schema.$defs.reviewPackage.properties.records.maxItems, undefined);
  assert.ok(example.reviewPackage.records.some(({ kind }) => kind === "custom-risk-model"));
  assert.equal(example.policyBindings.programmableFeePolicyId, "programmable-volume-fee-v2");
  assert.equal(example.policyBindings.feeApplicability, "unresolved");
  assert.equal(example.lineage.previous.feePolicyId, "programmable-volume-fee-v1");
  assert.equal(example.lineage.previous.feeApplicability, "unresolved");
  assert.equal(example.applicationRevision, "2");
  assert.equal(example.lineage.previous.applicationRevision, "1");
  assert.equal(example.reviewState.status, "unreviewed");
  assert.equal(example.reviewState.inheritedApproval, false);

  const companionOverflow = structuredClone(example);
  companionOverflow.source.companions = Array.from({ length: 9 }, (_entry, index) => ({
    ...structuredClone(example.source.primary),
    id: `companion-${index + 1}`,
    numericRepositoryId: String(700000000 + index),
    repositoryUri: `https://github.com/example/companion-${index + 1}`
  }));
  assert.ok(validateAgainstSchema(companionOverflow, schema).length > 0);
  assert.equal(validatePublicPrApplicationV3(companionOverflow).valid, false);

  const actionsOverflow = structuredClone(example);
  actionsOverflow.source.primary.githubActionsRunIds = Array.from(
    { length: 17 },
    (_entry, index) => String(800000000 + index)
  );
  assert.ok(validateAgainstSchema(actionsOverflow, schema).length > 0);
  assert.equal(validatePublicPrApplicationV3(actionsOverflow).valid, false);

  const arbitraryPrecisionRevision = structuredClone(example);
  arbitraryPrecisionRevision.lineage.previous.applicationRevision = "9".repeat(256);
  arbitraryPrecisionRevision.applicationRevision = `1${"0".repeat(256)}`;
  assert.deepEqual(validateAgainstSchema(arbitraryPrecisionRevision, schema), []);
  assert.equal(validatePublicPrApplicationV3(arbitraryPrecisionRevision).valid, true);

  const revisionGap = structuredClone(arbitraryPrecisionRevision);
  revisionGap.applicationRevision = `1${"0".repeat(255)}1`;
  const revisionGapReport = validatePublicPrApplicationV3(revisionGap);
  assert.ok(revisionGapReport.findings.some(({ code }) => code === "APPLICATION_LINEAGE_REVISION_SEQUENCE_INVALID"));

  const nonCanonicalRevision = structuredClone(example);
  nonCanonicalRevision.applicationRevision = "02";
  const nonCanonicalRevisionReport = validatePublicPrApplicationV3(nonCanonicalRevision);
  assert.equal(nonCanonicalRevisionReport.valid, false);
  assert.ok(nonCanonicalRevisionReport.findings.some(({ code }) => code === "APPLICATION_REVISION_INVALID"));

  const longPathAndProse = structuredClone(example);
  const longCommittedPath = `${Array.from({ length: 10 }, (_entry, index) => `${index}-${"p".repeat(220)}`).join("/")}/Hook.sol`;
  assert.ok(Buffer.byteLength(longCommittedPath, "utf8") > 2048);
  longPathAndProse.source.primary.sourcePaths.push(longCommittedPath);
  longPathAndProse.summary = `Unicode product explanation: ${"設計境界".repeat(6000)}`;
  longPathAndProse.intentCapture.facts[0].statement = `Unbounded semantic evidence: ${"機構".repeat(12000)}`;
  assert.ok(Buffer.byteLength(longPathAndProse.summary, "utf8") > 20_000);
  assert.deepEqual(validateAgainstSchema(longPathAndProse, schema), []);
  assert.equal(validatePublicPrApplicationV3(longPathAndProse).valid, true);

  const mutations = [
    {
      code: "APPLICATION_PROPOSAL_FEE_APPLICABILITY_INVALID",
      mutate: (value) => { value.policyBindings.feeApplicability = "applicable"; }
    },
    {
      code: "APPLICATION_LEGACY_INTENT_STATE_INVALID",
      mutate: (value) => { value.intentCapture.agentInterpretationStatus = "owner-confirmed"; }
    },
    {
      code: "APPLICATION_DERIVED_FACT_CONFIRMATION_INVALID",
      mutate: (value) => { value.intentCapture.facts[0].confirmationStatus = "confirmed"; }
    },
    {
      code: "APPLICATION_LEGACY_FIDELITY_INVALID",
      mutate: (value) => { value.fidelity.status = "complete"; }
    },
    {
      code: "APPLICATION_FEE_V2_BINDING_INVALID",
      mutate: (value) => { value.policyBindings.programmableFeePolicyId = "programmable-volume-fee-v1"; }
    },
    {
      code: "APPLICATION_REVIEW_STATE_INVALID",
      mutate: (value) => { value.reviewState.inheritedApproval = true; }
    },
    {
      code: "APPLICATION_REVIEW_REQUIRED_KINDS_INVALID",
      mutate: (value) => { value.reviewPackage.requiredKinds.pop(); }
    },
    {
      code: "APPLICATION_REVIEW_RECORD_KIND_MISSING",
      mutate: (value) => {
        value.reviewPackage.records = value.reviewPackage.records.filter(({ kind }) => kind !== "security-assessment");
      }
    },
    {
      code: "APPLICATION_FEE_SCHEMA_REVIEW_BINDING_MISMATCH",
      mutate: (value) => { value.policyBindings.feePolicySchemaSha256 = HASH_A; }
    },
    {
      code: "APPLICATION_PACKAGE_RECORD_REPOSITORY_REF_INVALID",
      mutate: (value) => { value.reviewPackage.records[0].repositoryRef = "primary"; }
    },
    {
      code: "APPLICATION_REVIEW_REPOSITORY_REF_MISSING",
      mutate: (value) => { value.reviewPackage.records[5].repositoryRef = "missing-repository"; }
    },
    {
      code: "APPLICATION_PUBLIC_TEXT_SENSITIVE_CANDIDATE",
      mutate: (value) => { value.summary = "api_key=sk-supersecret-token-1234567890"; }
    },
    {
      code: "APPLICATION_SECURITY_ASSESSMENT_SELF_REFERENCE_FORBIDDEN",
      mutate: (value) => { value.securityBindings.securityAssessmentRepositoryRef = "primary"; }
    },
    {
      code: "APPLICATION_SECURITY_SCHEMA_SOURCE_BINDING_FORBIDDEN",
      mutate: (value) => { value.securityBindings.securityAssessmentSchemaRepositoryRef = "primary"; }
    }
  ];
  for (const { code, mutate } of mutations) {
    const invalid = structuredClone(example);
    mutate(invalid);
    const report = validatePublicPrApplicationV3(invalid);
    assert.equal(report.valid, false, code);
    assert.ok(report.findings.some((finding) => finding.code === code), `${code}: ${JSON.stringify(report.findings)}`);
    assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
    assert.equal(report.approvalGranted, false);
  }

  const privateCandidate = "sk-never-echo-this-private-value-1234567890";
  const privacyHeld = structuredClone(example);
  privacyHeld.title = `password=${privateCandidate}`;
  privacyHeld.intentCapture.unresolvedMaterialDecisions.push(`private email=owner-private@example.invalid ${privateCandidate}`);
  const privacyReport = validatePublicPrApplicationV3(privacyHeld);
  assert.equal(privacyReport.valid, false);
  assert.equal(privacyReport.status, "HELD_FOR_PRIVACY_REDACTION");
  assert.equal(privacyReport.publicApplicationEligibility, "HELD_FOR_PRIVACY_REDACTION");
  assert.ok(privacyReport.findings.filter(({ code }) => code === "APPLICATION_PUBLIC_TEXT_SENSITIVE_CANDIDATE").length >= 2);
  assert.doesNotMatch(JSON.stringify(privacyReport), new RegExp(privateCandidate, "u"));

  const publicFinancialIdentifier = "CH9300762011623852957";
  const disclosureEvidenceRef = "review/public-disclosure-authorization.md";
  const disclosureEvidenceSha256 = `sha256:${"6".repeat(64)}`;
  const attestedIdentifier = structuredClone(example);
  attestedIdentifier.summary = `The intentionally public treasury settlement account is ${publicFinancialIdentifier} and remains human-reviewed.`;
  attestedIdentifier.reviewPackage.records.push({
    kind: "public-disclosure-authorization",
    path: disclosureEvidenceRef,
    mediaType: "text/markdown",
    byteLength: 128,
    sha256: disclosureEvidenceSha256,
    source: "application-package",
    repositoryRef: null
  });
  attestedIdentifier.publicDisclosureAttestations = [{
    id: "public-treasury-settlement-account",
    category: "public-financial-identifier",
    candidatePointer: "/summary",
    candidateSha256: sha256Bytes(Buffer.from(publicFinancialIdentifier, "utf8")),
    subject: {
      applicationId: attestedIdentifier.applicationId,
      purpose: "Publish the treasury settlement destination for transparent reconciliation."
    },
    authorization: {
      provenance: "owner-stated",
      ownerConfirmation: "confirmed",
      evidenceRef: disclosureEvidenceRef,
      evidenceSha256: disclosureEvidenceSha256,
      reviewState: "human-review-required",
      ownershipProofClaim: false,
      approvalClaim: false
    }
  }];
  assert.deepEqual(validateAgainstSchema(attestedIdentifier, schema), []);
  const attestedReport = validatePublicPrApplicationV3(attestedIdentifier);
  assert.equal(attestedReport.valid, true, JSON.stringify(attestedReport.findings));
  assert.ok(attestedReport.findings.some(({ code, severity, humanReviewRequired }) => (
    code === "APPLICATION_PUBLIC_FINANCIAL_IDENTIFIER_ATTESTED_REVIEW_REQUIRED"
    && severity === "review"
    && humanReviewRequired === true
  )));

  const wrongDigestAttestation = structuredClone(attestedIdentifier);
  wrongDigestAttestation.publicDisclosureAttestations[0].candidateSha256 = HASH_A;
  const wrongDigestReport = validatePublicPrApplicationV3(wrongDigestAttestation);
  assert.equal(wrongDigestReport.status, "HELD_FOR_PRIVACY_REDACTION");
  assert.ok(wrongDigestReport.findings.some(({ code }) => code === "APPLICATION_PUBLIC_TEXT_DISCLOSURE_ATTESTATION_INVALID"));

  const wrongPointerAttestation = structuredClone(attestedIdentifier);
  wrongPointerAttestation.publicDisclosureAttestations[0].candidatePointer = "/title";
  const wrongPointerReport = validatePublicPrApplicationV3(wrongPointerAttestation);
  assert.equal(wrongPointerReport.status, "HELD_FOR_PRIVACY_REDACTION");

  const wrongApplicationAttestation = structuredClone(attestedIdentifier);
  wrongApplicationAttestation.publicDisclosureAttestations[0].subject.applicationId = "different-application";
  const wrongApplicationReport = validatePublicPrApplicationV3(wrongApplicationAttestation);
  assert.equal(wrongApplicationReport.status, "HELD_FOR_PRIVACY_REDACTION");

  const oneByteCandidateDrift = structuredClone(attestedIdentifier);
  oneByteCandidateDrift.summary = oneByteCandidateDrift.summary.replace(publicFinancialIdentifier, `${publicFinancialIdentifier.slice(0, -1)}8`);
  const oneByteDriftReport = validatePublicPrApplicationV3(oneByteCandidateDrift);
  assert.equal(oneByteDriftReport.status, "HELD_FOR_PRIVACY_REDACTION");
  assert.ok(oneByteDriftReport.findings.some(({ code }) => code === "APPLICATION_PUBLIC_TEXT_DISCLOSURE_ATTESTATION_INVALID"));

  const partiallyAttested = structuredClone(attestedIdentifier);
  partiallyAttested.summary += " A second public-looking account DE89370400440532013000 is not covered by the first attestation.";
  const partiallyAttestedReport = validatePublicPrApplicationV3(partiallyAttested);
  assert.equal(partiallyAttestedReport.status, "HELD_FOR_PRIVACY_REDACTION");
  assert.ok(partiallyAttestedReport.findings.some(({ code }) => code === "APPLICATION_PUBLIC_TEXT_SENSITIVE_CANDIDATE"));

  const unattestedFinancialIdentifier = structuredClone(example);
  unattestedFinancialIdentifier.summary = `Private settlement account ${publicFinancialIdentifier} must not materialize without exact authorization.`;
  assert.equal(validatePublicPrApplicationV3(unattestedFinancialIdentifier).status, "HELD_FOR_PRIVACY_REDACTION");

  const privateKeyCandidate = ["-----BEGIN", " PRIVATE KEY-----"].join("");
  const forbiddenSecretAttestation = structuredClone(attestedIdentifier);
  forbiddenSecretAttestation.summary = `Credential material ${privateKeyCandidate} must always be redacted.`;
  forbiddenSecretAttestation.publicDisclosureAttestations[0].candidateSha256 = sha256Bytes(Buffer.from(privateKeyCandidate, "utf8"));
  const forbiddenSecretReport = validatePublicPrApplicationV3(forbiddenSecretAttestation);
  assert.equal(forbiddenSecretReport.status, "HELD_FOR_PRIVACY_REDACTION");
  assert.ok(forbiddenSecretReport.findings.some(({ code }) => code === "APPLICATION_PUBLIC_TEXT_SENSITIVE_CANDIDATE"));
  assert.ok(forbiddenSecretReport.findings.some(({ code }) => code === "APPLICATION_PUBLIC_TEXT_DISCLOSURE_ATTESTATION_INVALID"));
  assert.equal(JSON.stringify(forbiddenSecretReport).includes(privateKeyCandidate), false);

  const secretBesideAttestedIdentifier = structuredClone(attestedIdentifier);
  secretBesideAttestedIdentifier.summary += " api_key=sk-never-waive-this-secret-value-1234567890";
  const secretBesideReport = validatePublicPrApplicationV3(secretBesideAttestedIdentifier);
  assert.equal(secretBesideReport.status, "HELD_FOR_PRIVACY_REDACTION");
  assert.ok(secretBesideReport.findings.some(({ code, candidateKinds }) => (
    code === "APPLICATION_PUBLIC_TEXT_SENSITIVE_CANDIDATE"
    && candidateKinds.includes("api-access-token")
  )));

  const publicIdentifier = structuredClone(example);
  publicIdentifier.summary = `Public transaction identifier 0x${"a".repeat(64)} remains review evidence, not an automatic secret.`;
  assert.equal(validatePublicPrApplicationV3(publicIdentifier).valid, true);
});

test("public application v3 fee applicability is a closed stage tuple and review-record contract", () => {
  const schema = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "public-pr-application-v3.schema.json"),
    "utf8"
  ));
  const proposal = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "assets", "templates", "open-world-v2", "public-pr-application-v3.example.json"),
    "utf8"
  ));
  assert.deepEqual(validateAgainstSchema(proposal, schema), []);
  assert.equal(validatePublicPrApplicationV3(proposal).valid, true);

  const notApplicable = structuredClone(proposal);
  notApplicable.stage = "prototype";
  notApplicable.policyBindings.feeApplicability = "not-applicable";
  assert.deepEqual(validateAgainstSchema(notApplicable, schema), []);
  assert.equal(validatePublicPrApplicationV3(notApplicable).valid, true);

  const injectedFeeRecord = structuredClone(notApplicable);
  injectedFeeRecord.reviewPackage.records.push({
    kind: "fee-policy",
    path: "submissions/legacy-open-world-example/injected-fee-policy.v2.json",
    mediaType: "application/json",
    byteLength: 100,
    sha256: `sha256:${"4".repeat(64)}`,
    source: "source-repository",
    repositoryRef: "primary"
  });
  const injectedReport = validatePublicPrApplicationV3(injectedFeeRecord);
  assert.ok(injectedReport.findings.some(({ code }) => (
    code === "APPLICATION_FEE_NOT_APPLICABLE_REVIEW_RECORD_FORBIDDEN"
  )), JSON.stringify(injectedReport.findings));

  const unresolvedPrototype = structuredClone(notApplicable);
  unresolvedPrototype.policyBindings.feeApplicability = "unresolved";
  const unresolvedReport = validatePublicPrApplicationV3(unresolvedPrototype);
  assert.ok(unresolvedReport.findings.some(({ code }) => (
    code === "APPLICATION_PROTOTYPE_FEE_APPLICABILITY_UNRESOLVED"
  )), JSON.stringify(unresolvedReport.findings));

  const evasion = structuredClone(notApplicable);
  evasion.policyBindings.feePolicyInstancePath = "submissions/legacy-open-world-example/injected-fee-policy.v2.json";
  const evasionReport = validatePublicPrApplicationV3(evasion);
  assert.ok(evasionReport.findings.some(({ code }) => (
    code === "APPLICATION_FEE_NOT_APPLICABLE_INSTANCE_FORBIDDEN"
  )), JSON.stringify(evasionReport.findings));

  const applicable = structuredClone(notApplicable);
  const feePath = "submissions/legacy-open-world-example/fee-policy.v2.json";
  const feeSha256 = `sha256:${"7".repeat(64)}`;
  applicable.policyBindings.feeApplicability = "applicable";
  applicable.policyBindings.feePolicyInstancePath = feePath;
  applicable.policyBindings.feePolicyInstanceRepositoryRef = "primary";
  applicable.policyBindings.feePolicyInstanceSha256 = feeSha256;
  applicable.source.primary.sourcePaths.push(feePath);
  applicable.source.primary.sourcePaths.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  applicable.reviewPackage.records.push({
    kind: "fee-policy",
    path: feePath,
    mediaType: "application/json",
    byteLength: 100,
    sha256: feeSha256,
    source: "source-repository",
    repositoryRef: "primary"
  });
  assert.deepEqual(validateAgainstSchema(applicable, schema), []);
  assert.equal(validatePublicPrApplicationV3(applicable).valid, true);

  const missingApplicableRecord = structuredClone(applicable);
  missingApplicableRecord.reviewPackage.records = missingApplicableRecord.reviewPackage.records.filter(({ kind }) => kind !== "fee-policy");
  const missingRecordReport = validatePublicPrApplicationV3(missingApplicableRecord);
  assert.ok(missingRecordReport.findings.some(({ code }) => (
    code === "APPLICATION_FEE_INSTANCE_REVIEW_BINDING_MISMATCH"
  )), JSON.stringify(missingRecordReport.findings));
});

test("public application v3 generator materializes only an exact source-assessed prototype", () => {
  const application = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "assets", "templates", "open-world-v2", "public-pr-application-v3.example.json"),
    "utf8"
  ));
  const primary = application.source.primary;
  const manifestPath = "review/source-closure/source-closure-manifest.v1.json";
  const manifestSha256 = `sha256:${"5".repeat(64)}`;
  const manifestByteLength = 456;
  const closureSha256 = `sha256:${"8".repeat(64)}`;
  const verificationReportPath = "source-closure-verification.primary.json";
  primary.sourceClosureMode = "manifest";
  primary.sourcePaths = [];
  primary.sourceManifest = {
    schemaId: "urn:programmable:source-closure-manifest:1.0.0",
    schemaVersion: "1.0.0",
    path: manifestPath,
    sha256: manifestSha256,
    byteLength: manifestByteLength,
    blobObjectId: "6".repeat(40),
    entryCount: 10,
    fragmentCount: 2
  };
  application.stage = "prototype";
  application.intentCapture.captureStatus = "captured-verbatim-public-safe";
  application.intentCapture.originalIdeaDisplayExcerpt = "Build the exact owner-confirmed open-world mechanism.";
  application.intentCapture.agentInterpretationStatus = "owner-confirmed";
  application.intentCapture.facts = application.intentCapture.facts.map((fact) => ({
    ...fact,
    provenance: "owner-stated",
    confirmationStatus: "confirmed"
  }));
  application.intentCapture.unresolvedMaterialDecisions = [];
  application.fidelity = {
    schemaVersion: "1.0.0",
    status: "complete",
    reasonCode: null,
    requirementBindings: []
  };
  application.policyBindings.feePolicyInstancePath = "submissions/legacy-open-world-example/fee-policy.v2.json";
  application.policyBindings.feePolicyInstanceRepositoryRef = "primary";
  application.policyBindings.feePolicyInstanceSha256 = `sha256:${"7".repeat(64)}`;
  application.policyBindings.feeApplicability = "applicable";
  application.reviewPackage.records.push({
    kind: "fee-policy",
    path: application.policyBindings.feePolicyInstancePath,
    mediaType: "application/json",
    byteLength: 100,
    sha256: application.policyBindings.feePolicyInstanceSha256,
    source: "source-repository",
    repositoryRef: "primary"
  }, {
    kind: "source-closure-manifest",
    path: manifestPath,
    mediaType: "application/json",
    byteLength: manifestByteLength,
    sha256: manifestSha256,
    source: "source-repository",
    repositoryRef: "primary"
  });
  const verificationReport = {
    status: "VERIFIED",
    sourceClosureVerified: true,
    readOnly: true,
    networkAccessed: false,
    candidateCodeExecuted: false,
    dependencyPointerCoverage: dependencyPointerCoverage("NONE"),
    sourceBinding: {
      repositoryRef: "primary",
      revisionObjectId: primary.revisionObjectId,
      treeObjectId: primary.treeObjectId,
      sourceClosureMode: "manifest",
      manifestPath,
      manifestSha256,
      manifestByteLength,
      closureSha256
    }
  };
  const verificationReportBytes = Buffer.from(`${canonicalJson(verificationReport)}\n`, "utf8");
  const verificationReportSha256 = sha256Bytes(verificationReportBytes);
  const securityAssessment = {
    schemaVersion: "open-world-security-v1",
    subject: {
      id: application.applicationId,
      revision: primary.revisionObjectId,
      stage: "prototype"
    },
    assessment: {
      state: "source-assessed",
      reasonCode: null,
      evidenceRefs: [manifestPath, verificationReportPath],
      sourceCoverage: {
        primaryRepositoryRef: "primary",
        repositories: [{
          repositoryRef: "primary",
          revisionObjectId: primary.revisionObjectId,
          treeObjectId: primary.treeObjectId,
          sourceClosureMode: "manifest",
          sourcePaths: [],
          sourcePathsSha256: null,
          manifestPath,
          manifestSha256,
          manifestByteLength,
          closureSha256,
          reportPath: verificationReportPath,
          reportSha256: verificationReportSha256,
          reportByteLength: verificationReportBytes.length,
          result: "VERIFIED"
        }]
      }
    },
    layers: {
      source: {
        evidenceRefs: [manifestPath, verificationReportPath],
        customProfiles: []
      }
    },
    extensions: []
  };
  const securitySchema = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "open-world-security-v1.schema.json"),
    "utf8"
  ));
  const securitySchemaBytes = Buffer.from(`${canonicalJson(securitySchema)}\n`, "utf8");
  const securityAssessmentBytes = Buffer.from(`${canonicalJson(securityAssessment)}\n`, "utf8");
  Object.assign(application.securityBindings, {
    securityAssessmentSchemaPath: "security-assessment-v1.schema.json",
    securityAssessmentSchemaRepositoryRef: null,
    securityAssessmentSchemaSha256: sha256Bytes(securitySchemaBytes),
    securityAssessmentSchemaByteLength: securitySchemaBytes.length,
    securityAssessmentPath: "security-assessment.v1.json",
    securityAssessmentRepositoryRef: null,
    securityAssessmentSha256: sha256Bytes(securityAssessmentBytes),
    securityAssessmentByteLength: securityAssessmentBytes.length
  });
  const securitySchemaRecord = application.reviewPackage.records.find(({ kind }) => kind === "security-assessment-schema");
  Object.assign(securitySchemaRecord, {
    path: application.securityBindings.securityAssessmentSchemaPath,
    byteLength: securitySchemaBytes.length,
    sha256: application.securityBindings.securityAssessmentSchemaSha256,
    source: "application-package",
    repositoryRef: null
  });
  const securityAssessmentRecord = application.reviewPackage.records.find(({ kind }) => kind === "security-assessment");
  Object.assign(securityAssessmentRecord, {
    path: application.securityBindings.securityAssessmentPath,
    byteLength: securityAssessmentBytes.length,
    sha256: application.securityBindings.securityAssessmentSha256,
    source: "application-package",
    repositoryRef: null
  });
  application.reviewPackage.records.push({
    kind: "source-closure-verification",
    path: verificationReportPath,
    mediaType: "application/json",
    byteLength: verificationReportBytes.length,
    sha256: verificationReportSha256,
    source: "application-package",
    repositoryRef: null
  });
  application.source.verificationReports = [{
    repositoryRef: "primary",
    revisionObjectId: primary.revisionObjectId,
    treeObjectId: primary.treeObjectId,
    sourceClosureMode: "manifest",
    sourcePaths: [],
    sourcePathsSha256: null,
    manifestPath,
    manifestSha256,
    manifestByteLength,
    closureSha256,
    reportPath: verificationReportPath,
    reportSha256: verificationReportSha256,
    reportByteLength: verificationReportBytes.length,
    result: "VERIFIED"
  }];
  const input = {
    application,
    securityAssessment,
    sourceCoverage: [{
      repositoryRef: "primary",
      revisionObjectId: primary.revisionObjectId,
      treeObjectId: primary.treeObjectId,
      sourceClosureMode: "manifest",
      sourcePaths: [],
      sourcePathsSha256: null,
      manifestPath,
      manifestSha256,
      manifestByteLength,
      closureSha256,
      verificationReportPath,
      verificationReportSha256,
      verificationReportByteLength: verificationReportBytes.length,
      verificationReport
    }],
    securityEvidenceBindings: [
      {
        evidenceRef: manifestPath,
        kind: "source-closure-manifest",
        path: manifestPath,
        repositoryRef: "primary",
        sha256: manifestSha256,
        source: "source-repository"
      },
      {
        evidenceRef: verificationReportPath,
        kind: "source-closure-verification",
        path: verificationReportPath,
        repositoryRef: null,
        sha256: verificationReportSha256,
        source: "application-package"
      }
    ]
  };
  const generated = generatePublicPrApplicationV3(input);
  assert.equal(generated.materializationAllowed, true, JSON.stringify(generated.report.findings));
  assert.equal(generated.report.approvalGranted, false);
  assert.equal(generated.report.launchAuthorizationGranted, false);
  assert.equal(generated.securityAnalysis.route, "INDEPENDENT_REVIEW");
  assert.equal(generated.report.status, "HELD_FOR_INDEPENDENT_SECURITY_REVIEW");
  assert.ok(generated.securityAnalysis.findings.some(({ code }) => code === "SOURCE_SEMANTIC_COVERAGE_UNPROVEN"));

  const inline = inlineMaterializationInput(input);
  const inlineGenerated = generatePublicPrApplicationV3(inline);
  assert.equal(inlineGenerated.materializationAllowed, true, JSON.stringify(inlineGenerated.report.findings));
  assert.equal(inlineGenerated.report.status, "HELD_FOR_INDEPENDENT_SECURITY_REVIEW");
  assert.equal(inline.application.source.primary.sourceClosureMode, "inline");
  assert.ok(inline.application.source.primary.sourcePaths.length <= 4096);
  assert.equal(inline.application.source.primary.sourceManifest, null);

  const localOnlyLfs = structuredClone(inline);
  const localOnlyLfsCoverage = dependencyPointerCoverage("VERIFIED");
  localOnlyLfsCoverage.counts.symlink = 0;
  localOnlyLfsCoverage.counts.gitLfs = 1;
  rebindDependencyPointerCoverage(localOnlyLfs, localOnlyLfsCoverage);
  refreshDerivedSecurityBinding(localOnlyLfs);
  const localOnlyLfsGenerated = generatePublicPrApplicationV3(localOnlyLfs);
  assert.equal(localOnlyLfsGenerated.materializationAllowed, true, JSON.stringify(localOnlyLfsGenerated.report.findings));
  assert.equal(localOnlyLfsGenerated.report.status, "HELD_FOR_INDEPENDENT_SOURCE_REVIEW");
  assert.equal(localOnlyLfsGenerated.report.approvalGranted, false);
  assert.equal(localOnlyLfsGenerated.report.launchAuthorizationGranted, false);
  assert.ok(localOnlyLfsGenerated.report.findings.some(({ code, availabilityVerified, reproducibilityVerified }) => (
    code === "APPLICATION_SOURCE_DEPENDENCY_REPRO_REVIEW_REQUIRED"
    && availabilityVerified === false
    && reproducibilityVerified === false
  )));

  const unresolvedDependency = structuredClone(inline);
  rebindDependencyPointerCoverage(unresolvedDependency, dependencyPointerCoverage("UNRESOLVED"));
  unresolvedDependency.securityAssessment.assessment.state = "partial";
  unresolvedDependency.securityAssessment.assessment.reasonCode = "DEPENDENCY_TARGETS_UNRESOLVED";
  unresolvedDependency.securityAssessment.assessment.sourceCoverage = null;
  refreshDerivedSecurityBinding(unresolvedDependency);
  const unresolvedDependencyGenerated = generatePublicPrApplicationV3(unresolvedDependency);
  assert.equal(
    unresolvedDependencyGenerated.materializationAllowed,
    true,
    JSON.stringify(unresolvedDependencyGenerated.report.findings)
  );
  assert.equal(unresolvedDependencyGenerated.report.approvalGranted, false);
  assert.equal(unresolvedDependencyGenerated.report.launchAuthorizationGranted, false);
  assert.equal(unresolvedDependencyGenerated.report.status, "HELD_FOR_INDEPENDENT_SECURITY_REVIEW");

  const openGameAndPermissionedExit = structuredClone(inline);
  openGameAndPermissionedExit.securityAssessment.layers.intent = {
    evidenceRefs: [verificationReportPath],
    gameSettlement: {
      evidenceRefs: [verificationReportPath],
      used: true,
      movesValue: true,
      lossExposureBounded: true,
      payoutExposureBounded: true,
      authorizationScopeBound: true,
      replayProtectionBound: true,
      livenessBounded: true,
      failureResolutionDefined: true,
      custodyModelDisclosed: true,
      custodyAuthorizationBound: true,
      operatorCanMoveUnescrowedFunds: true,
      operatorCanChooseRecipientOutsideMatch: true,
      operatorCanExceedAuthorizedExposure: false,
      operatorCanChooseUnauthorizedRecipient: false
    },
    exitLiveness: {
      evidenceRefs: [verificationReportPath],
      used: true,
      userExitExists: true,
      boundedTime: false,
      boundedGas: true,
      independentOfAdmin: false,
      independentOfKeeper: true,
      dependencyFailureMode: "exit-remains-available",
      selectiveBlockingPossible: true,
      selectiveBlockingDisclosed: true,
      selectiveBlockingScopeBound: true,
      selectiveBlockingAuthorizationBound: true,
      blockedValueCannotBeRedirectedByPlatformAuthority: true,
      selectiveBlockingReviewAvailable: true,
      recipientFailureIsolated: true,
      unboundedLoop: false
    }
  };
  refreshDerivedSecurityBinding(openGameAndPermissionedExit);
  const openGameAndPermissionedExitResult = generatePublicPrApplicationV3(openGameAndPermissionedExit);
  assert.equal(openGameAndPermissionedExitResult.materializationAllowed, true, JSON.stringify(openGameAndPermissionedExitResult.report.findings));
  assert.equal(openGameAndPermissionedExitResult.report.status, "HELD_FOR_INDEPENDENT_SECURITY_REVIEW");
  assert.equal(openGameAndPermissionedExitResult.report.findings.some(({ code }) => code === "APPLICATION_SECURITY_CONFIRMED_REDESIGN_REQUIRED"), false);

  const gameExposureAbuse = structuredClone(openGameAndPermissionedExit);
  gameExposureAbuse.securityAssessment.layers.intent.gameSettlement.operatorCanExceedAuthorizedExposure = true;
  refreshDerivedSecurityBinding(gameExposureAbuse);
  const gameExposureAbuseResult = generatePublicPrApplicationV3(gameExposureAbuse);
  assert.equal(gameExposureAbuseResult.materializationAllowed, false);
  assert.ok(gameExposureAbuseResult.report.findings.some(({ code, securityCode }) => (
    code === "APPLICATION_SECURITY_CONFIRMED_REDESIGN_REQUIRED"
    && securityCode === "GAME_OPERATOR_EXCEEDS_AUTHORIZED_EXPOSURE"
  )));

  const hiddenSelectiveBlocking = structuredClone(openGameAndPermissionedExit);
  hiddenSelectiveBlocking.securityAssessment.layers.intent.exitLiveness.selectiveBlockingDisclosed = false;
  refreshDerivedSecurityBinding(hiddenSelectiveBlocking);
  const hiddenSelectiveBlockingResult = generatePublicPrApplicationV3(hiddenSelectiveBlocking);
  assert.equal(hiddenSelectiveBlockingResult.materializationAllowed, false);
  assert.ok(hiddenSelectiveBlockingResult.report.findings.some(({ code, securityCode }) => (
    code === "APPLICATION_SECURITY_CONFIRMED_REDESIGN_REQUIRED"
    && securityCode === "EXIT_SELECTIVE_BLOCKING_DISCLOSURE_MISSING"
  )));

  const safeRandomnessIntent = (overrides = {}) => ({
    evidenceRefs: [verificationReportPath],
    used: true,
    economicOutcome: true,
    participantValueAtRisk: false,
    sourceBiasDisclosed: true,
    promisedUnbiasedOutcome: false,
    manipulationCanReduceEnforceableUserEntitlement: false,
    source: "vrf",
    domainBound: true,
    replayProtected: true,
    withholdingBounded: true,
    biasResistance: true,
    fallback: "cancel-and-refund",
    ...overrides
  });
  const safeReturnDeltaIntent = (overrides = {}) => ({
    evidenceRefs: [verificationReportPath],
    used: true,
    noOpReturnDeltaUsed: false,
    noOpUsedOnPathClaimingCustomAccounting: false,
    canConsumeEntireSpecifiedAmount: true,
    zeroOutputPossible: false,
    userAuthorizedZeroOutput: false,
    outputBalanceBacked: true,
    finalCallerDeltaBound: true,
    allEnabledQuadrantsCovered: true,
    partialFillDefined: true,
    settlementCompletesBeforeUnlockEnd: true,
    deltaConservationProven: true,
    ...overrides
  });
  const safeExitIntent = (overrides = {}) => ({
    evidenceRefs: [verificationReportPath],
    used: true,
    userExitExists: true,
    outstandingUserEntitlementExists: true,
    userAuthorizedIrreversibleDisposition: false,
    irreversibleDispositionDisclosed: false,
    managedRedemption: false,
    managedRedemptionDisclosed: false,
    managedRedemptionAuthorizationBound: false,
    managedRedemptionRecourseAvailable: false,
    authorityCanSeizeOrRedirectOwedValue: false,
    autonomousExitPromised: true,
    boundedTime: true,
    boundedGas: true,
    independentOfAdmin: true,
    independentOfKeeper: true,
    dependencyFailureMode: "exit-remains-available",
    selectiveBlockingPossible: false,
    recipientFailureIsolated: true,
    unboundedLoop: false,
    ...overrides
  });
  const managedExitIntent = (overrides = {}) => safeExitIntent({
    managedRedemption: true,
    managedRedemptionDisclosed: true,
    managedRedemptionAuthorizationBound: true,
    autonomousExitPromised: false,
    boundedTime: false,
    independentOfAdmin: false,
    independentOfKeeper: false,
    dependencyFailureMode: "custom-reviewed",
    ...overrides
  });
  const irreversibleExitIntent = (overrides = {}) => safeExitIntent({
    userExitExists: false,
    outstandingUserEntitlementExists: false,
    userAuthorizedIrreversibleDisposition: true,
    irreversibleDispositionDisclosed: true,
    autonomousExitPromised: false,
    dependencyFailureMode: "fail-closed-no-new-value",
    ...overrides
  });
  const applicationForIntentProfile = (profile, value) => {
    const candidate = structuredClone(inline);
    candidate.securityAssessment.layers.intent = {
      evidenceRefs: [verificationReportPath],
      [profile]: value
    };
    refreshDerivedSecurityBinding(candidate);
    return generatePublicPrApplicationV3(candidate);
  };
  const assertConfirmedIntentRedesign = (profile, value, securityCode) => {
    const result = applicationForIntentProfile(profile, value);
    assert.equal(result.materializationAllowed, false, `${securityCode}: ${JSON.stringify(result.report.findings)}`);
    assert.ok(result.report.findings.some(({ code, securityCode: observedCode }) => (
      code === "APPLICATION_SECURITY_CONFIRMED_REDESIGN_REQUIRED"
      && observedCode === securityCode
    )), `${securityCode}: ${JSON.stringify(result.report.findings)}`);
  };
  const assertReviewableIntent = (profile, value, forbiddenSecurityCodes) => {
    const result = applicationForIntentProfile(profile, value);
    assert.equal(result.materializationAllowed, true, JSON.stringify(result.report.findings));
    assert.equal(result.report.findings.some(({ code, securityCode }) => (
      code === "APPLICATION_SECURITY_CONFIRMED_REDESIGN_REQUIRED"
      && forbiddenSecurityCodes.includes(securityCode)
    )), false, JSON.stringify(result.report.findings));
  };

  for (const [value, securityCode] of [
    [safeRandomnessIntent({ source: "signed-server", participantValueAtRisk: true }), "ECONOMIC_RANDOMNESS_PARTICIPANT_VALUE_EXPOSED_TO_BIAS"],
    [safeRandomnessIntent({ source: "blockhash", promisedUnbiasedOutcome: true }), "ECONOMIC_RANDOMNESS_UNBIASED_PROMISE_FALSE"],
    [safeRandomnessIntent({ manipulationCanReduceEnforceableUserEntitlement: true }), "ECONOMIC_RANDOMNESS_ENFORCEABLE_ENTITLEMENT_MANIPULABLE"],
    [safeRandomnessIntent({ participantValueAtRisk: true, withholdingBounded: false }), "ECONOMIC_RANDOMNESS_VALUE_BEARING_WITHHOLDING_UNBOUNDED"]
  ]) assertConfirmedIntentRedesign("randomness", value, securityCode);

  assertConfirmedIntentRedesign(
    "returnDelta",
    safeReturnDeltaIntent({
      noOpReturnDeltaUsed: true,
      noOpUsedOnPathClaimingCustomAccounting: true
    }),
    "RETURN_DELTA_NOOP_ON_CLAIMED_CUSTOM_ACCOUNTING"
  );

  for (const [value, securityCode] of [
    [safeExitIntent({ userExitExists: false, autonomousExitPromised: false }), "EXIT_OWED_ENTITLEMENT_PATH_ABSENT"],
    [irreversibleExitIntent({ userAuthorizedIrreversibleDisposition: false }), "EXIT_IRREVERSIBLE_DISPOSITION_UNAUTHORIZED"],
    [irreversibleExitIntent({ irreversibleDispositionDisclosed: false }), "EXIT_IRREVERSIBLE_DISPOSITION_UNDISCLOSED"],
    [managedExitIntent({ managedRedemptionDisclosed: false }), "EXIT_MANAGED_REDEMPTION_UNDISCLOSED"],
    [managedExitIntent({ managedRedemptionAuthorizationBound: false }), "EXIT_MANAGED_REDEMPTION_AUTHORIZATION_UNBOUND"],
    [safeExitIntent({ authorityCanSeizeOrRedirectOwedValue: true }), "EXIT_AUTHORITY_CAN_SEIZE_OR_REDIRECT_OWED_VALUE"],
    [managedExitIntent({ autonomousExitPromised: true }), "EXIT_AUTONOMOUS_PROMISE_FALSE"],
    [safeExitIntent({ autonomousExitPromised: false, independentOfAdmin: false }), "EXIT_ADMIN_BLOCKABLE"]
  ]) assertConfirmedIntentRedesign("exitLiveness", value, securityCode);

  assertReviewableIntent(
    "randomness",
    safeRandomnessIntent({
      source: "signed-server",
      participantValueAtRisk: false,
      promisedUnbiasedOutcome: false,
      manipulationCanReduceEnforceableUserEntitlement: false,
      withholdingBounded: false,
      biasResistance: false
    }),
    [
      "ECONOMIC_RANDOMNESS_PARTICIPANT_VALUE_EXPOSED_TO_BIAS",
      "ECONOMIC_RANDOMNESS_UNBIASED_PROMISE_FALSE",
      "ECONOMIC_RANDOMNESS_ENFORCEABLE_ENTITLEMENT_MANIPULABLE",
      "ECONOMIC_RANDOMNESS_VALUE_BEARING_WITHHOLDING_UNBOUNDED"
    ]
  );
  assertReviewableIntent(
    "returnDelta",
    safeReturnDeltaIntent({
      noOpReturnDeltaUsed: true,
      noOpUsedOnPathClaimingCustomAccounting: false
    }),
    ["RETURN_DELTA_NOOP_ON_CLAIMED_CUSTOM_ACCOUNTING"]
  );
  assertReviewableIntent(
    "exitLiveness",
    irreversibleExitIntent(),
    [
      "EXIT_OWED_ENTITLEMENT_PATH_ABSENT",
      "EXIT_IRREVERSIBLE_DISPOSITION_UNAUTHORIZED",
      "EXIT_IRREVERSIBLE_DISPOSITION_UNDISCLOSED"
    ]
  );
  assertReviewableIntent(
    "exitLiveness",
    managedExitIntent(),
    [
      "EXIT_MANAGED_REDEMPTION_UNDISCLOSED",
      "EXIT_MANAGED_REDEMPTION_AUTHORIZATION_UNBOUND",
      "EXIT_ADMIN_BLOCKABLE",
      "EXIT_AUTONOMOUS_PROMISE_FALSE"
    ]
  );
  assertReviewableIntent(
    "exitLiveness",
    safeExitIntent(),
    ["EXIT_AUTONOMOUS_PROMISE_FALSE", "EXIT_ADMIN_BLOCKABLE"]
  );

  const floorPreservingRebalancing = structuredClone(inline);
  floorPreservingRebalancing.securityAssessment.layers.intent = {
    evidenceRefs: [verificationReportPath],
    privilegedValue: {
      evidenceRefs: [verificationReportPath],
      used: true,
      hidden: false,
      canMoveUserBacking: true,
      canMovePlatformLiability: true,
      canRedirectOtherBeneficiaryPayouts: true,
      movementAuthorizationBound: true,
      backingAndLiabilityBoundsEnforced: true,
      payoutBeneficiaryBindingEnforced: true,
      canReduceUserBackingBelowEnforceableLiabilities: false,
      canReduceReservedPlatformLiabilitiesBelowFloor: false,
      canRedirectPayoutOutsidePriorConsentOrImmutableRule: false
    }
  };
  refreshDerivedSecurityBinding(floorPreservingRebalancing);
  const floorPreservingResult = generatePublicPrApplicationV3(floorPreservingRebalancing);
  assert.equal(floorPreservingResult.materializationAllowed, true, JSON.stringify(floorPreservingResult.report.findings));
  assert.equal(floorPreservingResult.report.findings.some(({ code }) => code === "APPLICATION_SECURITY_CONFIRMED_REDESIGN_REQUIRED"), false);

  const backingFloorBypass = structuredClone(floorPreservingRebalancing);
  backingFloorBypass.securityAssessment.layers.intent.privilegedValue.canReduceUserBackingBelowEnforceableLiabilities = true;
  refreshDerivedSecurityBinding(backingFloorBypass);
  const backingFloorBypassResult = generatePublicPrApplicationV3(backingFloorBypass);
  assert.equal(backingFloorBypassResult.materializationAllowed, false);
  assert.ok(backingFloorBypassResult.report.findings.some(({ code, securityCode }) => (
    code === "APPLICATION_SECURITY_CONFIRMED_REDESIGN_REQUIRED"
    && securityCode === "PRIVILEGED_USER_BACKING_FLOOR_BYPASS"
  )));

  const disclosedDefaultableBond = structuredClone(inline);
  disclosedDefaultableBond.securityAssessment.layers.intent = {
    evidenceRefs: [verificationReportPath],
    solvency: {
      evidenceRefs: [verificationReportPath],
      used: true,
      liabilitiesBoundedByImmediatelyRealizableAssets: false,
      futureRevenueCountedAsBacking: true,
      claimIsImmediatelyRedeemableOrGuaranteed: false,
      contingencyMaturityAndDefaultDisclosed: true,
      lossAllocationEnforced: true,
      canCreateUnboundedOrDeceptiveGuaranteedClaim: false,
      adminCanWithdrawBacking: true
    }
  };
  refreshDerivedSecurityBinding(disclosedDefaultableBond);
  const disclosedDefaultableBondResult = generatePublicPrApplicationV3(disclosedDefaultableBond);
  assert.equal(disclosedDefaultableBondResult.materializationAllowed, true, JSON.stringify(disclosedDefaultableBondResult.report.findings));
  assert.equal(disclosedDefaultableBondResult.report.findings.some(({ code }) => code === "APPLICATION_SECURITY_CONFIRMED_REDESIGN_REQUIRED"), false);

  const deceptiveGuarantee = structuredClone(disclosedDefaultableBond);
  deceptiveGuarantee.securityAssessment.layers.intent.solvency.canCreateUnboundedOrDeceptiveGuaranteedClaim = true;
  refreshDerivedSecurityBinding(deceptiveGuarantee);
  const deceptiveGuaranteeResult = generatePublicPrApplicationV3(deceptiveGuarantee);
  assert.equal(deceptiveGuaranteeResult.materializationAllowed, false);
  assert.ok(deceptiveGuaranteeResult.report.findings.some(({ code, securityCode }) => (
    code === "APPLICATION_SECURITY_CONFIRMED_REDESIGN_REQUIRED"
    && securityCode === "SOLVENCY_UNBOUNDED_OR_DECEPTIVE_GUARANTEED_CLAIM"
  )));

  const mismatchedInlineReport = structuredClone(inline);
  mismatchedInlineReport.sourceCoverage[0].verificationReport.sourceBinding.treeObjectId = "a".repeat(40);
  const mismatchedInlineResult = generatePublicPrApplicationV3(mismatchedInlineReport);
  assert.equal(mismatchedInlineResult.materializationAllowed, false);
  assert.ok(mismatchedInlineResult.report.findings.some(({ code }) => code === "APPLICATION_SOURCE_COVERAGE_REPORT_SOURCE_BINDING_MISMATCH"));

  const automatedDrain = structuredClone(inline);
  automatedDrain.securityAssessment.layers.source.privilegedValue = {
    evidenceRefs: [verificationReportPath],
    used: true,
    hidden: true,
    canMoveUserBacking: true
  };
  refreshDerivedSecurityBinding(automatedDrain);
  const automatedDrainResult = generatePublicPrApplicationV3(automatedDrain);
  assert.equal(automatedDrainResult.materializationAllowed, true, JSON.stringify(automatedDrainResult.report.findings));
  assert.equal(automatedDrainResult.report.status, "HELD_FOR_INDEPENDENT_SECURITY_REVIEW");
  assert.ok(automatedDrainResult.report.findings.some(({ code, severity }) => (
    code === "APPLICATION_SECURITY_INDEPENDENT_REVIEW_REQUIRED" && severity === "review"
  )));

  const disputedScannerDrain = structuredClone(inline);
  disputedScannerDrain.securityAssessment.automatedFindings = [{
    id: "disputed-scanner-drain",
    rule: { id: "value-drain-analysis", scope: "solidity" },
    source: {
      tool: "independent-static-analyzer",
      toolVersion: "2.1.0",
      reportRef: verificationReportPath,
      reportSha256: disputedScannerDrain.sourceCoverage[0].verificationReportSha256
    },
    confidence: "high",
    status: "disputed",
    language: "solidity",
    repositoryPath: "src/LegacyHook.sol",
    category: "drain",
    message: "A scanner observation remains disputed pending independent reproduction.",
    evidenceRefs: [verificationReportPath]
  }];
  refreshDerivedSecurityBinding(disputedScannerDrain);
  const disputedScannerResult = generatePublicPrApplicationV3(disputedScannerDrain);
  assert.equal(disputedScannerResult.materializationAllowed, true, JSON.stringify(disputedScannerResult.report.findings));
  assert.equal(disputedScannerResult.report.status, "HELD_FOR_INDEPENDENT_SECURITY_REVIEW");
  assert.equal(disputedScannerResult.report.securityDisposition, "HELD_FOR_INDEPENDENT_SECURITY_REVIEW");

  const mismatchedConfirmedScanner = structuredClone(disputedScannerDrain);
  Object.assign(mismatchedConfirmedScanner.securityAssessment.automatedFindings[0], {
    id: "mismatched-confirmed-scanner",
    status: "builder-confirmed",
    language: "rust",
    repositoryPath: "programs/hook/src/lib.rs"
  });
  refreshDerivedSecurityBinding(mismatchedConfirmedScanner);
  const mismatchedConfirmedResult = generatePublicPrApplicationV3(mismatchedConfirmedScanner);
  assert.equal(mismatchedConfirmedResult.materializationAllowed, true, JSON.stringify(mismatchedConfirmedResult.report.findings));
  assert.equal(mismatchedConfirmedResult.report.status, "HELD_FOR_INDEPENDENT_SECURITY_REVIEW");
  assert.equal(mismatchedConfirmedResult.report.securityDisposition, "HELD_FOR_INDEPENDENT_SECURITY_REVIEW");

  const confirmedScannerDrain = structuredClone(disputedScannerDrain);
  confirmedScannerDrain.securityAssessment.automatedFindings[0].id = "confirmed-scanner-drain";
  confirmedScannerDrain.securityAssessment.automatedFindings[0].status = "reviewer-confirmed";
  refreshDerivedSecurityBinding(confirmedScannerDrain);
  const confirmedScannerResult = generatePublicPrApplicationV3(confirmedScannerDrain);
  assert.equal(confirmedScannerResult.materializationAllowed, false);
  assert.equal(confirmedScannerResult.report.securityDisposition, "REDESIGN_REQUIRED");
  assert.ok(confirmedScannerResult.report.findings.some(({ code, securityCode }) => (
    code === "APPLICATION_SECURITY_CONFIRMED_REDESIGN_REQUIRED"
    && securityCode === "AUTOMATED_CONFIRMED_DRAIN_OR_DECEPTION"
  )));

  const confirmedDrain = structuredClone(automatedDrain);
  confirmedDrain.securityAssessment.layers.intent = {
    evidenceRefs: [verificationReportPath],
    privilegedValue: {
      evidenceRefs: [verificationReportPath],
      used: true,
      hidden: true,
      canMoveUserBacking: true
    }
  };
  refreshDerivedSecurityBinding(confirmedDrain);
  const confirmedDrainResult = generatePublicPrApplicationV3(confirmedDrain);
  assert.equal(confirmedDrainResult.materializationAllowed, false);
  assert.equal(confirmedDrainResult.report.securityDisposition, "REDESIGN_REQUIRED");
  assert.equal(confirmedDrainResult.report.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.ok(confirmedDrainResult.report.findings.some(({ code }) => code === "APPLICATION_SECURITY_CONFIRMED_REDESIGN_REQUIRED"));

  const proposal = structuredClone(input);
  proposal.application.stage = "proposal";
  proposal.application.policyBindings.feePolicyInstancePath = null;
  proposal.application.policyBindings.feePolicyInstanceRepositoryRef = null;
  proposal.application.policyBindings.feePolicyInstanceSha256 = null;
  proposal.application.policyBindings.feeApplicability = "unresolved";
  proposal.application.reviewPackage.records = proposal.application.reviewPackage.records.filter(({ kind }) => kind !== "fee-policy");
  proposal.securityAssessment.subject.stage = "proposal";
  const held = generatePublicPrApplicationV3(proposal);
  assert.equal(held.materializationAllowed, false);
  assert.ok(held.report.findings.some(({ code }) => code === "APPLICATION_GENERATOR_PROTOTYPE_REQUIRED"));

  const unverified = structuredClone(input);
  unverified.sourceCoverage[0].verificationReport.sourceClosureVerified = false;
  const rejected = generatePublicPrApplicationV3(unverified);
  assert.equal(rejected.materializationAllowed, false);
  assert.ok(rejected.report.findings.some(({ code }) => code === "APPLICATION_SOURCE_COVERAGE_NOT_VERIFIED"));

  const selfReferential = structuredClone(input);
  selfReferential.application.securityBindings.securityAssessmentRepositoryRef = "primary";
  const fixedPointRejected = generatePublicPrApplicationV3(selfReferential);
  assert.equal(fixedPointRejected.materializationAllowed, false);
  assert.ok(fixedPointRejected.report.findings.some(({ code }) => (
    code === "APPLICATION_SECURITY_ASSESSMENT_SELF_REFERENCE_FORBIDDEN"
    || code === "APPLICATION_DERIVED_SECURITY_BINDING_MISMATCH"
  )));

  const privateEvidence = "api_key=sk-never-echo-security-evidence-1234567890";
  const privacyHeld = structuredClone(input);
  privacyHeld.securityAssessment.layers.source.evidenceRefs.push(privateEvidence);
  const privateReport = generatePublicPrApplicationV3(privacyHeld);
  assert.equal(privateReport.materializationAllowed, false);
  assert.ok(privateReport.report.findings.some(({ code }) => code === "APPLICATION_PUBLIC_TEXT_SENSITIVE_CANDIDATE"));
  assert.doesNotMatch(JSON.stringify(privateReport.report), new RegExp(privateEvidence, "u"));
});

test("source-closure manifest supports arbitrary-size projects with exact per-repository binding", () => {
  const example = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "assets", "templates", "open-world-v2", "public-pr-application-v3.example.json"),
    "utf8"
  ));
  const manifest = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "assets", "templates", "open-world-v2", "source-closure-manifest-v1.example.json"),
    "utf8"
  ));
  assert.equal(validateSourceClosureManifestV1(manifest).valid, true);

  const manifestBytes = Buffer.from(`${canonicalJson(manifest)}\n`, "utf8");
  const manifestApplication = structuredClone(example);
  const primary = manifestApplication.source.primary;
  primary.sourceClosureMode = "manifest";
  primary.sourcePaths = [];
  primary.sourceManifest = {
    schemaId: "urn:programmable:source-closure-manifest:1.0.0",
    schemaVersion: "1.0.0",
    path: "review/source-closure/source-closure-manifest.v1.json",
    sha256: sha256Bytes(manifestBytes),
    byteLength: manifestBytes.length,
    blobObjectId: crypto.createHash("sha1")
      .update(Buffer.from(`blob ${manifestBytes.length}\0`, "utf8"))
      .update(manifestBytes)
      .digest("hex"),
    entryCount: manifest.entryCount,
    fragmentCount: manifest.fragmentCount
  };
  primary.numericRepositoryId = manifest.repository.numericRepositoryId;
  primary.repositoryUri = manifest.repository.repositoryUri;

  const applicationReport = validatePublicPrApplicationV3(manifestApplication);
  assert.equal(applicationReport.valid, true, JSON.stringify(applicationReport.findings));
  assert.ok(applicationReport.findings.some(({ code, severity, classification }) => (
    code === "APPLICATION_SOURCE_MANIFEST_EXTERNAL_VERIFICATION_REQUIRED"
    && severity === "review"
    && classification === "tooling-split-review"
  )));
  assert.equal(applicationReport.ideaEligibility, "ELIGIBLE_FOR_REVIEW");

  const largeManifestContractSurface = structuredClone(manifestApplication);
  largeManifestContractSurface.source.primary.contractPaths = Array.from(
    { length: 4097 },
    (_entry, index) => `contracts/surface-${String(index).padStart(4, "0")}.sol`
  );
  const largeManifestReport = validatePublicPrApplicationV3(largeManifestContractSurface);
  assert.equal(largeManifestReport.valid, true, JSON.stringify(largeManifestReport.findings));
  assert.equal(largeManifestReport.ideaEligibility, "ELIGIBLE_FOR_REVIEW");

  const inlineOverflow = structuredClone(example);
  while (inlineOverflow.source.primary.sourcePaths.length < 4097) {
    inlineOverflow.source.primary.sourcePaths.push(`src/open-surface-${inlineOverflow.source.primary.sourcePaths.length}.ts`);
  }
  const inlineOverflowReport = validatePublicPrApplicationV3(inlineOverflow);
  assert.equal(inlineOverflowReport.valid, false);
  assert.ok(inlineOverflowReport.findings.some(({ code, classification }) => (
    code === "SCHEMA_MAX_ITEMS" && classification === "tooling-transport"
  )));
  assert.equal(inlineOverflowReport.ideaEligibility, "ELIGIBLE_FOR_REVIEW");

  const bindingReport = verifyBoundSourceClosureManifestV1({
    repository: primary,
    manifest,
    bytes: manifestBytes,
    observedBlobObjectId: primary.sourceManifest.blobObjectId
  });
  assert.equal(bindingReport.valid, true, JSON.stringify(bindingReport.findings));

  const countMismatch = structuredClone(manifest);
  countMismatch.fragmentCount += 1;
  assert.ok(validateSourceClosureManifestV1(countMismatch).findings.some(({ code }) => code === "SOURCE_MANIFEST_FRAGMENT_COUNT_MISMATCH"));

  const sequenceGap = structuredClone(manifest);
  sequenceGap.fragments[1].sequence = 7;
  assert.ok(validateSourceClosureManifestV1(sequenceGap).findings.some(({ code }) => code === "SOURCE_MANIFEST_FRAGMENT_SEQUENCE_INVALID"));

  const tamperedBinding = verifyBoundSourceClosureManifestV1({
    repository: primary,
    manifest,
    bytes: Buffer.concat([manifestBytes, Buffer.from(" ")]),
    observedBlobObjectId: primary.sourceManifest.blobObjectId
  });
  assert.equal(tamperedBinding.valid, false);
  assert.ok(tamperedBinding.findings.some(({ code }) => code === "SOURCE_MANIFEST_BYTE_BINDING_MISMATCH"));

  const crossRepositoryLeak = structuredClone(example);
  crossRepositoryLeak.source.primary.sourcePaths = crossRepositoryLeak.source.primary.sourcePaths.filter(
    (sourcePath) => sourcePath !== crossRepositoryLeak.policyBindings.feePolicySchemaPath
  );
  crossRepositoryLeak.source.companions.push({
    ...structuredClone(primary),
    id: "companion",
    numericRepositoryId: "987654322",
    repositoryUri: "https://github.com/example-builder/large-open-world-companion"
  });
  const leakReport = validatePublicPrApplicationV3(crossRepositoryLeak);
  assert.equal(leakReport.valid, false);
  assert.ok(leakReport.findings.some(({ code, path: findingPath }) => (
    code === "APPLICATION_ARTIFACT_PATH_OUTSIDE_SOURCE_CLOSURE"
    && findingPath === "$.policyBindings.feePolicySchemaPath"
  )));
  assert.equal(leakReport.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
});

function inlineMaterializationInput(input) {
  const candidate = structuredClone(input);
  const application = candidate.application;
  const repository = application.source.primary;
  application.reviewPackage.records = application.reviewPackage.records.filter(({ kind }) => kind !== "source-closure-manifest");
  const sourcePaths = [...new Set([
    ...application.reviewPackage.records
      .filter((record) => record.source === "source-repository" && record.repositoryRef === repository.id)
      .map((record) => record.path),
    ...(repository.contractPaths ?? []),
    application.policyBindings.submissionPath,
    application.policyBindings.feePolicySchemaPath,
    application.policyBindings.feePolicyInstancePath,
    application.intentCapture.ideaSourcePath
  ].filter((value) => typeof value === "string"))].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const sourcePathsSha256 = sha256Bytes(Buffer.from(`${canonicalJson(sourcePaths)}\n`, "utf8"));
  const closureSha256 = sha256Bytes(Buffer.from(`inline-test-closure-v1\n${canonicalJson(sourcePaths)}\n`, "utf8"));
  const verificationReportPath = candidate.sourceCoverage[0].verificationReportPath;

  Object.assign(repository, {
    sourceClosureMode: "inline",
    sourcePaths: [...sourcePaths],
    sourceManifest: null
  });
  const verificationReport = {
    status: "VERIFIED",
    sourceClosureVerified: true,
    readOnly: true,
    networkAccessed: false,
    candidateCodeExecuted: false,
    dependencyPointerCoverage: dependencyPointerCoverage("NONE"),
    sourceBinding: {
      repositoryRef: repository.id,
      revisionObjectId: repository.revisionObjectId,
      treeObjectId: repository.treeObjectId,
      sourceClosureMode: "inline",
      sourcePaths: [...sourcePaths],
      sourcePathsSha256,
      closureSha256
    }
  };
  const verificationReportBytes = Buffer.from(`${canonicalJson(verificationReport)}\n`, "utf8");
  const verificationReportSha256 = sha256Bytes(verificationReportBytes);
  const persisted = {
    repositoryRef: repository.id,
    revisionObjectId: repository.revisionObjectId,
    treeObjectId: repository.treeObjectId,
    sourceClosureMode: "inline",
    sourcePaths: [...sourcePaths],
    sourcePathsSha256,
    manifestPath: null,
    manifestSha256: null,
    manifestByteLength: null,
    closureSha256,
    reportPath: verificationReportPath,
    reportSha256: verificationReportSha256,
    reportByteLength: verificationReportBytes.length,
    result: "VERIFIED"
  };
  candidate.sourceCoverage = [{
    repositoryRef: persisted.repositoryRef,
    revisionObjectId: persisted.revisionObjectId,
    treeObjectId: persisted.treeObjectId,
    sourceClosureMode: persisted.sourceClosureMode,
    sourcePaths: [...persisted.sourcePaths],
    sourcePathsSha256: persisted.sourcePathsSha256,
    manifestPath: persisted.manifestPath,
    manifestSha256: persisted.manifestSha256,
    manifestByteLength: persisted.manifestByteLength,
    closureSha256: persisted.closureSha256,
    verificationReportPath,
    verificationReportSha256,
    verificationReportByteLength: verificationReportBytes.length,
    verificationReport
  }];
  application.source.verificationReports = [structuredClone(persisted)];
  candidate.securityAssessment.assessment.evidenceRefs = [verificationReportPath];
  candidate.securityAssessment.assessment.sourceCoverage = {
    primaryRepositoryRef: repository.id,
    repositories: [structuredClone(persisted)]
  };
  candidate.securityAssessment.layers.source.evidenceRefs = [verificationReportPath];
  candidate.securityEvidenceBindings = [{
    evidenceRef: verificationReportPath,
    kind: "source-closure-verification",
    path: verificationReportPath,
    repositoryRef: null,
    sha256: verificationReportSha256,
    source: "application-package"
  }];
  const reportRecord = application.reviewPackage.records.find(({ kind }) => kind === "source-closure-verification");
  Object.assign(reportRecord, {
    path: verificationReportPath,
    byteLength: verificationReportBytes.length,
    sha256: verificationReportSha256,
    source: "application-package",
    repositoryRef: null
  });
  refreshDerivedSecurityBinding(candidate);
  return candidate;
}

function refreshDerivedSecurityBinding(input) {
  const bytes = Buffer.from(`${canonicalJson(input.securityAssessment)}\n`, "utf8");
  const sha256 = sha256Bytes(bytes);
  Object.assign(input.application.securityBindings, {
    securityAssessmentPath: "security-assessment.v1.json",
    securityAssessmentRepositoryRef: null,
    securityAssessmentSha256: sha256,
    securityAssessmentByteLength: bytes.length
  });
  const record = input.application.reviewPackage.records.find(({ kind }) => kind === "security-assessment");
  Object.assign(record, {
    path: "security-assessment.v1.json",
    byteLength: bytes.length,
    sha256,
    source: "application-package",
    repositoryRef: null
  });
}

function rebindDependencyPointerCoverage(input, dependencyPointerCoverageValue) {
  const coverage = input.sourceCoverage[0];
  coverage.verificationReport.dependencyPointerCoverage = dependencyPointerCoverageValue;
  const reportBytes = Buffer.from(`${canonicalJson(coverage.verificationReport)}\n`, "utf8");
  coverage.verificationReportSha256 = sha256Bytes(reportBytes);
  coverage.verificationReportByteLength = reportBytes.length;
  const persisted = input.application.source.verificationReports[0];
  persisted.reportSha256 = coverage.verificationReportSha256;
  persisted.reportByteLength = coverage.verificationReportByteLength;
  const record = input.application.reviewPackage.records.find(({ kind }) => kind === "source-closure-verification");
  record.sha256 = coverage.verificationReportSha256;
  record.byteLength = coverage.verificationReportByteLength;
  const evidence = input.securityEvidenceBindings.find(({ kind }) => kind === "source-closure-verification");
  evidence.sha256 = coverage.verificationReportSha256;
  const securityCoverage = input.securityAssessment.assessment.sourceCoverage?.repositories?.[0];
  if (securityCoverage) {
    securityCoverage.reportSha256 = coverage.verificationReportSha256;
    securityCoverage.reportByteLength = coverage.verificationReportByteLength;
  }
}

function dependencyPointerCoverage(state) {
  const pointerCount = state === "NONE" ? 0 : 1;
  const digit = state === "NONE" ? "0" : state === "VERIFIED" ? "1" : "2";
  return {
    schemaVersion: "1.0.0",
    pointerCount,
    pointerRecordsSha256: `sha256:${digit.repeat(64)}`,
    sourceCriticalDereferenceState: state,
    counts: {
      symlink: pointerCount,
      gitlink: 0,
      gitLfs: 0,
      internalVerified: 0,
      targetVerified: state === "VERIFIED" ? 1 : 0,
      unresolved: state === "UNRESOLVED" ? 1 : 0,
      sourceCritical: pointerCount,
      runtimeAssetDelegated: 0,
      unclassified: 0
    }
  };
}

function legacySubmissionFixture() {
  return {
    $schema: "https://programmable.money/schemas/submission-1.6.0.json",
    schemaVersion: 1,
    standardVersion: "1.6.0",
    stage: "proposal",
    model: {
      id: "legacy-open-world",
      name: "Legacy Open World",
      summary: "Legacy agent prose that has not been confirmed as the owner's original product intent."
    },
    builder: {
      licenseDeclaration: "MIT"
    },
    programmableFee: {
      policyId: "programmable-volume-fee-v1",
      policyVersion: "1.1.0"
    },
    implementation: {
      sourcePaths: ["src/LegacyHook.sol"],
      testPaths: ["test/LegacyHook.t.sol"]
    }
  };
}

function createApplicationFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-application-recheck-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "source");
  const packageRoot = path.join(root, "package");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(packageRoot, { recursive: true });
  runGit(sourceRoot, ["init", "-q"]);
  runGit(sourceRoot, ["config", "user.name", "Programmable Test"]);
  runGit(sourceRoot, ["config", "user.email", "test@programmable.invalid"]);

  const applicationId = "legacy-recheck";
  const submissionRelativePath = `submissions/${applicationId}/submission.json`;
  const submissionPath = path.join(sourceRoot, ...submissionRelativePath.split("/"));
  fs.mkdirSync(path.dirname(submissionPath), { recursive: true });
  const submission = {
    $schema: "https://programmable.money/schemas/submission-1.6.0.json",
    schemaVersion: 1,
    standardVersion: "1.6.0",
    stage: "proposal",
    model: {
      id: applicationId,
      name: "Legacy Recheck",
      summary: "A bound legacy submission used to prove that rechecking does not rewrite historical evidence."
    }
  };
  const submissionBytes = Buffer.from(`${JSON.stringify(submission, null, 2)}\n`, "utf8");
  fs.writeFileSync(submissionPath, submissionBytes);
  runGit(sourceRoot, ["add", "--", submissionRelativePath]);
  runGit(sourceRoot, ["commit", "-q", "-m", "fixture"]);
  const commit = runGit(sourceRoot, ["rev-parse", "HEAD"]).trim();
  const tree = runGit(sourceRoot, ["rev-parse", "HEAD^{tree}"]).trim();
  const submissionSha256 = sha256Bytes(submissionBytes);
  const source = {
    numericRepositoryId: "123456789",
    revisionObjectId: commit,
    treeObjectId: tree
  };
  const reviewBytes = new Map([
    ["PROPOSAL.md", Buffer.from("# Proposal\n\nLegacy proposal.\n", "utf8")],
    ["TEST_PLAN.md", Buffer.from("# Test plan\n\nLegacy tests.\n", "utf8")],
    ["THREAT_MODEL.md", Buffer.from("# Threat model\n\nLegacy threats.\n", "utf8")],
    ["compatibility-report.json", canonicalBytes({
      applicationId,
      disclaimer: "Historical declaration only.",
      findings: [],
      result: "architecture-review-required",
      schemaVersion: 1,
      source
    })],
    ["evidence-index.json", canonicalBytes({
      applicationId,
      entries: [],
      schemaVersion: 1,
      source
    })]
  ]);
  const reviewPackage = [...reviewBytes].map(([filePath, bytes]) => ({
    path: filePath,
    byteLength: bytes.length,
    sha256: sha256Bytes(bytes)
  }));
  const application = {
    applicationId,
    applicationRevision: 1,
    builder: {
      contact: null,
      githubLogin: "example-builder",
      githubUserId: "123456789"
    },
    declarations: {
      noApprovalClaim: true,
      noSecretsDeclared: true,
      noUniswapEndorsementClaim: true,
      publicInformationAcknowledged: true
    },
    programmableFee: {
      policyId: "programmable-volume-fee-v1",
      submissionBinding: {
        path: submissionRelativePath,
        sha256: submissionSha256
      }
    },
    reviewPackage,
    schemaVersion: 2,
    source: {
      companions: [],
      primary: {
        contractPaths: [],
        githubActionsRunIds: [],
        numericRepositoryId: source.numericRepositoryId,
        repositoryUri: "https://github.com/example/legacy-recheck",
        revisionObjectId: commit,
        sourcePaths: [submissionRelativePath],
        treeObjectId: tree
      },
      schemaVersion: "1.0.0"
    },
    stage: "proposal",
    summary: "A historical application whose exact source, package and declared result remain immutable during recheck.",
    title: "Legacy Recheck"
  };
  fs.writeFileSync(path.join(packageRoot, "application.json"), canonicalBytes(application));
  for (const [filePath, bytes] of reviewBytes) fs.writeFileSync(path.join(packageRoot, filePath), bytes);
  return {
    root,
    sourceRoot,
    packageRoot,
    submissionPath,
    submissionSha256,
    commit,
    tree
  };
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function parseFile(files, filePath) {
  return JSON.parse(files.get(filePath).content);
}

function snapshotDirectory(directory) {
  return Object.fromEntries(fs.readdirSync(directory).sort().map((name) => [
    name,
    fs.readFileSync(path.join(directory, name)).toString("base64")
  ]));
}

function runGit(repositoryRoot, argumentsList) {
  return childProcess.execFileSync("git", ["-C", repositoryRoot, ...argumentsList], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function assertRecheckCode(action, code) {
  assert.throws(action, (error) => error instanceof ApplicationRecheckError && error.code === code);
}
