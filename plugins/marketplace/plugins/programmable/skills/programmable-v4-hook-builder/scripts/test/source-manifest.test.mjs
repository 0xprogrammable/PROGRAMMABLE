import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { verifyLocalSourceClosureManifestV1 } from "../public-pr-application-v3-core.mjs";
import { safeRawGitArguments, spawnSafeRawGitSync } from "../repository-root.mjs";
import {
  generateSourceClosureManifestV1,
  materializeSourceClosureManifestV1,
  parseSourceManifestCliArgs,
  runSourceManifestCli,
  SOURCE_MANIFEST_EXIT,
  SourceManifestError
} from "../source-manifest.mjs";
import { canonicalJson } from "../submission-core.mjs";

const repositoryIdentity = Object.freeze({
  repositoryUri: "https://github.com/example/source-project",
  numericRepositoryId: "987654321"
});

test("generator deterministically closes more than 4096 committed blobs across fragments", (t) => {
  const repositoryRoot = createRepository(t, 4103);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  const argumentsValue = {
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity,
    requiredRoleMappings: [
      { path: "src/file-0000.txt", roleId: "contract" },
      { path: "src/file-0000.txt", roleId: "primary-hook" }
    ],
    chunkMaxEntries: 997,
    chunkMaxBytes: 1024 * 1024
  };

  const first = generateSourceClosureManifestV1(argumentsValue);
  fs.writeFileSync(path.join(repositoryRoot, "src", "file-0000.txt"), "uncommitted replacement bytes\n");
  fs.writeFileSync(path.join(repositoryRoot, "untracked-candidate.sh"), "#!/bin/sh\nexit 99\n");
  const second = generateSourceClosureManifestV1(argumentsValue);
  assert.equal(first.stats.entryCount, 4103);
  assert.equal(first.stats.fragmentCount, 5);
  assert.equal(first.manifest.entryCount, 4103);
  assert.equal(first.manifest.fragmentCount, 5);
  assert.equal(first.deterministicPlanSha256, second.deterministicPlanSha256);
  assert.equal(canonicalJson(first.manifest), canonicalJson(second.manifest));
  assert.deepEqual(
    first.records.map(({ repositoryPath, sha256, blobObjectId }) => ({ repositoryPath, sha256, blobObjectId })),
    second.records.map(({ repositoryPath, sha256, blobObjectId }) => ({ repositoryPath, sha256, blobObjectId }))
  );
  const firstEntry = parseJsonlRecord(first.records.find(({ name }) => name.endsWith("000000.jsonl")).bytes, 0);
  assert.deepEqual(firstEntry.roleIds, ["contract", "primary-hook", "source"]);
  const closedPaths = first.records
    .filter(({ name }) => name.endsWith(".jsonl"))
    .flatMap(({ bytes }) => bytes.toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line).path));
  assert.deepEqual(closedPaths, [...closedPaths].sort(compareUtf8));
  assert.equal(new Set(closedPaths).size, closedPaths.length);
  assert.equal(closedPaths.some((repositoryPath) => repositoryPath.startsWith("review/source-closure-v1/")), false);
  assert.equal(first.safety.reservedManifestPathsExcludedFromEntryClosure, true);
  assert.equal(
    first.manifest.fragments.some(({ firstPath, lastPath }) => (
      firstPath.startsWith("review/source-closure-v1/") || lastPath.startsWith("review/source-closure-v1/")
    )),
    false
  );
  const rootRecord = first.records.find(({ name }) => name === "source-closure-manifest.v1.json");
  assert.equal(rootRecord.bytes.toString("utf8"), `${canonicalJson(first.manifest)}\n`);
  assert.equal("revisionObjectId" in first.manifest, false);
  assert.equal("treeObjectId" in first.manifest, false);
  assert.equal(rootRecord.bytes.includes(Buffer.from(first.sourceSnapshot.revisionObjectId, "ascii")), false);
  assert.equal(rootRecord.bytes.includes(Buffer.from(first.sourceSnapshot.treeObjectId, "ascii")), false);
});

