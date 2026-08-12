import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import {
  derivePublicPrApplicationV3PreviousBinding,
  scanPublicPrApplicationV3ArtifactBytes,
  validatePublicPrApplicationV3,
  verifyLocalSourceClosureManifestV1
} from "../public-pr-application-v3-core.mjs";
import { createGhTransport } from "../github-application-core.mjs";
import {
  generateSourceClosureManifestV1,
  materializeSourceClosureManifestV1
} from "../source-manifest.mjs";
import { buildExampleBaseline } from "../example-materializer-core.mjs";
import { canonicalJson } from "../submission-core.mjs";
import { createApplicableOpenWorldV2PrototypeFixture } from "./open-world-v2-prototype-fixture.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../..");
const cli = path.join(testDirectory, "..", "cli.mjs");
const sourceCommit = "c".repeat(40);
const sourceTree = "d".repeat(40);
const centralCommit = "1".repeat(40);
const centralTree = "2".repeat(40);
const TRADE_APPLICATION_RECORD_KINDS = new Set(["trade-capability-manifest", "trade-test-result"]);

test("validate-application checks the closed V3 package locally from a non-Git directory", (t) => {
  const fixture = createTransportFixture(t);
  const result = run(["open-world", "validate-application", fixture.packageRoot], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout).result;
  assert.equal(payload.action, "validate-application");
  assert.equal(payload.contract, "public-pr-application-v3-local-validation");
  assert.equal(payload.status, "VALID");
  assert.equal(payload.valid, true);
  assert.equal(payload.package.applicationSha256, sha256(fs.readFileSync(path.join(fixture.packageRoot, "application.v3.json"))));
  assert.equal(payload.validation.closedSchema, "VERIFIED");
  assert.equal(payload.validation.semanticBindings, "VERIFIED");
  assert.equal(payload.validation.exactPackageBytes, "VERIFIED");
  assert.equal(payload.validation.publicArtifactPrivacy, "VERIFIED");
  assert.equal(payload.validation.persistedSourceVerificationReports, "VERIFIED");
  assert.equal(payload.validation.freshLocalSourceClosure, "NOT_RUN");
  assert.equal(payload.sourceClosure.freshLocalReplayPerformed, false);
  assert.equal(payload.readOnly, true);
  assert.equal(payload.writePerformed, false);
  assert.equal(payload.networkAccessed, false);
  assert.equal(payload.candidateCodeExecuted, false);
  assert.deepEqual(allCalls(fixture), []);
});

test("validate-application optionally replays the complete exact local source closure", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const result = run([
    "open-world", "validate-application", fixture.packageRoot,
    "--source-root", `primary=${sourceRoot}`
  ], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout).result;
  assert.equal(payload.validation.freshLocalSourceClosure, "VERIFIED");
  assert.equal(payload.sourceClosure.freshLocalReplayPerformed, true);
  assert.match(payload.sourceClosure.replaySha256, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(payload.sourceClosure.repositories.map(({ repositoryRef, replayStatus }) => ({ repositoryRef, replayStatus })), [
    { repositoryRef: "primary", replayStatus: "VERIFIED" }
  ]);
  assert.deepEqual(allCalls(fixture), []);
});

test("V3 predecessor helper derives only byte-provable lineage fields", (t) => {
  const fixture = createTransportFixture(t);
  const application = JSON.parse(fs.readFileSync(path.join(fixture.packageRoot, "application.v3.json"), "utf8"));
  const projection = projectFixturePackage(fixture.packageRoot, application);
  const previous = derivePublicPrApplicationV3PreviousBinding({
    application,
    applicationSha256: projection.applicationSha256,
    packageSha256: projection.packageSha256
  });
  assert.equal(previous.applicationContract, "public-pr-application-v3");
  assert.equal(previous.applicationSchemaVersion, 3);
  assert.equal(previous.feeApplicability, application.policyBindings.feeApplicability);
  assert.equal(previous.feePolicyInstanceSha256, application.policyBindings.feePolicyInstanceSha256);
  assert.equal(Object.hasOwn(previous, "centralHeadCommit"), false);
  assert.equal(Object.hasOwn(previous, "feePolicyProjectionSha256"), false);
  assert.deepEqual(
    derivePublicPrApplicationV3PreviousBinding({
      application,
      applicationSha256: projection.applicationSha256,
      packageSha256: projection.packageSha256
    }),
    previous
  );
});

test("test-only fake GitHub preload is byte-equivalent across a GET plan and confirmed mutation", (t) => {
  const fixture = createTransportFixture(t);
  const command = ["open-world", "submit", fixture.packageRoot];
  const receiptPath = path.join(fixture.root, "application-v3-mutation-receipt.json");
  const receiptLockPath = `${receiptPath}.lock`;
  const baselineState = fs.readFileSync(fixture.statePath);
  const readOptional = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  const reset = () => {
    fs.writeFileSync(fixture.statePath, baselineState);
    for (const filePath of [fixture.callLog, receiptPath, receiptLockPath]) {
      fs.rmSync(filePath, { force: true });
    }
  };
  const capture = (result) => ({
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    callLog: readOptional(fixture.callLog),
    state: fs.readFileSync(fixture.statePath),
    receipt: readOptional(receiptPath)
  });

  reset();
  const executablePlanResult = run(command, fixture, { usePreload: false });
  const executablePlan = capture(executablePlanResult);
  reset();
  const preloadPlanResult = run(command, fixture);
  const preloadPlan = capture(preloadPlanResult);
  assert.equal(preloadPlanResult.status, 0, preloadPlanResult.stdout || preloadPlanResult.stderr);
  assert.deepEqual(preloadPlan, executablePlan);
  const confirmationDigest = JSON.parse(preloadPlanResult.stdout).result.confirmationDigest;

  reset();
  const executableMutationResult = run(
    [...command, "--confirm-external-write", confirmationDigest],
    fixture,
    { allowWrites: true, usePreload: false }
  );
  const executableMutation = capture(executableMutationResult);
  reset();
  const preloadMutationResult = run(
    [...command, "--confirm-external-write", confirmationDigest],
    fixture,
    { allowWrites: true }
  );
  const preloadMutation = capture(preloadMutationResult);
  assert.equal(preloadMutationResult.status, 0, preloadMutationResult.stdout || preloadMutationResult.stderr);
  assert.deepEqual(preloadMutation, executableMutation);
  const calls = allCalls(fixture);
  assert.ok(calls.some(({ method }) => method === "GET"));
  assert.ok(calls.some(({ method, body }) => method !== "GET" && body !== null));
  assert.equal(fs.existsSync(receiptLockPath), false);
});

test("transport rejects a schema-valid proposal with unassessed security and no source report before any GitHub call", (t) => {
  const fixture = createTransportFixture(t, { unmaterializedProposal: true });
  const result = run(["open-world", "submit", fixture.packageRoot], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  const error = JSON.parse(result.stdout).error;
  assert.equal(error.code, "APPLICATION_V3_MATERIALIZATION_INVALID");
  assert.match(error.message, /source-verification reports/u);
  assert.deepEqual(allCalls(fixture), []);
});

test("transport rejects a prototype whose source-verification report is missing before any GitHub call", (t) => {
  const fixture = createTransportFixture(t);
  const application = readFixtureApplication(fixture);
  const [binding] = application.source.verificationReports;
  fs.unlinkSync(path.join(fixture.packageRoot, binding.reportPath));
  application.source.verificationReports = [];
  application.reviewPackage.records = application.reviewPackage.records.filter(({ kind }) => kind !== "source-closure-verification");
  const security = readFixtureArtifact(fixture, application.securityBindings.securityAssessmentPath);
  security.assessment = {
    state: "unassessed",
    reasonCode: "SOURCE_NOT_ASSESSED",
    evidenceRefs: [],
    sourceCoverage: null
  };
  security.layers.source.evidenceRefs = [];
  rewriteFixtureApplicationArtifact(fixture, application, "security-assessment", security);
  writeFixtureApplication(fixture, application);

  const result = run(["open-world", "submit", fixture.packageRoot], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, "APPLICATION_V3_MATERIALIZATION_INVALID");
  assert.deepEqual(allCalls(fixture), []);
});

test("transport rejects unassessed security in an otherwise bound prototype before any GitHub call", (t) => {
  const fixture = createTransportFixture(t);
  const application = readFixtureApplication(fixture);
  const security = readFixtureArtifact(fixture, application.securityBindings.securityAssessmentPath);
  security.assessment = {
    state: "unassessed",
    reasonCode: "SOURCE_NOT_ASSESSED",
    evidenceRefs: [],
    sourceCoverage: null
  };
  security.layers.source.evidenceRefs = [];
  rewriteFixtureApplicationArtifact(fixture, application, "security-assessment", security);
  writeFixtureApplication(fixture, application);

  const result = run(["open-world", "submit", fixture.packageRoot], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  const error = JSON.parse(result.stdout).error;
  assert.equal(error.code, "APPLICATION_V3_MATERIALIZATION_INVALID");
  assert.ok(error.details.findingCodes.includes("APPLICATION_SECURITY_SOURCE_ASSESSMENT_REQUIRED"));
  assert.deepEqual(allCalls(fixture), []);
});

test("transport rejects a coherently rebound but non-VERIFIED source report before any GitHub call", (t) => {
  const fixture = createTransportFixture(t);
  const application = readFixtureApplication(fixture);
  const [binding] = application.source.verificationReports;
  const report = readFixtureArtifact(fixture, binding.reportPath);
  report.status = "HOLD_SPLIT_REVIEW";
  report.sourceClosureVerified = false;
  report.splitReviewRequired = true;
  const reportBytes = Buffer.from(`${canonicalJson(report)}\n`, "utf8");
  fs.writeFileSync(path.join(fixture.packageRoot, binding.reportPath), reportBytes);
  binding.reportSha256 = sha256(reportBytes);
  binding.reportByteLength = reportBytes.length;
  const reportRecord = application.reviewPackage.records.find(({ kind }) => kind === "source-closure-verification");
  reportRecord.sha256 = binding.reportSha256;
  reportRecord.byteLength = binding.reportByteLength;
  const security = readFixtureArtifact(fixture, application.securityBindings.securityAssessmentPath);
  const [securityCoverage] = security.assessment.sourceCoverage.repositories;
  securityCoverage.reportSha256 = binding.reportSha256;
  securityCoverage.reportByteLength = binding.reportByteLength;
  rewriteFixtureApplicationArtifact(fixture, application, "security-assessment", security);
  writeFixtureApplication(fixture, application);

  const result = run(["open-world", "submit", fixture.packageRoot], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  const error = JSON.parse(result.stdout).error;
  assert.equal(error.code, "APPLICATION_V3_MATERIALIZATION_INVALID");
  assert.ok(error.details.findingCodes.includes("APPLICATION_SOURCE_COVERAGE_NOT_VERIFIED"));
  assert.deepEqual(allCalls(fixture), []);
});

test("package privacy gate blocks common high-confidence credentials in Markdown and JSON without echo or GitHub calls", (t) => {
  const credentials = [
    ["sk", "_live_", "1234567890AbCdEfGhIjKlMn"].join(""),
    ["npm", "_", "1234567890abcdefghijklmnopqrstuv"].join(""),
    ["glpat", "-", "1234567890abcdefghijklmnop"].join(""),
    ["AIza", "1234567890abcdefghijklmnopqrstuvwxyz"].join(""),
    ["ASIA", "1234567890ABCDEF"].join(""),
    ["hf", "_", "1234567890abcdefghijklmnopqrstuvwx"].join(""),
    ["Bearer ", "1234567890abcdefghijklmnopqrstuvwxyz"].join(""),
    `private key: 0x${"a".repeat(64)}`,
    ["https://review-user:", "private-passphrase", "@example.invalid/path"].join("")
  ];
  for (const [index, credential] of credentials.entries()) {
    for (const media of ["markdown", "json"]) {
      const fixture = createTransportFixture(t);
      const application = readFixtureApplication(fixture);
      const kind = media === "markdown" ? "proposal" : "compatibility-report";
      const content = media === "markdown"
        ? `# Proposal\n\nCredential ${credential}\n`
        : `${canonicalJson({ credential, result: "architecture-review-required", schemaVersion: 3 })}\n`;
      rewriteFixtureRawArtifact(fixture, application, kind, content);
      writeFixtureApplication(fixture, application);
      const result = run(["open-world", "submit", fixture.packageRoot], fixture);
      assert.equal(result.status, 1, `${index}:${media}: ${result.stdout || result.stderr}`);
      const error = JSON.parse(result.stdout).error;
      assert.equal(error.code, "APPLICATION_PUBLIC_ARTIFACT_SENSITIVE");
      assert.equal(result.stdout.includes(credential), false);
      assert.deepEqual(allCalls(fixture), []);
    }
  }
});

test("package credential scanner keeps benign lookalikes safe and never lets a financial attestation mask a secret", () => {
  for (const benign of [
    "sk_live_short",
    "npm_documentation_example",
    "glpat-placeholder",
    "AIza-short",
    "ASIA1234567890ABCDE",
    "hf_placeholder",
    "Bearer ${ACCESS_TOKEN}",
    `0x${"a".repeat(64)}`,
    "-----BEGIN PUBLIC KEY-----",
    "-----BEGIN CERTIFICATE-----",
    "https://example.invalid/user:pass"
  ]) {
    const report = scanPublicPrApplicationV3ArtifactBytes({
      bytes: Buffer.from(benign, "utf8"),
      path: "PROPOSAL.md",
      mediaType: "text/markdown"
    });
    assert.equal(report.valid, true, benign);
  }
  const secret = ["sk", "_live_", "1234567890AbCdEfGhIjKlMn"].join("");
  const report = scanPublicPrApplicationV3ArtifactBytes({
    bytes: Buffer.from(`${secret} CH9300762011623852957`, "utf8"),
    path: "PROPOSAL.md",
    mediaType: "text/markdown"
  });
  assert.equal(report.valid, false);
  assert.ok(report.candidateKinds.includes("stripe-secret-key"));
  assert.ok(report.candidateKinds.includes("financial-identifier"));
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("package JSON privacy scan accepts its exact node boundary and returns a typed plus-one hold", () => {
  const scan = (length) => scanPublicPrApplicationV3ArtifactBytes({
    bytes: Buffer.from(`${canonicalJson(Array.from({ length }, () => null))}\n`, "utf8"),
    path: "evidence-index.json",
    mediaType: "application/json"
  });
  const exact = scan(249_999);
  assert.equal(exact.valid, true);
  const plusOne = scan(250_000);
  assert.equal(plusOne.valid, false);
  assert.equal(plusOne.code, "APPLICATION_PUBLIC_TEXT_SCAN_LIMIT_EXCEEDED");
});

test("package JSON privacy scan rejects duplicate-key secret shadowing before inspecting parsed values", () => {
  const secret = `sk-proj-${"A".repeat(24)}`;
  for (const bytes of [
    Buffer.from('{"note":"safe","note":"safe"}', "utf8"),
    Buffer.from(`{"note":${JSON.stringify(secret)},"note":"safe"}`, "utf8"),
    Buffer.from('{"note":"safe","n\\u006fte":"safe"}', "utf8")
  ]) {
    const report = scanPublicPrApplicationV3ArtifactBytes({
      bytes,
      path: "evidence-index.json",
      mediaType: "application/json"
    });
    assert.equal(report.valid, false);
    assert.equal(report.code, "APPLICATION_PUBLIC_ARTIFACT_JSON_INVALID");
    assert.deepEqual(report.candidateKinds, []);
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
});

test("transport canonical JSON preflight accepts depth 256 and returns a typed depth-257 hold before GitHub", (t) => {
  const nested = (depth) => {
    let value = "leaf";
    for (let index = 0; index < depth; index += 1) value = { next: value };
    return value;
  };
  const exact = createTransportFixture(t);
  const exactApplication = readFixtureApplication(exact);
  rewriteFixtureRawArtifact(
    exact,
    exactApplication,
    "compatibility-report",
    `${canonicalJson(nested(256))}\n`
  );
  writeFixtureApplication(exact, exactApplication);
  const accepted = run(["open-world", "submit", exact.packageRoot], exact);
  assert.equal(accepted.status, 0, accepted.stdout || accepted.stderr);
  assert.deepEqual(mutatingCalls(exact), []);

  const plusOne = createTransportFixture(t);
  const plusOneApplication = readFixtureApplication(plusOne);
  rewriteFixtureRawArtifact(
    plusOne,
    plusOneApplication,
    "compatibility-report",
    `${canonicalJson(nested(257))}\n`
  );
  writeFixtureApplication(plusOne, plusOneApplication);
  const held = run(["open-world", "submit", plusOne.packageRoot], plusOne);
  assert.equal(held.status, 1, held.stdout || held.stderr);
  const error = JSON.parse(held.stdout).error;
  assert.equal(error.code, "APPLICATION_INPUT_SPLIT_REVIEW_REQUIRED");
  assert.equal(error.details.status, "HOLD_SPLIT_REVIEW");
  assert.deepEqual(allCalls(plusOne), []);
});

test("remote inline transport holds canonical, legacy, extended, CRLF, and malformed Git LFS pointer-like blobs", (t) => {
  const oid = "a".repeat(64);
  const variants = [
    `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 7\n`,
    `version https://git-lfs.github.com/spec/v1\r\noid sha256:${oid}\r\nsize 7\r\n`,
    `version https://hawser.github.com/spec/v1\noid sha256:${oid}\nsize 7\n`,
    `version https://git-lfs.github.com/spec/v1\next-0-foo sha256:${oid}\noid sha256:${oid}\nsize 7\n`,
    "version https://git-lfs.github.com/spec/v1\noid missing\nsize nope\n"
  ];
  for (const pointer of variants) {
    const fixture = createTransportFixture(t);
    const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
    const [firstPath] = Object.keys(state.sourceContents).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    state.sourceContents[firstPath] = Buffer.from(pointer, "utf8").toString("base64");
    fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
    const result = run(["open-world", "submit", fixture.packageRoot], fixture);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    const error = JSON.parse(result.stdout).error;
    assert.equal(error.code, "APPLICATION_GITHUB_TRANSPORT_INTEGRATION_PENDING");
    assert.equal(result.stdout.includes(pointer), false);
    assert.deepEqual(mutatingCalls(fixture), []);
  }
});

test("manifest transport without local source roots is integration-pending before any GitHub call", (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const result = run(["open-world", "submit", fixture.packageRoot], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  const error = JSON.parse(result.stdout).error;
  assert.equal(error.code, "APPLICATION_GITHUB_TRANSPORT_INTEGRATION_PENDING");
  assert.match(error.message, /source-root.*local.*replay/iu);
  assert.deepEqual(allCalls(fixture), []);
});

test("manifest status remains an independent remote read when local source replay is unavailable", (t) => {
  const fixture = createTransportFixture(t, { mode: "status", manifestSource: true });
  const result = run(["open-world", "status", fixture.packageRoot, "--pull-request", "7"], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout).result;
  assert.equal(payload.action, "status");
  assert.equal(payload.status.transport, "submitted");
  assert.equal(payload.status.integrity, "matched");
  assert.deepEqual(payload.sourceEvidence.localReplay, { status: "NOT_RUN", requiredForRemoteStatus: false });
  assert.equal(payload.writePerformed, false);
  assert.equal(payload.networkAccessed, true);
  assert.ok(allCalls(fixture).length > 0);
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
});

test("transport binds every declared source CI run to the exact head SHA, workflow, and successful conclusion", (t) => {
  for (const [workflowRunMode, expectedCode] of [
    [null, null],
    ["wrong-head", "APPLICATION_SOURCE_CI_MISMATCH"],
    ["pending", "APPLICATION_SOURCE_CI_MISMATCH"],
    ["failed", "APPLICATION_SOURCE_CI_MISMATCH"],
    ["wrong-workflow", "APPLICATION_SOURCE_CI_INVALID"]
  ]) {
    const fixture = createTransportFixture(t, { mode: "update" });
    const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
    state.workflowRunMode = workflowRunMode;
    fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
    const result = run(["open-world", "update", fixture.packageRoot, "--pull-request", "7"], fixture);
    if (expectedCode === null) {
      assert.equal(result.status, 0, result.stdout || result.stderr);
      const runEvidence = JSON.parse(result.stdout).result.sources[0].ciRuns;
      assert.deepEqual(runEvidence, [{
        conclusion: "success",
        event: "push",
        headSha: state.sourceCommit,
        runAttempt: 1,
        runId: "987654321",
        status: "completed",
        workflowId: "123456",
        workflowPath: ".github/workflows/ci.yml"
      }]);
    } else {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.equal(JSON.parse(result.stdout).error.code, expectedCode);
    }
    assert.deepEqual(mutatingCalls(fixture), []);
  }
});

test("confirmed transport rereads both exact CI and intake state immediately before its first mutation", (t) => {
  for (const raceMode of ["intake-pause-before-write", "source-ci-fail-before-write"]) {
    const fixture = createTransportFixture(t, { mode: raceMode === "source-ci-fail-before-write" ? "update" : "submit" });
    const command = raceMode === "source-ci-fail-before-write"
      ? ["open-world", "update", fixture.packageRoot, "--pull-request", "7"]
      : ["open-world", "submit", fixture.packageRoot];
    const preview = run(command, fixture);
    assert.equal(preview.status, 0, preview.stdout || preview.stderr);
    const digest = JSON.parse(preview.stdout).result.confirmationDigest;
    const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
    if (raceMode === "source-ci-fail-before-write") {
      state.workflowRunMode = "fail-on-second-read";
      state.workflowRunReads = 0;
    } else {
      state.raceMode = raceMode;
      state.intakeReads = 0;
    }
    fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
    const result = run([...command, "--confirm-external-write", digest], fixture, { allowWrites: true });
    assert.equal(result.status, 1, `${raceMode}: ${result.stdout || result.stderr}`);
    assert.equal(
      JSON.parse(result.stdout).error.code,
      raceMode === "source-ci-fail-before-write" ? "APPLICATION_SOURCE_CI_MISMATCH" : "INTAKE_PAUSED_ALL"
    );
    assert.deepEqual(mutatingCalls(fixture), []);
    const receipt = JSON.parse(fs.readFileSync(path.join(fixture.root, "application-v3-mutation-receipt.json"), "utf8"));
    assert.equal(receipt.state, "FAILED_BEFORE_MUTATION");
    assert.deepEqual(receipt.mutations, []);
  }
});

test("manifest transport locally replays exact reports and keeps locally matched LFS availability unverified", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture, { lfsMode: "verified" });
  const result = run([
    "open-world", "submit", fixture.packageRoot,
    "--source-root", `primary=${sourceRoot}`
  ], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const plan = JSON.parse(result.stdout).result;
  assert.equal(plan.action, "submit-plan");
  assert.equal(plan.writePerformed, false);
  assert.equal(plan.localSourceReplay[0].dependencyPointerState, "VERIFIED");
  assert.equal(plan.localSourceReplay[0].gitLfsPointerCount, 1);
  assert.equal(plan.localSourceReplay[0].dependencyAvailability, "unknown-not-verified");
  assert.equal(plan.sources[0].dependencyAvailability, "unknown-not-verified");
  assert.ok(allCalls(fixture).some(({ endpoint }) => endpoint.includes("/contents/")));
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("manifest transport keeps a pruned fragment object integration-pending instead of invalid", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const application = readFixtureApplication(fixture);
  const manifestBytes = readLocalGitBlob(
    sourceRoot,
    application.source.primary.revisionObjectId,
    application.source.primary.sourceManifest.path
  );
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const fragmentObjectId = manifest.fragments[0].blobObjectId;
  const fragmentObjectPath = looseGitObjectPath(sourceRoot, fragmentObjectId);
  assert.equal(fs.existsSync(fragmentObjectPath), true, fragmentObjectPath);
  fs.unlinkSync(fragmentObjectPath);

  const held = run([
    "open-world", "submit", fixture.packageRoot,
    "--source-root", `primary=${sourceRoot}`
  ], fixture);
  assert.equal(held.status, 1, held.stdout || held.stderr);
  const error = JSON.parse(held.stdout).error;
  assert.equal(error.code, "APPLICATION_GITHUB_TRANSPORT_INTEGRATION_PENDING");
  assert.equal(error.details.status, "INTEGRATION_PENDING");
  assert.equal(error.details.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.equal(error.details.writePerformed, false);
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("manifest transport independently checks each named remote source binding after local replay", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const application = readFixtureApplication(fixture);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  const boundPath = application.policyBindings.submissionPath;
  state.sourceContents[boundPath] = Buffer.from("tampered remote source bytes\n", "utf8").toString("base64");
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);

  const result = run([
    "open-world", "submit", fixture.packageRoot,
    "--source-root", `primary=${sourceRoot}`
  ], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, "APPLICATION_SOURCE_BINDING_MISMATCH");
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("manifest transport blocks an unresolved local LFS dependency before any GitHub call", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture, { lfsMode: "unresolved" });
  const result = run([
    "open-world", "submit", fixture.packageRoot,
    "--source-root", `primary=${sourceRoot}`
  ], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, "APPLICATION_GITHUB_TRANSPORT_INTEGRATION_PENDING");
  assert.deepEqual(allCalls(fixture), []);
});

test("remote inline aggregate byte budget accepts exactly 64 MiB and holds plus one before content fetch", (t) => {
  for (const delta of [0, 1]) {
    const fixture = createTransportFixture(t);
    const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
    const paths = Object.keys(state.sourceContents).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const [firstPath, ...remainingPaths] = paths;
    const remainingBytes = remainingPaths.reduce((total, repositoryPath) => (
      total + Buffer.from(state.sourceContents[repositoryPath], "base64").length
    ), 0);
    state.sourceTreeSizeOverrides[firstPath] = 64 * 1024 * 1024 - remainingBytes + delta;
    fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);

    const result = run(["open-world", "submit", fixture.packageRoot], fixture);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    const error = JSON.parse(result.stdout).error;
    const sourceContentCalls = allCalls(fixture).filter(({ endpoint }) => (
      endpoint.startsWith("repos/example-builder/legacy-open-world-example/contents/")
    ));
    if (delta === 0) {
      assert.equal(error.code, "APPLICATION_SOURCE_BINDING_MISMATCH");
      assert.equal(sourceContentCalls.length, 1);
    } else {
      assert.equal(error.code, "APPLICATION_GITHUB_SPLIT_REVIEW_REQUIRED");
      assert.equal(sourceContentCalls.length, 0);
    }
    assert.deepEqual(mutatingCalls(fixture), []);
  }
});

test("fresh inline tooling limits stay typed split-review holds across prepare and transport", (t) => {
  const fixture = createTransportFixture(t, { mode: "update" });
  const prepared = createInlineSplitReplayFixture(fixture);
  const commands = [
    [
      "open-world", "prepare-revision", prepared.draftPath,
      "--source-root", `primary=${prepared.sourceRoot}`,
      "--output", path.join(prepared.outputParent, "split-review"),
      "--repository-root", prepared.repositoryRoot,
      "--dry-run"
    ],
    ["open-world", "submit", fixture.packageRoot, "--source-root", `primary=${prepared.sourceRoot}`],
    ["open-world", "update", fixture.packageRoot, "--pull-request", "7", "--source-root", `primary=${prepared.sourceRoot}`],
    ["open-world", "status", fixture.packageRoot, "--pull-request", "7", "--source-root", `primary=${prepared.sourceRoot}`]
  ];
  for (const command of commands) {
    fs.writeFileSync(fixture.callLog, "");
    const result = run(command, fixture);
    assert.equal(result.status, 1, `${command[1]}: ${result.stdout || result.stderr}`);
    const error = JSON.parse(result.stdout).error;
    assert.equal(error.code, "APPLICATION_GITHUB_SPLIT_REVIEW_REQUIRED", command[1]);
    assert.equal(error.details.status, "HOLD_SPLIT_REVIEW");
    assert.equal(error.details.route, "INTEGRATION_PENDING");
    assert.equal(error.details.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
    assert.equal(error.details.classification, "tooling-split-review");
    assert.equal(error.details.writePerformed, false);
    assert.deepEqual(allCalls(fixture), []);
  }
});

test("open-world prepare-revision derives a new root through only GET requests and writes it atomically after a full second snapshot", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const prepared = createPrepareRevisionDraftFiles(fixture, sourceRoot);
  const dryOutput = path.join(prepared.outputParent, "dry-run-root");
  const common = [
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${prepared.sourceRoot}`,
    "--repository-root", prepared.repositoryRoot
  ];
  const preview = run([...common, "--output", dryOutput, "--dry-run"], fixture);
  assert.equal(preview.status, 0, `${preview.stdout || preview.stderr}\n${canonicalJson(allCalls(fixture))}`);
  const previewResult = JSON.parse(preview.stdout).result;
  assert.equal(previewResult.action, "prepare-revision");
  assert.equal(previewResult.applicationRevision, "1");
  assert.equal(previewResult.mode, "new-application");
  assert.equal(previewResult.networkAccessed, true);
  assert.equal(previewResult.writePerformed, false);
  assert.deepEqual(previewResult.externalActionsPerformed, []);
  assert.equal(fs.existsSync(dryOutput), false);
  assert.ok(allCalls(fixture).length > 0);
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));

  fs.writeFileSync(fixture.callLog, "");
  const writeOutput = path.join(prepared.outputParent, "written-root");
  const written = run([...common, "--output", writeOutput, "--write"], fixture);
  assert.equal(written.status, 0, written.stdout || written.stderr);
  const writtenResult = JSON.parse(written.stdout).result;
  assert.equal(writtenResult.writePerformed, true);
  assert.equal(writtenResult.materialization.atomicDirectoryRename, true);
  assert.deepEqual(fs.readdirSync(writeOutput), ["application.v3.json"]);
  const application = JSON.parse(fs.readFileSync(path.join(writeOutput, "application.v3.json"), "utf8"));
  assert.equal(application.applicationRevision, "1");
  assert.deepEqual(application.lineage, { kind: "new", previous: null });
  const tradeManifestBinding = canonicalV2Fixture(application.applicationId).submission.tradeCapability.markets[0].manifest;
  const tradeManifestPath = tradeManifestBinding.path;
  const tradeManifestRecords = application.reviewPackage.records.filter((record) => (
    record.kind === "trade-capability-manifest"
    && record.source === "application-package"
    && record.repositoryRef === null
    && record.path === tradeManifestPath
    && record.sha256 === tradeManifestBinding.sha256
    && record.byteLength === tradeManifestBinding.byteLength
  ));
  assert.equal(tradeManifestRecords.length, 1);
  assert.equal(application.reviewPackage.requiredKinds.includes("trade-capability-manifest"), false);
  const tradeManifestOriginPath = path.posix.join(path.posix.dirname(application.policyBindings.submissionPath), tradeManifestPath);
  const tradeManifest = JSON.parse(fixtureSourceContent(application, tradeManifestOriginPath));
  const tradeTests = [...tradeManifest.testEvidence.quoteTests, ...tradeManifest.testEvidence.executionTests];
  const expectedTradeResultPaths = new Set(tradeTests.map(({ resultArtifactPath }) => resultArtifactPath));
  const tradeResultRecords = application.reviewPackage.records.filter(({ kind }) => kind === "trade-test-result");
  assert.equal(tradeResultRecords.length, expectedTradeResultPaths.size);
  assert.deepEqual(new Set(tradeResultRecords.map(({ path: recordPath }) => recordPath)), expectedTradeResultPaths);
  assert.ok(tradeResultRecords.every(({ source, repositoryRef }) => source === "application-package" && repositoryRef === null));
  assert.equal(application.reviewPackage.requiredKinds.includes("trade-test-result"), false);
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
  assert.ok(allCalls(fixture).filter(({ endpoint }) => endpoint === "user").length >= 2);
  assert.deepEqual(
    fs.readdirSync(prepared.outputParent).filter((entry) => entry.includes("open-world-staging") || entry.endsWith(".open-world.lock")),
    []
  );
});

test("prepare-revision revalidates raced Git alternates after staging and before atomic rename", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const prepared = createPrepareRevisionDraftFiles(fixture, sourceRoot);
  const controlRoot = path.join(fixture.root, "alternate-race-control");
  const racedAlternate = path.join(fixture.root, "alternate-race.git");
  fs.mkdirSync(controlRoot);
  runLocalGit(controlRoot, ["init", "--quiet", "--initial-branch=main"]);
  runLocalGit(controlRoot, ["config", "user.name", "Alternate Race Fixture"]);
  runLocalGit(controlRoot, ["config", "user.email", "alternate-race@example.invalid"]);
  fs.writeFileSync(path.join(controlRoot, "README.md"), "alternate race control repository\n");
  runLocalGit(controlRoot, ["add", "--", "README.md"]);
  runLocalGit(controlRoot, ["commit", "--quiet", "-m", "alternate race fixture"]);
  runLocalGit(fixture.root, ["init", "--quiet", "--bare", racedAlternate]);

  const objectValue = runLocalGit(controlRoot, ["rev-parse", "--git-path", "objects"]).trim();
  const objectRoot = path.isAbsolute(objectValue) ? objectValue : path.resolve(controlRoot, objectValue);
  const racedObjectRoot = path.join(racedAlternate, "objects");
  const alternatesPath = path.join(objectRoot, "info", "alternates");
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.raceMode = "git-alternates-before-rename";
  state.gitAlternatesRacePath = alternatesPath;
  state.gitAlternatesRaceContent = `${path.relative(objectRoot, racedObjectRoot)}\n`;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);

  const output = path.join(racedObjectRoot, "forbidden-raced-output");
  const result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${sourceRoot}`,
    "--output", output,
    "--repository-root", controlRoot,
    "--write"
  ], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, "OUTPUT_PATH_INVALID");
  assert.equal(fs.readFileSync(alternatesPath, "utf8"), state.gitAlternatesRaceContent);
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(
    fs.readdirSync(racedObjectRoot).filter((entry) => entry.includes("open-world-staging") || entry.endsWith(".open-world.lock")),
    []
  );
  assert.ok(allCalls(fixture).length > 0);
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
  const finalState = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  assert.equal(finalState.gitAlternatesRaceUserReads, 2);
  assert.equal(finalState.gitAlternatesRaceMutations, 1);
});

test("prepare-revision rejects output inside linked-worktree Git control and shared object directories", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const prepared = createPrepareRevisionDraftFiles(fixture, sourceRoot);
  const mainRoot = path.join(fixture.root, "control-main");
  const linkedRoot = path.join(fixture.root, "control-linked");
  fs.mkdirSync(mainRoot);
  runLocalGit(mainRoot, ["init", "--quiet", "--initial-branch=main"]);
  runLocalGit(mainRoot, ["config", "user.name", "Control Fixture"]);
  runLocalGit(mainRoot, ["config", "user.email", "control@example.invalid"]);
  fs.writeFileSync(path.join(mainRoot, "README.md"), "control repository\n");
  runLocalGit(mainRoot, ["add", "--", "README.md"]);
  runLocalGit(mainRoot, ["commit", "--quiet", "-m", "control fixture"]);
  runLocalGit(mainRoot, ["worktree", "add", "--quiet", "-b", "linked-fixture", linkedRoot]);

  const gitDir = runLocalGit(linkedRoot, ["rev-parse", "--absolute-git-dir"]).trim();
  const commonValue = runLocalGit(linkedRoot, ["rev-parse", "--git-common-dir"]).trim();
  const commonDir = path.isAbsolute(commonValue) ? commonValue : path.resolve(linkedRoot, commonValue);
  const objectValue = runLocalGit(linkedRoot, ["rev-parse", "--git-path", "objects"]).trim();
  const objectDir = path.isAbsolute(objectValue) ? objectValue : path.resolve(linkedRoot, objectValue);

  for (const [label, parent] of [["git-dir", gitDir], ["common-dir", commonDir], ["object-dir", objectDir]]) {
    fs.writeFileSync(fixture.callLog, "");
    const output = path.join(parent, `forbidden-${label}`);
    const result = run([
      "open-world", "prepare-revision", prepared.draftPath,
      "--source-root", `primary=${sourceRoot}`,
      "--output", output,
      "--repository-root", linkedRoot,
      "--dry-run"
    ], fixture);
    assert.equal(result.status, 1, `${label}: ${result.stdout || result.stderr}`);
    assert.equal(JSON.parse(result.stdout).error.code, "OUTPUT_PATH_INVALID", label);
    assert.equal(fs.existsSync(output), false, label);
    assert.deepEqual(allCalls(fixture), [], label);
  }
});

test("prepare-revision rejects dry-run output inside recursive external Git alternates without writing", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const prepared = createPrepareRevisionDraftFiles(fixture, sourceRoot);
  const controlRoot = path.join(fixture.root, "alternate-control");
  const alternateA = path.join(fixture.root, "alternate-a.git");
  const alternateB = path.join(fixture.root, "alternate-b.git");
  fs.mkdirSync(controlRoot);
  runLocalGit(controlRoot, ["init", "--quiet", "--initial-branch=main"]);
  runLocalGit(controlRoot, ["config", "user.name", "Alternate Fixture"]);
  runLocalGit(controlRoot, ["config", "user.email", "alternate@example.invalid"]);
  fs.writeFileSync(path.join(controlRoot, "README.md"), "alternate control repository\n");
  runLocalGit(controlRoot, ["add", "--", "README.md"]);
  runLocalGit(controlRoot, ["commit", "--quiet", "-m", "alternate fixture"]);
  runLocalGit(fixture.root, ["init", "--quiet", "--bare", alternateA]);
  runLocalGit(fixture.root, ["init", "--quiet", "--bare", alternateB]);

  const primaryObjects = runLocalGit(controlRoot, ["rev-parse", "--git-path", "objects"]).trim();
  const primaryObjectRoot = path.isAbsolute(primaryObjects)
    ? primaryObjects
    : path.resolve(controlRoot, primaryObjects);
  const alternateAObjects = path.join(alternateA, "objects");
  const alternateBObjects = path.join(alternateB, "objects");
  writeAlternates(primaryObjectRoot, [alternateAObjects]);
  writeAlternates(alternateAObjects, [alternateBObjects]);
  writeAlternates(alternateBObjects, [alternateAObjects]);

  fs.writeFileSync(fixture.callLog, "");
  const output = path.join(alternateBObjects, "forbidden-alternate-output");
  const result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${sourceRoot}`,
    "--output", output,
    "--repository-root", controlRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, "OUTPUT_PATH_INVALID");
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(allCalls(fixture), []);
});

test("prepare-revision fails closed on malformed Git alternates before network or output", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const prepared = createPrepareRevisionDraftFiles(fixture, sourceRoot);
  const controlRoot = path.join(fixture.root, "malformed-alternate-control");
  const alternate = path.join(fixture.root, "malformed-alternate.git");
  fs.mkdirSync(controlRoot);
  runLocalGit(controlRoot, ["init", "--quiet", "--initial-branch=main"]);
  runLocalGit(controlRoot, ["config", "user.name", "Malformed Alternate Fixture"]);
  runLocalGit(controlRoot, ["config", "user.email", "malformed-alternate@example.invalid"]);
  fs.writeFileSync(path.join(controlRoot, "README.md"), "malformed alternate control repository\n");
  runLocalGit(controlRoot, ["add", "--", "README.md"]);
  runLocalGit(controlRoot, ["commit", "--quiet", "-m", "malformed alternate fixture"]);
  runLocalGit(fixture.root, ["init", "--quiet", "--bare", alternate]);
  const objectValue = runLocalGit(controlRoot, ["rev-parse", "--git-path", "objects"]).trim();
  const objectRoot = path.isAbsolute(objectValue) ? objectValue : path.resolve(controlRoot, objectValue);
  const relativeAlternate = path.relative(objectRoot, path.join(alternate, "objects"));
  fs.writeFileSync(path.join(objectRoot, "info", "alternates"), `${relativeAlternate}\n\n${relativeAlternate}\n`);

  fs.writeFileSync(fixture.callLog, "");
  const output = path.join(fixture.root, "malformed-alternate-output");
  const result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${sourceRoot}`,
    "--output", output,
    "--repository-root", controlRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, "OUTPUT_PATH_INVALID");
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(allCalls(fixture), []);
});

test("prepare-revision bounds total Git alternate entries and unique lexical resolution attempts", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const prepared = createPrepareRevisionDraftFiles(fixture, sourceRoot);
  const controlRoot = path.join(fixture.root, "alternate-budget-control");
  const alternate = path.join(fixture.root, "alternate-budget.git");
  fs.mkdirSync(controlRoot);
  runLocalGit(controlRoot, ["init", "--quiet", "--initial-branch=main"]);
  runLocalGit(controlRoot, ["config", "user.name", "Alternate Budget Fixture"]);
  runLocalGit(controlRoot, ["config", "user.email", "alternate-budget@example.invalid"]);
  fs.writeFileSync(path.join(controlRoot, "README.md"), "alternate budget control repository\n");
  runLocalGit(controlRoot, ["add", "--", "README.md"]);
  runLocalGit(controlRoot, ["commit", "--quiet", "-m", "alternate budget fixture"]);
  runLocalGit(fixture.root, ["init", "--quiet", "--bare", alternate]);
  const objectValue = runLocalGit(controlRoot, ["rev-parse", "--git-path", "objects"]).trim();
  const objectRoot = path.isAbsolute(objectValue) ? objectValue : path.resolve(controlRoot, objectValue);
  const alternateObjectRoot = path.join(alternate, "objects");

  writeAlternates(objectRoot, Array.from({ length: 257 }, () => alternateObjectRoot));
  let output = path.join(prepared.outputParent, "alternate-entry-budget");
  let result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${sourceRoot}`,
    "--output", output,
    "--repository-root", controlRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, "OUTPUT_PATH_INVALID");
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(allCalls(fixture), []);

  const aliasObjectRoots = [];
  for (let index = 0; index < 65; index += 1) {
    const alias = path.join(fixture.root, `alternate-budget-alias-${index}`);
    fs.symlinkSync(alternate, alias, "dir");
    aliasObjectRoots.push(path.join(alias, "objects"));
  }
  writeAlternates(objectRoot, aliasObjectRoots);
  fs.writeFileSync(fixture.callLog, "");
  output = path.join(prepared.outputParent, "alternate-attempt-budget");
  result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${sourceRoot}`,
    "--output", output,
    "--repository-root", controlRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, "OUTPUT_PATH_INVALID");
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(allCalls(fixture), []);
});

test("prepare-revision permits only discovered cycles at the Git alternate depth boundary", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const prepared = createPrepareRevisionDraftFiles(fixture, sourceRoot);
  const controlRoot = path.join(fixture.root, "alternate-depth-control");
  const controlAlias = path.join(fixture.root, "alternate-depth-control-alias");
  fs.mkdirSync(controlRoot);
  runLocalGit(controlRoot, ["init", "--quiet", "--initial-branch=main"]);
  runLocalGit(controlRoot, ["config", "user.name", "Alternate Depth Fixture"]);
  runLocalGit(controlRoot, ["config", "user.email", "alternate-depth@example.invalid"]);
  fs.writeFileSync(path.join(controlRoot, "README.md"), "alternate depth control repository\n");
  runLocalGit(controlRoot, ["add", "--", "README.md"]);
  runLocalGit(controlRoot, ["commit", "--quiet", "-m", "alternate depth fixture"]);
  fs.symlinkSync(controlRoot, controlAlias, "dir");
  const stores = [];
  for (let index = 0; index < 17; index += 1) {
    const store = path.join(fixture.root, `alternate-depth-${index}.git`);
    runLocalGit(fixture.root, ["init", "--quiet", "--bare", store]);
    stores.push(path.join(store, "objects"));
  }
  const objectValue = runLocalGit(controlRoot, ["rev-parse", "--git-path", "objects"]).trim();
  const objectRoot = path.isAbsolute(objectValue) ? objectValue : path.resolve(controlRoot, objectValue);
  writeAlternates(objectRoot, [stores[0]]);
  for (let index = 0; index < 15; index += 1) writeAlternates(stores[index], [stores[index + 1]]);
  writeAlternates(stores[15], [path.join(controlAlias, ".git", "objects")]);

  let output = path.join(prepared.outputParent, "alternate-depth-cycle");
  let result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${sourceRoot}`,
    "--output", output,
    "--repository-root", controlRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).result.writePerformed, false);
  assert.equal(fs.existsSync(output), false);
  assert.ok(allCalls(fixture).length > 0);
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));

  writeAlternates(stores[15], [stores[16]]);
  fs.writeFileSync(fixture.callLog, "");
  output = path.join(prepared.outputParent, "alternate-depth-new-root");
  result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${sourceRoot}`,
    "--output", output,
    "--repository-root", controlRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, "OUTPUT_PATH_INVALID");
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(allCalls(fixture), []);
});

