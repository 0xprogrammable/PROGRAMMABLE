import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const scriptsRoot = path.resolve(testDirectory, "..");
const cli = path.join(scriptsRoot, "cli.mjs");
const openWorldCli = path.join(scriptsRoot, "open-world.mjs");
const expectedMigrationFiles = [
  "architecture-decisions.v1.json",
  "fee-policy-v2.schema.json",
  "idea-source.v1.json",
  "intent-contract.v1.json",
  "intent-fidelity.v1.json",
  "legacy-migration-profile.v1.schema.json",
  "security-assessment-v1.schema.json",
  "security-assessment.v1.json",
  "submission.v2.json"
];
const expectedDraftFiles = [
  "architecture-decisions.v1.json",
  "fee-policy-v2.schema.json",
  "idea-source.v1.json",
  "intent-contract.v1.json",
  "intent-fidelity.v1.json",
  "security-assessment-v1.schema.json",
  "security-assessment.v1.json",
  "submission.v2.json"
];

test("host-neutral CLI exposes open-world, V2 launch checking, and historical application recheck help", () => {
  const globalHelp = run(["--help"]);
  assert.equal(globalHelp.status, 0, globalHelp.stderr);
  assert.match(globalHelp.stdout, /^  open-world\b/mu);
  assert.match(globalHelp.stdout, /Prepare open-world v2\/Application V3 locally/u);
  assert.match(globalHelp.stdout, /^  application-recheck\b/mu);
  assert.match(globalHelp.stdout, /^  launch-bundle-v2\b/mu);

  const launchV1Help = run(["launch-bundle", "--help"]);
  assert.equal(launchV1Help.status, 0, launchV1Help.stderr);
  assert.match(launchV1Help.stdout, /Usage: launch-bundle\.mjs/u);

  const launchV2Help = run(["launch-bundle-v2", "--help"]);
  assert.equal(launchV2Help.status, 0, launchV2Help.stderr);
  assert.match(launchV2Help.stdout, /launch-bundle v2/u);
  assert.match(launchV2Help.stdout, /strictly read-only/u);
  assert.match(launchV2Help.stdout, /Repeatable exact sourceRef-to-Git-root mapping/u);

  const openWorldHelp = run(["open-world", "--help"]);
  assert.equal(openWorldHelp.status, 0, openWorldHelp.stderr);
  assert.doesNotMatch(openWorldHelp.stdout, /never uses the network, submits, pushes/u);
  assert.match(openWorldHelp.stdout, /Local preparation commands do not use the network/u);
  assert.match(openWorldHelp.stdout, /status uses read-only GitHub requests/u);
  assert.match(openWorldHelp.stdout, /submit\/update write only after exact digest confirmation/u);
  assert.match(openWorldHelp.stdout, /^  init\b/mu);
  assert.match(openWorldHelp.stdout, /^  validate\b/mu);
  assert.match(openWorldHelp.stdout, /^  validate-application\b/mu);
  assert.match(openWorldHelp.stdout, /^  migrate\b/mu);
  assert.match(openWorldHelp.stdout, /^  source-manifest\b/mu);
  assert.match(openWorldHelp.stdout, /^  application\b/mu);
  assert.match(openWorldHelp.stdout, /^  prepare-revision\b/mu);
  assert.match(openWorldHelp.stdout, /^  submit\b/mu);
  assert.match(openWorldHelp.stdout, /^  update\b/mu);
  assert.match(openWorldHelp.stdout, /^  status\b/mu);

  const initHelp = run(["open-world", "init", "--help"]);
  assert.equal(initHelp.status, 0, initHelp.stderr);
  assert.match(initHelp.stdout, /--idea-file <public-safe\.txt>/u);
  assert.doesNotMatch(initHelp.stdout, /--idea(?: | <|$)/u);
  assert.match(initHelp.stdout, /preview by default/u);
  assert.match(initHelp.stdout, /unconfirmed proposal/u);
  assert.match(initHelp.stdout, /scoped fee instance comes only after architecture/u);

  const migrateHelp = run(["open-world", "migrate", "--help"]);
  assert.equal(migrateHelp.status, 0, migrateHelp.stderr);
  assert.match(migrateHelp.stdout, /--output <new-directory>/u);
  assert.match(migrateHelp.stdout, /--write/u);
  assert.match(migrateHelp.stdout, /by default/u);

  const recheckHelp = run(["application-recheck", "--help"]);
  assert.equal(recheckHelp.status, 0, recheckHelp.stderr);
  assert.match(recheckHelp.stdout, /always dry-run and read-only/u);
  assert.match(recheckHelp.stdout, /never edits the v1\.6 submission/u);

  for (const command of ["validate-application", "prepare-revision", "submit", "update", "status"]) {
    const delegatedHelp = run(["open-world", command, "--help"]);
    const directHelp = runOpenWorld([command, "--help"]);
    assert.equal(delegatedHelp.status, 0, delegatedHelp.stdout || delegatedHelp.stderr);
    assert.equal(directHelp.status, 0, directHelp.stdout || directHelp.stderr);
    assert.equal(delegatedHelp.stdout, directHelp.stdout);
    assert.match(directHelp.stdout, /Application V3/u);
  }
  assert.match(runOpenWorld(["validate-application", "--help"]).stdout, /--source-root <repository-ref=git-root>/u);
  assert.match(runOpenWorld(["validate-application", "--help"]).stdout, /without network access, writes, or candidate-code execution/u);
  assert.match(runOpenWorld(["prepare-revision", "--help"]).stdout, /--source-root <repository-ref=git-root>/u);
  assert.match(runOpenWorld(["prepare-revision", "--help"]).stdout, /--output <absolute-new-directory>/u);
  assert.match(runOpenWorld(["prepare-revision", "--help"]).stdout, /GET-only GitHub/u);
  assert.match(runOpenWorld(["submit", "--help"]).stdout, /confirmation digest/u);
  assert.match(runOpenWorld(["submit", "--help"]).stdout, /--source-root <repository-ref=git-root>/u);
  assert.match(runOpenWorld(["update", "--help"]).stdout, /--pull-request <number>/u);
  assert.match(runOpenWorld(["update", "--help"]).stdout, /--source-root <repository-ref=git-root>/u);
  assert.match(runOpenWorld(["status", "--help"]).stdout, /never write, approve, merge, deploy, or launch/u);
  assert.match(runOpenWorld(["status", "--help"]).stdout, /--source-root <repository-ref=git-root>/u);
});