test("written metadata commits into a new snapshot that the authoritative raw-Git verifier accepts", async (t) => {
  const repositoryRoot = createRepository(t, 12);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  const sourcePath = "src/file-00.txt";
  const committedSourceBytes = readGitBlob(repositoryRoot, `HEAD:${sourcePath}`);
  fs.writeFileSync(path.join(repositoryRoot, sourcePath), "uncommitted worktree bytes must not enter the closure\n");

  const plan = generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity,
    requiredRoleMappings: [{ path: sourcePath, roleId: "contract" }],
    chunkMaxEntries: 5
  });
  const firstEntry = parseJsonlRecord(plan.records.find(({ name }) => name.endsWith("000000.jsonl")).bytes, 0);
  assert.equal(firstEntry.sha256, sha256(committedSourceBytes));
  assert.notEqual(firstEntry.sha256, sha256(fs.readFileSync(path.join(repositoryRoot, sourcePath))));

  const materialized = materializeSourceClosureManifestV1(plan);
  assert.equal(materialized.atomicDirectoryRename, true);
  assert.equal(materialized.overwritten, false);
  runGit(repositoryRoot, ["add", "--", "review/source-closure-v1"]);
  runGit(repositoryRoot, ["commit", "--quiet", "-m", "add source closure metadata"]);

  const revisionObjectId = runGit(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const treeObjectId = runGit(repositoryRoot, ["rev-parse", "HEAD^{tree}"]).trim();
  const rootBlobObjectId = runGit(repositoryRoot, ["rev-parse", `HEAD:${plan.manifestBindingTemplate.path}`]).trim();
  assert.equal(rootBlobObjectId, plan.manifestBindingTemplate.blobObjectId);
  const repository = {
    id: "primary",
    ...repositoryIdentity,
    revisionObjectId,
    treeObjectId,
    sourceClosureMode: "manifest",
    sourcePaths: [],
    sourceManifest: plan.manifestBindingTemplate,
    contractPaths: [sourcePath],
    githubActionsRunIds: []
  };
  const report = await verifyLocalSourceClosureManifestV1({
    repositoryRoot,
    repository,
    manifest: plan.manifest,
    requiredEntries: [{ path: sourcePath, roleIds: ["contract"] }]
  });
  assert.equal(report.status, "VERIFIED", JSON.stringify(report.findings));
  assert.equal(report.sourceClosureVerified, true);
  assert.equal(report.stats.entriesVerified, 12);
  assert.equal(report.networkAccessed, false);
  assert.equal(report.candidateCodeExecuted, false);
});

test("post-metadata commits cannot add an unlisted blob outside the exact generated closure", async (t) => {
  const repositoryRoot = createRepository(t, 3);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  const plan = generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity,
    requiredRoleMappings: [{ path: "src/file-0.txt", roleId: "contract" }]
  });
  materializeSourceClosureManifestV1(plan);
  fs.writeFileSync(path.join(repositoryRoot, "unlisted-source.sol"), "contract Unlisted {}\n");
  runGit(repositoryRoot, ["add", "--", "review/source-closure-v1", "unlisted-source.sol"]);
  runGit(repositoryRoot, ["commit", "--quiet", "-m", "metadata plus unlisted source"]);

  const revisionObjectId = runGit(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const repository = {
    id: "primary",
    ...repositoryIdentity,
    revisionObjectId,
    treeObjectId: runGit(repositoryRoot, ["rev-parse", "HEAD^{tree}"]).trim(),
    sourceClosureMode: "manifest",
    sourcePaths: [],
    sourceManifest: plan.manifestBindingTemplate,
    contractPaths: ["src/file-0.txt"],
    githubActionsRunIds: []
  };
  const report = await verifyLocalSourceClosureManifestV1({
    repositoryRoot,
    repository,
    manifest: plan.manifest,
    requiredEntries: [{ path: "src/file-0.txt", roleIds: ["contract"] }]
  });
  assert.equal(report.sourceClosureVerified, false);
  assert.ok(
    report.findings.some(({ code, severity }) => code === "SOURCE_MANIFEST_TREE_CLOSURE_MISMATCH" && severity === "blocker"),
    JSON.stringify(report.findings)
  );
});

test("CLI is dry-run by default and writes only with explicit --write", (t) => {
  const repositoryRoot = createRepository(t, 3);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  const baseArguments = [
    "--repo-root", repositoryRoot,
    "--output-dir", "review/source-closure-v1",
    "--repository-uri", repositoryIdentity.repositoryUri,
    "--numeric-repository-id", repositoryIdentity.numericRepositoryId,
    "--required-role", "src/file-0.txt=contract",
    "--chunk-max-entries", "2"
  ];
  const dryOutput = captureOutput();
  const dryExit = runSourceManifestCli({ argv: baseArguments, stdout: dryOutput.stream });
  const dryReport = JSON.parse(dryOutput.value());
  assert.equal(dryExit, SOURCE_MANIFEST_EXIT.READY);
  assert.equal(dryReport.status, "READY_TO_WRITE");
  assert.equal(dryReport.writePerformed, false);
  assert.equal(fs.existsSync(path.join(repositoryRoot, "review", "source-closure-v1")), false);

  const writeOutput = captureOutput();
  const writeExit = runSourceManifestCli({ argv: [...baseArguments, "--write"], stdout: writeOutput.stream });
  const writeReport = JSON.parse(writeOutput.value());
  assert.equal(writeExit, SOURCE_MANIFEST_EXIT.READY, JSON.stringify(writeReport));
  assert.equal(writeReport.status, "WRITTEN_UNCOMMITTED_METADATA");
  assert.equal(writeReport.writePerformed, true);
  assert.equal(fs.existsSync(path.join(repositoryRoot, "review", "source-closure-v1", "source-closure-manifest.v1.json")), true);

  const repeatOutput = captureOutput();
  const repeatExit = runSourceManifestCli({ argv: [...baseArguments, "--write"], stdout: repeatOutput.stream });
  const repeatReport = JSON.parse(repeatOutput.value());
  assert.equal(repeatExit, SOURCE_MANIFEST_EXIT.HELD);
  assert.equal(repeatReport.error.code, "OUTPUT_TARGET_EXISTS");
});