test("prepare-revision rejects an unused predecessor source mapping without writing", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const prepared = createPrepareRevisionDraftFiles(fixture, sourceRoot);
  const output = path.join(prepared.outputParent, "unused-predecessor-root");
  const result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${sourceRoot}`,
    "--predecessor-source-root", `primary=${sourceRoot}`,
    "--output", output,
    "--repository-root", prepared.repositoryRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, "APPLICATION_PREDECESSOR_SOURCE_ROOT_SET_MISMATCH");
  assert.equal(fs.existsSync(output), false);
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("prepare-revision accepts a manifest repository with more than 64 MiB of unbound source", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture, { largeUnboundSource: true });
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.sourceTreeTruncated = true;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const prepared = createPrepareRevisionDraftFiles(fixture, sourceRoot);
  const result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${sourceRoot}`,
    "--output", path.join(prepared.outputParent, "large-manifest-source"),
    "--repository-root", prepared.repositoryRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).result.mode, "new-application");
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("prepare-revision leaves a manifest-owned source-critical symlink to dependency verification", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const application = readFixtureApplication(fixture);
  application.source.primary.contractPaths = ["src/Hook.sol"];
  writeFixtureApplication(fixture, application);
  const sourceRoot = await attachLocalManifestSource(fixture, { contractSymlink: true });
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.sourceTreeTruncated = true;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const prepared = createPrepareRevisionDraftFiles(fixture, sourceRoot);
  const result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${sourceRoot}`,
    "--output", path.join(prepared.outputParent, "symlink-manifest-source"),
    "--repository-root", prepared.repositoryRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).result.mode, "new-application");
  assert.equal(runLocalGit(sourceRoot, ["ls-tree", "HEAD", "src/Hook.sol"]).startsWith("120000 blob "), true);
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("prepare-revision rejects conflicting metadata for a locally proven path in a truncated source tree", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const application = readFixtureApplication(fixture);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.sourceTreeTruncated = true;
  state.sourceTreeEntryOverrides[application.source.primary.sourceManifest.path] = {
    type: "tree",
    mode: "040000",
    size: null
  };
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const prepared = createPrepareRevisionDraftFiles(fixture, sourceRoot);
  const result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${sourceRoot}`,
    "--output", path.join(prepared.outputParent, "conflicting-tree-entry"),
    "--repository-root", prepared.repositoryRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, "APPLICATION_SOURCE_BINDING_MISMATCH");
  assert.equal(fs.existsSync(path.join(prepared.outputParent, "conflicting-tree-entry")), false);
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("prepare-revision derives a recheck successor from the highest exact Registry V3 package", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const application = readFixtureApplication(fixture);
  const projection = projectFixturePackage(fixture.packageRoot, application);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.centralContents = projection.contents;
  state.centralTreeEntries = [{
    path: `submissions/${application.applicationId}/v3/revisions/${application.applicationRevision}`,
    mode: "040000",
    type: "tree",
    sha: "a".repeat(40),
    size: null
  }];
  state.sourceTreeTruncated = true;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const prepared = createPrepareRevisionDraftFiles(fixture, sourceRoot);
  const draft = JSON.parse(fs.readFileSync(prepared.draftPath, "utf8"));
  draft.source.primary.githubActionsRunIds = ["987654321"];
  fs.writeFileSync(prepared.draftPath, `${canonicalJson(draft)}\n`);

  const result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${sourceRoot}`,
    "--output", path.join(prepared.outputParent, "registry-successor"),
    "--repository-root", prepared.repositoryRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout).result;
  assert.equal(payload.mode, "merged-registry-successor");
  assert.equal(payload.applicationRevision, "2");
  assert.equal(payload.lineage.kind, "recheck");
  assert.equal(payload.lineage.previous.applicationRevision, "1");
  assert.deepEqual(payload.target, { githubNextAction: "submit", pullRequestNumber: null });
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("prepare-revision migrates an exact V2 base and rejects noncanonical or schema-drifted pinned submissions", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const prepared = createPrepareRevisionDraftFiles(fixture, sourceRoot);
  for (const variant of ["valid", "noncanonical", "schema-invalid"]) {
    const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
    installLegacyV2PreparePredecessor(fixture, state, variant);
    fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
    fs.writeFileSync(fixture.callLog, "");
    const output = path.join(prepared.outputParent, `v2-${variant}`);
    const result = run([
      "open-world", "prepare-revision", prepared.draftPath,
      "--source-root", `primary=${sourceRoot}`,
      "--output", output,
      "--repository-root", prepared.repositoryRoot,
      "--dry-run"
    ], fixture);
    if (variant === "valid") {
      assert.equal(result.status, 0, result.stdout || result.stderr);
      const payload = JSON.parse(result.stdout).result;
      assert.equal(payload.mode, "legacy-schema-migration");
      assert.equal(payload.applicationRevision, "8");
      assert.equal(payload.lineage.kind, "schema-migration");
      assert.equal(payload.lineage.previous.applicationContract, "public-pr-application-v2");
      assert.equal(payload.lineage.previous.applicationRevision, "7");
    } else {
      assert.equal(result.status, 1, `${variant}: ${result.stdout || result.stderr}`);
      assert.equal(JSON.parse(result.stdout).error.code, "PREPARE_REVISION_V2_PACKAGE_INVALID", variant);
    }
    assert.equal(fs.existsSync(output), false);
    assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
    assert.deepEqual(mutatingCalls(fixture), []);
  }
});

test("prepare-revision replays a manifest predecessor at commit A from the current commit-B object store", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const predecessorApplication = readFixtureApplication(fixture);
  const predecessorProjection = projectFixturePackage(fixture.packageRoot, predecessorApplication);
  const predecessorCommit = predecessorApplication.source.primary.revisionObjectId;
  await advanceLocalManifestSource(fixture, sourceRoot);
  const currentApplication = readFixtureApplication(fixture);
  const currentHead = runLocalGit(sourceRoot, ["rev-parse", "HEAD"]).trim();
  assert.notEqual(currentHead, predecessorCommit);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.centralContents = predecessorProjection.contents;
  state.sourceTreeTruncated = true;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const prepared = createPrepareRevisionDraftFiles(fixture, sourceRoot);

  const result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${sourceRoot}`,
    "--output", path.join(prepared.outputParent, "source-update"),
    "--repository-root", prepared.repositoryRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout).result;
  assert.equal(payload.mode, "merged-registry-successor");
  assert.equal(payload.applicationRevision, "2");
  assert.equal(payload.sourceChanged, true);
  assert.equal(payload.lineage.kind, "source-update");
  assert.equal(payload.lineage.previous.sourceCommit, predecessorCommit);
  assert.equal(currentApplication.source.primary.revisionObjectId, currentHead);
  assert.equal(runLocalGit(sourceRoot, ["rev-parse", "HEAD"]).trim(), currentHead);
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("prepare-revision advances from a pruned same-numeric root to the next complete root", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const firstRoot = await attachLocalManifestSource(fixture, { unboundSource: true });
  const predecessorApplication = readFixtureApplication(fixture);
  const predecessorProjection = projectFixturePackage(fixture.packageRoot, predecessorApplication);
  const oldObjectIds = readHistoricalManifestObjectIds(
    firstRoot,
    predecessorApplication,
    "notes/unbound-source.txt"
  );
  const secondRoot = path.join(fixture.root, "same-numeric-complete-root");
  fs.cpSync(firstRoot, secondRoot, { recursive: true });
  const oldManifestDirectory = path.dirname(path.join(
    firstRoot,
    ...predecessorApplication.source.primary.sourceManifest.path.split("/")
  ));
  fs.rmSync(oldManifestDirectory, { recursive: true });
  runLocalGit(firstRoot, ["add", "--all", "--", "."]);
  runLocalGit(firstRoot, ["commit", "--quiet", "-m", "drop historical closure transport files"]);
  await advanceLocalManifestSource(fixture, firstRoot);
  const companion = await addSameNumericManifestCompanion(fixture, secondRoot);
  const currentApplication = readFixtureApplication(fixture);
  assert.equal(companion.numericRepositoryId, currentApplication.source.primary.numericRepositoryId);
  assert.notEqual(companion.revisionObjectId, currentApplication.source.primary.revisionObjectId);
  fs.unlinkSync(looseGitObjectPath(firstRoot, oldObjectIds.fragment));
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.centralContents = predecessorProjection.contents;
  state.sourceTreeTruncated = true;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const prepared = createPrepareRevisionDraftFiles(fixture, firstRoot);
  const result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${firstRoot}`,
    "--source-root", `${companion.id}=${secondRoot}`,
    "--output", path.join(prepared.outputParent, "same-numeric-fallback"),
    "--repository-root", prepared.repositoryRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout).result;
  assert.equal(payload.applicationRevision, "2");
  assert.equal(payload.lineage.previous.sourceCommit, predecessorApplication.source.primary.revisionObjectId);
  assert.equal(runLocalGit(firstRoot, ["rev-parse", "HEAD"]).trim(), currentApplication.source.primary.revisionObjectId);
  assert.equal(runLocalGit(secondRoot, ["rev-parse", "HEAD"]).trim(), companion.revisionObjectId);
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("prepare-revision uses an explicit historical root for a manifest repository migration", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const predecessorRoot = await attachLocalManifestSource(fixture, { directoryName: "predecessor-source-repository" });
  const predecessorApplication = readFixtureApplication(fixture);
  const predecessorProjection = projectFixturePackage(fixture.packageRoot, predecessorApplication);
  const predecessorCommit = predecessorApplication.source.primary.revisionObjectId;
  const oldState = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  const oldSlug = oldState.sourceRepository.full_name;
  const oldSnapshot = {
    tree: oldState.sourceTree,
    contents: oldState.sourceContents,
    sizeOverrides: oldState.sourceTreeSizeOverrides ?? {},
    truncated: true
  };

  const migratedApplication = structuredClone(predecessorApplication);
  migratedApplication.source.primary.numericRepositoryId = "888888888";
  migratedApplication.source.primary.repositoryUri = "https://github.com/example-builder/migrated-open-world-example";
  writeFixtureApplication(fixture, migratedApplication);
  const currentRoot = await attachLocalManifestSource(fixture, { directoryName: "migrated-source-repository" });
  const currentApplication = readFixtureApplication(fixture);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.sourceArchives[oldSlug] = {
    metadata: oldState.sourceRepository,
    snapshots: { [predecessorCommit]: oldSnapshot }
  };
  state.sourceRepository = {
    ...state.sourceRepository,
    id: Number(currentApplication.source.primary.numericRepositoryId),
    full_name: "example-builder/migrated-open-world-example",
    html_url: currentApplication.source.primary.repositoryUri
  };
  state.centralContents = predecessorProjection.contents;
  state.sourceTreeTruncated = true;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const prepared = createPrepareRevisionDraftFiles(fixture, currentRoot);

  const held = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${currentRoot}`,
    "--output", path.join(prepared.outputParent, "missing-predecessor-replay"),
    "--repository-root", prepared.repositoryRoot,
    "--dry-run"
  ], fixture);
  assert.equal(held.status, 1, held.stdout || held.stderr);
  assert.equal(JSON.parse(held.stdout).error.code, "APPLICATION_GITHUB_TRANSPORT_INTEGRATION_PENDING");
  assert.equal(fs.existsSync(path.join(prepared.outputParent, "missing-predecessor-replay")), false);
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
  fs.writeFileSync(fixture.callLog, "");

  const result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${currentRoot}`,
    "--predecessor-source-root", `primary=${predecessorRoot}`,
    "--output", path.join(prepared.outputParent, "repository-migration"),
    "--repository-root", prepared.repositoryRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout).result;
  assert.equal(payload.applicationRevision, "2");
  assert.equal(payload.sourceChanged, true);
  assert.equal(payload.lineage.kind, "source-update");
  assert.equal(payload.lineage.previous.sourceNumericRepositoryId, predecessorApplication.source.primary.numericRepositoryId);
  assert.equal(runLocalGit(predecessorRoot, ["rev-parse", "HEAD"]).trim(), predecessorCommit);
  assert.equal(
    runLocalGit(currentRoot, ["rev-parse", "HEAD"]).trim(),
    currentApplication.source.primary.revisionObjectId
  );
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("prepare-revision replays a removed inline repository in a mixed manifest predecessor through an explicit old root", async (t) => {
  const fixture = createTransportFixture(t, { manifestSource: true });
  const primaryRoot = await attachLocalManifestSource(fixture);
  const currentApplication = structuredClone(readFixtureApplication(fixture));
  const securityPath = path.join(fixture.packageRoot, currentApplication.securityBindings.securityAssessmentPath);
  const currentSecurityBytes = fs.readFileSync(securityPath);

  const inlineRoot = path.join(fixture.root, "removed-inline-source");
  fs.mkdirSync(inlineRoot);
  runLocalGit(inlineRoot, ["init", "--quiet", "--initial-branch=main"]);
  runLocalGit(inlineRoot, ["config", "user.name", "Removed Inline Fixture"]);
  runLocalGit(inlineRoot, ["config", "user.email", "removed-inline@example.invalid"]);
  fs.mkdirSync(path.join(inlineRoot, "src"));
  fs.writeFileSync(path.join(inlineRoot, "src", "Inline.sol"), "contract RemovedInline {}\n");
  runLocalGit(inlineRoot, ["add", "--", "."]);
  runLocalGit(inlineRoot, ["commit", "--quiet", "-m", "removed inline source"]);
  const { companion, reportPath } = addInlinePredecessorCompanion(fixture, inlineRoot);
  const predecessorApplication = readFixtureApplication(fixture);
  const predecessorProjection = projectFixturePackage(fixture.packageRoot, predecessorApplication);

  fs.writeFileSync(securityPath, currentSecurityBytes);
  fs.unlinkSync(path.join(fixture.packageRoot, reportPath));
  writeFixtureApplication(fixture, currentApplication);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.centralContents = predecessorProjection.contents;
  state.packageContents = projectFixturePackage(fixture.packageRoot, currentApplication).contents;
  state.sourceTreeTruncated = true;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const prepared = createPrepareRevisionDraftFiles(fixture, primaryRoot);

  const heldOutput = path.join(prepared.outputParent, "mixed-missing-inline-root");
  const held = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${primaryRoot}`,
    "--output", heldOutput,
    "--repository-root", prepared.repositoryRoot,
    "--dry-run"
  ], fixture);
  assert.equal(held.status, 1, held.stdout || held.stderr);
  assert.equal(JSON.parse(held.stdout).error.code, "APPLICATION_GITHUB_TRANSPORT_INTEGRATION_PENDING");
  assert.equal(fs.existsSync(heldOutput), false);
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
  fs.writeFileSync(fixture.callLog, "");

  const output = path.join(prepared.outputParent, "mixed-explicit-inline-root");
  const result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${primaryRoot}`,
    "--predecessor-source-root", `${companion.id}=${inlineRoot}`,
    "--output", output,
    "--repository-root", prepared.repositoryRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout).result;
  assert.equal(payload.applicationRevision, "2");
  assert.equal(payload.lineage.kind, "source-update");
  assert.equal(payload.sourceChanged, true);
  assert.equal(fs.existsSync(output), false);
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("prepare-revision holds only for missing historical manifest objects and keeps corruption invalid", async (t) => {
  for (const objectKind of ["manifest-root", "fragment", "source"]) {
    const fixture = createTransportFixture(t, { manifestSource: true });
    const predecessorRoot = await attachLocalManifestSource(fixture, { unboundSource: true });
    const predecessorApplication = readFixtureApplication(fixture);
    const predecessorProjection = projectFixturePackage(fixture.packageRoot, predecessorApplication);
    const historicalRoot = path.join(fixture.root, `historical-${objectKind}`);
    fs.cpSync(predecessorRoot, historicalRoot, { recursive: true });
    const objectIds = readHistoricalManifestObjectIds(
      historicalRoot,
      predecessorApplication,
      "notes/unbound-source.txt"
    );
    await advanceLocalManifestSource(fixture, predecessorRoot);
    const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
    state.centralContents = predecessorProjection.contents;
    state.sourceTreeTruncated = true;
    fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
    const prepared = createPrepareRevisionDraftFiles(fixture, predecessorRoot);
    fs.unlinkSync(looseGitObjectPath(historicalRoot, objectIds[objectKind]));

    const result = run([
      "open-world", "prepare-revision", prepared.draftPath,
      "--source-root", `primary=${predecessorRoot}`,
      "--predecessor-source-root", `primary=${historicalRoot}`,
      "--output", path.join(prepared.outputParent, `missing-${objectKind}`),
      "--repository-root", prepared.repositoryRoot,
      "--dry-run"
    ], fixture);
    assert.equal(result.status, 1, `${objectKind}: ${result.stdout || result.stderr}`);
    const error = JSON.parse(result.stdout).error;
    assert.equal(error.code, "APPLICATION_GITHUB_TRANSPORT_INTEGRATION_PENDING", objectKind);
    assert.equal(error.details.status, "INTEGRATION_PENDING");
    assert.equal(error.details.route, "INTEGRATION_PENDING");
    assert.equal(error.details.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
    assert.equal(error.details.networkAccessed, true);
    assert.equal(error.details.writePerformed, false);
    assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
    assert.deepEqual(mutatingCalls(fixture), []);
  }

  const fixture = createTransportFixture(t, { manifestSource: true });
  const predecessorRoot = await attachLocalManifestSource(fixture, { unboundSource: true });
  const predecessorApplication = readFixtureApplication(fixture);
  const predecessorProjection = projectFixturePackage(fixture.packageRoot, predecessorApplication);
  const historicalRoot = path.join(fixture.root, "historical-corrupt-fragment");
  fs.cpSync(predecessorRoot, historicalRoot, { recursive: true });
  const objectIds = readHistoricalManifestObjectIds(
    historicalRoot,
    predecessorApplication,
    "notes/unbound-source.txt"
  );
  await advanceLocalManifestSource(fixture, predecessorRoot);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.centralContents = predecessorProjection.contents;
  state.sourceTreeTruncated = true;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const prepared = createPrepareRevisionDraftFiles(fixture, predecessorRoot);
  const corruptObjectPath = looseGitObjectPath(historicalRoot, objectIds.fragment);
  fs.chmodSync(corruptObjectPath, 0o644);
  const substitutedBytes = Buffer.from("readable but cryptographically different fragment\n", "utf8");
  fs.writeFileSync(corruptObjectPath, zlib.deflateSync(Buffer.concat([
    Buffer.from(`blob ${substitutedBytes.length}\0`, "utf8"),
    substitutedBytes
  ])));

  const result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${predecessorRoot}`,
    "--predecessor-source-root", `primary=${historicalRoot}`,
    "--output", path.join(prepared.outputParent, "corrupt-fragment"),
    "--repository-root", prepared.repositoryRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.notEqual(
    JSON.parse(result.stdout).error.code,
    "APPLICATION_GITHUB_TRANSPORT_INTEGRATION_PENDING",
    result.stdout
  );
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("prepare-revision selects one current revision-titled open draft and derives its update", async (t) => {
  const fixture = createTransportFixture(t, { mode: "status", manifestSource: true });
  const sourceRoot = await attachLocalManifestSource(fixture);
  const application = readFixtureApplication(fixture);
  const projection = projectFixturePackage(fixture.packageRoot, application);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  const title = `[Application V3] ${application.applicationId} revision ${application.applicationRevision}`;
  state.contents = projection.contents;
  state.branch = state.pull.head.ref;
  state.pull.title = title;
  state.pullFiles = projection.paths.map((filename) => ({ filename, status: "added", sha: "5".repeat(40) }));
  state.pull.changed_files = state.pullFiles.length;
  state.prepareSearch = {
    total_count: 1,
    items: [{ number: state.pull.number, title, user: state.viewer }]
  };
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const prepared = createPrepareRevisionDraftFiles(fixture, sourceRoot);
  const draft = JSON.parse(fs.readFileSync(prepared.draftPath, "utf8"));
  draft.source.primary.githubActionsRunIds = ["987654321"];
  fs.writeFileSync(prepared.draftPath, `${canonicalJson(draft)}\n`);

  const result = run([
    "open-world", "prepare-revision", prepared.draftPath,
    "--source-root", `primary=${sourceRoot}`,
    "--output", path.join(prepared.outputParent, "open-draft-update"),
    "--repository-root", prepared.repositoryRoot,
    "--dry-run"
  ], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout).result;
  assert.equal(payload.mode, "open-draft-update");
  assert.equal(payload.applicationRevision, "2");
  assert.equal(payload.lineage.kind, "recheck");
  assert.deepEqual(payload.target, { githubNextAction: "update", pullRequestNumber: 7 });
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("prepare-revision rejects manual lineage and malformed nested drafts before any GitHub request without leaking private input", (t) => {
  for (const mutate of [
    (draft) => { draft.applicationRevision = "9"; },
    (draft) => { draft.lineage = { kind: "new", previous: null }; },
    (draft) => { draft.policyBindings.feeApplicability = "unresolved"; }
  ]) {
    const fixture = createTransportFixture(t);
    const prepared = attachPrepareRevisionInlineSource(fixture);
    const draft = JSON.parse(fs.readFileSync(prepared.draftPath, "utf8"));
    const sentinel = "sk_live_NEVER_PRINT_THIS_PRIVATE_SENTINEL_123456";
    draft.intentCapture.originalIdeaDisplayExcerpt = sentinel;
    mutate(draft);
    fs.writeFileSync(prepared.draftPath, `${canonicalJson(draft)}\n`);
    const result = run([
      "open-world", "prepare-revision", prepared.draftPath,
      "--source-root", `primary=${prepared.sourceRoot}`,
      "--output", path.join(prepared.outputParent, "rejected"),
      "--repository-root", prepared.repositoryRoot
    ], fixture);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    assert.equal(result.stdout.includes(sentinel), false);
    assert.deepEqual(allCalls(fixture), []);
    assert.equal(fs.existsSync(path.join(prepared.outputParent, "rejected")), false);
  }
});

test("prepare-revision and submit reject duplicate JSON keys before network or privacy interpretation", (t) => {
  for (const [label, mutate] of [
    ["same", (source) => source.replace('"applicationId":"legacy-open-world-example"', '"applicationId":"legacy-open-world-example","applicationId":"legacy-open-world-example"')],
    ["conflicting-secret", (source) => source.replace('"applicationId":"legacy-open-world-example"', `"applicationId":"sk-proj-${"A".repeat(24)}","applicationId":"legacy-open-world-example"`)],
    ["escaped", (source) => source.replace('"applicationId":"legacy-open-world-example"', '"application\\u0049d":"wrong","applicationId":"legacy-open-world-example"')]
  ]) {
    const fixture = createTransportFixture(t);
    const prepared = createPrepareRevisionDraftFiles(fixture, fixture.root);
    const original = fs.readFileSync(prepared.draftPath, "utf8");
    fs.writeFileSync(prepared.draftPath, mutate(original));
    const result = run([
      "open-world", "prepare-revision", prepared.draftPath,
      "--source-root", `primary=${fixture.root}`,
      "--output", path.join(prepared.outputParent, `duplicate-${label}`),
      "--repository-root", prepared.repositoryRoot,
      "--dry-run"
    ], fixture);
    assert.equal(result.status, 1, `${label}: ${result.stdout || result.stderr}`);
    assert.equal(JSON.parse(result.stdout).error.code, "APPLICATION_INPUT_INVALID", label);
    assert.equal(result.stdout.includes("sk-proj-"), false, label);
    assert.deepEqual(allCalls(fixture), [], label);
  }

  const fixture = createTransportFixture(t);
  const applicationPath = path.join(fixture.packageRoot, "application.v3.json");
  const source = fs.readFileSync(applicationPath, "utf8");
  fs.writeFileSync(applicationPath, source.replace(
    '"applicationId":"legacy-open-world-example"',
    '"applicationId":"legacy-open-world-example","applicationId":"legacy-open-world-example"'
  ));
  const result = run(["open-world", "submit", fixture.packageRoot], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, "APPLICATION_V3_PACKAGE_INVALID");
  assert.deepEqual(allCalls(fixture), []);
});

test("open-world submit emits a stable read-only GitHub plan and rejects a wrong digest before any write", (t) => {
  const fixture = createTransportFixture(t);
  const command = ["open-world", "submit", fixture.packageRoot];
  const first = run(command, fixture);
  assert.equal(first.status, 0, first.stdout || first.stderr);
  assert.equal(first.stderr, "");
  const firstPayload = JSON.parse(first.stdout);
  assert.equal(first.stdout, `${canonicalJson(firstPayload)}\n`);
  assert.equal(firstPayload.result.action, "submit-plan");
  assert.equal(firstPayload.result.readOnly, true);
  assert.equal(firstPayload.result.writePerformed, false);
  assert.equal(firstPayload.result.networkAccessed, true);
  assert.deepEqual(firstPayload.result.externalActionsPerformed, []);
  assert.equal(
    firstPayload.result.target.directory,
    `submissions/legacy-open-world-example/v3/revisions/${fixture.applicationRevision}`
  );
  assert.deepEqual(firstPayload.result.externalWrites, [
    "create-viewer-fork",
    "create-application-tree",
    "create-application-commit",
    "create-application-branch",
    "open-draft-pull-request"
  ]);
  assert.match(firstPayload.result.confirmationDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(firstPayload.result.package.files.every((record) => !Object.hasOwn(record, "content")));
  assert.deepEqual(mutatingCalls(fixture), []);

  const second = run(command, fixture);
  assert.equal(second.status, 0, second.stdout || second.stderr);
  assert.equal(JSON.parse(second.stdout).result.confirmationDigest, firstPayload.result.confirmationDigest);
  assert.deepEqual(mutatingCalls(fixture), []);

  const rejected = run([
    ...command,
    "--confirm-external-write",
    `sha256:${"0".repeat(64)}`
  ], fixture);
  assert.equal(rejected.status, 1, rejected.stdout || rejected.stderr);
  const rejectedPayload = JSON.parse(rejected.stdout);
  assert.equal(rejectedPayload.error.code, "EXTERNAL_WRITE_CONFIRMATION_REQUIRED");
  assert.equal(rejectedPayload.error.details.currentConfirmationDigest, firstPayload.result.confirmationDigest);
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("open-world submit plan never prints package content but its digest binds every byte hash", (t) => {
  const firstSentinel = "unique-public-fixture-marker-alpha";
  const secondSentinel = "unique-public-fixture-marker-beta";
  const firstFixture = createTransportFixture(t, { sentinel: firstSentinel });
  const secondFixture = createTransportFixture(t, { sentinel: secondSentinel });
  const first = run(["open-world", "submit", firstFixture.packageRoot], firstFixture);
  const second = run(["open-world", "submit", secondFixture.packageRoot], secondFixture);
  assert.equal(first.status, 0, first.stdout || first.stderr);
  assert.equal(second.status, 0, second.stdout || second.stderr);
  assert.equal(first.stdout.includes(firstSentinel), false);
  assert.equal(second.stdout.includes(secondSentinel), false);
  const firstPayload = JSON.parse(first.stdout).result;
  const secondPayload = JSON.parse(second.stdout).result;
  assert.notEqual(firstPayload.package.packageSha256, secondPayload.package.packageSha256);
  assert.notEqual(firstPayload.confirmationDigest, secondPayload.confirmationDigest);
  assert.ok(firstPayload.package.files.every((record) => !Object.hasOwn(record, "content")));
  assert.deepEqual(mutatingCalls(firstFixture), []);
  assert.deepEqual(mutatingCalls(secondFixture), []);
});

test("open-world submit refuses an occupied immutable revision at the exact central base", (t) => {
  const fixture = createTransportFixture(t);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  const targetPath = Object.keys(state.packageContents)[0];
  state.centralContents[targetPath] = state.packageContents[targetPath];
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const result = run(["open-world", "submit", fixture.packageRoot], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, "APPLICATION_REVISION_ALREADY_IN_BASE");
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("central target absence treats only an exact 404 as absent", (t) => {
  for (const [failure, expectedCode] of [
    ["403", "GITHUB_REQUEST_FAILED"],
    ["500", "GITHUB_GET_RETRY_EXHAUSTED"],
    ["malformed", "GITHUB_OUTPUT_INVALID"]
  ]) {
    const fixture = createTransportFixture(t);
    const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
    state.centralContentFailure = failure;
    fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
    const result = run(["open-world", "submit", fixture.packageRoot], fixture);
    assert.equal(result.status, 1, `${failure}: ${result.stdout || result.stderr}`);
    assert.equal(JSON.parse(result.stdout).error.code, expectedCode);
    assert.deepEqual(mutatingCalls(fixture), []);
  }
});

test("open-world submit performs only the digest-confirmed writes against a fake GitHub transport", (t) => {
  const fixture = createTransportFixture(t);
  const command = ["open-world", "submit", fixture.packageRoot];
  const preview = run(command, fixture);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  const confirmationDigest = JSON.parse(preview.stdout).result.confirmationDigest;

  const confirmed = run([
    ...command,
    "--confirm-external-write",
    confirmationDigest
  ], fixture, { allowWrites: true });
  assert.equal(confirmed.status, 0, confirmed.stdout || confirmed.stderr);
  const payload = JSON.parse(confirmed.stdout);
  assert.equal(payload.result.action, "submit");
  assert.equal(payload.result.confirmationDigest, confirmationDigest);
  assert.equal(payload.result.writePerformed, true);
  assert.equal(payload.result.target.forkRepository, "example-builder/submit-launch");
  assert.equal(payload.result.target.branchCommit, "7".repeat(40));
  assert.equal(payload.result.target.pullRequestNumber, 7);
  assert.equal(payload.result.approvalGranted, false);
  assert.equal(payload.result.launchAuthorizationGranted, false);
  assert.deepEqual(payload.result.externalActionsPerformed, [
    "created-viewer-fork",
    "created-application-tree",
    "created-application-commit",
    "created-application-branch",
    "opened-draft-pull-request"
  ]);
  const receiptPath = path.join(fixture.root, "application-v3-mutation-receipt.json");
  const receiptText = fs.readFileSync(receiptPath, "utf8");
  const receipt = JSON.parse(receiptText);
  assert.equal(receiptText, `${canonicalJson(receipt)}\n`);
  assert.equal(receipt.kind, "public-pr-application-v3-mutation-receipt");
  assert.equal(receipt.state, "COMPLETE");
  assert.equal(receipt.confirmationDigest, confirmationDigest);
  assert.equal(receipt.mutations.length, 5);
  assert.ok(receipt.mutations.every(({ outcome }) => new Set(["CONFIRMED", "CONFIRMED_BY_READ_ONLY_RECONCILIATION"]).has(outcome)));
  assert.equal(fs.statSync(receiptPath).mode & 0o777, 0o600);
  assert.equal(payload.result.mutationReceipt.path, fs.realpathSync(receiptPath));
  assert.deepEqual(mutatingCalls(fixture).map(({ method, endpoint }) => ({ method, endpoint })), [
    { method: "POST", endpoint: "repos/0xprogrammable/submit-launch/forks" },
    { method: "POST", endpoint: "repos/example-builder/submit-launch/git/trees" },
    { method: "POST", endpoint: "repos/example-builder/submit-launch/git/commits" },
    { method: "POST", endpoint: "repos/example-builder/submit-launch/git/refs" },
    { method: "POST", endpoint: "repos/0xprogrammable/submit-launch/pulls" }
  ]);
});

test("read-only receipt reconciliation never rewrites a receipt or retries an unknown object creation", (t) => {
  const fixture = createTransportFixture(t);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.forkRepository = {
    id: 666,
    full_name: "example-builder/submit-launch",
    html_url: "https://github.com/example-builder/submit-launch",
    private: false,
    fork: true,
    owner: state.viewer,
    parent: { id: state.centralRepository.id },
    permissions: { push: true, admin: true, maintain: true }
  };
  state.raceMode = "tree-response-loss";
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const command = ["open-world", "submit", fixture.packageRoot];
  const preview = run(command, fixture);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  const digest = JSON.parse(preview.stdout).result.confirmationDigest;
  const failed = run([...command, "--confirm-external-write", digest], fixture, { allowWrites: true });
  assert.equal(failed.status, 1, failed.stdout || failed.stderr);
  const receiptPath = path.join(fixture.root, "application-v3-mutation-receipt.json");
  const before = fs.readFileSync(receiptPath);
  fs.writeFileSync(fixture.callLog, "");

  const reconciled = run([
    ...command,
    "--mutation-receipt", receiptPath,
    "--resume"
  ], fixture);
  assert.equal(reconciled.status, 0, reconciled.stdout || reconciled.stderr);
  const result = JSON.parse(reconciled.stdout).result;
  assert.equal(result.action, "resume-reconciliation");
  assert.equal(result.reconciliation, "MAINTAINER_RECONCILIATION_REQUIRED");
  assert.equal(result.mutationLedger.at(-1).reconciliation.status, "OBJECT_ID_UNKNOWN");
  assert.deepEqual(fs.readFileSync(receiptPath), before);
  assert.equal(fs.existsSync(`${receiptPath}.lock`), false);
  assert.ok(allCalls(fixture).length > 0);
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
});

test("GET-only resume diagnoses a dynamically orphaned lock without changing the receipt or lock", (t) => {
  const fixture = createTransportFixture(t);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.forkRepository = {
    id: 666,
    full_name: "example-builder/submit-launch",
    html_url: "https://github.com/example-builder/submit-launch",
    private: false,
    fork: true,
    owner: state.viewer,
    parent: { id: state.centralRepository.id },
    permissions: { push: true, admin: true, maintain: true }
  };
  state.raceMode = "tree-response-loss";
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const command = ["open-world", "submit", fixture.packageRoot];
  const preview = run(command, fixture);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  const digest = JSON.parse(preview.stdout).result.confirmationDigest;
  const failed = run([...command, "--confirm-external-write", digest], fixture, { allowWrites: true });
  assert.equal(failed.status, 1, failed.stdout || failed.stderr);
  const receiptPath = path.join(fixture.root, "application-v3-mutation-receipt.json");
  const lockPath = `${receiptPath}.lock`;
  const orphan = childProcess.spawnSync(process.execPath, [
    "-e",
    "const fs=require('node:fs');const record={kind:'public-pr-application-v3-mutation-receipt-lock',pid:process.pid,token:'a'.repeat(64)};fs.writeFileSync(process.argv[1],JSON.stringify(record)+'\\n',{mode:0o600});",
    lockPath
  ], { encoding: "utf8", shell: false });
  assert.equal(orphan.status, 0, orphan.stderr);
  const ownerPid = JSON.parse(fs.readFileSync(lockPath, "utf8")).pid;
  const stableSnapshot = (filePath) => {
    const stat = fs.lstatSync(filePath, { bigint: true });
    return {
      bytes: fs.readFileSync(filePath),
      device: stat.dev.toString(),
      inode: stat.ino.toString(),
      mode: stat.mode.toString(),
      size: stat.size.toString(),
      modified: stat.mtimeNs.toString(),
      changed: stat.ctimeNs.toString()
    };
  };
  const receiptBefore = stableSnapshot(receiptPath);
  const lockBefore = stableSnapshot(lockPath);
  fs.writeFileSync(fixture.callLog, "");

  const reconciled = run([
    ...command,
    "--mutation-receipt", receiptPath,
    "--resume",
    "--dry-run"
  ], fixture);
  assert.equal(reconciled.status, 0, reconciled.stdout || reconciled.stderr);
  const result = JSON.parse(reconciled.stdout).result;
  const executionLock = result.mutationReceipt.executionLock;
  assert.equal(result.readOnly, true);
  assert.equal(result.writePerformed, false);
  assert.equal(executionLock.present, true);
  assert.equal(executionLock.inspection, "RECOGNIZED_LOCK_RECORD");
  assert.equal(executionLock.ownerPid, ownerPid);
  assert.equal(executionLock.ownerProcessObservation, "NO_SUCH_PROCESS_AT_INSPECTION");
  assert.equal(executionLock.staleAssessment, "POSSIBLY_STALE_OWNER_NOT_RUNNING");
  assert.equal(executionLock.automaticCleanupPerformed, false);
  assert.equal(executionLock.policy, "FAIL_CLOSED_NO_AUTOMATIC_REMOVAL");
  assert.match(executionLock.cleanupGuidance, /GET-only remote reconciliation.*maintainer remove/u);
  assert.deepEqual(stableSnapshot(receiptPath), receiptBefore);
  assert.deepEqual(stableSnapshot(lockPath), lockBefore);
  assert.ok(allCalls(fixture).length > 0);
  assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
});

test("a wrong resume digest cannot persist reconciliation or alter the receipt", (t) => {
  const fixture = createTransportFixture(t);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.forkRepository = {
    id: 666,
    full_name: "example-builder/submit-launch",
    html_url: "https://github.com/example-builder/submit-launch",
    private: false,
    fork: true,
    owner: state.viewer,
    parent: { id: state.centralRepository.id },
    permissions: { push: true, admin: true, maintain: true }
  };
  state.raceMode = "tree-response-loss";
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const command = ["open-world", "submit", fixture.packageRoot];
  const preview = run(command, fixture);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  const digest = JSON.parse(preview.stdout).result.confirmationDigest;
  const failed = run([...command, "--confirm-external-write", digest], fixture, { allowWrites: true });
  assert.equal(failed.status, 1, failed.stdout || failed.stderr);
  const receiptPath = path.join(fixture.root, "application-v3-mutation-receipt.json");
  const before = fs.readFileSync(receiptPath);
  const sequence = JSON.parse(before).sequence;
  fs.writeFileSync(fixture.callLog, "");

  const rejected = run([
    ...command,
    "--mutation-receipt", receiptPath,
    "--resume",
    "--confirm-external-write", `sha256:${"0".repeat(64)}`
  ], fixture, { allowWrites: true });
  assert.equal(rejected.status, 1, rejected.stdout || rejected.stderr);
  assert.equal(JSON.parse(rejected.stdout).error.code, "EXTERNAL_WRITE_CONFIRMATION_REQUIRED");
  assert.deepEqual(fs.readFileSync(receiptPath), before);
  assert.equal(JSON.parse(fs.readFileSync(receiptPath, "utf8")).sequence, sequence);
  assert.deepEqual(allCalls(fixture), []);
  assert.equal(fs.existsSync(`${receiptPath}.lock`), false);
});

test("a pre-existing or stale receipt lock fails closed without deletion or GitHub mutation", (t) => {
  const fixture = createTransportFixture(t);
  const command = ["open-world", "submit", fixture.packageRoot];
  const preview = run(command, fixture);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  const digest = JSON.parse(preview.stdout).result.confirmationDigest;
  const receiptPath = path.join(fixture.root, "locked-receipt.json");
  const lockPath = `${receiptPath}.lock`;
  const staleBytes = Buffer.from("stale lock retained for explicit owner reconciliation\n", "utf8");
  fs.writeFileSync(lockPath, staleBytes, { mode: 0o600 });
  fs.writeFileSync(fixture.callLog, "");

  const result = run([
    ...command,
    "--mutation-receipt", receiptPath,
    "--confirm-external-write", digest
  ], fixture, { allowWrites: true });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  const error = JSON.parse(result.stdout).error;
  assert.equal(error.code, "MUTATION_RECEIPT_LOCKED");
  assert.equal(error.details.staleLockPolicy, "FAIL_CLOSED_NO_AUTOMATIC_REMOVAL");
  assert.deepEqual(fs.readFileSync(lockPath), staleBytes);
  assert.equal(fs.existsSync(receiptPath), false);
  assert.deepEqual(allCalls(fixture), []);
});

test("concurrent confirmed processes have one exclusive receipt owner and one fail-closed loser", async (t) => {
  const fixture = createTransportFixture(t);
  const command = ["open-world", "submit", fixture.packageRoot];
  const preview = run(command, fixture);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  const digest = JSON.parse(preview.stdout).result.confirmationDigest;
  const receiptPath = path.join(fixture.root, "concurrent-receipt.json");
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.raceMode = "hold-receipt-lock-on-first-read";
  state.receiptLockUserReads = 0;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  fs.writeFileSync(fixture.callLog, "");
  const confirmedArguments = [
    ...command,
    "--mutation-receipt", receiptPath,
    "--confirm-external-write", digest
  ];

  const outcomes = await Promise.all([
    runAsync(confirmedArguments, fixture, { allowWrites: true }),
    runAsync(confirmedArguments, fixture, { allowWrites: true })
  ]);
  const successful = outcomes.filter(({ status }) => status === 0);
  const failed = outcomes.filter(({ status }) => status !== 0);
  assert.equal(successful.length, 1, outcomes.map(({ stdout, stderr }) => stdout || stderr).join("\n"));
  assert.equal(failed.length, 1, outcomes.map(({ stdout, stderr }) => stdout || stderr).join("\n"));
  assert.equal(JSON.parse(failed[0].stdout).error.code, "MUTATION_RECEIPT_LOCKED");
  assert.equal(JSON.parse(successful[0].stdout).result.mutationReceipt.state, "COMPLETE");
  assert.equal(JSON.parse(fs.readFileSync(receiptPath, "utf8")).state, "COMPLETE");
  assert.equal(fs.existsSync(`${receiptPath}.lock`), false);
  assert.equal(mutatingCalls(fixture).length, 5);
});

test("resume reconciles a persisted branch response and continues without replaying prior mutations", (t) => {
  const fixture = createTransportFixture(t);
  const command = ["open-world", "submit", fixture.packageRoot];
  const preview = run(command, fixture);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  const digest = JSON.parse(preview.stdout).result.confirmationDigest;
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.raceMode = "ref-readback-failure";
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const interrupted = run([...command, "--confirm-external-write", digest], fixture, { allowWrites: true });
  assert.equal(interrupted.status, 1, interrupted.stdout || interrupted.stderr);
  assert.equal(JSON.parse(interrupted.stdout).error.code, "PARTIAL_EXTERNAL_WRITE");
  const receiptPath = path.join(fixture.root, "application-v3-mutation-receipt.json");
  const interruptedReceipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  assert.equal(interruptedReceipt.mutations.at(-1).action, "create-application-branch");
  assert.equal(interruptedReceipt.mutations.at(-1).outcome, "RESPONSE_RECEIVED_PENDING_READBACK");

  const resumedState = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  resumedState.raceMode = null;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(resumedState)}\n`);
  fs.writeFileSync(fixture.callLog, "");
  const resumed = run([
    ...command,
    "--mutation-receipt", receiptPath,
    "--resume",
    "--confirm-external-write", digest
  ], fixture, { allowWrites: true });
  assert.equal(resumed.status, 0, resumed.stdout || resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).result.pullRequestNumber, 7);
  assert.deepEqual(mutatingCalls(fixture).map(({ method, endpoint }) => ({ method, endpoint })), [
    { method: "POST", endpoint: "repos/0xprogrammable/submit-launch/pulls" }
  ]);
  const completed = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  assert.equal(completed.state, "COMPLETE");
  assert.ok(completed.mutations.every(isConfirmedReceiptMutation));
});

test("confirmed submit fails partial-write closed when independent tree, commit, package, or final PR readback differs", (t) => {
  const cases = [
    ["created-tree-readback-tamper", "create-application-tree", "RESPONSE_RECEIVED_PENDING_READBACK"],
    ["created-tree-outside-scope-tamper", "create-application-tree", "RESPONSE_RECEIVED_PENDING_READBACK"],
    ["created-commit-readback-tamper", "create-application-commit", "RESPONSE_RECEIVED_PENDING_READBACK"],
    ["branch-package-readback-tamper", "create-application-branch", "CONFIRMED"],
    ["pull-final-readback-tamper", "open-draft-pull-request", "RESPONSE_RECEIVED_PENDING_READBACK"]
  ];
  for (const [raceMode, lastAttempt, expectedOutcome] of cases) {
    const fixture = createTransportFixture(t);
    const command = ["open-world", "submit", fixture.packageRoot];
    const preview = run(command, fixture);
    assert.equal(preview.status, 0, preview.stdout || preview.stderr);
    const digest = JSON.parse(preview.stdout).result.confirmationDigest;
    const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
    state.raceMode = raceMode;
    fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);

    const result = run([...command, "--confirm-external-write", digest], fixture, { allowWrites: true });
    assert.equal(result.status, 1, `${raceMode}: ${result.stdout || result.stderr}`);
    const error = JSON.parse(result.stdout).error;
    assert.equal(error.code, "PARTIAL_EXTERNAL_WRITE");
    assert.equal(error.details.causeCode, "GITHUB_WRITE_RESULT_INVALID");
    const finalMutation = error.details.mutationLedger.at(-1);
    assert.equal(finalMutation.action, lastAttempt);
    assert.equal(finalMutation.outcome, expectedOutcome, raceMode);
    assert.equal(error.details.writePerformed, true);
  }
});

test("confirmed submit reports a typed partial-write journal if the Registry base advances during fork creation", (t) => {
  const fixture = createTransportFixture(t);
  const command = ["open-world", "submit", fixture.packageRoot];
  const preview = run(command, fixture);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  const digest = JSON.parse(preview.stdout).result.confirmationDigest;
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.raceMode = "central-advance-on-fork";
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);

  const result = run([...command, "--confirm-external-write", digest], fixture, { allowWrites: true });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  const error = JSON.parse(result.stdout).error;
  assert.equal(error.code, "PARTIAL_EXTERNAL_WRITE");
  assert.equal(error.details.writePerformed, true);
  assert.equal(error.details.recoveryStatus, "MANUAL_RECONCILIATION_REQUIRED");
  assert.deepEqual(error.details.externalActionsPerformed, ["created-viewer-fork"]);
  assert.equal(error.details.identifiers.forkRepository, "example-builder/submit-launch");
  assert.equal(error.details.identifiers.treeObjectId, null);
  assert.equal(error.details.approvalGranted, false);
  assert.equal(error.details.launchAuthorizationGranted, false);
  assert.deepEqual(mutatingCalls(fixture).map(({ endpoint }) => endpoint), [
    "repos/0xprogrammable/submit-launch/forks"
  ]);
});

test("confirmed submit journals fork, tree, and commit if the branch races before ref creation", (t) => {
  const fixture = createTransportFixture(t);
  const command = ["open-world", "submit", fixture.packageRoot];
  const preview = run(command, fixture);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  const digest = JSON.parse(preview.stdout).result.confirmationDigest;
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.raceMode = "branch-after-commit";
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);

  const result = run([...command, "--confirm-external-write", digest], fixture, { allowWrites: true });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  const error = JSON.parse(result.stdout).error;
  assert.equal(error.code, "PARTIAL_EXTERNAL_WRITE");
  assert.equal(error.details.causeCode, "APPLICATION_BRANCH_CHANGED");
  assert.deepEqual(error.details.externalActionsPerformed, [
    "created-viewer-fork",
    "created-application-tree",
    "created-application-commit"
  ]);
  assert.equal(error.details.identifiers.treeObjectId, "6".repeat(40));
  assert.equal(error.details.identifiers.commitObjectId, "7".repeat(40));
  assert.equal(error.details.identifiers.pullRequestNumber, null);
  assert.equal(error.details.writePerformed, true);
  assert.deepEqual(mutatingCalls(fixture).map(({ endpoint }) => endpoint), [
    "repos/0xprogrammable/submit-launch/forks",
    "repos/example-builder/submit-launch/git/trees",
    "repos/example-builder/submit-launch/git/commits"
  ]);
});

test("persisted Git tree with a lost response is reported as outcome-unknown with exact read-only recovery", (t) => {
  const fixture = createTransportFixture(t);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.forkRepository = {
    id: 666,
    full_name: "example-builder/submit-launch",
    html_url: "https://github.com/example-builder/submit-launch",
    private: false,
    fork: true,
    owner: state.viewer,
    parent: { id: state.centralRepository.id },
    permissions: { push: true, admin: true, maintain: true }
  };
  state.raceMode = "tree-response-loss";
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const command = ["open-world", "submit", fixture.packageRoot];
  const preview = run(command, fixture);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  const digest = JSON.parse(preview.stdout).result.confirmationDigest;

  const result = run([...command, "--confirm-external-write", digest], fixture, { allowWrites: true });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  const error = JSON.parse(result.stdout).error;
  assert.equal(error.code, "PARTIAL_EXTERNAL_WRITE");
  assert.deepEqual(error.details.externalActionsPerformed, []);
  assert.deepEqual(error.details.externalActionsAttempted, ["create-application-tree"]);
  assert.equal(error.details.mutationLedger.length, 1);
  assert.equal(error.details.mutationLedger[0].attempt, "ATTEMPTED");
  assert.equal(error.details.mutationLedger[0].outcome, "OUTCOME_UNKNOWN");
  assert.equal(error.details.mutationLedger[0].target.repository, "example-builder/submit-launch");
  assert.match(error.details.mutationLedger[0].requestSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(error.details.mutationLedger[0].safeInspectionSteps.some((step) => step.includes("do not repeat the POST")));
  assert.ok(error.details.recoveryInstructions.some((step) => step.includes("Do not retry")));
  assert.equal(result.stdout.includes("Exact public proposal"), false);
  assert.deepEqual(mutatingCalls(fixture).map(({ endpoint }) => endpoint), [
    "repos/example-builder/submit-launch/git/trees"
  ]);
});

test("lost draft-PR response is reconciled by exact head and body without a duplicate POST", (t) => {
  const fixture = createTransportFixture(t);
  const command = ["open-world", "submit", fixture.packageRoot];
  const preview = run(command, fixture);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  const digest = JSON.parse(preview.stdout).result.confirmationDigest;
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.raceMode = "pull-response-loss";
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);

  const result = run([...command, "--confirm-external-write", digest], fixture, { allowWrites: true });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout).result;
  assert.equal(payload.pullRequestNumber, 7);
  const pullEntry = payload.mutationLedger.at(-1);
  assert.equal(pullEntry.action, "open-draft-pull-request");
  assert.equal(pullEntry.outcome, "CONFIRMED_BY_READ_ONLY_RECONCILIATION");
  assert.equal(pullEntry.reconciliation.status, "MATCHED_EXACT_TARGET");
  assert.equal(pullEntry.identifiers.pullRequestNumber, 7);
  assert.equal(mutatingCalls(fixture).filter(({ endpoint }) => endpoint.endsWith("/pulls")).length, 1);
});

test("update rereads the exact open draft before ref mutation and stops on close", (t) => {
  const fixture = createTransportFixture(t, { mode: "update" });
  const command = ["open-world", "update", fixture.packageRoot, "--pull-request", "7"];
  const preview = run(command, fixture);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  const digest = JSON.parse(preview.stdout).result.confirmationDigest;
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.raceMode = "update-pr-close-after-commit";
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);

  const result = run([...command, "--confirm-external-write", digest], fixture, { allowWrites: true });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  const error = JSON.parse(result.stdout).error;
  assert.equal(error.code, "PARTIAL_EXTERNAL_WRITE");
  assert.equal(error.details.causeCode, "APPLICATION_PULL_REQUEST_MISMATCH");
  assert.deepEqual(error.details.externalActionsPerformed, [
    "created-application-tree",
    "created-application-commit"
  ]);
  assert.deepEqual(error.details.externalActionsAttempted, [
    "create-application-tree",
    "create-application-commit"
  ]);
  assert.deepEqual(mutatingCalls(fixture).map(({ endpoint }) => endpoint), [
    "repos/example-builder/submit-launch/git/trees",
    "repos/example-builder/submit-launch/git/commits"
  ]);
});

test("open-world update plans one immutable next revision without mutating GitHub", (t) => {
  const fixture = createTransportFixture(t, { mode: "update" });
  const result = run([
    "open-world",
    "update",
    fixture.packageRoot,
    "--pull-request",
    "7"
  ], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.result.action, "update-plan");
  assert.equal(payload.result.applicationRevision, fixture.applicationRevision);
  assert.equal(payload.result.target.directory, `submissions/legacy-open-world-example/v3/revisions/${fixture.applicationRevision}`);
  assert.equal(payload.result.target.pullRequestNumber, 7);
  assert.deepEqual(payload.result.externalWrites, [
    "create-application-tree",
    "create-application-commit",
    "fast-forward-application-branch",
    "update-draft-pull-request-metadata"
  ]);
  assert.equal(payload.result.readOnly, true);
  assert.deepEqual(payload.result.externalActionsPerformed, []);
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("open-world status verifies the exact immutable revision and remains GitHub-read-only", (t) => {
  const fixture = createTransportFixture(t, { mode: "status" });
  const result = run([
    "open-world",
    "status",
    fixture.packageRoot,
    "--pull-request",
    "7"
  ], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.result.action, "status");
  assert.equal(payload.result.readOnly, true);
  assert.equal(payload.result.writePerformed, false);
  assert.equal(payload.result.networkAccessed, true);
  assert.equal(payload.result.package.matchesRemote, true);
  assert.equal(payload.result.status.transport, "submitted");
  assert.equal(payload.result.status.integrity, "matched");
  assert.equal(payload.result.status.independentReview, "required");
  assert.equal(payload.result.status.runtime, "unknown-not-verified");
  assert.equal(payload.result.status.availability, "unknown-not-verified");
  assert.equal(payload.result.approvalGranted, false);
  assert.equal(payload.result.launchAuthorizationGranted, false);
  assert.deepEqual(payload.result.externalActionsPerformed, []);
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("open-world status returns typed Application V3 guidance for a Submission V2 package", () => {
  const packageRoot = path.join(skillRoot, "assets", "templates", "open-world-v2", "new-idea");
  const result = childProcess.spawnSync(process.execPath, [
    cli,
    "open-world",
    "status",
    packageRoot,
    "--pull-request",
    "62"
  ], {
    cwd: skillRoot,
    encoding: "utf8",
    shell: false,
    timeout: 30_000,
    maxBuffer: 16_000_000
  });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "APPLICATION_V3_ROOT_MISSING");
  assert.match(payload.error.message, /Submission V2.*not an Application V3 status package/iu);
  assert.equal(payload.error.details.expectedFile, "application.v3.json");
  assert.match(payload.error.details.validationCommand, /validate-application/iu);
  assert.equal(payload.error.details.writePerformed, false);
});

test("open-world status projects an exact closed and merged pull as review-record-merged", (t) => {
  const fixture = createTransportFixture(t, { mode: "status" });
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.pull.state = "closed";
  state.pull.draft = false;
  state.pull.merged_at = "2026-08-03T12:00:00Z";
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const result = run([
    "open-world",
    "status",
    fixture.packageRoot,
    "--pull-request",
    "7"
  ], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout).result;
  assert.equal(payload.status.transport, "review-record-merged");
  assert.equal(payload.readOnly, true);
  assert.equal(payload.writePerformed, false);
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("open-world status reports remote byte tampering without writing or inventing approval", (t) => {
  const fixture = createTransportFixture(t, { mode: "status" });
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  const applicationPath = Object.keys(state.contents).find((filePath) => filePath.endsWith("/application.v3.json"));
  state.contents[applicationPath] = Buffer.from("{}\n", "utf8").toString("base64");
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);

  const result = run([
    "open-world",
    "status",
    fixture.packageRoot,
    "--pull-request",
    "7"
  ], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.result.package.matchesRemote, false);
  assert.equal(payload.result.status.integrity, "mismatch");
  assert.equal(payload.result.approvalGranted, false);
  assert.equal(payload.result.launchAuthorizationGranted, false);
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("open-world status rejects modified or extra paths in an immutable revision", (t) => {
  for (const mutation of ["modified", "extra"]) {
    const fixture = createTransportFixture(t, { mode: "status" });
    const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
    if (mutation === "modified") {
      state.pullFiles[0].status = "modified";
    } else {
      const prefix = `submissions/legacy-open-world-example/v3/revisions/${fixture.applicationRevision}`;
      state.pullFiles.push({ filename: `${prefix}/unbound-extra.json`, status: "added", sha: "5".repeat(40) });
      state.pull.changed_files = state.pullFiles.length;
    }
    fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
    const result = run([
      "open-world",
      "status",
      fixture.packageRoot,
      "--pull-request",
      "7"
    ], fixture);
    assert.equal(result.status, 1, `${mutation}: ${result.stdout || result.stderr}`);
    assert.equal(JSON.parse(result.stdout).error.code, "APPLICATION_PULL_REQUEST_PATHS_INVALID");
    assert.deepEqual(mutatingCalls(fixture), []);
  }
});

test("open-world update requires the exact verified prior-history path set", (t) => {
  const fixture = createTransportFixture(t, { mode: "update" });
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.pullFiles.push({
    filename: "submissions/legacy-open-world-example/v3/revisions/2/unbound-extra.json",
    status: "added",
    sha: "5".repeat(40)
  });
  state.pull.changed_files = state.pullFiles.length;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  const result = run([
    "open-world",
    "update",
    fixture.packageRoot,
    "--pull-request",
    "7"
  ], fixture);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, "APPLICATION_PULL_REQUEST_PATHS_INVALID");
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("multi-revision V3-new history cannot detach from a full or orphaned V2 base namespace", (t) => {
  for (const [command, mode] of [
    ["submit", "merged-prior-submit"],
    ["update", "update"],
    ["status", "update"]
  ]) {
    const fixture = createTransportFixture(t, { mode });
    const application = readFixtureApplication(fixture);
    assert.equal(String(application.applicationRevision), "2");
    const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
    state.centralContents[`submissions/${application.applicationId}/application.json`] = Buffer.from("{}\n", "utf8").toString("base64");
    fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
    const result = run(command === "submit"
      ? ["open-world", command, fixture.packageRoot]
      : ["open-world", command, fixture.packageRoot, "--pull-request", "7"], fixture);
    assert.equal(result.status, 1, `${command}: ${result.stdout || result.stderr}`);
    assert.equal(JSON.parse(result.stdout).error.code, "APPLICATION_LEGACY_LINEAGE_REQUIRED", command);
    assert.ok(allCalls(fixture).every(({ method }) => method === "GET"));
    assert.deepEqual(mutatingCalls(fixture), []);
  }
});

test("every prior Application V3 lineage field is recomputed from the immutable predecessor", (t) => {
  const mutations = new Map([
    ["applicationContract", "public-pr-application-v2"],
    ["applicationSchemaVersion", 4],
    ["applicationRevision", "9"],
    ["applicationSha256", `sha256:${"91".repeat(32)}`],
    ["packageSha256", `sha256:${"92".repeat(32)}`],
    ["sourceNumericRepositoryId", "123"],
    ["sourceCommit", "8".repeat(40)],
    ["sourceTree", "7".repeat(40)],
    ["submissionSchemaId", "urn:programmable:v4-hook-submission:2.0.1"],
    ["submissionStandard", "2.0.1"],
    ["submissionPath", "other/submission.v2.json"],
    ["submissionSha256", `sha256:${"93".repeat(32)}`],
    ["feePolicyId", "different-fee-policy"],
    ["feePolicyVersion", "2.0.1"],
    ["feeApplicability", "not-applicable"],
    ["feePolicyInstanceSha256", `sha256:${"94".repeat(32)}`]
  ]);
  for (const [field, value] of mutations) {
    const fixture = createTransportFixture(t, { mode: "update" });
    const applicationPath = path.join(fixture.packageRoot, "application.v3.json");
    const application = JSON.parse(fs.readFileSync(applicationPath, "utf8"));
    application.lineage.previous[field] = value;
    fs.writeFileSync(applicationPath, `${canonicalJson(application)}\n`);
    const result = run([
      "open-world",
      "update",
      fixture.packageRoot,
      "--pull-request",
      "7"
    ], fixture);
    assert.equal(result.status, 1, `${field}: ${result.stdout || result.stderr}`);
    const code = JSON.parse(result.stdout).error.code;
    assert.ok(new Set([
      "APPLICATION_V3_UPDATE_LINEAGE_INVALID",
      "APPLICATION_V3_UPDATE_LINEAGE_MISMATCH",
      "APPLICATION_V3_PACKAGE_INVALID"
    ]).has(code), `${field}: ${code}`);
    if (new Set([
      "sourceCommit",
      "sourceTree",
      "sourceNumericRepositoryId",
      "submissionSha256",
      "feeApplicability",
      "feePolicyInstanceSha256"
    ]).has(field)) {
      assert.equal(code, "APPLICATION_V3_UPDATE_LINEAGE_MISMATCH", field);
    }
    assert.deepEqual(mutatingCalls(fixture), [], field);
  }
});

test("update independently rejects a fake same-source lineage label and normative mutation", (t) => {
  for (const mutation of ["source-update-label", "summary"]) {
    const fixture = createTransportFixture(t, { mode: "update" });
    const applicationPath = path.join(fixture.packageRoot, "application.v3.json");
    const application = JSON.parse(fs.readFileSync(applicationPath, "utf8"));
    if (mutation === "source-update-label") application.lineage.kind = "source-update";
    else application.summary = `${application.summary} Unauthorized same-source normative change.`;
    fs.writeFileSync(applicationPath, `${canonicalJson(application)}\n`);
    const result = run([
      "open-world", "update", fixture.packageRoot,
      "--pull-request", "7"
    ], fixture);
    assert.equal(result.status, 1, `${mutation}: ${result.stdout || result.stderr}`);
    assert.ok(new Set([
      "APPLICATION_V3_PACKAGE_INVALID",
      "APPLICATION_V3_UPDATE_LINEAGE_INVALID",
      "APPLICATION_V3_UPDATE_LINEAGE_MISMATCH"
    ]).has(JSON.parse(result.stdout).error.code), mutation);
    assert.deepEqual(mutatingCalls(fixture), []);
  }
});

test("a new submit after a merged prior revision plans only the next immutable directory", (t) => {
  const fixture = createTransportFixture(t, { mode: "merged-prior-submit" });
  const result = run(["open-world", "submit", fixture.packageRoot], fixture);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout).result;
  assert.equal(payload.action, "submit-plan");
  assert.equal(payload.applicationRevision, "2");
  assert.ok(payload.package.files.every(({ path: filePath }) => filePath.includes("/v3/revisions/2/")));
  assert.ok(payload.package.files.every(({ path: filePath }) => !filePath.includes("/v3/revisions/1/")));
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("merged prior history is excluded from the current diff and update routes to a new thread", (t) => {
  const fixture = createTransportFixture(t, { mode: "merged-prior" });
  const status = run([
    "open-world",
    "status",
    fixture.packageRoot,
    "--pull-request",
    "7"
  ], fixture);
  assert.equal(status.status, 0, status.stdout || status.stderr);
  assert.equal(JSON.parse(status.stdout).result.package.matchesRemote, true);

  const update = run([
    "open-world",
    "update",
    fixture.packageRoot,
    "--pull-request",
    "7"
  ], fixture);
  assert.equal(update.status, 1, update.stdout || update.stderr);
  const error = JSON.parse(update.stdout).error;
  assert.equal(error.code, "APPLICATION_GITHUB_TRANSPORT_INTEGRATION_PENDING");
  assert.equal(error.details.route, "INTEGRATION_PENDING");
  assert.equal(error.details.writePerformed, false);
  assert.match(error.message, /start a new review branch/iu);
  assert.deepEqual(mutatingCalls(fixture), []);
});

test("GitHub raw-content verification accepts 700000 bytes and holds 700001 without network", (t) => {
  const exact = createTransportFixture(t, { proposalByteLength: 700_000 });
  const accepted = run(["open-world", "submit", exact.packageRoot], exact);
  assert.equal(accepted.status, 0, accepted.stdout || accepted.stderr);
  assert.ok(JSON.parse(accepted.stdout).result.package.files.some(({ byteLength }) => byteLength === 700_000));
  assert.deepEqual(mutatingCalls(exact), []);

  const over = createTransportFixture(t, { proposalByteLength: 700_001 });
  const held = run(["open-world", "submit", over.packageRoot], over);
  assert.equal(held.status, 1, held.stdout || held.stderr);
  const error = JSON.parse(held.stdout).error;
  assert.equal(error.code, "APPLICATION_GITHUB_SPLIT_REVIEW_REQUIRED", held.stdout);
  assert.equal(error.details.status, "HOLD_SPLIT_REVIEW");
  assert.equal(error.details.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.equal(error.details.writePerformed, false);
  assert.equal(fs.existsSync(over.callLog), false);
});

test("Git tree request accepts exactly 1000000 bytes and holds 1000001 before network", (t) => {
  const exact = createTransportFixture(t, { treeRequestByteLength: 1_000_000 });
  assert.equal(measureFixtureTreeRequest(exact.packageRoot), 1_000_000);
  const accepted = run(["open-world", "submit", exact.packageRoot], exact);
  assert.equal(accepted.status, 0, accepted.stdout || accepted.stderr);
  assert.deepEqual(mutatingCalls(exact), []);

  const over = createTransportFixture(t, { treeRequestByteLength: 1_000_001 });
  assert.equal(measureFixtureTreeRequest(over.packageRoot), 1_000_001);
  const held = run(["open-world", "submit", over.packageRoot], over);
  assert.equal(held.status, 1, held.stdout || held.stderr);
  const error = JSON.parse(held.stdout).error;
  assert.equal(error.code, "APPLICATION_GITHUB_SPLIT_REVIEW_REQUIRED");
  assert.equal(error.details.status, "HOLD_SPLIT_REVIEW");
  assert.equal(error.details.route, "INTEGRATION_PENDING");
  assert.equal(error.details.writePerformed, false);
  assert.equal(fs.existsSync(over.callLog), false);
});

test("pull inspection paginates from 100 through 101 and holds only above GitHub's 3000-file endpoint ceiling", (t) => {
  const exact = createTransportFixture(t, { mode: "status" });
  const exactState = JSON.parse(fs.readFileSync(exact.statePath, "utf8"));
  while (exactState.pullFiles.length < 100) {
    exactState.pullFiles.push({
      filename: `submissions/legacy-open-world-example/v3/revisions/2/extra-${String(exactState.pullFiles.length).padStart(3, "0")}.json`,
      status: "added",
      sha: "5".repeat(40)
    });
  }
  exactState.pullFiles.sort(comparePullFileNames);
  exactState.pull.changed_files = 100;
  fs.writeFileSync(exact.statePath, `${canonicalJson(exactState)}\n`);
  const acceptedBoundary = run(["open-world", "status", exact.packageRoot, "--pull-request", "7"], exact);
  assert.equal(acceptedBoundary.status, 1, acceptedBoundary.stdout || acceptedBoundary.stderr);
  assert.equal(JSON.parse(acceptedBoundary.stdout).error.code, "APPLICATION_PULL_REQUEST_PATHS_INVALID");
  assert.deepEqual(mutatingCalls(exact), []);

  const paginated = createTransportFixture(t, { mode: "status" });
  const paginatedState = JSON.parse(fs.readFileSync(paginated.statePath, "utf8"));
  while (paginatedState.pullFiles.length < 101) {
    paginatedState.pullFiles.push({
      filename: `submissions/legacy-open-world-example/v3/revisions/2/extra-${String(paginatedState.pullFiles.length).padStart(3, "0")}.json`,
      status: "added",
      sha: "5".repeat(40)
    });
  }
  paginatedState.pullFiles.sort(comparePullFileNames);
  paginatedState.pull.changed_files = 101;
  fs.writeFileSync(paginated.statePath, `${canonicalJson(paginatedState)}\n`);
  const paginatedResult = run(["open-world", "status", paginated.packageRoot, "--pull-request", "7"], paginated);
  assert.equal(paginatedResult.status, 1, paginatedResult.stdout || paginatedResult.stderr);
  assert.equal(JSON.parse(paginatedResult.stdout).error.code, "APPLICATION_PULL_REQUEST_PATHS_INVALID");
  assert.equal(allCalls(paginated).filter(({ endpoint }) => endpoint.includes("/pulls/7/files?")).length, 2);
  assert.deepEqual(mutatingCalls(paginated), []);

  const ceiling = createTransportFixture(t, { mode: "status" });
  const ceilingState = JSON.parse(fs.readFileSync(ceiling.statePath, "utf8"));
  while (ceilingState.pullFiles.length < 3000) {
    ceilingState.pullFiles.push({
      filename: `submissions/legacy-open-world-example/v3/revisions/2/ceiling-${String(ceilingState.pullFiles.length).padStart(4, "0")}.json`,
      status: "added",
      sha: "5".repeat(40)
    });
  }
  ceilingState.pullFiles.sort(comparePullFileNames);
  ceilingState.pull.changed_files = 3000;
  fs.writeFileSync(ceiling.statePath, `${canonicalJson(ceilingState)}\n`);
  const ceilingResult = run(["open-world", "status", ceiling.packageRoot, "--pull-request", "7"], ceiling);
  assert.equal(ceilingResult.status, 1, ceilingResult.stdout || ceilingResult.stderr);
  assert.equal(JSON.parse(ceilingResult.stdout).error.code, "APPLICATION_PULL_REQUEST_PATHS_INVALID");
  assert.equal(allCalls(ceiling).filter(({ endpoint }) => endpoint.includes("/pulls/7/files?")).length, 30);

  const over = createTransportFixture(t, { mode: "status" });
  const overState = JSON.parse(fs.readFileSync(over.statePath, "utf8"));
  overState.pull.changed_files = 3001;
  fs.writeFileSync(over.statePath, `${canonicalJson(overState)}\n`);
  const held = run(["open-world", "status", over.packageRoot, "--pull-request", "7"], over);
  assert.equal(held.status, 1, held.stdout || held.stderr);
  const error = JSON.parse(held.stdout).error;
  assert.equal(error.code, "APPLICATION_GITHUB_SPLIT_REVIEW_REQUIRED");
  assert.equal(error.details.status, "HOLD_SPLIT_REVIEW");
  assert.equal(error.details.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.deepEqual(mutatingCalls(over), []);
});

test("pull-file pagination fails closed on short pages, duplicates, and aggregate metadata over-budget", (t) => {
  for (const paginationMode of ["short-first-page", "duplicate-second-page"]) {
    const fixture = createTransportFixture(t, { mode: "status" });
    const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
    while (state.pullFiles.length < 101) {
      state.pullFiles.push({
        filename: `submissions/legacy-open-world-example/v3/revisions/2/page-${String(state.pullFiles.length).padStart(3, "0")}.json`,
        status: "added",
        sha: "5".repeat(40)
      });
    }
    state.pullFiles.sort(comparePullFileNames);
    state.pull.changed_files = 101;
    state.paginationMode = paginationMode;
    fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
    const result = run(["open-world", "status", fixture.packageRoot, "--pull-request", "7"], fixture);
    assert.equal(result.status, 1, `${paginationMode}: ${result.stdout || result.stderr}`);
    assert.equal(JSON.parse(result.stdout).error.code, "GITHUB_PULL_FILES_CHANGED");
    assert.deepEqual(mutatingCalls(fixture), []);
  }

  const metadata = createTransportFixture(t, { mode: "status" });
  const metadataState = JSON.parse(fs.readFileSync(metadata.statePath, "utf8"));
  metadataState.pullFiles = Array.from({ length: 1001 }, (_, index) => ({
    filename: `${"x".repeat(5_000)}-${String(index).padStart(4, "0")}`,
    status: "added",
    sha: "5".repeat(40)
  }));
  metadataState.pull.changed_files = metadataState.pullFiles.length;
  fs.writeFileSync(metadata.statePath, `${canonicalJson(metadataState)}\n`);
  const held = run(["open-world", "status", metadata.packageRoot, "--pull-request", "7"], metadata);
  assert.equal(held.status, 1, held.stdout || held.stderr);
  const error = JSON.parse(held.stdout).error;
  assert.equal(error.code, "APPLICATION_GITHUB_SPLIT_REVIEW_REQUIRED", `${held.stdout}\n${canonicalJson(allCalls(metadata).slice(-3))}`);
  assert.equal(error.details.status, "HOLD_SPLIT_REVIEW");
  assert.equal(error.details.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.deepEqual(mutatingCalls(metadata), []);
});

test("pull-file pagination accepts unsorted GitHub pages but rejects exact head drift", (t) => {
  const unsorted = createTransportFixture(t, { mode: "status" });
  const unsortedState = JSON.parse(fs.readFileSync(unsorted.statePath, "utf8"));
  while (unsortedState.pullFiles.length < 101) {
    unsortedState.pullFiles.push({
      filename: `submissions/legacy-open-world-example/v3/revisions/2/unsorted-${String(unsortedState.pullFiles.length).padStart(3, "0")}.json`,
      status: "added",
      sha: "5".repeat(40)
    });
  }
  unsortedState.pullFiles.sort(comparePullFileNames);
  unsortedState.pull.changed_files = 101;
  unsortedState.paginationMode = "reverse-each-page";
  fs.writeFileSync(unsorted.statePath, `${canonicalJson(unsortedState)}\n`);
  const accepted = run(["open-world", "status", unsorted.packageRoot, "--pull-request", "7"], unsorted);
  assert.equal(accepted.status, 1, accepted.stdout || accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).error.code, "APPLICATION_PULL_REQUEST_PATHS_INVALID");

  const drift = createTransportFixture(t, { mode: "status" });
  const driftState = JSON.parse(fs.readFileSync(drift.statePath, "utf8"));
  driftState.paginationMode = "head-drift-after-first-page";
  fs.writeFileSync(drift.statePath, `${canonicalJson(driftState)}\n`);
  const rejected = run(["open-world", "status", drift.packageRoot, "--pull-request", "7"], drift);
  assert.equal(rejected.status, 1, rejected.stdout || rejected.stderr);
  assert.equal(JSON.parse(rejected.stdout).error.code, "GITHUB_PULL_REQUEST_CHANGED");
  assert.deepEqual(mutatingCalls(drift), []);
});

test("shared V2/V3 GitHub path transport accepts the former 1024-character boundary and plus one", async () => {
  const observed = [];
  const transport = createGhTransport({
    runner: async ({ args }) => {
      observed.push(args.at(-1));
      return { status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
    }
  });
  for (const length of [1_024, 1_025]) {
    const repositoryPath = `a/${"b".repeat(length - 2)}`;
    assert.equal(await transport.getContent("owner/repository", repositoryPath, "1".repeat(40), { allowNotFound: true }), null);
  }
  assert.equal(observed.length, 2);
});

test("GitHub GET transport retries are bounded, Retry-After aware, typed, and never applied to mutations", async (t) => {
  await t.test("transient reads retry with bounded exponential backoff", async () => {
    let attempts = 0;
    const waits = [];
    const transport = createGhTransport({
      runner: async () => {
        attempts += 1;
        return attempts < 3
          ? { status: 1, stdout: "", stderr: "HTTP 503 Service Unavailable" }
          : { status: 0, stdout: '{"id":101,"login":"builder"}', stderr: "" };
      },
      sleep: async (milliseconds) => { waits.push(milliseconds); }
    });
    assert.deepEqual(await transport.getViewer(), { id: 101, login: "builder" });
    assert.equal(attempts, 3);
    assert.deepEqual(waits, [100, 200]);
  });

  await t.test("Retry-After is honored inside the closed wait budget", async () => {
    let attempts = 0;
    const waits = [];
    const transport = createGhTransport({
      runner: async () => {
        attempts += 1;
        return attempts === 1
          ? {
              status: 1,
              stdout: 'HTTP/2 429\r\nretry-after: 1\r\nx-ratelimit-remaining: 0\r\nx-ratelimit-resource: core\r\n\r\n{"message":"slow down"}',
              stderr: "HTTP 429 Too Many Requests"
            }
          : { status: 0, stdout: '{"id":101,"login":"builder"}', stderr: "" };
      },
      sleep: async (milliseconds) => { waits.push(milliseconds); },
      now: () => 0
    });
    await transport.getViewer();
    assert.equal(attempts, 2);
    assert.deepEqual(waits, [1_000]);
  });

  await t.test("an oversized rate-limit wait fails typed without sleeping or retrying", async () => {
    let attempts = 0;
    const waits = [];
    const transport = createGhTransport({
      runner: async () => {
        attempts += 1;
        return {
          status: 1,
          stdout: 'HTTP/2 429\r\nretry-after: 60\r\nx-ratelimit-remaining: 0\r\n\r\n{}',
          stderr: "HTTP 429 Too Many Requests"
        };
      },
      sleep: async (milliseconds) => { waits.push(milliseconds); },
      now: () => 0
    });
    await assert.rejects(
      () => transport.getViewer(),
      (error) => error?.code === "GITHUB_RATE_LIMITED"
        && error.details?.attempts === 1
        && error.details?.retryAfterSeconds === 60
    );
    assert.equal(attempts, 1);
    assert.deepEqual(waits, []);
  });

  await t.test("exhausted GETs are typed while POST is attempted exactly once", async () => {
    let getAttempts = 0;
    const waits = [];
    const readTransport = createGhTransport({
      runner: async () => {
        getAttempts += 1;
        return { status: 1, stdout: "", stderr: "HTTP 503 Service Unavailable" };
      },
      sleep: async (milliseconds) => { waits.push(milliseconds); }
    });
    await assert.rejects(
      () => readTransport.getViewer(),
      (error) => error?.code === "GITHUB_GET_RETRY_EXHAUSTED"
        && error.details?.attempts === 3
        && error.details?.requestMethod === "GET"
    );
    assert.equal(getAttempts, 3);
    assert.deepEqual(waits, [100, 200]);

    let mutationAttempts = 0;
    const writeTransport = createGhTransport({
      runner: async () => {
        mutationAttempts += 1;
        return { status: 1, stdout: "", stderr: "HTTP 503 Service Unavailable" };
      },
      sleep: async () => { assert.fail("a mutation must never enter GET retry backoff"); }
    });
    await assert.rejects(
      () => writeTransport.createFork("0xprogrammable/submit-launch"),
      (error) => error?.code === "GITHUB_REQUEST_FAILED"
        && error.details?.attempts === 1
        && error.details?.requestMethod === "POST"
    );
    assert.equal(mutationAttempts, 1);
  });
});

function createTransportFixture(t, {
  mode = "submit",
  sentinel = null,
  proposalByteLength = null,
  treeRequestByteLength = null,
  applicationRevision = null,
  unmaterializedProposal = false,
  manifestSource = false
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-open-world-github-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const priorRoot = path.join(root, "prior-application-package");
  fs.mkdirSync(priorRoot);
  const priorApplication = unmaterializedProposal
    ? createUnmaterializedProposalPackage(priorRoot, { sentinel })
    : createApplicationPackage(priorRoot, { sentinel, manifestSource });
  if (applicationRevision !== null) {
    priorApplication.applicationRevision = applicationRevision;
    priorApplication.lineage = applicationRevision === "1"
      ? { kind: "new", previous: null }
      : priorApplication.lineage;
    writeApplicationPackage(priorRoot, priorApplication, { sentinel, proposalByteLength });
  } else if (proposalByteLength !== null) {
    writeApplicationPackage(priorRoot, priorApplication, { sentinel, proposalByteLength });
  }
  if (treeRequestByteLength !== null) {
    tuneFixtureTreeRequest(priorRoot, priorApplication, treeRequestByteLength);
  }
  const priorProjection = projectFixturePackage(priorRoot, priorApplication);
  let packageRoot = priorRoot;
  let application = priorApplication;
  const hasNextRevision = new Set(["update", "merged-prior", "merged-prior-submit"]).has(mode);
  const hasPull = new Set(["update", "status", "merged-prior"]).has(mode);
  const priorIsMerged = new Set(["merged-prior", "merged-prior-submit"]).has(mode);
  if (hasNextRevision) {
    packageRoot = path.join(root, "next-application-package");
    fs.mkdirSync(packageRoot);
    application = structuredClone(priorApplication);
    application.source.primary.githubActionsRunIds = ["987654321"];
    const nextRevision = (BigInt(String(priorApplication.applicationRevision)) + 1n).toString();
    application.applicationRevision = typeof priorApplication.applicationRevision === "number"
      ? Number(nextRevision)
      : nextRevision;
    application.lineage = {
      kind: "recheck",
      previous: {
        ...application.lineage.previous,
        applicationContract: "public-pr-application-v3",
        applicationSchemaVersion: 3,
        applicationRevision: priorApplication.applicationRevision,
        applicationSha256: priorProjection.applicationSha256,
        packageSha256: priorProjection.packageSha256,
        sourceNumericRepositoryId: priorApplication.source.primary.numericRepositoryId,
        sourceCommit: priorApplication.source.primary.revisionObjectId,
        sourceTree: priorApplication.source.primary.treeObjectId,
        submissionSchemaId: "urn:programmable:v4-hook-submission:2.0.0",
        submissionStandard: "2.0.0",
        submissionPath: priorApplication.policyBindings.submissionPath,
        submissionSha256: priorApplication.policyBindings.submissionSha256,
        feePolicyId: priorApplication.policyBindings.programmableFeePolicyId,
        feePolicyVersion: priorApplication.policyBindings.programmableFeePolicyVersion,
        feeApplicability: priorApplication.policyBindings.feeApplicability,
        feePolicyInstanceSha256: priorApplication.policyBindings.feePolicyInstanceSha256
      }
    };
    writeApplicationPackage(packageRoot, application);
  }
  const projection = projectFixturePackage(packageRoot, application);
  const fakeBin = path.join(root, "bin");
  const callLog = path.join(root, "gh-calls.jsonl");
  const statePath = path.join(root, "github-state.json");
  fs.mkdirSync(fakeBin);
  const viewer = { id: Number(application.builder.githubUserId), login: application.builder.githubLogin };
  const centralRepository = {
    id: 1320171831,
    full_name: "0xprogrammable/submit-launch",
    html_url: "https://github.com/0xprogrammable/submit-launch",
    private: false,
    fork: false,
    owner: { id: 777, login: "0xprogrammable" },
    permissions: { push: false, admin: false, maintain: false }
  };
  const forkRepository = hasPull ? {
    id: 666,
    full_name: "example-builder/submit-launch",
    html_url: "https://github.com/example-builder/submit-launch",
    private: false,
    fork: true,
    owner: viewer,
    parent: { id: centralRepository.id },
    permissions: { push: true, admin: true, maintain: true }
  } : null;
  const branchCommit = "3".repeat(40);
  const branchTree = "4".repeat(40);
  const branch = hasPull
    ? `open-world-v3/${application.applicationId}`
    : deriveFixtureReviewBranch(application, projection.packageSha256);
  const pullProjection = mode === "update" ? priorProjection : projection;
  const pullFiles = !hasPull ? [] : pullProjection.paths.map((filename) => ({
    filename,
    status: "added",
    sha: "5".repeat(40)
  }));
  const pull = !hasPull ? null : {
    number: 7,
    state: "open",
    draft: true,
    merged_at: null,
    merge_commit_sha: null,
    html_url: "https://github.com/0xprogrammable/submit-launch/pull/7",
    title: `[Application V3] ${application.applicationId}`,
    body: "Existing exact Application V3 review thread.",
    labels: [],
    changed_files: pullFiles.length,
    user: viewer,
    head: {
      ref: branch,
      sha: branchCommit,
      repo: { id: forkRepository?.id, full_name: forkRepository?.full_name }
    },
    base: {
      ref: "main",
      sha: centralCommit,
      repo: { id: centralRepository.id, full_name: centralRepository.full_name }
    }
  };
  const contents = mode === "update"
    ? priorProjection.contents
    : mode === "status"
      ? projection.contents
      : mode === "merged-prior"
        ? { ...priorProjection.contents, ...projection.contents }
        : {};
  const sourceRepositoryPaths = application.source.primary.sourceClosureMode === "inline"
    ? application.source.primary.sourcePaths
    : [...new Set(application.reviewPackage.records
        .filter(({ source, repositoryRef }) => source === "source-repository" && repositoryRef === application.source.primary.id)
        .map(({ path: repositoryPath }) => repositoryPath))];
  const sourceContents = Object.fromEntries(sourceRepositoryPaths.map((repositoryPath) => [
    repositoryPath,
    Buffer.from(fixtureSourceContent(application, repositoryPath), "utf8").toString("base64")
  ]));
  fs.writeFileSync(statePath, `${canonicalJson({
    viewer,
    centralRepository,
    sourceRepository: {
      id: Number(application.source.primary.numericRepositoryId),
      full_name: "example-builder/legacy-open-world-example",
      html_url: application.source.primary.repositoryUri,
      private: false,
      fork: false,
      owner: { id: Number(application.builder.githubUserId), login: application.builder.githubLogin },
      permissions: { push: true, admin: true, maintain: true }
    },
    sourceCommit,
    sourceTree,
    centralCommit,
    centralTree,
    forkRepository,
    branchCommit,
    branchTree,
    branch,
    branchExists: hasPull,
    pull,
    pullFiles,
    contents,
    sourceContents,
    sourceTreeSizeOverrides: {},
    sourceTreeTruncated: false,
    sourceTreeEntryOverrides: {},
    sourceHistory: {},
    sourceArchives: {},
    packageContents: projection.contents,
    centralContents: priorIsMerged ? priorProjection.contents : {},
    centralTreeEntries: [],
    intakeStatus: Buffer.from(`${canonicalJson({
      continuingPullRequests: [],
      schemaVersion: 2,
      state: "open"
    })}\n`, "utf8").toString("base64"),
    centralContentFailure: null,
    workflowRunMode: null,
    raceMode: null,
    paginationMode: null,
    prepareSearch: null,
    reviews: [],
    checks: { total_count: 0, check_runs: [] }
  })}\n`);
  const fakeGh = path.join(fakeBin, "gh");
  fs.writeFileSync(fakeGh, fakeGhProgram(), { mode: 0o755 });
  const fakeGhPreloadCandidate = path.join(fakeBin, "fake-gh-preload.cjs");
  const fakeGhFixtureSentinel = sha256(Buffer.from(root, "utf8"));
  fs.writeFileSync(fakeGhPreloadCandidate, fakeGhPreloadProgram({
    callLog,
    fakeBin,
    fakeGh,
    statePath,
    sentinel: fakeGhFixtureSentinel
  }));
  const fakeGhPreload = fs.realpathSync(fakeGhPreloadCandidate);
  return {
    root,
    packageRoot,
    fakeBin,
    fakeGh,
    fakeGhFixtureSentinel,
    fakeGhPreload,
    callLog,
    statePath,
    applicationRevision: String(application.applicationRevision)
  };
}

function attachPrepareRevisionInlineSource(fixture) {
  const sourceRoot = path.join(fixture.root, "prepare-source");
  fs.mkdirSync(sourceRoot);
  runLocalGit(sourceRoot, ["init", "--quiet", "--initial-branch=main"]);
  runLocalGit(sourceRoot, ["config", "user.name", "Prepare Revision Fixture"]);
  runLocalGit(sourceRoot, ["config", "user.email", "prepare-revision@example.invalid"]);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  for (const [repositoryPath, content] of Object.entries(state.sourceContents)) {
    const target = path.join(sourceRoot, ...repositoryPath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(content, "base64"));
  }
  runLocalGit(sourceRoot, ["add", "--", "."]);
  runLocalGit(sourceRoot, ["commit", "--quiet", "-m", "exact prepare source"]);
  const application = readFixtureApplication(fixture);
  application.source.primary.revisionObjectId = runLocalGit(sourceRoot, ["rev-parse", "HEAD"]).trim();
  application.source.primary.treeObjectId = runLocalGit(sourceRoot, ["rev-parse", "HEAD^{tree}"]).trim();
  writeApplicationPackage(fixture.packageRoot, application);
  const updatedApplication = readFixtureApplication(fixture);
  state.sourceCommit = updatedApplication.source.primary.revisionObjectId;
  state.sourceTree = updatedApplication.source.primary.treeObjectId;
  state.sourceContents = readLocalGitTreeBlobs(sourceRoot, state.sourceCommit);
  state.sourceTreeSizeOverrides = {};
  state.packageContents = projectFixturePackage(fixture.packageRoot, updatedApplication).contents;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  return createPrepareRevisionDraftFiles(fixture, sourceRoot);
}

function createInlineSplitReplayFixture(fixture) {
  const sourceRoot = path.join(fixture.root, "inline-split-source");
  fs.mkdirSync(sourceRoot);
  runLocalGit(sourceRoot, ["init", "--quiet", "--initial-branch=main"]);
  runLocalGit(sourceRoot, ["config", "user.name", "Inline Split Fixture"]);
  runLocalGit(sourceRoot, ["config", "user.email", "inline-split@example.invalid"]);
  const application = readFixtureApplication(fixture);
  const sourcePaths = new Set(application.source.primary.sourcePaths);
  for (let index = 0; sourcePaths.size < 4_096; index += 1) {
    sourcePaths.add(`generated/source-${String(index).padStart(4, "0")}.txt`);
  }
  application.source.primary.sourcePaths = [...sourcePaths]
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  for (const repositoryPath of application.source.primary.sourcePaths) {
    const absolutePath = path.join(sourceRoot, ...repositoryPath.split("/"));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, fixtureSourceContent(application, repositoryPath));
  }
  fs.writeFileSync(path.join(sourceRoot, "generated", "unlisted-4097.txt"), "forces bounded inline split review\n");
  runLocalGit(sourceRoot, ["add", "--", "."]);
  runLocalGit(sourceRoot, ["commit", "--quiet", "-m", "bounded inline split fixture"]);
  application.source.primary.revisionObjectId = runLocalGit(sourceRoot, ["rev-parse", "HEAD"]).trim();
  application.source.primary.treeObjectId = runLocalGit(sourceRoot, ["rev-parse", "HEAD^{tree}"]).trim();
  writeApplicationPackage(fixture.packageRoot, application);
  const updatedApplication = readFixtureApplication(fixture);
  const projection = projectFixturePackage(fixture.packageRoot, updatedApplication);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.sourceCommit = updatedApplication.source.primary.revisionObjectId;
  state.sourceTree = updatedApplication.source.primary.treeObjectId;
  state.sourceContents = readLocalGitTreeBlobs(sourceRoot, state.sourceCommit);
  state.sourceTreeSizeOverrides = {};
  state.packageContents = projection.contents;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  return createPrepareRevisionDraftFiles(fixture, sourceRoot);
}

function createPrepareRevisionDraftFiles(fixture, sourceRoot) {
  const updatedApplication = readFixtureApplication(fixture);
  const inputRoot = path.join(fixture.root, "prepare-input");
  const outputParent = path.join(fixture.root, "prepare-output");
  fs.mkdirSync(inputRoot);
  fs.mkdirSync(outputParent);
  const draft = structuredClone(updatedApplication);
  delete draft.applicationRevision;
  delete draft.lineage;
  const draftPath = path.join(inputRoot, "application.v3.json");
  fs.writeFileSync(draftPath, `${canonicalJson(draft)}\n`);
  return {
    sourceRoot,
    draftPath,
    outputParent,
    repositoryRoot: path.resolve(skillRoot, "../..")
  };
}

function createApplicationPackage(packageRoot, { sentinel = null, manifestSource = false } = {}) {
  const application = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "assets", "templates", "open-world-v2", "public-pr-application-v3.example.json"),
    "utf8"
  ));
  application.applicationRevision = "1";
  application.lineage = { kind: "new", previous: null };
  if (manifestSource) configureFixtureManifestSource(application);
  writeApplicationPackage(packageRoot, application, { sentinel });
  return application;
}

function configureFixtureManifestSource(application) {
  const manifestPath = "review/source-closure/source-closure-manifest.v1.json";
  application.source.primary.sourceClosureMode = "manifest";
  application.source.primary.sourcePaths = [];
  application.source.primary.sourceManifest = {
    schemaId: "urn:programmable:source-closure-manifest:1.0.0",
    schemaVersion: "1.0.0",
    path: manifestPath,
    sha256: `sha256:${"2".repeat(64)}`,
    byteLength: 1,
    blobObjectId: "e".repeat(40),
    entryCount: 8,
    fragmentCount: 1
  };
  if (!application.reviewPackage.records.some(({ kind }) => kind === "source-closure-manifest")) {
    application.reviewPackage.records.push({
      kind: "source-closure-manifest",
      path: manifestPath,
      mediaType: "application/json",
      byteLength: 1,
      sha256: `sha256:${"2".repeat(64)}`,
      source: "source-repository",
      repositoryRef: application.source.primary.id
    });
  }
}

async function attachLocalManifestSource(fixture, {
  lfsMode = "none",
  directoryName = "local-source-repository",
  largeUnboundSource = false,
  contractSymlink = false,
  unboundSource = false
} = {}) {
  assert.ok(new Set(["none", "verified", "unresolved"]).has(lfsMode));
  const application = readFixtureApplication(fixture);
  const primary = application.source.primary;
  assert.equal(primary.sourceClosureMode, "manifest");
  const sourceRoot = path.join(fixture.root, directoryName);
  fs.mkdirSync(sourceRoot);
  runLocalGit(sourceRoot, ["init", "--quiet", "--initial-branch=main"]);
  runLocalGit(sourceRoot, ["config", "user.name", "Local Manifest Transport"]);
  runLocalGit(sourceRoot, ["config", "user.email", "local-manifest@example.invalid"]);

  const manifestPath = primary.sourceManifest.path;
  const sourcePaths = new Set(application.reviewPackage.records
    .filter((record) => (
      record.source === "source-repository"
      && record.repositoryRef === primary.id
      && record.path !== manifestPath
    ))
    .map(({ path: repositoryPath }) => repositoryPath));
  for (const [repositoryRef, repositoryPath] of [
    [application.policyBindings.submissionRepositoryRef, application.policyBindings.submissionPath],
    [application.policyBindings.feePolicySchemaRepositoryRef, application.policyBindings.feePolicySchemaPath],
    [application.policyBindings.feePolicyInstanceRepositoryRef, application.policyBindings.feePolicyInstancePath],
    [application.intentCapture.ideaSourceRepositoryRef, application.intentCapture.ideaSourcePath]
  ]) {
    if (repositoryRef === primary.id && typeof repositoryPath === "string") sourcePaths.add(repositoryPath);
  }
  for (const repositoryPath of primary.contractPaths ?? []) sourcePaths.add(repositoryPath);
  const sourceClosureRequiredPaths = new Set(sourcePaths);
  const packageDirectory = path.posix.dirname(application.policyBindings.submissionPath);
  for (const record of application.reviewPackage.records.filter(({ kind }) => TRADE_APPLICATION_RECORD_KINDS.has(kind))) {
    assert.equal(record.source, "application-package");
    assert.equal(record.repositoryRef, null);
    sourcePaths.add(path.posix.join(packageDirectory, record.path));
  }
  for (const repositoryPath of [...sourcePaths].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))) {
    const absolutePath = path.join(sourceRoot, ...repositoryPath.split("/"));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, fixtureSourceContent(application, repositoryPath));
  }
  if (contractSymlink) {
    assert.equal(primary.contractPaths.length, 1);
    const contractPath = primary.contractPaths[0];
    const targetPath = path.posix.join(path.posix.dirname(contractPath), "HookTarget.sol");
    fs.writeFileSync(path.join(sourceRoot, ...targetPath.split("/")), "// inert symlink target\n");
    fs.unlinkSync(path.join(sourceRoot, ...contractPath.split("/")));
    fs.symlinkSync(path.posix.basename(targetPath), path.join(sourceRoot, ...contractPath.split("/")));
  }
  if (unboundSource) {
    fs.mkdirSync(path.join(sourceRoot, "notes"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "notes", "unbound-source.txt"), "historical unbound source\n");
  }

  const lfsPayload = Buffer.from("materialized game asset bytes", "utf8");
  const lfsPath = "assets/hero.bin";
  if (lfsMode !== "none") {
    const pointerBytes = Buffer.from(
      `version https://git-lfs.github.com/spec/v1\noid ${sha256(lfsPayload)}\nsize ${lfsPayload.length}\n`,
      "utf8"
    );
    fs.mkdirSync(path.join(sourceRoot, "assets"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, ...lfsPath.split("/")), pointerBytes);
  }
  const largeUnboundPaths = ["assets/unbound-large-a.bin", "assets/unbound-large-b.bin"];
  if (largeUnboundSource) {
    fs.mkdirSync(path.join(sourceRoot, "assets"), { recursive: true });
    for (const [index, repositoryPath] of largeUnboundPaths.entries()) {
      const descriptor = fs.openSync(path.join(sourceRoot, ...repositoryPath.split("/")), "w");
      try {
        fs.writeSync(descriptor, Buffer.from([0x41 + index]), 0, 1, 34 * 1024 * 1024);
      } finally {
        fs.closeSync(descriptor);
      }
    }
  }
  runLocalGit(sourceRoot, ["add", "--", "."]);
  runLocalGit(sourceRoot, ["commit", "--quiet", "-m", "source fixture"]);

  fs.mkdirSync(path.join(sourceRoot, "review"), { recursive: true });
  const plan = generateSourceClosureManifestV1({
    repositoryRoot: sourceRoot,
    outputDirectory: path.dirname(manifestPath),
    repositoryUri: primary.repositoryUri,
    numericRepositoryId: primary.numericRepositoryId,
    requiredRoleMappings: (primary.contractPaths ?? []).map((repositoryPath) => ({
      path: repositoryPath,
      roleId: "contract"
    }))
  });
  materializeSourceClosureManifestV1(plan);
  runLocalGit(sourceRoot, ["add", "--", path.dirname(manifestPath)]);
  runLocalGit(sourceRoot, ["commit", "--quiet", "-m", "source closure manifest"]);

  primary.revisionObjectId = runLocalGit(sourceRoot, ["rev-parse", "HEAD"]).trim();
  primary.treeObjectId = runLocalGit(sourceRoot, ["rev-parse", "HEAD^{tree}"]).trim();
  primary.sourceManifest = structuredClone(plan.manifestBindingTemplate);
  if (lfsMode === "verified") {
    fs.writeFileSync(path.join(sourceRoot, ...lfsPath.split("/")), lfsPayload);
  }

  for (const record of application.reviewPackage.records.filter((candidate) => (
    candidate.source === "source-repository" && candidate.repositoryRef === primary.id
  ))) {
    const bytes = readLocalGitBlob(sourceRoot, primary.revisionObjectId, record.path);
    record.byteLength = bytes.length;
    record.sha256 = sha256(bytes);
  }
  for (const record of application.reviewPackage.records.filter(({ kind }) => TRADE_APPLICATION_RECORD_KINDS.has(kind))) {
    const originPath = path.posix.join(packageDirectory, record.path);
    const bytes = readLocalGitBlob(sourceRoot, primary.revisionObjectId, originPath);
    record.byteLength = bytes.length;
    record.sha256 = sha256(bytes);
  }
  for (const [repositoryRef, repositoryPath, hashKey] of [
    [application.policyBindings.submissionRepositoryRef, application.policyBindings.submissionPath, "submissionSha256"],
    [application.policyBindings.feePolicySchemaRepositoryRef, application.policyBindings.feePolicySchemaPath, "feePolicySchemaSha256"],
    [application.policyBindings.feePolicyInstanceRepositoryRef, application.policyBindings.feePolicyInstancePath, "feePolicyInstanceSha256"]
  ]) {
    if (repositoryRef === primary.id && typeof repositoryPath === "string") {
      application.policyBindings[hashKey] = sha256(readLocalGitBlob(sourceRoot, primary.revisionObjectId, repositoryPath));
    }
  }
  if (application.intentCapture.ideaSourceRepositoryRef === primary.id) {
    application.intentCapture.ideaSourceSha256 = sha256(readLocalGitBlob(
      sourceRoot,
      primary.revisionObjectId,
      application.intentCapture.ideaSourcePath
    ));
  }

  const requiredPaths = [...sourceClosureRequiredPaths];
  const verificationReport = await verifyLocalSourceClosureManifestV1({
    repositoryRoot: sourceRoot,
    repository: primary,
    manifest: plan.manifest,
    requiredPaths,
    applicationRepositories: [primary]
  });
  assert.equal(verificationReport.status, "VERIFIED", JSON.stringify(verificationReport.findings));
  assert.equal(verificationReport.sourceClosureVerified, true);
  assert.equal(
    verificationReport.dependencyPointerCoverage.sourceCriticalDereferenceState,
    lfsMode === "unresolved"
      ? "UNRESOLVED"
      : lfsMode === "verified" || contractSymlink
        ? "VERIFIED"
        : "NONE"
  );

  const priorBinding = application.source.verificationReports[0];
  const reportPath = priorBinding.reportPath;
  const reportBytes = Buffer.from(`${canonicalJson(verificationReport)}\n`, "utf8");
  fs.writeFileSync(path.join(fixture.packageRoot, reportPath), reportBytes);
  const reportSha256 = sha256(reportBytes);
  const persistedCoverage = {
    repositoryRef: primary.id,
    revisionObjectId: primary.revisionObjectId,
    treeObjectId: primary.treeObjectId,
    sourceClosureMode: "manifest",
    sourcePaths: [],
    sourcePathsSha256: null,
    manifestPath,
    manifestSha256: primary.sourceManifest.sha256,
    manifestByteLength: primary.sourceManifest.byteLength,
    closureSha256: verificationReport.sourceBinding.closureSha256,
    reportPath,
    reportSha256,
    reportByteLength: reportBytes.length,
    result: "VERIFIED"
  };
  application.source.verificationReports = [persistedCoverage];
  const reportRecord = application.reviewPackage.records.find((record) => (
    record.kind === "source-closure-verification" && record.source === "application-package"
  ));
  assert.ok(reportRecord);
  reportRecord.path = reportPath;
  reportRecord.sha256 = reportSha256;
  reportRecord.byteLength = reportBytes.length;

  const security = readFixtureArtifact(fixture, application.securityBindings.securityAssessmentPath);
  security.subject = {
    id: application.applicationId,
    revision: primary.revisionObjectId,
    stage: application.stage
  };
  security.assessment.evidenceRefs = [manifestPath, reportPath];
  security.layers.source.evidenceRefs = [manifestPath, reportPath];
  if (lfsMode === "unresolved") {
    security.assessment.state = "partial";
    security.assessment.reasonCode = "DEPENDENCY_TARGETS_UNRESOLVED";
    security.assessment.sourceCoverage = null;
  } else {
    security.assessment.state = "source-assessed";
    security.assessment.reasonCode = null;
    security.assessment.sourceCoverage = {
      primaryRepositoryRef: primary.id,
      repositories: [structuredClone(persistedCoverage)]
    };
  }
  rewriteFixtureApplicationArtifact(fixture, application, "security-assessment", security);
  const validation = validatePublicPrApplicationV3(application);
  assert.equal(validation.valid, true, JSON.stringify(validation.findings));
  writeFixtureApplication(fixture, application);

  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  const projection = projectFixturePackage(fixture.packageRoot, application);
  state.sourceCommit = primary.revisionObjectId;
  state.sourceTree = primary.treeObjectId;
  state.sourceContents = readLocalGitTreeBlobs(sourceRoot, primary.revisionObjectId, {
    excludePaths: largeUnboundSource ? largeUnboundPaths : []
  });
  state.sourceTreeSizeOverrides = {};
  state.packageContents = projection.contents;
  state.branch = deriveFixtureReviewBranch(application, projection.packageSha256);
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  return sourceRoot;
}

async function advanceLocalManifestSource(fixture, sourceRoot) {
  const application = readFixtureApplication(fixture);
  const primary = application.source.primary;
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.sourceHistory[state.sourceRepository.full_name] ??= {};
  state.sourceHistory[state.sourceRepository.full_name][state.sourceCommit] = {
    tree: state.sourceTree,
    contents: state.sourceContents,
    sizeOverrides: state.sourceTreeSizeOverrides ?? {},
    truncated: state.sourceTreeTruncated ?? false
  };

  const markerPath = path.join(sourceRoot, "notes", "revision-marker.txt");
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, "source revision two\n");
  runLocalGit(sourceRoot, ["add", "--", "notes/revision-marker.txt"]);
  runLocalGit(sourceRoot, ["commit", "--quiet", "-m", "advance exact source"]);

  const outputDirectory = "review/source-closure-v2";
  const plan = generateSourceClosureManifestV1({
    repositoryRoot: sourceRoot,
    outputDirectory,
    repositoryUri: primary.repositoryUri,
    numericRepositoryId: primary.numericRepositoryId,
    requiredRoleMappings: (primary.contractPaths ?? []).map((repositoryPath) => ({
      path: repositoryPath,
      roleId: "contract"
    }))
  });
  materializeSourceClosureManifestV1(plan);
  runLocalGit(sourceRoot, ["add", "--", outputDirectory]);
  runLocalGit(sourceRoot, ["commit", "--quiet", "-m", "refresh source closure manifest"]);

  primary.revisionObjectId = runLocalGit(sourceRoot, ["rev-parse", "HEAD"]).trim();
  primary.treeObjectId = runLocalGit(sourceRoot, ["rev-parse", "HEAD^{tree}"]).trim();
  primary.sourceManifest = structuredClone(plan.manifestBindingTemplate);
  const manifestRecord = application.reviewPackage.records.find((record) => (
    record.kind === "source-closure-manifest"
    && record.source === "source-repository"
    && record.repositoryRef === primary.id
  ));
  assert.ok(manifestRecord);
  manifestRecord.path = primary.sourceManifest.path;

  for (const record of application.reviewPackage.records.filter((candidate) => (
    candidate.source === "source-repository" && candidate.repositoryRef === primary.id
  ))) {
    const bytes = readLocalGitBlob(sourceRoot, primary.revisionObjectId, record.path);
    record.byteLength = bytes.length;
    record.sha256 = sha256(bytes);
  }
  for (const [repositoryRef, repositoryPath, hashKey] of [
    [application.policyBindings.submissionRepositoryRef, application.policyBindings.submissionPath, "submissionSha256"],
    [application.policyBindings.feePolicySchemaRepositoryRef, application.policyBindings.feePolicySchemaPath, "feePolicySchemaSha256"],
    [application.policyBindings.feePolicyInstanceRepositoryRef, application.policyBindings.feePolicyInstancePath, "feePolicyInstanceSha256"]
  ]) {
    if (repositoryRef === primary.id && typeof repositoryPath === "string") {
      application.policyBindings[hashKey] = sha256(readLocalGitBlob(sourceRoot, primary.revisionObjectId, repositoryPath));
    }
  }
  if (application.intentCapture.ideaSourceRepositoryRef === primary.id) {
    application.intentCapture.ideaSourceSha256 = sha256(readLocalGitBlob(
      sourceRoot,
      primary.revisionObjectId,
      application.intentCapture.ideaSourcePath
    ));
  }

  const requiredPaths = [...new Set([
    ...application.reviewPackage.records
      .filter((record) => (
        record.source === "source-repository"
        && record.repositoryRef === primary.id
        && record.path !== primary.sourceManifest.path
      ))
      .map((record) => record.path),
    application.policyBindings.submissionPath,
    application.policyBindings.feePolicySchemaPath,
    application.policyBindings.feePolicyInstancePath,
    application.intentCapture.ideaSourcePath,
    ...(primary.contractPaths ?? [])
  ])];
  const verificationReport = await verifyLocalSourceClosureManifestV1({
    repositoryRoot: sourceRoot,
    repository: primary,
    manifest: plan.manifest,
    requiredPaths,
    applicationRepositories: [primary]
  });
  assert.equal(verificationReport.status, "VERIFIED", JSON.stringify(verificationReport.findings));
  assert.equal(verificationReport.sourceClosureVerified, true);
  const priorBinding = application.source.verificationReports[0];
  const reportPath = priorBinding.reportPath;
  const reportBytes = Buffer.from(`${canonicalJson(verificationReport)}\n`, "utf8");
  fs.writeFileSync(path.join(fixture.packageRoot, reportPath), reportBytes);
  const persistedCoverage = {
    repositoryRef: primary.id,
    revisionObjectId: primary.revisionObjectId,
    treeObjectId: primary.treeObjectId,
    sourceClosureMode: "manifest",
    sourcePaths: [],
    sourcePathsSha256: null,
    manifestPath: primary.sourceManifest.path,
    manifestSha256: primary.sourceManifest.sha256,
    manifestByteLength: primary.sourceManifest.byteLength,
    closureSha256: verificationReport.sourceBinding.closureSha256,
    reportPath,
    reportSha256: sha256(reportBytes),
    reportByteLength: reportBytes.length,
    result: "VERIFIED"
  };
  application.source.verificationReports = [persistedCoverage];
  const reportRecord = application.reviewPackage.records.find((record) => (
    record.kind === "source-closure-verification" && record.source === "application-package"
  ));
  reportRecord.sha256 = persistedCoverage.reportSha256;
  reportRecord.byteLength = persistedCoverage.reportByteLength;

  const security = readFixtureArtifact(fixture, application.securityBindings.securityAssessmentPath);
  security.subject.revision = primary.revisionObjectId;
  security.assessment.evidenceRefs = [primary.sourceManifest.path, reportPath];
  security.layers.source.evidenceRefs = [primary.sourceManifest.path, reportPath];
  security.assessment.sourceCoverage = {
    primaryRepositoryRef: primary.id,
    repositories: [structuredClone(persistedCoverage)]
  };
  rewriteFixtureApplicationArtifact(fixture, application, "security-assessment", security);
  assert.equal(validatePublicPrApplicationV3(application).valid, true);
  writeFixtureApplication(fixture, application);

  const projection = projectFixturePackage(fixture.packageRoot, application);
  state.sourceCommit = primary.revisionObjectId;
  state.sourceTree = primary.treeObjectId;
  state.sourceContents = readLocalGitTreeBlobs(sourceRoot, primary.revisionObjectId);
  state.sourceTreeSizeOverrides = {};
  state.sourceTreeTruncated = false;
  state.packageContents = projection.contents;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  return application;
}

async function addSameNumericManifestCompanion(fixture, sourceRoot) {
  const application = readFixtureApplication(fixture);
  const primary = application.source.primary;
  fs.writeFileSync(path.join(sourceRoot, "notes", "complete-root-marker.txt"), "second complete current root\n");
  runLocalGit(sourceRoot, ["add", "--", "notes/complete-root-marker.txt"]);
  runLocalGit(sourceRoot, ["commit", "--quiet", "-m", "distinct complete current root"]);
  const outputDirectory = "review/source-closure-companion-current";
  const plan = generateSourceClosureManifestV1({
    repositoryRoot: sourceRoot,
    outputDirectory,
    repositoryUri: primary.repositoryUri,
    numericRepositoryId: primary.numericRepositoryId,
    requiredRoleMappings: []
  });
  materializeSourceClosureManifestV1(plan);
  runLocalGit(sourceRoot, ["add", "--", outputDirectory]);
  runLocalGit(sourceRoot, ["commit", "--quiet", "-m", "complete companion closure"]);
  const companion = {
    ...structuredClone(primary),
    id: "z-complete",
    revisionObjectId: runLocalGit(sourceRoot, ["rev-parse", "HEAD"]).trim(),
    treeObjectId: runLocalGit(sourceRoot, ["rev-parse", "HEAD^{tree}"]).trim(),
    contractPaths: [],
    githubActionsRunIds: [],
    sourceManifest: structuredClone(plan.manifestBindingTemplate)
  };
  application.source.companions = [companion];
  const verificationReport = await verifyLocalSourceClosureManifestV1({
    repositoryRoot: sourceRoot,
    repository: companion,
    manifest: plan.manifest,
    requiredPaths: [],
    applicationRepositories: [primary, companion]
  });
  assert.equal(verificationReport.status, "VERIFIED", JSON.stringify(verificationReport.findings));
  assert.equal(verificationReport.sourceClosureVerified, true);
  const reportPath = `source-verification.${companion.id}.v1.json`;
  const reportBytes = Buffer.from(`${canonicalJson(verificationReport)}\n`, "utf8");
  fs.writeFileSync(path.join(fixture.packageRoot, reportPath), reportBytes);
  const coverage = {
    repositoryRef: companion.id,
    revisionObjectId: companion.revisionObjectId,
    treeObjectId: companion.treeObjectId,
    sourceClosureMode: "manifest",
    sourcePaths: [],
    sourcePathsSha256: null,
    manifestPath: companion.sourceManifest.path,
    manifestSha256: companion.sourceManifest.sha256,
    manifestByteLength: companion.sourceManifest.byteLength,
    closureSha256: verificationReport.sourceBinding.closureSha256,
    reportPath,
    reportSha256: sha256(reportBytes),
    reportByteLength: reportBytes.length,
    result: "VERIFIED"
  };
  application.source.verificationReports.push(coverage);
  const manifestBytes = readLocalGitBlob(sourceRoot, companion.revisionObjectId, companion.sourceManifest.path);
  application.reviewPackage.records.push({
    kind: "source-closure-manifest",
    path: companion.sourceManifest.path,
    mediaType: "application/json",
    byteLength: manifestBytes.length,
    sha256: sha256(manifestBytes),
    source: "source-repository",
    repositoryRef: companion.id
  }, {
    kind: "source-closure-verification",
    path: reportPath,
    mediaType: "application/json",
    byteLength: reportBytes.length,
    sha256: sha256(reportBytes),
    source: "application-package",
    repositoryRef: null
  });
  const security = readFixtureArtifact(fixture, application.securityBindings.securityAssessmentPath);
  security.assessment.evidenceRefs = [...new Set([
    ...security.assessment.evidenceRefs,
    companion.sourceManifest.path,
    reportPath
  ])];
  security.layers.source.evidenceRefs = [...new Set([
    ...security.layers.source.evidenceRefs,
    companion.sourceManifest.path,
    reportPath
  ])];
  security.assessment.sourceCoverage.repositories.push(structuredClone(coverage));
  rewriteFixtureApplicationArtifact(fixture, application, "security-assessment", security);
  const validation = validatePublicPrApplicationV3(application);
  assert.equal(validation.valid, true, JSON.stringify(validation.findings));
  writeFixtureApplication(fixture, application);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.sourceHistory[state.sourceRepository.full_name] ??= {};
  state.sourceHistory[state.sourceRepository.full_name][companion.revisionObjectId] = {
    tree: companion.treeObjectId,
    contents: readLocalGitTreeBlobs(sourceRoot, companion.revisionObjectId),
    sizeOverrides: {},
    truncated: false,
    entryOverrides: {}
  };
  state.packageContents = projectFixturePackage(fixture.packageRoot, application).contents;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  return companion;
}

function addInlinePredecessorCompanion(fixture, sourceRoot) {
  const application = readFixtureApplication(fixture);
  const primary = application.source.primary;
  const sourcePath = "src/Inline.sol";
  const revisionObjectId = runLocalGit(sourceRoot, ["rev-parse", "HEAD"]).trim();
  const treeObjectId = runLocalGit(sourceRoot, ["rev-parse", "HEAD^{tree}"]).trim();
  const listing = runLocalGit(sourceRoot, ["ls-tree", revisionObjectId, "--", sourcePath]).trim();
  const match = /^100644 blob ([0-9a-f]{40})\t(.+)$/u.exec(listing);
  assert.ok(match);
  assert.equal(match[2], sourcePath);
  const bytes = fs.readFileSync(path.join(sourceRoot, ...sourcePath.split("/")));
  const companion = {
    ...structuredClone(primary),
    id: "removed-inline",
    revisionObjectId,
    treeObjectId,
    sourceClosureMode: "inline",
    sourcePaths: [sourcePath],
    sourceManifest: null,
    contractPaths: [sourcePath],
    githubActionsRunIds: []
  };
  application.source.companions.push(companion);
  const sourcePathsSha256 = sha256(Buffer.from(`${canonicalJson(companion.sourcePaths)}\n`, "utf8"));
  const closureEntry = {
    path: sourcePath,
    gitMode: "100644",
    blobObjectId: match[1],
    byteLength: bytes.length,
    sha256: sha256(bytes)
  };
  const closureSha256 = sha256(Buffer.from(`${canonicalJson(closureEntry)}\n`, "utf8"));
  const reportPath = `source-verification.${companion.id}.v1.json`;
  const verificationReport = {
    reportVersion: "1.0.0",
    kind: "local-inline-source-closure-verification",
    valid: true,
    status: "VERIFIED",
    counts: { blocker: 0, review: 0 },
    findings: [],
    ideaEligibility: "ELIGIBLE_FOR_REVIEW",
    approvalGranted: false,
    readOnly: true,
    networkAccessed: false,
    candidateCodeExecuted: false,
    dependencyPointerCoverage: {
      ...emptyDependencyPointerCoverage(),
      pointerRecordsSha256: sha256(Buffer.alloc(0))
    },
    sourceBinding: {
      repositoryRef: companion.id,
      revisionObjectId,
      treeObjectId,
      sourceClosureMode: "inline",
      sourcePaths: [sourcePath],
      sourcePathsSha256,
      manifestPath: null,
      manifestSha256: null,
      manifestByteLength: null,
      closureSha256
    },
    stats: {
      entriesVerified: 1,
      sourceBytesVerified: bytes.length,
      fragmentsVerified: 0,
      fragmentBytesVerified: 0,
      symlinkEntries: 0,
      gitlinkEntries: 0,
      lfsPointerEntries: 0
    },
    sourceClosureVerified: true,
    splitReviewRequired: false
  };
  const reportBytes = Buffer.from(`${canonicalJson(verificationReport)}\n`, "utf8");
  fs.writeFileSync(path.join(fixture.packageRoot, reportPath), reportBytes);
  const coverage = {
    repositoryRef: companion.id,
    revisionObjectId,
    treeObjectId,
    sourceClosureMode: "inline",
    sourcePaths: [sourcePath],
    sourcePathsSha256,
    manifestPath: null,
    manifestSha256: null,
    manifestByteLength: null,
    closureSha256,
    reportPath,
    reportSha256: sha256(reportBytes),
    reportByteLength: reportBytes.length,
    result: "VERIFIED"
  };
  application.source.verificationReports.push(coverage);
  application.reviewPackage.records.push({
    kind: "source-closure-verification",
    path: reportPath,
    mediaType: "application/json",
    byteLength: reportBytes.length,
    sha256: sha256(reportBytes),
    source: "application-package",
    repositoryRef: null
  });
  const security = readFixtureArtifact(fixture, application.securityBindings.securityAssessmentPath);
  security.assessment.evidenceRefs = [...new Set([...security.assessment.evidenceRefs, reportPath])];
  security.layers.source.evidenceRefs = [...new Set([...security.layers.source.evidenceRefs, reportPath])];
  security.assessment.sourceCoverage.repositories.push(structuredClone(coverage));
  rewriteFixtureApplicationArtifact(fixture, application, "security-assessment", security);
  const validation = validatePublicPrApplicationV3(application);
  assert.equal(validation.valid, true, JSON.stringify(validation.findings));
  writeFixtureApplication(fixture, application);

  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
  state.sourceHistory[state.sourceRepository.full_name] ??= {};
  state.sourceHistory[state.sourceRepository.full_name][revisionObjectId] = {
    tree: treeObjectId,
    contents: { [sourcePath]: bytes.toString("base64") },
    sizeOverrides: {},
    truncated: false,
    entryOverrides: {}
  };
  state.packageContents = projectFixturePackage(fixture.packageRoot, application).contents;
  fs.writeFileSync(fixture.statePath, `${canonicalJson(state)}\n`);
  return { companion, reportPath };
}

function runLocalGit(repositoryRoot, argumentsList) {
  return childProcess.execFileSync("git", ["-C", repositoryRoot, ...argumentsList], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function writeAlternates(objectRoot, alternateObjectRoots) {
  fs.writeFileSync(
    path.join(objectRoot, "info", "alternates"),
    `${alternateObjectRoots.map((alternate) => path.relative(objectRoot, alternate)).join("\n")}\n`
  );
}

function looseGitObjectPath(repositoryRoot, objectId) {
  const objectPath = path.join(repositoryRoot, ".git", "objects", objectId.slice(0, 2), objectId.slice(2));
  assert.equal(fs.existsSync(objectPath), true, objectId);
  return objectPath;
}

function readHistoricalManifestObjectIds(repositoryRoot, application, unboundPath) {
  const manifestBytes = readLocalGitBlob(
    repositoryRoot,
    application.source.primary.revisionObjectId,
    application.source.primary.sourceManifest.path
  );
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const [fragment] = manifest.fragments;
  assert.ok(fragment?.blobObjectId);
  const fragmentBytes = childProcess.execFileSync(
    "git",
    ["-C", repositoryRoot, "cat-file", "blob", fragment.blobObjectId],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const entry = fragmentBytes
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find(({ path: repositoryPath }) => repositoryPath === unboundPath);
  assert.ok(entry?.blobObjectId, unboundPath);
  return {
    "manifest-root": application.source.primary.sourceManifest.blobObjectId,
    fragment: fragment.blobObjectId,
    source: entry.blobObjectId
  };
}

function readLocalGitBlob(repositoryRoot, revisionObjectId, repositoryPath) {
  const objectId = runLocalGit(repositoryRoot, ["rev-parse", `${revisionObjectId}:${repositoryPath}`]).trim();
  return childProcess.execFileSync("git", ["-C", repositoryRoot, "cat-file", "blob", objectId], {
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function readLocalGitTreeBlobs(repositoryRoot, revisionObjectId, { excludePaths = [] } = {}) {
  const output = childProcess.execFileSync(
    "git",
    ["-C", repositoryRoot, "ls-tree", "-r", "-z", "--full-tree", revisionObjectId],
    { encoding: null, stdio: ["ignore", "pipe", "pipe"] }
  );
  const contents = {};
  const excluded = new Set(excludePaths);
  for (const record of output.toString("utf8").split("\0").filter(Boolean)) {
    const match = /^(\d{6}) ([a-z]+) ([0-9a-f]{40})\t(.+)$/u.exec(record);
    assert.ok(match, record);
    if (match[2] !== "blob") continue;
    if (excluded.has(match[4])) continue;
    const bytes = childProcess.execFileSync(
      "git",
      ["-C", repositoryRoot, "cat-file", "blob", match[3]],
      { encoding: null, stdio: ["ignore", "pipe", "pipe"] }
    );
    contents[match[4]] = bytes.toString("base64");
  }
  return contents;
}

function readFixtureApplication(fixture) {
  return JSON.parse(fs.readFileSync(path.join(fixture.packageRoot, "application.v3.json"), "utf8"));
}

function readFixtureArtifact(fixture, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(fixture.packageRoot, relativePath), "utf8"));
}

function rewriteFixtureApplicationArtifact(fixture, application, kind, document) {
  const record = application.reviewPackage.records.find((candidate) => (
    candidate.kind === kind
    && candidate.source === "application-package"
  ));
  assert.ok(record, kind);
  const bytes = Buffer.from(`${canonicalJson(document)}\n`, "utf8");
  fs.writeFileSync(path.join(fixture.packageRoot, record.path), bytes);
  record.sha256 = sha256(bytes);
  record.byteLength = bytes.length;
  if (kind === "security-assessment") {
    application.securityBindings.securityAssessmentSha256 = record.sha256;
    application.securityBindings.securityAssessmentByteLength = record.byteLength;
  }
}

function rewriteFixtureRawArtifact(fixture, application, kind, content) {
  const record = application.reviewPackage.records.find((candidate) => (
    candidate.kind === kind
    && candidate.source === "application-package"
  ));
  assert.ok(record, kind);
  const bytes = Buffer.from(content, "utf8");
  fs.writeFileSync(path.join(fixture.packageRoot, record.path), bytes);
  record.sha256 = sha256(bytes);
  record.byteLength = bytes.length;
}

function writeFixtureApplication(fixture, application) {
  fs.writeFileSync(
    path.join(fixture.packageRoot, "application.v3.json"),
    `${canonicalJson(application)}\n`
  );
}

function createUnmaterializedProposalPackage(packageRoot, { sentinel = null } = {}) {
  const application = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "assets", "templates", "open-world-v2", "public-pr-application-v3.example.json"),
    "utf8"
  ));
  application.applicationRevision = "1";
  application.lineage = { kind: "new", previous: null };
  bindFixtureSourceRecords(application);
  const securitySchemaContent = `${canonicalJson(JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "open-world-security-v1.schema.json"),
    "utf8"
  )))}\n`;
  const securityAssessment = {
    schemaVersion: "open-world-security-v1",
    subject: {
      id: application.applicationId,
      revision: application.source.primary.revisionObjectId,
      stage: "proposal"
    },
    assessment: {
      state: "unassessed",
      reasonCode: "SOURCE_NOT_ASSESSED",
      evidenceRefs: [],
      sourceCoverage: null
    },
    layers: {
      source: {
        evidenceRefs: [],
        customProfiles: []
      }
    },
    extensions: []
  };
  const contentByKind = new Map([
    ["proposal", `# Proposal\n\nExact public proposal.${sentinel === null ? "" : ` ${sentinel}`}\n`],
    ["test-plan", "# Test plan\n\nExact public tests.\n"],
    ["threat-model", "# Threat model\n\nExact public threats.\n"],
    ["compatibility-report", `${canonicalJson({ result: "architecture-review-required", schemaVersion: 3 })}\n`],
    ["evidence-index", `${canonicalJson({ evidence: [], schemaVersion: 3 })}\n`],
    ["security-assessment-schema", securitySchemaContent],
    ["security-assessment", `${canonicalJson(securityAssessment)}\n`]
  ]);
  for (const record of application.reviewPackage.records.filter(({ source }) => source === "application-package")) {
    const content = contentByKind.get(record.kind);
    const bytes = Buffer.from(content, "utf8");
    record.byteLength = bytes.length;
    record.sha256 = sha256(bytes);
    fs.writeFileSync(path.join(packageRoot, record.path), bytes);
    if (record.kind === "security-assessment-schema") {
      application.securityBindings.securityAssessmentSchemaPath = record.path;
      application.securityBindings.securityAssessmentSchemaSha256 = record.sha256;
      application.securityBindings.securityAssessmentSchemaByteLength = record.byteLength;
    }
    if (record.kind === "security-assessment") {
      application.securityBindings.securityAssessmentPath = record.path;
      application.securityBindings.securityAssessmentSha256 = record.sha256;
      application.securityBindings.securityAssessmentByteLength = record.byteLength;
    }
  }
  const report = validatePublicPrApplicationV3(application);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  fs.writeFileSync(path.join(packageRoot, "application.v3.json"), `${canonicalJson(application)}\n`);
  return application;
}

function writeApplicationPackage(packageRoot, application, {
  sentinel = null,
  proposalByteLength = null,
  markdownByteLengths = null
} = {}) {
  const markdownContent = (kind, fallback) => {
    const exactLength = kind === "proposal" && proposalByteLength !== null
      ? proposalByteLength
      : markdownByteLengths?.[kind] ?? null;
    if (exactLength === null) return fallback;
    assert.ok(Number.isSafeInteger(exactLength) && exactLength > 0);
    return kind.slice(0, 1).repeat(exactLength);
  };
  const contentByKind = new Map([
    ["proposal", markdownContent("proposal", `# Proposal\n\nExact public proposal.${sentinel === null ? "" : ` ${sentinel}`}\n`)],
    ["test-plan", markdownContent("test-plan", "# Test plan\n\nExact public tests.\n")],
    ["threat-model", markdownContent("threat-model", "# Threat model\n\nExact public threats.\n")],
    ["compatibility-report", `${canonicalJson({ result: "architecture-review-required", schemaVersion: 3 })}\n`],
    ["evidence-index", `${canonicalJson({ evidence: [], schemaVersion: 3 })}\n`],
    ["security-assessment-schema", `${canonicalJson({ $id: "urn:programmable:open-world-security:1.0.0", type: "object" })}\n`],
    ["security-assessment", `${canonicalJson({ assessment: { state: "unassessed" }, schemaVersion: "open-world-security-v1" })}\n`]
  ]);
  prepareFixturePrototype(application);
  bindFixtureSourceRecords(application);
  deriveFixtureMaterializedArtifacts(application, contentByKind);
  for (const record of application.reviewPackage.records.filter(({ source }) => source === "application-package")) {
    const content = TRADE_APPLICATION_RECORD_KINDS.has(record.kind)
      ? canonicalV2Fixture(application.applicationId).files.get(record.path)?.toString("utf8")
      : contentByKind.get(record.kind);
    assert.equal(typeof content, "string", record.kind);
    const bytes = Buffer.from(content, "utf8");
    record.byteLength = bytes.length;
    record.sha256 = sha256(bytes);
    fs.mkdirSync(path.dirname(path.join(packageRoot, record.path)), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, record.path), bytes);
    if (record.kind === "security-assessment-schema") {
      application.securityBindings.securityAssessmentSchemaPath = record.path;
      application.securityBindings.securityAssessmentSchemaSha256 = record.sha256;
      application.securityBindings.securityAssessmentSchemaByteLength = record.byteLength;
    }
    if (record.kind === "security-assessment") {
      application.securityBindings.securityAssessmentPath = record.path;
      application.securityBindings.securityAssessmentSha256 = record.sha256;
      application.securityBindings.securityAssessmentByteLength = record.byteLength;
    }
  }
  const report = validatePublicPrApplicationV3(application);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  fs.writeFileSync(path.join(packageRoot, "application.v3.json"), `${canonicalJson(application)}\n`);
}

function prepareFixturePrototype(application) {
  application.stage = "prototype";
  application.policyBindings.feeApplicability = "applicable";
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
  const fixture = canonicalV2Fixture(application.applicationId);
  const packageDirectory = path.posix.dirname(application.policyBindings.submissionPath);
  const repositoryPathFor = (relativePath) => path.posix.join(packageDirectory, relativePath);
  const feePath = repositoryPathFor(fixture.submission.supportingPackage.feePolicy.path);
  application.policyBindings.feePolicySchemaPath = repositoryPathFor(
    fixture.submission.supportingPackage.feePolicySchema.path
  );
  application.policyBindings.feePolicyInstancePath = feePath;
  application.policyBindings.feePolicyInstanceRepositoryRef = "primary";
  application.intentCapture.ideaSourcePath = repositoryPathFor(fixture.submission.intentPackage.ideaSource.path);
  const kindByRelativePath = new Map([
    ["submission.v2.json", "submission"],
    ...Object.values(fixture.submission.intentPackage).map((binding) => [binding.path, binding.artifactType]),
    ...Object.values(fixture.submission.supportingPackage)
      .filter((binding) => binding !== null)
      .map((binding) => [binding.path, binding.artifactType]),
    ...fixture.submission.programmableFee.conformance.scopeArtifacts.flatMap((artifact) => [
      [artifact.receipt.path, artifact.receipt.artifactType],
      [artifact.vectorSet.path, artifact.vectorSet.artifactType]
    ]),
    ...fixture.submission.tradeCapability.markets.map((market) => [market.manifest.path, market.manifest.artifactType]),
    ...fixture.submission.tradeCapability.markets.flatMap((market) => {
      const manifest = JSON.parse(fixture.files.get(market.manifest.path));
      return [
        ...manifest.testEvidence.quoteTests.map((record) => [record.resultArtifactPath, "trade-test-result"]),
        ...manifest.testEvidence.executionTests.map((record) => [record.resultArtifactPath, "trade-test-result"])
      ];
    }),
    ["schemas/open-world-profile.schema.json", "extension-schema"]
  ]);
  for (const [relativePath] of fixture.files) {
    const repositoryPath = repositoryPathFor(relativePath);
    if (
      application.source.primary.sourceClosureMode === "inline"
      && !application.source.primary.sourcePaths.includes(repositoryPath)
    ) application.source.primary.sourcePaths.push(repositoryPath);
    const kind = kindByRelativePath.get(relativePath) ?? "v2-supporting-artifact";
    const tradeApplicationRecord = TRADE_APPLICATION_RECORD_KINDS.has(kind);
    const recordPath = tradeApplicationRecord ? relativePath : repositoryPath;
    const recordSource = tradeApplicationRecord ? "application-package" : "source-repository";
    const recordRepositoryRef = tradeApplicationRecord ? null : "primary";
    if (!application.reviewPackage.records.some((record) => (
      record.source === recordSource && record.repositoryRef === recordRepositoryRef && record.path === recordPath
    ))) {
      application.reviewPackage.records.push({
        kind,
        path: recordPath,
        mediaType: "application/json",
        byteLength: 1,
        sha256: `sha256:${"1".repeat(64)}`,
        source: recordSource,
        repositoryRef: recordRepositoryRef
      });
    }
  }
}

function deriveFixtureMaterializedArtifacts(application, contentByKind) {
  const primary = application.source.primary;
  application.reviewPackage.records = application.reviewPackage.records.filter((record) => !(
    record.kind === "source-closure-verification"
    && record.source === "application-package"
  ));
  const inline = primary.sourceClosureMode === "inline";
  const sourcePathsSha256 = inline
    ? sha256(Buffer.from(`${canonicalJson(primary.sourcePaths)}\n`, "utf8"))
    : null;
  const closureEntries = inline
    ? [...primary.sourcePaths].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))).map((repositoryPath) => {
        const bytes = Buffer.from(fixtureSourceContent(application, repositoryPath), "utf8");
        return {
          path: repositoryPath,
          gitMode: "100644",
          blobObjectId: crypto.createHash("sha1")
            .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
            .update(bytes)
            .digest("hex"),
          byteLength: bytes.length,
          sha256: sha256(bytes)
        };
      })
    : [];
  const closureSha256 = inline
    ? sha256(Buffer.from(closureEntries.map((entry) => `${canonicalJson(entry)}\n`).join(""), "utf8"))
    : sha256(Buffer.from("untrusted-manifest-closure-fixture\n", "utf8"));
  const manifestPath = inline ? null : primary.sourceManifest.path;
  const manifestSha256 = inline ? null : primary.sourceManifest.sha256;
  const manifestByteLength = inline ? null : primary.sourceManifest.byteLength;
  const reportPath = "source-verification.primary.v1.json";
  const verificationReport = {
    status: "VERIFIED",
    sourceClosureVerified: true,
    readOnly: true,
    networkAccessed: false,
    candidateCodeExecuted: false,
    dependencyPointerCoverage: emptyDependencyPointerCoverage(),
    sourceBinding: {
      repositoryRef: primary.id,
      revisionObjectId: primary.revisionObjectId,
      treeObjectId: primary.treeObjectId,
      sourceClosureMode: primary.sourceClosureMode,
      sourcePaths: [...primary.sourcePaths],
      sourcePathsSha256,
      manifestPath,
      manifestSha256,
      manifestByteLength,
      closureSha256
    }
  };
  const reportContent = `${canonicalJson(verificationReport)}\n`;
  const reportBytes = Buffer.from(reportContent, "utf8");
  const reportSha256 = sha256(reportBytes);
  application.source.verificationReports = [{
    repositoryRef: primary.id,
    revisionObjectId: primary.revisionObjectId,
    treeObjectId: primary.treeObjectId,
    sourceClosureMode: primary.sourceClosureMode,
    sourcePaths: [...primary.sourcePaths],
    sourcePathsSha256,
    manifestPath,
    manifestSha256,
    manifestByteLength,
    closureSha256,
    reportPath,
    reportSha256,
    reportByteLength: reportBytes.length,
    result: "VERIFIED"
  }];
  application.reviewPackage.records.push({
    kind: "source-closure-verification",
    path: reportPath,
    mediaType: "application/json",
    byteLength: reportBytes.length,
    sha256: reportSha256,
    source: "application-package",
    repositoryRef: null
  });
  contentByKind.set("source-closure-verification", reportContent);

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
      evidenceRefs: [manifestPath, reportPath].filter(Boolean),
      sourceCoverage: {
        primaryRepositoryRef: primary.id,
        repositories: [{
          repositoryRef: primary.id,
          revisionObjectId: primary.revisionObjectId,
          treeObjectId: primary.treeObjectId,
          sourceClosureMode: primary.sourceClosureMode,
          sourcePaths: [...primary.sourcePaths],
          sourcePathsSha256,
          manifestPath,
          manifestSha256,
          manifestByteLength,
          closureSha256,
          reportPath,
          reportSha256,
          reportByteLength: reportBytes.length,
          result: "VERIFIED"
        }]
      }
    },
    layers: {
      source: {
        evidenceRefs: [manifestPath, reportPath].filter(Boolean),
        customProfiles: []
      }
    },
    extensions: []
  };
  const securitySchemaContent = `${canonicalJson(JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "open-world-security-v1.schema.json"),
    "utf8"
  )))}\n`;
  const securityContent = `${canonicalJson(securityAssessment)}\n`;
  contentByKind.set("security-assessment-schema", securitySchemaContent);
  contentByKind.set("security-assessment", securityContent);
}

