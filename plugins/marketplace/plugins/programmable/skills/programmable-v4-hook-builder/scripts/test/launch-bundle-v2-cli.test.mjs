import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  LAUNCH_BUNDLE_V2_CLI_EXIT,
  LAUNCH_BUNDLE_V2_CLI_SCHEMA_ID,
  parseLaunchBundleV2CliArgs,
  runLaunchBundleV2Cli
} from "../launch-bundle-v2.mjs";
import { createExactContentBindingV2 } from "../launch-bundle-v2-core.mjs";
import { safeGitEnvironment } from "../repository-root.mjs";
import { canonicalJson } from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(testDirectory, "..", "launch-bundle-v2.mjs");

test("--help documents repeatable exact Git roots, read-only boundary and deterministic exit codes", () => {
  const execution = childProcess.spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  for (const expected of [
    "--input-root",
    "--source-root <source-ref>=<directory>",
    "--registry-root <source-ref>=<directory>",
    "--evidence-root <source-ref>=<directory>",
    "HEAD commit, HEAD tree, ls-tree path/blob membership",
    "NOT_AUTHORIZED",
    "network, RPC, signing, broadcasting, deployment",
    "0  All bytes and all declared Git snapshots matched",
    "3  No conflict"
  ]) assert.match(execution.stdout, new RegExp(escapeRegExp(expected)));
  assert.equal(execution.stderr, "");
});

test("argument parsing requires mapped roots and rejects duplicates, hidden writes and unsafe paths", () => {
  assert.throws(
    () => parseLaunchBundleV2CliArgs(["prepare", "--write", "out.json"]),
    ({ code }) => code === "ARGUMENT_UNKNOWN"
  );
  assert.throws(
    () => parseLaunchBundleV2CliArgs([
      "prepare",
      "--input-root", "input",
      "--input", "../escape.json",
      "--source-root", "primary-source=source",
      "--registry-root", "registry-source=registry",
      "--evidence-root", "evidence-source=evidence"
    ]),
    ({ code }) => code === "INPUT_PATH_UNSAFE"
  );
  assert.throws(
    () => parseLaunchBundleV2CliArgs([
      "prepare",
      "--input-root", "input",
      "--input", "bundle.json",
      "--source-root", "primary-source=source",
      "--registry-root", "registry-source=registry"
    ]),
    ({ code, argument }) => code === "ARGUMENT_REQUIRED" && argument === "--evidence-root"
  );
  assert.throws(
    () => parseLaunchBundleV2CliArgs([
      "prepare",
      "--input-root", "input",
      "--input", "bundle.json",
      "--source-root", "primary-source=source",
      "--registry-root", "primary-source=registry",
      "--evidence-root", "evidence-source=evidence"
    ]),
    ({ code }) => code === "SOURCE_ROOT_MAPPING_DUPLICATE"
  );

  const rejected = childProcess.spawnSync(process.execPath, [cliPath, "prepare", "--write", "out.json"], { encoding: "utf8" });
  assert.equal(rejected.status, LAUNCH_BUNDLE_V2_CLI_EXIT.USAGE_OR_INPUT);
  const envelope = JSON.parse(rejected.stdout);
  assert.equal(envelope.$schema, LAUNCH_BUNDLE_V2_CLI_SCHEMA_ID);
  assert.equal(envelope.completed, false);
  assert.equal(envelope.status, "NOT_AUTHORIZED");
  assert.equal(envelope.error.code, "ARGUMENT_UNKNOWN");
  assert.deepEqual(envelope.externalActionsPerformed, []);
  assert.equal(envelope.networkAccessed, false);
  assert.equal(envelope.rpcAccessed, false);
  assert.equal(envelope.writePerformed, false);
});