test("raw object generation does not execute LFS, clean, smudge, process, diff, hook, or candidate files", (t) => {
  const repositoryRoot = createRepository(t, 2, {
    additionalFiles: {
      ".gitattributes": "*.bin filter=adversarial\n*.lfs filter=lfs\n",
      "assets/payload.bin": "raw committed payload\n",
      "assets/pointer.lfs": "version https://git-lfs.github.com/spec/v1\noid sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nsize 7\n",
      "scripts/candidate.sh": "#!/bin/sh\ntouch should-not-run\n"
    },
    executablePaths: ["scripts/candidate.sh"]
  });
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  const marker = path.join(repositoryRoot, "driver-executed.txt");
  const hookDirectory = path.join(repositoryRoot, ".git", "adversarial-hooks");
  const hookMarker = path.join(repositoryRoot, "hook-executed.txt");
  const fsmonitorMarker = path.join(repositoryRoot, "fsmonitor-executed.txt");
  fs.mkdirSync(hookDirectory);
  fs.writeFileSync(path.join(hookDirectory, "post-checkout"), `#!/bin/sh\ntouch ${hookMarker}\n`);
  fs.chmodSync(path.join(hookDirectory, "post-checkout"), 0o700);
  const fsmonitor = path.join(repositoryRoot, ".git", "adversarial-fsmonitor.sh");
  fs.writeFileSync(fsmonitor, `#!/bin/sh\ntouch ${fsmonitorMarker}\n`);
  fs.chmodSync(fsmonitor, 0o700);
  runGit(repositoryRoot, ["config", "filter.adversarial.clean", `touch ${marker}`]);
  runGit(repositoryRoot, ["config", "filter.adversarial.smudge", `touch ${marker}`]);
  runGit(repositoryRoot, ["config", "filter.adversarial.process", `touch ${marker}`]);
  runGit(repositoryRoot, ["config", "filter.lfs.process", `touch ${marker}`]);
  runGit(repositoryRoot, ["config", "diff.adversarial.textconv", `touch ${marker}`]);
  runGit(repositoryRoot, ["config", "core.hooksPath", hookDirectory]);
  runGit(repositoryRoot, ["config", "core.fsmonitor", fsmonitor]);

  const observedCommands = [];
  const plan = generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity,
    gitRunner(args, options) {
      observedCommands.push([...args]);
      return spawnSafeRawGitSync(args, options);
    }
  });
  assert.equal(plan.stats.entryCount, 6);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.existsSync(hookMarker), false);
  assert.equal(fs.existsSync(fsmonitorMarker), false);
  assert.ok(observedCommands.length > 0);
  assert.ok(observedCommands.every((args) => args.includes("rev-parse") || args.includes("cat-file")));
  assert.equal(plan.safety.gitFiltersOrLfsExecuted, false);
  assert.equal(plan.safety.candidateCodeExecuted, false);
  const entries = plan.records
    .filter(({ name }) => name.endsWith(".jsonl"))
    .flatMap(({ bytes }) => bytes.toString("utf8").trimEnd().split("\n").map(JSON.parse));
  const pointerBytes = readGitBlob(repositoryRoot, "HEAD:assets/pointer.lfs");
  assert.equal(entries.find(({ path: repositoryPath }) => repositoryPath === "assets/pointer.lfs").sha256, sha256(pointerBytes));
});