function emptyDependencyPointerCoverage() {
  return {
    schemaVersion: "1.0.0",
    pointerCount: 0,
    pointerRecordsSha256: `sha256:${"0".repeat(64)}`,
    sourceCriticalDereferenceState: "NONE",
    counts: {
      symlink: 0,
      gitlink: 0,
      gitLfs: 0,
      internalVerified: 0,
      targetVerified: 0,
      unresolved: 0,
      sourceCritical: 0,
      runtimeAssetDelegated: 0,
      unclassified: 0
    }
  };
}

const canonicalV2Fixtures = new Map();

function canonicalV2Fixture(applicationId) {
  if (!canonicalV2Fixtures.has(applicationId)) {
    canonicalV2Fixtures.set(applicationId, createApplicableOpenWorldV2PrototypeFixture(applicationId));
  }
  return canonicalV2Fixtures.get(applicationId);
}

function fixtureSourceContent(application, repositoryPath) {
  const fixture = canonicalV2Fixture(application.applicationId);
  const packageDirectory = path.posix.dirname(application.policyBindings.submissionPath);
  const relativePath = path.posix.relative(packageDirectory, repositoryPath);
  const packageBytes = fixture.files.get(relativePath);
  if (packageBytes) return packageBytes.toString("utf8");
  const record = application.reviewPackage.records.find((candidate) => (
    candidate.source === "source-repository" && candidate.path === repositoryPath
  ));
  return `${canonicalJson({ kind: record?.kind ?? "bound-source-artifact", path: repositoryPath })}\n`;
}