test("open-world validate falls back to the canonical installed package root outside Git", (t) => {
  const nonGitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-installed-validate-"));
  t.after(() => fs.rmSync(nonGitRoot, { recursive: true, force: true }));
  const result = runOpenWorld([
    "validate",
    "skills/programmable-v4-hook-builder/assets/templates/open-world-v2/new-idea"
  ], nonGitRoot);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout).result;
  assert.equal(payload.action, "validate");
  assert.equal(payload.valid, true);
  assert.equal(payload.networkAccessed, false);
  assert.equal(payload.writePerformed, false);
});

test("open-world delegates source-manifest dry-run and write without changing its JSON contract", (t) => {
  const fixture = createLegacyRepository(t);
  fs.mkdirSync(path.join(fixture.repository, "review"));
  fs.writeFileSync(path.join(fixture.repository, "src.txt"), "committed source\n");
  runGit(fixture.repository, ["add", "--", "src.txt"]);
  runGit(fixture.repository, ["commit", "--quiet", "-m", "add source"]);
  const common = [
    "open-world",
    "source-manifest",
    "--repo-root", fixture.repository,
    "--output-dir", "review/source-closure-v1",
    "--repository-uri", "https://github.com/example/open-world-source",
    "--numeric-repository-id", "987654321",
    "--required-role", "src.txt=contract"
  ];

  const preview = run(common, fixture.repository);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  assert.equal(preview.stderr, "");
  const previewPayload = JSON.parse(preview.stdout);
  assert.equal(preview.stdout, `${canonicalJson(previewPayload)}\n`);
  assert.equal(previewPayload.schemaId, "urn:programmable:source-manifest-cli-report:1.0.0");
  assert.equal(previewPayload.status, "READY_TO_WRITE");
  assert.equal(previewPayload.writePerformed, false);
  assert.equal(previewPayload.safety.networkAccessed, false);
  assert.equal(previewPayload.safety.candidateCodeExecuted, false);
  assert.equal(fs.existsSync(path.join(fixture.repository, "review", "source-closure-v1")), false);

  const written = run([...common, "--write"], fixture.repository);
  assert.equal(written.status, 0, written.stdout || written.stderr);
  const writtenPayload = JSON.parse(written.stdout);
  assert.equal(writtenPayload.status, "WRITTEN_UNCOMMITTED_METADATA");
  assert.equal(writtenPayload.writePerformed, true);
  assert.equal(
    fs.existsSync(path.join(fixture.repository, "review", "source-closure-v1", "source-closure-manifest.v1.json")),
    true
  );
});