test("raw generation ignores Git replace refs, the index, and changed worktree bytes", (t) => {
  const repositoryRoot = createRepository(t, 2);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  const originalCommit = runGit(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const originalTree = runGit(repositoryRoot, ["rev-parse", "HEAD^{tree}"]).trim();
  const sourcePath = "src/file-0.txt";
  const originalBytes = readGitBlob(repositoryRoot, `${originalCommit}:${sourcePath}`);
  fs.writeFileSync(path.join(repositoryRoot, sourcePath), "replacement ref and worktree bytes\n");
  runGit(repositoryRoot, ["add", "--", sourcePath]);
  const replacementTree = runGit(repositoryRoot, ["write-tree"]).trim();
  const replacementCommit = runGit(repositoryRoot, [
    "commit-tree", replacementTree, "-p", originalCommit, "-m", "replacement ref candidate"
  ]).trim();
  runGit(repositoryRoot, ["replace", originalCommit, replacementCommit]);

  const plan = generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity
  });
  const entries = plan.records
    .filter(({ name }) => name.endsWith(".jsonl"))
    .flatMap(({ bytes }) => bytes.toString("utf8").trimEnd().split("\n").map(JSON.parse));
  assert.equal(plan.sourceSnapshot.revisionObjectId, originalCommit);
  assert.equal(plan.sourceSnapshot.treeObjectId, originalTree);
  assert.equal(entries.find(({ path: repositoryPath }) => repositoryPath === sourcePath).sha256, sha256(originalBytes));
});

test("raw Git helper rejects caller overrides that could weaken its inert configuration", () => {
  assert.throws(
    () => safeRawGitArguments(["-c", "core.hooksPath=/tmp/hooks", "rev-parse", "--verify", "HEAD^{commit}"]),
    /caller Git configuration overrides are forbidden/u
  );
  assert.throws(
    () => safeRawGitArguments(["--config-env", "core.fsmonitor=UNTRUSTED_VALUE", "rev-parse", "--verify", "HEAD^{commit}"]),
    /caller Git configuration overrides are forbidden/u
  );
});

test("committed symlinks bind link bytes and are never followed", (t) => {
  const repositoryRoot = createRepository(t, 1);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "source-manifest-symlink-target-"));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const externalTarget = path.join(external, "outside.txt");
  fs.writeFileSync(externalTarget, "outside bytes must never enter the closure\n");
  const linkBytes = Buffer.from(path.relative(path.join(repositoryRoot, "links"), externalTarget), "utf8");
  fs.mkdirSync(path.join(repositoryRoot, "links"));
  fs.symlinkSync(linkBytes.toString("utf8"), path.join(repositoryRoot, "links", "outside"));
  runGit(repositoryRoot, ["add", "--", "links/outside"]);
  runGit(repositoryRoot, ["commit", "--quiet", "-m", "add committed symlink"]);

  const plan = generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity
  });
  const entries = plan.records
    .filter(({ name }) => name.endsWith(".jsonl"))
    .flatMap(({ bytes }) => bytes.toString("utf8").trimEnd().split("\n").map(JSON.parse));
  const linkEntry = entries.find(({ path: repositoryPath }) => repositoryPath === "links/outside");
  assert.deepEqual(linkEntry, {
    path: "links/outside",
    gitMode: "120000",
    blobObjectId: runGit(repositoryRoot, ["rev-parse", "HEAD:links/outside"]).trim(),
    byteLength: linkBytes.length,
    sha256: sha256(linkBytes),
    roleIds: ["source", "symlink"]
  });
  assert.equal(plan.stats.symlinkEntries, 1);
  assert.equal(entries.some(({ sha256: digest }) => digest === sha256(fs.readFileSync(externalTarget))), false);
});

test("Gitlinks remain exact parent-tree dependency pointers without invalidating manifest generation", (t) => {
  const repositoryRoot = createRepository(t, 2);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  const linkedCommit = runGit(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  runGit(repositoryRoot, ["update-index", "--add", "--cacheinfo", `160000,${linkedCommit},vendor/companion`]);
  runGit(repositoryRoot, ["commit", "--quiet", "-m", "add gitlink"]);

  const plan = generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity
  });
  assert.equal(plan.stats.entryCount, 2);
  assert.equal(plan.stats.gitlinkEntries, 1);
  assert.deepEqual(plan.dependencyPointers, {
    gitlinks: [{
      path: "vendor/companion",
      gitMode: "160000",
      commitObjectId: linkedCommit
    }]
  });
  assert.equal(plan.manifest.entryCount, 2);
  assert.equal(fs.existsSync(path.join(repositoryRoot, "review", "source-closure-v1")), false);

  fs.mkdirSync(path.join(repositoryRoot, "vendor", "companion", "review"), { recursive: true });
  assertSourceError(() => generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "vendor/companion/review/source-closure-v1",
    ...repositoryIdentity
  }), "OUTPUT_DIRECTORY_INSIDE_GITLINK");
});