function installLegacyV2PreparePredecessor(fixture, state, variant) {
  const current = readFixtureApplication(fixture);
  const submissionTemplate = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "assets", "templates", "submission.example.json"),
    "utf8"
  ));
  const submission = buildExampleBaseline(submissionTemplate);
  submission.model.id = current.applicationId;
  submission.model.name = current.title;
  submission.hook.used = true;
  submission.programmableFee.rates.selectedBuyHundredthsOfBip = 0;
  submission.programmableFee.rates.selectedSellHundredthsOfBip = 0;
  submission.programmableFee.rates.effectiveBuyHundredthsOfBip = 1000;
  submission.programmableFee.rates.effectiveSellHundredthsOfBip = 1000;
  submission.programmableFee.rates.projectBuyHundredthsOfBip = 0;
  submission.programmableFee.rates.projectSellHundredthsOfBip = 0;
  submission.programmableFee.collection.status = "implemented";
  submission.programmableFee.collection.supportedSwapModes = [...submission.integration.swapModes];
  submission.programmableFee.collection.swapModePaths = {
    zeroForOneExactInput: "before-swap-return-delta",
    zeroForOneExactOutput: "after-swap-return-delta",
    oneForZeroExactInput: "after-swap-return-delta",
    oneForZeroExactOutput: "before-swap-return-delta"
  };
  submission.integration.events.push(
    "ProgrammableFeeAccrued(bytes32 indexed poolId,address indexed owner,address quoteAsset,uint256 grossQuoteVolume,uint256 platformAmount,uint256 projectAmount)",
    "ProgrammableFeeClaimed(bytes32 indexed poolId,address indexed owner,address indexed destination,address quoteAsset,uint256 amount)"
  );
  submission.programmableFee.accounting.valueFlowId = "programmable-fee-accrual";
  submission.programmableFee.accounting.collectionEvent = submission.integration.events.at(-2);
  submission.programmableFee.accounting.claimEvent = submission.integration.events.at(-1);
  submission.valueFlows.push({
    id: "programmable-fee-accrual",
    action: "accrue the mandatory Programmable volume fee",
    asset: "the canonical pool quote asset",
    from: "the gross quote-side amount of every supported canonical-pool swap",
    to: "the PoolId-scoped immutable Programmable fee-owner liability",
    amountRule: "Accrue exactly 1000 hundredths of a bip to Programmable without adding the minimum twice.",
    settlement: "The canonical pool hook records quote-side liabilities before callback return and only the immutable owner may claim.",
    failure: "Any calculation, accrual or settlement failure reverts the complete swap."
  });
  if (variant === "schema-invalid") submission.standardVersion = "1.5.0";
  const submissionBytes = Buffer.from(
    variant === "noncanonical"
      ? `${JSON.stringify(submission, null, 2)}\n`
      : `${canonicalJson(submission)}\n`,
    "utf8"
  );
  const sourceCommit = "9".repeat(40);
  const sourceTree = "8".repeat(40);
  const submissionPath = `submissions/${current.applicationId}/submission.json`;
  const reviewFiles = new Map([
    ["PROPOSAL.md", Buffer.from("# Proposal\n\nExact legacy proposal.\n", "utf8")],
    ["TEST_PLAN.md", Buffer.from("# Test plan\n\nExact legacy tests.\n", "utf8")],
    ["THREAT_MODEL.md", Buffer.from("# Threat model\n\nExact legacy threats.\n", "utf8")],
    ["compatibility-report.json", Buffer.from(`${canonicalJson({ result: "architecture-review-required", schemaVersion: 1 })}\n`, "utf8")],
    ["evidence-index.json", Buffer.from(`${canonicalJson({ evidence: [], schemaVersion: 1 })}\n`, "utf8")]
  ]);
  const application = {
    schemaVersion: 2,
    applicationId: current.applicationId,
    applicationRevision: 7,
    stage: "proposal",
    title: "Exact legacy predecessor",
    summary: "An exact historical V2 package used only for authenticated migration.",
    builder: {
      githubUserId: current.builder.githubUserId,
      githubLogin: current.builder.githubLogin,
      contact: current.builder.contact
    },
    builderTemplate: structuredClone(submission.builderTemplate),
    source: {
      schemaVersion: "1.0.0",
      primary: {
        repositoryUri: current.source.primary.repositoryUri,
        numericRepositoryId: current.source.primary.numericRepositoryId,
        revisionObjectId: sourceCommit,
        treeObjectId: sourceTree,
        sourcePaths: [submissionPath],
        contractPaths: [],
        githubActionsRunIds: []
      },
      companions: []
    },
    companionClosure: [],
    programmableFee: {
      ...structuredClone(submission.programmableFee),
      submissionBinding: {
        path: submissionPath,
        sha256: sha256(submissionBytes)
      }
    },
    reviewPackage: [...reviewFiles].map(([relativePath, bytes]) => ({
      path: relativePath,
      byteLength: bytes.length,
      sha256: sha256(bytes)
    })),
    declarations: {
      publicInformationAcknowledged: true,
      noSecretsDeclared: true,
      noApprovalClaim: true,
      noUniswapEndorsementClaim: true
    }
  };
  const applicationBytes = Buffer.from(`${canonicalJson(application)}\n`, "utf8");
  state.centralContents = {
    [`submissions/${current.applicationId}/application.json`]: applicationBytes.toString("base64"),
    ...Object.fromEntries([...reviewFiles].map(([relativePath, bytes]) => [
      `submissions/${current.applicationId}/${relativePath}`,
      bytes.toString("base64")
    ]))
  };
  state.centralTreeEntries = [];
  state.sourceHistory[state.sourceRepository.full_name] ??= {};
  state.sourceHistory[state.sourceRepository.full_name][sourceCommit] = {
    tree: sourceTree,
    contents: { [submissionPath]: submissionBytes.toString("base64") },
    sizeOverrides: {},
    truncated: false,
    entryOverrides: {}
  };
}