test("multiple exact Git repositories with identical paths remain sourceRef-bound and deterministic", (t) => {
  const fixture = cliFixture(t);
  const before = snapshotRoots(fixture.roots);
  const first = executeFixture(fixture, matchedCoreReport);
  const second = executeFixture(fixture, matchedCoreReport);

  assert.equal(first.exitCode, LAUNCH_BUNDLE_V2_CLI_EXIT.MATCHED, first.stdout);
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(snapshotRoots(fixture.roots), before);
  const envelope = JSON.parse(first.stdout);
  assert.equal(first.stdout, `${canonicalJson(envelope)}\n`);
  assert.equal(envelope.completed, true);
  assert.equal(envelope.result, "MATCHED");
  assert.equal(envelope.status, "NOT_AUTHORIZED");
  assert.equal(envelope.authorization.inherited, false);
  assert.equal(envelope.authorization.adminAuthorization, null);
  assert.equal(envelope.authorization.canSign, false);
  assert.equal(envelope.authorization.canBroadcast, false);
  assert.equal(envelope.authorization.canDeploy, false);
  assert.equal(envelope.authorization.canExecute, false);
  assert.equal(envelope.filesystemVerification.state, "MATCHED");
  assert.equal(envelope.filesystemVerification.gitSnapshotVerified, true);
  assert.equal(envelope.filesystemVerification.repositories.length, 4);
  assert.ok(envelope.filesystemVerification.repositories.every(({ state }) => state === "MATCHED"));
  assert.ok(envelope.filesystemVerification.artifacts.length >= 11);
  assert.ok(envelope.filesystemVerification.artifacts.every(({ state }) => state === "MATCHED"));
  assert.equal(envelope.filesystemVerification.artifacts.find(({ role }) => role === "execution-surface-coverage").rootRole, "registry");
  assert.equal(envelope.filesystemVerification.artifacts.find(({ role }) => role === "trade-capability").rootRole, "source");
  assert.equal(envelope.filesystemVerification.artifacts.find(({ role }) => role === "registry-acceptance").rootRole, "registry");
  const shared = envelope.filesystemVerification.artifacts.filter(({ path: artifactPath }) => artifactPath === "shared/result.json");
  assert.equal(shared.length, 2);
  assert.notEqual(shared[0].actualSha256, shared[1].actualSha256);
  assert.deepEqual(envelope.externalActionsPerformed, []);
  assert.equal(envelope.networkAccessed, false);
  assert.equal(envelope.rpcAccessed, false);
  assert.equal(envelope.writePerformed, false);
  for (const absoluteRoot of Object.values(fixture.roots)) assert.equal(first.stdout.includes(absoluteRoot), false);
});

test("dirty files and symlinks fail closed instead of becoming alternate artifact sources", (t) => {
  const tampered = cliFixture(t);
  fs.appendFileSync(path.join(tampered.roots.primarySource, "submission.v2.json"), "tamper");
  const tamperedExecution = executeFixture(tampered, matchedCoreReport);
  assert.equal(tamperedExecution.exitCode, LAUNCH_BUNDLE_V2_CLI_EXIT.CONFLICT);
  const tamperedEnvelope = JSON.parse(tamperedExecution.stdout);
  const submission = tamperedEnvelope.filesystemVerification.artifacts.find(({ role }) => role === "submission");
  assert.equal(submission.state, "CONFLICT");
  assert.equal(submission.code, "ARTIFACT_WORKING_BYTES_MISMATCH");

  const escaped = cliFixture(t);
  const evidencePath = path.join(escaped.roots.evidenceSource, "shared", "result.json");
  const outside = path.join(escaped.root, "outside-system-test.json");
  fs.writeFileSync(outside, fs.readFileSync(evidencePath));
  fs.unlinkSync(evidencePath);
  fs.symlinkSync(outside, evidencePath);
  const escapedExecution = executeFixture(escaped, matchedCoreReport);
  assert.equal(escapedExecution.exitCode, LAUNCH_BUNDLE_V2_CLI_EXIT.CONFLICT);
  const escapedEnvelope = JSON.parse(escapedExecution.stdout);
  const escapedArtifact = escapedEnvelope.filesystemVerification.artifacts.find(({ id }) => id === "system-test");
  assert.equal(escapedArtifact.state, "CONFLICT");
  assert.equal(escapedArtifact.code, "PATH_SYMLINK_FORBIDDEN");
});