test("path traversal, symlink ancestors, tracked targets, and missing required roles fail closed", (t) => {
  const repositoryRoot = createRepository(t, 2);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  assertSourceError(() => generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "../escape",
    ...repositoryIdentity
  }), "REPOSITORY_PATH_UNSAFE");
  assertSourceError(() => generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review//source-closure-v1",
    ...repositoryIdentity
  }), "REPOSITORY_PATH_UNSAFE");

  const external = fs.mkdtempSync(path.join(os.tmpdir(), "source-manifest-outside-"));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.symlinkSync(external, path.join(repositoryRoot, "linked-review"));
  assertSourceError(() => generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "linked-review/source-closure-v1",
    ...repositoryIdentity
  }), "OUTPUT_PARENT_INVALID");

  assertSourceError(() => generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity,
    requiredRoleMappings: [{ path: "src/missing.sol", roleId: "contract" }]
  }), "REQUIRED_ROLE_PATH_MISSING");

  fs.mkdirSync(path.join(repositoryRoot, "review", "source-closure-v1"));
  assertSourceError(() => generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity
  }), "OUTPUT_TARGET_EXISTS");

  const trackedRepositoryRoot = createRepository(t, 1, {
    additionalFiles: { "review/source-closure-v1/already-tracked.json": "tracked metadata path\n" }
  });
  fs.rmSync(path.join(trackedRepositoryRoot, "review", "source-closure-v1"), { recursive: true });
  assertSourceError(() => generateSourceClosureManifestV1({
    repositoryRoot: trackedRepositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity
  }), "OUTPUT_DIRECTORY_TRACKED");
});

test("resource ceilings and plan tampering fail without creating output", (t) => {
  const repositoryRoot = createRepository(t, 3);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  assertSourceError(() => generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity,
    limits: { maxEntries: 2 }
  }), "SOURCE_MANIFEST_RESOURCE_LIMIT");
  assertSourceError(() => generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity,
    limits: { maxTotalSourceBytes: 1 }
  }), "SOURCE_MANIFEST_RESOURCE_LIMIT");
  assertSourceError(() => generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity,
    chunkMaxBytes: 1
  }), "SOURCE_MANIFEST_RESOURCE_LIMIT");

  const plan = generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity
  });
  plan.records.find(({ name }) => name.endsWith(".jsonl")).bytes[0] ^= 0x01;
  assertSourceError(() => materializeSourceClosureManifestV1(plan), "SOURCE_MANIFEST_PLAN_TAMPERED");
  assert.equal(fs.existsSync(path.join(repositoryRoot, "review", "source-closure-v1")), false);

  const bindingTamper = generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity
  });
  bindingTamper.manifestBindingTemplate.sha256 = `sha256:${"a".repeat(64)}`;
  assertSourceError(() => materializeSourceClosureManifestV1(bindingTamper), "SOURCE_MANIFEST_PLAN_TAMPERED");
  assert.equal(fs.existsSync(path.join(repositoryRoot, "review", "source-closure-v1")), false);
});

test("CLI reports resource budgets as split review without rejecting the idea", (t) => {
  const repositoryRoot = createRepository(t, 3);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  const output = captureOutput();
  const exitCode = runSourceManifestCli({
    argv: [
      "--repo-root", repositoryRoot,
      "--output-dir", "review/source-closure-v1",
      "--repository-uri", repositoryIdentity.repositoryUri,
      "--numeric-repository-id", repositoryIdentity.numericRepositoryId
    ],
    stdout: output.stream,
    limits: { maxEntries: 2 }
  });
  const report = JSON.parse(output.value());
  assert.equal(exitCode, SOURCE_MANIFEST_EXIT.HELD);
  assert.equal(report.status, "HOLD_SPLIT_REVIEW");
  assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.equal(report.splitReviewRequired, true);
  assert.equal(report.error.code, "SOURCE_MANIFEST_RESOURCE_LIMIT");
  assert.equal(report.error.classification, "tooling-split-review");
  assert.equal(report.writePerformed, false);
  assert.equal(fs.existsSync(path.join(repositoryRoot, "review", "source-closure-v1")), false);
});

test("CLI reports SHA-256 Git object databases as integration pending without writing", (t) => {
  const repositoryRoot = createRepository(t, 1);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  const output = captureOutput();
  const exitCode = runSourceManifestCli({
    argv: [
      "--repo-root", repositoryRoot,
      "--output-dir", "review/source-closure-v1",
      "--repository-uri", repositoryIdentity.repositoryUri,
      "--numeric-repository-id", repositoryIdentity.numericRepositoryId,
      "--write"
    ],
    stdout: output.stream,
    gitRunner(args) {
      assert.ok(args.includes("rev-parse"));
      return { status: 0, stdout: `${"a".repeat(64)}\n`, stderr: "", error: null };
    }
  });
  const report = JSON.parse(output.value());
  assert.equal(exitCode, SOURCE_MANIFEST_EXIT.HELD);
  assert.equal(report.status, "INTEGRATION_PENDING");
  assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.equal(report.error.code, "SOURCE_GIT_OBJECT_FORMAT_UNSUPPORTED");
  assert.equal(report.error.classification, "tooling-transport");
  assert.equal(report.writePerformed, false);
  assert.equal(fs.existsSync(path.join(repositoryRoot, "review", "source-closure-v1")), false);
});