function bindFixtureSourceRecords(application) {
  for (const record of application.reviewPackage.records.filter(({ source }) => source === "source-repository")) {
    const bytes = Buffer.from(fixtureSourceContent(application, record.path), "utf8");
    record.byteLength = bytes.length;
    record.sha256 = sha256(bytes);
  }
  const byPath = new Map(application.reviewPackage.records
    .filter(({ source }) => source === "source-repository")
    .map((record) => [record.path, record]));
  const submissionBytes = Buffer.from(fixtureSourceContent(application, application.policyBindings.submissionPath), "utf8");
  application.policyBindings.submissionSha256 = sha256(submissionBytes);
  application.policyBindings.feePolicySchemaSha256 = byPath.get(application.policyBindings.feePolicySchemaPath)?.sha256
    ?? application.policyBindings.feePolicySchemaSha256;
  application.policyBindings.feePolicyInstanceSha256 = byPath.get(application.policyBindings.feePolicyInstancePath)?.sha256
    ?? application.policyBindings.feePolicyInstanceSha256;
  application.intentCapture.ideaSourceSha256 = byPath.get(application.intentCapture.ideaSourcePath)?.sha256
    ?? application.intentCapture.ideaSourceSha256;
  if (application.source.primary.sourceClosureMode === "manifest") {
    const manifestRecord = byPath.get(application.source.primary.sourceManifest.path);
    application.source.primary.sourceManifest.sha256 = manifestRecord.sha256;
    application.source.primary.sourceManifest.byteLength = manifestRecord.byteLength;
  }
}