test("wrong, missing and non-Git source mappings cannot claim Git verification", (t) => {
  const wrongRoot = cliFixture(t);
  let execution = executeFixture(wrongRoot, matchedCoreReport, {
    rootOverrides: { "primary-source": wrongRoot.roots.evidenceSource }
  });
  let envelope = JSON.parse(execution.stdout);
  assert.equal(execution.exitCode, LAUNCH_BUNDLE_V2_CLI_EXIT.CONFLICT);
  assert.equal(envelope.filesystemVerification.gitSnapshotVerified, false);
  assert.ok(envelope.filesystemVerification.repositories.some(({ sourceRef, code }) => (
    sourceRef === "primary-source" && code === "GIT_HEAD_COMMIT_MISMATCH"
  )));

  const missing = cliFixture(t);
  execution = executeFixture(missing, matchedCoreReport, { omitSourceRefs: ["primary-source"] });
  envelope = JSON.parse(execution.stdout);
  assert.equal(execution.exitCode, LAUNCH_BUNDLE_V2_CLI_EXIT.UNRESOLVED);
  assert.equal(envelope.result, "UNRESOLVED");
  assert.equal(envelope.filesystemVerification.gitSnapshotVerified, false);
  assert.ok(envelope.filesystemVerification.repositories.some(({ sourceRef, code }) => (
    sourceRef === "primary-source" && code === "SOURCE_ROOT_MAPPING_MISSING"
  )));

  const nonGit = cliFixture(t);
  execution = executeFixture(nonGit, matchedCoreReport, {
    rootOverrides: { "evidence-source": nonGit.roots.inputRoot }
  });
  envelope = JSON.parse(execution.stdout);
  assert.equal(execution.exitCode, LAUNCH_BUNDLE_V2_CLI_EXIT.UNRESOLVED);
  assert.equal(envelope.filesystemVerification.gitSnapshotVerified, false);
  assert.ok(envelope.filesystemVerification.repositories.some(({ sourceRef, code }) => (
    sourceRef === "evidence-source" && code === "GIT_REPOSITORY_UNVERIFIED"
  )));
});

test("declared commit and tree drift are conflicts even when working bytes happen to match", (t) => {
  const wrongCommit = cliFixture(t);
  mutateInput(wrongCommit, (input) => {
    input.sources.find(({ id }) => id === "primary-source").revisionObjectId = "f".repeat(40);
  });
  let execution = executeFixture(wrongCommit, matchedCoreReport);
  let envelope = JSON.parse(execution.stdout);
  assert.equal(execution.exitCode, LAUNCH_BUNDLE_V2_CLI_EXIT.CONFLICT);
  assert.ok(envelope.filesystemVerification.repositories.some(({ code }) => code === "GIT_HEAD_COMMIT_MISMATCH"));

  const wrongTree = cliFixture(t);
  mutateInput(wrongTree, (input) => {
    input.sources.find(({ id }) => id === "primary-source").treeObjectId = "e".repeat(40);
  });
  execution = executeFixture(wrongTree, matchedCoreReport);
  envelope = JSON.parse(execution.stdout);
  assert.equal(execution.exitCode, LAUNCH_BUNDLE_V2_CLI_EXIT.CONFLICT);
  assert.ok(envelope.filesystemVerification.repositories.some(({ code }) => code === "GIT_HEAD_TREE_MISMATCH"));
});

test("legitimate local Git LFS filter configuration is accepted by raw plumbing", (t) => {
  const fixture = cliFixture(t);
  git(fixture.roots.primarySource, ["config", "filter.lfs.clean", "git-lfs clean -- %f"]);
  git(fixture.roots.primarySource, ["config", "filter.lfs.smudge", "git-lfs smudge -- %f"]);
  git(fixture.roots.primarySource, ["config", "filter.lfs.process", "git-lfs filter-process"]);
  git(fixture.roots.primarySource, ["config", "filter.lfs.required", "true"]);

  const execution = executeFixture(fixture, matchedCoreReport);
  assert.equal(execution.exitCode, LAUNCH_BUNDLE_V2_CLI_EXIT.MATCHED, execution.stdout);
  assert.equal(JSON.parse(execution.stdout).filesystemVerification.state, "MATCHED");
});