test("committed paths beyond legacy caps generate and verify until the explicit byte budget needs split review", async (t) => {
  const repositoryRoot = createRepository(t, 1);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  const longRepositoryPath = replaceHeadWithDeepTree(repositoryRoot, 90);
  assert.ok(longRepositoryPath.length > 2048);
  const pathByteLength = Buffer.byteLength(longRepositoryPath, "utf8");
  const plan = generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity,
    limits: { maxRepositoryPathBytes: pathByteLength }
  });
  const [entry] = plan.records
    .filter(({ name }) => name.endsWith(".jsonl"))
    .flatMap(({ bytes }) => bytes.toString("utf8").trimEnd().split("\n").map(JSON.parse));
  assert.equal(entry.path, longRepositoryPath);

  const output = captureOutput();
  const exitCode = runSourceManifestCli({
    argv: [
      "--repo-root", repositoryRoot,
      "--output-dir", "review/source-closure-v1",
      "--repository-uri", repositoryIdentity.repositoryUri,
      "--numeric-repository-id", repositoryIdentity.numericRepositoryId,
      "--write"
    ],
    stdout: output.stream,
    limits: { maxRepositoryPathBytes: pathByteLength - 1 }
  });
  const report = JSON.parse(output.value());
  assert.equal(exitCode, SOURCE_MANIFEST_EXIT.HELD);
  assert.equal(report.status, "HOLD_SPLIT_REVIEW");
  assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.equal(report.splitReviewRequired, true);
  assert.equal(report.error.code, "SOURCE_MANIFEST_RESOURCE_LIMIT");
  assert.equal(report.error.classification, "tooling-split-review");
  assert.equal(report.error.details.observed, pathByteLength);
  assert.equal(report.error.details.maximum, pathByteLength - 1);
  assert.equal(report.writePerformed, false);
  assert.equal(fs.existsSync(path.join(repositoryRoot, "review", "source-closure-v1")), false);

  materializeSourceClosureManifestV1(plan);
  runGit(repositoryRoot, ["read-tree", "HEAD"]);
  runGit(repositoryRoot, ["add", "--", "review/source-closure-v1"]);
  runGit(repositoryRoot, ["commit", "--quiet", "-m", "bind deep-path source closure"]);
  const revisionObjectId = runGit(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const verification = await verifyLocalSourceClosureManifestV1({
    repositoryRoot,
    repository: {
      id: "primary",
      ...repositoryIdentity,
      revisionObjectId,
      treeObjectId: runGit(repositoryRoot, ["rev-parse", "HEAD^{tree}"]).trim(),
      sourceClosureMode: "manifest",
      sourcePaths: [],
      sourceManifest: plan.manifestBindingTemplate,
      contractPaths: [],
      githubActionsRunIds: []
    },
    manifest: plan.manifest,
    requiredEntries: [],
    requiredPaths: []
  });
  assert.equal(verification.status, "VERIFIED", JSON.stringify(verification.findings));
  assert.equal(verification.sourceClosureVerified, true);
});

test("CLI reports non-UTF-8 committed Git paths as integration pending", (t) => {
  const repositoryRoot = createRepository(t, 1);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  replaceHeadWithNonUtf8Tree(repositoryRoot);
  const output = captureOutput();
  const exitCode = runSourceManifestCli({
    argv: [
      "--repo-root", repositoryRoot,
      "--output-dir", "review/source-closure-v1",
      "--repository-uri", repositoryIdentity.repositoryUri,
      "--numeric-repository-id", repositoryIdentity.numericRepositoryId,
      "--write"
    ],
    stdout: output.stream
  });
  const report = JSON.parse(output.value());
  assert.equal(exitCode, SOURCE_MANIFEST_EXIT.HELD);
  assert.equal(report.status, "INTEGRATION_PENDING");
  assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.equal(report.error.code, "SOURCE_PATH_UTF8_INVALID");
  assert.equal(report.error.classification, "tooling-transport");
  assert.equal(report.writePerformed, false);
  assert.equal(fs.existsSync(path.join(repositoryRoot, "review", "source-closure-v1")), false);
});