function tuneFixtureTreeRequest(packageRoot, application, targetByteLength) {
  const sizes = {
    proposal: 300_000,
    "test-plan": 300_000,
    "threat-model": 300_000
  };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    writeApplicationPackage(packageRoot, application, { markdownByteLengths: sizes });
    const observed = measureFixtureTreeRequest(packageRoot);
    if (observed === targetByteLength) return;
    sizes.proposal += targetByteLength - observed;
    assert.ok(sizes.proposal > 0 && sizes.proposal <= 700_000, `${sizes.proposal}`);
  }
  assert.fail(`could not tune Git tree request to ${targetByteLength} bytes`);
}

function measureFixtureTreeRequest(packageRoot) {
  const application = JSON.parse(fs.readFileSync(path.join(packageRoot, "application.v3.json"), "utf8"));
  const projection = projectFixturePackage(packageRoot, application);
  return Buffer.byteLength(canonicalJson({
    base_tree: "0".repeat(40),
    tree: projection.paths.map((filePath) => ({
      path: filePath,
      mode: "100644",
      type: "blob",
      content: Buffer.from(projection.contents[filePath], "base64").toString("utf8")
    }))
  }), "utf8");
}

function projectFixturePackage(packageRoot, application) {
  const applicationRevision = String(application.applicationRevision);
  const targetDirectory = `submissions/${application.applicationId}/v3/revisions/${applicationRevision}`;
  const records = [{ path: "application.v3.json", mediaType: "application/json" }, ...application.reviewPackage.records
    .filter(({ source }) => source === "application-package")
    .map(({ path: recordPath, mediaType }) => ({ path: recordPath, mediaType }))]
    .map(({ path: relativePath, mediaType }) => {
      const bytes = fs.readFileSync(path.join(packageRoot, relativePath));
      return {
        path: `${targetDirectory}/${relativePath}`,
        mediaType,
        byteLength: bytes.length,
        sha256: sha256(bytes),
        content: bytes.toString("utf8")
      };
    })
    .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const packageSha256 = sha256(Buffer.from(canonicalJson({
    contract: "public-pr-application-v3-package",
    applicationId: application.applicationId,
    applicationRevision,
    targetDirectory,
    files: records.map(({ path: filePath, mediaType, byteLength, sha256: digest }) => ({
      path: filePath,
      mediaType,
      byteLength,
      sha256: digest
    }))
  }), "utf8"));
  return {
    applicationSha256: sha256(fs.readFileSync(path.join(packageRoot, "application.v3.json"))),
    packageSha256,
    paths: records.map(({ path: filePath }) => filePath),
    contents: Object.fromEntries(records.map(({ path: filePath, content }) => [filePath, Buffer.from(content).toString("base64")]))
  };
}