test("untrusted Git fsmonitor and filter configuration are never executed by raw plumbing", (t) => {
  const fixture = cliFixture(t);
  const monitorMarker = path.join(fixture.root, "fsmonitor-invoked");
  const filterMarker = path.join(fixture.root, "filter-invoked");
  const monitor = path.join(fixture.root, "malicious-fsmonitor.sh");
  const filter = path.join(fixture.root, "malicious-filter.sh");
  fs.writeFileSync(monitor, `#!/bin/sh\nprintf invoked > ${shellQuote(monitorMarker)}\n`);
  fs.writeFileSync(filter, `#!/bin/sh\nprintf invoked > ${shellQuote(filterMarker)}\ncat\n`);
  fs.chmodSync(monitor, 0o700);
  fs.chmodSync(filter, 0o700);
  git(fixture.roots.primarySource, ["config", "core.fsmonitor", monitor]);
  git(fixture.roots.primarySource, ["config", "filter.lfs.clean", filter]);
  git(fixture.roots.primarySource, ["config", "filter.lfs.smudge", filter]);
  git(fixture.roots.primarySource, ["config", "filter.lfs.process", filter]);
  git(fixture.roots.primarySource, ["config", "filter.lfs.required", "true"]);

  const execution = executeFixture(fixture, matchedCoreReport);
  assert.equal(execution.exitCode, LAUNCH_BUNDLE_V2_CLI_EXIT.MATCHED, execution.stdout);
  assert.equal(fs.existsSync(monitorMarker), false);
  assert.equal(fs.existsSync(filterMarker), false);
});

test("bounded no-follow reads reject oversized input and detect file identity changes", (t) => {
  const oversized = cliFixture(t);
  fs.truncateSync(path.join(oversized.roots.inputRoot, oversized.inputPath), (64 * 1024 * 1024) + 1);
  let execution = executeFixture(oversized, matchedCoreReport);
  let envelope = JSON.parse(execution.stdout);
  assert.equal(execution.exitCode, LAUNCH_BUNDLE_V2_CLI_EXIT.USAGE_OR_INPUT);
  assert.equal(envelope.error.code, "FILE_TOO_LARGE");

  const changed = cliFixture(t);
  let fstatCalls = 0;
  const changingFs = Object.create(fs);
  changingFs.fstatSync = (descriptor) => {
    const observed = fs.fstatSync(descriptor);
    fstatCalls += 1;
    if (fstatCalls !== 2) return observed;
    return {
      ...observed,
      ino: Number(observed.ino) + 1,
      isFile: () => observed.isFile()
    };
  };
  let stdout = "";
  const options = executionOptions(changed);
  options.fsApi = changingFs;
  options.prepare = matchedCoreReport;
  options.stdout = { write(value) { stdout += value; } };
  const exitCode = runLaunchBundleV2Cli(options);
  envelope = JSON.parse(stdout);
  assert.equal(exitCode, LAUNCH_BUNDLE_V2_CLI_EXIT.USAGE_OR_INPUT);
  assert.equal(envelope.error.code, "FILE_CHANGED_DURING_READ");
});

test("raw launch input rejects same-value, conflicting and escaped duplicate keys before review", (t) => {
  const cases = [
    '{"sources":[],"sources":[]}',
    '{"privateKey":"duplicate-input-secret","privateKey":"redacted"}',
    '{"privateKey":"duplicate-input-secret","private\\u004bey":"redacted"}'
  ];

  for (const rawInput of cases) {
    const fixture = cliFixture(t);
    const inputFile = path.join(fixture.roots.inputRoot, ...fixture.inputPath.split("/"));
    fs.writeFileSync(inputFile, `${rawInput}\n`);
    const before = snapshotRoots(fixture.roots);

    const execution = executeFixture(fixture, matchedCoreReport);
    const envelope = JSON.parse(execution.stdout);

    assert.equal(execution.exitCode, LAUNCH_BUNDLE_V2_CLI_EXIT.USAGE_OR_INPUT);
    assert.equal(envelope.completed, false);
    assert.equal(envelope.error.code, "INPUT_JSON_INVALID");
    assert.equal(execution.stdout.includes("duplicate-input-secret"), false);
    assert.deepEqual(snapshotRoots(fixture.roots), before);
  }
});