test("CLI keeps exotic committed paths eligible and privacy-safe as integration pending", (t) => {
  const repositoryRoot = createRepository(t, 1);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  replaceHeadWithExoticTree(repositoryRoot);
  const output = captureOutput();
  const exitCode = runSourceManifestCli({
    argv: [
      "--repo-root", repositoryRoot,
      "--output-dir", "review/source-closure-v1",
      "--repository-uri", repositoryIdentity.repositoryUri,
      "--numeric-repository-id", repositoryIdentity.numericRepositoryId,
      "--write"
    ],
    stdout: output.stream
  });
  const reportText = output.value();
  const report = JSON.parse(reportText);
  assert.equal(exitCode, SOURCE_MANIFEST_EXIT.HELD);
  assert.equal(report.status, "INTEGRATION_PENDING");
  assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.equal(report.error.code, "SOURCE_PATH_NONPORTABLE");
  assert.equal(report.error.classification, "tooling-transport");
  assert.equal("details" in report.error, false);
  assert.equal(reportText.includes("private\\secret.sol"), false);
  assert.equal(report.writePerformed, false);
  assert.equal(fs.existsSync(path.join(repositoryRoot, "review", "source-closure-v1")), false);
});

test("a moved HEAD invalidates a plan before any metadata write", (t) => {
  const repositoryRoot = createRepository(t, 2);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  const plan = generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity
  });
  fs.writeFileSync(path.join(repositoryRoot, "new-source.txt"), "new commit\n");
  runGit(repositoryRoot, ["add", "--", "new-source.txt"]);
  runGit(repositoryRoot, ["commit", "--quiet", "-m", "move head"]);
  assertSourceError(() => materializeSourceClosureManifestV1(plan), "SOURCE_SNAPSHOT_CHANGED");
  assert.equal(fs.existsSync(path.join(repositoryRoot, "review", "source-closure-v1")), false);
});

test("materialization rehashes raw recursive trees after staging and before atomic rename", (t) => {
  const repositoryRoot = createRepository(t, 2);
  fs.mkdirSync(path.join(repositoryRoot, "review"));
  const plan = generateSourceClosureManifestV1({
    repositoryRoot,
    outputDirectory: "review/source-closure-v1",
    ...repositoryIdentity
  });
  const recursiveTree = runGit(repositoryRoot, ["rev-parse", "HEAD:src"]).trim();
  let substituted = false;
  const fsApi = new Proxy(fs, {
    get(target, property) {
      if (property !== "writeFileSync") return Reflect.get(target, property);
      return (...argumentsList) => {
        const result = fs.writeFileSync(...argumentsList);
        if (!substituted && String(argumentsList[0]).includes(".source-manifest-staging-")) {
          substituted = true;
          const objectPath = path.join(repositoryRoot, ".git", "objects", recursiveTree.slice(0, 2), recursiveTree.slice(2));
          const inflated = zlib.inflateSync(fs.readFileSync(objectPath));
          const nul = inflated.indexOf(0);
          const bytes = Buffer.from(inflated.subarray(nul + 1));
          bytes[bytes.length - 1] ^= 0x01;
          fs.chmodSync(objectPath, 0o600);
          fs.writeFileSync(objectPath, zlib.deflateSync(Buffer.concat([
            Buffer.from(`tree ${bytes.length}\0`, "ascii"),
            bytes
          ])));
        }
        return result;
      };
    }
  });

  assertSourceError(
    () => materializeSourceClosureManifestV1(plan, { fsApi }),
    "SOURCE_GIT_OBJECT_HASH_MISMATCH"
  );
  assert.equal(substituted, true);
  assert.equal(fs.existsSync(path.join(repositoryRoot, "review", "source-closure-v1")), false);
});

test("CLI parser keeps required path-role mappings open, exact, and deterministic", () => {
  const parsed = parseSourceManifestCliArgs([
    "--repo-root", "/tmp/repository",
    "--output-dir", "review/source-closure-v1",
    "--repository-uri", repositoryIdentity.repositoryUri,
    "--numeric-repository-id", repositoryIdentity.numericRepositoryId,
    "--required-role", "contracts/Hook.sol=contract",
    "--required-role", "contracts/Hook.sol=custom-price-engine",
    "--dry-run"
  ]);
  assert.deepEqual(parsed.requiredRoleMappings, [
    { path: "contracts/Hook.sol", roleId: "contract" },
    { path: "contracts/Hook.sol", roleId: "custom-price-engine" }
  ]);
  assert.equal(parsed.write, false);
  assert.equal(parsed.dryRun, true);
  assert.throws(
    () => parseSourceManifestCliArgs([
      "--repo-root", "/tmp/repository",
      "--output-dir", "review/source-closure-v1",
      "--repository-uri", repositoryIdentity.repositoryUri,
      "--numeric-repository-id", repositoryIdentity.numericRepositoryId,
      "--required-role", "../escape=contract"
    ]),
    /safe canonical repository-relative path/u
  );
});