function deriveFixtureReviewBranch(application, packageSha256) {
  const digest = sha256(Buffer.from(canonicalJson({
    contract: "public-pr-application-v3-review-thread",
    applicationId: application.applicationId,
    startRevision: String(application.applicationRevision),
    packageSha256
  }), "utf8")).slice("sha256:".length);
  return `open-world-v3/thread-${digest}`;
}

function fakeGhProgram() {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const crypto = require("node:crypto");
const state = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, "utf8"));
const args = process.argv.slice(2);
const method = args[args.indexOf("--method") + 1];
const versionHeader = args.indexOf("X-GitHub-Api-Version: 2022-11-28");
const endpoint = args[versionHeader + 1];
const stdin = method === "GET" ? "" : fs.readFileSync(0, "utf8");
const body = stdin.length === 0 ? null : JSON.parse(stdin);
fs.appendFileSync(process.env.FAKE_GH_CALL_LOG, JSON.stringify({ method, endpoint, body }) + "\\n");
function output(value) { fs.writeFileSync(1, JSON.stringify(value)); process.exit(0); }
function missing() { process.stderr.write("gh: Not Found (HTTP 404)\\n"); process.exit(1); }
function persist() { fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(state) + "\\n"); }
function treeEntriesForContents(contents) {
  return Object.entries(contents ?? {}).map(([repositoryPath, content]) => {
    const bytes = Buffer.from(content, "base64");
    return {
      path: repositoryPath,
      mode: "100644",
      type: "blob",
      sha: crypto.createHash("sha1").update(Buffer.from("blob " + bytes.length + "\\0", "utf8")).update(bytes).digest("hex"),
      size: bytes.length
    };
  });
}
function sourceSnapshot(repositorySlug, commit) {
  if (repositorySlug === state.sourceRepository.full_name && commit === state.sourceCommit) {
    return {
      tree: state.sourceTree,
      contents: state.sourceContents,
      sizeOverrides: state.sourceTreeSizeOverrides ?? {},
      truncated: state.sourceTreeTruncated ?? false,
      entryOverrides: state.sourceTreeEntryOverrides ?? {}
    };
  }
  return state.sourceHistory?.[repositorySlug]?.[commit]
    ?? state.sourceArchives?.[repositorySlug]?.snapshots?.[commit]
    ?? null;
}
function sourceMetadata(repositorySlug) {
  if (repositorySlug === state.sourceRepository.full_name) return state.sourceRepository;
  return state.sourceArchives?.[repositorySlug]?.metadata ?? null;
}
if (method !== "GET" && process.env.FAKE_GH_ALLOW_WRITES !== "1") { process.stderr.write("unexpected mutation\\n"); process.exit(9); }
if (method === "POST" && endpoint === "repos/0xprogrammable/submit-launch/forks") {
  state.forkRepository = {
    id: 666,
    full_name: "example-builder/submit-launch",
    html_url: "https://github.com/example-builder/submit-launch",
    private: false,
    fork: true,
    owner: state.viewer,
    parent: { id: state.centralRepository.id },
    permissions: { push: true, admin: true, maintain: true }
  };
  if (state.raceMode === "central-advance-on-fork") {
    state.centralCommit = "8".repeat(40);
    state.centralTree = "9".repeat(40);
  }
  persist();
  if (state.raceMode === "fork-response-loss") { process.stderr.write("simulated response loss\\n"); process.exit(1); }
  output(state.forkRepository);
}
if (method === "POST" && endpoint === "repos/example-builder/submit-launch/git/trees") {
  state.createdTree = "6".repeat(40);
  const baseContents = body.base_tree === state.centralTree
    ? state.centralContents
    : body.base_tree === state.branchTree
      ? state.contents
      : null;
  if (baseContents === null) { process.stderr.write("unexpected base tree\\n"); process.exit(9); }
  const entriesByPath = new Map(treeEntriesForContents(baseContents).map((entry) => [entry.path, entry]));
  for (const entry of body.tree) {
    const bytes = Buffer.from(entry.content, "utf8");
    entriesByPath.set(entry.path, {
      path: entry.path,
      mode: entry.mode,
      type: entry.type,
      sha: crypto.createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0", "utf8")).update(bytes).digest("hex"),
      size: bytes.length
    });
  }
  state.createdTreeEntries = [...entriesByPath.values()];
  state.createdTreeContents = {
    ...baseContents,
    ...Object.fromEntries(body.tree.map((entry) => [
      entry.path,
      Buffer.from(entry.content, "utf8").toString("base64")
    ]))
  };
  persist();
  if (state.raceMode === "tree-response-loss") { process.stderr.write("simulated response loss\\n"); process.exit(1); }
  output({ sha: state.createdTree });
}
if (method === "POST" && endpoint === "repos/example-builder/submit-launch/git/commits") {
  const createdCommit = "7".repeat(40);
  state.createdCommit = createdCommit;
  state.createdCommitTree = body.tree;
  state.createdCommitMessage = body.message;
  state.createdCommitParents = body.parents;
  if (state.raceMode === "branch-after-commit") {
    state.branchExists = true;
    state.branchCommit = "8".repeat(40);
  }
  if (state.raceMode === "update-pr-close-after-commit") {
    state.pull.state = "closed";
    state.pull.draft = false;
  }
  persist();
  if (state.raceMode === "commit-response-loss") { process.stderr.write("simulated response loss\\n"); process.exit(1); }
  output({ sha: createdCommit, tree: { sha: state.createdCommitTree } });
}
if (method === "POST" && endpoint === "repos/example-builder/submit-launch/git/refs") {
  const createdRef = String(body.ref || "");
  const createdBranch = createdRef.startsWith("refs/heads/") ? createdRef.slice("refs/heads/".length) : "";
  if (createdBranch !== state.branch) { process.stderr.write("unexpected branch\\n"); process.exit(9); }
  state.branchExists = true;
  state.branchCommit = body.sha;
  state.branchTree = state.createdCommitTree;
  persist();
  if (state.raceMode === "ref-response-loss") { process.stderr.write("simulated response loss\\n"); process.exit(1); }
  output({ ref: body.ref, object: { sha: body.sha } });
}
if (method === "PATCH" && endpoint === "repos/example-builder/submit-launch/git/refs/heads/" + encodeURIComponent(state.branch)) {
  state.branchExists = true;
  state.branchCommit = body.sha;
  state.branchTree = state.createdCommitTree;
  if (state.pull !== null) state.pull.head.sha = body.sha;
  persist();
  if (state.raceMode === "update-ref-response-loss") { process.stderr.write("simulated response loss\\n"); process.exit(1); }
  output({ ref: "refs/heads/" + state.branch, object: { sha: body.sha } });
}
if (method === "POST" && endpoint === "repos/0xprogrammable/submit-launch/pulls") {
  state.pull = {
    number: 7,
    state: "open",
    draft: body.draft,
    merged_at: null,
    merge_commit_sha: null,
    html_url: "https://github.com/0xprogrammable/submit-launch/pull/7",
    title: body.title,
    body: body.body,
    labels: [],
    changed_files: body.changed_files || 0,
    user: state.viewer,
    head: {
      ref: body.head.slice(body.head.indexOf(":") + 1),
      sha: state.branchCommit,
      repo: { id: state.forkRepository.id, full_name: state.forkRepository.full_name }
    },
    base: {
      ref: body.base,
      sha: state.centralCommit,
      repo: { id: state.centralRepository.id, full_name: state.centralRepository.full_name }
    }
  };
  persist();
  if (state.raceMode === "pull-response-loss") { process.stderr.write("simulated response loss\\n"); process.exit(1); }
  output(state.pull);
}
if (method === "PATCH" && endpoint === "repos/0xprogrammable/submit-launch/pulls/7") {
  state.pull.title = body.title;
  state.pull.body = body.body;
  persist();
  if (state.raceMode === "update-pull-response-loss") { process.stderr.write("simulated response loss\\n"); process.exit(1); }
  output(state.pull);
}
if (method !== "GET") { process.stderr.write("unexpected mutation\\n"); process.exit(9); }
if (endpoint === "user") {
  if (state.raceMode === "hold-receipt-lock-on-first-read") {
    state.receiptLockUserReads = (state.receiptLockUserReads ?? 0) + 1;
    persist();
    if (state.receiptLockUserReads === 1) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
    }
  }
  if (state.raceMode === "git-alternates-before-rename") {
    state.gitAlternatesRaceUserReads = (state.gitAlternatesRaceUserReads ?? 0) + 1;
    if (state.gitAlternatesRaceUserReads === 2) {
      fs.writeFileSync(state.gitAlternatesRacePath, state.gitAlternatesRaceContent);
      state.gitAlternatesRaceMutations = (state.gitAlternatesRaceMutations ?? 0) + 1;
    }
    persist();
  }
  output(state.viewer);
}
if (endpoint === "repos/0xprogrammable/submit-launch") output(state.centralRepository);
const sourceRepositoryMatch = /^repos\\/([^/]+\\/[^/]+)$/.exec(endpoint);
if (sourceRepositoryMatch !== null) {
  const metadata = sourceMetadata(sourceRepositoryMatch[1]);
  if (metadata !== null) output(metadata);
}
if (endpoint === "repos/example-builder/submit-launch") {
  if (state.forkRepository === null) missing();
  output(state.forkRepository);
}
if (endpoint === "users/example-builder/repos?type=owner&sort=full_name&direction=asc&per_page=100") {
  output(state.forkRepository === null ? [] : [state.forkRepository]);
}
const sourceCommitMatch = /^repos\\/([^/]+\\/[^/]+)\\/git\\/commits\\/([0-9a-f]{40})$/.exec(endpoint);
if (sourceCommitMatch !== null) {
  const snapshot = sourceSnapshot(sourceCommitMatch[1], sourceCommitMatch[2]);
  if (snapshot !== null) output({ sha: sourceCommitMatch[2], tree: { sha: snapshot.tree } });
}
const sourceTreeMatch = /^repos\\/([^/]+\\/[^/]+)\\/git\\/trees\\/([0-9a-f]{40})\\?recursive=1$/.exec(endpoint);
if (sourceTreeMatch !== null && sourceMetadata(sourceTreeMatch[1]) !== null) {
  const snapshots = sourceTreeMatch[1] === state.sourceRepository.full_name
    ? [sourceSnapshot(sourceTreeMatch[1], state.sourceCommit), ...Object.values(state.sourceHistory?.[sourceTreeMatch[1]] ?? {})]
    : Object.values(state.sourceArchives?.[sourceTreeMatch[1]]?.snapshots ?? {});
  const snapshot = snapshots.find((candidate) => candidate?.tree === sourceTreeMatch[2]) ?? null;
  if (snapshot === null) missing();
  output({
    sha: snapshot.tree,
    truncated: snapshot.truncated ?? false,
    tree: Object.entries(snapshot.contents).map(([repositoryPath, content]) => ({
      path: repositoryPath,
      mode: "100644",
      type: "blob",
      sha: crypto.createHash("sha1").update(Buffer.from("blob " + Buffer.from(content, "base64").length + "\\0", "utf8")).update(Buffer.from(content, "base64")).digest("hex"),
      size: snapshot.sizeOverrides?.[repositoryPath] ?? Buffer.from(content, "base64").length,
      ...(snapshot.entryOverrides?.[repositoryPath] ?? {})
    }))
  });
}
const workflowRunMatch = /^repos\\/([^/]+\\/[^/]+)\\/actions\\/runs\\/([1-9][0-9]{0,63})$/.exec(endpoint);
if (workflowRunMatch !== null) {
  const metadata = sourceMetadata(workflowRunMatch[1]);
  if (metadata === null) missing();
  state.workflowRunReads = (state.workflowRunReads ?? 0) + 1;
  const mode = state.workflowRunMode === "fail-on-second-read" && state.workflowRunReads >= 2
    ? "failed"
    : state.workflowRunMode;
  persist();
  output({
    id: workflowRunMatch[2],
    workflow_id: "123456",
    head_sha: mode === "wrong-head" ? "9".repeat(40) : state.sourceCommit,
    status: mode === "pending" ? "in_progress" : "completed",
    conclusion: mode === "failed" ? "failure" : mode === "pending" ? null : "success",
    path: mode === "wrong-workflow" ? "README.md" : ".github/workflows/ci.yml",
    run_attempt: 1,
    event: "push",
    repository: { id: metadata.id, full_name: metadata.full_name },
    head_repository: { id: metadata.id, full_name: metadata.full_name }
  });
}
const sourceContentMatch = /^repos\\/([^/]+\\/[^/]+)\\/contents\\/(.+)$/.exec(endpoint);
if (sourceContentMatch !== null && sourceMetadata(sourceContentMatch[1]) !== null) {
  const suffix = sourceContentMatch[2];
  const query = suffix.indexOf("?ref=");
  const encodedPath = query === -1 ? suffix : suffix.slice(0, query);
  const repositoryPath = encodedPath.split("/").map(decodeURIComponent).join("/");
  const ref = query === -1 ? state.sourceCommit : decodeURIComponent(suffix.slice(query + "?ref=".length));
  const snapshot = sourceSnapshot(sourceContentMatch[1], ref);
  const content = snapshot?.contents?.[repositoryPath];
  if (typeof content !== "string") missing();
  const bytes = Buffer.from(content, "base64");
  output({ type: "file", path: repositoryPath, encoding: "base64", content, sha: crypto.createHash("sha1").update(Buffer.from("blob " + bytes.length + "\\0", "utf8")).update(bytes).digest("hex") });
}
if (endpoint === "repos/0xprogrammable/submit-launch/git/ref/heads/main") {
  output({ ref: "refs/heads/main", object: { sha: state.centralCommit } });
}
if (endpoint === "repos/0xprogrammable/submit-launch/git/commits/" + state.centralCommit) {
  output({ sha: state.centralCommit, tree: { sha: state.centralTree } });
}
if (endpoint === "repos/0xprogrammable/submit-launch/git/trees/" + state.centralTree + "?recursive=1") {
  output({ sha: state.centralTree, truncated: false, tree: [...(state.centralTreeEntries ?? []), ...treeEntriesForContents(state.centralContents)] });
}
if (endpoint === "repos/example-builder/submit-launch/git/ref/heads/" + encodeURIComponent(state.branch)) {
  if (!state.branchExists) missing();
  if (state.raceMode === "ref-readback-failure" && state.createdCommit && state.branchCommit === state.createdCommit) {
    process.stderr.write("HTTP 403 simulated ref readback failure\\n");
    process.exit(1);
  }
  output({ ref: "refs/heads/" + state.branch, object: { sha: state.branchCommit } });
}
if (state.branchCommit !== state.createdCommit && endpoint === "repos/example-builder/submit-launch/git/commits/" + state.branchCommit) {
  output({ sha: state.branchCommit, tree: { sha: state.branchTree } });
}
if (endpoint === "repos/example-builder/submit-launch/git/trees/" + state.centralTree + "?recursive=1") {
  output({ sha: state.centralTree, truncated: false, tree: [...(state.centralTreeEntries ?? []), ...treeEntriesForContents(state.centralContents)] });
}
if (state.branchTree !== state.createdTree && endpoint === "repos/example-builder/submit-launch/git/trees/" + state.branchTree + "?recursive=1") {
  output({ sha: state.branchTree, truncated: false, tree: treeEntriesForContents(state.contents) });
}
if (state.createdTree && endpoint === "repos/example-builder/submit-launch/git/trees/" + state.createdTree + "?recursive=1") {
  const tree = state.raceMode === "created-tree-readback-tamper"
    ? [...state.createdTreeEntries, {
        path: state.createdTreeEntries[0].path + ".extra",
        mode: "100644",
        type: "blob",
        sha: "5".repeat(40),
        size: 1
      }]
    : state.raceMode === "created-tree-outside-scope-tamper"
      ? [...state.createdTreeEntries, {
          path: "unrelated/outside-confirmed-scope.txt",
          mode: "100644",
          type: "blob",
          sha: "5".repeat(40),
          size: 1
        }]
    : state.createdTreeEntries;
  output({ sha: state.createdTree, truncated: false, tree });
}
if (state.createdCommit && endpoint === "repos/example-builder/submit-launch/git/commits/" + state.createdCommit) {
  output({
    sha: state.createdCommit,
    tree: { sha: state.createdCommitTree },
    message: state.raceMode === "created-commit-readback-tamper" ? "tampered commit message" : state.createdCommitMessage,
    parents: state.createdCommitParents.map((sha) => ({ sha }))
  });
}
if (endpoint.startsWith("repos/0xprogrammable/submit-launch/pulls?")) {
  output(state.pull !== null && state.pull.state === "open" ? [state.pull] : []);
}
if (endpoint.startsWith("search/issues?")) output(state.prepareSearch ?? { total_count: 0, items: [] });
if (endpoint === "repos/0xprogrammable/submit-launch/pulls/7") {
  output(state.raceMode === "pull-final-readback-tamper"
    ? { ...state.pull, title: "tampered final title" }
    : state.pull);
}
if (endpoint.startsWith("repos/0xprogrammable/submit-launch/pulls/7/files?")) {
  const pageMatch = /(?:[?&])page=([0-9]+)/.exec(endpoint);
  const page = pageMatch === null ? 1 : Number(pageMatch[1]);
  let records = state.pullFiles.slice((page - 1) * 100, page * 100);
  if (state.paginationMode === "short-first-page" && page === 1) records = records.slice(0, 50);
  if (state.paginationMode === "reverse-each-page") records = [...records].reverse();
  if (state.paginationMode === "duplicate-second-page" && page === 2 && records.length > 0) {
    records[0] = state.pullFiles[99];
  }
  if (state.paginationMode === "head-drift-after-first-page" && page === 1) {
    state.pull.head.sha = "8".repeat(40);
    persist();
  }
  output(records);
}
if (endpoint.startsWith("repos/0xprogrammable/submit-launch/pulls/7/reviews?")) output(state.reviews);
if (endpoint.startsWith("repos/0xprogrammable/submit-launch/commits/" + state.branchCommit + "/check-runs?")) output(state.checks);
if (endpoint.startsWith("repos/example-builder/submit-launch/contents/")) {
  const suffix = endpoint.slice("repos/example-builder/submit-launch/contents/".length);
  const query = suffix.indexOf("?ref=");
  const encodedPath = query === -1 ? suffix : suffix.slice(0, query);
  const repositoryPath = encodedPath.split("/").map(decodeURIComponent).join("/");
  const ref = query === -1 ? null : decodeURIComponent(suffix.slice(query + "?ref=".length));
  let content = ref === state.createdCommit
    ? state.createdTreeContents?.[repositoryPath]
    : state.contents[repositoryPath];
  if (
    state.raceMode === "branch-package-readback-tamper"
    && ref === state.createdCommit
    && repositoryPath === Object.keys(state.createdTreeContents ?? {}).sort()[0]
  ) content = Buffer.from("tampered\\n", "utf8").toString("base64");
  if (typeof content !== "string") missing();
  const bytes = Buffer.from(content, "base64");
  output({ type: "file", path: repositoryPath, encoding: "base64", content, sha: crypto.createHash("sha1").update(Buffer.from("blob " + bytes.length + "\\0", "utf8")).update(bytes).digest("hex") });
}
if (endpoint.startsWith("repos/0xprogrammable/submit-launch/contents/")) {
  if (state.centralContentFailure === "403") { process.stderr.write("HTTP 403 Forbidden\\n"); process.exit(1); }
  if (state.centralContentFailure === "500") { process.stderr.write("HTTP 500 Internal Server Error\\n"); process.exit(1); }
  if (state.centralContentFailure === "malformed") { process.stdout.write("{"); process.exit(0); }
  const suffix = endpoint.slice("repos/0xprogrammable/submit-launch/contents/".length);
  const query = suffix.indexOf("?ref=");
  const encodedPath = query === -1 ? suffix : suffix.slice(0, query);
  const repositoryPath = encodedPath.split("/").map(decodeURIComponent).join("/");
  let content = repositoryPath === "docs/builder/intake-status.json"
    ? state.intakeStatus
    : state.centralContents[repositoryPath];
  if (repositoryPath === "docs/builder/intake-status.json" && state.raceMode === "intake-pause-before-write") {
    state.intakeReads = (state.intakeReads ?? 0) + 1;
    if (state.intakeReads >= 2) {
      const intake = JSON.parse(Buffer.from(state.intakeStatus, "base64").toString("utf8"));
      intake.state = "paused-all";
      state.intakeStatus = Buffer.from(JSON.stringify(intake) + "\\n", "utf8").toString("base64");
      content = state.intakeStatus;
    }
    persist();
  }
  if (typeof content !== "string") missing();
  const bytes = Buffer.from(content, "base64");
  output({ type: "file", path: repositoryPath, encoding: "base64", content, sha: crypto.createHash("sha1").update(Buffer.from("blob " + bytes.length + "\\0", "utf8")).update(bytes).digest("hex") });
}
process.stderr.write("unhandled fake endpoint " + endpoint + "\\n");
process.exit(8);
`;
}

function fakeGhPreloadProgram({ callLog, fakeBin, fakeGh, statePath, sentinel }) {
  const fixture = {
    callLog,
    fakeBin,
    fakeGh,
    programSha256: sha256(fs.readFileSync(fakeGh)),
    sentinel,
    statePath
  };
  return `"use strict";
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const fixture = Object.freeze(${JSON.stringify(fixture)});
const originalSpawnSync = childProcess.spawnSync;
const exactNodeOptions = "--require=" + __filename;
const fixtureProcessActive = (
  process.env.FAKE_GH_PRELOAD_SENTINEL === fixture.sentinel
  && process.env.FAKE_GH_EXECUTABLE === fixture.fakeGh
  && process.env.FAKE_GH_PRELOAD_PATH === __filename
  && process.env.NODE_OPTIONS === exactNodeOptions
);
let compiledFakeGh = null;