test("unresolved core state has a distinct exit code and the real core cannot be bypassed", (t) => {
  const fixture = cliFixture(t);
  const unresolved = executeFixture(fixture, () => ({
    status: "NOT_AUTHORIZED",
    analysis: { conflicts: [], unresolved: [{ code: "OWNER_CONFIRMATION_PENDING" }] }
  }));
  assert.equal(unresolved.exitCode, LAUNCH_BUNDLE_V2_CLI_EXIT.UNRESOLVED);
  assert.equal(JSON.parse(unresolved.stdout).result, "UNRESOLVED");

  const realCore = executeFixture(fixture);
  assert.equal(realCore.exitCode, LAUNCH_BUNDLE_V2_CLI_EXIT.CONFLICT);
  const realEnvelope = JSON.parse(realCore.stdout);
  assert.equal(realEnvelope.result, "CONFLICT");
  assert.equal(realEnvelope.report.status, "NOT_AUTHORIZED");
  assert.ok(realEnvelope.report.analysis.conflicts.length > 0);
});

function cliFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-launch-bundle-v2-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const roots = {
    inputRoot: path.join(root, "input"),
    primarySource: path.join(root, "primary-source"),
    companionSource: path.join(root, "companion-source"),
    registrySource: path.join(root, "registry-source"),
    evidenceSource: path.join(root, "evidence-source")
  };
  for (const directory of Object.values(roots)) fs.mkdirSync(directory, { recursive: true });

  const json = (id, sourceRef, artifactPath) => createExactContentBindingV2({
    id,
    sourceRef,
    path: artifactPath,
    schemaId: `urn:test:${id}:1.0.0`,
    content: `${canonicalJson({ id, sourceRef, testFixture: true })}\n`
  });
  const application = json("application", "registry-source", "application.json");
  const submission = json("submission", "primary-source", "submission.v2.json");
  const ideaSource = json("idea-source", "primary-source", "idea-source.v1.json");
  const intentContract = json("intent-contract", "primary-source", "intent-contract.v1.json");
  const architectureDecisions = json("architecture-decisions", "primary-source", "architecture-decisions.v1.json");
  const intentFidelity = json("intent-fidelity", "primary-source", "intent-fidelity.v1.json");
  const feePolicy = json("fee-policy", "primary-source", "fee-policy.v2.json");
  const security = json("security", "registry-source", "security-assessment.v1.json");
  const executionSurfaceCoverage = json("execution-surface-coverage", "registry-source", "execution-surface-coverage.v1.json");
  const tradeCapability = createExactContentBindingV2({
    id: "trade-capability-contract-market",
    sourceRef: "primary-source",
    path: "trade/contract-market.trade-capability.v1.json",
    schemaId: "urn:programmable:trade-capability-manifest:1.0.0",
    content: `${canonicalJson({ manifestId: "trade-capability-contract-market", testFixture: true })}\n`
  });
  const registryAcceptance = json("registry-acceptance", "registry-source", "registry/acceptances/test/1.v3.json");
  const evidence = [
    createExactContentBindingV2({
      id: "source-review",
      evidenceType: "source-review",
      sourceRef: "primary-source",
      path: "shared/result.json",
      schemaId: null,
      content: `${canonicalJson({ repository: "primary" })}\n`
    }),
    createExactContentBindingV2({
      id: "registry-review",
      evidenceType: "registry-review",
      sourceRef: "registry-source",
      path: "review/registry.json",
      schemaId: null,
      content: `${canonicalJson({ repository: "registry" })}\n`
    }),
    createExactContentBindingV2({
      id: "system-test",
      evidenceType: "future-custom-evidence-kind",
      sourceRef: "evidence-source",
      path: "shared/result.json",
      schemaId: null,
      content: `${canonicalJson({ repository: "evidence", result: "local-only" })}\n`
    }),
    createExactContentBindingV2({
      id: "companion-review",
      evidenceType: "companion-source-review",
      sourceRef: "companion-source",
      path: "review/companion.json",
      schemaId: null,
      content: `${canonicalJson({ repository: "companion" })}\n`
    })
  ];
  const artifacts = { application, submission, ideaSource, intentContract, architectureDecisions, intentFidelity, feePolicy, security, executionSurfaceCoverage, tradeCapabilities: [tradeCapability], registryAcceptance, evidence };
  fs.writeFileSync(path.join(roots.primarySource, ".gitattributes"), "*.json filter=lfs\n");
  for (const record of [submission, ideaSource, intentContract, architectureDecisions, intentFidelity, feePolicy, tradeCapability, evidence[0]]) materialize(roots.primarySource, record);
  materialize(roots.companionSource, evidence[3]);
  for (const record of [application, security, executionSurfaceCoverage, registryAcceptance, evidence[1]]) materialize(roots.registrySource, record);
  materialize(roots.evidenceSource, evidence[2]);

  const snapshots = {
    "primary-source": commitRepository(roots.primarySource),
    "companion-source": commitRepository(roots.companionSource),
    "registry-source": commitRepository(roots.registrySource),
    "evidence-source": commitRepository(roots.evidenceSource)
  };
  const sources = Object.entries(snapshots).map(([id, snapshot], index) => ({
    id,
    repositoryUri: `https://github.com/example/${id}`,
    numericRepositoryId: String(900000000 + index),
    revisionObjectId: snapshot.commit,
    treeObjectId: snapshot.tree
  }));
  const input = { sources, artifacts };
  const inputPath = "requests/launch-bundle.json";
  const inputAbsolutePath = path.join(roots.inputRoot, ...inputPath.split("/"));
  fs.mkdirSync(path.dirname(inputAbsolutePath), { recursive: true });
  fs.writeFileSync(inputAbsolutePath, `${canonicalJson(input)}\n`);
  const mappings = [
    { flag: "--source-root", sourceRef: "primary-source", root: roots.primarySource },
    { flag: "--source-root", sourceRef: "companion-source", root: roots.companionSource },
    { flag: "--registry-root", sourceRef: "registry-source", root: roots.registrySource },
    { flag: "--evidence-root", sourceRef: "evidence-source", root: roots.evidenceSource }
  ];
  return { root, roots, inputPath, mappings };
}