function createRepository(t, entryCount, {
  additionalFiles = {},
  executablePaths = []
} = {}) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-source-manifest-"));
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  runGit(repositoryRoot, ["init", "--quiet", "--initial-branch=main"]);
  runGit(repositoryRoot, ["config", "user.name", "Source Manifest Test"]);
  runGit(repositoryRoot, ["config", "user.email", "source-manifest@example.invalid"]);
  runGit(repositoryRoot, ["config", "commit.gpgsign", "false"]);
  const width = String(entryCount - 1).length;
  for (let index = 0; index < entryCount; index += 1) {
    const filePath = path.join(repositoryRoot, "src", `file-${String(index).padStart(width, "0")}.txt`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `committed-source-${index}\n`);
  }
  for (const [repositoryPath, content] of Object.entries(additionalFiles)) {
    const filePath = path.join(repositoryRoot, ...repositoryPath.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  for (const repositoryPath of executablePaths) {
    fs.chmodSync(path.join(repositoryRoot, ...repositoryPath.split("/")), 0o755);
  }
  runGit(repositoryRoot, ["add", "--", "."]);
  runGit(repositoryRoot, ["commit", "--quiet", "-m", "source snapshot"]);
  return repositoryRoot;
}

function runGit(repositoryRoot, argumentsList, options = {}) {
  return childProcess.execFileSync("git", ["-C", repositoryRoot, ...argumentsList], {
    encoding: options.encoding ?? "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024
  });
}

function readGitBlob(repositoryRoot, revisionPath) {
  return childProcess.execFileSync("git", ["-C", repositoryRoot, "cat-file", "blob", revisionPath], {
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function replaceHeadWithDeepTree(repositoryRoot, depth) {
  const originalCommit = runGit(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const blobObjectId = runGitWithInput(repositoryRoot, ["hash-object", "-w", "--stdin"], "deep source\n").trim();
  const leafName = "DeepSource.sol";
  let treeObjectId = runGitWithInput(
    repositoryRoot,
    ["mktree"],
    `100644 blob ${blobObjectId}\t${leafName}\n`
  ).trim();
  const segments = [];
  for (let index = depth - 1; index >= 0; index -= 1) {
    const segment = `segment-${String(index).padStart(4, "0")}-${"x".repeat(10)}`;
    segments.unshift(segment);
    treeObjectId = runGitWithInput(
      repositoryRoot,
      ["mktree"],
      `040000 tree ${treeObjectId}\t${segment}\n`
    ).trim();
  }
  const commitObjectId = runGit(repositoryRoot, [
    "commit-tree", treeObjectId, "-p", originalCommit, "-m", "deep transport path"
  ]).trim();
  runGit(repositoryRoot, ["update-ref", "HEAD", commitObjectId, originalCommit]);
  return `${segments.join("/")}/${leafName}`;
}

function replaceHeadWithNonUtf8Tree(repositoryRoot) {
  const originalCommit = runGit(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const blobObjectId = runGitWithInput(repositoryRoot, ["hash-object", "-w", "--stdin"], "source\n").trim();
  const treeInput = Buffer.concat([
    Buffer.from(`100644 blob ${blobObjectId}\t`, "ascii"),
    Buffer.from([0xff]),
    Buffer.from(".sol\0", "ascii")
  ]);
  const treeObjectId = runGitWithInput(repositoryRoot, ["mktree", "-z"], treeInput).trim();
  const commitObjectId = runGit(repositoryRoot, [
    "commit-tree", treeObjectId, "-p", originalCommit, "-m", "non UTF-8 transport path"
  ]).trim();
  runGit(repositoryRoot, ["update-ref", "HEAD", commitObjectId, originalCommit]);
}

function replaceHeadWithExoticTree(repositoryRoot) {
  const originalCommit = runGit(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const blobObjectId = runGitWithInput(repositoryRoot, ["hash-object", "-w", "--stdin"], "source\n").trim();
  const treeInput = Buffer.from(`100644 blob ${blobObjectId}\tprivate\\secret.sol\0`, "utf8");
  const treeObjectId = runGitWithInput(repositoryRoot, ["mktree", "-z"], treeInput).trim();
  const commitObjectId = runGit(repositoryRoot, [
    "commit-tree", treeObjectId, "-p", originalCommit, "-m", "exotic transport path"
  ]).trim();
  runGit(repositoryRoot, ["update-ref", "HEAD", commitObjectId, originalCommit]);
}

function runGitWithInput(repositoryRoot, argumentsList, input) {
  return childProcess.execFileSync("git", ["-C", repositoryRoot, ...argumentsList], {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function parseJsonlRecord(bytes, index) {
  const lines = bytes.toString("utf8").trimEnd().split("\n");
  return JSON.parse(lines[index]);
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function assertSourceError(callback, code) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof SourceManifestError, String(error));
    assert.equal(error.code, code);
    return true;
  });
}

function captureOutput() {
  let output = "";
  return {
    stream: { write(value) { output += String(value); } },
    value() { return output.trim(); }
  };
}