function digest(bytes) {
  return "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
}

function failClosed(code = "FAKE_GH_INVOCATION_INVALID") {
  const stdout = "";
  const stderr = "HTTP 599 " + code + "\\n";
  return {
    pid: 0,
    output: [null, stdout, stderr],
    stdout,
    stderr,
    status: 9,
    signal: null
  };
}

function exactFixtureEnvironment(environment) {
  if (environment === null || typeof environment !== "object") return false;
  const firstPathEntry = String(environment.PATH || "").split(path.delimiter)[0];
  return (
    environment.FAKE_GH_PRELOAD_SENTINEL === fixture.sentinel
    && environment.FAKE_GH_PRELOAD_PATH === __filename
    && environment.FAKE_GH_EXECUTABLE === fixture.fakeGh
    && environment.FAKE_GH_STATE === fixture.statePath
    && environment.FAKE_GH_CALL_LOG === fixture.callLog
    && (environment.FAKE_GH_ALLOW_WRITES === "0" || environment.FAKE_GH_ALLOW_WRITES === "1")
    && firstPathEntry === fixture.fakeBin
    && environment.NODE_OPTIONS === exactNodeOptions
    && environment.GH_PROMPT_DISABLED === "1"
    && environment.GH_PAGER === "cat"
    && environment.PAGER === "cat"
    && environment.GH_HOST === undefined
    && environment.GH_REPO === undefined
  );
}

function exactInvocation(args, options) {
  if (!Array.isArray(args) || options === null || typeof options !== "object") return false;
  if (
    JSON.stringify(Object.keys(options).sort())
    !== JSON.stringify(["encoding", "env", "input", "maxBuffer", "shell", "timeout"])
  ) return false;
  if (
    options.encoding !== "utf8"
    || options.shell !== false
    || options.timeout !== 30000
    || options.maxBuffer !== 4065536
    || typeof options.input !== "string"
    || !exactFixtureEnvironment(options.env)
  ) return false;
  if (
    args[0] !== "api"
    || args[1] !== "--hostname"
    || args[2] !== "github.com"
    || args[3] !== "--method"
    || !new Set(["GET", "POST", "PATCH"]).has(args[4])
  ) return false;
  const method = args[4];
  const offset = method === "GET" ? 1 : 0;
  if (method === "GET" && args[5] !== "--include") return false;
  if (
    args[5 + offset] !== "--header"
    || args[6 + offset] !== "Accept: application/vnd.github+json"
    || args[7 + offset] !== "--header"
    || args[8 + offset] !== "X-GitHub-Api-Version: 2022-11-28"
    || typeof args[9 + offset] !== "string"
    || args[9 + offset].length === 0
  ) return false;
  if (method === "GET") return args.length === 11 && options.input === "";
  if (args.length !== 12 || args[10] !== "--input" || args[11] !== "-" || options.input.length === 0) {
    return false;
  }
  try {
    const body = JSON.parse(options.input);
    return body !== null && typeof body === "object" && !Array.isArray(body);
  } catch {
    return false;
  }
}

function asBytes(value, encoding = "utf8") {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.from(String(value), typeof encoding === "string" ? encoding : "utf8");
}

function runFakeGh(args, options) {
  const sourceBytes = fs.readFileSync(fixture.fakeGh);
  if (digest(sourceBytes) !== fixture.programSha256) return failClosed("FAKE_GH_EXECUTABLE_CHANGED");
  if (compiledFakeGh === null) {
    const source = sourceBytes.toString("utf8").replace(/^#![^\\n]*(?:\\n|$)/u, "");
    compiledFakeGh = new vm.Script(source, { filename: fixture.fakeGh });
  }
  const stdinBytes = asBytes(options.input, options.encoding);
  const stdoutChunks = [];
  const stderrChunks = [];
  const exitMarker = Symbol("fake-gh-exit");
  const append = (chunks, value, encoding) => {
    chunks.push(asBytes(value, encoding));
    return true;
  };
  const fakeFs = new Proxy(fs, {
    get(target, property) {
      if (property === "readFileSync") {
        return (selected, readOptions) => {
          if (selected !== 0) return target.readFileSync(selected, readOptions);
          const encoding = typeof readOptions === "string" ? readOptions : readOptions?.encoding;
          return encoding ? stdinBytes.toString(encoding) : Buffer.from(stdinBytes);
        };
      }
      if (property === "writeFileSync") {
        return (selected, value, writeOptions) => {
          if (selected === 1) {
            const encoding = typeof writeOptions === "string" ? writeOptions : writeOptions?.encoding;
            append(stdoutChunks, value, encoding);
            return;
          }
          if (selected === 2) {
            const encoding = typeof writeOptions === "string" ? writeOptions : writeOptions?.encoding;
            append(stderrChunks, value, encoding);
            return;
          }
          return target.writeFileSync(selected, value, writeOptions);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const fakeProcess = {
    argv: [process.execPath, fixture.fakeGh, ...args],
    env: options.env,
    exit(status = 0) {
      const signal = { marker: exitMarker, status };
      throw signal;
    },
    stderr: { write: (value, encoding) => append(stderrChunks, value, encoding) },
    stdout: { write: (value, encoding) => append(stdoutChunks, value, encoding) }
  };
  let status = 0;
  try {
    compiledFakeGh.runInNewContext({
      Atomics,
      Buffer,
      Int32Array,
      SharedArrayBuffer,
      process: fakeProcess,
      require(name) {
        if (name === "node:fs") return fakeFs;
        if (name === "node:crypto") return crypto;
        throw new Error("unexpected test-only fake gh module");
      }
    }, { timeout: options.timeout });
  } catch (error) {
    if (error?.marker !== exitMarker || !Number.isSafeInteger(error.status)) {
      return failClosed("FAKE_GH_EXECUTION_FAILED");
    }
    status = error.status;
  }
  const stdout = Buffer.concat(stdoutChunks).toString(options.encoding);
  const stderr = Buffer.concat(stderrChunks).toString(options.encoding);
  if (Buffer.byteLength(stdout, options.encoding) + Buffer.byteLength(stderr, options.encoding) > options.maxBuffer) {
    return failClosed("FAKE_GH_OUTPUT_EXCEEDED");
  }
  return {
    pid: 0,
    output: [null, stdout, stderr],
    stdout,
    stderr,
    status,
    signal: null
  };
}

childProcess.spawnSync = function fixtureSpawnSync(command, args, options) {
  if (command !== "gh" || !fixtureProcessActive) return Reflect.apply(originalSpawnSync, this, arguments);
  if (!exactInvocation(args, options)) return failClosed();
  return runFakeGh(args, options);
};
`;
}

function fixtureCliEnvironment(fixture, { allowWrites, usePreload }) {
  const environment = {
    ...process.env,
    PATH: `${fixture.fakeBin}:${process.env.PATH ?? ""}`,
    FAKE_GH_STATE: fixture.statePath,
    FAKE_GH_CALL_LOG: fixture.callLog,
    FAKE_GH_ALLOW_WRITES: allowWrites ? "1" : "0"
  };
  if (usePreload) {
    environment.NODE_OPTIONS = `--require=${fixture.fakeGhPreload}`;
    environment.FAKE_GH_PRELOAD_SENTINEL = fixture.fakeGhFixtureSentinel;
    environment.FAKE_GH_PRELOAD_PATH = fixture.fakeGhPreload;
    environment.FAKE_GH_EXECUTABLE = fixture.fakeGh;
  } else {
    delete environment.NODE_OPTIONS;
    delete environment.FAKE_GH_PRELOAD_SENTINEL;
    delete environment.FAKE_GH_PRELOAD_PATH;
    delete environment.FAKE_GH_EXECUTABLE;
  }
  return environment;
}

function run(argumentsList, fixture, { allowWrites = false, usePreload = true } = {}) {
  const args = allowWrites
    && argumentsList.includes("--confirm-external-write")
    && !argumentsList.includes("--mutation-receipt")
    ? [...argumentsList, "--mutation-receipt", path.join(fixture.root, "application-v3-mutation-receipt.json")]
    : argumentsList;
  return childProcess.spawnSync(process.execPath, [cli, ...args], {
    cwd: fixture.root,
    encoding: "utf8",
    shell: false,
    env: fixtureCliEnvironment(fixture, { allowWrites, usePreload }),
    timeout: 30_000,
    maxBuffer: 16_000_000
  });
}

function runAsync(argumentsList, fixture, { allowWrites = false, usePreload = true } = {}) {
  const args = allowWrites
    && argumentsList.includes("--confirm-external-write")
    && !argumentsList.includes("--mutation-receipt")
    ? [...argumentsList, "--mutation-receipt", path.join(fixture.root, "application-v3-mutation-receipt.json")]
    : argumentsList;
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(process.execPath, [cli, ...args], {
      cwd: fixture.root,
      shell: false,
      env: fixtureCliEnvironment(fixture, { allowWrites, usePreload }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error("async CLI timed out")));
    }, 30_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code, signal) => finish(() => {
      if (signal !== null) reject(new Error(`async CLI ended with ${signal}`));
      else resolve({ status: code, stdout, stderr });
    }));
  });
}

function mutatingCalls(fixture) {
  return allCalls(fixture).filter(({ method }) => method !== "GET");
}

function isConfirmedReceiptMutation(entry) {
  return entry.outcome === "CONFIRMED" || entry.outcome === "CONFIRMED_BY_READ_ONLY_RECONCILIATION";
}

function allCalls(fixture) {
  if (!fs.existsSync(fixture.callLog)) return [];
  return fs.readFileSync(fixture.callLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function comparePullFileNames(left, right) {
  return Buffer.compare(Buffer.from(left.filename, "utf8"), Buffer.from(right.filename, "utf8"));
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}