function materialize(root, binding) {
  const target = path.join(root, ...binding.path.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, binding.content);
}

function commitRepository(root) {
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Programmable Test"]);
  git(root, ["config", "user.email", "programmable-test@example.com"]);
  git(root, ["add", "--all"]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  return {
    commit: git(root, ["rev-parse", "HEAD"]).trim(),
    tree: git(root, ["rev-parse", "HEAD^{tree}"]).trim()
  };
}

function git(root, args) {
  const execution = childProcess.spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: safeGitEnvironment()
  });
  assert.equal(execution.status, 0, execution.stderr);
  return execution.stdout;
}

function executionOptions(fixture, { omitSourceRefs = [], rootOverrides = {} } = {}) {
  const argv = ["prepare", "--input-root", fixture.roots.inputRoot, "--input", fixture.inputPath];
  for (const mapping of fixture.mappings) {
    if (omitSourceRefs.includes(mapping.sourceRef)) continue;
    argv.push(mapping.flag, `${mapping.sourceRef}=${rootOverrides[mapping.sourceRef] ?? mapping.root}`);
  }
  return { argv };
}

function executeFixture(fixture, prepare, overrides = {}) {
  let stdout = "";
  const options = {
    ...executionOptions(fixture, overrides),
    stdout: { write(value) { stdout += value; } }
  };
  if (prepare !== undefined) options.prepare = prepare;
  return { exitCode: runLaunchBundleV2Cli(options), stdout };
}

function mutateInput(fixture, mutate) {
  const inputFile = path.join(fixture.roots.inputRoot, ...fixture.inputPath.split("/"));
  const input = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  mutate(input);
  fs.writeFileSync(inputFile, `${canonicalJson(input)}\n`);
}

function matchedCoreReport() {
  return {
    status: "NOT_AUTHORIZED",
    authorization: {
      approvalInherited: false,
      adminAuthorization: null,
      canSign: false,
      canBroadcast: false,
      canDeploy: false,
      canExecute: false
    },
    analysis: { conflicts: [], unresolved: [] },
    generatedTransactions: [],
    signatures: [],
    externalActionsPerformed: [],
    networkAccessed: false,
    writePerformed: false
  };
}

function snapshotRoots(roots) {
  const snapshot = {};
  for (const [role, root] of Object.entries(roots)) snapshot[role] = snapshotDirectory(root);
  return snapshot;
}

function snapshotDirectory(root) {
  const records = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isSymbolicLink()) records.push([relative, `symlink:${fs.readlinkSync(absolute)}`]);
      else records.push([relative, crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")]);
    }
  };
  visit(root);
  return records;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