test("init captures exact public-safe UTF-8 by hash, previews by default, writes atomically, then validates", (t) => {
  const fixture = createLegacyRepository(t);
  const ideaRelativePath = "ideas/maps-game.txt";
  const ideaPath = path.join(fixture.repository, ...ideaRelativePath.split("/"));
  const idea = "Baue ein kreatives Maps-Spiel: Gewinner erhalten faire Token-Rewards. 🗺️\nKeep the architecture open.\n";
  fs.mkdirSync(path.dirname(ideaPath));
  fs.mkdirSync(path.join(fixture.repository, "drafts"));
  fs.writeFileSync(ideaPath, idea, "utf8");
  const output = "drafts/maps-game";
  const absoluteOutput = path.join(fixture.repository, ...output.split("/"));

  const preview = run([
    "open-world",
    "init",
    "--application-id",
    "maps-game",
    "--idea-file",
    ideaRelativePath,
    "--output",
    output,
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  assert.equal(preview.stderr, "");
  assert.doesNotMatch(preview.stdout, /Baue ein kreatives Maps-Spiel/u);
  assert.doesNotMatch(preview.stdout, /Keep the architecture open/u);
  const previewPayload = JSON.parse(preview.stdout);
  assert.equal(preview.stdout, `${canonicalJson(previewPayload)}\n`);
  assert.equal(previewPayload.result.action, "init");
  assert.equal(previewPayload.result.dryRun, true);
  assert.equal(previewPayload.result.writePerformed, false);
  assert.equal(previewPayload.result.reviewRequired, true);
  assert.equal(previewPayload.result.confirmationCreated, false);
  assert.equal(previewPayload.result.readinessGranted, false);
  assert.equal(previewPayload.result.prototypeReady, false);
  assert.equal(previewPayload.result.applicationReady, false);
  assert.equal(previewPayload.result.feePolicyInstanceCreated, false);
  assert.equal(previewPayload.result.target.readiness, "UNCONFIRMED");
  assert.equal(previewPayload.result.report.status, "REVIEW_REQUIRED");
  assert.equal(previewPayload.result.ideaSource.path, ideaRelativePath);
  assert.equal(previewPayload.result.ideaSource.byteLength, Buffer.byteLength(idea));
  assert.equal(previewPayload.result.ideaSource.sha256, sha256(Buffer.from(idea, "utf8")));
  assert.deepEqual(previewPayload.result.files.map(({ path: filePath }) => filePath), expectedDraftFiles);
  assert.ok(previewPayload.result.files.every((record) => !Object.hasOwn(record, "content")));
  assert.equal(fs.existsSync(absoluteOutput), false);

  const written = run([
    "open-world",
    "init",
    "--application-id",
    "maps-game",
    "--idea-file",
    ideaRelativePath,
    "--output",
    output,
    "--write",
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(written.status, 0, written.stdout || written.stderr);
  assert.doesNotMatch(written.stdout, /Baue ein kreatives Maps-Spiel/u);
  const writtenPayload = JSON.parse(written.stdout);
  assert.equal(writtenPayload.result.writePerformed, true);
  assert.equal(writtenPayload.result.materialization.atomicDirectoryRename, true);
  assert.deepEqual(fs.readdirSync(absoluteOutput).sort(), expectedDraftFiles);
  const ideaSource = JSON.parse(fs.readFileSync(path.join(absoluteOutput, "idea-source.v1.json"), "utf8"));
  assert.equal(ideaSource.entries[0].publicTextUtf8, idea);
  assert.equal(ideaSource.entries[0].byteLength, Buffer.byteLength(idea));
  assert.equal(ideaSource.entries[0].sha256, sha256(Buffer.from(idea, "utf8")));
  const security = JSON.parse(fs.readFileSync(path.join(absoluteOutput, "security-assessment.v1.json"), "utf8"));
  assert.equal(security.subject.stage, "proposal");
  assert.deepEqual(security.assessment, {
    evidenceRefs: [],
    reasonCode: "SOURCE_NOT_YET_AVAILABLE",
    sourceCoverage: null,
    state: "unassessed"
  });
  assert.deepEqual(security.layers.intent.evidenceRefs, []);
  const submission = JSON.parse(fs.readFileSync(path.join(absoluteOutput, "submission.v2.json"), "utf8"));
  assert.equal(submission.supportingPackage.feePolicy, null);
  assert.equal(submission.supportingPackage.feePolicySchema.path, "fee-policy-v2.schema.json");
  assert.equal(submission.supportingPackage.securityAssessmentSchema.path, "security-assessment-v1.schema.json");

  const validated = run([
    "open-world",
    "validate",
    output,
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(validated.status, 0, validated.stdout || validated.stderr);
  const validationPayload = JSON.parse(validated.stdout);
  assert.equal(validationPayload.result.valid, true);
  assert.equal(validationPayload.result.report.status, "REVIEW_REQUIRED");

  const ungroundedPrototype = path.join(fixture.repository, "drafts", "ungrounded-prototype");
  fs.cpSync(absoluteOutput, ungroundedPrototype, { recursive: true });
  const prototypeSubmissionPath = path.join(ungroundedPrototype, "submission.v2.json");
  const prototypeSubmission = JSON.parse(fs.readFileSync(prototypeSubmissionPath, "utf8"));
  prototypeSubmission.stage = "prototype";
  fs.writeFileSync(prototypeSubmissionPath, `${canonicalJson(prototypeSubmission)}\n`);
  const prototypeCheck = run([
    "open-world",
    "validate",
    "drafts/ungrounded-prototype",
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(prototypeCheck.status, 1, prototypeCheck.stdout || prototypeCheck.stderr);
  const prototypePayload = JSON.parse(prototypeCheck.stdout);
  assert.equal(prototypePayload.error.code, "OPEN_WORLD_PACKAGE_INVALID");
  assert.ok(prototypePayload.error.details.report.findings.some(({ code }) => code === "PROTOTYPE_FEE_POLICY_INSTANCE_MISSING"));

  const beforeRefusal = snapshotDirectory(absoluteOutput);
  const refused = run([
    "open-world",
    "init",
    "--application-id",
    "maps-game",
    "--idea-file",
    ideaRelativePath,
    "--output",
    output,
    "--write",
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(refused.status, 1, refused.stdout || refused.stderr);
  assert.equal(JSON.parse(refused.stdout).error.code, "OUTPUT_TARGET_EXISTS");
  assert.deepEqual(snapshotDirectory(absoluteOutput), beforeRefusal);
  assert.deepEqual(temporaryMigrationEntries(path.dirname(absoluteOutput)), []);
});

test("init routes a bounded large public idea to split review instead of rejecting the product", (t) => {
  const fixture = createLegacyRepository(t);
  fs.mkdirSync(path.join(fixture.repository, "ideas"));
  fs.mkdirSync(path.join(fixture.repository, "drafts"));
  const idea = `${"a".repeat((1024 * 1024) - 1)}\n`;
  fs.writeFileSync(path.join(fixture.repository, "ideas", "large.txt"), idea, "utf8");
  const result = run([
    "open-world",
    "init",
    "--application-id",
    "large-open-product",
    "--idea-file",
    "ideas/large.txt",
    "--output",
    "drafts/large-open-product",
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.result.report.status, "SPLIT_REVIEW_REQUIRED");
  assert.equal(payload.result.report.splitReview.required, true);
  assert.ok(payload.result.report.splitReview.reasonCount > 0);
  assert.equal(payload.result.reviewRequired, true);
  assert.equal(payload.result.readinessGranted, false);
  assert.equal(payload.result.report.automaticMaterialization, false);
  assert.equal(payload.result.report.writePerformed, false);
  assert.deepEqual(payload.result.files, []);
  assert.equal(fs.existsSync(path.join(fixture.repository, "drafts", "large-open-product")), false);
  assert.ok(result.stdout.length < 100_000);

  const refusedWrite = run([
    "open-world",
    "init",
    "--application-id",
    "large-open-product-write",
    "--idea-file",
    "ideas/large.txt",
    "--output",
    "drafts/large-open-product-write",
    "--write",
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(refusedWrite.status, 1, refusedWrite.stdout || refusedWrite.stderr);
  const refusedPayload = JSON.parse(refusedWrite.stdout);
  assert.equal(refusedPayload.error.code, "OPEN_WORLD_DRAFT_REVIEW_HOLD");
  assert.equal(refusedPayload.error.details.writePerformed, false);
  assert.equal(fs.existsSync(path.join(fixture.repository, "drafts", "large-open-product-write")), false);
});

test("init holds possible secrets before dry-run or write and never echoes the idea", (t) => {
  const fixture = createLegacyRepository(t);
  const ideaRelativePath = "ideas/private.txt";
  const ideaPath = path.join(fixture.repository, ...ideaRelativePath.split("/"));
  const secret = "api_key=sk-abcdefghijklmnopqrstuvwxyz123456";
  fs.mkdirSync(path.dirname(ideaPath));
  fs.mkdirSync(path.join(fixture.repository, "drafts"));
  fs.writeFileSync(ideaPath, `${secret}\nDo not expose this full sentence.\n`, "utf8");

  for (const [mode, output] of [[[], "drafts/private-preview"], [["--write"], "drafts/private-write"]]) {
    const result = run([
      "open-world",
      "init",
      "--application-id",
      "private-idea",
      "--idea-file",
      ideaRelativePath,
      "--output",
      output,
      ...mode,
      "--repository-root",
      fixture.repository
    ], fixture.repository);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, /sk-abcdefghijklmnopqrstuvwxyz123456/u);
    assert.doesNotMatch(result.stdout, /Do not expose this full sentence/u);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, "PUBLIC_IDEA_REDACTION_REQUIRED");
    assert.equal(payload.error.details.writePerformed, false);
    assert.equal(payload.error.details.report.ideaEligibility, "HELD_FOR_PRIVACY_REDACTION");
    const finding = payload.error.details.report.findings.find(({ code }) => code === "MANUAL_REDACTION_REQUIRED");
    assert.deepEqual(finding.details.candidateKinds, ["api-access-token", "explicit-secret-assignment"]);
    assert.equal(fs.existsSync(path.join(fixture.repository, ...output.split("/"))), false);
  }

  const heldExamples = [
    {
      id: "private-key",
      text: ["-----BEGIN", "PRIVATE KEY-----\nnot-public-material\n"].join(" "),
      candidateKind: "private-key"
    },
    {
      id: "seed-phrase",
      text: "seed phrase: apple beach candle dream eagle forest grape hotel island jungle kitten lemon\n",
      candidateKind: "seed-phrase"
    },
    {
      id: "private-pii",
      text: "passport number: ABCD1234\n",
      candidateKind: "private-pii"
    }
  ];
  for (const example of heldExamples) {
    const relativePath = `ideas/${example.id}.txt`;
    fs.writeFileSync(path.join(fixture.repository, ...relativePath.split("/")), example.text, "utf8");
    const output = `drafts/held-${example.id}`;
    const result = run([
      "open-world",
      "init",
      "--application-id",
      `held-${example.id}`,
      "--idea-file",
      relativePath,
      "--output",
      output,
      "--write",
      "--repository-root",
      fixture.repository
    ], fixture.repository);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    assert.equal(result.stdout.includes(example.text.trim()), false);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, "PUBLIC_IDEA_REDACTION_REQUIRED");
    const candidateKinds = payload.error.details.report.findings
      .find(({ code }) => code === "MANUAL_REDACTION_REQUIRED")
      .details.candidateKinds;
    assert.ok(candidateKinds.includes(example.candidateKind));
    assert.equal(fs.existsSync(path.join(fixture.repository, ...output.split("/"))), false);
  }
  assert.deepEqual(temporaryMigrationEntries(path.join(fixture.repository, "drafts")), []);
});

test("init refuses inline ideas, invalid UTF-8, unsafe paths, symlinks, and conflicting modes without output", (t) => {
  const fixture = createLegacyRepository(t);
  fs.mkdirSync(path.join(fixture.repository, "ideas"));
  fs.mkdirSync(path.join(fixture.repository, "drafts"));
  fs.writeFileSync(path.join(fixture.repository, "ideas", "invalid.txt"), Buffer.from([0xc3, 0x28]));
  fs.writeFileSync(path.join(fixture.repository, "ideas", "safe.txt"), "One public-safe idea.\n");
  const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-idea-outside-"));
  t.after(() => fs.rmSync(externalDirectory, { recursive: true, force: true }));
  const outsideIdea = path.join(externalDirectory, "idea.txt");
  fs.writeFileSync(outsideIdea, "Safe words, unsafe location.\n");
  fs.symlinkSync(outsideIdea, path.join(fixture.repository, "ideas", "linked.txt"));
  const danglingOutput = path.join(fixture.repository, "drafts", "dangling");
  fs.symlinkSync(path.join(externalDirectory, "missing-target"), danglingOutput);

  const common = ["open-world", "init", "--application-id", "bad-input", "--output", "drafts/rejected", "--repository-root", fixture.repository];
  const invalidUtf8 = run([...common, "--idea-file", "ideas/invalid.txt"], fixture.repository);
  assert.equal(invalidUtf8.status, 1, invalidUtf8.stdout || invalidUtf8.stderr);
  assert.equal(JSON.parse(invalidUtf8.stdout).error.code, "PUBLIC_IDEA_FILE_INVALID");

  const outside = run([...common, "--idea-file", outsideIdea], fixture.repository);
  assert.notEqual(outside.status, 0, outside.stdout || outside.stderr);
  assert.equal(JSON.parse(outside.stdout).error.code, "INVALID_PATH");

  const symlink = run([...common, "--idea-file", "ideas/linked.txt"], fixture.repository);
  assert.notEqual(symlink.status, 0, symlink.stdout || symlink.stderr);
  assert.equal(JSON.parse(symlink.stdout).error.code, "INVALID_PATH");

  const conflict = run([...common, "--idea-file", "ideas/invalid.txt", "--write", "--dry-run"], fixture.repository);
  assert.equal(conflict.status, 2, conflict.stdout || conflict.stderr);
  assert.equal(JSON.parse(conflict.stdout).error.code, "USAGE_ERROR");

  const inline = run([...common, "--idea", "never accepted inline"], fixture.repository);
  assert.equal(inline.status, 2, inline.stdout || inline.stderr);
  assert.equal(JSON.parse(inline.stdout).error.code, "USAGE_ERROR");
  assert.doesNotMatch(inline.stdout, /never accepted inline/u);
  const dangling = run([
    "open-world",
    "init",
    "--application-id",
    "dangling-target",
    "--idea-file",
    "ideas/safe.txt",
    "--output",
    "drafts/dangling",
    "--write",
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(dangling.status, 1, dangling.stdout || dangling.stderr);
  assert.equal(JSON.parse(dangling.stdout).error.code, "OUTPUT_TARGET_EXISTS");
  assert.equal(fs.lstatSync(danglingOutput).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(fixture.repository, "drafts", "rejected")), false);
});

test("migration is a hash-only dry-run by default and writes one new package only with --write", (t) => {
  const fixture = createLegacyRepository(t);
  const output = "migrations/open-world-v2";
  const absoluteOutput = path.join(fixture.repository, ...output.split("/"));

  const preview = run([
    "open-world",
    "migrate",
    fixture.submissionRelativePath,
    "--output",
    output,
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  assert.equal(preview.stderr, "");
  const previewPayload = JSON.parse(preview.stdout);
  assert.equal(preview.stdout, `${canonicalJson(previewPayload)}\n`);
  assert.equal(previewPayload.ok, true);
  assert.equal(previewPayload.command, "open-world");
  assert.equal(previewPayload.result.dryRun, true);
  assert.equal(previewPayload.result.writePerformed, false);
  assert.equal(previewPayload.result.networkAccessed, false);
  assert.equal(previewPayload.result.reviewRequired, true);
  assert.equal(previewPayload.result.confirmationCreated, false);
  assert.equal(previewPayload.result.readinessGranted, false);
  assert.equal(previewPayload.result.prototypeReady, false);
  assert.equal(previewPayload.result.applicationReady, false);
  assert.equal(previewPayload.result.feePolicyInstanceCreated, false);
  assert.equal(previewPayload.result.source.commit, fixture.commit);
  assert.equal(previewPayload.result.source.tree, fixture.tree);
  assert.deepEqual(previewPayload.result.files.map(({ path: filePath }) => filePath).sort(), expectedMigrationFiles);
  assert.ok(previewPayload.result.files.every((record) => !Object.hasOwn(record, "content")));
  assert.equal(fs.existsSync(absoluteOutput), false);

  const written = run([
    "open-world",
    "migrate",
    fixture.submissionRelativePath,
    "--output",
    output,
    "--write",
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(written.status, 0, written.stdout || written.stderr);
  const writtenPayload = JSON.parse(written.stdout);
  assert.equal(writtenPayload.result.dryRun, false);
  assert.equal(writtenPayload.result.writePerformed, true);
  assert.equal(writtenPayload.result.materialization.atomicDirectoryRename, true);
  assert.equal(writtenPayload.result.materialization.overwritten, false);
  assert.deepEqual(fs.readdirSync(absoluteOutput).sort(), expectedMigrationFiles);
  const beforeRefusal = snapshotDirectory(absoluteOutput);

  const validated = run([
    "open-world",
    "validate",
    output,
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(validated.status, 0, validated.stdout || validated.stderr);
  const validationPayload = JSON.parse(validated.stdout);
  assert.equal(validationPayload.result.valid, true);
  assert.equal(validationPayload.result.readOnly, true);
  assert.equal(validationPayload.result.writePerformed, false);
  assert.equal(validationPayload.result.networkAccessed, false);
  const migratedSubmission = JSON.parse(fs.readFileSync(path.join(absoluteOutput, "submission.v2.json"), "utf8"));
  assert.deepEqual(migratedSubmission.tradeCapability, {
    applicability: "unresolved",
    facetEntryRef: "routing-trade-capability",
    markets: []
  });

  const refused = run([
    "open-world",
    "migrate",
    fixture.submissionRelativePath,
    "--output",
    output,
    "--write",
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(refused.status, 1, refused.stdout || refused.stderr);
  assert.equal(JSON.parse(refused.stdout).error.code, "OUTPUT_TARGET_EXISTS");
  assert.deepEqual(snapshotDirectory(absoluteOutput), beforeRefusal);
  assert.deepEqual(temporaryMigrationEntries(path.dirname(absoluteOutput)), []);
});

test("migration refuses uncommitted source bytes, outside destinations, and conflicting mode flags", (t) => {
  const fixture = createLegacyRepository(t);
  const sourcePath = path.join(fixture.repository, ...fixture.submissionRelativePath.split("/"));
  fs.appendFileSync(sourcePath, " \n");

  const stale = run([
    "open-world",
    "migrate",
    fixture.submissionRelativePath,
    "--output",
    "migrations/stale",
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(stale.status, 1, stale.stdout || stale.stderr);
  assert.equal(JSON.parse(stale.stdout).error.code, "SOURCE_NOT_BOUND_TO_HEAD");
  assert.equal(fs.existsSync(path.join(fixture.repository, "migrations", "stale")), false);

  const outside = run([
    "open-world",
    "migrate",
    fixture.submissionRelativePath,
    "--output",
    "../outside",
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(outside.status, 1, outside.stdout || outside.stderr);
  assert.equal(JSON.parse(outside.stdout).error.code, "OUTPUT_PATH_INVALID");

  const conflict = run([
    "open-world",
    "migrate",
    fixture.submissionRelativePath,
    "--output",
    "migrations/conflict",
    "--write",
    "--dry-run",
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(conflict.status, 2, conflict.stdout || conflict.stderr);
  assert.equal(JSON.parse(conflict.stdout).error.code, "USAGE_ERROR");
  assert.equal(fs.existsSync(path.join(fixture.repository, "migrations", "conflict")), false);
});

test("raw migration binding accepts inert LFS config without executing its process driver", (t) => {
  const fixture = createLegacyRepository(t);
  const marker = path.join(fixture.repository, "lfs-process-executed");
  const driver = path.join(fixture.repository, "lfs-driver.cjs");
  fs.writeFileSync(driver, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed");\n`);
  runGit(fixture.repository, ["config", "--local", "filter.lfs.process", `${process.execPath} ${driver}`]);
  runGit(fixture.repository, ["config", "--local", "filter.lfs.required", "true"]);

  const preview = run([
    "open-world",
    "migrate",
    fixture.submissionRelativePath,
    "--output",
    "migrations/lfs-safe",
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  assert.equal(JSON.parse(preview.stdout).result.writePerformed, false);
  assert.equal(fs.existsSync(marker), false);
});

test("validation failures stay read-only and return the report through the JSON error envelope", (t) => {
  const fixture = createLegacyRepository(t);
  const invalidPackage = path.join(fixture.repository, "invalid-open-world");
  fs.mkdirSync(invalidPackage);
  fs.writeFileSync(path.join(invalidPackage, "submission.v2.json"), "{}\n");
  const before = snapshotDirectory(invalidPackage);

  const result = run([
    "open-world",
    "validate",
    "invalid-open-world",
    "--repository-root",
    fixture.repository
  ], fixture.repository);
  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "PACKAGE_FILE_UNREADABLE");
  assert.deepEqual(snapshotDirectory(invalidPackage), before);
});

function createLegacyRepository(t) {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-open-world-cli-"));
  t.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  runGit(repository, ["init", "-q"]);
  runGit(repository, ["config", "user.name", "Programmable Test"]);
  runGit(repository, ["config", "user.email", "test@programmable.invalid"]);
  const submissionRelativePath = "legacy/submission.json";
  const submissionPath = path.join(repository, ...submissionRelativePath.split("/"));
  fs.mkdirSync(path.dirname(submissionPath), { recursive: true });
  fs.mkdirSync(path.join(repository, "migrations"));
  fs.writeFileSync(submissionPath, `${JSON.stringify(legacySubmissionFixture(), null, 2)}\n`);
  runGit(repository, ["add", "--", submissionRelativePath]);
  runGit(repository, ["commit", "-q", "-m", "legacy source"]);
  return {
    repository,
    submissionRelativePath,
    commit: runGit(repository, ["rev-parse", "HEAD"]).trim(),
    tree: runGit(repository, ["rev-parse", "HEAD^{tree}"]).trim()
  };
}

function legacySubmissionFixture() {
  return {
    $schema: "urn:programmable:v4-hook-submission:1.6.0",
    schemaVersion: 1,
    standardVersion: "1.6.0",
    stage: "proposal",
    model: {
      id: "legacy-open-world",
      name: "Legacy Open World",
      summary: "A legacy project whose original owner intent must be recaptured before review."
    },
    builder: {
      licenseDeclaration: "MIT"
    },
    programmableFee: {
      policyId: "programmable-volume-fee-v1",
      policyVersion: "1.1.0"
    },
    implementation: {
      sourcePaths: [],
      testPaths: []
    }
  };
}

function run(argumentsList, cwd = process.cwd()) {
  return childProcess.spawnSync(process.execPath, [cli, ...argumentsList], {
    cwd,
    encoding: "utf8",
    shell: false,
    env: process.env,
    timeout: 30_000,
    maxBuffer: 16_000_000
  });
}

function runOpenWorld(argumentsList, cwd = process.cwd()) {
  return childProcess.spawnSync(process.execPath, [openWorldCli, ...argumentsList], {
    cwd,
    encoding: "utf8",
    shell: false,
    env: process.env,
    timeout: 30_000,
    maxBuffer: 16_000_000
  });
}

function runGit(repository, argumentsList) {
  return childProcess.execFileSync("git", ["-C", repository, ...argumentsList], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function snapshotDirectory(directory) {
  return Object.fromEntries(fs.readdirSync(directory).sort().map((name) => [
    name,
    fs.readFileSync(path.join(directory, name)).toString("base64")
  ]));
}

function temporaryMigrationEntries(directory) {
  return fs.readdirSync(directory).filter((name) => /\.open-world-(?:lock|staging-)/u.test(name));
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}
